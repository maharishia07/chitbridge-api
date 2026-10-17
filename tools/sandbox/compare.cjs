'use strict';
/**
 * tools/sandbox/compare.cjs — the differences a sandbox load writes down, as PURE functions over the saved records (no database, no network).
 * OWNS      noHome (every field that carried a value and that no lane reads) · taxCodes (each code → the move-in's own tax map, and its rate
 *           against theirs) · rounding (their lines against their own totals, in minor units) · units · parties (a document naming a contact the
 *           pull does not hold, duplicate names, a contact on both sides)
 * CALLED BY tools/sandbox/load.cjs · tests/sandbox-load.test.cjs
 * FLOW      recordsOf(entity) → each check → plain rows the findings quote
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob
 * ⚠️ ONE ROUNDER: every amount becomes minor units through lib/move-in toMinor (money.round + money.decimals). The only arithmetic here is
 *    THEIR quantity × THEIR rate, to see whether THEIR line agrees with itself — it is a check, never an amount we keep.
 */
const moveIn = require('../../lib/move-in');
const money = require('../../lib/money');
const { LANES, at } = require('./maps.cjs');

const MAX_DEPTH = 4;
const TOP = 40;
const lowered = (text) => String(text == null ? '' : text).trim().replace(/\s+/g, ' ').toLowerCase();
const isEmpty = (value) => value === '' || value == null || value === false || (Array.isArray(value) && !value.length)
  || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);

/** every leaf path that carries a value in one record; array members as name[] */
function leafPaths(value, prefix, found, depth) {
  if (isEmpty(value)) return found;
  if (Array.isArray(value)) { value.forEach((member) => leafPaths(member, prefix + '[]', found, depth)); return found; }
  if (typeof value === 'object' && depth < MAX_DEPTH) { for (const name of Object.keys(value)) leafPaths(value[name], prefix ? prefix + '.' + name : name, found, depth + 1); return found; }
  found.add(prefix);
  return found;
}
/** read paths cover their children: "Phones" covers "Phones[].PhoneNumber" */
const covered = (leaf, reads) => reads.some((read) => leaf === read || leaf.startsWith(read + '.') || leaf.startsWith(read + '['));
/** how many records carry each unread path, most first */
function unreadCounts(recs, reads) {
  const counts = new Map();
  for (const rec of recs) for (const leaf of leafPaths(rec, '', new Set(), 0)) if (!covered(leaf, reads)) counts.set(leaf, (counts.get(leaf) || 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1]);
}
/** per saved entity: the fields with a value that no lane reads, with how many records carry each */
function noHome(vendor, recordsOf, entityNames) {
  const out = {};
  for (const entity of entityNames) {
    const lanes = LANES[vendor].filter((lane) => lane.entities.includes(entity));
    const unread = unreadCounts(recordsOf(entity), [].concat(...lanes.map((lane) => lane.reads)));
    out[entity] = { records: recordsOf(entity).length, lane: lanes.length ? lanes.map((lane) => lane.kind + (lane.side ? ':' + lane.side : '')).join(', ') : null,
      fields: unread.slice(0, TOP).map(([path, records]) => ({ path, records })), more: Math.max(0, unread.length - TOP) };
  }
  return out;
}

/* ── tax codes ── */
const TAX_SOURCES = {
  xero: { entity: 'tax_rates', code: (rec) => rec.TaxType, name: (rec) => rec.Name, rate: (rec) => (rec.EffectiveRate != null ? rec.EffectiveRate : rec.DisplayTaxRate) },
  qbo: { entity: 'taxcode', code: (rec) => rec.Name || rec.Id, name: (rec) => rec.Description || rec.Name, rate: () => null },
  zoho: { entity: 'taxes', code: (rec) => rec.tax_name, name: (rec) => rec.tax_name, rate: (rec) => rec.tax_percentage },
};
/** the map's answer for one code, in words: maps · RATE DIFFERS · unknown to the map · no tax map for <vendor> */
function taxVerdict(mapped, kind, theirs, ours, vendor) {
  if (!mapped) return 'no tax map for ' + vendor;
  if (kind === undefined) return 'unknown to the map';
  return theirs != null && Number(theirs) !== Number(ours) ? 'RATE DIFFERS' : 'maps';
}
/** each tax code the vendor declares → what the move-in's map (engines reg-au moveIn.supplyKindFor) makes of it, and the rate check */
function taxCodes(vendor, recordsOf) {
  const source = TAX_SOURCES[vendor], auPack = require('../../lib/reg-au'), mapped = auPack.moveIn.sources.includes(vendor);
  return recordsOf(source.entity).map((rec) => {
    const code = String(source.code(rec) || ''), theirs = source.rate(rec);
    const kind = mapped ? auPack.moveIn.supplyKindFor(vendor, code) : undefined;
    const ours = kind ? kind.rate : kind === null ? 0 : null;
    return { code, name: source.name(rec) || '', their_rate: theirs == null ? null : Number(theirs), our_kind: kind ? kind.name : kind === null ? 'no GST' : null,
      our_rate: ours, verdict: taxVerdict(mapped, kind, theirs, ours, vendor) };
  });
}

/* ── rounding: their lines against their own totals ── */
const QBO_SKIP_LINES = ['SubTotalLineDetail', 'DiscountLineDetail'];
const qboDiscount = (doc) => -(doc.Line || []).filter((line) => line.DetailType === 'DiscountLineDetail').reduce((total, line) => total + Number(line.Amount || 0), 0);
const DOCS = {
  xero: { entities: ['invoices', 'bills', 'credit_notes'], number: (doc) => doc.InvoiceNumber || doc.CreditNoteNumber || doc.InvoiceID || doc.CreditNoteID, lines: (doc) => doc.LineItems || [],
    qty: (line) => line.Quantity, rate: (line) => line.UnitAmount, discount: (line) => line.DiscountRate, amount: (line) => line.LineAmount,
    subtotal: (doc) => (doc.LineAmountTypes === 'Inclusive' ? doc.Total : doc.SubTotal), tax: (doc) => doc.TotalTax, extra: () => 0, total: (doc) => doc.Total,
    inclusive: (doc) => doc.LineAmountTypes === 'Inclusive' },
  qbo: { entities: ['invoice', 'bill', 'creditmemo', 'vendorcredit'], number: (doc) => doc.DocNumber || doc.Id,
    lines: (doc) => (doc.Line || []).filter((line) => /LineDetail$/.test(line.DetailType || '') && !QBO_SKIP_LINES.includes(line.DetailType)),
    qty: (line) => at(line, 'SalesItemLineDetail.Qty') || at(line, 'ItemBasedExpenseLineDetail.Qty'),
    rate: (line) => at(line, 'SalesItemLineDetail.UnitPrice') || at(line, 'ItemBasedExpenseLineDetail.UnitPrice'), discount: () => 0, amount: (line) => line.Amount,
    subtotal: null, tax: (doc) => at(doc, 'TxnTaxDetail.TotalTax') || 0, extra: qboDiscount, total: (doc) => doc.TotalAmt, inclusive: (doc) => doc.GlobalTaxCalculation === 'TaxInclusive' },
  zoho: { entities: ['invoices', 'bills', 'credit_notes'], number: (doc) => doc.invoice_number || doc.bill_number || doc.creditnote_number, lines: (doc) => doc.line_items || [],
    qty: (line) => line.quantity, rate: (line) => line.rate, discount: (line) => (String(line.discount || '').includes('%') ? parseFloat(line.discount) : 0), amount: (line) => line.item_total,
    subtotal: (doc) => doc.sub_total, tax: (doc) => doc.tax_total,
    extra: (doc) => Number(doc.adjustment || 0) + Number(doc.shipping_charge || 0) + Number(doc.roundoff_value || 0) - Number(doc.discount_total || 0),
    total: (doc) => doc.total, inclusive: (doc) => !!doc.is_inclusive_tax },
};
const minor = (value, currency) => moveIn.toMinor(String(value == null || value === '' ? 0 : value), currency);
/** one line: their quantity × their rate (less their discount) against their line amount → a difference row or null */
function lineCheck(spec, line, index, currency) {
  const quantity = Number(spec.qty(line)), rate = Number(spec.rate(line));
  if (spec.qty(line) === '' || spec.rate(line) === '' || !Number.isFinite(quantity) || !Number.isFinite(rate)) return null;
  const computed = minor(quantity * rate * (1 - Number(spec.discount(line) || 0) / 100), currency), theirs = minor(spec.amount(line), currency);
  return computed === theirs ? null : { check: 'line ' + (index + 1) + ' qty × rate', theirs, computed, diff: theirs - computed };
}
/** one document's checks → the ones that disagree (each line · lines vs subtotal · subtotal + tax vs total) */
function docChecks(spec, doc, currency) {
  const lines = spec.lines(doc);
  if (!lines.length) return [];
  const out = lines.map((line, index) => lineCheck(spec, line, index, currency)).filter(Boolean);
  const sum = lines.reduce((total, line) => total + minor(spec.amount(line), currency), 0);
  const subtotal = spec.subtotal ? minor(spec.subtotal(doc), currency) : sum;
  if (spec.subtotal && sum !== subtotal) out.push({ check: 'lines vs subtotal', theirs: subtotal, computed: sum, diff: subtotal - sum });
  const expected = subtotal + (spec.inclusive(doc) ? 0 : minor(spec.tax(doc), currency)) + minor(spec.extra(doc), currency), total = minor(spec.total(doc), currency);
  if (expected !== total) out.push({ check: 'subtotal + tax vs total', theirs: total, computed: expected, diff: total - expected });
  return out;
}
/** an amount with more decimals than the currency keeps — what the one rounder will round away */
function finerThanMinor(value, currency) { const decimals = /\.(\d+)$/.exec(String(value)); return !!decimals && decimals[1].replace(/0+$/, '').length > money.decimals(currency); }
/** every document: its line checks, and how many amounts are finer than the currency keeps */
function rounding(vendor, recordsOf, currency) {
  const spec = DOCS[vendor], differences = [];
  let documents = 0, withLines = 0, finer = 0;
  for (const entity of spec.entities) for (const doc of recordsOf(entity)) {
    const lines = spec.lines(doc);
    documents++; if (lines.length) withLines++;
    finer += lines.filter((line) => finerThanMinor(spec.rate(line), currency) || finerThanMinor(spec.amount(line), currency)).length;
    for (const diff of docChecks(spec, doc, currency)) differences.push(Object.assign({ entity, doc: String(spec.number(doc) || '') }, diff));
  }
  return { currency, documents, with_lines: withLines, values_finer_than_a_minor_unit: finer, differences };
}

/* ── units: the vendor's unit, and where it goes ── */
const UNIT = { xero: null, qbo: null, zoho: { items: 'items', item: (rec) => rec.unit, line: (line) => line.unit, docs: ['invoices', 'bills'] } };
function units(vendor, recordsOf) {
  const spec = UNIT[vendor];
  if (!spec) return { their_unit_field: false, note: 'their item has no unit; the move-in gives every product "unit" (lib/move-in.js:328)' };
  const items = recordsOf(spec.items), lineUnits = new Set();
  spec.docs.forEach((entity) => recordsOf(entity).forEach((doc) => (doc.line_items || []).forEach((line) => { if (spec.line(line)) lineUnits.add(spec.line(line)); })));
  return { their_unit_field: true, items: items.length, items_with_unit: items.filter((rec) => spec.item(rec)).length, units_seen: [...new Set(items.map(spec.item).filter(Boolean))],
    line_units_seen: [...lineUnits], note: 'the move-in item row has no unit column and writes "unit" (lib/move-in.js:328); the connector adapter keeps it (adapters/zoho.js:120)' };
}

/* ── parties ── */
/** contacts by name per side, against the names the open documents give */
function parties(laneOut) {
  const names = { customer: new Map(), supplier: new Map() }, out = { docs_naming_unknown_contact: [], duplicate_names: [], on_both_sides: [] };
  laneOut.filter((lane) => lane.kind === 'contacts').forEach((lane) => lane.rows.forEach((row) => {
    const name = lowered(row.name), held = names[lane.side];
    if (held.has(name)) out.duplicate_names.push({ side: lane.side, name: row.name });
    held.set(name, row.name);
  }));
  for (const [name, shown] of names.customer) if (names.supplier.has(name)) out.on_both_sides.push(shown);
  laneOut.filter((lane) => lane.kind === 'open_bills').forEach((lane) => lane.rows.forEach((row) => {
    if (!names[lane.side === 'payable' ? 'supplier' : 'customer'].has(lowered(row.contact))) out.docs_naming_unknown_contact.push({ side: lane.side, doc: row.invoice_no, contact: row.contact });
  }));
  return out;
}

module.exports = { noHome, taxCodes, rounding, units, parties, leafPaths, docChecks, DOCS };
