// A phone that opened an older deploy must get the new one after a redeploy. GitHub Pages sends
// Cache-Control: max-age=600, and the service worker used to fill its new cache through the
// browser's HTTP cache, so a new version could be saved with the old files inside it and the
// demo stayed on the old build (old boss name, old pins). Self-contained: builds the demo twice
// into a temp folder and serves it on :8197 with Pages-like headers.
//   node tests/e2e-update.js
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-update-'));
const OLD = path.join(tmp, 'old');
const NEW = path.join(tmp, 'new');
const PORT = 8197;
const URL = `http://localhost:${PORT}/crew-clock/`;
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function build(out) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site.mjs'), path.join(out, 'crew-clock'), '--demo'], { cwd: ROOT, stdio: 'ignore' });
}

// The "old deploy": the same app with a different boss name and storage key, so it has its own
// app version and anything served from it is easy to spot.
build(OLD);
const oldBackend = path.join(OLD, 'crew-clock/js/demo-backend.js');
fs.writeFileSync(oldBackend, fs.readFileSync(oldBackend, 'utf8').replace("'Sam W.'", "'Old Boss'").replace(/cc\.demo\.db\.v\d+/, 'cc.demo.db.old'));
const oldSw = path.join(OLD, 'crew-clock/sw.js');
fs.writeFileSync(oldSw, fs.readFileSync(oldSw, 'utf8').replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-old'"));
build(NEW);

let root = OLD;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
    res.end(body);
  });
});

async function boss(page) {
  await page.waitForSelector('text=Ray T.');
  const text = await page.evaluate(() => document.body.innerText);
  return text.includes('Old Boss') ? 'old' : text.includes('Sam W.') ? 'new' : 'neither';
}

(async () => {
  await new Promise((ok) => server.listen(PORT, ok));
  const browser = await launch();
  let failed = false;
  try {
    // No page.route here: Playwright turns the HTTP cache off while routing, and that cache is the bug.
    const page = await (await browser.newContext()).newPage();

    await page.goto(URL);
    await page.waitForFunction(() => navigator.serviceWorker.controller || false, null, { timeout: 15000 }).catch(() => {});
    await page.reload();
    assert.strictEqual(await boss(page), 'old', 'the old deploy is what the phone has first');

    root = NEW; // redeploy
    // A phone opens the app twice after a deploy at most before it is on the new one.
    await page.reload();
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForTimeout(1000);
    assert.strictEqual(await boss(page), 'new', 'after a redeploy, reopening the demo shows the new build');
    console.log('update: a phone on an old deploy picks up the new one');
  } catch (e) {
    failed = true;
    console.error('update FAILED:', e.message);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
})();
