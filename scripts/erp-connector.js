// erp-connector.js — proves the ERP "process-then-forget" connector end-to-end AS the ERP would (an authenticated
// HTTP client posting a document). Asserts: receipt-only (raw payload NEVER stored), idempotency (retry = one
// receipt, one effect), per-copy chit emission, RLS isolation of the receipt ledger, and the auth/type guards.
//
// PREREQ: migration b69_connector_receipt.sql applied, and this connectors.js deployed. Run: node scripts/erp-connector.js
const crypto = require('crypto');
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let PASS = 0, FAIL = 0;
function check(n, ok, d) { if (ok) { PASS++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { FAIL++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }

// Mirror of the server's canonical hash so we can independently verify the receipt's payload_hash.
const stableStringify = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
};
const hashPayload = (v) => crypto.createHash('sha256').update(stableStringify(v)).digest('hex');

async function api(m, p, { token, key, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  if (key) h['X-Bridge-Key'] = key;
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, json: j };
}
async function login(name) {
  const r = await api('POST', '/api/entities/register', { body: { email: name } });
  const o = r.json && r.json.dev_otp;
  const v = await api('POST', '/api/entities/verify', { body: { email: r.json.email, otp: o } });
  return v.json.token;
}

(async () => {
  console.log('== ERP CONNECTOR (process-then-forget) ==\n');
  const A = await login('Alpha Timbers');
  const B = await login('Beta Traders');
  // discover Beta's entity id (the counterparty) so the outcome chit has somewhere to co-land
  const bMe = await api('GET', '/api/entities/me', { token: B });
  const betaId = bMe.json && (bMe.json.entity_id || bMe.json.identity_id || (bMe.json.entity && bMe.json.entity.identity_id));

  // 1) create an ERP connector — it MUST get a credential (unlike IoT pull)
  const nm = 'ERP ' + Date.now().toString().slice(-5);
  const c = await api('POST', '/api/connectors', { token: A, body: { display_name: nm, type: 'erp', config: { folder: 'ERP Inbox', counterparty_entity_id: betaId } } });
  const id = c.json && c.json.connector && c.json.connector.identity_id;
  const key = c.json && c.json.provision_key;
  check('ERP connector created', !!id, id);
  check('ERP connector is issued a key', !!key);
  if (!id || !key) return done();

  // 2) push a document → a receipt is created, an outcome chit is emitted
  const doc1 = { doc_type: 'invoice', doc_ref: 'INV-1001', amount: 4200, currency: 'INR', lines: [{ sku: 'TIMBER-A', qty: 10 }, { sku: 'TIMBER-B', qty: 3 }], notes: 'raw payload body that must NOT be persisted' };
  const p1 = await api('POST', '/api/connectors/erp-ingest', { key, body: { payload: doc1, to: betaId } });
  check('document accepted', p1.status === 200 && p1.json && p1.json.message === 'received', 'status ' + p1.status);
  check('receipt id returned', !!(p1.json && p1.json.receipt_id));
  check('outcome = processed (counterparty set)', p1.json && p1.json.outcome === 'processed', p1.json && p1.json.outcome);
  check('an outcome chit was emitted', !!(p1.json && p1.json.chit_id));
  check('payload_hash matches independent canonical hash', p1.json && p1.json.payload_hash === hashPayload(doc1));

  // 3) IDEMPOTENCY — same document again → duplicate, same receipt, NO new effect
  const p1b = await api('POST', '/api/connectors/erp-ingest', { key, body: { payload: doc1, to: betaId } });
  check('retry flagged duplicate', p1b.json && p1b.json.outcome === 'duplicate', p1b.json && p1b.json.outcome);
  check('retry returns the SAME receipt', p1b.json && p1.json && p1b.json.receipt_id === p1.json.receipt_id);
  check('retry did NOT emit a second chit', p1b.json && (p1b.json.chit_id === p1.json.chit_id || p1b.json.chit_id == null));
  // key-order-independent: same content, different key order → still a duplicate
  const doc1reordered = { notes: doc1.notes, lines: doc1.lines, currency: 'INR', amount: 4200, doc_ref: 'INV-1001', doc_type: 'invoice' };
  const p1c = await api('POST', '/api/connectors/erp-ingest', { key, body: { payload: doc1reordered, to: betaId } });
  check('reordered-keys payload dedupes (canonical hash)', p1c.json && p1c.json.outcome === 'duplicate');

  // 4) a DIFFERENT document → a new receipt
  const doc2 = { doc_type: 'order', doc_ref: 'PO-77', amount: 900, currency: 'INR' };
  const p2 = await api('POST', '/api/connectors/erp-ingest', { key, body: { payload: doc2, to: betaId } });
  check('new document → new receipt', p2.json && p2.json.outcome === 'processed' && p2.json.receipt_id !== p1.json.receipt_id);

  // 5) RECEIPT-ONLY — the ledger returns hash + outcome, but NEVER the raw payload
  const led = await api('GET', '/api/connectors/' + id + '/receipts', { token: A });
  const rows = (led.json && led.json.receipts) || [];
  check('receipt ledger readable by owner', led.status === 200 && rows.length >= 2, rows.length + ' receipts');
  const leak = rows.some(r => 'payload' in r || 'lines' in r || 'notes' in r || 'body' in r);
  check('ledger carries NO raw payload (only hash/outcome)', !leak);
  const inv = rows.find(r => r.doc_ref === 'INV-1001');
  check('receipt keeps doc_type/ref + hash', !!(inv && inv.doc_type === 'invoice' && inv.payload_hash));

  // 6) RLS ISOLATION — Beta cannot read Alpha's ERP receipt ledger
  const bLed = await api('GET', '/api/connectors/' + id + '/receipts', { token: B });
  check('other entity cannot read the ledger (404)', bLed.status === 404, 'status ' + bLed.status);

  // 7) GUARDS — wrong key, missing payload, and IoT device hitting the ERP path
  const badKey = await api('POST', '/api/connectors/erp-ingest', { key: 'not-a-real-key', body: { payload: doc2 } });
  check('bad key → 401', badKey.status === 401, 'status ' + badKey.status);
  const noBody = await api('POST', '/api/connectors/erp-ingest', { key, body: { doc_ref: 'X' } });
  check('missing payload → 400', noBody.status === 400, 'status ' + noBody.status);
  const iot = await api('POST', '/api/connectors', { token: A, body: { display_name: 'IOT ' + Date.now().toString().slice(-4), type: 'iot', config: { mode: 'push' } } });
  const iotKey = iot.json && iot.json.provision_key;
  const wrongType = await api('POST', '/api/connectors/erp-ingest', { key: iotKey, body: { payload: doc2 } });
  check('IoT key on ERP path → 409 wrong type', wrongType.status === 409, 'status ' + wrongType.status);

  done();
})().catch(e => { console.error(e); done(); });
function done() { console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(0); }
