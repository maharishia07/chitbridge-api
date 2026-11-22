// @stage tested
// OWNS      the e-mail a shop keeps for a party it minted (party_contact, b839): the ONE writer (set) and the ONE read fragment (emailSql).
// CALLED BY lib/local-identity.js (keepEmail), lib/party-fields.js (saveContact), lib/crm.js (who), routes/relationships.js (GET /customers)
// FLOW      clean (party-fields.cleanContact) → set (upsert / delete party_contact, blank the old identities.email) → read through emailSql
// CARD      11-crm-and-marketing/parties-one-record-timeline-interactions
'use strict';
/**
 * lib/party-contact.js — SEC-130 residual: A PARTY'S E-MAIL IS THE SHOP'S CONTACT DATA, NOT A SIGN-IN.
 *
 * ⭐ RULE (stated once, here): a party e-mail lives in party_contact, scoped to the shop that typed it (FORCE RLS, rls_entity), NOT unique, so the
 *   same address in two shops answers the same and nobody can learn that another account holds it. No code path creates, links or signs in an
 *   identity from it, and the sign-in lookups never read this table (tests/sec-130r-party-contact.test.cjs reads their source to prove it).
 *   Leads follow the same rule: the import keeps the address here (fillMany), and also in the timeline note.
 * ⚠️ BEFORE b839 RUNS the table does not exist: nothing is written on identities either (the leak stays closed from the deploy), set() answers
 *   false = "not kept" so the caller can say so, and the read falls back to identities.email. b840 moves the old rows and adds the CHECK; a
 *   cleanup PR then drops the fallback.
 * ⚠️ MINTED_SQL below is handle.isMinted() written as SQL; migrations/b840 carries the same text and a test compares both.
 */
const logger = require('./logger');
const { MINTED } = require('./handle');

const CHANNEL = 'email';
/** handle.isMinted(user_id) as SQL: the first non-whitespace character is the minted mark (BTRIM trims spaces only; JS trim() trims tabs and newlines too) */
const MINTED_SQL = String.raw`user_id ~ '^[[:space:]]*${MINTED}'`;

/** is party_contact there yet? (b839 is run by hand, after the code is deployed) */
const ready = () => require('./schema').hasTable('party_contact');

/**
 * set(db, owner, partyId, email) → true when kept (or cleared), false when the table is not there yet. `email` is already cleaned and lower-cased
 * (party-fields.cleanContact); null / '' clears it. Writes party_contact for (owner, party, 'email') and blanks any old identities.email of this
 * shop's own party, so the move to the new home finishes row by row even before b840. Nothing here can collide with another shop.
 */
async function set(db, owner, partyId, email) {
  if (!(await ready())) {
    logger.warn('party_contact is not migrated (b839): the party e-mail was not saved', { owner });
    return false;
  }
  if (email) {
    await db.query(
      `INSERT INTO party_contact (owner_entity_id, party_id, channel, value) VALUES ($1, $2, '${CHANNEL}', $3)
       ON CONFLICT (owner_entity_id, party_id, channel) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [owner, partyId, email]
    );
  } else {
    await db.query(`DELETE FROM party_contact WHERE owner_entity_id = $1 AND party_id = $2 AND channel = '${CHANNEL}'`, [owner, partyId]);
  }
  await db.query(`UPDATE identities SET email = NULL WHERE identity_id = $1 AND parent_entity_id = $2 AND email IS NOT NULL AND ${MINTED_SQL}`, [partyId, owner]);
  return true;
}

/**
 * fillMany(db, owner, pairs[{party_id,email}]) → how many were kept. ONE statement for a file's worth (the lead import, A-F-47): an address the shop already
 * holds for that party is left as it is (a file never overwrites what the owner typed). Emails are already cleaned; false-y rows are ignored.
 */
async function fillMany(db, owner, pairs) {
  const rows = (pairs || []).filter((x) => x && x.party_id && x.email);
  if (!rows.length || !(await ready())) return 0;
  const inserted = await db.query(
    `INSERT INTO party_contact (owner_entity_id, party_id, channel, value)
       SELECT $1, t.party_id, '${CHANNEL}', t.email FROM unnest($2::uuid[], $3::text[]) AS t(party_id, email)
     ON CONFLICT (owner_entity_id, party_id, channel) DO NOTHING`,
    [owner, rows.map((x) => x.party_id), rows.map((x) => x.email)]
  );
  return inserted.rowCount || 0;
}

/**
 * emailSql(alias, ownerParam, migrated) → the SQL expression for "the e-mail of this party for this shop" — the shop's party_contact value, else
 * (until the cleanup PR) the identity's own e-mail, which is a real ChitBridge business's address. `migrated` is `await ready()`.
 */
function emailSql(alias, ownerParam, migrated) {
  if (!migrated) return `${alias}.email`;
  return `COALESCE((SELECT pc.value FROM party_contact pc WHERE pc.owner_entity_id = ${ownerParam} AND pc.party_id = ${alias}.identity_id AND pc.channel = '${CHANNEL}'), ${alias}.email)`;
}

/** the other parties of THIS shop that hold the same address (its own list only, through the one read) → [{ party_id, display_name }] */
async function sharedWith(db, owner, partyId, email) {
  if (!email) return [];
  const read = emailSql('i', '$1', await ready());
  const rows = await db.query(
    `SELECT i.identity_id AS party_id, i.display_name FROM identities i
      WHERE i.parent_entity_id = $1 AND i.identity_id <> $3 AND lower(${read}) = lower($2)`,
    [owner, email, partyId]
  );
  return rows.rows;
}

module.exports = { set, fillMany, emailSql, sharedWith, ready, MINTED_SQL, CHANNEL };
