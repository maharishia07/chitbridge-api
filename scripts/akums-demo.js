// scripts/akums-demo.js — CDMO (Akums-style) recall DEMONSTRATION. Runs on the live engine.
//
// The gold demo showed MASS-BALANCE (out vs in). This shows the OTHER muscle a CDMO needs: SURGICAL, CONFIDENTIAL
// RECALL. A contract manufacturer makes rival brands side-by-side. A contaminated raw material (whey) enters and is
// used in SOME brands' lots. When it's found bad, the question is: exactly which brands & lots got it — WITHOUT
// exposing any brand to another (per-brand confidentiality is standard NDA), and with a trail no one can quietly alter.
//
// THE NERVE (same idea as gold): no single party can answer this alone. The whey supplier can't see downstream; each
// brand can't see the others (or even that the whey was shared); only the CDMO, walking the co-held chain, gets the
// exact recall set. Without it: a contamination scare across 1,500 brands = a blanket recall, and investigating means
// exposing rivals to each other. With it: exactly Brand A lot 7 + Brand C lot 3, in seconds; Brand B correctly cleared;
// each brand told only about itself.
//
// Concept proof on realistic data — NOT a proof on real manufacturing data (that's the pilot). Never sell it as live proof.
//
// Run:  TEST_URL=https://chitbridge-api-production.up.railway.app node scripts/akums-demo.js

require('dotenv').config();
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const C = { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', dim:'\x1b[2m', z:'\x1b[0m', bold:'\x1b[1m', cyan:'\x1b[36m' };
const results = [];
const ok = (t) => { console.log(`   ${C.g}✔${C.z} ${t}`); results.push(true); };
const no = (t) => { console.log(`   ${C.r}✘${C.z} ${t}`); results.push(false); };

async function api(method, path, body, token){
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const res = await fetch(`${BASE_URL}${path}`, { method,
    headers:{ 'Content-Type':'application/json', ...(token && { Authorization:`Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }) });
  let data={}; try{ data=await res.json(); }catch(_){}
  return { status:res.status, data };
}

// register -> verify -> token. Email must be slug-safe (verify runs strict .isEmail()); label kept as display_name.
async function mint(label){
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const email=`akums-${slug}-${Date.now()}-${Math.floor(Math.random()*1e5)}@test-cb.com`;
  const reg=await api('POST','/api/entities/register',{ display_name:label, email });
  const otp=reg.data.dev_otp||'123456';
  const v=await api('POST','/api/entities/verify',{ email, otp });
  if(v.status!==200) throw new Error(`verify ${label}: ${v.status}`);
  return { id:v.data.entity.identity_id, token:v.data.token, name:label };
}

// One handoff (material or finished lot). `qty` in kg. Returns {status, chit_id}.
async function ship(from, to, { qty, parents, is_origin, product, note }, operatorId){
  const r=await api('POST','/api/chits/send',{
    receivers:[{entity_id:to.id}], purpose:'delivery_note', manual_subject:`${from.name} -> ${to.name}`,
    line_items:[{ name: note || product, quantity:qty, unit:'kg', price:0, total:0 }],
    trace:{ parents, is_origin, product, qty, unit:'kg', network:{ id:'akums-cdmo', operator:operatorId } },
  }, from.token);
  if(r.status!==200) throw new Error(`ship ${from.name}->${to.name}: ${r.status} ${r.data.message||''}`);
  return { status:r.status, chit_id:r.data.chit_id };
}

// Forward "recall" walk: everything reachable downstream from an origin, as seen by `who`.
async function recallSet(originId, who){
  const w = await api('GET', `/api/chits/${originId}/trace?dir=forward`, null, who.token);
  return { httpStatus:w.status, ids:new Set((w.data.nodes||[]).map(n=>n.chit_id)), count:(w.data.nodes||[]).length };
}
// Can `who` see this chit at all?
async function canSee(chitId, who){
  const w = await api('GET', `/api/chits/${chitId}/trace?dir=forward`, null, who.token);
  return w.status===200 && (w.data.nodes||[]).some(n=>n.chit_id===chitId);
}

function h(t){ console.log(`\n${C.bold}${C.cyan}${t}${C.z}`); }

async function main(){
  console.log(`${C.bold}── AKUMS CDMO · SURGICAL RECALL ──${C.z}  ${C.dim}(live engine @ ${BASE_URL})${C.z}`);
  console.log(`${C.dim}Rival brands made under one roof. Which lots got the bad batch — without exposing any brand to another?${C.z}`);
  console.log(`${C.dim}Concept proof on realistic data, not a live-data proof.${C.z}`);
  if((await api('GET','/health')).status!==200){ no('API health'); return done(); }

  h('[1] The CDMO network (real, RLS-isolated entities)');
  const OP=await mint('Akums · compliance (operator)'), PROD=await mint('Akums · production'),
        WHEY=await mint('Nutra Whey Supplier'),
        A=await mint('Brand A — ProteinPlus'), B=await mint('Brand B — PureGold'), Cc=await mint('Brand C — MaxWhey');
  const op=OP.id;
  console.log(`   operator=${C.bold}Akums compliance${C.z} | plant=Akums production | supplier=${WHEY.name}`);
  console.log(`   rival brands (blind to each other): ${A.name}, ${B.name}, ${Cc.name}`);

  h('[2] A contaminated raw material enters — and is used in SOME brands, not all');
  const oBad   = (await ship(WHEY, PROD, { qty:500, is_origin:true, product:'WHEY-B7',  note:'whey lot B-7 (CONTAMINATED — aflatoxin)' }, op)).chit_id;
  const oClean = (await ship(WHEY, PROD, { qty:500, is_origin:true, product:'WHEY-C2',  note:'whey lot C-2 (clean)' }, op)).chit_id;
  // Akums manufactures finished lots. A & C drew from the bad whey; B drew from the clean whey.
  const lotA = (await ship(PROD, A,  { qty:120, parents:[oBad],   product:'PROTEINPLUS-L7', note:'ProteinPlus lot 7' }, op)).chit_id;
  const lotC = (await ship(PROD, Cc, { qty:90,  parents:[oBad],   product:'MAXWHEY-L3',     note:'MaxWhey lot 3' }, op)).chit_id;
  const lotB = (await ship(PROD, B,  { qty:150, parents:[oClean], product:'PUREGOLD-L9',    note:'PureGold lot 9' }, op)).chit_id;
  const label = { [lotA]:'Brand A · ProteinPlus lot 7', [lotC]:'Brand C · MaxWhey lot 3', [lotB]:'Brand B · PureGold lot 9' };
  console.log(`   whey lot ${C.r}B-7 (bad)${C.z} → ProteinPlus L7, MaxWhey L3      ${C.dim}[2 rival brands]${C.z}`);
  console.log(`   whey lot ${C.g}C-2 (clean)${C.z} → PureGold L9`);

  h('[3] The OLD world — contamination found, but which of 1,500 brands got it?');
  console.log(`   ${C.dim}No cross-party trail → you can't tell which brands/lots used lot B-7. Options: a BLANKET recall`);
  console.log(`   (pull everything, ruin trust) — or investigate, which means exposing rival brands to each other.${C.z}`);

  h('[4] Recall walk — the CDMO traces lot B-7 forward (the only party who can)');
  const rc = await recallSet(oBad, OP);
  const hitA = rc.ids.has(lotA), hitC = rc.ids.has(lotC), hitB = rc.ids.has(lotB);
  if (hitA && hitC && !hitB){
    ok(`exact recall set from lot B-7 → ${C.bold}${label[lotA]}${C.z} + ${C.bold}${label[lotC]}${C.z}`);
    console.log(`      ${C.g}✔ Brand B (PureGold lot 9) correctly CLEARED — it used the clean whey.${C.z}`);
    console.log(`      ${C.dim}Surgical, not blanket: exactly the affected lots, in one walk, no investigation.${C.z}`);
  } else no(`recall set wrong — A:${hitA} C:${hitC} B:${hitB} (expected A✓ C✓ B✗)`);

  h('[5] Confidentiality — each brand told only about ITSELF; no brand sees another');
  const aSeesC = await canSee(lotC, A);      // Brand A trying to see Brand C's lot
  const aSeesWhey = await canSee(oBad, A);   // Brand A trying to see the shared whey batch
  if (!aSeesC) ok(`Brand A cannot see Brand C's lot — rival isolation holds`);
  else no(`Brand A should NOT see Brand C's lot`);
  if (!aSeesWhey) ok(`Brand A cannot even see the shared whey batch (nor that a rival used it)`);
  else no(`Brand A should NOT see the shared whey batch`);
  console.log(`   ${C.dim}So Akums notifies Brand A about lot 7 and Brand C about lot 3 — neither learns the other was hit.${C.z}`);

  h('[6] Co-held & tamper-evident');
  console.log(`   ${C.dim}Every whey→lot edge is frozen and co-held (supplier/plant/brand/operator each hold a copy).`);
  console.log(`   The recall trail can't be quietly edited after the fact — the finding stands.${C.z}`);

  done();
}

function done(){
  const pass=results.filter(Boolean).length, bad=results.filter(r=>!r).length;
  console.log(`\n${'═'.repeat(62)}`);
  if(!bad) console.log(`  ${C.g}${C.bold}SURGICAL RECALL${C.z} — exact lots from one bad batch, ${C.bold}without exposing any brand to another${C.z}.`);
  else     console.log(`  ${C.r}${C.bold}${bad} CHECK(S) FAILED${C.z}  (${pass} passed)`);
  console.log(`  ${C.dim}The whey supplier can't see downstream; brands can't see each other; only the CDMO holds the whole chain.${C.z}`);
  console.log(`${'═'.repeat(62)}`);
  process.exit(bad?1:0);
}
main().catch(e=>{ console.error(`${C.r}crashed:${C.z} ${e.message}`); process.exit(1); });
