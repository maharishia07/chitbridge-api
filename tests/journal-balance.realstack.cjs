'use strict';
/**
 * tests/journal-balance.realstack.cjs — VERIFY-EL-DB A7 on a REAL Postgres: after b904 a journal entry whose debits and credits differ fails AT COMMIT.
 *   JB-1  a balanced entry commits (lines in either order, in one transaction)
 *   JB-2  a one-sided entry is refused at COMMIT with 23514
 *   JB-3  a transaction that adds the missing side before COMMIT is accepted (deferred, not per row)
 * Mutant: on a DB without b904 JB-2 goes red. journal_line is insert-only, so the rows stay: run it on a throwaway database.
 * Allow list: cb_app on localhost, the compose db or a SIT host only. Run: DATABASE_URL=postgres://cb_app:...@localhost:55432/<throwaway> node tests/journal-balance.realstack.cjs
 * CARD      28-platform-and-operations/migrations-and-schema
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(2); }
const crypto = require('crypto');
const { withEntity, query } = require('../db');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + info : '')); } };
const RUN = 'jb' + (Date.now() % 1e10).toString(36);
(async () => {
  const shop = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, ['CB' + RUN, 'JB ' + RUN]);
  const E = shop.rows[0].identity_id, a1 = crypto.randomUUID(), a2 = crypto.randomUUID();
  const entry = async (db, n) => (await db.query(`INSERT INTO journal_entry (entity_id, entry_no, event_type, fiscal_year, period, posting_date, currency, total_minor) VALUES ($1,$2,'jb','FY',1,'2026-11-01','INR',100) RETURNING entry_id`, [E, RUN + n])).rows[0].entry_id;
  const line = (db, id, no, acct, dr, cr) => db.query('INSERT INTO journal_line (entry_id, entity_id, line_no, account_id, dr_minor, cr_minor, currency) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, E, no, acct, dr, cr, 'INR']);
  try {
    await withEntity(E, async (db) => { for (const [id, code, role, nature] of [[a1, 'A1', 'cash', 'asset'], [a2, 'A2', 'sales', 'income']]) await db.query('INSERT INTO ledger_account (account_id, entity_id, code, name, nature, role) VALUES ($1,$2,$3,$3,$4,$5)', [id, E, code, nature, role]); });
    try { await withEntity(E, async (db) => { const id = await entry(db, 1); await line(db, id, 2, a2, 0, 100); await line(db, id, 1, a1, 100, 0); }); ok('JB-1 a balanced entry commits, lines in any order', true); }
    catch (e) { ok('JB-1 a balanced entry commits, lines in any order', false, e.message); }
    let code = null;
    try { await withEntity(E, async (db) => { const id = await entry(db, 2); await line(db, id, 1, a1, 118, 0); await line(db, id, 2, a2, 0, 100); }); } catch (e) { code = e.code; }
    ok('JB-2 a one-sided entry is refused at COMMIT (23514)', code === '23514', 'got ' + code);
    try { await withEntity(E, async (db) => { const id = await entry(db, 3); await line(db, id, 1, a1, 118, 0); await line(db, id, 2, a2, 0, 100); await line(db, id, 3, a2, 0, 18); }); ok('JB-3 the missing side added before COMMIT is accepted', true); }
    catch (e) { ok('JB-3 the missing side added before COMMIT is accepted', false, e.message); }
  } finally { console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
})().catch((e) => { console.error(e); process.exit(1); });
