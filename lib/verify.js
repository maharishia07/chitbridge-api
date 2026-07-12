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

// Sandbox.co.in (Quicko) auth: exchange api-key + api-secret for a short-lived access token (cached in-process).
let _sbTok = null, _sbExp = 0;
async function _sbAuth() {
  if (_sbTok && Date.now() < _sbExp) return _sbTok;
  const base = process.env.SANDBOX_BASE || 'https://api.sandbox.co.in';
  const res = await fetch(base + '/authenticate', { method: 'POST', headers: {
    'x-api-key': process.env.SANDBOX_API_KEY, 'x-api-secret': process.env.SANDBOX_API_SECRET,
    'x-api-version': process.env.SANDBOX_AUTH_VERSION || '1.0.0', 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error('sandbox auth HTTP ' + res.status);
  const j = await res.json(); _sbTok = j.access_token || (j.data && j.data.access_token);
  if (!_sbTok) throw new Error('sandbox auth: no access_token in response');
  _sbExp = Date.now() + 20 * 60 * 1000;   // refresh conservatively (~20 min)
  return _sbTok;
}

// ── PROVIDERS (pluggable). Each lookup(id_type, value) → { found, active, legal_name, status } or throws. ─────────────
const PROVIDERS = {
  // sandbox: Sandbox.co.in (Quicko). Set CB_KYB_PROVIDER=sandbox + SANDBOX_API_KEY + SANDBOX_API_SECRET. Uses sandbox
  // TEST IDs until you go to production. ⚠️ CONFIRM the exact endpoint paths + response field names against the current
  // Sandbox.co.in API docs — they version them; each path is overridable by env so no code change is needed to adjust.
  sandbox: {
    ready: () => !!(process.env.SANDBOX_API_KEY && process.env.SANDBOX_API_SECRET),
    lookup: async (id_type, value) => {
      const base = process.env.SANDBOX_BASE || 'https://api.sandbox.co.in';
      const token = await _sbAuth();
      const H = { Authorization: token, 'x-api-key': process.env.SANDBOX_API_KEY, 'x-api-version': process.env.SANDBOX_API_VERSION || '1.0', 'Content-Type': 'application/json' };
      let url, method = 'POST', body;
      if (id_type === 'gstn')      { url = base + (process.env.SANDBOX_GST_PATH || '/gst/compliance/public/gstin/search'); body = JSON.stringify({ gstin: value }); }
      else if (id_type === 'pan')  { url = base + (process.env.SANDBOX_PAN_PATH || '/kyc/pan/verify'); body = JSON.stringify({ pan: value, consent: 'Y', reason: 'KYB verification' }); }
      else if (id_type === 'iec')  { url = base + (process.env.SANDBOX_IEC_PATH || '/dgft/iec/' + value); method = 'GET'; body = undefined; }
      else throw new Error('sandbox: unsupported id_type ' + id_type);
      const res = await fetch(url, { method, headers: H, body });
      if (!res.ok) throw new Error('sandbox ' + id_type + ' HTTP ' + res.status);
      const j = await res.json();
      const d = (j.data && (j.data.data || j.data)) || j.result || j;   // GST public search nests under data (+ sometimes data.data)
      const status = d.status || d.gstin_status || d.sts || d.registration_status || null;
      const active = d.active != null ? !!d.active : (status ? /active|valid|registered|exist/i.test(String(status)) : undefined);
      const legal_name = d.legal_name || d.legal_name_of_business || d.lgnm || d.name || d.trade_name || d.tradeNam || null;
      return { found: d.found != null ? !!d.found : true, active, legal_name, status };
    },
  },
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
