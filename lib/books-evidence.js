'use strict';
/**
 * lib/books-evidence.js — THE EVIDENCE BEHIND A BOOKS ROW: the source document and the files held on it, for the Day book and the ledger, and the door that serves one of those files.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      attach(handle, items, opt) · isEvidence(handle, entity, id) · unsupportedIn(handle, entity, ctx, from, to) (the BAS page's "claimed with no tax invoice" total) · the "No tax invoice" flag (a read of the pack's own answer, never a number here)
 * CALLED BY routes/books.js (GET /daybook · GET /ledger/:account · GET /evidence/:id) · tests/books-evidence.test.cjs
 * FLOW      a page of entries/lines ──▶ their source chit ids ──▶ ONE read of the document files of those chits in the list's own transaction (storage.listForChits) ──▶ each item gets `evidence`
 *           a file id ──▶ one query: the file sits on a chit that is the source (source_chit_id or source_chit_ids) of an entry of THIS entity ──▶ then storage.getBlob(documentsOnly) in the route
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * ⭐ evidence = { doc: { chit_id, ref } | null, files: [{ id, name, mime, size }], count, flag: null | 'no_tax_invoice', flag_why?, cite?, cite_status? }. No bytes, no object key, no message's file (a note or a dispute file is never evidence).
 * ⭐ THE FLAG: an expense or purchase bill, not reversed, that carries input tax on the pack's own tax ledger, in the pack's currency, whose gross (the Dr side of its own lines) needs a tax invoice by the pack (books-bank-BankTax.taxInvoiceOn, on the
 *    entry's own day), with no file on its source. It says so and cites the pack's own row; the row's wording is the pack's (unconfirmed until cb-country reads the ATO page): this file asserts no law.
 * ⚠️ NO MONEY IS CHANGED: this reads; the rows, sums and counts of the list are not touched (one extra SELECT, never a JOIN into the page query).
 */
const storage = require('./storage');
const BankTax = require('./books-bank-tax');

const CLAIMING = new Set(['expense', 'purchase_bill']);
const SHOWN = 20; /* names a row carries; `count` is the whole number */
const dayText = (value) => (value == null ? null : require('./books-engines').ymd(value)); /* a `date` column reaches here as a Date at local midnight: the ONE date reader, never String(date).slice (that read 'Sat Oct 03' and no claim was ever flagged on the return or the Pay sheet) */

/** the pack's input-tax ledger roles (AU: gst_paid): the lines that mean "a credit is claimed" */
function inputRoles(pack) {
  const out = new Set();
  Object.values((pack && pack.taxLedgers) || {}).forEach((head) => head && head.input && out.add(head.input));
  return out;
}

/** may this entry be assessed for the flag: an expense or purchase bill, not reversed, with no file on its source, in the pack's own currency (the pack's threshold is in that currency: another is not assessed, never guessed) */
function assessable(entry, files, ctx) {
  if (files.length || !ctx.pack || !CLAIMING.has(entry.event_type) || entry.reverses_entry_id || entry.reversed_by_id) return false;
  return ctx.cur === ctx.pack.currency;
}
/** does the entry claim input tax: a line on the pack's input-tax ledger with a debit */
function claimsInput(lines, pack) {
  const roles = inputRoles(pack);
  return lines.some((line) => roles.has(line.account_role) && Number(line.dr_minor) > 0);
}
/** the flag of one entry, or null: see the header. `lines` are its raw rows (account_role, dr_minor) */
function flagOf(entry, lines, files, ctx) {
  if (!assessable(entry, files, ctx) || !claimsInput(lines, ctx.pack)) return null;
  const gross = require('./books-money-ops').sumMinor(lines, ctx.cur, (line) => line.dr_minor); /* the entry's Dr side, in the pack's currency (CUR-1) */
  const rule = BankTax.taxInvoiceOn(ctx.pack, gross, dayText(entry.doc_date) || dayText(entry.posting_date));
  return rule && rule.required ? flagWords(ctx.pack, rule) : null;
}
/** the flag and the pack's own words for it: the tax named, the citation and its status (the row's wording is the pack's) */
function flagWords(pack, rule) {
  const row = ((pack.tax && pack.tax.taxInvoice && pack.tax.taxInvoice.rows) || []).slice(-1)[0] || {};
  return { flag: 'no_tax_invoice', flag_why: require('./pack-words').wordsFor(pack).taxName + ' is claimed on this purchase and no tax invoice is held on it.', cite: rule.cite, cite_status: row.status || null };
}

/** the files found for a page, grouped by the chit they sit on: Map(chit → [{ id, name, mime, size }]) */
function filesByChit(found) {
  const byChit = new Map();
  found.forEach((row) => {
    const list = byChit.get(String(row.chit_id)) || [];
    list.push({ id: row.id, name: row.name, mime: row.mime, size: row.size });
    byChit.set(String(row.chit_id), list);
  });
  return byChit;
}
/** how many counter bills a walk-in day covers (it has no chit of its own but IS sourced); 0 for an item with a chit or no cover */
const walkInCover = (item) => (!item.chit_id && item.source && Number(item.source.count) > 0 ? Number(item.source.count) : 0);
/** the source document of an item: its chit, else the walk-in day's cover count, else none */
function docOf(item, walkin) {
  if (item.chit_id) return { chit_id: item.chit_id, ref: item.ref || null };
  return walkin ? { chit_id: null, ref: null, covers: walkin } : null;
}

/**
 * attach(handle, items, opt) → sets `evidence` on each item. items: [{ item, chit_id, ref, entry? , lines? }] built by the caller (the Day book groups raw lines per entry; the ledger has one line per item).
 * opt = { pack, cur, flag: boolean } · `handle` is the list's open handle. ONE read for the whole page.
 */
async function attach(handle, items, opt) {
  const ids = [...new Set(items.map((x) => x.chit_id).filter(Boolean).map(String))];
  const byChit = filesByChit(ids.length ? await storage.listForChits(ids, handle) : []);
  for (const x of items) {
    const files = x.chit_id ? byChit.get(String(x.chit_id)) || [] : [];
    /* a walk-in day has no chit of its own but IS sourced: the counter bills it covers (source.count) — the source is carried, never "no source" */
    const walkin = walkInCover(x);
    const evidence = { doc: docOf(x, walkin), files: files.slice(0, SHOWN), count: files.length, flag: null };
    if (opt.flag && x.entry) Object.assign(evidence, flagOf(x.entry, x.lines || [], files, opt) || {});
    x.item.evidence = evidence;
  }
}

/**
 * isEvidence(handle, entity, id) → true when the file is a DOCUMENT file (no message's) on a chit that is the source of an entry of this entity. The caller then reads the bytes with storage.getBlob(id, entity, { documentsOnly: true }) (its own handle,
 * after this one closed: no nested transaction). The same answer for a file that is not there and one that is not evidence: no oracle. cb_attachment is per-entity RLS, and `entity_id = $2` is asked again.
 */
async function isEvidence(handle, entity, id) {
  const ok = await handle.query(
    `SELECT 1 FROM cb_attachment a
      WHERE a.id = $1 AND a.entity_id = $2 AND a.message_id IS NULL AND a.chit_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $2 AND (j.source_chit_id = a.chit_id OR a.chit_id = ANY(j.source_chit_ids))) LIMIT 1`,
    [id, entity]
  );
  return ok.rows.length > 0;
}

/**
 * unsupportedIn(handle, entity, ctx, from, to) → { count, tax_minor, from, to, currency }: the entries of [from, to] that carry THE SAME flag as the Day book (flagOf, one rule) and the input tax they claim (the Dr side of the pack's input-tax ledger on them).
 * It carries, never recomputes: the tax is the posted line, the flag is the pack's answer. Read-only; the return's own figures are not touched. ctx = { pack, cur }.
 */
async function unsupportedIn(handle, entity, ctx, from, to) {
  const Store = require('./books-store');
  const rows = (await Store.entryLines(handle, entity, from, to, null, null)).filter((line) => CLAIMING.has(line.event_type));
  const byEntry = new Map();
  rows.forEach((line) => (byEntry.get(line.entry_id) || byEntry.set(line.entry_id, []).get(line.entry_id)).push(line));
  const items = [...byEntry.values()].map((lines) => ({ item: {}, chit_id: lines[0].source_chit_id, ref: lines[0].source_ref, entry: lines[0], lines }));
  await attach(handle, items, { pack: ctx.pack, cur: ctx.cur, flag: true });
  const roles = inputRoles(ctx.pack);
  const engines = require('./books-money-ops');
  const out = { count: 0, tax_minor: 0, from, to, currency: ctx.cur };
  items.forEach((x) => {
    if (!x.item.evidence || x.item.evidence.flag !== 'no_tax_invoice') return;
    out.count += 1;
    out.tax_minor = engines.addMinor(out.tax_minor, engines.sumMinor(x.lines.filter((line) => roles.has(line.account_role)), ctx.cur, (line) => line.dr_minor), ctx.cur);
  });
  return out;
}

/**
 * ⭐ NEEDS ATTENTION (W15-102) — the Day book's evidence states COUNTED ON THE SERVER over a range, and the entries behind each count, newest first, a page at a time.
 * The states are CBEvidence.stateOf's, in its order: flag (no tax invoice — flagOf, the pack's own answer) · nodoc (no source document) · none (a source, no file held) · open queries (the reviewer's open marks).
 * attentionIn(handle, entity, ctx, from, to, kind?, pg?) → { from, to, total, no_tax_invoice, no_file, no_source, open_queries (null while marking is off) }
 *   with kind ('flag' | 'none' | 'nodoc' | 'query') the same envelope plus { kind, entries: [{ entry_id, entry_no, posting_date, event_type, narration, total_minor }], count, page, limit }.
 * ctx = { pack, cur, queryIds } — queryIds(handle, from, to) → the entry ids of the open queries (the marks module's own read), or null.
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
async function flaggedBy(handle, entity, ctx, scope, params) {
  if (!ctx.pack) return [];
  const found = await handle.query(
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
const flaggedIds = (handle, entity, ctx, from, to) => flaggedBy(handle, entity, ctx, 'je.posting_date >= $3::date AND je.posting_date <= $4::date', [from, to]);
/** W15-114: which of THESE entries carry the flag (the open bills of a supplier) — the same rule, asked of the ids a list already holds, never of a range */
const flaggedAmong = (handle, entity, ctx, ids) => (ids.length ? flaggedBy(handle, entity, ctx, 'je.entry_id = ANY($3::uuid[])', [ids]) : Promise.resolve([]));

/** the entries behind one evidence state, newest first, a page at a time: { kind, entries, count, page, limit } */
async function attentionPage(handle, entity, ask) {
  const { from, to, kind, pg, flagged, queries } = ask;
  const limit = (pg && pg.limit) || 25,
    page = (pg && pg.page) || 1;
  const listed = await handle.query(
    `SELECT je.entry_id, je.entry_no, je.posting_date, je.event_type, je.narration, je.total_minor, count(*) OVER () AS total_rows
       ${ATTENTION_FROM} AND ${ATTENTION_KINDS[kind]} AND cardinality($4::uuid[]) >= 0 AND cardinality($5::uuid[]) >= 0 ORDER BY je.posting_date DESC, je.entry_no DESC LIMIT $6 OFFSET $7`,
    [entity, from, to, flagged, queries || [], limit, (page - 1) * limit]
  );
  return {
    kind,
    entries: listed.rows.map((row) => ({ entry_id: row.entry_id, entry_no: row.entry_no, posting_date: dayText(row.posting_date), event_type: row.event_type, narration: row.narration, total_minor: Number(row.total_minor) })),
    count: listed.rows.length ? Number(listed.rows[0].total_rows) : 0,
    page,
    limit
  };
}
/** attentionIn(handle, entity, ctx, from, to, kind?, pg?) — the evidence states counted over a range, and the entries behind one of them (see the block above) */
async function attentionIn(handle, entity, ctx, from, to, kind, pg) {
  const flagged = await flaggedIds(handle, entity, ctx, from, to),
    queries = ctx.queryIds ? await ctx.queryIds(handle, from, to) : null;
  const counted = (
    await handle.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE ${ATTENTION_KINDS.nodoc})::int AS nodoc,
              count(*) FILTER (WHERE ${ATTENTION_KINDS.none})::int AS none
         ${ATTENTION_FROM}`,
      [entity, from, to, flagged]
    )
  ).rows[0];
  const out = { from, to, total: counted.total, no_tax_invoice: flagged.length, no_file: counted.none, no_source: counted.nodoc, open_queries: queries ? queries.length : null, needs: new Set(flagged.concat(queries || [])).size };
  if (!kind || !ATTENTION_KINDS[kind]) return out;
  return Object.assign(out, await attentionPage(handle, entity, { from, to, kind, pg, flagged, queries }));
}

module.exports = { attach, isEvidence, flagOf, unsupportedIn, inputRoles, attentionIn, flaggedAmong };
