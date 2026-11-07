/**
 * tests/sec-130a-duplicate-email.test.cjs — SEC-130 (A): THE ANSWER ON A DUPLICATE E-MAIL TELLS A STRANGER NOTHING.
 * identities.email is one global UNIQUE column, so a party contact e-mail another shop holds is refused by the database. Two doors turned that
 * refusal into a probe (proved on SIT 2026-11-01, SEC-130-PROOF): register (a 500 for a held address, a 200 "code sent" for a fresh one) and the
 * party PATCH (words must not vary with WHO holds it). The owner keeps an honest answer ONLY about their own list.
 * Proves: (1) POST /api/entities/register on an e-mail a shop minted onto a party answers like a fresh e-mail (same status, same message, nothing
 * of the holder), (2) PATCH of a party e-mail held by another shop: the one fixed generic sentence, no holder named, (3) held by the SAME shop's
 * other party: the honest words naming that party, (4) a fresh e-mail still saves, (5) a non-unique database error is still an error.
 * Run: node tests/sec-130a-duplicate-email.test.cjs · no DB (an in-memory identities table that enforces the unique e-mail as Postgres does).
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-only-secret-sec-130a', NODE_ENV: 'development', DATABASE_URL: 'postgres://cb@127.0.0.1:5432/cb_test' });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'DEV_OTP', 'DEV_OTP_IN_RESPONSE', 'SMS_PROVIDER'].forEach((k) => { delete process.env[k]; });
const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const E = 'held@elsewhere.test';
let ROWS = [], BREAK = null, INSERTS = 0, MAILS = [];
const reset = () => {
  ROWS = [
    { identity_id: 'shopx', parent_entity_id: null, email: 'x@shopx.test', otp_contact: null, user_id: 'shopx', display_name: 'Shop X', identity_type: 'entity' },
    { identity_id: 'partyx', parent_entity_id: 'shopx', email: E, otp_contact: null, user_id: '~shopx.cus-1', display_name: 'Held Traders', identity_type: 'entity' },
    { identity_id: 'shopy', parent_entity_id: null, email: 'y@shopy.test', otp_contact: null, user_id: 'shopy', display_name: 'Shop Y', identity_type: 'entity' },
    { identity_id: 'partyy', parent_entity_id: 'shopy', email: null, otp_contact: null, user_id: '~shopy.cus-1', display_name: 'Y Customer', identity_type: 'entity' },
    { identity_id: 'partyy2', parent_entity_id: 'shopy', email: 'own@y.test', otp_contact: null, user_id: '~shopy.cus-2', display_name: 'Y Second', identity_type: 'entity' }
  ];
  BREAK = null;
  INSERTS = 0;
  MAILS = [];
};
const lc = (v) => String(v == null ? '' : v).toLowerCase();
const unique = (email, except) => ROWS.some((r) => r.identity_id !== except && r.email && email && lc(r.email) === lc(email));
const dup = () => Object.assign(new Error('duplicate key value violates unique constraint "identities_email_key"'), { code: '23505', constraint: 'identities_email_key' });
async function q(sql, p) {
  p = p || [];
  const s = String(sql).replace(/\s+/g, ' ').trim();
  let m;
  if (BREAK) throw BREAK;
  if (/^INSERT INTO identities/i.test(s)) {
    INSERTS++;
    if (unique(p[3])) throw dup();
    ROWS.push({ identity_id: p[0], email: p[3], user_id: p[4], display_name: p[2], identity_type: 'entity', parent_entity_id: null });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT 1 FROM identities WHERE LOWER\(user_id\)/i.test(s)) return { rows: ROWS.filter((r) => lc(r.user_id) === p[0]).map(() => ({})) };
  if (/^SELECT otp_contact, email, parent_entity_id FROM identities WHERE identity_id = \$1/i.test(s)) return { rows: ROWS.filter((r) => r.identity_id === p[0]) };
  if (/FROM identities WHERE LOWER\(email\) = LOWER\(\$1\) AND identity_id <> \$2/i.test(s)) return { rows: ROWS.filter((r) => r.identity_id !== p[1] && lc(r.email) === lc(p[0])) };
  if ((m = s.match(/^UPDATE identities SET (\w+) = \$2 WHERE identity_id = \$1/i))) {
    if (m[1] === 'email' && unique(p[1], p[0])) throw dup();
    ROWS.filter((r) => r.identity_id === p[0]).forEach((r) => { r[m[1]] = p[1]; });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT \* FROM customer_list WHERE customer_list_id = \$1 AND owner_entity_id = \$2/i.test(s)) return { rows: [{ customer_list_id: p[0], owner_entity_id: p[1], customer_identity_id: p[0] === 'row-y' ? 'partyy' : 'partyy2' }] };
  /* the sign-in lookups: accounts only (a minted party, parent set, is not found: SEC-130 B), nothing else answers */
  if (/^SELECT (.+?) FROM identities WHERE/i.test(s)) return { rows: ROWS.filter((r) => p[0] != null && lc(r.email) === lc(p[0]) && r.parent_entity_id == null), rowCount: 0 };
  return { rows: [], rowCount: 0 };
}
const stub = (rel, exports) => { const f = require.resolve(path.join(API, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) }, withEntity: async (id, fn) => fn({ query: q }),
  withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, hasColumns: async () => true, hasTable: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/schema-bootstrap', { ensureDefaultSchema: async () => {} });
stub('lib/rootlink', { connect: async () => null });
stub('lib/notify', { sendOtp: async () => ({ delivered: true }), sendOtpEmail: async (to, name, otp) => { MAILS.push({ kind: 'code', to, otp }); return { delivered: true }; }, sendOtpSms: async () => ({}), sendEmail: async (to, subject, html) => { MAILS.push({ kind: 'notice', to, subject, html }); return { delivered: true }; }, sendSupportAlert: async () => ({}) });
stub('lib/istest', { atRegistration: () => ({ population: null, entity_kind: 'customer' }), ready: async () => true });

const app = express();
app.use(express.json());
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
app.use('/api/signin', require(path.join(API, 'routes', 'signin')));
let base;
const post = (url, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body || {});
  const r = http.request(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch (_) { /* not json */ } resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject); r.write(data); r.end();
});
const PF = require(path.join(API, 'lib', 'party-fields'));
const patchEmail = async (owner, row, email) => {
  try { return { ok: true, r: await PF.patch({ query: q }, owner, 'customer', row, { email }, 'u') }; } catch (e) { return { ok: false, status: e.status, message: e.message }; }
};
const nameless = (s) => !/held traders|elsewhere|shop x|partyx|shopx/i.test(String(s));

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    say('SEC-130 (A) — a duplicate e-mail answers the same to a stranger');
    reset();
    const fresh = await post('/api/entities/register', { email: 'brand-new@fresh.test', display_name: 'Fresh Co', user_id: 'freshcompany' });
    const held = await post('/api/entities/register', { email: E, display_name: 'Probe Co', user_id: 'probecompany' });
    t('register on a fresh e-mail answers 200 "code sent"', fresh.status === 200 && /code sent|code issued/i.test(fresh.body.message || ''), fresh.status + ' ' + JSON.stringify(fresh.body));
    t('⭐ register on an e-mail a shop minted onto a party: the SAME status as a fresh one (was a 500)', held.status === fresh.status, held.status + ' ' + JSON.stringify(held.body));
    t('⭐ …and the SAME message, naming no holder', held.body.message === fresh.body.message && nameless(JSON.stringify(held.body).split(E).join('')), JSON.stringify(held.body));
    t('⭐ the INSERT still runs for the held address (the refusal is the database refuses it, not a skipped call)', INSERTS === 2, 'inserts ' + INSERTS);
    const notice = MAILS.filter((m) => m.to === E);
    t('⭐ the held address gets exactly ONE mail through the mailer, the same work as a fresh one (timing)', notice.length === 1 && MAILS.filter((m) => m.to === 'brand-new@fresh.test').length === 1, JSON.stringify(MAILS.map((m) => m.kind + ':' + m.to)));
    t('⭐ …that mail is a notice with NO code and names no shop', notice[0] && notice[0].kind === 'notice' && !/d{6}/.test(notice[0].html) && nameless(notice[0].html + notice[0].subject) && /already on file/.test(notice[0].html), notice[0] && notice[0].html);
    t('   …and no second account was made for that e-mail', ROWS.filter((r) => r.email === E).length === 1);

    say('\n── the party PATCH ──');
    reset();
    const other = await patchEmail('shopy', 'row-y', E);
    t('⭐ held by ANOTHER shop: 409 with the one fixed generic sentence', !other.ok && other.status === 409 && /cannot be saved on this record/.test(other.message), JSON.stringify(other));
    t('⭐ …and it names nobody (not the party, the shop or the address)', !other.ok && nameless(other.message) && !/y customer|y second/i.test(other.message), other.message);
    reset();
    const own = await patchEmail('shopy', 'row-y', 'own@y.test');
    t("⭐ held by the SAME shop's other party: the honest words, naming that party", !own.ok && own.status === 409 && /Y Second/.test(own.message) && /already/i.test(own.message), JSON.stringify(own));
    reset();
    const fine = await patchEmail('shopy', 'row-y', 'free@y.test');
    t('a fresh e-mail still saves', fine.ok && ROWS.find((r) => r.identity_id === 'partyy').email === 'free@y.test', JSON.stringify(fine));
    reset();
    const same = await patchEmail('shopy', 'row-y2', 'own@y.test');
    t("the party's own current e-mail is no conflict", same.ok, JSON.stringify(same));
    reset();
    BREAK = Object.assign(new Error('boom'), { code: '08006' });
    const boom = await patchEmail('shopy', 'row-y', 'other@y.test');
    t('a non-unique database error is still an error (not dressed as a duplicate)', !boom.ok && !/cannot be saved|already/.test(boom.message || ''), JSON.stringify(boom));
  } finally { server.close(); }
  say('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('ERROR ' + ((e && e.stack) || e)); process.exit(1); });
