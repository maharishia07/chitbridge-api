'use strict';
/**
 * tests/lib/run-target.cjs — THE ONE ALLOW-LIST for where a realstack / lifecycle / seed runner may point (QA, 12 Nov 2026).
 *
 * owns: the answer to "may this runner write to this api + database?" and the sign-in facts that go with the answer.
 * called by: tests/lib/truth-harness.cjs (every tests/*-truth.realstack.cjs and the gorilla packs) · scripts/seed-local.cjs ·
 *            toolset/lifecycle-run.cjs (docs repo; reads this file out of CB_API_DIR). One check, three callers.
 *
 * The rule, in this order:
 *   1. PRODUCTION IS ALWAYS REFUSED, with no flag: any railway.app / supabase host, chitbridge-api-production, a Supabase pooler,
 *      in the api OR the database. Nothing below can switch it off.
 *   2. LOCAL: api on 127.0.0.1 / localhost AND the database the local container (127.0.0.1|localhost :55432 (or CB_LOCAL_PGPORT) /cb_local).
 *   3. A SIT BOX (Option A, the runner runs ON the box, inside its api container): CB_SIT_BOX names a server of PM/SIT-SERVERS.json
 *      (CB_SIT_SERVERS_FILE; role master or member, with an api_base), the api is that container's own http://localhost:3000 (or the
 *      box's own api_base) and the database is the compose service `db` (db:5432/chitbridge), NODE_ENV staging|uat. The list is the
 *      docs repo's file, copied along with the run, never a second list written here.
 *   4. Anything else is refused in words naming what to do.
 * Sign-in: local = the fixed dev codes (lib/dev-otp.js); a SIT box has none, so the entity and customer code is TODAY'S tester code,
 * built here from the container's TESTER_CODE + TESTER_CODE_TZ ({yymmdd}), and the e-mail domain is the one TESTER_NAMES lets in.
 * CARD 01-rail-core-the-chit/README
 */
const fs = require('fs'), path = require('path');

const PRODUCTION = /railway\.app|\.railway\.internal|supabase\.(co|com|net)|pooler\.supabase|chitbridge-api-production/i;
const LOCAL_API = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const BOX_OWN_API = /^http:\/\/localhost:3000$/;
const BOX_DB = /@db:5432\/chitbridge(\?|$)/;
const BOX_ENVS = ['staging', 'uat'];
const DEFAULT_SERVERS = path.join(__dirname, '..', '..', '..', 'PM', 'SIT-SERVERS.json');

const noSlash = (s) => String(s || '').replace(/\/$/, '');
const localDb = (env) => new RegExp('@(127\\.0\\.0\\.1|localhost):(55432' + (env.CB_LOCAL_PGPORT ? '|' + String(env.CB_LOCAL_PGPORT).replace(/\D/g, '') : '') + ')/cb_local(\\?|$)');

/** the SIT servers a runner may be on: master or member with an api_base (not the small member, not the load generator) */
function sitBoxes(file) {
  const f = file || DEFAULT_SERVERS;
  return JSON.parse(fs.readFileSync(f, 'utf8')).servers.filter((s) => (s.role === 'master' || s.role === 'member') && s.api_base);
}

/** judge(api, db, env) → { ok, kind: 'local'|'sit', box, why } — pure: reads only the arguments and the servers file */
function judge(api, db, env) {
  const e = env || process.env, a = noSlash(api), d = String(db || '');
  for (const [what, v] of [['api', a], ['database', d]]) {
    if (PRODUCTION.test(v)) return { ok: false, why: 'the ' + what + ' is a production host (' + v.replace(/\/\/[^@/]*@/, '//***@') + '): production is always refused, there is no flag' };
  }
  if (LOCAL_API.test(a) && localDb(e).test(d)) return { ok: true, kind: 'local' };
  const box = e.CB_SIT_BOX;
  if (box) {
    let list;
    try { list = sitBoxes(e.CB_SIT_SERVERS_FILE); } catch (x) { return { ok: false, why: 'cannot read the SIT server list (' + (e.CB_SIT_SERVERS_FILE || DEFAULT_SERVERS) + '): ' + x.message }; }
    const s = list.find((x) => x.name === box);
    if (!s) return { ok: false, why: 'CB_SIT_BOX=' + box + ' is not a SIT box in PM/SIT-SERVERS.json (allowed: ' + list.map((x) => x.name).join(', ') + ')' };
    if (!(BOX_OWN_API.test(a) || a === noSlash(s.api_base))) return { ok: false, why: 'the api ' + a + ' is not ' + box + "'s own (http://localhost:3000 inside its api container, or " + s.api_base + ')' };
    if (!BOX_DB.test(d)) return { ok: false, why: 'the database is not ' + box + "'s own compose db (db:5432/chitbridge)" };
    if (!BOX_ENVS.includes(String(e.NODE_ENV || '').trim())) return { ok: false, why: 'NODE_ENV is "' + (e.NODE_ENV || '') + '", a SIT box runs staging or uat' };
    return { ok: true, kind: 'sit', box: s.name };
  }
  return { ok: false, why: 'the target is not local and no SIT box is named: ' + a + ' / database ' + (d ? 'given' : 'unset') + '. Local is 127.0.0.1 + cb_local on :55432; a SIT box is named in CB_SIT_BOX (one of PM/SIT-SERVERS.json) and the runner runs on that box' };
}

const ymd = (tz, off) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + off * 864e5)).split('-');
  return p[0].slice(2) + p[1] + p[2];
};
/** today's concrete tester code from the container's own template (the same expansion lib/dev-otp.js and sit-hunt mktok.cjs do) */
function testerCodeToday(env) {
  const e = env || process.env, t = e.TESTER_CODE;
  if (!t || t.length < 8) return null;
  const tz = String(e.TESTER_CODE_TZ || 'Asia/Kolkata').trim(), d = ymd(tz, 0);
  return t.replace('{yymmdd}', d).replace('{yyyymmdd}', '20' + d);
}

/** the facts a runner signs in with, for a judged target */
function signIn(verdict, env) {
  if (verdict.kind === 'sit') return { entityOtp: testerCodeToday(env), customerOtp: testerCodeToday(env), emailDomain: 'test.chitbridge' };
  return { entityOtp: '123456', customerOtp: '123123', emailDomain: 'local.test' };   /* lib/dev-otp.js, local stack only */
}

/** the guard every runner calls at load: judged, else REFUSED + exit 3 (stderr says why); returns the verdict + signIn facts */
function assertTarget(api, db, label) {
  const v = judge(api, db, process.env);
  if (!v.ok) { console.error('REFUSED' + (label ? ' (' + label + ')' : '') + ': ' + v.why); process.exit(3); }
  return Object.assign({}, v, signIn(v, process.env));
}

module.exports = { judge, assertTarget, signIn, testerCodeToday, sitBoxes, PRODUCTION };
