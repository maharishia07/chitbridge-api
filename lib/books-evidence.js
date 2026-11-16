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
const ymd = (value) => (value == null ? null : String(value).slice(0, 10));

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
    const evidence = { doc: x.chit_id ? { chit_id: x.chit_id, ref: x.ref || null } : null, files: files.slice(0, SHOWN), count: files.length, flag: null };
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

module.exports = { attach, isEvidence, flagOf, unsupportedIn };
