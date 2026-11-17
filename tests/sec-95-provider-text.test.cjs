'use strict';
/**
 * tests/sec-95-provider-text.test.cjs — SEC-95: a WhatsApp send the provider refuses (or that throws) leaves OUR sentence in the receipt and in
 * the segment send's sent[].reason, never the provider's error text; the provider's text reaches the server log only.
 * Fresh copy of lib/whatsapp-out over a fake database handle and a stand-in fetch; a positive control proves a good send still reads 'sent'.
 * Run: node tests/sec-95-provider-text.test.cjs
 */
const assert = require('assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-sec-95';
const db = require('../db'), privacy = require('../lib/privacy');
const modPath = require.resolve('../lib/whatsapp-out');
const SHOP = '11111111-1111-4111-8111-111111111111';
const SECRET_TEXT = 'Account 4471-ACME-SECRET is restricted: (#131047) Re-engagement message';
const inserts = [], logged = [];
const handle = { query: async (sql, vals) => {
  if (/INSERT INTO channel_outbound/.test(sql)) { inserts.push(vals); return { rows: [{ status: vals[6], reason: vals[7] }] }; }
  if (/MAX\(created_at\)/.test(sql)) return { rows: [{ last_in: new Date() }] }; /* the customer wrote just now: the free-text window is open */
  return { rows: [] };
} };
const saved = { withEntity: db.withEntity, gate: privacy.gate, token: process.env.WHATSAPP_TOKEN, fetch: global.fetch, err: console.error, out: console.log, warn: console.warn };
db.withEntity = async (_e, fn) => fn(handle);
privacy.gate = async () => ({ may: true, code: 'OK' });
process.env.WHATSAPP_TOKEN = 'tok';
delete require.cache[modPath];
const wa = require('../lib/whatsapp-out');
const send = () => wa.notify(SHOP, { to_ref: '+919876543210', from_ref: '+911234567890', provider_ref: 'pn1', text: 'hello', purpose: 'service' });
const tell = (l) => (...a) => { logged.push(a.join(' ')); void l; };
let n = 0;
const it = async (what, fn) => { try { await fn(); n++; saved.out('  ok  ' + what); } catch (e) { saved.out('  XX  ' + what + '\n      ' + e.message); process.exitCode = 1; } };
(async () => {
  console.log = tell('out'); console.error = tell('err'); console.warn = tell('warn');
  try {
    await it('provider 4xx: the receipt and the answer carry our sentence, not the provider text', async () => {
      global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: SECRET_TEXT } }) });
      const before = inserts.length, r = await send();
      assert.strictEqual(r.status, 'failed');
      assert.ok(!/4471|ACME|131047|Re-engagement/.test(JSON.stringify(r)), 'answer leaks provider text: ' + JSON.stringify(r));
      assert.ok(!/4471|ACME|131047/.test(String(inserts[before][7])), 'receipt leaks provider text');
      assert.strictEqual(r.reason, 'The message could not be delivered by WhatsApp. Try again later.');
    });
    await it('the provider text is logged on the server, once', async () => {
      assert.ok(logged.some((l) => /4471-ACME-SECRET/.test(l)), 'provider text was not logged server-side');
    });
    await it('a thrown fetch (network text) is mapped the same way', async () => {
      global.fetch = async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:443 graph-internal'); };
      const r = await send();
      assert.strictEqual(r.status, 'failed');
      assert.ok(!/ECONNREFUSED|10\.1\.2\.3/.test(r.reason), r.reason);
    });
    await it('positive control: a good send still reads sent', async () => {
      global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
      const r = await send();
      assert.strictEqual(r.status, 'sent');
    });
  } finally {
    console.log = saved.out; console.error = saved.err; console.warn = saved.warn;
    db.withEntity = saved.withEntity; privacy.gate = saved.gate; global.fetch = saved.fetch;
    if (saved.token === undefined) delete process.env.WHATSAPP_TOKEN; else process.env.WHATSAPP_TOKEN = saved.token;
    console.log('\nsec-95 · ' + n + ' checks');
  }
})();
