// OWNS      the eleven Incoterms 2020 rules and the check of a code against the chosen mode of transport
// CALLED BY tests/incoterms.test.cjs (not yet on a write path: forms still carry the code as text)
// FLOW      code + mode ──▶ incotermCheck ──▶ { ok, reason }
// CARD      21-compliance-attestation-and-trade/know-your-business
// lib/incoterms.js — ICC Incoterms 2020: seven rules for any mode of transport, four for sea and inland waterway only.
const ANY_MODE = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const SEA_ONLY = ['FAS', 'FOB', 'CFR', 'CIF'];
const CODES = ANY_MODE.concat(SEA_ONLY);

// mode: 'sea' | 'inland_waterway' | 'air' | 'road' | 'rail' | 'multimodal' (omit to check the code alone)
function incotermCheck(code, mode) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODES.includes(c)) return { ok: false, reason: 'unknown', note: c + ' is not one of the 11 Incoterms 2020 rules.' };
  const m = mode == null ? null : String(mode).toLowerCase();
  if (m && SEA_ONLY.includes(c) && m !== 'sea' && m !== 'inland_waterway') {
    return { ok: false, reason: 'mode', note: c + ' is for sea and inland waterway only; use ' + ANY_MODE.join(', ') + ' for ' + m + '.' };
  }
  return { ok: true, code: c };
}
module.exports = { incotermCheck, CODES, ANY_MODE, SEA_ONLY };
