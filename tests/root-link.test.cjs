'use strict';
/**
 * ── tests/root-link.test.cjs · THE VALUES rootlink WRITES MUST BE VALUES THE DATABASE ACCEPTS ───────────────────
 *
 * ⚠️⚠️ WRITTEN BECAUSE I SHIPPED THE OPPOSITE, 2026-09-14.
 *
 * lib/rootlink.js went to production writing `added_via = 'system'` and `supply_kind = 'service'`. Three CHECK
 * constraints refuse both. Every registration for an hour hit them, and NOBODY NOTICED — because rootlink is
 * deliberately best-effort (logged at warn, never breaks a signup), which is right, and which is precisely what
 * let a completely non-functional feature look healthy.
 *
 * ⭐ I had checked the UNIQUE indexes, so `ON CONFLICT` would work. I never looked at the CHECKs. This guard is
 * the thing that would have caught it in a second: take the literals the code writes, take the vocabularies the
 * migrations declare, and assert the first is a subset of the second.
 *
 * ⚠️ It reads the MIGRATIONS, not the live database, so it runs offline in the guard suite. That means it proves
 * "the code agrees with what we intend the schema to be" — the day someone changes a constraint by hand in the
 * SQL editor without a migration, this passes and production still fails. That is a known limit and the right
 * trade for a guard that must run on every commit.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');


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

let pass = 0;
const it = (what, fn) => {
  try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
};

/** every quoted literal inside `CHECK (<col> ... ARRAY[...])` for one column, across all migrations */
function allowedFor(table, col) {
  const found = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'migrations')).sort()) {
    if (!f.endsWith('.sql')) continue;
    const sql = read(path.join('migrations', f)).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    /* ⚠️ TWO SPELLINGS, BOTH LIVE IN THIS FOLDER. b216 writes `CHECK (supply_kind IN ('resale','own_use'))`
       while the baseline and b159 write `= ANY (ARRAY[...])`. A parser that knew only one reported "no CHECK
       found" for a constraint that plainly exists — which reads as "unconstrained" and is the more dangerous
       way to be wrong. Accept both. */
    const re = new RegExp(
      table + '_' + col + '_(?:check|chk)[\\s\\S]{0,400}?(?:ARRAY\\[([^\\]]*)\\]|IN\\s*\\(([^)]*)\\))', 'g');
    let m;
    while ((m = re.exec(sql))) {
      /* a LATER migration supersedes an earlier one — b159 replaces the baseline's list */
      found.clear();
      for (const q of (m[1] || m[2] || '').match(/'([a-z_]+)'/g) || []) found.add(q.replace(/'/g, ''));
    }
  }
  return found;
}

/** what rootlink actually writes for one column, read out of its INSERT */
function writes(sqlText, cols, col) {
  const i = cols.indexOf(col);
  const vals = (sqlText.match(/VALUES \(([^)]*)\)/) || [])[1] || '';
  const parts = vals.split(',').map((s) => s.trim());
  const v = parts[i] || '';
  return /^'/.test(v) ? v.replace(/'/g, '') : null;   // null = a bind parameter, nothing static to check
}

console.log('— rootlink writes values the database accepts —');

const SRC = read('lib/rootlink.js');

it('customer_list: added_via and customer_type are in the allowed lists', () => {
  const stmt = (SRC.match(/INSERT INTO customer_list \(([^)]*)\)[\s\S]*?ON CONFLICT/) || []);
  assert.ok(stmt[1], 'no customer_list INSERT found in lib/rootlink.js');
  const cols = stmt[1].split(',').map((s) => s.trim());
  for (const col of ['added_via', 'customer_type']) {
    const wrote = writes(stmt[0], cols, col);
    if (wrote === null) continue;
    const ok = allowedFor('customer_list', col);
    assert.ok(ok.size > 0, 'no CHECK found for customer_list.' + col + ' — has the constraint been renamed?');
    assert.ok(ok.has(wrote),
      "customer_list." + col + " = '" + wrote + "' but the CHECK allows " + JSON.stringify([...ok])
      + '. This is the b158 failure: the write is refused, rootlink swallows it at warn, and the connection '
      + 'silently never happens.');
  }
});

it('supplier_list: added_via and supply_kind are in the allowed lists', () => {
  const stmt = (SRC.match(/INSERT INTO supplier_list \(([^)]*)\)[\s\S]*?ON CONFLICT/) || []);
  assert.ok(stmt[1], 'no supplier_list INSERT found in lib/rootlink.js');
  const cols = stmt[1].split(',').map((s) => s.trim());
  for (const col of ['added_via', 'supply_kind']) {
    const wrote = writes(stmt[0], cols, col);
    if (wrote === null) continue;
    const ok = allowedFor('supplier_list', col);
    assert.ok(ok.size > 0, 'no CHECK found for supplier_list.' + col + ' — has the constraint been renamed?');
    assert.ok(ok.has(wrote),
      "supplier_list." + col + " = '" + wrote + "' but the CHECK allows " + JSON.stringify([...ok]) + '.');
  }
});

it("'system' is a declared provenance, not a value someone hoped would work", () => {
  for (const t of ['customer_list', 'supplier_list']) {
    assert.ok(allowedFor(t, 'added_via').has('system'),
      t + ".added_via does not allow 'system'. Two unbuilt things depend on that mark being writable: the "
      + 'supplier screen refusing to delete the link, and the supplier quota excluding it.');
  }
});

it('b158 and rootlink write the SAME values — the backfill and the live path must not diverge', () => {
  const m = migration('_root_backfill.sql');
  for (const v of ['own_use', 'system']) {
    assert.ok(m.indexOf("'" + v + "'") >= 0 && SRC.indexOf("'" + v + "'") >= 0,
      "'" + v + "' appears in one of b158 / rootlink.js but not the other. A shop connected by the backfill "
      + 'would then look different from one connected at its mint.');
  }
});

console.log('  ' + pass + ' checks');
