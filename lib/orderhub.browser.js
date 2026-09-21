/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
// @stage tested
// @stage-note [TILL-178b] The rules a SHOP HUB applies when several devices share one set of orders. till.js
// @stage-note mounts these over HTTP and e2e/till-lan.cjs drives three devices through them with the internet
// @stage-note genuinely destroyed. Pure on purpose: no http, no DOM, no storage, so the same file can be the
// @stage-note shop PC's memory today and a table in Postgres later without a rule changing.
/**
 * lib/orderhub.js — ONE SET OF ORDERS, SHARED BY DEVICES THAT CANNOT SEE THE INTERNET.
 *
 * ── ⚠️⚠️⚠️ THE QUESTION THIS ANSWERS ────────────────────────────────────────────────────────────────────────
 *
 * Athi: *"also should be known, does it work offline, when the network is off? …because it is multiple
 * participants"* and then *"how do we prove without internet the entire cycle works, as a local network?"*
 *
 * A single counter surviving an outage was already proved (e2e/till-selfheal.cjs): it keeps selling and drains
 * the queue when the line returns. A FLOOR is a different claim. A waiter's phone, a kitchen screen and the
 * counter are three devices, and localStorage is shared by nothing — three islands, each certain it holds the
 * truth. So the floor needs somewhere IN THE SHOP for the orders to live. That is this file.
 *
 * ── ⭐⭐⭐ APPENDS, NOT OVERWRITES ───────────────────────────────────────────────────────────────────────────
 *
 * The naive hub takes whole orders and keeps the last one it received. On one wifi with three devices that
 * loses a round every time two people act inside a poll interval: the waiter's copy, saved a second later, has
 * never heard of the line the kitchen just marked ready, and writes the old truth back over the new one.
 *
 * So a device never sends its copy of an order. It sends WHAT IT DID — open, round, hold, ready, settle — and
 * the hub applies it to the copy it holds. Two devices acting at once produce two appends and both survive,
 * which is the only conflict rule that needs no clock and no arbitration. [[feedback-partial-writes-merge-patch]]
 *
 * ⭐ EVERY CHANGE CARRIES A SEQUENCE NUMBER, so a device asks "what happened after 41" and is handed only that.
 * A kitchen screen on a tired phone must not re-read the whole evening every two seconds.
 *
 * ⚠️ THE RULES THEMSELVES ARE NOT REPEATED HERE. Whether a table may open twice, what an order comes to, whether
 * it may be settled — all of that is lib/orders.js, and this file CALLS it. A hub with its own opinion about
 * tables is a second implementation that will disagree with the counter within a month.
 * [[feedback-no-duplicate-functions]] [[feedback-stay-in-the-construct]]
 */
const ORD = window.CBOrders;

/** a hub's whole memory. Handed in and returned, never a module global — one process may serve one shop. */
function create() { return { orders: [], seq: 0 }; }

function find(hub, id) {
  const all = (hub && hub.orders) || [];
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

/** everything a device may say about an order it can already name. `open` is separate: it has no id yet. */
const DOES = { round: 1, hold: 1, ready: 1, settle: 1, settled: 1, reopen: 1 };

/** ⭐ stamp a change so a device can ask for only what it has not seen */
function bump(hub, o) { hub.seq++; o.seq = hub.seq; return hub.seq; }

/**
 * ⚠️⚠️ WHAT A DEVICE SENDS. One message, applied to the hub's own copy. Returns { ok, order, seq } or
 * { ok:false, why } — and `why` is a sentence a screen can show, not a code, because the device that sent it is
 * the one standing in front of the person who needs to know. [[feedback-silence-is-the-bug]]
 */
function apply(hub, msg) {
  if (!hub || !msg || !msg.do) return { ok: false, why: 'nothing was sent' };
  const now = msg.at || new Date().toISOString();

  if (msg.do === 'open') {
    /* ⭐ THE ENGINE DECIDES, NOT THE HUB. Two waiters typing table 7 at once both reach the same order. */
    const o = ORD.start(hub.orders, msg.subject, msg.by, { till: msg.till, kind: msg.kind, at: now });
    if (!o) return { ok: false, why: 'that needs a number' };
    if (hub.orders.indexOf(o) < 0) { hub.orders.push(o); bump(hub, o); }
    return { ok: true, order: o, seq: hub.seq };
  }

  /**
   * ⚠️ THE VERB IS CHECKED BEFORE THE ORDER IS LOOKED FOR. The first draft did it the other way round, so a
   * message the hub had never heard of came back "that order is not on this hub" — perfectly true, and it
   * would have sent somebody hunting for a missing table instead of a misspelt word.
   */
  if (!DOES[msg.do]) return { ok: false, why: 'the hub does not know how to ' + msg.do };
  const o = find(hub, msg.id);
  if (!o) return { ok: false, why: 'that order is not on this hub' };

  if (msg.do === 'round') {
    const n = ORD.addRound(o, msg.lines || [], now);
    if (n == null) return { ok: false, why: 'nothing was on it to send' };
    bump(hub, o);
    return { ok: true, order: o, seq: hub.seq, round: n };
  }

  if (msg.do === 'hold') {
    if (!ORD.hold(o, msg.lines || [], now)) return { ok: false, why: 'nothing was typed' };
    bump(hub, o);
    return { ok: true, order: o, seq: hub.seq };
  }

  /**
   * ⭐⭐ THE KITCHEN'S ONLY VERB. It marks lines made — it never prices, never bills, never opens a table.
   * A station that could settle an order is a station that can be robbed by a tired thumb.
   */
  if (msg.do === 'ready') {
    const want = {};
    (msg.lines || []).forEach(function (k) { want[String(k)] = 1; });
    let hit = 0;
    o.lines.forEach(function (l, i) {
      if (!l.round || l.void) return;                     /* held lines were typed, never sent */
      const key = l.line_id || String(i);
      const mine = msg.all ? (!msg.station || l.station === msg.station) : (want[key] || want[String(i)]);
      if (mine && !l.ready) { l.ready = true; l.ready_at = now; hit++; }
    });
    if (!hit) return { ok: false, why: 'nothing there was still waiting' };
    bump(hub, o);
    return { ok: true, order: o, seq: hub.seq, made: hit };
  }

  if (msg.do === 'settle') {
    /* ⚠️ THE GAP THAT MATTERS: two devices billing one table. The hub is the only place that can close it,
       because it is the only thing both devices talk to. The engine judges; the hub is where the judgement
       happens once. */
    const may = ORD.canSettle(o);
    if (!may.ok) return { ok: false, why: may.why };
    o.state = 'settling'; o.settling_by = (msg.by && msg.by.id) || null; bump(hub, o);
    return { ok: true, order: o, seq: hub.seq };
  }

  if (msg.do === 'settled') {
    o.state = 'settled'; o.settled_at = now; o.bill = msg.bill || null; bump(hub, o);
    return { ok: true, order: o, seq: hub.seq };
  }

  /** ⚠️ a billing that failed must put the table back, or nobody can bill it ever again */
  if (msg.do === 'reopen') {
    o.state = 'open'; o.settling_by = null; bump(hub, o);
    return { ok: true, order: o, seq: hub.seq };
  }

  /* unreachable — DOES is checked above. Left so a verb added to DOES and forgotten here still answers. */
  return { ok: false, why: 'the hub does not know how to ' + msg.do };
}

/** ⭐ what a device has not seen. since(hub, 0) is the whole evening; a kitchen screen asks for far less. */
function since(hub, seq) {
  const from = Number(seq) || 0;
  return { seq: (hub && hub.seq) || 0, orders: ((hub && hub.orders) || []).filter(function (o) { return (o.seq || 0) > from; }) };
}

/**
 * ⭐⭐ WHAT ONE STATION MUST MAKE, oldest first — the kitchen screen's whole query. Lines that were held
 * (round 0) are invisible here on purpose: they were typed and never sent, and a kitchen must not cook a thought.
 */
function queue(hub, station) {
  const out = [];
  ((hub && hub.orders) || []).forEach(function (o) {
    if (o.state === 'settled') return;
    o.lines.forEach(function (l, i) {
      if (!l.round || l.ready || l.void) return;
      if (station && l.station !== station) return;
      out.push({ order_id: o.id, subject: o.subject, line_id: l.line_id || String(i),
                 name: l.name, qty: l.qty, round: l.round, at: l.at, station: l.station || null,
                 kind: o.kind || 'dine' });
    });
  });
  /* ⚠️ OLDEST FIRST — a kitchen works a queue, and a screen sorted by table number starves table 12 */
  return out.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
}

/** the stations this shop's own menu mentions — nobody should configure a list the items already state */
function stations(items) {
  const seen = {};
  (items || []).forEach(function (i) { if (i && i.station) seen[i.station] = 1; });
  return Object.keys(seen).sort();
}

var EXPORTS = { create, apply, since, queue, find, stations };

window.CBOrderHub = EXPORTS;
})();
