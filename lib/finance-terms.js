'use strict';
/**
 * lib/finance-terms.js — CB FINANCE · TERMS (round F2): the shop's DEFAULT credit terms, a PER-PARTY override, the one
 * resolver, the credit-limit check, and the change events. Finance is the ONE place that SETS terms; the CRM record, the
 * till and Accounts only read them (routes/books.js GET /terms).
 *
 * ⭐ WHERE IT LIVES (no new table — DECISIONS 2026-10-09): books_setting.terms (shop default) · customer_list.terms /
 *   supplier_list.terms (interest + early-pay override) · a party's days and limit stay in credit_days / credit_limit_minor
 *   (b274) — one home per fact. migrations/b298_finance_terms.sql adds the three columns (NOT RUN by the code; Athi runs it).
 * ⚠️ BEFORE IT RUNS: `migrated()` is false, reads answer the party's own days/limit with terms_migrated:false, a write
 *   answers 503 TERMS_NOT_MIGRATED — the screen says so in words. Nothing here ever 500s on the missing column.
 * ⭐ Money is minor units (credit_limit_minor). Interest/early-pay are percentages and days — no money here.
 * ⭐ EVERY change is a books_change_log row (table_name 'terms' for the shop, 'party_terms' for a party): who · when · from → to.
 */
const schema = require('./schema');
const S = require('./books-store');

const MAX_DAYS = 3650;
const bad = (m) => Object.assign(new Error(m), { status: 400, say: m });
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** the three columns exist? a yes is cached forever (lib/schema), a no is asked again after a minute */
async function migrated() {
  return (await schema.hasColumn('books_setting', 'terms')) && (await schema.hasColumn('customer_list', 'terms')) && (await schema.hasColumn('supplier_list', 'terms'));
}

/** one number field, or null (= not set); throws a shopkeeper sentence */
function field(v, name, lo, hi, whole) {
  const n = num(v); if (n === null) return null;
  if (!isFinite(n) || n < lo || n > hi || (whole && Math.floor(n) !== n)) throw bad(name + ' must be ' + (whole ? 'a whole number' : 'a number') + ' from ' + lo + ' to ' + hi + '.');
  return n;
}
/** a posted terms body → the stored shape. Only keys PRESENT are returned (a missing key leaves the stored one alone); null clears. */
function clean(b) {
  b = b || {}; const out = {};
  if ('credit_days' in b) out.credit_days = field(b.credit_days, 'Credit days', 0, MAX_DAYS, true);
  if ('credit_limit_minor' in b) out.credit_limit_minor = field(b.credit_limit_minor, 'Credit limit', 0, 9e15, true);
  if ('interest' in b) {
    const i = b.interest;
    out.interest = i === null ? null : { on: i.on === true, rate_pct: field(i.rate_pct, 'Interest rate', 0, 100, false), grace_days: field(i.grace_days, 'Grace days', 0, MAX_DAYS, true) };
    if (out.interest && out.interest.on && !(out.interest.rate_pct > 0)) throw bad('Interest needs a rate above 0.');
  }
  if ('early' in b) {
    const x = b.early;
    out.early = x === null ? null : { pct: field(x.pct, 'Early-pay discount', 0, 100, false), within_days: field(x.within_days, 'Early-pay days', 0, MAX_DAYS, true) };
    if (out.early && out.early.pct > 0 && !(out.early.within_days > 0)) throw bad('Early-pay needs the number of days.');
  }
  return out;
}

/**
 * ⭐ THE ONE RESOLVER — what applies to this party: its own value if it has one, else the shop's default, else nothing.
 * shop: books_setting.terms · party: { credit_days, credit_limit_minor, terms } (the list row). Each answer says where it came from.
 */
function resolve(shop, party) {
  shop = shop || {}; party = party || {}; const po = party.terms || {};
  const pick = (own, dflt) => (own !== null && own !== undefined ? { value: Number(own), from: 'party' } : dflt !== null && dflt !== undefined ? { value: Number(dflt), from: 'shop' } : { value: null, from: null });
  const grp = (k) => (po[k] ? { value: po[k], from: 'party' } : shop[k] ? { value: shop[k], from: 'shop' } : { value: null, from: null });
  return { credit_days: pick(party.credit_days, shop.credit_days), credit_limit_minor: pick(party.credit_limit_minor, shop.credit_limit_minor), interest: grp('interest'), early: grp('early') };
}

/** the limit check: over only when a limit above 0 applies and owed + this sale passes it. All minor units. */
function limitCheck(limit_minor, owed_minor, amount_minor) {
  const lim = limit_minor == null ? null : Number(limit_minor);
  if (!(lim > 0)) return { applies: false, over: false };
  const after = Number(owed_minor || 0) + Number(amount_minor || 0);
  return { applies: true, over: after > lim, limit_minor: lim, owed_minor: Number(owed_minor || 0), after_minor: after };
}

/** the shop's default terms; {} when none */
async function shopTerms(db, e) {
  const r = await db.query('SELECT terms FROM books_setting WHERE entity_id = $1', [e]);
  return (r.rows[0] && r.rows[0].terms) || {};
}
/** the party's list row for a side: { credit_days, credit_limit_minor, terms } or null. `withTerms` false = before b298 ran. */
async function partyRow(db, e, party, side, withTerms) {
  const t = side === 'supplier' ? 'supplier_list' : 'customer_list', k = side === 'supplier' ? 'supplier_entity_id' : 'customer_identity_id';
  const r = await db.query(`SELECT credit_days, credit_limit_minor${withTerms ? ', terms' : ''} FROM ${t} WHERE owner_entity_id = $1 AND ${k} = $2`, [e, party]);
  return r.rows[0] || null;
}

const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
const show = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** save the shop default (merge: keys present change, others stay); one change row per changed key. Returns the new default. */
async function saveShop(db, e, body, by) {
  const c = clean(body), cur = await shopTerms(db, e), next = Object.assign({}, cur);
  for (const k of Object.keys(c)) { if (c[k] === null) delete next[k]; else next[k] = c[k]; }
  for (const k of Object.keys(c)) if (!same(cur[k], next[k])) await S.logChange(db, e, { by, table_name: 'terms', row_id: e, field: k, old: show(cur[k]), new: show(next[k]) });
  await db.query('UPDATE books_setting SET terms = $2::jsonb, updated_at = now() WHERE entity_id = $1', [e, JSON.stringify(next)]);
  return next;
}
/** save one party's override on a side: days + limit → their columns, interest/early → the terms jsonb. One change row per changed key. */
async function saveParty(db, e, party, side, body, by) {
  const c = clean(body), row = await partyRow(db, e, party, side, true);
  if (!row) throw Object.assign(bad('This party is not on your ' + (side === 'supplier' ? 'supplier' : 'customer') + ' list.'), { status: 404 });
  const t = side === 'supplier' ? 'supplier_list' : 'customer_list', k = side === 'supplier' ? 'supplier_entity_id' : 'customer_identity_id';
  const cur = row.terms || {}, next = Object.assign({}, cur), sets = [], vals = [e, party];
  for (const key of ['interest', 'early']) if (key in c) { if (c[key] === null) delete next[key]; else next[key] = c[key]; }
  for (const key of ['credit_days', 'credit_limit_minor']) if (key in c) { vals.push(c[key]); sets.push(`${key} = $${vals.length}`); }
  if ('interest' in c || 'early' in c) { vals.push(JSON.stringify(next)); sets.push(`terms = $${vals.length}::jsonb`); }
  const was = { credit_days: row.credit_days, credit_limit_minor: row.credit_limit_minor == null ? null : Number(row.credit_limit_minor), interest: cur.interest, early: cur.early };
  const now = Object.assign({}, was, { interest: next.interest, early: next.early }, 'credit_days' in c ? { credit_days: c.credit_days } : {}, 'credit_limit_minor' in c ? { credit_limit_minor: c.credit_limit_minor } : {});
  if (sets.length) await db.query(`UPDATE ${t} SET ${sets.join(', ')} WHERE owner_entity_id = $1 AND ${k} = $2`, vals);
  for (const key of Object.keys(c)) if (!same(was[key], now[key])) await S.logChange(db, e, { by, table_name: 'party_terms', row_id: party, field: side + '.' + key, old: show(was[key]), new: show(now[key]) });
  return resolve(await shopTerms(db, e), Object.assign({}, row, { credit_days: now.credit_days, credit_limit_minor: now.credit_limit_minor, terms: next }));
}
/** the change rows for one party (newest first, 50) — shown on the CRM record */
async function partyEvents(db, e, party) {
  const r = await db.query(`SELECT at, by, field, old, new FROM books_change_log WHERE entity_id = $1 AND table_name IN ('party_terms','credit_limit') AND row_id = $2 ORDER BY at DESC, id DESC LIMIT 50`, [e, String(party)]);
  return r.rows.map((x) => ({ at: x.at, by: x.by, field: x.field, old: x.old, new: x.new }));
}
async function shopEvents(db, e) {
  const r = await db.query(`SELECT at, by, field, old, new FROM books_change_log WHERE entity_id = $1 AND table_name = 'terms' ORDER BY at DESC, id DESC LIMIT 50`, [e]);
  return r.rows.map((x) => ({ at: x.at, by: x.by, field: x.field, old: x.old, new: x.new }));
}

module.exports = { migrated, clean, resolve, limitCheck, shopTerms, partyRow, saveShop, saveParty, partyEvents, shopEvents };

/* ── the server-side limit check on a CREDIT SALE (routes/chits.js /send) ───────────────────────────────────────── */
/** the credit part of a counter bill, in minor units — the bill's own tenders (payment.parts), read by the ledger's own word-to-mode rule */
function creditOf(bj) {
  const parts = (bj && bj.payment && Array.isArray(bj.payment.parts)) ? bj.payment.parts : [];
  const hooks = require('./books-hooks'), M = require('./money'), f = Math.pow(10, M.decimals ? M.decimals((bj && bj.currency) || 'INR') : 2);
  const major = parts.reduce((t, p) => t + (p && hooks.modeOf(p.how) === 'credit' ? Number(p.amount) || 0 : 0), 0);
  return Math.round(M.round ? M.round(major) * f : major * f);
}
/**
 * creditSaleCheck(entity, bj) → { over:false } | { over:true, party_id, limit_minor, owed_minor, after_minor }.
 * One transaction, and only when the bill has a credit part, names its customer, and the ledger is on (a cached read) — else no query.
 * Never throws: a check that cannot be made lets the sale through (the books' own posting still queues what it cannot post).
 */
async function creditSaleCheck(entity, bj) {
  try {
    const amount = creditOf(bj), pid = bj && bj.customer && bj.customer.entity_id ? String(bj.customer.entity_id) : null;
    if (!(amount > 0) || !pid) return { over: false };
    const hooks = require('./books-hooks');
    if (!(await hooks.isOn(entity))) return { over: false };
    const { withEntity } = require('../db'), B = require('./books'), E = require('./books-engines'), mig = await migrated();
    return await withEntity(entity, async (h) => {
      const row = await partyRow(h, entity, pid, 'customer', mig);
      const eff = resolve(mig ? await shopTerms(h, entity) : {}, row), lim = eff.credit_limit_minor.value;
      if (!(lim > 0)) return { over: false };
      const acct = await B.controlOf(h, entity, 'customer'), items = await B.partyItems(h, entity, pid, acct.account_id);
      const owed = items.length ? Number((E.receivables().outstanding(items).by_party || {})[pid] || 0) : 0;
      const c = limitCheck(lim, owed, amount);
      return c.over ? Object.assign({ party_id: pid }, c) : { over: false };
    });
  } catch (_) { return { over: false }; }
}
/** the sentence the counter and the shop show (money in the shop's own digits: minor / 100 is the display seam of a screen, so we name figures plainly) */
function overSentence(c) {
  const m = (x) => (Number(x) / 100).toFixed(2);
  return 'This sale takes them to ' + m(c.after_minor) + ' — over their credit limit of ' + m(c.limit_minor) + '. Only the owner can allow it.';
}
/** an allowed over-limit sale is an event on the party (shown on the CRM record) — after the fact, never able to fail the sale */
async function noteOverride(entity, c, by) {
  const { withEntity } = require('../db');
  await withEntity(entity, (h) => S.logChange(h, entity, { by, table_name: 'credit_limit', row_id: c.party_id, field: 'allowed', old: String(c.limit_minor), new: String(c.after_minor) }));
}
Object.assign(module.exports, { creditOf, creditSaleCheck, overSentence, noteOverride });
