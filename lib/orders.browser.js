/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
// @stage tested
// @stage-note [TILL-181] No server route reaches this yet, and being uncalled-and-unlabelled is how an
// @stage-note experiment gets mistaken for a shipped feature. The COUNTER calls every function here through
// @stage-note window.CBOrders, and tests/orders.test.js exercises the rules with no browser at all. The route
// @stage-note that will call it server-side is the shop hub, [TILL-178b], which is designed and not built.
/**
 * lib/orders.js — AN ORDER HELD OPEN AGAINST A SUBJECT. The rules, with no screen anywhere near them.
 *
 * ── ⚠️⚠️⚠️ WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────────────────────────────────
 *
 * Athi, on reading the first version: *"hope the changes are not tightly integrated to front end, ui — the
 * business function should stay away from rendering always, never ever tightly bound."*
 *
 * He was right and I had done exactly that. `orderStart`, `orderTotals`, `orderAddRound`, the PURPOSES registry
 * and the vocabulary were all written INSIDE till.html — the rendering file. They worked, and they were in the
 * wrong place, which is a different thing. Every rule here is now computed where the server can call it too,
 * and the page is left with one job: paint what this returns. [[feedback-ui-replaceable-logic-in-engines]]
 *
 * ── ⭐ WHAT IS A RULE AND WHAT IS A SCREEN ──────────────────────────────────────────────────────────────────────
 *
 * A RULE: may the same table open twice · what does this order come to · which round does a line belong to ·
 * when may it be settled · what does this vertical call a table.
 * A SCREEN: tiles, colours, where the button sits, what it says when there is nothing yet.
 *
 * Nothing below touches the DOM, `window`, localStorage or a global. Every function takes what it needs and
 * returns a value — which is also why the whole thing is testable without a browser.
 *
 * ── ⭐⭐⭐ AND IT IS NOT A RESTAURANT ────────────────────────────────────────────────────────────────────────────
 *
 * Strip the restaurant words out of "waiter" and nothing about food is left: an order held OPEN against a
 * SUBJECT, captured AWAY FROM THE TILL, fulfilled IN PARTS by ROUTED STATIONS, settled ONCE at the end. A sweet
 * shop with a token and three counters is the identical pattern. So a shop declares two FACTS about itself
 * rather than picking a trade, and the words are a translation.
 * [[feedback-the-data-decides-not-the-trade]] [[project-string-layer]]
 */

/** the three things a counter can be for. A new one is a row here and needs no code anywhere else. */
const PURPOSES = {
  billing: { label: 'Billing',   hint: 'one bill, taken and closed — a shop counter',
             open_orders: false, route_lines: false },
  order:   { label: 'Order pad', hint: 'orders held open against a table or token, added to, billed at the end',
             open_orders: true,  route_lines: true },
  /* ⭐ the station's own view of the same orders — the third participant, not a third product */
  station: { label: 'Station',   hint: 'a kitchen, section or bay — the lines it must make, and marking them ready',
             open_orders: true,  route_lines: true, makes_only: true },
};

/** the restaurant's words, because that is the shop in front of us; every one is overridable per shop */
const WORDS = { subject: 'table', subjects: 'tables', station: 'kitchen', stations: 'kitchens', round: 'round' };

function purposeOf(opt) {
  const p = (opt && opt.purpose) || 'billing';
  return PURPOSES[p] ? p : 'billing';
}
function purposeHas(opt, flag) { const p = PURPOSES[purposeOf(opt)]; return !!(p && p[flag]); }
/** ⭐ the shop's own word for a thing, so no screen hard-codes "table" */
function says(opt, k) { const w = (opt && opt.words) || {}; return w[k] || WORDS[k] || k; }

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * ⚠️⚠️ THE SAME SUBJECT MAY NOT BE OPEN TWICE. Two orders on table 7 is two bills for one table — the same
 * failure as two counters both numbering as C1, which cost a shop 29 duplicated bills. So this RETURNS THE ONE
 * ALREADY OPEN rather than refusing, because the waiter's intent was to reach that table either way.
 */
function findOpen(orders, subject) {
  const s = String(subject == null ? '' : subject).trim().toLowerCase();
  if (!s) return null;
  return (orders || []).filter((o) => o.state === 'open' && String(o.subject).toLowerCase() === s)[0] || null;
}

/** a new order, or the one already open on that subject. Never two. */
function start(orders, subject, by, ctx) {
  const s = String(subject == null ? '' : subject).trim();
  if (!s) return null;
  const had = findOpen(orders, s);
  if (had) return had;
  const c = ctx || {};
  return {
    id: 'O' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    subject: s, state: 'open', at: c.at || new Date().toISOString(),
    by: by || null, till: c.till || null, kind: c.kind || 'dine',
    lines: [], rounds: 0,
  };
}

function openOnly(orders) { return (orders || []).filter((o) => o && o.state === 'open'); }

/** ⭐ ONE READER for what an order comes to, so no screen adds up its own version */
function totals(o) {
  const lines = (o && o.lines) || [];
  let total = 0, n = 0, waiting = 0;
  lines.forEach((l) => {
    if (l.void) return;
    n++; total = r2(total + (Number(l.net) || 0));
    if (l.round && !l.ready) waiting++;
  });
  return { lines: n, total, rounds: (o && o.rounds) || 0, waiting };
}

/**
 * ⚠️ THE ROUND IS STAMPED ONCE AND NEVER RE-STAMPED. A round is what went to the station together; a number
 * that can change afterwards is not a record of anything.
 * ⭐ round 0 means TYPED BUT NOT SENT — the lines a waiter had entered when he walked to another table. They
 * belong to the order he was standing at, and they have not been fired.
 */
function addRound(o, lines, at) {
  if (!o || !lines || !lines.length) return null;
  o.rounds = (Number(o.rounds) || 0) + 1;
  const n = o.rounds;
  lines.forEach((c) => {
    const l = Object.assign({}, c);
    l.round = n; l.at = at || new Date().toISOString();
    o.lines.push(l);
  });
  return n;
}
function hold(o, lines, at) {
  if (!o || !lines || !lines.length) return 0;
  lines.forEach((c) => {
    const l = Object.assign({}, c);
    l.round = 0; l.at = at || new Date().toISOString();
    o.lines.push(l);
  });
  return lines.length;
}

/** what would be billed — every line that has not been voided, in the order it was added */
function billable(o) { return ((o && o.lines) || []).filter((l) => !l.void); }

/**
 * ⚠️ MAY IT BE SETTLED? A rule, not a button state — the screen asks and paints the answer, and the server can
 * ask the same question of the same order.
 */
function canSettle(o) {
  if (!o) return { ok: false, why: 'no such order' };
  if (o.state !== 'open') return { ok: false, why: 'it is already ' + o.state };
  if (!billable(o).length) return { ok: false, why: 'nothing on it yet' };
  return { ok: true };
}

/** ⭐ how long it has been open — the first thing anybody asks about a table */
function age(o, now) {
  if (!o || !o.at) return '';
  const m = Math.round(((now || Date.now()) - new Date(o.at).getTime()) / 60000);
  return m < 60 ? (m + ' min') : (Math.floor(m / 60) + 'h ' + (m % 60) + 'm');
}

/**
 * ⚠️ NO SELF-ASSIGNED GLOBAL HERE, DELIBERATELY — wrapForBrowser() rewrites the export line into a plain
 * var and assigns window.CBOrders itself. Same note as lib/rollup.js.
 *
 * ⚠⚠ AND THIS COMMENT MUST NOT SPELL THE PATTERN OUT. The wrapper rewrites the FIRST match in the file, and
 * the first draft of this note quoted the export keyword twice — so the wrapper rewrote the COMMENT and left
 * the real export alone, and the browser answered "module is not defined". till-vendor.test.js caught it by
 * actually executing the file, which is the only way that fault is visible.
 */
var EXPORTS = { PURPOSES, WORDS, purposeOf, purposeHas, says,
                   start, findOpen, openOnly, totals, addRound, hold, billable, canSettle, age };

window.CBOrders = EXPORTS;
})();
