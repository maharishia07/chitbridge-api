// @stage tested
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
const S = require('./books-store');
const E = require('./books-engines');
function trySavepoint(db, fn, fallback) { return require('../db').trySavepoint(db, fn, fallback); }

const SIDES = {
  customer: { table: 'customer_list', idCol: 'customer_list_id', partyCol: 'customer_identity_id' },
  supplier: { table: 'supplier_list', idCol: 'supplier_list_id', partyCol: 'supplier_entity_id' },
};
const SCHEMES = ['GSTIN', 'PAN', 'TAN', 'TRN', 'VAT', 'TIN', 'CIN', 'UDYAM'];
const DUPLICATE_PARTY = 'Another party already has this tax id.';
function bad(msg, status) { const e = new Error(msg); e.status = status || 400; return e; }

/** what may be set, cleaned — or a refusal in words */
function clean(side, b) {
  const out = {};
  const txt = (v, n) => (v == null ? null : String(v).trim().replace(/\s+/g, ' ').slice(0, n) || null);
  if ('legal_name' in b) out.legal_name = txt(b.legal_name, 200);
  if (side === 'customer' && 'nickname' in b) out.nickname = txt(b.nickname, 80);
  if ('credit_days' in b) { const d = b.credit_days === null || b.credit_days === '' ? null : Math.floor(Number(b.credit_days)); if (d !== null && !(d >= 0 && d <= 3650)) throw bad('Credit days is a number of days, 0 or more.'); out.credit_days = d; }
  if ('credit_limit_minor' in b || 'credit_limit' in b) {
    const v = 'credit_limit_minor' in b ? b.credit_limit_minor : b.credit_limit;
    /* a limit typed in rupees becomes minor units through money.round (the one rounder), never a local copy of the rule */
    const m = v === null || v === '' ? null : ('credit_limit_minor' in b ? Math.round(Number(v)) : Math.round(require('./money').round(Number(v)) * 100));
    if (m !== null && !(m >= 0)) throw bad('A credit limit is an amount, 0 or more.');
    out.credit_limit_minor = m;
  }
  if ('state_code' in b) { const s = txt(b.state_code, 8); if (s && !/^[0-9A-Z-]{1,8}$/i.test(s)) throw bad('State code looks wrong.'); out.state_code = s ? s.toUpperCase() : null; }
  if ('merged_into' in b) { const m = b.merged_into ? String(b.merged_into) : null; if (m && !/^[0-9a-f-]{36}$/i.test(m)) throw bad('merged_into is a party id.'); out.merged_into = m; }
  return out;
}
function cleanTaxIds(list) {
  if (!Array.isArray(list)) return null;
  return list.map((t) => ({ scheme: String((t && t.scheme) || '').trim().toUpperCase(), value: String((t && t.value) || '').trim().toUpperCase().replace(/\s+/g, '') }))
    .map((t) => { if (SCHEMES.indexOf(t.scheme) < 0) throw bad('Unknown tax id kind "' + t.scheme + '".'); return t; })
    .filter((t) => t.value);
}

/** a party number, if the party has none: the next of the shop's one series */
async function ensureNo(db, owner, party_id) {
  const have = await S.partyNoOf(db, owner, party_id);
  if (have) return have;
  const n = await S.nextNo(db, owner, 'P', '-');
  const no = E.packs().partyNo(n);
  await S.setPartyNo(db, owner, party_id, no);
  return no;
}

/**
 * patch(db, owner, side, listRowId, body, by) → { changed, party_no, tax_ids } — on a withEntity handle.
 * Each field that changed goes to books_change_log (who, when, field, old, new).
 */
async function patch(db, owner, side, listRowId, body, by) {
  const T = SIDES[side]; if (!T) throw bad('customer or supplier?');
  const fields = clean(side, body || {});
  const taxIds = cleanTaxIds((body || {}).tax_ids);
  if (!Object.keys(fields).length && !taxIds) return { changed: [] };
  const row = (await db.query(`SELECT * FROM ${T.table} WHERE ${T.idCol} = $1 AND owner_entity_id = $2`, [listRowId, owner])).rows[0];
  if (!row) throw bad('Not found', 404);
  const party_id = row[T.partyCol];
  if (fields.merged_into && String(fields.merged_into) === String(party_id)) throw bad('A party cannot be merged into itself.');
  const changed = [];
  const keys = Object.keys(fields);
  if (keys.length) {
    if (!(keys[0] in row)) throw bad('The party fields need migration b274 (migrations/b274_books_party.sql) — run it in the Supabase SQL editor.', 409);
    const sets = keys.map((k, i) => k + ' = $' + (i + 3));
    await db.query(`UPDATE ${T.table} SET ${sets.join(', ')} WHERE ${T.idCol} = $1 AND owner_entity_id = $2`, [listRowId, owner].concat(keys.map((k) => fields[k])));
    for (const k of keys) if (String(row[k] == null ? '' : row[k]) !== String(fields[k] == null ? '' : fields[k])) changed.push({ field: k, old: row[k], new: fields[k] });
  }
  if (taxIds) {
    const had = (await db.query(`SELECT scheme, value FROM party_tax_id WHERE owner_entity_id = $1 AND party_id = $2`, [owner, party_id])).rows;
    for (const t of taxIds) {
      const clash = (await db.query(`SELECT t.party_id, i.display_name FROM party_tax_id t JOIN identities i ON i.identity_id = t.party_id
                                      WHERE t.owner_entity_id = $1 AND t.scheme = $2 AND upper(t.value) = $3 AND t.party_id <> $4`, [owner, t.scheme, t.value, party_id])).rows[0];
      /* ⚠️ the exact sentence the web's friendlyErr maps (code DUPLICATE_PARTY); who holds it rides beside it */
      if (clash) { const e = bad(DUPLICATE_PARTY, 409); e.code = 'DUPLICATE_PARTY'; e.other = clash.party_id; e.holder = clash.display_name || null; e.scheme = t.scheme; throw e; }
      const old = had.find((x) => x.scheme === t.scheme);
      await db.query(`INSERT INTO party_tax_id (owner_entity_id, party_id, scheme, value) VALUES ($1,$2,$3,$4)
                      ON CONFLICT (owner_entity_id, party_id, scheme) DO UPDATE SET value = EXCLUDED.value`, [owner, party_id, t.scheme, t.value]);
      if (!old || old.value !== t.value) changed.push({ field: 'tax_id:' + t.scheme, old: old ? old.value : null, new: t.value });
    }
  }
  /* ⚠️ each in its own savepoint: before b272 there is no number series and no change log — the fields still save */
  const party_no = await trySavepoint(db, () => ensureNo(db, owner, party_id), null);
  for (const c of changed) await trySavepoint(db, () => S.logChange(db, owner, { by, table_name: T.table, row_id: party_id, field: c.field, old: c.old, new: c.new }), null);
  return { changed: changed.map((c) => c.field), party_no, party_id };
}

/**
 * decorate(withEntity, owner, rows, idKey, side) — adds party_no · balance_minor (+ = they owe you on a customer, you owe
 * them on a supplier) · oldest_due · tax_ids to each list row, when the shop's ledger is on. Never throws.
 */
async function decorate(withEntity, owner, rows, idKey, side) {
  try {
    await withEntity(owner, async (db) => {
      const s = await trySavepoint(db, () => S.setting(db, owner), null);
      const T = SIDES[side];
      const f = await trySavepoint(db, () => db.query(`SELECT ${T.partyCol} AS pid, party_no, legal_name, credit_days, credit_limit_minor, state_code, merged_into${side === 'customer' ? ', nickname' : ''}
                                  FROM ${T.table} WHERE owner_entity_id = $1`, [owner]), null);
      if (!f) return;
      const by = new Map(f.rows.map((r) => [String(r.pid), r]));
      const tax = await trySavepoint(db, () => db.query(`SELECT party_id, scheme, value FROM party_tax_id WHERE owner_entity_id = $1`, [owner]), { rows: [] });
      const taxBy = new Map(); tax.rows.forEach((t) => { const k = String(t.party_id); if (!taxBy.has(k)) taxBy.set(k, []); taxBy.get(k).push({ scheme: t.scheme, value: t.value }); });
      const dues = new Map();
      if (s && s.enabled) {
        const a = (await S.accounts(db, owner)).find((x) => x.role === (side === 'supplier' ? 'creditors' : 'debtors'));
        const items = a ? ((await trySavepoint(db, () => S.items(db, owner, null, a.account_id), [])) || []).map(E.itemOf) : [];
        /* ⚠️ no engine yet (v1.8.0 not adopted) → the rows keep their party fields and simply show no balance */
        if (items.length && E.load('receivables')) {
          const o = E.receivables().outstanding(items), sign = side === 'supplier' ? -1 : 1;
          Object.keys(o.by_party || {}).forEach((pid) => dues.set(String(pid), { total_minor: sign * o.by_party[pid], oldest_due: null }));
          Object.keys(o.by_ref || {}).forEach((k) => { const d = o.by_ref[k], x = dues.get(String(d.party)); const due = d.due_date || d.date;
            if (x && d.outstanding_minor > 0 && due && (!x.oldest_due || due < x.oldest_due)) x.oldest_due = due; });
        }
      }
      for (const r of rows) {
        const k = String(r[idKey]), p = by.get(k) || {}, d = dues.get(k);
        Object.assign(r, { party_no: p.party_no || null, legal_name: p.legal_name || null, credit_days: p.credit_days == null ? null : p.credit_days,
          credit_limit_minor: p.credit_limit_minor == null ? null : Number(p.credit_limit_minor), state_code: p.state_code || null, merged_into: p.merged_into || null,
          tax_ids: taxBy.get(k) || [] });
        if (side === 'customer' && p.nickname !== undefined) r.nickname = p.nickname || null;
        if (s && s.enabled) { r.balance_minor = d ? d.total_minor : 0; r.oldest_due = d ? d.oldest_due : null; }
      }
    });
  } catch (_) { /* before b274 the columns are not there — the list is still the list */ }
  return rows;
}

/** number every party on both lists that has none, oldest first (the switch, and the nightly check) */
async function numberAll(db, owner) {
  const r = await db.query(`SELECT pid FROM (
                               SELECT customer_identity_id AS pid, created_at FROM customer_list WHERE owner_entity_id = $1 AND party_no IS NULL
                               UNION ALL SELECT supplier_entity_id, created_at FROM supplier_list WHERE owner_entity_id = $1 AND party_no IS NULL) x
                             GROUP BY pid ORDER BY MIN(created_at)`, [owner]);
  let n = 0; for (const x of r.rows) { await ensureNo(db, owner, x.pid); n++; }
  return n;
}

module.exports = { patch, decorate, ensureNo, numberAll, clean, cleanTaxIds, SCHEMES, DUPLICATE_PARTY };
