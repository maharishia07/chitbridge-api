// @stage tested
// @stage-note [BOOKS v2] Every SQL statement the books make, on a handle the caller opened with withEntity (so FORCE RLS
// @stage-note holds). The WRITES to the journal tables are called from lib/books.js postEntry() only — tests/books-writer.
'use strict';
/**
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
  const r = await db.query(`SELECT entity_id, enabled, walkin_grain, fy_start_month, functional_currency, country, pack_version,
                                   enabled_at, last_check FROM books_setting WHERE entity_id = $1`, [e]);
  return r.rows[0] || null;
}
async function saveSetting(db, e, s) {
  await db.query(`INSERT INTO books_setting (entity_id, enabled, walkin_grain, fy_start_month, functional_currency, country, pack_version, enabled_at, enabled_by, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $2 THEN now() END, $8, now())
                  ON CONFLICT (entity_id) DO UPDATE SET enabled = EXCLUDED.enabled, walkin_grain = EXCLUDED.walkin_grain,
                    fy_start_month = EXCLUDED.fy_start_month, functional_currency = EXCLUDED.functional_currency,
                    country = EXCLUDED.country, pack_version = COALESCE(EXCLUDED.pack_version, books_setting.pack_version),
                    enabled_at = COALESCE(books_setting.enabled_at, EXCLUDED.enabled_at),
                    enabled_by = COALESCE(books_setting.enabled_by, EXCLUDED.enabled_by), updated_at = now()`,
  [e, !!s.enabled, s.walkin_grain || 'day', s.fy_start_month || 4, s.functional_currency || 'INR', s.country || 'IN', s.pack_version || null, s.by || null]);
}
async function saveCheck(db, e, result) {
  await db.query(`UPDATE books_setting SET last_check = $2::jsonb WHERE entity_id = $1`, [e, JSON.stringify(result)]);
}

/* ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────── */
async function accounts(db, e) {
  const r = await db.query(`SELECT account_id, code, name, parent_id, is_group, nature, role, tally_group, sch3_line, saft_grouping, currency, active
                              FROM ledger_account WHERE entity_id = $1 ORDER BY code`, [e]);
  return r.rows;
}
async function insertAccount(db, e, a) {
  const r = await db.query(`INSERT INTO ledger_account (entity_id, code, name, parent_id, is_group, nature, role, pack_code, pack_version,
                                                        tally_group, sch3_line, saft_grouping, currency, created_by)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                            ON CONFLICT (entity_id, code) DO NOTHING RETURNING account_id`,
  [e, a.code, a.name, a.parent_id || null, !!a.is_group, a.nature, a.role || null, a.pack_code || null, a.pack_version || null,
    a.tally_group || null, a.sch3_line || null, a.saft_grouping || null, a.currency || null, a.by || null]);
  return r.rows[0] ? r.rows[0].account_id : null;
}

/* ── periods ────────────────────────────────────────────────────────────────────────────────────────────────── */
async function periods(db, e, fy) {
  const r = await db.query(`SELECT fiscal_year, period, start_date, end_date, status, locked_by, locked_at, reason FROM fiscal_period
                             WHERE entity_id = $1 AND ($2::text IS NULL OR fiscal_year = $2) ORDER BY fiscal_year, period`, [e, fy || null]);
  return r.rows;
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
async function nextNo(db, e, series, fy) {
  const r = await db.query(`INSERT INTO books_counter (entity_id, series, fiscal_year, next_no) VALUES ($1, $2, $3, 2)
                            ON CONFLICT (entity_id, series, fiscal_year) DO UPDATE SET next_no = books_counter.next_no + 1
                            RETURNING next_no - 1 AS n`, [e, series, fy || '-']);
  return Number(r.rows[0].n);
}

/* ── the journal: reads ─────────────────────────────────────────────────────────────────────────────────────── */
async function entryBySource(db, e, ref) {
  const r = await db.query(`SELECT entry_id, entry_no, posting_date, doc_date, created_at FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`, [e, ref]);
  return r.rows[0] || null;
}
async function entry(db, e, id) {
  const h = await db.query(`SELECT * FROM journal_entry WHERE entity_id = $1 AND entry_id = $2`, [e, id]);
  if (!h.rows[0]) return null;
  const l = await db.query(`SELECT * FROM journal_line WHERE entity_id = $1 AND entry_id = $2 ORDER BY line_no`, [e, id]);
  const i = await db.query(`SELECT * FROM party_item WHERE entity_id = $1 AND entry_id = $2 ORDER BY item_id`, [e, id]);
  return Object.assign({}, h.rows[0], { lines: l.rows, items: i.rows });
}
async function entryLines(db, e, from, to, account_id, party_id) {
  const r = await db.query(`SELECT h.entry_id, h.entry_no, h.posting_date, h.doc_date, h.event_type, h.narration, h.source_chit_id, h.reverses_entry_id,
                                   l.line_no, l.account_id, a.code, a.name AS account_name, l.party_id, l.dr_minor, l.cr_minor, l.currency, l.counter_id
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id
                              JOIN ledger_account a ON a.account_id = l.account_id
                             WHERE l.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date
                               AND ($4::uuid IS NULL OR l.account_id = $4) AND ($5::uuid IS NULL OR l.party_id = $5)
                             ORDER BY h.posting_date, h.entry_no, l.line_no`, [e, from, to, account_id || null, party_id || null]);
  return r.rows;
}
async function entries(db, e, from, to) {
  const r = await db.query(`SELECT entry_id, entry_no, posting_date, doc_date, fiscal_year, period, event_type, narration, source_chit_id, source_ref,
                                   reverses_entry_id, is_opening, total_minor, currency, created_by, created_at
                              FROM journal_entry WHERE entity_id = $1 AND posting_date >= $2::date AND posting_date <= $3::date
                             ORDER BY posting_date, entry_no`, [e, from, to]);
  return r.rows;
}

/* ── the journal: THE FOUR WRITES (postEntry only) ───────────────────────────────────────────────────────────── */
async function insertEntry(db, e, h) {
  const r = await db.query(`INSERT INTO journal_entry (entity_id, entry_no, series, posting_date, doc_date, fiscal_year, period, source_chit_id, source_ref,
                                                       event_type, rule_version, reverses_entry_id, is_opening, narration, currency, total_minor, created_by)
                            VALUES ($1,$2,'JV',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                            RETURNING entry_id, created_at`,
  [e, h.entry_no, h.posting_date, h.doc_date || null, h.fiscal_year, h.period, h.source_chit_id || null, h.source_ref || null,
    h.event_type, h.rule_version || null, h.reverses_entry_id || null, !!h.is_opening, h.narration || null, h.currency, h.total_minor, h.created_by || null]);
  return r.rows[0];
}
async function insertLines(db, e, entry_id, lines) {
  if (!lines.length) return;
  const vals = [], args = [];
  lines.forEach((l, i) => {
    const b = i * 12;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`);
    args.push(e, entry_id, l.line_no, l.account_id, l.party_id || null, l.dr_minor, l.cr_minor, l.currency,
      l.amount_txn_minor == null ? null : l.amount_txn_minor, l.fx_rate || 1, l.counter_id || null, l.tax_rate || null);
  });
  await db.query(`INSERT INTO journal_line (entity_id, entry_id, line_no, account_id, party_id, dr_minor, cr_minor, currency,
                                            amount_txn_minor, fx_rate, counter_id, tax_rate) VALUES ${vals.join(',')}`, args);
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
async function yearRows(db, e, fy) {
  const r = await db.query(`SELECT b.fiscal_year, b.period, a.code, b.party_key, b.dr_minor, b.cr_minor FROM account_balance b
                              JOIN ledger_account a ON a.account_id = b.account_id
                             WHERE b.entity_id = $1 AND b.fiscal_year = $2`, [e, fy]);
  return r.rows;
}
/** the journal lines posted in [from, to], with code and entry — CBLedger's `lines` */
async function ledgerLines(db, e, from, to, party_id) {
  const r = await db.query(`SELECT h.entry_id, h.entry_no, h.posting_date, h.fiscal_year, h.period, h.is_opening, h.source_ref, h.narration,
                                   h.source_chit_id, h.event_type, l.line_no, a.code, l.party_id, l.dr_minor, l.cr_minor, l.currency
                              FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
                             WHERE l.entity_id = $1 AND h.posting_date >= $2::date AND h.posting_date <= $3::date AND ($4::uuid IS NULL OR l.party_id = $4)
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
async function items(db, e, party_id, account_id) {
  const r = await db.query(`SELECT item_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency, due_date, doc_date,
                                   status, reverses, reverses_kind, entry_id, payment_id, note, created_at FROM party_item
                             WHERE entity_id = $1 AND ($2::uuid IS NULL OR party_id = $2) AND ($3::uuid IS NULL OR account_id = $3)
                             ORDER BY created_at, item_id`, [e, party_id || null, account_id || null]);
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
async function payment(db, e, id) {
  const r = await db.query(`SELECT * FROM books_payment WHERE entity_id = $1 AND payment_id = $2`, [e, id]);
  return r.rows[0] ? Object.assign({}, r.rows[0], { amount_minor: n(r.rows[0].amount_minor) }) : null;
}

/* ── the waiting list ───────────────────────────────────────────────────────────────────────────────────────── */
async function queue(db, e, o) {
  await db.query(`INSERT INTO books_outbox (entity_id, source_chit_id, source_ref, event, why) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [e, o.source_chit_id || null, o.source_ref || null, JSON.stringify(o.event || {}), String(o.why || '').slice(0, 500)]);
}
async function waiting(db, e, limit) {
  const r = await db.query(`SELECT id, source_chit_id, source_ref, event, why, tries, created_at FROM books_outbox
                             WHERE entity_id = $1 AND done_at IS NULL ORDER BY id LIMIT $2`, [e, limit || 100]);
  return r.rows;
}
async function outboxDone(db, e, id, ok, why) {
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
async function parties(db, e) {
  const r = await db.query(`SELECT i.identity_id AS party_id, i.display_name, i.user_id, i.gstn,
                                   c.party_no AS c_no, s.party_no AS s_no, c.nickname AS c_nick, s.nickname AS s_nick,
                                   COALESCE(c.legal_name, s.legal_name) AS legal_name, (c.customer_identity_id IS NOT NULL) AS customer,
                                   (s.supplier_entity_id IS NOT NULL) AS supplier, c.credit_days AS c_days, s.credit_days AS s_days,
                                   c.credit_limit_minor AS c_limit, s.credit_limit_minor AS s_limit, COALESCE(c.state_code, s.state_code) AS state_code
                              FROM identities i
                              LEFT JOIN customer_list c ON c.owner_entity_id = $1 AND c.customer_identity_id = i.identity_id
                              LEFT JOIN supplier_list s ON s.owner_entity_id = $1 AND s.supplier_entity_id = i.identity_id
                             WHERE c.customer_identity_id IS NOT NULL OR s.supplier_entity_id IS NOT NULL`, [e]);
  return r.rows.map((x) => ({ party_id: x.party_id, party_no: x.c_no || x.s_no || null, name: x.display_name, nickname: x.c_nick || x.s_nick || null,
    legal_name: x.legal_name, user_id: x.user_id, customer: x.customer, supplier: x.supplier, credit_days: x.c_days != null ? x.c_days : x.s_days,
    credit_limit_minor: x.c_limit != null ? n(x.c_limit) : (x.s_limit != null ? n(x.s_limit) : null), state_code: x.state_code, gstin: x.gstn || null }));
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
/** a counter's bills whose billed_at falls in [fromTs, toTs), with lines — the day summary's input */
async function counterBills(db, e, counter, fromTs, toTs) {
  const r = await db.query(`SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json, h.summary_json, h.purpose, h.auto_subject, h.manual_subject,
                                   h.sent_at, h.created_at, d.line_items, d.currency_code
                              FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                             WHERE h.entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('order', 'offer', 'subscription')
                               AND h.business_json ? 'bill_no' AND h.business_json -> 'till' ->> 'id' = $2
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) >= $3::timestamptz
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) <  $4::timestamptz
                             ORDER BY h.created_at`, [e, counter, fromTs, toTs]);
  return r.rows;
}
/** the counters that billed in [fromTs, toTs) — the nightly catch-up for a day nobody closed */
async function countersBilling(db, e, fromTs, toTs) {
  const r = await db.query(`SELECT DISTINCT h.business_json -> 'till' ->> 'id' AS till FROM chit_header h
                             WHERE h.entity_id = $1 AND h.role <> 'Draft' AND h.purpose IN ('order', 'offer', 'subscription') AND h.business_json ? 'bill_no'
                               AND h.business_json -> 'till' ->> 'id' IS NOT NULL
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) >= $2::timestamptz
                               AND COALESCE((h.business_json ->> 'billed_at')::timestamptz, h.created_at) <  $3::timestamptz`, [e, fromTs, toTs]);
  return r.rows.map((x) => x.till).filter(Boolean);
}

module.exports = { ZERO, setting, saveSetting, saveCheck, accounts, insertAccount, periods, insertPeriod, setPeriodStatus, nextNo,
  entryBySource, entry, entryLines, entries, yearRows, ledgerLines, years, insertEntry, insertLines, addBalances, insertItems, periodSums, lineSums, firstYear,
  balanceDrift, unbalancedEntries, items, itemOwners, itemTotals, accountNet, insertPayment, payment, queue, waiting, outboxDone, logChange, changes,
  terms, parties, partyNoOf, billNos, setPartyNo, lastPack, insertPack, packs, pack, ackPack, counterBills, countersBilling };
