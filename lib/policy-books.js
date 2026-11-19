'use strict';
/**
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 * policy-books.js — the shop's "owner approves" rule for its own Bookkeeper (SHOPBK slice B, 19 Nov 2026), split out of lib/policy.js so that file does not grow (rule: split, don't raise; the sign-in rows did the same).
 *
 * OWNS      the FLAGS row books_owner_approves and its CARD row. 'on' = the shop's own Bookkeeper seat PREPARES a Day book entry and the OWNER accepts it (lib/books-approval.js); default off = the Bookkeeper posts, as before.
 * CALLED BY lib/policy.js (flagsFor(owner) spread into FLAGS, CARD spread into CARD; the owner-only words stay policy.js's MONEY_TAX_OWNER, passed in, never restated here)
 * FLOW      lib/policy.js FLAGS/CARD ──▶ the one PATCH /api/entities/policy ──▶ lib/books-approval.approvalOn reads it server-side
 * ⚠️ NOT the grant's `posting` owner_approves (lib/books-grant.js): that is a per-grant choice for an OUTSIDE adviser firm; this is the shop's own layer and binds its own staff seat.
 */
/** the FLAGS row; `owner` = policy.js's who-may-change data (the shop's money, tax and books settings are the owner's) */
const flagsFor = (owner) => ({ books_owner_approves: { type: 'enum', options: ['off', 'on'], def: 'off', ...owner } });

const CARD = {
  books_owner_approves: {
    label: 'Bookkeeper entries need your OK',
    level: 'entity',
    gov: 'entity',
    labels: { off: 'Bookkeeper posts', on: 'You OK first' },
    help: 'Off — your Bookkeeper posts Day book entries. On — an entry your Bookkeeper saves waits for your OK and posts only when you accept it. Entries you post yourself are never held.'
  }
};
module.exports = { flagsFor, CARD };
