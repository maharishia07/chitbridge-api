/* ⭐ Every kind of id, its shape and which of them may be sent to: docs/NAMESPACE.md, with the
   machine-checked table in docs/namespace.yaml (guard: tests/namespace.test.cjs). */
/**
 * ── lib/local-identity.js · AN ID FOR SOMEONE WHO NEVER REGISTERED ─────────────────────────────────────────────
 *
 * Athi, 2026-09-10, in two goes, and the second one is the design:
 *
 *   *"Still we need the user id, so we can attach item and so on against that id. We create id internally, so the
 *   existing mechanism will not break."*
 *
 *   *"Follow the existing path. Only thing is he is not a recipient — so you can't bring him to the rail or
 *   something. Otherwise for all practical purposes he is a bridge user. If you want, mark the user id as some
 *   char prefixed with the entity id and then some marker, so we can identify — like our customer and so on."*
 *
 * ⭐⭐⭐ BOTH CORRECTIONS POINT THE SAME WAY, AND MY FIRST TWO ATTEMPTS WENT THE OTHER WAY. I tried a NULL
 * `supplier_entity_id`, then a new `identity_type = 'local'`. Each made the local supplier a special case, and a
 * special case has to be handled everywhere: adoption resolves a supplier by id, a purchase attaches by id, spend
 * groups by id, every screen shows a bridge id. One special case means a null branch or a type check in every one
 * of those, forever, and every branch is a place the next query forgets to look.
 *
 * ⭐ THE CORNER HARDWARE SHOP IS JUST AN ENTITY. Same table, same identity_type, same bridge id, same joins.
 * Nothing downstream changes at all. What marks him is his HANDLE — `~acmetraders.corner-hardware` — and the `~`
 * carries the single real difference: he never registered, so he can never be reached.
 *
 * ⚠️ AND THE MARKER COSTS NO MIGRATION. `identities` already has a unique index on lower(user_id), so embedding
 * the owner in the handle makes "one Corner Hardware per shop" fall out of an index that exists — while two
 * different shops may each have their own, which they must. The grammar is in lib/handle.js with the other three.
 *
 * ── ⚠️⚠️ "HE IS NOT A RECIPIENT" ──────────────────────────────────────────────────────────────────────────────
 * A chit addressed to someone who cannot sign in would sit as sent for ever, with the sender waiting on an answer
 * that cannot come. Enforcement is NOT in this file — minting is not where that decision belongs. It is at each
 * path that turns a typed identifier into a counterparty (recipient resolution, business search, adding a supplier
 * or customer), each asking handle.isMinted(). This file only makes the mark; those files honour it.
 *
 * ⚠️ AND HE DOES NOT BECOME A REAL ACCOUNT LATER. Athi: *"never migrate offline to on-line — the bridge id may be
 * different and it will be chaos"*, softened to *"if there are opportunity and if we foresee no issues then we can
 * allow, but not now"*, with the shape already settled: *"debit the older one and credit the new one."* A transfer
 * entry between two ids that both keep existing — which having minted a real id is what makes possible.
 *
 * owns: minting a local (never-registered) party and the one add-customer sequence (addCustomer, by phone first — R7)
 * called by: routes/crm.js · routes/relationships.js · lib/move-in.js · routes/suppliers
 * FLOW  addCustomer → customerByPhone() [exists] → mint() → customer_list row → contact → party number
 * // CARD 11-crm-and-marketing/local-identity
 */
'use strict';
const { shopCountrySql } = require('./country-setup');   /* GOV-AU1 #164 · STD2: the owning shop's country, one fragment */
const genBridge = require('./bridgeid').generateBridgeId;
const handle = require('./handle');

/**
 * ⭐⭐ FIND OR MINT. Recording a fourth purchase from "Corner Hardware" must land on the SAME id, or the spend
 * figure splits across rows nobody adds up — the same reason lib/supply-store.ensure() exists for supply items.
 *
 * ⚠️ IT LOOKS FIRST *AND* LEANS ON THE UNIQUE INDEX, deliberately. The SELECT answers the ordinary case; the index
 * is the only thing that stops two tills recording the same purchase at the same instant from minting two
 * suppliers, because both would pass a check-then-insert.
 *
 * @param owner      the minting entity's identity_id
 * @param ownerHandle its user_id — or its bridge_id, for an entity registered before user_ids existed
 * @returns {{identity_id, bridge_id, display_name, user_id, created}} or {{error, status}}
 */
async function mint(owner, name, deps) {
  const d = deps || {};
  const query = d.query || require('../db').query;
  const clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
  if (!clean) return { status: 400, error: { error: 'Invalid', message: 'Give the supplier a name' } };
  if (clean.length > 120) return { status: 400, error: { error: 'Invalid', message: 'That name is too long' } };
  /* ⚠️ A NAME THAT IS ACTUALLY AN IDENTIFIER is almost always the wrong field. Someone pastes a real business's
     email into "name" and silently gets a private lookalike: it says added, then the catalogue never loads and
     orders cannot be sent, with nothing anywhere explaining why. */
  if (clean.indexOf('@') >= 0)
    return { status: 400, error: { error: 'Invalid',
      message: 'That looks like an email. Add them as a ChitBridge business, or type their name instead.' } };

  const kind = d.kind || 'sup';

  /* the owner's own handle — the minted id hangs from it, and it is what makes the id specific to this business */
  let ownerHandle = d.ownerHandle;
  if (!ownerHandle) {
    const me = await query(`SELECT user_id, bridge_id FROM identities WHERE identity_id = $1`, [owner]);
    ownerHandle = (me.rows[0] && (me.rows[0].user_id || me.rows[0].bridge_id)) || '';
  }
  const prefix = handle.mintedPrefix(ownerHandle, kind);

  /**
   * ⭐⭐ THE SAME SHOP TWICE MUST BE THE SAME ROW — matched on the NAME, because the handle is now a number and
   * can no longer answer this. Recording a fourth purchase from "Corner Hardware" has to land on the id the first
   * three did, or the spend figure splits across rows nobody adds up and nothing on screen says so.
   * ⚠️ Scoped by the KIND prefix as well as the parent, or a customer and a supplier who share a name — a shop
   * that both buys from and sells to the same trader, which is ordinary — would collapse into one record.
   */
  const found = await query(
    `SELECT identity_id, bridge_id, display_name, user_id FROM identities
      WHERE parent_entity_id = $1 AND user_id LIKE $2 AND lower(btrim(display_name)) = $3
      LIMIT 1`, [owner, prefix + '%', fold(clean)]);
  if (found.rows.length) return Object.assign({ created: false }, found.rows[0]);

  /**
   * ⭐ THE NEXT NUMBER IS AN ORDINAL, NOT A COUNT — max + 1, never rows + 1. With 0001 and 0003 present the next
   * is 0004; a count would hand out 0003 again and attach a new supplier to a removed one's purchase history.
   * ⚠️ Two writers can read the same max. That is what the retry below is for — the unique index on lower(user_id)
   * is the authority, and losing the race is a normal outcome, not an error.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    /* ⚠️ LENGTH FIRST. The number is zero-padded to four, so plain text ordering is right up to 9999 and wrong
       the moment it widens — '10000' sorts before '9999' and the counter would silently restart. */
    const top = await query(
      `SELECT user_id FROM identities WHERE user_id LIKE $1
        ORDER BY length(user_id) DESC, user_id DESC LIMIT 1`, [prefix + '%']);
    const last = top.rows[0] ? (handle.mintedParts(top.rows[0].user_id) || {}).n || 0 : 0;
    const h = handle.minted(ownerHandle, kind, last + 1 + attempt);
    if (h.error) return { status: 400, error: { error: 'Invalid', message: h.error } };
    try {
      /* ⭐ THE EXISTING PATH, with nothing special about it: identity_type 'entity', active, its own bridge id.
         ⚠️ No email and no password — there is no account to sign in to, and giving it either would create one. */
      const r = await query(
        `INSERT INTO identities (bridge_id, display_name, user_id, identity_type, parent_entity_id, status, created_by, entity_kind, country)
         VALUES ($1, $2, $3, 'entity', $4, 'active', $4, 'supplier', ${shopCountrySql(4)})
         RETURNING identity_id, bridge_id, display_name, user_id`,
        [genBridge(), clean, h.handle, owner]);
      return Object.assign({ created: true }, r.rows[0]);
    } catch (e) {
      if (!(e && e.code === '23505')) throw e;
      /* ⚠️ TWO CONSTRAINTS CAN RAISE THIS, and they mean opposite things. The NAME index means the other writer
         already created this very supplier — their row is the answer. The HANDLE index means they merely took the
         number we wanted — try the next one. Telling them apart matters: retrying a name clash would loop, and
         returning someone else's row on a number clash would return the wrong supplier entirely. */
      const dup = await query(
        `SELECT identity_id, bridge_id, display_name, user_id FROM identities
          WHERE parent_entity_id = $1 AND user_id LIKE $2 AND lower(btrim(display_name)) = $3 LIMIT 1`,
        [owner, prefix + '%', fold(clean)]);
      if (dup.rows.length) return Object.assign({ created: false }, dup.rows[0]);
    }
  }
  return { status: 409, error: { error: 'Busy',
    message: 'Could not allocate an ID for ' + clean + '. Try once more.' } };
}

/**
 * mintMany(owner, names, deps) → { rows } — mint() for a LIST (L3: a CSV of leads), the SAME rules in FOUR statements, never one per name:
 * the owner's handle · the names already minted under this kind · the top number · ONE multi-row insert. rows[i] answers names[i]:
 *   { created, identity_id, bridge_id, display_name, user_id }  or  { error: <why, in words> }  (an empty, over-long or email-shaped name)
 * The same name twice in the list is ONE row (the second finds the first — mint's "same shop twice" rule). ⚠️ A handle clash (two writers took
 * the same numbers) is answered { status: 409, error } for the WHOLE call, not retried: the caller holds a transaction, so the retry is theirs.
 */
async function mintMany(owner, names, deps) {
  const d = deps || {};
  const query = d.query || require('../db').query;
  const kind = d.kind || 'sup';
  const rows = (names || []).map((item) => {
    const clean = String(item == null ? '' : item).trim().replace(/\s+/g, ' ');
    if (!clean) return { error: 'Give them a name' };
    if (clean.length > 120) return { error: 'That name is too long' };
    if (clean.indexOf('@') >= 0) return { error: 'That looks like an email. Add them as a ChitBridge business, or type their name instead.' };
    return { clean };
  });
  let ownerHandle = d.ownerHandle;
  if (!ownerHandle) {
    const me = await query(`SELECT user_id, bridge_id FROM identities WHERE identity_id = $1`, [owner]);
    ownerHandle = (me.rows[0] && (me.rows[0].user_id || me.rows[0].bridge_id)) || '';
  }
  const prefix = handle.mintedPrefix(ownerHandle, kind);
  const want = rows.filter((item) => item.clean);
  if (!want.length) return { rows };
  const found = await query(
    `SELECT identity_id, bridge_id, display_name, user_id FROM identities
      WHERE parent_entity_id = $1 AND user_id LIKE $2 AND lower(btrim(display_name)) = ANY($3::text[])`, [owner, prefix + '%', want.map((item) => fold(item.clean))]);
  const have = new Map(found.rows.map((item) => [fold(item.display_name), item]));
  const top = await query(`SELECT user_id FROM identities WHERE user_id LIKE $1 ORDER BY length(user_id) DESC, user_id DESC LIMIT 1`, [prefix + '%']);
  let last = top.rows[0] ? (handle.mintedParts(top.rows[0].user_id) || {}).n || 0 : 0;
  const seen = new Map(), fresh = [];
  for (const r of want) {
    const k = fold(r.clean);
    if (have.has(k)) { Object.assign(r, { created: false }, have.get(k)); continue; }
    if (seen.has(k)) { r.sameAs = k; continue; }
    const h = handle.minted(ownerHandle, kind, ++last);
    if (h.error) { r.error = h.error; continue; }
    r.user_id = h.handle; r.bridge_id = genBridge(); r.display_name = r.clean; r.created = true;
    seen.set(k, r); fresh.push(r);
  }
  if (fresh.length) {
    let ins;
    try {
      /* the same columns and constants as mint(): identity_type 'entity', active, its own bridge id, no email and no password */
      ins = await query(
        `INSERT INTO identities (bridge_id, display_name, user_id, identity_type, parent_entity_id, status, created_by, entity_kind, country)
         SELECT v.b, v.n, v.u, 'entity', $1, 'active', $1, 'supplier', ${shopCountrySql(1)} FROM unnest($2::text[], $3::text[], $4::text[]) AS v(b, n, u)
         RETURNING identity_id, bridge_id, display_name, user_id`,
        [owner, fresh.map((item) => item.bridge_id), fresh.map((item) => item.display_name), fresh.map((item) => item.user_id)]);
    } catch (e) {
      if (!(e && e.code === '23505')) throw e;
      return { status: 409, error: { error: 'Busy', message: 'Could not allocate IDs for the list. Try once more.' } };
    }
    const byHandle = new Map(ins.rows.map((item) => [String(item.user_id).toLowerCase(), item]));
    fresh.forEach((item) => { const got = byHandle.get(item.user_id.toLowerCase()); if (got) item.identity_id = got.identity_id; });
  }
  const pick = (r) => ({ created: !!r.created, identity_id: r.identity_id, bridge_id: r.bridge_id, display_name: r.display_name, user_id: r.user_id });
  return { rows: rows.map((item) => (item.error ? { error: item.error } : item.sameAs ? Object.assign(pick(seen.get(item.sameAs)), { created: false }) : pick(item))) };
}

/** the lookup key for "same supplier, typed differently" — must fold exactly as the b218 index does */
function fold(name) { return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase(); }

/** ⭐ the one question a screen asks: can I call them, or only write down what I bought? */
function onRail(row) { return !!row && !handle.isMinted(row.user_id); }

/**
 * ⭐⭐ THE SAME QUESTION, ASKED IN SQL, for a read that answers it for a whole list (the counter's snapshot) and for the
 * gate that checks the counter's answer (routes/chits.js, the till key). A party who can RECEIVE a chit: an active
 * business entity — never a minted local record (`~` handle, above), never a storefront shopper (an OTP buyer, or the
 * lightweight 'shopper' entity a network order creates), who has no Intake to accept or dispute anything in.
 * `a` is the alias of the identities row. (The two-sided counter bill, 2026-10-01.)
 */
function onRailSql(a) {
  return `(${a}.identity_type = 'entity' AND ${a}.status = 'active' AND COALESCE(${a}.user_id, '') NOT LIKE '~%'`
       + ` AND COALESCE(to_jsonb(${a})->>'entity_kind', '') <> 'shopper')`;
}

/**
 * ⭐⭐ THE ONE "MAY THIS PARTY TRADE WITH ME?" — onRail + population, in one place (CB CRM, BRIDGE.md §2).
 * The test was split three ways (tillMaySend, till.js's snapshot, the add routes); each now asks here. The SQL is
 * lib/istest's (b249's rule, held to the migration by tests/may-trade.test.cjs) — this wraps it, never copies it.
 *   mayTrade(owner, party, db?) → { ok: true } | { ok: false, why, say }
 *   why: 'local' · 'inactive' · 'shopper' · 'other_population' · 'unknown'   say: the sentence a person reads
 * mayTradeSql(a, me) is the same question for a whole list (a = the other party's identities alias, me = this shop's id).
 */
/**
 * verdict(row) — the words for one party's answer. `row` carries what the SQL above says about them: on_rail, same_world,
 * user_id, status, display_name (+ theirs / mine, the two sandboxes, for the sentence). Pure: the single-party question
 * (istest.mayTrade) and a whole list (the CRM's read) both read their rows through here, so the reasons never drift.
 */
function verdict(row) {
  if (!row) return { ok: false, why: 'unknown', say: 'not found on ChitBridge' };
  const name = row.display_name || 'This business';
  if (!row.on_rail) {
    if (handle.isMinted(row.user_id)) return { ok: false, why: 'local', say: name + ' is not on ChitBridge' };
    if (String(row.status || '') !== 'active') return { ok: false, why: 'inactive', say: name + ' is no longer active on ChitBridge' };
    return { ok: false, why: 'shopper', say: name + ' cannot receive chits on ChitBridge' };
  }
  if (!row.same_world) return { ok: false, why: 'other_population', say: name + ' is in the ' + row.theirs + ' sandbox and this shop is in ' + row.mine };
  return { ok: true };
}
async function mayTrade(owner, party, db) {
  const v = await require('./istest').mayTrade(owner, party, db);
  return v && v.ok ? { ok: true } : { ok: false, why: (v && v.code) || 'unknown', say: v && v.why };
}
function mayTradeSql(a, me) { return require('./istest').mayTradeSql(a, me); }

/**
 * phoneOf(raw) → { phone } (null when none was given) · { bad: true } — ⭐ THE ONE PHONE CHECK for a party (CRM-MINT1, 14 Oct).
 * It is the reward engine's own holderOf (≥ 8 digits, + kept), so the phone a customer is added with is the same key their
 * points sit under. The manual add kept its own 6–20 check and the import its own; a number one door accepted another refused.
 */
function phoneOf(raw) {
  if (!String(raw == null ? '' : raw).trim()) return { phone: null };
  const h = require('./rewards').holderOf({ phone: raw });
  return h && h.scheme === 'phone' ? { phone: h.value } : { bad: true };
}

/** R7: the customer on this shop's list whose phone or sign-in contact is this number (same last 9 digits) → { identity_id, display_name, user_id } | null */
async function customerByPhone(conn, owner, phone) {
  const { phoneMatchKey, phoneTailSql } = require('./stores'), key = phoneMatchKey(phone);
  if (!key) return null;
  const found = await conn.query(`SELECT i.identity_id, i.display_name, i.user_id FROM customer_list cl JOIN identities i ON i.identity_id = cl.customer_identity_id
                            WHERE cl.owner_entity_id = $1 AND $2 IN (${phoneTailSql('i.phone')}, ${phoneTailSql('i.otp_contact')}) ORDER BY i.created_at LIMIT 1`, [owner, key]);
  return found.rows[0] || null;
}

/** the sentence for an add that found the customer already there — by phone it names who has the number; `byName` is the caller's own words for a name match */
function existsWords(added, byName) {
  return added.by === 'phone' ? 'That phone number is already on your list as ' + added.local.display_name + '.' : byName;
}

/**
 * ── ⭐⭐ addCustomer(h, owner, c) — A LOCAL CUSTOMER, THE ONE WAY (CRM-MINT1, 14 Oct) ─────────────────────────────────────
 * The add-customer sequence was copied four times (CRM lead · walk-in → party · Relationships "+ customer" · the move-in import):
 * mint (kind 'cus') · the contact · the customer_list row · the party number. Here once, on the CALLER'S transaction (h = the
 * withEntity handle), so a refusal anywhere leaves nothing behind.
 *   c = { name, phone?, gstin?, email?, via: 'manual' | 'lead' | 'import' (the move-in — b227/b297 allow no 'move_in'), number?: false to leave numbering to a later PF.patch }
 *   phone must already have passed phoneOf.
 * → { local, customer_list_id, party_no } · { refused: { status, error } } (the mint said no) · { exists: true, local } (on the list)
 * ⚠️ the contact is written only for a row NEW to the list, and only into empty slots (COALESCE) — never over what is there.
 */
async function addCustomer(h, owner, c) {
  const same = await customerByPhone(h, owner, c.phone);
  if (same) return { exists: true, local: same, by: 'phone' };   /* R7: one phone is one customer — dues, points and consent stay on the one record */
  const local = await mint(owner, c.name, { query: h.query.bind(h), kind: 'cus' });
  if (local.error) return { refused: local };
  const ins = await h.query(
    `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
     VALUES ($1, $2, 'entity', $3, 0, NULL) ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_list_id`,
    [owner, local.identity_id, c.via || 'manual']);
  if (!ins.rows.length) return { exists: true, local };
  if (c.phone || c.gstin || c.email)
    await h.query(`UPDATE identities SET otp_contact = COALESCE(otp_contact, $2), gstn = COALESCE(gstn, $3), email = COALESCE(email, $5)
                    WHERE identity_id = $1 AND parent_entity_id = $4`, [local.identity_id, c.phone || null, c.gstin || null, owner, c.email || null]);
  /* before b272 there is no number series — the customer still lands (a savepoint, as every caller did) */
  const party_no = c.number === false ? null
    : await require('../db').trySavepoint(h, () => require('./party-fields').ensureNo(h, owner, local.identity_id), null);
  return { local, customer_list_id: ins.rows[0].customer_list_id, party_no };
}

module.exports = { mint, mintMany, fold, onRail, onRailSql, mayTrade, mayTradeSql, verdict, phoneOf, addCustomer, existsWords };
