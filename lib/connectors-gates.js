'use strict';
/**
 * lib/connectors-gates.js — the connector doors' gates: the shop's connector switch and the device key (ActorKey) check.
 * OWNS      hashKey · hasConnector · requireConnector · deviceActor · deviceKey (no route, no state)
 * CALLED BY routes/connectors.js
 * FLOW      owner routes: requireConnector (capability on) · device doors: deviceKey -> deviceActor (401 no/unknown key, 403 capability off) -> req.device
 * CARD      23-connectors-and-integrations/connector-actors
 */
const crypto = require('crypto');
const { query: db } = require('../db');
const auth = require('../middleware/auth');
const { problem } = require('./problem'); // API-STANDARD S1: the one error writer
const { words, failed } = require('./connectors-contract');
const { boundRead } = require('./bound-read'); /* SEC-198: the identities read runs under its own id's binding */

const ownerEntityId = (req) => auth.entityOf(req);

const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex'); // only the hash is stored

/**
 * ⭐ SEC3 · THE ONE CONNECTOR SWITCH READER. hasConnector(caps) answers "is the shop's connector capability ON" from its
 * identities.capabilities; every connector door asks it — the owner's routes (requireConnector) AND the device's own key
 * (/ingest, /erp-ingest), which before SEC3 kept working after the shop switched the capability off.
 */
function hasConnector(caps) {
  return Array.isArray(caps) && caps.indexOf('connector') >= 0;
}
// capability gate — the entity must carry 'connector' (API-enforced, not just UI)
async function requireConnector(req, res, next) {
  try {
    const eid = ownerEntityId(req);
    const r = await boundRead(db, eid, 'SELECT capabilities FROM identities WHERE identity_id = $1', [eid]);
    if (hasConnector(r.rows[0] && r.rows[0].capabilities)) return next();
    return problem(req, res, { status: 403, ...words.capabilityOff() });
  } catch (err) {
    return problem(req, res, failed(err, req, 'Gate check failed'));
  }
}

/**
 * ⭐ SEC3 · WHO A DEVICE KEY IS. The ActorKey (X-Bridge-Key) → the connector actor, with its shop's capability switch read in the
 * SAME statement (no extra trip). Answers the refusal itself and returns null: 401 no/unknown key · 403 CAPABILITY_OFF.
 */
async function deviceActor(req, res) {
  const key = (req.get('X-Bridge-Key') || (req.body && req.body.key) || '').toString().trim();
  if (!key) {
    problem(req, res, { status: 401, ...words.noKey() });
    return null;
  }
  const ar = await db(
    `SELECT a.identity_id, a.parent_entity_id, a.display_name, a.connector_type, a.status, a.connector_config, p.capabilities AS shop_capabilities
       FROM identities a LEFT JOIN identities p ON p.identity_id = a.parent_entity_id
      WHERE a.provision_key_hash = $1 AND a.identity_type = 'actor' AND a.connector_type IS NOT NULL`,
    [hashKey(key)]
  );
  const actor = ar.rows[0];
  if (!actor || actor.status !== 'active') {
    problem(req, res, { status: 401, ...words.badKey() });
    return null;
  }
  if (!hasConnector(actor.shop_capabilities)) {
    problem(req, res, { status: 403, ...words.capabilityOff() });
    return null;
  }
  /* LV-08: an erased or closed shop's key ingests nothing (every other door asks the same one-minute status read; a status that cannot be read throws, so the door is the fault's 500, never open) */
  if (await require('./business-status').businessEnded(actor.parent_entity_id, db)) {
    problem(req, res, { status: 403, ...words.shopEnded() });
    return null;
  }
  return actor;
}

/**
 * The gate of the two device doors (POST /ingest, POST /erp-ingest): the key is proved after the body is checked and before the handler runs, as the handler always did first. It answers its own
 * refusals (deviceActor: 401, 403) and leaves the actor on req.device; a fault is the door's own 500, worded with the door's label.
 */
const deviceKey = (label) =>
  Object.assign(
    async (req, res, next) => {
      try {
        const actor = await deviceActor(req, res);
        if (!actor) return undefined;
        req.device = actor;
        return next();
      } catch (err) {
        return problem(req, res, failed(err, req, label));
      }
    },
    { addsStatuses: [401, 403] }
  );

module.exports = { hashKey, hasConnector, requireConnector, deviceActor, deviceKey };
