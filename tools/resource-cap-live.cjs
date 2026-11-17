#!/usr/bin/env node
'use strict';
/*
 * OWNS      the LIVE half of register column 16 (resource_cap, OWASP API4:2023): through the REAL server and a REAL Postgres it asks big list routes for limit=100000 and bursts an AI route and a mail route.
 *           With --write it is the ONLY writer of docs/contracts/api-resource-cap-evidence.json (what the run saw; the register's column is the static claim, this is the proof beside it).
 * CALLED BY by hand on a SIT box against a throwaway database built by tools/migrate.cjs (never production, never a shared database).
 * FLOW      seed one throwaway business ──▶ per list route: GET ?limit=100000 ──▶ clamped (the answer says a limit at or under the cap) | refused (4xx Problem naming the field) | UNCAPPED
 *                                        ──▶ burst POST /api/assist (AI) and POST /api/signin/ask (mail) ──▶ the first 429, its status, content-type and Problem body (code RATE_LIMITED, retry_after_seconds)
 * CARD      28-platform-and-operations/api-standard
 *
 *   DATABASE_URL=postgres://cb_app:...@127.0.0.1:PORT/db JWT_SECRET=... node tools/resource-cap-live.cjs --base http://127.0.0.1:3611 [--write] [--json FILE]
 */
const path = require('path');
const fs = require('fs');
const jsonWebToken = require('jsonwebtoken');
const { LIMIT_MAX } = require('../lib/bounds');

const API = path.join(__dirname, '..');
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
const EVIDENCE_FILE = path.join(API, 'docs', 'contracts', 'api-resource-cap-evidence.json');
const RUN_TAG = 'rc' + (Date.now() % 1e9).toString(36);
const BIG = 100000;
/** a clamp at or under this is plain clamped; above it and up to bounds PAGE_MAX is `clamped_high` (a cap exists, the owner area judges the size: a product or party picker); above PAGE_MAX is UNCAPPED */
const MAX_ROWS = 500;
const { PAGE_MAX } = require('../lib/bounds');

if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app on a throwaway database) and JWT_SECRET (the running server\'s)'); process.exit(3); }
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: DATABASE_URL must be cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
const { query } = require(path.join(API, 'db'));

/** big list routes (no path parameter): the ones the register reads as capped through page-limit, and the ones it names no_list_cap */
const LIST_ROUTES = [
  '/api/products', '/api/crm/parties', '/api/work/list', '/api/actors', '/api/catalogue/enquiry', '/api/notifications',
  '/api/flags', '/api/books-actions', '/api/books-grants/log', '/api/channels/outbound', '/api/books/bank/statement-files', '/api/marketing/came-back'
];

async function business() {
  const bridgeId = 'CB' + RUN_TAG;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'ResourceCap ' + RUN_TAG, bridgeId.toLowerCase()]);
  return { id: identity.identity_id, bridgeId, name: identity.display_name };
}
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

/** one request: { status, type, body, text } */
async function call(token, method, route, body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (notJson) { json = null; }
  return { status: res.status, type: res.headers.get('content-type') || '', body: json, retry: res.headers.get('retry-after') };
}

/** the rows of a page answer: the first array found at the top level */
const rowsOf = (body) => { if (Array.isArray(body)) return body; const key = body && Object.keys(body).find((name) => Array.isArray(body[name])); return key ? body[key] : null; };

/** the verdict of one limit=100000 read: clamped (the answer names a limit at or under the cap, or carries no more rows than the cap) · refused (a 4xx Problem) · UNCAPPED · not-reached (no list answer: 401/403/404/5xx) */
function verdictOf(out) {
  if (out.status >= 400 && out.status < 500 && out.body && out.body.code && ![401, 403, 404].includes(out.status)) return 'refused';
  if (out.status !== 200 || !out.body) return 'not-reached';
  const said = out.body.limit;
  const rows = rowsOf(out.body);
  if (typeof said === 'number') return said <= MAX_ROWS ? 'clamped' : said <= PAGE_MAX ? 'clamped_high' : 'UNCAPPED';
  return rows && rows.length > PAGE_MAX ? 'UNCAPPED' : 'clamped-no-limit-echo';
}

/** fire n requests in a row; the first 429 and how many it took */
async function burst(token, method, route, body, n) {
  for (let at = 1; at <= n; at++) {
    const out = await call(token, method, route, body);
    if (out.status === 429) return { route: method + ' ' + route, requests_until_429: at, status: 429, content_type: out.type, code: out.body && out.body.code, has_retry_after: !!out.retry, retry_after_seconds: out.body && out.body.params && out.body.params.retry_after_seconds, problem_shape: !!(out.body && out.body.status === 429 && out.body.title !== undefined) };
  }
  return { route: method + ' ' + route, requests_until_429: null, status: null };
}

(async () => {
  const shop = await business();
  const token = tokenFor({ identity_id: shop.id, identity_type: 'entity', bridge_id: shop.bridgeId, display_name: shop.name });
  const lists = [];
  for (const route of LIST_ROUTES) {
    const out = await call(token, 'GET', route + '?limit=' + BIG + '&page=1');
    lists.push({ route: 'GET ' + route, status: out.status, limit_in_answer: out.body && typeof out.body.limit === 'number' ? out.body.limit : null, verdict: verdictOf(out) });
  }
  const bursts = [
    await burst(token, 'POST', '/api/assist', { prompt: 'hello' }, 80),
    await burst(null, 'POST', '/api/signin/ask', { email: RUN_TAG + '@example.invalid' }, 60)
  ];
  const result = { tool: 'tools/resource-cap-live.cjs', asked_limit: BIG, cap: LIMIT_MAX, lists, bursts };
  const reached = lists.filter((item) => item.verdict !== 'not-reached');
  const bad = lists.filter((item) => item.verdict === 'UNCAPPED');
  console.log(JSON.stringify(result, null, 1));
  console.log('lists reached: ' + reached.length + ' of ' + lists.length + ' · UNCAPPED: ' + bad.length + ' · bursts that gave a 429 Problem: ' + bursts.filter((item) => item.status === 429 && item.problem_shape && /problem\+json/.test(item.content_type)).length + ' of ' + bursts.length);
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(result, null, 1));
  if (process.argv.includes('--write')) fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({ version: 1, note: 'written only by tools/resource-cap-live.cjs --write; what a real server and a real Postgres answered' }, result), null, 1) + '\n');
  process.exit(bad.length || reached.length < 5 || bursts.some((item) => item.status !== 429) ? 1 : 0);
})().catch((failure) => { console.error(failure); process.exit(2); });
