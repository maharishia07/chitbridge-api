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
      case 'caps': {
        /**
         * CAPS — what the provisioning operator forbids this entity to choose for itself.
         *
         * Athi, 2026-08-06: *"how do we protect a private catalogue — say it is done from the networking side? The
         * entity should be private, not public."*
         *
         * Distinct from `exposure_default`, which is a DEFAULT the entity may then narrow. A cap is a CEILING: the
         * entity cannot loosen past it, ever, from its own profile screen.
         *
         * Recognised here so a capped entity stops carrying "unknown override key 'caps' (allowed, flagged)" — a
         * governance record that reads as a mistake is worse than none, because the next person cleans it up.
         *
         * TIGHTEN-ONLY, like every other cap in this file: `private` is a restriction and is accepted; `public` is
         * not a licence and is refused, since a cap that can WIDEN what the constitution permits is not a cap.
         */
        const caps = (val && typeof val === 'object' && !Array.isArray(val)) ? val : null;
        if (!caps) { exceptions.push({ klass: 'C_ADVISORY', key, detail: 'caps must be an object — ignored' }); break; }
        const cv = String(caps.catalogue_visibility || '').trim().toLowerCase();
        if (cv && cv !== 'private') {
          throw new GovernanceError('A_INVARIANT',
            `caps.catalogue_visibility may only tighten to 'private' — '${cv}' would widen what the entity may choose`);
        }
        if (cv) effective.cap_catalogue_visibility = 'private';
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

/**
 * driftOf — THE DRIFT QUESTION ASKED OF ANY MINTED THING (the CB Sides panel, 2026-10-09): what was this business minted on, what is
 * active now, and do they differ? ONE rule for the constitution, a catalogue source, a boilerplate, a blueprint — they all stamp a
 * version at mint and have an active one later. Built ON driftStatus (the comparison stays in one place), never beside it.
 *
 * NEVER A GUESS. If either side is not recorded the answer is { known:false, drift:null } — "we cannot tell" is a fact the panel
 * prints ("not yet"), not a quiet "Current". Versions compare as text, as driftStatus does ('0.1' vs '0.1' is no drift).
 *   driftOf('0.1', '0.2') -> { minted:'0.1', active:'0.2', known:true,  drift:true  }
 *   driftOf('0.2', '0.2') -> { minted:'0.2', active:'0.2', known:true,  drift:false }
 *   driftOf(null, '0.2')  -> { minted:null,  active:'0.2', known:false, drift:null  }
 */
function driftOf(mintedVersion, activeVersion) {
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  const minted = has(mintedVersion) ? String(mintedVersion).trim() : null;
  const active = has(activeVersion) ? String(activeVersion).trim() : null;
  if (minted === null || active === null) return { minted, active, known: false, drift: null };
  return { minted, active, known: true, drift: driftStatus(minted, active) };
}

module.exports = { resolve, driftStatus, driftOf, GovernanceError };
