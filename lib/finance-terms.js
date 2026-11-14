'use strict';
/*
 * OWNS      credit terms, the credit-limit check and who may override it.
 * CALLED BY routes/books.js · routes/chits.js (send).
 * FLOW      terms → creditSaleCheck → overrideBy → noteOverride
 * CARD      16-finance/finance-terms
 */
const { isOwner } = require('./owner');
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
const booksStore = require('./books-store');

const MAX_DAYS = 3650;
const badTerms = (m) => Object.assign(new Error(m), { status: 400, say: m });
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** the three columns exist? a yes is cached forever (lib/schema), a no is asked again after a minute */
async function migrated() {
  return (
    (await schema.hasColumn('books_setting', 'terms')) &&
    (await schema.hasColumn('customer_list', 'terms')) &&
    (await schema.hasColumn('supplier_list', 'terms'))
  );
}

/** one number field, or null (= not set); throws a shopkeeper sentence */
function field(v, name, lo, hi, whole) {
  const n = num(v);
  if (n === null) return null;
  if (!isFinite(n) || n < lo || n > hi || (whole && Math.floor(n) !== n))
    throw badTerms(name + ' must be ' + (whole ? 'a whole number' : 'a number') + ' from ' + lo + ' to ' + hi + '.');
  return n;
}
/** a posted terms body → the stored shape. Only keys PRESENT are returned (a missing key leaves the stored one alone); null clears. */
function clean(body) {
  body = body || {};
  const out = {};
  if ('credit_days' in body) out.credit_days = field(body.credit_days, 'Credit days', 0, MAX_DAYS, true);
  if ('credit_limit_minor' in body) out.credit_limit_minor = field(body.credit_limit_minor, 'Credit limit', 0, 9e15, true);
  if ('interest' in body) {
    const i = body.interest;
    out.interest =
      i === null
        ? null
        : { on: i.on === true, rate_pct: field(i.rate_pct, 'Interest rate', 0, 100, false), grace_days: field(i.grace_days, 'Grace days', 0, MAX_DAYS, true) };
    if (out.interest && out.interest.on && !(out.interest.rate_pct > 0)) throw badTerms('Interest needs a rate above 0.');
  }
  if ('early' in body) {
    const x = body.early;
    out.early =
      x === null ? null : { pct: field(x.pct, 'Early-pay discount', 0, 100, false), within_days: field(x.within_days, 'Early-pay days', 0, MAX_DAYS, true) };
    if (out.early && out.early.pct > 0 && !(out.early.within_days > 0)) throw badTerms('Early-pay needs the number of days.');
  }
  /* T3-P1-MONEY: the post-dated-cheque reminder — a SHOP-level switch in the same jsonb (one home for a finance setting): { on, lead_days }.
     GET /cheques feeds it to engines receivables.pdcReminders (pdcRemind below). Absent = on, 7 days ahead — what the route always did. */
  if ('pdc_remind' in body) {
    const remind = body.pdc_remind;
    out.pdc_remind = remind === null ? null : { on: remind.on !== false, lead_days: field(remind.lead_days == null ? PDC_LEAD_DAYS : remind.lead_days, 'Days ahead', 0, 90, true) };
  }
  return out;
}
/** the reminder as the cheques route reads it: the shop's switch, else on and 7 days ahead. `from` says whether the owner ever set it. */
const PDC_LEAD_DAYS = 7;
function pdcRemind(shop) {
  const p = (shop && shop.pdc_remind) || null;
  return { on: p ? p.on !== false : true, lead_days: p && p.lead_days != null ? Number(p.lead_days) : PDC_LEAD_DAYS, from: p ? 'shop' : null };
}

/**
 * ⭐ THE ONE RESOLVER — what applies to this party: its own value if it has one, else the shop's default, else nothing.
 * shop: books_setting.terms · party: { credit_days, credit_limit_minor, terms } (the list row). Each answer says where it came from.
 */
function resolve(shop, party) {
  shop = shop || {};
  party = party || {};
  const partyTerms = party.terms || {};
  const pick = (own, dflt) =>
    own !== null && own !== undefined
      ? { value: Number(own), from: 'party' }
      : dflt !== null && dflt !== undefined
        ? { value: Number(dflt), from: 'shop' }
        : { value: null, from: null };
  const termsGroup = (k) => (partyTerms[k] ? { value: partyTerms[k], from: 'party' } : shop[k] ? { value: shop[k], from: 'shop' } : { value: null, from: null });
  return {
    credit_days: pick(party.credit_days, shop.credit_days),
    credit_limit_minor: pick(party.credit_limit_minor, shop.credit_limit_minor),
    interest: termsGroup('interest'),
    early: termsGroup('early')
  };
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
  const t = side === 'supplier' ? 'supplier_list' : 'customer_list',
    k = side === 'supplier' ? 'supplier_entity_id' : 'customer_identity_id';
  const r = await db.query(`SELECT credit_days, credit_limit_minor${withTerms ? ', terms' : ''} FROM ${t} WHERE owner_entity_id = $1 AND ${k} = $2`, [
    e,
    party
  ]);
  return r.rows[0] || null;
}

/**
 * CB Finance · Collections (GET /dues?finance=1, T1-FINREW FIN-R1): every customer's own days · limit · terms and the shop's default,
 * ONE read each, never per party. → { shop, by_party: Map(party_id → { credit_days, credit_limit_minor, terms }) } — each fed to resolve().
 * Before b298 the terms columns are absent: no shop default, and a customer's row still answers its own days and limit (as before).
 */
async function customerTerms(db, e) {
  const isMigrated = await migrated();
  const shop = isMigrated ? await shopTerms(db, e) : {};
  const result = await db.query(
    `SELECT customer_identity_id AS party_id, credit_days, credit_limit_minor${isMigrated ? ', terms' : ''} FROM customer_list WHERE owner_entity_id = $1`,
    [e]
  );
  return {
    shop,
    by_party: new Map(result.rows.map((x) => [String(x.party_id), { credit_days: x.credit_days, credit_limit_minor: x.credit_limit_minor, terms: x.terms || null }]))
  };
}

const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
const show = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** save the shop default (merge: keys present change, others stay); one change row per changed key. Returns the new default. */
async function saveShop(db, e, body, by) {
  const cleaned = clean(body),
    current = await shopTerms(db, e),
    next = Object.assign({}, current);
  for (const k of Object.keys(cleaned)) {
    if (cleaned[k] === null) delete next[k];
    else next[k] = cleaned[k];
  }
  for (const k of Object.keys(cleaned))
    if (!same(current[k], next[k])) await booksStore.logChange(db, e, { by, table_name: 'terms', row_id: e, field: k, old: show(current[k]), new: show(next[k]) });
  await db.query('UPDATE books_setting SET terms = $2::jsonb, updated_at = now() WHERE entity_id = $1', [e, JSON.stringify(next)]);
  return next;
}
/** save one party's override on a side: days + limit → their columns, interest/early → the terms jsonb. One change row per changed key. */
async function saveParty(db, e, party, side, body, by) {
  const cleaned = clean(body),
    row = await partyRow(db, e, party, side, true);
  if (!row) throw Object.assign(badTerms('This party is not on your ' + (side === 'supplier' ? 'supplier' : 'customer') + ' list.'), { status: 404 });
  const listKey = side === 'supplier' ? 'supplier_list' : 'customer_list',
    k = side === 'supplier' ? 'supplier_entity_id' : 'customer_identity_id';
  const current = row.terms || {},
    next = Object.assign({}, current),
    sets = [],
    vals = [e, party];
  for (const key of ['interest', 'early'])
    if (key in cleaned) {
      if (cleaned[key] === null) delete next[key];
      else next[key] = cleaned[key];
    }
  for (const key of ['credit_days', 'credit_limit_minor'])
    if (key in cleaned) {
      vals.push(cleaned[key]);
      sets.push(`${key} = $${vals.length}`);
    }
  if ('interest' in cleaned || 'early' in cleaned) {
    vals.push(JSON.stringify(next));
    sets.push(`terms = $${vals.length}::jsonb`);
  }
  const before = {
    credit_days: row.credit_days,
    credit_limit_minor: row.credit_limit_minor == null ? null : Number(row.credit_limit_minor),
    interest: current.interest,
    early: current.early
  };
  const now = Object.assign(
    {},
    before,
    { interest: next.interest, early: next.early },
    'credit_days' in cleaned ? { credit_days: cleaned.credit_days } : {},
    'credit_limit_minor' in cleaned ? { credit_limit_minor: cleaned.credit_limit_minor } : {}
  );
  if (sets.length) await db.query(`UPDATE ${listKey} SET ${sets.join(', ')} WHERE owner_entity_id = $1 AND ${k} = $2`, vals);
  for (const key of Object.keys(cleaned))
    if (!same(before[key], now[key]))
      await booksStore.logChange(db, e, { by, table_name: 'party_terms', row_id: party, field: side + '.' + key, old: show(before[key]), new: show(now[key]) });
  return resolve(await shopTerms(db, e), Object.assign({}, row, { credit_days: now.credit_days, credit_limit_minor: now.credit_limit_minor, terms: next }));
}
/** the change rows for one party (newest first, 50) — shown on the CRM record */
async function partyEvents(db, e, party) {
  const r = await db.query(
    `SELECT at, by, field, old, new FROM books_change_log WHERE entity_id = $1 AND table_name IN ('party_terms','credit_limit') AND row_id = $2 ORDER BY at DESC, id DESC LIMIT 50`,
    [e, String(party)]
  );
  return r.rows.map((x) => ({ at: x.at, by: x.by, field: x.field, old: x.old, new: x.new }));
}
async function shopEvents(db, e) {
  const r = await db.query(
    `SELECT at, by, field, old, new FROM books_change_log WHERE entity_id = $1 AND table_name = 'terms' ORDER BY at DESC, id DESC LIMIT 50`,
    [e]
  );
  return r.rows.map((x) => ({ at: x.at, by: x.by, field: x.field, old: x.old, new: x.new }));
}

module.exports = {
  migrated,
  clean,
  resolve,
  limitCheck,
  shopTerms,
  partyRow,
  customerTerms,
  saveShop,
  saveParty,
  partyEvents,
  shopEvents,
  pdcRemind,
  PDC_LEAD_DAYS
};

/* ── the server-side limit check on a CREDIT SALE (routes/chits.js /send) ───────────────────────────────────────── */
/** the credit part of a counter bill, in minor units — the bill's own tenders (payment.parts), read by the ledger's own word-to-mode rule */
function creditOf(bj) {
  const parts = bj && bj.payment && Array.isArray(bj.payment.parts) ? bj.payment.parts : [];
  const hooks = require('./books-hooks');
  const major = parts.reduce((total, item) => total + (item && hooks.modeOf(item.how) === 'credit' ? Number(item.amount) || 0 : 0), 0);
  /* ACC-179: the api's ONE major → minor. A bill with no currency is counted in 2 decimals, as before (money.decimals of none) — the shop's own is on the check's answer */
  return require('./books-cashflow').toMinor(major, bj && bj.currency);
}
/**
 * creditSaleCheck(entity, bj) → { over:false } | { over:true, party_id, limit_minor, owed_minor, after_minor }.
 * One transaction, and only when the bill has a credit part, names its customer, and the ledger is on (a cached read) — else no query.
 * Never throws: a check that cannot be made lets the sale through (the books' own posting still queues what it cannot post).
 */
async function creditSaleCheck(entity, businessJson) {
  try {
    const amount = creditOf(businessJson),
      pid = businessJson && businessJson.customer && businessJson.customer.entity_id ? String(businessJson.customer.entity_id) : null;
    if (!(amount > 0) || !pid) return { over: false };
    const hooks = require('./books-hooks');
    const setting = await hooks.isOn(entity); /* the cached switch is the books setting: its currency words the sentence (ACC-179), no extra read */
    if (!setting) return { over: false };
    const { withEntity } = require('../db'),
      booksModule = require('./books'),
      booksEngines = require('./books-engines'),
      isMigrated = await migrated();
    return await withEntity(entity, async (scopedDb) => {
      const row = await partyRow(scopedDb, entity, pid, 'customer', isMigrated);
      const effective = resolve(isMigrated ? await shopTerms(scopedDb, entity) : {}, row),
        limit = effective.credit_limit_minor.value;
      if (!(limit > 0)) return { over: false };
      const acct = await booksModule.controlOf(scopedDb, entity, 'customer'),
        items = await booksModule.partyItems(scopedDb, entity, pid, acct.account_id);
      const posted = items.length ? Number((booksEngines.receivables().outstanding(items).by_party || {})[pid] || 0) : 0;
      const waiting = await pendingCreditOf(scopedDb, entity, pid, businessJson); /* FIN-56: bills parked in books_outbox owe too, though the ledger has not posted them */
      const verdict = limitCheck(limit, posted + waiting, amount);
      return verdict.over ? Object.assign({ party_id: pid, currency: booksModule.curOf(setting) }, verdict) : { over: false };
    });
  } catch (err) {
    /* a currency mismatch is REFUSED, named, never converted (CURRENCY_MISMATCH); any other trouble lets the sale through, as before */
    if (err && err.code === 'CURRENCY_MISMATCH') return { over: false, mismatch: err.message };
    return { over: false };
  }
}
/**
 * FIN-56 (M7a): the credit still WAITING to post for one customer, in minor units — the credit part (creditOf, the one reader) of the shop's own sent bills
 * that hold an open books_outbox row (done_at IS NULL), leaving out a Mark-paid press row and the bill being checked itself (its own client_ref, so a retry never counts twice).
 * A bill in another currency than the one being checked is refused, never converted: it carries code CURRENCY_MISMATCH.
 */
async function pendingCreditOf(handle, entity, pid, thisBill) {
  if (!(await require('./schema').hasTable('books_outbox'))) return 0;
  const waiting = await handle.query(
    `SELECT h.business_json FROM chit_header h
       LEFT JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id AND s.direction = h.direction
      WHERE h.entity_id = $1 AND h.direction = 'sent' AND h.business_json->'customer'->>'entity_id' = $2
        AND ($3 = '' OR COALESCE(h.business_json->>'client_ref', '') <> $3) AND COALESCE(s.current_status, '') NOT IN ('cancelled', 'rejected')
        AND EXISTS (SELECT 1 FROM books_outbox o WHERE o.entity_id = h.entity_id AND o.source_chit_id = h.chit_id AND o.done_at IS NULL AND COALESCE(o.event->>'press', '') = '')
      ORDER BY h.created_at LIMIT 500`,
    [entity, pid, String((thisBill && thisBill.client_ref) || '')]
  );
  const Money = require('./money');
  return waiting.rows.reduce((total, row) => {
    const other = row.business_json || {};
    const owing = creditOf(other);
    if (owing > 0) sameMoneyOrRefuse(Money, other, thisBill);
    return total + owing;
  }, 0);
}
/** the one currency rule (money.assertSameCurrency) with this check's code on its refusal — an amount is labelled, never converted */
function sameMoneyOrRefuse(Money, waitingBill, thisBill) {
  try {
    Money.assertSameCurrency({ amount: 0, currency: waitingBill.currency }, { amount: 0, currency: thisBill.currency }, 'A bill waiting for the books');
  } catch (err) {
    err.code = 'CURRENCY_MISMATCH';
    throw err;
  }
}
/** the sentence the counter and the shop show: figures plainly, in the currency's own decimals (c.currency — the shop's, from creditSaleCheck). ACC-179: it was minor / 100 to 2 places for every currency. */
function overSentence(c) {
  const cashflow = require('./books-cashflow'),
    places = require('./money').decimals(c.currency);
  const m = (x) => cashflow.fromMinor(x, c.currency).toFixed(places);
  // ACC-179: a c with no currency (limitCheck's bare answer — no caller sends one today) is worded in 2 places, as before (money.decimals of none)
  return 'This sale takes them to ' + m(c.after_minor) + ' — over their credit limit of ' + m(c.limit_minor) + '. Only the owner can allow it.';
}
/** an allowed over-limit sale is an event on the party (shown on the CRM record) — after the fact, never able to fail the sale */
async function noteOverride(entity, c, by) {
  const { withEntity } = require('../db');
  await withEntity(entity, (h) =>
    booksStore.logChange(h, entity, { by, table_name: 'credit_limit', row_id: c.party_id, field: 'allowed', old: String(c.limit_minor), new: String(c.after_minor) })
  );
}
/** a typed, non-blank reason on an override (ACC-206: the money bridge's override must say why) */
const hasReason = (override) => typeof override.why === 'string' && override.why.trim() !== '';
/**
 * overrideBy(req, ov) → the id who allowed an over-limit credit sale, or null when nobody may. SEC-FIX3 S3: the OWNER's own login
 * (named from the session, never the body) or a counter KEY (the till checked the owner's counter PIN; its `by` is the person on
 * shift). req.till is set on EVERY request, so its mere presence proved nothing — an editor could name the owner.
 * ACC-206 (the money bridge's override, 2026-10-30): the SAME helper, widened — `opts.needWhy` also requires a typed reason (`override.why`, a non-blank string),
 * because an owner who lets an unbalanced sale through says why. The money override is the owner's alone, exactly as the credit limit's.
 */
function overrideBy(req, override, opts) {
  if (!override || !override.by) return null;
  if (opts && opts.needWhy && !hasReason(override)) return null;
  if (isOwner(req)) return String(req.identity.identity_id);
  const holder = req.till || {};
  return holder.kind === 'key' && holder.counter ? String(override.by) : null;
}
Object.assign(module.exports, { creditOf, creditSaleCheck, overSentence, noteOverride, overrideBy });
