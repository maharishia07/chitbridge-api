/**
 * split-1138-units.test.cjs — the two modules split out of lib/books-period.js and lib/books-grant.js to keep their size rows (batch 1138), rule by rule.
 * Modules: lib/books-period-carried.js (a closed period replayed from its carried figures) · lib/books-grant-log.js (the look's log rows). Offline, no database.
 * Unit per rule · the refusal path (a failed insert is never swallowed) · fail closed (no log row, no read). Run: node tests/split-1138-units.test.cjs
 * CARD 14-accounting/README
 */
'use strict';
const assert = require('assert');
const Carried = require('../lib/books-period-carried');
const GrantLog = require('../lib/books-grant-log');
let checks = 0;
const ok = (cond, what) => { assert.ok(cond, what); checks += 1; };

const heads = [{ head: 'gst', output: 'gst_out', rcm: 'gst_rcm' }, { head: 'cess', output: 'cess_out' }];
const pack = { id: 'x' };
const headsOf = () => heads;
const rcmHeadsOf = () => ['gst'];
const minorMap = (map, names, suffix) => names.reduce((out, name) => Object.assign(out, { [name + suffix]: map[name] || 0 }), {});
const C = Carried({ headsOf, rcmHeadsOf, minorMap });

/* paidSinceClose: each payment lands on its head, forward and reverse charge kept apart */
const split = C.paidSinceClose(pack, [{ role: 'gst_out', dr_minor: 100 }, { role: 'gst_out', dr_minor: 50 }, { role: 'gst_rcm', dr_minor: 7 }, { role: 'cess_out', dr_minor: 3 }]);
ok(split.since.gst === 150 && split.since.cess === 3 && split.sinceRcm.gst === 7, 'payments are added up per head, reverse charge apart');

/* subtractPaidSince: what was paid since comes off the carried still-to-pay, never below zero, and the total is added up again */
const answer = { still_to_pay_minor: { gst_minor: 200, cess_minor: 2 }, rcm_minor: { gst: 20 } };
C.subtractPaidSince(answer, pack, { paid_rcm: { gst: 5 } }, { gst: 150, cess: 3 }, { gst: 7 });
ok(answer.still_to_pay_minor.gst_minor === 50 && answer.still_to_pay_minor.cess_minor === 0, 'never below zero');
ok(answer.still_to_pay_total_minor === 50 + 0 + (20 - 12), 'the total counts the reverse-charge remainder');
ok(answer.paid_since_close_minor.gst_minor === 150, 'the paid-since figure is carried');

/* noteReversed: a payment counted at the close that is gone now says so in words; nothing gone says nothing */
const quiet = { };
C.noteReversed(quiet, { paid_entries: ['a'] }, { entries: ['a'] }, 'e1', { key: 'k' });
ok(quiet.paid_note === undefined, 'no reversal, no note');
const said = { };
C.noteReversed(said, { paid_entries: ['a', 'b'] }, { entries: ['a'] }, 'e1', { key: 'k' });
ok(/reversed since/.test(said.paid_note), 'a reversed payment is told in words');

/* writeLogRows: one INSERT for several members; without the role columns it is the plain 8-column row */
(async () => {
  const seen = [];
  const transaction = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } };
  await GrantLog.writeLogRows(transaction, false, [{ grant_id: 'g1', grantor_entity: 'm1' }, { grant_id: 'g2', grantor_entity: 'm2' }], 'firm', { actor: 'p', pattern: '/x' }, { status: 200, outcome: 'ok' });
  ok(seen.length === 1 && /INSERT INTO books_access_log/.test(seen[0].sql) && seen[0].params.length === 16, 'one insert, eight values a row');
  await GrantLog.writeLogRow(transaction, false, { grant_id: 'g3' }, 'm3', 'firm', { actor: 'p', pattern: '/y' }, { status: 200, outcome: 'ok' });
  ok(seen[1].params[1] === 'm3', 'writeLogRow names the member it looked at');
  /* fail closed: a refused insert rejects, so the look it logs is never answered */
  const failing = { query: async () => { throw new Error('unavailable'); } };
  let refused = false;
  try { await GrantLog.writeLogRow(failing, false, { grant_id: 'g4' }, 'm4', 'firm', { actor: 'p', pattern: '/z' }, { status: 200, outcome: 'ok' }); } catch (e) { refused = /unavailable/.test(e.message); }
  ok(refused, 'a failed log insert is never swallowed (fail closed)');
  console.log('split-1138-units: ' + checks + ' checks');
})().catch((e) => { console.error(e); process.exit(1); });
