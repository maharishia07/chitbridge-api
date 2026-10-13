/**
 * CO1 privacy — contact consent (b306), the privacy-request register (b307) and the public facts, through the REAL router (routes/crm.js)
 * and the REAL lib/privacy.js, with the two tables STUBBED in memory (the migrations are drafts Athi runs). Offline (tests/support/crm-stub.cjs).
 * What it proves, each a Standards-register claim:
 *   K2  a "no" or a withdrawal is a NEW row (nothing updated or deleted); offers are refused without consent, with the reason; service
 *       messages ride on legitimate use until the person says no; "legitimate use" can never be the basis for offers.
 *   K4/K11 a request gets the due date its country's law sets (IN grievance 15 d · IN other 30 d · AU 30 d); only the owner answers;
 *       an answer is given once; late is computed by the server.
 *   K9  GET /api/privacy/facts names every sub-processor with its region, and says in words what the owner has not yet published.
 *   before b306 / b307: 503 PRIVACY_NOT_MIGRATED in words — never a 500, nothing written.
 * Run: node tests/privacy.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data, PV = require('../lib/privacy');
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' })];
D.sup = [];

/* the two b306/b307 tables, in memory — append-only for prefs; requests answered once (what the trigger enforces in Postgres) */
const T = { prefs: [], reqs: [], have: { party_contact_pref: true, privacy_request: true }, writes: [] };
let seq = 0; const uid = () => '20000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
let clock = Date.parse('2026-10-13T06:00:00Z');
D.extra = async (sql, p) => {
  if (/^SELECT to_regclass\(\$1\) IS NOT NULL AS ok/.test(sql)) return { rows: [{ ok: !!T.have[p[0]] }] };
  if (/^(UPDATE|DELETE) party_contact_pref/.test(sql)) { T.writes.push(sql); throw new Error('permission denied for table party_contact_pref'); }
  if (/^SELECT pref_id, .* FROM party_contact_pref/.test(sql)) return { rows: T.prefs.filter((r) => r.owner === p[0] && r.party_id === p[1]).slice().reverse() };
  if (/^INSERT INTO party_contact_pref/.test(sql)) {
    clock += 1000;
    const r = { pref_id: uid(), owner: p[0], party_id: p[1], channel: p[2], purpose: p[3], allowed: p[4], basis: p[5], notice_version: p[6], noted_by: p[7], noted_at: new Date(clock).toISOString(), withdrawn_at: /now\(\)\)\s*RETURNING/.test(sql) ? new Date(clock).toISOString() : null };
    T.prefs.push(r); return { rows: [r] };
  }
  if (/^SELECT country FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ country: D.shopCountry || 'IN' }] };
  if (/^INSERT INTO privacy_request/.test(sql)) {
    const r = { request_id: uid(), owner: p[0], party_id: p[1], who: p[2], kind: p[3], country: p[4], received_at: p[5], due_at: p[6], created_by: p[7], answered_at: null, outcome: null, answer: null };
    T.reqs.push(r); return { rows: [r] };
  }
  if (/^SELECT request_id, .* FROM privacy_request/.test(sql)) return { rows: T.reqs.filter((r) => r.owner === p[0] && (!/answered_at IS NULL/.test(sql) || !r.answered_at)) };
  if (/^UPDATE privacy_request SET answered_at = now\(\)/.test(sql)) {
    const r = T.reqs.find((x) => x.owner === p[0] && x.request_id === p[1] && !x.answered_at); if (!r) return { rows: [] };
    Object.assign(r, { answered_at: new Date().toISOString(), answered_by: p[2], outcome: p[3], answer: p[4] }); return { rows: [r] };
  }
  return null;
};
const prefs = (id) => '/parties/' + (id || P(2)) + '/contact-prefs';

(async () => {
  console.log('\n-- before the migrations --');
  await ita('b306 not run: GET and POST contact-prefs answer 503 PRIVACY_NOT_MIGRATED, naming b306 — nothing written', async () => {
    T.have.party_contact_pref = false; PV.forget();
    for (const r of [await t.get(prefs()), await t.post(prefs(), { channel: 'whatsapp', purpose: 'marketing', allowed: true })]) {
      assert.strictEqual(r.status, 503, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'PRIVACY_NOT_MIGRATED'); assert.ok(/b306/.test(r.body.message));
    }
    assert.strictEqual(T.prefs.length, 0); T.have.party_contact_pref = true; PV.forget();
  });
  await ita('b307 not run: the register answers 503 PRIVACY_NOT_MIGRATED, naming b307', async () => {
    T.have.privacy_request = false; PV.forget();
    const r = await t.get('/privacy-requests'); assert.strictEqual(r.status, 503); assert.ok(/b307/.test(r.body.message));
    T.have.privacy_request = true; PV.forget();
  });

  console.log('\n-- K2 · consent --');
  await ita('no rows: offers are refused on every channel WITH the reason; service messages are allowed (legitimate use)', async () => {
    const r = await t.get(prefs()); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    for (const c of PV.CHANNELS) { assert.strictEqual(r.body.may[c].marketing.may, false); assert.ok(/No consent/.test(r.body.may[c].marketing.why)); assert.strictEqual(r.body.may[c].service.may, true); }
  });
  await ita('a yes to offers on WhatsApp → 201; basis defaults to consent; who noted it is kept; offers on WhatsApp now allowed, e-mail still not', async () => {
    t.as('E1', { identity: { identity_id: 'A1', parent_entity_id: 'E1' } });
    const r = await t.post(prefs(), { channel: 'WhatsApp', purpose: 'marketing', allowed: true }); t.as('E1');
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.pref.basis, 'consent'); assert.strictEqual(r.body.pref.noted_by, 'A1');
    const g = (await t.get(prefs())).body; assert.strictEqual(g.may.whatsapp.marketing.may, true); assert.strictEqual(g.may.email.marketing.may, false);
  });
  await ita('withdrawing is a NEW row with withdrawn_at — the yes stays as proof; nothing was updated or deleted', async () => {
    const r = await t.post(prefs(), { channel: 'whatsapp', purpose: 'marketing', allowed: false });
    assert.strictEqual(r.status, 201); assert.ok(r.body.pref.withdrawn_at, 'a withdrawal is marked');
    const g = (await t.get(prefs())).body;
    assert.strictEqual(g.history.length, 2); assert.strictEqual(g.history[0].allowed, false); assert.strictEqual(g.history[1].allowed, true);
    assert.strictEqual(g.may.whatsapp.marketing.may, false); assert.ok(/withdrew/.test(g.may.whatsapp.marketing.why));
    assert.strictEqual(T.writes.length, 0); assert.ok(!D.queries.some((q) => /^(UPDATE|DELETE) party_contact_pref/.test(q)));
  });
  await ita('a "do not message" on SMS stops service messages there too, in words', async () => {
    await t.post(prefs(), { channel: 'sms', purpose: 'service', allowed: false });
    const g = (await t.get(prefs())).body; assert.strictEqual(g.may.sms.service.may, false); assert.ok(/asked not to be messaged/.test(g.may.sms.service.why));
    assert.strictEqual(g.may.phone.service.may, true);
  });
  await ita('refused in words: legitimate use as the basis for offers, an unknown channel, no yes/no', async () => {
    const n = T.prefs.length;
    for (const [b, why] of [[{ channel: 'email', purpose: 'marketing', allowed: true, basis: 'legitimate_use' }, 'consent'], [{ channel: 'fax', purpose: 'service', allowed: true }, 'Channel'], [{ channel: 'email', purpose: 'service' }, 'yes or no']]) {
      const r = await t.post(prefs(), b); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.ok(new RegExp(why).test(r.body.message), r.body.message);
    }
    assert.strictEqual(T.prefs.length, n);
  });
  await ita('a party that is not mine → 404; a junk id → 400; an API key → 403', async () => {
    assert.strictEqual((await t.get(prefs(P(9)))).status, 404);
    assert.strictEqual((await t.get(prefs('nope'))).status, 400);
    t.as('E1', { key: true }); assert.strictEqual((await t.get(prefs())).status, 403); t.as('E1');
  });
  await ita('the gate is one pure function: the newest row wins', () => {
    const rows = [{ channel: 'email', purpose: 'marketing', allowed: true }, { channel: 'email', purpose: 'marketing', allowed: false }];
    assert.strictEqual(PV.mayMessage(rows, 'email', 'marketing').may, true);
  });

  console.log('\n-- K4 · K11 · the request register --');
  let rid;
  await ita('an Indian grievance is due in 15 days; an access request in 30; an Australian one in 30 — the server sets the clock', async () => {
    const g = await t.post('/privacy-requests', { kind: 'grievance', who: ' Kavya  98400 00000 ', received_at: '2026-09-01T00:00:00Z' });
    assert.strictEqual(g.status, 201, JSON.stringify(g.body)); assert.strictEqual(g.body.request.country, 'IN'); assert.strictEqual(g.body.request.who, 'Kavya 98400 00000');
    assert.strictEqual(g.body.request.due_at, '2026-09-16T00:00:00.000Z');
    const a = await t.post('/privacy-requests', { kind: 'access', who: 'Chola', party_id: P(2), received_at: '2026-10-01T00:00:00Z' });
    assert.strictEqual(a.body.request.due_at, '2026-10-31T00:00:00.000Z'); rid = a.body.request.request_id;
    const au = await t.post('/privacy-requests', { kind: 'erase', who: 'Sam', country: 'au', received_at: '2026-10-01T00:00:00Z' });
    assert.strictEqual(au.body.request.country, 'AU'); assert.strictEqual(au.body.request.due_at, '2026-10-31T00:00:00.000Z');
  });
  await ita('refused in words: an unknown kind, no one named, a date in the future, a party that is not mine', async () => {
    const n = T.reqs.length;
    assert.strictEqual((await t.post('/privacy-requests', { kind: 'gossip', who: 'x' })).status, 400);
    assert.strictEqual((await t.post('/privacy-requests', { kind: 'access', who: '  ' })).status, 400);
    assert.strictEqual((await t.post('/privacy-requests', { kind: 'access', who: 'x', received_at: '2099-01-01' })).status, 400);
    assert.strictEqual((await t.post('/privacy-requests', { kind: 'access', who: 'x', party_id: P(9) })).status, 404);
    assert.strictEqual(T.reqs.length, n);
  });
  await ita('the list: open first, `late` from the server, and may_answer/why for the caller', async () => {
    const r = await t.get('/privacy-requests'); assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.open, 3); assert.strictEqual(r.body.late, r.body.requests.filter((x) => Date.parse(x.due_at) < Date.now()).length, 'late = open and past its due date');
    assert.strictEqual(r.body.requests.find((x) => x.kind === 'grievance').late, true);
    assert.strictEqual(r.body.may_answer, true); assert.strictEqual(r.body.why, null);
    t.as('E1', { identity: { identity_id: 'A1', parent_entity_id: 'E1' } });
    const c = await t.get('/privacy-requests'); t.as('E1'); assert.strictEqual(c.body.may_answer, false); assert.ok(/Only the owner/.test(c.body.why));
  });
  await ita('a co-assist cannot answer (403, in words); the owner answers once; a second answer is 409', async () => {
    t.as('E1', { identity: { identity_id: 'A1', parent_entity_id: 'E1' } });
    const c = await t.post('/privacy-requests/' + rid + '/answer', { outcome: 'done', answer: 'Sent the record' }); t.as('E1');
    assert.strictEqual(c.status, 403); assert.strictEqual(c.body.code, 'OWNER_ONLY');
    const o = await t.post('/privacy-requests/' + rid + '/answer', { outcome: 'done', answer: 'Sent their record and timeline by e-mail' });
    assert.strictEqual(o.status, 200, JSON.stringify(o.body)); assert.ok(o.body.request.answered_at); assert.strictEqual(o.body.request.outcome, 'done');
    const again = await t.post('/privacy-requests/' + rid + '/answer', { outcome: 'refused', answer: 'x' }); assert.strictEqual(again.status, 409);
    assert.strictEqual((await t.get('/privacy-requests?open=1')).body.requests.length, 2);
  });

  console.log('\n-- K9 · the public facts --');
  await ita('facts: every sub-processor has a role and a region-or-null; the database region is India; unpublished notice/contact said in words', () => {
    delete process.env.PRIVACY_NOTICE_VERSION; delete process.env.PRIVACY_CONTACT;
    const f = PV.facts();
    assert.ok(f.processors.length >= 3); f.processors.forEach((x) => { assert.ok(x.name && x.role && x.source); assert.ok('region' in x); });
    assert.ok(/ap-south-1/.test(f.processors.find((x) => /Supabase/.test(x.name)).region));
    assert.strictEqual(f.notice_version, null); assert.ok(/No privacy notice is published yet/.test(f.notice));
    assert.strictEqual(f.contact, null); assert.ok(/No privacy contact is named yet/.test(f.contact_line));
    assert.strictEqual(f.due_days.IN.grievance, 15);
    assert.ok(!JSON.stringify(f).match(/sk-|re_[A-Za-z0-9]{8}/), 'no key ever appears');
  });
  await ita('GET /api/privacy/facts answers without sign-in and reads no database', async () => {
    const express = require('express'), http = require('http');
    const app = express(); app.use('/api/privacy', require('../routes/privacy')); const srv = app.listen(0);
    const n = D.queries.length;
    const body = await new Promise((ok, no) => http.get({ port: srv.address().port, path: '/api/privacy/facts' }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode, json: JSON.parse(b) })); }).on('error', no));
    srv.close(); assert.strictEqual(body.status, 200); assert.ok(Array.isArray(body.json.processors)); assert.strictEqual(D.queries.length, n);
  });
  t.close(); console.log('  ' + pass + ' checks');
})();
