// container-wiring.js — STONE 5 WIRING: catalogue items mirror to containers; the ORDER CHIT freezes the container
// ref + version → verifiable forever even after the source enhances. Needs b78 + b80. Run: node scripts/container-wiring.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function ent(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id, bridge:(me.j&&me.j.entity||{}).bridge_id }; }
(async()=>{
  console.log('== STONE 5 WIRING: order chit freezes the container version ==\n');
  const ts=Date.now().toString().slice(-6);
  const brand=await ent('cw-'+ts);
  const srcKey='rp-wire-'+ts+'@v1';
  const cid='rp-wire-'+ts+'#tussar';   // itemContainerId(srcKey,'Tussar') = <base># <norm(name)>
  const tussarV1={ name:'Tussar', texture_family:'weave', combinations:[{name:'Silk Route',colours:[{name:'Raw Silk',hex:'#C9A86A'}]}], story:'v1 story' };

  const a1=await api('PUT','/api/assist/catalogue-source',{token:brand.token,body:{source_key:srcKey,title:'Royale Play',items:[tussarV1],experience:{rules:{min_order_litres:1}}}});
  if(a1.status===503){ console.log('  · b78/b80 not applied — apply, then re-run.'); process.exit(0); }
  chk('source authored + item mirrored to a container', a1.status===200 && a1.j.containers>=1, 'containers='+(a1.j&&a1.j.containers));
  const c1=await api('GET','/api/assist/container/'+encodeURIComponent(cid));
  chk('item container is at v1', c1.j && c1.j.version===1 && c1.j.content.story==='v1 story');

  const dist=await ent('cwd-'+ts);
  await api('POST','/api/assist/catalogue-adopt',{token:dist.token,body:{source:srcKey,commercials:{Tussar:{price_per_litre:1000}}}});
  const cust='cwbuyer-'+ts+'@test.com';
  const s=await api('POST','/api/catalogue/'+dist.bridge+'/order/start',{body:{identifier:cust}});
  const cf=await api('POST','/api/catalogue/'+dist.bridge+'/order/confirm',{body:{identifier:cust,otp:(s.j&&s.j.dev_otp)||'123123',line_items:[{kind:'finish',source:srcKey,finish:'Tussar',combination:'Silk Route',quantity:2}]}});
  chk('order placed', cf.status===200 && cf.j.chit_id, 'status '+cf.status);
  // the SHOP opens its order chit → the line froze the container ref + version 1
  const chit=await api('GET','/api/chits/'+encodeURIComponent(cf.j.chit_id),{token:dist.token});
  const blob=JSON.stringify(chit.j||{});
  chk('order chit FROZE the container ref + version 1', blob.indexOf(cid)>=0 && /"content_version":\s*1/.test(blob), 'chit has container? '+(blob.indexOf(cid)>=0));

  // brand ENHANCES Tussar → container moves to v2
  const tussarV2=Object.assign({},tussarV1,{ story:'v2 ENHANCED story', hero:'silk-v2.jpg' });
  await api('PUT','/api/assist/catalogue-source',{token:brand.token,body:{source_key:srcKey,title:'Royale Play',items:[tussarV2],experience:{rules:{min_order_litres:1}}}});
  const cCur=await api('GET','/api/assist/container/'+encodeURIComponent(cid));
  chk('container now at v2 (enhanced)', cCur.j && cCur.j.version===2 && cCur.j.content.story==='v2 ENHANCED story');
  const cPin=await api('GET','/api/assist/container/'+encodeURIComponent(cid)+'?version=1');
  chk('the chit\'s pinned v1 STILL resolves the original (verifiable after enhancement)', cPin.j && cPin.j.version===1 && cPin.j.content.story==='v1 story');

  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
