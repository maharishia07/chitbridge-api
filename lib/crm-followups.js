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
const KINDS = ['call', 'visit', 'message', 'note'];            // 'mail' is logged by the mail sender (phase 5), never typed in
const SOURCES = ['manual', 'dues', 'interaction'];
/** ⭐ THE ONE TABLE OF "WHEN?" WORDS (W2-CRM): a snooze, a call outcome's pick and the add sheet's presets all name one of these; the DAYS are here only
 *  (the call desk's OUTCOMES.presets lists which words an outcome offers). The day is counted from the SHOP's today, never the phone's. */
const AFTER = { today: 0, tomorrow: 1, '3days': 3, week: 7 };
const pager = require('./page-limit');   /* the one pager: the page asked for, the envelope, the window count's name */
function dbm() { return require('../db'); }
function bad(msg, status, code) { const e = new Error(msg); e.status = status || 400; if (code) e.code = code; return e; }
function notMigrated() { return bad('CB CRM needs migration b276 (migrations/b276_crm_party.sql) — Athi runs it in the Supabase SQL editor.', 503, 'CRM_NOT_MIGRATED'); }
const isTableGone = (e) => e && (e.code === '42P01' || (e.code === '42703' && /hidden_at|bell_day/.test(String(e.message))));

let _ok = false;
/** do both b276 tables exist? (a positive answer is remembered; a negative one is asked again — the day it is run, it just works) */
async function migrated(h) {
  if (_ok) return true;
  const r = await h.query(`SELECT to_regclass('party_interaction') IS NOT NULL AS i, to_regclass('party_followup') IS NOT NULL AS f`);
  const x = r.rows[0] || {};
  _ok = !!(x.i && x.f);
  return _ok;
}
async function need(h) { if (!(await migrated(h))) throw notMigrated(); }
function forget() { _ok = false; }

const txt = (v, n) => String(v == null ? '' : v).trim().replace(/[ \t]+/g, ' ').slice(0, n);
/** the shop's ZONE (for its day) — its IANA zone when the Ledger's setting carries one (identities.timezone), else its country, else null (UTC — never India); books-hooks.dayOf reads either (M210) */
async function countryOf(h, owner) {
  try { const s = await dbm().trySavepoint(h, () => require('./books-store').setting(h, owner), null); return (s && (s.timezone || s.country)) || null; }   /* T2-NATDEF: unstated → dayOf's UTC, never India's day */
  catch (e) { require('./logger').warn('crm-followups: the shop setting is unread — its day is cut at UTC', { owner, why: String(e && e.message) }); return null; }
}
const H = () => require('./books-hooks');
const log = require('./logger');
const dayOf = (ts, country) => H().dayOf(ts, country);
/** a typed due: a date (the presets write dates) → the start of that shop day; a full time stays as given */
function dueOf(v, country) {
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return H().dayBounds(s, country).from;
  const t = Date.parse(s); if (!isFinite(t)) throw bad('When is it due? Give a date.');
  return new Date(t).toISOString();
}
/** a "when?" word → the shop's day it names ('YYYY-MM-DD'); a word not in AFTER is refused in words with a code */
function afterDay(word, today) {
  const pick = String(word == null ? '' : word).trim();
  if (!Object.prototype.hasOwnProperty.call(AFTER, pick)) throw bad('Pick today, tomorrow, 3 days or next week.', 400, 'BAD_AFTER');
  return require('./books-engines').addDays(today, AFTER[pick]);
}

/* ── interactions ───────────────────────────────────────────────────────────────────────────────────────────────── */
async function addInteraction(h, owner, party_id, b, by) {
  await need(h);
  const kind = String((b || {}).kind || '').toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('Kind is call, visit, message or note.');
  let direction = (b || {}).direction == null || b.direction === '' ? null : String(b.direction).toLowerCase();
  if (kind === 'note') direction = null;
  else if (direction !== 'in' && direction !== 'out') throw bad('Direction is in or out.');
  const body = txt((b || {}).body, 2000);
  if (!body) throw bad('Write one line about it.');
  let at = new Date();
  if (b.at) { const t = Date.parse(b.at); if (!isFinite(t)) throw bad('When did it happen?'); if (t > Date.now() + 86400000) throw bad('That is in the future.'); at = new Date(t); }
  const r = await h.query(`INSERT INTO party_interaction (owner_entity_id, party_id, kind, direction, body, at, by_user_id)
                           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING interaction_id, party_id, kind, direction, body, at, by_user_id, created_at`,
                          [owner, party_id, kind, direction, body, at.toISOString(), by || null]);
  return r.rows[0];
}

/* ── follow-ups ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const SELECT_F = `SELECT f.followup_id, f.party_id, f.what, f.due_at, f.assignee_user_id, f.done_at, f.done_by, f.source, f.created_at,
       i.display_name AS party_name, a.display_name AS assignee_name
  FROM party_followup f
  LEFT JOIN identities i ON i.identity_id = f.party_id
  LEFT JOIN identities a ON a.identity_id = f.assignee_user_id`;
/** the party number and "still your party?" for a set of rows — two statements for the whole set, never one per row (each on the shop's own handle) */
async function withParty(h, owner, rows) {
  const ids = Array.from(new Set(rows.map((r) => r.party_id))).filter(Boolean);
  if (!ids.length) return rows;
  const c = await h.query(`SELECT cl.customer_identity_id AS pid, to_jsonb(cl)->>'party_no' AS party_no,
         (to_jsonb(cl)->>'hidden_at' IS NULL AND to_jsonb(cl)->>'merged_into' IS NULL) AS live
    FROM customer_list cl WHERE cl.owner_entity_id = $1 AND cl.customer_identity_id = ANY($2::uuid[])`, [owner, ids]);
  const s = await h.query(`SELECT sl.supplier_entity_id AS pid, to_jsonb(sl)->>'party_no' AS party_no,
         (to_jsonb(sl)->>'hidden_at' IS NULL AND to_jsonb(sl)->>'merged_into' IS NULL) AS live
    FROM supplier_list sl WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id = ANY($2::uuid[])`, [owner, ids]);
  const by = new Map();
  for (const x of c.rows.concat(s.rows)) { const k = String(x.pid), o = by.get(k) || { party_no: null, live: false }; by.set(k, { party_no: o.party_no || x.party_no || null, live: o.live || !!x.live }); }
  return rows.map((r) => { const o = by.get(String(r.party_id)) || {}; return Object.assign({}, r, { party_no: o.party_no || null, listed: !!o.live }); });
}
const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
/**
 * ⭐ THE ONE LATE RULE (M148/M149): a day is LATE when it is before the shop's today. Follow-ups (late · bucket · the Parties column · the banner count) and dues
 * (a party's oldest due) all ask this — the page paints what it is told and works nothing out. `today` is the shop's day (dayOf), never a browser's.
 * bucketOf(day, today) → 'late' | 'today' | 'week' (the next six days) | 'later'. Dates are YYYY-MM-DD, so string order is day order.
 */
const isLate = (day, today) => !!day && !!today && String(day).slice(0, 10) < String(today).slice(0, 10);
function bucketOf(day, today) {
  if (!day || !today) return 'later';
  const d = String(day).slice(0, 10), t = String(today).slice(0, 10);
  if (d < t) return 'late';
  if (d === t) return 'today';
  return d <= require('./books-engines').addDays(t, 6) ? 'week' : 'later';
}
/** the row as the screen reads it, with the server's `late` · `bucket` (the shop's day) and `due_day` */
function shape(r, country, today) {
  const day = dayOf(r.due_at, country);
  return { followup_id: r.followup_id, party_id: r.party_id, party_no: r.party_no || null, party_name: r.party_name || null, party_listed: r.listed !== false,
    what: r.what, due_at: iso(r.due_at), due_day: day, assignee_user_id: r.assignee_user_id || null, assignee_name: r.assignee_name || null,
    source: r.source, done_at: iso(r.done_at), created_at: iso(r.created_at), late: !r.done_at && isLate(day, today), today: !r.done_at && day === today, bucket: r.done_at ? 'later' : bucketOf(day, today) };
}
async function todayOf(h, owner) { const c = await countryOf(h, owner); return { country: c, today: dayOf(new Date().toISOString(), c) }; }

/** the WHERE of a follow-up list — scope (mine · all) · done (open · done) · one party — and its arguments, built once for the page and its re-count */
function listWhere(owner, query) {
  const args = [owner], where = ['f.owner_entity_id = $1'];
  where.push(query.done ? 'f.done_at IS NOT NULL' : 'f.done_at IS NULL');
  if (query.scope === 'mine' && query.me) { args.push(query.me); where.push('f.assignee_user_id = $' + args.length); }
  if (query.party_id) { args.push(query.party_id); where.push('f.party_id = $' + args.length); }
  return { where: where.join(' AND '), args };
}
/**
 * readRows(h, owner, q, today, pg) → { rows, total, late, today } — ONE statement: the page asked for (every row when none was asked,
 * page-limit's rule) with the WHOLE set's total · late · today as window counts on every row (routes/testing readPage's way), so the
 * badge and the banner count the set, not the page. Late and today are the shop's day bounds, the same cut shape() makes.
 */
async function readRows(handle, owner, query, today, pg) {
  const whereOf = listWhere(owner, query), bounds = H().dayBounds(today.today, today.country);
  const args = whereOf.args.concat([bounds.from, bounds.to]), start = '$' + (args.length - 1), end = '$' + args.length;
  const counts = `count(*) OVER ()::int AS ${pager.TOTAL_COLUMN},
       count(*) FILTER (WHERE f.done_at IS NULL AND f.due_at < ${start}) OVER ()::int AS late_rows,
       count(*) FILTER (WHERE f.done_at IS NULL AND f.due_at >= ${start} AND f.due_at < ${end}) OVER ()::int AS today_rows`;
  const sql = `${SELECT_F}, ${counts} WHERE ${whereOf.where} ORDER BY f.due_at ASC, f.created_at ASC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
  const rows = (await handle.query(sql, args.concat([pg.limit, pg.offset]))).rows;
  const again = async (limit, offset) => (await handle.query(sql, args.concat([limit, offset]))).rows;
  const total = await pager.totalOf(rows, pg, again);
  const first = rows[0] || {};
  return { rows, total, late: Number(first.late_rows) || 0, today: Number(first.today_rows) || 0 };
}
/** page(h, owner, { scope, done, me, party_id?, page? }) → the one envelope { followups, total, page, limit } + late · today (the whole set's) · shop_day */
async function page(handle, owner, opts) {
  await need(handle);
  const query = opts || {}, pg = query.page || pager.pageArgs(null, 0, 0), todayCtx = await todayOf(handle, owner);
  const read = await readRows(handle, owner, query, todayCtx, pg);
  const followups = (await withParty(handle, owner, read.rows)).map((x) => shape(x, todayCtx.country, todayCtx.today));
  return Object.assign(pager.pageOut('followups', followups, pg, read.total), { late: read.late, today: read.today, shop_day: todayCtx.today });
}
/** list(h, owner, { scope: 'mine'|'all', done: 0|1, me, party_id? }) → every row (the record's own follow-ups; the route pages through page()) */
async function list(h, owner, o) { return (await page(h, owner, o)).followups; }
async function one(h, owner, id) {
  const r = await h.query(`${SELECT_F} WHERE f.owner_entity_id = $1 AND f.followup_id = $2`, [owner, id]);
  if (!r.rows[0]) return null;
  const t = await todayOf(h, owner);
  return shape((await withParty(h, owner, r.rows))[0], t.country, t.today);
}
async function assigneeOk(h, owner, who) {
  const r = await h.query(`SELECT 1 FROM identities WHERE identity_id = $1 AND (identity_id = $2 OR parent_entity_id = $2) LIMIT 1`, [who, owner]);
  return r.rows.length > 0;
}
async function create(h, owner, b, by) {
  await need(h);
  const x = b || {};
  const what = txt(x.what, 300); if (!what) throw bad('What should you do? One line.');
  const source = x.source == null ? 'manual' : String(x.source);
  if (SOURCES.indexOf(source) < 0) throw bad('Source is manual, dues or interaction.');
  const country = await countryOf(h, owner);
  const due = dueOf(x.due_at, country);
  const assignee = x.assignee_user_id ? String(x.assignee_user_id) : (by || null);
  if (assignee && !(await assigneeOk(h, owner, assignee))) throw bad('That person is not on your team.', 400, 'BAD_ASSIGNEE');
  const r = await h.query(`INSERT INTO party_followup (owner_entity_id, party_id, what, due_at, assignee_user_id, source)
                           VALUES ($1,$2,$3,$4,$5,$6) RETURNING followup_id`, [owner, x.party_id, what, due, assignee, source]);
  return one(h, owner, r.rows[0].followup_id);
}
/** a patch that moves the day: a date (`due_at`) or a snooze WORD (`after`) */
const isSnooze = (body) => 'due_at' in body || 'after' in body;
/** the day a snooze lands on — a WORD is counted from the SHOP's today (W2-CRM), a date is taken as given, both in the shop's zone */
async function snoozeTo(handle, owner, body) { const todayCtx = await todayOf(handle, owner); return dueOf('after' in body ? afterDay(body.after, todayCtx.today) : body.due_at, todayCtx.country); }
/** patch(h, owner, id, body, { by, isOwner }) — done · due_at (a date) · after (a snooze WORD: the shop's day decides) · assignee_user_id (the owner's or the assignee's) · what */
async function patch(h, owner, id, b, who) {
  await need(h);
  const cur = await one(h, owner, id); if (!cur) throw bad('Not found', 404);
  const x = b || {}, sets = [], args = [owner, id];
  const set = (col, val) => { args.push(val); sets.push(col + ' = $' + args.length); };
  if ('what' in x) { const w = txt(x.what, 300); if (!w) throw bad('What should you do? One line.'); set('what', w); }
  if (isSnooze(x)) set('due_at', await snoozeTo(h, owner, x));
  if ('assignee_user_id' in x) {
    const w = x.assignee_user_id ? String(x.assignee_user_id) : null;
    if (!(who && (who.isOwner || (who.by && String(who.by) === String(cur.assignee_user_id))))) throw bad('Only the owner or the assignee can hand this on.', 403, 'NOT_ASSIGNEE');
    if (w && !(await assigneeOk(h, owner, w))) throw bad('That person is not on your team.', 400, 'BAD_ASSIGNEE');
    set('assignee_user_id', w);
  }
  if ('done' in x) {
    if (x.done) { if (!cur.done_at) { sets.push('done_at = now()'); set('done_by', (who && who.by) || null); } }
    else { sets.push('done_at = NULL'); sets.push('done_by = NULL'); }
  }
  if (!sets.length) throw bad('Nothing to change: what, due_at, after, assignee_user_id or done.');
  /* a snooze or a reopen puts it back on the bell: it is due on a new day */
  if (isSnooze(x) || ('done' in x && !x.done)) sets.push('bell_day = NULL');
  await h.query(`UPDATE party_followup SET ${sets.join(', ')} WHERE owner_entity_id = $1 AND followup_id = $2`, args);
  return one(h, owner, id);
}
async function remove(h, owner, id) {
  await need(h);
  const r = await h.query(`DELETE FROM party_followup WHERE owner_entity_id = $1 AND followup_id = $2 RETURNING followup_id`, [owner, id]);
  return r.rows.length > 0;
}

/* ── the nightly sweep → the bell ───────────────────────────────────────────────────────────────────────────────── */
/**
 * sweep(deps) → { shops, rang, skipped }. Which shops: ops.f_crm_followup_entities() (b276, SECURITY DEFINER — ids only, the one
 * cross-shop read, as books-nightly's f_books_enabled). Each shop is read AS that shop (withEntity). For every assignee with
 * follow-ups due today or late that have not rung today, ONE `followup` event goes to the shop's bell, and bell_day is set.
 * deps: { query, withEntity, emit, now } — the defaults are the real ones; the tests pass stand-ins.
 */
async function sweep(deps) {
  const d = deps || {};
  const query = d.query || dbm().query, withEntity = d.withEntity || dbm().withEntity;
  const emit = d.emit || ((ids, e) => require('./events').emit(ids, e));
  const now = d.now ? new Date(d.now) : new Date();
  const out = { shops: 0, rang: 0, skipped: 0 };
  let ids;
  try { ids = (await query('SELECT owner_entity_id FROM ops.f_crm_followup_entities()')).rows.map((r) => r.owner_entity_id); }
  catch (e) { if (isTableGone(e) || e.code === '42883' || e.code === '3F000') return Object.assign(out, { notMigrated: true }); throw e; }
  for (const owner of ids) {
    out.shops++;
    try {
      await withEntity(owner, async (h) => {
        const country = await countryOf(h, owner), today = dayOf(now.toISOString(), country);
        const end = H().dayBounds(today, country).to;
        /* open, due by the end of the shop's today, and not yet rung today */
        const r = await h.query(`SELECT assignee_user_id, due_at, followup_id FROM party_followup
                                  WHERE owner_entity_id = $1 AND done_at IS NULL AND due_at < $2 AND bell_day IS DISTINCT FROM $3::date`, [owner, end, today]);
        if (!r.rows.length) { out.skipped++; return; }
        const per = new Map();
        for (const x of r.rows) {
          const k = String(x.assignee_user_id || ''), e = per.get(k) || { today: 0, late: 0, ids: [] };
          if (isLate(dayOf(x.due_at, country), today)) e.late++; else e.today++;
          e.ids.push(x.followup_id); per.set(k, e);
        }
        /* marked first, rung after: a failed write must not leave a bell that rings again tomorrow for the same thing */
        await h.query(`UPDATE party_followup SET bell_day = $2::date WHERE owner_entity_id = $1 AND followup_id = ANY($3::uuid[])`,
          [owner, today, r.rows.map((x) => x.followup_id)]);
        for (const [who, e] of per) {
          emit([owner], { kind: 'followup', for: who || null, today: e.today, late: e.late });
          out.rang++;
        }
      });
    } catch (e) { out.skipped++; require('./logger').warn('crm.sweep', { entity_id: owner, error: String(e && e.message).slice(0, 200) }); }
  }
  return out;
}
let timer = null;
/** in-process, every 6 hours (first run 12 minutes after start); CRM_SWEEP=0 turns it off. Idempotent by bell_day. */
function start() {
  if (timer || process.env.CRM_SWEEP === '0' || process.env.NODE_ENV === 'test') return false;
  const kick = () => { sweep().catch(log.orElse('crm-followups kick: failed — carried on without it')); };
  setTimeout(kick, 12 * 60000).unref();
  timer = setInterval(kick, 6 * 3600000); timer.unref();
  return true;
}

/** noteMany(h, owner, [{ party_id, body }], by) → how many — addInteraction's 'note' for a SET in ONE statement (L3: what a CSV row carried beyond name and phone) */
async function noteMany(h, owner, notes, by) {
  const list = (notes || []).map((n) => ({ party_id: n && n.party_id, body: txt(n && n.body, 2000) })).filter((n) => n.party_id && n.body);
  if (!list.length) return 0;
  const r = await h.query(`INSERT INTO party_interaction (owner_entity_id, party_id, kind, direction, body, at, by_user_id)
                           SELECT $1, v.pid, 'note', NULL, v.body, now(), $4 FROM unnest($2::uuid[], $3::text[]) AS v(pid, body)`,
                          [owner, list.map((n) => String(n.party_id)), list.map((n) => n.body), by || null]);
  return (r && r.rowCount) || list.length;
}

module.exports = { todayOf, isLate, bucketOf, KINDS, SOURCES, AFTER, afterDay, migrated, forget, need, addInteraction, noteMany, list, page, one, create, patch, remove, sweep, start, shape, countryOf, dayOf, bad, notMigrated, isTableGone };
