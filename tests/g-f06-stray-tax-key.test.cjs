/**
 * g-f06-stray-tax-key.test.cjs — G-F-06 (Walk G 21 Nov): an expense carrying `vat_minor` 500 on 105.00 (inside the `event` object, where the closed body list does not look) posted the whole
 * 105.00 to the expense and lost the 5.00 VAT without a word. Now it is refused in words, nothing posted; the door's own answers (tax_rate with the supplier's TRN) still post as AE-F-18.
 * Hand: AED 105.00 with 5% inside = net 100.00 + VAT 5.00 (105 x 5/105): Dr expense 100.00 · Dr input VAT 5.00 · Cr bank 105.00.
 * Run: node tests/g-f06-stray-tax-key.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * UNIT      lib/books-manual-bill-tax.js
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const AE = { country: 'AE', currency_code: 'AED', gstn: '100234567800003', timezone: 'Asia/Dubai', policy_flags: { gst_registration: 'regular' } };
(async () => {
  console.log('\n══ G-F-06: a VAT figure under a key no door reads is refused, never dropped ══\n');
  const R = await rig(AE);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const setup = require('../lib/country-setup');
  setup.registrationOfShop = async () => 'regular';
  const base = { class: 'rent', paid_from: 'bank', date: '2026-10-05', amount: 105 };
  const before = T.entries.length;
  const nested = await q('POST', '/preview', { event: Object.assign({ kind: 'expense', vat_minor: 500 }, base) });
  ok('vat_minor inside event is refused in words (not a 200 that posts 105.00 to the expense)', !(nested.body && nested.body.ok) && /does not take the VAT as an amount \(vat_minor\)/.test(JSON.stringify(nested.body)), JSON.stringify(nested.body).slice(0, 300));
  const posted = await q('POST', '/events', { event: Object.assign({ kind: 'expense', gst_minor: 500, client_ref: 'g6-a' }, base) });
  ok('POST /events: refused, nothing posted', posted.status !== 200 && T.entries.length === before, posted.status + ' ' + JSON.stringify(posted.body).slice(0, 200));
  const own = await q('POST', '/events', Object.assign({ kind: 'expense', client_ref: 'g6-b', tax_rate: '5', supplier_gstin: '100345678900003' }, base));
  ok('the door\'s own answer (tax_rate 5 + supplier TRN) still posts', own.status === 200 && own.body.ok, JSON.stringify(own.body).slice(0, 200));
  const e = T.entries.find((x) => x.source_ref === 'ev:expense:g6-b');
  const lines = T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => [l.dr_minor, l.cr_minor].join('/')).sort();
  eq('…Dr expense 100.00 · Dr input VAT 5.00 · Cr bank 105.00', lines, ['0/10500', '10000/0', '500/0']);
  const zero = await q('POST', '/preview', { event: Object.assign({ kind: 'expense', vat_minor: 0 }, base) });
  ok('a zero or blank tax key is no statement: not refused', !/does not take the VAT/.test(JSON.stringify(zero.body)), JSON.stringify(zero.body).slice(0, 200));
  done();
})();
