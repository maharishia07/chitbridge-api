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
 * ⭐ evidence = { doc: { chit_id, ref } | null, files: [{ id, name, mime, size }], count, flag: null | 'no_tax_invoice', flag_why?, cite?, cite_status? }.  b887: files also come from `cb_attachment.entry_id` (a receipt attached to the entry itself, lib/books-evidence-attach), and `duplicate?: { entry_id, entry_no, note }` names another entry of this shop holding the very same file (sha-256). No bytes, no object key, no message's file (a note or a dispute file is never evidence).
 * ⭐ THE FLAG: an expense or purchase bill, not reversed, that carries input tax on the pack's own tax ledger, in the pack's currency, whose gross (the Dr side of its own lines) needs a tax invoice by the pack (books-bank-BankTax.taxInvoiceOn, on the
 *    entry's own day), with no file on its source. It says so and cites the pack's own row; the row's wording is the pack's (unconfirmed until cb-country reads the ATO page): this file asserts no law.
 * ⚠️ NO MONEY IS CHANGED: this reads; the rows, sums and counts of the list are not touched (one extra SELECT, never a JOIN into the page query).
 */
const storage = require('./storage');
const BankTax = require('./books-bank-tax');

const CLAIMING = new Set(['expense', 'bank_expense_supplier', 'purchase_bill']);
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
/**
 * AD-F-04: a bill that CAME OVER THE RAIL is itself the tax invoice when its sealed chit carries what the pack's own rule says a tax invoice holds (the pack's `taxInvoice().must`, GST Act s.29-70(1) as the pack cites it:
 * the supplier's identity and ABN, the date, what was sold, the GST, the total): the frozen invoice names the seller with an ABN that passes THE one tax-id check (profile.taxIdRefusal), a date, at least one item and a tax figure above 0.
 * It READS the frozen invoice (business_json.invoice, sealed at send: sent_at set); it computes nothing. A held / unregistered-seller invoice (no ABN, no tax) stays flagged.
 */
function railTaxInvoice(row, pack) {
  const inv = (row && row.invoice) || {};
  const seller = inv.SellerDtls || {};
  if (!row || !row.sent_at || !pack || !sellerNamed(seller)) return false;
  if (require('./profile').taxIdRefusal(pack.country, seller.Gstin)) return false;
  return invoiceHoldsItemsAndTax(inv);
}
/** the sealed invoice's seller has a tax id and a name (legal, else trade) */
function sellerNamed(seller) {
  return !!String(seller.Gstin || '').trim() && !!String(seller.LglNm || seller.TrdNm || '').trim();
}
/** the sealed invoice has a date, at least one item and a tax figure above 0 */
function invoiceHoldsItemsAndTax(inv) {
  const when = inv.DocDtls && inv.DocDtls.Dt;
  return !!when && Array.isArray(inv.ItemList) && inv.ItemList.length > 0 && Number(inv.ValDtls && inv.ValDtls.TaxVal) > 0;
}
/** which of these source chits are a tax invoice by the rail (railTaxInvoice): Set of chit ids. ONE read, the handle's own RLS. */
async function railInvoiceChits(handle, chitIds, pack) {
  if (!chitIds.length || !pack) return new Set();
  const found = await handle.query("SELECT chit_id, sent_at, business_json->'invoice' AS invoice FROM chit_header WHERE chit_id = ANY($1::uuid[]) AND business_json->'invoice' IS NOT NULL", [chitIds]);
  return new Set(found.rows.filter((row) => railTaxInvoice(row, pack)).map((row) => String(row.chit_id)));
}
/** the flag of one entry, or null: see the header. `lines` are its raw rows (account_role, dr_minor); `railHeld` = its source chit is a tax invoice by the rail (AD-F-04) */
function flagOf(entry, lines, files, ctx, railHeld) {
  if (railHeld || !assessable(entry, files, ctx) || !claimsInput(lines, ctx.pack)) return null;
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

/** b887: the files that sit on ENTRIES of the books, grouped by entry: Map(entry → [{ id, name, mime, size }]); and each entry's exact-copy note (the same sha-256 on ANOTHER entry of this shop): Map(entry → { entry_id, entry_no, note }) */
async function entryFilesFor(handle, entryIds) {
  const files = new Map(),
    sameFile = new Map();
  const found = entryIds.length ? await storage.listForEntries(entryIds, handle) : [];
  found.forEach((row) => (files.get(String(row.entry_id)) || files.set(String(row.entry_id), []).get(String(row.entry_id))).push({ id: row.id, name: row.name, mime: row.mime, size: row.size }));
  if (found.some((row) => row.sha256)) {
    /* ONE read for the page; the handle is the shop's own (RLS), and entity_id is matched again. A different receipt has a different hash and stays silent: the hash finds exact copies only. */
    const twins = await handle.query(
      `SELECT a.entry_id AS mine, je.entry_id AS other, je.entry_no FROM cb_attachment a
         JOIN cb_attachment o ON o.entity_id = a.entity_id AND o.sha256 = a.sha256 AND o.entry_id IS NOT NULL AND o.entry_id <> a.entry_id
         JOIN journal_entry je ON je.entity_id = o.entity_id AND je.entry_id = o.entry_id
        WHERE a.entry_id = ANY($1::uuid[]) AND a.sha256 IS NOT NULL ORDER BY je.entry_no`,
      [entryIds]
    );
    twins.rows.forEach((row) => sameFile.has(String(row.mine)) || sameFile.set(String(row.mine), { entry_id: row.other, entry_no: row.entry_no, note: 'Check: same file as entry ' + row.entry_no }));
  }
  return { files, dup: sameFile };
}

/** the item's own entry id as text, or null (an item with no entry) */
const entryIdOf = (x) => (x.item && x.item.entry_id ? String(x.item.entry_id) : null);
/** the files that count for an item: its source chit's, then the ones on its own entry */
const filesOf = (x, mine, byChit, onEntry) => (x.chit_id ? byChit.get(String(x.chit_id)) || [] : []).concat((mine && onEntry.files.get(mine)) || []);
/** one item's evidence: the files of its source chit and of its own entry, the document, the missing-invoice flag, and the exact-copy note */
function evidenceOf(x, byChit, onEntry, opt, rail) {
  const mine = entryIdOf(x);
  const files = filesOf(x, mine, byChit, onEntry);
  /* a walk-in day has no chit of its own but IS sourced: the counter bills it covers (source.count) — the source is carried, never "no source" */
  const walkin = walkInCover(x);
  const evidence = { doc: docOf(x, walkin), files: files.slice(0, SHOWN), count: files.length, flag: null };
  if (opt.flag && x.entry) Object.assign(evidence, flagOf(x.entry, x.lines || [], files, opt, !!x.chit_id && rail.has(String(x.chit_id))) || {});
  if (mine && onEntry.dup.has(mine)) evidence.duplicate = onEntry.dup.get(mine); /* the same note for the owner, the firm and the auditor: it is read here, never per seat */
  return evidence;
}
/**
 * attach(handle, items, opt) → sets `evidence` on each item. items: [{ item, chit_id, ref, entry? , lines? }] built by the caller (the Day book groups raw lines per entry; the ledger has one line per item).
 * opt = { pack, cur, flag: boolean } · `handle` is the list's open handle. ONE read for the whole page.
 */
async function attach(handle, items, opt) {
  const ids = [...new Set(items.map((x) => x.chit_id).filter(Boolean).map(String))];
  const byChit = filesByChit(ids.length ? await storage.listForChits(ids, handle) : []);
  const entryIds = [...new Set(items.map((x) => x.item && x.item.entry_id).filter(Boolean).map(String))];
  const onEntry = await entryFilesFor(handle, entryIds); /* b887: a file on the entry itself counts beside the source chit's files */
  const rail = opt.flag ? await railInvoiceChits(handle, ids, opt.pack) : new Set(); /* AD-F-04: only a list that asks for the flag reads the chits' invoices */
  for (const x of items) x.item.evidence = evidenceOf(x, byChit, onEntry, opt, rail);
}

/**
 * isEvidence(handle, entity, id) → true when the file is a DOCUMENT file (no message's) on a chit that is the source of an entry of this entity. The caller then reads the bytes with storage.getBlob(id, entity, { documentsOnly: true }) (its own handle,
 * after this one closed: no nested transaction). The same answer for a file that is not there and one that is not evidence: no oracle. cb_attachment is per-entity RLS, and `entity_id = $2` is asked again.
 */
/** the ONE entry-to-chit link, as SQL: an entry of entity `$e` has chit `$c` as its source (source_chit_id, or one of a walk-in day's source_chit_ids); isEvidence and isSourceOf both read it, nothing else says it */
const sourceOfSql = (entityParam, chitParam) => `EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = ${entityParam} AND (j.source_chit_id = ${chitParam} OR ${chitParam} = ANY(j.source_chit_ids)))`;
async function isEvidence(handle, entity, id) {
  const onEntry = (await storage.hasEntryColumns()) ? ' OR (a.entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $2 AND j.entry_id = a.entry_id))' : ''; /* b887: a file on an entry of THIS shop */
  const ok = await handle.query(
    `SELECT 1 FROM cb_attachment a
      WHERE a.id = $1 AND a.entity_id = $2 AND a.message_id IS NULL
        AND ((a.chit_id IS NOT NULL AND ${sourceOfSql('$2', 'a.chit_id')})${onEntry}) LIMIT 1`,
    [id, entity]
  );
  return ok.rows.length > 0;
}

/**
 * SEC-117 · isSourceOf(handle, entity, chitId) → true when the chit is the SOURCE DOCUMENT of an entry posted in THIS entity's books (journal_entry.source_chit_id, or one of a walk-in day's source_chit_ids). THE ONE ENFORCER of the auditor's
 * read of a source chit (GET /api/chits/:id under X-Books-For): the entity is the grant's member (never the header, a query or a body), the chit id is the URL's and is only ever a bound parameter, and the id is checked as a uuid first.
 * entity_id = $1 is asked in the SQL itself, not left to row security alone. Not linked, not there and another shop's all answer false: no oracle.
 */
async function isSourceOf(handle, entity, chitId) {
  if (!entity || !SOURCE_ID.test(String(chitId || ''))) return false;
  const found = await handle.query(
    `SELECT ${sourceOfSql('$1', '$2::uuid')} AS linked`,
    [entity, String(chitId)]
  );
  return !!(found.rows[0] && found.rows[0].linked);
}
const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the top-level keys of GET /api/chits/:id a grant (X-Books-For) may read: the document, its lines and files; never who else holds it, its internal history, who it is assigned to or what the books wait on (OWASP API3: an allow-list, a new key is born closed) */
const SOURCE_KEEP = new Set(['header', 'detail', 'bill_total', 'attachments', 'amendments', 'amendments_migrated', 'live_set', 'lines_from', 'line_delivery', 'delivery_summary', 'doc', 'credit', 'order_billed', 'cost_hidden']);
/** the chit header columns a grant reads: the document's own facts (who sent it, its subject, dates, currency, the frozen summary and business body); never the recipients list, internal ids or the creating actor (an allow-list: a column added later is born closed) */
const SOURCE_HEADER_KEEP = new Set(['chit_id', 'direction', 'role', 'purpose', 'sender_entity_display_name', 'sender_entity_bridge_id', 'auto_subject', 'manual_subject', 'created_at', 'sent_at', 'schema_version', 'currency_code', 'line_item_count', 'summary_json', 'business_json']);
/** sourceView(answer) → the chit answer cut to SOURCE_KEEP, with the read-only words the sheet reads (actions: none) */
function sourceView(answer) {
  const out = { read_only: true, actions: {} };
  for (const key of Object.keys(answer || {})) if (SOURCE_KEEP.has(key)) out[key] = answer[key];
  if (out.header && typeof out.header === 'object') out.header = Object.fromEntries(Object.entries(out.header).filter(([key]) => SOURCE_HEADER_KEEP.has(key)));
  return out;
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
  const items = [...byEntry.values()].map((lines) => ({ item: { entry_id: lines[0].entry_id }, chit_id: lines[0].source_chit_id, ref: lines[0].source_ref, entry: lines[0], lines }));
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
/** is a file held on this entry: on its source chit, or (b887, once the columns are there) on the entry itself */
const heldSql = (entryCol) => 'EXISTS (SELECT 1 FROM cb_attachment a WHERE a.chit_id = je.source_chit_id AND a.message_id IS NULL)' + (entryCol ? ' OR EXISTS (SELECT 1 FROM cb_attachment e WHERE e.entry_id = je.entry_id AND e.entity_id = je.entity_id)' : '');
const kindsOf = (HELD) => ({
  flag: 'je.entry_id = ANY($4::uuid[])',
  nodoc: `ch.chit_id IS NULL AND COALESCE(cardinality(je.source_chit_ids), 0) = 0 AND NOT (${HELD}) AND NOT (je.entry_id = ANY($4::uuid[]))`, /* a walk-in day (it covers counter bills) is sourced; a file on the entry itself sources it too */
  none: `(ch.chit_id IS NOT NULL OR COALESCE(cardinality(je.source_chit_ids), 0) > 0) AND NOT (${HELD}) AND NOT (je.entry_id = ANY($4::uuid[]))`,
  query: 'je.entry_id = ANY($5::uuid[])',
  needs: '(je.entry_id = ANY($4::uuid[]) OR je.entry_id = ANY($5::uuid[]))' /* W15-116: what wants the owner — no tax invoice, or an open query (the quiet states, no file / no source, are not asks) */
});

/** the entries that carry the flag: the Day book's own rule (flagOf), asked of the few entries that could. `scope` = the SQL for which entries (a date range, or the given ids) */
async function flaggedBy(handle, entity, ctx, scope, params) {
  if (!ctx.pack) return [];
  const HELD = heldSql(await storage.hasEntryColumns());
  const found = await handle.query(
    `SELECT je.entry_id, je.event_type, je.doc_date, je.posting_date, je.reverses_entry_id,
            je.source_chit_id,
            (SELECT x.entry_id FROM journal_entry x WHERE x.entity_id = je.entity_id AND x.reverses_entry_id = je.entry_id LIMIT 1) AS reversed_by_id,
            a.role AS account_role, l.dr_minor
       FROM journal_entry je JOIN journal_line l ON l.entity_id = je.entity_id AND l.entry_id = je.entry_id JOIN ledger_account a ON a.account_id = l.account_id
      WHERE je.entity_id = $1 AND ${scope} AND je.event_type = ANY($2::text[]) AND NOT (${HELD})`,
    [entity, [...CLAIMING]].concat(params)
  );
  const byEntry = new Map();
  found.rows.forEach((row) => (byEntry.get(String(row.entry_id)) || byEntry.set(String(row.entry_id), []).get(String(row.entry_id))).push(row));
  const rail = await railInvoiceChits(handle, [...new Set([...byEntry.values()].map((lines) => lines[0].source_chit_id).filter(Boolean).map(String))], ctx.pack); /* AD-F-04: the same rail read as attach */
  return [...byEntry.entries()].filter(([, lines]) => flagOf(lines[0], lines, [], ctx, !!lines[0].source_chit_id && rail.has(String(lines[0].source_chit_id)))).map(([id]) => id);
}
const flaggedIds = (handle, entity, ctx, from, to) => flaggedBy(handle, entity, ctx, 'je.posting_date >= $3::date AND je.posting_date <= $4::date', [from, to]);
/** W15-114: which of THESE entries carry the flag (the open bills of a supplier) — the same rule, asked of the ids a list already holds, never of a range */
const flaggedAmong = (handle, entity, ctx, ids) => (ids.length ? flaggedBy(handle, entity, ctx, 'je.entry_id = ANY($3::uuid[])', [ids]) : Promise.resolve([]));

/** the entries behind one evidence state, newest first, a page at a time: { kind, entries, count, page, limit } */
async function attentionPage(handle, entity, asked) {
  const { from, to, kind, pg, flagged, queries } = asked;
  const limit = (pg && pg.limit) || 25,
    page = (pg && pg.page) || 1;
  const ATTENTION_KINDS = kindsOf(heldSql(await storage.hasEntryColumns()));
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
  const ATTENTION_KINDS = kindsOf(heldSql(await storage.hasEntryColumns()));
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

module.exports = { attach, entryFilesFor, isEvidence, isSourceOf, sourceView, sourceOfSql, SOURCE_KEEP, SOURCE_HEADER_KEEP, flagOf, railTaxInvoice, railInvoiceChits, unsupportedIn, inputRoles, attentionIn, flaggedAmong };
