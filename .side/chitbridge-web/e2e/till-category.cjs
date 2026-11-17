/* till-category.cjs — THE CATEGORY, SHOWN LIKE A QUICK KEY ([TILL-71])
 * Athi: "category also to be showcased like quick key format... with images if the option chosen,
 *        then the quick key product to be sorted based on category... give a break as a line break."
 */
'use strict';
const { chromium } = require('@playwright/test');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const PIC='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="%23c96"/></svg>');
const ITEMS=[
 {item_id:'i1',name:'Idli (2 pc)',code:'T1',category:'Idli',unit:'plate',price:40,image:PIC},
 {item_id:'i2',name:'Ghee Podi Idli',code:'T2',category:'Idli',unit:'plate',price:70},
 {item_id:'i3',name:'Sambar Idli',code:'T3',category:'Idli',unit:'plate',price:60},
 {item_id:'d1',name:'Plain Dosa',code:'T4',category:'Dosa',unit:'plate',price:55,image:PIC},
 {item_id:'d2',name:'Masala Dosa',code:'T5',category:'Dosa',unit:'plate',price:70},
 {item_id:'d3',name:'Ghee Roast Dosa',code:'T6',category:'Dosa',unit:'plate',price:95},
 {item_id:'c1',name:'Filter Coffee',code:'T7',category:'Drinks',unit:'cup',price:25},
];
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
 await p.evaluate((items)=>{
   window.S={shop:{country: 'IN', name:'Mayur Bhavan',currency:'INR'},items:items,offers:[],at:new Date().toISOString()};
   const o=tillOpt(); o.groups={'Morning':items.map(x=>x.item_id)};
   tillOptSet({groups:o.groups, group:'Morning', quickSource:'groups'});
   screenSet({photos:true});
   setMode('sell');
 }, ITEMS);
 await p.waitForSelector('[data-testid="till-bycat"]',{timeout:5000});

 const flat=await p.evaluate(()=>({heads:document.querySelectorAll('.qcat').length,
   tiles:document.querySelectorAll('#quick .sk-tile,#quick button[data-testid^="till-quick-"]').length}));
 console.log('flat      · headings='+flat.heads+' tiles='+flat.tiles+(flat.heads===0?'  OK ungrouped by default':'  ✗'));

 /* ⚠️ DRIVE THE CONTROL a shopkeeper would press */
 await p.click('[data-testid="till-bycat"]');
 const grp=await p.evaluate(()=>{
   const kids=Array.from(document.getElementById('quick').children);
   const order=[]; kids.forEach(k=>{ if(k.classList.contains('qcat')) order.push('== '+k.textContent.trim()); });
   /* the heading must actually END the row: its computed grid-column spans every track */
   const h=document.querySelector('.qcat');
   return { heads:document.querySelectorAll('.qcat').length, order:order,
            span:h?getComputedStyle(h).gridColumnStart+'/'+getComputedStyle(h).gridColumnEnd:'-',
            /* ⚠️⚠️ MOVED, NOT DELETED. This read kids[0], and the first child of #quick is the TOOLBAR
               (.qbar) — it moved inside the grid after this harness was written, so the check has been
               failing on correct code. The rule it protects is unchanged: a category heading OPENS the
               first group. The answer is the first child that is not the toolbar. */
            firstIsHead: (()=>{ const k=kids.filter(c=>!c.classList.contains('qbar'));
              return k.length ? k[0].classList.contains('qcat') : false; })() };
 });
 console.log('grouped   · headings='+grp.heads+' span='+grp.span+' · '+grp.order.join('  '));
 console.log('          · first child is a heading='+grp.firstIsHead+((grp.heads===3&&grp.firstIsHead)?'  OK three breaks':'  ✗'));

 /* the ORDER inside a category must be untouched */
 const inner=await p.evaluate(()=>Array.from(document.querySelectorAll('#quick .sk-tile,#quick button[data-testid^="till-quick-"]'))
   .map(x=>(x.textContent||'').trim().split('\n')[0]).slice(0,7));
 console.log('order     · '+inner.join(' | '));

 /**
  * ⚠️⚠️ AND THE CHIPS FOLLOW THE *LIST* SWITCH, NOT THE KEYS' ([TILL-80]). This harness set
  * screenSet({photos:true}) — the QUICK KEYS' pictures — and then asserted the chips carried one. They
  * stopped following that switch when the chips were moved to follow the list they sit above and filter,
  * so the check has been failing on correct behaviour ever since. Drive the one function that owns it.
  */
 await p.evaluate(()=>{ if(!thumbsOn()) thumbsToggle(); paintChips(); });
 await p.waitForTimeout(150);
 /* category chips with pictures */
 const chips=await p.evaluate(()=>{
   const withPic=Array.from(document.querySelectorAll('#chips button.haspic')).map(x=>x.textContent.replace(/\s+/g,' ').trim());
   return { n:withPic.length, sample:withPic.slice(0,3).join(' / '),
            img:!!document.querySelector('#chips .cpic .pic') };
 });
 console.log('chips     · with a picture='+chips.n+' hasImage='+chips.img+' · '+chips.sample+(chips.n>=3?'  OK':'  ✗'));

 const shot=path.join(__dirname,'shots','by-category.png');
 fs.mkdirSync(path.dirname(shot),{recursive:true});
 await p.screenshot({path:shot}); console.log('wrote '+shot);
 if(threw.length){console.log('THREW · '+threw.join(' | '));process.exitCode=1;}
 await b.close();srv.close();
})();
