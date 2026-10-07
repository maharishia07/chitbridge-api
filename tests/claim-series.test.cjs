/**
 * tests/claim-series.test.cjs — M11: ONE SERIES ALLOCATOR FOR A COUNTER PC (key) AND A PERSON'S PHONE (device).
 *
 * MASTER-BUILD row 14 · SPEC-iam-build PR 11 "API-4" · D9 (the counter label is assigned to a PHONE NUMBER; an unassigned
 * phone bills under the next free auto label).
 *
 * Proved against the REAL routes/keys.js claimSeries, the REAL routes/counters.js claim(), the REAL lib/holder.js and the
 * REAL routes/identity-docs.js docHash. Only the database is stubbed: one in-memory identities row whose statements are the
 * ones those files send (patchKey's per-key merge, the device till write, the counter merge, the mint's top-level merge),
 * and whose transactions run one at a time (the row lock FOR UPDATE takes in Postgres).
 *
 * Invariants of the row:
 *   I-1  two devices never mint the same bill number — no prefix is ever held by two holders (key or phone), across a
 *        200-step mixed sequence of PC claims, phone claims, assignments, reassignments and revokes
 *   I-2  a bill's till.by is the person who MADE it on this device (lib/holder tillClaimOf; routes/chits.js asks it before the
 *        dedupe): another device → 400; same device, another person signed in → accepted, till.sent_by beside it
 * STOP condition: a pre-M11 key claims EXACTLY the prefix it claims today — same answer, same record written.
 *
 * Run: node tests/claim-series.test.cjs · no DB, no network.
 */
'use strict';
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-claim-series';
const API = path.join(__dirname, '..');

/* ── the database: one shop row; every transaction waits for the one before it (FOR UPDATE) ───────────────────── */
const clone = (x) => JSON.parse(JSON.stringify(x));
let ROW = null;            // { policy_flags }
let BOOKED = [];           // prefixes with bills in chit_header
let DOCS = {};             // identity_id → [{ value_hash, verified }]
const q = async (sql, params) => {
  const s = String(sql);
  const pf = ROW.policy_flags;
  if (/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(s) || /set_config\('app.current_entity'/.test(s)) return { rows: [] };
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: [{ policy_flags: clone(pf) }], rowCount: 1 };
  if (/FROM chit_header/.test(s)) return { rows: BOOKED.map((id) => ({ id })) };
  if (/FROM identity_documents/.test(s)) {
    return { rows: (DOCS[params[0]] || []).filter((d) => d.verified).map((d) => ({ value_hash: d.value_hash })) };
  }
  if (/'\{api_keys\}'/.test(s) && /jsonb_agg/.test(s)) {                      // keys.js patchKey — one key, shallow merge
    const patch = JSON.parse(params[2]);
    pf.api_keys = (pf.api_keys || []).map((k) => (String(k.jti) === String(params[1]) ? Object.assign({}, k, patch) : k));
    return { rows: [] };
  }
  if (/ARRAY\['devices', \$2::text, 'till'\]/.test(s)) {                      // keys.js claimDevice — devices[d].till
    pf.devices[params[1]].till = JSON.parse(params[2]);
    return { rows: [] };
  }
  if (/'\{counters\}'/.test(s) && /jsonb_build_object/.test(s)) {             // counters.patchCounter / claimDevice
    pf.counters = pf.counters || {};
    pf.counters[params[1]] = Object.assign({}, pf.counters[params[1]] || {}, JSON.parse(params[2]));
    return { rows: [] };
  }
  if (/policy_flags = COALESCE\(policy_flags,'\{\}'::jsonb\) \|\| \$1::jsonb/.test(s)) {   // keys.mint — top-level merge
    Object.assign(pf, JSON.parse(params[0]));
    return { rows: [] };
  }
  throw new Error('unexpected SQL in the stub: ' + s.slice(0, 120));
};
let lock = Promise.resolve();
const withTransaction = (fn) => { const run = lock.then(() => fn({ query: q })); lock = run.catch(() => {}); return run; };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) },
  withEntity: async (id, fn) => fn({ query: q }), withTransaction, onEntity: async (id, db, fn) => fn({ query: q }),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, hasTable: async () => true, columns: async () => [], table: async () => ({}) } };

const keys = require(path.join(API, 'routes', 'keys'));
const counters = require(path.join(API, 'routes', 'counters'));
const docs = require(path.join(API, 'routes', 'identity-docs'));
const { holderOf, tillClaimOf } = require(path.join(API, 'lib', 'holder'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const SHOP = 'shop-1';
const tillKey = (jti, created_at, till, extra) => Object.assign({ jti, name: 'pc ' + jti, scopes: ['till'], created_at, till }, extra || {});
const device = (by, till, extra) => Object.assign({ label: 'phone of ' + by, kind: 'till', by, sessions: [{ jti: 's-' + by, surface: 'till' }] },
  till ? { till } : {}, extra || {});
const dev = (device_id, by) => ({ holder: 'dev:' + device_id, kind: 'person', key: null, counter: null, device_id, by,
                                   session: { jti: 's-' + by, device_id, surface: 'till' } });
const keyOf = (jti) => ROW.policy_flags.api_keys.find((k) => k.jti === jti);

/** every prefix a live holder bills under — a closed key's prefix is history (reserved, but nobody mints on it) */
function liveHolders() {
  const pf = ROW.policy_flags, out = [];
  (pf.api_keys || []).filter((k) => k.scopes.includes('till') && !keys.isClosed(k) && k.till && k.till.id)
    .forEach((k) => out.push(['key:' + k.jti, String(k.till.id).toUpperCase()]));
  Object.keys(pf.devices || {}).forEach((d) => { const x = pf.devices[d]; if (x.till && x.till.prefix) out.push(['dev:' + d, x.till.prefix]); });
  return out;
}
function dupes() {
  const seen = {}, bad = [];
  liveHolders().forEach(([h, p]) => { if (seen[p]) bad.push(p + ': ' + seen[p] + ' & ' + h); else seen[p] = h; });
  return bad;
}

(async () => {
  console.log('\nM11 · ONE SERIES ALLOCATOR — keys and phones\n');

  /* ── STOP: a pre-M11 key claims the prefix it claims today ─────────────────────────────────────────────────── */
  /* The expected answers below are what origin/main's claimTill answers for the same rows (re-derived by hand from its
     body and checked by running it): uncontested keeps, older-holds → newer MOVED, fresh → lowest free, booked skipped. */
  ROW = { policy_flags: { api_keys: [
    tillKey('k-old', '2026-09-01T00:00:00Z', { id: 'C1', issued: true }),
    tillKey('k-new', '2026-09-10T00:00:00Z', { id: 'C1', issued: true }),
    tillKey('k-c2', '2026-09-05T00:00:00Z', { id: 'C2', issued: false }),
    tillKey('k-fresh', '2026-09-20T00:00:00Z', undefined),
    { jti: 'k-offers', name: 'offers', scopes: ['offers'], created_at: '2026-08-01T00:00:00Z' },
  ] } };
  BOOKED = ['C1', 'C3'];
  const a1 = await keys.claimSeries(SHOP, holderOf({ kind: 'api_key', jti: 'k-old', scopes: ['till'] }, keyOf('k-old')), { id: 'C1', issued: true });
  t('pre-M11 key, uncontested, issued: keeps C1 (same answer as today)', a1 && a1.id === 'C1' && a1.clash === null && !a1.moved_from, JSON.stringify(a1));
  t('  and writes the same record: till { id:C1, issued:true }', keyOf('k-old').till.id === 'C1' && keyOf('k-old').till.issued === true);
  const a2 = await keys.claimTill(SHOP, 'k-new', { id: 'C1', issued: true });
  t('pre-M11 key, newer on C1 with bills: MOVED to the lowest free (C4 — C2 held, C3 booked), moved_from C1',
    a2 && a2.id === 'C4' && a2.moved_from === 'C1' && a2.held_by === 'pc k-old', JSON.stringify(a2));
  const a3 = await keys.claimSeries(SHOP, 'key:k-c2', { id: 'C2', issued: false });
  t('pre-M11 key with C2, nothing issued: keeps C2', a3 && a3.id === 'C2' && keyOf('k-c2').till.id === 'C2', JSON.stringify(a3));
  const a4 = await keys.claimSeries(SHOP, 'key:k-fresh', {});
  t('a fresh key: the lowest prefix nobody holds or billed under (C5)', a4 && a4.id === 'C5', JSON.stringify(a4));
  const again = await keys.claimSeries(SHOP, 'key:k-fresh', { id: 'C5', issued: true });
  t('  and claims the same C5 every time after (the format never changes for an existing counter)', again.id === 'C5' && !again.moved_from);
  t('a non-till holder (offers key, legacy person token) holds no series → null',
    (await keys.claimSeries(SHOP, 'key:nope', {})) === null && (await keys.claimSeries(SHOP, { holder: 'person:x' }, {})) === null);

  /* the named-counter branch (counters.open/claim) — unchanged */
  ROW.policy_flags.counters = { C2: { id: 'C2', name: 'Front', next: 42, period: '26-27', held_by: 'k-c2' } };
  keyOf('k-c2').counter = 'C2';
  const a5 = await keys.claimSeries(SHOP, 'key:k-c2', { id: 'C2', issued: true });
  t('a key opened for a registered counter: that counter, resume_next 42 (unchanged)', a5.id === 'C2' && a5.counter === 'C2' && a5.resume_next === 42, JSON.stringify(a5));

  /* ── a phone: next free auto label ──────────────────────────────────────────────────────────────────────────── */
  ROW.policy_flags.devices = { 'dev-aaaa-1111': device('p1'), 'dev-bbbb-2222': device('p2') };
  ROW.policy_flags.counters.C6 = { id: 'C6', name: 'Back', held_by: null };      // registered, closed, unassigned
  const d1 = await keys.claimSeries(SHOP, dev('dev-aaaa-1111', 'p1'), { id: 'C1', issued: false });
  t('unassigned phone → next free auto label (C7: C1 C2 C4 C5 held, C3 booked, C6 a registered counter)', d1 && d1.id === 'C7', JSON.stringify(d1));
  t('  told once, in words: "This phone bills as C7."', d1.said === 'This phone bills as C7.');
  t('  kept on its device listing: devices[d].till.prefix (no SQL)', ROW.policy_flags.devices['dev-aaaa-1111'].till.prefix === 'C7');
  const d2 = await keys.claimSeries(SHOP, dev('dev-bbbb-2222', 'p2'), {});
  t('a second phone → C8, never the first phone\'s C7', d2.id === 'C8', JSON.stringify(d2));
  const d1b = await keys.claimSeries(SHOP, dev('dev-aaaa-1111', 'p1'), { id: 'C7', issued: true });
  t('the same phone again keeps C7, not moved', d1b.id === 'C7' && !d1b.moved_from && ROW.policy_flags.devices['dev-aaaa-1111'].till.issued === true);
  ROW.policy_flags.api_keys.push(tillKey('k-later', '2026-10-01T00:00:00Z', undefined));
  const k9 = await keys.claimSeries(SHOP, 'key:k-later', {});
  t('a key paired after the phones never gets a phone\'s prefix (C9)', k9.id === 'C9', JSON.stringify(k9));
  t('key holder and dev holder never share a prefix', dupes().length === 0, dupes().join('; '));
  t('an unknown or revoked device holds no series → null',
    (await keys.claimSeries(SHOP, dev('dev-none-0000', 'px'), {})) === null);

  /* ── D9: a counter label assigned to a PHONE NUMBER ─────────────────────────────────────────────────────────── */
  ROW.policy_flags.counters.A1 = { id: 'A1', name: 'Phone counter', next: 17, period: '26-27', held_by: null,
                                   assigned: { phone: '+919876543210' } };
  DOCS.p3 = [{ value_hash: docs.docHash('PHONE', '919876543210'), verified: true }];   // filed without the '+'
  DOCS.p4 = [{ value_hash: docs.docHash('PHONE', '+919876543210'), verified: false }];  // typed, never verified
  ROW.policy_flags.devices['dev-cccc-3333'] = device('p3');
  ROW.policy_flags.devices['dev-dddd-4444'] = device('p4');
  ROW.policy_flags.devices['dev-eeee-5555'] = device('p3');                          // the same person's second phone
  const d3 = await keys.claimSeries(SHOP, dev('dev-cccc-3333', 'p3'), {});
  t('assigned phone (verified PHONE document = the number) gets its label A1', d3.id === 'A1' && d3.counter === 'A1', JSON.stringify(d3));
  t('  and continues the counter\'s run (resume_next 17)', d3.resume_next === 17 && d3.resume_period === '26-27');
  t('  the register names the phone as holder (dev:…), so a PC cannot open it on top',
    ROW.policy_flags.counters.A1.held_by === 'dev:dev-cccc-3333');
  const pc = await counters.claim({ entity_id: SHOP, identity: { bridge_id: 'b', display_name: 'S' }, id: 'A1' });
  t('  a PC asking for A1 is refused 409 COUNTER_HELD', pc.status === 409 && pc.body.code === 'COUNTER_HELD', JSON.stringify(pc.body && pc.body.code));
  const d4 = await keys.claimSeries(SHOP, dev('dev-dddd-4444', 'p4'), {});
  t('a typed phone without verify is NOT matched → next free label', d4.id !== 'A1' && !d4.counter, JSON.stringify(d4));
  const d5 = await keys.claimSeries(SHOP, dev('dev-eeee-5555', 'p3'), {});
  t('the same person\'s second phone does NOT also get A1 (two devices, one number) → a free label', d5.id !== 'A1' && !!d5.id, JSON.stringify(d5));
  t('no prefix held twice after assignment', dupes().length === 0, dupes().join('; '));

  /* reassign A1 to another number: the old phone moves off (moved, not stopped); the label follows once it has */
  ROW.policy_flags.counters.A1.assigned = { phone: '+911111111111' };
  DOCS.p5 = [{ value_hash: docs.docHash('PHONE', '+911111111111'), verified: true }];
  ROW.policy_flags.devices['dev-ffff-6666'] = device('p5');
  const early = await keys.claimSeries(SHOP, dev('dev-ffff-6666', 'p5'), {});
  t('newly assigned phone does NOT take A1 while the old phone still holds it (it may be billing offline)', early.id !== 'A1', JSON.stringify(early));
  const moved = await keys.claimSeries(SHOP, dev('dev-cccc-3333', 'p3'), { id: 'A1', issued: true });
  t('the old phone is MOVED off A1 to a free prefix, moved_from A1', moved.id && moved.id !== 'A1' && moved.moved_from === 'A1', JSON.stringify(moved));
  t('  and lets go of the register', ROW.policy_flags.counters.A1.held_by === null);
  const late = await keys.claimSeries(SHOP, dev('dev-ffff-6666', 'p5'), {});
  t('then the newly assigned phone takes A1', late.id === 'A1' && late.resume_next === 17, JSON.stringify(late));
  t('no prefix held twice after reassignment', dupes().length === 0, dupes().join('; '));

  /* a revoked phone keeps its prefix reserved — its kept bills carry that number */
  const revokedPrefix = ROW.policy_flags.devices['dev-bbbb-2222'].till.prefix;
  ROW.policy_flags.devices['dev-bbbb-2222'].revoked_at = '2026-10-07T00:00:00Z';
  ROW.policy_flags.devices['dev-gggg-7777'] = device('p6');
  const d7 = await keys.claimSeries(SHOP, dev('dev-gggg-7777', 'p6'), {});
  t('a revoked phone\'s prefix (' + revokedPrefix + ') is never handed to another phone', d7.id !== revokedPrefix, JSON.stringify(d7));
  t('a revoked phone itself is refused a series → null', (await keys.claimSeries(SHOP, dev('dev-bbbb-2222', 'p2'), {})) === null);

  /* ── I-1 · 200 mixed steps, concurrently queued: never one prefix on two holders ──────────────────────────── */
  ROW = { policy_flags: { api_keys: [tillKey('m-0', '2026-09-01T00:00:00Z', { id: 'C1', issued: true })], devices: {}, counters: {} } };
  BOOKED = ['C2'];
  DOCS = {};
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const LABELS = ['B1', 'B2', 'B3'];
  LABELS.forEach((id) => { ROW.policy_flags.counters[id] = { id, name: id, held_by: null }; });
  const bad = [];
  for (let step = 0; step < 200; step++) {
    const pf = ROW.policy_flags;
    const r = rnd(10);
    const batch = [];
    if (r < 3) {                                                     // a new phone signs in
      const id = 'dev-mix-' + String(step).padStart(4, '0'); const by = 'person' + rnd(6);
      pf.devices[id] = device(by);
      batch.push(keys.claimSeries(SHOP, dev(id, by), { issued: rnd(2) === 1 }));
    } else if (r < 5) {                                              // a new PC pairs
      pf.api_keys.push(tillKey('m-' + step, new Date(Date.UTC(2026, 9, 1, 0, step)).toISOString(), undefined));
      batch.push(keys.claimSeries(SHOP, 'key:m-' + step, {}));
    } else if (r < 7) {                                              // the owner (re)assigns a label to someone's number
      const who = 'person' + rnd(6), label = LABELS[rnd(3)], phone = '+9190000000' + who.slice(-1).padStart(2, '0');
      DOCS[who] = [{ value_hash: docs.docHash('PHONE', phone), verified: true }];
      pf.counters[label].assigned = { phone };
    } else if (r < 8) {                                              // the owner revokes a phone
      const ids = Object.keys(pf.devices); if (ids.length) pf.devices[ids[rnd(ids.length)]].revoked_at = 'x';
    }
    /* and every listed holder re-claims at the same moment (snapshots racing) */
    Object.keys(pf.devices).forEach((d) => batch.push(keys.claimSeries(SHOP, dev(d, pf.devices[d].by), { issued: true, id: (pf.devices[d].till || {}).prefix })));
    pf.api_keys.forEach((k) => batch.push(keys.claimSeries(SHOP, 'key:' + k.jti, { issued: true, id: (k.till || {}).id })));
    await Promise.all(batch);
    const d = dupes(); if (d.length) bad.push('step ' + step + ': ' + d.join('; '));
  }
  t('I-1 · 200 mixed steps (pairings, sign-ins, assignments, revokes, racing re-claims): no prefix ever held twice',
    bad.length === 0, bad.slice(0, 3).join(' | '));
  t('  and the pre-M11 key m-0 kept C1 throughout', keyOf('m-0').till.id === 'C1');
  t('  and no live holder billed under a booked prefix it was handed fresh (C2)', !liveHolders().some(([h, p]) => p === 'C2'));

  /* ── I-2 · a bill's till.by is the signed-in person ────────────────────────────────────────────────────────── */
  const phoneH = holderOf({ identity_id: 'p1', identity_type: 'entity', jti: 's1', device_id: 'dev-aaaa-1111', kind: 'person' }, null, { counter: 'C7' });
  const keyH = holderOf({ kind: 'api_key', jti: 'k1', scopes: ['till'] }, { till: { id: 'C1' }, by: null });
  t('T9 · a key holds as key:, a phone as dev: (lib/holder)', keyH.holder === 'key:k1' && phoneH.holder === 'dev:dev-aaaa-1111' && phoneH.by === 'p1');
  const ok1 = tillClaimOf(phoneH, { till: { id: 'C7', device_id: 'dev-aaaa-1111', by: 'p1' } });
  t('phone bill naming its own device and person → ok, stamped', ok1.ok && ok1.stamp.by === 'p1');
  const bj = { till: { id: 'C7' } }; const ok2 = tillClaimOf(phoneH, bj); if (ok2.stamp) Object.assign(bj.till, ok2.stamp);
  t('phone bill that names nobody → stamped with the session\'s device and person', bj.till.device_id === 'dev-aaaa-1111' && bj.till.by === 'p1');
  const m1 = tillClaimOf(phoneH, { till: { id: 'C7', device_id: 'dev-zzzz-9999', by: 'p1' } });
  t('another device → 400 TILL_CLAIM_MISMATCH (device_id)', !m1.ok && m1.code === 'TILL_CLAIM_MISMATCH' && m1.field === 'device_id');
  const bj2 = { till: { id: 'C7', device_id: 'dev-aaaa-1111', by: 'someone-else' } };
  const m2 = tillClaimOf(phoneH, bj2); if (m2.stamp) Object.assign(bj2.till, m2.stamp);
  t('same phone, another person signed in → ACCEPTED (never stranded), marked sentByOther', m2.ok && m2.sentByOther === true && !m2.code);
  t('  till.by kept as the person who MADE the bill; till.sent_by = the session person', bj2.till.by === 'someone-else' && bj2.till.sent_by === 'p1' && bj2.till.device_id === 'dev-aaaa-1111');
  const bj3 = { till: { id: 'C7', by: 'someone-else' } }; const m3 = tillClaimOf(phoneH, bj3); if (m3.stamp) Object.assign(bj3.till, m3.stamp);
  t('  a missing device_id is still filled from the session', m3.ok && bj3.till.device_id === 'dev-aaaa-1111' && bj3.till.by === 'someone-else');
  t('  same-person bill carries no sent_by and no sentByOther', !ok1.sentByOther && !('sent_by' in ok1.stamp));
  const k1 = tillClaimOf(keyH, { till: { id: 'C1', by: 'shift-person', device_id: 'anything' } });
  t('a KEY\'s bill (shop PC) is not checked and not stamped — bills exactly as before', k1.ok && !k1.stamp);
  t('a bill with no till (not a counter bill) is untouched', tillClaimOf(phoneH, { schema_values: {} }).ok && !tillClaimOf(phoneH, {}).stamp);

  /* ── the wiring: one code path for both holders ─────────────────────────────────────────────────────────────── */
  const TILL = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  const CHITS = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  const KEYS = fs.readFileSync(path.join(API, 'routes', 'keys.js'), 'utf8');
  const COUNTERS = fs.readFileSync(path.join(API, 'routes', 'counters.js'), 'utf8');
  t('T9 · /api/till/snapshot claims through keys.claimSeries(entity, req.till) for a key AND a device',
    /keys\.claimSeries\(entity_id, req\.till,/.test(TILL) && /req\.till\.device_id/.test(TILL) && !/keys\.claimTill\(/.test(TILL));
  const send = CHITS.slice(CHITS.indexOf("router.post('/send'"));
  t('/api/chits/send logs kind sent_by_other and still refuses only another device (400)',
    send.indexOf("if (tillClaim.sentByOther) res.locals.kind = 'sent_by_other';") > 0
    && send.indexOf("return res.status(400).json({ error: 'Bill claim mismatch'") > 0);
  t('T9 · /api/chits/send asks tillClaimOf(req.till, …) BEFORE the client_ref dedupe',
    send.indexOf('tillClaimOf(req.till') > 0 && send.indexOf('tillClaimOf(req.till') < send.indexOf('await sameRefLook(sender_id, client_ref)'));
  t('one allocator: claimTill is claimSeries asked as a key; one bookedPrefixes (counters.js reads keys\')',
    /router\.claimTill = \(entity_id, jti, ask\) => router\.claimSeries\(entity_id, 'key:' \+ jti, ask\)/.test(KEYS)
    && (KEYS.match(/FROM chit_header/g) || []).length === 1 && !/FROM chit_header/.test(COUNTERS)
    && /keys\.bookedPrefixes\(db, entity_id\)/.test(COUNTERS));
  t('moved-not-stopped kept (rival, older, moved_from, held_by)', /MOVED, NOT STOPPED/.test(KEYS) && /moved_from: using, held_by: rival\.name/.test(KEYS));
  t('POST /api/counters/:id/assign exists, owner only', /router\.post\('\/:id\/assign'/.test(COUNTERS) && /isOwner\(req\)/.test(COUNTERS));

  console.log('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL crashed: ' + (e && e.stack || e)); process.exit(1); });
