// CARD 02-tasks-orders-and-workflow/everyones-work
// OWNS  the team worklist rows (facts, lines, actions per chit).
// CALLED BY  routes/work.js and the Tasks & orders list.
// FLOW  select page → hydrate (one batch) → linesOf (open-orders.liveLines) → build → actionsOf → (a cost-blind reader: sidesFor → lib/cost-view hideWorkCosts, LAST)
'use strict';
/**
 * lib/work-rows.js — THE WORK ROW, ONE BUILDER (TO1/A1, 2026-10-10). Tasks & Orders reads every list, every count and every sheet from
 * here: GET /api/work/list · GET /api/work/:id · GET /api/work/facts (routes/work.js only authenticates, dispatches and refuses).
 *
 * ⭐ NOTHING IS RE-DERIVED. Which chits are mine ........ lib/select.rows (one read of my own copies; both directions)
 *                           Which folder, which word ..... lib/workflow (engines `workflow`, adopted) — tabOf · stageOf · wordOf
 *                           What I may do ................ lib/workflow.actions over lib/rail-actions.meOf — the verdicts GET /chits/:id's
 *                                                          rail answer is made of; a refused one carries its sentence (`say`)
 *                           Which side an order faces .... lib/open-orders.sideOf (DECLARED; never `direction`, which lies for a self-PO)
 *                           Billed / despatched .......... lib/open-orders.MARKS_SQL · marksFrom (the till's and Home's own marks)
 *                           What is delivered ............ lib/deliverline.progressMany over deliverline.PROGRESS_SQL (events, never a total)
 *                           Who holds a line ............. lib/assign.current (latest-wins + history), fed ONE batched read
 *
 * ⭐ TRIPS (one budget line each, round-trips.budget.json): the list = select.rows (1 transaction) + ONE readBatch for the page's chits
 *    (header·lines, marks, progress, line assignments together) — never a query per row. The counts come from the same select read, so they
 *    cost nothing and cannot disagree with the rows. facts = select.rows only. one = select.rows + the same single batch.
 * ⭐ TRUNCATED, NEVER WRONG: select reads at most LIMIT copies. A shop with more says `truncated: true` and gives NO counts and no total
 *    (a count over a cut read would be wrong) — the same rule as lib/home-facts railScope.
 * ⚠️ A tables-not-migrated shop degrades in words: line progress / assignments absent → the fields are null, never a 500 (schema.hasTable
 *    is cached; the optional statements are simply not sent). SQL: none new.
 * ⚠️ RLS: every statement is entity-scoped (select.rows → withEntity; readBatch sets app.current_entity). Line assignment stays PRIVATE —
 *    it is read only for MY entity's chits and travels only to me.
 */
const select = require('./select');
const folderInventory = require('./folder-inventory');
const workflow = require('./workflow');
const railActions = require('./rail-actions');
const openOrders = require('./open-orders');
const deliverline = require('./deliverline');
const assign = require('./assign');
const schema = require('./schema');
const costView = require('./cost-view');
const workClient = require('./work-client');
const clock = require('./shop-clock');
const money = require('./money');
const unbilled = require('./work-unbilled'); /* the unbilled sum and its helpers (a part file) */
const { pickValue, unbilledItems } = unbilled;
const { readBatch, withEntity } = require('../db');

const LIMIT = 5000; /* one read takes this many of my copies (home-facts RAIL_LIMIT) */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 100;
const VIEWS = ['orders_in', 'orders_out', 'tasks', 'done']; /* drafts wait for the compose route; the engine already knows the tab */
const msPerDay = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** an order I SENT (I hold only the sent copy: nothing I move is the received one) */
const isSentOrder = (x) => x.r.purpose === 'order' && x.r.direction !== 'received' && x.facts && x.facts.sender;

/** the facts the engine asks about MY copy of a select row */
function factsOf(row, entity) {
  const received = row.direction === 'received';
  const side = row.purpose === 'order' ? openOrders.sideOf(row, { side: row.biz_side }) : null;
  return {
    held: true,
    received: received ? row.current_status : null,
    sender: String(row.sender_entity_id) === String(entity),
    status: row.current_status,
    purpose: row.purpose,
    side,
    draft: false,
    deleted: false,
    archived: false
  };
}

/**
 * my copies, classified: [{ r, facts, tab }] — the copies that are tasks or orders (a document that leaves the Task / Order lists, a bill, a
 * receipt, an expense, is left out by the SAME list the inbox uses), one per chit (a note to self holds two copies: the received one counts).
 */
async function copies(entity, sel) {
  const rows = await select.rows(entity, Object.assign({ limit: LIMIT }, sel || {}));
  return { items: classify(rows, entity), truncated: rows.length >= LIMIT };
}
/** the classification alone, over rows already read (TOUR-FIX1: Home's rail counts in / out from the SAME select read it takes, through this) */
function classify(rows, entity) {
  const by = new Map();
  for (const r of rows) {
    if (folderInventory.LEAVES.includes(r.doc_kind || '')) continue;
    const k = String(r.chit_id),
      seenRow = by.get(k);
    if (seenRow && seenRow.direction === 'received') continue;
    if (!seenRow || r.direction === 'received') by.set(k, r);
  }
  return [...by.values()]
    .map((item) => {
      const nestedFacts = factsOf(item, entity);
      return { r: item, facts: nestedFacts, tab: workflow.tabOf(nestedFacts) };
    })
    .filter((x) => x.r.purpose === 'order' || (x.r.is_job_chit ? x.r.direction !== 'received' : x.r.direction === 'received')); /* a task came to me; an order is either way; a JOB chit (a firm's own assignment record) is the firm's work on its SENT copy, and the client's received copy is not client work (Fable review A4) */
}

/** folder counts over a classified, untruncated read — the number on each tab (open work; Done counts the closed) */
function countsOf(items) {
  const c = { orders_in: 0, orders_out: 0, tasks: 0, done: 0 };
  for (const x of items) if (x.tab in c) c[x.tab]++;
  return c;
}

/* an order's figure in minor units: money.toMinor (the one rule, half away from zero, the currency's own decimals; unstated -> 2 decimals, never INR by name); null for none (T2-NATDEF) */
const minorOf = (v, cur) => (v == null ? null : money.toMinor(v, cur || null));
const sumUnbilled = (left) => unbilled.sumUnbilled(left, minorOf);
const blindSum = (left, sides) => unbilled.blindSum(left, sides, minorOf);

/** every action with its verdict; a refused one carries the sentence that greys it (the server answers may/why for THIS login) */
function actionsOf(nestedFacts, me, lines) {
  const a = workflow.actions(nestedFacts, me),
    out = {};
  for (const k of Object.keys(a)) out[k] = a[k].ok ? a[k] : Object.assign({}, a[k], { say: workflow.say(a[k].why) });
  if (nestedFacts.sender && nestedFacts.received == null && nestedFacts.purpose === 'order') out.cancel = buyerCancel(nestedFacts, me, lines || []);
  return out;
}

/**
 * B-F-15 · the BUYER's Cancel on the order it sent. The status steps (workflow.can) move only the copy I RECEIVED, so on my sent copy every one of them said
 * "Only the copy you received…", Cancel included. The buyer's withdrawal is the sender's own door (PUT /chits/:id/void, which moves my SENT copy through the same rail gate
 * and asks the seller to cancel theirs), so this is that door's verdict, asked of the rail the way statusGate asks it for a sent copy: rail.move from my sent copy's status.
 * Before anything is delivered (either side's claim) only; once goods are claimed the order is disputed or received, not cancelled. { ok, via:'void', needs:['reason'] }
 */
function buyerCancel(facts, me, lines) {
  const verdict = railActions.move({ held: true, received: facts.sentStatus || null }, me, 'cancelled');
  if (verdict.noop) return { ok: false, why: 'already_done', say: workflow.say('already_done') };
  if (!verdict.ok) return { ok: false, why: verdict.why, say: workflow.say(verdict.why) };
  if (lines.some((item) => item.delivered > 0 || item.theirs > 0)) return { ok: false, why: 'wrong_step', say: 'Goods are already on the way or delivered, so this order can no longer be cancelled. Raise a dispute instead.' };
  return { ok: true, via: 'void', needs: ['reason'] };
}


/**
 * B-F-15: the status of the OTHER side's received copy, for the orders I SENT. My sent copy never moves when the seller accepts (each party holds its own copy, and the
 * status writer moves only the copy it was asked to move), so the chip and the stage of a sent order read the seller's status through chit_participants (the b50 definer, the same read
 * the participants panel makes), never from a second stored status. It rides the page's ONE batch (a statement in it, no trip of its own).
 */
const SEEN_SQL = `SELECT c.id::text AS chit_id, p.current_status FROM unnest($2::uuid[]) AS c(id)
           CROSS JOIN LATERAL chit_participants(c.id) p WHERE p.entity_id <> $1::uuid`;
/** one other party: its status; several: only when they all agree, else no entry (my own copy's word stands). → Map(chit_id → status) */
function seenFrom(rows) {
  const by = new Map(), out = new Map();
  for (const r of rows) by.set(r.chit_id, (by.get(r.chit_id) || new Set()).add(r.current_status));
  for (const [k, set] of by) if (set.size === 1) out.set(k, [...set][0]);
  return out;
}

/** ONE batched read for the chits on this page: header+lines, marks, delivery progress, line assignments → in one trip */
async function hydrate(entity, actor, ids, sentIds) {
  if (!ids.length)
    return { seen: new Map(), detail: new Map(), marks: { despatched: new Set(), billed: new Set() }, prog: new Map(), assigned: new Map(), progOk: true, assignOk: true, clients: { links: new Map(), facts: new Map() } };
  const [hasLines, hasDeliv, hasAssign] = await Promise.all([
    schema.hasTable('chit_line'),
    schema.hasTable('chit_line_delivery'),
    schema.hasTable('chit_line_assignment')
  ]);
  const progOk = hasLines && hasDeliv,
    assignOk = hasAssign;
  const sIds = ids.map(String);
  const stmts = [
    {
      text: `SELECT h.chit_id, d.line_items, h.business_json, h.all_recipients FROM chit_header h
               LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
              WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`,
      params: [entity, sIds]
    },
    { text: openOrders.MARKS_SQL, params: [entity, sIds] }
  ];
  if (progOk) stmts.push({ text: deliverline.PROGRESS_SQL('l.chit_id = ANY($2::uuid[])'), params: [entity, sIds] });
  if (sentIds && sentIds.length) stmts.push({ text: SEEN_SQL, params: [entity, sentIds.map(String)] });
  if (assignOk)
    stmts.push({
      text: `SELECT chit_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type, task, due_date::text AS due_date,
                note, created_at, COALESCE(to_jsonb(chit_line_assignment)->>'state', 'open') AS state
           FROM chit_line_assignment WHERE entity_id = $1 AND chit_id = ANY($2::uuid[]) ORDER BY chit_id, line_id, seq`,
      params: [entity, sIds]
    });
  const res = await readBatch(entity, actor, stmts);
  let index = 0;
  const detail = new Map(res[index++].rows.map((item) => [String(item.chit_id), item]));
  const clients = await clientsOf(detail);
  const marks = openOrders.marksFrom(res[index++].rows);
  /* deliverline.progressMany / assign.current take a db or the rows themselves — the rows are already here, so they are handed over, not re-read */
  let prog = new Map();
  if (progOk) {
    const rows = res[index++].rows;
    prog = (await deliverline.progressMany(entity, sIds, { query: async () => ({ rows }) })) || new Map();
  }
  const seen = sentIds && sentIds.length ? seenFrom(res[index++].rows) : new Map();
  const assigned = new Map();
  if (assignOk) {
    const by = new Map();
    for (const r of res[index++].rows) {
      const k = String(r.chit_id);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    for (const [k, rows] of by) assigned.set(k, await assign.current(entity, k, null, rows));
  }
  return { detail, marks, prog, assigned, progOk, assignOk, clients, seen };
}

/** W16: the client of each job chit on the page → { links: Map(chit → who it is for), facts: Map(client → books facts) }; ONE extra trip, and only when the page holds a job */
async function clientsOf(detail) {
  const links = new Map();
  for (const [id, item] of detail) {
    const link = workClient.clientOf(item);
    if (link) links.set(id, link);
  }
  const facts = await workClient.readClients([...links.values()].map((link) => link.entity_id));
  return { links, facts };
}

/** how far the other side's claim runs past the order (3 places); 0 when it does not */
function overTheirs(theirs, quantity) {
  return theirs != null && quantity > 0 && Number(theirs) > quantity ? Math.round((Number(theirs) - quantity) * 1000) / 1000 : 0;
}
/** one live line of a chit: its facts and both sides' delivery claims */
function lineFacts(chit_id, item, index, chitProgress) {
  const line_id = deliverline.lineIdOf(chit_id, item, index + 1);
  const lineProgress = chitProgress && chitProgress.get ? chitProgress.get(line_id) : null;
  const quantity = Number(item.quantity) || 0;
  const delivered = lineProgress && lineProgress.delivered != null ? Number(lineProgress.delivered) : 0;
  const theirs = lineProgress ? lineProgress.theirs : null;
  return {
    line_id,
    particulars: item.particulars || item.name || '',
    qty: quantity,
    unit: item.unit || 'piece',
    price: item.price == null ? null : Number(item.price),
    delivered,
    /* B-F-15: the OTHER side's claim, shown beside mine and never merged into it (deliverline: my claim is the headline); over_theirs = how far it runs past the order */
    theirs: theirs != null ? Number(theirs) : 0,
    over_theirs: overTheirs(theirs, quantity),
    remaining: Math.max(0, Math.round((quantity - delivered) * 1000) / 1000),
    removed: !!(lineProgress && lineProgress.removed)
  };
}
/** the line facts of one chit from its frozen lines + the delivery progress: [{ line_id, particulars, qty, unit, price, delivered, remaining }] */
function linesOf(chit_id, detail, prog) {
  const chitProgress = prog.get(String(chit_id));
  return openOrders
    .liveLines(chit_id, Array.isArray(detail && detail.line_items) ? detail.line_items : [], chitProgress)
    .map((item, index) => lineFacts(chit_id, item, index, chitProgress))
    .filter((item) => !item.removed);
}

/** W16: the client a job row is for (null on a task or order): id, name, country, currency, the job's period and the next return due */
function clientFor(id, hydrated) {
  const link = hydrated.clients.links.get(id);
  return link ? workClient.shape(link, hydrated.clients.facts.get(link.entity_id), clock.today()) : null;
}

/** the facts the workflow reads of one row: the page's, with the seller's status for an order I sent (B-F-15) and what is still open on its lines */
function factsOfRow(nestedFacts, seen, orderInfo, lines, progOk) {
  const haveLines = lines.length > 0 && progOk;
  const open = lines.filter((item) => item.remaining > 0).length;
  return Object.assign({}, nestedFacts, {
    sentStatus: seen ? nestedFacts.status : null,
    status: seen || nestedFacts.status,
    lines_open_n: haveLines ? open : 0,
    delivered_all: haveLines && open === 0,
    fulfilment: orderInfo ? orderInfo.fulfilment : null
  });
}
/** the words a row shows for itself: subject · reference · the other party (an order's own name first) and its id */
function labelsOf(row, business, orderInfo) {
  return {
    subject: row.manual_subject || row.auto_subject || '',
    ref: business.order_no || business.ref || null,
    party: (orderInfo && orderInfo.name) || row.counterparty_name || (business.party && business.party.name) || null,
    party_id: row.counterparty_id || null
  };
}
/** what an online order says of how it travels (all null for a task or a job) */
function orderFields(orderInfo) {
  const info = orderInfo || {};
  return {
    channel: orderInfo ? info.channel : null,
    fulfilment: orderInfo ? info.fulfilment : null,
    address: orderInfo ? info.address : null,
    requested_for: orderInfo ? info.requested_delivery : null,
    remark: orderInfo ? info.remark : null
  };
}
/** the finished list row: identity, kind and stage, words, the order's travel, money, line counts, marks, assignee, client, age and the actions the actor may take */
function rowShape(parts) {
  const { row, id, hydrated, rowFacts, nestedFacts, lines, seen, heldLines, ctx } = parts;
  const picked = pickValue(row);
  const total = picked == null ? null : Number(picked);
  const open = lines.filter((item) => item.remaining > 0).length;
  return {
    chit_id: row.chit_id,
    kind: workflow.kindOf(rowFacts),
    tab: workflow.tabOf(rowFacts),
    stage: workflow.stageOf(rowFacts),
    word: workflow.wordOf(rowFacts),
    status: row.current_status || null,
    side: rowFacts.side,
    ...labelsOf(row, parts.business, parts.orderInfo),
    ...orderFields(parts.orderInfo),
    total_minor: minorOf(total, parts.currency),
    currency: parts.currency,
    lines_n: hydrated.progOk ? lines.length : null,
    lines_open_n: hydrated.progOk ? open : null,
    billed: hydrated.marks.billed.has(id),
    despatched: hydrated.marks.despatched.has(id),
    assignee: row.assigned_to_actor_id ? { id: row.assigned_to_actor_id, name: row.assigned_to_actor_display_name || null } : null,
    lines_assigned_n: heldLines,
    client: clientFor(id, hydrated),
    created_at: row.created_at,
    age_days: Math.round(((parts.now - new Date(row.created_at).getTime()) / msPerDay) * 10) / 10,
    seen_status: seen,
    actions: actionsOf(Object.assign({}, rowFacts, { sentStatus: nestedFacts.status }), ctx.me, lines)
  };
}
/** one row, from its select row + what the page batch read for it */
function build(x, hydrated, ctx, now) {
  const { r: row, facts: nestedFacts } = x,
    id = String(row.chit_id);
  const detail = hydrated.detail.get(id) || {},
    business = detail.business_json || {};
  const orderInfo = openOrders.orderOf(row.summary_json);
  const lines = hydrated.progOk || detail.line_items ? linesOf(id, detail, hydrated.prog) : [];
  const seen = (hydrated.seen && hydrated.seen.get(id)) || null; /* B-F-15: the seller's status, for an order I sent */
  const rowFacts = factsOfRow(nestedFacts, seen, orderInfo, lines, hydrated.progOk);
  const cur2 = hydrated.assigned.get(id) || null;
  const heldLines = cur2 ? [...cur2.values()].filter((e) => e.assignee_actor_id || e.assignee_name).length : null;
  const shape = { row, id, business, orderInfo, currency: row.currency || null, hydrated, rowFacts, nestedFacts, lines, seen, heldLines, ctx, now };
  return { row: rowShape(shape), lines, f: rowFacts, cur2 };
}

/** ASSIGN gaps: may_assign + may_take on a list row = the server's verdict (lib/assign-register verdictOf, read once per request in routes/work.js), never a second rule */
const withVerdict = (row, ctx) => Object.assign(row, ctx.verdict || {});

const clampPage = (o) => ({
  page: Math.max(1, Math.floor(Number(o.page)) || 1),
  limit: Math.max(1, Math.min(PAGE_MAX, Math.floor(Number(o.limit)) || PAGE_DEFAULT))
});

/**
 * ⭐ RAIL-146b · THE COST VIEW, LAST. For a co-assist without can_see_costs (ctx.blind, read ONCE per request in routes/work.js) the finished rows are reshaped by lib/cost-view
 * (hideWorkCosts: a COPY, the work allowlist, cost_hidden:true when money was withheld) after the actions and totals were built from the real facts; the side of each row is
 * costSideOf over ONE blind-only read for the page (workSides). The owner and a cost-allowed actor pay nothing and get the rows as built.
 */
async function sidesFor(ctx, selectRows) {
  return withEntity(ctx.entity, (db) => costView.workSides(db, ctx.entity, selectRows));
}
/** the built rows of `items` as the caller may read them (same order) */
async function costSeen(ctx, items, rows) {
  if (!ctx.blind || !rows.length) return rows;
  const sides = await sidesFor(ctx, items.map((x) => x.r));
  return rows.map((row, index) => costView.hideWorkCosts(row, sides.get(String(items[index].r.chit_id)) || 'unknown'));
}

/**
 * list(ctx, opts) → { view, page, limit, truncated, counts|null, total|null, rows[] }
 *   ctx  { entity, actor, me, verdict?, now? }       opts { view, status, assigned: 'me'|'none'|<actor id>, q, page, limit }
 * ⚠️ `status` is a rail status (pending · accepted · in_progress …); the stage word is on every row.
 */
async function list(ctx, opts) {
  const options = opts || {};
  const view = VIEWS.includes(options.view) ? options.view : 'orders_in';
  const { page, limit } = clampPage(options);
  const { items, truncated } = await copies(ctx.entity);
  const counts = truncated ? null : countsOf(items);
  let mine = items.filter((x) => x.tab === view);
  if (options.status) mine = mine.filter((x) => x.r.current_status === String(options.status));
  if (options.assigned === 'none') mine = mine.filter((x) => !x.r.assigned_to_actor_id);
  else if (options.assigned === 'me') mine = mine.filter((x) => x.r.assigned_to_actor_id && String(x.r.assigned_to_actor_id) === String(ctx.actor));
  else if (options.assigned) mine = mine.filter((x) => String(x.r.assigned_to_actor_id || '') === String(options.assigned));
  const searchText = String(options.q || '')
    .trim()
    .toLowerCase();
  if (searchText)
    mine = mine.filter((x) =>
      [
        x.r.manual_subject,
        x.r.auto_subject,
        x.r.counterparty_name,
        x.r.summary_json && x.r.summary_json.order_details && x.r.summary_json.order_details.name
      ].some((item) => item && String(item).toLowerCase().includes(searchText))
    );
  const total = mine.length;
  const slice = mine.slice((page - 1) * limit, page * limit);
  const hydrated = await hydrate(
    ctx.entity,
    ctx.actor,
    slice.map((x) => x.r.chit_id),
    slice.filter(isSentOrder).map((x) => x.r.chit_id)
  );
  const now = new Date(ctx.now || Date.now()).getTime();
  const rows = await costSeen(ctx, slice, slice.map((x) => withVerdict(build(x, hydrated, ctx, now).row, ctx)));
  return { view, page, limit, truncated, counts, total: truncated ? null : total, rows };
}

/** one line of the sheet: what was ordered, what has gone, who holds it now (and who held it), its settings, and the three per-line verdicts */
function lineSheet(line, actions, cur2) {
  const lineActions = cur2 && cur2.get ? cur2.get(line.line_id) : null;
  return {
    line_id: line.line_id,
    particulars: line.particulars,
    qty: line.qty,
    unit: line.unit,
    price_minor: null,
    delivered: line.delivered,
    theirs: line.theirs,
    over_theirs: line.over_theirs,
    remaining: line.remaining,
    assignment: lineActions
      ? {
          assignee_actor_id: lineActions.assignee_actor_id || null,
          assignee_name: lineActions.assignee_name || null,
          assignee_type: lineActions.assignee_type || null,
          history: lineActions.history || []
        }
      : null,
    settings: lineActions
      ? { due: lineActions.due_date || null, task: lineActions.task || null, note: lineActions.note || null, state: lineActions.state || 'open' }
      : { due: null, task: null, note: null, state: 'open' },
    actions: { assign_line: actions.assign_line, deliver_line: actions.deliver_line, amend: actions.amend }
  };
}

/**
 * one(ctx, chit_id) → the row + its lines, or null (not mine / not a task or order / not a chit): another shop's chit answers as nothing at all.
 * Lines carry delivered / remaining (the events), the line's current assignee with its history, and the three per-line verdicts.
 */
async function one(ctx, chit_id) {
  if (!UUID.test(String(chit_id || ''))) return null;
  const { items } = await copies(ctx.entity, { chit_id: String(chit_id) });
  if (!items.length) return null;
  const x = items[0];
  const hydrated = await hydrate(ctx.entity, ctx.actor, [x.r.chit_id], isSentOrder(x) ? [x.r.chit_id] : []);
  const built = build(x, hydrated, ctx, new Date(ctx.now || Date.now()).getTime());
  const currency = built.row.currency;
  const stated = x.r.summary_json && x.r.summary_json.money && x.r.summary_json.money.tax;
  const sheet = Object.assign({}, built.row, {
    tax_minor: stated == null ? null : minorOf(stated, currency), /* L-F-06: the tax the total already holds, as the chit states it (summary_json.money.tax, read never worked out); the sheet says "incl. <tax>" beside the total */
    lines: built.lines.map((item) => {
      const s = lineSheet(item, built.row.actions, built.cur2);
      s.price_minor = minorOf(item.price, currency);
      return s;
    })
  });
  return (await costSeen(ctx, [x], [sheet]))[0];
}

/**
 * unbilledOf(ctx, items) → { n, minor, currency } — WALK2 W11 (walk 18 Oct: the order said "Unpaid ₹420", Collections said "Nobody owes you"): the open
 * orders in that no bill names yet. "Billed" is open-orders' ONE mark (MARKS_SQL — the Tasks list's Billed tag), the value each order's own (pickValue,
 * the row's total_minor). A promise, not a debt: Finance says it beside what is owed, never in it. minor is null when the orders are in two currencies.
 */
async function unbilledOf(ctx, items) {
  const left = await unbilledItems(ctx, items);
  if (!ctx.blind || !left.length) return sumUnbilled(left);
  return blindSum(left, await sidesFor(ctx, left.map((x) => x.r)));
}
/**
 * unbilledByParty(ctx) → Map(party_id → { n, minor, currency }) | null — CRM-32 (walk W41: the Parties list said "Settled" for a party whose order was unpaid
 * but not billed yet): the SAME test and value as unbilledOf, grouped by the order's counterparty (a cost-blind reader: the RAIL-146b partial rule per party, minor null + cost_hidden unless every order is a sale). A party with none is absent. null = the shop has more
 * copies than one read takes (truncated): the figure is then LEFT OUT, never a wrong 0. One select read + one marks statement for the whole list.
 */
async function unbilledByParty(ctx) {
  const { items, truncated } = await copies(ctx.entity);
  if (truncated) return null;
  const by = new Map();
  const left = await unbilledItems(ctx, items);
  for (const x of left) {
    const partyId = x.r.counterparty_id ? String(x.r.counterparty_id) : null;
    if (partyId) by.set(partyId, (by.get(partyId) || []).concat(x));
  }
  /* RAIL-146e: a blind reader (ctx.blind, read once by the route) gets blindSum per party over ONE workSides read for the whole list; everyone else the plain sum */
  const sides = ctx.blind && left.length ? await sidesFor(ctx, left.map((x) => x.r)) : null;
  return new Map([...by].map(([partyId, mine]) => [partyId, sides ? blindSum(mine, sides) : sumUnbilled(mine)]));
}

/**
 * facts(ctx, opts) → { truncated, counts|null, lines[], figures } — the Home box and the till pill. A figure the server cannot compute is LEFT OUT, never 0.
 * orders_new = orders in still New; tasks_mine = tasks held by me.
 */
async function facts(ctx, opts) {
  const { items, truncated } = await copies(ctx.entity);
  if (truncated) return { truncated: true, counts: null, lines: [], figures: {} };
  const counts = countsOf(items);
  const orders_new = items.filter((x) => x.tab === 'orders_in' && workflow.stageOf(x.facts) === 'new').length;
  const tasks_mine = items.filter((x) => x.tab === 'tasks' && x.r.assigned_to_actor_id && String(x.r.assigned_to_actor_id) === String(ctx.actor)).length;
  const plural = (n, nestedOne, many) => n + ' ' + (n === 1 ? nestedOne : many || nestedOne + 's');
  const lines = [];
  if (orders_new) lines.push({ text: plural(orders_new, 'new order'), value: orders_new, tone: 'dn' });
  if (tasks_mine) lines.push({ text: plural(tasks_mine, 'task') + ' for you', value: tasks_mine });
  if (!lines.length) lines.push({ text: counts.orders_in ? plural(counts.orders_in, 'order') + ' open' : 'No open orders', value: counts.orders_in });
  const figures = { orders_new, tasks_mine, orders_in: counts.orders_in, orders_out: counts.orders_out, tasks: counts.tasks, done: counts.done };
  if (opts && opts.unbilled) figures.unbilled = await unbilledOf(ctx, items); /* asked for by Finance only: one more trip, never on the till pill */
  return { truncated: false, counts, lines, figures };
}

module.exports = { list, one, facts, unbilledByParty, VIEWS, LIMIT, PAGE_MAX, factsOf, countsOf, classify };
