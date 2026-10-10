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
const INV = require('./folder-inventory');
const workflow = require('./workflow');
const railActions = require('./rail-actions');
const openOrders = require('./open-orders');
const deliverline = require('./deliverline');
const assign = require('./assign');
const schema = require('./schema');
const money = require('./money');
const { readBatch } = require('../db');

const LIMIT = 5000;            /* one read takes this many of my copies (home-facts RAIL_LIMIT) */
const PAGE_DEFAULT = 50, PAGE_MAX = 100;
const VIEWS = ['orders_in', 'orders_out', 'tasks', 'done'];   /* drafts wait for the compose route; the engine already knows the tab */
const DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the facts the engine asks about MY copy of a select row */
function factsOf(r, entity) {
  const received = r.direction === 'received';
  const side = r.purpose === 'order' ? openOrders.sideOf(r, { side: r.biz_side }) : null;
  return { held: true, received: received ? r.current_status : null, sender: String(r.sender_entity_id) === String(entity),
    status: r.current_status, purpose: r.purpose, side, draft: false, deleted: false, archived: false };
}

/**
 * my copies, classified: [{ r, facts, tab }] — the copies that are tasks or orders (a document that leaves the Task / Order lists, a bill, a
 * receipt, an expense, is left out by the SAME list the inbox uses), one per chit (a note to self holds two copies: the received one counts).
 */
async function copies(entity, sel) {
  const rows = await select.rows(entity, Object.assign({ limit: LIMIT }, sel || {}));
  const by = new Map();
  for (const r of rows) {
    if (INV.LEAVES.includes(r.doc_kind || '')) continue;
    const k = String(r.chit_id), had = by.get(k);
    if (had && had.direction === 'received') continue;
    if (!had || r.direction === 'received') by.set(k, r);
  }
  const items = [...by.values()].map((r) => { const facts = factsOf(r, entity); return { r, facts, tab: workflow.tabOf(facts) }; })
    .filter((x) => x.r.purpose === 'order' || x.r.direction === 'received');   /* a task is something that came to me; an order is either way */
  return { items, truncated: rows.length >= LIMIT };
}

/** folder counts over a classified, untruncated read — the number on each tab (open work; Done counts the closed) */
function countsOf(items) {
  const c = { orders_in: 0, orders_out: 0, tasks: 0, done: 0 };
  for (const x of items) if (x.tab in c) c[x.tab]++;
  return c;
}

const minorOf = (v, cur) => {
  if (v == null || !isFinite(Number(v))) return null;
  const c = cur || 'INR';
  return Math.round(money.round(Number(v), c) * Math.pow(10, money.decimals(c)));
};
const pickValue = (r) => [r.value, r.alt_value].find((v) => v != null && Number(v) > 0);

/** every action with its verdict; a refused one carries the sentence that greys it (the server answers may/why for THIS login) */
function actionsOf(facts, me) {
  const a = workflow.actions(facts, me), out = {};
  for (const k of Object.keys(a)) out[k] = a[k].ok ? a[k] : Object.assign({}, a[k], { say: workflow.say(a[k].why) });
  return out;
}

/** ONE batched read for the chits on this page: header+lines, marks, delivery progress, line assignments → in one trip */
async function hydrate(entity, actor, ids) {
  if (!ids.length) return { detail: new Map(), marks: { despatched: new Set(), billed: new Set() }, prog: new Map(), assigned: new Map(), progOk: true, assignOk: true };
  const [hasLines, hasDeliv, hasAssign] = await Promise.all([schema.hasTable('chit_line'), schema.hasTable('chit_line_delivery'), schema.hasTable('chit_line_assignment')]);
  const progOk = hasLines && hasDeliv, assignOk = hasAssign;
  const sIds = ids.map(String);
  const stmts = [
    { text: `SELECT h.chit_id, d.line_items, h.business_json FROM chit_header h
               LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
              WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`, params: [entity, sIds] },
    { text: openOrders.MARKS_SQL, params: [entity, sIds] },
  ];
  if (progOk) stmts.push({ text: deliverline.PROGRESS_SQL('l.chit_id = ANY($2::uuid[])'), params: [entity, sIds] });
  if (assignOk) stmts.push({ text: `SELECT chit_id, line_id, seq, assignee_actor_id, assignee_name, assignee_type, task, due_date::text AS due_date,
                note, created_at, COALESCE(to_jsonb(chit_line_assignment)->>'state', 'open') AS state
           FROM chit_line_assignment WHERE entity_id = $1 AND chit_id = ANY($2::uuid[]) ORDER BY chit_id, line_id, seq`, params: [entity, sIds] });
  const res = await readBatch(entity, actor, stmts);
  let i = 0;
  const detail = new Map(res[i++].rows.map((r) => [String(r.chit_id), r]));
  const marks = openOrders.marksFrom(res[i++].rows);
  /* deliverline.progressMany / assign.current take a db or the rows themselves — the rows are already here, so they are handed over, not re-read */
  let prog = new Map();
  if (progOk) { const rows = res[i++].rows; prog = (await deliverline.progressMany(entity, sIds, { query: async () => ({ rows }) })) || new Map(); }
  const assigned = new Map();
  if (assignOk) {
    const by = new Map();
    for (const r of res[i++].rows) { const k = String(r.chit_id); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    for (const [k, rows] of by) assigned.set(k, await assign.current(entity, k, null, rows));
  }
  return { detail, marks, prog, assigned, progOk, assignOk };
}

/** the line facts of one chit from its frozen lines + the delivery progress: [{ line_id, particulars, qty, unit, price, delivered, remaining }] */
function linesOf(chit_id, det, prog) {
  const p0 = prog.get(String(chit_id));
  return (Array.isArray(det && det.line_items) ? det.line_items : []).map((l, i) => {
    const line_id = deliverline.lineIdOf(chit_id, l, i + 1);
    const p = p0 && p0.get ? p0.get(line_id) : null;
    const qty = Number(l.quantity) || 0;
    const delivered = p && p.delivered != null ? Number(p.delivered) : 0;
    return { line_id, particulars: l.particulars || l.name || '', qty, unit: l.unit || 'piece', price: l.price == null ? null : Number(l.price),
      delivered, remaining: Math.max(0, Math.round((qty - delivered) * 1000) / 1000), removed: !!(p && p.removed) };
  }).filter((l) => !l.removed);
}

/** one row, from its select row + what the page batch read for it */
function build(x, H, ctx, now) {
  const { r, facts } = x, id = String(r.chit_id);
  const det = H.detail.get(id) || {}, bj = det.business_json || {};
  const cur = r.currency || null;
  const ord = openOrders.orderOf(r.summary_json);
  const lines = H.progOk || det.line_items ? linesOf(id, det, H.prog) : [];
  const haveLines = lines.length > 0 && H.progOk;
  const open = lines.filter((l) => l.remaining > 0).length;
  const f = Object.assign({}, facts, { lines_open_n: haveLines ? open : 0, delivered_all: haveLines && open === 0, fulfilment: ord ? ord.fulfilment : null });
  const cur2 = H.assigned.get(id) || null;
  const heldLines = cur2 ? [...cur2.values()].filter((e) => e.assignee_actor_id || e.assignee_name).length : null;
  const pick = pickValue(r), total = pick == null ? null : Number(pick);
  const age = Math.round(((now - new Date(r.created_at).getTime()) / DAY) * 10) / 10;
  return {
    row: {
      chit_id: r.chit_id, kind: workflow.kindOf(f), tab: workflow.tabOf(f), stage: workflow.stageOf(f), word: workflow.wordOf(f),
      status: r.current_status || null, side: f.side,
      subject: r.manual_subject || r.auto_subject || '', ref: bj.order_no || bj.ref || null,
      party: (ord && ord.name) || r.counterparty_name || (bj.party && bj.party.name) || null, party_id: r.counterparty_id || null,
      channel: ord ? ord.channel : null, fulfilment: ord ? ord.fulfilment : null, address: ord ? ord.address : null,
      requested_for: ord ? ord.requested_delivery : null, remark: ord ? ord.remark : null,
      total_minor: minorOf(total, cur), currency: cur,
      lines_n: H.progOk ? lines.length : null, lines_open_n: H.progOk ? open : null,
      billed: H.marks.billed.has(id), despatched: H.marks.despatched.has(id),
      assignee: r.assigned_to_actor_id ? { id: r.assigned_to_actor_id, name: r.assigned_to_actor_display_name || null } : null,
      lines_assigned_n: heldLines,
      created_at: r.created_at, age_days: age,
      actions: actionsOf(f, ctx.me),
    },
    lines, f, cur2,
  };
}

const clampPage = (o) => ({ page: Math.max(1, Math.floor(Number(o.page)) || 1), limit: Math.max(1, Math.min(PAGE_MAX, Math.floor(Number(o.limit)) || PAGE_DEFAULT)) });

/**
 * list(ctx, opts) → { view, page, limit, truncated, counts|null, total|null, rows[] }
 *   ctx  { entity, actor, me, now? }       opts { view, status, assigned: 'me'|'none'|<actor id>, q, page, limit }
 * ⚠️ `status` is a rail status (pending · accepted · in_progress …); the stage word is on every row.
 */
async function list(ctx, opts) {
  const o = opts || {};
  const view = VIEWS.includes(o.view) ? o.view : 'orders_in';
  const { page, limit } = clampPage(o);
  const { items, truncated } = await copies(ctx.entity);
  const counts = truncated ? null : countsOf(items);
  let mine = items.filter((x) => x.tab === view);
  if (o.status) mine = mine.filter((x) => x.r.current_status === String(o.status));
  if (o.assigned === 'none') mine = mine.filter((x) => !x.r.assigned_to_actor_id);
  else if (o.assigned === 'me') mine = mine.filter((x) => x.r.assigned_to_actor_id && String(x.r.assigned_to_actor_id) === String(ctx.actor));
  else if (o.assigned) mine = mine.filter((x) => String(x.r.assigned_to_actor_id || '') === String(o.assigned));
  const q = String(o.q || '').trim().toLowerCase();
  if (q) mine = mine.filter((x) => [x.r.manual_subject, x.r.auto_subject, x.r.counterparty_name, (x.r.summary_json && x.r.summary_json.order_details && x.r.summary_json.order_details.name)]
    .some((t) => t && String(t).toLowerCase().includes(q)));
  const total = mine.length;
  const slice = mine.slice((page - 1) * limit, page * limit);
  const H = await hydrate(ctx.entity, ctx.actor, slice.map((x) => x.r.chit_id));
  const now = new Date(ctx.now || Date.now()).getTime();
  return { view, page, limit, truncated, counts, total: truncated ? null : total, rows: slice.map((x) => build(x, H, ctx, now).row) };
}

/** one line of the sheet: what was ordered, what has gone, who holds it now (and who held it), its settings, and the three per-line verdicts */
function lineSheet(l, actions, cur2) {
  const a = cur2 && cur2.get ? cur2.get(l.line_id) : null;
  return {
    line_id: l.line_id, particulars: l.particulars, qty: l.qty, unit: l.unit, price_minor: null,
    delivered: l.delivered, remaining: l.remaining,
    assignment: a ? { assignee_actor_id: a.assignee_actor_id || null, assignee_name: a.assignee_name || null, assignee_type: a.assignee_type || null, history: a.history || [] } : null,
    settings: a ? { due: a.due_date || null, task: a.task || null, note: a.note || null, state: a.state || 'open' } : { due: null, task: null, note: null, state: 'open' },
    actions: { assign_line: actions.assign_line, deliver_line: actions.deliver_line, amend: actions.amend },
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
  const H = await hydrate(ctx.entity, ctx.actor, [x.r.chit_id]);
  const b = build(x, H, ctx, new Date(ctx.now || Date.now()).getTime());
  const cur = b.row.currency;
  return Object.assign({}, b.row, {
    lines: b.lines.map((l) => { const s = lineSheet(l, b.row.actions, b.cur2); s.price_minor = minorOf(l.price, cur); return s; }),
  });
}

/**
 * facts(ctx) → { truncated, counts|null, lines[], figures } — the Home box and the till pill. A figure the server cannot compute is LEFT OUT, never 0.
 * orders_new = orders in still New; tasks_mine = tasks held by me.
 */
async function facts(ctx) {
  const { items, truncated } = await copies(ctx.entity);
  if (truncated) return { truncated: true, counts: null, lines: [], figures: {} };
  const counts = countsOf(items);
  const orders_new = items.filter((x) => x.tab === 'orders_in' && workflow.stageOf(x.facts) === 'new').length;
  const tasks_mine = items.filter((x) => x.tab === 'tasks' && x.r.assigned_to_actor_id && String(x.r.assigned_to_actor_id) === String(ctx.actor)).length;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  const lines = [];
  if (orders_new) lines.push({ text: plural(orders_new, 'new order'), value: orders_new, tone: 'dn' });
  if (tasks_mine) lines.push({ text: plural(tasks_mine, 'task') + ' for you', value: tasks_mine });
  if (!lines.length) lines.push({ text: counts.orders_in ? plural(counts.orders_in, 'order') + ' open' : 'No open orders', value: counts.orders_in });
  return { truncated: false, counts, lines, figures: { orders_new, tasks_mine, orders_in: counts.orders_in, orders_out: counts.orders_out, tasks: counts.tasks, done: counts.done } };
}

module.exports = { list, one, facts, VIEWS, LIMIT, PAGE_MAX, factsOf, countsOf };
