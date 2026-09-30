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
 *   hat gate still decides whether their hat may write at all); a till key may read dues/statements and record a payment.
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
const isOwner = (req) => !req.api_key && !(req.identity && req.identity.parent_entity_id);
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
  if (e && e.code === 'BOOKS_NOT_FOUND') return res.status(404).json({ error: 'Not found', message: e.message });
  if (e && (e.refused || e.code === 'BOOKS_REFUSED')) return res.status(422).json({ error: e.message, message: e.message });
  if (e && (e.status === 409 || e.status === 422)) return res.status(e.status).json({ error: e.message, message: e.message });
  if (e && (e.code === 'BOOKS_ENGINE' || e.code === 'BOOKS_NOT_MIGRATED')) return res.status(503).json({ error: e.message, message: e.message });
  if (e && e.code === '23505') return res.status(409).json({ error: 'That is already recorded.', message: 'That is already recorded.' });
  return res.status(500).json({ error: 'Failed', message: String((e && e.message) || e).slice(0, 300) });
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
/** GET /health → { enabled, currency, last_check, waiting[], engines } — the web's probe (404 = off) and the to-do list */
router.get('/health', auth, on, async (req, res) => {
  try {
    const e = ctx(req);
    const waiting = await withEntity(e, (h) => S.waiting(h, e, 50));
    res.json({ enabled: true, currency: curOf(req), walkin_grain: req.books.walkin_grain, last_check: req.books.last_check || null, engines: E.status(),
      waiting: waiting.map((w) => ({ id: w.id, chit_id: w.source_chit_id, ref: w.source_ref, why: w.why, tries: w.tries, since: w.created_at })) });
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
/** POST /accounts { name, parent_code | parent_id } → { account: { code, account_id, name } } */
router.post('/accounts', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req), b = req.body || {};
    let parent = b.parent_id;
    if (!parent && b.parent_code) parent = ((await withEntity(e, (h) => S.accounts(h, e))).find((a) => String(a.code) === String(b.parent_code) && a.is_group) || {}).account_id;
    const r = await B.addAccount(null, e, { name: b.name, parent_id: parent, by: byOf(req) });
    res.json({ ok: true, account: { code: r.code, account_id: r.account_id, name: r.name } });
  } catch (err) { fail(res, err); }
});

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function fyStart(req, d) { const pack = B.packOf(req.books); const A = E.packs(); return A.fyRange(A.fiscalYearOf(d, pack), pack).start; }
async function partyNames(h, e) {
  const m = new Map(); (await S.parties(h, e)).forEach((p) => m.set(String(p.party_id), p)); return m;
}

/** GET /daybook?from&to → { currency, entries: [{ entry_no, posting_date, source_chit_id, narration, lines: [{ code, name, party_name, dr_minor, cr_minor }] }] } */
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
                        narration: l.narration || WORD[l.event_type] || l.event_type, source_chit_id: l.source_chit_id, reverses_entry_id: l.reverses_entry_id, lines: [] }; at.set(l.entry_id, x); entries.push(x); }
        const p = l.party_id ? names.get(String(l.party_id)) : null;
        x.lines.push({ code: l.code, name: l.account_name, party_id: l.party_id, party_name: p ? (p.nickname || p.name) : null, dr_minor: Number(l.dr_minor), cr_minor: Number(l.cr_minor), counter: l.counter_id });
      }
      return entries;
    });
    res.json({ currency: curOf(req), from, to, entries: out, count: out.length });
  } catch (err) { fail(res, err); }
});

/** GET /ledger/:account?party&from&to — :account is the code (1300), the role (debtors) or the id →
 *  { currency, account, opening_minor, lines: [{ date, what, ref, source_chit_id, dr_minor, cr_minor, running_minor }], closing_minor } */
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
        ref: l.entry_no, source_chit_id: l.source_chit_id, party_id: l.party_id, dr_minor: Number(l.dr_minor), cr_minor: Number(l.cr_minor), running_minor: run }; });
      return { account: { code: a.code, name: a.name, nature: a.nature }, party, from, to, opening_minor: open, lines, closing_minor: run };
    });
    if (!out) return res.status(404).json({ error: 'Not found', message: 'No such ledger.' });
    res.json(Object.assign({ currency: curOf(req) }, out));
  } catch (err) { fail(res, err); }
});

/** GET /party/:id/statement?from&to → CBLedger.partyStatement, as { currency, opening_minor, lines: [{ date, what, ref, source_chit_id, dr_minor, cr_minor, running_minor }], closing_minor } */
router.get('/party/:id/statement', auth, auth.requireScope('till', 'books'), on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const to = dateQ(req.query.to, today()), from = dateQ(req.query.from, fyStart(req, to));
    const out = await withEntity(e, async (h) => {
      const st = E.ledger().partyStatement({ ...(await statementInput(h, e, id, from, to)), party: id, from, to });
      const meta = new Map((await S.ledgerLines(h, e, from, to, id)).map((l) => [String(l.entry_id), l]));
      return { code: st.code, opening_minor: st.opening_minor, closing_minor: st.closing_minor,
        lines: st.rows.map((r) => { const m = meta.get(String(r.entry_id)) || {}; return { date: r.date, what: r.narration || WORD[m.event_type] || m.event_type || '', ref: r.jv_no,
          source_chit_id: m.source_chit_id || null, dr_minor: r.dr_minor, cr_minor: r.cr_minor, running_minor: r.running_minor }; }) };
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
router.get('/dues', auth, auth.requireScope('till', 'books'), on, async (req, res) => {
  try {
    const e = ctx(req), asOf = dateQ(req.query.asOf, today());
    const sides = req.query.side === 'customer' ? ['debtors'] : req.query.side === 'supplier' ? ['creditors'] : ['debtors', 'creditors'];
    const out = await withEntity(e, async (h) => {
      const chart = await S.accounts(h, e), names = await partyNames(h, e), per = new Map();
      for (const role of sides) {
        const a = chart.find((x) => x.role === role); if (!a) continue;
        const side = role === 'creditors' ? 'payable' : 'receivable', sign = role === 'creditors' ? -1 : 1;
        const items = (await S.items(h, e, null, a.account_id)).filter((i) => E.ymd(i.created_at) <= asOf).map(E.itemOf);
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
/** GET /bs?asOf → { currency, assets, liabilities, equity, total_assets_minor, total_liab_equity_minor, balanced } */
router.get('/bs', auth, on, async (req, res) => {
  try {
    const e = ctx(req), asOf = dateQ(req.query.asOf, today());
    const out = await withEntity(e, async (h) => {
      const bs = await B.balanceSheet(h, e, asOf);
      const nature = new Map((await S.accounts(h, e)).map((a) => [String(a.code), a.nature]));
      const left = flat(bs.liabilities);
      return { assets: flat(bs.assets), liabilities: left.filter((r) => r.code && nature.get(String(r.code)) !== 'equity'),
        equity: left.filter((r) => !r.code || nature.get(String(r.code)) === 'equity'), total_assets_minor: bs.total_assets_minor,
        total_liab_equity_minor: bs.total_liabilities_minor, profit_to_date_minor: bs.profit_to_date_minor, balanced: bs.balanced, by_line: { assets: bs.assets, liabilities: bs.liabilities } };
    });
    res.json(Object.assign({ currency: curOf(req), asOf }, out));
  } catch (err) { fail(res, err); }
});

/* ── payments: record → propose → confirm ─────────────────────────────────────────────────────────────────── */
const MODES = ['cash', 'bank', 'upi', 'card', 'cheque'];

/**
 * POST /payments { party_id, direction: in|out, amount_minor, currency, mode, reference?, cheque?: { number, bank, date },
 * received_at?, client_ref? } → { payment: { payment_id, status: 'recorded' | 'cheque_received', duplicate }, posted }
 * The payment row and its entry are ONE transaction: a refusal (a locked month) leaves nothing half-recorded.
 * A cheque posts only when it CLEARS (C3) — until then it is a status row, and there is nothing to propose.
 */
router.post('/payments', auth, auth.requireScope('till', 'books'), on, async (req, res) => {
  try {
    const e = ctx(req), b = req.body || {}, cur = String(curOf(req)).toUpperCase();
    const party = String(b.party_id || b.party || '');
    if (!UUID.test(party)) return res.status(400).json({ error: 'Which party?', message: 'Which party?' });
    if (b.currency && String(b.currency).toUpperCase() !== cur) return res.status(422).json({ error: 'This ledger is kept in ' + cur + '.', message: 'This ledger is kept in ' + cur + '.' });
    const direction = b.direction === 'out' ? 'out' : 'in';
    const amount_minor = minorOf(b);
    if (!(amount_minor > 0)) return res.status(400).json({ error: 'How much?', message: 'How much?' });
    const mode = MODES.indexOf(String(b.mode || '').toLowerCase()) >= 0 ? String(b.mode).toLowerCase() : null;
    if (!mode) return res.status(400).json({ error: 'Paid how — cash, bank, UPI, card or cheque?', message: 'Paid how — cash, bank, UPI, card or cheque?' });
    const date = dateQ(b.received_at || b.date, today());
    const chq = b.cheque && typeof b.cheque === 'object' ? b.cheque : {};
    /* ⭐ the payment row and its entry are ONE transaction (B.recordPayment) — a refusal leaves nothing half-recorded */
    const out = await withEntity(e, (h) => B.recordPayment(h, e, { party_id: party, direction, amount_minor, currency: cur, mode, reference: b.reference,
      cheque_no: chq.number || chq.no || b.cheque_no, cheque_bank: chq.bank || b.cheque_bank,
      cheque_date: DATE.test(String(chq.date || chq.dated || b.cheque_date || '')) ? (chq.date || chq.dated || b.cheque_date) : null, received_at: date,
      client_ref: b.client_ref ? String(b.client_ref).slice(0, 80) : null, by: byOf(req), strict_date: true }));
    res.json(Object.assign({ ok: true }, out));
  } catch (err) { fail(res, err); }
});
/** POST /payments/:id/propose → { proposal: [{ against_ref, bill_no, due_date, open_minor, apply_minor, disputed }], on_account_minor } */
router.post('/payments/:id/propose', auth, auth.requireScope('till', 'books'), on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return null;
      const acct = await B.controlOf(h, e, p.direction === 'in' ? 'customer' : 'supplier');
      const items = await B.partyItems(h, e, p.party_id, acct.account_id);
      if (!items.length) return { proposal: [], on_account_minor: 0 };
      const R = E.receivables(), dpx = Math.pow(10, 2);
      const sug = R.proposeItems(items, 'pay:' + id, {});
      const apply = {}; (sug.allocations || []).forEach((a) => { apply[a.debit] = (apply[a.debit] || 0) + Math.round(Number(a.amount) * dpx); });
      const o = R.outstanding(items).by_ref;
      const bills = Object.keys(o).map((k) => o[k]).filter((d) => d.kind === 'bill' && d.outstanding_minor > 0)
        .sort((a, b) => String(a.due_date || a.date || '').localeCompare(String(b.due_date || b.date || '')));
      const nos = await S.billNos(h, e, bills.map((d) => d.ref));
      return { proposal: bills.map((d) => ({ against_ref: d.ref, bill_no: nos[d.ref] || null, due_date: d.due_date || null, open_minor: d.outstanding_minor,
        apply_minor: d.disputed ? 0 : (apply[d.ref] || 0), disputed: !!d.disputed })), on_account_minor: Math.round(Number(sug.on_account || 0) * dpx), why: sug.ok === false ? sug.why : null };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(Object.assign({ payment_id: id }, out));
  } catch (err) { fail(res, err); }
});
/** POST /payments/:id/confirm { allocations: [{ against_ref, amount_minor }] } — CBReceivables.confirmItems decides (disputed frozen, never more than open) */
router.post('/payments/:id/confirm', auth, auth.requireScope('till', 'books'), on, async (req, res) => {
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
    res.json(out);
  } catch (err) { fail(res, err); }
});
/** POST /cheques/:id/status { status: deposited|cleared|bounced, date? } — clearing posts the entry; a bounce after clearing reverses it */
router.post('/cheques/:id/status', auth, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id), b = req.body || {};
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const to = ['deposited', 'cleared', 'bounced'].indexOf(b.status) >= 0 ? b.status : null;
    if (!to) return res.status(400).json({ error: 'Deposited, cleared or bounced?', message: 'Deposited, cleared or bounced?' });
    res.json(await B.postEntry(null, e, { type: 'cheque_step', payment_id: id, to, date: dateQ(b.date, today()), by: byOf(req) }));
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

/* ── owner writes: manual entry, reversal, write-off, opening, months ────────────────────────────────────────── */
function givenLines(list, cur) {
  const f = Math.pow(10, 2);
  return (Array.isArray(list) ? list : []).map((l) => ({ account: String(l.account || l.code || ''), dr: l.dr_minor != null ? Number(l.dr_minor) / f : Number(l.dr || 0),
    cr: l.cr_minor != null ? Number(l.cr_minor) / f : Number(l.cr || 0), party: UUID.test(String(l.party || l.party_id || '')) ? String(l.party || l.party_id) : undefined }));
}
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
    res.json(await B.postEntry(null, ctx(req), { type: 'write_off', owner: true, party, amount: minorOf(b) / 100, reason: b.reason, currency: curOf(req), strict_date: true,
      date: dateQ(b.date, today()), against_ref: b.against_ref ? String(b.against_ref) : null, doc_ref: 'wo:' + party + ':' + Date.now(), by: byOf(req) }));
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
router.get('/periods', auth, on, async (req, res) => {
  try { const e = ctx(req); res.json({ periods: await withEntity(e, (h) => S.periods(h, e, req.query.fy ? String(req.query.fy) : null)) }); } catch (err) { fail(res, err); }
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
      stored: !!k.storage_path, acknowledged_at: k.acknowledged_at || null, delete_after: k.delete_after || null })) });
  } catch (err) { fail(res, err); }
});
router.post('/packs', auth, owner, on, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await require('../lib/books-pack').build(ctx(req), { kind: b.kind, fiscal_year: b.fiscal_year, period: b.period, by: byOf(req) });
    res.json({ ok: true, pack: { pack_id: r.pack_id, sha256: r.sha256, stored: r.stored, bytes: r.bytes }, manifest: manifestView(r.manifest) });
  } catch (err) { fail(res, err); }
});
/** GET /packs/:id → { pack, manifest: { files: [{ name, sha256, bytes }], controls }, download } — the zip itself is /packs/:id/file */
router.get('/packs/:id', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req), id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: 'Not found' });
    const p = await withEntity(e, (h) => S.pack(h, e, id));
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ pack: { pack_id: p.pack_id, kind: p.kind, fiscal_year: p.fiscal_year, period: p.period, created_at: p.created_at, sha256: p.sha256, prev_sha256: p.prev_sha256,
      stored: !!p.storage_path, acknowledged_at: p.acknowledged_at, delete_after: p.delete_after }, manifest: manifestView(p.manifest),
      download: p.storage_path ? '/api/books/packs/' + id + '/file' : null });
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
router.post('/packs/:id/ack', auth, owner, on, async (req, res) => {
  try {
    const e = ctx(req);
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: 'Not found' });
    const r = await withEntity(e, async (h) => { const x = await S.ackPack(h, e, String(req.params.id), byOf(req)); if (x) await S.logChange(h, e, { by: byOf(req), table_name: 'books_pack', row_id: req.params.id, field: 'acknowledged', new: 'yes' }); return x; });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, acknowledged_at: r.acknowledged_at });
  } catch (err) { fail(res, err); }
});

module.exports = router;
module.exports._test = { isOwner, minorOf, flat, manifestView };
