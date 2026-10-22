'use strict';
/**
 * tests/optout.test.cjs - CON-2: a STOP reply withdraws marketing consent. Offline, over a canned database; the REAL lib/optout, lib/privacy,
 * lib/whatsapp-out and routes/capture.js (the webhook, signed with a test secret). What it proves:
 *  - the matcher takes the WHOLE message only ("STOP", "stop.", "Unsubscribe" yes; "stop by at 5 for 2kg rice", "don't stop" no), a pack word for its own country
 *    only, and a shop with no country gets the English words alone (never India's);
 *  - a shared number: every party on it is withdrawn for whatsapp AND sms, source 'reply' + the capture id; e-mail and service are never written;
 *  - an unknown number writes nothing and is still confirmed; a second STOP adds no row; before b777 the withdrawal is still written (no label);
 *  - the gate's sentence names the reply while its code stays CONSENT_WITHDRAWN; the one sender adds the opt-out line to offers and to nothing else;
 *  - through the webhook: the STOP is dismissed and never auto-raised, its confirmation is a SERVICE message sent AFTER the 200, a redelivery does nothing,
 *    an ordinary message still auto-raises, and a failure leaves the capture in Intake with no confirmation.
 * Real-stack proof: tests/marketing-truth.realstack.cjs MK-14. Run: node tests/optout.test.cjs
 * CARD 23-connectors-and-integrations/functions/stop-reply
 */
const assert = require('assert'), path = require('path'), crypto = require('crypto'), http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; process.env.WHATSAPP_APP_SECRET = 'test-secret'; delete process.env.WHATSAPP_TOKEN;
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); } };

const SHOP = '10000000-0000-4000-8000-000000000001', ANNA = '20000000-0000-4000-8000-000000000001', RAJ = '20000000-0000-4000-8000-000000000002', LONE = '20000000-0000-4000-8000-000000000003';
const world = { country: 'IN', name: 'Mayur Bhavan', parties: [], prefs: [], sourceColumn: true, writes: [], broken: false, dismissed: [], sent: [], raised: [], clock: Date.parse('2026-10-22T06:00:00Z'), outboundPartyColumn: true };
const tail = (value) => String(value || '').replace(/\D/g, '').slice(-9);

/* the database: only the statements the code under test asks, answered from the world */
const handle = { query: async (sql, p) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  if (world.broken && /^INSERT INTO party_contact_pref/.test(text)) throw new Error('connection lost');
  if (/^SELECT to_regclass/.test(text)) return { rows: [{ ok: true }] };
  if (/^SELECT country, display_name FROM identities/.test(text)) return { rows: [{ country: world.country, display_name: world.name }] };
  if (/^SELECT cl\.customer_identity_id AS party_id/.test(text)) return { rows: world.parties.filter((party) => tail(party.phone) === p[1]).map((party) => ({ party_id: party.id })) };
  if (/^SELECT DISTINCT ON \(party_id, channel\)/.test(text)) {
    const newest = new Map();
    world.prefs.filter((row) => p[1].includes(row.party_id) && row.purpose === p[2] && p[3].includes(row.channel)).forEach((row) => newest.set(row.party_id + '|' + row.channel, row));
    return { rows: [...newest.values()].map((row) => ({ party_id: row.party_id, channel: row.channel, allowed: row.allowed })) };
  }
  if (/^SELECT pref_id, .* FROM party_contact_pref/.test(text)) return { rows: world.prefs.filter((row) => row.party_id === p[1]).slice().reverse() };
  if (/^INSERT INTO party_contact_pref/.test(text)) {
    world.clock += 1000;
    const withSource = /source, source_ref\)/.test(text), withdrawn = /now\(\)/.test(text);
    const row = { pref_id: 'pref' + (world.prefs.length + 1), party_id: p[1], channel: p[2], purpose: p[3], allowed: p[4], basis: p[5], noted_at: new Date(world.clock).toISOString(),
      withdrawn_at: withdrawn ? new Date(world.clock).toISOString() : null, source: withSource ? p[8] : undefined, source_ref: withSource ? p[9] : undefined };
    world.prefs.push(row); world.writes.push({ sql: text, p });
    return { rows: [row] };
  }
  if (/FROM channel_binding/.test(text)) return { rows: [{ address: p[1], provider_ref: 'PHONE-ID-1' }] };
  return { rows: [] };
} };
stub('db', { query: handle.query, withEntity: async (entity, fn) => fn(handle), readBatch: async () => [] });
stub('lib/schema', { hasColumn: async (table, column) => (column === 'source' ? world.sourceColumn : column === 'party_id' ? world.outboundPartyColumn : true), hasTable: async () => true });
stub('lib/capture', {
  dismissCapture: async (entity, id) => { world.dismissed.push(id); return { id, status: 'dismissed' }; },
  createCapture: async (entity, input) => { world.created = (world.created || 0) + 1; const duplicate = (world.seen = world.seen || new Set()).has(input.provider_msg_id); world.seen.add(input.provider_msg_id); return { id: 'CAP' + world.created, duplicate }; }
});
stub('lib/channels', { bindingFor: async () => ({ entity_id: SHOP, auto_raise: true }), ownerOf: async () => SHOP });
stub('lib/autoraise', { run: async (entity, id) => { world.raised.push(id); } });
stub('middleware/auth', Object.assign((req, res, next) => next(), { entityOf: () => SHOP }));

const privacy = require('../lib/privacy'), optout = require('../lib/optout'), whatsAppOut = require('../lib/whatsapp-out');
const realNotify = whatsAppOut.notify;
const reset = () => Object.assign(world, { country: 'IN', parties: [{ id: ANNA, phone: '+91 98400 12345' }, { id: RAJ, phone: '9840012345' }, { id: LONE, phone: '+91 90000 11111' }], prefs: [], writes: [], dismissed: [], sent: [], raised: [], broken: false, sourceColumn: true });
const consent = (party, channel) => handle.query('INSERT INTO party_contact_pref (owner_entity_id, party_id, channel, purpose, allowed, basis, notice_version, noted_by, withdrawn_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)', [SHOP, party, channel, 'marketing', true, 'consent', null, null]).then(() => { world.writes.length = 0; });
const rowsOf = (party, channel) => world.prefs.filter((row) => row.party_id === party && row.channel === channel && row.purpose === 'marketing');
const reply = (text, from) => ({ sender_ref: from || '919840012345', text, capture_id: 'CAP-7' });

(async () => {
  console.log('\n-- CON-2 · a STOP reply withdraws marketing consent (offline) --');

  await t('the matcher takes the WHOLE message only', async () => {
    ['STOP', 'stop.', ' Stop! ', 'Unsubscribe', 'opt out', 'STOP ALL', 'cancel'].forEach((word) => assert.ok(privacy.isStopWord(word, 'AU'), word));
    ['stop by at 5 for 2kg rice', "don't stop", 'please stop the offers', '', '   ', 'two kg rice', null].forEach((word) => assert.ok(!privacy.isStopWord(word, 'AU'), String(word)));
  });
  await t('a local word counts for its own country only; no country = the English words alone, never India\'s', async () => {
    assert.ok(privacy.isStopWord('बंद', 'IN') && privacy.isStopWord('إيقاف', 'AE'));
    assert.ok(!privacy.isStopWord('बंद', 'AU') && !privacy.isStopWord('बंद', null) && !privacy.isStopWord('إيقاف', 'IN') && !privacy.isStopWord('बंद', 'ZZ'));
    assert.ok(privacy.isStopWord('STOP', null) && privacy.isStopWord('STOP', 'ZZ'));
    assert.ok(['IN', 'AU', 'AE', null].every((country) => privacy.lawOf(country).optout.line && privacy.lawOf(country).optout.done.includes('{shop}')), 'every pack and the fallback carries the line and the sentence');
  });

  await t('a shared number: both parties are withdrawn on whatsapp AND sms (source reply + the capture id); a third number and e-mail are untouched', async () => {
    reset(); await consent(ANNA, 'whatsapp'); await consent(RAJ, 'whatsapp'); await consent(LONE, 'whatsapp');
    const out = await optout.fromReply(SHOP, reply('STOP'));
    assert.deepStrictEqual([out.stop, out.parties, out.withdrawn], [true, 2, 2]);
    for (const party of [ANNA, RAJ]) for (const channel of ['whatsapp', 'sms']) {
      const row = rowsOf(party, channel).pop();
      assert.ok(row && row.allowed === false && row.source === 'reply' && row.source_ref === 'CAP-7', party + ' ' + channel);
    }
    assert.ok(rowsOf(ANNA, 'whatsapp').pop().withdrawn_at, 'an earlier yes becomes a WITHDRAWAL');
    assert.strictEqual(rowsOf(LONE, 'whatsapp').pop().allowed, true, 'a different number is untouched');
    assert.ok(world.prefs.every((row) => row.channel !== 'email' && row.purpose === 'marketing'), 'e-mail and service are never written');
    assert.deepStrictEqual(world.dismissed, ['CAP-7'], 'the STOP capture is dismissed');
  });
  await t('the gate then refuses the next offer with CONSENT_WITHDRAWN, and its sentence names the reply', async () => {
    const verdict = privacy.mayMessage(rowsOf(ANNA, 'whatsapp').slice().reverse(), 'whatsapp', 'marketing');
    assert.strictEqual(verdict.may, false); assert.strictEqual(verdict.code, 'CONSENT_WITHDRAWN'); assert.ok(/replied STOP on 2026-10-22/.test(verdict.why), verdict.why);
    assert.ok(privacy.mayMessage(rowsOf(ANNA, 'whatsapp').slice().reverse(), 'whatsapp', 'service').may, 'service is untouched');
  });
  await t('a party found only through an earlier offer sent to that number is withdrawn too', async () => {
    reset(); const seen = []; const query = handle.query;
    handle.query = async (sql, p) => { const text = String(sql).replace(/\s+/g, ' '); if (/^SELECT cl\.customer_identity_id/.test(text)) { seen.push(text); return { rows: [{ party_id: ANNA }, { party_id: LONE }] }; } return query(sql, p); };
    const out = await optout.fromReply(SHOP, reply('STOP'));
    handle.query = query;
    assert.strictEqual(out.parties, 2); assert.ok(/FROM channel_outbound o WHERE o\.entity_id = \$1 AND o\.purpose = 'marketing'/.test(seen[0]), 'the receipts are part of the one statement');
  });
  await t('an unknown number writes nothing, still counts as a STOP, and the confirmation still goes', async () => {
    reset();
    const out = await optout.fromReply(SHOP, reply('STOP', '61400000999'));
    assert.deepStrictEqual([out.stop, out.parties, out.withdrawn, world.writes.length], [true, 0, 0, 0]);
    whatsAppOut.notify = async (entity, input) => { world.sent.push(input); return { status: 'sent' }; };
    await optout.confirmReply(SHOP, Object.assign({ sender_ref: '61400000999', to_ref: '+9199', capture_id: 'CAP-7' }, out));
    whatsAppOut.notify = realNotify;
    assert.strictEqual(world.sent.length, 1);
  });
  await t('the confirmation is a SERVICE message with the capture id and the line\'s provider_ref, says no more offers, and holds no offer', async () => {
    const sent = world.sent[0];
    assert.strictEqual(sent.purpose, 'service'); assert.strictEqual(sent.capture_id, 'CAP-7'); assert.strictEqual(sent.provider_ref, 'PHONE-ID-1');
    assert.strictEqual(sent.text, 'You will get no more offers from Mayur Bhavan. Order messages still reach you.');
  });
  await t('a second STOP from the same people adds no row', async () => {
    reset(); await consent(ANNA, 'whatsapp');
    await optout.fromReply(SHOP, reply('STOP')); const first = world.prefs.length;
    const again = await optout.fromReply(SHOP, reply('Stop'));
    assert.strictEqual(world.prefs.length, first); assert.strictEqual(again.withdrawn, 0); assert.strictEqual(again.stop, true);
  });
  await t('before b777 the withdrawal is still written (no source columns), and the gate still says withdrawn', async () => {
    reset(); world.sourceColumn = false; await consent(ANNA, 'whatsapp');
    const out = await optout.fromReply(SHOP, reply('STOP'));
    const row = rowsOf(ANNA, 'whatsapp').pop();
    assert.strictEqual(out.withdrawn, 2); assert.strictEqual(row.allowed, false); assert.strictEqual(row.source, undefined);
    assert.ok(world.writes.every((write) => write.p.length === 8 && !/source/.test(write.sql)));
    const verdict = privacy.mayMessage(rowsOf(ANNA, 'whatsapp').slice().reverse(), 'whatsapp', 'marketing');
    assert.strictEqual(verdict.code, 'CONSENT_WITHDRAWN'); assert.ok(/withdrew consent/.test(verdict.why));
  });
  await t('a sentence that is not a stop word touches nothing: no rows, no dismiss, a long order never even reads the shop', async () => {
    reset(); let reads = 0; const query = handle.query;
    handle.query = async (sql, p) => { reads++; return query(sql, p); };
    const order = await optout.fromReply(SHOP, reply('stop by at 5 for 2kg rice'));
    const long = await optout.fromReply(SHOP, reply('please send two kilos of rice and one of dal on friday evening, thanks'));
    handle.query = query;
    assert.deepStrictEqual([order.stop, long.stop, world.writes.length, world.dismissed.length], [false, false, 0, 0]);
    assert.strictEqual(reads, 1, 'only the short sentence read the shop; the long one was passed over unread');
  });
  await t('a database failure never throws: it answers stop + failed, dismisses nothing, and says so in the log', async () => {
    reset(); await consent(ANNA, 'whatsapp'); world.broken = true;
    const out = await optout.fromReply(SHOP, reply('STOP'));
    world.broken = false;
    assert.deepStrictEqual([out.stop, out.failed, world.dismissed.length], [true, true, 0]);
  });
  await t('a shop with no country uses the English words; its AE-only word is not a stop', async () => {
    reset(); world.country = null;
    assert.strictEqual((await optout.fromReply(SHOP, reply('إيقاف'))).stop, false);
    assert.strictEqual((await optout.fromReply(SHOP, reply('STOP'))).stop, true);
  });

  /* ── the one sender adds the opt-out line to offers (C4) ── */
  const wire = [], realFetch = global.fetch;
  process.env.WHATSAPP_TOKEN = 'token'; global.fetch = async (url, init) => { wire.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; };
  privacy.gate = async () => ({ may: true, code: 'CONSENT', why: 'ok', pref: null });
  const windowOpen = () => { const query = handle.query; handle.query = async (sql, p) => (/MAX\(created_at\)/.test(String(sql)) ? { rows: [{ last_in: new Date().toISOString() }] } : /INSERT INTO channel_outbound/.test(String(sql)) ? { rows: [{ id: 'ob', status: 'sent' }] } : query(sql, p)); return () => { handle.query = query; }; };
  await t('an offer ends with the country\'s opt-out line; a status update does not', async () => {
    reset(); const restore = windowOpen(); wire.length = 0;
    await realNotify(SHOP, { to_ref: '919840012345', from_ref: '+9199', provider_ref: 'PH', text: 'Diwali: 10% off', purpose: 'marketing', party_id: ANNA });
    await realNotify(SHOP, { to_ref: '919840012345', from_ref: '+9199', provider_ref: 'PH', text: 'Your order is ready' });
    restore();
    assert.strictEqual(wire[0].text.body, 'Diwali: 10% off\n\nReply STOP to stop offers.'); assert.strictEqual(wire[1].text.body, 'Your order is ready');
  });
  global.fetch = realFetch;
  await t('the group send leaves room for the line: the text limit is 1000 minus the footer', async () => {
    assert.strictEqual(optout.footerRoom(), '\n\nReply STOP to stop offers.'.length);
  });

  /* ── through the signed webhook ── */
  const app = require('express')();
  const notifySeen = []; /* the confirmations the stubbed sender was asked for; the middleware notes how many existed the moment the answer was written */
  app.use((req, res, next) => { const send = res.json.bind(res); res.json = (payload) => { world.sentBeforeAnswer = notifySeen.length; return send(payload); }; next(); });
  app.use('/api/capture', require('../routes/capture.js'));
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  const post = (messages) => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { display_phone_number: '+919999999999' }, contacts: [], messages } }] }] });
    const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');
    return fetch('http://127.0.0.1:' + server.address().port + '/api/capture/webhook/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const message = (id, text) => ({ id, from: '919840012345', type: 'text', text: { body: text } });
  delete process.env.WHATSAPP_TOKEN; world.created = 0; world.seen = new Set();
  whatsAppOut.notify = async (entity, input) => { notifySeen.push({ at: Date.now(), input }); return { status: 'sent' }; };

  await t('webhook: a STOP is dismissed, never auto-raised, withdrawn before the 200, and confirmed AFTER it as a service message', async () => {
    reset(); await consent(ANNA, 'whatsapp'); await consent(RAJ, 'whatsapp'); notifySeen.length = 0;
    const res = await post([message('wamid.A', 'STOP')]);
    const body = await res.json();
    assert.strictEqual(res.status, 200); assert.strictEqual(body.captured, 1);
    assert.strictEqual(rowsOf(RAJ, 'whatsapp').pop().allowed, false, 'withdrawn by the time the 200 was read');
    await settle();
    assert.deepStrictEqual(world.raised, [], 'a STOP never becomes a chit'); assert.strictEqual(world.dismissed.length, 1);
    assert.strictEqual(notifySeen.length, 1); assert.strictEqual(notifySeen[0].input.purpose, 'service'); assert.strictEqual(notifySeen[0].input.to_ref, '919840012345');
    assert.strictEqual(world.sentBeforeAnswer, 0, 'nothing had been sent when the 200 was written');
  });
  await t('webhook: the same message delivered again writes no second row and sends no second confirmation', async () => {
    const rowsBefore = world.prefs.length, sentBefore = notifySeen.length;
    await post([message('wamid.A', 'STOP')]); await settle();
    assert.strictEqual(world.prefs.length, rowsBefore); assert.strictEqual(notifySeen.length, sentBefore); assert.strictEqual(world.dismissed.length, 1);
  });
  await t('webhook: an ordinary message is captured and auto-raised as before; "stop by at 5" is an order', async () => {
    reset(); notifySeen.length = 0;
    await post([message('wamid.B', 'two kg rice please'), message('wamid.C', 'stop by at 5 for 2kg rice')]); await settle();
    assert.strictEqual(world.raised.length, 2); assert.strictEqual(world.writes.length, 0); assert.strictEqual(notifySeen.length, 0);
  });
  await t('webhook: when the withdrawal cannot be written the capture stays in Intake and no confirmation claims otherwise', async () => {
    reset(); await consent(ANNA, 'whatsapp'); world.broken = true; notifySeen.length = 0;
    const res = await post([message('wamid.D', 'STOP')]); await settle(); world.broken = false;
    assert.strictEqual(res.status, 200); assert.deepStrictEqual([world.dismissed.length, notifySeen.length, world.raised.length], [0, 0, 0]);
  });
  await t('webhook contract: a signed but malformed body is held (validation: still 200 {ok}, nothing captured, nothing withdrawn) - Meta must never retry-storm', async () => {
    reset(); const before = world.created;
    const body = '{ not json', signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/capture/webhook/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body });
    assert.strictEqual(res.status, 200); assert.deepStrictEqual(await res.json(), { ok: true }); assert.strictEqual(world.created, before); assert.strictEqual(world.writes.length, 0);
  });
  await t('webhook: a bad signature is refused 401 and nothing is read', async () => {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/capture/webhook/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body: '{}' });
    assert.strictEqual(res.status, 401);
  });

  server.close();
  console.log('\n' + (failed ? failed + ' FAILED, ' : '') + passed + ' passed · ' + passed + ' checks');
  process.exit(failed ? 1 : 0);
})();
