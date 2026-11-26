/*
 * OWNS      The counter register on an entity (identities.policy_flags.counters): read it under a lock, patch one counter, the narrow list
 *           for a till key, the high-water mark of an accepted bill, and the ONE claim of a counter (open and enrol both use it).
 * CALLED BY routes/counters.js (the /api/counters handlers) · routes/till.js (listNarrow, patchCounter, claim) · routes/chits.js (noteBill)
 * FLOW      read the register FOR UPDATE → decide held / takeover → mint a till key → write key and counter together
 * CARD      09-counter/counters-and-keys-pair-enrol-open-release
 * S7 (2026-10-30): moved out of routes/counters.js unchanged, so no route file loads another as a library.
 */
const { query, withTransaction } = require('../db');
const { boundRead } = require('./bound-read'); /* SEC-185: identities are read under their own binding */
const auth = require('../middleware/auth');
const keys = require('./api-keys');

const PENDING_MS = 2 * 60 * 1000;
const isPending = (holderId) => typeof holderId === 'string' && holderId.indexOf('pending:') === 0;
const isDevice = (holderId) => typeof holderId === 'string' && holderId.indexOf('dev:') === 0;
const pendingLive = (counterRecord) => isPending(counterRecord && counterRecord.held_by) && Date.now() - new Date(counterRecord.held_at || 0).getTime() < PENDING_MS;

/** set one counter's record in one statement — shallow merge into policy_flags.counters[id] */
async function patchCounter(db, entity_id, id, patch) {
  await require('./policy').patchKey(db, entity_id, ['counters', String(id)], patch, { op: 'merge' }); /* T2-POLICY: the one writer */
}

/** a till key not yet in the register becomes the holder of a counter of its id; the key learns its counter */
async function adoptKey(db, entity_id, counters, keyRecord) {
  const id = keyRecord.till && keyRecord.till.id ? String(keyRecord.till.id).toUpperCase() : null;
  if (!id || keys.isClosed(keyRecord)) return;
  if (!counters[id]) {
    counters[id] = {
      id,
      name: counterName(id),
      created_at: keyRecord.created_at || new Date().toISOString(),
      held_by: keyRecord.jti,
      held_at: (keyRecord.till && keyRecord.till.at) || new Date().toISOString(),
      adopted: true
    };
    await patchCounter(db, entity_id, id, counters[id]);
  }
  if (!keyRecord.counter) await keys.patchKeyWith(db, entity_id, keyRecord.jti, { counter: id });
}

/**
 * ⭐ THE REGISTER, READ UNDER A LOCK — and the pairings that predate it adopted into it.
 * A key that already numbers under a prefix (claimTill, earlier today) and is not closed becomes the holder of a
 * counter of that id. Nothing a shop has already billed under is renamed or orphaned by the arrival of the register.
 */
/** a till key adoptKey would write for: the register lacks its counter, or the key does not name its counter yet */
function needsAdopting(counters, keyRecord) {
  const id = keyRecord.till && keyRecord.till.id ? String(keyRecord.till.id).toUpperCase() : null;
  if (!id || keys.isClosed(keyRecord)) return false;
  return !counters[id] || !keyRecord.counter;
}

/**
 * LV-speed (1129): `opts.readOnly` is the list screen. It writes nothing, so it takes no FOR UPDATE on the shop's identities row (every paint queued
 * behind a till claim). When a key still needs adopting (a write follows) it falls through to the locked read below, so the write path is unchanged.
 */
async function readLocked(db, entity_id, opts) {
  if (opts && opts.readOnly) {
    const plain = await readRegisterUnlocked(db, entity_id);
    if (!plain.tills.some((item) => needsAdopting(plain.counters, item))) return plain;
  }
  const queryResult = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
  const register = registerOf((queryResult.rows[0] && queryResult.rows[0].policy_flags) || {});
  for (const keyRecord of register.tills) await adoptKey(db, entity_id, register.counters, keyRecord);
  return register;
}

/** the list screen's plain read of the register: no lock, nothing written */
async function readRegisterUnlocked(db, entity_id) {
  const plain = await boundRead((text, params) => db.query(text, params), entity_id, 'SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  return registerOf((plain.rows[0] && plain.rows[0].policy_flags) || {});
}

/** the register's parts out of an entity's policy_flags: its counters (a copy), api keys, the till-scoped keys, and the phones listed on the shop (M11: a counter assigned to a phone is held by 'dev:'+device_id, keys.claimSeries) */
function registerOf(flags) {
  const list = Array.isArray(flags.api_keys) ? flags.api_keys : [];
  const tills = list.filter((item) => item && Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0);
  const devices = flags.devices && typeof flags.devices === 'object' ? flags.devices : {};
  return { counters: Object.assign({}, flags.counters || {}), list, tills, devices, pf: flags };
}

/** ⭐ M11: a counter assigned to a phone number is held by that phone ('dev:'+device_id) while the phone holds its prefix — its view, or null when no phone holds it */
function phoneHeldView(counterRecord, devices) {
  const phoneDevice = phoneHolding(counterRecord, devices);
  if (!phoneDevice) return null;
  return Object.assign(baseView(counterRecord), {
    state: 'open',
    held_by: { name: phoneDevice.label || 'a phone', phone: true, since: counterRecord.held_at || null, seen: phoneDevice.seen ? { at: phoneDevice.seen } : null, diag: null }
  });
}
/** the phone device that holds this counter now (live, its till prefix is the counter id), or null */
function phoneHolding(counterRecord, devices) {
  const phoneDevice = isDevice(counterRecord.held_by) ? (devices || {})[String(counterRecord.held_by).slice(4)] : null;
  if (!(phoneDevice && !phoneDevice.revoked_at && phoneDevice.till && String(phoneDevice.till.prefix || '').toUpperCase() === String(counterRecord.id).toUpperCase())) return null;
  return phoneDevice;
}
/** the key record holding a counter right now (not a pending opening, not a phone), or null */
function keyHolderOf(counterRecord, list) {
  if (!counterRecord.held_by || isPending(counterRecord.held_by) || isDevice(counterRecord.held_by)) return null;
  return list.find((item) => item && String(item.jti) === String(counterRecord.held_by)) || null;
}
/** open · break · opening · closed */
function stateOf(open, onBreak, counterRecord) {
  if (open) return onBreak ? 'break' : 'open';
  return pendingLive(counterRecord) ? 'opening' : 'closed';
}
/** the series fields every view carries: where the run stands and the phone it is assigned to */
function seriesFields(counterRecord) {
  return {
    next: counterRecord.next || null,
    period: counterRecord.period || null,
    last_no: counterRecord.last_no || null,
    last_at: counterRecord.last_at || null,
    closed_at: counterRecord.closed_at || null,
    assigned: assignedView(counterRecord)
  };
}

/** the shop-facing view of one counter: who holds it now, from where, and where its series stands */
function view(counterRecord, list, devices) {
  const phoneView = phoneHeldView(counterRecord, devices);
  if (phoneView) return phoneView;
  const holder = keyHolderOf(counterRecord, list);
  const open = !!(holder && !keys.isClosed(holder));
  const onBreak = open && counterRecord.status === 'break';
  return Object.assign(
    {
      id: counterRecord.id,
      name: counterRecord.name || counterName(counterRecord.id),
      created_at: counterRecord.created_at || null,
      state: stateOf(open, onBreak, counterRecord)
    },
    breakFields(onBreak, counterRecord),
    { held_by: open ? keyHeldBy(holder, counterRecord) : null },
    seriesFields(counterRecord)
  );
}
/** since when and by whom a counter is on break (nulls when it is not) */
function breakFields(onBreak, counterRecord) {
  return {
    break_since: onBreak ? counterRecord.status_since || null : null,
    break_by: onBreak ? counterRecord.status_by || null : null
  };
}
/** who holds an open counter by key: the key's name and last four, since when, and last seen */
function keyHeldBy(holder, counterRecord) {
  return { name: holder.name, last4: holder.last4, since: counterRecord.held_at || null, seen: holder.seen || null, diag: holder.diag || null };
}
/** RW3-18: ONE default name per counter id, the one the till, the Day book and Settings all print: a plain number is the name (C2 = "Counter 2", CTR-146); any other code is kept whole. The code is an id, never the name. */
const counterName = (id) => {
  const text = String(id == null ? '' : id).trim();
  return 'Counter ' + (/^C\d+$/i.test(text) ? text.slice(1) : text);
};
/** what every view says whoever holds it — the series and the phone it is assigned to */
function baseView(counterRecord) {
  return {
    id: counterRecord.id,
    name: counterRecord.name || counterName(counterRecord.id),
    created_at: counterRecord.created_at || null,
    break_since: null,
    break_by: null,
    next: counterRecord.next || null,
    period: counterRecord.period || null,
    last_no: counterRecord.last_no || null,
    last_at: counterRecord.last_at || null,
    closed_at: counterRecord.closed_at || null,
    assigned: assignedView(counterRecord)
  };
}
/** ⚠️ the number is shown MASKED (last four) — the counters list is read by every signed-in person, not only the owner */
function assignedView(counterRecord) {
  const assignment = counterRecord && counterRecord.assigned;
  if (!assignment || !assignment.phone) return null;
  return { phone: '•••••' + String(assignment.phone).slice(-4), at: assignment.at || null };
}

/**
 * ⭐ NARROW READ FOR A TILL KEY (routes/till.js GET /counters — b262, 2026-09-18, decision 3: the "also mark
 * sold out on Counter 2, Counter 3...?" prompt needs to name the shop's other counters). Deliberately not the
 * full view() above: id and name only, none of held_by/status/series — a stolen till key learns nothing about
 * who is working where, matching the "narrow on purpose" rule every other till-scoped read follows.
 */
const listNarrow = async (entity_id) => {
  const queryResult = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const counters = (queryResult.rows[0] && queryResult.rows[0].policy_flags && queryResult.rows[0].policy_flags.counters) || {};
  return Object.keys(counters).map((id) => ({ id, name: (counters[id] && counters[id].name) || counterName(id) }));
};

/**
 * ⭐ THE CLOUD'S HIGH-WATER MARK, from a counter bill that was just accepted (called by POST /api/chits/send).
 * Athi: *"as it is an offline capability, the system should be updated with the next seq number whenever the sync
 * completes."* Only a REGISTERED counter is tracked; a bill from an older period never drags a newer one back.
 * ⚠️ Fire-and-forget by its caller: a missed update is recovered by the counter's own count and by its close.
 *
 * ⭐ LV-09 (lens-verify 2026-11-22, sec-counter-01 F4 · integrity-counter-01 F1): the till's seq and clock are CLAIMS, never facts.
 * The bill itself is always kept (the paper is in the customer's hand); only the MARK is guarded, so numbers stay unique and gapless per series
 * (India CGST Rule 46(b): consecutive serial number; AU / AE: unique):
 *   - the seq must be a whole number, and not further ahead than a till can honestly sell offline between two syncs (MAX_SEQ_AHEAD past the mark),
 *     else the mark stays where it is, and the refusal is logged;
 *   - when a lease block covers this till (AE invoice blocks) a digits-only number must lie inside one of THAT till's blocks, else the mark stays;
 *   - the clock never decides: last_at / hw_at are the SERVER'S time, and a period change moves the mark only to a period that is not later than the
 *     server's own current period (an older period never moves it back, a period a year ahead never moves it forward).
 */
const noteBill = async (entity_id, series, billedAt, no, deps) => {
  if (!series || !series.prefix || !(Number(series.seq) > 0)) return;
  const id = String(series.prefix).toUpperCase();
  const period = series.period != null ? String(series.period) : null;
  const now = ((deps && deps.now) || (() => new Date()))();
  await withTransaction((db) => moveMarkUnderLock(db, entity_id, id, { seq: Number(series.seq), period, no }, now));
  void billedAt; /* the till's clock is kept on the bill itself; it never moves the mark */
};
const MAX_SEQ_AHEAD = 5000;

/** the patch that moves a counter's mark to the accepted bill's seq and period, or null when the mark stays (same period, no higher seq) */
function markPatch(counterRecord, period, nextSeq) {
  if (counterRecord.period === period) return Number(counterRecord.next) >= nextSeq ? null : { next: nextSeq };
  return periodMayMove(counterRecord.period, period) ? { period, next: nextSeq } : null;
}

/** the mark move of one accepted bill, inside the transaction that holds the identities row: read the counter, judge the claim, write the patch */
async function moveMarkUnderLock(db, entity_id, id, claimed, now) {
  const queryResult = await db.query(`SELECT policy_flags->'counters'->$2 AS c FROM identities WHERE identity_id = $1 FOR UPDATE`, [entity_id, id]);
  const counterRecord = queryResult.rows[0] && queryResult.rows[0].c;
  if (!counterRecord) return;
  const refusal = await markRefusal(db, entity_id, id, counterRecord, claimed, now);
  if (refusal) return require('./logger').fellBack('counters: bill number not trusted to move the mark - ' + refusal, new Error(refusal));
  const { period } = claimed;
  /* LENS-P2 counter-01 F1: the period NEVER moves back. A late-clocked replay of an older period leaves the counter's period and next alone (that bill is held, in its own period, on its own chit); only the same period raises next, only a later period switches. */
  if (period != null && counterRecord.period != null && period < String(counterRecord.period)) return;
  const patch = markPatch(counterRecord, period, claimed.seq + 1);
  const at = now.toISOString();
  if (patch) await patchCounter(db, entity_id, id, Object.assign(patch, { last_no: claimed.no || null, last_at: at, hw_at: at }));
}

/** the sentence for why a till's number may not move the mark, or null when it may */
async function markRefusal(db, entity_id, id, counterRecord, claimed, now) {
  if (!Number.isInteger(claimed.seq)) return 'seq is not a whole number';
  const known = counterRecord.period === claimed.period ? Number(counterRecord.next) || 1 : 1;
  if (claimed.seq > known + MAX_SEQ_AHEAD) return 'seq ' + claimed.seq + ' is more than ' + MAX_SEQ_AHEAD + ' past the mark ' + known;
  if (claimed.period != null && periodIsAhead(claimed.period, now)) return 'period ' + claimed.period + ' is later than the year of this server';
  return outsideLease(db, entity_id, id, claimed.no);
}

/** a period label (2026 · 2026-27 · 2026-11) is later than the year of the server's clock: its first four digits name a year past this one (a day of slack for a till in an earlier time zone on 31 December) */
function periodIsAhead(period, now) {
  const year = /^[0-9]{4}/.exec(String(period));
  return !!year && Number(year[0]) > new Date(now.getTime() + 86400000).getUTCFullYear();
}

/** may the mark go from period `from` to period `to`? only forward, never back (labels are compared as text, the till's own year-first form) */
function periodMayMove(from, to) {
  if (to == null) return false;
  if (from == null) return true;
  return String(to) > String(from);
}

/** AE invoice blocks: a digits-only number of a till that holds blocks must lie in one of that till's blocks (null = fine, or no blocks to judge by) */
async function outsideLease(db, entity_id, id, no) {
  const text = String(no == null ? '' : no).trim();
  if (!/^[0-9]{1,15}$/.test(text)) return null;
  try {
    if (!(await require('./schema').hasTable('till_invoice_lease'))) return null;
    const held = await db.query('SELECT first_no, last_no FROM till_invoice_lease WHERE entity_id = $1 AND till_id = $2', [entity_id, id]);
    if (!held.rows.length) return null;
    const number = Number(text);
    return held.rows.some((row) => number >= Number(row.first_no) && number <= Number(row.last_no)) ? null : 'number ' + number + ' is outside every block leased to ' + id;
  } catch (e) {
    require('./logger').fellBack('counters: lease blocks not read - the bill number is not judged against them', e);
    return null; /* the register is read for guarding only; a failed read never blocks a sale's bookkeeping */
  }
}

/** the 409 a held counter answers: who has it and when they were last seen, so the person can tell a PC that is gone from one that is busy */
function heldRefusal(counterView, want) {
  const holderView = counterView.held_by;
  return {
    status: 409,
    body: {
      error: 'Counter already open',
      code: 'COUNTER_HELD',
      counter: counterView,
      held_by: (holderView && holderView.name) || null,
      seen: (holderView && holderView.seen && holderView.seen.at) || null,
      message:
        'Counter ' + want + ' is already open' + (holderView && holderView.name ? ' on ' + holderView.name : '') + '. Close it there first — or, if that PC is gone, take it over from here.'
    }
  };
}
/** a takeover: the key that holds the counter is closed and released, in the same transaction */
async function releaseHolder(db, entity_id, list, counterRecord) {
  const holder = list.find((item) => item && String(item.jti) === String(counterRecord.held_by));
  if (!holder || keys.isClosed(holder)) return;
  await keys.patchKeyWith(db, entity_id, holder.jti, {
    till: Object.assign({}, holder.till || {}, { closed_at: new Date().toISOString(), released: true })
  });
  auth.forgetKey(holder.jti);
}

/**
 * ⭐ CTR-208 · THE WRITE HALF OF A CLAIM, UNDER THE LOCK. The held check and the mint were two transactions, so two enrols that
 * both saw the counter free both minted and both wrote held_by: two keys, one counter, two runs of bill numbers. Now the write re-reads the
 * register FOR UPDATE and compares who held the counter when the check was made (`seenHolder`) with who holds it now. The same → this claim wins and
 * writes. Different → another claim won in the gap: this minted key (never shown to anyone) is closed and released in the same
 * transaction, and the answer is the ordinary 409 COUNTER_HELD naming the winner. Returns null on a win, the refusal on a loss.
 */
async function writeClaim(db, entity_id, want, minted, seenHolder) {
  const { counters, list, devices } = await readLocked(db, entity_id);
  const nowHolder = (counters[want] && counters[want].held_by) || null;
  const nowAt = new Date().toISOString();
  if (nowHolder !== seenHolder) {
    await keys.patchKeyWith(db, entity_id, minted.jti, { counter: want, till: { id: want, closed_at: nowAt, released: true } });
    auth.forgetKey(minted.jti);
    return heldRefusal(view(counters[want], list, devices), want);
  }
  await keys.patchKeyWith(db, entity_id, minted.jti, { counter: want, till: { id: want, issued: Number(counters[want].next) > 1, at: nowAt } });
  await patchCounter(db, entity_id, want, { held_by: minted.jti, held_at: nowAt, opened_at: nowAt, closed_at: null, released: null });
  return null;
}

/**
 * ── ⭐⭐⭐ ONE PATH TO CLAIMING A COUNTER ([TILL-138])──────────────────────────────────────────────────────────
 *
 * Athi, after his browser silently took C1 from a counter that was mid-day: *"if the counter is taken somewhere
 * else, and they would have forgotten, check that counter is active. if not active, offer to knock it off and
 * then open here … without knock of this counter, the other one should not open?"*
 *
 * ⚠️⚠️⚠️ THE REGISTRY ALREADY REFUSED A SECOND HOLDER, AND /api/till/enrol WALKED AROUND IT.
 * POST /api/counters/:id/open answers 409 COUNTER_HELD when a counter is already open — "close it there first,
 * or, if that PC is gone, release it". But enrol ([TILL-121]) minted a till key and registered NOTHING, so a
 * counter signed in through ⚙ was invisible: it held a key and billed while the shop still thought C1 was free.
 * The browser then opened C1 legitimately and released the running counter. Ten bills stranded, neither side told.
 *
 * ⚠️⚠️ AND THE NUMBERS WOULD HAVE COLLIDED. The series is per counter id, and the server only learns where a run
 * stopped because the counter TELLS it (`issued` rides the snapshot call). The stranded counter was being 401'd,
 * so `resume_next` stayed null — a second device on C1 would have started at 0001 as well. This is the fault
 * already on record as the root cause of "sent but not in Task": two PCs both C1.
 *
 * ⭐ SO THERE IS ONE CLAIM, AND BOTH DOORS USE IT. Extracted here because enrol became the second caller.
 * [[feedback-no-duplicate-functions]] [[project-till-series-prefix]]
 */
const claim = async ({ entity_id, identity, id, label, takeover }) => {
  const { withTransaction: nestedWithTransaction } = require('../db');
  const nestedKeys = keys;
  const want = String(id || 'C1').toUpperCase();

  const claimResult = await nestedWithTransaction((db) => judgeClaim(db, entity_id, want, takeover));
  if (claimResult.status !== 200) return claimResult;

  const minted = await nestedKeys.mint(entity_id, identity, {
    name: 'counter ' + want + (label ? ' · ' + label : '') + ' · ' + new Date().toISOString().slice(0, 10),
    scopes: ['till']
  });

  /* ⭐ the key and the counter are written together — unless another claim got there first (CTR-208): then this key is closed unseen and the refusal is the one held answer.
     ⭐ LV (lensVerify3): if the write itself FAILS the minted key is closed too, never left live and unattached (an orphan that could bill under no counter) */
  let lost;
  try {
    lost = await nestedWithTransaction((db) => writeClaim(db, entity_id, want, minted, claimResult.counter.held_by || null));
  } catch (e) {
    await abandonMinted(entity_id, minted, null, null);
    throw e;
  }
  if (lost) return lost;

  return { status: 200, key: minted.key, counter: want, released: claimResult.released };
};

/** the first half of a claim, inside its transaction: 404 when the counter is not in the shop, the held refusal, or (after a takeover released the holder) the 200 to mint a key for */
async function judgeClaim(db, entity_id, want, takeover) {
  const { counters, list, devices } = await readLocked(db, entity_id);
  const counterRecord = counters[want];
  if (!counterRecord) return { status: 404, body: { error: 'Not found', message: 'There is no counter ' + want + ' in this shop.' } };
  const counterView = view(counterRecord, list, devices);

  /**
   * ⚠️⚠️ HELD MEANS HELD. A counter that is open somewhere is not available, and taking it must be a DECIDED
   * act — Athi: *"without knock of this counter, the other one should not open?"* The refusal names who has it
   * and when they were last seen, so the person choosing can tell a PC that is gone from one that is busy.
   */
  if (!takeover && (counterView.state === 'open' || counterView.state === 'break' || counterView.state === 'opening')) return heldRefusal(counterView, want);

  /**
   * ⚠️ A TAKEOVER RELEASES THE HOLDER FIRST, in the same transaction. Two keys believing they hold one counter
   * is precisely how two runs of bill numbers start, and a gap between the release and the claim is a window
   * where exactly that can happen.
   */
  if (takeover && counterRecord.held_by && !isPending(counterRecord.held_by)) await releaseHolder(db, entity_id, list, counterRecord);
  return { status: 200, counter: counterRecord, released: !!(takeover && counterRecord.held_by) };
}
/**
 * abandonMinted(entity_id, minted, counterId, nonce) — a key was minted for a counter and the write that binds it failed: close the key (never shown to anyone) and, when a
 * 'pending:' hold was put on the counter for it (nonce), free the counter again if it is still that hold. Best effort: a failure here is logged, the first error stays the one thrown.
 */
async function abandonMinted(entity_id, minted, counterId, nonce) {
  try {
    await withTransaction(async (db) => {
      await keys.patchKeyWith(db, entity_id, minted.jti, { till: { closed_at: new Date().toISOString(), released: true } });
      if (counterId && nonce) {
        const { counters } = await readLocked(db, entity_id);
        if (counters[counterId] && counters[counterId].held_by === nonce) await patchCounter(db, entity_id, counterId, { held_by: null, held_at: null });
      }
    });
    auth.forgetKey(minted.jti);
  } catch (e) {
    require('./logger').fellBack('counters: a minted key could not be closed after a failed claim', e);
  }
}
module.exports = { counterName, abandonMinted, MAX_SEQ_AHEAD, PENDING_MS, isPending, isDevice, pendingLive, patchCounter, readLocked, view, baseView, assignedView, listNarrow, noteBill, claim, heldRefusal, writeClaim };
