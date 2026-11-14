// @stage tested
// @stage-note [CB CRM] Phase 4: interactions (a call, a visit, a note against a party), follow-ups (a reminder about a party), and the
// @stage-note nightly sweep that rings the bell. Tables are b276 (a DRAFT Athi runs); until then every writer answers CRM_NOT_MIGRATED.
'use strict';
/**
 * lib/crm-followups.js — the two small stores behind CB CRM's "log it" and "remind me" (DATA.md §5, FLOWS F4 · F6).
 *
 * ⭐ A FOLLOW-UP IS NOT A CHIT. It is a reminder about a party, never sent to them (REQUIREMENT-followups §10).
 * ⭐ ASSIGNMENT LIVES HERE AND ONLY HERE (Q5, provisional): the parties have no owner; a follow-up has an assignee.
 * ⚠️ BEFORE b276: every function that needs the tables throws an error with code CRM_NOT_MIGRATED, which the route answers as
 *   503 "not migrated yet" — the books pattern (BOOKS_NOT_MIGRATED) — never a 500. Reads of the party record degrade quietly instead.
 * ⚠️ "LATE" IS THE SERVER'S WORD, in the SHOP's day (books-hooks dayOf: the shop's zone, else its country, else UTC — never a national default,
 *   T2-NATDEF) — a browser clock near midnight must not decide it. A snooze too: the web sends a WORD (`after`, the AFTER table) or a bare date,
 *   never an instant from the phone's clock (W2-CRM, CRM-DAY).
 * ⭐ THE BELL: sweep() raises one `followup` event per shop per day for what is due today or late (kind · count · for whom — nothing
 *   sensitive rides it, lib/events); it marks bell_day so a second run the same day rings nothing.
 *
 * owns: party_interaction · party_followup (b276) — the only writer of both.
 * called by: routes/crm.js (list · page · create · patch · remove · addInteraction) · lib/crm-calls.js (todayOf · AFTER · create · addInteraction) · lib/crm.js markLate (dayOf · isLate) · server.js start (the sweep).
 * FLOW  GET /followups → todayOf() → readRows() [ONE statement: the page + total · late · today window counts] → withParty() → shape() → page-limit.pageOut
 *       PATCH { after } → afterDay(AFTER) → dueOf() → UPDATE → one()
 * // CARD 11-crm-and-marketing/crm-followups
 */
const KINDS = ['call', 'visit', 'message', 'note']; // 'mail' is logged by the mail sender (phase 5), never typed in
const SOURCES = ['manual', 'dues', 'interaction'];
/** ⭐ THE ONE TABLE OF "WHEN?" WORDS (W2-CRM): a snooze, a call outcome's pick and the add sheet's presets all name one of these; the DAYS are here only
 *  (the call desk's OUTCOMES.presets lists which words an outcome offers). The day is counted from the SHOP's today, never the phone's. */
const AFTER = { today: 0, tomorrow: 1, '3days': 3, week: 7 };
const { waiting } = require('./not-migrated');
const pager = require('./page-limit'); /* the one pager: the page asked for, the envelope, the window count's name */
const { isTeamMember, NOT_ON_TEAM } = require('./team-member'); /* ORD-80: the one "is this person on the team" reader */
function dbm() {
  return require('../db');
}
function bad(msg, status, code) {
  const e = new Error(msg);
  e.status = status || 400;
  if (code) e.code = code;
  return e;
}
function notMigrated() {
  return bad(waiting('Follow-ups and call notes', true, 'Nothing was saved; write it down and add it after the update.'), 503, 'CRM_NOT_MIGRATED');
}
const isTableGone = (e) => e && (e.code === '42P01' || (e.code === '42703' && /hidden_at|bell_day/.test(String(e.message))));

let _ok = false;
/** do both b276 tables exist? (a positive answer is remembered; a negative one is asked again — the day it is run, it just works) */
async function migrated(handle) {
  if (_ok) return true;
  const tables = await handle.query(`SELECT to_regclass('party_interaction') IS NOT NULL AS i, to_regclass('party_followup') IS NOT NULL AS f`);
  const x = tables.rows[0] || {};
  _ok = !!(x.i && x.f);
  return _ok;
}
async function need(handle) {
  if (!(await migrated(handle))) throw notMigrated();
}
function forget() {
  _ok = false;
}

const trimText = (value, maxLen) =>
  String(value == null ? '' : value)
    .trim()
    .replace(/[ \t]+/g, ' ')
    .slice(0, maxLen);
/** the shop's ZONE (for its day) — its IANA zone when the Ledger's setting carries one (identities.timezone), else its country, else null (UTC — never India); books-hooks.dayOf reads either (M210) */
async function countryOf(handle, owner) {
  try {
    const zone = await zoneOfShop(handle, owner); /* R6: the identity's zone first — the Parties list reads the same row, so both agree on "today" */
    if (zone) return zone;
    const setting = await dbm().trySavepoint(handle, () => require('./books-store').setting(handle, owner), null);
    return (setting && (setting.timezone || setting.country)) || null;
  } catch (e) {
    require('./logger').warn('crm-followups: the shop setting is unread — its day is cut at UTC', { owner, why: String(e && e.message) });
    return null;
  } /* T2-NATDEF: unstated → dayOf's UTC, never India */
}
/** the shop's zone from its identity row (timezone, else country; null = unstated) — the ONE reader the Parties list and the follow-ups share */
async function zoneOfShop(conn, owner) {
  const found = await conn.query('SELECT COALESCE(timezone, country) AS zone FROM identities WHERE identity_id = $1', [owner]);
  return (found.rows[0] && found.rows[0].zone) || null;
}
const booksHooks = () => require('./books-hooks');
const log = require('./logger');
const dayOf = (ts, country) => booksHooks().dayOf(ts, country);
const isCalendarDay = (text) => require('../middleware/validate').isCalendarDay(text);
/** a typed due: a date (the presets write dates) → the start of that shop day; a full time stays as given */
function dueOf(value, country) {
  const text = String(value == null ? '' : value).trim();
  /* CRM-227: a date-shaped text must be a REAL day the books hold (middleware/validate isCalendarDay, the one test): 2026-02-30 and 0001-01-01 were a RangeError (500) in dayBounds */
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (!isCalendarDay(text)) throw bad('That is not a real day. Give a date like 2026-12-31.', 400, 'BAD_DUE');
    return booksHooks().dayBounds(text, country).from;
  }
  /* a bare number ("12345", 12345) is a count, not a time: Date.parse read it as a year */
  if (/^[-+]?\d+$/.test(text)) throw bad('When is it due? Give a date, not just a number.', 400, 'BAD_DUE');
  const time = Date.parse(text);
  if (!isFinite(time)) throw bad('When is it due? Give a date.', 400, 'BAD_DUE');
  return new Date(time).toISOString();
}
/** a "when?" word → the shop's day it names ('YYYY-MM-DD'); a word not in AFTER is refused in words with a code */
function afterDay(word, today) {
  const pick = String(word == null ? '' : word).trim();
  if (!Object.prototype.hasOwnProperty.call(AFTER, pick)) throw bad('Pick today, tomorrow, 3 days or next week.', 400, 'BAD_AFTER');
  return require('./books-engines').addDays(today, AFTER[pick]);
}

/* ── interactions ───────────────────────────────────────────────────────────────────────────────────────────────── */
async function addInteraction(handle, owner, party_id, input, by) {
  await need(handle);
  const kind = String((input || {}).kind || '').toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('Kind is call, visit, message or note.');
  let direction = (input || {}).direction == null || input.direction === '' ? null : String(input.direction).toLowerCase();
  if (kind === 'note') direction = null;
  else if (direction !== 'in' && direction !== 'out') throw bad('Direction is in or out.');
  const body = trimText((input || {}).body, 2000);
  if (!body) throw bad('Write one line about it.');
  let at = new Date();
  if (input.at) {
    const time = Date.parse(input.at);
    if (!isFinite(time)) throw bad('When did it happen?');
    if (time > Date.now() + 86400000) throw bad('That is in the future.');
    at = new Date(time);
  }
  const result = await handle.query(
    `INSERT INTO party_interaction (owner_entity_id, party_id, kind, direction, body, at, by_user_id)
                           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING interaction_id, party_id, kind, direction, body, at, by_user_id, created_at`,
    [owner, party_id, kind, direction, body, at.toISOString(), by || null]
  );
  return result.rows[0];
}

/* ── follow-ups ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const COLS_F = `f.followup_id, f.party_id, f.what, f.due_at, f.assignee_user_id, f.done_at, f.done_by, f.source, f.created_at,
       i.display_name AS party_name, a.display_name AS assignee_name`;
const FROM_F = `FROM party_followup f
  LEFT JOIN identities i ON i.identity_id = f.party_id
  LEFT JOIN identities a ON a.identity_id = f.assignee_user_id`;
const SELECT_F = 'SELECT ' + COLS_F + ' ' + FROM_F;
/** the party number and "still your party?" for a set of rows — two statements for the whole set, never one per row (each on the shop's own handle) */
async function withParty(handle, owner, rows) {
  const ids = Array.from(new Set(rows.map((item) => item.party_id))).filter(Boolean);
  if (!ids.length) return rows;
  const customers = await handle.query(
    `SELECT cl.customer_identity_id AS pid, to_jsonb(cl)->>'party_no' AS party_no,
         (to_jsonb(cl)->>'hidden_at' IS NULL AND to_jsonb(cl)->>'merged_into' IS NULL) AS live
    FROM customer_list cl WHERE cl.owner_entity_id = $1 AND cl.customer_identity_id = ANY($2::uuid[])`,
    [owner, ids]
  );
  const text = await handle.query(
    `SELECT sl.supplier_entity_id AS pid, to_jsonb(sl)->>'party_no' AS party_no,
         (to_jsonb(sl)->>'hidden_at' IS NULL AND to_jsonb(sl)->>'merged_into' IS NULL) AS live
    FROM supplier_list sl WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = ANY($2::uuid[])`,
    [owner, ids]
  );
  const by = new Map();
  for (const x of customers.rows.concat(text.rows)) {
    const key = String(x.pid),
      entry = by.get(key) || { party_no: null, live: false };
    by.set(key, { party_no: entry.party_no || x.party_no || null, live: entry.live || !!x.live });
  }
  return rows.map((item) => {
    const entry = by.get(String(item.party_id)) || {};
    return Object.assign({}, item, { party_no: entry.party_no || null, listed: !!entry.live });
  });
}
const iso = (date) => (date == null ? null : date instanceof Date ? date.toISOString() : String(date));
/**
 * ⭐ THE ONE LATE RULE (M148/M149): a day is LATE when it is before the shop's today. Follow-ups (late · bucket · the Parties column · the banner count) and dues
 * (a party's oldest due) all ask this — the page paints what it is told and works nothing out. `today` is the shop's day (dayOf), never a browser's.
 * bucketOf(day, today) → 'late' | 'today' | 'week' (the next six days) | 'later'. Dates are YYYY-MM-DD, so string order is day order.
 */
const isLate = (dayText, today) => !!dayText && !!today && String(dayText).slice(0, 10) < String(today).slice(0, 10);
function bucketOf(dayText, today) {
  if (!dayText || !today) return 'later';
  const dayStr = String(dayText).slice(0, 10),
    todayText = String(today).slice(0, 10);
  if (dayStr < todayText) return 'late';
  if (dayStr === todayText) return 'today';
  return dayStr <= require('./books-engines').addDays(todayText, 6) ? 'week' : 'later';
}
/** the row as the screen reads it, with the server's `late` · `bucket` (the shop's day) and `due_day` */
function shape(result, country, today) {
  const dayText = dayOf(result.due_at, country);
  return {
    followup_id: result.followup_id,
    party_id: result.party_id,
    party_no: result.party_no || null,
    party_name: result.party_name || null,
    party_listed: result.listed !== false,
    what: result.what,
    due_at: iso(result.due_at),
    due_day: dayText,
    assignee_user_id: result.assignee_user_id || null,
    assignee_name: result.assignee_name || null,
    source: result.source,
    done_at: iso(result.done_at),
    created_at: iso(result.created_at),
    late: !result.done_at && isLate(dayText, today),
    today: !result.done_at && dayText === today,
    bucket: result.done_at ? 'later' : bucketOf(dayText, today)
  };
}
/** `now` is optional (a Date or ISO text) — a test pins the day with it; unset, the real clock. */
async function todayOf(handle, owner, now) {
  const country = await countryOf(handle, owner);
  return { country: country, today: dayOf((now ? new Date(now) : new Date()).toISOString(), country) };
}

/** the WHERE of a follow-up list — scope (mine · all) · done (open · done) · one party — and its arguments, built once for the page and its re-count */
function listWhere(owner, query) {
  const args = [owner],
    where = ['f.owner_entity_id = $1'];
  where.push(query.done ? 'f.done_at IS NOT NULL' : 'f.done_at IS NULL');
  if (query.scope === 'mine' && query.me) {
    args.push(query.me);
    where.push('f.assignee_user_id = $' + args.length);
  }
  if (query.party_id) {
    args.push(query.party_id);
    where.push('f.party_id = $' + args.length);
  }
  return { where: where.join(' AND '), args };
}
/**
 * readRows(h, owner, q, today, pg) → { rows, total, late, today } — ONE statement: the page asked for (every row when none was asked,
 * page-limit's rule) with the WHOLE set's total · late · today as window counts on every row (routes/testing readPage's way), so the
 * badge and the banner count the set, not the page. Late and today are the shop's day bounds, the same cut shape() makes.
 */
async function readRows(handle, owner, query, today, pg) {
  const whereOf = listWhere(owner, query),
    bounds = booksHooks().dayBounds(today.today, today.country);
  const args = whereOf.args.concat([bounds.from, bounds.to]),
    nestedStart = '$' + (args.length - 1),
    end = '$' + args.length;
  const counts = `count(*) OVER ()::int AS ${pager.TOTAL_COLUMN},
       count(*) FILTER (WHERE f.done_at IS NULL AND f.due_at < ${nestedStart}) OVER ()::int AS late_rows,
       count(*) FILTER (WHERE f.done_at IS NULL AND f.due_at >= ${nestedStart} AND f.due_at < ${end}) OVER ()::int AS today_rows`;
  const sql = `SELECT ${COLS_F}, ${counts}
  ${FROM_F} WHERE ${whereOf.where} ORDER BY f.due_at ASC, f.created_at ASC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
  const rows = (await handle.query(sql, args.concat([pg.limit, pg.offset]))).rows;
  const again = async (limit, offset) => (await handle.query(sql, args.concat([limit, offset]))).rows;
  const total = await pager.totalOf(rows, pg, again);
  const first = rows[0] || {};
  return { rows, total, late: Number(first.late_rows) || 0, today: Number(first.today_rows) || 0 };
}
/** page(h, owner, { scope, done, me, party_id?, page? }) → the one envelope { followups, total, page, limit } + late · today (the whole set's) · shop_day */
async function page(handle, owner, opts) {
  await need(handle);
  const query = opts || {},
    pg = query.page || pager.pageArgs(null, 0, 0),
    todayCtx = await todayOf(handle, owner, query.now);
  const read = await readRows(handle, owner, query, todayCtx, pg);
  const followups = (await withParty(handle, owner, read.rows)).map((x) => shape(x, todayCtx.country, todayCtx.today));
  return Object.assign(pager.pageOut('followups', followups, pg, read.total), { late: read.late, today: read.today, shop_day: todayCtx.today });
}
/** list(h, owner, { scope: 'mine'|'all', done: 0|1, me, party_id? }) → every row (the record's own follow-ups; the route pages through page()) */
async function list(handle, owner, opts) {
  return (await page(handle, owner, opts)).followups;
}
async function one(handle, owner, id) {
  const result = await handle.query(`${SELECT_F} WHERE f.owner_entity_id = $1 AND f.followup_id = $2`, [owner, id]);
  if (!result.rows[0]) return null;
  const when = await todayOf(handle, owner);
  return shape((await withParty(handle, owner, result.rows))[0], when.country, when.today);
}
/** a person of this shop: lib/team-member (ORD-80 lifted it so the chit-line door asks the same question). An id the CALLER typed (`asked`) that is no uuid names nobody (S41, K-1): the database is never asked */
const assigneeOk = (handle, owner, assignee, asked) => isTeamMember(handle, owner, assignee, { typed: !!asked });
async function create(handle, owner, body, by) {
  await need(handle);
  const x = body || {};
  const what = trimText(x.what, 300);
  if (!what) throw bad('What should you do? One line.');
  const source = x.source == null ? 'manual' : String(x.source);
  if (SOURCES.indexOf(source) < 0) throw bad('Source is manual, dues or interaction.');
  const country = await countryOf(handle, owner);
  const dueText = dueOf(x.due_at, country);
  const assignee = x.assignee_user_id ? String(x.assignee_user_id) : by || null;
  if (assignee && !(await assigneeOk(handle, owner, assignee, !!x.assignee_user_id))) throw bad(NOT_ON_TEAM, 400, 'BAD_ASSIGNEE');
  const result = await handle.query(
    `INSERT INTO party_followup (owner_entity_id, party_id, what, due_at, assignee_user_id, source)
                           VALUES ($1,$2,$3,$4,$5,$6) RETURNING followup_id`,
    [owner, x.party_id, what, dueText, assignee, source]
  );
  return one(handle, owner, result.rows[0].followup_id);
}
/** a patch that moves the day: a date (`due_at`) or a snooze WORD (`after`) */
const isSnooze = (body) => 'due_at' in body || 'after' in body;
/** the day a snooze lands on — a WORD is counted from the SHOP's today (W2-CRM), a date is taken as given, both in the shop's zone */
async function snoozeTo(handle, owner, body) {
  const todayCtx = await todayOf(handle, owner);
  return dueOf('after' in body ? afterDay(body.after, todayCtx.today) : body.due_at, todayCtx.country);
}
/** patch(h, owner, id, body, { by, isOwner }) — done · due_at (a date) · after (a snooze WORD: the shop's day decides) · assignee_user_id (the owner's or the assignee's) · what */
async function patch(handle, owner, id, body, assignee) {
  await need(handle);
  const existing = await one(handle, owner, id);
  if (!existing) throw bad('Not found', 404);
  const x = body || {},
    sets = [],
    args = [owner, id];
  const set = (col, newValue) => {
    args.push(newValue);
    sets.push(col + ' = $' + args.length);
  };
  if ('what' in x) {
    const what = trimText(x.what, 300);
    if (!what) throw bad('What should you do? One line.');
    set('what', what);
  }
  if (isSnooze(x)) set('due_at', await snoozeTo(handle, owner, x));
  if ('assignee_user_id' in x) {
    const assigneeName = x.assignee_user_id ? String(x.assignee_user_id) : null;
    if (!(assignee && (assignee.isOwner || (assignee.by && String(assignee.by) === String(existing.assignee_user_id)))))
      throw bad('Only the owner or the assignee can hand this on.', 403, 'NOT_ASSIGNEE');
    if (assigneeName && !(await assigneeOk(handle, owner, assigneeName, true))) throw bad(NOT_ON_TEAM, 400, 'BAD_ASSIGNEE');
    set('assignee_user_id', assigneeName);
  }
  if ('done' in x) {
    if (x.done) {
      if (!existing.done_at) {
        sets.push('done_at = now()');
        set('done_by', (assignee && assignee.by) || null);
      }
    } else {
      sets.push('done_at = NULL');
      sets.push('done_by = NULL');
    }
  }
  if (!sets.length) throw bad('Nothing to change: what, due_at, after, assignee_user_id or done.');
  /* a snooze or a reopen puts it back on the bell: it is due on a new day */
  if (isSnooze(x) || ('done' in x && !x.done)) sets.push('bell_day = NULL');
  await handle.query(`UPDATE party_followup SET ${sets.join(', ')} WHERE owner_entity_id = $1 AND followup_id = $2`, args);
  return one(handle, owner, id);
}
async function remove(handle, owner, id) {
  await need(handle);
  const result = await handle.query(`DELETE FROM party_followup WHERE owner_entity_id = $1 AND followup_id = $2 RETURNING followup_id`, [owner, id]);
  return result.rows.length > 0;
}

/* ── the nightly sweep → the bell ───────────────────────────────────────────────────────────────────────────────── */
/**
 * sweep(deps) → { shops, rang, skipped }. Which shops: ops.f_crm_followup_entities() (b276, SECURITY DEFINER — ids only, the one
 * cross-shop read, as books-nightly's f_books_enabled). Each shop is read AS that shop (withEntity). For every assignee with
 * follow-ups due today or late that have not rung today, ONE `followup` event goes to the shop's bell, and bell_day is set.
 * deps: { query, withEntity, emit, now } — the defaults are the real ones; the tests pass stand-ins.
 */
async function sweep(deps) {
  const depsOrEmpty = deps || {};
  const query = depsOrEmpty.query || dbm().query,
    withEntity = depsOrEmpty.withEntity || dbm().withEntity;
  const emit = depsOrEmpty.emit || ((nestedIds, e) => require('./events').emit(nestedIds, e));
  const now = depsOrEmpty.now ? new Date(depsOrEmpty.now) : new Date();
  const out = { shops: 0, rang: 0, skipped: 0 };
  let ids;
  try {
    ids = (await query('SELECT owner_entity_id FROM ops.f_crm_followup_entities()')).rows.map((item) => item.owner_entity_id);
  } catch (e) {
    if (isTableGone(e) || e.code === '42883' || e.code === '3F000') return Object.assign(out, { notMigrated: true });
    throw e;
  }
  for (const owner of ids) {
    out.shops++;
    try {
      await withEntity(owner, async (handle) => {
        const country = await countryOf(handle, owner),
          today = dayOf(now.toISOString(), country);
        const end = booksHooks().dayBounds(today, country).to;
        /* open, due by the end of the shop's today, and not yet rung today */
        const result = await handle.query(
          `SELECT assignee_user_id, due_at, followup_id FROM party_followup
                                  WHERE owner_entity_id = $1 AND done_at IS NULL AND due_at < $2 AND bell_day IS DISTINCT FROM $3::date`,
          [owner, end, today]
        );
        if (!result.rows.length) {
          out.skipped++;
          return;
        }
        const lookup = new Map();
        for (const x of result.rows) {
          const key = String(x.assignee_user_id || ''),
            e = lookup.get(key) || { today: 0, late: 0, ids: [] };
          if (isLate(dayOf(x.due_at, country), today)) e.late++;
          else e.today++;
          e.ids.push(x.followup_id);
          lookup.set(key, e);
        }
        /* marked first, rung after: a failed write must not leave a bell that rings again tomorrow for the same thing */
        await handle.query(`UPDATE party_followup SET bell_day = $2::date WHERE owner_entity_id = $1 AND followup_id = ANY($3::uuid[])`, [
          owner,
          today,
          result.rows.map((x) => x.followup_id)
        ]);
        for (const [who, e] of lookup) {
          emit([owner], { kind: 'followup', for: who || null, today: e.today, late: e.late });
          out.rang++;
        }
      });
    } catch (e) {
      out.skipped++;
      require('./logger').warn('crm.sweep', { entity_id: owner, error: String(e && e.message).slice(0, 200) });
    }
  }
  return out;
}
let timer = null;
/** in-process, every 6 hours (first run 12 minutes after start); CRM_SWEEP=0 turns it off. Idempotent by bell_day. */
function start() {
  if (timer || process.env.CRM_SWEEP === '0' || require('./dev-otp').isTestRun()) return false;
  const kick = () => {
    sweep().catch(log.orElse('crm-followups kick: failed — carried on without it'));
  };
  setTimeout(kick, 12 * 60000).unref();
  timer = setInterval(kick, 6 * 3600000);
  timer.unref();
  return true;
}

/** noteMany(h, owner, [{ party_id, body }], by) → how many — addInteraction's 'note' for a SET in ONE statement (L3: what a CSV row carried beyond name and phone) */
async function noteMany(handle, owner, notes, by) {
  const rows = (notes || [])
    .map((item) => ({ party_id: item && item.party_id, body: trimText(item && item.body, 2000) }))
    .filter((item) => item.party_id && item.body);
  if (!rows.length) return 0;
  const result = await handle.query(
    `INSERT INTO party_interaction (owner_entity_id, party_id, kind, direction, body, at, by_user_id)
                           SELECT $1, v.pid, 'note', NULL, v.body, now(), $4 FROM unnest($2::uuid[], $3::text[]) AS v(pid, body)`,
    [owner, rows.map((item) => String(item.party_id)), rows.map((item) => item.body), by || null]
  );
  return (result && result.rowCount) || rows.length;
}

module.exports = {
  todayOf,
  zoneOfShop,
  isLate,
  bucketOf,
  KINDS,
  SOURCES,
  AFTER,
  afterDay,
  migrated,
  forget,
  need,
  addInteraction,
  noteMany,
  list,
  page,
  one,
  create,
  patch,
  remove,
  sweep,
  start,
  shape,
  countryOf,
  dayOf,
  bad,
  notMigrated,
  isTableGone
};
