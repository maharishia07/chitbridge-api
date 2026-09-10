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

/** ⚠️ ONE READER for a holder's rows, so the balance a customer is shown and the balance a spend is checked against
 *  can never come from two different queries. */
async function entriesOf(entity_id, holder, withEntity, limit) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT points, why, ref, note, at FROM reward_ledger
       WHERE entity_id = $1 AND holder_scheme = $2 AND holder_value = $3
       ORDER BY at DESC LIMIT $4`, [entity_id, holder.scheme, holder.value, limit || 500]));
  return r.rows.map((x) => ({ points: Number(x.points), why: x.why, ref: x.ref, note: x.note,
                              at: x.at instanceof Date ? x.at.toISOString() : String(x.at) }));
}

/** ⚠️ ONE WRITER, because every path appends the same shape and a second INSERT would eventually differ from it. */
async function append(entity_id, holder, e, definition_id, withEntity) {
  await withEntity(entity_id, (db) => db.query(
    `INSERT INTO reward_ledger (entity_id, holder_scheme, holder_value, points, why, ref, note, definition_id, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, now()))
     ON CONFLICT DO NOTHING`,
    [entity_id, holder.scheme, holder.value, e.points, e.why, e.ref || null, e.note || null,
     definition_id || null, e.at || null]));
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
  const entries = await entriesOf(entity_id, holder, withEntity);
  const gone = rewards.expired(p, entries);
  const b = rewards.balanceOf(entries.concat(gone));
  return { programme: p, points: b.points, worth: rewards.liability(p, b.points),
           negative: b.negative, entries, expired: gone };
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

module.exports = { programme, entriesOf, append, balance, holderFrom };
