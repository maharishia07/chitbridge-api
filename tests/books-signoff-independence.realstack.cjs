'use strict';
/**
 * tests/books-signoff-independence.realstack.cjs — ACC-380 · RC-8 (DECISIONS 19 Nov): one person may hold both skills, but cannot SIGN OFF as the auditor what they prepared in the same client and period
 * (APES 110 / ISA 220: no auditing your own work). BOOKS_SIGNOFF_SELF_PREPARED (lib/books-baseline refuseOwnWork) had no test of its own.
 * Real Postgres, as the app role (RLS on), on a THROWAWAY migrated database:  ADMIN=postgres://postgres:...@host/db APP=postgres://cb_app:...@host/db node tests/books-signoff-independence.realstack.cjs
 * Without both variables it says so and exits 0 (not part of the offline guard).
 * HAND-COMPUTED  firm F; people P (a preparer), W and X (colleagues); client C under a live auditor grant to F. C's books: E0 posted by W 5 hours ago, E1 by P 3 hours ago, E2 by W 2 hours ago.
 *   1  P signs off up to E2 as the auditor (E1 is P's own, after any check of P's): 403 BOOKS_SIGNOFF_SELF_PREPARED, and no baseline row is written.
 *   2  W signs off up to E1 (the range holds E0, W's own): 403 BOOKS_SIGNOFF_SELF_PREPARED.
 *   3  X prepared nothing and signs off up to E2: allowed, exactly one baseline row (the colleague may).
 *   4  P with the accountant seat ALONE (roles = adviser) is no audit sign-off: on an auditor-grant-only client it answers 403 BOOKS_GRANT_NONE, never SELF_PREPARED.
 *   5  the period starts at the person's previous check: P signs up to E0 (nothing of P's in it): allowed; P's next check up to E1 (P's own, after that check point) is refused again.
 * CARD 04-network/ACC-176-AUDITOR-GRANT
 */
const assert = require('assert');
const crypto = require('crypto');
if (!process.env.ADMIN || !process.env.APP) { console.log('skipped: needs ADMIN and APP (a throwaway migrated database)'); process.exit(0); }
process.env.DATABASE_URL = process.env.APP;
process.env.NODE_ENV = 'test';
const path = require('path');
const API = path.join(__dirname, '..');
const { Client } = require('pg');
const net = require(path.join(API, 'src', 'services', 'network'));
const grants = require(path.join(API, 'lib', 'books-grant'));
const baseline = require(path.join(API, 'lib', 'books-baseline'));
const reqctx = require(path.join(API, 'lib', 'reqctx'));
const uuid = () => crypto.randomUUID();
const as = (who, fn) => reqctx.runWithActor(who, fn);
let pass = 0;
const ok = (what, cond, info) => { assert.ok(cond, what + (info ? ' :: ' + info : '')); pass++; console.log('  ok   ' + what); };

(async () => {
  const admin = new Client({ connectionString: process.env.ADMIN });
  await admin.connect();
  const q = (sql, params) => admin.query(sql, params);
  const run = crypto.randomBytes(4).toString('hex');
  const P = uuid(), W = uuid(), X = uuid();
  const business = async (tag) => {
    const id = (await q("INSERT INTO identities (bridge_id, display_name, country) VALUES ($1,$2,'AU') RETURNING identity_id", ['BR-SO380-' + run + tag, 'SO380 ' + tag])).rows[0].identity_id;
    return { id, node: await net.nodeOf(id, { ensure: true }) };
  };
  let n = 0;
  const entry = async (client, by, ago) => (await q(`INSERT INTO journal_entry (entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor, created_at, created_by) VALUES ($1,$2,'2026-11-10','FY2026-27',5,'sale','AUD',10000, now() - $3::interval, $4) RETURNING entry_id, created_at`, [client.id, 'SO380-' + run + '-' + (++n), ago, by])).rows[0];
  const sign = (firm, client, who, seenTo, roles) => as(who, () => baseline.setBaseline(firm.id, client.id, who, seenTo, roles, false, false));
  let F, C;
  try {
    F = await business('F'); C = await business('C');
    await q("INSERT INTO cb_edge (parent_id, child_id, type, state) VALUES ($1,$2,'agency','active')", [F.node.id, C.node.id]);
    await q(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, purpose, granted_by, granted_at, expires_at) VALUES ($1,$2,'auditor','signoff test',$1, now() - interval '10 days', now() + interval '300 days')`, [C.id, F.id]);
    const e0 = await entry(C, W, '5 hours'), e1 = await entry(C, P, '3 hours'), e2 = await entry(C, W, '2 hours');
    const baselineRows = async () => Number((await q('SELECT count(*) AS n FROM books_review_baseline WHERE entity_id = $1', [F.id])).rows[0].n);
    const AUD = [grants.AUDITOR];

    /* 1 the preparer is refused; nothing is written */
    await assert.rejects(() => sign(F, C, P, e2.created_at.toISOString(), AUD), (e) => e.status === 403 && e.code === baseline.SELF_PREPARED);
    ok('1 P prepared E1 and signs off up to E2 as the auditor: 403 BOOKS_SIGNOFF_SELF_PREPARED', true);
    ok('1 the refusal wrote no baseline row', (await baselineRows()) === 0);

    /* 2 a colleague whose own entry is not in the signed range is allowed; the same colleague is refused when it is */
    const w1 = await sign(F, C, W, e1.created_at.toISOString(), AUD).catch((e) => e);
    ok('2 W prepared E0 and E2; signing up to E1 holds E0 (W\'s own): refused', w1 && w1.code === baseline.SELF_PREPARED, JSON.stringify(w1 && w1.code));
    /* 3 a colleague who prepared nothing signs the whole range */
    const x = await sign(F, C, X, e2.created_at.toISOString(), AUD);
    ok('3 X prepared nothing and signs off up to E2: allowed, the check point is stored', x.client === C.id && !!x.made_at);
    ok('3 the colleague\'s sign-off wrote exactly one baseline row', (await baselineRows()) === 1);

    /* 4 the accountant seat alone is no audit sign-off: the audit refusal does not apply, the missing adviser grant does */
    await assert.rejects(() => sign(F, C, P, e2.created_at.toISOString(), [grants.ADVISER]), (e) => e.status === 403 && e.code === 'BOOKS_GRANT_NONE');
    ok('4 P with the accountant seat alone on an auditor-grant client: 403 BOOKS_GRANT_NONE (never SELF_PREPARED)', true);

    /* 5 the period is since the person's previous check: P checks up to E0 (nothing of P's), then E1 (P's) is refused */
    const p0 = await sign(F, C, P, e0.created_at.toISOString(), AUD);
    ok('5 P signs off up to E0 (W\'s entry, nothing of P\'s before it): allowed', !!p0.made_at);
    await assert.rejects(() => sign(F, C, P, e1.created_at.toISOString(), AUD), (e) => e.status === 403 && e.code === baseline.SELF_PREPARED);
    ok('5 P then signs up to E1 (P\'s own entry, after the previous check): refused again', true);
    console.log('\n' + pass + ' passed, 0 failed');
  } finally {
    try { await q('DELETE FROM books_access_grant WHERE grantee_entity = $1', [F && F.id]); } catch (_) { /* the books are insert-only: entries stay under this run's own ids */ }
    await admin.end();
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
