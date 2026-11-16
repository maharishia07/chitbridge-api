'use strict';
/**
 * lib/books-evidence.js — THE EVIDENCE BEHIND A BOOKS ROW: the source document and the files held on it, for the Day book and the ledger, and the door that serves one of those files.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      attach(h, items, opt) · isEvidence(h, entity, id) · unsupportedIn(h, entity, ctx, from, to) (the BAS page's "claimed with no tax invoice" total) · the "No tax invoice" flag (a read of the pack's own answer, never a number here)
 * CALLED BY routes/books.js (GET /daybook · GET /ledger/:account · GET /evidence/:id) · tests/books-evidence.test.cjs
 * FLOW      a page of entries/lines ──▶ their source chit ids ──▶ ONE read of the document files of those chits in the list's own transaction (storage.listForChits) ──▶ each item gets `evidence`
 *           a file id ──▶ one query: the file sits on a chit that is the source (source_chit_id or source_chit_ids) of an entry of THIS entity ──▶ then storage.getBlob(documentsOnly) in the route
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * ⭐ evidence = { doc: { chit_id, ref } | null, files: [{ id, name, mime, size }], count, flag: null | 'no_tax_invoice', flag_why?, cite?, cite_status? }. No bytes, no object key, no message's file (a note or a dispute file is never evidence).
 * ⭐ THE FLAG: an expense or purchase bill, not reversed, that carries input tax on the pack's own tax ledger, in the pack's currency, whose gross (the Dr side of its own lines) needs a tax invoice by the pack (books-bank-tax.taxInvoiceOn, on the
 *    entry's own day), with no file on its source. It says so and cites the pack's own row; the row's wording is the pack's (unconfirmed until cb-country reads the ATO page): this file asserts no law.
 * ⚠️ NO MONEY IS CHANGED: this reads; the rows, sums and counts of the list are not touched (one extra SELECT, never a JOIN into the page query).
 */
const storage = require('./storage');
const tax = require('./books-bank-tax');

const CLAIMING = new Set(['expense', 'purchase_bill']);
const SHOWN = 20; /* names a row carries; `count` is the whole number */
const ymd = (value) => (value == null ? null : require('./books-engines').ymd(value)); /* a `date` column reaches here as a Date at local midnight: the ONE date reader, never String(date).slice (that read 'Sat Oct 03' and no claim was ever flagged on the return or the Pay sheet) */

/** the pack's input-tax ledger roles (AU: gst_paid): the lines that mean "a credit is claimed" */
function inputRoles(pack) {
  const out = new Set();
  Object.values((pack && pack.taxLedgers) || {}).forEach((head) => head && head.input && out.add(head.input));
  return out;
}

/** the flag of one entry, or null: see the header. `lines` are its raw rows (account_role, dr_minor) */
function flagOf(entry, lines, files, ctx) {
  if (files.length || !ctx.pack || !CLAIMING.has(entry.event_type) || entry.reverses_entry_id || entry.reversed_by_id) return null;
  if (ctx.cur !== ctx.pack.currency) return null; /* the pack's threshold is in its own currency: another currency is not assessed, never guessed */
  const roles = inputRoles(ctx.pack);
  if (!lines.some((line) => roles.has(line.account_role) && Number(line.dr_minor) > 0)) return null;
  const gross = lines.reduce((sum, line) => sum + Number(line.dr_minor), 0);
  const rule = tax.taxInvoiceOn(ctx.pack, gross, ymd(entry.doc_date) || ymd(entry.posting_date));
  if (!rule || !rule.required) return null;
  const row = ((ctx.pack.tax && ctx.pack.tax.taxInvoice && ctx.pack.tax.taxInvoice.rows) || []).slice(-1)[0] || {};
  return { flag: 'no_tax_invoice', flag_why: 'GST is claimed on this purchase and no tax invoice is held on it.', cite: rule.cite, cite_status: row.status || null };
}

/**
 * attach(h, items, opt) → sets `evidence` on each item. items: [{ item, chit_id, ref, entry? , lines? }] built by the caller (the Day book groups raw lines per entry; the ledger has one line per item).
 * opt = { pack, cur, flag: boolean } · `h` is the list's open handle. ONE read for the whole page.
 */
async function attach(h, items, opt) {
  const ids = [...new Set(items.map((x) => x.chit_id).filter(Boolean).map(String))];
  const found = ids.length ? await storage.listForChits(ids, h) : [];
  const byChit = new Map();
  found.forEach((row) => {
    const list = byChit.get(String(row.chit_id)) || [];
    list.push({ id: row.id, name: row.name, mime: row.mime, size: row.size });
    byChit.set(String(row.chit_id), list);
  });
  for (const x of items) {
    const files = x.chit_id ? byChit.get(String(x.chit_id)) || [] : [];
    /* a walk-in day has no chit of its own but IS sourced: the counter bills it covers (source.count) — the source is carried, never "no source" */
    const walkin = !x.chit_id && x.source && Number(x.source.count) > 0 ? Number(x.source.count) : 0;
    const evidence = { doc: x.chit_id ? { chit_id: x.chit_id, ref: x.ref || null } : walkin ? { chit_id: null, ref: null, covers: walkin } : null, files: files.slice(0, SHOWN), count: files.length, flag: null };
    if (opt.flag && x.entry) Object.assign(evidence, flagOf(x.entry, x.lines || [], files, opt) || {});
    x.item.evidence = evidence;
  }
}

/**
 * isEvidence(h, entity, id) → true when the file is a DOCUMENT file (no message's) on a chit that is the source of an entry of this entity. The caller then reads the bytes with storage.getBlob(id, entity, { documentsOnly: true }) (its own handle,
 * after this one closed: no nested transaction). The same answer for a file that is not there and one that is not evidence: no oracle. cb_attachment is per-entity RLS, and `entity_id = $2` is asked again.
 */
async function isEvidence(h, entity, id) {
  const ok = await h.query(
    `SELECT 1 FROM cb_attachment a
      WHERE a.id = $1 AND a.entity_id = $2 AND a.message_id IS NULL AND a.chit_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $2 AND (j.source_chit_id = a.chit_id OR a.chit_id = ANY(j.source_chit_ids))) LIMIT 1`,
    [id, entity]
  );
  return ok.rows.length > 0;
}

/**
 * unsupportedIn(h, entity, ctx, from, to) → { count, tax_minor, from, to, currency }: the entries of [from, to] that carry THE SAME flag as the Day book (flagOf, one rule) and the input tax they claim (the Dr side of the pack's input-tax ledger on them).
 * It carries, never recomputes: the tax is the posted line, the flag is the pack's answer. Read-only; the return's own figures are not touched. ctx = { pack, cur }.
 */
async function unsupportedIn(h, entity, ctx, from, to) {
  const S = require('./books-store');
  const rows = (await S.entryLines(h, entity, from, to, null, null)).filter((line) => CLAIMING.has(line.event_type));
  const byEntry = new Map();
  rows.forEach((line) => (byEntry.get(line.entry_id) || byEntry.set(line.entry_id, []).get(line.entry_id)).push(line));
  const items = [...byEntry.values()].map((lines) => ({ item: {}, chit_id: lines[0].source_chit_id, ref: lines[0].source_ref, entry: lines[0], lines }));
  await attach(h, items, { pack: ctx.pack, cur: ctx.cur, flag: true });
  const roles = inputRoles(ctx.pack);
  const out = { count: 0, tax_minor: 0, from, to, currency: ctx.cur };
  items.forEach((x) => {
    if (!x.item.evidence || x.item.evidence.flag !== 'no_tax_invoice') return;
    out.count += 1;
    out.tax_minor += x.lines.filter((line) => roles.has(line.account_role)).reduce((sum, line) => sum + Number(line.dr_minor), 0);
  });
  return out;
}

/**
 * ⭐ NEEDS ATTENTION (W15-102) — the Day book's evidence states COUNTED ON THE SERVER over a range, and the entries behind each count, newest first, a page at a time.
 * The states are CBEvidence.stateOf's, in its order: flag (no tax invoice — flagOf, the pack's own answer) · nodoc (no source document) · none (a source, no file held) · open queries (the reviewer's open marks).
 * attentionIn(h, entity, ctx, from, to, kind?, pg?) → { from, to, total, no_tax_invoice, no_file, no_source, open_queries (null while marking is off) }
 *   with kind ('flag' | 'none' | 'nodoc' | 'query') the same envelope plus { kind, entries: [{ entry_id, entry_no, posting_date, event_type, narration, total_minor }], count, page, limit }.
 * ctx = { pack, cur, queryIds } — queryIds(h, from, to) → the entry ids of the open queries (the marks module's own read), or null.
 * NEVER LOAD ALL: the other states are SQL counts; only entries that could carry the flag (an expense or a purchase bill, no file, in the range) are read with their lines; a list is a page.
 * Opening entries are not evidence work and are left out of every count.
 */
const ATTENTION_FROM = `FROM journal_entry je
   LEFT JOIN LATERAL (SELECT x.chit_id FROM chit_header x WHERE x.entity_id = je.entity_id AND x.chit_id = je.source_chit_id LIMIT 1) ch ON true
  WHERE je.entity_id = $1 AND je.posting_date >= $2::date AND je.posting_date <= $3::date AND je.is_opening IS NOT TRUE`;
const HELD = 'EXISTS (SELECT 1 FROM cb_attachment a WHERE a.chit_id = je.source_chit_id AND a.message_id IS NULL)';
const ATTENTION_KINDS = {
  flag: 'je.entry_id = ANY($4::uuid[])',
  nodoc: 'ch.chit_id IS NULL AND COALESCE(cardinality(je.source_chit_ids), 0) = 0 AND NOT (je.entry_id = ANY($4::uuid[]))', /* a walk-in day (it covers counter bills) is sourced */
  none: `(ch.chit_id IS NOT NULL OR COALESCE(cardinality(je.source_chit_ids), 0) > 0) AND NOT ${HELD} AND NOT (je.entry_id = ANY($4::uuid[]))`,
  query: 'je.entry_id = ANY($5::uuid[])',
  needs: '(je.entry_id = ANY($4::uuid[]) OR je.entry_id = ANY($5::uuid[]))' /* W15-116: what wants the owner — no tax invoice, or an open query (the quiet states, no file / no source, are not asks) */
};

/** the entries that carry the flag: the Day book's own rule (flagOf), asked of the few entries that could. `scope` = the SQL for which entries (a date range, or the given ids) */
async function flaggedBy(h, entity, ctx, scope, params) {
  if (!ctx.pack) return [];
  const found = await h.query(
    `SELECT je.entry_id, je.event_type, je.doc_date, je.posting_date, je.reverses_entry_id,
            (SELECT x.entry_id FROM journal_entry x WHERE x.entity_id = je.entity_id AND x.reverses_entry_id = je.entry_id LIMIT 1) AS reversed_by_id,
            a.role AS account_role, l.dr_minor
       FROM journal_entry je JOIN journal_line l ON l.entity_id = je.entity_id AND l.entry_id = je.entry_id JOIN ledger_account a ON a.account_id = l.account_id
      WHERE je.entity_id = $1 AND ${scope} AND je.event_type = ANY($2::text[]) AND NOT ${HELD}`,
    [entity, [...CLAIMING]].concat(params)
  );
  const byEntry = new Map();
  found.rows.forEach((row) => (byEntry.get(String(row.entry_id)) || byEntry.set(String(row.entry_id), []).get(String(row.entry_id))).push(row));
  return [...byEntry.entries()].filter(([, lines]) => flagOf(lines[0], lines, [], ctx)).map(([id]) => id);
}
const flaggedIds = (h, entity, ctx, from, to) => flaggedBy(h, entity, ctx, 'je.posting_date >= $3::date AND je.posting_date <= $4::date', [from, to]);
/** W15-114: which of THESE entries carry the flag (the open bills of a supplier) — the same rule, asked of the ids a list already holds, never of a range */
const flaggedAmong = (h, entity, ctx, ids) => (ids.length ? flaggedBy(h, entity, ctx, 'je.entry_id = ANY($3::uuid[])', [ids]) : Promise.resolve([]));

async function attentionIn(h, entity, ctx, from, to, kind, pg) {
  const flagged = await flaggedIds(h, entity, ctx, from, to),
    queries = ctx.queryIds ? await ctx.queryIds(h, from, to) : null;
  const counted = (
    await h.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE ${ATTENTION_KINDS.nodoc})::int AS nodoc,
              count(*) FILTER (WHERE ${ATTENTION_KINDS.none})::int AS none
         ${ATTENTION_FROM}`,
      [entity, from, to, flagged]
    )
  ).rows[0];
  const out = { from, to, total: counted.total, no_tax_invoice: flagged.length, no_file: counted.none, no_source: counted.nodoc, open_queries: queries ? queries.length : null, needs: new Set(flagged.concat(queries || [])).size };
  if (!kind || !ATTENTION_KINDS[kind]) return out;
  const limit = (pg && pg.limit) || 25,
    page = (pg && pg.page) || 1;
  const listed = await h.query(
    `SELECT je.entry_id, je.entry_no, je.posting_date, je.event_type, je.narration, je.total_minor, count(*) OVER () AS total_rows
       ${ATTENTION_FROM} AND ${ATTENTION_KINDS[kind]} AND cardinality($4::uuid[]) >= 0 AND cardinality($5::uuid[]) >= 0 ORDER BY je.posting_date DESC, je.entry_no DESC LIMIT $6 OFFSET $7`,
    [entity, from, to, flagged, queries || [], limit, (page - 1) * limit]
  );
  return Object.assign(out, {
    kind,
    entries: listed.rows.map((row) => ({ entry_id: row.entry_id, entry_no: row.entry_no, posting_date: ymd(row.posting_date), event_type: row.event_type, narration: row.narration, total_minor: Number(row.total_minor) })),
    count: listed.rows.length ? Number(listed.rows[0].total_rows) : 0,
    page,
    limit
  });
}

module.exports = { attach, isEvidence, flagOf, unsupportedIn, inputRoles, attentionIn, flaggedAmong };
