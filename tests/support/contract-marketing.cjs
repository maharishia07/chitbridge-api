'use strict';
/**
 * tests/support/contract-marketing.cjs - the /api/marketing and /api/channels/outbound answers the web's Marketing face reads, called through the REAL routers and the
 * REAL lib/marketing-results + lib/channels over a canned database (no Postgres): three sent offers, two of them followed by a bill, one refused row.
 * CALLED BY tests/web-api-contract.test.cjs (capture 'marketing'). CARD 12-marketing/README
 */
const path = require('path'), http = require('http');
const API = path.join(__dirname, '..', '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const P = (n) => '10000000-0000-4000-8000-00000000000' + n;
const SENT_AT = new Date(Date.now() - 5 * 86400e3).toISOString(), BILL_AT = new Date(Date.now() - 4 * 86400e3).toISOString();

async function captureMarketing() {
  const got = {};
  const keep = (key, r) => { got[key] = got[key] || { status: r.status, bodies: [] }; got[key].bodies.push(r.body); };
  const sends = [
    { party_id: P(1), status: 'sent', reason: null, send_ref: 'S1', created_at: SENT_AT, party_name: 'Chola Auto Care' },
    { party_id: P(2), status: 'sent', reason: null, send_ref: 'S1', created_at: SENT_AT, party_name: 'Ravi Traders' },
    { party_id: P(3), status: 'refused', reason: 'No consent for offers on whatsapp. Ask them first.', send_ref: 'S1', created_at: SENT_AT, party_name: 'Meena' }
  ];
  const receipt = (o) => Object.assign({ id: 'ob1', chit_id: null, capture_id: null, channel: 'whatsapp', from_ref: null, to_ref: '+919840099999', body: 'Diwali offer', status: 'sent', reason: null, provider_msg_id: 'wamid.1',
    created_at: SENT_AT, party_id: P(1), purpose: 'marketing', send_ref: 'S1', basis: { code: 'CONSENT', pref_id: 'pf1', at: SENT_AT }, party_name: 'Chola Auto Care', reason_code: null }, o);
  let quiet = false; /* the second answer: a shop that has sent nothing (why = a code and a sentence) */
  const run = async (sql) => {
    const t = String(sql).replace(/\s+/g, ' ');
    if (/FROM channel_outbound o LEFT JOIN identities i ON i.identity_id = o.party_id WHERE o.entity_id = \$1 AND o.purpose = 'marketing' AND o.party_id IS NOT NULL/.test(t)) return { rows: quiet ? [] : sends };
    if (/^SELECT o\.id, o\.chit_id/.test(t)) return { rows: [receipt({}), receipt({ id: 'ob2', status: 'refused', reason: 'No consent for offers on whatsapp. Ask them first.', party_id: P(3), party_name: 'Meena', basis: { code: 'NO_CONSENT', pref_id: null, at: null }, reason_code: 'NO_CONSENT' })] };
    if (/^SELECT count\(\*\)::int AS n FROM channel_outbound/.test(t)) return { rows: [{ n: 2 }] };
    return { rows: [] };
  };
  const handle = { query: run };
  stub('db', { query: run, withEntity: async (o, fn) => fn(handle), readBatch: async () => [] });
  stub('lib/schema', { hasColumn: async () => true, hasTable: async () => true });
  stub('lib/policy', { get: async () => ({ came_back_days: 14 }) });
  stub('lib/select', { rows: async () => [
    { chit_id: 'c1', counterparty_id: P(1), counterparty_name: 'Chola Auto Care', created_at: BILL_AT, purpose: 'order', doc_kind: 'bill_issued', bill_no: 'B-1', value: '480.00', currency: 'INR', current_status: 'completed', read_at: null, open_disputes: 0, resolved_disputes: 0, touched_at: BILL_AT },
    { chit_id: 'c2', counterparty_id: P(2), counterparty_name: 'Ravi Traders', created_at: BILL_AT, purpose: 'order', doc_kind: 'bill_issued', bill_no: 'B-2', value: '120.00', currency: 'INR', current_status: 'completed', read_at: null, open_disputes: 0, resolved_disputes: 0, touched_at: BILL_AT }
  ] });
  const authFn = (req, res, next) => { req.identity = { identity_id: 'E1' }; next(); };
  authFn.entityOf = () => 'E1';
  stub('middleware/auth', authFn);

  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/marketing', require(path.join(API, 'routes', 'marketing.js')));
  app.use('/api/channels', require(path.join(API, 'routes', 'channels.js')));
  const srv = app.listen(0), port = srv.address().port;
  const call = (p) => new Promise((resolve, reject) => {
    http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : {} })); }).on('error', reject);
  });
  try {
    keep('GET /api/marketing/came-back', await call('/api/marketing/came-back?page=1&limit=50'));
    quiet = true;
    keep('GET /api/marketing/came-back', await call('/api/marketing/came-back'));
    quiet = false;
    keep('GET /api/channels/outbound', await call('/api/channels/outbound?purpose=marketing&page=1&limit=50'));
  } finally { srv.close(); }
  return got;
}
module.exports = { captureMarketing };
