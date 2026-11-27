/**
 * tests/taxline-typed-line-1132.test.cjs — TAXLINE-1132: A LINE TYPED INTO A CHIT (Workshop > Compose) ANSWERS A TAX LINE IN EVERY COUNTRY PACK.
 *
 * OWNS      lib/default-tax-rate stampTypedLines + the refusal's words (lib/no-pack-words sendFailureSpec). The bug (sit-au, 27 Nov 2026): the AU play shops' Compose sent
 *           {particulars, unit, quantity, price, total} (no item_id, no rate); the shelf could not match it, so the line had no rate and the send was refused TAX_LINE_UNAVAILABLE under the title
 *           "The country pack is missing" (wrong: AU's pack is loaded and the shop is registered).
 * GUARD     for EVERY registered pack with a tax member: a registered seller's typed line is RATED at the pack's standard_rate (AU 10 · AE 5 · …), or, where the pack has no one standard rate (India:
 *           slab by HSN), refused TAX_LINE_UNAVAILABLE in words naming the line: never a bill at 0, never "pack missing".
 * HAND      AU A$100.00 typed, 10% → GST 10.00, total 110.00 · AE AED 100.00 typed, 5% → VAT 5.00, total 105.00 · a line that sent a blank rate stays unstamped (BAD_RATE, never 0%) ·
 *           a line with its own rate (even 0), slab, category or kind is left alone.
 * CALLED BY CI / node --test tests/taxline-typed-line-1132.test.cjs · no DB, no network.
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const countrySetup = require('../lib/country-setup');
const dflt = require('../lib/default-tax-rate');
const TL = require('../lib/tax-lines');
const regulation = require('../lib/regulation');
const taxPacks = require('../lib/tax-packs');
const noPack = require('../lib/no-pack-words');

countrySetup.migrated = async () => true;
const SELLERS = {
  AU: { Country: 'AU', LglNm: 'S', RegType: 'regular', Gstin: '51824753556' },
  AE: { Country: 'AE', LglNm: 'S', RegType: 'regular', Gstin: '100000000000003' },
  IN: { Country: 'IN', LglNm: 'S', State: '27', RegType: 'regular', Gstin: '27AAPFU0939F1ZV' }
};
const SHOPS = { AU: { country: 'AU', gstn: '51824753556' }, AE: { country: 'AE', gstn: '100000000000003' }, IN: { country: 'IN', gstn: '27AAPFU0939F1ZV' } };
const queryOf = (country) => async () => ({ rows: [Object.assign({ policy_flags: {}, tax_registration: { registered: true } }, SHOPS[country])] });
/** Compose's line, exactly as ccMintedLine sends it (public/app.html): no item_id, no rate */
const composeLine = () => ({ particulars: 'Brake pad set', unit: 'unit', quantity: 1, price: 100, total: 100, comment: '', ref: null });
const asEngineLine = (line) => Object.assign({ name: line.particulars, qty: line.quantity, unit_price: line.price }, line.gst_rate !== undefined ? { gst_rate: line.gst_rate } : {});
const bill = (country, line, currency) => TL.invoiceFor({ lines: [asEngineLine(line)], seller: SELLERS[country], buyer: { Country: country, State: '27', Gstin: SELLERS[country].Gstin }, currency, at: '2026-11-27T00:00:00Z' });

test('AU typed Compose line is stamped 10 and billed: GST 10.00, total 110.00', async () => {
  const [line] = await dflt.stampTypedLines('e1', [composeLine()], [], queryOf('AU'));
  assert.equal(line.gst_rate, 10);
  const answer = bill('AU', line, 'AUD');
  assert.equal(answer.tax_status[0].status, 'RATED');
  assert.equal(answer.invoice.ValDtls.TotInvVal, 110);
  assert.doesNotThrow(() => TL.refuseUnavailable(answer.tax_status, [asEngineLine(line)]));
});

test('AE typed Compose line is stamped 5 and billed: VAT 5.00, total 105.00', async () => {
  const [line] = await dflt.stampTypedLines('e1', [composeLine()], [], queryOf('AE'));
  assert.equal(line.gst_rate, 5);
  const answer = bill('AE', line, 'AED');
  assert.equal(answer.tax_status[0].status, 'RATED');
  assert.equal(answer.invoice.ValDtls.TotInvVal, 105);
});

test('before the fix: the same line with no rate is UNAVAILABLE and refused in words', () => {
  const answer = bill('AU', composeLine(), 'AUD');
  assert.equal(answer.tax_status[0].status, 'UNAVAILABLE');
  assert.throws(() => TL.refuseUnavailable(answer.tax_status, [asEngineLine(composeLine())]), (e) => e.code === 'TAX_LINE_UNAVAILABLE' && e.status === 422);
});

test('a blank-rate line, and a line that says its own tax, are left as they are', async () => {
  const own = [Object.assign(composeLine(), { gst_rate: 0 }), Object.assign(composeLine(), { rate: 5 }), Object.assign(composeLine(), { tax_slab: 's1' }), Object.assign(composeLine(), { categories: ['c'] }), Object.assign(composeLine(), { tax_kind: 'gst_free' }), Object.assign(composeLine(), { rcm_category: 'x' }), Object.assign(composeLine(), { removed: true })];
  const out = await dflt.stampTypedLines('e1', [composeLine(), ...own], [0], queryOf('AU'));
  assert.equal(out[0].gst_rate, undefined, 'blank-rate index 0 stays unrated: BAD_RATE, never 0%');
  assert.equal(out[1].gst_rate, 0);
  assert.equal(out[2].gst_rate, undefined);
  out.slice(3).forEach((line) => assert.equal(line.gst_rate, undefined));
});

test('the input lines are not changed, and a shop that cannot be read leaves them as sent', async () => {
  const input = composeLine();
  await dflt.stampTypedLines('e1', [input], [], queryOf('AU'));
  assert.equal(input.gst_rate, undefined);
  const out = await dflt.stampTypedLines('e1', [composeLine()], [], async () => { throw new Error('db down'); });
  assert.equal(out[0].gst_rate, undefined);
});

test('GUARD every registered pack answers a typed line: rated at its standard rate, or refused in words (never 0, never "pack missing")', async () => {
  const countries = regulation.list().map((pack) => pack.country || pack.code).filter((country) => taxPacks.packFor(country));
  assert.ok(countries.includes('AU') && countries.includes('AE') && countries.includes('IN'), 'AU, AE and IN are all registered');
  for (const country of countries) {
    const pack = taxPacks.packFor(country);
    SHOPS[country] = SHOPS[country] || { country, gstn: '123456789012345' };
    const [line] = await dflt.stampTypedLines('e1', [composeLine()], [], queryOf(country));
    if (typeof pack.standard_rate === 'number') {
      assert.equal(line.gst_rate, pack.standard_rate, country + ': stamped at the pack standard rate');
    } else {
      assert.equal(line.gst_rate, undefined, country + ': no one standard rate, so nothing is guessed');
    }
  }
  const india = bill('IN', composeLine(), 'INR');
  assert.equal(india.tax_status[0].status, 'UNAVAILABLE');
  assert.throws(() => TL.refuseUnavailable(india.tax_status, [asEngineLine(composeLine())]), (e) => e.code === 'TAX_LINE_UNAVAILABLE' && /Line 1 \(Brake pad set\) has no tax rate/.test(e.message));
});

test('the refusal keeps its own title: only NO_COUNTRY_PACK says "pack is missing"', () => {
  const taxRefusal = Object.assign(new Error('Line 1 has no tax rate'), { refused: true, status: 422, code: 'TAX_LINE_UNAVAILABLE', title: 'Tax not set on a line' });
  const spec = noPack.sendFailureSpec(taxRefusal, { code: 'MONEY_NOT_COMPUTED' });
  assert.equal(spec.code, 'TAX_LINE_UNAVAILABLE');
  assert.equal(spec.error, 'Tax not set on a line');
  assert.equal(noPack.sendFailureSpec(noPack.refusal('ZZ'), {}).error, 'The country pack is missing');
});
