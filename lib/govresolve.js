// lib/govresolve.js — resolve an ENTITY's full governance from ATTRIBUTES (no content in code).
// Cascade: universe (base constitution = allowed bounds) → entity's constitution (vertical: defaults/jurisdiction/caps)
//          → entity's installation (picks currency/tz/region/languages, tighten-only within allowed) → entity.
// Everything is self-healing: any missing table/row/column falls back, never throws. See b72/b73/b74.
const { query, withEntity } = require('../db');
const { memo } = require('./confcache');   // platform config is read once a minute, not once a request

/**
 * ⭐ CACHED — see lib/confcache.js. `constitution` has no writer anywhere in the API; it is migration-only, and
 * this was read TWICE per resolve (base, then the entity's vertical) on the hottest endpoint on the platform.
 *
 * ⚠️ THE try/catch STAYS OUTSIDE THE MEMO, DELIBERATELY. A throw must reach the caller as "unreadable → fall
 * back", and must NOT be written to the cache. Caching a database blip's null would hold the fallback for a
 * full minute after the database came back — and a missing envelope PERMITS ANY CURRENCY (see currencyRefusal
 * below), so a cached failure would not narrow the answer, it would widen it.
 */
async function readConstitution(key, fresh) {
  try {
    return await memo('constitution:' + key, async () => {
      const r = await query(`SELECT constitution_key, version, governance, capabilities FROM constitution WHERE constitution_key = $1 AND active = true LIMIT 1`, [key]);
      return r.rows[0] || null;
    }, null, fresh);
  } catch (_) { return null; }
}
/** ⭐ CACHED, on the same rules as readConstitution above — `installation` is migration-only too. */
async function readInstallation(key, fresh) {
  try {
    return await memo('installation:' + key, async () => {
      const r = await query(`SELECT installation_key, label, cloud_provider, region, zone, domain, currency, timezone, languages, vertical_key, root_key_ref FROM installation WHERE installation_key = $1 AND active = true LIMIT 1`, [key]);
      return r.rows[0] || null;
    }, null, fresh);
  } catch (_) { return null; }
}
// pick the installation's value if it's within the allowed set (or there's no allowed set), else the default
function bounded(instVal, allowedArr, defVal) {
  if (instVal == null) return defVal != null ? defVal : null;
  if (Array.isArray(allowedArr) && allowedArr.length && allowedArr.indexOf(instVal) < 0) return defVal != null ? defVal : instVal;
  return instVal;
}

/**
 * @param {object} [opts] `{ fresh: true }` bypasses the platform-config cache — see the note on lib/confcache.js.
 *        Read paths omit it; the currency guard below does not.
 */
async function resolveEntityGovernance(entity_id, opts) {
  const fresh = !!(opts && opts.fresh);
  // the entity's own stamp (WITH RLS → read inside withEntity)
  let stamp = null;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT constitution_key, constitution_version, installation_key FROM entity_governance WHERE entity_id = $1 LIMIT 1`, [entity_id]));
    stamp = r.rows[0] || null;
  } catch (_) { /* no stamp / table */ }

  const constKey = (stamp && stamp.constitution_key) || 'base';
  const instKey  = (stamp && stamp.installation_key) || 'platform-0';

  const universe = await readConstitution('base', fresh);                   // universal allowed bounds
  const cons     = (constKey === 'base') ? universe : ((await readConstitution(constKey, fresh)) || universe);
  const inst     = await readInstallation(instKey, fresh);

  const uG = (universe && universe.governance) || {};
  const cG = (cons && cons.governance) || {};
  const allowed  = cG.allowed || uG.allowed || {};
  const defaults = Object.assign({}, uG.defaults || {}, cG.defaults || {});
  const iLangs = (inst && Array.isArray(inst.languages)) ? inst.languages : null;

  const basics = {
    currency:  bounded(inst && inst.currency, allowed.currencies, defaults.currency),
    timezone:  bounded(inst && inst.timezone, allowed.timezones, defaults.timezone),
    region:    bounded(inst && inst.region,   allowed.regions,    defaults.region),
    languages: (iLangs && iLangs.length)
      ? iLangs.filter(l => !Array.isArray(allowed.languages) || !allowed.languages.length || allowed.languages.indexOf(l) >= 0)
      : (defaults.languages || []),
  };

  // allowances = the max_* knobs on the capabilities this constitution grants
  const grantedCaps = (cons && cons.capabilities) || (universe && universe.capabilities) || [];
  const allowances = [];
  try {
    if (grantedCaps.length) {
      /* ⭐ CACHED per granted SET, not per capability — the query is one round trip for the whole list, so the
         set is the unit that was actually asked for. Sorted so two entities granted the same capabilities in a
         different order share one entry. `capability` is migration-only, like the two tables above. */
      const cr = await memo('capability:' + grantedCaps.slice().sort().join(','), () =>
        query(`SELECT capability_key, governance FROM capability WHERE capability_key = ANY($1) AND active = true`, [grantedCaps]), null, fresh);
      cr.rows.forEach(row => {
        const open = (row.governance && row.governance.open) || {};
        Object.keys(open).forEach(k => { if (k.indexOf('max_') === 0) allowances.push({ capability: row.capability_key, resource: k.slice(4), limit: open[k] }); });
      });
    }
  } catch (_) { /* capability table absent */ }

  return {
    constitution: constKey + '@' + ((cons && cons.version) || (stamp && stamp.constitution_version) || 'v1'),
    installation: inst
      ? { key: inst.installation_key, label: inst.label, cloud: inst.cloud_provider, region: inst.region, zone: inst.zone, domain: inst.domain, key_ref: inst.root_key_ref }
      : { key: instKey },
    basics,
    /**
     * ⭐⭐ THE ENVELOPE, NOT JUST THE POINT INSIDE IT. Athi, 2026-08-20: *"if the region changes, can it have
     * different currency? Under region there can be MULTIPLE currencies, one of the currency will be chosen."*
     *
     *  is the RESOLVED answer — one currency, one zone. Returning only that told a client what the
     * value IS and never what it MAY BE, so a screen could show the resolved currency and had no way to offer
     * the choice the constitution actually permits. The layer CAPS; the entity picks inside it. Without this
     * the second half of that sentence had nowhere to live.
     */
    allowed: {
      currencies: allowed.currencies || null,
      timezones:  allowed.timezones  || null,
      regions:    allowed.regions    || null,
      languages:  allowed.languages  || null,
    },
    capabilities: grantedCaps,
    jurisdiction: cG.jurisdiction || uG.jurisdiction || null,
    allowances,
  };
}

/**
 * ⭐⭐ THE ONE PLACE THAT ANSWERS "MAY THIS ENTITY PRICE IN THIS CURRENCY?" — returns null for yes, or a
 * refusal naming the permitted set.
 *
 * ⚠⚠ IT EXISTS BECAUSE THE ANSWER WAS ONLY BEING ASKED IN ONE OF THE THREE PLACES THAT SET THE COLUMN.
 * PATCH /entities/profile checked the envelope; POST /network-design/build did not, and it both CREATES stores
 * with a currency and UPDATES one when a store's place moves. So a network operator could mint a store in a
 * currency the same platform refused on the profile screen — not a loophole anyone opened, just a second write
 * path added later without the first one's guard. The AED business in production arrived by a third route (a
 * seed script running raw SQL), which is how the gap got noticed.
 *
 * ⚠️ SHAPE IS CHECKED TOO, and separately. A missing envelope permits ANY string, and currency_code is
 * varchar(3) — so 'zz9' fits the column, survives every layer, and then renders forever as the literal 'zz9'
 * because Intl throws on it and money() falls back to the raw code. An unbounded list is not an unvalidated one.
 */
async function currencyRefusal(entity_id, want) {
  const code = String(want == null ? '' : want).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return { code: 'CURRENCY_MALFORMED',
             message: JSON.stringify(String(want)) + ' is not a currency code. Use the three-letter ISO 4217 code, like SGD.' };
  }
  let permitted = null;
  try {
    /**
     * ⭐⭐ `fresh` — THIS ONE READ REFUSES THE CACHE, AND THE TEST THAT MADE ME SEE IT IS
     * tests/currency-envelope.test.cjs, which flips the envelope and asserts the very next call obeys it.
     * The failure was mine and it was the right failure: I had cached `constitution` for a minute to take four
     * round trips off the PROFILE PAINT, and quietly applied the same minute to the WRITE-PATH GUARD.
     *
     * ⚠️ A tightening would then not bite for up to sixty seconds, on every process, invisibly — and the
     * direction is the dangerous one: the stale envelope is the WIDER one, so an order in a currency the
     * constitution had just forbidden would be accepted and recorded. `/entities/me` may read a minute-old
     * envelope; a refusal may not. Latency is bought on the read path only.
     */
    const g = await resolveEntityGovernance(entity_id, { fresh: true });
    permitted = g && g.allowed && g.allowed.currencies;
  } catch (_) { /* ⚠️ governance unreadable → do NOT invent a restriction. An envelope that appears because a
                     lookup failed would refuse legitimate trade for a reason nobody could see. */ }
  if (Array.isArray(permitted) && permitted.length && permitted.indexOf(code) < 0) {
    return { code: 'CURRENCY_NOT_ALLOWED',
             message: code + ' is not available here. Choose one of: ' + permitted.join(', ') + '.',
             allowed: permitted };
  }
  return null;
}

module.exports = { resolveEntityGovernance, currencyRefusal };
