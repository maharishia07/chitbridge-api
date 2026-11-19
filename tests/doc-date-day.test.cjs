'use strict';
/**
 * tests/doc-date-day.test.cjs — a pg DATE column arrives as a JS Date; String(Date).slice(0,10) is "Thu Oct 08", which the web read as 8 Oct 2001.
 * The ONE reader is lib/books-engines ymd. Run: node tests/doc-date-day.test.cjs
 * CARD 11-crm-and-marketing/crm-parties
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const { ymd } = require('../lib/books-engines');
let bad = 0;
const t = (what, fn) => { try { fn(); console.log('  ok  ' + what); } catch (e) { bad++; console.log('  FAIL ' + what + '\n      ' + e.message); } };
t('a pg Date (local midnight) → its calendar day', () => assert.strictEqual(ymd(new Date(2026, 9, 8)), '2026-10-08'));
t('a day string stays', () => assert.strictEqual(ymd('2026-10-08'), '2026-10-08'));
t('a date-time string keeps its day', () => assert.strictEqual(ymd('2026-10-08T00:00:00.000Z'), '2026-10-08'));
t('absent → null', () => assert.strictEqual(ymd(null), null));
t('the cut-Date form is what we must never send', () => assert.strictEqual(String(new Date(2026, 9, 8)).slice(0, 10), 'Thu Oct 08'));
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
t('the CRM timeline sends doc_date through ymd', () => { const s = src('lib/crm-timeline-rows.js'); assert.ok(s.includes("books-engines').ymd(ledgerRow.doc_date)") && !/String\(ledgerRow\.doc_date\)/.test(s)); });
t('the Tally export dates a voucher through ymd', () => assert.ok(!/String\(e\.posting_date\)\.slice/.test(src('lib/books-tally.js'))));
console.log(bad ? bad + ' failed' : 'all passed');
process.exit(bad ? 1 : 0);
