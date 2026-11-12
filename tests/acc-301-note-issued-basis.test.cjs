/**
 * tests/acc-301-note-issued-basis.test.cjs — ACC-301: A CREDIT / DEBIT NOTE IS PRICED ON THE BASIS ITS INVOICE WAS ISSUED ON, NOT ON THE SELLER'S LIVE price_includes_tax FLAG.
 *
 * OWNS      the proof that lib/chit-proposal priceMoney, for a note on an issued invoice, reads the issued basis (business_json.invoice._cb.price_includes_tax, stamped by
 *           the engine, lib/tax.js) and hands it to the ONE calculation (send-money invoiceOfLines { priceIncludesTax }); with no stamp it derives the basis from the
 *           lines (TotItemVal equals the priced amount = inclusive; equals priced + tax = exclusive); with neither it REFUSES in words (never the live flag, silently).
 *           A bill round that is not yet an issued invoice still reads the live flag (it is provisional by design).
 *           Hand example (INR, paise): a line issued INCLUSIVE at 11800.00 (taxable 10000.00 + 18% = 1800.00). The shop later flips its flag to exclusive. A HALF-line credit
 *           of 5900.00 must be a note of 590000 paise (taxable 500000 + tax 90000); on the live flag it was 696200 (5900 + 18%), 106200 too high — under the ACC-286 cap, so the cap
 *           does not catch it. Mirror: issued EXCLUSIVE (10000.00 + 1800.00), flag later "yes": a half-line credit priced 5000.00 is 590000, not 500000.
 * CALLED BY scripts/guards.cjs · CI. No database (identities are stubbed). Out of scope, said: a till-made credit note prices at the counter and is only checked at send.
 * Run: node tests/acc-301-note-issued-basis.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('node:assert/strict');

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + String((e && e.message) || e).split('\n').slice(0, 3).join('\n          '));
  }
};

let LIVE_FLAG = 'no';
const db = require('../db');
db.query = async () => ({
  rows: [
    { identity_id: 's1', gstn: '27AAPFU0939F1ZV', display_name: 'Seller', policy_flags: { price_includes_tax: LIVE_FLAG }, country: 'IN' },
    { identity_id: 'b1', gstn: '27AABCU9603R1ZX', display_name: 'Buyer', policy_flags: {}, country: 'IN' }
  ]
});
require('../lib/country-setup').registrationOfShop = async () => 'regular';
const TL = require('../lib/tax-lines');
const proposals = require('../lib/chit-proposal');

const SELLER = { Country: 'IN', Gstin: '27AAPFU0939F1ZV', State: '27' };
/** the invoice as the engine issued it, on a stated basis (the frozen business_json.invoice) */
const issuedOn = (inclusive, price, rate) => TL.invoiceFor({ lines: [{ name: 'Pump seal', quantity: 1, price, gst_rate: rate === undefined ? 18 : rate, hsn: '8413' }], seller: SELLER, buyer: { Gstin: '27AABCU9603R1ZX', Pos: '27' }, chit_id: 'c1', at: '2026-11-08', priceIncludesTax: inclusive }).invoice;
const ctxOf = (invoice) => ({ copy: { header: { business_json: Object.assign({ billed_at: '2026-11-08T00:00:00Z' }, invoice ? { invoice } : {}) } }, group: { sellerId: 's1', buyerId: 'b1' } });
const creditLine = (price, rate) => ({ particulars: 'Pump seal', quantity: 1, unit: 'pc', price, total: price, list_price: price, gst_rate: rate === undefined ? 18 : rate });
const minorOf = (major) => Math.round(major * 100);
const noteTotals = async (ctx, price, asNote) => {
  const out = await proposals.priceMoney(ctx, [creditLine(price)], 'INR', asNote);
  return { total: minorOf(out.invoice.ValDtls.TotInvVal), taxable: minorOf(out.invoice.ValDtls.AssVal) };
};
const withoutStamp = (invoice) => {
  const copy = JSON.parse(JSON.stringify(invoice));
  delete copy._cb.price_includes_tax;
  return copy;
};

(async () => {
  console.log('\n== ACC-301: A NOTE KEEPS THE ISSUED BASIS ==\n');
  const inclusive = issuedOn(true, 11800),
    exclusive = issuedOn(false, 10000);
  await t('the engine stamped the basis on both invoices (the hand example is right: 11800 incl. = 10000 + 1800; 10000 excl. = 11800)', () => {
    assert.equal(inclusive._cb.price_includes_tax, true);
    assert.equal(exclusive._cb.price_includes_tax, false);
    assert.deepEqual([minorOf(inclusive.ValDtls.TotInvVal), minorOf(exclusive.ValDtls.TotInvVal)], [1180000, 1180000]);
  });

  await t('issued INCLUSIVE, flag later "no": a half-line credit of 5900.00 is a note of 590000 (taxable 500000), not 696200', async () => {
    LIVE_FLAG = 'no';
    assert.deepEqual(await noteTotals(ctxOf(inclusive), 5900, true), { total: 590000, taxable: 500000 });
  });
  await t('issued EXCLUSIVE, flag later "yes": a half-line credit priced 5000.00 is a note of 590000 (taxable 500000), not 500000', async () => {
    LIVE_FLAG = 'yes';
    assert.deepEqual(await noteTotals(ctxOf(exclusive), 5000, true), { total: 590000, taxable: 500000 });
  });
  await t('issued on the SAME basis as the live flag: unchanged (inclusive/yes and exclusive/no)', async () => {
    LIVE_FLAG = 'yes';
    assert.deepEqual(await noteTotals(ctxOf(inclusive), 5900, true), { total: 590000, taxable: 500000 });
    LIVE_FLAG = 'no';
    assert.deepEqual(await noteTotals(ctxOf(exclusive), 5000, true), { total: 590000, taxable: 500000 });
  });
  await t('no stamp: the basis is derived from the lines (TotItemVal = priced amount → inclusive; = priced + tax → exclusive), the live flag is not asked', async () => {
    LIVE_FLAG = 'no';
    assert.deepEqual(await noteTotals(ctxOf(withoutStamp(inclusive)), 5900, true), { total: 590000, taxable: 500000 });
    LIVE_FLAG = 'yes';
    assert.deepEqual(await noteTotals(ctxOf(withoutStamp(exclusive)), 5000, true), { total: 590000, taxable: 500000 });
  });
  await t('a rate-0 line has no tax to tell the bases apart and needs none: priced the same either way', async () => {
    LIVE_FLAG = 'yes';
    const zero = withoutStamp(issuedOn(false, 5000, 0));
    const out = await proposals.priceMoney(ctxOf(zero), [creditLine(2000, 0)], 'INR', true);
    assert.equal(minorOf(out.invoice.ValDtls.TotInvVal), 200000);
  });
  await t('an issued invoice that carries neither a stamp nor lines to tell the basis from is REFUSED in words (503 MONEY_NOT_COMPUTED), never priced on the live flag', async () => {
    LIVE_FLAG = 'no';
    await assert.rejects(() => proposals.priceMoney(ctxOf(null), [creditLine(5900)], 'INR', true), (e) => e.status === 503 && e.code === 'MONEY_NOT_COMPUTED' && /basis/.test(e.message));
  });
  await t('no stamp, a TAXED line that fits neither basis (TotItemVal 118.01 on 100 + 18 tax) is REFUSED 503, never read as exclusive', async () => {
    LIVE_FLAG = 'no';
    const odd = withoutStamp(exclusive);
    odd.ItemList[0].TotItemVal = Number(odd.ItemList[0].TotItemVal) + 0.01;
    await assert.rejects(() => proposals.priceMoney(ctxOf(odd), [creditLine(5000)], 'INR', true), (e) => e.status === 503 && e.code === 'MONEY_NOT_COMPUTED');
  });
  await t('no stamp, two lines that DISAGREE (one inclusive-looking, one exclusive-looking) are REFUSED 503, never answered by the first', async () => {
    LIVE_FLAG = 'no';
    const mixed = withoutStamp(inclusive);
    const second = JSON.parse(JSON.stringify(withoutStamp(exclusive).ItemList[0]));
    mixed.ItemList.push(second);
    await assert.rejects(() => proposals.priceMoney(ctxOf(mixed), [creditLine(5900)], 'INR', true), (e) => e.status === 503 && e.code === 'MONEY_NOT_COMPUTED');
  });
  await t('no stamp, a tax-free line next to a told one: the told one decides (the rate-0 line needs none)', async () => {
    LIVE_FLAG = 'no';
    const withFree = withoutStamp(inclusive);
    withFree.ItemList.push(JSON.parse(JSON.stringify(withoutStamp(issuedOn(false, 500, 0)).ItemList[0])));
    assert.equal(require('../lib/price-note').priceBasisOf(withFree), true);
  });
  await t('a bill round that is NOT a note (provisional, unfrozen) still reads the live flag by design', async () => {
    LIVE_FLAG = 'yes';
    const asked = await noteTotals(ctxOf(exclusive), 5900, false);
    assert.deepEqual(asked, { total: 590000, taxable: 500000 });
  });

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
