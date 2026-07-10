// regional-scatter.js — 6a "spin the globe": one product resolves differently per customer region (auto-basics +
// regional overrides), sealed + cached. Needs b80 + b81. Run: node scripts/regional-scatter.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function ent(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id }; }
(async()=>{
  console.log('== 6a: REGIONAL SCATTER (spin the globe) ==\n');
  const ts=Date.now().toString().slice(-6);
  const brand=await ent('rs-'+ts);
  const cid='royaleplay/tussar-rs-'+ts;
  const a=await api('PUT','/api/assist/container',{token:brand.token,body:{container_id:cid,name:'Tussar',content:{colour_name:'Raw Silk',story:'silk that catches the light'}}});
  if(a.status===503){ console.log('  · b80 not applied — apply, re-run.'); process.exit(0); }
  chk('brand authored the global container', a.status===200);

  // a genuinely-local override for Mexico (Spanish colour name + a compliance note)
  const ovr=await api('PUT','/api/assist/region-override',{token:brand.token,body:{container_id:cid,region:'MX',overrides:{colour_name:'Seda Cruda',compliance:'NOM-003'}}});
  if(ovr.status===503){ console.log('  · b81 not applied (503) — apply migration b81, then re-run.'); console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(0); }
  chk('brand authored a Mexico override', ovr.status===200);

  // spin to INDIA → INR/litre/en, GLOBAL colour name
  const inR=await api('GET','/api/assist/resolve?container='+encodeURIComponent(cid)+'&region=IN');
  chk('IN → INR/litre/en + global colour', inR.j && inR.j.resolved._basics.currency==='INR' && inR.j.resolved._basics.units==='litre' && inR.j.resolved.colour_name==='Raw Silk', JSON.stringify(inR.j&&inR.j.resolved._basics));
  chk('IN jurisdiction: provider not custodian', inR.j && inR.j.resolved._jurisdiction && inR.j.resolved._jurisdiction.custodian===false);

  // spin to MEXICO → MXN/es + LOCAL colour name (override applied)
  const mxR=await api('GET','/api/assist/resolve?container='+encodeURIComponent(cid)+'&region=MX');
  chk('MX → MXN/es + LOCAL colour "Seda Cruda"', mxR.j && mxR.j.resolved._basics.currency==='MXN' && mxR.j.resolved._basics.language==='es' && mxR.j.resolved.colour_name==='Seda Cruda' && mxR.j.resolved.compliance==='NOM-003', JSON.stringify(mxR.j&&mxR.j.resolved._basics));

  // spin to US → USD/GALLON (units scatter!)
  const usR=await api('GET','/api/assist/resolve?container='+encodeURIComponent(cid)+'&region=US');
  chk('US → USD/GALLON (units scatter) + global colour', usR.j && usR.j.resolved._basics.currency==='USD' && usR.j.resolved._basics.units==='gallon' && usR.j.resolved.colour_name==='Raw Silk');

  // spin MX again → served from the SEALED cache (resolve-at-mint, dereference)
  const mx2=await api('GET','/api/assist/resolve?container='+encodeURIComponent(cid)+'&region=MX');
  chk('MX re-resolve served from the SEALED blueprint (cache)', mx2.j && mx2.j.sealed===true);

  // owner-gating on the override
  const rogue=await ent('rsx-'+ts);
  const steal=await api('PUT','/api/assist/region-override',{token:rogue.token,body:{container_id:cid,region:'US',overrides:{colour_name:'hijack'}}});
  chk('another brand CANNOT override this container (403)', steal.status===403);

  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
