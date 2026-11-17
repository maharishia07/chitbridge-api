'use strict';
/**
 * lib/relationships-rename.js — renaming a supplier this shop minted (three-names rule: the handle is set once, the display name is theirs).
 * OWNS      renameMinted (no route, no state)
 * CALLED BY routes/relationships.js (PATCH on a supplier-list row)
 * FLOW      withEntity owner read -> refusal (404 / 403 / 409) or the UPDATE -> change logged -> { name, party_id, changed }
 * CARD      11-crm-and-marketing/relationships
 */
const { query, withEntity } = require('../db');
const { sanitise } = require('../middleware/validate');
const { problem } = require('./problem'); // API-STANDARD S1: the one error writer
const { words } = require('./relationships-contract');



/**
 * ⭐⭐ RENAME A SUPPLIER YOU MINTED. Athi, 2026-09-10: *"user id we generate, but the shop name — they can
 * keep it as per the shop name. So internal id never gets mixed up."*
 *
 * ⭐ That is CB's three-names rule holding at a new kind of row, and it is why the id had to be a number
 * rather than a slug of the name: the HANDLE is generated and set once, the DISPLAY NAME is theirs and free
 * to change. Correcting "Corner Hardwre" to "Corner Hardware & Sons" moves nothing — not the id, not a
 * purchase, not a rupee of spend. A name-shaped handle would have frozen the typo into the identifier.
 *
 * ⚠️ ONLY FOR A PARTY THIS SHOP MINTED. Renaming a real ChitBridge business in their own row is not this
 * shop's to do — for those, `nickname` is the owner-side label and always has been.
 * ⚠️ A duplicate name is REFUSED by the b218 index rather than merged: two suppliers with one name is the
 * mix-up he is guarding against, and a silent merge would move history between two real records.
 */
async function renameMinted(req, res, owner) {
  if (!('display_name' in req.body && String(req.body.display_name || '').trim())) return null; /* no rename asked */
  const row = await ownedSupplierRow(owner, req.params.id);
  if (!row) return refuseRename(req, res, { status: 404, ...words.notFound() });
  if (!require('./handle').isMinted(row.user_id)) return refuseRename(req, res, { status: 403, ...words.notYours() });
  const newName = sanitise(String(req.body.display_name).trim().replace(/\s+/g, ' ')).slice(0, 120);
  try {
    await query(`UPDATE identities SET display_name = $1 WHERE identity_id = $2`, [newName, row.identity_id]);
  } catch (err) {
    if (err && err.code !== '23505') throw err;
    return refuseRename(req, res, { status: 409, ...words.listed('You already have a supplier called ' + newName + '.') });
  }
  const changed = await logRename(req, owner, row, newName);
  return { name: newName, party_id: row.identity_id, changed }; /* CRM-45: what the party answer names */
}

/** the supplier-list row of this shop with the identity behind it (null when the shop holds no such supplier) */
async function ownedSupplierRow(owner, supplierListId) {
  const owned = await withEntity(owner, (db) =>
    db.query(
      `SELECT i.identity_id, i.user_id, i.display_name FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id
      WHERE sl.supplier_list_id = $1 AND sl.owner_entity_id = $2`,
      [supplierListId, owner]
    )
  );
  return owned.rows[0];
}

/** answer the refusal and say "refused" to the caller (false) */
function refuseRename(req, res, spec) {
  problem(req, res, spec);
  return false;
}

/** the change of the display name goes in the books' change log (a failed log write never undoes the rename) -> the names of the fields that changed ([] when the name is the one it had) */
async function logRename(req, owner, row, newName) {
  if (newName === row.display_name) return [];
  await withEntity(owner, (db) =>
    require('../db').trySavepoint(db, () => require('./books-store').logChange(db, owner, { by: req.identity && req.identity.identity_id, table_name: 'identities', row_id: row.identity_id, field: 'display_name', old: row.display_name, new: newName }), null)
  );
  return ['display_name'];
}

module.exports = { renameMinted };
