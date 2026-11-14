// @stage tested
// CALLED BY lib/crm-leads.js, lib/crm.js, lib/move-in.js, routes/relationships.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// OWNS      the party fields on the customer and supplier lists, their contact (phone, e-mail) and tax ids.
// FLOW      clean → check → write (one transaction) → change log
// CARD      11-crm-and-marketing/parties-one-record-timeline-interactions
// @stage-note [BOOKS v2] The party fields on the customer and supplier lists (b274): legal name, nickname, party number,
// @stage-note credit days/limit, state, tax ids with the duplicate check, merged-into — each change to the change log.
'use strict';
/**
 * lib/party-fields.js — A PARTY IS NOT A NEW LIST (SPEC-books-v2 §1, research §6.1).
 *
 * ⭐ Every counterparty is already an identity held in customer_list and/or supplier_list; these are the fields a
 *   ledger needs on those rows. routes/relationships.js PATCH /customers/:id and /suppliers/:id call patch(); the
 *   lists call decorate() for party no · balance · oldest due.
 * ⭐ PARTY NUMBERS: one series per shop across both lists (books_counter 'P'), assigned ONCE, never reused, the same
 *   number on both lists when a party is both (SAP/Odoo/Xero display number; the key stays the identity id).
 * ⚠️ BEFORE b274 RUNS the columns do not exist: patch() answers 409 "not migrated", decorate() returns the rows as they
 *   were. Nothing on the lists breaks because the ledger is not there yet.
 * ⚠️ A GSTIN (any scheme,value) on two parties of one shop is REFUSED with the other party's name — the duplicate-party
 *   fault the research names; merging is a deliberate act (merged_into), never a silent one.
 */
const { waiting } = require('./not-migrated');
const booksStore = require('./books-store');
const logger = require('./logger');
const booksEngines = require('./books-engines');
function trySavepoint(db, fn, fallback) {
  return require('../db').trySavepoint(db, fn, fallback);
}

const SIDES = {
  customer: { table: 'customer_list', idCol: 'customer_list_id', partyCol: 'customer_identity_id' },
  supplier: { table: 'supplier_list', idCol: 'supplier_list_id', partyCol: 'supplier_entity_id' }
};
const SCHEMES = ['GSTIN', 'PAN', 'TAN', 'TRN', 'VAT', 'TIN', 'CIN', 'UDYAM', 'ABN']; /* CS2: ABN (Australia) */
const DUPLICATE_PARTY = 'Another party already has this tax id.';
function badRequest(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  return e;
}
/**
 * ⭐ CS2: the FORMAT check a scheme's own pack makes — reg-au `abn.check` (11 digits, modulus 89) and reg-ae `trn.check` (15 digits, no published check digit) — reused,
 * never copied: the pack's `why` is the refusal, the pack's normalised digits are what is stored. A scheme with no pack check is stored as typed (upper, no spaces).
 */
const TAX_ID_CHECK = {
  ABN: (v) => {
    const r = require('./reg-au').abn.check(v);
    return { ok: r.ok, why: r.why, value: r.abn };
  },
  TRN: (v) => {
    const r = require('./reg-ae').trn.check(v);
    return { ok: r.ok, why: r.why, value: r.trn };
  },
  /* CX4 (R1): India's GSTIN through the one check the shop's own GSTIN already passes (profile-map.gstinChecksum, as country-setup) — same words */
  GSTIN: (value) => {
    const checksum = require('./profile-map').gstinChecksum(value);
    return {
      ok: checksum.ok,
      value: value,
      why:
        checksum.reason === 'format'
          ? 'that does not look like a GSTIN (15 characters, e.g. 33AAAAA0000A1Z5).'
          : 'that GSTIN does not check out — look at the last character.'
    };
  }
};

/* the column identities.gstn is varchar(15): every tax id this app knows (GSTIN 15, ABN 11, TRN 15) fits; a longer one was a 500 from the database */
const TAX_ID_MAX = 15;
const TAX_ID_SHAPE = /^[A-Z0-9][A-Z0-9./-]*$/;
/**
 * doorTaxId(raw, country) → { value } (null = none given) | { why } — CRM-244, the tax id typed on the customer door (POST /customers).
 * ALWAYS bounded: no spaces, upper case, letters · digits · . / - only, at most TAX_ID_MAX. The country's own pack check (profile.taxIdRefusal: a GSTIN checksum, an ABN, a TRN) runs ONLY
 * for a country the caller STATED — an unknown country is never defaulted to the shop's (an AU shop's UAE customer with a valid TRN would be refused by the AU rule).
 */
function doorTaxId(typed, country) {
  const value = String(typed == null ? '' : typed).replace(/\s+/g, '').toUpperCase();
  if (!value) return { value: null };
  if (value.length > TAX_ID_MAX || !TAX_ID_SHAPE.test(value)) return { why: 'That tax number does not look right: up to ' + TAX_ID_MAX + ' letters and digits, no spaces.' };
  const stated = String(country == null ? '' : country).trim().toUpperCase();
  const refused = stated ? require('./profile').taxIdRefusal(stated, value) : null;
  return refused ? { why: refused.why } : { value };
}

/** CRM-46: a text as typed, trimmed and single-spaced; null when blank; a text too long to store is refused by name, never cut in silence */
function storedText(value, maxLength, what) {
  const text = value == null ? '' : String(value).trim().replace(/s+/g, ' ');
  if (text.length > maxLength) throw badRequest(what + ' is at most ' + maxLength + ' characters.');
  return text || null;
}
/** CRM-46: a whole number as the column holds it (a numeric string reads as its number); 2.7 is refused as not whole, true and "abc" as not a number (the field's own words), never rounded */
function wholeNumber(value, what, notANumberWords) {
  const number = typeof value === 'boolean' ? NaN : Number(value);
  if (Number.isNaN(number)) throw badRequest(notANumberWords);
  if (!Number.isInteger(number)) throw badRequest(what + ' is a whole number.');
  return number;
}
const CREDIT_DAYS_WORDS = 'Credit days is a number of days, 0 or more.';
const CREDIT_LIMIT_WORDS = 'A credit limit is an amount, 0 or more.';
const isBlank = (value) => value === null || value === '';
function creditDaysOf(value) {
  const days = isBlank(value) ? null : wholeNumber(value, 'Credit days', CREDIT_DAYS_WORDS);
  if (days !== null && !(days >= 0 && days <= 3650)) throw badRequest(CREDIT_DAYS_WORDS);
  return days;
}
/**
 * the credit limit in minor units. CRM-47: the two keys are one limit, so both in one body is refused by name (the second was ignored).
 * A limit typed in rupees becomes minor units through money.round (the one rounder), never a local copy of the rule.
 */
function creditLimitMinorOf(body) {
  if ('credit_limit_minor' in body && 'credit_limit' in body) throw badRequest('Send credit_limit_minor or credit_limit, not both: they are one limit.');
  const inMinor = 'credit_limit_minor' in body;
  const value = inMinor ? body.credit_limit_minor : body.credit_limit;
  const minor = isBlank(value) ? null : inMinor ? wholeNumber(value, 'A credit limit in minor units', CREDIT_LIMIT_WORDS) : Math.round(require('./money').round(Number(value)) * 100);
  if (minor !== null && !(minor >= 0)) throw badRequest(CREDIT_LIMIT_WORDS);
  return minor;
}
function stateCodeOf(value) {
  const text = storedText(value, 8, 'The state code');
  if (text && !/^[0-9A-Z-]{1,8}$/i.test(text)) throw badRequest('State code looks wrong.');
  return text ? text.toUpperCase() : null;
}
function mergedIntoOf(value) {
  const partyId = value ? String(value) : null;
  if (partyId && !require('./trace').UUID_RE.test(partyId)) throw badRequest('merged_into is a party id.');
  return partyId;
}

/** what may be set, cleaned — or a refusal in words */
function clean(side, body) {
  const out = {};
  if ('legal_name' in body) out.legal_name = storedText(body.legal_name, 200, 'The legal name');
  if (side === 'customer' && 'nickname' in body) out.nickname = storedText(body.nickname, 80, 'The nickname');
  if ('credit_days' in body) out.credit_days = creditDaysOf(body.credit_days);
  if ('credit_limit_minor' in body || 'credit_limit' in body) out.credit_limit_minor = creditLimitMinorOf(body);
  if ('state_code' in body) out.state_code = stateCodeOf(body.state_code);
  if ('merged_into' in body) out.merged_into = mergedIntoOf(body.merged_into);
  return out;
}
const BAD_EMAIL = 'That e-mail address does not look right. Write it like name@shop.com.';
const BAD_PHONE = 'That phone number does not look right. Write the digits, with the country code if it has one.';
const NOT_YOURS = 'That is their own ChitBridge business. Their phone and e-mail are theirs to change, not yours.';
const EMAIL_NOT_READY = 'E-mails cannot be saved on contacts just yet. Try again after the next update.';
/* CRM-42: name@host.tld - no space or second @, each host label non-empty (the escapes were lost once and every "s" was refused) */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
/**
 * cleanContact(body) -> { phone?, email? } - the contact a shop writes for a party it keeps (R14, 24 Oct). A sent key is cleaned or refused in
 * words; null / empty means "clear it". The phone goes through local-identity.phoneOf, the ONE phone check; the e-mail is lower-cased and shape-checked.
 */
function cleanContact(sent) {
  const out = {};
  if ('phone' in sent) {
    const checked = require('./local-identity').phoneOf(sent.phone);
    if (checked.bad) throw badRequest(BAD_PHONE);
    out.phone = checked.phone;
  }
  if ('email' in sent) {
    const text = sent.email == null ? '' : String(sent.email).trim().toLowerCase();
    if (text && (text.length > 254 || !EMAIL_SHAPE.test(text))) throw badRequest(BAD_EMAIL);
    out.email = text || null;
  }
  return out;
}
/** CTR-174: a PIN / ZIP / postcode is 3 to 10 letters, digits, spaces or hyphens with at least one digit (560001 · 2000 · SW1A 1AA); the country's own pattern is not asked here, only that it reads as a code */
const POSTCODE_SHAPE = /^(?=.*[0-9])[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/;
const BAD_POSTCODE = 'That PIN or postcode does not look right. Write the digits, up to 10 characters.';
/**
 * shopHeaderWhy(body, before) -> { field, words } | null - CTR-174, the shop's own header typed at the counter (POST /api/till/shop): the e-mail and the phone through cleanContact (the ONE contact check,
 * same words as a party's), the PIN / ZIP through POSTCODE_SHAPE. A blank is not checked (it clears nothing, the door ignores it); the first field at fault answers.
 */
const trimmed = (value) => String(value == null ? '' : value).trim();
/** one header field typed on a till: { field, words } when its e-mail or phone does not read right (the one contact check), else null */
function contactWhy(field, value) {
  try {
    cleanContact({ [field]: value });
    return null;
  } catch (refused) {
    return { field, words: refused.message };
  }
}
function shopHeaderWhy(body, before) {
  const sent = body || {};
  const stored = before || {};
  /* the till dialog prefills from the stored shop and re-posts every box: a value that still equals what is stored is not new and is not judged (an old junk value must not block fixing the tax number) */
  const judged = (field) => trimmed(sent[field]) !== '' && trimmed(sent[field]) !== trimmed(stored[field]);
  const contact = ['email', 'phone'].filter(judged).map((field) => contactWhy(field, sent[field])).find(Boolean);
  if (contact) return contact;
  return judged('pincode') && !POSTCODE_SHAPE.test(trimmed(sent.pincode)) ? { field: 'pincode', words: BAD_POSTCODE } : null;
}
/**
 * ⭐ SEC-130 · refuseOwnDuplicate(db, owner, partyId, email): when ANOTHER party of THIS shop already carries the e-mail, the owner is told so in words that
 * name that party (their own list, read under the shop's RLS, nothing a stranger can reach). Since the e-mail lives in party_contact (not unique, per shop)
 * no holder outside the shop exists to be told about, so the answer cannot vary with who else uses the address. Asked BEFORE the write.
 * (P2 for Athi: a household or an accountant may share one address; refusing is kept as #917 shipped it until he decides.)
 */
async function refuseOwnDuplicate(db, owner, partyId, email) {
  const mine = (await require('./party-contact').sharedWith(db, owner, partyId, email))[0];
  if (mine) throw badRequest('Another contact of yours, ' + (mine.display_name || 'one of your parties') + ', already has this e-mail address. Use another, or leave it empty.', 409);
}
/** write one cleaned contact key: the phone stays on identities.otp_contact, the e-mail goes to the ONE writer (party_contact) */
async function writeContactKey(db, owner, partyId, key, value) {
  if (key === 'phone') return db.query(`UPDATE identities SET otp_contact = $2 WHERE identity_id = $1`, [partyId, value]);
  if (value) await refuseOwnDuplicate(db, owner, partyId, value);
  if (!(await require('./party-contact').set(db, owner, partyId, value))) throw badRequest(EMAIL_NOT_READY, 409);
}
/**
 * saveContact(db, owner, partyId, contact) -> [{ field, old, new }] for what changed. Home: identities.otp_contact (phone) and party_contact (e-mail,
 * lib/party-contact.js, the shop's own contact data - never a sign-in). Only a party THIS shop minted (parent_entity_id = owner): a real
 * ChitBridge business keeps its own contact.
 */
async function saveContact(db, owner, partyId, contact) {
  const keys = Object.keys(contact);
  if (!keys.length) return [];
  const partyContact = require('./party-contact');
  const current = (
    await db.query(`SELECT i.otp_contact, ${partyContact.emailSql('i', '$2', await partyContact.ready())} AS email, i.parent_entity_id FROM identities i WHERE i.identity_id = $1`, [partyId, owner])
  ).rows[0];
  if (!current || String(current.parent_entity_id) !== String(owner)) throw badRequest(NOT_YOURS, 403);
  const before = { phone: current.otp_contact, email: require('./resolveuserid').realEmail(current.email) };
  const unchanged = (key) => String(before[key] == null ? '' : before[key]) === String(contact[key] == null ? '' : contact[key]);
  const todo = keys.filter((key) => !unchanged(key));
  for (const key of todo) await writeContactKey(db, owner, partyId, key, contact[key]);
  return todo.map((key) => ({ field: key, old: before[key], new: contact[key] }));
}
function cleanTaxIds(list) {
  if (list == null) return null;
  if (!Array.isArray(list)) throw badRequest('tax_ids is a list of { scheme, value }.'); /* CRM-47: an object was ignored with 200 and no change */
  return list
    .map((item) => ({
      scheme: String((item && item.scheme) || '')
        .trim()
        .toUpperCase(),
      value: String((item && item.value) || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
    }))
    .map((item) => {
      if (SCHEMES.indexOf(item.scheme) < 0) throw badRequest('Unknown tax id kind "' + item.scheme + '".');
      return item;
    })
    .filter((item) => item.value)
    .map((item) => {
      const chk = TAX_ID_CHECK[item.scheme];
      if (!chk) return item;
      const r = chk(item.value);
      if (!r.ok) throw badRequest(item.scheme + ': ' + r.why);
      return { scheme: item.scheme, value: r.value };
    });
}

/** a party number, if the party has none: the next of the shop's one series */
async function ensureNo(db, owner, party_id) {
  const have = await booksStore.partyNoOf(db, owner, party_id);
  if (have) return have;
  const n = await booksStore.nextNo(db, owner, 'P', '-');
  const no = booksEngines.packs().partyNo(n);
  await booksStore.setPartyNo(db, owner, party_id, no);
  return no;
}
/**
 * ensureNos(db, owner, ids) → Map(party_id → party_no) — ensureNo for a SET (L3: a CSV of leads): one read of who has a number, ONE move of the
 * counter for the block (books-store.nextNo with a count), one UPDATE per list. The same series, assigned once, never reused.
 */
async function ensureNos(db, owner, ids) {
  const want = [...new Set((ids || []).map(String))],
    out = new Map();
  if (!want.length) return out;
  const have = await db.query(
    `SELECT customer_identity_id AS pid, party_no FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = ANY($2::uuid[])
                               UNION ALL SELECT supplier_entity_id, party_no FROM supplier_list WHERE owner_entity_id = $1 AND supplier_entity_id = ANY($2::uuid[])`,
    [owner, want]
  );
  have.rows.forEach((item) => {
    if (item.party_no) out.set(String(item.pid), item.party_no);
  });
  const need = want.filter((id) => !out.has(id));
  if (!need.length) return out;
  const first = await booksStore.nextNo(db, owner, 'P', '-', need.length);
  const partyNos = need.map((_, index) => booksEngines.packs().partyNo(first + index));
  await db.query(
    `UPDATE customer_list c SET party_no = v.no FROM unnest($2::uuid[], $3::text[]) AS v(id, no) WHERE c.owner_entity_id = $1 AND c.customer_identity_id = v.id AND c.party_no IS NULL`,
    [owner, need, partyNos]
  );
  await db.query(
    `UPDATE supplier_list s SET party_no = v.no FROM unnest($2::uuid[], $3::text[]) AS v(id, no) WHERE s.owner_entity_id = $1 AND s.supplier_entity_id = v.id AND s.party_no IS NULL`,
    [owner, need, partyNos]
  );
  need.forEach((id, index) => out.set(id, partyNos[index]));
  return out;
}

/** saveTaxIds(db, owner, partyId, taxIds) → [{ field: 'tax_id:<scheme>', old, new }] - the duplicate check (409 DUPLICATE_PARTY naming the holder) and the upsert, for what changed */
async function saveTaxIds(db, owner, party_id, taxIds) {
  const changed = [];
  const list = (await db.query(`SELECT scheme, value FROM party_tax_id WHERE owner_entity_id = $1 AND party_id = $2`, [owner, party_id])).rows;
  for (const t of taxIds) {
    const clash = (
      await db.query(
        `SELECT t.party_id, i.display_name FROM party_tax_id t JOIN identities i ON i.identity_id = t.party_id
                                    WHERE t.owner_entity_id = $1 AND t.scheme = $2 AND upper(t.value) = $3 AND t.party_id <> $4`,
        [owner, t.scheme, t.value, party_id]
      )
    ).rows[0];
    /* ⚠️ the exact sentence the web's friendlyErr maps (code DUPLICATE_PARTY); who holds it rides beside it */
    if (clash) {
      const e = badRequest(DUPLICATE_PARTY, 409);
      e.code = 'DUPLICATE_PARTY';
      e.other = clash.party_id;
      e.holder = clash.display_name || null;
      e.scheme = t.scheme;
      throw e;
    }
    const old = list.find((x) => x.scheme === t.scheme);
    await db.query(
      `INSERT INTO party_tax_id (owner_entity_id, party_id, scheme, value) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (owner_entity_id, party_id, scheme) DO UPDATE SET value = EXCLUDED.value`,
      [owner, party_id, t.scheme, t.value]
    );
    if (!old || old.value !== t.value) changed.push({ field: 'tax_id:' + t.scheme, old: old ? old.value : null, new: t.value });
  }
  return changed;
}
/**
 * checkMergeTarget(db, owner, party_id, target) - CRM-43: a merge target is a party on THIS shop's own lists (either side), not the party itself, not the
 * shop, and not merged away already; and the party being merged must not be the survivor of others (no chains, no loops). A stranger's id answers
 * exactly like an unknown party (404), so it is never confirmed to exist. Reads the two list tables SIDES names; no second ownership test.
 */
async function checkMergeTarget(db, owner, party_id, target) {
  /* two merges at once (A into B, B into A) would both pass the reads below and leave a loop: one shop's merges go one at a time, held until this transaction ends */
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['merge:' + String(owner).toLowerCase()]);
  const wanted = String(target).toLowerCase();
  if (wanted === String(party_id).toLowerCase()) throw badRequest('A party cannot be merged into itself.');
  if (wanted === String(owner).toLowerCase()) throw badRequest('Your own business cannot be the party you merge into.');
  const found = [];
  for (const side of Object.keys(SIDES)) {
    const list = SIDES[side];
    const answer = await db.query(`SELECT to_jsonb(l)->>'merged_into' AS merged_into, to_jsonb(l)->>'hidden_at' AS hidden_at FROM ${list.table} l WHERE l.${list.partyCol} = $1 AND l.owner_entity_id = $2`, [target, owner]);
    found.push(...answer.rows);
  }
  if (!found.length) throw badRequest('Not found', 404);
  if (found.some((item) => item.merged_into)) throw badRequest('That party is already merged into another. Merge into the party it was merged into.', 409);
  if (found.some((item) => item.hidden_at)) throw badRequest('That party is hidden from your list. Show it again before merging into it.', 409);
  for (const side of Object.keys(SIDES)) {
    const list = SIDES[side];
    const answer = await db.query(`SELECT 1 FROM ${list.table} l WHERE to_jsonb(l)->>'merged_into' = $1 AND l.owner_entity_id = $2 LIMIT 1`, [String(party_id), owner]);
    if (answer.rows.length) throw badRequest('Other parties are merged into this one, so it cannot be merged away. Merge those into the new party first.', 409);
  }
}
/**
 * patch(db, owner, side, listRowId, body, by) → { changed, party_no, tax_ids } — on a withEntity handle.
 * Each field that changed goes to books_change_log (who, when, field, old, new).
 */
async function patch(db, owner, side, listRowId, body, by) {
  const sideDef = SIDES[side];
  if (!sideDef) throw badRequest('customer or supplier?');
  const fields = clean(side, body || {});
  const taxIds = cleanTaxIds((body || {}).tax_ids);
  const contact = cleanContact(body || {});
  if (!Object.keys(fields).length && !taxIds && !Object.keys(contact).length) return { changed: [] };
  const row = (await db.query(`SELECT * FROM ${sideDef.table} WHERE ${sideDef.idCol} = $1 AND owner_entity_id = $2`, [listRowId, owner])).rows[0];
  if (!row) throw badRequest('Not found', 404);
  const party_id = row[sideDef.partyCol];
  if (fields.merged_into) await checkMergeTarget(db, owner, party_id, fields.merged_into);
  const changed = [];
  const keys = Object.keys(fields);
  if (keys.length) {
    if (!(keys[0] in row)) throw badRequest(waiting('The party fields', true, 'Nothing was changed.'), 409);
    const sets = keys.map((item, index) => item + ' = $' + (index + 3));
    await db.query(
      `UPDATE ${sideDef.table} SET ${sets.join(', ')} WHERE ${sideDef.idCol} = $1 AND owner_entity_id = $2`,
      [listRowId, owner].concat(keys.map((item) => fields[item]))
    );
    for (const k of keys)
      if (String(row[k] == null ? '' : row[k]) !== String(fields[k] == null ? '' : fields[k])) changed.push({ field: k, old: row[k], new: fields[k] });
  }
  if (taxIds) changed.push(...(await saveTaxIds(db, owner, party_id, taxIds)));
  changed.push(...(await saveContact(db, owner, party_id, contact)));
  /* ⚠️ each in its own savepoint: before b272 there is no number series and no change log — the fields still save */
  const party_no = await trySavepoint(db, () => ensureNo(db, owner, party_id), null);
  for (const c of changed)
    await trySavepoint(db, () => booksStore.logChange(db, owner, { by, table_name: sideDef.table, row_id: party_id, field: c.field, old: c.old, new: c.new }), null);
  return { changed: changed.map((item) => item.field), party_no, party_id };
}

/**
 * decorate(withEntity, owner, rows, idKey, side) — adds party_no · balance_minor (+ = they owe you on a customer, you owe
 * them on a supplier) · oldest_due · tax_ids to each list row, when the shop's ledger is on. Never throws.
 */
async function decorate(withEntity, owner, rows, idKey, side) {
  try {
    await withEntity(owner, async (db) => {
      const setting = await trySavepoint(db, () => booksStore.setting(db, owner), null);
      const sideDef = SIDES[side];
      /* PERF1: only the parties on THIS list (a CRM page, the customers pane) — their list rows, tax ids and open items; never the shop's every party for a page of them */
      const ids = Array.from(new Set(rows.map((item) => String(item[idKey])).filter((x) => /^[0-9a-f-]{36}$/i.test(x))));
      if (!ids.length) return;
      const termsRow = await trySavepoint(
        db,
        () =>
          db.query(
            `SELECT ${sideDef.partyCol} AS pid, party_no, legal_name, credit_days, credit_limit_minor, state_code, merged_into${side === 'customer' ? ', nickname' : ''}
                                  FROM ${sideDef.table} WHERE owner_entity_id = $1 AND ${sideDef.partyCol} = ANY($2::uuid[])`,
            [owner, ids]
          ),
        null
      );
      if (!termsRow) return;
      const by = new Map(termsRow.rows.map((item) => [String(item.pid), item]));
      const taxState = await trySavepoint(
        db,
        () => db.query(`SELECT party_id, scheme, value FROM party_tax_id WHERE owner_entity_id = $1 AND party_id = ANY($2::uuid[])`, [owner, ids]),
        { rows: [] }
      );
      const taxBy = new Map();
      taxState.rows.forEach((item) => {
        const k = String(item.party_id);
        if (!taxBy.has(k)) taxBy.set(k, []);
        taxBy.get(k).push({ scheme: item.scheme, value: item.value });
      });
      const dues = new Map();
      if (setting && setting.enabled) {
        const account = (await booksStore.accounts(db, owner)).find((x) => x.role === (side === 'supplier' ? 'creditors' : 'debtors'));
        const items = account
          ? ((await trySavepoint(db, () => booksStore.items(db, owner, ids, account.account_id), [])) || []).map(booksEngines.itemOf)
          : []; /* a document belongs to ONE party (receivables.outstanding) — a party's items are whole on their own */
        /* ⚠️ no engine yet (v1.8.0 not adopted) → the rows keep their party fields and simply show no balance */
        if (items.length && booksEngines.load('receivables')) {
          const outstanding = booksEngines.receivables().outstanding(items),
            sign = side === 'supplier' ? -1 : 1;
          Object.keys(outstanding.by_party || {}).forEach((pid) => dues.set(String(pid), { total_minor: sign * outstanding.by_party[pid], oldest_due: null }));
          Object.keys(outstanding.by_ref || {}).forEach((item) => {
            const d = outstanding.by_ref[item],
              x = dues.get(String(d.party));
            const due = d.due_date || d.date;
            if (x && d.outstanding_minor > 0 && due && (!x.oldest_due || due < x.oldest_due)) x.oldest_due = due;
          });
        }
      }
      for (const r of rows) {
        const k = String(r[idKey]),
          partyRow = by.get(k) || {},
          dueRow = dues.get(k);
        Object.assign(r, {
          party_no: partyRow.party_no || null,
          legal_name: partyRow.legal_name || null,
          credit_days: partyRow.credit_days == null ? null : partyRow.credit_days,
          credit_limit_minor: partyRow.credit_limit_minor == null ? null : Number(partyRow.credit_limit_minor),
          state_code: partyRow.state_code || null,
          merged_into: partyRow.merged_into || null,
          tax_ids: taxBy.get(k) || []
        });
        if (side === 'customer' && partyRow.nickname !== undefined) r.nickname = partyRow.nickname || null;
        if (setting && setting.enabled) {
          r.balance_minor = dueRow ? dueRow.total_minor : 0;
          r.oldest_due = dueRow ? dueRow.oldest_due : null;
        }
      }
    });
  } catch (e) {
    logger.fellBack(
      'party-fields decorate: the read failed — carried on without it',
      e
    ); /* before b274 the columns are not there — the list is still the list */
  }
  return rows;
}

/** number every party on both lists that has none, oldest first (the switch, and the nightly check) */
async function numberAll(db, owner) {
  const result = await db.query(
    `SELECT pid FROM (
                               SELECT customer_identity_id AS pid, created_at FROM customer_list WHERE owner_entity_id = $1 AND party_no IS NULL
                               UNION ALL SELECT supplier_entity_id, created_at FROM supplier_list WHERE owner_entity_id = $1 AND party_no IS NULL) x
                             GROUP BY pid ORDER BY MIN(created_at)`,
    [owner]
  );
  let index = 0;
  for (const x of result.rows) {
    await ensureNo(db, owner, x.pid);
    index++;
  }
  return index;
}

module.exports = { shopHeaderWhy, doorTaxId, TAX_ID_MAX, patch, saveContact, decorate, ensureNo, ensureNos, numberAll, clean, cleanTaxIds, SCHEMES, DUPLICATE_PARTY };
