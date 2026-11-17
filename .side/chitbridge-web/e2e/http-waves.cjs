/**
 * e2e/http-waves.cjs — which network calls a screen makes IN SEQUENCE, and which overlap.
 *
 * ⚠⚠⚠ THIS TOOL EXISTS BECAUSE IT CAUGHT ME OVERSTATING A WIN. I measured the profile at "four HTTP round
 * trips" and told Athi it cost "over a second", by COUNTING CALL SITES. Counting is not measuring: three of
 * those four were kicked off by the renderer without being awaited, so they overlapped each other. The real
 * shape was TWO waves — /me, then trade ∥ channels ∥ vault — not four in a line. Bundling them was still
 * right (one wave, one connection, less server work), but roughly HALVED the wait rather than quartering it.
 *
 * ⭐ THE DISTINCTION IS THE WHOLE POINT: `await api(x)` costs a full round trip of wall clock; `const p =
 * api(x)` started and awaited later costs nothing extra, because it flies alongside its neighbours. A browser
 * runs six connections per origin, so parallel calls are close to free — unlike the server-side pool, where
 * parallelism has a real budget (see tools/round-trips.cjs).
 *
 * ⚠️ STILL STATIC, AND STILL NOT A STOPWATCH. It reads whether the `await` is on the call, not how long the
 * server takes. It answers "is this a wave or a queue", which is the question that decides what to fix — and
 * is the question I answered wrongly by eye.
 */
/* SEQUENTIAL vs PARALLEL — a call that is awaited on the spot costs a full round trip of wall clock;
   one started into a variable and awaited later overlaps with its neighbours. */
const fs=require('fs'),path=require('path');
const W='C:/dev/chitbridge-web/public';
const files=[path.join(W,'app.html'),...fs.readdirSync(path.join(W,'app')).filter(f=>f.endsWith('.js')).map(f=>path.join(W,'app',f))];
const clean=files.map(f=>fs.readFileSync(f,'utf8')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g,' ').split('\n').map(L=>{const i=L.indexOf('//');return i<0?L:L.slice(0,i)}).join('\n');
const body=fn=>{const i=clean.indexOf('function '+fn+'(');if(i<0)return null;
  let j=clean.indexOf('{',i),d=0,k=j;for(;k<clean.length;k++){const c=clean[k];if(c==='{')d++;else if(c==='}'){d--;if(d===0)break;}}
  return clean.slice(i,k+1);};
const classify=(b)=>{
  const out=[];
  const re=/(await\s+)?(?:api\(\s*['"]([a-zA-Z0-9_]+)['"]|fetch\(\s*CFG\.API_BASE\s*\+\s*'([^']+)')/g;
  let m; while((m=re.exec(b))) out.push({name:m[2]||m[3], seq:!!m[1]});
  return out;
};
const show=(label,fns)=>{
  console.log('\n  '+label+'\n');
  let seq=0,par=0;
  for(const f of fns){ const b=body(f); if(!b){console.log('    '+f.padEnd(18)+'(not found)');continue;}
    const c=classify(b);
    seq+=c.filter(x=>x.seq).length; par+=c.filter(x=>!x.seq).length;
    console.log('    '+f.padEnd(18)+c.map(x=>(x.seq?'SEQ ':'par ')+x.name).join('  ')||'    '+f);
  }
  console.log('\n    '+seq+' awaited on the spot (a full round trip each)  ·  '+par+' started and awaited later (overlap)');
};
show('CHIT SCREEN', ['loadList','openChit']);
show('PROFILE',     ['loadProfile','iamLoadTrade','iamLoadChannels','loadVault']);
