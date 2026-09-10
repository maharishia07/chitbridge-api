/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
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
   * ── ⭐⭐ HOW POINTS ARE EARNED — A REGISTRY, NOT A FORMULA ────────────────────────────────────────────────────
   * The shop declares { kind, …parameters }. This module knows how to APPLY a kind and nothing about which one a
   * business ought to choose.
   *
   *   needs  — the parameters the kind cannot work without. A rule missing one is REFUSED, not guessed at.
   *   says   — the sentence a shopkeeper and a customer both read. A rule nobody can state is a rule nobody trusts.
   *   points — how many whole points a basket earns under it.
   *
   * ⚠️ THE BASKET IS PASSED WHOLE, never just a total, so a kind that needs the lines can have them without every
   * caller learning a new signature the day somebody invents one.
   *      basket = { net, gross, lines: [{ qty, net, category }], count }
   */
  var EARN_KINDS = {

    /** n points for every X spent — the ordinary retail rule. { per: 100, points: 1 } */
    per_amount: {
      needs: ['per', 'points'],
      says: function (r, fmt) { return plural(r.points, 'point') + ' for every ' + fmt(r.per) + ' spent'; },
      points: function (r, b) { return Math.floor((b.net / r.per) * r.points); },
    },

    /** ⭐ ATHI'S OWN EXAMPLE: the sale value IS the points, at a declared rate. { rate: 1 } → ₹1 = 1 point */
    value_as_points: {
      needs: ['rate'],
      says: function (r, fmt) { return plural(r.rate, 'point') + ' for every ' + fmt(1) + ' of the bill'; },
      points: function (r, b) { return Math.floor(b.net * r.rate); },
    },

    /** n points per bill, whatever it is worth — a rule that rewards coming back rather than spending */
    per_visit: {
      needs: ['points'],
      says: function (r) { return plural(r.points, 'point') + ' each time you shop here'; },
      points: function (r) { return Math.floor(r.points); },
    },

    /** n points per unit bought — for a shop that wants to move volume, not value */
    per_item: {
      needs: ['points'],
      says: function (r) { return plural(r.points, 'point') + ' for every item'; },
      points: function (r, b) { return Math.floor((b.count || 0) * r.points); },
    },

    /**
     * ⭐⭐⭐ ON THESE PRODUCTS — the one Athi asked for. Instead of taking money off a shampoo, hand out points on
     * it: the shop gives nothing away today and buys a reason to come back.
     *   { kind:'on_items', points: 200, per: 'unit'|'line', applies_to: { category:'Personal care' } }
     * ⚠️ applies_to is the OFFERS ENGINE'S vocabulary, deliberately — one way to say "these products".
     */
    on_items: {
      needs: ['points'],
      says: function (r) {
        return plural(r.points, 'point') + ' on ' + scopeWords(r.applies_to)
          + (r.per === 'line' ? '' : ' — for each one bought');
      },
      points: function (r, b, ctx) {
        var hit = (b.lines || []).filter(function (l) { return matches(l, r.applies_to, ctx); });
        if (!hit.length) return 0;
        if (r.per === 'line') return Math.floor(hit.length * r.points);
        var units = hit.reduce(function (a, l) { return a + (num(l.qty) || 0); }, 0);
        return Math.floor(units * r.points);
      },
    },
  };

  /** ⚠️ the shop's own words for a scope, so the rule reads as a sentence rather than as a filter */
  function scopeWords(s) {
    if (!s) return 'anything';
    if (s.category) return String(s.category);
    if (Array.isArray(s.categories) && s.categories.length) return s.categories.join(' or ');
    if (Array.isArray(s.item_ids) && s.item_ids.length) return plural(s.item_ids.length, 'chosen product');
    if (Array.isArray(s.skus) && s.skus.length) return plural(s.skus.length, 'chosen product');
    return 'anything';
  }

  /**
   * ⚠️⚠️ THE AUTHORITATIVE MATCHER IS THE OFFERS ENGINE'S, NOT THIS ONE. If the caller passes ctx.matches — and the
   * till does, wired to the same engine that decides which lines an offer touches — that is used, so a product
   * either qualifies for both or for neither. Two matchers would eventually disagree, and the day they did, a
   * customer would see a reward promised on a shelf and not given on the bill.
   * The fallback below reads the SAME field names and exists only so this module is usable with no engine at all.
   */
  function matches(line, applies_to, ctx) {
    if (ctx && typeof ctx.matches === 'function') return !!ctx.matches(line, applies_to);
    if (!applies_to) return true;
    var lists = 0, hit = false;
    var has = function (arr, v) { return Array.isArray(arr) && arr.length
      && arr.map(String).indexOf(String(v)) >= 0; };
    if (Array.isArray(applies_to.item_ids) && applies_to.item_ids.length) {
      lists++; if (has(applies_to.item_ids, line && line.item_id)) hit = true; }
    if (Array.isArray(applies_to.skus) && applies_to.skus.length) {
      lists++; if (has(applies_to.skus, line && line.sku)) hit = true; }
    var cats = [].concat(applies_to.category ? [applies_to.category] : [],
                         Array.isArray(applies_to.categories) ? applies_to.categories : []);
    if (cats.length) {
      lists++;
      var mine = (line && (line.categories || (line.category ? [line.category] : []))) || [];
      if (cats.map(String).some(function (c) { return mine.map(String).indexOf(c) >= 0; })) hit = true;
    }
    return lists ? hit : true;
  }

  function plural(n, w) { var v = Number(n) || 0; return v + ' ' + w + (v === 1 ? '' : 's'); }

  /**
   * ⚠️ A RULE MISSING A PARAMETER EARNS NOTHING, and says which one is absent. Guessing a default here would mint
   * points a shop never agreed to give — and points are a liability.
   */
  function earnCheck(rule) {
    var k = rule && EARN_KINDS[rule.kind];
    if (!k) return { ok: false, why: rule && rule.kind ? 'no such earning rule: ' + rule.kind
                                                       : 'this shop has not said how points are earned' };
    var missing = k.needs.filter(function (n) { var v = num(rule[n]); return v === null || v <= 0; });
    if (missing.length) return { ok: false, why: 'the rule needs ' + missing.join(' and ') };
    return { ok: true, why: null };
  }

  /**
   * ── WHAT A POINT TURNS INTO ─────────────────────────────────────────────────────────────────────────────────
   *   { kind:'money',  points: 100,   amount: 1 }              → 100 points = ₹1 off
   *   { kind:'item',   points: 10000, item_id:'…', name:'…' }  → a product, free
   *   { kind:'thing',  points: 20000, name:'a weekend in Ooty' }
   * 'thing' is deliberate. A tour, a hamper, a place at an event — things a catalogue does not hold and a rupee
   * does not describe. Forcing them into a money value would either understate them or invent one.
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

  /** ⭐ how they are earned, in one line — asked of the KIND, so a new mechanism describes itself */
  function describeEarn(prog, ctx) {
    var fmt = (ctx && typeof ctx.money === 'function') ? ctx.money : function (n) { return String(n); };
    var rule = prog && prog.earn;
    var ok = earnCheck(rule);
    if (!ok.ok) return ok.why;
    return EARN_KINDS[rule.kind].says(rule, fmt);
  }

  /**
   * ⭐ WHAT A BASKET EARNS. Whole points only, and rounded DOWN.
   * ⚠️ Down, always. Rounding a customer up costs the shop a fraction of a point on every bill of the year, and
   * "I should have got 5" is a conversation nobody wins. Down is boring and defensible.
   * ⚠️ ON WHAT THE CUSTOMER ACTUALLY PAID, so the caller passes the net — earning on the gross would pay points on
   * a discount the shop just gave away.
   */
  function earnedOn(prog, basket, ctx) {
    var rule = prog && prog.earn;
    if (!earnCheck(rule).ok) return 0;
    /* ⚠️ a bare number is still accepted — it is the net, and the commonest call. Breaking every caller to add a
       shape they do not need would be a refactor nobody asked for. */
    var b = (basket && typeof basket === 'object') ? basket : { net: num(basket) };
    b = { net: num(b.net) || 0, gross: num(b.gross) || 0, count: num(b.count) || 0,
          lines: Array.isArray(b.lines) ? b.lines : [] };
    if (b.net <= 0) return 0;                       /* a refund must never mint points */
    var p = EARN_KINDS[rule.kind].points(rule, b, ctx);
    return (isFinite(p) && p > 0) ? Math.floor(p) : 0;
  }

  /**
   * ⚠️ A LIABILITY, SAID PLAINLY. What the shop owes if every point outstanding were spent at the money rate.
   * A programme with no money rate cannot be valued this way, and null says so rather than implying zero.
   */
  function liability(prog, totalPoints) {
    var per = pointValue(prog);
    return per === null ? null : R2(Math.max(0, num(totalPoints) || 0) * per);
  }

  /* ── ⭐⭐ WHO HOLDS THE POINTS ─────────────────────────────────────────────────────────────────────────────────
   *
   * Athi, 2026-09-10: *"walk-ins skip earning, points expire after 12 months as a declarable stuff, and for walk-in
   * we can keep it against the phone number. For online we can keep it against the customer id — the bridge id or
   * the user id. If it is walk-in customer, still are we creating the user id? I guess not."*
   *
   * ⭐ HE IS RIGHT, AND FOR A SECOND REASON BEYOND THE OBVIOUS. customer_list requires a customer_identity_id, so a
   * walk-in cannot be in it at all — but more than that, his own standing rule is that a user_id is chosen at
   * REGISTRATION and never changed. Minting one on a customer's behalf because they bought soap would pre-empt a
   * decision that is theirs to make, and leave them with a name they never picked.
   *
   * ⚠️ SO A HOLDER IS A (scheme, value) PAIR — the same shape as an identifier and as a payee address, for the same
   * reason: there is no one way to name a person.
   *     { scheme:'identity', value:<uuid> }   a registered customer — the bridge id
   *     { scheme:'phone',    value:'+91…' }   a walk-in who gave a number
   *   and NOTHING for a walk-in who gave neither, which is not a failure: it is a customer who cannot be paid back
   *   later, and earning is skipped rather than accrued to nobody.
   *
   * ⚠️⚠️ A PHONE-HELD BALANCE IS CLAIMABLE BY WHOEVER KNOWS THE NUMBER. That is a real exposure and it is the
   * shop's to accept — the same trust it already places in whoever stands at the counter with the cash drawer. It
   * is named here so nobody discovers it later and calls it a bug.
   */
  function holderOf(customer) {
    var c = customer || {};
    var id = c.identity_id || c.customer_identity_id || c.bridge_id || c.user_id;
    if (id && String(id).trim()) return { scheme: 'identity', value: String(id).trim() };
    var phone = String(c.phone == null ? '' : c.phone).replace(/[^0-9+]/g, '');
    /* ⚠️ eight digits is the shortest national number worth trusting; below that it is a typo, not a customer */
    if (phone.replace(/[^0-9]/g, '').length >= 8) return { scheme: 'phone', value: phone };
    return null;                                     /* a walk-in who gave nothing — earning is skipped */
  }
  /** ⚠️ one string for a holder, so a ledger row and a lookup cannot disagree about who someone is */
  function holderKey(h) { return h ? (h.scheme + ':' + h.value) : null; }

  /**
   * ── ⭐⭐ THE WALK-IN WHO COMES BACK AND REGISTERS ───────────────────────────────────────────────────────────────
   * A shop earns points against a phone number for a year, then that person opens an account. Their balance is
   * sitting under { scheme:'phone' } and their new life is under { scheme:'identity' } — and if nothing joins the
   * two, the shop has just taken away everything it promised them, at the exact moment they committed.
   *
   * ⭐ CLAIMING IS TWO ENTRIES, NOT AN UPDATE. The phone holder is closed with a negative entry and the identity
   * holder opened with the matching positive one, both carrying the same ref. Rewriting the old rows to point at
   * the new holder would erase the fact that these points were earned by a walk-in — and the ledger is append-only
   * by GRANT anyway, so it is not merely bad practice here, it is refused by the database.
   * ⚠️ Nothing is claimed automatically. Somebody at the counter has to say that this account and this number are
   * the same person — a phone number is not proof, and an automatic merge would move a stranger's balance.
   */
  function claim(fromBalance, from, to, ref) {
    var pts = Math.trunc(num(fromBalance && fromBalance.points) || 0);
    if (!from || !to) return { ok: false, why: 'a claim needs both holders', entries: [] };
    if (holderKey(from) === holderKey(to)) return { ok: false, why: 'the same holder', entries: [] };
    if (to.scheme !== 'identity') return { ok: false, why: 'points can only be claimed onto an account', entries: [] };
    if (pts <= 0) return { ok: false, why: 'there is nothing to claim', entries: [] };
    var note = 'claimed from ' + from.scheme + ' ' + from.value;
    return { ok: true, why: null, points: pts, entries: [
      entry({ points: -pts, why: 'claimed', ref: ref, note: 'moved to the account', holder: from }),
      entry({ points:  pts, why: 'claimed', ref: ref, note: note,                   holder: to }),
    ] };
  }

  /* ── ⭐ WHEN POINTS RUN OUT ────────────────────────────────────────────────────────────────────────────────────
   * Declared, not assumed: expires_months on the programme. Athi chose 12 as the shop's default, but a shop that
   * says nothing has points that DO NOT expire — because silently expiring somebody's balance is taking something
   * back, and a shop must say it out loud before it may do it.
   */
  function expiresAt(prog, earnedAt) {
    var m = num(prog && prog.expires_months);
    if (!m || m <= 0) return null;                   /* not declared = never expires. Silence is not consent. */
    var d = new Date(earnedAt || Date.now());
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + Math.floor(m));
    return d.toISOString();
  }
  /**
   * ⭐ WHAT HAS EXPIRED, as entries to write — expiry is a LEDGER EVENT, not a filter over history. A balance that
   * quietly stopped counting old rows would be unexplainable to the customer holding it; a negative entry saying
   * "expired" can be read, argued with and reversed.
   */
  function expired(prog, entries, now) {
    var m = num(prog && prog.expires_months);
    if (!m || m <= 0) return [];
    var t = new Date(now || Date.now()).getTime();
    var out = [];
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (!e || num(e.points) <= 0 || e.why !== 'earned' || e.expired_by) return;
      var due = expiresAt(prog, e.at);
      if (due && new Date(due).getTime() <= t) {
        out.push(entry({ points: -Math.trunc(num(e.points)), why: 'expired', ref: e.ref,
                         note: 'earned ' + String(e.at).slice(0, 10) }));
      }
    });
    return out.filter(Boolean);
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
  /* ⚠️ 'claimed' moves a balance between holders and nets to zero across the pair — it is not a gift and not a
   *    spend, and calling it either would make the shop's own totals wrong. */
  var ENTRY_WHY = ['earned', 'spent', 'adjusted', 'expired', 'reversed', 'claimed'];

  /** ⚠️ every field checked, because a malformed entry in an append-only ledger is permanent */
  function entry(o) {
    o = o || {};
    var pts = num(o.points);
    if (pts === null || !isFinite(pts) || pts === 0) return null;      /* a zero entry records nothing */
    var why = ENTRY_WHY.indexOf(String(o.why || '')) >= 0 ? String(o.why) : null;
    if (!why) return null;                                             /* an entry that cannot say why is not one */
    var e = { at: o.at || new Date().toISOString(), points: Math.trunc(pts), why: why,
              ref: o.ref == null ? null : String(o.ref), note: o.note == null ? null : String(o.note) };
    /* ⚠️ the holder rides the ENTRY, not just the row it lands in, so an entry read back out of a list still
       says whose it is — a claim writes two entries under two holders in one breath. */
    if (o.holder && o.holder.scheme && o.holder.value) {
      e.holder = { scheme: String(o.holder.scheme), value: String(o.holder.value) };
    }
    return e;
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
  function earn(prog, netAmount, ref, ctx) {
    var p = earnedOn(prog, netAmount, ctx);
    return p > 0 ? entry({ points: p, why: 'earned', ref: ref }) : null;
  }

  /**
   * ── ⭐⭐ WHAT THE BILL SAYS ABOUT REWARDS ─────────────────────────────────────────────────────────────────────
   * Athi, 2026-09-10: *"reward point can be showcased in the bill, similarly when we adjust next time the reward
   * conversion should be showcased as well — say reward points added, and reward point encashed."*
   *
   * ⚠️⚠️ THE TWO ARE NOT THE SAME KIND OF THING, and a bill that presents them alike would be wrong about money.
   *   ADDED    — a promise. It changes no total. It must sit OUTSIDE the money block, or a customer reading down
   *              the slip will try to make it add up and fail.
   *   ENCASHED — money off, today. It is an adjustment like any discount and it MUST be inside the total, or the
   *              slip will not foot and the drawer will not agree with the bill.
   * Getting that backwards is the kind of error a customer finds first, at the counter, holding the paper.
   *
   * Returns { added, encashed, lines: [{ where:'money'|'note', label, amount, points }] }
   */
  function billSays(prog, o, ctx) {
    var fmt = (ctx && typeof ctx.money === 'function') ? ctx.money : function (n) { return String(n); };
    o = o || {};
    var added = Math.max(0, Math.floor(num(o.added) || 0));
    var spent = Math.max(0, Math.floor(num(o.spent) || 0));
    var per = pointValue(prog);
    var off = (per === null) ? 0 : R2(spent * per);
    var lines = [];
    /* ⚠️ money FIRST, because it is the half that changes what is owed */
    if (spent > 0 && off > 0) {
      lines.push({ where: 'money', points: -spent, amount: -off,
                   label: 'Reward points used (' + spent + ')' });
    }
    if (added > 0) {
      /* ⚠️ a NOTE, never an amount — writing a money figure beside it invites the customer to subtract it */
      lines.push({ where: 'note', points: added, amount: null,
                   label: 'Reward points earned: ' + added });
    }
    /* ⭐ and where they now stand, which is the reason to come back — the whole point of a reward over a discount */
    if (o.balance != null) {
      var b = Math.max(0, Math.floor(num(o.balance) || 0));
      var w = worthOf(prog, b, ctx);
      lines.push({ where: 'note', points: b, amount: null, label: 'Your points: ' + w.says
        + (w.next ? ' · ' + w.next.short + ' more for ' + w.next.name : '') });
    }
    return { added: added, encashed: spent, money: off, lines: lines };
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

  var API = { REDEEM_KINDS: REDEEM_KINDS, EARN_KINDS: EARN_KINDS, earnKinds: Object.keys(EARN_KINDS),
              earnCheck: earnCheck, ENTRY_WHY: ENTRY_WHY,
              pointValue: pointValue, worthOf: worthOf, describeEarn: describeEarn,
              earnedOn: earnedOn, liability: liability, schemaOrg: schemaOrg,
              entry: entry, balanceOf: balanceOf, canSpend: canSpend, spend: spend, earn: earn,
              billSays: billSays, holderOf: holderOf, holderKey: holderKey,
              expiresAt: expiresAt, expired: expired, claim: claim };
  root.CBRewards = API;
  if (typeof module !== 'undefined' && module.exports) var EXPORTS = API;

})(typeof window !== 'undefined' ? window : this);

window.CBRewards = EXPORTS;
})();
