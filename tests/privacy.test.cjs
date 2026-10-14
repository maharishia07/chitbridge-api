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
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola', phone: '+91 98400 12345', email: 'chola@example.com' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' })];
D.sup = [];

/* the two b306/b307 tables, in memory — append-only for prefs; requests answered once (what the trigger enforces in Postgres) */
const T = { prefs: [], reqs: [], have: { party_contact_pref: true, privacy_request: true }, writes: [] };
let seq = 0; const uid = () => '20000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
let clock = Date.parse('2026-10-13T06:00:00Z');
D.extra = async (sql, p) => {
  if (/^SELECT to_regclass\(\$1\) IS NOT NULL AS ok/.test(sql)) return { rows: [{ ok: !!T.have[p[0]] }] };
  if (/^(UPDATE|DELETE) party_contact_pref/.test(sql)) { T.writes.push(sql); throw new Error('permission denied for table party_contact_pref'); }
  if (/^SELECT pref_id, .* FROM party_contact_pref/.test(sql)) return { rows: T.prefs.filter((r) => r.owner === p[0] && r.party_id === p[1]).slice().reverse() };
  /* privacy.latest (MKT-SRV1): the newest row per (party, channel, purpose) — by party ids, by phone digits, or by e-mail (the senders' gate) */
  if (/^SELECT DISTINCT ON \(p\.party_id, p\.channel, p\.purpose\)/.test(sql)) {
    let rows = T.prefs.filter((r) => r.owner === p[0]);
    if (/p\.party_id = ANY/.test(sql)) rows = rows.filter((r) => p[1].indexOf(r.party_id) >= 0);
    else if (/i\.phone/.test(sql)) rows = rows.filter((r) => D.cust.some((x) => x.party_id === r.party_id && String(x.phone || '').replace(/[^0-9]/g, '') === p[1]));
    else if (/lower\(i\.email\)/.test(sql)) rows = rows.filter((r) => D.cust.some((x) => x.party_id === r.party_id && String(x.email || '').toLowerCase() === p[1]));
    const latest = new Map(); rows.slice().reverse().forEach((r) => { const k = r.party_id + '|' + r.channel + '|' + r.purpose; if (!latest.has(k)) latest.set(k, r); });
    return { rows: Array.from(latest.values()) };
  }
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
  await ita('G0: the gate is one pure function (the newest row wins) and every verdict carries a CODE the client branches on — never a regex over the sentence', async () => {
    const rows = [{ channel: 'email', purpose: 'marketing', allowed: true }, { channel: 'email', purpose: 'marketing', allowed: false }];
    assert.deepStrictEqual(PV.mayMessage(rows, 'email', 'marketing'), { may: true, code: 'CONSENT_GIVEN', why: 'They agreed to offers on email.' });
    assert.strictEqual(PV.mayMessage([], 'sms', 'marketing').code, 'NO_CONSENT');
    assert.strictEqual(PV.mayMessage([{ channel: 'sms', purpose: 'marketing', allowed: false, withdrawn_at: '2026-10-01T00:00:00Z' }], 'sms', 'marketing').code, 'CONSENT_WITHDRAWN');
    assert.strictEqual(PV.mayMessage([{ channel: 'sms', purpose: 'marketing', allowed: false }], 'sms', 'marketing').code, 'CONSENT_REFUSED');
    assert.strictEqual(PV.mayMessage([{ channel: 'sms', purpose: 'service', allowed: false }], 'sms', 'service').code, 'OPTED_OUT');
    assert.strictEqual(PV.mayMessage([], 'sms', 'service').code, 'LEGITIMATE_USE');
    ['NO_CONSENT', 'CONSENT_WITHDRAWN', 'CONSENT_REFUSED', 'CONSENT_GIVEN', 'OPTED_OUT', 'LEGITIMATE_USE', 'CONSENT_UNKNOWN'].forEach((c) => assert.ok(PV.CODES[c], c + ' is listed'));
    const g = (await t.get(prefs())).body;
    PV.CHANNELS.forEach((c) => { assert.ok(g.may[c].marketing.code && g.may[c].service.code, 'the may map carries the code on ' + c); });
    assert.strictEqual(g.may.whatsapp.marketing.code, 'CONSENT_WITHDRAWN'); assert.strictEqual(g.may.sms.service.code, 'OPTED_OUT');
  });

  console.log('\n-- CO1-GATE · the interaction log asks first (G2) · the record and the list carry the answer (G5 · G1) --');
  const log = (b) => t.post('/parties/' + P(2) + '/interactions', b);
  await ita('an offer logged as sent on WhatsApp → 403 { code: CONSENT_WITHDRAWN, why } and nothing written; on e-mail → NO_CONSENT', async () => {
    const n = D.interactions.length;
    const r = await log({ kind: 'message', direction: 'out', purpose: 'marketing', body: 'Diwali offer' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'CONSENT_WITHDRAWN'); assert.ok(/withdrew/.test(r.body.why), r.body.why);
    const e = await log({ kind: 'message', direction: 'out', channel: 'email', purpose: 'marketing', body: 'Diwali offer' }); assert.strictEqual(e.status, 403); assert.strictEqual(e.body.code, 'NO_CONSENT');
    assert.strictEqual(D.interactions.length, n);
  });
  await ita('a call out by phone goes through (legitimate use); a message out on SMS is OPTED_OUT; once they say no to phone, a call is refused too', async () => {
    assert.strictEqual((await log({ kind: 'call', direction: 'out', body: 'rang' })).status, 201);
    const s = await log({ kind: 'message', direction: 'out', channel: 'sms', body: 'order ready' }); assert.strictEqual(s.status, 403); assert.strictEqual(s.body.code, 'OPTED_OUT');
    assert.strictEqual((await t.post(prefs(), { channel: 'phone', purpose: 'service', allowed: false })).status, 201);
    const c = await log({ kind: 'call', direction: 'out', body: 'rang' }); assert.strictEqual(c.status, 403); assert.strictEqual(c.body.code, 'OPTED_OUT'); assert.ok(/not to be messaged on phone/.test(c.body.why));
  });
  await ita('never gated: a call IN, a visit, a note — nothing was sent; an unknown channel or purpose is 400 with its code', async () => {
    for (const b of [{ kind: 'call', direction: 'in', body: 'they rang' }, { kind: 'visit', direction: 'out', body: 'went by' }, { kind: 'note', body: 'prefers mornings' }]) assert.strictEqual((await log(b)).status, 201, JSON.stringify(b));
    assert.strictEqual((await log({ kind: 'message', direction: 'out', channel: 'fax', body: 'x' })).body.code, 'BAD_CHANNEL');
    assert.strictEqual((await log({ kind: 'message', direction: 'out', purpose: 'spam', body: 'x' })).body.code, 'BAD_PURPOSE');
  });
  await ita('G5: the record carries prefs { history, may } — the same answer as GET contact-prefs — and prefs_migrated; before b306 prefs is null, the record still answers', async () => {
    const r = await t.get('/parties/' + P(2)); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const g = (await t.get(prefs())).body; assert.deepStrictEqual(r.body.prefs, { history: g.history, may: g.may }); assert.strictEqual(r.body.prefs_migrated, true);
    T.have.party_contact_pref = false; PV.forget();
    const b = await t.get('/parties/' + P(2)); assert.strictEqual(b.status, 200, JSON.stringify(b.body)); assert.strictEqual(b.body.prefs, null); assert.strictEqual(b.body.prefs_migrated, false);
    T.have.party_contact_pref = true; PV.forget();
  });
  await ita('G1: GET /parties?with=consent — each row carries prefs.may (with codes), read for the page in ONE statement; without it no row does; before b306 prefs_migrated:false', async () => {
    const n = D.queries.length; const r = await t.get('/parties?with=consent'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.prefs_migrated, true); const p = r.body.parties.find((x) => x.party_id === P(2));
    assert.strictEqual(p.prefs.may.phone.service.code, 'OPTED_OUT'); assert.strictEqual(p.prefs.may.whatsapp.marketing.code, 'CONSENT_WITHDRAWN'); assert.ok(p.prefs.may.email.marketing.why);
    assert.strictEqual(D.queries.slice(n).filter((q) => /party_contact_pref/.test(q)).length, 1, 'one statement for the page');
    const plain = await t.get('/parties'); assert.ok(!('prefs' in plain.body.parties[0])); assert.ok(!('prefs_migrated' in plain.body));
    T.have.party_contact_pref = false; PV.forget();
    const b = await t.get('/parties?with=consent'); assert.strictEqual(b.status, 200); assert.strictEqual(b.body.prefs_migrated, false); assert.ok(!('prefs' in b.body.parties[0]));
    T.have.party_contact_pref = true; PV.forget();
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
  await ita('G4: the register is paged — total · page · limit on top (60 a page, 500 at most); open and late count the WHOLE register, not the page', async () => {
    const r = (await t.get('/privacy-requests')).body; assert.strictEqual(r.total, 3); assert.strictEqual(r.page, 1); assert.strictEqual(r.limit, 60); assert.strictEqual(r.requests.length, 3);
    const p2 = (await t.get('/privacy-requests?limit=1&page=2')).body;
    assert.strictEqual(p2.requests.length, 1); assert.strictEqual(p2.total, 3); assert.strictEqual(p2.page, 2); assert.strictEqual(p2.limit, 1); assert.strictEqual(p2.open, 3);
    assert.strictEqual(p2.requests[0].request_id, r.requests[1].request_id, 'page 2 of 1 is the second row');
    const big = (await t.get('/privacy-requests?limit=99999&page=-3')).body; assert.strictEqual(big.limit, 500); assert.strictEqual(big.page, 1);
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
