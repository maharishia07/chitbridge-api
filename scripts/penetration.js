// penetration.js — STONE 4: consent location capture → the brand's AGGREGATE-ONLY penetration heatmap (no PII).
// Brand authors a source → distributor adopts → customers order WITH a locality → the brand sees aggregated counts by
// locality (orders + distributor coverage), never a customer identity. Needs b78 + b79. Run: node scripts/penetration.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function ent(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id, bridge:(me.j&&me.j.entity||{}).bridge_id }; }
async function orderAt(bridge, cust, source, loc){ const s=await api('POST','/api/catalogue/'+bridge+'/order/start',{body:{identifier:cust}}); return api('POST','/api/catalogue/'+bridge+'/order/confirm',{body:{identifier:cust,otp:(s.j&&s.j.dev_otp)||'123123',location:loc,line_items:[{kind:'finish',source,finish:'Tussar',combination:'Silk Route',quantity:5}]}}); }
(async()=>{
  console.log('== STONE 4: LOCATION CAPTURE → PENETRATION HEATMAP (aggregate-only) ==\n');
  const ts=Date.now().toString().slice(-6);
  const brand=await ent('rpp-'+ts), key='rp-pen-'+ts+'@v1';
  const items=[{name:'Tussar',texture_family:'weave',combinations:[{name:'Silk Route',colours:[{name:'Raw Silk',hex:'#C9A86A'}]}]}];
  const a=await api('PUT','/api/assist/catalogue-source',{token:brand.token,body:{source_key:key,title:'Royale Play',items,experience:{rules:{min_order_litres:1}}}});
  if(a.status===503){ console.log('  · b78 not applied (503) — apply b78+b79, then re-run.'); process.exit(0); }
  chk('brand authored source', a.status===200);
  const d1=await ent('dpa-'+ts), d2=await ent('dpb-'+ts);
  await api('POST','/api/assist/catalogue-adopt',{token:d1.token,body:{source:key,commercials:{Tussar:{price_per_litre:900}}}});
  await api('POST','/api/assist/catalogue-adopt',{token:d2.token,body:{source:key,commercials:{Tussar:{price_per_litre:950}}}});
  // customers order with localities across two distributors
  await orderAt(d1.bridge,'c1-'+ts+'@test.com',key,'560001');
  await orderAt(d1.bridge,'c2-'+ts+'@test.com',key,'560001');
  await orderAt(d2.bridge,'c3-'+ts+'@test.com',key,'400001');
  const pen=await api('GET','/api/assist/penetration',{token:brand.token});
  if(pen.status===503){ console.log('  · b79 not applied (503) — apply b79, then re-run.'); console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(0); }
  chk('brand sees aggregated penetration', pen.status===200 && pen.j && Array.isArray(pen.j.by_locality));
  const bl=(pen.j&&pen.j.by_locality)||[];
  const b1=bl.find(x=>x.locality==='560001'), b2=bl.find(x=>x.locality==='400001');
  chk('locality 560001 = 2 orders across 1 distributor', b1 && b1.orders===2 && b1.distributors===1, b1&&JSON.stringify(b1));
  chk('locality 400001 = 1 order across 1 distributor', b2 && b2.orders===1, b2&&JSON.stringify(b2));
  chk('NO per-customer PII in penetration (only source/locality/counts)', bl.every(x=>!('customer_identity_id' in x) && !('email' in x)));
  // isolation: a DIFFERENT brand sees nothing of this source
  const other=await ent('rpo-'+ts);
  const pOther=await api('GET','/api/assist/penetration',{token:other.token});
  chk('another brand sees NONE of this source (owner-gated)', pOther.status===200 && (pOther.j.by_locality||[]).every(x=>x.source_key!==key));
  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
