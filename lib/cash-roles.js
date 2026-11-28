'use strict';
/**
 * lib/cash-roles.js - the ONE list of the ledgers that ARE cash (ONE-FIGURE RC9, 28 Nov 2026 drift exit; docs/one-figure/cash-roles.json guards it).
 * OWNS      CASH_ROLES (cash · bank · upi · card: the roles every pack posts a receipt or a payment to) · MONEY_ROLES (those, plus the overdraft ledger a settlement can also move)
 * CALLED BY books-cashflow (the cash view's opening) · books-store (the counter's takings, the day book's tenders) · books-period-taxed (the money side of a tax settlement) · folder-inventory (the receipts folder) · books-practice (via books-cashflow)
 * CARD      16-finance/cash-position
 * Leaf module: it requires nothing, so every reader can import it. A fifth hand-typed list of these roles fails tests/one-figure-cash.test.cjs.
 */
const CASH_ROLES = Object.freeze(['cash', 'bank', 'upi', 'card']);
const MONEY_ROLES = Object.freeze(CASH_ROLES.concat('bank_od'));
module.exports = { CASH_ROLES, MONEY_ROLES };
