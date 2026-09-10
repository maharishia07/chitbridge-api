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
const lotfields = require('./lotfields');

const DEFAULT_LOCATION = 'default';   /* v1 is one location (Athi, 2026-09-10). The column exists; nothing reads it. */
/* ⚠️ EMPTY STRING, NEVER NULL — a NULL in a primary key does not compare equal to itself, so two untracked
   balances for one product would be two rows nothing could ever find or merge. '' is a real value meaning
   "one pool", and it keeps the key uniform whether a product tracks batches or not. */
const NO_LOT = '';

/** ⚠️ ONE READER of a balance, so what a screen shows and what a movement is applied to cannot come from two queries */
async function balanceOf(entity_id, item_id, withEntity, location, lot) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT qty, value, avg_cost, unit, last_at, moves FROM stock_balance
      WHERE entity_id = $1 AND item_id = $2 AND location = $3 AND lot = $4`,
    [entity_id, item_id, location || DEFAULT_LOCATION, lotfields.lotKey(lot)]));
  const b = r.rows[0];
  return b ? { qty: Number(b.qty), value: Number(b.value), avg_cost: Number(b.avg_cost), unit: b.unit || null,
               at: b.last_at instanceof Date ? b.last_at.toISOString() : b.last_at, moves: Number(b.moves) }
           : { qty: 0, value: 0, avg_cost: 0, unit: null, at: null, moves: 0 };
}

/** every movement for one product, oldest first — what a rebuild replays and what a dispute is settled from */
async function movementsOf(entity_id, item_id, withEntity, location, lot) {
  /* ⚠️ WHEN A LOT IS GIVEN THE FILTER MUST APPLY, and when it is not, every batch comes back. A rebuild of a
     tracked product replays each batch against its OWN balance — replaying them all against one would produce a
     total that is correct and a per-batch answer that is nonsense, which is worse than either alone. */
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT movement_id, qty, rate, value_delta, unit, reason, ref, line_ref, lot, note, at
       FROM stock_movement
      WHERE entity_id = $1 AND item_id = $2 AND location = $3
        AND ($4::text IS NULL OR COALESCE(lot, '') = $4)
      ORDER BY at, movement_id`,
    [entity_id, item_id, location || DEFAULT_LOCATION, lot == null ? null : lotfields.lotKey(lot)]));
  return r.rows.map((x) => ({
    movement_id: x.movement_id, item_id,
    qty: Number(x.qty), rate: x.rate == null ? null : Number(x.rate),
    value_delta: x.value_delta == null ? null : Number(x.value_delta), unit: x.unit || null,
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
  const lot = lotfields.lotKey(mv.lot);
  const ok = inventory.check(mv);
  if (!ok.ok) return { ok: false, why: ok.why };

  /**
   * ⚠️⚠️ TRACKED STOCK CANNOT COME IN WITHOUT A BATCH. A receipt with no batch number would create a nameless
   * pool alongside the named ones, and the day a recall came it would be the pool nobody could clear. lotfields
   * already refuses a consignment missing a required field at the door; this is the same rule one layer down,
   * where it is the last thing standing between a bad receipt and a permanent row.
   */
  if (mv.tracked && !lot && inventory.REASONS[mv.reason] && inventory.REASONS[mv.reason].dir === 'in')
    return { ok: false, why: 'this product is kept per batch, so stock cannot be received without a batch number' };

  return withEntity(entity_id, async (db) => {
    /**
     * ⚠️⚠️ LOCK AND VALIDATE BEFORE ANYTHING IS WRITTEN — and the order here was WRONG until a test caught it.
     *
     * The movement used to be inserted first, so the idempotency index rather than the application decided
     * whether it had already happened. That reasoning is sound for the duplicate case and quite wrong for the
     * refusal case: some checks need the BALANCE (the unit this stock is counted in), so they can only run after
     * the lock — and by then the movement was already in an APPEND-ONLY table. A refused movement therefore left
     * a permanent orphan row that no balance reflected and nothing could delete.
     *
     * ⭐ Locking first fixes both. The row is held for the whole transaction, so the idempotent INSERT below is
     * still the thing that decides a duplicate — nobody else can slip between the two — and a refusal now happens
     * with nothing written. Consistent lock ordering is also what keeps two counters from deadlocking each other.
     */
    await db.query(
      /* ⚠️ item_kind says which LIST the id points into — a supply and a product could otherwise share an
         id space and nothing could tell two balances apart (b217). */
      `INSERT INTO stock_balance (entity_id, item_id, location, lot, expires_at, item_kind)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [entity_id, mv.item_id, location, lot, mv.expires_at || null, mv.item_kind || 'catalogue']);
    const cur = await db.query(
      `SELECT qty, value, avg_cost, unit FROM stock_balance
        WHERE entity_id = $1 AND item_id = $2 AND location = $3 AND lot = $4 FOR UPDATE`,
      [entity_id, mv.item_id, location, lot]);
    const before = { qty: Number(cur.rows[0].qty), value: Number(cur.rows[0].value),
                     avg_cost: Number(cur.rows[0].avg_cost), unit: cur.rows[0].unit || null };

    /**
     * ⚠️ THE WEIGHTED AVERAGE IS WHY THE LOCK EXISTS AT ALL. It depends on the balance at the moment it is
     * applied, so unlike quantity it cannot be expressed as `+ $delta` — two simultaneous receipts reading the
     * same starting point would compute two different averages and one would win at random.
     */
    const after = inventory.apply(before, mv);
    if (!after.ok) return { ok: false, why: after.why };     /* refused, and NOTHING has been written */

    const ins = await db.query(
      `INSERT INTO stock_movement
         (entity_id, item_id, location, qty, rate, value_delta, unit, reason, ref, line_ref, lot, note, at, created_by, expires_at, item_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, now()),$14,$15,$16)
       ON CONFLICT DO NOTHING
       RETURNING movement_id, at`,
      [entity_id, mv.item_id, location, inventory.signedQty(mv),
       mv.rate == null ? null : mv.rate, mv.value_delta == null ? null : mv.value_delta,
       mv.unit || null, mv.reason, mv.ref || null, mv.line_ref || null, lot || null, mv.note || null,
       mv.at || null, o.actor_id || null, mv.expires_at || null, mv.item_kind || 'catalogue']);

    if (!ins.rows.length) {
      /* already recorded — the balance already carries it, so touching it again would double the stock */
      const b = await balanceOf(entity_id, mv.item_id, (e, fn) => fn(db), location, lot);
      return { ok: true, duplicate: true, why: 'this movement was already recorded', balance: b, lot };
    }

    const at = ins.rows[0].at instanceof Date ? ins.rows[0].at.toISOString() : ins.rows[0].at;
    await db.query(
      `UPDATE stock_balance
          SET qty = $4, value = $5, avg_cost = $6, unit = COALESCE(unit, $8),
              expires_at = COALESCE(expires_at, $9::date),
              last_at = GREATEST(COALESCE(last_at, $7::timestamptz), $7::timestamptz),
              moves = moves + 1, updated_at = now()
        WHERE entity_id = $1 AND item_id = $2 AND location = $3 AND lot = $10`,
      [entity_id, mv.item_id, location, after.qty, after.value, after.avg_cost, at, after.unit || null,
       mv.expires_at || null, lot]);

    return { ok: true, duplicate: false, movement_id: ins.rows[0].movement_id, lot,
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
  const lot = o.lot == null ? NO_LOT : lotfields.lotKey(o.lot);
  const stored = await balanceOf(entity_id, item_id, withEntity, location, lot);
  const moves = await movementsOf(entity_id, item_id, withEntity, location, lot);
  const replayed = inventory.replay(moves);
  const agrees = inventory.agrees(stored, replayed) && stored.moves === moves.length;

  if (!agrees && o.repair) {
    /* ⚠️ THE LOG WINS. Never the other way round — the balance is the thing that can be thrown away. */
    await withEntity(entity_id, (db) => db.query(
      `UPDATE stock_balance SET qty = $4, value = $5, avg_cost = $6, moves = $7, updated_at = now()
        WHERE entity_id = $1 AND item_id = $2 AND location = $3 AND lot = $8`,
      [entity_id, item_id, location, replayed.qty, replayed.value, replayed.avg_cost, moves.length, lot]));
  }
  return { agrees, stored, replayed, movements: moves.length,
           refused: replayed.refused, repaired: !agrees && !!o.repair };
}

/**
 * ── ⭐⭐⭐ WHICH BATCHES ARE ON THE SHELF, OLDEST-EXPIRING FIRST ────────────────────────────────────────────────
 *
 * FEFO — first EXPIRED out, not first IN out. The two differ exactly when they matter: a batch received later can
 * expire sooner (a short-dated delivery from a supplier clearing stock), and FIFO would leave it to go out of date
 * on the shelf while the older, longer-dated batch sold. For anything with a date on it, expiry is the order.
 *
 * ⚠️ NULLS LAST — a batch with no expiry recorded is not "expires today", it is "unknown", and putting unknown
 * first would empty the untracked pool before touching the dated stock the rule exists to protect.
 */
async function lotsOf(entity_id, item_id, withEntity, location) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT lot, qty, value, avg_cost, unit, expires_at FROM stock_balance
      WHERE entity_id = $1 AND item_id = $2 AND location = $3 AND qty > 0
      ORDER BY expires_at NULLS LAST, lot`,
    [entity_id, item_id, location || DEFAULT_LOCATION]));
  return r.rows.map((x) => ({ lot: x.lot, qty: Number(x.qty), value: Number(x.value),
    avg_cost: Number(x.avg_cost), unit: x.unit || null,
    expires_at: x.expires_at instanceof Date ? x.expires_at.toISOString().slice(0, 10) : x.expires_at }));
}

/**
 * ── ⭐⭐⭐ ISSUE — take stock OUT, across as many batches as it takes ───────────────────────────────────────────
 *
 * Athi's v1 decision was that the till does not show stock, which means the counter cannot pick a batch and must
 * not be asked to. So the SERVER picks, by FEFO, when the movement arrives. The counter is unchanged and the
 * pharmacy still gets batch-correct stock — those two are only compatible because the picking happens here.
 *
 * ⚠️ ONE SALE LINE CAN BECOME SEVERAL MOVEMENTS. Five strips where the batch expiring Friday holds three: three
 * come off that batch and two off the next. They share a line_ref and differ by lot, which is precisely why b215
 * put the lot into the idempotency index — without it the second movement would be refused as a duplicate and
 * the sale would be short by two, silently.
 *
 * ⚠️⚠️ AND IT NEVER REFUSES FOR WANT OF STOCK. An offline counter cannot know what is on the shelf, so a sale is
 * never blocked (the design note, and the till's own rule 4). What cannot be covered goes NEGATIVE against the
 * earliest-expiring batch — or against the untracked pool when there is no batch at all, which is the honest
 * record of "we sold something we have no receipt for" and is what a count later corrects.
 */
async function issue(entity_id, mv, withEntity, opts) {
  const location = mv.location || DEFAULT_LOCATION;
  /* an untracked product, or a caller who named the batch, is one ordinary movement */
  if (!mv.tracked || lotfields.lotKey(mv.lot)) {
    const one = await post(entity_id, mv, withEntity, opts);
    return { ok: one.ok, why: one.why, parts: one.ok ? [one] : [], moved: one.ok && !one.duplicate ? 1 : 0,
             duplicate: one.duplicate ? 1 : 0, short: 0 };
  }

  const want = inventory.q3(Math.abs(Number(mv.qty) || 0));
  const lots = await lotsOf(entity_id, mv.item_id, withEntity, location);
  const parts = [];
  let left = want, moved = 0, duplicate = 0;

  for (const l of lots) {
    if (left <= 0) break;
    const take = inventory.q3(Math.min(left, l.qty));
    if (take <= 0) continue;
    const r = await post(entity_id, Object.assign({}, mv, { qty: take, lot: l.lot, tracked: true }), withEntity, opts);
    parts.push(Object.assign({ lot: l.lot, qty: take, expires_at: l.expires_at }, r));
    if (r.ok && !r.duplicate) moved++;
    if (r.ok && r.duplicate) duplicate++;
    if (r.ok) left = inventory.q3(left - take);
  }

  /* ⚠️ THE SHORTFALL IS RECORDED, NOT DROPPED. It goes against the batch it would have come from had there been
     enough, so the negative sits where somebody counting will find it. */
  if (left > 0) {
    const onto = lots.length ? lots[0].lot : NO_LOT;
    const r = await post(entity_id, Object.assign({}, mv, { qty: left, lot: onto, tracked: true }), withEntity, opts);
    parts.push(Object.assign({ lot: onto, qty: left, short: true }, r));
    if (r.ok && !r.duplicate) moved++;
    if (r.ok && r.duplicate) duplicate++;
  }

  const failed = parts.filter((p) => !p.ok);
  return { ok: !failed.length, why: failed.length ? failed[0].why : null,
           parts, moved, duplicate, short: left > 0 ? left : 0 };
}

/** the shop's whole shelf, for a report — never for a loop that then asks per item */
async function sheet(entity_id, withEntity, opts) {
  const o = opts || {};
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT b.item_id, b.lot, b.expires_at, b.qty, b.value, b.avg_cost, b.last_at, b.moves
       FROM stock_balance b
      WHERE b.entity_id = $1 AND b.location = $2
        AND ($3::boolean IS NOT TRUE OR b.qty <> 0)
      ORDER BY b.value DESC
      LIMIT $4`,
    [entity_id, o.location || DEFAULT_LOCATION, o.nonzero === true, o.limit || 5000]));
  const rows = r.rows.map((x) => ({ item_id: x.item_id, lot: x.lot || '',
    expires_at: x.expires_at instanceof Date ? x.expires_at.toISOString().slice(0, 10) : x.expires_at,
    qty: Number(x.qty), value: Number(x.value),
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

module.exports = { DEFAULT_LOCATION, NO_LOT, balanceOf, movementsOf, post, issue, lotsOf, rebuild, sheet, shrinkage };
