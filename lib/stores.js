'use strict';
// lib/stores.js — WHICH SHOP SENT THIS (W-1). A lightweight contact keyed by phone number.
//
// Directive step 3: *"the sender's WhatsApp number (or BSUID) is the key into CB's own record → resolves to a
// STORE. The store carries a default address. If unknown, create a lightweight contact and flag it."*
//
// ── ⚠️ NOT A PLATFORM IDENTITY, ON PURPOSE ──────────────────────────────────────────────────────────────────────
// A retail shop that WhatsApps the wholesaler is not an entity on the rail, and minting one for every stranger who
// messages would put unverified identities on the platform — the same thing the send path refuses when it declines
// to make a phone number a recipient. This is a contact list: enough to attribute and to address, not pretending
// to be a party.
//
// ── ⚠️⚠️ WITHOUT RLS — BY INSTRUCTION (Athi, 2026-08-11), AND THE COMPENSATION IS HERE ───────────────────────────
// `wholesaler_store` is tenant data with no row-level policy, so THIS FILE is the only thing standing between one
// wholesaler's shop list and another's. Every query below filters `owner_entity_id`, and it is never optional:
// resolve(), upsert() and list() all take it as their first argument and it is used in every WHERE.
//
// That is a discipline, not a guarantee. Under RLS a forgotten predicate returns nothing; here it returns someone
// else's shops. If this table ever grows a query that does not filter by owner, turn RLS on — the policy is
// written, commented out, at the foot of migrations/b135_wholesaler_stores.sql.
const { query } = require('../db');

/**
 * phoneKey — digits only, last 10 kept.
 *
 * ⚠️ A SHOP THAT CHANGES HOW IT DIALS IS NOT A NEW SHOP. "+91 90000 11111", "09000011111" and "9000011111" are one
 * number; keyed literally they would become three shops and split one shop's requests across three attributions —
 * which shows up as under-ordering for a customer who actually asked for the right amount.
 * Last 10 digits because the country code is the part that comes and goes.
 */
function phoneKey(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');

/**
 * resolve(owner, phone, fallbackName) — the shop this number belongs to.
 *
 * ⚠️ AN UNKNOWN NUMBER STILL RESOLVES, but to a PROVISIONAL shop. Refusing to attribute an unrecognised sender
 * would drop a real order on the floor; attributing it silently as if it were a known customer would hide that
 * nobody has ever confirmed who they are. So it is recorded, usable, and visibly flagged — the same shape as
 * "sender not verified" on a raised chit.
 */
async function resolve(owner, phone, fallbackName) {
  const key = phoneKey(phone);
  if (!owner || !key) return null;
  try {
    const found = await query(
      `SELECT store_id, display_name, address, provisional, phone_key
         FROM wholesaler_store WHERE owner_entity_id = $1 AND phone_key = $2 LIMIT 1`, [owner, key]);
    if (found.rows[0]) return found.rows[0];
    const made = await query(
      `INSERT INTO wholesaler_store (owner_entity_id, phone_key, display_name, provisional)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (owner_entity_id, phone_key) DO UPDATE SET updated_at = now()
       RETURNING store_id, display_name, address, provisional, phone_key`,
      [owner, key, String(fallbackName || ('Unknown shop ' + key.slice(-4))).slice(0, 120)]);
    return made.rows[0];
  } catch (e) { if (notMigrated(e)) return null; throw e; }
}

/** Name a shop, give it its default delivery address, and stop calling it provisional. */
async function upsert(owner, { phone, display_name, address, notes }) {
  const key = phoneKey(phone);
  if (!owner || !key) { const e = new Error('phone required'); e.status = 400; throw e; }
  try {
    const r = await query(
      `INSERT INTO wholesaler_store (owner_entity_id, phone_key, display_name, address, notes, provisional)
       VALUES ($1,$2,$3,$4,$5,false)
       ON CONFLICT (owner_entity_id, phone_key) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, wholesaler_store.display_name),
             address      = COALESCE(EXCLUDED.address, wholesaler_store.address),
             notes        = COALESCE(EXCLUDED.notes, wholesaler_store.notes),
             provisional  = false, updated_at = now()
       RETURNING store_id, phone_key, display_name, address, provisional`,
      [owner, key, String(display_name || '').slice(0, 120) || null, address ? String(address).slice(0, 300) : null,
       notes ? String(notes).slice(0, 500) : null]);
    return r.rows[0];
  } catch (e) { if (notMigrated(e)) { const x = new Error('Stores are not migrated on this environment (b135).'); x.status = 503; throw x; } throw e; }
}

async function list(owner) {
  try {
    const r = await query(
      `SELECT store_id, phone_key, display_name, address, provisional, created_at
         FROM wholesaler_store WHERE owner_entity_id = $1 ORDER BY provisional DESC, display_name`, [owner]);
    return { stores: r.rows, migrated: true };
  } catch (e) { if (notMigrated(e)) return { stores: [], migrated: false, note: 'stores not migrated (b135)' }; throw e; }
}

module.exports = { resolve, upsert, list, phoneKey };
