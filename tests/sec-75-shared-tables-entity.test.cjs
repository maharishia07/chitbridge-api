'use strict';
/**
 * tests/sec-75-shared-tables-entity.test.cjs — SEC-75 + DB-103 (b855): the six shared tables b855 locks are written (and, for the either-side tables, read) only on a client bound to a shop.
 * Offline: reads the migration and the source; no database.
 * CARD 28-platform-and-operations/rls-census
 *
 * OWNS       three rules. (1) b855 ENABLEs and FORCEs RLS on each of the six and carries the policies each shape needs: a policy removed from the file turns this red (break test).
 *            (2) no statement that writes catalogue_source, product_container or media_blobs, or touches connections, connector_connection or dispute_participants,
 *            runs on a bare db()/query() call: it sits in withEntity / queryAsShop / withKeyOwner. (3) the checker itself catches a bare statement (red specimen).
 * CALLED BY  scripts/guards.cjs. The database proof (two shops + a stranger, as cb_app) is checkSharedTables in tests/rls-fresh-db.test.cjs, run in CI's fresh-db job.
 * FLOW       migrations/b855 → audit(sql) → problems · lib/ routes/ middleware/ → each statement naming a table → a binder within the lines above it
 */
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0,
  fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.error('  ✗ ' + name + (extra ? '   ' + extra : ''));
  }
};

/** the policies each table must carry in b855 (name → the command it covers) */
const NEEDS = {
  connections: ['connections_read_either_side', 'connections_insert_sender', 'connections_respond_receiver'],
  connector_connection: ['rls_entity', 'connector_connection_read_counterparty'],
  dispute_participants: ['rls_entity'],
  catalogue_source: ['read_all', 'rls_entity', 'catalogue_source_claim_unowned'],
  product_container: ['product_container_read_all', 'rls_entity', 'product_container_claim_unowned'],
  media_blobs: ['media_blobs_read_all', 'rls_entity']
};

/** audit(sql) → the problems found in a copy of the migration text */
function audit(sql) {
  const bad = [];
  Object.keys(NEEDS).forEach((table) => {
    ['ENABLE', 'FORCE'].forEach((verb) => {
      if (!new RegExp('ALTER TABLE ' + table + ' ' + verb + ' ROW LEVEL SECURITY;').test(sql)) bad.push(table + ' lacks ' + verb);
    });
    NEEDS[table].forEach((policy) => {
      if (!new RegExp('CREATE POLICY ' + policy + ' ON ' + table + '\\b').test(sql)) bad.push(table + ' lacks policy ' + policy);
    });
  });
  /* a write-own policy must carry WITH CHECK on the shop key (a USING-only policy lets a row be moved to another shop) */
  ['rls_entity'].forEach(() => {
    const own = sql.match(/CREATE POLICY rls_entity ON (\w+)\s+USING[\s\S]*?;/g) || [];
    own.forEach((stmt) => {
      if (!/WITH CHECK/.test(stmt)) bad.push(stmt.split(/\s+/)[4] + ' rls_entity has no WITH CHECK');
    });
  });
  return bad;
}

const sql = fs.readFileSync(path.join(ROOT, 'migrations', 'b855_rls_shared_tables_sec75_db103.sql'), 'utf8');
check('b855 ENABLEs, FORCEs and carries every policy for the six tables', audit(sql).length === 0, audit(sql).join(' · '));

/* break test: take each policy out of the text, and each FORCE, and the audit must go red */
let survived = [];
Object.keys(NEEDS).forEach((table) => {
  NEEDS[table].forEach((policy) => {
    const cut = sql.replace(new RegExp('CREATE POLICY ' + policy + ' ON ' + table + '\\b', 'g'), 'CREATE POLICY removed ON ' + table);
    if (audit(cut).length === 0) survived.push(table + '/' + policy);
  });
  const unforced = sql.replace('ALTER TABLE ' + table + ' FORCE ROW LEVEL SECURITY;', '');
  if (audit(unforced).length === 0) survived.push(table + '/FORCE');
});
check('break test: removing any one policy or FORCE from b855 turns the audit red', survived.length === 0, survived.join(', '));
check(
  'break test: a rls_entity with no WITH CHECK turns the audit red',
  audit(sql.replace(/(CREATE POLICY rls_entity ON media_blobs\s+USING[^;]*?)\s+WITH CHECK[^;]*;/, '$1;')).length > 0
);

/* the one source rule: a statement on these tables is bound to a shop */
const WRITE_ONLY = ['catalogue_source', 'product_container', 'media_blobs']; /* read-wide: only a write needs the binding */
const ANY = ['connections', 'connector_connection', 'dispute_participants']; /* either-side / own: a read needs it too */
const SQL_ANY = new RegExp('(?:FROM|JOIN|INTO|UPDATE)\\s+(?:' + ANY.join('|') + ')\\b');
const SQL_WRITE = new RegExp('(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:' + WRITE_ONLY.join('|') + ')\\b');
const BOUND = /withEntity\(|\bqueryAsShop\(|withKeyOwner\(|async function \w+\(client/;
/** files whose statements reach the database through readBatch(entity, …), which binds the shop itself */
const BINDS_ITSELF = ['lib/sides.js'];

function unbound(file, text) {
  const lines = text.split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (!SQL_ANY.test(line) && !SQL_WRITE.test(line)) return;
    for (let j = i; j >= Math.max(0, i - 8); j--) if (BOUND.test(lines[j])) return;
    bad.push(file + ':' + (i + 1));
  });
  return bad;
}

const files = [];
['lib', 'routes', 'middleware'].forEach((dir) => {
  const walk = (d) =>
    fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.js$/.test(e.name) && BINDS_ITSELF.indexOf(rel) < 0) files.push(rel);
    });
  walk(dir);
});
const bad = files.flatMap((f) => unbound(f, fs.readFileSync(path.join(ROOT, f), 'utf8')));
check('every statement on the six tables runs bound to a shop (' + files.length + ' files scanned)', bad.length === 0, bad.join(', '));

/* red specimens: the checker itself catches a bare statement */
check('the checker flags a bare write to catalogue_source', unbound('x.js', 'await query(`UPDATE catalogue_source SET items = $1`, [a]);').length === 1);
check('the checker flags a bare read of connections', unbound('x.js', 'const r = await db(`SELECT * FROM connections WHERE connection_id = $1`, [a]);').length === 1);
check('the checker accepts a bound write', unbound('x.js', 'await queryAsShop(shop, `UPDATE connector_connection SET enabled = $1`, [a]);').length === 0);

console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
