/* till-menu-steady.cjs — THE HUB HOLDS ITS PLACE, AND A PRESS IS ACKNOWLEDGED ([TILL-83])
 * Athi: "we have jumping problem in the menu, when i click an icon, not sure where it is and what the response is."
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
 const p=await b.newPage({viewport:{width:1500,height:900}});
 const threw=[];p.on('pageerror',e=>threw.push(e.message));
 await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
 await p.waitForFunction(()=>typeof window.setMode==='function',null,{timeout:30000});
 await p.evaluate(()=>{ window.S={shop:{country: 'IN', name:'X'},items:[],offers:[],at:new Date().toISOString()}; setMode('sell'); });
 await p.click('[data-testid="till-side-open"]');
 await p.waitForSelector('#tillmenu',{state:'visible',timeout:5000});

 /**
  * ⚠️⚠️ PRESS A HEADING YOU CAN SEE. That is the complaint: paintMenu() replaces every child of the scroller,
  * the browser resets scrollTop to 0, and scrollIntoView + focus() then measure from a top the reader was
  * nowhere near. Measured before the fix: 300 in, 0 out, the heading moving 338 -> 638.
  */
 let worst = 0;
 for (let pass = 0; pass < 3; pass++) {
   const t = await p.evaluate(() => {
     const box = menuScroller(); box.scrollTop = 300;
     const br = box.getBoundingClientRect();
     const btn = Array.from(document.querySelectorAll('[data-testid^="till-msec-btn-"]'))
       .find(x => { const r = x.getBoundingClientRect(); return r.top > br.top + 10 && r.bottom < br.bottom - 10; });
     return btn ? { id: btn.dataset.testid, top: Math.round(btn.getBoundingClientRect().top) } : null;
   });
   if (!t) break;
   await p.click('[data-testid="' + t.id + '"]');
   await p.waitForTimeout(200);
   const a = await p.evaluate((id) => {
     const btn = document.querySelector('[data-testid="' + id + '"]');
     return { scroll: Math.round(menuScroller().scrollTop), top: btn ? Math.round(btn.getBoundingClientRect().top) : null };
   }, t.id);
   const moved = Math.abs(a.scroll - 300);
   worst = Math.max(worst, moved);
   console.log('press ' + (pass+1) + '   · ' + t.id.replace('till-msec-btn-','') + ' y=' + t.top + ' -> ' + a.top + '  scroll moved ' + moved + 'px');
 }
 console.log('steady   · worst move ' + worst + 'px' + (worst <= 40 ? '  OK the hub holds its place' : '  ✗ JUMPING'));
 if (worst > 40) process.exitCode = 1;

 /* ⭐ and a press on the strip is acknowledged at the icon, whether or not the action opens anything */
 const ack = await p.evaluate(() => {
   const btn = document.querySelector('[data-testid="till-side-bills"]');
   if (!btn) return 'no refresh icon';
   btn.click();
   return btn.classList.contains('hit') ? 'acknowledged' : 'SILENT';
 });
 console.log('press    · the Bills icon — ' + ack + (ack === 'acknowledged' ? '  OK' : '  ✗'));

 if(threw.length){console.log('THREW · '+threw.join(' | '));process.exitCode=1;}
 await b.close();srv.close();
})();
