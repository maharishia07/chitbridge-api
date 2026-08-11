#!/usr/bin/env node
'use strict';
/**
 * cleanup-test-data.js — tidy up after the proof scripts.
 *
 * Athi, 2026-08-11: *"clean up test data."*
 *
 * ── ⚠️ WHAT THIS DELIBERATELY DOES NOT TOUCH ────────────────────────────────────────────────────────────────────
 * `beta@test-cb.com` and `alpha@test-cb.com` keep their CHITS and FOLDERS. They are named like test accounts, but
 * they are the ones Athi actually signs into — the folders, the seeded WhatsApp requests and the consolidation
 * demo all live there. Wiping them would delete the thing he has been reviewing all week, which is not what
 * "clean up test data" means. Their stale PENDING CAPTURES are cleared, because an unread inbox item is clutter
 * rather than a record.
 *
 * The four pure-proof accounts (nobody ever looks at them; a script made them) are cleared fully.
 *
 * ── ⚠️ A SENT CHIT CANNOT BE PURGED, AND THAT IS THE RAIL WORKING ───────────────────────────────────────────────
 * /api/chits/:id/purge refuses anything that is not a Draft: *"sent chits are immutable co-held records."* Deleting
 * one would break the counterparty's copy of a record they co-hold. So the strongest thing available is a soft
 * delete (to trash), which takes a chit out of the lists but leaves the row. That is a real limit on how much
 * space this can recover, and it is a limit worth having — it is the same principle that makes a chit worth
 * trusting. Reported rather than worked around.
 *
 * RUN:  node scripts/cleanup-test-data.js            (dry run — shows what it WOULD do)
 *       node scripts/cleanup-test-data.js --apply    (does it)
 */
const { j, signIn, run } = require('./_proof');

const APPLY = process.argv.includes('--apply');

/* Accounts a script created and no human has ever opened. Safe to clear completely. */
const PROOF_ONLY = [
  'req-proof@test-cb.com', 'policy-proof@test-cb.com', 'autoraise-proof@test-cb.com',
  'farm-proof@test-cb.com', 'autoraise-proof@test-cb.com',
];
/* Accounts Athi actually uses. Captures only — their chits and folders are the demo. */
const KEEP_CHITS = ['beta@test-cb.com', 'alpha@test-cb.com', 'alpha-timers@test-cb.com'];

async function tidy(t, email, full) {
  const out = { captures: 0, chits: 0, folders: 0, products: 0, rules: 0 };

  const caps = ((await j('/api/capture/pending', { token: t })).b || {}).captures || [];
  for (const c of caps) {
    if (APPLY) await j('/api/capture/' + c.id + '/dismiss', { method: 'POST', token: t, body: {} });
    out.captures++;
  }
  if (!full) return out;

  /* Soft delete only — see the note above about co-held records. */
  for (const path of ['/api/chits/inbox?limit=200', '/api/chits/sent?limit=200']) {
    const rows = ((await j(path, { token: t })).b || {}).chits || [];
    for (const c of rows) {
      if (APPLY) await j('/api/chits/' + c.chit_id, { method: 'DELETE', token: t });
      out.chits++;
    }
  }
  const fol = ((await j('/api/folders', { token: t })).b || {}).folders || [];
  for (const f of fol) {
    const rules = ((await j('/api/folders/' + f.folder_id + '/rules', { token: t })).b || {}).rules || [];
    for (const r of rules) { if (APPLY) await j('/api/folders/rules/' + r.rule_id, { method: 'DELETE', token: t }); out.rules++; }
    if (APPLY) await j('/api/folders/' + f.folder_id, { method: 'DELETE', token: t });
    out.folders++;
  }
  const prods = ((await j('/api/products', { token: t })).b || {}).items || [];
  for (const p of prods) { if (APPLY) await j('/api/products/' + p.item_id, { method: 'DELETE', token: t }); out.products++; }
  return out;
}

run('cleanup-test-data', async (t) => {
  console.log('\n  ' + (APPLY ? '\x1b[31mAPPLYING\x1b[0m' : '\x1b[33mDRY RUN\x1b[0m — nothing is changed; re-run with --apply') + '\n');

  let totals = { captures: 0, chits: 0, folders: 0, products: 0, rules: 0 };
  const add = (o) => Object.keys(totals).forEach((k) => { totals[k] += o[k]; });

  console.log('  ── cleared FULLY (script-made, never opened by a person) ──');
  for (const e of [...new Set(PROOF_ONLY)]) {
    const tok = await signIn(e, 'Proof Account');
    if (!tok) { console.log('   ' + e.padEnd(30) + ' (cannot sign in)'); continue; }
    const r = await tidy(tok, e, true);
    add(r);
    console.log('   ' + e.padEnd(30) + ' captures ' + String(r.captures).padStart(3) + ' · chits ' + String(r.chits).padStart(3)
      + ' · folders ' + String(r.folders).padStart(2) + ' · rules ' + String(r.rules).padStart(2) + ' · products ' + String(r.products).padStart(3));
  }

  console.log('\n  ── captures only (Athi signs into these; the chits and folders ARE the demo) ──');
  for (const e of KEEP_CHITS) {
    const tok = await signIn(e, 'Demo Account');
    if (!tok) { console.log('   ' + e.padEnd(30) + ' (cannot sign in)'); continue; }
    const r = await tidy(tok, e, false);
    add(r);
    console.log('   ' + e.padEnd(30) + ' stale captures dismissed ' + String(r.captures).padStart(3) + '   (chits + folders kept)');
  }

  console.log('\n  ' + (APPLY ? 'removed' : 'WOULD remove') + ': ' + totals.captures + ' captures · ' + totals.chits
    + ' chits (soft) · ' + totals.folders + ' folders · ' + totals.rules + ' rules · ' + totals.products + ' products');
  t.ok(true, 'inventory complete');

  console.log('\n  ⚠️ A SENT CHIT CANNOT BE PURGED — the API refuses anything but a Draft, because a sent chit is an');
  console.log('     immutable co-held record and deleting it would break the counterparty\'s copy. Soft delete takes');
  console.log('     it out of the lists; the row stays. That caps how much space this can recover, by design.');
  console.log('\n  ⚠️ AND THE PER-RUN ENTITIES CANNOT BE REACHED. prove-wholesaler-e2e and prove-storefront-mint mint a');
  console.log('     fresh entity per run (veg-wholesaler-NNNNN@, shop-NNNNN@) to stay idempotent, and there is no');
  console.log('     delete-entity endpoint. Those accumulate. The fix is for the scripts to tidy up at the END of a');
  console.log('     run, while they still know their own email — not for a sweeper to guess names afterwards.\n');
});
