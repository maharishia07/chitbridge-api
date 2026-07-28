// scripts/gold-demo.js — Dubai gold "THE NERVE" demo (v2). Runs on the live engine.
//
// v1 mistake (Athi caught it): it starred the subtraction (950-800=150). That's trivial — a calculator does it.
// THE REAL POINT: in reality no single party holds both sides. The launderer's OWN books balance; the gap only
// appears when the input is INDEPENDENTLY attested by another party, co-held and frozen, so it can't be forged or
// "softened" (the Kaloti/Rihan failure: a UK court found DMCC+EY pressured the auditor to soften findings).
//
// This v2 shows the nerve, all on the real rail:
//   A. Self-reported world — Gulf Gold's own paperwork (a source IT vouches for "sent" 950g, it "refined" 950g)
//      BALANCES GREEN → a documentation-only audit passes it (the real OECD/DMCC audit weakness).
//   B. Co-held world — the mine (Sahel) INDEPENDENTLY attests 800g into Gulf Gold, frozen and co-held with the
//      operator. Gulf's 950g output must trace to that 800g input → the gap surfaces from SOMEONE ELSE'S number.
//      Same 950g output: GREEN on Gulf's own paper (950 in), RED on the mine's independent attestation (800 in).
//   C. Boxed in: can't ship output pointing at nothing (no-silent-holes, live reject); can't rewrite the mine's
//      co-held 800g (shown identical at mine + operator); rivals stay blind (live 404).
//
// The nerve = IN and OUT live with DIFFERENT parties, co-held + un-forgeable, so the gap surfaces even though no
// single party (not even the launderer) holds or controls both sides. Concept proof on realistic data — NOT a
// proof on a refiner's real data (that's the pilot). Never present it as a live proof.
//
// Run:  TEST_URL=https://chitbridge-api-production.up.railway.app node scripts/gold-demo.js

require('dotenv').config();
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const C = { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', dim:'\x1b[2m', z:'\x1b[0m', bold:'\x1b[1m', cyan:'\x1b[36m' };
const SPOT_USD_PER_OZ = 2900, G_PER_OZT = 31.1035;
const results = [];
const ok = (t) => { console.log(`   ${C.g}✔${C.z} ${t}`); results.push(true); };
const no = (t) => { console.log(`   ${C.r}✘${C.z} ${t}`); results.push(false); };
const usd = (g) => `~$${Math.round((g / G_PER_OZT) * SPOT_USD_PER_OZ).toLocaleString()}`;

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
  const email=`gold-${slug}-${Date.now()}-${Math.floor(Math.random()*1e5)}@test-cb.com`;
  const reg=await api('POST','/api/entities/register',{ display_name:label, email });
  const otp=reg.data.dev_otp||'123456';
  const v=await api('POST','/api/entities/verify',{ email, otp });
  if(v.status!==200) throw new Error(`verify ${label}: ${v.status}`);
  return { id:v.data.entity.identity_id, token:v.data.token, name:label };
}

// One gold handoff. fineG = FINE-GOLD grams (weight x fineness — the accountable quantity). Returns {status,chit_id}.
// strict=false lets callers inspect a rejected attempt instead of throwing (used for the no-silent-holes probe).
async function ship(from, to, { fineG, parents, is_origin, product, note }, operatorId, strict=true){
  const r=await api('POST','/api/chits/send',{
    receivers:[{entity_id:to.id}], purpose:'delivery_note', manual_subject:`${from.name} -> ${to.name}`,
    line_items:[{ name: note || product, quantity:fineG, unit:'g', price:0, total:0 }],
    trace:{ parents, is_origin, product, qty:fineG, unit:'g', network:{ id:'dxb-gold', operator:operatorId } },
  }, from.token);
  if(strict && r.status!==200) throw new Error(`ship ${from.name}->${to.name}: ${r.status} ${r.data.message||''}`);
  return { status:r.status, chit_id:r.data.chit_id, message:r.data.message||r.data.error };
}

// Walk forward from an origin node as `who`; return what that party can see about the node:
//   httpStatus, seen (is the node visible at all), qty (the frozen inbound fine-g), bal (balance obj or null=leaf-to-them).
async function view(originId, who){
  const w = await api('GET', `/api/chits/${originId}/trace?dir=forward`, null, who.token);
  const n = (w.data.nodes||[]).find(x=>x.chit_id===originId);
  return { httpStatus:w.status, seen:!!n, qty: n && n.base_qty, bal: n && n.balance };
}

function h(t){ console.log(`\n${C.bold}${C.cyan}${t}${C.z}`); }

async function main(){
  console.log(`${C.bold}── DUBAI GOLD · THE NERVE ──${C.z}  ${C.dim}(live engine @ ${BASE_URL})${C.z}`);
  console.log(`${C.dim}The point is NOT the subtraction. It's that no single party holds — or can forge — both sides.${C.z}`);
  console.log(`${C.dim}Concept proof on realistic data, not a live-data proof.${C.z}`);
  if((await api('GET','/health')).status!==200){ no('API health'); return done(); }

  h('[1] The bullion network (real, RLS-isolated entities)');
  const OP=await mint('DMCC Bullion Oversight'), SAHEL=await mint('Sahel Dore (mine)'),
        SELFSRC=await mint('Gulf self-declared source'), ALNOOR=await mint('Al Noor Refinery'),
        GULF=await mint('Gulf Gold DMCC'), VAULT=await mint('Emirates Vault');
  const op=OP.id;
  console.log(`   operator=${C.bold}${OP.name}${C.z} | mine=${SAHEL.name} | refiners: ${ALNOOR.name}, ${GULF.name} | sink=${VAULT.name}`);

  h('[2] The OLD world — a documentation audit (how Kaloti passed)');
  // Gulf's OWN paperwork: a source it vouches for "sent" 950g, Gulf "refined" 950g. Self-consistent → balances.
  const paperIn = (await ship(SELFSRC, GULF, { fineG:950, is_origin:true, product:'AU-DORE', note:'Gulf self-declared: source sent 950g' }, op)).chit_id;
  await           ship(GULF, VAULT, { fineG:950, parents:[paperIn], product:'AU-9999', note:'Gulf: refined 950g bars' }, op);
  const paperBal = (await view(paperIn, OP)).bal;
  if (paperBal && paperBal.status==='ok'){
    ok(`Gulf's OWN paperwork balances (in ${paperBal.in}g / out ${paperBal.out}g) → ${C.g}GREEN${C.z}. A documents-only audit PASSES it.`);
    console.log(`   ${C.dim}...but the "source" is Gulf's own assertion — provenance vouched-for, not independently proven.${C.z}`);
  } else no(`self-reported chain should balance green — got ${JSON.stringify(paperBal)}`);

  h('[3] Our world — the INPUT is independently attested by the mine, co-held & frozen');
  const oAl = (await ship(SAHEL, ALNOOR, { fineG:820, is_origin:true, product:'AU-DORE', note:'dore 1000g @82% = 820g fine' }, op)).chit_id;
  await        ship(ALNOOR, VAULT, { fineG:819.95, parents:[oAl], product:'AU-9999', note:'99.99% bars 819.95g (0.006% loss)' }, op);
  const oGulf = (await ship(SAHEL, GULF, { fineG:800, is_origin:true, product:'AU-DORE', note:'Sahel attests: 800g fine dore' }, op)).chit_id;
  console.log(`   Sahel → Al Noor: 820g fine  ${C.dim}[honest]${C.z}`);
  console.log(`   Sahel → Gulf Gold: ${C.bold}800g fine${C.z}  ${C.dim}[INDEPENDENT attestation, co-held by mine + operator]${C.z}`);

  h('[4] The launderer is boxed in — every escape route is closed by STRUCTURE, not an auditor');
  const conjure = await ship(GULF, VAULT, { fineG:950, parents:[], is_origin:false, product:'AU-9999', note:'950g from nowhere' }, op, false);
  if (conjure.status!==200) ok(`"conjure 950g from nothing" → ${C.r}BLOCKED${C.z} by the rail (${conjure.status}: no silent holes — output must trace to an input)`);
  else no(`no-silent-holes should have blocked the parent-less handoff — got ${conjure.status}`);
  console.log(`   ${C.dim}"inflate the 800g input" → impossible: that edge is Sahel's, co-held & frozen; Gulf can't reach into it.${C.z}`);
  // Only legal move: ship 950g output PARENTED to the real 800g input.
  await ship(GULF, VAULT, { fineG:950, parents:[oGulf], product:'AU-9999', note:'declared 950g bars (parented to the real 800g input)' }, op);
  console.log(`   → so Gulf's 950g output can only link to the real ${C.bold}800g${C.z} input.`);

  h('[5] Operator assembles the cross-party chain — the ONLY god\'s-eye view');
  const balAl = (await view(oAl, OP)).bal, balGulf = (await view(oGulf, OP)).bal;
  if (balAl && balAl.status==='ok') ok(`Al Noor    in ${balAl.in}g / out ${balAl.out}g → ${C.g}GREEN${C.z}`);
  else no(`Al Noor should be green — ${JSON.stringify(balAl)}`);
  if (balGulf && balGulf.status==='red' && Math.round(balGulf.delta)===150){
    ok(`Gulf Gold  in ${balGulf.in}g ${C.dim}(Sahel's number)${C.z} / out ${balGulf.out}g ${C.dim}(Gulf's claim)${C.z} → ${C.r}RED +${Math.round(balGulf.delta)}g${C.z}`);
    console.log(`      ${C.y}→ ${Math.round(balGulf.delta)}g ≈ ${(balGulf.delta/G_PER_OZT).toFixed(1)} oz (${usd(balGulf.delta)}). Same 950g output that was GREEN on Gulf's own paper.${C.z}`);
    console.log(`      ${C.dim}The ONLY thing that changed: IN came from Sahel (independent), not from Gulf's say-so. That is the whole product.${C.z}`);
  } else no(`Gulf Gold should flag RED +150g — got ${JSON.stringify(balGulf)}`);

  h('[6] Co-held & tamper-evident — the input is the SAME at mine and operator; nobody can soften it');
  const atMine = await view(oGulf, SAHEL), atOp = await view(oGulf, OP);
  if (atMine.qty===800 && atOp.qty===800)
    ok(`input = ${C.bold}800g${C.z} in Sahel's frozen copy AND the operator's copy — independently held; Gulf can edit neither`);
  else no(`co-hold: mine.qty=${atMine.qty} op.qty=${atOp.qty} (both should be 800)`);
  if (atMine.bal==null && atOp.bal && atOp.bal.status==='red')
    ok(`only the operator (co-holds BOTH edges) sees the reconciliation; the mine cannot see Gulf's downstream at all`);
  else no(`expected mine bal=null & operator bal=red — mine=${JSON.stringify(atMine.bal)} op=${JSON.stringify(atOp.bal)}`);
  console.log(`   ${C.dim}This is what the Kaloti auditor couldn't secure: a finding no party can pressure to "vanishing point".${C.z}`);

  h('[7] Privacy — rivals stay blind');
  const spy = await view(oGulf, ALNOOR);
  if (spy.httpStatus!==200 || !spy.seen) ok(`Al Noor cannot see Gulf Gold's batch (${spy.httpStatus}) — rival isolation holds`);
  else no(`Al Noor should NOT see Gulf Gold's batch — got ${spy.httpStatus}, seen=${spy.seen}`);

  done();
}

function done(){
  const pass=results.filter(Boolean).length, bad=results.filter(r=>!r).length;
  console.log(`\n${'═'.repeat(62)}`);
  if(!bad) console.log(`  ${C.g}${C.bold}THE NERVE${C.z} — same launderer: ${C.g}GREEN on his own books${C.z}, ${C.r}RED on a co-held cross-party chain${C.z}.`);
  else     console.log(`  ${C.r}${C.bold}${bad} CHECK(S) FAILED${C.z}  (${pass} passed)`);
  console.log(`  ${C.dim}IN and OUT live with different parties, co-held & un-forgeable — no one holds or controls both sides.${C.z}`);
  console.log(`${'═'.repeat(62)}`);
  process.exit(bad?1:0);
}
main().catch(e=>{ console.error(`${C.r}crashed:${C.z} ${e.message}`); process.exit(1); });
