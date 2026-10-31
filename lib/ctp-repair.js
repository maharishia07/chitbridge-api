'use strict';
// @stage tested
// OWNS      repairing copies that arrived over CTP before RAIL-107 and name their sender by an id from the SENDER's database (no row of that id exists here)
// CALLED BY tools/ctp-repair-senders.cjs
// FLOW      each local business's headers that carry ctp_arrival and whose sender has no local row → stubFor (the same stub the door makes) → repoint sender_entity_id and the parties of all_recipients
//           CARD 05-ctp-and-cross-installation/ctp-return-path
// @stage poc
// @stage-why a one-off repair run by hand (tools/ctp-repair-senders.cjs, dry run unless --apply); no route calls it, so it says what it is.
/**
 * Idempotent: a header repaired no longer matches the search (its sender now has a row), and a stub that exists is reused. Dry run unless opts.apply. Reads and writes each header as its own
 * business (RLS), so nothing crosses a tenant. A sender whose bridge id a DIFFERENT local business holds is reported as refused (RAIL-102) and left as it is.
 */
const defaults = () => ({ db: require('../db'), party: require('./remote-party') });

/** the headers of one business that arrived over CTP and name a sender no row here answers (read as that business: RLS) */
function orphanedHeaders(db, entity) {
  return db.withEntity(entity.identity_id, (client) =>
    client.query(
      `SELECT h.chit_id, h.sender_entity_id, h.sender_entity_bridge_id, h.sender_entity_display_name, h.all_recipients, h.business_json -> 'ctp_arrival' AS arrival
         FROM chit_header h
        WHERE h.entity_id = $1 AND h.business_json ? 'ctp_arrival'
          AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = h.sender_entity_id)`,
      [entity.identity_id]
    )
  );
}

/** point one header at the sender's stub and at local parties, as that business */
async function repointHeader(db, party, entity, row, stub, sender) {
  const recipients = Array.isArray(row.all_recipients) ? row.all_recipients : [];
  const others = await party.holdersOf(recipients.map((entry) => entry && entry.bridge_id));
  const header = party.localizeParties({ all_recipients: recipients }, { senderId: stub.identity_id, senderBridge: sender, toId: entity.identity_id, toBridge: entity.bridge_id, others });
  await db.withEntity(entity.identity_id, (client) =>
    client.query('UPDATE chit_header SET sender_entity_id = $3, all_recipients = $4::jsonb, created_by_actor_id = NULL WHERE chit_id = $1 AND entity_id = $2', [
      row.chit_id, entity.identity_id, header.sender_entity_id, JSON.stringify(header.all_recipients)
    ])
  );
}

/** one orphaned header: what would be (dry run) or was done → { result, repaired?, stub? } */
async function repairOne(deps, entity, row, apply) {
  const arrival = row.arrival || {};
  const sender = arrival.sender_bridge_id || row.sender_entity_bridge_id;
  if (!sender || !arrival.from_installation) return { result: 'skipped: the copy does not say which installation sent it', refused: true, sender };
  if (!apply) return { result: 'would repair', sender };
  const stub = await deps.party.stubFor({ bridge_id: sender, display_name: row.sender_entity_display_name, installation_key: arrival.from_installation, domain: arrival.from_domain, owner: entity.identity_id });
  if (!stub.ok) return { result: 'refused: ' + stub.why, refused: true, sender };
  await repointHeader(deps.db, deps.party, entity, row, stub, sender);
  return { result: stub.created ? 'repaired (stub made)' : 'repaired (stub reused)', repaired: true, stub: stub.identity_id, sender };
}

/** repair the orphaned headers of every local business → { apply, found, repaired, refused, rows } (a dry run unless opts.apply) */
async function repairSenders(deps, opts) {
  const { db, party } = Object.assign(defaults(), deps || {});
  const apply = !!(opts && opts.apply);
  const report = { apply, found: 0, repaired: 0, refused: 0, rows: [] };
  const entities = await db.query("SELECT identity_id, bridge_id FROM identities WHERE identity_type = 'entity'");
  for (const entity of entities.rows) {
    for (const row of (await orphanedHeaders(db, entity)).rows) {
      const done = await repairOne({ db, party }, entity, row, apply);
      report.found++;
      if (done.repaired) report.repaired++;
      if (done.refused) report.refused++;
      const arrival = row.arrival || {};
      const line = { entity: entity.identity_id, chit_id: row.chit_id, sender_bridge_id: done.sender, installation: arrival.from_installation || null, result: done.result };
      report.rows.push(done.stub ? Object.assign(line, { stub: done.stub }) : line);
    }
  }
  return report;
}

module.exports = { repairSenders };
