'use strict';
/**
 * routes/health.js — GET /health: the uptime probe's door (moved out of server.js, answering byte for byte as before).
 * OWNS      the health answer: status, version, the database state (E07) and the process counters (audit lost, money mismatches, output keys dropped, legacy tokens).
 * CALLED BY server.js (app.use('/health')) · the host's health check · the uptime probe · lib/plumbing-contract.js (its operation).
 * FLOW      one `SELECT 1` given 2 s → db ok | slow | down → 200 either way; a fault outside that check → next(err) → the app's one error handler (a Problem 500)
 * CARD      28-platform-and-operations/api-standard
 */
const express = require('express');
const { HEALTH } = require('../lib/plumbing-contract');
const log = require('../lib/logger');

const router = express.Router();

router.get('/', ...HEALTH.checked('GET /'), async (req, res, next) => {
  try {
    /* E07: one `SELECT 1`, given 2 s — db 'ok' under DB_SLOW_MS, 'slow' over it, 'down' when it fails or never answers.
       The status stays 200 either way: this says how the database is, it does not take the API out of rotation. */
    let db = 'down',
      db_ms = null;
    try {
      const askedAt = Date.now();
      await Promise.race([require('../db').query('SELECT 1'), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2000).unref())]);
      db_ms = Date.now() - askedAt;
      db = db_ms > require('../lib/dbwatch').slowMs() ? 'slow' : 'ok';
    } catch (failure) {
      log.fellBack('health: the database did not answer SELECT 1 - reported as down', failure, 'debug'); /* the probe still gets its 200; db says down */
    }
    res.json({
      status: 'OK',
      platform: 'Chit and Bridge',
      version: require('../package.json').version /* E07: from package.json, not a literal */,
      db,
      db_ms,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      /* which build answers — Railway sets this; it is how a spec that fails right after a push tells 'not deployed yet' from 'broken' */
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || null,
      region: process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || null,
      web: require('../lib/public-base').webBase() || null /* HX1: the site this api serves (PUBLIC_WEB_BASE) — a counter learns it here */,
      /* SEC-SMALL: IAM audit rows this process could not write since boot (lib/access-events.lostCount) — a reviewer wants to see 0 */
      audit_lost: require('../lib/access-events').lostCount(),
      /* ACC-206 B: support tickets this process raised for a money mismatch since boot (lib/money-check) — cb-health reads it daily; anything above 0 is our defect to find */
      money_mismatch: require('../lib/money-check').count(), ...require('../lib/send-money').absentCounts() /* CTR-246: send_bridge_absent · send_heads_absent — bills passed from an old till build; 0 for 14 days → the check tightens */, ...require('../lib/books-reconcile').health() /* ACC-266: books_unposted · books_unposted_oldest_s · books_reconcile_age_s · swallow counters */,
      /* S34: keys the output allow-list would drop (OUTPUT_ALLOWLIST=report, the default) or dropped (enforce) since boot — Athi switches production to enforce after 7 days at 0 */
      output_dropped: require('../lib/output-allowlist').droppedCount(),
      /* K-SEC PR A: tokens with no jti since boot — minted · customer_minted · used · refused, and whether LEGACY_TOKEN_REFUSE is on.
         Athi turns the refusal on after 7 days of minted: 0 here (SECURITY-BACKLOG.md) */
      legacy_tokens: require('../lib/person-session').legacyCounts()
    });
  } catch (err) {
    next(err);
  }
});

router.openapi = { paths: HEALTH.pathsOf(), schemas: {} };
module.exports = router;
