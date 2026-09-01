/**
 * offerable.test.cjs — "do we know what this is" and "may somebody take one now" are DIFFERENT questions.
 *
 * ⚠️⚠️ WHY THIS EXISTS: I SHIPPED THE WRONG PREDICATE AND REPORTED IT DONE. Athi asked *"if stock unavailable is
 * set, then it should not appear at all for the customer to select"*, and I gated the storefront on
 * `isMatchable`. MATCHABLE deliberately INCLUDES `unavailable`, so out-of-stock products went on being listed
 * and ordered. The function did exactly what its own file says; I read the name and not the set. Nothing failed,
 * nothing logged, and the feature looked finished.
 *
 * ⭐ AND isMatchable MUST NOT BE "FIXED" TO AGREE. Its behaviour is correct and load-bearing: an out-of-stock
 * tomato named in a WhatsApp message has to keep resolving, or the request comes back "no catalogue match" —
 * indistinguishable from a product nobody sells — and silently loses the item.
 *
 *   isMatchable  available · unavailable      → the matcher: record what was asked for, flagged
 *   isOfferable  available                    → browsing and ordering: what a customer may take now
 *
 * These tests exist to stop anyone collapsing the two back into one.
 *
 * Run: node --test tests/offerable.test.cjs
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const itemstatus = require('../lib/itemstatus');
const availability = require('../lib/availability');

test('unavailable still MATCHES — an out-of-stock item is not an unknown item', () => {
  assert.strictEqual(itemstatus.isMatchable({ status: 'unavailable' }), true,
    'the matcher must still resolve it, or the request silently loses the line');
});

test('unavailable is NOT OFFERABLE — the customer may not select it', () => {
  assert.strictEqual(itemstatus.isOfferable({ status: 'unavailable' }), false);
});

test('the two predicates disagree on exactly one status, and that is the point', () => {
  const differ = itemstatus.STATUSES.filter(
    (s) => itemstatus.isMatchable({ status: s }) !== itemstatus.isOfferable({ status: s }));
  assert.deepStrictEqual(differ, ['unavailable'],
    'if these ever agree everywhere, one of them has been quietly redefined');
});

test('an absent status is available, and is both matchable and offerable', () => {
  /* Every row predates the field. A migration that had to touch all of them to say "normal" is a migration that
     could get it wrong — so absent means available, at both gates. */
  assert.strictEqual(itemstatus.statusOf({}), 'available');
  assert.strictEqual(itemstatus.isMatchable({}), true);
  assert.strictEqual(itemstatus.isOfferable({}), true);
});

test('retired and redundant fail both gates', () => {
  for (const s of ['retired', 'redundant']) {
    assert.strictEqual(itemstatus.isMatchable({ status: s }), false, s);
    assert.strictEqual(itemstatus.isOfferable({ status: s }), false, s);
  }
});

/* ── the opt-in flag ───────────────────────────────────────────────────────────────────────────────────────── */

test('countedZero: absent is NOT zero', () => {
  /* ⚠️ THE WHOLE REASON IT IS A FUNCTION AND NOT `!qty`. Athi: *"there are business no stock gets updated…
     ours is not an inventory system"*. Most shops keep no feed, so "nobody said" must not read as "none left" —
     `!qty` would answer true for every product in every one of them. */
  assert.strictEqual(availability.countedZero({}), false, 'no feed at all');
  assert.strictEqual(availability.countedZero({ avail: null }), false, 'null feed');
  assert.strictEqual(availability.countedZero({ avail: {} }), false, 'feed with no qty');
  assert.strictEqual(availability.countedZero({ avail: { qty: 'x' } }), false, 'unreadable qty');
});

test('countedZero: a real zero is a real answer', () => {
  assert.strictEqual(availability.countedZero({ avail: { qty: 0 } }), true);
  assert.strictEqual(availability.countedZero({ avail: { qty: 5 } }), false);
});

test('qty_zero_hides is OFF by default — the explicit marker is the source of truth', () => {
  const policy = require('../lib/policy');
  assert.strictEqual(policy.FLAGS.qty_zero_hides.def, 'off',
    'CB does not run stock; deriving availability from a number nothing maintains retires live products');
  assert.deepStrictEqual(policy.FLAGS.qty_zero_hides.options, ['off', 'on']);
});
