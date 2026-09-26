/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
// @stage held
// @stage-note The numbering RULES, per jurisdiction. Built 2026-09-11; the counter adopts it in the same change.
'use strict';
/**
 * ── lib/docnumber.js · WHAT A DOCUMENT NUMBER MAY LOOK LIKE, WHEREVER THE SHOP IS ──────────────────────────────
 *
 * Athi, 2026-09-11, mid-way through a fix to the counter's bill series:
 *   *"when you work on billing series for India, how that works for other country? Do we need to consider that?
 *    If so, please keep it as a backlog and create a helper function or as a capability so it is well bound."*
 *
 * ⭐⭐⭐ HE STOPPED ME BUILDING INDIA INTO THE TILL. The series I was fixing — `C1/26-27/0041` — encodes three
 * Indian assumptions and none of them announce themselves:
 *
 *     the 16-character cap      a GST rule, not a universal one
 *     the April–March year      India's financial year; most of the world uses the calendar
 *     the annual reset          India resets each FY; the EU does not require a reset at all
 *
 * Each is invisible until a shop outside India uses it, and then all three are wrong at once and nobody can say
 * why. That is the definition of drift, and the reason this is a file rather than three constants in till.html.
 *
 * ── ⚠️⚠️ WHAT IS VERIFIED AND WHAT IS NOT ────────────────────────────────────────────────────────────────────
 *
 * Every rule below carries `verified`. India is the one this codebase has been built and tested against. The
 * others are stated at the level I can stand behind — "a sequential number, unique per supplier" — and DELIBERATELY
 * carry no length cap, no charset restriction and no reset, because I do not know them and a guessed limit is
 * worse than an absent one: it would refuse a number that is perfectly legal where the shop actually is.
 *
 * ⭐ An unknown country therefore gets a PERMISSIVE rule marked unverified, and the caller is expected to say so
 * rather than to pretend. `rules('BR').verified === false` is the honest answer to "is this right for Brazil".
 *
 * ⚠️ THIS IS NOT TAX ADVICE. See C:\dev\CONSTRAINTS-offline.md, which carries the same caveat and the reasoning.
 *
 * ── ZERO DEPENDENCIES · TIER A ────────────────────────────────────────────────────────────────────────────────
 */

/**
 * ⭐ THE PIVOT IS THE COUNTRY, which is the shape [[project-jurisdiction-pivot]] already settled for the profile:
 * one axis, then (scheme, value) pairs under it. Same idea here — the country selects the rule set.
 */
const RULES = {
  IN: {
    country: 'IN', name: 'India · GST',
    verified: true,
    /* ⚠️ A tax invoice number: at most sixteen characters, and only these separators. */
    maxLen: 16,
    charset: /^[A-Za-z0-9/-]+$/,
    charsetSays: 'letters, numbers, / and -',
    /* the financial year runs April to March, and the series resets with it */
    yearStartMonth: 4,
    resets: 'year',
    yearLabel: (d) => {
      const y = d.getFullYear(), apr = d.getMonth() >= 3, a = apr ? y : y - 1;
      return String(a).slice(2) + '-' + String(a + 1).slice(2);      // 26-27
    },
    /* multiple series ARE permitted — which is exactly what a second counter is */
    multipleSeries: true,
    says: 'A consecutive serial number, unique for the financial year, at most 16 characters. Multiple series '
        + 'are allowed, so each counter may number its own.',
  },

  /**
   * ⚠️ THE FALLBACK, AND IT IS DELIBERATELY LOOSE. The EU VAT directive asks for "a sequential number, based on
   * one or more series, which uniquely identifies the invoice" and says nothing about length, charset or a reset.
   * The UK and the UAE both require a unique sequential number and, as far as I know, cap nothing.
   *
   * ⭐ So the default enforces the ONE thing every jurisdiction I know of agrees on — unique and sequential — and
   * refuses to invent the rest. A shop in a country we have not studied gets a number that is legal by the only
   * rule we are sure of, and `verified:false` tells the caller not to claim more.
   */
  '*': {
    country: '*', name: 'Not yet studied',
    verified: false,
    maxLen: 32,                       // long enough for any shape we build; not a claim about the law
    charset: /^[A-Za-z0-9/_.-]+$/,
    charsetSays: 'letters, numbers and - / _ .',
    yearStartMonth: 1,                // calendar year, the commonest
    resets: 'never',                  // ⚠️ NOT resetting is the safe default: a continuing series is unique either way
    yearLabel: (d) => String(d.getFullYear()),
    multipleSeries: true,
    says: 'A sequential number that uniquely identifies the document. The length, the characters and whether the '
        + 'series restarts each year have NOT been checked for this country.',
  },
};

/** ⭐ the rule set for a country — never null, and it says whether it has been checked */
function rules(country) {
  const k = String(country || '').trim().toUpperCase();
  return RULES[k] || RULES['*'];
}

/** which jurisdictions have actually been studied — so a screen can say "India only" honestly */
function studied() {
  return Object.keys(RULES).filter((k) => k !== '*' && RULES[k].verified);
}

/**
 * ⭐ compose({ country, prefix, kind, seq, at }) → 'C1/26-27/0041'
 *
 * ⚠️ THE KIND TAG IS ONE LETTER. `GRN/C1/26-27/0007` is seventeen characters — over India's limit on the DEFAULT
 * till id, before anybody has done anything unusual. One letter fixes it and keeps the separators, which is the
 * better trade: `/` and `-` are explicitly permitted, they cost nothing legally, and without them the number
 * cannot be split back into its parts — `C126270041` is a different document depending on how long the till id
 * is, and a shopkeeper reading it down a phone has ten digits instead of three chunks.
 *
 * ⚠️⚠️ 'credit' IS A GST §34 CREDIT NOTE, AND IT MUST HAVE ITS OWN SERIES (2026-09-18). A return is not a
 * negative sale: §34 requires a separate document, referencing the original invoice, numbered in its own
 * consecutive series. Before this entry existed compose() simply did not find the kind, skipped the tag, and
 * handed back the next SALES number — a silent collision between two series that only shows up at filing.
 * 'C' costs one character: `C/C1/26-27/0001` is fifteen, inside India's sixteen. [[feedback-silence-is-the-bug]]
 */
/* ⭐ 'expense' JOINS THE SAME RULE (till expenses, 2026-09-26): money paid out of the drawer is not a sale
 * either, and needs its own series for the identical reason 'credit' does — this is the exact bug the comment
 * above describes, caught before shipping instead of found at filing. 'E' costs one character, same trade. */
/* ⭐ 'subscription' JOINS TOO (subscriptions/AMCs, 2026-09-26) — a real, referenceable commercial commitment
 * (a milk-delivery run, an AMC), same reasoning as 'credit'/'expense': it must never share the sales run. */
const KINDS = { sale: '', receipt: 'G', despatch: 'D', credit: 'C', expense: 'E', subscription: 'S' };

/**
 * ── ⭐⭐⭐ THE SHOP'S SCHEME, WHICH IS NOT THE JURISDICTION'S RULE ───────────────────────────────────────────
 *
 * Everything above this line is LAW — what a country permits. Everything below is a SHOP'S CHOICE within it.
 * Keeping them apart is the whole point of this file: a shop may pick any scheme it likes, and `check()` still
 * answers to India's sixteen characters regardless.
 *
 * Athi, 2026-09-16, having watched three days of numbers side by side:
 *   *"in 26-27 format it will not change at all — that was my observation."*
 *
 * He is right. `C1/26-27/0003` holds one fixed segment for 365 days and only the tail moves. A julian date moves
 * every morning, which is easier to tell apart at a glance on a pile of bills from the same shop.
 *
 *   dating   'fy'      C1/26-27/0003   the financial year is readable; the date is not
 *            'julian'  C1/26259/0003   the date is readable; the FINANCIAL YEAR IS NOT
 *
 * ⚠️⚠️ THE COST OF 'julian', STATED HERE BECAUSE IT IS EASY TO MISS: a julian year is Jan–Dec and the Indian tax
 * year is Apr–Mar, so ONE julian year spans TWO financial years. 31 Mar 2027 reads 27090 and 1 Apr 2027 reads
 * 27091 — different financial years, and the number says 27 for both. The number stays unique and sequential;
 * what is lost is the ability to read the FY off the invoice, which is what the number is legally organised
 * around. That is a shop's decision to take with its accountant, not one this file should take for it.
 *
 *   resets   'year'    one run per financial year — the tail NEVER repeats        (safest)
 *            'month'   restarts on the 1st — the tail repeats 12× a year
 *            'day'     restarts every morning — the tail repeats 365× a year
 *            'never'   one run for the life of the counter
 *
 * ⚠️ A RESET IS THE THING THAT MAKES A TAIL REPEAT. With 'year' the number `0001` is issued once and never comes
 * round; with 'day' it is issued every morning. Whichever is chosen, the WHOLE number stays unique because the
 * period sits in front of it — but the part a person's eye lands on is the tail, and that is the practical
 * question behind "will this bill look like a duplicate".
 */
const DEFAULT_SCHEME = { dating: 'fy', resets: 'year', dayRollHour: 0 };

/** day of the year, 1..366 */
function ordinal(d) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}
/**
 * ⭐ THE TRADING DAY, WHICH IS NOT ALWAYS THE CALENDAR DAY. A counter open past midnight — a hotel, a
 * restaurant, a night chemist — rings up at 1am and means the evening that has not finished yet. `dayRollHour`
 * says when the number's day advances: 0 is midnight (the default and what Athi asked for); 4 would keep a
 * 3am bill on the previous day's series.
 */
function tradingDay(at, dayRollHour) {
  const h = Math.max(0, Math.min(23, Math.floor(Number(dayRollHour) || 0)));
  const d = new Date(at.getTime());
  if (h > 0 && d.getHours() < h) d.setDate(d.getDate() - 1);
  return d;
}
/** 'YYDDD' — 16 Sept 2026 is 26259 */
function julianLabel(at, dayRollHour) {
  const d = tradingDay(at, dayRollHour);
  return String(d.getFullYear()).slice(2) + String(ordinal(d)).padStart(3, '0');
}
/** the label that sits between the prefix and the sequence */
function periodLabel(o) {
  const r = rules(o && o.country);
  const at = (o && o.at instanceof Date) ? o.at : new Date();
  const s = Object.assign({}, DEFAULT_SCHEME, o && o.scheme);
  if (s.dating === 'julian') return julianLabel(at, s.dayRollHour);
  return r.resets === 'year' ? r.yearLabel(at) : '';
}
/**
 * ⭐⭐ THE KEY THE SEQUENCE RESETS ON — and it is DELIBERATELY NOT the label above.
 *
 * ⚠️ A shop can date its numbers by the day and still run ONE sequence across the whole year: that is scheme C,
 * the one Athi chose, and it is the combination that gives a daily-changing number whose tail never repeats.
 * If the reset key were simply the printed label, choosing julian dating would force a daily reset and quietly
 * reintroduce the repeating tail he picked julian to avoid.
 */
function periodKey(o) {
  const r = rules(o && o.country);
  const at = (o && o.at instanceof Date) ? o.at : new Date();
  const s = Object.assign({}, DEFAULT_SCHEME, o && o.scheme);
  const d = tradingDay(at, s.dayRollHour);
  switch (s.resets) {
    case 'never': return 'all';
    case 'day':   return julianLabel(at, s.dayRollHour);
    case 'month': return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
    case 'year':
    default:      return r.resets === 'year' ? r.yearLabel(d) : String(d.getFullYear());
  }
}

function compose(o) {
  const r = rules(o && o.country);
  const at = (o && o.at instanceof Date) ? o.at : new Date();
  const tag = KINDS[(o && o.kind) || 'sale'];
  const prefix = String((o && o.prefix) || '').trim();
  const seq = Math.max(1, Math.floor(Number(o && o.seq) || 1));
  const parts = [];
  if (tag) parts.push(tag);
  if (prefix) parts.push(prefix);
  /* ⭐ the middle segment is the SHOP'S scheme (periodLabel), falling back to the jurisdiction's year when no
     scheme is given — so every existing caller composes exactly the number it composed before. */
  const label = periodLabel({ country: o && o.country, at: at, scheme: o && o.scheme });
  if (label) parts.push(label);
  /* ⚠️ padStart PADS, it does not truncate — the ten-thousandth bill is 10000 and the number simply lengthens.
     Wrapping would reuse a number, which is the one thing a series exists to prevent. */
  parts.push(String(seq).padStart(4, '0'));
  return parts.join('/');
}

/**
 * ⭐⭐ check(number, country) → { ok, reason, verified }
 *
 * ⚠️ `verified` travels with the answer, because "this passes" means something different in a country we have
 * studied and one we have not. A caller that shows a green tick for an unstudied jurisdiction is overstating what
 * was checked, and this is what stops it doing that silently.
 */
function check(number, country) {
  const r = rules(country);
  const s = String(number == null ? '' : number).trim();
  if (!s) return { ok: false, reason: 'A document number cannot be empty.', verified: r.verified };
  if (s.length > r.maxLen) {
    return { ok: false, verified: r.verified,
      reason: '"' + s + '" is ' + s.length + ' characters; ' + r.name + ' allows at most ' + r.maxLen + '.' };
  }
  if (!r.charset.test(s)) {
    return { ok: false, verified: r.verified,
      reason: '"' + s + '" uses a character ' + r.name + ' does not allow — ' + r.charsetSays + '.' };
  }
  return { ok: true, reason: '', verified: r.verified };
}

/**
 * ⭐ maxPrefix(country, kind) — how long a till id may be before the number it produces breaks the rule.
 *
 * ⚠️ THIS IS WHY THE SETTINGS FIELD WAS WRONG. It accepted six characters, which puts even a plain sale at
 * seventeen — over India's limit, with nothing anywhere saying so. Asking the rule rather than hard-coding 2 means
 * a shop in a country with no cap is not restricted for India's reasons.
 */
function maxPrefix(country, kind) {
  const r = rules(country);
  /* the number is TAG / PREFIX / YEAR / SEQ — measure everything that is not the prefix, then take the rest.
     ⚠️ Seven sequence digits, not four: the series must still fit when it passes 9,999. */
  const sample = compose({ country, prefix: 'X', kind, seq: 9999999 });
  const without = sample.length - 1;
  return Math.max(1, r.maxLen - without);
}

var EXPORTS = { rules, studied, compose, check, maxPrefix, KINDS, RULES,
                   periodLabel, periodKey, julianLabel, tradingDay, DEFAULT_SCHEME };

window.CBDoc = EXPORTS;
})();
