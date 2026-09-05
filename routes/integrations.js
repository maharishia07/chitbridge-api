/**
 * /api/integrations — THE HOME OF CONNECTORS (Athi, 2026-09-05: "include the tally connector as a downloadable option in
 * the system itself … all should reside as part of Integrations; if we build more, it should stay there").
 *
 *   GET  /api/integrations/catalogue                 → the connectors that exist: id · name · what it does · adapters · status
 *   GET  /api/integrations/download/:id?adapter=…    → a ZIP of the connector kit, connector.json pre-filled with THIS API's
 *                                                       base and the adapter; the key stays EMPTY (a person pastes the one
 *                                                       they minted — a secret never rides a download link)
 *   POST /api/integrations/heartbeat  (key: connector) { name, adapter, host, version, counters } → recorded on the entity
 *   GET  /api/integrations/status     (session)      → the connectors that have checked in: last seen, counters
 *
 * No migration: heartbeats ride identities.policy_flags.connectors (jsonb), like keys do.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const { query } = require('../db');
const { zip } = require('../lib/zip-store');

const KIT = path.join(__dirname, '..', 'tools', 'tally-connector');
const CATALOGUE = [
  { id: 'tally', name: 'Tally connector', adapters: ['tally', 'csv'], default_adapter: 'tally', runs_on: 'the store PC (node ≥ 18, no dependencies, outbound internet only)',
    does: 'Products up from Tally into the catalogue (matched by code, receipts); offers back at billing time; orders down into Tally as Sales vouchers the moment the bell rings — once, never twice.',
    status: 'proven against a fake Tally and the live API; the first live Tally run may need a field or sign correction in adapters/tally.js (README)',
    steps: ['Settings › Integrations › mint a key, scope connector', 'Download the kit, unzip, paste the key into connector.json', 'node index.js sync-products, then node index.js watch'] },
  { id: 'zoho', name: 'Zoho Books connector', adapters: ['zoho'], default_adapter: 'zoho', runs_on: 'any PC with node ≥ 18 (REST, an OAuth token)',
    does: 'Items from Zoho Books into the catalogue; offers back at billing; every ChitBridge order becomes a Zoho invoice the moment it arrives — once, never twice.',
    status: 'written from the published Zoho Books API, proven against a stand-in; the first live run may need customer_id / item_id corrected in adapters/zoho.js (docs)',
    steps: ['Settings › Integrations › mint a key, scope connector', 'Download the kit; connector.json: key, zoho.base (region), zoho.org, zoho.token', 'node index.js sync-products, then node index.js watch'] },
  { id: 'csv', name: 'File connector (CSV)', adapters: ['csv'], default_adapter: 'csv', runs_on: 'any PC with node ≥ 18',
    does: 'The same connector with files: products.csv in, one CSV per order out. The shape any system that can export a file attaches through today.',
    status: 'proven', steps: ['Mint a key, scope connector', 'Download, unzip, paste the key', 'Put products.csv beside it; node index.js sync-products; node index.js watch'] },
];

function kitFiles(adapter) {
  const names = ['core.js', 'index.js', 'fake-tally.js', 'fake-zoho.js', 'prove.js', 'README.md', 'adapters/tally.js', 'adapters/csv.js', 'adapters/zoho.js', 'docs/tally.md', 'docs/zoho.md', 'docs/csv.md'];
  const out = [];
  for (const n of names) { const p = path.join(KIT, n); if (fs.existsSync(p)) out.push({ name: 'chitbridge-connector/' + n, data: fs.readFileSync(p) }); }
  return out;
}

/** the instruction document of a connector, as markdown — shown on the Integrations screen and shipped in the kit */
router.get('/docs/:id', (req, res) => {
  const c = CATALOGUE.find((x) => x.id === req.params.id); if (!c) return res.status(404).json({ error: 'Not found' });
  const p = path.join(KIT, 'docs', c.id + '.md'); if (!fs.existsSync(p)) return res.status(404).json({ error: 'No document' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.end(fs.readFileSync(p, 'utf8'));
});
router.get('/catalogue', (req, res) => res.json({ connectors: CATALOGUE.map((c) => Object.assign({}, c, { download: '/api/integrations/download/' + c.id, docs: '/api/integrations/docs/' + c.id })) }));

router.get('/download/:id', (req, res) => {
  const c = CATALOGUE.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const adapter = c.adapters.includes(String(req.query.adapter || '')) ? String(req.query.adapter) : c.default_adapter;
  const base = process.env.PUBLIC_API_BASE || (req.protocol + '://' + req.get('host'));
  const cfg = { api: base, key: 'PASTE THE KEY FROM SETTINGS › INTEGRATIONS (scope: connector)', adapter, name: c.name,
                tally: { url: 'http://localhost:9000', company: null, partyLedger: 'Cash', salesLedger: 'Sales', voucherType: 'Sales' }, csv: { products: 'products.csv', orders: 'orders' },
                zoho: { base: 'https://www.zohoapis.in', org: 'YOUR ORGANISATION ID', token: 'YOUR ACCESS TOKEN', customer_name: 'Walk-in' } };
  const files = kitFiles(adapter).concat([{ name: 'chitbridge-connector/connector.json', data: JSON.stringify(cfg, null, 2) + '\n' },
    { name: 'chitbridge-connector/START.txt', data: 'ChitBridge connector — ' + c.name + '\n\n1. Paste your key (Settings › Integrations, scope connector) into connector.json\n2. node index.js sync-products --config connector.json\n3. node index.js watch --config connector.json\n\nWithout Tally: node fake-tally.js 9100 and set tally.url to http://localhost:9100. README.md has the rest.\n' }]);
  const buf = zip(files);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="chitbridge-connector-' + c.id + '.zip"');
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
});

async function listOf(entity_id) {
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  return Array.isArray(pf.connectors) ? pf.connectors : [];
}
router.post('/heartbeat', auth, auth.requireScope('connector'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req); const b = req.body || {};
    const id = String(b.id || ((b.name || 'connector') + '@' + (b.host || 'unknown'))).slice(0, 120);
    const list = await listOf(entity_id);
    const rec = { id, name: String(b.name || 'connector').slice(0, 80), adapter: String(b.adapter || '').slice(0, 40), host: String(b.host || '').slice(0, 80), version: String(b.version || '').slice(0, 20),
                  key_jti: (req.api_key && req.api_key.jti) || null, last_seen: new Date().toISOString(), counters: (b.counters && typeof b.counters === 'object') ? b.counters : {}, note: String(b.note || '').slice(0, 200) };
    const next = list.filter((x) => x && x.id !== id).concat([rec]).slice(-20);
    await query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`, [JSON.stringify({ connectors: next }), entity_id]);
    res.json({ ok: true, id, seen: rec.last_seen });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.get('/status', auth, async (req, res) => {
  try { const list = await listOf(auth.entityOf(req)); res.json({ connectors: list.sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen))) }); }
  catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.openapi = { paths: {
  '/api/integrations/catalogue': { get: { summary: 'The connectors that exist, with a download each', tags: ['keys'], responses: { 200: { description: 'catalogue' } } } },
  '/api/integrations/heartbeat': { post: { summary: 'A running connector checks in (key: connector)', tags: ['keys'], security: [{ apiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, adapter: { type: 'string' }, host: { type: 'string' }, version: { type: 'string' }, counters: { type: 'object' } } } } } }, responses: { 200: { description: 'seen' } } } },
}, schemas: {} };
module.exports = router;
module.exports.CATALOGUE = CATALOGUE;
