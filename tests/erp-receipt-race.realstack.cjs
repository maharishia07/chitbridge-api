'use strict';
/**
 * tests/erp-receipt-race.realstack.cjs — two retries of one FAILED (or stale pending) ERP receipt, at the same moment, on a REAL Postgres: exactly one claims it (CON-ERP-IDEM).
 *
 * OWNS      the real-database proof of lib/erp-receipt.js claimReceipt: the re-claim is one UPDATE with one winner, and a second concurrent claimer is told in_progress (not claimed twice).
 * CALLED BY by hand on a SIT box (not in scripts/guards.cjs: it needs Postgres with migration b852 run).
 * RUN       CB_RACE_DB=postgres://user:pass@host:5432/dbname node tests/erp-receipt-race.realstack.cjs        (SIT only; it writes then deletes its own two rows, under a made-up entity and actor id)
 * CARD      28-platform-and-operations/connectors-routes
 * Cases     R1 a failed receipt, 8 concurrent claimers → exactly 1 claimed, 7 in_progress · R2 a pending receipt older than the stale limit, 8 concurrent claimers → exactly 1 claimed
 *           R3 a fresh pending receipt → nobody claims it (all in_progress) · R4 a done receipt → all duplicate · R5 the same header key with another body → all conflict
 * Exit 0 all hold · 1 a case failed · 3 refused (no CB_RACE_DB, or the column idem_key is missing: run b852 first).
 */
const crypto = require('crypto');
const target = process.env.CB_RACE_DB;
if (!target) { console.error('REFUSED: set CB_RACE_DB to a SIT database (never production)'); process.exit(3); }
process.env.DATABASE_URL = target;
const { Pool } = require('pg');
const { claimReceipt, PENDING_STALE_MINUTES } = require('../lib/erp-receipt');

const ENTITY = crypto.randomUUID();
const ACTOR = crypto.randomUUID();
const CLAIMERS = 8;
const MINUTE_MS = 60 * 1000;
const results = [];
const check = (name, condition, seen) => { results.push(condition); console.log((condition ? '  ok   ' : '  FAIL ') + name + (condition ? '' : '  ' + JSON.stringify(seen))); };

/** a receipt row, written as the table's owner would (RLS is bypassed by the connection's role on a SIT box; if it is not, the insert says so) */
async function seed(pool, { key, hash, outcome, ageMinutes }) {
  await pool.query(
    `INSERT INTO connector_receipt (receipt_id, entity_id, actor_id, doc_type, doc_ref, payload_hash, outcome, idem_key, received_at) VALUES ($1,$2,$3,'invoice',NULL,$4,$5,$6,$7)`,
    [crypto.randomUUID(), ENTITY, ACTOR, hash, outcome, key, new Date(Date.now() - ageMinutes * MINUTE_MS)]
  );
}
const claimAll = (hash, key) => Promise.all(Array.from({ length: CLAIMERS }, () => claimReceipt({ entityId: ENTITY, actorId: ACTOR, docType: 'invoice', docRef: null, payloadHash: hash, idempotencyKey: key })));
const count = (answers, state) => answers.filter((answer) => answer.state === state).length;

(async () => {
  const pool = new Pool({ connectionString: target });
  const hasKey = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'connector_receipt' AND column_name = 'idem_key'`);
  if (!hasKey.rows.length) { console.error('REFUSED: connector_receipt.idem_key is missing, run migration b852 first'); process.exit(3); }
  try {
    const cases = [
      ['R1 a failed receipt, concurrent claimers: exactly one claims it', 'failed', 0, (a) => count(a, 'claimed') === 1 && count(a, 'in_progress') === CLAIMERS - 1],
      ['R2 a pending receipt past the stale limit: exactly one claims it', 'pending', PENDING_STALE_MINUTES + 1, (a) => count(a, 'claimed') === 1],
      ['R3 a fresh pending receipt: nobody claims it', 'pending', 0, (a) => count(a, 'claimed') === 0 && count(a, 'in_progress') === CLAIMERS],
      ['R4 a done receipt: every claimer is told duplicate', 'processed', 0, (a) => count(a, 'duplicate') === CLAIMERS],
    ];
    for (const [name, outcome, ageMinutes, holds] of cases) {
      const hash = crypto.randomUUID();
      await seed(pool, { key: 'p:' + hash, hash, outcome, ageMinutes });
      const answers = await claimAll(hash, undefined);
      check(name, holds(answers), answers.map((answer) => answer.state));
    }
    const header = 'order-' + crypto.randomUUID(), bodyOne = crypto.randomUUID(), bodyTwo = crypto.randomUUID();
    await seed(pool, { key: 'h:' + crypto.createHash('sha256').update(header).digest('hex'), hash: bodyOne, outcome: 'processed', ageMinutes: 0 });
    const conflicts = await Promise.all(Array.from({ length: CLAIMERS }, () => claimReceipt({ entityId: ENTITY, actorId: ACTOR, docType: 'invoice', docRef: null, payloadHash: bodyTwo, idempotencyKey: header })));
    check('R5 the same Idempotency-Key with another body: every claimer is told conflict', count(conflicts, 'conflict') === CLAIMERS, conflicts.map((answer) => answer.state));
  } finally {
    await pool.query(`DELETE FROM connector_receipt WHERE actor_id = $1`, [ACTOR]);
    await pool.end();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log('\n' + (failed ? 'FAIL' : 'ok') + ' — ' + (results.length - failed) + ' held, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
