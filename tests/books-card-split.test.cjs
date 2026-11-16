/**
 * books-card-split.test.cjs — BB-04: a card settlement that arrived net of the acquirer's fee, as ONE contra with a fee on POST /api/books/events, through real express and the in-memory ledger.
 *
 * Hand-worked (AU, AUD): card sales 2,700.00, the bank received 2,640.00, so the fee is 60.00. No GST answer: Dr Bank 2640.00 · Dr 6090 bank charges 60.00 · Cr card clearing 2700.00.
 * "GST on the fee" (1/11 of 60.00 = 5.45): fee 54.55 net + fee_tax_minor 545 -> Dr Bank 2640.00 · Dr 6090 54.55 · Dr 2210 GST paid 5.45 · Cr card 2700.00 (the same 2700.00 either way).
 * Proves: the entry balances and Cr card = amount + fee + tax · a repeat of the client_ref answers the first entry · the preview is the same lines · every refusal in words with no entry (fee zero/negative/text/more
 * decimals than AUD has, another currency, tax above the fee, the fee keys on another kind, tax alone, an unregistered shop, a tax invoice needed and not held) · a plain contra is unchanged.
 * Run: node tests/books-card-split.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * UNIT      lib/books-bank-tax.js
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 */
'use strict';
const { rig, counter, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ POST /api/books/events — a card settlement net of its fee (BB-04) ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const setup = require('../lib/country-setup');
  setup.registrationOfShop = async () => setup.registrationOf({ number: X.db.countryRow.gstn, scheme: X.db.countryRow.policy_flags.gst_registration, tax_registration: null });
  const asShop = (row) => { X.db.countryRow = row; setup.forget(SHOP); };
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const settle = (extra) => Object.assign({ kind: 'contra', from: 'card', to: 'bank', date: D, amount: 2640, narration: 'EFTPOS SETTLEMENT', fee: 60 }, extra);
  const before = () => T.entries.length;
  const sums = (ls) => [ls.reduce((t, l) => t + l[1], 0), ls.reduce((t, l) => t + l[2], 0)];

  const plain = await q('POST', '/events', { kind: 'contra', from: 'card', to: 'bank', date: D, amount: 2640, client_ref: 'cs-plain' });
  ok('a contra with no fee is unchanged (200, two lines)', plain.status === 200 && plain.body.ok && linesOf(entryOf('contra:cs-plain')).length === 2, JSON.stringify(plain.body));

  /* BB-04A: no tax answer */
  const a = await q('POST', '/events', settle({ client_ref: 'cs-a' }));
  ok('BB-04A fee 60.00 posts (200)', a.status === 200 && a.body.ok && !a.body.duplicate, JSON.stringify(a.body));
  const la = linesOf(entryOf('contra:cs-a'));
  eq('…3 lines: Dr bank 2640.00 · Dr bank charges 60.00 · Cr card 2700.00', la.map((l) => [l[1], l[2]]), [[264000, 0], [6000, 0], [0, 270000]]);
  eq('…Dr = Cr = the gross card sales', sums(la), [270000, 270000]);

  /* BB-04B: tax on the fee */
  const b = await q('POST', '/events', settle({ client_ref: 'cs-b', fee: 54.55, fee_tax_minor: 545, fee_currency: 'AUD' }));
  ok('BB-04B fee 54.55 + 545 tax posts (200)', b.status === 200 && b.body.ok, JSON.stringify(b.body));
  const lb = linesOf(entryOf('contra:cs-b'));
  eq('…4 lines: Dr bank 2640.00 · Dr 6090 54.55 · Dr tax 5.45 · Cr card 2700.00', lb.map((l) => [l[1], l[2]]), [[264000, 0], [5455, 0], [545, 0], [0, 270000]]);
  ok('…the tax is on the pack input-tax ledger (2210, GST paid)', lb.some((l) => l[0] === '2210' && l[1] === 545), JSON.stringify(lb));
  eq('…Dr = Cr = the same gross card sales', sums(lb), [270000, 270000]);

  /* duplicate press */
  const count = before();
  const again = await q('POST', '/events', settle({ client_ref: 'cs-b', fee: 54.55, fee_tax_minor: 545 }));
  ok('a repeat of the client_ref answers duplicate:true with the first entry', again.status === 200 && again.body.duplicate === true && again.body.entry_id === b.body.entry_id, JSON.stringify(again.body));
  eq('…and posted nothing more', before(), count);

  /* preview */
  const view = await q('POST', '/preview', settle({ client_ref: 'cs-pv', fee: 54.55, fee_tax_minor: 545 }));
  ok('the preview shows the same four lines, balanced, and writes nothing', view.status === 200 && view.body.ok && view.body.balanced && view.body.lines.length === 4 && !entryOf('contra:cs-pv'), JSON.stringify(view.body));

  /* refusals */
  const refused = async (name, body, codes, words) => {
    const n = before(), r = await q('POST', '/events', body);
    ok(name + ' → ' + r.status, codes.indexOf(r.status) >= 0 && before() === n && !r.body.ok, JSON.stringify(r.body));
    if (words) ok('…in words', words.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    return r;
  };
  for (const [name, value] of [['zero', 0], ['negative', -60], ['text', '60'], ['null', null], ['true', true], ['more decimals than AUD has', 60.005]])
    await refused('fee ' + name + ' is refused', settle({ client_ref: 'cs-bad-' + name, fee: value }), [400, 422]);
  await refused('a fee in another currency is refused', settle({ client_ref: 'cs-cur', fee_currency: 'USD' }), [400, 422], /same currency/);
  await refused('tax above the fee (6100 on 60.00) is refused', settle({ client_ref: 'cs-over', fee_tax_minor: 6100 }), [422], /more than the amount/);
  await refused('fee_tax_minor zero is refused', settle({ client_ref: 'cs-zero', fee_tax_minor: 0 }), [400, 422]);
  await refused('fee_tax_minor with a fraction is refused', settle({ client_ref: 'cs-frac', fee_tax_minor: 5.5 }), [400, 422]);
  await refused('tax with no fee is refused, not ignored', { kind: 'contra', from: 'card', to: 'bank', date: D, amount: 2640, client_ref: 'cs-alone', fee_tax_minor: 545 }, [422]);
  await refused('the fee keys on another kind (expense) are refused, not ignored', { kind: 'expense', class: 'bank_charges', date: D, amount: 20, paid_from: 'bank', client_ref: 'cs-exp', fee: 60 }, [422]);
  await refused('input_tax_minor beside a card fee is refused', settle({ client_ref: 'cs-in', input_tax_minor: 545 }), [422]);
  await refused('tax_invoice with no tax figure is refused', settle({ client_ref: 'cs-inv', tax_invoice: 'held' }), [422]);
  /* tax invoice: fee 80.00 + 8.00 tax is 88.00 gross, over the pack's line: the word is needed */
  await refused('a gross fee over the pack line with no word on the tax invoice is refused', settle({ client_ref: 'cs-b503', fee: 80, fee_tax_minor: 800 }), [422], /tax invoice/);
  const held = await q('POST', '/events', settle({ client_ref: 'cs-b503h', fee: 80, fee_tax_minor: 800, tax_invoice: 'held' }));
  ok('with held it posts (200), Cr card 2640.00 + 80.00 + 8.00 = 2728.00', held.status === 200 && sums(linesOf(entryOf('contra:cs-b503h')))[1] === 272800, JSON.stringify(held.body));
  /* registration */
  asShop(Object.assign({}, REGISTERED, { gstn: null, policy_flags: { gst_registration: 'unregistered' } }));
  await refused('an unregistered shop cannot claim the tax on the fee', settle({ client_ref: 'cs-unreg', fee_tax_minor: 545 }), [422], /not registered/);
  const noTax = await q('POST', '/events', settle({ client_ref: 'cs-unreg-ok' }));
  ok('…but the same shop posts the fee with no tax (200)', noTax.status === 200 && noTax.body.ok, JSON.stringify(noTax.body));
  asShop(REGISTERED);
  /* a closed key is still closed */
  await refused('an unknown key (currency) is still refused', settle({ client_ref: 'cs-key', currency: 'AUD' }), [400, 422]);

  R.close();
  done();
})();
