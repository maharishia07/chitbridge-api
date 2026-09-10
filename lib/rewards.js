// @stage tested
// @stage-note Built 2026-09-10 and called by NOTHING — tests/rewards.test.js, 15 checks. The interpretation and the
// ledger arithmetic are both here and asserted, including every refusal. What is missing is STORAGE — the table the
// entries live in — which is a migration and belongs to the host product, exactly as region_layer does for
// jurisdiction. Deliberately in this order: a balance is a LIABILITY, and a shop should agree what a point is worth
// before anything starts accruing them. See UNWIRED in tests/engine-boundary.test.js.
'use strict';
/**
 * lib/rewards.js — WHAT A REWARD POINT IS WORTH, AND HOW TO SAY SO. Pure: no database, no network, no state.
 *   (classic script shape · vendored to the browser like the other engines)
 *
 * Athi, 2026-09-10: *"can we showcase rewards accumulated in customer and supplier screen? Otherwise how anyone
 * knows the value of the rewards and its interpretation — say each reward point means something, either money or
 * some goods or some tour and so on."*
 *
 * ── ⭐⭐ THE POINT OF THIS FILE IS THE SECOND HALF OF THAT SENTENCE ──────────────────────────────────────────────
 * "You have 4,500 points" is the failure mode of every loyalty scheme ever built. It is a number with no unit. The
 * holder cannot tell whether it is worth a cup of tea or a washing machine, so they neither spend it nor value it,
 * and the shop carries a liability nobody is motivated by. A balance that cannot be interpreted is not a reward —
 * it is a number the shop owes and the customer ignores.
 *
 * So this module's job is not arithmetic. It is to take a balance and answer, in the shop's own words: WHAT IS
 * THIS WORTH, and what could I do with it right now.
 *
 * ── ADOPTED: schema.org MemberProgram (2024) ────────────────────────────────────────────────────────────────────
 * A MemberProgram has tiers; a tier has `hasTierBenefit`, and the vocabulary defines exactly two kinds:
 *   · TierBenefitLoyaltyPrice  — members get a better price
 *   · TierBenefitLoyaltyPoints — members earn points
 * ⚠️ THE FIRST ONE IS ALREADY BUILT AND IS NOT POINTS AT ALL. lib/customer-groups.js already scopes an offer to a
 * segment (new · regular · high_value · inactive) or to ONE named customer. Those segments ARE tiers, and a
 * customer-scoped offer IS TierBenefitLoyaltyPrice. Nothing here re-implements it.
 * This file is the other benefit — points — and specifically the part that makes them mean something.
 *
 * ── ⚠️ WHAT THIS FILE REFUSES TO DO ─────────────────────────────────────────────────────────────────────────────
 * 1. IT HOLDS NO BALANCE. A points balance is a LIABILITY — money the shop owes — so it belongs in an append-only
 *    ledger with the same care as a bill, not in a module that can be reloaded. This one is handed a balance.
 * 2. IT NEVER INVENTS A WORTH. If the programme has not declared what a point converts into, worthOf() says so
 *    rather than guessing a rupee. A guessed conversion rate is a number a shop would be held to.
 * 3. IT NEVER DECIDES A REDEMPTION IS ALLOWED. Expiry, minimum spend, one-per-visit — those are the programme's
 *    rules and the caller's decision. This answers "what could this buy", never "go ahead".
 */
(function (root) {

  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function R2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /**
   * ── THE PROGRAMME, as a definition's rules ──────────────────────────────────────────────────────────────────
   *   { name, earn: { per, points }, redeem: [ … ], expires_months }
   *
   * earn   — "points per amount spent": { per: 100, points: 1 } is one point per ₹100 of a bill.
   * redeem — WHAT A POINT TURNS INTO. A list, because there is rarely one answer, and each entry says what KIND
   *          of thing it is. This is the whole reason the module exists:
   *            { kind:'money',  points: 1,   amount: 1 }                → 1 point = ₹1 off
   *            { kind:'item',   points: 500, item_id:'…', name:'1 kg sugar' }
   *            { kind:'thing',  points: 20000, name:'a weekend in Ooty for two' }
   *          'thing' is deliberate. A tour, a hamper, a place at an event — things a catalogue does not hold and a
   *          rupee does not describe. Forcing them into a money value would either understate them or invent one.
   */
  var REDEEM_KINDS = ['money', 'item', 'thing'];

  /** the money value of one point, or null when the programme has not said — null is an answer, not a failure */
  function pointValue(prog) {
    var r = (prog && Array.isArray(prog.redeem) ? prog.redeem : []).filter(function (x) { return x && x.kind === 'money'; })[0];
    if (!r) return null;
    var pts = num(r.points), amt = num(r.amount);
    if (!pts || pts <= 0 || amt === null) return null;
    return R2(amt / pts);
  }

  /**
   * ⭐⭐ WHAT A BALANCE IS WORTH, IN WORDS — the answer to Athi's question.
   * Returns { points, money, moneyKnown, reach: [...], next: {...}|null, says }
   *   reach — what this balance could be exchanged for RIGHT NOW
   *   next  — the nearest thing it cannot yet reach, and how far off it is. ⚠️ This is the half that makes a
   *           balance motivating rather than decorative: "180 more points and the sugar is free" is a reason to
   *           come back; "450 points" is not.
   */
  function worthOf(prog, points, ctx) {
    /**
     * ⚠️ THE CALLER FORMATS THE MONEY, NOT THIS FILE. A pure module has no locale and no currency, so a sentence it
     * builds with a bare number in it is wrong everywhere except India — "worth 450 off" is not a price. The offers
     * engine already solved this by taking ctx.money, and this takes the same shape rather than inventing a second.
     * Without one it falls back to the plain number, which is honest for a log and never shown to a customer.
     */
    var fmt = (ctx && typeof ctx.money === 'function') ? ctx.money : function (n) { return String(n); };
    var p = Math.max(0, Math.floor(num(points) || 0));
    var per = pointValue(prog);
    var all = (prog && Array.isArray(prog.redeem) ? prog.redeem : [])
      .filter(function (x) { return x && REDEEM_KINDS.indexOf(x.kind) >= 0 && num(x.points) > 0; })
      .sort(function (a, b) { return num(a.points) - num(b.points); });

    var reach = [], next = null;
    all.forEach(function (r) {
      if (r.kind === 'money') return;                    /* money is continuous — described separately, below */
      if (num(r.points) <= p) reach.push({ name: r.name || 'a reward', points: num(r.points), kind: r.kind });
      else if (!next) next = { name: r.name || 'a reward', points: num(r.points), short: num(r.points) - p };
    });

    var money = (per === null) ? null : R2(p * per);
    var says;
    if (!p) {
      says = 'No points yet' + (prog && prog.earn && num(prog.earn.per)
        ? ' — ' + describeEarn(prog, ctx) : '');
    } else if (money !== null && reach.length) {
      says = p + ' points · worth ' + fmt(money) + ' off, or ' + reach[reach.length - 1].name;
    } else if (money !== null) {
      says = p + ' points · worth ' + fmt(money) + ' off';
    } else if (reach.length) {
      says = p + ' points · enough for ' + reach[reach.length - 1].name;
    } else {
      /* ⚠️ the honest sentence when the shop has declared nothing it converts into */
      says = p + ' points · this shop has not said what they are worth yet';
    }
    return { points: p, money: money, moneyKnown: money !== null, reach: reach, next: next, says: says };
  }

  /** ⭐ how they are earned, in one line — a rule nobody can state is a rule nobody trusts */
  function describeEarn(prog, ctx) {
    var fmt = (ctx && typeof ctx.money === 'function') ? ctx.money : function (n) { return String(n); };
    var e = prog && prog.earn;
    var per = num(e && e.per), pts = num(e && e.points);
    if (!per || !pts) return 'this shop has not said how points are earned';
    return pts + (pts === 1 ? ' point' : ' points') + ' for every ' + fmt(per) + ' spent';
  }

  /**
   * ⭐ WHAT A BASKET EARNS. Whole points only, and rounded DOWN.
   * ⚠️ Down, always. Rounding a customer up costs the shop a fraction of a point on every bill of the year, and
   * "I should have got 5" is a conversation nobody wins. Down is boring and defensible.
   * ⚠️ ON WHAT THE CUSTOMER ACTUALLY PAID, so the caller passes the net — earning on the gross would pay points on
   * a discount the shop just gave away.
   */
  function earnedOn(prog, netAmount) {
    var e = prog && prog.earn;
    var per = num(e && e.per), pts = num(e && e.points), amt = num(netAmount);
    if (!per || per <= 0 || !pts || pts <= 0 || !amt || amt <= 0) return 0;
    return Math.floor((amt / per) * pts);
  }

  /**
   * ⚠️ A LIABILITY, SAID PLAINLY. What the shop owes if every point outstanding were spent at the money rate.
   * A programme with no money rate cannot be valued this way, and null says so rather than implying zero.
   */
  function liability(prog, totalPoints) {
    var per = pointValue(prog);
    return per === null ? null : R2(Math.max(0, num(totalPoints) || 0) * per);
  }

  /* ── ⭐⭐ THE LEDGER ───────────────────────────────────────────────────────────────────────────────────────────
   *
   * APPEND-ONLY, ALWAYS. A balance is never stored; it is the fold of everything that happened. Storing it would
   * create two answers to one question, and the stored one would eventually be the wrong one — the same failure as
   * a cached total. definition_version already works this way and is append-only by GRANT rather than by habit,
   * which is the standard to hold this to when the table is written.
   *
   *   { at, points, why, ref }   points is POSITIVE to earn, NEGATIVE to spend.
   *
   * ⚠️ A CORRECTION IS AN ENTRY, NOT AN EDIT. Points given by mistake are taken back with a negative entry that
   * says why — never by deleting the row that gave them. A customer must be able to see what happened to their own
   * balance, and a deletion is the one thing that cannot be explained afterwards.
   */
  var ENTRY_WHY = ['earned', 'spent', 'adjusted', 'expired', 'reversed'];

  /** ⚠️ every field checked, because a malformed entry in an append-only ledger is permanent */
  function entry(o) {
    o = o || {};
    var pts = num(o.points);
    if (pts === null || !isFinite(pts) || pts === 0) return null;      /* a zero entry records nothing */
    var why = ENTRY_WHY.indexOf(String(o.why || '')) >= 0 ? String(o.why) : null;
    if (!why) return null;                                             /* an entry that cannot say why is not one */
    return { at: o.at || new Date().toISOString(), points: Math.trunc(pts), why: why,
             ref: o.ref == null ? null : String(o.ref), note: o.note == null ? null : String(o.note) };
  }

  /**
   * balanceOf(entries) → { points, earned, spent, entries }
   * ⚠️ IT NEVER GOES BELOW ZERO IN THE FOLD — but it does not silently clamp either. A negative fold means the
   * ledger is WRONG (a spend was written that the balance could not cover), and that is a fact worth surfacing,
   * not hiding: "negative: true" rides the answer so a caller can refuse to trade on it.
   */
  function balanceOf(entries) {
    var earned = 0, spent = 0, n = 0;
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      var p = num(e && e.points);
      if (p === null || !p) return;
      n++;
      if (p > 0) earned += Math.trunc(p); else spent += Math.trunc(-p);
    });
    var points = earned - spent;
    return { points: points, earned: earned, spent: spent, entries: n, negative: points < 0 };
  }

  /**
   * canSpend(balance, points) → { ok, why }
   * ⚠️ THE CAPABILITY REFUSES; IT DOES NOT DECIDE POLICY. Not enough points is arithmetic and belongs here. Whether
   * a shop ALLOWS a redemption today — a minimum spend, one per visit, blackout dates — is the programme's rule and
   * the caller's decision, and answering it here would put a shop's policy inside a shared module.
   */
  function canSpend(balance, points) {
    var have = num(balance && balance.points !== undefined ? balance.points : balance) || 0;
    var want = Math.trunc(num(points) || 0);
    if (want <= 0) return { ok: false, why: 'that is not a number of points to spend' };
    if (have < want) return { ok: false, why: 'only ' + have + ' point' + (have === 1 ? '' : 's') + ' available' };
    return { ok: true, why: null };
  }

  /**
   * ⭐ SPENDING IS AN ENTRY THE CALLER THEN WRITES — this builds it, it does not persist it.
   * ⚠️ The ref is the bill it was spent on. A point spent against nothing is a point nobody can trace, and a
   * customer disputing their balance has only the ledger to read.
   */
  function spend(balance, points, ref) {
    var ok = canSpend(balance, points);
    if (!ok.ok) return { ok: false, why: ok.why, entry: null };
    return { ok: true, why: null, entry: entry({ points: -Math.trunc(points), why: 'spent', ref: ref }) };
  }
  /** ⭐ and earning, the same way — built here, written by the caller, with the bill it came from */
  function earn(prog, netAmount, ref) {
    var p = earnedOn(prog, netAmount);
    return p > 0 ? entry({ points: p, why: 'earned', ref: ref }) : null;
  }

  /** the schema.org shape, for a storefront or a feed — vocabulary alignment, no vendor code */
  function schemaOrg(prog) {
    if (!prog || !prog.name) return null;
    return {
      '@type': 'MemberProgram',
      name: String(prog.name),
      hasTiers: [{
        '@type': 'MemberProgramTier',
        name: String(prog.tier_name || 'Members'),
        hasTierBenefit: 'https://schema.org/TierBenefitLoyaltyPoints',
      }],
    };
  }

  var API = { REDEEM_KINDS: REDEEM_KINDS, ENTRY_WHY: ENTRY_WHY,
              pointValue: pointValue, worthOf: worthOf, describeEarn: describeEarn,
              earnedOn: earnedOn, liability: liability, schemaOrg: schemaOrg,
              entry: entry, balanceOf: balanceOf, canSpend: canSpend, spend: spend, earn: earn };
  root.CBRewards = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : this);
