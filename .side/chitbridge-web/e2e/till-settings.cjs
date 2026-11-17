/* till-settings.cjs — ⚙ SETTINGS OPENS AND SAVES, AND NOTHING VISUAL IS IN TWO PLACES ([TILL-81])
 * Athi: "there are duplication in menu and in settings, is it deliberate? can you merge if not?"
 * ⚠️ A guard reads the file as TEXT. Only running the page finds a null dereference, which is exactly what
 *    removing the Screen tab left behind in openSettings() and saveSettings().
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
 const b=await chromium.launch();
 const p=await b.newPage({viewport:{width:1500,height:1000}});
 const threw=[];p.on('pageerror',e=>threw.push(e.message));
 await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
 await p.waitForFunction(()=>typeof window.openSettings==='function',null,{timeout:30000});
 await p.evaluate(()=>{ window.S={shop:{country: 'IN', name:'Mayur Bhavan',currency:'INR'},items:[],offers:[],at:new Date().toISOString()}; setMode('sell'); });

 /* ⚠️⚠️ IT MUST OPEN. An unguarded .value on a removed control throws here. */
 const opened=await p.evaluate(()=>{ try{ openSettings(); return 'ok'; }catch(e){ return 'THREW: '+e.message; } });
 console.log('open      · '+opened+(opened==='ok'?'':'  ✗'));
 const tabs=await p.evaluate(()=>Array.from(document.querySelectorAll('[role=tab]')).map(t=>t.textContent.trim()));
 console.log('tabs      · '+tabs.join(' · ')
   +(tabs.indexOf('Screen')<0?'  OK the Screen tab is gone':'  ✗ STILL THERE'));

 /* ⚠️⚠️ AND IT MUST SAVE. */
 const saved=await p.evaluate(async()=>{ try{ await saveSettings(); return 'ok'; }catch(e){ return 'THREW: '+e.message; } });
 console.log('save      · '+saved+(saved==='ok'?'':'  ✗'));

 /* ⭐ nothing visual has two controls: each store has exactly one place that writes it */
 const dupes=await p.evaluate(()=>{
   const ids=['set_theme','set_preset','set_tile','set_photos','set_shape','set_fs','set_rows','set_layout','mq_theme','mq_layout'];
   return ids.filter(id=>!!document.getElementById(id));
 });
 console.log('duplicates· '+(dupes.length?dupes.join(', ')+'  ✗ STILL PRESENT':'none  OK every visual control has one home'));

 /* ⭐ and "What shows" is in the hub, named for what it does */
 await p.evaluate(()=>{ document.getElementById('setdlg').close(); });
 await p.click('[data-testid="till-side-open"]');
 await p.waitForSelector('#tillmenu',{state:'visible',timeout:5000});
 await p.click('[data-testid="till-msec-btn-look"]');
 await p.waitForSelector('[data-testid="till-mq-shows"]',{state:'visible',timeout:5000});
 const shows=await p.evaluate(()=>{
   const s=document.getElementById('mq_shows');
   return s.value+' · '+Array.from(s.options).map(o=>o.textContent).join('/');
 });
 console.log('what shows· '+shows+'  OK in the hub beside its chips');

 if(threw.length){console.log('THREW · '+threw.join(' | '));process.exitCode=1;}
 await b.close();srv.close();
})();
