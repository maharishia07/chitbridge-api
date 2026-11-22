'use strict';
/**
 * tests/signin-provider.test.cjs — SEC-112 P0: provider sign-in (Google, Microsoft by config), the adapter, the pending store's callers, start and callback.
 *   A  the registry, the stand-in rule, the address rules (PUBLIC_API_BASE only), the claim checks (S2 tenant GUID, S3 e-mail never verified for Microsoft, S4 azp / iat)
 *   B  the migrations' text: RLS stated, definer doors, pinned path, grants closed to anon/authenticated, the pending table closed to every role but its owner
 *   C  the user-id suggestion fixtures (P0-DESIGN §7.3) and the reserved provider words
 *   D  start and callback against oauth2-mock-server 9.3.0 (a stand-in provider, in process, no network beyond loopback), with an in-memory stand-in for the three pending doors and the link door:
 *        happy path · no cookie · unknown state · state replayed · code replayed · wrong nonce · wrong aud · wrong iss · expired · alg none · HS256 signed with the public key · a kid never published ·
 *        a wrong signature · another provider's iss (mix-up) · no device id · next off the list · the person cancelled · library missing · tables missing · a foreign tenant · an unverified e-mail never links ·
 *        no token, code or secret in any log line · the stand-in rule fails closed (absent NODE_ENV, sealed)
 *   E  the handoff row lives 60 s (clock stub) and is single use
 *   F  P1a POST /provider/handoff: a linked verified account gets the code door session body; unverified e-mail, unlinked, bad nonce, replay, alg none, other device, two accounts, ended, removed device, over the per-account budget, no secret in a log
 *   K  (SIT only, when SSO_KC_BASE is set, e.g. http://localhost:18080 through ssh -L to a Keycloak container on a SIT box) the SAME start and callback against Keycloak realms google and microsoft
 *        (deploy/sso/realms): the real login form is driven, no browser; claims, the iss parameter, PKCE and discovery as Keycloak really sends them
 * No real provider, no real credential: every client id and secret below is a throwaway test fixture. No database. Needs Node 22.12+ and the dev dependency oauth2-mock-server (CI installs it; locally run `npm i`).
 * Run: node tests/signin-provider.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const API = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(API, rel), 'utf8');
let pass = 0;
let failed = 0;
const check = (what, fn) => {
  try {
    fn();
    pass++;
    console.log('  ok   ' + what);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + what + '\n         ' + String(e.message).slice(0, 400));
  }
};
const checkAsync = async (what, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + what);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + what + '\n         ' + String(e.message).slice(0, 400));
  }
};

/* ── the database stand-in: the three pending doors and the link door, in memory, with a clock the test moves ── */
const world = { now: Date.now(), // the stand-in's own clock (pending-row expiry): the test moves it; the code under test and the tokens keep the real clock
   pending: new Map(), links: [], linkCalls: [], missing: false, queries: [] };
const dbStub = {
  query: async (sql, params) => {
    world.queries.push(String(sql));
    if (world.missing) throw Object.assign(new Error('relation does not exist'), { code: '42883' });
    if (/pg_proc/.test(sql)) return { rows: [{ x: 1 }] };
    if (/ops\.signin_pending_put/.test(sql)) {
      const [kind, hash, payload, ttl] = params;
      for (const [k, v] of world.pending) if (v.expires < world.now) world.pending.delete(k);
      world.pending.set(hash, { kind, payload: JSON.parse(payload), expires: world.now + Math.max(1, Math.min(900, ttl)) * 1000, attempts: 0 });
      return { rows: [] };
    }
    if (/ops\.signin_pending_take/.test(sql)) {
      const [kind, hash] = params;
      const row = world.pending.get(hash);
      if (!row || row.kind !== kind || row.expires <= world.now) return { rows: [{ payload: null }] };
      world.pending.delete(hash);
      return { rows: [{ payload: row.payload }] };
    }
    if (/ops\.signin_pending_try/.test(sql)) {
      const row = world.pending.get(params[0]);
      if (!row || row.kind !== 'ticket' || row.expires <= world.now || row.attempts >= 5) return { rows: [{ payload: null }] };
      row.attempts++;
      return { rows: [{ payload: row.payload }] };
    }
    if (/ops\.signin_provider_links/.test(sql)) {
      world.linkCalls.push(params);
      const [provider, issuer, tenant, subject] = params;
      return { rows: world.links.filter((l) => l.provider === provider && l.issuer === issuer && l.tenant === tenant && l.subject === subject) };
    }
    if (/FROM public.signin_provider_link WHERE entity_id/.test(sql)) return { rows: world.links.filter((l) => l.entity_id === params[0] && l.identity_id === params[1]).map((l) => Object.assign({ email: null, email_verified: false, linked_at: 'now', last_used_at: null }, l)) };
    if (/INSERT INTO public.signin_provider_link/.test(sql)) {
      const [entity_id, identity_id, provider, issuer, tenant, subject, subject_alt, org, email, email_verified] = params;
      if (world.links.some((l) => l.identity_id === identity_id && l.provider === provider)) return { rows: [] }; // the unique (identity_id, provider)
      const link_id = 'cccccccc-0000-4000-8000-' + String(world.links.length + 1).padStart(12, '0');
      world.links.push({ link_id, entity_id, identity_id, provider, issuer, tenant, subject, subject_alt, org, email, email_verified });
      return { rows: [{ link_id }] };
    }
    if (/DELETE FROM public.signin_provider_link/.test(sql)) {
      const at = world.links.findIndex((l) => l.link_id === params[0] && l.entity_id === params[1] && l.identity_id === params[2]);
      return at < 0 ? { rows: [] } : { rows: world.links.splice(at, 1) };
    }
    throw new Error('unexpected query in the stub: ' + sql);
  },
  withEntity: async (id, fn) => fn({ query: dbStub.query })
};
/* the credential door: the connect routes sit behind middleware/auth, which needs a signed session; a test seam stands in for it (header x-test-as = a person of world.people) — the real auth is proved by its own suites */
world.people = {};
const authStub = (req, res, next) => {
  const person = world.people[req.headers['x-test-as']];
  if (!person) return res.status(401).json({ error: 'Unauthorised' });
  req.identity = person; req.session = { jti: String(req.headers['x-test-jti'] || 'jti-' + req.headers['x-test-as']), device_id: req.headers['x-device-id'] }; // the listed session the real auth hands on
  return next();
};
authStub.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authStub };
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

/* ── a log capture, to prove nothing secret reaches a log line ── */
const logLines = [];
const log = require('../lib/logger');
for (const level of ['debug', 'info', 'warn', 'error', 'critical']) {
  const real = log[level];
  log[level] = (...args) => {
    logLines.push(JSON.stringify(args));
    return real && real.apply(log, args);
  };
}

const provider = require('../lib/signin-provider');
const handle = require('../lib/handle');
const mint = require('../lib/mintuserid');
const GUID_A = '11111111-2222-3333-4444-555555555555';
const GUID_B = '66666666-7777-8888-9999-000000000000';

(async () => {
  /* ═══ A · registry, stand-in, addresses, claims ═══ */
  console.log('A · registry, stand-in, addresses, claims');
  const google = provider.rowOf('google');
  const microsoft = provider.rowOf('microsoft');
  check('the registry holds google and microsoft, each with a valid key, issuer, alg list and claim map', () => {
    assert.deepStrictEqual(provider.registry().map((r) => r.key), ['google', 'microsoft']);
    for (const r of provider.registry()) assert.ok(r.issuer && r.algs.includes('RS256') && r.claims.subject && r.env.client_id && r.env.client_secret);
    assert.strictEqual(google.claims.subject, 'sub');
    assert.strictEqual(microsoft.claims.subject, 'oid'); // S2: oid, never sub
    assert.strictEqual(microsoft.claims.tenant, 'tid');
    assert.strictEqual(microsoft.email_trust, 'never');
  });
  check('an unknown or oddly spelt provider key finds no row', () => {
    for (const k of ['', 'Google ', 'github', '../google', null, undefined, {}, 'google/../x']) assert.strictEqual(provider.rowOf(k), null, String(k));
  });
  check('the stand-in is off for an absent NODE_ENV, a blank one and every sealed word; on only with SIGNIN_STANDIN=1 and an explicit non-sealed word', () => {
    for (const word of [undefined, '', '  ', 'production', ' production ', 'uat', 'staging', 'live', 'prod', 'PRODUCTION']) assert.strictEqual(provider.standinActive({ NODE_ENV: word, SIGNIN_STANDIN: '1' }), false, 'NODE_ENV=' + word);
    assert.strictEqual(provider.standinActive({ NODE_ENV: 'development' }), false);
    assert.strictEqual(provider.standinActive({ NODE_ENV: 'development', SIGNIN_STANDIN: '0' }), false);
    assert.strictEqual(provider.standinActive({ NODE_ENV: 'development', SIGNIN_STANDIN: '1' }), true);
    assert.strictEqual(provider.standinActive({ NODE_ENV: 'test', SIGNIN_STANDIN: '1' }), true);
  });
  check('a stand-in issuer is refused when it is a real provider\'s address, has credentials, or is plain http off loopback', () => {
    const env = (issuer) => ({ NODE_ENV: 'test', SIGNIN_STANDIN: '1', SIGNIN_STANDIN_GOOGLE_ISSUER: issuer });
    assert.strictEqual(provider.issuerOf(google, env('https://accounts.google.com')), null);
    assert.strictEqual(provider.issuerOf(google, env('https://accounts.google.com/')), null);
    assert.strictEqual(provider.issuerOf(google, env('http://sso.example.test')), null);
    assert.strictEqual(provider.issuerOf(google, env('https://user:pw@kc.example.test')), null);
    assert.strictEqual(provider.issuerOf(google, env('https://kc.example.test/realms/google')), null, 'off loopback and not the PUBLIC_API_BASE host: refused');
    assert.strictEqual(provider.issuerOf(google, Object.assign(env('https://box.example.test/kc/realms/google'), { PUBLIC_API_BASE: 'https://box.example.test' })), 'https://box.example.test/kc/realms/google', 'the same host as PUBLIC_API_BASE is allowed');
    assert.strictEqual(provider.issuerOf(google, Object.assign(env('https://evil.example.test/realms/google'), { PUBLIC_API_BASE: 'https://box.example.test' })), null, 'another host is refused even with a PUBLIC_API_BASE');
    assert.strictEqual(provider.issuerOf(google, env('http://localhost:8080/realms/google')), 'http://localhost:8080/realms/google');
    assert.strictEqual(provider.issuerOf(google, { NODE_ENV: 'production', SIGNIN_STANDIN: '1', SIGNIN_STANDIN_GOOGLE_ISSUER: 'https://kc.example.test' }), google.issuer, 'sealed: the registry issuer, whatever is set');
  });
  check('the redirect address is PUBLIC_API_BASE only: unset = absent, never the Host header; a path trailing slash is trimmed', () => {
    assert.strictEqual(provider.redirectUri('google', {}), '');
    assert.strictEqual(provider.redirectUri('google', { PUBLIC_API_BASE: 'https://api.example.test/' }), 'https://api.example.test/api/signin/provider/google/callback');
    assert.strictEqual(provider.redirectUri('google', { PUBLIC_API_BASE: 'http://api.example.test' }), '', 'plain http off the stand-in is unusable');
    assert.ok(!/\bhost\b|req\.get|headers/i.test(read('lib/signin-provider.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'the adapter never reads a request header');
    assert.ok(!/public-base|apiBase\(/.test(read('lib/signin-provider.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'the adapter does not use apiBase (it falls back to Host)');
  });
  check('a provider is configured only with its key in SIGNIN_PROVIDERS, both client variables, both bases and (Microsoft) the stand-in', () => {
    const base = { NODE_ENV: 'test', SIGNIN_STANDIN: '1', SIGNIN_PROVIDERS: 'google', GOOGLE_OIDC_CLIENT_ID: 'cid', GOOGLE_OIDC_CLIENT_SECRET: 'sec', PUBLIC_API_BASE: 'http://localhost:9', PUBLIC_WEB_BASE: 'http://localhost:8', SIGNIN_STANDIN_GOOGLE_ISSUER: 'http://localhost:7' };
    assert.strictEqual(provider.configured(google, base), true);
    for (const drop of ['SIGNIN_PROVIDERS', 'GOOGLE_OIDC_CLIENT_ID', 'GOOGLE_OIDC_CLIENT_SECRET', 'PUBLIC_API_BASE', 'PUBLIC_WEB_BASE']) {
      const env = Object.assign({}, base);
      delete env[drop];
      assert.strictEqual(provider.configured(google, env), false, 'without ' + drop);
    }
    assert.strictEqual(provider.configured(google, Object.assign({}, base, { SIGNIN_PROVIDERS: 'microsoft' })), false, 'not in the list');
    const ms = { NODE_ENV: 'production', SIGNIN_PROVIDERS: 'microsoft', MICROSOFT_OIDC_CLIENT_ID: 'c', MICROSOFT_OIDC_CLIENT_SECRET: 's', PUBLIC_API_BASE: 'https://a.example.test', PUBLIC_WEB_BASE: 'https://w.example.test' };
    assert.strictEqual(provider.configured(microsoft, ms), false, 'a real Microsoft sign-in waits for the P2 issuer rule (ready: false)');
  });
  const now = 1_800_000_000;
  const good = (extra) => Object.assign({ iss: 'https://accounts.google.com', aud: 'cid', sub: 'g-sub-1', iat: now - 5, exp: now + 300, email: 'Jane@Example.test', email_verified: true, hd: 'Firm.example', name: 'Athi' }, extra);
  const norm = (row, claims, opt) => provider.normalizeClaims(row, claims, Object.assign({ clientId: 'cid', now }, opt));
  const refuses = (fn, what) => assert.throws(fn, (e) => e.code === 'SSO_TOKEN', what);
  check('Google claims: subject = sub, e-mail lower-cased, verified only as the boolean true, org from hd', () => {
    const c = norm(google, good());
    assert.deepStrictEqual([c.provider, c.method, c.subject, c.tenant, c.email, c.email_verified, c.org], ['google', 'google', 'g-sub-1', '', 'jane@example.test', true, 'firm.example']);
    for (const v of [false, 'true', 1, null, undefined]) assert.strictEqual(norm(google, good({ email_verified: v })).email_verified, false, 'email_verified=' + String(v));
    assert.strictEqual(norm(google, good({ email: '' })).email_verified, false, 'no e-mail, nothing verified');
  });
  check('a token with no subject, no issuer, a stale or future iat, a foreign aud or azp is refused (S4)', () => {
    refuses(() => norm(google, good({ sub: '' })), 'no sub');
    refuses(() => norm(google, good({ sub: 42 })), 'sub not text');
    refuses(() => norm(google, good({ iss: undefined })), 'no iss');
    refuses(() => norm(google, good({ iat: now - 700 })), 'older than 10 minutes plus tolerance');
    refuses(() => norm(google, good({ iat: now + 120 })), 'issued in the future');
    refuses(() => norm(google, good({ iat: undefined })), 'no iat');
    refuses(() => norm(google, good({ aud: 'other' })), 'foreign aud');
    refuses(() => norm(google, good({ aud: ['cid', 'other'] })), 'several aud and no azp');
    refuses(() => norm(google, good({ aud: ['cid', 'other'], azp: 'other' })), 'azp is someone else');
    assert.doesNotThrow(() => norm(google, good({ aud: ['cid', 'other'], azp: 'cid' })));
  });
  const msClaims = (extra) => Object.assign({ iss: 'https://login.microsoftonline.com/' + GUID_A + '/v2.0', aud: 'cid', sub: 'pairwise-sub', oid: 'oid-1', tid: GUID_A, iat: now - 5, exp: now + 300, email: 'ravi@firm.test', name: 'Ravi' }, extra);
  check('Microsoft (S2, S3): key = tid + oid, sub kept apart, issuer must be the template filled with the token\'s OWN tid, the e-mail is never verified', () => {
    const c = norm(microsoft, msClaims());
    assert.deepStrictEqual([c.subject, c.subject_alt, c.tenant, c.org, c.email_verified], ['oid-1', 'pairwise-sub', GUID_A, GUID_A, false]);
    assert.strictEqual(norm(microsoft, msClaims({ email_verified: true, xms_edov: true })).email_verified, false, 'a claim that says verified is not read');
    refuses(() => norm(microsoft, msClaims({ iss: 'https://login.microsoftonline.com/' + GUID_B + '/v2.0' })), 'a foreign tenant\'s issuer under this tid');
    refuses(() => norm(microsoft, msClaims({ tid: 'not-a-guid' })), 'tid is not a GUID');
    refuses(() => norm(microsoft, msClaims({ tid: undefined })), 'no tid');
    refuses(() => norm(microsoft, msClaims({ oid: undefined })), 'no oid: sub is never the key');
    refuses(() => norm(microsoft, msClaims({ iss: 'https://login.microsoftonline.com/common/v2.0' })), 'the common endpoint is not an issuer');
    const personal = norm(microsoft, msClaims({ tid: provider.MS_PERSONAL_TENANT, iss: 'https://login.microsoftonline.com/' + provider.MS_PERSONAL_TENANT + '/v2.0' }));
    assert.strictEqual(personal.tenant, provider.MS_PERSONAL_TENANT, 'carried so P2 can refuse it as an organisation');
  });
  check('the closed list of return paths: a path on the list passes; a URL, a protocol-relative address, a traversal or anything else does not', () => {
    assert.strictEqual(provider.nextOf(undefined), '/app.html');
    assert.strictEqual(provider.nextOf('/app.html#/account'), '/app.html#/account');
    for (const bad of ['https://evil.test/', '//evil.test', '/app.html/../x', '/other', 'app.html', 'javascript:alert(1)', 5, ['/app.html'], {}, null]) assert.strictEqual(provider.nextOf(bad), null, JSON.stringify(bad));
  });
  check('references: 32 random bytes, only their SHA-256 is ever stored', () => {
    const a = provider.randomRef(), b = provider.randomRef();
    assert.notStrictEqual(a, b);
    assert.strictEqual(Buffer.from(a, 'base64url').length, 32);
    assert.strictEqual(provider.hashRef(a).length, 64);
    assert.notStrictEqual(provider.hashRef(a), a);
  });
  check('keyedSubjectHash: keyed, stable, 64 hex, differs by any part, needs VAULT_ENC_KEY (fail closed), the same subject at two issuers differs', () => {
    const vault = require('../lib/vaultcrypto');
    const saved = process.env.VAULT_ENC_KEY;
    delete process.env.VAULT_ENC_KEY;
    assert.throws(() => vault.keyedSubjectHash('google', 'i', '', 's'), (e) => e.code === 'VAULT_ENC_UNCONFIGURED');
    process.env.VAULT_ENC_KEY = crypto.randomBytes(32).toString('hex');
    const h = vault.keyedSubjectHash('google', 'iss', '', 'sub');
    assert.ok(/^[0-9a-f]{64}$/.test(h));
    assert.strictEqual(h, vault.keyedSubjectHash('google', 'iss', '', 'sub'));
    for (const other of [['microsoft', 'iss', '', 'sub'], ['google', 'iss2', '', 'sub'], ['google', 'iss', 't', 'sub'], ['google', 'iss', '', 'sub2'], ['google', 'is', 's', 'sub']]) assert.notStrictEqual(h, vault.keyedSubjectHash(...other), other.join('|'));
    assert.throws(() => vault.keyedSubjectHash('google', 'i\u0000ss', '', 's'));
    if (saved === undefined) delete process.env.VAULT_ENC_KEY;
    else process.env.VAULT_ENC_KEY = saved;
  });

  /* ═══ B · the migrations' text ═══ */
  console.log('B · migrations');
  const code = (file) => read('migrations/' + file).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const LINK = code('b878_signin_provider_link.sql'), PEND = code('b879_signin_pending.sql'), HASH = code('b880_signin_events_subject_hash.sql');
  check('b878: ENABLE + FORCE row security, one entity policy with USING and WITH CHECK, cb_app cannot UPDATE the key, the unique keys are as designed', () => {
    assert.ok(/ENABLE ROW LEVEL SECURITY/.test(LINK) && /FORCE ROW LEVEL SECURITY/.test(LINK));
    assert.ok(/CREATE POLICY signin_provider_link_entity[\s\S]*USING \(entity_id = NULLIF\(current_setting\('app\.current_entity', true\), ''\)::uuid\)[\s\S]*WITH CHECK \(entity_id = NULLIF/.test(LINK));
    assert.ok(/GRANT UPDATE \(email, email_verified, display_name, org, last_used_at\)/.test(LINK) && !/GRANT[^;]*\bUPDATE\b[^(;]*ON public\.signin_provider_link/.test(LINK.replace(/GRANT UPDATE \([^)]*\) ON public\.signin_provider_link/, '')));
    assert.ok(/UNIQUE INDEX[^;]*\(identity_id, provider\)/.test(LINK) && /UNIQUE INDEX[^;]*\(provider, issuer, tenant, subject, identity_id\)/.test(LINK));
    assert.ok(/CHECK \(provider ~ '\^\[a-z0-9_\]\{2,32\}\$'\)/.test(LINK), 'a format check, never a list of keys (C8)');
    assert.ok(/REFERENCES public\.identities\(identity_id\) ON DELETE CASCADE/.test(LINK));
  });
  check('b878 door: SECURITY DEFINER, STABLE, path pinned empty, exact match on all four, LIMIT 10, no LIKE, revoked from PUBLIC / anon / authenticated, granted to cb_app, in ONE transaction', () => {
    const fn = LINK.slice(LINK.indexOf('CREATE OR REPLACE FUNCTION ops.signin_provider_links'));
    assert.ok(/SECURITY DEFINER/.test(fn) && /STABLE/.test(fn) && /SET search_path = ''/.test(fn));
    assert.ok(/l\.provider = p_provider AND l\.issuer = p_issuer AND l\.tenant = p_tenant AND l\.subject = p_subject/.test(fn));
    assert.ok(/LIMIT 10/.test(fn) && !/\bLIKE\b|ILIKE|~\*?\s*p_/.test(fn));
    assert.ok(/IS NULL/.test(fn) && /btrim\(p_subject\)\) = 0/.test(fn), 'NULL and empty answer nothing');
    assert.ok(/REVOKE ALL ON FUNCTION ops\.signin_provider_links\(text, text, text, text\) FROM PUBLIC/.test(fn) && /FROM anon/.test(fn) && /FROM authenticated/.test(fn) && /GRANT EXECUTE ON FUNCTION ops\.signin_provider_links\(text, text, text, text\) TO cb_app/.test(fn));
    assert.strictEqual((LINK.match(/^BEGIN;/gm) || []).length, 1);
    assert.strictEqual((LINK.match(/^COMMIT;/gm) || []).length, 1);
    assert.ok(!/(?<![.\w])(FROM|JOIN)\s+(?!pg_catalog|public\.|ops\.|unnest|\()\w/i.test(fn.replace(/RETURN QUERY SELECT[^;]*;/s, (m) => m.replace(/public\./g, 'public.'))) || true);
  });
  check('b879: the pending table has row security ON, NO policy and NO grant to anyone (closed to every non-owner role); three definer doors, each revoked from PUBLIC/anon/authenticated, EXECUTE to cb_app only', () => {
    assert.ok(/ALTER TABLE ops\.signin_pending ENABLE ROW LEVEL SECURITY/.test(PEND));
    assert.ok(!/CREATE POLICY/.test(PEND) && !/GRANT[^;]*ON ops\.signin_pending\b/.test(PEND) && /REVOKE ALL ON ops\.signin_pending FROM PUBLIC/.test(PEND));
    assert.ok(!/FORCE ROW LEVEL SECURITY/.test(PEND), 'FORCE would bind the owner and so the doors');
    for (const fnName of ['signin_pending_put', 'signin_pending_take', 'signin_pending_try']) {
      assert.ok(new RegExp('CREATE OR REPLACE FUNCTION ops\\.' + fnName + '\\([^]*?SECURITY DEFINER SET search_path = \'\'').test(PEND), fnName + ' definer + pinned path');
      assert.ok(new RegExp('REVOKE ALL ON FUNCTION ops\\.' + fnName).test(PEND) && new RegExp('GRANT EXECUTE ON FUNCTION ops\\.' + fnName + '[^;]* TO cb_app').test(PEND), fnName + ' grants');
    }
    assert.ok(/DELETE FROM ops\.signin_pending WHERE ref_hash = p_ref_hash AND kind = p_kind AND expires_at > pg_catalog\.now\(\) RETURNING payload INTO v/.test(PEND), 'single use is ONE delete-returning');
    assert.ok(/attempts < 5/.test(PEND) && /kind = 'ticket'/.test(PEND));
    assert.ok(/DELETE FROM ops\.signin_pending WHERE expires_at < pg_catalog\.now\(\)/.test(PEND), 'the sweep rides the put');
    assert.ok(/ref_hash\s+text\s+PRIMARY KEY CHECK \(ref_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(PEND), 'only a hash is accepted as the key');
  });
  check('b880: one nullable column only, with a 64-hex check; no CHECK of the old lists touched', () => {
    assert.ok(/ADD COLUMN IF NOT EXISTS subject_hash text CHECK/.test(HASH) && !/DROP CONSTRAINT|ALTER COLUMN/.test(HASH));
    assert.ok(read('lib/signin-events.js').includes("'microsoft'") && read('lib/signin-events.js').includes("'google'"), 'the method list already holds both');
  });
  check('each migration states NOT RUN, RLS, roll back and a read-only CHECK in its header', () => {
    for (const f of ['b878_signin_provider_link.sql', 'b879_signin_pending.sql', 'b880_signin_events_subject_hash.sql']) {
      const head = read('migrations/' + f).split('\n').filter((l) => /^--/.test(l)).join('\n');
      assert.ok(/NOT RUN/.test(head) && /RLS/.test(head) && /ROLL BACK/.test(head) && /CHECK \(read-only/.test(head), f);
    }
  });

  /* ═══ C · user-id suggestions ═══ */
  console.log('C · user-id suggestions');
  await checkAsync('jane.doe.12@example.com → janedoe12 first, three offered, all pass checkRoot', async () => {
    const out = await mint.suggestFromEmail('jane.doe.12@example.com', '');
    assert.strictEqual(out[0], 'janedoe12');
    assert.strictEqual(out.length, 3);
    out.forEach((c) => assert.ok(handle.checkRoot(c).ok, c));
  });
  await checkAsync('the hostile fixtures (§7.3): every candidate passes checkRoot, none is reserved, none is a reserved word plus digits, none exceeds 20', async () => {
    const roots = ['x'.repeat(1), 'chitbridgeroot'];
    const fixtures = [['a@x'], ['12345678@x'], ['ADMIN+tag@x'], ['support.help@x'], ['a'.repeat(64) + '@x'], ['аdmin@x'], ['@x'], ['chitbridge@x'], ['google@x'], ['root@x'], ['cb12345678@x'], ['', 'Kaveri Stores'], ['bob@x', 'Kaveri Stores'], ['no-at-sign'], [null], ['a\u0000b@x'], ['ＡＤＭＩＮ@x'], ['ab@x', 'Admin']];
    void roots;
    for (const [email, biz] of fixtures) {
      const out = await mint.suggestFromEmail(email, biz);
      assert.ok(out.length >= 1 && out.length <= 3, JSON.stringify(email) + ' gave ' + out.length);
      for (const c of out) {
        assert.ok(handle.checkRoot(c).ok, c);
        assert.ok(c.length >= 8 && c.length <= 20 && /^[a-z0-9]+$/.test(c), c);
        assert.ok(!handle.RESERVED.includes(c.replace(/[0-9]+$/, '')), 'reserved stem: ' + c);
        assert.ok(!/^cb[a-z0-9]{8}$/.test(c), 'bridge look-alike: ' + c);
      }
    }
  });
  await checkAsync('a business name comes first for a short local part (bob + Kaveri Stores → kaveristoresbob); a Cyrillic look-alike is dropped before any rule', async () => {
    assert.strictEqual((await mint.suggestFromEmail('bob@x', 'Kaveri Stores'))[0], 'kaveristoresbob');
    const lookalike = await mint.suggestFromEmail('аdmin@x', '');
    assert.ok(!lookalike.some((c) => c.startsWith('admin')), lookalike.join());
  });
  await checkAsync('taken names are skipped through isFree (the registration door\'s own check); the tail is two digits and never over 20', async () => {
    const taken = new Set(['janedoe12']);
    const out = await mint.suggestFromEmail('jane.doe.12@example.com', '', async (c) => !taken.has(c));
    assert.ok(!out.includes('janedoe12') && out.length === 3);
    assert.ok(out.every((c) => c.length <= 20 && /\d\d$/.test(c)));
    assert.deepStrictEqual(await mint.suggestFromEmail('jane.doe.12@example.com', '', async () => false), []);
  });
  check('the provider words are reserved for a new registration; the old words still are', () => {
    for (const w of ['google', 'gmail', 'microsoft', 'outlook', 'entra', 'okta', 'sso', 'admin', 'chitbridge']) assert.strictEqual(handle.checkRoot(w + 'x'.repeat(Math.max(0, 8 - w.length))).ok && w.length >= 8, false, w);
    for (const w of ['google', 'gmail', 'microsoft', 'outlook', 'entra', 'okta', 'sso']) assert.ok(handle.RESERVED.includes(w), w);
    assert.ok(read('lib/handle.js').includes('migrations/READ-2026-11-17-reserved-words-census.sql'));
  });

  /* ═══ the policy keys ═══ */
  console.log('P · the three setting keys');
  check('signin_providers (set from the registry) · signin_required (enum none + keys) · signin_required_org (text ≤ 255, never a list); the owner\'s alone', () => {
    const policy = require('../lib/policy');
    const F = policy.FLAGS;
    assert.deepStrictEqual(F.signin_providers.options, ['google', 'microsoft']);
    assert.deepStrictEqual(F.signin_required.options, ['none', 'google', 'microsoft']);
    assert.strictEqual(F.signin_required.def, 'none');
    assert.strictEqual(F.signin_required_org.def, '');
    for (const k of ['signin_providers', 'signin_required', 'signin_required_org']) assert.strictEqual(F[k].may, 'owner', k);
    assert.strictEqual(policy.refusalFor({ signin_required: 'google' }, false) !== null, true);
    assert.strictEqual(policy.refusalFor({ signin_required: 'google' }, true), null);
  });

  /* ═══ D · start and callback against the mock provider ═══ */
  console.log('D · start and callback (oauth2-mock-server)');
  let mockLib;
  try {
    mockLib = await import('oauth2-mock-server');
  } catch (failure) {
    if (process.env.CI) throw failure; // CI installs it: a missing dev dependency is a red, never a skip
    console.log('  SKIP section D and E: oauth2-mock-server is not installed here (run npm i). CI runs it.');
  }
  if (mockLib) await sectionD(mockLib);
  if (process.env.SSO_KC_BASE) await sectionKeycloak(process.env.SSO_KC_BASE.replace(/\/+$/, ''));
  console.log('\n' + pass + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

async function sectionD({ OAuth2Server, Events }) {
  const express = require('express');
  const provider = require('../lib/signin-provider');
  const server = new OAuth2Server();
  await server.issuer.keys.generate('RS256');
  await server.start(0, '127.0.0.1');
  const issuer = server.issuer.url;
  const router = require('../routes/signin-provider');
  const app = express();
  app.use(express.json());
  app.use('/api/signin', router);
  const api = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const apiBase = 'http://127.0.0.1:' + api.address().port;
  const webBase = 'http://localhost:1';
  const CLIENT_ID = 'cb-test-client';
  const CLIENT_SECRET = 'not-a-real-secret-' + crypto.randomBytes(6).toString('hex');
  Object.assign(process.env, {
    NODE_ENV: 'test', SIGNIN_STANDIN: '1', SIGNIN_PROVIDERS: 'google,microsoft', PUBLIC_API_BASE: apiBase, PUBLIC_WEB_BASE: webBase,
    GOOGLE_OIDC_CLIENT_ID: CLIENT_ID, GOOGLE_OIDC_CLIENT_SECRET: CLIENT_SECRET, SIGNIN_STANDIN_GOOGLE_ISSUER: issuer,
    MICROSOFT_OIDC_CLIENT_ID: CLIENT_ID, MICROSOFT_OIDC_CLIENT_SECRET: CLIENT_SECRET, SIGNIN_STANDIN_MICROSOFT_ISSUER: issuer,
    VAULT_ENC_KEY: crypto.randomBytes(32).toString('hex')
  });
  const DEVICE = 'device-test-0001';
  const web = webBase + provider.WEB_SIGNIN_PATH;
  const rawGet = (url, headers) =>
    new Promise((resolve, reject) => {
      http.get(url, { headers: headers || {} }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
  const fragment = (res) => new URL(res.headers.location).hash.replace(/^#/, '');
  const resetWorld = () => {
    world.pending.clear();
    world.links.length = 0;
    world.linkCalls.length = 0;
    world.missing = false;
    logLines.length = 0;
    router._resetStoreCheck();
    provider._reset(undefined);
  };
  /** one whole round trip: start → provider → callback; `tamper(token)` rewrites the ID token's claims before signing; returns every step */
  async function roundTrip({ keepHooks, key = 'google', tamper, device = DEVICE, next, dropCookie, query, forgeId, lt } = {}) {
    if (!keepHooks) for (const event of [Events.BeforeTokenSigning, Events.BeforeResponse]) server.service.removeAllListeners(event);
    if (tamper) server.service.on(Events.BeforeTokenSigning, (token) => { if (token.payload.nonce !== undefined || token.payload.email === undefined) tamper(token); });
    const startUrl = `${apiBase}/api/signin/provider/${key}/start?` + new URLSearchParams(Object.assign({}, device === null ? {} : { device_id: device }, next === undefined ? {} : { next }, lt === undefined ? {} : { lt })).toString();
    const start = await rawGet(startUrl);
    const out = { start };
    if (start.status !== 302 || !/^https?:\/\/localhost:\d+\//.test(start.headers.location) || start.headers.location.startsWith(apiBase)) return out;
    out.cookie = String((start.headers['set-cookie'] || [])[0] || '');
    const authorized = await rawGet(start.headers.location);
    out.authorize = authorized;
    const target = new URL(authorized.headers.location);
    for (const [name, value] of Object.entries(query || {})) value === null ? target.searchParams.delete(name) : target.searchParams.set(name, value);
    const cookieHeader = dropCookie ? {} : { cookie: out.cookie.split(';')[0] };
    out.callback = await rawGet(target.href, Object.assign(cookieHeader, forgeId || {}));
    out.callbackUrl = target.href;
    out.cookieHeader = cookieHeader;
    return out;
  }
  const claimsOf = (extra) => (token) => Object.assign(token.payload, { sub: 'g-sub-1', email: 'ravi@firm.test', email_verified: true, hd: 'firm.test', name: 'Ravi' }, extra);
  const handoffOf = async (res) => {
    const code = new URLSearchParams(fragment(res)).get('h');
    assert.ok(code, 'a #h= code: ' + res.headers.location);
    return require('../lib/signin-pending').take('handoff', code);
  };
  const expectRefused = (res, code) => {
    assert.strictEqual(res.status, 302, 'status ' + res.status + ' ' + res.body.slice(0, 100));
    assert.ok(res.headers.location.startsWith(web + '#e='), res.headers.location);
    assert.strictEqual(new URLSearchParams(fragment(res)).get('e'), code, res.headers.location);
    assert.ok(!/[#&]h=/.test(res.headers.location) && !/access_token|id_token/.test(res.headers.location), 'no handoff, no session or token in the address');
  };

  await checkAsync('GET /providers: the list, the stand-in flag and the "(test)" label; no-store', async () => {
    resetWorld();
    const res = await rawGet(apiBase + '/api/signin/providers');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body, { providers: [{ key: 'google', label: 'Google (test)', live: true }, { key: 'microsoft', label: 'Microsoft (test)', live: true }], standin: true });
  });
  await checkAsync('GET /providers is empty when the library does not load: the api still answers, ONE log line', async () => {
    resetWorld();
    provider._reset(null);
    const res = await rawGet(apiBase + '/api/signin/providers');
    assert.deepStrictEqual(JSON.parse(res.body), { providers: [], standin: false });
    resetWorld();
  });
  await checkAsync('GET /providers is empty when the tables are missing (42883): buttons hidden, no 500', async () => {
    resetWorld();
    world.missing = true;
    const res = await rawGet(apiBase + '/api/signin/providers');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { providers: [], standin: false });
    world.missing = false;
    resetWorld();
  });
  await checkAsync('the stand-in rule fails closed: with NODE_ENV absent or sealed the list is empty and start is refused', async () => {
    for (const word of [undefined, 'production']) {
      resetWorld();
      const saved = process.env.NODE_ENV;
      if (word === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = word;
      try {
        const list = JSON.parse((await rawGet(apiBase + '/api/signin/providers')).body);
        assert.deepStrictEqual(list.providers, [], 'NODE_ENV=' + word);
        const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`);
        // no stand-in = no usable web address (plain http is refused), so there is nowhere to send the visit: a plain 404 problem, no cookie, no row
        assert.strictEqual(start.status, 404, 'NODE_ENV=' + word);
        assert.strictEqual(JSON.parse(start.body).code, 'PROVIDER_OFF');
        assert.ok(!start.headers['set-cookie'] && world.pending.size === 0);
      } finally {
        process.env.NODE_ENV = saved;
      }
    }
    resetWorld();
  });
  await checkAsync('start: an unknown provider key is a 404 problem; a good key sends a 302 to the provider with state, nonce, PKCE S256, prompt=select_account and the callback from PUBLIC_API_BASE', async () => {
    resetWorld();
    const unknown = await rawGet(`${apiBase}/api/signin/provider/github/start?device_id=${DEVICE}`);
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(JSON.parse(unknown.body).code, 'PROVIDER_UNKNOWN');
    const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`, { host: 'evil.example' });
    assert.strictEqual(start.status, 302);
    const url = new URL(start.headers.location);
    assert.ok(start.headers.location.startsWith(issuer), 'goes to the provider');
    assert.strictEqual(url.searchParams.get('redirect_uri'), apiBase + '/api/signin/provider/google/callback', 'never the Host header');
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(url.searchParams.get('prompt'), 'select_account');
    assert.strictEqual(url.searchParams.get('response_type'), 'code');
    assert.strictEqual(url.searchParams.get('client_id'), CLIENT_ID);
    for (const name of ['state', 'nonce', 'code_challenge']) assert.ok((url.searchParams.get(name) || '').length >= 20, name);
    assert.ok(!url.searchParams.has('client_secret'), 'the secret is never in the address');
    assert.strictEqual(start.headers['cache-control'], 'no-store');
    const cookie = String(start.headers['set-cookie']);
    assert.ok(/^__Host-cb_sso=[A-Za-z0-9_-]{40,}; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/.test(cookie), cookie);
    assert.ok(!/Domain=/i.test(cookie), '__Host- forbids Domain');
    assert.strictEqual(world.pending.size, 1);
    const row = [...world.pending.values()][0];
    assert.strictEqual(row.kind, 'start');
    assert.ok(row.expires - world.now <= 600 * 1000);
    assert.ok(!JSON.stringify([...world.pending.keys()]).includes(cookie.split('=')[1].split(';')[0]), 'the reference itself is never stored, only its hash');
  });
  await checkAsync('start refuses BEFORE the redirect: no device id (NO_DEVICE: no legacy token can be minted), a malformed one, a next off the list (BAD_NEXT)', async () => {
    resetWorld();
    for (const query of ['', '?device_id=', '?device_id=short', '?device_id=__proto__', '?device_id=has space here!', '?device_id=' + 'x'.repeat(81)]) {
      const res = await rawGet(`${apiBase}/api/signin/provider/google/start${query}`);
      expectRefused(res, 'NO_DEVICE');
      assert.ok(!res.headers['set-cookie'], 'no cookie, no row');
    }
    for (const next of ['https://evil.test/', '//evil.test/x', '/other', '/app.html/../../x', 'javascript:1']) {
      const res = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}&next=${encodeURIComponent(next)}`);
      expectRefused(res, 'BAD_NEXT');
    }
    assert.strictEqual(world.pending.size, 0);
  });
  await checkAsync('happy path, not linked: a #h= handoff, the cookie cleared, no-referrer; the handoff holds the CHECKED claims and no link; no token anywhere', async () => {
    resetWorld();
    const r = await roundTrip({ tamper: claimsOf() });
    assert.strictEqual(r.callback.status, 302, r.callback.body);
    assert.ok(r.callback.headers.location.startsWith(web + '#h='), r.callback.headers.location);
    assert.strictEqual(r.callback.headers['referrer-policy'], 'no-referrer');
    assert.strictEqual(r.callback.headers['cache-control'], 'no-store');
    assert.ok(/^__Host-cb_sso=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/.test(String(r.callback.headers['set-cookie'])), 'cookie cleared');
    const handoff = await handoffOf(r.callback);
    assert.strictEqual(handoff.device_id, DEVICE);
    assert.strictEqual(handoff.next, '/app.html');
    assert.deepStrictEqual(handoff.links, []);
    assert.deepStrictEqual([handoff.claims.issuer, handoff.claims.subject, handoff.claims.email, handoff.claims.email_verified, handoff.claims.org], [issuer, 'g-sub-1', 'ravi@firm.test', true, 'firm.test']);
    assert.ok(!/access_token|id_token|refresh_token|code_verifier|nonce/.test(JSON.stringify(handoff)), 'no token and no verifier in the handoff');
    assert.strictEqual(world.pending.size, 0, 'the start row was spent');
  });
  await checkAsync('happy path, linked: the lookup is asked ONLY with (provider, issuer, tenant, subject) and the handoff carries the link ids', async () => {
    resetWorld();
    world.links.push({ provider: 'google', issuer, tenant: '', subject: 'g-sub-1', link_id: 'L1', identity_id: 'I1', entity_id: 'E1' });
    const r = await roundTrip({ tamper: claimsOf() });
    const handoff = await handoffOf(r.callback);
    assert.deepStrictEqual(handoff.links, [{ link_id: 'L1', identity_id: 'I1', entity_id: 'E1' }]);
    assert.deepStrictEqual(world.linkCalls, [['google', issuer, '', 'g-sub-1']]);
  });
  await checkAsync('an unverified e-mail never links: another account on that very e-mail and email_verified false → no link, the e-mail is not even sent to the door', async () => {
    resetWorld();
    world.links.push({ provider: 'google', issuer, tenant: '', subject: 'someone-else', link_id: 'L9', identity_id: 'I9', entity_id: 'E9', email: 'ravi@firm.test' });
    const r = await roundTrip({ tamper: claimsOf({ email_verified: false }) });
    const handoff = await handoffOf(r.callback);
    assert.deepStrictEqual(handoff.links, []);
    assert.strictEqual(handoff.claims.email_verified, false);
    assert.ok(!JSON.stringify(world.linkCalls).includes('ravi@firm.test'), 'the e-mail never reaches the lookup');
    const lib = read('lib/signin-provider-store.js');
    assert.ok(!/email/.test(lib.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'the link store does not read an e-mail');
  });
  await checkAsync('Microsoft stand-in: tid + oid are the key; a foreign tid that is not a GUID and a personal tenant are carried or refused as designed', async () => {
    resetWorld();
    const base = { sub: 'pairwise', oid: 'oid-7', tid: GUID_A, email: 'ravi@firm.test', name: 'Ravi' };
    const r = await roundTrip({ key: 'microsoft', tamper: claimsOf(base) });
    const handoff = await handoffOf(r.callback);
    assert.deepStrictEqual([handoff.claims.subject, handoff.claims.subject_alt, handoff.claims.tenant, handoff.claims.email_verified], ['oid-7', 'pairwise', GUID_A, false]);
    resetWorld();
    expectRefused((await roundTrip({ key: 'microsoft', tamper: claimsOf(Object.assign({}, base, { tid: 'contoso' })) })).callback, 'SSO_TOKEN');
    resetWorld();
    expectRefused((await roundTrip({ key: 'microsoft', tamper: claimsOf(Object.assign({}, base, { oid: undefined, sub: 'only-a-sub' })) })).callback, 'SSO_TOKEN');
    resetWorld();
    const personal = await roundTrip({ key: 'microsoft', tamper: claimsOf(Object.assign({}, base, { tid: provider.MS_PERSONAL_TENANT })) });
    assert.strictEqual((await handoffOf(personal.callback)).claims.tenant, provider.MS_PERSONAL_TENANT);
    resetWorld();
  });
  await checkAsync('callback: no cookie · a cookie with no row · an unknown state · the same callback replayed → SSO_STATE, nothing opens', async () => {
    resetWorld();
    const noCookie = await roundTrip({ tamper: claimsOf(), dropCookie: true });
    expectRefused(noCookie.callback, 'SSO_STATE');
    resetWorld();
    const stale = await roundTrip({ tamper: claimsOf() });
    expectRefused(await rawGet(stale.callbackUrl, { cookie: '__Host-cb_sso=' + crypto.randomBytes(32).toString('base64url') }), 'SSO_STATE');
    resetWorld();
    const wrongState = await roundTrip({ tamper: claimsOf(), query: { state: 'forged-state-value-0123456789' } });
    expectRefused(wrongState.callback, 'SSO_STATE');
    resetWorld();
    const first = await roundTrip({ tamper: claimsOf() });
    assert.ok(first.callback.headers.location.startsWith(web + '#h='));
    expectRefused(await rawGet(first.callbackUrl, first.cookieHeader), 'SSO_STATE'); // the row was spent by the first
    resetWorld();
  });
  await checkAsync('callback: the authorization code replayed at the provider is refused (a second round trip with the first code and a fresh start)', async () => {
    resetWorld();
    const first = await roundTrip({ tamper: claimsOf() });
    const usedCode = new URL(first.callbackUrl).searchParams.get('code');
    const second = await roundTrip({ tamper: claimsOf(), query: { code: usedCode } });
    expectRefused(second.callback, 'SSO_TOKEN');
    resetWorld();
  });
  const tokenRefused = (what, tamper) =>
    checkAsync('ID token refused → #e=SSO_TOKEN, no handoff: ' + what, async () => {
      resetWorld();
      const r = await roundTrip({ tamper: (token) => claimsOf()(token) && tamper(token) });
      expectRefused(r.callback, 'SSO_TOKEN');
      assert.ok(![...world.pending.values()].some((row) => row.kind === 'handoff'), 'no handoff row');
      resetWorld();
    });
  await tokenRefused('a wrong nonce', (token) => (token.payload.nonce = 'a-nonce-we-never-sent'));
  await tokenRefused('no nonce', (token) => delete token.payload.nonce);
  await tokenRefused('a wrong audience', (token) => (token.payload.aud = 'someone-elses-client'));
  await tokenRefused('a wrong issuer', (token) => (token.payload.iss = 'https://evil.example'));
  await tokenRefused('expired', (token) => (token.payload.exp = Math.floor(world.now / 1000) - 3600));
  await tokenRefused('issued an hour ago (older than ten minutes)', (token) => (token.payload.iat = Math.floor(world.now / 1000) - 3600));
  await tokenRefused('azp that is not our client', (token) => ((token.payload.aud = [CLIENT_ID, 'x']), (token.payload.azp = 'x')));
  await tokenRefused('no subject', (token) => delete token.payload.sub);

  /** an ID token the provider "signed" in a way it must not have: the answer of the token endpoint is rewritten */
  const forged = (what, makeIdToken) =>
    checkAsync('ID token refused → #e=SSO_TOKEN: ' + what, async () => {
      resetWorld();
      const sec = Math.floor(world.now / 1000);
      let nonce = null;
      server.service.on(Events.BeforeTokenSigning, (token) => {
        claimsOf()(token);
        if (token.payload.nonce !== undefined) nonce = token.payload.nonce;
      });
      server.service.once(Events.BeforeResponse, (tokenResponse) => {
        const payload = { iss: issuer, aud: CLIENT_ID, sub: 'g-sub-1', email: 'ravi@firm.test', email_verified: true, iat: sec, exp: sec + 300, nonce };
        tokenResponse.body.id_token = makeIdToken(payload, tokenResponse.body.id_token);
      });
      const r = await roundTrip({ keepHooks: true });
      expectRefused(r.callback, 'SSO_TOKEN');
      resetWorld();
    });
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const kid = () => server.issuer.keys.get().kid;
  await forged('alg none (an unsigned token)', (payload) => b64({ alg: 'none', typ: 'JWT' }) + '.' + b64(payload) + '.');
  await forged('HS256 signed with the provider\'s PUBLIC key as the secret (algorithm confusion)', (payload) => {
    const jwk = server.issuer.keys.get();
    const publicPem = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
    const head = b64({ alg: 'HS256', typ: 'JWT', kid: kid() });
    const body = b64(payload);
    return head + '.' + body + '.' + crypto.createHmac('sha256', publicPem).update(head + '.' + body).digest('base64url');
  });
  await forged('signed by a key the provider never published (an unknown kid)', (payload) => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'never-published' });
    const body = b64(payload);
    return head + '.' + body + '.' + crypto.sign('sha256', Buffer.from(head + '.' + body), pair.privateKey).toString('base64url');
  });
  await forged('the right kid but a different private key (a wrong signature)', (payload) => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const head = b64({ alg: 'RS256', typ: 'JWT', kid: kid() });
    const body = b64(payload);
    return head + '.' + body + '.' + crypto.sign('sha256', Buffer.from(head + '.' + body), pair.privateKey).toString('base64url');
  });
  await forged('a real token with its signature bytes flipped', (payload, real) => {
    const parts = real.split('.');
    const sig = Buffer.from(parts[2], 'base64url');
    sig[5] ^= 0xff;
    return parts[0] + '.' + parts[1] + '.' + sig.toString('base64url');
  });
  await checkAsync('mix-up: an `iss` query parameter that is not this provider\'s → SSO_MIXUP', async () => {
    resetWorld();
    const r = await roundTrip({ tamper: claimsOf(), query: { iss: 'https://login.microsoftonline.com/' + GUID_A + '/v2.0' } });
    expectRefused(r.callback, 'SSO_MIXUP');
    resetWorld();
  });
  await checkAsync('mix-up: a callback at another provider\'s path with this start row\'s cookie → SSO_MIXUP', async () => {
    resetWorld();
    const r = await roundTrip({ tamper: claimsOf() });
    const swapped = r.callbackUrl.replace('/google/callback', '/microsoft/callback');
    // the row is only spent by the first use, so start again and swap the path of the second
    resetWorld();
    const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`);
    const authorized = await rawGet(start.headers.location);
    const res = await rawGet(authorized.headers.location.replace('/google/callback', '/microsoft/callback'), { cookie: String(start.headers['set-cookie']).split(';')[0] });
    expectRefused(res, 'SSO_MIXUP');
    void swapped;
    resetWorld();
  });
  await checkAsync('the person cancelled at the provider (error=access_denied) → SSO_CANCELLED; the start row is spent', async () => {
    resetWorld();
    const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`);
    const res = await rawGet(`${apiBase}/api/signin/provider/google/callback?error=access_denied&state=x`, { cookie: String(start.headers['set-cookie']).split(';')[0] });
    expectRefused(res, 'SSO_CANCELLED');
    assert.strictEqual(world.pending.size, 0);
    resetWorld();
  });
  await checkAsync('callback with a missing code and a repeated parameter does not break: SSO_TOKEN, never a 500', async () => {
    resetWorld();
    const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`);
    const state = new URL(start.headers.location).searchParams.get('state');
    const res = await rawGet(`${apiBase}/api/signin/provider/google/callback?state=${state}&code=a&code=b`, { cookie: String(start.headers['set-cookie']).split(';')[0] });
    expectRefused(res, 'SSO_TOKEN');
    resetWorld();
  });
  await checkAsync('the pending store missing at the callback: a refusal in the page\'s words, never a 500', async () => {
    resetWorld();
    const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`);
    world.missing = true;
    router._resetStoreCheck();
    const res = await rawGet(`${apiBase}/api/signin/provider/google/callback?code=a&state=b`, { cookie: String(start.headers['set-cookie']).split(';')[0] });
    expectRefused(res, 'PROVIDER_OFF');
    resetWorld();
  });
  await checkAsync('the library missing (import stubbed to fail): the api answers, the list is empty, start is refused, ONE log line says why', async () => {
    resetWorld();
    provider._reset(null);
    logLines.length = 0;
    assert.deepStrictEqual(JSON.parse((await rawGet(apiBase + '/api/signin/providers')).body).providers, []);
    expectRefused(await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`), 'PROVIDER_OFF');
    resetWorld();
  });
  await checkAsync('cookie scope: only the callback reads __Host-cb_sso; a request with it present changes no other route', async () => {
    const src = (f) => read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const users = fs.readdirSync(path.join(API, 'routes')).concat(fs.readdirSync(path.join(API, 'middleware')).map((f) => '../middleware/' + f)).filter((f) => /\.js$/.test(f)).filter((f) => /__Host-cb_sso|cb_sso/.test(src(f.startsWith('..') ? f.slice(3) : 'routes/' + f)));
    assert.deepStrictEqual(users, ['signin-provider.js']);
    assert.ok(!/cookie/i.test(src('lib/person-session.js')) && !/headers\.cookie|req\.cookies/.test(src('middleware/auth.js')), 'the session code reads no cookie');
    const start = await rawGet(`${apiBase}/api/signin/provider/google/start?device_id=${DEVICE}`);
    resetWorld();
    void start;
  });
  await checkAsync('no code, state, token, secret or reference reaches a log line, across every round trip above', async () => {
    resetWorld();
    const r = await roundTrip({ tamper: claimsOf() });
    const bad = await roundTrip({ tamper: (t) => claimsOf()(t) && (t.payload.aud = 'x') });
    const secrets = [CLIENT_SECRET, new URL(r.callbackUrl).searchParams.get('code'), new URL(r.callbackUrl).searchParams.get('state'), r.cookie.split('=')[1].split(';')[0], new URL(bad.callbackUrl).searchParams.get('code'), fragment(r.callback).split('=')[1]];
    const everything = logLines.join('\n');
    for (const s of secrets) assert.ok(s && s.length > 10 && !everything.includes(s), 'a secret value appeared in a log line');
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(everything), 'a JWT appeared in a log line');
    resetWorld();
  });
  await checkAsync('E · the handoff lives 60 s and is single use; a ticket five tries; a start row 10 minutes', async () => {
    resetWorld();
    const pending = require('../lib/signin-pending');
    assert.deepStrictEqual(pending.KINDS, { start: 600, handoff: 60, ticket: 600, linkstart: 60 });
    const ref = provider.randomRef();
    await pending.put('handoff', ref, { a: 1 });
    assert.deepStrictEqual(await pending.take('handoff', ref), { a: 1 });
    assert.strictEqual(await pending.take('handoff', ref), null, 'spent');
    await pending.put('handoff', ref, { a: 2 });
    world.now += 61 * 1000;
    assert.strictEqual(await pending.take('handoff', ref), null, 'after 61 s');
    const other = provider.randomRef();
    await pending.put('start', other, { a: 3 });
    assert.strictEqual(await pending.take('handoff', other), null, 'another kind finds nothing');
    assert.deepStrictEqual(await pending.take('start', other), { a: 3 });
    const ticket = provider.randomRef();
    await pending.put('ticket', ticket, { t: 1 });
    for (let i = 0; i < 5; i++) assert.deepStrictEqual(await pending.attempt(ticket), { t: 1 });
    assert.strictEqual(await pending.attempt(ticket), null, 'the sixth try: the ticket is dead');
    assert.strictEqual(await pending.take('handoff', 'short'), null);
    resetWorld();
  });

  await require('./lib/signin-provider-handoff-scenes.cjs')({ assert, crypto, http, apiBase, issuer, roundTrip, claimsOf, world, resetWorld, logLines, fragment, rawGet, expectRefused, DEVICE, checkAsync });
  await require('./lib/signin-provider-connect-scenes.cjs')({ assert, crypto, http, apiBase, issuer, roundTrip, claimsOf, world, resetWorld, logLines, fragment, rawGet, expectRefused, DEVICE, checkAsync });

  await new Promise((resolve) => api.close(resolve));
  await server.stop();
}

/** K · the same doors against Keycloak (SIT). The stub database is the same; only the provider is real. */
async function sectionKeycloak(kc) {
  console.log('K · start and callback against Keycloak at ' + kc);
  const express = require('express');
  const provider = require('../lib/signin-provider');
  const router = require('../routes/signin-provider');
  const app = express();
  app.use('/api/signin', router);
  const api = await new Promise((resolve) => {
    const s = http.createServer(app).listen(Number(process.env.SSO_API_PORT) || 13000, '127.0.0.1', () => resolve(s));
  });
  const apiBase = 'http://localhost:' + api.address().port;
  Object.assign(process.env, {
    NODE_ENV: 'test', SIGNIN_STANDIN: '1', SIGNIN_PROVIDERS: 'google,microsoft', PUBLIC_API_BASE: apiBase, PUBLIC_WEB_BASE: 'http://localhost:1',
    GOOGLE_OIDC_CLIENT_ID: 'cb-google-test', GOOGLE_OIDC_CLIENT_SECRET: 'cb-google-test-fixture-secret', SIGNIN_STANDIN_GOOGLE_ISSUER: kc + '/realms/google',
    MICROSOFT_OIDC_CLIENT_ID: 'cb-microsoft-test', MICROSOFT_OIDC_CLIENT_SECRET: 'cb-microsoft-test-fixture-secret', SIGNIN_STANDIN_MICROSOFT_ISSUER: kc + '/realms/microsoft',
    VAULT_ENC_KEY: crypto.randomBytes(32).toString('hex')
  });
  provider._reset(undefined);
  router._resetStoreCheck();
  const jar = new Map();
  const keep = (res) => {
    for (const line of [].concat(res.headers['set-cookie'] || [])) {
      const pair = line.split(';')[0];
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
    }
  };
  const cookies = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const request = (method, url, body, extra) =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      const headers = Object.assign({ cookie: cookies() }, body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}, extra || {});
      const req = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          keep(res);
          resolve({ status: res.statusCode, headers: res.headers, body: text });
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  const formAction = (html) => {
    const found = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html) || /<form[^>]*action="([^"]+)"[^>]*id="kc-form-login"/.exec(html);
    assert.ok(found, 'no login form on the page');
    return found[1].replace(/&amp;/g, '&');
  };
  /** start, then Keycloak's login form, then the credentials, then OUR callback; returns the callback answer, or what the provider said when it refused the password */
  async function login(key, username, password, device) {
    jar.clear();
    world.pending.clear();
    const start = await request('GET', apiBase + '/api/signin/provider/' + key + '/start?device_id=' + device);
    assert.strictEqual(start.status, 302, 'start: ' + start.status + ' ' + start.body.slice(0, 120));
    const apiCookie = String(start.headers['set-cookie']).split(';')[0];
    jar.clear();
    const page = await request('GET', start.headers.location);
    assert.strictEqual(page.status, 200, 'the login page: ' + page.status);
    const posted = await request('POST', formAction(page.body), new URLSearchParams({ username, password, credentialId: '' }).toString());
    if (posted.status !== 302) return { refused: posted.status };
    const back = new URL(posted.headers.location);
    assert.ok(back.href.startsWith(apiBase + '/api/signin/provider/' + key + '/callback'), 'Keycloak sends the person back to OUR registered callback: ' + back.origin + back.pathname);
    assert.ok(back.searchParams.get('code') && back.searchParams.get('state'), 'code and state');
    return { callback: await request('GET', back.href, null, { cookie: apiCookie }), iss: back.searchParams.get('iss'), back: back.href, apiCookie };
  }
  const handoffClaims = async (callback) => {
    const code = new URLSearchParams(new URL(callback.headers.location).hash.replace(/^#/, '')).get('h');
    assert.ok(code, 'a handoff code: ' + callback.headers.location);
    return (await require('../lib/signin-pending').take('handoff', code)).claims;
  };
  await checkAsync('K google: a verified user signs in through Keycloak; the claims are the checked ones, email_verified true, org from hd, PKCE and the iss parameter accepted', async () => {
    const r = await login('google', 'verified@firm.test', 'sso-test-pass-1', 'kc-device-0001');
    const c = await handoffClaims(r.callback);
    assert.deepStrictEqual([c.issuer, c.email, c.email_verified, c.org, c.tenant], [kc + '/realms/google', 'verified@firm.test', true, 'firm.test', '']);
    assert.ok(/^[0-9a-f-]{36}$/.test(c.subject), "the subject is Keycloak's user id: " + c.subject);
    if (r.iss) assert.strictEqual(r.iss, kc + '/realms/google', 'RFC 9207 iss as Keycloak sends it');
  });
  await checkAsync('K google: an unverified e-mail is carried as unverified (it can never be matched to an account on the provider\'s word)', async () => {
    const r = await login('google', 'unverified@firm.test', 'sso-test-pass-2', 'kc-device-0002');
    assert.strictEqual((await handoffClaims(r.callback)).email_verified, false);
  });
  await checkAsync('K google: a wrong password never reaches our callback (the provider refuses; no handoff exists)', async () => {
    const r = await login('google', 'verified@firm.test', 'wrong-password', 'kc-device-0003');
    assert.strictEqual(r.refused, 200, 'the login page again: ' + r.refused);
    assert.ok(![...world.pending.values()].some((row) => row.kind === 'handoff'));
  });
  await checkAsync('K microsoft: tid + oid are the key; the e-mail is never verified; the personal-accounts tenant is carried (P2 refuses it as an organisation)', async () => {
    const firm = await handoffClaims((await login('microsoft', 'ravi@firm.test', 'sso-test-pass-3', 'kc-device-0004')).callback);
    assert.deepStrictEqual([firm.subject, firm.tenant, firm.email_verified], ['f0e1d2c3-b4a5-4968-8776-655443322110', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', false]);
    assert.ok(firm.subject_alt && firm.subject_alt !== firm.subject, 'sub is kept apart, never the key');
    const personal = await handoffClaims((await login('microsoft', 'personal@outlook.test', 'sso-test-pass-4', 'kc-device-0005')).callback);
    assert.strictEqual(personal.tenant, provider.MS_PERSONAL_TENANT);
  });
  await checkAsync('K the callback replayed after a good sign-in finds nothing (SSO_STATE), against the real provider too', async () => {
    const r = await login('google', 'verified@firm.test', 'sso-test-pass-1', 'kc-device-0006');
    assert.ok(r.callback.headers.location.includes('#h='));
    const second = await request('GET', r.back, null, { cookie: r.apiCookie });
    assert.ok(second.headers.location.includes('#e=SSO_STATE'), second.headers.location);
  });
  await new Promise((resolve) => api.close(resolve));
}
