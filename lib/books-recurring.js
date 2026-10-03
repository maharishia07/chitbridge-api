// @stage tested
// @stage-note [BOOKS v2] Recurring entries (b281, DRAFT — not run) and THE DAILY SWEEP: a due template is proposed on the To-do or posted (auto);
// @stage-note an accrual's reversal is posted on its day. Everything posts through the one writer; a re-run posts nothing twice.
'use strict';
/**
 * lib/books-recurring.js — THE ENTRIES THAT COME ROUND, AND THE SWEEP THAT WALKS THEM (Athi, 2026-10-03: parity items 4–5).
 *
 * ⭐ A TEMPLATE IS AN EVENT, NOT A JOURNAL. It holds what POST /api/books/events takes (a kind and its fields) without the date and the client_ref;
 *   on the day, lib/books-manual.js builds the engine's event from it (the same builder the preview and the writer share), so the lines are the
 *   posting engine's — nothing here computes a debit, a credit or a rupee.
 * ⭐ PROPOSE BY DEFAULT. A due template shows on the To-do (GET /api/books/todo) and the owner accepts it (POST /recurring/:id/post) or skips it. A
 *   template that says `auto` is posted by the sweep, as an OWNER-MADE entry (MJ series): the owner decided it when they made the template.
 * ⭐ A RE-RUN NEVER POSTS TWICE: the entry's client_ref is template + due day (`rec:<id>:<date>`), which the writer turns into its source_ref; the
 *   same ref answers the first entry (duplicate: true) — so a sweep that died between the post and moving `next_on` just moves it on the next run.
 * ⭐ THE SWEEP ALSO POSTS DUE ACCRUAL REVERSALS (api #17: "no scheduled job yet for accrual reversals"): an accrual posted in one period turns back on
 *   the first day of the next. It calls the route's own reverseAccrual (lib/books-period.js) — one rule, the engine's reverse event — which is itself
 *   idempotent by source_ref `accrual-rev:<ref>`.
 * ⚠️ NOT MIGRATED → BOOKS_NOT_MIGRATED (503). The table is b281, a DRAFT Athi runs. `exists()` asks before a caller promises anything; the sweep
 *   skips templates quietly (and still posts reversals, which need no table).
 * ⚠️ A REFUSAL IS NAMED, NEVER SWALLOWED: a post into a locked month stops that template (next_on stays) and comes back as a `problem` the nightly
 *   check writes to the Ledger's to-do. Nothing is moved to another date behind the owner's back.
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');

const FREQUENCIES = ['monthly', 'quarterly', 'yearly'];
const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const CATCH_UP = 12;                    /* at most this many missed days of one template are handled in one run — a stuck one is named, not looped on */
const ask = (why) => { const e = new Error(why); e.code = 'BOOKS_BAD_REQUEST'; e.status = 400; return e; };
const refuse = (why, code) => { const e = new Error(why); e.code = code || 'BOOKS_REFUSED'; e.refused = true; return e; };
const notMigrated = () => { const e = new Error('Recurring entries are not created yet — run migration b281 first.'); e.code = 'BOOKS_NOT_MIGRATED'; e.refused = true; return e; };
const missing = (e) => e && (e.code === '42P01' || e.code === '42703');
const ymd = (v) => (v instanceof Date ? E.ymd(v) : v ? String(v).slice(0, 10) : null);
const withEntity = (e, fn) => require('../db').withEntity(e, fn);

/* ── dates: the one place a "next one" is worked out ───────────────────────────────────────────────────────────── */

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();          /* m is 1-12 */
/** a real calendar day, or null */
function valid(d) {
  if (!DATE.test(String(d || ''))) return null;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), day = Number(d.slice(8, 10));
  return m >= 1 && m <= 12 && day >= 1 && day <= daysIn(y, m) ? String(d) : null;
}
/** the day after `date` by one step of `frequency`, keeping to `anchor` (the 31st comes back to the 31st after a short month) */
function nextAfter(date, frequency, anchor) {
  const step = MONTHS[frequency];
  if (!step || !valid(date)) throw ask('How often? monthly, quarterly or yearly.');
  const idx = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + step;
  const y = Math.floor(idx / 12), m = (idx % 12) + 1, day = Math.min(Number(anchor) || Number(date.slice(8, 10)), daysIn(y, m));
  return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/* ── the store ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const COLS = `recurring_id, name, event, frequency, next_on, anchor_day, end_on, auto, active, last_done_on, created_by, created_at, updated_at`;
function rowOf(r) {
  return r && { recurring_id: r.recurring_id, name: r.name, event: typeof r.event === 'string' ? JSON.parse(r.event) : (r.event || {}), frequency: r.frequency, next_on: ymd(r.next_on),
    anchor_day: Number(r.anchor_day), end_on: ymd(r.end_on), auto: !!r.auto, active: r.active !== false, last_done_on: ymd(r.last_done_on), created_by: r.created_by || null,
    created_at: r.created_at || null, updated_at: r.updated_at || null };
}
/** the real SQL — every statement names the shop in $1 */
const sql = {
  async exists(h, e) {
    try { await h.query(`SELECT 1 FROM recurring_entry WHERE entity_id = $1 LIMIT 1`, [e]); return true; }
    catch (err) { if (missing(err)) return false; throw err; }
  },
  async list(h, e) { const r = await h.query(`SELECT ${COLS} FROM recurring_entry WHERE entity_id = $1 ORDER BY active DESC, next_on, created_at`, [e]); return r.rows.map(rowOf); },
  async get(h, e, id) { const r = await h.query(`SELECT ${COLS} FROM recurring_entry WHERE entity_id = $1 AND recurring_id = $2`, [e, id]); return rowOf(r.rows[0]); },
  async insert(h, e, t) {
    const r = await h.query(`INSERT INTO recurring_entry (entity_id, name, event, frequency, next_on, anchor_day, end_on, auto, active, created_by)
                             VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
    [e, t.name, JSON.stringify(t.event), t.frequency, t.next_on, t.anchor_day, t.end_on || null, !!t.auto, t.active !== false, t.created_by || null]);
    return rowOf(r.rows[0]);
  },
  /** a merge-patch: only the columns named are touched */
  async update(h, e, id, p) {
    const cols = ['name', 'event', 'frequency', 'next_on', 'anchor_day', 'end_on', 'auto', 'active', 'last_done_on'].filter((c) => Object.prototype.hasOwnProperty.call(p, c));
    if (!cols.length) return sql.get(h, e, id);
    const vals = cols.map((c) => (c === 'event' ? JSON.stringify(p[c]) : p[c]));
    const set = cols.map((c, i) => c + ' = $' + (i + 3) + (c === 'event' ? '::jsonb' : '')).join(', ');
    const r = await h.query(`UPDATE recurring_entry SET ${set}, updated_at = now() WHERE entity_id = $1 AND recurring_id = $2 RETURNING ${COLS}`, [e, id].concat(vals));
    return rowOf(r.rows[0]);
  },
};
let store = sql;
/** tests: an in-memory store with the same functions (null puts the SQL back) */
function use(s) { store = s || sql; }
async function guard(fn) { try { return await fn(); } catch (err) { if (missing(err)) throw notMigrated(); throw err; } }

/* ── the template, checked ─────────────────────────────────────────────────────────────────────────────────────── */

const M = () => require('./books-manual');
/** the event of a template on a day — lib/books-manual's own builder, so a template that cannot be built is refused when it is made, not on the night */
function eventFor(t, date) { return Object.assign({}, t.event, { date, client_ref: 'rec:' + t.recurring_id + ':' + date }); }
async function mustBuild(entity, s, event, date, by) {
  const ev = Object.assign({}, event, { date, client_ref: 'rec:check:' + date });
  try { await M().eventOf(entity, s, ev, by); }
  catch (e) { if (e && e.code === 'BOOKS_BAD_REQUEST') throw e; if (e && e.refused) throw refuse('That entry cannot be repeated: ' + e.message); throw e; }
}
function clean(b, forCreate) {
  const out = {};
  if (forCreate || b.name !== undefined) { const n = String(b.name || '').trim().slice(0, 80); if (!n) throw ask('What do you call it? e.g. Shop rent.'); out.name = n; }
  if (forCreate || b.event !== undefined) {
    if (!b.event || typeof b.event !== 'object' || Array.isArray(b.event)) throw ask('What happens each time? Give the entry as you would in ＋ Entry (its kind and fields).');
    const ev = Object.assign({}, b.event); delete ev.date; delete ev.client_ref;
    if (!String(ev.kind || ev.type || '').trim()) throw ask('What kind of entry is it? e.g. expense.');
    out.event = ev;
  }
  if (forCreate || b.frequency !== undefined) { const f = String(b.frequency || '').toLowerCase(); if (FREQUENCIES.indexOf(f) < 0) throw ask('How often? monthly, quarterly or yearly.'); out.frequency = f; }
  if (forCreate || b.next_on !== undefined) { if (!valid(b.next_on)) throw ask('When is the first one due? Use YYYY-MM-DD.'); out.next_on = String(b.next_on); out.anchor_day = Number(out.next_on.slice(8, 10)); }
  if (b.end_on !== undefined) { if (b.end_on === null || b.end_on === '') out.end_on = null; else if (!valid(b.end_on)) throw ask('When does it stop? Use YYYY-MM-DD.'); else out.end_on = String(b.end_on); }
  if (b.auto !== undefined) out.auto = b.auto === true;
  if (b.active !== undefined) out.active = b.active === true;
  return out;
}

/* ── CRUD (the routes' bodies) ─────────────────────────────────────────────────────────────────────────────────── */

const view = (t) => Object.assign({}, t, { due: !!(t.active && t.next_on) });
async function list(entity) { return withEntity(entity, async (h) => (await guard(() => store.list(h, entity))).map(view)); }
async function one(entity, id) {
  return withEntity(entity, async (h) => { const t = await guard(() => store.get(h, entity, id)); if (!t) { const e = new Error('No such recurring entry.'); e.code = 'BOOKS_NOT_FOUND'; throw e; } return t; });
}
async function create(entity, s, b, by) {
  const t = clean(b || {}, true);
  if (t.end_on && t.end_on < t.next_on) throw ask('It would stop before it starts. Put the end after the first due day.');
  await mustBuild(entity, s, t.event, t.next_on, by);
  return withEntity(entity, async (h) => view(await guard(() => store.insert(h, entity, Object.assign(t, { created_by: by || null })))));
}
async function patch(entity, s, id, b, by) {
  const p = clean(b || {}, false);
  const cur = await one(entity, id);
  const merged = Object.assign({}, cur, p);
  if (merged.end_on && merged.end_on < merged.next_on) throw ask('It would stop before it starts. Put the end after the next due day.');
  if (p.event || p.next_on) await mustBuild(entity, s, merged.event, merged.next_on, by);
  return withEntity(entity, async (h) => view(await guard(() => store.update(h, entity, id, p))));
}
/** DELETE = stop it. A template is never deleted (the books are insert-only, and what it posted stays) — it is switched off, and says so. */
async function stop(entity, id) {
  await one(entity, id);
  return withEntity(entity, async (h) => Object.assign(view(await guard(() => store.update(h, entity, id, { active: false }))), { stopped: true }));
}

/* ── one occurrence: post it, or let it pass ───────────────────────────────────────────────────────────────────── */

/** the template after one occurrence has been dealt with: next_on moves a step; past end_on it is switched off */
function advanced(t) {
  const next = nextAfter(t.next_on, t.frequency, t.anchor_day);
  return { next_on: next, last_done_on: t.next_on, active: !(t.end_on && next > t.end_on) };
}
/** post the occurrence due on t.next_on (as the owner-made MJ entry; the same day twice answers the first entry) and move the template on */
async function postDue(entity, s, t, by) {
  const date = t.next_on;
  const r = await M().post(entity, s, eventFor(t, date), by);
  if (!r || r.off) throw refuse('The ledger is off.');
  const moved = await withEntity(entity, (h) => guard(() => store.update(h, entity, t.recurring_id, advanced(t))));
  return { posted: r, template: view(moved), date };
}
/** POST /recurring/:id/post — accept what the To-do proposed (the owner) */
async function accept(entity, s, id, by) {
  const t = await one(entity, id);
  if (!t.active) throw refuse('That repeating entry is stopped.');
  const day = require('./books-period').today(s);
  if (t.next_on > day) throw refuse('"' + t.name + '" is not due until ' + t.next_on + '.');
  return postDue(entity, s, t, by);
}
/** POST /recurring/:id/skip — let this one pass without posting (a month the rent was waived) */
async function skip(entity, id) {
  const t = await one(entity, id);
  if (!t.active) throw refuse('That repeating entry is stopped.');
  const moved = await withEntity(entity, (h) => guard(() => store.update(h, entity, id, advanced(t))));
  return { skipped: t.next_on, template: view(moved) };
}

/* ── what is due (also read by the To-do feed) ─────────────────────────────────────────────────────────────────── */

/** the active templates whose next day has come — [] while b281 has not run */
async function dueOn(entity, today) {
  return withEntity(entity, async (h) => {
    try {
      if (!(await store.exists(h, entity))) return [];
      return (await store.list(h, entity)).filter((t) => t.active && t.next_on <= today && !(t.end_on && t.next_on > t.end_on));
    } catch (e) { if (missing(e)) return []; throw e; }
  });
}
/** the accruals whose reversal day has come and which have not turned back yet: [{ ref, due, posted_on }] — read from the journal, no table of its own */
async function reversalsDue(entity, s, today) {
  const P = require('./books-period');
  const from = B.addDays(today, -400);
  return withEntity(entity, async (h) => {
    const out = [];
    for (const x of await S.entries(h, entity, from, today)) {
      const m = /^accrual:(.+)$/.exec(String(x.source_ref || ''));
      if (!m) continue;
      const due = P.reversalDate(s, ymd(x.posting_date));
      if (due > today) continue;
      if (await S.entryBySource(h, entity, 'accrual-rev:' + m[1])) continue;
      out.push({ ref: m[1], due, posted_on: ymd(x.posting_date) });
    }
    return out;
  });
}

/* ── THE SWEEP ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * sweep(entity, s, today) → { proposed, posted: [{ name, date, entry_no, duplicate }], reversed: [{ ref, date, entry_no }], problems: [{ what, … }] }
 *   For each due template: `auto` → posted (every missed day up to today, oldest first, at most CATCH_UP); otherwise counted as `proposed` — it waits
 *   on the To-do and nothing is written. Then every accrual whose reversal day has come is reversed (the route's own reverseAccrual, by the system → JV).
 *   Safe to run as often as you like: a day that has posted answers duplicate, and a reversal that has posted is not listed again.
 */
async function sweep(entity, s, today) {
  const out = { proposed: 0, posted: [], reversed: [], problems: [] };
  let due = [];
  try { due = await dueOn(entity, today); } catch (e) { out.problems.push({ what: 'recurring entries could not be read', why: String(e && e.message).slice(0, 200) }); }
  for (let t of due) {
    if (!t.auto) { out.proposed++; continue; }
    for (let n = 0; n < CATCH_UP && t.active && t.next_on <= today; n++) {
      try {
        const r = await postDue(entity, s, t, t.created_by);
        out.posted.push({ name: t.name, date: r.date, entry_no: r.posted.entry_no || null, duplicate: !!r.posted.duplicate });
        t = r.template;
      } catch (e) {
        out.problems.push({ what: 'recurring entry not posted', name: t.name, date: t.next_on, why: String(e && e.message).slice(0, 200) });
        break;
      }
    }
  }
  try {
    const P = require('./books-period');
    for (const a of await reversalsDue(entity, s, today)) {
      try {
        const r = await P.reverseAccrual(entity, s, a.ref, { date: a.due }, null);
        out.reversed.push({ ref: a.ref, date: a.due, entry_no: r.entry_no || null, duplicate: !!r.duplicate });
      } catch (e) { out.problems.push({ what: 'accrual reversal not posted', ref: a.ref, date: a.due, why: String(e && e.message).slice(0, 200) }); }
    }
  } catch (e) { out.problems.push({ what: 'accrual reversals could not be read', why: String(e && e.message).slice(0, 200) }); }
  return out;
}

module.exports = { FREQUENCIES, nextAfter, valid, eventFor, list, one, create, patch, stop, accept, skip, dueOn, reversalsDue, sweep, use, notMigrated };
