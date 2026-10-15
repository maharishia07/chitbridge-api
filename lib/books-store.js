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
const n = (v) => (v == null ? 0 : Number(v));

/* ── the switch ─────────────────────────────────────────────────────────────────────────────────────────────── */
async function setting(db, e) {
  /* ⭐ the shop's ZONE rides on the setting (identities.timezone, b176) — the one input of books-hooks.dayOf / dayBounds (M210); same trip */
  const r = await db.query(`SELECT s.entity_id, s.enabled, s.walkin_grain, s.fy_start_month, s.functional_currency, s.country, s.pack_version,
                                   s.enabled_at, s.last_check, i.timezone
                              FROM books_setting s LEFT JOIN identities i ON i.identity_id = s.entity_id WHERE s.entity_id = $1`, [e]);
  return r.rows[0] || null;
}
async function saveSetting(db, e, s) {
  /* STD2 (GOV-AU1 for MONEY): a ledger's money and year are STATED (Country setup / the pack) — never INR or April by default; unstated is refused in
     the ONE sentence (country-setup.MONEY_UNSTATED, code NO_MONEY), the NO_COUNTRY pattern. books_setting's columns are NOT NULL. */
  if (!s.fy_start_month || !s.functional_currency) {
    const CS = require('./country-setup'), x = new Error(CS.MONEY_UNSTATED); x.code = 'NO_MONEY'; x.refused = true; throw x;
  }
  await db.query(`INSERT INTO books_setting (entity_id, enabled, walkin_grain, fy_start_month, functional_currency, country, pack_version, enabled_at, enabled_by, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $2 THEN COALESCE($9::timestamptz, now()) END, $8, now())
                  ON CONFLICT (entity_id) DO UPDATE SET enabled = EXCLUDED.enabled, walkin_grain = EXCLUDED.walkin_grain,
                    fy_start_month = EXCLUDED.fy_start_month, functional_currency = EXCLUDED.functional_currency,
                    country = EXCLUDED.country, pack_version = COALESCE(EXCLUDED.pack_version, books_setting.pack_version),
                    enabled_at = COALESCE(books_setting.enabled_at, EXCLUDED.enabled_at),
                    enabled_by = COALESCE(books_setting.enabled_by, EXCLUDED.enabled_by), updated_at = now()`,
  [e, !!s.enabled, s.walkin_grain || 'day', s.fy_start_month, s.functional_currency, s.country, s.pack_version || null, s.by || null,
   s.at || null]);   /* WX-O2C: `at` = the shop clock's moment when it is simulated (books.enable) — the year and its first day come from ONE clock */
}
async function saveCheck(db, e, result) {
  await db.query(`UPDATE books_setting SET last_check = $2::jsonb WHERE entity_id = $1`, [e, JSON.stringify(result)]);
}

/* ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────── */
/** ⭐ IM1: `source_code` (b302 — the code a ledger had in Xero / QuickBooks) rides on the row once the column exists; before b302 the read is the same as it was (schema.hasColumn, cached) */
const sourceCodeReady = () => require('./schema').hasColumn('ledger_account', 'source_code');
async function accounts(db, e) {
  const sc = await sourceCodeReady();
  const r = await db.query(`SELECT account_id, code, name, parent_id, is_group, nature, role, tally_group, sch3_line, saft_grouping, currency, active${sc ? ', source_code' : ''}
                              FROM ledger_account WHERE entity_id = $1 ORDER BY code`, [e]);
  return r.rows;
}
async function insertAccount(db, e, a) {
  const sc = a.source_code != null && String(a.source_code).trim() !== '' && (await sourceCodeReady());
  const r = await db.query(`INSERT INTO ledger_account (entity_id, code, name, parent_id, is_group, nature, role, pack_code, pack_version,
                                                        tally_group, sch3_line, saft_grouping, currency, created_by${sc ? ', source_code' : ''})
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14${sc ? ',$15' : ''})
                            ON CONFLICT (entity_id, code) DO NOTHING RETURNING account_id`,
  [e, a.code, a.name, a.parent_id || null, !!a.is_group, a.nature, a.role || null, a.pack_code || null, a.pack_version || null,
    a.tally_group || null, a.sch3_line || null, a.saft_grouping || null, a.currency || null, a.by || null].concat(sc ? [String(a.source_code).trim().slice(0, 20)] : []));
  return r.rows[0] ? r.rows[0].account_id : null;
}
/** IM1: keep THEIR code on a ledger that already exists (a merge in the move-in) — false before b302 (nothing written, said by the caller) */
async function setSourceCode(db, e, account_id, code) {
  if (!(await sourceCodeReady())) return false;
  const r = await db.query(`UPDATE ledger_account SET source_code = $3 WHERE entity_id = $1 AND account_id = $2`, [e, account_id, String(code).trim().slice(0, 20)]);
  return r.rowCount > 0;
}

/* ── periods ────────────────────────────────────────────────────────────────────────────────────────────────── */
async function periods(db, e, fy) {
  const r = await db.query(`SELECT fiscal_year, period, start_date, end_date, status, locked_by, locked_at, reason FROM fiscal_period
                             WHERE entity_id = $1 AND ($2::text IS NULL OR fiscal_year = $2) ORDER BY fiscal_year, period`, [e, fy || null]);
  return r.rows;
}
/** M157: what each month holds — how many entries, and the sales (series SV) — one grouped read for the year (or every year) */
async function periodFigures(db, e, fy) {
  const r = await db.query(`SELECT fiscal_year, period, COUNT(*)::int AS entries, COALESCE(SUM(total_minor) FILTER (WHERE series = 'SV'), 0) AS sales_minor
                              FROM journal_entry WHERE entity_id = $1 AND ($2::text IS NULL OR fiscal_year = $2) GROUP BY fiscal_year, period`, [e, fy || null]);
  return r.rows.map((x) => ({ fiscal_year: x.fiscal_year, period: Number(x.period), entries: Number(x.entries), sales_minor: Number(x.sales_minor) }));
}
async function insertPeriod(db, e, p) {
  await db.query(`INSERT INTO fiscal_period (entity_id, fiscal_year, period, start_date, end_date, status)
                  VALUES ($1,$2,$3,$4,$5,'open') ON CONFLICT (entity_id, fiscal_year, period) DO NOTHING`,
  [e, p.fiscal_year, p.period, p.start_date, p.end_date]);
}
async function setPeriodStatus(db, e, fy, period, status, by, reason) {
  const r = await db.query(`UPDATE fiscal_period SET status = $4, locked_by = $5, locked_at = now(), reason = $6
                             WHERE entity_id = $1 AND fiscal_year = $2 AND period = $3 RETURNING status`, [e, fy, period, status, by || null, reason || null]);
  return r.rows[0] || null;
}

/* ── number series: gap-free because the counter row moves inside the posting transaction ────────────────────── */
/** nextNo(db, e, series, fy, count?) → the next number; with `count` a BLOCK of that many is reserved in the one statement and the FIRST is returned (L3: 500 leads = one move of the counter, not 500) */
async function nextNo(db, e, series, fy, count) {
  const k = Math.max(1, Math.floor(Number(count) || 1));
  const r = await db.query(`INSERT INTO books_counter (entity_id, series, fiscal_year, next_no) VALUES ($1, $2, $3, 1 + $4::int)
                            ON CONFLICT (entity_id, series, fiscal_year) DO UPDATE SET next_no = books_counter.next_no + $4::int
                            RETURNING next_no - $4::int AS n`, [e, series, fy || '-', k]);
  return Number(r.rows[0].n);
}

/* ── the journal: reads ─────────────────────────────────────────────────────────────────────────────────────── */
async function entryBySource(db, e, ref) {
  const r = await db.query(`SELECT entry_id, entry_no, posting_date, doc_date, created_at, source_chit_ids FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`, [e, ref]);
  return r.rows[0] || null;
}
/** which of these sources have already posted — the source_refs that exist (a day never carries a bill that posted on its own) */
async function postedSources(db, e, refs) {
  if (!refs || !refs.length) return [];
  const r = await db.query(`SELECT source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref = ANY($2::text[])`, [e, refs]);
  return r.rows.map((x) => x.source_ref);
}
async function entry(db, e, id) {
  const h = await db.query(`SELECT * FROM journal_entry WHERE entity_id = $1 AND entry_id = $2`, [e, id]);
  if (!h.rows[0]) return null;
  const l = await db.query(`SELECT * FROM journal_line WHERE entity_id = $1 AND entry_id = $2 ORDER BY line_no`, [e, id]);
  const i = await db.query(`SELECT * FROM party_item WHERE entity_id = $1 AND entry_id = $2 ORDER BY item_id`, [e, id]);
  return Object.assign({}, h.rows[0], { lines: l.rows, items: i.rows });
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
const PAGE_MAX = 500, PAGE_DEFAULT = 100;
/**
 * PERF1 · ONE PAGE of entries, keyset (posting_date, entry_no) — the order every books list is read in. pg = { limit, after: { date, no } | null,
 * entries: [entry_id] | null }: `entries` names the entries outright (≤ PAGE_MAX — a ledger line opening its own journal), else `limit` entries after
 * the cursor, of those with a line on account_id / party_id when given. → the SQL fragment and its args (appended to `args`), used by entryLines.
 */
function pageSql(args, pg, account_id, party_id) {
  if (Array.isArray(pg.entries)) { args.push(pg.entries.slice(0, PAGE_MAX)); return `AND h.entry_id = ANY($${args.length}::uuid[])`; }
  const lim = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(pg.limit) || PAGE_DEFAULT)));
  let w = '';
  if (pg.after && pg.after.date && pg.after.no != null) { args.push(pg.after.date, String(pg.after.no)); w += ` AND (p.posting_date, p.entry_no) > ($${args.length - 1}::date, $${args.length})`; }
  if (pg.noOpening) w += ' AND p.period <> 0';   /* a ledger's period 0 is IN its opening (WX-R2R) — never a page row */
  if (account_id || party_id) w += ` AND EXISTS (SELECT 1 FROM journal_line q WHERE q.entity_id = $1 AND q.entry_id = p.entry_id AND ($4::uuid IS NULL OR q.account_id = $4) AND ($5::uuid IS NULL OR q.party_id = $5))`;
  args.push(lim + 1);   /* one more than asked: entryPage knows there is a next page without a second count */
  return `AND h.entry_id IN (SELECT p.entry_id FROM journal_entry p WHERE p.entity_id = $1 AND p.posting_date >= $2::date AND p.posting_date <= $3::date${w}
                                ORDER BY p.posting_date, p.entry_no LIMIT $${args.length})`;
}
async function entryLines(db, e, from, to, account_id, party_id, pg) {
  const args = [e, from, to, account_id || null, party_id || null];
  const page = pg ? pageSql(args, pg, account_id, party_id) : '';
  const r = await db.query(`SELECT h.entry_id, h.entry_no, h.posting_date, h.doc_date, h.event_type, h.narration, h.source_chit_id, h.reverses_entry_id, h.period,
                                   l.line_no, l.account_id, a.code, a.name AS account_name, a.role AS account_role, l.party_id, l.dr_minor, l.cr_minor, l.currency, l.counter_id, l.tax_rate,
                                   h.source_ref, cardinality(h.source_chit_ids) AS covers, c.chit_id AS src_chit_id, c.purpose AS src_purpose,
                                   COALESCE(c.business_json ->> 'printed_as', c.business_json ->> 'bill_no', c.business_json -> 'payment_received' ->> 'no') AS src_ref,
                                   COALESCE(c.business_json -> 'till' ->> 'id', c.business_json -> 'summary' -> 'till' ->> 'id') AS src_till,
                                   c.business_json -> 'till' -> 'by' AS src_by, c.business_json -> 'till' ->> 'by_name' AS src_by_name, i.display_name AS by_name,
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
                                                FROM chit_header x WHERE x.entity_id = $1 AND x.chit_id = ANY(h.source_chit_ids) ORDER BY x.chit_id, x.direction) b) END AS day_bills
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id
                              JOIN ledger_account a ON a.account_id = l.account_id
                              LEFT JOIN LATERAL (SELECT x.chit_id, x.purpose, x.business_json, x.created_at FROM chit_header x
                                                  WHERE x.entity_id = $1 AND x.chit_id = h.source_chit_id ORDER BY x.direction LIMIT 1) c ON true
                              LEFT JOIN ${REVERSALS_SQL} rv ON rv.reverses_entry_id = h.entry_id   /* M174: the entry that reversed this one, in the same read (PERF1: once, not per line) */
                              LEFT JOIN identities i ON i.identity_id = h.created_by
                             WHERE l.entity_id = $1 AND h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date
                               AND ($4::uuid IS NULL OR l.account_id = $4) AND ($5::uuid IS NULL OR l.party_id = $5) ${page}
                             ORDER BY h.posting_date, h.entry_no, l.line_no`, args);
  return r.rows;
}
/**
 * PERF1 · a page of entryLines and the cursor of the next: pg = { limit, after } (see pageSql). → { rows, next: { date, no } | null, limit }.
 * The page read one entry more than asked; that entry's lines are dropped here and its presence is the "there is more".
 */
async function entryPage(db, e, from, to, account_id, party_id, pg) {
  const lim = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(pg.limit) || PAGE_DEFAULT)));
  const rows = await entryLines(db, e, from, to, account_id, party_id, Object.assign({}, pg, { limit: lim, entries: null }));
  const ids = []; rows.forEach((l) => { if (ids[ids.length - 1] !== String(l.entry_id)) ids.push(String(l.entry_id)); });
  if (ids.length <= lim) return { rows, next: null, limit: lim };
  const keep = rows.filter((l) => String(l.entry_id) !== ids[lim]), last = keep[keep.length - 1];
  return { rows: keep, next: last ? { date: require('./books-engines').ymd(last.posting_date), no: String(last.entry_no) } : null, limit: lim };   /* the one date reader */
}
/** W2-BOOKS: the LINES of the entries of given event types in a date range, with the ledger code — ONE trip (the return read subtracts the period's own set-off and tax payment) */
async function taxEntryLines(db, e, from, to, types) {
  const result = await db.query(`SELECT h.entry_id, h.event_type, a.code, l.dr_minor, l.cr_minor
                              FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = h.entity_id JOIN ledger_account a ON a.account_id = l.account_id
                             WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND h.event_type = ANY($4::text[]) AND l.party_id IS NULL`, [e, from, to, types]);
  return result.rows;
}
async function entries(db, e, from, to) {
  const r = await db.query(`SELECT entry_id, entry_no, posting_date, doc_date, fiscal_year, period, event_type, narration, source_chit_id, source_ref,
                                   reverses_entry_id, is_opening, total_minor, currency, created_by, created_at
                              FROM journal_entry WHERE entity_id = $1 AND posting_date >= $2::date AND posting_date <= $3::date
                             ORDER BY posting_date, entry_no`, [e, from, to]);
  return r.rows;
}

/**
 * PERF1 · THE FIGURES A PAGED LIST STANDS ON, from the server — never the loaded rows added up. Over [from, to] (with a line on account_id /
 * party_id when given; period 0 left out when `noOpening`, as a ledger's opening already holds it): how many entries, Σ Dr, Σ Cr — and the same
 * sums BEFORE the cursor (`after`), so a ledger page's opening is the range's opening + those (ONE indexed SUM, never the earlier pages read).
 * → { entries, dr, cr, before_dr, before_cr }
 */
async function pageSums(db, e, from, to, account_id, party_id, after, noOpening) {
  const args = [e, from, to, account_id || null, party_id || null, after && after.date ? after.date : null, after && after.no != null ? String(after.no) : null];
  const line = account_id || party_id;
  const r = await db.query(`SELECT COUNT(DISTINCT h.entry_id)::int AS entries, COALESCE(SUM(l.dr_minor), 0) AS dr, COALESCE(SUM(l.cr_minor), 0) AS cr,
                                   COALESCE(SUM(l.dr_minor) FILTER (WHERE $6::date IS NOT NULL AND (h.posting_date, h.entry_no) <= ($6::date, $7)), 0) AS before_dr,
                                   COALESCE(SUM(l.cr_minor) FILTER (WHERE $6::date IS NOT NULL AND (h.posting_date, h.entry_no) <= ($6::date, $7)), 0) AS before_cr
                              FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id AND l.entity_id = $1
                             WHERE h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date
                               AND ($4::uuid IS NULL OR l.account_id = $4) AND ($5::uuid IS NULL OR l.party_id = $5)${noOpening ? ' AND h.period <> 0' : ''}`, args);
  const x = r.rows[0] || {};
  /* a Day book's Σ is over every line (Dr = Cr); with no account the count is of entries all the same */
  return { entries: Number(x.entries) || 0, dr: n(x.dr), cr: n(x.cr), before_dr: n(x.before_dr), before_cr: n(x.before_cr), by_line: !!line };
}

/* ── the journal: THE FOUR WRITES (postEntry only) ───────────────────────────────────────────────────────────── */
async function insertEntry(db, e, h) {
  const r = await db.query(`INSERT INTO journal_entry (entity_id, entry_no, series, posting_date, doc_date, fiscal_year, period, source_chit_id, source_ref,
                                                       event_type, rule_version, reverses_entry_id, is_opening, narration, currency, total_minor, created_by,
                                                       source_chit_ids, voucher_type)
                            VALUES ($1,$2,$18,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::uuid[],$19)
                            RETURNING entry_id, created_at`,
  [e, h.entry_no, h.posting_date, h.doc_date || null, h.fiscal_year, h.period, h.source_chit_id || null, h.source_ref || null,
    h.event_type, h.rule_version || null, h.reverses_entry_id || null, !!h.is_opening, h.narration || null, h.currency, h.total_minor, h.created_by || null,
    /* the chits a SUMMARY entry covers (a walk-in day names its bills — a bill it does not name posts late, critic M7) */
    Array.isArray(h.source_chit_ids) && h.source_chit_ids.length ? h.source_chit_ids : null,
    /* the voucher SERIES (SV · PV · … · MJ) */
    h.series || 'JV',
    /* the voucher TYPE (Sales · Payment · Journal …), kept for every new entry since b279 ran (Athi, 2026-10-03). An MJ entry keeps its own kind
       (a manual Payment reads Payment, not Journal). Entries written before it are NULL and derived from the series (books.voucherTypeOfEntry). */
    h.voucher_type || null]);
  return r.rows[0];
}
async function insertLines(db, e, entry_id, lines) {
  if (!lines.length) return;
  /* FX1: b392's three columns (txn_currency · fx_rate_source · fx_rate_date) ride on the row once they exist; before b392 the write is the same as it was */
  const fx = await fxLinesReady(), w = fx ? 15 : 12;
  const vals = [], args = [];
  lines.forEach((l, i) => {
    const b = i * w;
    vals.push('(' + Array.from({ length: w }, (_, k) => '$' + (b + k + 1)).join(',') + ')');
    args.push(e, entry_id, l.line_no, l.account_id, l.party_id || null, l.dr_minor, l.cr_minor, l.currency,
      l.amount_txn_minor == null ? null : l.amount_txn_minor, l.fx_rate || 1, l.counter_id || null, l.tax_rate || null);
    if (fx) args.push(l.txn_currency || l.currency, l.fx_rate_source || null, l.fx_rate_date || null);
  });
  await db.query(`INSERT INTO journal_line (entity_id, entry_id, line_no, account_id, party_id, dr_minor, cr_minor, currency,
                                            amount_txn_minor, fx_rate, counter_id, tax_rate${fx ? ', txn_currency, fx_rate_source, fx_rate_date' : ''}) VALUES ${vals.join(',')}`, args);
}
/* ── FX1 · the exchange rates (b391 fx_rate — insert-only; the newest row for a day and pair is that day's rate) ── */
const fxRatesReady = () => require('./schema').hasTable('fx_rate');
const FX_COLS = 'rate_id, rate_date, from_ccy, to_ccy, rate::text AS rate, source, source_ref, entered_by, created_at';
async function fxRates(db, e, q) {
  const o = q || {}, args = [e], where = ['entity_id = $1'];
  if (o.from) { args.push(o.from); where.push('from_ccy = $' + args.length); }
  args.push(o.limit || 500);
  const r = await db.query(`SELECT ${FX_COLS} FROM fx_rate WHERE ${where.join(' AND ')} ORDER BY rate_date DESC, from_ccy, rate_id DESC LIMIT $${args.length}`, args);
  return r.rows;
}
/** rows → ONE INSERT (an import is one trip, however many rows) */
async function insertFxRates(db, e, rows, by) {
  if (!rows.length) return [];
  const vals = [], args = [];
  rows.forEach((x, i) => {
    const b = i * 8;
    vals.push('($' + (b + 1) + ',$' + (b + 2) + '::date,$' + (b + 3) + ',$' + (b + 4) + ',$' + (b + 5) + '::numeric,$' + (b + 6) + ',$' + (b + 7) + ',$' + (b + 8) + ')');
    args.push(e, x.rate_date, x.from_ccy, x.to_ccy, x.rate, x.source, x.source_ref, by || null);
  });
  const r = await db.query(`INSERT INTO fx_rate (entity_id, rate_date, from_ccy, to_ccy, rate, source, source_ref, entered_by) VALUES ${vals.join(',')} RETURNING ${FX_COLS}`, args);
  return r.rows;
}
/** the newest rate for that day — or, with `since`, the newest on or before `date` and not before `since` (a period's closing rate) */
async function fxRateOn(db, e, from, to, date, since) {
  const r = await db.query(`SELECT ${FX_COLS} FROM fx_rate WHERE entity_id = $1 AND from_ccy = $2 AND to_ccy = $3 AND ${since ? 'rate_date BETWEEN $5::date AND $4::date' : 'rate_date = $4::date'}
                             ORDER BY rate_date DESC, rate_id DESC LIMIT 1`, since ? [e, from, to, date, since] : [e, from, to, date]);
  return r.rows[0] || null;
}
/** FX1 (b392): does journal_line carry its transaction currency yet — lib/schema's cached hasColumn */
const fxLinesReady = () => require('./schema').hasColumn('journal_line', 'txn_currency');
/**
 * FX1 — THE OPEN FOREIGN BALANCES, as at a day: per account × party × transaction currency (not the functional one), what the books carry (functional,
 * Dr +) beside the foreign amount (its own minor units, Dr +). ONE grouped read over journal_line (b392). `party` / `account_ids` narrow it (a settlement
 * asks for one party on one control account). Rows whose foreign amount is nil are left out.
 */
async function foreignBalances(db, e, o) {
  const q = o || {}, args = [e, q.asOf || '9999-12-31', q.functional || ''], where = [];
  if (q.party) { args.push(q.party); where.push('l.party_id = $' + args.length); }
  if (Array.isArray(q.account_ids) && q.account_ids.length) { args.push(q.account_ids); where.push('l.account_id = ANY($' + args.length + '::uuid[])'); }
  if (q.currency) { args.push(q.currency); where.push('l.txn_currency = $' + args.length); }
  const r = await db.query(`SELECT l.account_id, l.party_id, l.txn_currency,
                                   SUM(l.dr_minor - l.cr_minor) AS fn_minor,
                                   SUM(CASE WHEN l.dr_minor > 0 THEN COALESCE(l.amount_txn_minor, 0) ELSE -COALESCE(l.amount_txn_minor, 0) END) AS txn_minor
                              FROM journal_line l JOIN journal_entry j ON j.entry_id = l.entry_id AND j.entity_id = l.entity_id
                             WHERE l.entity_id = $1 AND j.posting_date <= $2::date AND l.txn_currency IS NOT NULL AND l.txn_currency <> $3${where.length ? ' AND ' + where.join(' AND ') : ''}
                             GROUP BY l.account_id, l.party_id, l.txn_currency
                            HAVING SUM(CASE WHEN l.dr_minor > 0 THEN COALESCE(l.amount_txn_minor, 0) ELSE -COALESCE(l.amount_txn_minor, 0) END) <> 0`, args);
  return r.rows.map((x) => ({ account_id: x.account_id, party_id: x.party_id || null, txn_currency: x.txn_currency, fn_minor: n(x.fn_minor), txn_minor: n(x.txn_minor) }));
}
/** one upsert per (account, party_key, currency, year, period) — the running monthly totals */
async function addBalances(db, e, rows) {
  for (const b of rows) {
    await db.query(`INSERT INTO account_balance (entity_id, account_id, party_key, currency, fiscal_year, period, dr_minor, cr_minor, line_count, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
                    ON CONFLICT (entity_id, account_id, party_key, currency, fiscal_year, period)
                    DO UPDATE SET dr_minor = account_balance.dr_minor + EXCLUDED.dr_minor, cr_minor = account_balance.cr_minor + EXCLUDED.cr_minor,
                                  line_count = account_balance.line_count + EXCLUDED.line_count, updated_at = now()`,
    [e, b.account_id, b.party_key || ZERO, b.currency, b.fiscal_year, b.period, b.dr_minor, b.cr_minor, b.line_count]);
  }
}
async function insertItems(db, e, items) {
  for (const it of items) {
    await db.query(`INSERT INTO party_item (entity_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency,
                                            due_date, doc_date, status, reverses, reverses_kind, entry_id, payment_id, note, created_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [e, it.party_id, it.account_id, it.side, it.ref, it.against_ref, it.ref_kind, it.kind || null, it.amount_minor || 0, it.pending_minor == null ? null : it.pending_minor,
      it.currency, it.due_date || null, it.doc_date || null, it.status || null, it.reverses || null, it.reverses_kind || null,
      it.entry_id || null, it.payment_id || null, it.note || null, it.created_by || null]);
  }
}

/* ── balances: reads ────────────────────────────────────────────────────────────────────────────────────────── */
/** every monthly row of one year, with its ledger code — CBLedger's `balances` */
/** PERF1: `fy` may be a LIST of years — every year a carry-forward needs in ONE read (books.yearBalances), not one trip per year */
async function yearRows(db, e, fy) {
  const many = Array.isArray(fy);
  const r = await db.query(`SELECT b.fiscal_year, b.period, a.code, b.party_key, b.dr_minor, b.cr_minor FROM account_balance b
                              JOIN ledger_account a ON a.account_id = b.account_id
                             WHERE b.entity_id = $1 AND ${many ? 'b.fiscal_year = ANY($2::text[])' : 'b.fiscal_year = $2'}`, [e, fy]);
  return r.rows;
}
/** the journal lines posted in [from, to], with code and entry — CBLedger's `lines` */
/**
 * M29: each line also says whether its entry was REVERSED and by what (`reverses_entry_id` on the line's own entry; `reversed_by` /
 * `reversed_narration` = the first entry that points back at it, read in the SAME query — a reversal dated outside [from, to] still shows).
 */
async function ledgerLines(db, e, from, to, party_id) {
  const r = await db.query(`SELECT h.entry_id, h.entry_no, h.posting_date, h.fiscal_year, h.period, h.is_opening, h.source_ref, h.narration,
                                   h.source_chit_id, h.event_type, h.reverses_entry_id, l.line_no, a.code, l.party_id, l.dr_minor, l.cr_minor, l.currency,
                                   rv.entry_no AS reversed_by, rv.narration AS reversed_narration
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
                              LEFT JOIN ${REVERSALS_SQL} rv ON rv.reverses_entry_id = h.entry_id
                             WHERE l.entity_id = $1 AND h.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND ($4::uuid IS NULL OR l.party_id = $4)
                             ORDER BY h.posting_date, h.entry_no, l.line_no`, [e, from, to, party_id || null]);
  return r.rows;
}
/** the years that have any balance row, oldest first */
async function years(db, e) {
  const r = await db.query(`SELECT DISTINCT fiscal_year FROM account_balance WHERE entity_id = $1 ORDER BY fiscal_year`, [e]);
  return r.rows.map((x) => x.fiscal_year);
}
/** Σ of the monthly rows for periods [pFrom, pTo] of one year — per account (party_key zero) or per account+party */
async function periodSums(db, e, fy, pFrom, pTo, byParty) {
  const r = await db.query(`SELECT account_id, party_key, SUM(dr_minor) AS dr, SUM(cr_minor) AS cr FROM account_balance
                             WHERE entity_id = $1 AND fiscal_year = $2 AND period BETWEEN $3 AND $4
                               AND (CASE WHEN $5 THEN party_key <> $6::uuid ELSE party_key = $6::uuid END)
                             GROUP BY account_id, party_key`, [e, fy, pFrom, pTo, !!byParty, ZERO]);
  return r.rows.map((x) => ({ account_id: x.account_id, party_id: x.party_key === ZERO ? null : x.party_key, dr: n(x.dr), cr: n(x.cr) }));
}
/** Σ of the lines posted in [from, to] — for the part of a month a balance row cannot answer */
async function lineSums(db, e, from, to, byParty) {
  const r = await db.query(`SELECT l.account_id, ${byParty ? 'l.party_id' : 'NULL::uuid AS party_id'}, SUM(l.dr_minor) AS dr, SUM(l.cr_minor) AS cr
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id
                             WHERE l.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND NOT h.is_opening
                               ${byParty ? 'AND l.party_id IS NOT NULL' : ''}
                             GROUP BY l.account_id${byParty ? ', l.party_id' : ''}`, [e, from, to]);
  return r.rows.map((x) => ({ account_id: x.account_id, party_id: x.party_id || null, dr: n(x.dr), cr: n(x.cr) }));
}
async function firstYear(db, e) {
  const r = await db.query(`SELECT MIN(fiscal_year) AS fy FROM account_balance WHERE entity_id = $1`, [e]);
  return r.rows[0] ? r.rows[0].fy : null;
}
/** the nightly check: every month's balance rows recomputed from the lines, and the rows that differ */
async function balanceDrift(db, e) {
  const r = await db.query(`WITH l AS (
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
                              LIMIT 50`, [e, ZERO]);
  return r.rows.map((x) => ({ account_id: x.account_id, party_id: x.party_key === ZERO ? null : x.party_key, fiscal_year: x.fiscal_year, period: x.period,
    lines_dr: n(x.lines_dr), lines_cr: n(x.lines_cr), kept_dr: n(x.kept_dr), kept_cr: n(x.kept_cr) }));
}
/** entries whose lines do not add up — the trigger-free proof, run nightly */
async function unbalancedEntries(db, e) {
  const r = await db.query(`SELECT h.entry_no, SUM(l.dr_minor) AS dr, SUM(l.cr_minor) AS cr FROM journal_entry h JOIN journal_line l ON l.entry_id = h.entry_id
                             WHERE h.entity_id = $1 GROUP BY h.entry_no HAVING SUM(l.dr_minor) <> SUM(l.cr_minor) LIMIT 20`, [e]);
  return r.rows.map((x) => ({ entry_no: x.entry_no, dr: n(x.dr), cr: n(x.cr) }));
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
/** PERF1: `party_id` may be a LIST — the parties one screen shows (a CRM page, the cheques list), one read; never every party's items for a page of them */
async function items(db, e, party_id, account_id) {
  const many = Array.isArray(party_id);
  const r = await db.query(`SELECT item_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency, due_date, doc_date,
                                   status, reverses, reverses_kind, entry_id, payment_id, note, created_at FROM party_item
                             WHERE entity_id = $1 AND ${many ? 'party_id = ANY($2::uuid[])' : '($2::uuid IS NULL OR party_id = $2)'} AND ($3::uuid IS NULL OR account_id = $3)
                             ORDER BY created_at, item_id`, [e, many ? party_id.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))) : (party_id || null), account_id || null]);
  return r.rows.map((x) => Object.assign({}, x, { amount_minor: n(x.amount_minor) }));
}
/** who holds these documents on one control account: [{ ref, party_id }] — a document belongs to ONE party (postEntry asks before it writes) */
async function itemOwners(db, e, account_id, refs) {
  if (!refs || !refs.length) return [];
  const r = await db.query(`SELECT DISTINCT ref, party_id FROM party_item WHERE entity_id = $1 AND account_id = $2 AND ref = against_ref AND ref = ANY($3::text[])`, [e, account_id, refs]);
  return r.rows;
}
/** an account's net (dr − cr) over every month of every year — a balance-sheet account's standing balance */
async function accountNet(db, e, account_id) {
  const r = await db.query(`SELECT COALESCE(SUM(dr_minor), 0) AS dr, COALESCE(SUM(cr_minor), 0) AS cr FROM account_balance
                             WHERE entity_id = $1 AND account_id = $2 AND party_key = $3::uuid`, [e, account_id, ZERO]);
  return n(r.rows[0].dr) - n(r.rows[0].cr);
}
/** Σ open items per party on one account — the other side of the control-account check */
async function itemTotals(db, e, account_id) {
  const r = await db.query(`SELECT party_id, SUM(amount_minor) AS t FROM party_item WHERE entity_id = $1 AND account_id = $2 GROUP BY party_id`, [e, account_id]);
  return r.rows.map((x) => ({ party_id: x.party_id, total_minor: n(x.t) }));
}

/* ── payments ───────────────────────────────────────────────────────────────────────────────────────────────── */
async function insertPayment(db, e, p) {
  const r = await db.query(`INSERT INTO books_payment (entity_id, party_id, direction, amount_minor, currency, mode, reference, cheque_no, cheque_bank,
                                                       cheque_date, received_at, client_ref, created_by)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                            ON CONFLICT (entity_id, client_ref) WHERE client_ref IS NOT NULL DO NOTHING
                            RETURNING payment_id`,
  [e, p.party_id, p.direction, p.amount_minor, p.currency, p.mode, p.reference || null, p.cheque_no || null, p.cheque_bank || null,
    p.cheque_date || null, p.received_at, p.client_ref || null, p.by || null]);
  if (r.rows[0]) return { payment_id: r.rows[0].payment_id, duplicate: false };
  const x = await db.query(`SELECT payment_id FROM books_payment WHERE entity_id = $1 AND client_ref = $2`, [e, p.client_ref]);
  return { payment_id: x.rows[0] && x.rows[0].payment_id, duplicate: true };
}
/** the payment a client_ref already recorded (unique per shop) — a replay is answered with it, never recorded again */
async function paymentByRef(db, e, client_ref) {
  const r = await db.query(`SELECT payment_id, mode FROM books_payment WHERE entity_id = $1 AND client_ref = $2`, [e, String(client_ref)]);
  return r.rows[0] || null;
}
/** a party's payments in one direction RECORDED since a moment (the duplicate rule's W3, PAY D5: a 24-hour window) — newest first, bounded */
async function paymentsSince(db, e, party_id, direction, since) {
  const r = await db.query(`SELECT payment_id, amount_minor, currency, mode, cheque_no, received_at, created_at FROM books_payment
                             WHERE entity_id = $1 AND party_id = $2 AND direction = $3 AND created_at >= $4 ORDER BY created_at DESC LIMIT 50`, [e, party_id, direction, since]);
  return r.rows.map((x) => Object.assign({}, x, { amount_minor: n(x.amount_minor) }));
}
/**
 * the shop's cheques with where each stands (the latest of its status rows): those still HELD (received · deposited), or
 * with `all` every cheque. Newest first, bounded.
 */
async function cheques(db, e, all, limit) {
  const r = await db.query(`SELECT c.* FROM (
                              SELECT p.payment_id, p.party_id, p.direction, p.amount_minor, p.currency, p.reference, p.cheque_no, p.cheque_bank, p.cheque_date,
                                     p.received_at, p.created_at,
                                     (SELECT i.status FROM party_item i WHERE i.entity_id = p.entity_id AND i.payment_id = p.payment_id AND i.ref_kind = 'status'
                                         AND i.status IN ('received', 'deposited', 'cleared', 'bounced') ORDER BY i.item_id DESC LIMIT 1) AS status
                                FROM books_payment p WHERE p.entity_id = $1 AND p.mode = 'cheque') c
                             WHERE $2::boolean OR c.status IS NULL OR c.status IN ('received', 'deposited')
                             ORDER BY c.received_at DESC, c.created_at DESC LIMIT $3`, [e, !!all, limit || 200]);
  return r.rows.map((x) => Object.assign({}, x, { amount_minor: n(x.amount_minor) }));
}
async function payment(db, e, id) {
  const r = await db.query(`SELECT * FROM books_payment WHERE entity_id = $1 AND payment_id = $2`, [e, id]);
  return r.rows[0] ? Object.assign({}, r.rows[0], { amount_minor: n(r.rows[0].amount_minor) }) : null;
}

/* ── the payment advice (M30, b285) ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DEPLOYS BEFORE b285 RUNS (Athi runs SQL by hand): every reader asks adviceReady() first — lib/schema's cached hasColumn
 * (a yes forever, a no for a minute) — and answers "not available yet" rather than 42703. No SAVEPOINT: a read that may be
 * refused is not tried; a column that is absent is simply not asked for. */
async function adviceReady(db, e) {
  const sc = require('./schema');
  return (await sc.hasColumn('books_payment', 'advice_chit_id')) && (await sc.hasColumn('books_payment', 'advice_shared_at'));
}
/** the advice columns of some payments, one read: [{ payment_id, advice_chit_id, advice_shared_at }] — call only after adviceReady() */
async function paymentsAdvice(db, e, ids) {
  const u = (ids || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!u.length) return [];
  const r = await db.query(`SELECT payment_id, advice_chit_id, advice_shared_at FROM books_payment WHERE entity_id = $1 AND payment_id = ANY($2::uuid[])`, [e, u]);
  return r.rows;
}
/**
 * ⭐ ONE ADVICE PER PAYMENT — merge-patch of the NAMED fields only (SPEC-payments §4.3). advice_chit_id is FIRST-WINS: the UPDATE
 * only lands while the column is null or already that id; a different id is answered { conflict: true } and the route says 409.
 * advice_shared_at: set once (COALESCE keeps the first moment). → { payment_id, advice_chit_id, advice_shared_at } | null (no such payment) | { conflict: true, advice_chit_id }
 */
async function setAdvice(db, e, id, patch) {
  const p = patch || {};
  const r = await db.query(`UPDATE books_payment
                               SET advice_chit_id = COALESCE(advice_chit_id, $3::uuid),
                                   advice_shared_at = COALESCE(advice_shared_at, $4::timestamptz)
                             WHERE entity_id = $1 AND payment_id = $2 AND ($3::uuid IS NULL OR advice_chit_id IS NULL OR advice_chit_id = $3::uuid)
                         RETURNING payment_id, advice_chit_id, advice_shared_at`, [e, id, p.advice_chit_id || null, p.advice_shared_at || null]);
  if (r.rows[0]) return r.rows[0];
  const x = await db.query(`SELECT payment_id, advice_chit_id, advice_shared_at FROM books_payment WHERE entity_id = $1 AND payment_id = $2`, [e, id]);
  return x.rows[0] ? Object.assign({ conflict: true }, x.rows[0]) : null;
}
/** where some advice chits stand on MY copy (the payer's: 'delivered' once sent) and whether any dispute is open on them — one read for a whole statement */
async function adviceStates(db, e, chitIds) {
  const u = (chitIds || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  const out = {}; if (!u.length) return out;
  const r = await db.query(`SELECT cs.chit_id, cs.current_status AS status,
                                   EXISTS (SELECT 1 FROM chit_disputes d WHERE d.entity_id = cs.entity_id AND d.chit_id = cs.chit_id AND d.status = 'open') AS disputed
                              FROM chit_status cs WHERE cs.entity_id = $1 AND cs.chit_id = ANY($2::uuid[])`, [e, u]);
  r.rows.forEach((x) => { out[x.chit_id] = { status: x.status, disputed: x.disputed === true }; });
  return out;
}
/**
 * the payments that have NO advice yet and could send one (the To-do advices_to_send, SPEC §4.7): party on rail, posted, not reversed,
 * mode ≠ a cheque still held, nothing sent or shared. One read, bounded, newest first. Call only after adviceReady().
 */
async function paymentsNeedingAdvice(db, e, limit) {
  const r = await db.query(`SELECT p.payment_id, p.party_id, i.display_name AS name, p.direction, p.amount_minor, p.currency, p.mode, p.received_at
                              FROM books_payment p JOIN identities i ON i.identity_id = p.party_id
                             WHERE p.entity_id = $1 AND p.advice_chit_id IS NULL AND p.advice_shared_at IS NULL AND ${require('./local-identity').onRailSql('i')}
                               AND EXISTS (SELECT 1 FROM journal_entry o WHERE o.entity_id = p.entity_id AND o.source_ref = 'pay:' || p.payment_id::text)
                               AND NOT EXISTS (SELECT 1 FROM journal_entry o JOIN journal_entry r ON r.entity_id = o.entity_id AND r.reverses_entry_id = o.entry_id
                                                WHERE o.entity_id = p.entity_id AND o.source_ref = 'pay:' || p.payment_id::text)
                               AND (p.mode <> 'cheque' OR EXISTS (SELECT 1 FROM party_item s WHERE s.entity_id = p.entity_id AND s.payment_id = p.payment_id AND s.ref_kind = 'status' AND s.status = 'cleared'))
                             ORDER BY p.received_at DESC, p.created_at DESC LIMIT $2`, [e, limit || 50]);
  return r.rows.map((x) => Object.assign({}, x, { amount_minor: n(x.amount_minor) }));
}
/** the shop's own name (the advice names its sender; a co-assist's token carries the person's name, not the shop's) */
async function shopName(db, e) {
  const r = await db.query(`SELECT display_name FROM identities WHERE identity_id = $1`, [e]);
  return (r.rows[0] && r.rows[0].display_name) || null;
}

/**
 * ⭐ BR1 · the rail leg of the bank reconciliation: my copies of the PAYMENT ADVICES (M30, business_json.kind 'payment_advice') and of the bank
 * questions I asked ('bank_query') made in [from − 10 days, to + 10 days] — ONE read for a whole statement, bounded. The engine (bank-recon
 * railPayments / explain) reads them on the device; nothing here computes money. counterparty = the sender on a received copy, else the first
 * recipient that is not me. Drafts and deleted copies are left out.
 */
async function bankRailChits(db, e, from, to, limit) {
  const r = await db.query(`SELECT h.chit_id, cs.direction, h.business_json, d.line_items, cs.current_status AS status, h.created_at,
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
                             ORDER BY h.created_at, h.chit_id LIMIT $4`, [e, from, to, limit || 500, String(e)]);
  return r.rows;
}

/* ── the waiting list ───────────────────────────────────────────────────────────────────────────────────────── */
async function queue(db, e, o) {
  await db.query(`INSERT INTO books_outbox (entity_id, source_chit_id, source_ref, event, why) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [e, o.source_chit_id || null, o.source_ref || null, JSON.stringify(o.event || {}), String(o.why || '').slice(0, 500)]);
}
/**
 * ⭐ STD1: WHAT A WAITING ROW ASKS OF THE OWNER is DATA — park() writes `event.todo` ('accept' · 'add_supplier' · 'record') and, for
 * add_supplier, the typed supplier `event.name` (books-hooks). A row parked before that carries neither: THIS fragment is the one place it is
 * classified — read here for every count and list, and written once onto the row by backfillTodo (the retry path). Nothing else, on the server
 * or the client, reads the sentence to decide what a row is.
 */
const TODO_SQL = `COALESCE(event->>'todo', CASE WHEN event->>'waiting' = 'acceptance' THEN 'accept'
                                               WHEN event->>'waiting' = 'party' AND why LIKE 'Who is %' THEN 'add_supplier' ELSE 'record' END)`;
const NAME_SQL = `CASE WHEN ${TODO_SQL} = 'add_supplier' THEN COALESCE(event->>'name', substring(why from '^Who is (.+)\\? Add them as a supplier')) END`;
/**
 * STD1: the open waiting row of ONE chit, as a SQL scalar (json) over `ent` / `cid` placeholders — what the chit read (routes/chits.js
 * ONE_SHOT) carries as `books_wait`, so the bill's popup greys Accept from the server's answer, not from a list the page may not hold.
 */
const waitOfChitSql = (ent, cid) => `(SELECT json_build_object('todo', ${TODO_SQL}, 'name', ${NAME_SQL}, 'why', why, 'candidates', COALESCE(event->'candidates', '[]'::jsonb))
   FROM books_outbox WHERE entity_id = ${ent} AND source_chit_id = ${cid} AND done_at IS NULL ORDER BY id DESC LIMIT 1)`;
async function waiting(db, e, limit) {
  const r = await db.query(`SELECT id, source_chit_id, source_ref, event, why, tries, created_at, ${TODO_SQL} AS todo, ${NAME_SQL} AS name FROM books_outbox
                             WHERE entity_id = $1 AND done_at IS NULL ORDER BY tries, id LIMIT $2`, [e, limit || 100]);   /* least-tried first: rows that can never post must not starve a new one (critic F6) */
  return r.rows;
}
/**
 * how many posts are waiting, by what each asks — the same predicate as waiting(), every row (no cap), ONE GROUP BY. The ONE count Home,
 * the Accounts card, Books' To do and /health say (STD1) → { total, accept, add_supplier, record }.
 */
async function waitingCount(db, e) {
  const r = await db.query(`SELECT ${TODO_SQL} AS todo, count(*)::int AS n FROM books_outbox WHERE entity_id = $1 AND done_at IS NULL GROUP BY 1`, [e]);
  const out = { total: 0, accept: 0, add_supplier: 0, record: 0 };
  r.rows.forEach((x) => { const k = Object.prototype.hasOwnProperty.call(out, x.todo) && x.todo !== 'total' ? x.todo : 'record'; out[k] += Number(x.n) || 0; out.total += Number(x.n) || 0; });
  return out;
}
/** STD1: a row parked before `todo` existed gets it ONCE, from TODO_SQL (one statement, every such row; the retry path calls it) → rows written */
async function backfillTodo(db, e) {
  const r = await db.query(`UPDATE books_outbox SET event = COALESCE(event, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('todo', ${TODO_SQL}, 'name', ${NAME_SQL}))
                             WHERE entity_id = $1 AND done_at IS NULL AND NOT (COALESCE(event, '{}'::jsonb) ? 'todo')`, [e]);
  return (r && r.rowCount) || 0;
}
/** FX-F10W2: the open Waiting rows of these chits are done — the status change that posted (or refused) them says why; one statement → rows closed */
async function outboxClose(db, e, ids, why) {
  const r = await db.query(`UPDATE books_outbox SET done_at = now(), why = $3 WHERE entity_id = $1 AND source_chit_id = ANY($2::uuid[]) AND done_at IS NULL`,
    [e, ids, String(why || '').slice(0, 500)]);
  return (r && r.rowCount) || 0;
}
/** ev (FX-F10W, optional): keys merged into the row's event on a failed try — a retried bill's todo · name · candidates follow it; same statement */
async function outboxDone(db, e, id, ok, why, ev) {
  if (!ok && ev && typeof ev === 'object') return db.query(`UPDATE books_outbox SET tries = tries + 1, why = $3, event = COALESCE(event, '{}'::jsonb) || $4::jsonb WHERE entity_id = $1 AND id = $2`,
    [e, id, String(why || '').slice(0, 500), JSON.stringify(ev)]).then(() => undefined);
  await db.query(ok ? `UPDATE books_outbox SET done_at = now(), tries = tries + 1 WHERE entity_id = $1 AND id = $2`
                    : `UPDATE books_outbox SET tries = tries + 1, why = $3 WHERE entity_id = $1 AND id = $2`, ok ? [e, id] : [e, id, String(why || '').slice(0, 500)]);
}

/* ── the change log (append-only) ───────────────────────────────────────────────────────────────────────────── */
async function logChange(db, e, c) {
  await db.query(`INSERT INTO books_change_log (entity_id, by, table_name, row_id, field, old, new) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e, c.by || null, c.table_name, c.row_id == null ? null : String(c.row_id), c.field || null,
      c.old == null ? null : String(c.old), c.new == null ? null : String(c.new)]);
}
async function changes(db, e, from, to) {
  const r = await db.query(`SELECT at, by, table_name, row_id, field, old, new FROM books_change_log
                             WHERE entity_id = $1 AND at >= $2::date AND at < ($3::date + 1) ORDER BY at, id`, [e, from, to]);
  return r.rows;
}

/* ── parties (the customer / supplier lists) ────────────────────────────────────────────────────────────────── */
/** the party's credit terms, from whichever list holds them (a customer's for a sale, a supplier's for a purchase) */
async function terms(db, e, party_id, side) {
  const t = side === 'supplier' ? 'supplier_list' : 'customer_list';
  const k = side === 'supplier' ? 'supplier_entity_id' : 'customer_identity_id';
  const r = await db.query(`SELECT credit_days, credit_limit_minor, party_no FROM ${t} WHERE owner_entity_id = $1 AND ${k} = $2`, [e, party_id]);
  return r.rows[0] || null;
}
/**
 * the shop's parties (customer list ∪ supplier list) with their numbers, names and terms. PERF1: `ids` (optional) = only these — the parties a
 * page names (a Day book page, the cheques list); the read now starts FROM THE SHOP'S TWO LISTS (owner-indexed) and reaches identities by its key —
 * it started from identities with a WHERE over both outer joins, which read the whole platform's identities for one shop's list.
 */
async function parties(db, e, ids) {
  const some = Array.isArray(ids), want = some ? Array.from(new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))).map(String))) : null;
  if (some && !want.length) return [];
  /* M30: on_rail — can this party RECEIVE a chit (an active business, never a minted ~local record, never a shopper)? The one
     question lib/local-identity asks, asked in SQL for the whole list, so a payment knows whether its advice can be SENT or only SHARED. */
  const only = (col) => (some ? ` AND ${col} = ANY($2::uuid[])` : '');
  const r = await db.query(`WITH p AS (SELECT customer_identity_id AS id FROM customer_list WHERE owner_entity_id = $1${only('customer_identity_id')}
                                       UNION SELECT supplier_entity_id FROM supplier_list WHERE owner_entity_id = $1${only('supplier_entity_id')})
                            SELECT i.identity_id AS party_id, i.display_name, i.user_id, i.gstn, ${require('./local-identity').onRailSql('i')} AS on_rail,
                                   c.party_no AS c_no, s.party_no AS s_no, c.nickname AS c_nick, s.nickname AS s_nick,
                                   COALESCE(c.legal_name, s.legal_name) AS legal_name, (c.customer_identity_id IS NOT NULL) AS customer,
                                   (s.supplier_entity_id IS NOT NULL) AS supplier, c.credit_days AS c_days, s.credit_days AS s_days,
                                   c.credit_limit_minor AS c_limit, s.credit_limit_minor AS s_limit, COALESCE(c.state_code, s.state_code) AS state_code
                              FROM p JOIN identities i ON i.identity_id = p.id
                              LEFT JOIN customer_list c ON c.owner_entity_id = $1 AND c.customer_identity_id = i.identity_id
                              LEFT JOIN supplier_list s ON s.owner_entity_id = $1 AND s.supplier_entity_id = i.identity_id`, some ? [e, want] : [e]);
  return r.rows.map((x) => ({ party_id: x.party_id, party_no: x.c_no || x.s_no || null, name: x.display_name, nickname: x.c_nick || x.s_nick || null,
    legal_name: x.legal_name, user_id: x.user_id, on_rail: x.on_rail === true, customer: x.customer, supplier: x.supplier, credit_days: x.c_days != null ? x.c_days : x.s_days,
    credit_limit_minor: x.c_limit != null ? n(x.c_limit) : (x.s_limit != null ? n(x.s_limit) : null), state_code: x.state_code, gstin: x.gstn || null }));
}
/** FX1: the names of a few of the shop's own parties (its customer / supplier lists), by id → { id: name } (the revaluation's rows) — one read */
async function partyNames(db, e, ids) {
  const want = Array.from(new Set((ids || []).filter(Boolean).map(String)));
  if (!want.length) return {};
  const r = await db.query(`SELECT i.identity_id, i.display_name FROM identities i
                             WHERE i.identity_id = ANY($2::uuid[])
                               AND (EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = $1 AND c.customer_identity_id = i.identity_id)
                                 OR EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = $1 AND s.supplier_entity_id = i.identity_id))`, [e, want]);
  const out = {}; r.rows.forEach((x) => { out[String(x.identity_id)] = x.display_name || null; }); return out;
}
/** is this id a party of the shop at all — on its customer list, its supplier list, or neither */
async function partyOn(db, e, party_id) {
  const r = await db.query(`SELECT EXISTS (SELECT 1 FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2) AS customer,
                                   EXISTS (SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2) AS supplier`, [e, party_id]);
  return r.rows[0] || { customer: false, supplier: false };
}
/**
 * ⭐ STD1 · ONE SUPPLIER-BY-NAME RESOLVER (receiptFacts and bill-use.linkParty both call this; the counter's twin is till.html oneByName).
 * P = { party_no } — that number on MY supplier list; or { name } — a supplier whose name or nickname IS it, trimmed, case aside. Exactly ONE
 * is "known"; two of the same name is nobody (custKnown's rule). By name, the near matches come too: the typed name INSIDE a supplier's name
 * or nickname, a prefix first (the counter's datalist rule), ≤ 3 — names + party_no only, never an amount. ONE statement.
 * → { one: { party_id, name, party_no } | null, near: [{ name, party_no }] }
 */
async function supplierByName(db, e, P) {
  const no = P && P.party_no != null ? String(P.party_no).trim() : '', nm = P && P.name != null ? String(P.name).trim() : '';
  if (!no && !nm) return { one: null, near: [] };
  const like = '%' + nm.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const r = no
    ? await db.query(`SELECT s.supplier_entity_id AS party_id, i.display_name AS name, s.party_no, true AS exact FROM supplier_list s JOIN identities i ON i.identity_id = s.supplier_entity_id
        WHERE s.owner_entity_id = $1 AND s.party_no = $2 LIMIT 2`, [e, no])
    : await db.query(`SELECT s.supplier_entity_id AS party_id, i.display_name AS name, s.party_no,
              (lower(btrim(i.display_name)) = lower($2) OR lower(btrim(COALESCE(s.nickname, ''))) = lower($2)) AS exact
         FROM supplier_list s JOIN identities i ON i.identity_id = s.supplier_entity_id
        WHERE s.owner_entity_id = $1 AND (lower(btrim(i.display_name)) = lower($2) OR lower(btrim(COALESCE(s.nickname, ''))) = lower($2)
                                          OR lower(i.display_name) LIKE $3 OR lower(COALESCE(s.nickname, '')) LIKE $3)
        ORDER BY 4 DESC, (lower(btrim(i.display_name)) LIKE $4) DESC, i.display_name LIMIT 5`, [e, nm, like, like.slice(1)]);
  const rows = r.rows || [], exact = rows.filter((x) => x.exact);
  const one = exact.length === 1 ? { party_id: String(exact[0].party_id), name: String(exact[0].name || ''), party_no: exact[0].party_no || null } : null;
  return { one, near: one || no ? [] : rows.filter((x) => x.name).slice(0, 3).map((x) => ({ name: String(x.name), party_no: x.party_no || null })) };
}
/** a party number, once: the same identity on both lists keeps one number (one series per shop) */
async function partyNoOf(db, e, party_id) {
  const r = await db.query(`SELECT COALESCE((SELECT party_no FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2),
                                            (SELECT party_no FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2)) AS no`, [e, party_id]);
  return r.rows[0] ? r.rows[0].no : null;
}
async function setPartyNo(db, e, party_id, no) {
  await db.query(`UPDATE customer_list SET party_no = $3 WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND party_no IS NULL`, [e, party_id, no]);
  await db.query(`UPDATE supplier_list SET party_no = $3 WHERE owner_entity_id = $1 AND supplier_entity_id = $2 AND party_no IS NULL`, [e, party_id, no]);
}

/* ── the handover packs ─────────────────────────────────────────────────────────────────────────────────────── */
async function lastPack(db, e) {
  const r = await db.query(`SELECT pack_id, sha256 FROM books_pack WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [e]);
  return r.rows[0] || null;
}
async function insertPack(db, e, p) {
  const r = await db.query(`INSERT INTO books_pack (pack_id, entity_id, kind, fiscal_year, period, created_by, sha256, prev_sha256, manifest, storage_path, delivered_at, delete_after)
                            VALUES ($11,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9, now(), $10) RETURNING pack_id, created_at`,
  [e, p.kind, p.fiscal_year || null, p.period == null ? null : p.period, p.by || null, p.sha256, p.prev_sha256 || null,
    JSON.stringify(p.manifest), p.storage_path || null, p.delete_after || null, p.pack_id]);
  return r.rows[0];
}
async function packs(db, e) {
  const r = await db.query(`SELECT pack_id, kind, fiscal_year, period, created_at, sha256, prev_sha256, storage_path, delivered_at, acknowledged_at, acknowledged_by, delete_after
                              FROM books_pack WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 200`, [e]);
  return r.rows;
}
async function pack(db, e, id) {
  const r = await db.query(`SELECT * FROM books_pack WHERE entity_id = $1 AND pack_id = $2`, [e, id]);
  return r.rows[0] || null;
}
async function ackPack(db, e, id, by) {
  const r = await db.query(`UPDATE books_pack SET acknowledged_at = COALESCE(acknowledged_at, now()), acknowledged_by = COALESCE(acknowledged_by, $3)
                             WHERE entity_id = $1 AND pack_id = $2 RETURNING acknowledged_at`, [e, id, by || null]);
  return r.rows[0] || null;
}

/** the bill numbers of some chits (a proposal shows the number on the customer's paper, not an id) */
async function billNos(db, e, ids) {
  const u = (ids || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!u.length) return {};
  const r = await db.query(`SELECT chit_id, COALESCE(business_json->>'printed_as', business_json->>'bill_no') AS no FROM chit_header WHERE entity_id = $1 AND chit_id = ANY($2::uuid[])`, [e, u]);
  const o = {}; r.rows.forEach((x) => { o[x.chit_id] = x.no; }); return o;
}

/* ── the chits the hooks read (a day's walk-in bills) ────────────────────────────────────────────────────────── */
/**
 * a counter's bills whose billed_at falls in [fromTs, toTs), with lines — the day summary's input.
 * ⚠️ ONLY BILLS I SENT (sender = me): a counter bill another shop billed ME carries ITS counter's id, which can equal one of
 * mine ('C2') — it is my purchase, never my walk-in sale (classify refuses it too; this keeps it out of the read).
 */
async function counterBills(db, e, counter, fromTs, toTs) {
  const r = await db.query(`SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json, h.summary_json, h.purpose, h.auto_subject, h.manual_subject,
                                   h.sent_at, h.created_at, d.line_items, d.currency_code
                              FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                             WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('order', 'offer', 'subscription')
                               AND h.business_json ? 'bill_no' AND h.business_json -> 'till' ->> 'id' = $2
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) >= $3::timestamptz
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) <  $4::timestamptz
                             ORDER BY h.created_at`, [e, counter, fromTs, toTs]);
  return r.rows;
}
/**
 * ⭐ the chits of [fromTs, toTs) that SHOULD have reached the ledger and did not (SPEC-books-v2 §6 "every chit of the day
 * posted"; critic M6): of a posting purpose, not a draft, with no entry of their own (chit: · bill: · walkin-late:), in no
 * walk-in day's list, no payment recorded from them, and not already on the waiting list. Oldest first, bounded.
 * ⚠️ created_at, not billed_at: the question is "did its hook run", and a free-text billed_at must not break the check (F8).
 */
async function unpostedChits(db, e, fromTs, toTs, limit) {
  const r = await db.query(`SELECT h.chit_id FROM chit_header h
                             WHERE h.entity_id = $1 AND h.role <> 'Draft' AND h.created_at >= $2::timestamptz AND h.created_at < $3::timestamptz
                               AND (h.purpose IN ('invoice', 'credit_note', 'expense', 'income')
                                    OR (h.purpose IN ('order', 'offer', 'subscription') AND h.business_json ? 'bill_no')
                                    OR (h.purpose = 'general' AND h.business_json ->> 'kind' = 'payment_received'))
                               AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $1
                                                  AND j.source_ref IN ('chit:' || h.chit_id::text, 'bill:' || h.chit_id::text, 'walkin-late:' || h.chit_id::text))
                               AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $1 AND j.source_chit_ids @> ARRAY[h.chit_id])
                               AND NOT EXISTS (SELECT 1 FROM books_payment p WHERE p.entity_id = $1 AND p.client_ref = 'chit:' || h.chit_id::text)
                               AND NOT EXISTS (SELECT 1 FROM books_outbox o WHERE o.entity_id = $1 AND o.done_at IS NULL AND o.source_chit_id = h.chit_id)
                             ORDER BY h.created_at LIMIT $4`, [e, fromTs, toTs, limit || 200]);
  return r.rows;
}
/**
 * the open disputes on a chit, as MY copy of chit_disputes shows them (per-copy since b68, entity_id + RLS) — a bill I
 * received waits while one is open (lib/books-hooks buyerGate). A failed read throws: the hook parks the bill with the
 * error, named — never read as "no dispute".
 */
async function openDisputes(db, e, chit_id) {
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM chit_disputes WHERE entity_id = $1 AND chit_id = $2 AND status = 'open'`, [e, chit_id]);
  return (r.rows[0] && r.rows[0].n) || 0;
}
/** the counters that billed in [fromTs, toTs) — the nightly catch-up for a day nobody closed */
async function countersBilling(db, e, fromTs, toTs) {
  const r = await db.query(`SELECT DISTINCT h.business_json -> 'till' ->> 'id' AS till FROM chit_header h
                             WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('order', 'offer', 'subscription') AND h.business_json ? 'bill_no'
                               AND h.business_json -> 'till' ->> 'id' IS NOT NULL
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) >= $2::timestamptz
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) <  $3::timestamptz`, [e, fromTs, toTs]);
  return r.rows.map((x) => x.till).filter(Boolean);
}

/* ── PR1 · THE PARALLEL-RUN SNAPSHOTS (b309 books_compare_part): their period as read from a Tally / Xero / QBO export — the shop's own paper, never posted.
   Insert-only (no UPDATE grant): a part once kept is what was compared; a fresh file is a fresh snapshot. Before b309 runs: compareReady() is false and the
   routes say so in words. One row per snapshot PART (tb · pl · bs · ret); the snapshot is the rows sharing a snapshot_id. ── */
const compareReady = () => require('./schema').hasTable('books_compare_part');
const COMPARE_HEAD = `snapshot_id, label, source, to_char(period_from, 'YYYY-MM-DD') AS period_from, to_char(period_to, 'YYYY-MM-DD') AS period_to, currency`;
/** the shop's snapshots, newest first: { snapshot_id, label, source, period_from, period_to, currency, parts: ['tb', …], lines, created_at } */
async function compareSnapshots(db, e) {
  const r = await db.query(`SELECT snapshot_id, min(label) AS label, min(source) AS source, to_char(min(period_from), 'YYYY-MM-DD') AS period_from, to_char(max(period_to), 'YYYY-MM-DD') AS period_to,
                                   min(currency) AS currency, array_agg(part ORDER BY part) AS parts, sum(jsonb_array_length(rows))::int AS lines, min(created_at) AS created_at
                              FROM books_compare_part WHERE entity_id = $1 GROUP BY snapshot_id ORDER BY min(created_at) DESC LIMIT 100`, [e]);
  return r.rows;
}
/** one snapshot's parts, each with its rows as read */
async function compareParts(db, e, snapshotId) {
  const r = await db.query(`SELECT part, ${COMPARE_HEAD}, file_name, rows, created_by, created_at FROM books_compare_part WHERE entity_id = $1 AND snapshot_id = $2 ORDER BY part`, [e, snapshotId]);
  return r.rows;
}
/** keep one part; null when the snapshot already has that part (insert-only — never replaced) */
async function insertComparePart(db, e, p) {
  const r = await db.query(`INSERT INTO books_compare_part (entity_id, snapshot_id, label, source, part, period_from, period_to, currency, file_name, rows, created_by)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) ON CONFLICT (entity_id, snapshot_id, part) DO NOTHING RETURNING part_id`,
  [e, p.snapshot_id, p.label, p.source, p.part, p.period_from || null, p.period_to, p.currency, p.file_name || null, JSON.stringify(p.rows || []), p.by || null]);
  return r.rows[0] ? r.rows[0].part_id : null;
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
async function rechart(db, e, rows, o) {
  const r = rows || [], col = (k) => r.map((x) => (x[k] == null ? null : x[k]));
  await db.query(`UPDATE ledger_account a SET name = v.name, is_group = v.is_group, nature = v.nature, role = v.role, tally_group = v.tally_group, sch3_line = v.sch3_line,
                    saft_grouping = v.saft_grouping, pack_code = $2, pack_version = $3, active = true,
                    parent_id = (SELECT p.account_id FROM ledger_account p WHERE p.entity_id = $1 AND p.code = v.parent_code)
                  FROM unnest($4::text[], $5::text[], $6::boolean[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[])
                    AS v(code, name, is_group, nature, role, parent_code, tally_group, sch3_line, saft_grouping)
                  WHERE a.entity_id = $1 AND a.code = v.code`,
  [e, (o && o.pack_code) || null, (o && o.pack_version) || null, col('code'), col('name'), r.map((x) => !!x.is_group), col('nature'), col('role'), col('parent_code'), col('tally_group'), col('sch3_line'), col('saft_grouping')]);
}
/** the one year's rows re-labelled by PERIOD NUMBER (0 = brought forward, 1–12): '2026-27' Jul–Jun → '2026' Jan–Dec — rows: [{ period, fiscal_year, start_date, end_date }] */
async function relabelPeriods(db, e, fromFy, rows) {
  const r = rows || [];
  await db.query(`UPDATE fiscal_period f SET fiscal_year = v.fiscal_year, start_date = v.start_date::date, end_date = v.end_date::date
                  FROM unnest($3::int[], $4::text[], $5::text[], $6::text[]) AS v(period, fiscal_year, start_date, end_date)
                  WHERE f.entity_id = $1 AND f.fiscal_year = $2 AND f.period = v.period`,
  [e, fromFy, r.map((x) => Number(x.period)), r.map((x) => x.fiscal_year), r.map((x) => x.start_date), r.map((x) => x.end_date)]);
}

module.exports = { BILL_EVENTS, ZERO, lockParty, setting, saveSetting, saveCheck, accounts, insertAccount, parkChart, rechart, relabelPeriods, setSourceCode,
  periods, periodFigures, insertPeriod, setPeriodStatus, nextNo, entryBySource, postedSources, entry, entryLines, entryPage, entries, taxEntryLines, pageSums, PAGE_MAX, PAGE_DEFAULT, yearRows, ledgerLines,
  years, insertEntry, insertLines, fxLinesReady, foreignBalances, fxRatesReady, fxRates, insertFxRates, fxRateOn, partyNames, addBalances,
  insertItems, periodSums, lineSums, firstYear, balanceDrift, unbalancedEntries, items, itemOwners, itemTotals, accountNet, insertPayment,
  paymentByRef, paymentsSince, cheques, payment, queue, waiting, waitingCount, outboxDone, outboxClose, logChange, changes, TODO_SQL, NAME_SQL, waitOfChitSql,
  backfillTodo,
  adviceReady, paymentsAdvice, setAdvice, adviceStates, paymentsNeedingAdvice, shopName, bankRailChits,
  terms, parties, partyOn, supplierByName, partyNoOf, billNos, setPartyNo, lastPack, insertPack, packs, pack, ackPack, counterBills, countersBilling, unpostedChits, openDisputes,
  compareReady, compareSnapshots, compareParts, insertComparePart };
