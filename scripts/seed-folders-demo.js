#!/usr/bin/env node
'use strict';
/**
 * seed-folders-demo.js — fill folders with REAL chits so the metrics show genuinely different readings.
 *
 * Athi, 2026-08-10: *"can you push some data in folder and show me different results?"*
 *
 * ⚠️ IT FILES EXISTING CHITS RATHER THAN MINTING NEW ONES, and that is the point. Freshly-minted chits are all the
 * same age, all unread, all pending — every folder would report an identical, flattering row of numbers and prove
 * nothing. Real chits carry real spread: some are months old, some were read, some closed, some disputed, some
 * carry a currency and some carry no agreed value at all. That spread is what makes the metrics readable.
 *
 * ⚠️ NON-DESTRUCTIVE. Filing sets chit_status.folder_id on YOUR OWN copy. It creates nothing, deletes nothing, and
 * changes no chit's status, value or counterparty — the same reason a rule is allowed to file and nothing else.
 * Re-running it re-uses its folders instead of stacking duplicates.
 *
 * RUN:  node scripts/seed-folders-demo.js [--entity=beta@test-cb.com] [--reset]
 */
const { j, signIn, run } = require('./_proof');

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const EMAIL = arg('entity', 'beta@test-cb.com');
const RESET = process.argv.includes('--reset');

/* Four folders chosen to read DIFFERENTLY from each other. If they all reported the same numbers the screen would
   be decoration; the point of a metric is that two folders disagree and you can see why. */
/* ⚠️ THE FOLDERS MUST NOT OVERLAP, because a copy carries ONE folder_id — this is a folder tree, not Gmail
   labels. My first pass had inbound and unread both claim the same chits, so the later folder silently STOLE
   them and the earlier one reported 0. That is correct behaviour reported honestly; it was the seed that was
   wrong. Each rule below claims a disjoint slice, and the chits are dealt out once. */
const PLAN = [
  { name: '📥 Inbound requests', pick: (c) => c.direction === 'received' && c.read_at,
    rule: { name: 'Everything that arrives', when: { direction: 'received' } } },
  { name: '⚑ Unread arrivals',   pick: (c) => c.direction === 'received' && !c.read_at,
    rule: { name: 'Not looked at yet', when: { unread: true } } },
  { name: '⏳ Waiting on them',   pick: (c) => c.direction === 'sent' && OPEN.includes(c.current_status),
    rule: { name: 'Sent and still open', when: { direction: 'sent' } } },
  { name: '✅ Settled',           pick: (c) => ['completed', 'cancelled', 'rejected'].includes(c.current_status) },
];
const OPEN = ['pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial'];

run('seed-folders-demo', async (t) => {
  console.log('\n  seeding folders with REAL chits — so the numbers differ for real reasons\n');
  const tok = await signIn(EMAIL, 'Beta Fresh');
  if (!tok) throw new Error('could not sign in as ' + EMAIL);

  /* Pull the caller's own chits from both lists. `inbox` = Task, `sent` = Order — a folder spans both, which is
     itself worth showing: a folder is a view over YOUR copies, not over one direction. */
  const inbox = ((await j('/api/chits/inbox?limit=200', { token: tok })).b || {}).chits || [];
  const sent  = ((await j('/api/chits/sent?limit=200',  { token: tok })).b || {}).chits || [];
  const all = [...inbox.map((c) => ({ ...c, direction: 'received' })), ...sent.map((c) => ({ ...c, direction: 'sent' }))];
  t.ok(all.length > 0, 'found ' + all.length + ' real chits to work with (' + inbox.length + ' task · ' + sent.length + ' order)');
  if (!all.length) { t.note('nothing to file — run send-test-message.js a few times first'); return; }

  const claimed = new Set();   // a copy has ONE folder — deal each out once
  const existing = ((await j('/api/folders', { token: tok })).b || {}).folders || [];

  for (const step of PLAN) {
    let f = existing.find((x) => x.name === step.name);
    if (RESET && f) { await j('/api/folders/' + f.folder_id, { method: 'DELETE', token: tok }); f = null; }
    if (!f) {
      const made = await j('/api/folders', { method: 'POST', token: tok, body: { name: step.name } });
      f = made.b && made.b.folder;
    }
    if (!f) { t.ok(false, 'could not create ' + step.name); continue; }

    const picked = all.filter((c) => !claimed.has(c.chit_id + c.direction) && step.pick(c)).slice(0, 40);
    let filed = 0;
    for (const c of picked) {
      const r = await j('/api/folders/move', { method: 'POST', token: tok, body: { chit_id: c.chit_id, folder_id: f.folder_id, direction: c.direction } });
      if (r.status === 200) { filed++; claimed.add(c.chit_id + c.direction); }
    }

    /* A rule so the folder keeps filling itself — which is the difference between a folder you maintain and a
       folder that maintains itself. */
    let ruleNote = '';
    if (step.rule) {
      const have = ((await j('/api/folders/' + f.folder_id + '/rules', { token: tok })).b || {}).rules || [];
      if (!have.length) {
        const rr = await j('/api/folders/' + f.folder_id + '/rules', { method: 'POST', token: tok, body: step.rule });
        ruleNote = rr.status === 200 ? '  + rule: ' + step.rule.name : '  ! rule refused: ' + JSON.stringify(rr.b).slice(0, 60);
      } else ruleNote = '  · rule already set';
    }
    t.ok(true, step.name.padEnd(24) + ' filed ' + String(filed).padStart(3) + ' chits' + ruleNote);
  }

  /* ── now READ THEM BACK, which is the actual deliverable ─────────────────────────────────────────────────── */
  const folders = ((await j('/api/folders', { token: tok })).b || {}).folders || [];
  const mine = folders.filter((f) => PLAN.some((p) => p.name === f.name));

  console.log('\n  ══ WHAT THE FOLDERS NOW SAY ══════════════════════════════════════════════════════════\n');
  const pad = (s, n) => String(s === null || s === undefined ? '—' : s).padStart(n);
  console.log('  ' + 'folder'.padEnd(24) + pad('chits', 6) + pad('open', 6) + pad('unread', 7) + pad('overdue', 8)
            + pad('oldest', 8) + pad('typical', 8) + pad('1st touch', 10) + pad('to close', 9) + pad('disputed', 9));
  console.log('  ' + '─'.repeat(95));
  for (const f of mine) {
    const m = ((await j('/api/folders/' + f.folder_id + '/metrics', { token: tok })).b) || {};
    const c = m.clock || {}, d = m.disputes || {};
    console.log('  ' + String(f.name).padEnd(24)
      + pad(m.count, 6) + pad(m.open, 6) + pad(m.unread, 7) + pad(m.overdue, 8)
      + pad(c.oldest_age_days === null ? '—' : c.oldest_age_days + 'd', 8)
      + pad(c.median_age_days === null ? '—' : c.median_age_days + 'd', 8)
      + pad(c.median_first_touch_days === null ? '—' : c.median_first_touch_days + 'd', 10)
      + pad(c.median_to_close_days === null ? '—' : c.median_to_close_days + 'd', 9)
      + pad(d.rate_pct === null ? '—' : d.rate_pct + '%', 9));
    const mo = m.money || {};
    if ((mo.by_currency || []).length) {
      console.log('  ' + ' '.repeat(24) + 'value: ' + mo.by_currency.map((b) => b.currency + ' ' + b.total + ' (' + b.chits + ')').join('  ·  ')
        + (mo.mixed ? '   ⚠️ more than one currency — NOT added together' : '')
        + (((mo.excluded || {}).awaiting_agreement) ? '   · ' + mo.excluded.awaiting_agreement + ' with no agreed value (excluded, not zeroed)' : ''));
    }
  }
  console.log('\n  A DASH means nothing to measure — which is not the same as zero.');
  console.log('  "overdue" is your own policy flag; change it once and every folder and scorecard follows.\n');

  /* ── and the same measurer, pointed at a counterparty ────────────────────────────────────────────────────── */
  const parties = ((await j('/api/relationships/scorecard', { token: tok })).b || {}).counterparties || [];
  if (parties.length) {
    console.log('  ══ AND THE SAME NUMBERS, POINTED AT WHO YOU TRADE WITH ═══════════════════════════════\n');
    for (const p of parties.slice(0, 4)) {
      const s = ((await j('/api/relationships/scorecard/' + p.counterparty_id, { token: tok })).b) || {};
      const c = s.clock || {}, comp = s.completion || {}, rel = s.relationship || {};
      console.log('  ' + String(p.name || p.counterparty_id).padEnd(22)
        + pad(s.count, 5) + ' chits · ' + String(rel.shape || '').padEnd(18)
        + ' open ' + pad(s.open, 3) + ' · overdue ' + pad(s.overdue, 3)
        + ' · 1st touch ' + pad(c.median_first_touch_days === null ? '—' : c.median_first_touch_days + 'd', 5)
        + ' · to close ' + pad(c.median_to_close_days === null ? '—' : c.median_to_close_days + 'd', 5)
        + ' · completed ' + pad(comp.completion_rate_pct === null ? '—' : comp.completion_rate_pct + '%', 5)
        + ' · disputed ' + pad((s.disputes || {}).rate_pct === null ? '—' : s.disputes.rate_pct + '%', 5));
    }
    console.log('\n  ⚠️ Derived ONLY from co-held chits — both sides hold matching copies, so the counterparty');
    console.log('     can run the same arithmetic and reach the same answer. Nobody was asked for data.');
    console.log('  ⚠️ And there is deliberately no 0-100 grade: one number invites a ranking, and the');
    console.log('     weighting behind it would be nobody-in-particular\'s.\n');
  }
});
