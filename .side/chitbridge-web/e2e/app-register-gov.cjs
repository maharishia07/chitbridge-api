/* app-register-gov.cjs — REGISTRATION FILLS IN THE GOVERNANCE LAYER, ASKS, AND FINDS THE COUNTER ([REG-2..4])
 * Drives the real screens with a stubbed API: no account is created anywhere.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
(async()=>{
 const srv=http.createServer((q,r)=>{const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html';const f=path.join(ROOT,rel);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,r));
 const base='http://127.0.0.1:'+srv.address().port;
 const b=await chromium.launch();
 let sent=null;

 /* ⭐ an Indian browser: the case the derive engine is built for */
 const ctxOpts={ viewport:{width:1280,height:900}, locale:'en-IN', timezoneId:'Asia/Kolkata' };
 const bc=await b.newContext(ctxOpts);
 const p=await bc.newPage();
 const threw=[];p.on('pageerror',e=>threw.push(e.message));
 /* stub only the two calls registration makes */
 await p.route('**/api/entities/register', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({email:'shop@example.in'})}));
 await p.route('**/api/constitutions', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({constitutions:[{key:'base',name:'Base',is_default:true}]})}));
 /* CS1: after verify the app goes to Country setup, which reads the step's own answer (stubbed: an Indian shop, the step still to do) */
 await p.route('**/api/governance/country-setup', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({migrated:true,done:false,required:true,country:{code:'IN',name:'India'},currency:'INR',fy_start_month:4,tax:{registered:false,number:null,scheme:null},source:{},pack:{id:'IN',version:'1.0.0',books:true,code:null,why:null}})}));
 await p.route('**/api/entities/verify', async r=>{ sent=JSON.parse(r.request().postData()||'{}');
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'t.t.t',entity:{display_name:'Test Shop'}})}); });

 await p.goto(base+'/app.html#/register');
 await p.waitForSelector('[data-testid="reg-name"]',{timeout:15000});
 await p.fill('[data-testid="reg-name"]','mayurbhavan');
 await p.fill('[data-testid="reg-email"]','shop@example.in');
 await p.click('[data-testid="reg-submit"]');
 await p.waitForSelector('[data-testid="reg-gov"]',{timeout:8000});

 const rows=await p.evaluate(()=>Array.from(document.querySelectorAll('[data-testid^="reg-gov-"]'))
   .map(x=>x.dataset.testid.replace('reg-gov-','')+'='+x.querySelector('.gv').textContent.trim()));
 console.log('derived   · '+rows.join('  '));

 /* ⚠️⚠️ THE GATE: verify must be refused until the box is ticked */
 const gated=await p.evaluate(()=>document.getElementById('r_go').disabled);
 console.log('gate      · verify disabled before agreeing = '+gated+(gated?'  OK':'  ✗ NOT GATED'));

 await p.click('[data-testid="reg-agree"]');
 await p.fill('[data-testid="reg-otp"]','123456');
 const open=await p.evaluate(()=>document.getElementById('r_go').disabled);
 console.log('          · after agreeing, disabled = '+open+(open?'  ✗':'  OK'));
 await p.click('[data-testid="reg-submit"]');
 await p.waitForFunction(()=>location.hash.indexOf('country')>=0 || location.hash.indexOf('app')>=0 || document.querySelector('[data-testid="reg-tocounter"]'),null,{timeout:8000});
 /* ⭐ CS1: a NEW shop lands on Country setup, prefilled from the time zone with its source */
 await p.waitForSelector('[data-testid="cs-rows"]',{timeout:8000});
 const cs=await p.evaluate(()=>({country:document.querySelector('[data-testid="cs-val-country"]').textContent.trim(), src:document.querySelector('[data-testid="cs-src-country"]').textContent.trim()}));
 console.log('country   · after verify: Country setup · '+cs.country+' · from '+cs.src+(/India/.test(cs.country)?'  OK':'  ✗'));

 const c=(sent&&sent.context)||{};
 console.log('sent      · country='+c.country+' currency='+c.currency_code+' tz='+c.timezone
   +' device='+((c.device&&c.device.type)||'?')+' agreed_at='+(sent&&sent.agreed_at?'yes':'NO'));
 console.log('          · ip in payload = '+(c.ip!==undefined)+(c.ip===undefined?'  OK the browser sends none':'  ✗'));
 await bc.close();

 /* ⭐⭐ AND A PAIRED DEVICE GOES TO ITS TILL */
 const bc2=await b.newContext(ctxOpts);
 const p2=await bc2.newPage();
 p2.on('pageerror',e=>threw.push('paired: '+e.message));
 /* ⚠️ 2026-09-28 — THE FIXTURE MOVED WITH THE RULE. Since d8c2c117 ("the counter that opens must be the shop you signed
    in as") the app offers the till only when the stored key's shop (cb_till_entity) IS the signed-in shop (read from
    the session token's payload). The old fixture — token 't.t.t', no shop on the key — could never qualify, so this
    step timed out for days. An unsigned token that names a shop, and a key recorded for that same shop; nothing leaves
    the page (the API is stubbed). */
 await p2.addInitScript(()=>{ try{
   const b64=(o)=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
   const tok=b64({alg:'none'})+'.'+b64({identity_id:'ent-test-shop',identity_type:'entity',exp:Math.floor(Date.now()/1000)+3600})+'.x';
   localStorage.setItem('cb_till_key','CB-TEST-KEY'); localStorage.setItem('cb_till_entity','ent-test-shop');
   localStorage.setItem('cb_sess', JSON.stringify({token:tok,role:'entity',name:'Test Shop'})); }catch(_){} });
 await p2.goto(base+'/app.html#/app');
 await p2.waitForSelector('[data-testid="reg-tocounter"]',{timeout:8000});
 console.log('paired    · a counter device is offered its till  OK');
 /* ⚠️ and refusing must stick, or the owner can never reach the back office on that machine */
 await p2.click('[data-testid="reg-stay"]');
 await p2.waitForFunction(()=>!document.querySelector('[data-testid="reg-tocounter"]'),null,{timeout:8000});
 await p2.evaluate(()=>{ location.hash='#/app'; });
 await p2.waitForTimeout(600);
 const stayed=await p2.evaluate(()=>!document.querySelector('[data-testid="reg-tocounter"]') && !/till\.html/.test(location.href));
 console.log('refusal   · stays in ChitBridge after saying so = '+stayed+(stayed?'  OK':'  ✗ TRAPPED ON THE TILL'));

 if(threw.length){console.log('THREW · '+threw.join(' | '));process.exitCode=1;}
 await b.close();srv.close();
})();
