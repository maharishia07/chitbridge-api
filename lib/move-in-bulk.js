'use strict';
/**
 * lib/move-in-bulk.js — MOVE IN, THE CONTACTS FILE AS ONE SET OF STATEMENTS (CON-164, batch 1136).
 * OWNS      addContactsAsSet: the rows a contacts file ADDS, minted, numbered and put on their list as a SET (a handful of statements for the file,
 *           never a dozen per row — 40 customers took 31 s on sit-au, 0.8 s a row, every statement a round trip to the database).
 * CALLED BY lib/move-in.js applyContacts_ (the one caller; the per-row path stays for every row this cannot land clean).
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob
 * OWNER     cb-connect
 * FLOW      applyContacts_ (lib/move-in) → addContactsAsSet → mintMany → phone UPDATE → list INSERT → ensureNos → the per-row tail (e-mail · contact id · party fields)
 * RISK      personal-data
 * ⭐ REUSES  local-identity.mintMany (mint()'s rules for a set) and party-fields.ensureNos (the one number series, one block) — the same two the
 *   leads import (lib/crm-leads) uses. Nothing here decides who is new: the plan did; a name the shop already holds comes back from mintMany as
 *   "not created" and is left to the per-row path, which says why in words (and restores a deleted party, CRM-247).
 * ⚠️ ONE transaction: the caller's. A handle clash is thrown as a refusal (nothing imported), never retried here: the transaction is the caller's.
 */
const log = require('./logger');
/* lazy, as lib/move-in does: the identity and number helpers load when a file is applied */
const localIdentity = () => require('./local-identity');
const partyFields = () => require('./party-fields');
const db = () => require('../db');
const upper = (value) => String(value == null ? '' : value).toUpperCase();

const KIND_OF = { customer: 'cus', supplier: 'sup' };

/** the minted parties for one side's rows → the rows that came back NEW, each with its party id (a name already held, or a refusal, stays off: the per-row path words it) */
async function mintSet_(conn, entity, side, rows) {
  const minted = await localIdentity().mintMany(
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
/** their phone and tax number into these parties' EMPTY slots, ONE statement for the set (COALESCE: never over what is there; this shop's own parties only) — rows: [{ party_id, phone?, gstin? }] */
async function keepContacts(conn, entity, rows) {
  const some = rows.filter((x) => x.phone || x.gstin);
  if (!some.length) return;
  await conn.query(
    `UPDATE identities i SET otp_contact = COALESCE(i.otp_contact, v.phone), gstn = COALESCE(i.gstn, v.gstin)
       FROM unnest($2::uuid[], $3::text[], $4::text[]) AS v(id, phone, gstin) WHERE i.identity_id = v.id AND i.parent_entity_id = $1`,
    [entity, some.map((x) => x.party_id), some.map((x) => x.phone || null), some.map((x) => x.gstin || null)]
  );
}
/** the list rows, one statement per side → Map(party_id → list id) of those that landed. ⚠️ the SQL sits in the `.query(` call itself: tests/supplier-list-scope reads the source for it */
async function listSet_(conn, entity, side, fresh, addedVia) {
  const ids = fresh.map((x) => x.party_id);
  const inserted =
    side === 'customer'
      ? await conn.query(
          `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
           SELECT $1, v.id, 'entity', $2, 0, NULL FROM unnest($3::uuid[]) AS v(id)
           ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_list_id AS id, customer_identity_id AS party_id`,
          [entity, addedVia, ids]
        )
      : await conn.query(
          `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, added_via)
           SELECT $1, v.id, 'resale', $2 FROM unnest($3::uuid[]) AS v(id)
           ON CONFLICT DO NOTHING RETURNING supplier_list_id AS id, supplier_entity_id AS party_id`,
          [entity, addedVia, ids]
        );
  return new Map(inserted.rows.map((x) => [String(x.party_id), x.id]));
}
/** one side's add rows → [{ row, party_id, id }] landed on the list */
async function addSide_(conn, entity, side, rows, addedVia) {
  const fresh = await mintSet_(conn, entity, side, rows);
  if (!fresh.length) return [];
  await keepContacts(conn, entity, fresh.map((x) => ({ party_id: x.party_id, phone: x.row.data.phone, gstin: x.row.data.gstin })));
  const listed = await listSet_(conn, entity, side, fresh, addedVia);
  const landed = fresh.filter((x) => listed.has(x.party_id)).map((x) => ({ row: x.row, party_id: x.party_id, id: listed.get(x.party_id) }));
  const bare = landed.filter((x) => x.row.bare).map((x) => x.party_id); /* a row with party fields is numbered by party-fields.patch when it runs */
  if (bare.length) await db().trySavepoint(conn, () => partyFields().ensureNos(conn, entity, bare), null);
  return landed;
}
/**
 * addContactsAsSet(conn, entity, adds, addedVia) → Map(row → { id: list id, partyId }) of the rows landed clean.
 * adds: [{ data: { side, name, phone?, gstin? … }, bare: true when the row carries no party fields }]; addedVia: the added_via the list CHECKs allow.
 */
async function addContactsAsSet(conn, entity, adds, addedVia) {
  const landed = new Map();
  if (!adds.length) return landed;
  await localIdentity().takeMintLock(conn, entity); /* before the first read, as the per-row add does: two imports take turns */
  for (const side of Object.keys(KIND_OF)) {
    const rows = adds.filter((x) => x.data.side === side);
    if (rows.length) (await addSide_(conn, entity, side, rows, addedVia)).forEach((x) => landed.set(x.row, { id: x.id, partyId: x.party_id }));
  }
  return landed;
}

/** W1.8 (b766): their contact id on the list row, in a savepoint — a pair another party already holds stays off this one, said in the log */
async function keepSourcePair(conn, entity, side, listId, pair, contactRun) {
  if (!contactRun.pair || !listId || !pair.source_ref) return;
  const target = side === 'customer' ? { table: 'customer_list', id: 'customer_list_id' } : { table: 'supplier_list', id: 'supplier_list_id' };
  const ok = await db().trySavepoint(
    conn,
    () =>
      conn
        .query(`UPDATE ${target.table} SET source_system = $3, source_ref = $4 WHERE ${target.id} = $1 AND owner_entity_id = $2 AND source_ref IS NULL`, [
          listId,
          entity,
          pair.source_system,
          pair.source_ref
        ])
        .then(() => true),
    false
  );
  if (!ok) log.warn('move-in.source-pair-not-kept', { side, source_system: pair.source_system, source_ref: String(pair.source_ref).slice(0, 40) });
}

/** an ADD row that landed in the set: what is left per row, each only when the row carries it — its e-mail, their contact id, its party fields */
async function landedContact(conn, entity, decimals, hit, contactRun) {
  const fields = contactRun.fieldsOf(decimals);
  if (decimals.email && !(await localIdentity().keepEmail(conn, entity, hit.partyId, decimals.email))) contactRun.emailsUnsaved = (contactRun.emailsUnsaved || 0) + 1;
  await keepSourcePair(conn, entity, decimals.side, hit.id, decimals, contactRun);
  if (Object.keys(fields).length) await partyFields().patch(conn, entity, decimals.side, hit.id, fields, contactRun.by);
}
/** the ADD rows of a contacts file, landed as a set → Map(planned row → { id, partyId }); a row it could not land clean is left to the per-row add */
async function landContacts(conn, entity, planned, addedVia, fieldsOf) {
  const adds = planned.rows.filter((x) => x.action === 'add' && x.data).map((x) => ({ row: x, data: x.data, bare: !Object.keys(fieldsOf(x.data)).length }));
  const landed = await addContactsAsSet(conn, entity, adds, addedVia);
  return new Map([...landed].map(([entry, hit]) => [entry.row, hit]));
}

module.exports = { addContactsAsSet, keepContacts, landContacts, landedContact, keepSourcePair };
