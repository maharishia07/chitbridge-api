#!/usr/bin/env node
// @type: unit
/**
 * p2wave-sec-1130.test.cjs — the P2 security rows of the 1130 wave, each failing on the 1129 head and passing after.
 * OWNS      GF-catalogue-02#L36 (scheduled[].patch loses cost keys) · EL-platform-02#L109 (camelCase cost key with a suffix) · GF-platform-03#L84 (hidden daybook narration) · L-sec-platform-04#L62 (junit read linear) · L-sec-platform-01#L76 (base64 pattern)
 * CALLED BY CI (api unit). No database, no network.
 * FLOW      input → the real function → the answer
 * CARD      18-identity-sign-in-and-access/access-levels
 * Run: node tests/p2wave-sec-1130.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

(async () => {
  const cost = require(path.join(API, 'lib/cost.js'));
  console.log('\n-- EL-platform-02#L109 camelCase cost keys with a suffix --');
  for (const k of ['costPriceExGst', 'costPriceIncl', 'cost_price_ex_gst', 'marginPercentTarget'])
    t(k + ' is a cost key', cost.isCostKey(k), true);
  for (const k of ['costume', 'name', 'price', 'marginal'])
    t(k + ' is not', cost.isCostKey(k), false);

  console.log('\n-- GF-catalogue-02#L36 a parked change carries no cost for a cost-blind caller --');
  const products = require(path.join(API, 'routes/products.js'));
  const items = [{ item_id: 'i1', item_data: { name: 'Tea', cost: 5 }, scheduled: [{ patch: { price: 9, cost: 4, costPriceExGst: 3 } }] }];
  products.stripCosts(items);
  t('item cost gone', items[0].item_data, { name: 'Tea' });
  t('scheduled patch cost gone', items[0].scheduled[0].patch, { price: 9 });

  console.log('\n-- GF-platform-03#L84 a hidden daybook entry keeps no narration and no foreign amount --');
  const DV = require(path.join(API, 'lib/dues-view.js'));
  const hiddenDay = DV.blindBooks('daybook', { entries: [{ entry_no: 'PB-1', event_type: 'purchase_bill', narration: 'Bill 7 from Acme: short by 1,250.00', no_narration: false, lines: [{ code: '5000', dr_minor: 4242500, cr_minor: 0, fx: { currency: 'USD', rate: 83, foreign_minor: 51000 } }] }], count: 1 });
  t('narration null on the hidden entry', [hiddenDay.entries[0].narration, hiddenDay.entries[0].no_narration], [null, true]);
  t('no figure anywhere in the answer', /4242500|1,250|51000/.test(JSON.stringify(hiddenDay)), false);
  console.log('\n-- L-sec-platform-04#L62 a report of unclosed <testcase> tags reads in linear time, a closed one reads as before --');
  const J = require(path.join(API, 'lib/junitresults.js'));
  const xml = '<testsuite><testcase classname="a" name="[CTR-05] x"/><testcase classname="b" name="[CTR-06] y"><failure message="bad"/></testcase><testcase name="[CTR-07] z"></testcase></testsuite>';
  t('self-closing case passes on its own, the failing one fails, the third passes', J.read(xml).results.map((r) => [r.case_key, r.status]), [['CTR-05', 'pass'], ['CTR-06', 'fail'], ['CTR-07', 'pass']]);
  const started = Date.now();
  J.read('<testcase name="a">'.repeat(200000));
  t('200,000 unclosed cases read in under 2 s (the old regex took 56 s)', Date.now() - started < 2000, true);

  console.log('\n-- L-sec-platform-01#L76 the attachment bytes pattern has one way to match --');
  const b64 = require(path.join(API, 'lib/attachments-contract.js')).ROUTES['POST /'].body.data_base64;
  const re = new RegExp(b64.pattern);
  const t0 = Date.now();
  const refused = re.test('\n'.repeat(60000) + '!');
  t('60,000 newlines then a bad byte: refused, and fast (old pattern: about a second)', [refused, Date.now() - t0 < 100], [false, true]);
  t('a wrapped base64 body, a data: URL and a padded tail still pass', ['QUJD\r\nREVG\n' + 'A'.repeat(100) + '==\n', 'data:image/png;base64,QUJD'].map((x) => re.test(x)), [true, true]);
  t('the text is capped at the base64 of the 6 MB limit plus breaks', typeof b64.maxLength === 'number' && b64.maxLength > 8e6 && b64.maxLength < 9e6, true);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
