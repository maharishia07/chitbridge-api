'use strict';
/**
 * lib/books-movein.js — the move-in doors' shared reads: what the body says (kind, source, side, date, file), where the books come from, and the plan for a confirmed file.
 * OWNS      moveInBody · moveInOrigin · moveInPlan (no route, no state)
 * CALLED BY routes/books.js (POST /move-in/preflight, /preview, /import)
 * FLOW      moveInBody(req) -> moveInLib.readFile + the owner's choices -> moveInPlan(req, db): the world read once, then the pure dry run (lib/move-in)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
const moveInLib = require('./move-in');
const booksLib = require('./books');
const auth = require('../middleware/auth');
const CLOCK = require('./shop-clock');
const { fyStart } = require('./books-daybook');

const ctx = (req) => auth.entityOf(req);
const dateQ = (value, fallback) => require('./books-period').dateGiven(value, null, fallback);
const curOf = (req) => booksLib.curOf(req.books); /* CX2 (A3): the setting's money, else its pack's */
const today = (req) => CLOCK.today(req && req.books); /* the shop's day */

/** what every move-in door reads from the body: the file (csv | xlsx + sheet / header_row), which export (kind), which system (source), the side, the move date,
 *  ⭐ W1.1b the country the OWNER states the file is from (source_country, two letters — checked against the shop's by lib/move-in-gate, kept in the proof)
 *  and W1.4 their company id when they know it (source_company: QBO realm · Xero organisation · Zoho organization) */
function moveInBody(req) {
  const body = req.body || {};
  const kind = moveInLib.kindOf(body.kind),
    source = moveInLib.sourceOf(body.source);
  const as_at = dateQ(body.as_at, null) || fyStart(req, today(req));
  const side =
    kind === 'contacts'
      ? body.side === 'supplier'
        ? 'supplier'
        : 'customer'
      : kind === 'open_bills'
        ? body.side === 'payable' || body.side === 'supplier'
          ? 'payable'
          : 'receivable'
        : null;
  return Object.assign(
    { kind, source, side, as_at, parsed: moveInLib.readFile(body), decisions: body.decisions, client_ref: require('./books-input').clientRef(body.client_ref) },
    moveInOrigin(body)
  );
}
/** where the owner says the books come from: the country as given (lib/move-in-gate judges it) and their company id, each cut to size or null */
function moveInOrigin(body) {
  const sized = (value, size) => (value == null ? null : String(value).slice(0, size));
  return { source_country: sized(body.source_country, 60), source_company: sized(body.source_company, 80) };
}

/** the plan for a confirmed file: the world read once (chart · parties · tax ids · phones · products), then the pure dry run */
async function moveInPlan(req, db) {
  const e = ctx(req),
    moveInRequest = moveInBody(req);
  /* ⭐ ACC-329: the dry run refuses a future date as the import does (a trial balance or open bills post as an opening; lib/books openingDateGate) */
  if (moveInRequest.kind === 'trial_balance' || moveInRequest.kind === 'open_bills') {
    booksLib.openingDateGate(req.books, moveInRequest.as_at);
    await booksLib.openingMonthGate(db, e, req.books, moveInRequest.as_at); /* AP-F-05: a locked month takes no opening either */
  }
  const rows = moveInLib.cells(moveInRequest.kind, moveInRequest.parsed, moveInRequest.decisions);
  const world = await moveInLib.world(db, e, moveInRequest.kind, req.books, { source: moveInRequest.source, side: moveInRequest.side, rows });
  const plan = moveInLib.plan(moveInRequest.kind, {
    source: moveInRequest.source,
    side: moveInRequest.side,
    rows,
    world: world,
    currency: curOf(req),
    as_at: moveInRequest.as_at,
    country: req.books && req.books.country,
    source_country: moveInRequest.source_country,
    country_how: 'stated',
    source_company: moveInRequest.source_company
  });
  return { m: moveInRequest, pl: plan, w: world };
}

module.exports = { moveInBody, moveInPlan };
