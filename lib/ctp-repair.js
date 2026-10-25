'use strict';
// OWNS      repairing copies that arrived over CTP before RAIL-107 and name their sender by an id from the SENDER's database (no row of that id exists here)
// CALLED BY tools/ctp-repair-senders.cjs
// FLOW      each local business's headers that carry ctp_arrival and whose sender has no local row → stubFor (the same stub the door makes) → repoint sender_entity_id and the parties of all_recipients
//           CARD 05-ctp-and-cross-installation/ctp-return-path
/**
 * Idempotent: a header repaired no longer matches the search (its sender now has a row), and a stub that exists is reused. Dry run unless opts.apply. Reads and writes each header as its own
 * business (RLS), so nothing crosses a tenant. A sender whose bridge id a DIFFERENT local business holds is reported as refused (RAIL-102) and left as it is.
 */
const defaults = () => ({ db: require('../db'), party: require('./remote-party') });

async function repairSenders(deps, opts) {
  const { db, party } = Object.assign(defaults(), deps || {});
  const apply = !!(opts && opts.apply);
  const report = { apply, found: 0, repaired: 0, refused: 0, rows: [] };
  const entities = await db.query("SELECT identity_id, bridge_id FROM identities WHERE identity_type = 'entity'");
  for (const entity of entities.rows) {
    const orphaned = await db.withEntity(entity.identity_id, (client) =>
      client.query(
        `SELECT h.chit_id, h.sender_entity_id, h.sender_entity_bridge_id, h.sender_entity_display_name, h.all_recipients, h.business_json -> 'ctp_arrival' AS arrival
           FROM chit_header h
          WHERE h.entity_id = $1 AND h.business_json ? 'ctp_arrival'
            AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = h.sender_entity_id)`,
        [entity.identity_id]
      )
    );
    for (const row of orphaned.rows) {
      report.found++;
      const arrival = row.arrival || {};
      const sender = arrival.sender_bridge_id || row.sender_entity_bridge_id;
      const line = { entity: entity.identity_id, chit_id: row.chit_id, sender_bridge_id: sender, installation: arrival.from_installation || null };
      if (!sender || !arrival.from_installation) {
        report.refused++;
        report.rows.push(Object.assign(line, { result: 'skipped: the copy does not say which installation sent it' }));
        continue;
      }
      if (!apply) {
        report.rows.push(Object.assign(line, { result: 'would repair' }));
        continue;
      }
      const stub = await party.stubFor({ bridge_id: sender, display_name: row.sender_entity_display_name, installation_key: arrival.from_installation, domain: arrival.from_domain, owner: entity.identity_id });
      if (!stub.ok) {
        report.refused++;
        report.rows.push(Object.assign(line, { result: 'refused: ' + stub.why }));
        continue;
      }
      const recipients = Array.isArray(row.all_recipients) ? row.all_recipients : [];
      const others = await party.holdersOf(recipients.map((entry) => entry && entry.bridge_id));
      const header = party.localizeParties({ all_recipients: recipients }, { senderId: stub.identity_id, senderBridge: sender, toId: entity.identity_id, toBridge: entity.bridge_id, others });
      await db.withEntity(entity.identity_id, (client) =>
        client.query('UPDATE chit_header SET sender_entity_id = $3, all_recipients = $4::jsonb, created_by_actor_id = NULL WHERE chit_id = $1 AND entity_id = $2', [
          row.chit_id, entity.identity_id, header.sender_entity_id, JSON.stringify(header.all_recipients)
        ])
      );
      report.repaired++;
      report.rows.push(Object.assign(line, { result: stub.created ? 'repaired (stub made)' : 'repaired (stub reused)', stub: stub.identity_id }));
    }
  }
  return report;
}

module.exports = { repairSenders };
