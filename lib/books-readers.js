'use strict';
/**
 * CARD 04-books/books-reads
 * books-readers.js — the two read gates of the Books page (SEC-161, BOOKS-GATE, STAFF-BOOKS), split out of routes/books.js so that file does not grow (rule: split, don't raise).
 *
 * OWNS      mayReadMoney (the ONE test of who reads the ledger's money) · moneyReader (the gate of /trial-balance, /pl, /bs, /year/:fy/status) · periodsReader (the gate of /periods) · stripFigures
 * CALLED BY routes/books.js (readers(deps) once, at load; the route's own isOwner / auditorMay / ctx / problem / refusalOf are passed in, never copied)
 * FLOW      a request ──▶ mayReadMoney: never a key, then the owner · a live grant (middleware/books-grant stamps acting_for_grant only from the live grant row) · the shop's own auditor (whole-entity + can_see_costs) ──▶ next, or OWNER_ONLY in words
 *
 * SEC-161 + BOOKS-GATE (OWASP API5:2023; ISO 27001 A.5.15, A.8.3): the ledger's MONEY reads are the owner's, the owner's own accountant's (RC-7, 19 Nov), a live grant's and the auditor's. A plain staff seat, and a key, are refused in words (the one OWNER_ONLY code, the one may/why shape).
 * It runs BEFORE the ledger switch, so a refusal never says whether the ledger is on.
 * STAFF-BOOKS: the months list (boundaries, locked yes/no, year labels) is not money, so every signed-in seat reads it (the Day book's period picker needs it); only a key-bearer is refused. periodsReader is therefore NOT a role gate
 * (no `roleGate` tag: it refuses no role, the route's role-matrix row is ANY_BOTH_READ); the figure on a month (sales_minor) stays for the money readers: req.reads_money says which reply this seat gets.
 */
const { isInHouseAccountant } = require('./owner');
const READ_MONEY_WORDS = "Only the owner, the shop's accountant or bookkeeper, or the shop's auditor may read these figures."; /* the ONE sentence: the same list mayReadMoney lets through (owner · in-house accountant · live grant · auditor); web's BK_READ_WORDS is its fallback twin */

/** readers(deps) → { mayReadMoney, moneyReader, periodsReader, stripFigures }: the Books page's two read gates and the figure stripper, built once from the route's own isOwner / roleGate / problem / refusalOf / ctx / auditorMay */
function readers({ isOwner, roleGate, problem, refusalOf, ctx, auditorMay }) {
  /** the ONE test of who reads the ledger's money (moneyReader and the months list both ask it): never a key, then the owner · the owner's own accountant (RC-7) · a live grant · the shop's own auditor */
  const mayReadMoney = async (req) => !req.api_key && (isOwner(req) || isInHouseAccountant(req) /* RC-7: the owner's own accountant */ || !!req.acting_for_grant || (await auditorMay(req, ctx(req))));
  const refuse = (req, res) => problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: READ_MONEY_WORDS, legacy: { error: READ_MONEY_WORDS, message: READ_MONEY_WORDS, may: false, why: READ_MONEY_WORDS } });
  const moneyReader = roleGate('reader', async (req, res, next) => {
    try {
      if (await mayReadMoney(req)) return next();
      return refuse(req, res);
    } catch (err) {
      problem(req, res, refusalOf(err, req));
    }
  });
  const periodsReader = async (req, res, next) => {
    try {
      if (req.api_key) return refuse(req, res);
      req.reads_money = await mayReadMoney(req);
      next();
    } catch (err) {
      problem(req, res, refusalOf(err, req));
    }
  };
  /** the months without their figures for a seat that may not read them (STAFF-BOOKS) */
  const stripFigures = (req, list) => (req.reads_money ? list : list.map((item) => { const { sales_minor, profit_minor, ...noFigures } = item; return noFigures; }));
  return { mayReadMoney, moneyReader, periodsReader, stripFigures };
}

module.exports = { readers, READ_MONEY_WORDS };
