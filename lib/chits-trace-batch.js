'use strict';
/**
 * lib/chits-trace-batch.js — the by-batch trace's named steps: the rows, the items, the chain, and the chit's parties as a list.
 * OWNS      recipientsOf · traceRecipientOf · batchRows · batchItems · batchChain (no route, no state)
 * CALLED BY routes/chits-trace.js (GET /trace/by-batch, and recipientsOf for the graph walk)
 * FLOW      batchRows (withEntity: lot first, product fallback) → batchItems → batchChain
 * CARD      01-rail-core-the-chit/chits-routes
 */
const cbLog = require('./logger');
const { withEntity } = require('../db');

/** a chit's parties as a list: all_recipients arrives as a list or as JSON text; text that does not parse is none */
function recipientsOf(row, caller) {
  let list = row.all_recipients;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      cbLog.fellBack('chits ' + caller + ': did not parse — answered with none', e, 'debug');
      list = [];
    }
  }
  return Array.isArray(list) ? list : [];
}

/* ═══ BY-BATCH'S NAMED STEPS (T2-SPLIT, 2026-10-14) — the rows · the items · the chain; the balance is the walk's own. ═══ */

/** the receiver of a handoff (by-batch chains on it): the 'receiver' row, else the first party that is not sender or operator */
function traceRecipientOf(row) {
  const list = recipientsOf(row, 'traceRecipientOf');
  return list.find((x) => x.role === 'receiver') || list.find((x) => x.role && x.role !== 'sender' && x.role !== 'operator') || null;
}

/**
 * ── ⚠️ THIS ENDPOINT DID NOT MATCH ON A BATCH ─────────────────────────────────────────────────────────────
 * It matched `summary_json->'trace'->>'product'` — the product NAME — while being called `by-batch`, and the
 * trace object has never carried a batch at all. So a recall for lot "24B" returned every customer who ever
 * received that product, at every depth, and the answer looked exactly like a correct one. In a recall that
 * is not a slightly wide net: it is telling forty customers to destroy stock that was never affected, and
 * failing to tell the six who hold the bad lot which lot it was.
 *
 * ⭐ NOW IT LOOKS FOR A REAL LOT FIRST — `chit_line.flags->'lot'->>'batch'`, GS1 (10), written on the movement
 * by lib/gs1.lotOf. Serial (21) counts too: a recall by serial is the same question, one unit narrower.
 *
 * ⚠️ AND IT STILL FALLS BACK TO PRODUCT CORRELATION, RATHER THAN RETURNING NOTHING. Every chit raised before
 * lots existed has no batch on any line, and a traceability screen that suddenly answered "no results" for
 * data it happily walked yesterday would read as data loss. But the fallback ANNOUNCES ITSELF — `matched_on`
 * travels in the response — because the difference between "these six shipments carried lot 24B" and "these
 * forty shipments were of this product" is the entire value of the answer, and a screen that cannot tell them
 * apart will present the second as the first.
 */
const LOT_OF_LINE = `CASE WHEN jsonb_typeof(li.value->'item_data'->'lot') = 'object' THEN COALESCE(li.value->'item_data'->'lot'->>'batch', li.value->'item_data'->'lot'->>'serial')
            WHEN jsonb_typeof(li.value->'item_data'->'lot') = 'string' THEN li.value->'item_data'->>'lot'
            ELSE li.value->'item_data'->>'batch' END`;
/**
 * ⭐ WALK-D D-F-07: THE LOT A SHOP HOLDS IS ON THE CHIT'S OWN LINES, NOT ONLY IN chit_line.flags.
 * chit_deliver copies only qty_unverified / variant_unspecified into chit_line.flags, so the lot the till's goods-in sends (item_data.lot = { batch | serial, expiry }, or a bare
 * lot text, or the flat item_data.batch) never reached the flags the query above reads: "No lot was recorded on any line" for lots the Stock screen lists. The full lines are kept
 * in chit_detail.line_items (RLS: this shop's own copy), so the lot is read there too - with the SAME three shapes stock-from-chit.lotOf reads. A chit with no network trace
 * (a goods-in receipt, a supplier's bill) answers with its matching line's product, quantity and unit in place of the trace's. → [{ ...header, trace, line }]
 */
/** reviews1 EL F8: only a missing table or column (42P01, 42703: a database older than the join) answers 'no rows'; a timeout or a pool error is rethrown, because a recall that says nobody holds the lot, when the read merely failed, is the wrong answer said calmly */
const onlyMissingSchema = (tag) => (e) => {
  if (e && (e.code === '42P01' || e.code === '42703')) {
    require('./logger').warn(tag, { err: e.message });
    return { rows: [] };
  }
  throw e;
};
async function batchRowsOnLines(shopId, lotValue) {
  const found = await withEntity(shopId, (db) =>
    db.query(
      `SELECT h.chit_id, h.sender_entity_id, h.sender_entity_display_name, h.all_recipients, h.summary_json->'trace' AS trace,
              jsonb_build_object('particulars', li.value->>'particulars', 'quantity', li.value->'quantity', 'unit', li.value->>'unit') AS line
         FROM chit_header h
         JOIN chit_detail d ON d.entity_id = h.entity_id AND d.chit_id = h.chit_id
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.line_items) = 'array' THEN d.line_items ELSE '[]'::jsonb END) AS li(value)
        WHERE lower(${LOT_OF_LINE}) = lower($1)`,
      [lotValue]
    )
  ).catch(onlyMissingSchema('trace.by-batch-no-detail'));
  return found.rows;
}
/** the chits that carry this lot: by the flags on the line, then by the lines' own lot, then by product name → { r: the rows, matched_on: 'batch' | 'product' } */
async function batchRows(shopId, lotValue) {
  let matched_on = 'batch';
  let found = await withEntity(shopId, (db) =>
    db.query(
      `SELECT DISTINCT h.chit_id, h.sender_entity_id, h.sender_entity_display_name, h.all_recipients,
            h.summary_json->'trace' AS trace
       FROM chit_header h
       JOIN chit_line   l ON l.entity_id = h.entity_id AND l.chit_id = h.chit_id
      WHERE h.summary_json->'trace' IS NOT NULL
        AND l.removed = false
        AND (lower(l.flags->'lot'->>'batch') = lower($1) OR lower(l.flags->'lot'->>'serial') = lower($1))`,
      [lotValue]
    )
  ).catch(onlyMissingSchema('trace.by-batch-no-lines')); // pre-b142 there is no chit_line to join — fall through, do not fail

  const onLines = await batchRowsOnLines(shopId, lotValue);
  if (onLines.length) found = { rows: found.rows.concat(onLines) };
  if (!found.rows.length) {
    matched_on = 'product';
    found = await withEntity(shopId, (db) =>
      db.query(
        `SELECT chit_id, sender_entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
         FROM chit_header
        WHERE summary_json->'trace' IS NOT NULL
          AND lower(summary_json->'trace'->>'product') = lower($1)`,
        [lotValue]
      )
    );
  }
  return { r: found, matched_on };
}

/** the product, quantity and unit a row speaks of: the chit's own trace block first, else the matching line's own words */
function traceFieldsOf(trace, line) {
  return {
    product: trace.product || (line && line.particulars) || null,
    qty: trace.qty ?? (line && line.quantity != null ? Number(line.quantity) : null),
    unit: trace.unit || (line && line.unit) || null,
    base_qty: trace.base_qty ?? null,
    base_unit: trace.base_unit || null
  };
}
/** one item per chit (the lot join can return a chit once per matching line) */
function batchItems(rows) {
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    if (seen.has(row.chit_id)) continue;
    seen.add(row.chit_id);
    const rec = traceRecipientOf(row);
    items.push(
      Object.assign(
        {
          chit_id: row.chit_id,
          sender_entity_id: row.sender_entity_id,
          sender_name: row.sender_entity_display_name || null,
          to_entity_id: rec ? rec.entity_id : null,
          to_name: rec ? rec.display_name : null
        },
        traceFieldsOf(row.trace || {}, row.line)
      )
    );
  }
  return items;
}

/** the chain rebuilt from the data alone, and each node's depth from the roots */
function batchChain(items) {
  // rebuild edges: X → Y when receiver(X) === sender(Y). Pure data correlation, no links.
  const bySender = {};
  items.forEach((item) => {
    (bySender[item.sender_entity_id] = bySender[item.sender_entity_id] || []).push(item);
  });
  const edges = [];
  const hasParent = new Set();
  items.forEach((x) =>
    (bySender[x.to_entity_id] || []).forEach((y) => {
      if (y.chit_id !== x.chit_id) {
        edges.push({ from: x.chit_id, to: y.chit_id });
        hasParent.add(y.chit_id);
      }
    })
  );
  const nmap = {};
  items.forEach((item) => {
    nmap[item.chit_id] = Object.assign({}, item, { depth: 0, is_origin: !hasParent.has(item.chit_id) });
  });
  // BFS depth from the roots
  const kidsMap = {};
  edges.forEach((e) => {
    (kidsMap[e.from] = kidsMap[e.from] || []).push(e.to);
  });
  let frontier = items.filter((item) => !hasParent.has(item.chit_id)).map((item) => item.chit_id);
  const seenD = new Set(frontier);
  let count = 0;
  while (frontier.length && count < 60) {
    const next = [];
    frontier.forEach((id) =>
      (kidsMap[id] || []).forEach((item) => {
        if (!seenD.has(item)) {
          seenD.add(item);
          nmap[item].depth = count + 1;
          next.push(item);
        }
      })
    );
    frontier = next;
    count++;
  }
  const nodeArr = Object.values(nmap);
  return { edges, nodeArr, kidsMap, nmap };
}

module.exports = { recipientsOf, traceRecipientOf, batchRows, batchItems, batchChain };
