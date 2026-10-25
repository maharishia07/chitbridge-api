'use strict';
/**
 * tests/crossing/lib/ctx.cjs — what a scenario is handed: the topology, signed-in shops, read-only database questions, the run's tag, shared state, and a recorder for its checks.
 * OWNS      lazy sign-in (one tester-code read per installation, cached in memory) · the run id and subject tag · the Recorder (check / known / note)
 * CALLED BY tests/crossing/run.cjs · the scenarios (through the ctx they get)
 * FLOW      makeCtx(topo, flags) → ctx ; ctx.shop(key) signs in on first use ; ctx.recorder(id) → { check, known, note } whose result the runner turns into PASS / FAIL / KNOWN
 * Every run makes its OWN uniquely tagged chits (subject starts "[CTPX <run id>]") and never deletes anything.
 */
const crypto = require('crypto');
const secretLib = require('./secret.cjs');
const client = require('./client.cjs');
const db = require('./db.cjs');
const topology = require('./topology.cjs');

/** a run id that sorts by time and cannot collide: x + yymmddHHMMSS + 3 hex */
function newRunId(now) {
  const d = new Date(now == null ? Date.now() : now);
  const p = (n) => String(n).padStart(2, '0');
  return 'x' + String(d.getUTCFullYear()).slice(2) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + crypto.randomBytes(2).toString('hex').slice(0, 3);
}

/** collects the checks of one scenario */
function recorder(id) {
  const rec = { id, checks: [], knownItems: [], notes: [] };
  rec.check = (ok, what, detail) => {
    rec.checks.push({ ok: !!ok, what, detail: ok ? undefined : detail });
    return !!ok;
  };
  /** a documented open finding: does NOT fail the run while open; says so loudly when it now passes (then remove the KNOWN) */
  rec.known = (finding, ok, what) => {
    rec.knownItems.push({ finding, ok: !!ok, what });
    return !!ok;
  };
  rec.note = (text) => rec.notes.push(String(text));
  return rec;
}

function makeCtx(topo, flags) {
  const f = flags || {};
  const runId = f.runId || newRunId();
  const secrets = new Map();
  const shops = new Map();
  const entityIds = new Map();
  const ctx = {
    topo,
    flags: f,
    runId,
    tag: '[CTPX ' + runId + ']',
    state: {}, // shared between scenarios of one run (chit ids, supplier ids)
    subject: (text) => '[CTPX ' + runId + '] ' + text,
    secret: async (inst) => {
      if (!secrets.has(inst)) secrets.set(inst, await secretLib.read(topo, inst));
      return secrets.get(inst);
    },
    shop: async (key) => {
      if (!shops.has(key)) {
        const row = Object.assign({ key }, topo.shops[key]);
        if (!topo.shops[key]) throw new Error('no shop ' + key + ' in topology.json');
        shops.set(key, await client.signIn(topo, row, await ctx.secret(row.installation)));
      }
      return shops.get(key);
    },
    q: (inst, sql) => db.q(topo, inst, sql),
    /** the entity id of a shop on ITS installation, by user_id (cached) */
    entityId: async (key) => {
      if (!entityIds.has(key)) {
        const shop = topo.shops[key];
        const rows = await db.q(topo, shop.installation, 'SELECT identity_id FROM identities WHERE lower(user_id) = ' + db.lit(shop.user_id.toLowerCase()) + ' LIMIT 1');
        if (!rows.length) throw new Error('shop ' + key + ' (' + shop.user_id + ') has no identity on ' + shop.installation + ': is it registered there?');
        entityIds.set(key, rows[0].identity_id);
      }
      return entityIds.get(key);
    },
    pair: (id) => topology.pairOf(topo, id),
    recorder
  };
  return ctx;
}

module.exports = { makeCtx, newRunId, recorder };
