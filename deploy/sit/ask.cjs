#!/usr/bin/env node
/**
 * deploy/sit/ask.cjs - the on-demand TLS gate Caddy asks before it requests a certificate (Caddyfile: on_demand_tls ask).
 * OWNS      the yes/no for "may a certificate be issued for this name?" on a SIT installation
 * CALLED BY Caddy, GET http://ask:9123/ask?domain=<name>  (200 = issue, 403 = refuse; the compose network only, nothing publishes the port)
 * FLOW      name -> SIT_HOST itself | ONE label under SIT_HOST that is a handle with a live storefront | ASK_CUSTOM_HOSTS -> else no
 * WHY HERE  the api has no such route, and adding one is an api-surface change (register, round-trip budget); this is a deploy helper that
 *           reads the api's EXISTING public route GET /api/catalogue/:handle (200 = the shop exists and its storefront is on). No new calculation.
 * Fails CLOSED: an api that does not answer, a cache that is full, more than MAX_LOOKUPS_PER_MIN fresh lookups in a minute - all answer no.
 */
'use strict';
const http = require('http');

const PORT = 9123;
const SIT_HOST = String(process.env.SIT_HOST || '').trim().toLowerCase();
const API = String(process.env.ASK_API || 'http://api:3000').replace(/\/+$/, '');
const CUSTOM_HOSTS = new Set(
  String(process.env.ASK_CUSTOM_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);
const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/; // one DNS label; lib/handle.js mints lower-case letters, digits and hyphens
const YES_MS = 5 * 60 * 1000; // a shop that exists stays approved this long without asking the api again
const NO_MS = 60 * 1000; // a refusal is remembered for a minute
const MAX_CACHE = 2000;
const MAX_LOOKUPS_PER_MIN = 30; // the api's public-catalogue limiter is 60 per window per address; stay well under it
const API_TIMEOUT_MS = 4000;

const cache = new Map(); // name -> { ok, until }
let windowStart = 0;
let lookups = 0;

/** may another fresh api lookup go out in this minute? */
function lookupAllowed(now) {
  if (now - windowStart > 60000) {
    windowStart = now;
    lookups = 0;
  }
  lookups += 1;
  return lookups <= MAX_LOOKUPS_PER_MIN;
}

/** the one label in front of SIT_HOST ("acme" for acme.sit-in.example), or '' when the name is not exactly one label deep */
function shopLabel(name) {
  const tail = '.' + SIT_HOST;
  if (!SIT_HOST || !name.endsWith(tail)) return '';
  const label = name.slice(0, -tail.length);
  return HANDLE.test(label) ? label : '';
}

/** does the api have a live storefront for this handle? 200 = yes; 404, any other status, a timeout or an error = no (and says why in the log) */
async function storefrontLive(handle) {
  try {
    const res = await fetch(API + '/api/catalogue/' + encodeURIComponent(handle), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    return res.status === 200;
  } catch (err) {
    console.error('ask: the api did not answer for ' + handle + ' - refusing (' + err.message + ')');
    return false;
  }
}

/** the decision for one name, before the cache */
async function decide(name, now) {
  if (name === SIT_HOST || CUSTOM_HOSTS.has(name)) return true;
  const handle = shopLabel(name);
  if (!handle) return false;
  if (!lookupAllowed(now)) {
    console.error('ask: more than ' + MAX_LOOKUPS_PER_MIN + ' fresh lookups this minute - refusing ' + name);
    return false;
  }
  return storefrontLive(handle);
}

/** cached decision; the cache never grows past MAX_CACHE (when full, the oldest entry goes) */
async function mayIssue(rawName) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name || name.length > 253) return false;
  const now = Date.now();
  const hit = cache.get(name);
  if (hit && hit.until > now) return hit.ok;
  const ok = await decide(name, now);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(name, { ok, until: now + (ok ? YES_MS : NO_MS) });
  console.log('ask: ' + name + ' -> ' + (ok ? 'yes' : 'no'));
  return ok;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://ask');
  if (url.pathname === '/healthz') return res.writeHead(200).end('ok');
  if (url.pathname !== '/ask') return res.writeHead(404).end();
  const ok = await mayIssue(url.searchParams.get('domain'));
  res.writeHead(ok ? 200 : 403).end(ok ? 'yes' : 'no');
});

if (require.main === module) {
  if (!SIT_HOST) {
    console.error('ask: SIT_HOST is not set - refusing to start');
    process.exit(1);
  }
  server.listen(PORT, '0.0.0.0', () => console.log('ask: answering on :' + PORT + ' for ' + SIT_HOST));
}
module.exports = { mayIssue, shopLabel };
