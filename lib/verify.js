// lib/verify.js — REGISTRY VERIFICATION of IDs (the "verified" rung). HONEST BY CONSTRUCTION:
//   • a real registry confirmation (a KYB provider says the ID is found + active)  → method:'registry' → rung VERIFIED.
//   • only a FORMAT/pattern match, with no registry connected                      → method:'format'   → NOT verified
//     (rungOf drops it to 'declared'). We never label a format check "verified".
// KEY-READY: set env CB_KYB_PROVIDER (+ its keys) and the same call becomes a real registry lookup — no other change.
// Providers are pluggable; the 'generic' one is env-driven for any KYB aggregator (Sandbox.co.in, Surepass, Cashfree,
// Signzy, IDfy…). Confirm each provider's exact request/response mapping against its docs at integration.
// See C:\dev\procurement + SPEC-attestation-layer.md.

const PATTERNS = {
  iec:  { re: /^[A-Z0-9]{10}$/,                        label: 'IEC (Importer-Exporter Code)' },
  gstn: { re: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}$/, label: 'GSTIN' },
  pan:  { re: /^[A-Z]{5}\d{4}[A-Z]$/,                  label: 'PAN' },
};

// ── FORMAT check (synchronous, no network) ──────────────────────────────────
function verifyFormat(id_type, id_value) {
  const key = String(id_type || '').toLowerCase();
  const p = PATTERNS[key];
  const v = String(id_value || '').trim().toUpperCase();
  if (!p) return { ok: false, reason: 'unknown_type', note: 'Unknown registry type "' + id_type + '".' };
  if (!p.re.test(v)) return { ok: false, reason: 'format', note: v + ' is not a valid ' + p.label + ' format.' };
  return { ok: true, id_type: key, value: v, label: p.label };
}

// ── PROVIDERS (pluggable). Each lookup(id_type, value) → { found, active, legal_name, status } or throws. ─────────────
const PROVIDERS = {
  // generic: POST { id_type, id_value } to CB_KYB_BASE with a Bearer key; expects { found, active, legal_name, status }.
  // Point CB_KYB_BASE at your aggregator's endpoint and adjust the mapping below to its response shape.
  generic: {
    ready: () => !!(process.env.CB_KYB_BASE && process.env.CB_KYB_KEY),
    lookup: async (id_type, value) => {
      const res = await fetch(process.env.CB_KYB_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.CB_KYB_KEY },
        body: JSON.stringify({ id_type, id_value: value }),
      });
      if (!res.ok) throw new Error('provider HTTP ' + res.status);
      const j = await res.json();
      // map the aggregator's response → our normalised shape (adjust field names per provider docs)
      const d = j.data || j.result || j;
      const status = d.status || d.gst_status || d.registration_status || null;
      const active = d.active != null ? !!d.active : (status ? /active|valid|registered/i.test(String(status)) : undefined);
      return { found: d.found != null ? !!d.found : true, active, legal_name: d.legal_name || d.name || d.trade_name || null, status };
    },
  },
};
function getProvider() {
  const name = String(process.env.CB_KYB_PROVIDER || '').toLowerCase();
  const p = PROVIDERS[name];
  return p && p.ready() ? { name, lookup: p.lookup } : null;
}

// ── the real thing: format-gate, then registry-confirm if a provider is connected. ──────────────────────────────────
async function verifyRegistry(id_type, id_value) {
  const f = verifyFormat(id_type, id_value);
  if (!f.ok) return f;                                   // bad format/type → caller returns 422
  const prov = getProvider();
  if (!prov) {
    // no registry connected — be honest: format valid, NOT registry-confirmed.
    return { ok: true, method: 'format', checked: 'format', id_type: f.id_type, value: f.value,
      note: 'Format valid — no registry connected, so NOT registry-confirmed. Connect a KYB provider to verify.' };
  }
  let r;
  try { r = await prov.lookup(f.id_type, f.value); }
  catch (e) { return { ok: false, reason: 'unreachable', transient: true, note: 'Registry unreachable via ' + prov.name + ': ' + e.message }; }
  if (!r || r.found === false || r.active === false) {
    return { ok: false, reason: 'not_active', note: (f.label + ' not found or inactive on the registry.') };
  }
  return { ok: true, method: 'registry', checked: 'registry', id_type: f.id_type, value: f.value, provider: prov.name,
    registry: { legal_name: r.legal_name || null, status: r.status || 'active' },
    note: 'Confirmed active against ' + prov.name + (r.legal_name ? ' (' + r.legal_name + ')' : '') + '.' };
}

module.exports = { verifyRegistry, verifyFormat, getProvider,
  // back-compat alias — now returns the format result only (no false "registry" claim)
  verifyRegistryId: verifyFormat };
