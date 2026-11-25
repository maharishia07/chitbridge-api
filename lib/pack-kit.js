/* ADOPTED from chitbridge-engines v1.110.0 · pack-kit · sha256 c79d1df0f27b99e4de296f088457c8f9b5e4a9152c160a930e1d814d56069dda — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · pack-kit. Edited ONLY in chitbridge-engines/src/pack-kit.js; every platform adopts a released version of it.
 * CALLED BY src/reg-ae.js, src/reg-au.js, src/reg-jp.js, src/reg-my.js, src/reg-sg.js (+1 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note [BOOKS · COUNTRY HELPERS] what every country pack does the same way, written once (DESIGN-COUNTRY-ENGINE-SPLIT R1, v1.51.0).
  // @stage-note A pack is its own engine; it calls these. A change here re-runs every country's golden (tests/golden.test.js).
  /**
   * pack-kit.js — THE COUNTRY HELPERS (R1). Athi, 2026-10-16: "each country should have its own engine … if there are shared functionalities,
   * that has to be handled as a helper functions" and "if there is a change to the helper function, then every engine should be tested."
   *
   * Lifted VERBATIM from reg-in / reg-au / reg-ae; what differed between the copies (a unit word, a head name, a sentence) is now an argument.
   *   refuse(why)                              → an Error marked `refused` (the one way a pack says no)
   *   pad2(n) · ymd(y, m, d) · lastDay(y, m)   → calendar strings, UTC, no clock
   *   int(v, where, unit)                      → a ledger amount as a whole number of `unit` ('cents', 'fils'), else refused
   *   netOf(rows, role, side, unit)            → the net of the rows with a role, in whole minor units (JP, MY)
   *   straightLine(rows, ctx)                  → straight-line depreciation for one asset class, refuses an asset with no cost or value (JP, MY)
   *   lineExtras(r, g, pack)                   → { group_name, line, line_label, statement } from pack.presentation.lines (IFRS-worded packs)
   *   singleHeadSetOff(o, minor, { head, negative, leftover }) → { utilised, payable, carried, [leftover] } for a ONE-head tax (GST AU, VAT AE)
   *   noCreditSetOff(o, minor, { head, negative }) → { utilised: [], payable, carried } for a SINGLE-STAGE tax with NO input credit (SST, US sales tax): the whole output is payable
   *   returnRow(code, label, amount, tax, roles, note)  → one box of a return in the shape gst-returns.returnFor hands a screen (R2)
   *
   * ── ZERO DEPENDENCIES · NO CLOCK · NO STORAGE ──────────────────────────────────────────────────────────────
   */
  function refuse(why) {
    var e = new Error(why);
    e.refused = true;
    return e;
  }
  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function ymd(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function lastDay(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function int(v, where, unit) {
    /* VERIFY-TAX-01 row 25: a blank string is no amount (Number('') is 0); an absent amount (null / undefined) is still 0, a ledger row may carry one side only */
    if (typeof v === 'string' && v.trim() === '') throw refuse('A ledger amount is a whole number of ' + unit + ' — ' + where + ' is blank.');
    var n = v == null ? 0 : Number(v);
    if (!Number.isInteger(n)) throw refuse('A ledger amount is a whole number of ' + unit + ' — ' + where + ' is not.');
    return n;
  }
  /** the current / non-current `term` of a ledger: its own, else its group's, else its statement line's, else null (unclassified — never guessed) */
  function termOf(r, g, line) {
    return r.term || g.term || (line && line.term) || null;
  }
  function lineExtras(r, g, pack) {
    const p = pack,
      key = r.line || g.line;
    const line = p.presentation && p.presentation.lines && Object.prototype.hasOwnProperty.call(p.presentation.lines, key) ? p.presentation.lines[key] : null;
    return { group_name: g.name, line: key, line_label: line ? line.label : null, statement: line ? line.st : null, term: termOf(r, g, line) };
  }
  /** netOf(rows, role, side, unit) → the whole-minor-unit total of the rows with this role: credit less debit for side 'cr', debit less credit for 'dr' (moved from reg-jp / reg-my, VERIFY-TAX-01 row 24) */
  function netOf(rows, role, side, unit) {
    return (rows || [])
      .filter(function (item) {
        return item.role === role;
      })
      .reduce(function (total, item) {
        var d = int(item.dr_minor, role, unit),
          c = int(item.cr_minor, role, unit);
        return total + (side === 'cr' ? c - d : d - c);
      }, 0);
  }
  /**
   * straightLine(rows, ctx) → { total, rate, per } for ONE asset class: cost (or opening value) over the life, pro rata by days, never below nil.
   * An asset with neither cost nor opening value (null OR absent) is refused, never NaN (VERIFY-TAX-01 row 24; moved from reg-jp / reg-my).
   */
  function straightLine(rows, ctx) {
    var c = rows[0].c,
      diy = ctx.diy,
      rate = Math.round(10000 / c.life) / 100;
    var entries = rows.map(function (item) {
      if (item.cost == null && item.wdv == null) throw refuse('Depreciation needs the cost or the opening value of asset ' + item.id + '.');
      var open = item.wdv != null ? item.wdv : item.cost,
        cost = item.cost != null ? item.cost : open;
      var ch = Math.min((cost * item.days) / diy / c.life, Math.max(0, open));
      return Math.round(Number(ch.toPrecision(15)));
    });
    return {
      total: entries.reduce(function (total, item) {
        return total + item;
      }, 0),
      rate: rate,
      per: entries
    };
  }
  /** a return's box as one row: { code, label, amount_minor, tax_minor, roles, note } — moved from gst-returns.row_ (R2); a BAS label has one figure, a VAT201 box two */
  function returnRow(code, label, amount, tax, roles, note) {
    return {
      code: String(code),
      label: label,
      amount_minor: amount == null ? null : amount,
      tax_minor: tax == null ? null : tax,
      roles: roles || [],
      note: note || null
    };
  }
  function singleHeadSetOff(o, minor, w) {
    var h = w.head,
      out = minor((o.output || {})[h]),
      inp = minor((o.input || {})[h]);
    if (out < 0 || inp < 0) throw refuse(w.negative);
    var a = Math.min(inp, out),
      used = a > 0 ? [{ from: h, against: h, amount: a }] : [];
    var r = { utilised: used, payable: {}, carried: {} };
    r.payable[h] = out - a;
    r.carried[h] = inp - a;
    if (w.leftover) r[w.leftover] = inp - a; /* a pack that names no leftover key gets none (it wrote the key "undefined") */
    return r;
  }

  function noCreditSetOff(o, minor, w) {
    var h = w.head,
      out = minor((o.output || {})[h]),
      inp = minor((o.input || {})[h]);
    if (out < 0 || inp < 0) throw refuse(w.negative);
    var r = { utilised: [], payable: {}, carried: {} };
    r.payable[h] = out;
    r.carried[h] = 0;
    return r;
  }

  /**
   * ⭐ ACC-290 part A — the `unknown` supply-kind row of a pack's return map (read-only; posting and the boxes never change). A sale at 0% that names no
   * supply kind lands on the plain sales ledger, so the boxes of the kinds that need a named kind (BAS G3, VAT201 boxes 4 and 5 …) cannot count it. The row says so
   * in one shape for every pack: `role` is the ledger the unnamed sale is on, `kinds` the kinds the owner picks from, `ask` the question, `why` the sentence.
   * Never defaults 0% to a free kind (DECISIONS.md:1497): the supply stays unknown until the owner answers.
   */
  function unknownKind(o) {
    return Object.freeze({
      id: 'unknown',
      name: o.name,
      role: o.role || 'sales',
      kinds: Object.freeze(o.kinds.slice()),
      boxes: Object.freeze((o.boxes || []).slice()),
      ask: o.ask,
      why: o.why,
      cite: o.cite
    });
  }

  const EXPORTS = {
    noCreditSetOff: noCreditSetOff,
    refuse: refuse,
    pad2: pad2,
    ymd: ymd,
    lastDay: lastDay,
    int: int,
    netOf: netOf,
    straightLine: straightLine,
    lineExtras: lineExtras,
    termOf: termOf,
    singleHeadSetOff: singleHeadSetOff,
    returnRow: returnRow,
    unknownKind: unknownKind
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBPackKit (loaded before any pack). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBPackKit = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
