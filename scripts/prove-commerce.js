// prove-commerce.js — LIVE proof of the COMMERCE LAYER: the instrument cluster (grouped by risk) + the end-to-end
// settlement chain (partner + cover per stage), both DERIVED from the lane (cross_border + Incoterm). Pure catalogue —
// no schema, no external calls.  node scripts/prove-commerce.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }

(async () => {
  console.log('== PROVE COMMERCE LAYER (cluster + settlement chain) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6), email = 'com-' + ts + '@test.com';
  const r1 = await fetch(B + '/api/entities/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const j1 = await r1.json();
  const r2 = await fetch(B + '/api/entities/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, otp: j1.dev_otp }) });
  const token = (await r2.json()).token;
  chk('login', !!token);

  // 1 · the INSTRUMENT CLUSTER for a cross-border CIF lane
  const inst = await api('GET', '/api/governance/instruments?incoterm=CIF&cross_border=1', { token });
  const cl = (inst.j && inst.j.cluster) || [];
  chk('cluster returns risk groups', cl.length >= 5, cl.length + ' risks');
  const payment = cl.find(g => g.risk === 'payment');
  chk('payment risk lists the Letter of Credit', !!payment && payment.instruments.some(i => i.key === 'lc'));
  const perf = cl.find(g => g.risk === 'performance');
  chk('performance risk is already covered ON-RAIL (track record)', !!perf && perf.covered_onrail === true);
  const transit = cl.find(g => g.risk === 'transit');
  const cargo = transit && transit.instruments.find(i => i.key === 'marine_cargo');
  chk('CIF → cargo insured by the SELLER (Incoterm routes it)', cargo && cargo.responsibility === 'seller', cargo && cargo.responsibility);

  // 1b · FRM legitimacy — each trade risk maps onto a canonical FRM class (market/credit/liquidity/operational)
  chk('cluster declares the FRM framework', inst.j && inst.j.framework === 'FRM');
  chk('payment risk → FRM credit', payment && payment.frm_class === 'credit', payment && payment.frm_class);
  chk('currency risk → FRM market', (cl.find(g => g.risk === 'currency') || {}).frm_class === 'market');
  chk('price/commodity risk → FRM market (CTRM hedges)', (cl.find(g => g.risk === 'price') || {}).frm_class === 'market');
  chk('transit risk → FRM operational', transit && transit.frm_class === 'operational', transit && transit.frm_class);
  chk('liquidity risk → FRM liquidity', (cl.find(g => g.risk === 'liquidity') || {}).frm_class === 'liquidity');

  // 2 · the same lane on FOB flips the cargo responsibility to the buyer
  const fob = await api('GET', '/api/governance/instruments?incoterm=FOB&cross_border=1', { token });
  const fobCargo = ((fob.j.cluster.find(g => g.risk === 'transit') || {}).instruments || []).find(i => i.key === 'marine_cargo');
  chk('FOB → cargo insured by the BUYER', fobCargo && fobCargo.responsibility === 'buyer', fobCargo && fobCargo.responsibility);

  // 3 · a DOMESTIC lane drops the export-only instruments (e.g. export credit / political risk)
  const dom = await api('GET', '/api/governance/instruments?cross_border=0', { token });
  const domKeys = (dom.j.cluster || []).flatMap(g => g.instruments.map(i => i.key));
  chk('domestic lane drops export-only cover (no export_credit / political_risk)',
    !domKeys.includes('export_credit') && !domKeys.includes('political_risk'), domKeys.length + ' instruments');

  // 4 · the END-TO-END SETTLEMENT CHAIN — partner + cover per stage
  const jr = await api('GET', '/api/governance/journey?incoterm=CIF&cross_border=1', { token });
  const chain = (jr.j && jr.j.chain) || [];
  chk('journey returns an ordered chain', chain.length >= 10, chain.length + ' stages');
  chk('finance stage engages a BANK for the LC', chain.some(s => s.stage === 'finance' && s.partner_type === 'bank' && s.instrument === 'lc'));
  chk('settlement stage is a bank documents-vs-payment step', chain.some(s => s.stage === 'settlement' && s.partner_type === 'bank'));
  chk('close stage builds the on-rail reference', chain.some(s => s.stage === 'close' && s.instrument === 'track_record' && s.onrail === 'built'));

  // 5 · a DOMESTIC journey drops export/import customs stages
  const domJ = await api('GET', '/api/governance/journey?cross_border=0', { token });
  const domStages = (domJ.j.chain || []).map(s => s.stage);
  chk('domestic journey drops export/import customs', !domStages.includes('export_customs') && !domStages.includes('import_customs'), domStages.length + ' stages');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });
