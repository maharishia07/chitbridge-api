'use strict';
/**
 * e2e/bare-return-lint.cjs — A BARE `return;` AT THE TOP OF A TEST BODY IS COUNTED AS A PASS (QA-69).
 *
 * Shape 1 of C:/dev/test-conflict.cjs (SELF-EXCUSING): the precondition is missing, the test returns, the runner
 * records a pass. The suite is green exactly when it could not check anything.
 *
 * THE RULE: inside a t()/it()/test() body, a statement `return;` (bare, no value) that is reached BEFORE the
 * first assertion/check is an excuse. Helpers that return a value are not flagged; a bare return after real
 * assertions is not flagged.
 *
 * ⭐ BASELINE AT TODAY'S COUNT, A RATCHET THAT MAY ONLY GO DOWN (19 Oct 2026). The count below was measured on
 * main that day; no test was edited to reach it. It FAILS when the count rises, and it FAILS when the count
 * falls without the number being lowered here, so the debt can only shrink. Reason it is not zero: the existing
 * hits are listed in C:/dev/test-conflict.cjs and each needs its own owner to decide "fail" or "skip loudly".
 *
 * Run: node e2e/bare-return-lint.cjs [dir ...]   (default: e2e/ here; pass ../chitbridge-api/tests to lint the api)
 * Self-test: node e2e/bare-return-lint.cjs --selftest   (fires on a fixture, passes on a clean one)
 */
const fs = require('fs');
const path = require('path');

/* measured 19 Oct 2026 on main: e2e/ here, tests/ in the api. Lower only. */
const BASE = { e2e: 1, tests: 10 };

function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** findings in one source text: [{ line, snippet }] */
function scan(src) {
  const c = strip(src);
  const out = [];
  /* a test case is a STATEMENT: t('..', / it('..', / test('..', at the start of a line */
  const tRe = /^[ \t]*(?:t|it|test)\s*\(\s*['`"]/gm;
  let tm;
  while ((tm = tRe.exec(c))) {
    /* walk the callback: depth 1 = directly inside it (a nested function's return is not the case's return) */
    let depth = 0, started = false, end = Math.min(c.length, tm.index + 4000);
    const returns = [];
    for (let i = tm.index; i < end; i++) {
      const ch = c[i];
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; if (started && depth <= 0) { end = i; break; } }
      else if (started && depth === 1 && ch === 'r' && /^return\s*;/.test(c.slice(i, i + 12)) && !/[\w$.]/.test(c[i - 1])) returns.push(i);
    }
    if (!returns.length) continue;
    const body = c.slice(tm.index, end);
    const r = returns[0] - tm.index;
    /* an assertion/check before the return means the case already risked something */
    if (/\b(assert[.\w]*|expect|ok|check|eq|fail)\s*\(/.test(body.slice(0, r))) continue;
    out.push({ line: c.slice(0, returns[0]).split('\n').length, snippet: body.slice(Math.max(0, r - 50), r + 8).replace(/\s+/g, ' ') });
  }
  return out;
}

function files(dirs) {
  const o = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (/\.(cjs|js)$/.test(f)) o.push(path.join(d, f));
  }
  return o;
}

if (process.argv.includes('--selftest')) {
  const bad = "test('x', () => {\n  if (!fs.existsSync(p)) return;\n  assert.ok(1);\n});\n";
  const good = "test('x', () => {\n  assert.ok(1);\n  if (!z) return;\n});\nfunction h(){ return; }\n";
  const a = scan(bad).length, b = scan(good).length;
  console.log('selftest: bad fixture ->', a, 'finding(s); clean fixture ->', b);
  process.exit(a === 1 && b === 0 ? 0 : 1);
}

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASELINE = BASE[path.basename(path.resolve(dirs[0] || __dirname))];
if (BASELINE === undefined) { console.error('no baseline for that directory'); process.exit(2); }
const targets = files(dirs.length ? dirs : [__dirname]);
const hits = [];
for (const f of targets) for (const x of scan(fs.readFileSync(f, 'utf8'))) hits.push(path.basename(f) + ':' + x.line + '  ' + x.snippet);
console.log('\n— a test body that returns before it checks anything counts as a pass —\n');
console.log('  scanned ' + targets.length + ' file(s), ' + hits.length + ' bare early return(s); baseline ' + BASELINE);
hits.slice(0, 30).forEach((h) => console.log('      ' + h));
{
  if (hits.length > BASELINE) { console.log('\n  ✗ the count ROSE above the baseline — fail the case loudly, or skip it with a printed reason\n'); process.exit(1); }
  if (hits.length < BASELINE) { console.log('\n  ✗ the count FELL — lower BASELINE in this file to ' + hits.length + ' so it cannot creep back\n'); process.exit(1); }
}
console.log('\n  ✓ at the baseline\n');
