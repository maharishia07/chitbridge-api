// @stage tested
// @stage-note The eleven Incoterms 2020 rules and the mode check, tested (tests/std10-ids-incoterms.test.cjs); no write path calls it yet.
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
  const rule = String(code || '').trim().toUpperCase();
  if (!CODES.includes(rule)) return { ok: false, reason: 'unknown', note: rule + ' is not one of the 11 Incoterms 2020 rules.' };
  const modeName = mode == null ? null : String(mode).toLowerCase();
  if (modeName && SEA_ONLY.includes(rule) && modeName !== 'sea' && modeName !== 'inland_waterway') {
    return { ok: false, reason: 'mode', note: rule + ' is for sea and inland waterway only; use ' + ANY_MODE.join(', ') + ' for ' + modeName + '.' };
  }
  return { ok: true, code: rule };
}
module.exports = { incotermCheck, CODES, ANY_MODE, SEA_ONLY };
