'use strict';
/**
 * lib/me-shop.js — the shop's own settings, read from the SHOP's identities row for GET /api/entities/me (DRIFT 29, PROOF-2026-11-27 row 29).
 * OWNER     settings (cb-settings)
 * RISK      an actor's own row has no zone or currency: answering from it makes the web fall back to the browser's clock and one chit reads two times for two seats of one shop.
 * OWNS      SHOP_SCOPED_COLS · shopRowOf(shopId, hasTimezone) · shopScoped(shopRow, isActor)
 * CALLED BY routes/entities.js GET /me (the parent-row read it already made for capabilities, now carrying these columns)
 * FLOW      entityOf(req) (the shop) → one read: capabilities + SHOP_SCOPED_COLS → for an actor, those values laid over the person's row; an entity's own row IS the shop's
 * CARD      28-platform-and-operations/settings
 */
const { query } = require('../db');
const { boundRead } = require('./bound-read');
/** the identity columns that describe the SHOP, not the person */
const SHOP_SCOPED_COLS = ['timezone', 'currency_code', 'country', 'gstn'];
/** the shop row's capabilities and shop-scoped columns; the zone column only when the database has it (b176) */
function shopRowOf(shopId, hasTimezone) {
  return boundRead(query, shopId, `SELECT capabilities, ${SHOP_SCOPED_COLS.filter((k) => k !== 'timezone' || hasTimezone).join(', ')} FROM identities WHERE identity_id = $1`, [shopId]);
}
/** the shop's values to lay over an actor's own row; nothing for an entity */
function shopScoped(shopRow, isActor) {
  return isActor && shopRow ? Object.fromEntries(SHOP_SCOPED_COLS.filter((k) => k in shopRow).map((k) => [k, shopRow[k]])) : {};
}
module.exports = { SHOP_SCOPED_COLS, shopRowOf, shopScoped };
