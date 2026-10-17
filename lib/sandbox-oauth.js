'use strict';
/**
 * lib/sandbox-oauth.js — ONE OAuth2 helper for the accounting-platform sandbox trial (QuickBooks · Xero · Zoho Books), LOCAL ONLY.
 * OWNS      the vendor table (authorize · token · scopes), the keys read from .env.sandboxes, the code exchange, the refresh,
 *           and the token file C:/dev/samples/.tokens/<vendor>.json (outside every repo; the docs repo ignores samples/)
 * CALLED BY routes/sandbox.js (connect · callback · the page) · tools/sandbox/pull.cjs (a fresh token before each pull)
 * FLOW      connect → authorizeUrl(state) → the vendor's consent → callback → exchange(code) → saveToken · pull → freshToken → refresh when old
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob (the trial: docs/23-connectors-and-integrations/SANDBOX-TRIAL-REQUIREMENT.md)
 *
 * ⚠️ SECRETS: the client ids and secrets are read from the environment at the moment of use (loadKeys fills it from .env.sandboxes,
 *    never overriding a value already set). Nothing here logs, returns or prints a secret or a token — `status()` says only yes / no.
 * Why not adapters/zoho.js `tokenCall`: that copy ships inside the shop-PC kit, which must run without this api; this is the api's own.
 */
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const REPO = path.join(__dirname, '..');
const FRESH_FOR_MS = 120000;           /* a token with less than two minutes left is refreshed first */
const DEFAULT_LIFE_S = 3600;
/** the samples root: beside the repo (C:/dev/samples for C:/dev/chitbridge-api and every C:/dev/wt-* worktree) unless SANDBOX_SAMPLES_DIR says */
const samplesDir = () => process.env.SANDBOX_SAMPLES_DIR || path.resolve(REPO, '..', 'samples');
const tokenFile = (vendor) => path.join(samplesDir(), '.tokens', vendor + '.json');
/** where the keys may be: an explicit file, this checkout, or the main api checkout beside a worktree (never copied anywhere) */
const envFiles = () => (process.env.SANDBOX_ENV_FILE ? [process.env.SANDBOX_ENV_FILE]
  : [path.join(REPO, '.env.sandboxes'), path.resolve(REPO, '..', 'chitbridge-api', '.env.sandboxes')]);

/** Zoho's data centre from ZOHO_DC ("in", "zoho.in", "accounts.zoho.in" or a URL) → its domain suffix; none → null (asked, never a national default) */
function zohoDc() {
  const given = String(process.env.ZOHO_DC || '').trim().toLowerCase();
  const host = /zoho(?:apis)?\.([a-z.]+?)\/?$/.exec(given.replace(/^https?:\/\//, ''));
  if (host) return host[1];
  return /^[a-z]{2,3}(\.[a-z]{2})?$/.test(given) ? given : null;
}

const VENDORS = {
  qbo: { name: 'QuickBooks', prefix: 'QBO', basicAuth: true,
    authorize: () => 'https://appcenter.intuit.com/connect/oauth2', token: () => 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scope: 'com.intuit.quickbooks.accounting', extra: {} },
  xero: { name: 'Xero', prefix: 'XERO', basicAuth: true,
    authorize: () => 'https://login.xero.com/identity/connect/authorize', token: () => 'https://identity.xero.com/connect/token',
    scope: 'offline_access accounting.transactions.read accounting.contacts.read accounting.settings.read accounting.reports.read', extra: {} },
  zoho: { name: 'Zoho Books', prefix: 'ZOHO', basicAuth: false,
    authorize: () => 'https://accounts.zoho.' + zohoDc() + '/oauth/v2/auth', token: () => 'https://accounts.zoho.' + zohoDc() + '/oauth/v2/token',
    scope: 'ZohoBooks.fullaccess.READ', extra: { access_type: 'offline', prompt: 'consent' } },
};
const VENDOR_KEYS = Object.keys(VENDORS);

/** fill process.env from the first .env.sandboxes found — an existing variable is never overridden; returns the file used or null */
function loadKeys() {
  const file = envFiles().find((candidate) => fs.existsSync(candidate));
  if (file) require('dotenv').config({ path: file, override: false, quiet: true });
  return file || null;
}
function vendorOf(given) { const name = String(given || '').toLowerCase(); return Object.prototype.hasOwnProperty.call(VENDORS, name) ? name : null; }
/** a vendor's keys from the environment (read at use, never stored here) */
function keys(vendor) {
  const prefix = VENDORS[vendor].prefix, fromEnv = (name) => String(process.env[prefix + '_' + name] || '').trim();
  return { id: fromEnv('CLIENT_ID'), secret: fromEnv('CLIENT_SECRET'), redirect: fromEnv('REDIRECT_URI') };
}
/** what is missing before a connect can start, in words; [] = ready */
function missing(vendor) {
  const have = keys(vendor), gaps = [];
  if (!have.id) gaps.push('client id');
  if (!have.secret) gaps.push('client secret');
  if (!have.redirect) gaps.push('redirect address');
  if (vendor === 'zoho' && !zohoDc()) gaps.push('data centre (ZOHO_DC)');
  return gaps;
}

function authorizeUrl(vendor, state) {
  const spec = VENDORS[vendor], have = keys(vendor);
  const query = Object.assign({ client_id: have.id, response_type: 'code', scope: spec.scope, redirect_uri: have.redirect, state }, spec.extra);
  return spec.authorize() + '?' + new URLSearchParams(query).toString();
}

/** the vendor's answer as JSON; a body that is not JSON is logged and read as {} (the caller then refuses on the status) */
async function jsonOf(response, vendor) {
  try { return await response.json(); }
  catch (e) { log.fellBack('sandbox-oauth: ' + vendor + ' token answer was not JSON — refused on its status', e); return {}; }
}
/** POST the token endpoint (authorization_code or refresh_token) → the vendor's JSON; a refusal throws with the vendor's error CODE only */
async function tokenCall(vendor, params) {
  const spec = VENDORS[vendor], have = keys(vendor);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const body = Object.assign({}, params);
  if (spec.basicAuth) headers.Authorization = 'Basic ' + Buffer.from(have.id + ':' + have.secret).toString('base64');
  else Object.assign(body, { client_id: have.id, client_secret: have.secret });
  const response = await fetch(spec.token(), { method: 'POST', headers, body: new URLSearchParams(body).toString() });
  const answer = await jsonOf(response, vendor);
  if (!response.ok || answer.error) { const e = new Error(spec.name + ' refused the token request (' + (answer.error || response.status) + ')'); e.code = 'SANDBOX_TOKEN_REFUSED'; throw e; }
  return answer;
}

/** the token file as kept: access + refresh token, when it runs out, and the vendor's own ids (QBO realm, Zoho api domain) */
function shapeToken(vendor, answer, prev, extra) {
  const before = prev || {};
  return Object.assign({}, before, extra || {}, {
    vendor, access_token: answer.access_token, refresh_token: answer.refresh_token || before.refresh_token || null,
    expires_at: Date.now() + (Number(answer.expires_in) || DEFAULT_LIFE_S) * 1000, api_domain: answer.api_domain || before.api_domain || null, saved_at: new Date().toISOString() });
}
function readToken(vendor) {
  try { return JSON.parse(fs.readFileSync(tokenFile(vendor), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function saveToken(vendor, token) {
  fs.mkdirSync(path.dirname(tokenFile(vendor)), { recursive: true });
  fs.writeFileSync(tokenFile(vendor), JSON.stringify(token, null, 2), { mode: 0o600 });
  return token;
}

/** the callback's code → the token file. `extra` carries what the redirect itself names (QBO realmId) */
async function exchange(vendor, code, extra) {
  const answer = await tokenCall(vendor, { grant_type: 'authorization_code', code: String(code || ''), redirect_uri: keys(vendor).redirect });
  return saveToken(vendor, shapeToken(vendor, answer, readToken(vendor), extra));
}
function notReady(message, code) { const e = new Error(message); e.code = code; return e; }
/** a token that is good for at least two more minutes, refreshed (and saved — Xero and QBO rotate the refresh token) when not */
async function freshToken(vendor) {
  const token = readToken(vendor), name = VENDORS[vendor].name;
  if (!token || !token.access_token) throw notReady(name + ' is not connected yet — open /api/sandbox and press Connect.', 'SANDBOX_NOT_CONNECTED');
  if (Number(token.expires_at || 0) - Date.now() > FRESH_FOR_MS) return token;
  if (!token.refresh_token) throw notReady(name + ' gave no refresh token — connect again.', 'SANDBOX_NO_REFRESH');
  const answer = await tokenCall(vendor, { grant_type: 'refresh_token', refresh_token: token.refresh_token });
  return saveToken(vendor, shapeToken(vendor, answer, token));
}
/** connected / not, and what is missing — never a secret, never a token */
function status(vendor) {
  const token = readToken(vendor);
  return { vendor, name: VENDORS[vendor].name, connected: !!(token && token.refresh_token), saved_at: (token && token.saved_at) || null, missing: missing(vendor) };
}

module.exports = { VENDORS, VENDOR_KEYS, samplesDir, tokenFile, loadKeys, vendorOf, keys, missing, authorizeUrl, exchange, freshToken, readToken, saveToken, status, zohoDc, shapeToken };
