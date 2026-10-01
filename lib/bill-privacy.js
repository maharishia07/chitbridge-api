'use strict';
// @stage tested
// @stage-note A BILL'S STEPS ARE WRITTEN AT THEIR FOLDER'S MESSAGING LEVEL — none · internal (my history) · external (both).
/**
 * lib/bill-privacy.js — WHAT ONE SHOP MAY SEE OF THE OTHER SHOP'S COPY OF A BILL, AND WHERE EACH STEP IS WRITTEN.
 *
 * Athi, 2026-10-01: *"goods verified and accounted are internal status, not between two shops — internal messaging; only
 * the dispute can be a both-side message"* — then: *"money received, part paid, it has to be both sides"* — then the rule:
 * a MESSAGING LEVEL per folder, `external` (my history AND the other party's) · `internal` (mine only) · `none` (nothing
 * written). lib/folder-inventory holds each folder's level as a CEILING; a shop may only restrict it.
 *
 * A bill (lib/folder-inventory docOf: bill_received · bill_issued — the SAME classification the Bills folders and the inbox
 * use) is a DOCUMENT both shops hold. What each shop then does with its copy is that shop's own:
 *   · WRITES — every step a shop takes on a bill (its status, its goods-in, a payment against it) is ONE state_log row,
 *     action 'bill_step', detail = the step as JSON { code, step, label, party, amount_minor, of_minor, due_minor, currency },
 *     written at the level of the folder that OWNS the step: none → nowhere · internal → my copy · external → every party
 *     (state_log_fanout, b158). Goods-in rows on a bill are recorded on my copy only (lib/deliverline record { private }).
 *   · READS — the other shop's per-copy facts already on record (status history fanned before this rule, deliveries
 *     replicated, the other copy's status through chit_participants) are hidden from a bill's read and the activity feed.
 *     What the other party's own folder marked external arrives as their 'bill_step' rows and is shown, in my words.
 *   · ALWAYS BOTH — the bill itself, its creation, the dispute (raised · resolved), a void. A message a person writes TO the
 *     other shop (message_sent) stays visible too — it was written to them; flagged for Athi.
 */
const INV = require('./folder-inventory');
const { withEntity } = require('../db');

const BILL_KINDS = INV.LEAVES.slice();                  /* bill_received · bill_issued */
/** the events both shops of a bill always see — the document's birth, the dispute, a void, a message written to them */
const SHARED_ACTIONS = ['created', 'dispute_raised', 'dispute_resolved', 'voided', 'message_sent'];
const STEP_ACTION = 'bill_step';

/** is this copy a bill (to `me`)? — copy { purpose, sender_entity_id, business_json } */
function isBill(copy, me) { return BILL_KINDS.indexOf(INV.docOf(copy, me)) >= 0; }
/** the folder that OWNS a bill copy's own steps (status, goods-in): B-2100 for a bill I received, B-1300 for one I issued */
function ownerCode(copy, me) {
  const d = INV.docOf(copy, me);
  const f = INV.INVENTORY.find((x) => x.when && x.when.doc === d);
  return f ? f.code : null;
}
/** the folder that owns a payment against a bill (R-1400) */
const MONEY_CODE = (INV.INVENTORY.find((f) => f.when && f.when.doc === 'receipt') || {}).code;

/** SQL: this copy is a bill (aliases: chit_header ch, chit_status cs) */
function billSql(ch, cs) { return `COALESCE((${INV.docSql(ch, cs)}), '') IN (${BILL_KINDS.map((k) => "'" + k + "'").join(', ')})`; }

/**
 * SQL: a state_log row (alias sl) on a bill that is the OTHER shop's internal step — not always-shared, not a step the
 * other party chose to make external (bill_step), and not done by me or my people. `me` is a SQL expression for my entity.
 */
function foreignStepSql(sl, me) {
  return `(${sl}.action NOT IN (${SHARED_ACTIONS.concat([STEP_ACTION]).map((a) => "'" + a + "'").join(', ')})
           AND ${sl}.action_by_identity_id IS DISTINCT FROM ${me}
           AND NOT EXISTS (SELECT 1 FROM identities bpi WHERE bpi.identity_id = ${sl}.action_by_identity_id AND bpi.parent_entity_id = ${me}))`;
}

/* ── money, as a line reads it ── */
function money(minor, cur) {
  if (minor == null || !Number.isFinite(Number(minor))) return '';
  const n = Number(minor) / 100, s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return (String(cur || 'INR').toUpperCase() === 'INR' ? '₹' : String(cur).toUpperCase() + ' ') + s;
}
/**
 * label(step, mine) — a written step, in the reader's words. Mine: "Paid ₹300 of ₹481.65". Theirs: "Chola Auto Care paid
 * ₹300 · ₹181.65 due". Any other step of theirs reads "<party>: <label>".
 */
function label(s, mine) {
  const x = s || {};
  if (x.code === MONEY_CODE && x.amount_minor != null) {
    const verb = x.step === 'received' ? 'Received' : 'Paid';
    if (mine) return verb + ' ' + money(x.amount_minor, x.currency) + (x.of_minor != null ? ' of ' + money(x.of_minor, x.currency) : '');
    return (x.party || 'They') + ' ' + verb.toLowerCase() + ' ' + money(x.amount_minor, x.currency)
      + (x.due_minor > 0 ? ' · ' + money(x.due_minor, x.currency) + ' due' : x.due_minor === 0 ? ' · paid in full' : '');
  }
  return mine ? (x.label || x.step || '') : ((x.party ? x.party + ': ' : '') + (x.label || x.step || ''));
}
function parseStep(detail) { try { const o = JSON.parse(detail); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } }

/**
 * ⭐⭐ writeStep(entity_id, chit_id, step, who) — write one step of MY copy of a bill at its folder's level.
 *   step { code, step, label, party?, amount_minor?, of_minor?, due_minor?, currency? } · who { id, name }
 * → { level, written: 'none' | 'mine' | 'all' }. ⚠️ Best-effort for the caller: it never undoes the step it describes.
 * Pre-b158 (no state_log_fanout) an external step is written to my copy only, and says so (written: 'mine', fell_back).
 */
async function writeStep(entity_id, chit_id, step, who, _flags) {
  const flags = _flags || await require('./policy').get(entity_id).catch(() => ({}));
  const level = INV.levels(flags)[step.code] || 'none';
  if (level === 'none') return { level, written: 'none' };
  const detail = JSON.stringify(step);
  const by = (who && who.id) || null, name = (who && who.name) || null;
  const mineOnly = () => withEntity(entity_id, (db) => db.query(
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [chit_id, entity_id, STEP_ACTION, by, name, detail]));
  if (level === 'internal') { await mineOnly(); return { level, written: 'mine' }; }
  try {
    await withEntity(entity_id, (db) => db.query('SELECT state_log_fanout($1::uuid,$2::text,$3::uuid,$4::text,$5::text) AS n',
      [chit_id, STEP_ACTION, by, name, detail]));
    return { level, written: 'all' };
  } catch (e) {
    if (!(e && e.code === '42883')) throw e;
    await mineOnly(); return { level, written: 'mine', fell_back: 'state_log_fanout (b158) is not on this database' };
  }
}

/**
 * redactRead({ header, me, state_log, participants, deliveryRows, mine }) — the chit read of a BILL, as its holder may see it.
 *   state_log     rows with action_by_identity_id; `mine(id)` says whether an identity is me or one of my people. A bill_step
 *                 row is kept (it was written to me at its owner's level) and gains `code` and `label` in MY words
 *   participants  chit_participants rows — the other copies keep who they are, never their status, read time or assignee
 *   deliveryRows  the one-shot delivery rows — the other shop's claims are dropped (their goods-in is theirs)
 * Not a bill → everything returned untouched.
 */
function redactRead(x) {
  const o = x || {}, me = String(o.me || '');
  if (!o.header || !isBill(o.header, me)) return { state_log: o.state_log, participants: o.participants, deliveryRows: o.deliveryRows, private: false };
  const mine = typeof o.mine === 'function' ? o.mine : (id) => String(id || '') === me;
  return {
    private: true,
    state_log: (o.state_log || [])
      .filter((r) => SHARED_ACTIONS.indexOf(r.action) >= 0 || r.action === STEP_ACTION || mine(r.action_by_identity_id))
      .map((r) => {
        if (r.action !== STEP_ACTION) return r;
        const s = parseStep(r.detail) || {}, m = mine(r.action_by_identity_id);
        return Object.assign({}, r, { code: s.code || null, step: s.step || null, mine: m, detail: [s.code, label(s, m)].filter(Boolean).join(' · ') });
      }),
    participants: (o.participants || []).map((p) => String(p.entity_id) === me ? p
      : { entity_id: p.entity_id, display_name: p.display_name, bridge_id: p.bridge_id }),
    deliveryRows: o.deliveryRows == null ? o.deliveryRows : o.deliveryRows.map((d) =>
      (d.delivery_id && String(d.recorded_by_entity_id) !== me)
        ? Object.assign({}, d, { delivery_id: null, dq: null, du: null, reference: null, note: null, recorded_by_entity_id: null,
                                 recorded_by_name: null, recorded_by_actor_id: null, recorded_by_actor_name: null, delivered_at: null,
                                 dkind: null, damount: null, dparticulars: null })
        : d),
  };
}

/** mineSet(entity_id, ids) → a test for "me or one of my people", read once for the identities a read names */
async function mineSet(entity_id, ids) {
  const me = String(entity_id), set = new Set([me]);
  const list = [...new Set((ids || []).filter(Boolean).map(String))].filter((i) => i !== me);
  if (list.length) {
    try {
      const r = await withEntity(me, (db) => db.query(`SELECT identity_id FROM identities WHERE identity_id = ANY($1::uuid[]) AND parent_entity_id = $2`, [list, me]));
      r.rows.forEach((x) => set.add(String(x.identity_id)));
    } catch (_) { /* unreadable → only me counts as mine: the other side's rows stay hidden, which is the safe way to fail */ }
  }
  return (id) => set.has(String(id || ''));
}

/**
 * ⭐ moneySteps(entity_id, payment, allocations, who) — a payment I confirmed against my bills, one R-1400 step per bill:
 * "Paid ₹300 of ₹481.65" in my words, "<my shop> paid ₹300 · ₹181.65 due" in the other party's (when R-1400 is external).
 * The amounts are MY ledger's: the allocation, the bill's own item, what is still open on it after this allocation.
 * Only allocations against a chit that is a bill to me; anything else (an opening balance, a plain document ref) is skipped.
 * Best-effort: the payment has already been posted; a step that cannot be written never undoes it.
 */
async function moneySteps(entity_id, payment, allocations, who) {
  const me = String(entity_id), out = [];
  const list = (allocations || []).filter((a) => a && /^[0-9a-f-]{36}$/i.test(String(a.against_ref || '')) && Number(a.amount_minor) > 0);
  if (!list.length) return out;
  const flags = await require('./policy').get(me).catch(() => ({}));
  const party = await withEntity(me, (db) => db.query('SELECT display_name FROM identities WHERE identity_id = $1', [me]))
    .then((r) => (r.rows[0] || {}).display_name || null).catch(() => null);
  for (const a of list) {
    try {
      const copy = await require('./tax-copy').copyOf(String(a.against_ref), me);
      if (!copy || !isBill(copy, me)) continue;
      const it = await withEntity(me, (db) => db.query(
        `SELECT SUM(amount_minor) AS open_minor, SUM(amount_minor) FILTER (WHERE ref_kind = 'bill' AND ref = against_ref) AS bill_minor
           FROM party_item WHERE entity_id = $1 AND against_ref = $2`, [me, String(a.against_ref)])).then((r) => r.rows[0] || {});
      const of = it.bill_minor == null ? null : Math.abs(Number(it.bill_minor));
      const due = it.open_minor == null ? null : Math.max(0, Math.abs(Number(it.open_minor)) * (Math.sign(Number(it.open_minor)) === Math.sign(Number(it.bill_minor || 0)) ? 1 : 0));
      out.push(await writeStep(me, String(a.against_ref), { code: MONEY_CODE, step: (payment && payment.direction === 'in') ? 'received' : 'paid',
        label: (payment && payment.direction === 'in') ? 'Money received' : 'Money paid', party,
        amount_minor: Math.round(Number(a.amount_minor)), of_minor: of, due_minor: due, currency: (payment && payment.currency) || 'INR' }, who, flags));
    } catch (e) { console.error('bill money step not written:', e.message); }
  }
  return out;
}

/** a status a shop moves its own bill copy to, as its step reads */
const STATUS_LABEL = { accepted: 'Bill accepted', in_progress: 'Bill accepted', completed: 'Completed', partial: 'Part accepted',
                       rejected: 'Bill refused', cancelled: 'Cancelled', pending: 'Reopened' };

module.exports = { BILL_KINDS, SHARED_ACTIONS, STEP_ACTION, MONEY_CODE, STATUS_LABEL, isBill, ownerCode, billSql, foreignStepSql,
  writeStep, moneySteps, redactRead, mineSet, label, parseStep, money };
