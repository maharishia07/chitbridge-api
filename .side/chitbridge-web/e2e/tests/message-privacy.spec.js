// message-privacy.spec.js — AN INTERNAL NOTE MUST NEVER REACH THE COUNTERPARTY.
// CARD  01-rail-core-the-chit/thread-messages-on-a-chit
//
// ⚠️ WHY THIS EXISTS: messages.spec.js carried this as `test.skip('… needs a 2nd entity')` — a written-down
// intention where the proof should be. It is the single most consequential claim the messaging layer makes:
// per-party confidential scoping is the dispute USP, and "your private note stayed private" is exactly the kind
// of promise that is believed until the day it turns out to be false.
//
// API-LEVEL AND TWO-PARTY, like enquiry.spec: the question is who holds a ROW, not what a screen renders.
//
//   npx playwright test message-privacy --project=noauth

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

test.describe('Message privacy · internal stays internal, across two entities', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let A, B, chitId, nonceIn, nonceEx;

  test('[MSG-P0] arrange — A sends a chit to B', async () => {
    const ea = uniq('msgp-a'); const eb = uniq('msgp-b');
    A = await signIn(`${ea}@test-cb.com`, 'Priv A');
    B = await signIn(`${eb}@test-cb.com`, 'Priv B');
    expect(A.token && B.token, 'both entities must sign in').toBeTruthy();

    /* ⚠️ THE ROUTE IS /api/chits/send, NOT POST /api/chits — and the recipient is matched by entity_id or
       display_name, not by bridge id. Guessing REST conventions against a real API is how a test spends its
       first run proving the test wrong. */
    const bId = B.entity && (B.entity.identity_id || B.entity.entity_id);
    expect(bId, 'B must have an entity id to be addressed by').toBeTruthy();

    const sent = await api('/api/chits/send', { method: 'POST', token: A.token, body: {
      subject: uniq('privacy chit'),
      recipients: [{ entity_id: bId, role: 'to' }],
      line_items: [{ name: 'Widget', quantity: 1, price: 10 }],
    } });
    expect([200, 201].includes(sent.status), `A must be able to send to B, got ${sent.status}: ${JSON.stringify(sent.json)}`).toBe(true);
    chitId = (sent.json && (sent.json.chit_id || (sent.json.chit && sent.json.chit.chit_id))) || null;
    expect(chitId, 'the send must return a chit id').toBeTruthy();
  });

  test('[MSG-P1] A writes one INTERNAL note and one EXTERNAL message', async () => {
    nonceIn = 'INTERNAL-' + uniq('n');
    nonceEx = 'EXTERNAL-' + uniq('n');
    const i = await api(`/api/chits/${chitId}/messages`, { method: 'POST', token: A.token,
      body: { message_text: nonceIn, thread_type: 'internal' } });
    const e = await api(`/api/chits/${chitId}/messages`, { method: 'POST', token: A.token,
      body: { message_text: nonceEx, thread_type: 'external' } });
    expect([200, 201].includes(i.status), `internal note must post, got ${i.status}`).toBe(true);
    expect([200, 201].includes(e.status), `external message must post, got ${e.status}`).toBe(true);
  });

  test('[MSG-P2] A sees both of their own messages', async () => {
    const r = await api(`/api/chits/${chitId}/messages`, { token: A.token });
    expect(r.status).toBe(200);
    const all = JSON.stringify((r.json && (r.json.messages || r.json)) || []);
    expect(all, 'the author must see their own internal note').toContain(nonceIn);
    expect(all, 'the author must see their own external message').toContain(nonceEx);
  });

  test('[MSG-P3] ⭐⭐ B SEES THE EXTERNAL MESSAGE AND NEVER THE INTERNAL NOTE', async () => {
    const r = await api(`/api/chits/${chitId}/messages`, { token: B.token });
    expect(r.status, 'the counterparty is a participant and must be able to read the thread').toBe(200);
    const all = JSON.stringify((r.json && (r.json.messages || r.json)) || []);

    expect(all, 'the counterparty must receive what was addressed to them').toContain(nonceEx);
    /* ⚠️ THIS IS THE ASSERTION THE WHOLE FILE EXISTS FOR. Not "B's screen hides it" — B must not HOLD it. The
       per-copy model means a row exists for you only if you were in its audience, and an internal note's
       audience is its author alone. Anything weaker (filtered on read, hidden in the UI) is a promise that
       breaks the first time somebody queries the API directly, which is exactly what this does. */
    expect(all, 'AN INTERNAL NOTE MUST NOT EXIST IN THE COUNTERPARTY\'S COPY AT ALL').not.toContain(nonceIn);
  });

  test('[MSG-P4] asking for the internal thread as B returns nothing of A\'s', async () => {
    const r = await api(`/api/chits/${chitId}/messages?thread_type=internal`, { token: B.token });
    expect(r.status).toBe(200);
    const all = JSON.stringify((r.json && (r.json.messages || r.json)) || []);
    /* ⚠️ ASKED FOR EXPLICITLY, because "it is not in the default view" and "it is not mine to read" are different
       claims and only the second one is worth anything. B's internal thread is B's own notes — never A's. */
    expect(all, 'B\'s internal thread must never contain A\'s internal note').not.toContain(nonceIn);
  });

  test('[MSG-P5] a third party who is not on the chit cannot read it at all', async () => {
    const C = await signIn(`${uniq('msgp-c')}@test-cb.com`, 'Priv C');
    const r = await api(`/api/chits/${chitId}/messages`, { token: C.token });
    /* Not a participant. 404 or an empty thread are both acceptable answers; a 200 carrying the messages is not.
       ⚠️ 403 would be worse than 404 here for the same reason the enquiry route avoids it — it confirms the chit
       exists to someone who should not know that. */
    const all = JSON.stringify((r.json && (r.json.messages || r.json)) || []);
    expect(all, 'a non-participant must see neither message').not.toContain(nonceEx);
    expect(all, 'a non-participant must see neither message').not.toContain(nonceIn);
  });
});
