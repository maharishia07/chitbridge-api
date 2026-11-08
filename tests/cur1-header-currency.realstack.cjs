'use strict';
/**
 * tests/cur1-header-currency.realstack.cjs — CUR-1 slice 3 on a REAL Postgres: b846 (chit_header.currency_code + currency_source, the review and violation tables)
 * and the b847 backfill, seeded as cb_app (NOBYPASSRLS, through withEntity) in TWO entities; the backfill itself runs as the OWNER (production: Athi in the SQL editor).
 *
 * Hand-computed expectation (entity A has 14 headers, entity B 3; every row is made here, then deleted):
 *   A  c1 stated AUD · c2 stated INR + details INR,INR · c3 money.currency_code AED · c4 details AED,AED only · c5 no money · c6 INR vs AUD stated ·
 *      c7 details INR,USD · c8 stated AUD vs detail INR · c9 details AED,NULL · c10 total_value 120.00 with no currency · c11 written by the api ('stated' JPY) ·
 *      X (AUD) · Y (INR) · Z (silent, no detail)         B  X (INR) · Y (silent, detail AED) · Z (silent, detail AED)
 *   A: currency set on 7 (c1 c2 c3 c4 c11 X Y), NULL on 7 (c5 c6 c7 c8 c9 c10 Z) · sources: backfill_stated 5 (c1 c2 c3 X Y) · backfill_detail 1 (c4) · backfill_none 2 (c5 Z) ·
 *      backfill_review 5 (c6 c7 c8 c9 c10) · stated 1 (c11, untouched)        B: backfill_stated 1 (X) · backfill_detail 2 (Y Z)
 *   review rows: A 7 (5 buckets + copies_disagree on X and Y), B 2 (copies_disagree on X and Y) = 9. Z: A has no money, B has AED: not a disagreement (a NULL is no currency).
 *   NEVER 'INR' by default: c10 and c5 stay NULL. chit_detail is never UPDATEd (12 detail rows, 1 with a NULL code, byte-identical before and after).
 *   a second run changes nothing (idempotent) · the rollback file, run in a transaction, removes the columns and tables and leaves every other column of the rows as it was.
 *   MISMATCH IS REFUSED, NOT MERGED: INR on one place and AUD on another is never made one currency — it is a review row with both codes (c6: {AUD,INR}, c8: stated {AUD} detail {INR}).
 *   cb_app (RLS): sees only its own entity's review rows; cannot write the review table; the two CHECKs refuse 'aud', a source with the wrong NULL-ness.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 CUR1_OWNER_DB_URL=postgres://postgres:postgres@localhost:5432/cb_s41 node tests/cur1-header-currency.realstack.cjs
 *      (CI: the integration S41 job; SIT: inside the api container with the owner URL of the SIT database)
 * CARD      14-accounting/README (CUR-1)
 */
const url = process.env.DATABASE_URL || '', ownerUrl = process.env.CUR1_OWNER_DB_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const hostOf = (u) => /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u);
const app = hostOf(url), owner = hostOf(ownerUrl);
if (!app || app[1] !== 'cb_app' || !ALLOWED_HOSTS.test(app[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
if (!owner || owner[1] === 'cb_app' || !ALLOWED_HOSTS.test(owner[2])) { console.error('REFUSED: needs CUR1_OWNER_DB_URL (the owner role, to run the backfill) on localhost, the compose db or a SIT host'); process.exit(3); }
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client } = require('pg');
const { withEntity, query } = require('../db');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 400) : '')); } };
const RUN = 'cu' + (Date.now() % 1e10).toString(36);
const made = [];
const uuid = () => crypto.randomUUID();
const sql = (file) => fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
const BACKFILL = sql('b847_chit_header_currency_backfill.sql'), ROLLBACK = sql('RUN-2026-11-09-1-cur1-b846-ROLLBACK.sql');

async function shop(tag) {
  const row = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, ['CB' + RUN + tag, 'Cur1 ' + tag + ' ' + RUN]);
  made.push(row.rows[0].identity_id);
  return row.rows[0].identity_id;
}
/** one header as the entity, with its detail rows [[total_value, currency_code|null], …]; extra = the api-written columns */
async function chit(entity, chitId, { business = null, summary = null, details = [], extra = null }) {
  await withEntity(entity, async (db) => {
    await db.query(
      `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name, business_json, summary_json${extra ? ', currency_code, currency_source' : ''})
       VALUES ($1, $2, $2, $3, 'Cur1', $4::jsonb, $5::jsonb${extra ? ', $6, $7' : ''})`,
      [chitId, entity, 'CB' + RUN, business && JSON.stringify(business), summary && JSON.stringify(summary)].concat(extra ? [extra[0], extra[1]] : []));
    /* one detail row per (chit, entity, direction): a copy holds at most a received row and a sent row */
    for (const [i, [total, code]] of details.entries()) await db.query('INSERT INTO chit_detail (chit_id, entity_id, direction, total_value, currency_code) VALUES ($1, $2, $3, $4, $5)', [chitId, entity, ['received', 'sent'][i], total, code]);
  });
}
const headersOf = (entity) => withEntity(entity, async (db) => (await db.query('SELECT chit_id, currency_code, currency_source FROM chit_header WHERE entity_id = $1', [entity])).rows);
const reviewOf = (entity) => withEntity(entity, async (db) => (await db.query('SELECT chit_id, reason, stated_codes, detail_codes FROM chit_currency_review WHERE entity_id = $1 ORDER BY reason', [entity])).rows);
const detailsOf = (entity) => withEntity(entity, async (db) => (await db.query('SELECT detail_id, chit_id, total_value::text AS total, currency_code FROM chit_detail WHERE entity_id = $1 ORDER BY detail_id', [entity])).rows);
const tally = (rows, key) => { const m = {}; for (const r of rows) m[String(r[key])] = (m[String(r[key])] || 0) + 1; return Object.fromEntries(Object.entries(m).sort()); };
/** a write that must be refused with SQLSTATE `code` */
async function refused(entity, text, args, code) {
  try { await withEntity(entity, (db) => db.query(text, args)); return false; } catch (e) { return e.code === code ? true : 'wrong error ' + e.code + ' ' + e.message; }
}

(async () => {
  console.log('\n── CUR-1 slice 3 · chit_header.currency_code + the b847 backfill under RLS · run ' + RUN + ' ──');
  const owner_ = new Client({ connectionString: ownerUrl });
  const ids = {};
  try {
    await owner_.connect();
    const A = await shop('a'), B = await shop('b');
    for (const k of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'X', 'Y', 'Z']) ids[k] = uuid();

    await chit(A, ids.c1, { business: { currency: 'AUD' } });
    await chit(A, ids.c2, { summary: { currency_code: 'INR' }, details: [['10.00', 'INR'], ['20.00', 'INR']] });
    await chit(A, ids.c3, { summary: { money: { currency_code: 'AED', total_minor: 500 } } });
    await chit(A, ids.c4, { details: [['5.00', 'AED'], ['7.50', 'AED']] });
    await chit(A, ids.c5, { summary: {} });
    await chit(A, ids.c6, { business: { currency: 'INR' }, summary: { currency_code: 'AUD' } });
    await chit(A, ids.c7, { details: [['1.00', 'INR'], ['2.00', 'USD']] });
    await chit(A, ids.c8, { business: { currency: 'AUD' }, details: [['9.00', 'INR']] });
    await chit(A, ids.c9, { details: [['4.00', 'AED'], ['3.00', null]] });
    await chit(A, ids.c10, { summary: { total_value: '120.00' } });
    await chit(A, ids.c11, { business: { currency: 'AUD' }, details: [['6.00', 'INR']], extra: ['JPY', 'stated'] });
    await chit(A, ids.X, { business: { currency: 'AUD' } });
    await chit(A, ids.Y, { business: { currency: 'INR' } });
    await chit(A, ids.Z, { summary: {} });
    await chit(B, ids.X, { business: { currency: 'INR' } });
    await chit(B, ids.Y, { summary: {}, details: [['8.00', 'AED']] });
    await chit(B, ids.Z, { summary: {}, details: [['2.50', 'AED']] });

    const beforeA = await headersOf(A), beforeB = await headersOf(B);
    ok('S-1 before the batch every seeded header is "not yet processed" (A 14, B 3, source NULL, currency NULL except the api-written c11)',
      beforeA.length === 14 && beforeB.length === 3 && beforeA.filter((r) => r.currency_source === null).length === 13 && beforeB.every((r) => r.currency_source === null && r.currency_code === null), JSON.stringify(tally(beforeA, 'currency_source')));
    ok('S-2 no review row exists yet', (await reviewOf(A)).length === 0 && (await reviewOf(B)).length === 0);
    const detailBefore = JSON.stringify([await detailsOf(A), await detailsOf(B)]);
    const headerOtherBefore = (await owner_.query(`SELECT md5(string_agg(chit_id::text || entity_id::text || coalesce(business_json::text,'') || coalesce(summary_json::text,''), '|' ORDER BY chit_id, entity_id)) AS h
                                                    FROM chit_header WHERE entity_id = ANY($1)`, [[A, B]])).rows[0].h;

    await owner_.query(BACKFILL);

    const hA = await headersOf(A), hB = await headersOf(B), by = (rows, id) => rows.find((r) => r.chit_id === id);
    const want = (rows, id, code, source) => { const r = by(rows, id); return !!r && r.currency_code === code && r.currency_source === source; };
    ok('B-1 c1 one stated place (business_json.currency AUD) → AUD, backfill_stated', want(hA, ids.c1, 'AUD', 'backfill_stated'), JSON.stringify(by(hA, ids.c1)));
    ok('B-2 c2 stated INR agreeing with both detail rows → INR, backfill_stated', want(hA, ids.c2, 'INR', 'backfill_stated'));
    ok('B-3 c3 the key moneyOfInvoice writes (summary_json.money.currency_code AED) → AED, backfill_stated', want(hA, ids.c3, 'AED', 'backfill_stated'));
    ok('B-4 c4 nothing stated, details AED and AED → AED, backfill_detail', want(hA, ids.c4, 'AED', 'backfill_detail'));
    ok('B-5 c5 no money at all → NULL, backfill_none (no currency invented for a task)', want(hA, ids.c5, null, 'backfill_none'));
    for (const [k, why] of [['c6', 'INR vs AUD stated'], ['c7', 'details INR and USD'], ['c8', 'stated AUD vs detail INR'], ['c9', 'details AED and NULL'], ['c10', 'money 120.00 with no currency']]) {
      ok('B-6 ' + k + ' ' + why + ' → NULL, backfill_review (never merged, never INR)', want(hA, ids[k], null, 'backfill_review'), JSON.stringify(by(hA, ids[k])));
    }
    ok('B-7 c11 written by the api (source stated, JPY) is not touched although its detail says INR', want(hA, ids.c11, 'JPY', 'stated'));
    ok('B-8 X: each copy keeps its OWN currency (A AUD, B INR)', want(hA, ids.X, 'AUD', 'backfill_stated') && want(hB, ids.X, 'INR', 'backfill_stated'));
    ok('B-9 Y: A states INR; B is silent and its OWN detail says AED (A\'s INR is not read for B) → A INR, B AED backfill_detail', want(hA, ids.Y, 'INR', 'backfill_stated') && want(hB, ids.Y, 'AED', 'backfill_detail'));
    ok('B-10 Z: B\'s detail rows (AED) are not read for A\'s silent header → A none, B AED', want(hA, ids.Z, null, 'backfill_none') && want(hB, ids.Z, 'AED', 'backfill_detail'));
    ok('B-11 A in numbers: currency set on 7, NULL on 7; sources stated 1 · backfill_stated 5 · backfill_detail 1 · backfill_none 2 · backfill_review 5',
      hA.filter((r) => r.currency_code).length === 7 && hA.filter((r) => !r.currency_code).length === 7 && JSON.stringify(tally(hA, 'currency_source')) === JSON.stringify({ backfill_detail: 1, backfill_none: 2, backfill_review: 5, backfill_stated: 5, stated: 1 }), JSON.stringify(tally(hA, 'currency_source')));
    ok('B-12 B in numbers: backfill_stated 1, backfill_detail 2', JSON.stringify(tally(hB, 'currency_source')) === JSON.stringify({ backfill_detail: 2, backfill_stated: 1 }), JSON.stringify(tally(hB, 'currency_source')));
    ok('B-13 no header got INR that did not state or evidence it: INR rows are exactly c2, Y (A) and X (B)', [...hA, ...hB].filter((r) => r.currency_code === 'INR').length === 3);

    const rA = await reviewOf(A), rB = await reviewOf(B);
    ok('R-1 A has 7 review rows: c6 c7 c8 c9 c10 + copies_disagree on X and Y', rA.length === 7 && JSON.stringify(tally(rA, 'reason')) === JSON.stringify({ copies_disagree: 2, detail_partly_null: 1, detail_rows_disagree: 1, detail_vs_stated: 1, money_without_currency: 1, stated_disagrees: 1 }), JSON.stringify(tally(rA, 'reason')));
    ok('R-2 B has 2 review rows (copies_disagree on X and Y), none for Z (a NULL is no currency)', rB.length === 2 && rB.every((r) => r.reason === 'copies_disagree') && !rB.some((r) => r.chit_id === ids.Z));
    const r6 = rA.find((r) => r.chit_id === ids.c6), r8 = rA.find((r) => r.chit_id === ids.c8);
    ok('R-3 the mismatch is kept as both codes, not merged: c6 stated {AUD,INR}; c8 stated {AUD} detail {INR}',
      JSON.stringify(r6.stated_codes) === '["AUD","INR"]' && JSON.stringify(r8.stated_codes) === '["AUD"]' && JSON.stringify(r8.detail_codes) === '["INR"]', JSON.stringify([r6, r8]));
    ok('R-4 RLS: the review rows entity A reads are only A\'s (7), B\'s are not visible to A', (await withEntity(A, async (db) => (await db.query('SELECT count(*)::int AS n FROM chit_currency_review')).rows[0].n)) === 7);

    ok('D-1 chit_detail is never UPDATEd: 12 rows, 1 NULL code, identical before and after', JSON.stringify([await detailsOf(A), await detailsOf(B)]) === detailBefore && (await detailsOf(A)).concat(await detailsOf(B)).length === 12 && (await detailsOf(A)).filter((r) => r.currency_code === null).length === 1);
    const hOther = (await owner_.query(`SELECT md5(string_agg(chit_id::text || entity_id::text || coalesce(business_json::text,'') || coalesce(summary_json::text,''), '|' ORDER BY chit_id, entity_id)) AS h FROM chit_header WHERE entity_id = ANY($1)`, [[A, B]])).rows[0].h;
    ok('D-2 the backfill touched only the two new columns: business_json and summary_json are byte-identical', hOther === headerOtherBefore);

    const snap = JSON.stringify([hA, hB, rA, rB]);
    await owner_.query(BACKFILL);
    ok('I-1 a second run changes nothing (idempotent: headers and review rows identical)', JSON.stringify([await headersOf(A), await headersOf(B), await reviewOf(A), await reviewOf(B)]) === snap);

    ok('C-1 the shape CHECK refuses a lower-case code', (await refused(A, 'UPDATE chit_header SET currency_code = $2, currency_source = $3 WHERE chit_id = $1 AND entity_id = $4', [ids.c1, 'aud', 'resolved', A], '23514')) === true);
    ok('C-2 a code with a source that says "no currency" is refused (backfill_review + AUD)', (await refused(A, 'UPDATE chit_header SET currency_code = $2, currency_source = $3 WHERE chit_id = $1 AND entity_id = $4', [ids.c1, 'AUD', 'backfill_review', A], '23514')) === true);
    ok('C-3 a source that says "stated" with no currency is refused', (await refused(A, 'UPDATE chit_header SET currency_code = NULL, currency_source = $2 WHERE chit_id = $1 AND entity_id = $3', [ids.c1, 'stated', A], '23514')) === true);
    ok('C-4 a source outside the list is refused', (await refused(A, 'UPDATE chit_header SET currency_source = $2 WHERE chit_id = $1 AND entity_id = $3', [ids.c1, 'guessed', A], '23514')) === true);
    ok('C-5 the owner resolving a review row (AUD, resolved) is accepted', (await withEntity(A, async (db) => (await db.query('UPDATE chit_header SET currency_code = $2, currency_source = $3 WHERE chit_id = $1 AND entity_id = $4', [ids.c6, 'AUD', 'resolved', A])).rowCount)) === 1);
    ok('C-6 cb_app cannot write the review table (the owner and the definer functions do)', (await refused(A, `INSERT INTO chit_currency_review (chit_id, entity_id, reason) VALUES ($1, $2, 'stated_disagrees')`, [uuid(), A], '42501')) === true);
    ok('C-7 the NOT VALID checks were validated by b847 (convalidated)', (await owner_.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('chit_header_currency_shape','chit_header_currency_source_chk') AND convalidated`)).rows[0].n === 2);

    await owner_.query('BEGIN');
    await owner_.query(ROLLBACK);
    const gone = (await owner_.query(`SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'chit_header' AND column_name IN ('currency_code','currency_source')) AS cols,
                                             to_regclass('chit_currency_review') AS review, to_regclass('chit_currency_violation') AS violation`)).rows[0];
    const hAfterRollback = (await owner_.query(`SELECT md5(string_agg(chit_id::text || entity_id::text || coalesce(business_json::text,'') || coalesce(summary_json::text,''), '|' ORDER BY chit_id, entity_id)) AS h FROM chit_header WHERE entity_id = ANY($1)`, [[A, B]])).rows[0].h;
    await owner_.query('ROLLBACK');
    ok('X-1 the rollback file removes both columns and both tables and leaves every other column as it was', gone.cols === 0 && gone.review === null && gone.violation === null && hAfterRollback === headerOtherBefore, JSON.stringify(gone));
    ok('X-2 …and it was run inside a transaction that was rolled back: the columns are back', (await owner_.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'chit_header' AND column_name IN ('currency_code','currency_source')`)).rows[0].n === 2);
  } catch (e) {
    ok('the run reached its end', false, e && e.stack);
  } finally {
    try { await owner_.query('ROLLBACK'); } catch (e) { /* none open */ }
    try {
      await owner_.query('DELETE FROM chit_currency_review WHERE entity_id = ANY($1)', [made]);
      await owner_.query('DELETE FROM chit_detail WHERE entity_id = ANY($1)', [made]);
      await owner_.query('DELETE FROM chit_header WHERE entity_id = ANY($1)', [made]);
    } catch (e) { console.log('  cleanup rows: ' + e.message); }
    for (const id of made) { try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (e) { console.log('  cleanup identity: ' + e.message); } }
    try { await owner_.end(); } catch (e) { /* closed */ }
  }
  console.log('\n' + (fail ? 'FAIL ' + fail + ' · ' : 'ok ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
