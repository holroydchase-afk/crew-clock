#!/usr/bin/env node
// ux-shots: the ux-reviewer's visual pass as one command. Screenshots a page at phone (390x844)
// and laptop (1280x800) width, light and dark, viewport and full page, and reports what a person
// would see go wrong: console errors, failed requests, broken images, sideways scroll, small tap
// targets and unfinished text. Run it on a local build or a demo with sample data, never live data.
//
// Usage: node scripts/ux-shots.mjs <url or file.html> [options]
//   --out DIR          where screenshots and report go (default dist/ux-shots)
//   --click SELECTOR   also shoot the page after clicking each element SELECTOR matches,
//                      e.g. --click "[role=tab]" for a tabbed app (repeatable)
//   --path PATH        another page under the same site, e.g. --path /about (repeatable)
//   --wait SELECTOR    wait for this element before shooting (default body)
//   --settle MS        wait this long after a click before shooting (default 150), for scans and other timed results
//   --tap N            smallest tap target height in px on phones (default 44)
//   --no-network       block and report every request that leaves the page's own origin (any
//                      http request for a file target): the privacy gate for local-only apps
//   --strict           exit 1 when any issue is found (for CI)
// Writes report.json and report.md to --out. Needs Playwright with Chromium.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SIZES = [["phone", 390, 844], ["laptop", 1280, 800]];
export const SCHEMES = ["light", "dark"];

export function parseArgs(argv) {
  const o = { target: null, out: "dist/ux-shots", clicks: [], paths: [], wait: "body", tap: 44, settle: 150, strict: false, noNetwork: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--out") o.out = next();
    else if (a === "--click") o.clicks.push(next());
    else if (a === "--path") o.paths.push(next());
    else if (a === "--wait") o.wait = next();
    else if (a === "--tap") o.tap = Number(next());
    else if (a === "--settle") { o.settle = Number(next()); if (!(o.settle >= 0 && o.settle <= 10000)) throw new Error("--settle must be 0 to 10000 (ms)"); }
    else if (a === "--strict") o.strict = true;
    else if (a === "--no-network") o.noNetwork = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (!o.target) o.target = a;
    else throw new Error(`one target only (got ${o.target} and ${a})`);
  }
  if (!o.help && !o.target) throw new Error("usage: ux-shots.mjs <url or file.html> [--out DIR] [--click SEL] [--path PATH] [--wait SEL] [--tap N] [--no-network] [--strict]");
  if (!Number.isFinite(o.tap) || o.tap <= 0) throw new Error("--tap must be a positive number");
  return o;
}

/** "https://x.dev/app/" + "/about" -> https://x.dev/about; a file path becomes a file:// URL. */
export function pageUrls(target, paths = []) {
  const base = /^[a-z]+:\/\//i.test(target) ? target : pathToFileURL(resolve(target)).href;
  return [["home", base], ...paths.map((p) => [slug(p) || "page", new URL(p, base).href])];
}

/** True when a request leaves the page: another origin, or any network URL from a file:// page. */
export function isOutside(requestUrl, pageUrl) {
  const req = new URL(requestUrl), from = new URL(pageUrl);
  if (!/^(https?|wss?):$/.test(req.protocol)) return false; // file:, data:, blob: stay on the device
  return from.protocol === "file:" || req.origin !== from.origin;
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function loadPlaywright() {
  // The product repo's own copy first, then a global install (NODE_PATH).
  for (const from of [join(process.cwd(), "package.json"), import.meta.url]) {
    try { return createRequire(from)("playwright"); } catch {}
  }
  throw new Error("Playwright isn't installed. Run: npm i -D playwright && npx playwright install chromium");
}

// Runs in the page: what a person would notice. Kept free of outside variables.
function inspect(tap) {
  const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
  const phone = innerWidth < 600;
  const small = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]")]
    .filter(visible)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24 || (phone && r.height < tap)))
    .map(({ el, r }) => `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && visible(i)).map((i) => i.currentSrc || i.src);
  const text = document.body ? document.body.innerText : "";
  const unfinished = text.match(/\b(TODO|TBD|FIXME|lorem ipsum|coming soon|placeholder|undefined|NaN)\b|\{\{[^}]*\}\}/gi) || [];
  const deadLinks = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => /^(#?$|javascript:)|example\.(com|org|net)/i.test(h.trim()));
  return {
    sideways: document.documentElement.scrollWidth > innerWidth + 1 ? `page is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px window` : null,
    smallTargets: [...new Set(small)],
    brokenImages: [...new Set(broken)],
    unfinished: [...new Set(unfinished)],
    deadLinks: [...new Set(deadLinks)],
  };
}

export const issueCount = (r) => (r.sideways ? 1 : 0) + r.smallTargets.length + r.brokenImages.length + r.unfinished.length + r.deadLinks.length + r.consoleErrors.length + r.failedRequests.length + (r.outsideRequests?.length || 0);

export function markdown(report, target) {
  const lines = [`# ux-shots: ${target}`, "", `${report.length} shots, ${report.filter((r) => issueCount(r)).length} with issues.`,
    "Measured, not judged: a link inside a sentence is exempt from the 24px target rule (WCAG 2.5.8), and a word like \"placeholder\" can be fine in context. Open the screenshots before calling anything a defect.", ""];
  for (const r of report) {
    const n = issueCount(r);
    lines.push(`## ${r.name}: ${n ? `${n} issue${n > 1 ? "s" : ""}` : "clean"}`, "", `Screens: \`${r.shot}\`, \`${r.full}\``);
    const add = (title, items) => { if (items.length) lines.push(`- ${title}: ${items.map((x) => `\`${x}\``).join(", ")}`); };
    if (r.sideways) lines.push(`- Sideways scroll: ${r.sideways}`);
    add("Small tap targets", r.smallTargets);
    add("Broken images", r.brokenImages);
    add("Unfinished text", r.unfinished);
    add("Dead or sample links", r.deadLinks);
    add("Console errors", r.consoleErrors);
    add("Failed requests", r.failedRequests);
    add("Requests that left the page (blocked)", r.outsideRequests || []);
    lines.push("");
  }
  return lines.join("\n");
}

export async function run(o) {
  const { chromium } = loadPlaywright();
  mkdirSync(o.out, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const [pageName, url] of pageUrls(o.target, o.paths)) {
      for (const [size, width, height] of SIZES) {
        for (const scheme of SCHEMES) {
          const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
          const consoleErrors = [], failedRequests = [], outsideRequests = [];
          if (o.noNetwork) {
            await page.route("**/*", (route) => {
              const u = route.request().url();
              if (!isOutside(u, url)) return route.continue();
              outsideRequests.push(u);
              return route.abort("blockedbyclient");
            });
          }
          page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));
          page.on("console", (m) => {
            if (m.type() !== "error") return;
            if (o.noNetwork && /ERR_BLOCKED_BY_CLIENT/.test(m.text())) return; // our own block, already listed
            consoleErrors.push(m.text());
          });
          page.on("requestfailed", (r) => { if (!outsideRequests.includes(r.url())) failedRequests.push(`${r.url()} (${r.failure()?.errorText || "failed"})`); });
          page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.url()} (${r.status()})`); });
          await page.goto(url, { waitUntil: "load" });
          await page.waitForSelector(o.wait);
          await page.evaluate(() => document.fonts && document.fonts.ready);
          const shoot = async (name) => {
            await page.mouse.move(0, 0);
            await page.waitForTimeout(o.settle);
            const shot = join(o.out, `${name}.png`), full = join(o.out, `${name}-full.png`);
            await page.screenshot({ path: shot });
            await page.screenshot({ path: full, fullPage: true });
            report.push({ name, url, size, scheme, shot, full, ...(await page.evaluate(inspect, o.tap)),
              consoleErrors: [...new Set(consoleErrors.splice(0))], failedRequests: [...new Set(failedRequests.splice(0))],
              outsideRequests: [...new Set(outsideRequests.splice(0))] });
          };
          await shoot(`${pageName}-${size}-${scheme}`);
          for (const sel of o.clicks) {
            const count = await page.locator(sel).count();
            for (let i = 0; i < count; i++) {
              const el = page.locator(sel).nth(i);
              if (!(await el.isVisible())) continue;
              const what = slug((await el.getAttribute("aria-label")) || (await el.textContent()) || `${i + 1}`) || `${i + 1}`;
              await el.click();
              await shoot(`${pageName}-${slug(sel)}-${what}-${size}-${scheme}`);
            }
          }
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(o.out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(o.out, "report.md"), markdown(report, o.target));
  return report;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.help) { console.log("usage: ux-shots.mjs <url or file.html> [--out DIR] [--click SEL] [--path PATH] [--wait SEL] [--tap N] [--no-network] [--strict]"); process.exit(0); }
  if (!/^[a-z]+:\/\//i.test(o.target) && !existsSync(o.target)) { console.error(`no such file: ${o.target}`); process.exit(2); }
  try {
    const report = await run(o);
    const withIssues = report.filter((r) => issueCount(r));
    console.log(`${report.length} shots in ${o.out}, ${withIssues.length} with issues. Details: ${join(o.out, "report.md")}`);
    if (o.strict && withIssues.length) process.exit(1);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
