/**
 * lib/vault-patch.js — THE VAULT IS SAVED AS A MERGE-PATCH, NEVER AS A WHOLE (SET-WALK1 · W25, 2026-10-15).
 *
 * Athi's walk on the live AU shop (15 Oct): a screen opened earlier (Account) with the old legal name overwrote the newer name
 * saved on Your shop — silently — because every Save sent `{ sections: ALL }` and the server replaced the column. RFC 7386
 * merge-patch says what a client MEANS: only the keys it changed travel; `null` removes; an object merges; a scalar replaces.
 * The vault's sections are an ARRAY, and 7386 replaces arrays whole — so the patch is applied over a KEYED VIEW of the vault:
 *   sections keyed by `type|label` (two banks: 'bank|Export receipts' · 'bank|Domestic'), rows by `t:<tag>` else `n:<name>`;
 *   a duplicate key gets `#2`, `#3`… in order. The web (cap-shop.js vaultKeys) builds the SAME keys; tests/vault-patch.test.cjs
 *   pins both to the same examples — the first candidate for an engines lift (said in the PR).
 *
 * owns      the key rule · the merge · the keyed ↔ array conversion (pure, no db)
 * called by lib/profile.js (saveVault's patch path) · routes/governance.js PUT /profile/vault
 * FLOW      read {vault, version} → keyed(vault) → mergePatch(keyed, patch) → unkeyed → sanitizeVault → write WHERE version matches
 * CARD      20-settings-governance-and-plan/vault-merge-patch
 */
'use strict';

const KEY_SEPARATOR = '|';

/** one key per section: `type|label`; a repeat of the same key gets #2, #3 … so nothing is folded away */
function uniqueKey(base, seen) {
  let key = base,
    copy = 1;
  while (seen[key]) {
    copy += 1;
    key = base + '#' + copy;
  }
  seen[key] = true;
  return key;
}
function sectionKey(section, seen) {
  return uniqueKey(String(section.type || 'other') + KEY_SEPARATOR + String(section.label || ''), seen);
}
function rowKey(row, seen) {
  return uniqueKey(row.tag ? 't:' + String(row.tag).toLowerCase() : 'n:' + String(row.name || ''), seen);
}

/** the vault's arrays as the keyed document a merge-patch addresses: { sections: { 'identity|': { type, label, rows: { 't:legal_name': row } } } } */
function keyed(vault) {
  const out = { sections: {} },
    seenSections = {};
  for (const section of (vault && vault.sections) || []) {
    const seenRows = {},
      rows = {};
    for (const row of section.rows || []) rows[rowKey(row, seenRows)] = Object.assign({}, row);
    out.sections[sectionKey(section, seenSections)] = { type: section.type, label: section.label || '', rows };
  }
  return out;
}

/** a keyed section's rows back to an array (anything that is not a row object is dropped) */
function rowsOf(section) {
  const rowMap = section.rows && typeof section.rows === 'object' && !Array.isArray(section.rows) ? section.rows : {};
  return Object.keys(rowMap)
    .map((rowId) => rowMap[rowId])
    .filter((row) => row && typeof row === 'object')
    .map((row) => Object.assign({}, row));
}
/** the keyed document back to the vault's arrays — key order is the order the sections and rows were first seen (new ones last) */
function unkeyed(doc) {
  const keyedSections = doc && doc.sections && typeof doc.sections === 'object' ? doc.sections : {};
  const sections = Object.keys(keyedSections)
    .filter((key) => keyedSections[key] && typeof keyedSections[key] === 'object')
    .map((key) => {
      const section = keyedSections[key];
      return { type: section.type || key.split(KEY_SEPARATOR)[0], label: section.label || '', rows: rowsOf(section) };
    });
  return { sections };
}

/** RFC 7386: an object patch merges key by key, `null` removes, anything else replaces (arrays included) */
function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? Object.assign({}, target) : {};
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete out[key];
    else out[key] = mergePatch(out[key], patch[key]);
  }
  return out;
}

/** a patch over the held vault → the vault to store (still to be sanitised by profile.sanitizeVault) */
function applyVaultPatch(current, patch) {
  const doc = mergePatch(keyed(current), patch || {});
  return unkeyed(doc);
}

/** does the body carry a patch (the merge-patch shape) rather than the old whole array? */
function isPatchBody(body) {
  return !!(body && body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch));
}

module.exports = { keyed, unkeyed, mergePatch, applyVaultPatch, isPatchBody, sectionKey, rowKey };
