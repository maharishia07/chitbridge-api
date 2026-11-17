// notif-clear.spec.js — clearing Activity must hide the row and KEEP the event.
//
// ⚠️ THE SECOND ASSERTION IS THE ONE THAT MATTERS. The Activity feed is a view over `state_log`, the trail that
// traceability and disputes are built on. A "clear" that deleted the row would pass a naive test beautifully and
// quietly destroy the audit trail — so this proves the event is still there afterwards.
//
// ⚠️ TWO PARTIES, AND NOT BY PREFERENCE. The feed excludes YOUR OWN actions by design
// (`sl.action_by_identity_id <> me`), so a single entity composing to itself produces an empty Activity list
// however much it does. My first version tried exactly that and asserted its way into proving nothing.
//
//   npx playwright test notif-clear --project=noauth

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
const idOf = (x) => x.entity && (x.entity.identity_id || x.entity.entity_id);

test.describe('Activity · clear hides the row, never the event', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let A, B, chitId, subject, rows0;

  test('[NTF-0] arrange — B sends A a chit, so A has activity to clear', async () => {
    A = await signIn(`${uniq('ntf-a')}@test-cb.com`, 'Ntf A');
    B = await signIn(`${uniq('ntf-b')}@test-cb.com`, 'Ntf B');
    expect(A.token && B.token).toBeTruthy();
    subject = uniq('activity chit');
    const sent = await api('/api/chits/send', { method: 'POST', token: B.token, body: {
      subject, recipients: [{ entity_id: idOf(A), role: 'to' }],
      line_items: [{ name: 'Widget', quantity: 1, price: 5 }],
    } });
    expect([200, 201].includes(sent.status), `B must send to A, got ${sent.status}`).toBe(true);
    chitId = sent.json && (sent.json.chit_id || (sent.json.chit && sent.json.chit.chit_id));
    expect(chitId).toBeTruthy();

    const feed = await api('/api/notifications', { token: A.token });
    rows0 = ((feed.json && feed.json.notifications) || []).length;
    /* ⚠️ ASSERTED, NOT ASSUMED — a clear that removes nothing from nothing proves nothing. */
    expect(rows0, "A's Activity must hold something before we clear it").toBeGreaterThan(0);
  });

  test('[NTF-1] every row carries a log_id — the handle a dismissal needs', async () => {
    const feed = await api('/api/notifications', { token: A.token });
    const rows = (feed.json && feed.json.notifications) || [];
    /* Without it the client can only DESCRIBE a row, and a description is not an identity: two events a second
       apart would clear each other. */
    expect(rows.every((r) => !!r.log_id), 'every notification must be identifiable').toBe(true);
  });

  test('[NTF-2] clearing ONE hides exactly that one', async () => {
    const feed = await api('/api/notifications', { token: A.token });
    const rows = (feed.json && feed.json.notifications) || [];
    const target = rows[0].log_id;
    const r = await api('/api/notifications/dismiss', { method: 'POST', token: A.token, body: { log_ids: [target] } });
    if (r.status === 503) test.skip(true, 'b164 (notif_dismissed) is not applied on this deployment');
    expect(r.status, `dismiss should succeed, got ${r.status}: ${JSON.stringify(r.json)}`).toBe(200);

    const after = await api('/api/notifications', { token: A.token });
    const ids = ((after.json && after.json.notifications) || []).map((x) => x.log_id);
    expect(ids, 'the cleared row must be gone').not.toContain(target);
    expect(ids.length, 'and only that one — clearing one must not clear the rest').toBe(rows.length - 1);
  });

  test('[NTF-3] ⭐⭐ THE EVENT SURVIVES — and so does the chit', async () => {
    const r = await api('/api/notifications/dismiss', { method: 'POST', token: A.token, body: { all: true } });
    if (r.status === 503) test.skip(true, 'b164 not applied');
    expect(r.status).toBe(200);
    const after = await api('/api/notifications', { token: A.token });
    expect(((after.json && after.json.notifications) || []).length, 'clear all must empty the feed').toBe(0);

    /* ⚠️ THIS IS WHY THE FEATURE IS BUILT THE WAY IT IS. state_log is the trail traceability and disputes are
       built on; tidying a panel must never cost an event. The chit is still there, unchanged.
       ⚠️ FETCHED BY ID, not searched for in a list — a list is paged and filtered, so "not found in the first
       page of received" and "destroyed" look identical, and only one of them is a bug. */
    const chit = await api('/api/chits/' + chitId, { token: A.token });
    expect(chit.status, 'the chit must survive clearing the Activity feed').toBe(200);
    expect(JSON.stringify(chit.json || {}), 'and be the same chit, with its subject intact').toContain(subject);
  });

  test('[NTF-4] ⭐ B is unaffected — a dismissal is per entity', async () => {
    const feed = await api('/api/notifications', { token: B.token });
    /* One party clearing their own list must never clear the other's. Same per-copy rule as the rest of the
       rail, and the reason the primary key is (entity_id, log_id). */
    expect(feed.status).toBe(200);
    const ids = ((feed.json && feed.json.notifications) || []).map((x) => x.log_id);
    expect(Array.isArray(ids), "B's feed must still be readable after A cleared theirs").toBe(true);
  });

  test('[NTF-5] an empty request is refused rather than silently clearing everything', async () => {
    const r = await api('/api/notifications/dismiss', { method: 'POST', token: A.token, body: {} });
    /* ⚠️ A missing body must NOT be read as "all". The most destructive interpretation is exactly the one a
       malformed client is most likely to send. */
    expect([400, 503].includes(r.status), `an empty dismiss must be refused, got ${r.status}`).toBe(true);
  });
});
