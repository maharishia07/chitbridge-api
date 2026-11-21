/**
 * books-lock-moves-billed-at.test.cjs — L-F-05 (1128): a sender-typed billed_at on or before the lock date posts on the first open day, with a note.
 * Hand case (WALK-L-FINDINGS L-F-05): INV-3 billed 15 Aug 2026, books locked to 31 Aug (the Jul-Aug months) → posts 1 Sep 2026, note says so.
 * Run: node tests/books-lock-moves-billed-at.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); good ? pass++ : fail++; console.log((good ? '   ok   ' : '   FAIL ') + name + (good ? '' : '\n   got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
(async () => {
  H.load();
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const S = { enabled: true, walkin_grain: 'bill', country: 'AE', functional_currency: 'AED', timezone: 'UTC' };
  const copy = (billed) => ({ chit_id: 'c1', purpose: 'invoice', sender_entity_id: 'a', sent_at: '2026-11-20T10:00:00Z', currency_code: 'AED', business_json: { bill_no: 'INV-3', billed_at: billed } });
  eq('billed 15 Aug, locked to 31 Aug → 1 Sep', K.lockMoveDay(copy('2026-08-15T10:00:00Z'), '2026-08-15', Object.assign({ lock_date: '2026-08-31' }, S)), '2026-09-01');
  eq('billed 31 Aug (the lock day itself) → 1 Sep', K.lockMoveDay(copy('2026-08-31T10:00:00Z'), '2026-08-31', Object.assign({ lock_date: '2026-08-31' }, S)), '2026-09-01');
  eq('billed 1 Sep (open) stays', K.lockMoveDay(copy('2026-09-01T10:00:00Z'), '2026-09-01', Object.assign({ lock_date: '2026-08-31' }, S)), null);
  eq('no lock date → no move', K.lockMoveDay(copy('2026-08-15T10:00:00Z'), '2026-08-15', S), null);
  eq('no billed_at (posts on its send) → no move', K.lockMoveDay({ chit_id: 'c', business_json: {} }, '2026-08-15', Object.assign({ lock_date: '2026-08-31' }, S)), null);
  eq('lock at year end rolls the month: 31 Dec → 1 Jan', K.lockMoveDay(copy('2026-11-10T10:00:00Z'), '2026-11-10', Object.assign({ lock_date: '2026-12-31' }, S)), '2027-01-01');
  const inv = { currency: 'AED', ItemList: [{ GstRt: 5, AssAmt: 200, CgstAmt: 0, SgstAmt: 0, IgstAmt: 10, CesAmt: 0 }], ValDtls: { TotInvVal: 210 } };
  const v = K.classify({ chit: copy('2026-08-15T10:00:00Z'), entry: { sells: true, buyer: { entity_id: '22222222-2222-4222-8222-222222222222' }, invoice: inv }, setting: Object.assign({ lock_date: '2026-08-31' }, S) });
  eq('classify: the posting day is 2026-09-01 and the note says why', [v.kind === 'post' && v.event.date, /first open day/.test(String(v.event && v.event.narration))], ['2026-09-01', true]);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
