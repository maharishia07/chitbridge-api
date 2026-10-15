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
  /* T3-P3-CONSENT: the shopper route's two identity rows at once, and the shopper's own name line */
  if (/^SELECT identity_id, display_name, phone, email, otp_contact, country FROM identities WHERE identity_id = ANY/.test(sql)) {
    return { rows: p[0].map((id) => (id === 'E1' ? { identity_id: 'E1', display_name: 'Mayur Bhavan', phone: null, email: 'shop@x.in', otp_contact: null, country: D.shopCountry || 'IN' }
      : { identity_id: id, display_name: 'Chola', phone: '+91 98000 00002', email: null, otp_contact: '9800000002', country: null })) };
  }
  if (/^SELECT display_name, phone, otp_contact, email FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ display_name: 'Chola', phone: '+91 98000 00002', otp_contact: null, email: null }] };
  if (/^INSERT INTO privacy_request/.test(sql)) {
    const r = { request_id: uid(), owner: p[0], party_id: p[1], who: p[2], kind: p[3], country: p[4], received_at: p[5], due_at: p[6], created_by: p[7], answered_at: null, outcome: null, answer: null };
    T.reqs.push(r); return { rows: [r] };
  }
  if (/^WITH c AS \(SELECT count\(\*\)::int AS total/.test(sql)) {   /* G4: the counts over the whole (or open) register + one page, open first by due date */
    const all = T.reqs.filter((r) => r.owner === p[0] && (!/AND answered_at IS NULL/.test(sql.split('SELECT c.total')[0]) || !r.answered_at) && (!/party_id = \$4/.test(sql) || r.party_id === p[3]))
      .sort((a, b) => ((!!a.answered_at) - (!!b.answered_at)) || (Date.parse(a.due_at) - Date.parse(b.due_at)));
    const head = { total: all.length, n_open: all.filter((r) => !r.answered_at).length, n_late: all.filter((r) => !r.answered_at && Date.parse(r.due_at) < Date.now()).length };
    const page = all.slice(p[2], p[2] + p[1]);
    return { rows: page.length ? page.map((r) => Object.assign({}, head, r)) : [Object.assign({ request_id: null }, head)] };
  }
  /* the send gate (G2 · CO1-GATE): the newest row for one (channel, purpose), by party id or by the phone's digits */
  const newest = (xs) => xs.slice().sort((a, b) => Date.parse(b.noted_at) - Date.parse(a.noted_at)).slice(0, 1);
  if (/^SELECT channel, purpose, allowed, basis, withdrawn_at FROM party_contact_pref WHERE owner_entity_id = \$1 AND party_id = \$2 AND channel = \$3 AND purpose = \$4/.test(sql)) {
    return { rows: newest(T.prefs.filter((r) => r.owner === p[0] && r.party_id === p[1] && r.channel === p[2] && r.purpose === p[3])) };
  }
  if (/^SELECT p\.channel, p\.purpose, p\.allowed, p\.basis, p\.withdrawn_at FROM party_contact_pref p JOIN identities i/.test(sql)) {
    const ids = D.cust.filter((c) => [c.phone, c.otp_contact].some((x) => x && String(x).replace(/[^0-9]/g, '') === p[1])).map((c) => c.party_id);
    return { rows: newest(T.prefs.filter((r) => r.owner === p[0] && ids.indexOf(r.party_id) >= 0 && r.channel === p[2] && r.purpose === p[3])) };
  }
  if (/^SELECT DISTINCT ON \(party_id, channel, purpose\)/.test(sql)) {   /* G1 · G5: the newest row per (party, channel, purpose) */
    if (!T.have.party_contact_pref) { const e = new Error('relation "party_contact_pref" does not exist'); e.code = '42P01'; throw e; }
    const seen = new Set(), out = [];
    T.prefs.filter((r) => r.owner === p[0] && (p.length < 2 || r.party_id === p[1])).slice().reverse().forEach((r) => { const k = r.party_id + r.channel + r.purpose; if (!seen.has(k)) { seen.add(k); out.push(r); } });
    return { rows: out };
  }
  if (/^WITH last AS \(SELECT DISTINCT ON \(party_id, channel\) party_id, allowed FROM party_contact_pref/.test(sql)) {   /* G3: the marketing card */
    if (!T.have.party_contact_pref) { const e = new Error('relation "party_contact_pref" does not exist'); e.code = '42P01'; throw e; }
    const last = new Map(); T.prefs.filter((r) => r.owner === p[0] && r.purpose === 'marketing').forEach((r) => last.set(r.party_id + '|' + r.channel, r));
    const per = new Map(); last.forEach((r) => per.set(r.party_id, (per.get(r.party_id) || false) || r.allowed));
    const v = Array.from(per.values()); return { rows: [{ agreed: v.filter(Boolean).length, said_no: v.filter((x) => !x).length }] };
  }
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
  await ita('G4 paging: total · page · limit top-level; ?limit=1 pages the register; open/late count the whole register, not the page', async () => {
    const all = (await t.get('/privacy-requests')).body;
    assert.strictEqual(all.total, 3); assert.strictEqual(all.page, 1); assert.strictEqual(all.limit, 50); assert.strictEqual(all.open, 2);
    const p1 = (await t.get('/privacy-requests?limit=1')).body, p2 = (await t.get('/privacy-requests?limit=1&page=2')).body;
    assert.strictEqual(p1.requests.length, 1); assert.strictEqual(p1.total, 3); assert.strictEqual(p1.limit, 1); assert.strictEqual(p1.open, 2);
    assert.strictEqual(p2.page, 2); assert.notStrictEqual(p2.requests[0].request_id, p1.requests[0].request_id);
    const past = (await t.get('/privacy-requests?limit=1&page=9')).body; assert.strictEqual(past.requests.length, 0); assert.strictEqual(past.total, 3, 'a page past the end still says the total');
    assert.strictEqual((await t.get('/privacy-requests?limit=99999')).body.limit, 200, 'the server caps the page');
  });

  console.log('\n-- MKT-SRV1 · consent first, on the server --');
  /* a second party with a phone, for the gate: P(3) said no to service messages by phone, and agreed to offers on WhatsApp only */
  D.cust.push(Object.assign(row({ party_id: P(3), display_name: 'Meena', phone: '+91 98400 11111' }), { customer_type: 'entity', added_via: 'manual', txn_count: 2, segment: 'regular' }));
  const P3 = '/parties/' + P(3);
  await t.post(P3 + '/contact-prefs', { channel: 'phone', purpose: 'service', allowed: false });
  await t.post(P3 + '/contact-prefs', { channel: 'whatsapp', purpose: 'marketing', allowed: true });
  await ita('G0: every verdict carries a code the screen branches on — CONSENT · LEGITIMATE_USE · NO_CONSENT · CONSENT_WITHDRAWN · SAID_NO · OPTED_OUT', () => {
    const m = PV.mayMessage;
    assert.strictEqual(m([], 'email', 'marketing').code, 'NO_CONSENT');
    assert.strictEqual(m([{ channel: 'email', purpose: 'marketing', allowed: true }], 'email', 'marketing').code, 'CONSENT');
    assert.strictEqual(m([{ channel: 'email', purpose: 'marketing', allowed: false, withdrawn_at: 'x' }], 'email', 'marketing').code, 'CONSENT_WITHDRAWN');
    assert.strictEqual(m([{ channel: 'email', purpose: 'marketing', allowed: false }], 'email', 'marketing').code, 'SAID_NO');
    assert.strictEqual(m([{ channel: 'sms', purpose: 'service', allowed: false }], 'sms', 'service').code, 'OPTED_OUT');
    assert.strictEqual(m([], 'sms', 'service').code, 'LEGITIMATE_USE');
    Object.values(PV.CODES).forEach((c) => assert.ok(/^[A-Z_]+$/.test(c)));
  });
  await ita('G0: GET contact-prefs carries the code beside may/why on every channel × purpose', async () => {
    const g = (await t.get(P3 + '/contact-prefs')).body;
    assert.strictEqual(g.may.phone.service.code, 'OPTED_OUT'); assert.strictEqual(g.may.whatsapp.marketing.code, 'CONSENT'); assert.strictEqual(g.may.email.marketing.code, 'NO_CONSENT');
  });
  await ita('G2: an OUT call to someone who said no by phone is refused 403 { code, why } — nothing is logged', async () => {
    const n = D.interactions.length;
    const r = await t.post(P3 + '/interactions', { kind: 'call', direction: 'out', body: 'Rang about the rate' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'OPTED_OUT'); assert.ok(/asked not to be messaged on phone/.test(r.body.why));
    assert.strictEqual(D.interactions.length, n);
  });
  await ita('G2: an offer to someone who withdrew or never agreed → 403 with that code; on the channel they agreed to → logged', async () => {
    const r = await t.post('/parties/' + P(2) + '/interactions', { kind: 'message', direction: 'out', purpose: 'marketing', body: 'Diwali offer' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'CONSENT_WITHDRAWN', 'P(2) withdrew offers on WhatsApp above');
    const e = await t.post('/parties/' + P(2) + '/interactions', { kind: 'message', direction: 'out', channel: 'email', purpose: 'marketing', body: 'Diwali offer' });
    assert.strictEqual(e.status, 403); assert.strictEqual(e.body.code, 'NO_CONSENT'); assert.ok(/Ask them first/.test(e.body.why));
    const ok = await t.post(P3 + '/interactions', { kind: 'message', direction: 'out', purpose: 'marketing', body: 'Diwali offer' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  });
  await ita('G2: in-bound calls, visits and notes are facts — never refused; a service call with no "no" passes; a junk channel → 400', async () => {
    for (const b of [{ kind: 'call', direction: 'in', body: 'They rang' }, { kind: 'visit', direction: 'out', body: 'Went over' }, { kind: 'note', body: 'Likes Tuesdays' }]) {
      const r = await t.post(P3 + '/interactions', b); assert.strictEqual(r.status, 201, JSON.stringify(b) + ' ' + JSON.stringify(r.body));
    }
    assert.strictEqual((await t.post('/parties/' + P(2) + '/interactions', { kind: 'call', direction: 'out', body: 'Rang' })).status, 201);
    assert.strictEqual((await t.post(P3 + '/interactions', { kind: 'message', direction: 'out', channel: 'fax', body: 'x' })).body.code, 'BAD_CHANNEL');
  });
  await ita('G2 before b306: a service call is logged (no "no" can exist); an offer is refused NO_CONSENT — never a 503', async () => {
    T.have.party_contact_pref = false; PV.forget();
    assert.strictEqual((await t.post(P3 + '/interactions', { kind: 'call', direction: 'out', body: 'Rang' })).status, 201);
    const r = await t.post(P3 + '/interactions', { kind: 'message', direction: 'out', purpose: 'marketing', body: 'Offer' });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'NO_CONSENT');
    T.have.party_contact_pref = true; PV.forget();
  });
  await ita('G1: GET /parties?with=consent → each party carries contact_prefs { migrated, may } — the contact-prefs map; without it, no key', async () => {
    const r = (await t.get('/parties?with=consent')).body;
    assert.strictEqual(r.consent_migrated, true);
    const m = r.parties.find((x) => x.party_id === P(3)).contact_prefs;
    assert.strictEqual(m.migrated, true); assert.strictEqual(m.may.phone.service.code, 'OPTED_OUT'); assert.strictEqual(m.may.whatsapp.marketing.may, true);
    assert.deepStrictEqual(m.may, (await t.get(P3 + '/contact-prefs')).body.may, 'one map, one shape');
    const plain = (await t.get('/parties')).body; assert.ok(!('contact_prefs' in plain.parties[0])); assert.ok(!('consent_migrated' in plain));
    T.have.party_contact_pref = false;
    const before = (await t.get('/parties?with=consent')).body; T.have.party_contact_pref = true;
    assert.strictEqual(before.consent_migrated, false); assert.strictEqual(before.parties[0].contact_prefs.migrated, false);
    assert.strictEqual(before.parties[0].contact_prefs.may.email.marketing.code, 'NO_CONSENT');
  });
  await ita('G5: the party record carries contact_prefs (the same shape)', async () => {
    const r = (await t.get(P3)).body; assert.strictEqual(r.contact_prefs.migrated, true); assert.strictEqual(r.contact_prefs.may.phone.service.code, 'OPTED_OUT');
  });
  await ita('G4: GET /parties answers total · page · limit; no ?limit = the whole list; ?limit=1&page=2 is the second party', async () => {
    const all = (await t.get('/parties')).body;
    assert.strictEqual(all.total, 2); assert.strictEqual(all.page, 1); assert.strictEqual(all.limit, 5000); assert.strictEqual(all.parties.length, 2); assert.strictEqual(all.count, all.total);
    const p2 = (await t.get('/parties?limit=1&page=2')).body;
    assert.strictEqual(p2.parties.length, 1); assert.strictEqual(p2.total, 2); assert.strictEqual(p2.parties[0].party_id, all.parties[1].party_id);
  });
  await ita('CO1-GATE: whatsapp-out.notify asks the gate first — a "no" by the number written to is refused with its code, logged, never sent', async () => {
    const W = require('../lib/whatsapp-out');
    const logged = []; const prevExtra = D.extra;
    D.extra = async (sql, p) => { if (/^INSERT INTO channel_outbound/.test(sql)) { logged.push(p); return { rows: [{ id: 'o1', status: p[6], reason: p[7] }] }; } return prevExtra(sql, p); };
    await t.post(P3 + '/contact-prefs', { channel: 'whatsapp', purpose: 'service', allowed: false });
    process.env.WHATSAPP_TOKEN = 'test-token-not-real';
    const r = await W.notify('E1', { to_ref: '919840011111', from_ref: '+91800', provider_ref: 'pn1', text: 'Your request has been accepted.' });
    assert.strictEqual(r.status, 'refused'); assert.strictEqual(r.code, 'OPTED_OUT'); assert.strictEqual(logged.length, 1); assert.ok(/asked not to be messaged/.test(logged[0][7]));
    const o = await W.notify('E1', { party_id: P(2), to_ref: '1', provider_ref: 'pn1', text: 'Offer', purpose: 'marketing' });
    assert.strictEqual(o.code, 'CONSENT_WITHDRAWN', 'by the party id when the caller knows it');
    D.extra = async () => { throw new Error('db down'); };
    const u = await W.notify('E1', { to_ref: '919840011111', provider_ref: 'pn1', text: 'x' });
    assert.strictEqual(u.status, 'refused'); assert.strictEqual(u.code, 'CONSENT_UNREADABLE', 'an unreadable gate refuses (fail closed)');
    D.extra = prevExtra; delete process.env.WHATSAPP_TOKEN;
  });
  await ita('G3: GET /api/facts/marketing — who agreed to offers, who said no; before b306 `unavailable` in words, never 0', async () => {
    const H = require('../lib/home-facts');
    const f = await H.BUILD.marketing({ entity: 'E1' });
    assert.deepStrictEqual(f.figures, { agreed: 1, said_no: 1 }); assert.ok(/1 party agreed to offers/.test(f.lines[0].text)); assert.ok(/said no/.test(f.lines[1].text));
    T.have.party_contact_pref = false;
    const n = await H.BUILD.marketing({ entity: 'E1' }); T.have.party_contact_pref = true;
    assert.deepStrictEqual(n.lines, []); assert.ok(/b306/.test(n.unavailable));
  });

  console.log('\n-- T3-P3-CONSENT · the law\u2019s words, the shopper\u2019s own answer --');
  await ita('lawOf: IN · AU · AE each name their law and the request kinds that law gives; an unstated or unknown country says so and is NEVER India', () => {
    assert.ok(/Digital Personal Data Protection/.test(PV.lawOf('IN').law) && PV.lawOf('in').kinds.indexOf('nominate') >= 0);
    assert.ok(/Privacy Act 1988/.test(PV.lawOf('AU').law) && PV.lawOf('AU').kinds.indexOf('erase') < 0, 'the APPs give access and correction, not erasure');
    assert.ok(/45\/2021/.test(PV.lawOf('AE').law) && PV.lawOf('AE').kinds.indexOf('erase') >= 0);
    for (const c of [null, 'NZ']) { const L = PV.lawOf(c); assert.strictEqual(L.known, false); assert.strictEqual(L.law, null); assert.ok(L.note && !/India|DPDP/.test(JSON.stringify(L)), JSON.stringify(L)); assert.deepStrictEqual(L.kinds, PV.KINDS); }
    assert.strictEqual(PV.lawOf('NZ').due_days, 30);
    assert.ok(Object.values(PV.LAW).every((L) => [L.consent, L.rights].every((x) => x.split(/\s+/).length <= 20)), 'every sentence within the 20-word budget');
  });
  await ita('GET contact-prefs carries the SHOP\u2019s country\u2019s law (AU shop: Privacy Act), read in the same transaction', async () => {
    D.shopCountry = 'AU';
    const r = await t.get(prefs()); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.ok(/Privacy Act/.test(r.body.law.law)); assert.strictEqual(r.body.law.country, 'AU');
    D.shopCountry = null;
  });
  /* the shopper's surface: routes/privacy.js on a storefront token (middleware/customer-auth — a real JWT, so an owner token is refused) */
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-privacy-me';
  const jwt = require('jsonwebtoken'), express = require('express'), http = require('http');
  const papp = express(); papp.use(express.json()); papp.use('/api/privacy', require('../routes/privacy')); const psrv = papp.listen(0);
  const pcall = (method, p, body, token) => new Promise((ok, no) => {
    const d = body == null ? null : JSON.stringify(body);
    const rq = http.request({ port: psrv.address().port, method, path: p, headers: Object.assign({ authorization: 'Bearer ' + token }, d ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } : {}) },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode, body: b ? JSON.parse(b) : {} })); });
    rq.on('error', no); rq.end(d || undefined);
  });
  const shopperTok = jwt.sign({ identity_id: P(2), identity_type: 'customer', parent_entity_id: 'E1', display_name: 'Chola' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const ownerTok = jwt.sign({ identity_id: 'E1', identity_type: 'entity' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  await ita('an owner\u2019s token is refused on /api/privacy/me (401) \u2014 the shopper\u2019s surface is the shopper\u2019s only', async () => {
    assert.strictEqual((await pcall('GET', '/api/privacy/me', null, ownerTok)).status, 401);
    assert.strictEqual((await pcall('POST', '/api/privacy/me/consent', { channel: 'whatsapp', purpose: 'marketing', allowed: true }, ownerTok)).status, 401);
  });
  await ita('GET /me: what the shop holds (a null is said, never dropped), the shop\u2019s law, THIS shopper\u2019s consent only, may_consent / may_request', async () => {
    const r = await pcall('GET', '/api/privacy/me', null, shopperTok); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.shop.name, 'Mayur Bhavan'); assert.strictEqual(r.body.law.country, 'IN'); assert.ok(/DPDP/.test(r.body.law.short));
    assert.ok(r.body.held.some((h) => h.key === 'phone' && /98000/.test(h.value))); assert.ok(r.body.held.every((h) => 'value' in h));
    assert.strictEqual(r.body.consent.migrated, true); assert.ok(r.body.consent.history.every((h) => h.channel && h.purpose));
    assert.strictEqual(r.body.consent.may.whatsapp.marketing.may, false, 'the withdrawal above stands'); assert.ok(r.body.consent.may.whatsapp.marketing.code);
    assert.strictEqual(r.body.may_consent.may, true); assert.strictEqual(r.body.may_request.may, true);
    assert.ok(!JSON.stringify(r.body).match(/P\(3\)|10000000-0000-4000-8000-000000000003/), 'no other party\u2019s rows');
  });
  await ita('POST /me/consent: a yes to offers on e-mail is ONE new b306 row noted_by the SHOPPER (how given: by them); the CRM\u2019s GET sees it; the gate now lets an e-mail offer through', async () => {
    const n = T.prefs.length;
    const r = await pcall('POST', '/api/privacy/me/consent', { channel: 'email', purpose: 'marketing', allowed: true }, shopperTok);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(T.prefs.length, n + 1); assert.strictEqual(r.body.pref.noted_by, P(2)); assert.strictEqual(r.body.may.email.marketing.may, true);
    const g = (await t.get(prefs())).body; assert.strictEqual(g.history[0].noted_by, P(2)); assert.strictEqual(g.may.email.marketing.code, 'CONSENT');
    const v = await PV.gate({ query: async (q, a) => (await D.extra(String(q).replace(/\s+/g, ' ').trim(), a)) || { rows: [] } }, 'E1', { party_id: P(2) }, 'email', 'marketing'); assert.strictEqual(v.may, true);
  });
  await ita('POST /me/consent refused in words: legitimate use can never be the shopper\u2019s basis for offers; an unknown channel', async () => {
    const n = T.prefs.length;
    for (const b of [{ channel: 'fax', purpose: 'service', allowed: true }, { channel: 'email', purpose: 'marketing' }]) { const r = await pcall('POST', '/api/privacy/me/consent', b, shopperTok); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.ok(r.body.message); }
    assert.strictEqual(T.prefs.length, n);
  });
  await ita('POST /me/requests: "a copy" and "erase" are RECORDED on the shop\u2019s register (party_id = the shopper, the shop\u2019s clock) \u2014 nothing is erased; GET /me lists only theirs; the owner sees them on /privacy-requests', async () => {
    const n = T.reqs.length;
    for (const kind of ['access', 'erase']) { const r = await pcall('POST', '/api/privacy/me/requests', { kind }, shopperTok); assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.request.party_id, P(2)); assert.strictEqual(r.body.request.country, 'IN'); assert.strictEqual(r.body.request.answered_at, null); }
    assert.strictEqual(T.reqs.length, n + 2); assert.ok(!D.queries.some((q) => /is_erased|DELETE FROM identities|erased_at/.test(q)), 'no erase statement from the page\u2019s route');
    const me = (await pcall('GET', '/api/privacy/me', null, shopperTok)).body; assert.ok(me.requests.requests.length >= 2 && me.requests.requests.every((x) => x.party_id === P(2)));
    const owner = (await t.get('/privacy-requests?open=1')).body; assert.ok(owner.requests.some((x) => x.party_id === P(2) && x.kind === 'erase'));
    const bad = await pcall('POST', '/api/privacy/me/requests', { kind: 'forget-me' }, shopperTok); assert.strictEqual(bad.status, 400);
  });
  await ita('before b306 / b307: GET /me still answers 200 \u2014 consent and requests say NOT MIGRATED in a code the page greys on; a POST answers 503 in words', async () => {
    T.have.party_contact_pref = false; T.have.privacy_request = false; PV.forget();
    const r = await pcall('GET', '/api/privacy/me', null, shopperTok); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.consent.migrated, false); assert.strictEqual(r.body.may_consent.code, 'PRIVACY_NOT_MIGRATED'); assert.ok(r.body.may_consent.why); assert.strictEqual(r.body.may_request.may, false);
    const w = await pcall('POST', '/api/privacy/me/consent', { channel: 'email', purpose: 'marketing', allowed: false }, shopperTok); assert.strictEqual(w.status, 503); assert.ok(/b306/.test(w.body.message));
    T.have.party_contact_pref = true; T.have.privacy_request = true; PV.forget();
  });
  psrv.close();

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
