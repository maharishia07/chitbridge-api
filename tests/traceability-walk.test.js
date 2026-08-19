// tests/traceability-walk.test.js — Traceability WALK + operator lens, Fragment 2 (RED-first).
// Run against a LIVE server with Fragment 2 deployed:  TEST_URL=<url> node tests/traceability-walk.test.js
// RED-first by construction: on pre-Fragment-2 code GET /chits/:id/trace is 404 and no operator co-hold exists.
//
// Builds a real-shaped pharma-style chain with a DIAMOND and a NON-PARTICIPATING branch, then asserts:
//   TR-2  forward walk (as the operator) returns EXACTLY the reachable set; a diamond reconverges to ONE node;
//         a non-participating handoff is an honest DEAD-END (excluded), not a silent skip to grandchildren.
//   TR-3  backward walk from a leaf returns the path to the origin, in order.
//   TR-6  the moat: the operator sees its whole subtree; a competitor sees NOTHING of the chain; an ordinary
//         party sees ONLY its own edges; the walk surfaces topology+product but NOT commercial terms.
require('dotenv').config();
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

const results = [];
const C = { g:'\x1b[32m', r:'\x1b[31m', b:'\x1b[34m', z:'\x1b[0m', bold:'\x1b[1m' };
const pass = (t,d='') => { console.log(`${C.g}✅ PASS${C.z} ${t}${d?` — ${d}`:''}`); results.push({ t, ok:true }); };
const fail = (t,d='') => { console.log(`${C.r}❌ FAIL${C.z} ${t}${d?` — ${d}`:''}`); results.push({ t, ok:false, d }); };
const section = (t) => console.log(`\n${C.bold}${C.b}── ${t} ──${C.z}`);

async function api(method, path, body, token) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers: { 'Content-Type':'application/json', ...(token && { Authorization:`Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  let data = {}; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
async function mint(name) {
  const email = `tw-${name}-${Date.now()}-${Math.floor(Math.random()*1e6)}@test-cb.com`;
  const reg = await api('POST','/api/entities/register',{ display_name:`TW ${name}`, email, user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6) });
  if (!reg.data.dev_otp) throw new Error(`no dev_otp for ${name}`);
  const ver = await api('POST','/api/entities/verify',{ email, otp: reg.data.dev_otp });
  if (ver.status !== 200) throw new Error(`verify ${name}: ${ver.data.message}`);
  return { id: ver.data.entity.identity_id, token: ver.data.token, name };
}
// edge: {parents?, is_origin?, product, qty, unit, op?(operator id — omit for a non-participating handoff), price?}
async function handoff(from, to, edge) {
  const t = { parents: edge.parents, is_origin: edge.is_origin, product: edge.product, qty: edge.qty, unit: edge.unit };
  if (edge.op !== undefined) t.network = { id: 'demo-net', operator: edge.op };
  const r = await api('POST','/api/chits/send', {
    receivers: [{ entity_id: to.id }], purpose: 'delivery_note', manual_subject: `${from.name}→${to.name}`,
    line_items: edge.price ? [{ name: edge.product||'item', quantity: edge.qty||1, unit: edge.unit||'unit', price: edge.price, total: edge.price*(edge.qty||1) }] : [],
    trace: t,
  }, from.token);
  if (r.status !== 200) throw new Error(`handoff ${from.name}→${to.name} failed: ${r.status} ${r.data.message||''}`);
  return r.data.chit_id;
}
const walk = (who, id, dir) => api('GET', `/api/chits/${id}/trace?dir=${dir}`, null, who.token);

async function main() {
  console.log(`${C.bold}${C.b}Traceability Fragment 2 — walk + operator lens (RED-first)${C.z}  (server: ${BASE_URL})`);
  if ((await api('GET','/health')).status !== 200) { fail('server health'); return done(); }

  const A=await mint('A'), B=await mint('B'), Cc=await mint('C'), D=await mint('D'), E=await mint('E'),
        P=await mint('P'), OP=await mint('OP'), W=await mint('W');
  const op = OP.id;

  section('seed the chain (origin → fan-out → diamond → + one non-participating branch)');
  const O  = await handoff(A, B,  { is_origin:true, product:'API-PC-24K19', qty:24, unit:'kg', op, price:1000 });
  const c1 = await handoff(B, Cc, { parents:[O],  product:'FG-PC-6621', qty:8, unit:'kg', op, price:500 });
  const c2 = await handoff(B, D,  { parents:[O],  product:'FG-PC-6621', qty:8, unit:'kg', op, price:500 });   // fan-out
  const c3 = await handoff(Cc, E, { parents:[c1], product:'FG-PC-6621', qty:4, unit:'kg', op });
  const c4 = await handoff(D, E,  { parents:[c2], product:'FG-PC-6621', qty:4, unit:'kg', op });
  const f  = await handoff(E, P,  { parents:[c3, c4], product:'FG-PC-6621', qty:8, unit:'kg', op });           // DIAMOND reconverge (2 parents)
  const g  = await handoff(B, W,  { parents:[O],  product:'FG-PC-6621', qty:2, unit:'kg' });                   // NON-participating (no operator)
  pass('chain seeded', `O + 6 network edges + 1 non-participating`);

  // ── TR-2 · forward reachable set, diamond, honest dead-end ────────────────────────────────────────────────
  section('TR-2 · forward walk returns exactly the reachable set');
  const fwd = await walk(OP, O, 'forward');
  if (fwd.status === 200) {
    const ids = new Set((fwd.data.nodes||[]).map(n => n.chit_id));
    if (fwd.data.reachable_count === 6 && ids.size === 6) pass('TR-2a operator forward reaches exactly 6 nodes', `count=${fwd.data.reachable_count}`);
    else fail('TR-2a reachable set', `count ${fwd.data.reachable_count}, distinct ${ids.size} (expected 6)`);
    const intoF = (fwd.data.edges||[]).filter(e => e.to === f);
    if (ids.has(f) && intoF.length === 2) pass('TR-2b diamond reconverges to ONE node with 2 incoming edges');
    else fail('TR-2b diamond', `f present=${ids.has(f)}, edges into f=${intoF.length} (expected 2)`);
    if (!ids.has(g)) pass('TR-2c non-participating branch is an honest DEAD-END (excluded, not silently skipped)');
    else fail('TR-2c non-participating branch leaked into the walk');
  } else { fail('TR-2 forward walk', `status ${fwd.status}`); }

  // ── TR-3 · backward walk to source ────────────────────────────────────────────────────────────────────────
  section('TR-3 · backward walk from a leaf returns the path to source');
  const bwd = await walk(OP, f, 'backward');
  if (bwd.status === 200) {
    const path = bwd.data.path || [];
    const src = (bwd.data.nodes||[]).find(n => n.chit_id === path[0]);
    if (path[0] === O && path[path.length-1] === f) pass('TR-3a path runs source→leaf (O … f)', `hops=${bwd.data.hops}`);
    else fail('TR-3a path order', `path ${JSON.stringify(path)}`);
    if (src && src.is_origin === true) pass('TR-3b source node is the origin (is_origin:true)');
    else fail('TR-3b source not flagged origin', JSON.stringify(src));
  } else { fail('TR-3 backward walk', `status ${bwd.status}`); }

  // ── TR-6 · the moat ───────────────────────────────────────────────────────────────────────────────────────
  section('TR-6 · per-party privacy (the moat)');
  // (a) operator sees the subtree — established by TR-2a
  if (fwd.status === 200 && fwd.data.reachable_count === 6) pass('TR-6a operator lens sees its whole subtree (6 nodes)');
  else fail('TR-6a operator subtree');
  // (b) a competitor sees NOTHING of the chain
  const competitor = await walk(W, O, 'forward');
  if (competitor.status === 404) pass('TR-6b competitor cannot walk a chit it is not on → 404 (rival edge invisible)');
  else fail('TR-6b competitor saw a rival edge', `status ${competitor.status}`);
  // (c) an ordinary party sees ONLY its own edges (C co-holds c1 received + c3 sent; must NOT see D/E's edges)
  const partyC = await walk(Cc, c1, 'forward');
  if (partyC.status === 200 && partyC.data.reachable_count === 2) pass('TR-6c ordinary party sees ONLY its own edges (c1→c3, stops)', `count=${partyC.data.reachable_count}`);
  else fail('TR-6c ordinary party visibility', `status ${partyC.status}, count ${partyC.data && partyC.data.reachable_count} (expected 2)`);
  // (d) the walk surfaces topology+product but NOT commercial terms
  const node = (fwd.data.nodes||[]).find(n => n.chit_id === c1);
  if (node && node.product === 'FG-PC-6621' && !('total_value' in node) && !('price' in node)) pass('TR-6d walk shows product/qty but NOT commercial terms');
  else fail('TR-6d commercial terms leaked or product missing', JSON.stringify(node));

  done();
}

function done() {
  const ok = results.filter(r=>r.ok).length, bad = results.filter(r=>!r.ok).length;
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  ${C.g}PASS ${ok}${C.z}   ${bad?C.r:''}FAIL ${bad}${C.z}`);
  if (bad) results.filter(r=>!r.ok).forEach(r=>console.log(`  ${C.r}→${C.z} ${r.t}${r.d?`: ${r.d}`:''}`));
  console.log('═'.repeat(52));
  process.exit(bad?1:0);
}
main().catch(e => { console.error(`${C.r}suite crashed:${C.z} ${e.message}`); process.exit(1); });
