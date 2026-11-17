/**
 * e2e/type-scale.cjs — the app's REAL type scale, against the one the tokens declare.
 *
 * ⚠⚠⚠ M12b WAS WRITTEN AS A MECHANICAL SWEEP AND IT IS NOT ONE. The backlog said "collapse 25 distinct
 * sizes onto the existing --fs-* scale" — measured, only **9 of 1,042** raw declarations match a token
 * exactly. Swapping the other 1,033 would resize 656 of them DOWN and 377 UP, the largest by 39%. That is not
 * tokenisation, it is a visual redesign of every screen, and it is Athi's call rather than a sweep.
 *
 * ⭐⭐ THE REAL FINDING IS THAT THERE ARE TWO SCALES AND NEITHER KNOWS ABOUT THE OTHER:
 *     declared   11 · 12.5 · 14 · 16 · 20 · 28      (--fs-1..6, and 1,392 uses obey it)
 *     actual     11.5 · 12 · 13 · 13.5 · 15 · 17    (953 of 1,036 raw declarations)
 * They were designed independently and never reconciled. Every raw declaration is someone choosing a size by
 * eye because the token nearest to what they wanted was two steps away.
 *
 * ⚠️ AND THE COST IS NOT COSMETIC EITHER WAY. appearanceApply() scales the --fs-* tokens on <html>, so
 * `var(--fs-1)` grows with the reader's Small/Medium/Large/Extra-large setting and a raw `11.5px` does not.
 * 1,033 declarations ignore a reader who set Extra large — invisible until someone needs it, which is the
 * worst kind of accessibility failure.
 *
 * Read-only. Prints both options with their real numbers so the decision can be made on evidence.
 */
const fs=require('fs'),path=require('path');
const W='C:/dev/chitbridge-web/public';
const files=[path.join(W,'app.html'),...fs.readdirSync(path.join(W,'app')).filter(f=>f.endsWith('.js')).map(f=>path.join(W,'app',f))];
const raw={}; let rawTotal=0, tokTotal=0;
for(const f of files){ const s=fs.readFileSync(f,'utf8');
  for(const m of s.matchAll(/font-size: *([0-9.]+)px/g)){ const v=parseFloat(m[1]); raw[v]=(raw[v]||0)+1; rawTotal++; }
  tokTotal += (s.match(/var\(--fs-[0-9]\)/g)||[]).length;
}
/**
 * ⚠️⚠️ READ THE SCALE, DO NOT RESTATE IT. This was `[11,12.5,14,16,20,28]` written out by hand, and the moment
 * display steps were added the guard was measuring against a scale the app no longer had — reporting 36px and
 * 46px as strays from a list that now contains them, and printing a header naming six sizes when there are
 * eight.
 *
 * ⭐ A CHECK THAT HARDCODES WHAT IT CHECKS IS A SECOND SOURCE OF TRUTH, and it drifts exactly like the legend
 * that fell one flag behind every time someone added a chip. `FS_BASE` is where appearanceApply reads the
 * scale, so it is the one that is true by construction.
 */
const fsSrc = fs.readFileSync(path.join(__dirname,'..','public','app','avatar.js'),'utf8');   /* FS_BASE moved here from app.html with the rest of the appearance code */
const fsDecl = (fsSrc.match(/var FS_BASE = \{([^}]*)\}/)||[])[1] || '';
const SCALE = [...fsDecl.matchAll(/:\s*([0-9.]+)/g)].map(m=>parseFloat(m[1])).sort((a,b)=>a-b);
if(!SCALE.length){ console.error('  ✗ could not read FS_BASE from app/avatar.js — this report would be fiction'); process.exit(1); }
const nearest=v=>SCALE.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a);
let unchanged=0, shrink=0, grow=0, worst=0;
Object.entries(raw).forEach(([v,n])=>{ v=parseFloat(v); const t=nearest(v);
  if(t===v) unchanged+=n; else if(t<v) shrink+=n; else grow+=n;
  worst=Math.max(worst, Math.abs(t-v)/v);
});
console.log('\n  A · MOVE THE CODE TO THE TOKENS  (scale stays '+SCALE.join(' · ')+')\n');
console.log('    '+rawTotal+' raw declarations  ->  '+unchanged+' unchanged, '+shrink+' get SMALLER, '+grow+' get BIGGER');
console.log('    largest single jump: '+Math.round(worst*100)+'%   (and '+tokTotal+' existing token uses are untouched)');

/* B — what if the scale matched what the app actually uses? */
const top=Object.entries(raw).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([v,n])=>({v:parseFloat(v),n}));
console.log('\n  B · MOVE THE TOKENS TO THE CODE  (the six sizes the app actually uses most)\n');
top.forEach(t=>console.log('    '+(t.v+'px').padEnd(9)+String(t.n).padStart(4)+' declarations'));
const covered=top.reduce((s,t)=>s+t.n,0);
console.log('\n    a scale of '+top.map(t=>t.v).sort((a,b)=>a-b).join(' \u00b7 ')+' would make '+covered+' of '+rawTotal+' EXACT');
console.log('    \u26a0 but it re-sizes all '+tokTotal+' existing var(--fs-*) uses, which are the ones that already work');
