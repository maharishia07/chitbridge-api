// tests/traceability-massbalance.test.js — mass-balance invariant, Fragment 3 (RED-first, TR-4).
// Run:  TEST_URL=<url> node tests/traceability-massbalance.test.js
// A node whose children carry MORE out than it received IN (same base unit) must flag status:'red' with the
// discrepancy; a node within its budget stays 'ok'. Seeds both. RED-first: pre-Fragment-3 the walk has no `balance`.
require('dotenv').config();
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const results = [];
const C = { g:'\x1b[32m', r:'\x1b[31m', z:'\x1b[0m', bold:'\x1b[1m' };
const pass = (t,d='') => { console.log(`${C.g}✅ PASS${C.z} ${t}${d?` — ${d}`:''}`); results.push({ ok:true }); };
const fail = (t,d='') => { console.log(`${C.r}❌ FAIL${C.z} ${t}${d?` — ${d}`:''}`); results.push({ ok:false }); };

async function api(method, path, body, token){
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers:{ 'Content-Type':'application/json', ...(token && { Authorization:`Bearer ${token}` }) }, ...(body && { body: JSON.stringify(body) }) });
  let data={}; try{ data=await res.json(); }catch(_){} return { status:res.status, data };
}
async function mint(n){ const email=`mb-${n}-${Date.now()}-${Math.floor(Math.random()*1e5)}@test-cb.com`;
  const reg=await api('POST','/api/entities/register',{ display_name:`MB ${n}`, email }); const otp=reg.data.dev_otp||'123456';
  const v=await api('POST','/api/entities/verify',{ email, otp }); if(v.status!==200) throw new Error('verify '+n); return { id:v.data.entity.identity_id, token:v.data.token, name:n }; }
async function handoff(from, to, edge, op){
  const r=await api('POST','/api/chits/send',{ receivers:[{entity_id:to.id}], purpose:'delivery_note', manual_subject:`${from.name}->${to.name}`,
    line_items:[{name:edge.product||'x',quantity:edge.qty,unit:edge.unit,price:0,total:0}],
    trace:{ parents:edge.parents, is_origin:edge.is_origin, product:edge.product, qty:edge.qty, unit:edge.unit, network:{id:'mb',operator:op} } }, from.token);
  if(r.status!==200) throw new Error(`handoff ${from.name}->${to.name}: ${r.status} ${r.data.message||''}`); return r.data.chit_id; }

async function main(){
  console.log(`${C.bold}Mass-balance (Fragment 3, TR-4)${C.z}  (server: ${BASE_URL})`);
  if((await api('GET','/health')).status!==200){ fail('health'); return done(); }
  const OP=await mint('OP'), A=await mint('A'), B=await mint('B'), Cc=await mint('C'), D=await mint('D'), E=await mint('E');
  const op=OP.id;

  // O: A→B 10kg (B received 10). B then ships 6+6=12kg out → O (B's inbound node) is OVER by 2kg.
  const O  = await handoff(A, B,  { is_origin:true, product:'BULK', qty:10, unit:'kg' }, op);
  const c1 = await handoff(B, Cc, { parents:[O], product:'BULK', qty:6, unit:'kg' }, op);
  await         handoff(B, D,  { parents:[O], product:'BULK', qty:6, unit:'kg' }, op);
  // C received 6kg, ships 4kg → within budget (balanced).
  await         handoff(Cc, E, { parents:[c1], product:'BULK', qty:4, unit:'kg' }, op);

  const w = await api('GET', `/api/chits/${O}/trace?dir=forward`, null, OP.token);
  if (w.status !== 200) { fail('walk', `status ${w.status}`); return done(); }
  const byId = {}; (w.data.nodes||[]).forEach(n => byId[n.chit_id] = n);

  const oBal = byId[O] && byId[O].balance;
  if (oBal && oBal.status === 'red' && Math.round(oBal.delta) === 2000) pass('TR-4a over-shipped node flags RED', `+${oBal.delta} ${oBal.base_unit} out>in`);
  else fail('TR-4a over-shipped node should flag red (delta 2000 g)', JSON.stringify(oBal));

  const cBal = byId[c1] && byId[c1].balance;
  if (cBal && cBal.status === 'ok') pass('TR-4b within-budget node stays GREEN', `out ${cBal.out} ≤ in ${cBal.in}`);
  else fail('TR-4b balanced node should be ok', JSON.stringify(cBal));

  if (w.data.flagged === 1) pass('TR-4c walk reports exactly 1 flagged node');
  else fail('TR-4c flagged count', `got ${w.data.flagged} (expected 1)`);

  done();
}
function done(){ const ok=results.filter(r=>r.ok).length, bad=results.filter(r=>!r.ok).length;
  console.log(`\n${'═'.repeat(44)}\n  ${C.g}PASS ${ok}${C.z}   ${bad?C.r:''}FAIL ${bad}${C.z}\n${'═'.repeat(44)}`); process.exit(bad?1:0); }
main().catch(e=>{ console.error(`${C.r}crashed:${C.z} ${e.message}`); process.exit(1); });
