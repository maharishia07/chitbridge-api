// lib/verify.js — MACHINE VERIFICATION of registry IDs (the "verified" rung of the trust ladder). This is the HOOK:
// today it validates FORMAT against the registry's pattern; a real integration calls the government registry lookup
// (GSTN/IEC/PAN) to confirm the ID is real, active, and owned. HONEST: format-valid ≠ registry-confirmed until the
// live API is wired — the recorded `note`/`checked` says which check actually ran. See SPEC-attestation-layer.md.
const PATTERNS = {
  iec:  { re: /^[A-Z0-9]{10}$/,                                    label: 'IEC (Importer-Exporter Code)' },
  gstn: { re: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}$/,             label: 'GSTIN' },
  pan:  { re: /^[A-Z]{5}\d{4}[A-Z]$/,                              label: 'PAN' },
};
function verifyRegistryId(id_type, id_value) {
  const key = String(id_type || '').toLowerCase();
  const p = PATTERNS[key];
  const v = String(id_value || '').trim().toUpperCase();
  if (!p) return { ok: false, note: 'Unknown registry type "' + id_type + '".' };
  if (!p.re.test(v)) return { ok: false, note: v + ' is not a valid ' + p.label + ' format.' };
  // TODO(live): call the registry API to confirm the ID is real, active and belongs to this entity.
  return { ok: true, method: 'registry', id_type: key, value: v, checked: 'format',
    note: 'Format valid; live registry-API confirmation pending (stub).' };
}
module.exports = { verifyRegistryId };
