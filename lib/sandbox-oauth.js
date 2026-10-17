'use strict';
/**
 * lib/sandbox-oauth.js — ONE OAuth2 helper for the accounting-platform sandbox trial (QuickBooks · Xero · Zoho Books), LOCAL ONLY.
 * OWNS      the vendor table (authorize · token · scopes · api base), the keys read from .env.sandboxes, the code exchange, the refresh,
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

const REPO = path.join(__dirname, '..');
/** the samples root: beside the repo (C:/dev/samples for C:/dev/chitbridge-api and every C:/dev/wt-* worktree) unless SANDBOX_SAMPLES_DIR says */
const samplesDir = () => process.env.SANDBOX_SAMPLES_DIR || path.resolve(REPO, '..', 'samples');
const tokenFile = (vendor) => path.join(samplesDir(), '.tokens', vendor + '.json');
/** where the keys may be: an explicit file, this checkout, or the main api checkout beside a worktree (never copied anywhere) */
const ENV_FILES = () => (process.env.SANDBOX_ENV_FILE ? [process.env.SANDBOX_ENV_FILE]
  : [path.join(REPO, '.env.sandboxes'), path.resolve(REPO, '..', 'chitbridge-api', '.env.sandboxes')]);

/** Zoho's data centre from ZOHO_DC ("in", "zoho.in", "accounts.zoho.in" or a URL) → its domain suffix; none → null (asked, never a national default) */
function zohoDc() {
  const v = String(process.env.ZOHO_DC || '').trim().toLowerCase();
  const m = /zoho(?:apis)?\.([a-z.]+?)\/?$/.exec(v.replace(/^https?:\/\//, ''));
  if (m) return m[1];
  return /^[a-z]{2,3}(\.[a-z]{2})?$/.test(v) ? v : null;
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
  const file = ENV_FILES().find((f) => fs.existsSync(f));
  if (file) require('dotenv').config({ path: file, override: false, quiet: true });
  return file || null;
}
function vendorOf(v) { const k = String(v || '').toLowerCase(); return Object.prototype.hasOwnProperty.call(VENDORS, k) ? k : null; }
/** a vendor's keys from the environment (read at use, never stored here) */
function keys(vendor) {
  const p = VENDORS[vendor].prefix, env = (k) => String(process.env[p + '_' + k] || '').trim();
  return { id: env('CLIENT_ID'), secret: env('CLIENT_SECRET'), redirect: env('REDIRECT_URI') };
}
/** what is missing before a connect can start, in words; [] = ready */
function missing(vendor) {
  const k = keys(vendor), out = [];
  if (!k.id) out.push('client id'); if (!k.secret) out.push('client secret'); if (!k.redirect) out.push('redirect address');
  if (vendor === 'zoho' && !zohoDc()) out.push('data centre (ZOHO_DC)');
  return out;
}

function authorizeUrl(vendor, state) {
  const V = VENDORS[vendor], k = keys(vendor);
  const q = Object.assign({ client_id: k.id, response_type: 'code', scope: V.scope, redirect_uri: k.redirect, state }, V.extra);
  return V.authorize() + '?' + new URLSearchParams(q).toString();
}

/** POST the token endpoint (authorization_code or refresh_token) → the vendor's JSON; a refusal throws with the vendor's error CODE only */
async function tokenCall(vendor, params) {
  const V = VENDORS[vendor], k = keys(vendor);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const body = Object.assign({}, params);
  if (V.basicAuth) headers.Authorization = 'Basic ' + Buffer.from(k.id + ':' + k.secret).toString('base64');
  else Object.assign(body, { client_id: k.id, client_secret: k.secret });
  const r = await fetch(V.token(), { method: 'POST', headers, body: new URLSearchParams(body).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error(V.name + ' refused the token request (' + (j.error || r.status) + ')'); e.code = 'SANDBOX_TOKEN_REFUSED'; throw e; }
  return j;
}

/** the token file as kept: access + refresh token, when it runs out, and the vendor's own ids (QBO realm, Zoho api domain) */
function shapeToken(vendor, j, prev, extra) {
  const p = prev || {};
  return Object.assign({}, p, extra || {}, {
    vendor, access_token: j.access_token, refresh_token: j.refresh_token || p.refresh_token || null,
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, api_domain: j.api_domain || p.api_domain || null, saved_at: new Date().toISOString() });
}
function readToken(vendor) {
  try { return JSON.parse(fs.readFileSync(tokenFile(vendor), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function saveToken(vendor, t) {
  fs.mkdirSync(path.dirname(tokenFile(vendor)), { recursive: true });
  fs.writeFileSync(tokenFile(vendor), JSON.stringify(t, null, 2), { mode: 0o600 });
  return t;
}

/** the callback's code → the token file. `extra` carries what the redirect itself names (QBO realmId) */
async function exchange(vendor, code, extra) {
  const j = await tokenCall(vendor, { grant_type: 'authorization_code', code: String(code || ''), redirect_uri: keys(vendor).redirect });
  return saveToken(vendor, shapeToken(vendor, j, readToken(vendor), extra));
}
/** a token that is good for at least two more minutes, refreshed (and saved — Xero and QBO rotate the refresh token) when not */
async function freshToken(vendor) {
  const t = readToken(vendor);
  if (!t || !t.access_token) { const e = new Error(VENDORS[vendor].name + ' is not connected yet — open /api/sandbox and press Connect.'); e.code = 'SANDBOX_NOT_CONNECTED'; throw e; }
  if (Number(t.expires_at || 0) - Date.now() > 120000) return t;
  if (!t.refresh_token) { const e = new Error(VENDORS[vendor].name + ' gave no refresh token — connect again.'); e.code = 'SANDBOX_NO_REFRESH'; throw e; }
  const j = await tokenCall(vendor, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return saveToken(vendor, shapeToken(vendor, j, t));
}
/** connected / not, and what is missing — never a secret, never a token */
function status(vendor) {
  const t = readToken(vendor);
  return { vendor, name: VENDORS[vendor].name, connected: !!(t && t.refresh_token), saved_at: (t && t.saved_at) || null, missing: missing(vendor) };
}

module.exports = { VENDORS, VENDOR_KEYS, samplesDir, tokenFile, loadKeys, vendorOf, keys, missing, authorizeUrl, exchange, freshToken, readToken, saveToken, status, zohoDc };
