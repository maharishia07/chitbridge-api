/**
 * tests/dispute-scoping.test.cjs — A DISPUTE IS SEEN ONLY BY THE PARTIES ON ITS ROSTER (N02, MASTER-BUILD-2026-10 row 4).
 *
 * Written against TODAY's routes/chits.js dispute routes, BEFORE any extraction, so the extraction has a fence to land inside.
 * The USP rule (dispute confidentiality). Three invariants:
 *   I1  a dispute is visible only to the parties on its roster
 *   I2  a party that is not on the roster never receives a notification about it (no state_log row, no message copy, no bell)
 *   I3  resolving it for one party never closes it for another
 *
 * The cast, all four on ONE chit:  A raises · B and D are named parties · C is a participant of the chit who is NOT named.
 * X is on no chit at all.
 *
 *   1  raise: the roster is A + B (+ D); A cannot dispute itself; a duplicate open category is refused (per-copy guard)
 *   2  C sees nothing: GET /disputes empty · /diagnosis empty · /disputes/queue empty · no dispute message copy · no state_log
 *      row · nothing in GET /notifications · cannot resolve (404) · cannot post into it (403)
 *   3  per-party resolve: A clears B → B resolved, D still open, A still open; then A clears D → closed for all
 *   4  the doors that read the same rows: the ledger's buyer gate (lib/books-store openDisputes, read by lib/books-hooks
 *      buyerGate) and the RAIDA escalation link (POST /:chit_id/raida/:raida_id/dispute → lib/raida linkDispute)
 *   5  the two doors that used to break I2 (were KNOWN BREAKS, fixed and promoted): a dispute reply's timeline line + bell go
 *      to the roster only; a resolve naming a non-party target is refused 400 DISPUTE_TARGET_NOT_PARTY. KNOWN() stays for the
 *      next break found: assert it AS BROKEN, and promote it to ok() the day it is fixed.
 *
 * ⭐ THE DATABASE IS MODELLED, NOT MOCKED FLAT. Disputes are per-copy under FORCE RLS (b68), so a flat stub would prove
 * nothing. The in-memory store below holds one row per (dispute, entity) and every read inside withEntity(me) sees only
 * MY rows — exactly the rls_entity policy. The definers are transcribed from the migrations that are live:
 *   chit_dispute_deliver / chit_dispute_resolve  — migrations/b103_definers_b50_standard.sql (caller checks, raiser-only)
 *   chit_dispute_roster                           — migrations/b68_disputes_percopy.sql
 *   chit_message_deliver (9 + 10 arg)             — b103 + b155 (dispute → roster only, fail closed)
 *   chit_log_targets                              — migration_b51 (writes only to targets that are chit participants)
 *   chit_log_all                                  — migration_b50 (writes to EVERY chit participant)
 * If a migration changes one of these, change the model here in the same PR.
 *
 * No database, no network beyond 127.0.0.1: db and auth are stubbed; the routes are the real ones (the bills-private.test.cjs
 * pattern).   Run: node tests/dispute-scoping.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
delete process.env.CB_DISPUTE_WIDEN_CATEGORIES;   // the opt-in widening is a deliberate chit-wide audience; not under test here

const A = 'aaaaaaaa-0000-4000-8000-00000000000a', B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c', D = 'dddddddd-0000-4000-8000-00000000000d';
const X = 'eeeeeeee-0000-4000-8000-00000000000e';
const CH = '0000c417-0000-4000-8000-000000000001';
const NAME = { [A]: 'Mayur Traders', [B]: 'Chola Auto Care', [C]: 'Third Logistics', [D]: 'Delta Packers', [X]: 'Xeno Outsider' };

/* ═══ THE STORE — per-copy tables, RLS on every read inside withEntity ═══════════════════════════════════════════ */
let STATUS, DISPUTES, LOG, MSGS, RAIDA, SQL, BELL;
function reset() {
  STATUS = [A, B, C, D].map((e) => ({ chit_id: CH, entity_id: e, current_status: 'pending', deleted_at: null }));
  DISPUTES = []; LOG = []; MSGS = []; SQL = []; BELL = [];
  RAIDA = [A, B, C].map((e) => ({ entity_id: e, raida_id: 'r-' + e.slice(0, 1), kind: 'issue', chit_id: CH, dispute_id: null }));
}
const rlsErr = (t) => new Error('new row violates row-level security policy for table "' + t + '"');
const raise = (m) => { const e = new Error(m); e.code = 'P0001'; return e; };
const mine = (rows, ctx) => (ctx ? rows.filter((r) => r.entity_id === ctx) : rows);   // ⭐ the rls_entity policy
const isPart = (e) => STATUS.some((s) => s.chit_id === CH && s.entity_id === e);

/* chit_message_deliver — b103 (+ b155's line_id stamp). The audience rule is the thing under test, so it is transcribed. */
function messageDeliver(ctx, p) {
  const [mid, chit, sender, sname, thread, text, mtype, isDisp, did] = p;
  if (!ctx) throw raise('chit_message_deliver: no entity context');
  if (sender !== ctx) throw raise('chit_message_deliver: claimed sender <> caller');
  if (!STATUS.some((s) => s.chit_id === chit && s.entity_id === ctx)) throw raise('chit_message_deliver: sender is not a participant');
  const row = (e, t) => ({ message_id: mid, entity_id: e, chit_id: chit, sender_entity_id: ctx, sender_display_name: sname, thread_type: t,
    message_text: text, msg_type: mtype || 'info', is_dispute: !!isDisp, dispute_id: did || null, line_id: p[9] || null, created_at: new Date().toISOString() });
  if (thread === 'internal') { MSGS.push(row(ctx, 'internal')); return; }
  if (isDisp && did) {
    const copies = DISPUTES.filter((d) => d.dispute_id === did && d.chit_id === chit);
    if (!copies.length) throw raise('chit_message_deliver: dispute does not belong to chit');
    if (!copies.some((d) => d.entity_id === ctx)) throw raise('chit_message_deliver: sender is not a party to dispute');
    if ((copies[0].scope || 'targeted') !== 'chit_wide') {
      const aud = [...new Set(copies.map((d) => d.entity_id))];
      if (!aud.length) throw raise('no resolvable roster — refusing to broadcast');
      aud.forEach((e) => MSGS.push(row(e, 'external')));
      return;
    }
  }
  [...new Set(STATUS.filter((s) => s.chit_id === chit).map((s) => s.entity_id))].forEach((e) => MSGS.push(row(e, thread)));
}

function run(sql, p, ctx) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  SQL.push({ s, p, ctx });
  p = p || [];
  /* the two reads whose text also names other tables — matched first */
  if (/FROM chit_disputes cd WHERE cd.status = 'open'/.test(s)) return mine(DISPUTES, ctx).filter((d) => d.status === 'open');   // the queue
  /* ── the bell's feed (routes/notifications.js FEED_FROM) — state_log under RLS = my own rows ── */
  if (/FROM state_log sl/.test(s)) return mine(LOG, ctx).filter((l) => l.chit_id === CH && (l.action_by_identity_id !== p[1] || /^dispute_|^voided$/.test(l.action)))
    .map((l) => Object.assign({ log_id: 'l' + LOG.indexOf(l), created_at: new Date().toISOString() }, l));
  /* probes */
  if (/to_regprocedure/.test(s)) return [{ ok: true }];
  if (/information_schema/.test(s)) return [];
  /* identities */
  if (/SELECT display_name, status, is_erased FROM identities/.test(s)) return NAME[p[0]] ? [{ display_name: NAME[p[0]], status: 'active', is_erased: false }] : [];
  if (/SELECT identity_id, display_name FROM identities WHERE identity_id = ANY/.test(s)) return (p[0] || []).filter((id) => NAME[id]).map((id) => ({ identity_id: id, display_name: NAME[id] }));
  if (/FROM identities/.test(s)) return [];
  /* chit_status — the participant gate, RLS-scoped */
  if (/^SELECT .{1,40} FROM chit_status WHERE chit_id ?= ?\$1 AND entity_id ?= ?\$2/.test(s))
    return mine(STATUS, ctx).filter((r) => r.chit_id === p[0] && r.entity_id === p[1]).map((r) => Object.assign({ ok: 1 }, r));
  if (/chit_participant_parity\(/.test(s)) return STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1]).map((r) => ({ deleted_at: r.deleted_at }));
  if (/FROM chit_header ch JOIN chit_status cs/.test(s)) return [{ auto_subject: 'Order 7 — brake pads', summary_json: {}, my_status: 'pending' }];
  if (/FROM chit_header WHERE chit_id=\$1 AND entity_id=\$2/.test(s)) return [{ auto_subject: 'Order 7 — brake pads', schema_version: 1 }];
  if (/FROM chit_header/.test(s)) return [{ sender_entity_id: A, all_recipients: [{ entity_id: B }, { entity_id: C }, { entity_id: D }] }];
  if (/FROM chit_detail/.test(s)) return [];
  /* ── the definers ── */
  if (/SELECT chit_dispute_deliver\(/.test(s)) {
    const [did, chit, raiser, rname, target, tname, scope, mode, answerable, parity, via, cat, reason, ev, roster, audience] = p;
    if (!ctx) throw raise('chit_dispute_deliver: no entity context');
    if (raiser !== ctx) throw raise('chit_dispute_deliver: claimed raiser <> caller');
    if (!isPart(ctx)) throw raise('chit_dispute_deliver: raiser is not a participant');
    for (const e of audience) {
      if (DISPUTES.some((d) => d.dispute_id === did && d.entity_id === e)) continue;   // ON CONFLICT DO NOTHING
      DISPUTES.push({ dispute_id: did, entity_id: e, role: e === raiser ? 'raiser' : 'party', roster: JSON.parse(roster), chit_id: chit,
        raised_by_entity_id: raiser, raised_by_display_name: rname, target_entity_id: target, target_display_name: tname, scope, mode, answerable,
        parity_state: parity, via, category: cat, reason, evidence_snapshot: JSON.parse(ev), status: 'open', created_at: new Date().toISOString() });
    }
    return [{}];
  }
  if (/SELECT chit_dispute_resolve\(/.test(s)) {
    const [did, resolver, target, note] = p;
    if (!ctx) throw raise('chit_dispute_resolve: no entity context');
    if (resolver !== ctx) throw raise('chit_dispute_resolve: claimed resolver <> caller');
    if (!DISPUTES.some((d) => d.dispute_id === did && d.entity_id === ctx && d.role === 'raiser')) throw raise('chit_dispute_resolve: only the raiser can resolve');
    const close = (d) => Object.assign(d, { status: 'resolved', resolution_note: note, resolved_by_entity_id: ctx, resolved_at: new Date().toISOString() });
    DISPUTES.filter((d) => d.dispute_id === did && d.role === 'party' && (!target || d.entity_id === target)).forEach(close);
    const remaining = DISPUTES.filter((d) => d.dispute_id === did && d.role === 'party' && d.status === 'open').length;
    if (remaining === 0) { DISPUTES.filter((d) => d.dispute_id === did && d.role === 'raiser').forEach(close); return [{ all_resolved: true }]; }
    return [{ all_resolved: false }];
  }
  if (/FROM chit_dispute_roster\(\$1\)/.test(s)) {
    let r = DISPUTES.filter((d) => d.dispute_id === p[0]);   // definer: reads every copy
    if (/role='party' AND status='open'/.test(s)) r = r.filter((d) => d.role === 'party' && d.status === 'open');
    return r.map((d) => ({ entity_id: d.entity_id, role: d.role, status: d.status, resolved_at: d.resolved_at || null }));
  }
  if (/SELECT chit_message_deliver\(/.test(s)) { messageDeliver(ctx, p); return [{ created_at: new Date().toISOString() }]; }
  if (/SELECT chit_log_targets\(/.test(s)) {
    const [chit, ids, action, actor, aname, detail] = p;
    if (!ctx) throw raise('chit_log_targets: no entity context');
    if (!isPart(ctx)) throw raise('chit_log_targets: caller is not a participant');
    [...new Set(ids)].filter((e) => isPart(e)).forEach((e) => LOG.push({ chit_id: chit, entity_id: e, action, action_by_identity_id: actor, action_by_display_name: aname, detail }));
    return [{}];
  }
  if (/SELECT chit_log_all\(/.test(s)) {
    const [chit, action, actor, aname, , , detail] = p;
    if (!ctx) throw raise('chit_log_all: no entity context');
    if (!isPart(ctx)) throw raise('chit_log_all: caller is not a participant');
    [...new Set(STATUS.filter((x) => x.chit_id === chit).map((x) => x.entity_id))]
      .forEach((e) => LOG.push({ chit_id: chit, entity_id: e, action, action_by_identity_id: actor, action_by_display_name: aname, detail }));
    return [{}];
  }
  /* state_log own-copy insert — RLS WITH CHECK: only my own row */
  if (/^INSERT INTO state_log/.test(s)) {
    if (ctx && p[1] !== ctx) throw rlsErr('state_log');
    const m = s.match(/VALUES \(\$1, ?\$2, ?'(\w+)'/);
    LOG.push({ chit_id: p[0], entity_id: p[1], action: m ? m[1] : '?', action_by_identity_id: p[2], action_by_display_name: p[3], detail: p[4] });
    return [];
  }
  /* ── chit_disputes reads, RLS-scoped ── */
  if (/^SELECT dispute_id FROM chit_disputes WHERE chit_id=\$1 AND raised_by_entity_id=\$2 AND status='open' AND category=\$3/.test(s))
    return mine(DISPUTES, ctx).filter((d) => d.chit_id === p[0] && d.raised_by_entity_id === p[1] && d.status === 'open' && d.category === p[2]
      && String(d.target_entity_id || '') === String(p[3] || '')).map((d) => ({ dispute_id: d.dispute_id }));
  if (/FROM chit_disputes WHERE dispute_id = \$1 AND chit_id = \$2/.test(s))
    return mine(DISPUTES, ctx).filter((d) => d.dispute_id === p[0] && d.chit_id === p[1]);
  if (/COUNT\(\*\)::int AS n FROM chit_disputes WHERE entity_id = \$1 AND chit_id = \$2 AND status = 'open'/.test(s))   // books-store.openDisputes
    return [{ n: mine(DISPUTES, ctx).filter((d) => d.entity_id === p[0] && d.chit_id === p[1] && d.status === 'open').length }];
  if (/FROM chit_disputes WHERE chit_id ?= ?\$1/.test(s)) return mine(DISPUTES, ctx).filter((d) => d.chit_id === p[0]);           // GET + diagnosis
  /* ── messages ── */
  if (/^SELECT \* FROM chit_messages WHERE chit_id = \$1/.test(s))
    return mine(MSGS, ctx).filter((m) => m.chit_id === p[0] && (!/is_dispute = true/.test(s) || m.is_dispute));
  /* ── RAIDA: the register is per-entity too ── */
  if (/^UPDATE \S+ SET dispute_id = \$3 WHERE entity_id = \$1 AND raida_id = \$2 AND kind = 'issue'/.test(s)) {
    if (ctx && p[0] !== ctx) return [];
    const r = mine(RAIDA, ctx).find((x) => x.entity_id === p[0] && x.raida_id === p[1] && x.kind === 'issue');
    if (!r) return []; r.dispute_id = p[2]; return [{ raida_id: r.raida_id }];
  }
  if (/SELECT COUNT\(/.test(s)) return [{ count: 0, n: 0 }];
  return [];
}
const txFor = (ctx) => ({ query: async (s, p) => { const rows = run(s, p, ctx); return { rows, rowCount: rows.length }; } });

/* ═══ STUBS — db, auth, the bell; the routes are the real ones ════════════════════════════════════════════════════ */
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => txFor(null).query(s, p),                       // owner/definer path — no entity context
  withEntity: async (id, fn) => fn(txFor(id)), withTransaction: async (fn) => fn(txFor(null)),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(db && db.query ? db : txFor(id)),
} };
let WHO = A;
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: WHO, identity_type: 'entity', display_name: NAME[WHO] }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
try { const sc = require(path.join(API, 'lib', 'schema')); sc.hasColumn = async () => true; sc.hasTable = async () => true; sc.hasColumns = async () => ({}); } catch (_) {}
try { require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({}); } catch (_) {}
try { require(path.join(API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) {}
try { require(path.join(API, 'lib', 'storage')).listForMessages = async () => []; } catch (_) {}
const events = require(path.join(API, 'lib', 'events'));
events.notifyAfter = (res, ids, evt) => { BELL.push({ ids: (ids || []).map(String), evt }); };
events.emit = (ids, evt) => { BELL.push({ ids: (ids || []).map(String), evt }); };

/* lib/raida — the escalation door; its table shape is resolved at runtime, so answer as phase 0 (b182) */
const raida = require(path.join(API, 'lib', 'raida'));
const booksStore = require(path.join(API, 'lib', 'books-store'));

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
app.use('/api/notifications', require(path.join(API, 'routes', 'notifications')));

let pass = 0, fail = 0, known = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
/**
 * ⚠️ A KNOWN BREAK of an invariant in TODAY's code. Asserted as broken (so the guard stays green while it is), counted, and printed
 * loud. The day the product code is fixed this flips to FAIL with the instruction to promote it to an ok() — never delete it.
 */
const KNOWN = (name, stillBroken, where) => {
  if (stillBroken) { known++; pass++; console.log('   ⚠️ KNOWN BREAK  ' + name + '\n          at ' + where); }
  else { fail++; console.log('   FAIL (FIXED?) ' + name + '\n          the break at ' + where + ' no longer reproduces — turn this KNOWN into an ok() asserting the invariant'); }
};
const disputesOf = (e) => DISPUTES.filter((d) => d.entity_id === e);
const logOf = (e, re) => LOG.filter((l) => l.entity_id === e && (!re || re.test(l.action)));
const msgsOf = (e) => MSGS.filter((m) => m.entity_id === e);
const rang = (e) => BELL.some((b) => b.ids.indexOf(e) >= 0);

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const as = async (who, m, u, body) => { WHO = who; const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const U = '/api/chits/' + CH;
  try {
    console.log('\n══ 1 · RAISE — the roster is the raiser and the parties named ══\n');
    reset();
    const self = await as(A, 'POST', U + '/disputes', { category: 'quality', reason: 'Brake pads arrived cracked', target_entity_id: A });
    ok('not-self: A cannot raise a dispute against itself (400), and nothing is written', self.status === 400 && /yourself/.test(self.body.message || '') && DISPUTES.length === 0, JSON.stringify(self));
    const xr = await as(X, 'POST', U + '/disputes', { category: 'quality', reason: 'I am not on this chit at all', target_entity_id: B });
    ok('a non-participant of the chit cannot raise one (403)', xr.status === 403 && DISPUTES.length === 0, JSON.stringify(xr));

    const r1 = await as(A, 'POST', U + '/disputes', { category: 'quality', reason: 'Brake pads arrived cracked, 4 of 10', target_entity_id: B });
    const D1 = r1.body.dispute_id;
    ok('A raises a TARGETED quality dispute against B', r1.status === 200 && D1 && r1.body.scope === 'targeted' && r1.body.mode === 'two_sided', JSON.stringify(r1.body));
    ok('…exactly two copies exist: A (raiser) and B (party) — none for C or D',
      DISPUTES.filter((d) => d.dispute_id === D1).map((d) => d.entity_id + ':' + d.role).sort().join() === [A + ':raiser', B + ':party'].sort().join(),
      JSON.stringify(DISPUTES.map((d) => [d.entity_id, d.role])));
    ok('…the roster snapshot names A and B only', JSON.stringify(disputesOf(B)[0].roster.map((x) => x.entity_id)) === JSON.stringify([A, B]));
    ok('…the reason went as a dispute message to A and B only (roster-scoped deliver)',
      MSGS.filter((m) => m.dispute_id === D1).map((m) => m.entity_id).sort().join() === [A, B].sort().join(), JSON.stringify(MSGS.map((m) => m.entity_id)));
    ok('…B has a dispute_raised notice on its own timeline; A has its own', logOf(B, /^dispute_raised$/).length === 1 && logOf(A, /^dispute_raised$/).length === 1);

    const dup = await as(A, 'POST', U + '/disputes', { category: 'quality', reason: 'Same complaint raised a second time', target_entity_id: B });
    ok('no duplicate open category: the same quality dispute against B again → 400, nothing new written',
      dup.status === 400 && /already have an open quality/.test(dup.body.message || '') && DISPUTES.filter((d) => d.dispute_id !== D1).length === 0, JSON.stringify(dup));
    const other = await as(A, 'POST', U + '/disputes', { category: 'delivery', reason: 'Delivered two days after promised', target_entity_id: B });
    ok('…a different category against the same party is allowed', other.status === 200 && other.body.dispute_id && other.body.dispute_id !== D1);
    const bdup = await as(B, 'POST', U + '/disputes', { category: 'quality', reason: 'From my side the pads were fine', target_entity_id: A });
    ok('…the guard is per RAISER: B may raise its own quality dispute against A', bdup.status === 200, JSON.stringify(bdup));

    console.log('\n══ 2 · THE THIRD PARTICIPANT SEES NOTHING ══\n');
    const gc = await as(C, 'GET', U + '/disputes');
    ok('C: GET /disputes is empty (C is a participant of the chit, not of any dispute)', gc.status === 200 && Array.isArray(gc.body.disputes) && gc.body.disputes.length === 0 && gc.body.open_count === 0, JSON.stringify(gc.body));
    const ga = await as(A, 'GET', U + '/disputes');
    ok('…while A sees its two raised + the one raised against it, each with its roster', ga.body.disputes.length === 3
      && ga.body.disputes.every((d) => (d.participants || []).length === 2) && ga.body.disputes.every((d) => d.evidence_snapshot === undefined && d.has_evidence === true), JSON.stringify(ga.body));
    const gb = await as(B, 'GET', U + '/disputes');
    ok('…and B sees the same three (it is on every roster)', gb.body.disputes.length === 3);
    const gd = await as(D, 'GET', U + '/disputes');
    ok('…and D, also on the chit and also unnamed, sees none', gd.body.disputes.length === 0);
    const gx = await as(X, 'GET', U + '/disputes');
    ok('X (not on the chit): GET /disputes → 403', gx.status === 403);
    const dg = await as(C, 'GET', U + '/diagnosis');
    ok('C: GET /diagnosis has no card', dg.status === 200 && dg.body.count === 0, JSON.stringify(dg.body));
    const q = await as(C, 'GET', '/api/chits/disputes/queue');
    ok('C: GET /disputes/queue is empty', q.status === 200 && q.body.total_open === 0, JSON.stringify(q.body));
    const qb = await as(B, 'GET', '/api/chits/disputes/queue');
    ok('…B\'s queue holds 3, two of them "against me" (other_disputes)', qb.body.total_open === 3 && qb.body.other_disputes.length === 2 && qb.body.my_disputes.length === 1, JSON.stringify(qb.body));
    const mc = await as(C, 'GET', U + '/messages?dispute=1');
    ok('C: no dispute message copy in its thread', mc.status === 200 && (mc.body.messages || []).length === 0 && msgsOf(C).length === 0, JSON.stringify(mc.body));
    ok('C: no state_log row about any dispute (the notification source)', logOf(C).length === 0, JSON.stringify(logOf(C)));
    ok('C: no bell rang for C while disputes were raised', !rang(C), JSON.stringify(BELL));
    const nc = await as(C, 'GET', '/api/notifications');
    const ncRows = nc.body.notifications || nc.body.rows || nc.body.items || [];
    ok('C: GET /notifications carries nothing about a dispute', nc.status === 200 && JSON.stringify(nc.body).indexOf('dispute') < 0 && ncRows.length === 0, JSON.stringify(nc.body).slice(0, 300));
    const nb = await as(B, 'GET', '/api/notifications');
    ok('…while B\'s feed does carry the dispute_raised notice', /dispute_raised/.test(JSON.stringify(nb.body)), JSON.stringify(nb.body).slice(0, 300));
    const rc = await as(C, 'PUT', U + '/disputes/' + D1 + '/resolve', { resolution_note: 'I will close this for them' });
    ok('C cannot resolve it: 404 (it does not exist for C), nothing changed', rc.status === 404 && DISPUTES.filter((d) => d.dispute_id === D1).every((d) => d.status === 'open'), JSON.stringify(rc));
    const pc = await as(C, 'POST', U + '/messages', { message_text: 'Let me weigh in on this dispute', thread_type: 'external', is_dispute: true, dispute_id: D1 });
    ok('C cannot post into it: 403 "Not a party to this dispute", no message written', pc.status === 403 && /Not a party/.test(pc.body.message || '') && MSGS.filter((m) => m.sender_entity_id === C).length === 0, JSON.stringify(pc));

    console.log('\n══ 3 · PER-PARTY RESOLVE — clearing one party never closes it for another ══\n');
    reset();
    const m = await as(A, 'POST', U + '/disputes', { category: 'quantity', reason: 'Short by 3 cartons on both legs', participant_entity_ids: [B, D] });
    const D2 = m.body.dispute_id;
    ok('A raises one quantity dispute naming B and D (the checklist)', m.status === 200 && m.body.scope === 'targeted'
      && DISPUTES.filter((d) => d.dispute_id === D2).map((d) => d.entity_id).sort().join() === [A, B, D].sort().join(), JSON.stringify(DISPUTES.map((d) => d.entity_id)));
    ok('…C has no copy and no notice', disputesOf(C).length === 0 && logOf(C).length === 0 && msgsOf(C).length === 0);
    const rb = await as(B, 'PUT', U + '/disputes/' + D2 + '/resolve', { resolution_note: 'From my side it is settled' });
    ok('B (a party, not the raiser) cannot resolve: 403, and D\'s copy stays open', rb.status === 403 && disputesOf(D)[0].status === 'open' && disputesOf(B)[0].status === 'open', JSON.stringify(rb));
    const r_b = await as(A, 'PUT', U + '/disputes/' + D2 + '/resolve', { resolution_note: 'B credited 3 cartons', target_entity_id: B });
    ok('A clears B only → "still open for the others"', r_b.status === 200 && r_b.body.fully_resolved === false && r_b.body.status === 'open', JSON.stringify(r_b.body));
    ok('…B\'s copy resolved · D\'s copy OPEN · A\'s copy OPEN', disputesOf(B)[0].status === 'resolved' && disputesOf(D)[0].status === 'open' && disputesOf(A)[0].status === 'open');
    const vd = await as(D, 'GET', U + '/disputes');
    ok('…D still reads it open (open_count 1), with B shown resolved and itself open on the roster', vd.body.open_count === 1
      && (vd.body.disputes[0].participants.find((x) => x.entity_id === B) || {}).dispute_status === 'resolved'
      && (vd.body.disputes[0].participants.find((x) => x.entity_id === D) || {}).dispute_status === 'open', JSON.stringify(vd.body));
    ok('…the dispute_resolved notice went to B only — not D, not C', logOf(B, /^dispute_resolved$/).length === 1 && logOf(D, /^dispute_resolved$/).length === 0 && logOf(C).length === 0);
    ok('…the resolution note went to the roster only (A, B, D), never C', MSGS.filter((x) => /^\[resolved\]/.test(x.message_text)).map((x) => x.entity_id).sort().join() === [A, B, D].sort().join());
    const again = await as(A, 'PUT', U + '/disputes/' + D2 + '/resolve', { resolution_note: 'B again', target_entity_id: B });
    ok('clearing B a second time does not touch D', again.status === 200 && again.body.fully_resolved === false && disputesOf(D)[0].status === 'open');
    const r_d = await as(A, 'PUT', U + '/disputes/' + D2 + '/resolve', { resolution_note: 'D credited 3 cartons', target_entity_id: D });
    ok('A clears D → now fully resolved, closed on every copy', r_d.body.fully_resolved === true && DISPUTES.filter((d) => d.dispute_id === D2).every((d) => d.status === 'resolved'), JSON.stringify(r_d.body));
    const twice = await as(A, 'PUT', U + '/disputes/' + D2 + '/resolve', { resolution_note: 'once more' });
    ok('…a closed dispute cannot be resolved again (400)', twice.status === 400);

    console.log('\n══ 4 · THE OTHER DOORS READ THE SAME PER-COPY ROWS ══\n');
    reset();
    const l = await as(A, 'POST', U + '/disputes', { category: 'payment', reason: 'Invoice total does not match PO', target_entity_id: B });
    const D3 = l.body.dispute_id;
    const od = async (e) => { const { withEntity } = require(dbPath); return withEntity(e, (db) => booksStore.openDisputes(db, e, CH)); };
    ok('ledger door (books-store.openDisputes → books-hooks buyerGate): A 1 · B 1 · C 0', (await od(A)) === 1 && (await od(B)) === 1 && (await od(C)) === 0);
    ok('…C cannot read B\'s count by naming B (RLS: inside withEntity(C) the rows are C\'s only)',
      (await require(dbPath).withEntity(C, (db) => booksStore.openDisputes(db, B, CH))) === 0);
    await as(A, 'PUT', U + '/disputes/' + D3 + '/resolve', { resolution_note: 'Corrected invoice issued' });
    ok('…after the resolve the ledger reads 0 for A and B — the bill it held is released', (await od(A)) === 0 && (await od(B)) === 0);

    reset();
    const rr = await as(A, 'POST', U + '/disputes', { category: 'docs', reason: 'Certificate of analysis missing', target_entity_id: B });
    const D4 = rr.body.dispute_id;
    const sch = require(path.join(API, 'lib', 'schema'));
    const _ht = sch.hasTable; sch.hasTable = async (t) => t === 'chit_line_raida';
    const _hc = sch.hasColumn; sch.hasColumn = async () => false;
    const lk = await as(A, 'POST', U + '/raida/r-a/dispute', { dispute_id: D4 });
    ok('RAIDA door: A links its issue to the dispute it raised', lk.status === 200 && RAIDA.find((x) => x.entity_id === A).dispute_id === D4, JSON.stringify(lk));
    ok('…the link stamps A\'s own register row only — B\'s and C\'s are untouched', RAIDA.filter((x) => x.entity_id !== A).every((x) => x.dispute_id === null));
    ok('…and the link raises nothing: still exactly the two copies (A, B), no copy for C', DISPUTES.length === 2 && disputesOf(C).length === 0);
    const lc = await as(C, 'POST', U + '/raida/r-c/dispute', { dispute_id: D4 });
    const gc2 = await as(C, 'GET', U + '/disputes');
    ok('…C linking that id to its own issue does not make the dispute visible to C', gc2.body.disputes.length === 0 && disputesOf(C).length === 0 && logOf(C).length === 0, 'link ' + lc.status + ' ' + JSON.stringify(gc2.body));
    sch.hasTable = _ht; sch.hasColumn = _hc;

    console.log('\n══ 5 · I2 at the two doors that used to leak (fixed in fix/dispute-confidentiality) ══\n');
    /* (a) a dispute REPLY. The UI's dispute composer (chitbridge-web cap-dispute.js:229) posts thread_type 'external' with
       is_dispute. The message copies are roster-only, and since the fix so are the 'message_sent' timeline line
       (chit_log_targets to the roster, not chit_log_all) and the bell (the roster, not the chit header's parties). */
    reset();
    const k1 = await as(A, 'POST', U + '/disputes', { category: 'quality', reason: 'Brake pads arrived cracked, 4 of 10', target_entity_id: B });
    const DK = k1.body.dispute_id;
    BELL = [];
    const rep = await as(B, 'POST', U + '/messages', { message_text: 'We will replace the 4 cracked pads at our cost', thread_type: 'external', is_dispute: true, dispute_id: DK });
    ok('B replies inside the dispute (200); the message copies go to the roster only (A, B)', rep.status === 200
      && MSGS.filter((x) => x.dispute_id === DK && /replace the 4/.test(x.message_text)).map((x) => x.entity_id).sort().join() === [A, B].sort().join(), JSON.stringify(rep));
    const leakLog = logOf(C, /^message_sent$/).filter((x) => /cracked pads/.test(x.detail || ''));
    ok('I2: a dispute reply writes NO message_sent row into C\'s state_log (C is not on the roster)', leakLog.length === 0, JSON.stringify(logOf(C)));
    ok('…while A and B (the roster) each get the reply line on their own timeline',
      logOf(A, /^message_sent$/).length === 1 && logOf(B, /^message_sent$/).length === 1 && logOf(D).length === 0, JSON.stringify(LOG.map((x) => [x.entity_id, x.action])));
    const nk = await as(C, 'GET', '/api/notifications');
    ok('I2: …so C\'s GET /notifications does not show it', nk.status === 200 && !/cracked pads/.test(JSON.stringify(nk.body)), JSON.stringify(nk.body).slice(0, 300));
    ok('I2: …and C\'s bell does not ring for it (nor D\'s); A\'s does', !rang(C) && !rang(D) && rang(A), JSON.stringify(BELL));
    BELL = []; const before = logOf(C).length;
    const plain = await as(B, 'POST', U + '/messages', { message_text: 'Plain note to everyone on the order', thread_type: 'external' });
    ok('…a plain (non-dispute) external message still reaches every participant\'s timeline and bell, as before',
      plain.status === 200 && logOf(C).length === before + 1 && rang(C) && rang(A), JSON.stringify(BELL));

    /* (b) a per-party resolve naming someone NOT on the roster. The route used to trust body.target_entity_id for the
       notice list (chit_log_targets only checks CHIT membership); it now refuses a target that is not a roster party. */
    reset();
    const k2 = await as(A, 'POST', U + '/disputes', { category: 'quality', reason: 'Brake pads arrived cracked, 4 of 10', target_entity_id: B });
    const DK2 = k2.body.dispute_id;
    const mis = await as(A, 'PUT', U + '/disputes/' + DK2 + '/resolve', { resolution_note: 'Settled: credit note CN-17 for 4 pads', target_entity_id: C });
    ok('A "resolves" for C, who is not on the roster → 400 DISPUTE_TARGET_NOT_PARTY',
      mis.status === 400 && mis.body.code === 'DISPUTE_TARGET_NOT_PARTY' && mis.body.error && mis.body.message, JSON.stringify(mis));
    ok('…B\'s copy stays open (I3 holds) and C has no copy', disputesOf(B)[0].status === 'open' && disputesOf(C).length === 0);
    ok('I2: …C receives no dispute_resolved notice (no category, no resolution note)',
      logOf(C).length === 0 && !MSGS.some((x) => /CN-17/.test(x.message_text) && x.entity_id === C), JSON.stringify(logOf(C)));
    ok('…and nothing is resolved or announced at all (no [resolved] message, no notice to anyone)',
      !MSGS.some((x) => /CN-17/.test(x.message_text)) && logOf(A, /^dispute_resolved$/).length === 0 && logOf(B, /^dispute_resolved$/).length === 0);
  } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack)); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed' + (known ? ' (' + known + ' of the passes are KNOWN BREAKS — see section 5)' : '') + ' · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
