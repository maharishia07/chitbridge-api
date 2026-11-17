/* till-keysize.cjs — THE PREVIEW MUST COUNT WHAT THE COUNTER COUNTS ([TILL-93])
 *
 * design-style2/key-size-spec.md §2: "Store a smallest tile width, never a number of columns." The REAL grid
 * has always obeyed that — repeat(auto-fill, minmax(--key-min,1fr)) — but the studio miniature drew a stored
 * LAYOUTS[].keysPerRow, so it showed a count the counter never produces, and the badge and the "what changes"
 * line both quoted it.
 *
 * ⚠️ This is the only check that can catch that: render the REAL key grid at a device size, count its columns,
 * and ask styleFit() — what the preview and the badge use — for the same number. Sixteen combinations, four
 * widths x four key sizes, and EXACT equality, because a badge that is close is a badge that lies.
 * [[feedback-shoot-the-screen-not-the-dom]]
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
 let bad=0;
 for (const [w,h] of [[1600,900],[1280,800],[1024,768],[390,844]]) {
   const p=await b.newPage({viewport:{width:w,height:h}});
   await p.goto('http://127.0.0.1:'+srv.address().port+'/till.html');
   await p.waitForFunction(()=>typeof window.styleFit==='function',null,{timeout:30000});
   await p.evaluate(()=>{ window.S={shop:{country: 'IN', name:'M',currency:'INR'},items:[],offers:[],at:new Date().toISOString()}; setMode('sell'); });
   for (const k of ['xlarge','large','medium','small']) {
     const r = await p.evaluate((k)=>{
       keySizePick(k);
       const q=document.querySelector('.quick');
       const real=getComputedStyle(q).gridTemplateColumns.split(' ').filter(x=>x&&x!=='none').length;
       const pred=styleFit(CBScreen.resolve({}), {label:'x',w:window.innerWidth,h:window.innerHeight}).per;
       return {real:real, pred:pred, qw:Math.round(q.getBoundingClientRect().width)};
     },k);
     const ok = r.real===r.pred;
     if(!ok) bad++;
     console.log((w+'x'+h+' '+k).padEnd(22)+'real grid '+String(r.real).padStart(2)
       +'  preview says '+String(r.pred).padStart(2)+'   (key area '+r.qw+'px)  '+(ok?'agree':'✗ DISAGREE'));
   }
   await p.close();
 }
 console.log(bad ? ('\n' + bad + ' of 16 DISAGREE') : '\nall sixteen: the preview counts what the counter counts');
 await b.close(); srv.close(); process.exit(bad?1:0);
})();
