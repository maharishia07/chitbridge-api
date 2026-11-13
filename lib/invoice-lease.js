/*
 * OWNS      The block LEASE of invoice numbers (CTR-213, ACC-192 S2, Athi 8 Nov 2026: "the SERVER owns the AE invoice counter"): a till asks for a block of numbers of the issuer's ONE invoice
 *           counter (books_counter series 'invoice', fiscal_year '-', the S1 counter of api #990), prints from it offline, and the day close reports what became of every number.
 *           One counter, never a second: a block is reserved ONLY by books-store nextNo(count = N), in the same atomic statement a further invoice uses for one number.
 * CALLED BY routes/till.js (POST /invoice-lease, POST /invoice-lease/close, GET /invoice-lease/report)
 * FLOW      leaseFor: gate by the pack → under the SAME series lock a further invoice takes (price-note.underSeriesLock('invoice', issuer)) → reuse an open block, or reserve a new one
 *           reportFor: leases + the invoice numbers the shop recorded → per lease: recorded · unused (with its reason) · GAP · ahead; plus every till number OUTSIDE every lease
 *           closeLease: a reason for numbers that were not printed (void · unused · retired), then the lease is closed
 * CARD      09-counter/ae-invoice-lease (docs/process/…: PM/ACC-192-PLAN-2026-11-07.md §10-§13)
 * LAW       UAE Executive Regulation (Cabinet Decision 52/2017) Art. 59(1)(d): "A sequential Tax Invoice number or a unique number which enables identification of the Tax Invoice and the order of the
 *           Tax Invoice in any sequence of invoices" (FTA ER consolidation, read by cb-country 2026-11-09: docs/country/AE-INVOICE-NUMBERING-2026-11-09.md). The law is silent on gaps, voids and on one
 *           series per till; uniqueness is the test. So: a number is handed out ONCE, EVER (an expired lease is never re-leased), and a hole is REPORTED, never filled and never hidden. This is
 *           Athi's design (option B), carried as his decision, not as a claim that the law demands it.
 * DECIDED   (critic 2026-11-09, plan §12) a printed number OUTSIDE its lease is RECORDED and REPORTED, never refused: the paper is already in the customer's hand (routes/chits.js says the same
 *           of every till number). A duplicate of a recorded number is the existing till-collision check's (409 on a different till, a replay on the same), not this file's.
 * COUNTRY   the gate is the seller pack's own statement that its further document is an invoice (price-note.documentFor === 'invoice'), the reading S1 already uses for the unprefixed counter number;
 *           an explicit pack flag (numbering.server) belongs in engines reg-ae.js: queued in the report, never edited here.
 */
'use strict';

const books = require('./books-store');
const priceNote = require('./price-note');
const log = require('./logger');

/** the one counter: series and fiscal-year key are exactly price-note's INVOICE_SERIES and '-' (a real fiscal year would fork the series into a second row) */
const SERIES = 'invoice';
const FISCAL_KEY = '-';
const DEFAULT_BLOCK = 50;
const MAX_BLOCK = 200;
/** a till asks for its next block when this share of the held one is left (Athi 8 Nov: refill at 20 percent) */
const REFILL_SHARE = 0.2;
const LEASE_DAYS = 7;
/** a till holds at most two open blocks (the one it is using and the next): a retired till cannot strand thousands of numbers */
const MAX_OPEN_PER_TILL = 2;
const REASONS = ['void', 'unused', 'retired'];
const OUTSIDE_LIMIT = 100;
const REPORT_LEASE_LIMIT = 20;
const REPORT_LEASE_MAX = 100;
const MAX_DIGITS = 15;

const refused = (status, code, message) => Object.assign(new Error(message), { status, code, refused: true });

const NOT_FOR_COUNTRY_WORDS = 'This shop’s invoice numbers are not issued by blocks, so no block was given.';
const WANT_WORDS = 'Ask for a whole number of invoice numbers from 1 to ' + MAX_BLOCK + ', or leave it out for ' + DEFAULT_BLOCK + '.';
const TILL_WORDS = 'That counter is not one of this shop’s counters, so no block was given.';
const BUSY_WORDS = 'The invoice numbers are busy for a moment. Try again; nothing was taken.';
const NOT_READY_WORDS = 'Invoice number blocks are not switched on for this shop yet.';

/** numberOfPrinted(text) → the integer of a number printed on a leased invoice ("0043" · "43" → 43), or null: a prefixed number (C1/0043), a letter, 0, a sign or more than 15 digits is not a leased number */
function numberOfPrinted(text) {
  const printed = String(text == null ? '' : text).trim();
  if (!new RegExp('^[0-9]{1,' + MAX_DIGITS + '}$').test(printed)) return null;
  const value = Number(printed);
  return value >= 1 ? value : null;
}

/** sizeOf(want) → { size } or { refused } : absent = the default block; otherwise a whole number 1..MAX_BLOCK, never clamped silently (a want of 5000 is refused, not shrunk) */
function sizeOf(want) {
  if (want == null || want === '') return { size: DEFAULT_BLOCK };
  const size = Number(want);
  if (typeof want === 'boolean' || !Number.isInteger(size) || size < 1 || size > MAX_BLOCK) return { refused: refused(400, 'LEASE_WANT_INVALID', WANT_WORDS) };
  return { size };
}

/** sizeOfLease(lease) → how many numbers the block holds */
const sizeOfLease = (lease) => Number(lease.last_no) - Number(lease.first_no) + 1;

/** refillDue(lease, remaining) → true when the till says it has 20 percent or less of this block left (remaining unknown = not due: the till keeps what it holds) */
function refillDue(lease, remaining) {
  if (remaining == null || remaining === '') return false;
  const left = Number(remaining);
  return Number.isInteger(left) && left >= 0 && left <= Math.floor(sizeOfLease(lease) * REFILL_SHARE);
}

/** the shape a lease takes in an answer */
function viewOf(lease, reused) {
  return { lease_id: lease.lease_id, till_id: lease.till_id, first_no: Number(lease.first_no), last_no: Number(lease.last_no), size: sizeOfLease(lease), expires_at: lease.expires_at, reused: !!reused };
}

/** gate: does this seller's pack number its invoices from the server's one counter? (documentFor throws a refusal for an unknown or missing country: that is "no" here too) */
function leasesFor(country) {
  try {
    return priceNote.documentFor(country) === 'invoice';
  } catch (e) {
    if (e && e.refused) return false;
    throw e;
  }
}

/** the open blocks of one till (not closed, not expired), newest first */
async function openLeases(db, issuer, tillId, now) {
  const found = await db.query(
    'SELECT lease_id, till_id, first_no, last_no, expires_at FROM till_invoice_lease WHERE entity_id = $1 AND till_id = $2 AND closed_at IS NULL AND expires_at > $3 ORDER BY first_no DESC LIMIT 5',
    [issuer, tillId, now]
  );
  return found.rows;
}

/** reserve one new block from the counter and record who holds it (the counter moves first; the row follows in the same transaction) */
async function reserveBlock(db, issuer, tillId, size, now) {
  const first = await books.nextNo(db, issuer, SERIES, FISCAL_KEY, size);
  const expires = new Date(new Date(now).getTime() + LEASE_DAYS * 86400000).toISOString();
  const inserted = await db.query(
    'INSERT INTO till_invoice_lease (entity_id, till_id, first_no, last_no, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING lease_id, till_id, first_no, last_no, expires_at',
    [issuer, tillId, first, first + size - 1, expires]
  );
  return inserted.rows[0];
}

/**
 * leaseInside(db, issuer, input, now) — the decision, inside the series lock and one transaction:
 * a till with an open block and more than 20 percent left (or already holding two) is answered with its newest block (nothing taken); otherwise a new block is reserved.
 */
async function leaseInside(db, issuer, input, now) {
  const open = await openLeases(db, issuer, input.till_id, now);
  const newest = open[0];
  if (newest && (open.length >= MAX_OPEN_PER_TILL || !refillDue(newest, input.remaining))) return viewOf(newest, true);
  return viewOf(await reserveBlock(db, issuer, input.till_id, input.size, now), false);
}

/**
 * leaseFor(issuer, country, input) — the lease route's one call: { till_id, want?, remaining? } → the block (reused or new).
 * Refuses in words: LEASE_NOT_FOR_COUNTRY (409) · LEASE_WANT_INVALID (400) · LEASE_TILL_UNKNOWN (404, the till is not a counter of this shop) · LEASE_COUNTER_BUSY (503, retry, nothing taken).
 * `knownTill(tillId)` is the caller's read of the counter register (async → boolean), so this file reads no register of its own.
 */
async function leaseFor(issuer, country, input, deps) {
  if (!leasesFor(country)) throw refused(409, 'LEASE_NOT_FOR_COUNTRY', NOT_FOR_COUNTRY_WORDS);
  const sized = sizeOf(input.want);
  if (sized.refused) throw sized.refused;
  if (!(await deps.knownTill(input.till_id))) throw refused(404, 'LEASE_TILL_UNKNOWN', TILL_WORDS);
  const now = (deps.now || (() => new Date()))().toISOString();
  try {
    return await priceNote.underSeriesLock(SERIES, issuer, () => deps.withEntity(issuer, (db) => leaseInside(db, issuer, { till_id: input.till_id, size: sized.size, remaining: input.remaining }, now)));
  } catch (e) {
    if (e && e.refused) throw e;
    if (e && /lock|deadlock|serializ/i.test(String(e.code || e.message || ''))) {
      log.fellBack('invoice-lease: the counter was busy; nothing was taken', e);
      throw refused(503, 'LEASE_COUNTER_BUSY', BUSY_WORDS);
    }
    throw e;
  }
}

/** shopFactsOf(query, issuer) → { country, tills } in ONE read of the shop's identity row: its country (lib/profile countryOf, the one reader) and its counter ids upper-cased (the register in policy_flags.counters) */
async function shopFactsOf(query, issuer) {
  const found = await query("SELECT country, gstn, policy_flags->'counters' AS counters FROM identities WHERE identity_id = $1", [issuer]);
  const row = found.rows[0] || {};
  return { country: require('./profile').countryOf({ country: row.country, gstin: row.gstn }) || null, tills: Object.keys(row.counters || {}).map((id) => String(id).toUpperCase()) };
}

/* ── the day close: what became of every number ──────────────────────────────────────────────────────────────────────────── */

/** the invoice numbers the shop recorded from its tills inside [low, high]: { number, till_id } (digits-only till numbers: a prefixed interim number is a different series and is not read) */
const RECORDED_SQL = `SELECT n AS number, till_id FROM (
    SELECT CASE WHEN business_json->>'client_ref' ~ '^[0-9]{1,15}$' THEN (business_json->>'client_ref')::bigint END AS n, business_json->'till'->>'id' AS till_id
      FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json->'till'->>'id' IS NOT NULL) printed
  WHERE n BETWEEN $2 AND $3`;

/** every recorded till number that lies in NO lease of the shop (never refused, always listed), the first OUTSIDE_LIMIT + 1 so the caller can say "and more" */
const OUTSIDE_SQL = `SELECT n AS number, till_id FROM (
    SELECT CASE WHEN business_json->>'client_ref' ~ '^[0-9]{1,15}$' THEN (business_json->>'client_ref')::bigint END AS n, business_json->'till'->>'id' AS till_id
      FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json->'till'->>'id' IS NOT NULL) printed
  WHERE n >= 1 AND NOT EXISTS (SELECT 1 FROM till_invoice_lease l WHERE l.entity_id = $1 AND printed.n BETWEEN l.first_no AND l.last_no)
  ORDER BY n LIMIT ${OUTSIDE_LIMIT + 1}`;

/** how a lease stands at `now`: closed · expired · open */
const stateOf = (lease, now) => (lease.closed_at ? 'closed' : new Date(lease.expires_at) <= new Date(now) ? 'expired' : 'open');

/**
 * accountFor(lease, recorded, now) — one lease's numbers, hand-checkable:
 *   recorded — a number with an invoice · unused — no invoice and either a reason or the unprinted tail of a block that is over (reason 'expired', 'closed' or the stated one)
 *   gaps — no invoice, no reason, BELOW the highest recorded number (never filled) · ahead — an open block's numbers above the highest recorded (still the till's to print)
 */
function accountFor(lease, recordedNumbers, now) {
  const state = stateOf(lease, now);
  const reasons = new Map((lease.unused_json || []).map((row) => [Number(row.no), row.reason]));
  const printed = new Set(recordedNumbers);
  const highest = recordedNumbers.length ? Math.max.apply(null, recordedNumbers) : Number(lease.first_no) - 1;
  const account = { recorded: [], unused: [], gaps: [], ahead: null };
  for (let number = Number(lease.first_no); number <= Number(lease.last_no); number++) {
    if (printed.has(number)) account.recorded.push(number);
    else if (reasons.has(number)) account.unused.push({ no: number, reason: reasons.get(number) });
    else if (number < highest) account.gaps.push(number);
    else if (state === 'open') account.ahead = account.ahead ? { from: account.ahead.from, to: number } : { from: number, to: number };
    else account.unused.push({ no: number, reason: state === 'closed' ? 'unused' : 'expired' });
  }
  return account;
}

/** a clean page request: { limit, page } with the server's max (DISCIPLINES: every list paginated) */
function pageOf(query) {
  const limit = Math.min(REPORT_LEASE_MAX, Math.max(1, Math.floor(Number(query && query.limit)) || REPORT_LEASE_LIMIT));
  const page = Math.max(1, Math.floor(Number(query && query.page)) || 1);
  return { limit, page };
}

/** the leases of the report, newest first: the page and the total */
async function leasePage(db, issuer, tillId, paging) {
  const found = await db.query(
    `SELECT lease_id, till_id, first_no, last_no, leased_at, expires_at, closed_at, unused_json, count(*) OVER () AS total
       FROM till_invoice_lease WHERE entity_id = $1 AND ($2::text IS NULL OR till_id = $2) ORDER BY first_no DESC LIMIT $3 OFFSET $4`,
    [issuer, tillId || null, paging.limit, (paging.page - 1) * paging.limit]
  );
  return { rows: found.rows, total: found.rows.length ? Number(found.rows[0].total) : 0 };
}

/** reportFor(db, issuer, { till_id?, limit?, page? }, now) → { leases:[{…lease, state, recorded, unused, gaps, ahead}], outside:{numbers, more}, total, page, limit } */
async function reportFor(db, issuer, query, now) {
  const paging = pageOf(query);
  const { rows, total } = await leasePage(db, issuer, query && query.till_id, paging);
  const low = rows.length ? Math.min.apply(null, rows.map((row) => Number(row.first_no))) : 1;
  const high = rows.length ? Math.max.apply(null, rows.map((row) => Number(row.last_no))) : 0;
  const printed = rows.length ? (await db.query(RECORDED_SQL, [issuer, low, high])).rows : [];
  const leases = rows.map((row) => {
    const mine = printed.map((printedRow) => Number(printedRow.number)).filter((number) => number >= Number(row.first_no) && number <= Number(row.last_no));
    return Object.assign(viewOf(row, false), { state: stateOf(row, now), closed_at: row.closed_at || null }, accountFor(row, mine, now));
  });
  const outsideRows = (await db.query(OUTSIDE_SQL, [issuer])).rows;
  return { leases, outside: { numbers: outsideRows.slice(0, OUTSIDE_LIMIT).map((row) => ({ no: Number(row.number), till_id: row.till_id })), more: outsideRows.length > OUTSIDE_LIMIT }, total, page: paging.page, limit: paging.limit };
}

/** the reasons a close carries, checked: [{ no, reason }] — each number inside the lease, each reason one of REASONS; a refusal names the first fault */
function reasonsChecked(lease, unused) {
  const given = Array.isArray(unused) ? unused : [];
  return given.map((row) => {
    const number = Number(row && row.no);
    if (!Number.isInteger(number) || number < Number(lease.first_no) || number > Number(lease.last_no)) throw refused(409, 'LEASE_NUMBER_NOT_IN_LEASE', 'A number named as unused is not in this block.');
    if (!REASONS.includes(row.reason)) throw refused(400, 'LEASE_REASON_INVALID', 'The reason must be one of: ' + REASONS.join(', ') + '.');
    return { no: number, reason: row.reason };
  });
}

/**
 * closeLease(db, issuer, input, now) — the till (or the owner) says why some numbers were not printed, and closes the block. A number that carries a recorded invoice can never be called unused
 * (LEASE_NUMBER_WAS_USED, 409). Saying it twice with the same reasons changes nothing; a later reason for the same number replaces the earlier one.
 */
async function closeLease(db, issuer, input, now) {
  const found = await db.query('SELECT lease_id, till_id, first_no, last_no, expires_at, closed_at, unused_json FROM till_invoice_lease WHERE entity_id = $1 AND lease_id = $2 FOR UPDATE', [issuer, input.lease_id]);
  const lease = found.rows[0];
  if (!lease) throw refused(404, 'LEASE_NOT_FOUND', 'That block is not one of this shop’s.');
  const reasons = reasonsChecked(lease, input.unused);
  const used = reasons.length ? (await db.query(RECORDED_SQL, [issuer, Math.min.apply(null, reasons.map((row) => row.no)), Math.max.apply(null, reasons.map((row) => row.no))])).rows.map((row) => Number(row.number)) : [];
  const clash = reasons.find((row) => used.includes(row.no));
  if (clash) throw refused(409, 'LEASE_NUMBER_WAS_USED', 'Number ' + clash.no + ' is on an invoice; it cannot be called unused.');
  const merged = new Map((lease.unused_json || []).map((row) => [Number(row.no), row.reason]));
  reasons.forEach((row) => merged.set(row.no, row.reason));
  const unusedJson = Array.from(merged, ([no, reason]) => ({ no, reason })).sort((left, right) => left.no - right.no);
  await db.query('UPDATE till_invoice_lease SET unused_json = $3::jsonb, closed_at = COALESCE(closed_at, $4) WHERE entity_id = $1 AND lease_id = $2', [issuer, input.lease_id, JSON.stringify(unusedJson), now]);
  return { lease_id: lease.lease_id, closed: true, unused: unusedJson };
}

module.exports = { SERIES, FISCAL_KEY, DEFAULT_BLOCK, MAX_BLOCK, REFILL_SHARE, LEASE_DAYS, MAX_OPEN_PER_TILL, REASONS, NOT_READY_WORDS, numberOfPrinted, shopFactsOf, sizeOf, refillDue, leasesFor, leaseFor, reportFor, closeLease, accountFor, stateOf };
