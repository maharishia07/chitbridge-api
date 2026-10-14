/**
 * CO1-GATE (MKT-SRV1) — EVERY OUTBOUND SENDER ASKS lib/privacy.gate BEFORE IT SENDS, and a refusal carries its CODE and its sentence:
 *   · lib/whatsapp-out.notify     by the number it holds (digits against the party's phone / sign-in contact) — the refusal is LOGGED, never thrown
 *   · lib/notify.sendEmail        by the address it holds, for the shop it goes out for (no shop → NO_SHOP, refused)
 *   · lib/crm-calls.outcome       by party: a call desk outcome logs a call that went OUT by phone — 403 { code, why }, nothing written
 *   · POST /parties/:id/interactions — tests/privacy.test.cjs (G2)
 *   · the OTP senders are NOT gated: a sign-in code is the person's own request at that moment — held here so nobody "fixes" it
 *   · before b306 (the table is a draft) a service message goes through on legitimate use and an offer is NO_CONSENT — never a 500
 *   · a consent read that FAILS is CONSENT_UNKNOWN: refused (absent evidence is never "probably fine"), never sent
 * Offline: tests/support/crm-stub.cjs (data.prefs = the b306 table in memory). Run: node tests/consent-gate.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola', phone: '+91 98400 12345', email: 'Chola@Example.com' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' }),
          Object.assign(row({ party_id: P(1), display_name: 'Lead Lata', otp_contact: '+919840011111' }), { customer_type: 'entity', added_via: 'lead', txn_count: 0, segment: 'new' })];
D.sup = [];
let n = 0;
const pref = (party_id, channel, purpose, allowed, extra) => Object.assign({ pref_id: 'pf' + (++n), owner: 'E1', party_id, channel, purpose, allowed, basis: purpose === 'marketing' ? 'consent' : 'legitimate_use',
  notice_version: null, noted_by: 'E1', withdrawn_at: null, noted_at: new Date(Date.parse('2026-10-01T00:00:00Z') + n * 1000).toISOString() }, extra);
delete process.env.WHATSAPP_TOKEN; delete process.env.DEV_OTP; delete process.env.OTP_EMAIL_ENABLED; delete process.env.RESEND_API_KEY; process.env.NODE_ENV = 'test';
const W = require('../lib/whatsapp-out'), N = require('../lib/notify'), PV = require('../lib/privacy');
const CHOLA = '+919840012345';
const wa = (to, purpose) => W.notify('E1', { to_ref: to, from_ref: '+911234', provider_ref: 'pid', text: 'hello', purpose });
const prefQueries = () => D.queries.filter((q) => /party_contact_pref/.test(q)).length;

(async () => {
  console.log('\n-- before b306: the table is a draft --');
  await ita('whatsapp: a service message rides on legitimate use (the gate passes; the next refusal is the missing token); an offer is NO_CONSENT, refused and logged', async () => {
    D.prefs = null; PV.forget();
    const s = await wa(CHOLA); assert.strictEqual(s.status, 'refused'); assert.ok(/WHATSAPP_TOKEN/.test(s.reason), s.reason); assert.ok(!s.code, 'no consent code: the gate let it through');
    const m = await wa(CHOLA, 'marketing'); assert.strictEqual(m.status, 'refused'); assert.strictEqual(m.code, 'NO_CONSENT'); assert.ok(/Ask them first/.test(m.why)); assert.ok(/^NO_CONSENT — /.test(m.reason), 'the log line starts with the code');
  });

  console.log('\n-- whatsapp-out.notify asks by the number --');
  await ita('she asked not to be messaged on WhatsApp → refused OPTED_OUT with the sentence, logged, nothing sent; another number is unaffected; a yes to offers lets an offer through', async () => {
    D.prefs = [pref(P(2), 'whatsapp', 'service', false), pref(P(2), 'whatsapp', 'marketing', true)]; PV.forget();
    const r = await wa('91 98400 12345'); assert.strictEqual(r.status, 'refused'); assert.strictEqual(r.code, 'OPTED_OUT'); assert.ok(/not to be messaged on whatsapp/.test(r.why), r.why);
    const other = await wa('+919840099999'); assert.ok(!other.code && /WHATSAPP_TOKEN/.test(other.reason), 'a number with no party behind it: no consent to refuse, the token refusal follows');
    const offer = await wa(CHOLA, 'marketing'); assert.ok(!offer.code && /WHATSAPP_TOKEN/.test(offer.reason), 'her yes to offers on WhatsApp stands: ' + JSON.stringify(offer));
  });
  await ita('the sign-in contact counts as the number too (a lead with only otp_contact); the newest row wins (a later yes lifts an earlier no)', async () => {
    D.prefs.push(pref(P(1), 'whatsapp', 'service', false)); PV.forget();
    const r = await wa('+91 98400 11111'); assert.strictEqual(r.code, 'OPTED_OUT');
    D.prefs.push(pref(P(1), 'whatsapp', 'service', true));
    const again = await wa('+91 98400 11111'); assert.ok(!again.code, JSON.stringify(again));
  });
  await ita('a consent read that fails → CONSENT_UNKNOWN, refused and logged — never sent on a guess', async () => {
    D.pre = async (sql) => { if (/DISTINCT ON \(p\.party_id/.test(sql)) throw new Error('connection reset'); return null; };
    const r = await wa(CHOLA); assert.strictEqual(r.status, 'refused'); assert.strictEqual(r.code, 'CONSENT_UNKNOWN'); assert.ok(/Try again/.test(r.why));
    D.pre = null;
  });

  console.log('\n-- notify.sendEmail asks by the address, for the shop --');
  await ita('no shop given → NO_SHOP, refused (no register to ask); she asked not to be e-mailed → OPTED_OUT; another address goes on to the (dormant) send; an offer with no consent → NO_CONSENT', async () => {
    const none = await N.sendEmail('chola@example.com', 'Hi', '<p>x</p>'); assert.deepStrictEqual([none.delivered, none.refused, none.code], [false, true, 'NO_SHOP']);
    D.prefs.push(pref(P(2), 'email', 'service', false)); PV.forget();
    const no = await N.sendEmail('CHOLA@example.com', 'Hi', '<p>x</p>', { entity_id: 'E1' }); assert.deepStrictEqual([no.delivered, no.refused, no.code], [false, true, 'OPTED_OUT']); assert.ok(no.why);
    const ok = await N.sendEmail('someone@else.com', 'Hi', '<p>x</p>', { entity_id: 'E1' }); assert.strictEqual(ok.refused, undefined); assert.strictEqual(ok.dev, true, 'dormant send reached: ' + JSON.stringify(ok));
    const offer = await N.sendEmail('someone@else.com', 'Offer', '<p>x</p>', { entity_id: 'E1', purpose: 'marketing' }); assert.strictEqual(offer.code, 'NO_CONSENT');
  });
  await ita('OTP is NOT gated: a sign-in code goes to a number that said no to messages, and asks the consent table nothing', async () => {
    D.prefs.push(pref(P(2), 'sms', 'service', false)); PV.forget();
    const before = prefQueries();
    const r = await N.sendOtpSms(CHOLA, '123456'); assert.strictEqual(r.dev, true); assert.strictEqual(r.refused, undefined);
    const e = await N.sendOtpEmail('chola@example.com', 'Chola', '123456'); assert.strictEqual(e.dev, true); assert.strictEqual(e.refused, undefined);
    assert.strictEqual(prefQueries(), before, 'no consent read for a sign-in code');
  });

  console.log('\n-- the call desk: an outcome logs a call that went out by phone --');
  await ita('a lead who asked not to be phoned → 403 OPTED_OUT with the sentence; nothing logged, no follow-up made', async () => {
    D.prefs.push(pref(P(1), 'phone', 'service', false)); PV.forget();
    const i = D.interactions.length, f = D.followups.length;
    const r = await t.post('/parties/' + P(1) + '/outcome', { outcome: 'no_answer' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'OPTED_OUT'); assert.ok(/phone/.test(r.body.why), r.body.why);
    assert.strictEqual(D.interactions.length, i); assert.strictEqual(D.followups.length, f);
  });
  await ita('every refusal code a sender can answer is in lib/privacy.CODES — one vocabulary for the log, the 403 and the greyed button', () => {
    ['OPTED_OUT', 'NO_CONSENT', 'CONSENT_UNKNOWN', 'CONSENT_WITHDRAWN', 'CONSENT_REFUSED'].forEach((c) => assert.ok(PV.CODES[c], c));
  });
  t.close(); console.log('  ' + pass + ' checks'); if (process.exitCode) console.log('FAILED');
})();
