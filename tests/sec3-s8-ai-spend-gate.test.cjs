#!/usr/bin/env node
// @type: unit
/**
 * sec3-s8-ai-spend-gate.test.cjs — S8 (VERIFY-EL-SECURITY): the AI spend gate read counts, THEN called the model, THEN logged; and a failing platform-ceiling read was skipped.
 * ATTACK    forty parallel calls from one signed-in account all pass a gate that has room for one (every one reads the same old ledger); and while the ceiling function errors, nothing bounds the shared key.
 * RULE      a call is RESERVED before it is checked (its worst-case cost counts against the others in flight at once) and let go when it ends; the platform ceiling read FAILS CLOSED (503) on any error.
 * RUN       node tests/sec3-s8-ai-spend-gate.test.cjs        STANDARD  OWASP API4:2023 (unrestricted resource consumption) · ASVS 4.0.3 V11.1.4
 * CARD      25-ai-cb-assist-and-support-desks/ai-security
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sec3-s8';
process.env.NODE_ENV = 'test';
delete process.env.AI_GATE;
delete process.env.AI_MODEL;
process.env.AI_FREE_USD = '1';
const ENT = '33333333-3333-4333-8333-333333333333';
const state = { spent: 0.99, globalFails: false, ledgerRows: 0 };
const answer = (sql) => {
  if (/ai_global_spend_today/.test(sql)) { if (state.globalFails) throw new Error('connection reset'); return { rows: [{ spent: 0 }] }; }
  if (/FROM usage_ledger WHERE entity_id/.test(sql)) return { rows: [{ h: 0, d: 0, spent: state.spent }] };
  if (/FROM entity_wallet/.test(sql)) return { rows: [{ credits: 0 }] };
  return { rows: [] };
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async (s) => answer(String(s)), withEntity: async (_e, fn) => fn({ query: async (s) => answer(String(s)) }), readBatch: async () => [] } };
let reached = 0;
globalThis.fetch = async (url) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error('left the stub');
  reached++;
  await new Promise((r) => setTimeout(r, 30)); /* the model takes time: the calls overlap */
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'draft' }], usage: { input_tokens: 5, output_tokens: 5 }, stop_reason: 'end_turn' }) };
};
process.env.ANTHROPIC_API_KEY = 'stub-not-a-key';
const say = process.stdout.write.bind(process.stdout);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
let bad = 0;
const t = (n, ok, x) => { say((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : ' ' + (x || '')) + '\n'); if (!ok) bad++; };

(async () => {
  const ai = require('../lib/ai');
  /* the ledger shows $0.99 of the $1.00 free budget spent: room for ONE call (worst case $0.02 held per call) */
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => ai.invokeSkill(ENT, 'line-item-draft', { description: '1 kg sugar' })));
  const through = results.filter((r) => r.status === 'fulfilled').length;
  const refused = results.filter((r) => r.status === 'rejected' && r.reason && r.reason.status === 402).length;
  t('40 parallel calls with room for one: at most 1 reaches the model (was 40)', through <= 1 && reached <= 1, 'through ' + through + ' reached ' + reached);
  t('the other 39 are refused 402 at the gate', refused === 40 - through, 'refused ' + refused);
  const after = await ai.invokeSkill(ENT, 'line-item-draft', { description: '1 kg sugar' }).then(() => 'ok', (e) => e.status);
  t('the hold is let go when the calls end: a later single call is judged on the ledger alone (past the gate at $0.99; 422 = the stub unparsable reply)', after !== 402 && after !== 503, String(after));
  state.globalFails = true;
  const before = reached;
  const g = await ai.invokeSkill(ENT, 'line-item-draft', { description: 'x' }).then(() => 'ok', (e) => e.status);
  t('the platform ceiling read errors → 503 and the model is not called (fails CLOSED)', g === 503 && reached === before, String(g));
  process.exit(bad ? 1 : 0);
})();
