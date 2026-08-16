'use strict';
// lib/groupsum.js — 🧮 GROUP SUM. "Sum all the tasks and find out the total requirement."
//
// Athi, 2026-08-11: *"in the metrics, total value sum, also can we group sum as icon, in the sense sum all the
// tasks and find out the total requirement."*  Scope: the folder or track currently on screen.
//
// ── ⚠️ NO NEW ARITHMETIC. THAT IS THE WHOLE POINT ───────────────────────────────────────────────────────────────
// Every number here comes from code that already exists and is already proved:
//     the requirement  →  lib/consolidate.js   (wholesaler W-1…W-11, 27/0)
//     the matching     →  lib/itemmatch.js     (synonyms, variants, misspellings — ONE matcher)
//     the value        →  lib/measure.js       (medians not means, nulls not zeros, no cross-currency total)
// A second implementation of "add up the tomatoes" would not stay merely second; it would disagree, and the two
// answers would both look authoritative. This file only GATHERS and hands over.
//
// ── ⚠️ WHAT MAKES THIS DIFFERENT FROM THE WHOLESALER VIEW ───────────────────────────────────────────────────────
// capture.consolidationInput() gathers CHANNEL-BORN chits (WhatsApp/email/SMS) and buckets per FULFILMENT DATE,
// because a wholesaler sources per delivery morning and Friday's tomato must never join Monday's. This gathers
// whatever the list is showing — any chit, any origin — and produces ONE bucket, because "what does this folder
// add up to" is a single question about a single pile.
//
// It gets that single bucket by handing every request the SAME synthetic date, so consolidate() runs completely
// unmodified. ⚠️ Deliberate: the alternative was a mode flag inside the proven engine, and a flag that changes how
// totals bucket is exactly the kind of change that invalidates the proof that made the engine trustworthy.
const { withEntity } = require('../db');
const select = require('./select');
const measure = require('./measure');
const consolidate = require('./consolidate');
const itemmatch = require('./itemmatch');
const amend = require('./amend');   // ⭐ totals come from the LIVE SET, never from the original reading

const ONE_BUCKET = 'all';   // never rendered; it exists so the date dimension collapses instead of being removed

/* The price index key. Four parts because two lines on one chit could share a phrase; a collision then needs two
   IDENTICAL lines, whose price is identical too, so it cannot pick the wrong one. */
const lineKey = (chit_id, l) => [chit_id, String(l.particulars || ''), Number(l.quantity) || 0, String(l.unit || '')].join('');

/**
 * attachValue(lines, priceOf) — cost beside each quantity, and WHO asked.
 *
 * Athi: *"say 10 parties ordered 1000Kg, on click the down below need to know who are all asked."*
 * consolidate() already returns that roster as `breakdown`; this walks it, prices each entry, totals PER CURRENCY.
 *
 * ⚠️ NEVER ONE TOTAL ACROSS CURRENCIES — same rule as measure(): a figure spanning INR and USD means nothing, and
 *    it means nothing most convincingly when it looks tidy.
 * ⚠️ A PARTIALLY-PRICED LINE SAYS SO. If 7 of 12 shops named a price, the sum of those 7 is real but it is NOT the
 *    cost of the line — presenting it bare understates the requirement by exactly the part nobody has quoted.
 * ⚠️ NO PRICE IS null, NOT 0. lib/money.js learned this the hard way: Number(null)===0 made every chit awaiting
 *    agreement count as valued-at-zero, so the same rows appeared as both "excluded" and "totalled".
 *
 * Pure and exported so the money path can be proved without a database.
 */
function attachValue(lines, priceOf) {
  for (const l of (lines || [])) {
    const byCur = {}; let priced = 0, unpriced = 0;
    for (const b of (l.breakdown || [])) {
      const hit = priceOf.get(lineKey(b.chit_id, { particulars: b.phrase, quantity: b.qty, unit: b.unit }));
      if (!hit || hit.price === null || hit.price === undefined) { unpriced++; b.value = null; continue; }
      priced++;
      const v = Math.round((b.qty * hit.price + Number.EPSILON) * 100) / 100;
      b.value = v; b.currency = hit.currency || null;
      const c = hit.currency || '—';
      byCur[c] = Math.round(((byCur[c] || 0) + v + Number.EPSILON) * 100) / 100;
    }
    const curs = Object.keys(byCur);
    l.value = curs.map((c) => ({ currency: c, total: byCur[c] }));
    if (curs.length > 1) l.value_mixed = true;
    if (unpriced) l.value_partial = { priced, unpriced };
  }
  return lines;
}

/**
 * requirement(entity_id, opts) — what this folder/track adds up to.
 *
 * opts: { scope:'task'|'order', folder_id?, archived?, overdue_days? }
 */
async function requirement(entity_id, opts = {}) {
  const scope = opts.scope === 'order' ? 'order' : 'task';
  let rows = await select.rows(entity_id, {
    direction: scope === 'order' ? 'sent' : 'received',
    folder_id: opts.folder_id || undefined,
    archived: !!opts.archived,
    limit: 2000,
  });
  /**
   * ⭐ A TICKED SET, not just a whole track or folder (Athi: *"is the group sum happens for multiselect chit?"*).
   * "Across these five orders I need 40kg onion" is arguably the most natural place to want this pane.
   *
   * ⚠️ FILTER THE ALREADY-SCOPED SET; NEVER WIDEN THE QUERY. select.rows() has returned only this entity's own
   * copies (WITH RLS). Intersecting that with the requested ids can therefore only ever NARROW it, which makes
   * "you cannot total a chit you cannot see" a property of the shape rather than of a check someone has to
   * remember. Passing ids into the SQL instead would turn this endpoint into a way to ask about other people's
   * chits and get a yes/no from the answer's size.
   * ⚠️ Unknown or unreadable ids are silently absent rather than an error — an id you may not see must look
   * exactly like an id that does not exist, or the difference is itself the leak.
   * ⚠️ The limit:2000 above still applies, so a selection is drawn from the first 2000 rows of the scope.
   */
  if (Array.isArray(opts.chit_ids) && opts.chit_ids.length) {
    const want = new Set(opts.chit_ids.map((x) => String(x)));
    rows = rows.filter((r) => want.has(String(r.chit_id)));
  }

  /* ⚠️ ONE QUERY FOR EVERY LINE, not one per chit. A folder of 500 chits would otherwise be 500 round trips on a
     click — and the pooler would make that feel like a hang rather than a slow answer. */
  const ids = rows.map((r) => r.chit_id);
  const byChit = new Map();
  if (ids.length) {
    const d = await withEntity(entity_id, (c) => c.query(
      'SELECT chit_id, line_items FROM chit_detail WHERE entity_id = $1 AND chit_id = ANY($2::uuid[])', [entity_id, ids]));
    /* ⭐ THE LIVE SET, NOT THE ORIGINAL READING (b138). This totalled `line_items` straight from the table when it
       shipped this morning, which meant a trader could correct 5 crates down to 2 and the forecast would still
       tell him to source 5 — and removing a line for stock-unavailable would change nothing at all. A forecast
       computed from what the machine misheard is worse than no forecast, because he would act on it.
       ⚠️ ONE query for every chit's amendments, not one per chit — a folder of 500 would otherwise be 500 round
       trips on a tap, and the pooler would make that feel like a hang rather than a slow answer. */
    const amendsByChit = await amend.listFor(entity_id, ids);
    d.rows.forEach((x) => byChit.set(x.chit_id, amend.liveLines(x.line_items || [], amendsByChit.get(x.chit_id) || [])));
  }

  /* ⚠️ ATTRIBUTION IS THE COUNTERPARTY, resolved by select.rows — never the sender field. On a received copy the
     other side is the sender; on a sent copy it is the first recipient. Reading one column for both would make a
     folder of orders attribute every line to yourself. */
  const requests = [];
  let withLines = 0;
  /* ⚠️ THE PRICE INDEX, and why it is keyed on four things. consolidate() returns each line's attribution
     (who asked, how much) but not its money — it was built to answer "what must I source", where price is noise.
     To put a cost beside the quantity WITHOUT touching that proved engine, the price is looked back up from the
     input by chit + phrase + qty + unit. Four parts because two lines on one chit could share a phrase; a
     collision then needs two IDENTICAL lines, whose price is identical too, so it cannot pick the wrong one.
     Keyed rather than ordered on purpose: relying on consolidate's iteration order would work today and break
     silently the first time that loop is rearranged. */
  const priceOf = new Map();
  for (const r of rows) {
    const lines = byChit.get(r.chit_id) || [];
    if (!lines.length) continue;
    withLines++;
    lines.forEach((l) => {
      const p = (l.price === 0 || l.price) ? Number(l.price) : null;
      /* ⚠️ null, NOT 0. A line awaiting a price is not a line that is free — money.js already learned this the
         hard way, where Number(null)===0 made unpriced chits count as valued-at-zero. */
      priceOf.set(lineKey(r.chit_id, l), { price: Number.isFinite(p) ? p : null, currency: r.currency || null });
    });
    requests.push({
      store_id: r.counterparty_id || r.chit_id,
      store_name: r.counterparty_name || '(unnamed party)',
      chit_id: r.chit_id,
      fulfil_date: ONE_BUCKET,
      lines: lines.map((l) => ({
        particulars: l.particulars, comment: l.comment,
        qty: Number(l.quantity) || 0, unit: l.unit || '',
      })),
    });
  }

  const cat = await itemmatch.loadCatalogue(entity_id);
  const out = consolidate.consolidate(requests, cat);

  attachValue(out.lines, priceOf);

  /* The value side, from measure() — so a folder's money here and its money in the Metrics pane are the same
     function, and cannot drift into two different truths about the same chits. */
  const m = measure.measure(rows, { overdue_days: opts.overdue_days });

  return {
    scope, folder_id: opts.folder_id || null,
    /* ⚠️ SAY WHEN THIS WAS A SELECTION, and say how many of the ticked chits were actually found. A pane headed
       "5 chits" when the user ticked 7 is the same class of quiet lie as counting chits that carry no lines —
       two of them were outside the scope or beyond the row limit, and only this number reveals it. */
    ...(opts.chit_ids ? { selected: true, selection_requested: opts.chit_ids.length } : {}),
    chits: rows.length,
    /* ⚠️ SAID OUT LOUD. A pile of 47 chits where only 9 carry line items produces a requirement built from 9, and
       without this number that total reads as if it covered all 47. */
    chits_with_lines: withLines,
    chits_without_lines: rows.length - withLines,
    has_catalogue: cat.items.length > 0,
    requirement: out.lines.map((l) => { const c = Object.assign({}, l); delete c.date; return c; }),
    flags: out.flags,
    money: m.money,
  };
}

module.exports = { requirement, attachValue, lineKey };
