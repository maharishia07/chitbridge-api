// routes/chits-trace.js — the recall trace of a chit: children, the forward/backward walk, the batch views, the networks a shop is in
/**
 * owns: the trace routes of /api/chits (owner area 13, traceability) — GET /:id/children · GET /:id/trace · GET /trace/batches · GET /trace/by-batch · GET /trace/networks —
 *       and the helpers only they use (the graph walk, the batch rows). Moved out of routes/chits.js byte for byte (LEAN-PLAN §8 slice 1); no behaviour changed.
 * called by: routes/chits.js (mounted at the place the block used to sit, so every path keeps its order), the web trace and recall screens.
 * FLOW  auth → entityId(req) → withEntity(me) → the edges this shop CO-HOLDS (RLS) → the walk → res
 * INIT  express → lib (trace · chits-contract) → db; mounted by routes/chits.js with router.use, under /api/chits
 * // CARD 01-rail-core-the-chit/chits-routes
 */
const express = require('express');
const cbLog = require('../lib/logger');
const router = express.Router();
const { withEntity } = require('../db');
const { problem } = require('../lib/problem');
const { said, failed, routeChecks: checked } = require('../lib/chits-contract');
const auth = require('../middleware/auth');
const trace = require('../lib/trace');
const PAGE_LIMIT = require('../lib/page-limit');
const { LIST_MAX, LIST_PAGE } = require('../lib/chits-input');

const entityId = (req) => auth.entityOf(req);

// ─── GET /chits/:id/children ──────────────────────────────────────────────────────────────────────────────
// Forward-link resolver (Fragment 1): the immediate children of a handoff = every chit whose trace.parents SET
// contains :id. RLS-scoped — the caller sees only children they CO-HOLD, so a rival's downstream edge is invisible
// by construction (the TR-6 privacy floor). Proves the forward link is a SET: a fan-out node returns all N children.
// The cross-entity, multi-hop operator WALK (past parties you don't co-hold) is Fragment 2's participant-gated definer.
router.get('/:id/children', auth, ...checked('GET /:id/children'), async (req, res) => {
  try {
    const me = entityId(req);
    const id = req.params.id;
    if (!trace.UUID_RE.test(id)) return problem(req, res, { status: 400, ...said({ error: 'Bad request', message: 'Invalid chit id' }, 'CHIT_BAD_REQUEST') });
    const r = await withEntity(me, (db) =>
      db.query(
        `SELECT chit_id, entity_id, direction, manual_subject, auto_subject,
              summary_json->'trace' AS trace
         FROM chit_header
        WHERE summary_json->'trace'->'parents' @> $1::jsonb
        ORDER BY created_at ASC`,
        [JSON.stringify(id)]
      )
    );
    res.json({ parent_chit_id: id, count: r.rows.length, children: r.rows });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed to get children'));
  }
});

// ─── GET /chits/:id/trace?dir=forward|backward ──────────────────────────────────────────────────────────────
// The recall WALK (Fragment 2). RLS-scoped, so the caller only ever traverses edges it CO-HOLDS: an ordinary
// entity sees one hop each way, while the mandated network OPERATOR (co-held onto every network edge) sees its
// whole subtree — and a rival sees nothing of another's chain (TR-6, the moat, by construction). forward =
// exposure / recall set (BFS; the visited-set collapses diamonds + cycles); backward = provenance to source.
// A hop the caller doesn't co-hold is an honest dead-end (the branch stops), never a silent skip to grandchildren.
router.get('/:id/trace', auth, ...checked('GET /:id/trace'), async (req, res) => {
  try {
    const me = entityId(req);
    const id = req.params.id;
    if (!trace.UUID_RE.test(id)) return problem(req, res, { status: 400, ...said({ error: 'Bad request', message: 'Invalid chit id' }, 'CHIT_BAD_REQUEST') });
    const dir = req.query.dir === 'backward' ? 'backward' : 'forward';
    const MAX_NODES = 2000,
      MAX_DEPTH = 40;
    // Optional network scope: when given, the walk follows ONLY edges tagged with this network id, so an entity in
    // several networks never bleeds one into another (the multi-network leak). Omit to walk all co-held edges.
    const net = typeof req.query.network === 'string' && req.query.network.trim() ? req.query.network.trim() : null;
    const g = traceGraph(me, net);
    const seed = await g.fetch1(id);
    if (!seed.rows[0]) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not visible to you' }, 'NOT_FOUND') });
    g.put(seed.rows[0], 0);

    if (dir === 'forward') {
      await traceForward(g, me, id, net, MAX_NODES, MAX_DEPTH);
      const { nodes, edges } = g;
      const nodeArr = [...nodes.values()];
      const terminals = nodeArr.filter((item) => !edges.some((e) => e.from === item.chit_id));
      // ── Mass-balance invariant (Fragment 3): at each node, what goes OUT (sum of its children's base_qty) must not
      //    exceed what came IN (its own base_qty), in the same base unit. out > in ⇒ RED — more claimed out than
      //    received = theft / dilution / counterfeit, caught with no investigation. Only compares like base units.
      const flagged = traceBalance(nodeArr, (n) =>
        edges
          .filter((e) => e.from === n.chit_id)
          .map((e) => nodes.get(e.to))
          .filter(Boolean)
      );
      return res.json({
        dir,
        start: id,
        reachable_count: nodeArr.length,
        depth_max: nodeArr.reduce((total, item) => Math.max(total, item.depth), 0),
        flagged,
        terminals: terminals.map((item) => ({ chit_id: item.chit_id, product: item.product })),
        nodes: nodeArr,
        edges
      });
    }

    // backward: follow parents toward the origin (records every visible parent edge; advances along the first visible parent).
    const path = await traceBackward(g, id, MAX_DEPTH);
    return res.json({ dir, start: id, hops: path.length - 1, path: path.slice().reverse(), nodes: [...g.nodes.values()], edges: g.edges });
  } catch (err) {
    problem(req, res, failed(err, req, 'Trace walk failed'));
  }
});

/* ═══ THE TRACE WALK'S NAMED STEPS (T2-SPLIT, 2026-10-14) — the graph · forward · the mass balance · backward. ═══ */

// The chain is a graph of HANDOFFS: each node is one co-held edge. Label it by who it went to (to_name) and
// came from (sender_name) so the walk renders as a readable tree. Names are topology the operator already
// co-holds — not commercial terms — so this stays within the TR-6 lens.
function traceToName(row) {
  let list = row.all_recipients;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      cbLog.fellBack('chits traceToName: did not parse — answered with none', e, 'debug');
      list = [];
    }
  }
  list = Array.isArray(list) ? list : [];
  const rec = list.find((x) => x.role && x.role !== 'sender' && x.role !== 'operator');
  return rec ? rec.display_name : null;
}
/** a node's edge facts off its frozen summary_json.trace */
function traceEdgeOf(t) {
  t = t || {};
  return {
    product: t.product || null,
    qty: t.qty ?? null,
    unit: t.unit || null,
    base_qty: t.base_qty ?? null,
    base_unit: t.base_unit || null,
    is_origin: !!t.is_origin,
    parents: Array.isArray(t.parents) ? t.parents : []
  };
}

/** the walk's graph: nodes by chit, each edge once, and the one RLS-scoped read a hop makes (`net` = one network only) */
function traceGraph(me, net) {
  const fetch1 = (cid) =>
    withEntity(me, (db) =>
      db.query(
        `SELECT chit_id, entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
       FROM chit_header WHERE chit_id = $1${net ? " AND summary_json->'trace'->'network'->>'id' = $2" : ''} LIMIT 1`,
        net ? [cid, net] : [cid]
      )
    );
  const nodes = new Map();
  const edges = [];
  const seenEdge = new Set();
  const addEdge = (from, to) => {
    const k = `${from}|${to}`;
    if (!seenEdge.has(k)) {
      seenEdge.add(k);
      edges.push({ from, to });
    }
  };
  const put = (row, depth) => {
    if (!nodes.has(row.chit_id))
      nodes.set(row.chit_id, {
        chit_id: row.chit_id,
        entity_id: row.entity_id,
        depth,
        sender_name: row.sender_entity_display_name || null,
        to_name: traceToName(row),
        network: (row.trace && row.trace.network && row.trace.network.id) || null,
        ...traceEdgeOf(row.trace)
      });
  };
  return { nodes, edges, fetch1, addEdge, put };
}

/** forward = exposure / recall set (BFS; the visited set collapses diamonds and cycles).
 *  DB-59 / K-DB: `parents ?| frontier` is served by b770's GIN (chit_header_trace_parents_gin, jsonb_ops); the old
 *  jsonb_array_elements_text EXISTS read every chit_header row once per depth. Same rows for an array of chit-id strings. */
async function traceForward(g, me, id, net, MAX_NODES, MAX_DEPTH) {
  const { nodes, addEdge, put } = g;
  let frontier = [id],
    depth = 0;
  while (frontier.length && depth < MAX_DEPTH && nodes.size < MAX_NODES) {
    const r = await withEntity(me, (db) =>
      db.query(
        `SELECT chit_id, entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
         FROM chit_header
        WHERE summary_json->'trace'->'parents' ?| $1::text[]${net ? " AND summary_json->'trace'->'network'->>'id' = $2" : ''}`,
        net ? [frontier, net] : [frontier]
      )
    );
    const next = [];
    for (const row of r.rows) {
      const parents = Array.isArray(row.trace && row.trace.parents) ? row.trace.parents : [];
      for (const p of parents) if (frontier.includes(p)) addEdge(p, row.chit_id);
      if (!nodes.has(row.chit_id)) {
        put(row, depth + 1);
        next.push(row.chit_id);
      }
    }
    frontier = next;
    depth++;
  }
}

/** the mass balance on every node — the walk's AND by-batch's (one rule; `kidsOf(n)` → its child nodes). Returns how many are RED. */
function traceBalance(nodeArr, kidsOf) {
  let flagged = 0;
  for (const n of nodeArr) {
    const kids = kidsOf(n);
    if (!kids.length || n.base_qty == null) {
      n.balance = null;
      continue;
    } // a leaf, or no quantity to balance
    if (!kids.every((item) => item.base_qty != null && item.base_unit === n.base_unit)) {
      n.balance = { status: 'unknown' };
      continue;
    }
    const out = kids.reduce((total, item) => total + item.base_qty, 0);
    const delta = out - n.base_qty;
    const red = delta > 1e-9;
    if (red) flagged++;
    n.balance = { in: n.base_qty, out, delta, base_unit: n.base_unit, status: red ? 'red' : 'ok' };
  }
  return flagged;
}

/** backward = provenance toward the origin — returns the path walked */
async function traceBackward(g, id, MAX_DEPTH) {
  const { nodes, fetch1, addEdge, put } = g;
  let current = id,
    depth = 0;
  const path = [id];
  while (depth < MAX_DEPTH) {
    const cur = nodes.get(current);
    const parents = cur ? cur.parents : [];
    if (!parents || !parents.length) break; // origin — or an honest dead-end where provenance isn't co-held
    let advanced = null;
    for (const p of parents) {
      const pr = await fetch1(p);
      if (pr.rows[0]) {
        addEdge(p, current);
        put(pr.rows[0], depth + 1);
        if (!advanced) advanced = p;
      }
    }
    if (!advanced) break;
    path.push(advanced);
    current = advanced;
    depth++;
  }
  return path;
}

// ─── GET /chits/trace/batches ───────────────────────────────────────────────────────────────────────────────
// List the trace-carrying chits the caller holds, so the screen can offer clickable batches (no pasting an id).
// RLS-scoped — the operator sees its network's batches, a party sees only its own; origins listed first.
router.get('/trace/batches', auth, ...checked('GET /trace/batches'), async (req, res) => {
  try {
    const me = entityId(req);
    const toName = traceToName; /* the ONE label for a handoff — shared with the walk (T2-SPLIT) */
    const r = await withEntity(me, (db) =>
      db.query(
        `SELECT chit_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace, created_at
         FROM chit_header
        WHERE summary_json->'trace' IS NOT NULL
        ORDER BY ((summary_json->'trace'->>'is_origin') = 'true') DESC, created_at DESC
        LIMIT 200`
      )
    );
    const seen = new Set();
    const batches = [];
    for (const row of r.rows) {
      if (seen.has(row.chit_id)) continue;
      seen.add(row.chit_id);
      const t = row.trace || {};
      batches.push({
        chit_id: row.chit_id,
        product: t.product || null,
        qty: t.qty ?? null,
        unit: t.unit || null,
        is_origin: !!t.is_origin,
        network: (t.network && t.network.id) || null,
        sender_name: row.sender_entity_display_name || null,
        to_name: toName(row)
      });
    }
    const answer = PAGE_LIMIT.pageOut('batches', batches, PAGE_LIMIT.pageArgs(req.query, LIST_PAGE, LIST_MAX));
    /* S34: a batch is the literal built above; the pager's keys follow (capped and cap_note only when it cut the list) */
    // prettier-ignore
    res.json({ count: batches.length, batches: answer.batches.map((x) => ({ chit_id: x.chit_id, product: x.product, qty: x.qty, unit: x.unit, is_origin: x.is_origin, network: x.network, sender_name: x.sender_name, to_name: x.to_name })), total: answer.total, page: answer.page, limit: answer.limit, capped: answer.capped, cap_note: answer.cap_note });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed to list batches'));
  }
});

// ─── GET /chits/trace/by-batch?q=<batch> ────────────────────────────────────────────────────────────────────
// Reconstruct the chain from SHARED DATA (a batch number) instead of the parent links — proves the graph survives
// even if the explicit links weren't followed. Finds the caller's chits carrying that batch, then rebuilds the
// directed chain by PARTY-CHAINING: X → Y when the receiver of X is the sender of Y. No parent_chit_ids used.
// RLS-scoped (you match only within what you hold). Same response shape as the walk, so the tree render is reused.
router.get('/trace/by-batch', auth, ...checked('GET /trace/by-batch'), async (req, res) => {
  try {
    const me = entityId(req);
    const q = String(req.query.q || '').trim();
    if (!q) return problem(req, res, { status: 400, ...said({ error: 'Bad request', message: 'A batch value (q) is required' }, 'CHIT_BAD_REQUEST') });
    const { r, matched_on } = await batchRows(me, q);
    const items = batchItems(r.rows);
    const { edges, nodeArr, kidsMap, nmap } = batchChain(items);
    // mass-balance, same invariant as the walk — the ONE rule (traceBalance)
    const flagged = traceBalance(nodeArr, (n) => (kidsMap[n.chit_id] || []).map((id) => nmap[id]).filter(Boolean));
    const terminals = nodeArr.filter((item) => !edges.some((e) => e.from === item.chit_id));
    res.json({
      dir: 'forward',
      by_batch: q,
      reconstructed: true,
      /* ⚠️ THE CALLER MUST BE ABLE TO TELL THESE APART. 'batch' = these shipments carried this lot. 'product' =
         no lot data was found anywhere, so this is every movement of a product with that name — a much wider and
         much weaker answer, and the one a recall must never be shown without the caveat. */
      matched_on,
      matched_note:
        matched_on === 'batch'
          ? 'Matched on the lot recorded on each line — GS1 (10) batch or (21) serial.'
          : 'No lot was recorded on any line, so this is every movement of a product with that name — not a lot-level recall.',
      start: (nodeArr[0] && nodeArr[0].chit_id) || null,
      reachable_count: nodeArr.length,
      depth_max: nodeArr.reduce((total, item) => Math.max(total, item.depth), 0),
      flagged,
      terminals: terminals.map((item) => ({ chit_id: item.chit_id, product: item.product })),
      nodes: nodeArr,
      edges
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Batch trace failed'));
  }
});

/* ═══ BY-BATCH'S NAMED STEPS (T2-SPLIT, 2026-10-14) — the rows · the items · the chain; the balance is the walk's own. ═══ */

/** the receiver of a handoff (by-batch chains on it): the 'receiver' row, else the first party that is not sender or operator */
function traceRecipientOf(row) {
  let list = row.all_recipients;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      cbLog.fellBack('chits traceRecipientOf: did not parse — answered with none', e, 'debug');
      list = [];
    }
  }
  list = Array.isArray(list) ? list : [];
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
async function batchRows(me, q) {
  let matched_on = 'batch';
  let r = await withEntity(me, (db) =>
    db.query(
      `SELECT DISTINCT h.chit_id, h.sender_entity_id, h.sender_entity_display_name, h.all_recipients,
            h.summary_json->'trace' AS trace
       FROM chit_header h
       JOIN chit_line   l ON l.entity_id = h.entity_id AND l.chit_id = h.chit_id
      WHERE h.summary_json->'trace' IS NOT NULL
        AND l.removed = false
        AND (lower(l.flags->'lot'->>'batch') = lower($1) OR lower(l.flags->'lot'->>'serial') = lower($1))`,
      [q]
    )
  ).catch((e) => {
    // pre-b142 there is no chit_line to join — fall through, do not fail
    require('../lib/logger').warn('trace.by-batch-no-lines', { err: e && e.message });
    return { rows: [] };
  });

  if (!r.rows.length) {
    matched_on = 'product';
    r = await withEntity(me, (db) =>
      db.query(
        `SELECT chit_id, sender_entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
         FROM chit_header
        WHERE summary_json->'trace' IS NOT NULL
          AND lower(summary_json->'trace'->>'product') = lower($1)`,
        [q]
      )
    );
  }
  return { r, matched_on };
}

/** one item per chit (the lot join can return a chit once per matching line) */
function batchItems(rows) {
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    if (seen.has(row.chit_id)) continue;
    seen.add(row.chit_id);
    const rec = traceRecipientOf(row);
    const t = row.trace || {};
    items.push({
      chit_id: row.chit_id,
      sender_entity_id: row.sender_entity_id,
      sender_name: row.sender_entity_display_name || null,
      to_entity_id: rec ? rec.entity_id : null,
      to_name: rec ? rec.display_name : null,
      product: t.product || null,
      qty: t.qty ?? null,
      unit: t.unit || null,
      base_qty: t.base_qty ?? null,
      base_unit: t.base_unit || null
    });
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

// ─── GET /chits/trace/networks ──────────────────────────────────────────────────────────────────────────────
// The networks the caller participates in (derived from the edges it co-holds — migration-free registry seed).
// Supports "an entity can be in many networks" + "see where you are": lists each network id, whether the caller
// is its operator, and how many edges it holds there. RLS-scoped, so you only see networks you're actually in.
router.get('/trace/networks', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const r = await withEntity(me, (db) =>
      db.query(
        `SELECT summary_json->'trace'->'network'->>'id' AS network_id,
              bool_or((summary_json->'trace'->'network'->>'operator') = $1) AS is_operator,
              count(DISTINCT chit_id) AS edges
         FROM chit_header
        WHERE summary_json->'trace'->'network'->>'id' IS NOT NULL
        GROUP BY 1
        ORDER BY edges DESC`,
        [me]
      )
    );
    res.json({ networks: r.rows.map((x) => ({ network_id: x.network_id, is_operator: !!x.is_operator, edges: Number(x.edges) })) });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed to list networks'));
  }
});

module.exports = router;
