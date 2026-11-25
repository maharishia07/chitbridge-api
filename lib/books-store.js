// CALLED BY routes/books.js, routes/chits.js, routes/crm.js, routes/governance.js, lib/bill-use.js, lib/books-cashflow.js, lib/books-hooks.js, lib/books-nightly.js (+29 more)
// @stage tested
// @stage-note [BOOKS v2] Every SQL statement the books make, on a handle the caller opened with withEntity (so FORCE RLS
// @stage-note holds). The WRITES to the journal tables are called from lib/books.js postEntry() only — tests/books-writer.
'use strict';
/**
 * OWNS  every SQL statement of the books: entries · lines · balances · the pages · the tax entry lines.
 * FLOW  lib/books.js postEntry → insertEntry · insertLines · addBalances; every reader → one statement on the caller's handle
 * CARD 16-finance/books-store
 * lib/books-store.js — THE BOOKS' SQL, AND NOTHING ELSE.
 *
 * ⭐ Kept apart from lib/books.js so the posting logic can be proved with an in-memory store that has these same
 *   functions (tests/books-post.test.cjs) and no database.
 * ⚠️⚠️ THE FOUR JOURNAL WRITES — insertEntry, insertLines, addBalances, insertItems — may be called from ONE place:
 *   lib/books.js postEntry(). tests/books-writer.test.cjs fails on any other caller, and on any INSERT/UPDATE/DELETE
 *   of journal_entry, journal_line, account_balance or party_item written anywhere but this file.
 * ⚠️ Every function takes `db` — a withEntity() handle, inside its transaction. None of them opens a connection.
 */
const ZERO = '00000000-0000-0000-0000-000000000000';
const numberOrZero = (value) => (value == null ? 0 : Number(value));
const { boundRead } = require('./bound-read');
const { fxLock, hasTrading, lockSourceRef } = require('./books-store-locks'); /* split out: this file's size row may not grow */
/** the two ways a missing value becomes SQL NULL in the row builders below: any falsy (0 · '' · false too), or only null / undefined */
const falsyToNull = (value) => value || null;
const missingToNull = (value) => (value == null ? null : value);

/* ── the switch ─────────────────────────────────────────────────────────────────────────────────────────────── */
/** the ONE statement that reads a shop's books setting: setting() runs it on a handle, ledgerOnBatch (lib/books) rides it in readBatch's one trip */
const SETTING_SQL = `SELECT s.entity_id, s.enabled, s.walkin_grain, s.fy_start_month, s.functional_currency, s.country, s.pack_version,
                                   s.enabled_at, s.last_check, i.timezone
                              FROM books_setting s LEFT JOIN identities i ON i.identity_id = s.entity_id WHERE s.entity_id = $1`;
async function setting(db, e) {
  /* ⭐ the shop's ZONE rides on the setting (identities.timezone, b176) — the one input of books-hooks.dayOf / dayBounds (M210); same trip */
  const queryResult = await db.query(
    SETTING_SQL,
    [e]
  );
  return queryResult.rows[0] || null;
}
/** the ledger's start moment moved EARLIER (the owner's start date, lib/books-backfill); never later. true when it moved */
async function lowerStart(db, e, ts) {
  const r = await db.query('UPDATE books_setting SET enabled_at = $2::timestamptz, updated_at = now() WHERE entity_id = $1 AND enabled_at > $2::timestamptz', [e, ts]);
  return (r.rowCount || 0) > 0;
}
/** create or update the shop's books switch; a ledger with no stated money or year is refused (NO_MONEY) */
async function saveSetting(db, e, newSetting) {
  /* STD2 (GOV-AU1 for MONEY): a ledger's money and year are STATED (Country setup / the pack) — never INR or April by default; unstated is refused in
     the ONE sentence (country-setup.MONEY_UNSTATED, code NO_MONEY), the NO_COUNTRY pattern. books_setting's columns are NOT NULL. */
  if (!newSetting.fy_start_month || !newSetting.functional_currency) {
    const countrySetup = require('./country-setup'),
      x = new Error(countrySetup.MONEY_UNSTATED);
    x.code = 'NO_MONEY';
    x.refused = true;
    throw x;
  }
  await db.query(
    `INSERT INTO books_setting (entity_id, enabled, walkin_grain, fy_start_month, functional_currency, country, pack_version, enabled_at, enabled_by, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $2 THEN COALESCE($9::timestamptz, now()) END, $8, now())
                  ON CONFLICT (entity_id) DO UPDATE SET enabled = EXCLUDED.enabled, walkin_grain = EXCLUDED.walkin_grain,
                    fy_start_month = EXCLUDED.fy_start_month, functional_currency = EXCLUDED.functional_currency,
                    country = EXCLUDED.country, pack_version = COALESCE(EXCLUDED.pack_version, books_setting.pack_version),
                    enabled_at = COALESCE(books_setting.enabled_at, EXCLUDED.enabled_at),
                    enabled_by = COALESCE(books_setting.enabled_by, EXCLUDED.enabled_by), updated_at = now()`,
    [
      e,
      !!newSetting.enabled,
      newSetting.walkin_grain || 'day',
      newSetting.fy_start_month,
      newSetting.functional_currency,
      newSetting.country,
      newSetting.pack_version || null,
      newSetting.by || null,
      newSetting.at || null
    ]
  ); /* WX-O2C: `at` = the shop clock's moment when it is simulated (books.enable) — the year and its first day come from ONE clock */
}
async function saveCheck(db, e, result) {
  await db.query(`UPDATE books_setting SET last_check = $2::jsonb WHERE entity_id = $1`, [e, JSON.stringify(result)]);
}

/* ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** ⭐ IM1: `source_code` (b302 — the code a ledger had in Xero / QuickBooks) rides on the row once the column exists; before b302 the read is the same as it was (schema.hasColumn, cached) */
const sourceCodeReady = () => require('./schema').hasColumn('ledger_account', 'source_code');
async function accounts(db, e) {
  const hasSourceCode = await sourceCodeReady();
  const queryResult = await db.query(
    `SELECT account_id, code, name, parent_id, is_group, nature, role, tally_group, sch3_line, saft_grouping, currency, active${hasSourceCode ? ', source_code' : ''}
                              FROM ledger_account WHERE entity_id = $1 ORDER BY code`,
    [e]
  );
  return queryResult.rows;
}
/** the first fourteen values of insertAccount's INSERT, in column order — pure, nothing read */
const accountValues = (e, account) => [
  e,
  account.code,
  account.name,
  falsyToNull(account.parent_id),
  !!account.is_group,
  account.nature,
  falsyToNull(account.role),
  falsyToNull(account.pack_code),
  falsyToNull(account.pack_version),
  falsyToNull(account.tally_group),
  falsyToNull(account.sch3_line),
  falsyToNull(account.saft_grouping),
  falsyToNull(account.currency),
  falsyToNull(account.by)
];
/** insert one ledger account (a repeat of the same code is ignored) → its account_id, or null when it already existed */
async function insertAccount(db, e, account) {
  const withSourceCode = account.source_code != null && String(account.source_code).trim() !== '' && (await sourceCodeReady());
  const queryResult = await db.query(
    `INSERT INTO ledger_account (entity_id, code, name, parent_id, is_group, nature, role, pack_code, pack_version,
                                                        tally_group, sch3_line, saft_grouping, currency, created_by${withSourceCode ? ', source_code' : ''})
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14${withSourceCode ? ',$15' : ''})
                            ON CONFLICT (entity_id, code) DO NOTHING RETURNING account_id`,
    accountValues(e, account).concat(withSourceCode ? [String(account.source_code).trim().slice(0, 20)] : [])
  );
  return queryResult.rows[0] ? queryResult.rows[0].account_id : null;
}
/** F-66 (batch 1126): every ledger of the shop on a code the pack RETIRED (wages 5100) gives up its role (the role is unique per shop; the ledger keeps code, name and every posted row) → the rows it freed */
async function freeRetiredRoles(db, e, codes) {
  const queryResult = await db.query(`UPDATE ledger_account SET role = NULL WHERE entity_id = $1 AND code = ANY($2::text[]) AND role IS NOT NULL RETURNING account_id, code, role`, [e, codes]);
  return queryResult.rows;
}
/** IM1: keep THEIR code on a ledger that already exists (a merge in the move-in) — false before b302 (nothing written, said by the caller) */
async function setSourceCode(db, e, account_id, code) {
  if (!(await sourceCodeReady())) return false;
  const queryResult = await db.query(`UPDATE ledger_account SET source_code = $3 WHERE entity_id = $1 AND account_id = $2`, [
    e,
    account_id,
    String(code).trim().slice(0, 20)
  ]);
  return queryResult.rowCount > 0;
}

/* ── periods ────────────────────────────────────────────────────────────────────────────────────────────────── */
/** `lock` (M1, PAY-FIX): a POSTING reads the months FOR SHARE, so a lock or close of a month waits for an entry landing in it (and vice versa) — a read-only ask never locks */
async function periods(db, e, fiscalYear, lock) {
  const queryResult = await db.query(
    `SELECT fiscal_year, period, start_date, end_date, status, locked_by, locked_at, reason FROM fiscal_period
                             WHERE entity_id = $1 AND ($2::text IS NULL OR fiscal_year = $2) ORDER BY fiscal_year, period` + (lock ? ' FOR SHARE' : ''),
    [e, fiscalYear || null]
  );
  return queryResult.rows;
}
/** M157: what each month holds — how many entries, and the sales (series SV) — one grouped read for the year (or every year).
 * ⭐ P1-1 (18 Nov): the opening-balance journal (period 0) is COUNTED in the month its day falls in, so the month counts, the year's and the Day book's list ("N shown", "checked n of N") all say the same number. */
async function periodFigures(db, e, fiscalYear) {
  const queryResult = await db.query(
    `SELECT fiscal_year, period, COUNT(*)::int AS entries, COALESCE(SUM(total_minor) FILTER (WHERE series = 'SV'), 0) AS sales_minor
                              FROM journal_entry WHERE entity_id = $1 AND ($2::text IS NULL OR fiscal_year = $2) GROUP BY fiscal_year, period`,
    [e, fiscalYear || null]
  );
  const figures = queryResult.rows.map((x) => ({ fiscal_year: x.fiscal_year, period: Number(x.period), entries: Number(x.entries), sales_minor: Number(x.sales_minor) }));
  if (!figures.some((x) => x.period === 0)) return figures;
  const days = await db.query(
    `SELECT fiscal_year, to_char(posting_date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND period = 0 AND ($2::text IS NULL OR fiscal_year = $2) GROUP BY fiscal_year, posting_date`,
    [e, fiscalYear || null]
  );
  const months = await db.query(
    `SELECT fiscal_year, period, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM fiscal_period WHERE entity_id = $1 AND period >= 1 AND ($2::text IS NULL OR fiscal_year = $2)`,
    [e, fiscalYear || null]
  );
  return require('./books-opening-count').foldOpening(figures, days.rows, months.rows);
}
async function insertPeriod(db, e, period) {
  await db.query(
    `INSERT INTO fiscal_period (entity_id, fiscal_year, period, start_date, end_date, status)
                  VALUES ($1,$2,$3,$4,$5,'open') ON CONFLICT (entity_id, fiscal_year, period) DO NOTHING`,
    [e, period.fiscal_year, period.period, period.start_date, period.end_date]
  );
}
async function setPeriodStatus(db, e, fiscalYear, period, status, by, reason) {
  const queryResult = await db.query(
    `UPDATE fiscal_period SET status = $4, locked_by = $5, locked_at = now(), reason = $6
                             WHERE entity_id = $1 AND fiscal_year = $2 AND period = $3 RETURNING status`,
    [e, fiscalYear, period, status, by || null, reason || null]
  );
  return queryResult.rows[0] || null;
}

/* ── number series: gap-free because the counter row moves inside the posting transaction ────────────────────── */
/**
 * has this chit an entry in my books: under chit:<id> or one of its parts chit:<id>:…, as a late walk-in (walkin-late:<id>), as its own walk-in bill (bill:<id>, walkin_grain=bill — U-F-02), or inside a walk-in DAY entry that names it
 * (source_chit_ids) — ACC-192: a debit note waits for the invoice it raises; WALK M M-F-04: a credit note waits for the sale it reverses, a cash walk-in sale included
 */
async function chitPosted(db, e, chit_id) {
  const ref = 'chit:' + chit_id;
  const found = await db.query('SELECT 1 FROM journal_entry WHERE entity_id = $1 AND (source_ref = $2 OR source_ref LIKE $3 OR source_ref = $4 OR source_ref = $6 OR $5::text = ANY(source_chit_ids::text[])) LIMIT 1', [e, ref, ref + ':%', 'walkin-late:' + chit_id, String(chit_id), 'bill:' + chit_id]);
  return found.rows.length > 0;
}
/** nextNo(db, e, series, fy, count?) → the next number; with `count` a BLOCK of that many is reserved in the one statement and the FIRST is returned (L3: 500 leads = one move of the counter, not 500) */
async function nextNo(db, e, series, fiscalYear, count) {
  const blockSize = Math.max(1, Math.floor(Number(count) || 1));
  const queryResult = await db.query(
    `INSERT INTO books_counter (entity_id, series, fiscal_year, next_no) VALUES ($1, $2, $3, 1 + $4::int)
                            ON CONFLICT (entity_id, series, fiscal_year) DO UPDATE SET next_no = books_counter.next_no + $4::int
                            RETURNING next_no - $4::int AS n`,
    [e, series, fiscalYear || '-', blockSize]
  );
  return Number((queryResult.rows[0] || {}).n || 0);
}

/** giveBackNo(db, e, series, fy, number) — put a number back when it was the last one taken (next_no = number + 1 becomes number); a no-op when a later number was taken. ACC-192: a refused further invoice leaves no gap */
async function giveBackNo(db, e, series, fiscalYear, number) {
  await db.query('UPDATE books_counter SET next_no = $4::int WHERE entity_id = $1 AND series = $2 AND fiscal_year = $3 AND next_no = $4::int + 1', [e, series, fiscalYear || '-', number]);
}

/* ── the journal: reads ─────────────────────────────────────────────────────────────────────────────────────── */
/** the entries a run made under one source_ref base — the base itself and its redo copies (base:r2, base:r3 …), oldest first, each saying whether it was reversed: [{ entry_id, entry_no, posting_date, source_ref, reversed }] */
async function entriesBySourceBase(db, e, base) {
  const queryResult = await db.query(
    `SELECT j.entry_id, j.entry_no, j.posting_date, j.source_ref,
            EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = j.entity_id AND r.reverses_entry_id = j.entry_id) AS reversed
       FROM journal_entry j WHERE j.entity_id = $1 AND (j.source_ref = $2 OR j.source_ref LIKE $2 || ':r%') ORDER BY j.created_at, j.entry_id`,
    [e, base]
  );
  return queryResult.rows;
}
async function entryBySource(db, e, ref) {
  const queryResult = await db.query(
    `SELECT entry_id, entry_no, posting_date, doc_date, created_at, source_chit_ids, (SELECT r.entry_no FROM journal_entry r WHERE r.entity_id = journal_entry.entity_id AND r.reverses_entry_id = journal_entry.entry_id LIMIT 1) AS reversal_entry_no FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`,
    [e, ref]
  );
  return queryResult.rows[0] || null;
}
/* ═══ ACC-336: a tax payment carries the period it NAMES (b849 tax_period), a tax close carries the figures it used (b854 tax_close) ═══ */
/** do the two carrier columns exist yet (Athi runs the SQL by hand): the api is correct before and after — lib/schema's cached hasColumn */
async function taxColumnsReady() {
  const schema = require('./schema');
  return { period: await schema.hasColumn('journal_entry', 'tax_period'), close: await schema.hasColumn('journal_entry', 'tax_close') };
}
/** the debits of the unreversed payments that name a tax period, on the given ledger roles → [{ entry_id, entry_no, posting_date, created_at, role, dr_minor, currency }], oldest CREATED first (created_at, then entry_id; never the date) */
async function taxPaymentsNaming(db, e, taxPeriod, roles) {
  const queryResult = await db.query(
    `SELECT x.entry_id, x.entry_no, to_char(x.posting_date, 'YYYY-MM-DD') AS posting_date, x.created_at, a.role, l.dr_minor::bigint AS dr_minor, l.currency
       FROM journal_entry x JOIN journal_line l ON l.entity_id = x.entity_id AND l.entry_id = x.entry_id JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id
      WHERE x.entity_id = $1 AND x.tax_period = $2 AND x.reverses_entry_id IS NULL AND l.dr_minor > 0 AND a.role = ANY($3::text[])
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)
      ORDER BY x.created_at, x.entry_id`,
    [e, taxPeriod, roles]
  );
  return queryResult.rows.map((row) => Object.assign({}, row, { dr_minor: Number(row.dr_minor) }));
}
/** how many unreversed tax payments dated on or after a day name NO period (all history, and anything posted before b849) — a payment whose period is unknown is never guessed */
async function taxPaymentsWithoutPeriod(db, e, from) {
  const queryResult = await db.query(
    `SELECT COUNT(*)::int AS n FROM journal_entry x
      WHERE x.entity_id = $1 AND x.event_type IN ('tax_payment', 'gst_payment') AND x.tax_period IS NULL AND x.reverses_entry_id IS NULL AND x.posting_date >= $2::date
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)`,
    [e, from]
  );
  return Number((queryResult.rows[0] || {}).n || 0);
}
/** the entry a close was posted under (its source_ref) with the figures it carried → { entry_id, entry_no, created_at, tax_close } | null; tax_close is null before b854 or for an older close */
async function taxCloseOf(db, e, ref, closeColumn) {
  const queryResult = await db.query(
    `SELECT entry_id, entry_no, created_at, ${closeColumn ? 'tax_close' : 'NULL::jsonb AS tax_close'} FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`,
    [e, ref]
  );
  return queryResult.rows[0] || null;
}
/** the tax closes posted under these source_refs, with the figures each carried → [{ source_ref, created_at, tax_close }] (a read; nothing recomputed) */
async function taxClosesOf(db, e, refs) {
  const queryResult = await db.query(`SELECT source_ref, created_at, tax_close FROM journal_entry x WHERE entity_id = $1 AND source_ref = ANY($2::text[]) AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)`, [e, refs]);
  return queryResult.rows;
}
/** ACC-275: what a posted entry DEBITED, by ledger role, as stored → [{ role, dr_minor, currency }] (the carried row a replay answers; nothing is recomputed) */
async function entryDebitsByRole(db, e, entryId) {
  const queryResult = await db.query(
    `SELECT a.role, SUM(l.dr_minor)::bigint AS dr_minor, MIN(l.currency) AS currency, COUNT(DISTINCT l.currency)::int AS currencies
       FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id
      WHERE l.entity_id = $1 AND l.entry_id = $2 AND l.dr_minor > 0 GROUP BY a.role`,
    [e, entryId]
  );
  return queryResult.rows.map((row) => ({ role: row.role, dr_minor: Number(row.dr_minor), currency: row.currencies > 1 ? '*mixed*' : row.currency }));
}
/**
 * OPS-81: my receipts of their bill (sender me, their bill no. and total) against any of these chits whose posting still stands (an entry under
 * source_ref chit:<id> that nothing has reversed) → [{ chit_id, no, total, entry_id, entry_no }], oldest first
 */
async function receiptBillsAgainst(db, e, chitIds) {
  const found = await db.query(
    `SELECT ch.chit_id, ${require('./folder-inventory').theirNoSql('ch')} AS no, ch.business_json->'their_bill'->>'total' AS total, j.entry_id, j.entry_no
       FROM chit_header ch JOIN journal_entry j ON j.entity_id = ch.entity_id AND j.source_ref = 'chit:' || ch.chit_id::text AND j.reverses_entry_id IS NULL
      WHERE ch.entity_id = $1 AND ch.purpose = 'receipt' AND ch.sender_entity_id IS NOT DISTINCT FROM $1 AND ch.business_json->'against'->>'chit_id' = ANY($2::text[])
        AND COALESCE(ch.business_json->'their_bill'->>'total', '') <> ''
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = j.entity_id AND r.reverses_entry_id = j.entry_id) ORDER BY ch.created_at`,
    [e, chitIds]
  );
  return found.rows;
}
/** ORD-FIX O4: the entries a bill's own posting made (source_ref chit:<id>…) that nothing has reversed yet — a payment against the bill is not among them → [entry_id] */
async function unreversedForChit(db, e, chit_id) {
  const found = await db.query(
    `SELECT x.entry_id FROM journal_entry x
     WHERE x.entity_id = $1 AND x.source_ref LIKE 'chit:' || $2 || '%' AND x.reverses_entry_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)`,
    [e, String(chit_id)]
  );
  return found.rows.map((row) => row.entry_id);
}
/**
 * ACC-269 · the input tax expense chits' postings carry, READ from the books in ONE query for the return's month: sum (dr - cr) of each chit's unreversed entries' lines on the
 * ledger ROLES given (the pack's input roles, e.g. input_cgst), posted in [from, to) ('YYYY-MM-DD'). A reversal posted before `to` takes the entry away (it nets to nothing); one
 * posted later does not (the month stays as it was filed, as booksEntryOfCopy asAt). → { <chit_id>: { <role>: minor } }; a chit or role with nothing posted is absent.
 */
async function inputTaxOfChits(db, e, chitIds, roles, from, to) {
  const found = await db.query(
    `SELECT substring(x.source_ref from '^chit:([0-9a-f-]{36})') AS chit_id, a.role, SUM(l.dr_minor - l.cr_minor) AS minor
       FROM journal_entry x JOIN journal_line l ON l.entry_id = x.entry_id AND l.entity_id = x.entity_id JOIN ledger_account a ON a.account_id = l.account_id
      WHERE x.entity_id = $1 AND substring(x.source_ref from '^chit:([0-9a-f-]{36})') = ANY($2::text[]) AND x.reverses_entry_id IS NULL AND a.role = ANY($3::text[])
        AND to_char(x.posting_date, 'YYYY-MM-DD') >= $4 AND to_char(x.posting_date, 'YYYY-MM-DD') < $5
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id AND to_char(r.posting_date, 'YYYY-MM-DD') < $5)
      GROUP BY 1, 2`,
    [e, (chitIds || []).map(String), roles, from, to]
  );
  const out = {};
  found.rows.forEach((row) => {
    if (Number(row.minor)) (out[row.chit_id] = out[row.chit_id] || {})[row.role] = Number(row.minor);
  });
  return out;
}
/** which of these sources have already posted — the source_refs that exist (a day never carries a bill that posted on its own) */
async function postedSources(db, e, refs) {
  if (!refs || !refs.length) return [];
  const queryResult = await db.query(`SELECT source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref = ANY($2::text[])`, [e, refs]);
  return queryResult.rows.map((x) => x.source_ref);
}
/**
 * the MARKERS a run leaves where it posts no entry (a tax close with nothing to set off; a depreciation run whose year amount is 0): books_change_log rows (table, row_id, field) →
 * the row_ids that carry one. The change log is append-only and survives a year reopen, so the marker does too; no new table.
 */
async function markedRows(db, e, table, field, rowIds) {
  if (!rowIds || !rowIds.length) return [];
  const queryResult = await db.query(`SELECT DISTINCT row_id FROM books_change_log WHERE entity_id = $1 AND table_name = $2 AND field = $3 AND row_id = ANY($4::text[])`, [e, table, field, rowIds]);
  return queryResult.rows.map((x) => x.row_id);
}
async function entry(db, e, id) {
  const headerResult = await db.query(`SELECT * FROM journal_entry WHERE entity_id = $1 AND entry_id = $2`, [e, id]);
  if (!headerResult.rows[0]) return null;
  const lineResult = await db.query(`SELECT * FROM journal_line WHERE entity_id = $1 AND entry_id = $2 ORDER BY line_no`, [e, id]);
  const itemResult = await db.query(`SELECT * FROM party_item WHERE entity_id = $1 AND entry_id = $2 ORDER BY item_id`, [e, id]);
  return Object.assign({}, headerResult.rows[0], { lines: lineResult.rows, items: itemResult.rows });
}
/**
 * the lines of [from, to] with their entry — and WHERE EACH ENTRY CAME FROM (Athi, 2026-10-01: "how do I connect to the
 * sale record, who has done it?"), in this same query: the shop's OWN copy of the source chit (entity-scoped LEFT JOIN — an
 * entry with no chit, or a chit that is not this shop's, still shows) gives the printed number, the counter and who was
 * signed in there (business_json.till.by — till.html chitOf); the entry's writer (created_by → identities) is the fallback.
 * `covers` is how many bills a walk-in day names. routes/books.js sourceOf() shapes these src_* columns.
 * HOW IT WAS PAID (Athi, 2026-10-01: "clearly segregate credit, cash, UPI"): a bill's tender parts as the counter recorded
 * them (payment.parts — a credit note's refund.parts), a receipt's mode and cheque; a walk-in DAY's split is read from
 * the entry's OWN debit lines on the cash / UPI / card / bank ledgers (`tenders`) — never recomputed from the bills.
 * BOTH TIMES (Athi, 2026-10-01: "the time the bill was made or the time the entry was accepted? both should be there"):
 * the chit's own moment (billed_at — a receipt's at — else the chit's created_at) and the entry's created_at.
 * ⚠️⚠️ LATERAL … LIMIT 1, NEVER A PLAIN JOIN: a counter bill is a SELF-chit, and a shop on self_copy_pref 'both' holds TWO
 *   chit_header rows for it (sent + received, same entity — b149). A plain join doubled every line, and every total.
 */
/**
 * PERF1 · THE REVERSAL OF EACH ENTRY, read ONCE per statement: the shop's reversal entries (few — b406's partial index) grouped to the first per
 * original, hash-joined to the page. It was a LATERAL per LINE that read journal_entry once per line (1.4 s for a fortnight at 100k lines).
 */
const REVERSALS_SQL = `(SELECT DISTINCT ON (x.reverses_entry_id) x.reverses_entry_id, x.entry_no, x.entry_id, x.narration FROM journal_entry x
                         WHERE x.entity_id = $1 AND x.reverses_entry_id IS NOT NULL ORDER BY x.reverses_entry_id, x.created_at)`;
/** the largest page a books list answers (DISCIPLINES §2: a server-side maximum — never the client's word) and the page when none is asked */
const PAGE_MAX = 500,
  PAGE_DEFAULT = 100;
/** ' DESC' when the page runs newest first (pg.desc), else nothing */
const directionOf = (pg) => (pg && pg.desc ? ' DESC' : '');
/** the keyset part of a page's WHERE: after the cursor (pushes its two args), and not the opening period when the page says so */
function keysetWhere(args, pg) {
  let where = '';
  if (pg.after && pg.after.date && pg.after.no != null) {
    args.push(pg.after.date, String(pg.after.no));
    where += ` AND (p.posting_date, p.entry_no) ${pg.desc ? '<' : '>'} ($${args.length - 1}::date, $${args.length})`; /* l16-scale: a page can run NEWEST first (pg.desc): the same keyset pair, read the other way */
  }
  if (pg.noOpening) where += ' AND p.period <> 0'; /* a ledger's period 0 is IN its opening (WX-R2R) — never a page row */
  return where;
}
/**
 * PERF1 · ONE PAGE of entries, keyset (posting_date, entry_no) — the order every books list is read in. pg = { limit, after: { date, no } | null,
 * entries: [entry_id] | null }: `entries` names the entries outright (≤ PAGE_MAX — a ledger line opening its own journal), else `limit` entries after
 * the cursor, of those with a line on account_id / party_id when given. → the SQL fragment and its args (appended to `args`), used by entryLines.
 */
function pageSql(args, pg, account_id, party_id) {
  if (Array.isArray(pg.entries)) {
    args.push(pg.entries.slice(0, PAGE_MAX));
    return `AND h.entry_id = ANY($${args.length}::uuid[])`;
  }
  const pageLimit = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(pg.limit) || PAGE_DEFAULT)));
  let extraWhere = keysetWhere(args, pg);
  if (account_id || party_id)
    extraWhere += ` AND EXISTS (SELECT 1 FROM journal_line q WHERE q.entity_id = $1 AND q.entry_id = p.entry_id AND ($4::uuid IS NULL OR q.account_id = $4) AND ($5::uuid IS NULL OR q.party_id = $5))`;
  args.push(pageLimit + 1); /* one more than asked: entryPage knows there is a next page without a second count */
  return `AND h.entry_id IN (SELECT p.entry_id FROM journal_entry p WHERE p.entity_id = $1 AND p.posting_date >= $2::date AND p.posting_date <= $3::date${extraWhere}
                                ORDER BY p.posting_date${pg.desc ? ' DESC' : ''}, p.entry_no${pg.desc ? ' DESC' : ''} LIMIT $${args.length})`;
}
/**
 * W15-89b · THE ENTRY'S OWN LINES, beside each line (a ledger line says who was paid and for what): every line of the entry with its ledger, its tax mark and the party it names (the shop's own lists only,
 * nickname first, as S.parties) — read IN the statement; a listed party with no nickname carries its party_id and entryLines names them all in ONE namesOf (identities is never joined here). lib/books-other-side picks the other ledger and the name from it.
 */
const OTHERS_SQL = `,
                                   (SELECT jsonb_agg(jsonb_build_object('line_no', ol.line_no, 'code', oa.code, 'name', oa.name, 'role', oa.role, 'dr_minor', ol.dr_minor, 'cr_minor', ol.cr_minor, 'tax', ol.tax_rate IS NOT NULL,
                                              'party_name', COALESCE(ocl.nickname, osl.nickname),
                                              'party_id', CASE WHEN ocl.customer_identity_id IS NOT NULL OR osl.supplier_entity_id IS NOT NULL THEN ol.party_id END) ORDER BY ol.line_no)
                                      FROM journal_line ol JOIN ledger_account oa ON oa.account_id = ol.account_id
                                      LEFT JOIN customer_list ocl ON ocl.owner_entity_id = $1 AND ocl.customer_identity_id = ol.party_id
                                      LEFT JOIN supplier_list osl ON osl.owner_entity_id = $1 AND osl.supplier_entity_id = ol.party_id
                                     WHERE ol.entity_id = $1 AND ol.entry_id = h.entry_id) AS entry_lines`;
/** every line of every entry in [from, to] (or of one page of entries), joined to its account, source chit and who posted it; opt.others adds entry_lines (OTHERS_SQL) */
async function entryLines(db, e, from, to, account_id, party_id, pg, opt) {
  const args = [e, from, to, account_id || null, party_id || null];
  const page = pg ? pageSql(args, pg, account_id, party_id) : '';
  const direction = directionOf(pg);
  /* RETURNS SPEED: the whole window with no page and no account or party asked (the Day book's range, the return's "claimed with no tax invoice"): the entries FIRST (date index), their lines by ONE array read of the entry index (as taxEntryLines) — joined from the lines up, the planner on a book with no statistics yet read the shop's whole book of lines per entry */
  const whole = !pg && !account_id && !party_id;
  const lead = whole
    ? `WITH win AS MATERIALIZED (SELECT h.entry_id FROM journal_entry h WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date OFFSET 0),
     ln AS MATERIALIZED (SELECT l.* FROM journal_line l WHERE l.entity_id = $1 AND l.entry_id = ANY(ARRAY(SELECT entry_id FROM win)))
    `
    : '';
  const queryResult = await db.query(entryLinesSql({ lead, whole, page, direction, opt }), args);
  if (opt && opt.others) await namePartiesOf(db, e, queryResult.rows);
  return queryResult.rows;
}
/** the statement entryLines runs (the text is the one statement, moved here to keep entryLines short): `lead` the whole-window CTEs, `whole` no page / account / party asked, `page` pageSql's fragment, `direction` ' DESC' when newest first, `opt.others` adds OTHERS_SQL */
function entryLinesSql({ lead, whole, page, direction, opt }) {
  return `${lead}SELECT h.entry_id, h.entry_no, h.posting_date, h.doc_date, h.event_type, h.narration, h.source_chit_id, h.reverses_entry_id, h.period,
                                   l.line_no, l.account_id, a.code, a.name AS account_name, a.role AS account_role, l.party_id, l.dr_minor, l.cr_minor, l.currency, l.counter_id, l.tax_rate, to_jsonb(l) ->> 'txn_currency' AS txn_currency, to_jsonb(l) ->> 'amount_txn_minor' AS amount_txn_minor, to_jsonb(l) ->> 'fx_rate' AS fx_rate,
                                   h.source_ref, cardinality(h.source_chit_ids) AS covers, c.chit_id AS src_chit_id, c.purpose AS src_purpose, cst.current_status AS src_status,
                                   COALESCE(c.business_json ->> 'printed_as', c.business_json ->> 'bill_no', c.business_json -> 'payment_received' ->> 'no') AS src_ref,
                                   COALESCE(c.business_json -> 'till' ->> 'id', c.business_json -> 'summary' -> 'till' ->> 'id') AS src_till,
                                   c.business_json -> 'till' -> 'by' AS src_by, c.business_json -> 'till' ->> 'by_name' AS src_by_name, nm.by_name, nm.src_by_ident,
                                   COALESCE(c.business_json -> 'payment' -> 'parts', c.business_json -> 'refund' -> 'parts') AS src_parts,
                                   h.created_at AS recorded_at, c.created_at AS src_created_at, rv.entry_no AS reversed_by, rv.entry_id AS reversed_by_id,
                                   COALESCE(c.business_json ->> 'billed_at', c.business_json -> 'payment_received' ->> 'at') AS src_billed_at,
                                   c.business_json -> 'payment_received' ->> 'mode' AS src_mode, c.business_json -> 'payment_received' -> 'cheque' AS src_cheque,
                                   CASE WHEN h.source_chit_ids IS NOT NULL THEN
                                     (SELECT jsonb_agg(jsonb_build_object('role', ta.role, 'dr_minor', tl.dr_minor) ORDER BY tl.line_no)
                                        FROM journal_line tl JOIN ledger_account ta ON ta.account_id = tl.account_id
                                       WHERE tl.entity_id = $1 AND tl.entry_id = h.entry_id AND tl.dr_minor > 0 AND ta.role IN ('cash', 'upi', 'card', 'bank')) END AS tenders,
                                   /* a walk-in day names the bills it covers (M132): its first line only, once per entry, numbers as printed — no extra trip */
                                   CASE WHEN h.source_chit_ids IS NOT NULL AND l.line_no = 1 THEN
                                     (SELECT jsonb_agg(jsonb_build_object('chit_id', b.chit_id, 'ref', b.ref) ORDER BY b.ref)
                                        FROM (SELECT DISTINCT ON (x.chit_id) x.chit_id, COALESCE(x.business_json ->> 'printed_as', x.business_json ->> 'bill_no') AS ref
                                                FROM chit_header x WHERE x.entity_id = $1 AND x.chit_id = ANY(h.source_chit_ids) ORDER BY x.chit_id, x.direction) b) END AS day_bills${opt && opt.others ? OTHERS_SQL : ''}
                              FROM ${whole ? 'ln l JOIN journal_entry h ON h.entry_id = l.entry_id' : 'journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id'}
                              JOIN ledger_account a ON a.account_id = l.account_id
                              LEFT JOIN LATERAL (SELECT x.chit_id, x.purpose, x.direction, x.business_json, x.created_at FROM chit_header x
                                                  WHERE x.entity_id = $1 AND x.chit_id = h.source_chit_id ORDER BY x.direction LIMIT 1) c ON true
                              LEFT JOIN chit_status cst ON cst.chit_id = c.chit_id AND cst.entity_id = $1 AND cst.direction = c.direction   /* ACC-232: the status lives in chit_status (unique per chit, entity, direction), not on chit_header */
                              LEFT JOIN ${REVERSALS_SQL} rv ON rv.reverses_entry_id = h.entry_id   /* M174: the entry that reversed this one, in the same read (PERF1: once, not per line) */
                              LEFT JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(c.business_json -> 'till' -> 'by') = 'string' AND c.business_json -> 'till' ->> 'by' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (c.business_json -> 'till' ->> 'by')::uuid END AS till_by) tb ON true   /* the till's signed-in person is an identity id: its name is read in this query, the id is never shown */
                              LEFT JOIN LATERAL (SELECT max(n.display_name) FILTER (WHERE n.identity_id = h.created_by) AS by_name, max(n.display_name) FILTER (WHERE n.identity_id = tb.till_by) AS src_by_ident
                                                  FROM identities n WHERE n.identity_id IN (h.created_by, tb.till_by)) nm ON true   /* SEC-185: the entry's author and the till's person named by ONE read of identities (a statement of the shop's own handle) */
                             WHERE l.entity_id = $1 AND h.entity_id = $1 ${whole ? '' : 'AND h.posting_date >= $2::date AND h.posting_date <= $3::date'} /* the whole window: the lines ARE the window's, a date test here would start the plan at the entry date index again */
                               AND ($4::uuid IS NULL OR l.account_id = $4) AND ($5::uuid IS NULL OR l.party_id = $5) ${page}
                             ORDER BY h.posting_date${direction}, h.entry_no${direction}, l.line_no`;
}
/** a listed party with no nickname: its name from the ONE names reader, once for every row of the page (entry_lines[].party_id → party_name) */
async function namePartiesOf(db, e, rows) {
  const bare = rows.flatMap((row) => (row.entry_lines || []).filter((line) => line.party_id && !line.party_name));
  if (!bare.length) return;
  const names = await namesOf(db, e, bare.map((line) => line.party_id));
  bare.forEach((line) => { line.party_name = names.get(String(line.party_id)) || null; });
}
/**
 * PERF1 · a page of entryLines and the cursor of the next: pg = { limit, after } (see pageSql). → { rows, next: { date, no } | null, limit }.
 * The page read one entry more than asked; that entry's lines are dropped here and its presence is the "there is more".
 */
async function entryPage(db, e, from, to, account_id, party_id, pg, opt) {
  const pageLimit = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(pg.limit) || PAGE_DEFAULT)));
  const rows = await entryLines(db, e, from, to, account_id, party_id, Object.assign({}, pg, { limit: pageLimit, entries: null }), opt);
  const ids = [];
  rows.forEach((item) => {
    if (ids[ids.length - 1] !== String(item.entry_id)) ids.push(String(item.entry_id));
  });
  if (ids.length <= pageLimit) return { rows, next: null, limit: pageLimit };
  const keep = rows.filter((item) => String(item.entry_id) !== ids[pageLimit]),
    last = keep[keep.length - 1];
  return {
    rows: keep,
    next: last ? { date: require('./books-engines').ymd(last.posting_date), no: String(last.entry_no) } : null,
    limit: pageLimit
  }; /* the one date reader */
}
/** W2-BOOKS: the LINES of the entries of given event types in a date range, with the ledger code — ONE trip (the return read subtracts the period's own set-off and tax payment) */
async function taxEntryLines(db, e, from, to, types, shape) {
  /* fix/bas-monday: an entry is also a settlement by its SHAPE — every line on a GST ledger or on money (the roles in shape.money) and at least one on a GST ledger
     (Dr GST payable / Cr bank is a payment to the tax office however it was posted: a manual journal carries no event word). A reversal has the same shape, so both leave together. */
  const result = await db.query(
    `WITH ids AS (SELECT COALESCE(array_agg(account_id) FILTER (WHERE role = ANY($5::text[])), '{}') AS tax_ids, COALESCE(array_agg(account_id) FILTER (WHERE role = ANY($6::text[])), '{}') AS ok_ids FROM ledger_account WHERE entity_id = $1),
     win AS MATERIALIZED (SELECT h.entry_id FROM journal_entry h WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date OFFSET 0), /* RETURNS SPEED: the window's entries FIRST (date index) */
     ln AS MATERIALIZED (SELECT l.entry_id, l.account_id, l.party_id, l.dr_minor, l.cr_minor, h.event_type, h.is_opening FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id WHERE l.entity_id = $1 AND l.entry_id = ANY(ARRAY(SELECT entry_id FROM win))), /* their lines by the entry index in ONE array read: a per-entry LATERAL is planned on the table's statistics, and with none (a book just loaded, before autovacuum) it read the shop's whole book of lines per entry (15 s, HTTP 500) */
     k AS (SELECT l.*, bool_or(l.account_id = ANY(ids.tax_ids)) OVER (PARTITION BY l.entry_id) AS has_tax, bool_and(l.account_id = ANY(ids.ok_ids)) OVER (PARTITION BY l.entry_id) AS only_tax_money FROM ln l CROSS JOIN ids)
     SELECT k.entry_id, k.event_type, a.code, k.dr_minor, k.cr_minor
                              FROM k JOIN ledger_account a ON a.account_id = k.account_id
                             WHERE k.party_id IS NULL
                               AND (k.event_type = ANY($4::text[]) OR (k.is_opening IS NOT TRUE AND k.has_tax AND k.only_tax_money))`,
    [e, from, to, types, (shape && shape.tax) || [], ((shape && shape.tax) || []).concat((shape && shape.money) || [])]
  );
  return result.rows;
}
/** fix/bas-monday: a TAXED receipt on an income ledger that is not a sales ledger (Sundry income): the credit side, net, of the income-nature lines of entries that carry a line on the output-GST ledger (a reversal carries one too, so it nets the receipt away) — read by the entry's GST line, not by the account (G1 is taxable supplies by tax code). → [{ code, dr_minor, cr_minor }] */
async function taxedIncomeLines(db, e, from, to, outputRole, skipRoles) {
  const result = await db.query(
    `WITH ids AS (SELECT COALESCE(array_agg(account_id) FILTER (WHERE role = $4), '{}') AS tax_ids FROM ledger_account WHERE entity_id = $1),
     win AS MATERIALIZED (SELECT h.entry_id FROM journal_entry h WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND h.is_opening IS NOT TRUE OFFSET 0), /* the window's entries first (date index), their lines by one array read of the entry index: see taxEntryLines */
     ln AS MATERIALIZED (SELECT l.entry_id, l.account_id, l.party_id, l.dr_minor, l.cr_minor FROM journal_line l WHERE l.entity_id = $1 AND l.entry_id = ANY(ARRAY(SELECT entry_id FROM win))),
     tl AS (SELECT l.account_id, l.party_id, l.dr_minor, l.cr_minor, bool_or(l.account_id = ANY(ids.tax_ids)) OVER (PARTITION BY l.entry_id) AS taxed FROM ln l CROSS JOIN ids),
     g AS MATERIALIZED (SELECT account_id, SUM(dr_minor) AS dr_minor, SUM(cr_minor) AS cr_minor FROM tl WHERE taxed AND party_id IS NULL GROUP BY account_id) /* per account first: the join to the ledger below is over a handful of rows, never over the window's lines */
     SELECT a.code, SUM(l.dr_minor)::bigint AS dr_minor, SUM(l.cr_minor)::bigint AS cr_minor
                              FROM g l JOIN ledger_account a ON a.account_id = l.account_id
                             WHERE a.nature = 'income' AND COALESCE(a.role, '') <> ALL($5::text[])
                             GROUP BY a.code`,
    [e, from, to, outputRole, skipRoles]
  );
  return result.rows;
}
/** l16-accfix ACC-new-1: the lines on `roles`, net, of the entries in a date range that ALSO carry a line on the tax role (a reversal carries one too, so it nets the posting away) — a box that counts only the postings that carried recoverable tax (the pack's returns.taxedOnly), read by the entry's tax line, not by the account; WALK T T-F-01: a line stated at 0% inside such an entry (a bill's exempt or zero-rated line) is not standard-rated and is left out. → [{ code, dr_minor, cr_minor }] */
async function taxedOnlyLines(db, e, from, to, taxRole, roles) {
  const result = await db.query(
    `WITH ids AS (SELECT COALESCE(array_agg(account_id) FILTER (WHERE role = $4), '{}') AS tax_ids FROM ledger_account WHERE entity_id = $1),
     win AS MATERIALIZED (SELECT h.entry_id FROM journal_entry h WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND h.is_opening IS NOT TRUE OFFSET 0), /* the window's entries first (date index), their lines by one array read of the entry index: see taxEntryLines */
     ln AS MATERIALIZED (SELECT l.entry_id, l.account_id, l.party_id, l.dr_minor, l.cr_minor, l.tax_rate FROM journal_line l WHERE l.entity_id = $1 AND l.entry_id = ANY(ARRAY(SELECT entry_id FROM win))),
     tl AS (SELECT l.account_id, l.dr_minor, l.cr_minor, l.tax_rate, bool_or(l.account_id = ANY(ids.tax_ids)) OVER (PARTITION BY l.entry_id) AS taxed FROM ln l CROSS JOIN ids),
     g AS MATERIALIZED (SELECT account_id, SUM(dr_minor) AS dr_minor, SUM(cr_minor) AS cr_minor FROM tl WHERE taxed AND COALESCE(tax_rate, '') !~ '^0+([.]0+)?$' GROUP BY account_id)
     SELECT a.code, SUM(l.dr_minor)::bigint AS dr_minor, SUM(l.cr_minor)::bigint AS cr_minor
                              FROM g l JOIN ledger_account a ON a.account_id = l.account_id
                             WHERE a.role = ANY($5::text[])
                             GROUP BY a.code`,
    [e, from, to, taxRole, roles]
  );
  return result.rows;
}
/**
 * ACC-290 part A: the sales lines of a date range that carry a 0% rate on the given ledger role (the plain sales ledger: a 0% sale that named no supply kind lands there),
 * in the shop's currency, from entries neither reversed nor a reversal. ONE trip. → { lines, total_minor } (credit minus debit, minor units, a count and a sum only).
 * A line to a NAMED buyer counts (a sent or order invoice at 0%: the sales line carries the party, supply-kind critic change 3); a typed reclass journal that debits the ledger at rate 0 nets it.
 * `lines` is JOURNAL lines (day close posts one per rate), never an item count: the items waiting are zeroRateKindless below.
 * ⚠ the SQL is proved on the in-memory twin here and on a real Postgres by the S41 integration job, not on the laptop.
 */
async function zeroRateSales(db, e, from, to, role, currency) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS lines, COALESCE(SUM(l.cr_minor - l.dr_minor), 0) AS total_minor
       FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id JOIN ledger_account a ON a.account_id = l.account_id
      WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND a.role = $4 AND l.currency = $5
        AND l.tax_rate ~ '^0+([.]0+)?$' AND h.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = h.entity_id AND r.reverses_entry_id = h.entry_id)`,
    [e, from, to, role, currency]
  );
  const row = result.rows[0] || {};
  return { lines: Number(row.lines || 0), total_minor: Number(row.total_minor || 0) };
}
/**
 * SUPPLY KIND: what the OWNER has still to answer in the catalogue, in ONE trip: the live tax slabs at rate 0 that name no `tax_kind` and no India `nil_kind` (the same fact, saved before the pack named kinds) (id and name, at most 50) and the items that carry a bare
 * 0% rate of their own (no slab, no kind). An item that cites a slab is answered by the slab. → { slabs: [{ id, name }], slab_count, item_count }. Read only.
 */
async function zeroRateKindless(db, e) {
  const result = await db.query(
    `SELECT (SELECT COALESCE(jsonb_agg(s ORDER BY s.name), '[]'::jsonb) FROM (SELECT d.definition_id::text AS id, d.name FROM definition d
               JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
              WHERE d.entity_id = $1 AND d.kind = 'tax' AND d.status = 'live' AND (v.rules->>'rate') ~ '^0+([.]0+)?$' AND COALESCE(trim(v.rules->>'tax_kind'), '') = '' AND COALESCE(trim(v.rules->>'nil_kind'), '') = '' ORDER BY d.name LIMIT 50) s) AS slabs,
            (SELECT COUNT(*)::int FROM definition d JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
              WHERE d.entity_id = $1 AND d.kind = 'tax' AND d.status = 'live' AND (v.rules->>'rate') ~ '^0+([.]0+)?$' AND COALESCE(trim(v.rules->>'tax_kind'), '') = '' AND COALESCE(trim(v.rules->>'nil_kind'), '') = '') AS slab_count,
            (SELECT COUNT(*)::int FROM catalogue_items ci WHERE ci.entity_id = $1 AND ci.is_active = true AND (ci.item_data->>'gst_rate') ~ '^0+([.]0+)?$'
                AND COALESCE(trim(ci.item_data->>'tax_slab'), '') = '' AND COALESCE(trim(ci.item_data->>'tax_kind'), '') = '') AS item_count`,
    [e]
  );
  const row = result.rows[0] || {};
  return { slabs: Array.isArray(row.slabs) ? row.slabs : [], slab_count: Number(row.slab_count || 0), item_count: Number(row.item_count || 0) };
}
async function entries(db, e, from, to) {
  const queryResult = await db.query(
    `SELECT entry_id, entry_no, posting_date, doc_date, fiscal_year, period, event_type, narration, source_chit_id, source_ref,
                                   reverses_entry_id, is_opening, total_minor, currency, created_by, created_at
                              FROM journal_entry WHERE entity_id = $1 AND posting_date >= $2::date AND posting_date <= $3::date
                             ORDER BY posting_date, entry_no`,
    [e, from, to]
  );
  return queryResult.rows;
}

/** the seven values of the pageSums statement: entity · from · to · account · party · the cursor's date and entry number — pure */
const pageSumsArgs = (e, from, to, account_id, party_id, after) => [
  e,
  from,
  to,
  falsyToNull(account_id),
  falsyToNull(party_id),
  after && after.date ? after.date : null,
  after && after.no != null ? String(after.no) : null
];
/**
 * PERF1 · THE FIGURES A PAGED LIST STANDS ON, from the server — never the loaded rows added up. Over [from, to] (with a line on account_id /
 * party_id when given; period 0 left out when `noOpening`, as a ledger's opening already holds it): how many entries, Σ Dr, Σ Cr — and the same
 * sums BEFORE the cursor (`after`), so a ledger page's opening is the range's opening + those (ONE indexed SUM, never the earlier pages read).
 * → { entries, dr, cr, before_dr, before_cr }
 */
async function pageSums(db, e, from, to, account_id, party_id, after, noOpening) {
  const args = pageSumsArgs(e, from, to, account_id, party_id, after);
  const line = account_id || party_id;
  const queryResult = await db.query(
    `SELECT COUNT(DISTINCT h.entry_id)::int AS entries, COALESCE(SUM(l.dr_minor), 0) AS dr, COALESCE(SUM(l.cr_minor), 0) AS cr,
                                   COALESCE(SUM(l.dr_minor) FILTER (WHERE $6::date IS NOT NULL AND (h.posting_date, h.entry_no) <= ($6::date, $7)), 0) AS before_dr,
                                   COALESCE(SUM(l.cr_minor) FILTER (WHERE $6::date IS NOT NULL AND (h.posting_date, h.entry_no) <= ($6::date, $7)), 0) AS before_cr
                              FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = $1
                             WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date
                               AND ($4::uuid IS NULL OR l.account_id = $4) AND ($5::uuid IS NULL OR l.party_id = $5)${noOpening ? ' AND h.period <> 0' : ''}`,
    args
  );
  const x = queryResult.rows[0] || {};
  /* a Day book's Σ is over every line (Dr = Cr); with no account the count is of entries all the same */
  return {
    entries: Number(x.entries) || 0,
    dr: numberOrZero(x.dr),
    cr: numberOrZero(x.cr),
    before_dr: numberOrZero(x.before_dr),
    before_cr: numberOrZero(x.before_cr),
    by_line: !!line
  };
}

/* ── the journal: THE FOUR WRITES (postEntry only) ───────────────────────────────────────────────────────────── */
/** the nineteen values of insertEntry's INSERT, in $-number order (the series is $18, the voucher type $19) — pure, nothing read */
const entryValues = (e, entryHeader) => [
  e,
  entryHeader.entry_no,
  entryHeader.posting_date,
  falsyToNull(entryHeader.doc_date),
  entryHeader.fiscal_year,
  entryHeader.period,
  falsyToNull(entryHeader.source_chit_id),
  falsyToNull(entryHeader.source_ref),
  entryHeader.event_type,
  falsyToNull(entryHeader.rule_version),
  falsyToNull(entryHeader.reverses_entry_id),
  !!entryHeader.is_opening,
  falsyToNull(entryHeader.narration),
  entryHeader.currency,
  entryHeader.total_minor,
  falsyToNull(entryHeader.created_by),
  /* the chits a SUMMARY entry covers (a walk-in day names its bills — a bill it does not name posts late, critic M7) */
  Array.isArray(entryHeader.source_chit_ids) && entryHeader.source_chit_ids.length ? entryHeader.source_chit_ids : null,
  /* the voucher SERIES (SV · PV · … · MJ) */
  entryHeader.series || 'JV',
  /* the voucher TYPE (Sales · Payment · Journal …), kept for every new entry since b279 ran (Athi, 2026-10-03). An MJ entry keeps its own kind
     (a manual Payment reads Payment, not Journal). Entries written before it are NULL and derived from the series (books.voucherTypeOfEntry). */
  falsyToNull(entryHeader.voucher_type)
];
/** ACC-336: the tax period / close an entry header carries, as extra columns of the SAME insert (pushes their values) → { columns, marks } */
async function taxEntryColumns(entryHeader, values) {
  let columns = '',
    marks = '';
  if (entryHeader.tax_period || entryHeader.tax_close) {
    /* ACC-336: the carried period / close figures ride on the SAME insert (the table is insert-only) once b849 / b854 have run; before, the write is what it was */
    const ready = await taxColumnsReady();
    if (entryHeader.tax_period && ready.period) {
      values.push(entryHeader.tax_period);
      columns += ', tax_period';
      marks += ',$' + values.length;
    }
    if (entryHeader.tax_close && ready.close) {
      values.push(JSON.stringify(entryHeader.tax_close));
      columns += ', tax_close';
      marks += ',$' + values.length + '::jsonb';
    }
  }
  return { columns, marks };
}
/** ACC-176b: the grant and the firm an adviser's entry was posted under, as extra columns of the SAME insert (pushes their values) → { columns, marks } */
async function grantEntryColumns(values) {
  let columns = '',
    marks = '';
  const grantId = require('./reqctx').actingGrantId(); /* ACC-176b: an adviser's entry names the grant it was posted under (b866), on the SAME insert: the table is insert-only */
  if (grantId) { values.push(grantId); columns += ', grant_id'; marks += ',$' + values.length; }
  const actor = grantId && require('./reqctx').actingWho();
  if (actor && (await require('./schema').hasColumn('journal_entry', 'by_firm'))) { values.push(actor.name || null, actor.firm || null); columns += ', by_name, by_firm'; marks += ',$' + (values.length - 1) + ',$' + values.length; } /* b871: the person and the firm, kept at the write */
  return { columns, marks };
}
/** the columns an entry header may carry beyond the fixed nineteen (tax period / close, the grant it was posted under, who and which firm), their marks, and their values pushed onto `values` */
async function optionalEntryColumns(entryHeader, values) {
  const tax = await taxEntryColumns(entryHeader, values);
  const grant = await grantEntryColumns(values);
  return { columns: tax.columns + grant.columns, marks: tax.marks + grant.marks };
}
/** write ONE journal header (postEntry only) → { entry_id, created_at } */
async function insertEntry(db, e, entryHeader) {
  const values = entryValues(e, entryHeader);
  const { columns, marks } = await optionalEntryColumns(entryHeader, values);
  const queryResult = await db.query(
    `INSERT INTO journal_entry (entity_id, entry_no, series, posting_date, doc_date, fiscal_year, period, source_chit_id, source_ref,
                                                       event_type, rule_version, reverses_entry_id, is_opening, narration, currency, total_minor, created_by,
                                                       source_chit_ids, voucher_type${columns})
                            VALUES ($1,$2,$18,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::uuid[],$19${marks})
                            RETURNING entry_id, created_at`,
    values
  );
  return queryResult.rows[0];
}
/** the values of ONE journal_line row, in column order: twelve, then (once b392's columns exist) txn_currency · fx_rate_source · fx_rate_date — pure */
const lineValues = (e, entry_id, item, withFxColumns) => {
  const values = [
    e,
    entry_id,
    item.line_no,
    item.account_id,
    falsyToNull(item.party_id),
    item.dr_minor,
    item.cr_minor,
    item.currency,
    missingToNull(item.amount_txn_minor),
    item.fx_rate || 1,
    falsyToNull(item.counter_id),
    falsyToNull(item.tax_rate)
  ];
  if (withFxColumns) values.push(item.txn_currency || item.currency, falsyToNull(item.fx_rate_source), falsyToNull(item.fx_rate_date));
  return values;
};
/** write the lines of ONE entry in a single multi-row INSERT (postEntry only); a no-line call writes nothing */
async function insertLines(db, e, entry_id, lines) {
  if (!lines.length) return;
  /* FX1: b392's three columns (txn_currency · fx_rate_source · fx_rate_date) ride on the row once they exist; before b392 the write is the same as it was */
  const withFxColumns = await fxLinesReady(),
    columnCount = withFxColumns ? 15 : 12;
  const vals = [],
    args = [];
  lines.forEach((item, index) => {
    const firstColumn = index * columnCount;
    vals.push('(' + Array.from({ length: columnCount }, (_, column) => '$' + (firstColumn + column + 1)).join(',') + ')');
    args.push(...lineValues(e, entry_id, item, withFxColumns));
  });
  await db.query(
    `INSERT INTO journal_line (entity_id, entry_id, line_no, account_id, party_id, dr_minor, cr_minor, currency,
                                            amount_txn_minor, fx_rate, counter_id, tax_rate${withFxColumns ? ', txn_currency, fx_rate_source, fx_rate_date' : ''}) VALUES ${vals.join(',')}`,
    args
  );
}
/* ── FX1 · the exchange rates (b391 fx_rate — insert-only; the newest row for a day and pair is that day's rate) ── */
const fxRatesReady = () => require('./schema').hasTable('fx_rate');
const FX_COLS = 'rate_id, rate_date, from_ccy, to_ccy, rate::text AS rate, source, source_ref, entered_by, created_at';
/** the exchange rates of a shop, newest day first; `filter.from` narrows to one currency, `filter.limit` (default 500) caps the rows */
async function fxRates(db, e, filter) {
  const options = filter || {},
    args = [e],
    where = ['entity_id = $1'];
  if (options.from) {
    args.push(options.from);
    where.push('from_ccy = $' + args.length);
  }
  args.push(options.limit || 500);
  const queryResult = await db.query(
    `SELECT ${FX_COLS} FROM fx_rate WHERE ${where.join(' AND ')} ORDER BY rate_date DESC, from_ccy, rate_id DESC LIMIT $${args.length}`,
    args
  );
  return queryResult.rows;
}
/** rows → ONE INSERT (an import is one trip, however many rows) */
async function insertFxRates(db, e, rows, by) {
  if (!rows.length) return [];
  await fxLock(db, e, false);
  const vals = [],
    args = [];
  rows.forEach((x, index) => {
    const firstColumn = index * 8;
    vals.push(
      '($' +
        (firstColumn + 1) +
        ',$' +
        (firstColumn + 2) +
        '::date,$' +
        (firstColumn + 3) +
        ',$' +
        (firstColumn + 4) +
        ',$' +
        (firstColumn + 5) +
        '::numeric,$' +
        (firstColumn + 6) +
        ',$' +
        (firstColumn + 7) +
        ',$' +
        (firstColumn + 8) +
        ')'
    );
    args.push(e, x.rate_date, x.from_ccy, x.to_ccy, x.rate, x.source, x.source_ref, by || null);
  });
  const queryResult = await db.query(
    `INSERT INTO fx_rate (entity_id, rate_date, from_ccy, to_ccy, rate, source, source_ref, entered_by) VALUES ${vals.join(',')} RETURNING ${FX_COLS}`,
    args
  );
  return queryResult.rows;
}
/** the newest rate for that day — or, with `since`, the newest on or before `date` and not before `since` (a period's closing rate) */
async function fxRateOn(db, e, from, to, date, since) {
  await fxLock(db, e, true);
  const queryResult = await db.query(
    `SELECT ${FX_COLS} FROM fx_rate WHERE entity_id = $1 AND from_ccy = $2 AND to_ccy = $3 AND ${since ? 'rate_date BETWEEN $5::date AND $4::date' : 'rate_date = $4::date'}
                             ORDER BY rate_date DESC, rate_id DESC LIMIT 1`,
    since ? [e, from, to, date, since] : [e, from, to, date]
  );
  return queryResult.rows[0] || null;
}
/** FX1 (b392): does journal_line carry its transaction currency yet — lib/schema's cached hasColumn */
const fxLinesReady = () => require('./schema').hasColumn('journal_line', 'txn_currency');
/**
 * FX1 — THE OPEN FOREIGN BALANCES, as at a day: per account × party × transaction currency (not the functional one), what the books carry (functional,
 * Dr +) beside the foreign amount (its own minor units, Dr +). ONE grouped read over journal_line (b392). `party` / `account_ids` narrow it (a settlement
 * asks for one party on one control account). Rows whose foreign amount is nil are left out.
 */
async function foreignBalances(db, e, input) {
  const filter = input || {},
    args = [e, filter.asOf || '9999-12-31', filter.functional || ''],
    where = [];
  if (filter.party) {
    args.push(filter.party);
    where.push('l.party_id = $' + args.length);
  }
  if (Array.isArray(filter.account_ids) && filter.account_ids.length) {
    args.push(filter.account_ids);
    where.push('l.account_id = ANY($' + args.length + '::uuid[])');
  }
  if (filter.currency) {
    args.push(filter.currency);
    where.push('l.txn_currency = $' + args.length);
  }
  const queryResult = await db.query(
    `SELECT l.account_id, l.party_id, l.txn_currency,
                                   SUM(l.dr_minor - l.cr_minor) AS fn_minor,
                                   SUM(CASE WHEN l.dr_minor > 0 THEN COALESCE(l.amount_txn_minor, 0) ELSE -COALESCE(l.amount_txn_minor, 0) END) AS txn_minor
                              FROM journal_line l JOIN journal_entry j ON j.entry_id = l.entry_id AND j.entity_id = l.entity_id
                             WHERE l.entity_id = $1 AND j.posting_date <= $2::date AND l.txn_currency IS NOT NULL AND l.txn_currency <> $3${where.length ? ' AND ' + where.join(' AND ') : ''}
                             GROUP BY l.account_id, l.party_id, l.txn_currency
                            HAVING SUM(CASE WHEN l.dr_minor > 0 THEN COALESCE(l.amount_txn_minor, 0) ELSE -COALESCE(l.amount_txn_minor, 0) END) <> 0`,
    args
  );
  return queryResult.rows.map((x) => ({
    account_id: x.account_id,
    party_id: x.party_id || null,
    txn_currency: x.txn_currency,
    fn_minor: numberOrZero(x.fn_minor),
    txn_minor: numberOrZero(x.txn_minor)
  }));
}
/** one upsert per (account, party_key, currency, year, period) — the running monthly totals */
async function addBalances(db, e, rows) {
  for (const balance of rows) {
    await db.query(
      `INSERT INTO account_balance (entity_id, account_id, party_key, currency, fiscal_year, period, dr_minor, cr_minor, line_count, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
                    ON CONFLICT (entity_id, account_id, party_key, currency, fiscal_year, period)
                    DO UPDATE SET dr_minor = account_balance.dr_minor + EXCLUDED.dr_minor, cr_minor = account_balance.cr_minor + EXCLUDED.cr_minor,
                                  line_count = account_balance.line_count + EXCLUDED.line_count, updated_at = now()`,
      [
        e,
        balance.account_id,
        balance.party_key || ZERO,
        balance.currency,
        balance.fiscal_year,
        balance.period,
        balance.dr_minor,
        balance.cr_minor,
        balance.line_count
      ]
    );
  }
}
/** the twenty values of one party_item INSERT, in column order — pure, nothing read */
const itemValues = (e, item) => [
  e,
  item.party_id,
  item.account_id,
  item.side,
  item.ref,
  item.against_ref,
  item.ref_kind,
  falsyToNull(item.kind),
  item.amount_minor || 0,
  missingToNull(item.pending_minor),
  item.currency,
  falsyToNull(item.due_date),
  falsyToNull(item.doc_date),
  falsyToNull(item.status),
  falsyToNull(item.reverses),
  falsyToNull(item.reverses_kind),
  falsyToNull(item.entry_id),
  falsyToNull(item.payment_id),
  falsyToNull(item.note),
  falsyToNull(item.created_by)
];
/** write the party_item rows of one entry, one INSERT each (postEntry only) */
async function insertItems(db, e, nestedItems) {
  for (const item of nestedItems) {
    await db.query(
      `INSERT INTO party_item (entity_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency,
                                            due_date, doc_date, status, reverses, reverses_kind, entry_id, payment_id, note, created_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      itemValues(e, item)
    );
  }
}

/* ── balances: reads ────────────────────────────────────────────────────────────────────────────────────────── */
/** every monthly row of one year, with its ledger code — CBLedger's `balances` */
/** PERF1: `fy` may be a LIST of years — every year a carry-forward needs in ONE read (books.yearBalances), not one trip per year */
async function yearRows(db, e, fiscalYear) {
  const many = Array.isArray(fiscalYear);
  const queryResult = await db.query(
    `SELECT b.fiscal_year, b.period, a.code, b.party_key, b.dr_minor, b.cr_minor FROM account_balance b
                              JOIN ledger_account a ON a.account_id = b.account_id
                             WHERE b.entity_id = $1 AND ${many ? 'b.fiscal_year = ANY($2::text[])' : 'b.fiscal_year = $2'}`,
    [e, fiscalYear]
  );
  return queryResult.rows;
}
/** the journal lines posted in [from, to], with code and entry — CBLedger's `lines` */
/**
 * M29: each line also says whether its entry was REVERSED and by what (`reverses_entry_id` on the line's own entry; `reversed_by` /
 * `reversed_narration` = the first entry that points back at it, read in the SAME query — a reversal dated outside [from, to] still shows).
 */
/** MIS SPEED: the SELECT list of ledgerLines, shared by its two shapes */
const LEDGER_LINE_COLUMNS = `h.entry_id, h.entry_no, h.posting_date, h.fiscal_year, h.period, h.is_opening, h.source_ref, h.narration,
                                   h.source_chit_id, h.event_type, h.reverses_entry_id, l.line_no, a.code, l.party_id, l.dr_minor, l.cr_minor, l.currency,
                                   rv.entry_no AS reversed_by, rv.narration AS reversed_narration`;
/**
 * No party: the window's ENTRIES are found first by the date index (OFFSET 0 keeps the planner from starting at the shop's lines) and each entry's lines by entry — on a real Postgres with 7 years (34,506 entries, 103,518 lines)
 * the old shape read every line of the shop and looked each one's entry up to test its date (631 ms for 5,712 lines). One party: the old shape, whose party index is the narrower start.
 */
const LEDGER_LINES_WINDOW_SQL = `SELECT ${LEDGER_LINE_COLUMNS}
                              FROM (SELECT h.* FROM journal_entry h WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date OFFSET 0) h
                              JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = $1 JOIN ledger_account a ON a.account_id = l.account_id
                              LEFT JOIN ${REVERSALS_SQL} rv ON rv.reverses_entry_id = h.entry_id
                             WHERE ($4::uuid IS NULL OR l.party_id = $4)
                             ORDER BY h.posting_date, h.entry_no, l.line_no`;
const LEDGER_LINES_PARTY_SQL = `SELECT ${LEDGER_LINE_COLUMNS}
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
                              LEFT JOIN ${REVERSALS_SQL} rv ON rv.reverses_entry_id = h.entry_id
                             WHERE l.entity_id = $1 AND h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND ($4::uuid IS NULL OR l.party_id = $4)
                             ORDER BY h.posting_date, h.entry_no, l.line_no`;
async function ledgerLines(db, e, from, to, party_id) {
  const queryResult = await db.query(party_id ? LEDGER_LINES_PARTY_SQL : LEDGER_LINES_WINDOW_SQL, [e, from, to, party_id || null]);
  return queryResult.rows;
}
/** the years that have any balance row, oldest first */
async function years(db, e) {
  const queryResult = await db.query(`SELECT DISTINCT fiscal_year FROM account_balance WHERE entity_id = $1 ORDER BY fiscal_year`, [e]);
  return queryResult.rows.map((x) => x.fiscal_year);
}
/**
 * 5-YEAR GROWTH (l16-scale) · what each year's stored month rows ADD UP TO, one grouped read of the shop's account_balance → [{ fiscal_year, n, dr, cr, lines }] oldest first.
 * The key of a year's carry (books.carryKeys) is made from these — a late correction in any year moves its sums, so every later carry key changes.
 */
async function yearStamps(db, e) {
  const found = await db.query(
    `SELECT fiscal_year, count(*)::int AS n, COALESCE(sum(dr_minor), 0)::text AS dr, COALESCE(sum(cr_minor), 0)::text AS cr, COALESCE(sum(line_count), 0)::text AS lines
       FROM account_balance WHERE entity_id = $1 GROUP BY fiscal_year ORDER BY fiscal_year`,
    [e]
  );
  return found.rows;
}
/** b873: the kept carry of a year under its key → the rows, or null (no such row, or the table is not there yet) */
async function carryRead(db, e, fiscalYear, key) {
  if (!key || !(await require('./schema').hasTable('year_carry'))) return null;
  const found = await db.query('SELECT rows, retained_minor, profit_minor FROM year_carry WHERE entity_id = $1 AND fiscal_year = $2 AND carry_year_key = $3', [e, fiscalYear, key]);
  const row = found.rows[0];
  return row ? { rows: row.rows, retained_minor: Number(row.retained_minor), profit_minor: Number(row.profit_minor) } : null;
}
/** b873: keep a year's carry ({ rows, retained_minor, profit_minor, currency }: the two figures rounded by the engine's money operator) under its key. A cache: a refusal (a read-only look under a grant, a racing writer) is swallowed inside a savepoint and never fails the read it rides on. */
async function carryWrite(db, e, fiscalYear, key, carry) {
  if (!key || !(await require('./schema').hasTable('year_carry'))) return false;
  try {
    await db.query('SAVEPOINT year_carry_w');
    await db.query('INSERT INTO year_carry (entity_id, fiscal_year, carry_year_key, rows, row_count, retained_minor, profit_minor) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) ON CONFLICT (entity_id, fiscal_year, carry_year_key) DO NOTHING', [e, fiscalYear, key, JSON.stringify(carry.rows), carry.rows.length, require('./books-money-ops').roundMinor(carry.retained_minor, carry.currency), require('./books-money-ops').roundMinor(carry.profit_minor, carry.currency)]);
    await db.query('RELEASE SAVEPOINT year_carry_w');
    return true;
  } catch (_) {
    await db.query('ROLLBACK TO SAVEPOINT year_carry_w').catch(require('./logger').orElse('year carry: the rollback after a refused write failed', undefined));
    require('./logger').fellBack('year carry: not kept (a cache) — the year is recomputed on the next read', _, 'debug');
    return false;
  }
}
/** Σ of the monthly rows for periods [pFrom, pTo] of one year — per account (party_key zero) or per account+party */
async function periodSums(db, e, fiscalYear, pFrom, toPeriod, byParty) {
  const queryResult = await db.query(
    `SELECT account_id, party_key, SUM(dr_minor) AS dr, SUM(cr_minor) AS cr FROM account_balance
                             WHERE entity_id = $1 AND fiscal_year = $2 AND period BETWEEN $3 AND $4
                               AND (CASE WHEN $5 THEN party_key <> $6::uuid ELSE party_key = $6::uuid END)
                             GROUP BY account_id, party_key`,
    [e, fiscalYear, pFrom, toPeriod, !!byParty, ZERO]
  );
  return queryResult.rows.map((x) => ({
    account_id: x.account_id,
    party_id: x.party_key === ZERO ? null : x.party_key,
    dr: numberOrZero(x.dr),
    cr: numberOrZero(x.cr)
  }));
}
/** Σ of the lines posted in [from, to] — for the part of a month a balance row cannot answer */
async function lineSums(db, e, from, to, byParty) {
  const queryResult = await db.query(
    `SELECT l.account_id, ${byParty ? 'l.party_id' : 'NULL::uuid AS party_id'}, SUM(l.dr_minor) AS dr, SUM(l.cr_minor) AS cr
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id
                             WHERE l.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND NOT h.is_opening
                               ${byParty ? 'AND l.party_id IS NOT NULL' : ''}
                             GROUP BY l.account_id${byParty ? ', l.party_id' : ''}`,
    [e, from, to]
  );
  return queryResult.rows.map((x) => ({ account_id: x.account_id, party_id: x.party_id || null, dr: numberOrZero(x.dr), cr: numberOrZero(x.cr) }));
}
/** the Day book entry kinds a sale is read from (the walk-in day, a bill, a credit bill, a return) — Home's Till card, Trend and the practice read the SAME ones; no other file names them (tests/sold-one-rule.test.cjs) */
const DAY_KINDS = ['walkin_day', 'sale_bill', 'credit_given', 'return'];
/** what came in across the counter: the roles every pack maps its ways of paying to */
const TENDER_ROLES = ['cash', 'upi', 'card', 'bank'];
/** what was sold: the tenders plus the customer's account — a credit bill is Dr debtors, the one receivable role across packs */
const SOLD_ROLES = TENDER_ROLES.concat('debtors');
/** the currency word of a day that holds more than one: never summed, never guessed */
const MIXED = '*mixed*';
const sqlTexts = (list) => "ARRAY['" + list.join("','") + "']::text[]";
/**
 * ⭐ THE ONE SOLD RULE AS SQL (REQ-MIS-SHOWCASE section 10 finding 1, section 12 defect E; cb-finance signs it): one row per Day book ENTRY —
 * { day, fiscal_year, period, entry_id, cur_lo, cur_hi, sold, taken, bills } — net Dr − Cr on SOLD_ROLES (`sold`) and on TENDER_ROLES (`taken`) over
 * the DAY_KINDS entries, reversed entries and the reversals left out. `soldByDay` folds it by posting day; the practice statement folds it by the
 * month its fiscal period names (the join the entry's own fiscal_year + period give: the same one account_balance rows use).
 * ⭐ THE BOUNDS ARE IN THE WHERE: bound.from / bound.to are SQL texts for a date (a $n or an expression) applied to h.posting_date, which the index
 * journal_entry_date_idx (entity_id, posting_date) answers — a window of months reads those months' entries only, never the book.
 * entity is the SQL text of the entity (a $n). The kinds and roles are this file's constants, inlined.
 */
function soldEntriesSql(entity, bound) {
  const range = (bound && bound.from ? ` AND h.posting_date >= ${bound.from}::date` : '') + (bound && bound.to ? ` AND h.posting_date <= ${bound.to}::date` : '');
  /* MIS SPEED: the roles are resolved to the shop's account ids ONCE (ids) and each entry's lines are tested by id; joining ledger_account inside the LATERAL read the account table once per entry (1,760 entries: 14,080 of 19,471 page reads) */
  const sold = 'l.account_id = ANY(ids.sold_ids)', taken = 'l.account_id = ANY(ids.taken_ids)';
  return `WITH ids AS (SELECT COALESCE(array_agg(account_id) FILTER (WHERE role = ANY(${sqlTexts(SOLD_ROLES)})), '{}') AS sold_ids, COALESCE(array_agg(account_id) FILTER (WHERE role = ANY(${sqlTexts(TENDER_ROLES)})), '{}') AS taken_ids, COALESCE(array_agg(account_id) FILTER (WHERE role LIKE 'sales%'), '{}') AS sales_ids FROM ledger_account WHERE entity_id = ${entity})
          SELECT h.posting_date::text AS day, h.fiscal_year, h.period, h.entry_id, k.cur_lo, k.cur_hi, k.sold, k.taken, k.sales_ex,
                 CASE WHEN h.event_type = 'return' THEN 0 ELSE COALESCE(cardinality(h.source_chit_ids), 1) END AS bills /* AJ-F-08: a return (a credit note) is never a bill sold, whatever chit it names */
            FROM (SELECT h.entry_id, h.posting_date, h.fiscal_year, h.period, h.source_chit_ids, h.event_type
                    FROM journal_entry h
                   WHERE h.entity_id = ${entity} AND h.event_type = ANY(${sqlTexts(DAY_KINDS)}) AND h.reverses_entry_id IS NULL${range}
                     AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = ${entity} AND r.reverses_entry_id = h.entry_id)
                  OFFSET 0) h /* OFFSET 0 and LATERAL: the entries of the window are found FIRST by the date index and the lines of each by entry — the planner, left alone, reads the lines of the SOLD accounts of the whole book */
            CROSS JOIN ids
            CROSS JOIN LATERAL (SELECT count(*) AS n, MIN(l.currency) FILTER (WHERE ${sold}) AS cur_lo, MAX(l.currency) FILTER (WHERE ${sold}) AS cur_hi,
                                       SUM(CASE WHEN ${sold} THEN l.dr_minor - l.cr_minor ELSE 0 END) AS sold,
                                       SUM(CASE WHEN ${taken} THEN l.dr_minor - l.cr_minor ELSE 0 END) AS taken,
                                       SUM(CASE WHEN l.account_id = ANY(ids.sales_ids) THEN l.cr_minor - l.dr_minor ELSE 0 END) AS sales_ex /* FW-04: the sales ledgers of the same entries, Cr minus Dr, tax out: the P&L Sales and GST-free sales net of returns */
                                  FROM journal_line l
                                 WHERE l.entry_id = h.entry_id AND l.entity_id = ${entity}) k
           WHERE k.n > 0`;
}
/** a day's money as { minor, currency }: one currency → its sum; more than one → MIXED and no sum (never added across currencies) */
const dayMoney = (minor, lowCurrency, highCurrency) => (lowCurrency && highCurrency && lowCurrency !== highCurrency ? { minor: null, currency: MIXED } : { minor: numberOrZero(minor), currency: lowCurrency || highCurrency || null });
/**
 * REP-48 · SOLD per posting day over { from, to } ('YYYY-MM-DD', either may be left out; both inclusive): net Dr − Cr on SOLD_ROLES over the
 * DAY_KINDS entries, reversed entries and the reversals left out, with the bills each entry covers and what came in across the counter (`taken`)
 * — the one rule Home's Till card, Trend and the practice read (soldEntriesSql), grouped by day in ONE statement, the bounds in its WHERE.
 * → [{ day 'YYYY-MM-DD', sold { minor, currency }, taken { minor, currency }, bills }] oldest first. A day holding two currencies carries
 * currency '*mixed*' and minor null. Nothing is recomputed from a bill. Callers pass the months they SHOW; no bounds = the whole book (a test or an export).
 */
async function soldByDay(db, e, bound) {
  const params = [e], at = {};
  if (bound && bound.from) { params.push(bound.from); at.from = '$' + params.length; }
  if (bound && bound.to) { params.push(bound.to); at.to = '$' + params.length; }
  const found = await db.query(
    `SELECT x.day, SUM(x.sold) AS sold, SUM(x.taken) AS taken, SUM(x.bills) AS bills, MIN(x.cur_lo) AS cur_lo, MAX(x.cur_hi) AS cur_hi
       FROM (${soldEntriesSql('$1', at)}) x
      GROUP BY x.day ORDER BY x.day`,
    params
  );
  return found.rows.map((x) => ({ day: x.day, sold: dayMoney(x.sold, x.cur_lo, x.cur_hi), taken: dayMoney(x.taken, x.cur_lo, x.cur_hi), bills: numberOrZero(x.bills) }));
}
/**
 * YEAR ON YEAR (Athi 16 Nov): this fiscal year to date against the same dates a year back, the one SOLD rule over two bounded index ranges (24 months at most), for the clients of the PAGE only —
 * the verdict and the order never need it, so the other clients are not read for it ($1 the client, $2..$5 the dates of yoyDates). One currency or no figure.
 */
const YOY_STATEMENT = `SELECT $1::uuid AS entity_id,
    (SELECT COALESCE(sum(x.sales_ex), 0)::bigint FROM (${soldEntriesSql('$1::uuid', { from: '$2', to: '$3' })}) x) AS sales_ytd_minor, /* FW-04: sales tax out (sales_ex), the P&L own basis; SOLD tax in stays the Home and Trend figure */
    (SELECT COALESCE(sum(x.sales_ex), 0)::bigint FROM (${soldEntriesSql('$1::uuid', { from: '$4', to: '$5' })}) x) AS sales_prev_ytd_minor,
    (SELECT max(x.day) FROM (${soldEntriesSql('$1::uuid', { from: '$2', to: '$3' })}) x) AS sales_through,
    (SELECT min(x.day) FROM (${soldEntriesSql('$1::uuid', { from: '$4', to: '$5' })}) x) AS sales_first`;

/**
 * MIS A1 · SOLD over any set of date ranges in ONE statement, the one SOLD rule (soldEntriesSql) bounded in each range's WHERE: ranges [{ from, to }] ('YYYY-MM-DD', both inclusive, both needed).
 * → [{ from, to, sold { minor, currency }, taken { minor, currency }, bills, entries, through, first }] in the order asked; a range with no entry has entries 0, through null (the caller says "no figure", never a 0 it did not read);
 * two currencies in a range → currency '*mixed*' and minor null (never added across). It equals the sum of soldByDay over the same range (tests/books-sold-totals.test.cjs; the real SQL: tests/books-sold-totals.realstack.cjs).
 */
function soldTotalsSql(ranges) {
  return ranges.map((range, index) => `SELECT ${index} AS i, COALESCE(sum(x.sold), 0) AS sold, COALESCE(sum(x.taken), 0) AS taken, COALESCE(sum(x.bills), 0) AS bills, count(*) AS entries, min(x.cur_lo) AS cur_lo, max(x.cur_hi) AS cur_hi, max(x.day) AS through, min(x.day) AS first
       FROM (${soldEntriesSql('$1', { from: '$' + (2 * index + 2), to: '$' + (2 * index + 3) })}) x`).join(' UNION ALL ');
}
async function soldTotals(db, e, ranges) {
  const list = (ranges || []).filter((range) => range && range.from && range.to);
  if (!list.length) return [];
  const found = await db.query(soldTotalsSql(list) + ' ORDER BY i', [e].concat(...list.map((range) => [range.from, range.to])));
  const byIndex = new Map(found.rows.map((x) => [Number(x.i), x]));
  return list.map((range, position) => {
    const x = byIndex.get(position) || {};
    return { from: range.from, to: range.to, sold: dayMoney(x.sold, x.cur_lo, x.cur_hi), taken: dayMoney(x.taken, x.cur_lo, x.cur_hi), bills: numberOrZero(x.bills), entries: numberOrZero(x.entries), through: x.through || null, first: x.first || null };
  });
}
/** the first posting day of any Day book sale entry ('YYYY-MM-DD') or null: where the books BEGIN, so a window can say its first period is short only when it truly is (one index walk, no sum) */
async function soldFrom(db, e) {
  const found = await db.query(`SELECT min(h.posting_date)::text AS day FROM journal_entry h WHERE h.entity_id = $1 AND h.event_type = ANY(${sqlTexts(DAY_KINDS)})`, [e]);
  return (found.rows[0] && found.rows[0].day) || null;
}
async function firstYear(db, e) {
  const queryResult = await db.query(`SELECT MIN(fiscal_year) AS fy FROM account_balance WHERE entity_id = $1`, [e]);
  return queryResult.rows[0] ? queryResult.rows[0].fy : null;
}
/** the nightly check: every month's balance rows recomputed from the lines, and the rows that differ */
async function balanceDrift(db, e) {
  const queryResult = await db.query(
    `WITH l AS (
                               SELECT l.account_id, COALESCE(l.party_id, $2::uuid) AS party_key, l.currency, h.fiscal_year, h.period,
                                      SUM(l.dr_minor) AS dr, SUM(l.cr_minor) AS cr
                                 FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id
                                WHERE l.entity_id = $1 AND l.party_id IS NOT NULL
                                GROUP BY 1,2,3,4,5
                               UNION ALL
                               SELECT l.account_id, $2::uuid, l.currency, h.fiscal_year, h.period, SUM(l.dr_minor), SUM(l.cr_minor)
                                 FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id
                                WHERE l.entity_id = $1 GROUP BY 1,2,3,4,5)
                             SELECT COALESCE(l.account_id, b.account_id) AS account_id, COALESCE(l.party_key, b.party_key) AS party_key,
                                    COALESCE(l.fiscal_year, b.fiscal_year) AS fiscal_year, COALESCE(l.period, b.period) AS period,
                                    COALESCE(l.dr, 0) AS lines_dr, COALESCE(l.cr, 0) AS lines_cr, COALESCE(b.dr_minor, 0) AS kept_dr, COALESCE(b.cr_minor, 0) AS kept_cr
                               FROM l FULL JOIN (SELECT * FROM account_balance WHERE entity_id = $1) b
                                 ON b.account_id = l.account_id AND b.party_key = l.party_key AND b.currency = l.currency
                                AND b.fiscal_year = l.fiscal_year AND b.period = l.period
                              WHERE COALESCE(l.dr, 0) <> COALESCE(b.dr_minor, 0) OR COALESCE(l.cr, 0) <> COALESCE(b.cr_minor, 0)
                              LIMIT 50`,
    [e, ZERO]
  );
  return queryResult.rows.map((x) => ({
    account_id: x.account_id,
    party_id: x.party_key === ZERO ? null : x.party_key,
    fiscal_year: x.fiscal_year,
    period: x.period,
    lines_dr: numberOrZero(x.lines_dr),
    lines_cr: numberOrZero(x.lines_cr),
    kept_dr: numberOrZero(x.kept_dr),
    kept_cr: numberOrZero(x.kept_cr)
  }));
}
/** entries whose lines do not add up — the trigger-free proof, run nightly */
async function unbalancedEntries(db, e) {
  const queryResult = await db.query(
    `SELECT h.entry_no, SUM(l.dr_minor) AS dr, SUM(l.cr_minor) AS cr FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id
                             WHERE h.entity_id = $1 GROUP BY h.entry_no HAVING SUM(l.dr_minor) <> SUM(l.cr_minor) LIMIT 20`,
    [e]
  );
  return queryResult.rows.map((x) => ({ entry_no: x.entry_no, dr: numberOrZero(x.dr), cr: numberOrZero(x.cr) }));
}

/* ── open items ─────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐ C3 (PAY-FIX): ONE HOLDER OF A PARTY'S ROWS AT A TIME. Two staff recording the same ₹1,000 against the same bill on two
 * devices both read "₹1,000 open", both passed confirmItems, and the bill went to −₹1,000. The lock is taken BEFORE the read
 * (lib/books.js lockedItems) and Postgres holds it until the transaction ends, so the second read sees the first write.
 */
async function lockParty(db, e, party_id, account_id) {
  return require('./xact-lock').lockKeys(db, e, [party_id + '|' + account_id]);
}
/** ACC-275: ONE HOLDER OF A TAX HEAD AT A TIME — the key gst|<head> (shop is the lock's first part), taken in one sorted call by a tax payment and by the period close */
async function lockTaxHeads(db, e, heads) {
  return require('./xact-lock').lockKeys(db, e, Array.from(new Set(heads)).map((head) => 'gst|' + head));
}
/** ACC-328: ONE POSTER OF A DAY'S OPENING BALANCES AT A TIME — the key opening|<day> (shop is the lock's first part); two posts at once both read "none" without it */
async function lockOpening(db, e, openingDay) {
  return require('./xact-lock').lockKeys(db, e, ['opening|' + openingDay]);
}
/** PERF1: `party_id` may be a LIST — the parties one screen shows (a CRM page, the cheques list), one read; never every party's items for a page of them */
async function items(db, e, party_id, account_id) {
  const many = Array.isArray(party_id);
  const queryResult = await db.query(
    `SELECT item_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency, due_date, doc_date,
                                   status, reverses, reverses_kind, entry_id, payment_id, note, created_at FROM party_item
                             WHERE entity_id = $1 AND ${many ? 'party_id = ANY($2::uuid[])' : '($2::uuid IS NULL OR party_id = $2)'} AND ($3::uuid IS NULL OR account_id = $3)
                             ORDER BY created_at, item_id`,
    [e, many ? party_id.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))) : party_id || null, account_id || null]
  );
  return queryResult.rows.map((x) => Object.assign({}, x, { amount_minor: numberOrZero(x.amount_minor) }));
}
/** openItems with no day: every document dated at any time (the cash view looks ahead of today, so it asks for no cut-off) */
const NO_DAY_BOUND = '9999-12-31';
/**
 * ⭐ GROWTH5Y (16 Nov): the OPEN items of one control account — every row of a document whose rows do not net to nothing, and the other rows of the allocations that touch it (an allocation is a PAIR of rows
 * under one ref; a half left out would make the engine refuse "a half is missing"). A bill paid in full, and the receipts that paid it, are not read: the cost of /dues follows what is still owed, not the years.
 * ONE definition (lib/books-open-items.rowsSql, scoped to this account and day: status rows and every allocation link followed to the end). Same columns, same order as items(); the engine reads these rows exactly as it reads the whole set (netOpen, followUp). Only for "as at today" (asOf null = no day bound: LV-15, the cash view counts a bill dated after today): a past day asks items() (a bill paid since was open then).
 */
async function openItems(db, e, account_id, asOf) {
  const bounds = asOf ? { account: '$2::uuid', asOf: '$3::date' } : { account: '$2::uuid' };
  const queryResult = await db.query(`SELECT * FROM (${require('./books-open-items').rowsSql('$1::uuid', bounds)}) o ORDER BY o.created_at, o.item_id`, asOf ? [e, account_id, asOf] : [e, account_id]);
  return queryResult.rows.map((x) => Object.assign({}, x, { amount_minor: numberOrZero(x.amount_minor) }));
}
/** who holds these documents on one control account: [{ ref, party_id }] — a document belongs to ONE party (postEntry asks before it writes) */
async function itemOwners(db, e, account_id, refs) {
  if (!refs || !refs.length) return [];
  const queryResult = await db.query(
    `SELECT DISTINCT ref, party_id FROM party_item WHERE entity_id = $1 AND account_id = $2 AND ref = against_ref AND ref = ANY($3::text[])`,
    [e, account_id, refs]
  );
  return queryResult.rows;
}
/** RAIL-216: who holds this document on ANY control account of mine: [party_id] (a document belongs to one party; the sender's withdraw asks whether a payment is allocated to it) */
async function billParties(db, e, ref) {
  const queryResult = await db.query(`SELECT DISTINCT party_id FROM party_item WHERE entity_id = $1 AND ref = against_ref AND ref = $2`, [e, String(ref)]);
  return queryResult.rows.map((row) => row.party_id);
}
/** FIN-92: ONE HOLDER OF A LOAN AT A TIME — two instalments of one loan read its balance one after the other (the key loan|<ref>, taken before loanOutstanding is read) */
async function lockLoan(db, e, ref) {
  return require('./xact-lock').lockKeys(db, e, ['loan|' + ref]);
}
/** the loan a posted entry belongs to, in SQL (ONE definition; every reader names its journal_entry alias): the loan entry (source_ref loan:<ref>) is its own ref; an instalment (emi:<ref>:<its ref>, its ref holds no ':') belongs to everything before the LAST ':' */
const loanRefSql = (alias) => `CASE WHEN ${alias}.source_ref LIKE 'loan:%' THEN substr(${alias}.source_ref, 6) ELSE regexp_replace(substr(${alias}.source_ref, 5), ':[^:]*$', '') END`;
/** the sentence for a loan that still has live instalments (docs/error-codes.json ENTRY_HAS_REPAYMENTS carries the same words; the code stays, it is contract) */
const LOAN_HAS_INSTALMENTS_WORDS = 'This loan has instalments. Reverse its instalments first.';
/**
 * a loan's own entry (source_ref loan:<ref>, unreversed) that still has a live instalment (emi:<ref>:<its ref>, unreversed, interest-only ones too): reversing it would leave the instalment as a stray debit on the loan account
 * (fin-92 LC-8: -300,000). One read for a page -> Set of entry_id. The instalment's loan is loanRefSql, compared by EQUALITY (never LIKE: a % or _ in a loan ref stays literal).
 * WARNING ACC-357 (next/acc35x-api) rewrites lib/books-live-bill.js, the caller of this: its restack keeps this read here.
 */
async function loanEntriesWithRepayments(db, e, entryIds) {
  const ids = (entryIds || []).filter((item) => /^[0-9a-f-]{36}$/i.test(String(item)));
  if (!ids.length) return new Set();
  const found = await db.query(
    `SELECT x.entry_id FROM journal_entry x
      WHERE x.entity_id = $1 AND x.entry_id = ANY($2::uuid[]) AND x.source_ref LIKE 'loan:%'
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)
        AND EXISTS (SELECT 1 FROM journal_entry i WHERE i.entity_id = x.entity_id AND i.source_ref LIKE 'emi:%' AND i.reverses_entry_id IS NULL
          AND ${loanRefSql('i')} = substr(x.source_ref, 6)
          AND NOT EXISTS (SELECT 1 FROM journal_entry q WHERE q.entity_id = i.entity_id AND q.reverses_entry_id = i.entry_id))`,
    [e, ids]
  );
  return new Set(found.rows.map((row) => String(row.entry_id)));
}
/**
 * GET /loans and FIN-92, ONE READ: every loan of the shop (or the one named) with what it opened at and what is still OWED, from the posted journal: the loan entry and its instalments, each counted unless a reversal stands against it,
 * Cr minus Dr on the loan accounts (roles). A loan whose own entry was reversed is not listed. Newest first.
 * → { total, rows: [{ ref, narration, opening_minor, outstanding_minor, currency ('*mixed*' when the lines disagree), taken_on }] }; `page` = { limit, offset } or null for the whole list.
 */
async function loanBalances(db, e, roles, opt) {
  const namedRef = opt && opt.ref != null ? String(opt.ref) : null,
    page = (opt && opt.page) || null;
  const queryResult = await db.query(
    `SELECT ref, MAX(narration) FILTER (WHERE is_loan) AS narration, COALESCE(SUM(net) FILTER (WHERE is_loan), 0)::bigint AS opening_minor, COALESCE(SUM(net), 0)::bigint AS outstanding_minor,
            MIN(currency) AS currency, COUNT(DISTINCT currency)::int AS currencies, to_char(MIN(posting_date) FILTER (WHERE is_loan), 'YYYY-MM-DD') AS taken_on, COUNT(*) OVER ()::int AS total
       FROM (SELECT ${loanRefSql('x')} AS ref, x.source_ref LIKE 'loan:%' AS is_loan, x.narration, x.posting_date, l.cr_minor - l.dr_minor AS net, l.currency
               FROM journal_entry x JOIN journal_line l ON l.entry_id = x.entry_id AND l.entity_id = x.entity_id
                                    JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id
              WHERE x.entity_id = $1 AND a.role = ANY($2::text[]) AND (x.source_ref LIKE 'loan:%' OR x.source_ref LIKE 'emi:%')
                AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)) q
      WHERE ($3::text IS NULL OR ref = $3::text)
      GROUP BY ref HAVING bool_or(is_loan)
      ORDER BY MIN(posting_date) FILTER (WHERE is_loan) DESC, ref
      LIMIT $4 OFFSET $5`,
    [e, roles, namedRef, page ? page.limit : null, page ? page.offset : 0]
  );
  const rows = queryResult.rows.map((row) => ({
    ref: row.ref,
    narration: row.narration || '',
    opening_minor: Number(row.opening_minor) || 0,
    outstanding_minor: Number(row.outstanding_minor) || 0,
    currency: row.currencies > 1 ? '*mixed*' : row.currency || null,
    taken_on: row.taken_on || null
  }));
  return { total: queryResult.rows.length ? Number(queryResult.rows[0].total) || 0 : 0, rows };
}
/**
 * FIN-92: what is still OWED on ONE loan, from the books (the same read as GET /loans: loanBalances for that ref) → { minor, currency } (currency '*mixed*' when the lines disagree)
 */
async function loanOutstanding(db, e, ref, roles) {
  const found = (await loanBalances(db, e, roles, { ref })).rows[0];
  return found ? { minor: found.outstanding_minor, currency: found.currency } : { minor: 0, currency: null };
}
/** an account's net (dr − cr) over every month of every year — a balance-sheet account's standing balance */
async function accountNet(db, e, account_id) {
  const queryResult = await db.query(
    `SELECT COALESCE(SUM(dr_minor), 0) AS dr, COALESCE(SUM(cr_minor), 0) AS cr FROM account_balance
                             WHERE entity_id = $1 AND account_id = $2 AND party_key = $3::uuid`,
    [e, account_id, ZERO]
  );
  return numberOrZero(queryResult.rows[0].dr) - numberOrZero(queryResult.rows[0].cr);
}
/** E-F-03: does this shop's ledger hold any posting at all (a balance row with a figure)? — the one test of "the books are in use", for the Home cards */
async function hasPostings(db, e) {
  const queryResult = await db.query(`SELECT EXISTS (SELECT 1 FROM account_balance WHERE entity_id = $1 AND (dr_minor <> 0 OR cr_minor <> 0)) AS used`, [e]);
  return !!(queryResult.rows[0] && queryResult.rows[0].used);
}
/** Σ open items per party on one account — the other side of the control-account check */
async function itemTotals(db, e, account_id) {
  const queryResult = await db.query(`SELECT party_id, SUM(amount_minor) AS t FROM party_item WHERE entity_id = $1 AND account_id = $2 GROUP BY party_id`, [
    e,
    account_id
  ]);
  return queryResult.rows.map((x) => ({ party_id: x.party_id, total_minor: numberOrZero(x.t) }));
}

/* ── payments ───────────────────────────────────────────────────────────────────────────────────────────────── */
async function insertPayment(db, e, newPayment) {
  const queryResult = await db.query(
    `INSERT INTO books_payment (entity_id, party_id, direction, amount_minor, currency, mode, reference, cheque_no, cheque_bank,
                                                       cheque_date, received_at, client_ref, created_by)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                            ON CONFLICT (entity_id, client_ref) WHERE client_ref IS NOT NULL DO NOTHING
                            RETURNING payment_id`,
    [
      e,
      newPayment.party_id,
      newPayment.direction,
      newPayment.amount_minor,
      newPayment.currency,
      newPayment.mode,
      newPayment.reference || null,
      newPayment.cheque_no || null,
      newPayment.cheque_bank || null,
      newPayment.cheque_date || null,
      newPayment.received_at,
      newPayment.client_ref || null,
      newPayment.by || null
    ]
  );
  if (queryResult.rows[0]) return { payment_id: queryResult.rows[0].payment_id, duplicate: false };
  const x = await db.query(`SELECT payment_id FROM books_payment WHERE entity_id = $1 AND client_ref = $2`, [e, newPayment.client_ref]);
  return { payment_id: x.rows[0] && x.rows[0].payment_id, duplicate: true };
}
/** the payment a client_ref already recorded (unique per shop) — a replay is answered with it, never recorded again */
async function paymentByRef(db, e, client_ref) {
  const queryResult = await db.query(`SELECT payment_id, mode FROM books_payment WHERE entity_id = $1 AND client_ref = $2`, [e, String(client_ref)]);
  return queryResult.rows[0] || null;
}
/** H2: every payment a chit's "Mark paid" recorded — the one old key chitpay:<chit> and each press's chitpay:<chit>:<ref> — oldest first (the DELETE door names them all) */
async function paymentsOfChit(db, e, chit_id) {
  const key = 'chitpay:' + String(chit_id);
  const found = await db.query(
    `SELECT payment_id, amount_minor, currency, client_ref FROM books_payment WHERE entity_id = $1 AND (client_ref = $2 OR client_ref LIKE $2 || ':%') ORDER BY created_at, payment_id`,
    [e, key]
  );
  return found.rows.map((x) => Object.assign({}, x, { amount_minor: numberOrZero(x.amount_minor) }));
}
/** a party's payments in one direction RECORDED since a moment (the duplicate rule's W3, PAY D5: a 24-hour window) — newest first, bounded */
async function paymentsSince(db, e, party_id, direction, since) {
  const queryResult = await db.query(
    `SELECT payment_id, amount_minor, currency, mode, cheque_no, received_at, created_at FROM books_payment
                             WHERE entity_id = $1 AND party_id = $2 AND direction = $3 AND created_at >= $4 ORDER BY created_at DESC LIMIT 50`,
    [e, party_id, direction, since]
  );
  return queryResult.rows.map((x) => Object.assign({}, x, { amount_minor: numberOrZero(x.amount_minor) }));
}
/**
 * the shop's cheques with where each stands (the latest of its status rows): those still HELD (received · deposited), or
 * with `all` every cheque. Newest first, bounded. `partyId` narrows it to one party's cheques (CRM-246: a held cheque stops that party being removed).
 */
async function cheques(db, e, all, limit, partyId) {
  const queryResult = await db.query(
    `SELECT c.* FROM (
                              SELECT p.payment_id, p.party_id, p.direction, p.amount_minor, p.currency, p.reference, p.cheque_no, p.cheque_bank, p.cheque_date,
                                     p.received_at, p.created_at,
                                     (SELECT i.status FROM party_item i WHERE i.entity_id = p.entity_id AND i.payment_id = p.payment_id AND i.ref_kind = 'status'
                                         AND i.status IN ('received', 'deposited', 'cleared', 'bounced') ORDER BY i.item_id DESC LIMIT 1) AS status
                                FROM books_payment p WHERE p.entity_id = $1 AND p.mode = 'cheque' AND ($4::uuid IS NULL OR p.party_id = $4::uuid)) c
                             WHERE $2::boolean OR c.status IS NULL OR c.status IN ('received', 'deposited')
                             ORDER BY c.received_at DESC, c.created_at DESC LIMIT $3`,
    [e, !!all, limit || 200, partyId || null]
  );
  return queryResult.rows.map((x) => Object.assign({}, x, { amount_minor: numberOrZero(x.amount_minor) }));
}
async function payment(db, e, id) {
  const queryResult = await db.query(`SELECT * FROM books_payment WHERE entity_id = $1 AND payment_id = $2`, [e, id]);
  return queryResult.rows[0] ? Object.assign({}, queryResult.rows[0], { amount_minor: numberOrZero(queryResult.rows[0].amount_minor) }) : null;
}

/* ── the payment advice (M30, b285) ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DEPLOYS BEFORE b285 RUNS (Athi runs SQL by hand): every reader asks adviceReady() first — lib/schema's cached hasColumn
 * (a yes forever, a no for a minute) — and answers "not available yet" rather than 42703. No SAVEPOINT: a read that may be
 * refused is not tried; a column that is absent is simply not asked for. */
async function adviceReady(db, e) {
  const schema = require('./schema');
  return (await schema.hasColumn('books_payment', 'advice_chit_id')) && (await schema.hasColumn('books_payment', 'advice_shared_at'));
}
/** the advice columns of some payments, one read: [{ payment_id, advice_chit_id, advice_shared_at }] — call only after adviceReady() */
async function paymentsAdvice(db, e, ids) {
  const validIds = (ids || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!validIds.length) return [];
  const queryResult = await db.query(
    `SELECT payment_id, advice_chit_id, advice_shared_at FROM books_payment WHERE entity_id = $1 AND payment_id = ANY($2::uuid[])`,
    [e, validIds]
  );
  return queryResult.rows;
}
/**
 * ⭐ ONE ADVICE PER PAYMENT — merge-patch of the NAMED fields only (SPEC-payments §4.3). advice_chit_id is FIRST-WINS: the UPDATE
 * only lands while the column is null or already that id; a different id is answered { conflict: true } and the route says 409.
 * advice_shared_at: set once (COALESCE keeps the first moment). → { payment_id, advice_chit_id, advice_shared_at } | null (no such payment) | { conflict: true, advice_chit_id }
 */
async function setAdvice(db, e, id, patch) {
  const fields = patch || {};
  const queryResult = await db.query(
    `UPDATE books_payment
                               SET advice_chit_id = COALESCE(advice_chit_id, $3::uuid),
                                   advice_shared_at = COALESCE(advice_shared_at, $4::timestamptz)
                             WHERE entity_id = $1 AND payment_id = $2 AND ($3::uuid IS NULL OR advice_chit_id IS NULL OR advice_chit_id = $3::uuid)
                         RETURNING payment_id, advice_chit_id, advice_shared_at`,
    [e, id, fields.advice_chit_id || null, fields.advice_shared_at || null]
  );
  if (queryResult.rows[0]) return queryResult.rows[0];
  const x = await db.query(`SELECT payment_id, advice_chit_id, advice_shared_at FROM books_payment WHERE entity_id = $1 AND payment_id = $2`, [e, id]);
  return x.rows[0] ? Object.assign({ conflict: true }, x.rows[0]) : null;
}
/** where some advice chits stand on MY copy (the payer's: 'delivered' once sent) and whether any dispute is open on them — one read for a whole statement */
async function adviceStates(db, e, chitIds) {
  const validIds = (chitIds || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  const out = {};
  if (!validIds.length) return out;
  const queryResult = await db.query(
    `SELECT cs.chit_id, cs.current_status AS status,
                                   EXISTS (SELECT 1 FROM chit_disputes d WHERE d.entity_id = cs.entity_id AND d.chit_id = cs.chit_id AND d.status = 'open') AS disputed
                              FROM chit_status cs WHERE cs.entity_id = $1 AND cs.chit_id = ANY($2::uuid[])`,
    [e, validIds]
  );
  queryResult.rows.forEach((x) => {
    out[x.chit_id] = { status: x.status, disputed: x.disputed === true };
  });
  return out;
}
/**
 * the payments that have NO advice yet and could send one (the To-do advices_to_send, SPEC §4.7): party on rail, posted, not reversed,
 * mode ≠ a cheque still held, nothing sent or shared. One read, bounded, newest first. Call only after adviceReady().
 */
async function paymentsNeedingAdvice(db, e, limit) {
  const queryResult = await db.query(
    `SELECT p.payment_id, p.party_id, i.display_name AS name, p.direction, p.amount_minor, p.currency, p.mode, p.received_at
                              FROM books_payment p JOIN identities i ON i.identity_id = p.party_id
                             WHERE p.entity_id = $1 AND p.advice_chit_id IS NULL AND p.advice_shared_at IS NULL AND ${require('./local-identity').onRailSql('i')}
                               AND EXISTS (SELECT 1 FROM journal_entry o WHERE o.entity_id = p.entity_id AND o.source_ref = 'pay:' || p.payment_id::text)
                               AND NOT EXISTS (SELECT 1 FROM journal_entry o JOIN journal_entry r ON r.entity_id = o.entity_id AND r.reverses_entry_id = o.entry_id
                                                WHERE o.entity_id = p.entity_id AND o.source_ref = 'pay:' || p.payment_id::text)
                               AND (p.mode <> 'cheque' OR EXISTS (SELECT 1 FROM party_item s WHERE s.entity_id = p.entity_id AND s.payment_id = p.payment_id AND s.ref_kind = 'status' AND s.status = 'cleared'))
                             ORDER BY p.received_at DESC, p.created_at DESC LIMIT $2`,
    [e, limit || 50]
  );
  return queryResult.rows.map((x) => Object.assign({}, x, { amount_minor: numberOrZero(x.amount_minor) }));
}
/** the shop's own name (the advice names its sender; a co-assist's token carries the person's name, not the shop's) */
/** SAMECOUNT A-F-59: has the ledger ANY entry (opening balances, a bill, a day) - the one signal that Accounts is in use, read by Home's Accounts card */
async function hasEntries(db, e) {
  const found = await db.query('SELECT 1 FROM journal_entry WHERE entity_id = $1 LIMIT 1', [e]);
  return !!(found.rows && found.rows.length);
}
/** l16: the days that hold a LIVE opening entry (not itself a reversal, not reversed), oldest first → ['2026-07-01', …] */
async function openingDays(db, e) {
  const queryResult = await db.query(
    `SELECT DISTINCT to_char(h.posting_date, 'YYYY-MM-DD') AS day FROM journal_entry h
      WHERE h.entity_id = $1 AND h.is_opening AND h.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = h.entity_id AND r.reverses_entry_id = h.entry_id) ORDER BY 1`,
    [e]
  );
  return queryResult.rows.map((row) => row.day);
}
/**
 * l16: the names of some identities of shop `e` → Map(identity_id → display_name) (the saved opening names who entered it; a bank mark who made it; a ledger line its party).
 * Read by boundRead (SEC-185): the real db module binds it to the shop in ONE trip, a transaction handle is already bound. A name outside the shop's own tree is never returned.
 */
async function namesOf(db, e, ids) {
  const wanted = (ids || []).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
  if (!wanted.length || !e) return new Map();
  /* the shop itself, its own people (parent_entity_id), and the firm + people of any party that holds or HELD a books_access_grant on this shop (a revoked grant still names past actions: the audit trail); nobody else's */
  const queryResult = await boundRead(db.query.as ? db.query : db.query.bind(db), e,
    'SELECT i.identity_id, i.display_name FROM identities i WHERE i.identity_id = ANY($2::uuid[]) AND (i.identity_id = $1::uuid OR i.parent_entity_id = $1::uuid OR EXISTS (SELECT 1 FROM books_access_grant g WHERE g.grantor_entity = $1::uuid AND g.grantee_entity IN (i.identity_id, i.parent_entity_id)))', [e, wanted]);
  return new Map(queryResult.rows.map((row) => [String(row.identity_id), row.display_name || null]));
}
async function shopName(db, e) {
  const queryResult = await db.query(`SELECT display_name FROM identities WHERE identity_id = $1`, [e]);
  return (queryResult.rows[0] && queryResult.rows[0].display_name) || null;
}

/**
 * ⭐ BR1 · the rail leg of the bank reconciliation: my copies of the PAYMENT ADVICES (M30, business_json.kind 'payment_advice') and of the bank
 * questions I asked ('bank_query') made in [from − 10 days, to + 10 days] — ONE read for a whole statement, bounded. The engine (bank-recon
 * railPayments / explain) reads them on the device; nothing here computes money. counterparty = the sender on a received copy, else the first
 * recipient that is not me. Drafts and deleted copies are left out.
 */
async function bankRailChits(db, e, from, to, limit) {
  const queryResult = await db.query(
    `SELECT h.chit_id, cs.direction, h.business_json, d.line_items, cs.current_status AS status, h.created_at,
                                   CASE WHEN cs.direction = 'received' THEN h.sender_entity_id::text
                                        ELSE (SELECT x->>'entity_id' FROM jsonb_array_elements(COALESCE(h.all_recipients, '[]'::jsonb)) x WHERE x->>'entity_id' IS DISTINCT FROM $5 LIMIT 1) END AS party_id,
                                   CASE WHEN cs.direction = 'received' THEN h.sender_entity_display_name
                                        ELSE (SELECT x->>'display_name' FROM jsonb_array_elements(COALESCE(h.all_recipients, '[]'::jsonb)) x WHERE x->>'entity_id' IS DISTINCT FROM $5 LIMIT 1) END AS party_name
                              FROM chit_header h
                              JOIN chit_status cs ON cs.chit_id = h.chit_id AND cs.entity_id = h.entity_id AND cs.direction = h.direction
                              LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                             WHERE h.entity_id = $1 AND h.role <> 'Draft' AND cs.deleted_at IS NULL
                               AND h.business_json->>'kind' IN ('payment_advice', 'bank_query')
                               AND h.created_at >= ($2::date - 10) AND h.created_at < ($3::date + 11)
                             ORDER BY h.created_at, h.chit_id LIMIT $4`,
    [e, from, to, limit || 500, String(e)]
  );
  return queryResult.rows;
}

/* ── the waiting list ───────────────────────────────────────────────────────────────────────────────────────── */
/** M-F-05: an open row of this bill already waits → renew what it asks (event, why) and keep its tries and place; true when one was renewed */
async function renewOpenRow(db, e, options) {
  const key = options.source_chit_id ? { column: 'source_chit_id', value: options.source_chit_id } : options.source_ref ? { column: 'source_ref', value: options.source_ref } : null;
  if (!key) return false;
  const renewed = await db.query(`UPDATE books_outbox SET event = $3::jsonb, why = $4 WHERE entity_id = $1 AND ${key.column} = $2 AND done_at IS NULL`, [e, key.value, JSON.stringify(options.event || {}), String(options.why || '').slice(0, 500)]);
  return renewed.rowCount > 0;
}
/**
 * ⭐ WALK M M-F-05 · ONE OPEN ROW PER BILL: the outbox key is the chit (source_chit_id), else the source_ref. A bill that is parked again (the hook, then the sweep, then a retry each park it)
 * renews its open row — what it asks NOW (event) and why — and keeps its tries and its place; only a key with no open row inserts.
 */
async function queue(db, e, options) {
  if (await renewOpenRow(db, e, options)) return;
  await db.query(`INSERT INTO books_outbox (entity_id, source_chit_id, source_ref, event, why) VALUES ($1,$2,$3,$4::jsonb,$5)`, [
    e,
    options.source_chit_id || null,
    options.source_ref || null,
    JSON.stringify(options.event || {}),
    String(options.why || '').slice(0, 500)
  ]);
}
/**
 * ⭐ STD1: WHAT A WAITING ROW ASKS OF THE OWNER is DATA — park() writes `event.todo` ('accept' · 'add_supplier' · 'record') and, for
 * add_supplier, the typed supplier `event.name` (books-hooks). A row parked before that carries neither: THIS fragment is the one place it is
 * classified — read here for every count and list, and written once onto the row by backfillTodo (the retry path). Nothing else, on the server
 * or the client, reads the sentence to decide what a row is.
 */
/** the open waiting rows, ONE per bill (M-F-05: the newest row of a chit, or of a source_ref with no chit) — what waiting() lists and waitingCount() counts, so list and count agree; $1 = entity */
const OPEN_ROWS_SQL = `(SELECT DISTINCT ON (COALESCE(source_chit_id::text, source_ref, id::text)) * FROM books_outbox WHERE entity_id = $1 AND done_at IS NULL
                         ORDER BY COALESCE(source_chit_id::text, source_ref, id::text), id DESC) open_rows`;
const TODO_SQL = `COALESCE(event->>'todo', CASE WHEN event->>'waiting' = 'acceptance' THEN 'accept'
                                               WHEN event->>'waiting' = 'party' AND why LIKE 'Who is %' THEN 'add_supplier' ELSE 'record' END)`;
const NAME_SQL = `CASE WHEN ${TODO_SQL} = 'add_supplier' THEN COALESCE(event->>'name', substring(why from '^Who is (.+)\\? Add them as a supplier')) END`;
/**
 * STD1: the open waiting row of ONE chit, as a SQL scalar (json) over `ent` / `cid` placeholders — what the chit read (routes/chits.js
 * ONE_SHOT) carries as `books_wait`, so the bill's popup greys Accept from the server's answer, not from a list the page may not hold.
 */
const waitOfChitSql = (
  entityRef,
  chitRef
) => `(SELECT json_build_object('todo', ${TODO_SQL}, 'name', ${NAME_SQL}, 'why', why, 'candidates', COALESCE(event->'candidates', '[]'::jsonb), 'short', event->'short', 'wait', event->>'waiting', 'supplier', event->'supplier')
   FROM books_outbox WHERE entity_id = ${entityRef} AND source_chit_id = ${chitRef} AND done_at IS NULL ORDER BY id DESC LIMIT 1)`;
async function waiting(db, e, limit) {
  const queryResult = await db.query(
    `SELECT id, source_chit_id, source_ref, event, why, tries, created_at, ${TODO_SQL} AS todo, ${NAME_SQL} AS name FROM ${OPEN_ROWS_SQL} ORDER BY tries, id LIMIT $2`,
    [e, limit || 100]
  ); /* least-tried first: rows that can never post must not starve a new one (critic F6) */
  return queryResult.rows;
}
/**
 * how many posts are waiting, by what each asks — the same predicate as waiting(), every row (no cap), ONE GROUP BY. The ONE count Home,
 * the Accounts card, Books' To do and /health say (STD1) → { total, accept, add_supplier, record }.
 */
async function waitingCount(db, e) {
  const queryResult = await db.query(`SELECT ${TODO_SQL} AS todo, count(*)::int AS n FROM ${OPEN_ROWS_SQL} GROUP BY 1`, [
    e
  ]);
  const out = { total: 0, accept: 0, add_supplier: 0, record: 0 };
  queryResult.rows.forEach((x) => {
    const bucket = Object.prototype.hasOwnProperty.call(out, x.todo) && x.todo !== 'total' ? x.todo : 'record';
    out[bucket] += Number(x.n) || 0;
    out.total += Number(x.n) || 0;
  });
  return out;
}
/** STD1: a row parked before `todo` existed gets it ONCE, from TODO_SQL (one statement, every such row; the retry path calls it) → rows written */
async function backfillTodo(db, e) {
  const queryResult = await db.query(
    `UPDATE books_outbox SET event = COALESCE(event, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('todo', ${TODO_SQL}, 'name', ${NAME_SQL}))
                             WHERE entity_id = $1 AND done_at IS NULL AND NOT (COALESCE(event, '{}'::jsonb) ? 'todo')`,
    [e]
  );
  return (queryResult && queryResult.rowCount) || 0;
}
/** FX-F10W2: the open Waiting rows of these chits are done — the status change that posted (or refused) them says why; one statement → rows closed */
async function outboxClose(db, e, ids, reason, only) {
  /* `only` { press: 'payment' } closes just the Mark-paid rows (FIN-66): the bill's own wait is not the press's to close */
  const pressOnly = only && only.press ? ` AND event->>'press' = $4` : '';
  const queryResult = await db.query(
    `UPDATE books_outbox SET done_at = now(), why = $3 WHERE entity_id = $1 AND source_chit_id = ANY($2::uuid[]) AND done_at IS NULL${pressOnly}`,
    pressOnly ? [e, ids, String(reason || '').slice(0, 500), only.press] : [e, ids, String(reason || '').slice(0, 500)]
  );
  return (queryResult && queryResult.rowCount) || 0;
}
/** ev (FX-F10W, optional): keys merged into the row's event on a failed try — a retried bill's todo · name · candidates follow it; same statement */
async function outboxDone(db, e, id, ok, reason, event) {
  if (!ok && event && typeof event === 'object')
    return db
      .query(`UPDATE books_outbox SET tries = tries + 1, why = $3, event = COALESCE(event, '{}'::jsonb) || $4::jsonb WHERE entity_id = $1 AND id = $2`, [
        e,
        id,
        String(reason || '').slice(0, 500),
        JSON.stringify(event)
      ])
      .then(() => undefined);
  await db.query(
    ok
      ? `UPDATE books_outbox SET done_at = now(), tries = tries + 1 WHERE entity_id = $1 AND (id = $2 OR (done_at IS NULL AND source_chit_id = (SELECT source_chit_id FROM books_outbox WHERE entity_id = $1 AND id = $2)))` /* M-F-05: rows parked twice before queue() renewed one close together */
      : `UPDATE books_outbox SET tries = tries + 1, why = $3 WHERE entity_id = $1 AND id = $2`,
    ok ? [e, id] : [e, id, String(reason || '').slice(0, 500)]
  );
}

/* ── the change log (append-only) ───────────────────────────────────────────────────────────────────────────── */
async function logChange(db, e, change) {
  const grantId = require('./reqctx').actingGrantId(); /* ACC-176b: a change made under an adviser grant names that grant (b866) */
  const note = (value) => (value == null ? null : String(value));
  await db.query(`INSERT INTO books_change_log (entity_id, by, table_name, row_id, field, old, new${grantId ? ', grant_id' : ''}) VALUES ($1,$2,$3,$4,$5,$6,$7${grantId ? ',$8' : ''})`, [e, change.by || null, change.table_name, note(change.row_id), change.field || null, note(change.old), note(change.new), ...(grantId ? [grantId] : [])]);
}
/** ACC-240: the lock / unlock trail of a year's months — the rows setPeriod wrote to books_change_log (table fiscal_period, field status, row_id '<fy>/<period>'), oldest first */
async function lockTrail(db, e, fiscalYear) {
  const queryResult = await db.query(
    `SELECT l.at, l.by, i.display_name AS by_name, l.row_id, l.old, l.new FROM books_change_log l
                             LEFT JOIN identities i ON i.identity_id = l.by   /* the name beside the id, as the day book does */
                             WHERE l.entity_id = $1 AND l.table_name = 'fiscal_period' AND l.field = 'status' AND ($2::text IS NULL OR l.row_id LIKE $2 || '/%') ORDER BY l.at, l.id`,
    [e, fiscalYear ? String(fiscalYear).replace(/[\\%_]/g, (char) => '\\' + char) : null]
  );
  return queryResult.rows;
}
/** ACC-380: the year's latest close or reopen in the change log → { field: 'year_closed' | 'year_reopened', old, new } | null (a read; nothing recomputed) */
async function yearLastEvent(db, e, fiscalYear) {
  const queryResult = await db.query(`SELECT field, old, new FROM books_change_log WHERE entity_id = $1 AND table_name = 'fiscal_period' AND row_id = $2 AND field IN ('year_closed', 'year_reopened') ORDER BY at DESC, id DESC LIMIT 1`, [e, String(fiscalYear)]);
  return queryResult.rows[0] || null;
}
/** YE-F-06: who closed the year and when — the year's latest `year_closed` line of the change log (a read) → { at, by, by_name } | null */
async function yearCloseEvent(db, e, fiscalYear) {
  const queryResult = await db.query(`SELECT l.at, l.by, i.display_name AS by_name FROM books_change_log l LEFT JOIN identities i ON i.identity_id = l.by WHERE l.entity_id = $1 AND l.table_name = 'fiscal_period' AND l.row_id = $2 AND l.field = 'year_closed' ORDER BY l.at DESC, l.id DESC LIMIT 1`, [e, String(fiscalYear)]);
  return queryResult.rows[0] || null;
}
async function changes(db, e, from, to) {
  const queryResult = await db.query(
    `SELECT at, by, table_name, row_id, field, old, new FROM books_change_log
                             WHERE entity_id = $1 AND at >= $2::date AND at < ($3::date + 1) ORDER BY at, id`,
    [e, from, to]
  );
  return queryResult.rows;
}


/**
 * AC-F-02 (walk AC 1129): the entries a locked month moved to the first open day, with the sentence they carry (lib/books-lock-note.movedWords) — a posted entry that
 * says "Dated 28 Nov; November is locked, so it is in the books on 1 Dec" in its own narration. → [{ entry_no, doc_date, posting_date, party_id, words }], newest first;
 * a store that cannot be read answers [] (the entry still says it itself).
 */
async function movedByLock(db, e) {
  try {
    const queryResult = await db.query(
      `SELECT x.entry_no, to_char(x.doc_date,'YYYY-MM-DD') AS doc_date, to_char(x.posting_date,'YYYY-MM-DD') AS posting_date, x.narration,
              (SELECT l.party_id FROM journal_line l WHERE l.entity_id = x.entity_id AND l.entry_id = x.entry_id AND l.party_id IS NOT NULL ORDER BY l.line_no LIMIT 1) AS party_id
         FROM journal_entry x WHERE x.entity_id = $1 AND x.doc_date IS NOT NULL AND x.doc_date <> x.posting_date AND x.reverses_entry_id IS NULL
          AND x.narration LIKE '%is locked, so it is in the books on%' ORDER BY x.posting_date DESC, x.entry_no DESC LIMIT 200`,
      [e]
    );
    return queryResult.rows.map((x) => ({ entry_no: x.entry_no, doc_date: x.doc_date, posting_date: x.posting_date, party_id: x.party_id || null, words: require('./books-lock-note').movedWords(x.doc_date, x.posting_date) })).filter((x) => x.words);
  } catch (err) {
    require('./logger').fellBack('books store: the entries moved by a lock could not be read, so none are listed', err, 'debug');
    return [];
  }
}
/** the bill numbers of some chits (a proposal shows the number on the customer's paper, not an id); a paper bill received at the door is
 *  known by the SUPPLIER's number (their_bill.no, folder-inventory.theirNoSql — R123: the pay sheet showed its chit id) */
async function billNos(db, e, ids) {
  const validIds = (ids || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!validIds.length) return {};
  const queryResult = await db.query(
    `SELECT h.chit_id, COALESCE(h.business_json->>'printed_as', h.business_json->>'bill_no', NULLIF(${require('./folder-inventory').theirNoSql('h')}, '')) AS no
       FROM chit_header h WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`,
    [e, validIds]
  );
  const numbers = {};
  queryResult.rows.forEach((x) => {
    numbers[x.chit_id] = x.no;
  });
  return numbers;
}

/* ── the chits the hooks read (a day's walk-in bills) ────────────────────────────────────────────────────────── */
/**
 * a counter's bills whose POSTED moment (tax-copy POSTED_AT_SQL = books-hooks postingMoment: billed_at bounded by BILLED_AT_FUTURE_SLACK_HOURS) falls in [fromTs, toTs), with lines — the day summary's input.
 * ⚠️ ONLY BILLS I SENT (sender = me): a counter bill another shop billed ME carries ITS counter's id, which can equal one of
 * mine ('C2') — it is my purchase, never my walk-in sale (classify refuses it too; this keeps it out of the read).
 * ⚠️ NOT A CANCELLED ONE (H3): a bill withdrawn before the day closed would otherwise be summed into the walk-in day.
 */
async function counterBills(db, e, counter, fromTs, toTs) {
  const queryResult = await db.query(
    `SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json, h.summary_json, h.purpose, h.auto_subject, h.manual_subject,
                                   h.sent_at, h.created_at, d.line_items, d.currency_code
                              FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                             WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('order', 'offer', 'subscription')
                               AND h.business_json ? 'bill_no' AND h.business_json -> 'till' ->> 'id' = $2
                               AND ${require('./tax-copy').POSTED_AT_SQL} >= $3::timestamptz
                               AND ${require('./tax-copy').POSTED_AT_SQL} <  $4::timestamptz
                               /* H3 (PAY-FIX): a bill cancelled before the day posts is not a sale of that day */
                               ${require('./counter-bill').NOT_WITHDRAWN_SQL}
                             ORDER BY h.created_at`,
    [e, counter, fromTs, toTs]
  );
  return queryResult.rows;
}
/**
 * ⭐ the chits of [fromTs, toTs) that SHOULD have reached the ledger and did not (SPEC-books-v2 §6 "every chit of the day
 * posted"; critic M6): of a posting purpose, not a draft, with no entry of their own (chit: · bill: · walkin-late:), in no
 * walk-in day's list, no payment recorded from them, and not already on the waiting list. Oldest first, bounded.
 * ⚠️ created_at, not billed_at: the question is "did its hook run", and a free-text billed_at must not break the check (F8).
 */
async function unpostedChits(db, e, fromTs, toTs, limit) {
  const found = await unpostedInWindow(db, e, fromTs, toTs, limit);
  /* ACC-223 / 238: and the cancelled copies whose posting is still unreversed — postChit's refused branch reverses each (the sweep's one door) */
  return found.length >= (limit || 200) ? found : found.concat(await cancelledStillPosted(db, e, (limit || 200) - found.length));
}
/**
 * the chits of [fromTs, toTs) with no entry of their own that are still live (the window half of unpostedChits).
 * ⭐ ACC-266: `opt` widens it for the 30-second reconciler (lib/books-reconcile) — the nightly passes none and reads exactly what it always read.
 *   opt.skipWalkin — the shop's grain is not 'bill': leave out the OPEN-DAY walk-ins (C1), which classify answers "waiting for the day close" with no
 *                    row and no entry, so a cap of 50 would be spent re-reading them for ever and never reach a lost party bill behind them;
 *   opt.skipIds    — chits the caller already had an answer for today (a `none`, a `waiting`), so they are read once, not every pass.
 * unpostedCount (below) is the SAME predicate, so what /health counts and what the pass repairs can never disagree.
 */
async function unpostedInWindow(db, e, fromTs, toTs, limit, opt) {
  const filter = opt || {};
  const queryResult = await db.query(`SELECT h.chit_id ${UNPOSTED_FROM} ORDER BY h.created_at LIMIT $6`, [e, fromTs, toTs, !!filter.skipWalkin, skipIdsOf(filter), limit || 200]);
  return queryResult.rows;
}
/** { count, oldest } of the SAME chits unpostedInWindow would return (no limit) — what /health and the shop's own number say (ACC-266) */
async function unpostedCount(db, e, fromTs, toTs, opt) {
  const filter = opt || {};
  const queryResult = await db.query(`SELECT count(*)::int AS count, min(h.created_at) AS oldest ${UNPOSTED_FROM}`, [e, fromTs, toTs, !!filter.skipWalkin, skipIdsOf(filter)]);
  const row = queryResult.rows[0] || {};
  return { count: row.count || 0, oldest: row.oldest || null };
}
const skipIdsOf = (filter) => (filter.skipIds || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
/**
 * $1 entity · $2 from · $3 to · $4 skipWalkin · $5 skipIds (uuid[]).
 * ⚠️⚠️ THE WALK-IN CLAUSE mirrors books-hooks ownCounterBillVerdict, term for term: my own counter bill (sender = me, an order/offer/subscription with a
 *   bill_no), with no party (partyFromCustomer: party_id · identity_id · entity_id), no GSTIN, no credit tender and only tenders modeOf knows — the bill
 *   walkinGrain() sends to the day close at day/shift grain. Anything that clause does not prove (a zero-amount part is read as a part: the safe side)
 *   stays in the list. The nightly (no skipWalkin) still reads every one of them once its day has closed.
 *   The words of modeOf, in SQL: \y is the word edge (\b is a backspace in a Postgres regex).
 */
const TENDER_FOUR = '(card|visa|master|rupay|amex|pos\\y|upi|gpay|google ?pay|phone ?pe|paytm|bhim|\\yqr\\y|cheque|check|bank|neft|rtgs|imps|transfer)';
const TENDER_CREDIT = '(credit|udhaar|udhar|due|on account|later|khata)';
/* a part is a tender modeOf knows and that is not credit: card · upi · cheque · bank (these win first), else cash that is not also a credit word */
const TENDER_OK = `(lower(btrim(COALESCE(pt ->> 'how', ''))) ~ '${TENDER_FOUR}' OR (lower(btrim(COALESCE(pt ->> 'how', ''))) !~ '${TENDER_CREDIT}' AND lower(btrim(COALESCE(pt ->> 'how', ''))) ~ 'cash'))`;
/* FIN-58: a UPI part with confirmed = false is not a walk-in's money — classify posts that bill as a sale_bill to "UPI waiting", so it is NOT a bill that waits for the day close */
const WAITING_PART = `((pt ->> 'confirmed') = 'false' AND lower(COALESCE(pt ->> 'how', '')) ~ '(upi|gpay|google ?pay|phone ?pe|paytm|bhim|\\yqr\\y)')`;
const UNPOSTED_FROM = `FROM chit_header h
                             WHERE h.entity_id = $1 AND h.role <> 'Draft' AND h.created_at >= $2::timestamptz AND h.created_at < $3::timestamptz
                               AND (h.purpose IN ('invoice', 'credit_note', 'debit_note', 'expense', 'income')
                                    OR (h.purpose IN ('order', 'offer', 'subscription') AND h.business_json ? 'bill_no')
                                    OR (h.purpose = 'general' AND h.business_json ->> 'kind' = 'payment_received'))
                               AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $1
                                                  AND j.source_ref IN ('chit:' || h.chit_id::text, 'bill:' || h.chit_id::text, 'walkin-late:' || h.chit_id::text))
                               AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $1 AND j.source_chit_ids @> ARRAY[h.chit_id])
                               AND NOT EXISTS (SELECT 1 FROM books_payment p WHERE p.entity_id = $1 AND p.client_ref = 'chit:' || h.chit_id::text)
                               AND NOT EXISTS (SELECT 1 FROM books_outbox o WHERE o.entity_id = $1 AND o.done_at IS NULL AND o.source_chit_id = h.chit_id)
                               /* ACC-223: a cancelled / rejected copy is not fed to the sweep (the gate in classify is the guarantee; this only stops the reading) */
                               ${require('./counter-bill').NOT_WITHDRAWN_SQL}
                               AND h.chit_id <> ALL ($5::uuid[])
                               /* ACC-266 C1: an open-day walk-in waits for its day close — it is not "lost" (only when the caller asks, and only the shape classify waits) */
                               AND NOT ($4::boolean AND h.sender_entity_id = h.entity_id AND h.purpose IN ('order', 'offer', 'subscription') AND h.business_json ? 'bill_no'
                                    AND COALESCE(NULLIF(h.business_json #>> '{customer,party_id}', ''), NULLIF(h.business_json #>> '{customer,identity_id}', ''), NULLIF(h.business_json #>> '{customer,entity_id}', '')) IS NULL
                                    AND COALESCE(h.business_json #>> '{customer,gstin}', '') = ''
                                    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.business_json #> '{payment,parts}') = 'array' THEN h.business_json #> '{payment,parts}' ELSE '[]'::jsonb END) pt
                                                     WHERE NOT ${TENDER_OK} OR ${WAITING_PART}))`;

/**
 * ACC-223 / 238 · the chits whose copy is cancelled / rejected and whose posting nothing has reversed (a reversal the books refused, or a crash between the status write and the books):
 * unpostedChits adds them, the nightly sweep hands each to postChit, whose refused branch reverses it through the one reversal. The same test as unreversedForChit. Bounded, oldest first.
 */
async function cancelledStillPosted(db, e, limit) {
  const found = await db.query(
    `SELECT h.chit_id FROM chit_header h
      WHERE h.entity_id = $1
        AND EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = h.chit_id AND cs.entity_id = h.entity_id AND cs.current_status IN ('cancelled', 'rejected'))
        AND EXISTS (SELECT 1 FROM journal_entry x WHERE x.entity_id = $1 AND x.source_ref LIKE 'chit:' || h.chit_id::text || '%' AND x.reverses_entry_id IS NULL
                      AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id))
      ORDER BY h.created_at LIMIT $2`,
    [e, limit || 200]
  );
  return found.rows;
}
/**
 * the open disputes on a chit, as MY copy of chit_disputes shows them (per-copy since b68, entity_id + RLS) — a bill I
 * received waits while one is open (lib/books-hooks buyerGate). A failed read throws: the hook parks the bill with the
 * error, named — never read as "no dispute".
 */
async function openDisputes(db, e, chit_id) {
  const queryResult = await db.query(`SELECT COUNT(*)::int AS n FROM chit_disputes WHERE entity_id = $1 AND chit_id = $2 AND status = 'open'`, [e, chit_id]);
  return (queryResult.rows[0] && queryResult.rows[0].n) || 0;
}
/** the counters that billed in [fromTs, toTs) — the nightly catch-up for a day nobody closed */
async function countersBilling(db, e, fromTs, toTs) {
  const queryResult = await db.query(
    `SELECT DISTINCT h.business_json -> 'till' ->> 'id' AS till FROM chit_header h
                             WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('order', 'offer', 'subscription') AND h.business_json ? 'bill_no'
                               AND h.business_json -> 'till' ->> 'id' IS NOT NULL
                               AND ${require('./tax-copy').POSTED_AT_SQL} >= $2::timestamptz
                               AND ${require('./tax-copy').POSTED_AT_SQL} <  $3::timestamptz`,
    [e, fromTs, toTs]
  );
  return queryResult.rows.map((x) => x.till).filter(Boolean);
}

/* ── PR1 · THE PARALLEL-RUN SNAPSHOTS (b309 books_compare_part): their period as read from a Tally / Xero / QBO export — the shop's own paper, never posted.
   Insert-only (no UPDATE grant): a part once kept is what was compared; a fresh file is a fresh snapshot. Before b309 runs: compareReady() is false and the
   routes say so in words. One row per snapshot PART (tb · pl · bs · ret); the snapshot is the rows sharing a snapshot_id. ── */
const compareReady = () => require('./schema').hasTable('books_compare_part');
const COMPARE_HEAD = `snapshot_id, label, source, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, currency`;
/** the shop's snapshots, newest first: { snapshot_id, label, source, period_from, period_to, currency, parts: ['tb', …], lines, created_at } */
async function compareSnapshots(db, e) {
  const queryResult = await db.query(
    `SELECT snapshot_id, min(label) AS label, min(source) AS source, to_char(min(period_from), 'YYYY-MM-DD') AS period_from, to_char(max(period_to), 'YYYY-MM-DD') AS period_to,
                                   min(currency) AS currency, array_agg(part ORDER BY part) AS parts, sum(jsonb_array_length(rows))::int AS lines, min(created_at) AS created_at
                              FROM books_compare_part WHERE entity_id = $1 GROUP BY snapshot_id ORDER BY min(created_at) DESC LIMIT 100`,
    [e]
  );
  return queryResult.rows;
}
/** one snapshot's parts, each with its rows as read */
async function compareParts(db, e, snapshotId) {
  const queryResult = await db.query(
    `SELECT part, ${COMPARE_HEAD}, file_name, rows, created_by, created_at FROM books_compare_part WHERE entity_id = $1 AND snapshot_id = $2 ORDER BY part`,
    [e, snapshotId]
  );
  return queryResult.rows;
}
/** keep one part; null when the snapshot already has that part (insert-only — never replaced) */
async function insertComparePart(db, e, part) {
  const queryResult = await db.query(
    `INSERT INTO books_compare_part (entity_id, snapshot_id, label, source, part, period_from, period_to, currency, file_name, rows, created_by)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) ON CONFLICT (entity_id, snapshot_id, part) DO NOTHING RETURNING part_id`,
    [
      e,
      part.snapshot_id,
      part.label,
      part.source,
      part.part,
      part.period_from || null,
      part.period_to,
      part.currency,
      part.file_name || null,
      JSON.stringify(part.rows || []),
      part.by || null
    ]
  );
  return queryResult.rows[0] ? queryResult.rows[0].part_id : null;
}

/** the entries the Day book calls a bill (routes/books.js KIND 'bill') — Home's Till card counts the same ones */
const BILL_EVENTS = ['sale_bill', 'credit_given'];
/* ═══ CS2 · RE-CHART A NEVER-POSTED LEDGER IN PLACE (the country corrected on the setup step before any product or transaction) ═══
 * ⚠️ cb_app has NO DELETE on ledger_account / fiscal_period (b272, critic F16; tests/books-writer holds it) — so the chart is not dropped and re-inserted, it is
 *    RE-LAID: every row parked (role freed, active false), the new pack laid over the codes that exist (the same 4-digit numbering across packs, so most rows
 *    are a rename: 2200 Output CGST → GST collected), the codes the new pack lacks stay parked, the codes it adds are inserted by enable() as the switch inserts them.
 *    Only lib/books.reseedUnposted calls these, after proving no journal_entry exists; balances, items and the counters are untouched (empty; a party number is never reused).
 *    Three statements, set-based (unnest) — never one per row. */
async function parkChart(db, e) {
  await db.query(`UPDATE ledger_account SET role = NULL, active = false WHERE entity_id = $1`, [e]);
}
/** rows: books-engines.chartRows of the NEW pack, each with `parent_code` (the parent group's code) — laid over the rows whose code exists; the parent is looked up by code */
async function rechart(db, e, rows, packInfo) {
  const list = rows || [],
    col = (field) => list.map((x) => (x[field] == null ? null : x[field]));
  await db.query(
    `UPDATE ledger_account a SET name = v.name, is_group = v.is_group, nature = v.nature, role = v.role, tally_group = v.tally_group, sch3_line = v.sch3_line,
                    saft_grouping = v.saft_grouping, pack_code = $2, pack_version = $3, active = true,
                    parent_id = (SELECT p.account_id FROM ledger_account p WHERE p.entity_id = $1 AND p.code = v.parent_code)
                  FROM unnest($4::text[], $5::text[], $6::boolean[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[])
                    AS v(code, name, is_group, nature, role, parent_code, tally_group, sch3_line, saft_grouping)
                  WHERE a.entity_id = $1 AND a.code = v.code`,
    [
      e,
      (packInfo && packInfo.pack_code) || null,
      (packInfo && packInfo.pack_version) || null,
      col('code'),
      col('name'),
      list.map((x) => !!x.is_group),
      col('nature'),
      col('role'),
      col('parent_code'),
      col('tally_group'),
      col('sch3_line'),
      col('saft_grouping')
    ]
  );
}
/** the one year's rows re-labelled by PERIOD NUMBER (0 = brought forward, 1–12): '2026-27' Jul–Jun → '2026' Jan–Dec — rows: [{ period, fiscal_year, start_date, end_date }] */
async function relabelPeriods(db, e, fromFy, rows) {
  const list = rows || [];
  await db.query(
    `UPDATE fiscal_period f SET fiscal_year = v.fiscal_year, start_date = v.start_date::date, end_date = v.end_date::date
                  FROM unnest($3::int[], $4::text[], $5::text[], $6::text[]) AS v(period, fiscal_year, start_date, end_date)
                  WHERE f.entity_id = $1 AND f.fiscal_year = $2 AND f.period = v.period`,
    [e, fromFy, list.map((x) => Number(x.period)), list.map((x) => x.fiscal_year), list.map((x) => x.start_date), list.map((x) => x.end_date)]
  );
}

/* ── F5 A1 · the bills the books hold whose lines carry NO rate (books-todo bills_unrated) ──────────────────────────────────────────────── */
/** the shop's tax registration facts for tax-shelf.chargesTax: { gstin, country, reg_type } (reg_type unstated → null, read as regular there) */
async function taxRegistration(db, e) {
  const result = await db.query(`SELECT gstn, country, policy_flags->>'gst_registration' AS reg_type FROM identities WHERE identity_id = $1`, [e]);
  const row = result.rows[0] || {};
  return { gstin: row.gstn || null, country: row.country || null, reg_type: row.reg_type || null };
}
/* ACC-203: how many unrated line names a row carries (a row says which items, not the whole bill) */
const NAMED_LINES = 5;
/**
 * unratedSaleBills(db, e, from, to, limit) → the sale bills IN THE BOOKS (an unreversed sale_bill, or a walk-in day entry's bills — the HOME,
 * never a second posting rule) posted in [from, to], whose chit carries a line with no rate (gst_rate and rate both null: "nobody said";
 * a real 0 is a rate). Newest first, bounded. Read only — the bills stay as issued (Athi, 24 Oct: the shop's CA decides).
 * ⚠️ ACC-203 (lifecycle B3 S5-10): the shop's ONE header row per chit, whichever direction — a self chit keeps the copy its self-copy policy
 * names (routes/chits.js: 'received' by default, 'sent', or both; PK chit_id, entity_id, direction), so a join on direction = 'sent' listed
 * nothing on a real shop. Same LATERAL as entryLines' covers read; chit_detail is written per direction, so the detail follows the header's.
 * → [{ chit_id, entry_no, posting_date, printed_as, bill_no, billed_at, unrated, lines, items: [the unrated lines' names, at most 5] }]
 */
async function unratedSaleBills(db, e, from, to, limit) {
  const NO_RATE = `SELECT 1 FROM jsonb_array_elements(COALESCE(d.line_items, '[]'::jsonb)) l WHERE l->>'gst_rate' IS NULL AND l->>'rate' IS NULL`;
  const result = await db.query(
    `WITH homed AS (
       SELECT c.chit_id, max(je.entry_no) AS entry_no, max(je.posting_date) AS posting_date
         FROM journal_entry je
         CROSS JOIN LATERAL unnest(CASE WHEN je.source_chit_id IS NOT NULL THEN ARRAY[je.source_chit_id] ELSE COALESCE(je.source_chit_ids, '{}') END) AS c(chit_id)
        WHERE je.entity_id = $1 AND je.event_type IN ('sale_bill', 'walkin_day') AND je.reverses_entry_id IS NULL
          AND je.posting_date >= $2::date AND je.posting_date <= $3::date
          AND NOT EXISTS (SELECT 1 FROM journal_entry rv WHERE rv.entity_id = je.entity_id AND rv.reverses_entry_id = je.entry_id)
        GROUP BY c.chit_id)
     SELECT h.chit_id, h.entry_no, h.posting_date, hd.business_json->>'printed_as' AS printed_as, hd.business_json->>'bill_no' AS bill_no,
            hd.business_json->>'billed_at' AS billed_at,
            (SELECT count(*) FROM jsonb_array_elements(COALESCE(d.line_items, '[]'::jsonb)) l WHERE l->>'gst_rate' IS NULL AND l->>'rate' IS NULL) AS unrated,
            (SELECT jsonb_agg(COALESCE(l->>'name', l->>'particulars')) FROM jsonb_array_elements(COALESCE(d.line_items, '[]'::jsonb)) l WHERE l->>'gst_rate' IS NULL AND l->>'rate' IS NULL) AS unrated_names,
            jsonb_array_length(COALESCE(d.line_items, '[]'::jsonb)) AS lines
       FROM homed h
       JOIN LATERAL (SELECT x.chit_id, x.entity_id, x.direction, x.business_json FROM chit_header x
                      WHERE x.entity_id = $1 AND x.chit_id = h.chit_id ORDER BY x.direction LIMIT 1) hd ON true
       LEFT JOIN chit_detail d ON d.chit_id = hd.chit_id AND d.entity_id = hd.entity_id AND d.direction = hd.direction
      WHERE EXISTS (${NO_RATE})
      ORDER BY h.posting_date DESC, h.entry_no DESC LIMIT $4`,
    [e, from, to, limit || 50]
  );
  /* ACC-203: the mapper named a `ymd` this module never defined; it never ran because the join above returned no row (the twin maps for itself) */
  const ymdOf = require('./books-engines').ymd;
  /* items: the unrated lines BY NAME (the till writes `particulars`, older bills `name`), at most NAMED_LINES — the row says which item has no rate */
  const namesOf = (names) => (Array.isArray(names) ? names.filter(Boolean).map(String).slice(0, NAMED_LINES) : []);
  return result.rows.map((x) =>
    Object.assign({}, x, {
      posting_date: ymdOf(x.posting_date),
      unrated: Number(x.unrated),
      lines: Number(x.lines),
      items: namesOf(x.unrated_names),
      unrated_names: undefined
    })
  );
}

/**
 * ACC-206 B · the sales the owner let through although the engine's money did not add up, NOT YET RESOLVED (the books to-do row money_unbalanced).
 * A FILTER on stored data — business_json.money_override present, no resolution row in books_change_log (table 'money_override', field 'resolved', row_id the chit) — no arithmetic.
 * → [{ chit_id, ref, by, at, why, step, unexplained_minor, words }], newest first. Bounded to the last 400 days and `limit` rows (no index on the key: a bounded scan).
 */
async function moneyOverrides(db, e, limit) {
  const result = await db.query(
    `SELECT DISTINCT ON (h.chit_id) h.chit_id, h.created_at, h.business_json->'money_override' AS override, h.business_json->>'bill_no' AS bill_no, h.business_json->>'printed_as' AS printed_as,
            h.summary_json->'money'->'bridge'->>'words' AS words
       FROM chit_header h
      WHERE h.entity_id = $1 AND h.business_json ? 'money_override' AND h.created_at > now() - interval '400 days'
        AND NOT EXISTS (SELECT 1 FROM books_change_log l WHERE l.entity_id = h.entity_id AND l.table_name = 'money_override' AND l.field = 'resolved' AND l.row_id = h.chit_id::text)
      ORDER BY h.chit_id, h.created_at DESC LIMIT $2`,
    [e, limit || 50]
  );
  return result.rows
    .map((row) => ({
      chit_id: row.chit_id,
      ref: row.printed_as || row.bill_no || null,
      by: row.override.by || null,
      at: row.override.at || null,
      why: row.override.why || null,
      step: row.override.step || null,
      unexplained_minor: row.override.unexplained_minor,
      words: row.words || null,
      created_at: row.created_at
    }))
    .sort((first, second) => (String(first.created_at) < String(second.created_at) ? 1 : -1));
}
/** ACC-206 B · does this entity hold an overridden chit, and has it been resolved? → { held: bool, resolved: bool } (one read) */
async function moneyOverrideState(db, e, chit_id) {
  const result = await db.query(
    `SELECT EXISTS (SELECT 1 FROM chit_header h WHERE h.entity_id = $1 AND h.chit_id = $2 AND h.business_json ? 'money_override') AS held,
            EXISTS (SELECT 1 FROM books_change_log l WHERE l.entity_id = $1 AND l.table_name = 'money_override' AND l.field = 'resolved' AND l.row_id = $2::text) AS resolved`,
    [e, chit_id]
  );
  return result.rows[0];
}

/** does this shop hold a chit with this id (the credit note / corrected bill that answers an overridden sale) */
async function chitExists(db, e, chit_id) {
  const result = await db.query('SELECT 1 FROM chit_header WHERE entity_id = $1 AND chit_id = $2', [e, chit_id]);
  return result.rows.length > 0;
}

module.exports = {
  hasEntries,
  chitExists,
  freeRetiredRoles,
  moneyOverrides,
  moneyOverrideState,
  soldByDay,
  soldEntriesSql,
  soldTotals,
  YOY_STATEMENT,
  soldFrom,
  yearCloseEvent,
  taxRegistration,
  unratedSaleBills,
  unreversedForChit,
  inputTaxOfChits,
  receiptBillsAgainst,
  cancelledStillPosted,
  BILL_EVENTS,
  ZERO,
  lockParty, hasTrading, lockSourceRef,
  lockTaxHeads,
  lockOpening,
  setting,
  SETTING_SQL,
  saveSetting,
  lowerStart,
  saveCheck,
  accounts,
  insertAccount,
  parkChart,
  rechart,
  relabelPeriods,
  setSourceCode,
  periods,
  periodFigures,
  yearStamps,
  carryRead,
  carryWrite,
  insertPeriod,
  setPeriodStatus,
  lockTrail,
  nextNo,
  giveBackNo,
  entryBySource,
  entriesBySourceBase,
  entryDebitsByRole,
  taxColumnsReady,
  taxPaymentsNaming,
  taxPaymentsWithoutPeriod,
  taxCloseOf,
  chitPosted,
  postedSources,
  markedRows,
  entry,
  entryLines,
  entryPage,
  entries,
  taxEntryLines,
  taxedIncomeLines,
  taxedOnlyLines,
  zeroRateSales,
  zeroRateKindless,
  pageSums,
  PAGE_MAX,
  PAGE_DEFAULT,
  yearRows,
  ledgerLines,
  years,
  insertEntry,
  insertLines,
  fxLinesReady,
  foreignBalances,
  fxRatesReady,
  fxRates,
  insertFxRates,
  fxRateOn,
  addBalances,
  insertItems,
  periodSums,
  lineSums,
  firstYear,
  balanceDrift,
  unbalancedEntries,
  items,
  openItems,
  itemOwners,
  billParties,
  itemTotals,
  accountNet,
  hasPostings,
  lockLoan,
  loanRefSql,
  loanEntriesWithRepayments,
  LOAN_HAS_INSTALMENTS_WORDS,
  loanOutstanding,
  loanBalances,
  taxClosesOf,
  insertPayment,
  paymentByRef,
  paymentsOfChit,
  paymentsSince,
  cheques,
  payment,
  queue,
  waiting,
  waitingCount,
  outboxDone,
  outboxClose,
  logChange,
  yearLastEvent,
  changes,
  TODO_SQL,
  NAME_SQL,
  waitOfChitSql,
  backfillTodo,
  adviceReady,
  paymentsAdvice,
  setAdvice,
  adviceStates,
  paymentsNeedingAdvice,
  shopName,
  openingDays,
  namesOf,
  bankRailChits,
  billNos,
  movedByLock,
  ...require("./books-store-parties"),
  ...require("./books-store-packs"), ...require("./books-store-gstclass"),
  counterBills,
  countersBilling,
  unpostedChits,
  unpostedInWindow,
  unpostedCount,
  openDisputes,
  compareReady,
  compareSnapshots,
  compareParts,
  insertComparePart
};
