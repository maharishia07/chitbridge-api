/**
 * tests/rail-paid-reject.test.cjs — a PAID invoice cannot be rejected by its sender any more than cancelled (RAIL-216 follow-up).
 * lib/rail-status paidRefusal asked only to === 'cancelled'; the rail's own withdrawn list is rejected + cancelled (rail-actions WITHDRAWN),
 * and the books reverse a rejected sale like a cancelled one. Offline: real statusGate + real rail, the paid fact stubbed.
 * Run: node tests/rail-paid-reject.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const chitPaid = require(path.join(API, 'lib', 'chit-paid'));
const railStatus = require(path.join(API, 'lib', 'rail-status'));
const { WITHDRAWN } = require(path.join(API, 'lib', 'rail-actions'));
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

(async () => {
  console.log('\n== paid invoice: every withdrawn status is asked ==');
  const asked = [];
  let paid = true;
  chitPaid.paidFactsOf = async () => { asked.push(1); return paid; };
  const db = { query: async () => ({ rows: [], rowCount: 0 }) };
  const ME = { level: 'editor', holder: null };
  const ids = ['c1', 'c2'];
  const gate = async (to, from, copy) => { try { return await railStatus.statusGate(db, 'e1', ids[0], to, ME, { copy, from }); } catch (e) { return { threw: e.message }; } };
  t('the rail has exactly two withdrawn statuses, rejected and cancelled', WITHDRAWN.join() === 'rejected,cancelled');
  for (const to of WITHDRAWN) {
    for (const copy of ['sent', 'received']) {
      paid = true; asked.length = 0;
      const g = await gate(to, 'pending', copy);
      t('paid, ' + copy + ' copy pending -> ' + to + ': paid refusal', g.ok === false && g.why === 'paid', JSON.stringify({ ok: g.ok, why: g.why, threw: g.threw }));
    }
    paid = false;
    const g = await gate(to, 'pending', 'sent');
    t('unpaid, sent copy pending -> ' + to + ': not refused as paid', g.why !== 'paid', JSON.stringify({ ok: g.ok, why: g.why }));
  }
  paid = true; asked.length = 0;
  const live = await gate('accepted', 'pending', 'received');
  t('a paid invoice moving to accepted is not asked', live.why !== 'paid' && asked.length === 0);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
