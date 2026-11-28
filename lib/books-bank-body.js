'use strict';
/**
 * lib/books-bank-body.js — THE ONE TEST of "is this the bank page's own event body" (BB-P1-2, 28 Nov 2026; moved out of middleware/books-grant.js so one definition serves three callers).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      bankEventBody(body) · bankLineBody(body) · BANK_EVENT_KINDS · FOREIGN_EVENT: the shape an outside firm may send for a bank line (client_ref bank:…, one of the four kinds, none of the foreign keys).
 * CALLED BY middleware/books-grant.js (the direct door under adviser_posts, and each line of a proposal under owner_approves) · lib/books-action.js (prepareAction: a firm's `event` action must pass it, so the queue is no wider than the direct door).
 * ⚠️ Pure and body-only: it never reads the request or the grant. Law is not a switch: nothing here changes what a posting is.
 */
const BANK_EVENT_KINDS = ['expense', 'other_income', 'contra', 'tax_payment'];
/* the writer resolves the kind and the ref from inner `event`/`type` too (lib/books-manual eventOf): a body that carries any of these keys is not the bank page's body and is refused whole */
const FOREIGN_EVENT = ['event', 'type', 'lines', 'voucher_type', 'supplier', 'party', 'party_id', 'bill', 'against_ref', 'customer'];
/** a bank line's body names its line (client_ref 'bank:…') and, for a locked month, only the one word the owner sends (if_locked next_open) */
function bankLineBody(body) {
  return !!body && typeof body === 'object' && /^bank:[0-9a-z:_-]{1,75}$/i.test(String(body.client_ref || '')) && (body.if_locked === undefined || body.if_locked === 'next_open');
}
/** the bank page's event body: a bank line's reference, no foreign key, one of the four kinds */
function bankEventBody(body) {
  return bankLineBody(body) && !FOREIGN_EVENT.some((key) => body[key] !== undefined) && BANK_EVENT_KINDS.includes(String(body.kind || ''));
}
module.exports = { bankEventBody, bankLineBody, BANK_EVENT_KINDS, FOREIGN_EVENT };
