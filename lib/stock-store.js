/**
 * ── lib/stock-store.js · WHERE A STOCK BALANCE IS KEPT, AND HOW IT MOVES ───────────────────────────────────────
 *
 * `lib/inventory.js` is the ENGINE: pure, no database, it knows what a movement does to a balance. This is the
 * other half — the log, the consolidated number, and the one operation that moves both together.
 *
 * ⭐⭐⭐ THE WHOLE POINT OF THIS FILE IS THAT `post()` IS THE ONLY WAY IN. A movement written without moving the
 * balance, or a balance moved without a movement, is the bug this subject is famous for — and it does not announce
 * itself. It shows up weeks later at a count, as a number nobody can explain.
 *
 * ⚠️⚠️ THE BALANCE IS MOVED WITH ARITHMETIC IN SQL, NEVER READ-THEN-WRITE IN JS. Two counters selling the last
 * packet at the same moment is not a rare case in a shop; it is Saturday. `SET qty = qty + $delta` is resolved by
 * the database under a row lock; a read-modify-write here loses one of the two, silently.
 *
 * ⚠️ WHICH MEANS THE AVERAGE NEEDS CARE. A weighted average is not a delta — it depends on the balance *at the
 * moment it is applied* — so it cannot be expressed as `+ $x`. The row is therefore locked (SELECT … FOR UPDATE)
 * inside the same transaction, the engine computes against what the lock returned, and the write lands before the
 * lock is released. Quantity and value could have been pure deltas; the average is what forces the lock, and
 * pretending otherwise would give two tills two different averages.
 */
// @stage tested
// @stage-note the engine and the log shape are proven (tests/stock-cycle.test.js); b214 is not run and no route
// @stage-note posts a movement yet. stock_movement is append-only, so the rules are settled BEFORE anything writes.
const inventory = require('./inventory');

const DEFAULT_LOCATION = 'default';   /* v1 is one location (Athi, 2026-09-10). The column exists; nothing reads it. */

/** ⚠️ ONE READER of a balance, so what a screen shows and what a movement is applied to cannot come from two queries */
async function balanceOf(entity_id, item_id, withEntity, location) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT qty, value, avg_cost, last_at, moves FROM stock_balance
      WHERE entity_id = $1 AND item_id = $2 AND location = $3`,
    [entity_id, item_id, location || DEFAULT_LOCATION]));
  const b = r.rows[0];
  return b ? { qty: Number(b.qty), value: Number(b.value), avg_cost: Number(b.avg_cost),
               at: b.last_at instanceof Date ? b.last_at.toISOString() : b.last_at, moves: Number(b.moves) }
           : { qty: 0, value: 0, avg_cost: 0, at: null, moves: 0 };
}

/** every movement for one product, oldest first — what a rebuild replays and what a dispute is settled from */
async function movementsOf(entity_id, item_id, withEntity, location) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT movement_id, qty, rate, value_delta, reason, ref, line_ref, lot, note, at
       FROM stock_movement
      WHERE entity_id = $1 AND item_id = $2 AND location = $3
      ORDER BY at, movement_id`,
    [entity_id, item_id, location || DEFAULT_LOCATION]));
  return r.rows.map((x) => ({
    movement_id: x.movement_id, item_id,
    qty: Number(x.qty), rate: x.rate == null ? null : Number(x.rate),
    value_delta: x.value_delta == null ? null : Number(x.value_delta),
    reason: x.reason, ref: x.ref, line_ref: x.line_ref, lot: x.lot, note: x.note,
    at: x.at instanceof Date ? x.at.toISOString() : String(x.at),
  }));
}

/**
 * ⭐⭐ POST — the only way stock moves. The movement and the balance land in ONE transaction or neither does.
 *
 * ⚠️ THE SIGN IS NOT TAKEN FROM THE CALLER. `qty` is always given as a positive number and the REASON decides the
 * direction (lib/inventory.js). A `sale` posted with a positive quantity would otherwise add stock and would look
 * like a perfectly ordinary row for ever.
 *
 * ⚠️ AND IT IS IDEMPOTENT ON (entity, ref, line_ref, reason). The counter replays its queue as a matter of routine,
 * so the same bill arrives more than once by design. A second arrival is a no-op that reports `duplicate: true`
 * rather than an error — a replay is normal operation, not a fault.
 */
async function post(entity_id, mv, withEntity, opts) {
  const o = opts || {};
  const location = mv.location || DEFAULT_LOCATION;
  const ok = inventory.check(mv);
  if (!ok.ok) return { ok: false, why: ok.why };

  return withEntity(entity_id, async (db) => {
    /* ⚠️ THE INSERT FIRST, so the idempotency index — not the application — decides whether this already happened.
       Checking first and inserting second is a race: two replays can both find nothing and both insert. */
    const ins = await db.query(
      `INSERT INTO stock_movement
         (entity_id, item_id, location, qty, rate, value_delta, reason, ref, line_ref, lot, note, at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now()),$13)
       ON CONFLICT DO NOTHING
       RETURNING movement_id, at`,
      [entity_id, mv.item_id, location, inventory.signedQty(mv),
       mv.rate == null ? null : mv.rate, mv.value_delta == null ? null : mv.value_delta,
       mv.reason, mv.ref || null, mv.line_ref || null, mv.lot || null, mv.note || null,
       mv.at || null, o.actor_id || null]);

    if (!ins.rows.length) {
      /* already recorded — the balance already carries it, so touching it again would double the stock */
      const b = await balanceOf(entity_id, mv.item_id, (e, fn) => fn(db), location);
      return { ok: true, duplicate: true, why: 'this movement was already recorded', balance: b };
    }

    /**
     * ⚠️ LOCK, THEN COMPUTE, THEN WRITE — all inside this transaction. The weighted average depends on the balance
     * at the moment of application, so unlike quantity it cannot be sent as a delta. The lock is what stops two
     * simultaneous receipts computing two different averages from the same starting point.
     * The row may not exist yet: INSERT … ON CONFLICT DO NOTHING first, so there is always something to lock.
     */
    await db.query(
      `INSERT INTO stock_balance (entity_id, item_id, location) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [entity_id, mv.item_id, location]);
    const cur = await db.query(
      `SELECT qty, value, avg_cost FROM stock_balance
        WHERE entity_id = $1 AND item_id = $2 AND location = $3 FOR UPDATE`,
      [entity_id, mv.item_id, location]);
    const before = { qty: Number(cur.rows[0].qty), value: Number(cur.rows[0].value),
                     avg_cost: Number(cur.rows[0].avg_cost) };

    const after = inventory.apply(before, mv);
    if (!after.ok) throw new Error('the movement was written but could not be applied: ' + after.why);

    const at = ins.rows[0].at instanceof Date ? ins.rows[0].at.toISOString() : ins.rows[0].at;
    await db.query(
      `UPDATE stock_balance
          SET qty = $4, value = $5, avg_cost = $6,
              last_at = GREATEST(COALESCE(last_at, $7::timestamptz), $7::timestamptz),
              moves = moves + 1, updated_at = now()
        WHERE entity_id = $1 AND item_id = $2 AND location = $3`,
      [entity_id, mv.item_id, location, after.qty, after.value, after.avg_cost, at]);

    return { ok: true, duplicate: false, movement_id: ins.rows[0].movement_id,
             balance: { qty: after.qty, value: after.value, avg_cost: after.avg_cost, at },
             /* ⚠️ SAID, NOT HIDDEN. Negative stock is allowed on purpose — an offline counter cannot know what is
                on the shelf, so it must never block a sale — but it is a question that needs answering. */
             below_zero: after.qty < 0 };
  });
}

/**
 * ⭐⭐⭐ REBUILD — what makes "the balance is a cache" a checkable claim rather than a slogan.
 * Replays the log in TIMESTAMP order (never arrival order: quantity is commutative and would not care, but value
 * is not — a receipt syncing late from an offline counter changes the average of issues already valued).
 *
 * ⚠️ IT DOES NOT WRITE UNLESS ASKED. The commonest use is "do these agree?", and a checker that silently repairs
 * what it finds destroys the evidence of the very drift it was built to detect.
 */
async function rebuild(entity_id, item_id, withEntity, opts) {
  const o = opts || {};
  const location = o.location || DEFAULT_LOCATION;
  const stored = await balanceOf(entity_id, item_id, withEntity, location);
  const moves = await movementsOf(entity_id, item_id, withEntity, location);
  const replayed = inventory.replay(moves);
  const agrees = inventory.agrees(stored, replayed) && stored.moves === moves.length;

  if (!agrees && o.repair) {
    /* ⚠️ THE LOG WINS. Never the other way round — the balance is the thing that can be thrown away. */
    await withEntity(entity_id, (db) => db.query(
      `UPDATE stock_balance SET qty = $4, value = $5, avg_cost = $6, moves = $7, updated_at = now()
        WHERE entity_id = $1 AND item_id = $2 AND location = $3`,
      [entity_id, item_id, location, replayed.qty, replayed.value, replayed.avg_cost, moves.length]));
  }
  return { agrees, stored, replayed, movements: moves.length,
           refused: replayed.refused, repaired: !agrees && !!o.repair };
}

/** the shop's whole shelf, for a report — never for a loop that then asks per item */
async function sheet(entity_id, withEntity, opts) {
  const o = opts || {};
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT b.item_id, b.qty, b.value, b.avg_cost, b.last_at, b.moves
       FROM stock_balance b
      WHERE b.entity_id = $1 AND b.location = $2
        AND ($3::boolean IS NOT TRUE OR b.qty <> 0)
      ORDER BY b.value DESC
      LIMIT $4`,
    [entity_id, o.location || DEFAULT_LOCATION, o.nonzero === true, o.limit || 5000]));
  const rows = r.rows.map((x) => ({ item_id: x.item_id, qty: Number(x.qty), value: Number(x.value),
    avg_cost: Number(x.avg_cost), at: x.last_at instanceof Date ? x.last_at.toISOString() : x.last_at,
    moves: Number(x.moves) }));
  return { rows, count: rows.length,
           value: inventory.m2(rows.reduce((a, x) => a + x.value, 0)),
           /* ⭐ the number a shopkeeper looks for first: what is on the shelf that should not be */
           below_zero: rows.filter((x) => x.qty < 0).length };
}

/**
 * ⭐ WHAT WAS LOST, AND WHY — the report that pays for reason codes. Without this, shrinkage is a number that is
 * simply wrong; with it, "₹8,400 expired in July" is something a person can act on.
 */
async function shrinkage(entity_id, withEntity, opts) {
  const o = opts || {};
  const kinds = inventory.reasons().filter(inventory.isShrink);
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT m.reason, sum(-m.qty) AS units, count(*)::int AS movements,
            sum(-m.qty * COALESCE(b.avg_cost, 0)) AS value
       FROM stock_movement m
       LEFT JOIN stock_balance b
         ON b.entity_id = m.entity_id AND b.item_id = m.item_id AND b.location = m.location
      WHERE m.entity_id = $1 AND m.reason = ANY($2::text[])
        AND m.at >= COALESCE($3::timestamptz, now() - interval '90 days')
      GROUP BY m.reason ORDER BY value DESC`,
    [entity_id, kinds, o.since || null]));
  return r.rows.map((x) => ({ reason: x.reason, says: inventory.REASONS[x.reason].says,
    units: Number(x.units), movements: x.movements, value: inventory.m2(Number(x.value)) }));
}

module.exports = { DEFAULT_LOCATION, balanceOf, movementsOf, post, rebuild, sheet, shrinkage };
