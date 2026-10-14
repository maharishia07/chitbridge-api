/**
 * ── lib/reward-store.js · WHERE A REWARD BALANCE IS READ AND WRITTEN ───────────────────────────────────────────
 *
 * lib/rewards.js is the ENGINE: pure, no database, it knows what a point is worth and nothing about where one is
 * kept. This is the other half — the four database operations every caller needs, in one place.
 *
 * ⭐⭐ IT EXISTS BECAUSE THERE ARE NOW TWO CALLERS. The counter awards and encashes (routes/till.js); the shop looks
 * at what a customer holds (routes/relationships.js). The moment the second one appeared, copying the query would
 * have created two readers of one balance — and two readers eventually disagree about what somebody is owed, which
 * is the single thing a loyalty scheme cannot survive. Athi's standing rule: a second call site means extract the
 * helper NOW, not later.
 *
 * ⚠️ EVERY WRITE IS AN APPEND. reward_ledger is append-only by GRANT (b213) — cb_app may INSERT and SELECT and
 * nothing else. There is deliberately no update() and no delete() here to reach for: a mistake is corrected by
 * writing the opposite entry, which leaves both the error and the correction readable.
 */
const rewards = require('./rewards');

/** ⭐ THE ONE PROGRAMME READER. A shop runs at most one live programme — two would mean a bill earning twice and no
 *  sensible answer to which balance a redemption came out of. */
async function programme(entity_id, withEntity) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT d.definition_id, d.name, v.rules
       FROM definition d
       JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
      WHERE d.entity_id = $1 AND d.kind = 'reward' AND d.status = 'live'
      ORDER BY d.created_at LIMIT 1`, [entity_id]));
  if (!r.rows[0]) return null;
  return Object.assign({ definition_id: r.rows[0].definition_id, name: r.rows[0].name }, r.rows[0].rules || {});
}

/** ⚠️ HOW MANY MOVEMENTS a screen is shown beside the balance. The BALANCE never reads a page of rows — it is the SUM of every row
 *  (T1-FINREW REW-L1, 2026-10-14: the fold over "the newest 500" was wrong for a customer with 600 entries). */
const RECENT = 50;

/**
 * ⭐⭐ WHAT A HOLDER HAS, ON ONE TRANSACTION HANDLE — every reader and every writer goes through this, so the balance a customer is
 * shown and the balance a spend or a claim is checked against are the same query.
 *   1 · SUM(points) over the WHOLE ledger for the holder (a window SUM, so the same trip brings the newest RECENT rows to show);
 *   2 · only when the programme declares expiry: the earnings old enough to have run out that have NO 'expired' row yet. Without that
 *       NOT EXISTS an expiry already written would be counted twice (the stored row + the engine re-emitting it). The engine
 *       (rewards.expired) still decides each one — SQL only narrows the candidates, it never answers a date.
 * The fold is the engine's own: rewards.balanceOf over [the stored sum] + the expiries still to write.
 */
async function balanceOn(db, entity_id, holder, prog) {
  const r = await db.query(
    `SELECT points, why, ref, note, at, SUM(points) OVER () AS total FROM reward_ledger
       WHERE entity_id = $1 AND holder_scheme = $2 AND holder_value = $3
       ORDER BY at DESC LIMIT $4`, [entity_id, holder.scheme, holder.value, RECENT]);
  const stored = r.rows.length ? Number(r.rows[0].total) : 0;
  const entries = r.rows.map(rowOf);
  const months = Math.floor(Number(prog && prog.expires_months) || 0);
  let gone = [];
  if (months > 0) {
    const c = await db.query(
      `SELECT e.points, e.why, e.ref, e.note, e.at FROM reward_ledger e
         WHERE e.entity_id = $1 AND e.holder_scheme = $2 AND e.holder_value = $3 AND e.why = 'earned' AND e.points > 0
           AND e.at + make_interval(months => $4) <= now()
           AND NOT EXISTS (SELECT 1 FROM reward_ledger x WHERE x.entity_id = e.entity_id AND x.holder_scheme = e.holder_scheme
                             AND x.holder_value = e.holder_value AND x.why = 'expired' AND x.ref IS NOT DISTINCT FROM e.ref)`,
      [entity_id, holder.scheme, holder.value, months]);
    gone = rewards.expired(prog, c.rows.map(rowOf));
  }
  const b = rewards.balanceOf([{ points: stored }].concat(gone));
  return { points: b.points, negative: b.negative, entries, expired: gone };
}
const rowOf = (x) => ({ points: Number(x.points), why: x.why, ref: x.ref, note: x.note, at: x.at instanceof Date ? x.at.toISOString() : String(x.at) });

/** ⚠️ ONE HOLDER AT A TIME: two counters touching the same balance queue behind each other until the transaction ends, so a claim
 *  or a spend is always checked against the balance it is written on. Holders are locked in one order, so two claims never deadlock. */
async function lockOn(db, entity_id, holders) {
  const keys = holders.map((h) => entity_id + '|' + h.scheme + '|' + h.value).sort();
  for (const k of keys) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [k]);
}

/**
 * ⚠️ ONE WRITER, because every path appends the same shape and a second INSERT would eventually differ from it.
 * A replayed bill meets the unique index and writes nothing — that is the point (ON CONFLICT DO NOTHING). But a CLAIM is two halves
 * that must both land: `strict` makes a half that did not land throw, and the caller's transaction undoes the other half.
 */
async function writeOn(db, entity_id, holder, rows, definition_id, strict) {
  let n = 0;
  for (const e of rows.filter(Boolean)) {
    const h = e.holder || holder;
    const r = await db.query(
      `INSERT INTO reward_ledger (entity_id, holder_scheme, holder_value, points, why, ref, note, definition_id, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, now()))
       ON CONFLICT DO NOTHING RETURNING entry_id`,
      [entity_id, h.scheme, h.value, e.points, e.why, e.ref || null, e.note || null, definition_id || null, e.at || null]);
    const landed = (r && r.rows ? r.rows.length : 0) > 0;
    if (!landed && strict) throw Object.assign(new Error('This claim was already recorded. Nothing moved.'), { status: 409, code: 'CLAIM_RECORDED', say: 'This claim was already recorded. Nothing moved.' });
    if (landed) n++;
  }
  return n;
}

/**
 * ⭐⭐ WHAT SOMEBODY HOLDS, WITH EXPIRY ALREADY APPLIED — the one answer every screen quotes.
 *
 * ⚠️ EXPIRY IS FOLDED ON THE WAY OUT, not by a nightly job. A sweep would have to run somewhere, be monitored, and
 * would still leave a window in which a customer is shown points the next bill refuses. Folding it here means the
 * number quoted is always the number that can be spent; the entries it produces are WRITTEN the next time that
 * balance is touched, so the ledger catches up on use rather than on a timer.
 * ⚠️ AND THE EXPIRED ENTRIES COME BACK with the answer rather than being applied silently — the caller that is
 * about to write anyway persists them, and the caller that is only looking does not have to.
 */
async function balance(entity_id, holder, withEntity, prog) {
  const p = prog || await programme(entity_id, withEntity);
  if (!p) return { programme: null, points: 0, worth: 0, entries: [], expired: [], negative: false };
  const b = await withEntity(entity_id, (db) => balanceOn(db, entity_id, holder, p));
  return { programme: p, points: b.points, worth: rewards.liability(p, b.points), negative: b.negative, entries: b.entries, expired: b.expired };
}

/**
 * ⭐ A BILL'S POINTS, IN ONE TRANSACTION: the holder locked, the balance read, the expiries due + the spend + the earning written
 * together — all of them or none. Returns the balance BEFORE this bill (the counter reports what changed against it).
 */
async function settle(entity_id, holder, prog, o, withEntity) {
  return withEntity(entity_id, async (db) => {
    await lockOn(db, entity_id, [holder]);
    const before = await balanceOn(db, entity_id, holder, prog);
    const rows = before.expired.slice();
    if (o.spend > 0) rows.push(rewards.entry({ points: -o.spend, why: 'spent', ref: o.ref, note: 'encashed on this bill' }));
    if (o.added > 0) rows.push(rewards.entry({ points: o.added, why: 'earned', ref: o.ref, note: 'bill ' + o.ref }));
    await writeOn(db, entity_id, holder, rows, prog.definition_id, false);
    return before;
  });
}

/**
 * ⭐⭐ A CLAIM — a phone-held balance moved onto an account (rewards.claim: two entries netting to zero) — ALL OR NOTHING.
 * Both holders locked, the balance read on the same handle, the due expiries written, then both halves; a half that does not land
 * (its ref already used) throws CLAIM_RECORDED and the transaction undoes everything. The ONE claim path: the counter
 * (routes/till.js /reward/claim) and the CRM's walk-in → customer (routes/crm.js /walk-ins/add) both call it.
 * → { ok, why, points } — ok false (nothing written) when the engine refuses (nothing to claim, same holder, …).
 */
async function claim(entity_id, from, to, ref, prog, withEntity) {
  return withEntity(entity_id, async (db) => {
    await lockOn(db, entity_id, [from, to]);
    const bal = await balanceOn(db, entity_id, from, prog);
    const c = rewards.claim(bal, from, to, ref);
    if (!c.ok) return { ok: false, why: c.why, points: 0 };
    await writeOn(db, entity_id, from, bal.expired, prog.definition_id, false);
    /* ⚠️ each half lands under ITS OWN holder — the entry carries it */
    await writeOn(db, entity_id, from, c.entries, prog.definition_id, true);
    return { ok: true, why: null, points: c.points };
  });
}

/** the (scheme, value) pair off a query string or a body, through the ENGINE so every caller agrees who is who */
function holderFrom(o) {
  if (!o) return null;
  if (o.scheme && o.value) {
    const s = String(o.scheme), v = String(o.value).trim();
    return (['identity', 'phone'].indexOf(s) >= 0 && v) ? { scheme: s, value: v } : null;
  }
  return rewards.holderOf(o);
}

module.exports = { programme, balanceOn, lockOn, writeOn, balance, settle, claim, holderFrom, RECENT };
