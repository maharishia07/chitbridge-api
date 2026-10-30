/**
 * tests/housekeeping-guards.test.cjs — ⭐⭐ W2-RAIL R2: THE HOUSEKEEPING GUARDS FAIL CLOSED, AND THE STATUS WORDS HAVE ONE TABLE.
 *
 *   A  lib/rail-actions canHousekeep, unit: delete/purge of a sent or received copy → co_held_record; an open dispute → dispute_open;
 *      a count that could not be read (null) → disputes_unknown — never "none"; a draft with no dispute → ok; each refusal carries its sentence
 *   B  DELETE /chits/:id over the REAL route (stand-in db): a sent copy 409 co_held_record · a received copy 409 · a draft trashed ·
 *      a draft with an open dispute 409 dispute_open · the dispute table down → 503 disputes_unknown, nothing written · a stranger 404
 *   C  POST /chits/:id/archive: ok · open dispute 409 · table down 503 and NOT archived (it used to answer 0 and archive) · ONE transaction
 *   D  DELETE /chits/:id/purge answers the same draft rule, with the code
 *   E  POST /chits/:id/reprice asks the rail question (`amend`): a stranger 404 not_participant · a commenter 403 comment_only ·
 *      a viewer 403 · the holder passes the rail (source: railActions.can(…, 'amend') on the route)
 *   F  the ONE status table: derived from the engine (STATES = rail.TRANSITIONS keys, buckets ⊂ STATES, open ∪ close = STATES, ASKABLE =
 *      every transition target = the old isIn list) — and THE GUARD: no second spelling of a bucket in lib/ or routes/ (adopted engines excepted)
 *   G  lib/page-limit: a cap says so — capped + cap_note when ?limit= exceeds the max and more exists, or a route's own ceiling cut rows;
 *      nothing when the list is whole; chits.js lists and folders /:id/chits spread it (source)
 *
 * Run: node tests/housekeeping-guards.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-housekeeping';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the cast and the store ──────────────────────────────────────────────────────────────────────────────────── */
const S = 'aaaaaaaa-0000-4000-8000-00000000000a';   // sends C1 to R
const R = 'bbbbbbbb-0000-4000-8000-00000000000b';   // receives C1
const X = 'eeeeeeee-0000-4000-8000-00000000000e';   // holds nothing
const C1 = '0000c417-0000-4000-8000-0000000000c1', D1 = '0000c417-0000-4000-8000-0000000000d1';
const ACTORS = {   // co-assists of R: what auth reads with break_status
  'a-cmt': { parent: R, access_level: 'commenter', whole_entity: true, hat: 'audit' },
  'a-vw':  { parent: R, access_level: 'viewer', whole_entity: false, hat: 'view_only' },
};
let COPIES = [], OPEN_DISPUTES = 0, DISPUTES_DOWN = false, SENT = [], TX = 0;
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const mine = (chit, ent) => COPIES.filter((r) => r.chit_id === chit && r.entity_id === ent);
function rowsFor(sql, p) {
  const s = one(sql); p = p || [];
  SENT.push(s);
  if (/break_status/.test(s) && /FROM identities/.test(s)) { const a = ACTORS[p[0]]; return a ? [{ break_status: 'active', hat: a.hat, access_level: a.access_level, whole_entity: a.whole_entity }] : []; }
  if (/COUNT\(\*\)::int AS count FROM chit_disputes/.test(s)) { if (DISPUTES_DOWN) { const e = new Error('relation "chit_disputes" does not exist'); e.code = '42P01'; throw e; } return [{ count: OPEN_DISPUTES }]; }
  if (/^SELECT cs\.current_status, ch\.role FROM chit_status cs/.test(s)) return mine(p[0], p[1]).map((r) => ({ current_status: r.current_status, role: r.role }));
  if (/^SELECT role, created_by_actor_id FROM chit_header/.test(s)) return mine(p[0], p[1]).map((r) => ({ role: r.role, created_by_actor_id: r.entity_id }));
  if (/^SELECT 1 FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return mine(p[0], p[1]).map(() => ({ '?column?': 1 }));
  if (/^UPDATE chit_status SET archived_at = NOW\(\)/.test(s)) return mine(p[0], p[1]).map((r) => { r.archived_at = 'now'; return { chit_id: r.chit_id }; });
  if (/^UPDATE chit_status SET deleted_at = NOW\(\)/.test(s)) { mine(p[0], p[1]).forEach((r) => { r.deleted_at = 'now'; }); return []; }
  return [];
}
const q = async (sql, p) => { const rows = rowsFor(sql, p); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => { TX++; return fn(tx); }, withTransaction: async (fn) => { TX++; return fn(tx); }, onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => false; sc.hasTable = async () => false;
const logger = require(path.join(API, 'lib', 'logger'));
const LOGGED = []; const origFell = logger.fellBack; logger.fellBack = (what, err, level) => { LOGGED.push(String(what)); return origFell(what, err, 'debug'); };
const origErr = console.error; console.error = () => {};

const rail = require(path.join(API, 'lib', 'rail'));
const RA = require(path.join(API, 'lib', 'rail-actions'));
const PL = require(path.join(API, 'lib', 'page-limit'));
const chits = require(path.join(API, 'routes', 'chits'));
const app = express(); app.use(express.json()); app.use('/api/chits', chits);
const tok = (id, type, parent) => jwt.sign(Object.assign({ identity_id: id, identity_type: type, display_name: 'who-' + id.slice(0, 5) },
  parent ? { parent_entity_id: parent } : {}), process.env.JWT_SECRET, { algorithm: 'HS256' });
const entity = (id) => tok(id, 'entity');
const actor = (id) => tok(id, 'actor', ACTORS[id].parent);
function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; });
        res.on('end', () => { srv.close(); let j = null; try { j = JSON.parse(b); } catch (_) {} done({ status: res.statusCode, body: j || {} }); });
      });
      r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
      r.end(data);
    });
  });
}
/* the world: C1 sent by S to R (Act · To), D1 a draft of S */
function world(opts) {
  const o = opts || {};
  COPIES = [
    { chit_id: C1, entity_id: S, direction: 'sent', role: 'Act', current_status: 'delivered' },
    { chit_id: C1, entity_id: R, direction: 'received', role: 'To', current_status: 'pending' },
    { chit_id: D1, entity_id: S, direction: 'sent', role: 'Draft', current_status: 'delivered' },
  ];
  OPEN_DISPUTES = o.disputes || 0; DISPUTES_DOWN = !!o.down; SENT = []; TX = 0; LOGGED.length = 0;
}
const written = () => SENT.filter((s) => /^(UPDATE|INSERT|DELETE)/.test(s));
const says = (r, why, status) => r.status === status && r.body.why === why && r.body.code === why && r.body.message === RA.HOUSEKEEP_WHY[why];

(async () => {
  console.log('\n— A · canHousekeep: the verdicts, unit —');
  const v = (a, f) => RA.canHousekeep(a, f);
  t('delete of a SENT copy (role Act) → co_held_record, with its sentence', v('delete', { role: 'Act', open_disputes: 0 }).why === 'co_held_record' && v('delete', { role: 'Act', open_disputes: 0 }).say === RA.HOUSEKEEP_WHY.co_held_record);
  t('delete of a RECEIVED copy (role To) → co_held_record', v('delete', { role: 'To', open_disputes: 0 }).why === 'co_held_record');
  t('purge answers the same draft rule', v('purge', { role: 'Act', open_disputes: 0 }).why === 'co_held_record' && v('purge', { role: 'Draft', open_disputes: 0 }).ok === true);
  t('a draft with an open dispute → dispute_open', v('delete', { role: 'Draft', open_disputes: 1 }).why === 'dispute_open');
  t('⭐ a dispute count that could not be read (null) → disputes_unknown — never read as none (fail CLOSED)', v('delete', { role: 'Draft', open_disputes: null }).why === 'disputes_unknown' && v('archive', { open_disputes: undefined }).why === 'disputes_unknown');
  t('archive ignores the draft rule (it only hides): a sent copy with no dispute → ok', v('archive', { role: 'Act', open_disputes: 0 }).ok === true);
  t('a draft with no dispute → ok to delete', v('delete', { role: 'Draft', open_disputes: 0 }).ok === true);
  let threw = false; try { v('void', {}); } catch (_) { threw = true; }
  t('an unknown housekeeping action throws (never assumed allowed)', threw);
  t('every housekeeping word has a sentence and a status (409 record/dispute · 503 unknown)',
    Object.keys(RA.HOUSEKEEP_WHY).every((w) => RA.HOUSEKEEP_WHY[w].length > 0 && RA.HOUSEKEEP_STATUS[w] > 0) && RA.HOUSEKEEP_STATUS.disputes_unknown === 503 && RA.HOUSEKEEP_STATUS.co_held_record === 409);
  t('refuse() accepts a housekeeping word beside the rail\'s (one refusal function)', (() => { let out = null; const res = { status(c) { return { json(b) { out = Object.assign({ status: c }, b); } }; } }; RA.refuseHousekeep(res, v('archive', { open_disputes: null })); return out && out.status === 503 && out.why === 'disputes_unknown' && out.code === 'disputes_unknown'; })());

  console.log('\n— B · DELETE /chits/:id over the real route —');
  world();
  let r = await call('DELETE', '/api/chits/' + C1, entity(S));
  t('the sender trashing its SENT copy → 409 co_held_record (code · why · the sentence as message), nothing written', says(r, 'co_held_record', 409) && written().length === 0, r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('DELETE', '/api/chits/' + C1, entity(R));
  t('the receiver trashing its RECEIVED copy → 409 co_held_record', says(r, 'co_held_record', 409) && written().length === 0, r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('DELETE', '/api/chits/' + D1, entity(S));
  t('a DRAFT is trashed (200), its copy marked deleted and the timeline row written', r.status === 200 && COPIES[2].deleted_at === 'now' && written().length === 2, r.status + ' ' + JSON.stringify(r.body));
  world({ disputes: 1 });
  r = await call('DELETE', '/api/chits/' + D1, entity(S));
  t('a draft with an OPEN dispute → 409 dispute_open, nothing written', says(r, 'dispute_open', 409) && written().length === 0, r.status + ' ' + JSON.stringify(r.body));
  world({ down: true });
  r = await call('DELETE', '/api/chits/' + D1, entity(S));
  t('⭐ the dispute table unreadable → 503 disputes_unknown, nothing written, and the fall-back is LOGGED', says(r, 'disputes_unknown', 503) && written().length === 0 && LOGGED.some((w) => /openOn/.test(w)), r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('DELETE', '/api/chits/' + C1, entity(X));
  t('a stranger → 404 (told nothing)', r.status === 404 && !r.body.why, r.status + ' ' + JSON.stringify(r.body));

  console.log('\n— C · POST /chits/:id/archive —');
  world();
  r = await call('POST', '/api/chits/' + C1 + '/archive', entity(R));
  t('no dispute → archived (200), in ONE transaction', r.status === 200 && COPIES[1].archived_at === 'now' && TX === 1, r.status + ' tx=' + TX + ' ' + JSON.stringify(r.body));
  world({ disputes: 2 });
  r = await call('POST', '/api/chits/' + C1 + '/archive', entity(R));
  t('an open dispute → 409 dispute_open, not archived', says(r, 'dispute_open', 409) && !COPIES[1].archived_at, r.status + ' ' + JSON.stringify(r.body));
  world({ down: true });
  r = await call('POST', '/api/chits/' + C1 + '/archive', entity(R));
  t('⭐ the dispute table unreadable → 503 disputes_unknown and NOT archived (it used to count 0 and archive)', says(r, 'disputes_unknown', 503) && !COPIES[1].archived_at && written().length === 0, r.status + ' ' + JSON.stringify(r.body));
  const SRC = CF.read(API);
  const archiveSrc = SRC.slice(SRC.indexOf("router.post('/:chit_id/archive'"), SRC.indexOf("router.put('/:chit_id/star'"));
  t('the archive route has no empty catch and no count-of-zero fallback', !/\.catch\(\s*\(\)\s*=>/.test(archiveSrc) && !/count: 0/.test(archiveSrc));

  console.log('\n— D · DELETE /chits/:id/purge —');
  world();
  r = await call('DELETE', '/api/chits/' + C1 + '/purge', entity(S));
  t('purge of a sent copy → 409 co_held_record (one rule with the trash door)', says(r, 'co_held_record', 409) && written().length === 0, r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('DELETE', '/api/chits/' + D1 + '/purge', entity(S));
  t('purge of my own draft → 200, its rows deleted', r.status === 200 && written().filter((s) => /^DELETE/.test(s)).length >= 5, r.status + ' ' + JSON.stringify(r.body));

  console.log('\n— E · POST /chits/:id/reprice asks the rail (amend) —');
  world();
  r = await call('POST', '/api/chits/' + C1 + '/reprice', entity(X), { preview: true });
  t('a stranger → 404 with the engine\'s word not_participant', r.status === 404 && r.body.why === 'not_participant', r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('POST', '/api/chits/' + C1 + '/reprice', actor('a-cmt'), { preview: true });
  /* the hat gate (middleware/auth) answers a restricted hat first, in its own words; when the rail answers, its word is comment_only */
  t('a commenter of the receiver → 403 (preview too: the door is the `amend` answer; the word, when the rail says it, is comment_only)', r.status === 403 && (!r.body.why || r.body.why === 'comment_only'), r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('POST', '/api/chits/' + C1 + '/reprice', actor('a-vw'), { preview: true });
  t('a viewer → 403', r.status === 403, r.status + ' ' + JSON.stringify(r.body));
  world();
  r = await call('POST', '/api/chits/' + C1 + '/reprice', entity(R), { preview: true });
  t('the holder passes the rail question (no refusal word; the stand-in has no line rows → 503 from lib/reprice, which is after the gate)', r.status !== 403 && r.status !== 404 && !r.body.why, r.status + ' ' + JSON.stringify(r.body));
  const repriceSrc = SRC.slice(SRC.indexOf("router.post('/:chit_id/reprice'"), SRC.indexOf("router.post('/:chit_id/costs'"));
  t('source: the reprice route asks railActions.can(…, \'amend\') and refuses with ownCopyRefusalOf', /railActions\.can\([\s\S]{0,160}?'amend'\)/.test(repriceSrc) && /ownCopyRefusalOf/.test(repriceSrc));

  console.log('\n— F · the ONE status table, derived from the engine —');
  t('STATES = the keys of rail.TRANSITIONS', JSON.stringify(RA.STATES) === JSON.stringify(Object.keys(rail.TRANSITIONS)));
  const all = [].concat(RA.BUCKETS.open, RA.BUCKETS.act, RA.BUCKETS.close);
  t('open ∪ act ∪ close = STATES, no overlap, no stranger', all.length === RA.STATES.length && new Set(all).size === all.length && all.every((s) => RA.STATES.includes(s)));
  t('OPEN_STATES = open + act · CLOSED_STATES = close', JSON.stringify(RA.OPEN_STATES) === JSON.stringify(RA.BUCKETS.open.concat(RA.BUCKETS.act)) && RA.CLOSED_STATES === RA.BUCKETS.close);
  t('ASKABLE = every transition target = the list PUT /status accepted before (delivered · read are the system\'s)',
    JSON.stringify([...RA.ASKABLE].sort()) === JSON.stringify(['pending', 'accepted', 'rejected', 'in_progress', 'partial', 'completed', 'cancelled'].sort()) && !RA.ASKABLE.includes('delivered') && !RA.ASKABLE.includes('read'));
  t('ARRIVAL: the `to` party acts (pending), cc / for are informed (delivered); an unknown kind is informed', RA.arrivalStatus('to') === 'pending' && RA.arrivalStatus('cc') === 'delivered' && RA.arrivalStatus('for') === 'delivered' && RA.arrivalStatus('zz') === 'delivered' && RA.SENT_STATUS === 'delivered');
  t('CLOSED_SQL is the closed set, quoted', RA.CLOSED_SQL === "'completed','cancelled','rejected'");
  /* THE GUARD: no second spelling of a bucket outside the table (adopted engines and the table itself excepted) */
  const ADOPTED = new Set(['rail.js', 'workflow.js', 'rail-actions.js']);
  const spelled = [];
  const BUCKET_RE = [/\[\s*'pending'\s*,\s*'delivered'\s*,\s*'read'/, /'completed'\s*,\s*'cancelled'\s*,\s*'rejected'/, /\[\s*'accepted'\s*,\s*'in_progress'\s*,\s*'partial'/, /'pending'\s*,\s*'accepted'\s*,\s*'rejected'\s*,\s*'in_progress'/];
  for (const dir of ['lib', 'routes']) for (const f of fs.readdirSync(path.join(API, dir))) {
    if (!/\.js$/.test(f) || ADOPTED.has(f)) continue;
    const src = fs.readFileSync(path.join(API, dir, f), 'utf8').split('\n');
    src.forEach((line, i) => { if (/^\s*(\/\/|\*)/.test(line)) return; if (BUCKET_RE.some((re) => re.test(line))) spelled.push(dir + '/' + f + ':' + (i + 1)); });
  }
  t('⭐ GUARD: no lib/ or routes/ file spells a status bucket again (was 11 places)', spelled.length === 0, spelled.join(', '));
  t('chits.js reads BUCKETS / ASKABLE / arrivalStatus from the table', /railActions\.BUCKETS\[/.test(SRC) && /oneOfTrimmed\(railActions\.ASKABLE\)/.test(fs.readFileSync(path.join(API, 'lib', 'chits-input.js'), 'utf8')) && (SRC.match(/railActions\.arrivalStatus\(receiver\.kind\)/g) || []).length === 2);

  console.log('\n— G · a cap says so (lib/page-limit) —');
  const pg500 = PL.pageArgs({ limit: '500' }, 20, 200);
  t('pageArgs records the clamp: asked 500 of max 200 → limit 200, capped true, max 200', pg500.limit === 200 && pg500.capped === true && pg500.max === 200 && PL.pageArgs({ limit: '50' }, 20, 200).capped === false);
  t('capOf: asked for more than the max and more exists → capped + the sentence (what you see · what to do)', JSON.stringify(PL.capOf(pg500, 200, 900)) === JSON.stringify({ capped: true, cap_note: 'Showing 200 of 900. Narrow the search, or load the next page.' }));
  t('capOf: asked for more than the max, the total not known on this page (keyset) → the max in words', PL.capOf(pg500, 200, null).cap_note === 'A page shows at most 200. Load the next page for more.');
  t('capOf: asked for more than the max but everything fit → nothing (the list is whole)', JSON.stringify(PL.capOf(pg500, 3, 3)) === '{}');
  t('capOf: not asked, the route\'s own ceiling kept rows back → capped (folders /:id/chits at 100)', PL.capOf(PL.pageArgs({}, 50, 200), 100, 250).capped === true);
  t('capOf: a plain page (asked 50, got 50 of 900) → nothing: paging is not capping', JSON.stringify(PL.capOf(PL.pageArgs({ limit: '50' }, 20, 200), 50, 900)) === '{}');
  const outCut = PL.pageOut('chits', [1, 2], PL.pageArgs({}, 50, 200), 7);
  t('pageOut: not asked + a statement total above the rows → limit = rows answered, capped + cap_note', outCut.limit === 2 && outCut.total === 7 && outCut.capped === true && /Showing 2 of 7/.test(outCut.cap_note));
  t('pageOut: a whole list carries no cap keys (the envelope is unchanged for every list that was never cut)', JSON.stringify(Object.keys(PL.pageOut('x', [1, 2], PL.pageArgs({}, 50, 200))).sort()) === JSON.stringify(['limit', 'page', 'total', 'x']));
  t('chits.js: inbox · sent · folder spread PAGE_LIMIT.capOf (three lists, one helper listPage)', (SRC.match(/PAGE_LIMIT\.capOf\(pg, result\.rows\.length, total\)/g) || []).length === 3 && (SRC.match(/= listPage\(req\)/g) || []).length === 3);
  const FSRC = fs.readFileSync(path.join(API, 'routes', 'folders.js'), 'utf8');
  /* the rows handed to pageOut may be pruned or renamed first (API-8 sweep, RAIL-146j cost-view): what matters is that pageOut gets the total */
  t('folders.js /:id/chits: the whole count rides in the statement (COUNT(*) OVER()), the ceiling is named, pageOut gets the total', /COUNT\(\*\) OVER\(\) AS _total/.test(FSRC) && /FOLDER_LIST_MAX = 100/.test(FSRC) && /PL\.pageOut\('chits', [^;]{1,200}?, pg, (?:filed\.)?total\)/.test(FSRC) && !/LIMIT 100/.test(FSRC));

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
