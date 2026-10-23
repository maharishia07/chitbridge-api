// @stage tested
// @stage-note [RI1] Repeat supply as an AGREEMENT both parties hold (b303, DRAFT — not run): the schedule beside the agreement chit,
// @stage-note the customer's accept · counter · decline · skip, the seller's pause · end · run, and the sweep that mints each run
// @stage-note through the ONE send path (lib/autoraise.sendAs → POST /api/chits/send). A re-run never mints twice.
'use strict';
/**
 * lib/repeat-supply.js — REPEAT SUPPLY, BETTER THAN A "RECURRING INVOICE" (round RI1, 2026-10-12; gap R1 §4).
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
const R = require('./books-recurring'); /* nextAfter · valid — the one "next one" */
const H = require('./books-hooks'); /* dayOf — the shop's day */

const UNITS = ['daily', 'weekly', 'monthly'];
const MODES = ['draft', 'send'];
const STATES = ['proposed', 'agreed', 'countered', 'declined', 'paused', 'ended'];
const CATCH_UP = 12; /* a stuck agreement is named, not looped on */
const MAX_RUNS = 999,
  MAX_EVERY = 365;

const WHY = {
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

const ask = (why) => {
  const e = new Error(why);
  e.code = 'BOOKS_BAD_REQUEST';
  e.status = 400;
  return e;
};
const refuse = (why, code) => {
  const e = new Error(why);
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
  const e = new Error(WHY.not_migrated);
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
const ymd = require('./books-engines').ymd; /* T2-NATDEF: THE date reader — next_on · end_on · last_run_on are `date` columns */
const db = () => require('../db');
const withEntity = (e, fn) => db().withEntity(e, fn);
const no = (why) => ({ ok: false, why, say: WHY[why] });
const YES = Object.freeze({ ok: true });

/* ── PURE: the step table, the schedule ─────────────────────────────────────────────────────────────────────── */

/** may(row, side, action, today?) → { ok:true } | { ok:false, why, say } — the agreement's own answer (the rail's held/level is asked by the route) */
function may(row, side, action, today) {
  if (!row || SIDES.indexOf(side) < 0) return no('wrong_state');
  const t = STEPS[side][action];
  if (!t) return no(side === 'seller' ? 'not_customer' : 'not_seller'); /* the other side's verb */
  if (row.state === 'ended' || row.state === 'declined') return no('ended');
  if (t.indexOf(row.state) < 0) return no('wrong_state');
  if (action === 'run' && today && row.next_on > today) return no('not_due');
  return YES;
}
/** every verb of a side with its verdict — what a screen paints (greyed WITH its sentence) */
function actions(row, side, today) {
  const out = {};
  for (const a of Object.keys(STEPS[side] || {})) out[a] = may(row, side, a, today);
  return out;
}
/** the days a run has fallen due on or before `today`: next_on, then each step, at most CATCH_UP, never past end_on or runs_max */
function dueDates(row, today) {
  const out = [];
  if (!row || row.state !== 'agreed' || !row.next_on) return out;
  let d = row.next_on,
    done = Number(row.runs_done) || 0;
  for (let index = 0; index < CATCH_UP && d <= today; index++) {
    if (row.end_on && d > row.end_on) break;
    if (row.runs_max && done >= row.runs_max) break;
    out.push(d);
    done++;
    d = R.nextAfter(d, row.unit, row.anchor_day, row.every);
  }
  return out;
}
/** the row after the run on `date` (or a skip of it): next_on steps, the count moves (a skip counts no run), and past the end it ENDS */
function advanced(row, date, ran) {
  const next = R.nextAfter(date, row.unit, row.anchor_day, row.every);
  const done = (Number(row.runs_done) || 0) + (ran ? 1 : 0);
  const over = (row.end_on && next > row.end_on) || (row.runs_max && done >= row.runs_max);
  return Object.assign({ next_on: next, runs_done: done }, ran ? { last_run_on: date } : {}, over ? { state: 'ended', state_note: 'Ran its course' } : {});
}
/** the schedule a request asks for, checked — { every, unit, anchor_day, next_on, end_on, runs_max, mode } */
function schedule(rows, today) {
  const unit = String(rows.unit || '').toLowerCase();
  if (UNITS.indexOf(unit) < 0) throw ask('How often? daily, weekly or monthly.');
  const every = Math.floor(Number(rows.every == null ? 1 : rows.every));
  if (!(every >= 1 && every <= MAX_EVERY)) throw ask('Every how many? 1 to ' + MAX_EVERY + '.');
  const start = R.valid(rows.start_on);
  if (!start) throw ask('From when? Use YYYY-MM-DD.');
  if (today && start < today) throw ask('The first run cannot be in the past.');
  const anchor = unit === 'monthly' ? (rows.anchor_day != null ? Number(rows.anchor_day) : Number(start.slice(8, 10))) : null;
  if (unit === 'monthly' && !(anchor >= 1 && anchor <= 31)) throw ask('Which day of the month? 1 to 31.');
  const u = rows.until || {};
  let end_on = null,
    runs_max = null;
  if (u.on != null && u.on !== '') {
    end_on = R.valid(u.on);
    if (!end_on) throw ask('Until when? Use YYYY-MM-DD.');
    if (end_on < start) throw ask('It would end before it starts.');
  }
  if (u.runs != null && u.runs !== '') {
    runs_max = Math.floor(Number(u.runs));
    if (!(runs_max >= 1 && runs_max <= MAX_RUNS)) throw ask('How many runs? 1 to ' + MAX_RUNS + '.');
  }
  const mode = rows.mode == null ? 'draft' : String(rows.mode).toLowerCase();
  if (MODES.indexOf(mode) < 0) throw ask('Each run: draft (a person sends it) or send.');
  return { every, unit, anchor_day: anchor, next_on: start, end_on, runs_max, mode };
}
/** a counter-proposal, checked: quantities per line (of the agreement's lines), and/or a new every · unit · start — with a note */
function counterOf(rows, row, lines) {
  const out = {
    note: String((rows && rows.note) || '')
      .trim()
      .slice(0, 400)
  };
  if (rows && Array.isArray(rows.lines) && rows.lines.length) {
    const ids = new Set((lines || []).map((item) => item.line_id));
    out.lines = rows.lines
      .map((x) => ({ line_id: String(x.line_id || ''), quantity: Number(x.quantity) }))
      .filter((x) => ids.has(x.line_id) && Number.isFinite(x.quantity) && x.quantity >= 0);
    if (!out.lines.length) throw ask('Which line, and how many?');
  }
  if (rows && (rows.unit != null || rows.every != null || rows.start_on != null)) {
    const entries = schedule({
      unit: rows.unit || row.unit,
      every: rows.every == null ? row.every : rows.every,
      start_on: rows.start_on || row.next_on,
      anchor_day: rows.anchor_day,
      mode: row.mode
    });
    out.every = entries.every;
    out.unit = entries.unit;
    out.anchor_day = entries.anchor_day;
    out.start_on = entries.next_on;
  }
  if (!out.lines && out.every == null) throw ask('What would you change — a quantity, how often, or from when?');
  return out;
}
/** the lines a run carries: the agreement's lines with the AGREED quantities; a changed quantity drops the frozen line figures so the send path prices it */
function runLines(lines, terms) {
  const q = {};
  for (const x of (terms && terms.lines) || []) q[x.line_id] = x.quantity;
  return (lines || [])
    .filter((item) => !(item.line_id in q) || q[item.line_id] > 0)
    .map((item) => {
      if (!(item.line_id in q) || Number(item.quantity != null ? item.quantity : item.qty) === q[item.line_id]) return Object.assign({}, item);
      const o = Object.assign({}, item, { quantity: q[item.line_id] });
      for (const k of ['total', 'net', 'line_total', 'amount', 'tax', 'taxable', 'offers', 'offer']) delete o[k];
      return o;
    });
}

/* ── the store (every statement names the seller) ───────────────────────────────────────────────────────────── */

const COLS = `r.agreement_id, r.entity_id, r.chit_id, r.customer_entity_id, r.source_chit_id, r.every, r.unit, r.anchor_day, r.next_on, r.end_on, r.runs_max,
  r.runs_done, r.mode, r.state, r.terms, r.counter, r.skips, r.runs, r.last_run_on, r.state_by, r.state_at, r.state_note, r.created_by, r.created_at, r.updated_at,
  h.all_recipients, h.summary_json, h.manual_subject, h.auto_subject`;
const J = (v, d) => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : v);
function rowOf(rows) {
  if (!rows) return null;
  const rec = J(rows.all_recipients, []) || [];
  const other = rec.filter((x) => x && String(x.entity_id || '') === String(rows.customer_entity_id))[0] || null;
  const sum = J(rows.summary_json, {}) || {};
  return {
    agreement_id: rows.agreement_id,
    entity_id: rows.entity_id,
    chit_id: rows.chit_id,
    customer_entity_id: rows.customer_entity_id,
    source_chit_id: rows.source_chit_id || null,
    every: Number(rows.every) || 1,
    unit: rows.unit,
    anchor_day: rows.anchor_day == null ? null : Number(rows.anchor_day),
    next_on: ymd(rows.next_on),
    end_on: ymd(rows.end_on),
    runs_max: rows.runs_max == null ? null : Number(rows.runs_max),
    runs_done: Number(rows.runs_done) || 0,
    mode: rows.mode,
    state: rows.state,
    terms: J(rows.terms, {}) || {},
    counter: J(rows.counter, null),
    skips: J(rows.skips, []) || [],
    runs: J(rows.runs, {}) || {},
    last_run_on: ymd(rows.last_run_on),
    state_by: rows.state_by || null,
    state_at: rows.state_at || null,
    state_note: rows.state_note || null,
    created_by: rows.created_by || null,
    created_at: rows.created_at || null,
    updated_at: rows.updated_at || null,
    customer: other ? { entity_id: other.entity_id, name: other.display_name || other.name || null } : { entity_id: rows.customer_entity_id, name: null },
    money: sum.money || null,
    currency: sum.currency_code || (sum.money && sum.money.currency_code) || null,
    subject: rows.manual_subject || rows.auto_subject || null
  };
}
const sql = {
  async exists(h, e) {
    try {
      await h.query(`SELECT 1 FROM repeat_supply WHERE entity_id = $1 LIMIT 1`, [e]);
      return true;
    } catch (err) {
      if (missing(err)) return false;
      throw err;
    }
  },
  async list(h, e) {
    const r = await h.query(
      `SELECT ${COLS} FROM repeat_supply r JOIN chit_header h ON h.chit_id = r.chit_id AND h.entity_id = r.entity_id
                             WHERE r.entity_id = $1 ORDER BY (r.state IN ('agreed','countered','proposed','paused')) DESC, r.next_on, r.created_at`,
      [e]
    );
    return r.rows.map(rowOf);
  },
  async get(h, e, id) {
    const r = await h.query(
      `SELECT ${COLS} FROM repeat_supply r JOIN chit_header h ON h.chit_id = r.chit_id AND h.entity_id = r.entity_id
                             WHERE r.entity_id = $1 AND r.agreement_id = $2`,
      [e, id]
    );
    return rowOf(r.rows[0]);
  },
  async insert(h, e, rows) {
    await h.query(
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
    return sql.get(h, e, rows.agreement_id);
  },
  /** a merge-patch: only the columns named are touched; jsonb columns are replaced whole */
  async update(h, e, id, p) {
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
    ].filter((item) => Object.prototype.hasOwnProperty.call(p, item));
    if (!cols.length) return sql.get(h, e, id);
    const vals = cols.map((item) => (rows.indexOf(item) >= 0 ? JSON.stringify(p[item]) : p[item]));
    const set = cols.map((item, index) => item + ' = $' + (index + 3) + (rows.indexOf(item) >= 0 ? '::jsonb' : '')).join(', ');
    await h.query(`UPDATE repeat_supply SET ${set}, updated_at = now() WHERE entity_id = $1 AND agreement_id = $2`, [e, id].concat(vals));
    return sql.get(h, e, id);
  },
  /** the chit I hold (MY copy, under MY RLS): sender · my status · the lines · business_json — or null */
  async chit(h, e, chit_id) {
    const r = await h.query(
      `SELECT h.chit_id, h.sender_entity_id, h.sender_entity_display_name, h.direction, h.current_status, h.purpose, h.all_recipients, h.business_json, h.summary_json, h.role,
                                    d.line_items FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
                             WHERE h.chit_id = $1 AND h.entity_id = $2`,
      [chit_id, e]
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      chit_id: x.chit_id,
      sender_entity_id: x.sender_entity_id,
      sender_name: x.sender_entity_display_name,
      direction: x.direction,
      status: x.current_status,
      purpose: x.purpose,
      role: x.role,
      all_recipients: J(x.all_recipients, []) || [],
      business_json: J(x.business_json, {}) || {},
      summary_json: J(x.summary_json, {}) || {},
      line_items: J(x.line_items, []) || []
    };
  },
  /** a line in the chit's own history, on ONE copy (the caller writes it on both — "visible to both") */
  async note(h, e, chit_id, who, action, detail) {
    await h.query(`INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [
      chit_id,
      e,
      action,
      (who && who.id) || null,
      (who && who.name) || 'Repeat supply',
      String(detail || '').slice(0, 500)
    ]);
  },
  /** the shop's zone row — { timezone, country } */
  async zone(h, e) {
    const r = await h.query(`SELECT timezone, country FROM identities WHERE identity_id = $1`, [e]);
    return r.rows[0] || null;
  },
  /** ids only, the one cross-shop read (ops.f_repeat_supply_due, SECURITY DEFINER) */
  async dueShops(day) {
    const r = await db().query('SELECT entity_id FROM ops.f_repeat_supply_due($1)', [day]);
    return r.rows.map((x) => x.entity_id);
  }
};
let store = sql;
/** tests: an in-memory store with the same functions (null puts the SQL back) */
function use(s) {
  store = s || sql;
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
const moveTo = (...a) => (mover || require('../routes/chits').moveStatus)(...a);
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
  const c = zones[entity];
  if (!c || c.at < CLOCK.nowMs() - 60000) {
    let z = null;
    try {
      z = await withEntity(entity, (h) => store.zone(h, entity));
    } catch (e) {
      log.fellBack('repeat-supply todayOf: the read failed — answered with nothing', e);
      z = null;
    }
    zones[entity] = { z, at: CLOCK.nowMs() };
  }
  return H.dayOf(CLOCK.now(), zones[entity].z || null); /* T2-NATDEF: unstated → UTC, never India */
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
  return withEntity(entity, async (h) => {
    try {
      return await store.exists(h, entity);
    } catch (e) {
      if (missing(e)) return false;
      throw e;
    }
  });
}
/** GET /api/repeat — the seller's agreements */
async function list(entity) {
  const today = await todayOf(entity);
  return withEntity(entity, async (h) => (await guard(() => store.list(h, entity))).map((item) => view(item, 'seller', today)));
}
/**
 * whoIs(me, id, chit_id?) → { row, side, held } — the agreement as the caller may see it. The seller reads its own row. Anyone else must
 * HOLD a copy of the agreement chit (their own chit_header row, under their own RLS): then the row is read as the seller and the side is
 * 'customer' when the chit names them. Nothing held → null (404 at the route — an id in the URL learns nothing).
 */
async function whoIs(me, id, chit_id) {
  const mine = await withEntity(me, (h) => guard(() => store.get(h, me, id)));
  if (mine) return { row: mine, side: 'seller', held: null };
  if (!chit_id) return null;
  const held = await withEntity(me, (h) => store.chit(h, me, chit_id));
  const rep = held && held.business_json && held.business_json.repeat;
  if (!held || !rep || String(rep.agreement_id) !== String(id)) return null;
  const seller = held.sender_entity_id;
  const row = await withEntity(seller, (h) => guard(() => store.get(h, seller, id)));
  if (!row || String(row.chit_id) !== String(chit_id)) return null;
  return { row, side: String(row.customer_entity_id) === String(me) ? 'customer' : 'viewer', held };
}
async function one(me, id, chit_id) {
  const w = await whoIs(me, id, chit_id);
  if (!w) throw notFound();
  const today = await todayOf(w.row.entity_id);
  return Object.assign({ agreement: view(w.row, w.side === 'viewer' ? 'customer' : w.side, today) }, w.side === 'viewer' ? { read_only: true } : {});
}

/* ── writes ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const noteBoth = async (row, who, action, detail) => {
  for (const e of [row.entity_id, row.customer_entity_id]) {
    try {
      await withEntity(e, (h) => store.note(h, e, row.chit_id, who, action, detail));
    } catch (err) {
      log.fellBack('repeat-supply noteBoth: the read failed — carried on without it', err); /* history is best-effort: a missing line never undoes a move */
    }
  }
};
const stamp = (who, note) => ({
  state_by: (who && who.id) || null,
  state_at: CLOCK.now().toISOString(),
  state_note: note == null ? null : String(note).slice(0, 400)
});

/**
 * create(seller, who, body) — "Repeat this…" on a sent invoice: { chit_id, every, unit, start_on, anchor_day?, until: { runs? | on? }, mode? }
 * → the agreement chit is SENT (purpose subscription, the invoice's lines) and the row inserted, state proposed.
 */
async function create(seller, who, body) {
  const b = body || {};
  if (!b.chit_id) throw ask('Which bill should repeat?');
  if (!(await migrated(seller))) throw notMigrated(); /* before b303: said in words BEFORE anything is sent */
  const today = await todayOf(seller);
  const rows = schedule(b, today);
  const src = await withEntity(seller, (h) => store.chit(h, seller, String(b.chit_id)));
  if (!src) throw notFound();
  if (String(src.sender_entity_id) !== String(seller)) throw refuse('Only a bill you sent can repeat.');
  if (src.role === 'Draft') throw refuse('Send the bill first, then repeat it.');
  const cust = (src.all_recipients || []).filter((x) => x && x.entity_id && String(x.entity_id) !== String(seller) && x.role !== 'sender')[0] || null;
  if (!cust) throw refuse('This bill names no ChitBridge customer to agree with.');
  if (!src.line_items.length) throw refuse('This bill has no lines to repeat.');
  const agreement_id = uuidv4();
  const repeat = {
    agreement_id,
    every: rows.every,
    unit: rows.unit,
    anchor_day: rows.anchor_day,
    start_on: rows.next_on,
    until: { runs: rows.runs_max, on: rows.end_on },
    mode: rows.mode,
    source_chit_id: src.chit_id
  };
  const sent = await sendAs(
    seller,
    {
      recipients: [{ entity_id: cust.entity_id, role: 'to' }],
      purpose: 'subscription',
      manual_subject:
        'Repeat supply · every ' +
        (rows.every > 1 ? rows.every + ' ' : '') +
        { daily: 'day', weekly: 'week', monthly: 'month' }[rows.unit] +
        (rows.every > 1 ? 's' : ''),
      line_items: src.line_items.map((item) => Object.assign({}, item)),
      business_json: Object.assign({ currency: src.summary_json.currency_code || (src.business_json && src.business_json.currency) || null }, { repeat }),
      client_ref: 'rep:' + agreement_id + ':agreement'
    },
    { idempotency_key: 'rep:' + agreement_id + ':agreement' }
  );
  if (!sent.ok)
    throw refuse(
      'The agreement could not be sent' + (sent.body && (sent.body.message || sent.body.error) ? ': ' + (sent.body.message || sent.body.error) : '.')
    );
  const row = await withEntity(seller, (h) =>
    guard(() =>
      store.insert(
        h,
        seller,
        Object.assign(
          {
            agreement_id,
            chit_id: sent.body.chit_id,
            customer_entity_id: cust.entity_id,
            source_chit_id: src.chit_id,
            terms: {},
            created_by: (who && who.id) || null
          },
          rows
        )
      )
    )
  );
  await noteBoth(row, who, 'repeat_proposed', 'Repeat supply proposed — ' + row.subject);
  return view(row, 'seller', today);
}

/** one state move, checked by may() for the side; `patch` is applied beside the state and stamp */
async function move(w, who, action, to, patch, note, detail) {
  const today = await todayOf(w.row.entity_id);
  const v = may(w.row, w.side, action, today);
  if (!v.ok) throw refuse(v.say, 'REPEAT_' + v.why.toUpperCase());
  const row = await withEntity(w.row.entity_id, (h) =>
    guard(() => store.update(h, w.row.entity_id, w.row.agreement_id, Object.assign({}, patch || {}, to ? { state: to } : {}, stamp(who, note))))
  );
  await noteBoth(row, who, 'repeat_' + action, detail || WORDS[row.state] + (note ? ' — ' + note : ''));
  return view(row, w.side, today);
}
async function mustBe(me, id, chit_id, side) {
  const w = await whoIs(me, id, chit_id);
  if (!w) throw notFound();
  if (w.side !== side) throw refuse(WHY[side === 'seller' ? 'not_seller' : 'not_customer'], side === 'seller' ? 'REPEAT_NOT_SELLER' : 'REPEAT_NOT_CUSTOMER');
  return w;
}

/** the customer ACCEPTS: their received copy moves to accepted through the one status writer (`mover`: routes/chits moveStatus, or a stand-in), then the row */
async function accept(me, id, chit_id, who, me_rail) {
  const w = await mustBe(me, id, chit_id, 'customer');
  const v = may(w.row, 'customer', 'accept');
  if (!v.ok) throw refuse(v.say, 'REPEAT_' + v.why.toUpperCase());
  const r = await moveTo(me, w.row.chit_id, 'accepted', who, 'Repeat supply agreed', me_rail);
  if (r && r.code && r.code >= 400) {
    const e = new Error((r.body && r.body.message) || 'Could not accept.');
    e.status = r.code;
    e.body = r.body;
    throw e;
  }
  return move(w, who, 'accept', 'agreed', { counter: null }, null, 'Agreed by the customer');
}
/** the customer COUNTERS: a proposal on the agreement; runs wait until the seller agrees */
async function counter(me, id, chit_id, who, body) {
  const w = await mustBe(me, id, chit_id, 'customer');
  const v = may(w.row, 'customer', 'counter');
  if (!v.ok) throw refuse(v.say, 'REPEAT_' + v.why.toUpperCase());
  const rows = counterOf(body, w.row, w.held ? w.held.line_items : []);
  const words = [
    rows.lines ? rows.lines.map((x) => 'line ' + x.line_id.slice(0, 8) + ' → ' + x.quantity).join(', ') : null,
    rows.every != null ? 'every ' + rows.every + ' ' + rows.unit + ' from ' + rows.start_on : null,
    rows.note || null
  ]
    .filter(Boolean)
    .join(' · ');
  return move(
    w,
    who,
    'counter',
    'countered',
    { counter: Object.assign(rows, { by: me, at: CLOCK.now().toISOString() }) },
    rows.note,
    'Customer proposed: ' + words
  );
}
/** the customer DECLINES (their copy moves to rejected through the one status writer when it can; the agreement ends either way) */
async function decline(me, id, chit_id, who, body, me_rail) {
  const w = await mustBe(me, id, chit_id, 'customer');
  const v = may(w.row, 'customer', 'decline');
  if (!v.ok) throw refuse(v.say, 'REPEAT_' + v.why.toUpperCase());
  const note = String((body && body.reason) || '').trim();
  try {
    await moveTo(me, w.row.chit_id, 'rejected', who, note || 'Repeat supply declined', me_rail);
  } catch (e) {
    log.fellBack('repeat-supply decline: failed — carried on without it', e); /* the agreement still ends */
  }
  return move(w, who, 'decline', 'declined', { counter: null }, note, 'Declined by the customer' + (note ? ' — ' + note : ''));
}
/** the seller AGREES to the counter: its lines/schedule become the terms; or REFUSES it (the agreement ends) */
async function agree(me, id, who) {
  const w = await mustBe(me, id, null, 'seller');
  const v = may(w.row, 'seller', 'agree');
  if (!v.ok) throw refuse(v.say, 'REPEAT_' + v.why.toUpperCase());
  const rows = w.row.counter || {};
  const terms = Object.assign({}, w.row.terms);
  if (rows.lines) terms.lines = rows.lines;
  const patch = { terms, counter: null };
  if (rows.every != null) {
    patch.every = rows.every;
    patch.unit = rows.unit;
    patch.anchor_day = rows.anchor_day;
    patch.next_on = rows.start_on;
  }
  return move(w, who, 'agree', 'agreed', patch, null, 'Seller agreed to the change');
}
async function refuseCounter(me, id, who, body) {
  const w = await mustBe(me, id, null, 'seller');
  const note = String((body && body.reason) || '').trim();
  return move(w, who, 'refuse', 'declined', { counter: null }, note, 'Seller did not agree to the change' + (note ? ' — ' + note : ''));
}
async function pause(me, id, who, body) {
  const w = await mustBe(me, id, null, 'seller');
  return move(w, who, 'pause', 'paused', null, (body && body.reason) || null);
}
async function resume(me, id, who) {
  const w = await mustBe(me, id, null, 'seller');
  return move(w, who, 'resume', 'agreed', null, null);
}
async function end(me, id, who, body) {
  const w = await mustBe(me, id, null, 'seller');
  return move(w, who, 'end', 'ended', { counter: null }, (body && body.reason) || null);
}
/** SKIP the next run — either side; the customer says why (the seller reads it). The day moves on; the count does not. */
async function skip(me, id, chit_id, who, body) {
  const w = await whoIs(me, id, chit_id);
  if (!w || w.side === 'viewer') throw notFound();
  const reason = String((body && body.reason) || '').trim();
  if (w.side === 'customer' && !reason) throw refuse(WHY.reason_needed, 'REPEAT_REASON_NEEDED');
  const date = w.row.next_on;
  const skips = (w.row.skips || []).concat([{ date, by_entity_id: me, reason: reason || null, at: CLOCK.now().toISOString() }]);
  const adv = advanced(w.row, date, false);
  return move(w, who, 'skip', adv.state || null, Object.assign({ skips }, adv), reason, 'Skipped ' + date + (reason ? ' — ' + reason : ''));
}

/* ── the runs ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** mint the run due on `date`: ONE normal chit through the one send path; the same day twice answers the first chit */
async function runOne(row, date, who) {
  if (row.runs && row.runs[date]) return { row, date, chit_id: row.runs[date], duplicate: true };
  const seller = row.entity_id;
  const ag = await withEntity(seller, (h) => store.chit(h, seller, row.chit_id));
  if (!ag) throw refuse('The agreement chit could not be read.');
  const ref = 'rep:' + row.agreement_id + ':' + date;
  const sent = await sendAs(
    seller,
    {
      recipients: [{ entity_id: row.customer_entity_id, role: 'to' }],
      purpose: 'invoice',
      is_draft: row.mode === 'draft',
      manual_subject: 'Repeat supply · ' + date,
      line_items: runLines(ag.line_items, row.terms),
      business_json: {
        currency: ag.summary_json.currency_code || null,
        repeat_of: row.agreement_id,
        repeat_chit_id: row.chit_id,
        repeat_run: date,
        billed_at: date + 'T00:00:00.000Z'
      },
      client_ref: ref
    },
    { idempotency_key: ref }
  );
  if (!sent.ok)
    throw refuse('Run of ' + date + ' not made' + (sent.body && (sent.body.message || sent.body.error) ? ': ' + (sent.body.message || sent.body.error) : '.'));
  const runs = Object.assign({}, row.runs, { [date]: sent.body.chit_id });
  const moved = await withEntity(seller, (h) => guard(() => store.update(h, seller, row.agreement_id, Object.assign({ runs }, advanced(row, date, true)))));
  await noteBoth(moved, who, 'repeat_run', 'Run of ' + date + (row.mode === 'draft' ? ' drafted' : ' sent'));
  return { row: moved, date, chit_id: sent.body.chit_id, duplicate: !!sent.body.duplicate };
}
/** POST /api/repeat/:id/run — the seller runs what is due now (every missed day, oldest first) */
async function run(me, id, who, ctx) {
  const w = await mustBe(me, id, null, 'seller');
  const today = await todayOf(me);
  const v = may(w.row, 'seller', 'run', today);
  if (!v.ok) throw refuse(v.say, 'REPEAT_' + v.why.toUpperCase());
  const out = await sweepRow(w.row, today, who, ctx);
  return Object.assign({ agreement: view(out.row, 'seller', today) }, { ran: out.ran, problems: out.problems });
}
async function sweepRow(row, today, who, ctx) {
  const out = { row, ran: [], problems: [] };
  for (const date of dueDates(row, today)) {
    try {
      const r = await runOne(out.row, date, who);
      out.row = r.row;
      out.ran.push({ date, chit_id: r.chit_id, duplicate: r.duplicate });
    } catch (e) {
      out.problems.push(Object.assign({ agreement_id: row.agreement_id, date }, problemWhy(e, ctx)));
      break;
    }
  }
  return out;
}
/** sweep(entity, today?, ctx?) → { ran, problems } — every agreed agreement of the shop with a run due; safe to run as often as you like. ctx: { request_id } (SEC-90) */
async function sweep(entity, today, ctx) {
  const day = today || (await todayOf(entity));
  const out = { ran: [], problems: [] };
  let rows = [];
  try {
    rows = await withEntity(entity, async (h) => ((await store.exists(h, entity)) ? store.list(h, entity) : []));
  } catch (e) {
    if (missing(e)) return out;
    out.problems.push(problemWhy(e, ctx));
    return out;
  }
  for (const row of rows) {
    const r = await sweepRow(row, day, null, ctx);
    out.ran = out.ran.concat(r.ran);
    out.problems = out.problems.concat(r.problems);
  }
  return out;
}
/** sweepAll() → { shops, ran, problems } — the nightly: the shops ops.f_repeat_supply_due names (b303), each as itself */
async function sweepAll() {
  let ids = [];
  try {
    ids = await store.dueShops(H.dayOf(CLOCK.now(), 'UTC'));
  } catch (e) {
    /* the widest day: each shop then asks its OWN today */
    if (!sweepAll.said) {
      sweepAll.said = true;
      require('./logger').info('repeat.sweep', { skipped: String(e && e.message).slice(0, 160) });
    }
    return { shops: 0, ran: 0, problems: 0, skipped: true };
  }
  let ran = 0,
    problems = 0;
  for (const id of ids) {
    try {
      const r = await sweep(id);
      ran += r.ran.length;
      problems += r.problems.length;
    } catch (e) {
      problems++;
    }
  }
  return { shops: ids.length, ran, problems };
}

module.exports = {
  UNITS,
  MODES,
  STATES,
  STEPS,
  WHY,
  WORDS,
  CATCH_UP,
  rowOf,
  may,
  actions,
  dueDates,
  advanced,
  schedule,
  counterOf,
  runLines,
  view,
  migrated,
  list,
  one,
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
  run,
  runOne,
  sweep,
  sweepAll,
  todayOf,
  use,
  useSender,
  useMover,
  notMigrated
};
