'use strict';
// @stage tested
// @stage-note WHERE A BILL IS IN ITS LIFE — one function over what the chit and the ledger already hold. No status column.
/**
 * lib/bill-steps.js — THE BILL LIFECYCLE, DERIVED (BACKLOG "BILLS TO ACCEPT", Athi 2026-10-01).
 *
 *   Received side (B-2100):  Received → Goods checked → Bill accepted (or Disputed) → Closed (goods in + accepted)
 *   Issued side   (B-1300):  Issued → Accepted by customer (or Disputed) → Closed
 *   Either side   (R-1400):  Money paid / Money received — SHOWN, never holding a bill open
 *
 * ⚠️⚠️ NEVER A SECOND STATUS. Every step is read from a record that already exists: the copy's status and its state_log
 * (who moved it), the per-line deliveries (lib/deliverline — the goods-in), the open disputes, the ledger entry for the
 * chit (journal_entry.source_chit_id, created_by) and the party items with their payments (Dues). Nothing is written.
 *
 * ⭐ EVERY LINE NAMES WHICH ACCEPTANCE IT IS (Athi, 2026-10-01): "Accepted" alone is ambiguous — goods accepted, bill
 * accepted (posted) and money received are three different acceptances. So each step carries the CODE of the folder that
 * owns it (lib/folder-inventory), plus who (their user id, already recorded) and when:
 *   B-2100 · Goods checked · chola-ravi · 01 Oct 14:20   ·   R-1400 · Money received · tallytest
 */
const INV = require('./folder-inventory');
const { withEntity } = require('../db');

/* the owning folder of each step, from the inventory — never typed twice */
const codeWhere = (p) => (INV.INVENTORY.find(p) || {}).code || null;
const CODE = { received: codeWhere((f) => f.side === 'received'), issued: codeWhere((f) => f.side === 'issued'),
               money: codeWhere((f) => f.when && f.when.doc === 'receipt') };
/* ⚠️ the same three statuses lib/books-hooks.js buyerGate reads as the buyer's acceptance (ACCEPTED / REFUSED there) */
const ACCEPTED = /^(accepted|in_progress|completed)$/, REFUSED = /^(rejected|cancelled)$/;
const ACCEPTED_ACT = /^status_(accepted|in_progress|completed)$/, REFUSED_ACT = /^status_(rejected|cancelled)$/;
const LABEL = {
  received: 'Received', goods_checked: 'Goods checked', accepted: 'Bill accepted', disputed: 'Disputed', closed: 'Closed',
  refused: 'Bill refused', issued: 'Issued', customer_accepted: 'Accepted by customer', customer_refused: 'Refused by customer',
  paid: 'Money paid', money_received: 'Money received',
};
const later = (a, b) => (!a ? b : !b ? a : (new Date(a.at || 0) >= new Date(b.at || 0) ? a : b));

/**
 * ⭐⭐ lifecycle(f) — THE step function. Pure: same facts, same answer, no clock.
 *   f.side          'received' | 'issued'
 *   f.status        my copy's current_status
 *   f.created       { by, at }        the copy arrived / was issued
 *   f.disputes      [{ by, at }]      open disputes on the chit
 *   f.goods         { lines, complete, started, by, at } | null   (deliverline over MY claims; null = not migrated / no lines)
 *   f.accepted      { by, at } | null my own acceptance (state_log status_accepted / in_progress / completed)
 *   f.refused       { by, at } | null my own refusal (status_rejected / cancelled)
 *   f.posted        { by, at } | null the ledger entry for this chit
 *   f.money         { settled: bool, by, at } | null   from the party items (Dues); settled = nothing left open on it
 *   f.customer      { waiting: bool, accepted: {by,at}|null, refused: {by,at}|null }  (issued side)
 * → { step, code, label, by, at, open, paid, history: [{ step, code, label, by, at }] }
 */
function lifecycle(f) {
  const x = f || {}, side = x.side === 'issued' ? 'issued' : 'received';
  const code = CODE[side];
  const h = [];
  const add = (step, label, who, c) => { h.push({ step, code: c || code, label, by: (who && who.by) || null, at: (who && who.at) || null }); return h[h.length - 1]; };
  const disputed = (x.disputes || []).length > 0;
  const lastDispute = (x.disputes || []).reduce((a, d) => later(a, d), null);
  let step, closer = null;

  if (side === 'received') {
    add('received', LABEL.received, x.created);
    const g = x.goods;
    if (g && g.started > 0) add('goods_checked', LABEL.goods_checked, g);
    const acc = x.accepted || (ACCEPTED.test(String(x.status || '')) ? (x.posted || x.created) : null) || x.posted;
    const accE = acc ? add('accepted', LABEL.accepted, acc) : null;
    if (disputed) add('disputed', LABEL.disputed, lastDispute);
    const refusedE = (!acc && (x.refused || REFUSED.test(String(x.status || '')))) ? add('closed', LABEL.refused, x.refused || x.created) : null;
    /* goods are IN when every live line is complete — or the bill has no lines to count (an amount-only or service bill) */
    const goodsIn = !g || !g.lines || g.complete >= g.lines;
    if (disputed) step = 'disputed';
    else if (refusedE) { step = 'closed'; closer = refusedE; }
    else if (accE && goodsIn) { step = 'closed'; closer = add('closed', LABEL.closed, later(accE, g && g.started ? g : null)); }
    else if (accE) step = 'accepted';
    else if (g && g.started > 0) step = 'goods_checked';
    else step = 'received';
  } else {
    add('issued', LABEL.issued, x.created);
    const c = x.customer || {};
    if (c.accepted) add('customer_accepted', LABEL.customer_accepted, c.accepted);
    if (c.refused) add('disputed', LABEL.customer_refused, c.refused);
    if (disputed) add('disputed', LABEL.disputed, lastDispute);
    if (disputed || c.refused) step = 'disputed';
    /* a walk-in bill, or one to a customer not on the rail, has nobody to accept it: it is done when it is issued */
    else if (!c.waiting || c.accepted) { step = 'closed'; closer = add('closed', LABEL.closed, c.accepted || x.created); }
    else step = 'issued';
  }
  /* ⭐ PAID IS SHOWN, NEVER HOLDING A BILL OPEN — and it is R-1400's acceptance, not the bill's */
  const paid = !!(x.money && x.money.settled);
  if (paid) add('paid', side === 'issued' ? LABEL.money_received : LABEL.paid, x.money, CODE.money);
  const cur = closer || [...h].reverse().find((e) => e.step === step) || h[0];
  const label = step === 'accepted' ? LABEL.accepted : step === 'closed' && closer ? closer.label : (LABEL[step] || step);
  return { step, code: cur.code, label, by: cur.by, at: cur.at, open: step !== 'closed', paid, history: h };
}

/* ── the facts, read in one statement each, each in its own transaction (a table not yet migrated costs only its fact) ── */
const quiet = async (fn, fb) => { try { return await fn(); } catch (_) { return fb; } };
const who = (ids, id, name) => { const i = id && ids.get(String(id)); return (i && (i.user_id || i.display_name)) || name || null; };

/**
 * facts(entity_id, rows) → Map(chit_id → facts) for the bill rows of a folder (lib/select.js rows: chit_id,
 * current_status, created_at, open_disputes, all_recipients, doc_kind, sender_entity_display_name).
 */
async function facts(entity_id, rows) {
  const me = String(entity_id);
  const bills = (rows || []).filter((r) => r.doc_kind === 'bill_received' || r.doc_kind === 'bill_issued');
  const out = new Map();
  if (!bills.length) return out;
  const ids = bills.map((r) => String(r.chit_id));
  const q = (sql, args) => withEntity(me, (db) => db.query(sql, args)).then((r) => r.rows);

  const goods = await quiet(() => require('./deliverline').progressMany(me, ids), null) || new Map();
  const log = await quiet(() => q(
    `SELECT sl.chit_id, sl.action, sl.action_by_identity_id AS who_id, sl.action_by_display_name AS who_name, sl.created_at AS at,
            i.parent_entity_id
       FROM state_log sl LEFT JOIN identities i ON i.identity_id = sl.action_by_identity_id
      WHERE sl.entity_id = $1 AND sl.chit_id = ANY($2::uuid[])
        AND sl.action IN ('created', 'status_accepted', 'status_in_progress', 'status_completed', 'status_rejected', 'status_cancelled')
      ORDER BY sl.created_at`, [me, ids]), []);
  const disputes = await quiet(() => q(
    `SELECT chit_id, raised_by_entity_id AS who_id, raised_by_display_name AS who_name, created_at AS at
       FROM chit_disputes WHERE chit_id = ANY($1::uuid[]) AND status = 'open'`, [ids]), []);
  const posted = await quiet(() => q(
    `SELECT source_chit_id AS chit_id, MIN(created_at) AS at, (array_agg(created_by ORDER BY created_at))[1] AS who_id
       FROM journal_entry WHERE entity_id = $1 AND source_chit_id = ANY($2::uuid[]) GROUP BY source_chit_id`, [me, ids]), []);
  /* a walk-in day entry covers its bills through source_chit_ids (b273) — read apart, so a database without it costs nothing */
  const covered = await quiet(() => q(
    `SELECT x.id AS chit_id, MIN(j.created_at) AS at, (array_agg(j.created_by ORDER BY j.created_at))[1] AS who_id
       FROM journal_entry j, unnest(j.source_chit_ids) x(id)
      WHERE j.entity_id = $1 AND j.source_chit_ids && $2::uuid[] AND x.id = ANY($2::uuid[]) GROUP BY x.id`, [me, ids]), []);
  const money = await quiet(() => q(
    `SELECT i.against_ref AS chit_id, SUM(i.amount_minor) AS open_minor,
            SUM(i.amount_minor) FILTER (WHERE i.ref_kind = 'bill' AND i.ref = i.against_ref) AS bill_minor,
            MAX(p.received_at) AS at, (array_agg(p.created_by ORDER BY p.received_at DESC) FILTER (WHERE p.payment_id IS NOT NULL))[1] AS who_id
       FROM party_item i LEFT JOIN books_payment p ON p.entity_id = i.entity_id AND p.payment_id = i.payment_id
      WHERE i.entity_id = $1 AND i.against_ref = ANY($2::text[]) GROUP BY i.against_ref`, [me, ids]), []);

  /* every person named above, read once — the user id they sign in with, else their name */
  const idSet = new Set();
  log.forEach((r) => r.who_id && idSet.add(String(r.who_id)));
  disputes.forEach((r) => r.who_id && idSet.add(String(r.who_id)));
  posted.concat(covered, money).forEach((r) => r.who_id && idSet.add(String(r.who_id)));
  for (const m of goods.values()) if (m) for (const e of m.values()) (e.events || []).forEach((v) => v.by_id && idSet.add(String(v.by_id)));
  const people = new Map((await quiet(() => q(`SELECT identity_id, user_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])`, [[...idSet]]), []))
    .map((r) => [String(r.identity_id), r]));

  const byChit = (list) => { const m = new Map(); list.forEach((r) => { const k = String(r.chit_id); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
  const L = byChit(log), D = byChit(disputes), P = byChit(posted.concat(covered)), M = byChit(money);
  for (const r of bills) {
    const k = String(r.chit_id), side = r.doc_kind === 'bill_issued' ? 'issued' : 'received';
    const logs = L.get(k) || [];
    const mine = (a) => logs.filter((x) => a.test(x.action) && x.who_id && (String(x.who_id) === me || String(x.parent_entity_id || '') === me));
    const theirs = (a) => logs.filter((x) => a.test(x.action) && x.who_id && String(x.who_id) !== me && String(x.parent_entity_id || '') !== me);
    const pt = (x) => x ? { by: who(people, x.who_id, x.who_name), at: x.at } : null;
    const created = logs.find((x) => x.action === 'created');
    /* goods-in: MY claims (deliverline.delivered is mine), the latest of them naming who checked */
    const gm = goods.get(k);
    let g = null;
    if (gm) {
      const live = [...gm.values()].filter((e) => !e.removed);
      const ev = live.flatMap((e) => (e.events || []).filter((v) => v.mine)).sort((a, b) => new Date(a.at) - new Date(b.at)).pop();
      g = { lines: live.length, complete: live.filter((e) => e.complete).length, started: live.filter((e) => e.delivered > 0).length,
            by: ev ? who(people, ev.by_id, ev.by_actor || ev.by) : null, at: ev ? ev.at : null };
    }
    const post = (P.get(k) || []).sort((a, b) => new Date(a.at) - new Date(b.at))[0];
    const mo = (M.get(k) || [])[0];
    let settled = null;
    if (mo && mo.bill_minor != null && Number(mo.bill_minor) !== 0) {
      if (Math.sign(Number(mo.bill_minor)) * Number(mo.open_minor) <= 0) settled = { settled: true, by: who(people, mo.who_id), at: mo.at };
    } else if (post) settled = { settled: true, by: who(people, post.who_id), at: post.at };   /* posted with nothing left open: paid at the counter */
    const recips = Array.isArray(r.all_recipients) ? r.all_recipients : [];
    out.set(k, {
      side, status: r.current_status,
      created: created ? pt(created) : { by: side === 'received' ? (r.sender_entity_display_name || null) : null, at: r.created_at },
      disputes: (D.get(k) || []).map(pt),
      goods: g,
      accepted: pt(mine(ACCEPTED_ACT)[0]), refused: pt(mine(REFUSED_ACT)[0]),
      posted: post ? { by: who(people, post.who_id), at: post.at } : null,
      money: settled,
      customer: side === 'issued' ? {
        waiting: recips.some((p) => p && p.entity_id && String(p.entity_id) !== me),
        accepted: pt(theirs(ACCEPTED_ACT)[0]), refused: pt(theirs(REFUSED_ACT)[0]) } : null,
    });
  }
  return out;
}

/** steps(entity_id, rows) → the same rows, each bill carrying its lifecycle (`bill`) — what a folder listing returns */
async function steps(entity_id, rows) {
  const F = await facts(entity_id, rows);
  return (rows || []).map((r) => { const f = F.get(String(r.chit_id)); return f ? Object.assign({}, r, { bill: lifecycle(f) }) : r; });
}

module.exports = { lifecycle, facts, steps, CODE, LABEL, ACCEPTED, REFUSED };
