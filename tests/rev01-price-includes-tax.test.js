'use strict';
/**
 * rev01-price-includes-tax.test.js — [REV-01] "Every server-side invoice is 18% too high, and it is frozen
 * permanently" (external code review, 2026-09-25, §1).
 *
 * price_includes_tax defaults to 'yes' and is shipped to the counter, which correctly splits GST out of the
 * shelf price. Both server-side invoice callers (lib/tax-copy.js's entryFor/freezeOnComplete, and
 * routes/chits.js's send-time money summary) built their tax-lines.invoiceFor() input by hand and never read
 * it — so it arrived `undefined`, `!!undefined` is `false`, and the server added GST on top of a price that
 * already included it.
 *
 * The reviewer's own reproduction, reused here exactly: 2 × Oil @ ₹118, 18% GST, inclusive. The customer's
 * slip says total ₹236. Before this fix the server recorded ₹278.
 *
 * Run: node tests/rev01-price-includes-tax.test.js
 */
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
async function t(label, fn) {
  try { await fn(); console.log('  ok    ' + label); pass++; }
  catch (e) { console.log('  FAIL  ' + label + '\n      ' + e.message); fail++; }
}

async function policyFlagOf() {
  console.log('\n-- policy.flagOf() reads the SAME default get() would, without a query --\n');
  const policy = require(API + '/lib/policy');
  await t('an explicit "no" is read as "no"', () => assert.strictEqual(policy.flagOf({ price_includes_tax: 'no' }, 'price_includes_tax'), 'no'));
  await t('an explicit "yes" is read as "yes"', () => assert.strictEqual(policy.flagOf({ price_includes_tax: 'yes' }, 'price_includes_tax'), 'yes'));
  await t('a missing flag falls back to the SAME default FLAGS declares (\'yes\')', () =>
    assert.strictEqual(policy.flagOf({}, 'price_includes_tax'), 'yes'));
  await t('a null policy_flags object does not throw and still defaults', () =>
    assert.strictEqual(policy.flagOf(null, 'price_includes_tax'), 'yes'));
  await t('junk values fall back to the default, never pass through unchecked', () =>
    assert.strictEqual(policy.flagOf({ price_includes_tax: 'sometimes' }, 'price_includes_tax'), 'yes'));
}

async function theReproduction() {
  console.log('\n-- ⭐⭐⭐ the exact reviewer reproduction: 2 × Oil @ ₹118, 18% GST inclusive — slip says ₹236 --\n');

  const SELLER_ID = '11111111-1111-1111-1111-111111111111';
  const BUYER_ID = '22222222-2222-2222-2222-222222222222';
  const IDENTITIES = {
    [SELLER_ID]: { identity_id: SELLER_ID, gstn: '29AAAAA0000A1Z5', display_name: 'Test Seller', country: 'IN', policy_flags: { price_includes_tax: 'yes' } },
    [BUYER_ID]: { identity_id: BUYER_ID, gstn: '29BBBBB0000B1Z5', display_name: 'Test Buyer', country: 'IN', policy_flags: {} },
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async (sql, params) => {
        if (/FROM identities WHERE identity_id = ANY/.test(sql)) {
          const ids = params[0];
          return { rows: ids.map((id) => IDENTITIES[id]).filter(Boolean) };
        }
        throw new Error('unstubbed query in rev01 test: ' + sql);
      },
      withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [] }) }),
    },
  };
  delete require.cache[require.resolve(API + '/lib/tax-copy')];
  const taxCopy = require(API + '/lib/tax-copy');
  const taxLines = require(API + '/lib/tax-lines');

  const hdr = {
    chit_id: 'c1', sender_entity_id: BUYER_ID, all_recipients: [{ kind: 'to', entity_id: SELLER_ID }],
    purpose: 'order', business_json: {}, summary_json: {}, sent_at: '2026-09-25T10:00:00.000Z', created_at: '2026-09-25T10:00:00.000Z',
    line_items: [{ line_id: 'l1', name: 'Oil', quantity: 2, price: 118, gst_rate: 18 }], currency_code: 'INR',
  };

  await t('partiesFor() resolves the SELLER\'s own price_includes_tax (\'yes\') onto the parties', async () => {
    const p = await taxCopy.partiesFor(hdr, SELLER_ID);
    assert.strictEqual(p.priceIncludesTax, true);
  });

  const entry = await taxCopy.entryFor(hdr, SELLER_ID);
  const h = taxLines.heads(entry.invoice);
  await t('⭐⭐⭐ the total matches the customer\'s printed slip — ₹236, not ₹278', () => assert.strictEqual(h.total, 236));
  await t('taxable value is ₹200 (the price with GST split OUT, not added on top)', () => assert.strictEqual(h.taxable, 200));
  await t('tax collected is ₹36 (18% of ₹200) — not ₹42.48', () => assert.strictEqual(h.tax, 36));

  await t('⚠️ a seller who set price_includes_tax=\'no\' (an ex-tax price list) still gets GST ADDED, correctly', async () => {
    IDENTITIES[SELLER_ID].policy_flags = { price_includes_tax: 'no' };
    delete require.cache[require.resolve(API + '/lib/tax-copy')];
    const freshTaxCopy = require(API + '/lib/tax-copy');
    const entry2 = await freshTaxCopy.entryFor(hdr, SELLER_ID);
    const h2 = taxLines.heads(entry2.invoice);
    assert.strictEqual(h2.taxable, 236);       // the listed ₹236 IS the ex-tax value now
    assert.strictEqual(h2.total, 278);         // and 18% is added on top of it (engine's own per-line rounding)
  });
}

/* a structural guard: the OTHER caller (routes/chits.js) must keep passing priceIncludesTax too — a change
   there is not exercised by the tests above, which only reach lib/tax-copy.js's own path. */
async function structuralGuard() {
  console.log('\n-- ⚠️ routes/chits.js\'s OWN invoiceFor() call must keep asking policy.flagOf() for this --\n');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  const m = /taxLines\.invoiceFor\(\{[^}]*\}\)/s.exec(src);
  await t('routes/chits.js\'s invoiceFor() call includes priceIncludesTax', () => {
    assert.ok(m, 'could not find the invoiceFor() call at all — has it moved or been renamed?');
    assert.ok(/priceIncludesTax/.test(m[0]), 'the call no longer mentions priceIncludesTax — the §1 defect is back');
  });
}

(async () => {
  await policyFlagOf();
  await theReproduction();
  await structuralGuard();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
