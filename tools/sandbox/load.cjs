#!/usr/bin/env node
'use strict';
/**
 * tools/sandbox/load.cjs — replay a SAVED sandbox pull through OUR move-in on the LOCAL stack, and write down every difference.
 *   node tools/sandbox/load.cjs <qbo|xero|zoho> [yyyy-mm-dd | docs-sample] [--entity <uuid>] [--keep]
 * OWNS      reading a pull back (manifest → pages → records, Zoho details over their list rows) · one rolled-back transaction per run ·
 *           the comparison file C:/dev/samples/<vendor>/loads/<pull>-<time>.json
 * REUSES    lib/move-in world → plan → apply (the SAME doors POST /api/books/move-in/import walks) · tools/tally-connector/adapters/zoho.js
 *           readProducts + readProfile (replayed from the saved files) · tools/sandbox/maps.cjs (lanes) · compare.cjs (the checks)
 * REFUSES   any DATABASE_URL but the local container's (postgres://postgres:cblocal@127.0.0.1:55432/cb_local)
 * LANDING   everything is applied inside ONE withEntity transaction that is ROLLED BACK unless --keep: the counts landed are real, the shop is
 *           left as it was. Items are PLANNED, not applied, unless --keep — the catalogue writer commits on its own connection.
 * CALLED BY the coordinator after pull.cjs · CARD 23-connectors-and-integrations/xero-quickbooks-myob
 * FLOW      guardDb → pullDir → recordsReader → landAll (runLane × lanes) → zohoConnector → compare checks → loads/<pull>-<time>.json
 */
const fs = require('fs');
const path = require('path');

const LOCAL_DB = 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local';
const ROLLBACK = Symbol('rollback');

function refuse(message, code) { console.error('load: ' + message); process.exit(code || 1); }
function guardDb() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== LOCAL_DB) refuse('REFUSED — DATABASE_URL is not the local test database. Unset it or point it at ' + LOCAL_DB, 3);
  process.env.DATABASE_URL = LOCAL_DB;
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
}

function args(argv) {
  const parsed = { vendor: argv[2], pull: null, entity: null, keep: argv.includes('--keep') };
  const at = argv.indexOf('--entity'); if (at > 0) parsed.entity = argv[at + 1];
  const pull = argv.slice(3).find((word, index, all) => !word.startsWith('--') && all[index - 1] !== '--entity');
  if (pull) parsed.pull = pull;
  return parsed;
}

/* ═══ the saved pull, read back ═══ */
/** the named pull, else the newest dated one */
function pullDir(base, name) {
  if (name) return path.join(base, name);
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort() : [];
  return days.length ? path.join(base, days[days.length - 1]) : null;
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
/** a Zoho detail body replaces its list row (same id): the list has no lines, the detail does */
function withDetails(entity, held, dir, recs) {
  if (!entity.detail || !held.detail || !held.detail.file) return recs;
  const bodies = readJson(path.join(dir, held.detail.file)).map((body) => body[entity.detail.key]).filter(Boolean);
  const byId = new Map(bodies.map((doc) => [String(doc[entity.detail.id]), doc]));
  return recs.map((rec) => byId.get(String(rec[entity.detail.id])) || rec);
}
/** entity name → its records, every page read through the entity's own reader (vendors.cjs) */
function recordsReader(vendor, dir, manifest) {
  const { VENDORS } = require('./vendors.cjs');
  const cache = new Map();
  return function recordsOf(name) {
    if (cache.has(name)) return cache.get(name);
    const entity = VENDORS[vendor].entities.find((candidate) => candidate.name === name), held = (manifest.entities || {})[name] || {};
    let recs = [];
    if (entity) for (const file of held.files || []) recs = recs.concat(entity.list(readJson(path.join(dir, file))));
    if (entity) recs = withDetails(entity, held, dir, recs);
    cache.set(name, recs);
    return recs;
  };
}

/* ═══ the local shop, and the move-in ═══ */
/** the shop to land in: the one asked for, else the first with its books on (a local tool, before any shop is known — RLS-GUARD warns, by design) */
async function pickEntity(db, wanted) {
  const found = await db.query(`SELECT entity_id, country, functional_currency, enabled FROM books_setting WHERE ($1::uuid IS NULL OR entity_id = $1::uuid) ORDER BY enabled DESC, enabled_at NULLS LAST LIMIT 1`, [wanted || null]);
  return found.rows[0] || null;
}
/** the move-in's dry run for one lane → { plan, world } or { refusal } (its own sentence) */
async function planLane(handle, ctx, lane, rows) {
  const moveIn = require('../../lib/move-in');
  try {
    const world = await moveIn.world(handle, ctx.entity, lane.kind, ctx.setting);
    return { world, plan: moveIn.plan(lane.kind, { source: ctx.source, side: lane.side, rows, world, currency: ctx.currency, as_at: ctx.as_at }) };
  } catch (e) { return { refusal: e.message }; }
}
/** the move-in's write for one lane, in a savepoint so a refusal leaves the run's transaction alive */
async function applyLane(handle, ctx, lane, planned, rowsIn) {
  const moveIn = require('../../lib/move-in');
  await handle.query('SAVEPOINT sandbox_lane');
  try {
    const ref = ['sandbox', ctx.tag, lane.kind, lane.side || '', lane.label || ''].join(':');
    const applied = await moveIn.apply(handle, ctx.entity, planned.plan, { world: planned.world, setting: ctx.setting, by: null, as_at: ctx.as_at, currency: ctx.currency, client_ref: ref });
    await handle.query('RELEASE SAVEPOINT sandbox_lane');
    return { landed: { added: applied.added, merged: applied.merged, skipped: applied.skipped } };
  } catch (e) {
    await handle.query('ROLLBACK TO SAVEPOINT sandbox_lane');
    return { refusal: e.message, landed: { added: 0, merged: 0, skipped: rowsIn } };
  }
}
/** one lane: plan always; apply unless it is items without --keep, or the plan refused */
async function runLane(handle, ctx, lane, rows) {
  const moveIn = require('../../lib/move-in');
  const out = { kind: lane.kind, side: lane.side || null, label: lane.label || null, rows_in: rows.length, planned: null, landed: null, refusal: null, skipped_why: {} };
  if (!rows.length) return out;
  if (rows.length > moveIn.MAX_ROWS) return Object.assign(out, { refusal: 'more than ' + moveIn.MAX_ROWS + ' rows — the move-in takes one file of ' + moveIn.MAX_ROWS });
  const planned = await planLane(handle, ctx, lane, rows);
  if (planned.refusal) return Object.assign(out, { refusal: planned.refusal });
  out.planned = planned.plan.counts; out.refusal = planned.plan.refusal || null;
  planned.plan.rows.filter((row) => row.action === 'skip').forEach((row) => { out.skipped_why[row.why] = (out.skipped_why[row.why] || 0) + 1; });
  if (out.refusal || (lane.kind === 'items' && !ctx.keep)) return out;
  return Object.assign(out, await applyLane(handle, ctx, lane, planned, rows.length));
}

/** every lane in ONE transaction, rolled back unless --keep → { shop, lanes, laneRows } */
async function landAll(vendor, recordsOf, opts) {
  const db = require('../../db'), books = require('../../lib/books');
  const { LANES, SOURCE, laneRows } = require('./maps.cjs');
  const rowsOut = LANES[vendor].map((lane) => ({ lane, kind: lane.kind, side: lane.side, rows: laneRows(lane, recordsOf).rows }));
  const shop = await pickEntity(db, opts.entity), lanes = [];
  if (!shop) return { shop: null, lanes, laneRows: rowsOut };
  try {
    await db.withEntity(shop.entity_id, async (handle) => {
      const setting = await books.settingOf(handle, shop.entity_id);
      const ctx = { entity: shop.entity_id, setting, source: SOURCE[vendor], currency: books.curOf(setting), as_at: opts.as_at, keep: opts.keep, tag: opts.tag };
      for (const each of rowsOut) lanes.push(await runLane(handle, ctx, each.lane, each.rows));
      if (!opts.keep) throw ROLLBACK;
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  return { shop, lanes, laneRows: rowsOut };
}

/* ═══ Zoho: the connector's own mapping, replayed from the saved files ═══ */
/** a fetch that answers the adapter's GETs from the saved pages (items by page, the organisation) */
function replayFetch(dir, manifest) {
  const files = (name) => ((manifest.entities || {})[name] || {}).files || [];
  return async (address) => {
    const asked = new URL(address), page = Number(asked.searchParams.get('page') || 1);
    const name = /\/items$/.test(asked.pathname) ? 'items' : /\/organizations\//.test(asked.pathname) ? 'organisation' : null;
    const file = name && files(name)[page - 1];
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8') : JSON.stringify({ code: 0, items: [], page_context: { has_more_page: false } });
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
}
/** the Zoho connector adapter run over the saved files: what its readProducts and readProfile make of them */
async function zohoConnector(dir, manifest) {
  const saved = global.fetch;
  global.fetch = replayFetch(dir, manifest);
  try {
    const adapter = require('../tally-connector/adapters/zoho.js')({ zoho: { base: 'https://replay.zohoapis.in', org: 'saved', token: 'replay' } });
    const products = await adapter.readProducts();
    let profile = null;
    try { profile = await adapter.readProfile(); } catch (e) { profile = { error: e.message }; }
    return { products: products.length, sample: products.slice(0, 3), profile };
  } finally { global.fetch = saved; }
}

/** the vendor's own currency (their organisation), else the shop's */
function theirCurrency(vendor, recordsOf, fallback) {
  const organisation = recordsOf('organisation')[0] || {};
  const theirs = vendor === 'xero' ? organisation.BaseCurrency : vendor === 'zoho' ? organisation.currency_code : null;
  return theirs || fallback || null;
}
/** the comparison: counts in, each lane's counts, the connector replay, and every check */
async function buildReport(loadRun) {
  const checks = require('./compare.cjs'), { vendor, recordsOf, manifest, land } = loadRun;
  const currency = theirCurrency(vendor, recordsOf, land.shop && land.shop.functional_currency) || 'USD';
  const entityNames = Object.keys(manifest.entities || {});
  return { vendor, pull: loadRun.tag, source: manifest.source || 'api', company: manifest.company || null, loaded_at: new Date().toISOString(), kept: loadRun.keep,
    shop: land.shop ? { entity_id: land.shop.entity_id, country: land.shop.country, currency: land.shop.functional_currency, books_on: land.shop.enabled } : null,
    counts_in: Object.fromEntries(entityNames.map((name) => [name, recordsOf(name).length])), lanes: land.lanes,
    connector: vendor === 'zoho' ? await zohoConnector(loadRun.dir, manifest) : null,
    no_home: checks.noHome(vendor, recordsOf, entityNames), tax_codes: checks.taxCodes(vendor, recordsOf),
    rounding: checks.rounding(vendor, recordsOf, currency), units: checks.units(vendor, recordsOf), parties: checks.parties(land.laneRows) };
}

/** read the pull, land it in a rolled-back transaction, compare, write the file and say it */
async function main() {
  const asked = args(process.argv);
  guardDb();
  const oauth = require('../../lib/sandbox-oauth');
  const vendor = oauth.vendorOf(asked.vendor); if (!vendor) refuse('which sandbox — qbo, xero or zoho?', 2);
  const dir = pullDir(path.join(oauth.samplesDir(), vendor), asked.pull);
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) refuse('no saved pull for ' + vendor + (asked.pull ? ' (' + asked.pull + ')' : '') + ' — run tools/sandbox/pull.cjs ' + vendor + ' first.');
  const manifest = readJson(path.join(dir, 'manifest.json')), recordsOf = recordsReader(vendor, dir, manifest);
  const tag = path.basename(dir), asAt = /^\d{4}-\d{2}-\d{2}$/.test(tag) ? tag : new Date().toLocaleDateString('en-CA');
  const land = await landAll(vendor, recordsOf, { entity: asked.entity, keep: asked.keep, as_at: asAt, tag });
  const report = await buildReport({ vendor, recordsOf, manifest, land, tag, dir, keep: asked.keep });
  const outDir = path.join(oauth.samplesDir(), vendor, 'loads'); fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, tag + '-' + new Date().toISOString().slice(11, 16).replace(':', '') + '.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  printSummary(report, outFile);
  await require('../../db').pool.end();
}

/** the run in a dozen lines; the file holds the rest */
function printSummary(report, file) {
  const shop = report.shop ? report.shop.country + ' ' + report.shop.entity_id.slice(0, 8) : 'NONE (no books setting on this database)';
  console.log('load: ' + report.vendor + ' ' + report.pull + ' → shop ' + shop + (report.kept ? ' (KEPT)' : ' (rolled back)'));
  console.log('  in: ' + Object.entries(report.counts_in).map(([name, count]) => name + ' ' + count).join(' · '));
  report.lanes.forEach((lane) => console.log('  ' + lane.kind + (lane.side ? ':' + lane.side : '') + (lane.label ? ' (' + lane.label + ')' : '') + ' rows ' + lane.rows_in
    + ' · planned ' + JSON.stringify(lane.planned) + ' · landed ' + JSON.stringify(lane.landed) + (lane.refusal ? ' · REFUSED: ' + lane.refusal : '')));
  if (report.connector) console.log('  connector (zoho adapter): products ' + report.connector.products + ' · profile ' + JSON.stringify(report.connector.profile).slice(0, 160));
  console.log('  tax codes: ' + report.tax_codes.map((taxCode) => taxCode.code + '→' + taxCode.verdict).join(' · '));
  const round = report.rounding;
  console.log('  rounding: ' + round.differences.length + ' differences over ' + round.with_lines + ' documents with lines · finer than a minor unit: ' + round.values_finer_than_a_minor_unit);
  const partyCheck = report.parties;
  console.log('  parties: unknown contact on ' + partyCheck.docs_naming_unknown_contact.length + ' docs · duplicate names ' + partyCheck.duplicate_names.length + ' · on both sides ' + partyCheck.on_both_sides.length);
  console.log('  written: ' + file);
}

if (require.main === module) main().catch((e) => refuse(e.stack || e.message));
module.exports = { args, pullDir, recordsReader, LOCAL_DB };
