'use strict';
/**
 * supplier-list.js — THE ONE PARTY WRITER FOR A SUPPLIER LIST ROW, and the press that adds the seller of a received bill and posts it (AE-F-19).
 * OWNER     cb-rail (the chit sheet's press) · the list itself is cb-crm's
 * RISK      money
 * OWNS      listSupplier · sellerOfBill · addSellerAndPost · postWaiting · freshWait · connectedSeller · addFromInvoice
 * CALLED BY routes/relationships.js (POST /suppliers: a business, a name, or `for_bill`) · routes/chits.js (the sheet read heals a stale wait) · lib/books-hooks.js supplierCheck and lib/books-waits.js (ACC-401: addAtAccept / addFromInvoice / connectedSeller)
 * FLOW      bill id → my received copy's sender (the seller's own key, never a minted twin) → listSupplier (the one write) → books-hooks.retryOutbox → the parked bill posts once
 * CARD      11-crm-and-marketing/crm-parties
 * Auto-add (ACC-401, 27 Nov 2026) SUPERSEDES "never auto-added" (Athi, 1 Oct) for ONE case: the seller of a bill the buyer has just ACCEPTED, when that seller is connected on the rail
 * (local-identity.mayTrade), is listed at the accept (addFromInvoice). Any other sender, and a supplier the owner removed, still waits for the owner's press.
 * Otherwise only a press of the owner reaches this. A name typed on the Suppliers page mints a LOCAL party with its own id, which is not the seller's key —
 * that is why a bill from a rail seller never posted after it: the books look for the seller's entity id. `for_bill` lists that id itself.
 */
const log = require('./logger');
const { hiddenSql } = require('./party-live');
const { restore } = require('./party-restore');
const withEntity = (entity, work) => require('../db').withEntity(entity, work);

/**
 * listSupplier(db, owner, partyId, fields) → { dup: true } (already on the live list) · { restored: true } (it was DELETED: CRM-247 brings the same record back) · {} (the row was added).
 * The one place every door (a name, a ChitBridge business, a bill) looks at the list before it writes.
 */
async function listSupplier(db, owner, partyId, fields) {
  const held = await db.query(`SELECT ${hiddenSql('sl')} AS hidden FROM supplier_list sl WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = $2`, [owner, partyId]);
  if (held.rows.length > 0) {
    if (!held.rows[0].hidden) return { dup: true };
    await restore(db, owner, partyId);
    return { restored: true };
  }
  await db.query(
    `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, category, nickname, notes, preferred, added_via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [owner, partyId, fields.kind, fields.category, fields.nickname, fields.notes, fields.preferred, fields.added_via || 'manual']
  );
  return {};
}

/** the seller of a bill I RECEIVED → { identity_id, display_name } (my own copy's sender, another business), or null — a chit I sent or do not hold names no one */
async function sellerOfBill(db, owner, chit_id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(chit_id || ''))) return null;
  const found = await db.query(
    `SELECT i.identity_id, i.display_name FROM chit_header h JOIN identities i ON i.identity_id = h.sender_entity_id
      WHERE h.entity_id = $1 AND h.chit_id = $2 AND h.sender_entity_id <> h.entity_id`,
    [owner, chit_id]
  );
  return found.rows[0] || null;
}

/** try the parked posts again now (books on only) → { tried, posted, still } or null. Never throws: the supplier is listed either way, the nightly sweep is the net. */
async function postWaiting(owner) {
  try {
    const hooks = require('./books-hooks');
    if (!(await hooks.isOn(owner))) return null;
    return await hooks.retryOutbox(owner, 100);
  } catch (e) {
    log.warn('supplier-list.post-waiting-failed', { entity_id: owner, error: String(e && e.message), then: 'the supplier stays listed; the nightly sweep posts the bill' });
    return null;
  }
}

/** the press "Add <seller> as supplier and post": list the bill's seller by their own key, then post what waited → { seller, listed, books } or null (not a received bill) */
async function addSellerAndPost(owner, chit_id, fields) {
  const seller = await withEntity(owner, (db) => sellerOfBill(db, owner, chit_id));
  if (!seller) return null;
  const listed = await withEntity(owner, (db) => listSupplier(db, owner, seller.identity_id, fields));
  return { seller, listed, books: await postWaiting(owner) };
}

/**
 * freshWait(owner, chit_id, wait) → the bill's books wait, read LIVE: a "not on your supplier list" wait whose seller IS on the live list now is stale (added on another door, or before this fix),
 * so the parked bill is posted and the wait read again — the sheet never says it for a seller already listed.
 */
async function freshWait(owner, chit_id, wait) {
  if (!wait || wait.wait !== 'supplier') return wait;
  try {
    const seller = await withEntity(owner, (db) => sellerOfBill(db, owner, chit_id));
    if (!seller) return wait;
    const on = await withEntity(owner, (db) => require('./books-store').partyOn(db, owner, seller.identity_id));
    if (!on || !on.supplier) return wait;
    await postWaiting(owner);
    return await withEntity(owner, async (db) => {
      const { frag } = require('./sql-frag');
      const reply = await db.query(`SELECT ${frag(require('./books-store').waitOfChitSql('$1', '$2'))} AS w`, [owner, chit_id]);
      return (reply.rows[0] && reply.rows[0].w) || null;
    });
  } catch (e) {
    log.warn('supplier-list.fresh-wait-failed', { entity_id: owner, chit_id, error: String(e && e.message), then: 'the sheet shows the stored wait' });
    return wait;
  }
}

/** the words the buyer reads on the bill's history line (ONE place; the web renders the server's label) */
const NOTE = 'Supplier added from invoice';
/** the seller party of a RECEIVED copy whose own key is the posting party (never me, never a bill I issued), else null */
function receivedFrom(entry, party, owner) {
  const seller = entry && !entry.sells ? entry.seller : null;
  return seller && party && String(seller.entity_id) === String(party) && String(party) !== String(owner) ? seller : null;
}
/**
 * ⭐ ACC-401 · connectedSeller(db, owner, entry, party) → { id, name, country, number } when the bill's seller may be listed AT THE ACCEPT, else null. ONE question for the act (addFromInvoice) and for the
 * sentence the accept says (books-waits.waitsFor), so they never disagree: a received rail copy (entry.sells false, the seller's own key = the posting party), connected on the rail (local-identity.mayTrade,
 * the one definition), not already on the supplier list, and NOT a supplier the owner removed (any supplier_list row = listed or removed: a removed supplier keeps waiting, the owner's deliberate act).
 */
async function connectedSeller(db, owner, entry, party) {
  const seller = receivedFrom(entry, party, owner);
  if (!seller) return null;
  const row = await db.query('SELECT 1 FROM supplier_list sl WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = $2', [owner, party]);
  if (row.rows.length) return null;
  if (!(await require('./local-identity').mayTrade(owner, party, db)).ok) return null;
  return { id: String(party), name: seller.LglNm || null, country: seller.Country || null, number: seller.Gstin || null };
}

/** ACC-401 · the tail of the history line when another party already holds the invoice's tax number (named, never merged) */
const duplicateWords = (holder) => (holder ? ' — ' + (holder.name || 'another party') + ' already has the same tax number, so it was not copied; merge them in your parties if they are one' : '');

/** party-fields' duplicate-tax-id refusal: a 409 that names its holder (e.other) */
const isDuplicateTaxId = (failure) => !!failure && failure.status === 409 && !!failure.other;

/** ACC-401 · the invoice's tax number onto the new supplier through the ONE writer (party-fields.patch: pack check, duplicate check) → { tax, duplicate_of }; a failure never stops the add (logged / named) */
async function saveInvoiceTaxId(db, owner, listRow, seller, by) {
  const scheme = require('./profile').taxIdWordOf(seller.country);
  if (!seller.number || !scheme || !listRow) return { tax: null, duplicate_of: null };
  let failure = null;
  const saved = await require('../db').trySavepoint(
    db,
    async () => {
      try {
        return await require('./party-fields').patch(db, owner, 'supplier', listRow.supplier_list_id, { tax_ids: [{ scheme, value: seller.number }] }, by);
      } catch (e) {
        failure = e;
        throw e;
      }
    },
    null
  );
  if (saved) return { tax: { scheme, value: seller.number }, duplicate_of: null };
  if (isDuplicateTaxId(failure)) return { tax: null, duplicate_of: { party_id: failure.other || null, name: failure.holder || null } };
  log.warn('supplier-list.invoice-tax-id-not-saved', { entity_id: owner, error: String(failure && failure.message), then: 'the supplier is listed without the number' });
  return { tax: null, duplicate_of: null };
}

/**
 * ⭐ ACC-401 · addFromInvoice(owner, chit_id, entry, party, by, code) → { added, seller, duplicate_of } | null (not eligible) — the accept's own add. Called by books-hooks.supplierCheck IMMEDIATELY BEFORE
 * the post, never on a retry / the nightly sweep (that is not "at accept"). NOT atomic with the post: the add is idempotent (a listed seller is not eligible again), so a bill that then parks leaves a listed
 * supplier and no misleading state. One transaction: the row (listSupplier, added_via 'transaction') → the invoice's tax number through the ONE writer (party-fields.patch: scheme from the seller's pack, the
 * pack's check, the duplicate check) → the party number → the audit row. A number that fails its check is not saved and the supplier is still listed; a number another party of this shop already holds is NOT
 * written twice and NEVER merged (the seller asserts the number; merging stays the owner's act): the holder is named in the note. Then the buyer-only history line (bill_step, `code` = the buyer's folder).
 */
async function addFromInvoice(owner, chit_id, entry, party, by, code) {
  const done = await withEntity(owner, async (db) => {
    const seller = await connectedSeller(db, owner, entry, party);
    if (!seller) return null;
    const listed = await listSupplier(db, owner, seller.id, { kind: 'resale', category: null, nickname: null, notes: null, preferred: false, added_via: 'transaction' });
    if (listed.dup || listed.restored) return null;
    const partyFields = require('./party-fields');
    const listRow = (await db.query('SELECT supplier_list_id FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2', [owner, seller.id])).rows[0];
    const { duplicate_of } = await saveInvoiceTaxId(db, owner, listRow, seller, by);
    await partyFields.ensureNo(db, owner, seller.id);
    await require('./books-store').logChange(db, owner, { by, table_name: 'supplier_list', row_id: seller.id, field: 'added_from_invoice', old: null, new: String(chit_id) });
    return { added: true, seller, duplicate_of };
  });
  if (!done) return null;
  const label = NOTE + duplicateWords(done.duplicate_of);
  await require('./chit-bill-step').writeBillStep(owner, chit_id, { code, step: 'supplier_added', label }, { id: by || null, name: null });
  return done;
}

/** ACC-401 · what the accept SAYS for an unlisted seller (books-waits.waitsFor): null when the accept will list them and post, else the wait sentence `words(entry)` — the same connectedSeller the act asks */
async function unlistedWait(db, owner, entry, party, words) {
  try {
    return (await connectedSeller(db, owner, entry, party)) ? null : words(entry);
  } catch (e) {
    log.warn('supplier-list.unlisted-wait-failed', { entity_id: owner, error: String(e && e.message), then: 'the accept says the old wait sentence' }); /* a failed read never hides a wait */
    return words(entry);
  }
}
/** ACC-401 · the hook's one call at the accept (books-hooks.supplierCheck): the buyer's folder code for the history line, then addFromInvoice → its answer or null */
async function addAtAccept(owner, chit_id, facts, by) {
  try {
    return await addFromInvoice(owner, chit_id, facts.entry, facts.party, by, require('./bill-privacy').ownerCode(facts.copy, owner));
  } catch (e) {
    log.warn('supplier-list.add-at-accept-failed', { entity_id: owner, chit_id, error: String(e && e.message), then: 'the bill waits as before: add the supplier, then it posts' });
    return null;
  }
}

module.exports = { NOTE, addAtAccept, unlistedWait, connectedSeller, addFromInvoice, freshWait, listSupplier, sellerOfBill, addSellerAndPost, postWaiting };
