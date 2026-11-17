/**
 * tools/sim-load-wipe.cjs — --fresh: THE SHOP AND EVERYTHING IT OWNS, REMOVED (local database, as its owner) · and the one table-exists read.
 * OWNS      wipeShop (every row keyed to the shop's identity ids, in one transaction with the insert-only triggers standing aside), hasTable.
 * CALLED BY tools/sim-load.cjs (--fresh and the --schema check), after localOnly has accepted --db.
 * FLOW      wipeShop(pool, ids, note) ──▶ BEGIN ──▶ replica role ──▶ DELETE per table by its owner columns ──▶ the identities ──▶ COMMIT
 * CARD      qa/sim-load
 */
'use strict';

/** is the table there in the public schema */
async function hasTable(sql, name) {
  return (await sql(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length > 0;
}

/** --fresh: delete every row the shop owns (local database, as its owner), then its identities */
async function wipeShop(pool, ids, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
    } catch (e) {
      /* the books' insert-only triggers (b273) stand aside for the owner's wipe */
      throw new Error('--fresh needs the database owner (superuser) on this local database: ' + e.message);
    }
    const cols = (
      await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
                                   AND column_name IN ('entity_id', 'owner_entity_id', 'identity_id', 'parent_entity_id', 'customer_identity_id', 'supplier_entity_id', 'sender_entity_id')`)
    ).rows;
    const byTable = new Map();
    cols.forEach((item) => {
      if (item.table_name === 'identities') return;
      const list = byTable.get(item.table_name) || [];
      list.push(item.column_name);
      byTable.set(item.table_name, list);
    });
    const cleared = [];
    for (const [t, list] of byTable) {
      const where = list.map((item) => item + ' = ANY($1::uuid[])').join(' OR ');
      const nestedR = await client.query(`DELETE FROM ${t} WHERE ${where}`, [ids]);
      if (nestedR.rowCount) cleared.push(t + ' ' + nestedR.rowCount);
    }
    const deleted = await client.query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
    cleared.push('identities ' + deleted.rowCount);
    await client.query('COMMIT');
    note('fresh: removed ' + cleared.join(' · '));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
module.exports = { wipeShop, hasTable };
