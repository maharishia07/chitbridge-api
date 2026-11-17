#!/usr/bin/env node
// @type: contract
/**
 * chits-b-strict-input.test.cjs — S33 strict input, chits (the rest of the writes): a closed write body refuses an unknown key by name and still takes every body a caller sends.
 *
 * OWNS      the proof for the routes this sweep closed (API-30 bulk pass, 6 Nov 2026): (1) an unknown key is refused (400 or 422, the route's own refusal) with the field named ·
 *           (2) the bodies the web, the till and the toolset send are still accepted by the route's own schema check · (3) every key the handler reads from its body is declared.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the app is loaded offline and the route's schema check (middleware/validate.js schemaValidate) runs alone.
 * FLOW      tools/load-app.cjs → the route's operation (its own schema check, with its own refusal words) → a body → accepted, or refused with the field named
 * CARD      28-platform-and-operations/api-standard
 * Open on purpose (listed in PM/API-30-STRICT-PASS-2026-11-06.md): POST /api/chits/send (API-43: keyed by the till scope, KEY_ROUTES till; its body stays tolerant until /v2)
 * What it cannot see (each stays a review question): a key read through a computed name; a body handed to another function; nested keys.
 *
 *   node tests/chits-b-strict-input.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'tools', 'load-app.cjs')).loadApp(ROOT);
const register = require(path.join(ROOT, 'tools', 'api-register.cjs'));
const { schemaValidate, bodySchemaOf } = require(path.join(ROOT, 'middleware', 'validate'));

const OPERATIONS = register.operationsOfApp();
const UUID = '11111111-1111-4111-8111-111111111111';
/** [route, the file its handler is in, [bodies a real caller sends]] */
const CASES = [
  ['PUT /api/chits/:chit_id/status', 'routes/chits.js', [{ status: 'accepted' }, { status: 'cancelled', note: 'why' }]],
  ['POST /api/chits/:chit_id/payment', 'routes/chits.js', [{ method: 'upi', ref: 'r1', amount: 10, client_ref: 'c1' }, { method: 'cash', acknowledge: [] }]],
  ['POST /api/chits/:chit_id/messages', 'routes/chits.js', [{ thread_type: 'external', message_text: 'hello', msg_type: 'info' }, { thread_type: 'external', message_text: 'x', is_dispute: true, dispute_id: UUID, line_id: UUID, msg_type: 'action' }]],
  ['POST /api/chits/:chit_id/disputes', 'routes/chits.js', [{ category: 'quantity', reason: 'The goods were short by two', target_entity_id: null }, { category: 'other', reason: 'A reason that is long enough', participant_entity_ids: [UUID] }]],
  ['POST /api/chits/:chit_id/raida/:raida_id/close', 'routes/chits.js', [{ body: 'done', disposition: 'resolved' }]],
  ['POST /api/chits/:chit_id/raida/:raida_id/dispute', 'routes/chits.js', [{ dispute_id: UUID }]],
  ['POST /api/chits/register/subjects/:subject_id/close', 'routes/chits.js', [{}]],
  ['POST /api/chits/register/subjects/:subject_id/entries', 'routes/chits.js', [{ kind: 'risk', body: 'late stock', owner_name: 'A', due_date: '2026-12-01', likelihood: 3, severity: 2, response: 'mitigate', standards: ['iso9001'] }, { kind: 'dependency', body: 'b', to_id: 'x', to_type: 'chit', to_label: 'l', rel_type: 'finish_to_start', needed_by: '2026-12-01' }]],
  ['POST /api/chits/register/entries/:raida_id/close', 'routes/chits.js', [{ disposition: 'carried_forward', body: 'later', carried_to_subject_id: UUID }, { disposition: 'resolved', body: 'done' }]],
  ['POST /api/chits/register/entries/:raida_id/revise', 'routes/chits.js', [{ owner_name: 'A', likelihood: 3, severity: 2, residual_likelihood: 1, residual_severity: 1, treatment: 't', due_date: '2026-12-01', response: 'mitigate' }]],
  ['POST /api/chits/register/entries/:raida_id/accept', 'routes/chits.js', [{ accepted_by_name: 'A', authority_level: 'manager', rationale: 'r', review_by: '2027-01-01' }]]
];
const IGNORED_READS = new Set(['length', 'map', 'filter', 'slice', 'trim', 'toString', 'forEach', 'some', 'every', 'join', 'split', 'includes', 'hasOwnProperty']);
let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

/** what the route's schema check does with a body: { status: 200 } when it lets it on, else the refusal's status and json */
function answerTo(operation, body, route) {
  let out = { status: 200 };
  const params = {};
  (route.match(/:[A-Za-z_]+/g) || []).forEach((name) => { params[name.slice(1)] = UUID; });
  const res = {
    statusCode: 200, locals: {}, set() { return this; }, setHeader() {}, getHeader() {}, type() { return this; }, end() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { out = { status: this.statusCode, json: value }; return this; },
    send(value) { out = { status: this.statusCode, json: value }; return this; }
  };
  const req = { body, query: {}, params, headers: {}, id: 'test', method: route.split(' ')[0], originalUrl: route.split(' ')[1], get() { return ''; } };
  schemaValidate(operation)(req, res, () => { out = { status: 200 }; });
  return out;
}
const lines = {};
const linesOf = (file) => (lines[file] = lines[file] || fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n'));

for (const [route, file, bodies] of CASES) {
  const operation = OPERATIONS[route];
  ok(route + ': the route has a body schema', !!(operation && bodySchemaOf(operation)));
  if (!operation || !bodySchemaOf(operation)) continue;
  ok(route + ': the body is closed (additionalProperties false)', bodySchemaOf(operation).additionalProperties === false);
  const refused = answerTo(operation, Object.assign({}, bodies[0], { zz_unknown_field: 1 }), route);
  ok(route + ': an unknown key is refused (400/422) and named', (refused.status === 400 || refused.status === 422) && JSON.stringify(refused.json).includes('zz_unknown_field'), JSON.stringify(refused));
  const bad = bodies.map((body) => answerTo(operation, body, route)).filter((got) => got.status !== 200);
  ok(route + ': ' + bodies.length + ' real caller body(ies) still accepted', !bad.length, JSON.stringify(bad));
  /* every key the handler reads is declared */
  const [method, apiPath] = route.split(' ');
  const L = linesOf(file);
  const tail = apiPath.split('/').filter(Boolean);
  let at = -1;
  for (let k = 0; k <= tail.length && at < 0; k++) {
    const sub = '/' + tail.slice(k).join('/');
    at = L.findIndex((l, n) => { const head = 'router.' + method.toLowerCase() + '('; const text = l.startsWith(head) ? (l === head ? L[n + 1] : l) : ''; return !!text && (text.includes("'" + sub + "'") || text.includes('"' + sub + '"')); });
  }
  if (at < 0) { ok(route + ': its handler is found in ' + file, false); continue; }
  let end = at + 1;
  while (end < L.length && !/^\}\);?\s*$/.test(L[end]) && !/^router\./.test(L[end])) end++;
  const text = L.slice(at, end).join('\n');
  const aliases = new Set(['req.body']);
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*\(?req\.body\b/g)) aliases.add(m[1]);
  const read = new Set();
  for (const al of aliases) for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.$])` + al.replace('.', String.raw`\.`) + String.raw`\??\.([A-Za-z_]\w*)`, 'g'))) read.add(m[1]);
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:req\.body|(\w+))/g)) {
    if (m[2] && !aliases.has(m[2])) continue;
    m[1].split(',').forEach((s) => { const n = s.trim().split(/[:=\s]/)[0]; if (n && !n.startsWith('...')) read.add(n); });
  }
  const declared = new Set(Object.keys(bodySchemaOf(operation).properties || {}));
  const missing = [...read].filter((k) => !IGNORED_READS.has(k) && !declared.has(k));
  ok(route + ': every key its handler reads is declared (' + read.size + ' read)', !missing.length, 'read but not declared: ' + missing.join(', '));
}
console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
