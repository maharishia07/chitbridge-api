/**
 * strings-qps.js — THE PSEUDO-LOCALE PACK (`qps`). Loaded by locale.js ONLY when the language `qps` is chosen —
 * and `qps` is offered on no Settings screen (LANG_NAMES has no such entry), so only a test or a lab can choose it.
 *
 * ⭐ WHAT IT IS. The standard practice (Microsoft `qps-ploc`, Unicode pseudo-localization): every string that goes
 * THROUGH the catalogue comes back accented, ~40 % longer and bracketed —  "Sales"  →  "[!! Ŝàļéš !!]"  — so that
 * on one screen a reader sees three things at once, without knowing a word of any other language:
 *   · a string still in plain English did NOT go through the catalogue (it is hard-wired, and no translator can reach it)
 *   · a box that clips or wraps badly at +40 % will clip in German, Tamil and Arabic
 *   · the brackets show where a sentence was built from pieces: "[!! Ŝhöŵ !!] 24 [!! ŕöŵš !!]" is concatenation
 * e2e/walk-locale.cjs opens every customer screen in `qps`, counts the plain-English text nodes and the clipped boxes,
 * and fails when either count rises (e2e/locale-baseline.json). docs/design/standards/LOCALE-STANDARD.md § pseudo-locale.
 *
 * ⭐ IT IS A PACK, NOT A CHANGE TO CBLocale. `CBLocale.pack(lang)` already fetches `app/strings-<lang>.js` for whatever
 * language is chosen (locale.js is the engines' asset, adopted — never edited here), and `tx()` / `txn()` read
 * `CBSTR[lang]` with the gettext key conventions. So this pack is a Proxy that answers EVERY key `tx` asks for, by
 * transforming the key itself — there is no list to keep, and a label added tomorrow is pseudo-localised the day it
 * goes through `tx()`. A static map here would have been a second catalogue that drifts (CLAUDE.md rule 2).
 *
 * ⚠️ WHAT IS LEFT ALONE inside a string, because a pseudo-locale must break nothing: `<tags>` (some callers pass
 * markup), `{placeholders}` (txf / txn substitute them AFTER translation), `&entities;`, and digits. The gettext
 * context prefix (`ctx\u0004msgid`) and plural suffix (`msgid\u0005category`) are stripped before transforming,
 * exactly as a real pack would key on them.
 */
/*
 * OWNS      the pseudo-locale pack (qps): every catalogue string back accented, longer and bracketed, for tests and labs
 * CALLED BY public/engine/locale.js:717 (CBLocale.pack('qps')); e2e/walk-locale.cjs
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/strings-and-translations
 */
(function () {
  if (typeof CBSTR === 'undefined') return;

  /* ASCII → an accented look-alike that still reads as the letter (so a tester can read the screen). */
  var MAP = {
    a: 'à',
    b: 'ƀ',
    c: 'ç',
    d: 'ď',
    e: 'é',
    f: 'ƒ',
    g: 'ĝ',
    h: 'ĥ',
    i: 'ï',
    j: 'ĵ',
    k: 'ķ',
    l: 'ļ',
    m: 'ɱ',
    n: 'ñ',
    o: 'ö',
    p: 'þ',
    q: 'ɋ',
    r: 'ŕ',
    s: 'š',
    t: 'ţ',
    u: 'û',
    v: 'ṽ',
    w: 'ŵ',
    x: 'ẋ',
    y: 'ý',
    z: 'ž',
    A: 'Å',
    B: 'Ɓ',
    C: 'Ç',
    D: 'Ď',
    E: 'É',
    F: 'Ƒ',
    G: 'Ĝ',
    H: 'Ĥ',
    I: 'Ï',
    J: 'Ĵ',
    K: 'Ķ',
    L: 'Ļ',
    M: 'Ṃ',
    N: 'Ñ',
    O: 'Ö',
    P: 'Þ',
    Q: 'Ꝗ',
    R: 'Ŕ',
    S: 'Ŝ',
    T: 'Ţ',
    U: 'Û',
    V: 'Ṽ',
    W: 'Ŵ',
    X: 'Ẍ',
    Y: 'Ý',
    Z: 'Ž'
  };
  /* the parts that must survive untouched: a tag, a placeholder, an entity */
  var KEEP = /(<[^>]*>|\{[^}]*\}|&[#A-Za-z0-9]+;)/g;

  function accent(text) {
    return text.replace(/[A-Za-z]/g, function (ch) {
      return MAP[ch] || ch;
    });
  }

  /** The pseudo form of one English string. A test asserts it the way a screen reaches it: `tx('Sales')` with cb_lang = qps. */
  function pseudo(english) {
    var text = String(english == null ? '' : english);
    if (!text) return text;
    var ctx = text.indexOf('\u0004');
    if (ctx >= 0) text = text.slice(ctx + 1); /* gettext context: ctx\u0004msgid */
    var pl = text.indexOf('\u0005');
    if (pl >= 0) text = text.slice(0, pl); /* gettext plural:  msgid\u0005category */
    if (!/[A-Za-z]/.test(text)) return text; /* glyphs, digits — nothing to mark */
    var out = text
      .split(KEEP)
      .map(function (part, index) {
        return index % 2 ? part : accent(part);
      })
      .join('');
    /* ~40 % longer: the brackets and spaces give four, the '!' runs give the rest — at least two a side, as the standard example "[!! Ŝàļéš !!]" */
    var bang = Array(Math.max(2, Math.ceil(text.length * 0.2)) + 1).join('!');
    return '[' + bang + ' ' + out + ' ' + bang + ']';
  }

  CBSTR.qps = new Proxy(
    {},
    {
      get: function (target, key) {
        return typeof key === 'string' ? pseudo(key) : undefined;
      },
      has: function () {
        return true;
      }
    }
  );
  try {
    if (typeof renderApp === 'function') renderApp();
  } catch (_) {}
})();
