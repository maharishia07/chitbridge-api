'use strict';
/**
 * lib/move-in-bulk.js — MOVE IN, THE CONTACTS FILE AS ONE SET OF STATEMENTS (CON-164, batch 1136).
 * OWNS      addContactsAsSet: the rows a contacts file ADDS, minted, numbered and put on their list as a SET (a handful of statements for the file,
 *           never a dozen per row — 40 customers took 31 s on sit-au, 0.8 s a row, every statement a round trip to the database).
 * CALLED BY lib/move-in.js applyContacts_ (the one caller; the per-row path stays for every row this cannot land clean).
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob
 * ⭐ REUSES  local-identity.mintMany (mint()'s rules for a set) and party-fields.ensureNos (the one number series, one block) — the same two the
 *   leads import (lib/crm-leads) uses. Nothing here decides who is new: the plan did; a name the shop already holds comes back from mintMany as
 *   "not created" and is left to the per-row path, which says why in words (and restores a deleted party, CRM-247).
 * ⚠️ ONE transaction: the caller's. A handle clash is thrown as a refusal (nothing imported), never retried here: the transaction is the caller's.
 */
const localIdentity = require('./local-identity');
const partyFields = require('./party-fields');
const db = require('../db');

const KIND_OF = { customer: 'cus', supplier: 'sup' };
const LIST_INSERT = {
  customer: `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
             SELECT $1, v.id, 'entity', $2, 0, NULL FROM unnest($3::uuid[]) AS v(id)
             ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_list_id AS id, customer_identity_id AS party_id`,
  supplier: `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, added_via)
             SELECT $1, v.id, 'resale', $2 FROM unnest($3::uuid[]) AS v(id)
             ON CONFLICT DO NOTHING RETURNING supplier_list_id AS id, supplier_entity_id AS party_id`
};

/** the minted parties for one side's rows → the rows that came back NEW, each with its party id (a name already held, or a refusal, stays off: the per-row path words it) */
async function mintSet_(conn, entity, side, rows) {
  const minted = await localIdentity.mintMany(
    entity,
    rows.map((x) => x.data.name),
    { query: conn.query.bind(conn), kind: KIND_OF[side] }
  );
  if (minted.error) {
    const e = new Error('Nothing was imported — a number for the new contacts could not be taken. Try once more.');
    Object.assign(e, { refused: true, code: 'MOVE_IN_MINT_BUSY', status: 409 });
    throw e;
  }
  const fresh = [];
  rows.forEach((x, index) => {
    const got = minted.rows[index];
    if (got && got.created && got.identity_id) fresh.push({ row: x, party_id: String(got.identity_id) });
  });
  return fresh;
}
/** their phone and tax number into the minted rows' EMPTY slots, one statement (COALESCE, the same as the per-row write) */
async function contactSet_(conn, entity, fresh) {
  const withContact = fresh.filter((x) => x.row.data.phone || x.row.data.gstin);
  if (!withContact.length) return;
  await conn.query(
    `UPDATE identities i SET otp_contact = COALESCE(i.otp_contact, v.phone), gstn = COALESCE(i.gstn, v.gstin)
       FROM unnest($2::uuid[], $3::text[], $4::text[]) AS v(id, phone, gstin) WHERE i.identity_id = v.id AND i.parent_entity_id = $1`,
    [entity, withContact.map((x) => x.party_id), withContact.map((x) => x.row.data.phone || null), withContact.map((x) => x.row.data.gstin || null)]
  );
}
/** the list rows, one statement → Map(party_id → list id) of those that landed */
async function listSet_(conn, entity, side, fresh, via) {
  const inserted = await conn.query(LIST_INSERT[side], [entity, via, fresh.map((x) => x.party_id)]);
  return new Map(inserted.rows.map((x) => [String(x.party_id), x.id]));
}
/** one side's add rows → [{ row, party_id, id }] landed on the list */
async function addSide_(conn, entity, side, rows, via) {
  const fresh = await mintSet_(conn, entity, side, rows);
  if (!fresh.length) return [];
  await contactSet_(conn, entity, fresh);
  const listed = await listSet_(conn, entity, side, fresh, via);
  const landed = fresh.filter((x) => listed.has(x.party_id)).map((x) => ({ row: x.row, party_id: x.party_id, id: listed.get(x.party_id) }));
  const bare = landed.filter((x) => x.row.bare).map((x) => x.party_id); /* a row with party fields is numbered by party-fields.patch when it runs */
  if (bare.length) await db.trySavepoint(conn, () => partyFields.ensureNos(conn, entity, bare), null);
  return landed;
}
/**
 * addContactsAsSet(conn, entity, adds, via) → Map(row → { id: list id, partyId }) of the rows landed clean.
 * adds: [{ data: { side, name, phone?, gstin? … }, bare: true when the row carries no party fields }]; via: the added_via the list CHECKs allow.
 */
async function addContactsAsSet(conn, entity, adds, via) {
  const landed = new Map();
  if (!adds.length) return landed;
  await localIdentity.takeMintLock(conn, entity); /* before the first read, as the per-row add does: two imports take turns */
  for (const side of Object.keys(KIND_OF)) {
    const rows = adds.filter((x) => x.data.side === side);
    if (rows.length) (await addSide_(conn, entity, side, rows, via)).forEach((x) => landed.set(x.row, { id: x.id, partyId: x.party_id }));
  }
  return landed;
}

module.exports = { addContactsAsSet };
