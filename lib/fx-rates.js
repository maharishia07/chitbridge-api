// OWNS      foreign-currency trade in the books: the typed or imported rates (b391), the rate a foreign entry posts at, the settlement of a foreign bill and the period-end revaluation; every figure comes from the posting engines
// FLOW      event in a foreign currency ──▶ forEvent picks the rate (own, else that day's) ──▶ CBPosting fx_settlement / fx_revalue ──▶ lines posted once; no rate = refused in words
// @stage tested
// CALLED BY lib/forms.js, routes/books.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// @stage-note [BOOKS · FX1] The exchange rates a shop typed or imported (b391), the rate a foreign entry posts at, the settlement of a foreign bill
// @stage-note and the period-end revaluation — every figure from the engines (CBPosting fx_settlement · fx_revalue · fxRevaluation), none computed here.
'use strict';
// CARD  16-finance/fx-rates
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
const { waiting } = require('./not-migrated');
const books = require('./books');
const booksEngines = require('./books-engines');
const booksStore = require('./books-store');

const SOURCES = ['manual', 'import', 'official'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_IMPORT = 1000;

const ready = () => booksStore.fxRatesReady();
const linesReady = () => booksStore.fxLinesReady();
function err(reason, code, status) {
  const e = new Error(reason);
  e.code = code;
  e.refused = true;
  if (status) e.status = status;
  return e;
}
/** the two 503 sentences, one place (routes/books reads them too); the ids b391 / b392 stay here in the comment and the log */
const WAITS = {
  rates: waiting('Exchange rates', true, 'No rate was saved and no foreign amount can be recorded; record it after the update.'),
  balances: waiting('Foreign balances', true, 'A payment or settlement in a foreign currency was refused and nothing was saved; record it after the update.'),
  // the READ of Month lock's foreign-balances line: nothing was attempted, so nothing was refused (api #869 sign-off review, 7 Nov)
  balancesView: waiting('Foreign balances', true, 'They cannot be revalued yet; nothing in your books has changed.')
};
const notMigrated = (code) => err(code === 'b392' ? WAITS.balances : WAITS.rates, 'BOOKS_NOT_MIGRATED');
const askRefusal = (reason) => err(reason, 'BOOKS_REFUSED', 422);
/** '2026-10-14' → '14 Oct' — the day a shopkeeper reads */
function dayWord(dateText) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''));
  return dateParts ? Number(dateParts[3]) + ' ' + MONTHS[Number(dateParts[2]) - 1] : String(dateText || '');
}
/** a rate as a shopkeeper reads it: 55.250000 → 55.25 */
const plainRate = (rate) => String(rate).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
/**
 * the sentence a foreign entry with no rate waits with (Waiting, the preview, the payment). ⭐ ACC-377 (d): when an EARLIER day has a rate (a weekend, a holiday)
 * the sentence names it — "Last rate: 55 on 30 Oct — confirm it there to use it." It is a suggestion only: the owner confirms by adding the day's rate; nothing posts on it.
 */
function missingWords(currency, date, suggestion) {
  const base = 'No ' + currency + ' rate for ' + dayWord(date) + ' — add it in Accounts › Rates.';
  return suggestion ? base + ' Last rate: ' + plainRate(suggestion.rate) + ' on ' + dayWord(suggestion.date) + ' — confirm it there to use it.' : base;
}
/** how many days a suggested rate may lie behind the day (a weekend and a long holiday; an older rate is not offered — a rate is evidence, never a guess) */
const SUGGEST_DAYS = 7;
/** the day `days` before a YYYY-MM-DD, as YYYY-MM-DD (the one day arithmetic: books-engines addDays) */
const dayMinus = (dateText, days) => booksEngines.addDays(dateText, -days);
/** how many days (1 … SUGGEST_DAYS) `earlier` lies before `later`, or null when it is further back */
const daysBetween = (earlier, later) => {
  for (let days = 1; days <= SUGGEST_DAYS; days++) if (dayMinus(later, days) === earlier) return days;
  return null;
};

/* ── a rate row ── */
const currencyCode = (value) =>
  String(value == null ? '' : value)
    .trim()
    .toUpperCase();
/* THE SANE BAND of a rate (functional currency per 1 foreign unit): 1e-6 to 1e6. The widest real pairs sit well inside it (IDR to BHD near 2.4e-5, BHD to IDR near 4e4);
   outside it is a slipped decimal (1e12) that would post a ledger-wrecking figure, so it is refused in words, never clamped. */
const RATE_MIN = 1e-6;
const RATE_MAX = 1e6;
/** a rate as typed: a plain positive decimal, at most 10 places (b391 numeric(24,10)) — never an exponent, never 0 */
function rateOf(value) {
  const trimmed = String(value == null ? '' : value)
    .trim()
    .replace(/,/g, '');
  if (!/^\d{1,14}(\.\d{1,10})?$/.test(trimmed) || !(Number(trimmed) >= RATE_MIN && Number(trimmed) <= RATE_MAX)) return null;
  return trimmed;
}
/* a real day in the years the books hold (1900-2100): the one reader, books-period.isCalendarDay; year 0001 used to pass and was stored as "1-01-01" */
const dateOk = (dateText) => require('./books-period').isCalendarDay(String(dateText || ''));
/** why a rate's currency is refused (three letters, then ISO 4217's own list: the one list money.js holds), or null */
function currencyWhy(code) {
  if (!/^[A-Z]{3}$/.test(code)) return 'The currency is three letters (USD).';
  const money = require('./money');
  if (money.isWithdrawnCurrency(code)) return code + ' has been withdrawn from ISO 4217, so a new rate in it is refused. Old records in it stay readable.';
  if (!money.isIsoCurrency(code)) return code + ' is not a currency code ISO 4217 lists, so its rate is refused (USD, EUR, AUD).';
  return null;
}

/** the first reason a parsed rate row is refused, in words (null when it is fine) */
function rateRefusal(parts, functional) {
  const { date, from, to, rate, source } = parts;
  if (!dateOk(date)) return 'The day is a date (YYYY-MM-DD).';
  if (currencyWhy(from)) return currencyWhy(from);
  if (to !== currencyCode(functional)) return 'A rate is to ' + currencyCode(functional) + ', the currency these books are kept in.';
  if (from === to) return 'A rate is between two different currencies.';
  if (rate === null) return 'The rate is a number more than 0 (83.25), between 0.000001 and 1,000,000.';
  if (SOURCES.indexOf(source) < 0) return 'The source is manual, import or official.';
  return null;
}
/** the free-text source reference: trimmed, at most 120 characters, null when blank */
function sourceRefOf(value) {
  return value == null ? null : String(value).trim().slice(0, 120) || null;
}
/** one row → { rate_date, from_ccy, to_ccy, rate, source, source_ref } or the reason it is refused, in words */
function rowOf(rateRow, functional, dflt) {
  const x = rateRow || {},
    to = currencyCode(x.to || x.to_ccy || functional),
    from = currencyCode(x.from || x.from_ccy || x.currency);
  const date = String(x.date || x.rate_date || '').trim(),
    rate = rateOf(x.rate),
    source = String(x.source || dflt || 'manual')
      .trim()
      .toLowerCase();
  const refusal = rateRefusal({ date, from, to, rate, source }, functional);
  if (refusal) return { why: refusal };
  return { row: { rate_date: date, from_ccy: from, to_ccy: to, rate, source, source_ref: sourceRefOf(x.source_ref) } };
}

/* ── the table (b391) ── */
async function list(handle, entity, query) {
  if (!(await ready())) return [];
  const opts = query || {};
  return (await booksStore.fxRates(handle, entity, { from: opts.from ? currencyCode(opts.from) : null, limit: Math.min(Math.max(Number(opts.limit) || 500, 1), 2000) })).map(outRow);
}
/* a rate_date is a `date` column: read with THE one date reader (books-engines ymd — local getters, the same day in every zone). FX1 had
   its own toISOString() copy, which dated every rate a day early on a server east of UTC (local walk, 14 Oct). */
const ymdOf = booksEngines.ymd;
/** a stored rate as text, without trailing zeros (83.2500 -> 83.25, 5.0 -> 5) */
function rateText(rate) {
  return String(rate)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}
/** a stored rate row as the API shows it (date text, rate text, who entered it) */
function outRow(x) {
  const dateText = ymdOf(x.rate_date);
  return {
    rate_id: String(x.rate_id),
    date: dateText,
    from: x.from_ccy,
    to: x.to_ccy,
    rate: rateText(x.rate),
    source: x.source,
    source_ref: x.source_ref || null,
    entered_by: x.entered_by || null,
    created_at: x.created_at
  };
}
const insertRows = async (handle, entity, rows, by) => (await booksStore.insertFxRates(handle, entity, rows, by)).map(outRow);
async function addRate(handle, entity, settings, body, by) {
  if (!(await ready())) throw notMigrated('b391');
  const rate = rowOf(require('./books-input').typedRate(body, settings), books.packOf(settings).currency, 'manual'); /* H-h2-006/007 */
  if (!rate.row) throw askRefusal(rate.why);
  return (await insertRows(handle, entity, [rate.row], by))[0];
}
/**
 * importCsv — a CSV the owner loaded: columns date · currency (or from) · rate, optional to · source · source_ref. Each row is checked; the good rows go in
 * as ONE insert with source 'import' (or 'official' when the row says so) and the file name as source_ref; the refused ones come back with their line and why.
 */
async function importCsv(handle, entity, settings, text, fileName, by) {
  if (!(await ready())) throw notMigrated('b391');
  const parsed = require('./csv').parseCSV(String(text || ''));
  const lower = (opts) => {
    const x = {};
    Object.keys(opts).forEach((item) => {
      x[String(item).trim().toLowerCase()] = opts[item];
    });
    return x;
  };
  if (!parsed.rows.length) throw askRefusal('The file has no rows — a header line (date, currency, rate) and one rate per line.');
  if (parsed.rows.length > MAX_IMPORT) throw askRefusal('At most ' + MAX_IMPORT + ' rates in one file.');
  const good = [],
    refused = [],
    fn = books.packOf(settings).currency;
  parsed.rows.forEach((item, index) => {
    const x = lower(item);
    if (x.source_ref == null && fileName) x.source_ref = String(fileName);
    if (x.source !== 'official') x.source = 'import';
    const rate = rowOf(x, fn, 'import');
    if (rate.row) good.push(rate.row);
    else refused.push({ line: index + 2, why: rate.why });
  });
  const added = await insertRows(handle, entity, good, by);
  return { added: added.length, refused, rates: added.slice(0, 50) };
}
/**
 * rateOn(h, entity, from, to, date, { since }) → { rate, source, date, source_ref } | null — the newest row for that day; with `since`, the newest on or
 * before `date` and not before `since` (a period's closing rate may be its last business day). Never another day's rate for a transaction.
 */
async function rateOn(handle, entity, from, to, date, opts) {
  if (!(await ready())) return null;
  const x = await booksStore.fxRateOn(handle, entity, from, to, date, (opts && opts.since) || null);
  return x ? { rate: Number(x.rate), source: x.source, date: ymdOf(x.rate_date), source_ref: x.source_ref || null } : null;
}

/**
 * suggest(h, entity, from, to, date) → { rate, date, source, days_earlier } | null — ⭐ ACC-377 (d): the newest rate BEFORE `date` and within 7 days, only for a day that has NO
 * rate of its own. A SUGGESTION: the owner confirms it by adding that day's rate (Accounts › Rates); the books never post on it (forEvent still refuses).
 */
async function suggest(handle, entity, from, to, date) {
  if (!dateOk(date) || !(await ready())) return null;
  if (await rateOn(handle, entity, from, to, date)) return null;
  const near = await rateOn(handle, entity, from, to, date, { since: dayMinus(date, SUGGEST_DAYS) });
  if (!near || near.date >= date) return null;
  return Object.assign({}, near, { days_earlier: daysBetween(near.date, date) });
}

/* ── a foreign event, in the one composition (lib/books.js composeEntry) ── */
const SETTLES = { payment_received: 'receivable', payment_made: 'payable' };
/**
 * rateStamp(h, entity, event, { currency, functional, docDate }) → { rate, source, date } — the rate an event posts at: its OWN (a bank's rate on a payment, a bill's stated rate), else its day's from fx_rate,
 * else refused in words (FX_RATE_MISSING) — naming the last earlier rate when there is one (ACC-377 d; a suggestion the owner confirms, never used here).
 */
async function rateStamp(handle, entity, event, onDay) {
  if (event.bank_amount_minor != null) return { rate: null, source: 'bank', date: onDay.docDate }; /* the bank's own amount rides the event (the engine's `amount`): no rate is computed here */
  if (event.fx_rate != null && event.fx_rate !== '') return { rate: Number(event.fx_rate), source: event.fx_rate_source || 'event', date: onDay.docDate };
  const rate = await rateOn(handle, entity, onDay.currency, onDay.functional, onDay.docDate);
  if (rate) return rate;
  const near = await suggest(handle, entity, onDay.currency, onDay.functional, onDay.docDate);
  throw Object.assign(err(missingWords(onDay.currency, onDay.docDate, near), 'FX_RATE_MISSING', 422), near ? { suggest: near } : {});
}
/**
 * forEvent(h, entity, ev, fn, docDate, C) → null (an event in the books' own currency) | { ev: the event CBPosting is handed, stamp: { source, date } }
 * — or throws a refusal in words. `C` is composeEntry's chart (byRole). The event the rest of the writer sees (its type, its party items) is unchanged.
 */
async function forEvent(handle, entity, event, fn, docDate, chartIndex) {
  const currency = currencyCode(event.currency);
  if (!currency || currency === currencyCode(fn)) return null;
  if (SETTLES[event.type] && !(await linesReady())) throw notMigrated('b392'); /* a settlement needs the foreign balance b392 keeps — said before anything else */
  const stamp = await rateStamp(handle, entity, event, { currency, functional: currencyCode(fn), docDate });
  if (!SETTLES[event.type]) return { ev: Object.assign({}, event, { fx_rate: stamp.rate }), stamp };
  return settlementFor(handle, entity, { event, fn, docDate, chartIndex, currency, stamp });
}
/**
 * the fx_settlement event for a foreign-currency payment (forEvent's settling half): checked against the party's open foreign balance, carried at its average rate.
 * `at` = { event, fn, docDate, chartIndex, currency, stamp } — forEvent's own values; throws a refusal in words.
 */
async function settlementFor(handle, entity, at) {
  const { event, fn, docDate, chartIndex, currency, stamp } = at;
  /* a payment in a foreign currency settles at what the books CARRY for the party's foreign balance — the engine posts the difference */
  const side = SETTLES[event.type],
    control = chartIndex.byRole.get(side === 'receivable' ? 'debtors' : 'creditors');
  if (!control) throw askRefusal("The shop's chart has no " + (side === 'receivable' ? 'debtors' : 'creditors') + ' ledger.');
  const balances = (await booksStore.foreignBalances(handle, entity, { asOf: docDate, functional: currencyCode(fn), party: event.party, account_ids: [control.account_id], currency: currency }))[0];
  const open = balances ? (side === 'receivable' ? balances.txn_minor : -balances.txn_minor) : 0,
    carried = balances ? (side === 'receivable' ? balances.fn_minor : -balances.fn_minor) : 0;
  if (!(open > 0) || !(carried > 0))
    throw askRefusal('There is no open ' + currency + ' bill for this party — record the ' + currency + ' bill first, then the payment settles it.');
  const money = require('./money'),
    decimalsTxn = money.decimals(currency),
    decimalsFunctional = money.decimals(fn);
  const paidMinor = Math.round(Number(event.amount) * Math.pow(10, decimalsTxn));
  if (paidMinor > open) throw askRefusal('This ' + currency + ' payment is more than the ' + currency + ' they owe — record the extra as its own advance.');
  /* the carried value of the part settled: the party's open foreign balance at its average carried rate — the engine converts nothing here */
  const avgRate = carried / open,
    carrying = Math.round(paidMinor * avgRate) / Math.pow(10, decimalsFunctional);
  return {
    ev: {
      type: 'fx_settlement',
      ref: event.ref,
      date: event.date,
      currency: currencyCode(fn),
      side,
      party: event.party,
      mode: event.mode,
      cheque_status: event.cheque_status,
      txn_currency: currency,
      amount_txn: event.amount,
      ...(stamp.rate == null ? { amount: require('./books-cashflow').fromMinor(event.bank_amount_minor, fn) } : { rate: stamp.rate }),
      carrying,
      narration: event.narration
    },
    stamp,
    book: { rate: Number((avgRate * Math.pow(10, decimalsTxn - decimalsFunctional)).toPrecision(10)) }
  };
}
/**
 * paymentTerms(payment, functional) → null (an ordinary payment) | { currency, amount_minor, fx_rate } | { currency, amount_minor, bank_minor } — ⭐ ACC-377 (a) (b): a payment may state the BANK's side, two ways:
 *   { currency: 'AUD', amount_minor, fx_rate: '56.10' }            the foreign amount paid and the bank's rate
 *   { currency: 'INR', amount_minor, settles: { currency: 'AUD', amount_minor } }   what the bank moved, and how much of the foreign bill it settles → the engine's own `amount` (no rate is computed here)
 * The realised gain or loss is the difference the engine posts (AASB 121 ¶28), never computed here. A refusal is in words.
 */
function paymentTerms(payment, functional) {
  const stated = payment.fx_rate != null && payment.fx_rate !== '',
    settles = payment.settles && typeof payment.settles === 'object' ? payment.settles : null;
  if (!stated && !settles) return null;
  if (stated && settles) throw askRefusal('Say the rate, or the foreign amount this payment settles — not both.');
  const ownCurrency = currencyCode(functional),
    paidIn = currencyCode(payment.currency);
  return stated ? statedTerms(payment, ownCurrency, paidIn) : settlesTerms(payment, settles, ownCurrency, paidIn);
}
/** { currency: 'AUD', amount_minor, fx_rate }: the foreign amount paid and the bank's rate */
function statedTerms(payment, functional, paidIn) {
  if (!paidIn || paidIn === functional) throw askRefusal('A rate is for a payment in a foreign currency; this one is in ' + functional + '.');
  if (currencyWhy(paidIn)) throw askRefusal(currencyWhy(paidIn));
  const rate = rateOf(payment.fx_rate);
  if (rate === null) throw askRefusal('The rate is a number more than 0 (83.25), between 0.000001 and 1,000,000.');
  return { currency: paidIn, amount_minor: payment.amount_minor, fx_rate: rate };
}
/** { currency: 'INR', amount_minor, settles: { currency, amount_minor } }: what the bank moved and how much foreign bill it settles — the bank's amount goes to the engine as it is */
function settlesTerms(payment, settles, functional, paidIn) {
  const foreign = currencyCode(settles.currency),
    foreignMinor = Number(settles.amount_minor);
  if (!foreign || foreign === functional || currencyWhy(foreign)) throw askRefusal('"settles" names the foreign currency of the bill (AUD); ' + functional + " is the books' own currency.");
  if (paidIn && paidIn !== functional) throw askRefusal('Say what the bank moved in ' + functional + ' and how much ' + foreign + ' it settles.');
  if (!Number.isSafeInteger(foreignMinor) || !(foreignMinor > 0)) throw askRefusal('How much ' + foreign + ' does this payment settle? A whole amount in minor units, more than zero.');
  return { currency: foreign, amount_minor: foreignMinor, bank_minor: payment.amount_minor };
}
/**
 * openForeign(h, entity, party, asOf, fn) → [{ currency, txn_minor, fn_minor }] — the party's open foreign balances (b392 columns), [] before the update — ⭐ ACC-377 (b): a payment in the books' own
 * currency, allocated to bills, must not be set against a bill that is open in a foreign currency without saying how much of it this pays.
 */
async function openForeign(handle, entity, party, asOf, fn) {
  if (!(await linesReady())) return [];
  return (await booksStore.foreignBalances(handle, entity, { asOf, functional: currencyCode(fn), party })).filter((x) => Number(x.txn_minor) !== 0).map((x) => ({ currency: x.txn_currency, txn_minor: x.txn_minor, fn_minor: x.fn_minor }));
}
/** the stamp on each composed line: the rate's source and day on a line in a foreign currency; the booked rate on the party line of a settlement */
function stampLine(line, posted, rates, stamps) {
  if (!line.txn_currency || line.txn_currency === line.currency) return line;
  if (!rates) {
    const stamp = stamps && stamps[line.txn_currency];
    return stamp ? Object.assign(line, { fx_rate_source: stamp.source, fx_rate_date: stamp.date }) : line;
  } /* a revaluation: the closing rate's */
  const party = posted.type === 'fx_settlement' && line.party_id;
  return Object.assign(line, { fx_rate_source: party ? 'book' : rates.stamp.source, fx_rate_date: party ? null : rates.stamp.date });
}

/* ── the period-end revaluation ── */
const MONETARY = [
  'debtors',
  'creditors'
]; /* the open party balances; a foreign BANK ledger is not told apart from the shop's own bank yet — said, not guessed */
/**
 * revaluation(h, entity, s, fy, period) → { ready, date, reverses_on, functional, rows: [{ account, code, party_id, party, txn_currency, balance_txn_minor,
 *   carrying_minor, rate, rate_date, rate_source, target_minor, diff_minor }], missing: [sentence], gain_minor, posted: { entry_no } | null }
 * The rows are CBPosting.fxRevaluation's — the screen paints them.
 */
async function revaluation(handle, entity, settings, financialYear, period) {
  const pack = books.packOf(settings),
    periodPacks = booksEngines.packs(),
    fn = pack.currency;
  const range = periodPacks.periodRange(financialYear, Number(period), pack);
  if (!range) throw askRefusal('That financial year or month is not one the books know.');
  const out = {
    ready: (await ready()) && (await linesReady()),
    date: range.end,
    reverses_on: books.addDays(range.end, 1),
    functional: fn,
    rows: [],
    missing: [],
    gain_minor: 0,
    posted: null
  };
  if (!out.ready) return out;
  const chartIndex = await chart(handle, entity);
  const ids = MONETARY.map((item) => chartIndex.byRole.get(item))
    .filter(Boolean)
    .map((item) => item.account_id);
  const bals = ids.length ? await booksStore.foreignBalances(handle, entity, { asOf: range.end, functional: fn, account_ids: ids }) : [];
  const curs = Array.from(new Set(bals.map((item) => item.txn_currency))).sort();
  const rates = {},
    info = {};
  for (const c of curs) {
    const nestedR = await rateOn(handle, entity, c, fn, range.end, { since: range.start });
    if (nestedR) {
      rates[c] = nestedR.rate;
      info[c] = nestedR;
    }
  }
  const money = require('./money'),
    major = (minor, currency) => minor / Math.pow(10, money.decimals(currency));
  const items = bals.map((item) => ({
    account: chartIndex.byId.get(String(item.account_id)).role,
    party: item.party_id,
    txn_currency: item.txn_currency,
    balance_txn: major(item.txn_minor, item.txn_currency),
    carrying: major(item.fn_minor, fn)
  }));
  const ref = 'fxrev:' + financialYear + ':' + Number(period);
  const rate = booksEngines.posting().fxRevaluation({ pack, functional: fn, date: range.end, ref, items, rates });
  const names = await booksStore.partyNames(
    handle,
    entity,
    bals.map((item) => item.party_id)
  );
  out.rows = rate.rows.map((x) => {
    const account = chartIndex.byRole.get(x.account) || {};
    const rateInfo = info[x.txn_currency] || {};
    return Object.assign({}, x, {
      code: account.code || null,
      party_id: x.party,
      party: names[x.party] || null,
      rate_date: rateInfo.date || null,
      rate_source: rateInfo.source || null
    });
  });
  out.missing = rate.missing.map((item) => item.replace(range.end, dayWord(range.end)));
  out.gain_minor = rate.gain_minor;
  out.event = rate.event;
  out.ref = ref;
  out.info = info;
  const seen = await booksStore.entryBySource(handle, entity, ref);
  if (seen) out.posted = { entry_id: seen.entry_id, entry_no: seen.entry_no };
  return out;
}
async function chart(handle, entity) {
  const all = await booksStore.accounts(handle, entity),
    byRole = new Map(),
    byId = new Map();
  all.forEach((item) => {
    if (item.role) byRole.set(item.role, item);
    byId.set(String(item.account_id), item);
  });
  return { byRole, byId };
}
/**
 * revalue(h, entity, s, fy, period, by) → { ok, entry_no, reversal_no, gain_minor } — the revaluation at the period's last day and its reversal on the next
 * period's first day, in the caller's ONE transaction (postEntry on the same handle; idempotent on source_ref). Refused in words: not migrated, a rate
 * missing, nothing to revalue, already done.
 */
async function revalue(handle, entity, settings, financialYear, period, by) {
  const value = await revaluation(handle, entity, settings, financialYear, period);
  if (!value.ready) throw notMigrated((await ready()) ? 'b392' : 'b391');
  if (value.posted) return { ok: true, duplicate: true, entry_no: value.posted.entry_no, gain_minor: value.gain_minor };
  if (value.missing.length) throw askRefusal(value.missing[0]);
  if (!value.event) throw askRefusal('Nothing to revalue — every open foreign balance is already at the closing rate.');
  const narr =
    'Revaluation of open foreign balances at the closing rate · ' +
    Object.keys(value.info)
      .map((item) => item + ' ' + value.info[item].rate + ' (' + value.info[item].source + ', ' + dayWord(value.info[item].date) + ')')
      .join(' · ');
  const base = Object.assign({}, value.event, { narration: narr, strict_date: true, owner: true, by, fx_stamps: value.info });
  const posted = await books.postEntry(handle, entity, Object.assign({}, base, { source_ref: value.ref }));
  const reversal = await books.postEntry(
    handle,
    entity,
    Object.assign({}, base, {
      date: value.reverses_on,
      ref: value.ref + ':r',
      source_ref: value.ref + ':r',
      reverse: true,
      reverses: value.ref,
      narration: 'Reversal of ' + (posted.entry_no || value.ref) + ' — the revaluation comes back on the first day of the next period'
    })
  );
  return { ok: true, entry_no: posted.entry_no, reversal_no: reversal.entry_no, gain_minor: value.gain_minor, date: value.date, reverses_on: value.reverses_on };
}

module.exports = {
  WAITS,
  SOURCES,
  ready,
  linesReady,
  dayWord,
  missingWords,
  rowOf,
  rateOf,
  list,
  add: addRate,
  importCsv,
  rateOn,
  suggest,
  paymentTerms,
  openForeign,
  forEvent,
  stampLine,
  revaluation,
  revalue,
  notMigrated
};
