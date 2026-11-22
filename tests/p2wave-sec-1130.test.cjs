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
  console.log('\n-- EL-platform-08#L87 parts that DECLARE size 0 are still held to the total budget --');
  const X = require(path.join(API, 'lib/xlsx-read.js'));
  const F = require(path.join(__dirname, 'xlsx-fixture.cjs'));
  const MB = 1024 * 1024;
  const wbxml = '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const bomb = F.zip([
    { name: 'xl/workbook.xml', text: wbxml, deflate: true },
    { name: 'xl/_rels/workbook.xml.rels', text: rels },
    { name: 'xl/worksheets/sheet1.xml', text: '<worksheet><sheetData></sheetData>' + ' '.repeat(50 * MB) + '</worksheet>', deflate: true },
    { name: 'xl/sharedStrings.xml', text: '<sst>' + ' '.repeat(50 * MB) + '</sst>', deflate: true }
  ]);
  for (let at = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) bomb.writeUInt32LE(0, at + 24); /* every central entry now declares usize 0 */
  let said = null;
  try { X.sheetRows(bomb); } catch (e) { said = e.userMessage || e.message; }
  t('two 50 MB parts that declare 0 are refused as too large, not read', /too large/i.test(said || ''), true);
  console.log('\n-- L-sec-platform-05#L92 the hand-made csv files guard a formula cell --');
  const MI = require(path.join(API, 'lib/move-in.js'));
  const skipped = MI.skippedCsv([{ line: 3, what: '=HYPERLINK("http://x","y")', why: '+cmd|calc' }, { line: 4, what: '-12.50', why: 'plain' }]);
  t('skipped rows: a formula opener gets an apostrophe, a plain number does not', [skipped.includes('"\'=HYPERLINK'), skipped.includes('"\'+cmd'), skipped.includes('"-12.50"')], [true, true, true]);
  const PR = require(path.join(API, 'lib/parallel-run.js'));
  const auditor = PR.csv({ parts: { pl: { title: '@SUM(A1)', lines: [{ status: 'differs', name: '=1+1', their_line: 'x', their_code: '', our_codes: [], theirs_minor: -1250, ours_minor: 0, diff_minor: -1250, why: '\tTab' }] } } }, 'AUD');
  t('the auditor file: formula-led cells guarded, the negative figure stays a number', [auditor.includes('"\'@SUM(A1)"'), auditor.includes('"\'=1+1"'), auditor.includes('"-12.50"')], [true, true, true]);
  console.log('\n-- L-sec-platform-05#L75 a header_row csv with millions of lines is refused before a row object is built --');
  let said2 = null;
  const t1 = Date.now();
  try { MI.readFile({ csv: 'a,b\n' + '\n'.repeat(3000000), header_row: 2 }); } catch (e) { said2 = e.userMessage || e.message; }
  t('3,000,000 lines: refused in words, fast', [/can carry/.test(said2 || ''), Date.now() - t1 < 3000], [true, true]);
  t('a small file with headings on row 2 still reads', MI.readFile({ csv: 'My Shop\nname,price\nTea,5\n', header_row: 2 }).headers, ['name', 'price']);
  console.log('\n-- EL-platform-05#L114 a database error never reaches the compare screen --');
  const dbErr = Object.assign(new Error('relation "books_ledger_lines" does not exist'), { code: '42P01' });
  const own = Object.assign(new Error('Ours has no trial balance for that date.'), { refused: true });
  const cmp = PR.compare({ parts: [{ part: 'tb', title: 'Trial balance', rows: [] }, { part: 'pl', title: 'P and L', rows: [] }], chart: [], ours: { tb: dbErr, pl: own }, lines: [], currency: 'AUD', from: '2026-07-01', to: '2026-09-30' });
  t('a SQLSTATE error: the sentence names no table', cmp.parts.tb.error, 'Our trial balance could not be read.');
  t('our own refusal still says its words', cmp.parts.pl.error, 'Ours has no trial balance for that date.');
  console.log('\n-- GF-platform-07#L72 / EL-platform-07#L104 a registry status word is read whole; a provider body never reaches the caller --');
  const V = require(path.join(API, 'lib/verify.js'));
  t('Active, Valid, Registered, "Active - Regular" read as live', ['Active', 'valid', 'Registered', 'Active - Regular'].map(V.activeFromStatus), [true, true, true, true]);
  t('Inactive, Invalid, Not registered, Cancelled, Non-active, empty, unmapped are not live', ['Inactive', 'Invalid', 'Not registered', 'Cancelled', 'non-active', '', 'pending', null].map(V.activeFromStatus), [false, false, false, false, false, false, false, false]);
  process.env.CB_KYB_PROVIDER = 'generic'; process.env.CB_KYB_BASE = 'http://registry.invalid/x'; process.env.CB_KYB_KEY = 'k';
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('connect ECONNREFUSED SECRET-PROVIDER-BODY-1234'); };
  const down = await V.verifyRegistry('hs', '100630');
  global.fetch = realFetch;
  t('unreachable: transient, names the provider, none of its message', [down.ok, down.transient, /generic/.test(down.note), /SECRET|ECONNREFUSED/.test(down.note)], [false, true, true, false]);
  console.log('\n-- GF-platform-08#L227 the second Bridge ID minter does not use Math.random --');
  const BID = require(path.join(API, 'src/lib/bridgeId.js'));
  const realRandom = Math.random; let drawn = 0; Math.random = () => { drawn++; return 0.5; };
  const ids = Array.from({ length: 200 }, () => BID.mint());
  Math.random = realRandom;
  t('200 ids: all valid, all distinct (not one repeated draw), Math.random never called', [ids.every(BID.isValid), new Set(ids).size === 200, drawn], [true, true, 0]);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
