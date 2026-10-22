// Finds Playwright and Chromium both in CI (npm install) and in the build sandbox.
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const fs = require('fs');
const sandbox = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
module.exports = {
  launch: () => pw.chromium.launch(fs.existsSync(sandbox) ? { executablePath: sandbox } : {}),
};
