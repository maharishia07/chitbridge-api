// @stage tested
// @stage-note [BOOKS · FX1] The exchange rates a shop typed or imported (b391), the rate a foreign entry posts at, the settlement of a foreign bill
// @stage-note and the period-end revaluation — every figure from the engines (CBPosting fx_settlement · fx_revalue · fxRevaluation), none computed here.
'use strict';
/**
 * lib/fx-rates.js — FOREIGN-CURRENCY TRADE (FX1, Athi 2026-10-14: "if a foreign trade provides collection in another currency how that will be handled?").
 *
 * ⭐ A RATE IS EVIDENCE. The owner types it or imports a CSV (b391 fx_rate, insert-only); nothing is fetched from a third party, nothing is assumed. An entry
 *   that used a rate names it: journal_line.fx_rate_source · fx_rate_date (b392). The pack says WHICH rate the tax value wants (pack.fx.tax_rate_rule).
 * ⭐ ONE COMPOSITION. lib/books.js composeEntry calls forEvent() for every event in a currency other than the books' own — the hooks, a payment, a preview
 *   all get the same answer:
 *     a bill / invoice / note   → the event's own fx_rate, else the rate of ITS day from fx_rate, else refused in words ("No USD rate for 14 Oct — add it").
 *                                  The hooks park a refusal on Waiting with that sentence; it posts once the rate is added (the nightly retry).
 *     a payment in / out        → CBPosting fx_settlement: the money at its day's rate, the party's balance at what the books CARRY for it (the bill named,
 *                                  else the party's open foreign balance at its average carried rate), the difference on fx_gain_loss (realised).
 * ⭐ REVALUATION (IAS 21 ¶23 and the packs' equivalents): revaluation() previews and revalue() posts, at a period's last day, the open foreign receivables and
 *   payables at the closing rate (the newest rate on or before that day, within the period) — and its reversal on the next period's first day, in ONE
 *   transaction. The owner presses it (Month lock); nothing posts by itself. A currency with no closing rate is NAMED and nothing is revalued.
 * ⚠️ NOT MIGRATED → BOOKS_NOT_MIGRATED (503) in words: b391 for the rates, b392 for anything that needs the foreign balance (a settlement, a revaluation).
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');

const SOURCES = ['manual', 'import', 'official'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_IMPORT = 1000;

const ready = () => S.fxRatesReady();
const linesReady = () => S.fxLinesReady();
function err(why, code, status) { const e = new Error(why); e.code = code; e.refused = true; if (status) e.status = status; return e; }
const notMigrated = (n) => err(n === 'b392' ? 'Foreign balances are not kept yet — run migration b392 first.' : 'Exchange rates are not set up yet — run migration b391 first.', 'BOOKS_NOT_MIGRATED');
const ask = (why) => err(why, 'BOOKS_REFUSED', 422);
/** '2026-10-14' → '14 Oct' — the day a shopkeeper reads */
function dayWord(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : String(d || ''); }
/** the sentence a foreign entry with no rate waits with (Waiting, the preview, the payment) */
function missingWords(cur, date) { return 'No ' + cur + ' rate for ' + dayWord(date) + ' — add it in Accounts › Rates.'; }

/* ── a rate row ── */
const ccy = (v) => String(v == null ? '' : v).trim().toUpperCase();
/** a rate as typed: a plain positive decimal, at most 10 places (b391 numeric(24,10)) — never an exponent, never 0 */
function rateOf(v) {
  const t = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (!/^\d{1,14}(\.\d{1,10})?$/.test(t) || !(Number(t) > 0)) return null;
  return t;
}
function dateOk(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); if (!m) return false; const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return x.getUTCMonth() === +m[2] - 1 && x.getUTCDate() === +m[3]; }
/** one row → { rate_date, from_ccy, to_ccy, rate, source, source_ref } or the reason it is refused, in words */
function rowOf(r, functional, dflt) {
  const x = r || {}, to = ccy(x.to || x.to_ccy || functional), from = ccy(x.from || x.from_ccy || x.currency);
  const date = String(x.date || x.rate_date || '').trim(), rate = rateOf(x.rate), source = String(x.source || dflt || 'manual').trim().toLowerCase();
  if (!dateOk(date)) return { why: 'The day is a date (YYYY-MM-DD).' };
  if (!/^[A-Z]{3}$/.test(from)) return { why: 'The currency is three letters (USD).' };
  if (to !== ccy(functional)) return { why: 'A rate is to ' + ccy(functional) + ', the currency these books are kept in.' };
  if (from === to) return { why: 'A rate is between two different currencies.' };
  if (rate === null) return { why: 'The rate is a number more than 0 (83.25).' };
  if (SOURCES.indexOf(source) < 0) return { why: 'The source is manual, import or official.' };
  const ref = x.source_ref == null ? null : String(x.source_ref).trim().slice(0, 120) || null;
  return { row: { rate_date: date, from_ccy: from, to_ccy: to, rate, source, source_ref: ref } };
}

/* ── the table (b391) ── */
async function list(h, entity, q) {
  if (!(await ready())) return [];
  const o = q || {};
  return (await S.fxRates(h, entity, { from: o.from ? ccy(o.from) : null, limit: Math.min(Math.max(Number(o.limit) || 500, 1), 2000) })).map(outRow);
}
/* a rate_date is a `date` column: read with THE one date reader (books-engines ymd — local getters, the same day in every zone). FX1 had
   its own toISOString() copy, which dated every rate a day early on a server east of UTC (local walk, 14 Oct). */
const ymdOf = E.ymd;
function outRow(x) {
  const d = ymdOf(x.rate_date);
  return { rate_id: String(x.rate_id), date: d, from: x.from_ccy, to: x.to_ccy, rate: String(x.rate).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), source: x.source,
    source_ref: x.source_ref || null, entered_by: x.entered_by || null, created_at: x.created_at };
}
const insertRows = async (h, entity, rows, by) => (await S.insertFxRates(h, entity, rows, by)).map(outRow);
async function add(h, entity, s, body, by) {
  if (!(await ready())) throw notMigrated('b391');
  const r = rowOf(body, B.packOf(s).currency, 'manual');
  if (!r.row) throw ask(r.why);
  return (await insertRows(h, entity, [r.row], by))[0];
}
/**
 * importCsv — a CSV the owner loaded: columns date · currency (or from) · rate, optional to · source · source_ref. Each row is checked; the good rows go in
 * as ONE insert with source 'import' (or 'official' when the row says so) and the file name as source_ref; the refused ones come back with their line and why.
 */
async function importCsv(h, entity, s, text, fileName, by) {
  if (!(await ready())) throw notMigrated('b391');
  const parsed = require('./csv').parseCSV(String(text || ''));
  const lower = (o) => { const x = {}; Object.keys(o).forEach((k) => { x[String(k).trim().toLowerCase()] = o[k]; }); return x; };
  if (!parsed.rows.length) throw ask('The file has no rows — a header line (date, currency, rate) and one rate per line.');
  if (parsed.rows.length > MAX_IMPORT) throw ask('At most ' + MAX_IMPORT + ' rates in one file.');
  const good = [], refused = [], fn = B.packOf(s).currency;
  parsed.rows.forEach((raw, i) => {
    const x = lower(raw);
    if (x.source_ref == null && fileName) x.source_ref = String(fileName);
    if (x.source !== 'official') x.source = 'import';
    const r = rowOf(x, fn, 'import');
    if (r.row) good.push(r.row); else refused.push({ line: i + 2, why: r.why });
  });
  const added = await insertRows(h, entity, good, by);
  return { added: added.length, refused, rates: added.slice(0, 50) };
}
/**
 * rateOn(h, entity, from, to, date, { since }) → { rate, source, date, source_ref } | null — the newest row for that day; with `since`, the newest on or
 * before `date` and not before `since` (a period's closing rate may be its last business day). Never another day's rate for a transaction.
 */
async function rateOn(h, entity, from, to, date, o) {
  if (!(await ready())) return null;
  const x = await S.fxRateOn(h, entity, from, to, date, (o && o.since) || null);
  return x ? { rate: Number(x.rate), source: x.source, date: ymdOf(x.rate_date), source_ref: x.source_ref || null } : null;
}

/* ── a foreign event, in the one composition (lib/books.js composeEntry) ── */
const SETTLES = { payment_received: 'receivable', payment_made: 'payable' };
/**
 * forEvent(h, entity, ev, fn, docDate, C) → null (an event in the books' own currency) | { ev: the event CBPosting is handed, stamp: { source, date } }
 * — or throws a refusal in words. `C` is composeEntry's chart (byRole). The event the rest of the writer sees (its type, its party items) is unchanged.
 */
async function forEvent(h, entity, ev, fn, docDate, C) {
  const cur = ccy(ev.currency);
  if (!cur || cur === ccy(fn)) return null;
  if (SETTLES[ev.type] && !(await linesReady())) throw notMigrated('b392');   /* a settlement needs the foreign balance b392 keeps — said before anything else */
  let stamp;
  if (ev.fx_rate != null && ev.fx_rate !== '') stamp = { rate: Number(ev.fx_rate), source: 'event', date: docDate };
  else {
    const r = await rateOn(h, entity, cur, ccy(fn), docDate);
    if (!r) throw err(missingWords(cur, docDate), 'FX_RATE_MISSING', 422);
    stamp = r;
  }
  if (!SETTLES[ev.type]) return { ev: Object.assign({}, ev, { fx_rate: stamp.rate }), stamp };
  /* a payment in a foreign currency settles at what the books CARRY for the party's foreign balance — the engine posts the difference */
  const side = SETTLES[ev.type], ctl = C.byRole.get(side === 'receivable' ? 'debtors' : 'creditors');
  if (!ctl) throw ask('The shop\'s chart has no ' + (side === 'receivable' ? 'debtors' : 'creditors') + ' ledger.');
  const bal = (await S.foreignBalances(h, entity, { asOf: docDate, functional: ccy(fn), party: ev.party, account_ids: [ctl.account_id], currency: cur }))[0];
  const open = bal ? (side === 'receivable' ? bal.txn_minor : -bal.txn_minor) : 0, carried = bal ? (side === 'receivable' ? bal.fn_minor : -bal.fn_minor) : 0;
  if (!(open > 0) || !(carried > 0)) throw ask('There is no open ' + cur + ' bill for this party — record the ' + cur + ' bill first, then the payment settles it.');
  const M = require('./money'), dpT = M.decimals(cur), dpF = M.decimals(fn);
  const paidMinor = Math.round(Number(ev.amount) * Math.pow(10, dpT));
  if (paidMinor > open) throw ask('This ' + cur + ' payment is more than the ' + cur + ' they owe — record the extra as its own advance.');
  /* the carried value of the part settled: the party's open foreign balance at its average carried rate — the engine converts nothing here */
  const avg = carried / open, carrying = Math.round(paidMinor * avg) / Math.pow(10, dpF);
  return { ev: { type: 'fx_settlement', ref: ev.ref, date: ev.date, currency: ccy(fn), side, party: ev.party, mode: ev.mode, cheque_status: ev.cheque_status,
                 txn_currency: cur, amount_txn: ev.amount, rate: stamp.rate, carrying, narration: ev.narration },
           stamp, book: { rate: Number((avg * Math.pow(10, dpT - dpF)).toPrecision(10)) } };
}
/** the stamp on each composed line: the rate's source and day on a line in a foreign currency; the booked rate on the party line of a settlement */
function stampLine(line, posted, fx, stamps) {
  if (!line.txn_currency || line.txn_currency === line.currency) return line;
  if (!fx) { const st = stamps && stamps[line.txn_currency]; return st ? Object.assign(line, { fx_rate_source: st.source, fx_rate_date: st.date }) : line; }   /* a revaluation: the closing rate's */
  const party = posted.type === 'fx_settlement' && line.party_id;
  return Object.assign(line, { fx_rate_source: party ? 'book' : fx.stamp.source, fx_rate_date: party ? null : fx.stamp.date });
}

/* ── the period-end revaluation ── */
const MONETARY = ['debtors', 'creditors'];   /* the open party balances; a foreign BANK ledger is not told apart from the shop's own bank yet — said, not guessed */
/**
 * revaluation(h, entity, s, fy, period) → { ready, date, reverses_on, functional, rows: [{ account, code, party_id, party, txn_currency, balance_txn_minor,
 *   carrying_minor, rate, rate_date, rate_source, target_minor, diff_minor }], missing: [sentence], gain_minor, posted: { entry_no } | null }
 * The rows are CBPosting.fxRevaluation's — the screen paints them.
 */
async function revaluation(h, entity, s, fy, period) {
  const pack = B.packOf(s), A = E.packs(), fn = pack.currency;
  const rg = A.periodRange(fy, Number(period), pack);
  if (!rg) throw ask('That financial year or month is not one the books know.');
  const out = { ready: (await ready()) && (await linesReady()), date: rg.end, reverses_on: B.addDays(rg.end, 1), functional: fn, rows: [], missing: [], gain_minor: 0, posted: null };
  if (!out.ready) return out;
  const C = await chart(h, entity);
  const ids = MONETARY.map((r) => C.byRole.get(r)).filter(Boolean).map((a) => a.account_id);
  const bals = ids.length ? await S.foreignBalances(h, entity, { asOf: rg.end, functional: fn, account_ids: ids }) : [];
  const curs = Array.from(new Set(bals.map((b) => b.txn_currency))).sort();
  const rates = {}, info = {};
  for (const c of curs) { const r = await rateOn(h, entity, c, fn, rg.end, { since: rg.start }); if (r) { rates[c] = r.rate; info[c] = r; } }
  const M = require('./money'), major = (m, c) => m / Math.pow(10, M.decimals(c));
  const items = bals.map((b) => ({ account: C.byId.get(String(b.account_id)).role, party: b.party_id, txn_currency: b.txn_currency, balance_txn: major(b.txn_minor, b.txn_currency), carrying: major(b.fn_minor, fn) }));
  const ref = 'fxrev:' + fy + ':' + Number(period);
  const r = E.posting().fxRevaluation({ pack, functional: fn, date: rg.end, ref, items, rates });
  const names = await S.partyNames(h, entity, bals.map((b) => b.party_id));
  out.rows = r.rows.map((x) => { const a = C.byRole.get(x.account) || {}; const i = info[x.txn_currency] || {};
    return Object.assign({}, x, { code: a.code || null, party_id: x.party, party: names[x.party] || null, rate_date: i.date || null, rate_source: i.source || null }); });
  out.missing = r.missing.map((w) => w.replace(rg.end, dayWord(rg.end)));
  out.gain_minor = r.gain_minor;
  out.event = r.event; out.ref = ref; out.info = info;
  const seen = await S.entryBySource(h, entity, ref);
  if (seen) out.posted = { entry_id: seen.entry_id, entry_no: seen.entry_no };
  return out;
}
async function chart(h, entity) {
  const all = await S.accounts(h, entity), byRole = new Map(), byId = new Map();
  all.forEach((a) => { if (a.role) byRole.set(a.role, a); byId.set(String(a.account_id), a); });
  return { byRole, byId };
}
/**
 * revalue(h, entity, s, fy, period, by) → { ok, entry_no, reversal_no, gain_minor } — the revaluation at the period's last day and its reversal on the next
 * period's first day, in the caller's ONE transaction (postEntry on the same handle; idempotent on source_ref). Refused in words: not migrated, a rate
 * missing, nothing to revalue, already done.
 */
async function revalue(h, entity, s, fy, period, by) {
  const v = await revaluation(h, entity, s, fy, period);
  if (!v.ready) throw notMigrated((await ready()) ? 'b392' : 'b391');
  if (v.posted) return { ok: true, duplicate: true, entry_no: v.posted.entry_no, gain_minor: v.gain_minor };
  if (v.missing.length) throw ask(v.missing[0]);
  if (!v.event) throw ask('Nothing to revalue — every open foreign balance is already at the closing rate.');
  const narr = 'Revaluation of open foreign balances at the closing rate · ' + Object.keys(v.info).map((c) => c + ' ' + v.info[c].rate + ' (' + v.info[c].source + ', ' + dayWord(v.info[c].date) + ')').join(' · ');
  const base = Object.assign({}, v.event, { narration: narr, strict_date: true, owner: true, by, fx_stamps: v.info });
  const a = await B.postEntry(h, entity, Object.assign({}, base, { source_ref: v.ref }));
  const b = await B.postEntry(h, entity, Object.assign({}, base, { date: v.reverses_on, ref: v.ref + ':r', source_ref: v.ref + ':r', reverse: true, reverses: v.ref,
    narration: 'Reversal of ' + (a.entry_no || v.ref) + ' — the revaluation comes back on the first day of the next period' }));
  return { ok: true, entry_no: a.entry_no, reversal_no: b.entry_no, gain_minor: v.gain_minor, date: v.date, reverses_on: v.reverses_on };
}

module.exports = { SOURCES, ready, linesReady, dayWord, missingWords, rowOf, rateOf, list, add, importCsv, rateOn, forEvent, stampLine, revaluation, revalue, notMigrated };
