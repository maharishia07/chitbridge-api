'use strict';
// Pure governance resolver. No DB, no I/O — unit-testable in isolation.
// resolve(constitution, override) -> { effective, exceptions }
// Hard rejects (Class A invariant / Class B capability) throw GovernanceError.
// Class C (advisory/reference) is recorded in `exceptions` and allowed.

class GovernanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GovernanceError';
    this.code = code; // 'A_INVARIANT' | 'B_CAPABILITY'
  }
}

// most-restrictive-wins ordering for exposure (index 0 = most restrictive)
function tighterOrEqual(tiers, candidate, ceiling) {
  return tiers.indexOf(candidate) <= tiers.indexOf(ceiling);
}

function resolve(constitution, override) {
  if (!constitution || !constitution.version) {
    // no-orphans invariant: nothing may resolve without a governing constitution
    throw new GovernanceError('A_INVARIANT', 'no active constitution to govern this entity');
  }
  const d = constitution.defaults || {};
  const a = constitution.allowed || {};
  const effective = {
    currency_code: d.currency_code,
    default_language: d.default_language,
    exposure_default: d.exposure_default,
    region: d.region,
    default_timezone: d.default_timezone,
    allowed_languages: Array.isArray(a.languages) ? a.languages.slice() : [],
    allowed_exposure_tiers: Array.isArray(a.exposure_tiers) ? a.exposure_tiers.slice() : [],
  };
  const exceptions = [];
  const ov = override || {};

  for (const key of Object.keys(ov)) {
    const val = ov[key];
    switch (key) {
      case 'exposure_default': {
        // tighten-only: chosen may narrow, never loosen past the bound default
        if (!tighterOrEqual(a.exposure_tiers || [], val, d.exposure_default)) {
          throw new GovernanceError('A_INVARIANT',
            `tighten_only breach: exposure_default='${val}' loosens '${d.exposure_default}'`);
        }
        effective.exposure_default = val;
        break;
      }
      case 'allowed_languages': {
        // narrowing the granted set = tighten = OK; widening = capability breach
        const granted = new Set(a.languages || []);
        const requested = Array.isArray(val) ? val : [val];
        if (!requested.every((l) => granted.has(l))) {
          throw new GovernanceError('B_CAPABILITY',
            `languages ${JSON.stringify(requested)} exceed granted ${JSON.stringify(a.languages)}`);
        }
        effective.allowed_languages = requested.slice();
        break;
      }
      case 'currency_code': {
        // advisory default — entity may set; recorded as-is
        effective.currency_code = val;
        break;
      }
      case 'region': {
        if (!(a.regions_reference || []).includes(val)) {
          exceptions.push({ klass: 'C_ADVISORY', key, detail:
            `region '${val}' not in reference ${JSON.stringify(a.regions_reference)} (allowed, flagged)` });
        }
        effective.region = val;
        break;
      }
      default:
        exceptions.push({ klass: 'C_ADVISORY', key, detail: `unknown override key '${key}' (allowed, flagged)` });
    }
  }
  return { effective, exceptions };
}

function driftStatus(mintedVersion, activeVersion) {
  return String(mintedVersion) !== String(activeVersion);
}

module.exports = { resolve, driftStatus, GovernanceError };
