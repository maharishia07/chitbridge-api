'use strict';
/**
 * lib/money-roles.js — ONE-FIGURE RC9 (Athi 28 Nov 2026, batch 1141): the ledger roles that ARE money, listed ONCE.
 * OWNER    cb-accounting
 * RISK     money
 * FLOW     the three lists -> the cash-flow rows, the practice cash balance, the counter tender sums and the tax-settlement reader (a role outside them is never summed as money)
 * OWNS     CASH_ROLES (cash · bank · upi · card: what a receipt or payment posts to; the cash balance) · TENDER_ROLES (what came in across the counter = the same four) · MONEY_ROLES (the cash roles + bank_od, the overdraft: what a tax settlement moves)
 * CALLED BY books-cashflow · books-practice (cash balance) · books-store (tenders, sold-by-day) · books-period-taxed (settled tax)
 * CARD     14-accounting/ledger-accounts-day-book-entries-reverse
 * The overdraft is money for a tax payment's other side but is NOT cash on hand: that one difference is named here, never a second hand-kept list.
 */
const CASH_ROLES = Object.freeze(['cash', 'bank', 'upi', 'card']);
const TENDER_ROLES = CASH_ROLES;
const MONEY_ROLES = Object.freeze(CASH_ROLES.concat('bank_od'));
module.exports = { CASH_ROLES, TENDER_ROLES, MONEY_ROLES };
