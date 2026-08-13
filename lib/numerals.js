'use strict';
// lib/numerals.js — the CLOSED CLASS. Numbers, negation, and the words that are never either.
//
// Athi, 2026-08-11: *"we cannot work for a million combinations"* and *"there will be multiple fillers available
// in every language and there will be similar syllable mean differently in language."*
//
// ── ⚠️ WHY THIS IS CODE AND NOT A PROMPT ────────────────────────────────────────────────────────────────────────
// Vocabulary splits in two and the halves scale oppositely:
//   OPEN class  — product names, qualifiers, dialect. Unbounded, differs per trade. LEARNED from corrections.
//   CLOSED class — numerals, negation, and/or. ~40 tokens per language, finite, and then DONE FOREVER.
// Asking a model to be reliable about the closed half is paying per call, forever, for something a table settles
// once. `pathu kilo` came back as 5 in a live test. That is a money error, and it is not an AI judgment.
//
// ── ⚠️ THE `oru` TRAP — a flat dictionary makes things WORSE, not better ────────────────────────────────────────
// The obvious build (a numeral table, reject the model on mismatch) HALVES real orders, because Athi's own corpus
// contains:
//        "dr fix oru 4 packet"      → 4      "chicken oru 10 piece"  → 10
//        "oru watter bottle"        → 1      "oru pepsi periya bottle" → 1
// `oru` is "a/some" when another numeral follows it, and 1 when none does. Encoding the table without this rule
// would have been confidently wrong on two of five lines — worse than not checking at all, because the check
// would carry authority.
//
// ── ⚠️ WHAT THIS FILE NEVER DOES ────────────────────────────────────────────────────────────────────────────────
// It never picks a quantity. It VERIFIES one, and when it disagrees the answer is `null` + a flag — never a
// substitution. A checker that silently overwrites the model has simply become a second, dumber model.

/* Tamil numerals, in Roman script (Tanglish — what people actually type) and in Tamil script.
   ⚠️ SPELLING VARIES BY SPEAKER, not by meaning: onnu/onru, moonu/moondru, anju/aindhu are the same number.
   All spellings map to one value; none of them is "correct". */
const TA = {
  onnu: 1, onru: 1, ondru: 1, onnru: 1,
  rendu: 2, irandu: 2, rendo: 2,
  moonu: 3, moondru: 3, munu: 3,
  naalu: 4, naangu: 4, nalu: 4,
  anju: 5, aindhu: 5, ainthu: 5,
  aaru: 6, aru: 6,
  ezhu: 7, elu: 7,
  ettu: 8,
  onbadhu: 9, onbathu: 9, onpathu: 9,
  pathu: 10, paththu: 10,
  pathinonnu: 11, pannirendu: 12, pannerendu: 12,
  pathinanju: 15, pathinaindhu: 15,
  irubadhu: 20, irupathu: 20, irubathu: 20, irupadhu: 20, iruvathu: 20,
  muppadhu: 30, muppathu: 30, muppadu: 30,
  naapadhu: 40, narpathu: 40, naarpathu: 40,
  ambadhu: 50, aimbathu: 50, ambathu: 50,
  aruvadhu: 60, ezhuvadhu: 70, embadhu: 80, thonnooru: 90,
  nooru: 100, aayiram: 1000,
  arai: 0.5, kaal: 0.25, mukkaal: 0.75,
  'ஒன்று': 1, 'இரண்டு': 2, 'மூன்று': 3, 'நான்கு': 4, 'ஐந்து': 5,
  'ஆறு': 6, 'ஏழு': 7, 'எட்டு': 8, 'ஒன்பது': 9, 'பத்து': 10,
  'பதினைந்து': 15, 'இருபது': 20, 'முப்பது': 30, 'நாற்பது': 40, 'ஐம்பது': 50,
  'நூறு': 100, 'ஆயிரம்': 1000, 'அரை': 0.5, 'கால்': 0.25,
};

const EN = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  half: 0.5, quarter: 0.25, dozen: 12,
};

const NUMERALS = Object.assign({}, TA, EN);

/* ⚠️ FILLERS — "a/an", not "one". `oru` before another numeral is an article; alone it means 1.
   This single rule is the difference between the check helping and the check hurting. */
const FILLERS = new Set(['oru', 'oru', 'ஒரு', 'a', 'an', 'some', 'konjam', 'கொஞ்சம்']);

/* ⚠️ NEGATION — `venam` (don't want) and `venum` (want) differ by ONE LETTER and voice transcription confuses
   them. Creating a line the customer refused is the worst failure in the system, so this is never guessed:
   a phrase carrying a negation the model did not act on is FLAGGED for a human. */
const WANT = new Set(['venum', 'vendum', 'venu', 'வேண்டும்', 'வேணும்']);
const DONT_WANT = new Set(['venam', 'vendam', 'வேணாம்', 'வேண்டாம்']);

/* ⚠️ KNOWN-AMBIGUOUS — a third bucket beyond "recognised" and "unrecognised". `illa` means BOTH "or"
   (rendu illa moonu = two or three) and "not" (A grade illana = if not A grade). No dictionary can resolve it,
   because the dictionary is the thing that is ambiguous. Always flag, never guess. */
const AMBIGUOUS = new Set(['illa', 'illana', 'illena', 'இல்லை', 'இல்லைன்னா']);

const tokenise = (s) => String(s || '').toLowerCase()
  .replace(/[^\p{L}\p{N}\p{M}.]+/gu, ' ').trim().split(/\s+/).filter(Boolean);

/* Levenshtein, capped — a length gap of 3 is never a transliteration of the same word. */
function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let k = 1; k <= b.length; k++) {
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * ⭐ nearNumeral(token) — the SPELLING problem, which is the real one.
 *
 * Athi wrote `irupadhu`; the table had `irubadhu`, `irupathu`, `irubathu`. All four are the same word — Tamil
 * has no single correct romanisation, and every speaker transliterates by ear. So the closed class is finite in
 * MEANING and effectively unbounded in SPELLING, and enumerating spellings from a desk cannot work: I proved that
 * by writing three of the four and missing the one he actually types.
 *
 * ⚠️ A TIE IS FINE WHEN THE CANDIDATES AGREE. `irupadhu` is one edit from BOTH `irubadhu` and `irupathu` — and
 * both mean 20, so there is nothing to be ambiguous about. It is only a refusal when two candidates disagree on
 * the VALUE, which is the case that would put a wrong number on an order.
 *
 * ⚠️ AND SHORT TOKENS ARE EXCLUDED. `anju`(5), `aaru`(6), `ettu`(8) are four letters; one edit connects several
 * of them to each other and to ordinary words. A four-letter fuzzy match is a coincidence with a good disguise.
 */
function nearNumeral(token) {
  const t = String(token || '');
  if (t.length < 6) return null;                    // too short to fuzz safely — see above
  if (Object.prototype.hasOwnProperty.call(NUMERALS, t)) return null;   // exact already handled
  const tol = t.length >= 8 ? 2 : 1;
  let best = 99, hits = [];
  for (const k of Object.keys(NUMERALS)) {
    if (k.length < 6) continue;
    const d = lev(t, k);
    if (d > tol) continue;
    if (d < best) { best = d; hits = [k]; } else if (d === best) hits.push(k);
  }
  if (!hits.length) return null;
  const values = [...new Set(hits.map((k) => NUMERALS[k]))];
  /* Two spellings of the same number is agreement; two different numbers is a coin toss, and this refuses it. */
  if (values.length !== 1) return null;
  return { value: values[0], matched: hits, distance: best };
}

/**
 * numeralsIn(text) — every number the closed class can see, in order, with fillers already removed.
 *
 * Returns [{ value, token, index }]. A bare digit counts; so does a word.
 */
function numeralsIn(text) {
  const toks = tokenise(text);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isFiller = FILLERS.has(t);
    /* ⚠️ FILLERS ARE WORTH 1 EVEN WHEN THEY ARE NOT IN THE NUMERAL TABLE. `oru` and `ஒரு` mean "a/one" but are
       deliberately absent from NUMERALS — they are articles first. Looking them up in NUMERALS alone dropped
       them entirely, so "oru pepsi bottle" yielded NO quantity rather than 1. */
    /* ⚠️ A DIGIT GLUED TO ITS UNIT IS STILL A DIGIT. People type "10kg", "500ml", "2crate" — no space. Matching
       only bare digits made those numbers invisible, and an invisible number is worse than an unread one: a
       message reading "3 kg thakkali and 10kg onion" would see only [3], so the CORRECT extraction of 10 would
       be flagged as invented. A false alarm on a good order teaches people to ignore the alarm. */
    const glued = /^(\d+(?:\.\d+)?)\p{L}*$/u.exec(t);
    const asNum = glued ? Number(glued[1])
      : (Object.prototype.hasOwnProperty.call(NUMERALS, t) ? NUMERALS[t] : (isFiller ? 1 : null));
    if (asNum === null) {
      /* ⚠️ FUZZY IS TRIED ONLY AFTER EVERYTHING EXACT HAS FAILED, and it is MARKED. Callers must be able to treat
         a guessed spelling differently from a certain one — see verifyQuantity. */
      const near = nearNumeral(t);
      if (near) { out.push({ value: near.value, token: t, index: i, fuzzy: true, matched: near.matched }); }
      continue;
    }
    /* ⚠️ THE FILLER RULE. `oru 4 packet` → the 4 is the count and `oru` is an article. Look ahead past nothing
       else: it is only a filler when a numeral follows it directly-ish (within one token, to survive "oru
       periya bottle" staying 1 while "oru 10 piece" becomes 10). */
    if (isFiller) {
      const nxt = toks[i + 1], nxt2 = toks[i + 2];
      const followedByNumeral = [nxt, nxt2].some((x) => x && (/^\d+(?:\.\d+)?$/.test(x) || Object.prototype.hasOwnProperty.call(NUMERALS, x)));
      if (followedByNumeral) continue;              // an article — contributes no number
      out.push({ value: 1, token: t, index: i, from_filler: true });
      continue;
    }
    out.push({ value: asNum, token: t, index: i });
  }
  return out;
}

/**
 * ⭐ verifyQuantity(raw_phrase, extracted) — did the model read the number right?
 *
 * ⚠️ IT NEVER SUBSTITUTES. On disagreement the caller sets quantity to null and flags the line. A checker that
 * quietly replaced the model's answer with its own would be a second model with a smaller vocabulary, and the
 * line would look verified when two systems had merely disagreed.
 *
 * Returns:
 *   { ok:true, checked:false }                nothing to check against — silence, not approval
 *   { ok:true, checked:true }                 the model agrees with the words
 *   { ok:false, reason, expected, found }     REJECT the value: quantity → null, needs_human
 */
function verifyQuantity(raw_phrase, extracted) {
  const nums = numeralsIn(raw_phrase);
  if (!nums.length) return { ok: true, checked: false, reason: 'no numeral in the phrase' };

  const q = Number(extracted);
  const values = nums.map((n) => n.value);

  /**
   * ⭐ A FUZZY READING MAY ACCEPT, BUT IT MAY NOT REJECT.
   *
   * If every numeral we found was reached by SPELLING GUESS, then disagreement has two explanations — the model
   * was wrong, or our guess was — and we cannot tell which. Rejecting on that would null a CORRECT quantity
   * because a token was spelled unusually, which is precisely the false-alarm failure that teaches people to
   * ignore the alarm (the `10kg` case, and delivery divergence, both bit this way).
   *
   * So: exact evidence rejects; guessed evidence only flags. Agreement is trusted either way, because agreeing
   * with a guess costs nothing.
   */
  const anyExact = nums.some((n) => !n.fuzzy);

  /* One number in the words: it is the quantity, and the model must agree. This is the `pathu kilo → 5` case. */
  if (values.length === 1) {
    if (!Number.isFinite(q)) {
      return anyExact
        ? { ok: false, reason: 'the phrase names a quantity and none was extracted', expected: values[0], found: extracted }
        : { ok: true, checked: true, soft: true, reason: 'the phrase may say ' + nums[0].token + ' (' + values[0] + ') — spelling guessed', expected: values[0] };
    }
    if (q !== values[0]) {
      return anyExact
        ? { ok: false, reason: 'the phrase says ' + nums[0].token + ' (' + values[0] + ')', expected: values[0], found: q }
        : { ok: true, checked: true, soft: true, reason: '"' + nums[0].token + '" looks like ' + values[0] + ' (spelling guessed from ' + nums[0].matched.join('/') + ') but ' + q + ' was extracted — worth a look', expected: values[0], found: q };
    }
    return { ok: true, checked: true, expected: values[0], ...(nums[0].fuzzy ? { fuzzy: true } : {}) };
  }

  /* ⚠️ SEVERAL NUMBERS — a size and a count ("screw 5 inch 2 box"), or a range ("rendu illa moonu"). The model
     may legitimately pick any of them, so agreeing with ANY is accepted and agreeing with NONE is rejected.
     Being stricter here would reject correct readings; being looser would accept a number from nowhere. */
  if (Number.isFinite(q) && values.includes(q)) return { ok: true, checked: true, among: values };
  return anyExact
    ? { ok: false, reason: 'the phrase names ' + values.join(' / ') + ' and none of them is ' + extracted,
        expected: null, found: extracted, among: values }
    : { ok: true, checked: true, soft: true, among: values,
        reason: 'the phrase may name ' + values.join(' / ') + ' (spelling guessed) and none is ' + extracted };
}

/**
 * ⭐ unknownNumerals(text) — the GROWTH surface.
 *
 * Athi, 2026-08-13: *"that one we have to build at platform level so that dictionary grows."*
 *
 * Tokens sitting where a quantity belongs — directly before a unit word — that neither the table nor the fuzzy
 * pass recognised. These are the candidates worth adding, and they come from real messages rather than from
 * somebody's memory of a language.
 *
 * ⚠️ IT PROPOSES, IT NEVER ADDS. A numeral that entered the table wrongly would put a wrong quantity on every
 * future order containing that word, silently and forever. Same rule as catalogue synonyms: automatic promotion
 * only on independent repetition, and never for anything that changes a number without a human saying so.
 */
const UNIT_WORDS = new Set(['kg', 'kilo', 'kilos', 'gram', 'g', 'litre', 'liter', 'l', 'ml',
  'crate', 'crates', 'box', 'boxes', 'packet', 'packets', 'bundle', 'bag', 'bags', 'piece', 'pieces',
  'bottle', 'bottles', 'dozen', 'pottalam', 'kilova']);

function unknownNumerals(text) {
  const toks = tokenise(text);
  const out = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i], nxt = toks[i + 1];
    if (!UNIT_WORDS.has(nxt)) continue;                       // not in a quantity position
    if (/^\d/.test(t)) continue;                              // a digit; nothing to learn
    if (Object.prototype.hasOwnProperty.call(NUMERALS, t)) continue;
    if (FILLERS.has(t) || WANT.has(t) || DONT_WANT.has(t) || AMBIGUOUS.has(t)) continue;
    const near = nearNumeral(t);
    out.push({ token: t, before: nxt, ...(near ? { probably: near.value, like: near.matched } : {}) });
  }
  return out;
}

/**
 * negationIn(text) — is the customer REFUSING something here?
 * ⚠️ Returns `ambiguous` rather than a verdict when `illa` is present, because `illa` is both "or" and "not".
 */
function negationIn(text) {
  const toks = tokenise(text);
  const dont = toks.filter((t) => DONT_WANT.has(t));
  const want = toks.filter((t) => WANT.has(t));
  const amb = toks.filter((t) => AMBIGUOUS.has(t));
  if (amb.length) return { ambiguous: true, tokens: amb, reason: '"' + amb[0] + '" means both "or" and "not"' };
  if (dont.length) return { negated: true, tokens: dont };
  if (want.length) return { negated: false, tokens: want };
  return { negated: null };
}

module.exports = { numeralsIn, verifyQuantity, negationIn, nearNumeral, unknownNumerals, NUMERALS, FILLERS, WANT, DONT_WANT, AMBIGUOUS };
