// Finds Playwright and Chromium both in CI (npm install) and in the build sandbox.
let pw;
// The sandbox path is a variable so tsc doesn't try to resolve it on machines that lack it (CI).
const sandboxPlaywright = '/opt/node22/lib/node_modules/playwright';
try { pw = require('playwright'); } catch (e) { pw = require(sandboxPlaywright); }
const fs = require('fs');
const sandbox = process.env.PW_HEADLESS_SHELL ? '' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
module.exports = {
  // PW_HEADLESS_SHELL=1 uses Playwright's headless shell, the browser CI runs
  launch: () => pw.chromium.launch(sandbox && fs.existsSync(sandbox) ? { executablePath: sandbox } : {}),
};
