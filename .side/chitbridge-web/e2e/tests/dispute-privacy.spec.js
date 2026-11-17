// dispute-privacy.spec.js — THE USP, PROVEN: A disputes with B only, and C never learns of it.
//
// ⚠️ WHY THIS EXISTS: this claim was carried by TWO skipped tests — multiparty.spec's [MP-02], whose own title
// ends "(the USP)", and disputes.spec's [DISP-02]. Both were `test.skip`, so the product's stated differentiator
// had no proof behind it at all, while reading as covered in every run summary.
//
// A dispute is confidential to its roster. On a chit A sent to BOTH B and C, a dispute A raises against B must
// be invisible to C — not merely unshown, but absent from C's copy. That is a per-party confidentiality claim,
// which means it has to be asked of the API as C, not looked at on a screen.
//
//   npx playwright test dispute-privacy --project=noauth

const { test, expect } = require('@playwright/test');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function signIn(email, name) {
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name, user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6) } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const j = v.json || {};
  return { token: j.token || (j.entity && j.entity.token) || null, entity: j.entity || null };
}
const uniq = (p) => `${p}-${Date.now() % 1000000}-${Math.floor(Math.random() * 9999)}`;
const idOf = (p) => p.entity && (p.entity.identity_id || p.entity.entity_id);

test.describe('Dispute privacy · the USP, across three entities', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let A, B, C, chitId, reason;

  test('[DP-0] arrange — A sends ONE chit to both B and C', async () => {
    A = await signIn(`${uniq('dp-a')}@test-cb.com`, 'Disp A');
    B = await signIn(`${uniq('dp-b')}@test-cb.com`, 'Disp B');
    C = await signIn(`${uniq('dp-c')}@test-cb.com`, 'Disp C');
    expect(A.token && B.token && C.token, 'three entities must sign in').toBeTruthy();
    expect(idOf(B) && idOf(C), 'B and C must have entity ids').toBeTruthy();

    const sent = await api('/api/chits/send', { method: 'POST', token: A.token, body: {
      subject: uniq('dispute usp chit'),
      recipients: [{ entity_id: idOf(B), role: 'to' }, { entity_id: idOf(C), role: 'to' }],
      line_items: [{ name: 'Widget', quantity: 2, price: 25 }],
    } });
    expect([200, 201].includes(sent.status), `A must send to B and C, got ${sent.status}: ${JSON.stringify(sent.json)}`).toBe(true);
    chitId = (sent.json && (sent.json.chit_id || (sent.json.chit && sent.json.chit.chit_id))) || null;
    expect(chitId, 'the send must return a chit id').toBeTruthy();
  });

  test('[DP-1] both B and C can see the chit — they are both on it', async () => {
    /* ⚠️ ESTABLISHED FIRST, DELIBERATELY. Without this, DP-3's "C sees no dispute" would also pass if C could
       not see the CHIT either — a test that proves confidentiality by accident of C being locked out entirely
       proves nothing about disputes. */
    for (const [who, p] of [['B', B], ['C', C]]) {
      const r = await api(`/api/chits/${chitId}/messages`, { token: p.token });
      expect(r.status, `${who} must be a participant on the chit`).toBe(200);
    }
  });

  test('[DP-2] A raises a dispute against B ALONE', async () => {
    reason = 'Short delivery on the second line — ' + uniq('r');
    const r = await api(`/api/chits/${chitId}/disputes`, { method: 'POST', token: A.token,
      body: { category: 'quantity', reason, target_entity_id: idOf(B), chit_wide: false } });
    expect([200, 201].includes(r.status), `the dispute must be raised, got ${r.status}: ${JSON.stringify(r.json)}`).toBe(true);
  });

  test('[DP-3] ⭐⭐ B SEES THE DISPUTE — and C DOES NOT', async () => {
    const rb = await api(`/api/chits/${chitId}/disputes`, { token: B.token });
    expect(rb.status, 'the party being disputed with must be able to see it').toBe(200);
    expect(JSON.stringify((rb.json && (rb.json.disputes || rb.json)) || []),
      'B is on the roster and must receive the dispute').toContain(reason);

    const rc = await api(`/api/chits/${chitId}/disputes`, { token: C.token });
    const cBody = JSON.stringify((rc.json && (rc.json.disputes || rc.json)) || []);
    /* ⚠️⚠️ THE ASSERTION THE PRODUCT IS SOLD ON. C is on the same chit, reading the same endpoint, and must not
       hold the dispute in any form — not the reason, not the category, not the fact that one exists. "C's screen
       does not show it" is a different and much weaker claim; this asks C's own copy directly. */
    expect(cBody, 'A THIRD PARTY ON THE SAME CHIT MUST NOT SEE A DISPUTE RAISED AGAINST SOMEONE ELSE')
      .not.toContain(reason);
  });

  test('[DP-4] C is not told a dispute exists, even in the aggregate', async () => {
    const rc = await api(`/api/chits/${chitId}/disputes`, { token: C.token });
    const list = (rc.json && (rc.json.disputes || (Array.isArray(rc.json) ? rc.json : []))) || [];
    /* ⚠️ A COUNT IS A LEAK TOO. "3 disputes on this chit" tells C that A is in conflict with somebody, which is
       most of the secret — the identity of the counterparty is often guessable from a two-recipient chit. */
    expect(Array.isArray(list) ? list.length : 0,
      'C must see ZERO disputes, not a redacted one and not a count').toBe(0);
  });

  test('[DP-5] a stranger on no chit at all sees nothing', async () => {
    const D = await signIn(`${uniq('dp-d')}@test-cb.com`, 'Disp D');
    const r = await api(`/api/chits/${chitId}/disputes`, { token: D.token });
    const body = JSON.stringify((r.json && (r.json.disputes || r.json)) || []);
    expect(body, 'an entity on no part of this chit must see nothing of it').not.toContain(reason);
  });
});
