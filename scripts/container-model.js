// container-model.js — STONE 5: container = mutable pointer over immutable versions. Needs b80.
// Proves: author v1 → chit pins v1 → ENHANCE (mint v2, pointer moves) → current resolves v2 (auto-reflect) BUT the
// pinned v1 STILL resolves the original (immutable → verifiable) → a NEW product is a NEW container → owner-gated.
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function ent(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id }; }
(async()=>{
  console.log('== STONE 5: CONTAINER MODEL (pointer over immutable versions) ==\n');
  const ts=Date.now().toString().slice(-6);
  const brand=await ent('cm-'+ts);
  const cid='royaleplay/tussar-'+ts;

  const v1=await api('PUT','/api/assist/container',{token:brand.token,body:{container_id:cid,name:'Tussar',source_key:'royale-play@v1',content:{story:'v1 story',hero:'silk-v1.jpg'},schema:{fields:['name','colour']}}});
  if(v1.status===503){ console.log('  · b80 not applied (503) — apply migration b80, then re-run.'); console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(0); }
  chk('author container v1', v1.status===200 && v1.j.version===1 && v1.j.is_new_container===true);

  const curA=await api('GET','/api/assist/container/'+encodeURIComponent(cid));
  chk('resolve current → v1', curA.j && curA.j.version===1 && curA.j.content.story==='v1 story');

  // a chit pins {container, version:1}
  const pinned={ container_id:cid, version:1 };

  // ENHANCE: mint v2 (immutable), pointer moves
  const v2=await api('PUT','/api/assist/container',{token:brand.token,body:{container_id:cid,name:'Tussar',content:{story:'v2 ENHANCED story',hero:'silk-v2.jpg',visual:'richer'},schema:{fields:['name','colour']}}});
  chk('enhance → v2 minted (same container, not new)', v2.status===200 && v2.j.version===2 && v2.j.is_new_container===false);

  const curB=await api('GET','/api/assist/container/'+encodeURIComponent(cid));
  chk('current now auto-reflects v2 (no cascade)', curB.j && curB.j.version===2 && curB.j.content.story==='v2 ENHANCED story');

  // the pinned v1 STILL resolves the ORIGINAL — the chit verifies exactly what the customer saw
  const verify=await api('GET','/api/assist/container/'+encodeURIComponent(pinned.container_id)+'?version='+pinned.version);
  chk('pinned v1 STILL resolves original (immutable — chit verifiable)', verify.j && verify.j.version===1 && verify.j.content.story==='v1 story' && verify.j.content.hero==='silk-v1.jpg');
  chk('pinned v1 knows it is NOT current', verify.j && verify.j.is_current===false && verify.j.current_version===2);

  // a NEW/different product = a NEW container
  const other=await api('PUT','/api/assist/container',{token:brand.token,body:{container_id:'royaleplay/ikkat-'+ts,name:'Ikkat',content:{story:'ikkat'}}});
  chk('new product → new container (v1, is_new)', other.status===200 && other.j.version===1 && other.j.is_new_container===true);

  // owner-gating: another brand cannot enhance this container
  const rogue=await ent('rogue-'+ts);
  const steal=await api('PUT','/api/assist/container',{token:rogue.token,body:{container_id:cid,content:{story:'hijack'}}});
  chk('another brand CANNOT enhance the container (403)', steal.status===403);

  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
