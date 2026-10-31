#!/usr/bin/env node
'use strict';
/**
 * tests/write-route-gate.test.cjs — SEC-72 (2026-10-19): EVERY write route (POST/PUT/PATCH/DELETE) in routes/ is covered, and a new one cannot slip in.
 * OWNS     the sweep table + the allow-list of routes open on purpose (WRITE_ALLOW below) · CALLED BY scripts/guards.cjs · FLOW  routes → this guard
 * Reads the REAL route table (each router's express stack, not a grep) and the mounts in server.js. A write route is covered when ONE is true:
 *   gated    lib/access.writeGate is in its stack (the owner or an editor; a viewer/commenter gets 403 read_only / comment_only + the rail's sentence)
 *   default  `auth` is in its stack — middleware/auth.js runs hat-gate INSIDE auth (fail closed): a viewer/commenter actor is refused on every path that
 *            hat-gate.SELF_SCOPED / SELF_SCOPED_EXACT does not name. Proved below by driving the REAL hat-gate with a viewer and a commenter on EVERY route's path.
 *   allowed  it is in WRITE_ALLOW with a one-line reason (public sign-in / webhooks / peer / customer / counter-key routes, and the self-scoped few a viewer may use)
 * FAILS when a write route has no auth at all and no allow-list entry, or sits on a hat-gate self-scoped path without one (a viewer could write there).
 * Run: node tests/write-route-gate.test.cjs · no DB, no network (db is never queried: only the route tables are read).
 */
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fail++; console.log('  ✗ ' + what + (info ? '\n      ' + String(info).slice(0, 600) : '')); } };

/** Open on purpose: 'METHOD /full/path' → why. Anything here that gains auth + writeGate later should leave the list. */
const WRITE_ALLOW = {
  /* public by design — the caller has no login yet, or proves itself another way */
  'POST /api/actors/login': 'sign-in door for a co-assist (rate-limited signin.door + verifyChecks)',
  'POST /api/entities/register': 'a new shop registers itself (signin.door + askChecks)',
  'POST /api/entities/verify': 'sign-in code check (signin.door + verifyChecks)',
  'POST /api/signin/ask': 'sign-in code request (signin.door)',
  'POST /api/signin/verify': 'sign-in code check (signin.door + verifyChecks)',
  'POST /api/csp-report': 'a browser posts its CSP report with no credential; own limiter, 8 KB cap, logs shaped fields only (K-SEC PR A)',
  'POST /api/capture/webhook/whatsapp': 'provider webhook, verified by its signature inside the handler',
  'POST /api/capture/webhook/email': 'provider webhook, verified by its signature inside the handler',
  'POST /api/ctp/deliver': 'peer installation delivery, verified by the CTP signature (ctpLimiter)',
  'POST /api/ctp/query': 'peer installation query, verified by the CTP signature (ctpLimiter)',
  'POST /deliver': 'the same CTP router also mounted at / (for /.well-known/ctp.json); same signature check and limiter',
  'POST /query': 'the same CTP router also mounted at /; same signature check and limiter',
  'POST /api/channels/:id/approve': 'platform admin key (x-cb-admin-key), not a shop login',
  'POST /api/channels/:id/template-approve': 'platform admin key (x-cb-admin-key), not a shop login',
  'POST /api/channels/:id/revoke': 'platform admin key (x-cb-admin-key), not a shop login',
  'POST /api/connectors/ingest': 'a connector key (scope + signature middleware), not a person',
  'POST /api/connectors/erp-ingest': 'a connector key (scope + signature middleware), not a person',
  'POST /api/till/pair/claim': 'the counter exchanges its one-time pairing code for its key (counter key-auth flow, rate-limited) — left as is',
  'POST /api/integrations/ask/:handle/stock': 'a public yes/no stock question on a public catalogue; writes nothing',
  'POST /api/simulator/lead': 'the public demo gate (name + email); writes only a simulator lead',
  'POST /api/simulator/feedback': 'public demo feedback; carries the simulator token',
  'POST /api/assist': 'asking the assistant (public KB when anonymous); creates nothing on the rail',
  'POST /api/assist/conform': 'a deterministic check, returned not saved',
  'POST /api/assist/catalogue-structure': 'a proposed structure, returned not saved',
  'POST /api/assist/gap': 'deprecated no-op: logs a line, writes nothing',
  /* customer-side logins (the shop\'s buyers), not co-assists */
  'POST /api/catalogue/network-store/:networkId/order': 'a buyer\'s order through the network store (customer token checked in the handler)',
  'POST /api/catalogue/:bridge_id/order/start': 'a buyer starts an order (OTP to their own phone/e-mail)',
  'POST /api/catalogue/:bridge_id/support/start': 'a buyer asks for support (OTP to their own phone/e-mail)',
  'POST /api/catalogue/:bridge_id/support': 'a buyer\'s support request, OTP-checked',
  'POST /api/catalogue/:bridge_id/order/confirm': 'a buyer confirms an order, OTP-checked',
  'POST /api/catalogue/:bridge_id/login/verify': 'a buyer signs in, OTP-checked',
  'DELETE /api/catalogue/:bridge_id/my-documents/:id': 'a buyer removes THEIR OWN document (customerAuth)',
  'POST /api/privacy/me/consent': 'a buyer records THEIR OWN consent (customerAuth)',
  'POST /api/privacy/me/requests': 'a buyer files THEIR OWN privacy request (customerAuth)',
  /* behind auth AND a path hat-gate lets a viewer through — each is the caller\'s own, or refuses inside */
  'PUT /api/actors/break': 'the caller\'s own break; naming someone else is owner-only (ownerWhenOther)',
  'POST /api/assist/resolve': 'resolving a governed view — a read, writes nothing',
  'POST /api/chits/:chit_id/messages': 'internal messaging for a commenter; the handler refuses an EXTERNAL thread for a read-only login',
  'PATCH /api/entities/me/prefs/:kind': 'the caller\'s own appearance/locale preference, not a record',
  'PATCH /api/entities/me/locale': 'the caller\'s own locale, not a record',
  'PUT /api/identity/documents/:scheme': 'the caller\'s own identity document (the subject is always req.identity)',
  'POST /api/identity/documents/:scheme/code': 'the caller\'s own identity document code',
  'POST /api/identity/documents/:scheme/verify': 'the caller\'s own identity document check',
  'POST /api/notifications/seen': 'the caller\'s own bell: marks seen',
  'POST /api/notifications/dismiss': 'the caller\'s own bell: dismisses',
  'POST /api/signin/renew': 'the caller\'s own session (personOnly)',
  'POST /api/signin/logout': 'the caller\'s own session (personOnly)',
  'POST /api/signin/sessions/revoke': 'the caller\'s own sessions; ending someone else\'s is refused inside (owner-only)',
  'POST /api/signin/pin': 'the caller\'s own PIN',
};

/** file → mount prefix, read from server.js (const xRouter = require('./routes/f') + app.use('/p', …xRouter | require('./routes/f'))) */
function mountsOf(src) {
  const varFile = {}; let m;
  const vre = /const\s+(\w+)\s*=\s*require\('\.\/routes\/([\w-]+)'\)/g;
  while ((m = vre.exec(src))) varFile[m[1]] = m[2];
  const out = {};
  const ure = /app\.use\(\s*'([^']+)'([^;\n]*)/g;
  while ((m = ure.exec(src))) {
    const direct = /require\('\.\/routes\/([\w-]+)'\)/.exec(m[2]);
    const viaVar = Object.keys(varFile).find((v) => new RegExp('\\b' + v + '\\b').test(m[2]));
    const f = direct ? direct[1] : viaVar ? varFile[viaVar] : null;
    if (f) (out[f] = out[f] || []).push(m[1] === '/' ? '' : m[1]);
  }
  return out;
}

/** every write route of every router: { file, method, full, auth, gated, names } */
function writeRoutes() {
  const auth = require(path.join(API, 'middleware', 'auth')), access = require(path.join(API, 'lib', 'access'));
  const mounts = mountsOf(fs.readFileSync(path.join(API, 'server.js'), 'utf8'));
  const rows = [], unmounted = [], parts = require(path.join(API, 'tools', 'server-mounts.cjs')).partParents(path.join(API, 'routes'));
  for (const f of fs.readdirSync(path.join(API, 'routes')).filter((x) => x.endsWith('.js'))) {
    const base = f.replace(/\.js$/, ''), router = require(path.join(API, 'routes', f));
    if (!mounts[base] && parts[f]) continue; /* a part of a split router (chits-trace of chits): its parent mounts it, and walk() below goes into the parent's sub-router */
    if (!mounts[base]) { unmounted.push(f); continue; }
    const walk = (r) => (r && r.stack ? r.stack : []).forEach((l) => {
      if (l.handle && l.handle.stack && !l.route) return walk(l.handle);
      if (!l.route) return;
      Object.keys(l.route.methods).filter((x) => ['post', 'put', 'patch', 'delete'].includes(x)).forEach((x) => {
        const hs = l.route.stack.map((s) => s.handle);
        mounts[base].forEach((mp) => rows.push({ file: f, method: x.toUpperCase(), full: (mp + (l.route.path === '/' ? '' : l.route.path)) || '/',
          auth: hs.includes(auth), gated: hs.includes(access.writeGate) }));
      });
    });
    walk(router);
  }
  return { rows, unmounted };
}

/** the verdict for one route: 'gated' | 'default' | 'allowed' | a sentence saying what is missing */
function verdict(r, selfScoped) {
  const key = r.method + ' ' + r.full;
  if (r.gated) return 'gated';
  if (WRITE_ALLOW[key]) return 'allowed';
  if (!r.auth) return 'no auth and no allow-list entry (public write)';
  if (selfScoped(r.full)) return 'on a path hat-gate lets a viewer write, and not allow-listed';
  return 'default';
}

(async () => {
  const hat = require(path.join(API, 'middleware', 'hat-gate'));
  const pre = hat.SELF_SCOPED.map((x) => x[0]);
  /* the exact patterns are not exported; the same list is read from the source so there is ONE copy of it */
  const hsrc = fs.readFileSync(path.join(API, 'middleware', 'hat-gate.js'), 'utf8');
  const exact = [...hsrc.slice(hsrc.indexOf('const SELF_SCOPED_EXACT')).split('];')[0].matchAll(/\[(\/\^.*?\$\/),/g)].map((m) => eval(m[1]));
  const selfScoped = (p0) => { const p = p0.replace(/^\/api(?=\/|$)/, '').replace(/:[A-Za-z_]+/g, 'x'); return pre.some((q) => p === q || p.startsWith(q + '/')) || exact.some((re) => re.test(p)); };

  const { rows, unmounted } = writeRoutes();
  ok('every routes/*.js file is mounted in server.js (a new router must be mounted to be swept)', unmounted.length === 0, unmounted.join(', '));
  ok('the sweep sees the write routes (> 300)', rows.length > 300, rows.length);
  /* F2 (critic 25 Oct): routes/chit-proposals.js is mounted inside the chits router — its four write doors must be IN the swept rows, not exempted from them */
  const seen = new Set(rows.map((r) => r.method + ' ' + r.full));
  const proposalDoors = ['POST /api/chits/:chit_id/proposals', 'POST /api/chits/:chit_id/proposals/:proposal_id/accept', 'POST /api/chits/:chit_id/proposals/:proposal_id/reject', 'POST /api/chits/:chit_id/proposals/:proposal_id/counter'];
  ok('the proposal doors (a router mounted inside the chits router) are swept', proposalDoors.every((d) => seen.has(d)), proposalDoors.filter((d) => !seen.has(d)).join(', '));

  /* 1 · the GUARD: no write route is uncovered */
  const bad = rows.map((r) => [r, verdict(r, selfScoped)]).filter(([, v]) => !['gated', 'default', 'allowed'].includes(v));
  ok('GUARD: every write route is gated, behind auth (hat-gate), or allow-listed WITH a reason', bad.length === 0, bad.map(([r, v]) => r.method + ' ' + r.full + ' — ' + v).join('\n      '));
  const stale = Object.keys(WRITE_ALLOW).filter((k) => !rows.some((r) => r.method + ' ' + r.full === k));
  ok('the allow-list has no stale entry (a removed route leaves the list)', stale.length === 0, stale.join(', '));
  ok('every allow-list entry has a real reason', Object.values(WRITE_ALLOW).every((w) => typeof w === 'string' && w.length > 12));

  /* 2 · the guard really catches: two planted routes (one public, one on a viewer-writable path) */
  const plantedPublic = verdict({ method: 'POST', full: '/api/zzz/new-write', auth: false, gated: false }, selfScoped);
  const plantedSelf = verdict({ method: 'POST', full: '/api/notifications/clear-all', auth: true, gated: false }, selfScoped);
  const plantedGated = verdict({ method: 'POST', full: '/api/zzz/new-write', auth: true, gated: true }, selfScoped);
  ok('BREAK-TEST: a new public write route is flagged', /public write/.test(plantedPublic), plantedPublic);
  ok('BREAK-TEST: a new write route on a self-scoped path is flagged', /lets a viewer write/.test(plantedSelf), plantedSelf);
  ok('a new write route with writeGate passes', plantedGated === 'gated');

  /* 3 · per route family: the REAL hat-gate refuses a viewer and a commenter on every covered route; the owner passes */
  const run = (identity, method, full) => { let st = null, nexted = false;
    const res = { status(c) { st = c; return this; }, json() { return this; } };
    hat({ method, originalUrl: full.replace(/:[A-Za-z_]+/g, 'x'), path: full, identity }, res, () => { nexted = true; });
    return nexted ? 200 : st; };
  const viewer = { identity_type: 'actor', identity_id: 'a1', parent_entity_id: 'e1', access_level: 'viewer' };
  const commenter = { identity_type: 'actor', identity_id: 'a2', parent_entity_id: 'e1', access_level: 'commenter' };
  const editor = { identity_type: 'actor', identity_id: 'a3', parent_entity_id: 'e1', access_level: 'editor' };
  const owner = { identity_type: 'entity', identity_id: 'e1' };
  const families = {};
  rows.filter((r) => r.auth).forEach((r) => (families[r.file] = families[r.file] || []).push(r));
  for (const f of Object.keys(families).sort()) {
    const list = families[f].filter((r) => !WRITE_ALLOW[r.method + ' ' + r.full]);
    const refused = list.filter((r) => run(viewer, r.method, r.full) === 403 && run(commenter, r.method, r.full) === 403);
    const passed = list.filter((r) => run(owner, r.method, r.full) === 200 && run(editor, r.method, r.full) === 200);
    ok(f.replace('.js', '') + ' (' + list.length + ' writes): viewer + commenter refused 403, owner + editor pass', refused.length === list.length && passed.length === list.length,
      list.filter((r) => !refused.includes(r) || !passed.includes(r)).map((r) => r.method + ' ' + r.full).join(', '));
  }

  /* 4 · the premise of SEC-71 stays honest: hat-gate is wired INSIDE auth on both entry paths */
  const asrc = fs.readFileSync(path.join(API, 'middleware', 'auth.js'), 'utf8');
  ok('auth runs hat-gate on both paths (first call and the DECIDED re-entry)', (asrc.match(/require\('\.\/hat-gate'\)/g) || []).length >= 2);

  /* 5 · the writeGate family: viewer/commenter get the rail's sentence and code, owner/editor pass */
  const A = require(path.join(API, 'lib', 'access'));
  const gate = (identity) => { let st = null, body = null, nexted = false;
    A.writeGate({ identity }, { status(c) { st = c; return this; }, json(b) { body = b; return this; } }, () => { nexted = true; });
    return { st, body, nexted }; };
  const gv = gate(viewer), gc = gate(commenter);
  ok('writeGate: viewer → 403 read_only', gv.st === 403 && gv.body.code === 'read_only' && gv.body.message);
  ok('writeGate: commenter → 403 comment_only', gc.st === 403 && gc.body.code === 'comment_only' && gc.body.message);
  ok('writeGate: owner and editor pass', gate(owner).nexted && gate(editor).nexted);

  const g = rows.filter((r) => r.gated).length, a = rows.filter((r) => !r.gated && WRITE_ALLOW[r.method + ' ' + r.full]).length;
  console.log('\n  routes ' + rows.length + ' · gated ' + g + ' · allow-listed ' + a + ' · behind auth/hat-gate ' + (rows.length - g - a));
  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
