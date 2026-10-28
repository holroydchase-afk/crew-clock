// Crew chat, end-to-end encrypted with MLS. The server (or demo store) only relays
// ciphertext; group keys and readable messages live on each phone.
// The MLS code (js/vendor/crew-mls.js, ~70 KB zipped) loads only when chat opens.
(function (root) {
  const App = root.CrewClock;
  const { Icons, Store, Api } = root;
  const cfg = root.APP_CONFIG || {};
  if (!App) return;
  const { state, esc, toast, time, initials } = App;

  // ---------- local storage (per person, so a shared phone keeps chats apart) ----------
  const DB = 'crewclock-chat';
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const t = req.result.transaction('kv', mode);
        const r = fn(t.objectStore('kv'));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = () => reject(t.error);
      };
    });
  }
  const kvFor = (id) => ({
    get: (k) => idb('readonly', (s) => s.get(`${id}:${k}`)),
    set: (k, v) => idb('readwrite', (s) => s.put(v, `${id}:${k}`)),
  });
  const kv = {
    get: (k) => kvFor(state.me.id).get(k),
    set: (k, v) => kvFor(state.me.id).set(k, v),
  };

  let mlsPromise = null;
  function mls() {
    if (root.CrewMLS) return Promise.resolve(root.CrewMLS);
    mlsPromise = mlsPromise || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/crew-mls.js';
      s.onload = () => resolve(root.CrewMLS);
      s.onerror = () => { mlsPromise = null; reject(new Error('Chat needs signal the first time')); };
      document.head.appendChild(s);
    });
    return mlsPromise;
  }

  // ---------- transports ----------
  let stopped = false; // "Reset sample data": nothing in flight may write the old chat back
  const demoTransport = {
    _db() { return Store.local.get('demo.chat', { keyPackages: {}, groups: [], messages: [], seq: 0 }); },
    _save(d) { if (!stopped) Store.local.set('demo.chat', d); },
    async publishKeyPackage(b64) { const d = this._db(); d.keyPackages[state.me.id] = b64; this._save(d); },
    async keyPackages(ids) { const d = this._db(); return Object.fromEntries(ids.filter((i) => d.keyPackages[i]).map((i) => [i, d.keyPackages[i]])); },
    async createGroup(g) { const d = this._db(); d.groups.push(g); this._save(d); },
    async groups() { return this._db().groups.filter((g) => g.members.includes(state.me.id)); },
    async post(m) {
      const d = this._db();
      d.seq += 1;
      d.messages.push(Object.assign({ id: d.seq, sender: state.me.id, at: Date.now() }, m));
      this._save(d);
    },
    async since(afterId) {
      const d = this._db();
      const mine = new Set(d.groups.filter((g) => g.members.includes(state.me.id)).map((g) => g.id));
      return d.messages.filter((m) => m.id > afterId && (m.kind === 'welcome' ? m.recipient === state.me.id : mine.has(m.groupId)));
    },
  };

  const sb = () => root.SupabaseApi;
  const claim = (t) => JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const supabaseTransport = {
    run(fn) { return sb().authed(state.auth, fn); },
    publishKeyPackage(b64) {
      return this.run((t) => sb().insert('mls_key_packages', { org_id: claim(t).org_id, crew_id: state.me.id,
        device_id: sb().session().deviceId || state.me.id, key_package: b64 }, t));
    },
    keyPackages(ids) {
      return this.run(async (t) => {
        const rows = await sb().rest(`mls_key_packages?crew_id=in.(${ids.join(',')})&order=created_at.desc&select=crew_id,key_package`, t);
        const out = {};
        rows.forEach((r) => { if (!out[r.crew_id]) out[r.crew_id] = r.key_package; });
        return out;
      });
    },
    createGroup(g) {
      return this.run(async (t) => {
        const org = claim(t).org_id;
        await sb().insert('chat_groups', { id: g.id, org_id: org, name: g.name, created_by: state.me.id }, t);
        await sb().insert('chat_members', g.members.map((c) => ({ group_id: g.id, crew_id: c })), t);
      });
    },
    groups() {
      return this.run(async (t) => {
        const [gs, ms] = await Promise.all([
          sb().rest('chat_groups?select=id,name,created_by', t),
          sb().rest('chat_members?select=group_id,crew_id', t),
        ]);
        return gs.map((g) => Object.assign(g, { members: ms.filter((m) => m.group_id === g.id).map((m) => m.crew_id) }));
      });
    },
    post(m) {
      return this.run((t) => sb().insert('mls_messages', { org_id: claim(t).org_id, group_id: m.groupId, sender_crew_id: state.me.id,
        recipient_crew_id: m.recipient || null, kind: m.kind, epoch: m.epoch || 0, ciphertext: m.ciphertext }, t));
    },
    since(afterId) {
      return this.run(async (t) => (await sb().rest(`mls_messages?id=gt.${afterId}&order=id.asc&limit=200&select=*`, t))
        .map((r) => ({ id: r.id, groupId: r.group_id, sender: r.sender_crew_id, recipient: r.recipient_crew_id,
          kind: r.kind, epoch: r.epoch, ciphertext: r.ciphertext, at: Date.parse(r.created_at) })));
    },
  };

  const transport = () => (Api.isDemo ? demoTransport : supabaseTransport);

  // ---------- engine (one operation at a time: MLS state must advance in order) ----------
  let chain = Promise.resolve();
  const serial = (fn) => { const r = chain.then(fn); chain = r.catch(() => {}); return r; };

  async function identity() {
    let me = await kv.get('identity');
    if (!me) {
      const M = await mls();
      me = await M.newKeyPackage(state.me.id);
      await kv.set('identity', me);
    }
    if (!me.published) {
      await transport().publishKeyPackage(me.publicB64);
      me.published = true;
      await kv.set('identity', me);
    }
    return me;
  }

  const emptyChat = () => ({ states: {}, messages: {}, lastId: 0, read: {} });
  async function local() {
    return (await kv.get('chat')) || emptyChat();
  }

  // ---------- demo only: a sample crew chat, so the boss's Chat tab isn't empty (M1.10-a) ----------
  // Made-up messages, encrypted with MLS like any other: the shared demo store holds only
  // ciphertext, and each sample person keeps their own keys and readable copy on this phone.
  const SAMPLE_GROUP = 'Smith kitchen crew';
  const SAMPLE_MEMBERS = ['c1', 'c0', 'c2']; // Ray T. (foreman) starts it with Sam W. and Jake R.
  const SAMPLE_LINES = [
    ['c1', 6.6, "Morning. Lumber drop moved to 10. I'll sign for it."],
    ['c2', 6.75, "Need two more boxes of deck screws at Smith's."],
    ['c1', 6.8, "I'll grab them on the way over."],
    ['c2', 7.4, 'Cabinets are in. Starting on the uppers.'],
  ];
  async function seedDemoChat(M) {
    if (!Api.isDemo || cfg.backend !== 'demo') return; // never in a crew build that fell back to demo (PS-M110-1)
    const d = demoTransport._db();
    if (d.seeded) return;
    // A store from before the sample chat already has someone's groups: leave it alone.
    if (d.groups.length || d.messages.length) { d.seeded = true; demoTransport._save(d); return; }
    const now = Date.now();
    const base = root.DemoBackend && root.DemoBackend.sampleDay ? root.DemoBackend.sampleDay(now).base : root.Report.startOfDay(now);
    const at = (h) => Math.min(base + h * 3600000, now - 60000);
    const people = {};
    for (const id of SAMPLE_MEMBERS) {
      const k = kvFor(id);
      let ident = await k.get('identity'); // a visitor's own keys stay as they are
      if (!ident) ident = await M.newKeyPackage(id);
      d.keyPackages[id] = ident.publicB64;
      ident.published = true;
      people[id] = { k, ident, chat: (await k.get('chat')) || emptyChat() };
    }
    const post = (m) => { d.seq += 1; d.messages.push(Object.assign({ id: d.seq }, m)); };
    const [lead, ...rest] = SAMPLE_MEMBERS;
    const gid = Store.uid();
    let s = await M.startGroup(gid, people[lead].ident);
    const add = await M.addMembers(s, rest.map((id) => people[id].ident.publicB64));
    people[lead].chat.states[gid] = add.stateB64;
    d.groups.push({ id: gid, name: SAMPLE_GROUP, createdBy: lead, members: SAMPLE_MEMBERS.slice() });
    for (const id of rest) {
      post({ groupId: gid, kind: 'welcome', recipient: id, ciphertext: add.welcomeB64, epoch: add.epoch, sender: lead, at: at(6.5) });
      people[id].chat.states[gid] = await M.join(add.welcomeB64, people[id].ident);
    }
    for (const [from, h, text] of SAMPLE_LINES) {
      const p = people[from];
      const r = await M.encrypt(p.chat.states[gid], text);
      p.chat.states[gid] = r.stateB64;
      post({ groupId: gid, kind: 'application', ciphertext: r.cipherB64, sender: from, at: at(h) });
      // Each member reads it the way their own sync would, so every phone's state stays in step.
      for (const id of SAMPLE_MEMBERS) {
        const c = people[id].chat;
        if (id !== from) c.states[gid] = (await M.decrypt(c.states[gid], r.cipherB64)).stateB64;
        (c.messages[gid] = c.messages[gid] || []).push({ from, text, at: at(h) });
      }
    }
    for (const id of SAMPLE_MEMBERS) {
      const p = people[id];
      p.chat.lastId = Math.max(p.chat.lastId, d.seq);
      await p.k.set('identity', p.ident);
      await p.k.set('chat', p.chat);
    }
    d.seeded = true;
    demoTransport._save(d);
  }

  const sync = () => serial(async () => {
    if (!state.me) return;
    const M = await mls();
    await seedDemoChat(M);
    const me = await identity();
    const c = await local();
    const incoming = await transport().since(c.lastId);
    for (const m of incoming) {
      c.lastId = Math.max(c.lastId, m.id);
      if (m.sender === state.me.id) continue; // we keep our own plaintext when sending
      try {
        if (m.kind === 'welcome') {
          if (!c.states[m.groupId]) c.states[m.groupId] = await M.join(m.ciphertext, me);
        } else if (c.states[m.groupId]) {
          const r = await M.decrypt(c.states[m.groupId], m.ciphertext);
          c.states[m.groupId] = r.stateB64;
          if (r.text != null) (c.messages[m.groupId] = c.messages[m.groupId] || []).push({ from: m.sender, text: r.text, at: m.at });
        }
      } catch (e) {
        // From before we joined, or out of order: MLS can't read it, by design.
      }
    }
    await kv.set('chat', c);
    return c;
  });

  const createGroup = (name, memberIds) => serial(async () => {
    const M = await mls();
    const me = await identity();
    const kps = await transport().keyPackages(memberIds);
    const ready = memberIds.filter((id) => kps[id]);
    const notReady = memberIds.filter((id) => !kps[id]);
    if (!ready.length) throw new Error('Nobody picked has opened Messages yet');
    const id = Store.uid();
    let s = await M.startGroup(id, me);
    const add = await M.addMembers(s, ready.map((r) => kps[r]));
    s = add.stateB64;
    await transport().createGroup({ id, name, createdBy: state.me.id, members: [state.me.id, ...ready] });
    for (const r of ready) await transport().post({ groupId: id, kind: 'welcome', recipient: r, ciphertext: add.welcomeB64, epoch: add.epoch });
    const c = await local();
    c.states[id] = s;
    await kv.set('chat', c);
    return { id, notReady };
  });

  const send = (groupId, text) => serial(async () => {
    const M = await mls();
    const c = await local();
    const r = await M.encrypt(c.states[groupId], text);
    await transport().post({ groupId, kind: 'application', ciphertext: r.cipherB64 });
    c.states[groupId] = r.stateB64;
    (c.messages[groupId] = c.messages[groupId] || []).push({ from: state.me.id, text, at: Date.now() });
    await kv.set('chat', c);
  });

  // ---------- screens ----------
  const view = { groups: [], chat: null, open: null, error: null, picking: [] };

  async function refresh() {
    const who = state.me && state.me.id;
    try {
      view.chat = await sync();
      view.groups = await transport().groups();
      view.error = null;
      if (!state.me || state.me.id !== who) Object.assign(view, { groups: [], chat: null }); // switched user mid-load
    } catch (e) {
      view.error = e.offline ? 'No signal. Messages will load when you get signal.' : e.message;
    }
  }

  function unread(groupId) {
    const c = view.chat;
    if (!c || !state.me) return 0;
    const seen = (c.read && c.read[groupId]) || 0;
    return (c.messages[groupId] || []).filter((m) => m.at > seen && m.from !== state.me.id).length;
  }

  function nameOf(id) {
    const c = App.crewById(id);
    return c ? c.name : 'Crew';
  }

  function listHtml() {
    const rows = view.groups.filter((g) => !view.chat || view.chat.states[g.id]).map((g) => {
      const msgs = (view.chat && view.chat.messages[g.id]) || [];
      const last = msgs[msgs.length - 1];
      const n = unread(g.id);
      return `<button class="job-btn" data-action="chat-open" data-id="${esc(g.id)}">
        <span class="job-ico">${Icons.chat}</span>
        <span class="grow"><span class="job-name">${esc(g.name)}</span>
          <span class="job-addr">${last ? esc((last.from === state.me.id ? 'You: ' : nameOf(last.from) + ': ') + last.text) : 'No messages yet'}</span></span>
        ${n ? `<span class="badge on">${n}</span>` : ''}
      </button>`;
    }).join('');
    return `<div class="pad">
      <div class="row-between"><h2>Messages</h2>${App.isLead() ? `<button class="btn primary sm" data-action="chat-new">${Icons.plus} New group</button>` : ''}</div>
      <p class="e2e">${Icons.lock}<span>Locked: only people in the group can read these. Not even the company server can.</span></p>
      ${view.error ? `<p class="notice">${esc(view.error)}</p>` : ''}
      <div class="list">${rows || (!view.chat ? '<p class="muted">Loading…</p>'
        : App.isLead() ? '<p class="muted">No groups yet.</p>' : '<p class="muted">No groups yet. The boss or foreman can start one.</p>')}</div>
    </div>`;
  }

  App.screens['chat-list'] = () => `<main class="screen">
      <button class="back" data-action="go-home">${Icons.back} Back</button>
      ${listHtml()}
    </main>`;

  App.screens['chat-new'] = () => {
    const people = state.crew.filter((c) => c.id !== state.me.id && c.active !== false);
    return `<main class="screen form">
      <button class="back" data-action="chat-back">${Icons.back} Messages</button>
      <h1>New group</h1>
      <label class="field"><span>Group name</span><input id="chat-name" placeholder="Smith kitchen crew" autocomplete="off"></label>
      <div class="field"><span>Who's in it?</span>
        <div class="list">${people.map((c) => `<label class="row-card pick">
          <input type="checkbox" value="${esc(c.id)}" ${view.picking.includes(c.id) ? 'checked' : ''}>
          <span class="avatar">${esc(initials(c.name))}</span><span class="grow">${esc(c.name)}</span></label>`).join('')}</div></div>
      <button class="btn primary xl" data-action="chat-create">Start group</button>
    </main>`;
  };

  App.screens['chat-thread'] = () => {
    const g = view.groups.find((x) => x.id === view.open) || { name: 'Chat' };
    const msgs = (view.chat && view.chat.messages[view.open]) || [];
    return `<main class="screen chat">
      <header class="chat-head"><button class="back" data-action="chat-back">${Icons.back}</button>
        <div class="grow"><div class="job-name">${esc(g.name)}</div><div class="e2e small">${Icons.lock} Locked end to end</div></div></header>
      <div class="bubbles" id="bubbles">${msgs.map((m) => `<div class="bubble ${m.from === state.me.id ? 'mine' : ''}">
          ${m.from === state.me.id ? '' : `<b>${esc(nameOf(m.from))}</b>`}<span>${esc(m.text)}</span><small>${time(m.at)}</small></div>`).join('')
        || '<p class="muted center">Say something to the group.</p>'}</div>
      <form class="composer" data-chat-form><input id="chat-text" placeholder="Message" autocomplete="off" enterkeyhint="send">
        <button class="btn primary sm" type="submit" aria-label="Send">${Icons.send}</button></form>
    </main>`;
  };

  Object.assign(App.handlers, {
    'chat-open': async (el) => {
      view.open = el.dataset.id;
      const c = await local();
      c.read[view.open] = Date.now();
      await kv.set('chat', c);
      view.chat = c;
      App.setScreen('chat-thread');
    },
    'chat-back': () => (App.isBoss() ? (state.bossTab = 'chat', App.setScreen('boss')) : App.setScreen('chat-list')),
    'chat-new': () => { view.picking = []; App.setScreen('chat-new'); },
    'chat-create': async () => {
      const name = (document.getElementById('chat-name').value || '').trim() || 'Crew';
      const ids = [...document.querySelectorAll('.pick input:checked')].map((i) => i.value);
      if (!ids.length) return toast('Pick at least one person');
      try {
        const r = await createGroup(name, ids);
        if (r.notReady.length) toast(`${r.notReady.map(nameOf).join(', ')} need to open Messages once, then add them.`);
        await refresh();
        view.open = r.id;
        App.setScreen('chat-thread');
      } catch (e) {
        toast(e.offline ? 'Need signal to start a group' : e.message);
      }
    },
  });

  document.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-chat-form]')) return;
    e.preventDefault();
    const input = document.getElementById('chat-text');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await send(view.open, text);
      view.chat = await local();
      App.render();
      const again = document.getElementById('chat-text');
      if (again) again.focus();
    } catch (err) {
      input.value = text;
      toast(err.offline ? 'No signal. Try again when you have a bar.' : "Couldn't send. Try again.");
    }
  });

  // Poll while a chat screen is open; refresh unread badges elsewhere.
  let timer = null;
  function onChatScreen() { return ['chat-list', 'chat-thread'].includes(state.screen) || (state.screen === 'boss' && state.bossTab === 'chat'); }
  async function tick(force) {
    if (!state.me || (!onChatScreen() && !force)) return;
    const before = JSON.stringify(view.chat && view.chat.messages);
    await refresh();
    if (onChatScreen() && JSON.stringify(view.chat && view.chat.messages) !== before) App.render();
    if (onChatScreen() && !view.groups.length) App.render();
    if (state.screen === 'chat-thread' && view.open) {
      const c = await local();
      c.read[view.open] = Date.now();
      await kv.set('chat', c);
    }
    paintBadges();
  }
  function paintBadges() {
    const n = view.groups.reduce((a, g) => a + unread(g.id), 0);
    document.querySelectorAll('[data-unread]').forEach((el) => { el.textContent = n ? String(n) : ''; el.classList.toggle('on', !!n); });
  }

  function afterRender() {
    clearInterval(timer);
    if (!state.me) return;
    if (view.owner !== state.me.id) Object.assign(view, { owner: state.me.id, groups: [], chat: null, open: null, error: null });
    paintBadges();
    const b = document.getElementById('bubbles');
    if (b) b.scrollTop = b.scrollHeight;
    if (onChatScreen()) {
      if (!view.chat) tick(true).then(() => App.render());
      timer = setInterval(tick, cfg.chatPollMs || 8000);
    }
  }

  // Get ready in the background so teammates can add this person to groups.
  setTimeout(() => { if (state.me && navigator.onLine !== false) tick(true).catch(() => {}); }, 3000);

  // Demo reset: stop polling and never save the old chat store again before the page reloads.
  function stop() { stopped = true; clearInterval(timer); }

  root.Messenger = { listHtml, afterRender, sync, send, createGroup, refresh, stop };
  if (state.screen) App.render(); // first paint happened before chat was loaded
})(self);
