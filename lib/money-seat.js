'use strict';
/**
 * CARD 04-books/books-reads
 * money-seat.js — the ONE question "does the books' own gate refuse this seat?", asked by every route that is not the Books page but shows books money (drift 19b, 35a; 28 Nov 2026).
 *
 * OWNER     cb-security
 * RISK      money · security
 * OWNS      noMoney(req) (the answer routes/books gates.mayReadMoney gives, turned round; lazy so a route file loads without books.js) · MONEY_SEAT_ROUTES (the routes that answer through it, read by tests/money-seat-guard.test.cjs)
 * CALLED BY routes/crm.js (GET /parties, /parties/:id) · routes/relationships.js (GET /customers) · routes/kyb.js (GET /risk) · routes/entities.js (GET /usage)
 * FLOW      a request ──▶ noMoney(req) ──▶ true: the route masks its figures with lib/dues-view (noMoneyRow · noMoneyRisk: null + cost_hidden:true) · false: the figures as they were
 *
 * ⭐ ONE DECISION: who reads the ledger's money is lib/books-readers.mayReadMoney (owner · in-house accountant · live grant · the shop's auditor; never a key). This file never re-decides it (OWASP API3:2023 property level, API5:2023; NIST SP 800-162: the PDP is one function).
 * ⭐ A NEW ROUTE that returns a customer's balance or a trade total adds itself to MONEY_SEAT_ROUTES and calls noMoney; the guard fails a listed route that does not, and any route file that returns balance_minor / total_value and is not listed.
 */
const noMoney = async (req) => !(await require('../routes/books').gates.mayReadMoney(req));

/** route file → the route lines whose answer carries books money for a reader the books refuse (the guard reads each handler for `noMoney`) */
const MONEY_SEAT_ROUTES = [
  { file: 'routes/crm.js', route: "router.get('/parties'" },
  { file: 'routes/relationships.js', route: "router.get('/customers'," },
  { file: 'routes/kyb.js', route: "router.get('/risk'" },
  { file: 'routes/entities.js', route: "router.get('/usage'" } /* drift 15: billing cost is withheld from a seat the books refuse; the shop's ledger is read for every seat */
];

module.exports = { noMoney, MONEY_SEAT_ROUTES };
