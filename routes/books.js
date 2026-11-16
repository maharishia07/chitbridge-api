// @stage built
// OWNS  /api/books: the ledger's reads and the period-end writes, every refusal a code + a sentence (fail), never a 500 of prose.
// CALLED BY server.js (mounted at /api/books), CB Accounts and CB Finance.
// FLOW  auth → noKey → owner → (the money doors: onceOnly, FIN-63) → on → lib/books-* → the answer; a refusal → fail(res, e)
// CARD 14-accounting/ledger-accounts-day-book-entries-reverse
// @stage-note [BOOKS v2] /api/books — the ledger's reads (day book, ledgers, statement, dues, trial balance, P&L, balance
// @stage-note sheet) and its few writes (payments, manual entries, reversals, month locks, opening, packs). 404 while off.
'use strict';
const { waiting } = require('../lib/not-migrated');
const CLOCK = require('../lib/shop-clock');
const { NOT_A_UUID_WORDS } = require('../lib/knownerr');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { refusalOf, SAID, operationFor, pathsOf } = require('../lib/books-contract'); // the contract (each route's operation) and the ledger's refusal mapper
const logger = require('../lib/logger');
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
const router = express.Router(); router.use(require('../middleware/books-grant')); /* ACC-176: a request that names a member's books (X-Books-For) is read-only for a live grant; no header, no effect */
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const B = require('../lib/books'), N = require('../lib/books-statement-notes');
const E = require('../lib/books-engines');
const S = require('../lib/books-store'), LiveBill = require('../lib/books-live-bill');

const Evidence = require('../lib/books-evidence'); /* the source document and the files held on it, per row (one read per page) */
const Needs = require('../lib/books-needs'); /* who needs you, and why: the one list of reasons (W15-114) */
const OtherSide = require('../lib/books-other-side'); /* W15-89b: a ledger line's other side (the entry's other ledger, and the party it names) */
const { marksIn } = require('../lib/mark-embed'); /* MARK & QUERY: the marks of the entries a list serves, in the list's own transaction */
const ctx = (req) => auth.entityOf(req);
/** the schema check of one route (its own operation in lib/books-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation)] : [];
}
const { isOwner, roleGate } = require('../lib/owner'); /* one owner test — the folder inventory's switch reads it too */
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
/** an adviser firm's person acting under a grant: { grant_id, name, firm } for the record's stamp (b871); null for the owner's own request */
const actingOf = (req) => (req.acting_for_grant && req.identity && req.identity.acting_preset === 'adviser' ? { grant_id: req.acting_for_grant, name: req.identity.display_name, firm: req.acting_firm_name || null } : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** API-25: an id in the query or body that is no uuid names no row: the same 404 NOT_FOUND the router guard (lib/id-guard) gives an address id */
const notAnId = (req, res) => problem(req, res, { status: 404, code: 'NOT_FOUND', detail: NOT_A_UUID_WORDS, legacy: { error: 'Not found', message: NOT_A_UUID_WORDS } });
/* ⚠️ WX-P2P-02 (2026-10-13, the real stack): "today" is the SHOP's day (books-hooks.dayOf — the one calendar, M210), not the UTC date.
   /dues filtered its items by the shop's day of created_at but took asOf from the UTC clock: a bill recorded after midnight IST
   (18:30–24:00 UTC) was ahead of asOf and vanished from Payables / Receivables until the next UTC day — "You owe nobody" beside
   a supplier chip saying you owe lakhs. One day, from one helper, everywhere this file says today. */
const today = (req) => CLOCK.today(req && req.books); /* the shop's day; dayOf of a moment is never null */
/* ACC-274: a date the caller GIVES must be a real day or it is a 400 DATE_INVALID (refusalOf names the field); absent → the fallback. The one reader is books-period.dateGiven (dateOf is its body twin). */
const dateQ = (value, fallback) => require('../lib/books-period').dateGiven(value, null, fallback);
/* minor units in; an amount in major units goes through the api's ONE major → minor (books-cashflow.toMinor: money.round, then the
   currency's own decimals). ⚠️ ACC-179: it was × 100 for every currency — a JPY amount came out 100× too big. */
const cashflow = () => require('../lib/books-cashflow');
/** the amount of a payment or write-off as minor units, by the ONE strict reader (books-period.amountOf: a whole JSON number); throws the plain question "How much?" (a 400) when it is not one */
const minorOf = (input, currency) => require('../lib/books-period').amountOf(input, 'amount', currency, { ask: 'How much?', zero: true });
/** minorOf for a caller that answers the question itself: null when the amount is not a whole number (the payment door asks "How much?") */
function minorAsked(input, currency) {
  try {
    return minorOf(input, currency);
  } catch (err) {
    if (err.code === 'BOOKS_BAD_REQUEST') return null;
    throw err;
  }
}
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

/**
 * WHAT A REFUSAL OF THE LEDGER MEANS (the mapping itself is lib/books-contract.js refusalOf, first match wins; each answer keeps the {error, message} keys it always had):
 *  - PERIOD_LOCKED · YEAR_CLOSED · SUSPENSE_NOT_NIL     409 WITH the code the web's friendlyErr maps (and its exact sentence): a typed date in a locked month.
 *  - BOOKS_NOT_FOUND                                    404 "Not found" with the sentence.
 *  - FX_RATE_MISSING                                    422 WITH the code, so a screen offers "Add rate" beside the sentence (FX1).
 *  - NO_COUNTRY_PACK · NO_COUNTRY · COUNTRY_SETUP_PENDING · NO_MONEY    422 WITH the code and sentence, never the quiet 404 (CS1: the country gate).
 *  - RETURN_FROM_RAIL                                   422 WITH the code: an Indian shop asking GET /returns reads its GSTR from the rail (BAS1).
 *  - BOOKS_ENGINE · BOOKS_NOT_MIGRATED                  503: missing tables are the server's state, and this is read BEFORE the 422 ("not migrated" is thrown as a refusal too).
 *  - BOOKS_BAD_REQUEST                                  400: a question the owner can answer (a missing field, a date that is not a date).
 *  - STOCK_* (refused)                                  422 WITH the code and the products, so a screen offers Count / Enter by hand (T1-INV).
 *  - any other refusal                                  422 (with its own code when it carries one), or the status 409 / 422 it names.
 *  - a terms sentence (e.say, 400/404) · 23505          400/404 in the sentence the owner can fix · 409 "That is already recorded."
 *  - 42501 / insert-only                                503 BOOKS_NOT_MIGRATED in words (M30-2: the books are insert-only, b273; b295 not run) — never a bare 500.
 *  - anything else                                      500 that says nothing of its cause; the real error is logged with the request id (silence is the bug).
 */
/** W2-BOOKS: a refusal that carries its own code (PERIOD_NOT_ENDED · RCM_NETTING_NOT_BUILT · NOT_FOR_COUNTRY …) says it — a screen branches on the code, never on the prose.
 *  lib/books-contract.js refusalOf maps every typed refusal of the ledger to its status, code and the old {error, message} keys; this wrapper is the door routes/chits.js (drift D1) uses. */
function fail(res, e) {
  return problem(res.req, res, refusalOf(e, res.req));
}
/** one refusal in the ledger's words: the Problem body with the old {error, message} keys beside it (API-STANDARD S2: the Ledger screen reads those keys) */
function refuse(req, res, status, code, error, message) {
  return problem(req, res, { status, code, detail: message === undefined ? error : message, legacy: message === undefined ? { error } : { error, message } });
}
/** the payment quote's own refusal: its status and words ride on q.refuse (a currency that is not the ledger's is a 422, the rest are questions) */
function refuseQuote(req, res, refusal) {
  return refuse(req, res, refusal.status, refusal.status === 422 ? 'CURRENCY_NOT_THE_LEDGERS' : 'BOOKS_BAD_REQUEST', refusal.words, refusal.words);
}
/** a key-bearer (a counter, a TV, a connector) has no business in the ledger — the second fence behind KEY_ROUTES */
function noKey(req, res, next) {
  if (req.api_key) return problem(req, res, { status: 403, code: 'SIGN_IN_FOR_LEDGER', detail: SAID.signIn, legacy: { error: SAID.signIn, message: SAID.signIn } });
  next();
}
function owner(req, res, next) {
  if (!isOwner(req) && !(req.method === 'GET' && req.identity && req.identity.acting_preset === 'adviser') && !req.acting_bank_write) /* l16: the bank page's writes under adviser_posts (middleware/books-grant, from the live grant row) */ return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: SAID.ownerOnly, legacy: { error: SAID.ownerOnly, message: SAID.ownerOnly } }); /* ACC-176b: the owner's READS are the adviser's too (acting_preset comes from the live grant row only; the grant front lets an adviser GET through only on its read list) */
  next();
}
/** ⚠️ WX-P2P-15 (2026-10-13, the real stack): a VIEW-ONLY co-assist recorded a payment from Payables › Pay — the writes a co-assist may reach
 *  (payments · cheque steps · disputes) had no level gate, only the owner-only ones did. The rail engine's ladder decides (lib/rail.byLevel:
 *  viewer → read_only, commenter → comment_only, editor → allowed), in its own sentence — the same word PATCH /payments/:id already answers. */
function editor(req, res, next) {
  const text = require('../lib/rail').byLevel(levelOf(req), 'amend');
  if (text) {
    const say = require('../lib/rail').say(text);
    return problem(req, res, { status: 403, code: text.toUpperCase(), detail: say, legacy: { error: say, message: say, why: text } });
  }
  next();
}
/**
 * the gate: the shop's ledger must be on, else a quiet 404.
 * ⭐ CS1 (2026-10-12): BEFORE the switch, the COUNTRY — a shop whose country has no regulation pack (or no country, or the setup still to
 * do) is refused with the sentence, 422 with a code, on every books route, on or off; never India's rules by default (DECISIONS
 * 2026-10-03). lib/country-setup.gate: one cached read per shop per minute, inside the same withEntity.
 */
const CS = require('../lib/country-setup');
/** the gate middleware: the country first (422 with its sentence), then the ledger switch (404 when off); sets req.books and req.booksCountry */
async function on(req, res, next) {
  try {
    const e = ctx(req);
    let st = null;
    const s = await withEntity(e, async (h) => {
      st = await CS.gate(h, e);
      return B.settingOf(h, e);
    });
    if (!s || !s.enabled) return problem(req, res, { status: 404, code: 'LEDGER_OFF', detail: 'This shop has not switched the ledger on.', legacy: { error: SAID.notFound } });
    req.books = s;
    req.booksCountry = st || null;
    next();
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
}
/**
 * ⭐ FIN-63 (5 Nov): A MONEY DOOR TAKES ONE KEY PER ATTEMPT. `client_ref` stops a second tap on POST /payments, but confirm had no replay
 * guard at all: a retry after a lost answer settled the bills twice from the same receipt. The four writes the web keys (web #447
 * idem:'attempt') now REQUIRE an Idempotency-Key — POST /payments · PATCH /payments/:id · POST /payments/:id/confirm · POST /gst/pay —
 * through the ONE gate (middleware/idempotency requireKey, the bearer form): no key → 422 IDEMPOTENCY_KEY_REQUIRED in words, BEFORE
 * the ledger's own gates; the same key again → the first answer, marked X-Idempotent-Replay. propose is a read and is not keyed.
 */
const onceOnly = require('../middleware/idempotency').requireKey();
const curOf = (req) => B.curOf(req.books); /* CX2 (A3): the setting's money, else its pack's — never 'INR' typed */

/* ── the switch ─────────────────────────────────────────────────────────────────────────────────────────────── */
// @does Nothing in -> we read whether the shop's books are switched on and whether its country allows them -> the switch state, walk-in grain and country verdict (owner only).
router.get('/status', auth, owner, ...checked('GET /status'), async (req, res) => {
  try {
    const e = ctx(req);
    /* ⭐ CS1: `country` says whether the books MAY open here — { books, code, why, required, country } — so the switch is greyed WITH its sentence */
    const r = await withEntity(e, async (h) => ({ s: await B.settingOf(h, e), country: await CS.status(h, e) }));
    const s = r.s;
    res.json({ migrated: s !== null, enabled: !!(s && s.enabled), walkin_grain: s ? s.walkin_grain : null, engines: E.status(), country: r.country });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Optional walk-in grain in -> we check the country allows books, switch the shop's books on and lay the chart of accounts -> the opened setting (owner only).
router.post('/enable', auth, owner, ...checked('POST /enable'), async (req, res) => {
  try {
    const b = req.body || {};
    /* ⭐ CS1: the switch itself is refused for a pack-less country — the server decides, in the same sentence the screen shows */
    await withEntity(ctx(req), (h) => CS.gate(h, ctx(req)));
    const grain = ['day', 'shift', 'bill'].indexOf(b.walkin_grain) >= 0 ? b.walkin_grain : undefined;
    const r = await B.enable(null, ctx(req), { by: byOf(req), walkin_grain: grain });
    require('../lib/books-hooks').forget(ctx(req));
    res.json({ ok: r.ok, accounts_added: r.accounts_added, fiscal_year: r.fiscal_year, parties_numbered: r.parties_numbered });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Walk-in grain and on or off in -> we save the shop's books setting and log the change -> the saved setting (owner only).
router.post('/setting', auth, owner, on, ...checked('POST /setting'), async (req, res) => {
  try {
    const e = ctx(req),
      b = req.body || {},
      s = req.books;
    const grain = ['day', 'shift', 'bill'].indexOf(b.walkin_grain) >= 0 ? b.walkin_grain : s.walkin_grain;
    const enabled = b.enabled !== false;
    await withEntity(e, async (h) => {
      await S.saveSetting(h, e, Object.assign({}, s, { enabled, walkin_grain: grain }));
      if (grain !== s.walkin_grain)
        await S.logChange(h, e, { by: byOf(req), table_name: 'books_setting', row_id: e, field: 'walkin_grain', old: s.walkin_grain, new: grain });
      if (!enabled) await S.logChange(h, e, { by: byOf(req), table_name: 'books_setting', row_id: e, field: 'enabled', old: 'true', new: 'false' });
    });
    require('../lib/books-hooks').forget(e);
    res.json({ ok: true, enabled, walkin_grain: grain });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * ⭐ CB FINANCE · TERMS (F2) — GET /terms?party_id&side → { terms_migrated, may_set, why_not, default, party: { party_id, side, own, effective } | null, events }
 * The shop's default terms and (with party_id) that party's own override + what applies (lib/finance-terms.resolve: its own value, else the shop's).
 * Readable by any signed-in login of a shop with the ledger on (the CRM record, Accounts, the counter read it); `may_set` is the SERVER's answer for THIS login.
 * Before b298 runs: terms_migrated false, the party's own days/limit still answered. POST /terms (owner) sets — { party_id?, side?, credit_days,
 * credit_limit_minor, interest: { on, rate_pct, grace_days }|null, early: { pct, within_days }|null } — one change event per changed key; 503 TERMS_NOT_MIGRATED before b298.
 */
// @does Optional party and side in -> we read the credit limit, interest and early-pay terms of one customer or supplier, else the shop default -> those terms.
router.get('/terms', auth, noKey, on, ...checked('GET /terms'), async (req, res) => {
  try {
    const e = ctx(req),
      T = require('../lib/finance-terms'),
      pid = req.query.party_id ? String(req.query.party_id) : null,
      side = req.query.side === 'supplier' ? 'supplier' : 'customer';
    if (pid && !UUID.test(pid)) return notAnId(req, res); /* FIN-86: an id that is not an id names no party: the shared 404, never the database */
    const mig = await T.migrated(),
      may = isOwner(req);
    const out = await withEntity(e, async (h) => {
      const dflt = mig ? await T.shopTerms(h, e) : {};
      const events = mig ? await (pid ? T.partyEvents(h, e, pid) : T.shopEvents(h, e)) : [];
      let party = null;
      if (pid) {
        const row = await T.partyRow(h, e, pid, side, mig);
        if (row)
          party = {
            party_id: pid,
            side,
            own: {
              credit_days: row.credit_days,
              credit_limit_minor: row.credit_limit_minor == null ? null : Number(row.credit_limit_minor),
              interest: (row.terms || {}).interest || null,
              early: (row.terms || {}).early || null
            },
            effective: T.resolve(dflt, row)
          };
      }
      return { dflt, party, events };
    });
    res.json({
      terms_migrated: mig,
      may_set: may,
      why_not: may ? null : 'Only the owner may set terms.',
      default: out.dflt,
      party: out.party,
      events: out.events
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A party or the shop default with credit limit, interest and early-pay terms in -> we save the terms and log each changed key -> the saved terms (owner only).
router.post('/terms', auth, owner, on, ...checked('POST /terms'), async (req, res) => {
  try {
    const e = ctx(req),
      T = require('../lib/finance-terms'),
      b = req.body || {},
      pid = b.party_id ? String(b.party_id) : null,
      side = b.side === 'supplier' ? 'supplier' : 'customer';
    if (pid && !UUID.test(pid)) return notAnId(req, res); /* FIN-86 */
    if (!(await T.migrated()))
      return problem(req, res, { status: 503, code: 'TERMS_NOT_MIGRATED', detail: SAID.termsNotMigrated, legacy: { error: SAID.termsNotMigrated, message: SAID.termsNotMigrated } });
    const out = await withEntity(e, (h) => (pid ? T.saveParty(h, e, pid, side, b, byOf(req)) : T.saveShop(h, e, b, byOf(req))));
    res.json({ ok: true, terms: out });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * GET /health → { enabled, currency, country, walkin_grain, last_check, engines, year: { fiscal_year, from, start_month }, waiting: [{ id, chit_id, ref, reason, tries, since, job, todo, name, candidates }],
 *               total, page, limit, todo: { accept, add_supplier, record } }
 * — the web's probe (404 = off) and the to-do list: `waiting` is every post that failed or was parked, least-tried first,
 * each with the `reason` it could not post (lib/books-hooks waitingRow; POST /outbox/retry tries them again).
 */
// @does Nothing in -> we read the health of the books: postings still waiting to reach the ledger, the to-do counts and the year's checks -> one health summary.
router.get('/health', auth, on, ...checked('GET /health'), async (req, res) => {
  try {
    const e = ctx(req);
    /* STD1: the waiting list is a PAGE (50, least-tried first) with its total; `todo` is the ONE count by what each row asks (books-store
       waitingCount, GROUP BY over every open row) — Home, the Accounts card and Books' To do say the same numbers. Same transaction. */
    const LIMIT = 50;
    const [waiting, counts] = await withEntity(e, async (h) => [await S.waiting(h, e, LIMIT), await S.waitingCount(h, e)]);
    /* ⭐ WX-R2R + CX2 (2026-10-13): ONE health shape for the shop's year and country (INT5b) — `year` = the shop's YEAR, as the reads below default
       it (fyStart — the pack's year on the setting's fy_start_month; the screens paint it instead of assuming April), and `country` = the CS1 status
       the gate just read (accounts.html sets SESSION.country from it — CX0's reader). CX2's top-level fy_start_month is year.start_month. 0 new trips. */
    const pack = B.packOf(req.books),
      A = E.packs(),
      fy = A.fiscalYearOf(today(req), pack);
    res.json({
      enabled: true,
      currency: curOf(req),
      country: req.booksCountry || null,
      walkin_grain: req.books.walkin_grain,
      last_check: req.books.last_check || null,
      engines: E.status(),
      year: { fiscal_year: fy, from: fyStart(req, today(req)), start_month: Number(pack.fy_start_month) || null },
      waiting: waiting.map(require('../lib/books-hooks').waitingRow),
      total: counts.total,
      page: 1,
      limit: LIMIT,
      todo: { accept: counts.accept, add_supplier: counts.add_supplier, record: counts.record }
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Nothing in -> we run the books' self-check for this shop now -> what it found (owner only).
router.post('/check', auth, owner, on, ...checked('POST /check'), async (req, res) => {
  try {
    res.json(await require('../lib/books-nightly').check(ctx(req)));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Nothing in -> we try again every posting that was waiting to reach the books -> how many were tried, posted and still waiting (owner only).
router.post('/outbox/retry', auth, owner, on, ...checked('POST /outbox/retry'), async (req, res) => {
  try {
    const out = await require('../lib/books-hooks').retryOutbox(ctx(req), 100);
    res.json({ tried: out.tried, posted: out.posted, still: out.still });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** GET /accounts → { accounts: [{ account_id, code, name, is_group, tally_group, nature, role, parent_code }] } */
// @does Nothing in -> we read the shop's chart of accounts, leaving out parked rows of a corrected country -> the accounts with code, name, group and nature.
router.get('/accounts', auth, on, ...checked('GET /accounts'), async (req, res) => {
  try {
    const e = ctx(req);
    const chart = await withEntity(e, (h) => S.accounts(h, e));
    const codeOf = new Map(chart.map((item) => [String(item.account_id), item.code]));
    /* FX-AU1: a PARKED row (active false — only books-store.parkChart writes it, when the country was corrected before anything posted) is
       the old country's ledger the new pack did not lay over: never posted to, kept only because cb_app has no DELETE (b272). It is not the
       shop's chart and is not shown — India's CGST/SGST/IGST beside Australia's GST was the F8 finding. Code allocation still sees it (S.accounts). */
    res.json({
      accounts: chart
        .filter((item) => item.active !== false)
        .map((item) => ({
          account_id: item.account_id,
          code: item.code,
          name: item.name,
          is_group: !!item.is_group,
          tally_group: item.tally_group,
          nature: item.nature,
          role: item.role,
          parent_code: item.parent_id ? codeOf.get(String(item.parent_id)) || null : null,
          active: item.active !== false
        }))
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /accounts { name, parent_code | parent_id, source_code? } → { account: { code, account_id, name, source_code?, source_code_written? } } — the code is the system's (engines nextCode, role null); one typed here is refused (422).
 *  IM1: `source_code` = the code the ledger had in Xero / QuickBooks, kept beside ours (b302); one another ledger already holds is refused (422, a code clash). */
// @does A name and a parent account in -> we add a new account to the chart and log it -> the new account (owner only).
router.post('/accounts', auth, owner, on, ...checked('POST /accounts'), async (req, res) => {
  try {
    const e = ctx(req),
      b = req.body || {};
    let parent = b.parent_id;
    if (!parent && b.parent_code)
      parent = ((await withEntity(e, (h) => S.accounts(h, e))).find((item) => String(item.code) === String(b.parent_code) && item.is_group) || {}).account_id;
    const r = await B.addAccount(null, e, {
      name: b.name,
      parent_id: parent,
      code: b.code != null ? b.code : b.account_code,
      source_code: b.source_code,
      by: byOf(req)
    });
    res.json({
      ok: true,
      account: Object.assign(
        { code: r.code, account_id: r.account_id, name: r.name },
        r.source_code !== undefined ? { source_code: r.source_code, source_code_written: r.source_code_written } : {}
      )
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function fyStart(req, asOf) {
  const pack = B.packOf(req.books);
  const packs = E.packs();
  return packs.fyRange(packs.fiscalYearOf(asOf, pack), pack).start;
}
/**
 * ⭐ WHERE AN ENTRY CAME FROM (Athi, 2026-10-01, the first real entry: "where is it referenced to the sale record, how do I
 * connect to the sale record, who has done it?") — from the src_* columns S.entryLines reads in its own query:
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
/** who sold the bill, by name: the key's { name }, else the phone's by_name, else the plain text of src_by; null when none says */
function sellerOf(line) {
  const text = line.src_by;
  if (text && typeof text === 'object') return text.name || null;
  if (line.src_by_name && String(line.src_by_name).trim()) return String(line.src_by_name).trim();
  return typeof text === 'string' && text.trim() ? text.trim() : null;
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
    by: isWalkinDay ? null : seller || line.by_name || null,
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
  const canonicalMode = require('../lib/books-hooks').modeOf(mode);
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
  (await S.parties(db, e, ids)).forEach((item) => lookup.set(String(item.party_id), item));
  return lookup;
}
/**
 * ⭐ PERF1 · THE PAGE A BOOKS LIST IS ASKED FOR (DISCIPLINES §2 — the Inbox's contract: top-level total · page · limit, a server-side maximum):
 *   ?limit=1..500 (default 100) · ?after=YYYY-MM-DD|ENTRY_NO — the last row of the page before (keyset, never OFFSET) · ?page — the client's count, echoed
 *   ?entries=<entry_id>,… (≤ 500) — exactly those entries (a ledger line opening its own journal reads them, not the year's Day book)
 * null = nothing asked: the whole range, as before PERF1 (the screens adopt the pages in the web's PERF2).
 */
const pageLimit = require('../lib/page-limit');
function pageQ(query) {
  const ids = String(query.entries || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => UUID.test(x));
  if (ids.length) return { entries: ids.slice(0, S.PAGE_MAX) };
  if (query.limit == null && query.after == null && query.page == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})\|(.{1,60})$/.exec(String(query.after || ''));
  /* l16-scale: ?order=desc reads the pages NEWEST first (the Day book, and a Ledger asked for its newest lines: those carry no running balance); the default stays oldest first (the Ledgers page keeps it: its running balance runs from the opening) */
  return { limit: pageLimit.limitOf(query.limit, S.PAGE_DEFAULT, S.PAGE_MAX), after: match ? { date: match[1], no: match[2] } : null, page: pageLimit.pageOf(query.page), desc: String(query.order || '').toLowerCase() === 'desc' };
}
const cursorOf = (next) => (next ? next.date + '|' + next.no : null);

/** l16 adviser-bank: each entry an ADVISER's person posted (journal_entry.grant_id) gets `posted_by` { name, firm } — kept at the write (b871), so the owner reads it with no read into the firm's identities; null for every other entry. One read, only when b871 has run and an entry carries a grant. */
async function postedByIn(h, e, entries) {
  for (const item of entries) item.posted_by = null;
  if (!entries.length || !(await require('../lib/schema').hasColumn('journal_entry', 'by_firm'))) return;
  const rows = (await h.query('SELECT entry_id, by_name, by_firm FROM journal_entry WHERE entity_id = $1 AND entry_id = ANY($2::uuid[]) AND grant_id IS NOT NULL', [e, entries.map((item) => item.entry_id)])).rows;
  const byId = new Map(rows.map((row) => [String(row.entry_id), { name: row.by_name || null, firm: row.by_firm || null }]));
  for (const item of entries) item.posted_by = byId.get(String(item.entry_id)) || null;
}
/** GET /daybook?from&to → { currency, entries: [{ entry_no, posting_date, source_chit_id, source: { chit_id, ref, kind, counter, by, count, how, how_ref, split, doc_at, recorded_at } | null, narration,
 *  lines: [{ code, name, party_id, party_name, dr_minor, cr_minor, counter, rate }] }] } — `source` is sourceOf(), read in the same query as the lines */
// @does A date range and page in -> we read every journal entry posted in those days with its lines and the bill behind it -> a page of day-book entries.
router.get('/daybook', auth, on, ...checked('GET /daybook'), async (req, res) => {
  try {
    const e = ctx(req),
      from = dateQ(req.query.from, today(req)),
      to = dateQ(req.query.to, from),
      pg = pageQ(req.query);
    let paged = null;
    let markSide = null; /* MARK & QUERY: the marks of these entries, read in this same transaction (null while b868 is not run) */
    const out = await withEntity(e, async (h) => {
      let lines;
      if (pg && pg.entries) lines = await S.entryLines(h, e, from, to, null, null, pg);
      else if (pg) {
        const p = await S.entryPage(h, e, from, to, null, null, pg),
          t = await S.pageSums(h, e, from, to, null, null, null, false);
        lines = p.rows;
        paged = { next: p.next, limit: p.limit, sums: t };
      } else lines = await S.entryLines(h, e, from, to, null, null);
      const names = await partyNames(h, e, lines.map((item) => item.party_id).filter(Boolean));
      const entries = [],
        at = new Map();
      for (const l of lines) {
        let x = at.get(l.entry_id);
        if (!x) {
          x = {
            entry_id: l.entry_id,
            entry_no: l.entry_no,
            posting_date: E.ymd(l.posting_date),
            doc_date: E.ymd(l.doc_date),
            event_type: l.event_type,
            narration: l.narration || WORD[l.event_type] || l.event_type,
            source_chit_id: l.source_chit_id,
            reverses_entry_id: l.reverses_entry_id,
            reversed_by: l.reversed_by || null,
            reversed_by_id: l.reversed_by_id || null /* M174: "Reversed by MJ/…" — a link, and no Reverse button */,
            source: sourceOf(l),
            lines: []
          };
          at.set(l.entry_id, x);
          entries.push(x);
        }
        if (x.source && !x.source.counter && l.counter_id) x.source.counter = l.counter_id;
        const p = l.party_id ? names.get(String(l.party_id)) : null;
        x.lines.push({
          code: l.code,
          name: l.account_name,
          party_id: l.party_id,
          party_name: p ? p.nickname || p.name : null,
          dr_minor: Number(l.dr_minor),
          cr_minor: Number(l.cr_minor),
          counter: l.counter_id,
          rate: l.tax_rate == null || l.tax_rate === '' ? null : Number(l.tax_rate)
        }); /* the tax rate the line was posted at - the Day book writes "@ 12%" beside it */
      }
      const rawOf = new Map();
      for (const l of lines) (rawOf.get(l.entry_id) || rawOf.set(l.entry_id, []).get(l.entry_id)).push(l);
      await Evidence.attach(h, entries.map((x) => ({ item: x, chit_id: x.source && x.source.chit_id, ref: x.source && x.source.ref, source: x.source, entry: x, lines: rawOf.get(x.entry_id) })), { pack: B.packOf(req.books), cur: curOf(req), flag: true }); /* ASA 500: each entry vouches to its source; ONE read of the page's files */
      const answered = await LiveBill.markReverseAnswers(h, e, entries);
      markSide = await marksIn(h, req, 'acc.audit', entries.map((item) => item.entry_id));
      if (markSide) for (const item of entries) item.mark = markSide.byId[String(item.entry_id)] || null;
      await postedByIn(h, e, entries); /* b871: an entry an adviser firm's person posted says by whom and for whom */
      return answered;
    });
    /* PERF1: a page says its place — total entries in [from, to] · page · limit · `next` (the ?after= of the next page, null on the last) · the range's Σ Dr / Σ Cr, from the server */
    const page = paged
      ? {
          total: paged.sums.entries,
          page: pg.page,
          limit: paged.limit,
          next: cursorOf(paged.next),
          totals: { dr_minor: paged.sums.dr, cr_minor: paged.sums.cr }
        }
      : {};
    /* S34: every key a page can add is named (an unpaged answer leaves them undefined, which JSON leaves out) */
    res.json(await forBooksDoor(req, e, 'daybook', { currency: curOf(req), from, to, entries: out, count: out.length, total: page.total, page: page.page, limit: page.limit, next: page.next, totals: page.totals, mark_actions: markSide ? markSide.actions : undefined, mark_vocabulary: markSide ? markSide.vocabulary : undefined }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/** GET /ledger/:account?party&from&to — :account is the code (1300), the role (debtors) or the id →
 *  { currency, account, opening_minor, lines: [{ date, what, ref, source_chit_id, source (as the day book), dr_minor, cr_minor, running_minor }], closing_minor } */
// @does An account and optional party and dates in -> we read that account's lines with a running balance from its opening -> the ledger with opening, lines and closing.
router.get('/ledger/:account', auth, on, ...checked('GET /ledger/:account'), async (req, res) => {
  try {
    const e = ctx(req),
      to = dateQ(req.query.to, today(req)),
      from = dateQ(req.query.from, fyStart(req, to)),
      pg = pageQ(req.query);
    const party = UUID.test(String(req.query.party || '')) ? String(req.query.party) : null;
    let markSide = null; /* MARK & QUERY: the marks of these lines' entries, in this same transaction */
    const out = await withEntity(e, async (h) => {
      const key = String(req.params.account);
      const chart = await S.accounts(h, e);
      const a = require('../lib/bank-rec-log').accountIn(chart, key); /* the one reader of an account key: its code, its role or its id */
      if (!a) return null;
      const lo = await B.ledgerOf(h, e, a, party, from, to),
        open = lo.opening_minor,
        taxRoles = OtherSide.taxRolesOf(B.packOf(req.books)); /* W15-89b: the pack's own tax ledgers stay out of "the other side" */
      /* PERF1: a page (?limit · ?after) reads its entries only; its first running balance = the range's opening + ONE indexed SUM of the lines before
         the cursor (S.pageSums — never the earlier pages read); the range's closing and Σ come from the same SUM, not from the rows on the page */
      const p = pg && !pg.entries ? await S.entryPage(h, e, from, to, a.account_id, party, Object.assign({ noOpening: !!lo.period0 }, pg), { others: true }) : null;
      const t = p ? await S.pageSums(h, e, from, to, a.account_id, party, pg.after, !!lo.period0) : null;
      const rows = (p ? p.rows : await S.entryLines(h, e, from, to, a.account_id, party, null, { others: true })).filter(
        (item) => !(lo.period0 && Number(item.period) === 0)
      ); /* period 0 is IN the opening (WX-R2R) */
      const first = t ? open + t.before_dr - t.before_cr : open;
      let run = first;
      const lines = rows.map((item) => {
        run += Number(item.dr_minor) - Number(item.cr_minor);
        return {
          date: E.ymd(item.posting_date),
          doc_date: E.ymd(item.doc_date),
          what: item.narration || WORD[item.event_type] || item.event_type,
          ref: item.entry_no,
          entry_id: item.entry_id,
          entry_no: item.entry_no,
          event_type: item.event_type,
          reverses_entry_id: item.reverses_entry_id || null,
          reversed_by: item.reversed_by || null,
          source_chit_id: item.source_chit_id,
          source: sourceOf(item),
          party_id: item.party_id,
          party_name: OtherSide.partyNameOf(item.entry_lines) /* W15-89b: who the entry names, read in the same statement */,
          other: OtherSide.otherOf(item.entry_lines, item, taxRoles) /* W15-89b: the entry's other side: { code, name } · { code: null, name: 'Split', count } · null */,
          dr_minor: Number(item.dr_minor),
          cr_minor: Number(item.cr_minor),
          running_minor: pg && pg.desc ? null : run /* l16-scale: a newest-first page carries no running balance (it runs oldest first from the opening); the range closing_minor stays */
        };
      });
      const base = {
        account: { code: a.code, name: a.name, nature: a.nature },
        party,
        from,
        to,
        opening_minor: open,
        lines,
        closing_minor: t ? open + t.dr - t.cr : run
      };
      await Evidence.attach(h, lines.map((x) => ({ item: x, chit_id: x.source && x.source.chit_id, ref: x.source && x.source.ref })), { flag: false });
      markSide = await marksIn(h, req, 'acc.audit', lines.map((item) => item.entry_id));
      if (markSide) for (const item of lines) item.mark = markSide.byId[String(item.entry_id)] || null;
      base.chart_account = a; /* RAIL-146n: the reader's test (sales side or not); never in the answer */
      return t
        ? Object.assign(base, {
            page_opening_minor: pg.desc ? undefined : first,
            total: t.entries,
            page: pg.page,
            limit: p.limit,
            next: cursorOf(p.next),
            totals: { dr_minor: t.dr, cr_minor: t.cr }
          })
        : base;
    });
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such ledger.');
    /* every root key named (the page keys are undefined on an unpaged read and leave the JSON): the output allow-list reads them here */
    res.json(await forBooksDoor(req, e, 'ledger', { currency: curOf(req), account: out.account, party: out.party, from: out.from, to: out.to, opening_minor: out.opening_minor, lines: out.lines, closing_minor: out.closing_minor, page_opening_minor: out.page_opening_minor, total: out.total, page: out.page, limit: out.limit, next: out.next, totals: out.totals, mark_actions: markSide ? markSide.actions : undefined, mark_vocabulary: markSide ? markSide.vocabulary : undefined }, { account: out.chart_account }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/**
 * GET /evidence/:id → the file's bytes: a DOCUMENT file on a chit that is the source of an entry of THIS shop's books. The owner reads his own; a firm reads a member's through a live grant (X-Books-For, read only; the middleware logs the look and
 * refuses a revoked, expired or stranger caller with 403). Images and PDFs render inline, everything else downloads; never cached (a revoked grant must stop at once). A file that is not evidence answers 404 exactly as a file that is not there.
 */
// @does A file id in -> we serve it when it is a document file behind an entry of these books (read only, logged as a look under a grant) -> the file bytes.
router.get('/evidence/:id', auth, on, ...checked('GET /evidence/:id'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const held = await withEntity(e, (h) => Evidence.isEvidence(h, e, id));
    const file = held ? await require('../lib/storage').getBlob(id, e, { documentsOnly: true }) : null;
    if (!file) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such file behind these books.');
    require('../lib/attachment-send').sendBlob(res, file, { cache: 'private, no-store' });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/** GET /party/:id/statement?from&to → CBLedger.partyStatement, as { currency, party_id, from, to, code, opening_minor, lines: [{ date, what, ref, source_chit_id, source (as the day book's), dr_minor, cr_minor, running_minor,
 *  M29 (docs/FIELDS.md): entry_id, entry_no, event_type, reverses_entry_id, reversed_by, reversed_why, payment_id, unapplied_minor, advice }], closing_minor }
 *  ⭐ ONE read per table, never per row: the lines (with their reversal, in the same query), the sources, and — only when a payment line is present — the party's
 *  items once, so each payment's unapplied part is the engine's `outstanding` (the figure the preview and the outcome already use).
 *  M30: `advice` = { chit_id, state: none·sent·delivered·shared·disputed, shared_at } from the payments' b285 columns (one read) and my copy's chit status
 *  (one read) — 'none' for every line while b285 has not run (books-store adviceReady), never a 42703. */
// @does A customer or supplier and a date range in -> we read what they were billed and paid, with the advice state of each payment -> their statement.
router.get('/party/:id/statement', auth, noKey, on, ...checked('GET /party/:id/statement'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const to = dateQ(req.query.to, today(req)),
      from = dateQ(req.query.from, fyStart(req, to));
    const out = await withEntity(e, async (h) => {
      if (!(await B.knownParty(h, e, id))) return null;
      const st = E.ledger().partyStatement({ ...(await statementInput(h, e, id, from, to)), party: id, from, to });
      const meta = new Map((await S.ledgerLines(h, e, from, to, id)).map((item) => [String(item.entry_id), item]));
      /* where each entry came from (its bill, how it was paid, the counter, who rang it) - the same `source` the day book and a ledger carry, so a party's own ledger reads like theirs */
      const lookup = new Map();
      (await S.entryLines(h, e, from, to, null, id)).forEach((item) => {
        if (!lookup.has(String(item.entry_id))) lookup.set(String(item.entry_id), item);
      });
      const payIdOf = (m) => (/^pay:/.test(String(m.source_ref || '')) ? String(m.source_ref).slice(4) : null);
      const anyPay = st.rows.some((item) => payIdOf(meta.get(String(item.entry_id)) || {}));
      const byRef = anyPay ? E.receivables().outstanding(await B.partyItems(h, e, id, null)).by_ref : null;
      /* M30: the advice columns of the payments on this statement (one read) and where their chits stand on my copy (one read) — only once b285 is in */
      const payIds = st.rows.map((item) => payIdOf(meta.get(String(item.entry_id)) || {})).filter(Boolean);
      const advReady = payIds.length ? await S.adviceReady(h, e) : false;
      const adv = new Map(advReady ? (await S.paymentsAdvice(h, e, payIds)).map((x) => [String(x.payment_id), x]) : []);
      const advChits = Array.from(adv.values())
        .map((x) => x.advice_chit_id)
        .filter(Boolean);
      const advCs = advChits.length ? await S.adviceStates(h, e, advChits) : {};
      const adviceOf = (pid) => {
        const x = adv.get(String(pid)) || {};
        return {
          chit_id: x.advice_chit_id || null,
          state: B.adviceState(x, x.advice_chit_id ? advCs[x.advice_chit_id] : null),
          shared_at: x.advice_shared_at ? new Date(x.advice_shared_at).toISOString() : null
        };
      };
      return {
        roles: await S.partyOn(h, e, id),
        code: st.code,
        opening_minor: st.opening_minor,
        closing_minor: st.closing_minor,
        lines: st.rows.map((item) => {
          const m = meta.get(String(item.entry_id)) || {},
            pid = payIdOf(m),
            mine = pid && byRef ? byRef['pay:' + pid] : null;
          return {
            date: item.date,
            what: item.narration || WORD[m.event_type] || m.event_type || '',
            ref: item.jv_no,
            source_chit_id: m.source_chit_id || null,
            source: lookup.has(String(item.entry_id)) ? sourceOf(lookup.get(String(item.entry_id))) : null,
            dr_minor: item.dr_minor,
            cr_minor: item.cr_minor,
            running_minor: item.running_minor,
            entry_id: item.entry_id || null,
            entry_no: item.jv_no || null,
            event_type: m.event_type || null,
            reverses_entry_id: m.reverses_entry_id || null,
            reversed_by: m.reversed_by || null,
            reversed_why: B.reversalWhy(m.reversed_narration),
            payment_id: pid,
            unapplied_minor: pid ? (mine ? -Number(mine.outstanding_minor) : 0) : null,
            advice: pid ? adviceOf(pid) : null
          };
        })
      };
    });
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    res.json(await forBooksDoor(req, e, 'statement', { currency: curOf(req), party_id: id, from, to, code: out.code, opening_minor: out.opening_minor, closing_minor: out.closing_minor, lines: out.lines }, { roles: out.roles }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
async function statementInput(db, e, party, from, to) {
  const ledgerContext = await B.ledgerCtx(db, e);
  const packs = E.packs();
  return {
    pack: ledgerContext.pack,
    balances: await B.yearBalances(db, e, packs.fiscalYearOf(from, ledgerContext.pack), ledgerContext),
    lines: (await S.ledgerLines(db, e, B.monthStart(ledgerContext.pack, from), to, party)).map(E.lineOf)
  };
}

/**
 * GET /dues?asOf&side=customer|supplier → { currency, asOf, parties: [{ party_id, party_no, name, side, balance_minor (+ they owe
 * you, − you owe them), oldest_due, disputed_minor, buckets }], total_minor } — CBReceivables.outstanding → CBLedger.ageing.
 * Without `side`: both, one row per party (a party on both lists nets). ⚠️ A supplier's buckets are Schedule III's
 * PAYABLE ones (not_due · lt_1y · y1_2 · y2_3 · gt_3y) — the six receivable columns do not apply to them.
 * ⭐ ?side=supplier&finance=1 (CB Finance · Payables, F4 — lib/books-payables.view): each supplier row + `payable` { total_minor, buckets (0_30 · 31_45 ·
 *   46_60 · 60_plus), msme, msme_risk, msme_words, pay_by, group (msme · overdue · week · later), terms, early, bills[] }, and `payables` { total_minor }
 *   beside the parties — the bills are F3's own (books-cashflow.datedSide 'out'), so the total IS the cash view's outgoing dues. Owner only, as Collections.
 *   Trips added: cheques 1 · Udyam ids 1 · supplier terms 1 (+ the terms-column check, cached). Nothing per party.
 */
/**
 * R76: the early-pay offer the customer's TERMS make, in money, on the oldest netted bill still inside its window — books-engines.earlyOffer
 * (CBReceivables.earlyDiscount on what is owed). null = no offer in the terms, or none still valid; `words` are the shopkeeper's line.
 */
function earlyOfferRow(docs, asOf, currency, early) {
  const money = (minor) => require('../lib/bill-privacy').money(minor, currency);
  const open = (docs || []).filter((doc) => doc.outstanding_minor > 0 && !doc.disputed).sort((first, second) => String(first.date || '').localeCompare(String(second.date || '')));
  for (const doc of open) {
    const offer = E.earlyOffer({ date: doc.date, open_minor: doc.outstanding_minor }, asOf, currency, early);
    if (offer && offer.valid) return Object.assign(offer, { ref: doc.ref, words: 'Pays ' + money(offer.pay_minor) + ' by ' + B.dateWords(offer.by) + ' · saves ' + money(offer.save_minor) });
  }
  return null;
}
/** FIN-R1 + R76: the figures a customer's TERMS put on a Collections row — interest SHOWN (never posted), its state code, and the early-pay offer */
function termsFigures(docs, asOf, currency, effective) {
  return {
    interest_minor: E.interestMinor(docs, asOf, currency, effective && effective.interest.value),
    interest_state: E.interestState(effective),
    early: earlyOfferRow(docs, asOf, currency, effective && effective.early.value)
  };
}
/**
 * FIN-R1 + FIN-72: the two readers of a customer's terms (null terms = not the Collections read): effOf(party) → what applies (own, else the shop's, else not set; null for a party
 * with no list row), and followOpt — the credit days a bill with NO due date is aged by in the follow-up view (the same resolver: own, else the shop's; a party with no list row has the shop's).
 */
function termsReaders(financeTerms, terms) {
  const effOf = (pid) => {
    const ownTerms = terms && terms.by_party.get(String(pid));
    return ownTerms ? financeTerms.resolve(terms.shop, ownTerms) : null;
  };
  const creditDaysOf = (pid) => financeTerms.resolve(terms.shop, terms.by_party.get(String(pid)) || {}).credit_days.value;
  return { effOf, followOpt: terms ? { creditDaysOf } : null };
}
/** what sits beside the parties on the page: the Payables total (F4) and, on a Collections read, the follow-up total (FIN-72: what customers owe, by days late — a supplier row adds nothing) — nothing else is added */
function pageExtras(collections, payables, rows) {
  return Object.assign({}, payables ? { payables } : {}, collections ? { follow_up_total: E.followTotal(rows.filter((row) => row.side !== 'supplier')) } : {});
}
/** RAIL-146i: the /dues answer for THIS reader — ONE can_see_costs read (lib/cost.isCostBlind, fail-closed); an actor without it sees no supplier-side money (lib/dues-view R1-R6); the owner's bytes are untouched */
async function forReader(req, e, answer) {
  return (await require('../lib/cost').isCostBlind(req, e)) ? require('../lib/dues-view').blindDuesAnswer(answer) : answer;
}
/*
 * ⭐ THE ONE DUE FIGURE (R73/R76): a party's open documents below are the NETTED bills (E.dues → books-engines.netOpen — net of its receipts on
 * account), so oldest_due, the age buckets, the interest and the early-pay offer all read what is really owed; balance_minor is the engine's by_party.
 */
// @does Customer or supplier side, optionally the finance view in -> we read who owes what by age (limits and interest for the owner only) -> the dues list.
router.get('/dues', auth, noKey, on, ...checked('GET /dues'), async (req, res) => {
  try {
    /* ?finance=1 (CB Finance · Collections): + credit_limit_minor · credit_limit_from · over_limit · interest_minor · interest_state · last_remind.
       Owner only — the server decides. The limit and the interest rate are the customer's TERMS (FIN-R1): own, else the shop default, else
       not set — credit_limit_from null / interest_state 'not_set' (interest_minor null) is the code the screen paints "Not set" from. */
    const fin = req.query.finance === '1';
    if (fin && !isOwner(req)) {
      const no = req.query.side === 'supplier' ? 'Only the owner may see what you owe.' : 'Only the owner may see collections.';
      return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: no, legacy: { error: no, message: no } });
    }
    const e = ctx(req),
      asOf = dateQ(req.query.asOf, today(req));
    const sides = req.query.side === 'customer' ? ['debtors'] : req.query.side === 'supplier' ? ['creditors'] : ['debtors', 'creditors'];
    const pay = fin && req.query.side === 'supplier'; /* F4 Payables: the supplier side of CB Finance */
    let payables = null;
    const out = await withEntity(e, async (h) => {
      const chart = await S.accounts(h, e),
        lookup = new Map();
      /* FIN-new-1 (decided by practice: Xero, QuickBooks and SAP age by document date): "as at asOf" is every document DATED on or before asOf, and every payment dated on or before it —
         the row's own day (party_item.doc_date), never the moment it was recorded. A row with no document date falls back to the shop's day of its recording (one moment compared, PERF1). */
      const cut = Date.parse(require('../lib/books-hooks').dayBounds(asOf, req.books).to);
      const asOfDay = (item) => (item.date ? String(item.date) <= asOf : new Date(item.created_at).getTime() < cut);
      /* FIN-R1: interest and limit come from the customer's TERMS (finance-terms.resolve: own, else the shop default, else not set) — one grouped read */
      const T = require('../lib/finance-terms');
      /* W15-94: the customer terms are read on EVERY dues read (not only Collections), so a bill with no due date ages by the same credit days on every screen */
      const terms = sides.includes('debtors') ? await T.customerTerms(h, e) : null;
      const { effOf, followOpt } = termsReaders(T, terms);
      const noDays = { creditDaysOf: () => null }; /* a supplier's bill is aged by its own due date (the books write one), never by the shop's customer terms */
      let payableItems = [];
      for (const role of sides) {
        const a = chart.find((x) => x.role === role);
        if (!a) continue;
        const side = role === 'creditors' ? 'payable' : 'receivable',
          sign = role === 'creditors' ? -1 : 1;
        /* created_at is a MOMENT: its day is the shop's (dayOf), never E.ymd — that reads `date` columns */
        /* GROWTH5Y: "as at today" reads the OPEN documents only (S.openItems — a paid bill and its receipts are not read); a past day reads every row, as a bill paid since was open then */
        const items = (asOf >= today(req) ? await S.openItems(h, e, a.account_id, asOf) : await S.items(h, e, null, a.account_id)).map(E.itemOf).filter(asOfDay);
        const d = E.dues(items, asOf, side, Object.assign({ pack: B.packOf(req.books) }, role === 'debtors' ? followOpt || noDays : noDays));
        if (role === 'creditors') payableItems = items;
        const byRef = d.open.by_ref || {}; /* the NETTED bills — the one due figure (see above) */
        /* PERF1: each party's open documents, grouped ONCE — the filter over every document ran once per party (251 × 15k at 100k lines) */
        const docsOf = new Map();
        Object.keys(byRef).forEach((item) => {
          const x = byRef[item];
          if (!(x.outstanding_minor > 0)) return;
          const p = String(x.party);
          if (!docsOf.has(p)) docsOf.set(p, []);
          docsOf.get(p).push(x);
        });
        /* W15-114: who needs you, and why — ONE read per side (lib/books-needs: the flag, the open marks, the bill's own age), the party's counts beside its balance */
        const entryOfRef = new Map(items.filter((item) => item.ref === item.against_ref && item.entry_id).map((item) => [String(item.ref), item.entry_id]));
        const everyDoc = [...docsOf.values()].reduce((all, docs) => all.concat(docs), []);
        const billAge = E.billBands(everyDoc, asOf, role === 'debtors' ? (followOpt || noDays).creditDaysOf : noDays.creditDaysOf, side);
        const needs = await Needs.partyNeeds(h, e, req, { pack: B.packOf(req.books), cur: curOf(req), supplier: role === 'creditors' }, everyDoc.map((doc) => ({
          ref: doc.ref, party: doc.party, entry_id: entryOfRef.get(String(doc.ref)) || null, owed_minor: doc.outstanding_minor, disputed: !!((d.outstanding.by_ref[doc.ref] || doc).disputed),
          no_terms: !!(billAge[doc.ref] && billAge[doc.ref].no_terms), days_overdue: billAge[doc.ref] ? billAge[doc.ref].days_late : null
        })));
        Object.keys(d.ageing.by_party || {})
          .concat(Object.keys(d.outstanding.by_party || {}))
          .forEach((pid) => {
            if (lookup.has(pid + '|' + role)) return;
            const ag = d.ageing.by_party[pid] || { undisputed: {}, disputed: {}, total_minor: 0 };
            const open = Number((d.outstanding.by_party || {})[pid] || 0);
            const docs = docsOf.get(String(pid)) || [];
            const oldest =
              docs
                .map((x) => x.due_date || x.date)
                .filter(Boolean)
                .sort()[0] || null;
            /* ADDITIVE keep: web main still reads p.buckets (cap-books.js); the SAME ageing as before, filled from d.ageing; its removal is a later change made with its web twin */
            const buckets = {};
            Object.keys(ag.undisputed || {}).forEach((item) => {
              buckets[item] = sign * ((ag.undisputed[item] || 0) + ((ag.disputed || {})[item] || 0));
            });
            const disputed = Object.keys(ag.disputed || {}).reduce((total, item) => total + (ag.disputed[item] || 0), 0);
            const row = {
              party_id: pid,
              side: role === 'creditors' ? 'supplier' : 'customer',
              balance_minor: sign * open,
              oldest_due: oldest,
              disputed_minor: sign * disputed,
              buckets
            };
            row.follow_up = E.followRow(d.follow, pid); /* W15-94: the ONE ageing — days past due, both sides, every read */
            row.needs = Object.assign(Needs.empty(), needs.by_party.get(String(pid)) || {});
            if (fin && role === 'debtors') Object.assign(row, termsFigures(docs, asOf, curOf(req), effOf(pid)));
            lookup.set(pid + '|' + role, row);
          });
      }
      /* the names of the parties with dues — PERF1: only those, read from the shop's own lists (never the platform's identities) */
      const names = await partyNames(
        h,
        e,
        Array.from(lookup.values())
          .map((item) => item.party_id)
          .concat(payableItems.map((item) => item.party))
      );
      /* one row per party: a party on both lists nets (what they owe you less what you owe them) */
      const rows = new Map();
      for (const r of lookup.values()) {
        const p = names.get(String(r.party_id)) || {};
        const x = rows.get(r.party_id);
        if (!x)
          rows.set(
            r.party_id,
            Object.assign({ party_no: p.party_no || null, name: p.nickname || p.name || null }, r, fin ? E.limitView(effOf(r.party_id), r) : {})
          );
        else {
          x.balance_minor += r.balance_minor;
          x.disputed_minor += r.disputed_minor;
          Object.keys(r.needs).forEach((key) => (x.needs[key] = (x.needs[key] || 0) + r.needs[key])); /* a party on both lists: what needs you on either */
          x.side = 'both';
          if (r.side === 'customer') x.follow_up = r.follow_up; /* a both-sides row ages what the customer half owes (as before) */
          x.oldest_due = [x.oldest_due, r.oldest_due].filter(Boolean).sort()[0] || null;
          Object.keys(r.buckets).forEach((item) => {
            x.buckets[item] = (x.buckets[item] || 0) + r.buckets[item];
          });
          if (fin) {
            if (r.interest_minor != null) {
              x.interest_minor = (x.interest_minor || 0) + r.interest_minor;
              x.interest_state = r.interest_state;
            }
            Object.assign(x, E.limitView(effOf(r.party_id), x));
          }
        }
      }
      /* FX1: a party with a foreign-currency balance shows it beside the books' figure — "USD 1,000 · ₹83,250" (b392; one grouped read; absent before b392 and for a party with none) */
      if (await S.fxLinesReady()) {
        const ids = sides.map((role) => (chart.find((x) => x.role === role) || {}).account_id).filter(Boolean);
        const fx = ids.length ? await S.foreignBalances(h, e, { asOf, functional: curOf(req), account_ids: ids }) : [];
        for (const f of fx) {
          const r = rows.get(f.party_id);
          if (!r) continue;
          const have = (r.foreign = r.foreign || []).find((x) => x.currency === f.txn_currency);
          if (have) {
            have.balance_minor += f.txn_minor;
            have.carried_minor += f.fn_minor;
          } else r.foreign.push({ currency: f.txn_currency, balance_minor: f.txn_minor, carried_minor: f.fn_minor });
        }
      }
      if (pay) {
        const nestedP = require('../lib/books-payables'),
          more = await nestedP.read(h, e);
        const v = nestedP.view({
          asOf,
          currency: curOf(req),
          country: req.books && req.books.country,
          payable_items: payableItems,
          cheques: more.cheques,
          names,
          msme: more.msme,
          terms: more.terms,
          chart
        });
        for (const r of rows.values()) r.payable = v.by_party[String(r.party_id)] || null;
        payables = { total_minor: v.total_minor };
      }
      return require('../lib/upi-waiting').quietRows(Array.from(rows.values()).map(withBalanceWords(curOf(req))), e, fin).sort((first, second) => Math.abs(second.balance_minor) - Math.abs(first.balance_minor));
    });
    res.json(
      await forReader(req, e, {
        currency: curOf(req), asOf, parties: out, total_minor: out.reduce((total, item) => total + item.balance_minor, 0), needs: { customer: sides.includes('debtors') ? Needs.sumNeeds(out.filter((row) => row.side !== 'supplier')) : null, supplier: sides.includes('creditors') ? Needs.sumNeeds(out.filter((row) => row.side === 'supplier')) : null } /* a side not asked for is null, never a zero */, ...pageExtras(fin && sides.includes('debtors'), payables, out)
      })
    );
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/**
 * GET /party/:id/bills?side=customer|supplier&state=open|paid|all|part|unpaid&band&sort&dir&page&limit&asOf → { currency, party_id, side, asOf, bills: [{ ref, bill_no, date, due_date, days_overdue (null = not due), band, status, amount_minor, owed_minor,
 *   disputed, no_terms, entry_id, mark, evidence_flag }], total, page, limit, counts { open, paid, all }, owed_minor, bands, on_account_minor, mark_actions, checks } — W15-107: what a Receivables / Payables row opens to.
 * A party that is not this shop's (unknown, another shop's, or no id) is the one 404 (S35), as the statement answers it.
 * Open bills only by default, newest first, a page at a time; paid bills only when asked for. The band and the days late are the ONE ageing (books-engines.billBands). Money is the books' own; a reader who may not see costs gets no supplier bills.
 */
// @does A party, a side and a filter in -> we read that party's bills with what is still owed, their age, mark and evidence flag -> one page of bills and the counts.
router.get('/party/:id/bills', auth, noKey, on, ...checked('GET /party/:id/bills'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id),
      side = req.query.side === 'supplier' ? 'supplier' : 'customer',
      asOf = dateQ(req.query.asOf, today(req));
    if (side === 'supplier' && (await require('../lib/cost').isCostBlind(req, e))) return res.json({ currency: curOf(req), party_id: id, side, asOf, bills: [], total: 0, page: 1, limit: 0, counts: { open: 0, paid: 0, all: 0 }, owed_minor: null, bands: {}, checks: true });
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found'); /* S35: a path id that is no party of this shop (unknown, another shop's, not an id) is the one 404, as the statement answers it */
    const out = await withEntity(e, async (h) => ((await B.knownParty(h, e, id)) ? require('../lib/books-party-bills').read(h, e, req, { party: id, side, asOf, pack: B.packOf(req.books), cur: curOf(req), query: req.query }) : null));
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    res.json(out);
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/**
 * GET /attention?from&to[&kind=flag|none|nodoc|query|needs&page&limit] → { from, to, total, no_tax_invoice, no_file, no_source, open_queries, needs, [kind, entries, count, page, limit] } — W15-102: the Day book's evidence states counted on the server over the range
 * (lib/books-evidence attentionIn, the Day book's own rules), and with `kind` the entries behind one count, newest first, a page at a time. The Day book, Ledgers, BAS, To do and the auditor's view read these counts.
 */
// @does A date range (and one kind) in -> we count the entries with no tax invoice, no file, no source and the open queries, or list those behind one -> the counts, or a page of entries.
router.get('/attention', auth, noKey, on, ...checked('GET /attention'), async (req, res) => {
  try {
    const e = ctx(req),
      from = dateQ(req.query.from, today(req)),
      to = dateQ(req.query.to, from),
      pg = require('../lib/page-limit').pageArgs({ page: req.query.page, limit: req.query.limit || 25 }, 25, 100);
    const queryIds = async (h, first, last) => {
      const open = await Needs.openMarks(h, e, req, first, last); /* the marks module's own read, one place (W15-116): null = marking is off or unreadable, the queries stay uncounted */
      return open && open.filter((mark) => mark.class === 'open' && mark.posting_date >= first && mark.posting_date <= last).map((mark) => mark.subject_id);
    };
    res.json(await forBooksDoor(req, e, 'attention', await withEntity(e, (h) => Evidence.attentionIn(h, e, { pack: B.packOf(req.books), cur: curOf(req), queryIds }, from, to, req.query.kind, pg))));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/**
 * ⭐ CB FINANCE · CASH POSITION (F3) — GET /cashflow?days=7|30[&asOf] → lib/books-cashflow.project():
 *   { currency, asOf, days, from, to, opening_minor, opening: [{ role, code, name, balance_minor }], in_minor, out_minor, closing_minor, lowest: { date, balance_minor },
 *     shortfall: null | { date, short_minor, balance_minor, driver: { kind, ref, name, amount_minor } | null, words }, words,
 *     uncounted: { overdue_in_minor, overdue_parties, disputed_in_minor, disputed_out_minor, words }, gst: { payable_minor, due_date, counted, why } | null,
 *     series: [{ date, in_minor, out_minor, balance_minor, items: [{ kind, ref, party_id, name, amount_minor, due_date, promised, overdue, cheque_no }] }] }
 * Today's balance of the cash / bank ROLE ledgers, then money in (receivable dues by due date · promised dates · cheques in hand) and out (payable dues ·
 * cheques written · GST by the 20th of next month) day by day, and the FIRST day below zero in shopkeeper words. Finance suggests; nothing posts.
 * Owner only — the server decides (403 with the sentence); 404 while the ledger is off (`on`), like every books read. Reads only; one query per source.
 */
const CASH_OWNER_ONLY = 'Only the owner may see the cash position.'; /* a firm acting under a live grant (auditor or adviser) reads it too: the same read-only look as every books read */
// @does A horizon in days and a date in -> we read the cash held and what falls due in and out -> the cash position (owner only).
router.get('/cashflow', auth, noKey, on, ...checked('GET /cashflow'), async (req, res) => {
  try {
    if (!isOwner(req) && !req.acting_for_grant) return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: CASH_OWNER_ONLY, legacy: { error: CASH_OWNER_ONLY, message: CASH_OWNER_ONLY } });
    const e = ctx(req),
      CF = require('../lib/books-cashflow');
    const days = CF.HORIZONS.indexOf(Number(req.query.days)) >= 0 ? Number(req.query.days) : 7,
      asOf = dateQ(req.query.asOf, today(req));
    const cash = await withEntity(e, (h) => CF.read(h, e, req.books, { asOf, days }));
    // prettier-ignore
    res.json({ asOf: cash.asOf, days: cash.days, from: cash.from, to: cash.to, currency: cash.currency, opening_minor: cash.opening_minor, drawer_minor: cash.drawer_minor, bank_minor: cash.bank_minor, opening: cash.opening, in_minor: cash.in_minor, out_minor: cash.out_minor, closing_minor: cash.closing_minor, lowest: cash.lowest, shortfall: cash.shortfall, words: cash.words, uncounted: cash.uncounted, gst: cash.gst, series: cash.series });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/** GET /trial-balance?asOf → { currency, asOf, rows: [{ code, name, dr_minor, cr_minor }], total_dr_minor, total_cr_minor, balanced } */
// @does An as-at date in -> we read every account's debit and credit total -> the trial balance and whether it balances.
router.get('/trial-balance', auth, on, ...checked('GET /trial-balance'), async (req, res) => {
  try {
    const e = ctx(req),
      asOf = dateQ(req.query.asOf, today(req));
    const tb = await withEntity(e, (h) => B.trialBalance(h, e, asOf));
    res.json(await forBooksDoor(req, e, 'trial_balance', {
      currency: curOf(req),
      asOf,
      fy_from: fyStart(req, asOf) /* the year the as-at day is in: the year each line reads its entries from */,
      rows: tb.rows.map((item) => ({ code: item.code, name: item.name, group: item.group, dr_minor: item.debit_minor, cr_minor: item.credit_minor })),
      total_dr_minor: tb.total_dr_minor,
      total_cr_minor: tb.total_cr_minor,
      balanced: tb.balanced
    }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** Schedule III lines → the flat ledger rows a screen lists ({ code, name, amount_minor, line }) */
function flat(lines) {
  const out = [];
  (lines || []).forEach((item) =>
    (item.accounts || []).forEach((account) => out.push({ code: account.code, name: account.name, amount_minor: account.amount_minor, line: item.label, role: account.role }))
  );
  return out;
}
/** GET /pl?from&to | ?preset&step&compare → { currency, income, expense, profit_minor, profit_share_bp, by_line (each head and ledger: prior_minor, change_bp, share_bp), period, presets, compare } (inside one financial year; ACC-357: the same range last year beside it) */
// @does A date range in -> we read the income and expense accounts for the period -> the profit and loss with the profit.
router.get('/pl', auth, on, ...checked('GET /pl'), async (req, res) => {
  try {
    const e = ctx(req),
      R = require('../lib/books-report-period'),
      day = today(req),
      fyMonth = Number(fyStart(req, day).slice(5, 7));
    /* ACC-357 (W15-118): a preset (This year to date · Last month · Quarter · Last year) stepped with ‹ ›, the pack's own year; or any from/to — and always the same range last year beside it (or the span before, ?compare=period) */
    const picked = req.query.preset ? R.periodOf({ preset: req.query.preset, step: req.query.step }, day, fyMonth) : null;
    const to = picked ? picked.to : dateQ(req.query.to, day),
      from = picked ? picked.from : dateQ(req.query.from, fyStart(req, to)),
      how = ['year', 'period', 'none'].includes(req.query.compare) ? req.query.compare : 'year';
    const prior = how === 'none' ? null : R.priorOf({ from, to }, how);
    const out = await withEntity(e, async (h) => {
      const now = await B.profitAndLoss(h, e, from, to);
      let was = null;
      if (prior) was = await B.profitAndLoss(h, e, prior.from, prior.to).catch(logger.orElse('P&L: the comparison range could not be read — the page shows no comparison', null)); /* a range that leaves the financial year, or years before the books began: no comparison, said */
      return { now, was };
    });
    const pl = out.now,
      was = out.was;
    const withCompare = (lines, side) => R.compareLines(lines, was && (side === 'income' ? was.income : was.expenses), pl.total_income_minor, was ? was.total_income_minor : null);
    res.json(await forBooksDoor(req, e, 'pl', {
      currency: curOf(req),
      from,
      to,
      income: flat(pl.income),
      expense: flat(pl.expenses),
      total_income_minor: pl.total_income_minor,
      total_expense_minor: pl.total_expenses_minor,
      profit_minor: pl.profit_minor,
      profit_share_bp: R.shareOf(pl.profit_minor, pl.total_income_minor),
      total_income_share_bp: R.shareOf(pl.total_income_minor, pl.total_income_minor),
      total_expense_share_bp: R.shareOf(pl.total_expenses_minor, pl.total_income_minor),
      by_line: { income: withCompare(pl.income, 'income'), expense: withCompare(pl.expenses, 'expense') },
      period: Object.assign({ preset: picked ? picked.preset : 'custom', step: picked ? picked.step : 0, can_next: picked ? picked.can_next : false }, { from, to }),
      presets: R.PRESETS.map(([id, label]) => ({ id, label })),
      compare: was ? { how, from: prior.from, to: prior.to, total_income_minor: was.total_income_minor, total_expense_minor: was.total_expenses_minor, profit_minor: was.profit_minor, income_change_bp: R.changeOf(pl.total_income_minor, was.total_income_minor), expense_change_bp: R.changeOf(pl.total_expenses_minor, was.total_expenses_minor), profit_change_bp: R.changeOf(pl.profit_minor, was.profit_minor) } : null
    }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * The engine's Schedule III lines → one side as the statement prints it: heads in the pack's order, each with its ledgers and a head total.
 * ⭐ Only a regrouping of what CBLedger.balanceSheet returned — no figure is computed here beyond adding up the engine's own lines.
 * The year's profit so far (the engine's code-less 'profit_to_date' line) is named "Net profit" / "Net loss", sign kept.
 */
function sideOf(lines, order) {
  const rank = (slot) => {
    const position = order.indexOf(slot);
    return position < 0 ? order.length : position;
  };
  const heads = (lines || [])
    .map((item, index) => ({ L: item, i: index }))
    .sort((first, second) => rank(first.L.line) - rank(second.L.line) || first.i - second.i)
    .map(({ L: ledgerLine }) => ({
      line: ledgerLine.line,
      label: ledgerLine.label,
      total_minor: ledgerLine.amount_minor,
      ledgers: (ledgerLine.accounts || []).map((item) =>
        item.role === 'profit_to_date'
          ? { code: null, name: item.amount_minor < 0 ? 'Net loss' : 'Net profit', amount_minor: item.amount_minor, role: 'profit_to_date' }
          : { code: item.code, name: item.name, amount_minor: item.amount_minor }
      )
    }));
  return { heads, total_minor: heads.reduce((total, item) => total + item.total_minor, 0) };
}
function sched3(balanceSheet, order) {
  const equity = sideOf(balanceSheet.liabilities, order),
    assets = sideOf(balanceSheet.assets, order),
    diff = assets.total_minor - equity.total_minor;
  return { equity_and_liabilities: equity, assets: assets, balanced: diff === 0, difference_minor: diff };
}
/** GET /bs: each ledger of one side with its figure at each earlier day, by code (a ledger new since then reads 0, an earlier day that could not be read says null), and its heading */
function bsTagged(list, earlier, headOf) {
  return list.map((item) => {
    const was = (key) => {
      const side = earlier[key];
      if (!side) return null;
      const hit = [].concat(side.assets, side.liabilities, side.equity).find((x) => (x.code || x.role) === (item.code || item.role));
      return hit ? hit.amount_minor : 0;
    };
    return Object.assign({}, item, { prior_month_minor: was('month'), prior_year_minor: was('year'), group: item.code ? headOf(item.code) : null });
  });
}
/** GET /bs: a head's subtotal per figure, summed here from the very ledgers it lists (the page never adds) */
function bsGroupsOf(list) {
  const heads = new Map();
  list.forEach((item) => {
    const key = item.group ? item.group.code : '_';
    const head = heads.get(key) || heads.set(key, { code: item.group ? item.group.code : null, name: item.group ? item.group.name : null, amount_minor: 0, prior_month_minor: 0, prior_year_minor: 0 }).get(key);
    head.amount_minor += item.amount_minor;
    ['prior_month_minor', 'prior_year_minor'].forEach((k) => (head[k] = head[k] == null || item[k] == null ? null : head[k] + item[k]));
  });
  return [...heads.values()];
}
/** GET /bs?asOf | ?kind&step → { as_at, net_assets_minor, net_assets_ok, compare: { month, year }, each ledger: prior_month_minor · prior_year_minor · group; currency, assets, liabilities, equity, total_assets_minor, total_liab_equity_minor, balanced, by_line,
 *  schedule_iii: { equity_and_liabilities: { heads, total_minor }, assets: { heads, total_minor }, balanced, difference_minor } } */
// @does An as-at date in -> we read assets, liabilities and equity -> the balance sheet and whether it balances.
router.get('/bs', auth, on, ...checked('GET /bs'), async (req, res) => {
  try {
    const e = ctx(req),
      R = require('../lib/books-report-period'),
      day = today(req),
      fyMonth = Number(fyStart(req, day).slice(5, 7));
    /* ACC-357 (W15-119): "as at" a day, or a kind (today · month end · year end) stepped with ‹ ›; the prior month and the prior year beside it, in ONE view (beyond QuickBooks, which cannot) */
    const picked = req.query.kind ? R.asAtOf({ kind: req.query.kind, step: req.query.step }, day, fyMonth) : null;
    const asOf = picked ? picked.as_at : dateQ(req.query.asOf, day);
    const out = await withEntity(e, async (h) => {
      const chart = await S.accounts(h, e),
        nature = new Map(chart.map((item) => [String(item.code), item.nature])),
        byCode = new Map(chart.map((item) => [String(item.code), item])),
        notes = N.netOfByRole((B.packOf(req.books).presentation || {}).taxNetting, chart);
      /* the heading a ledger sits under: the pack's own top group of the chart (never a word of ours) */
      const headOf = (code) => {
        let item = byCode.get(String(code));
        while (item && item.parent_code && byCode.get(String(item.parent_code))) item = byCode.get(String(item.parent_code));
        return item && item.code ? { code: String(item.code), name: item.name } : null;
      };
      const at = async (day0) => {
        const bs = await B.balanceSheet(h, e, day0, B.entityBasisOf(req.books)); /* undefined until the entity-type decision is taken → Schedule III */
        const left = flat(bs.liabilities),
          liabilities = N.withNetOf(left.filter((item) => item.code && nature.get(String(item.code)) !== 'equity'), notes),
          equity = left.filter((item) => !item.code || nature.get(String(item.code)) === 'equity');
        return { bs, assets: N.withNetOf(flat(bs.assets), notes), liabilities, equity, total_liabilities_minor: N.totalOf(liabilities), total_equity_minor: N.totalOf(equity) };
      };
      const now = await at(asOf);
      const earlier = {};
      for (const [key, day1] of [['month', R.monthsBefore(asOf, 1)], ['year', R.yearBefore(asOf)]]) earlier[key] = await at(day1).then((x) => Object.assign(x, { as_at: day1 })).catch(logger.orElse('Balance sheet: an earlier day could not be read — its column is left out', null));
      const liabilities = bsTagged(now.liabilities, earlier, headOf),
        equity = bsTagged(now.equity, earlier, headOf),
        assets = bsTagged(now.assets, earlier, headOf);
      const groups = { assets: bsGroupsOf(assets), liabilities: bsGroupsOf(liabilities), equity: bsGroupsOf(equity) };
      const sumOf = (list) => list.reduce((total, item) => total + item.amount_minor, 0);
      const groups_ok = sumOf(groups.assets) === now.bs.total_assets_minor && sumOf(groups.liabilities) === now.total_liabilities_minor && sumOf(groups.equity) === now.total_equity_minor;
      const net_assets_minor = now.bs.total_assets_minor - now.total_liabilities_minor;
      const sides = (x) => (x ? { as_at: x.as_at, total_assets_minor: x.bs.total_assets_minor, total_liabilities_minor: x.total_liabilities_minor, total_equity_minor: x.total_equity_minor, net_assets_minor: x.bs.total_assets_minor - x.total_liabilities_minor } : null);
      return {
        assets,
        liabilities,
        equity,
        total_liabilities_minor: now.total_liabilities_minor,
        total_equity_minor: now.total_equity_minor,
        total_assets_minor: now.bs.total_assets_minor,
        total_liab_equity_minor: now.bs.total_liabilities_minor,
        profit_to_date_minor: now.bs.profit_to_date_minor,
        net_assets_minor,
        groups,
        groups_ok,
        net_assets_ok: net_assets_minor === now.total_equity_minor /* two carried totals, compared: what the business owns less what it owes is what the owners hold */,
        compare: { month: sides(earlier.month), year: sides(earlier.year) },
        balanced: now.bs.balanced,
        by_line: { assets: now.bs.assets, liabilities: now.bs.liabilities },
        schedule_iii: sched3(now.bs, Object.keys(B.packOf(req.books).sch3 || {}))
      };
    });
    res.json(await forBooksDoor(req, e, 'bs', Object.assign({ currency: curOf(req), asOf, fy_from: fyStart(req, asOf), as_at: picked || { kind: 'custom', step: 0, as_at: asOf, can_next: false } }, out)));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── payments: record → propose → confirm ─────────────────────────────────────────────────────────────────── */

/**
 * POST /payments { party_id, direction: in|out, amount_minor, currency, mode, reference?, cheque?: { number, bank, date },
 * received_at?, client_ref? } → { ok, payment: { payment_id, status: 'recorded' | 'cheque_received', duplicate }, posted }
 * The payment row and its entry are ONE transaction: a refusal (a locked month) leaves nothing half-recorded.
 * ⭐ client_ref: the same ref again → 200, the FIRST payment (duplicate: true) and its entry — never a second posting.
 * ⚠️ Refused in words (422): a party on neither of the shop's lists; a date before the ledger began or in the future.
 * A cheque posts only when it CLEARS (C3) — until then it is a status row, and there is nothing to propose.
 */
/** the body's payment mode when it is one the shop's country pack takes (lower-cased), a cheque included — a payment records one — else null (ACC-300: P().modesOf, the one list) */
function knownMode(body, shop) {
  const given = String(body.mode || '').toLowerCase();
  return P().modesOf(shop, { cheque: true }).indexOf(given) >= 0 ? given : null;
}
/** how the body wants the money spread: 'none' · 'oldest_first', else null (the books decide) */
function allocateOf(body) {
  return body.allocate === 'none' ? 'none' : body.allocate === 'oldest_first' ? 'oldest_first' : null;
}
/** FIN-60: a /dues row with its standing in words, the payment outcome's own function (B.owesWords; + they owe you) — said once the rows are netted */
const withBalanceWords = (currency) => (row) => Object.assign(row, { balance_words: B.owesWords(row.balance_minor, currency) });
/** FIN-79: the direction a payment body names — in or out; left out it is in; anything else (both) is null, a question */
const directionOf = (body) => (body.direction == null || body.direction === 'in' ? 'in' : body.direction === 'out' ? 'out' : null);
/** the payment question a body asks — shared by /payments/preview and /payments; a refusal is { status, words } */
function paymentQuestion(req, needMode) {
  const body = req.body || {},
    currency = String(curOf(req)).toUpperCase();
  const party = String(body.party_id || body.party || '');
  if (!UUID.test(party)) return { refuse: { status: 400, words: 'Which party?' } };
  if (body.currency && String(body.currency).toUpperCase() !== currency) return { refuse: { status: 422, words: 'This ledger is kept in ' + currency + '.' } };
  const amount_minor = minorAsked(body, currency);
  if (!(amount_minor > 0)) return { refuse: { status: 400, words: 'How much?' } };
  const direction = directionOf(body);
  if (!direction) return { refuse: { status: 400, words: 'Is this money in or out?' } };
  const mode = knownMode(body, req.books);
  if (needMode && !mode) return { refuse: { status: 400, words: 'Paid how — ' + P().modeList(P().modesOf(req.books, { cheque: true })) + '?' } };
  const allocate = allocateOf(body);
  const allocations = Array.isArray(body.allocations) && body.allocations.length ? body.allocations : null;
  return { party, direction, amount_minor, cur: currency, mode, allocate, allocations, country: req.books && req.books.country };
}
/** the party as the words and the advice need it — the display name (else the nickname the lists keep; "this party" when neither is known), whether it is ON the rail
 *  (books-store parties: can it receive a chit), and the names map itself so the same read serves the outcome and the advice (M30) */
async function partyOf(db, e, party) {
  const names = await partyNames(db, e),
    partyRow = names.get(String(party)) || {};
  return { names, name: partyRow.name || partyRow.nickname || 'this party', on_rail: partyRow.on_rail === true };
}
/** M30: who is asking (viewer · commenter · editor — lib/access, the rail ladder) and the shop's own name (the advice names its sender; a co-assist's token names the person) */
const levelOf = (req) => require('../lib/access').levelOf(req.identity);
async function meName(req, db, e) {
  return req.identity && req.identity.identity_type === 'entity' && req.identity.display_name ? req.identity.display_name : (await S.shopName(db, e)) || 'We';
}
/** RAIL-146m: a payment answer for THIS reader — a supplier payment (out) asks can_see_costs ONCE (lib/cost.isCostBlind, fail-closed) and a blind
 *  co-assist gets the same shape with the purchase money null (lib/dues-view R7); a customer payment and the owner never read the flag — their bytes are untouched */
async function forPayer(req, e, kind, direction, answer) {
  const blind = direction === 'out' && (await require('../lib/cost').isCostBlind(req, e));
  return blind ? require('../lib/dues-view').blindPayment(kind, answer, direction) : answer;
}
/** RAIL-146n: the statement / ledger / cheques answer for THIS reader: ONE can_see_costs read (fail-closed), then lib/dues-view R9; the owner and a cost-seeing actor get their bytes untouched */
async function forBooksDoor(req, e, kind, answer, opt) {
  return (await require('../lib/cost').isCostBlind(req, e)) ? require('../lib/dues-view').blindBooks(kind, answer, opt) : answer;
}
/** B3: a kept bank statement shows every supplier payment, so a reader without can_see_costs is refused (403 COST_BLIND) — the SAME ONE test /bank/rail asks (lib/cost.isCostBlind, fail-closed; a grant's can_see_costs rides the acting identity). true = answered. */
async function costBlindStops(req, res, e) {
  if (!(await require('../lib/cost').isCostBlind(req, e))) return false;
  const said = require('../lib/cost').COST_BLIND_READ_SAY;
  problem(req, res, { status: 403, code: 'COST_BLIND', detail: said, legacy: { error: 'Not permitted', message: said } });
  return true;
}
/** POST /payments/preview — W1–W4 and the 409 share one shape: { code: 'ALREADY_PAID', error, message: words, warnings } */
function alreadyPaid(res, err) {
  /* FIN-53: the title follows the list — "Already paid?" for the same money twice, "More than is owed" for W1/W2 alone (books.warningTitle) */
  const title = err.title || 'Already paid?',
    req = res.req,
    said = (seen) => problem(req, res, { status: 409, code: 'ALREADY_PAID', detail: seen.message, legacy: Object.assign({ error: title, message: seen.message, warnings: seen.warnings }, seen.cost_hidden ? { cost_hidden: true } : {}) });
  const plain = { message: err.message, warnings: err.warnings || [] };
  const direction = err.direction || (req.body || {}).direction; /* RAIL-146n: a chit's Mark-paid sends no body direction, so the books' error carries it */
  if (direction !== 'out') return said(plain); /* a customer's payment and a chit's Mark-paid (routes/chits payFailure): as before, synchronously */
  /* RAIL-146m R7: the sentence names what is open, so a blind payer to a supplier reads the title alone and the warnings without their figures */
  return forPayer(req, ctx(req), 'refusal', 'out', plain).then((seen) => said(seen.cost_hidden ? Object.assign(seen, { message: title }) : seen));
}

/**
 * POST /payments/preview { party_id, direction, amount_minor, currency, allocate?: 'oldest_first'|'none' } — NO WRITE (M26, SPEC-payments §4.1)
 * → { currency, party: { party_id, name }, open_minor, proposal: [{ against_ref, bill_no, due_date, open_minor, due_minor, apply_minor, disputed }],
 *     apply_minor, on_account_minor, skipped, warnings: [{ code, words, entry_no? }], words }
 * The proposal is B.proposeFor (the one function /propose and the one-call record use); the warnings are the duplicate rule
 * (PAY D5: W1–W4, 24 h). The web paints them; it composes none of the words.
 */
// @does A party, amount and mode in -> we work out how the payment would settle the open bills, posting nothing -> a preview with the proposed split and warnings.
router.post('/payments/preview', auth, noKey, on, ...checked('POST /payments/preview'), async (req, res) => {
  try {
    const e = ctx(req),
      q = paymentQuestion(req, false);
    if (q.refuse) return refuseQuote(req, res, q.refuse);
    const out = await withEntity(e, async (h) => {
      const who = await partyOf(h, e, q.party),
        name = who.name;
      const prop = await B.proposeFor(h, e, { party: q.party, direction: q.direction, amount_minor: q.amount_minor, currency: q.cur });
      /* W15-95 / W15-96: `checks: true` (the bill list under a party, the Pay confirm) adds each open bill's own amount, its mark and its evidence flag — the Day book's own sources */
      const checksAsked = (req.body || {}).checks === true,
        billChecks = checksAsked ? await require('../lib/bill-checks').attach(h, e, req, prop, { pack: B.packOf(req.books), cur: curOf(req) }) : null;
      const warnings = await B.duplicateWarnings(
        h,
        e,
        { party: q.party, direction: q.direction, amount_minor: q.amount_minor, allocate: q.allocate, allocations: q.allocations, country: q.country },
        prop,
        name
      );
      /* M30: on_rail — the popup says "Tally Test is not on ChitBridge" before anything is recorded (SPEC §1.3) */
      return {
        currency: prop.currency,
        party: { party_id: q.party, name, on_rail: who.on_rail },
        open_minor: prop.open_minor,
        proposal: prop.proposal,
        apply_minor: prop.apply_minor,
        on_account_minor: prop.on_account_minor,
        skipped: prop.skipped,
        why: prop.why,
        warnings,
        words: B.previewWords(prop, name, q.direction),
        mark_actions: billChecks ? billChecks.mark_actions : undefined,
        checks: billChecks ? true : undefined /* says the rows below carry the bill checks, so a caller never mistakes an older answer for "every bill paid" */
      };
    });
    res.json(await forPayer(req, e, 'preview', q.direction, { currency: out.currency, party: out.party, open_minor: out.open_minor, proposal: out.proposal, apply_minor: out.apply_minor, on_account_minor: out.on_account_minor, skipped: out.skipped, why: out.why, warnings: out.warnings, words: out.words, ...(out.checks ? { mark_actions: out.mark_actions, checks: true } : {}) }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * POST /payments { party_id, direction: in|out, amount_minor, currency, mode, reference?, cheque?: { number, bank, date }, received_at?, client_ref?,
 *                  allocations?: [{ against_ref, amount_minor }], allocate?: 'oldest_first'|'none', acknowledge?: [codes] }
 * → { ok, payment: { payment_id, status: 'recorded' | 'cheque_received', duplicate }, posted, allocation: null | { settled, items, allocated_minor },
 *     outcome: { words, settled: [{ against_ref, bill_no, amount_minor }], applied_minor, on_account_minor, balance_minor, balance_words },
 *     advice: null (a replay) | the GET /payments/:id/advice answer (M30: party.on_rail · may.send_advice / share_advice · words · body — the ready chit send body · share) }
 * ⭐ ONE CALL, ONE TRANSACTION (M26): the payment row, its entry and the bills it settles commit together or not at all — a refused
 *   allocation (confirmItems) rolls the payment back with it. `allocate: 'oldest_first'` with no list = the server's own proposal.
 * ⭐ client_ref: the same ref again → 200, the FIRST payment (duplicate: true) and its entry — never a second posting; a replay is
 *   answered BEFORE the duplicate rule looks at the new body.
 * ⭐ THE DUPLICATE RULE (PAY D5, W1–W4): a warning not named in `acknowledge` → 409 ALREADY_PAID with the words and the warnings;
 *   nothing is written. The web's "Pay as advance" button is what sets `acknowledge`.
 * ⚠️ Refused in words (422): a party on neither of the shop's lists; a date before the ledger began or in the future.
 * A cheque posts only when it CLEARS (C3) — until then it is a status row, and there is nothing to propose.
 */
// @does A party, amount and mode in -> we record money received or paid and settle open bills (a cheque waits until it clears); a repeat is ignored -> the payment and what it settled (editors).
router.post('/payments', auth, noKey, editor, onceOnly, on, ...checked('POST /payments'), async (req, res) => {
  try {
    const e = ctx(req),
      b = req.body || {},
      q = paymentQuestion(req, true);
    if (q.refuse) return refuseQuote(req, res, q.refuse);
    const { party, direction, amount_minor, cur, mode, allocate } = q;
    const date = dateQ(b.received_at || b.date, today(req));
    const chq = b.cheque && typeof b.cheque === 'object' ? b.cheque : {};
    const client_ref = b.client_ref ? String(b.client_ref).slice(0, 80) : null;
    const ack = Array.isArray(b.acknowledge) ? b.acknowledge : []; /* a code, or { code, over_minor } — books.acknowledgements reads both */
    const allocations = Array.isArray(b.allocations)
      ? b.allocations
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({ against_ref: String(item.against_ref || ''), amount_minor: Math.round(Number(item.amount_minor)) }))
      : null;
    /* ⭐ the payment row and its entry are ONE transaction (B.recordPayment) — a refusal leaves nothing half-recorded */
    const out = await withEntity(e, async (h) => {
      const who = await partyOf(h, e, party),
        name = who.name;
      /* the duplicate rule runs INSIDE recordPayment (p.warn), after its gates (a replay answers first; a stranger or a bad date is a 422) */
      const rec = await B.recordPayment(h, e, {
        party_id: party,
        direction,
        amount_minor,
        currency: cur,
        mode,
        reference: b.reference,
        cheque_no: chq.number || chq.no || b.cheque_no,
        cheque_bank: chq.bank || b.cheque_bank,
        cheque_date: require('../lib/books-period').dateGiven(chq.date || chq.dated || b.cheque_date, 'cheque.date', null) /* FIN-82: a given day that is not one is DATE_INVALID, never dropped */,
        received_at: date,
        client_ref,
        by: byOf(req),
        note_if_moved: b.if_locked === 'next_open', /* W15-85a: the api writes the payment's narration, so it adds the "<Month> locked" note */
        strict_date: b.if_locked !== 'next_open', /* l16 banklock: the owner's own press on a bank line in a locked month; its date stays received_at */
        allocations,
        allocate,
        warn: { acknowledge: ack, country: q.country, name }
      });
      if (!rec.payment.duplicate)
        rec.outcome = await B.paymentOutcome(
          h,
          e,
          { party_id: party, direction, amount_minor, currency: cur, mode },
          rec.payment.payment_id,
          rec.allocation,
          name
        );
      /* M30: the advice, ready to send — from the facts just written (no second read of the bills); a replay carries none (its row already answers) */
      rec.advice = rec.payment.duplicate
        ? null
        : await B.adviceFor(
            h,
            e,
            {
              payment_id: rec.payment.payment_id,
              party_id: party,
              direction,
              amount_minor,
              currency: cur,
              mode,
              reference: b.reference || null,
              received_at: date
            },
            {
              level: levelOf(req),
              me: await meName(req, h, e),
              names: who.names,
              ready: await S.adviceReady(h, e),
              settled: rec.outcome.settled,
              on_account_minor: rec.outcome.on_account_minor,
              entry_no: rec.posted && rec.posted.entry_no,
              entry_id: rec.posted && rec.posted.entry_id
            }
          );
      return rec;
    });
    /* a bill settled here is a step of R-1400 (lib/bill-privacy) — after the commit, best effort, as /confirm does for "Choose the bills" */
    if (out.allocation && out.allocation.settled && out.allocation.settled.length) {
      try {
        const pay = await withEntity(e, (h) => S.payment(h, e, out.payment.payment_id));
        const billPrivacy = require('../lib/bill-privacy');
        await billPrivacy.moneySteps(e, pay, out.allocation.settled, { id: byOf(req), name: (req.identity && req.identity.display_name) || null }, (failure) => billPrivacy.raiseStepTicket(e, pay, failure)); /* FIN-71: a failed bill step raises ONE deduped ticket */
      } catch (e2) {
        console.error('bill money steps:', e2.message);
      }
    }
    res.json(await forPayer(req, e, 'record', direction, { ok: true, payment: out.payment, posted: out.posted, allocation: out.allocation, outcome: out.outcome, advice: out.advice })); /* a replay has no allocation or outcome: undefined leaves the JSON as before */
  } catch (err) {
    if (err && err.code === 'ALREADY_PAID') return alreadyPaid(res, err);
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * GET /payments/:id/advice (M30, SPEC-payments §3 · §4.3) → { currency, payment_id, party: { party_id, name, on_rail }, advice: { chit_id, state, shared_at },
 *   may: { send_advice: { ok } | { ok: false, why, say }, share_advice: … }, words, body: the POST /api/chits/send body | null, share: { text, wa, mailto } | null }
 * ⭐ THE UNIT PAINTS, THE SERVER DECIDES: "Send advice" and "Share" are always shown; `may` says whether THIS login may press each, with the sentence
 *   to grey it by — the same B.adviceMay the PATCH enforces. The web sends the chit (`body`, client_ref 'advice:pay:<id>' — /send dedupes) and then PATCHes
 *   advice_chit_id. Before b285 runs: state 'none', may.*.why 'not_available' with its words — never a 500.
 */
// @does A payment id in -> we read whether a payment advice was sent to the other party and what may be done next -> the advice state.
router.get('/payments/:id/advice', auth, noKey, on, ...checked('GET /payments/:id/advice'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such payment.');
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return null;
      const advice = await B.adviceFor(h, e, p, { level: levelOf(req), me: await meName(req, h, e), names: await partyNames(h, e), ready: await S.adviceReady(h, e) });
      return Object.assign(advice, { direction: p.direction }); /* RAIL-146m: the side decides who may read the figures */
    });
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such payment.');
    res.json(await forPayer(req, e, 'advice', out.direction, { currency: curOf(req), payment_id: out.payment_id, party: out.party, advice: out.advice, may: out.may, words: out.words, body: out.body, share: out.share }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * GET /bank/rail?from&to (BR1) — THE RAIL LEG of the bank reconciliation the device runs (DECISIONS: the statement never leaves the device; the
 *   page asks only for what the other party already TOLD us): → { currency, from, to, me, rail_chits: [{ chit_id, direction, status, created_at,
 *   party: { id, name }, business_json: { kind, currency, payment_advice | bank_query }, line_items: [{ ref_chit_id, bill_no, applied_minor }] }],
 *   parties: [{ party_id, name }] (on the rail — who may be ASKED), books: { parties: [{ id, name, kind }] (EVERY customer and supplier — who a line may name), open_items: [{ ref, bill_no, party, side, open_minor, currency, due_date }] (the open invoices and bills — lib/bank-open, M4) }, may: { ask: { ok } | { ok: false, why, say } } }
 *   ONE read of my advice + bank-question copies (S.bankRailChits, bounded) and the party list (one read). No money is computed here: the engine
 *   (bank-recon railPayments · explain) does it on the device. `may.ask` is the rail ladder (lib/rail byLevel) — POST /api/chits/send decides again.
 *   Who may call: any login of the shop with the Ledger on (a viewer reads; its Ask is greyed with the sentence). A key (counter) may not (noKey).
 */
// @does A date range of 400 days or fewer in -> we read the money chits on the rail for that range, to be matched against a bank statement -> the chits by day.
router.get('/bank/rail', auth, noKey, on, ...checked('GET /bank/rail'), async (req, res) => {
  try {
    const e = ctx(req),
      to = dateQ(req.query.to, today(req)),
      from0 = dateQ(req.query.from, to);
    const from = from0 > to ? to : from0;
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400)
      return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Too long', 'Choose a statement of 400 days or fewer.');
    const out = await withEntity(e, async (h) => {
      const rows = await S.bankRailChits(h, e, from, to, 500);
      const names = await partyNames(h, e);
      const withCosts = !(await require('../lib/cost').isCostBlind(req, e)); /* a supplier's bills are cost money (RAIL-146i) */
      const books = await require('../lib/bank-open').openDocuments(h, e, { names, currency: curOf(req), withCosts });
      return { rows, names, books, me: await meName(req, h, e) };
    });
    const R = require('../lib/rail'),
      lvl = R.byLevel(levelOf(req), 'ask');
    const li = (x) => ({
      ref_chit_id: x.ref_chit_id || null,
      bill_no: x.bill_no || null,
      applied_minor: Number.isInteger(x.applied_minor) ? x.applied_minor : null
    });
    const rail_chits = out.rows.map((item) => {
      const bj = item.business_json || {};
      return {
        chit_id: item.chit_id,
        direction: item.direction,
        status: item.status || null,
        created_at: item.created_at ? new Date(item.created_at).toISOString() : null,
        party: { id: item.party_id || null, name: item.party_name || null },
        business_json: { kind: bj.kind, currency: bj.currency || null, payment_advice: req.acting_for_grant ? undefined : bj.payment_advice || undefined, /* a payee's bank details are the owner's (C6): an adviser reads the bank lines, not them */ bank_query: bj.bank_query || undefined },
        line_items: (Array.isArray(item.line_items) ? item.line_items : []).filter((x) => x && x.ref_chit_id).map(li)
      };
    });
    const parties = [...out.names.values()]
      .filter((item) => item.on_rail)
      .map((item) => ({ party_id: item.party_id, name: item.nickname || item.name || null }));
    /* ⚠️ `rail_chits`, never `chits`: the web's api() collapses a `chits` array and would drop parties / may (core.js unwrap) */
    res.json({ currency: curOf(req), from, to, me: out.me, rail_chits, parties, books: out.books, may: { ask: lvl ? { ok: false, why: lvl, say: R.say(lvl) } : { ok: true } } });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/* ── FIN-70 · THE BANK RECONCILIATION RECORD (lib/bank-rec-log, b864 bank_rec_log): the page's step actions and its signed statement, insert-only, who and when stamped HERE.
   Writes are the editor's (a viewer, the auditor, cannot); the read is any login with the Ledger on (the ACC-176 guest actor reads at viewer level). Before b864: 503 in words, the page keeps its marks on the device. ── */
const BANK_LOG = require('../lib/bank-rec-log');
/** the bank ledger a body or query names (code, role or id) inside this transaction, or the 404 */
async function bankAccountOf(handle, e, key) {
  const account = BANK_LOG.accountIn(await S.accounts(handle, e), key);
  if (!account) throw Object.assign(new Error('That bank account was not found.'), { code: 'BOOKS_NOT_FOUND' });
  return account;
}
/** POST /bank/marks { account, file_hash?, marks: [{ act: accept|undo|note|attach, key, how?, chits?, ledger?, text?, ref? }] } → { marks: [row], by, at } — editor; insert-only, one transaction. `by` and `at` are the server's. */
// @does A bank account and marks (accept, undo, note, attach) in -> we append them to that account's reconciliation log -> the saved marks (editors).
router.post('/bank/marks', auth, noKey, editor, on, ...checked('POST /bank/marks'), async (req, res) => {
  try {
    const e = ctx(req),
      body = req.body || {};
    const marks = await withEntity(e, async (handle) => BANK_LOG.appendMarks(handle, e, await bankAccountOf(handle, e, body.account), body, byOf(req), actingOf(req)));
    res.status(201).json({ marks });
  } catch (err) {
    if (err && err.code === 'BOOKS_NOT_MIGRATED') return problem(req, res, { status: 503, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* before b864: the shared record is not set up, in words (the same answer refusalOf gives) */
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /bank/statements { account, period_from, period_to, opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, file_hash } → { statement } — editor; the carried BRS figures, a re-sign is a new row. */
// @does A bank account with its period, opening and closing balances in -> we store the reconciled statement in the log -> the saved statement (editors).
router.post('/bank/statements', auth, noKey, editor, on, ...checked('POST /bank/statements'), async (req, res) => {
  try {
    const e = ctx(req),
      body = req.body || {};
    const statement = await withEntity(e, async (handle) => BANK_LOG.appendStatement(handle, e, await bankAccountOf(handle, e, body.account), curOf(req), body, byOf(req), actingOf(req)));
    res.status(201).json({ statement });
  } catch (err) {
    if (err && err.code === 'BOOKS_NOT_MIGRATED') return problem(req, res, { status: 503, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* before b864: the shared record is not set up, in words (the same answer refusalOf gives) */
    if (err && err.code === 'CURRENCY_MISMATCH') return problem(req, res, { status: 409, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message, field: err.field } }); /* a statement in another currency than the account's (the same answer refusalOf gives) */
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /bank/log?account&from&to[&marks_limit=0..5000&marks_before=<seq>] → (marks: the newest marks_limit, oldest first, marks_next = the cursor of the next older page or null) { currency, account: { account_id, code, name }, marks (oldest first), statements (newest first), posted: [{ ref, entry_no, posting_date, made_at, made_by }] (the bank lines already posted, both ref forms), exceptions: [{ code: POSTED_NOT_ACCEPTED, entry_no, amount_minor, currency, … }] } — any login with the Ledger on. One transaction. */
// @does A bank account and dates in -> we read its reconciliation marks, signed statements, the bank lines already posted (who and when) and exceptions -> the log.
router.get('/bank/log', auth, noKey, on, ...checked('GET /bank/log'), async (req, res) => {
  try {
    const e = ctx(req),
      from = req.query.from ? dateQ(req.query.from) : null,
      to = req.query.to ? dateQ(req.query.to) : null,
      marksPage = BANK_LOG.marksPageOf(req.query); /* the NEWEST marks, a page of at most 5000; marks_limit=0 reads none (the Bank home) */
    if (await costBlindStops(req, res, e)) return;
    const out = await withEntity(e, async (handle) => {
      const account = await bankAccountOf(handle, e, req.query.account);
      return Object.assign({ account: { account_id: account.account_id, code: account.code, name: account.name } }, await BANK_LOG.read(handle, e, account, from, to, marksPage));
    });
    res.json(Object.assign({ currency: curOf(req) }, out));
  } catch (err) {
    if (err && err.code === 'BOOKS_NOT_MIGRATED') return problem(req, res, { status: 503, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* before b864: the shared record is not set up, in words (the same answer refusalOf gives) */
    problem(req, res, refusalOf(err, req));
  }
});
/* ── l16 · THE STATEMENTS BOX (lib/bank-statement-file, b872): a bank statement kept against a bank account and a period; the page's own bank list names the accounts, the page's own reader reads the file (no parse here). ── */
const BSF = require('../lib/bank-statement-file');
const BSP = require('../lib/bank-statement-page');
/** a refusal of the box as a verdict: its code and the line the box wrote (BSF.verdictOf), with the old {error, message, field, existing_id} keys beside it; the exception's own text is never sent */
const statementBody = (box) => ({ code: box.code, detail: box.line, legacy: { code: box.code, error: box.line, message: box.line, field: box.field, existing_id: box.existing_id } });
/** a refusal of the box answers as its verdict (its own status, code and written line); anything else is the books' general mapping */
function statementFail(req, res, err) {
  const box = BSF.verdictOf(err);
  if (box) return problem(req, res, Object.assign({ status: box.status }, statementBody(box)));
  return problem(req, res, refusalOf(err, req));
}
/** the writer's stamp from the SESSION and the live grant (never the body): { user, name, firm, grant_id } */
const stampOfReq = (req) => Object.assign({ user: byOf(req), name: (req.identity && req.identity.display_name) || null, firm: null, grant_id: null }, actingOf(req) ? { firm: actingOf(req).firm, grant_id: actingOf(req).grant_id } : {});
/** POST /bank/statement-files { account, label?, period_from, period_to, currency, sha256, name, text } → 201 { file, overlaps: [{ id, name, period_from, period_to }], words } — the owner, or an adviser under a live grant (X-Books-Role: adviser). csv/json/txt, at most 6 MB; the sha256 is of the UTF-8 text and is recomputed here (HASH_MISMATCH); the same file on the same account is ALREADY_IN_BOX 409; a crossing period is stored with overlaps: true and the answer says so; another currency than the account's is CURRENCY_MISMATCH 409. */
// @does A bank account, its period, the file's text and its sha256 in -> we keep the file against that account and period (duplicate refused, overlap flagged) -> the kept file.
router.post('/bank/statement-files', auth, noKey, editor, on, ...checked('POST /bank/statement-files'), async (req, res) => {
  try {
    const e = ctx(req),
      body = req.body || {};
    if (!body.account) return statementFail(req, res, BSF.refuse('Which bank account is this statement for? Pick one before it is kept.', 'ACCOUNT_NEEDED', 400));
    const account = await withEntity(e, (handle) => bankAccountOf(handle, e, body.account));
    res.status(201).json(await BSF.add(withEntity, e, account, curOf(req), body, stampOfReq(req)));
  } catch (err) {
    const box = BSF.verdictOf(err); /* the box's own refusals that are not a bad question, each with its status named here: the same file twice, a file over 6 MB, a type that is no statement, the box not ready or the file not kept */
    if (box && box.status === 409) return problem(req, res, { status: 409, ...statementBody(box) });
    if (box && box.status === 413) return problem(req, res, { status: 413, ...statementBody(box) });
    if (box && box.status === 415) return problem(req, res, { status: 415, ...statementBody(box) });
    if (box && box.status === 503) return problem(req, res, { status: 503, ...statementBody(box) });
    statementFail(req, res, err);
  }
});
/** GET /bank/statement-files?accounts=<codes>&months=6&to=YYYY-MM[&limit=25&after=<cursor>&q=<search>] (a limit pages the files, newest first: lib/bank-statement-page; the cells and the count always cover the whole window) → { currency, months, accounts: [{ account_id, code, name, label }], cells: [{ account_id, month, missing, file_ids }], files: [{ id, account_id, label, period_from, period_to, name, size, source, overlaps, by_name, by_firm, for_client, added_at, read_at, reads }], older } — the page's own bank list names the accounts; a month with no file reads missing. Two reads. */
// @does A list of bank accounts and a run of months in -> we say which statement files are kept for each account and month, and which months are missing -> the account by month list.
router.get('/bank/statement-files', auth, noKey, on, ...checked('GET /bank/statement-files'), async (req, res) => {
  try {
    const e = ctx(req),
      months = BSF.windowOf(req.query, today(req)),
      asked = String(req.query.accounts || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 60);
    if (await costBlindStops(req, res, e)) return;
    const out = await withEntity(e, async (handle) => {
      const chart = await S.accounts(handle, e);
      const accounts = asked.map((key) => BANK_LOG.accountIn(chart, key)).filter((item, at, all) => item && all.indexOf(item) === at);
      if (req.query.limit != null) return BSP.list(handle, e, { accounts, chart, months, limit: req.query.limit, after: req.query.after, q: req.query.q });
      return BSF.list(handle, e, { accounts, chart, months });
    });
    res.json(Object.assign({ currency: curOf(req) }, out));
  } catch (err) {
    const box = BSF.verdictOf(err);
    if (box && box.status === 503) return problem(req, res, { status: 503, ...statementBody(box) }); /* the box is not set up yet: in words, nothing lost */
    statementFail(req, res, err);
  }
});
/** GET /bank/statement-files/:id/file?use=read|download → the kept file's bytes (nosniff, a download, never cached: a revoked grant stops at the next request). `use=read` is the Bank page loading it into its reader. The owner and the adviser write the event; an auditor's look is the grant's own log. */
// @does A kept statement's id in -> we serve its bytes and record who opened it -> the file.
router.get('/bank/statement-files/:id/file', auth, noKey, on, ...checked('GET /bank/statement-files/:id/file'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (await costBlindStops(req, res, e)) return;
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such statement.');
    const out = await BSF.open(withEntity, e, id, req.query.use === 'read' ? 'read' : 'download', stampOfReq(req));
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such statement in this shop.');
    require('../lib/attachment-send').sendBlob(res, out.file, { cache: 'private, no-store' });
  } catch (err) {
    const box = BSF.verdictOf(err);
    if (box && box.status === 503) return problem(req, res, { status: 503, ...statementBody(box) }); /* the box is not set up yet, or the bytes could not be opened: in words, nothing lost */
    statementFail(req, res, err);
  }
});
/**
 * PATCH /payments/:id { advice_chit_id? | advice_shared_at?: true | ISO } (M30, SPEC §4.3) — a merge-patch of the NAMED fields only, after the chit was sent
 *   (advice_chit_id) or the words were shared off-rail (advice_shared_at). → { ok, payment_id, advice: { chit_id, state, shared_at } }
 * ⭐ ONE ADVICE PER PAYMENT: the same advice_chit_id again → 200 (first-wins, idempotent); a different one → 409 ADVICE_EXISTS "An advice is already recorded for this payment."
 * ⭐ THE SAME RULE THE READ PAINTS (B.adviceMay): a viewer / commenter → 403 with the rail engine's sentence; reversed · a held cheque · not posted · off rail (send) /
 *   on rail (share) → 409 with the words. Before b285 runs → 503 BOOKS_NOT_MIGRATED "Advice not available yet…". Co-assist allowed (as record is).
 */
// @does A payment id and an advice chit in -> we link or unlink the advice that went with that payment -> the payment's advice state.
router.patch('/payments/:id', auth, noKey, onceOnly, on, ...checked('PATCH /payments/:id'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id),
      b = req.body || {};
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such payment.');
    const chit = b.advice_chit_id != null ? String(b.advice_chit_id) : null;
    if (chit && !UUID.test(chit)) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Which advice chit?', 'Which advice chit?');
    let shared = null;
    if (b.advice_shared_at === true) shared = CLOCK.now().toISOString();
    else if (b.advice_shared_at != null) {
      const t = Date.parse(String(b.advice_shared_at));
      if (!Number.isFinite(t)) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'When was it shared?', 'When was it shared?');
      shared = new Date(t).toISOString();
    }
    if (!chit && !shared) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Nothing to change.', 'Nothing to change — advice_chit_id or advice_shared_at.');
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return { status: 404, error: 'Not found', words: 'No such payment.' };
      const ready = await S.adviceReady(h, e);
      if (!ready) return { status: 503, code: 'BOOKS_NOT_MIGRATED', words: B.adviceMay({ level: 'editor', ready: false }).send_advice.say };
      const a = await B.adviceFor(h, e, p, { level: levelOf(req), me: await meName(req, h, e), names: await partyNames(h, e), ready });
      const v = chit ? a.may.send_advice : a.may.share_advice;
      /* the same chit again is a replay (200), not a refusal; a DIFFERENT chit on a payment that sent one is the §4.3 409 */
      if (chit && v.why === 'already_sent' && a.advice.chit_id && a.advice.chit_id !== chit)
        return { status: 409, code: 'ADVICE_EXISTS', words: 'An advice is already recorded for this payment.', advice_chit_id: a.advice.chit_id };
      if (!v.ok && !(chit && v.why === 'already_sent' && a.advice.chit_id === chit))
        return { status: /^(read_only|comment_only)$/.test(v.why) ? 403 : 409, code: v.why.toUpperCase(), why: v.why, words: v.say };
      const r = await S.setAdvice(h, e, id, { advice_chit_id: chit, advice_shared_at: shared });
      if (!r) return { status: 404, error: 'Not found', words: 'No such payment.' };
      if (r.conflict) return { status: 409, code: 'ADVICE_EXISTS', words: 'An advice is already recorded for this payment.', advice_chit_id: r.advice_chit_id };
      const cs = r.advice_chit_id ? (await S.adviceStates(h, e, [r.advice_chit_id]))[r.advice_chit_id] : null;
      return {
        status: 200,
        body: {
          ok: true,
          payment_id: id,
          advice: {
            chit_id: r.advice_chit_id || null,
            state: B.adviceState(r, cs),
            shared_at: r.advice_shared_at ? new Date(r.advice_shared_at).toISOString() : null
          }
        }
      };
    });
    if (out.status !== 200) {
      /* the old body, key for key: error, message, and the code, why and advice_chit_id only when there is one */
      const legacy = Object.assign({ error: out.error || out.words, message: out.words }, out.why ? { why: out.why } : {}, out.advice_chit_id ? { advice_chit_id: out.advice_chit_id } : {});
      return problem(req, res, { status: out.status, code: out.code || 'NOT_FOUND', detail: out.words, legacy });
    }
    res.json({ ok: out.body.ok, payment_id: out.body.payment_id, advice: out.body.advice });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /payments/:id/propose → { proposal: [{ against_ref, bill_no, due_date, open_minor, apply_minor, disputed }], on_account_minor } — B.proposeFor, the one function */
// @does A payment id in -> we propose which open bills it should settle, oldest first -> the proposed lines and the amount left on account (editors).
router.post('/payments/:id/propose', auth, noKey, editor, on, ...checked('POST /payments/:id/propose'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return null;
      const prop = await B.proposeFor(h, e, {
        party: p.party_id,
        direction: p.direction,
        amount_minor: p.amount_minor,
        currency: p.currency,
        credit_ref: 'pay:' + id
      });
      return {
        proposal: prop.proposal,
        open_minor: prop.open_minor,
        apply_minor: prop.apply_minor,
        on_account_minor: prop.items.length ? prop.on_account_minor : 0,
        skipped: prop.skipped,
        why: prop.why,
        direction: p.direction
      };
    });
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    res.json(await forPayer(req, e, 'propose', out.direction, { payment_id: id, proposal: out.proposal, open_minor: out.open_minor, apply_minor: out.apply_minor, on_account_minor: out.on_account_minor, skipped: out.skipped, why: out.why }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * FIN-63 step 2: the confirm's list read RAW, before it becomes money (never inside the shared writeAllocation: settleBills and Mark-paid use that,
 * and a throw there rolls a payment back). → { words } for a 422, or { pairs }: against_ref TRIMMED (the hash and the engine take this one value),
 * amount_minor a whole non-negative number read BEFORE any Math.round (a fraction is refused, never rounded), one line per bill.
 */
function confirmPairs(list) {
  const seen = new Set(),
    pairs = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { words: 'Each line names a bill and an amount.' };
    const against_ref = String(item.against_ref == null ? '' : item.against_ref).trim(),
      amount = Number(item.amount_minor);
    if (!against_ref) return { words: 'Each line names the bill it settles.' };
    if (!Number.isInteger(amount)) return { words: 'Each amount is a whole number in paise/cents.' };
    if (amount < 0) return { words: 'An amount cannot be negative.' };
    if (seen.has(against_ref)) return { words: 'Bill ' + against_ref + ' is listed twice; give it one amount.' };
    seen.add(against_ref);
    pairs.push({ against_ref, amount_minor: amount });
  }
  return { pairs };
}
/** a payment's own money steps (R-1400), after the posting committed; never able to undo it */
async function confirmSteps(req, e, id, pairs) {
  try {
    const payment = await withEntity(e, (db) => S.payment(db, e, id));
    const billPrivacy = require('../lib/bill-privacy');
    await billPrivacy.moneySteps(e, payment, pairs, { id: byOf(req), name: (req.identity && req.identity.display_name) || null }, (failure) => billPrivacy.raiseStepTicket(e, payment, failure)); /* FIN-71 */
  } catch (e2) {
    logger.error('books confirm: the R-1400 money steps failed after the posting committed — the books are right, the history step is missing', { id: req.id, payment_id: id, err: e2.message });
  }
}
/**
 * POST /payments/:id/confirm { allocations: [{ against_ref, amount_minor }] } — CBReceivables.confirmItems decides (disputed frozen, never more than open).
 * ⭐ FIN-63 step 2: the SAME allocation pressed again (the payment's latest live batch, within books-replay.ALLOC_REPLAY_WINDOW_MS) answers
 * 200 { ok, duplicate: true, items, allocated_minor } from the stored rows and posts nothing; a first posting carries no `duplicate` key.
 */
// @does A payment id and the chosen allocations in -> we post the settlement of those bills once, a repeat answers the first -> the allocated items (editors).
router.post('/payments/:id/confirm', auth, noKey, editor, onceOnly, on, ...checked('POST /payments/:id/confirm'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const read = confirmPairs(Array.isArray((req.body || {}).allocations) ? req.body.allocations : []);
    if (read.words) return refuse(req, res, 422, 'BOOKS_REFUSED', read.words);
    const out = await withEntity(e, async (h) => {
      const p = await S.payment(h, e, id);
      if (!p) return null;
      return B.postEntry(h, e, {
        type: 'allocation',
        party: p.party_id,
        side: p.direction === 'in' ? 'customer' : 'supplier',
        credit_ref: 'pay:' + id,
        payment_id: id,
        allocations: read.pairs,
        replay: true,
        currency: p.currency,
        by: byOf(req)
      });
    });
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    /* a replay skips the money steps ON PURPOSE: moneySteps has no replay key, so a re-run would write each R-1400 step twice (lib/books-replay.js) */
    if (out.duplicate) return res.json({ ok: out.ok, duplicate: true, items: out.items, allocated_minor: out.allocated_minor });
    /* ⭐ a payment against a BILL is a step of R-1400 — written at its messaging level (lib/bill-privacy): my history, and the
       other party's too while R-1400 is external (a remittance advice). After the posting committed; never able to undo it. */
    await confirmSteps(req, e, id, read.pairs);
    res.json({ ok: out.ok, off: out.off, items: out.items, allocated_minor: out.allocated_minor });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * GET /cheques[?all=1] → { currency, cheques: [{ payment_id, party_id, party_no, name, direction, amount_minor, currency,
 *   reference, cheque_no, cheque_bank, cheque_date, received_at, status: received|deposited|cleared|bounced, next: [...] }] }
 * The cheques still HELD (with ?all=1, every cheque) — what a "Cheques held" list shows. `next` is the steps the ENGINE
 * will accept now (CBReceivables.itemsOfCheque decides — received → deposited → cleared | bounced); a screen offers those.
 * ⭐ F3: + pdc_reminders: [{ payment_id, cheque_no, cheque_date, amount_minor, state: deposit_today | overdue_for_deposit | not_yet }] — the post-dated
 *   cheques RECEIVED and not yet deposited, as CBReceivables.pdcReminders says them (today's shop day; `not_yet` only within lead_days). Read from the
 *   same rows as `cheques`, no second query.
 * ⭐ T3-P1-MONEY: + asOf (the shop's day the states were judged on) and remind: { on, lead_days, from: 'shop'|null, may_set, why_not } — the OWNER's switch,
 *   read from the shop's stored terms (lib/finance-terms pdcRemind: books_setting.terms.pdc_remind, set through POST /terms); absent = on, 7 days ahead, as
 *   before. `on` false → pdc_reminders is [] (the engine answers null). One more statement in the SAME transaction (shopTerms), only once b298 has run.
 */
// @does Optionally all in -> we read the cheques received and issued with their status and reminders for post-dated ones -> the cheque list.
router.get('/cheques', auth, noKey, on, ...checked('GET /cheques'), async (req, res) => {
  try {
    const e = ctx(req),
      all = String(req.query.all || '') === '1',
      T = require('../lib/finance-terms'),
      may = isOwner(req);
    const mig = await T.migrated();
    const out = await withEntity(e, async (h) => {
      const rows = await S.cheques(h, e, all, 200);
      const remind = T.pdcRemind(mig ? await T.shopTerms(h, e) : {});
      const pids = Array.from(new Set(rows.map((item) => String(item.party_id))));
      const names = await partyNames(h, e, pids),
        chart = await S.accounts(h, e),
        R = E.receivables(),
        kept = new Map(),
        day = today(req);
      /* PERF1: every listed party's items on each control account in ONE read per account (≤ 2) — it was one read per party inside the loop (N+1) */
      for (const role of ['debtors', 'creditors']) {
        const a = chart.find((x) => x.role === role),
          ids = Array.from(new Set(rows.filter((item) => (item.direction === 'in') === (role === 'debtors')).map((item) => String(item.party_id))));
        if (!a || !ids.length) continue;
        ids.forEach((pid) => kept.set(pid + '|' + a.account_id, []));
        (await S.items(h, e, ids, a.account_id)).forEach((item) => {
          const k = String(item.party_id) + '|' + a.account_id;
          if (kept.has(k)) kept.get(k).push(E.itemOf(item));
        });
      }
      const list = [];
      /* the engine's credit shape ({ id, amount, cheque: { no, date, status } }) from the same rows; the amount back from the row by id, so no second rounding */
      const byId = new Map(rows.map((item) => [String(item.payment_id), item]));
      const pdc = (
        R.pdcReminders(
          rows
            .filter((item) => item.direction === 'in')
            .map((item) => ({
              id: String(item.payment_id),
              amount: Number(item.amount_minor),
              cheque: { no: item.cheque_no || null, date: E.ymd(item.cheque_date), status: item.status || 'received' }
            })),
          day,
          { on: remind.on, lead_days: remind.lead_days }
        ) || []
      ).map((item) => {
        const c = byId.get(String(item.credit)) || {};
        return { payment_id: item.credit, cheque_no: item.no, cheque_date: item.date, amount_minor: Number(c.amount_minor || 0), state: item.state };
      });
      for (const c of rows) {
        const a = chart.find((x) => x.role === (c.direction === 'in' ? 'debtors' : 'creditors'));
        const k = c.party_id + '|' + (a ? a.account_id : '');
        if (!kept.has(k)) kept.set(k, []);
        const next = ['deposited', 'cleared', 'bounced'].filter((to) => {
          try {
            R.itemsOfCheque(kept.get(k), 'pay:' + c.payment_id, to, day);
            return true;
          } catch (notNext) {
            logger.fellBack('books cheques: not a next step for this cheque — not offered', notNext, 'debug');
            return false;
          }
        });
        const p = names.get(String(c.party_id)) || {};
        list.push({
          payment_id: c.payment_id,
          party_id: c.party_id,
          party_no: p.party_no || null,
          name: p.nickname || p.name || null,
          direction: c.direction,
          amount_minor: Number(c.amount_minor),
          currency: c.currency,
          reference: c.reference || null,
          cheque_no: c.cheque_no || null,
          cheque_bank: c.cheque_bank || null,
          cheque_date: E.ymd(c.cheque_date),
          received_at: E.ymd(c.received_at),
          status: c.status || 'received',
          next
        });
      }
      return { list, pdc, remind, day };
    });
    res.json(await forBooksDoor(req, e, 'cheques', {
      currency: curOf(req),
      asOf: out.day,
      cheques: out.list,
      pdc_reminders: out.pdc,
      remind: {
        on: out.remind.on,
        lead_days: out.remind.lead_days,
        from: out.remind.from,
        may_set: may,
        why_not: may ? null : 'Only the owner may set the reminder.'
      }
    }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * POST /cheques/:id/status { status: deposited|cleared|bounced, date? } — :id is the cheque's payment_id.
 *   deposited → { ok, status: 'deposited', items: 1 }
 *   cleared   → { ok, status: 'cleared', items: 2, posted: { ok, entry_id, entry_no, posting_date, doc_date, moved, lines, items, note } }  (the entry posts NOW)
 *   bounced   → { ok, status: 'bounced', items: 1 }  (a cheque that never cleared never counted: no entry)
 * Out of order (received → deposited → cleared | bounced) → 422 with the engine's sentence; not a cheque → 404.
 */
// @does A cheque id and deposited, cleared or bounced in -> we move the cheque on in order and post it when it clears -> the new status (editors).
router.post('/cheques/:id/status', auth, editor, on, ...checked('POST /cheques/:id/status'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id),
      b = req.body || {};
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const to = ['deposited', 'cleared', 'bounced'].indexOf(b.status) >= 0 ? b.status : null;
    if (!to) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Deposited, cleared or bounced?', 'Deposited, cleared or bounced?');
    const out = await B.postEntry(null, e, { type: 'cheque_step', payment_id: id, to, date: dateQ(b.date, today(req)), strict_date: true, by: byOf(req) });
    res.json({ ok: out.ok, off: out.off, status: out.status, items: out.items, posted: out.posted, reversed: out.reversed });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * the books' one word for a held bill, as the row says it (R106: "Hold this bill" on ANY supplier reuses this status — the engine knows
 * disputed / undisputed and no `held`; a screen paints these words, never its own)
 */
const STATUS_WORDS = require('../lib/books-payables').STATUS_WORDS;
/**
 * POST /parties/:id/dispute { against_ref, disputed: true|false, side, note } → { ok, status: disputed|undisputed, words, against_ref }
 * — a disputed bill cannot take a payment (C4); Payables and cash-flow leave it out until it is released
 */
// @does A party, a bill and disputed true or false in -> we mark or release that bill as disputed so it takes no payment -> the updated bill state (editors).
router.post('/parties/:id/dispute', auth, editor, on, ...checked('POST /parties/:id/dispute'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id),
      b = req.body || {};
    if (!UUID.test(id) || !b.against_ref) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Which bill?', 'Which bill?');
    const status = b.disputed === false ? 'undisputed' : 'disputed';
    const posted = await B.postEntry(null, e, {
      type: 'party_status',
      party: id,
      side: b.side === 'supplier' ? 'supplier' : 'customer',
      against_ref: String(b.against_ref),
      status,
      note: b.note ? String(b.note).slice(0, 300) : null,
      currency: curOf(req),
      by: byOf(req)
    });
    const said = posted.ok && !posted.off ? { words: STATUS_WORDS[status], against_ref: String(b.against_ref) } : {}; /* the words ride only on a status the books wrote */
    res.json({ ok: posted.ok, off: posted.off, status: posted.status, words: said.words, against_ref: said.against_ref });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── the "＋ Entry" door: the grid, the preview, the everyday events ───────────────────────────────────────────── */
const M = () => require('../lib/books-manual');
/** GET /events → { events: [{ kind, words, icon, band, voucher, fields, ledger_group, preview, post | route }], picks, pending, golden } — the grid; the screen holds no rules */
// @does Nothing in -> we list the kinds of manual entry the shop can post and their fields -> the grid of events.
router.get('/events', auth, noKey, on, ...checked('GET /events'), (req, res) => {
  try {
    const grid = M().catalogue(req.books);
    res.json({ events: grid.events, picks: grid.picks, pending: grid.pending, golden: grid.golden });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * POST /preview { event: { kind, …fields } } (or { event: 'kind', …fields }) → { ok, voucher: { series, type }, lines: [{ code, ledger, dr_minor, cr_minor, type, rule }], balanced, refusals, … }
 * Composed by lib/books.js composeEntry — the writer's own function. Writes nothing, takes no counter. A co-assist may preview; only the owner posts.
 */
// @does A manual event and its fields in -> we compose the journal as it would post, posting nothing -> the lines, totals and whether it balances.
router.post('/preview', auth, noKey, on, ...checked('POST /preview'), async (req, res) => {
  try {
    const out = await M().preview(ctx(req), req.books, req.body || {}, { owner: isOwner(req), by: byOf(req) });
    res.json({ ok: out.ok, kind: out.kind, voucher: out.voucher, date: out.date, lines: out.lines, balanced: out.balanced, totals: out.totals, credit: out.credit, bill: out.bill, flags: out.flags, refusals: out.refusals, code: out.code, duplicate: out.duplicate });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /events { event: kind, …fields, client_ref } → the entry (MJ/<fy>/<n>, its voucher type kept). Owner only; the same client_ref answers the first entry, duplicate: true. */
// @does A manual event with its fields and a client_ref in -> we post it once as a journal entry -> the entry number (owner only).
router.post('/events', auth, noKey, owner, on, ...checked('POST /events'), async (req, res) => {
  try {
    const out = await M().post(ctx(req), req.books, req.body || {}, byOf(req));
    res.json({ kind: out.kind, ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: out.note });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── owner writes: manual entry, reversal, write-off, opening, months ────────────────────────────────────────── */
const givenLines = (list, currency) => require('../lib/books-manual').givenLines(list, currency); /* ONE reader of a typed journal's lines — the ＋ Entry builder uses it too */
// @does Typed journal lines in -> we post them as a manual journal entry -> the entry (owner only).
router.post('/entries', auth, owner, on, ...checked('POST /entries'), async (req, res) => {
  try {
    const b = req.body || {};
    /* against_ref (F4): the bill this journal settles — postEntry sets the party line against it (itemsFor → confirmItems), as a write-off does.
       CB Finance · Payables sends the early-pay discount this way: Dr the supplier against the bill · Cr Discount received (books-payables.view `record`). */
    const out = await B.postEntry(null, ctx(req), {
      type: 'manual',
      owner: true,
      narration: b.narration,
      date: dateQ(b.date, today(req)),
      currency: curOf(req),
      strict_date: true,
      lines: givenLines(b.lines, curOf(req)),
      ref: b.ref || null,
      source_ref: b.client_ref ? 'manual:' + String(b.client_ref).slice(0, 80) : null,
      by: byOf(req),
      against_ref: b.against_ref ? String(b.against_ref).slice(0, 120) : null
    });
    /* the writer's answer, key for key (a replay has duplicate and no doc_date; a switched-off ledger has off): named so the allow-list reads them */
    res.json({ ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: out.note });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /entries/:id/reverse { reason } → the mirror entry (never an edit) and, in the SAME transaction, the party rows that reopen the bills it had settled:
 *  { ok, entry_id, entry_no, posting_date, moved, reverses, reverses_entry_id, items, reopened: [{ against_ref, bill_no }], words }.
 *  M29: an entry already reversed answers 409 ALREADY_REVERSED naming the reversal (a second Reverse is not a replay — it would be a second correction). */
// @does An entry id and a reason in -> we post its reversal and reopen the bills it settled, refusing a second reversal -> the reversal entry (owner only).
router.post('/entries/:id/reverse', auth, owner, on, ...checked('POST /entries/:id/reverse'), LiveBill.refuseLiveBill, async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const r = await B.reverseEntry(null, ctx(req), String(req.params.id), { by: byOf(req), reason: (req.body || {}).reason });
    if (r && r.duplicate) {
      const m = 'This entry was already reversed by ' + r.entry_no + '.';
      return problem(req, res, { status: 409, code: 'ALREADY_REVERSED', detail: m, legacy: { error: 'Already reversed', message: m, entry_no: r.entry_no, entry_id: r.entry_id } });
    }
    res.json({ ok: r.ok, off: r.off, entry_id: r.entry_id, entry_no: r.entry_no, posting_date: r.posting_date, moved: r.moved, reverses: r.reverses, reverses_entry_id: r.reverses_entry_id, items: r.items, reopened: r.reopened, words: r.words });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A customer and an amount in -> we post a bad-debt write-off once per client_ref -> the entry (owner only).
router.post('/write-off', auth, owner, on, ...checked('POST /write-off'), async (req, res) => {
  try {
    const b = req.body || {};
    const party = String(b.party_id || b.party || '');
    if (!UUID.test(party)) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Which customer?', 'Which customer?');
    /* ⭐ client_ref → source_ref: the same write-off pressed twice is ONE entry (it was two — critic M11); the second answers
       200 with the first entry and duplicate: true. Its party document carries the same ref, so it too is one. */
    const ref = b.client_ref ? String(b.client_ref).slice(0, 80) : null;
    const writeOffMinor = minorOf(b, curOf(req)); /* a plain 400 "How much?" when it is not a whole number above nothing (the write-off posts nothing for 0 either) */
    const out = await B.postEntry(null, ctx(req), {
      type: 'write_off',
      owner: true,
      party,
      amount: cashflow().fromMinor(writeOffMinor, curOf(req)) /* ACC-179: was / 100 — a ¥500 write-off posted ¥5 */,
      reason: b.reason,
      currency: curOf(req),
      strict_date: true,
      date: dateQ(b.date, today(req)),
      against_ref: b.against_ref ? String(b.against_ref) : null,
      source_ref: ref ? 'wo:' + ref : null,
      doc_ref: 'wo:' + party + ':' + (ref || CLOCK.nowMs()),
      by: byOf(req)
    });
    res.json({ ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: out.note });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * POST /opening { date?, rows: [{ code, party_no?, dr_minor, cr_minor, bill_ref?, due_date? }] } → { entry_no, suspense_minor, lines }
 * ONE entry, period 0 (is_opening). A party row names its bill (bill_ref) so dues are bill-wise from day one; any
 * difference goes to Suspense 2900, which must be nil before the year can close (Tally, ERPNext opening entry).
 */
// @does Opening balance rows in -> we post the opening entry, with any difference going to Suspense -> the entry (owner only).
router.post('/opening', auth, owner, on, ...checked('POST /opening'), async (req, res) => {
  try {
    const e = ctx(req),
      b = req.body || {},
      cur = curOf(req);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'No rows.', 'No rows.');
    const bad = rows.map((item, index) => (Number(item.dr_minor) > 0 === Number(item.cr_minor) > 0 ? index + 1 : 0)).filter(Boolean);
    if (bad.length)
      return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Row ' + bad.join(', ') + ': one amount — a debit or a credit, not both.', 'Row ' + bad.join(', ') + ': one amount — a debit or a credit, not both.');
    /* ⭐ IM1: the entry itself is lib/books postOpening — the move-in importer posts a trial balance and the open bills through the same door */
    const opening = { rows, date: dateQ(b.date, fyStart(req, today(req))), currency: cur, client_ref: b.client_ref, by: byOf(req) };
    const out = await withEntity(e, (h) => (b.require_balanced === true ? require('../lib/books-opening').postTyped(h, e, opening) : B.postOpening(h, e, opening))); /* l16: the page's save checks its bills and refuses a difference */
    res.json({ ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: out.note, suspense_minor: out.suspense_minor });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/* ── MOVE IN FROM XERO / QUICKBOOKS (IM1) — three doors, owner only, the ledger on: the columns guessed, the dry run, the import (lib/move-in) ── */
const MI = require('../lib/move-in');
/** what every move-in door reads from the body: the file (csv | xlsx + sheet / header_row), which export (kind), which system (source), the side, the move date,
 *  ⭐ W1.1b the country the OWNER states the file is from (source_country, two letters — checked against the shop's by lib/move-in-gate, kept in the proof)
 *  and W1.4 their company id when they know it (source_company: QBO realm · Xero organisation · Zoho organization) */
function moveInBody(req) {
  const body = req.body || {};
  const kind = MI.kindOf(body.kind),
    source = MI.sourceOf(body.source);
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
    { kind, source, side, as_at, parsed: MI.readFile(body), decisions: body.decisions, client_ref: body.client_ref ? String(body.client_ref).slice(0, 80) : null },
    moveInOrigin(body)
  );
}
/** where the owner says the books come from: the country as given (lib/move-in-gate judges it) and their company id, each cut to size or null */
function moveInOrigin(body) {
  const sized = (value, size) => (value == null ? null : String(value).slice(0, size));
  return { source_country: sized(body.source_country, 60), source_company: sized(body.source_company, 80) };
}
/** POST /move-in/preflight { kind, source, csv | xlsx, sheet?, header_row? } → { kind, source, headers, fields, guess: [{ incoming, field, how, confidence, why }], missing, ready, rows_total, sample, sheet, sheets, header_row } — reads nothing of the shop; nothing is written */
// @does A customer, supplier or item file from another package in -> we read its columns and guess which field each is -> the headers, guesses and sample rows (owner only).
router.post('/move-in/preflight', auth, owner, on, ...checked('POST /move-in/preflight'), async (req, res) => {
  try {
    const { kind, source, parsed } = moveInBody(req);
    const g = MI.guess(kind, parsed.headers);
    res.json({
      kind,
      source,
      headers: parsed.headers,
      fields: g.fields,
      guess: g.guess,
      missing: g.missing,
      ready: g.ready,
      rows_total: parsed.rows.length,
      sample: parsed.rows.slice(0, 5),
      sheet: parsed.sheet || null,
      sheets: parsed.sheets || null,
      header_row: parsed.headerRow || 1
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** the plan for a confirmed file: the world read once (chart · parties · tax ids · phones · products), then the pure dry run */
async function moveInPlan(req, db) {
  const e = ctx(req),
    moveInRequest = moveInBody(req);
  /* ⭐ ACC-329: the dry run refuses a future date as the import does (a trial balance or open bills post as an opening; lib/books openingDateGate) */
  if (moveInRequest.kind === 'trial_balance' || moveInRequest.kind === 'open_bills') B.openingDateGate(req.books, moveInRequest.as_at);
  const rows = MI.cells(moveInRequest.kind, moveInRequest.parsed, moveInRequest.decisions);
  const world = await MI.world(db, e, moveInRequest.kind, req.books, { source: moveInRequest.source, side: moveInRequest.side, rows });
  const plan = MI.plan(moveInRequest.kind, {
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
/** POST /move-in/preview { kind, source, source_country, source_company?, csv | xlsx, decisions: [{ incoming, field }], side?, as_at? } → { kind, source, side, as_at, counts: { add, merge, skip, hold }, rows: [{ line, what, action, why, data, code? }], refusal, notes, country: { shop, source, how }, company_id, tax_codes? } — the DRY RUN; nothing is written. A country refusal: 422 { code: MOVE_IN_COUNTRY · _UNSTATED · _WORD · MOVE_IN_FOREIGN · MOVE_IN_COMPANY } */
// @does The file and the owner's column choices in -> we plan the move-in without writing anything -> what would be added, merged, skipped or held (owner only).
router.post('/move-in/preview', auth, owner, on, ...checked('POST /move-in/preview'), async (req, res) => {
  try {
    const { m, pl } = await withEntity(ctx(req), (h) => moveInPlan(req, h));
    res.json(Object.assign({ kind: m.kind, source: m.source, side: m.side, as_at: m.as_at }, pl));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /move-in/import { …as preview, confirm: true } → { kind, source, side, as_at, added, merged, skipped, held, rows: [the skipped and the held, with why (+ code)], notes, entry?,
 *  source_code_written?, proof, proof_stored, import_id } — ONE transaction; a refusal writes nothing (422 with the code and the sentence) */
// @does The same file with confirm true in -> we add and merge the parties or items in one transaction and keep a match proof -> the counts and the proof (owner only).
router.post('/move-in/import', auth, owner, on, ...checked('POST /move-in/import'), async (req, res) => {
  try {
    if ((req.body || {}).confirm !== true)
      return refuse(req, res, 400, 'BOOKS_BAD_REQUEST', 'Not confirmed', 'Nothing was imported — this needs an explicit confirmation.');
    const e = ctx(req);
    const out = await withEntity(e, async (h) => {
      const { m, pl, w } = await moveInPlan(req, h);
      const r = await MI.apply(h, e, pl, { world: w, setting: req.books, by: byOf(req), as_at: m.as_at, currency: curOf(req), client_ref: m.client_ref });
      return Object.assign({ side: m.side, as_at: m.as_at }, r);
    });
    MI.afterCommit(e, out); /* committed: only now the items are metered (a refusal above threw, so a rolled-back move-in meters nothing) */
    res.json(out);
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /move-in/imports → { ready, why, imports: [{ import_id, source, company_id, source_country, country_how, kind, side, as_at, counts, proof, created_at }] } —
 *  the latest 20 imports with their MATCH PROOF (W1.10, b765), read back. Owner only. Before b765: ready false with the sentence. One transaction. */
// @does Nothing in -> we read the latest 20 move-in imports with their match proof -> the list of imports (owner only).
router.get('/move-in/imports', auth, owner, on, ...checked('GET /move-in/imports'), async (req, res) => {
  try {
    const e = ctx(req);
    const proofs = await withEntity(e, (conn) => require('../lib/move-in-proof').list(conn, e));
    res.json({ ready: proofs.ready, why: proofs.why, imports: proofs.imports });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/* ── PARALLEL RUN (PR1) — an auditor's Tally / Xero / QBO period beside ours, line by line (lib/parallel-run). Their figures are a SNAPSHOT: read from export
   files, kept insert-only (b309 books_compare_part), NEVER posted. Who may: the owner, or the shop's auditor (a whole-entity login that may see money —
   lib/access seesWholeEntity + lib/cost canRead); the server answers may + why, the screen greys with the sentence. ── */
const PR = require('../lib/parallel-run');
const COMPARE_NOT_READY = waiting('The books comparison', false, 'It was not run and nothing was posted.');
/** the shop's auditor: a whole-entity login whose identity row says can_see_costs (lib/access + lib/cost, read from the DB — never the preset's own flag). ONE test for compare and the returns. */
async function auditorMay(req, e) {
  return require('../lib/access').seesWholeEntity(req.identity) && (await require('../lib/cost').canRead(req, e));
}
async function compareMay(req, e) {
  if (req.api_key) return { may: false, why: 'Sign in to compare the books.' };
  if (isOwner(req)) return { may: true, why: null };
  if (await auditorMay(req, e)) return { may: true, why: null };
  return { may: false, why: "Only the owner or the shop's auditor may compare the books." };
}
/** ACC-229: who may READ the shop's own return (GET /returns) — the owner, or the shop's auditor (same test as compare). The Close and pay writes stay owner only. */
const RETURN_READ_WORDS = "Only the owner or the shop's auditor may read the returns.";
const returnReader = roleGate('reader', async (req, res, next) => {
  try {
    if (!req.api_key && (isOwner(req) || (await auditorMay(req, ctx(req))))) return next();
    return problem(req, res, { status: 403, code: 'BOOKS_RETURN_READ_NOT_ALLOWED', detail: RETURN_READ_WORDS, legacy: { error: RETURN_READ_WORDS, message: RETURN_READ_WORDS } });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
async function comparer(req, res, next) {
  try {
    const m = await compareMay(req, ctx(req));
    if (!m.may) return problem(req, res, { status: 403, code: 'COMPARE_NOT_ALLOWED', detail: m.why, legacy: { error: m.why, message: m.why } });
    next();
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
}
const notMigrated = () => {
  const x = new Error(COMPARE_NOT_READY);
  x.code = 'BOOKS_NOT_MIGRATED';
  return x;
};
/** GET /compare → { currency, ready, why, may: { load: { may, why } }, snapshots: [{ snapshot_id, label, source, period_from, period_to, currency, parts, lines, created_at }] } — one transaction */
// @does Nothing in -> we list the parallel-run snapshots loaded from the old package -> the snapshots and whether the caller may load more.
router.get('/compare', auth, noKey, on, comparer, ...checked('GET /compare'), async (req, res) => {
  try {
    const e = ctx(req);
    const out = await withEntity(e, async (h) => {
      const ready = await S.compareReady();
      return { ready, snapshots: ready ? await S.compareSnapshots(h, e) : [] };
    });
    res.json({
      currency: curOf(req),
      ready: out.ready,
      why: out.ready ? null : COMPARE_NOT_READY,
      may: { load: { may: out.ready, why: out.ready ? null : COMPARE_NOT_READY } },
      parts: PR.PARTS.map((item) => ({ part: item, label: PR.PART_WORD[item] })),
      sources: PR.SOURCES.map((item) => ({ source: item, label: PR.SOURCE_WORD[item] })),
      snapshots: out.snapshots
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /compare/preflight { part, source, csv | xlsx | xml, sheet?, header_row? } → { part, source, format: table | tally_xml, headers, fields, guess, missing, ready, rows_total, sample } — nothing is read of the shop, nothing written */
// @does A report file (CSV, Excel or Tally XML) from the old package in -> we read its columns and guess the fields -> the headers and guesses.
router.post('/compare/preflight', auth, noKey, on, comparer, ...checked('POST /compare/preflight'), async (req, res) => {
  try {
    const b = req.body || {},
      part = PR.partOf(b.part),
      source = PR.sourceOf(b.source);
    if (b.xml && source !== 'tally')
      throw Object.assign(new Error('Only a Tally export comes as XML — export ' + PR.SOURCE_WORD[source] + "'s report as CSV or Excel."), {
        code: 'BOOKS_BAD_REQUEST'
      });
    const guessed = PR.preflight(b, part, curOf(req)); /* a Tally XML carries no sheet, sheets or header_row (undefined, as before) */
    res.json({ part, source, format: guessed.format, headers: guessed.headers, fields: guessed.fields, guess: guessed.guess, missing: guessed.missing, ready: guessed.ready, rows_total: guessed.rows_total, sample: guessed.sample, sheet: guessed.sheet, sheets: guessed.sheets, header_row: guessed.header_row });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /compare/snapshots { snapshot_id?, label, source, part, period_from?, period_to, file_name?, csv | xlsx | xml, decisions? } → { snapshot_id, part, label, source, period_from, period_to, rows, skipped }
 *  A new snapshot with its first part, or one more part on a snapshot (its label, source and period are kept). Insert-only: a part it already has → 409. One transaction. */
// @does A report file with its label, part and period in -> we store it as a snapshot part for the parallel run, insert-only -> the snapshot id and its lines.
router.post('/compare/snapshots', auth, noKey, on, comparer, ...checked('POST /compare/snapshots'), async (req, res) => {
  try {
    const b = req.body || {},
      e = ctx(req),
      part = PR.partOf(b.part),
      cur = curOf(req);
    const out = await withEntity(e, async (h) => {
      if (!(await S.compareReady())) throw notMigrated();
      let head;
      if (b.snapshot_id) {
        if (!UUID.test(String(b.snapshot_id))) throw Object.assign(new Error('Which snapshot?'), { code: 'BOOKS_BAD_REQUEST' });
        const have = await S.compareParts(h, e, String(b.snapshot_id));
        if (!have.length) {
          const x = new Error('That snapshot is not here.');
          x.code = 'BOOKS_NOT_FOUND';
          throw x;
        }
        if (have.some((item) => item.part === part))
          throw Object.assign(new Error('This snapshot already has their ' + PR.PART_WORD[part].toLowerCase() + ' — start a new snapshot for a fresh file.'), {
            status: 409
          });
        head = {
          snapshot_id: String(b.snapshot_id),
          label: have[0].label,
          source: have[0].source,
          period_from: have[0].period_from,
          period_to: have[0].period_to
        };
      } else {
        const to = dateQ(b.period_to, null),
          from = dateQ(b.period_from, null);
        if (!to) throw Object.assign(new Error('Pick the last day of their period.'), { code: 'BOOKS_BAD_REQUEST' });
        if (from && from > to) throw Object.assign(new Error('The period starts after it ends.'), { code: 'BOOKS_BAD_REQUEST' });
        const label = String(b.label || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 80);
        if (!label) throw Object.assign(new Error('Give the snapshot a name.'), { code: 'BOOKS_BAD_REQUEST' });
        head = { snapshot_id: require('crypto').randomUUID(), label, source: PR.sourceOf(b.source), period_from: from || fyStart(req, to), period_to: to };
      }
      if (b.xml && head.source !== 'tally') throw Object.assign(new Error('Only a Tally export comes as XML.'), { code: 'BOOKS_BAD_REQUEST' });
      const r = PR.read(b, part, cur);
      if (!r.rows.length) throw Object.assign(new Error('Nothing to compare in that file — every row was skipped or blank.'), { refused: true });
      const id = await S.insertComparePart(
        h,
        e,
        Object.assign({}, head, { part, currency: cur, file_name: b.file_name ? String(b.file_name).slice(0, 120) : null, rows: r.rows, by: byOf(req) })
      );
      if (!id) throw Object.assign(new Error('This snapshot already has their ' + PR.PART_WORD[part].toLowerCase() + '.'), { status: 409 });
      return Object.assign({}, head, { part, rows: r.rows.length, skipped: r.skipped });
    });
    res.json({ snapshot_id: out.snapshot_id, label: out.label, source: out.source, period_from: out.period_from, period_to: out.period_to, part: out.part, rows: out.rows, skipped: out.skipped });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** the compare for one snapshot: its parts and our figures for its period in ONE transaction (chart · the period's entry lines · TB / P&L / BS · the BAS / VAT201);
 *  India's GSTR-3B is the rail's own read (lib/tax-copy ledgerFor) after it — the one second read. Each of our parts that cannot be read is said, not thrown. */
async function compareRead(req) {
  const e = ctx(req),
    id = String(req.params.id);
  if (!UUID.test(id)) {
    const x = new Error('Not found');
    x.code = 'BOOKS_NOT_FOUND';
    throw x;
  }
  const pack = B.packOf(req.books),
    currency = curOf(req);
  const fetched = await withEntity(e, async (db) => {
    if (!(await S.compareReady())) throw notMigrated();
    const parts = await S.compareParts(db, e, id);
    if (!parts.length) {
      const x = new Error('That snapshot is not here.');
      x.code = 'BOOKS_NOT_FOUND';
      throw x;
    }
    const to = parts[0].period_to,
      from = parts[0].period_from || fyStart(req, to),
      hasPart = (part) => parts.some((item) => item.part === part),
      ours = {};
    /* an engine's refusal (a P&L across two years, a return period not known) is said on that part; a database error is not swallowed */
    const partOrRefusal = async (fn) => {
      try {
        return await fn();
      } catch (err) {
        if (err && /^[0-9A-Z]{5}$/.test(String(err.code || '')) && !err.refused) throw err;
        return err instanceof Error ? err : new Error(String(err));
      }
    };
    const chart = await S.accounts(db, e),
      lines = await S.entryLines(db, e, from, to, null, null);
    if (hasPart('tb')) ours.tb = await partOrRefusal(() => B.trialBalance(db, e, to));
    if (hasPart('pl')) ours.pl = await partOrRefusal(() => B.profitAndLoss(db, e, from, to));
    if (hasPart('bs')) ours.bs = await partOrRefusal(() => B.balanceSheet(db, e, to, B.entityBasisOf(req.books)));
    if (hasPart('ret') && pack.id !== 'IN') {
      const returnPart = parts.find((item) => item.part === 'ret'),
        full = (returnPart.rows || []).some((item) => /^G(2|3|10|11)\b/i.test(String(item.name)));
      ours.ret = await partOrRefusal(() => P().taxReturn(e, req.books, { on: to, simpler: full ? '0' : undefined }, db));
    }
    return { parts, chart, lines, ours, from, to };
  });
  if (fetched.parts.some((item) => item.part === 'ret') && pack.id === 'IN') {
    try {
      const taxCopy = require('../lib/tax-copy'),
        taxLines = require('../lib/tax-lines'),
        ledgerCopy = await taxCopy.ledgerFor(e, fetched.to.slice(0, 7));
      if ((ledgerCopy.dropped || []).length) throw new Error('ACC-266 C5: ' + ledgerCopy.dropped.length + ' bill(s) could not be read — a short month is not compared');
      fetched.ours.ret = Object.assign(PR.gstr3bBoxes(taxLines.gstr3b(ledgerCopy.ledger, ledgerCopy.me, ledgerCopy.bounds.period)), { short: 'GSTR-3B' });
    } catch (err) {
      fetched.ours.ret = new Error('Our GSTR-3B for ' + fetched.to.slice(0, 7) + ' could not be read from the rail.');
      fetched.ours.ret.refused = true;
    }
  }
  const comparison = PR.compare({ parts: fetched.parts, chart: fetched.chart, ours: fetched.ours, lines: fetched.lines, currency: currency, from: fetched.from, to: fetched.to });
  const firstPart = fetched.parts[0];
  return Object.assign(
    {
      currency: currency,
      snapshot: {
        snapshot_id: firstPart.snapshot_id,
        label: firstPart.label,
        source: firstPart.source,
        source_word: PR.SOURCE_WORD[firstPart.source],
        period_from: fetched.from,
        period_to: fetched.to,
        parts: fetched.parts.map((item) => item.part)
      }
    },
    comparison
  );
}
/** GET /compare/:id → { currency, snapshot, parts: { tb|pl|bs|ret: { part, title, from, to, file_name, lines: [{ key, status, name, their_name, their_code, their_line, our_codes, theirs_minor,
 *  ours_minor, diff_minor, cause, why, entries: [{ entry_id, entry_no, date, amount_minor, chit_id, ref, kind, rail }], entries_n, open }], counts, error } }, counts, effort } — differences first */
// @does A snapshot id in -> we compare each line of the old package's report with our books and name the cause of each difference -> the comparison.
router.get('/compare/:id', auth, noKey, on, comparer, ...checked('GET /compare/:id'), async (req, res) => {
  try {
    res.json(await compareRead(req));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /compare/:id/csv → the same compare as a .csv for the auditor's file */
// @does A snapshot id in -> we make the same comparison as above -> a CSV file for the auditor.
router.get('/compare/:id/csv', auth, noKey, on, comparer, ...checked('GET /compare/:id/csv'), async (req, res) => {
  try {
    const r = await compareRead(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="parallel-run-' + r.snapshot.period_to + '.csv"');
    res.send(PR.csv(r, r.currency));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /periods/:fy/:p/lock { reason, hard } · /unlock { reason } → { period: { fiscal_year, period, status } } */
// @does A year, a month and lock or unlock in -> we lock (soft or hard) or reopen that month with a reason -> the month's status (owner only).
router.post('/periods/:fy/:p/:act', auth, owner, on, ...checked('POST /periods/:fy/:p/:act'), async (req, res) => {
  try {
    const { fy, p, act } = req.params;
    if (!/^\d{4}(-\d{2})?$/.test(fy) || !/^\d{1,2}$/.test(p) || ['lock', 'unlock'].indexOf(act) < 0) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const b = req.body || {};
    const status = act === 'unlock' ? 'open' : b.hard === true ? 'hard_locked' : 'soft_locked';
    const r = await B.setPeriod(null, ctx(req), fy, Number(p), status, byOf(req), b.reason);
    res.json({ ok: true, period: { fiscal_year: r.fiscal_year, period: r.period, status: r.status } });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /year/:fy/close → { ok, fiscal_year, next, locked, opening } · refused (422) with { refusals: [{ name, why }] } in plain words · a closed year answers { ok, duplicate: true } */
// @does A financial year in -> we close the year, carry the opening balances forward and lock it, or refuse with plain reasons -> the result (owner only).
router.post('/year/:fy/close', auth, owner, on, ...checked('POST /year/:fy/close'), async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const r = await B.closeYear(null, ctx(req), req.params.fy, byOf(req));
    if (r.ok) return res.json({ ok: r.ok, duplicate: r.duplicate, fiscal_year: r.fiscal_year, next: r.next, locked: r.locked, opening: r.opening });
    const message = r.refusals.map((x) => x.why).join(' '),
      legacy = { ok: false, fiscal_year: r.fiscal_year, error: message, message, refusals: r.refusals };
    /* ACC-204: a tax period of the year not closed yet names the answer (the screen opens Tax close on the code); every other refusal stays YEAR_CLOSE_REFUSED */
    if (r.refusals.some((x) => x.name === 'return_open')) return problem(req, res, { status: 422, code: 'PERIOD_RETURN_OPEN', detail: message, legacy });
    problem(req, res, { status: 422, code: 'YEAR_CLOSE_REFUSED', detail: message, legacy });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /year/:fy/status → { fiscal_year, closed, can_close, refusals, months, next } — what a close would say, nothing written */
// @does A financial year in -> we read what a close would say, writing nothing -> closed, can_close, the refusals and the months.
router.get('/year/:fy/status', auth, on, ...checked('GET /year/:fy/status'), async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const e = ctx(req);
    const st = await withEntity(e, (h) => B.yearState(h, e, req.params.fy));
    res.json({
      fiscal_year: st.fiscal_year,
      closed: st.closed,
      can_close: st.can_close && !st.closed,
      refusals: st.closed ? [] : st.refusals,
      months: st.months,
      next: st.next
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Optionally a year in -> we read each month's lock state, figures (sales_minor is ex-tax, the P&L's income, since 15 Nov 2026), tax return state and change trail -> the periods.
router.get('/periods', auth, on, ...checked('GET /periods'), async (req, res) => {
  try {
    const e = ctx(req);
    const fy = req.query.fy ? String(req.query.fy) : null;
    const { rows, figures, setting, taxStates, trail } = await withEntity(e, async (h) => {
      const all = await S.periods(h, e, null),
        books = await B.settingOf(h, e);
      const figures = await S.periodFigures(h, e, fy);
      /* ONE-FIGURE: a month's "sales" is the profit and loss's income for that month (its total_income_minor: the sales ledgers, before tax) — the entry totals the store sums carry the tax in them, so they only count the entries */
      const byMonth = new Map(all.map((item) => [item.fiscal_year + '|' + Number(item.period), item]));
      const withSales = figures.filter((x) => x.sales_minor > 0 && byMonth.get(x.fiscal_year + '|' + x.period) && Number(x.period) >= 1);
      const pls = await B.profitAndLossMonths(h, e, withSales.map((x) => { const month = byMonth.get(x.fiscal_year + '|' + x.period); return { from: E.ymd(month.start_date), to: E.ymd(month.end_date) }; })); /* ONE read of the lines for every month, the P&L engine once per month */
      withSales.forEach((item, n) => { item.sales_minor = Number(pls[n].total_income_minor || 0); });
      return { rows: all, figures, setting: books, taxStates: await P().returnStatesFor(h, e, books, all), trail: await S.lockTrail(h, e, fy) };
    });
    /* the dates as dates ('YYYY-MM-DD'), never a Date through JSON — that is the day before, east of UTC */
    const dated = rows.map((item) => Object.assign({}, item, { start_date: E.ymd(item.start_date), end_date: E.ymd(item.end_date) }));
    /* ACC-204: the tax periods of every year the rows hold, each with its form, so a month's lock advice names the period it ends in */
    const taxPeriods = [].concat(...Array.from(taxStates.values()).map((state) => state.periods.map((item) => Object.assign({ form: state.form }, item))));
    /* M157: entries + sales per month, and what each month may do (the server's one rule — B.periodAdvice) */
    res.json({
      periods: B.periodAdvice(dated, figures, require('../lib/books-hooks').dayOf(CLOCK.now(), setting), taxPeriods, trail).filter((item) => !fy || item.fiscal_year === fy)
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── packs ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function manifestView(manifest) {
  const x = manifest || {};
  return Object.assign({}, x, {
    files: (x.files || []).map((item) => ({
      name: item.file || item.name,
      file: item.file || item.name,
      sha256: item.sha256,
      bytes: item.bytes,
      rows: item.rows
    })),
    controls: { counts: x.counts || null, totals: x.totals || null, checks: x.checks || null }
  });
}
// @does Nothing in -> we list the accountant packs built for this shop -> the packs (owner only).
router.get('/packs', auth, owner, on, ...checked('GET /packs'), async (req, res) => {
  try {
    const e = ctx(req);
    const rows = await withEntity(e, (h) => S.packs(h, e));
    res.json({
      packs: rows.map((item) => ({
        pack_id: item.pack_id,
        kind: item.kind,
        fiscal_year: item.fiscal_year,
        period: item.period,
        created_at: item.created_at,
        sha256: item.sha256,
        stored: !!item.storage_path,
        has_file: !!item.storage_path,
        acknowledged_at: item.acknowledged_at || null,
        delete_after: E.ymd(item.delete_after)
      }))
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A pack kind, year and period in -> we build the accountant's pack and store its file -> the pack id, checksum and manifest (owner only).
router.post('/packs', auth, owner, on, ...checked('POST /packs'), async (req, res) => {
  try {
    const b = req.body || {};
    const r = await require('../lib/books-pack').build(ctx(req), { kind: b.kind, fiscal_year: b.fiscal_year, period: b.period, by: byOf(req) });
    res.json({ ok: true, pack: { pack_id: r.pack_id, sha256: r.sha256, stored: r.stored, bytes: r.bytes }, manifest: manifestView(r.manifest) });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * GET /packs/:id → JSON: { pack, manifest: { files: [{ name, sha256, bytes }], controls }, has_file, file, download }
 *   has_file  boolean — is there a stored zip to download (false: built while storage was not connected)
 *   file      '/api/books/packs/:id/file' — where the ZIP ITSELF is (this route is the manifest, never the pack; critic M10:
 *             the web saved this JSON as "the pack" and then acknowledged it)
 *   download  the same path, or null when has_file is false (kept for the first web build)
 */
// @does A pack id in -> we read its manifest and whether it has a file and was confirmed -> the pack (owner only).
router.get('/packs/:id', auth, owner, on, ...checked('GET /packs/:id'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id);
    if (!UUID.test(id)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const p = await withEntity(e, (h) => S.pack(h, e, id));
    if (!p) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    res.json({
      pack: {
        pack_id: p.pack_id,
        kind: p.kind,
        fiscal_year: p.fiscal_year,
        period: p.period,
        created_at: p.created_at,
        sha256: p.sha256,
        prev_sha256: p.prev_sha256,
        stored: !!p.storage_path,
        acknowledged_at: p.acknowledged_at,
        delete_after: E.ymd(p.delete_after)
      },
      manifest: manifestView(p.manifest),
      has_file: !!p.storage_path,
      file: '/api/books/packs/' + id + '/file',
      download: p.storage_path ? '/api/books/packs/' + id + '/file' : null
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A pack id in -> we fetch the stored zip of that pack -> the zip file to download (owner only).
router.get('/packs/:id/file', auth, owner, on, ...checked('GET /packs/:id/file'), async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const r = await require('../lib/books-pack').download(ctx(req), String(req.params.id));
    if (!r.found) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    if (!r.stored)
      return problem(req, res, { status: 409, code: 'PACK_NO_FILE', detail: PACK_NO_FILE_BUILT, legacy: { error: PACK_NO_FILE_BUILT, message: PACK_NO_FILE_BUILT } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="ledger-pack-' +
        (r.pack.kind || 'pack') +
        '-' +
        (r.pack.fiscal_year || '') +
        (r.pack.period != null ? '-' + r.pack.period : '') +
        '.zip"'
    );
    res.setHeader('X-Pack-SHA256', r.pack.sha256);
    res.end(r.bytes);
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/**
 * POST /packs/:id/ack → { ok, acknowledged_at } — "we have it": the fact that later licenses summarising detail away.
 * ⚠️⚠️ REFUSED FOR A PACK WITH NO STORED FILE (critic M10): 409 { code: 'PACK_NO_FILE', error } — there is nothing the shop
 *   could have downloaded, so there is nothing to acknowledge. Build it again once storage is connected.
 */
const PACK_NO_FILE_BUILT = 'This pack was built while storage was not connected — build it again to download it.';
const PACK_NO_FILE = 'This pack has no file to download, so there is nothing to confirm yet. Build it again, download it, then confirm.';
// @does A pack id in -> we record that the owner downloaded and confirmed the pack, and log it -> the pack (owner only).
router.post('/packs/:id/ack', auth, owner, on, ...checked('POST /packs/:id/ack'), async (req, res) => {
  try {
    const e = ctx(req);
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const r = await withEntity(e, async (h) => {
      const p = await S.pack(h, e, String(req.params.id));
      if (!p) return null;
      if (!p.storage_path) return { no_file: true };
      const x = await S.ackPack(h, e, String(req.params.id), byOf(req));
      if (x) await S.logChange(h, e, { by: byOf(req), table_name: 'books_pack', row_id: req.params.id, field: 'acknowledged', new: 'yes' });
      return x;
    });
    if (!r) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    if (r.no_file) return problem(req, res, { status: 409, code: 'PACK_NO_FILE', detail: PACK_NO_FILE, legacy: { error: PACK_NO_FILE, message: PACK_NO_FILE } });
    res.json({ ok: true, acknowledged_at: r.acknowledged_at });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/* ── recurring entries (b281, DRAFT) and the To-do ─────────────────────────────────────────────────────────── */
const RC = () => require('../lib/books-recurring');
/** GET /recurring → { recurring: [{ recurring_id, name, event, frequency, next_on, end_on, auto, active, last_done_on, due }] } · 503 BOOKS_NOT_MIGRATED until b281 runs */
// @does Nothing in -> we list the recurring entries with their next date and whether one is due -> the list (owner only).
router.get('/recurring', auth, owner, on, ...checked('GET /recurring'), async (req, res) => {
  try {
    res.json({ recurring: await RC().list(ctx(req)) });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /recurring { name, event: { kind, …fields as POST /events, no date }, frequency: monthly|quarterly|yearly, next_on, end_on?, auto? } */
// @does A name, an event, a frequency and a next date in -> we save a recurring entry template -> the template (owner only).
router.post('/recurring', auth, owner, on, ...checked('POST /recurring'), async (req, res) => {
  try {
    const template = await RC().create(ctx(req), req.books, req.body || {}, byOf(req));
    /* entity first: the web contract reads it on the row (docs/contracts/web-api.json); absent when the store's COLS do not select it */
    res.json({ entity: template.entity, recurring_id: template.recurring_id, name: template.name, event: template.event, frequency: template.frequency, next_on: template.next_on, anchor_day: template.anchor_day, end_on: template.end_on, auto: template.auto, active: template.active, last_done_on: template.last_done_on, created_by: template.created_by, created_at: template.created_at, updated_at: template.updated_at, due: template.due });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** PATCH /recurring/:id — a merge-patch: only the fields sent change */
// @does A template id and the fields to change in -> we change only those fields -> the template (owner only).
router.patch('/recurring/:id', auth, owner, on, ...checked('PATCH /recurring/:id'), async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const template = await RC().patch(ctx(req), req.books, String(req.params.id), req.body || {}, byOf(req));
    res.json({ entity: template.entity, recurring_id: template.recurring_id, name: template.name, event: template.event, frequency: template.frequency, next_on: template.next_on, anchor_day: template.anchor_day, end_on: template.end_on, auto: template.auto, active: template.active, last_done_on: template.last_done_on, created_by: template.created_by, created_at: template.created_at, updated_at: template.updated_at, due: template.due });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** DELETE /recurring/:id — stops it (active: false); nothing is deleted, and what it posted stays */
// @does A template id in -> we stop it, deleting nothing that it posted -> the stopped template (owner only).
router.delete('/recurring/:id', auth, owner, on, ...checked('DELETE /recurring/:id'), async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const template = await RC().stop(ctx(req), String(req.params.id));
    res.json({ entity: template.entity, recurring_id: template.recurring_id, name: template.name, event: template.event, frequency: template.frequency, next_on: template.next_on, anchor_day: template.anchor_day, end_on: template.end_on, auto: template.auto, active: template.active, last_done_on: template.last_done_on, created_by: template.created_by, created_at: template.created_at, updated_at: template.updated_at, due: template.due, stopped: template.stopped });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /recurring/:id/post — accept the proposal: posts the due day as an MJ entry (client_ref = template + date) and moves it on · POST /recurring/:id/skip — let it pass */
// @does A template id in -> we post the due day as a journal entry once and move the template on -> what was posted (owner only).
router.post('/recurring/:id/post', auth, owner, on, ...checked('POST /recurring/:id/post'), async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const out = await RC().accept(ctx(req), req.books, String(req.params.id), byOf(req));
    res.json({ posted: out.posted, template: out.template, date: out.date });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A template id in -> we skip the due day without posting and move the template on -> the skipped day (owner only).
router.post('/recurring/:id/skip', auth, owner, on, ...checked('POST /recurring/:id/skip'), async (req, res) => {
  try {
    if (!UUID.test(String(req.params.id))) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const out = await RC().skip(ctx(req), String(req.params.id));
    res.json({ skipped: out.skipped, template: out.template });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /todo → [{ kind, count, words, action: { label, screen, call }, items? }] — CB Accounts' home; only what needs doing is listed. Kinds: bills_to_accept · suppliers_to_add · bills_unrated (F5 A1: a bill with an unrated line, listed never changed) · months_not_locked · closing_stock_missing · gst_due · recurring_due · accrual_reversals_due · year_close_possible */
// @does Nothing in -> we read what needs doing in the books and the action for each -> a list of to-do kinds with counts.
router.get('/todo', auth, noKey, on, ...checked('GET /todo'), async (req, res) => {
  try {
    res.json(await forBooksDoor(req, ctx(req), 'todo', await require('../lib/books-todo').todo(ctx(req), req.books)));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

module.exports = router;
/* ── the period-end routes (engines v1.14–v1.16; lib/books-period.js builds each event THROUGH THE ENGINE) ─────────────
   Owner-only, switch on, idempotent (client_ref, or the entry's natural key), refused in a locked month (PERIOD_LOCKED, 409).
   The asset ones answer 503 BOOKS_NOT_MIGRATED until b280 (DRAFT) is run. */
const P = () => require('../lib/books-period');
const route = (method, p, fn, gates) =>
  router[method](p, auth, owner, ...(gates || []), on, ...checked(method.toUpperCase() + ' ' + p), async (req, res) => {
    try {
      res.json(await fn(req, ctx(req), req.books, req.body || {}, byOf(req)));
    } catch (err) {
      problem(req, res, refusalOf(err, req));
    }
  });
/** GET /assets?asOf → { currency, asOf, assets: [{ asset_id, name, asset_class, cost_minor, put_to_use, accumulated_minor, wdv_minor, disposed_on }], net_block: [per class, with the ledger's figure beside], total_wdv_minor } */
// @does An as-at date in -> we read the fixed-asset register with depreciation and written-down value -> the assets and the net block per class (owner only).
router.get('/assets', auth, owner, on, ...checked('GET /assets'), async (req, res) => {
  try {
    const assetBook = await P().listAssets(ctx(req), req.books, dateQ(req.query.asOf, today(req)));
    res.json({ currency: assetBook.currency, asOf: assetBook.asOf, assets: assetBook.assets, net_block: assetBook.net_block, total_wdv_minor: assetBook.total_wdv_minor });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /assets { name, class, cost, date, put_to_use?, how | party_id, client_ref } → the purchase entry (MJ) and the register row */
// @does An asset's name, class, cost and date in -> we post the purchase and add it to the register -> the entry and register row (owner only).
route('post', '/assets', (req, e, setting, body, by) => P().addAsset(e, setting, body, by));
/** POST /assets/:id/dispose { date, proceeds?, into?, client_ref } */
// @does An asset id with a date and proceeds in -> we post the disposal and close its register row -> the entry (owner only).
route('post', '/assets/:id/dispose', (req, e, setting, body, by) => {
  if (!UUID.test(String(req.params.id))) {
    const x = new Error('Not found');
    x.code = 'BOOKS_NOT_FOUND';
    throw x;
  }
  return P().disposeAsset(e, setting, String(req.params.id), body, by);
});
/** POST /depreciation/run { fy } → one entry at the year end, from the register; says which entity basis it used */
// @does A financial year in -> we post that year's depreciation from the register in one entry -> the entry (owner only).
route('post', '/depreciation/run', (req, e, setting, body, by) => P().runDepreciation(e, setting, body, by));
/** POST /closing-stock { date, value_minor?, nrv_minor?, method: 'manual' | 'automatic' (valued from the stock ledger — T1-INV) } */
// @does A date and a stock value, typed or valued from the stock ledger, in -> we post the closing stock entry -> the entry (owner only).
route('post', '/closing-stock', (req, e, setting, body, by) => P().closingStock(e, setting, body, by));
/** POST /gst/close { fy, period } → { utilised, payable_minor, carried_minor, pay_total_minor, entry_no } · POST /gst/pay { fy, period, amounts, bank, challan_no } */
// @does A year and tax period in -> we set the month's input tax against output tax and post what is payable or carried -> the amounts and entry number (owner only).
route('post', '/gst/close', (req, e, setting, body, by) => P().gstClose(e, setting, body, by));
// @does A period, the amounts, the bank and a challan number in -> we post the tax payment once per attempt -> the entry (owner only).
route('post', '/gst/pay', (req, e, setting, body, by) => P().gstPay(e, setting, body, by), [onceOnly]); /* FIN-63: a tax payment is a money write — one key per attempt */
/** GET /returns?period&frequency&simpler&stagger&emirate — BAS1: the shop's OWN return (AU BAS · AE VAT201) READ from the posted books for one period, with the pack's period
 *  table and due dates; every box names the ledgers it counts (lib/books-period.taxReturn → engines gst-returns.returnFor). Owner, or the shop's auditor (ACC-229: whole-entity + can_see_costs, 403 BOOKS_RETURN_READ_NOT_ALLOWED). Prepared, never lodged.
 *  India → 200 { form: null, code: RETURN_FROM_RAIL, why, rail } (GSTR-1 / 3B come from the rail: GET /api/tax/gstr). One transaction, no per-row query. */
/* TOUR-FIX1: a shop whose return is not read from the ledgers (India: the GSTR from the rail) is an ANSWER, not a refusal — 200 with `form: null`,
   the code and the sentence the GST page shows above its close & pay (the 422 was swallowed by the page, 42 failed requests a visit on the tour) */
// @does A tax period in -> we read the shop's own return (BAS or VAT201) from the posted books, India answering from the rail instead -> the return, for the owner or the shop's auditor.
router.get('/returns', auth, returnReader, on, ...checked('GET /returns'), async (req, res) => {
  try {
    const form = await P().taxReturn(ctx(req), req.books, req.query || {});
    /* the pack's return, every key it can carry named (S34); a key this return does not carry is undefined, and JSON leaves it out */
    // prettier-ignore
    res.json({ currency: form.currency, pack: form.pack, form: form.form, name: form.name, short: form.short, authority: form.authority, portal: form.portal, prepared: form.prepared, asked: form.asked, needs: form.needs, why: form.why, periods: form.periods, period: form.period, boxes: form.boxes, payable_minor: form.payable_minor, refund_minor: form.refund_minor, net_minor: form.net_minor, notes: form.notes, cite: form.cite, unsupported_input: form.unsupported_input, emirates: form.emirates, staggers: form.staggers });
  } catch (err) {
    if (err && err.code === 'RETURN_FROM_RAIL') {
      const pack = err.pack || null;
      return res.json({
        form: null,
        pack,
        code: err.code,
        why: pack === 'IN' ? "Your GSTR-1 and GSTR-3B are made from your bills, not from these books. Close and pay the month's GST here." : err.message,
        rail: pack === 'IN' ? '/api/tax/gstr' : null
      });
    }
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /loans { ref, lender, amount, into, rate?, kind? } · POST /loans/:ref/emi { principal, interest, from?, date, client_ref } */
// @does A lender, an amount and the account it landed in -> we post the loan taken -> the entry (owner only).
route('post', '/loans', (req, e, setting, body, by) => P().takeLoan(e, setting, body, by));
// @does A loan reference with principal, interest and a date in -> we post the instalment split between them -> the entry (owner only).
route('post', '/loans/:ref/emi', (req, e, setting, body, by) => P().loanEmi(e, setting, String(req.params.ref).slice(0, 60), body, by));
/** POST /accruals { ref, kind, class, amount, date } → reverses_on · POST /accruals/:ref/reverse (due from reverses_on) */
// @does A reference, kind, class, amount and date in -> we post an accrual and schedule its reversal -> the entry (owner only).
route('post', '/accruals', (req, e, setting, body, by) => P().accrue(e, setting, body, by));
// @does An accrual reference in -> we post the reversal of that accrual -> the entry (owner only).
route('post', '/accruals/:ref/reverse', (req, e, setting, body, by) => P().reverseAccrual(e, setting, String(req.params.ref).slice(0, 60), body, by));
/** POST /contra { from, to, amount, date, client_ref } — cash ↔ bank ↔ UPI */
// @does A from account, a to account, an amount and a date in -> we post the transfer between cash, bank and UPI -> the entry (owner only).
route('post', '/contra', (req, e, setting, body, by) => P().contra(e, setting, body, by));

/* ── FX1 · EXCHANGE RATES AND FOREIGN BALANCES (lib/fx-rates; b391 fx_rate, b392 journal_line txn_currency). A rate is evidence the OWNER types or imports —
   never fetched, never assumed. Everyone who may read the books may read the rates (an auditor checks them); only the owner adds one or revalues. ── */
const FXR = require('../lib/fx-rates');
const FX_NOT_READY = FXR.WAITS.rates;
const FX_OWNER_ONLY = 'Only the owner may add a rate.';
function fxMay(req, ready) {
  if (!ready) return { may: false, why: FX_NOT_READY };
  return isOwner(req) ? { may: true, why: null } : { may: false, why: FX_OWNER_ONLY };
}
/** GET /fx-rates?from=USD → { currency, ready, why, may: { add }, sources, rule: { standard, tax_rate_rule, official_name }, rates: [{ rate_id, date, from, to, rate, source, source_ref, created_at }] } — one transaction */
// @does Optionally a currency in -> we read the exchange rates the owner typed or imported -> the rates and whether the caller may add one.
router.get('/fx-rates', auth, noKey, on, ...checked('GET /fx-rates'), async (req, res) => {
  try {
    const e = ctx(req),
      ready = await FXR.ready(),
      fx = B.packOf(req.books).fx || {};
    const rates = ready ? await withEntity(e, (h) => FXR.list(h, e, { from: req.query.from })) : [];
    res.json({
      currency: curOf(req),
      ready,
      why: ready ? null : FX_NOT_READY,
      may: { add: fxMay(req, ready) },
      sources: FXR.SOURCES,
      rule: { standard: fx.standard || null, tax_rate_rule: fx.tax_rate_rule || null, official_name: fx.official_name || null },
      rates
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /fx-rates { date, currency, rate, source?, source_ref? } → { rate } — owner; insert-only (a correction is a newer row for the same day). One transaction. */
// @does A date, a currency and a rate in -> we add the rate, insert-only, so a correction is a newer row -> the rate (owner only).
router.post('/fx-rates', auth, noKey, on, owner, ...checked('POST /fx-rates'), async (req, res) => {
  try {
    const e = ctx(req);
    res.status(201).json({ rate: await withEntity(e, (h) => FXR.add(h, e, req.books, req.body || {}, byOf(req))) });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /fx-rates/import { csv, file_name? } → { added, refused: [{ line, why }], rates } — owner; the good rows in ONE insert, source 'import'. One transaction. */
// @does A CSV of rates in -> we add the good rows and list the refused ones with why -> the count added, the refused lines and the rates (owner only).
router.post('/fx-rates/import', auth, noKey, on, owner, ...checked('POST /fx-rates/import'), async (req, res) => {
  try {
    const e = ctx(req),
      b = req.body || {};
    const out = await withEntity(e, (h) => FXR.importCsv(h, e, req.books, b.csv, b.file_name ? String(b.file_name).slice(0, 120) : null, byOf(req)));
    res.json({ added: out.added, refused: out.refused, rates: out.rates });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
const fxPeriod = (source) => {
  const fiscalYear = String(source.fiscal_year || ''),
    period = Number(source.period);
  if (!/^\d{4}(-\d{2})?$/.test(fiscalYear) || !Number.isInteger(period) || period < 1 || period > 12)
    throw Object.assign(new Error('Which month? A financial year and a month 1 to 12.'), { code: 'BOOKS_BAD_REQUEST' });
  return { fy: fiscalYear, p: period };
};
/** GET /fx-revalue?fiscal_year&period → { ready, why, may: { post }, date, reverses_on, functional, rows, missing, gain_minor, posted } — Month lock's foreign-balances line. Owner (it shows what parties owe). One transaction. */
// @does A year and month in -> we work out the gain or loss on foreign balances without posting -> the revaluation preview (owner only).
router.get('/fx-revalue', auth, noKey, on, owner, ...checked('GET /fx-revalue'), async (req, res) => {
  try {
    const e = ctx(req),
      { fy, p } = fxPeriod(req.query || {});
    const v = await withEntity(e, (h) => FXR.revaluation(h, e, req.books, fy, p));
    const why = !v.ready
      ? FXR.WAITS.balancesView
      : v.posted
        ? 'Revalued — ' + v.posted.entry_no + '.'
        : v.missing[0] || (v.event ? null : 'Nothing to revalue.');
    res.json({
      ready: v.ready,
      why,
      may: { post: { may: !!(v.ready && !v.posted && !v.missing.length && v.event), why } },
      date: v.date,
      reverses_on: v.reverses_on,
      functional: v.functional,
      rows: v.rows,
      missing: v.missing,
      gain_minor: v.gain_minor,
      posted: v.posted
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /fx-revalue { fiscal_year, period } → { ok, entry_no, reversal_no, gain_minor, date, reverses_on } — owner; the revaluation and its reversal in ONE transaction; idempotent */
// @does A year and month in -> we post the revaluation of foreign balances and its reversal once -> the entry numbers and the gain (owner only).
router.post('/fx-revalue', auth, noKey, on, owner, ...checked('POST /fx-revalue'), async (req, res) => {
  try {
    const e = ctx(req),
      { fy, p } = fxPeriod(req.body || {});
    const out = await withEntity(e, (h) => FXR.revalue(h, e, req.books, fy, p, byOf(req)));
    res.json({ ok: out.ok, duplicate: out.duplicate, entry_no: out.entry_no, reversal_no: out.reversal_no, gain_minor: out.gain_minor, date: out.date, reverses_on: out.reverses_on }); /* a month already revalued answers duplicate, no reversal or dates */
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

router.openapi = { paths: pathsOf(), schemas: {} };
module.exports = router;
module.exports._test = { isOwner, minorOf, flat, manifestView, sourceOf };
/* the books' refusals answered the same way from another door (routes/chits.js POST /:chit_id/payment — drift D1) */
module.exports.fail = fail;
/* the gates every ledger route sits behind, for a sibling router that must keep the ledger's rules (routes/books-money.js) */
module.exports.gates = { noKey, editor, on, owner };
module.exports.alreadyPaid = alreadyPaid;
