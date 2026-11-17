'use strict';
/* plt-13-no-hardcoded-otp.test.cjs — PLT-13: THE LOGIN SCREEN HARDCODES NO CODE (the shipped pages carry no setDevOtp and no preset 123456).
 * OWNS      the web half of PLT-13 (done 14 Oct: both setDevOtp('123456') calls removed from LoginPage.jsx, a46a8916). LoginPage.jsx is gone; the one sign-in window is
 *           public/app/signin-ui.js (CBSignin.mount). The claim lives there now: no page script names setDevOtp / DEV_OTP, no shipped file presets a code, and the
 *           credential box the window draws carries no value= (nothing is typed for the person).
 *           NOT claimed here: re-keying the api's OTP seal off NODE_ENV (api lib/dev-otp.js; api tests/dev-otp.test.js).
 * CALLED BY .github/workflows/ci.yml (web guards) · e2e/sec-proofs.red.cjs (mutants)
 * FLOW      read public/**, index.html → scan → read the credential input block of signin-ui.js
 * Run: node e2e/plt-13-no-hardcoded-otp.test.cjs */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f, out); }
    else if (/\.(js|jsx|html|mjs|cjs)$/.test(e.name)) out.push(f);
  }
  return out;
}
const files = walk(path.join(ROOT, 'public'), []).concat([path.join(ROOT, 'index.html')]);
ok(files.length > 100, 'the scan sees the shipped pages (' + files.length + ' files), not an empty folder');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/* the ONE named exception: public/storefront-design.html is a paper mock ("not wired, not deployed, not linked"); its own self-test sets S.otp = '123456' to prove the 6-digit rule. It is not a login screen. */
const MOCK = 'public/storefront-design.html';
const devHits = [], presetHits = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  if (/\bsetDevOtp\b|\bDEV_OTP\b|\bdevOtp\b/.test(s)) devHits.push(rel(f));
  /* a preset code: the literal 123456 as a string, or value="123456" — a number such as 123456.5 or 1234567 is not one */
  if (rel(f) !== MOCK && /['"`]123456['"`]/.test(s) || /value\s*=\s*["']?123456\b(?![.\d])/.test(s)) presetHits.push(rel(f));
}
ok(devHits.length === 0, 'no shipped page names setDevOtp / DEV_OTP / devOtp' + (devHits.length ? ' — ' + devHits.join(', ') : ''));
ok(presetHits.length === 0, 'no shipped page presets the code 123456' + (presetHits.length ? ' — ' + presetHits.join(', ') : ''));

const ui = fs.readFileSync(path.join(ROOT, 'public/app/signin-ui.js'), 'utf8');
const at = ui.lastIndexOf('<input', ui.indexOf('name="cred"')); /* batch 14c: the input now opens with data-cbsid before name */
ok(at > 0, 'signin-ui.js still draws the one credential input (name="cred")');
const block = ui.slice(at, ui.indexOf('</label>', at));
ok(block.length > 40 && block.length < 600, 'the credential input block was found whole (' + block.length + ' chars)');
ok(!/\bvalue\s*=/.test(block), 'the credential box carries no value= — nothing is typed for the person');
ok(/autocomplete="one-time-code"/.test(block) && /type="password"/.test(block), 'it is the masked one-time-code box');
console.log('\n' + n + ' checks, all ok');
