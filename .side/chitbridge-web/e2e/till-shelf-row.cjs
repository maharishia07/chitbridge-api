/* till-shelf-row.cjs — NOTHING IN A SHELF ROW MAY WRAP ONTO ITS OWN LINE ([TILL-92])
 *
 * Athi, 2026-09-19: "if i click photos on the product list + sign comes below."
 *
 * A CSS grid never complains that it is short a column — it wraps, silently, and the row doubles in height.
 * Three separate rules had the wrong column count (the left-hand mouse exemption, and both narrow-screen
 * rules), and only ONE of the sixteen combinations showed it to Athi. So this measures all sixteen:
 * two widths x two modes x two hands x photos on/off. [[feedback-shoot-the-screen-not-the-dom]]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..','public');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const ITEMS=[{item_id:'a1',name:'Filter Coffee',code:'D1',category:'Drinks',unit:'cup',price:25,image:'x.png'},
             {item_id:'a2',name:'Gulab Jamun',code:'S1',category:'Sweets',unit:'piece',price:45,image:'y.png'}];
(async()=>{
 const srv=http.createServer((q,r)=>{const rel=decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html';const f=path.join(ROOT,rel);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('no');}
  r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,r));
 const b=await chromium.launch();
 let bad=0;
 for (const w of [1600, 390])
 for (const mode of ['sell','maintain'])
 for (const hand of ['right','left'])
 for (const pics of [false,true]) {
   const p=await b.newPage({viewport:{width:w,height:1000}});
   await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
   await p.waitForFunction(()=>typeof window.paintHits==='function',null,{timeout:30000});
   await p.evaluate(({items,hand,pics,mode})=>{
     window.S={shop:{country: 'IN', name:'Mayur Bhavan',currency:'INR'},items:items,offers:[],at:new Date().toISOString()};
     setMode(mode);
     ls.set('cb_till_hand',hand); ls.set(shopLs('cb_till_thumbs'), pics?'on':'off');
     applyLook(); paintHits();
   },{items:ITEMS,hand,pics,mode});
   await p.waitForTimeout(220);
   const m=await p.evaluate(()=>{
     const row=document.querySelector('.hit'); if(!row) return null;
     const name=row.querySelector('b')||row.querySelector('.ht')||row.children[row.children.length>3?2:0]; if(!name) return {none:1};
     const n=name.getBoundingClientRect(), r=row.getBoundingClientRect();
     /* ⚠️ EVERY child, not just the +: anything that drops below the name is the same fault */
     const below=[...row.children].filter(c=>{const q=c.getBoundingClientRect();
       return q.height>0 && q.top >= n.bottom - 1;}).map(c=>c.className||c.tagName);
     return { h:Math.round(r.height), cols:getComputedStyle(row).gridTemplateColumns.split(' ').length,
              kids:[...row.children].filter(c=>c.getBoundingClientRect().height>0).length, below };
   });
   const tag=(w+'px '+mode+' '+hand+' photos '+(pics?'on':'off')).padEnd(34);
   if(!m) { console.log(tag+'no rows'); }
   else if(m.none) { console.log(tag+'no name'); }
   else console.log(tag+String(m.h).padStart(3)+'px · '+m.cols+' cols / '+m.kids+' children · '
     +(m.below.length?('WRAPPED: '+m.below.join(', ')):'all on one line  OK'));
   if(m && m.below && m.below.length) bad++;
   await p.close();
 }
 console.log(bad ? ('\n' + bad + ' of 16 WRAP') : '\nall sixteen keep the row on one line');
 await b.close(); srv.close(); process.exit(bad?1:0);
})();
