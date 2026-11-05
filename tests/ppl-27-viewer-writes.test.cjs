#!/usr/bin/env node
'use strict';
/**
 * tests/ppl-27-viewer-writes.test.cjs — PPL-27 (Q42, option a): a View-only login keeps the 7 writes SIT saw answer 2xx, and the one that could spend money no longer does.
 * OWNS      POST /api/assist/catalogue-structure by caller: a viewer and a commenter get the deterministic draft with intro null and 0 model calls; an editor and the owner get one call (assist on);
 *           an anonymous caller gets 0. The other 6 (3 own-self writes, 3 machine/public doors) are named in middleware/hat-gate.js SELF_SCOPED and tests/write-route-gate.test.cjs WRITE_ALLOW.
 * CALLED BY scripts/guards.cjs · No database, no network: the real route file over a stand-in catalogue build and a counting stand-in for ai.invokeSkill.
 * FLOW      sign a token (access_level claim) → POST over http → count ai.invokeSkill calls → check status, intro, draft
 * CARD      17-people-employees-hr-and-payroll
 */
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.ASSIST_LLM_PROVIDER = 'anthropic'; /* assist is ON for every case below */

const ai = require('../lib/ai');
const catalogueBuild = require('../lib/catalogue-build');
let calls = 0;
ai.invokeSkill = async () => { calls++; return { draft: 'A short intro.', model: 'stand-in' }; };
catalogueBuild.build = async () => ({ for_entity: 'shop', collection: 'c', items: [{ name: 'Tussar' }], counts: { finishes: 1 } });
catalogueBuild.listSources = async () => [];

const SHOP = '11111111-1111-4111-8111-111111111111';
const staff = (access_level) => ({ identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level });
const owner = { identity_id: SHOP, identity_type: 'entity' };
const sign = (claims) => jwt.sign({ ...claims, jti: 'j-' + Math.random() }, process.env.JWT_SECRET, { expiresIn: '1h' });

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fail++; console.log('  ✗ ' + what + (info ? '\n      ' + String(info).slice(0, 400) : '')); } };

function post(port, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ source: 'beta-royale-play@v1' });
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = http.request({ port, path: '/api/assist/catalogue-structure', method: 'POST', headers }, (res) => {
      let text = ''; res.on('data', (d) => (text += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch (e) { return null; } })(), text }));
    });
    req.on('error', reject); req.end(body);
  });
}

(async () => {
  const app = express(); app.use(express.json()); app.use('/api/assist', require('../routes/assist'));
  const server = app.listen(0); const port = server.address().port;
  const run = async (label, token, expectCalls, expectIntro) => {
    calls = 0; const r = await post(port, token);
    ok(label + ': 2xx with the draft', r.status >= 200 && r.status < 300 && r.json && Array.isArray(r.json.finishes), r.status + ' ' + r.text);
    ok(label + ': ' + expectCalls + ' model call(s)', calls === expectCalls, 'calls=' + calls);
    ok(label + ': intro ' + (expectIntro === null ? 'null' : 'drafted'), r.json && r.json.intro === expectIntro, r.json && r.json.intro);
  };
  console.log('PPL-27 catalogue-structure by caller (assist on)');
  await run('viewer', sign(staff('viewer')), 0, null);
  await run('commenter', sign(staff('commenter')), 0, null);
  await run('editor', sign(staff('editor')), 1, 'A short intro.');
  await run('owner', sign(owner), 1, 'A short intro.');
  await run('anonymous', null, 0, null);
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
