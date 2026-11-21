#!/usr/bin/env node
// @type: unit
/**
 * tests/books-1126-units.test.cjs — the unit tests of three batch-1126 books modules that had none of their own:
 *   a. lib/books-advice-in.js: a received payment advice waits on a dispute, waits on acceptance, then becomes ONE receipt (direction in); the payer's own copy posts nothing
 *   b. lib/books-moved-role.js: a role held on a pack-retired code is refused to the line (null), a pack that retired nothing is closed (no statement)
 *   c. lib/country-asks.js: a pack with no questions asks nothing (fail closed); an unknown key or a value outside the options is refused in words
 * Run: node tests/books-1126-units.test.cjs · no DB, no network.
 * OWNS      the unit checks of these three modules        CALLED BY scripts/guards.cjs        CARD 16-finance/books-posting
 */
'use strict';
process.env.NODE_ENV = 'test';
const advice = require('../lib/books-advice-in'), moved = require('../lib/books-moved-role'), asks = require('../lib/country-asks');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : '  FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };
const refused = (fn) => { try { fn(); return null; } catch (e) { return e; } };

/* a. the received advice */
const hooks = { ACCEPTED: /accept|agreed/i, modeOf: (m) => m || 'cash', dayOf: (at) => String(at).slice(0, 10), paymentReceivedWait: () => null };
const ctxOf = (over) => Object.assign({
  copy: { direction: 'received', sender_entity_id: 'payer-1', chit_id: 'c1', current_status: 'accepted' },
  business: { payment_advice: { action: 'paid', amount_minor: 12550, currency: 'inr', reference: 'UTR9', mode: 'upi', words: 'Rent' } },
  setting: {}, currency: 'INR', at: '2026-11-20T10:00:00Z', input: {}
}, over || {});
const receipt = advice.verdict(ctxOf(), hooks);
ok('an accepted advice becomes one receipt, direction in, from the payer, amount and day as written', receipt.kind === 'payment' && receipt.payment.direction === 'in' && receipt.payment.party_id === 'payer-1' && receipt.payment.amount_minor === 12550 && receipt.payment.received_at === '2026-11-20' && receipt.payment.currency === 'INR' && receipt.payment.client_ref === 'chit:c1', receipt);
ok('a disputed advice waits for the dispute and says what it is (Rent)', (() => { const v = advice.verdict(ctxOf({ input: { disputed: true } }), hooks); return v.kind === 'queue' && v.wait === 'dispute' && /Rent/.test(v.why); })());
ok('an advice not yet accepted waits for my acceptance, never posts', (() => { const v = advice.verdict(ctxOf({ copy: { direction: 'received', sender_entity_id: 'p', chit_id: 'c2', current_status: 'sent' } }), hooks); return v.kind === 'queue' && v.wait === 'acceptance' && v.todo === 'accept'; })());
ok('the payer\'s own copy and an advice of money I paid post nothing', advice.verdict(ctxOf({ copy: { direction: 'sent', chit_id: 'c3' } }), hooks).kind === 'none' && advice.verdict(ctxOf({ business: { payment_advice: { action: 'asked' } } }), hooks).kind === 'none');
ok('a wait the books raise (a held receipt) is returned as it is, no receipt beside it', advice.verdict(ctxOf(), Object.assign({}, hooks, { paymentReceivedWait: () => ({ kind: 'queue', wait: 'x' }) })).wait === 'x');
ok('a negative amount is read as its size, never a refund', advice.verdict(ctxOf({ business: { payment_advice: { action: 'paid', amount_minor: -500 } } }), hooks).payment.amount_minor === 500);

/* b. the moved role */
const held = { code: '5100' };
const index = { byRole: new Map([['wages', held]]) };
const pack = { retired: [{ code: '5100' }] };
ok('a role held on a retired code is refused to the line: null, so the pack\'s new code takes it', moved.holderOf(pack, index, { account: 'wages', code: '6015' }) === null);
ok('the same role on the line\'s own code, or with no retired code, keeps its holder', moved.holderOf(pack, index, { account: 'wages', code: '5100' }) === held && moved.holderOf({}, index, { account: 'wages', code: '6015' }) === held);
ok('a role nobody holds answers null', moved.holderOf(pack, index, { account: 'rent', code: '6020' }) === null);
(async () => {
  const none = await moved.free({ query: async () => { throw new Error('no statement expected'); } }, 'e1', { retired: [] });
  ok('a pack that retired nothing is closed: no statement, 0 freed', none === 0, none);
  ok('the retired codes are read as text', moved.retiredCodes({ retired: [{ code: 5100 }] })[0] === '5100');

  /* c. the country questions */
  ok('a pack with no questions asks nothing, and no pack asks nothing (fail closed)', asks.asksOf({}).length === 0 && asks.asksOf(null).length === 0);
  const uae = { returns: { emirates: ['Dubai', 'Sharjah'], staggers: { 1: { first_month: 1, monthly: true } } }, designatedZones: true, legalForms: ['LLC', { value: 'sole', label: 'Sole' }] };
  ok('a pack asks region, period, zone and form in that order', asks.asksOf(uae).map((a) => a.key).join() === 'region,period,zone,form', asks.asksOf(uae).map((a) => a.key));
  ok('a key the pack does not ask is refused by name, a value outside the options is refused in words', (() => {
    const bare = refused(() => asks.mergeAsked({}, { region: 'Dubai' }, {}));
    const bad = refused(() => asks.mergeAsked({}, { region: 'Mars' }, uae));
    return bare && bare.status === 400 && /does not ask/.test(bare.message) && bad && /one of/.test(bad.message);
  })());
  ok('a non-object answer set is refused; undefined writes nothing', (() => { const e = refused(() => asks.mergeAsked({}, [], uae)); return e && e.code === 'COUNTRY_SETUP_BAD' && asks.mergeAsked({}, undefined, uae).written === false; })());
  ok('a value is kept in the pack\'s own case, and an empty one clears it', (() => {
    const kept = asks.mergeAsked({}, { region: 'dubai' }, uae).asked;
    return kept.region === 'Dubai' && asks.mergeAsked(kept, { region: '' }, uae).asked.region === undefined;
  })());
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n  ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
