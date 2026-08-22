#!/usr/bin/env node
/** @covers FR-K4 — edit the shelf after sending and the chit does not move — frozen by value when stamped */
/**
 * prove-adoption-freeze.js — the whole arc, end to end:
 *
 *     author a definition → cite it on a chit → SEND → edit the shelf → THE CHIT DOES NOT MOVE
 *
 * Athi decided the rule on 2026-08-16: **"frozen by value when stamped."** prove-definitions.js proves the
 * freeze ENDPOINT. This proves the thing that actually matters — that a chit, once sent, keeps the terms it
 * agreed, and that BOTH parties hold the same snapshot.
 *
 * ⚠️ IF THIS FAILS, THE PRODUCT'S CENTRAL CLAIM IS FALSE. A chit whose terms change after it was agreed is not
 * evidence of anything, and every dispute built on it is unwinnable by either side.
 *
 * Run: node scripts/prove-adoption-freeze.js     (needs b160)
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
  console.log('\nADOPTION · a chit keeps the terms it agreed\n');
  const me = await login('mytest@email.com', 'mytest');
  const them = await login('karpagam@email.com', 'Karpagam Caterers');
  const tag = String(Date.now()).slice(-6);

  console.log('1 · author a term and cite it');
  const made = await P.j('/api/definitions', { method: 'POST', ...me, body: {
    kind: 'offer', sub_kind: 'percent_off', name: 'Bulk ' + tag,
    rules: { percent: 10, region: 'TN' } } });
  ok('a definition exists to cite', made.status === 201, made.status);
  const defId = made.b && made.b.definition && made.b.definition.definition_id;

  /* This is what sendChit does at the mint: resolve every cited definition, ONCE, and carry the result. */
  const froze = await P.j('/api/definitions/freeze', { method: 'POST', ...me, body: { definition_ids: [defId] } });
  const snapshot = { frozen_terms: froze.b.frozen, frozen_at: froze.b.frozen_at };
  ok('the mint freezes it before the chit exists', (snapshot.frozen_terms || []).length === 1, froze.b);
  ok('…as a COPY of the rules', snapshot.frozen_terms[0].rules.percent === 10, snapshot.frozen_terms[0].rules);
  ok('…AND a pointer to the version', snapshot.frozen_terms[0].version === 1, snapshot.frozen_terms[0].version);

  console.log('\n2 · send the chit carrying those terms');
  const subject = 'Adoption freeze ' + tag;
  const sent = await P.j('/api/chits/send', { method: 'POST', ...me, body: {
    manual_subject: subject,
    recipients: [{ name: 'Karpagam Caterers', role: 'to' }],
    line_items: [{ particulars: 'Tamarind', unit: 'kg', quantity: 10, price: 190, total: 1900 }],
    business_json: snapshot } });
  ok('the chit is sent', sent.status === 200 || sent.status === 201, sent.status);
  const chitId = sent.b && (sent.b.chit_id || (sent.b.chit && sent.b.chit.chit_id));

  const mine = await P.j('/api/chits/' + chitId, me);
  const onChit = ((mine.b || {}).header || {}).business_json || (mine.b || {}).business_json || {};
  const terms = (onChit.frozen_terms || [])[0] || {};
  ok('⭐ the chit CARRIES the frozen terms', !!terms.definition_id, onChit);
  ok('…the rules, verbatim', terms.rules && terms.rules.percent === 10, terms.rules);
  ok('…the version it froze', terms.version === 1, terms.version);
  ok('…and the name, so it can say WHAT it applied', /^Bulk /.test(terms.name || ''), terms.name);

  console.log('\n3 · ⭐⭐ NOW MOVE THE SHELF');
  const edited = await P.j('/api/definitions/' + defId, { method: 'PUT', ...me, body: {
    rules: { percent: 25, region: 'TN' } } });
  ok('the shelf is edited to 25%', edited.status === 200 && edited.b.version === 2, edited.b && edited.b.version);

  const after = await P.j('/api/chits/' + chitId, me);
  const afterOn = ((after.b || {}).header || {}).business_json || (after.b || {}).business_json || {};
  const afterTerms = (afterOn.frozen_terms || [])[0] || {};
  ok('⭐⭐ THE SENT CHIT STILL SAYS 10% — its terms did not move',
     afterTerms.rules && afterTerms.rules.percent === 10, afterTerms.rules);
  ok('…still pointing at version 1', afterTerms.version === 1, afterTerms.version);

  const shelf = await P.j('/api/definitions/' + defId, me);
  ok('…while the shelf is at version 2, 25%',
     shelf.b.definition.current_version === 2, shelf.b.definition.current_version);
  ok('⭐ and version 1 is STILL READABLE — the chit\'s copy can be checked against the shelf',
     (shelf.b.versions || []).some((v) => v.version === 1 && v.rules.percent === 10),
     (shelf.b.versions || []).map((v) => 'v' + v.version + ' ' + v.rules.percent + '%'));

  console.log('\n4 · ⭐ BOTH PARTIES HOLD THE SAME TERMS');
  const theirs = await P.j('/api/chits/' + chitId, them);
  ok('the counterparty can open the chit', theirs.status === 200, theirs.status);
  const theirOn = ((theirs.b || {}).header || {}).business_json || (theirs.b || {}).business_json || {};
  const theirTerms = (theirOn.frozen_terms || [])[0] || {};
  ok('⭐⭐ …and sees the SAME frozen terms — 10%, not the seller’s current 25%',
     theirTerms.rules && theirTerms.rules.percent === 10, theirTerms.rules);
  ok('…the same version pointer', theirTerms.version === 1, theirTerms.version);
  /**
   * ⚠️ THIS IS THE PART AN ERP CANNOT DO. The buyer holds their own copy of the terms — not a link to the
   * seller's record, which the seller could edit. That is why the snapshot travels ON the chit rather than
   * being resolved from the shelf when read.
   */
  ok('⚠️ …and it is their OWN copy: the shelf it came from is not even visible to them',
     (await P.j('/api/definitions/' + defId, them)).status === 404);

  console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nthrew: ' + e.message); process.exit(1); });
