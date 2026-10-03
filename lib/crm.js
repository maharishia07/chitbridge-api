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
 *     · another population (lib/istest sameWorldSql, b249's rule) → never listed
 * ⭐ MONEY IS READ. Dues come from lib/party-fields decorate (the Ledger's own stored figures, CBReceivables) exactly as
 *   GET /customers and /suppliers show them; a both-sides party NETS once, the way routes/books.js /dues does (the two
 *   signed figures added). The CRM never sums a bill. Nothing here rounds anything.
 * ⭐ ON CHITBRIDGE is lib/local-identity.verdict — the one answer — never decided in the browser.
 * ⚠️ BEFORE b274 / b276 the columns are missing: they are read through to_jsonb, so a missing column is a NULL, not a failure.
 * Q8 (provisional): the whole list in memory up to CAP parties; above it `truncated: true` and the screen pages.
 */
const CAP = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function db_() { return require('../db'); }
const withEntity = (e, fn) => db_().withEntity(e, fn);
const trySavepoint = (h, fn, fb) => db_().trySavepoint(h, fn, fb);
const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const num = (v) => (v == null ? null : Number(v));

/** the shop's own rule for high value, if it set one (identities.policy_flags.crm — the slot system_folders already uses) */
async function shopRule(h, owner) {
  const r = await trySavepoint(h, () => h.query(`SELECT to_jsonb(i)->'policy_flags'->'crm' AS crm FROM identities i WHERE i.identity_id = $1`, [owner]), { rows: [] });
  const c = (r.rows[0] && r.rows[0].crm) || {};
  return { pct: c.high_value_pct, minBills: c.high_value_min_bills };
}

/** the columns every party read shares: who they are, and what the SQL says about trading with them */
function who() {
  const L = require('./local-identity'), T = require('./istest');
  return `i.identity_id AS party_id, i.display_name, i.user_id, i.bridge_id, i.email, i.phone, i.otp_contact, i.gstn, i.status,
       to_jsonb(i)->>'entity_kind' AS entity_kind, to_jsonb(i)->>'city' AS city,
       ${L.onRailSql('i')} AS on_rail, ${T.sameWorldSql('i', '$1')} AS same_world`;
}

/**
 * rows(owner, { party? }) → { cust, sup, walk, truncated } — the raw rows of both lists (merged / hidden / other worlds
 * still in them: assemble() decides). Two statements for the whole shop, never one per party. `party` narrows both to one id.
 */
async function rows(owner, opt) {
  const o = opt || {}, one = o.party ? 2 : 0, args = o.party ? [owner, o.party] : [owner];
  const G = require('./customer-groups');
  return withEntity(owner, async (h) => {
    const rule = await shopRule(h, owner);
    const custSql = (seg) => `SELECT ${who()}, cl.customer_list_id, cl.customer_type, cl.added_via, cl.txn_count, cl.last_txn_at,
           to_jsonb(cl)->'groups' AS groups, ${seg} AS segment, cl.segment_override,
           to_jsonb(cl)->>'merged_into' AS merged_into, to_jsonb(cl)->>'hidden_at' AS hidden_at, to_jsonb(cl)->>'party_no' AS party_no
      FROM customer_list cl JOIN identities i ON i.identity_id = cl.customer_identity_id
     WHERE cl.owner_entity_id = $1${one ? ' AND cl.customer_identity_id = $2' : ''}
     ORDER BY lower(i.display_name) LIMIT ${CAP + 1}`;
    /* high_value reads party_item; before b273 that is 42P01 → the segment without it, never a failure */
    let cust = await trySavepoint(h, () => h.query(custSql(G.segmentSql(rule)), args), null);
    if (!cust) cust = await h.query(custSql(G.SEGMENT_SQL_BASE), args);
    const sup = await h.query(`SELECT ${who()}, sl.supplier_list_id, sl.category, sl.preferred, sl.supply_kind, sl.added_via,
           to_jsonb(sl)->>'notes' AS notes,
           to_jsonb(sl)->>'merged_into' AS merged_into, to_jsonb(sl)->>'hidden_at' AS hidden_at, to_jsonb(sl)->>'party_no' AS party_no
      FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id
     WHERE sl.owner_entity_id = $1${one ? ' AND sl.supplier_entity_id = $2' : ''}
     ORDER BY lower(i.display_name) LIMIT ${CAP + 1}`, args);
    /* walk-ins: a phone that holds points and nobody has claimed (the net of a claimed phone is 0) — only on the whole list */
    const walk = o.party ? { rows: [] } : await trySavepoint(h, () => h.query(
      `SELECT holder_value AS phone, SUM(points)::bigint AS points, MAX(at) AS last_at FROM reward_ledger
        WHERE entity_id = $1 AND holder_scheme = 'phone' GROUP BY holder_value HAVING SUM(points) > 0
        ORDER BY MAX(at) DESC LIMIT 500`, [owner]), { rows: [] });
    return { cust: cust.rows, sup: sup.rows, walk: walk.rows, truncated: cust.rows.length > CAP || sup.rows.length > CAP };
  });
}

/** the Ledger's stored dues for each side, through the ONE decorator (party-fields) — one pass per side, never per party */
async function dues(owner, cust, sup) {
  const PF = require('./party-fields');
  const c = cust.map((r) => ({ party_id: r.party_id })), s = sup.map((r) => ({ party_id: r.party_id }));
  if (c.length) await PF.decorate(withEntity, owner, c, 'party_id', 'customer');
  if (s.length) await PF.decorate(withEntity, owner, s, 'party_id', 'supplier');
  return { c: new Map(c.map((x) => [String(x.party_id), x])), s: new Map(s.map((x) => [String(x.party_id), x])) };
}

/** the Ledger's net for one party: the two stored, signed figures added (+ they owe you), as /dues nets them */
function net(c, s) {
  const on = (c && c.balance_minor !== undefined) || (s && s.balance_minor !== undefined);
  if (!on) return null;                                       /* ledger off (or no engine): no dues, said by null */
  const cb = c && c.balance_minor !== undefined ? c.balance_minor : null, sb = s && s.balance_minor !== undefined ? s.balance_minor : null;
  const dates = [c && c.oldest_due, s && s.oldest_due].filter(Boolean).sort();
  return { balance_minor: (cb || 0) + (sb || 0), oldest_due: dates[0] || null, side: c && s ? 'both' : (c ? 'customer' : 'supplier') };
}

/** which kind of party: local (minted) · person · business — walk-ins are their own rows */
function kindOf(r) {
  if (require('./handle').isMinted(r.user_id)) return 'local';
  if (r.entity_kind === 'shopper' || r.customer_type === 'end_customer') return 'person';
  return 'business';
}

/** the reader rules of DATA.md §7 — phone: the contact phone, else the sign-in target; GSTIN: the shop's word wins, theirs shows when it has none */
function readerFacts(p, taxIds, theirs) {
  const mine = ((taxIds || []).find((t) => t.scheme === 'GSTIN') || {}).value || null;
  const th = theirs ? String(theirs).trim().toUpperCase() : null;
  return { phone: p.phone || p.otp_contact || null,
    gstin: { value: mine || th, source: mine ? 'shop' : (th ? 'profile' : null), theirs: th, differs: !!(mine && th && mine !== th) } };
}

/**
 * assemble({cust, sup, walk}, dues) → { parties, walk_ins, folded } — pure: rows in, one row per party out.
 * `folded` maps a merged-away party_id → the party it was merged into (so a record of an old id opens the survivor).
 */
function assemble(raw, due) {
  const V = require('./local-identity').verdict;
  const d = due || { c: new Map(), s: new Map() };
  const by = new Map(), folded = new Map();
  const live = (r) => {
    if (r.merged_into) { folded.set(String(r.party_id), String(r.merged_into)); return false; }
    if (r.hidden_at) return false;
    if (r.same_world === false) return false;                  /* another population: never listed */
    return true;
  };
  const take = (r, role) => {
    if (!live(r)) return;
    const k = String(r.party_id);
    let p = by.get(k);
    if (!p) {
      const v = V({ on_rail: r.on_rail, same_world: r.same_world, user_id: r.user_id, status: r.status, display_name: r.display_name });
      p = { party_id: k, display_name: r.display_name, user_id: r.user_id, bridge_id: r.bridge_id, email: r.email || null, phone: r.phone || null,
            otp_contact: r.otp_contact || null, gstn: r.gstn || null, city: r.city || null, status: r.status,
            kind: null, on_chitbridge: !!v.ok, may_trade: v.ok ? { ok: true } : { ok: false, why: v.why },
            roles: { customer: false, supplier: false }, party_no: null, last_activity: null };
      by.set(k, p);
    }
    p.roles[role] = true;
    p.party_no = p.party_no || r.party_no || null;
    if (role === 'customer') {
      p.kind = kindOf(r);
      p.customer = { list_id: r.customer_list_id || null, segment: r.segment, segment_override: r.segment_override || null, txn_count: Number(r.txn_count) || 0, last_txn_at: iso(r.last_txn_at),
                     groups: Array.isArray(r.groups) ? r.groups : [], customer_type: r.customer_type, added_via: r.added_via };
      if (r.last_txn_at && (!p.last_activity || iso(r.last_txn_at) > p.last_activity)) p.last_activity = iso(r.last_txn_at);
    } else {
      p.kind = p.kind || kindOf(r);
      p.supplier = { list_id: r.supplier_list_id || null, category: r.category || null, preferred: !!r.preferred, supply_kind: r.supply_kind || null, notes: r.notes || null, added_via: r.added_via };
    }
  };
  (raw.cust || []).forEach((r) => take(r, 'customer'));
  (raw.sup || []).forEach((r) => take(r, 'supplier'));
  const parties = Array.from(by.values()).map((p) => {
    const c = d.c.get(p.party_id), s = d.s.get(p.party_id);
    const cd = p.roles.customer ? c : null, sd = p.roles.supplier ? s : null;
    p.party_no = p.party_no || (c && c.party_no) || (s && s.party_no) || null;
    p.legal_name = (c && c.legal_name) || (s && s.legal_name) || null;
    p.nickname = (c && c.nickname) || null;
    p.state_code = (c && c.state_code) || (s && s.state_code) || null;
    p.tax_ids = (c && c.tax_ids && c.tax_ids.length ? c.tax_ids : (s && s.tax_ids)) || [];
    p.terms = {};
    if (cd) p.terms.customer = { credit_days: cd.credit_days == null ? null : cd.credit_days, credit_limit_minor: cd.credit_limit_minor == null ? null : cd.credit_limit_minor };
    if (sd) p.terms.supplier = { credit_days: sd.credit_days == null ? null : sd.credit_days, credit_limit_minor: sd.credit_limit_minor == null ? null : sd.credit_limit_minor };
    p.dues = net(cd, sd);
    Object.assign(p, readerFacts(p, p.tax_ids, p.gstn));
    p.name = p.nickname || p.display_name;
    return p;
  });
  const walk_ins = (raw.walk || []).map((w) => ({ walk_in: true, party_id: null, kind: 'walk-in', phone: w.phone, points: Number(w.points) || 0, last_activity: iso(w.last_at) }));
  return { parties, walk_ins, folded };
}

/** GET /parties — the whole list: { parties, walk_ins, count, truncated } */
async function list(owner) {
  const raw = await rows(owner);
  const a = assemble(raw, await dues(owner, raw.cust, raw.sup));
  return { parties: a.parties.slice(0, CAP), walk_ins: a.walk_ins, count: a.parties.length, truncated: !!raw.truncated };
}

/** one party by id, following merged_into to the survivor (at most five hops) → { party, merged_from } or null */
async function one(owner, id) {
  let cur = String(id), from = null;
  for (let hop = 0; hop < 5; hop++) {
    const raw = await rows(owner, { party: cur });
    const a = assemble(raw, await dues(owner, raw.cust, raw.sup));
    if (a.parties.length) return { party: a.parties[0], merged_from: from };
    const next = a.folded.get(cur);
    if (!next) return null;
    if (!from) from = { party_id: cur, party_no: ((raw.cust.concat(raw.sup)).find((r) => String(r.party_id) === cur) || {}).party_no || null };
    cur = next;
  }
  return null;
}

module.exports = { CAP, UUID, rows, dues, net, assemble, list, one, kindOf, readerFacts, shopRule, iso, num, withEntity, trySavepoint };
