'use strict';
/**
 * lib/credit-qty.js — A CREDIT NOTE CANNOT TAKE BACK MORE OF A LINE THAN THE BILL INVOICED (WALK W W-F-03).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS       lineKey · quantityRefusal — the one comparison "quantity on the bill − quantity already credited ≥ quantity on this note", line by line (pure: lines in, sentence out)
 * CALLED BY  lib/credit-cap.js judgeQuantity (the send's gate, under the bill's lock; the ONE check — the buyer's accept meets only notes that passed it)
 * FLOW       bill lines + earlier notes' lines + this note's lines ──▶ keyed by product id/sku, else the particulars with the word "returned" dropped ──▶ per key: left = billed − credited ──▶ null | sentence
 * CARD       14-accounting/README (ACC-286 sibling; leaders refuse a credit over the invoiced quantity — Xero, QuickBooks)
 * A note line that matches no bill line is NOT judged here (said nothing, never a guess); a line with no quantity is not judged.
 */
const KEY_FIELDS = ['product_id', 'sku', 'item_code', 'code'];
const QUANTITY_TOLERANCE = 1e-6;
/** the key a line is compared under: a product id when it carries one, else its particulars lower-cased, spaces folded, a trailing "returned"/"return"/"(returned)" dropped */
function lineKey(line) {
  const row = line || {};
  for (const field of KEY_FIELDS) if (row[field] != null && String(row[field]).trim() !== '') return field + ':' + String(row[field]).trim().toLowerCase();
  const text = String(row.particulars || row.description || row.name || '').toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s(returned|return)$/, '');
  return text ? 'name:' + text : '';
}
const quantityOf = (line) => {
  const n = Number(line && (line.quantity != null ? line.quantity : line.qty));
  return Number.isFinite(n) ? n : null;
};
/** the same key in two readings: a note says "WKW Coffee" by name though the bill has a product id → also try the name key of the bill line */
const keysOf = (line) => [...new Set([lineKey(line), lineKey({ particulars: line && (line.particulars || line.description || line.name) })].filter(Boolean))];
const said = (n) => String(Math.round(n * 1e6) / 1e6);

/** billedQuantities(billLines) → Map key → { q: quantity on the bill, name } for every line that carries a quantity */
function billedQuantities(billLines) {
  const billed = new Map();
  for (const line of billLines || []) {
    const qty = quantityOf(line);
    if (qty === null) continue;
    for (const key of keysOf(line)) billed.set(key, { q: (billed.get(key) ? billed.get(key).q : 0) + qty, name: String(line.particulars || line.description || line.name || key) });
  }
  return billed;
}
/** askedQuantities(billed, noteLines) → Map key → quantity this note asks to credit, for the lines that match a bill line */
function askedQuantities(billed, noteLines) {
  const asked = new Map();
  for (const line of noteLines || []) {
    const qty = quantityOf(line);
    const key = keysOf(line).find((k) => billed.has(k));
    if (qty !== null && key) asked.set(key, (asked.get(key) || 0) + qty);
  }
  return asked;
}
/**
 * quantityRefusal(billLines, earlierNoteLines, noteLines) → the sentence of the first line over its bill line, or null.
 *   earlierNoteLines: ONE flat array of the lines of every earlier live note against the bill.
 */
function quantityRefusal(billLines, earlierNoteLines, noteLines) {
  const billed = billedQuantities(billLines);
  const credited = (key) => {
    let back = 0; /* quantity (not money) already credited on this key */
    for (const line of earlierNoteLines || []) if (keysOf(line).includes(key)) back += quantityOf(line) || 0;
    return back;
  };
  for (const [key, asking] of askedQuantities(billed, noteLines)) {
    const bill = billed.get(key);
    const already = credited(key);
    if (already + asking > bill.q + QUANTITY_TOLERANCE) {
      const left = Math.max(0, bill.q - already);
      return 'The bill had ' + said(bill.q) + ' of ' + bill.name + (already > 0 ? ' and ' + said(already) + ' already came back' : '') + ', so ' + (left > 0 ? 'only ' + said(left) + ' can be credited' : 'nothing is left to credit') + '. This note credits ' + said(asking) + '.';
    }
  }
  return null;
}

module.exports = { lineKey, quantityRefusal };
