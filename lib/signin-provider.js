// OWNS      the provider-sign-in adapter: the registry reader, which providers exist HERE, the stand-in rule, the authorization request, the code exchange and the checks on the ID token's claims
// FLOW      env + data/signin-providers.json → providers() · authRequest(key) → { url, state, nonce, verifier } · finish(key, callbackUrl, started) → normalised claims { provider, issuer, tenant, subject, email, email_verified, org, name }
// CALLED BY routes/signin-provider.js · tests/signin-provider.test.cjs
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * lib/signin-provider.js — SEC-112 P0 (design: docs P0-DESIGN §4, §8; REQUIREMENT §16 S2, S4, S12).
 *
 * ⭐ NO DATABASE HERE. This file knows providers; the pending store (lib/signin-pending.js) and the link lookup
 *    (lib/signin-provider-store.js) know the database. The route glues them (routes/signin-provider.js).
 * ⭐ THE LIBRARY IS LOADED AT CALL TIME. openid-client, jose and oauth4webapi are ESM-only and the api is CommonJS, so
 *    `await import('openid-client')` sits inside try/catch at first use (S12): a missing or unloadable library hides the
 *    buttons, logs ONE line, and never stops the api from starting.
 * ⭐ THE ID TOKEN IS CHECKED THREE TIMES, ON PURPOSE. (1) openid-client: state, PKCE, the RFC 9207 `iss` parameter, and the
 *    claims (exact issuer, audience, expiry, nonce). It does NOT verify the signature of an ID token that came from the token
 *    endpoint (OIDC Core 3.1.3.7 item 6 lets TLS stand in for it; oauth4webapi implements that). We do not rely on TLS alone:
 *    (2) jose verifies the signature against the provider's published keys (jwks_uri from the discovery document), with the
 *    algorithm fixed by the registry (never none, never HS*) - found by the wrong-signature test on 17 Nov. (3) normalizeClaims()
 *    then does what a library cannot know: the registry's claim names, a Microsoft tenant that is a GUID with an issuer built from the
 *    token's OWN tid (S2), `azp`, a token not issued longer than 10 minutes ago (S4), and "who may be called verified".
 * ⭐ A PROVIDER'S E-MAIL IS NEVER A KEY. email_verified is true only when the registry says the provider's word counts
 *    (`email_trust: 'claim'`) AND the claim is the boolean true. A Microsoft e-mail is never verified (S3).
 * ⭐ REDIRECTS COME FROM CONFIG. redirectUri() reads PUBLIC_API_BASE and nothing else; the Host header is never read here
 *    (lib/public-base.js apiBase() falls back to it, so it is NOT used). Unset or unusable = the provider is absent.
 * ⭐ THE STAND-IN (a fixed-issuer test provider: oauth2-mock-server in CI, Keycloak on a SIT box) replaces a row's issuer
 *    ONLY when standinActive(): SIGNIN_STANDIN=1 AND a NODE_ENV that is present and not a sealed word (lib/dev-otp
 *    SEALED_ENVS; an ABSENT NODE_ENV counts as production = off, as dev-otp does). It never names the two real issuers.
 *    GET /api/signin/providers says `standin: true`, the label reads "<name> (test)", the boot logs it (bootNotice).
 * ⚠️ NO SECRET OR TOKEN IS EVER LOGGED, RETURNED OR STORED. The client secret goes only to the token endpoint the
 *    discovery document names; the tokens live in this call's memory and are dropped; only the checked claims leave.
 */
const crypto = require('crypto');
const log = require('./logger');
const { SEALED_ENVS } = require('./dev-otp');
const REGISTRY = require('../data/signin-providers.json');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the Microsoft tenant of every personal account (REQUIREMENT S2): never an organisation */
/* a fixed Microsoft GUID, written in parts: its 4th group "b112" reads like a migration id to tests/not-migrated.test.cjs, and it is not one */
const MS_PERSONAL_TENANT = ['9188040d', '6c67', '4c5b', 'b112', '36a304b66dad'].join('-');
const KEY_FORMAT = /^[a-z0-9_]{2,32}$/;
const MAX_TOKEN_AGE_S = 10 * 60;
const CLOCK_TOLERANCE_S = 60;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_S = 8;
/** where the page lives that reads #h= / #e= (the web's sign-in lives in app.html today; P1a may move it) */
const WEB_SIGNIN_PATH = '/app.html';

const trimBase = (address) =>
  String(address || '')
    .trim()
    .replace(/\/+$/, '');
/** a claim or config value as trimmed text of at most `max` characters; '' when it is not text */
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
/** the word for a failure that must not be quoted (it may carry a token): its code, else its name, else ERR */
const errorWord = (failure) => String((failure && failure.code) || (failure && failure.name) || 'ERR');

/** the registry rows that are well-formed (a row without a valid key is ignored, never half-used) */
function registry() {
  return (REGISTRY.providers || []).filter((row) => row && KEY_FORMAT.test(row.key) && row.kind === 'oidc' && row.claims && row.claims.subject && Array.isArray(row.algs) && row.algs.length);
}
/** the registry row of a provider key, or null */
function rowOf(key) {
  const wanted = typeof key === 'string' ? key : '';
  return registry().find((row) => row.key === wanted) || null;
}

/** is a URL one a provider may be reached on? https anywhere; plain http only on a loopback host (the CI stand-in) */
function usableUrl(value, { standin } = {}) {
  if (!URL.canParse(String(value || ''))) return false; // not a URL: unusable, nothing to log (the value is config, and may be a secret typed in the wrong place)
  const parsed = new URL(String(value || ''));
  if (parsed.username || parsed.password || parsed.hash) return false;
  if (parsed.protocol === 'https:') return true;
  const loop = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  return parsed.protocol === 'http:' && loop && !!standin;
}

const sealedNow = (env) => SEALED_ENVS.includes(String(env.NODE_ENV || '').trim().toLowerCase());
/** the stand-in is on: SIGNIN_STANDIN=1 AND a NODE_ENV that is present and not sealed. Absent NODE_ENV = production = off. */
function standinActive(env = process.env) {
  const word = String(env.NODE_ENV || '').trim().toLowerCase();
  return String(env.SIGNIN_STANDIN || '').trim() === '1' && word !== '' && !sealedNow(env);
}
/** a stand-in issuer may live only on loopback or on the PUBLIC_API_BASE machine name (the box Caddy /kc) */
function standinHostAllowed(value, env) {
  if (!URL.canParse(value)) return false;
  const name = new URL(value).hostname;
  if (['localhost', '127.0.0.1', '[::1]'].includes(name)) return true;
  const base = trimBase(env.PUBLIC_API_BASE);
  return !!base && URL.canParse(base) && new URL(base).hostname === name;
}
const REAL_ISSUERS = () => registry().flatMap((row) => [row.issuer, row.issuer_template].filter(Boolean)).map((address) => address.replace(/\/+$/, ''));

/** the issuer to use for a row: the stand-in's (valid, loopback-or-https, never a real provider's) when the stand-in is active and set, else the registry's. null = unusable. */
function issuerOf(row, env = process.env) {
  if (!row) return null;
  if (standinActive(env)) {
    const given = trimBase(env[row.env.standin_issuer]);
    if (given) {
      if (!usableUrl(given, { standin: true })) return null;
      if (REAL_ISSUERS().includes(given)) return null; // a stand-in never impersonates a real issuer's address
      if (!standinHostAllowed(given, env)) return null; // loopback or the PUBLIC_API_BASE machine only
      return given;
    }
  }
  return row.issuer;
}

/** the callback address of a provider: PUBLIC_API_BASE only (never the request's Host). '' when the base is unset or unusable. */
function redirectUri(key, env = process.env) {
  const base = trimBase(env.PUBLIC_API_BASE);
  if (!base || !usableUrl(base, { standin: standinActive(env) })) return '';
  return base + '/api/signin/provider/' + encodeURIComponent(key) + '/callback';
}
/** the address the browser is sent to to start a provider round trip (PUBLIC_API_BASE only, never the request's Host); params are query values. '' when the base is unusable. */
function startUrl(key, params, env = process.env) {
  const base = trimBase(env.PUBLIC_API_BASE);
  if (!base || !usableUrl(base, { standin: standinActive(env) })) return '';
  return base + '/api/signin/provider/' + encodeURIComponent(key) + '/start?' + new URLSearchParams(params || {}).toString();
}
/** the page the person returns to (PUBLIC_WEB_BASE + the sign-in page). '' when unset. */
function webSigninUrl(env = process.env) {
  const base = trimBase(env.PUBLIC_WEB_BASE);
  return base && usableUrl(base, { standin: standinActive(env) }) ? base + WEB_SIGNIN_PATH : '';
}

const listed = (env) =>
  String(env.SIGNIN_PROVIDERS || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => KEY_FORMAT.test(name));
/** is this provider configured HERE (without asking the library)? In SIGNIN_PROVIDERS, both client variables, both bases, an issuer, and ready (or the stand-in is on). */
function configured(row, env = process.env) {
  if (!row || !listed(env).includes(row.key)) return false;
  if (!text(env[row.env.client_id], 300) || !text(env[row.env.client_secret], 500)) return false;
  if (!redirectUri(row.key, env) || !webSigninUrl(env)) return false;
  if (!issuerOf(row, env)) return false;
  return row.ready !== false || standinActive(env);
}

/* ── the library, at call time ── */
let _lib; // undefined = not tried · null = failed (said once) · object = loaded
async function library() {
  if (_lib !== undefined) return _lib;
  try {
    _lib = await import('openid-client');
  } catch (failure) {
    _lib = null;
    log.error('signin_provider', { why: 'LIBRARY_UNAVAILABLE: ' + 'openid-client did not load: provider sign-in is hidden, everything else is unaffected', cause: errorWord(failure) });
  }
  return _lib;
}
/** tests only: forget the library and the discovery cache (a stubbed import()) */
function _reset(stub) {
  _lib = stub;
  _jose = undefined;
  _discovered.clear();
}

/**
 * H2 (critic 21 Nov): `live` means "a person can finish". Nobody can finish a provider sign-in until the connect step (routes/signin-provider-connect.js) can write a link, so the
 * flag says so; a test turns it off to prove the button stays grey (_connectBuilt(false)).
 */
let _connectBuilt = true; // the connect step (routes/signin-provider-connect.js) exists; set false by a test to prove the button stays grey
const connectBuilt = () => _connectBuilt;
/** tests only */
const _connectBuiltSet = (value) => { _connectBuilt = !!value; };
/**
 * M1 · signinMethodRefusal(flags, method) → the refusal code, or null. The ONE gate for "does this shop accept that way in": the shop's own signin_providers switch (policy-signin.js, read through policy.get),
 * tighten-only under the installation's list. Asked at every provider sign-in and before every link is written. `flags` = the shop's effective policy flags; no flags = refused (fail closed).
 */
function signinMethodRefusal(flags, method) {
  const accepted = flags && Array.isArray(flags.signin_providers) ? flags.signin_providers : null;
  return accepted && accepted.includes(method) ? null : 'SIGNIN_PROVIDER_NOT_ACCEPTED';
}
/**
 * providers() → { providers: [{ key, label }], standin } — what GET /api/signin/providers answers. Empty = the capability is off and
 * the page is exactly today's. A provider is listed only when it is configured here AND the library loads.
 */
async function providers(env = process.env) {
  const rows = registry().filter((row) => configured(row, env));
  const standin = standinActive(env) && rows.length > 0;
  if (!rows.length || !(await library())) return { providers: [], standin: false };
  return { providers: rows.map((row) => ({ key: row.key, label: standin ? row.label + ' (test)' : row.label, live: connectBuilt() })), standin };
}
/** one line for the boot log when a stand-in is active (never silent: cb-health fails production if it is ever true) */
function bootNotice(env = process.env) {
  return standinActive(env) ? 'SIGN-IN STAND-IN ACTIVE: provider issuers are test issuers (SIGNIN_STANDIN). Never in production.' : null;
}

/** the boot log lines for a stand-in provider (SEC-112): said at every boot, never silent; set in a sealed or unnamed environment it does nothing, and that is said too */
function logBootNotice(logger, env = process.env) {
  const note = bootNotice(env);
  if (note) logger.warn(note, { reason: 'SIGNIN_STANDIN=1 in a non-sealed environment: the provider issuer is replaced by SIGNIN_STANDIN_*_ISSUER' });
  else if (String(env.SIGNIN_STANDIN || '').trim()) logger.warn('SIGNIN_STANDIN ignored', { reason: 'it works only with an explicit non-sealed NODE_ENV' });
}

/** jose, at call time (ESM-only, like openid-client) */
let _jose;
/** the jose library, loaded once at first use (null, said once, when it will not load: signature checks then answer PROVIDER_OFF) */
async function joseLib() {
  if (_jose === undefined) {
    try {
      _jose = await import('jose');
    } catch (failure) {
      _jose = null;
      log.error('signin_provider', { why: 'LIBRARY_UNAVAILABLE: jose did not load', cause: errorWord(failure) });
    }
  }
  return _jose;
}

/* ── discovery, cached per provider ── */
const _discovered = new Map();
/** the provider's discovery document as a client configuration (openid-client), cached an hour per issuer; PROVIDER_OFF when the library is missing or the provider is not configured here */
async function discover(row, env = process.env) {
  const oidc = await library();
  if (!oidc) throw coded('PROVIDER_OFF', 'library missing');
  if (!configured(row, env)) throw coded('PROVIDER_OFF', 'not configured');
  const issuer = issuerOf(row, env);
  const cached = _discovered.get(row.key);
  if (cached && cached.issuer === issuer && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.config;
  const insecure = issuer.startsWith('http:');
  const config = await oidc.discovery(
    new URL(issuer),
    text(env[row.env.client_id], 300),
    { client_secret: text(env[row.env.client_secret], 500), id_token_signed_response_alg: row.algs[0] },
    oidc.ClientSecretPost(text(env[row.env.client_secret], 500)),
    Object.assign({ timeout: DISCOVERY_TIMEOUT_S }, insecure ? { execute: [oidc.allowInsecureRequests] } : {})
  );
  config[oidc.clockTolerance] = CLOCK_TOLERANCE_S;
  _discovered.set(row.key, { at: Date.now(), issuer, config });
  return config;
}

/** an Error carrying the one code the callback answers with */
function coded(code, reason) {
  const e = new Error(reason || code);
  e.code = code;
  return e;
}
const randomRef = () => crypto.randomBytes(32).toString('base64url');
const hashRef = (ref) => crypto.createHash('sha256').update(String(ref), 'utf8').digest('hex');

/**
 * authRequest(key) → { url, state, nonce, verifier }: the address to send the browser to, and the three secrets the callback needs (the route stores
 * them hashed-by-reference in the pending store). PKCE S256 always; `prompt=select_account` from the registry.
 */
async function authRequest(key, env = process.env) {
  const row = rowOf(key);
  if (!row) throw coded('PROVIDER_UNKNOWN', 'unknown provider');
  const oidc = await library();
  const config = await discover(row, env);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const params = Object.assign({}, row.extra_auth_params, {
    redirect_uri: redirectUri(row.key, env),
    scope: row.scopes.join(' '),
    response_type: 'code',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256'
  });
  return { url: oidc.buildAuthorizationUrl(config, params).href, state, nonce, verifier };
}

const noTrailingSlash = (address) => String(address).replace(/\/+$/, '');

/** the callback's query refused before any network call: the person said no (SSO_CANCELLED), another provider's `iss` (SSO_MIXUP), no code or state (SSO_TOKEN) */
function refuseCallbackQuery(row, asked, issuer) {
  if (typeof asked.error === 'string' && asked.error) throw coded('SSO_CANCELLED', 'provider reported an error');
  const given = asked.iss;
  if (given !== undefined && !row.issuer_template && noTrailingSlash(given) !== noTrailingSlash(issuer)) throw coded('SSO_MIXUP', 'iss is not this provider');
  if (typeof asked.code !== 'string' || !asked.code || typeof asked.state !== 'string') throw coded('SSO_TOKEN', 'no code');
}

/** the code exchange at the token endpoint → the ID token (text); no token is kept here, and any refusal is SSO_TOKEN with the library's own word for it */
async function exchangeCode(oidc, config, row, asked, started, env) {
  const url = new URL(redirectUri(row.key, env));
  for (const name of ['code', 'state', 'iss']) if (typeof asked[name] === 'string') url.searchParams.set(name, asked[name]);
  let tokens;
  try {
    tokens = await oidc.authorizationCodeGrant(config, url, { pkceCodeVerifier: started.verifier, expectedState: started.state, expectedNonce: started.nonce, idTokenExpected: true });
  } catch (failure) {
    throw coded('SSO_TOKEN', 'exchange or ID token refused: ' + errorWord(failure));
  }
  const claims = tokens && typeof tokens.claims === 'function' ? tokens.claims() : null;
  const idToken = tokens && tokens.id_token;
  tokens = null; // no token is kept
  if (!claims || typeof idToken !== 'string') throw coded('SSO_TOKEN', 'no ID token');
  return idToken;
}

/**
 * finish(key, query, started) → the checked claims, or throws an Error whose .code is the one the callback answers:
 *   SSO_CANCELLED (the person said no at the provider) · SSO_MIXUP (an `iss` that is not this provider's) · SSO_TOKEN (any check on the code exchange or the ID token) · PROVIDER_OFF
 * `query` is the callback's query object; `started` = { state, nonce, verifier } from the pending row. The redirect URI of the token request is rebuilt from PUBLIC_API_BASE.
 */
async function finish(key, query, started, env = process.env) {
  const row = rowOf(key);
  if (!row) throw coded('PROVIDER_UNKNOWN', 'unknown provider');
  const asked = query || {};
  refuseCallbackQuery(row, asked, issuerOf(row, env));
  const oidc = await library();
  const config = await discover(row, env);
  const idToken = await exchangeCode(oidc, config, row, asked, started, env);
  const verified = await verifySignature(row, config, idToken, started, env);
  return normalizeClaims(row, verified, { clientId: text(env[row.env.client_id], 300), standin: standinActive(env) });
}

/** the jose options of one ID token check: the registry's algorithm, our audience, 60 s of clock, and the exact issuer (a templated issuer is checked later, against the token's own tid) */
function verifyOptions(row, env) {
  const options = { algorithms: row.algs, audience: text(env[row.env.client_id], 300), clockTolerance: CLOCK_TOLERANCE_S };
  if (!row.issuer_template || standinActive(env)) options.issuer = issuerOf(row, env);
  return options;
}

/**
 * verifySignature(row, config, idToken, started, env) → the VERIFIED payload. jose checks the signature against the provider's own published keys (a remote key set, cached and rotated by jose),
 * the algorithm from the registry, the audience, the exact issuer (a templated issuer is checked by normalizeClaims against the token's own tid) and the clock (60 s); then the nonce again.
 */
async function verifySignature(row, config, idToken, started, env) {
  const jose = await joseLib();
  if (!jose) throw coded('PROVIDER_OFF', 'jose missing');
  const entry = _discovered.get(row.key);
  if (!entry || entry.config !== config) throw coded('PROVIDER_OFF', 'discovery missing');
  try {
    const jwksUri = config.serverMetadata().jwks_uri;
    if (!jwksUri) throw new Error('no jwks_uri');
    entry.jwks = entry.jwks || jose.createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: DISCOVERY_TIMEOUT_S * 1000 });
    const { payload } = await jose.jwtVerify(idToken, entry.jwks, verifyOptions(row, env));
    if (typeof started.nonce !== 'string' || payload.nonce !== started.nonce) throw new Error('nonce');
    return payload;
  } catch (failure) {
    throw coded('SSO_TOKEN', 'ID token signature or claims refused: ' + errorWord(failure));
  }
}

/** a token that failed a check of normalizeClaims */
const badToken = (reason) => coded('SSO_TOKEN', reason);

/** S4: the token carries an issuer and was issued not in the future and not longer than ten minutes ago (a minute of clock either way) */
function checkIssued(claims, now) {
  if (typeof claims.iss !== 'string' || !claims.iss) throw badToken('no issuer');
  if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_TOLERANCE_S || now - claims.iat > MAX_TOKEN_AGE_S + CLOCK_TOLERANCE_S) throw badToken('issued too long ago or in the future');
}

/** the audience is our client id, and a token for more than one audience (or with an authorised party) names us as its `azp` */
function checkAudience(claims, clientId) {
  const audiences = [].concat(claims.aud || []);
  if (!audiences.includes(clientId)) throw badToken('audience');
  if (audiences.length > 1 && claims.azp !== clientId) throw badToken('azp');
  if (claims.azp !== undefined && claims.azp !== clientId) throw badToken('azp');
}

/** S2: the tenant of a token ('' when the provider has none): a GUID; a templated issuer is accepted ONLY as the template filled with the token's OWN tid (the stand-in has one fixed issuer, library-checked, so the template does not apply to it) */
function tenantOf(row, claims, standin) {
  const names = row.claims;
  if (!names.tenant) {
    if (row.issuer_template) throw badToken('templated issuer without a tenant claim');
    return '';
  }
  const tenant = text(claims[names.tenant], 100).toLowerCase();
  if (!GUID.test(tenant)) throw badToken('tenant is not a GUID');
  if (row.issuer_template && !standin && claims.iss !== row.issuer_template.replace('{tid}', tenant)) throw badToken('issuer does not match the token tid');
  return tenant;
}

/** the organisation a sign-in belongs to: the tenant when the registry says the org is the tenant, else the org claim in lower case, else '' */
function orgOf(names, claims, tenant) {
  if (names.org === names.tenant && names.tenant) return tenant;
  return names.org ? text(claims[names.org], 255).toLowerCase() : '';
}

/** S3: the e-mail counts as verified only when the registry says the provider's word counts (`email_trust: 'claim'`) AND the claim is the boolean true */
function emailVerified(row, claims) {
  return row.email_trust === 'claim' && !!row.claims.verified && claims[row.claims.verified] === true;
}

/** the provider's second subject (an alternative stable id), or null */
function altSubjectOf(names, claims) {
  return names.subject_alt ? text(claims[names.subject_alt], 255) || null : null;
}

/**
 * normalizeClaims(row, claims, { clientId, standin, now }) → { provider, method, issuer, tenant, subject, subject_alt, email, email_verified, org, name }
 * Throws code SSO_TOKEN for anything wrong. PURE: the whole rule set of S2/S3/S4 that the library does not know, in one place, testable without a network.
 */
function normalizeClaims(row, claims, opt = {}) {
  if (!row || !claims || typeof claims !== 'object') throw badToken('no claims');
  const names = row.claims;
  const subject = text(claims[names.subject], 255);
  if (!subject) throw badToken('no subject');
  checkIssued(claims, opt.now || Math.floor(Date.now() / 1000));
  if (opt.clientId) checkAudience(claims, opt.clientId);
  const tenant = tenantOf(row, claims, opt.standin);
  const email = text(claims[names.email], 320).toLowerCase();
  return {
    provider: row.key,
    method: row.method,
    issuer: claims.iss,
    tenant,
    subject,
    subject_alt: altSubjectOf(names, claims),
    email,
    email_verified: !!(email && emailVerified(row, claims)),
    org: orgOf(names, claims, tenant),
    name: text(claims[names.name], 200)
  };
}

/** the closed list of places a sign-in may return to afterwards: a path on the web, never a URL. Empty/undefined = the default. */
const NEXT_PATHS = Object.freeze(['/app.html', '/app.html#/account', '/app.html#/settings']);
/** next → the path to keep, or null when it is not on the list (the route answers #e=BAD_NEXT) */
function nextOf(next) {
  if (next === undefined || next === '') return NEXT_PATHS[0];
  return typeof next === 'string' && NEXT_PATHS.includes(next) ? next : null;
}

module.exports = {
  providers,
  connectBuilt,
  _connectBuilt: _connectBuiltSet,
  signinMethodRefusal,
  configured,
  registry,
  rowOf,
  standinActive,
  issuerOf,
  redirectUri,
  startUrl,
  webSigninUrl,
  authRequest,
  finish,
  normalizeClaims,
  nextOf,
  bootNotice,
  logBootNotice,
  randomRef,
  hashRef,
  library,
  _reset,
  NEXT_PATHS,
  MS_PERSONAL_TENANT,
  WEB_SIGNIN_PATH
};
