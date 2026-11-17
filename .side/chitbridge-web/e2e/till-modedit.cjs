/* till-modedit.cjs — CAN A CASHIER CHANGE "mild" TO "hot" WITHOUT DELETING THE LINE? ([TILL-70])
 * Athi, 2026-09-19: "once you added, you do not have a way of edit the choice."
 * Drives the CONTROLS: the key, the dialog, the choices on the row.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const DOSA={item_id:'d1',name:'Masala Dosa',code:'T1',category:'Tiffin',unit:'plate',price:70,
  modifiers:[{name:'Spice',required:true,max:1,options:[{name:'Mild',price:0},{name:'Medium',price:0},{name:'Hot',price:0}]},
             {name:'Extra',max:2,options:[{name:'Paneer',price:20},{name:'Cheese',price:15}]}]};
(async()=>{
 const srv=http.createServer((q,r)=>{const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html';const f=path.join(ROOT,rel);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,r));
 const b=await chromium.launch();
 const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
 const threw=[];p.on('pageerror',e=>threw.push(e.message));
 await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
 await p.waitForFunction(()=>typeof window.setMode==='function'&&!!window.CBSearch,null,{timeout:30000});
 await p.evaluate((d)=>{ window.S={shop:{country: 'IN', name:'Mayur Bhavan',currency:'INR'},items:[d],offers:[],at:new Date().toISOString()};
   setMode('sell'); addItem(d,1,[{group:'Spice',option:'Mild',price:0}]); price(); }, DOSA);
 const before=await p.evaluate(()=>({mods:CART[0].mods.map(m=>m.option).join('+'),key:CART[0].key,lines:CART.length,net:billMoney().net}));
 console.log('added    · '+before.mods+'  key='+before.key+'  lines='+before.lines+'  total='+before.net);

 /* ⚠️ DRIVE THE CONTROL a cashier would press: the choices printed on the row */
 await p.click('[data-testid="till-mods-0"]');
 await p.waitForSelector('#moddlg[open]',{timeout:4000});
 const dlg=await p.evaluate(()=>({btn:document.getElementById('modadd').textContent,
   title:document.getElementById('modtitle').textContent,
   ticked:Array.from(document.querySelectorAll('#modbody .on,#modbody [aria-pressed="true"]')).map(x=>x.textContent.trim()).join(',')}));
 console.log('dialog   · button="'+dlg.btn+'" title="'+dlg.title+'" seeded="'+dlg.ticked+'"');

 /* change Mild -> Hot, add Paneer */
 await p.evaluate(()=>{ modToggle(0,2); modToggle(1,0); });
 await p.click('[data-testid="till-mod-add"]');
 const after=await p.evaluate(()=>({mods:(CART[0].mods||[]).map(m=>m.option).join('+'),key:CART[0].key,
   lines:CART.length,qty:CART[0].qty,net:billMoney().net}));
 console.log('edited   · '+after.mods+'  key='+after.key+'  lines='+after.lines+'  total='+after.net
   +((after.mods==='Hot+Paneer'&&after.lines===1)?'  OK edited in place':'  FAILED'));

 /* ⚠️⚠️ AND THE MERGE: a second Mild dosa, edited to Hot+Paneer, must join the first line */
 await p.evaluate((d)=>{ addItem(d,1,[{group:'Spice',option:'Mild',price:0}]); price(); }, DOSA);
 const two=await p.evaluate(()=>CART.length);
 await p.click('[data-testid="till-mods-1"]');
 await p.waitForSelector('#moddlg[open]',{timeout:4000});
 await p.evaluate(()=>{ modToggle(0,2); modToggle(1,0); });
 await p.click('[data-testid="till-mod-add"]');
 const merged=await p.evaluate(()=>({lines:CART.length,qty:CART[0].qty,mods:(CART[0].mods||[]).map(m=>m.option).join('+')}));
 console.log('merge    · was '+two+' lines -> '+merged.lines+' line of '+merged.qty+' ('+merged.mods+')'
   +((merged.lines===1&&merged.qty===2)?'  OK merged':'  FAILED'));

 /* ⚠️ and Cancel must keep the line exactly as it was */
 await p.click('[data-testid="till-mods-0"]');
 await p.waitForSelector('#moddlg[open]',{timeout:4000});
 await p.evaluate(()=>{ modToggle(0,0); modClose(); });
 const kept=await p.evaluate(()=>({lines:CART.length,qty:CART[0].qty,mods:(CART[0].mods||[]).map(m=>m.option).join('+')}));
 console.log('cancel   · '+kept.lines+' line of '+kept.qty+' ('+kept.mods+')'
   +((kept.lines===1&&kept.qty===2&&kept.mods==='Hot+Paneer')?'  OK unchanged':'  FAILED'));

 /* ⚠️⚠️ THE SAME COMBINATION, PICKED IN A DIFFERENT ORDER, IS THE SAME LINE ([TILL-76]).
    Athi: "if the same choice is chosen again, it has to be added to the existing cart." Inside a group that
    allows more than one, pick order used to change the key — two identical pizzas on one bill. */
 const canon = await p.evaluate((d)=>{
   CART.length=0; CARTSEL=-1;
   addItem(d,1,[{group:'Extra',option:'Paneer',price:20},{group:'Extra',option:'Cheese',price:15}]);
   addItem(d,1,[{group:'Extra',option:'Cheese',price:15},{group:'Extra',option:'Paneer',price:20}]);
   price();
   return { lines:CART.length, qty:CART[0].qty, key:CART[0].key };
 }, DOSA);
 console.log('canonical · two pick orders -> '+canon.lines+' line of '+canon.qty+'  key='+canon.key
   +((canon.lines===1&&canon.qty===2)?'  OK one line':'  FAILED two lines for one combination'));

 /* ⚠️ ACROSS GROUPS TOO, not only within one. modChosen() happens to walk the groups in order, so this case
    was safe by accident — but a mod list restored from a parked draft or handed over by an API can arrive in
    any order at all, and the signature must not care. */
 const cross = await p.evaluate((d)=>{
   CART.length=0; CARTSEL=-1;
   addItem(d,1,[{group:'Spice',option:'Hot',price:0},{group:'Extra',option:'Paneer',price:20}]);
   addItem(d,1,[{group:'Extra',option:'Paneer',price:20},{group:'Spice',option:'Hot',price:0}]);
   price(); return { lines:CART.length, qty:CART[0].qty, key:CART[0].key };
 }, DOSA);
 console.log('cross-grp · either order -> '+cross.lines+' line of '+cross.qty+'  key='+cross.key
   +((cross.lines===1&&cross.qty===2)?'  OK':'  FAILED'));

 /* ⭐ and genuinely different choices stay two lines */
 const diff = await p.evaluate((d)=>{
   CART.length=0; CARTSEL=-1;
   addItem(d,1,[{group:'Spice',option:'Medium',price:0}]);
   addItem(d,1,[{group:'Spice',option:'Hot',price:0}]);
   price(); return CART.length;
 }, DOSA);
 console.log('distinct  · medium and hot -> '+diff+' lines'+((diff===2)?'  OK':'  FAILED'));

 const shot=path.join(__dirname,'shots','mod-edit.png');
 fs.mkdirSync(path.dirname(shot),{recursive:true});
 await p.screenshot({path:shot}); console.log('wrote '+shot);
 if(threw.length){console.log('THREW · '+threw.join(' | '));process.exitCode=1;}
 await b.close();srv.close();
})();
