// @stage tested
// @stage-note [CB CRM] The party read model (Phase 3): the shop's customers and suppliers as ONE row per party, assembled from
// @stage-note what exists — nothing stored, no money computed. routes/crm.js shapes the answers.
'use strict';
/**
 * lib/crm.js — A PARTY IS NOT A NEW TABLE (docs/design/crm/DATA.md §4).
 *
 * ⭐ ONE ROW PER PARTY. A party on both lists is the same identity on both (customer_list.customer_identity_id ·
 *   supplier_list.supplier_entity_id), so the list is the union keyed on that id, with two role flags (Q4, provisional).
 *   The old GET /customers keeps its contract (it drops a both-sides party on purpose); this is the new shape.
 * ⭐ THE FILTERS ARE HERE, IN ONE PLACE, over rows the SQL flags (so the rule is readable and tested, not buried in a WHERE):
 *     · merged_into set on a list row → that row is never listed (the first reader of b274's column; opening its id opens the survivor)
 *     · hidden_at set (b276, "Remove from my parties", Q10) → never listed, history untouched
 *     · the shop itself (a self-trade chit leaves a list row naming the owner as its own party; a shop is never its own party, H3)
 *     · another population (lib/istest sameWorldSql, b249's rule) → never listed
 * ⭐ MONEY IS READ. Dues come from lib/party-fields decorate (the Ledger's own stored figures, CBReceivables) exactly as
 *   GET /customers and /suppliers show them; a both-sides party NETS once, the way routes/books.js /dues does (the two
 *   signed figures added). The CRM never sums a bill. Nothing here rounds anything.
 * ⭐ ON CHITBRIDGE is lib/local-identity.verdict — the one answer — never decided in the browser.
 * ⚠️ BEFORE b274 / b276 the columns are missing: they are read through to_jsonb, so a missing column is a NULL, not a failure.
 * Q8 (provisional): the whole list in memory up to CAP parties; above it `truncated: true` and the screen pages.
 *
 * owns: the CRM's one party list/record read, the dues net, and removeParty (hide, never delete)
 * called by: routes/crm.js · routes/relationships.js (DELETE /suppliers/:id) · lib/crm-groups.js
 * FLOW  rows() → dues() → assemble() → list()/one()   DELETE → removeParty() [either side open → 409 HAS_DUES]
 * // CARD 11-crm-and-marketing/crm-parties
 */
const CAP = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function db_() {
  return require('../db');
}
const withEntity = (e, fn) => db_().withEntity(e, fn);
const trySavepoint = (h, fn, fb) => db_().trySavepoint(h, fn, fb);
const iso = (date) => (date == null ? null : date instanceof Date ? date.toISOString() : String(date));
const num = (v) => (v == null ? null : Number(v));

/** the shop's own rule for high value, if it set one (identities.policy_flags.crm — the slot system_folders already uses) */
async function shopRule(h, owner) {
  const r = await trySavepoint(h, () => h.query(`SELECT to_jsonb(i)->'policy_flags'->'crm' AS crm FROM identities i WHERE i.identity_id = $1`, [owner]), {
    rows: []
  });
  const c = (r.rows[0] && r.rows[0].crm) || {};
  return { pct: c.high_value_pct, minBills: c.high_value_min_bills };
}

/** the columns every party read shares: who they are, and what the SQL says about trading with them */
function who() {
  const L = require('./local-identity'),
    T = require('./istest');
  return `i.identity_id AS party_id, i.display_name, i.user_id, i.bridge_id, i.email, i.phone, i.otp_contact, i.gstn, i.status,
       to_jsonb(i)->>'entity_kind' AS entity_kind, to_jsonb(i)->>'city' AS city,
       ${L.onRailSql('i')} AS on_rail, ${T.sameWorldSql('i', '$1')} AS same_world`;
}

/**
 * rows(owner, { party? }) → { cust, sup, walk, truncated } — the raw rows of both lists (merged / hidden / other worlds
 * still in them: assemble() decides). Two statements for the whole shop, never one per party. `party` narrows both to one id.
 */
async function rows(owner, opt) {
  const o = opt || {},
    one = o.party ? 2 : 0,
    args = o.party ? [owner, o.party] : [owner];
  const G = require('./customer-groups'),
    M = require('./memberships');
  return withEntity(owner, async (h) => {
    const rule = await shopRule(h, owner);
    const custSql = (seg) => `SELECT ${who()}, cl.customer_list_id, cl.customer_type, cl.added_via, cl.txn_count, cl.last_txn_at,
           to_jsonb(cl)->'groups' AS groups, ${seg} AS segment, cl.segment_override,
           to_jsonb(cl)->>'merged_into' AS merged_into, to_jsonb(cl)->>'hidden_at' AS hidden_at, to_jsonb(cl)->>'party_no' AS party_no
      FROM customer_list cl JOIN identities i ON i.identity_id = cl.customer_identity_id
     WHERE cl.owner_entity_id = $1 AND cl.customer_identity_id <> $1${one ? ' AND cl.customer_identity_id = $2' : ''}
     ORDER BY lower(i.display_name) LIMIT ${CAP + 1}`;
    /* high_value reads party_item; before b273 that is 42P01 → the segment without it, never a failure */
    let cust = await trySavepoint(h, () => h.query(custSql(G.segmentSql(rule)), args), null);
    if (!cust) cust = await h.query(custSql(G.SEGMENT_SQL_BASE), args);
    /* a lead's stage lives in memberships (b297); absent = nobody has one yet. The Leads list always asks (it must say so); a record only when it is a lead */
    const ids = cust.rows.filter((item) => item.added_via === 'lead').map((item) => item.party_id);
    const stagesOn = !!o.stages && (o.stages === 'always' || ids.length > 0) && (await M.ready());
    if (stagesOn) {
      /* ONE statement for every lead's stage, in this same transaction */
      const st = ids.length ? await M.latest(h, owner, 'lead_stage', ids) : new Map();
      cust.rows.forEach((item) => {
        const x = st.get(String(item.party_id));
        if (x) {
          item.lead_stage = x.group;
          item.lead_at = x.at;
        }
      });
    }
    const sup = await h.query(
      `SELECT ${who()}, sl.supplier_list_id, sl.category, sl.preferred, sl.supply_kind, sl.added_via,
           to_jsonb(sl)->>'notes' AS notes,
           to_jsonb(sl)->>'merged_into' AS merged_into, to_jsonb(sl)->>'hidden_at' AS hidden_at, to_jsonb(sl)->>'party_no' AS party_no
      FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id
     WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id <> $1${one ? ' AND sl.supplier_entity_id = $2' : ''}
     ORDER BY lower(i.display_name) LIMIT ${CAP + 1}`,
      args
    );
    /* walk-ins: a phone that holds points and nobody has claimed (the net of a claimed phone is 0) — only on the whole list */
    const walk = o.party
      ? { rows: [] }
      : await trySavepoint(
          h,
          () =>
            h.query(
              `SELECT holder_value AS phone, SUM(points)::bigint AS points, MAX(at) AS last_at FROM reward_ledger
        WHERE entity_id = $1 AND holder_scheme = 'phone' GROUP BY holder_value HAVING SUM(points) > 0
        ORDER BY MAX(at) DESC LIMIT 500`,
              [owner]
            ),
          { rows: [] }
        );
    /* the shop's zone (else its country) → its day, for what is late (one rule: crm-followups isLate; books-hooks.dayOf reads either — M210). A plain read of the identity row — no savepoint */
    const country = await require('./crm-followups').zoneOfShop(h, owner); /* T2-NATDEF: unstated → dayOf's UTC, never India's day */
    /* consent (MKT-SRV1 G1 · G5): the newest b306 row per (party, channel, purpose), ONE statement in this same transaction; null = b306 not run */
    const PV = require('./privacy');
    const prefs = o.consent ? await trySavepoint(h, () => h.query(PV.LATEST_SQL(!!o.party), args), null) : null;
    return {
      country,
      leads_ready: stagesOn,
      prefs: prefs ? PV.contactPrefs(prefs.rows) : null,
      cust: cust.rows,
      sup: sup.rows,
      walk: walk.rows,
      truncated: cust.rows.length > CAP || sup.rows.length > CAP
    };
  });
}

/** the Ledger's stored dues for each side, through the ONE decorator (party-fields) — one pass per side, never per party */
async function dues(owner, cust, list) {
  const PF = require('./party-fields');
  const c = cust.map((item) => ({ party_id: item.party_id })),
    s = list.map((item) => ({ party_id: item.party_id }));
  if (c.length) await PF.decorate(withEntity, owner, c, 'party_id', 'customer');
  if (s.length) await PF.decorate(withEntity, owner, s, 'party_id', 'supplier');
  return { c: new Map(c.map((x) => [String(x.party_id), x])), s: new Map(s.map((x) => [String(x.party_id), x])) };
}

/** R10: does EITHER side hold money? (the netted figure can read 0 with ₹5,000 owed each way) */
const anySideOpen = (customerMinor, supplierMinor) => !!customerMinor || !!supplierMinor;

/** the Ledger's net for one party: the two stored, signed figures added (+ they owe you), as /dues nets them */
function net(c, s) {
  const on = (c && c.balance_minor !== undefined) || (s && s.balance_minor !== undefined);
  if (!on) return null; /* ledger off (or no engine): no dues, said by null */
  const cb = c && c.balance_minor !== undefined ? c.balance_minor : null,
    sb = s && s.balance_minor !== undefined ? s.balance_minor : null;
  const dates = [c && c.oldest_due, s && s.oldest_due].filter(Boolean).sort();
  return {
    balance_minor: (cb || 0) + (sb || 0),
    oldest_due: dates[0] || null,
    side: c && s ? 'both' : c ? 'customer' : 'supplier',
    open_side: anySideOpen(cb, sb)
  };
}

/** which kind of party: local (minted) · person · business — walk-ins are their own rows */
function kindOf(r) {
  if (require('./handle').isMinted(r.user_id)) return 'local';
  if (r.entity_kind === 'shopper' || r.customer_type === 'end_customer') return 'person';
  return 'business';
}

/** the reader rules of DATA.md §7 — phone: the contact phone, else the sign-in target; GSTIN: the shop's word wins, theirs shows when it has none */
function readerFacts(p, taxIds, theirs) {
  const mine = ((taxIds || []).find((item) => item.scheme === 'GSTIN') || {}).value || null;
  const th = theirs ? String(theirs).trim().toUpperCase() : null;
  return {
    phone: p.phone || p.otp_contact || null,
    gstin: { value: mine || th, source: mine ? 'shop' : th ? 'profile' : null, theirs: th, differs: !!(mine && th && mine !== th) }
  };
}

/**
 * assemble({cust, sup, walk}, dues) → { parties, walk_ins, folded } — pure: rows in, one row per party out.
 * `folded` maps a merged-away party_id → the party it was merged into (so a record of an old id opens the survivor).
 */
function assemble(raw, due) {
  const V = require('./local-identity').verdict;
  const d = due || { c: new Map(), s: new Map() };
  const by = new Map(),
    folded = new Map();
  const live = (r) => {
    if (r.merged_into) {
      folded.set(String(r.party_id), String(r.merged_into));
      return false;
    }
    if (r.hidden_at) return false;
    if (r.same_world === false) return false; /* another population: never listed */
    return true;
  };
  const take = (r, role) => {
    if (!live(r)) return;
    const k = String(r.party_id);
    let p = by.get(k);
    if (!p) {
      const v = V({ on_rail: r.on_rail, same_world: r.same_world, user_id: r.user_id, status: r.status, display_name: r.display_name });
      p = {
        party_id: k,
        display_name: r.display_name,
        user_id: r.user_id,
        bridge_id: r.bridge_id,
        email: require('./resolveuserid').realEmail(r.email),
        phone: r.phone || null /* O6/C9: an internal …@<shop>.cr handle is never sent as an e-mail */,
        otp_contact: r.otp_contact || null,
        gstn: r.gstn || null,
        city: r.city || null,
        status: r.status,
        kind: null,
        on_chitbridge: !!v.ok,
        may_trade: v.ok ? { ok: true } : { ok: false, why: v.why },
        roles: { customer: false, supplier: false },
        party_no: null,
        last_activity: null
      };
      by.set(k, p);
    }
    p.roles[role] = true;
    p.party_no = p.party_no || r.party_no || null;
    if (role === 'customer') {
      p.kind = kindOf(r);
      p.customer = {
        list_id: r.customer_list_id || null,
        segment: r.segment,
        segment_override: r.segment_override || null,
        txn_count: Number(r.txn_count) || 0,
        last_txn_at: iso(r.last_txn_at),
        groups: Array.isArray(r.groups) ? r.groups : [],
        customer_type: r.customer_type,
        added_via: r.added_via
      };
      /* a lead IS a party (added_via 'lead'); its stage is the latest memberships row, 'lead' before any move; the first trade makes it a customer */
      p.lead = r.added_via === 'lead' ? { stage: (Number(r.txn_count) || 0) > 0 ? 'customer' : r.lead_stage || 'lead', since: r.lead_at || null } : null;
      if (r.last_txn_at && (!p.last_activity || iso(r.last_txn_at) > p.last_activity)) p.last_activity = iso(r.last_txn_at);
    } else {
      p.kind = p.kind || kindOf(r);
      p.supplier = {
        list_id: r.supplier_list_id || null,
        category: r.category || null,
        preferred: !!r.preferred,
        supply_kind: r.supply_kind || null,
        notes: r.notes || null,
        added_via: r.added_via
      };
    }
  };
  (raw.cust || []).forEach((item) => take(item, 'customer'));
  (raw.sup || []).forEach((item) => take(item, 'supplier'));
  const parties = Array.from(by.values()).map((item) => {
    const c = d.c.get(item.party_id),
      s = d.s.get(item.party_id);
    const cd = item.roles.customer ? c : null,
      sd = item.roles.supplier ? s : null;
    item.party_no = item.party_no || (c && c.party_no) || (s && s.party_no) || null;
    item.legal_name = (c && c.legal_name) || (s && s.legal_name) || null;
    item.nickname = (c && c.nickname) || null;
    item.state_code = (c && c.state_code) || (s && s.state_code) || null;
    item.tax_ids = (c && c.tax_ids && c.tax_ids.length ? c.tax_ids : s && s.tax_ids) || [];
    item.terms = {};
    if (cd)
      item.terms.customer = {
        credit_days: cd.credit_days == null ? null : cd.credit_days,
        credit_limit_minor: cd.credit_limit_minor == null ? null : cd.credit_limit_minor
      };
    if (sd)
      item.terms.supplier = {
        credit_days: sd.credit_days == null ? null : sd.credit_days,
        credit_limit_minor: sd.credit_limit_minor == null ? null : sd.credit_limit_minor
      };
    item.dues = net(cd, sd);
    Object.assign(item, readerFacts(item, item.tax_ids, item.gstn));
    item.name = item.nickname || item.display_name;
    return item;
  });
  const walk_ins = (raw.walk || []).map((item) => ({
    walk_in: true,
    party_id: null,
    kind: 'walk-in',
    phone: item.phone,
    points: Number(item.points) || 0,
    last_activity: iso(item.last_at)
  }));
  return { parties, walk_ins, folded };
}

/** a lead: added as one, and no trade behind it yet (a supplier too is never a lead) */
const isLead = (p) => !!(p.lead && p.customer && !p.roles.supplier && p.customer.txn_count === 0);

/** each party's contact_prefs { migrated, may } — lib/privacy's own map; only when asked (`consent`) */
function withPrefs(parties, raw, consent) {
  if (!consent) return;
  const PV = require('./privacy');
  parties.forEach((item) => {
    item.contact_prefs = PV.contactPrefsOf(raw.prefs, item.party_id);
  });
}

/**
 * GET /parties — the whole list: { parties, walk_ins, count, total, page, limit, truncated }. Leads are OUT of it by default; `{ view: 'leads' }` is only the leads
 * (with their stage, and `leads_migrated` — false until b297 runs, so the screen can say so in words).
 */
async function list(owner, opt) {
  const o = opt || {},
    leads = o.view === 'leads';
  const limit = Math.min(CAP, Math.max(1, Number(o.limit) || CAP)),
    page = Math.max(1, Number(o.page) || 1);
  const raw = await rows(owner, { stages: leads ? 'always' : false, consent: !!o.consent });
  const a = assemble(raw, await dues(owner, raw.cust, raw.sup));
  const parties = a.parties.filter((item) => isLead(item) === leads);
  const alerts = markLate(parties, raw.country);
  /* G4 (MKT-SRV1): total · page · limit top-level; no ?limit asked = the whole list (CAP), today's answer */
  const shown = parties.slice((page - 1) * limit, page * limit);
  withPrefs(shown, raw, o.consent);
  const out = {
    parties: shown,
    walk_ins: leads ? [] : a.walk_ins,
    count: parties.length,
    total: parties.length,
    page,
    limit,
    truncated: !!raw.truncated,
    alerts
  };
  if (o.consent) out.consent_migrated = !!raw.prefs;
  if (leads) out.leads_migrated = !!raw.leads_ready;
  return out;
}
/**
 * ⭐ LATE DUES, ONE RULE (M149): a party whose oldest due day is before the shop's today has `dues.overdue = true`; the list's `alerts.dues_overdue` is the count of
 * those same parties — the banner, the Dues filter and the mark on a row all read these, never their own date sum. Mutates the parties; returns the alerts.
 */
function markLate(parties, country) {
  const F = require('./crm-followups'),
    today = F.dayOf(new Date().toISOString(), country);
  let index = 0;
  (parties || []).forEach((item) => {
    if (item.dues) {
      item.dues.overdue = Number(item.dues.balance_minor) !== 0 && F.isLate(item.dues.oldest_due, today);
      if (item.dues.overdue) index++;
    }
  });
  return { dues_overdue: index };
}

/** one party by id, following merged_into to the survivor (at most five hops) → { party, merged_from } or null */
async function one(owner, id, opt) {
  let cur = String(id),
    from = null;
  for (let count = 0; count < 5; count++) {
    const raw = await rows(owner, { party: cur, stages: !!(opt && opt.stages), consent: !!(opt && opt.consent) });
    const a = assemble(raw, await dues(owner, raw.cust, raw.sup));
    if (a.parties.length) {
      markLate(a.parties, raw.country);
      withPrefs(a.parties, raw, !!(opt && opt.consent));
      return { party: a.parties[0], merged_from: from, leads_ready: !!raw.leads_ready };
    }
    const next = a.folded.get(cur);
    if (!next) return null;
    if (!from) from = { party_id: cur, party_no: (raw.cust.concat(raw.sup).find((item) => String(item.party_id) === cur) || {}).party_no || null };
    cur = next;
  }
  return null;
}

/**
 * ⭐ THE FIRST BILL ENDS THE LEAD (L2C step 5, FX-L2C 2026-10-13). A counter bill is a chit sent to SELF that names its customer in
 * business_json.customer — so the post-commit auto-add in routes/chits.js (which counts RECIPIENTS) never touched the named party:
 * a lead stayed "Trial" after being billed, and Ravi Stores showed 0 trades after three years. This is the ONE bump for a party the
 * bill NAMES: txn_count + 1, last_txn_at = the bill's own moment. It UPDATEs a row that exists (the counter picks from the list) and
 * never inserts; a party that is also a recipient is bumped by the recipient block, not here (the caller skips it — no double count).
 * The stage "customer" is DERIVED from txn_count (assemble(), isLead(), routes/crm.js IS_CUSTOMER) — no second writer, no new group.
 * One statement, inside the bill's transaction (the caller wraps it in a savepoint: a CRM write never fails a chit, D-065).
 */
/** whom a counter bill NAMES (business_json.customer) — books-hooks.partyFromCustomer is the one reading of that slot; this is its CRM door */
const namedParty = (bj) => require('./books-hooks').partyFromCustomer(bj && typeof bj === 'object' ? bj.customer : null);

async function traded(h, owner, party_id, at) {
  if (!UUID.test(String(party_id || '')) || String(party_id) === String(owner)) return null;
  const r = await h.query(
    `UPDATE customer_list SET txn_count = COALESCE(txn_count, 0) + 1, last_txn_at = COALESCE($3::timestamptz, NOW())
      WHERE owner_entity_id = $1 AND customer_identity_id = $2 RETURNING customer_identity_id AS party_id, txn_count, last_txn_at`,
    [owner, party_id, at || null]
  );
  return r.rows[0] || null;
}

/**
 * removeParty(owner, id) — "Remove from my parties" (Q10), the ONE remove for a customer AND a supplier row (R8: the Suppliers screen's own
 * hard DELETE is gone). It HIDES both lists' rows — nothing is deleted — and refuses while EITHER side has money open (R10: ₹5,000 owed
 * each way nets to 0 but is not settled). The caller has already answered who may (owner only). 404 NOT_FOUND · 409 HAS_DUES.
 */
async function removeParty(owner, id) {
  const found = await one(owner, id);
  if (!found || found.merged_from) throw require('./crm-followups').bad('Not your party.', 404, 'NOT_FOUND');
  const owed = found.party.dues;
  if (owed && owed.open_side) throw require('./crm-followups').bad('There are open dues on this party.', 409, 'HAS_DUES');
  await withEntity(owner, async (conn) => {
    await conn.query(`UPDATE customer_list SET hidden_at = now() WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND hidden_at IS NULL`, [owner, id]);
    await conn.query(`UPDATE supplier_list SET hidden_at = now() WHERE owner_entity_id = $1 AND supplier_entity_id = $2 AND hidden_at IS NULL`, [owner, id]);
  });
  return { party_id: id };
}

module.exports = {
  removeParty,
  isLead,
  markLate,
  CAP,
  UUID,
  rows,
  dues,
  net,
  assemble,
  list,
  one,
  kindOf,
  readerFacts,
  shopRule,
  iso,
  num,
  withEntity,
  trySavepoint,
  traded,
  namedParty
};
