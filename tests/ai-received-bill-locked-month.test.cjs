/**
 * ai-received-bill-locked-month.test.cjs - AI-F-04b (walk AI, 21 Nov 2026): a supplier bill RECEIVED into a hard-locked month posts on the first open day (the standing period rule: an automatic entry moves,
 * doc_date keeps its own day) and SAYS so - "<Month> locked" - through the ONE wording of fix/af-1129 (lib/books-lock-note, composeEntry's when.lock_moved). No second rule here: this test only proves that
 * rule covers a received bill, not only a till day. It needs fix/af-1129 a58e02a8e; on a tree without its when.lock_moved line in lib/books.js it SKIPs (and runs once batch 1129 has merged af).
 * Hand case: Sep 2026 hard-locked, a bill dated 15 Sep (taxable 100.00, tax 10.00) -> posts 1 Oct, doc_date 15 Sep, narration "Purchase — September locked".
 * Run: node tests/ai-received-bill-locked-month.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
if (!/lock_moved: !!verdict.moved/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'books.js'), 'utf8'))) { console.log('   SKIP: fix/af-1129 (when.lock_moved in lib/books.js) is not in this tree yet'); process.exit(0); }
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
(async () => {
  const R = await rig(); if (!R) return;
  const { X, q, SHOP } = R;
  const SUP = '66666666-6666-4666-8666-666666666666';
  X.T.parties.push({ owner: SHOP, party_id: SUP, name: 'Sup', supplier: true, credit_days: 30 });
  await q('POST', '/periods/2026-27/6/lock', { reason: 'BAS filed', hard: true });
  const r = await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-15', currency: 'INR', party: SUP, by_rate: [{ rate: 10, taxable: 100, cgst: 5, sgst: 5 }], source_ref: 'chit:ai-d4', ref: 'D4', narration: 'Purchase' });
  const e = X.T.entries.find((x) => x.source_ref === 'chit:ai-d4');
  eq('posted 1 Oct, its own day kept as doc_date', [String(r.posting_date).slice(0, 10), String(r.doc_date).slice(0, 10)], ['2026-10-01', '2026-09-15']);
  ok('the narration says "September locked"', !!e && /Purchase — September locked$/.test(e.narration || ''), e && e.narration);
  R.close(); done();
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
