'use strict';
/**
 * people-writes-sec2.test.cjs — SEC2 (14 Oct): no sign-in code leaves the server; people writes need the owner.
 *
 *   1. NO ANSWER OF ANY /api/actors ROUTE CONTAINS A CODE — every route is called, as the owner AND as a colleague, against a
 *      store where every stored code (otp_code) and every freshly minted one is the same known secret; the JSON of each answer
 *      must not hold it, nor a key named otp_code / first_code / dev_otp / otp. GET / says `pin_state` instead.
 *   2. EVERY PEOPLE WRITE IS THE OWNER'S — a colleague is refused 403 { code:'OWNER_ONLY', may:false, why } (lib/owner.js
 *      ownerOnly, the sentence lib/people.js shows), the owner passes; delegate and settings had no check at all before.
 *   3. PEOPLE-EMAIL — the Add form's e-mail is stored (lowercased) and PATCH edits / clears it; a taken e-mail is 409 in words.
 *   4. The connector code comes through the one generator (lib/otp.generateOTP('connector')).
 *   5. W2-PEOPLE — A SEALED HOST RESETS THROUGH THE STORED E-MAIL: on each reset door (DELETE /:id/pin · POST /:id/otp · reactivate)
 *      and on Add, the stored address is read back, the code goes to that mailbox only and the answer says where (masked); a person
 *      with no e-mail is refused 400 EMPLOYEE_EMAIL_REQUIRED BEFORE anything is written or sent; no sender → 503, nothing written.
 * Offline: express on 127.0.0.1, auth + db + the e-mail sender stubbed. Run: node tests/people-writes-sec2.test.cjs
 */
const path = require('path'), http = require('http'), fs = require('fs');
const API = path.join(__dirname, '..');
const express = require('express');

/* unsealed, NOT a local stack: the posture production has had — a code may never be echoed here */
Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@db.example.com:5432/cb', DEV_OTP: '1' });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'DEV_OTP_IN_RESPONSE', 'TESTER_CODE'].forEach((k) => { delete process.env[k]; });

const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const SECRET = '987654';
const SHOP = '11111111-1111-4111-8111-111111111111', BALA = '22222222-2222-4222-8222-222222222222', RAVI = '33333333-3333-4333-8333-333333333333';
const CHIT = '44444444-4444-4444-8444-444444444444';

/* ── the store: any SELECT answers one row of the columns it names; otp_code is always the secret ── */
const WRITES = [];
let throwOn = null;
const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
let BREAK = 'active';   /* what identities.break_status holds for Bala: section 6 switches her off or removes her */
let STORED_EMAIL = 'v_email';   /* what identities.email holds for Bala — section 5 sets a real address, or none */
const valueFor = (col) => {
  if (col === 'otp_code') return SECRET;
  if (col === 'email') return STORED_EMAIL;
  if (/count|tasks|attempts/.test(col)) return 0;
  if (/^(identity_id|delegate_actor_id|assigned_to_actor_id)$/.test(col)) return BALA;
  if (col === 'chit_id') return CHIT;
  if (col === 'hat') return 'act';
  if (col === 'break_status') return BREAK;
  if (col === 'pin_state') return 'pending';
  return 'v_' + col;
};
const SETTINGS = ['entity_id', 'assignment_model', 'default_max_tasks', 'auto_assign_mode', 'default_assignee_actor_id'];
const FULL = ['identity_id', 'entity_id', 'otp_code', 'otp_expires_at', 'pin_hash', 'display_name', 'email', 'assignment_model'];
function rowOf(sql) {
  const m = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(sql); if (!m) return {};
  const o = {};
  for (const part of splitTop(m[1])) {
    if (part === '*') { (/FROM identities\b/i.test(sql) ? FULL : SETTINGS).forEach((c) => { o[c] = valueFor(c); }); continue; }
    const as = /\s+AS\s+(\w+)\s*$/i.exec(part) || /\s+as\s+(\w+)\s*$/.exec(part);
    const name = as ? as[1] : (/(\w+)\s*$/.exec(part) || [])[1];
    if (name) o[name] = valueFor(name);
  }
  return o;
}
async function q(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/^(INSERT|UPDATE|DELETE)/i.test(s)) {
    WRITES.push({ sql: s, params: params || [] });
    if (throwOn && throwOn(s, params || [])) { const e = new Error('duplicate key value violates unique constraint "identities_email_key"'); e.code = '23505'; e.constraint = 'identities_email_key'; throw e; }
    const ret = /RETURNING (.+)$/i.exec(s);
    return { rows: ret ? [rowOf('SELECT ' + ret[1] + ' FROM x')] : [], rowCount: 1 };
  }
  if (/^SELECT 1 FROM identities WHERE actor_key/i.test(s)) return { rows: [], rowCount: 0 };   // the key is free
  if (/FROM access_events/i.test(s)) return { rows: [rowOf(s)], rowCount: 1 };
  if (/^SELECT/i.test(s)) return { rows: [rowOf(s)], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) }, withEntity: async (id, fn) => fn({ query: q }),
  withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, hasTable: async () => true, columns: async () => [], table: async () => ({}) });
/* every freshly minted code is the secret too, so "the code just issued" is caught as well as "a code stored earlier" */
const realOtp = require(path.join(API, 'lib', 'otp'));
stub('lib/otp', Object.assign({}, realOtp, { generateOTP: () => SECRET }));
/* the e-mail sender records where each code went instead of calling Resend (lib/employee-code.deliver reads it at call time) */
const SENT = [];
const realNotify = require(path.join(API, 'lib', 'notify'));
stub('lib/notify', Object.assign({}, realNotify, { sendOtpEmail: async (to, name, otp) => { SENT.push({ to, name, otp }); return { delivered: true }; } }));
/* WHO is calling — the owner (an entity) or a colleague (an actor under the shop). The real auth is tested elsewhere. */
let WHO = null;
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan', parent_entity_id: null };
const COLLEAGUE = { identity_id: RAVI, identity_type: 'actor', display_name: 'Ravi', parent_entity_id: SHOP, hat: 'act', access_level: 'editor' };
const auth = (req, res, next) => { req.identity = Object.assign({}, WHO); next(); };
auth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
stub('middleware/auth', auth);

const app = express(); app.use(express.json());
app.use('/api/actors', require(path.join(API, 'routes', 'actors')));
let base;
const call = (method, url, body) => new Promise((resolve, reject) => { const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' }; if (data) h['content-length'] = Buffer.byteLength(data);
  const r = http.request(base + url, { method, headers: h }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, raw: s, body: j || {} }); }); });
  r.on('error', reject); if (data) r.write(data); r.end(); });

/* every route routes/actors.js answers, with a body each validator accepts */
const READS = [['GET', '/'], ['GET', '/?status=all'], ['GET', '/settings'], ['GET', '/' + BALA + '/tasks'], ['GET', '/access-events'],
  ['POST', '/suggest-key', { display_name: 'Bala Kumar' }], ['POST', '/check-key', { actor_key: 'bala' }]];
const WRITES_PEOPLE = [
  ['POST', '/', { display_name: 'Bala', actor_key: 'bala', email: 'Bala@Shop.TEST' }],
  ['PATCH', '/' + BALA, { display_name: 'Bala K' }],
  ['DELETE', '/' + BALA + '/pin'],
  ['POST', '/' + BALA + '/otp'],
  ['PUT', '/' + BALA + '/status', { action: 'reactivate' }],
  ['PUT', '/settings', { assignment_model: 'push' }],
  ['PUT', '/' + BALA + '/delegate', { delegate_actor_id: RAVI }],
  ['PUT', '/' + BALA + '/tasks/route', { chit_id: CHIT, action: 'pool' }],
];
const BANNED_KEYS = ['otp_code', 'first_code', 'dev_otp', 'otp'];
/* section 5: the four doors that mint a code for a person — the Add and the three resets (lib/employee-code is called 4× in actors.js) */
const RESET_DOORS = [
  ['POST', '/', { display_name: 'Bala', actor_key: 'bala', email: 'bala@shop.test' }],
  ['DELETE', '/' + BALA + '/pin'],
  ['POST', '/' + BALA + '/otp'],
  ['PUT', '/' + BALA + '/status', { action: 'reactivate' }],
];
/* a sealed host as production boots it (dev-otp.otpPostureErrors): no DEV_OTP, real delivery on, a sender and a from-address */
const SEALED_ENV = { NODE_ENV: 'production', OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test_only', FROM_EMAIL: 'codes@shop.test' };
const withoutEmail = (body) => { if (!body) return body; const copy = Object.assign({}, body); delete copy.email; return copy; };
const sealHost = () => { delete process.env.DEV_OTP; Object.assign(process.env, SEALED_ENV); };
const unsealHost = () => { Object.keys(SEALED_ENV).forEach((k) => { delete process.env[k]; }); process.env.NODE_ENV = 'development'; process.env.DEV_OTP = '1'; };
/* Bala's mailbox as the store holds it, and the two ledgers (writes · e-mails) emptied before each call */
const balaHas = (email) => { STORED_EMAIL = email; WRITES.length = 0; SENT.length = 0; };
const nothingTouched = () => !WRITES.some((write) => /identities/.test(write.sql)) && SENT.length === 0;
const wroteTheCode = () => WRITES.some((write) => /^(UPDATE|INSERT INTO) identities/.test(write.sql) && write.params.includes(SECRET));

/* Section 5 — the sealed host: each code door reads the STORED address, mails the code there and says so; no address → refused
   before any write (W2-PEOPLE: "a sealed reset can send to it" had no end-to-end proof through routes/actors.js). */
async function proveSealedReset() {
  sealHost();
  for (const [method, url, body] of RESET_DOORS) {
    balaHas('bala@shop.test');
    const sent = await call(method, url, body);
    t(method + ' ' + url + ' with an e-mail on file → 200, delivery sent to the masked stored address, the code never in the answer',
      sent.status === 200 && sent.body.delivery === 'sent' && sent.body.sent_to === 'b***@shop.test' && /b\*\*\*@shop\.test/.test(sent.body.delivery_note || '') && !sent.raw.includes(SECRET),
      sent.status + ' ' + sent.raw.slice(0, 200));
    t('   …the code went to the STORED address (not the request), and the row holds it', SENT.length === 1 && SENT[0].to === 'bala@shop.test' && SENT[0].otp === SECRET && wroteTheCode(),
      JSON.stringify(SENT) + ' writes:' + WRITES.length);
    balaHas('');
    const refused = await call(method, url, withoutEmail(body));   /* Add reads the body's address; the resets read the stored one */
    t(method + ' ' + url + ' with NO e-mail on file → 400 EMPLOYEE_EMAIL_REQUIRED in words, nothing written, nothing sent',
      refused.status === 400 && refused.body.code === 'EMPLOYEE_EMAIL_REQUIRED' && /e-mail/i.test(refused.body.message || '') && !refused.raw.includes(SECRET) && nothingTouched(),
      refused.status + ' ' + refused.raw.slice(0, 200) + ' writes:' + WRITES.length + ' sent:' + SENT.length);
  }
  delete process.env.RESEND_API_KEY; balaHas('bala@shop.test');
  const noSender = await call('DELETE', '/' + BALA + '/pin');
  t('sealed with no sender → 503 EMAIL_DELIVERY_NOT_CONFIGURED, nothing written, nothing sent',
    noSender.status === 503 && noSender.body.code === 'EMAIL_DELIVERY_NOT_CONFIGURED' && nothingTouched(), noSender.status + ' ' + noSender.raw.slice(0, 160));
  unsealHost(); STORED_EMAIL = 'v_email';
}
/* Section 6 (PP-03b): both code doors read the person first; the refusal says why with a code, and no code is minted or mailed */
async function proveNoCodeForOff() {
  for (const [state, status, code] of [['deactivated', 400, 'SWITCHED_OFF'], ['removed', 404, 'NOT_FOUND']]) {
    for (const [method, url] of [['DELETE', '/' + BALA + '/pin'], ['POST', '/' + BALA + '/otp']]) {
      BREAK = state; balaHas('bala@shop.test');
      const r = await call(method, url);
      t(method + ' ' + url + ' for a person who is ' + state + ' -> ' + status + ' ' + code + ' with a sentence, nothing written, nothing sent',
        r.status === status && r.body.code === code && /\w+ \w+/.test(r.body.message || '') && !r.raw.includes(SECRET) && nothingTouched(), r.status + ' ' + r.raw.slice(0, 200) + ' writes:' + WRITES.length);
    }
  }
  for (const state of ['active', 'short_break', 'leave']) {
    BREAK = state; balaHas('bala@shop.test');
    const r = await call('POST', '/' + BALA + '/otp');
    t('a person who is ' + state + ' still gets a code -> 200 (away is not off)', r.status === 200 && wroteTheCode(), r.status + ' ' + r.raw.slice(0, 120));
  }
  BREAK = 'active'; STORED_EMAIL = 'v_email';
}
const keysIn = (v, out = []) => { if (v && typeof v === 'object') for (const k of Object.keys(v)) { out.push(k); keysIn(v[k], out); } return out; };

(async () => {
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port + '/api/actors';
  try {
    say('1 · no answer of any /api/actors route contains a code (owner and colleague, every route)');
    for (const who of [['owner', OWNER], ['colleague', COLLEAGUE]]) {
      WHO = who[1];
      for (const [m, u, b] of READS.concat(WRITES_PEOPLE)) {
        const r = await call(m, u, b);
        const bad = keysIn(r.body).filter((k) => BANNED_KEYS.includes(k));
        t(who[0] + ' ' + m + ' ' + u + ' → ' + r.status + ': no code, no code key', !r.raw.includes(SECRET) && !bad.length && r.status < 500,
          r.status + ' ' + (bad.join(',') || '') + ' ' + r.raw.slice(0, 200));
      }
    }
    WHO = COLLEAGUE;
    const list = await call('GET', '/');
    t('GET / says pin_state (none · pending · set) for each person instead', list.body.actors && list.body.actors[0] && list.body.actors[0].pin_state === 'pending', JSON.stringify(list.body).slice(0, 200));
    const src = fs.readFileSync(path.join(API, 'routes', 'actors.js'), 'utf8');
    const listSql = /router\.get\('\/',[\s\S]*?FROM identities/.exec(src)[0];
    t('…the list SELECT names no otp_code column for the answer (only inside the pin_state CASE)', !/^\s*(pin_set_at, )?otp_code,/m.test(listSql) && /AS pin_state/.test(listSql));

    say('\n2 · every people write is the owner\'s — a colleague is refused 403 with may/why, the owner passes');
    for (const [m, u, b] of WRITES_PEOPLE) {
      WHO = COLLEAGUE; const no = await call(m, u, b);
      t('colleague ' + m + ' ' + u + ' → 403 OWNER_ONLY, may:false + why', no.status === 403 && no.body.code === 'OWNER_ONLY' && no.body.may === false && /owner/i.test(no.body.why || ''), no.status + ' ' + no.raw.slice(0, 160));
      WHO = OWNER; const yes = await call(m, u, b);
      t('owner     ' + m + ' ' + u + ' → allowed (' + yes.status + ')', yes.status === 200, yes.status + ' ' + yes.raw.slice(0, 160));
    }
    // a till key is not the owner either (lib/owner isOwner)
    const owner = require(path.join(API, 'lib', 'owner'));
    const fake = { status(c) { this.c = c; return this; }, json(j) { this.j = j; return this; }, locals: {} };
    owner.ownerOnly('Only the owner can change people.')({ api_key: { scopes: ['till'] }, identity: OWNER }, fake, () => { fake.c = 'next'; });
    t('a key on the owner\'s account is refused too (403)', fake.c === 403 && fake.j.code === 'OWNER_ONLY');

    say('\n3 · PEOPLE-EMAIL — stored on Add, edited and cleared on PATCH, a taken one said in words');
    WHO = OWNER; WRITES.length = 0;
    await call('POST', '/', { display_name: 'Bala', actor_key: 'bala', email: '  Bala@Shop.TEST ' });
    const ins = WRITES.find((w) => /^INSERT INTO identities/.test(w.sql));
    t('POST / writes the e-mail column, lowercased', ins && /country, email/.test(ins.sql) && ins.params.includes('bala@shop.test'), ins && ins.sql.slice(0, 200));
    const bad = await call('POST', '/', { display_name: 'Bala', actor_key: 'bala', email: 'not-an-email' });
    t('a malformed e-mail is refused (400), nothing written', bad.status === 400);
    WRITES.length = 0;
    const ed = await call('PATCH', '/' + BALA, { email: 'New@Shop.test' });
    const up = WRITES.find((w) => /^UPDATE identities SET/.test(w.sql));
    t('PATCH edits it (email = $n, lowercased) and answers it back', ed.status === 200 && up && /email = \$\d/.test(up.sql) && up.params.includes('new@shop.test') && 'email' in ed.body.actor, up && up.sql.slice(0, 160));
    WRITES.length = 0;
    await call('PATCH', '/' + BALA, { email: '' });
    const cl = WRITES.find((w) => /^UPDATE identities SET/.test(w.sql));
    t('PATCH with an empty e-mail clears it (NULL)', cl && cl.params[0] === null, cl && JSON.stringify(cl.params));
    throwOn = (s, p) => /email/.test(s) && p.includes('owner@shop.test');
    const taken = await call('PATCH', '/' + BALA, { email: 'owner@shop.test' });
    t('a taken e-mail on PATCH → 409 EMAIL_TAKEN in words', taken.status === 409 && taken.body.code === 'EMAIL_TAKEN' && /another account/.test(taken.body.message), taken.raw);
    const taken2 = await call('POST', '/', { display_name: 'Bala', actor_key: 'bala', email: 'owner@shop.test' });
    t('…and on Add → 409 EMAIL_TAKEN (never "Key taken")', taken2.status === 409 && taken2.body.code === 'EMAIL_TAKEN', taken2.raw);
    throwOn = null;

    say('\n5 · W2-PEOPLE — a sealed host resets through the stored e-mail (the code to the mailbox, the answer says where)');
    WHO = OWNER; await proveSealedReset();

    say('\n6 · PP-03b: no sign-in code for a person who is switched off or removed (refused in words, nothing written, nothing sent)');
    WHO = OWNER; await proveNoCodeForOff();

    say('\n4 · the connector code comes through the one generator');
    const csrc = fs.readFileSync(path.join(API, 'routes', 'connectors.js'), 'utf8');
    t('routes/connectors.js has no generator of its own (no randomInt, no fixedOtp)', !/randomInt|fixedOtp\(/.test(csrc));
    t('…both its codes are generateOTP(\'connector\')', /generateOTP\('connector'\)/.test(csrc) && (csrc.match(/generateOTP\('connector'\)/g) || []).length >= 2);   /* INT6a: SEC2's private genOtp folded into the one door (T2-WRITERS) */
    const devOtp = () => { ['dev-otp', 'otp'].forEach((m) => { delete require.cache[require.resolve(path.join(API, 'lib', m))]; }); return require(path.join(API, 'lib', 'otp.js')); };
    process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/cb';
    const local = devOtp();
    const dv = require(path.join(API, 'lib', 'dev-otp'));
    t('on a local stack: generateOTP(\'connector\') is the fixed connector code, not the entity one', local.generateOTP('connector') === dv.fixedOtp('connector') && local.generateOTP('connector') !== dv.fixedOtp('entity'));
    t('…and generateOTP() with no kind is still the entity code (additive)', local.generateOTP() === dv.fixedOtp('entity'));
    process.env.DATABASE_URL = 'postgres://u:p@db.example.com:5432/cb';
    const remote = devOtp();
    const a = remote.generateOTP('connector');
    t('anywhere else: a random 6-digit code, never a fixed one', /^\d{6}$/.test(a) && a !== require(path.join(API, 'lib', 'dev-otp')).DEFAULTS.connector);
  } finally { server.close(); }
  say('\n' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
