// @stage tested
// @stage-note [CB CRM L3] Leads from a CSV the browser parsed: normalise (the one phone helper) · dedupe (phone, then name; in the file and against the
// @stage-note shop's parties) · cap 500 · ONE transaction of set-based statements. Pure half (normalise · plan) tested without a database.
'use strict';
/**
 * lib/crm-leads.js — the call-desk's first list, imported (round L3, 2026-10-12).
 *
 * ⭐ A LEAD IS A PARTY (L1): nothing here makes a second contact list. A row that is new MINTS a local party (local-identity.mintMany — mint()'s
 *   rules for a set), goes on customer_list as added_via 'lead', and gets its first stage from the ONE memberships writer (memberships.addMany).
 * ⭐ ONE CALCULATION: the phone is normalised by rewards.holderOf (the helper the counter and Add lead already use) — never a second rule here.
 *   Two phones are the same when their digits are the same ("+91 98400 12321" = "+919840012321"; "98400 12321" is NOT the same as either — the
 *   helper keeps what was typed, and this file does not guess a country code).
 * ⭐ DEDUPE, IN ORDER: a row with no name, an email-shaped name or a bad phone is skipped · the same phone (then the same name, mint's rule)
 *   twice in the file keeps the first · a phone or minted name the shop already has → MERGE (the existing party becomes a lead: added_via 'lead' +
 *   the stage row) unless they have traded (a customer), are a supplier, or are a lead already (skipped, with the reason).
 * ⭐ SET-BASED: one SELECT for the shop's matching parties, mintMany (4), one UPDATE for phones/cities, one INSERT on customer_list, the number
 *   block (party-fields.ensureNos: 3), one UPDATE for the merges, addMany (2), one INSERT of notes — a dozen statements for 500 rows, never 500.
 * ⚠️ BEFORE b297 the writer refuses in words (memberships.need → 503 LEADS_NOT_MIGRATED); nothing is created. `dry: true` plans and writes nothing.
 * ⚠️ email is NOT written to identities.email (a minted party has no account — mint()'s rule): it goes with source and note into ONE timeline
 *   note (crm-followups.noteMany, b276) so the call desk reads it on the record. business → customer_list.legal_name (b274) when the column is there.
 */
const CAP = 500;
const TOO_MANY = 'Import up to 500 leads at a time. Split the file.';
const NOTHING = 'Nothing to import.';
const WHY = {
  NO_NAME: 'No name', EMAIL_NAME: 'That looks like an email', BAD_PHONE: 'Phone does not look right', LONG_NAME: 'Name too long',
  SAME_PHONE: 'Same phone as row ', SAME_NAME: 'Same name as row ', CUSTOMER: 'Already a customer', SUPPLIER: 'Already a supplier', LEAD: 'Already a lead',
};
const bad = (msg, status, code) => { const e = new Error(msg); e.status = status || 400; if (code) e.code = code; return e; };
const txt = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const fold = (name) => require('./local-identity').fold(name);
const digitsOf = (phone) => String(phone == null ? '' : phone).replace(/[^0-9]/g, '');

/** one row, cleaned — the phone through the ONE helper; `why` when it cannot be imported */
function cleanRow(r, i) {
  const s = r && typeof r === 'object' ? r : {};
  const row = { row: i + 1, name: txt(s.name, 121), phone: null, digits: null, email: txt(s.email, 120) || null, business: txt(s.business, 200) || null,
                city: txt(s.city, 80) || null, source: txt(s.source, 80) || null, note: txt(s.note, 1000) || null, why: null };
  if (!row.name) row.why = WHY.NO_NAME;
  else if (row.name.length > 120) row.why = WHY.LONG_NAME;
  else if (row.name.indexOf('@') >= 0) row.why = WHY.EMAIL_NAME;   /* mint()'s rule: a name that is an identifier is the wrong field */
  const raw = txt(s.phone, 40);
  if (!row.why && raw) {
    const h = require('./rewards').holderOf({ phone: raw });
    if (!h || h.scheme !== 'phone') row.why = WHY.BAD_PHONE;
    else { row.phone = h.value; row.digits = digitsOf(h.value); }
  }
  return row;
}

/** normalise(rows) → the cleaned rows, deduped WITHIN the file (phone first, then name); throws 400 for nothing / too many */
function normalise(rows) {
  if (!Array.isArray(rows) || !rows.length) throw bad(NOTHING, 400, 'NO_ROWS');
  if (rows.length > CAP) throw bad(TOO_MANY, 400, 'TOO_MANY');
  const out = rows.map(cleanRow), byPhone = new Map(), byName = new Map();
  out.forEach((item) => {
    if (item.why) return;
    if (item.digits) { const first = byPhone.get(item.digits); if (first) { item.why = WHY.SAME_PHONE + first; return; } byPhone.set(item.digits, item.row); }
    const k = fold(item.name), first = byName.get(k);
    if (first) { item.why = WHY.SAME_NAME + first; return; }
    byName.set(k, item.row);
  });
  return out;
}

/**
 * plan(rows, existing) → the rows with `outcome` (add · merge · skip) and, for a match, `party_id`.
 * `existing`: the shop's parties that share a phone (digits) or a minted name: { identity_id, digits, name_fold, minted, on_customer, added_via, txn_count, supplier }
 */
function plan(rows, existing) {
  const byDigits = new Map(), byName = new Map();
  (existing || []).forEach((e) => { if (e.digits) byDigits.set(String(e.digits), e); if (e.minted && e.name_fold) byName.set(String(e.name_fold), e); });
  rows.forEach((item) => {
    if (item.why) { item.outcome = 'skip'; return; }
    const e = (item.digits && byDigits.get(item.digits)) || byName.get(fold(item.name)) || null;
    if (!e) { item.outcome = 'add'; return; }
    item.party_id = String(e.identity_id);
    if (e.supplier) { item.outcome = 'skip'; item.why = WHY.SUPPLIER; return; }
    if ((Number(e.txn_count) || 0) > 0) { item.outcome = 'skip'; item.why = WHY.CUSTOMER; return; }
    if (e.added_via === 'lead') { item.outcome = 'skip'; item.why = WHY.LEAD; return; }
    item.outcome = 'merge';
  });
  return rows;
}

/** the answer's shape: counts, the skipped rows with their reason, and every row's outcome (the preview paints this; it computes nothing) */
function shape(rows, dry) {
  const pick = (r) => ({ row: r.row, name: r.name, phone: r.phone, outcome: r.outcome, why: r.why || null, party_id: r.party_id || null });
  return {
    dry: !!dry,
    added: rows.filter((item) => item.outcome === 'add').length,
    merged: rows.filter((item) => item.outcome === 'merge').length,
    skipped: rows.filter((item) => item.outcome === 'skip').map((item) => ({ row: item.row, name: item.name, phone: item.phone, why: item.why })),
    rows: rows.map(pick),
  };
}

/**
 * importLeads(owner, rows, { by, dry }) → { dry, added, merged, skipped: [{ row, name, phone, why }], rows: [{ row, name, phone, outcome, why, party_id }] }
 * ONE transaction (withEntity). `dry` plans (the one SELECT) and writes nothing — the preview.
 */
async function importLeads(owner, raw, o) {
  const opt = o || {};
  const rows = normalise(raw);
  const M = require('./memberships'), L = require('./local-identity'), F = require('./crm-followups'), handle = require('./handle'), schema = require('./schema');
  const db = require('../db');
  await M.need();
  return db.withEntity(owner, async (h) => {
    const me = await h.query(`SELECT user_id, bridge_id FROM identities WHERE identity_id = $1`, [owner]);
    const ownerHandle = (me.rows[0] && (me.rows[0].user_id || me.rows[0].bridge_id)) || '';
    const prefix = handle.mintedPrefix(ownerHandle, 'cus');
    const live = rows.filter((item) => !item.why);
    /* the shop's parties that share a phone (by digits) or a minted name with the file — ONE statement, this shop's lists only, on the withEntity handle */
    const ex = await h.query(
      `SELECT i.identity_id, i.display_name, i.user_id,
              regexp_replace(COALESCE(i.otp_contact, ''), '[^0-9]', '', 'g') AS d1, regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g') AS d2,
              (i.parent_entity_id = $1 AND i.user_id LIKE $4) AS minted,
              (cl.customer_identity_id IS NOT NULL) AS on_customer, cl.added_via, COALESCE(cl.txn_count, 0) AS txn_count,
              (sl.supplier_entity_id IS NOT NULL) AS supplier
         FROM identities i
         LEFT JOIN customer_list cl ON cl.owner_entity_id = $1 AND cl.customer_identity_id = i.identity_id
         LEFT JOIN supplier_list sl ON sl.owner_entity_id = $1 AND sl.supplier_entity_id = i.identity_id
        WHERE (cl.customer_identity_id IS NOT NULL OR sl.supplier_entity_id IS NOT NULL)
          AND (regexp_replace(COALESCE(i.otp_contact, ''), '[^0-9]', '', 'g') = ANY($2::text[])
               OR regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])
               OR (i.parent_entity_id = $1 AND i.user_id LIKE $4 AND lower(btrim(i.display_name)) = ANY($3::text[])))`,
      [owner, live.map((item) => item.digits).filter(Boolean), live.map((item) => fold(item.name)), prefix + '%']);
    const existing = [];
    ex.rows.forEach((e) => {
      const base = { identity_id: e.identity_id, name_fold: fold(e.display_name), minted: !!e.minted, on_customer: !!e.on_customer, added_via: e.added_via, txn_count: e.txn_count, supplier: !!e.supplier };
      [e.d1, e.d2].filter(Boolean).forEach((item) => existing.push(Object.assign({ digits: item }, base)));
      if (base.minted) existing.push(Object.assign({ digits: null }, base));
    });
    plan(rows, existing);
    if (opt.dry) return shape(rows, true);

    const adds = rows.filter((item) => item.outcome === 'add'), merges = rows.filter((item) => item.outcome === 'merge');
    const q = { query: h.query.bind(h) };
    /* 1 · the new parties, minted as a set (mint()'s rules) */
    if (adds.length) {
      const minted = await L.mintMany(owner, adds.map((item) => item.name), { query: q.query, kind: 'cus', ownerHandle });
      if (minted.error) throw bad(minted.error.message || 'Could not add them.', minted.status || 409, 'MINT_REFUSED');
      adds.forEach((item, index) => { const m = minted.rows[index]; if (m.error) { item.outcome = 'skip'; item.why = m.error; } else item.party_id = String(m.identity_id); });
    }
    const fresh = adds.filter((item) => item.outcome === 'add');
    /* 2 · the phone (and city, when the column is there) on the shop's OWN minted rows — a registered party's own details are never touched */
    const hasCity = await schema.hasColumn('identities', 'city');
    const contact = fresh.concat(merges).filter((item) => item.phone || (hasCity && item.city));
    if (contact.length) {
      await h.query(`UPDATE identities i SET otp_contact = COALESCE(i.otp_contact, v.phone)${hasCity ? ', city = COALESCE(i.city, v.city)' : ''}
                       FROM unnest($2::uuid[], $3::text[], $4::text[]) AS v(id, phone, city)
                      WHERE i.identity_id = v.id AND i.parent_entity_id = $1`,
                    [owner, contact.map((item) => item.party_id), contact.map((item) => item.phone), contact.map((item) => (hasCity ? item.city : null))]);
    }
    /* 3 · on the customer list as leads (one statement); a row already there (a race) is a merge, not an add */
    let addedIds = new Set();
    if (fresh.length) {
      const legal = await schema.hasColumn('customer_list', 'legal_name');
      const ins = await h.query(`INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at${legal ? ', legal_name' : ''})
                                 SELECT $1, v.id, 'entity', 'lead', 0, NULL${legal ? ', v.legal' : ''} FROM unnest($2::uuid[], $3::text[]) AS v(id, legal)
                                 ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_identity_id`,
                                [owner, fresh.map((item) => item.party_id), fresh.map((item) => item.business)]);
      addedIds = new Set(ins.rows.map((x) => String(x.customer_identity_id)));
      fresh.forEach((item) => { if (!addedIds.has(item.party_id)) item.outcome = 'merge'; });
    }
    /* 4 · the merges: the existing parties become leads — only those with no trade behind them */
    const mergeIds = rows.filter((item) => item.outcome === 'merge').map((item) => item.party_id);
    let mergedIds = [];
    if (mergeIds.length) {
      const u = await h.query(`UPDATE customer_list SET added_via = 'lead' WHERE owner_entity_id = $1 AND customer_identity_id = ANY($2::uuid[]) AND txn_count = 0 AND added_via <> 'lead'
                               RETURNING customer_identity_id`, [owner, mergeIds]);
      mergedIds = u.rows.map((x) => String(x.customer_identity_id));
      rows.forEach((item) => { if (item.outcome === 'merge' && mergedIds.indexOf(item.party_id) < 0) { item.outcome = 'skip'; item.why = WHY.LEAD; } });
    }
    /* 5 · party numbers for the new rows: the one series, one block (absent before b274 → no numbers, as Add lead) */
    const PF = require('./party-fields');
    if (addedIds.size) await db.trySavepoint(h, () => PF.ensureNos(h, owner, [...addedIds]), null);
    /* 6 · the first stage, through the ONE writer — for every party that is a lead after this import */
    const stageIds = [...addedIds].concat(mergedIds);
    if (stageIds.length) await M.addMany(h, owner, { kind: 'lead_stage', items: stageIds.map((id) => ({ item_id: id, group: 'lead' })), by: opt.by || null });
    /* 7 · what the row carried beyond name and phone → one note on the record's timeline (b276; absent → not kept) */
    const notes = rows.filter((item) => (item.outcome === 'add' || item.outcome === 'merge') && item.party_id && (item.email || item.source || item.note))
      .map((item) => ({ party_id: item.party_id, body: [item.source ? 'Imported from ' + item.source : 'Imported', item.email ? 'Email ' + item.email : '', item.note || ''].filter(Boolean).join('. ') }));
    if (notes.length && await schema.hasTable('party_interaction')) await F.noteMany(h, owner, notes, opt.by || null);
    return shape(rows, false);
  });
}

module.exports = { CAP, TOO_MANY, NOTHING, WHY, cleanRow, normalise, plan, shape, importLeads };
