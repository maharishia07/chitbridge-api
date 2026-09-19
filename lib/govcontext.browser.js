/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
/**
 * govcontext.js — WHAT THE APPLICATION CAN KNOW WITHOUT ASKING ([TILL-72] / registration)
 *
 * Athi, 2026-09-18: *"most of the parameter we have to pick and fill in ourselves, we may have to fill in most
 * of the governance layer by ourselves. Example, need to know the location, language, currency, country and
 * any other parameter that we can fill in ourselves. anything else to be captured like device information,
 * device type, ip and so on."*
 *
 * ── ⭐⭐⭐ THREE RULES, AND THEY ARE THE WHOLE DESIGN ────────────────────────────────────────────────────────
 *
 *  1. **DERIVE, NEVER PROMPT.** Not one line of this asks the browser for permission. No geolocation, no
 *     contacts, no clipboard — a shop signing up must never meet a permission dialog on its first screen. What
 *     is here is what the page already has: the language the browser declares, the timezone Intl resolves, the
 *     size of the screen it is drawn on.
 *
 *  2. **A GUESS IS LABELLED AS A GUESS, AND THE PERSON CONFIRMS IT.** Country decides tax, currency and the
 *     formats; getting it wrong silently is worse than not knowing. So every field carries WHERE it came from,
 *     the registration screen shows them, and nothing is written until somebody agrees. Unknown is a real
 *     answer and is returned as one. [[feedback-loose-until-stamped]]
 *
 *  3. **THE BROWSER DOES NOT GUESS THE IP.** It cannot see it, and anything it invented would be a fiction on
 *     an identity record. The SERVER reads it from the request it is already holding. This file returns no
 *     `ip` field at all, so nothing downstream can mistake a blank for a reading.
 *
 * ⚠️ THE COUNTRY→CURRENCY, →LOCALE AND →LANGUAGE MAPS ARE NOT HERE. CBLocale.REGIONS has carried them since the
 * localisation layer was built, and a second table would be a second answer to "what money does India use".
 * This file only works out WHICH region; the region says the rest. [[feedback-adopt-dont-reinvent]]
 */
(function (root) {
  'use strict';

  /**
   * ⚠️ ZONES IS A HINT, NOT A GAZETTEER. It maps only the timezones of the regions CBLocale actually supports,
   * plus the handful of aliases a real browser emits for them. It is deliberately NOT the full IANA list:
   *   · a country we cannot serve is not made more serveable by guessing it correctly;
   *   · every entry here is a claim somebody must maintain, and a wrong one silently mis-taxes a shop.
   * Anything not listed comes back as unknown, which the screen then asks about. [[feedback-country-first]]
   */
  var ZONES = {
    'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
    'Asia/Dubai': 'AE',
    'Asia/Riyadh': 'SA',
    'Europe/London': 'GB',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
    'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
    'Europe/Berlin': 'DE',
    'Europe/Paris': 'FR',
    'Asia/Singapore': 'SG',
    'Asia/Tokyo': 'JP',
    'Asia/Colombo': 'LK'
  };

  function regions() {
    try { return (root.CBLocale && root.CBLocale.REGIONS) || {}; } catch (_) { return {}; }
  }

  /** 'en-IN' → 'IN'. A language tag with no region subtag ('en', 'ta') says nothing about where. */
  function regionFromTag(tag) {
    var t = String(tag || '');
    var m = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})\b/.exec(t);
    return m ? m[1].toUpperCase() : '';
  }

  /** 'Asia/Kolkata' → 'IN', or '' when the zone is not one we serve. */
  function regionFromZone(tz) {
    return ZONES[String(tz || '')] || '';
  }

  /**
   * ⭐ THE LANGUAGE TAG WINS OVER THE TIMEZONE. A tag is what the reader CHOSE in their browser; a timezone is
   * where the machine happens to be sitting, which for a laptop is often wrong and for a VPN is always wrong.
   * ⚠️ AND A REGION WE CANNOT SERVE IS NOT AN ANSWER. If the tag says FI and CBLocale has no Finland, the
   * timezone gets its turn before we give up — otherwise a Finnish browser in Dubai reports nothing at all.
   */
  function countryOf(env) {
    var R = regions();
    var fromTag = regionFromTag(env && env.language);
    if (fromTag && R[fromTag]) return { value: fromTag, from: 'the language your browser reports' };
    var list = (env && env.languages) || [];
    for (var i = 0; i < list.length; i++) {
      var r = regionFromTag(list[i]);
      if (r && R[r]) return { value: r, from: 'the languages your browser reports' };
    }
    var fromZone = regionFromZone(env && env.timeZone);
    if (fromZone && R[fromZone]) return { value: fromZone, from: 'your time zone' };
    /* ⚠️ a real region we do not serve is worth SAYING, rather than reporting nothing and looking broken */
    if (fromTag || fromZone) return { value: '', from: '', unserved: fromTag || fromZone };
    return { value: '', from: '' };
  }

  /**
   * ⭐ WHAT KIND OF MACHINE THIS IS, from what the page can see: the pointer, the shortest side, and the UA's
   * own claim where it makes one (userAgentData.mobile is a statement, not a sniff).
   * ⚠️ IT IS A STARTING POINT FOR THE LAYOUT, NOT A FACT ABOUT THE SHOP. A counter is a ROLE somebody chooses,
   * not something a screen size proves — a tablet is a waiter's handheld in one shop and the till in another.
   */
  function deviceOf(env) {
    var w = (env && env.screenW) || 0, h = (env && env.screenH) || 0;
    var shortest = (w && h) ? Math.min(w, h) : 0;
    var coarse = !!(env && env.coarsePointer);
    var mobile = env && env.uaMobile;
    if (mobile === true || (coarse && shortest && shortest < 480)) return 'phone';
    if (coarse && shortest && shortest < 900) return 'tablet';
    if (coarse) return 'touch screen';
    return 'desktop';
  }

  /** everything the page can see, gathered once — kept separate from read() so read() can be tested */
  function sense() {
    var nav = root.navigator || {};
    var scr = root.screen || {};
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    var coarse = false;
    try { coarse = !!(root.matchMedia && root.matchMedia('(pointer:coarse)').matches); } catch (_) {}
    var uaMobile = null;
    try { if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') uaMobile = nav.userAgentData.mobile; } catch (_) {}
    var platform = '';
    try { platform = (nav.userAgentData && nav.userAgentData.platform) || ''; } catch (_) {}
    return {
      language: nav.language || '',
      languages: (nav.languages || []).slice(0, 5),
      timeZone: tz,
      screenW: scr.width || 0,
      screenH: scr.height || 0,
      dpr: root.devicePixelRatio || 1,
      coarsePointer: coarse,
      uaMobile: uaMobile,
      platform: platform,
      touchPoints: nav.maxTouchPoints || 0,
      online: nav.onLine !== false
    };
  }

  /**
   * ⭐⭐ THE GOVERNANCE CONTEXT. Every field carries `from` — the sentence the screen shows to explain where the
   * value came from — so a person can tell a reading from a guess before agreeing to it.
   * ⚠️ NO `ip`. See rule 3: the browser cannot see it and must not invent it.
   */
  function read(env) {
    var e = env || sense();
    var R = regions();
    var c = countryOf(e);
    var reg = c.value ? R[c.value] : null;
    return {
      at: new Date().toISOString(),
      country: { value: c.value, from: c.from, unserved: c.unserved || '', name: reg ? reg.name : '' },
      /* ⭐ the region names its money and its formats — this file does not keep a second opinion about either */
      currency: { value: reg ? reg.cur[0] : '', from: reg ? ('the usual currency in ' + reg.name) : '' },
      locale: { value: reg ? reg.format : (e.language || ''), from: reg ? ('how numbers and dates are written in ' + reg.name) : 'your browser' },
      language: { value: String(e.language || '').split('-')[0], from: 'your browser' },
      languages: { value: (e.languages || []).slice(), from: 'your browser' },
      timezone: { value: e.timeZone || '', from: 'your device clock' },
      device: {
        value: deviceOf(e),
        from: 'the screen and pointer on this device',
        screen: (e.screenW && e.screenH) ? (e.screenW + '×' + e.screenH) : '',
        dpr: e.dpr || 1,
        platform: e.platform || '',
        touch: (e.touchPoints || 0) > 0
      },
      online: !!e.online
    };
  }

  /**
   * ⭐ THE ROWS THE AGREE SCREEN SHOWS. One line per thing we worked out, in the words a shopkeeper would use,
   * with what it came from. Anything unknown is listed too — a blank a person can fill is better than a
   * default they never saw. [[feedback-write-for-the-shopkeeper]]
   */
  function rows(ctx) {
    var c = ctx || read();
    var out = [
      { key: 'country', what: 'Country', value: c.country.name || c.country.value || '', from: c.country.from },
      { key: 'currency', what: 'Money', value: c.currency.value, from: c.currency.from },
      { key: 'language', what: 'Language', value: c.language.value, from: c.language.from },
      { key: 'timezone', what: 'Time zone', value: c.timezone.value, from: c.timezone.from },
      { key: 'device', what: 'This device', value: c.device.value + (c.device.screen ? ' · ' + c.device.screen : ''), from: c.device.from }
    ];
    return out.map(function (r) {
      r.known = !!String(r.value || '').trim();
      return r;
    });
  }

  /** ⚠️ what actually goes to the server — values only, and only the ones we are sure enough to send */
  function payload(ctx) {
    var c = ctx || read();
    return {
      country: c.country.value || null,
      currency_code: c.currency.value || null,
      timezone: c.timezone.value || null,
      locale: c.locale.value || null,
      languages: (c.languages.value || []).slice(0, 3),
      device: {
        type: c.device.value,
        screen: c.device.screen,
        dpr: c.device.dpr,
        platform: c.device.platform,
        touch: c.device.touch
      },
      derived_at: c.at
    };
  }

  root.CBGov = {
    ZONES: ZONES,
    regionFromTag: regionFromTag,
    regionFromZone: regionFromZone,
    countryOf: countryOf,
    deviceOf: deviceOf,
    sense: sense,
    read: read,
    rows: rows,
    payload: payload
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
