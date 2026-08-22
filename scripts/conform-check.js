/** @covers FR-K8 — a payload is checked against its template and the verdict names the gaps */
// conform-check.js — FIRST LIGHT of AI-as-an-actor (bottom-up `ai:conform-verdict@v1` slot).
// Proves the wire moves: a food-safety payload is checked against the template; the DETERMINISTIC verdict flips
// compliant↔non-compliant, gaps are named, and the Crux-2 `acted_by` deputy stamp rides the response.
// Works WITH or WITHOUT the model key (narrative asserted only when present). Run: node scripts/conform-check.js
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let PASS = 0, FAIL = 0;
function check(n, ok, d) { if (ok) { PASS++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { FAIL++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }
async function api(m, p, { token, body } = {}) {
  const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, json: j };
}
async function tokenFor(name) {
  const email = name + '@test.com';
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.json && reg.json.dev_otp } });
  return v.json && v.json.token;
}
(async () => {
  console.log('== CONFORM-CHECK (bottom-up first light) ==\n');
  const token = await tokenFor('conform-' + Date.now().toString().slice(-6));

  // 1) COMPLIANT payload — cold chain within limits, all required points present.
  const good = await api('POST', '/api/assist/conform', { token, body: { standard: 'food-safety@v1',
    payload: { storage_temp_c: 4, batch_id: 'B-1001', expiry_date: '2026-12-01', haccp_checked: true } } });
  check('compliant payload → ok:true', good.json && good.json.ok === true, 'status ' + good.status);
  check('verdict = COMPLIANT', good.json && good.json.compliant === true);
  check('no gaps', good.json && Array.isArray(good.json.gaps) && good.json.gaps.length === 0);
  check('deputy stamp = ai:conform-verdict@v1', good.json && good.json.acted_by && good.json.acted_by.deputy === 'ai:conform-verdict@v1');
  check('delegator = the invoking human', good.json && good.json.acted_by && good.json.acted_by.delegator && good.json.acted_by.delegator.type === 'human');

  // 2) NON-COMPLIANT payload — temp over limit, batch missing, HACCP false.
  const bad = await api('POST', '/api/assist/conform', { token, body: { standard: 'food-safety@v1',
    payload: { storage_temp_c: 8, batch_id: '', expiry_date: '2026-12-01', haccp_checked: false } } });
  check('verdict FLIPS to NON-COMPLIANT', bad.json && bad.json.compliant === false);
  const gapKeys = (bad.json && bad.json.gaps || []).map(g => g.key);
  check('gap: storage_temp_c violated', gapKeys.indexOf('storage_temp_c') >= 0);
  check('gap: batch_id missing', gapKeys.indexOf('batch_id') >= 0);
  check('gap: haccp_checked violated', gapKeys.indexOf('haccp_checked') >= 0);

  // 3) Unknown standard → 404 with the available list.
  const unk = await api('POST', '/api/assist/conform', { token, body: { standard: 'nope@v9', payload: {} } });
  check('unknown standard → 404', unk.status === 404 && unk.json && Array.isArray(unk.json.available));

  // 4) Narrative — asserted ONLY when the model key is configured (self-healing otherwise).
  if (good.json && good.json.narrative) {
    check('narrative present (model configured)', typeof good.json.narrative === 'string' && good.json.narrative.length > 0);
    check('narrative model stamped on acted_by', good.json.acted_by && !!good.json.acted_by.model);
  } else {
    console.log('  · narrative absent — model not configured (deterministic verdict still stands). Set ASSIST_LLM_* to light it.');
  }

  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
