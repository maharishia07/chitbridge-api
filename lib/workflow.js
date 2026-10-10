/* ADOPTED from chitbridge-engines v1.33.0 · workflow · sha256 47ce724d1c994fafbaa5d898f358e032445ed7266548cfe2b6e3f395c51ad7c3 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · workflow. Edited ONLY in chitbridge-engines/src/workflow.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/**
 * ── ⭐⭐⭐ workflow.js — WHERE IS THIS ORDER, AND WHAT MAY I DO WITH IT? ONE ANSWER FOR THE LIST, THE SHEET AND THE ROUTE (TO1/E1, 2026-10-10) ─
 *
 * Tasks & Orders (TASKS-ORDERS-PLAN §3b). Three places used to decide "which folder is this in, which word does it wear, which buttons
 * work": the page's visibleRows, chit-sheet.js actionsFor and statusWordFor. This file is the one. The api's work routes answer with it
 * (`rows[].tab · stage · word`, `actions`), and tasks.html paints exactly that — page and server cannot disagree.
 *
 * ⚠️ IT WRAPS lib/rail.js (CBRail), IT DOES NOT FORK IT. Every status step — accept, reject, complete, cancel, reopen — is asked of
 * rail.move / rail.can, so the transition table and the viewer / commenter / editor ladder stay in ONE file. This file adds only what
 * rail has no word for: the folder an order sits in, the five-word stage, and what a step needs from the person (`needs`).
 * tests/workflow.test.js holds PARITY: for every rail transition and every level, the workflow answer is rail's answer.
 *
 * ⚠️ NOT DECIDED YET (Athi's D-1 · D-2 · D-3): no RFQ / RFP kind, no "ready" or "billed" STATE, no refusal of a task-level assign
 * when lines are assigned. Facts that the host already knows (`billed`, `delivered_all`) travel as FACTS and colour the word, nothing
 * more; no action here depends on them.
 *
 * ⭐ PURE: no database, no clock, no storage. Facts in, a verdict out.
 *   chit = { held, received, sender,              — facts about MY copy (as rail): received = the status of my RECEIVED copy or null
 *            status,                              — the status the row WEARS: my received copy's, or on an order I sent the receiver's
 *            purpose, side: 'buy'|'sell',         — side is lib/open-orders sideOf (declared, never inferred from direction)
 *            draft, deleted, archived,            — the folder flags
 *            delivered_all, lines_open_n, fulfilment }
 *   me   = { level }                              — as rail
 */

const STAGES = ['new', 'accepted', 'delivered', 'closed'];
const TABS = [
  { id: 'orders_in',  label: 'Orders in' },
  { id: 'orders_out', label: 'Orders out' },
  { id: 'tasks',      label: 'Tasks' },
  { id: 'drafts',     label: 'Drafts' },
  { id: 'done',       label: 'Done' },
];
/** every kind this engine knows; a request kind (RFQ / RFP / service) waits for D-1 */
const KINDS = ['order_in', 'order_out', 'task'];
/** the actions answered; each one is a step the api already makes, or a rail verdict re-used */
const ACTIONS = ['accept', 'reject', 'complete', 'cancel', 'reopen', 'assign_task', 'assign_line', 'deliver_line', 'amend'];

/** the status each step moves my received copy to (rail STEP_OF, plus the two rail has a transition for but no action word) */
const STEP_TO = { accept: 'accepted', reject: 'rejected', complete: 'completed', cancel: 'cancelled', reopen: 'in_progress' };
/** the rail action whose LEVEL rule an action borrows — no new permission */
const BASE = { assign_task: 'assign', assign_line: 'assign', deliver_line: 'assign', amend: 'amend' };
/** rail statuses that are an end of the road */
const CLOSED = ['completed', 'rejected', 'cancelled'];
const OPEN_NEW = ['pending', 'delivered', 'read'];

const SAY = {
  new:      { order_in: 'New', order_out: 'Sent', task: 'New' },
  accepted: { order_in: 'Accepted', order_out: 'Accepted', task: 'Started' },
  delivered:{ order_in: 'Delivered', order_out: 'Received', task: 'Done, to close' },
  closed:   { order_in: 'Closed', order_out: 'Closed', task: 'Closed' },
};

/* rail, found wherever this copy runs — CBRail on a page, ./rail in node (looked up per call: load order is free) */
let RAIL_ = null;
function rail() {
  if (typeof CBRail !== 'undefined' && CBRail.move) return CBRail;
  if (RAIL_ === null && typeof require === 'function') { try { RAIL_ = require('./rail.js'); } catch (_) { RAIL_ = false; } }
  if (!RAIL_) throw new Error('workflow: the rail engine is not loaded — load rail.js (CBRail) before workflow.js');
  return RAIL_;
}

const no = (why, extra) => Object.assign({ ok: false, why }, extra || {});

/** order_in · order_out · task. An order faces by its DECLARED side; anything that is not an order is a task. */
function kindOf(chit) {
  const c = chit || {};
  if (c.purpose !== 'order') return 'task';
  return c.side === 'buy' ? 'order_out' : 'order_in';
}

/** the five-word stage (four today — "ready" waits for D-2): new · accepted · delivered · closed, from the rail status plus one fact */
function stageOf(chit) {
  const c = chit || {};
  const s = c.status || c.received || 'pending';
  if (CLOSED.includes(s)) return 'closed';
  if (OPEN_NEW.includes(s)) return 'new';
  return c.delivered_all ? 'delivered' : 'accepted';
}

/** the folder tab a chit shows in — replaces the page's visibleRows */
function tabOf(chit) {
  const c = chit || {};
  if (c.draft) return 'drafts';
  if (c.deleted || c.archived || stageOf(c) === 'closed') return 'done';
  const k = kindOf(c);
  return k === 'order_in' ? 'orders_in' : k === 'order_out' ? 'orders_out' : 'tasks';
}

/** the shopkeeper's word for where it is. A closed order says HOW it closed (Rejected · Cancelled), and a pick-up says "Handed over". */
function wordOf(chit) {
  const c = chit || {};
  const st = stageOf(c), k = kindOf(c);
  if (st === 'closed') {
    const s = c.status || c.received;
    if (s === 'rejected') return 'Rejected';
    if (s === 'cancelled') return 'Cancelled';
    return k === 'task' ? 'Done' : SAY.closed[k];
  }
  if (st === 'delivered' && k === 'order_in' && c.fulfilment === 'pickup') return 'Handed over';
  return SAY[st][k];
}

/** the folder tabs, in the order the screen shows them */
function tabs() { return TABS.map((t) => Object.assign({}, t)); }

/** the stages an order of this kind passes, with the word each wears */
function stages(kind) {
  const k = KINDS.includes(kind) ? kind : 'task';
  return STAGES.map((id) => ({ id, label: SAY[id][k] }));
}

/** what a step needs from the person besides the click: reject says why; completing with lines still open says why */
function needs(chit, action) {
  const c = chit || {};
  if (action === 'reject') return ['reason'];
  if (action === 'complete' && (Number(c.lines_open_n) || 0) > 0) return ['reason'];
  return [];
}

/**
 * can(chit, me, action) → { ok: true [, needs] } | { ok: false, why }. `why` is ALWAYS a key of rail's WHY (say() writes it).
 *   status steps  accept · reject · complete · cancel · reopen → rail.move to the step's status (rail's own refusal, word for word;
 *                 a step already taken is `already_done`). reopen is only for a closed order — from an open one it is `wrong_step`.
 *   the rest      assign_task · assign_line · deliver_line · amend → the level and "I hold it" rule of the rail action each borrows.
 */
function can(chit, me, action) {
  if (!ACTIONS.includes(action)) throw new Error('workflow.can: unknown action "' + action + '" — the actions are ' + ACTIONS.join(', '));
  const R = rail(), c = chit || {};
  let v;
  if (STEP_TO[action]) {
    if (action === 'reopen' && !CLOSED.includes(c.received || c.status || '')) {
      const lv = R.byLevel(me && me.level, 'move');
      v = lv ? no(lv) : (!c.held ? no('not_participant') : (!c.received ? no('not_received') : no('wrong_step')));
    } else {
      const m = R.move(c, me, STEP_TO[action]);
      v = m.noop ? no('already_done') : (m.ok ? { ok: true } : no(m.why));
    }
  } else {
    const b = R.can(c, me, BASE[action]);
    v = b.ok ? { ok: true } : no(b.why);
  }
  if (v.ok) { const n = needs(c, action); if (n.length) v.needs = n; }
  return v;
}

/** actions(chit, me) — EVERY action with its verdict (shown, and greyed with its sentence when refused) */
function actions(chit, me) {
  const out = {};
  for (const a of ACTIONS) out[a] = can(chit, me, a);
  return out;
}

/** say(why) — the sentence for a refusal word (rail's vocabulary: no host invents one) */
function say(why) { return rail().say(why); }

const EXPORTS = { kindOf, stageOf, tabOf, wordOf, tabs, stages, needs, can, actions, say, KINDS, STAGES, TABS, ACTIONS, STEP_TO };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBWorkflow. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBWorkflow = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
