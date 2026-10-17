/* ADOPTED from chitbridge-engines v1.64.1 · accounts-packs · sha256 68f8d1b497ddf1862a3ef7129a3ac5339851afaa96437ee1cbcc02cceb36707c — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · accounts-packs. Edited ONLY in chitbridge-engines/src/accounts-packs.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS] A country's chart of accounts as DATA — groups (Tally's 28), numbered ledgers, expense and income
// @stage-note classes, the Schedule III line and SAF-T grouping beside every code, the fiscal year and the number formats.
// @stage-note The posting engine reads it; nothing here posts anything. tests/accounts-packs.test.js holds it whole.
/**
 * accounts-packs.js — WHAT A COUNTRY'S LEDGERS ARE CALLED, NUMBERED AND HOW THEY BEHAVE, AS DATA (v1.8.0, 2026-09-29).
 *
 * Athi, 2026-09-28: *"we don't claim as an accounting system until we are well confident, but still record the information
 * according to principle."* — and 2026-09-29: *"a proper number for the ledger for each person, sale / purchase, and income,
 * expenses. so we can very quickly aggregate against portfolio … find out the entire logic from standard or other
 * implementations so we don't do anything different."* [SPEC-books-v2.md §2 · RESEARCH-ledger-design-2026-09-29.md §6.2]
 * ⚠️⚠️ THIS IS NOT A CLAIM TO BE ACCOUNTING SOFTWARE. It names and numbers ledgers the way a CA already reads them.
 *
 * v1.20.0: RCM payable ledgers 2204 / 2205 / 2206 (reverse charge, cash only).
 * v1.16.0: GST Compensation Cess ledgers 2203 / 2213; the Insurance expense class (6140); voucherNo(series, fy, n) + VOUCHER_SERIES + MANUAL_SERIES.
 *
 * ⭐ INDIA FIRST, AS DATA ([[feedback-country-first]]) — a country is an ENTRY here, never a branch in posting.js.
 *
 * ── A LEDGER ROW (v1.8.0) ──────────────────────────────────────────────────────────────────────────────────────
 *   role   what a posting rule names — 'debtors', 'output_cgst', 'rent' … (v1.7.0 called this `code`; the VALUES are
 *          unchanged, so every rule keeps working). Rules name ROLES, never numbers (SAP account determination,
 *          ERPNext/Odoo account_type): a shop may renumber and no rule moves.
 *   code   the 4-digit ledger number, first digit = class (1 assets · 2 liabilities · 3 equity · 4 income · 5 purchases
 *          and direct costs · 6 indirect expenses · 9 memo) — the common SME convention (QuickBooks/Xero, SKR04/PCG class
 *          order). India prescribes no numbers; Schedule III fixes only the statement lines, stored beside the code.
 *   group  the Tally group it sits under (Tally's 28 predefined groups — what every Indian CA reads)
 *   sch3   the Schedule III (Division I) line it lands on · saft {category, code} — the grouping a SAF-T-shaped export
 *          uses (India has no SAF-T mandate; the OECD shape is used as a completeness checklist, research offload §1)
 *
 * ── A GROUP ────────────────────────────────────────────────────────────────────────────────────────────────────
 *   type    personal (Dr the receiver, Cr the giver) · real (Dr what comes in, Cr what goes out) · nominal (Dr expenses
 *           and losses, Cr incomes and gains) — the golden rule a line follows
 *   nature  asset · liability · equity · income · expense — where it lands in a trial balance
 *   side    'dr' or 'cr' — its NORMAL balance
 *   range   [lo, hi] — the codes a ledger under this group may take; a shop's own ledger gets the next free one
 */

/* ⭐ v1.21.0 (core-vs-packs a2): THE DATA MOVED. The chart (Tally's groups, the ledgers, the expense and income classes), the Schedule III lines and the
   depreciation tables are the India regulation pack now — src/reg-in.js, cut and pasted, the same literals. This file is the FACADE over the registry
   (src/regulation.js): the same exports, the same answers, and the mechanisms below. PACKS.IN and SCH3 are those very objects. */
var REG_ = (typeof CBRegulation !== 'undefined' && CBRegulation && CBRegulation.lookup) ? CBRegulation : null;
if (!REG_ && typeof require === 'function') REG_ = require('./regulation');
const DEFAULT_COUNTRY = REG_.DEFAULT;
const PACKS = {};
REG_.list().forEach(function (p) { PACKS[p.id] = p; });
const SCH3 = PACKS[DEFAULT_COUNTRY].sch3;

/** the pack for a country — or the default one, said so (`fallback: true`), never silently */
function packFor(country) { return REG_.lookup(country); }
/* ⭐ v1.22.0 (core-vs-packs b1): THE MECHANISM MOVED to src/chart.js (CBChart): a ledger by role or code, the tree, the next free code, a shop's own ledgers, the calendar
   and the voucher number — cut and pasted, reading a pack's OWN fiscalYear and voucherFormat, with no default year in it. The functions below are the same names with the same
   answers, for every caller that was written before: a pack with only `fy_start_month` (an entity's own start month) is read as that month, and no pack at all as the default one. */
var CHART_ = (typeof CBChart !== 'undefined' && CBChart && CBChart.accountOf) ? CBChart : null;
if (!CHART_ && typeof require === 'function') CHART_ = require('./chart');
const D_ = PACKS[DEFAULT_COUNTRY];
/** the year a legacy call means: the pack's own fy_start_month when it has one (an entity may start its year elsewhere), else its fiscalYear, else the default pack's */
function yearOf_(pack) {
  const p = pack || {}, base = p.fiscalYear || D_.fiscalYear, start = p.fy_start_month || base.startMonth;
  return { fiscalYear: { startMonth: start, label: p.fy_start_month && p.fy_start_month !== base.startMonth ? (start === 1 ? 'single' : 'split') : base.label } };
}
const groupOf = CHART_.groupOf, accountOf = CHART_.accountOf, tree = CHART_.tree, nextCode = CHART_.nextCode, withAccounts = CHART_.withAccounts;
const dayOf = CHART_.dayOf, partyNo = CHART_.partyNo;
function fiscalYearOf(date, pack) { return CHART_.fiscalYearOf(date, yearOf_(pack)); }
function periodOf(date, pack) { return CHART_.periodOf(date, yearOf_(pack)); }
function fyRange(fy, pack) { return CHART_.fyRange(fy, yearOf_(pack)); }
function periodRange(fy, period, pack) { return CHART_.periodRange(fy, period, yearOf_(pack)); }
function fyLabel(y, pack) { return CHART_.fyLabel(y, yearOf_(pack)); }
/** ⭐ voucherNo('SV', '2026-27', 41) → 'SV/2026-27/000041' — in the shape of the pack given (the default pack when none) */
function voucherNo(series, fy, n, pack) { return CHART_.voucherNo(series, fy, n, pack || D_); }
/** ⭐ jvNo('2026-27', 123) → 'JV/2026-27/000123' — the Journal series; kept as it was (vouchers already numbered JV/ keep their numbers). voucherNo('JV', …) is the same answer. */
function jvNo(fy, n) { return voucherNo(D_.voucherSeries.Journal, fy, n); }
/** the voucher types and their series, and the single series of a person's own entry — the default pack's (a pack names its own) */
const VOUCHER_SERIES = D_.voucherSeries;
const MANUAL_SERIES = D_.manualSeries;

const EXPORTS = { PACKS, DEFAULT_COUNTRY, SCH3, packFor, groupOf, accountOf, tree, nextCode, withAccounts,
                  dayOf, fiscalYearOf, periodOf, fyRange, periodRange, fyLabel, partyNo, jvNo, voucherNo, VOUCHER_SERIES, MANUAL_SERIES };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBAccountsPacks. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBAccountsPacks = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
