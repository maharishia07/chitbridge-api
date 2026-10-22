/**
 * open-orders-counts.test.cjs — M168 + M132, offline.
 *  · M168: Home's Orders card and the till's /tasks list are ONE helper (lib/open-orders): both source files call it, neither keeps its own order query.
 *  · M132: a walk-in day entry with source_chit_ids reaches the Day book as source.bills = the bill numbers (routes/books sourceOf).
 * Run: node tests/open-orders-counts.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(80) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want))); };
const src = (f) => fs.readFileSync(path.join(API, f), 'utf8');

console.log('\n-- M168 one helper, two callers --\n');
const home = src('lib/home-facts.js'), till = src('routes/till.js');
t('home-facts orders calls open-orders.tasks(despatch)', /open-orders'\)\.tasks\(ctx\.entity, 'despatch'/.test(home), true);
t('till /tasks calls open-orders.tasks', /open-orders'\)\.tasks\(entity_id, kind, limit\)/.test(till), true);
t('home-facts orders no longer reads purpose order itself', /purpose: 'order', direction: 'received'/.test(home), false);
t('till.js keeps no second copy of orderOf', /function orderOf\(/.test(till), false);
/* WX-O2C: the counter's own bills are left out at the database, not after a 300-row read */
t('open-orders asks select for own_bills:false (my counter sales never fill the read)', /purpose: 'order', since, limit: 300, own_bills: false/.test(src('lib/open-orders.js')), true);
t('select.js own_bills:false is one SQL clause on bill_no + sender = me', /sel\.own_bills === false[\s\S]*business_json \? 'bill_no'[\s\S]*sender_entity_id = cs\.entity_id/.test(src('lib/select.js')), true);

console.log('\n-- M132 a walk-in day names its bills --\n');
const { sourceOf } = require(API + '/routes/books')._test;
const day = { covers: 3, source_chit_id: null, source_ref: 'walkin:C5:2026-10-10', event_type: 'walkin_day', src_till: null,
  day_bills: [{ chit_id: 'a', ref: 'C5/26-27/0001' }, { chit_id: 'b', ref: 'C5/26-27/0002' }, { chit_id: 'c', ref: 'C5/26-27/0003' }], tenders: [{ role: 'cash', dr_minor: 50000 }] };
const s = sourceOf(day);
t('kind day, count 3, counter C5', [s.kind, s.count, s.counter], ['day', 3, 'C5']);
t('source.bills = the bill numbers, each openable', s.bills.map((b) => b.ref + '/' + b.chit_id), ['C5/26-27/0001/a', 'C5/26-27/0002/b', 'C5/26-27/0003/c']);
t('a later line of the day (no day_bills) gives null, never []', sourceOf(Object.assign({}, day, { day_bills: null })).bills, null);

console.log(pass + ' checks'); process.exitCode = fail ? 1 : 0;
