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
    status: 'LIVE on TallyPrime (2026-09-05): products, stock and profile up; Sales and Receipt vouchers down; registered buyers with GSTIN; the buyer side books Purchase vouchers with ITC (role both)',
    steps: ['In Tally: F1 › Settings › Connectivity › TallyPrime acts as Both · Enable ODBC · port 9000; keep the company open', 'Download (your key is inside), unzip on the Tally PC, double-click start.cmd — it installs Node.js if needed, asks a few questions, tests Tally, syncs your products and registers itself to run on its own', 'This row turns live; your items appear under Catalogue'] },
  { id: 'gofrugal', name: 'GoFrugal connector', adapters: ['gofrugal'], default_adapter: 'gofrugal', runs_on: 'the store PC or server (node ≥ 18; GoFrugal\'s WebReporter API with an API key)',
    does: 'Items with sale price, MRP, GST % and stock per location into the catalogue; every order becomes a GoFrugal Sales Order with our reference — your billing raises the invoice. No profile, receipt or purchase API is published, so those steps are skipped and say so.',
    status: 'written from GoFrugal\'s published knowledge base, proven against a stand-in; the API is enabled per retailer by GoFrugal (terms theirs)',
    steps: ['Ask GoFrugal to enable the WebReporter API on your server; note the API key', 'Settings › Integrations › mint a key, scope connector', 'Download the kit; node setup.js → gofrugal; node index.js watch --stock-minutes 5'] },
  { id: 'zoho', name: 'Zoho Books connector', adapters: ['zoho'], default_adapter: 'zoho', runs_on: 'any PC with node ≥ 18 (REST, an OAuth token)',
    does: 'Items from Zoho Books into the catalogue; offers back at billing; every ChitBridge order becomes a Zoho invoice the moment it arrives — once, never twice.',
    status: 'written from the published Zoho Books API, proven against a stand-in; the first live run may need customer_id / item_id corrected in adapters/zoho.js (docs)',
    steps: ['Zoho API console › Self Client: copy Client ID + Secret; Generate Code with scope ZohoBooks.fullaccess.all (10 minutes)', 'Download (your key is inside), unzip, double-click start.cmd — system zoho, region, the id, the secret, the code; it keeps a refresh token, lists your organisations, reads your items', 'Approve this PC once under Running connectors; this row turns live'] },
  { id: 'csv', name: 'File connector (CSV)', adapters: ['csv'], default_adapter: 'csv', runs_on: 'any PC with node ≥ 18',
    does: 'The same connector with files: products.csv in, one CSV per order out. The shape any system that can export a file attaches through today.',
    status: 'proven', steps: ['Mint a key, scope connector', 'Download, unzip, paste the key', 'Put products.csv beside it; node index.js sync-products; node index.js watch'] },
];

function kitFiles(adapter) {
  const names = ['core.js', 'index.js', 'setup.js', 'start.cmd', 'fake-tally.js', 'fake-zoho.js', 'fake-gofrugal.js', 'prove.js', 'README.md', 'adapters/tally.js', 'adapters/csv.js', 'adapters/zoho.js', 'adapters/gofrugal.js', 'docs/tally.md', 'docs/zoho.md', 'docs/csv.md', 'docs/gofrugal.md', 'samples/products.csv', 'samples/profile.csv'];
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

/* signed in → the zip carries a key; anonymous (a bare link) → the placeholder, as before. auth only runs when credentials are offered. */
const authIfOffered = (req, res, next) => ((req.headers.authorization || req.headers['x-api-key']) ? auth(req, res, next) : next());
router.get('/download/:id', authIfOffered, async (req, res) => {
  const c = CATALOGUE.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const adapter = c.adapters.includes(String(req.query.adapter || '')) ? String(req.query.adapter) : c.default_adapter;
  const base = process.env.PUBLIC_API_BASE || (req.protocol + '://' + req.get('host'));
  /* ⭐ THE KEY IS INSIDE (Athi, 2026-09-06: "download option should autofill everything"): a session download mints a connector key named
     for this kit and writes it into connector.json — the "shown once" is the zip itself. `configured:false` sends start.cmd through setup
     (Tally port, company, ledgers) before it ever watches. An anonymous download, or the 20-key limit, falls back to the placeholder. */
  let key = 'PASTE THE KEY FROM SETTINGS › INTEGRATIONS (scope: connector)', minted = null;
  if (req.identity && !req.api_key) {
    try { minted = await require('./keys').mint(auth.entityOf(req), req.identity, { name: 'kit ' + c.id + ' · ' + new Date().toISOString().slice(0, 10), scopes: ['connector', 'services'] }); key = minted.key; }
    catch (e) { console.log('kit download: key not minted —', e && e.message); }
  }
  const cfg = { api: base, key, configured: false, adapter, name: c.name,
                tally: { url: 'http://localhost:9000', company: null, partyLedger: 'Cash', salesLedger: 'Sales', voucherType: 'Sales' }, csv: { products: 'products.csv', orders: 'orders' },
                zoho: { base: 'https://www.zohoapis.in', org: 'YOUR ORGANISATION ID', token: 'YOUR ACCESS TOKEN', customer_name: 'Walk-in' } };
  const files = kitFiles(adapter).concat([{ name: 'chitbridge-connector/connector.json', data: JSON.stringify(cfg, null, 2) + '\n' },
    { name: 'chitbridge-connector/START.txt', data: 'ChitBridge connector — ' + c.name + '\n\n1. On the Tally PC: F1 › Settings › Connectivity › TallyPrime acts as Both · Enable ODBC: Yes · port 9000. Keep the company open.\n2. Double-click start.cmd in this folder. That is all.\n   It installs Node.js if the PC has none, asks a few questions (where Tally listens, company, ledgers, Educational edition), tests both ends,\n   syncs your products, registers itself to run on its own (Windows restarts it after a crash or reboot) and starts watching for orders.\n\nYour key is already inside connector.json' + (minted ? ' (Settings › Integrations › Your keys: "' + minted.name + '", last4 ' + minted.last4 + ')' : ' — no: this zip was fetched without signing in; paste a key from Settings › Integrations, scope connector') + '. Keep this folder private.\n\n3. Approve this PC once in ChitBridge › Settings › Integrations › Running connectors (it shows this PC and your Tally company; automatic when the Tally GSTIN equals your profile GSTIN).\n\nHOW YOU KNOW IT WORKED: the window prints Products: read N; ChitBridge › Catalogue shows your Tally items; Settings › Integrations shows this connector as live.\n\nEverything else, with a table of what each failure message means: docs/' + c.id + '.md\n' }]);
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
  key_jti: c.key_jti || null, last_seen: a.last_seen, health: health(a.last_seen), counters: c.counters || {}, note: c.note || '', kit: !!c.kit, enrol: c.enrol || null }; }

router.post('/heartbeat', auth, auth.requireScope('connector'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req); const b = req.body || {};
    const kit_id = String(b.id || ((b.name || 'connector') + '@' + (b.host || 'unknown'))).slice(0, 120);
    const name = String(b.name || 'connector').slice(0, 80), host = String(b.host || '').slice(0, 80);
    /* ⭐ THE HANDSHAKE (Athi, 2026-09-06: "if I sign into my account on another store's PC and run the installer… there should be an
       authentication process — how does the handshake happen that this is the right store and the right installation?"). Decided here,
       enforced in middleware/auth.js. A connector key is approved for ONE PC (host). In order:
         1. the owner already approved THIS PC by hand → approved (their decision stands, whatever the GSTINs say);
         2. the Tally company's GSTIN equals the account's → approved (the strongest proof of the right store, nobody clicks);
         3. both have a GSTIN and they differ → pending, and the reason says so loudly (wrong store, or wrong account);
         4. approved earlier on THIS PC → still approved;  5. approved earlier on ANOTHER PC → pending again ("new PC");
         6. nothing known → pending: Settings › Integrations › Running connectors › Approve this PC (host · Tally company). */
    const keysMod = require('./keys'); const jti = req.api_key && req.api_key.jti; let enrol = null;
    if (jti) {
      const list = await keysMod.listOf(entity_id); const rec = list.find((k) => k && String(k.jti) === String(jti)) || null;
      const prior = (rec && rec.enrol) || null; const t = (b.tally && typeof b.tally === 'object') ? b.tally : {};
      const norm = (g) => String(g || '').replace(/\s/g, '').toUpperCase();
      const me = await query('SELECT gstn FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] }));
      const myG = norm(me.rows[0] && me.rows[0].gstn), theirG = norm(t.gstin); const sameHost = !!(prior && prior.host && host && prior.host === host);
      let approved, reason;
      /* ⚠️ the owner's approval is FOR ONE HOST (found by INT-01, run 30: the click on STORE-PC rode along to THIRD-PC and let a wrong GSTIN through) */
      const ownerHere = !!(prior && prior.approved_by && prior.approved_host && host && prior.approved_host === host);
      if (ownerHere) { approved = true; reason = 'approved by the owner'; }
      else if (myG && theirG && myG === theirG) { approved = true; reason = 'gstin match'; }
      else if (myG && theirG) { approved = false; reason = 'gstin mismatch — Tally company says ' + theirG + ', this account says ' + myG + ' (wrong store, or wrong account)'; }
      else if (prior && prior.approved === true && (sameHost || !prior.host || !host)) { approved = true; reason = prior.reason || 'approved'; }
      else if (prior && prior.approved === true) { approved = false; reason = 'new PC ' + host + ' — the approved PC was ' + prior.host; }
      else { approved = false; reason = 'awaiting approval'; }
      enrol = { approved, reason, host: host || null, company: String(t.company || '').slice(0, 120) || null, gstin: theirG || null, at: new Date().toISOString(),
                approved_by: ownerHere ? prior.approved_by : null, approved_at: ownerHere ? prior.approved_at : null, approved_host: ownerHere ? prior.approved_host : null };
      if (rec) await keysMod.setEnrol(entity_id, jti, enrol);
    }
    const patchCfg = { kit: true, kit_id, adapter: String(b.adapter || '').slice(0, 40), version: String(b.version || '').slice(0, 20), key_jti: (req.api_key && req.api_key.jti) || null,
                       counters: (b.counters && typeof b.counters === 'object') ? b.counters : {}, note: String(b.note || '').slice(0, 200), enrol };
    const have = await query(`SELECT identity_id FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND connector_type IS NOT NULL AND connector_config->>'kit_id' = $2`, [entity_id, kit_id]);
    let actor_id = have.rows[0] && have.rows[0].identity_id, created = false;
    if (!actor_id) {
      /* the kit's first heartbeat: the connector ACTOR the co-assist rail lists — same row shape routes/connectors.js creates */
      actor_id = uuidv4(); created = true;
      await query(`INSERT INTO identities (identity_id, bridge_id, display_name, actor_key, actor_type, parent_entity_id, actor_role, phone, max_tasks, identity_type, status, break_status, hat, connector_type, site, connector_config, last_seen)
                   /* ⚠️ WAS 'human' with 10 tasks (Athi, 2026-09-06, the co-assist card: "the type says human? and the hat says editor"). A kit is a
                      CONNECTOR: it takes no tasks (0), it has no login, and the hat stays 'act' — it writes products and stock. */
                   VALUES ($1,$2,$3,$4,'connector',$5,NULL,NULL,0,'actor','active','active','act','erp',$6,$7,NOW())`,
                  [actor_id, generateBridgeId(), name, uuidv4(), entity_id, host || null, JSON.stringify(patchCfg)]);
    } else {
      /* self-healing: a kit actor minted as 'human · 10 tasks' before 2026-09-06 becomes a connector on its next heartbeat — no migration to run */
      await query(`UPDATE identities SET last_seen = NOW(), display_name = $2, site = COALESCE($3, site), connector_config = COALESCE(connector_config,'{}'::jsonb) || $4::jsonb,
                     actor_type = 'connector', max_tasks = 0 WHERE identity_id = $1`, [actor_id, name, host || null, JSON.stringify(patchCfg)]);
    }
    /* ⭐ the trigger the kit obeys (Athi, 2026-09-06: "there must be some trigger to be allowed to go to Tally") — Settings › Governance › Orders go to the books */
    let books_at = 'accepted'; try { const pf = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]); const v = pf.rows[0] && pf.rows[0].policy_flags && pf.rows[0].policy_flags.books_at; if (/^(received|accepted|completed|manual)$/.test(String(v || ''))) books_at = String(v); } catch (_) {}
    res.json({ ok: true, id: kit_id, actor_id, created, seen: new Date().toISOString(), approved: enrol ? enrol.approved : true, reason: enrol ? enrol.reason : null, policy: { books_at } });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
/** the owner approves a PC (session only): the key behind that connector row may now do its work; a later heartbeat from the same host stays approved */
router.post('/:actor_id/approve', auth, async (req, res) => {
  try {
    if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'A key cannot approve itself — sign in.' });
    const entity_id = auth.entityOf(req);
    const r = await query(`SELECT identity_id, site, connector_config FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor' AND connector_type IS NOT NULL`, [req.params.actor_id, entity_id]);
    const a = r.rows[0]; if (!a) return res.status(404).json({ error: 'Not found' });
    const c = a.connector_config || {}; if (!c.key_jti) return res.status(400).json({ error: 'No key', message: 'This connector has no key to approve' });
    const hostNow = (c.enrol && c.enrol.host) || a.site || null;
    const patch = { approved: true, reason: 'approved by the owner', host: hostNow, approved_host: hostNow, approved_by: req.identity.identity_id, approved_at: new Date().toISOString() };
    const enrol = await require('./keys').setEnrol(entity_id, c.key_jti, patch);
    await query(`UPDATE identities SET connector_config = COALESCE(connector_config,'{}'::jsonb) || $2::jsonb WHERE identity_id = $1`, [a.identity_id, JSON.stringify({ enrol: Object.assign({}, c.enrol || {}, patch) })]);
    res.json({ ok: true, enrol });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
/**
 * ⭐ THE BOOKS SAY SO ON THE TASK (Athi, 2026-09-06: "there must be a detail somewhere in the task that it has been written to Tally").
 * POST /api/integrations/books { chit_id, kind: order|receipt|purchase, system, ref, outcome: ok|failed|dry|skipped, why?, at? }
 * — the kit's write-back after every push, onto MY copy of the chit (business_json.books[kind]); never a second voucher, only the record
 * of the one that went (or did not). A connector key with scope connector; the bell rings for the entity so an open Task repaints.
 */
router.post('/books', auth, auth.requireScope('connector'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req); const b = req.body || {};
    if (!b.chit_id || !/^[0-9a-f-]{36}$/.test(String(b.chit_id))) return res.status(400).json({ error: 'validation', message: 'chit_id required' });
    const kind = /^(order|receipt|purchase)$/.test(String(b.kind || '')) ? String(b.kind) : 'order';
    const rec = { system: String(b.system || 'books').slice(0, 40), ref: b.ref != null ? String(b.ref).slice(0, 120) : null, outcome: /^(ok|failed|dry|skipped)$/.test(String(b.outcome || '')) ? String(b.outcome) : 'ok',
                  why: b.why ? String(b.why).slice(0, 300) : null, at: b.at ? String(b.at).slice(0, 40) : new Date().toISOString(), host: String(b.host || '').slice(0, 80) || null, actor_id: req.identity.identity_id };
    const r = await require('../db').withEntity(entity_id, (db) => db.query(
      `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('books', COALESCE(business_json->'books', '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb))
        WHERE chit_id = $3 AND entity_id = $4 RETURNING chit_id`, [kind, JSON.stringify(rec), b.chit_id, entity_id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    try { require('../lib/events').emit([entity_id], { kind: 'chit', id: b.chit_id, note: 'books' }); } catch (_) {}
    res.json({ ok: true, kind, books: rec });
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
/* ── THE PROFILE FROM THEIR SYSTEM (Athi, 2026-09-05): what we look for · where it comes from · how trusted ── */
const PM = require('../lib/profile-map');
router.get('/profile-map', auth, async (req, res) => {
  try { const P = require('../lib/profile'); const values = await P.profileValues(auth.entityOf(req)); res.json(Object.assign({ engine: 'chitbridge-profile-map', version: 1 }, PM.assess(values))); }
  catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.post('/profile', auth, auth.requireScope('connector'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req); const b = req.body || {}; const P = require('../lib/profile');
    const source = String(b.source || 'connector').slice(0, 40), as_of = (b.as_of && !isNaN(Date.parse(b.as_of))) ? new Date(b.as_of).toISOString() : new Date().toISOString();
    const incoming = Object.entries(b.fields || {}).filter(([k]) => PM.FIELDS.some((f) => f.key === k)).map(([k, val]) => ({ key: k, value: val, source, as_of, rung: 'copied' }));
    if (!incoming.length) return res.status(400).json({ error: 'validation', message: 'fields{} required — keys: ' + PM.FIELDS.map((f) => f.key).join(', ') });
    const current = await P.profileValues(entity_id);
    const m = PM.merge(current, incoming);
    /* the checks raise what they can: a GSTIN with a good check digit becomes 'checked', and so on — before it is written */
    const a = PM.assess(m.values); for (const k of Object.keys(m.values)) if (a.fields[k] && a.fields[k].rung && PM.rank(a.fields[k].rung) > PM.rank(m.values[k].rung)) m.values[k].rung = a.fields[k].rung;
    for (const k of Object.keys(a.fields)) if (a.fields[k].derived && !m.values[k]) m.values[k] = { value: a.fields[k].value, source: a.fields[k].source, as_of, rung: a.fields[k].rung || 'declared' };
    const w = await P.applyProfileMap(entity_id, m.values, { source, as_of });
    res.json(Object.assign({ message: 'Profile updated from ' + source, written: m.written, kept: m.kept, rows: w.rows }, PM.assess(await P.profileValues(entity_id))));
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.openapi = { paths: {
  '/api/integrations/profile-map': { get: { summary: 'What we look for about the store, where it comes from, how trusted — with the current values', tags: ['keys'], security: [{ bearer: [] }, { apiKey: [] }], responses: { 200: { description: 'the map' } } } },
  '/api/integrations/profile': { post: { summary: 'The connector writes the store\'s profile from its own system (rung copied; checks may raise it; never below a held rung)', tags: ['keys'], security: [{ apiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { source: { type: 'string' }, as_of: { type: 'string' }, fields: { type: 'object' } } } } } }, responses: { 200: { description: 'written · kept · the map' } } } },
  '/api/integrations/ask/{handle}/stock': { post: { summary: 'Ask the store\'s connector for fresh stock (public; answered through the bell)', tags: ['keys'], parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'asked · listeners' } } } },
  '/api/integrations/stock/{handle}': { get: { summary: 'The stamped stock figures of a public storefront', tags: ['keys'], parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'stock' } } } },
  '/api/integrations/catalogue': { get: { summary: 'The connectors that exist, with a download each', tags: ['keys'], responses: { 200: { description: 'catalogue' } } } },
  '/api/integrations/heartbeat': { post: { summary: 'A running connector checks in (key: connector)', tags: ['keys'], security: [{ apiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, adapter: { type: 'string' }, host: { type: 'string' }, version: { type: 'string' }, counters: { type: 'object' } } } } } }, responses: { 200: { description: 'seen' } } } },
}, schemas: {} };
module.exports = router;
module.exports.CATALOGUE = CATALOGUE;
