/* till-combo.cjs — THE COMBO CHOOSER, DRIVEN THE WAY A CASHIER DRIVES IT ([TILL-82])
 *
 * design-combo/ opens by quoting our own button back at us: "Choose Choose a tiffin and Choose a drink".
 * This asserts the four things that fixed — and ⚠️ presses the 1–9 keys through the REAL KEYBOARD, because a
 * hotkey that is printed on a card and not wired is the exact fault this run exists to catch.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const MEALS={item_id:'m1',name:'Tiffin Combo',code:'C1',category:'Combo',unit:'plate',price:120,
  modifiers:[{name:'Choose a tiffin',required:true,max:1,options:[{name:'Idli',price:0},{name:'Masala Dosa',price:15},{name:'Pongal',price:0}]},
             {name:'Choose a drink',required:true,max:1,options:[{name:'Filter Coffee',price:0},{name:'Tea',price:0}]},
             {name:'Anything with it?',max:2,options:[{name:'Vada',price:25},{name:'Sweet',price:30}]}]};
const VADA={item_id:'v1',name:'Vada',code:'V1',category:'Tiffin',unit:'no',price:25};
let bad=0;
const say=(l,ok,d)=>{console.log(l.padEnd(9)+'· '+d+'  '+(ok?'OK':(bad++,'✗ FAILED'))); };
(async()=>{
 const srv=http.createServer((q,r)=>{const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html';const f=path.join(ROOT,rel);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,r));
 const b=await chromium.launch();
 const p=await b.newPage({viewport:{width:1500,height:1000},deviceScaleFactor:2});
 const threw=[];p.on('pageerror',e=>threw.push(e.message));
 await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
 await p.waitForFunction(()=>typeof window.modOpen==='function'&&!!window.CBVariant,null,{timeout:30000});
 await p.evaluate(({m,v})=>{ window.S={shop:{country: 'IN', name:'Mayur Bhavan',currency:'INR'},items:[m,v],offers:[],at:new Date().toISOString()};
   setMode('sell');
   /* ⚠️ Vada is OFF TODAY — the spec says show it struck through, not hide it, so staff know why it is gone */
   try{ ls.set(shopLs('cb_till_qsold'), JSON.stringify([{id:'v1',day:bizDay()}])); }catch(_){}
 },{m:MEALS,v:VADA});
 await p.evaluate((m)=>modOpen(m,1),MEALS);
 await p.waitForSelector('#moddlg[open]',{timeout:5000});

 /* ── 1 · never a dead button ──────────────────────────────────────────────────────────────────────── */
 let s=await p.evaluate(()=>({t:document.getElementById('modadd').textContent.trim(),
   off:document.getElementById('modadd').disabled}));
 say('button', !s.off && /^Pick a tiffin to start$/.test(s.t), 'live, and reads "'+s.t+'"');

 /* ── 2 · the words on each group ──────────────────────────────────────────────────────────────────── */
 const g=await p.$$eval('#modbody .modg>b',n=>n.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
 say('groups', /one of these/.test(g[0]) && /waiting for a pick/.test(g[0]) && /skip if not/.test(g[2]),
   g.map(x=>'"'+x+'"').join('  '));

 /* ── 3 · sold out is SHOWN, from the same list the keys use ───────────────────────────────────────── */
 const out=await p.$$eval('#modbody .modopt.out',n=>n.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
 say('sold out', out.length===1 && /Vada/.test(out[0]) && /sold out today/.test(out[0]), out.join(',')||'(none shown)');

 /* ── 4 · ⚠️⚠️ THE HOTKEY, THROUGH THE REAL KEYBOARD ───────────────────────────────────────────────── */
 const hk=await p.$$eval('#modbody [data-hk]',n=>n.map(x=>x.getAttribute('data-hk')+'='+x.querySelector('.mn').textContent));
 console.log('keys     · '+hk.join('  '));
 await p.keyboard.press('2');                                   /* 2 = Masala Dosa, +₹15 */
 await p.keyboard.press('4');                                   /* 4 = Filter Coffee     */
 s=await p.evaluate(()=>({picks:Object.keys(MOD_PICK).map(k=>(MOD_PICK[k][0]||{}).option).filter(Boolean).join('+'),
   t:document.getElementById('modadd').textContent.trim()}));
 say('pressed', s.picks==='Masala Dosa+Filter Coffee', '2 then 4 -> '+(s.picks||'(nothing happened)'));
 say('now', /^Add to bill · ₹135\.00$/.test(s.t), 'the button reads "'+s.t+'"');

 /* ⚠️ a sold-out option must not wear a number at all, or a key lands on something unpickable */
 const outhk=await p.$$eval('#modbody .modopt.out[data-hk]',n=>n.length);
 say('no key', outhk===0, 'sold-out options carry no hotkey');

 await p.screenshot({path:path.join(__dirname,'shots','till-combo.png')});
 await p.click('[data-testid="till-mod-add"]');
 const line=await p.evaluate(()=>({n:CART.length,net:billMoney().net,k:CART[0]&&CART[0].key}));
 say('added', line.n===1 && line.net===135, '1 line, ₹'+line.net+', key '+line.k);

 if(threw.length) console.log('⚠️ threw: '+threw.join(' | '));
 console.log(bad?('\n'+bad+' FAILED'):'\nall good — the chooser answers the keyboard');
 await b.close(); srv.close(); process.exit(bad?1:0);
})();
