// @stage tested
// @stage-note [RI1] Repeat supply as an AGREEMENT both parties hold (b303, DRAFT — not run): the schedule beside the agreement chit,
// @stage-note the customer's accept · counter · decline · skip, the seller's pause · end · run, and the sweep that mints each run
// @stage-note through the ONE send path (lib/autoraise.sendAs → POST /api/chits/send). A re-run never mints twice.
'use strict';
/**
 * lib/repeat-supply.js — REPEAT SUPPLY, BETTER THAN A "RECURRING INVOICE" (round RI1, 2026-10-12; gap R1 §4).
 * OWNS      the agreement's step table, its schedule and dates, the repeat_supply store, and the sweep that mints each run
 * FLOW      route/nightly ──▶ whoIs (who may see it) ──▶ mayDo (the step table) ──▶ move / runOne ──▶ store ──▶ sendAs (the one send path)
 * CALLED BY routes/repeat-supply.js (every /api/repeat route) · lib/books-nightly.js (sweepAll)
 * CARD      12-suppliers-and-procurement/repeat-supply
 *
 * ⭐ THE AGREEMENT IS A CHIT. "Repeat this…" on a sent invoice sends a chit of purpose `subscription` (the one that already means "a
 *   recurring commitment", routes/chits.js) to the customer through POST /api/chits/send — its lines, price and money block are the
 *   send path's own, frozen as every chit is. business_json.repeat = { agreement_id, every, unit, anchor_day, start_on, until, mode }.
 *   What moves (the next day, the last run, paused · ended, the customer's open counter, the skips, which day minted which invoice)
 *   lives in repeat_supply (b303), keyed to that chit — a chit is sealed; a schedule is not.
 * ⭐ THE CUSTOMER AGREES FIRST. Accept moves their received copy to `accepted` through routes/chits.js moveStatus (the ONE status
 *   writer; the rail engine decides may/why) and the agreement to `agreed`; Counter puts a proposal (quantities · how often · from
 *   when) on the agreement and pauses the runs until the seller agrees; Decline ends it. Nothing is invoiced that was not agreed.
 * ⭐ EVERY RUN IS A NORMAL CHIT, minted by the same send path (lib/autoraise.sendAs — the loopback send with the 60-second internal
 *   token), purpose `invoice`, normal series, normal posting (lib/books-hooks afterChit, as any sent chit). Mode `draft` (default)
 *   lands it in Tasks & Orders for a person to look at and send; mode `send` sends it. Nothing here computes a rupee.
 * ⭐ IDEMPOTENT PER (AGREEMENT, DAY): the run's client_ref is `rep:<agreement_id>:<date>` — the send route answers the FIRST chit for
 *   a repeated ref (duplicate:true), the Idempotency-Key header says it again (middleware/idempotency), and `runs[date]` on the row
 *   is checked before anything is sent. A sweep that died between the send and the row's move just moves on the next run.
 * ⭐ A MISSED DAY RUNS ONCE, WITH ITS OWN DATE: dueDates() walks next_on forward to today (at most CATCH_UP), each run dated the day
 *   it fell due. Dates are the SHOP's day (lib/books-hooks dayOf, M210) — never the server's.
 * ⭐ ONE DATE RULE: lib/books-recurring nextAfter (widened: daily · weekly · an `every` count) — the 31st meets February and comes back.
 * ⚠️ NOT MIGRATED → REPEAT_NOT_MIGRATED (503, in words). exists() asks before a route promises anything; the sweep skips quietly.
 * ⚠️ WHO MAY (the server decides, always): the seller side is the shop that made it — the owner or an editor-level person
 *   (lib/access canEdit: the sales hat); the customer side is the entity the agreement names, holding its received copy, at editor
 *   level (lib/rail can). Everyone else: 404, the way every own-copy route answers. may() below is the agreement's own step table;
 *   its words are WHY — a host paints them, it never invents a refusal.
 */
const { v4: uuidv4 } = require('uuid');
const log = require('./logger');
const CLOCK = require('./shop-clock');
const RECURRING = require('./books-recurring'); /* nextAfter · valid — the one "next one" */
const HOOKS = require('./books-hooks'); /* dayOf — the shop's day */
const { UUID_RE } = require('./trace'); /* the one uuid test: a chit id that is none names no chit (K-1) */

const UNITS = ['daily', 'weekly', 'monthly'];
const MODES = ['draft', 'send'];
const STATES = ['proposed', 'agreed', 'countered', 'declined', 'paused', 'ended'];
const CATCH_UP = 12; /* a stuck agreement is named, not looped on */
const MAX_RUNS = 999,
  MAX_EVERY = 365;

const WHY_WORDS = {
  not_migrated: 'Repeat supply arrives after the next update.',
  not_seller: 'Only the shop that made this agreement may do that.',
  not_customer: 'Only the customer this agreement is with may do that.',
  ended: 'This agreement has ended.',
  wrong_state: 'This agreement is not at a step where that can be done.',
  not_due: 'The next run is not due yet.',
  reason_needed: 'Say why — the other side will read it.',
  nothing_due: 'Nothing is due.'
};
/** what each side may do at each state (the agreement's own step table — the rail engine answers held · level · the copy) */
const STEPS = {
  seller: {
    pause: ['agreed'],
    resume: ['paused'],
    end: ['proposed', 'agreed', 'countered', 'paused'],
    skip: ['agreed', 'paused'],
    run: ['agreed'],
    agree: ['countered'],
    refuse: ['countered']
  },
  customer: { accept: ['proposed'], counter: ['proposed', 'agreed'], decline: ['proposed', 'countered', 'agreed'], skip: ['agreed'] }
};
const SIDES = Object.keys(STEPS);
const WORDS = {
  proposed: 'Waiting for the customer',
  agreed: 'Agreed',
  countered: 'Customer proposed a change',
  declined: 'Declined',
  paused: 'Paused',
  ended: 'Ended'
};

const badRequest = (reason) => {
  const e = new Error(reason);
  e.code = 'BOOKS_BAD_REQUEST';
  e.status = 400;
  return e;
};
const refuse = (reason, code) => {
  const e = new Error(reason);
  e.code = code || 'REPEAT_REFUSED';
  e.refused = true;
  e.status = 422;
  return e;
};
/**
 * SEC-90: the words a problems[] row may carry. A refusal of this library or of the send path (a status below 500: its own sentence, written for the
 * shopkeeper) keeps its words, as before; anything else is a fault: logged with the request id (lib/respond.js safeErr) and answered with the one safe
 * sentence plus that id, so the database's own text never reaches the caller of a 200.  ctx: { request_id } from the route, or {} (the nightly).
 */
function problemWhy(e, ctx) {
  if (e && e.status && e.status < 500) return { why: String(e.message).slice(0, 200) };
  const out = { why: require('./respond').safeErr(e, Object.assign({ where: 'repeat.sweep' }, ctx)) };
  if (ctx && ctx.request_id) out.request_id = ctx.request_id;
  return out;
}
const notMigrated = () => {
  const e = new Error(WHY_WORDS.not_migrated);
  e.code = 'REPEAT_NOT_MIGRATED';
  e.status = 503;
  return e;
};
const notFound = () => {
  const e = new Error('No such agreement.');
  e.code = 'BOOKS_NOT_FOUND';
  e.status = 404;
  return e;
};
const missing = (e) => e && (e.code === '42P01' || e.code === '42703' || e.code === '42883');
const dateOf = require('./books-engines').ymd; /* T2-NATDEF: THE date reader — next_on · end_on · last_run_on are `date` columns */
const db = () => require('../db');
const withEntity = (e, fn) => db().withEntity(e, fn);
const no = (reason) => ({ ok: false, why: reason, say: WHY_WORDS[reason] });
const YES = Object.freeze({ ok: true });

/* ── PURE: the step table, the schedule ─────────────────────────────────────────────────────────────────────── */

/** may(row, side, action, today?) → { ok:true } | { ok:false, why, say } — the agreement's own answer (the rail's held/level is asked by the route) */
function mayDo(row, side, action, today) {
  if (!row || SIDES.indexOf(side) < 0) return no('wrong_state');
  const allowedStates = STEPS[side][action];
  if (!allowedStates) return no(side === 'seller' ? 'not_customer' : 'not_seller'); /* the other side's verb */
  if (row.state === 'ended' || row.state === 'declined') return no('ended');
  if (allowedStates.indexOf(row.state) < 0) return no('wrong_state');
  if (notDueYet(row, action, today)) return no('not_due');
  return YES;
}
/** a `run` asked before the next run's day (only judged when a `today` is given) */
function notDueYet(row, action, today) {
  return action === 'run' && today && row.next_on > today;
}
/** every verb of a side with its verdict — what a screen paints (greyed WITH its sentence) */
function actions(row, side, today) {
  const out = {};
  for (const verb of Object.keys(STEPS[side] || {})) out[verb] = mayDo(row, side, verb, today);
  return out;
}
/** the days a run has fallen due on or before `today`: next_on, then each step, at most CATCH_UP, never past end_on or runs_max */
function dueDates(row, today) {
  const out = [];
  if (!row || row.state !== 'agreed' || !row.next_on) return out;
  let dueDay = row.next_on,
    done = Number(row.runs_done) || 0;
  for (let index = 0; index < CATCH_UP && dueDay <= today; index++) {
    if (pastTheEnd(row, dueDay, done)) break;
    out.push(dueDay);
    done++;
    dueDay = RECURRING.nextAfter(dueDay, row.unit, row.anchor_day, row.every);
  }
  return out;
}
/** the day is after the agreement's end date, or the run count has reached its maximum */
function pastTheEnd(row, dueDay, done) {
  return (row.end_on && dueDay > row.end_on) || (row.runs_max && done >= row.runs_max);
}
/** the row after the run on `date` (or a skip of it): next_on steps, the count moves (a skip counts no run), and past the end it ENDS */
function advanced(row, date, didRun) {
  const next = RECURRING.nextAfter(date, row.unit, row.anchor_day, row.every);
  const done = (Number(row.runs_done) || 0) + (didRun ? 1 : 0);
  const over = (row.end_on && next > row.end_on) || (row.runs_max && done >= row.runs_max);
  return Object.assign({ next_on: next, runs_done: done }, didRun ? { last_run_on: date } : {}, over ? { state: 'ended', state_note: 'Ran its course' } : {});
}
/** the unit a request names, lower-cased, one of UNITS */
function unitOf(rows) {
  const unit = typeof rows.unit === 'string' ? rows.unit.toLowerCase() : ''; /* ORD-88: a list or object is no unit (String() let ['daily'] through) */
  if (UNITS.indexOf(unit) < 0) throw badRequest('How often? daily, weekly or monthly.');
  return unit;
}
/** the "every N" count a request names (default 1), 1 to MAX_EVERY */
function everyOf(rows) {
  const every = Math.floor(Number(rows.every == null ? 1 : rows.every));
  if (!(every >= 1 && every <= MAX_EVERY)) throw badRequest('Every how many? 1 to ' + MAX_EVERY + '.');
  return every;
}
/** the first run's day: a valid date, not before today when today is given */
function startOf(rows, today) {
  const start = RECURRING.valid(rows.start_on);
  if (!start) throw badRequest('From when? Use YYYY-MM-DD.');
  if (today && start < today) throw badRequest('The first run cannot be in the past.');
  return start;
}
/** the day of the month a monthly agreement runs on (default: the start's day); null for the other units */
function anchorOf(rows, unit, start) {
  const anchor = unit === 'monthly' ? (rows.anchor_day != null ? Number(rows.anchor_day) : Number(start.slice(8, 10))) : null;
  if (unit === 'monthly' && !(anchor >= 1 && anchor <= 31)) throw badRequest('Which day of the month? 1 to 31.');
  return anchor;
}
/** the "until a date" end of the schedule, or null */
function endOnOf(untilSpec, start) {
  if (untilSpec.on == null || untilSpec.on === '') return null;
  const end_on = RECURRING.valid(untilSpec.on);
  if (!end_on) throw badRequest('Until when? Use YYYY-MM-DD.');
  if (end_on < start) throw badRequest('It would end before it starts.');
  return end_on;
}
/** the "until N runs" end of the schedule, or null */
function runsMaxOf(untilSpec) {
  if (untilSpec.runs == null || untilSpec.runs === '') return null;
  const runs_max = Math.floor(Number(untilSpec.runs));
  if (!(runs_max >= 1 && runs_max <= MAX_RUNS)) throw badRequest('How many runs? 1 to ' + MAX_RUNS + '.');
  return runs_max;
}
/** the mode a request names (default draft), one of MODES */
function modeOf(rows) {
  const mode = rows.mode == null ? 'draft' : String(rows.mode).toLowerCase();
  if (MODES.indexOf(mode) < 0) throw badRequest('Each run: draft (a person sends it) or send.');
  return mode;
}
/** the schedule a request asks for, checked — { every, unit, anchor_day, next_on, end_on, runs_max, mode } */
function schedule(rows, today) {
  const unit = unitOf(rows);
  const every = everyOf(rows);
  const start = startOf(rows, today);
  const anchor = anchorOf(rows, unit, start);
  const untilSpec = rows.until || {};
  const end_on = endOnOf(untilSpec, start);
  const runs_max = runsMaxOf(untilSpec);
  const mode = modeOf(rows);
  return { every, unit, anchor_day: anchor, next_on: start, end_on, runs_max, mode };
}
const NOTHING_ASKED = 'Every line is at 0. To stop supplying, decline the agreement; to drop one line, leave the others as they are.';
/** ORD-89: no line left to supply (one line at 0 is a valid counter; every line at 0 is a decline in disguise) */
const allZero = (asked) => asked.length > 0 && asked.every((x) => Number(x.quantity) === 0);
/** the quantities a counter asks per line (only the agreement's own lines), or undefined when it names none */
function counterLines(rows, lines) {
  if (!(rows && Array.isArray(rows.lines) && rows.lines.length)) return undefined;
  const ids = new Set((lines || []).map((item) => item.line_id));
  const asked = rows.lines
    .map((x) => ({ line_id: String(x.line_id || ''), quantity: Number(x.quantity) }))
    .filter((x) => ids.has(x.line_id) && Number.isFinite(x.quantity) && x.quantity >= 0);
  if (!asked.length) throw badRequest('Which line, and how many?');
  if (allZero(asked)) throw badRequest(NOTHING_ASKED);
  return asked;
}
/** the new every · unit · start a counter asks for (checked as a schedule), or undefined when it names none */
function counterSchedule(rows, row, today) {
  if (!(rows && (rows.unit != null || rows.every != null || rows.start_on != null))) return undefined;
  /* ORD-93: a start the customer names is checked against the seller's day; the row's own next_on (overdue or not) is not theirs to date */
  return schedule(
    {
      unit: rows.unit || row.unit,
      every: rows.every == null ? row.every : rows.every,
      start_on: rows.start_on || row.next_on,
      anchor_day: rows.anchor_day,
      mode: row.mode
    },
    rows.start_on ? today : undefined
  );
}
/** a counter-proposal, checked: quantities per line (of the agreement's lines), and/or a new every · unit · start — with a note */
function counterOf(rows, row, lines, today) {
  const out = {
    note: String((rows && rows.note) || '')
      .trim()
      .slice(0, 400)
  };
  const asked = counterLines(rows, lines);
  if (asked) out.lines = asked;
  const entries = counterSchedule(rows, row, today);
  if (entries) {
    out.every = entries.every;
    out.unit = entries.unit;
    out.anchor_day = entries.anchor_day;
    out.start_on = entries.next_on;
  }
  if (!out.lines && out.every == null) throw badRequest('What would you change — a quantity, how often, or from when?');
  return out;
}
/** the lines a run carries: the agreement's lines with the AGREED quantities; a changed quantity drops the frozen line figures so the send path prices it */
function runLines(lines, terms) {
  const agreedQuantity = {};
  for (const x of (terms && terms.lines) || []) agreedQuantity[x.line_id] = x.quantity;
  return (lines || [])
    .filter((item) => !(item.line_id in agreedQuantity) || agreedQuantity[item.line_id] > 0)
    .map((item) => {
      if (!(item.line_id in agreedQuantity) || Number(item.quantity != null ? item.quantity : item.qty) === agreedQuantity[item.line_id]) return Object.assign({}, item);
      const changed = Object.assign({}, item, { quantity: agreedQuantity[item.line_id] });
      for (const figure of ['total', 'net', 'line_total', 'amount', 'tax', 'taxable', 'offers', 'offer']) delete changed[figure];
      return changed;
    });
}

/* ── the store (every statement names the seller) ───────────────────────────────────────────────────────────── */

const COLS = `r.agreement_id, r.entity_id, r.chit_id, r.customer_entity_id, r.source_chit_id, r.every, r.unit, r.anchor_day, r.next_on, r.end_on, r.runs_max,
  r.runs_done, r.mode, r.state, r.terms, r.counter, r.skips, r.runs, r.last_run_on, r.state_by, r.state_at, r.state_note, r.created_by, r.created_at, r.updated_at,
  h.all_recipients, h.summary_json, h.manual_subject, h.auto_subject`;
const jsonOr = (verdict, forDay) => (verdict == null ? forDay : typeof verdict === 'string' ? JSON.parse(verdict) : verdict);
/** the ids the row names */
function rowIds(rows) {
  return {
    agreement_id: rows.agreement_id,
    entity_id: rows.entity_id,
    chit_id: rows.chit_id,
    customer_entity_id: rows.customer_entity_id,
    source_chit_id: rows.source_chit_id || null
  };
}
/** the schedule columns of the row, numbers and dates read the one way */
function rowSchedule(rows) {
  return {
    every: Number(rows.every) || 1,
    unit: rows.unit,
    anchor_day: rows.anchor_day == null ? null : Number(rows.anchor_day),
    next_on: dateOf(rows.next_on),
    end_on: dateOf(rows.end_on),
    runs_max: rows.runs_max == null ? null : Number(rows.runs_max),
    runs_done: Number(rows.runs_done) || 0,
    mode: rows.mode,
    state: rows.state
  };
}
/** the json columns of the row, parsed when they arrive as text */
function rowJson(rows) {
  return {
    terms: jsonOr(rows.terms, {}) || {},
    counter: jsonOr(rows.counter, null),
    skips: jsonOr(rows.skips, []) || [],
    runs: jsonOr(rows.runs, {}) || {}
  };
}
/** who moved it, when, and why — the stamp columns of the row */
function rowStamps(rows) {
  return {
    last_run_on: dateOf(rows.last_run_on),
    state_by: rows.state_by || null,
    state_at: rows.state_at || null,
    state_note: rows.state_note || null,
    created_by: rows.created_by || null,
    created_at: rows.created_at || null,
    updated_at: rows.updated_at || null
  };
}
/** what a screen paints from the joined chit: the customer, the money, the currency and the subject */
function rowPainted(rows, other, sum) {
  return {
    customer: other ? { entity_id: other.entity_id, name: other.display_name || other.name || null } : { entity_id: rows.customer_entity_id, name: null },
    money: sum.money || null,
    currency: sum.currency_code || (sum.money && sum.money.currency_code) || null,
    subject: rows.manual_subject || rows.auto_subject || null
  };
}
/** a database row as the agreement the library hands out (null stays null) */
function rowOf(rows) {
  if (!rows) return null;
  const rec = jsonOr(rows.all_recipients, []) || [];
  const other = rec.filter((x) => x && String(x.entity_id || '') === String(rows.customer_entity_id))[0] || null;
  const sum = jsonOr(rows.summary_json, {}) || {};
  return Object.assign({}, rowIds(rows), rowSchedule(rows), rowJson(rows), rowStamps(rows), rowPainted(rows, other, sum));
}
/** my copy's status: chit_status holds it (chit_header has no such column), read by the one reader lib/select.rows, on the copy of THIS direction */
async function statusOnMyCopy(e, chit_id, direction) {
  const copies = await require('./select').rows(e, { chit_id, archived: false });
  const mine = copies.find((copy) => copy.direction === direction);
  return (mine && mine.current_status) || null;
}
const sql = {
  async exists(handle, e) {
    try {
      await handle.query(`SELECT 1 FROM repeat_supply WHERE entity_id = $1 LIMIT 1`, [e]);
      return true;
    } catch (err) {
      if (missing(err)) return false;
      throw err;
    }
  },
  async list(handle, e) {
    const result = await handle.query(
      `SELECT ${COLS} FROM repeat_supply r JOIN chit_header h ON h.chit_id = r.chit_id AND h.entity_id = r.entity_id
                             WHERE r.entity_id = $1 ORDER BY (r.state IN ('agreed','countered','proposed','paused')) DESC, r.next_on, r.created_at`,
      [e]
    );
    return result.rows.map(rowOf);
  },
  async get(handle, e, id) {
    const result = await handle.query(
      `SELECT ${COLS} FROM repeat_supply r JOIN chit_header h ON h.chit_id = r.chit_id AND h.entity_id = r.entity_id
                             WHERE r.entity_id = $1 AND r.agreement_id = $2`,
      [e, id]
    );
    return rowOf(result.rows[0]);
  },
  /** a new agreement row, state proposed, then read back */
  async insert(handle, e, rows) {
    await handle.query(
      `INSERT INTO repeat_supply (agreement_id, entity_id, chit_id, customer_entity_id, source_chit_id, every, unit, anchor_day, next_on, end_on, runs_max, mode, state, terms, created_by, state_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'proposed',$13::jsonb,$14, now())`,
      [
        rows.agreement_id,
        e,
        rows.chit_id,
        rows.customer_entity_id,
        rows.source_chit_id || null,
        rows.every,
        rows.unit,
        rows.anchor_day,
        rows.next_on,
        rows.end_on,
        rows.runs_max,
        rows.mode,
        JSON.stringify(rows.terms || {}),
        rows.created_by || null
      ]
    );
    return sql.get(handle, e, rows.agreement_id);
  },
  /** a merge-patch: only the columns named are touched; jsonb columns are replaced whole */
  async update(handle, e, id, patch) {
    const rows = ['terms', 'counter', 'skips', 'runs'];
    const cols = [
      'every',
      'unit',
      'anchor_day',
      'next_on',
      'end_on',
      'runs_max',
      'runs_done',
      'mode',
      'state',
      'terms',
      'counter',
      'skips',
      'runs',
      'last_run_on',
      'state_by',
      'state_at',
      'state_note'
    ].filter((item) => Object.prototype.hasOwnProperty.call(patch, item));
    if (!cols.length) return sql.get(handle, e, id);
    const vals = cols.map((item) => (rows.indexOf(item) >= 0 ? JSON.stringify(patch[item]) : patch[item]));
    const set = cols.map((item, index) => item + ' = $' + (index + 3) + (rows.indexOf(item) >= 0 ? '::jsonb' : '')).join(', ');
    await handle.query(`UPDATE repeat_supply SET ${set}, updated_at = now() WHERE entity_id = $1 AND agreement_id = $2`, [e, id].concat(vals));
    return sql.get(handle, e, id);
  },
  /** the chit I hold (MY copy, under MY RLS): sender · my status · the lines · business_json — or null */
  async chit(handle, e, chit_id) {
    const result = await handle.query(
      `SELECT h.chit_id, h.sender_entity_id, h.sender_entity_display_name, h.direction, h.purpose, h.all_recipients, h.business_json, h.summary_json, h.role,
                                    d.line_items FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                             WHERE h.chit_id = $1 AND h.entity_id = $2`,
      [chit_id, e]
    );
    const x = result.rows[0];
    if (!x) return null;
    return {
      chit_id: x.chit_id,
      sender_entity_id: x.sender_entity_id,
      sender_name: x.sender_entity_display_name,
      direction: x.direction,
      status: await statusOnMyCopy(e, chit_id, x.direction),
      purpose: x.purpose,
      role: x.role,
      all_recipients: jsonOr(x.all_recipients, []) || [],
      business_json: jsonOr(x.business_json, {}) || {},
      summary_json: jsonOr(x.summary_json, {}) || {},
      line_items: jsonOr(x.line_items, []) || []
    };
  },
  /** a line in the chit's own history, on ONE copy (the caller writes it on both — "visible to both") */
  async note(handle, e, chit_id, actor, action, detail) {
    await handle.query(`INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [
      chit_id,
      e,
      action,
      (actor && actor.id) || null,
      (actor && actor.name) || 'Repeat supply',
      String(detail || '').slice(0, 500)
    ]);
  },
  /** the shop's zone row — { timezone, country } */
  async zone(handle, e) {
    const result = await handle.query(`SELECT timezone, country FROM identities WHERE identity_id = $1`, [e]);
    return result.rows[0] || null;
  },
  /** ids only, the one cross-shop read (ops.f_repeat_supply_due, SECURITY DEFINER) */
  async dueShops(dueDay) {
    const result = await db().query('SELECT entity_id FROM ops.f_repeat_supply_due($1)', [dueDay]);
    return result.rows.map((x) => x.entity_id);
  }
};
let store = sql;
/** tests: an in-memory store with the same functions (null puts the SQL back) */
function useStore(replacement) {
  store = replacement || sql;
}
let sender = null,
  mover = null;
/** tests: stand in for lib/autoraise.sendAs (null puts the real loopback back) */
function useSender(fn) {
  sender = fn || null;
}
/** tests: stand in for routes/chits moveStatus — the ONE status writer (null puts the route's back) */
function useMover(fn) {
  mover = fn || null;
}
const sendAs = (e, body, opts) => (sender || require('./autoraise').sendAs)(e, body, opts);
const moveTo = (...verb) => (mover || require('./chit-move').moveStatus)(...verb);
async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (missing(err)) throw notMigrated();
    throw err;
  }
}

/* ── the shop's day ─────────────────────────────────────────────────────────────────────────────────────────── */

const zones = {};
/** today in the SHOP's calendar (identities.timezone, else its country; M210) — one read a minute per shop */
async function todayOf(entity) {
  const cached = zones[entity];
  if (!cached || cached.at < CLOCK.nowMs() - 60000) {
    let zone = null;
    try {
      zone = await withEntity(entity, (handle) => store.zone(handle, entity));
    } catch (e) {
      log.fellBack('repeat-supply todayOf: the read failed — answered with nothing', e);
      zone = null;
    }
    zones[entity] = { z: zone, at: CLOCK.nowMs() };
  }
  return HOOKS.dayOf(CLOCK.now(), zones[entity].z || null); /* T2-NATDEF: unstated → UTC, never India */
}

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** the row as a side sees it: + actions (every verb with its verdict) + words */
function view(row, side, today) {
  if (!row) return null;
  return Object.assign({}, row, {
    side,
    actions: actions(row, side, today),
    words: WORDS[row.state] || row.state,
    due: !!(row.state === 'agreed' && today && row.next_on <= today)
  });
}
async function migrated(entity) {
  return withEntity(entity, async (handle) => {
    try {
      return await store.exists(handle, entity);
    } catch (e) {
      if (missing(e)) return false;
      throw e;
    }
  });
}
/** GET /api/repeat — the seller's agreements */
async function list(entity) {
  const today = await todayOf(entity);
  return withEntity(entity, async (handle) => (await guard(() => store.list(handle, entity))).map((item) => view(item, 'seller', today)));
}
/** the held chit carries a repeat block for this agreement id */
function namesAgreement(held, id) {
  const repeatTerms = held && held.business_json && held.business_json.repeat;
  return !!(held && repeatTerms && String(repeatTerms.agreement_id) === String(id));
}
/**
 * whoIs(me, id, chit_id?) → { row, side, held } — the agreement as the caller may see it. The seller reads its own row. Anyone else must
 * HOLD a copy of the agreement chit (their own chit_header row, under their own RLS): then the row is read as the seller and the side is
 * 'customer' when the chit names them. Nothing held → null (404 at the route — an id in the URL learns nothing).
 */
async function whoIs(caller, id, chit_id) {
  const mine = await withEntity(caller, (handle) => guard(() => store.get(handle, caller, id)));
  if (mine) return { row: mine, side: 'seller', held: null };
  if (!chit_id || !UUID_RE.test(String(chit_id))) return null; /* K-1: a chit id that is no uuid is a chit nobody holds — the same 404 as an unknown one, never the database's 500 */
  const held = await withEntity(caller, (handle) => store.chit(handle, caller, chit_id));
  if (!namesAgreement(held, id)) return null;
  const seller = held.sender_entity_id;
  const row = await withEntity(seller, (handle) => guard(() => store.get(handle, seller, id)));
  if (!row || String(row.chit_id) !== String(chit_id)) return null;
  return { row, side: String(row.customer_entity_id) === String(caller) ? 'customer' : 'viewer', held };
}
async function oneAgreement(caller, id, chit_id) {
  const access = await whoIs(caller, id, chit_id);
  if (!access) throw notFound();
  const today = await todayOf(access.row.entity_id);
  return Object.assign({ agreement: view(access.row, access.side === 'viewer' ? 'customer' : access.side, today) }, access.side === 'viewer' ? { read_only: true } : {});
}

/* ── writes ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const noteBoth = async (row, actor, action, detail) => {
  for (const e of [row.entity_id, row.customer_entity_id]) {
    try {
      await withEntity(e, (handle) => store.note(handle, e, row.chit_id, actor, action, detail));
    } catch (err) {
      log.fellBack('repeat-supply noteBoth: the read failed — carried on without it', err); /* history is best-effort: a missing line never undoes a move */
    }
  }
};
/** the reason a request body gives, trimmed ('' when none) */
const reasonOf = (body) => String((body && body.reason) || '').trim();
const stamp = (actor, note) => ({
  state_by: (actor && actor.id) || null,
  state_at: CLOCK.now().toISOString(),
  state_note: note == null ? null : String(note).slice(0, 400)
});

/** the bill the seller names, as the seller holds it, or null: an id that is no uuid is a bill this shop does not hold (K-1), not a 500 from the database */
const billOf = (seller, chit_id) => (UUID_RE.test(String(chit_id)) ? withEntity(seller, (handle) => store.chit(handle, seller, String(chit_id))) : null);

/** the bill that repeats and the customer who agrees to it, or the refusal in words */
async function repeatSource(seller, chit_id) {
  const sourceBill = await billOf(seller, chit_id);
  if (!sourceBill) throw notFound();
  if (sourceBill.purpose !== 'invoice') throw refuse('Only a billed invoice can repeat.');
  if (String(sourceBill.sender_entity_id) !== String(seller)) throw refuse('Only a bill you sent can repeat.');
  if (sourceBill.role === 'Draft') throw refuse('Send the bill first, then repeat it.');
  const cust = (sourceBill.all_recipients || []).filter((x) => x && x.entity_id && String(x.entity_id) !== String(seller) && x.role !== 'sender')[0] || null;
  if (!cust) throw refuse('This bill names no ChitBridge customer to agree with.');
  if (!sourceBill.line_items.length) throw refuse('This bill has no lines to repeat.');
  return { sourceBill, cust };
}
/** insert the agreement row (state proposed) for the chit just sent */
function insertAgreement(seller, actor, made) {
  return withEntity(seller, (handle) =>
    guard(() =>
      store.insert(
        handle,
        seller,
        Object.assign(
          {
            agreement_id: made.agreement_id,
            chit_id: made.sent.body.chit_id,
            customer_entity_id: made.cust.entity_id,
            source_chit_id: made.sourceBill.chit_id,
            terms: {},
            created_by: (actor && actor.id) || null
          },
          made.rows
        )
      )
    )
  );
}
/** the business_json.repeat block the agreement chit carries */
function repeatBlock(agreement_id, rows, sourceBill) {
  return {
    agreement_id,
    every: rows.every,
    unit: rows.unit,
    anchor_day: rows.anchor_day,
    start_on: rows.next_on,
    until: { runs: rows.runs_max, on: rows.end_on },
    mode: rows.mode,
    source_chit_id: sourceBill.chit_id
  };
}
/** the agreement chit's subject: "Repeat supply · every 2 weeks" */
function agreementSubject(rows) {
  return (
    'Repeat supply · every ' + (rows.every > 1 ? rows.every + ' ' : '') + { daily: 'day', weekly: 'week', monthly: 'month' }[rows.unit] + (rows.every > 1 ? 's' : '')
  );
}
/** the sentence tail for a refused send: ": <its words>" or "." */
function sentTail(sent) {
  return sent.body && (sent.body.message || sent.body.error) ? ': ' + (sent.body.message || sent.body.error) : '.';
}
/** send the agreement chit (purpose subscription) to the customer, or refuse in words */
async function sendAgreement(seller, agreement_id, cust, sourceBill, rows, ref) {
  const repeat = repeatBlock(agreement_id, rows, sourceBill);
  const sent = await sendAs(
    seller,
    {
      recipients: [{ entity_id: cust.entity_id, role: 'to' }],
      purpose: 'subscription',
      manual_subject: agreementSubject(rows),
      line_items: sourceBill.line_items.map((item) => Object.assign({}, item)),
      business_json: Object.assign({ currency: sourceBill.summary_json.currency_code || (sourceBill.business_json && sourceBill.business_json.currency) || null }, { repeat }),
      client_ref: ref
    },
    { idempotency_key: ref }
  );
  if (!sent.ok) throw refuse('The agreement could not be sent' + sentTail(sent));
  return sent;
}
/** ORD-88: the agreement's client_ref comes from the SOURCE bill (n = its ended or declined agreements + 1), so the send door's own ref look answers a second send for the same bill with the first chit */
async function agreementRef(seller, source_chit_id) {
  const rows = await withEntity(seller, (handle) => store.list(handle, seller));
  const past = rows.filter((x) => String(x.source_chit_id) === String(source_chit_id) && (x.state === 'ended' || x.state === 'declined')).length;
  return 'rep:' + source_chit_id + ':' + (past + 1);
}
/** the agreement the first send of a bill made (the send door answered duplicate), in words when its row is not written yet */
async function existingAgreement(seller, chit_id) {
  const rows = await withEntity(seller, (handle) => store.list(handle, seller));
  const found = rows.find((x) => String(x.chit_id) === String(chit_id));
  if (!found) throw refuse('This bill is already being repeated. Try again in a moment.');
  return found;
}
/**
 * create(seller, who, body) — "Repeat this…" on a sent invoice: { chit_id, every, unit, start_on, anchor_day?, until: { runs? | on? }, mode? }
 * → the agreement chit is SENT (purpose subscription, the invoice's lines) and the row inserted, state proposed.
 */
async function create(seller, actor, body) {
  const request = body || {};
  if (!request.chit_id) throw badRequest('Which bill should repeat?');
  if (!(await migrated(seller))) throw notMigrated(); /* before b303: said in words BEFORE anything is sent */
  const today = await todayOf(seller);
  const rows = schedule(request, today);
  const { sourceBill, cust } = await repeatSource(seller, request.chit_id);
  const agreement_id = uuidv4();
  const sent = await sendAgreement(seller, agreement_id, cust, sourceBill, rows, await agreementRef(seller, sourceBill.chit_id));
  if (sent.body.duplicate) return view(await existingAgreement(seller, sent.body.chit_id), 'seller', today);
  const row = await insertAgreement(seller, actor, { agreement_id, sent, cust, sourceBill, rows });
  await noteBoth(row, actor, 'repeat_proposed', 'Repeat supply proposed — ' + row.subject);
  return view(row, 'seller', today);
}

/** one state move, checked by may() for the side; `patch` is applied beside the state and stamp */
async function move(access, actor, action, to, patch, note, detail) {
  const today = await todayOf(access.row.entity_id);
  const verdict = mayDo(access.row, access.side, action, today);
  if (!verdict.ok) throw refuse(verdict.say, 'REPEAT_' + verdict.why.toUpperCase());
  const row = await withEntity(access.row.entity_id, (handle) =>
    guard(() => store.update(handle, access.row.entity_id, access.row.agreement_id, Object.assign({}, patch || {}, to ? { state: to } : {}, stamp(actor, note))))
  );
  await noteBoth(row, actor, 'repeat_' + action, detail || WORDS[row.state] + (note ? ' — ' + note : ''));
  return view(row, access.side, today);
}
async function mustBe(caller, id, chit_id, side) {
  const access = await whoIs(caller, id, chit_id);
  if (!access) throw notFound();
  if (access.side !== side) throw refuse(WHY_WORDS[side === 'seller' ? 'not_seller' : 'not_customer'], side === 'seller' ? 'REPEAT_NOT_SELLER' : 'REPEAT_NOT_CUSTOMER');
  return access;
}

/** the customer ACCEPTS: their received copy moves to accepted through the one status writer (`mover`: routes/chits moveStatus, or a stand-in), then the row */
async function accept(caller, id, chit_id, actor, me_rail) {
  const access = await mustBe(caller, id, chit_id, 'customer');
  const verdict = mayDo(access.row, 'customer', 'accept');
  if (!verdict.ok) throw refuse(verdict.say, 'REPEAT_' + verdict.why.toUpperCase());
  const moved = await moveTo(caller, access.row.chit_id, 'accepted', actor, 'Repeat supply agreed', me_rail);
  if (moved && moved.code && moved.code >= 400) {
    const e = new Error((moved.body && moved.body.message) || 'Could not accept.');
    e.status = moved.code;
    e.body = moved.body;
    throw e;
  }
  return move(access, actor, 'accept', 'agreed', { counter: null }, null, 'Agreed by the customer');
}
/** the customer COUNTERS: a proposal on the agreement; runs wait until the seller agrees */
async function counter(caller, id, chit_id, actor, body) {
  const access = await mustBe(caller, id, chit_id, 'customer');
  const verdict = mayDo(access.row, 'customer', 'counter');
  if (!verdict.ok) throw refuse(verdict.say, 'REPEAT_' + verdict.why.toUpperCase());
  const rows = counterOf(body, access.row, access.held ? access.held.line_items : [], await todayOf(access.row.entity_id));
  const words = [
    rows.lines ? rows.lines.map((x) => 'line ' + x.line_id.slice(0, 8) + ' → ' + x.quantity).join(', ') : null,
    rows.every != null ? 'every ' + rows.every + ' ' + rows.unit + ' from ' + rows.start_on : null,
    rows.note || null
  ]
    .filter(Boolean)
    .join(' · ');
  return move(
    access,
    actor,
    'counter',
    'countered',
    { counter: Object.assign(rows, { by: caller, at: CLOCK.now().toISOString() }) },
    rows.note,
    'Customer proposed: ' + words
  );
}
/** the customer DECLINES (their copy moves to rejected through the one status writer when it can; the agreement ends either way) */
async function decline(caller, id, chit_id, actor, body, me_rail) {
  const access = await mustBe(caller, id, chit_id, 'customer');
  const verdict = mayDo(access.row, 'customer', 'decline');
  if (!verdict.ok) throw refuse(verdict.say, 'REPEAT_' + verdict.why.toUpperCase());
  const note = reasonOf(body);
  try {
    await moveTo(caller, access.row.chit_id, 'rejected', actor, note || 'Repeat supply declined', me_rail);
  } catch (e) {
    log.fellBack('repeat-supply decline: failed — carried on without it', e); /* the agreement still ends */
  }
  return move(access, actor, 'decline', 'declined', { counter: null }, note, 'Declined by the customer' + (note ? ' — ' + note : ''));
}
const START_PASSED = 'That start day has passed. Ask the customer for a new one.';
/** ORD-89 / ORD-93: a stored counter the seller may still agree to: it asks for something, and the start it names has not passed (never clamped, said in words) */
async function agreeable(row, counterRows) {
  if (counterRows.lines && allZero(counterRows.lines)) throw refuse(NOTHING_ASKED);
  const moved = counterRows.start_on && counterRows.start_on !== dateOf(row.next_on);
  if (moved && counterRows.start_on < (await todayOf(row.entity_id))) throw refuse(START_PASSED);
}
/** the seller AGREES to the counter: its lines/schedule become the terms; or REFUSES it (the agreement ends) */
async function agree(caller, id, actor) {
  const access = await mustBe(caller, id, null, 'seller');
  const verdict = mayDo(access.row, 'seller', 'agree');
  if (!verdict.ok) throw refuse(verdict.say, 'REPEAT_' + verdict.why.toUpperCase());
  const rows = access.row.counter || {};
  await agreeable(access.row, rows);
  const terms = Object.assign({}, access.row.terms);
  if (rows.lines) terms.lines = rows.lines;
  const patch = { terms, counter: null };
  if (rows.every != null) {
    patch.every = rows.every;
    patch.unit = rows.unit;
    patch.anchor_day = rows.anchor_day;
    patch.next_on = rows.start_on;
  }
  return move(access, actor, 'agree', 'agreed', patch, null, 'Seller agreed to the change');
}
async function refuseCounter(caller, id, actor, body) {
  const access = await mustBe(caller, id, null, 'seller');
  const note = reasonOf(body);
  return move(access, actor, 'refuse', 'declined', { counter: null }, note, 'Seller did not agree to the change' + (note ? ' — ' + note : ''));
}
async function pause(caller, id, actor, body) {
  const access = await mustBe(caller, id, null, 'seller');
  return move(access, actor, 'pause', 'paused', null, (body && body.reason) || null);
}
async function resume(caller, id, actor) {
  const access = await mustBe(caller, id, null, 'seller');
  return move(access, actor, 'resume', 'agreed', null, null);
}
async function end(caller, id, actor, body) {
  const access = await mustBe(caller, id, null, 'seller');
  return move(access, actor, 'end', 'ended', { counter: null }, (body && body.reason) || null);
}
/** SKIP the next run — either side; the customer says why (the seller reads it). The day moves on; the count does not. */
async function skip(caller, id, chit_id, actor, body) {
  const access = await whoIs(caller, id, chit_id);
  if (!access || access.side === 'viewer') throw notFound();
  const reason = reasonOf(body);
  if (access.side === 'customer' && !reason) throw refuse(WHY_WORDS.reason_needed, 'REPEAT_REASON_NEEDED');
  const date = access.row.next_on;
  const skips = (access.row.skips || []).concat([{ date, by_entity_id: caller, reason: reason || null, at: CLOCK.now().toISOString() }]);
  const advance = advanced(access.row, date, false);
  return move(access, actor, 'skip', advance.state || null, Object.assign({ skips }, advance), reason, 'Skipped ' + date + (reason ? ' — ' + reason : ''));
}

/* ── the runs ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** the body of the invoice one run sends: the agreement's lines at the AGREED quantities, dated the run's day */
function runBody(row, agreementChit, date, ref) {
  return {
    recipients: [{ entity_id: row.customer_entity_id, role: 'to' }],
    purpose: 'invoice',
    is_draft: row.mode === 'draft',
    manual_subject: 'Repeat supply · ' + date,
    line_items: runLines(agreementChit.line_items, row.terms),
    business_json: {
      currency: agreementChit.summary_json.currency_code || null,
      repeat_of: row.agreement_id,
      repeat_chit_id: row.chit_id,
      repeat_run: date,
      billed_at: date + 'T00:00:00.000Z'
    },
    client_ref: ref
  };
}
/** ORD-90 / ORD-89: an agreement whose chit was withdrawn, or whose lines are all at 0, ends here with the cause named, and sends nothing (it is not left "agreed" for every nightly sweep to retry) */
async function endUnrunnable(row, agreementChit, actor) {
  const withdrawn = HOOKS.REFUSED.test(String(agreementChit.status || ''));
  if (!withdrawn && runLines(agreementChit.line_items, row.terms).length) return;
  const cause = withdrawn ? 'The agreement chit was ' + agreementChit.status + '.' : 'Every line is at 0.';
  const note = 'Ended: ' + cause;
  const ended = await withEntity(row.entity_id, (handle) => guard(() => store.update(handle, row.entity_id, row.agreement_id, Object.assign({ state: 'ended', counter: null }, stamp(actor, note)))));
  await noteBoth(ended, actor, 'repeat_end', note + ' No run was made.');
  throw refuse(note + ' No run was made.');
}
/** mint the run due on `date`: ONE normal chit through the one send path; the same day twice answers the first chit */
async function runOne(row, date, actor) {
  if (row.runs && row.runs[date]) return { row, date, chit_id: row.runs[date], duplicate: true };
  const seller = row.entity_id;
  const agreementChit = await withEntity(seller, (handle) => store.chit(handle, seller, row.chit_id));
  if (!agreementChit) throw refuse('The agreement chit could not be read.');
  await endUnrunnable(row, agreementChit, actor);
  const ref = 'rep:' + row.agreement_id + ':' + date;
  const sent = await sendAs(seller, runBody(row, agreementChit, date, ref), { idempotency_key: ref });
  if (!sent.ok) throw refuse('Run of ' + date + ' not made' + sentTail(sent));
  const runs = Object.assign({}, row.runs, { [date]: sent.body.chit_id });
  const moved = await withEntity(seller, (handle) => guard(() => store.update(handle, seller, row.agreement_id, Object.assign({ runs }, advanced(row, date, true)))));
  await noteBoth(moved, actor, 'repeat_run', 'Run of ' + date + (row.mode === 'draft' ? ' drafted' : ' sent'));
  return { row: moved, date, chit_id: sent.body.chit_id, duplicate: !!sent.body.duplicate };
}
/** POST /api/repeat/:id/run — the seller runs what is due now (every missed day, oldest first) */
async function runDue(caller, id, actor, ctx) {
  const access = await mustBe(caller, id, null, 'seller');
  const today = await todayOf(caller);
  const verdict = mayDo(access.row, 'seller', 'run', today);
  if (!verdict.ok) throw refuse(verdict.say, 'REPEAT_' + verdict.why.toUpperCase());
  const out = await sweepRow(access.row, today, actor, ctx);
  return Object.assign({ agreement: view(out.row, 'seller', today) }, { ran: out.ran, problems: out.problems });
}
/** run every day due for one agreement, oldest first; the first failure is recorded and stops it */
async function sweepRow(row, today, actor, ctx) {
  const out = { row, ran: [], problems: [] };
  for (const date of dueDates(row, today)) {
    try {
      const result = await runOne(out.row, date, actor);
      out.row = result.row;
      out.ran.push({ date, chit_id: result.chit_id, duplicate: result.duplicate });
    } catch (e) {
      out.problems.push(Object.assign({ agreement_id: row.agreement_id, date }, problemWhy(e, ctx)));
      break;
    }
  }
  return out;
}
/** sweep(entity, today?, ctx?) → { ran, problems } — every agreed agreement of the shop with a run due; safe to run as often as you like. ctx: { request_id } (SEC-90) */
async function sweep(entity, today, ctx) {
  const forDay = today || (await todayOf(entity));
  const out = { ran: [], problems: [] };
  let rows = [];
  try {
    rows = await withEntity(entity, async (handle) => ((await store.exists(handle, entity)) ? store.list(handle, entity) : []));
  } catch (e) {
    if (missing(e)) return out;
    out.problems.push(problemWhy(e, ctx));
    return out;
  }
  for (const row of rows) {
    const result = await sweepRow(row, forDay, null, ctx);
    out.ran = out.ran.concat(result.ran);
    out.problems = out.problems.concat(result.problems);
  }
  return out;
}
/** sweepAll() → { shops, ran, problems } — the nightly: the shops ops.f_repeat_supply_due names (b303), each as itself */
async function sweepAll() {
  let ids = [];
  try {
    ids = await store.dueShops(HOOKS.dayOf(CLOCK.now(), 'UTC'));
  } catch (e) {
    /* the widest day: each shop then asks its OWN today */
    if (!sweepAll.said) {
      sweepAll.said = true;
      require('./logger').info('repeat.sweep', { skipped: String(e && e.message).slice(0, 160) });
    }
    return { shops: 0, ran: 0, problems: 0, skipped: true };
  }
  let ranCount = 0,
    problems = 0;
  for (const id of ids) {
    try {
      const result = await sweep(id);
      ranCount += result.ran.length;
      problems += result.problems.length;
    } catch (e) {
      problems++;
    }
  }
  return { shops: ids.length, ran: ranCount, problems };
}

module.exports = {
  UNITS,
  sqlStore: sql,
  MODES,
  STATES,
  STEPS,
  WHY: WHY_WORDS,
  WORDS,
  CATCH_UP,
  rowOf,
  may: mayDo,
  actions,
  dueDates,
  advanced,
  schedule,
  counterOf,
  runLines,
  view,
  migrated,
  list,
  one: oneAgreement,
  whoIs,
  create,
  accept,
  counter,
  decline,
  agree,
  refuseCounter,
  pause,
  resume,
  end,
  skip,
  run: runDue,
  runOne,
  sweep,
  sweepAll,
  todayOf,
  use: useStore,
  useSender,
  useMover,
  notMigrated
};
