/* gov-zone-first — M196: the time zone decides the country; the language only when the zone is ambiguous. Node only, no browser. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const pub=path.join(__dirname,'..','public');
const ctx={};ctx.globalThis=ctx;ctx.window=ctx;
const vm=require('vm');vm.createContext(ctx);
for(const f of ['engine/locale.js','engine/govcontext.js']){ if(fs.existsSync(path.join(pub,f))) vm.runInContext(fs.readFileSync(path.join(pub,f),'utf8'),ctx); }
/* ONE rule, in the engine (CBGov.countryOf, engines v1.33.0): the page keeps no workaround of its own */
const html=fs.readFileSync(path.join(pub,'app.html'),'utf8');
assert.ok(!html.includes('function govRead('),'app.html must not carry a second country rule');
function run(tz,lang){ return ctx.CBGov.read({language:lang,languages:[lang],timeZone:tz,screenW:1280,screenH:900,dpr:1,coarsePointer:false,uaMobile:null,platform:'',touchPoints:0,online:true}); }
let c=run('Asia/Calcutta','en-US'); assert.strictEqual(c.country.value,'IN'); assert.strictEqual(c.currency&&c.currency.value||c.money&&c.money.value,'INR'); assert.strictEqual(c.language.value,'en');
c=run('Asia/Dubai','en-US'); assert.strictEqual(c.country.value,'AE');
c=run('Europe/Helsinki','en-US'); assert.strictEqual(c.country.value,'US');   // ambiguous zone → language
console.log('gov-zone-first ok');
