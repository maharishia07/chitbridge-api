'use strict';
/**
 * beckn-map.test.js — the mapping, and the boundary it must not cross.
 *
 * The load-bearing tests are not "a field maps". They are:
 *   · a CB-only field CANNOT reach the wire, even when present on the chit
 *   · the supplier's currency is final, and a mismatch is refused rather than converted
 *   · an unknown state moves nothing
 * Those three are the difference between adopting a protocol and being absorbed by one.
 */
const assert = require('assert');
const M = require('../lib/beckn-map');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

/** A confirm shaped like the one captured live on 2026-08-05. */
const CONFIRM = {
  context: { domain: 'retail:1.1.0', action: 'confirm', version: '1.1.0',
    bap_id: 'mock-bap.local', bap_uri: 'http://bap.local/cb', bpp_id: 'chitbridge.local',
    transaction_id: 'txn-1', message_id: 'msg-1', timestamp: '2026-08-05T10:00:00Z', ttl: 'PT30S' },
  message: { order: { id: 'ord-9', state: 'Created',
    items: [{ id: 'I1', descriptor: { name: 'Tussar' }, quantity: { count: 4 } }],
    quote: { price: { currency: 'INR', value: '3800.00' } },
    billing: { name: 'Buyer' }, fulfillments: [{ type: 'Delivery' }], payments: [{ status: 'NOT-PAID' }],
    cancellation_terms: [{ cancellation_fee: { amount: { currency: 'INR', value: '100' } } }] } },
};

console.log('\nbeckn-map');

// ── the table is the documentation ──────────────────────────────────────────────────────────────────────────
t('every rule declares beckn, cb, dir and seen', () => {
  for (const r of M.RULES) {
    assert.ok('beckn' in r && 'cb' in r, `rule missing a side: ${JSON.stringify(r)}`);
    assert.ok(['in', 'out', 'both', 'none'].includes(r.dir), `bad dir "${r.dir}" on ${r.beckn || r.cb}`);
    assert.ok(['live', 'spec', 'cb'].includes(r.seen), `bad seen "${r.seen}" on ${r.beckn || r.cb}`);
  }
});
t('a rule with no Beckn side and no CB side would be meaningless', () => {
  for (const r of M.RULES) assert.ok(r.beckn || r.cb, 'a rule must name at least one side');
});
t('print() renders without notes and stays readable', () => {
  const out = M.print({ notes: false });
  assert.match(out, /BECKN\s+CHITBRIDGE\s+DIR\s+SEEN/);
  assert.match(out, /★ CB-ONLY/);
});

// ── Beckn → chit ────────────────────────────────────────────────────────────────────────────────────────────
t('transaction_id becomes the chit id — the conversation, not the step', () => {
  assert.strictEqual(M.toChit(CONFIRM, { currency: 'INR' }).chit_id, 'txn-1');
});
t('message_id is kept for correlation but is NOT the identity', () => {
  const c = M.toChit(CONFIRM, { currency: 'INR' });
  assert.strictEqual(c.summary_json.beckn.message_id, 'msg-1');
  assert.notStrictEqual(c.chit_id, 'msg-1');
});
t('confirm → purpose "order"; init → "offer"', () => {
  assert.strictEqual(M.toChit(CONFIRM, { currency: 'INR' }).purpose, 'order');
  assert.strictEqual(M.ACTION_TO_PURPOSE.init, 'offer');
});
t('line items carry name, qty and their Beckn ref', () => {
  const li = M.toChit(CONFIRM, { currency: 'INR' }).line_items[0];
  assert.deepStrictEqual(li, { name: 'Tussar', qty: 4, ref: 'I1' });
});
t('the price STRING is parsed to a number, never adopted as text', () => {
  const c = M.toChit(CONFIRM, { currency: 'INR' });
  assert.strictEqual(c.total_value, 3800);
  assert.strictEqual(typeof c.total_value, 'number');
  assert.strictEqual(c.currency_code, 'INR');
});
t('billing / fulfillments / payments are carried whole, not acted on', () => {
  const c = M.toChit(CONFIRM, { currency: 'INR' });
  assert.deepStrictEqual(c.business_json.billing, { name: 'Buyer' });
  assert.ok(c.business_json.payments, 'payments recorded');
});

// ── the currency rule — supplier is final ───────────────────────────────────────────────────────────────────
t('⚠ a mismatched currency is REFUSED, not converted', () => {
  try { M.toChit(CONFIRM, { currency: 'USD' }); assert.fail('should throw'); }
  catch (e) {
    assert.strictEqual(e.status, 409);
    assert.strictEqual(e.claimed, 'INR');
    assert.strictEqual(e.governed, 'USD');
    assert.match(e.message, /comes from the business, not the message/);
  }
});
t('an unparseable price withholds the total and SAYS so', () => {
  const msg = JSON.parse(JSON.stringify(CONFIRM));
  msg.message.order.quote.price.value = 'lots';
  const c = M.toChit(msg, { currency: 'INR' });
  assert.strictEqual(c.total_value, null);
  assert.ok(c.warnings.some((w) => /not a number/.test(w)));
});

// ── unknown vocabulary moves nothing ────────────────────────────────────────────────────────────────────────
t('an unknown order.state changes no status, and warns', () => {
  const msg = JSON.parse(JSON.stringify(CONFIRM));
  msg.message.order.state = 'Awaiting-Camel';
  const c = M.toChit(msg, { currency: 'INR' });
  assert.strictEqual(c.current_status, null, 'a guessed transition on a co-held record is worse than none');
  assert.ok(c.warnings.some((w) => /unknown order.state/.test(w)));
});
t('an unknown action warns rather than inventing a purpose', () => {
  const msg = JSON.parse(JSON.stringify(CONFIRM));
  msg.context.action = 'teleport';
  assert.ok(M.toChit(msg, { currency: 'INR' }).warnings.some((w) => /unknown action/.test(w)));
});

// ── THE BOUNDARY — CB-only must not reach the wire ──────────────────────────────────────────────────────────
t('★ a sealed, co-held, disputed chit emits NONE of that to Beckn', () => {
  const chit = {
    chit_id: 'txn-1', chit_ref: 'ord-9', current_status: 'accepted',
    line_items: [{ name: 'Tussar', qty: 4, ref: 'I1' }],
    total_value: 3800, currency_code: 'INR',
    summary_json: { beckn: { bap_uri: 'http://bap.local/cb' } },
    // everything below is CB-only and must not travel
    entity_id: 'ent-seller', sealed: true, seal_hash: 'abc123', direction: 'received',
    disputes: [{ id: 'd1', scope: 'per-party' }], trace: { parents: ['x'] },
    order_input: { preset: 'form' }, copy_policy: { scope: 'self' },
  };
  const out = JSON.stringify(M.toBeckn(chit, { bpp_id: 'cb.local' }));
  for (const leak of ['entity_id', 'sealed', 'seal_hash', 'disputes', 'trace', 'order_input', 'copy_policy', 'direction']) {
    assert.ok(!out.includes(leak), `${leak} LEAKED to the network — the differentiator must stay internal`);
  }
});
t('★ every cbOnly rule has dir "none" — no path exists, by construction', () => {
  for (const r of M.RULES.filter((x) => x.cbOnly)) {
    assert.strictEqual(r.dir, 'none', `${r.cb} is CB-only but declares dir "${r.dir}"`);
    assert.strictEqual(r.beckn, null, `${r.cb} is CB-only but names a Beckn path`);
  }
});
t('★ CB is NOT a superset — discovery is recorded as something Beckn has and we do not', () => {
  const d = M.RULES.find((r) => /search/.test(String(r.beckn)));
  assert.ok(d, 'the search/on_search row must exist');
  assert.strictEqual(d.cb, null);
  assert.match(d.note, /not a superset/);
});

// ── chit → Beckn ────────────────────────────────────────────────────────────────────────────────────────────
t('toBeckn answers with action on_confirm and a NEW message_id', () => {
  const out = M.toBeckn({ chit_id: 't1', summary_json: {} }, { message_id: 'msg-2' });
  assert.strictEqual(out.context.action, 'on_confirm');
  assert.strictEqual(out.context.message_id, 'msg-2');
  assert.strictEqual(out.context.transaction_id, 't1', 'the transaction is the thread; the message is the step');
});
t('the price goes back out as a STRING, as the wire expects', () => {
  const out = M.toBeckn({ chit_id: 't1', total_value: 3800, currency_code: 'INR', summary_json: {} });
  assert.strictEqual(out.message.order.quote.price.value, '3800');
  assert.strictEqual(typeof out.message.order.quote.price.value, 'string');
});
t('no quote is emitted when there is no agreed value — an offer states no total', () => {
  const out = M.toBeckn({ chit_id: 't1', total_value: null, currency_code: 'INR', summary_json: {} });
  assert.strictEqual(out.message.order.quote, undefined);
});
t('an unmappable status is OMITTED rather than guessed', () => {
  const out = M.toBeckn({ chit_id: 't1', current_status: 'snoozed', summary_json: {} });
  assert.strictEqual(out.message.order.state, undefined);
});
t('this module reads no clock and writes nothing — timestamp is the caller\'s', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/beckn-map'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  assert.ok(!/Date\.now|new Date/.test(code), 'a mapper that stamps its own time cannot be replayed in a test');
  assert.ok(!/query\(|withEntity/.test(code), 'a mapper must not touch the database');
});

// ── round trip ──────────────────────────────────────────────────────────────────────────────────────────────
t('confirm → chit → on_confirm keeps the transaction, the items and the money', () => {
  const chit = M.toChit(CONFIRM, { currency: 'INR' });
  const out = M.toBeckn(chit, { message_id: 'msg-2' });
  assert.strictEqual(out.context.transaction_id, 'txn-1');
  assert.strictEqual(out.message.order.items[0].descriptor.name, 'Tussar');
  assert.strictEqual(out.message.order.items[0].quantity.count, 4);
  assert.strictEqual(out.message.order.quote.price.value, '3800');
  assert.strictEqual(out.message.order.quote.price.currency, 'INR');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
