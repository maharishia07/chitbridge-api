// Prove cancel-as-request: sender voids → sender's OWN copy = void, recipient's copy UNTOUCHED, recipient gets a
// flagged "[cancel requested]" message and decides for itself.
const BASE='https://chitbridge-api-production.up.railway.app', BETA_ID='75c378a6-ad7f-4b58-87d2-e1509cbb0482';
let PASS=0,FAIL=0;
function check(n,ok,d){if(ok){PASS++;console.log('  ✓ '+n+(d?'  '+d:''));}else{FAIL++;console.log('  ✗ '+n+(d?'  — '+d:''));}}
async function api(m,p,{token,body}={}){const h={'Content-Type':'application/json'};if(token)h.Authorization='Bearer '+token;const r=await fetch(BASE+p,{method:m,headers:h,body:body?JSON.stringify(body):undefined});let j=null;try{j=await r.json();}catch(_){}return{status:r.status,json:j};}
async function login(n){const r=await api('POST','/api/entities/register',{body:{email:n}});const o=r.json&&r.json.dev_otp;const v=await api('POST','/api/entities/verify',{body:{email:r.json.email,otp:o}});return v.json.token;}
function statusOf(inboxJson,chit){const rows=(inboxJson&&(inboxJson.chits||inboxJson.rows))||[];const r=rows.find(x=>x.chit_id===chit);return r&&r.current_status;}
(async()=>{
  console.log('== CANCEL-AS-REQUEST ==\n');
  const A=await login('Alpha Timbers'), B=await login('Beta Traders');
  const ts=Date.now().toString().slice(-5);
  const snd=await api('POST','/api/chits/send',{token:A,body:{recipients:[{entity_id:BETA_ID,role:'to'}],purpose:'general',manual_subject:'CANCELREQ '+ts,business_json:{}}});
  const chit=snd.json.chit_id||(snd.json.chit&&snd.json.chit.chit_id);
  check('Alpha sent a chit to Beta',!!chit,chit);
  if(!chit)return done();
  // Beta accepts → Beta's status = accepted
  await api('PUT','/api/chits/'+chit+'/status',{token:B,body:{status:'accepted'}});
  // Alpha VOIDS (cancel request)
  const v=await api('PUT','/api/chits/'+chit+'/void',{token:A,body:{reason:'ordered by mistake'}});
  check('Alpha void accepted',v.status===200,'status '+v.status+' '+JSON.stringify(v.json).slice(0,100));
  // Alpha's OWN copy = void
  const aSent=await api('GET','/api/chits/sent',{token:A});
  check('Alpha OWN copy is void',statusOf(aSent.json,chit)==='void','alpha status '+statusOf(aSent.json,chit));
  // Beta's copy UNTOUCHED — still accepted, NOT void (sender did not mutate it)
  const bIn=await api('GET','/api/chits/inbox',{token:B});
  const bStatus=statusOf(bIn.json,chit);
  check('Beta copy UNTOUCHED by the sender (still accepted, not void)',bStatus==='accepted',(bStatus||'not in inbox'));
  // Beta sees the flagged cancel request in its thread
  const bMsgs=await api('GET','/api/chits/'+chit+'/messages',{token:B});
  check('Beta sees the flagged [cancel requested] message',JSON.stringify(bMsgs.json||'').includes('[cancel requested]'));
  done();
})().catch(e=>{console.error(e);done();});
function done(){console.log('\n== RESULT ==  PASS '+PASS+'  ·  FAIL '+FAIL);process.exit(0);}
