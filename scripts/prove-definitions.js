#!/usr/bin/env node
/**
 * prove-definitions.js — the shelf, and the promise Athi made the design turn on:
 * **"frozen by value when stamped"** (2026-08-16).
 *
 * ⭐ THE TEST THAT MATTERS is not that a definition can be created. It is this:
 *
 *     freeze a definition → EDIT it on the shelf → the frozen copy is UNCHANGED
 *                                                 → and the old version is still readable
 *
 * If that fails, a chit stamped in March holds terms that silently became December's terms, and the product's
 * central claim — that a chit is defensible later — is false. Everything else here is bookkeeping.
 *
 * Run: node scripts/prove-definitions.js     (needs migration b160)
 */
'use strict';
const P = require('./_proof');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : '  → ' + JSON.stringify(got))); }
};

async function login(email, name) {
  const r = await P.j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email, otp: (r.b && r.b.dev_otp) || '123456' } });
  return { token: v.b.token, entity: v.b.entity };
}

(async () => {
  console.log('\nDEFINITIONS · the shelf, and the freeze\n');
  const me = await login('mytest@email.com', 'mytest');

  /* Unique per run so re-runs do not collide on the (entity, kind, name) index. */
  const tag = String(Date.now()).slice(-6);
  const NAME = 'Diwali ' + tag;

  console.log('1 · author one');
  const made = await P.j('/api/definitions', { method: 'POST', ...me, body: {
    kind: 'offer', sub_kind: 'percent_off', name: NAME, note: 'festive',
    rules: { percent: 10, valid_from: '2026-11-01', valid_to: '2026-11-15', region: 'TN' } } });
  ok('a definition is created', made.status === 201, { status: made.status, body: JSON.stringify(made.b).slice(0, 160) });
  const id = made.b && made.b.definition && made.b.definition.definition_id;
  ok('…at version 1', made.b && made.b.version === 1, made.b && made.b.version);
  ok('…as a DRAFT — authoring is not publishing',
     made.b && made.b.definition && made.b.definition.status === 'draft', made.b && made.b.definition && made.b.definition.status);

  const dup = await P.j('/api/definitions', { method: 'POST', ...me, body: {
    kind: 'offer', sub_kind: 'percent_off', name: NAME, rules: { percent: 99 } } });
  ok('⚠️ the same name twice in one kind is refused — a name is how a definition is CITED',
     dup.status === 409, dup.status);

  console.log('\n2 · ⭐⭐ FROZEN BY VALUE WHEN STAMPED');
  const frozen = await P.j('/api/definitions/freeze', { method: 'POST', ...me, body: { definition_ids: [id] } });
  ok('freeze returns a snapshot', frozen.status === 200 && (frozen.b.frozen || []).length === 1, frozen.b);
  const snap = (frozen.b.frozen || [])[0] || {};
  ok('…carrying the RULES themselves (the copy)', snap.rules && snap.rules.percent === 10, snap.rules);
  ok('⭐ …AND the version it copied (the pointer)', snap.version === 1, snap.version);
  ok('…and the name, so the chit can say WHAT it applied', snap.name === NAME, snap.name);
  ok('…and when it was frozen', !!snap.frozen_at, snap.frozen_at);

  /* THE EDIT. This is the moment the whole design is about. */
  const edited = await P.j('/api/definitions/' + id, { method: 'PUT', ...me, body: {
    rules: { percent: 25, valid_from: '2026-11-01', valid_to: '2026-11-30', region: 'TN' } } });
  ok('editing the rules writes a NEW version, never an overwrite',
     edited.status === 200 && edited.b.new_version === true && edited.b.version === 2,
     { v: edited.b && edited.b.version, nv: edited.b && edited.b.new_version });

  ok('⭐⭐ THE FROZEN COPY IS UNCHANGED — 10%, not 25%', snap.rules.percent === 10, snap.rules.percent);

  const full = await P.j('/api/definitions/' + id, me);
  const vs = (full.b && full.b.versions) || [];
  ok('⭐ BOTH versions are still readable — the frozen copy can be checked against the shelf',
     vs.length === 2, vs.map((v) => v.version));
  const v1 = vs.filter((v) => v.version === 1)[0] || {};
  ok('…and version 1 still says 10%', v1.rules && v1.rules.percent === 10, v1.rules);
  const v2 = vs.filter((v) => v.version === 2)[0] || {};
  ok('…while the shelf has moved to 25%', v2.rules && v2.rules.percent === 25, v2.rules);

  const after = await P.j('/api/definitions/freeze', { method: 'POST', ...me, body: { definition_ids: [id] } });
  ok('a NEW freeze takes the CURRENT version — 25% at v2',
     (after.b.frozen || [])[0].rules.percent === 25 && (after.b.frozen || [])[0].version === 2,
     after.b.frozen);

  console.log('\n3 · ⚠️ retire, never delete');
  const del = await P.j('/api/definitions/' + id, { method: 'DELETE', ...me });
  ok('DELETE retires rather than deleting', del.status === 200 && del.b.retired === true, del.b);
  /**
   * ⚠️⚠️ AN ASSERTION ABOUT ABSENCE MUST CHECK THE STATUS CODE.
   *
   * This block originally read only "is my row in the array" — and an ERROR's empty array satisfies "not in the
   * array" perfectly. The list route was answering 500 (an ambiguous `entity_id` across the LEFT JOIN) and this
   * test reported it as a clean pass: "it leaves the default shelf" was true for entirely the wrong reason.
   * The bug surfaced only because the NEXT assertion — the positive one — failed.
   */
  const gone = await P.j('/api/definitions?kind=offer', me);
  ok('the shelf actually answers (not a 500 masquerading as an empty list)', gone.status === 200, gone.status);
  const listed = (gone.b.definitions || []).filter((d) => d.definition_id === id);
  ok('…so it leaves the default shelf', gone.status === 200 && listed.length === 0, listed.length);
  const all = await P.j('/api/definitions?all=1', me);
  ok('?all=1 answers', all.status === 200, all.status);
  ok('…and a retired definition is still there when asked for',
     (all.b.definitions || []).some((d) => d.definition_id === id),
     { status: all.status, rows: (all.b.definitions || []).length });
  const onlyRetired = await P.j('/api/definitions?status=retired', me);
  ok('…and ?status=retired finds it directly',
     (onlyRetired.b.definitions || []).some((d) => d.definition_id === id), onlyRetired.status);

  const stillFreezes = await P.j('/api/definitions/freeze', { method: 'POST', ...me, body: { definition_ids: [id] } });
  ok('⚠️ …and a RETIRED definition still freezes — retiring means "stop offering", not "never happened"',
     (stillFreezes.b.frozen || []).length === 1, stillFreezes.b);

  const still = await P.j('/api/definitions/' + id, me);
  ok('…and its history survives retirement', ((still.b && still.b.versions) || []).length === 2);

  console.log('\n4 · ⚠️ what was NOT found is reported, not swallowed');
  const partial = await P.j('/api/definitions/freeze', { method: 'POST', ...me,
    body: { definition_ids: [id, '00000000-0000-0000-0000-000000000000'] } });
  ok('a missing id comes back in `missing`', (partial.b.missing || []).length === 1, partial.b.missing);
  ok('…and the one that exists still freezes', (partial.b.frozen || []).length === 1);

  console.log('\n5 · ⚠️ WITH RLS — another entity cannot see or freeze it');
  const them = await login('karpagam@email.com', 'Karpagam Caterers');
  const theirList = await P.j('/api/definitions?all=1', them);
  ok('another entity does not see it on their shelf',
     !((theirList.b.definitions || []).some((d) => d.definition_id === id)));
  const theirGet = await P.j('/api/definitions/' + id, them);
  ok('…cannot open it by id', theirGet.status === 404, theirGet.status);
  const theirFreeze = await P.j('/api/definitions/freeze', { method: 'POST', ...them, body: { definition_ids: [id] } });
  ok('⭐ …and cannot freeze it — it comes back as MISSING, not as someone else’s terms',
     (theirFreeze.b.frozen || []).length === 0 && (theirFreeze.b.missing || []).length === 1, theirFreeze.b);

  console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nthrew: ' + e.message); process.exit(1); });
