// erp-handoff.js — 6b: on order, CB emits a RECEIPT-ONLY handoff of the order + its governance to the distributor's
// ERP (refs + routing + hash, NOT the raw payload; process-then-forget). CB does NOT route. Needs b78+b80+b82.
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function ent(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id, bridge:(me.j&&me.j.entity||{}).bridge_id }; }
(async()=>{
  console.log('== 6b: ERP HANDOFF (receipt-only) ==\n');
  const ts=Date.now().toString().slice(-6);
  const brand=await ent('eh-'+ts); const srcKey='rp-eh-'+ts+'@v1';
  const a=await api('PUT','/api/assist/catalogue-source',{token:brand.token,body:{source_key:srcKey,title:'Royale Play',items:[{name:'Tussar',combinations:[{name:'Silk Route',colours:[{name:'Raw Silk',hex:'#C9A86A'}]}]}],experience:{rules:{min_order_litres:1,order_routing:'nearest_distributor'}}}});
  if(a.status===503){ console.log('  · b78/b80 not applied — apply, re-run.'); process.exit(0); }
  const dist=await ent('ehd-'+ts);
  await api('POST','/api/assist/catalogue-adopt',{token:dist.token,body:{source:srcKey,commercials:{Tussar:{price_per_litre:1000}}}});
  const cust='ehbuyer-'+ts+'@test.com';
  const s=await api('POST','/api/catalogue/'+dist.bridge+'/order/start',{body:{identifier:cust}});
  const cf=await api('POST','/api/catalogue/'+dist.bridge+'/order/confirm',{body:{identifier:cust,otp:(s.j&&s.j.dev_otp)||'123123',location:'560001',line_items:[{kind:'finish',source:srcKey,finish:'Tussar',combination:'Silk Route',quantity:2}]}});
  chk('order placed', cf.status===200 && cf.j.chit_id);
  // the DISTRIBUTOR sees the ERP handoff receipt
  const ho=await api('GET','/api/assist/erp-handoffs',{token:dist.token});
  if(ho.status===503){ console.log('  · b82 not applied (503) — apply migration b82, then re-run.'); console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(0); }
  chk('a handoff receipt was recorded', ho.j && ho.j.count>=1);
  const h=(ho.j&&ho.j.handoffs||[]).find(x=>x.chit_id===cf.j.chit_id) || (ho.j&&ho.j.handoffs||[])[0];
  chk('receipt carries a payload HASH + status handed_off', h && h.payload_hash && h.status==='handed_off', h&&(h.payload_hash||'').slice(0,12));
  chk('receipt carries the governance (source@v + routing), NOT the raw payload', h && h.summary && Array.isArray(h.summary.lines) && h.summary.lines[0].source===srcKey && h.summary.lines[0].routing==='nearest_distributor', h&&JSON.stringify(h.summary&&h.summary.lines&&h.summary.lines[0]));
  chk('receipt carries the FROZEN container ref (verifiable)', h && h.summary.lines[0].container && h.summary.lines[0].container.ref, h&&JSON.stringify(h.summary.lines[0].container));
  chk('receipt carries locality (info for the ERP to route)', h && h.summary.locality==='560001');
  // isolation: another entity sees none of this distributor's handoffs
  const other=await ent('eho-'+ts);
  const hoO=await api('GET','/api/assist/erp-handoffs',{token:other.token});
  chk('another entity sees NONE of this distributor handoffs (WITH RLS)', hoO.status===200 && (hoO.j.handoffs||[]).every(x=>x.chit_id!==cf.j.chit_id));
  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
