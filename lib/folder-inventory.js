'use strict';
// @stage tested
// @stage-note THE FOLDER INVENTORY — every system folder a shop has, numbered with its ledger, as ONE data table; the
// @stage-note one classification of a chit copy into a document kind (SQL and JS compiled from the same rows).
/**
 * lib/folder-inventory.js — WHICH FOLDERS A SHOP HAS UNDER ITS WORK, AND WHERE EACH ONE GOES IN THE LEDGER.
 *
 * Athi, 2026-10-01: *"we need to have an inventory of what folders are required under task and possibly number them
 * associated with the ledger number so it goes directly there, so there is a relation as well … if the same has to be in
 * multiple places, it can be showcased in different places if they are tagged."* — and the same day: *"enabled or
 * disabled using a checkbox, so it won't unnecessarily fill the task."*
 *
 * ⭐ A SYSTEM FOLDER IS A VIEW, NOT A PLACE. Its contents are its rule's matches (lib/match.js, the vocabulary every
 * folder rule speaks), so one chit shows in "Bills · Received" AND a supplier's own view folder without being moved —
 * and keeps the single filing (chit_status.folder_id) the person gave it with 📁 Move.
 *
 * ⭐ NOTHING IS SEEDED. A system folder is this table's row plus the shop's on/off switch (policy_flags.system_folders,
 * no migration): there is no per-shop row that could drift from the table, nothing to run, and the folders exist the
 * moment the code does. Its id is fixed per code (sysId) so every folder route (/:id/chits, /:id/rules) takes it as is.
 *
 * ⭐ THE CODE IS THE LEDGER'S NUMBER — `B-2100` is Bills received, posted to 2100 Suppliers (Sundry Creditors) on
 * acceptance. tests/folder-inventory.test.cjs holds every code to lib/accounts-packs.js, so a renumbered chart turns
 * the test red rather than leaving a folder pointing at the wrong ledger.
 */
const crypto = require('crypto');

/**
 * ── THE INVENTORY ─────────────────────────────────────────────────────────────────────────────────────────────
 *   code          shown beside the name; the number is the ledger code of `role` (or the first code of `group`)
 *   role / group  the accounts-packs ROLE (or GROUP) the folder's documents post to; `also` = the other roles it touches
 *   kind          'view' — membership is `when` (lib/match.js) · 'track' — the existing Task / Order list itself
 *   when          the rule. ⚠️ `doc` is the ONE classification below; the inbox reads the same one.
 *   leaves_inbox  its documents are not tasks: they leave the Task / Order lists whether the folder is on or off
 *   on            the default switch for a shop that has never chosen (Settings › Folders, owner only)
 *   side          the Bills tab it is (received · issued)
 */
const INVENTORY = [
  /* code       name                 role / group                                kind     rule                       leaves  on    */
  { code: 'B-2100',  name: 'Bills · Received', role: 'creditors',                            kind: 'view',  when: { doc: 'bill_received' }, leaves_inbox: true,  on: true,  side: 'received' },
  { code: 'B-1300',  name: 'Bills · Issued',   role: 'debtors',                              kind: 'view',  when: { doc: 'bill_issued' },   leaves_inbox: true,  on: true,  side: 'issued' },
  { code: 'R-1400',  name: 'Receipts',         role: 'cash', also: ['bank', 'upi', 'card'],   kind: 'view',  when: { doc: 'receipt' },       leaves_inbox: false, on: true },
  { code: 'E-6000',  name: 'Expenses',         group: 'indirect_expenses',                   kind: 'view',  when: { doc: 'expense' },       leaves_inbox: false, on: false },
  { code: 'RT-4090', name: 'Returns',          role: 'sales_returns', also: ['purchase_returns'], kind: 'view', when: { doc: 'return' },    leaves_inbox: false, on: false },
  { code: 'T',       name: 'Tasks',            kind: 'track', scope: 'task',  fixed: true, on: true },
  { code: 'O',       name: 'Orders',           kind: 'track', scope: 'order', fixed: true, on: true },
];

/**
 * ── WHAT KIND OF DOCUMENT A COPY IS — the ONE classification, as data ─────────────────────────────────────────
 * First row that holds wins. `sender`: 'me' (the holder sent it — its own counter bill), 'other' (another business
 * sent it), 'none' (no sender). `counter_bill`: a bill number from a till (tax-copy.counterIssued). `kind`: the
 * business_json kind. Compiled to SQL (docSql) for the inbox and every folder read, and to JS (docOf) for tests and
 * any caller holding a row — one table, so the two cannot be edited apart.
 *   ⚠️ These are the same tests the ledger makes: tax-copy.billReceived (invoice or a counter bill, sent by another) and
 *   tax-copy.counterIssued (bill_no + till.id). tests/folder-inventory.test.cjs holds docOf to both.
 */
const ORDERISH = ['order', 'offer', 'subscription'];
const DOC_RULES = [
  { doc: null,            when: { sender: 'none' } },
  { doc: 'bill_issued',   when: { purpose: ORDERISH, counter_bill: true, sender: 'me' } },
  { doc: 'bill_received', when: { purpose: ORDERISH, counter_bill: true, sender: 'other' } },
  { doc: 'bill_received', when: { purpose: ['invoice'], sender: 'other' } },
  { doc: 'return',        when: { purpose: ['credit_note'] } },
  { doc: 'receipt',       when: { purpose: ['receipt'] } },
  { doc: 'receipt',       when: { purpose: ['general'], kind: 'payment_received' } },
  { doc: 'expense',       when: { purpose: ['expense'] } },
];

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";       /* only ever fed the constants above */
/** docSql(ch, cs) — the classification as a SQL CASE over a chit_header alias and its chit_status alias */
function docSql(ch, cs) {
  const h = ch || 'ch', s = cs || 'cs';
  const term = (k, v) => {
    if (k === 'sender') return v === 'none' ? `${h}.sender_entity_id IS NULL`
      : v === 'me' ? `${h}.sender_entity_id = ${s}.entity_id` : `${h}.sender_entity_id <> ${s}.entity_id`;
    if (k === 'purpose') return `${h}.purpose IN (${v.map(lit).join(', ')})`;
    if (k === 'counter_bill') return `(COALESCE(${h}.business_json->>'bill_no', '') <> '' AND COALESCE(${h}.business_json->'till'->>'id', '') <> '')`;
    if (k === 'kind') return `${h}.business_json->>'kind' = ${lit(v)}`;
    throw new Error('docSql: unknown term ' + k);
  };
  return 'CASE ' + DOC_RULES.map((r) => 'WHEN ' + Object.keys(r.when).map((k) => term(k, r.when[k])).join(' AND ')
    + ' THEN ' + (r.doc ? lit(r.doc) : 'NULL')).join(' ') + ' END';
}
/** docOf(row, me) — the same classification in JS: row { purpose, sender_entity_id, business_json } held by `me` */
function docOf(row, me) {
  const c = row || {}, bj = (c.business_json && typeof c.business_json === 'object') ? c.business_json : {};
  const holds = (k, v) => {
    if (k === 'sender') { const snd = c.sender_entity_id; return v === 'none' ? !snd : v === 'me' ? !!snd && String(snd) === String(me) : !!snd && String(snd) !== String(me); }
    if (k === 'purpose') return v.indexOf(String(c.purpose || '')) >= 0;
    if (k === 'counter_bill') return !!(bj.bill_no && String(bj.bill_no) !== '' && bj.till && bj.till.id && String(bj.till.id) !== '');
    if (k === 'kind') return bj.kind === v;
    return false;
  };
  for (const r of DOC_RULES) if (Object.keys(r.when).every((k) => holds(k, r.when[k]))) return r.doc;
  return null;
}

/** the document kinds that are not tasks — they leave the Task / Order lists (whatever the switches say) */
const LEAVES = INVENTORY.filter((f) => f.leaves_inbox).map((f) => f.when.doc);
/**
 * ⭐⭐ THE INBOX PREDICATE — the ONE expression the Task and Order lists add, built from the same docSql the folders
 * read through lib/select.js. A copy is in the inbox exactly when it is in no leaving folder; nothing else leaves.
 */
function inboxSql(ch, cs) { return `COALESCE((${docSql(ch, cs)}), '') NOT IN (${LEAVES.map(lit).join(', ')})`; }

/** a fixed id per code — a name-based (v5-shaped) uuid, the same for every shop; only ever read with the caller's entity */
function sysId(code) {
  const b = crypto.createHash('sha1').update('chitbridge:system-folder:' + code).digest();
  b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.subarray(0, 16).toString('hex');
  return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20, 32);
}
const BY_ID = new Map(INVENTORY.filter((f) => f.kind === 'view').map((f) => [sysId(f.code), f]));
const byId = (id) => BY_ID.get(String(id || '').toLowerCase()) || null;
const byCode = (code) => INVENTORY.find((f) => f.code === code) || null;

/** the ledger code behind a row, read from the adopted pack — what is shown beside the name */
function ledgerOf(f, country) {
  const P = require('./accounts-packs'); const pack = P.packFor(country || P.DEFAULT_COUNTRY);
  if (f.role) { const a = P.accountOf(pack, f.role); return a ? { code: a.code, name: a.name, role: f.role } : null; }
  if (f.group) { const g = P.groupOf(pack, f.group); return g ? { code: String(g.range[0]), name: g.name, group: f.group } : null; }
  return null;
}

/**
 * switches(policy_flags) → { code: true|false } for every row. A row the shop never chose keeps its default; a track
 * (Tasks, Orders) is always on — the switch cannot hide the lists the work arrives in.
 */
function switches(policyFlags) {
  const said = ((policyFlags || {}).system_folders) || {};
  const out = {};
  INVENTORY.forEach((f) => { const v = said[f.code]; out[f.code] = f.fixed ? true : (v === 'on' ? true : v === 'off' ? false : !!f.on); });
  return out;
}

module.exports = { INVENTORY, DOC_RULES, LEAVES, docSql, docOf, inboxSql, sysId, byId, byCode, ledgerOf, switches };
