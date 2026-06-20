'use strict';
// Inheritance orchestration (pure). The DB layer (route/service) calls these with
// values it fetched via parameterized SQL, then persists the returned stamp.

const { resolve, driftStatus } = require('./resolver');

// Stamp a new entity under the active constitution (carry-lineage).
// Returns the immutable stamp + resolved effective params + any Class-C exceptions.
function mintEntity(activeConstitution, rootId, override) {
  const { effective, exceptions } = resolve(activeConstitution, override);
  return {
    governed_by: rootId,
    constitution_version: activeConstitution.version,
    params_override: override || {},
    effective,
    exceptions,
  };
}

// Re-attest an existing entity to the active constitution (clears drift).
function reattest(activeConstitution, override) {
  const { effective, exceptions } = resolve(activeConstitution, override);
  return { constitution_version: activeConstitution.version, effective, exceptions };
}

// Freeze the governance-relevant subset onto a chit at send time.
// Frozen forever — never reinterpreted even if the constitution later changes.
function freezeForChit(effective, sentAtIso) {
  return {
    currency_code: effective.currency_code,
    governing_version: effective._version || undefined, // optional, if caller attaches
    sent_at: sentAtIso, // a UTC instant string
  };
}

module.exports = { mintEntity, reattest, freezeForChit, driftStatus };
