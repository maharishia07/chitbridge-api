// @stage built
// @stage-note [CB CRM] /api/crm — one party record (read: list, record, timeline), and the small writes: log an interaction,
// @stage-note follow-ups, remove a party from the list, walk-in → party. 503 "not migrated yet" for what needs b276.
'use strict';
/**
 * OWNS      the 24 routes of /api/crm: the one party list (read, record, timeline), follow-ups, the call desk, leads and their import, the walk-in, consent rows, privacy requests,
 *           segments and named groups. Each route's contract and the words of its refusals are lib/crm-contract.js; the work is lib/crm*.js, lib/privacy.js, lib/memberships.js.
 * CALLED BY server.js (mounted at /api/crm), CB CRM (cap-crm*.js) and the storefront's privacy sheet · tools/api-register.cjs (router.openapi) · tests/api-problem-crm.test.cjs.
 * CARD      11-crm-and-marketing/crm-routes
 * routes/crm.js — docs/design/crm/PLAN.md Phases 3 and 4 (API side). The page is the browser's; this file shapes answers.
 *
 *   GET    /api/crm/parties                     the whole list, ONE row per party (a party on both lists is one row, two roles); total · page · limit
 *                                              (no ?limit = the whole list, CAP); ?with=consent → each party's contact_prefs { migrated, may } (MKT-SRV1 G1)
 *   GET    /api/crm/parties/:id                 the record; the id of a merged party opens the survivor
 *   GET    /api/crm/parties/:id/contact-prefs   history · may (per channel × purpose, with a code) · law (the shop's country's words — T3-P3-CONSENT)
 *   GET    /api/crm/parties/:id/timeline        chits · disputes · messages · ledger · interactions · follow-ups · changes, newest first, paged
 *   POST   /api/crm/parties/:id/interactions    log a call / visit / message / note (b276); an OUT call/message asks privacy.gate → 403 { code, why }
 *   GET    /api/crm/followups                   ?scope=mine|all&done=0|1&page=&limit= — total · page · limit (the one pager), late · today of the whole set, shop_day   (b276)
 *   POST   /api/crm/followups · PATCH /followups/:id ({ done } · { due_at: a date } · { after: today|tomorrow|3days|week } · { assignee_user_id } · { what }) · DELETE /followups/:id   (b276)
 *   ⭐ W2-CRM: GET /parties · /parties/:id · /followups answer `may { write, remove }`; GET /calls `may.write` — the server's may/why for every CRM action
 *   DELETE /api/crm/parties/:id                 "Remove from my parties" — owner, no open dues, hides the row, deletes no history (b276)
 *   GET    /api/crm/parties?view=leads          only the leads (no trade yet), each with its stage; `leads_migrated` false until b297
 *   POST   /api/crm/leads                       one lead = a local party (added_via 'lead') + its first stage                          (b297)
 *   POST   /api/crm/leads/import                ≤500 rows a browser parsed from a CSV → added · merged · skipped (why); `dry` previews  (b297)
 *   GET    /api/crm/calls                      ?scope=mine|all — today's call queue (ONE query) + the outcome buttons       (b276; stage b297)
 *   POST   /api/crm/parties/:id/outcome         one tap after a call: call logged + next follow-up + stage, ONE transaction (b276; b297 for a stage move)
 *   POST   /api/crm/parties/:id/stage           "Move to…" — a new memberships row (kind lead_stage); the old rows are the history      (b297)
 *   POST   /api/crm/walk-ins/add                a phone that holds points → a local customer; the points move to them
 *   POST   /api/crm/parties/:id/contact-prefs   one new row: yes · no · withdraw (append-only — the old rows are the proof)        (b306)
 *   GET    /api/crm/privacy-requests            CO1 K4/K11: the register of privacy requests and grievances, ?open=1              (b307)
 *   POST   /api/crm/privacy-requests            log one: who · kind · when it came in → the due date the law sets                 (b307)
 *   POST   /api/crm/privacy-requests/:id/answer the owner answers it, once (done · partly · refused + what was done)             (b307)
 *   GET    /api/crm/segments                    T3-P2-CRM: segments (the one SQL rule) + named groups, each with count · offers · who may be sent offers
 *   POST   /api/crm/groups                      { name, add[], remove[] } — a named group written on customer_list.groups (b205), one transaction
 *   DELETE /api/crm/groups/:name                the owner takes a group off every customer
 *   POST   /api/crm/segments/:key/send          { text, dry? } — a message to a segment or a group through the one gate; dry = the count, by code
 *
 * ANSWERS (API-STANDARD S1): every refusal is a Problem that keeps the keys it always had { code, error, message, why? } (docs/contracts/api-legacy.json); the words and the
 *   contract of each route are lib/crm-contract.js. FLOW  auth → noKey → schema check → handler (idOf: a party or follow-up id that is no uuid is 400 BAD_ID) → res.json | problem(req, res, crmFault(e, req) | keyFence() | notYourParty() | noSuchFollowup())
 *   a value no column can hold (a NUL byte in text) is crmFault's 400 'Cannot save this text', never a 500; a body id that is no uuid answers as an unknown one (lib/crm-followups, lib/crm-calls)
 *
 * ⭐ THIS FILE COMPUTES NO MONEY. Dues, totals and values are READ from what the Ledger and the chits stored (party-fields.decorate,
 *   summary_json, party_item) — "compute once, everyone reads". ⭐ Every read runs AS THE SHOP (withEntity): one shop never sees another's party.
 * ⚠️ NO API KEY REACHES THE CRM (a counter sends chits and calls nothing here) — the same fence as the ledger's.
 * ⚠️ BEFORE b276 the writers answer 503 { code: 'CRM_NOT_MIGRATED' }; the record and the timeline simply carry `migrated: false`.
 */
const express = require('express');
const logger = require('../lib/logger');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { contract, schemaOptions, crmFault, keyFence, notYourParty, noSuchFollowup } = require('../lib/crm-contract'); // the contract (each route's operation) and the words of a refusal
const { withEntity } = require('../db');
const { isOwner, may: ownerMay, managerGate } = require('../lib/owner');
const access = require('../lib/access');
const crm = require('../lib/crm');
const { chitEntry, ledgerEntry } = require('../lib/crm-timeline-rows'); // the timeline's chit and ledger entries
const F = require('../lib/crm-followups');
const { restoredAnswer } = require('../lib/party-live'); // CRM-247: the answer's keys when a deleted party was brought back
const M = require('../lib/memberships');
const PV = require('../lib/privacy');
const { textOf } = require('../lib/input-hygiene');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager */
const PAGE_DEFAULT = 300,
  PAGE_MAX = 1000; /* one page of this file's follow-ups and calls (300 = the queue's old silent cut, now a page with a total) */

const ctx = (req) => auth.entityOf(req);
const byOf = (req) => (req.identity && req.identity.identity_id) || null;
const UUID = crm.UUID;
const REMOVE_WHY = 'Only the owner can remove a party.';
const VIEW_ONLY_WHY = 'Your login can only view.';
const ANSWER_WHY = 'Only the owner answers a privacy request.';
const NOT_YOUR_PARTY = 'Not your party.';
const NOT_A_PARTY_ID = 'That is not a party id.';
/**
 * ⭐ W2-CRM (CRM-MAY): the SERVER says may/why for the CRM's actions, ONCE per read, in the two shapes that already exist — `write` is
 * lib/access.mayWrite (the owner or an editor; else the rail's read_only / comment_only sentence, the same answer hat-gate refuses with) and
 * `remove` is lib/owner.may (owner only, the sentence DELETE /parties/:id refuses with). A screen greys a button WITH `why`; it decides nothing from a hat.
 */
/* A2: `assign` = the server's verdict on the Assign button and the Unassigned bucket (the partner or a manager: lib/owner mayAt, the gate assign-bulk uses); the page reads no token */
/** Y-F-05: true when the books' own read gate (routes/books gates.mayReadMoney: owner, in-house accountant, live grant, auditor) refuses this seat — dues are books money; lazy so crm.js loads without books.js */
const noMoney = async (req) => !(await require('./books').gates.mayReadMoney(req));
const crmMay = (req) => ({ write: access.mayWrite(req), remove: ownerMay(req, REMOVE_WHY), assign: require('../lib/owner').mayAt(req, 'manager') });
function noKey(req, res, next) {
  if (req.api_key) return problem(req, res, { status: 403, ...keyFence() });
  next();
}
/** the schema check of one route (its own operation in lib/crm-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
}
const bad = F.bad;
const idOf = (req) => {
  const id = String(req.params.id || '');
  if (!UUID.test(id)) throw bad(NOT_A_PARTY_ID, 400, 'BAD_ID');
  return id;
};

/* ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
// @does Optional view, consent flag and page in -> we list the shop's customers, suppliers and leads with their balances and alerts -> a page of parties.
router.get('/parties', auth, noKey, ...checked('GET /parties'), async (req, res) => {
  try {
    const listed = await crm.list(ctx(req), {
      actor: byOf(req),
      blind: await require('../lib/cost').isCostBlind(req, ctx(req)), // RAIL-146e: ONE can_see_costs read; a blind reader's unbilled money is partial
      no_money: await noMoney(req), // Y-F-05: dues are books money — the seat GET /dues refuses gets the list without them
      view: req.query.view === 'leads' ? 'leads' : null,
      consent:
        textOf(req.query.with, { trim: false })
          .split(',')
          .indexOf('consent') >= 0,
      page: PL.pageOf(req.query.page),
      limit: PL.limitOf(req.query.limit, crm.CAP, crm.CAP)
    });
    /* S34: every key crm.list can carry is named (consent_migrated only with ?with=consent, leads_migrated only on the leads view: undefined, so JSON leaves it out), then may */
    // prettier-ignore
    res.json({ parties: listed.parties, walk_ins: listed.walk_ins, count: listed.count, total: listed.total, page: listed.page, limit: listed.limit, truncated: listed.truncated, alerts: listed.alerts, consent_migrated: listed.consent_migrated, leads_migrated: listed.leads_migrated, may: crmMay(req) });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/** the record: the list row + the relationship line (the scorecard's own arithmetic) + points + open follow-ups */
// @does A party id in -> we read that party's record with its relationship totals, points and open follow-ups -> the party record, or not-your-party.
router.get('/parties/:id', auth, noKey, ...checked('GET /parties/:id'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const blind = await require('../lib/cost').isCostBlind(req, owner); // RAIL-146i: ONE can_see_costs read; a blind reader sees no supplier-side balance or limit
    const found = await crm.one(owner, id, { stages: true, consent: true, blind, no_money: await noMoney(req) });
    if (!found) return problem(req, res, { status: 404, ...notYourParty() });
    const p = found.party;
    const rec = Object.assign({}, p, { merged_from: found.merged_from });
    let chitBills = 0, chitLast = null; /* LV-17: the party's bills counted by the server, never from a page of the timeline */
    /* the relationship: select.rows + measure.scorecard, exactly what /relationships/scorecard/:id answers — a local party has no chits */
    if (p.kind !== 'local') {
      const select = require('../lib/select'),
        measure = require('../lib/measure'),
        policy = require('../lib/policy');
      const flags = await policy.get(owner);
      const rows = await select.rows(owner, { counterparty_id: p.party_id, limit: 5000 });
      const card = measure.scorecard(rows, { overdue_days: flags.overdue_days });
      rec.relationship = { relationship: card.relationship, completion: card.completion };
      rows.forEach((row) => {
        if (row.doc_kind !== 'bill') return;
        chitBills++;
        const at = crm.iso(row.created_at);
        if (!chitLast || at > chitLast) chitLast = at;
      });
    } else rec.relationship = null;
    /* points: a customer programme (reward-store, the same reader the customer's own pane uses) */
    rec.points = null;
    if (p.roles.customer) {
      try {
        const b = await require('../lib/reward-store').balance(owner, { scheme: 'identity', value: p.party_id }, withEntity);
        if (b.programme) rec.points = { programme: b.programme.name, points: b.points, worth: b.worth };
      } catch (e) {
        if (!(e && e.code === '42P01')) throw e;
      }
    }
    /* the follow-ups: soft — before b276 the record is complete without them and says so */
    rec.migrated = true;
    rec.followups = [];
    let ledBills = 0, ledLast = null;
    try {
      rec.followups = await withEntity(owner, async (h) => {
        /* the ledger's bills for this party in the SAME transaction (one trip), a missing table read as none */
        const led = await require('../db').trySavepoint(
          h,
          () => h.query(`SELECT count(*)::int AS n, max(created_at) AS last FROM party_item WHERE entity_id = $1 AND party_id = $2 AND ref_kind = 'bill'`, [owner, p.party_id]),
          { rows: [] }
        );
        if (led.rows[0]) {
          ledBills = Number(led.rows[0].n) || 0;
          ledLast = led.rows[0].last ? crm.iso(led.rows[0].last) : null;
        }
        return F.list(h, owner, { party_id: p.party_id });
      });
    } catch (e) {
      if (e && (e.code === 'CRM_NOT_MIGRATED' || F.isTableGone(e))) rec.migrated = false;
      else throw e;
    }
    /* a lead's stage chip + "Move to…": the server says which moves, and may/why (b297 not run → greyed with its sentence) */
    if (rec.lead)
      rec.lead = Object.assign({}, rec.lead, {
        moves: M.KINDS.lead_stage.groups.filter((item) => item !== rec.lead.stage),
        may: found.leads_ready ? { ok: true } : { ok: false, why: M.NOT_READY }
      });
    /* the bills: the dearer of the chit bills and the ledger bills (the same rule the record always used on a page of the timeline), now over the WHOLE history */
    rec.bills = { n: Math.max(chitBills, ledBills), last_at: [chitLast, ledLast].filter(Boolean).sort().pop() || null };
    await crm.withUnbilled([rec], owner, byOf(req), blind); /* CRM-D7: the SAME figure the list row carries (the one sum, work-rows.sumUnbilled); absent when the shop is truncated, hidden whole for a blind reader */
    rec.may = crmMay(req); /* W2-CRM: the record's actions — write · remove — are the server's word, with the sentence */
    /* S34: the party's keys (lib/crm.js assemble, in its order: a supplier-only party has no customer or lead), then what this record adds */
    // prettier-ignore
    res.json({ party_id: rec.party_id, display_name: rec.display_name, user_id: rec.user_id, bridge_id: rec.bridge_id, email: rec.email, phone: rec.phone, gstn: rec.gstn, city: rec.city, status: rec.status, kind: rec.kind, on_chitbridge: rec.on_chitbridge, may_trade: rec.may_trade, roles: rec.roles, party_no: rec.party_no, last_activity: rec.last_activity, customer: rec.customer, lead: rec.lead, supplier: rec.supplier, legal_name: rec.legal_name, nickname: rec.nickname, state_code: rec.state_code, tax_ids: rec.tax_ids, terms: rec.terms, dues: rec.dues, gstin: rec.gstin, name: rec.name, contact_prefs: rec.contact_prefs, merged_from: rec.merged_from, relationship: rec.relationship, points: rec.points, unbilled: rec.unbilled, bills: rec.bills, migrated: rec.migrated, followups: rec.followups, may: rec.may });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/**
 * the timeline: every source asked for `limit` rows older than `before`, merged newest-first, cut to `limit`.
 * { entries: [{ kind, at, … }], next_before, migrated }. kinds: chit · message · dispute · ledger · interaction · followup · followup_done · change · stage.
 * stage (FX-L2C): a lead's move as memberships holds it — { stage, from, by, at }; from is null on the first row (the lead's start).
 * Money on an entry is the stored figure (summary_json total_value; party_item amount_minor) — never recomputed.
 */
const TIMELINE_PAGE = 30,
  TIMELINE_MAX = 100;
// @does A party id and an optional page cursor in -> we gather their chits, messages, disputes, notes and follow-ups into one history -> a newest-first timeline page.
router.get('/parties/:id/timeline', auth, noKey, ...checked('GET /parties/:id/timeline'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const found = await crm.one(owner, id);
    if (!found) return problem(req, res, { status: 404, ...notYourParty() });
    const party = found.party.party_id;
    const limit = PL.limitOf(req.query.limit, TIMELINE_PAGE, TIMELINE_MAX);
    let before = Date.now() + 86400000;
    if (req.query.before) {
      const t = Date.parse(req.query.before);
      if (!isFinite(t)) throw bad('before is a time.', 400, 'BAD_BEFORE');
      before = t;
    }
    const beforeIso = new Date(before).toISOString();
    const entries = [];
    let migrated = true;
    const costView = require('../lib/cost-view'),
      noMoneyReader = await noMoney(req), /* Y-F-05 */
      blind = await costView.blindOf(req, owner); /* RAIL-146h: ONE can_see_costs read (the owner pays none); a blind reader's cost-side money is null */
    let sides = null;
    /* chits (+ the latest external message of each) and disputes — through select.rows, the scorecard's own selector */
    if (found.party.kind !== 'local') {
      const select = require('../lib/select');
      const list = (await select.rows(owner, { counterparty_id: party, limit: 2000 }))
        .filter((item) => new Date(item.created_at).getTime() < before)
        .slice(0, limit);
      sides = await costView.sidesFor(req, owner, list);
      const ids = list.map((item) => item.chit_id);
      for (const r of list) entries.push(chitEntry(r, sides));
      if (ids.length) {
        const extra = await withEntity(owner, async (h) => {
          const m = await h.query(
            `SELECT DISTINCT ON (chit_id) chit_id, message_text, sender_display_name, created_at FROM chit_messages
                                    WHERE chit_id = ANY($1::uuid[]) AND thread_type = 'external' AND created_at < $2 ORDER BY chit_id, created_at DESC`,
            [ids, beforeIso]
          );
          const d = await h.query(`SELECT dispute_id, chit_id, status, category, created_at, resolved_at FROM chit_disputes WHERE chit_id = ANY($1::uuid[]) AND entity_id = $2`, [ids, owner]);
          return { m: m.rows, d: d.rows };
        });
        for (const x of extra.m)
          entries.push({
            kind: 'message',
            at: crm.iso(x.created_at),
            chit_id: x.chit_id,
            who: x.sender_display_name,
            text: String(x.message_text || '').slice(0, 200)
          });
        for (const x of extra.d) {
          const at = Date.parse(x.created_at);
          if (at < before)
            entries.push({ kind: 'dispute', at: crm.iso(x.created_at), chit_id: x.chit_id, dispute_id: x.dispute_id, status: x.status, category: x.category });
        }
      }
    }
    /* the rest is read in one transaction, each optional source in its own savepoint (missing tables are quiet) */
    await withEntity(owner, async (h) => {
      const soft = (fn) => require('../db').trySavepoint(h, fn, { rows: [] });
      const led = await soft(() =>
        h.query(
          `SELECT item_id, ref, ref_kind, kind, amount_minor, currency, doc_date, created_at FROM party_item
                                             WHERE entity_id = $1 AND party_id = $2 AND ref_kind IN ('bill','advance','on_account','allocation') AND created_at < $3
                                             ORDER BY created_at DESC LIMIT $4`,
          [owner, party, beforeIso, limit]
        )
      );
      for (const x of led.rows) entries.push(ledgerEntry(x, blind, found.party.roles, noMoneyReader));
      if (isOwner(req)) {
        const ch = await soft(() =>
          h.query(
            `SELECT at, "by", table_name, field, old, new FROM books_change_log
                                              WHERE entity_id = $1 AND table_name IN ('customer_list','supplier_list') AND row_id = $2 AND at < $3 ORDER BY at DESC LIMIT $4`,
            [owner, party, beforeIso, limit]
          )
        );
        for (const x of ch.rows) entries.push({ kind: 'change', at: crm.iso(x.at), field: x.field, old: x.old, new: x.new, by: x.by });
      }
      migrated = await F.migrated(h);
      if (migrated) {
        const it = await h.query(
          `SELECT interaction_id, kind, direction, body, at, by_user_id FROM party_interaction WHERE owner_entity_id = $1 AND party_id = $2 AND at < $3 ORDER BY at DESC LIMIT $4`,
          [owner, party, beforeIso, limit]
        );
        for (const x of it.rows)
          entries.push({
            kind: 'interaction',
            at: crm.iso(x.at),
            interaction_id: x.interaction_id,
            interaction_kind: x.kind,
            direction: x.direction,
            body: x.body,
            by: x.by_user_id
          });
        const fu = await h.query(
          `SELECT followup_id, what, due_at, created_at, done_at, assignee_user_id FROM party_followup WHERE owner_entity_id = $1 AND party_id = $2 ORDER BY created_at DESC LIMIT $3`,
          [owner, party, limit * 2]
        );
        for (const x of fu.rows) {
          if (new Date(x.created_at).getTime() < before)
            entries.push({ kind: 'followup', at: crm.iso(x.created_at), followup_id: x.followup_id, what: x.what, due_at: crm.iso(x.due_at) });
          if (x.done_at && new Date(x.done_at).getTime() < before)
            entries.push({ kind: 'followup_done', at: crm.iso(x.done_at), followup_id: x.followup_id, what: x.what });
        }
      }
      /* the stage trail (F7, FX-L2C): memberships IS the append-only history of every move (lib/memberships — the one writer), so the trail is a
         READ of it, never a second log: who · when · to, and "from" = the older row (one statement, LIMIT + 1 so the oldest row shown has its from).
         Before b297 the table is absent — its savepoint answers no rows (soft), exactly as the other optional sources. */
      const st = await soft(() =>
        h.query(
          `SELECT membership_id, grp, at, by_user_id FROM memberships WHERE entity_id = $1 AND item_type = 'party' AND item_id = $2 AND kind = 'lead_stage' AND at < $3
                                            ORDER BY at DESC, membership_id DESC LIMIT $4`,
          [owner, party, beforeIso, limit + 1]
        )
      );
      st.rows.slice(0, limit).forEach((x, index) =>
        entries.push({
          kind: 'stage',
          at: crm.iso(x.at),
          membership_id: x.membership_id,
          stage: x.grp,
          from: st.rows[index + 1] ? st.rows[index + 1].grp : null,
          by: x.by_user_id || null
        })
      );
    });
    entries.sort((first, second) => (first.at < second.at ? 1 : first.at > second.at ? -1 : 0));
    const page = entries.slice(0, limit);
    /* the one envelope beside the cursor: total = the rows this page could see (a cursor list has no whole count); page is always 1 of the cursor */
    res.json({
      party_id: party,
      entries: page,
      next_before: entries.length > limit ? page[page.length - 1].at : null,
      migrated,
      total: entries.length,
      page: 1,
      limit
    });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/**
 * contactOf(body) → { channel, purpose } for a contact the shop makes, else null (MKT-SRV1 G2). An out call is the phone; an out message is
 * body.channel, else whatsapp (the one message kind the log offers); purpose is body.purpose, else service. Unknown words → 400 in words.
 */
function contactOf(b) {
  const x = b || {},
    kind = String(x.kind || '').toLowerCase(),
    dir = String(x.direction || '').toLowerCase();
  if (dir !== 'out' || (kind !== 'call' && kind !== 'message')) return null;
  const channel = kind === 'call' ? 'phone' : String(x.channel || 'whatsapp').toLowerCase();
  const purpose = String(x.purpose || 'service').toLowerCase();
  if (PV.CHANNELS.indexOf(channel) < 0) throw bad('Channel is phone, sms, whatsapp, email or chitbridge.', 400, 'BAD_CHANNEL');
  if (PV.PURPOSES.indexOf(purpose) < 0) throw bad('Purpose is service or marketing.', 400, 'BAD_PURPOSE');
  return { channel, purpose };
}

/* ── Phase 4: log, follow up, remove, walk-in ───────────────────────────────────────────────────────────────────── */
// @does A party id and a call, message, visit or note in -> we check the contact rules for outbound contact and log it against that party -> the saved interaction.
router.post('/parties/:id/interactions', auth, noKey, ...checked('POST /parties/:id/interactions'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const row = await withEntity(owner, async (h) => {
      await F.need(h);
      const on = await require('../lib/books-store').partyOn(h, owner, id);
      if (!on.customer && !on.supplier) throw bad(NOT_YOUR_PARTY, 404, 'NOT_FOUND');
      const reach = contactOf(req.body); /* G2: a call or message the shop MAKES asks the one gate first; in-bound, visits and notes are facts */
      if (reach) {
        const v = await PV.gate(h, owner, { party_id: id }, reach.channel, reach.purpose);
        if (!v.may) throw PV.refusal(v);
      }
      return F.addInteraction(h, owner, id, req.body, byOf(req));
    });
    res.status(201).json({ interaction: row });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/** ?scope=mine|all|unassigned&done=0|1&page=&limit= → { followups, total, page, limit, late, today, shop_day, may } — one statement; none asked = every row */
// @does Optional scope, done flag and page in -> we read the shop's follow-ups with late and today counts -> a page of follow-ups and what the caller may do.
router.get('/followups', auth, noKey, ...checked('GET /followups'), async (req, res) => {
  try {
    const owner = ctx(req),
      page = PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX);
    const out = await withEntity(owner, (h) =>
      F.page(h, owner, { scope: ['mine', 'unassigned'].includes(req.query.scope) ? req.query.scope : 'all', done: String(req.query.done) === '1', me: byOf(req), page })
    );
    /* S34: the pager's keys (capped and cap_note only when the page was cut short), the counts, the shop's day, then may */
    // prettier-ignore
    res.json({ followups: out.followups, total: out.total, page: out.page, limit: out.limit, capped: out.capped, cap_note: out.cap_note, late: out.late, today: out.today, shop_day: out.shop_day, may: crmMay(req) });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
// @does A party and what to follow up in -> we check it is one of the shop's parties and save the follow-up -> the new follow-up.
router.post('/followups', auth, noKey, ...checked('POST /followups'), async (req, res) => {
  try {
    const owner = ctx(req),
      b = req.body || {};
    if (!UUID.test(String(b.party_id || ''))) throw bad('Which party is it about?', 400, 'BAD_ID');
    const f = await withEntity(owner, async (h) => {
      await F.need(h);
      const on = await require('../lib/books-store').partyOn(h, owner, b.party_id);
      if (!on.customer && !on.supplier) throw bad(NOT_YOUR_PARTY, 404, 'NOT_FOUND');
      return F.create(h, owner, b, byOf(req));
    });
    res.status(201).json({ followup: f });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
// @does A follow-up id and changes in -> we update the follow-up, refusing a done flag that is not true or false -> the saved follow-up.
router.patch('/followups/:id', auth, noKey, ...checked('PATCH /followups/:id'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    /* CRM-239: done is a JSON true or false. "false" (a non-empty string) is truthy and closed the follow-up; refuse it in words, nothing changes (checked here, not in lib/crm-followups) */
    if (req.body && 'done' in req.body && typeof req.body.done !== 'boolean') throw bad('Send done as true or false.', 400, 'BAD_FLAG');
    const patched = await withEntity(owner, (h) => F.patch(h, owner, id, req.body, { by: byOf(req), isOwner: isOwner(req) }));
    res.json({ followup: patched });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/* the Undo has a budget of its own per business (the global /api floor proves nothing per endpoint): an Undo is one deliberate press, 30 a minute is far above it */
const undoLimiter = require('../lib/rate-limit').namedLimiter({ name: 'crm-followups-undo', perMin: 30, env: 'CRM_UNDO_PER_MIN', by: 'business', message: 'Undo again in a minute.' });
/** Undo of a hand-over: body { previous: [{ followup_id, actor_id|null }] } (the list hand-over-all and the bulk answers returned; chit entries are ignored here, assign-bulk puts those back). Partner or manager, as the hand-over was. */
// @does A previous[] list from a hand-over in -> we put each follow-up back with who held it, through the one follow-up mover, naming any we could not -> how many moved and the named skips.
router.patch('/followups', auth, noKey, managerGate(), ...checked('PATCH /followups'), undoLimiter, async (req, res) => {
  try {
    const owner = ctx(req);
    const done = await withEntity(owner, (handle) => F.restoreFollowupsAudited(handle, owner, req.body.previous, byOf(req))); /* S40 audit row rides in the same transaction: see lib/crm-followups */
    res.json({ moved: done.moved, skipped: done.skipped });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
// @does A follow-up id in -> we remove that follow-up from the shop's list -> ok, or not-found.
router.delete('/followups/:id', auth, noKey, ...checked('DELETE /followups/:id'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const gone = await withEntity(owner, (h) => F.remove(h, owner, id, { by: byOf(req), isOwner: isOwner(req) }));
    if (!gone) return problem(req, res, { status: 404, ...noSuchFollowup() });
    res.json({ ok: true });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/**
 * "Remove from my parties" (Q10, provisional): the owner only, and only with no open dues (the Ledger's stored net must be 0, or
 * the Ledger off). It HIDES the party — hidden_at on its list rows — and deletes nothing: statements, chits, notes all stay.
 */
// @does A party id from the owner in -> we hide that party from the lists and delete nothing, so chits and notes stay -> ok with the party id; owner only.
router.delete('/parties/:id', auth, noKey, ...checked('DELETE /parties/:id'), async (req, res) => {
  try {
    if (!isOwner(req)) throw bad(REMOVE_WHY, 403, 'OWNER_ONLY'); /* the same sentence GET /parties may.remove.why carried */
    const owner = ctx(req),
      id = idOf(req);
    await crm.removeParty(owner, id);
    res.json({ ok: true, party_id: id });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/**
 * a lead: ONE local party (the one mint, kind 'cus') on the customer list as added_via 'lead', and its first stage — ONE transaction, no second contact list.
 * Body { name, phone?, stage? }. The stage is a memberships row (lib/memberships — the one writer); b297 not run → 503 LEADS_NOT_MIGRATED, nothing created.
 */
// @does A lead's name, phone and optional stage in -> we add them as a local customer marked as a lead at that stage -> the new lead, or a refusal if they exist.
router.post('/leads', auth, noKey, ...checked('POST /leads'), async (req, res) => {
  try {
    const owner = ctx(req),
      b = req.body || {};
    const name = String(b.name || '')
      .replace(/\s+/g, ' ')
      .trim(); /* \s — the letter s was being replaced ("Esai" → "E ai"), found by the FX-L2C real walk */
    if (!name) throw bad('Give the lead a name.', 400, 'BAD_NAME');
    const L = require('../lib/local-identity');
    const ph = L.phoneOf(b.phone); /* the one phone check (CRM-MINT1) */
    if (ph.bad) throw bad('That phone number does not look right.', 400, 'BAD_PHONE');
    const phone = ph.phone;
    const stage = b.stage == null || b.stage === '' ? 'lead' : String(b.stage);
    if (M.LEAD_GROUPS.indexOf(stage) < 0) throw bad('That is not one of the stages.', 400, 'BAD_GROUP');
    await M.need();
    const out = await withEntity(owner, async (h) => {
      const a = await L.addCustomer(h, owner, { name, phone, via: 'lead' }); /* ⭐ CRM-MINT1: the one add-customer */
      if (a.refused) throw bad((a.refused.error && a.refused.error.message) || 'Could not add them.', a.refused.status || 400, 'MINT_REFUSED');
      if (a.exists) throw bad(L.existsWords(a, 'That name is already on your list.'), 409, 'EXISTS');
      const local = a.local,
        party_no = a.party_no;
      const m = await M.add(h, owner, { kind: 'lead_stage', item_id: local.identity_id, group: stage, by: byOf(req) });
      return { local, party_no, since: crm.iso(m.at), restored: !!a.restored };
    });
    /* S34: the new lead's keys named here, in the order they always went */
    res.status(201).json({
      party: { party_id: out.local.identity_id, display_name: out.local.display_name, party_no: out.party_no, kind: 'local', on_chitbridge: false, lead: { stage, since: out.since } },
      ...restoredAnswer(out.restored, out.local.display_name)
    });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/* ── L2: the call desk — the table of outcomes is lib/crm-calls (server); the web only labels it ─────────────────── */
// @does Optional scope and page in -> we build the call desk queue of who to ring and what outcomes can be logged -> a page of calls with late and today counts.
router.get('/calls', auth, noKey, ...checked('GET /calls'), async (req, res) => {
  try {
    const owner = ctx(req),
      page = PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX);
    const queue = await withEntity(owner, (h) =>
      require('../lib/crm-calls').queue(h, owner, { scope: req.query.scope === 'mine' ? 'mine' : 'all', me: byOf(req), page, write: crmMay(req).write })
    );
    /* S34: the pager's keys (capped and cap_note only when the page was cut short), then the call desk's own (lib/crm-calls queueAnswer) */
    // prettier-ignore
    res.json({ calls: queue.calls, total: queue.total, page: queue.page, limit: queue.limit, capped: queue.capped, cap_note: queue.cap_note, count: queue.count, late: queue.late, today: queue.today, outcomes: queue.outcomes, may: queue.may, shop_day: queue.shop_day });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/** Body { outcome, after?: today|tomorrow|3days, due_at?: YYYY-MM-DD }. 201 { interaction, followup, stage, suggest } */
// @does A party id and a call outcome in -> we log the call and set the next follow-up and stage it suggests -> the interaction, follow-up, stage and suggestion.
router.post('/parties/:id/outcome', auth, noKey, ...checked('POST /parties/:id/outcome'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const done = await withEntity(owner, (h) => require('../lib/crm-calls').outcome(h, owner, id, req.body, byOf(req)));
    /* S34: every key lib/crm-calls outcome answers (the rows under them are the library's, open and listed) */
    res.status(201).json({ interaction: done.interaction, followup: done.followup, stage: done.stage, suggest: done.suggest });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/**
 * L3: the call-desk's first list — leads from a CSV the BROWSER parsed (no file reaches the server). Body { rows: [{ name, phone?, email?, business?,
 * city?, source?, note? }], dry? }. ≤500 rows (more → 400 TOO_MANY in words); the phone through the one helper; deduped within the file and against the
 * shop's parties; ONE transaction of set-based statements (lib/crm-leads.js). `dry: true` plans and writes nothing — the preview paints that answer.
 * Who may: the owner, or a login whose access level is editor (lib/access.canEdit — the server decides; a viewer or commenter gets 403 in words).
 * Before b297: 503 LEADS_NOT_MIGRATED, nothing created.
 */
// @does Rows of leads from an editor, optionally a dry run -> we add new leads, merge ones we know and skip bad rows -> the counts and a per-row result; nothing saved on a dry run.
router.post('/leads/import', auth, noKey, ...checked('POST /leads/import'), async (req, res) => {
  try {
    if (!require('../lib/access').canEdit(req.identity)) throw bad('Only an editor can import leads.', 403, 'VIEW_ONLY');
    const b = req.body || {};
    const out = await require('../lib/crm-leads').importLeads(ctx(req), b.rows, { by: byOf(req), dry: !!b.dry });
    res.status(out.dry ? 200 : 201); /* a preview answers 200, a real import 201 (API-4c (2) asks which the contract should say) */
    res.json({ dry: out.dry, added: out.added, merged: out.merged, skipped: out.skipped, rows: out.rows }); /* S34: every key lib/crm-leads shape answers */
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/** "Move to…": the stage a lead is in now. Body { stage }. A new row — never an update; refused for a party that has traded (they are a customer). */
// @does A lead's id and a stage in -> we record the new stage as a fresh entry, refusing anyone who has already traded -> ok with the lead's stage and date.
router.post('/parties/:id/stage', auth, noKey, ...checked('POST /parties/:id/stage'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req),
      stage = String((req.body || {}).stage || '');
    if (M.KINDS.lead_stage.groups.indexOf(stage) < 0) throw bad('That is not one of the stages.', 400, 'BAD_GROUP');
    await M.need();
    const row = await withEntity(owner, async (h) => {
      const c = await h.query(`SELECT txn_count FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND added_via = 'lead'`, [
        owner,
        id
      ]);
      if (!c.rows.length) throw bad('Not one of your leads.', 404, 'NOT_FOUND');
      if (Number(c.rows[0].txn_count) > 0) throw bad('They are a customer now.', 409, 'IS_CUSTOMER');
      return M.add(h, owner, { kind: 'lead_stage', item_id: id, group: stage, by: byOf(req) });
    });
    res.json({ ok: true, party_id: id, lead: { stage: row.grp, since: crm.iso(row.at) } });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/**
 * walk-in → party: a phone that holds points becomes a LOCAL customer (lib/local-identity.mint, kind 'cus' — the one mint) and the points
 * move to them by the engine's own claim (rewards.claim: two entries, never an update). Body { phone, name? }.
 */
// @does A walk-in's phone and optional name in -> we add them as a customer and move the points held on that phone to them in one go -> the new party and the points claimed.
router.post('/walk-ins/add', auth, noKey, ...checked('POST /walk-ins/add'), async (req, res) => {
  try {
    const owner = ctx(req),
      b = req.body || {};
    const rewards = require('../lib/rewards'),
      RS = require('../lib/reward-store'),
      L = require('../lib/local-identity');
    const ph = L.phoneOf(b.phone); /* the one phone check (CRM-MINT1) */
    if (!ph.phone) throw bad('Give the phone number they used.', 400, 'BAD_PHONE');
    const from = rewards.holderOf({ phone: ph.phone });
    const digits = from.value.replace(/[^0-9]/g, '');
    const name =
      String(b.name || '')
        .replace(/\s+/g, ' ')
        .trim() || 'Customer ' + digits.slice(-4);
    /* ⭐⭐ CRM-MINT1: the five writes (mint · contact · list row · number · the points) are ONE transaction — a points claim that
       fails no longer leaves a customer added without their points */
    const inTx = (h) => (_entity, fn) => fn(h); /* the reward store's withEntity, answered by the transaction already open */
    const { local, party_no, claimed, restored } = await withEntity(owner, async (h) => {
      const a = await L.addCustomer(h, owner, { name, phone: from.value, via: 'manual' });
      if (a.refused) throw bad((a.refused.error && a.refused.error.message) || 'Could not add them.', a.refused.status || 400, 'MINT_REFUSED');
      if (a.exists) throw bad(L.existsWords(a, 'That customer is already on your list.'), 409, 'EXISTS');
      /* the points: the ONE claim path (lib/reward-store.claim — the engine's claim, both halves locked and written together), here
         inside this same transaction. The ref names the new customer too: a phone claimed again later onto another customer is a
         NEW claim, never a half-replay (main's rule, kept through INT6a). */
      let got = 0;
      const prog = await RS.programme(owner, inTx(h));
      if (prog) {
        const to = { scheme: 'identity', value: String(a.local.identity_id) };
        const c = await RS.claim(owner, from, to, 'claim:' + digits + ':' + a.local.identity_id, prog, inTx(h));
        if (c.ok) got = c.points;
      }
      return { local: a.local, party_no: a.party_no, claimed: got, restored: !!a.restored };
    });
    res.status(201).json({
      party: { party_id: local.identity_id, user_id: local.user_id, display_name: local.display_name, party_no, kind: 'local', on_chitbridge: false },
      points_claimed: claimed,
      ...restoredAnswer(restored, local.display_name)
    });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/* ── CO1 privacy: contact consent (K2, b306) and the request register (K4 · K11, b307) — lib/privacy.js (PV, required at the top) ── */
/** the party must be on this shop's list (the same test the log uses), and still LIVE — a deleted party answers 404 like a stranger (CRM-247, books-store.partyOn).
 *  `opt.removedOk`: the privacy-request log keeps taking a deleted party — hiding is not erasing, so the person's access / erasure request must still start its clock. */
async function mine(h, owner, id, opt) {
  const on = await require('../lib/books-store').partyOn(h, owner, id);
  if (!on.customer && !on.supplier && !(opt && opt.removedOk && on.removed)) throw bad(NOT_YOUR_PARTY, 404, 'NOT_FOUND');
}
// @does A party id in -> we read their contact preferences and the consent law words for the shop's country -> the preferences and the law text.
router.get('/parties/:id/contact-prefs', auth, noKey, ...checked('GET /parties/:id/contact-prefs'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const out = await withEntity(owner, async (h) => {
      await mine(h, owner, id);
      const p = await PV.prefs(h, owner, id);
      /* T3-P3-CONSENT: the shop's country's law words (one SELECT in this same transaction) — the consent block paints THESE, never a default */
      const c = (await h.query(`SELECT country FROM identities WHERE identity_id = $1`, [owner])).rows[0];
      return Object.assign(p, { law: PV.lawOf(c && c.country) });
    });
    /* S34: the consent history, what may be done on each channel, and the shop's country law (PV.prefs + the law added above) */
    res.json({ party_id: id, history: out.history, may: out.may, law: out.law });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/**
 * who may: any login of the shop (a hat-gate refuses a viewer's write first). CMP-42: this door is STAFF writing down what a customer said, so the row says so —
 * source 'staff' and the actor's id as its source_ref. 'self' (the customer's own answer, routes/privacy.js) and 'reply' (a STOP message, lib/optout.js) are written only by
 * those paths; a body that names either is refused in words, never relabelled silently.
 */
const STAFF_SOURCE_WHY = 'A shop notes what a customer said as staff. The customer’s own answer comes from the customer, and a reply from the message.';
// @does A party id and what the customer said about contact -> we note it as staff-recorded consent, never as the customer's own answer -> the saved preference.
router.post('/parties/:id/contact-prefs', auth, noKey, ...checked('POST /parties/:id/contact-prefs'), async (req, res) => {
  try {
    const owner = ctx(req),
      id = idOf(req);
    const sent = req.body && typeof req.body === 'object' ? req.body : {};
    if (sent.source != null && sent.source !== 'staff') throw bad(STAFF_SOURCE_WHY);
    const body = Object.assign({}, sent, { source: 'staff', source_ref: byOf(req) });
    const pref = await withEntity(owner, async (h) => {
      await mine(h, owner, id); PV.checkedPref(sent); PV.requireStaffEvidence(sent, bad); /* SEC audit 2026-11-16: after the party and the words are judged (old answers unchanged), a staff yes needs its evidence */
      return PV.notePref(h, owner, id, body, byOf(req));
    });
    res.status(201).json({ pref });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/** who may: the owner or an editor (CRM-40, decided 12 Nov: the register names people and their complaints, so need-to-know); a viewer or commenter gets 403 VIEW_ONLY in words */
// @does Optional open flag and page from the owner or an editor -> we read the register of privacy requests -> a page of requests with open and late counts; viewers are refused.
router.get('/privacy-requests', auth, noKey, ...checked('GET /privacy-requests'), async (req, res) => {
  try {
    if (!isOwner(req) && !access.canEdit(req.identity)) throw bad(VIEW_ONLY_WHY, 403, 'VIEW_ONLY');
    const owner = ctx(req);
    const out = await withEntity(owner, (h) => PV.requests(h, owner, { open: String(req.query.open) === '1', page: req.query.page, limit: req.query.limit }));
    /* S34: the register's page and counts (lib/privacy requests), then who may answer */
    res.json({ requests: out.requests, total: out.total, page: out.page, limit: out.limit, open: out.open, late: out.late, may_answer: isOwner(req), why: isOwner(req) ? null : ANSWER_WHY });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
// @does A privacy request, optionally about a party -> we log it in the register -> the saved request.
router.post('/privacy-requests', auth, noKey, ...checked('POST /privacy-requests'), async (req, res) => {
  try {
    const owner = ctx(req),
      b = req.body || {};
    if (b.party_id != null && !UUID.test(String(b.party_id))) throw bad(NOT_A_PARTY_ID, 400, 'BAD_ID');
    const r = await withEntity(owner, async (h) => {
      if (b.party_id) await mine(h, owner, b.party_id, { removedOk: true });
      return PV.logRequest(h, owner, b, byOf(req));
    });
    res.status(201).json({ request: r });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
// @does A request id and the answer from the owner -> we record the shop's answer to the privacy request -> the updated request; owner only.
router.post('/privacy-requests/:id/answer', auth, noKey, ...checked('POST /privacy-requests/:id/answer'), async (req, res) => {
  try {
    if (!isOwner(req)) throw bad(ANSWER_WHY, 403, 'OWNER_ONLY');
    const owner = ctx(req),
      id = String(req.params.id || '');
    if (!UUID.test(id)) throw bad('That is not a request id.', 400, 'BAD_ID');
    const r = await withEntity(owner, (h) => PV.answerRequest(h, owner, id, req.body, byOf(req)));
    res.json({ request: r });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

/* ── T3-P2-CRM: segments & groups (lib/crm-groups.js) — the ONE segment definition counted, named groups written, a set messaged through the one gate ── */
const CG = require('../lib/crm-groups');
const whoIs = (req) => ({ owner: isOwner(req), editor: access.canEdit(req.identity) });
/** who may: anyone signed in to the shop reads it (a viewer sees every action greyed with the server's sentence — `may`) */
// @does Nothing but the signed-in shop -> we read the customer segments, groups and what each action may do -> the segments, groups and counts.
router.get('/segments', auth, noKey, ...checked('GET /segments'), async (req, res) => {
  try {
    const overview = await CG.overview(ctx(req), whoIs(req));
    /* S34: every key lib/crm-groups overview answers */
    res.json({ segments: overview.segments, groups: overview.groups, groups_migrated: overview.groups_migrated, consent_migrated: overview.consent_migrated, channel: overview.channel, purpose: overview.purpose, customers: overview.customers, may: overview.may });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/** who may: the owner or an editor (hat-gate refuses a viewer first; this is the sentence) — { name, add[], remove[] }, ONE transaction */
// @does A group name with members to add or remove, from the owner or an editor -> we change the group in one transaction -> the group name, who was added or removed, and its count.
router.post('/groups', auth, noKey, ...checked('POST /groups'), async (req, res) => {
  try {
    if (!whoIs(req).editor) throw bad(VIEW_ONLY_WHY, 403, 'VIEW_ONLY');
    const owner = ctx(req);
    const set = await withEntity(owner, (h) => CG.setGroup(h, owner, req.body));
    res.status(201).json({ name: set.name, added: set.added, removed: set.removed, count: set.count }); /* S34 */
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/** who may: the owner only — the group leaves every customer; the offers that named it are the warning GET /segments carried */
// @does A group name from the owner -> we delete the group from every customer -> the name and how many were removed; owner only.
router.delete('/groups/:name', auth, noKey, ...checked('DELETE /groups/:name'), async (req, res) => {
  try {
    if (!isOwner(req)) throw bad('Only the owner deletes a group.', 403, 'OWNER_ONLY');
    const owner = ctx(req);
    const dropped = await withEntity(owner, (h) => CG.dropGroup(h, owner, req.params.name));
    res.json({ name: dropped.name, removed: dropped.removed }); /* S34 */
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});
/** who may: the owner or an editor — { channel?, purpose?, text, dry? }: dry = the count and who is refused (by code); real = the one sender per allowed member */
// @does A segment key, a message and an optional dry flag from the owner or an editor -> we count who may be messaged, or send to each allowed member -> the counts, who was refused and why.
router.post('/segments/:key/send', auth, noKey, ...checked('POST /segments/:key/send'), async (req, res) => {
  try {
    if (!whoIs(req).editor) throw bad(VIEW_ONLY_WHY, 403, 'VIEW_ONLY');
    const sent = await CG.send(ctx(req), req.params.key, req.body);
    /* S34: every key lib/crm-groups send answers (refusals_logged and refusals_unlogged only after a real send: undefined on a preview, so JSON leaves them out) */
    // prettier-ignore
    res.json({ key: sent.key, send_ref: sent.send_ref, dry: sent.dry, channel: sent.channel, purpose: sent.purpose, members: sent.members, may: sent.may, refused: sent.refused, refused_by: sent.refused_by, sent: sent.sent, sent_n: sent.sent_n, failed_n: sent.failed_n, refused_n: sent.refused_n, refusals_logged: sent.refusals_logged, refusals_unlogged: sent.refusals_unlogged });
  } catch (e) {
    problem(req, res, crmFault(e, req));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
