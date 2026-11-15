#!/usr/bin/env node
'use strict';
/**
 * scripts/repoint-firm-clients-to-agency.cjs — move a firm's clients from a governance (tree) edge to an AGENCY edge (15 Nov 2026: a firm is not a network).
 *
 * OWNS      one-off repair for a SIT/demo database: for each live governance edge under the named firm, re-root the client's subtree to its own root (the same step as
 *           src/services/network.js disconnect, through the NET-93 door) and set the edge's type to 'agency'. The edge id, state and the books grants are kept, so
 *           a grant keeps working (lib/network-membership isGrantParentSql reads the agency edge). BEFORE and AFTER rows are printed.
 * CALLED BY a person, once per database:  DATABASE_URL=postgres://...sit... node scripts/repoint-firm-clients-to-agency.cjs "Coastal Accounting Advisers" [--apply]
 * Without --apply it only prints (and changes nothing). Never run against production: the host must be localhost, db or sit-*.
 */
const url = process.env.DATABASE_URL || '';
const HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const host = /^postgres(?:ql)?:\/\/[^@]+@([^:/]+)/.exec(url);
if (!host || !HOSTS.test(host[1])) { console.error('REFUSED: DATABASE_URL must name localhost, db or a sit-* host (never production)'); process.exit(3); }
const firm = process.argv[2], apply = process.argv.includes('--apply');
if (!firm) { console.error('usage: repoint-firm-clients-to-agency.cjs "<firm display name>" [--apply]'); process.exit(2); }
const { Pool } = require('pg');
const pool = new Pool({ connectionString: url });

const ROWS = `SELECT e.id AS edge, e.type, e.state, pi.display_name AS firm, ci.display_name AS client, c.path::text AS client_path
                FROM cb_edge e JOIN cb_entity p ON p.id = e.parent_id JOIN cb_entity c ON c.id = e.child_id
                JOIN identities pi ON upper(pi.bridge_id) = upper(p.bridge_id) AND pi.identity_type = 'entity'
                JOIN identities ci ON upper(ci.bridge_id) = upper(c.bridge_id) AND ci.identity_type = 'entity'
               WHERE pi.display_name ILIKE $1 AND e.type IN ('governance','agency') AND e.state IN ('active','suspended') ORDER BY ci.display_name`;

(async () => {
  const show = async (label, q) => { const r = await q.query(ROWS, [firm + '%']); console.log('\n' + label); r.rows.forEach((x) => console.log('  ' + x.client + ' · edge ' + x.edge + ' · ' + x.type + '/' + x.state + ' · path ' + x.client_path)); return r.rows; };
  const before = await show('BEFORE', pool);
  const todo = before.filter((x) => x.type === 'governance');
  if (!apply || !todo.length) { console.log('\n' + (todo.length ? 'dry run: ' + todo.length + ' edge(s) would move (add --apply)' : 'nothing to move')); await pool.end(); return; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const row of todo) {
      const { rows: [child] } = await c.query(`SELECT e.path::text AS path FROM cb_edge g JOIN cb_entity e ON e.id = g.child_id WHERE g.id = $1 FOR UPDATE OF e`, [row.edge]);
      await c.query(`SELECT set_config('cb.net_reroot', subpath($1::ltree, 0, 1)::text, true)`, [child.path]);
      await c.query(`UPDATE cb_entity SET path = subpath(path, nlevel($1::ltree) - 1) WHERE path <@ $1::ltree`, [child.path]);
      await c.query(`UPDATE cb_edge SET type = 'agency' WHERE id = $1`, [row.edge]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error('ROLLED BACK: ' + e.message); process.exitCode = 1; } finally { c.release(); }
  await show('AFTER', pool);
  await pool.end();
})();
