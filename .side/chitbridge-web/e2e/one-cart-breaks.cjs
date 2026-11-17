/* one-cart-breaks.cjs — put a recompute back into the Task detail, run e2e/one-cart.cjs against a COPY of public/, expect it to fail.
 * Nothing in the working tree is edited. Each break must make one-cart.cjs exit non-zero with an X line. (2026-10-02, detail-reads-frozen) */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const W = path.join(__dirname, '..');
const LINES = `const L=(c.items||[]).map(it=>it[3]&&it[3].live).filter(Boolean);`;
const BREAKS = [
  ['Content tab recomputes from the lines', 'app.html', `\${frozenMoneyHTML(c, 'chit-money', 'chit-total')}`, `\${(()=>{ ${LINES} const M=CBCart.moneyFromLines(L,{ now:new Date(), currency:'INR', money:n=>n }); return CBCart.moneyRowsHTML(M,{}); })()}`],
  ['Summary tab recomputes from the lines', 'app.html', `const FM = frozenMoney(c);\n    const tile`, `${'const FM=(function(){ '}${LINES} return CBCart.moneyFromLines(L,{ now:new Date(), currency:'INR', money:n=>n }); })();\n    const tile`],
  ['Detail calls CBCart.money( on the live lines', 'app.html', `function frozenMoney(c) {`, `function frozenMoney(c) { try{ CBCart.money([],{ offers:[] }); }catch(_){}`],
  ['Order tab (cap-chit2) recomputes from the lines', 'app/cap-chit2.js', `  var hh = (d && (d.header`, `  try { CBCart.moneyFromLines(recLines, { now: new Date(), currency: 'INR', money: function(n){ return n; } }); } catch (_) {}\n  var hh = (d && (d.header`],
  ['any other reader (cap-books) recomputes', 'app/cap-books.js', `function `, `var __x = function(){ return CBCart.moneyFromLines([], {}); };\nfunction `],
];
let good = 0;
for (const [name, rel, a, b] of BREAKS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-'));
  try {
    fs.cpSync(path.join(W, 'public'), path.join(tmp, 'public'), { recursive: true });
    const f = path.join(tmp, 'public', rel), raw = fs.readFileSync(f, 'utf8'), crlf = raw.indexOf('\r\n') >= 0, s = raw.replace(/\r\n/g, '\n'), i = s.indexOf(a);
    if (i < 0) { console.log('  ??  ' + name + ': anchor not found'); continue; }
    const out = s.slice(0, i) + b + s.slice(i + a.length);
    fs.writeFileSync(f, crlf ? out.replace(/\n/g, '\r\n') : out);
    const r = cp.spawnSync(process.execPath, ['e2e/one-cart.cjs'], { cwd: W, encoding: 'utf8', env: Object.assign({}, process.env, { ONE_CART_ROOT: path.join(tmp, 'public') }) });
    const caught = r.status !== 0;
    if (caught) good++;
    console.log((caught ? '  ok  caught: ' : '  XX  NOT caught: ') + name);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log('\n  ' + good + '/' + BREAKS.length + ' breaks caught');
process.exit(good === BREAKS.length ? 0 : 1);
