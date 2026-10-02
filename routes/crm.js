// @stage built
// @stage-note [CB CRM] /api/crm — one party record (read: list, record, timeline), and the small writes: log an interaction,
// @stage-note follow-ups, remove a party from the list, walk-in → party. 503 "not migrated yet" for what needs b276.
'use strict';
/**
 * routes/crm.js — docs/design/crm/PLAN.md Phases 3 and 4 (API side). The page is the browser's; this file shapes answers.
 *
 *   GET    /api/crm/parties                     the whole list, ONE row per party (a party on both lists is one row, two roles)
 *   GET    /api/crm/parties/:id                 the record; the id of a merged party opens the survivor
 *   GET    /api/crm/parties/:id/timeline        chits · disputes · messages · ledger · interactions · follow-ups · changes, newest first, paged
 *   POST   /api/crm/parties/:id/interactions    log a call / visit / message / note                         (b276)
 *   GET    /api/crm/followups                   ?scope=mine|all&done=0|1                                    (b276)
 *   POST   /api/crm/followups · PATCH /followups/:id · DELETE /followups/:id                                (b276)
 *   DELETE /api/crm/parties/:id                 "Remove from my parties" — owner, no open dues, hides the row, deletes no history (b276)
 *   POST   /api/crm/walk-ins/add                a phone that holds points → a local customer; the points move to them
 *
 * ⭐ THIS FILE COMPUTES NO MONEY. Dues, totals and values are READ from what the Ledger and the chits stored (party-fields.decorate,
 *   summary_json, party_item) — "compute once, everyone reads". ⭐ Every read runs AS THE SHOP (withEntity): one shop never sees another's party.
 * ⚠️ NO API KEY REACHES THE CRM (a counter sends chits and calls nothing here) — the same fence as the ledger's.
 * ⚠️ BEFORE b276 the writers answer 503 { code: 'CRM_NOT_MIGRATED' }; the record and the timeline simply carry `migrated: false`.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity, query } = require('../db');
const { safeErr } = require('../lib/respond');
const { isOwner } = require('../lib/owner');
const crm = require('../lib/crm');
const F = require('../lib/crm-followups');

const ctx = (req) => auth.entityOf(req);
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
const UUID = crm.UUID;
function noKey(req, res, next) {
  if (req.api_key) return res.status(403).json({ code: 'SIGN_IN', error: 'Sign in to use CB CRM.', message: 'Sign in to use CB CRM.' });
  next();
}
/** a condition becomes a verdict with a code a screen maps to its own written line — the message is never shown as-is (design rule 1) */
function fail(res, e) {
  if (e && (e.code === 'CRM_NOT_MIGRATED' || F.isTableGone(e))) return res.status(503).json({ code: 'CRM_NOT_MIGRATED', error: 'Not migrated yet', message: 'CB CRM needs migration b276 — not run yet.' });
  if (e && e.status && e.status < 500) return res.status(e.status).json({ code: e.code || 'REFUSED', error: e.message, message: e.message });
  return res.status(500).json({ error: 'Failed', message: safeErr(e) });
}
const bad = F.bad;
const idOf = (req) => { const id = String(req.params.id || ''); if (!UUID.test(id)) throw bad('That is not a party id.', 400, 'BAD_ID'); return id; };

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
router.get('/parties', auth, noKey, async (req, res) => {
  try { res.json(await crm.list(ctx(req))); } catch (e) { fail(res, e); }
});

/** the record: the list row + the relationship line (the scorecard's own arithmetic) + points + open follow-ups */
router.get('/parties/:id', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), id = idOf(req);
    const found = await crm.one(owner, id);
    if (!found) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found', message: 'Not your party.' });
    const p = found.party;
    const rec = Object.assign({}, p, { merged_from: found.merged_from });
    /* the relationship: select.rows + measure.scorecard, exactly what /relationships/scorecard/:id answers — a local party has no chits */
    if (p.kind !== 'local') {
      const select = require('../lib/select'), measure = require('../lib/measure'), policy = require('../lib/policy');
      const flags = await policy.get(owner);
      const rows = await select.rows(owner, { counterparty_id: p.party_id, limit: 5000 });
      const card = measure.scorecard(rows, { overdue_days: flags.overdue_days });
      rec.relationship = { relationship: card.relationship, completion: card.completion };
    } else rec.relationship = null;
    /* points: a customer programme (reward-store, the same reader the customer's own pane uses) */
    rec.points = null;
    if (p.roles.customer) {
      try {
        const b = await require('../lib/reward-store').balance(owner, { scheme: 'identity', value: p.party_id }, withEntity);
        if (b.programme) rec.points = { programme: b.programme.name, points: b.points, worth: b.worth };
      } catch (e) { if (!(e && e.code === '42P01')) throw e; }
    }
    /* the follow-ups: soft — before b276 the record is complete without them and says so */
    rec.migrated = true; rec.followups = [];
    try { rec.followups = await withEntity(owner, async (h) => F.list(h, owner, { party_id: p.party_id })); }
    catch (e) { if (e && (e.code === 'CRM_NOT_MIGRATED' || F.isTableGone(e))) rec.migrated = false; else throw e; }
    res.json(rec);
  } catch (e) { fail(res, e); }
});

/**
 * the timeline: every source asked for `limit` rows older than `before`, merged newest-first, cut to `limit`.
 * { entries: [{ kind, at, … }], next_before, migrated }. kinds: chit · message · dispute · ledger · interaction · followup · followup_done · change.
 * Money on an entry is the stored figure (summary_json total_value; party_item amount_minor) — never recomputed.
 */
router.get('/parties/:id/timeline', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), id = idOf(req);
    const found = await crm.one(owner, id);
    if (!found) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found', message: 'Not your party.' });
    const party = found.party.party_id;
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 30));
    let before = Date.now() + 86400000;
    if (req.query.before) { const t = Date.parse(req.query.before); if (!isFinite(t)) throw bad('before is a time.', 400, 'BAD_BEFORE'); before = t; }
    const beforeIso = new Date(before).toISOString();
    const entries = [];
    let migrated = true;
    /* chits (+ the latest external message of each) and disputes — through select.rows, the scorecard's own selector */
    if (found.party.kind !== 'local') {
      const select = require('../lib/select');
      const cs = (await select.rows(owner, { counterparty_id: party, limit: 2000 })).filter((r) => new Date(r.created_at).getTime() < before).slice(0, limit);
      const ids = cs.map((r) => r.chit_id);
      for (const r of cs) entries.push({ kind: 'chit', at: crm.iso(r.created_at), chit_id: r.chit_id, direction: r.direction, status: r.current_status, purpose: r.purpose,
        doc_kind: r.doc_kind || null, bill_no: r.bill_no || null, title: r.manual_subject || r.auto_subject || null,
        value: crm.num(r.value), currency: r.currency || null, open_disputes: Number(r.open_disputes) || 0 });
      if (ids.length) {
        const extra = await withEntity(owner, async (h) => {
          const m = await h.query(`SELECT DISTINCT ON (chit_id) chit_id, message_text, sender_display_name, created_at FROM chit_messages
                                    WHERE chit_id = ANY($1::uuid[]) AND thread_type = 'external' AND created_at < $2 ORDER BY chit_id, created_at DESC`, [ids, beforeIso]);
          const d = await h.query(`SELECT dispute_id, chit_id, status, category, created_at, resolved_at FROM chit_disputes WHERE chit_id = ANY($1::uuid[])`, [ids]);
          return { m: m.rows, d: d.rows };
        });
        for (const x of extra.m) entries.push({ kind: 'message', at: crm.iso(x.created_at), chit_id: x.chit_id, who: x.sender_display_name, text: String(x.message_text || '').slice(0, 200) });
        for (const x of extra.d) { const at = Date.parse(x.created_at); if (at < before) entries.push({ kind: 'dispute', at: crm.iso(x.created_at), chit_id: x.chit_id, dispute_id: x.dispute_id, status: x.status, category: x.category }); }
      }
    }
    /* the rest is read in one transaction, each optional source in its own savepoint (missing tables are quiet) */
    await withEntity(owner, async (h) => {
      const soft = (fn) => require('../db').trySavepoint(h, fn, { rows: [] });
      const led = await soft(() => h.query(`SELECT item_id, ref, ref_kind, kind, amount_minor, currency, doc_date, created_at FROM party_item
                                             WHERE entity_id = $1 AND party_id = $2 AND ref_kind IN ('bill','advance','on_account','allocation') AND created_at < $3
                                             ORDER BY created_at DESC LIMIT $4`, [owner, party, beforeIso, limit]));
      for (const x of led.rows) entries.push({ kind: 'ledger', at: crm.iso(x.created_at), ref: x.ref, ledger_kind: x.ref_kind === 'bill' ? 'bill' : 'receipt', source: x.kind || null,
        amount_minor: Number(x.amount_minor), currency: x.currency, doc_date: x.doc_date ? String(x.doc_date).slice(0, 10) : null });
      if (isOwner(req)) {
        const ch = await soft(() => h.query(`SELECT at, "by", table_name, field, old, new FROM books_change_log
                                              WHERE entity_id = $1 AND table_name IN ('customer_list','supplier_list') AND row_id = $2 AND at < $3 ORDER BY at DESC LIMIT $4`, [owner, party, beforeIso, limit]));
        for (const x of ch.rows) entries.push({ kind: 'change', at: crm.iso(x.at), field: x.field, old: x.old, new: x.new, by: x.by });
      }
      migrated = await F.migrated(h);
      if (migrated) {
        const it = await h.query(`SELECT interaction_id, kind, direction, body, at, by_user_id FROM party_interaction WHERE owner_entity_id = $1 AND party_id = $2 AND at < $3 ORDER BY at DESC LIMIT $4`, [owner, party, beforeIso, limit]);
        for (const x of it.rows) entries.push({ kind: 'interaction', at: crm.iso(x.at), interaction_id: x.interaction_id, interaction_kind: x.kind, direction: x.direction, body: x.body, by: x.by_user_id });
        const fu = await h.query(`SELECT followup_id, what, due_at, created_at, done_at, assignee_user_id FROM party_followup WHERE owner_entity_id = $1 AND party_id = $2 ORDER BY created_at DESC LIMIT $3`, [owner, party, limit * 2]);
        for (const x of fu.rows) {
          if (new Date(x.created_at).getTime() < before) entries.push({ kind: 'followup', at: crm.iso(x.created_at), followup_id: x.followup_id, what: x.what, due_at: crm.iso(x.due_at) });
          if (x.done_at && new Date(x.done_at).getTime() < before) entries.push({ kind: 'followup_done', at: crm.iso(x.done_at), followup_id: x.followup_id, what: x.what });
        }
      }
    });
    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const page = entries.slice(0, limit);
    res.json({ party_id: party, entries: page, next_before: entries.length > limit ? page[page.length - 1].at : null, migrated });
  } catch (e) { fail(res, e); }
});

/* ── Phase 4: log, follow up, remove, walk-in ───────────────────────────────────────────────────────────────────── */
router.post('/parties/:id/interactions', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), id = idOf(req);
    const row = await withEntity(owner, async (h) => {
      await F.need(h);
      const on = await require('../lib/books-store').partyOn(h, owner, id);
      if (!on.customer && !on.supplier) throw bad('Not your party.', 404, 'NOT_FOUND');
      return F.addInteraction(h, owner, id, req.body, byOf(req));
    });
    res.status(201).json({ interaction: row });
  } catch (e) { fail(res, e); }
});

router.get('/followups', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req);
    const list = await withEntity(owner, (h) => F.list(h, owner, { scope: req.query.scope === 'mine' ? 'mine' : 'all', done: String(req.query.done) === '1', me: byOf(req) }));
    res.json({ followups: list, late: list.filter((x) => x.late).length, today: list.filter((x) => x.today).length });
  } catch (e) { fail(res, e); }
});
router.post('/followups', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), b = req.body || {};
    if (!UUID.test(String(b.party_id || ''))) throw bad('Which party is it about?', 400, 'BAD_ID');
    const f = await withEntity(owner, async (h) => {
      await F.need(h);
      const on = await require('../lib/books-store').partyOn(h, owner, b.party_id);
      if (!on.customer && !on.supplier) throw bad('Not your party.', 404, 'NOT_FOUND');
      return F.create(h, owner, b, byOf(req));
    });
    res.status(201).json({ followup: f });
  } catch (e) { fail(res, e); }
});
router.patch('/followups/:id', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), id = idOf(req);
    const f = await withEntity(owner, (h) => F.patch(h, owner, id, req.body, { by: byOf(req), isOwner: isOwner(req) }));
    res.json({ followup: f });
  } catch (e) { fail(res, e); }
});
router.delete('/followups/:id', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), id = idOf(req);
    const gone = await withEntity(owner, (h) => F.remove(h, owner, id));
    if (!gone) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found', message: 'No such follow-up.' });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

/**
 * "Remove from my parties" (Q10, provisional): the owner only, and only with no open dues (the Ledger's stored net must be 0, or
 * the Ledger off). It HIDES the party — hidden_at on its list rows — and deletes nothing: statements, chits, notes all stay.
 */
router.delete('/parties/:id', auth, noKey, async (req, res) => {
  try {
    if (!isOwner(req)) throw bad('Only the owner can remove a party.', 403, 'OWNER_ONLY');
    const owner = ctx(req), id = idOf(req);
    const found = await crm.one(owner, id);
    if (!found || found.merged_from) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found', message: 'Not your party.' });
    const d = found.party.dues;
    if (d && d.balance_minor !== 0) throw bad('There are open dues on this party.', 409, 'HAS_DUES');
    await withEntity(owner, async (h) => {
      await h.query(`UPDATE customer_list SET hidden_at = now() WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND hidden_at IS NULL`, [owner, id]);
      await h.query(`UPDATE supplier_list SET hidden_at = now() WHERE owner_entity_id = $1 AND supplier_entity_id = $2 AND hidden_at IS NULL`, [owner, id]);
    });
    res.json({ ok: true, party_id: id });
  } catch (e) { fail(res, e); }
});

/**
 * walk-in → party: a phone that holds points becomes a LOCAL customer (lib/local-identity.mint, kind 'cus' — the one mint) and the points
 * move to them by the engine's own claim (rewards.claim: two entries, never an update). Body { phone, name? }.
 */
router.post('/walk-ins/add', auth, noKey, async (req, res) => {
  try {
    const owner = ctx(req), b = req.body || {};
    const rewards = require('../lib/rewards'), RS = require('../lib/reward-store'), L = require('../lib/local-identity'), PF = require('../lib/party-fields');
    const from = rewards.holderOf({ phone: b.phone });
    if (!from || from.scheme !== 'phone') throw bad('Give the phone number they used.', 400, 'BAD_PHONE');
    const digits = from.value.replace(/[^0-9]/g, '');
    const name = String(b.name || '').replace(/\s+/g, ' ').trim() || ('Customer ' + digits.slice(-4));
    const local = await L.mint(owner, name, { query, kind: 'cus' });
    if (local.error) throw bad(local.error.message || 'Could not add them.', local.status || 400, 'MINT_REFUSED');
    if (local.created) await query(`UPDATE identities SET otp_contact = COALESCE($2, otp_contact) WHERE identity_id = $1 AND parent_entity_id = $3`, [local.identity_id, from.value, owner]);
    const ins = await withEntity(owner, (h) => h.query(
      `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
       VALUES ($1, $2, 'entity', 'manual', 0, NULL) ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_list_id`, [owner, local.identity_id]));
    if (!ins.rows.length) throw bad('That customer is already on your list.', 409, 'EXISTS');
    const party_no = await withEntity(owner, (h) => require('../db').trySavepoint(h, () => PF.ensureNo(h, owner, local.identity_id), null)).catch(() => null);
    /* the points: read through the ONE reader, claimed by the engine, appended by the ONE writer */
    let claimed = 0;
    const bal = await RS.balance(owner, from, withEntity);
    if (bal.programme && bal.points > 0) {
      const to = { scheme: 'identity', value: String(local.identity_id) };
      const c = rewards.claim(bal, from, to, 'claim:' + digits);
      if (c.ok) { for (const e of c.entries) await RS.append(owner, e.holder, e, bal.programme.definition_id, withEntity); claimed = c.points; }
    }
    res.status(201).json({ party: { party_id: local.identity_id, user_id: local.user_id, display_name: local.display_name, party_no, kind: 'local', on_chitbridge: false }, points_claimed: claimed });
  } catch (e) { fail(res, e); }
});

module.exports = router;
