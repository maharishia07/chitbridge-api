// source-entity.js — SOURCE-AS-ENTITY + experience blueprint (needs b78).
// A brand entity AUTHORS its own source (content + experience) → a distributor adopts it → the storefront runs the
// SOURCE's experience (cascade). Also checks the seeded source's experience cascades. Run: node scripts/source-entity.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0; function chk(n, ok, d){ if(ok){P++;console.log('  ✓ '+n+(d?'  '+d:''));}else{F++;console.log('  ✗ '+n+(d?'  — '+d:''));} }
async function api(m,p,o){o=o||{};const h={'Content-Type':'application/json'};if(o.token)h.Authorization='Bearer '+o.token;const r=await fetch(B+p,{method:m,headers:h,body:o.body?JSON.stringify(o.body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,j};}
async function tokenFor(name){ const email=name+'@test.com'; const reg=await api('POST','/api/entities/register',{body:{email}}); const v=await api('POST','/api/entities/verify',{body:{email,otp:reg.j&&reg.j.dev_otp}}); const me=await api('GET','/api/entities/me',{token:v.j&&v.j.token}); return { token:v.j&&v.j.token, id:(me.j&&me.j.entity||{}).identity_id, bridge:(me.j&&me.j.entity||{}).bridge_id }; }
(async()=>{
  console.log('== SOURCE-AS-ENTITY + EXPERIENCE ==\n');
  const ts = Date.now().toString().slice(-6);
  const brand = await tokenFor('rp-'+ts);
  const key = 'royale-play-'+ts+'@v1';
  const exp = { visualize:{enabled:true,label:'Scan your home',effect:'wall-recolor',max_renders:5}, detail:{live_combination_swap:true}, rules:{order_routing:'nearest_distributor'} };
  const items = [{ name:'Tussar', texture_family:'weave', region:'East', effect:['luminous'], scale:'single big wall', sheen:'metallic', tools:['trowel'], coats:'1 base + 2 effect',
    combinations:[{name:'Silk Route',colours:[{name:'Raw Silk',hex:'#C9A86A'},{name:'Bronze Glow',hex:'#8C6B3F'}]}] }];
  const author = await api('PUT','/api/assist/catalogue-source',{token:brand.token,body:{ source_key:key, title:'Royale Play — authored', collection:'Taana Baana', items, experience:exp, commercials_fields:[{key:'price_per_litre',label:'Price / litre',type:'money'}] }});
  if (author.status === 503) { console.log('  · b78 not applied yet (503) — apply migration b78, then re-run.'); console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(0); }
  chk('brand authored its own source', author.status===200 && author.j && author.j.authored, 'status '+author.status);
  chk('source stamped owner = the brand entity', author.j && String(author.j.owner_entity_id)===String(brand.id));

  const got = await api('GET','/api/assist/catalogue-source/'+encodeURIComponent(key));
  chk('read back: owner + experience present', got.j && String(got.j.owner_entity_id)===String(brand.id) && got.j.experience && got.j.experience.visualize && got.j.experience.visualize.enabled===true);

  // A distributor adopts the brand's source, prices it, exposes it → storefront runs the SOURCE experience.
  const dist = await tokenFor('dist-'+ts);
  await api('POST','/api/assist/catalogue-adopt',{token:dist.token,body:{source:key,commercials:{Tussar:{price_per_litre:1100}}}});
  const store = await api('GET','/api/catalogue/'+dist.bridge);
  const fin = (store.j&&store.j.finishes||[]).find(x=>x.source===key);
  chk('distributor storefront carries the SOURCE experience (cascade)', fin && fin.experience && fin.experience.visualize && fin.experience.visualize.enabled===true);
  chk('storefront item runs under its SOURCE (owner stamped)', fin && String(fin.owner_entity_id)===String(brand.id), fin&&fin.owner_entity_id);

  // Seeded source cascade (b78 UPDATE seeded experience on beta-royale-play@v1).
  const d2 = await tokenFor('d2-'+ts);
  await api('POST','/api/assist/catalogue-adopt',{token:d2.token,body:{source:'beta-royale-play@v1',commercials:{Tussar:{price_per_litre:950}}}});
  const s2 = await api('GET','/api/catalogue/'+d2.bridge);
  const f2 = (s2.j&&s2.j.finishes||[]).find(x=>x.source==='beta-royale-play@v1');
  chk('seeded source experience also cascades', f2 && f2.experience && f2.experience.visualize && f2.experience.visualize.enabled===true);

  console.log('\n== RESULT ==  PASS '+P+'  ·  FAIL '+F); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
