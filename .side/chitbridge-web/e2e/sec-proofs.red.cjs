'use strict';
/* sec-proofs.red.cjs — THE RED SIDE of the four security proofs (PLT-13 · SEC-5 · SEC-24 · SEC-61): break the real line, the proof must go red, put it back.
 * OWNS      the mutants: each is one exact line of shipped code changed IN PLACE; the named test is run; it must FAIL (exit != 0); the file is restored byte for byte in a
 *           finally block and re-read to prove it. A mutant that stays green is a proof that proves nothing, and this script exits 1.
 * CALLED BY .github/workflows/ci.yml (web guards; the node tests only) · by hand with --browser for the SEC-5 / PLT-13 screen mutants on a SIT box
 * FLOW      for each mutant: read file → assert `from` occurs once → write mutated → spawn the test → expect red → restore → assert restored
 * Run: node e2e/sec-proofs.red.cjs [--browser] */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let hasPw = false; try { require.resolve('@playwright/test'); hasPw = true; } catch (e) { /* CI: no browser */ }
const BROWSER = process.argv.includes('--browser') || hasPw;   /* on a SIT box (Playwright image) the screen mutants run by themselves */
const M = [
  { id: 'PLT-13', name: 'the credential box is given value="123456"', file: 'public/app/signin-ui.js', test: 'e2e/plt-13-no-hardcoded-otp.test.cjs',
    from: `' autocomplete="one-time-code" enterkeyhint="go"></label>'`, to: `' value="123456" autocomplete="one-time-code" enterkeyhint="go"></label>'` },
  { id: 'PLT-13', name: 'a setDevOtp call comes back in the sign-in window', file: 'public/app/signin-ui.js', test: 'e2e/plt-13-no-hardcoded-otp.test.cjs',
    from: `var local = !!S.local,`, to: `var _dev = typeof setDevOtp === 'function' && setDevOtp('123456'), local = !!S.local,` },
  { id: 'SEC-61', name: 'the subject cell stops escaping the code', file: 'public/app.html', test: 'e2e/sec-61-row-escaping.test.cjs',
    from: `'"><b>' +\n        esc(c.code || '—') +`, to: `'"><b>' +\n        (c.code || '—') +` },
  { id: 'SEC-61', name: 'the type cell stops escaping the kind', file: 'public/app.html', test: 'e2e/sec-61-row-escaping.test.cjs',
    from: `return esc(c.kind || '');`, to: `return (c.kind || '');` },
  { id: 'SEC-61', name: 'the from cell stops escaping the party / sender', file: 'public/app.html', test: 'e2e/sec-61-row-escaping.test.cjs',
    from: `return esc((UI.folder === 'order' ? c.party || '' : c.sender || c.party || '') || '—');`, to: `return ((UI.folder === 'order' ? c.party || '' : c.sender || c.party || '') || '—');` },
  { id: 'SEC-61', name: 'CBList cellOf stops escaping plain columns', file: 'public/app/list-ctl.js', test: 'e2e/sec-61-row-escaping.test.cjs',
    from: `return c.html ? String(v) : esc(v);`, to: `return String(v);` },
  { id: 'SEC-24', name: 'a 500 now counts as a refused key', file: 'public/till.html', test: 'e2e/sec-24-key-watch.test.cjs',
    from: `var KEY_REFUSED_STATUSES = [401, 403];`, to: `var KEY_REFUSED_STATUSES = [401, 403, 500];` },
  { id: 'SEC-24', name: 'the ten-minute gate is gone', file: 'public/till.html', test: 'e2e/sec-24-key-watch.test.cjs',
    from: `KEY_EVERY_MS = 600000;`, to: `KEY_EVERY_MS = 0;` },
  { id: 'SEC-24', name: 'any failed verify counts as a refused key', file: 'public/till.html', test: 'e2e/sec-24-key-watch.test.cjs',
    from: `var refused = !!(v && !v.ok && KEY_REFUSED_STATUSES.indexOf(Number(v.status)) >= 0);`, to: `var refused = !!(v && !v.ok);` },
  { id: 'SEC-24', name: 'the 15 s timer stops calling keyWatch', file: 'public/till.html', test: 'e2e/sec-24-key-watch.test.cjs',
    from: `watchTick(); keyWatch(); })`, to: `watchTick(); })` },
  { id: 'SEC-5', name: 'the lab strip loses the User ID method', file: 'public/signin-lab.html', test: 'e2e/sec-5-signin-lab-matrix.test.cjs', browser: true,
    from: `    ['email', 'E-mail'],\n    ['userid', 'User ID']`, to: `    ['email', 'E-mail']` },
  { id: 'SEC-5', name: 'the credential box opens pre-filled (screen)', file: 'public/app/signin-ui.js', test: 'e2e/sec-5-signin-lab-matrix.test.cjs', browser: true,
    from: `' autocomplete="one-time-code" enterkeyhint="go"></label>'`, to: `' value="123456" autocomplete="one-time-code" enterkeyhint="go"></label>'` }
];
let bad = 0, ran = 0;
for (const m of M) {
  if (m.browser && !BROWSER) { console.log('  skip  ' + m.id + ' · ' + m.name + ' (needs a browser: --browser or a SIT box)'); continue; }
  const file = path.join(ROOT, m.file), orig = fs.readFileSync(file);
  const text = orig.toString('utf8');
  const hits = text.split(m.from).length - 1;
  if (hits !== 1) { console.log('  ✗ ' + m.id + ' · ' + m.name + ' — the real line occurs ' + hits + ' times in ' + m.file + ' (must be once): the proof points at moved code'); bad++; continue; }
  let red;
  try {
    fs.writeFileSync(file, text.replace(m.from, () => m.to));
    red = spawnSync(process.execPath, [path.join(ROOT, m.test)], { cwd: ROOT, encoding: 'utf8', timeout: 280000 });
  } finally {
    fs.writeFileSync(file, orig);
  }
  const restored = Buffer.compare(fs.readFileSync(file), orig) === 0;
  ran++;
  const isRed = red.status !== 0;
  if (!isRed || !restored) bad++;
  console.log('  ' + (isRed && restored ? 'RED ok' : '✗ ') + '  ' + m.id + ' · ' + m.name + ' → ' + (isRed ? 'test failed as it must' : 'test stayed GREEN') + (restored ? '' : ' · FILE NOT RESTORED'));
}
console.log('\n' + ran + ' mutants run · ' + (bad ? '✗ ' + bad + ' problem(s)' : 'every one went red and the files are restored'));
process.exit(bad ? 1 : 0);
