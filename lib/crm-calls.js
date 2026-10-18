// @stage tested
// @stage-note [CB CRM L2] The call desk: today's queue (ONE query) and the one-tap outcome (call logged + next follow-up + stage, ONE transaction). The outcome table lives HERE.
'use strict';
/**
 * lib/crm-calls.js — LEAD-ENGINE-PLAN §3. No new table: party_interaction + party_followup (b276) and memberships (b297) are the stores.
 *
 * ⭐ THE OUTCOME TABLE IS HERE AND ONLY HERE (OUTCOMES). The web asks GET /calls for it and paints the labels; it holds no days, no stages.
 * ⭐ NO SCORE: the queue is ranked by due date (mine first), never by a hidden score (LEAD-ENGINE-PLAN §4 guard).
 * ⭐ REUSE: interaction → F.addInteraction, next follow-up → F.create (source 'interaction'), stage → M.add (the one writer), late → F.isLate, the shop's day → F.dayOf.
 * ⚠️ BEFORE b276 → CRM_NOT_MIGRATED; an outcome that moves a stage BEFORE b297 → LEADS_NOT_MIGRATED with nothing written (checked first).
 * Trips: queue() = 1 statement for any number of leads (+ the shop's country, cached by books-store); outcome() = ONE transaction:
 *   party check · lead check · last calls · close open follow-ups · interaction · follow-up (country, team check, insert, read) · stage insert.
 *
 * owns: the OUTCOMES table (no table of its own — party_interaction · party_followup · memberships are the stores).
 * called by: routes/crm.js GET /calls (queue) · POST /parties/:id/outcome (outcome).
 * FLOW  GET /calls → F.todayOf() → queue() [ONE statement: the page + total · late · today window counts, page-limit] → callOf() → pageOut
 *       POST outcome → byKey() → nextDay(AFTER) → F.addInteraction() → F.create() → M.add()
 * // CARD 11-crm-and-marketing/crm-calls
 */
const F = require('./crm-followups');
const M = require('./memberships');
const bad = F.bad;

/** days = from the shop's today; presets = the "when?" WORDS an asking outcome offers (crm-followups AFTER holds their days; a body's `after` names one, or `due_at` gives a date); stage = the lead stage it moves to */
const OUTCOMES = [
  { key: 'no_answer', label: 'No answer', days: 1, stage: null, then: 'Ring again' },
  { key: 'call_back', label: 'Call back', days: null, stage: null, then: 'Ring back', ask: true, presets: ['today', 'tomorrow', '3days'] },
  { key: 'interested', label: 'Interested', days: 2, stage: null, then: 'Follow up' },
  { key: 'demo_booked', label: 'Demo booked', days: null, stage: 'demo', then: 'Demo', ask: true, presets: ['tomorrow', '3days'] },
  { key: 'not_now', label: 'Not now', days: 30, stage: 'parked', then: 'Ring again' },
  { key: 'wrong_number', label: 'Wrong number', days: null, stage: 'lost', then: null },
];
const NO_ANSWER_LONG = 3;            // the 3rd no-answer in a row: next try in 3 days, and the Parked move is suggested
const byKey = (k) => OUTCOMES.find((item) => item.key === k);
/** what the web reads: labels and the picks, never the days */
const publicTable = () => OUTCOMES.map((item) => ({ key: item.key, label: item.label, ask: !!item.ask, presets: item.presets || [], moves: item.stage || null }));

const addDays = require('./books-engines').addDays;   /* T2-NATDEF: the one day arithmetic */
const pager = require('./page-limit');                 /* the one pager (W2-CRM): the queue is a page with a total, never a silent cut at 300 */
const iso = (date) => (date == null ? null : (date instanceof Date ? date.toISOString() : String(date)));
const H = () => require('./books-hooks');

/** the queue's row as the web reads it: the shop's day decides late · today; a 'new' row (an untouched lead) has no due */
function callOf(x, todayCtx) {
  const day = x.due_at ? F.dayOf(x.due_at, todayCtx.country) : null;
  return { party_id: x.party_id, party_name: x.party_name || null, phone: x.phone || null, stage: x.stage || 'lead', followup_id: x.followup_id || null,
    what: x.what || null, due_day: day, assignee_user_id: x.assignee_user_id || null, new: x.src === 'new', last_outcome: x.last_outcome || null, last_at: iso(x.last_at),
    late: !!day && F.isLate(day, todayCtx.today), today: day === todayCtx.today };
}

/**
 * the queue: open follow-ups due today or late, mine first, then leads nobody has touched. ONE statement: the page asked for (`page`, a
 * page-limit pageArgs; none asked = every row) with the whole queue's total · late · today as window counts — the badge counts the queue, not the page.
 */
async function queue(h, owner, o) {
  await F.need(h);
  const q = o || {}, todayCtx = await F.todayOf(h, owner), pg = q.page || pager.pageArgs(null, 0, 0);
  const bounds = H().dayBounds(todayCtx.today, todayCtx.country), stages = await M.ready();
  const args = [owner, bounds.to, q.me || null, bounds.from];
  let mine = '';
  if (q.scope === 'mine' && q.me) mine = ' AND f.assignee_user_id = $3';
  const sql =
    `SELECT q.followup_id, q.party_id, q.what, q.due_at, q.assignee_user_id, q.src, i.display_name AS party_name, i.otp_contact AS phone,
            li.body AS last_outcome, li.at AS last_at${stages ? ', st.grp AS stage' : ''},
            count(*) OVER ()::int AS ${pager.TOTAL_COLUMN}, count(*) FILTER (WHERE q.due_at < $4) OVER ()::int AS late_rows, count(*) FILTER (WHERE q.due_at >= $4) OVER ()::int AS today_rows
       FROM (SELECT f.followup_id, f.party_id, f.what, f.due_at, f.assignee_user_id, 'followup' AS src
               FROM party_followup f WHERE f.owner_entity_id = $1 AND f.done_at IS NULL AND f.due_at < $2${mine}
             UNION ALL
             SELECT NULL::uuid, cl.customer_identity_id, NULL, NULL::timestamptz, NULL::uuid, 'new'
               FROM customer_list cl
              WHERE cl.owner_entity_id = $1 AND cl.added_via = 'lead' AND cl.txn_count = 0
                AND to_jsonb(cl)->>'hidden_at' IS NULL AND to_jsonb(cl)->>'merged_into' IS NULL
                AND NOT EXISTS (SELECT 1 FROM party_interaction x WHERE x.owner_entity_id = $1 AND x.party_id = cl.customer_identity_id)
                AND NOT EXISTS (SELECT 1 FROM party_followup y WHERE y.owner_entity_id = $1 AND y.party_id = cl.customer_identity_id AND y.done_at IS NULL)) q
       JOIN identities i ON i.identity_id = q.party_id
       LEFT JOIN LATERAL (SELECT p.body, p.at FROM party_interaction p WHERE p.owner_entity_id = $1 AND p.party_id = q.party_id AND p.kind = 'call'
                           ORDER BY p.at DESC LIMIT 1) li ON true
       ${stages ? `LEFT JOIN LATERAL (SELECT m.grp FROM memberships m WHERE m.entity_id = $1 AND m.kind = 'lead_stage' AND m.item_id = q.party_id
                           ORDER BY m.at DESC, m.membership_id DESC LIMIT 1) st ON true` : ''}
      ORDER BY (q.assignee_user_id IS NOT DISTINCT FROM $3::uuid) DESC, q.due_at ASC NULLS LAST, i.display_name ASC LIMIT $5 OFFSET $6`;
  const rows = (await h.query(sql, args.concat([pg.limit, pg.offset]))).rows;
  const again = async (limit, offset) => (await h.query(sql, args.concat([limit, offset]))).rows;
  const total = await pager.totalOf(rows, pg, again), first = rows[0] || {};
  const callable = await phoneVerdicts(h, owner, rows.map((x) => x.party_id));
  return queueAnswer(rows.map((x) => Object.assign(callOf(x, todayCtx), callable(x.party_id))), pg, total, first, stages, q, todayCtx);
}
/** R4: may the shop ring each party? ONE statement (the newest consent rows, as the Parties list reads them) → a function party_id → { may_call, call_why } (before b306 everyone may: service passes) */
async function phoneVerdicts(conn, owner, ids) {
  const privacy = require('./privacy');
  const read = ids.length ? await require('../db').trySavepoint(conn, () => conn.query(privacy.LATEST_SQL(false), [owner]), null) : null;   /* b306 not run → null → everyone may (service passes) */
  const prefs = read ? privacy.contactPrefs(read.rows) : null;
  return (id) => { const mayCall = privacy.contactPrefsOf(prefs, id).may.phone.service; return { may_call: !!mayCall.may, call_why: mayCall.may ? null : mayCall.why, call_code: mayCall.may ? null : mayCall.code }; };
}

/** the queue's envelope: the page (pageOut) + the whole set's late · today counts, the outcome table, may and the shop's day.
 *  may.ok / may.why = may a stage move be written (b297); may.write = may THIS login write at all (the rail's own answer, when the route hands it in) */
function queueAnswer(calls, pg, total, first, stages, asked, todayCtx) {
  const mayAnswer = Object.assign(stages ? { ok: true } : { ok: false, why: M.NOT_READY }, asked.write ? { write: asked.write } : {});
  return Object.assign(pager.pageOut('calls', calls, pg, total),
    { count: calls.length, late: Number(first.late_rows) || 0, today: Number(first.today_rows) || 0, outcomes: publicTable(), may: mayAnswer, shop_day: todayCtx.today });
}

/** when is the next call? → 'YYYY-MM-DD' in the shop's day, or null for none. Throws a shopkeeper sentence for a missing/foreign pick. */
function nextDay(o, b, today, repeats) {
  if (o.key === 'wrong_number') return null;
  if (o.ask) {
    if (b.due_at) { const d = String(b.due_at).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today) throw bad('Pick a day from today.', 400, 'BAD_DUE'); return d; }
    const pick = b.after == null || b.after === '' ? (o.key === 'call_back' ? 'tomorrow' : null) : String(b.after);
    if (pick == null) throw bad('When is the demo?', 400, 'NEED_DAY');
    if (!(o.presets && o.presets.indexOf(pick) >= 0)) throw bad('Pick today, tomorrow or 3 days.', 400, 'BAD_AFTER');
    return F.afterDay(pick, today);   /* the one AFTER table (crm-followups): the word's days live there */
  }
  if (o.key === 'no_answer' && repeats + 1 >= NO_ANSWER_LONG) return addDays(today, 3);
  return addDays(today, o.days);
}

/** how many no-answers in a row the party's last calls hold (a 3rd one lengthens the wait) */
async function noAnswerRun(conn, owner, party_id) {
  const recent = await conn.query(`SELECT body FROM party_interaction WHERE owner_entity_id = $1 AND party_id = $2 AND kind = 'call' ORDER BY at DESC LIMIT ${NO_ANSWER_LONG - 1}`, [owner, party_id]);
  let streak = 0;
  for (const call of recent.rows) { if (call.body === byKey('no_answer').label) streak++; else break; }
  return streak;
}

/** R4: the call desk asks the ONE consent gate before ringing, as POST /interactions does — a "do not call" is refused 403 with its code */
async function mustMayCall(conn, owner, party_id) {
  const privacy = require('./privacy'), verdict = await privacy.gate(conn, owner, { party_id }, 'phone', 'service');
  if (!verdict.may) throw privacy.refusal(verdict);
}

/** R5: the call answers ONE follow-up — the one its queue row came from; a colleague's other follow-up for the same party stays open (a new lead's row has none) */
async function closeAnswered(conn, owner, party_id, followup_id, by) {
  if (!followup_id) return;
  await conn.query(`UPDATE party_followup SET done_at = now(), done_by = $3 WHERE owner_entity_id = $1 AND party_id = $2 AND followup_id = $4 AND done_at IS NULL`, [owner, party_id, by || null, String(followup_id)]);
}

/**
 * outcome(h, owner, party_id, body, by) → { interaction, followup, stage, suggest } — ONE transaction (the caller's withEntity handle).
 * Body { outcome, followup_id?, after? | due_at? }. The follow-up the queue row came from is closed (the call answered it) and the next one is made; a lead's stage moves per the table.
 */
async function outcome(h, owner, party_id, body, by) {
  const b = body || {}, o = byKey(String(b.outcome || ''));
  if (!o) throw bad('Pick what happened on the call.', 400, 'BAD_OUTCOME');
  await F.need(h);
  if (o.stage) await M.need();
  const on = await require('./books-store').partyOn(h, owner, party_id);
  if (!on.customer && !on.supplier) throw bad('Not your party.', 404, 'NOT_FOUND');
  await mustMayCall(h, owner, party_id);
  const t = await F.todayOf(h, owner);
  /* the last calls: how many no-answers in a row (a 3rd one lengthens the wait) */
  const repeats = o.key === 'no_answer' ? await noAnswerRun(h, owner, party_id) : 0;
  const day = nextDay(o, b, t.today, repeats);
  /* a lead moves stage; someone who has traded is a customer — their call is logged, their stage is not touched */
  let leadOk = false;
  if (o.stage) {
    const c = await h.query(`SELECT txn_count FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND added_via = 'lead'`, [owner, party_id]);
    leadOk = !!c.rows.length && Number(c.rows[0].txn_count) === 0;
  }
  await closeAnswered(h, owner, party_id, b.followup_id, by);
  const interaction = await F.addInteraction(h, owner, party_id, { kind: 'call', direction: 'out', body: o.label }, by);
  const followup = day ? await F.create(h, owner, { party_id, what: o.then, due_at: day, source: 'interaction' }, by) : null;
  let stage = null;
  if (leadOk) { const m = await M.add(h, owner, { kind: 'lead_stage', item_id: party_id, group: o.stage, by }); stage = { stage: m.grp, since: iso(m.at) }; }
  return { interaction, followup, stage, suggest: o.key === 'no_answer' && repeats + 1 >= NO_ANSWER_LONG ? { stage: 'parked' } : null };
}

module.exports = { OUTCOMES, publicTable, queue, outcome, nextDay, addDays };
