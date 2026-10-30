/*
 * OWNS      The counter register on an entity (identities.policy_flags.counters): read it under a lock, patch one counter, the narrow list
 *           for a till key, the high-water mark of an accepted bill, and the ONE claim of a counter (open and enrol both use it).
 * CALLED BY routes/counters.js (the /api/counters handlers) · routes/till.js (listNarrow, patchCounter, claim) · routes/chits.js (noteBill)
 * FLOW      read the register FOR UPDATE → decide held / takeover → mint a till key → write key and counter together
 * CARD      09-counter/counters-and-keys-pair-enrol-open-release
 * S7 (2026-10-30): moved out of routes/counters.js unchanged, so no route file loads another as a library.
 */
const { query, withTransaction } = require('../db');
const auth = require('../middleware/auth');
const keys = require('./api-keys');

const PENDING_MS = 2 * 60 * 1000;
const isPending = (h) => typeof h === 'string' && h.indexOf('pending:') === 0;
const isDevice = (h) => typeof h === 'string' && h.indexOf('dev:') === 0;
const pendingLive = (c) => isPending(c && c.held_by) && Date.now() - new Date(c.held_at || 0).getTime() < PENDING_MS;

/** set one counter's record in one statement — shallow merge into policy_flags.counters[id] */
async function patchCounter(db, entity_id, id, patch) {
  await require('./policy').patchKey(db, entity_id, ['counters', String(id)], patch, { op: 'merge' }); /* T2-POLICY: the one writer */
}

/**
 * ⭐ THE REGISTER, READ UNDER A LOCK — and the pairings that predate it adopted into it.
 * A key that already numbers under a prefix (claimTill, earlier today) and is not closed becomes the holder of a
 * counter of that id. Nothing a shop has already billed under is renamed or orphaned by the arrival of the register.
 */
async function readLocked(db, entity_id) {
  const r = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  const counters = Object.assign({}, pf.counters || {});
  const list = Array.isArray(pf.api_keys) ? pf.api_keys : [];
  const tills = list.filter((item) => item && Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0);
  for (const k of tills) {
    const id = k.till && k.till.id ? String(k.till.id).toUpperCase() : null;
    if (!id || keys.isClosed(k)) continue;
    if (!counters[id]) {
      counters[id] = {
        id,
        name: 'Counter ' + id,
        created_at: k.created_at || new Date().toISOString(),
        held_by: k.jti,
        held_at: (k.till && k.till.at) || new Date().toISOString(),
        adopted: true
      };
      await patchCounter(db, entity_id, id, counters[id]);
    }
    if (!k.counter) await keys.patchKeyWith(db, entity_id, k.jti, { counter: id });
  }
  /* M11: phones listed on this shop — a counter assigned to a phone is held by 'dev:'+device_id (keys.claimSeries) */
  const devices = pf.devices && typeof pf.devices === 'object' ? pf.devices : {};
  return { counters, list, tills, devices, pf };
}

/** the shop-facing view of one counter: who holds it now, from where, and where its series stands */
function view(c, list, devices) {
  /* ⭐ M11: a counter assigned to a phone number is held by that phone ('dev:'+device_id) while the phone holds its prefix */
  const dev = isDevice(c.held_by) ? (devices || {})[String(c.held_by).slice(4)] : null;
  if (dev && !dev.revoked_at && dev.till && String(dev.till.prefix || '').toUpperCase() === String(c.id).toUpperCase()) {
    return Object.assign(baseView(c), {
      state: 'open',
      held_by: { name: dev.label || 'a phone', phone: true, since: c.held_at || null, seen: dev.seen ? { at: dev.seen } : null, diag: null }
    });
  }
  const holder = c.held_by && !isPending(c.held_by) && !isDevice(c.held_by) ? list.find((item) => item && String(item.jti) === String(c.held_by)) : null;
  const open = !!(holder && !keys.isClosed(holder));
  return {
    id: c.id,
    name: c.name || 'Counter ' + c.id,
    created_at: c.created_at || null,
    state: open ? (c.status === 'break' ? 'break' : 'open') : pendingLive(c) ? 'opening' : 'closed',
    break_since: open && c.status === 'break' ? c.status_since || null : null,
    break_by: open && c.status === 'break' ? c.status_by || null : null,
    held_by: open ? { name: holder.name, last4: holder.last4, since: c.held_at || null, seen: holder.seen || null, diag: holder.diag || null } : null,
    next: c.next || null,
    period: c.period || null,
    last_no: c.last_no || null,
    last_at: c.last_at || null,
    closed_at: c.closed_at || null,
    assigned: assignedView(c)
  };
}
/** what every view says whoever holds it — the series and the phone it is assigned to */
function baseView(c) {
  return {
    id: c.id,
    name: c.name || 'Counter ' + c.id,
    created_at: c.created_at || null,
    break_since: null,
    break_by: null,
    next: c.next || null,
    period: c.period || null,
    last_no: c.last_no || null,
    last_at: c.last_at || null,
    closed_at: c.closed_at || null,
    assigned: assignedView(c)
  };
}
/** ⚠️ the number is shown MASKED (last four) — the counters list is read by every signed-in person, not only the owner */
function assignedView(c) {
  const a = c && c.assigned;
  if (!a || !a.phone) return null;
  return { phone: '•••••' + String(a.phone).slice(-4), at: a.at || null };
}

/**
 * ⭐ NARROW READ FOR A TILL KEY (routes/till.js GET /counters — b262, 2026-09-18, decision 3: the "also mark
 * sold out on Counter 2, Counter 3...?" prompt needs to name the shop's other counters). Deliberately not the
 * full view() above: id and name only, none of held_by/status/series — a stolen till key learns nothing about
 * who is working where, matching the "narrow on purpose" rule every other till-scoped read follows.
 */
const listNarrow = async (entity_id) => {
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const counters = (r.rows[0] && r.rows[0].policy_flags && r.rows[0].policy_flags.counters) || {};
  return Object.keys(counters).map((id) => ({ id, name: (counters[id] && counters[id].name) || 'Counter ' + id }));
};

/**
 * ⭐ THE CLOUD'S HIGH-WATER MARK, from a counter bill that was just accepted (called by POST /api/chits/send).
 * Athi: *"as it is an offline capability, the system should be updated with the next seq number whenever the sync
 * completes."* Only a REGISTERED counter is tracked; a bill from an older period never drags a newer one back.
 * ⚠️ Fire-and-forget by its caller: a missed update is recovered by the counter's own count and by its close.
 */
const noteBill = async (entity_id, series, billedAt, no) => {
  if (!series || !series.prefix || !(Number(series.seq) > 0)) return;
  const id = String(series.prefix).toUpperCase();
  const period = series.period != null ? String(series.period) : null;
  await withTransaction(async (db) => {
    const r = await db.query(`SELECT policy_flags->'counters'->$2 AS c FROM identities WHERE identity_id = $1 FOR UPDATE`, [entity_id, id]);
    const c = r.rows[0] && r.rows[0].c;
    if (!c) return;
    const at = billedAt ? String(billedAt) : new Date().toISOString();
    const nextSeq = Number(series.seq) + 1;
    let patch = null;
    if (c.period === period) {
      if (!(Number(c.next) >= nextSeq)) patch = { next: nextSeq };
    } else if (!c.hw_at || at >= String(c.hw_at)) {
      patch = { period, next: nextSeq };
    }
    if (patch) await patchCounter(db, entity_id, id, Object.assign(patch, { last_no: no || null, last_at: at, hw_at: at }));
  });
};

/**
 * ── ⭐⭐⭐ ONE PATH TO CLAIMING A COUNTER ([TILL-138]) ──────────────────────────────────────────────────────────
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

  const got = await nestedWithTransaction(async (db) => {
    const { counters, list, devices } = await readLocked(db, entity_id);
    const c = counters[want];
    if (!c) return { status: 404, body: { error: 'Not found', message: 'There is no counter ' + want + ' in this shop.' } };
    const v = view(c, list, devices);

    /**
     * ⚠️⚠️ HELD MEANS HELD. A counter that is open somewhere is not available, and taking it must be a DECIDED
     * act — Athi: *"without knock of this counter, the other one should not open?"* The refusal names who has it
     * and when they were last seen, so the person choosing can tell a PC that is gone from one that is busy.
     */
    if (!takeover && (v.state === 'open' || v.state === 'break' || v.state === 'opening')) {
      return {
        status: 409,
        body: {
          error: 'Counter already open',
          code: 'COUNTER_HELD',
          counter: v,
          held_by: (v.held_by && v.held_by.name) || null,
          seen: (v.held_by && v.held_by.seen && v.held_by.seen.at) || null,
          message:
            'Counter ' +
            want +
            ' is already open' +
            (v.held_by && v.held_by.name ? ' on ' + v.held_by.name : '') +
            '. Close it there first — or, if that PC is gone, take it over from here.'
        }
      };
    }

    /**
     * ⚠️ A TAKEOVER RELEASES THE HOLDER FIRST, in the same transaction. Two keys believing they hold one counter
     * is precisely how two runs of bill numbers start, and a gap between the release and the claim is a window
     * where exactly that can happen.
     */
    if (takeover && c.held_by && !isPending(c.held_by)) {
      const holder = list.find((item) => item && String(item.jti) === String(c.held_by));
      if (holder && !nestedKeys.isClosed(holder)) {
        await nestedKeys.patchKeyWith(db, entity_id, holder.jti, {
          till: Object.assign({}, holder.till || {}, { closed_at: new Date().toISOString(), released: true })
        });
        auth.forgetKey(holder.jti);
      }
    }
    return { status: 200, counter: c, released: !!(takeover && c.held_by) };
  });
  if (got.status !== 200) return got;

  const minted = await nestedKeys.mint(entity_id, identity, {
    name: 'counter ' + want + (label ? ' · ' + label : '') + ' · ' + new Date().toISOString().slice(0, 10),
    scopes: ['till']
  });

  /* ⭐ the key and the counter are written together — the key knows its counter, the counter knows its key */
  await nestedWithTransaction(async (db) => {
    await nestedKeys.patchKeyWith(db, entity_id, minted.jti, {
      counter: want,
      till: { id: want, issued: Number(got.counter.next) > 1, at: new Date().toISOString() }
    });
    await patchCounter(db, entity_id, want, {
      held_by: minted.jti,
      held_at: new Date().toISOString(),
      opened_at: new Date().toISOString(),
      closed_at: null,
      released: null
    });
  });

  return { status: 200, key: minted.key, counter: want, released: got.released };
};
module.exports = { PENDING_MS, isPending, isDevice, pendingLive, patchCounter, readLocked, view, baseView, assignedView, listNarrow, noteBill, claim };
