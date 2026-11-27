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

/**
 * ⭐ termsOf(entity_id, withEntity) → the expiry rule a given point lives under: the live programme's, else the newest reward definition that EVER RAN (live once: paused, ended or retired; a draft that never ran is not a term, and an edit of an old retired one does not make it newest). A given point is a PROMISE (Athi 28 Nov
 * 2026, DECISIONS 5d9ed0f7): expiry is part of it, so a programme that stops earning does not remove or extend the term; paused = no NEW earning, nothing else. null: this shop never ran one.
 * ⚠️ The ledger does not store the terms an entry was given under (backlog DRIFT-C5-1), so the programme's CURRENT rule is read; a shop that changes expires_months changes it for points already given.
 */
async function termsOf(entity_id, withEntity) {
  const live = await programme(entity_id, withEntity);
  if (live) return live;
  const r = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT d.definition_id, d.name, v.rules FROM definition d JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.entity_id = $1 AND d.kind = 'reward'
          AND (d.status <> 'draft' OR EXISTS (SELECT 1 FROM definition_status_log sl WHERE sl.definition_id = d.definition_id AND sl.status = 'live'))
        ORDER BY COALESCE((SELECT max(sl.changed_at) FROM definition_status_log sl WHERE sl.definition_id = d.definition_id AND sl.status = 'live'), d.created_at) DESC LIMIT 1`,
      [entity_id]
    )
  );
  return r.rows[0] ? Object.assign({ definition_id: r.rows[0].definition_id, name: r.rows[0].name }, r.rows[0].rules || {}) : null;
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
  const { b, gone } = foldOf(prog, all, stored);
  return { points: b.points, negative: b.negative, entries, expired: gone };
}
/** ⭐ THE ONE FOLD of a holder's stored sum and entries (newest first) into what they hold: the engine's own balanceOf over [the stored sum] + the expiries still to write.
 *  balanceOn (one holder) and walkIns (the whole shop's phones) both call it, so the number a list quotes is the number a till spends (drift cluster 5, 27 Nov 2026). */
function foldOf(prog, allNewestFirst, stored) {
  const months = Math.floor(Number(prog && prog.expires_months) || 0);
  const gone = months > 0 ? rewards.expired(prog, allNewestFirst) : [];
  return { b: rewards.balanceOf([{ points: stored }].concat(gone)), gone };
}

/** the walk-in list cap (CRM list): holders shown at most */
const WALK_CAP = 500;
/**
 * ⭐ walkIns(db, entity_id, prog) → { rows: [{ phone, points, last_at }], truncated, negative } — the phones that hold points and nobody has claimed, each at what the TILL
 * would spend (expiry folded by foldOf), newest activity first. ONE read of the candidates (expiry only lowers a sum, so SUM > 0 loses no live holder), ONE read of their
 * entries when the programme declares expiry; the cap is applied AFTER the fold so a lapsed holder never takes the place of a live one. No programme: the stored sums as before.
 * `negative` counts holders whose fold went below zero (dropped from the list, not hidden from the count).
 */
async function walkIns(db, entity_id, prog) {
  const expires = Math.floor(Number(prog && prog.expires_months) || 0) > 0; /* the cap needs the fold first only when expiry can lower a sum; with none, the read is cut at the cap + 1 */
  const cand = await db.query(
    `SELECT holder_value AS phone, SUM(points)::bigint AS points, MAX(at) AS last_at FROM reward_ledger
      WHERE entity_id = $1 AND holder_scheme = 'phone' GROUP BY holder_value HAVING SUM(points) > 0 ORDER BY MAX(at) DESC${expires ? '' : ' LIMIT ' + (WALK_CAP + 1)}`,
    [entity_id]
  );
  let rows = cand.rows.map((x) => ({ phone: x.phone, points: Number(x.points), last_at: x.last_at }));
  let negative = 0;
  if (expires && rows.length) {
    const entries = await db.query(
      `SELECT holder_value, points, why, ref, note, at FROM reward_ledger WHERE entity_id = $1 AND holder_scheme = 'phone' AND holder_value = ANY($2::text[]) ORDER BY holder_value, at DESC`,
      [entity_id, rows.map((x) => x.phone)]
    );
    const by = new Map();
    for (const e of entries.rows) (by.get(e.holder_value) || by.set(e.holder_value, []).get(e.holder_value)).push(rowOf(e));
    rows = rows.map((x) => ({ ...x, points: foldOf(prog, by.get(x.phone) || [], x.points).b })).filter((x) => {
      if (x.points.negative) negative++;
      return x.points.points > 0;
    }).map((x) => ({ ...x, points: x.points.points }));
  }
  return { rows: rows.slice(0, WALK_CAP), truncated: rows.length > WALK_CAP, negative };
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
  /* ⭐ A GIVEN POINT IS A PROMISE (Athi 28 Nov 2026, DECISIONS 5d9ed0f7): valid within ITS OWN terms whether or not a programme is live. No live programme = no NEW earning and no value rule to price it (worth null), but the
     expiry term stays (termsOf): the holder has what can be spent that day, never the stored sum and never 0 because the programme stopped. */
  if (!p) {
    const terms = await termsOf(entity_id, withEntity); /* the expiry term outlives the programme */
    const b = await withEntity(entity_id, (db) => balanceOn(db, entity_id, holder, terms));
    return { programme: null, points: b.points, worth: null, entries: b.entries, expired: [], negative: b.negative };
  }
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
      /* LENS-P2 platform-07 F1: the same key (the bill's ref) with a different body (the spend) is a refusal in words, never a success: the first call's answer would otherwise be passed off for a spend that was never made. The rule prepareAction holds (same body, other ref / same ref, other body: 409). */
      if (Number(o.spend || 0) !== done.spent) throw refused('REWARD_REF_REUSED', 'This bill reference already recorded ' + done.spent + ' points spent, not ' + Number(o.spend || 0) + '. Nothing moved. Use a new reference for a different spend.');
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
    const totals = await returnTotals(db, entity_id, noteChitId, billRef);
    if (!(totals.returned > 0) || !(totals.billTotal > 0)) return { reversed: 0, holders: 0 };
    const earned = await db.query(
      "SELECT holder_scheme, holder_value, SUM(points) FILTER (WHERE why = 'earned') AS earned, SUM(points) FILTER (WHERE why = 'reversed') AS reversed FROM reward_ledger WHERE entity_id = $1 AND (ref = $2 OR left(ref, length($2) + 1) = $2 || '|') AND why IN ('earned', 'reversed') GROUP BY holder_scheme, holder_value",
      [entity_id, billRef]
    );
    let total = 0, holders = 0;
    for (const row of earned.rows) {
      const taken = await takeBackFromHolder(db, entity_id, row, totals, { billRef, noteChitId });
      if (taken > 0) { total += taken; holders++; }
    }
    return { reversed: total, holders };
  });
}

/** the credit note's money total and the bill's, both the engine's stored figure (counter-bill.pickOf, nothing recomputed); 0 for one that is not priced */
async function returnTotals(db, entity_id, noteChitId, billRef) {
  const note = await db.query('SELECT summary_json FROM chit_header WHERE entity_id = $1 AND chit_id = $2', [entity_id, noteChitId]);
  const bill = await counterBill.byRef(db, entity_id, billRef, { lines: false });
  const billRow = bill ? await db.query('SELECT summary_json FROM chit_header WHERE entity_id = $1 AND chit_id = $2', [entity_id, bill.chit_id]) : null;
  const totalOf = (result) => Math.abs(Number(counterBill.pickOf(result && result.rows && result.rows[0]).total) || 0);
  return { returned: totalOf(note), billTotal: totalOf(billRow) };
}

/** one holder's take-back: lock them, work out the pro-rata share, write ONE 'reversed' entry; returns the points taken (0 when nothing was left or written) */
async function takeBackFromHolder(db, entity_id, row, totals, refs) {
  const { returned, billTotal } = totals;
  const holder = { scheme: row.holder_scheme, value: row.holder_value };
  const left = Number(row.earned || 0) + Number(row.reversed || 0); /* reversed entries are negative */
  if (!(left > 0)) return 0;
  await lockOn(db, entity_id, [holder]);
  const owed = returned >= billTotal ? left : Math.min(left, rewards.pointsShare(Number(row.earned), returned, billTotal)); /* AO-F-05: the engine's pro rata (whole points, never more than earned); no share is computed here */
  const now = await balanceOn(db, entity_id, holder, { expires_months: 0 });
  const take = Math.min(owed, Math.max(0, now.points));
  if (take <= 0) return 0;
  const wrote = await writeOn(db, entity_id, holder, [rewards.entry({ points: -take, why: 'reversed', ref: refs.billRef + '|' + refs.noteChitId, note: 'returned on bill ' + refs.billRef })], null, false);
  return wrote ? take : 0;
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

module.exports = { programme, termsOf, balanceOn, foldOf, walkIns, lockOn, writeOn, balance, settle, takeBackOnReturn, claim, holderFrom, RECENT };
