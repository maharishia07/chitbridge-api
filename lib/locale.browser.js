/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
/**
 * locale.js — THE LOCALISATION LAYER. One roof for every decision that changes across a border.
 *
 * Athi, 2026-08-18: *"this system has to be truly language independent… we have a layer called localisation for
 * that purpose. Bring all those under that layer… bring all under one roof, so we can make it truly universal."*
 *
 * ── WHY A LAYER AND NOT A HELPER ────────────────────────────────────────────────────────────────────────────
 * Localisation is not translation. Translation is one of EIGHT things that change when a reader changes, and
 * before this file each of them was decided somewhere different — or not decided at all:
 *
 *   language      the words                    was: cbLang() in localStorage
 *   direction     which way the page runs      was: nowhere; RTL was impossible until the 378-property sweep
 *   numerals      1234 vs ١٢٣٤                  was: nowhere; every locale silently got Western digits
 *   numbers       grouping and decimal mark    was: taken from the CURRENCY (see below)
 *   money         symbol, placement, grouping  was: CCY_LOCALE — currency mistaken for locale
 *   dates         order, month names, calendar was: pinned 'en-IN' in three separate functions
 *   times         12h/24h, am/pm wording       was: pinned 'en-IN' in fmtAt
 *   sort          how a list orders            was: default JS sort — wrong in every non-English script
 *
 * ⚠⚠⚠ READ THE NEXT PARAGRAPH WITH ITS CORRECTION, 2026-09-11. What follows was the reasoning for removing
 * `CCY_LOCALE`, and it was HALF right: currency is genuinely not locale, and pinning DATES and TIMES to en-IN
 * for every reader was wrong. But the same sweep took the grouping of the AMOUNT with it, and that part has
 * been reversed — see the note above `money()`. Athi: *"currency has to follow currency standard; Indian
 * standard is for Indian rupees only."* An amount of money is CONTENT and travels; the interface around it is
 * presentation and belongs to the reader.
 *
 * ⚠️⚠️ THE BUG THIS FILE EXISTS TO FIX: CURRENCY IS NOT LOCALE. `CCY_LOCALE` mapped INR→en-IN, USD→en-US, and
 * formatted money with the locale of the MONEY rather than of the READER. Measured:
 *     every viewer of a USD price saw   $123,456.50      (US grouping)
 *     every viewer of an INR price saw  ₹1,23,456.50     (Indian lakh grouping)
 * …whoever they were. A French reader got lakh grouping; an Indian reader got US grouping. The currency decides
 * the SYMBOL. The reader decides the FORMAT. They are independent, and conflating them is wrong for everyone
 * who is not the one person the mapping happened to suit.
 *
 * ⚠️ AND TIME WAS PINNED TO en-IN FOR EVERYONE — `09:15 pm` to a reader in Tokyo (21:15) or Dubai (09:15 م).
 * That pin was deliberate, for a good reason: "so time is deterministic across browsers" in tests. Keeping the
 * test honest and the product wrong is the wrong trade; determinism belongs in the TEST, by setting a locale.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────────────────
 * ⭐ EVERY locale decision goes through here. If a screen calls `toLocaleString` directly it has made a private
 * localisation decision that nobody can see, change, or test — which is exactly the state this replaces.
 *
 * ⚠️ AND THE BOUNDARY THAT MATTERS MORE THAN ANY OF IT: this layer localises CHROME AND FORMAT. It never
 * touches user DATA. A product name, a chit subject, a dispute reason are the author's own words; a chit is a
 * SHARED record, and one that reads differently to each party is not a record. Formatting a number is
 * presentation. Rewriting what someone wrote is not.
 */
(function (root) {
  'use strict';

  /* RTL scripts. ⚠️ Kept as a LIST rather than guessed from the language: there is no rule that derives
     direction from a language tag, and a guess that is right four times out of five is a layout that breaks for
     the fifth without saying why. */
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1, ps: 1, sd: 1, ug: 1, yi: 1, dv: 1 };

  /**
   * ⭐⭐ PRESENTATION AND LANGUAGE ARE TWO CHOICES, AND ONE CONSTRAINS THE OTHER.
   *
   * Athi, 2026-08-18: *"under locale, we have to split presentation style and languages separately… if the
   * language and the style contradicts then it will be a problem, so we have to specify, for this style, these
   * are the languages compatible out of which you can choose say two or three max."*
   * *"example, india, left to right, english, tamil and hindi"* · *"uae, arabic, right to left, couple of
   * languages."*
   *
   * ⚠️ THE GAP THIS CLOSES. Language and format were deliberately independent — an Indian trader may want
   * English words with lakh grouping. But independent meant UNBOUNDED: nothing stopped Arabic words with Indian
   * formatting and a Buddhist calendar, a combination no reader on earth wants and no CLDR locale describes.
   * Freedom without a guardrail is not flexibility, it is a way to produce a screen nobody can read.
   *
   * ⚠️ REGION → LANGUAGES IS CURATED, AND IT HAS TO BE. ECMA-402 exposes direction (getTextInfo) and script
   * (maximize), but NOT CLDR's territoryInfo — the table of which languages are actually used in a territory.
   * That data exists in CLDR and is copied here rather than invented; when `Intl` exposes it, this table should
   * be deleted rather than maintained.
   *
   * ⚠️⚠️ AND ONE CORRECTION TO THE BRIEF, WHICH MEASUREMENT FORCED. A region cannot carry a single DIRECTION.
   * The UAE list has to include English, because UAE businesses trade in it — and English is left-to-right while
   * Arabic is right-to-left. Urdu, also used there, is right-to-left again. So direction is a property of the
   * LANGUAGE YOU ARE READING (strictly, of its script), not of the region:
   *     ar → ar-Arab-AE → rtl        ur → ur-Arab-PK → rtl        en → en-Latn-US → ltr
   * Modelling direction on the region would have made "UAE + English" render right-to-left, which is exactly the
   * contradiction this feature exists to prevent — arriving from the fix rather than the bug.
   */
  /**
   * ⭐ EACH REGION NAMES ITS CURRENCY — AS A SUGGESTION, NEVER AS A LIMIT. Athi, 2026-08-21: *"if the region
   * selected, the currency should be filtered for that region, but otherwise they should be able to set for any
   * currency — the entire table of currency can be showcased."*
   *
   * ⚠️ THE DISTINCTION DECIDES WHETHER THIS SHORT MAP IS HONEST. A list that SUGGESTS may be incomplete
   * without harming anyone: a business in a region we have not mapped gets no suggestion and picks from the full
   * table. A list that LIMITS must be complete, or it silently forbids real trade. The four-currency envelope
   * that prompted this was the second kind wearing the first kind's clothes.
   *
   * ⚠️ AN ARRAY, NOT A SCALAR, because a region can honestly have more than one — and because a scalar
   * would have to be defended the day someone adds the second.
   */
  var REGIONS = {
    IN: { name: 'India',                format: 'en-IN', cur: ['INR'], langs: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa'] },
    AE: { name: 'United Arab Emirates', format: 'ar-AE', cur: ['AED'], langs: ['ar', 'en', 'hi', 'ur', 'ml'] },
    SA: { name: 'Saudi Arabia',         format: 'ar-SA', cur: ['SAR'], langs: ['ar', 'en', 'ur'] },
    GB: { name: 'United Kingdom',       format: 'en-GB', cur: ['GBP'], langs: ['en'] },
    US: { name: 'United States',        format: 'en-US', cur: ['USD'], langs: ['en', 'es'] },
    DE: { name: 'Germany',              format: 'de-DE', cur: ['EUR'], langs: ['de', 'en', 'tr'] },
    FR: { name: 'France',               format: 'fr-FR', cur: ['EUR'], langs: ['fr', 'en', 'ar'] },
    SG: { name: 'Singapore',            format: 'en-SG', cur: ['SGD'], langs: ['en', 'zh', 'ms', 'ta'] },
    JP: { name: 'Japan',                format: 'ja-JP', cur: ['JPY'], langs: ['ja', 'en'] },
    LK: { name: 'Sri Lanka',            format: 'si-LK', cur: ['LKR'], langs: ['si', 'ta', 'en'] }
  };

  /** How many languages a reader may declare. More than three is a list nobody maintains and nothing matches. */
  var MAX_LANGS = 3;

  /**
   * ⚠⚠ A PREVIEW MUST NOT REACH THE SERVER. Settings now STAGES changes and shows what they would look like
   * before you press Save — which means the real setters run, on real storage, and are then rolled back. Every
   * one of them ends in L.push(), so without this counter a preview would sync a value nobody chose to the
   * account, to every other device, and then roll it back locally only. The rollback would be the one thing
   * that did not travel.
   *
   * ⚠️ A COUNTER, NOT A BOOLEAN — setRegion() calls setLangs(), so the quiet windows nest. A flag would be
   * cleared by the inner call and the outer one would push after all.
   */
  var quiet = 0;

  var LANG_NAMES = {
    en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', te: 'తెలుగు', bn: 'বাংলা', mr: 'मराठी', gu: 'ગુજરાતી',
    kn: 'ಕನ್ನಡ', ml: 'മലയാളം', pa: 'ਪੰਜਾਬੀ', ar: 'العربية', ur: 'اردو', fr: 'Français', de: 'Deutsch',
    es: 'Español', tr: 'Türkçe', zh: '中文', ms: 'Bahasa Melayu', ja: '日本語', si: 'සිංහල'
  };


  /* ⚠️ THE OLD DEFAULT, PRESERVED EXACTLY. Nothing about a reader who has chosen nothing may change today —
     this layer adds a capability, it does not silently re-format every existing user's screens. */
  var FALLBACK = 'en-IN';

  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (_) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  var L = {
    /** The UI language — which strings to show. */
    lang: function () { return get('cb_lang', 'en'); },

    /**
     * The FORMATTING locale — how numbers, money, dates and times are written.
     *
     * ⚠️ SEPARATE FROM THE LANGUAGE ON PURPOSE. An Indian trader may want the interface in English and money
     * grouped Indian-style; a Gulf buyer may want Arabic words with Western digits. Language is what you read;
     * locale is how figures are written. Tying them forces a choice nobody asked to make.
     */
    locale: function () {
      var explicit = get('cb_locale', '');
      if (explicit) return explicit;
      var lang = L.lang();
      return lang && lang !== 'en' ? lang : FALLBACK;
    },

    /**
     * ⭐⭐ THE STANDARD ALREADY HAS EVERY KNOB — WE ADOPT IT RATHER THAN INVENT A SETTINGS MODEL.
     *
     * Athi, 2026-08-18: *"let the number format 000,000,000.00 or 00,00,000.00, million or lakhs… similarly if
     * different format exists, currency format, same, and date format in different lines. What other parameters
     * to be brought here, do we have any international standard exists which we can adopt straight away here?"*
     *
     * Yes: **BCP 47** (RFC 5646) plus the **Unicode locale extension** (`-u-`, UTS #35 / CLDR). Every parameter
     * below is a documented subtag, and `Intl` already implements all of them — so a preference is not a bespoke
     * flag we then have to teach every formatter about, it is one more subtag on the tag we already pass.
     *
     *   nu  numbering system   latn 123 · arab ١٢٣ · deva १२३
     *   hc  hour cycle         h12 09:15 pm · h23 21:15
     *   ca  calendar           gregory · islamic-umalqura (Rabiʻ I 5, 1448 AH) · indian · buddhist
     *   fw  first day of week  mon … sun
     *   co  collation          how a list sorts
     *   cu  currency           the default one
     *
     * ⚠️ GROUPING IS NOT A SUBTAG, AND THAT IS THE RIGHT ANSWER. "000,000,000.00 vs 00,00,000.00" — millions vs
     * lakhs — is a property of the LOCALE, not a separate switch: `en-US` gives 123,456,789.5 and `en-IN` gives
     * 12,34,56,789.5 because CLDR knows India groups in lakhs. Offering it as its own control would let someone
     * pick a combination no locale on earth uses, and then read a number that means nothing to anybody.
     * ⭐ So the format picker IS the grouping picker. One choice, no contradictions possible.
     */
    tag: function () {
      var base = L.locale(), u = [];
      var nu = get('cb_nu', ''), hc = get('cb_hc', ''), ca = get('cb_ca', ''), fw = get('cb_fw', '');
      if (nu) u.push('nu-' + nu);
      if (hc) u.push('hc-' + hc);
      if (ca) u.push('ca-' + ca);
      if (fw) u.push('fw-' + fw);
      /**
       * ⚠️ TWO DIFFERENT FAILURES, AND ONLY ONE OF THEM THROWS — measured, because I first wrote this comment
       * claiming the check caught both.
       *   · malformed SYNTAX (`-u-nu-`)      → Intl throws, and this try/catch drops back to the bare locale
       *   · an unknown VALUE (`-u-nu-wibble`) → Intl does NOT throw; it ignores the subtag and uses the default
       * Both end safe, but for different reasons, and it is worth saying so: the try/catch is not what makes the
       * second case safe — Intl's own tolerance is.
       */
      if (!u.length) return base;
      var t = base + '-u-' + u.join('-');
      try { new Intl.NumberFormat(t); return t; } catch (_) { return base; }
    },
    setExt: function (k, v) { set('cb_' + k, v || ''); L.apply(); L.push(); },

    /* ══ REGION · the presentation style ══════════════════════════════════════════════════════════════════ */

    REGIONS: REGIONS,
    MAX_LANGS: MAX_LANGS,
    langName: function (code) { return LANG_NAMES[code] || code; },

    region: function () { return get('cb_region', ''); },
    regionInfo: function () { return REGIONS[L.region()] || null; },

    /**
     * Choosing a region sets the FORMAT and prunes any declared language the region does not admit.
     *
     * ⚠️ IT PRUNES RATHER THAN REFUSING. Someone moving their business from India to the UAE should not be told
     * "your language list is invalid, fix it first" — they should be moved to the UAE's conventions with the
     * languages that still make sense kept, and the ones that no longer do quietly dropped. If nothing survives,
     * the region's own first language is the honest fallback rather than an empty list.
     */
    setRegion: function (code) {
      var r = REGIONS[code];
      set('cb_region', r ? code : '');
      if (r) {
        set('cb_locale', r.format);
        var kept = L.langs().filter(function (x) { return r.langs.indexOf(x) >= 0; });
        L.setLangs(kept.length ? kept : [r.langs[0]]);
      }
      L.apply();
      L.push();
    },

    /* ══ LANGUAGES · an ORDERED priority list, which is RFC 4647's model ═══════════════════════════════════ */

    /**
     * ⚠️ A LIST, NOT A SETTING, and the order carries meaning. RFC 4647 calls this a *language priority list*:
     * "I read Tamil, then English, then Hindi." That is precisely what is needed to decide which of several
     * authored versions of a catalogue to show someone — and it is a standard, so it needs no invention here.
     */
    langs: function () {
      var raw = get('cb_langs', '');
      var out = raw ? raw.split(',').filter(Boolean) : [];
      if (!out.length) { var one = get('cb_lang', ''); if (one) out = [one]; }
      return out.length ? out.slice(0, MAX_LANGS) : ['en'];
    },

    /**
     * ⚠️ cb_lang IS KEPT IN STEP, deliberately. Every existing screen reads it through lang(), and a migration
     * that required all of them to learn about lists on the same day would be a rewrite, not a feature.
     */
    setLangs: function (arr) {
      var list = (arr || []).filter(Boolean).slice(0, MAX_LANGS);
      if (!list.length) list = ['en'];
      set('cb_langs', list.join(','));
      set('cb_lang', list[0]);
      L.apply();
      L.push();
    },

    /** Languages this reader may choose — the region's set, or everything we name if no region is set. */
    allowedLangs: function () {
      var r = L.regionInfo();
      return r ? r.langs.slice() : Object.keys(LANG_NAMES);
    },

    /**
     * ⭐⭐ MATCH — the function that makes "no direct conversion at all" enforceable rather than a promise.
     *
     * Athi: *"the panel and content in the panel, catalogue should stay in the language the origin is, no direct
     * conversion at all."*
     *
     * Given the languages a piece of content ACTUALLY EXISTS IN, this returns which one to show — the reader's
     * highest-priority language that the author actually wrote. It never returns a language the author did not
     * write, and it returns null rather than guessing when none of them match.
     *
     * ⚠️ NULL MEANS "SHOW IT AS AUTHORED", NOT "TRANSLATE IT". A chit is a SHARED record; one that read
     * differently to each party would not be a record. Matching picks between versions a human wrote. Anything
     * that produced text no human wrote would be a different feature with a different risk, and this is the
     * seam where that line is drawn.
     *
     * RFC 4647 Lookup: try the full tag, then progressively truncate ("pt-BR" matches content in "pt").
     */
    match: function (available) {
      var have = (available || []).filter(Boolean);
      if (!have.length) return null;
      var want = L.langs();
      for (var i = 0; i < want.length; i++) {
        var tag = String(want[i]);
        while (tag) {
          for (var j = 0; j < have.length; j++) {
            if (String(have[j]).toLowerCase() === tag.toLowerCase()) return have[j];
            if (String(have[j]).toLowerCase().split('-')[0] === tag.toLowerCase()) return have[j];
          }
          var cut = tag.lastIndexOf('-');
          tag = cut > 0 ? tag.slice(0, cut) : '';
        }
      }
      return null;
    },

    getExt: function (k) { return get('cb_' + k, ''); },

    /* ══ THE CHOICE BELONGS TO THE PERSON, NOT THE BROWSER (b165) ═════════════════════════════════════════════
     *
     * ⚠️ Everything above stores to localStorage, which is keyed by BROWSER PROFILE. On its own that means the
     * same person sees two different products on their phone and their laptop, and clearing site data reverts an
     * Arabic reader to English left-to-right — the product becoming unreadable on a device they have not yet
     * visited. So the same six values also live on the identity row, and these two functions keep them in step.
     *
     * ⚠️ LOCAL STAYS THE FAST PATH, DELIBERATELY. The cache is read synchronously at boot, before any network
     * call, so the first paint is already in the reader's language — there is no flash of English. The server
     * value arrives later and only matters when it DIFFERS, which is exactly the new-device case.
     */
    KEYS: ['lang', 'langs', 'region', 'locale', 'nu', 'hc', 'ca', 'fw', 'tz', 'workdays'],

    /**
     * ⭐⭐ EVERY KEY, EMPTIES INCLUDED — the pair that makes UNDO possible. Athi, 2026-08-21: *"in settings we
     * do not have a save button, we just change it — what if by mistake someone changed without knowing?"*
     *
     * ⚠⚠ RESTORING ONE KEY WOULD NOT UNDO ONE CHANGE, and that is why this is not just prefs(). setRegion()
     * PRUNES the language list as a side effect — choose Germany and Tamil silently leaves, because Germany does
     * not admit it. Putting the region back does not bring Tamil back. An undo that restores only the control
     * the reader touched would quietly keep the collateral damage, which is worse than no undo: it claims the
     * change was reversed.
     *
     * ⚠️ AND EMPTIES ARE VALUES HERE, unlike in prefs(). '' means "follow the region" — a real state a reader
     * can return to. Skipping empty keys on restore would leave an override standing that the snapshot says was
     * never set, so undo would half-work in exactly the case it is needed.
     */
    /** Run fn with server sync suppressed. Local storage still moves; nothing is told about it. */
    quietly: function (fn) {
      quiet++;
      try { return fn(); } finally { quiet--; }   /* ⚠️ finally — a throw inside a preview must not leave the
                                                     whole app permanently unable to save a preference. */
    },

    snapshot: function () {
      var out = {};
      L.KEYS.forEach(function (k) { out[k] = get('cb_' + k, ''); });
      return out;
    },

    restore: function (snap) {
      if (!snap || typeof snap !== 'object') return false;
      var changed = false;
      L.KEYS.forEach(function (k) {
        /* ⚠️ hasOwnProperty — a snapshot is a plain object and `k in snap` would find 'constructor' on the
           prototype and write it as a value. */
        var now = Object.prototype.hasOwnProperty.call(snap, k) ? String(snap[k] || '') : '';
        if (get('cb_' + k, '') !== now) { set('cb_' + k, now); changed = true; }
      });
      if (changed) { L.apply(); L.push(); }
      return changed;
    },

    /** Read the local answer as the object the API stores. Absent values stay absent — '' means "use default". */
    prefs: function () {
      var out = {};
      L.KEYS.forEach(function (k) { var v = get('cb_' + k, ''); if (v) out[k] = v; });
      return out;
    },

    /**
     * Seed from the server. Returns true if anything actually changed, so the caller can re-render ONLY then —
     * an unconditional re-render on every boot would undo work in progress for no reason.
     *
     * ⚠️ THE SERVER WINS, AND THAT IS THE WHOLE FEATURE. This is the moment a new device learns who is reading.
     * Preferring the local cache here would mean a fresh browser keeps its blank default and the person's real
     * choice never arrives — which is the defect, not the fix.
     *
     * ⚠️ EXCEPT WHEN THE SERVER HAS NOTHING. An empty object is "never chosen", not "chose the default", so a
     * reader who set their language before b165 ran keeps it instead of having it wiped by an empty row.
     */
    hydrate: function (prefs, ctx) {
      prefs = (prefs && typeof prefs === 'object') ? prefs : {};
      var incoming = 0;
      L.KEYS.forEach(function (k) { if (prefs[k]) incoming++; });
      var changed = false;
      if (!incoming) {
        /* ⚠️ THE ENTITY WITH NO CHOICE YET IS NOT "WHATEVER THIS BROWSER LAST HELD" (Athi, 2026-09-05: Arabic and Urdu
           offered on every shop he signed into on one laptop — a region set for a test lived on in localStorage and
           hydrate() returned early, leaving it standing). An entity that has chosen nothing gets its own COUNTRY's
           region and the languages that region admits; the previous entity's leftovers are cleared. Quietly: a
           default is not a choice, so nothing is written back to the identity. "It has to be our application
           dependent, not browser dependent." */
        var country = ctx && ctx.country ? String(ctx.country).toUpperCase() : '';
        var target = REGIONS[country] ? country : '';
        var snapBefore = L.snapshot();
        L.quietly(function () {
          L.KEYS.forEach(function (k) { set('cb_' + k, ''); });
          if (target) L.setRegion(target);
        });
        var snapAfter = L.snapshot();
        L.KEYS.forEach(function (k) { if (snapBefore[k] !== snapAfter[k]) changed = true; });
        if (changed) L.apply();
        return changed;
      }
      /* the entity HAS chosen: every key follows it — a key it never set is cleared here too, so one entity's
         choice cannot leak into the next one opened on the same browser */
      L.KEYS.forEach(function (k) {
        var was = get('cb_' + k, ''), now = String(prefs[k] || '');
        if (was !== now) { set('cb_' + k, now); changed = true; }
      });
      if (changed) L.apply();
      return changed;
    },

    /**
     * ⚠️ DELEGATES TO CBPrefs — the debounce, the offline queueing and the pre-migration silence are identical
     * for every preference set, and were written here first. Keeping a second copy in this file is how the two
     * drift apart the day one of them gains a retry.
     */
    push: function () {
      if (quiet) return;                       /* previewing — see `quiet` above */
      try { if (root.CBPrefs) root.CBPrefs.push('locale', L.prefs()); } catch (_) {}
    },

    /**
     * ⚠️⚠️ THE WEEKEND IS NOT SATURDAY AND SUNDAY, and for a TRADE platform that is load-bearing rather than
     * trivia. CLDR: `ar-SA` weekend is [5,6] — Friday and Saturday. `en-IN` is [7] — Sunday ALONE. So "due in
     * three working days" lands on a different date in Dubai, Mumbai and Berlin, and any SLA, due date or
     * ageing calculation that assumes Sat/Sun is quietly wrong for most of the market this product is aimed at.
     * Exposed here so the answer comes from CLDR rather than from whoever writes the next date helper.
     */
    /**
     * ⚠️ TWO SHAPES, AND THE ONE I WROTE FIRST WORKED ONLY IN NODE. The proposal moved from a GETTER
     * (`locale.weekInfo`) to a METHOD (`locale.getWeekInfo()`) — Node still exposes the property, Chromium
     * exposes only the method. My spec passed against Node and failed in the browser, which is the right way
     * round to find it, and the reason the assertion ran in a real browser rather than a harness.
     * ⚠️ Returns null where neither exists rather than guessing Sat/Sun — a wrong weekend is worse than no
     * weekend, because a caller can test for null and cannot test for "confidently wrong".
     */
    /* ══ TIME ZONE ════════════════════════════════════════════════════════════════════════════════════════
     *
     * ⚠️ THE LAYER DID NOT OWN THIS AND EVERY DATE ON EVERY SCREEN DEPENDED ON IT. Dates were rendered in
     * whatever zone the BROWSER is in, so a chit stamped 19:00 in Dubai reads 20:30 to the Mumbai office and
     * 16:00 in London — three different answers to "when did this happen" for one immutable event. On a trade
     * platform where a cut-off time decides whether a shipment made today's sailing, that is not cosmetic.
     *
     * ⚠️ THE DEFAULT IS THE DEVICE, AND STAYS THAT WAY. Someone travelling should see local time without being
     * asked; the override exists for the opposite case — a person who wants their BUSINESS's zone wherever they
     * happen to be, which is the common one for an owner reading a shop's records from abroad.
     */
    timezone: function () {
      var t = get('cb_tz', '');
      if (t) return t;
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
    },
    setTimezone: function (v) { set('cb_tz', v || ''); L.apply(); L.push(); },
    /** Every zone this engine knows — offered rather than a hand-kept list that goes stale twice a year. */
    zones: function () {
      try { if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone'); } catch (_) {}
      return [];
    },

    /* ══ WORKING DAYS ═════════════════════════════════════════════════════════════════════════════════════
     *
     * ⚠️⚠️ LOAD-BEARING, NOT A PREFERENCE. "Due in three working days" lands on a different date in Dubai,
     * Mumbai and Berlin, and the app had no idea. ⚠️ AND I HAD IT WRONG IN PROSE, which is the argument for
     * asking CLDR rather than reasoning about it: the UAE moved to a Saturday–Sunday weekend in 2022, so
     * Friday+Saturday is SAUDI ARABIA. CLDR knew; three of my own comments did not. India's weekend is
     * Sunday alone, Germany's is Saturday+Sunday. Any SLA, due date or ageing calculation that assumed Sat/Sun
     * was quietly wrong for most of the market this product is aimed at.
     *
     * ⚠️ AND THE REGION IS ONLY THE DEFAULT. A shop that opens on Sunday is not an error to be corrected — it is
     * a fact about that business, and it is why this is an OVERRIDE over CLDR rather than a lookup. Clearing the
     * override returns to the region's answer rather than to a hardcoded guess.
     *
     * Days are ISO-8601 numbers: 1 = Monday … 7 = Sunday, matching what weekInfo returns.
     */
    workdays: function () {
      var raw = get('cb_workdays', '');
      if (raw) {
        var parsed = raw.split(',').map(Number).filter(function (n) { return n >= 1 && n <= 7; });
        /* ⚠️ A GARBAGE OVERRIDE MUST NOT MEAN "NO WORKING DAYS". Filtering an unparseable value left an EMPTY
           list, and an empty list is not "unset" — it is a week in which nothing is a working day, so every
           due-date calculation built on this would run forever looking for the next one. Falling through to
           CLDR is the only safe reading of a value we cannot understand. */
        if (parsed.length) return parsed;
      }
      var wi = L.weekInfo() || {};
      var off = wi.weekend || [6, 7];
      var out = [];
      for (var d = 1; d <= 7; d++) if (off.indexOf(d) < 0) out.push(d);
      return out;
    },
    /** Passing an empty list CLEARS the override — back to whatever CLDR says for this region. */
    setWorkdays: function (arr) {
      var list = (arr || []).map(Number).filter(function (n) { return n >= 1 && n <= 7; }).sort();
      set('cb_workdays', list.length ? list.join(',') : '');
      L.apply(); L.push();
    },
    hasWorkdayOverride: function () { return !!get('cb_workdays', ''); },
    /** ⚠️ getDay() is 0=Sunday; ISO is 7=Sunday. Getting that wrong moves every due date by a day. */
    isWorkday: function (d) {
      var dt = (d instanceof Date) ? d : new Date(d);
      var iso = dt.getDay() === 0 ? 7 : dt.getDay();
      return L.workdays().indexOf(iso) >= 0;
    },

    weekInfo: function () {
      try {
        var l = new Intl.Locale(L.locale());
        if (typeof l.getWeekInfo === 'function') return l.getWeekInfo() || null;
        return l.weekInfo || null;
      } catch (_) { return null; }
    },
    isWeekend: function (d) {
      var w = L.weekInfo(); if (!w || !w.weekend) return false;
      var iso = ((new Date(d).getDay() + 6) % 7) + 1;    /* JS Sun=0 → ISO Mon=1…Sun=7 */
      return w.weekend.indexOf(iso) >= 0;
    },

    /** 'rtl' or 'ltr' — derived from the language, never from the locale. */
    /**
     * ⚠️ DIRECTION COMES FROM THE SCRIPT, AND Intl KNOWS THE SCRIPT. `new Intl.Locale('ur').maximize()` gives
     * ur-Arab-PK, and getTextInfo() on that says rtl — measured, not assumed. The hand-kept RTL list below is
     * now only a fallback for engines without getTextInfo, and a list is exactly the thing that goes stale: it
     * had nine entries and there are more right-to-left languages than that.
     *
     * ⚠️ AND IT IS A PROPERTY OF THE LANGUAGE, NOT THE REGION — which is why a UAE reader gets right-to-left in
     * Arabic and left-to-right the moment they switch to English, without changing region.
     */
    dir: function () {
      var lang = String(L.lang() || 'en');
      try {
        var m = new Intl.Locale(lang).maximize();
        var ti = (typeof m.getTextInfo === 'function') ? m.getTextInfo() : m.textInfo;
        if (ti && ti.direction) return ti.direction;
      } catch (_) {}
      return RTL[lang.slice(0, 2)] ? 'rtl' : 'ltr';
    },

    setLang: function (v) { set('cb_lang', v); L.apply(); L.push(); },
    setLocale: function (v) { set('cb_locale', v); L.apply(); L.push(); },

    /**
     * ⚠️⚠️ NONE OF THE THREE LOADED FACES CAN DRAW A SINGLE ARABIC LETTER. Space Grotesk, Inter and Space Mono
     * are Latin. Choosing Arabic today stamps dir=rtl correctly, lays the page out correctly — and then renders
     * the words in whatever the operating system happens to have, or in tofu boxes where it has nothing.
     *
     * ⭐ SO THE FACE IS FETCHED WHEN THE SCRIPT IS ACTUALLY CHOSEN, NEVER BEFORE. Athi's standing rule is never
     * pre-load, and it is right twice here: an Arabic face is ~90KB that every English reader would otherwise
     * pay for forever, to render nothing.
     *
     * ⚠️ AND IT IS APPENDED, NOT SUBSTITUTED. The stack stays Latin-first, so Latin text keeps the product's own
     * typography and only the characters no Latin face can draw fall through to Noto. A reader who writes their
     * business name in Arabic and their User ID in Latin sees both set correctly, in the same line.
     *
     * Noto Sans Arabic because it is the widest-covering libre Arabic face and the one Google Fonts serves under
     * the same CSP origin already allowed for the Latin three — no new host, no new permission.
     */
    font: function (dir) {
      if (dir !== 'rtl') return;
      try {
        if (document.getElementById('cb-rtl-font')) return;    // once per session, not once per render
        var l = document.createElement('link');
        l.id = 'cb-rtl-font';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap';
        document.head.appendChild(l);
        var st = document.createElement('style');
        st.id = 'cb-rtl-font-css';
        /* Appended to the END of each stack: Latin keeps its face, Arabic falls through to one that has it. */
        st.textContent = ':root[dir="rtl"] body,:root[dir="rtl"] .inp,:root[dir="rtl"] button,' +
          ':root[dir="rtl"] input,:root[dir="rtl"] textarea,:root[dir="rtl"] select' +
          '{font-family:Inter,"Noto Sans Arabic",system-ui,sans-serif}' +
          ':root[dir="rtl"] .disp{font-family:"Space Grotesk","Noto Sans Arabic",system-ui,sans-serif}' +
          /* .mono stays Latin-only ON PURPOSE — it holds identifiers, which are never Arabic script. */
          '';
        document.head.appendChild(st);
      } catch (_) {}
    },

    /**
     * ⭐⭐ A LANGUAGE PACK IS FETCHED WHEN ITS LANGUAGE IS CHOSEN, AND NEVER BEFORE.
     *
     * 643 labels in one language is roughly 25KB. Carried inline in app.html for every language, that is a file
     * every English reader downloads in full to use none of it — the exact thing Athi's standing rule forbids.
     * So each language is its own file, `app/strings-<lang>.js`, and it arrives the same way the Arabic font
     * does: on the switch.
     *
     * ⚠️ THE PACK RE-RENDERS ITSELF IN. It loads asynchronously, so by the time it arrives the screen has
     * already been drawn in English. Each pack calls renderApp() on the way out rather than relying on the
     * caller to guess when it landed.
     *
     * ⚠️ AND A MISSING PACK IS NOT AN ERROR. onerror leaves CBSTR[lang] empty and every label falls back to
     * English, which is the honest outcome for a language nobody has translated yet.
     */
    pack: function (lang) {
      if (!lang || lang === 'en') return;
      try {
        var id = 'cb-strings-' + lang;
        if (document.getElementById(id)) return;             // once per session, not once per render
        var s = document.createElement('script');
        s.id = id;
        s.src = 'app/strings-' + lang + '.js';
        s.async = true;
        s.onerror = function () { try { s.remove(); } catch (_) {} };
        document.head.appendChild(s);
      } catch (_) {}
    },

    /** Stamp the document so CSS and screen readers both know. The 378 logical properties do the rest. */
    apply: function () {
      try {
        var d = document.documentElement;
        var dir = L.dir();
        var lang = L.lang();
        d.setAttribute('lang', lang);
        d.setAttribute('dir', dir);
        L.font(dir);
        L.pack(lang);
      } catch (_) {}
    },

    /* ── formatters ─────────────────────────────────────────────────────────────────────────────────────── */

    /**
     * ⚠️ CURRENCY FROM THE MONEY, LOCALE FROM THE READER. The whole point of the file.
     * The symbol form is chosen below, and it is not the obvious one — see symbol().
     */
    /**
     * The currency SYMBOL alone, in the reader's locale — extracted from Intl rather than kept in a table.
     *
     * ⚠️ THIS EXISTED OUTSIDE THE LAYER, formatting with `undefined` as its locale, which means "whatever this
     * browser's OS is set to" — not "what this reader chose". A Tamil reader on a US-configured laptop got the
     * US answer for a symbol the layer was supposed to own. Falling back to the CODE is correct, not a failure:
     * AED genuinely displays as "AED" in most locales.
     */
    /**
     * ⚠⚠ 'symbol', NOT 'narrowSymbol' — AND THE DIFFERENCE IS A CORRECTNESS BUG, NOT A STYLE PREFERENCE.
     * narrowSymbol renders USD, SGD, AUD and CAD ALL as '$', and CNY and JPY both as '¥' — measured, in every
     * locale tried (en-IN, en-SG, en-US, ja-JP, de-DE). So an SGD 500 quote and a USD 500 quote printed
     * IDENTICALLY.
     *
     * ⚠️ ON THIS PLATFORM THAT IS THE WORST POSSIBLE AMBIGUITY, because the money rule is that amounts are
     * never converted: 'you always see the currency the price was written in'. Two currencies sharing one glyph
     * breaks that promise more quietly than converting would — a converted number at least looks different.
     *
     * ⭐ 'symbol' is CLDR's disambiguating form and it is locale-aware in exactly the right way: in en-SG the
     * local dollar stays '$' and the foreign one becomes 'US$'; in en-IN the same pair is '$' and 'SGD'. It only
     * spends characters where there is something to confuse.
     *
     * ⚠️ IT SURFACED BECAUSE THE CURRENCY LIST WIDENED FROM FOUR TO 162. INR/USD/MXN/EUR never collide — the
     * demo envelope was hiding this. Every list that grows tests something that was never true, only untested.
     */
    symbol: function (code) {
      var c = code || 'INR';
      try {
        var pt = new Intl.NumberFormat(L.tag(), { style: 'currency', currency: c, currencyDisplay: 'symbol' })
          .formatToParts(0).find(function (x) { return x.type === 'currency'; });
        return (pt && pt.value) || c;
      } catch (_) { return c; }
    },

    /**
     * ⭐⭐ THE WHOLE ISO 4217 TABLE, FROM THE ENGINE. Athi, 2026-08-21: *"we are showcasing only a few
     * currencies — does it mean it cannot work for any other currency? Singapore dollar, yuan and other things
     * are not here. It should work for any currency, correct?"* Correct, and it did not.
     *
     * ⚠⚠ WHY IT DID NOT IS THE INTERESTING PART, AND IT WAS NEVER A DESIGN LIMIT. b74_platform_governance.sql
     * seeded the base constitution with {"currencies":["INR","USD","MXN","EUR"]} — four codes typed into a
     * bootstrap row to make a demo work. The profile picker read that envelope, so four is what every business
     * on the platform could ever price in. A demo fixture had quietly become policy.
     *
     * ⭐ SO THE LIST COMES FROM Intl, NOT FROM US. 162 codes the browser already maintains against CLDR — no
     * table to update when a currency is added, redenominated or withdrawn, and no second place to forget.
     * The old fallback is not a shorter list: on an engine without supportedValuesOf we cannot enumerate, so we
     * return what is in play and let the person type. Guessing a subset is how we got here.
     */
    currencies: function () {
      try {
        if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('currency');
      } catch (_) { /* older engine — fall through */ }
      return null;
    },

    /**
     * The currency a region trades in — a SUGGESTION for the picker to float to the top, never a filter that
     * removes the rest. Unknown region → no suggestion, which is the honest answer, not an empty list.
     */
    regionCurrencies: function (code) {
      var r = REGIONS[String(code || L.region() || '').toUpperCase()];
      return (r && r.cur) ? r.cur.slice() : [];
    },

    /** ⭐ 'Singapore Dollar', in the reader's language. A code is what a system needs; a name is what a person
     *  recognises, and a picker of 162 codes without names is a lookup table, not a choice. */
    currencyName: function (code) {
      try { return new Intl.DisplayNames([L.tag()], { type: 'currency' }).of(String(code).toUpperCase()) || code; }
      catch (_) { return code; }
    },

    /**
     * ⚠️⚠️ AN ARABIC-REGION FORMAT CARRIES AN INVISIBLE DIRECTION MARK, AND IT REORDERED A PRICE. Athi, 2026-09-03,
     * photographed "10 / ₹ 620.00KG / bag" for a ₹620 product sold per "10KG / bag". The template was plain —
     * `price / unit` — but `Intl.NumberFormat('ar-AE', INR)` returns "‏620.00 ₹": a RIGHT-TO-LEFT MARK in
     * front of the amount, put there so the number sits correctly inside Arabic prose. Composed with " / 10KG",
     * a unit that STARTS WITH DIGITS, the bidi algorithm did exactly what the mark asked and swapped the numbers
     * around the slashes. The same string alone on the list row was harmless, which is why it hid for so long.
     *
     * ⭐ Direction follows the LANGUAGE (see dir()), and the page is LTR whenever the language is. On an LTR page
     * the marks serve nothing and can only mislead the bidi algorithm, so they are dropped here — once, for every
     * caller. On an RTL page they stay: there they are what keeps a price readable. Callers that compose money
     * with other text should still isolate it in <bdi> for the RTL case; this fixes the LTR one at the source.
     */
    /**
     * ⚠️⚠️ READING A STAMPED PRICE IS *NOT* THIS FILE'S JOB, and for an hour on 2026-09-11 it was — I added an
     * amount() here before finding that lib/money.js has been the one definition since 2026-07-31 and was simply
     * never vendored to the browser. That would have made SIX copies of the rule while claiming to remove five.
     *
     * ⭐ THE SPLIT IS THE POINT: money.js says what an amount IS (the shape, the currency that travels with it,
     * what may be summed); locale.js says how it READS to a person (symbol, grouping, decimals, bidi). One is the
     * value, the other is the presentation, and keeping them apart is why neither has to know the other's rules.
     *
     * Use CBMoney.amountOf / amountOfLoose / currencyOf — /engine/money.js, the ninth vendored engine.
     */

    /**
     * ── ⚠️⚠️ WHAT ARBITRARY INPUT USED TO DO ────────────────────────────────────────────────────────────────
     *
     * Athi, 2026-09-11: *"have we checked for rouble, Russian, and any other currency which is arbitrary?"* The
     * real currencies were all correct — RUB, VND, OMR, MGA, XOF, every decimal right. What was not correct was
     * everything else that can reach this function:
     *
     *     money(1234.5, "INR'); DROP--")  →  "INR'); DROP-- 1,234.5"   the input, echoed into the page
     *     money(1234.5, { code: 'INR' })  →  "[object Object] 1,234.5"
     *     money({}, 'RUB')                →  "RUBNaN"                  a bill printing NaN
     *     money(NaN, 'RUB')               →  "RUB 0.00"                silently zero — and inconsistent with ↑
     *     money(1234.5, 'RUPEES')         →  "RUPEES 1,234.5"          one decimal, not two
     *
     * ⭐ A CURRENCY CODE IS THREE LETTERS (ISO 4217). Anything else is not a currency, and the honest answer is
     * the shop's default rather than the caller's typo printed on a customer's bill — a garbled code beside a
     * real number reads as a real price in a currency nobody can name.
     *
     * ⚠️ AND IT MUST NEVER ECHO ITS INPUT. Whatever reaches a screen through innerHTML is a hole if it came from
     * a field somebody can type in, and a price is rendered into innerHTML on every surface we have.
     */
    money: function (amount, code) {
      /**
       * ⚠️ THE STAMPED-PRICE RULE LIVES IN money.js, NOT HERE — this only needs a finite number to format. It
       * forwards when the module is present (it is, on every surface) and otherwise coerces, which is a
       * formatter's own business and not a second definition of what a price IS.
       */
      /**
       * ⚠️⚠️ amountOfLoose, NOT amountOf. The strict reader THROWS on a legacy bare number ('no currency and none
       * supplied to assume') — correct for the server, fatal for a renderer: a counter must never fail to show a
       * price because a value predates the money type. Loose returns NaN, which becomes 0 here.
       */
      var raw = (typeof CBMoney !== 'undefined' && CBMoney.amountOfLoose) ? CBMoney.amountOfLoose(amount) : Number(amount);
      var n = isFinite(raw) ? raw : 0;
      /* ISO 4217 is exactly three ASCII letters; Intl accepts any case and we normalise so 'inr' still works */
      var raw = (typeof code === 'string') ? code.trim().toUpperCase() : '';
      var c = /^[A-Z]{3}$/.test(raw) ? raw : 'INR';
      /**
       * ⭐⭐⭐ THE CURRENCY DECIDES HOW THE AMOUNT IS WRITTEN — NOT THE READER.
       *
       * Athi, 2026-09-11, twice and unambiguously: *"an Indian shop quoting $ cannot use the Indian standard, it
       * has to be the currency standard. Everyone understands currency standard globally, but not the Indian
       * standard — so if an Indian company writes a $ chit, it has to be currency standard only."* And then:
       * *"currency has to follow currency standard; Indian standard is for Indian rupees only."*
       *
       * ⚠⚠ THIS REVERSES WHAT THE HEADER OF THIS FILE SAYS, AND THE HEADER WAS WRONG ABOUT WHY. `CCY_LOCALE`
       * was removed because a French reader saw lakh grouping on a rupee price, and that was called the bug. It
       * is not. ₹12,34,567.50 IS how rupees are written, to anybody, anywhere — and $12,34,567.50 is how dollars
       * are written to nobody at all.
       *
       * ⭐⭐ THE DISTINCTION THE OLD FIX COLLAPSED IS ATHI'S: AN AMOUNT OF MONEY IS CONTENT, NOT PRESENTATION.
       * A chit travels to a counterparty we cannot see and whose locale we do not know. The reader's locale is
       * the right authority for the INTERFACE — labels, dates, sort order, which language a button is in. It is
       * the wrong authority for the FIGURE, because the figure is the thing being sent, and it has to be legible
       * to whoever opens it. The currency's own convention is the only shared standard there is.
       *
       * ⚠ SO THE READER STILL DECIDES EVERYTHING ELSE. This changes the grouping of a number and nothing about
       * the language, the date order, or the direction of the page.
       */
      var loc = L.moneyTag(c), s;
      try { s = new Intl.NumberFormat(loc, { style: 'currency', currency: c, currencyDisplay: 'symbol' }).format(n); }
      catch (e) {
        try { s = new Intl.NumberFormat(loc, { style: 'currency', currency: c }).format(n); }
        catch (_) {
          /* ⚠️ THE LAST RESORT STILL SHOWS TWO DECIMALS. It printed "1,234.5" before, which reads as a different
             price from "1,234.50" to anybody checking a bill against a till roll. */
          return c + ' ' + n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
      }
      return L.ltr(s);
    },

    /**
     * ⭐⭐ WHICH CONVENTION WRITES THIS CURRENCY — one small, checkable table rather than a guess per call.
     *
     * ⚠ IT CARRIES WHAT HAS BEEN VERIFIED AND WHAT HAS NOT, the same discipline lib/docnumber.js uses for
     * numbering rules. The Indian rupee is lakh-grouped and that is checked. Most of the world is three-three-
     * three and that is checked. The other South Asian currencies are CONVENTIONALLY lakh-grouped too — PKR,
     * BDT, LKR, NPR — but I have not verified it, so they are NOT in the table and get the international
     * grouping. ⚠ A guessed convention that puts lakhs on somebody's invoice is worse than the plain one.
     */
    MONEY_LOCALE: { INR: 'en-IN' },

    /**
     * The formatting tag for an AMOUNT. Defaults to the international convention, which is what every currency
     * except the listed ones uses.
     * ⚠ 'en-US' is chosen for its NUMBER shape (1,234,567.50), not because the money is American — Intl takes
     * the symbol and the decimals from the currency code regardless of the tag.
     */
    moneyTag: function (code) {
      var c = String(code || '').trim().toUpperCase();
      return (L.MONEY_LOCALE && L.MONEY_LOCALE[c]) || 'en-US';
    },

    /**
     * ⭐ ONE PLACE. The marks Intl inserts for Arabic-region formats (LRM · RLM · ALM) serve an RTL paragraph; on
     * an LTR page they only mislead the bidi algorithm — first seen on a price ("10 / ₹ 620.00KG / bag"), then on
     * a date ("022026/09/") the same afternoon. Every formatter passes through here, so the next one cannot recur.
     */
    ltr: function (s) {
      s = String(s == null ? '' : s);
      return L.dir() === 'rtl' ? s : s.replace(/[‎‏؜]/g, '');
    },

    number: function (n, opts) {
      try { return L.ltr(new Intl.NumberFormat(L.tag(), opts || undefined).format(Number(n || 0))); }
      catch (_) { return String(n); }
    },

    /**
     * ⚠️⚠️ EVERY DATE AND TIME NOW CARRIES THE CHOSEN ZONE, and until this they carried the BROWSER'S. A chit
     * stamped 19:00 in Dubai read 20:30 to the Mumbai office and 16:00 in London — three different answers to
     * "when did this happen" for one immutable event. On a platform where a cut-off decides whether a shipment
     * made today's sailing, that is not cosmetic; it is the record disagreeing with itself.
     *
     * ⚠️ zoned() MERGES rather than replaces, so a caller passing its own options still gets the zone. Threading
     * it only through the defaults would have left every call site that customises the format — which is most of
     * the interesting ones — silently rendering in the wrong zone.
     */
    zoned: function (opts) {
      var o = {}; for (var k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      /**
       * ⚠️⚠️ AN UNKNOWN ZONE MUST NOT BLANK EVERY DATE IN THE PRODUCT — and it did. Intl THROWS on an
       * unrecognised timeZone, each formatter catches and returns '', so one bad stored value (a renamed zone,
       * a synced preference from a newer browser, a hand-edited localStorage) made every timestamp on every
       * screen render as nothing. Silently, with no error and nothing to notice but absence.
       *
       * A date in the wrong zone is a small wrongness. NO date at all is a broken product, so the zone is
       * validated once here and dropped if the engine does not know it.
       */
      if (!o.timeZone) {
        var tz = L.timezone();
        try { new Intl.DateTimeFormat('en', { timeZone: tz }); o.timeZone = tz; }
        catch (_) { /* leave it unset — the browser's own zone is a far better answer than no date */ }
      }
      return o;
    },

    /** ⚠️ Every formatter below passes the chosen ZONE. Adding the setting without threading it through here
        would have produced a screen that says "Asia/Dubai" above dates still rendered in the browser's zone. */
    /**
     * ⚠️ AN UNPARSEABLE TIMESTAMP PRINTED "Invalid Date" ON THE SCREEN. `new Date('nonsense')` does not throw —
     * it returns an Invalid Date, and toLocaleString on that returns the literal string "Invalid Date", which
     * the catch below never saw because nothing was thrown. So a null or malformed `created_at` from any
     * endpoint rendered those two words to the reader, looking like a system error rather than a missing value.
     * An empty cell says "we do not have this"; "Invalid Date" says "we are broken".
     */
    _d: function (ts) {
      /* ⚠️ null AND '' BECOME 1 JANUARY 1970, NOT AN INVALID DATE. `new Date(null)` is epoch zero and
         `new Date('')` is invalid — so a missing timestamp rendered a real-looking date from 1970 on the
         screen, which is worse than "Invalid Date": it looks like data. An absent value must render as absent. */
      if (ts === null || ts === undefined || ts === '') return null;
      var d = new Date(ts);
      return isNaN(d.getTime()) ? null : d;
    },

    time: function (ts) {
      var d = L._d(ts); if (!d) return '';
      try { return L.ltr(d.toLocaleTimeString(L.tag(), L.zoned({ hour: '2-digit', minute: '2-digit' }))); }
      catch (_) { return ''; }
    },

    date: function (ts, opts) {
      var d = L._d(ts); if (!d) return '';
      try { return L.ltr(d.toLocaleDateString(L.tag(), L.zoned(opts || { day: '2-digit', month: 'short', year: 'numeric' }))); }
      catch (_) { return ''; }
    },

    /** Date AND time together — the shape `toLocaleString` gives, so call sites convert one-for-one. */
    datetime: function (ts, opts) {
      var d = L._d(ts); if (!d) return '';
      try {
        return L.ltr(d.toLocaleString(L.tag(),
          L.zoned(opts || { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })));
      } catch (_) { return ''; }
    },

    /**
     * ⚠️ SORTING IS LOCALISATION TOO, and it is the one everybody forgets. Plain `Array.sort()` compares UTF-16
     * code units: in Tamil, Arabic or German that is not alphabetical order, it is byte order wearing its
     * clothes. A supplier list that will not sort correctly is unusable long before it is untranslated.
     */
    compare: function (a, b) {
      try { return new Intl.Collator(L.tag(), { numeric: true, sensitivity: 'base' }).compare(String(a), String(b)); }
      catch (_) { return String(a).localeCompare(String(b)); }
    },
    sort: function (arr, keyFn) {
      var k = keyFn || function (x) { return x; };
      return (arr || []).slice().sort(function (x, y) { return L.compare(k(x), k(y)); });
    },

    /** Everything a screen might want to show about the current setting, for the picker. */
    describe: function () {
      var loc = L.locale();
      return { lang: L.lang(), locale: loc, dir: L.dir(),
        sampleMoney: L.money(123456.5, 'USD'), sampleDate: L.date(Date.now()), sampleTime: L.time(Date.now()) };
    },
  };

  root.CBLocale = L;
  try { L.apply(); } catch (_) {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
