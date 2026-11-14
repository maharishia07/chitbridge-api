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
 * ⭐ A COST-BLIND READER (RAIL-146i, `blind` = the route's ONE cost.isCostBlind read): the supplier-side balance, a both-sides net and the
 *   supplier's credit limit are purchase money — lib/dues-view hides them (null + cost_hidden:true) AFTER markLate, so `overdue` is from the
 *   real figure. Finance owns that rule; this file only calls it.
 * ⭐ ON CHITBRIDGE is lib/local-identity.verdict — the one answer — never decided in the browser.
 * ⚠️ BEFORE b274 / b276 the columns are missing: they are read through to_jsonb, so a missing column is a NULL, not a failure.
 * Q8 (provisional): the whole list in memory up to CAP parties; above it `truncated: true` and the screen pages.
 *
 * owns: the CRM's one party list/record read, the dues net, and removeParty (hide, never delete)
 * called by: routes/crm.js · routes/relationships.js (DELETE /suppliers/:id) · lib/crm-groups.js
 * FLOW  rows() → dues() → assemble() → list()/one()   DELETE → removeParty() [either side open → 409 HAS_DUES]
 * // CARD 11-crm-and-marketing/crm-parties
 */
const LIST_CAP = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function db_() {
  return require('../db');
}
const withEntity = (e, fn) => db_().withEntity(e, fn);
const trySavepoint = (db, fn, fb) => db_().trySavepoint(db, fn, fb);
const toIso = (date) => (date == null ? null : date instanceof Date ? date.toISOString() : String(date));
const num = (verdict) => (verdict == null ? null : Number(verdict));

/** the shop's own rule for high value, if it set one (identities.policy_flags.crm — the slot system_folders already uses) */
async function shopRule(db, owner) {
  const row = await trySavepoint(db, () => db.query(`SELECT to_jsonb(i)->'policy_flags'->'crm' AS crm FROM identities i WHERE i.identity_id = $1`, [owner]), {
    rows: []
  });
  const customer = (row.rows[0] && row.rows[0].crm) || {};
  return { pct: customer.high_value_pct, minBills: customer.high_value_min_bills };
}

/** the columns every party read shares: who they are, and what the SQL says about trading with them */
function who(emailMigrated) {
  const L = require('./local-identity'),
    T = require('./istest');
  /* the e-mail is the shop's own party_contact value (one fragment, lib/party-contact), never another shop's */
  return `i.identity_id AS party_id, i.display_name, i.user_id, i.bridge_id, ${require('./party-contact').emailSql('i', '$1', emailMigrated)} AS email, i.phone, i.otp_contact, i.gstn, i.status,
       to_jsonb(i)->>'entity_kind' AS entity_kind, to_jsonb(i)->>'city' AS city,
       ${L.onRailSql('i')} AS on_rail, ${T.sameWorldSql('i', '$1')} AS same_world`;
}

/** is the shop's party e-mail store (b839) there? A caller that never shows the address (remove) skips the schema ask */
async function emailStoreAsked(opt) {
  return !opt.noEmail && (await require('./party-contact').ready());
}

/**
 * rows(owner, { party? }) → { cust, sup, walk, truncated } — the raw rows of both lists (merged / hidden / other worlds
 * still in them: assemble() decides). Two statements for the whole shop, never one per party. `party` narrows both to one id.
 */
async function rows(owner, opt) {
  const options = opt || {},
    nestedOne = options.party ? 2 : 0,
    args = options.party ? [owner, options.party] : [owner];
  const customerGroups = require('./customer-groups'),
    memberships = require('./memberships');
  return withEntity(owner, async (db) => {
    const rule = await shopRule(db, owner),
      emailMigrated = await emailStoreAsked(options);
    const custSql = (seg) => `SELECT ${who(emailMigrated)}, cl.customer_list_id, cl.customer_type, cl.added_via, cl.txn_count, cl.last_txn_at,
           to_jsonb(cl)->'groups' AS groups, ${seg} AS segment, cl.segment_override,
           to_jsonb(cl)->>'merged_into' AS merged_into, to_jsonb(cl)->>'hidden_at' AS hidden_at, to_jsonb(cl)->>'party_no' AS party_no
      FROM customer_list cl JOIN identities i ON i.identity_id = cl.customer_identity_id
     WHERE cl.owner_entity_id = $1 AND cl.customer_identity_id <> $1${nestedOne ? ' AND cl.customer_identity_id = $2' : ''}
     ORDER BY lower(i.display_name) LIMIT ${LIST_CAP + 1}`;
    /* high_value reads party_item; before b273 that is 42P01 → the segment without it, never a failure */
    let cust = await trySavepoint(db, () => db.query(custSql(customerGroups.segmentSql(rule)), args), null);
    if (!cust) cust = await db.query(custSql(customerGroups.SEGMENT_SQL_BASE), args);
    /* a lead's stage lives in memberships (b297); absent = nobody has one yet. The Leads list always asks (it must say so); a record only when it is a lead */
    const ids = cust.rows.filter((item) => item.added_via === 'lead').map((item) => item.party_id);
    const stagesOn = !!options.stages && (options.stages === 'always' || ids.length > 0) && (await memberships.ready());
    if (stagesOn) {
      /* ONE statement for every lead's stage, in this same transaction */
      const stages = ids.length ? await memberships.latest(db, owner, 'lead_stage', ids) : new Map();
      cust.rows.forEach((item) => {
        const x = stages.get(String(item.party_id));
        if (x) {
          item.lead_stage = x.group;
          item.lead_at = x.at;
        }
      });
    }
    const supplierRows = await db.query(
      `SELECT ${who(emailMigrated)}, sl.supplier_list_id, sl.category, sl.preferred, sl.supply_kind, sl.added_via,
           to_jsonb(sl)->>'notes' AS notes,
           to_jsonb(sl)->>'merged_into' AS merged_into, to_jsonb(sl)->>'hidden_at' AS hidden_at, to_jsonb(sl)->>'party_no' AS party_no
      FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id
     WHERE sl.owner_entity_id = $1 AND sl.supplier_entity_id <> $1${nestedOne ? ' AND sl.supplier_entity_id = $2' : ''}
     ORDER BY lower(i.display_name) LIMIT ${LIST_CAP + 1}`,
      args
    );
    /* walk-ins: a phone that holds points and nobody has claimed (the net of a claimed phone is 0) — only on the whole list */
    const walk = options.party
      ? { rows: [] }
      : await trySavepoint(
          db,
          () =>
            db.query(
              `SELECT holder_value AS phone, SUM(points)::bigint AS points, MAX(at) AS last_at FROM reward_ledger
        WHERE entity_id = $1 AND holder_scheme = 'phone' GROUP BY holder_value HAVING SUM(points) > 0
        ORDER BY MAX(at) DESC LIMIT 500`,
              [owner]
            ),
          { rows: [] }
        );
    /* the shop's zone (else its country) → its day, for what is late (one rule: crm-followups isLate; books-hooks.dayOf reads either — M210). A plain read of the identity row — no savepoint */
    const country = await require('./crm-followups').zoneOfShop(db, owner); /* T2-NATDEF: unstated → dayOf's UTC, never India's day */
    /* consent (MKT-SRV1 G1 · G5): the newest b306 row per (party, channel, purpose), ONE statement in this same transaction; null = b306 not run */
    const privacy = require('./privacy');
    const prefs = options.consent ? await trySavepoint(db, () => db.query(privacy.LATEST_SQL(!!options.party), args), null) : null;
    return {
      country,
      leads_ready: stagesOn,
      prefs: prefs ? privacy.contactPrefs(prefs.rows) : null,
      cust: cust.rows,
      sup: supplierRows.rows,
      walk: walk.rows,
      truncated: cust.rows.length > LIST_CAP || supplierRows.rows.length > LIST_CAP
    };
  });
}

/** the Ledger's stored dues for each side, through the ONE decorator (party-fields) — one pass per side, never per party */
async function dues(owner, cust, entries) {
  const PF = require('./party-fields');
  const nestedList = cust.map((item) => ({ party_id: item.party_id })),
    innerList = entries.map((item) => ({ party_id: item.party_id }));
  if (nestedList.length) await PF.decorate(withEntity, owner, nestedList, 'party_id', 'customer');
  if (innerList.length) await PF.decorate(withEntity, owner, innerList, 'party_id', 'supplier');
  return { c: new Map(nestedList.map((x) => [String(x.party_id), x])), s: new Map(innerList.map((x) => [String(x.party_id), x])) };
}

/** R10: does EITHER side hold money? (the netted figure can read 0 with ₹5,000 owed each way) */
const anySideOpen = (customerMinor, supplierMinor) => !!customerMinor || !!supplierMinor;

/** the Ledger's net for one party: the two stored, signed figures added (+ they owe you), as /dues nets them */
function net(customer, supplier) {
  const on = (customer && customer.balance_minor !== undefined) || (supplier && supplier.balance_minor !== undefined);
  if (!on) return null; /* ledger off (or no engine): no dues, said by null */
  const cb = customer && customer.balance_minor !== undefined ? customer.balance_minor : null,
    supplierBalance = supplier && supplier.balance_minor !== undefined ? supplier.balance_minor : null;
  const dates = [customer && customer.oldest_due, supplier && supplier.oldest_due].filter(Boolean).sort();
  return {
    balance_minor: (cb || 0) + (supplierBalance || 0),
    oldest_due: dates[0] || null,
    side: customer && supplier ? 'both' : customer ? 'customer' : 'supplier',
    open_side: anySideOpen(cb, supplierBalance)
  };
}

/** which kind of party: local (minted) · person · business — walk-ins are their own rows */
function kindOf(row) {
  if (require('./handle').isMinted(row.user_id)) return 'local';
  if (row.entity_kind === 'shopper' || row.customer_type === 'end_customer') return 'person';
  return 'business';
}

/** the reader rules of DATA.md §7 — phone: the contact phone, else the sign-in target; GSTIN: the shop's word wins, theirs shows when it has none */
function readerFacts(party, taxIds, theirs) {
  const mine = ((taxIds || []).find((item) => item.scheme === 'GSTIN') || {}).value || null;
  const th = theirs ? String(theirs).trim().toUpperCase() : null;
  return {
    phone: party.phone || party.otp_contact || null,
    gstin: { value: mine || th, source: mine ? 'shop' : th ? 'profile' : null, theirs: th, differs: !!(mine && th && mine !== th) }
  };
}

/**
 * assemble({cust, sup, walk}, dues) → { parties, walk_ins, folded } — pure: rows in, one row per party out.
 * `folded` maps a merged-away party_id → the party it was merged into (so a record of an old id opens the survivor).
 */
function assemble(rawRows, dueMaps) {
  const verdictOf = require('./local-identity').verdict;
  const dueMap = dueMaps || { c: new Map(), s: new Map() };
  const by = new Map(),
    folded = new Map();
  const live = (row) => {
    if (row.merged_into) {
      folded.set(String(row.party_id), String(row.merged_into));
      return false;
    }
    if (row.hidden_at) return false;
    if (row.same_world === false) return false; /* another population: never listed */
    return true;
  };
  const take = (row, role) => {
    if (!live(row)) return;
    const k = String(row.party_id);
    let party = by.get(k);
    if (!party) {
      const verdict = verdictOf({ on_rail: row.on_rail, same_world: row.same_world, user_id: row.user_id, status: row.status, display_name: row.display_name });
      party = {
        party_id: k,
        display_name: row.display_name,
        user_id: row.user_id,
        bridge_id: row.bridge_id,
        email: require('./resolveuserid').realEmail(row.email),
        phone: row.phone || null /* O6/C9: an internal …@<shop>.cr handle is never sent as an e-mail */,
        otp_contact: row.otp_contact || null,
        gstn: row.gstn || null,
        city: row.city || null,
        status: row.status,
        kind: null,
        on_chitbridge: !!verdict.ok,
        may_trade: verdict.ok ? { ok: true } : { ok: false, why: verdict.why },
        roles: { customer: false, supplier: false },
        party_no: null,
        last_activity: null
      };
      by.set(k, party);
    }
    party.roles[role] = true;
    party.party_no = party.party_no || row.party_no || null;
    if (role === 'customer') {
      party.kind = kindOf(row);
      party.customer = {
        list_id: row.customer_list_id || null,
        segment: row.segment,
        segment_override: row.segment_override || null,
        txn_count: Number(row.txn_count) || 0,
        last_txn_at: toIso(row.last_txn_at),
        groups: Array.isArray(row.groups) ? row.groups : [],
        customer_type: row.customer_type,
        added_via: row.added_via
      };
      /* a lead IS a party (added_via 'lead'); its stage is the latest memberships row, 'lead' before any move; the first trade makes it a customer */
      party.lead = row.added_via === 'lead' ? { stage: (Number(row.txn_count) || 0) > 0 ? 'customer' : row.lead_stage || 'lead', since: row.lead_at || null } : null;
      if (row.last_txn_at && (!party.last_activity || toIso(row.last_txn_at) > party.last_activity)) party.last_activity = toIso(row.last_txn_at);
    } else {
      party.kind = party.kind || kindOf(row);
      party.supplier = {
        list_id: row.supplier_list_id || null,
        category: row.category || null,
        preferred: !!row.preferred,
        supply_kind: row.supply_kind || null,
        notes: row.notes || null,
        added_via: row.added_via
      };
    }
  };
  (rawRows.cust || []).forEach((item) => take(item, 'customer'));
  (rawRows.sup || []).forEach((item) => take(item, 'supplier'));
  const parties = Array.from(by.values()).map((item) => {
    const customer = dueMap.c.get(item.party_id),
      supplier = dueMap.s.get(item.party_id);
    const customerSide = item.roles.customer ? customer : null,
      supplierSide = item.roles.supplier ? supplier : null;
    item.party_no = item.party_no || (customer && customer.party_no) || (supplier && supplier.party_no) || null;
    item.legal_name = (customer && customer.legal_name) || (supplier && supplier.legal_name) || null;
    item.nickname = (customer && customer.nickname) || null;
    item.state_code = (customer && customer.state_code) || (supplier && supplier.state_code) || null;
    item.tax_ids = (customer && customer.tax_ids && customer.tax_ids.length ? customer.tax_ids : supplier && supplier.tax_ids) || [];
    item.terms = {};
    if (customerSide)
      item.terms.customer = {
        credit_days: customerSide.credit_days == null ? null : customerSide.credit_days,
        credit_limit_minor: customerSide.credit_limit_minor == null ? null : customerSide.credit_limit_minor
      };
    if (supplierSide)
      item.terms.supplier = {
        credit_days: supplierSide.credit_days == null ? null : supplierSide.credit_days,
        credit_limit_minor: supplierSide.credit_limit_minor == null ? null : supplierSide.credit_limit_minor
      };
    item.dues = net(customerSide, supplierSide);
    Object.assign(item, readerFacts(item, item.tax_ids, item.gstn));
    item.name = item.nickname || item.display_name;
    return item;
  });
  const walk_ins = (rawRows.walk || []).map((item) => ({
    walk_in: true,
    party_id: null,
    kind: 'walk-in',
    phone: item.phone,
    points: Number(item.points) || 0,
    last_activity: toIso(item.last_at)
  }));
  return { parties, walk_ins, folded };
}

/** a lead: added as one, and no trade behind it yet (a supplier too is never a lead) */
const isLead = (party) => !!(party.lead && party.customer && !party.roles.supplier && party.customer.txn_count === 0);

/** each party's contact_prefs { migrated, may } — lib/privacy's own map; only when asked (`consent`) */
function withPrefs(parties, rawRows, consent) {
  if (!consent) return;
  const privacy = require('./privacy');
  parties.forEach((item) => {
    item.contact_prefs = privacy.contactPrefsOf(rawRows.prefs, item.party_id);
  });
}

/**
 * GET /parties — the whole list: { parties, walk_ins, count, total, page, limit, truncated }. Leads are OUT of it by default; `{ view: 'leads' }` is only the leads
 * (with their stage, and `leads_migrated` — false until b297 runs, so the screen can say so in words).
 */
async function list(owner, opt) {
  const options = opt || {},
    leads = options.view === 'leads';
  const limit = Math.min(LIST_CAP, Math.max(1, Number(options.limit) || LIST_CAP)),
    page = Math.max(1, Number(options.page) || 1);
  const rawRows = await rows(owner, { stages: leads ? 'always' : false, consent: !!options.consent });
  const assembled = assemble(rawRows, await dues(owner, rawRows.cust, rawRows.sup));
  const parties = assembled.parties.filter((item) => isLead(item) === leads);
  const alerts = markLate(parties, rawRows.country);
  /* G4 (MKT-SRV1): total · page · limit top-level; no ?limit asked = the whole list (CAP), today's answer */
  const shown = parties.slice((page - 1) * limit, page * limit);
  withPrefs(shown, rawRows, options.consent);
  await withUnbilled(shown, owner, options.actor, !!options.blind);
  require('./dues-view').hideParties(shown, options); /* RAIL-146i: after markLate — the flag stands, the purchase figure goes for a blind reader */
  const out = {
    parties: shown,
    walk_ins: leads ? [] : assembled.walk_ins,
    count: parties.length,
    total: parties.length,
    page,
    limit,
    truncated: !!rawRows.truncated,
    alerts
  };
  if (options.consent) out.consent_migrated = !!rawRows.prefs;
  if (leads) out.leads_migrated = !!rawRows.leads_ready;
  return out;
}
/**
 * ⭐ NOT BILLED YET, PER PARTY (CRM-32, walk W41): the list said "Settled" for a party whose order was unpaid but not billed yet. work-rows.unbilledByParty is the ONE
 * test (the Tasks "Billed" tag; Collections, the order sheet and the record use it too) grouped by the order's party — one select read + one marks statement for the
 * whole page, never one per row. Sets `p.unbilled` = { n, minor, currency } (n 0 = none); for a cost-blind reader (RAIL-146e, `blind`) minor is null and cost_hidden:true on any party with an order that is not the reader's sale. Left OFF when the shop has too many copies to read in one go: absent, never a wrong 0.
 */
async function withUnbilled(parties, owner, actor, blind) {
  if (!parties.length) return;
  const by = await require('./work-rows').unbilledByParty({ entity: owner, actor: actor || null, blind });
  if (by)
    parties.forEach((party) => {
      party.unbilled = by.get(String(party.party_id)) || { n: 0, minor: 0, currency: null };
    });
}

/**
 * ⭐ LATE DUES, ONE RULE (M149): a party whose oldest due day is before the shop's today has `dues.overdue = true`; the list's `alerts.dues_overdue` is the count of
 * those same parties — the banner, the Dues filter and the mark on a row all read these, never their own date sum. Mutates the parties; returns the alerts.
 */
function markLate(parties, country) {
  const followups = require('./crm-followups'),
    today = followups.dayOf(new Date().toISOString(), country);
  let index = 0;
  (parties || []).forEach((item) => {
    if (item.dues) {
      item.dues.overdue = Number(item.dues.balance_minor) !== 0 && followups.isLate(item.dues.oldest_due, today);
      if (item.dues.overdue) index++;
    }
  });
  return { dues_overdue: index };
}

/** the rows() options one() asks with: the party, and which extras the caller wants (stages, consent, no e-mail) */
function rowsOptions(party, opt) {
  const asked = opt || {};
  return { party, stages: !!asked.stages, consent: !!asked.consent, noEmail: !!asked.noEmail };
}

/** one party by id, following merged_into to the survivor (at most five hops) → { party, merged_from } or null; `opt.blind` hides purchase money (RAIL-146i) */
async function one(owner, id, opt) {
  let current = String(id),
    from = null;
  for (let count = 0; count < 5; count++) {
    const rawRows = await rows(owner, rowsOptions(current, opt));
    const assembled = assemble(rawRows, await dues(owner, rawRows.cust, rawRows.sup));
    if (assembled.parties.length) {
      markLate(assembled.parties, rawRows.country);
      withPrefs(assembled.parties, rawRows, !!(opt && opt.consent));
      require('./dues-view').hideParties(assembled.parties, opt); /* RAIL-146i */
      return { party: assembled.parties[0], merged_from: from, leads_ready: !!rawRows.leads_ready };
    }
    const next = assembled.folded.get(current);
    if (!next) return null;
    if (!from) from = { party_id: current, party_no: (rawRows.cust.concat(rawRows.sup).find((item) => String(item.party_id) === current) || {}).party_no || null };
    current = next;
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

async function traded(db, owner, party_id, at) {
  if (!UUID.test(String(party_id || '')) || String(party_id) === String(owner)) return null;
  const row = await db.query(
    `UPDATE customer_list SET txn_count = COALESCE(txn_count, 0) + 1, last_txn_at = COALESCE($3::timestamptz, NOW())
      WHERE owner_entity_id = $1 AND customer_identity_id = $2 RETURNING customer_identity_id AS party_id, txn_count, last_txn_at`,
    [owner, party_id, at || null]
  );
  return row.rows[0] || null;
}

/**
 * CRM-246: a cheque RECEIVED from (or issued to) this party that has not cleared is money in flight and posts nothing yet, so dues do not show it — and removing the party would hide whose it is.
 * Asked of the books payment reader (books-store.cheques: received · deposited, or no status row yet), narrowed to the party; a shop without the books tables has no cheques → nothing held.
 * 409 HAS_DUES in words (the code the Remove button already reads); the held cheque is named by its number when it has one.
 */
async function refuseHeldCheque(conn, owner, id) {
  if (!(await require('./schema').hasTable('books_payment'))) return;
  const held = await require('./books-store').cheques(conn, owner, false, 1, id);
  if (!held.length) return;
  const no = held[0].cheque_no ? ' (no. ' + held[0].cheque_no + ')' : '';
  throw require('./crm-followups').bad('A cheque' + no + ' is held for this party and has not cleared. Clear or cancel it before you remove them.', 409, 'HAS_DUES');
}

/**
 * removeParty(owner, id) — "Remove from my parties" (Q10), the ONE remove for a customer AND a supplier row (R8: the Suppliers screen's own
 * hard DELETE is gone). It HIDES both lists' rows — nothing is deleted — and refuses while EITHER side has money open (R10: ₹5,000 owed
 * each way nets to 0 but is not settled). The caller has already answered who may (owner only). 404 NOT_FOUND · 409 HAS_DUES.
 */
async function removeParty(owner, id) {
  const found = await one(owner, id, { noEmail: true });
  if (!found || found.merged_from) throw require('./crm-followups').bad('Not your party.', 404, 'NOT_FOUND');
  const owed = found.party.dues;
  if (owed && owed.open_side) throw require('./crm-followups').bad('There are open dues on this party.', 409, 'HAS_DUES');
  await withEntity(owner, async (conn) => {
    await refuseHeldCheque(conn, owner, id);
    await conn.query(`UPDATE customer_list SET hidden_at = now() WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND hidden_at IS NULL`, [owner, id]);
    await conn.query(`UPDATE supplier_list SET hidden_at = now() WHERE owner_entity_id = $1 AND supplier_entity_id = $2 AND hidden_at IS NULL`, [owner, id]);
  });
  return { party_id: id };
}

module.exports = {
  withUnbilled,
  removeParty,
  isLead,
  markLate,
  CAP: LIST_CAP,
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
  iso: toIso,
  num,
  withEntity,
  trySavepoint,
  traded,
  namedParty
};
