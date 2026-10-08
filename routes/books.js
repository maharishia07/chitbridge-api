// @stage built
// @stage-note [BOOKS v2] /api/books — the ledger's reads (day book, ledgers, statement, dues, trial balance, P&L, balance
// @stage-note sheet) and its few writes (payments, manual entries, reversals, month locks, opening, packs). 404 while off.
'use strict';
/**
 * routes/books.js — SPEC-books-v2 §5, in the shapes the Ledger screen reads (chitbridge-web public/app/cap-books.js).
 *
 * ⚠️⚠️ SCREENS NEVER CALL THIS "ACCOUNTING". The words are Ledger, Day book, Dues, Statement, Trial balance (Athi).
 * ⭐ 404-QUIET WHILE OFF: every route answers 404 until the shop's switch is on — a shop without the ledger sees no door
 *   (the web probes /health once a session). Only GET /status and POST /enable (the owner's switch) answer while off.
 * ⭐ EVERY READ AND WRITE RUNS AS THE SHOP (withEntity) — the books tables are FORCE RLS.
 * ⭐ WRITES GO THROUGH lib/books.js postEntry (the one writer); the figures come from the engines (CBLedger et al.)
 *   through lib/books-engines.js. This file shapes answers; it computes no balance of its own.
 * ⚠️ OWNER-ONLY, enforced HERE (the screen does not check role): manual entries, reversals, write-offs, month locks
 *   (hard or soft), opening balances, packs, the switch, a new ledger. A co-assist may read and record a payment (the
 *   hat gate still decides whether their hat may write at all).
 * ⚠️⚠️ NO API KEY REACHES THE LEDGER (critic M9, 2026-09-30). The counter sends a chit and calls nothing here, so its key
 *   lost these routes in middleware/auth.js KEY_ROUTES; `noKey` is the second fence on the five that used to be listed.
 * ⭐ A SECOND TAP NEVER RECORDS TWICE (M11): payments, opening balances, write-offs and manual entries take `client_ref`
 *   (unique per shop) — the same ref answers 200 with the FIRST result and `duplicate: true`.
 * Money in and out is *_minor (integer minor units) with the currency beside it.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const B = require('../lib/books');
const E = require('../lib/books-engines');
const S = require('../lib/books-store');

const ctx = (req) => auth.entityOf(req);
const { isOwner } = require('../lib/owner');   /* one owner test — the folder inventory's switch reads it too */
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);
const dateQ = (v, d) => (DATE.test(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : d);
/* minor units in; an amount in rupees is rounded by money.round (the one rounder) first, never by a copy of the rule */
const minorOf = (b) => (b.amount_minor != null ? Math.round(Number(b.amount_minor)) : Math.round(require('../lib/money').round(Number(b.amount)) * 100));
const WORD = { walkin_day: 'Walk-in sales', sale_bill: 'Sale', purchase_bill: 'Purchase', payment_received: 'Payment received', payment_made: 'Payment made',
  credit_given: 'Credit given', expense: 'Expense', other_income: 'Income', return: 'Return', credit_note: 'Credit note', purchase_return: 'Returned to supplier',
  write_off: 'Written off', opening: 'Opening balance', manual: 'Journal', reversal: 'Reversal' };

function fail(res, e) {
  /* ⭐ a typed date in a locked month: 409 with a code the web's friendlyErr maps (and its exact sentence) */
  if (e && e.code === 'PERIOD_LOCKED') return res.status(409).json({ code: 'PERIOD_LOCKED', error: e.message, message: e.message });
  if (e && e.code === 'YEAR_CLOSED') return res.status(409).json({ code: 'YEAR_CLOSED', error: e.message, message: e.message });
  if (e && e.code === 'SUSPENSE_NOT_NIL') return res.status(409).json({ code: 'SUSPENSE_NOT_NIL', error: e.message, message: e.message });
  if (e && e.code === 'BOOKS_NOT_FOUND') return res.status(404).json({ error: 'Not found', message: e.message });
  /* ⚠️ before the 422: "not migrated" is thrown as a refusal too, and read as 422 — missing tables are the server's state, 503 */
  if (e && (e.code === 'BOOKS_ENGINE' || e.code === 'BOOKS_NOT_MIGRATED')) return res.status(503).json({ code: e.code, error: e.message, message: e.message });
  /* a question the owner can answer (a missing field, a date that is not a date): 400, in words */
  if (e && e.code === 'BOOKS_BAD_REQUEST') return res.status(400).json({ error: e.message, message: e.message });
  if (e && (e.refused || e.code === 'BOOKS_REFUSED')) return res.status(422).json({ error: e.message, message: e.message });
  if (e && (e.status === 409 || e.status === 422)) return res.status(e.status).json({ error: e.message, message: e.message });
  if (e && e.code === '23505') return res.status(409).json({ error: 'That is already recorded.', message: 'That is already recorded.' });
  return res.status(500).json({ error: 'Failed', message: String((e && e.message) || e).slice(0, 300) });
}
/** a key-bearer (a counter, a TV, a connector) has no business in the ledger — the second fence behind KEY_ROUTES */
function noKey(req, res, next) {
  if (req.api_key) return res.status(403).json({ error: 'Sign in to use the ledger.', message: 'Sign in to use the ledger.' });
  next();
}
function owner(req, res, next) {
  if (!isOwner(req)) return res.status(403).json({ error: 'Only the owner may do this.', message: 'Only the owner may do this.' });
  next();
}
/** the gate: the shop's ledger must be on, else a quiet 404 */
async function on(req, res, next) {
  try {
    const e = ctx(req);
    const s = await withEntity(e, (h) => B.settingOf(h, e));
    if (!s || !s.enabled) return res.status(404).json({ error: 'Not found' });
    req.books = s; next();
  } catch (err) { fail(res, err); }
}
const curOf = (req) => (req.books && req.books.functional_currency) || 'INR';

/* ── the switch ─────────────────────────────────────────────────────────────────────────────────────────────── */
router.get('/status', auth, owner, async (req, res) => {
  try {
    const e = ctx(req);
    const s = await withEntity(e, (h) => B.settingOf(h, e));
    res.json({ migrated: s !== null, enabled: !!(s && s.enabled), walkin_grain: s ? s.walkin_grain : null, engines: E.status() });
  } catch (err) { fail(res, err); }
});
router.post('/enable', auth, owner, async (req, res) => {
  try {
    const b = req.body || {};
    const grain = ['day', 'shift', 'bill'].indexOf(b.walkin_grain) >= 0 ? b.walkin_grain : undefined;
    const r = await B.enable(null, ctx(req), { by: byOf(req), walkin_grain: grain });
    require('../lib/books-hooks').forget(ctx(req));
    res.json(r);
  } catch (err) { fail(res, err); }
});
router.post('/setting', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req), b = req.body || {}, s = req.books;
    const grain = ['day', 'shift', 'bill'].indexOf(b.walkin_grain) >= 0 ? b.walkin_grain : s.walkin_grain;
    const enabled = b.enabled !== false;
    await withEntity(e, async (h) => {
      await S.saveSetting(h, e, Object.assign({}, s, { enabled, walkin_grain: grain }));
      if (grain !== s.walkin_grain) await S.logChange(h, e, { by: byOf(req), table_name: 'books_setting', row_id: e, field: 'walkin_grain', old: s.walkin_grain, new: grain });
      if (!enabled) await S.logChange(h, e, { by: byOf(req), table_name: 'books_setting', row_id: e, field: 'enabled', old: 'true', new: 'false' });
    });
    require('../lib/books-hooks').forget(e);
    res.json({ ok: true, enabled, walkin_grain: grain });
  } catch (err) { fail(res, err); }
});
/**
 * GET /health → { enabled, currency, walkin_grain, last_check, engines, waiting: [{ id, chit_id, ref, reason, tries, since, job }] }
 * — the web's probe (404 = off) and the to-do list: `waiting` is every post that failed or was parked, least-tried first,
 * each with the `reason` it could not post (lib/books-hooks waitingRow; POST /outbox/retry tries them again).
 */
router.get('/health', auth, on, async (req, res) => {
  try {
    const e = ctx(req);
    const waiting = await withEntity(e, (h) => S.waiting(h, e, 50));
    res.json({ enabled: true, currency: curOf(req), walkin_grain: req.books.walkin_grain, last_check: req.books.last_check || null, engines: E.status(),
      waiting: waiting.map(require('../lib/books-hooks').waitingRow) });
  } catch (err) { fail(res, err); }
});
router.post('/check', auth, owner, on, async (req, res) => {
  try { res.json(await require('../lib/books-nightly').check(ctx(req))); } catch (err) { fail(res, err); }
});
router.post('/outbox/retry', auth, owner, on, async (req, res) => {
  try { res.json(await require('../lib/books-hooks').retryOutbox(ctx(req), 100)); } catch (err) { fail(res, err); }
});

/* ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** GET /accounts → { accounts: [{ account_id, code, name, is_group, tally_group, nature, role, parent_code }] } */
router.get('/accounts', auth, on, async (req, res) => {
  try {
    const e = ctx(req);
    const chart = await withEntity(e, (h) => S.accounts(h, e));
    const codeOf = new Map(chart.map((a) => [String(a.account_id), a.code]));
    res.json({ accounts: chart.map((a) => ({ account_id: a.account_id, code: a.code, name: a.name, is_group: !!a.is_group, tally_group: a.tally_group,
      nature: a.nature, role: a.role, parent_code: a.parent_id ? codeOf.get(String(a.parent_id)) || null : null, active: a.active !== false })) });
  } catch (err) { fail(res, err); }
});
/** POST /accounts { name, parent_code | parent_id } → { account: { code, account_id, name } } — the code is the system's (engines nextCode, role null); one typed here is refused (422) */
router.post('/accounts', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req), b = req.body || {};
    let parent = b.parent_id;
    if (!parent && b.parent_code) parent = ((await withEntity(e, (h) => S.accounts(h, e))).find((a) => String(a.code) === String(b.parent_code) && a.is_group) || {}).account_id;
    const r = await B.addAccount(null, e, { name: b.name, parent_id: parent, code: b.code != null ? b.code : b.account_code, by: byOf(req) });
    res.json({ ok: true, account: { code: r.code, account_id: r.account_id, name: r.name } });
  } catch (err) { fail(res, err); }
});

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function fyStart(req, d) { const pack = B.packOf(req.books); const A = E.packs(); return A.fyRange(A.fiscalYearOf(d, pack), pack).start; }
/**
 * ⭐ WHERE AN ENTRY CAME FROM (Athi, 2026-10-01, the first real entry: "where is it referenced to the sale record, how do I
 * connect to the sale record, who has done it?") — from the src_* columns S.entryLines reads in its own query:
 *   { chit_id   the shop's OWN chit (null when it is not the shop's — the screen links only what it can open)
 *     ref       the number as printed (printed_as → bill_no → the receipt's R/… number)
 *     kind      bill · purchase · receipt · payment · credit_note · expense · income · day · write_off · reversal · …
 *     counter   the counter it was billed on (C2) — the chit's, else the day's source_ref, else a line's
 *     by        who was signed in at the counter (business_json.till.by), else who wrote the entry (created_by → identities)
 *     count     a walk-in day: how many bills it covers }
 * null for an entry with no chit behind it (a payment typed in the Ledger, an opening, a manual entry).
 * ⚠️ A walk-in day names no seller: many people sold those bills, and "by" on it would read as if one person sold them all.
 */
const KIND = { sale_bill: 'bill', purchase_bill: 'purchase', payment_received: 'receipt', payment_made: 'payment', return: 'credit_note', purchase_return: 'credit_note',
  expense: 'expense', other_income: 'income', write_off: 'write_off', reversal: 'reversal', manual: 'manual', opening: 'opening', credit_given: 'bill' };
function sourceOf(l) {
  const day = Number(l.covers) > 0 && !l.source_chit_id;
  if (!l.source_chit_id && !day) return null;
  const m = /^walkin:([^:]+):/.exec(String(l.source_ref || ''));
  const b = l.src_by;
  /* ⭐ M09: a PHONE's bill says `till.by` as the identity id the session is checked against and the NAME beside it as
     `till.by_name` (till.html tillStamp); a key's bill still sends { id, name, kind }. The books show the name either way. */
  const seller = b && typeof b === 'object' ? (b.name || null)
    : (l.src_by_name && String(l.src_by_name).trim()) ? String(l.src_by_name).trim()
    : (typeof b === 'string' && b.trim() ? b.trim() : null);
  const pay = howOf(l, day);
  return { chit_id: l.src_chit_id || null, ref: l.src_ref || null, kind: day ? 'day' : (l.event_type === 'walkin_day' ? 'bill' : KIND[l.event_type] || l.event_type || null),
    counter: l.src_till || (m ? m[1] : null) || l.counter_id || null, by: day ? null : (seller || l.by_name || null),
    count: day ? Number(l.covers) : null, how: pay.how, how_ref: pay.how_ref, split: pay.split,
    doc_at: day ? null : momentOf(l.src_billed_at) || momentOf(l.src_created_at), recorded_at: momentOf(l.recorded_at) };
}
/**
 * ⭐ BOTH TIMES (Athi, 2026-10-01: "the time the bill was made or the time the entry was accepted? both should be there"):
 *   doc_at       the chit's own moment, ISO — the counter's billed_at (a receipt's at), else the chit's created_at; null
 *                for a walk-in day (many bills) or a chit that is not the shop's
 *   recorded_at  the entry's created_at — when the ledger accepted it
 * ⚠️ billed_at is the counter's free text: a value that is not a moment is skipped, never passed on as one.
 */
function momentOf(v) {
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return isFinite(t) ? new Date(t).toISOString() : null;
}
/**
 * ⭐ HOW IT WAS PAID (Athi, 2026-10-01: "it has to clearly segregate credit, cash, UPI (UPI id) and so on"):
 *   how      a bill: its tenders as the counter recorded them, in order — 'Cash' · 'On credit' · 'Cash + UPI'
 *            a receipt: its mode ('UPI', 'Cheque') · a walk-in day: the tenders of its split ('Cash · UPI · Card')
 *   how_ref  the reference the counter kept with a tender (a part's ref / reference / utr), a receipt's cheque number
 *            (and bank) — null when none was recorded (⚠️ the counter does not ask for a UPI reference on a bill today)
 *   split    a walk-in day only: [{ how, amount_minor }] from the entry's OWN debit lines (cash · UPI · card · bank)
 * The words come through the posting rules' own reader (books-hooks modeOf); a tender it does not know keeps its word.
 */
const HOW = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', bank: 'Bank', credit: 'On credit' };
function howWord(w) { const m = require('../lib/books-hooks').modeOf(w); return m ? HOW[m] : (String(w || '').trim() || null); }
function howOf(l, day) {
  if (day) {
    const split = [];
    (Array.isArray(l.tenders) ? l.tenders : []).forEach((t) => { const w = HOW[t.role] || t.role, x = split.find((s) => s.how === w);
      if (x) x.amount_minor += Number(t.dr_minor); else split.push({ how: w, amount_minor: Number(t.dr_minor) }); });
    return { how: split.length ? split.map((s) => s.how).join(' · ') : null, how_ref: null, split: split.length ? split : null };
  }
  if (l.src_mode) {
    const c = l.src_cheque && typeof l.src_cheque === 'object' ? l.src_cheque : null;
    return { how: howWord(l.src_mode), how_ref: c && c.no ? [c.no, c.bank].filter(Boolean).join(' · ') : null, split: null };
  }
  const parts = Array.isArray(l.src_parts) ? l.src_parts.filter((p) => p && p.how) : [];
  const words = []; parts.forEach((p) => { const w = howWord(p.how); if (w && words.indexOf(w) < 0) words.push(w); });
  const r = parts.map((p) => p.ref || p.reference || p.utr).find((x) => x != null && String(x).trim());
  return { how: words.length ? words.join(' + ') : null, how_ref: r ? String(r).trim() : null, split: null };
}
async function partyNames(h, e) {
  const m = new Map(); (await S.parties(h, e)).forEach((p) => m.set(String(p.party_id), p)); return m;
}

/** GET /daybook?from&to → { currency, entries: [{ entry_no, posting_date, source_chit_id, source: { chit_id, ref, kind, counter, by, count, how, how_ref, split, doc_at, recorded_at } | null, narration,
 *  lines: [{ code, name, party_id, party_name, dr_minor, cr_minor, counter, rate }] }] } — `source` is sourceOf(), read in the same query as the lines */
router.get('/daybook', auth, on, async (req, res) => {
  try {
    const e = ctx(req), from = dateQ(req.query.from, today()), to = dateQ(req.query.to, from);
    const out = await withEntity(e, async (h) => {
      const lines = await S.entryLines(h, e, from, to, null, null);
      const names = await partyNames(h, e);
      const entries = [], at = new Map();
      for (const l of lines) {
        let x = at.get(l.entry_id);
        if (!x) { x = { entry_id: l.entry_id, entry_no: l.entry_no, posting_date: E.ymd(l.posting_date), doc_date: E.ymd(l.doc_date), event_type: l.event_type,
                        narration: l.narration || WORD[l.event_type] || l.event_type, source_chit_id: l.source_chit_id, reverses_entry_id: l.reverses_entry_id,
                        source: sourceOf(l), lines: [] }; at.set(l.entry_id, x); entries.push(x); }
        if (x.source && !x.source.counter && l.counter_id) x.source.counter = l.counter_id;
        const p = l.party_id ? names.get(String(l.party_id)) : null;
        x.lines.push({ code: l.code, name: l.account_name, party_id: l.party_id, party_name: p ? (p.nickname || p.name) : null, dr_minor: Number(l.dr_minor), cr_minor: Number(l.cr_minor), counter: l.counter_id,
          rate: l.tax_rate == null || l.tax_rate === '' ? null : Number(l.tax_rate) });   /* the tax rate the line was posted at - the Day book writes "@ 12%" beside it */
      }
      return entries;
    });
    res.json({ currency: curOf(req), from, to, entries: out, count: out.length });
  } catch (err) { fail(res, err); }
});

/** GET /ledger/:account?party&from&to — :account is the code (1300), the role (debtors) or the id →
 *  { currency, account, opening_minor, lines: [{ date, what, ref, source_chit_id, source (as the day book), dr_minor, cr_minor, running_minor }], closing_minor } */
router.get('/ledger/:account', auth, on, async (req, res) => {
  try {
    const e = ctx(req), to = dateQ(req.query.to, today()), from = dateQ(req.query.from, fyStart(req, to));
    const party = UUID.test(String(req.query.party || '')) ? String(req.query.party) : null;
    const out = await withEntity(e, async (h) => {
      const key = String(req.params.account);
      const chart = await S.accounts(h, e);
      const a = chart.find((x) => String(x.code) === key) || chart.find((x) => x.role === key) || chart.find((x) => String(x.account_id) === key);
      if (!a || a.is_group) return null;
      const open = (await B.ledgerOf(h, e, a, party, from, to)).opening_minor;
      const rows = await S.entryLines(h, e, from, to, a.account_id, party);
      let run = open;
      const lines = rows.map((l) => { run += Number(l.dr_minor) - Number(l.cr_minor); return { date: E.ymd(l.posting_date), doc_date: E.ymd(l.doc_date), what: l.narration || WORD[l.event_type] || l.event_type,
        ref: l.entry_no, source_chit_id: l.source_chit_id, source: sourceOf(l), party_id: l.party_id, dr_minor: Number(l.dr_minor), cr_minor: Number(l.cr_minor), running_minor: run }; });
      return { account: { code: a.code, name: a.name, nature: a.nature }, party, from, to, opening_minor: open, lines, closing_minor: run };
    });
    if (!out) return res.status(404).json({ error: 'Not found', message: 'No such ledger.' });
    res.json(Object.assign({ currency: curOf(req) }, out));
  } catch (err) { fail(res, err); }
});

/** GET /party/:id/statement?from&to → CBLedger.partyStatement, as { currency, party_id, from, to, code, opening_minor, lines: [{ date, what, ref, source_chit_id, source (as the day book's), dr_minor, cr_minor, running_minor }], closing_minor } */
router.get('/party/:id/statement', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const to = dateQ(req.query.to, today()), from = dateQ(req.query.from, fyStart(req, to));
    const out = await withEntity(e, async (h) => {
      const st = E.ledger().partyStatement({ ...(await statementInput(h, e, id, from, to)), party: id, from, to });
      const meta = new Map((await S.ledgerLines(h, e, from, to, id)).map((l) => [String(l.entry_id), l]));
      /* where each entry came from (its bill, how it was paid, the counter, who rang it) - the same `source` the day book and a ledger carry, so a party's own ledger reads like theirs */
      const src = new Map(); (await S.entryLines(h, e, from, to, null, id)).forEach((l) => { if (!src.has(String(l.entry_id))) src.set(String(l.entry_id), l); });
      return { code: st.code, opening_minor: st.opening_minor, closing_minor: st.closing_minor,
        lines: st.rows.map((r) => { const m = meta.get(String(r.entry_id)) || {}; return { date: r.date, what: r.narration || WORD[m.event_type] || m.event_type || '', ref: r.jv_no,
          source_chit_id: m.source_chit_id || null, source: src.has(String(r.entry_id)) ? sourceOf(src.get(String(r.entry_id))) : null, dr_minor: r.dr_minor, cr_minor: r.cr_minor, running_minor: r.running_minor }; }) };
    });
    res.json(Object.assign({ currency: curOf(req), party_id: id, from, to }, out));
  } catch (err) { fail(res, err); }
});
async function statementInput(h, e, party, from, to) {
  const c = await B.ledgerCtx(h, e); const A = E.packs();
  return { pack: c.pack, balances: await B.yearBalances(h, e, A.fiscalYearOf(from, c.pack), c),
           lines: (await S.ledgerLines(h, e, B.monthStart(c.pack, from), to, party)).map(E.lineOf) };
}

/**
 * GET /dues?asOf&side=customer|supplier → { currency, asOf, parties: [{ party_id, party_no, name, side, balance_minor (+ they owe
 * you, − you owe them), oldest_due, disputed_minor, buckets }], total_minor } — CBReceivables.outstanding → CBLedger.ageing.
 * Without `side`: both, one row per party (a party on both lists nets). ⚠️ A supplier's buckets are Schedule III's
 * PAYABLE ones (not_due · lt_1y · y1_2 · y2_3 · gt_3y) — the six receivable columns do not apply to them.
 */
router.get('/dues', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), asOf = dateQ(req.query.asOf, today());
    const sides = req.query.side === 'customer' ? ['debtors'] : req.query.side === 'supplier' ? ['creditors'] : ['debtors', 'creditors'];
    const out = await withEntity(e, async (h) => {
      const chart = await S.accounts(h, e), names = await partyNames(h, e), per = new Map();
      for (const role of sides) {
        const a = chart.find((x) => x.role === role); if (!a) continue;
        const side = role === 'creditors' ? 'payable' : 'receivable', sign = role === 'creditors' ? -1 : 1;
        /* created_at is a MOMENT: its day is the shop's (dayOf), never E.ymd — that reads `date` columns */
        const items = (await S.items(h, e, null, a.account_id)).filter((i) => require('../lib/books-hooks').dayOf(i.created_at, req.books.country) <= asOf).map(E.itemOf);
        const d = E.dues(items, asOf, side);
        const byRef = d.outstanding.by_ref || {};
        Object.keys(d.ageing.by_party || {}).concat(Object.keys(d.outstanding.by_party || {})).forEach((pid) => {
          if (per.has(pid + '|' + role)) return;
          const ag = d.ageing.by_party[pid] || { undisputed: {}, disputed: {}, total_minor: 0 };
          const open = Number((d.outstanding.by_party || {})[pid] || 0);
          const docs = Object.keys(byRef).map((k) => byRef[k]).filter((x) => String(x.party) === String(pid) && x.outstanding_minor > 0);
          const oldest = docs.map((x) => x.due_date || x.date).filter(Boolean).sort()[0] || null;
          const buckets = {}; Object.keys(ag.undisputed || {}).forEach((k) => { buckets[k] = sign * ((ag.undisputed[k] || 0) + ((ag.disputed || {})[k] || 0)); });
          const disputed = Object.keys(ag.disputed || {}).reduce((t, k) => t + (ag.disputed[k] || 0), 0);
          per.set(pid + '|' + role, { party_id: pid, side: role === 'creditors' ? 'supplier' : 'customer', balance_minor: sign * open, oldest_due: oldest, disputed_minor: sign * disputed, buckets });
        });
      }
      /* one row per party: a party on both lists nets (what they owe you less what you owe them) */
      const rows = new Map();
      for (const r of per.values()) {
        const p = names.get(String(r.party_id)) || {};
        const x = rows.get(r.party_id);
        if (!x) rows.set(r.party_id, Object.assign({ party_no: p.party_no || null, name: p.nickname || p.name || null }, r));
        else { x.balance_minor += r.balance_minor; x.disputed_minor += r.disputed_minor; x.side = 'both'; x.oldest_due = [x.oldest_due, r.oldest_due].filter(Boolean).sort()[0] || null;
               Object.keys(r.buckets).forEach((k) => { x.buckets[k] = (x.buckets[k] || 0) + r.buckets[k]; }); }
      }
      return Array.from(rows.values()).sort((a, b) => Math.abs(b.balance_minor) - Math.abs(a.balance_minor));
    });
    res.json({ currency: curOf(req), asOf, parties: out, total_minor: out.reduce((t, p) => t + p.balance_minor, 0) });
  } catch (err) { fail(res, err); }
});

/** GET /trial-balance?asOf → { currency, asOf, rows: [{ code, name, dr_minor, cr_minor }], total_dr_minor, total_cr_minor, balanced } */
router.get('/trial-balance', auth, on, async (req, res) => {
  try {
    const e = ctx(req), asOf = dateQ(req.query.asOf, today());
    const tb = await withEntity(e, (h) => B.trialBalance(h, e, asOf));
    res.json({ currency: curOf(req), asOf, rows: tb.rows.map((r) => ({ code: r.code, name: r.name, group: r.group, dr_minor: r.debit_minor, cr_minor: r.credit_minor })),
      total_dr_minor: tb.total_dr_minor, total_cr_minor: tb.total_cr_minor, balanced: tb.balanced });
  } catch (err) { fail(res, err); }
});
/** Schedule III lines → the flat ledger rows a screen lists ({ code, name, amount_minor, line }) */
function flat(lines) { const out = []; (lines || []).forEach((L) => (L.accounts || []).forEach((a) => out.push({ code: a.code, name: a.name, amount_minor: a.amount_minor, line: L.label }))); return out; }
/** GET /pl?from&to → { currency, income: [{ code, name, amount_minor }], expense: [...], profit_minor } (inside one financial year) */
router.get('/pl', auth, on, async (req, res) => {
  try {
    const e = ctx(req), to = dateQ(req.query.to, today()), from = dateQ(req.query.from, fyStart(req, to));
    const pl = await withEntity(e, (h) => B.profitAndLoss(h, e, from, to));
    res.json({ currency: curOf(req), from, to, income: flat(pl.income), expense: flat(pl.expenses), total_income_minor: pl.total_income_minor,
      total_expense_minor: pl.total_expenses_minor, profit_minor: pl.profit_minor, by_line: { income: pl.income, expense: pl.expenses } });
  } catch (err) { fail(res, err); }
});
/**
 * The engine's Schedule III lines → one side as the statement prints it: heads in the pack's order, each with its ledgers and a head total.
 * ⭐ Only a regrouping of what CBLedger.balanceSheet returned — no figure is computed here beyond adding up the engine's own lines.
 * The year's profit so far (the engine's code-less 'profit_to_date' line) is named "Net profit" / "Net loss", sign kept.
 */
function sideOf(lines, order) {
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const heads = (lines || []).map((L, i) => ({ L, i })).sort((a, b) => rank(a.L.line) - rank(b.L.line) || a.i - b.i).map(({ L }) => ({
    line: L.line, label: L.label, total_minor: L.amount_minor,
    ledgers: (L.accounts || []).map((a) => (a.role === 'profit_to_date'
      ? { code: null, name: a.amount_minor < 0 ? 'Net loss' : 'Net profit', amount_minor: a.amount_minor, role: 'profit_to_date' }
      : { code: a.code, name: a.name, amount_minor: a.amount_minor })) }));
  return { heads, total_minor: heads.reduce((t, h) => t + h.total_minor, 0) };
}
function sched3(bs, order) {
  const eq = sideOf(bs.liabilities, order), as = sideOf(bs.assets, order), diff = as.total_minor - eq.total_minor;
  return { equity_and_liabilities: eq, assets: as, balanced: diff === 0, difference_minor: diff };
}
/** GET /bs?asOf → { currency, assets, liabilities, equity, total_assets_minor, total_liab_equity_minor, balanced, by_line,
 *  schedule_iii: { equity_and_liabilities: { heads, total_minor }, assets: { heads, total_minor }, balanced, difference_minor } } */
router.get('/bs', auth, on, async (req, res) => {
  try {
    const e = ctx(req), asOf = dateQ(req.query.asOf, today());
    const out = await withEntity(e, async (h) => {
      const bs = await B.balanceSheet(h, e, asOf, B.entityBasisOf(req.books));   /* undefined until the entity-type decision is taken → Schedule III */
      const nature = new Map((await S.accounts(h, e)).map((a) => [String(a.code), a.nature]));
      const left = flat(bs.liabilities);
      return { assets: flat(bs.assets), liabilities: left.filter((r) => r.code && nature.get(String(r.code)) !== 'equity'),
        equity: left.filter((r) => !r.code || nature.get(String(r.code)) === 'equity'), total_assets_minor: bs.total_assets_minor,
        total_liab_equity_minor: bs.total_liabilities_minor, profit_to_date_minor: bs.profit_to_date_minor, balanced: bs.balanced, by_line: { assets: bs.assets, liabilities: bs.liabilities },
        schedule_iii: sched3(bs, Object.keys(B.packOf(req.books).sch3 || {})) };
    });
    res.json(Object.assign({ currency: curOf(req), asOf }, out));
  } catch (err) { fail(res, err); }
});

/* ── payments: record → propose → confirm ─────────────────────────────────────────────────────────────────── */
const MODES = ['cash', 'bank', 'upi', 'card', 'cheque'];

/**
 * POST /payments { party_id, direction: in|out, amount_minor, currency, mode, reference?, cheque?: { number, bank, date },
 * received_at?, client_ref? } → { ok, payment: { payment_id, status: 'recorded' | 'cheque_received', duplicate }, posted }
 * The payment row and its entry are ONE transaction: a refusal (a locked month) leaves nothing half-recorded.
 * ⭐ client_ref: the same ref again → 200, the FIRST payment (duplicate: true) and its entry — never a second posting.
 * ⚠️ Refused in words (422): a party on neither of the shop's lists; a date before the ledger began or in the future.
 * A cheque posts only when it CLEARS (C3) — until then it is a status row, and there is nothing to propose.
 */
/** the payment question a body asks — shared by /payments/preview and /payments; a refusal is { status, words } */
function paymentQuestion(req, needMode) {
  const b = req.body || {}, cur = String(curOf(req)).toUpperCase();
  const party = String(b.party_id || b.party || '');
  if (!UUID.test(party)) return { refuse: { status: 400, words: 'Which party?' } };
  if (b.currency && String(b.currency).toUpperCase() !== cur) return { refuse: { status: 422, words: 'This ledger is kept in ' + cur + '.' } };
  const amount_minor = minorOf(b);
  if (!(amount_minor > 0)) return { refuse: { status: 400, words: 'How much?' } };
  const mode = MODES.indexOf(String(b.mode || '').toLowerCase()) >= 0 ? String(b.mode).toLowerCase() : null;
  if (needMode && !mode) return { refuse: { status: 400, words: 'Paid how — cash, bank, UPI, card or cheque?' } };
  const allocate = b.allocate === 'none' ? 'none' : b.allocate === 'oldest_first' ? 'oldest_first' : null;
  const allocations = Array.isArray(b.allocations) && b.allocations.length ? b.allocations : null;
  return { party, direction: b.direction === 'out' ? 'out' : 'in', amount_minor, cur, mode, allocate, allocations, country: req.books && req.books.country };
}
/** the party's name for the words — the display name, else the nickname the lists keep; "this party" when neither is known */
async function partyWord(h, e, party) { const p = (await partyNames(h, e)).get(String(party)); return (p && (p.name || p.nickname)) || 'this party'; }
/** POST /payments/preview — W1–W4 and the 409 share one shape: { code: 'ALREADY_PAID', error, message: words, warnings } */
const alreadyPaid = (res, err) => res.status(409).json({ code: 'ALREADY_PAID', error: 'Already paid?', message: err.message, warnings: err.warnings || [] });

/**
 * POST /payments/preview { party_id, direction, amount_minor, currency, allocate?: 'oldest_first'|'none' } — NO WRITE (M26, SPEC-payments §4.1)
 * → { currency, party: { party_id, name }, open_minor, proposal: [{ against_ref, bill_no, due_date, open_minor, apply_minor, disputed }],
 *     apply_minor, on_account_minor, skipped, warnings: [{ code, words, entry_no? }], words }
 * The proposal is B.proposeFor (the one function /propose and the one-call record use); the warnings are the duplicate rule
 * (PAY D5: W1–W4, 24 h). The web paints them; it composes none of the words.
 */
router.post('/payments/preview', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), q = paymentQuestion(req, false);
    if (q.refuse) return res.status(q.refuse.status).json({ error: q.refuse.words, message: q.refuse.words });
    const out = await withEntity(e, async (h) => {
      const name = await partyWord(h, e, q.party);
      const prop = await B.proposeFor(h, e, { party: q.party, direction: q.direction, amount_minor: q.amount_minor, currency: q.cur });
      const warnings = await B.duplicateWarnings(h, e, { party: q.party, direction: q.direction, amount_minor: q.amount_minor, allocate: q.allocate, allocations: q.allocations, country: q.country }, prop, name);
      return { currency: prop.currency, party: { party_id: q.party, name }, open_minor: prop.open_minor, proposal: prop.proposal, apply_minor: prop.apply_minor,
        on_account_minor: prop.on_account_minor, skipped: prop.skipped, why: prop.why, warnings, words: B.previewWords(prop, name, q.direction) };
    });
    res.json(out);
  } catch (err) { fail(res, err); }
});
/**
 * POST /payments { party_id, direction: in|out, amount_minor, currency, mode, reference?, cheque?: { number, bank, date }, received_at?, client_ref?,
 *                  allocations?: [{ against_ref, amount_minor }], allocate?: 'oldest_first'|'none', acknowledge?: [codes] }
 * → { ok, payment: { payment_id, status: 'recorded' | 'cheque_received', duplicate }, posted, allocation: null | { settled, items, allocated_minor },
 *     outcome: { words, settled: [{ against_ref, bill_no, amount_minor }], applied_minor, on_account_minor, balance_minor, balance_words } }
 * ⭐ ONE CALL, ONE TRANSACTION (M26): the payment row, its entry and the bills it settles commit together or not at all — a refused
 *   allocation (confirmItems) rolls the payment back with it. `allocate: 'oldest_first'` with no list = the server's own proposal.
 * ⭐ client_ref: the same ref again → 200, the FIRST payment (duplicate: true) and its entry — never a second posting; a replay is
 *   answered BEFORE the duplicate rule looks at the new body.
 * ⭐ THE DUPLICATE RULE (PAY D5, W1–W4): a warning not named in `acknowledge` → 409 ALREADY_PAID with the words and the warnings;
 *   nothing is written. The web's "Pay as advance" button is what sets `acknowledge`.
 * ⚠️ Refused in words (422): a party on neither of the shop's lists; a date before the ledger began or in the future.
 * A cheque posts only when it CLEARS (C3) — until then it is a status row, and there is nothing to propose.
 */
router.post('/payments', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), b = req.body || {}, q = paymentQuestion(req, true);
    if (q.refuse) return res.status(q.refuse.status).json({ error: q.refuse.words, message: q.refuse.words });
    const { party, direction, amount_minor, cur, mode, allocate } = q;
    const date = dateQ(b.received_at || b.date, today());
    const chq = b.cheque && typeof b.cheque === 'object' ? b.cheque : {};
    const client_ref = b.client_ref ? String(b.client_ref).slice(0, 80) : null;
    const ack = Array.isArray(b.acknowledge) ? b.acknowledge.map(String) : [];
    const allocations = Array.isArray(b.allocations) ? b.allocations.filter((a) => a && typeof a === 'object').map((a) => ({ against_ref: String(a.against_ref || ''), amount_minor: Math.round(Number(a.amount_minor)) })) : null;
    /* ⭐ the payment row and its entry are ONE transaction (B.recordPayment) — a refusal leaves nothing half-recorded */
    const out = await withEntity(e, async (h) => {
      const name = await partyWord(h, e, party);
      /* the duplicate rule runs INSIDE recordPayment (p.warn), after its gates (a replay answers first; a stranger or a bad date is a 422) */
      const rec = await B.recordPayment(h, e, { party_id: party, direction, amount_minor, currency: cur, mode, reference: b.reference,
        cheque_no: chq.number || chq.no || b.cheque_no, cheque_bank: chq.bank || b.cheque_bank,
        cheque_date: DATE.test(String(chq.date || chq.dated || b.cheque_date || '')) ? (chq.date || chq.dated || b.cheque_date) : null, received_at: date,
        client_ref, by: byOf(req), strict_date: true, allocations, allocate, warn: { acknowledge: ack, country: q.country, name } });
      if (!rec.payment.duplicate) rec.outcome = await B.paymentOutcome(h, e, { party_id: party, direction, amount_minor, currency: cur, mode }, rec.payment.payment_id, rec.allocation, name);
      return rec;
    });
    /* a bill settled here is a step of R-1400 (lib/bill-privacy) — after the commit, best effort, as /confirm does for "Choose the bills" */
    if (out.allocation && out.allocation.settled && out.allocation.settled.length) {
      try {
        const pay = await withEntity(e, (h) => S.payment(h, e, out.payment.payment_id));
        await require('../lib/bill-privacy').moneySteps(e, pay, out.allocation.settled, { id: byOf(req), name: (req.identity && req.identity.display_name) || null });
      } catch (e2) { console.error('bill money steps:', e2.message); }
    }
    res.json(Object.assign({ ok: true }, out));
  } catch (err) { if (err && err.code === 'ALREADY_PAID') return alreadyPaid(res, err); fail(res, err); }
});
/** POST /payments/:id/propose → { proposal: [{ against_ref, bill_no, due_date, open_minor, apply_minor, disputed }], on_account_minor } — B.proposeFor, the one function */
router.post('/payments/:id/propose', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return null;
      const prop = await B.proposeFor(h, e, { party: p.party_id, direction: p.direction, amount_minor: p.amount_minor, currency: p.currency, credit_ref: 'pay:' + id });
      return { proposal: prop.proposal, open_minor: prop.open_minor, apply_minor: prop.apply_minor, on_account_minor: prop.items.length ? prop.on_account_minor : 0, skipped: prop.skipped, why: prop.why };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(Object.assign({ payment_id: id }, out));
  } catch (err) { fail(res, err); }
});
/** POST /payments/:id/confirm { allocations: [{ against_ref, amount_minor }] } — CBReceivables.confirmItems decides (disputed frozen, never more than open) */
router.post('/payments/:id/confirm', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const list = Array.isArray((req.body || {}).allocations) ? req.body.allocations : [];
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return null;
      return B.postEntry(h, e, { type: 'allocation', party: p.party_id, side: p.direction === 'in' ? 'customer' : 'supplier', credit_ref: 'pay:' + id, payment_id: id,
        allocations: list.map((a) => ({ against_ref: String(a.against_ref || ''), amount_minor: Math.round(Number(a.amount_minor)) })), currency: p.currency, by: byOf(req) });
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    /* ⭐ a payment against a BILL is a step of R-1400 — written at its messaging level (lib/bill-privacy): my history, and the
       other party's too while R-1400 is external (a remittance advice). After the posting committed; never able to undo it. */
    try {
      const pay = await withEntity(e, (h) => S.payment(h, e, id));
      await require('../lib/bill-privacy').moneySteps(e, pay, list, { id: byOf(req), name: (req.identity && req.identity.display_name) || null });
    } catch (e2) { console.error('bill money steps:', e2.message); }
    res.json(out);
  } catch (err) { fail(res, err); }
});
/**
 * GET /cheques[?all=1] → { currency, cheques: [{ payment_id, party_id, party_no, name, direction, amount_minor, currency,
 *   reference, cheque_no, cheque_bank, cheque_date, received_at, status: received|deposited|cleared|bounced, next: [...] }] }
 * The cheques still HELD (with ?all=1, every cheque) — what a "Cheques held" list shows. `next` is the steps the ENGINE
 * will accept now (CBReceivables.itemsOfCheque decides — received → deposited → cleared | bounced); a screen offers those.
 */
router.get('/cheques', auth, noKey, on, async (req, res) => {
  try {
    const e = ctx(req), all = String(req.query.all || '') === '1';
    const out = await withEntity(e, async (h) => {
      const rows = await S.cheques(h, e, all, 200);
      const names = await partyNames(h, e), chart = await S.accounts(h, e), R = E.receivables(), kept = new Map(), day = today();
      const list = [];
      for (const c of rows) {
        const a = chart.find((x) => x.role === (c.direction === 'in' ? 'debtors' : 'creditors'));
        const k = c.party_id + '|' + (a ? a.account_id : '');
        if (!kept.has(k)) kept.set(k, a ? await B.partyItems(h, e, c.party_id, a.account_id) : []);
        const next = ['deposited', 'cleared', 'bounced'].filter((to) => { try { R.itemsOfCheque(kept.get(k), 'pay:' + c.payment_id, to, day); return true; } catch (_) { return false; } });
        const p = names.get(String(c.party_id)) || {};
        list.push({ payment_id: c.payment_id, party_id: c.party_id, party_no: p.party_no || null, name: p.nickname || p.name || null, direction: c.direction, amount_minor: Number(c.amount_minor),
          currency: c.currency, reference: c.reference || null, cheque_no: c.cheque_no || null, cheque_bank: c.cheque_bank || null, cheque_date: E.ymd(c.cheque_date), received_at: E.ymd(c.received_at),
          status: c.status || 'received', next });
      }
      return list;
    });
    res.json({ currency: curOf(req), cheques: out });
  } catch (err) { fail(res, err); }
});
/**
 * POST /cheques/:id/status { status: deposited|cleared|bounced, date? } — :id is the cheque's payment_id.
 *   deposited → { ok, status: 'deposited', items: 1 }
 *   cleared   → { ok, status: 'cleared', items: 2, posted: { ok, entry_id, entry_no, posting_date, doc_date, moved, lines, items, note } }  (the entry posts NOW)
 *   bounced   → { ok, status: 'bounced', items: 1 }  (a cheque that never cleared never counted: no entry)
 * Out of order (received → deposited → cleared | bounced) → 422 with the engine's sentence; not a cheque → 404.
 */
router.post('/cheques/:id/status', auth, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id), b = req.body || {};
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const to = ['deposited', 'cleared', 'bounced'].indexOf(b.status) >= 0 ? b.status : null;
    if (!to) return res.status(400).json({ error: 'Deposited, cleared or bounced?', message: 'Deposited, cleared or bounced?' });
    res.json(await B.postEntry(null, e, { type: 'cheque_step', payment_id: id, to, date: dateQ(b.date, today()), strict_date: true, by: byOf(req) }));
  } catch (err) { fail(res, err); }
});
/** POST /parties/:id/dispute { against_ref, disputed: true|false, side, note } — a disputed bill cannot take a payment (C4) */
router.post('/parties/:id/dispute', auth, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id), b = req.body || {};
    if (!UUID.test(id) || !b.against_ref) return res.status(400).json({ error: 'Which bill?', message: 'Which bill?' });
    res.json(await B.postEntry(null, e, { type: 'party_status', party: id, side: b.side === 'supplier' ? 'supplier' : 'customer', against_ref: String(b.against_ref),
      status: b.disputed === false ? 'undisputed' : 'disputed', note: b.note ? String(b.note).slice(0, 300) : null, currency: curOf(req), by: byOf(req) }));
  } catch (err) { fail(res, err); }
});

/* ── the "＋ Entry" door: the grid, the preview, the everyday events ───────────────────────────────────────────── */
const M = () => require('../lib/books-manual');
/** GET /events → { events: [{ kind, words, icon, band, voucher, fields, ledger_group, preview, post | route }], picks, pending, golden } — the grid; the screen holds no rules */
router.get('/events', auth, noKey, on, (req, res) => {
  try { res.json(M().catalogue(req.books)); } catch (err) { fail(res, err); }
});
/**
 * POST /preview { event: { kind, …fields } } (or { event: 'kind', …fields }) → { ok, voucher: { series, type }, lines: [{ code, ledger, dr_minor, cr_minor, type, rule }], balanced, refusals, … }
 * Composed by lib/books.js composeEntry — the writer's own function. Writes nothing, takes no counter. A co-assist may preview; only the owner posts.
 */
router.post('/preview', auth, noKey, on, async (req, res) => {
  try { res.json(await M().preview(ctx(req), req.books, req.body || {}, { owner: isOwner(req), by: byOf(req) })); } catch (err) { fail(res, err); }
});
/** POST /events { event: kind, …fields, client_ref } → the entry (MJ/<fy>/<n>, its voucher type kept). Owner only; the same client_ref answers the first entry, duplicate: true. */
router.post('/events', auth, noKey, owner, on, async (req, res) => {
  try { res.json(await M().post(ctx(req), req.books, req.body || {}, byOf(req))); } catch (err) { fail(res, err); }
});

/* ── owner writes: manual entry, reversal, write-off, opening, months ────────────────────────────────────────── */
const givenLines = (list) => require('../lib/books-manual').givenLines(list);   /* ONE reader of a typed journal's lines — the ＋ Entry builder uses it too */
router.post('/entries', auth, owner, on, async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await B.postEntry(null, ctx(req), { type: 'manual', owner: true, narration: b.narration, date: dateQ(b.date, today()), currency: curOf(req), strict_date: true,
      lines: givenLines(b.lines), ref: b.ref || null, source_ref: b.client_ref ? 'manual:' + String(b.client_ref).slice(0, 80) : null, by: byOf(req) }));
  } catch (err) { fail(res, err); }
});
router.post('/entries/:id/reverse', auth, owner, on, async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json(await B.reverseEntry(null, ctx(req), String(req.params.id), { by: byOf(req), reason: (req.body || {}).reason }));
  } catch (err) { fail(res, err); }
});
router.post('/write-off', auth, owner, on, async (req, res) => {
  try {
    const b = req.body || {};
    const party = String(b.party_id || b.party || '');
    if (!UUID.test(party)) return res.status(400).json({ error: 'Which customer?', message: 'Which customer?' });
    /* ⭐ client_ref → source_ref: the same write-off pressed twice is ONE entry (it was two — critic M11); the second answers
       200 with the first entry and duplicate: true. Its party document carries the same ref, so it too is one. */
    const ref = b.client_ref ? String(b.client_ref).slice(0, 80) : null;
    res.json(await B.postEntry(null, ctx(req), { type: 'write_off', owner: true, party, amount: minorOf(b) / 100, reason: b.reason, currency: curOf(req), strict_date: true,
      date: dateQ(b.date, today()), against_ref: b.against_ref ? String(b.against_ref) : null, source_ref: ref ? 'wo:' + ref : null,
      doc_ref: 'wo:' + party + ':' + (ref || Date.now()), by: byOf(req) }));
  } catch (err) { fail(res, err); }
});
/**
 * POST /opening { date?, rows: [{ code, party_no?, dr_minor, cr_minor, bill_ref?, due_date? }] } → { entry_no, suspense_minor, lines }
 * ONE entry, period 0 (is_opening). A party row names its bill (bill_ref) so dues are bill-wise from day one; any
 * difference goes to Suspense 2900, which must be nil before the year can close (Tally, ERPNext opening entry).
 */
router.post('/opening', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req), b = req.body || {}, cur = curOf(req);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows.', message: 'No rows.' });
    const bad = rows.map((r, i) => ((Number(r.dr_minor) > 0) === (Number(r.cr_minor) > 0) ? i + 1 : 0)).filter(Boolean);
    if (bad.length) return res.status(400).json({ error: 'Row ' + bad.join(', ') + ': one amount — a debit or a credit, not both.', message: 'Row ' + bad.join(', ') + ': one amount — a debit or a credit, not both.' });
    const out = await withEntity(e, async (h) => {
      const byNo = new Map((await S.parties(h, e)).filter((p) => p.party_no).map((p) => [String(p.party_no).toUpperCase(), p.party_id]));
      const lines = [], refs = [];
      for (const [i, r] of rows.entries()) {
        const party = r.party_no ? byNo.get(String(r.party_no).toUpperCase()) : (UUID.test(String(r.party_id || '')) ? r.party_id : undefined);
        if (r.party_no && !party) { const x = new Error('Row ' + (i + 1) + ': no party numbered ' + r.party_no + '.'); x.refused = true; throw x; }
        lines.push({ account: String(r.code), dr: Number(r.dr_minor || 0) / 100, cr: Number(r.cr_minor || 0) / 100, party });
        refs.push({ party, bill_ref: r.bill_ref ? String(r.bill_ref).slice(0, 60) : null, due_date: DATE.test(String(r.due_date || '')) ? r.due_date : null });
      }
      const r = await B.postEntry(h, e, { type: 'opening', date: dateQ(b.date, fyStart(req, today())), currency: cur, lines, line_refs: refs,
        source_ref: b.client_ref ? 'opening:' + String(b.client_ref).slice(0, 80) : null, narration: 'Opening balances', by: byOf(req) });
      const ent = r.entry_id ? await S.entry(h, e, r.entry_id) : null;
      const chart = await S.accounts(h, e); const sus = chart.find((a) => a.role === 'suspense');
      const sl = ent && sus ? ent.lines.filter((l) => String(l.account_id) === String(sus.account_id)) : [];
      return Object.assign({}, r, { suspense_minor: sl.reduce((t, l) => t + Number(l.cr_minor) - Number(l.dr_minor), 0) });
    });
    res.json(out);
  } catch (err) { fail(res, err); }
});
/** POST /periods/:fy/:p/lock { reason, hard } · /unlock { reason } → { period: { fiscal_year, period, status } } */
router.post('/periods/:fy/:p/:act', auth, owner, on, async (req, res) => {
  try {
    const { fy, p, act } = req.params;
    if (!/^\d{4}(-\d{2})?$/.test(fy) || !/^\d{1,2}$/.test(p) || ['lock', 'unlock'].indexOf(act) < 0) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const status = act === 'unlock' ? 'open' : (b.hard === true ? 'hard_locked' : 'soft_locked');
    const r = await B.setPeriod(null, ctx(req), fy, Number(p), status, byOf(req), b.reason);
    res.json({ ok: true, period: { fiscal_year: r.fiscal_year, period: r.period, status: r.status } });
  } catch (err) { fail(res, err); }
});
/** POST /year/:fy/close → { ok, fiscal_year, next, locked, opening } · refused (422) with { refusals: [{ name, why }] } in plain words · a closed year answers { ok, duplicate: true } */
router.post('/year/:fy/close', auth, owner, on, async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return res.status(404).json({ error: 'Not found' });
    const r = await B.closeYear(null, ctx(req), req.params.fy, byOf(req));
    if (r.ok) return res.json(r);
    const message = r.refusals.map((x) => x.why).join(' ');
    res.status(422).json({ ok: false, fiscal_year: r.fiscal_year, error: message, message, refusals: r.refusals });
  } catch (err) { fail(res, err); }
});
/** GET /year/:fy/status → { fiscal_year, closed, can_close, refusals, months, next } — what a close would say, nothing written */
router.get('/year/:fy/status', auth, on, async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return res.status(404).json({ error: 'Not found' });
    const e = ctx(req);
    const st = await withEntity(e, (h) => B.yearState(h, e, req.params.fy));
    res.json({ fiscal_year: st.fiscal_year, closed: st.closed, can_close: st.can_close && !st.closed, refusals: st.closed ? [] : st.refusals, months: st.months, next: st.next });
  } catch (err) { fail(res, err); }
});
router.get('/periods', auth, on, async (req, res) => {
  try {
    const e = ctx(req);
    const rows = await withEntity(e, (h) => S.periods(h, e, req.query.fy ? String(req.query.fy) : null));
    /* the dates as dates ('YYYY-MM-DD'), never a Date through JSON — that is the day before, east of UTC */
    res.json({ periods: rows.map((p) => Object.assign({}, p, { start_date: E.ymd(p.start_date), end_date: E.ymd(p.end_date) })) });
  } catch (err) { fail(res, err); }
});

/* ── packs ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function manifestView(m) {
  const x = m || {};
  return Object.assign({}, x, { files: (x.files || []).map((f) => ({ name: f.file || f.name, file: f.file || f.name, sha256: f.sha256, bytes: f.bytes, rows: f.rows })),
    controls: { counts: x.counts || null, totals: x.totals || null, checks: x.checks || null } });
}
router.get('/packs', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req);
    const rows = await withEntity(e, (h) => S.packs(h, e));
    res.json({ packs: rows.map((k) => ({ pack_id: k.pack_id, kind: k.kind, fiscal_year: k.fiscal_year, period: k.period, created_at: k.created_at, sha256: k.sha256,
      stored: !!k.storage_path, has_file: !!k.storage_path, acknowledged_at: k.acknowledged_at || null, delete_after: E.ymd(k.delete_after) })) });
  } catch (err) { fail(res, err); }
});
router.post('/packs', auth, owner, on, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await require('../lib/books-pack').build(ctx(req), { kind: b.kind, fiscal_year: b.fiscal_year, period: b.period, by: byOf(req) });
    res.json({ ok: true, pack: { pack_id: r.pack_id, sha256: r.sha256, stored: r.stored, bytes: r.bytes }, manifest: manifestView(r.manifest) });
  } catch (err) { fail(res, err); }
});
/**
 * GET /packs/:id → JSON: { pack, manifest: { files: [{ name, sha256, bytes }], controls }, has_file, file, download }
 *   has_file  boolean — is there a stored zip to download (false: built while storage was not connected)
 *   file      '/api/books/packs/:id/file' — where the ZIP ITSELF is (this route is the manifest, never the pack; critic M10:
 *             the web saved this JSON as "the pack" and then acknowledged it)
 *   download  the same path, or null when has_file is false (kept for the first web build)
 */
router.get('/packs/:id', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const p = await withEntity(e, (h) => S.pack(h, e, id));
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ pack: { pack_id: p.pack_id, kind: p.kind, fiscal_year: p.fiscal_year, period: p.period, created_at: p.created_at, sha256: p.sha256, prev_sha256: p.prev_sha256,
      stored: !!p.storage_path, acknowledged_at: p.acknowledged_at, delete_after: E.ymd(p.delete_after) }, manifest: manifestView(p.manifest),
      has_file: !!p.storage_path, file: '/api/books/packs/' + id + '/file', download: p.storage_path ? '/api/books/packs/' + id + '/file' : null });
  } catch (err) { fail(res, err); }
});
router.get('/packs/:id/file', auth, owner, on, async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' });
    const r = await require('../lib/books-pack').download(ctx(req), String(req.params.id));
    if (!r.found) return res.status(404).json({ error: 'Not found' });
    if (!r.stored) return res.status(409).json({ error: 'This pack was built while storage was not connected — build it again to download it.', message: 'This pack was built while storage was not connected — build it again to download it.' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ledger-pack-' + (r.pack.kind || 'pack') + '-' + (r.pack.fiscal_year || '') + (r.pack.period != null ? '-' + r.pack.period : '') + '.zip"');
    res.setHeader('X-Pack-SHA256', r.pack.sha256);
    res.end(r.bytes);
  } catch (err) { fail(res, err); }
});
/**
 * POST /packs/:id/ack → { ok, acknowledged_at } — "we have it": the fact that later licenses summarising detail away.
 * ⚠️⚠️ REFUSED FOR A PACK WITH NO STORED FILE (critic M10): 409 { code: 'PACK_NO_FILE', error } — there is nothing the shop
 *   could have downloaded, so there is nothing to acknowledge. Build it again once storage is connected.
 */
const PACK_NO_FILE = 'This pack has no file to download, so there is nothing to confirm yet. Build it again, download it, then confirm.';
router.post('/packs/:id/ack', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req);
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' });
    const r = await withEntity(e, async (h) => {
      const p = await S.pack(h, e, String(req.params.id));
      if (!p) return null;
      if (!p.storage_path) return { no_file: true };
      const x = await S.ackPack(h, e, String(req.params.id), byOf(req)); if (x) await S.logChange(h, e, { by: byOf(req), table_name: 'books_pack', row_id: req.params.id, field: 'acknowledged', new: 'yes' }); return x; });
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (r.no_file) return res.status(409).json({ code: 'PACK_NO_FILE', error: PACK_NO_FILE, message: PACK_NO_FILE });
    res.json({ ok: true, acknowledged_at: r.acknowledged_at });
  } catch (err) { fail(res, err); }
});

/* ── recurring entries (b281, DRAFT) and the To-do ─────────────────────────────────────────────────────────── */
const RC = () => require('../lib/books-recurring');
/** GET /recurring → { recurring: [{ recurring_id, name, event, frequency, next_on, end_on, auto, active, last_done_on, due }] } · 503 BOOKS_NOT_MIGRATED until b281 runs */
router.get('/recurring', auth, owner, on, async (req, res) => { try { res.json({ recurring: await RC().list(ctx(req)) }); } catch (err) { fail(res, err); } });
/** POST /recurring { name, event: { kind, …fields as POST /events, no date }, frequency: monthly|quarterly|yearly, next_on, end_on?, auto? } */
router.post('/recurring', auth, owner, on, async (req, res) => { try { res.json(await RC().create(ctx(req), req.books, req.body || {}, byOf(req))); } catch (err) { fail(res, err); } });
/** PATCH /recurring/:id — a merge-patch: only the fields sent change */
router.patch('/recurring/:id', auth, owner, on, async (req, res) => {
  try { if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' }); res.json(await RC().patch(ctx(req), req.books, String(req.params.id), req.body || {}, byOf(req))); } catch (err) { fail(res, err); }
});
/** DELETE /recurring/:id — stops it (active: false); nothing is deleted, and what it posted stays */
router.delete('/recurring/:id', auth, owner, on, async (req, res) => {
  try { if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' }); res.json(await RC().stop(ctx(req), String(req.params.id))); } catch (err) { fail(res, err); }
});
/** POST /recurring/:id/post — accept the proposal: posts the due day as an MJ entry (client_ref = template + date) and moves it on · POST /recurring/:id/skip — let it pass */
router.post('/recurring/:id/post', auth, owner, on, async (req, res) => {
  try { if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' }); res.json(await RC().accept(ctx(req), req.books, String(req.params.id), byOf(req))); } catch (err) { fail(res, err); }
});
router.post('/recurring/:id/skip', auth, owner, on, async (req, res) => {
  try { if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' }); res.json(await RC().skip(ctx(req), String(req.params.id))); } catch (err) { fail(res, err); }
});
/** GET /todo → [{ kind, count, words, action: { label, screen, call }, items? }] — CB Accounts' home; only what needs doing is listed. Kinds: bills_to_accept · months_not_locked · closing_stock_missing · gst_due · recurring_due · accrual_reversals_due · year_close_possible */
router.get('/todo', auth, noKey, on, async (req, res) => { try { res.json(await require('../lib/books-todo').todo(ctx(req), req.books)); } catch (err) { fail(res, err); } });

module.exports = router;
/* ── the period-end routes (engines v1.14–v1.16; lib/books-period.js builds each event THROUGH THE ENGINE) ─────────────
   Owner-only, switch on, idempotent (client_ref, or the entry's natural key), refused in a locked month (PERIOD_LOCKED, 409).
   The asset ones answer 503 BOOKS_NOT_MIGRATED until b280 (DRAFT) is run. */
const P = () => require('../lib/books-period');
const route = (method, p, fn) => router[method](p, auth, owner, on, async (req, res) => {
  try { res.json(await fn(req, ctx(req), req.books, req.body || {}, byOf(req))); } catch (err) { fail(res, err); }
});
/** GET /assets?asOf → { currency, asOf, assets: [{ asset_id, name, asset_class, cost_minor, put_to_use, accumulated_minor, wdv_minor, disposed_on }], net_block: [per class, with the ledger's figure beside], total_wdv_minor } */
router.get('/assets', auth, owner, on, async (req, res) => {
  try { res.json(await P().listAssets(ctx(req), req.books, dateQ(req.query.asOf, today()))); } catch (err) { fail(res, err); }
});
/** POST /assets { name, class, cost, date, put_to_use?, how | party_id, client_ref } → the purchase entry (MJ) and the register row */
route('post', '/assets', (req, e, s, b, by) => P().addAsset(e, s, b, by));
/** POST /assets/:id/dispose { date, proceeds?, into?, client_ref } */
route('post', '/assets/:id/dispose', (req, e, s, b, by) => {
  if (!UUID.test(String(req.params.id))) { const x = new Error('Not found'); x.code = 'BOOKS_NOT_FOUND'; throw x; }
  return P().disposeAsset(e, s, String(req.params.id), b, by);
});
/** POST /depreciation/run { fy } → one entry at the year end, from the register; says which entity basis it used */
route('post', '/depreciation/run', (req, e, s, b, by) => P().runDepreciation(e, s, b, by));
/** POST /closing-stock { date, value_minor, nrv_minor?, method: 'manual' } */
route('post', '/closing-stock', (req, e, s, b, by) => P().closingStock(e, s, b, by));
/** POST /gst/close { fy, period } → { utilised, payable_minor, carried_minor, pay_total_minor, entry_no } · POST /gst/pay { fy, period, amounts, bank, challan_no } */
route('post', '/gst/close', (req, e, s, b, by) => P().gstClose(e, s, b, by));
route('post', '/gst/pay', (req, e, s, b, by) => P().gstPay(e, s, b, by));
/** POST /loans { ref, lender, amount, into, rate?, kind? } · POST /loans/:ref/emi { principal, interest, from?, date, client_ref } */
route('post', '/loans', (req, e, s, b, by) => P().takeLoan(e, s, b, by));
route('post', '/loans/:ref/emi', (req, e, s, b, by) => P().loanEmi(e, s, String(req.params.ref).slice(0, 60), b, by));
/** POST /accruals { ref, kind, class, amount, date } → reverses_on · POST /accruals/:ref/reverse (due from reverses_on) */
route('post', '/accruals', (req, e, s, b, by) => P().accrue(e, s, b, by));
route('post', '/accruals/:ref/reverse', (req, e, s, b, by) => P().reverseAccrual(e, s, String(req.params.ref).slice(0, 60), b, by));
/** POST /contra { from, to, amount, date, client_ref } — cash ↔ bank ↔ UPI */
route('post', '/contra', (req, e, s, b, by) => P().contra(e, s, b, by));

module.exports = router;
module.exports._test = { isOwner, minorOf, flat, manifestView, sourceOf };
/* the books' refusals answered the same way from another door (routes/chits.js POST /:chit_id/payment — drift D1) */
module.exports.fail = fail;
module.exports.alreadyPaid = alreadyPaid;
