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
const pageLimit = require('../lib/page-limit');
const Daybook = require('../lib/books-daybook');
const { WORD, fyStart, sourceOf, momentOf, pageQ, cursorOf, partyNames, postedByIn, UUID } = Daybook; // the Day book's readers (a line's source, the page asked for, who posted)
const { withEntity } = require('../db');
const { clientRef } = require('../lib/books-input'); /* the one client_ref reader: over 80 characters is 422, never cut */
const B = require('../lib/books'), statementNotes = require('../lib/books-statement-notes');
const { flat, sched3, bsTagged } = require('../lib/books-bs-shape'); /* the P&L and balance sheet shapes */
const E = require('../lib/books-engines'); const moneyOps = require('../lib/books-money-ops');
const S = require('../lib/books-store'), LiveBill = require('../lib/books-live-bill'), LedgerMonths = require('../lib/ledger-months');
const Evidence = require('../lib/books-evidence'); /* the source document and the files held on it, per row (one read per page) */
const Needs = require('../lib/books-needs');
const Dues = require('../lib/books-dues'); /* the ONE dues read: GET /dues and the owner's overview call it (REQ-MIS-SHOWCASE A2) */ /* who needs you, and why: the one list of reasons (W15-114) */
const OtherSide = require('../lib/books-other-side'); /* W15-89b: a ledger line's other side (the entry's other ledger, and the party it names) */
const { marksIn } = require('../lib/mark-embed'); /* MARK & QUERY: the marks of the entries a list serves, in the list's own transaction */
const ctx = (req) => auth.entityOf(req);
/** the schema check of one route (its own operation in lib/books-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation)] : [];
}
const { isOwner, isInHouseAccountant, roleGate } = require('../lib/owner'); /* one owner test — the folder inventory's switch reads it too */
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
/** an adviser firm's person acting under a grant: { grant_id, name, firm } for the record's stamp (b871); null for the owner's own request */
const actingOf = (req) => (req.acting_for_grant && req.identity && req.identity.acting_preset === 'adviser' ? { grant_id: req.acting_for_grant, name: req.identity.display_name, firm: req.acting_firm_name || null } : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** API-25: an id in the query or body that is no uuid names no row: the same 404 NOT_FOUND the router guard (lib/id-guard) gives an address id */
const notAnId = (req, res) => problem(req, res, { status: 404, code: 'NOT_FOUND', detail: NOT_A_UUID_WORDS, legacy: { error: 'Not found', message: NOT_A_UUID_WORDS } });
/* ⚠️ WX-P2P-02 (2026-10-13, the real stack): "today" is the SHOP's day (books-hooks.dayOf — the one calendar, M210), not the UTC date.
   /dues filtered its items by the shop's day of created_at but took asOf from the UTC clock: a bill recorded after midnight IST
   (18:30–24:00 UTC) was ahead of asOf and vanished from Payables / Receivables until the next UTC day — "You owe nobody" beside
   a supplier chip saying you owe lakhs. One day, from one helper, everywhere this file says today. */
const today = (req) => CLOCK.today(req && req.books); /* the shop's day; dayOf of a moment is never null */
/* ACC-274: a date the caller GIVES must be a real day or it is a 400 DATE_INVALID (refusalOf names the field); absent → the fallback. The one reader is books-period.dateGiven (dateOf is its body twin). */
const dateQ = (value, fallback) => require('../lib/books-period').dateGiven(value, null, fallback);
/* E1 (Fable walk 17 Nov): an ageing is "as at" a day that has happened. A page asked for the end of the year in progress (30 Jun 2027) and every bill fell into 90+ while the owner, asking nothing, read 1-30 days. ONE rule for every seat: the as-at of an ageing is the earlier of the day asked and the shop's today. */
/* P1-3 (18 Nov): the ONE day a heading may say — the earlier of the day asked and the shop's today; the Trial balance and the Balance sheet both carry it as shown_as_at, so no report is headed with a day that has not happened. */
const headingDay = (asked, req) => { const now = today(req); return asked > now ? now : asked; };
const agedAt = (req) => headingDay(dateQ(req.query.asOf, today(req)), req);
/* minor units in; an amount in major units goes through the api's ONE major → minor (books-cashflow.toMinor: money.round, then the
   currency's own decimals). ⚠️ ACC-179: it was × 100 for every currency — a JPY amount came out 100× too big. */
const cashflow = () => require('../lib/books-cashflow');
/** the amount of a payment or write-off as minor units, by the ONE strict reader (books-period.amountOf: a whole JSON number); throws the plain question "How much?" (a 400) when it is not one */
const minorOf = (input, currency) => require('../lib/books-period').amountOf(input, 'amount', currency, { ask: 'How much?', zero: true, plain: 'How much?' });
/** minorOf for a caller that answers the question itself: null when the amount is not a whole number (the payment door asks "How much?") */
function minorAsked(input, currency) {
  try {
    return minorOf(input, currency);
  } catch (err) {
    if (err.code === 'BOOKS_BAD_REQUEST') return null;
    throw err;
  }
}

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
const ownerOrAccountant = (req, res, next) => (isInHouseAccountant(req) ? next() : owner(req, res, next)); /* RC-7: events, entries and the opening are the owner's and the owner's own accountant's; every other `owner` door stays the owner's */
const { postVerdict, openingGate } = require('../lib/books-approval'); /* W25 postVerdict · RC-7 openingGate: the seat gates live beside the owner-approves gate */
function owner(req, res, next) {
  if (!isOwner(req) && !(req.method === 'GET' && req.identity && req.identity.acting_preset === 'adviser') && !req.acting_bank_write) /* l16: the bank page's writes under adviser_posts (middleware/books-grant, from the live grant row) */ return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: SAID.ownerOnly, legacy: { error: SAID.ownerOnly, message: SAID.ownerOnly } }); /* ACC-176b: the owner's READS are the adviser's too (acting_preset comes from the live grant row only; the grant front lets an adviser GET through only on its read list) */
  next();
}
const { readers: booksReaders } = require('../lib/books-readers');
const { mayReadMoney, moneyReader, periodsReader, stripFigures } = booksReaders({ isOwner, roleGate, problem, refusalOf, ctx, auditorMay }); /* SEC-161 / BOOKS-GATE / STAFF-BOOKS: who reads the ledger's money, who reads the months (lib/books-readers.js) */
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
/** WALK U U-F-01: a bank reconciliation write (marks, a signed statement, a kept statement file) is a books WRITE: the seat that reads the books may keep it — the owner, the owner's own accountant or bookkeeper (RC-7), an adviser under a live grant — never a cashier or other staff seat that the books reads refuse (Xero and QBO limit bank work to an accountant or standard role with bank access). After the editor level gate; the sentence is the may/why the screen greys with. */
const BANK_WRITE_WORDS = "Only the owner or the shop's accountant or bookkeeper may keep or sign off a bank reconciliation.";
const bankWriter = roleGate('owner', (req, res, next) => (!req.api_key && (isOwner(req) || isInHouseAccountant(req) || !!req.acting_for_grant) ? next() : problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: BANK_WRITE_WORDS, legacy: { error: BANK_WRITE_WORDS, message: BANK_WRITE_WORDS, may: false, why: BANK_WRITE_WORDS } })));
/**
 * the gate: the shop's ledger must be on, else a quiet 404.
 * ⭐ CS1 (2026-10-12): BEFORE the switch, the COUNTRY — a shop whose country has no regulation pack (or no country, or the setup still to
 * do) is refused with the sentence, 422 with a code, on every books route, on or off; never India's rules by default (DECISIONS
 * 2026-10-03). lib/country-setup.gate: one cached read per shop per minute, inside the same withEntity.
 */
const CS = require('../lib/country-setup');
/** the gate middleware: the country first (422 with its sentence), then the ledger switch (404 when off); sets req.books and req.booksCountry */
async function gateOn(req, res, next, whenOff) {
  try {
    const e = ctx(req);
    let st = null;
    const s = await withEntity(e, async (h) => {
      st = await CS.gate(h, e);
      return B.settingOf(h, e);
    });
    if (!s || !s.enabled) {
      if (whenOff) return await whenOff(req, res, e, st); /* WALK S S-F-07: a read of a shop with nothing yet answers empty, 200 (empty is not missing) */
      return problem(req, res, { status: 404, code: 'LEDGER_OFF', detail: 'This shop has not switched the ledger on.', legacy: { error: SAID.notFound } });
    }
    req.books = s;
    req.booksCountry = st || null;
    next();
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
}
const on = (req, res, next) => /* the ledger-off refusal is status: 404 LEDGER_OFF, written in gateOn; the register reads a route's statuses from the gate's own text */ gateOn(req, res, next, null);
/** GET /dues with the ledger off: nobody owes anybody yet — the same shape, empty (a side not asked for stays null) */
const onDues = (req, res, next) =>
  /* status: 404 LEDGER_OFF when the shop has no ledger and the read is not the dues one (see gateOn) */ gateOn(req, res, next, async (rq, rs, e, st) => {
    const sides = rq.query.side === 'customer' ? ['debtors'] : rq.query.side === 'supplier' ? ['creditors'] : ['debtors', 'creditors'];
    rq.books = rq.books || {};
    rq.booksCountry = st || null;
    rs.json({ currency: B.curOf({ country: st && st.country && st.country.code }), asOf: agedAt(rq), parties: [], total_minor: 0, needs: { customer: sides.includes('debtors') ? Needs.sumNeeds([]) : null, supplier: sides.includes('creditors') ? Needs.sumNeeds([]) : null } });
  });
/**
 * ⭐ FIN-63 (5 Nov): A MONEY DOOR TAKES ONE KEY PER ATTEMPT. `client_ref` stops a second tap on POST /payments, but confirm had no replay
 * guard at all: a retry after a lost answer settled the bills twice from the same receipt. The four writes the web keys (web #447
 * idem:'attempt') now REQUIRE an Idempotency-Key — POST /payments · PATCH /payments/:id · POST /payments/:id/confirm · POST /gst/pay —
 * through the ONE gate (middleware/idempotency requireKey, the bearer form): no key → 422 IDEMPOTENCY_KEY_REQUIRED in words, BEFORE
 * the ledger's own gates; the same key again → the first answer, marked X-Idempotent-Replay. propose is a read and is not keyed.
 */
const onceOnly = require('../middleware/idempotency').requireKey();
const { textOf } = require('../lib/input-hygiene');
/** the ISO code of the country of the shop being read (the AUDITED shop's own, never the viewer's); null when the request carries none */
const countryOf = (req) => (req.booksCountry && req.booksCountry.country && req.booksCountry.country.code) || null;
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
    /* P-F-02 / S2-F-07: a start date chosen at the switch posts the bills from that day, through the ONE backfill (books-backfill) */
    const late = b.start_date ? await require('../lib/books-backfill').run(ctx(req), { start_date: String(b.start_date), by: byOf(req) }) : null;
    res.json({ ok: r.ok, accounts_added: r.accounts_added, fiscal_year: r.fiscal_year, parties_numbered: r.parties_numbered, backfill: late });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does A start date in -> we post every bill from that day through the one posting path, once, and say how many were posted, wait, or sit in the opening balances -> the counts and the words (owner only, safe to press again).
router.post('/backfill', auth, owner, on, ...checked('POST /backfill'), async (req, res) => {
  try {
    res.json(await require('../lib/books-backfill').run(ctx(req), { start_date: String((req.body || {}).start_date || ''), by: byOf(req) }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Nothing in -> we read the start day and how many bills before it are in the opening balances -> the start day and the words the Books screen says.
router.get('/backfill', auth, on, ...checked('GET /backfill'), async (req, res) => {
  try {
    res.json(await require('../lib/books-backfill').status(ctx(req)));
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

/** GET /daybook?from&to → { currency, country (the shop's ISO code), entries: [{ entry_no, posting_date, source_chit_id, source: { chit_id, ref, kind, counter, by, count, how, how_ref, split, doc_at, recorded_at } | null, narration, no_narration, recorded_at, made_by,
 *  lines: [{ code, name, party_id, party_name, dr_minor, cr_minor, counter, rate }] }] } — `source` is sourceOf(), read in the same query as the lines */
// @does A date range and page in -> we read every journal entry posted in those days with its lines and the bill behind it -> a page of day-book entries.
router.get('/daybook', auth, moneyReader, on, ...checked('GET /daybook'), async (req, res) => {
  try {
    const e = ctx(req),
      from = dateQ(req.query.from, today(req)),
      to = dateQ(req.query.to, from),
      pg = pageQ(req.query);
    const asked = await Daybook.sinceAsked(req, e);
    if (asked.refusal) return problem(req, res, asked.refusal);
    const since = asked.since;
    const sincePage = { limit: pageLimit.limitOf(req.query.limit, S.PAGE_DEFAULT, S.PAGE_MAX), page: pageLimit.pageOf(req.query.page) }; /* the changed list always pages (the default page, the server maximum) */
    let read = null;
    let markSide = null; /* MARK & QUERY: the marks of these entries, read in this same transaction (null while b868 is not run) */
    const out = await withEntity(e, async (h) => {
      read = await Daybook.linesRead(h, e, { since, sincePage, pg, from, to });
      const { lines, changed } = read;
      const names = await partyNames(h, e, lines.map((item) => item.party_id).filter(Boolean));
      const entries = Daybook.entriesOf(lines, names, since);
      if (since) entries.sort((x, y) => changed.ids.indexOf(x.entry_id) - changed.ids.indexOf(y.entry_id)); /* newest posted first, as the page was cut */
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
    const page = Daybook.pagePlace(since, read, sincePage, pg);
    /* S34: every key a page can add is named (an unpaged answer leaves them undefined, which JSON leaves out) */
    res.json(await forBooksDoor(req, e, 'daybook', { currency: curOf(req), country: countryOf(req) /* the AUDITED shop's own country: the Day book's weekend test uses its calendar, never the viewer's */, from, to, entries: out, count: out.length, total: page.total, page: page.page, limit: page.limit, next: page.next, totals: page.totals, mark_actions: markSide ? markSide.actions : undefined, mark_vocabulary: markSide ? markSide.vocabulary : undefined, seen_to: since ? read.changed.seen_to : undefined, since: since ? { at: since.at, never: since.never } : undefined }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/** GET /ledger/:account?party&from&to — :account is the code (1300), the role (debtors) or the id →
 *  { currency, account, opening_minor, lines: [{ date, what, ref, source_chit_id, source (as the day book), dr_minor, cr_minor, running_minor }], months: [{ month YYYY-MM, debit_minor, credit_minor, closing_minor }] (ACC-381, server totals of the whole range), closing_minor } */
// @does An account and optional party and dates in -> we read that account's lines with a running balance from its opening -> the ledger with opening, lines and closing.
router.get('/ledger/:account', auth, moneyReader, on, ...checked('GET /ledger/:account'), async (req, res) => {
  try {
    const e = ctx(req),
      to = dateQ(req.query.to, today(req)),
      from = dateQ(req.query.from, fyStart(req, to)),
      pg = pageQ(req.query);
    const party = UUID.test(textOf(req.query.party, { trim: false })) ? String(req.query.party) : null;
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
        lines, months: LedgerMonths.bands(open, await LedgerMonths.monthSums(h, e, from, to, a.account_id, party, !!lo.period0)),
        closing_minor: t ? open + t.dr - t.cr : run
      };
      await Evidence.attach(h, lines.map((x) => ({ item: x, chit_id: x.source && x.source.chit_id, ref: x.source && x.source.ref })), { flag: false });
      markSide = await marksIn(h, req, 'acc.audit', lines.map((item) => item.entry_id));
      if (markSide) for (const item of lines) item.mark = markSide.byId[String(item.entry_id)] || null;
      if (a.role === 'retained' && !party) base.carried = await B.carriedLine(h, e, from); /* YE-F-04: the roll that opens it, named — a computed line, not an entry */
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
    res.json(await forBooksDoor(req, e, 'ledger', { currency: curOf(req), account: out.account, party: out.party, from: out.from, to: out.to, opening_minor: out.opening_minor, lines: out.lines, months: out.months, closing_minor: out.closing_minor, page_opening_minor: out.page_opening_minor, total: out.total, page: out.page, limit: out.limit, next: out.next, totals: out.totals, mark_actions: markSide ? markSide.actions : undefined, mark_vocabulary: markSide ? markSide.vocabulary : undefined }, { account: out.chart_account }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/**
 * GET /evidence/:id → the file's bytes: a DOCUMENT file on a chit that is the source of an entry of THIS shop's books. The owner reads his own; a firm reads a member's through a live grant (X-Books-For, read only; the middleware logs the look and
 * refuses a revoked, expired or stranger caller with 403). Images and PDFs render inline, everything else downloads; never cached (a revoked grant must stop at once). A file that is not evidence answers 404 exactly as a file that is not there.
 */
// @does A file id in -> we serve it when it is a document file behind an entry of these books (read only, logged as a look under a grant) -> the file bytes.
router.get('/evidence/:id', auth, moneyReader, on, ...checked('GET /evidence/:id'), async (req, res) => {
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
router.get('/party/:id/statement', auth, moneyReader, on, ...checked('GET /party/:id/statement'), async (req, res) => {
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
/** RAIL-146i: the /dues answer for THIS reader — ONE can_see_costs read (lib/cost.isCostBlind, fail-closed); an actor without it sees no supplier-side money (lib/dues-view R1-R6); the owner's bytes are untouched */
async function forReader(req, e, answer) {
  return (await require('../lib/cost').isCostBlind(req, e)) ? require('../lib/dues-view').blindDuesAnswer(answer) : answer;
}
/*
 * ⭐ THE ONE DUE FIGURE (R73/R76): a party's open documents below are the NETTED bills (E.dues → books-engines.netOpen — net of its receipts on
 * account), so oldest_due, the age buckets, the interest and the early-pay offer all read what is really owed; balance_minor is the engine's by_party.
 */
// @does Customer or supplier side, optionally the finance view in -> we read who owes what by age (limits and interest for the owner only) -> the dues list.
router.get('/dues', auth, moneyReader, onDues, ...checked('GET /dues'), async (req, res) => {
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
      asOf = agedAt(req);
    const sides = req.query.side === 'customer' ? ['debtors'] : req.query.side === 'supplier' ? ['creditors'] : ['debtors', 'creditors'];
    const pay = fin && req.query.side === 'supplier'; /* F4 Payables: the supplier side of CB Finance */
    const { rows: out, payables, tbControl } = await withEntity(e, (h) => Dues.read(h, e, { req, fin, pay, sides, asOf, partyNames, control: req.query.control === '1' }));
    res.json(
      await forReader(req, e, {
        currency: curOf(req), asOf, parties: out, total_minor: moneyOps.sumMinor(out, curOf(req), (item) => item.balance_minor), needs: { customer: sides.includes('debtors') ? Needs.sumNeeds(out.filter((row) => row.side !== 'supplier')) : null, supplier: sides.includes('creditors') ? Needs.sumNeeds(out.filter((row) => row.side === 'supplier')) : null } /* a side not asked for is null, never a zero */, ...Dues.pageExtras(fin && sides.includes('debtors'), payables, out, sides, curOf(req)), ...(tbControl ? { tb_control: tbControl } : {})
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
router.get('/party/:id/bills', auth, moneyReader, on, ...checked('GET /party/:id/bills'), async (req, res) => {
  try {
    const e = ctx(req),
      id = String(req.params.id),
      side = req.query.side === 'supplier' ? 'supplier' : 'customer',
      asOf = agedAt(req);
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
    const reads = await mayReadMoney(req); /* the counts feed every seat's To do; the entries behind a count carry amounts, so only a money reader gets them (same gate as the day book) */
    res.json(await forBooksDoor(req, e, 'attention', await withEntity(e, (h) => Evidence.attentionIn(h, e, { pack: B.packOf(req.books), cur: curOf(req), queryIds }, from, to, reads ? req.query.kind : undefined, pg))));
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
// @does A horizon in days and a date in -> we read the cash held and what falls due in and out -> the cash position (owner only).
router.get('/cashflow', auth, moneyReader, on, ...checked('GET /cashflow'), async (req, res) => {
  try {
    if (await costBlindStops(req, res, ctx(req), REPORT_COST_BLIND_SAY)) return;
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

/**
 * GET /overview?period=week|mtd|quarter|ytd → { currency, period { word, from, to }, compare { how, from, to } | null, sales (SOLD, tax in: minor · prior · change_bp · through), bars[12], to_collect, to_pay, income · expenses · profit · gross · profit_share_bp, profit_by_month[12], cash (30 days), cost_hidden } — the owner's "How we are doing" (REQ-MIS-SHOWCASE, lib/books-mis).
 * ONE read, one transaction; every figure is the code its own page runs (the P&L, Dues, the cash view). A period it does not know is a 400, never the year to date. A reader without can_see_costs gets no costs, profit, to-pay or cash (cost_hidden); cash is also the owner's or a grant's.
 */
// @does A period word in -> we read sales, profit, owed, owing and cash ahead once, each by its own page's rule -> the overview for this reader.
router.get('/overview', auth, moneyReader, on, ...checked('GET /overview'), async (req, res) => {
  try {
    const misOverview = require('../lib/books-mis'),
      period = req.query.period === undefined ? 'ytd' : String(req.query.period);
    if (!misOverview.PERIODS.includes(period)) return refuse(req, res, 400, 'PERIOD_UNKNOWN', 'Pick week, month so far, quarter or year to date.');
    const e = ctx(req),
      asOfDay = today(req),
      seat = await misOverview.seatOf(req, e, isOwner);
    res.json(await withEntity(e, (handle) => misOverview.read(handle, e, req, { period, today: asOfDay, fyMonth: Number(fyStart(req, asOfDay).slice(5, 7)), seat })));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});

/** GET /trial-balance?asOf → { currency, asOf, rows: [{ code, name, dr_minor, cr_minor }], total_dr_minor, total_cr_minor, balanced, bank?: [{ account_id, code, name, currency, state: reconciled|unexplained|earlier|none_by_date|never|not_shared, period_to, statement_minor, books_signed_minor, unexplained_minor (absolute), books_now_minor, moved_minor, signed_at }] (rank 9: one line per bank account, the Bank page's own newest-sign-off rule; absent before b864) } */
// @does An as-at date in -> we read every account's debit and credit total -> the trial balance and whether it balances.
router.get('/trial-balance', auth, moneyReader, on, ...checked('GET /trial-balance'), async (req, res) => {
  try {
    if (await costBlindStops(req, res, ctx(req), REPORT_COST_BLIND_SAY)) return;
    const e = ctx(req),
      asOf = dateQ(req.query.asOf, today(req));
    const reportPeriod = require('../lib/books-report-period'),
      earlier = reportPeriod.yearBefore(asOf);
    const tb = await withEntity(e, async (h) => {
      const shared = await B.ledgerCtx(h, e); /* one context for both days: the chart, settings and carried years are read once */
      const out = await B.trialBalance(h, e, asOf, shared);
      /* leader-compare #2: the SAME as-at day one year earlier, one extra read; a day before the books began (or one that cannot be read) is no comparison, said: the page then draws no Last year column */
      const lastYear = await B.trialBalance(h, e, earlier, shared).catch(logger.orElse('Trial balance: the same day last year could not be read — the page shows no comparison', null));
      out.was = lastYear && (Number(lastYear.total_dr_minor) || Number(lastYear.total_cr_minor)) ? lastYear : null;
      const bank = await require('../lib/bank-rec-log').onTrialBalance(h, e, asOf, out.rows, await S.accounts(h, e), curOf(req)); /* RANK 9: the bank agreement, the Bank page's own rule (null before b864) */
      return Object.assign(out, { bank });
    });
    res.json(await forBooksDoor(req, e, 'trial_balance', {
      currency: curOf(req),
      asOf,
      shown_as_at: agedAt(req) /* F5 (17 Nov): the day a heading may say: the earlier of the day asked and the shop's today, the E1 rule (agedAt); the figures still read what was asked */,
      fy_from: fyStart(req, asOf) /* the year the as-at day is in: the year each line reads its entries from */,
      rows: reportPeriod.compareTrialRows(tb.rows, tb.was && tb.was.rows, curOf(req)).map((item) => ({ code: item.code, name: item.name, group: item.group, dr_minor: item.debit_minor, cr_minor: item.credit_minor, net_minor: item.net_minor, ...(tb.was ? { prior_net_minor: item.prior_net_minor, change_minor: item.change_minor, change_bp: item.change_bp, change_over: item.change_over } : {}) })),
      over_rule: reportPeriod.overRule(curOf(req)) /* ASA 520: the one threshold a change is highlighted at, as the P&L states it */,
      compare: tb.was ? { how: 'year', as_at: earlier } : null /* the day last year's figures are read at; null = no earlier figures (the first year of the books) */,
      total_dr_minor: tb.total_dr_minor,
      total_cr_minor: tb.total_cr_minor,
      balanced: tb.balanced,
      ...(tb.bank ? { bank: tb.bank } : {})
    }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /pl?from&to | ?preset&step&compare → { currency, income, expense, profit_minor, profit_share_bp, by_line (each head and ledger: prior_minor, change_bp, share_bp), period, presets, compare } (inside one financial year; ACC-357: the same range last year beside it) */
// @does A date range in -> we read the income and expense accounts for the period -> the profit and loss with the profit.
router.get('/pl', auth, moneyReader, on, ...checked('GET /pl'), async (req, res) => {
  try {
    if (await costBlindStops(req, res, ctx(req), REPORT_COST_BLIND_SAY)) return;
    const e = ctx(req),
      reportPeriod = require('../lib/books-report-period'),
      shopDay = today(req),
      fyMonth = Number(fyStart(req, shopDay).slice(5, 7));
    /* ACC-357 (W15-118): a preset (This year to date · Last month · Quarter · Last year) stepped with ‹ ›, the pack's own year; or any from/to — and always the same range last year beside it (or the span before, ?compare=period) */
    const picked = req.query.preset ? reportPeriod.periodOf({ preset: req.query.preset, step: req.query.step }, shopDay, fyMonth) : null;
    const to = picked ? picked.to : dateQ(req.query.to, shopDay),
      from = picked ? picked.from : dateQ(req.query.from, fyStart(req, to)),
      compareKind = ['year', 'period', 'none'].includes(req.query.compare) ? req.query.compare : 'year';
    const prior = compareKind === 'none' ? null : reportPeriod.priorOf({ from, to }, compareKind);
    const out = await withEntity(e, async (h) => {
      const now = await B.profitAndLoss(h, e, from, to);
      let priorPl = null;
      if (prior) priorPl = await B.profitAndLoss(h, e, prior.from, prior.to).catch(logger.orElse('P&L: the comparison range could not be read — the page shows no comparison', null)); /* a range that leaves the financial year, or years before the books began: no comparison, said */
      return { now, was: priorPl };
    });
    const pl = out.now,
      /* F-66: a comparison range that holds no income and no expense (before the books began) is NO comparison — never a "Last year A$0.00" with a change of the whole figure, like the trial balance and the balance sheet */
      priorPl = reportPeriod.withFigures(out.was);
    const withCompare = (lines, side) => reportPeriod.compareLines(lines, priorPl && (side === 'income' ? priorPl.income : priorPl.expenses), pl.total_income_minor, priorPl ? priorPl.total_income_minor : null, curOf(req));
    res.json(await forBooksDoor(req, e, 'pl', {
      currency: curOf(req),
      from,
      to,
      income: flat(pl.income),
      expense: flat(pl.expenses),
      total_income_minor: pl.total_income_minor,
      total_expense_minor: pl.total_expenses_minor,
      profit_minor: pl.profit_minor,
      gross_profit: reportPeriod.grossOf(flat(pl.income), flat(pl.expenses), curOf(req)) /* W18: sales less the cost of sales by account role; null when the period has no sales account */,
      profit_share_bp: reportPeriod.shareOf(pl.profit_minor, pl.total_income_minor, curOf(req)),
      total_income_share_bp: reportPeriod.shareOf(pl.total_income_minor, pl.total_income_minor, curOf(req)),
      total_expense_share_bp: reportPeriod.shareOf(pl.total_expenses_minor, pl.total_income_minor, curOf(req)),
      by_line: { income: withCompare(pl.income, 'income'), expense: withCompare(pl.expenses, 'expense') },
      over_rule: reportPeriod.overRule(curOf(req)) /* ASA 520: the one threshold a change is highlighted at, stated for the page's note */,
      period: Object.assign({ preset: picked ? picked.preset : 'custom', step: picked ? picked.step : 0, can_next: picked ? picked.can_next : false }, { from, to }, reportPeriod.throughOf(to, shopDay)) /* F-67: a range that runs past today says the day it is read to (the year box heads "1 Jul – 30 Jun" otherwise: the year to come) */,
      presets: reportPeriod.PRESETS.map(([id, label]) => ({ id, label })),
      compare: priorPl ? { how: compareKind, from: prior.from, to: prior.to, total_income_minor: priorPl.total_income_minor, total_expense_minor: priorPl.total_expenses_minor, profit_minor: priorPl.profit_minor, income_change_bp: reportPeriod.changeOf(pl.total_income_minor, priorPl.total_income_minor, curOf(req)), expense_change_bp: reportPeriod.changeOf(pl.total_expenses_minor, priorPl.total_expenses_minor, curOf(req)), profit_change_bp: reportPeriod.changeOf(pl.profit_minor, priorPl.profit_minor, curOf(req)), income_change_minor: moneyOps.diffMinor(pl.total_income_minor, priorPl.total_income_minor, curOf(req)), expense_change_minor: moneyOps.diffMinor(pl.total_expenses_minor, priorPl.total_expenses_minor, curOf(req)), profit_change_minor: moneyOps.diffMinor(pl.profit_minor, priorPl.profit_minor, curOf(req)), income_change_over: reportPeriod.overThreshold(pl.total_income_minor, priorPl.total_income_minor, curOf(req)), expense_change_over: reportPeriod.overThreshold(pl.total_expenses_minor, priorPl.total_expenses_minor, curOf(req)), profit_change_over: reportPeriod.overThreshold(pl.profit_minor, priorPl.profit_minor, curOf(req)) } : null
    }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
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
router.get('/bs', auth, moneyReader, on, ...checked('GET /bs'), async (req, res) => {
  try {
    if (await costBlindStops(req, res, ctx(req), REPORT_COST_BLIND_SAY)) return;
    const e = ctx(req),
      reportPeriod = require('../lib/books-report-period'),
      shopDay = today(req),
      fyMonth = Number(fyStart(req, shopDay).slice(5, 7));
    /* ACC-357 (W15-119): "as at" a shopDay, or a kind (today · month end · year end) stepped with ‹ ›; the prior month and the prior year beside it, in ONE view (beyond QuickBooks, which cannot) */
    const picked = req.query.kind ? reportPeriod.asAtOf({ kind: req.query.kind, step: req.query.step }, shopDay, fyMonth) : null;
    const asOf = picked ? picked.as_at : dateQ(req.query.asOf, shopDay);
    const out = await withEntity(e, async (h) => {
      const chart = await S.accounts(h, e),
        nature = new Map(chart.map((item) => [String(item.code), item.nature])),
        byCode = new Map(chart.map((item) => [String(item.code), item])),
        notes = statementNotes.netOfByRole((B.packOf(req.books).presentation || {}).taxNetting, chart);
      /* the heading a ledger sits under: the pack's own top group of the chart (never a word of ours) */
      const headOf = (code) => {
        let item = byCode.get(String(code));
        while (item && item.parent_code && byCode.get(String(item.parent_code))) item = byCode.get(String(item.parent_code));
        return item && item.code ? { code: String(item.code), name: item.name } : null;
      };
      const at = async (day0) => {
        const bs = await B.balanceSheet(h, e, day0, B.entityBasisOf(req.books)); /* undefined until the entity-type decision is taken → Schedule III */
        const left = flat(bs.liabilities),
          liabilities = statementNotes.withNetOf(left.filter((item) => item.code && nature.get(String(item.code)) !== 'equity'), notes),
          equity = left.filter((item) => !item.code || nature.get(String(item.code)) === 'equity');
        return { bs, assets: statementNotes.withNetOf(flat(bs.assets), notes), liabilities, equity, total_liabilities_minor: statementNotes.totalOf(liabilities, curOf(req)), total_equity_minor: statementNotes.totalOf(equity, curOf(req)) };
      };
      const now = await at(asOf);
      const earlier = {};
      for (const [key, day1] of [['month', reportPeriod.monthsBefore(asOf, 1)], ['year', reportPeriod.yearBefore(asOf)]]) earlier[key] = await at(day1).then((x) => Object.assign(x, { as_at: day1 })).catch(logger.orElse('Balance sheet: an earlier shopDay could not be read — its column is left out', null));
      const liabilities = bsTagged(now.liabilities, earlier, headOf, curOf(req)),
        equity = bsTagged(now.equity, earlier, headOf, curOf(req)),
        assets = bsTagged(now.assets, earlier, headOf, curOf(req));
      const groups = { assets: bsGroupsOf(assets), liabilities: bsGroupsOf(liabilities), equity: bsGroupsOf(equity) };
      const sumOf = (list) => moneyOps.sumMinor(list, curOf(req), (item) => item.amount_minor);
      const groups_ok = sumOf(groups.assets) === now.bs.total_assets_minor && sumOf(groups.liabilities) === now.total_liabilities_minor && sumOf(groups.equity) === now.total_equity_minor;
      const net_assets_minor = moneyOps.diffMinor(now.bs.total_assets_minor, now.total_liabilities_minor, curOf(req));
      const sides = (x) => (x ? { as_at: x.as_at, total_assets_minor: x.bs.total_assets_minor, total_liabilities_minor: x.total_liabilities_minor, total_equity_minor: x.total_equity_minor, net_assets_minor: moneyOps.diffMinor(x.bs.total_assets_minor, x.total_liabilities_minor, curOf(req)) } : null);
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
        over_rule: reportPeriod.overRule(curOf(req)) /* ASA 520: the one threshold a change is highlighted at */,
        balanced: now.bs.balanced,
        by_line: { assets: now.bs.assets, liabilities: now.bs.liabilities },
        schedule_iii: sched3(now.bs, Object.keys(B.packOf(req.books).sch3 || {}), curOf(req))
      };
    });
    res.json(await forBooksDoor(req, e, 'bs', Object.assign({ currency: curOf(req), asOf, shown_as_at: headingDay(asOf, req) /* P1-3: the day the heading may say (the one rule, headingDay) */, fy_from: fyStart(req, asOf), as_at: picked || { kind: 'custom', step: 0, as_at: asOf, can_next: false } }, out)));
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
/** FIN-79: the direction a payment body names — in or out; left out it is in; anything else (both) is null, a question */
const directionOf = (body) => (body.direction == null || body.direction === 'in' ? 'in' : body.direction === 'out' ? 'out' : null);
/** the payment question a body asks — shared by /payments/preview and /payments; a refusal is { status, words } */
function paymentQuestion(req, needMode, fxRate) {
  const body = req.body || {},
    currency = String(curOf(req)).toUpperCase();
  const party = String(body.party_id || body.party || '');
  if (!UUID.test(party)) return { refuse: { status: 400, words: 'Which party?' } };
  const paidIn = paidInOf(body, currency, fxRate);
  if (paidIn.refuse) return paidIn;
  const amount_minor = minorAsked(body, paidIn.currency);
  if (!(amount_minor > 0)) return { refuse: { status: 400, words: 'How much?' } };
  const direction = directionOf(body);
  if (!direction) return { refuse: { status: 400, words: 'Is this money in or out?' } };
  const mode = knownMode(body, req.books);
  if (needMode && !mode) return { refuse: { status: 400, words: 'Paid how — ' + P().modeList(P().modesOf(req.books, { cheque: true })) + '?' } };
  const allocate = allocateOf(body);
  const allocations = Array.isArray(body.allocations) && body.allocations.length ? body.allocations : null;
  return { party, direction, amount_minor, cur: paidIn.currency, ledger: currency, mode, allocate, allocations, country: req.books && req.books.country };
}
/** ⭐ ACC-377: the currency a payment is made in — a FOREIGN one only when it states the bank's rate (fx_rate); without one the ledger's own currency is the only one */
function paidInOf(body, ledgerCurrency, fxRate) {
  const asked = String(body.currency || '').toUpperCase();
  if (!asked || asked === ledgerCurrency) return { currency: ledgerCurrency };
  if (fxRate == null || fxRate === '') return { refuse: { status: 422, words: 'This ledger is kept in ' + ledgerCurrency + '.' } };
  return { currency: asked };
}
/** M30: the advice, ready to send — from the facts just written (no second read of the bills); a replay carries none (its row already answers), nor does a foreign payment yet (its words say the rate) */
async function adviceOf(req, handle, entity, facts) {
  const { question, rec, payer, date, reference } = facts;
  if (rec.payment.duplicate || rec.fx) return null;
  const paid = { payment_id: rec.payment.payment_id, party_id: question.party, direction: question.direction, amount_minor: question.amount_minor, currency: question.cur, mode: question.mode, reference: reference || null, received_at: date };
  return B.adviceFor(handle, entity, paid, {
    level: levelOf(req),
    me: await meName(req, handle, entity),
    names: payer.names,
    ready: await S.adviceReady(handle, entity),
    settled: rec.outcome.settled,
    on_account_minor: rec.outcome.on_account_minor,
    entry_no: rec.posted && rec.posted.entry_no,
    entry_id: rec.posted && rec.posted.entry_id
  });
}
/** a recorded payment's outcome in words: foreign → lib/books-fx-payment (the settlement's figures), any other → books.paymentOutcome */
function outcomeFor(handle, entity, question, rec, name) {
  const paid = { party_id: question.party, direction: question.direction, amount_minor: question.amount_minor, mode: question.mode };
  if (rec.fx) return require('../lib/books-fx-payment').fxPaymentOutcome(handle, entity, { ...paid, currency: question.ledger }, rec.payment.payment_id, rec.allocation, name, rec.fx);
  return B.paymentOutcome(handle, entity, { ...paid, currency: question.cur }, rec.payment.payment_id, rec.allocation, name);
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
/** MONEY-01 A7: the four reports show costs and margins, so a reader without can_see_costs is refused in these words (fail closed; no cost-stripped variant) */
const REPORT_COST_BLIND_SAY = 'Your access does not include costs and margins, so this report is hidden.';
/** B3: a kept bank statement shows every supplier payment, so a reader without can_see_costs is refused (403 COST_BLIND) — the SAME ONE test /bank/rail asks (lib/cost.isCostBlind, fail-closed; a grant's can_see_costs rides the acting identity). true = answered. */
async function costBlindStops(req, res, e, words) {
  if (!(await require('../lib/cost').isCostBlind(req, e))) return false;
  const said = words || require('../lib/cost').COST_BLIND_READ_SAY;
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
      const marking = (req.body || {}).checks === true ? await require('../lib/bill-checks').attach(h, e, req, prop, { pack: B.packOf(req.books), cur: curOf(req) }) : null;
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
        mark_actions: marking ? marking.mark_actions : undefined,
        checks: marking ? true : undefined /* says the rows below carry the bill checks, so a caller never mistakes an older answer for "every bill paid" */
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
/** the bills a payment body names: { against_ref, amount_minor } with the money rounded to the shop's currency; null when the body names none */
const allocationsOf = (body, currency) =>
  Array.isArray(body.allocations)
    ? body.allocations.filter((item) => item && typeof item === 'object').map((item) => ({ against_ref: String(item.against_ref || ''), amount_minor: moneyOps.roundMinor(item.amount_minor, currency) }))
    : null;
// @does A party, amount and mode in -> we record money received or paid and settle open bills (a cheque waits until it clears); a repeat is ignored -> the payment and what it settled (editors).
router.post('/payments', auth, noKey, editor, onceOnly, on, ...checked('POST /payments'), async (req, res) => {
  try {
    const e = ctx(req),
      b = req.body || {},
      q = paymentQuestion(req, true, b.fx_rate);
    if (q.refuse) return refuseQuote(req, res, q.refuse);
    const { party, direction, amount_minor, cur, mode, allocate } = q;
    const date = dateQ(b.received_at || b.date, today(req));
    const chq = b.cheque && typeof b.cheque === 'object' ? b.cheque : {};
    const client_ref = clientRef(b.client_ref);
    const ack = Array.isArray(b.acknowledge) ? b.acknowledge : []; /* a code, or { code, over_minor } — books.acknowledgements reads both */
    const allocations = allocationsOf(b, curOf(req));
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
        fx_rate: b.fx_rate, settles: b.settles, setting: req.books, /* ACC-377: the bank's rate, or how much foreign bill this payment settles */
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
      if (!rec.payment.duplicate) rec.outcome = await outcomeFor(h, e, q, rec, name);
      rec.advice = await adviceOf(req, h, e, { question: q, rec, payer: who, date, reference: b.reference });
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
router.get('/bank/rail', auth, moneyReader, on, ...checked('GET /bank/rail'), async (req, res) => {
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
async function bankAccountOf(handle, e, key, write) {
  const chart = await S.accounts(handle, e),
    account = BANK_LOG.accountIn(chart, key);
  if (!account) throw Object.assign(new Error('That bank account was not found.'), { code: 'BOOKS_NOT_FOUND' });
  return write ? BANK_LOG.bankOnly(chart, account) : account; /* BA-F-07: a mark or a sign-off only on a bank ledger */
}
/** POST /bank/marks { account, file_hash?, marks: [{ act: accept|undo|note|attach, key, how?, chits?, ledger?, text?, ref? }] } → { marks: [row], by, at } — editor; insert-only, one transaction. `by` and `at` are the server's. */
// @does A bank account and marks (accept, undo, note, attach) in -> we append them to that account's reconciliation log -> the saved marks (editors).
router.post('/bank/marks', auth, noKey, editor, bankWriter, on, ...checked('POST /bank/marks'), async (req, res) => {
  try {
    const e = ctx(req),
      body = req.body || {};
    const marks = await withEntity(e, async (handle) => BANK_LOG.appendMarks(handle, e, await bankAccountOf(handle, e, body.account, true), body, byOf(req), actingOf(req)));
    res.status(201).json({ marks });
  } catch (err) {
    if (err && err.code === 'BOOKS_NOT_MIGRATED') return problem(req, res, { status: 503, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* before b864: the shared record is not set up, in words (the same answer refusalOf gives) */
    if (err && err.code === 'NOT_A_BANK_ACCOUNT') return problem(req, res, { status: 409, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* BA-F-07 */
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /bank/statements { account, period_from, period_to, opening_minor, closing_bank_minor, closing_books_minor, difference_minor, currency, file_hash } → { statement } — editor; the carried BRS figures, a re-sign is a new row. */
// @does A bank account with its period, opening and closing balances in -> we store the reconciled statement in the log -> the saved statement (editors).
router.post('/bank/statements', auth, noKey, editor, bankWriter, on, ...checked('POST /bank/statements'), async (req, res) => {
  try {
    const e = ctx(req),
      body = req.body || {};
    const statement = await withEntity(e, async (handle) => BANK_LOG.appendStatement(handle, e, await bankAccountOf(handle, e, body.account, true), curOf(req), body, byOf(req), actingOf(req)));
    res.status(201).json({ statement });
  } catch (err) {
    if (err && err.code === 'BOOKS_NOT_MIGRATED') return problem(req, res, { status: 503, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* before b864: the shared record is not set up, in words (the same answer refusalOf gives) */
    if (err && err.code === 'CURRENCY_MISMATCH') return problem(req, res, { status: 409, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message, field: err.field } }); /* a statement in another currency than the account's (the same answer refusalOf gives) */
    if (err && (err.code === 'BANK_FIGURES_DONT_ADD' || err.code === 'NOT_A_BANK_ACCOUNT')) return problem(req, res, { status: 409, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* BA-F-07: figures that do not add, or an account that is not a bank */
    if (err && err.code === 'BOOKS_FIGURE_DIFFERS') return problem(req, res, { status: 409, code: err.code, detail: err.message, legacy: { code: err.code, error: err.message, message: err.message } }); /* WALK U U-F-02: the books' figure on that day is not the one this statement was worked against, in words */
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
const bankStatementFile = require('../lib/bank-statement-file');
const bankStatementPage = require('../lib/bank-statement-page');
/** a refusal of the box as a verdict: its code and the line the box wrote (bankStatementFile.verdictOf), with the old {error, message, field, existing_id} keys beside it; the exception's own text is never sent */
const statementBody = (box) => ({ code: box.code, detail: box.line, legacy: { code: box.code, error: box.line, message: box.line, field: box.field, existing_id: box.existing_id } });
/** a refusal of the box answers as its verdict (its own status, code and written line); anything else is the books' general mapping */
function statementFail(req, res, err) {
  const box = bankStatementFile.verdictOf(err);
  if (box) return problem(req, res, Object.assign({ status: box.status }, statementBody(box)));
  return problem(req, res, refusalOf(err, req));
}
/** the writer's stamp from the SESSION and the live grant (never the body): { user, name, firm, grant_id } */
const stampOfReq = (req) => Object.assign({ user: byOf(req), name: (req.identity && req.identity.display_name) || null, firm: null, grant_id: null }, actingOf(req) ? { firm: actingOf(req).firm, grant_id: actingOf(req).grant_id } : {});
/** POST /bank/statement-files { account, label?, period_from, period_to, currency, sha256, name, text } → 201 { file, overlaps: [{ id, name, period_from, period_to }], words } — the owner, or an adviser under a live grant (X-Books-Role: adviser). csv/json/txt, at most 6 MB; the sha256 is of the UTF-8 text and is recomputed here (HASH_MISMATCH); the same file on the same account is ALREADY_IN_BOX 409; a crossing period is stored with overlaps: true and the answer says so; another currency than the account's is CURRENCY_MISMATCH 409. */
// @does A bank account, its period, the file's text and its sha256 in -> we keep the file against that account and period (duplicate refused, overlap flagged) -> the kept file.
router.post('/bank/statement-files', auth, noKey, editor, bankWriter, on, ...checked('POST /bank/statement-files'), async (req, res) => {
  try {
    const e = ctx(req),
      body = req.body || {};
    if (!body.account) return statementFail(req, res, bankStatementFile.refuse('Which bank account is this statement for? Pick one before it is kept.', 'ACCOUNT_NEEDED', 400));
    const account = await withEntity(e, (handle) => bankAccountOf(handle, e, body.account));
    res.status(201).json(await bankStatementFile.add(withEntity, e, account, curOf(req), body, stampOfReq(req)));
  } catch (err) {
    const box = bankStatementFile.verdictOf(err); /* the box's own refusals that are not a bad question, each with its status named here: the same file twice, a file over 6 MB, a type that is no statement, the box not ready or the file not kept */
    if (box && box.status === 409) return problem(req, res, { status: 409, ...statementBody(box) });
    if (box && box.status === 413) return problem(req, res, { status: 413, ...statementBody(box) });
    if (box && box.status === 415) return problem(req, res, { status: 415, ...statementBody(box) });
    if (box && box.status === 503) return problem(req, res, { status: 503, ...statementBody(box) });
    statementFail(req, res, err);
  }
});
/** GET /bank/statement-files?accounts=<codes>&months=6&to=YYYY-MM[&limit=25&after=<cursor>&q=<search>][&asOf=YYYY-MM-DD → also signed_as_at: { asOf, accounts: [{ account_id, currency, period_to, statement_minor, books_signed_minor, unexplained_minor (absolute: the remainder after the timing items, NOT statement minus books), tied, made_at }] } = the sign-off of each account on or before that day, newest period end first (the ONE rule, LATEST_SQL)] (a limit pages the files, newest first: lib/bank-statement-page; the cells and the count always cover the whole window) → { currency, today, months, accounts: [{ account_id, code, name, label }], cells: [{ account_id, month, missing, file_ids }], unexplained: { accounts: [{ account_id, currency, unexplained_minor, to }], by_currency: [{ currency, unexplained_minor, to }], currency, unexplained_minor, to, count } (the newest sign-off of each account: the practice list's own rule), files: [{ id, account_id, label, period_from, period_to, name, size, source, overlaps, by_name, by_firm, for_client, added_at, read_at, reads }], older } — the page's own bank list names the accounts; a month with no file reads missing. Two reads. */
// @does A list of bank accounts and a run of months in -> we say which statement files are kept for each account and month, and which months are missing -> the account by month list.
router.get('/bank/statement-files', auth, noKey, on, ...checked('GET /bank/statement-files'), async (req, res) => {
  try {
    const e = ctx(req),
      months = bankStatementFile.windowOf(req.query, today(req)),
      asked = textOf(req.query.accounts, { trim: false }).split(',').map((item) => item.trim()).filter(Boolean).slice(0, 60);
    if (await costBlindStops(req, res, e)) return;
    const out = await withEntity(e, async (handle) => {
      const chart = await S.accounts(handle, e);
      const accounts = asked.map((key) => BANK_LOG.accountIn(chart, key)).filter((item, at, all) => item && all.indexOf(item) === at);
      const box = req.query.limit != null ? await bankStatementPage.list(handle, e, { accounts, chart, months, limit: req.query.limit, after: req.query.after, q: req.query.q }) : await bankStatementFile.list(handle, e, { accounts, chart, months });
      return Object.assign(box, { unexplained: await BANK_LOG.unexplained(handle, e) }, req.query.asOf ? { signed_as_at: await BANK_LOG.signedAsAt(handle, e, dateQ(req.query.asOf), chart) } : {}); /* the practice list's own rule (newest sign-off per account, in its currency): one figure per account and per currency, never added across */
    });
    res.json(Object.assign({ currency: curOf(req), today: today(req), may: { write: require('../lib/access').mayWrite(req), post: postVerdict(req) } /* W26: the Bank page draws Add / Match / Sign off from what the server says this seat may do */ }, out)); /* today = the shop's day (the one clock), so a month not over yet is told by the server's day, never the browser's */
  } catch (err) {
    const box = bankStatementFile.verdictOf(err);
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
    const out = await bankStatementFile.open(withEntity, e, id, req.query.use === 'read' ? 'read' : 'download', stampOfReq(req));
    if (!out) return refuse(req, res, 404, 'NOT_FOUND', 'Not found', 'No such statement in this shop.');
    require('../lib/attachment-send').sendBlob(res, out.file, { cache: 'private, no-store' });
  } catch (err) {
    const box = bankStatementFile.verdictOf(err);
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
router.get('/cheques', auth, moneyReader, on, ...checked('GET /cheques'), async (req, res) => {
  try {
    const e = ctx(req),
      all = textOf(req.query.all, { trim: false }) === '1',
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
    res.json({ events: grid.events, picks: grid.picks, pending: grid.pending, golden: grid.golden, may: { post: postVerdict(req) } });
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
    const out = await M().preview(ctx(req), req.books, req.body || {}, { owner: isOwner(req) || isInHouseAccountant(req) /* W25: the same seats POST /events lets post, so the first step tells the truth */, by: byOf(req) });
    res.json({ ok: out.ok, kind: out.kind, voucher: out.voucher, date: out.date, lines: out.lines, balanced: out.balanced, totals: out.totals, credit: out.credit, bill: out.bill, flags: out.flags, refusals: out.refusals, code: out.code, needs: out.needs || null, duplicate: out.duplicate });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /events { event: kind, …fields, client_ref } → the entry (MJ/<fy>/<n>, its voucher type kept). The owner and the shop's Bookkeeper; the same client_ref answers the first entry, duplicate: true. SHOPBK-B: when the shop asked the owner to approve (policy_flags.books_owner_approves), the BOOKKEEPER's press answers 202 with the held action (nothing is posted; the owner accepts it in the queue); the owner's own post and the setting off are unchanged. */
// @does A manual event with its fields and a client_ref in -> we post it once as a journal entry -> the entry number (owner only).
router.post('/events', auth, noKey, ownerOrAccountant, on, ...checked('POST /events'), require('../lib/books-approval').heldGate('event', refusalOf), async (req, res) => {
  try {
    const out = await M().post(ctx(req), req.books, req.body || {}, byOf(req));
    res.json({ kind: out.kind, ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: out.note, warnings: out.warnings });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/* ── owner writes: manual entry, reversal, write-off, opening, months ────────────────────────────────────────── */
const givenLines = (list, currency) => require('../lib/books-manual').givenLines(list, currency); /* ONE reader of a typed journal's lines — the ＋ Entry builder uses it too */
// @does Typed journal lines in -> we post them as a manual journal entry -> the entry (owner only).
router.post('/entries', auth, ownerOrAccountant, on, ...checked('POST /entries'), require('../lib/books-approval').heldGate('journal', refusalOf), async (req, res) => {
  try {
    const b = req.body || {};
    /* against_ref (F4): the bill this journal settles — postEntry sets the party line against it (itemsFor → confirmItems), as a write-off does.
       CB Finance · Payables sends the early-pay discount this way: Dr the supplier against the bill · Cr Discount received (books-payables.view `record`). */
    const entity = ctx(req);
    const ref = clientRef(b.client_ref);
    const event = {
      type: 'manual',
      owner: true,
      narration: require('../lib/books-input').narration(b.narration) || undefined,
      date: dateQ(b.date, today(req)),
      currency: curOf(req),
      strict_date: true,
      lines: givenLines(b.lines, curOf(req)),
      ref: b.ref || null,
      source_ref: ref ? 'manual:' + ref : null,
      by: byOf(req),
      against_ref: b.against_ref ? String(b.against_ref).slice(0, 120) : null
    };
    /* R12a, GOR-03: the same client_ref with ANOTHER journal is 409 EVENT_REF_REUSED naming the entry_no (the one compare, books-event-guard.onSeen, under the ref's lock); the same journal replays */
    const out = await B.postEntry(null, entity, event, { onSeen: (handle, seen) => require('../lib/books-event-guard').onSeen(handle, entity, event, seen) });
    /* the writer's answer, key for key (a replay has duplicate and no doc_date; a switched-off ledger has off): named so the allow-list reads them */
    res.json({ ok: out.ok, off: out.off, duplicate: out.duplicate, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: out.posting_date, doc_date: out.doc_date, moved: out.moved, lines: out.lines, items: out.items, note: out.note });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /entries/:id/reverse { reason } → the mirror entry (never an edit) and, in the SAME transaction, the party rows that reopen the bills it had settled:
 *  { ok, entry_id, entry_no, posting_date, moved, reverses, reverses_entry_id, items, reopened: [{ against_ref, bill_no }], words }.
 *  M29: an entry already reversed answers 409 ALREADY_REVERSED naming the reversal (a second Reverse is not a replay — it would be a second correction). */
// @does An entry id and a reason in -> we post its reversal and reopen the bills it settled, refusing a second reversal -> the reversal entry (the owner and the shop's Bookkeeper; held for the owner's OK when the shop asked).
router.post('/entries/:id/reverse', auth, ownerOrAccountant, on, ...checked('POST /entries/:id/reverse'), LiveBill.refuseLiveBill, require('../lib/books-approval').heldGate('reverse', refusalOf), async (req, res) => {
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
    const ref = clientRef(b.client_ref);
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
router.post('/opening', auth, ownerOrAccountant, openingGate, on, ...checked('POST /opening'), async (req, res) => {
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
const { moveInBody, moveInPlan } = require('../lib/books-movein'); // the move-in doors' shared reads and the plan
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
   files, kept insert-only (b309 books_compare_part), NEVER posted. Who may: the money readers (moneyReader: the owner, the shop's accountant or bookkeeper, a live grant, the shop's auditor); the server answers may + why, the screen greys with the sentence. ── */
const PR = require('../lib/parallel-run');
const COMPARE_NOT_READY = waiting('The books comparison', false, 'It was not run and nothing was posted.');
/** the shop's auditor: a whole-entity login whose identity row says can_see_costs (lib/access + lib/cost, read from the DB — never the preset's own flag). ONE test for compare and the returns. */
async function auditorMay(req, e) {
  return require('../lib/access').seesWholeEntity(req.identity) && (await require('../lib/cost').canRead(req, e));
}
/* compare and the returns read behind the ONE money-reader gate (moneyReader: owner, the shop's accountant or bookkeeper, a live grant, the auditor): READ_MONEY_WORDS is the sentence it answers with */
const notMigrated = () => {
  const x = new Error(COMPARE_NOT_READY);
  x.code = 'BOOKS_NOT_MIGRATED';
  return x;
};
/** GET /compare → { currency, ready, why, may: { load: { may, why } }, snapshots: [{ snapshot_id, label, source, period_from, period_to, currency, parts, lines, created_at }] } — one transaction */
// @does Nothing in -> we list the parallel-run snapshots loaded from the old package -> the snapshots and whether the caller may load more.
router.get('/compare', auth, noKey, on, moneyReader, ...checked('GET /compare'), async (req, res) => {
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
router.post('/compare/preflight', auth, noKey, on, moneyReader, ...checked('POST /compare/preflight'), async (req, res) => {
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
router.post('/compare/snapshots', auth, noKey, on, moneyReader, ...checked('POST /compare/snapshots'), async (req, res) => {
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
        ledgerCopy = await taxCopy.ledgerFor(e, fetched.to.slice(0, 7), { carriedItc: true });
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
router.get('/compare/:id', auth, noKey, on, moneyReader, ...checked('GET /compare/:id'), async (req, res) => {
  try {
    res.json(await compareRead(req));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /compare/:id/csv → the same compare as a .csv for the auditor's file */
// @does A snapshot id in -> we make the same comparison as above -> a CSV file for the auditor.
router.get('/compare/:id/csv', auth, noKey, on, moneyReader, ...checked('GET /compare/:id/csv'), async (req, res) => {
  try {
    const r = await compareRead(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="parallel-run-' + r.snapshot.period_to + '.csv"');
    res.send(PR.csv(r, r.currency));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
const reopenLimiter = require('../lib/rate-limit').namedLimiter({ name: 'books-reopen', perMin: 10, env: 'BOOKS_REOPEN_PER_MIN', by: 'business', message: 'Open a month or a year again in a minute.' }); /* column rate_limited: a reopen moves the lock date back, so it has its own small budget */
/** POST /periods/:fy/:p/reopen { reason } → { ok, fiscal_year, period, status } — the owner opens the LAST hard-locked month again (a month a year close locked opens with its year) */
// @does A hard-locked month and a reason in -> we open it again if it is the last locked month, and log it -> the month (owner only).
router.post('/periods/:fy/:p/reopen', auth, owner, on, ...checked('POST /periods/:fy/:p/reopen'), reopenLimiter, async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy) || !/^\d{1,2}$/.test(req.params.p)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const month = await B.reopenMonth(null, ctx(req), req.params.fy, Number(req.params.p), byOf(req), (req.body || {}).reason);
    res.json({ ok: month.ok, fiscal_year: month.fiscal_year, period: month.period, status: month.status });
  } catch (err) { problem(req, res, refusalOf(err, req)); }
});
/** POST /periods/:fy/:p/lock { reason, hard } · /unlock { reason } → { period: { fiscal_year, period, status } } */
// @does A year, a month and lock or unlock in -> we lock (soft or hard) or reopen that month with a reason -> the month's status (owner only).
router.post('/periods/:fy/:p/:act', auth, owner, on, ...checked('POST /periods/:fy/:p/:act'), async (req, res) => {
  try {
    const { fy, p, act } = req.params;
    if (!/^\d{4}(-\d{2})?$/.test(fy) || !/^\d{1,2}$/.test(p) || ['lock', 'unlock'].indexOf(act) < 0) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const b = req.body || {};
    const status = act === 'unlock' ? 'open' : b.hard === true ? 'hard_locked' : 'soft_locked';
    const r = await B.setPeriod(null, ctx(req), fy, Number(p), status, byOf(req), b.reason, { amendTax: act === 'unlock' && b.amend_tax === true });
    res.json({ ok: true, period: { fiscal_year: r.fiscal_year, period: r.period, status: r.status } });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /year/:fy/close { returns_lodged?: true — the owner says this year's returns were lodged outside the books, so none is re-prepared (PAST-YEARS; recorded on every month and in the change log) } → { ok, fiscal_year, next, locked, opening, warnings: [{ name, count, why }] — waiting actions · bank not reconciled · the auditor's open queries: named, never a gate } · refused (422) with { refusals: [{ name, why }] } in plain words · a closed year answers { ok, duplicate: true } */
// @does A financial year in -> we close the year, carry the opening balances forward and lock it, or refuse with plain reasons -> the result (owner only).
router.post('/year/:fy/close', auth, owner, on, ...checked('POST /year/:fy/close'), async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const r = await B.closeYear(null, ctx(req), req.params.fy, byOf(req), { returnsLodged: (req.body || {}).returns_lodged === true, req });
    if (r.ok) return res.json({ ok: r.ok, duplicate: r.duplicate, declared: r.declared, returns_lodged: r.returns_lodged, fiscal_year: r.fiscal_year, next: r.next, locked: r.locked, opening: r.opening, warnings: r.warnings || [] });
    const message = r.refusals.map((x) => x.why).join(' '),
      legacy = { ok: false, fiscal_year: r.fiscal_year, error: message, message, refusals: r.refusals };
    /* ACC-204: a tax period of the year not closed yet names the answer (the screen opens Tax close on the code); every other refusal stays YEAR_CLOSE_REFUSED */
    if (r.refusals.some((x) => x.name === 'return_open')) return problem(req, res, { status: 422, code: 'PERIOD_RETURN_OPEN', detail: message, legacy });
    problem(req, res, { status: 422, code: 'YEAR_CLOSE_REFUSED', detail: message, legacy });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /year/:fy/reopen { reason } → { ok, fiscal_year, reopened } — the owner opens the NEWEST closed year again (logged; posting opens; close again as before) */
// @does A closed year and a reason in -> we open that year again if it is the newest closed one, and log it -> the year (owner only).
router.post('/year/:fy/reopen', auth, owner, on, ...checked('POST /year/:fy/reopen'), reopenLimiter, async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const year = await B.reopenYear(null, ctx(req), req.params.fy, byOf(req), (req.body || {}).reason);
    res.json({ ok: year.ok, fiscal_year: year.fiscal_year, reopened: year.reopened });
  } catch (err) { problem(req, res, refusalOf(err, req)); }
});
/** GET /year/:fy/status → { fiscal_year, closed, closed_with? { at, by, by_name, how, profit_minor? } (a closed year's evidence), can_close, can_close_if_lodged, reclosing, refusals, warnings, months, next } — what a close would say, nothing written */
// @does A financial year in -> we read what a close would say, writing nothing -> closed, can_close, the refusals and the months.
router.get('/year/:fy/status', auth, moneyReader, on, ...checked('GET /year/:fy/status'), async (req, res) => {
  try {
    if (!/^\d{4}(-\d{2})?$/.test(req.params.fy)) return refuse(req, res, 404, 'NOT_FOUND', 'Not found');
    const e = ctx(req);
    const { st, closedEvent } = await withEntity(e, async (h) => {
      const state = await B.yearState(h, e, req.params.fy, { warn: true, req });
      return { st: state, closedEvent: state.closed ? await S.yearCloseEvent(h, e, state.fiscal_year) : null };
    });
    res.json({
      fiscal_year: st.fiscal_year,
      closed: st.closed,
      ...(st.closed ? { closed_with: require('../lib/books-year-past').closedWith(closedEvent, st.rows, st.carry, req.reads_money, curOf(req)) } : {}), /* YE-F-06: the closed year's evidence */ returns_lodged: st.returns_lodged === true, reclosing: st.reclosing === true && !st.closed,
      can_close: st.can_close && !st.closed, can_close_if_lodged: st.can_close_if_lodged && !st.closed,
      refusals: st.closed ? [] : st.refusals,
      warnings: st.closed ? [] : st.warnings || [],
      months: st.months,
      next: st.next
    });
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
// @does Optionally a year in -> we read each month's lock state, figures (sales_minor is ex-tax, the P&L's income, since 15 Nov 2026), tax return state and change trail -> the periods.
router.get('/periods', auth, periodsReader, on, ...checked('GET /periods'), async (req, res) => {
  try {
    const e = ctx(req);
    const fy = req.query.fy ? String(req.query.fy) : null;
    const { rows, figures, setting, taxStates, trail, marks } = await withEntity(e, async (h) => {
      const all = await S.periods(h, e, null),
        books = await B.settingOf(h, e);
      const figures = await S.periodFigures(h, e, null); /* every year: the books start and the lock line are read across years, whatever year the page asks */
      /* REP-69 A: the months are chosen by entries, not by an SV sum: a bank-fed client has income and no SV entry. ONE-FIGURE: a month's "sales" is the profit and loss's income for that month (its total_income_minor: the sales ledgers, before tax) — the entry totals the store sums carry the tax in them, so they only count the entries */
      const byMonth = new Map(all.map((item) => [item.fiscal_year + '|' + Number(item.period), item]));
      const withSales = !req.reads_money ? [] : figures.filter((x) => x.entries > 0 && byMonth.get(x.fiscal_year + '|' + x.period) && Number(x.period) >= 1);
      const monthlyPl = await B.profitAndLossMonths(h, e, withSales.map((x) => { const month = byMonth.get(x.fiscal_year + '|' + x.period); return { from: E.ymd(month.start_date), to: E.ymd(month.end_date) }; })); /* ONE read of the lines for every month, the P&L engine once per month */
      withSales.forEach((item, n) => { item.sales_minor = Number(monthlyPl[n].total_income_minor || 0); item.profit_minor = Number(monthlyPl[n].profit_minor || 0); /* C-F-01: income less expenses, before tax, from the same P&L read: a month of rent and fees is a loss, not "no income" */ });
      const marks = req.query.marks ? await require('../db').trySavepoint(h, () => require('../lib/books-period-choices').checkedByMonth(h, e, all, figures), null) : null; /* a read that fails inside the transaction is rolled back to its savepoint: the picker then names no count. ?marks=1: each month's checked n of m (review-mark's rule, one read) */
      return { rows: all, figures, setting: books, taxStates: await P().returnStatesFor(h, e, books, all), trail: await S.lockTrail(h, e, fy), marks };
    });
    /* the dates as dates ('YYYY-MM-DD'), never a Date through JSON — that is the day before, east of UTC */
    const dated = rows.map((item) => Object.assign({}, item, { start_date: E.ymd(item.start_date), end_date: E.ymd(item.end_date) }));
    /* ACC-204: the tax periods of every year the rows hold, each with its form, so a month's lock advice names the period it ends in */
    const taxPeriods = [].concat(...Array.from(taxStates.values()).map((state) => state.periods.map((item) => Object.assign({ form: state.form }, item))));
    /* M157: entries + sales per month, and what each month may do (the server's one rule — B.periodAdvice) */
    const shopDay = require('../lib/books-hooks').dayOf(CLOCK.now(), setting),
      periodChoices = require('../lib/books-period-choices'),
      lockLine = B.booksLockLine(dated, figures),
      advised = require('../lib/books-month-advice').seatAnswer(B.periodAdvice(dated, figures, shopDay, taxPeriods, trail), { owner: isOwner(req), why: require('../lib/access').canEdit(req.identity) ? SAID.ownerOnly : 'View-only: you can read the books, not change them.' }); /* GREY-AU: Lock / Open again are the owner's: any other seat is told so, in its words */
    /* the year under review ({ fy, from, to }) is the server's, from the months as stored: every view of a firm opens on it (W15 / W17) */
    const shown = stripFigures(req, req.query.marks ? periodChoices.withChecked(advised, marks) : advised); /* STAFF-BOOKS: the months without their figures for a seat that may not read them */
    res.json(Object.assign({ under_review: periodChoices.underReview(B.markBeforeBooks(dated, lockLine.books_start), shopDay), years: periodChoices.yearsOf(shown, shopDay), periods: shown.filter((item) => !fy || item.fiscal_year === fy) }, lockLine)); /* W22: books_start · lock_date · gaps, the one lock line */
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
    res.json(await forBooksDoor(req, ctx(req), 'todo', await require('../lib/books-todo').todo(ctx(req), req.books, undefined, require('../lib/books-approval').isBookkeeperSeat(req) ? byOf(req) : null)));
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
/** POST /assets { name, class, cost | bill, date, put_to_use?, how | party_id, client_ref } → the purchase entry (MJ) and the register row · { existing: true, name, class, cost, accumulated?, date (before the books began), put_to_use? } → an opening entry and the row */
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
/** GET /depreciation/schedule?fy&through → { currency, fy, through, entity_basis, basis_assumed, basis_rule, assets: [{ asset_id, name, asset_class, put_to_use, cost_minor, rate_pct, ytd_minor, posted_minor, due_minor, wdv_after_minor }], by_class: [{ class, due_minor }], total_due_minor } — the depreciation to a day, posting nothing */
// @does A financial year and a day in -> we work out each asset's depreciation to that day and what is still to post -> the schedule, nothing posted (owner only).
router.get('/depreciation/schedule', auth, owner, on, ...checked('GET /depreciation/schedule'), async (req, res) => {
  try {
    res.json(await P().depreciationSchedule(ctx(req), req.books, { fy: req.query.fy, through: req.query.through }));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** POST /depreciation/run { fy, through? } → one entry dated `through` (a month end; the year end when left out) with what the earlier runs of the year have not charged; says which entity basis it used */
// @does A financial year and an optional day in -> we post the depreciation to that day from the register in one entry, once per day -> the entry (owner only).
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
router.get('/returns', auth, moneyReader, on, ...checked('GET /returns'), async (req, res) => {
  try {
    const form = await P().taxReturn(ctx(req), req.books, req.query || {});
    /* the pack's return, every key it can carry named (S34); a key this return does not carry is undefined, and JSON leaves it out */
    // prettier-ignore
    res.json({ currency: form.currency, pack: form.pack, form: form.form, name: form.name, short: form.short, authority: form.authority, portal: form.portal, prepared: form.prepared, asked: form.asked, needs: form.needs, why: form.why, periods: form.periods, period: form.period, boxes: form.boxes, payable_minor: form.payable_minor, refund_minor: form.refund_minor, net_minor: form.net_minor, notes: form.notes, cite: form.cite, unsupported_input: form.unsupported_input, needs_answer: form.needs_answer, emirates: form.emirates, staggers: form.staggers });
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
/** GET /loans?page&limit → { loans: [{ ref, lender, opening_minor, outstanding_minor, currency, taken_on }], total, page, limit } — the bank line's loan picker; owner, a live grant or the shop's auditor (moneyReader, DEC-268); under the global limiter (api-global) */
// @does Optionally a page and a limit in -> we read each loan's opening and what is still owed from the posted journal -> the loans, a page at a time.
router.get('/loans', auth, moneyReader, on, ...checked('GET /loans'), async (req, res) => {
  try {
    res.json(await P().listLoans(ctx(req), req.books, req.query));
  } catch (err) {
    problem(req, res, refusalOf(err, req));
  }
});
/** GET /gst/lodged → { currency, periods: [{ period, net_minor, closed_at, source }], note } — the net each tax close carried, for the periods of a year the owner declared lodged; closed_at is the CLOSE date, never a lodgement date; owner, a live grant or the shop's auditor (moneyReader) */
// @does Nothing in -> we read the stored tax close of each period of a year declared lodged -> the period, the net it carried and the close date.
router.get('/gst/lodged', auth, moneyReader, on, ...checked('GET /gst/lodged'), async (req, res) => {
  try {
    res.json(await P().lodgedPeriods(ctx(req), req.books));
  } catch (err) {
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
    /* ⭐ ACC-377 (d): ?from=AUD&suggest_for=2026-11-01 — a day with no rate gets the newest earlier one (within 7 days) as a SUGGESTION the owner confirms by adding it; never applied by itself */
    const suggestion = ready && req.query.from && req.query.suggest_for ? await withEntity(e, (handle) => FXR.suggest(handle, e, textOf(req.query.from).toUpperCase(), curOf(req), textOf(req.query.suggest_for))) : null;
    res.json({
      ...(req.query.suggest_for ? { suggestion } : {}),
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
module.exports.gates = { noKey, editor, on, owner, moneyReader };
module.exports.alreadyPaid = alreadyPaid;
