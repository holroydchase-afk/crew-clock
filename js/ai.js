// AI that runs on the phone, sized to the phone. Nothing here sends data anywhere.
//   Tier 0 (every phone): photo too dark / too blurry checks, plain-words day summary.
//   Tier 1 (4 GB+ RAM): a small image model labels what's in a punch photo (~14 MB, once, on Wi-Fi).
//   Tier 2 (WebGPU + 6 GB+ RAM, usually the boss's phone): a small language model writes the day summary.
(function (root) {
  const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
  const VISION_MODEL = 'Xenova/mobilenet_v2_1.0_224';
  const TEXT_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';

  // ImageNet labels that suggest a real job site.
  const SITE_WORDS = ['pickup', 'truck', 'trailer', 'tractor', 'forklift', 'crane', 'shovel', 'hammer', 'chain saw',
    'lumber', 'plank', 'barn', 'boathouse', 'patio', 'picket fence', 'worm fence', 'stone wall', 'roof', 'tile roof',
    'thatch', 'shingle', 'brick', 'cinder', 'ladder', 'hard hat', 'jeep', 'van', 'garage', 'carpenter', 'drill', 'plow'];

  function tier(nav) {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
    const mem = n.deviceMemory || 2; // Safari doesn't say; assume a modest phone
    const cores = n.hardwareConcurrency || 2;
    const saveData = !!(n.connection && n.connection.saveData);
    if (saveData || typeof WebAssembly === 'undefined' || mem < 4 || cores < 4) return 0;
    if (n.gpu && mem >= 6) return 2;
    return 1;
  }

  function onWifi(nav) {
    const c = (nav || navigator).connection;
    if (!c) return true; // iPhone doesn't report; the download is still opt-in
    return c.type === 'wifi' || c.type === 'ethernet' || (!c.type && c.effectiveType === '4g' && !c.saveData);
  }

  // ---------- tier 0: photo quality from raw pixels (RGBA) ----------
  function analyzePixels(data, w, h) {
    const gray = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += gray[j];
    }
    const brightness = sum / (w * h);
    // Variance of the Laplacian: low means few edges, i.e. blur.
    let lsum = 0;
    let lsq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        const lap = 4 * gray[k] - gray[k - 1] - gray[k + 1] - gray[k - w] - gray[k + w];
        lsum += lap;
        lsq += lap * lap;
        n++;
      }
    }
    const sharpness = n ? lsq / n - (lsum / n) ** 2 : 0;
    let problem = null;
    if (brightness < 35) problem = 'dark';
    else if (brightness > 245) problem = 'bright';
    else if (sharpness < 25) problem = 'blurry';
    return { brightness: Math.round(brightness), sharpness: Math.round(sharpness), problem };
  }

  function photoQuality(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = 160;
        const h = Math.max(1, Math.round((img.height / img.width) * w));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h));
      };
      img.onerror = () => resolve({ problem: null });
      img.src = dataUrl;
    });
  }

  const PHOTO_WORDS = {
    dark: "That picture is too dark. Try again with more light.",
    bright: 'That picture is washed out. Try again out of direct sun.',
    blurry: 'That picture is blurry. Hold the phone still and try again.',
  };

  // ---------- tier 0: day summary from facts, no model ----------
  // shifts: Report.pairShifts output; names: id -> name; jobs: id -> name; notIn: names; now: ms
  // A shift still open counts up to now, and the sentence says "so far today" (UX-R21).
  // opts.pastDay: the shifts are another day's (the demo's "Yesterday (sample day)"), so never
  // "so far today" even if a visitor's own shift this morning is still open (UX-R46b).
  function plainSummary(shifts, names, jobs, notIn, now, opts) {
    const at = now == null ? Date.now() : now;
    const people = new Set(shifts.map((s) => s.crewId));
    const onsite = shifts.filter((s) => s.status === 'onsite').length;
    const running = shifts.filter((s) => s.open && s.inAt != null && at > s.inAt);
    // Each shift counts as the tenths shown on its row and in the Week cells, so the totals agree (UX-R50)
    const tenths = (h) => Math.round((h || 0) * 10) / 10;
    const hours = shifts.reduce((a, s) => a + tenths(s.hours), 0) + running.reduce((a, s) => a + tenths((at - s.inAt) / 3600000), 0);
    const flagged = shifts.filter((s) => s.status === 'offsite' || s.status === 'near' || s.status === 'nogps' || s.missingOut);
    const byJob = {};
    shifts.forEach((s) => { byJob[jobs[s.jobId] || 'a job'] = (byJob[jobs[s.jobId] || 'a job'] || 0) + 1; });
    const busiest = Object.entries(byJob).sort((a, b) => b[1] - a[1])[0];
    const parts = [];
    const worked = running.length ? `${people.size === 1 ? 'has' : 'have'} worked ${hours.toFixed(1)} hours${opts && opts.pastDay ? '' : ' so far today'}` : `worked ${hours.toFixed(1)} hours`;
    parts.push(`${people.size} ${people.size === 1 ? 'person' : 'people'} ${worked} across ${Object.keys(byJob).length} ${Object.keys(byJob).length === 1 ? 'job' : 'jobs'}.`);
    if (shifts.length) parts.push(`${onsite} of ${shifts.length} ${shifts.length === 1 ? 'shift was' : 'shifts were'} fully on site${busiest ? `; ${busiest[0]} had the most crew` : ''}.`);
    // Each person once, and no ".." when a name ends in a period ("Ray T.") (UX-8).
    const end = (t) => (/\.$/.test(t) ? t : t + '.');
    // Each person once, under the reason from their worst shift, worst first (UX-R12):
    // "Check: off site for Ray T.; no GPS for Billy S.; near the job for Cody M."
    const REASONS = [['offsite', 'off site'], ['nogps', 'no GPS'], ['missingOut', 'no clock-out'], ['near', 'near the job']];
    const reasonOf = (s) => (s.status === 'offsite' ? 0 : s.status === 'nogps' ? 1 : s.missingOut ? 2 : 3);
    const worst = {};
    flagged.forEach((s) => { if (worst[s.crewId] == null || reasonOf(s) < worst[s.crewId]) worst[s.crewId] = reasonOf(s); });
    const groups = REASONS.map(([, words], i) => [words, Object.keys(worst).filter((id) => worst[id] === i).map((id) => names[id] || 'someone')])
      .filter(([, who]) => who.length);
    if (groups.length) parts.push(end(`Check: ${groups.map(([words, who]) => `${words} for ${who.join(', ')}`).join('; ')}`));
    // Mid-day the missing are "not in yet"; once the day is over (or unknown) they "didn't clock in" (UX-R51)
    if (notIn && notIn.length) parts.push(end(`${opts && opts.dayOver === false ? 'Not in yet' : "Didn't clock in"}: ${notIn.join(', ')}`));
    return parts.join(' ');
  }

  // ---------- tiers 1 and 2: models from the Hugging Face hub, cached by the browser ----------
  let lib = null;
  function transformers() {
    lib = lib || import(TRANSFORMERS).then((m) => { m.env.allowLocalModels = false; return m; });
    return lib;
  }

  let vision = null;
  async function labelPhoto(dataUrl) {
    const t = await transformers();
    vision = vision || t.pipeline('image-classification', VISION_MODEL, { dtype: 'q8' });
    const out = await (await vision)(dataUrl, { top_k: 5 });
    const labels = out.map((o) => ({ label: o.label.split(',')[0], score: o.score }));
    const site = labels.filter((l) => SITE_WORDS.some((w) => l.label.toLowerCase().includes(w)));
    return { labels, looksLikeSite: site.length > 0 };
  }

  let writer = null;
  async function writeSummary(facts) {
    const t = await transformers();
    writer = writer || t.pipeline('text-generation', TEXT_MODEL, { device: 'webgpu', dtype: 'q4f16' });
    const messages = [
      { role: 'system', content: 'You write a 3 sentence end-of-day note for a construction boss. Plain words. Only use the facts given. No lists.' },
      { role: 'user', content: facts },
    ];
    const out = await (await writer)(messages, { max_new_tokens: 120, do_sample: false });
    const last = out[0].generated_text;
    return Array.isArray(last) ? last[last.length - 1].content : String(last);
  }

  const api = { tier, onWifi, analyzePixels, photoQuality, PHOTO_WORDS, plainSummary, labelPhoto, writeSummary, SITE_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AI = api;
})(typeof self !== 'undefined' ? self : globalThis);
