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
 * CALLED BY routes/books.js (/recurring) · lib/books-nightly (sweep) · lib/books-cashflow (templates: the cash view counts what comes round, R75) · lib/repeat-supply (nextAfter)
 * CARD 14-accounting/recurring-entries
 */
const { waiting } = require('./not-migrated');
const books = require('./books');
const log = require('./logger');
const booksEngines = require('./books-engines');
const booksStore = require('./books-store');

const FREQUENCIES = ['monthly', 'quarterly', 'yearly'];
const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
/* ⭐ RI1 (2026-10-12): the day-stepped frequencies a repeat-supply agreement uses (lib/repeat-supply.js) — nextAfter is THE one place a
   "next one" is worked out, so it was WIDENED (a 4th argument `every`, and these two steps), never copied. The books routes' own
   vocabulary (FREQUENCIES, clean()) is unchanged: a journal template is still monthly · quarterly · yearly. */
const DAYS = { daily: 1, weekly: 7 };
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const CATCH_UP = 12; /* at most this many missed days of one template are handled in one run — a stuck one is named, not looped on */
const ask = (reason) => {
  const e = new Error(reason);
  e.code = 'BOOKS_BAD_REQUEST';
  e.status = 400;
  return e;
};
const refuse = (reason, code) => {
  const e = new Error(reason);
  e.code = code || 'BOOKS_REFUSED';
  e.refused = true;
  return e;
};
const notMigrated = () => {
  const e = new Error(waiting('Recurring entries', true, 'No recurring entry was created or posted. Enter anything that falls due by hand until then.'));
  e.code = 'BOOKS_NOT_MIGRATED';
  e.refused = true;
  return e;
};
const missing = (e) => e && (e.code === '42P01' || e.code === '42703');
const ymdOf = booksEngines.ymd; /* T2-NATDEF: THE date reader (it reads a 'YYYY-MM-DD…' string too) */
const withEntity = (e, fn) => require('../db').withEntity(e, fn);

/* ── dates: the one place a "next one" is worked out ───────────────────────────────────────────────────────────── */

const daysIn = (y, month) => new Date(Date.UTC(y, month, 0)).getUTCDate(); /* m is 1-12 */
/** a real calendar day, or null */
function valid(dateText) {
  if (!DATE.test(String(dateText || ''))) return null;
  const y = Number(dateText.slice(0, 4)),
    month = Number(dateText.slice(5, 7)),
    dayOfMonth = Number(dateText.slice(8, 10));
  return month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= daysIn(y, month) ? String(dateText) : null;
}
/**
 * the day after `date` by `every` (default 1) steps of `frequency`, keeping to `anchor` (the 31st comes back to the 31st after a short month).
 * daily · weekly step by days (every 2 weeks = +14 days); monthly · quarterly · yearly step by months.
 */
function nextAfter(date, frequency, anchor, every) {
  const perMonth = Math.max(1, Math.floor(Number(every) || 1));
  if (!valid(date)) throw ask('When is it due? Use YYYY-MM-DD.');
  if (DAYS[frequency]) return books.addDays(date, DAYS[frequency] * perMonth);
  const step = MONTHS[frequency] && MONTHS[frequency] * perMonth;
  if (!step) throw ask('How often? monthly, quarterly or yearly.');
  const idx = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + step;
  const y = Math.floor(idx / 12),
    month = (idx % 12) + 1,
    dayOfMonth = Math.min(Number(anchor) || Number(date.slice(8, 10)), daysIn(y, month));
  return y + '-' + String(month).padStart(2, '0') + '-' + String(dayOfMonth).padStart(2, '0');
}

/* ── the store ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const COLS = `recurring_id, name, event, frequency, next_on, anchor_day, end_on, auto, active, last_done_on, created_by, created_at, updated_at`;
function rowOf(row) {
  return (
    row && {
      recurring_id: row.recurring_id,
      name: row.name,
      event: typeof row.event === 'string' ? JSON.parse(row.event) : row.event || {},
      frequency: row.frequency,
      next_on: ymdOf(row.next_on),
      anchor_day: Number(row.anchor_day),
      end_on: ymdOf(row.end_on),
      auto: !!row.auto,
      active: row.active !== false,
      last_done_on: ymdOf(row.last_done_on),
      created_by: row.created_by || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null
    }
  );
}
/** the real SQL — every statement names the shop in $1 */
const sql = {
  async exists(handle, e) {
    try {
      await handle.query(`SELECT 1 FROM recurring_entry WHERE entity_id = $1 LIMIT 1`, [e]);
      return true;
    } catch (err) {
      if (missing(err)) return false;
      throw err;
    }
  },
  async list(handle, e) {
    const row = await handle.query(`SELECT ${COLS} FROM recurring_entry WHERE entity_id = $1 ORDER BY active DESC, next_on, created_at`, [e]);
    return row.rows.map(rowOf);
  },
  async get(handle, e, id) {
    const row = await handle.query(`SELECT ${COLS} FROM recurring_entry WHERE entity_id = $1 AND recurring_id = $2`, [e, id]);
    return rowOf(row.rows[0]);
  },
  async insert(handle, e, template) {
    const inserted = await handle.query(
      `INSERT INTO recurring_entry (entity_id, name, event, frequency, next_on, anchor_day, end_on, auto, active, created_by)
                             VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
      [e, template.name, JSON.stringify(template.event), template.frequency, template.next_on, template.anchor_day, template.end_on || null, !!template.auto, template.active !== false, template.created_by || null]
    );
    return rowOf(inserted.rows[0]);
  },
  /** a merge-patch: only the columns named are touched */
  async update(handle, e, id, changes) {
    const cols = ['name', 'event', 'frequency', 'next_on', 'anchor_day', 'end_on', 'auto', 'active', 'last_done_on'].filter((item) =>
      Object.prototype.hasOwnProperty.call(changes, item)
    );
    if (!cols.length) return sql.get(handle, e, id);
    const vals = cols.map((item) => (item === 'event' ? JSON.stringify(changes[item]) : changes[item]));
    const set = cols.map((item, index) => item + ' = $' + (index + 3) + (item === 'event' ? '::jsonb' : '')).join(', ');
    const row = await handle.query(
      `UPDATE recurring_entry SET ${set}, updated_at = now() WHERE entity_id = $1 AND recurring_id = $2 RETURNING ${COLS}`,
      [e, id].concat(vals)
    );
    return rowOf(row.rows[0]);
  }
};
let store = sql;
/** tests: an in-memory store with the same functions (null puts the SQL back) */
function use(injected) {
  store = injected || sql;
}
async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (missing(err)) throw notMigrated();
    throw err;
  }
}

/* ── the template, checked ─────────────────────────────────────────────────────────────────────────────────────── */

const manualLib = () => require('./books-manual');
/** the event of a template on a day — lib/books-manual's own builder, so a template that cannot be built is refused when it is made, not on the night */
function eventFor(template, date) {
  return Object.assign({}, template.event, { date, client_ref: 'rec:' + template.recurring_id + ':' + date });
}
async function mustBuild(entity, settings, event, date, by) {
  const ledgerEvent = Object.assign({}, event, { date, client_ref: 'rec:check:' + date });
  try {
    await manualLib().eventOf(entity, settings, ledgerEvent, by);
  } catch (e) {
    if (e && e.code === 'BOOKS_BAD_REQUEST') throw e;
    if (e && e.refused) throw refuse('That entry cannot be repeated: ' + e.message);
    throw e;
  }
}
function clean(body, forCreate) {
  const out = {};
  if (forCreate || body.name !== undefined) {
    const name = String(body.name || '')
      .trim()
      .slice(0, 80);
    if (!name) throw ask('What do you call it? e.g. Shop rent.');
    out.name = name;
  }
  if (forCreate || body.event !== undefined) {
    if (!body.event || typeof body.event !== 'object' || Array.isArray(body.event))
      throw ask('What happens each time? Give the entry as you would in ＋ Entry (its kind and fields).');
    const event = Object.assign({}, body.event);
    delete event.date;
    delete event.client_ref;
    if (!String(event.kind || event.type || '').trim()) throw ask('What kind of entry is it? e.g. expense.');
    out.event = event;
  }
  if (forCreate || body.frequency !== undefined) {
    const frequency = String(body.frequency || '').toLowerCase();
    if (FREQUENCIES.indexOf(frequency) < 0) throw ask('How often? monthly, quarterly or yearly.');
    out.frequency = frequency;
  }
  if (forCreate || body.next_on !== undefined) {
    if (!valid(body.next_on)) throw ask('When is the first one due? Use YYYY-MM-DD.');
    out.next_on = String(body.next_on);
    out.anchor_day = Number(out.next_on.slice(8, 10));
  }
  if (body.end_on !== undefined) {
    if (body.end_on === null || body.end_on === '') out.end_on = null;
    else if (!valid(body.end_on)) throw ask('When does it stop? Use YYYY-MM-DD.');
    else out.end_on = String(body.end_on);
  }
  if (body.auto !== undefined) out.auto = body.auto === true;
  if (body.active !== undefined) out.active = body.active === true;
  return out;
}

/* ── CRUD (the routes' bodies) ─────────────────────────────────────────────────────────────────────────────────── */

const view = (template) => Object.assign({}, template, { due: !!(template.active && template.next_on) });
async function list(entity) {
  return withEntity(entity, async (handle) => (await guard(() => store.list(handle, entity))).map(view));
}
/** the active templates on a handle a caller already holds (books-cashflow.read: the cash view counts what comes round) — [] before b281 ran, never a 500 */
async function templates(handle, entity) {
  try {
    return (await guard(() => store.list(handle, entity))).filter((template) => template.active && template.next_on).map(view);
  } catch (err) {
    if (err && err.code === 'BOOKS_NOT_MIGRATED') return [];
    throw err;
  }
}
async function one(entity, id) {
  return withEntity(entity, async (handle) => {
    const template = await guard(() => store.get(handle, entity, id));
    if (!template) {
      const e = new Error('No such recurring entry.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    return template;
  });
}
async function create(entity, settings, body, by) {
  const template = clean(body || {}, true);
  if (template.end_on && template.end_on < template.next_on) throw ask('It would stop before it starts. Put the end after the first due day.');
  await mustBuild(entity, settings, template.event, template.next_on, by);
  return withEntity(entity, async (handle) => view(await guard(() => store.insert(handle, entity, Object.assign(template, { created_by: by || null })))));
}
async function patch(entity, settings, id, body, by) {
  const changes = clean(body || {}, false);
  const current = await one(entity, id);
  const merged = Object.assign({}, current, changes);
  if (merged.end_on && merged.end_on < merged.next_on) throw ask('It would stop before it starts. Put the end after the next due day.');
  if (changes.event || changes.next_on) await mustBuild(entity, settings, merged.event, merged.next_on, by);
  return withEntity(entity, async (handle) => view(await guard(() => store.update(handle, entity, id, changes))));
}
/** DELETE = stop it. A template is never deleted (the books are insert-only, and what it posted stays) — it is switched off, and says so. */
async function stop(entity, id) {
  await one(entity, id);
  return withEntity(entity, async (handle) => Object.assign(view(await guard(() => store.update(handle, entity, id, { active: false }))), { stopped: true }));
}

/* ── one occurrence: post it, or let it pass ───────────────────────────────────────────────────────────────────── */

/** the template after one occurrence has been dealt with: next_on moves a step; past end_on it is switched off */
function advanced(template) {
  const next = nextAfter(template.next_on, template.frequency, template.anchor_day);
  return { next_on: next, last_done_on: template.next_on, active: !(template.end_on && next > template.end_on) };
}
/** post the occurrence due on t.next_on (as the owner-made MJ entry; the same day twice answers the first entry) and move the template on */
async function postDue(entity, settings, template, by) {
  const date = template.next_on;
  const row = await manualLib().post(entity, settings, eventFor(template, date), by);
  if (!row || row.off) throw refuse('The ledger is off.');
  const moved = await withEntity(entity, (handle) => guard(() => store.update(handle, entity, template.recurring_id, advanced(template))));
  return { posted: row, template: view(moved), date };
}
/** POST /recurring/:id/post — accept what the To-do proposed (the owner) */
async function accept(entity, settings, id, by) {
  const template = await one(entity, id);
  if (!template.active) throw refuse('That repeating entry is stopped.');
  const dayOfMonth = require('./books-period').today(settings);
  if (template.next_on > dayOfMonth) throw refuse('"' + template.name + '" is not due until ' + template.next_on + '.');
  return postDue(entity, settings, template, by);
}
/** POST /recurring/:id/skip — let this one pass without posting (a month the rent was waived) */
async function skip(entity, id) {
  const template = await one(entity, id);
  if (!template.active) throw refuse('That repeating entry is stopped.');
  const moved = await withEntity(entity, (handle) => guard(() => store.update(handle, entity, id, advanced(template))));
  return { skipped: template.next_on, template: view(moved) };
}

/* ── what is due (also read by the To-do feed) ─────────────────────────────────────────────────────────────────── */

/** the active templates whose next day has come — [] while b281 has not run */
async function dueOn(entity, today) {
  return withEntity(entity, async (handle) => {
    try {
      if (!(await store.exists(handle, entity))) return [];
      return (await store.list(handle, entity)).filter((item) => item.active && item.next_on <= today && !(item.end_on && item.next_on > item.end_on));
    } catch (e) {
      if (missing(e)) return [];
      throw e;
    }
  });
}
/** the accruals whose reversal day has come and which have not turned back yet: [{ ref, due, posted_on }] — read from the journal, no table of its own */
async function reversalsDue(entity, settings, today) {
  const periodLib = require('./books-period');
  const from = books.addDays(today, -400);
  return withEntity(entity, async (handle) => {
    const out = [];
    for (const x of await booksStore.entries(handle, entity, from, today)) {
      const accrualMatch = /^accrual:(.+)$/.exec(String(x.source_ref || ''));
      if (!accrualMatch) continue;
      const dueDate = periodLib.reversalDate(settings, ymdOf(x.posting_date));
      if (dueDate > today) continue;
      if (await booksStore.entryBySource(handle, entity, 'accrual-rev:' + accrualMatch[1])) continue;
      out.push({ ref: accrualMatch[1], due: dueDate, posted_on: ymdOf(x.posting_date) });
    }
    return out;
  });
}

/* ── THE SWEEP ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * sweep(entity, s, today, opt?) → { proposed, proposed_reversals, posted: [{ name, date, entry_no, duplicate }], reversed: [{ ref, date, entry_no }], problems: [{ what, … }] }
 *   ⭐ posting needs policy_flags.books.auto_post ON (opt.autoPost overrides, for tests); OFF, NOTHING is posted — auto templates count as `proposed`, reversals as `proposed_reversals`.
 *   For each due template: `auto` (and the flag on) → posted (every missed day up to today, oldest first, at most CATCH_UP); otherwise counted as `proposed` — it waits
 *   on the To-do and nothing is written. Then every accrual whose reversal day has come is reversed (the route's own reverseAccrual, by the system → JV).
 *   Safe to run as often as you like: a day that has posted answers duplicate, and a reversal that has posted is not listed again.
 */
/**
 * autoPostOn(entity) → boolean — policy_flags.books.auto_post ('on' or { on: true }). ⭐ Absent, unreadable or anything else is OFF: a
 * failed read must never turn posting on. (M34; the flag's schema is lib/policy.js FLAGS.books.)
 */
async function autoPostOn(entity) {
  try {
    const row = await withEntity(entity, (handle) =>
      handle.query(`SELECT to_jsonb(i)->'policy_flags'->'books'->'auto_post' AS v FROM identities i WHERE i.identity_id = $1`, [entity])
    );
    const value = row && row.rows && row.rows[0] && row.rows[0].v;
    return value === 'on' || (!!value && typeof value === 'object' && value.on === true);
  } catch (e) {
    log.fellBack('books-recurring autoPostOn: the read failed — answered no', e);
    return false;
  }
}

async function sweep(entity, settings, today, opt) {
  const out = { proposed: 0, proposed_reversals: 0, posted: [], reversed: [], problems: [] };
  const auto = opt && opt.autoPost !== undefined ? opt.autoPost === true : await autoPostOn(entity);
  let rows = [];
  try {
    rows = await dueOn(entity, today);
  } catch (e) {
    out.problems.push({ what: 'recurring entries could not be read', why: String(e && e.message).slice(0, 200) });
  }
  for (let t of rows) {
    if (!t.auto || !auto) {
      out.proposed++;
      continue;
    } /* flag OFF: an `auto` template is only PROPOSED — it waits on the To-do like the rest */
    for (let index = 0; index < CATCH_UP && t.active && t.next_on <= today; index++) {
      try {
        const row = await postDue(entity, settings, t, t.created_by);
        out.posted.push({ name: t.name, date: row.date, entry_no: row.posted.entry_no || null, duplicate: !!row.posted.duplicate });
        t = row.template;
      } catch (e) {
        out.problems.push({ what: 'recurring entry not posted', name: t.name, date: t.next_on, why: String(e && e.message).slice(0, 200) });
        break;
      }
    }
  }
  try {
    const periodLib = require('./books-period');
    for (const a of await reversalsDue(entity, settings, today)) {
      if (!auto) {
        out.proposed_reversals++;
        continue;
      } /* flag OFF: the reversal waits on the To-do (accrual_reversals_due) */
      try {
        const row = await periodLib.reverseAccrual(entity, settings, a.ref, { date: a.due }, null);
        out.reversed.push({ ref: a.ref, date: a.due, entry_no: row.entry_no || null, duplicate: !!row.duplicate });
      } catch (e) {
        out.problems.push({ what: 'accrual reversal not posted', ref: a.ref, date: a.due, why: String(e && e.message).slice(0, 200) });
      }
    }
  } catch (e) {
    out.problems.push({ what: 'accrual reversals could not be read', why: String(e && e.message).slice(0, 200) });
  }
  return out;
}

module.exports = {
  FREQUENCIES,
  DAYS,
  nextAfter,
  valid,
  eventFor,
  list,
  templates,
  one,
  create,
  patch,
  stop,
  accept,
  skip,
  dueOn,
  reversalsDue,
  sweep,
  autoPostOn,
  use,
  notMigrated
};
