// OWNS      the provider-sign-in doors of P0: GET /api/signin/providers, GET /api/signin/provider/:key/start, GET /api/signin/provider/:key/callback
// FLOW      page ──▶ start (device id, next) ──▶ start row + __Host-cb_sso ──▶ 302 provider ──▶ callback (cookie → row, code exchange, ID token checks, link lookup) ──▶ handoff row ──▶ 302 web #h=<one-time code>
// CALLED BY server.js (mounted at /api/signin BEFORE routes/signin.js) · the web's sign-in page (P1a)
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * routes/signin-provider.js — SEC-112 P0 (P0-DESIGN §5, §6, §8). Routes 1-3 of 13. NO SESSION IS ISSUED HERE: the callback ends in a handoff row and a redirect; the page then POSTs
 * the one-time code with its device id (route 4, P1a), which is the ONLY place a session is opened, through the one existing signer (lib/identity-auth.issueToken).
 *
 * ⭐ A VISIT CANNOT SHOW JSON. start and callback are top-level browser visits, so every refusal is a 302 to the web sign-in page with #e=<CODE>. The code is in the fragment, which a browser never sends anywhere.
 * ⭐ REDIRECTS COME FROM CONFIG (lib/signin-provider redirectUri / webSigninUrl: PUBLIC_API_BASE, PUBLIC_WEB_BASE); the request's Host header is never read.
 * ⭐ THE COOKIE `__Host-cb_sso` (the api's first): HttpOnly, Secure, SameSite=Lax (the provider's redirect is a top-level GET), Path=/, no Domain, 10 minutes, cleared at the callback. It is read ONLY by the callback, and it holds
 *    one 32-byte random reference whose SHA-256 finds the start row; it is not a session and changes no other route's behaviour when present.
 * ⭐ A DEVICE ID IS REQUIRED BEFORE THE REDIRECT (lib/person-session deviceIdOf): without it the session door would mint an unlisted legacy token, so the visit is refused first (#e=NO_DEVICE).
 * ⭐ SINGLE USE: the start row is taken (deleted) at the callback whatever follows; a replayed callback finds nothing (#e=SSO_STATE).
 * ⚠️ NOTHING SECRET IS LOGGED: no code, state, token or reference reaches a log line or an answer; a refusal logs the code word only.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const log = require('../lib/logger');
const { problem } = require('../lib/problem');
const provider = require('../lib/signin-provider');
const pending = require('../lib/signin-pending');
const store = require('../lib/signin-provider-store');
const { deviceIdOf } = require('../lib/person-session');
const { contract } = require('../lib/signin-provider-contract');

const COOKIE = '__Host-cb_sso';
const COOKIE_SECONDS = 600;
const STORE_CHECK_MS = { yes: 30 * 1000, no: 5 * 1000 };
let _store = { at: 0, ok: false };

/** is the pending store there (b879)? cached briefly so the sign-in page's list call is not a query each time */
async function storeThere() {
  const t = Date.now();
  if (_store.at && t - _store.at < (_store.ok ? STORE_CHECK_MS.yes : STORE_CHECK_MS.no)) return _store.ok;
  let ok = false;
  try {
    ok = await pending.available();
  } catch (failure) {
    log.error('signin_provider', { why: 'store check failed: ' + String((failure && failure.code) || 'ERR') });
  }
  _store = { at: t, ok };
  return ok;
}
/** tests only: forget the cached store check */
router._resetStoreCheck = () => {
  _store = { at: 0, ok: false };
};

const noStore = (res) => res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
const cookieOf = (req) => {
  const raw = String((req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim();
  }
  return '';
};
const setCookie = (res, value) =>
  res.append('Set-Cookie', COOKIE + '=' + value + '; Max-Age=' + COOKIE_SECONDS + '; Path=/; HttpOnly; Secure; SameSite=Lax');
const clearCookie = (res) => res.append('Set-Cookie', COOKIE + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
const same = (left, right) => {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** a refusal of a visit: 302 to the web sign-in page with #e=<CODE>; when that page's address is not configured the provider is off, a plain 404 problem */
function refuseVisit(req, res, code) {
  const page = provider.webSigninUrl();
  log.info('signin_provider', { event: 'refused', refusal: code });
  if (!page) return problem(req, res, { status: 404, code: 'PROVIDER_OFF', detail: 'Provider sign-in is not switched on here.' });
  return res.redirect(302, page + '#e=' + encodeURIComponent(code));
}

/* 1 · what exists here */
// @does Nothing in -> we list the outside sign-in providers switched on here (an empty list when none is, or the tables are not ready) -> the providers and whether they are test ones.
router.get('/providers', ...contract.checked('GET /providers'), async (req, res) => {
  noStore(res);
  try {
    if (!(await storeThere())) return res.json({ providers: [], standin: false });
    return res.json(await provider.providers());
  } catch (failure) {
    log.error('signin_provider', { why: 'list failed: ' + String((failure && failure.code) || 'ERR') });
    return res.json({ providers: [], standin: false }); // a fault hides the buttons; it never breaks the sign-in page
  }
});

/* 2 · start: a top-level visit from the page */
// @does A provider key, this device's id and a page to return to -> we write a one-use start row and send the browser to the provider (or back to the sign-in page with a reason) -> a redirect.
router.get('/provider/:key/start', ...contract.checked('GET /provider/:key/start'), async (req, res) => {
  noStore(res);
  const row = provider.rowOf(req.params.key);
  if (!row) return problem(req, res, { status: 404, code: 'PROVIDER_UNKNOWN', detail: 'That sign-in provider does not exist.' });
  if (!provider.configured(row) || !(await storeThere())) return refuseVisit(req, res, 'PROVIDER_OFF');
  const device = deviceIdOf(req.query.device_id);
  if (!device) return refuseVisit(req, res, 'NO_DEVICE');
  const next = provider.nextOf(req.query.next);
  if (!next) return refuseVisit(req, res, 'BAD_NEXT');
  try {
    const started = await provider.authRequest(row.key);
    const ref = provider.randomRef();
    await pending.put('start', ref, { provider: row.key, state: started.state, nonce: started.nonce, verifier: started.verifier, device_id: device, intent: 'signin', next });
    setCookie(res, ref);
    return res.redirect(302, started.url);
  } catch (failure) {
    log.error('signin_provider', { why: 'start failed: ' + String((failure && failure.code) || (failure && failure.name) || 'ERR'), provider: row.key });
    return refuseVisit(req, res, 'PROVIDER_OFF');
  }
});

/* 3 · callback: the provider sends the person back */
// @does The provider's answer and the start cookie -> we check the answer end to end, spend the start row, find any links and keep a 60-second handoff -> a redirect to the sign-in page with a one-time code (or a reason).
router.get('/provider/:key/callback', ...contract.checked('GET /provider/:key/callback'), async (req, res) => {
  noStore(res);
  res.set('Referrer-Policy', 'no-referrer');
  clearCookie(res);
  const row = provider.rowOf(req.params.key);
  if (!row) return problem(req, res, { status: 404, code: 'PROVIDER_UNKNOWN', detail: 'That sign-in provider does not exist.' });
  if (!provider.configured(row) || !(await storeThere())) return refuseVisit(req, res, 'PROVIDER_OFF');
  const ref = cookieOf(req);
  let started = null;
  try {
    started = ref ? await pending.take('start', ref) : null; // spent here, whatever follows: a replay finds nothing
  } catch (failure) {
    log.error('signin_provider', { why: 'start row read failed: ' + String((failure && failure.code) || 'ERR') });
    return refuseVisit(req, res, 'PROVIDER_OFF');
  }
  if (!started) return refuseVisit(req, res, 'SSO_STATE');
  if (started.provider !== row.key) return refuseVisit(req, res, 'SSO_MIXUP');
  if (typeof req.query.error !== 'string' && !(typeof req.query.state === 'string' && same(req.query.state, started.state))) return refuseVisit(req, res, 'SSO_STATE');
  let claims;
  try {
    claims = await provider.finish(row.key, req.query, started);
  } catch (failure) {
    const code = ['SSO_CANCELLED', 'SSO_MIXUP', 'SSO_TOKEN'].includes(failure && failure.code) ? failure.code : 'PROVIDER_OFF';
    if (code === 'PROVIDER_OFF') log.error('signin_provider', { why: 'finish failed: ' + String((failure && failure.code) || (failure && failure.name) || 'ERR'), provider: row.key });
    return refuseVisit(req, res, code);
  }
  try {
    const links = await store.linksFor(claims);
    const code = provider.randomRef();
    await pending.put('handoff', code, {
      provider: row.key,
      device_id: started.device_id,
      next: started.next,
      claims: { issuer: claims.issuer, tenant: claims.tenant, subject: claims.subject, subject_alt: claims.subject_alt, email: claims.email, email_verified: claims.email_verified, org: claims.org, name: claims.name },
      links: links.map((link) => ({ link_id: link.link_id, identity_id: link.identity_id, entity_id: link.entity_id }))
    });
    return res.redirect(302, provider.webSigninUrl() + '#h=' + encodeURIComponent(code));
  } catch (failure) {
    log.error('signin_provider', { why: 'handoff failed: ' + String((failure && failure.code) || 'ERR'), provider: row.key });
    return refuseVisit(req, res, 'PROVIDER_OFF');
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };
module.exports = router;
