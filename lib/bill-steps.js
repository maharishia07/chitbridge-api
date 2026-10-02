'use strict';
// @stage tested
// @stage-note WHERE A BILL IS IN ITS LIFE — one function over what MY copy and MY ledger hold, plus what the other party chose to
// @stage-note share. No status column; never the other shop's internal steps.
/**
 * lib/bill-steps.js — THE BILL LIFECYCLE, DERIVED (BACKLOG "BILLS TO ACCEPT", Athi 2026-10-01).
 *
 *   Received side (B-2100):  Received → Goods checked → Bill accepted (or Disputed) → Closed (goods in + accepted)
 *   Issued side   (B-1300):  Issued → (Disputed → Dispute settled) → Closed when MY ledger has it paid in full
 *                            (a walk-in bill — nobody else on it — is closed when issued)
 *   Either side   (R-1400):  money lines — SHOWN, never holding a bill open
 *
 * ⚠️⚠️ EACH SHOP'S STEPS ARE ITS OWN (Athi, 2026-10-01: "goods verified and accounted are internal status, not between two
 * shops … only the dispute can be a both-side message"). The seller NEVER reads the buyer's copy — its status, deliveries,
 * use choice or ledger — and the buyer never reads the seller's. "Accepted by customer" is gone. What crosses:
 *   · the dispute (chit_disputes — the one shared record): Disputed while open, Dispute settled once resolved;
 *   · the other party's steps their OWN folder made external (state_log 'bill_step' rows written by lib/bill-privacy at that
 *     folder's messaging level) — by default only R-1400: "R-1400 · Chola Auto Care paid ₹300 · ₹181.65 due".
 * My own history lines are my own bill_step rows (none of them when my folder's level is 'none'); my status, goods-in and
 * ledger still decide the STEP, because a step is a fact about my copy, not a message.
 *
 * ⭐ EVERY LINE NAMES WHICH ACCEPTANCE IT IS: the CODE of the folder that owns it, who (user id) and when —
 *   B-2100 · Goods checked · chola-ravi · 01 Oct 14:20   ·   R-1400 · Paid ₹300 of ₹481.65 · tallytest
 */
const INV = require('./folder-inventory');
const BP = require('./bill-privacy');
const { withEntity } = require('../db');

/* the owning folder of each step, from the inventory — never typed twice */
const codeWhere = (p) => (INV.INVENTORY.find(p) || {}).code || null;
const CODE = { received: codeWhere((f) => f.side === 'received'), issued: codeWhere((f) => f.side === 'issued'),
               money: codeWhere((f) => f.when && f.when.doc === 'receipt'), dispute: codeWhere((f) => f.kind === 'dispute') };
/* ⚠️ the same three statuses lib/books-hooks.js buyerGate reads as the buyer's acceptance (ACCEPTED / REFUSED there) */
const ACCEPTED = /^(accepted|in_progress|completed)$/, REFUSED = /^(rejected|cancelled)$/;
const ACCEPTED_ACT = /^status_(accepted|in_progress|completed)$/, REFUSED_ACT = /^status_(rejected|cancelled)$/;
const LABEL = {
  received: 'Received', goods_checked: 'Goods checked', accepted: 'Bill accepted', disputed: 'Disputed', closed: 'Closed',
  refused: 'Bill refused', issued: 'Issued', settled: 'Dispute settled',
};
const later = (a, b) => (!a ? b : !b ? a : (new Date(a.at || 0) >= new Date(b.at || 0) ? a : b));
const byAt = (a, b) => new Date(a.at || 0) - new Date(b.at || 0);

/**
 * ⭐⭐ lifecycle(f) — THE step function. Pure: same facts, same answer, no clock.
 *   f.side          'received' | 'issued'
 *   f.status        my copy's current_status
 *   f.created       { by, at }        the copy arrived / was issued
 *   f.disputes      [{ by, at }]      open disputes on the chit (the shared record)
 *   f.settled       [{ by, at }]      resolved disputes
 *   f.goods         { lines, complete, started, by, at } | null   (MY goods-in only)
 *   f.accepted      { by, at } | null my own acceptance · f.refused my own refusal
 *   f.posted        { by, at } | null the ledger entry for this chit, in MY ledger
 *   f.money         { settled: bool } | null   MY ledger: nothing left open on it (paid in full)
 *   f.waiting       issued side: someone other than me is on the bill (false = a walk-in)
 *   f.lines         [{ code, label, by, at, theirs }]  the written steps: mine (my bill_step rows) and theirs (shared)
 *   f.levels        { code: level } MY folders' messaging levels — a level of 'none' writes no line of mine
 * → { step, code, label, by, at, open, paid, history: [{ step, code, label, by, at, theirs? }] }
 */
function lifecycle(f) {
  const x = f || {}, side = x.side === 'issued' ? 'issued' : 'received';
  const code = CODE[side];
  const lv = x.levels || {};
  const speaks = (c) => (lv[c] || 'internal') !== 'none';            /* no levels given → as the defaults (internal) */
  const h = [];
  const add = (step, label, who, c) => { const e = { step, code: c || code, label, by: (who && who.by) || null, by_name: (who && who.by_name) || null, at: (who && who.at) || null }; if (speaks(e.code) || e.code === CODE.dispute) h.push(e); return e; };
  const disputed = (x.disputes || []).length > 0;
  const lastDispute = (x.disputes || []).reduce((a, d) => later(a, d), null);
  let step, closer = null, cur = null;

  if (side === 'received') {
    add('received', LABEL.received, x.created);
    const g = x.goods;
    const gE = (g && g.started > 0) ? add('goods_checked', LABEL.goods_checked, g) : null;
    const acc = x.accepted || (ACCEPTED.test(String(x.status || '')) ? (x.posted || x.created) : null) || x.posted;
    const accE = acc ? add('accepted', LABEL.accepted, acc) : null;
    (x.settled || []).forEach((d) => add('settled', LABEL.settled, d, CODE.dispute));
    if (disputed) add('disputed', LABEL.disputed, lastDispute, CODE.dispute);
    const refused = !acc && (x.refused || REFUSED.test(String(x.status || '')));
    /* goods are IN when every live line is complete — or the bill has no lines to count (an amount-only or service bill) */
    const goodsIn = !g || !g.lines || g.complete >= g.lines;
    if (disputed) { step = 'disputed'; cur = { code: CODE.dispute, label: LABEL.disputed, by: lastDispute && lastDispute.by, by_name: lastDispute && lastDispute.by_name, at: lastDispute && lastDispute.at }; }
    else if (refused) { step = 'closed'; closer = add('closed', LABEL.refused, x.refused || x.created); }
    else if (accE && goodsIn) { step = 'closed'; closer = add('closed', LABEL.closed, later(accE, gE)); }
    else if (accE) { step = 'accepted'; cur = accE; }
    else if (gE) { step = 'goods_checked'; cur = gE; }
    else { step = 'received'; cur = { code, label: LABEL.received, by: x.created && x.created.by, by_name: x.created && x.created.by_name, at: x.created && x.created.at }; }
  } else {
    const iE = add('issued', LABEL.issued, x.created);
    (x.settled || []).forEach((d) => add('settled', LABEL.settled, d, CODE.dispute));
    if (disputed) add('disputed', LABEL.disputed, lastDispute, CODE.dispute);
    const paidUp = !!(x.money && x.money.settled);
    if (disputed) { step = 'disputed'; cur = { code: CODE.dispute, label: LABEL.disputed, by: lastDispute && lastDispute.by, by_name: lastDispute && lastDispute.by_name, at: lastDispute && lastDispute.at }; }
    /* closed when MY ledger has it paid in full — or a walk-in bill, which nobody else holds and nobody owes */
    else if (paidUp || !x.waiting) { step = 'closed'; closer = add('closed', LABEL.closed, paidUp ? (x.money.at ? x.money : x.created) : x.created); }
    else { step = 'issued'; cur = iE; }
  }
  /* the written lines — mine (my own bill_step rows) and the other party's shared ones — in time order with the rest */
  (x.lines || []).forEach((l) => { if (l.theirs || speaks(l.code)) h.push({ step: l.step || 'line', code: l.code, label: l.label, by: l.by || null, by_name: l.by_name || null, at: l.at || null, theirs: !!l.theirs }); });
  h.sort(byAt);
  const c = closer || cur || h[0] || { code, label: LABEL[step] };
  return { step, code: c.code || code, label: closer ? closer.label : (c.label || LABEL[step] || step), by: c.by || null, by_name: c.by_name || null, at: c.at || null,
           open: step !== 'closed', paid: !!(x.money && x.money.settled), history: h };
}

/* ── the facts, read in one statement each, each in its own transaction (a table not yet migrated costs only its fact) ── */
const quiet = async (fn, fb) => { try { return await fn(); } catch (_) { return fb; } };
const who = (ids, id, name) => { const i = id && ids.get(String(id)); return (i && (i.user_id || i.display_name)) || name || null; };
/** ⭐ the person's NAME for the screen (Bills › "accepted by" showed a handle — 2026-10-02); `by` stays the stable id */
const whoName = (ids, id, name) => { const i = id && ids.get(String(id)); return (i && (i.display_name || i.user_id)) || name || null; };

/**
 * facts(entity_id, rows) → Map(chit_id → facts) for the bill rows of a folder (lib/select.js rows: chit_id,
 * current_status, created_at, all_recipients, doc_kind, sender_entity_display_name). ⚠️ Every read is MY copy, MY ledger,
 * MY state_log — and from the other party only the dispute and the bill_step rows its own folder made external.
 */
async function facts(entity_id, rows) {
  const me = String(entity_id);
  const bills = (rows || []).filter((r) => r.doc_kind === 'bill_received' || r.doc_kind === 'bill_issued');
  const out = new Map();
  if (!bills.length) return out;
  const ids = bills.map((r) => String(r.chit_id));
  const q = (sql, args) => withEntity(me, (db) => db.query(sql, args)).then((r) => r.rows);
  const flags = await quiet(() => require('./policy').get(me), {});
  const levels = INV.levels(flags);

  const goods = await quiet(() => require('./deliverline').progressMany(me, ids), null) || new Map();
  const log = await quiet(() => q(
    `SELECT sl.chit_id, sl.action, sl.action_by_identity_id AS who_id, sl.action_by_display_name AS who_name, sl.created_at AS at,
            sl.detail, i.parent_entity_id
       FROM state_log sl LEFT JOIN identities i ON i.identity_id = sl.action_by_identity_id
      WHERE sl.entity_id = $1 AND sl.chit_id = ANY($2::uuid[])
        AND sl.action IN ('created', 'bill_step', 'status_accepted', 'status_in_progress', 'status_completed', 'status_rejected', 'status_cancelled')
      ORDER BY sl.created_at`, [me, ids]), []);
  const disputes = await quiet(() => q(
    `SELECT chit_id, status, raised_by_entity_id AS who_id, raised_by_display_name AS who_name, created_at AS at, resolved_at
       FROM chit_disputes WHERE chit_id = ANY($1::uuid[]) AND status IN ('open', 'resolved')`, [ids]), []);
  const posted = await quiet(() => q(
    `SELECT source_chit_id AS chit_id, MIN(created_at) AS at, (array_agg(created_by ORDER BY created_at))[1] AS who_id
       FROM journal_entry WHERE entity_id = $1 AND source_chit_id = ANY($2::uuid[]) GROUP BY source_chit_id`, [me, ids]), []);
  /* a walk-in day entry covers its bills through source_chit_ids (b273) — read apart, so a database without it costs nothing */
  const covered = await quiet(() => q(
    `SELECT x.id AS chit_id, MIN(j.created_at) AS at, (array_agg(j.created_by ORDER BY j.created_at))[1] AS who_id
       FROM journal_entry j, unnest(j.source_chit_ids) x(id)
      WHERE j.entity_id = $1 AND j.source_chit_ids && $2::uuid[] AND x.id = ANY($2::uuid[]) GROUP BY x.id`, [me, ids]), []);
  /* MY ledger only: what is still open on each bill, and when it was last paid */
  const money = await quiet(() => q(
    `SELECT i.against_ref AS chit_id, SUM(i.amount_minor) AS open_minor,
            SUM(i.amount_minor) FILTER (WHERE i.ref_kind = 'bill' AND i.ref = i.against_ref) AS bill_minor,
            MAX(p.received_at) AS at
       FROM party_item i LEFT JOIN books_payment p ON p.entity_id = i.entity_id AND p.payment_id = i.payment_id
      WHERE i.entity_id = $1 AND i.against_ref = ANY($2::text[]) GROUP BY i.against_ref`, [me, ids]), []);

  /* every person named above, read once — the user id they sign in with, else their name */
  const idSet = new Set();
  log.forEach((r) => r.who_id && idSet.add(String(r.who_id)));
  disputes.forEach((r) => r.who_id && idSet.add(String(r.who_id)));
  posted.concat(covered).forEach((r) => r.who_id && idSet.add(String(r.who_id)));
  for (const m of goods.values()) if (m) for (const e of m.values()) (e.events || []).forEach((v) => v.by_id && idSet.add(String(v.by_id)));
  const people = new Map((await quiet(() => q(`SELECT identity_id, user_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])`, [[...idSet]]), []))
    .map((r) => [String(r.identity_id), r]));

  const byChit = (list) => { const m = new Map(); list.forEach((r) => { const k = String(r.chit_id); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
  const L = byChit(log), D = byChit(disputes), P = byChit(posted.concat(covered)), M = byChit(money);
  const isMine = (x) => x.who_id && (String(x.who_id) === me || String(x.parent_entity_id || '') === me);
  for (const r of bills) {
    const k = String(r.chit_id), side = r.doc_kind === 'bill_issued' ? 'issued' : 'received';
    const logs = L.get(k) || [];
    const pt = (x) => x ? { by: who(people, x.who_id, x.who_name), by_name: whoName(people, x.who_id, x.who_name), at: x.at } : null;
    /* ⚠️ MINE ONLY — a status row fanned here by the other shop before the privacy rule is never read as mine */
    const mineAct = (a) => logs.filter((x) => a.test(x.action) && isMine(x));
    const steps = logs.filter((x) => x.action === 'bill_step').map((x) => ({ x, s: BP.parseStep(x.detail) || {} }));
    const myStep = (pred) => (steps.find((t) => isMine(t.x) && pred(t.s)) || {}).x;
    const created = logs.find((x) => x.action === 'created');
    /* goods-in: MY claims (deliverline.delivered is mine), the latest of them naming who checked */
    const gm = goods.get(k);
    let g = null;
    if (gm) {
      const live = [...gm.values()].filter((e) => !e.removed);
      const ev = live.flatMap((e) => (e.events || []).filter((v) => v.mine)).sort((a, b) => new Date(a.at) - new Date(b.at)).pop();
      g = { lines: live.length, complete: live.filter((e) => e.complete).length, started: live.filter((e) => e.delivered > 0).length,
            by: ev ? who(people, ev.by_id, ev.by_actor || ev.by) : null, by_name: ev ? whoName(people, ev.by_id, ev.by_actor || ev.by) : null, at: ev ? ev.at : null };
    }
    const post = (P.get(k) || []).sort((a, b) => new Date(a.at) - new Date(b.at))[0];
    const mo = (M.get(k) || [])[0];
    let settled = null;
    if (mo && mo.bill_minor != null && Number(mo.bill_minor) !== 0) {
      if (Math.sign(Number(mo.bill_minor)) * Number(mo.open_minor) <= 0) settled = { settled: true, at: mo.at };
    } else if (post) settled = { settled: true, at: post.at };   /* posted with nothing left open: paid at the counter */
    const recips = Array.isArray(r.all_recipients) ? r.all_recipients : [];
    const ds = D.get(k) || [];
    out.set(k, {
      side, status: r.current_status, levels,
      created: created ? pt(created) : { by: side === 'received' ? (r.sender_entity_display_name || null) : null, at: r.created_at },
      disputes: ds.filter((d) => d.status === 'open').map(pt),
      settled: ds.filter((d) => d.status === 'resolved').map((d) => ({ by: who(people, d.who_id, d.who_name), by_name: whoName(people, d.who_id, d.who_name), at: d.resolved_at || d.at })),
      goods: g,
      accepted: pt(mineAct(ACCEPTED_ACT)[0] || myStep((s) => /^(accepted|in_progress|completed)$/.test(s.step))),
      refused: pt(mineAct(REFUSED_ACT)[0] || myStep((s) => /^(rejected|cancelled)$/.test(s.step))),
      posted: post ? { by: who(people, post.who_id), by_name: whoName(people, post.who_id), at: post.at } : null,
      money: settled,
      waiting: recips.some((p) => p && p.entity_id && String(p.entity_id) !== me),
      /* the written money lines: mine as I wrote them, theirs in my words — never a status line of theirs */
      lines: steps.filter((t) => t.s.code === CODE.money || !isMine(t.x))
        .map((t) => ({ step: t.s.step, code: t.s.code, label: BP.label(t.s, isMine(t.x)), by: who(people, t.x.who_id, t.x.who_name), by_name: whoName(people, t.x.who_id, t.x.who_name), at: t.x.at, theirs: !isMine(t.x) })),
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
