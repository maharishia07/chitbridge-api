#!/usr/bin/env node
/**
 * net-41-bridge-id-search.test.cjs — NET-41 (proof 2026-11-14): a BRIDGE ID typed in supplier search finds the network shop on ANOTHER installation.
 * @type regression
 * OWNS      the proof on lib/network-search.search (where = one far installation, then 'all'): the far side answers with the SAME lib/business-search.find the door
 *           (routes/ctp.js answerSearch) runs, over a stand-in table. Hand-computed: the far shop is "Far Timber", user_id far-timber, bridge id CBFARTIM01, listed and
 *           opted in. Typed "CBFARTIM01" (and lower-case "cbfartim01") -> ONE row, bridge_id CBFARTIM01, address CBFARTIM01@au.example.com, never the asker.
 *           Control: typed "far timber" finds the same shop (so the stand-in is live and a miss is the code's, not the world's).
 * Enrolled in GUARDS (was .red.cjs while red).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      typed id -> network-search.search -> ctpquery.ask stub -> business-search.find({ abroad:true }) over the stand-in -> rows
 *   node tests/net-41-bridge-id-search.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done, mock, standInDb } = require('./lib/cat-proof-kit.cjs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.INSTALLATION_KEY = 'sit-in';

const FAR = [{ identity_id: 'far-1', display_name: 'Far Timber', bridge_id: 'CBFARTIM01', user_id: 'far-timber', currency_code: 'AUD', business_status: 'open', population: 'live', catalogue_visibility: 'public', plan: 'free', params_override: {}, entity_visibility: 'public' }];
/** the far table as the SQL reads it: name or handle LIKE %text%, and a bridge id equality when the statement asks for one */
const farAnswer = (sql, params) => {
  if (!/FROM identities/.test(sql)) return { rows: [] };
  const text = String(params[0]).replace(/%/g, '').toLowerCase();
  const byBridge = /bridge_id\s*=/.test(sql) || /bridge_id\)?\s+LIKE/i.test(sql);
  return { rows: FAR.filter((s) => s.display_name.toLowerCase().includes(text) || s.user_id.toLowerCase().includes(text) || (byBridge && s.bridge_id.toLowerCase() === text)) };
};
const here = standInDb(() => ({ rows: [] }));
const far = standInDb(farAnswer);
mock('db', here.db); mock('db/index', here.db);
const book = require(path.join(API, 'lib', 'ctpaddress'));
book.remoteInstallations = async () => new Map([['sit-au', { endpoint: 'https://au.example.com/api/ctp/deliver', active: true, domain: 'au.example.com', label: 'Sit AU' }]]);
const bs = require(path.join(API, 'lib', 'business-search'));
const ns = require(path.join(API, 'lib', 'network-search'));
const ME = { identity_id: 'id-me', bridge_id: 'CBMYSELF01' };
/** the far installation answering the signed question: the same find, as an installation that opted in to sell outside */
const ask = async (target, want) => Object.assign({ ok: true }, await bs.find({ q: want.q, kind: want.kind, limit: want.limit }, { abroad: true, openAbroad: async () => true, query: far.db.query }));
const typed = (q, where) => ns.search({ q, kind: 'business', limit: 10 }, ME, where, { ask, query: here.db.query, find: (a) => bs.find(a, { query: here.db.query }) });

(async () => {
  const control = await typed('far timber', 'sit-au');
  ok('control: the shop is found by its NAME on the far installation', control.ok && control.results.length === 1 && control.results[0].bridge_id === 'CBFARTIM01', JSON.stringify(control));
  const exact = await typed('CBFARTIM01', 'sit-au');
  ok('typed BRIDGE ID on the far installation: exactly one row', exact.ok && exact.results.length === 1, JSON.stringify(exact));
  const row = (exact.results || [])[0] || {};
  ok('the row is the far shop, with its address', row.bridge_id === 'CBFARTIM01' && row.address === 'CBFARTIM01@au.example.com' && row.installation_key === 'sit-au', JSON.stringify(row));
  const lower = await typed('cbfartim01', 'all');
  ok('lower-case bridge id, where=all: found once', lower.ok && lower.results.filter((r) => r.bridge_id === 'CBFARTIM01').length === 1, JSON.stringify(lower));
  ok('the far answer says it answered', (exact.answers || []).every((a) => a.ok), JSON.stringify(exact.answers));
  done();
})();
