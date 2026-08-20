// lib/govresolve.js — resolve an ENTITY's full governance from ATTRIBUTES (no content in code).
// Cascade: universe (base constitution = allowed bounds) → entity's constitution (vertical: defaults/jurisdiction/caps)
//          → entity's installation (picks currency/tz/region/languages, tighten-only within allowed) → entity.
// Everything is self-healing: any missing table/row/column falls back, never throws. See b72/b73/b74.
const { query, withEntity } = require('../db');

async function readConstitution(key) {
  try {
    const r = await query(`SELECT constitution_key, version, governance, capabilities FROM constitution WHERE constitution_key = $1 AND active = true LIMIT 1`, [key]);
    return r.rows[0] || null;
  } catch (_) { return null; }
}
async function readInstallation(key) {
  try {
    const r = await query(`SELECT installation_key, label, cloud_provider, region, zone, domain, currency, timezone, languages, vertical_key, root_key_ref FROM installation WHERE installation_key = $1 AND active = true LIMIT 1`, [key]);
    return r.rows[0] || null;
  } catch (_) { return null; }
}
// pick the installation's value if it's within the allowed set (or there's no allowed set), else the default
function bounded(instVal, allowedArr, defVal) {
  if (instVal == null) return defVal != null ? defVal : null;
  if (Array.isArray(allowedArr) && allowedArr.length && allowedArr.indexOf(instVal) < 0) return defVal != null ? defVal : instVal;
  return instVal;
}

async function resolveEntityGovernance(entity_id) {
  // the entity's own stamp (WITH RLS → read inside withEntity)
  let stamp = null;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT constitution_key, constitution_version, installation_key FROM entity_governance WHERE entity_id = $1 LIMIT 1`, [entity_id]));
    stamp = r.rows[0] || null;
  } catch (_) { /* no stamp / table */ }

  const constKey = (stamp && stamp.constitution_key) || 'base';
  const instKey  = (stamp && stamp.installation_key) || 'platform-0';

  const universe = await readConstitution('base');                          // universal allowed bounds
  const cons     = (constKey === 'base') ? universe : ((await readConstitution(constKey)) || universe);
  const inst     = await readInstallation(instKey);

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
      const cr = await query(`SELECT capability_key, governance FROM capability WHERE capability_key = ANY($1) AND active = true`, [grantedCaps]);
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

module.exports = { resolveEntityGovernance };
