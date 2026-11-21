'use strict';
/**
 * tests/lv12-ai-skill-prototype-names.test.cjs — LV-12 (lens verify 22 Nov): the skill allow-list is the skills table and the seed, never Object.prototype.
 * HAND-COMPUTED  'constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty' are not skills: getSkill answers nothing and the real route POST /api/governance/ai-draft answers 400 (unknown skill), no model call, no spend;
 *                a real skill still resolves.
 * Fails on the parent: getSkill('constructor') answered Object (the `all[id]` truthy test), so the route got past the allow-list.
 * Run: node tests/lv12-ai-skill-prototype-names.test.cjs
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'lv12-test';
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const API = path.join(__dirname, '..');
const dbStub = { query: async () => ({ rows: [] }), withEntity: async (_e, fn) => fn({ query: async () => ({ rows: [] }) }), readBatch: async () => [], onEntity: async (_e, _d, fn) => fn({ query: async () => ({ rows: [] }) }), trySavepoint: async (d, fn) => fn(d) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign((req, res, next) => { req.identity = { identity_id: '11111111-1111-4111-8111-111111111111', identity_type: 'entity' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), allowsKey: () => false }) };
let modelCalls = 0;
const realFetch = global.fetch;
global.fetch = async (url, opts) => { if (String(url).includes('anthropic.com')) { modelCalls++; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: 1 } }) }; } return realFetch(url, opts); };
const ai = require(path.join(API, 'lib', 'ai'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (why ? '\n      ' + String(typeof why === 'function' ? 'function ' + why.name : JSON.stringify(why)).slice(0, 300) : '')); } };
(async () => {
  await ai.loadSkills(true);
  const NAMES = ['constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];
  for (const n of NAMES) ok('getSkill(' + n + ') is not a skill', (await ai.getSkill(n)) === undefined, await ai.getSkill(n));
  ok('a real skill still resolves', !!(await ai.getSkill('message-to-chit')));
  const app = express(); app.use(express.json()); app.use('/api/governance', require(path.join(API, 'routes', 'governance')));
  const srv = app.listen(0), port = srv.address().port;
  const post = (body) => new Promise((done) => { const b = JSON.stringify(body); const r = http.request({ host: '127.0.0.1', port, path: '/api/governance/ai-draft', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); }); r.end(b); });
  for (const n of ['constructor', 'prototype']) { const r = await post({ skill_id: n, context: {} }); ok('POST /ai-draft skill_id ' + n + ' answers 400, never a metered model call', r.status === 400 && modelCalls === 0, r); }
  const viaProto = await post(JSON.parse('{"skill_id":"__proto__","context":{}}'));
  ok('POST /ai-draft skill_id __proto__ answers 400', viaProto.status === 400 && modelCalls === 0, viaProto);
  srv.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
