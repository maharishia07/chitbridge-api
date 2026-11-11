#!/usr/bin/env node
/**
 * till-strict-input.test.cjs — S33 strict input, the counter's LIVE doors: an unknown body key is refused by name, every key the handler reads or the till sends is declared.
 *
 * OWNS      the proof that closing the 15 live-only counter doors (lib/till-contract.js, additionalProperties false) refuses nothing the handler reads
 *           or the counter (web till.html, vendored) sends. The doors that can sit in the counter's offline queue (flags, stock, stock/bulk, reward) stay OPEN on purpose: an older queued body must not wedge on a newer server (PM/ATHI-DECISIONS 2026-11-09, recommendation).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      lib/till-contract.js ROUTES (closed rows) → schemaValidate of the route's own operation → unknown key 400 naming it; handler text in routes/till.js → keys read ⊆ declared
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/till-strict-input.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../lib/till-contract');

const ROUTE_TEXT = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');
let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

const LIVE = ['/alias', '/catalogue', '/close', '/diagnostic', '/enrol', '/listen', '/pair', '/pair/claim', '/quick-keys/hide', '/quick-keys/unhide', '/reconcile', '/screens/rename', '/screens/revoke', '/shop', '/state'];
const QUEUED = ['/flags', '/stock', '/stock/bulk', '/reward']; /* reward/claim, quick-keys/state, quick-keys/screen-config: no till ever sent them, so none can be queued: closed in till-strict-replay.test.cjs */
/* what the counter sends today, call site by call site (web till.html at origin/main, 11 Nov 2026) */
const SENT = {
  '/alias': ['item_id', 'by', 'text', 'unit', 'factor'], '/catalogue': ['blueprint'], '/close': ['last_no', 'bills', 'next', 'period'],
  '/diagnostic': ['code', 'verdict', 'till_id', 'online', 'storage', 'queued', 'foreign', 'bills', 'last_why', 'waiting'], '/enrol': ['name', 'counter', 'takeover'],
  '/listen': ['audio', 'mime', 'format'], '/pair': [], '/pair/claim': ['code'], '/quick-keys/hide': ['product_id', 'also_counters'], '/quick-keys/unhide': ['product_id'],
  '/reconcile': ['bills'], '/screens/rename': ['jti', 'name'], '/screens/revoke': ['jti'], '/state': ['state', 'by', 'since'],
  '/shop': ['trade_name', 'legal_name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'gstin']
};

const row = (route) => C.ROUTES['POST ' + route];
const closed = (route) => !!(row(route).rules && row(route).rules.additionalProperties === false);
LIVE.forEach((route) => ok('POST /api/till' + route + ' is closed', closed(route)));
QUEUED.forEach((route) => ok('POST /api/till' + route + ' stays open (it can wait in the offline queue)', !closed(route)));

LIVE.forEach((route) => {
  const operation = C.contract.OPERATIONS['POST /api/till' + route];
  const schema = operation.requestBody.content['application/json'].schema;
  ok('POST /api/till' + route + ' schema says additionalProperties false', schema.additionalProperties === false);
  const missing = (SENT[route] || []).filter((key) => !(key in (schema.properties || {})));
  ok('POST /api/till' + route + ' declares every key the counter sends', missing.length === 0, 'missing: ' + missing.join(', '));
});

/** the keys a route's handler reads from its body variable (body / given / text / input / req.body), inside its own router.post block */
function handlerKeys(route) {
  const start = ROUTE_TEXT.indexOf("router.post('" + route + "'");
  if (start < 0) return null;
  const next = ROUTE_TEXT.indexOf('\nrouter.', start + 10);
  const block = ROUTE_TEXT.slice(start, next < 0 ? undefined : next);
  const keys = new Set();
  for (const m of block.matchAll(/\b(?:body|given|text|input|req\.body|\(req\.body \|\| \{\}\))\.([a-z_]+)\b/g)) keys.add(m[1]);
  for (const m of block.matchAll(/(?:body|given)\[['"]([a-z_]+)['"]\]/g)) keys.add(m[1]);
  return keys;
}
const NOT_FIELDS = new Set(['length', 'map', 'filter', 'slice', 'trim', 'toString', 'forEach', 'some', 'every', 'join', 'split', 'includes', 'hasOwnProperty']);
LIVE.forEach((route) => {
  const keys = handlerKeys(route);
  if (!keys) return ok('POST /api/till' + route + ' handler found in routes/till.js', false);
  const declared = new Set(row(route).body || []);
  const unread = [...keys].filter((key) => !NOT_FIELDS.has(key) && !declared.has(key));
  ok('POST /api/till' + route + ' handler reads only declared keys', unread.length === 0, 'read but not declared: ' + unread.join(', '));
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
