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
 * ⭐ ONE CONNECTOR CONCEPT (Athi, 2026-09-05: "converge"). A downloaded kit IS a co-assist connector: its first heartbeat
 * creates the connector ACTOR (identities row, connector_type 'erp', site = the host, connector_config.kit = true) the
 * co-assist rail already lists with site, health and rights; every later heartbeat writes the actor's last_seen and
 * counters, so the SAME health(last_seen) answers here and there. The API key stays the kit's credential (scoped,
 * revocable); the actor row is its identity. No migration: the columns b62 gave connectors.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const { query } = require('../db');
const { zip } = require('../lib/zip-store');
const { v4: uuidv4 } = require('uuid');
const { generateBridgeId } = require('../lib/bridgeid');

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
  const names = ['core.js', 'index.js', 'fake-tally.js', 'fake-zoho.js', 'prove.js', 'README.md', 'adapters/tally.js', 'adapters/csv.js', 'adapters/zoho.js', 'docs/tally.md', 'docs/zoho.md', 'docs/csv.md', 'samples/products.csv'];
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

function health(last_seen) { if (!last_seen) return 'offline'; const age = Date.now() - new Date(last_seen).getTime(); return age > 15 * 60 * 1000 ? 'offline' : (age > 3 * 60 * 1000 ? 'slow' : 'live'); }
const KIT_ROWS = `SELECT identity_id, display_name, site, last_seen, connector_type, connector_config, status, created_at
                    FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL AND status = 'active'`;
function rowOut(a) { const c = a.connector_config || {}; return { id: c.kit_id || a.identity_id, actor_id: a.identity_id, name: a.display_name, adapter: c.adapter || (a.connector_type === 'erp' ? 'erp' : a.connector_type), host: a.site || '', version: c.version || '',
  key_jti: c.key_jti || null, last_seen: a.last_seen, health: health(a.last_seen), counters: c.counters || {}, note: c.note || '', kit: !!c.kit }; }

router.post('/heartbeat', auth, auth.requireScope('connector'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req); const b = req.body || {};
    const kit_id = String(b.id || ((b.name || 'connector') + '@' + (b.host || 'unknown'))).slice(0, 120);
    const name = String(b.name || 'connector').slice(0, 80), host = String(b.host || '').slice(0, 80);
    const patchCfg = { kit: true, kit_id, adapter: String(b.adapter || '').slice(0, 40), version: String(b.version || '').slice(0, 20), key_jti: (req.api_key && req.api_key.jti) || null,
                       counters: (b.counters && typeof b.counters === 'object') ? b.counters : {}, note: String(b.note || '').slice(0, 200) };
    const have = await query(`SELECT identity_id FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL AND connector_config->>'kit_id' = $2`, [entity_id, kit_id]);
    let actor_id = have.rows[0] && have.rows[0].identity_id, created = false;
    if (!actor_id) {
      /* the kit's first heartbeat: the connector ACTOR the co-assist rail lists — same row shape routes/connectors.js creates */
      actor_id = uuidv4(); created = true;
      await query(`INSERT INTO identities (identity_id, bridge_id, display_name, actor_key, actor_type, parent_entity_id, actor_role, phone, max_tasks, identity_type, status, break_status, hat, connector_type, site, connector_config, last_seen)
                   VALUES ($1,$2,$3,$4,'human',$5,NULL,NULL,10,'actor','active','active','act','erp',$6,$7,NOW())`,
                  [actor_id, generateBridgeId(), name, uuidv4(), entity_id, host || null, JSON.stringify(patchCfg)]);
    } else {
      await query(`UPDATE identities SET last_seen = NOW(), display_name = $2, site = COALESCE($3, site), connector_config = COALESCE(connector_config,'{}'::jsonb) || $4::jsonb WHERE identity_id = $1`, [actor_id, name, host || null, JSON.stringify(patchCfg)]);
    }
    res.json({ ok: true, id: kit_id, actor_id, created, seen: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.get('/status', auth, async (req, res) => {
  try { const r = await query(KIT_ROWS + ' ORDER BY last_seen DESC NULLS LAST', [auth.entityOf(req)]); res.json({ connectors: r.rows.map(rowOut) }); }
  catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
/* ── ON DEMAND (Athi: "does it read on demand, for example availability?"): the storefront asks, the bell carries the
      ask to the connector that holds it, the connector reads the source and writes the stamped figures; the storefront
      re-reads them a few seconds later. Public, per handle, rate-limited by the service limiter. ── */
async function entityOfHandle(h) {
  const r = await query(`SELECT identity_id FROM identities WHERE (user_id = $1 OR bridge_id = $1) AND identity_type = 'entity' AND status = 'active' LIMIT 1`, [String(h || '')]);
  return r.rows[0] ? r.rows[0].identity_id : null;
}
router.post('/ask/:handle/stock', async (req, res) => {
  try {
    const entity_id = await entityOfHandle(req.params.handle); if (!entity_id) return res.status(404).json({ error: 'Not found' });
    const ask_id = uuidv4();
    const n = require('../lib/events').emit([entity_id], { kind: 'ask', what: 'stock', ask_id, codes: Array.isArray(req.body && req.body.codes) ? req.body.codes.slice(0, 200) : [] });
    res.json({ asked: n > 0, listeners: n, ask_id, note: n ? 'a connector is listening — re-read the stock in a few seconds' : 'no connector is listening now — the last stamped figures stand' });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.get('/stock/:handle', async (req, res) => {
  try {
    const entity_id = await entityOfHandle(req.params.handle); if (!entity_id) return res.status(404).json({ error: 'Not found' });
    const r = await require('../db').withEntity(entity_id, (db) => db.query(`SELECT item_id, item_data->'avail' AS avail FROM catalogue_items WHERE entity_id = $1 AND is_active = true AND item_data ? 'avail'`, [entity_id]));
    res.json({ stock: r.rows.map((x) => ({ item_id: x.item_id, avail: x.avail })), at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.openapi = { paths: {
  '/api/integrations/ask/{handle}/stock': { post: { summary: 'Ask the store\'s connector for fresh stock (public; answered through the bell)', tags: ['keys'], parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'asked · listeners' } } } },
  '/api/integrations/stock/{handle}': { get: { summary: 'The stamped stock figures of a public storefront', tags: ['keys'], parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'stock' } } } },
  '/api/integrations/catalogue': { get: { summary: 'The connectors that exist, with a download each', tags: ['keys'], responses: { 200: { description: 'catalogue' } } } },
  '/api/integrations/heartbeat': { post: { summary: 'A running connector checks in (key: connector)', tags: ['keys'], security: [{ apiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, adapter: { type: 'string' }, host: { type: 'string' }, version: { type: 'string' }, counters: { type: 'object' } } } } } }, responses: { 200: { description: 'seen' } } } },
}, schemas: {} };
module.exports = router;
module.exports.CATALOGUE = CATALOGUE;
