// lib/reference.js — THE SELF-PROVING REFERENCE. A "reference check" on ChitBridge is not a chased-down PDF or a phone
// call: it is DERIVED from the entity's own rail history — who it has actually transacted with, how many chits settled,
// and how its disputes ended. It cannot be faked because every figure is computed from the entity's OWN copies of real,
// counter-signed chits (the counterparty holds the matching copy). This is the RELATIONSHIP rung of the trust ladder
// (declared→documented→attested→verified): a track record is an ATTESTATION by the market itself. See
// SPEC-commercial-attestation.md.  RLS: everything is read under withEntity(entity_id) — an entity's own copies only.
const { withEntity } = require('../db');

// resolveTrackRecord(entity_id) → an aggregate reputation signal (COUNTS only, never raw chits/counterparty identities).
// Self-view. Exposing it to a buyer is a separate, opt-in governance decision (see spec) — this function only computes.
async function resolveTrackRecord(entity_id) {
  return withEntity(entity_id, async (c) => {
    // distinct counterparties — the sender on copies I received, the 'to' recipients on copies I sent (drafts excluded).
    let counterparties = 0, dealings = 0, first_at = null, last_at = null;
    try {
      const r = await c.query(
        `WITH mine AS (
           SELECT chit_id, sender_entity_id, all_recipients, created_at
             FROM chit_header WHERE entity_id = $1 AND role <> 'Draft'
         ),
         parties AS (
           SELECT DISTINCT sender_entity_id AS cp FROM mine WHERE sender_entity_id <> $1
           UNION
           SELECT DISTINCT (r->>'entity_id')::uuid AS cp
             FROM mine m, jsonb_array_elements(COALESCE(m.all_recipients,'[]'::jsonb)) r
            WHERE m.sender_entity_id = $1
              AND (r->>'entity_id') IS NOT NULL AND (r->>'entity_id')::uuid <> $1
              AND COALESCE(r->>'all_role', r->>'role', 'to') IN ('to','receiver')
         )
         SELECT
           (SELECT count(*) FROM parties)                    AS counterparties,
           (SELECT count(*) FROM mine)                       AS dealings,
           (SELECT min(created_at) FROM mine)                AS first_at,
           (SELECT max(created_at) FROM mine)                AS last_at`, [entity_id]);
      const row = r.rows[0] || {};
      counterparties = +row.counterparties || 0; dealings = +row.dealings || 0;
      first_at = row.first_at || null; last_at = row.last_at || null;
    } catch (_) {}

    // settled = my copies that reached 'completed' (the mailing-model close). Receiver-driven, mirrored to both copies.
    let settled = 0;
    try {
      const s = await c.query(`SELECT count(*) n FROM chit_status WHERE entity_id = $1 AND current_status = 'completed'`, [entity_id]);
      settled = +(s.rows[0] && s.rows[0].n) || 0;
    } catch (_) {}

    // dispute health — how the entity's disputes ended (guarded: a pre-dispute DB simply reports 0).
    let disputes_open = 0, disputes_resolved = 0;
    try {
      const d = await c.query(
        `SELECT count(*) FILTER (WHERE cd.status = 'open')     AS o,
                count(*) FILTER (WHERE cd.status = 'resolved') AS r
           FROM chit_disputes cd
          WHERE EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = cd.chit_id AND cs.entity_id = $1)`, [entity_id]);
      disputes_open = +(d.rows[0] && d.rows[0].o) || 0; disputes_resolved = +(d.rows[0] && d.rows[0].r) || 0;
    } catch (_) {}

    return { ...strength(counterparties, settled, disputes_open, disputes_resolved),
      counterparties, dealings, settled, disputes_open, disputes_resolved,
      on_rail_since: first_at, last_dealing: last_at };
  });
}

// the RELATIONSHIP rung + a plain-language read of it. A track record is a market attestation: more real counterparties
// and settled chits with clean dispute closure = a stronger reference. Honest floor: a new entity is 'new', not 'trusted'.
function strength(counterparties, settled, open, resolved) {
  const clean = open === 0;
  let rung = 'new', note = 'No rail history yet — this reference will build itself as chits settle.';
  if (settled >= 5 && counterparties >= 3 && clean) {
    rung = 'established'; note = `${settled} settled dealings across ${counterparties} counterparties, disputes clean.`;
  } else if (settled >= 1) {
    rung = 'active';
    note = `${settled} settled dealing${settled === 1 ? '' : 's'}` +
      (counterparties ? ` with ${counterparties} counterpart${counterparties === 1 ? 'y' : 'ies'}` : '') +
      (open ? ` — ${open} open dispute${open === 1 ? '' : 's'}` : resolved ? `, ${resolved} dispute${resolved === 1 ? '' : 's'} resolved` : '.');
  }
  return { rung, note, disputes_clean: clean };
}

module.exports = { resolveTrackRecord };
