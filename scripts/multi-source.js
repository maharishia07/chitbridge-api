/** @covers FR-K3 — STONE 3: one distributor carries two brands with a same-named finish, each under its own rules */
// multi-source.js — STONE 3: one distributor carries TWO brands (Royale Play + Nippon) with a SAME-NAMED finish.
// Each is distinct, priced per-source, and runs under its OWN source's rules. Needs b78. Run: node scripts/multi-source.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function ent(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id, bridge:(me.j&&me.j.entity||{}).bridge_id }; }
async function authorTussar(tok,key,title,minL){ const items=[{name:'Tussar',texture_family:'weave',region:'East',combinations:[{name:'Silk Route',colours:[{name:'Raw Silk',hex:'#C9A86A'}]}]}]; return api('PUT','/api/assist/catalogue-source',{token:tok,body:{source_key:key,title,items,experience:{rules:{min_order_litres:minL}}}}); }
(async()=>{
  console.log('== STONE 3: MULTI-SOURCE (Royale Play + Nippon in one shop) ==\n');
  const ts=Date.now().toString().slice(-6);
  const rp=await ent('rp3-'+ts), np=await ent('np3-'+ts);
  const rpKey='royaleplay-'+ts+'@v1', npKey='nippon-'+ts+'@v1';
  const a1=await authorTussar(rp.token,rpKey,'Royale Play',5);   // min 5 L
  if(a1.status===503){ console.log('  · b78 not applied (503) — apply b78, then re-run.'); process.exit(0); }
  await authorTussar(np.token,npKey,'Nippon Paint',1);           // min 1 L
  chk('two brands authored their own sources (both have "Tussar")', a1.status===200);

  const beta=await ent('beta3-'+ts);
  await api('POST','/api/assist/catalogue-adopt',{token:beta.token,body:{source:rpKey,commercials:{Tussar:{price_per_litre:1000}}}});
  await api('POST','/api/assist/catalogue-adopt',{token:beta.token,body:{source:npKey,commercials:{Tussar:{price_per_litre:600}}}});
  const store=await api('GET','/api/catalogue/'+beta.bridge);
  const groups=(store.j&&store.j.finishes)||[];
  chk('storefront shows BOTH brands as distinct groups', groups.length===2, groups.map(g=>g.title).join(' + '));
  const rpG=groups.find(g=>g.source===rpKey), npG=groups.find(g=>g.source===npKey);
  const rpPrice=rpG&&rpG.items[0].commercials&&rpG.items[0].commercials.price_per_litre;
  const npPrice=npG&&npG.items[0].commercials&&npG.items[0].commercials.price_per_litre;
  chk('same-named Tussar priced PER-SOURCE (RP 1000 vs Nippon 600)', rpPrice===1000 && npPrice===600, 'RP='+rpPrice+' NP='+npPrice);

  const cust='b3buyer-'+ts+'@test.com';
  // order RP Tussar 3 L → rejected (RP min 5); order Nippon Tussar 3 L → accepted (Nippon min 1). SAME name, DIFFERENT rule.
  const s1=await api('POST','/api/catalogue/'+beta.bridge+'/order/start',{body:{identifier:cust}});
  const rpBad=await api('POST','/api/catalogue/'+beta.bridge+'/order/confirm',{body:{identifier:cust,otp:(s1.j&&s1.j.dev_otp)||'123123',line_items:[{kind:'finish',source:rpKey,finish:'Tussar',combination:'Silk Route',quantity:3}]}});
  chk('RP Tussar 3 L REJECTED (RP min 5)', rpBad.status===422, (rpBad.j&&rpBad.j.message||'').slice(0,60));
  const s2=await api('POST','/api/catalogue/'+beta.bridge+'/order/start',{body:{identifier:cust}});
  const npOk=await api('POST','/api/catalogue/'+beta.bridge+'/order/confirm',{body:{identifier:cust,otp:(s2.j&&s2.j.dev_otp)||'123123',line_items:[{kind:'finish',source:npKey,finish:'Tussar',combination:'Silk Route',quantity:3}]}});
  chk('Nippon Tussar 3 L ACCEPTED (Nippon min 1) — same name, own rule', npOk.status===200, 'status '+npOk.status);
  // name-only Tussar (no source) → ambiguous → rejected
  const s3=await api('POST','/api/catalogue/'+beta.bridge+'/order/start',{body:{identifier:cust}});
  const amb=await api('POST','/api/catalogue/'+beta.bridge+'/order/confirm',{body:{identifier:cust,otp:(s3.j&&s3.j.dev_otp)||'123123',line_items:[{finish:'Tussar',combination:'Silk Route',quantity:5}]}});
  chk('name-only Tussar (no brand) REJECTED as ambiguous', amb.status===422 && /more than one brand/.test((amb.j&&amb.j.message)||''), (amb.j&&amb.j.message||'').slice(0,60));

  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
