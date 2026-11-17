/**
 * tools/sim-load-wipe.cjs — --fresh: THE SHOP AND EVERYTHING IT OWNS, REMOVED (local database, as its owner) · and the one table-exists read.
 * OWNS      stampRecorded (the Seed E recorded_at stamp run), triggersAside (the insert-only triggers stand aside for one open transaction), wipeShop (every row keyed to the shop's identity ids, in one transaction with the insert-only triggers standing aside), hasTable.
 * CALLED BY tools/sim-load.cjs (--fresh and the --schema check), after localOnly has accepted --db.
 * FLOW      wipeShop(pool, ids, note) ──▶ BEGIN ──▶ replica role ──▶ DELETE per table by its owner columns ──▶ the identities ──▶ COMMIT
 * OWNER     cb-qa
 * CARD      qa/sim-load
 */
'use strict';

/** is the table there in the public schema */
async function hasTable(sql, name) {
  return (await sql(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length > 0;
}

/** the insert-only books triggers stand aside for the caller's open transaction (SET LOCAL: gone at COMMIT/ROLLBACK); owner only. The one place outside wipeShop that does it: tools/seed/clean-lane-rows.cjs calls this, behind its own SIT/seed-database refusal. */
async function triggersAside(client) {
  await client.query(`SET LOCAL session_replication_role = 'replica'`);
}

/** --fresh: delete every row the shop owns (local database, as its owner), then its identities */
async function wipeShop(pool, ids, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
    } catch (failure) {
      /* the books' insert-only triggers (b273) stand aside for the owner's wipe */
      throw new Error('--fresh needs the database owner (superuser) on this local database: ' + failure.message);
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
    for (const [tableName, list] of byTable) {
      const where = list.map((item) => item + ' = ANY($1::uuid[])').join(' OR ');
      const nestedR = await client.query(`DELETE FROM ${tableName} WHERE ${where}`, [ids]);
      if (nestedR.rowCount) cleared.push(tableName + ' ' + nestedR.rowCount);
    }
    const deleted = await client.query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids]);
    cleared.push('identities ' + deleted.rowCount);
    await client.query('COMMIT');
    note('fresh: removed ' + cleared.join(' · '));
  } catch (failure) {
    await client.query('ROLLBACK').catch((rollbackError) => console.warn('stampRecorded: rollback failed: ' + rollbackError.message));
    throw failure;
  } finally {
    client.release();
  }
}
/** stamp recorded_at on ids (an array of entity ids, or null = every Seed E demo client): one transaction, owner only. pool = a pg Pool. Returns the rows stamped. */
async function stampRecorded(pool, ids) {
  const seedE = require('./seed/seed-e.cjs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await triggersAside(client); /* the insert-only trigger stands aside, as --fresh does */
    const stamped = ids ? await client.query(seedE.STAMP_SQL.replace('%IDS%', '$1::uuid[]'), [ids]) : await client.query(seedE.STAMP_SQL.replace('%IDS%', seedE.SEED_IDS_SQL));
    await client.query('COMMIT');
    await require('./analyze-filled.cjs').analyzeFilled(pool); /* created_at moved on every entry: refresh the statistics */
    return stamped.rowCount;
  } catch (e) { await client.query('ROLLBACK').catch((rollbackError) => console.warn('stampRecorded: rollback failed: ' + rollbackError.message)); throw e; } finally { client.release(); }
}

module.exports = { wipeShop, hasTable, triggersAside, stampRecorded };
