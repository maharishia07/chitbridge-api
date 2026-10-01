'use strict';
// @stage tested
// @stage-note VIEW FOLDERS — a folder whose contents are its rule's matches (system ones from the inventory, a shop's own from
// @stage-note its folder_rule rows), so one chit shows in several folders and keeps its one filing.
/**
 * lib/folder-views.js — WHAT IS IN A VIEW FOLDER, AND HOW MANY ARE STILL OPEN.
 *
 * A FILED folder holds what was moved into it (chit_status.folder_id — the person's own filing, one per copy).
 * A VIEW folder holds what its rule matches, read fresh every time:
 *   · a SYSTEM folder (lib/folder-inventory) — its rule is the inventory row's `when`, fixed in code, because the Task/Order
 *     lists leave out the same documents and the two must never disagree; on/off per shop (policy_flags.system_folders);
 *   · a shop's OWN view folder (folder.kind = 'view', b275) — its rules are its folder_rule rows, ORed (each rule is AND).
 * ⚠️ The rule is matched by lib/match.js over lib/select.js rows — the SAME matcher, vocabulary and preview every filing
 * rule already uses. A view folder's rules never FILE anything (lib/folder-rules fileArrival skips them).
 */
const INV = require('./folder-inventory');
const select = require('./select');
const match = require('./match');
const billSteps = require('./bill-steps');
const policy = require('./policy');

/** the shop's switches, every inventory row → on/off (a shop that never chose gets the defaults) */
async function switchesOf(entity_id) {
  let flags = {};
  try { flags = await policy.get(entity_id); } catch (_) {}
  return INV.switches(flags);
}

/** the rules (ANDed terms, ORed rows) a view folder is defined by */
async function whensOf(entity_id, folder) {
  if (folder.system) return [folder.when];
  const r = await require('./folder-rules').list(entity_id, folder.folder_id);
  return (r.rules || []).filter((x) => x.enabled !== false && x.when && typeof x.when === 'object').map((x) => x.when);
}

/** rows(entity_id, whens, opts) — every copy that meets ANY of the rules. Pre-filtered in SQL by document kind when every rule names one. */
async function rowsFor(entity_id, whens, opts = {}) {
  if (!whens.length) return [];
  const docs = whens.every((w) => w.doc) ? [...new Set(whens.map((w) => w.doc))] : undefined;
  const rows = await select.rows(entity_id, { archived: !!opts.archived, limit: opts.limit || 2000, docs });
  return rows.filter((c) => whens.some((w) => match.match(c, w)));
}

/**
 * members(entity_id, folder, { archived, state }) — the folder's chits; a bill carries its lifecycle (`bill`, lib/bill-steps).
 * state: 'open' (default) · 'closed' · 'all' — a bill is open until its step is Closed; a chit with no lifecycle is open.
 */
async function members(entity_id, folder, opts = {}) {
  const rows = await billSteps.steps(entity_id, await rowsFor(entity_id, await whensOf(entity_id, folder), opts));
  const isOpen = (r) => !r.bill || r.bill.open;
  const counts = { open: rows.filter(isOpen).length, closed: rows.filter((r) => !isOpen(r)).length, total: rows.length };
  const st = opts.state === 'closed' || opts.state === 'all' ? opts.state : 'open';
  const list = st === 'all' ? rows : rows.filter((r) => (st === 'open') === isOpen(r));
  return { chits: list, counts, state: st };
}

/** the inventory as the API shows it: every row, its ledger, its switch */
function inventoryRows(sw, country) {
  return INV.INVENTORY.map((f) => {
    const led = INV.ledgerOf(f, country);
    return { code: f.code, name: f.name, kind: f.kind, side: f.side || null, scope: f.scope || null, when: f.when || null,
             ledger: led, fixed: !!f.fixed, leaves_inbox: !!f.leaves_inbox, on: !!sw[f.code], default_on: !!f.on,
             folder_id: f.kind === 'view' ? INV.sysId(f.code) : null };
  });
}

/**
 * systemFolders(entity_id) — the ON system folders, shaped like folder rows (system first, by code), each with the count
 * of its OPEN items. ONE select read for all of them (the union of their document kinds), then each is its rule's matches.
 */
async function systemFolders(entity_id) {
  const sw = await switchesOf(entity_id);
  const on = INV.INVENTORY.filter((f) => f.kind === 'view' && sw[f.code]);
  if (!on.length) return [];
  const all = await billSteps.steps(entity_id, await rowsFor(entity_id, on.map((f) => f.when), {}));
  return on.map((f) => {
    const mine = all.filter((c) => match.match(c, f.when));
    const open = mine.filter((r) => !r.bill || r.bill.open).length;
    const led = INV.ledgerOf(f);
    return { folder_id: INV.sysId(f.code), parent_id: null, name: f.name, code: f.code, kind: 'view', system: true, scope: null,
             side: f.side || null, ledger: led, sort: 0, count: open, total: mine.length };
  });
}

/** the system folder behind an id, if it is one and it is ON for this shop (an OFF folder answers as absent) */
async function systemById(entity_id, id) {
  const f = INV.byId(id);
  if (!f) return null;
  const sw = await switchesOf(entity_id);
  /* ⚠️ the inventory row FIRST: its `on` is the DEFAULT, and the shop's switch must be the one that survives */
  return Object.assign({}, f, { system: true, on: !!sw[f.code], default_on: !!f.on, folder_id: INV.sysId(f.code) });
}

module.exports = { switchesOf, whensOf, rowsFor, members, inventoryRows, systemFolders, systemById };
