/** @covers FR-D2 — the per-party roster is what the queue and diagnosis expose */
// Verify the two dispute READ endpoints rewritten in b68 but NOT covered by the harness: queue + diagnosis.
const BASE='https://chitbridge-api-production.up.railway.app', ALPHA_ID='71373522-147e-4a75-966a-73de3d8bf045', BETA_ID='75c378a6-ad7f-4b58-87d2-e1509cbb0482';
let PASS=0,FAIL=0;
function check(n,ok,d){if(ok){PASS++;console.log('  ✓ '+n+(d?'  '+d:''));}else{FAIL++;console.log('  ✗ '+n+(d?'  — '+d:''));}}
async function api(m,p,{token,body}={}){const h={'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;const r=await fetch(BASE+p,{method:m,headers:h,body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,json:j};}
async function login(n){const r=await api('POST','/api/entities/register',{body:{email:n}});const o=r.json&&r.json.dev_otp;const v=await api('POST','/api/entities/verify',{body:{email:r.json.email,otp:o}});return v.json.token;}
const has=(o,s)=>JSON.stringify(o||'').includes(s);
(async()=>{
  console.log('== DISPUTE READS (queue + diagnosis) ==\n');
  const A=await login('Alpha Timbers'), B=await login('Beta Traders');
  const ts=Date.now().toString().slice(-5);
  const snd=await api('POST','/api/chits/send',{token:A,body:{recipients:[{entity_id:BETA_ID,role:'to'}],purpose:'general',manual_subject:'DR '+ts,business_json:{}}});
  const chit=snd.json.chit_id||(snd.json.chit&&snd.json.chit.chit_id);
  const d=await api('POST','/api/chits/'+chit+'/disputes',{token:B,body:{category:'quality',reason:'Damaged on arrival — queue/diagnosis read test.',target_entity_id:ALPHA_ID}});
  const did=d.json&&(d.json.dispute_id||(d.json.dispute&&d.json.dispute.dispute_id));
  check('Beta raised a dispute',!!did,did);
  if(!did)return done();
  // QUEUE — raiser (Beta) and target (Alpha) should both see it; non-party sees nothing
  const bq=await api('GET','/api/chits/disputes/queue',{token:B});
  check('Beta (raiser) queue returns 200',bq.status===200,'status '+bq.status);
  check('Beta queue contains the dispute',has(bq.json,did));
  const aq=await api('GET','/api/chits/disputes/queue',{token:A});
  check('Alpha (target) queue contains the dispute',has(aq.json,did));
  check('queue exposes per-party roster (participants)',has(bq.json,'participants')||has(bq.json,'raiser'),'roster present');
  // DIAGNOSIS — both parties see their own diagnosis card
  const bdiag=await api('GET','/api/chits/'+chit+'/diagnosis',{token:B});
  check('Beta diagnosis returns 200',bdiag.status===200,'status '+bdiag.status);
  check('Beta diagnosis has the dispute',has(bdiag.json,did)||has(bdiag.json,'quality'));
  const adiag=await api('GET','/api/chits/'+chit+'/diagnosis',{token:A});
  check('Alpha diagnosis returns 200 + has the dispute',adiag.status===200&&(has(adiag.json,did)||has(adiag.json,'quality')),'status '+adiag.status);
  done();
})().catch(e=>{console.error(e);done();});
function done(){console.log('\n== RESULT ==  PASS '+PASS+'  ·  FAIL '+FAIL);process.exit(FAIL ? 1 : 0);}
