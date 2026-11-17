/* till-todo.cjs — TO DO AS ITS OWN THING ([TILL-79])
 * Athi: "a separate popup for list and edit, a separate item in the menu, reminder if possible."
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
 const p=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:2});
 const threw=[];p.on('pageerror',e=>threw.push(e.message));
 await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
 await p.waitForFunction(()=>typeof window.setMode==='function'&&typeof window.todoOpen==='function',null,{timeout:30000});
 await p.evaluate(()=>{ window.S={shop:{country: 'IN', name:'Mayur Bhavan',currency:'INR'},items:[],offers:[],at:new Date().toISOString()}; setMode('sell'); });

 /* ⭐ it is its own item on the strip */
 const onStrip=await p.evaluate(()=>!document.querySelector('[data-testid="till-side-todo"]'));
 console.log('menu item · off the rail (tidy: six icons), in the Menu = '+onStrip+(onStrip?'  OK':'  ✗'));
 await p.evaluate(()=>{ openMenuAt('day'); }); await p.click('[data-testid="till-open-todo"]');
 await p.waitForSelector('#tododlg[open]',{timeout:5000});
 console.log('popup     · opened from the strip  OK');

 /* ⭐⭐ QUICK ADD THAT READS THE SENTENCE */
 for (const line of ['bank the cash tomorrow 4pm','order milk','call the supplier today 9:30']) {
   await p.fill('[data-testid="till-todo-add"]', line);
   await p.click('[data-testid="till-todo-save"]');
 }
 const rows=await p.evaluate(()=>Array.from(document.querySelectorAll('#todobody .todorow')).map(r=>{
   const t=r.querySelector('.tt'); if(!t) return '';
   const w=t.querySelector('.tw');
   return t.childNodes[0].textContent.trim()+(w?'  ['+w.textContent.trim()+']':'  [no due]');
 }));
 rows.forEach(r=>console.log('          · '+r));

 /* ⚠️ a sentence it cannot read must be left ALONE, not mangled */
 await p.fill('[data-testid="till-todo-add"]','pay 2 invoices');
 await p.click('[data-testid="till-todo-save"]');
 const untouched=await p.evaluate(()=>{
   const last=Array.from(document.querySelectorAll('#todobody .todorow')).pop();
   return last.querySelector('.tt').childNodes[0].textContent.trim();
 });
 console.log('unparsed  · "'+untouched+'"'+(untouched==='pay 2 invoices'?'  OK left alone':'  ✗ MANGLED'));

 /* ⭐ EDIT IN PLACE */
 await p.click('#todobody .todorow .tt');
 await p.waitForSelector('[data-testid="till-todo-edit"]',{timeout:4000});
 await p.fill('[data-testid="till-todo-edit"]','bank the cash tomorrow 5pm');
 await p.press('[data-testid="till-todo-edit"]','Enter');
 const edited=await p.evaluate(()=>{
   const r=document.querySelector('#todobody .todorow');
   return r.querySelector('.tt').childNodes[0].textContent.trim()+' / '+(r.querySelector('.tw')||{}).textContent;
 });
 console.log('edit      · '+edited);

 /* ⭐ tick one, and done goes quiet */
 await p.click('#todobody .todorow input[type=checkbox]');
 const after=await p.evaluate(()=>({open:document.querySelectorAll('#todobody > .todolist .todorow').length,
   done:!!document.querySelector('.tododone'), count:document.getElementById('todocount').textContent,
   badge:(document.querySelector('[data-testid="till-side-todo"] .sbadge')||{}).textContent||'-'}));
 console.log('tick      · open='+after.open+' doneSection='+after.done+' header="'+after.count+'" stripBadge='+after.badge);

 /* ⚠️⚠️ THE REMINDER IS IN THE APP — no browser permission is ever requested */
 const asks=await p.evaluate(()=>{
   const src=document.documentElement.innerHTML;
   return /Notification\s*\.\s*requestPermission/.test(src);
 });
 console.log('reminder  · asks browser permission = '+asks+(asks?'  ✗':'  OK in-app only'));

 const shot=path.join(__dirname,'shots','todo.png');
 fs.mkdirSync(path.dirname(shot),{recursive:true});
 await p.screenshot({path:shot}); console.log('wrote '+shot);
 if(threw.length){console.log('THREW · '+threw.join(' | '));process.exitCode=1;}
 await b.close();srv.close();
})();
