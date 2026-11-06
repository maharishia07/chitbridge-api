'use strict';
/**
 * OWNS      the per-shop switch of the RAIDA register: "is the register on for this shop", and the one refusal when it is off (RAIL-90).
 * CALLED BY routes/chits.js (registerOn, on every /register/* route, GET /raida/report and the four /:chit_id/raida routes).
 * FLOW      auth → requireRegister(label) → [on] the route | [off] 403 CAPABILITY_OFF (the code and body shape the connector gate answers, words of the register)
 * CARD      01-rail-core-the-chit/raida
 * Practice: feature flag, least functionality (NIST SP 800-53 CM-7). A shop that never used the register has it OFF until its capability list carries 'register'.
 *
 * ⚠️ ON = the capability key OR the shop already holds register rows (derived at read time, so no migration and no flip: a shop that used the
 *    register before this gate keeps working). The capability list is identities.capabilities, the one the connector and dispute gates read.
 * ⚠️ The same refusal code as routes/connectors.js (CAPABILITY_OFF, 403, { error, code, message } + the Problem fields); only the sentence names the register.
 */
const { query, withEntity } = require('../db');
const raida = require('./raida');
const { said, failed } = require('./chits-contract');
const { problem } = require('./problem');
const auth = require('../middleware/auth');

const KEY = 'register';

/** the one reader of a capability list: is `key` in it (the connector gate's own test, for any key) */
const hasCap = (caps, key) => Array.isArray(caps) && caps.indexOf(key) >= 0;

/** the refusal of a shop whose register is off: the connector gate's code and body keys, the register's words */
const registerOff = () => ({
  ...said({
    error: 'Capability off',
    code: 'CAPABILITY_OFF',
    message: 'This shop has not switched the register on. Turn the register capability on to use it.'
  }),
  hint: 'Turn the register capability on to use it.' /* the register row of CAPABILITY_OFF speaks of connectors: the register says its own */
});

/** shops known to hold register rows: rows are never deleted, so a yes stays a yes and costs the probe once per process */
const KNOWN_USERS = new Set();

/** has this shop ever written to the register (an entry, or a register opened)? false where the register is not migrated at all */
async function hasRows(entity_id) {
  if (KNOWN_USERS.has(entity_id)) return true;
  const found = await raida.shape();
  if (!found.table) return false;
  const subjects = found.full ? ' OR EXISTS (SELECT 1 FROM register_subject WHERE entity_id = $1)' : '';
  const counted = await withEntity(entity_id, (db) => db.query(`SELECT (EXISTS (SELECT 1 FROM ${found.table} WHERE entity_id = $1)${subjects}) AS used`, [entity_id]));
  const used = Boolean(counted.rows[0] && counted.rows[0].used);
  if (used) KNOWN_USERS.add(entity_id);
  return used;
}

/** is the register on for this shop: its capability key, else rows it already holds */
async function isOn(entity_id) {
  const caps = await query('SELECT capabilities FROM identities WHERE identity_id = $1', [entity_id]);
  return hasCap(caps.rows[0] && caps.rows[0].capabilities, KEY) || hasRows(entity_id);
}

/**
 * route middleware, after auth: a shop with the register off is refused 403 CAPABILITY_OFF; a fault reading the switch is a 500 that closes the door
 * (fail-closed), worded as the route words its own fault (`label`: the frozen 500 body of each route is unchanged).
 */
const requireRegister = (label) => async (req, res, next) => {
  try {
    if (await isOn(auth.entityOf(req))) return next();
    return problem(req, res, { status: 403, ...registerOff() });
  } catch (err) {
    return problem(req, res, failed(err, req, label));
  }
};

module.exports = { KEY, hasCap, registerOff, isOn, requireRegister, KNOWN_USERS };
