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
 *
 * OWNS reward_ledger (append-only) · the one programme read (definition kind 'reward')
 * CALLED BY routes/till.js (/reward · /reward/claim) · routes/relationships.js (a customer's points) · routes/crm.js (walk-in → customer)
 * FLOW  POST /api/till/reward → settle(): lockOn → billFor (lib/counter-bill byRef, the SERVER'S bill) → earnedFrom (rewards.earnedOn,
 *       the offers engine's scope test, the shop's catalogue for an on_items rule) → balanceOn → writeOn — one transaction, all or none
 * CARD  08-rewards-and-loyalty/points-and-reward-ledger
 */
const rewards = require('./rewards');
const counterBill = require('./counter-bill');
const categories = require('./categories');
const offersEngine = require('./offers-engine').CBOffers;

/** ⭐ THE ONE PROGRAMME READER. A shop runs at most one live programme — two would mean a bill earning twice and no
 *  sensible answer to which balance a redemption came out of. */
async function programme(entity_id, withEntity) {
  const r = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT d.definition_id, d.name, v.rules
       FROM definition d
       JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
      WHERE d.entity_id = $1 AND d.kind = 'reward' AND d.status = 'live'
      ORDER BY d.created_at LIMIT 1`,
      [entity_id]
    )
  );
  if (!r.rows[0]) return null;
  return Object.assign({ definition_id: r.rows[0].definition_id, name: r.rows[0].name }, r.rows[0].rules || {});
}

/** ⚠️ HOW MANY MOVEMENTS a screen is shown beside the balance. The BALANCE never reads a page of rows — it is the SUM of every row
 *  (T1-FINREW REW-L1, 2026-10-14: the fold over "the newest 500" was wrong for a customer with 600 entries). */
const RECENT = 50;

/**
 * ⭐⭐ WHAT A HOLDER HAS, ON ONE TRANSACTION HANDLE — every reader and every writer goes through this, so the balance a customer is
 * shown and the balance a spend or a claim is checked against are the same query. READING NEVER WRITES: the expiries due ride the
 * answer (`expired`) and only settle() / claim() append them, each once (uq_reward_ledger_once: entity · ref · why · holder).
 *   · no expiry declared — ONE query: SUM(points) over the WHOLE ledger (a window SUM, so the same trip brings the newest RECENT rows);
 *   · expiry declared — the SAME query with no LIMIT (ENG-REW1, engines v1.47.0): the engine's lot fold (rewards.expired → lotsOf) needs
 *     EVERY entry of the holder in time order, because a redemption draws from the oldest earning first and expiry takes only what is
 *     left of each lot, and an expiry already stored is attributed to its lot and never produced again. SQL never answers a date and
 *     never narrows the candidates — the one calculation is the engine's; the old NOT EXISTS query is gone (one trip, not two).
 * The fold is the engine's own: rewards.balanceOf over [the stored sum] + the expiries still to write.
 */
async function balanceOn(db, entity_id, holder, prog) {
  const months = Math.floor(Number(prog && prog.expires_months) || 0);
  /* ⚠️ LIMIT NULL is Postgres for "no limit": the whole ledger when the engine must fold lots, the newest page otherwise */
  const r = await db.query(
    `SELECT points, why, ref, note, at, SUM(points) OVER () AS total FROM reward_ledger
       WHERE entity_id = $1 AND holder_scheme = $2 AND holder_value = $3
       ORDER BY at DESC LIMIT $4`,
    [entity_id, holder.scheme, holder.value, months > 0 ? null : RECENT]
  );
  const stored = r.rows.length ? Number(r.rows[0].total) : 0;
  const all = r.rows.map(rowOf);
  const entries = all.slice(0, RECENT);
  const gone = months > 0 ? rewards.expired(prog, all) : [];
  const b = rewards.balanceOf([{ points: stored }].concat(gone));
  return { points: b.points, negative: b.negative, entries, expired: gone };
}
const rowOf = (x) => ({ points: Number(x.points), why: x.why, ref: x.ref, note: x.note, at: x.at instanceof Date ? x.at.toISOString() : String(x.at) });

/** ⚠️ ONE HOLDER AT A TIME: two counters touching the same balance queue behind each other until the transaction ends, so a claim
 *  or a spend is always checked against the balance it is written on. Holders are locked in one order, so two claims never deadlock. */
async function lockOn(db, entity_id, holders) {
  /* PAY-FIX C3: the ONE lock statement (lib/xact-lock) — the books' party rows take it the same way */
  return require('./xact-lock').lockKeys(
    db,
    entity_id,
    holders.map((item) => item.scheme + '|' + item.value)
  );
}

/**
 * ⚠️ ONE WRITER, because every path appends the same shape and a second INSERT would eventually differ from it.
 * A replayed bill meets the unique index and writes nothing — that is the point (ON CONFLICT DO NOTHING). But a CLAIM is two halves
 * that must both land: `strict` makes a half that did not land throw, and the caller's transaction undoes the other half.
 */
async function writeOn(db, entity_id, holder, rows, definition_id, strict) {
  let index = 0;
  for (const e of rows.filter(Boolean)) {
    const h = e.holder || holder;
    const r = await db.query(
      `INSERT INTO reward_ledger (entity_id, holder_scheme, holder_value, points, why, ref, note, definition_id, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, now()))
       ON CONFLICT DO NOTHING RETURNING entry_id`,
      [entity_id, h.scheme, h.value, e.points, e.why, e.ref || null, e.note || null, definition_id || null, e.at || null]
    );
    const landed = (r && r.rows ? r.rows.length : 0) > 0;
    if (!landed && strict)
      throw Object.assign(new Error('This claim was already recorded. Nothing moved.'), {
        status: 409,
        code: 'CLAIM_RECORDED',
        say: 'This claim was already recorded. Nothing moved.'
      });
    if (landed) index++;
  }
  return index;
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
  const p = prog || (await programme(entity_id, withEntity));
  if (!p) return { programme: null, points: 0, worth: 0, entries: [], expired: [], negative: false };
  const b = await withEntity(entity_id, (db) => balanceOn(db, entity_id, holder, p));
  return { programme: p, points: b.points, worth: rewards.liability(p, b.points), negative: b.negative, entries: b.entries, expired: b.expired };
}

/** a refusal the route answers in words, with the code the counter branches on (the shape CLAIM_RECORDED already uses) */
const refused = (code, sentence) => Object.assign(new Error(sentence), { status: 409, code, say: sentence });

/**
 * ⭐⭐ THE SERVER'S OWN BILL, OR A REFUSAL (REW-T1, W2-REW 2026-10-15). The counter posts the chit first and the points after,
 * under the same number; the points are earned from what the SERVER holds, so a till that mis-stated its basket changes nothing.
 * No chit under this number → BILL_NOT_RECORDED (the shop-PC queue retries it once the bill lands; the web counter had the
 * bill answered before it asked). The same number at ANOTHER moment is another counter's bill — /reconcile's verdict — refused too.
 */
async function billFor(db, entity_id, posted) {
  const bill = await counterBill.byRef(db, entity_id, posted.ref, { lines: true });
  if (!bill) throw refused('BILL_NOT_RECORDED', 'Bill ' + posted.ref + ' has not reached ChitBridge yet, so its points are not recorded. Send the bill first.');
  if (posted.at && bill.billed_at && String(bill.billed_at) !== String(posted.at))
    throw refused(
      'BILL_NOT_RECORDED',
      'Bill ' + posted.ref + " on ChitBridge is a different counter's sale, so this bill's points are not recorded. Send the bill first."
    );
  return bill;
}

/** does this earn rule look at WHICH products were bought? (on_items — the only kind that reads the lines) */
const readsLines = (prog) => !!(prog && prog.earn && prog.earn.kind === 'on_items');

/**
 * ⭐ sku and category NAME for the items on this bill, from the shop's OWN catalogue and category master (the snapshot's own
 * resolution, categories.nameOf) — one batched read of each, on the same handle. A Map so the basket resolves per line in O(1).
 */
async function catalogueOf(db, entity_id, lines) {
  const ids = [...new Set(lines.map((line) => String(line.item_id || '')).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  const known = new Map();
  if (!ids.length) return known;
  const names = await categories.categoryNames(entity_id, { withEntity: (_entity, fn) => fn(db) });
  const result = await db.query('SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = ANY($2::uuid[])', [entity_id, ids]);
  for (const row of result.rows) {
    const data = row.item_data || {};
    known.set(String(row.item_id), { sku: data.sku || data.code || null, category: categories.nameOf(data, names) });
  }
  return known;
}

/** the OFFERS engine's scope test as the rewards engine's ctx.matches — a product earns on the lines an offer would reach */
const scopeMatches = (line, applies_to) => offersEngine.covers({ applies_to }, line);

/** points this bill earns under the programme — the one calculation (rewards.earnedOn) over the server's own bill */
async function earnedFrom(db, entity_id, prog, bill) {
  const lines = Array.isArray(bill.line_items) ? bill.line_items : [];
  const catalogue = readsLines(prog) ? await catalogueOf(db, entity_id, lines) : null;
  return rewards.earnedOn(prog, counterBill.basketOf(bill, catalogue), { matches: scopeMatches });
}

/**
 * ⭐ WALK-D D-F-12: A REPLAY IS ANSWERED WITH WHAT THE FIRST CALL RECORDED. The ledger was always idempotent by (holder, ref, why) - the second call wrote nothing - but its ANSWER was computed afresh
 * ("added 10, points 20"), so a slip printed from the replay showed the points twice. The entries this bill already holds ARE the answer: added = what was earned under this ref, spent = what was
 * encashed, and the balance is simply the balance now (it already holds both). → { added, spent, after } | null when this ref has no entry yet.
 */
async function settledBefore(db, entity_id, holder, ref) {
  const r = await db.query(
    `SELECT why, SUM(points) AS points FROM reward_ledger
      WHERE entity_id = $1 AND holder_scheme = $2 AND holder_value = $3 AND ref = $4 AND why IN ('earned', 'spent') GROUP BY why`,
    [entity_id, holder.scheme, holder.value, ref]
  );
  if (!r.rows.length) return null;
  const held = (why) => Number((r.rows.find((x) => x.why === why) || {}).points || 0); /* the query already summed each reason: one row per why */
  return { added: held('earned'), spent: Math.abs(held('spent')) };
}

/**
 * ⭐ A BILL'S POINTS, IN ONE TRANSACTION: the holder locked, the SERVER'S bill read (o.earn — never the counter's basket), the balance
 * read, the expiries due + the spend + the earning written together — all of them or none.
 *   o = { ref, spend, earn, at? }  earn: may this holder earn (the shop's walk_in_earns) · at: the counter's billed_at, when it says
 * → { before, added }: the balance BEFORE this bill (the counter reports what changed against it) and what the bill earned.
 */
async function settle(entity_id, holder, prog, o, withEntity) {
  return withEntity(entity_id, async (db) => {
    await lockOn(db, entity_id, [holder]);
    const done = await settledBefore(db, entity_id, holder, o.ref);
    if (done) {
      const now = await balanceOn(db, entity_id, holder, prog);
      return { before: now, added: done.added, spent: done.spent, after: now.points, replayed: true };
    }
    const added = o.earn ? await earnedFrom(db, entity_id, prog, await billFor(db, entity_id, o)) : 0;
    const before = await balanceOn(db, entity_id, holder, prog);
    const rows = before.expired.slice();
    if (o.spend > 0) rows.push(rewards.entry({ points: -o.spend, why: 'spent', ref: o.ref, note: 'encashed on this bill' }));
    if (added > 0) rows.push(rewards.entry({ points: added, why: 'earned', ref: o.ref, note: 'bill ' + o.ref }));
    await writeOn(db, entity_id, holder, rows, prog.definition_id, false);
    return { before, added, spent: o.spend, after: rewards.balanceOf([{ points: before.points }].concat(rows)).points, replayed: false }; /* the engine's fold of the balance and the entries just written - no sum here */
  });
}

/**
 * ⭐ AO-F-05 (walk AO, 22 Nov 2026): A RETURN TAKES BACK THE POINTS THE BILL EARNED, PRO RATA. "A refund must never mint points" stopped new points but left the 20 a fully returned bill had earned (AED 0.20 owed for goods no longer sold).
 * The credit note's own money total over the bill's (both the engine's stored figure, counter-bill.pickOf - nothing is recomputed) is the share returned; a return of the whole bill (share >= 1) takes back what is left, every other share
 * floor(earned x share), never more than was earned under that bill in all and never more than the holder still has (the balance never goes below zero). One 'reversed' entry per holder, under the note's own ref
 * (uq_reward_ledger_once: a retry writes nothing). The ledger stays append-only: the earning is not edited, its opposite is written beside it.
 * → { reversed: points taken back (all holders), holders: n } ; 0 when the bill earned nothing (no customer, no programme) or the notes are not both priced.
 */
async function takeBackOnReturn(entity_id, noteChitId, billRef, withEntity) {
  return withEntity(entity_id, async (db) => {
    const note = await db.query('SELECT summary_json FROM chit_header WHERE entity_id = $1 AND chit_id = $2', [entity_id, noteChitId]);
    const bill = await counterBill.byRef(db, entity_id, billRef, { lines: false });
    const billRow = bill ? await db.query('SELECT summary_json FROM chit_header WHERE entity_id = $1 AND chit_id = $2', [entity_id, bill.chit_id]) : null;
    const totalOf = (result) => Math.abs(Number(counterBill.pickOf(result && result.rows && result.rows[0]).total) || 0);
    const returned = totalOf(note), billTotal = totalOf(billRow);
    if (!(returned > 0) || !(billTotal > 0)) return { reversed: 0, holders: 0 };
    const earned = await db.query(
      "SELECT holder_scheme, holder_value, SUM(points) FILTER (WHERE why = 'earned') AS earned, SUM(points) FILTER (WHERE why = 'reversed') AS reversed FROM reward_ledger WHERE entity_id = $1 AND (ref = $2 OR left(ref, length($2) + 1) = $2 || '|') AND why IN ('earned', 'reversed') GROUP BY holder_scheme, holder_value",
      [entity_id, billRef]
    );
    let total = 0, holders = 0;
    for (const row of earned.rows) {
      const holder = { scheme: row.holder_scheme, value: row.holder_value };
      const left = Number(row.earned || 0) + Number(row.reversed || 0); /* reversed entries are negative */
      if (!(left > 0)) continue;
      await lockOn(db, entity_id, [holder]);
      const share = returned / billTotal;
      const due = share >= 1 ? left : Math.min(left, Math.floor(Number(row.earned) * share));
      const now = await balanceOn(db, entity_id, holder, { expires_months: 0 });
      const take = Math.min(due, Math.max(0, now.points));
      if (take <= 0) continue;
      const wrote = await writeOn(db, entity_id, holder, [rewards.entry({ points: -take, why: 'reversed', ref: billRef + '|' + noteChitId, note: 'returned on bill ' + billRef })], null, false);
      if (wrote) { total += take; holders++; }
    }
    return { reversed: total, holders };
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
    const s = String(o.scheme),
      v = String(o.value).trim();
    return ['identity', 'phone'].indexOf(s) >= 0 && v ? { scheme: s, value: v } : null;
  }
  return rewards.holderOf(o);
}

module.exports = { programme, balanceOn, lockOn, writeOn, balance, settle, takeBackOnReturn, claim, holderFrom, RECENT };
