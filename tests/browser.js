// Finds Playwright and Chromium both in CI (npm install) and in the build sandbox.
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const fs = require('fs');
const sandbox = process.env.PW_HEADLESS_SHELL ? '' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
module.exports = {
  // PW_HEADLESS_SHELL=1 uses Playwright's headless shell, the browser CI runs
  launch: () => pw.chromium.launch(sandbox && fs.existsSync(sandbox) ? { executablePath: sandbox } : {}),
};
