// @stage tested
// CALLED BY routes/chits.js (sendSeller stamps; checkCounterInvoice adopts)
// CARD      14-accounting/README
// @stage-note AG-F-01 (walk AG, UAE; AU the same): a till bill that carries no `_cb.kinds` posted every 0% line to plain Sales, so VAT 201 Box 4 / 5 (BAS G3 / G2) read 0. The server now reads the kind from the catalogue.
'use strict';
/**
 * counter-kinds.js — THE SERVER DOES NOT TRUST THE CLIENT FOR THE TAX KIND (AG-F-01, 21 Nov 2026).
 *
 * OWNS      the one rule for a counter bill's supply kinds (zero-rated · exempt · GST-free · input-taxed): the kind of each line is the CATALOGUE's, read through the
 *           reader the online sale uses (tax-lines.itemOf + resolveItem — the slab the product resolves to, its `tax_kind` / `nil_kind`). Two steps, one rule:
 *             stamp(lines, shelf, { note })  at send: each line the catalogue names takes the catalogue's kind; the client's own kind on a line the catalogue rates above 0 comes off;
 *                                            a line the catalogue is silent on (not found, or a 0% slab nobody answered) keeps what the client sent. A credit NOTE is fill-only: it
 *                                            carries the original bill's kind (the till's retKindOf), so only a missing kind is filled.
 *             adopt(invoice, server)         the invoice's `_cb.kinds` (what the books read: books-hooks byRateOf) takes the kinds of the server's own check compute (tax-copy serverCheckOf,
 *                                            the same engine over the stamped lines): a kind missing or different is set, and each change is one sentence in `_cb.notes` — the warning on the bill.
 *           No figure is touched: the issued amounts stand (Athi 2 Oct: computed once, read everywhere); only the kind tag that says which ledger and return box the 0% lands on.
 * CALLED BY routes/chits.js sendSeller (stamp), checkCounterInvoice (adopt)
 * FLOW      line_items + shelf ──▶ stamp ──▶ stamped line_items (+ changes) ──▶ tax-copy serverCheckOf ──▶ adopt(invoice, check.server_kinds, changes) ──▶ invoice._cb.kinds + _cb.notes
 */
const TL = require('./tax-lines');

/** the engine's own spelling of a named kind (lib/tax.js: trim, lower case, "-" → "_") */
const spell = (word) => String(word == null ? '' : word).trim().toLowerCase().replace(/-/g, '_');
/** the kind word a line names today: `tax_kind`, else the legacy `supply_kind`; '' when none */
const lineKind = (line) => spell(line && (line.tax_kind || line.supply_kind));

/**
 * stamp(lines, shelf, { note }) → { lines, changes } — `changes` is [{ line (0-based), from, to }] (from/to are kind words, '' for none), empty when the client was right.
 * Pure over the shelf the route already read (no query). A line whose catalogue answer cannot be read leaves the line as sent.
 */
function stamp(lines, shelf, options) {
  const find = TL.itemOf(shelf),
    changes = [],
    fillOnly = !!(options && options.note);
  const stamped = (Array.isArray(lines) ? lines : []).map((line, index) => {
    if (!line || typeof line !== 'object' || line.removed) return line;
    const itemData = find(line);
    if (!itemData) return line;
    const resolved = TL.resolveItem(itemData, shelf);
    const catalogue = spell(resolved.tax_kind),
      sent = lineKind(line);
    const rated = resolved.rate !== null && resolved.rate !== undefined && Number(resolved.rate) > 0; /* a rated product has no 0% kind */
    const to = catalogue || (rated ? '' : sent);
    if (to === sent || (fillOnly && (sent || Number(line.gst_rate || line.rate || 0) !== 0))) return line; /* a note fills only a missing kind, and only on a line the original bill took no tax on */
    changes.push({ line: index, from: sent, to });
    const out = Object.assign({}, line);
    delete out.supply_kind;
    if (to) out.tax_kind = to;
    else delete out.tax_kind;
    return out;
  });
  return { lines: stamped, changes };
}

/**
 * adopt(invoice, serverKinds, changes) → the sentences added to `_cb.notes` ([] when the invoice already named the server's kinds).
 * `serverKinds` is `_cb.kinds` of the server's compute over the stamped lines; undefined when the check could not run (nothing is touched).
 * A line the server names gets the server's row; a line the catalogue took the client's kind off (`changes[].to === ''`) loses it; every other carried row stays.
 */
function adopt(invoice, serverKinds, changes) {
  if (!invoice || typeof invoice !== 'object' || !Array.isArray(serverKinds)) return [];
  const cb = invoice._cb || {}; /* an invoice with no _cb stays without one unless there is something to say */
  const carried = new Map((Array.isArray(cb.kinds) ? cb.kinds : []).filter(Boolean).map((row) => [Number(row.line), row]));
  const said = [];
  serverKinds.forEach((row) => {
    const had = carried.get(Number(row.line));
    if (had && spell(had.kind) === spell(row.kind)) return;
    carried.set(Number(row.line), row);
    said.push('Line ' + (Number(row.line) + 1) + (had ? ': the till sent "' + spell(had.kind) + '", the catalogue says "' + spell(row.kind) + '"; the catalogue\'s kind is used.' : ': the till sent no tax kind; "' + spell(row.kind) + '" is taken from the catalogue.'));
  });
  (changes || []).filter((change) => !change.to && carried.has(change.line)).forEach((change) => {
    carried.delete(change.line);
    said.push('Line ' + (change.line + 1) + ': the till sent "' + spell(change.from) + '", the catalogue rates this product above 0%; the kind is taken off.');
  });
  if (!said.length) return [];
  invoice._cb = cb;
  const kinds = Array.from(carried.values()).sort((a, b) => Number(a.line) - Number(b.line));
  if (kinds.length) cb.kinds = kinds;
  else delete cb.kinds;
  cb.notes = (Array.isArray(cb.notes) ? cb.notes : []).concat(said);
  return said;
}

module.exports = { stamp, adopt, lineKind };
