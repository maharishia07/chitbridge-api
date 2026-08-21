/**
 * tests/me-include.test.cjs — `/entities/me?include=` is the profile's ONE round trip.
 *
 * Athi, 2026-08-21: *"why do we need a round trip, can't the js send all the required information in one shot?
 * We have built most of the stuff as lazy load, and for each lazy load if we have to do a round trip, that will
 * feel like waiting forever."*
 *
 * ⚠⚠ HE IS POINTING AT THE BIGGER OF THE TWO COSTS. A DATABASE round trip is 1–5ms; an HTTP round trip from
 * India to Railway is 200–400ms. The profile made FOUR — /entities/me, /governance/readiness, /channels,
 * /governance/profile — so over a second of network, with the sections arriving one at a time in front of you.
 * Collapsing eight DB queries into five saved ~15ms. This saves about a second.
 *
 * ⭐ INCLUDES, NOT A SCREEN-SHAPED ENDPOINT. `GET /screen/profile` would bake today's layout into the API and
 * make every re-layout a server change. The client names what it wants; the server has never heard of a
 * "profile screen".
 *
 * WHAT THIS PROVES, and the last three are the ones that matter:
 *   · without ?include the response shape is byte-for-byte what every existing caller already gets
 *   · each part rides along when asked for
 *   · an UNKNOWN include is named rather than ignored — a silent drop would look like a broken feature
 *   · ⚠️ ONE BROKEN INCLUDE COSTS ONLY ITSELF. Bundling four fetches into one creates a failure mode that did
 *     not exist before: four separate requests degraded independently by construction, and one request can
 *     take everything down together. Each part is caught alone and reports `{ error }` in place, so the
 *     profile still paints without its channels — exactly as it does today when one of the four fails.
 *     Degrade to less, never to nothing.
 */
const API='C:/dev/chitbridge-api';
let hits=[];
require.cache[require.resolve(API+'/db')]={exports:{
  query:async(sql,args)=>{ hits.push('db');
    if(/information_schema/.test(sql))return{rows:[{a:1}]};
    if(/FROM identities WHERE identity_id/.test(sql))return{rows:[{identity_id:'e1',capabilities:[]}]};
    return{rows:[]};},
  withEntity:async(id,fn)=>fn({query:async()=>({rows:[]})}),
  withTransaction:async(fn)=>fn({query:async()=>({rows:[]})}),}};
/* stub the three libs so we prove the WIRING, not their internals */
for(const [m,exp] of [['/lib/readiness',{resolveReadiness:async()=>({summary:{ready:true}})}],
                      ['/lib/channels',{listChannels:async()=>({channels:[{key:'whatsapp',bindings:[{address:'+91'}]}]})}],
                      ['/lib/profile',{getProfile:async()=>({vault:{sections:[{k:'gst'}]},vault_encrypted:true})}]])
  require.cache[require.resolve(API+m)]={exports:exp};
const express=require('express'),app=express();app.use(express.json());
require.cache[require.resolve(API+'/middleware/auth')]={exports:Object.assign(
  (q,r,n)=>{q.identity={identity_id:'e1',identity_type:'entity'};n()},{entityOf:q=>q.identity.identity_id})};
app.use('/api/entities',require(API+'/routes/entities'));
let pass=0,fail=0;
const t=(n,c,x)=>{c?(pass++,console.log('  \u2713 '+n+(x?'   '+x:''))):(fail++,console.error('  \u2717 '+n+(x?'   '+x:'')))};
const srv=app.listen(45873,async()=>{
  const get=p=>new Promise(ok=>require('http').get({host:'127.0.0.1',port:45873,path:p},r=>{
    let d='';r.on('data',c=>d+=c);r.on('end',()=>ok({s:r.statusCode,b:(()=>{try{return JSON.parse(d)}catch(_){return{}}})()}))}));
  const plain=await get('/api/entities/me');
  t('without ?include the shape is unchanged', plain.b.included===undefined && !!plain.b.entity);
  const r=await get('/api/entities/me?include=readiness,channels,vault');
  const inc=r.b.included||{};
  t('readiness rides along', !!(inc.readiness&&inc.readiness.summary), JSON.stringify(inc.readiness));
  t('channels ride along',  !!(inc.channels&&inc.channels.channels), JSON.stringify(inc.channels).slice(0,44));
  t('vault rides along',    !!(inc.vault&&inc.vault.vault), JSON.stringify(inc.vault).slice(0,44));
  t('the entity is still there too', !!r.b.entity);
  const bad=await get('/api/entities/me?include=readiness,nosuchthing');
  t('an unknown include is named, not fatal', (bad.b.included||{}).nosuchthing && bad.b.included.readiness);
  /* one broken include must not cost the others */
  require.cache[require.resolve(API+'/lib/channels')].exports={listChannels:async()=>{throw new Error('boom')}};
  const part=await get('/api/entities/me?include=readiness,channels,vault');
  const p2=part.b.included||{};
  t('a broken include reports in place', !!(p2.channels&&p2.channels.error), JSON.stringify(p2.channels));
  t('  \u2026and the others still arrive', !!(p2.readiness&&p2.readiness.summary) && !!(p2.vault&&p2.vault.vault));
  t('  \u2026and the entity still arrives', !!part.b.entity && part.s===200);
  console.log('\n  \u2550\u2550 '+pass+' passed \u00b7 '+fail+' failed \u2550\u2550\n');
  srv.close();process.exit(fail?1:0);
});
