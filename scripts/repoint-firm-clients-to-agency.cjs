#!/usr/bin/env node
'use strict';
/**
 * scripts/repoint-firm-clients-to-agency.cjs — move a firm's clients from a governance (tree) edge to an AGENCY edge (15 Nov 2026: a firm is not a network).
 *
 * OWNS      one-off repair for a SIT/demo database: for each live governance edge under the named firm, re-root the client's subtree to its own root (the same step as
 *           src/services/network.js disconnect, through the NET-93 door) and set the edge's type to 'agency'. The edge id, state and the books grants are kept, so
 *           a grant keeps working (lib/network-membership isGrantParentSql reads the agency edge). BEFORE and AFTER rows are printed.
 *           Its two pure rules: hostRefusal (never a host that could be production) and edgesToMove (only the governance edges).
 * CALLED BY a person, once per database:  DATABASE_URL=postgres://...sit... node scripts/repoint-firm-clients-to-agency.cjs "Coastal Accounting Advisers" [--apply] · tests/repoint-firm-clients-to-agency.test.cjs (the two rules)
 * Without --apply it only prints (and changes nothing). Never run against production: the host must be localhost, db or sit-*.
 * FLOW      DATABASE_URL host check ──▶ BEFORE rows ──▶ (--apply) per governance edge, in one transaction: re-root the subtree · set type 'agency' ──▶ COMMIT (or ROLLBACK, exit 1) ──▶ AFTER rows
 * CARD      04-network/connections-and-invitations
 */
const HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;

const ROWS = `SELECT e.id AS edge, e.type, e.state, pi.display_name AS firm, ci.display_name AS client, c.path::text AS client_path
                FROM cb_edge e JOIN cb_entity p ON p.id = e.parent_id JOIN cb_entity c ON c.id = e.child_id
                JOIN identities pi ON upper(pi.bridge_id) = upper(p.bridge_id) AND pi.identity_type = 'entity'
                JOIN identities ci ON upper(ci.bridge_id) = upper(c.bridge_id) AND ci.identity_type = 'entity'
               WHERE pi.display_name ILIKE $1 AND e.type IN ('governance','agency') AND e.state IN ('active','suspended') ORDER BY ci.display_name`;

/** why this DATABASE_URL may not be used (its host is not localhost, db or a sit-* host: never production), or null */
function hostRefusal(url) {
  const host = /^postgres(?:ql)?:\/\/[^@]+@([^:/]+)/.exec(url || '');
  return !host || !HOSTS.test(host[1]) ? 'REFUSED: DATABASE_URL must name localhost, db or a sit-* host (never production)' : null;
}

/** the edges still to move: the governance ones (an agency edge is already where it should be) */
const edgesToMove = (rows) => rows.filter((row) => row.type === 'governance');

/** print one set of rows under its label and return them */
async function showRows(db, firm, label) {
  const result = await db.query(ROWS, [firm + '%']);
  console.log('\n' + label);
  result.rows.forEach((row) => console.log('  ' + row.client + ' · edge ' + row.edge + ' · ' + row.type + '/' + row.state + ' · path ' + row.client_path));
  return result.rows;
}

/** one edge: re-root the client's subtree to its own root (the NET-93 door), then set the edge's type to agency */
async function repointEdge(client, edgeId) {
  const {
    rows: [child]
  } = await client.query(`SELECT e.path::text AS path FROM cb_edge g JOIN cb_entity e ON e.id = g.child_id WHERE g.id = $1 FOR UPDATE OF e`, [edgeId]);
  await client.query(`SELECT set_config('cb.net_reroot', subpath($1::ltree, 0, 1)::text, true)`, [child.path]);
  await client.query(`UPDATE cb_entity SET path = subpath(path, nlevel($1::ltree) - 1) WHERE path <@ $1::ltree`, [child.path]);
  await client.query(`UPDATE cb_edge SET type = 'agency' WHERE id = $1`, [edgeId]);
}

/** all the edges in one transaction: rolled back whole on any failure (exit code 1) */
async function applyAll(pool, todo) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of todo) await repointEdge(client, row.edge);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLED BACK: ' + e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

/** the whole run: the host check, the BEFORE rows, and with --apply the move and the AFTER rows */
async function main() {
  const url = process.env.DATABASE_URL || '';
  const refusal = hostRefusal(url);
  if (refusal) {
    console.error(refusal);
    process.exit(3);
  }
  const firm = process.argv[2],
    apply = process.argv.includes('--apply');
  if (!firm) {
    console.error('usage: repoint-firm-clients-to-agency.cjs "<firm display name>" [--apply]');
    process.exit(2);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  const todo = edgesToMove(await showRows(pool, firm, 'BEFORE'));
  if (!apply || !todo.length) {
    console.log('\n' + (todo.length ? 'dry run: ' + todo.length + ' edge(s) would move (add --apply)' : 'nothing to move'));
    await pool.end();
    return;
  }
  await applyAll(pool, todo);
  await showRows(pool, firm, 'AFTER');
  await pool.end();
}

if (require.main === module) main();
module.exports = { hostRefusal, edgesToMove, ROWS };
