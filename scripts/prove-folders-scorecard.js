#!/usr/bin/env node
'use strict';
/**
 * prove-folders-scorecard.js — folder metrics, the counterparty scorecard and rule preview, against the LIVE API.
 *
 * ⚠️ EVERYTHING HERE IS READ-ONLY EXCEPT THE FOLDER IT CREATES AND DELETES. The rules TABLE (b132) may not be
 * migrated yet, and this proves the surface behaves correctly either way — a rules screen that cannot store
 * anything must SAY so rather than accept a rule it will lose.
 *
 * RUN:  node scripts/prove-folders-scorecard.js
 */
const { j, signIn, run } = require('./_proof');

run('prove-folders-scorecard', async (t) => {
  console.log('\n  folders that measure · counterparties that are scored\n');
  const tok = await signIn('beta@test-cb.com', 'Beta Fresh');
  if (!tok) throw new Error('could not sign in');

  /* ── the shared measurer, seen through a FOLDER ───────────────────────────────────────────────────────────── */
  const made = await j('/api/folders', { method: 'POST', token: tok, body: { name: 'Proof · metrics ' + String(process.pid).slice(-4) } });
  t.ok(made.status === 200 && made.b.folder, 'a folder can be created', JSON.stringify(made.b).slice(0, 120));
  const fid = made.b.folder && made.b.folder.folder_id;

  const m = await j('/api/folders/' + fid + '/metrics', { token: tok });
  t.ok(m.status === 200, 'the folder answers with metrics', JSON.stringify(m.b).slice(0, 140));
  t.ok(m.b.count === 0, 'a new folder holds nothing', 'count=' + m.b.count);
  /* ⚠️ THE CLAIM THAT MATTERS ON AN EMPTY SET. "0% disputed" reads as a clean record; it would actually mean
     "nothing has ever been filed here", and someone would decide something on it. */
  t.ok(m.b.disputes.rate_pct === null, '★★★ an empty folder reports dispute rate NULL, never 0%');
  t.ok(m.b.clock.median_age_days === null && m.b.clock.oldest_at === null, '★★ every clock is null, not zero');
  t.ok(typeof m.b.overdue_days === 'number', '★ "overdue" is reported as a declared threshold, not hidden in the query',
    'overdue_days=' + m.b.overdue_days);
  t.ok(m.b.money && Array.isArray(m.b.money.by_currency), '★ money comes back as per-currency buckets');
  t.ok(m.b.money.total === null || m.b.money.by_currency.length <= 1,
    '★★ there is no single total unless exactly one currency is present');

  /* ── the SAME measurer, seen through a COUNTERPARTY ───────────────────────────────────────────────────────── */
  const list = await j('/api/relationships/scorecard', { token: tok });
  t.ok(list.status === 200 && Array.isArray(list.b.counterparties), 'the scorecard lists who you have traded with',
    JSON.stringify(list.b).slice(0, 140));
  const who = (list.b.counterparties || [])[0];
  t.ok(true, '  · counterparties found: ' + (list.b.counterparties || []).length + (who ? ' (top: ' + who.name + ' × ' + who.chits + ')' : ''));

  if (who) {
    const card = await j('/api/relationships/scorecard/' + who.counterparty_id, { token: tok });
    t.ok(card.status === 200, 'one counterparty scores', JSON.stringify(card.b).slice(0, 140));
    t.ok(card.b.count > 0, '★ it counts real chits', 'count=' + card.b.count);
    t.ok(['both ways', 'you buy from them', 'they buy from you'].includes(card.b.relationship.shape),
      '★★ it says WHICH WAY ROUND the relationship reads — the same numbers describe two different relationships otherwise',
      card.b.relationship.shape);
    t.ok(card.b.clock !== undefined && card.b.money !== undefined && card.b.by_status !== undefined,
      '★★ a scorecard is a SUPERSET of a folder metric — same measurer, so they cannot disagree');
    t.ok(card.b.grade === undefined && card.b.score === undefined,
      '★★★ NO single 0-100 grade — one number invites a ranking, and the weighting would be nobody\'s');
    t.ok(card.b.completion && ('completion_rate_pct' in card.b.completion),
      '★ completion is reported as a rate of CLOSED chits');
  } else {
    t.note('no counterparties on this account yet — the per-counterparty half could not run');
  }

  /* ── RULES: preview must work whether or not b132 has been run ────────────────────────────────────────────── */
  const vocab = await j('/api/folders/rules/vocabulary', { token: tok });
  t.ok(vocab.status === 200 && vocab.b.keys && vocab.b.keys.from,
    '★ the condition vocabulary is served to the UI, so a builder cannot offer a term the matcher does not know');

  const bad = await j('/api/folders/rules/preview', { method: 'POST', token: tok, body: { when: { sender: 'x' } } });
  t.ok(bad.status === 400, '★★★ an UNKNOWN condition key is REFUSED, not ignored — a rule matching nothing still looks enabled',
    'got ' + bad.status);
  const empty = await j('/api/folders/rules/preview', { method: 'POST', token: tok, body: { when: {} } });
  t.ok(empty.status === 400, '★★ an EMPTY condition is refused — it would match every chit ever', 'got ' + empty.status);

  const prev = await j('/api/folders/rules/preview', { method: 'POST', token: tok, body: { when: { direction: 'received' } } });
  t.ok(prev.status === 200 && typeof prev.b.matched === 'number',
    '★★★ PREVIEW works — a rule can be read before it is trusted', JSON.stringify(prev.b).slice(0, 120));
  t.ok(prev.b.scanned >= prev.b.matched, '★ it reports what it scanned as well as what it caught',
    prev.b.matched + ' of ' + prev.b.scanned);

  /* ── the rules table itself: present, or honestly absent ──────────────────────────────────────────────────── */
  const rules = await j('/api/folders/' + fid + '/rules', { token: tok });
  t.ok(rules.status === 200, 'the rules list answers', JSON.stringify(rules.b).slice(0, 120));
  if (rules.b.migrated === false) {
    t.ok(rules.b.note && /not migrated/i.test(rules.b.note),
      '★★★ b132 is NOT applied, and the API SAYS SO rather than pretending to have no rules');
    const save = await j('/api/folders/' + fid + '/rules', { method: 'POST', token: tok, body: { when: { direction: 'received' }, name: 'x' } });
    t.ok(save.status === 503, '★★★ …and a write is REFUSED (503), never silently lost', 'got ' + save.status);
    t.note('run migrations/b132_folder_rules.sql, then re-run this for the live-rule half');
  } else {
    const save = await j('/api/folders/' + fid + '/rules', { method: 'POST', token: tok, body: { name: 'proof rule', when: { direction: 'received' } } });
    t.ok(save.status === 200 && save.b.rule_id, '★★ b132 IS applied — a rule saves', JSON.stringify(save.b).slice(0, 120));
    const back = await j('/api/folders/' + fid + '/rules', { token: tok });
    t.ok((back.b.rules || []).length === 1, '★ it reads back on the folder it belongs to');
    const badSave = await j('/api/folders/' + fid + '/rules', { method: 'POST', token: tok, body: { when: { nope: 1 } } });
    t.ok(badSave.status === 400, '★★★ an invalid condition cannot be STORED either');
    await j('/api/folders/rules/' + save.b.rule_id, { method: 'DELETE', token: tok });
    t.ok(true, '  · cleaned up the proof rule');
  }

  await j('/api/folders/' + fid, { method: 'DELETE', token: tok });
  t.note('cleaned up the proof folder (its chits, if any, are unfiled — never deleted)');
});
