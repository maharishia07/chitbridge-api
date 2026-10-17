#!/usr/bin/env node
'use strict';
/**
 * tools/sandbox/pull.cjs — pull one accounting sandbox's books and KEEP THEM RAW (Athi, 2026-10-17: "keep the data").
 *   node tools/sandbox/pull.cjs <qbo|xero|zoho> [--force]
 * OWNS      the pull: a fresh token (lib/sandbox-oauth, refreshed and saved) → which company (vendors.cjs prepare) → every entity, paged →
 *           each body saved EXACTLY as the API returned it to C:/dev/samples/<vendor>/<yyyy-mm-dd>/<entity>.json (page 2 on: <entity>.pN.json;
 *           Zoho document details: <entity>.detail.json, an array of the bodies) + manifest.json (counts · time · API version · files)
 * IDEMPOTENT PER DAY: a day with a manifest is not pulled again (--force re-pulls it). Nothing here edits a body or writes to any database.
 * CALLED BY the coordinator, after Athi has pressed Connect on /api/sandbox · CARD 23-connectors-and-integrations/xero-quickbooks-myob
 * FLOW      vendorOf → already pulled today? → freshToken → prepare → pullEntity × N (+ pullDetails) → manifest.json
 * ⚠️ never prints a token or a key; a vendor's refusal is reported by its HTTP status and our sentence.
 */
const fs = require('fs');
const path = require('path');
const oauth = require('../../lib/sandbox-oauth');
const { VENDORS, ZOHO_DETAIL_CAP } = require('./vendors.cjs');

const MAX_PAGES = 50;
const today = () => new Date().toLocaleDateString('en-CA');   /* yyyy-mm-dd, this machine's day */

function refuse(message, code) { console.error('pull: ' + message); process.exit(code || 1); }

/** GET one address with the vendor's headers → { text, body } (the text is what gets saved) */
function getter(spec, token) {
  return async function getPage(address) {
    const response = await fetch(address, { headers: spec.headers(token) });
    const text = await response.text();
    if (!response.ok) { const e = new Error('HTTP ' + response.status + ' for ' + address.replace(/[?].*/, '')); e.status = response.status; throw e; }
    return { text, body: JSON.parse(text) };
  };
}
/** the address for one page of one entity (Zoho also carries the organisation on every call) */
function urlOf(spec, token, route) {
  const address = spec.base(token) + route.replace('{org}', encodeURIComponent(token.organization_id || ''));
  return spec.query ? address + (address.includes('?') ? '&' : '?') + spec.query(token) : address;
}
const fileOf = (dir, name, page) => path.join(dir, name + (page > 1 ? '.p' + page : '') + '.json');

/** one entity, every page, each saved as returned → { count, files, records (for details) } */
async function pullEntity(spec, token, getPage, entity, dir) {
  const out = { count: 0, files: [], records: [] };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { text, body } = await getPage(urlOf(spec, token, entity.path(page)));
    const file = fileOf(dir, entity.name, page);
    fs.writeFileSync(file, text);
    out.files.push(path.basename(file));
    const found = entity.list(body);
    out.count += found.length; out.records = out.records.concat(found);
    if (!entity.more(body)) break;
    if (page === MAX_PAGES) out.capped = 'stopped at ' + MAX_PAGES + ' pages';
  }
  return out;
}
/** Zoho lists carry no lines: one detail read per document (capped), kept as an array of the bodies as returned */
async function pullDetails(spec, token, getPage, entity, found, dir) {
  const docIds = found.map((rec) => rec[entity.detail.id]).filter(Boolean).slice(0, ZOHO_DETAIL_CAP);
  const bodies = [];
  for (const docId of docIds) bodies.push((await getPage(urlOf(spec, token, entity.detail.path(encodeURIComponent(docId))))).body);
  const file = path.join(dir, entity.name + '.detail.json');
  fs.writeFileSync(file, JSON.stringify(bodies, null, 1));
  return { file: path.basename(file), count: bodies.length, capped: found.length > docIds.length ? 'details for ' + docIds.length + ' of ' + found.length : null };
}
/** every entity in turn; one that fails is recorded with its reason and the rest still pull */
async function pullAll(spec, token, dir) {
  const getPage = getter(spec, token), entities = {};
  for (const entity of spec.entities) {
    try {
      const pulled = await pullEntity(spec, token, getPage, entity, dir);
      entities[entity.name] = { count: pulled.count, files: pulled.files, capped: pulled.capped || null };
      if (entity.detail && pulled.count) entities[entity.name].detail = await pullDetails(spec, token, getPage, entity, pulled.records, dir);
      console.log('  ' + entity.name + ': ' + pulled.count);
    } catch (e) { entities[entity.name] = { count: 0, files: [], error: e.message }; console.log('  ' + entity.name + ': NOT pulled — ' + e.message); }
  }
  return entities;
}
/** the token, and which company it reaches (saved on the token file the first time) */
async function connectTo(vendor, spec) {
  let token = await oauth.freshToken(vendor);
  const getPage = getter(spec, token);
  const which = await spec.prepare(token, async (address) => (await getPage(address)).body);
  if (which.save) token = oauth.saveToken(vendor, Object.assign({}, token, which.save));
  return { token, company: which.company || null };
}

/** one vendor, today: skip if already pulled, else connect, pull every entity and write the manifest */
async function main() {
  const vendor = oauth.vendorOf(process.argv[2]);
  if (!vendor) refuse('which sandbox — qbo, xero or zoho?', 2);
  const pullDay = today(), dir = path.join(oauth.samplesDir(), vendor, pullDay), manifestFile = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestFile) && !process.argv.includes('--force')) { console.log('pull: ' + vendor + ' was already pulled today (' + dir + ') — nothing done. --force pulls again.'); return; }
  oauth.loadKeys();
  const spec = VENDORS[vendor], started = new Date().toISOString();
  const { token, company } = await connectTo(vendor, spec);
  fs.mkdirSync(dir, { recursive: true });
  const entities = await pullAll(spec, token, dir);
  fs.writeFileSync(manifestFile, JSON.stringify({ vendor, source: 'api', company, api_version: spec.api_version, started_at: started, finished_at: new Date().toISOString(), entities }, null, 2));
  console.log('pull: ' + vendor + ' saved to ' + dir);
}

if (require.main === module) main().catch((e) => refuse(e.message + (e.code ? ' (' + e.code + ')' : '')));
module.exports = { urlOf, fileOf, pullEntity };
