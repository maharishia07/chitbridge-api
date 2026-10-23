'use strict';
/**
 * tests/support/seed-volume.cjs — SPD-17 · add N extra rows to each main table a route reads, in a SCRATCH database on the local Postgres.
 *
 *   node tests/support/seed-volume.cjs --rows 10000        (on a fresh copy: tools/round-trips-volume.cjs makes one per level)
 *
 * OWNS: the volume levels' rows. CALLED BY: tools/round-trips-volume.cjs (once per level); by hand to look at a slow screen with data.
 * FLOW: refuse anything but 127.0.0.1/cb_volume → clone the demo shop's own rows N times in one transaction → ANALYZE.
 * CARD 28-platform-and-operations/round-trip-volume
 *
 * ⭐ LOCAL ONLY. The only database it opens is postgres://…@127.0.0.1:<port>/cb_volume (a copy of cb_local); any other URL is refused before a
 *    connection is made. Never production, never Railway or Supabase.
 * ⭐ CLONES, NOT INVENTIONS. Every extra row is a copy of a row the demo shop (Mayur Restaurant) already has, with a new key, so its shape is whatever
 *    the routes themselves wrote. Extras are marked (chit ids in volume_seed_chit · identities bridge_id 'VOL…' · catalogue item_data.volume_seed ·
 *    journal entry_no 'VOL-…' · stock note 'volume-seed') so a measuring run can pick a real, un-cloned row as its path id.
 *    Nothing is deleted and no trigger is switched off: a level starts from a fresh copy of the base database instead.
 * Tables (N rows each): chit_header + chit_detail + chit_status + chit_line · customer_list (+ identities) · catalogue_items · stock_movement ·
 *    journal_entry (+ its journal_line rows).
 */
const { Client } = require('pg');

const URL_OK = /^postgres:\/\/[^@]+@127\.0\.0\.1:\d+\/cb_volume$/;
const DEMO_SHOP = '4266348b-4eb8-4338-b35f-cb0a856eda0d';   /* Mayur Restaurant, the seed-local shop (local-stack.sh) */

/** SELECT list that copies every column of `table` from alias s, except the ones in `over` (column → SQL expression). */
async function cloneList(db, table, over) {
  const columnRows = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table]);
  const cols = columnRows.rows.map((row) => row.column_name);
  return { cols: cols.map((name) => '"' + name + '"').join(','), sel: cols.map((name) => (over[name] !== undefined ? over[name] : 's."' + name + '"')).join(',') };
}

/** The shop's chits ×N: one map of (new chit id → template chit id), then each chit table copied through it. */
async function seedChits(db, count) {
  await db.query(`CREATE TEMP TABLE vmap ON COMMIT DROP AS
    SELECT g, t.chit_id AS old_id, gen_random_uuid() AS new_id FROM generate_series(1,${count}) g
    JOIN (SELECT chit_id, row_number() OVER (ORDER BY chit_id) rn, count(*) OVER () k
            FROM (SELECT DISTINCT chit_id FROM chit_header WHERE entity_id='${DEMO_SHOP}' AND chit_id NOT IN (SELECT chit_id FROM volume_seed_chit)) x) t
      ON t.rn = ((g-1) % t.k) + 1`);
  await db.query('INSERT INTO volume_seed_chit SELECT new_id FROM vmap');
  const spread = `now() - (m.g * interval '1 day' * 365 / ${Math.max(count, 1)})`;   /* spread over the last year, newest first */
  const copy = async (table, over) => {
    const plan = await cloneList(db, table, Object.assign({ chit_id: 'm.new_id' }, over));
    await db.query(`INSERT INTO ${table} (${plan.cols}) SELECT ${plan.sel} FROM ${table} s JOIN vmap m ON m.old_id = s.chit_id WHERE s.entity_id=$1`, [DEMO_SHOP]);
  };
  await copy('chit_header', { header_id: 'gen_random_uuid()', created_at: spread, sent_at: spread, business_json: "s.business_json - 'client_ref'" });
  await copy('chit_detail', { detail_id: 'gen_random_uuid()' });
  await copy('chit_status', { status_id: 'gen_random_uuid()' });
  await copy('chit_line', { row_id: 'gen_random_uuid()' });
}

/** Parties: N new customer identities, each listed as a customer of the shop. */
async function seedParties(db, count) {
  await db.query(`INSERT INTO identities (bridge_id, display_name, identity_type, status, owner_scope)
    SELECT 'VOL' || g, 'Volume Customer ' || g, 'customer', 'active', 'entity' FROM generate_series(1,${count}) g`);
  await db.query(`INSERT INTO customer_list (customer_list_id, owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, created_at, groups, nickname, party_no)
    SELECT gen_random_uuid(), $1, i.identity_id, 'end_customer', 'manual', (i.rn % 20)::int, now() - (i.rn * interval '1 hour'), '{}', 'Volume ' || i.rn, 'VP' || i.rn
      FROM (SELECT identity_id, row_number() OVER (ORDER BY bridge_id) rn FROM identities WHERE bridge_id LIKE 'VOL%') i`, [DEMO_SHOP]);
}

/** Catalogue items ×N (names made unique so the search indexes have something to chew on), then stock movements ×N against them. */
async function seedItemsAndStock(db, count) {
  await db.query(`INSERT INTO catalogue_items (item_id, entity_id, schema_id, item_data, is_active, created_at, updated_at)
    SELECT gen_random_uuid(), $1, t.schema_id,
           t.item_data || jsonb_build_object('volume_seed','1','name',(t.item_data->>'name') || ' #' || g,'code','V' || g,'sku','VS' || g), true, now(), now()
      FROM generate_series(1,${count}) g
      JOIN (SELECT *, row_number() OVER (ORDER BY item_id) rn, count(*) OVER () k FROM catalogue_items WHERE entity_id=$1 AND NOT (item_data ? 'volume_seed')) t
        ON t.rn = ((g-1) % t.k) + 1`, [DEMO_SHOP]);
  const plan = await cloneList(db, 'stock_movement', { movement_id: 'gen_random_uuid()', ref: 'NULL', line_ref: 'NULL', note: "'volume-seed'",
    at: `now() - (m.g * interval '1 day' * 365 / ${Math.max(count, 1)})`, item_id: 'COALESCE(m.item_id, s.item_id)' });
  await db.query(`INSERT INTO stock_movement (${plan.cols})
    SELECT ${plan.sel} FROM (SELECT g, ((g-1) % k) + 1 AS rn FROM generate_series(1,${count}) g, (SELECT count(*) k FROM stock_movement WHERE entity_id=$1 AND note IS DISTINCT FROM 'volume-seed') kk) x
      JOIN (SELECT *, row_number() OVER (ORDER BY movement_id) rn FROM stock_movement WHERE entity_id=$1 AND note IS DISTINCT FROM 'volume-seed') s ON s.rn = x.rn
      JOIN (SELECT g, (SELECT item_id FROM catalogue_items WHERE entity_id=$1 AND item_data->>'volume_seed'='1' ORDER BY item_id OFFSET (g-1) % ${Math.max(count, 1)} LIMIT 1) AS item_id FROM generate_series(1,${count}) g) m ON m.g = x.g`, [DEMO_SHOP]);
}

/** Journal entries ×N with their lines (the lines are copied through a map, line_id from its sequence). */
async function seedJournal(db, count) {
  await db.query(`CREATE TEMP TABLE jmap ON COMMIT DROP AS
    SELECT g, t.entry_id AS old_id, gen_random_uuid() AS new_id FROM generate_series(1,${count}) g
    JOIN (SELECT entry_id, row_number() OVER (ORDER BY entry_id) rn, count(*) OVER () k FROM journal_entry WHERE entity_id='${DEMO_SHOP}' AND entry_no NOT LIKE 'VOL-%') t
      ON t.rn = ((g-1) % t.k) + 1`);
  const entryPlan = await cloneList(db, 'journal_entry', { entry_id: 'm.new_id', entry_no: "'VOL-' || m.g", source_ref: 'NULL', source_chit_id: 'NULL', source_chit_ids: 'NULL',
    reverses_entry_id: 'NULL', posting_date: "(current_date - (m.g % 365))" });
  await db.query(`INSERT INTO journal_entry (${entryPlan.cols}) SELECT ${entryPlan.sel} FROM journal_entry s JOIN jmap m ON m.old_id = s.entry_id`);
  const plan = await cloneList(db, 'journal_line', { line_id: "nextval('journal_line_line_id_seq')", entry_id: 'm.new_id' });
  await db.query(`INSERT INTO journal_line (${plan.cols}) SELECT ${plan.sel} FROM journal_line s JOIN jmap m ON m.old_id = s.entry_id`);
}

/** Open the scratch database, add the rows in one transaction, ANALYZE (the planner needs the new sizes), print the table counts. */
async function main() {
  const rows = Number(process.argv[process.argv.indexOf('--rows') + 1]);
  const url = process.env.CB_VOLUME_URL || '';
  if (!(rows >= 0)) { console.error('usage: node tests/support/seed-volume.cjs --rows <N>   (CB_VOLUME_URL=postgres://…@127.0.0.1:<port>/cb_volume)'); process.exit(2); }
  if (!URL_OK.test(url)) { console.error('REFUSED: seed-volume only touches the local scratch database cb_volume on 127.0.0.1'); process.exit(3); }
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('CREATE TABLE volume_seed_chit (chit_id uuid PRIMARY KEY)');
    if (rows > 0) { await seedChits(db, rows); await seedParties(db, rows); await seedItemsAndStock(db, rows); await seedJournal(db, rows); }
    await db.query('COMMIT');
    await db.query('ANALYZE');
    const countRows = async (table) => Number((await db.query('SELECT count(*) FROM ' + table)).rows[0].count);
    const have = {};
    for (const table of ['chit_header', 'chit_line', 'customer_list', 'catalogue_items', 'stock_movement', 'journal_entry', 'journal_line']) have[table] = await countRows(table);
    console.log('  seed-volume: +' + rows + ' per table · now ' + JSON.stringify(have));
  } catch (err) { await db.query('ROLLBACK').catch((rollbackError) => console.error('rollback failed: ' + rollbackError.message)); throw err; }
  finally { await db.end(); }
}
if (require.main === module) main().catch((err) => { console.error('seed-volume failed: ' + (err && err.stack)); process.exit(1); });
module.exports = { DEMO_SHOP, URL_OK };
