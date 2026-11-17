'use strict';
/**
 * lib/entities-prefs.js — the person's own preference sets (locale, ui): the whitelist of keys and checks, the merge-patch SQL, prefPatch, the own-property lookup.
 * OWNS      PREF_SETS · MERGE_PATCH_SQL · prefPatch · prefSetOf (no route, no state)
 * CALLED BY routes/entities.js (PATCH /me/prefs/:kind and the ui_prefs write); re-exported there for its tests
 * FLOW      prefSetOf(kind) -> prefPatch(set, body) -> { set, drop } or { error } -> MERGE_PATCH_SQL(column)
 * CARD      28-platform-and-operations/entities-routes
 */


/**
 * PATCH /entities/me/prefs/:kind — store one of the PERSON's own preference sets (b165 locale · b166 ui).
 *
 * ⚠️ ONE HANDLER, TWO COLUMNS — generalised rather than copied. Two near-identical prefs endpoints would drift
 * the first time one of them gained validation, an audit line or a rate limit, and the one nobody remembered
 * would be the one carrying somebody's accessibility setting.
 *
 * ⚠️ SEPARATE FROM PATCH /profile, deliberately. /profile edits the BUSINESS — its GSTN, address, logo, shop
 * status. This edits how one human reads the screen. Folding a personal preference into the business profile
 * would mean a co-assist could not change their own language or contrast without write access to their
 * employer's record, and that an owner editing the firm's address would be touching the same object as their
 * clerk's numerals.
 *
 * ⚠️ THE TARGET ROW IS NEVER TAKEN FROM THE BODY. identity_id comes from the verified token, so the only row a
 * caller can write is their own. There is no id parameter to get wrong.
 *
 * ⚠️ AND THE COLUMN NAME IS NEVER TAKEN FROM THE URL. :kind selects an entry in PREF_SETS below; the column
 * string comes from that entry and never from req.params. An unknown kind is a 404, not a query. Interpolating
 * a caller-supplied identifier into SQL is exactly how a whitelist stops being a whitelist.
 */
const PREF_SETS = {
  /* The six keys the localisation layer reads. `lang` and `locale` are language tags; the rest are the UTS #35
     locale keywords, stored by their own subtag names so the column reads as the standard writes it. */
  locale: {
    column: 'locale_prefs',
    keys: ['lang', 'langs', 'region', 'locale', 'nu', 'hc', 'ca', 'fw', 'tz', 'workdays'],
    /* ⚠️ `langs` IS A LIST, so it is the one key whose value may contain commas — RFC 4647 calls it a language
       priority list ("Tamil, then English, then Hindi"). Widening the generic pattern for every key to admit
       commas would have been the smaller edit and the wrong one: a comma has no business in a numbering system
       or an hour cycle, and a validator that accepts more than it needs to stops being a validator. */
    /* CU3: `tz` is an IANA zone (`Asia/Kolkata`, `America/Argentina/Buenos_Aires`) and `workdays` an ISO weekday list
       (`1,2,3,4,5,6`, 1 = Monday) — CBLocale sent both and the old key list dropped them silently. The generic pattern
       admits neither `/` nor `,`, and one rejected key fails the whole save, so each carries its own. */
    patterns: {
      langs: /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*(,[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*){0,2}$/,
      tz: /^[A-Za-z][A-Za-z0-9_+-]{0,30}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/,
      workdays: /^[1-7](,[1-7]){0,6}$/
    },
    /**
     * ⚠️ ICU VALIDATES THE VALUES, NOT A HAND-WRITTEN LIST. BCP 47 admits thousands of valid tags; a whitelist of
     * the nine the screen currently offers would reject the tenth the day someone needs it, and would drift out
     * of step with CLDR every release. Syntax is checked generically above; MEANING is checked by asking Intl to
     * build the tag. If it can format with it, it is a real subtag. Adopting the standard's own validator beats
     * maintaining our opinion of what the standard contains.
     */
    check(prefs) {
      try {
        const list = ['nu', 'hc', 'ca', 'fw'].filter((item) => prefs[item]).map((item) => `${item}-${prefs[item]}`);
        const tag = (prefs.locale || prefs.lang || 'en') + (list.length ? '-u-' + list.join('-') : '');
        new Intl.NumberFormat(tag);
        new Intl.DateTimeFormat(tag);
      } catch (_) {
        return 'That combination is not a locale ICU recognises';
      }
      /* the zone is ICU's to judge too (RangeError for one it does not know) — never a hand-kept list */
      if (prefs.tz) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: prefs.tz });
        } catch (_) {
          return 'Unknown time zone';
        }
      }
      return null;
    }
  },
  /**
   * Appearance. ⚠️ HERE A CLOSED LIST IS RIGHT, and the contrast with locale above is the point: these are OUR
   * enumerations, not a standard's. There is no external registry of themes that could add a sixteenth without
   * us knowing, so anything outside the list is a bug or a probe rather than a value we have not caught up with.
   * The theme itself stays open-ended in shape (a short slug) so shipping a new one needs no migration here.
   */
  ui: {
    column: 'ui_prefs',
    keys: [
      'theme',
      'fs',
      'motion',
      'stripes',
      'edition',
      'font',
      'weight',
      'kural'
    ] /* kural (SET-WALK1 W7): the Thirukkural band — auto · on · off, the owner's choice */ /* stripes: row stripes off | light | strong (small-fixes round); edition: which showing of Home (web manifest `editions`, AX1) — open-ended like theme, it HIDES doors, never grants · font, weight: CU3 (were device-only) */,
    check(prefs) {
      if (prefs.font && !['default', 'grotesk', 'serif', 'wide', 'mono'].includes(prefs.font)) return 'Unknown reading font'; /* avatar.js FONTS */
      if (prefs.weight && !['normal', 'bold'].includes(prefs.weight)) return 'Unknown text weight';
      if (prefs.stripes && !['off', 'light', 'strong'].includes(prefs.stripes)) return 'Unknown row stripes setting';
      if (prefs.fs && !['s', 'm', 'l', 'xl'].includes(prefs.fs)) return 'Unknown text size';
      if (prefs.motion && !['auto', 'reduce', 'full'].includes(prefs.motion)) return 'Unknown motion setting';
      if (prefs.edition && !/^[a-z][a-z0-9-]{0,23}$/.test(prefs.edition)) return 'Unknown edition';
      return null;
    }
  }
};

/**
 * ⭐ RFC 7386 MERGE-PATCH FOR A PREFS COLUMN — the ONE expression every ui_prefs / locale_prefs write uses (CU2).
 * $1 = the keys to set (jsonb) · $3 = the keys to remove (text[]). A key the caller did not send is left alone; a key
 * sent as null or '' is removed ("follow the default"). `||` alone cannot remove, and `= $1` erased what it did not name.
 */
const MERGE_PATCH_SQL = (col) => `(COALESCE(${col}, '{}'::jsonb) - $3::text[]) || $1::jsonb`;

/** prefPatch(set, body) → { set, drop } or { error }. Whitelisted keys only; '' / null = drop; a bad value = error. */
function prefPatch(set, payload) {
  const out = {},
    drop = [];
  for (const k of set.keys) {
    if (!(k in payload)) continue; // not sent = not touched
    const v = String(payload[k] == null ? '' : payload[k]).trim();
    if (!v) {
      drop.push(k);
      continue;
    } // empty = "follow the default": removed
    // Short alphanumeric-and-hyphen tokens. Anything else is not one of these values at all.
    const pat = (set.patterns && set.patterns[k]) || /^[A-Za-z0-9][A-Za-z0-9-]{0,34}$/;
    if (!pat.test(v)) return { error: `${k} is not a valid value` };
    out[k] = v;
  }
  return { set: out, drop };
}

/**
 * prefSetOf(kind) → the preference set the kind names, or null.
 * ⚠️ hasOwnProperty, NOT A TRUTHY LOOKUP — found by red-teaming this endpoint rather than by a failure.
 *
 * `PREF_SETS[kind]` walks the PROTOTYPE CHAIN, so `kind=__proto__`, `constructor`, `toString` and
 * `valueOf` all return something truthy and sail past the 404. None of them can write to a table — the
 * column comes from `set.column`, which is undefined for all of them — but the request then throws deep
 * inside the handler and surfaces as a 500 with a confusing log, when the honest answer is "no such set".
 *
 * The rule this is a case of: a whitelist consulted with bracket notation is not a whitelist unless the
 * lookup is own-property. That is the same class as interpolating a caller's string into SQL, one step back.
 */
const prefSetOf = (kind) => (Object.prototype.hasOwnProperty.call(PREF_SETS, kind) ? PREF_SETS[kind] : null);

module.exports = { PREF_SETS, MERGE_PATCH_SQL, prefPatch, prefSetOf };
