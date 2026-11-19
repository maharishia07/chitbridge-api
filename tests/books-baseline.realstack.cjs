'use strict';
/**
 * tests/books-baseline.realstack.cjs — AUDITOR RANK 10 ("changed since my last check") on a REAL Postgres, as the app role (RLS on): migration b875, lib/books-baseline.js, the practice read's Last look and changed count.
 *
 * WHY REAL POSTGRES: the count is a SQL predicate on journal_entry.created_at, the baseline is an insert-only table in the FIRM's entity under row security, and the corrected Last look is a SQL max over the look log; a stub cannot show any of them.
 * Run on a THROWAWAY database built from migrations/ (sit-grund: tools/fresh-db-check.cjs), never a shared one:
 *   ADMIN=postgres://postgres:...@host/db APP=postgres://cb_app:...@host/db node tests/books-baseline.realstack.cjs
 * ADMIN seeds rows under this run's own ids (deleted where the books allow it) and APP (cb_app, RLS on) reads them. Without both variables it says so and exits 0 (not part of the offline guard).
 * HAND-COMPUTED  firm F; staff A and B; clients C1 (entries e1..e5) and C2 (one entry); both under a live auditor grant, granted 10 days ago.
 *   e1..e3 posted 5 days ago, e4 posted 2 days ago, e5 posted 1 day ago with a posting date a year back (back-dated). C2: one entry 3 days ago.
 *   P10.1/K6  A looked at C1 2 hours ago (GET /daybook); B looked 1 hour ago; a REFUSED look by A 30 minutes ago; reading Home twice: A's Last look = 2 hours ago both times, and the list read wrote 2 log rows per read (the look log is unchanged in what it writes).
 *   P10.4     before any act: C1 counts 5 and says never (counted from the grant), C2 counts 1.   A acts on C1 at the watermark seen_to of the changed list (= e5's created_at): C1 = 0, C2 still 1.
 *   P10.2/K2/K3/K8  then 3 entries are posted (one back-dated a year, one posted by A herself) and one REVERSAL of e1 (a new row): C1 = 4, the changed list total = 4, and a SQL count of created_at after the baseline = 4: the same number three ways.
 *   K1        the watermark is taken, a 5th entry is posted, THEN the act is sent: the 5th is still counted (the server never stamps its own now()).
 *   P10.5/K4  B's counts are untouched by A's act (C1 still 5 for B).   K7 a renewed grant (the old one revoked, a new one granted later): A's baseline survives.   K10 a seen_to in the future: 400, no row.
 *   K9        table not migrated (renamed away): the count falls back to the grant start, the act answers 503 BOOKS_BASELINE_NOT_MIGRATED.
 *   P10.6     clients with a count + clients with none = the list total; the sum of the row counts = the sum of the changed lists.   P10.7 the client's own session reads no baseline row; the act wrote no look row.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const assert = require('assert');
const crypto = require('crypto');
if (!process.env.ADMIN || !process.env.APP) { console.log('skipped: needs ADMIN and APP (a throwaway migrated database)'); process.exit(0); }
process.env.DATABASE_URL = process.env.APP;
process.env.NODE_ENV = 'test';
const path = require('path');
const API = path.join(__dirname, '..');
const { Client } = require('pg');
const db = require(path.join(API, 'db'));
const net = require(path.join(API, 'src', 'services', 'network'));
const grants = require(path.join(API, 'lib', 'books-grant'));
const baseline = require(path.join(API, 'lib', 'books-baseline'));
const practice = require(path.join(API, 'lib', 'books-practice'));
const schema = require(path.join(API, 'lib', 'schema'));
const uuid = () => crypto.randomUUID();
const reqctx = require(path.join(API, 'lib', 'reqctx'));
const asSet = (...args) => as(args[2], () => baseline.setBaseline(...args));
const as = (who, fn) => reqctx.runWithActor(who, fn); /* the request's actor, as middleware/auth sets it: the table's policy is per person */
const TODAY = '2026-11-17';
let pass = 0;
const ok = (what, cond, info) => { assert.ok(cond, what + (info ? ' :: ' + info : '')); pass++; console.log('  ok   ' + what); };

(async () => {
  const admin = new Client({ connectionString: process.env.ADMIN });
  await admin.connect();
  const q = (sql, params) => admin.query(sql, params);
  const made = [];
  const A = uuid(), B = uuid(), W = uuid(); /* W: a colleague who prepared an entry (RC-8: A cannot sign off as auditor over an entry A prepared, so the count's author is not A) */
  const run = crypto.randomBytes(4).toString('hex');
  async function business(tag) {
    const bridge = 'BR-RK10-' + run + tag;
    const id = (await q("INSERT INTO identities (bridge_id, display_name, country) VALUES ($1,$2,'AU') RETURNING identity_id", [bridge, 'Rank10 ' + tag])).rows[0].identity_id;
    made.push(id);
    return { id, node: await net.nodeOf(id, { ensure: true }) };
  }
  let grantRows = [];
  async function agency(firm, client, grantedAgo) {
    await q("INSERT INTO cb_edge (parent_id, child_id, type, state) VALUES ($1,$2,'agency','active')", [firm.node.id, client.node.id]);
    const g = (await q(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, purpose, granted_by, granted_at, expires_at) VALUES ($1,$2,'auditor','rank 10 test',$1, now() - $3::interval, now() + interval '300 days') RETURNING grant_id`, [client.id, firm.id, grantedAgo])).rows[0].grant_id;
    grantRows.push(g);
    return g;
  }
  let n = 0;
  const entry = async (client, ago, postingDate, extra) => (await q(`INSERT INTO journal_entry (entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor, created_at, created_by, reverses_entry_id) VALUES ($1,$2,$3,'FY2025-26',4,'sale','AUD',10000, now() - $4::interval, $5, $6) RETURNING entry_id, created_at`, [client.id, 'RK10-' + run + '-' + ++n, postingDate, ago, (extra && extra.by) || null, (extra && extra.reverses) || null])).rows[0];
  const look = (firm, client, who, ago, route, outcome) => q("INSERT INTO books_access_log (at, grantor_entity, grantee_entity, actor_identity_id, route_pattern, status, outcome) VALUES (now() - $5::interval,$1,$2,$3,$4,$6,$7)", [client.id, firm.id, who, route, ago, outcome === 'allowed' ? 200 : 403, outcome]);
  const asOf = async (who) => (await as(who, () => practice.practice(F.id, { roles: [grants.AUDITOR], actor: who, actor_name: 'T', today: TODAY }))).clients;
  const rowOf = (clients, client) => clients.find((c) => String(c.entity_id) === String(client.id));
  const logCount = async () => Number((await q('SELECT count(*) AS n FROM books_access_log WHERE grantee_entity = $1', [F.id])).rows[0].n);
  let F, C1, C2;
  try {
    F = await business('F'); C1 = await business('C1'); C2 = await business('C2');
    const g1 = await agency(F, C1, '10 days'); await agency(F, C2, '10 days');
    const e1 = await entry(C1, '5 days', '2026-06-10'); await entry(C1, '5 days', '2026-06-11'); await entry(C1, '5 days', '2026-06-12'); await entry(C1, '2 days', '2026-11-15');
    const e5 = await entry(C1, '1 day', '2025-11-17'); /* back-dated a year: old posting date, new created_at */
    await entry(C2, '3 days', '2026-11-14');
    await look(F, C1, A, '2 hours', 'GET /daybook', 'allowed'); await look(F, C1, B, '1 hour', 'GET /daybook', 'allowed'); await look(F, C1, A, '30 minutes', 'GET /daybook', 'no_grant');
    await look(F, C1, A, '10 minutes', baseline.LIST_READ, 'allowed'); /* an old list-read row, as every Home read leaves one */
    /* P10.1 / K6 */
    const log0 = await logCount();
    const first = rowOf(await asOf(A), C1), second = rowOf(await asOf(A), C1);
    const twoHours = Date.now() - 2 * 3600e3;
    ok('P10.1 Last look = A\'s real allowed look 2 hours ago, not the list read, not B, not the refused one', Math.abs(new Date(first.last_look).getTime() - twoHours) < 120e3, String(first.last_look));
    ok('K6 reading Home twice does not move it', String(first.last_look) === String(second.last_look));
    ok('the list read still writes one look row per client (2 clients x 2 reads = 4)', (await logCount()) - log0 === 4, String((await logCount()) - log0));
    ok('P10.5 B\'s own Last look is B\'s (1 hour ago)', Math.abs(new Date(rowOf(await asOf(B), C1).last_look).getTime() - (Date.now() - 3600e3)) < 120e3);
    /* P10.4: nothing marked yet */
    ok('P10.4 before the act: C1 counts 5 since access began (never), C2 counts 1', first.changed.n === 5 && first.changed.never === true && rowOf(await asOf(A), C2).changed.n === 1, JSON.stringify(first.changed));
    /* the changed list and the watermark */
    const read = await db.withEntity(C1.id, (h) => baseline.changedPage(h, C1.id, first.changed.since, 100, 1));
    ok('the changed list total = the Home count (one predicate): 5', read.total === 5 && read.ids.length === 5);
    ok('newest posted first: e5 (the back-dated one) leads', read.ids[0] === e5.entry_id);
    ok('seen_to = the newest created_at of the client\'s entries (e5)', new Date(read.seen_to).getTime() === new Date(e5.created_at).getTime(), read.seen_to);
    /* K10: future */
    const logBefore = await logCount();
    await assert.rejects(() => asSet(F.id, C1.id, A, new Date(Date.now() + 86400e3).toISOString(), [grants.AUDITOR]), (e) => e.status === 400 && e.code === baseline.BAD_SEEN_TO);
    await assert.rejects(() => asSet(F.id, C1.id, A, 'not a date', [grants.AUDITOR]), (e) => e.status === 400);
    await assert.rejects(() => asSet(F.id, uuid(), A, read.seen_to, [grants.AUDITOR]), (e) => e.status === 403 && e.code === 'BOOKS_GRANT_NONE');
    ok('K10 a future, unreadable or stranger-client check point is refused (400 400 403) and writes nothing', Number((await q('SELECT count(*) AS n FROM books_review_baseline WHERE entity_id = $1', [F.id])).rows[0].n) === 0);
    /* the act */
    const act = await asSet(F.id, C1.id, A, read.seen_to, [grants.AUDITOR]);
    ok('the act answers the check point and the server time', act.client === C1.id && !!act.made_at);
    ok('P10.7 the act wrote no look row', (await logCount()) === logBefore);
    const after = await asOf(A);
    ok('P10.4 after the act C1 = 0 (and says since the check point), C2 still 1', rowOf(after, C1).changed.n === 0 && rowOf(after, C1).changed.never === false && rowOf(after, C2).changed.n === 1);
    ok('P10.5/K4 B\'s count for C1 is unchanged (5)', rowOf(await asOf(B), C1).changed.n === 5);
    /* P10.2 / K2 / K3 / K8 */
    await entry(C1, '3 minutes', '2026-11-16'); await entry(C1, '2 minutes', '2025-07-01'); await entry(C1, '1 minute', '2026-11-17', { by: W });
    const rev = await entry(C1, '30 seconds', '2026-11-17', { reverses: e1.entry_id });
    const four = rowOf(await asOf(A), C1).changed.n;
    const list = await db.withEntity(C1.id, (h) => baseline.changedPage(h, C1.id, act.seen_to, 100, 1));
    const bySql = Number((await q('SELECT count(*) AS n FROM journal_entry WHERE entity_id = $1 AND created_at > $2::timestamptz', [C1.id, act.seen_to])).rows[0].n);
    ok('P10.2 3 posts + 1 reversal = 4 on Home, 4 in the list, 4 by SQL (same number three ways)', four === 4 && list.total === 4 && bySql === 4, [four, list.total, bySql].join(','));
    ok('K2 the entry back-dated a year is one of the 4, K3 the reversal is counted once, K8 a colleague posting counts too (the count is by time, never by author)', list.ids.length === 4 && list.ids.includes(rev.entry_id));
    /* K1: the watermark first, a post, then the act */
    const mark = list.seen_to;
    const late = await entry(C1, '0 seconds', '2026-11-17');
    await asSet(F.id, C1.id, A, mark, [grants.AUDITOR]);
    const afterLate = rowOf(await asOf(A), C1).changed.n;
    ok('K1 an entry posted between the page load and the press stays counted (1, not 0)', afterLate === 1, String(afterLate));
    ok('a stale tab (an older seen_to later) cannot move the baseline back', (await asSet(F.id, C1.id, A, act.seen_to, [grants.AUDITOR])) && rowOf(await asOf(A), C1).changed.n === 1);
    /* K7: renewed grant */
    await q('UPDATE books_access_grant SET revoked_at = now(), revoked_by = grantor_entity WHERE grant_id = $1', [g1]);
    await q(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, purpose, granted_by, granted_at, expires_at) VALUES ($1,$2,'auditor','renewed',$1, now() - interval '1 minute', now() + interval '300 days')`, [C1.id, F.id]);
    ok('K7 a renewed grant keeps the person\'s baseline (still 1)', rowOf(await asOf(A), C1).changed.n === 1 && rowOf(await asOf(A), C1).changed.never === false);
    const fromNew = Number((await q("SELECT count(*) AS n FROM journal_entry e WHERE e.entity_id = $1 AND e.created_at > (SELECT max(granted_at) FROM books_access_grant WHERE grantor_entity = $1 AND grantee_entity = $2)", [C1.id, F.id])).rows[0].n);
    const bRow = rowOf(await asOf(B), C1);
    ok('a person with no act on the renewed grant counts from the NEW grant start (B: ' + fromNew + ' by SQL, never)', bRow.changed.n === fromNew && bRow.changed.never === true, JSON.stringify(bRow.changed));
    /* P10.6 */
    const clients = await asOf(A);
    const withChanges = clients.filter((c) => c.changed.n > 0).length, without = clients.filter((c) => c.changed.n === 0).length;
    const sumRows = clients.reduce((s, c) => s + c.changed.n, 0);
    let sumLists = 0;
    for (const c of clients) sumLists += (await db.withEntity(c.entity_id, (h) => baseline.changedPage(h, c.entity_id, c.changed.since, 100, 1))).total;
    ok('P10.6 clients with changes + clients without = the list total; the sum of the row counts = the sum of the lists', withChanges + without === clients.length && sumRows === sumLists, [withChanges, without, sumRows, sumLists].join(','));
    /* P10.7 privacy: the client's own session */
    const seenByClient = await db.withEntity(C1.id, (h) => h.query('SELECT count(*)::int AS n FROM books_review_baseline'));
    ok('P10.7 the client\'s own session reads no baseline row', seenByClient.rows[0].n === 0);
    const seenByOtherPerson = await as(B, () => baseline.baselinesOf((s, p) => db.withEntity(F.id, (h) => h.query(s, p)), F.id, B));
    const seenByFirmOwner = await as(F.id, () => db.withEntity(F.id, (h) => h.query('SELECT count(*)::int AS n FROM books_review_baseline')));
    ok('per person in the database: the firm owner session reads none of the rows of A, B reads none of them even asking for A', seenByFirmOwner.rows[0].n === 0 && (await as(B, () => db.withEntity(F.id, (h) => h.query('SELECT count(*)::int AS n FROM books_review_baseline WHERE identity_id = $1', [A])))).rows[0].n === 0);
    ok('B reads only B\'s own baselines (none)', seenByOtherPerson.size === 0);
    /* K9: not migrated */
    await q('ALTER TABLE books_review_baseline RENAME TO books_review_baseline_off');
    schema._reset();
    try {
      const off = rowOf(await asOf(A), C1);
      ok('K9 table missing: the count falls back to the grant start (never), no failure', off.changed.never === true && typeof off.changed.n === 'number');
      await assert.rejects(() => asSet(F.id, C1.id, A, mark, [grants.AUDITOR]), (e) => e.status === 503 && e.code === baseline.NOT_MIGRATED);
      ok('K9 the act answers 503 BOOKS_BASELINE_NOT_MIGRATED in words', true);
    } finally {
      await q('ALTER TABLE books_review_baseline_off RENAME TO books_review_baseline');
      schema._reset();
    }
    console.log('\n' + pass + ' passed, 0 failed');
  } finally {
    /* the books are insert-only: entries stay under this run's own ids (a throwaway database); everything else this run made is removed where a delete is allowed */
    try { await q('DELETE FROM books_access_grant WHERE grantee_entity = $1', [F && F.id]); } catch (_) {}
    await admin.end();
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
