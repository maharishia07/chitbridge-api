/**
 * books-store-parties.js — the shop's customer / supplier lists as the books read them (split out of books-store.js, whose size row may not grow; the SQL text is moved, not changed).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      terms · parties · partyNames · partyOn · partiesOn · chitForFlip · stampConfirmed · supplierByName · partyNoOf · setPartyNo
 * CALLED BY lib/books-store.js (re-exported: every caller still asks the store)
 * FLOW      db handle from withEntity → one statement on customer_list / supplier_list / identities → rows shaped for the caller
 * CARD      16-finance/books-store
 * ⚠️ Nothing here writes journal_entry / journal_line / account_balance / party_item: the ONE journal writer stays lib/books-store.js (tests/books-writer.test.cjs).
 */
'use strict';
const numberOrZero = (value) => (value == null ? 0 : Number(value));

/* ── parties (the customer / supplier lists) ────────────────────────────────────────────────────────────────── */
/** the party's credit terms, from whichever list holds them (a customer's for a sale, a supplier's for a purchase) */
async function terms(db, e, party_id, side) {
  const listTable = side === 'supplier' ? 'supplier_list' : 'customer_list';
  const partyColumn = side === 'supplier' ? 'supplier_entity_id' : 'customer_identity_id';
  const queryResult = await db.query(`SELECT credit_days, credit_limit_minor, party_no FROM ${listTable} WHERE owner_entity_id = $1 AND ${partyColumn} = $2`, [
    e,
    party_id
  ]);
  return queryResult.rows[0] || null;
}
/**
 * the shop's parties (customer list ∪ supplier list) with their numbers, names and terms. PERF1: `ids` (optional) = only these — the parties a
 * page names (a Day book page, the cheques list); the read now starts FROM THE SHOP'S TWO LISTS (owner-indexed) and reaches identities by its key —
 * it started from identities with a WHERE over both outer joins, which read the whole platform's identities for one shop's list.
 */
async function parties(db, e, ids) {
  const some = Array.isArray(ids),
    want = some ? Array.from(new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))).map(String))) : null;
  if (some && !want.length) return [];
  /* M30: on_rail — can this party RECEIVE a chit (an active business, never a minted ~local record, never a shopper)? The one
     question lib/local-identity asks, asked in SQL for the whole list, so a payment knows whether its advice can be SENT or only SHARED. */
  const only = (col) => (some ? ` AND ${col} = ANY($2::uuid[])` : '');
  const queryResult = await db.query(
    `WITH p AS (SELECT customer_identity_id AS id FROM customer_list WHERE owner_entity_id = $1${only('customer_identity_id')}
                                       UNION SELECT supplier_entity_id FROM supplier_list WHERE owner_entity_id = $1${only('supplier_entity_id')})
                            SELECT i.identity_id AS party_id, i.display_name, i.user_id, i.gstn, ${require('./local-identity').onRailSql('i')} AS on_rail,
                                   c.party_no AS c_no, s.party_no AS s_no, c.nickname AS c_nick, s.nickname AS s_nick,
                                   COALESCE(c.legal_name, s.legal_name) AS legal_name, (c.customer_identity_id IS NOT NULL) AS customer,
                                   (s.supplier_entity_id IS NOT NULL) AS supplier, c.credit_days AS c_days, s.credit_days AS s_days,
                                   c.credit_limit_minor AS c_limit, s.credit_limit_minor AS s_limit, COALESCE(c.state_code, s.state_code) AS state_code
                              FROM p JOIN identities i ON i.identity_id = p.id
                              LEFT JOIN customer_list c ON c.owner_entity_id = $1 AND c.customer_identity_id = i.identity_id
                              LEFT JOIN supplier_list s ON s.owner_entity_id = $1 AND s.supplier_entity_id = i.identity_id`,
    some ? [e, want] : [e]
  );
  return queryResult.rows.map((x) => ({
    party_id: x.party_id,
    party_no: x.c_no || x.s_no || null,
    name: x.display_name,
    nickname: x.c_nick || x.s_nick || null,
    legal_name: x.legal_name,
    user_id: x.user_id,
    on_rail: x.on_rail === true,
    customer: x.customer,
    supplier: x.supplier,
    credit_days: x.c_days != null ? x.c_days : x.s_days,
    credit_limit_minor: x.c_limit != null ? numberOrZero(x.c_limit) : x.s_limit != null ? numberOrZero(x.s_limit) : null,
    state_code: x.state_code,
    gstin: x.gstn || null
  }));
}
/** FX1: the names of a few of the shop's own parties (its customer / supplier lists), by id → { id: name } (the revaluation's rows) — one read */
async function partyNames(db, e, ids) {
  const want = Array.from(new Set((ids || []).filter(Boolean).map(String)));
  if (!want.length) return {};
  const queryResult = await db.query(
    `SELECT i.identity_id, i.display_name FROM identities i
                             WHERE i.identity_id = ANY($2::uuid[])
                               AND (EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = $1 AND c.customer_identity_id = i.identity_id)
                                 OR EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = $1 AND s.supplier_entity_id = i.identity_id))`,
    [e, want]
  );
  const out = {};
  queryResult.rows.forEach((x) => {
    out[String(x.identity_id)] = x.display_name || null;
  });
  return out;
}
/** is this id a party of the shop at all — on its customer list, its supplier list, or in its books (`ledgered`: a journal line or a party item names it, so a party taken off a list keeps its history); an id that is none of these is a stranger
 *  ⭐ CRM-247: `customer` / `supplier` mean a LIVE row (lib/party-live: a deleted party's row is hidden_at-stamped), so every door that asks "on a list?" refuses a deleted party exactly as it refuses a stranger.
 *  `removed` = it has list rows and none is live; `ledgered` still says its history exists (reads of history stay). */
async function partyOn(db, e, party_id) {
  /* FIN-58: the shop's system party "UPI waiting" is a party of the shop with no list row (lib/upi-waiting) */
  if (require('./upi-waiting').isWaitingParty(e, party_id)) return { customer: true, supplier: false, ledgered: true, system: 'upi_waiting', removed: false };
  const live = require('./party-live').liveSql;
  const queryResult = await db.query(
    `SELECT EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = $1 AND c.customer_identity_id = $2 AND ${live('c')}) AS customer,
            EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = $1 AND s.supplier_entity_id = $2 AND ${live('s')}) AS supplier,
            (EXISTS (SELECT 1 FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2)
             OR EXISTS (SELECT 1 FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2)) AS listed,
            (EXISTS (SELECT 1 FROM journal_line WHERE entity_id = $1 AND party_id = $2)
             OR EXISTS (SELECT 1 FROM party_item WHERE entity_id = $1 AND party_id = $2)) AS ledgered`,
    [e, party_id]
  );
  const on = queryResult.rows[0];
  if (!on) return { customer: false, supplier: false, ledgered: false, removed: false };
  return { customer: on.customer, supplier: on.supplier, ledgered: on.ledgered, removed: !!on.listed && !on.customer && !on.supplier };
}
/**
 * RAIL-146: partyOn for MANY ids in ONE statement → Map(id → { customer, supplier }). An id on neither list maps to both false; a value that is not a uuid is
 * answered false without being sent (a stub's foreign id would raise 22P02). The chit lists ask it once per page, never per row (lib/cost-view rolesFor).
 */
async function partiesOn(db, e, ids) {
  const UUID = /^[0-9a-f-]{36}$/i;
  const want = Array.from(new Set((ids || []).filter(Boolean).map(String)));
  const out = new Map(want.map((id) => [id, { customer: false, supplier: false }]));
  const asked = want.filter((id) => UUID.test(id));
  if (!asked.length) return out;
  const live = require('./party-live').liveSql; /* review money-02 M7: the same live rule partyOn applies, so a deleted party is not offered as a live one */
  const found = await db.query(
    `SELECT p.id, EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = $1 AND c.customer_identity_id = p.id AND ${live('c')}) AS customer,
                 EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = $1 AND s.supplier_entity_id = p.id AND ${live('s')}) AS supplier
       FROM unnest($2::uuid[]) AS p(id)`,
    [e, asked]
  );
  found.rows.forEach((x) => out.set(String(x.id), { customer: !!x.customer, supplier: !!x.supplier }));
  return out;
}
/** FIN-58: my own counter bill as the flip reads it — its payment parts and currency; null = not a bill of mine */
async function chitForFlip(db, e, chit_id) {
  const found = await db.query(`SELECT h.business_json, d.currency_code FROM chit_header h LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
      WHERE h.entity_id = $1 AND h.chit_id = $2 AND h.sender_entity_id = h.entity_id`, [e, chit_id]);
  return found.rows[0] || null;
}
/** FIN-58: parts[index].confirmed = true (+ confirmed_at) on my copy — a merge-patch of the payment key that sets only the one part, so a concurrent edit of the rest of the chit is never overwritten */
async function stampConfirmed(db, e, chit_id, index, at) {
  await db.query(
    `UPDATE chit_header SET business_json = jsonb_set(COALESCE(business_json, '{}'::jsonb), '{payment}', jsonb_set(jsonb_set((business_json -> 'payment'), ARRAY['parts', $3::text, 'confirmed'], 'true'::jsonb), ARRAY['parts', $3::text, 'confirmed_at'], to_jsonb($4::text)))
      WHERE entity_id = $1 AND chit_id = $2 AND jsonb_typeof(business_json #> ARRAY['payment', 'parts', $3::text]) = 'object'`,
    [e, chit_id, String(index), at]
  );
}
/** the two things a supplier lookup can carry, trimmed: its party number and its typed name (each '' when absent) */
const supplierLookupKeys = (lookup) => ({
  no: lookup && lookup.party_no != null ? String(lookup.party_no).trim() : '',
  text: lookup && lookup.name != null ? String(lookup.name).trim() : ''
});
/**
 * ⭐ STD1 · ONE SUPPLIER-BY-NAME RESOLVER (receiptFacts and bill-use.linkParty both call this; the counter's twin is till.html oneByName).
 * P = { party_no } — that number on MY supplier list; or { name } — a supplier whose name or nickname IS it, trimmed, case aside. Exactly ONE
 * is "known"; two of the same name is nobody (custKnown's rule). By name, the near matches come too: the typed name INSIDE a supplier's name
 * or nickname, a prefix first (the counter's datalist rule), ≤ 3 — names + party_no only, never an amount. ONE statement.
 * → { one: { party_id, name, party_no } | null, near: [{ name, party_no }] }
 */
async function supplierByName(db, e, lookup) {
  const { no, text } = supplierLookupKeys(lookup);
  if (!no && !text) return { one: null, near: [] };
  const like = '%' + text.toLowerCase().replace(/[\\%_]/g, (char) => '\\' + char) + '%';
  const queryResult = no
    ? await db.query(
        `SELECT s.supplier_entity_id AS party_id, i.display_name AS name, s.party_no, true AS exact FROM supplier_list s JOIN identities i ON i.identity_id = s.supplier_entity_id
        WHERE s.owner_entity_id = $1 AND s.party_no = $2 AND ${require('./party-live').liveSql('s')} LIMIT 2`,
        [e, no]
      )
    : await db.query(
        `SELECT s.supplier_entity_id AS party_id, i.display_name AS name, s.party_no,
              (lower(btrim(i.display_name)) = lower($2) OR lower(btrim(COALESCE(s.nickname, ''))) = lower($2)) AS exact
         FROM supplier_list s JOIN identities i ON i.identity_id = s.supplier_entity_id
        WHERE s.owner_entity_id = $1 AND ${require('./party-live').liveSql('s')} AND (lower(btrim(i.display_name)) = lower($2) OR lower(btrim(COALESCE(s.nickname, ''))) = lower($2)
                                          OR lower(i.display_name) LIKE $3 OR lower(COALESCE(s.nickname, '')) LIKE $3)
        ORDER BY 4 DESC, (lower(btrim(i.display_name)) LIKE $4) DESC, i.display_name LIMIT 5`,
        [e, text, like, like.slice(1)]
      );
  return supplierAnswer(queryResult.rows || [], no);
}
/** the resolver's answer from the rows read: `one` when exactly one row is an exact match, else (by name only) up to three near matches */
function supplierAnswer(rows, no) {
  const exact = rows.filter((x) => x.exact);
  const knownSupplier =
    exact.length === 1 ? { party_id: String(exact[0].party_id), name: String(exact[0].name || ''), party_no: exact[0].party_no || null } : null;
  return {
    one: knownSupplier,
    near:
      knownSupplier || no
        ? []
        : rows
            .filter((x) => x.name)
            .slice(0, 3)
            .map((x) => ({ name: String(x.name), party_no: x.party_no || null }))
  };
}
/** a party number, once: the same identity on both lists keeps one number (one series per shop) */
async function partyNoOf(db, e, party_id) {
  const queryResult = await db.query(
    `SELECT COALESCE((SELECT party_no FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2),
                                            (SELECT party_no FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = $2)) AS no`,
    [e, party_id]
  );
  return queryResult.rows[0] ? queryResult.rows[0].no : null;
}
async function setPartyNo(db, e, party_id, no) {
  await db.query(`UPDATE customer_list SET party_no = $3 WHERE owner_entity_id = $1 AND customer_identity_id = $2 AND party_no IS NULL`, [e, party_id, no]);
  await db.query(`UPDATE supplier_list SET party_no = $3 WHERE owner_entity_id = $1 AND supplier_entity_id = $2 AND party_no IS NULL`, [e, party_id, no]);
}


module.exports = { terms, parties, partyNames, partyOn, partiesOn, chitForFlip, stampConfirmed, supplierByName, partyNoOf, setPartyNo };
