'use strict';
/**
 * lib/books-daybook.js — the Day book's readers: a ledger line's source (where it came from, how it was paid, when), the page asked for, who posted, and the narration words.
 * OWNS      WORD · fyStart · sourceOf · momentOf · pageQ · daybookPageQ · cursorOf · partyNames · postedByIn (no route, no state)
 * CALLED BY routes/books.js (GET /daybook, /ledger/:account, /party/:id/statement and the period reads)
 * FLOW      a store.entryLines row -> sourceOf(line) { chit_id, ref, kind, counter, by, how, doc_at, recorded_at } · pageQ(query) -> the keyset page asked for
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
const books = require('./books');
const engines = require('./books-engines');
const store = require('./books-store');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORD = {
  walkin_day: 'Walk-in sales',
  sale_bill: 'Sale',
  purchase_bill: 'Purchase',
  payment_received: 'Payment received',
  payment_made: 'Payment made',
  credit_given: 'Credit given',
  expense: 'Expense',
  other_income: 'Income',
  return: 'Return',
  credit_note: 'Credit note', debit_note: 'Debit note',
  purchase_return: 'Returned to supplier',
  write_off: 'Written off',
  opening: 'Opening balance',
  manual: 'Journal',
  reversal: 'Reversal'
};

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function fyStart(req, asOf) {
  const pack = books.packOf(req.books);
  const packs = engines.packs();
  return packs.fyRange(packs.fiscalYearOf(asOf, pack), pack).start;
}
/**
 * ⭐ WHERE AN ENTRY CAME FROM (Athi, 2026-10-01, the first real entry: "where is it referenced to the sale record, how do I
 * connect to the sale record, who has done it?") — from the src_* columns store.entryLines reads in its own query:
 *   { chit_id   the shop's OWN chit (null when it is not the shop's — the screen links only what it can open)
 *     ref       the number as printed (printed_as → bill_no → the receipt's R/… number)
 *     kind      bill · purchase · receipt · payment · credit_note · expense · income · day · write_off · reversal · …
 *     counter   the counter it was billed on (C2) — the chit's, else the day's source_ref, else a line's
 *     by        who was signed in at the counter (business_json.till.by), else who wrote the entry (created_by → identities)
 *     count     a walk-in day: how many bills it covers
 *     bills     a walk-in day: [{ chit_id, ref }] — the bills it covers, each openable (null when the read was not of its first line) }
 * null for an entry with no chit behind it (a payment typed in the Ledger, an opening, a manual entry).
 * ⚠️ A walk-in day names no seller: many people sold those bills, and "by" on it would read as if one person sold them all.
 */
const KIND = {
  sale_bill: 'bill',
  purchase_bill: 'purchase',
  payment_received: 'receipt',
  payment_made: 'payment',
  return: 'credit_note',
  purchase_return: 'credit_note',
  expense: 'expense',
  other_income: 'income',
  write_off: 'write_off',
  reversal: 'reversal',
  manual: 'manual',
  opening: 'opening',
  credit_given: 'bill'
};
/* ⭐ M09: a PHONE's bill says `till.by` as the identity id the session is checked against and the NAME beside it as
   `till.by_name` (till.html tillStamp); a key's bill still sends { id, name, kind }. The books show the name either way. */
/** a till stamp that is an identity id shows the name read in the same query, or nothing (an id is never shown); plain text shows as typed */
const stampWord = (text, line) => (UUID.test(text) ? (line.src_by_ident && String(line.src_by_ident).trim()) || null : text);
/** who sold the bill, by name: the key's { name }, else the phone's by_name, else the plain text of src_by; null when none says */
function sellerOf(line) {
  const text = line.src_by;
  if (text && typeof text === 'object') return text.name || null;
  if (line.src_by_name && String(line.src_by_name).trim()) return String(line.src_by_name).trim();
  if (typeof text !== 'string' || !text.trim()) return null;
  return stampWord(text.trim(), line);
}
/** the kind a ledger line reports: 'day' for a walk-in day, 'bill' for a day's own bill, else the KIND word of its event (or the event itself) */
function sourceKindOf(line, isWalkinDay) {
  if (isWalkinDay) return 'day';
  return line.event_type === 'walkin_day' ? 'bill' : KIND[line.event_type] || line.event_type || null;
}
/** the counter a line was billed on: the chit's till, else the walk-in day's source_ref (walkin:<counter>:…), else the line's own */
function counterOf(line) {
  const match = /^walkin:([^:]+):/.exec(String(line.source_ref || ''));
  return line.src_till || (match ? match[1] : null) || line.counter_id || null;
}
/** where an entry came from: the { chit_id, ref, kind, counter, by, count, bills } of the block above, or null when no chit is behind the line */
function sourceOf(line) {
  const isWalkinDay = Number(line.covers) > 0 && !line.source_chit_id;
  if (!line.source_chit_id && !isWalkinDay) return null;
  const seller = sellerOf(line);
  const payWord = howOf(line, isWalkinDay);
  return {
    chit_id: line.src_chit_id || null,
    ref: line.src_ref || null,
    kind: sourceKindOf(line, isWalkinDay),
    counter: counterOf(line),
    by: isWalkinDay ? null : seller || line.by_name || null, /* the poster is the fallback; none = no "rung by" part (the counter still names the till) */
    count: isWalkinDay ? Number(line.covers) : null,
    bills: isWalkinDay && Array.isArray(line.day_bills) ? line.day_bills : null,
    how: payWord.how,
    how_ref: payWord.how_ref,
    split: payWord.split,
    doc_at: isWalkinDay ? null : momentOf(line.src_billed_at) || momentOf(line.src_created_at),
    recorded_at: momentOf(line.recorded_at)
  };
}
/**
 * ⭐ BOTH TIMES (Athi, 2026-10-01: "the time the bill was made or the time the entry was accepted? both should be there"):
 *   doc_at       the chit's own moment, ISO — the counter's billed_at (a receipt's at), else the chit's created_at; null
 *                for a walk-in day (many bills) or a chit that is not the shop's
 *   recorded_at  the entry's created_at — when the ledger accepted it
 * ⚠️ billed_at is the counter's free text: a value that is not a moment is skipped, never passed on as one.
 */
function momentOf(date) {
  if (date == null || date === '') return null;
  const time = date instanceof Date ? date.getTime() : Date.parse(String(date));
  return isFinite(time) ? new Date(time).toISOString() : null;
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
const PAY_MODE_WORDS = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', bank: 'Bank', credit: 'On credit' };
function howWord(mode) {
  const canonicalMode = require('./books-hooks').modeOf(mode);
  return canonicalMode ? PAY_MODE_WORDS[canonicalMode] : String(mode || '').trim() || null;
}
/** a walk-in day's tenders added up by mode, as the { how, how_ref, split } howOf answers */
function walkinDaySplit(line) {
  const split = [];
  (Array.isArray(line.tenders) ? line.tenders : []).forEach((item) => {
    const word = PAY_MODE_WORDS[item.role] || item.role,
      x = split.find((entry) => entry.how === word);
    if (x) x.amount_minor += Number(item.dr_minor);
    else split.push({ how: word, amount_minor: Number(item.dr_minor) });
  });
  return { how: split.length ? split.map((item) => item.how).join(' · ') : null, how_ref: null, split: split.length ? split : null };
}
/** how a ledger line was paid, as { how, how_ref, split }: a walk-in day splits its tenders by mode; any other line names its mode (and cheque no. · bank) or its parts */
function howOf(line, isWalkinDay) {
  if (isWalkinDay) return walkinDaySplit(line);
  if (line.src_mode) {
    const cheque = line.src_cheque && typeof line.src_cheque === 'object' ? line.src_cheque : null;
    return { how: howWord(line.src_mode), how_ref: cheque && cheque.no ? [cheque.no, cheque.bank].filter(Boolean).join(' · ') : null, split: null };
  }
  const parts = Array.isArray(line.src_parts) ? line.src_parts.filter((item) => item && item.how) : [];
  const words = [];
  parts.forEach((item) => {
    const word = howWord(item.how);
    if (word && words.indexOf(word) < 0) words.push(word);
  });
  const ref = parts.map((item) => item.ref || item.reference || item.utr).find((x) => x != null && String(x).trim());
  return { how: words.length ? words.join(' + ') : null, how_ref: ref ? String(ref).trim() : null, split: null };
}
/** the names of the parties a read shows — PERF1: `ids` = only those (a Day book page, the cheques list); without ids every party of the shop (Dues) */
async function partyNames(db, e, ids) {
  const lookup = new Map();
  (await store.parties(db, e, ids)).forEach((item) => lookup.set(String(item.party_id), item));
  return lookup;
}
const pageLimit = require('./page-limit');
const { textOf } = require('./input-hygiene');
/**
 * ⭐ PERF1 · THE PAGE A BOOKS LIST IS ASKED FOR (DISCIPLINES §2 — the Inbox's contract: top-level total · page · limit, a server-side maximum):
 *   ?limit=1..500 (default 100) · ?after=YYYY-MM-DD|ENTRY_NO — the last row of the page before (keyset, never OFFSET) · ?page — the client's count, echoed
 *   ?entries=<entry_id>,… (≤ 500) — exactly those entries (a ledger line opening its own journal reads them, not the year's Day book)
 * null = nothing asked: the whole range, as before PERF1 (the screens adopt the pages in the web's PERF2).
 */
function pageQ(query) {
  const ids = String(query.entries || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => UUID.test(x));
  if (ids.length) return { entries: ids.slice(0, store.PAGE_MAX) };
  if (query.limit == null && query.after == null && query.page == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})\|(.{1,60})$/.exec(String(query.after || ''));
  /* l16-scale: ?order=desc reads the pages NEWEST first (the Day book, and a Ledger asked for its newest lines: those carry no running balance); the default stays oldest first (the Ledgers page keeps it: its running balance runs from the opening) */
  return { limit: pageLimit.limitOf(query.limit, store.PAGE_DEFAULT, store.PAGE_MAX), after: match ? { date: match[1], no: match[2] } : null, page: pageLimit.pageOf(query.page), desc: String(query.order || '').toLowerCase() === 'desc' };
}
/**
 * ⭐ 1132 · THE DAY BOOK'S PAGE (Athi, 26 Nov 2026: "any read is a handful of records, lazy-load the rest"): the page asked for, and when nothing is asked ONE default page (never the whole range, as pageQ's null did).
 * The Ledger keeps pageQ (its running balance needs the whole range read from the opening); only GET /daybook reads through this one.
 */
function daybookPageQ(query) {
  const asked = pageQ(query);
  if (asked) return asked;
  return { limit: pageLimit.limitOf(query.limit, store.PAGE_DEFAULT, store.PAGE_MAX), after: null, page: pageLimit.pageOf(query.page), desc: String(query.order || '').toLowerCase() === 'desc' };
}
const cursorOf = (next) => (next ? next.date + '|' + next.no : null);

/** l16 adviser-bank: each entry an ADVISER's person posted (journal_entry.grant_id) gets `posted_by` { name, firm } — kept at the write (b871), so the owner reads it with no read into the firm's identities; null for every other entry. One read, only when b871 has run and an entry carries a grant. */
async function postedByIn(db, e, entries) {
  for (const item of entries) item.posted_by = null;
  if (!entries.length || !(await require('./schema').hasColumn('journal_entry', 'by_firm'))) return;
  const rows = (await db.query('SELECT entry_id, by_name, by_firm FROM journal_entry WHERE entity_id = $1 AND entry_id = ANY($2::uuid[]) AND grant_id IS NOT NULL', [e, entries.map((item) => item.entry_id)])).rows;
  const byId = new Map(rows.map((row) => [String(row.entry_id), { name: row.by_name || null, firm: row.by_firm || null }]));
  for (const item of entries) item.posted_by = byId.get(String(item.entry_id)) || null;
}

/** rank 10: ?since=mine -> { since } (the entries posted after THIS person's last Mark as checked; the server reads it, never a moment typed by the browser) | { refusal } the problem spec; not asked -> { since: null } */
async function sinceAsked(req, e) {
  if (textOf(req.query.since, { trim: false }).toLowerCase() !== 'mine') return { since: null };
  try {
    return { since: await require('./books-baseline').sinceOfRequest(req, e) };
  } catch (refused) {
    if (!refused || !refused.words) throw refused;
    return { refusal: { status: refused.status, code: refused.code, detail: refused.words, legacy: { error: refused.words, message: refused.words } } };
  }
}

/** the lines the Day book shows, read on the open transaction: the changed list (since), a named set of entries, a keyset page, or the whole range -> { lines, changed, paged } */
async function linesRead(db, e, asked) {
  const { since, sincePage, pg, from, to } = asked;
  if (since) {
    const changed = await require('./books-baseline').changedPage(db, e, since.at, sincePage.limit, sincePage.page);
    const lines = changed.ids.length ? await store.entryLines(db, e, '0001-01-01', '9999-12-31', null, null, { entries: changed.ids }) : [];
    return { lines, changed, paged: null };
  }
  if (pg && pg.entries) return { lines: await store.entryLines(db, e, from, to, null, null, pg), changed: null, paged: null };
  if (!pg) return { lines: await store.entryLines(db, e, from, to, null, null), changed: null, paged: null };
  const page = await store.entryPage(db, e, from, to, null, null, pg),
    sums = await store.pageSums(db, e, from, to, null, null, null, false);
  return { lines: page.rows, changed: null, paged: { next: page.next, limit: page.limit, sums } };
}

/** one entry's head, from its first line (since: the changed list also says who recorded it) */
function entryOf(line, since) {
  return {
    entry_id: line.entry_id,
    entry_no: line.entry_no,
    posting_date: engines.ymd(line.posting_date),
    doc_date: engines.ymd(line.doc_date),
    event_type: line.event_type,
    narration: line.narration || WORD[line.event_type] || line.event_type,
    no_narration: !String(line.narration || '').trim() /* ASA 240: the server fills a word above; this says whether a person wrote one */,
    recorded_at: momentOf(line.recorded_at) /* when the ledger took the entry, on EVERY entry (a manual journal has no `source` to carry it) */,
    made_by: line.by_name || null /* who made it: the identity that created the entry; null when unknown */,
    source_chit_id: line.source_chit_id,
    reverses_entry_id: line.reverses_entry_id,
    reversed_by: line.reversed_by || null,
    reversed_by_id: line.reversed_by_id || null /* M174: "Reversed by MJ/…" — a link, and no Reverse button */,
    source: sourceOf(line),
    /* rank 10: recorded_at (above, on every entry) and recorded_by say when it was posted and by whom, so the list of changes says who and when */
    recorded_by: since ? line.by_name || null : undefined,
    lines: []
  };
}

/** C4: the foreign amount and the rate a foreign line posted at — { currency, rate, foreign_minor }, or null when the line is in the books' own currency (or before b392) */
const fxOf = (line) => (line.txn_currency && line.txn_currency !== line.currency && line.fx_rate != null ? { currency: line.txn_currency, rate: Number(line.fx_rate), foreign_minor: Math.abs(Number(line.amount_txn_minor)) } : null);
/** one journal line as the Day book shows it; partyRow = the party it names (or null) */
function lineOf(line, partyRow) {
  return { 
    code: line.code,
    name: line.account_name,
    party_id: line.party_id,
    party_name: partyRow ? partyRow.nickname || partyRow.name : null,
    dr_minor: Number(line.dr_minor),
    cr_minor: Number(line.cr_minor),
    counter: line.counter_id,
    rate: line.tax_rate == null || line.tax_rate === '' ? null : Number(line.tax_rate),
    fx: fxOf(line)
  }; /* the tax rate the line was posted at - the Day book writes "@ 12%" beside it */
}

/** the lines grouped into entries, in the order the lines arrive; party names resolved from `names` */
function entriesOf(lines, names, since) {
  const entries = [],
    at = new Map();
  for (const line of lines) {
    let x = at.get(line.entry_id);
    if (!x) {
      x = entryOf(line, since);
      at.set(line.entry_id, x);
      entries.push(x);
    }
    if (x.source && !x.source.counter && line.counter_id) x.source.counter = line.counter_id;
    x.lines.push(lineOf(line, line.party_id ? names.get(String(line.party_id)) : null));
  }
  return entries;
}

/** PERF1: a page says its place - total entries in [from, to] · page · limit · `next` (the ?after= of the next page, null on the last) · the range's sum of Dr / Cr, from the server */
function pagePlace(since, read, sincePage, pg) {
  if (since) return { total: read.changed.total, page: sincePage.page, limit: sincePage.limit, next: null, totals: undefined };
  if (!read.paged) return {};
  const { paged } = read;
  return { total: paged.sums.entries, page: pg.page, limit: paged.limit, next: cursorOf(paged.next), totals: { dr_minor: paged.sums.dr, cr_minor: paged.sums.cr } };
}

module.exports = { sinceAsked, linesRead, entriesOf, pagePlace,  UUID, WORD, fyStart, sourceOf, momentOf, pageQ, daybookPageQ, cursorOf, partyNames, postedByIn };
