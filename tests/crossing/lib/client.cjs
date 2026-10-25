'use strict';
/**
 * tests/crossing/lib/client.cjs — one signed-in shop, talking to its own installation through the app's own sign-in and routes.
 * OWNS      signIn (ask + verify with the tester code) · the JSON call with a timeout · redaction of the code from anything that gets printed
 * CALLED BY tests/crossing/run.cjs (ctx) · the scenarios · web e2e/lib/crossing.cjs (browser sessions are made the same way)
 * FLOW      signIn(topo, shop, secret) → Shop { key, user_id, installation, base, token, entity_id?, call(method, path, body) }
 * ⚠️ HARD GUARD: assertSignInHost runs BEFORE any request - a host that does not start with 'staging.' (or is not in topology.json) never receives a sign-in.
 * The tester code goes in the verify body only (never a URL or query string), and every error text is redacted before it leaves this file.
 */
const crypto = require('crypto');
const topology = require('./topology.cjs');

const TIMEOUT_MS = 30000;

async function rawCall(base, method, path, token, body, extraHeaders) {
  const headers = Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, extraHeaders || {});
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch (_) {
      json = null;
    }
    return { status: res.status, ok: res.status < 300, body: json || {}, raw: buf, type: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

/** sign a shop in; throws (redacted) when the door says no */
async function signIn(topo, shop, secret) {
  const inst = topo.installations[shop.installation];
  topology.assertSignInHost(topo.base(shop.installation), topo.hosts); // the hard guard, first
  const base = topo.base(shop.installation);
  const asked = await rawCall(base, 'POST', '/api/signin/ask', null, { mode: 'login', user_id: shop.user_id });
  if (asked.status >= 500) throw new Error('sign-in ask answered ' + asked.status + ' for ' + shop.user_id + ' on ' + shop.installation);
  const verified = await rawCall(base, 'POST', '/api/signin/verify', null, { mode: 'login', user_id: shop.user_id, otp: secret.value() });
  if (!verified.ok || !verified.body.token) {
    throw new Error(secret.redact('sign-in refused for ' + shop.user_id + ' on ' + shop.installation + ': HTTP ' + verified.status + ' ' + JSON.stringify(verified.body).slice(0, 200)));
  }
  const client = {
    key: shop.key, user_id: shop.user_id, installation: shop.installation, base, host: inst.host, currency: shop.currency, bridge_id: shop.bridge_id,
    token: verified.body.token,
    call: (method, path, body, headers) => rawCall(base, method, path, verified.body.token, body, headers).catch((err) => { throw new Error(secret.redact(String(err.message || err))); }),
    get: (path) => client.call('GET', path),
    post: (path, body, headers) => client.call('POST', path, body, headers),
    put: (path, body) => client.call('PUT', path, body),
    /** a send carries an Idempotency-Key like the screen's */
    send: (body) => client.call('POST', '/api/chits/send', body, { 'Idempotency-Key': crypto.randomUUID() })
  };
  return client;
}

module.exports = { signIn, rawCall };
