/* offer-nudge-gap.cjs — "ADD ONE MORE AND IT IS FREE": THE SILENCE, PROVED FIRST. (M60 · a KNOWN GAP, pinned)
 *
 * Athi, 2026-09-11: *"When you have buy 2 get 1 free … in online, if two selected, are we notifying that add one more
 * at free of cost?"* — and *"keep it as a backlog as one of the testing we will do that later."* So this is the
 * test he asked for FIRST: the real offers engine, a storefront basket, the one unit short.
 *
 * ⚠️ IT PINS TODAY'S BEHAVIOUR, INCLUDING THE GAP. A basket of 2 on "buy 2 get 1 free" gets no adjustment AND NO NOTE —
 * while a threshold offer on a short basket DOES say "₹300 more needed". When the engine learns the nudge (an
 * engines release: buy_x_get_y / mix_and_match emitting a note with the shortfall in UNITS, under a name that cannot
 * be read as rupees), the "silence" line below must be MOVED to assert the note — never deleted. The counter must
 * keep NOT showing it (the shopkeeper is holding the packets); that half is the storefront's to render.
 *
 * Run: node e2e/offer-nudge-gap.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const sb = { console, Date }; sb.window = sb; sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
for (const f of ['engine/money.js', 'engine/offers.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), sb);
const O = sb.CBOffers;
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + (ok ? 'OK ' : '✗  ') + l + (d ? '  · ' + d : '')); if (!ok) bad++; };
const run = (offers, lines) => O.evaluate({ lines, offers, ctx: { now: new Date() } });
const line = (qty, price) => ({ key: 'a', item_id: 'soap', sku: null, excluded: [], qty, unitPrice: price, categories: [] });

console.log('── "add one more and it is free" — what a storefront basket is told today ──');
const bxgy = { id: 'b2g1', kind: 'buy_x_get_y', label: 'Buy 2 get 1 free', buy: 2, get: 1, applies_to: { item_ids: ['soap'] } };
const two = run([bxgy], [line(2, 40)]), three = run([bxgy], [line(3, 40)]);
say('the offer fires at 3 (buy 2, the 3rd free)', (three.adjustments || []).length === 1, (three.adjustments || []).length + ' adjustment');
say('⚠️ KNOWN GAP: at 2 — one short of a free one — there is no adjustment AND NO NOTE',
    (two.adjustments || []).length === 0 && (two.notes || []).length === 0,
    'adjustments ' + (two.adjustments || []).length + ' · notes ' + (two.notes || []).length);

const thr = { id: 't5', kind: 'threshold', label: '5% over ₹500', percent: 5, min_amount: 500 };
const short = run([thr], [line(5, 40)]);
const n = (short.notes || [])[0];
say('the contrast: a threshold offer on a short basket DOES say how far', !!n && Number(n.shortfall) === 300,
    n ? JSON.stringify({ why: n.why || n.text, shortfall: n.shortfall }) : 'no note');

console.log(bad ? '\n✗ ' + bad + ' — the behaviour moved. If the engine learned the nudge, MOVE the gap line to assert it.\n'
                : '\n✓ pinned: the gap is real and unchanged (backlog "ADD ONE MORE AND IT IS FREE")\n');
process.exit(bad ? 1 : 0);
