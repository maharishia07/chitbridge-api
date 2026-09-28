'use strict';
/**
 * supplier-list-scope.test.cjs — ⭐⭐⭐ EVERY supplier_list STATEMENT RUNS INSIDE withEntity (H2, 2026-09-28).
 *
 * supplier_list is getting FORCE ROW LEVEL SECURITY (the customer_list pattern: owner_entity_id =
 * app.current_entity). cb_app is NOBYPASSRLS, so a statement sent through the bare pool `query(` — which sets no
 * app.current_entity — would READ NOTHING and every INSERT would fail WITH CHECK: the suppliers screen would go
 * empty, and "add a supplier" would 500. Nothing would say why. [[feedback-silence-is-the-bug]]
 *
 * ⭐ So the rule is checked in the source, statement by statement: the call that sends SQL naming supplier_list
 * must be a connection's `.query(` (db/client — the one withEntity hands out), never the bare `query(`.
 * The ONE allowed exception is named below with its reason, and the list of exceptions is itself checked, so a
 * new one cannot slip in without being written here.
 *
 * ⚠️ READS THE SOURCE, AND SAYS SO. Standing the routes up against a policy-enforcing Postgres would prove the
 * same thing at the cost of a database this machine has no copy of; the fault is visible in the text.
 *
 * Run: node tests/supplier-list-scope.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the one statement allowed on the bare pool, and why */
const ALLOWED = [
  { file: 'routes/entities.js', has: '(SELECT count(*)::int FROM supplier_list s WHERE s.owner_entity_id = i.identity_id)',
    why: 'the FALLBACK count, used only when ops.f_entity_counts() (b241) is missing or refused — the operator list reads across shops' },
];

function sources() {
  const out = [];
  ['routes', 'lib', 'middleware'].forEach((dir) => {
    const d = path.join(API, dir);
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).filter((f) => /\.(c?js)$/.test(f)).forEach((f) => out.push(dir + '/' + f));
  });
  return out;
}

/** blank block and line comments, so prose naming the table is not a statement */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

const hits = [];
sources().forEach((rel) => {
  const raw = fs.readFileSync(path.join(API, rel), 'utf8').replace(/\r\n/g, '\n');
  const src = stripComments(raw);
  const re = /\bsupplier_list\b/g;
  let m;
  while ((m = re.exec(src))) {
    /* is this inside a backtick template (SQL)? count backticks before it */
    const before = src.slice(0, m.index);
    if ((before.match(/`/g) || []).length % 2 === 0) continue;         /* not inside a template: a name, not SQL */
    /* the call that sends it: the last `query(` before the template opened */
    const tplStart = before.lastIndexOf('`');
    /* ⚠️ a long comment may sit between query( and the SQL — comments are blanked, so only whitespace remains */
    const head = src.slice(Math.max(0, tplStart - 4000), tplStart);
    const q = head.lastIndexOf('query(');
    const line = raw.slice(0, m.index).split('\n').length;
    const text = raw.split('\n')[line - 1].trim();
    const direct = q >= 0 && head.slice(q + 6).trim() === '';           /* the SQL is that call's first argument */
    const viaConn = direct && /[\w$)\]]\.query\($/.test(head.slice(0, q + 6));
    hits.push({ rel, line, text, viaConn, found: q >= 0 });
  }
});

console.log('\nEVERY supplier_list STATEMENT RUNS INSIDE withEntity\n');

it('the check is measuring something — supplier_list statements were found', () => {
  assert.ok(hits.length >= 10, 'only ' + hits.length + ' statements found — the reader is broken');
});

it('⭐⭐⭐ none runs on the bare pool query() — each goes through the connection withEntity hands out', () => {
  const bad = hits.filter((h) => !h.viaConn && !ALLOWED.some((a) => a.file === h.rel && h.text.indexOf(a.has) >= 0));
  assert.deepStrictEqual(bad.map((h) => h.rel + ':' + h.line + '  ' + h.text.slice(0, 110)), [],
    'a supplier_list statement outside withEntity — it reads nothing and cannot insert once RLS is forced');
});

it('the allowed exceptions still exist, each exactly once (a stale exception would excuse a new statement)', () => {
  ALLOWED.forEach((a) => {
    const src = fs.readFileSync(path.join(API, a.file), 'utf8');
    assert.strictEqual(src.split(a.has).length - 1, 1, a.file + ': the allowed statement is gone or doubled — ' + a.why);
  });
});

it('the operator list counts suppliers through the counting surface first (b241), the inline count only as a fallback', () => {
  const src = fs.readFileSync(path.join(API, 'routes/entities.js'), 'utf8');
  assert.ok(/ops\.f_entity_counts\(\) WHERE metric = 'suppliers'/.test(src), 'the suppliers count no longer reads ops.f_entity_counts()');
  assert.ok(/\['42883', '3F000', '42501'\]\.indexOf\(e\.code\) >= 0/.test(src), 'no fallback when the counting surface is missing');
});

console.log('\n' + pass + ' checks\n');
