/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
/**
 * ── ⭐⭐⭐ verdict.js — ONE CAUSE, ONE SENTENCE, ONE BUTTON ─────────────────────────────────────────────────────
 *
 * Athi, after a stuck queue told him four different stories: *"from the user perspective, he doesn't need
 * reason, he wants fix. wherever there is a reason for the failure, no technical details are required — keep it
 * in diagnosis, offer the solution, check in every place."* Then: *"are we giving the consistent message
 * everywhere?"*
 *
 * ── ⚠️⚠️⚠️ WHY THIS IS AN ENGINE AND NOT WORDS IN A VIEW ─────────────────────────────────────────────────────
 *
 * On 2026-09-20 one counter, one cause, described four ways at once:
 *
 *   the footer   "10 waiting to reach the server"        ← reads as patience
 *   🩺           "Paired key: NO — nothing can be sent"  ← read the page's key; the PROGRAM was paired
 *   🩺, 4 lines on  "The counter program still has 10 to send."   ← contradicting itself
 *   the log      "mint a key with scope till"            ← advice that could not work: it was CLOSED
 *
 * Every one of those was assembled where it was shown. So the fix is not better wording in four places — it is
 * that the sentence has ONE home. The counter-health design says the same thing in its own words: *"Never
 * assemble the sentence in the view."*
 *
 * ── ⭐ A VERDICT ANSWERS THREE QUESTIONS, IN THIS ORDER ──────────────────────────────────────────────────────
 *
 *   1. is something wrong?   `line`   one sentence, display type, never a row in a list
 *   2. is anything LOST?     `lost`   said outright — "nothing is lost" is the most important line when true
 *   3. what do I do?         `fix` + `act`   a button that fixes THE ACTUAL CAUSE, not a link to settings
 *
 * `detail` is the technical account and is for 🩺 ALONE. Nothing on the selling screen prints it.
 *
 * ⚠️ NO DATABASE, NO NETWORK, NO CLOCK OF ITS OWN. It takes a reading and returns a verdict, so the counter,
 * the page and the server can all reach the same one. `now` is passed in so a test can pin it.
 *
 * @stage tested
 *
 * ⚠️ tested, NOT live: no route reaches it yet. It is the single home for what a counter TELLS somebody
 * when something is wrong, and the surfaces move onto it one at a time — the footer first, then the doctor,
 * then the counter-health page. Until they all read it, saying live would overstate it.
 */

/**
 * ── THE TABLE (counter-health-spec §5, plus the one it was missing) ─────────────────────────────────────────
 *
 * ⚠️ ORDER IS THE RULE, NOT A LIST. The first match wins, and they are arranged worst-first: there is no point
 * telling somebody their clock is out when the counter has no shop at all. Every entry states whether anything
 * is lost, because that is the question a shopkeeper actually has.
 */
const VERDICTS = [
  {
    code: 'NOT_PAIRED',
    when: (r) => !r.paired,
    line: 'Nothing can reach the shop from this counter',
    why: 'This counter has never been paired with a shop, so the shop turns away everything it sends.',
    fix: 'Sign in to pair', act: 'signinOpen',
    lost: false,
  },
  {
    /**
     * ⚠️⚠️ THE ONE THE DESIGN DID NOT HAVE, and the one that actually happened. "Key rejected / revoked" hides
     * the fact that ANOTHER DEVICE took this counter — and taking it back will knock that one off, which is a
     * thing the person needs to know before they press the button, not after.
     */
    code: 'COUNTER_CLOSED',
    when: (r) => r.queue_code === 'COUNTER_CLOSED',
    line: 'This counter was opened somewhere else',
    why: 'Another device took counter ' + '{till}' + ', so the shop stopped accepting this one. '
       + 'Signing in here takes it back — and the other device will stop being able to send.',
    fix: 'Sign in to take it back', act: 'signinOpen',
    lost: false,
  },
  {
    code: 'WRONG_SCOPE',
    when: (r) => r.paired && Array.isArray(r.scopes) && r.scopes.length && r.scopes.indexOf('till') < 0,
    line: 'This counter cannot sell yet',
    why: 'The key it holds is for something else, so the shop will not give it a catalogue or take its bills.',
    fix: 'Sign in to pair', act: 'signinOpen',
    lost: false,
  },
  {
    code: 'NO_SHOP_COPY',
    when: (r) => r.paired && !r.items,
    line: 'No copy of the shop has arrived yet',
    why: 'Prices and products are not on this device, so there is nothing to put on a bill.',
    fix: 'Read the shop', act: 'refreshNow',
    lost: false,
  },
  {
    /* ⚠️ THE ONLY VERDICT WHERE WORK IS REALLY AT RISK — and it says so plainly, per the spec */
    code: 'STORAGE_FULL',
    when: (r) => r.storage_bad === true,
    line: 'This counter is nearly out of space',
    why: 'New bills may fail to save. This is the one fault that can lose work.',
    fix: 'Free up space', act: 'openStuck',
    lost: true,
  },
  {
    code: 'OFFLINE',
    when: (r) => r.online === false && r.queued > 0,
    line: 'The shop cannot be reached from here',
    why: 'Everything is saved on this counter and goes by itself when the line is back. Selling and printing keep working.',
    fix: 'Check the internet', act: 'openStuck',
    lost: false,
  },
  {
    code: 'SHOP_REFUSING',
    when: (r) => r.queue_fatal === true && r.queued > 0,
    line: 'The shop is turning these away',
    why: 'Nothing is lost — they are kept on this counter. This one needs somebody to look at it.',
    fix: 'See what is wrong', act: 'openStuck',
    lost: false,
  },
  {
    code: 'SENDING',
    when: (r) => r.queued > 0,
    line: 'Everything is being sent',
    why: 'They go by themselves, usually within a few seconds.',
    fix: null, act: null,
    lost: false, ok: true,
  },
  {
    /* ⭐ the healthy state, and the page is boring on purpose */
    code: 'ALL_SENT',
    when: () => true,
    line: 'Everything has reached the server',
    why: 'Nothing is waiting on this counter.',
    fix: null, act: null,
    lost: false, ok: true,
  },
];

/**
 * read(reading) → { code, line, why, fix, act, lost, ok, detail, support }
 *
 *   paired      does this counter hold a key
 *   scopes      what that key may do
 *   items       how many products are on it
 *   online      did the last attempt reach the server at all
 *   queued      how many things are waiting
 *   queue_fatal will waiting help?  false = a dead line, true = it will never clear by itself
 *   queue_code  the server's own code, when it gave one
 *   queue_say   the server's own sentence — DIAGNOSIS ONLY
 *   storage_bad this device refused a write
 *   till        which counter this is, for the sentence
 */
function read(reading) {
  const r = reading || {};
  const v = VERDICTS.find((x) => { try { return x.when(r); } catch (_) { return false; } }) || VERDICTS[VERDICTS.length - 1];
  const till = r.till || 'this counter';
  return {
    code: v.code,
    line: v.line,
    why: String(v.why).split('{till}').join(till),
    fix: v.fix || null,
    act: v.act || null,
    lost: !!v.lost,
    ok: !!v.ok,
    /* ⚠️ FOR 🩺 ONLY. The selling screen never prints this. */
    detail: r.queue_say || null,
    support: support(v.code, till),
  };
}

/**
 * ⭐ THE SAME PROBLEM GIVES THE SAME CODE EVERY TIME (spec §6.4), so a shopkeeper can read it down a phone and
 * somebody on the other end knows what it is before asking a single question.
 * ⚠️ IT CARRIES NO SHOP DATA — the cause and the counter id, nothing else.
 */
function support(code, till) {
  let h = 0;
  const seed = String(code) + '|' + String(till || '');
  for (let i = 0; i < seed.length; i++) h = (((h * 31) + seed.charCodeAt(i)) >>> 0);
  const n = h % 1000;
  return 'T' + String(code.length) + String(till || 'C').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()
       + '-' + String(n).padStart(3, '0');
}

var EXPORTS = { read, support, VERDICTS };

window.CBVerdict = EXPORTS;
})();
