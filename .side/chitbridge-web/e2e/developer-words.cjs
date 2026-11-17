'use strict';
// @type: static
/**
 * e2e/developer-words.cjs — NO BUILD CODE, MIGRATION NAME OR WORKSHOP SENTENCE ON A CUSTOMER SCREEN (UX-98 · UX-99 · UX-100).
 *
 * A shopkeeper reads "(b205)", "run migration b104", "?bridge=YOUR_BRIDGE_ID", "(mock) sent", "Start a message from Chits in the app" as noise or as a
 * door to the workshop. This reads every customer page and small-app file (no browser) and fails on a quoted string that carries one. The guard proves
 * itself: it plants each pattern in a copy and must fail on all of them, every run.
 * Left out until their readability debt is paid (module header, CARD line, test minimums: a sweep PR cannot pay it): cap-intake.js, cap-register.js, cap-worklist.js, cart-design.html, supplier-design.html, embed.html, intake.html. Left out on purpose: app.html (the workshop), cap-legend.js and cap-standards.js and assets.js (registers whose job is to name the code), comments.
 *
 * Run: node e2e/developer-words.cjs        exit 1 on a finding
 */
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const SKIP = new Set(['app.html', 'app/cap-legend.js', 'app/cap-standards.js', 'app/assets.js', 'app/test-menu-tree.js', 'app/cap-intake.js', 'app/cap-register.js', 'app/cap-worklist.js', 'cart-design.html', 'supplier-design.html', 'embed.html', 'intake.html', 'app/cap-testing.js', 'testing.html', 'design-mock.html', 'till.html']);
const BAD = [
  [/\(b\d{3}\)/, 'a build code in brackets'],
  [/migration b\d{2,3}/i, 'a migration name'],
  [/YOUR_BRIDGE_ID/, 'a placeholder id for a developer'],
  [/\(mock\)/, 'the word (mock) in a message'],
  [/from Chits in the app/, 'a sentence that sends the shopkeeper to the workshop'],
  [/gather them in Trade-ready/, 'a sentence that sends the shopkeeper to the workshop'],
];

/** every finding in one source text: [{ line, why, text }] — a comment line is not a screen */
function scan(src) {
  const out = [];
  src.split(/\r?\n/).forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*|<!--)/.test(ln)) return;
    const quoted = ln.match(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`|>[^<\n]*</g) || [];
    for (const piece of quoted) for (const [re, why] of BAD) if (re.test(piece)) out.push({ line: i + 1, why, text: piece.slice(0, 90) });
  });
  return out;
}

function files(dir, rel) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) return /^(vendor|engine|data|illustrations|png)$/.test(e.name) ? [] : files(path.join(dir, e.name), r);
    return /\.(js|html)$/.test(e.name) && !SKIP.has(r) ? [r] : [];
  });
}

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  XX  ') + m); if (!c) fail++; };
for (const f of files(PUB, '')) {
  const found = scan(fs.readFileSync(path.join(PUB, f), 'utf8'));
  if (found.length) { ok(false, f + ': ' + found.length + ' developer word(s)'); found.slice(0, 5).forEach((x) => console.log('        line ' + x.line + ' · ' + x.why + ' · ' + x.text)); }
}
ok(scan(["tx('Groups need a step (b205).')", "toast('run migration b104')", "'Add ?bridge=YOUR_BRIDGE_ID'", "alert('(mock) sent')", "tx('Start a message from Chits in the app.')", "'gather them in Trade-ready'"].join('\n')).length === 6, 'the guard catches all six planted patterns');
ok(scan("// tx('Groups need a step (b205).')\n * (b205) in a comment").length === 0, 'a comment is not a screen');
console.log('\n  ' + (fail ? 'FAILED' : 'developer-words: PASS'));
process.exit(fail ? 1 : 0);
