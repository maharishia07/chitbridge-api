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
 * ⚠️ "LATE" IS THE SERVER'S WORD, in the SHOP's day (books-hooks dayOf, India +05:30) — a browser clock near midnight must not decide it.
 * ⭐ THE BELL: sweep() raises one `followup` event per shop per day for what is due today or late (kind · count · for whom — nothing
 *   sensitive rides it, lib/events); it marks bell_day so a second run the same day rings nothing.
 */
const KINDS = ['call', 'visit', 'message', 'note'];            // 'mail' is logged by the mail sender (phase 5), never typed in
const SOURCES = ['manual', 'dues', 'interaction'];
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
/** the shop's country (for its day) — the Ledger's setting if there is one, India otherwise */
async function countryOf(h, owner) {
  try { const s = await dbm().trySavepoint(h, () => require('./books-store').setting(h, owner), null); return (s && s.country) || 'IN'; }
  catch (_) { return 'IN'; }
}
const H = () => require('./books-hooks');
const dayOf = (ts, country) => H().dayOf(ts, country);
/** a typed due: a date (the presets write dates) → the start of that shop day; a full time stays as given */
function dueOf(v, country) {
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return H().dayBounds(s, country).from;
  const t = Date.parse(s); if (!isFinite(t)) throw bad('When is it due? Give a date.');
  return new Date(t).toISOString();
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
/** the row as the screen reads it, with the server's `late` (the shop's day) and `due_day` */
function shape(r, country, today) {
  const day = dayOf(r.due_at, country);
  return { followup_id: r.followup_id, party_id: r.party_id, party_no: r.party_no || null, party_name: r.party_name || null, party_listed: r.listed !== false,
    what: r.what, due_at: iso(r.due_at), due_day: day, assignee_user_id: r.assignee_user_id || null, assignee_name: r.assignee_name || null,
    source: r.source, done_at: iso(r.done_at), created_at: iso(r.created_at), late: !r.done_at && !!day && day < today, today: !r.done_at && day === today };
}
async function todayOf(h, owner) { const c = await countryOf(h, owner); return { country: c, today: dayOf(new Date().toISOString(), c) }; }

/** list(h, owner, { scope: 'mine'|'all', done: 0|1, me, party_id? }) → whole list (a shop's open follow-ups are few) */
async function list(h, owner, o) {
  await need(h);
  const q = o || {}, args = [owner], where = ['f.owner_entity_id = $1'];
  where.push(q.done ? 'f.done_at IS NOT NULL' : 'f.done_at IS NULL');
  if (q.scope === 'mine' && q.me) { args.push(q.me); where.push('f.assignee_user_id = $' + args.length); }
  if (q.party_id) { args.push(q.party_id); where.push('f.party_id = $' + args.length); }
  const r = await h.query(`${SELECT_F} WHERE ${where.join(' AND ')} ORDER BY f.due_at ASC, f.created_at ASC LIMIT 2000`, args);
  const t = await todayOf(h, owner);
  return (await withParty(h, owner, r.rows)).map((x) => shape(x, t.country, t.today));
}
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
/** patch(h, owner, id, body, { by, isOwner }) — done · due_at (snooze) · assignee_user_id (the owner's or the assignee's) · what */
async function patch(h, owner, id, b, who) {
  await need(h);
  const cur = await one(h, owner, id); if (!cur) throw bad('Not found', 404);
  const x = b || {}, sets = [], args = [owner, id];
  const set = (col, val) => { args.push(val); sets.push(col + ' = $' + args.length); };
  if ('what' in x) { const w = txt(x.what, 300); if (!w) throw bad('What should you do? One line.'); set('what', w); }
  if ('due_at' in x) set('due_at', dueOf(x.due_at, await countryOf(h, owner)));
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
  if (!sets.length) throw bad('Nothing to change: what, due_at, assignee_user_id or done.');
  /* a snooze or a reopen puts it back on the bell: it is due on a new day */
  if ('due_at' in x || ('done' in x && !x.done)) sets.push('bell_day = NULL');
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
          if (dayOf(x.due_at, country) < today) e.late++; else e.today++;
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
    } catch (e) { out.skipped++; try { require('./logger').warn('crm.sweep', { entity_id: owner, error: String(e && e.message).slice(0, 200) }); } catch (_) {} }
  }
  return out;
}
let timer = null;
/** in-process, every 6 hours (first run 12 minutes after start); CRM_SWEEP=0 turns it off. Idempotent by bell_day. */
function start() {
  if (timer || process.env.CRM_SWEEP === '0' || process.env.NODE_ENV === 'test') return false;
  const kick = () => { sweep().catch(() => {}); };
  setTimeout(kick, 12 * 60000).unref();
  timer = setInterval(kick, 6 * 3600000); timer.unref();
  return true;
}

module.exports = { KINDS, SOURCES, migrated, forget, need, addInteraction, list, one, create, patch, remove, sweep, start, shape, countryOf, dayOf, bad, notMigrated, isTableGone };
