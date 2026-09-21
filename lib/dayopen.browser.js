/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
// @stage tested
// @stage-note [TILL-182] The morning, as a sequence with rules. The COUNTER calls every function here through
// @stage-note window.CBDayOpen; tests/dayopen.test.js runs all of it with no browser. No server route reaches
// @stage-note it yet — the shop PC will, when it opens the day for a floor rather than for one till.
/**
 * lib/dayopen.js — SETTING A COUNTER UP FOR THE DAY. The order, the questions, and what each answer means.
 *
 * ── ⚠️⚠️⚠️ WHY THIS IS AN ENGINE AND NOT A SCREEN ───────────────────────────────────────────────────────────
 *
 * Athi: *"once you sign-in, set up begins, say 'Loading product data', once done say completed, assigning a
 * counter, find which counter was already associated and provide that number, before that find if it is not
 * used by someone, receive the money in hand, and anything else, so the counter is setting up for the day."*
 *
 * Every piece of that already existed and none of it was in order. claimTill decides the prefix and resumes the
 * series; /api/counters/:id/open refuses with COUNTER_HELD and names who holds it; setWho asks for the cash in
 * the drawer; beginDay refreshes the catalogue. Four correct things in four places, none of which ever said
 * what it was doing. A person signing in at nine in the morning met a screen that simply appeared.
 *
 * ⭐ SO THE SEQUENCE IS THE THING BEING BUILT, and a sequence is a rule: what comes first, what may be skipped,
 * what stops the morning dead. That belongs where the server can read it too, not inside the markup that draws
 * it. [[feedback-ui-replaceable-logic-in-engines]]
 *
 * ── ⭐⭐⭐ AND WHO SIGNS IN IS NOT WHO IS PAIRED ─────────────────────────────────────────────────────────────
 *
 * Athi: *"who uses the counter app, they will not sign-in using main app… this has to be through the user id
 * principle. we already have everything."*
 *
 * Two different acts, and conflating them is what made the morning confusing:
 *   · PAIRING is per DEVICE and happens once. Somebody signs in to FETCH A KEY, never to hold a session, and
 *     the key stays on the PC. A person arriving for a shift never does this. [[project-counter-identity]]
 *   · WHO IS ON is per PERSON and happens every shift. They pick themselves off the shop's own list of
 *     co-assists — a user id, no password — and every bill carries it. [[project-user-id-rule]]
 *
 * This file is the second one. It assumes the device is already paired and asks the questions a PERSON has to
 * answer before the first customer.
 */

/**
 * ⭐⭐ THE MORNING, IN ORDER. Each step says what it is DOING while it runs and what it settled when it is done.
 *
 * ⚠️ `blocks` IS NOT "IMPORTANT", IT IS "THE DAY CANNOT OPEN WITHOUT IT". A printer that is missing is worth
 * saying and must never stop a shop selling; a counter that another PC is already numbering as C1 MUST, because
 * that is the fault that put 29 duplicated bills in a shop's books. [[project-till-series-prefix]]
 */
const STEPS = [
  { id: 'who',      doing: 'Finding who is at this counter', title: 'Who is on the counter', blocks: true },
  { id: 'products', doing: 'Loading product data',           title: 'Products and prices',   blocks: true },
  { id: 'counter',  doing: 'Assigning a counter',            title: 'Counter',               blocks: true },
  { id: 'float',    doing: 'Counting the cash in the drawer', title: 'Cash in the drawer',   blocks: false },
  { id: 'printer',  doing: 'Checking the printer',           title: 'Printer and drawer',    blocks: false },
];

const money = (sym, n) => (sym || '') + Number(n || 0).toLocaleString('en-IN');

/**
 * ── ⭐⭐⭐ WHICH COUNTER IS MINE, AND IS SOMEBODY ELSE ON IT ────────────────────────────────────────────────
 *
 * Athi put these in the right order and it is the order that matters: *"find which counter was already
 * associated and provide that number, BEFORE THAT find if it is not used by someone."* Telling a person they
 * are Counter 2 and then discovering Counter 2 is open on the back-office PC is worse than saying nothing —
 * they will have started billing by the time anyone notices.
 *
 * ⚠️ HELD BY THIS DEVICE IS NOT HELD BY SOMEBODY ELSE. The commonest morning is the same PC opening the same
 * counter it closed last night, and a check that could not tell those apart would block every shop every day.
 */
function counterState(s) {
  const st = s || {};
  const mine = st.counter && st.counter.id ? String(st.counter.id).toUpperCase() : null;
  const list = Array.isArray(st.counters) ? st.counters : [];
  const row = mine ? list.filter((c) => String(c.id).toUpperCase() === mine)[0] : null;
  const by = row && row.held_by ? row.held_by : null;
  const elsewhere = !!(by && String(by.device || '') !== String(st.device || ''));

  if (!mine) {
    /* ⭐ never paired to a counter yet — not a fault, just the first morning */
    const free = list.filter((c) => !c.held_by);
    return { id: null, ok: false, held: false,
             say: free.length ? 'not assigned yet' : 'no counter free',
             why: free.length ? 'Pick a counter to open.' : 'Every counter is open somewhere else.',
             free: free.map((c) => c.id) };
  }
  if (elsewhere) {
    /**
     * ⚠️⚠️⚠️ THE ONE THAT STOPS THE MORNING. Two PCs numbering as C1 is the fault that reached a shop's books,
     * and it is invisible from either PC — each is perfectly certain it is the only one.
     */
    return { id: mine, ok: false, held: true,
             say: mine + ' is open elsewhere',
             why: 'Counter ' + mine + ' is already open on ' + ((by && by.name) || 'another device')
                  + '. Close it there first, or open a different counter here.',
             free: list.filter((c) => !c.held_by).map((c) => c.id) };
  }
  /* ⭐ the ordinary morning: it is mine, and the series carries on from where it stopped */
  const next = Number(st.counter.next) > 0 ? Number(st.counter.next) : null;
  return { id: mine, ok: true, held: false, name: st.counter.name || null, next: next,
           say: mine + (st.counter.name ? ' · ' + st.counter.name : ''),
           why: next ? ('Bills carry on from ' + mine + '-' + String(next).padStart(4, '0') + '.')
                     : ('This counter numbers its bills as ' + mine + '.'),
           free: [] };
}

/**
 * ⭐ HOW OLD THE PRICES ARE, in hours. The one number that decides whether a catalogue is usable, read the same
 * way in three places, so none of them can disagree with the other two. [[feedback-no-duplicate-functions]]
 */
function priceAge(at, now) {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (!(t > 0)) return null;
  return Math.round(((now || Date.now()) - t) / 3600000);
}

/**
 * ⚠️⚠️ ONE STEP, READ FROM SOMETHING REAL. Every branch below reads a fact the counter can check; none of them
 * returns a reassurance. A morning panel that said "all well" without looking is the same lie as a label nobody
 * can defend. [[feedback-silence-is-the-bug]]
 */
function read(id, s) {
  const st = s || {};
  const sym = st.currency_symbol || '';

  if (id === 'who') {
    const w = st.who;
    if (!w || !w.name) return { done: false, say: 'nobody yet', why: 'Pick who is at this counter.' };
    return { done: true, say: w.kind === 'entity' ? 'the shop itself' : w.name,
             why: 'Every bill today is recorded against ' + (w.kind === 'entity' ? 'the shop' : w.name) + '.' };
  }

  if (id === 'products') {
    const n = Number(st.items) || 0;
    const h = priceAge(st.prices_at, st.now);
    if (!n) return { done: false, say: 'nothing loaded', why: 'This counter has no copy of the shop yet.' };
    /**
     * ⚠️ OLD PRICES DO NOT STOP A SHOP SELLING. Athi has been clear that the counter bills with the line down;
     * a catalogue a day old is a thing to SAY, never a thing to refuse over. Only having none at all blocks.
     */
    const stale = h !== null && h > 24;
    return { done: true, stale: stale,
             say: n + ' product' + (n === 1 ? '' : 's') + (h === null ? '' : ' · ' + h + 'h old'),
             why: stale ? 'These prices are more than a day old. Refresh when the line is up.'
                        : 'Loaded and priced.' };
  }

  if (id === 'counter') {
    const c = counterState(st);
    return { done: c.ok, say: c.say, why: c.why, counter: c };
  }

  if (id === 'float') {
    const w = st.who || {};
    /* ⚠️ NOT COUNTED IS NOT ZERO, and the close has to be able to tell them apart — a drawer nobody counted
       cannot be reconciled, and calling it zero manufactures a difference that was never real. */
    if (w.float == null || w.float === '') return { done: false, say: 'not counted', why: 'Count the drawer before the first sale.' };
    const n = Number(w.float) || 0;
    return { done: true, say: n ? money(sym, n) : 'nothing in the drawer',
             why: n ? 'The close will expect this back, plus the day\'s cash.'
                    : 'Recorded as an empty drawer, which the close will expect.' };
  }

  if (id === 'printer') {
    if (st.agent_print) return { done: true, say: 'ready on this PC', why: 'Bills print straight to the printer.' };
    return { done: false, say: 'through the browser', why: 'Bills open the browser\'s print box. That is fine — it is just slower.' };
  }

  return { done: false, say: '', why: '' };
}

/** ⭐ every step, read in order — the whole panel in one call, so a screen adds up nothing of its own */
function all(s) {
  return STEPS.map((step) => Object.assign({ id: step.id, title: step.title, doing: step.doing,
                                             blocks: step.blocks }, read(step.id, s)));
}

/** ⭐ the next thing to do — what the morning is WAITING on, which is the only question a person has */
function next(s) {
  const rows = all(s);
  return rows.filter((r) => !r.done)[0] || null;
}

/**
 * ⚠️⚠️ MAY THE DAY OPEN? A rule, not a button state. Only the blocking steps count, and the answer names the
 * FIRST thing in the way rather than listing everything — a person fixes one thing at a time.
 */
function canOpen(s) {
  const stop = all(s).filter((r) => r.blocks && !r.done)[0];
  if (stop) return { ok: false, step: stop.id, why: stop.why };
  return { ok: true };
}

/** ⭐ what the morning settled, in one sentence, for the moment it finishes */
function done(s) {
  const c = counterState(s);
  const w = (s && s.who) || {};
  return (w.kind === 'entity' ? 'The shop' : (w.name || 'Nobody'))
    + ' is on counter ' + (c.id || '—')
    + (Number(w.float) ? (' with ' + money((s && s.currency_symbol) || '', w.float) + ' in the drawer')
                       : ' with an empty drawer')
    + '.';
}

/**
 * ── ⭐⭐⭐ A SHIFT CHANGES THE PERSON, NEVER THE COUNTER ([TILL-183]) ────────────────────────────────────────
 *
 * Athi: *"if the counter is already running, and the person sign-out and another person sign-in, continue the
 * same counter number, it is like shift. counter continues, but the person changes."*
 *
 * ⚠️⚠️ THIS IS THE RULE THAT KEEPS A SHOP'S BOOKS INTACT. Under GST an invoice run must be one continuous
 * serial; if the number followed the person, every handover would start a new series in the middle of a day,
 * and a shop with three shifts would close with three broken runs. The number belongs to the COUNTER.
 * [[project-till-series-prefix]]
 *
 * ⭐ So signing out does NOT release the counter. It clears who is standing there and nothing else — the
 * drawer is counted against the person leaving, and the next person counts it again on the way in.
 */
function shiftChange(s, person) {
  const st = s || {};
  const had = st.counter && st.counter.id ? String(st.counter.id).toUpperCase() : null;
  return {
    counter: had,                      /* ⚠️ unchanged, deliberately — see above */
    keeps_series: true,
    who: person || null,
    /* ⚠️ the new person's drawer is their own. Carrying the last one's float forward would hand somebody
       else's shortfall to whoever is standing there now. */
    float: null,
    say: person
      ? ((person.name || person.id) + ' is on counter ' + (had || '—') + '.')
      : ('Counter ' + (had || '—') + ' is still open, with nobody on it.'),
  };
}

/**
 * ── ⭐⭐⭐ GETTING A COUNTER NUMBER, WHICH IS THE BACKEND'S TO GIVE ([TILL-183]) ─────────────────────────────
 *
 * Athi: *"if there is no counter number associated, no shop associated then pick / assign a new counter, again
 * the counter number should be from the backend and the sequence should be from the backend so it gets the
 * right sequence and also no one else should use the same counter. assume you left with no counter, then
 * provide a message that you have no free counter available, call services to provide a new counter sequence.
 * so it can be minted from the backend."*
 *
 * Four answers, and this returns which one applies. It never invents a number: every branch either keeps one
 * the backend already gave or says what to ask the backend for. A counter number decided on a device is the
 * two-PCs-one-series fault with extra steps. [[feedback-the-data-decides-not-the-trade]]
 */
function assign(s) {
  const st = s || {};
  const c = counterState(st);

  /* ⚠️ FIRST, THE THING NO RULE CAN WORK AROUND. See firstRun() — a shop cannot be set up with no line. */
  if (!st.entity) {
    return { action: 'shop', ok: false, say: 'No shop yet',
             why: 'Sign in to connect this counter to a shop. It needs the internet once, to fetch the shop.' };
  }
  if (c.held) {
    return { action: 'blocked', ok: false, id: c.id, free: c.free, say: c.say, why: c.why };
  }
  if (c.ok) {
    /* ⭐ THE ORDINARY CASE, including every shift change: it already has one, and the run carries on */
    return { action: 'keep', ok: true, id: c.id, next: c.next, say: c.say, why: c.why };
  }
  if (c.free && c.free.length) {
    return { action: 'pick', ok: false, free: c.free, say: 'not assigned yet',
             why: 'Open counter ' + c.free[0] + (c.free.length > 1 ? ' — or one of ' + c.free.join(', ') : '') + '.' };
  }
  /**
   * ⚠️⚠️ NOTHING FREE. Said plainly, and then a way forward rather than a wall: the shop can be given another
   * counter, and the backend is the only thing that may mint it — because the number and the series it starts
   * must be recorded where every device can see them.
   */
  return { action: 'mint', ok: false, say: 'no counter free',
           why: 'Every counter this shop has is open somewhere else. Ask ChitBridge for another one.',
           call: 'counters.create' };
}

/**
 * ── ⚠️⚠️⚠️ THE FIRST TIME NEEDS THE LINE, AND THERE IS NO WAY AROUND IT ([TILL-183]) ────────────────────────
 *
 * Athi: *"if the network not there for the first time you cannot set up a shop at all, as the basic requirement
 * is to pull the data from the backend etc."*
 *
 * ⭐ IT IS WORTH BEING EXACT ABOUT WHICH "OFFLINE" THIS IS, because the counter's whole pitch is that it works
 * without a line and a careless reading of this would contradict that:
 *   · A COUNTER THAT HAS NEVER BEEN SET UP has no shop, no products, no key and no counter number. Every one
 *     of those comes from the backend. There is nothing to work offline WITH.
 *   · A COUNTER THAT HAS BEEN SET UP ONCE needs no line for anything — it bills, it holds a floor, it queues,
 *     it opens its day. That is [[project-offline-resilience]] and it is untouched by this.
 *
 * ⚠️ SO THE MESSAGE MUST SAY WHICH IT IS. "No internet" on a working counter is a shrug; on a blank one it is
 * the whole explanation, and a person who is not told will keep pressing the button.
 */
function firstRun(s) {
  const st = s || {};
  const setUp = !!(st.entity && (Number(st.items) > 0 || (st.counter && st.counter.id)));
  if (setUp) return { first: false, blocked: false };
  if (st.line) {
    return { first: true, blocked: false,
             why: 'This counter is not connected to a shop yet. Sign in to set it up.' };
  }
  return { first: true, blocked: true,
           say: 'No internet',
           why: 'A new counter needs the internet once, to fetch the shop, its products and its counter number.'
                + ' Connect to a network and sign in. After that it works with the line down.' };
}

var EXPORTS = { STEPS, all, read, next, canOpen, done, counterState, priceAge,
                   shiftChange, assign, firstRun };

window.CBDayOpen = EXPORTS;
})();
