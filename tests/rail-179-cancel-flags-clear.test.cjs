#!/usr/bin/env node
// @type: unit
/**
 * rail-179-cancel-flags-clear.test.cjs — RAIL-179 (cb-rail): THE CANCEL FLAGS CLEAR WHEN A CANCELLED COPY MOVES ON.
 * A recipient that confirmed a cancel and re-opens its copy (cancelled → accepted, allowed by lib/rail.js) left cancel_confirmed_at on the sender's copy and cancel_requested_at on its own.
 * HAND-COMPUTED: recipient R moves its copy cancelled → accepted. Expected writes, in order: (1) R's own copy clears requested_at/by/reason + confirmed_at/by (entity R);
 *   (2) the sender S's copy clears confirmed_at/by only (entity S). A move that is NOT a cancelled copy moving on (pending → accepted, accepted → cancelled) writes neither: 2 statements, then 0, then 0.
 *   When R is the sender itself (a self-chit), only the own-copy clear runs (1 statement).
 * RUN       node tests/rail-179-cancel-flags-clear.test.cjs      (offline: tests/support/chit-move-rig.cjs)
 * CARD      01-rail-core-the-chit/chit-move
 */
'use strict';
const { load } = require('./support/chit-move-rig.cjs');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const R = '11111111-1111-4111-8111-111111111111', S = '22222222-2222-4222-8222-222222222222', CHIT = '33333333-3333-4333-8333-333333333333';
const by = { id: 'u1', name: 'Mala' };
const flagWrites = (rig) => rig.sql.filter((q) => /^UPDATE chit_status SET cancel_/.test(q.text));

(async () => {
  console.log('\n== RAIL-179 · the cancel flags clear when a cancelled copy moves on ==');
  const re = load({ from: 'cancelled', openDisputes: 0, sender: S });
  await re.move.moveStatus(R, CHIT, 'accepted', by, null, { level: 'editor' });
  const w = flagWrites(re);
  t('re-open: two flag writes', w.length === 2, JSON.stringify(w));
  t('1st: my own copy, requested + confirmed cleared', w[0] && w[0].entity === R && /cancel_requested_at = NULL/.test(w[0].text) && /cancel_confirmed_at = NULL/.test(w[0].text) && /cancel_reason = NULL/.test(w[0].text), w[0] && w[0].text);
  t('2nd: the sender\'s copy, only the confirm cleared', w[1] && w[1].entity === S && /cancel_confirmed_at = NULL/.test(w[1].text) && !/cancel_requested/.test(w[1].text), w[1] && w[1].text);
  t('both keyed by chit and entity', w.every((q) => /chit_id = \$1 AND entity_id = \$2/.test(q.text) && q.params[0] === CHIT), JSON.stringify(w.map((q) => q.params)));

  const plain = load({ from: 'pending', openDisputes: 0, sender: S });
  await plain.move.moveStatus(R, CHIT, 'accepted', by, null, { level: 'editor' });
  t('pending → accepted: no flag write', flagWrites(plain).length === 0);
  const cancel = load({ from: 'accepted', openDisputes: 0, sender: S });
  await cancel.move.moveStatus(R, CHIT, 'cancelled', by, null, { level: 'editor' });
  t('accepted → cancelled: the cancel flags are not cleared (the stamp legs set them)', flagWrites(cancel).every((q) => !/= NULL/.test(q.text)), JSON.stringify(flagWrites(cancel)));
  const self = load({ from: 'cancelled', openDisputes: 0, sender: R });
  await self.move.moveStatus(R, CHIT, 'accepted', by, null, { level: 'editor' });
  t('self-chit: only my own copy is cleared', flagWrites(self).length === 1 && flagWrites(self)[0].entity === R, JSON.stringify(flagWrites(self)));
  t('nothing logged as a failed clear', re.warnings.length === 0, re.warnings.join('|'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
