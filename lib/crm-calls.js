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
 */
const F = require('./crm-followups');
const M = require('./memberships');
const bad = F.bad;

/** days = from the shop's today; presets = the picks for outcomes that ask "when?" (a body's `after` names one, or `due_at` gives a date); stage = the lead stage it moves to */
const OUTCOMES = [
  { key: 'no_answer', label: 'No answer', days: 1, stage: null, then: 'Ring again' },
  { key: 'call_back', label: 'Call back', days: null, stage: null, then: 'Ring back', ask: true, presets: { today: 0, tomorrow: 1, '3days': 3 } },
  { key: 'interested', label: 'Interested', days: 2, stage: null, then: 'Follow up' },
  { key: 'demo_booked', label: 'Demo booked', days: null, stage: 'demo', then: 'Demo', ask: true, presets: { tomorrow: 1, '3days': 3 } },
  { key: 'not_now', label: 'Not now', days: 30, stage: 'parked', then: 'Ring again' },
  { key: 'wrong_number', label: 'Wrong number', days: null, stage: 'lost', then: null },
];
const NO_ANSWER_LONG = 3;            // the 3rd no-answer in a row: next try in 3 days, and the Parked move is suggested
const byKey = (k) => OUTCOMES.find((o) => o.key === k);
/** what the web reads: labels and the picks, never the days */
const publicTable = () => OUTCOMES.map((o) => ({ key: o.key, label: o.label, ask: !!o.ask, presets: o.presets ? Object.keys(o.presets) : [], moves: o.stage || null }));

const addDays = (day, n) => new Date(Date.parse(String(day).slice(0, 10) + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const H = () => require('./books-hooks');

/** the queue: open follow-ups due today or late, mine first, then leads nobody has touched. ONE statement. */
async function queue(h, owner, o) {
  await F.need(h);
  const q = o || {}, t = await F.todayOf(h, owner);
  const end = H().dayBounds(t.today, t.country).to, stages = await M.ready();
  const args = [owner, end, q.me || null];
  let mine = '';
  if (q.scope === 'mine' && q.me) mine = ' AND f.assignee_user_id = $3';
  const r = await h.query(
    `SELECT q.followup_id, q.party_id, q.what, q.due_at, q.assignee_user_id, q.src, i.display_name AS party_name, i.otp_contact AS phone,
            li.body AS last_outcome, li.at AS last_at${stages ? ', st.grp AS stage' : ''}
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
      ORDER BY (q.assignee_user_id IS NOT DISTINCT FROM $3::uuid) DESC, q.due_at ASC NULLS LAST, i.display_name ASC LIMIT 300`, args);
  const calls = r.rows.map((x) => {
    const day = x.due_at ? F.dayOf(x.due_at, t.country) : null;
    return { party_id: x.party_id, party_name: x.party_name || null, phone: x.phone || null, stage: x.stage || 'lead', followup_id: x.followup_id || null,
      what: x.what || null, due_day: day, assignee_user_id: x.assignee_user_id || null, new: x.src === 'new', last_outcome: x.last_outcome || null, last_at: iso(x.last_at),
      late: !!day && F.isLate(day, t.today), today: day === t.today };
  });
  return { calls, count: calls.length, late: calls.filter((c) => c.late).length, today: calls.filter((c) => c.today).length, outcomes: publicTable(),
    may: stages ? { ok: true } : { ok: false, why: M.NOT_READY } };
}

/** when is the next call? → 'YYYY-MM-DD' in the shop's day, or null for none. Throws a shopkeeper sentence for a missing/foreign pick. */
function nextDay(o, b, today, repeats) {
  if (o.key === 'wrong_number') return null;
  if (o.ask) {
    if (b.due_at) { const d = String(b.due_at).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today) throw bad('Pick a day from today.', 400, 'BAD_DUE'); return d; }
    const pick = b.after == null || b.after === '' ? (o.key === 'call_back' ? 'tomorrow' : null) : String(b.after);
    if (pick == null) throw bad('When is the demo?', 400, 'NEED_DAY');
    if (!(o.presets && Object.prototype.hasOwnProperty.call(o.presets, pick))) throw bad('Pick today, tomorrow or 3 days.', 400, 'BAD_AFTER');
    return addDays(today, o.presets[pick]);
  }
  if (o.key === 'no_answer' && repeats + 1 >= NO_ANSWER_LONG) return addDays(today, 3);
  return addDays(today, o.days);
}

/**
 * outcome(h, owner, party_id, body, by) → { interaction, followup, stage, suggest } — ONE transaction (the caller's withEntity handle).
 * Body { outcome, after? | due_at? }. The party's open follow-ups are closed (the call answered them) and the next one is made; a lead's stage moves per the table.
 */
async function outcome(h, owner, party_id, body, by) {
  const b = body || {}, o = byKey(String(b.outcome || ''));
  if (!o) throw bad('Pick what happened on the call.', 400, 'BAD_OUTCOME');
  await F.need(h);
  if (o.stage) await M.need();
  const on = await require('./books-store').partyOn(h, owner, party_id);
  if (!on.customer && !on.supplier) throw bad('Not your party.', 404, 'NOT_FOUND');
  const t = await F.todayOf(h, owner);
  /* the last calls: how many no-answers in a row (a 3rd one lengthens the wait) */
  let repeats = 0;
  if (o.key === 'no_answer') {
    const l = await h.query(`SELECT body FROM party_interaction WHERE owner_entity_id = $1 AND party_id = $2 AND kind = 'call' ORDER BY at DESC LIMIT ${NO_ANSWER_LONG - 1}`, [owner, party_id]);
    for (const x of l.rows) { if (x.body === byKey('no_answer').label) repeats++; else break; }
  }
  const day = nextDay(o, b, t.today, repeats);
  /* a lead moves stage; someone who has traded is a customer — their call is logged, their stage is not touched */
  let leadOk = false;
  if (o.stage) {
    const c = await h.query(`SELECT txn_count FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND added_via = 'lead'`, [owner, party_id]);
    leadOk = !!c.rows.length && Number(c.rows[0].txn_count) === 0;
  }
  await h.query(`UPDATE party_followup SET done_at = now(), done_by = $3 WHERE owner_entity_id = $1 AND party_id = $2 AND done_at IS NULL`, [owner, party_id, by || null]);
  const interaction = await F.addInteraction(h, owner, party_id, { kind: 'call', direction: 'out', body: o.label }, by);
  const followup = day ? await F.create(h, owner, { party_id, what: o.then, due_at: day, source: 'interaction' }, by) : null;
  let stage = null;
  if (leadOk) { const m = await M.add(h, owner, { kind: 'lead_stage', item_id: party_id, group: o.stage, by }); stage = { stage: m.grp, since: iso(m.at) }; }
  return { interaction, followup, stage, suggest: o.key === 'no_answer' && repeats + 1 >= NO_ANSWER_LONG ? { stage: 'parked' } : null };
}

module.exports = { OUTCOMES, publicTable, queue, outcome, nextDay, addDays };
