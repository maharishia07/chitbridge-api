'use strict';
/**
 * ── tests/entity-kind.test.cjs · EVERY MINT DECLARES WHAT IT IS MAKING ──────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"we have to understand what are original, what are network entities, test entities and for
 * any other purpose?"*
 *
 * b157 added `identities.entity_kind`. The column has a DEFAULT, which is what makes this guard necessary: a new
 * mint point that forgets to declare does not fail, it quietly produces a 'customer'. One forgotten INSERT and
 * the operator's customer list fills with devices, branches or fixtures, and nobody finds out until somebody
 * counts.
 *
 * ⚠️⚠️ AND IT IS WORSE THAN A WRONG COUNT. `scripts/cleanup-test-entities.sql` is being moved onto
 * `entity_kind = 'test'` precisely so a DELETE stops depending on a guess about an email domain. That only holds
 * while the column is trustworthy — and a column with a silent default is trustworthy exactly as long as
 * everybody remembers. This guard is what replaces remembering.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * ⚠️ FIND A MIGRATION BY ITS NAME, NOT ITS NUMBER. Both these guards hard-coded b157_/b158_ and broke the
 * moment those files were renumbered to b225_/b226_ — which happened the same day, because eight of the nine
 * migrations written that day had collided with existing numbers. A number is an ordering, not an identity.
 */
function migration(suffix) {
  const dir = path.join(ROOT, 'migrations');
  const hit = fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().pop();
  if (!hit) throw new Error('no migration ending in ' + suffix + ' — was it renamed as well as renumbered?');
  return fs.readFileSync(path.join(dir, hit), 'utf8');
}

const KINDS = ['customer', 'network', 'supplier', 'test', 'internal', 'actor', 'shopper'];

let pass = 0;
const it = (what, fn) => {
  try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
};

/** ⚠️ comments blanked before scanning — four guards in this repo have fired on their own prose. */
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m) => m[0] + m.slice(1).replace(/[^\n]/g, ' '));

const files = [];
for (const dir of ['routes', 'lib']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (/\.(js|cjs)$/.test(f)) files.push(path.join(dir, f));
  }
}

console.log('— every mint declares what it is making —');

it('the migration exists and its vocabulary matches this guard', () => {
  /* ⚠️ `--` comments blanked FIRST. The CHECK is annotated line by line and those comments contain quoted
     words — "a real registered business. THE DEFAULT." sits beside 'customer', and the naive parse read the
     prose as four extra members of the vocabulary. Fifth time a guard in this repo has read its own comments;
     the difference is that this one was caught by the guard failing rather than by it passing. */
  const sql = migration('_entity_kind.sql')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  const inChk = (sql.match(/identities_entity_kind_chk CHECK \(entity_kind IN \(([\s\S]*?)\)\)/) || [])[1] || '';
  const declared = (inChk.match(/'([a-z]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  assert.deepStrictEqual(declared, KINDS.slice().sort(),
    'b157 allows ' + JSON.stringify(declared) + ' but this guard expects ' + JSON.stringify(KINDS.slice().sort())
    + '. Change both together, or the database and the code disagree about what is legal.');
});

/**
 * ⭐ THE CENTRAL ASSERTION. Every `INSERT INTO identities` must name entity_kind in its column list.
 *
 * ⚠️ It checks the COLUMN LIST, not the values: a literal in VALUES could be anything, and a bind parameter is
 *    resolved at runtime where a static guard cannot see it. Naming the column is the part that proves somebody
 *    thought about it, which is what this guard is actually for.
 */
it('every INSERT INTO identities names entity_kind', () => {
  const missing = [];
  for (const rel of files) {
    const src = blank(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    let m; const re = /INSERT\s+INTO\s+identities\b/gi;
    while ((m = re.exec(src))) {
      /* the statement runs to the closing backtick of the template literal it lives in */
      const end = src.indexOf('`', m.index);
      const stmt = src.slice(m.index, end < 0 ? m.index + 900 : end);
      if (!/\bentity_kind\b/.test(stmt)) {
        const line = src.slice(0, m.index).split('\n').length;
        missing.push('  ' + rel + ':' + line);
      }
    }
  }
  assert.deepStrictEqual(missing, [],
    'these mints do not declare entity_kind and will silently produce a \'customer\':\n' + missing.join('\n')
    + '\n      Pick one of: ' + KINDS.join(' · '));
});

it('entity_kind is never taken from the request body', () => {
  const bad = [];
  for (const rel of files) {
    const src = blank(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    /* req.body.entity_kind, body('entity_kind'), b.entity_kind — any route of client control */
    if (/(req\.body|\bb)\.entity_kind\b|body\(\s*['"]entity_kind['"]/.test(src)) bad.push('  ' + rel);
  }
  assert.deepStrictEqual(bad, [],
    'entity_kind is being read from client input in:\n' + bad.join('\n')
    + "\n      A caller that names its own kind can register as 'internal' and sit in the operator's own class, "
    + "or as 'test' and be swept by a cleanup that believes it is deleting fixtures. It is decided server-side.");
});

it("registration's surviving inference excludes domains a real business could own", () => {
  const k = require(path.join(ROOT, 'lib', 'entitykind.js'));
  for (const d of ['@x.com', '@t.com', '@gmail.com', '@outlook.com']) {
    assert.ok(k.FIXTURE_DOMAINS.indexOf(d) < 0,
      d + ' is in FIXTURE_DOMAINS. A domain a real customer could own must never mark them disposable.');
  }
  assert.strictEqual(k.atRegistration('shop@x.com'), 'customer');
  assert.strictEqual(k.atRegistration('e2e.1@test.example'), 'test');
});

it('the default is the recoverable one', () => {
  const k = require(path.join(ROOT, 'lib', 'entitykind.js'));
  for (const e of ['', null, undefined, 'someone@a-brand-new-domain.co']) {
    assert.strictEqual(k.atRegistration(e), 'customer',
      JSON.stringify(e) + " defaulted to something other than 'customer'. A fixture wrongly called a customer is "
      + 'visible and fixable; a customer wrongly called a fixture is deleted.');
  }
});

console.log('  ' + pass + ' checks');
