'use strict';
/**
 * T1-AI (2026-10-14) — the AI reads the WHOLE reply, the model id has one home, quantities are guarded, and CB Assist's
 * three calls go through invokeSkill (wallet · platform daily cap · usage ledger).
 *
 * Offline: the model (global fetch to api.anthropic.com) and the database (db/index.js) are stubbed in memory. What a
 * real model does with these prompts is not provable here — that is the owner's live run.
 * Run: node tests/ai-one-pipe.test.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ai-one-pipe-test';
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
delete process.env.AI_MODEL;

/* ── the database, in memory ── */
const DB = { skills: null, global: 0, ledger: [], capture: null };
const answer = (sql, p) => {
  if (/ai_global_spend_today/.test(sql)) return { rows: [{ spent: DB.global }] };
  if (/FROM ai_skill/.test(sql)) { if (!DB.skills) throw new Error('relation "ai_skill" does not exist'); return { rows: DB.skills }; }
  if (/FROM usage_ledger WHERE entity_id/.test(sql)) return { rows: [{ h: 0, d: 0, spent: 0, all_spent: 0 }] };
  if (/FROM entity_wallet/.test(sql)) return { rows: [{ credits: 0 }] };
  if (/^INSERT INTO usage_ledger/.test(sql)) { DB.ledger.push({ entity_id: p[0], detail: p[1], meta: JSON.parse(p[4]) }); return { rows: [] }; }
  if (/FROM capture/.test(sql)) return { rows: DB.capture ? [DB.capture] : [] };
  return { rows: [] };
};
const dbStub = {
  query: async (sql, p) => answer(String(sql), p),
  withEntity: async (_e, fn) => fn({ query: async (sql, p) => answer(String(sql), p) }),
  readBatch: async () => [],
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

/* ── the model, in memory ── */
let calls = [], reply = null;
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('anthropic.com')) {
    calls.push(JSON.parse(opts.body));
    return { ok: true, json: async () => (reply || { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 3, output_tokens: 2 } }) };
  }
  return realFetch(url, opts);
};
const text = (...parts) => ({ content: parts, usage: { input_tokens: 5, output_tokens: 5 }, stop_reason: 'end_turn' });

const ai = require('../lib/ai');
const ENT = '11111111-1111-4111-8111-111111111111';
let pass = 0;
const it = async (name, fn) => {
  calls = []; reply = null; DB.ledger = []; DB.global = 0;
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; }
};
const reloadSkills = async (rows) => { DB.skills = rows; await ai.loadSkills(true); };

(async () => {
  console.log('\n-- AI-ENGINE-H1 · the whole reply is read --');
  await it('a prose reply split over blocks (after a thinking block) is read whole', async () => {
    reply = text({ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Part one. ' }, { type: 'text', text: 'Part two.' });
    const out = await ai.invokeSkill(ENT, 'metrics-narrate', { x: 1 });
    assert.strictEqual(out.draft, 'Part one. Part two.');
  });
  await it('a JSON reply split over two text blocks parses (it was blank when only content[0] was read)', async () => {
    reply = text({ type: 'text', text: '{"line_items":[{"particulars":"rice",' }, { type: 'text', text: '"unit":"kg","qty":2,"rate":0}]}' });
    const out = await ai.invokeSkill(ENT, 'line-item-draft', { description: '2 kg rice' });
    assert.strictEqual(out.data.line_items[0].particulars, 'rice');
  });
  await it('a reply opening with a tool_use block still yields its text', async () => {
    reply = text({ type: 'tool_use', id: 't', name: 'x', input: {} }, { type: 'text', text: 'hello' });
    assert.strictEqual((await ai.invokeSkill(ENT, 'metrics-narrate', {})).draft, 'hello');
  });

  console.log('\n-- the model id has one home --');
  await it('no AI_MODEL, no slot model → the one default (not the dated 4-5 id)', async () => {
    await ai.invokeSkill(ENT, 'metrics-narrate', {});
    assert.ok(calls[0].model && !/20251001/.test(calls[0].model), calls[0].model);
  });
  await it('AI_MODEL overrides the default', async () => {
    process.env.AI_MODEL = 'env-model-x';
    try { await ai.invokeSkill(ENT, 'metrics-narrate', {}); } finally { delete process.env.AI_MODEL; }
    assert.strictEqual(calls[0].model, 'env-model-x');
    assert.strictEqual(DB.ledger[0].meta.model, 'env-model-x', 'the ledger records the model actually used');
  });
  await it('the slot row (ai_skill.model, b433) wins over AI_MODEL', async () => {
    const s = ai.SKILLS['metrics-narrate'];
    await reloadSkills([{ skill_id: 'metrics-narrate', category: s.category, gate: s.gate, kind: s.kind, format: null, label: s.label, system: s.system, active: true, model: 'slot-model-y' }]);
    process.env.AI_MODEL = 'env-model-x';
    try { await ai.invokeSkill(ENT, 'metrics-narrate', {}); } finally { delete process.env.AI_MODEL; }
    assert.strictEqual(calls[0].model, 'slot-model-y');
  });
  await it('a seed skill the table has never heard of resolves (works before b433 runs)…', async () => {
    reply = text({ type: 'text', text: 'answer' });
    assert.strictEqual((await ai.invokeSkill(ENT, 'assist-ask', { question: 'q' })).draft, 'answer');
  });
  await it('…but a skill the table holds as INACTIVE stays retired (400)', async () => {
    const s = ai.SKILLS['assist-ask'];
    await reloadSkills([{ skill_id: 'assist-ask', category: s.category, gate: s.gate, kind: s.kind, format: null, label: s.label, system: s.system, active: false }]);
    await assert.rejects(ai.invokeSkill(ENT, 'assist-ask', {}), (e) => e.status === 400);
    await reloadSkills(null);
  });
  await it('guard: no model id literal in lib/ or routes/ outside lib/ai.js DEFAULT_MODEL', async () => {
    const hits = [];
    for (const dir of ['lib', 'routes']) for (const f of fs.readdirSync(path.join(__dirname, '..', dir))) {
      if (!/\.(c?js)$/.test(f)) continue;
      const src = fs.readFileSync(path.join(__dirname, '..', dir, f), 'utf8');
      const n = (src.match(/['"]claude-[a-z0-9.-]+['"]/g) || []).length;
      if (n && !(dir === 'lib' && f === 'ai.js' && n === 1)) hits.push(dir + '/' + f + ' ×' + n);
    }
    assert.deepStrictEqual(hits, []);
  });

  console.log('\n-- the quantity + negation guard (compose fill and raise) --');
  await it('compose fill: "pathu kilo" read as 5 → qty null, flagged; "venam" line flagged, not dropped', async () => {
    reply = text({ type: 'text', text: JSON.stringify({ line_items: [
      { particulars: 'tomato', unit: 'kg', qty: 5, rate: 0, raw_phrase: 'pathu kilo thakkali' },
      { particulars: 'onion', unit: 'kg', qty: 1, rate: 0, raw_phrase: 'vengayam venam' },
      { particulars: 'sugar', unit: 'kg', qty: 0.5, rate: 0, raw_phrase: 'half kg sugar' },
      { particulars: 'oil', unit: 'litre', qty: 2, rate: 0, raw_phrase: '2 litre oil' }] }) });
    const out = await ai.invokeSkill(ENT, 'line-item-draft', { description: 'pathu kilo thakkali, vengayam venam, half kg sugar, 2 litre oil' });
    const [t, o, s, l] = out.data.line_items;
    assert.strictEqual(t.qty, null); assert.ok(t.needs_human && t.qty_rejected); assert.strictEqual(t.phrase_says, 10);
    assert.strictEqual(o.refused, true); assert.ok(o.needs_human);
    assert.strictEqual(s.qty, 0.5); assert.ok(!s.needs_human, 'half kg = 0.5 is accepted');
    assert.strictEqual(l.qty, 2); assert.ok(!l.needs_human);
    assert.strictEqual(out.data.quantity_check.code, 'QTY_NEEDS_CHECK');
    assert.strictEqual(out.data.quantity_check.needs_human, 2);
  });
  await it('compose fill: "half kg" read as 1 is rejected (a fraction is never rounded)', async () => {
    reply = text({ type: 'text', text: '{"line_items":[{"particulars":"sugar","unit":"kg","qty":1,"rate":0,"raw_phrase":"half kg sugar"}]}' });
    const out = await ai.invokeSkill(ENT, 'line-item-draft', { description: 'half kg sugar' });
    assert.strictEqual(out.data.line_items[0].qty, null);
  });
  await it('compose fill: a clean reading carries code QTY_OK', async () => {
    reply = text({ type: 'text', text: '{"line_items":[{"particulars":"rice","unit":"kg","qty":2,"rate":0,"raw_phrase":"2 kg rice"}]}' });
    assert.strictEqual((await ai.invokeSkill(ENT, 'line-item-draft', { description: '2 kg rice' })).data.quantity_check.code, 'QTY_OK');
  });
  await it('the prompt rules name kg, litre and half (seed for line-item-draft and message-to-chit)', async () => {
    for (const id of ['line-item-draft', 'message-to-chit']) {
      const s = ai.SKILLS[id].system;
      assert.ok(/kg/.test(s) && /litre/.test(s) && /"half"/.test(s) && /raw_phrase/.test(s), id);
    }
  });
  await it('raise: the per-line guard rejects pathu→5 and flags a refused line (lib/capture.js raisePayload)', async () => {
    DB.capture = { id: 'c1', status: 'pending', channel: 'whatsapp', sender_ref: '+91', raw_text: 'pathu kilo thakkali, vengayam venam',
      structured: { subject: 's', line_items: [
        { particulars: 'thakkali', qty: 5, unit: 'kg', raw_phrase: 'pathu kilo thakkali' },
        { particulars: 'vengayam', qty: 1, unit: 'kg', raw_phrase: 'vengayam venam' }] } };
    const out = await require('../lib/capture').raisePayload(ENT, 'c1', { useCatalogue: false });
    const [t, o] = out.line_items;
    assert.strictEqual(t.quantity, null); assert.ok(t.qty_rejected && t.needs_human);
    assert.strictEqual(o.refused, true); assert.ok(o.needs_human); assert.strictEqual(o.quantity, 1, 'flagged, never dropped or changed');
  });

  console.log('\n-- AI-ONE-PIPE · CB Assist through invokeSkill --');
  process.env.ASSIST_LLM_PROVIDER = 'anthropic';
  const express = require('express'), request = require('supertest'), jwt = require('jsonwebtoken');
  const app = express(); app.use(express.json()); app.use('/api/assist', require('../routes/assist'));
  const tok = 'Bearer ' + jwt.sign({ identity_id: ENT, identity_type: 'entity' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const standard = require('../lib/compliance').listTemplates()[0];
  const sid = typeof standard === 'string' ? standard : (standard.id || standard.key || standard.standard);

  await it('ask, conformance note and catalogue intro each leave a usage_ledger row (meter ai.draft)', async () => {
    reply = text({ type: 'text', text: 'An answer.' });
    const a = await request(app).post('/api/assist').set('Authorization', tok).send({ q: 'what is a chit?', context: 'compose' });
    assert.strictEqual(a.status, 200, JSON.stringify(a.body)); assert.strictEqual(a.body.answer, 'An answer.');
    const c = await request(app).post('/api/assist/conform').set('Authorization', tok).send({ standard: sid, payload: {} });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body)); assert.strictEqual(c.body.narrative, 'An answer.');
    const k = await request(app).post('/api/assist/catalogue-structure').set('Authorization', tok).send({});
    assert.strictEqual(k.status, 200, JSON.stringify(k.body)); assert.strictEqual(k.body.intro, 'An answer.');
    assert.deepStrictEqual(DB.ledger.map((r) => r.detail), ['assist-ask', 'conform-narrative', 'catalogue-intro']);
    assert.ok(DB.ledger.every((r) => r.entity_id === ENT));
    assert.ok(Array.isArray(calls[0].system) && calls[0].system[1].cache_control, 'the KB rides as a cached system block');
    assert.strictEqual(calls[0].max_tokens, 400);
  });
  await it('anonymous ask: no model call, 503 with a code → the library floor answers', async () => {
    const a = await request(app).post('/api/assist').send({ q: 'hello' });
    assert.strictEqual(a.status, 503); assert.strictEqual(a.body.code, 'ASSIST_SIGN_IN'); assert.strictEqual(calls.length, 0);
  });
  await it('platform daily cap reached: ask 503 ASSIST_GATED, conform keeps its verdict with narrative null — no model call', async () => {
    DB.global = 1e9;
    const a = await request(app).post('/api/assist').set('Authorization', tok).send({ q: 'hello' });
    assert.strictEqual(a.status, 503); assert.strictEqual(a.body.code, 'ASSIST_GATED');
    const c = await request(app).post('/api/assist/conform').set('Authorization', tok).send({ standard: sid, payload: {} });
    assert.strictEqual(c.status, 200); assert.strictEqual(c.body.narrative, null);
    assert.strictEqual(calls.length, 0);
  });
  await it('switch off (no ASSIST_LLM_PROVIDER): ask 503, no model call', async () => {
    delete process.env.ASSIST_LLM_PROVIDER;
    try { const a = await request(app).post('/api/assist').set('Authorization', tok).send({ q: 'hello' }); assert.strictEqual(a.status, 503); }
    finally { process.env.ASSIST_LLM_PROVIDER = 'anthropic'; }
    assert.strictEqual(calls.length, 0);
  });
  await it('privacy register names Assist under the one Anthropic entry', async () => {
    const f = require('../lib/privacy').facts().processors.filter((p) => p.name === 'Anthropic');
    assert.strictEqual(f.length, 1); assert.ok(/Assist answers/.test(f[0].role) && /routes\/assist\.js/.test(f[0].source));
  });

  console.log('\n' + pass + ' passed' + (process.exitCode ? ' — FAILURES above' : ''));
  process.exit(process.exitCode || 0);
})();
