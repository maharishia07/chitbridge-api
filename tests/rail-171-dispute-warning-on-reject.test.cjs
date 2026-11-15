#!/usr/bin/env node
// @type: unit
/**
 * rail-171-dispute-warning-on-reject.test.cjs — RAIL-171 (cb-rail): CLOSING A CHIT WITH AN OPEN DISPUTE WARNS FOR EVERY CLOSED STATE, NOT ONLY completed AND cancelled.
 * lib/chit-move.js listed [completed, cancelled]; the rail's CLOSED_STATES (lib/rail-actions) also holds rejected, so rejecting a disputed order left no warning, no timeline note.
 * HAND-COMPUTED: one open dispute on my copy; PUT status → completed | cancelled | rejected each answers the warning "Chit closed with an OPEN dispute — by Mala.";
 *   → accepted (not a close) answers none; a close with no open dispute answers none. 1 list + 3 closes + 2 no-warning cases = 6 checks.
 * RUN       node tests/rail-171-dispute-warning-on-reject.test.cjs      (offline: tests/support/chit-move-rig.cjs replaces the db, the rail gate and the neighbours)
 * CARD      01-rail-core-the-chit/chit-move
 */
'use strict';
const railActions = require('../lib/rail-actions');
const { load } = require('./support/chit-move-rig.cjs');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const ME = '11111111-1111-4111-8111-111111111111', SENDER = '22222222-2222-4222-8222-222222222222', CHIT = '33333333-3333-4333-8333-333333333333';
const by = { id: 'u1', name: 'Mala' };

(async () => {
  console.log('\n== RAIL-171 · an open dispute warns on every close ==');
  t('the rail closes in three states (the list the warning now reads)', railActions.CLOSED_STATES.join() === 'completed,cancelled,rejected', railActions.CLOSED_STATES.join());
  for (const status of ['completed', 'cancelled', 'rejected']) {
    const rig = load({ from: 'accepted', openDisputes: 1, sender: SENDER });
    const out = await rig.move.moveStatus(ME, CHIT, status, by, null, { level: 'editor' });
    t(status + ' with an open dispute: warning names who', out.body.warning === 'Chit closed with an OPEN dispute — by Mala.', JSON.stringify(out.body));
  }
  const open = load({ from: 'pending', openDisputes: 1, sender: SENDER });
  const acc = await open.move.moveStatus(ME, CHIT, 'accepted', by, null, { level: 'editor' });
  t('accepted (not a close) with an open dispute: no warning', !acc.body.warning, JSON.stringify(acc.body));
  const none = load({ from: 'accepted', openDisputes: 0, sender: SENDER });
  const rej = await none.move.moveStatus(ME, CHIT, 'rejected', by, null, { level: 'editor' });
  t('rejected with no open dispute: no warning', !rej.body.warning, JSON.stringify(rej.body));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
