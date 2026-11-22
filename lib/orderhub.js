/* ADOPTED from chitbridge-engines v1.110.0 · orderhub · sha256 0feb68080556427303e2f6f4cb94f51da021aaa770c85d00398151b44fcc31da — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · orderhub. Edited ONLY in chitbridge-engines/src/orderhub.js; every platform adopts a released version of it. */
(function (root) {
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
  const ORD = typeof module !== 'undefined' && typeof require === 'function' ? require('./orders') : root.CBOrders;

  /** a hub's whole memory. Handed in and returned, never a module global — one process may serve one shop. */
  function create() {
    return { orders: [], seq: 0 };
  }

  function find(hub, id) {
    const all = (hub && hub.orders) || [];
    for (let index = 0; index < all.length; index++) if (all[index].id === id) return all[index];
    return null;
  }

  /** everything a device may say about an order it can already name. `open` is separate: it has no id yet. */
  const DOES = { round: 1, hold: 1, ready: 1, settle: 1, settled: 1, reopen: 1 };

  /** ⭐ stamp a change so a device can ask for only what it has not seen */
  function bump(hub, o) {
    hub.seq++;
    o.seq = hub.seq;
    return hub.seq;
  }

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
      const nestedO = ORD.start(hub.orders, msg.subject, msg.by, { till: msg.till, kind: msg.kind, at: now });
      if (!nestedO) return { ok: false, why: 'that needs a number' };
      if (hub.orders.indexOf(nestedO) < 0) {
        hub.orders.push(nestedO);
        bump(hub, nestedO);
      }
      return { ok: true, order: nestedO, seq: hub.seq };
    }

    /**
     * ⚠️ THE VERB IS CHECKED BEFORE THE ORDER IS LOOKED FOR. The first draft did it the other way round, so a
     * message the hub had never heard of came back "that order is not on this hub" — perfectly true, and it
     * would have sent somebody hunting for a missing table instead of a misspelt word.
     */
    if (!DOES[msg.do]) return { ok: false, why: 'the hub does not know how to ' + msg.do };
    const o = find(hub, msg.id);
    if (!o) return { ok: false, why: 'that order is not on this hub' };

    /* [REVIEWS3 GF-orders-stock-01 M2] once a bill is being taken nothing is added: a round after the bill was printed was cooked and never billed */
    if ((msg.do === 'round' || msg.do === 'hold') && (o.state === 'settling' || o.state === 'settled'))
      return { ok: false, why: 'this order is being billed — open it again to add more' };

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
      (msg.lines || []).forEach(function (item) {
        want[String(item)] = 1;
      });
      let count = 0;
      o.lines.forEach(function (item, index) {
        if (!item.round || item.void) return; /* held lines were typed, never sent */
        const key = item.line_id || String(index);
        const mine = msg.all ? !msg.station || item.station === msg.station : want[key] || want[String(index)];
        if (mine && !item.ready) {
          item.ready = true;
          item.ready_at = now;
          count++;
        }
      });
      if (!count) return { ok: false, why: 'nothing there was still waiting' };
      bump(hub, o);
      return { ok: true, order: o, seq: hub.seq, made: count };
    }

    if (msg.do === 'settle') {
      /* ⚠️ THE GAP THAT MATTERS: two devices billing one table. The hub is the only place that can close it,
       because it is the only thing both devices talk to. The engine judges; the hub is where the judgement
       happens once. */
      const may = ORD.canSettle(o);
      if (!may.ok) return { ok: false, why: may.why };
      o.state = 'settling';
      o.settling_by = (msg.by && msg.by.id) || null;
      bump(hub, o);
      return { ok: true, order: o, seq: hub.seq };
    }

    if (msg.do === 'settled') {
      /* [REVIEWS3 GF-orders-stock-01 M1] only a bill being taken is settled; a repeat of the same message is answered, not applied twice */
      if (o.state === 'settled') return { ok: true, order: o, seq: hub.seq };
      if (o.state !== 'settling') return { ok: false, why: 'this order was not sent for billing' };
      o.state = 'settled';
      o.settled_at = now;
      o.bill = msg.bill || null;
      bump(hub, o);
      return { ok: true, order: o, seq: hub.seq };
    }

    /** ⚠️ a billing that failed must put the table back, or nobody can bill it ever again */
    if (msg.do === 'reopen') {
      if (o.state === 'settled') return { ok: false, why: 'this order is already billed' }; /* [REVIEWS3 M1] a stale device cannot reopen a settled bill */
      o.state = 'open';
      o.settling_by = null;
      bump(hub, o);
      return { ok: true, order: o, seq: hub.seq };
    }

    /* unreachable — DOES is checked above. Left so a verb added to DOES and forgotten here still answers. */
    return { ok: false, why: 'the hub does not know how to ' + msg.do };
  }

  /** ⭐ what a device has not seen. since(hub, 0) is the whole evening; a kitchen screen asks for far less. */
  function since(hub, seq) {
    const from = Number(seq) || 0;
    return {
      seq: (hub && hub.seq) || 0,
      orders: ((hub && hub.orders) || []).filter(function (item) {
        return (item.seq || 0) > from;
      })
    };
  }

  /**
   * ⭐⭐ WHAT ONE STATION MUST MAKE, oldest first — the kitchen screen's whole query. Lines that were held
   * (round 0) are invisible here on purpose: they were typed and never sent, and a kitchen must not cook a thought.
   */
  function queue(hub, station) {
    const out = [];
    ((hub && hub.orders) || []).forEach(function (item) {
      if (item.state === 'settled') return;
      item.lines.forEach(function (l, index) {
        if (!l.round || l.ready || l.void) return;
        if (station && l.station !== station) return;
        out.push({
          order_id: item.id,
          subject: item.subject,
          line_id: l.line_id || String(index),
          name: l.name,
          qty: l.qty,
          round: l.round,
          at: l.at,
          station: l.station || null,
          kind: item.kind || 'dine'
        });
      });
    });
    /* ⚠️ OLDEST FIRST — a kitchen works a queue, and a screen sorted by table number starves table 12 */
    return out.sort(function (first, second) {
      return String(first.at).localeCompare(String(second.at));
    });
  }

  /** the stations this shop's own menu mentions — nobody should configure a list the items already state */
  function stations(items) {
    const seen = {};
    (items || []).forEach(function (item) {
      if (item && item.station) seen[item.station] = 1;
    });
    return Object.keys(seen).sort();
  }

  const EXPORTS = { create, apply, since, queue, find, stations };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBOrderHub. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBOrderHub = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
