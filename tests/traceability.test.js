// tests/traceability.test.js — Traceability edge, Fragment 1 (RED-first).
// Run against a LIVE server with the new code deployed:  TEST_URL=<url> node tests/traceability.test.js
// RED-first by construction: on the CURRENT (pre-Fragment-1) code these FAIL —
//   TR-1 → a no-parent handoff returns 200 (no validation yet), test expects 400;
//   TR-8 → GET /chits/:id/children is 404 (route doesn't exist yet).
// They go GREEN only once Fragment 1 (lib/trace.js + the chits.js edits + the /children route) is live.
//
// Covers: TR-1 (non-origin handoff without a parent is REJECTED — the no-silent-holes rule + the co-hold gate),
//         TR-8 (forward link is a SET — a fan-out node walks to all N children),
//         TR-7 (freeze — the edge is frozen per-copy: base units computed at seal, stable across reads,
//               and self-contained so an upstream change can't alter a sealed child).
require('dotenv').config();
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

const results = [];
const C = { g:'\x1b[32m', r:'\x1b[31m', b:'\x1b[34m', z:'\x1b[0m', bold:'\x1b[1m' };
function pass(t, d='') { console.log(`${C.g}✅ PASS${C.z} ${t}${d?` — ${d}`:''}`); results.push({ t, ok:true }); }
function fail(t, d='') { console.log(`${C.r}❌ FAIL${C.z} ${t}${d?` — ${d}`:''}`); results.push({ t, ok:false, d }); }
function section(t) { console.log(`\n${C.bold}${C.b}── ${t} ──${C.z}`); }

async function api(method, path, body, token) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  let data = {}; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function mint(name) {
  const email = `trace-${name}-${Date.now()}-${Math.floor(Math.random()*1e6)}@test-cb.com`;
  const reg = await api('POST', '/api/entities/register', { display_name: `Trace ${name}`, email });
  const otp = reg.data.dev_otp;
  if (!otp) throw new Error(`no dev_otp for ${name} — need NODE_ENV=development`);
  const ver = await api('POST', '/api/entities/verify', { email, otp });
  if (ver.status !== 200) throw new Error(`verify failed for ${name}: ${ver.data.message}`);
  return { id: ver.data.entity.identity_id, token: ver.data.token, name };
}

// send a handoff chit; `traceObj` becomes req.body.trace
async function sendHandoff(from, to, traceObj, subject) {
  return api('POST', '/api/chits/send', {
    receivers: [{ entity_id: to.id }],
    purpose: 'delivery_note',
    manual_subject: subject || `handoff ${from.name}→${to.name}`,
    line_items: [],
    trace: traceObj,
  }, from.token);
}

async function main() {
  console.log(`${C.bold}${C.b}Traceability Fragment 1 — RED-first suite${C.z}  (server: ${BASE_URL})`);

  // health
  const h = await api('GET', '/health');
  if (h.status !== 200) { fail('server health'); return done(); }

  const A = await mint('A'), B = await mint('B'), D1 = await mint('D1'), D2 = await mint('D2'), D3 = await mint('D3');

  // ── TR-1 · no-silent-holes + co-hold gate ────────────────────────────────────────────────────────────────
  section('TR-1 · non-origin handoff without a parent is REJECTED');

  const noParent = await sendHandoff(A, B, { is_origin: false }, 'illegal: no parent');
  if (noParent.status === 400) pass('TR-1a non-origin handoff w/o parent → 400', noParent.data.message);
  else fail('TR-1a should reject non-origin handoff w/o parent', `got ${noParent.status}`);

  const fakeParent = await sendHandoff(A, B, { parents: ['00000000-0000-4000-8000-000000000000'] }, 'illegal: unheld parent');
  if (fakeParent.status === 400) pass('TR-1b handoff referencing an un-co-held parent → 400', fakeParent.data.message);
  else fail('TR-1b should reject un-co-held parent', `got ${fakeParent.status}`);

  // origin IS allowed (this also mints the root we walk from)
  const origin = await sendHandoff(A, B, { is_origin: true, product: 'API-PC-24K19', qty: 24, unit: 'kg' }, 'ORIGIN: API batch');
  if (origin.status === 200 && origin.data.chit_id) pass('TR-1c origin handoff (is_origin:true) accepted', origin.data.chit_id);
  else { fail('TR-1c origin handoff should be accepted', `got ${origin.status} ${origin.data.message||''}`); return done(); }
  const O = origin.data.chit_id;

  // ── TR-8 · forward link is a SET (fan-out) ───────────────────────────────────────────────────────────────
  section('TR-8 · forward link is a SET — one node fans out to N children');

  const kids = [];
  for (const [i, dist] of [D1, D2, D3].entries()) {
    const r = await sendHandoff(B, dist, { parents: [O], product: 'FG-PC-6621', qty: 8, unit: 'kg' }, `split ${i+1}`);
    if (r.status === 200) kids.push(r.data.chit_id);
    else fail(`TR-8 seed child ${i+1}`, `got ${r.status} ${r.data.message||''}`);
  }

  const children = await api('GET', `/api/chits/${O}/children`, null, B.token);
  if (children.status === 200 && children.data.count === 3) {
    const ids = new Set((children.data.children||[]).map(c => c.chit_id));
    if (ids.size === 3) pass('TR-8 forward walk returns all 3 children (SET fan-out)', `count=${children.data.count}`);
    else fail('TR-8 children not distinct', `${ids.size} distinct`);
  } else {
    fail('TR-8 forward walk should return exactly 3 children', `status ${children.status}, count ${children.data.count}`);
  }

  // ── TR-7 · freeze (base units at seal, stable, self-contained) ────────────────────────────────────────────
  section('TR-7 · the edge is frozen per-copy');

  const first = await api('GET', `/api/chits/${O}/children`, null, B.token);
  const child = (first.data.children || [])[0];
  if (child && child.trace) {
    // base units computed at seal: 8 kg → 8000 g
    if (child.trace.base_qty === 8000 && child.trace.base_unit === 'g') pass('TR-7a base units frozen at seal (8kg → 8000g)');
    else fail('TR-7a base-unit conversion', `got ${child.trace.base_qty} ${child.trace.base_unit}`);
    // self-contained: the child carries its own product/parents, independent of the origin
    if (Array.isArray(child.trace.parents) && child.trace.parents.includes(O) && child.trace.product === 'FG-PC-6621')
      pass('TR-7b child edge is self-contained (own product + parent ref frozen)');
    else fail('TR-7b child edge not self-contained', JSON.stringify(child.trace));
    // stable across reads (renders from the frozen body, not a live recompute)
    const second = await api('GET', `/api/chits/${O}/children`, null, B.token);
    const child2 = (second.data.children || []).find(c => c.chit_id === child.chit_id);
    if (child2 && JSON.stringify(child2.trace) === JSON.stringify(child.trace)) pass('TR-7c frozen edge identical across reads');
    else fail('TR-7c frozen edge changed across reads');
  } else {
    fail('TR-7 no child edge to inspect');
  }

  done();
}

function done() {
  const ok = results.filter(r => r.ok).length, bad = results.filter(r => !r.ok).length;
  console.log(`\n${'═'.repeat(48)}`);
  console.log(`  ${C.g}PASS ${ok}${C.z}   ${bad?C.r:''}FAIL ${bad}${C.z}`);
  if (bad) { console.log('  failed:'); results.filter(r=>!r.ok).forEach(r=>console.log(`  ${C.r}→${C.z} ${r.t}${r.d?`: ${r.d}`:''}`)); }
  console.log('═'.repeat(48));
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(`${C.r}suite crashed:${C.z} ${e.message}`); process.exit(1); });
