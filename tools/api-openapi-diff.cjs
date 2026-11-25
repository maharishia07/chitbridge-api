#!/usr/bin/env node
'use strict';
/* tools/api-openapi-diff.cjs — breaking changes in the published OpenAPI, base against head (D1, batch 1130)
 * OWNER     cb-api
 * OWNS      D1 of batch 1130: the breaking-change check on the PUBLISHED OpenAPI (the operations every routes file declares), base against head.
 *           oasdiff (Go, Tufin) was weighed and not adopted: it needs a binary downloaded in CI and a merged spec file, and CI here runs only what node and the repo hold;
 *           this reads the same operations the register hashes, so a finding names the same "METHOD /path" key a sign-off does.
 * CALLED BY CI job api-standard (informational, prints the findings) · by hand and land-preflight (--strict fails on a breaking finding not acknowledged in docs/contracts/api-breaking-ok.json)
 * FLOW      base unpacked beside ──▶ tools/api-register.cjs --parts over base and head (the operation text of each route) ──▶ per route, per status, per schema:
 *           what a caller READS (answers) may not lose a key, a status, a type or a required key; what a caller SENDS (requests) may not gain a required key or narrow a type, enum or limit
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/api-openapi-diff.cjs --base origin/main [--strict] [--receipt F]
 * Acknowledged findings: docs/contracts/api-breaking-ok.json { "ok": { "<finding id as printed>": "why this is intended" } }; a finding is "<key> · <where> · <what>".
 */
const fs = require('fs');
const path = require('path');
const { generate } = require('./api-resign-moves.cjs');
const { checkoutBase } = require('./api-ratchet.cjs');

const ROOT = path.resolve(__dirname, '..');
const ACK_FILE = path.join(ROOT, 'docs', 'contracts', 'api-breaking-ok.json');
const typesOf = (schema) => [].concat((schema && schema.type) || []);
const LIMITS = { maxLength: 'lower', maximum: 'lower', maxItems: 'lower', minLength: 'higher', minimum: 'higher', minItems: 'higher' };

/** limits a caller sends that got tighter (or newly exist): breaking on a request, nothing on an answer */
function limitChanges(before, after, record) {
  Object.keys(LIMITS).forEach((limit) => {
    const was = before[limit];
    const now = after[limit];
    const tighter = now !== undefined && (was === undefined || (LIMITS[limit] === 'lower' ? now < was : now > was));
    if (tighter) record(true, limit + ' ' + was + ' to ' + now);
  });
}

/** an enum that lost a value breaks a caller that sends it; one that gained a value surprises a caller that switches on it */
function enumChanges(before, after, reads, record) {
  const lost = (before.enum || []).filter((value) => after.enum && !after.enum.includes(value));
  const gained = (after.enum || []).filter((value) => before.enum && !before.enum.includes(value));
  if (lost.length && !reads) record(true, 'enum lost ' + JSON.stringify(lost));
  if (gained.length && reads) record(false, 'enum gained a value (a caller that switches on it)');
}

/** the type, enum and limits of two schemas */
function valueChanges(before, after, reads, record) {
  const typeBefore = typesOf(before).join('|');
  const typeAfter = typesOf(after).join('|');
  if (typeBefore !== typeAfter) record(true, 'type ' + (typeBefore || 'any') + ' to ' + (typeAfter || 'any'));
  enumChanges(before, after, reads, record);
  if (!reads) limitChanges(before, after, record);
  if (!reads && before.additionalProperties !== false && after.additionalProperties === false) record(true, 'unknown keys are now refused (additionalProperties false)');
}

/** the keys of two object schemas: required ones, removed ones, and each kept one compared in turn */
function keyChanges(before, after, where, reads, record) {
  const requiredBefore = before.required || [];
  (after.required || []).filter((name) => !requiredBefore.includes(name)).forEach((name) => record(!reads, 'key "' + name + '" is now required'));
  if (reads) requiredBefore.filter((name) => !(after.required || []).includes(name)).forEach((name) => record(true, 'key "' + name + '" is no longer always there'));
  const found = [];
  Object.keys(before.properties || {}).forEach((name) => {
    if (!(after.properties || {})[name]) record(reads, 'key "' + name + '" removed');
    else found.push(...schemaChanges(before.properties[name], after.properties[name], where + '.' + name, reads));
  });
  return found;
}

/** what changed between two schemas, as [{ breaking, what }]; `reads` is true for an answer (the caller reads it), false for a request (the caller sends it) */
function schemaChanges(before, after, where, reads) {
  const found = [];
  const record = (breaking, what) => found.push({ breaking, what: where + ' · ' + what });
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return found;
  if (before.$ref !== after.$ref) record(false, 'the reference changed (' + before.$ref + ' to ' + after.$ref + ')');
  valueChanges(before, after, reads, record);
  found.push(...keyChanges(before, after, where, reads, record));
  if (before.items && after.items) found.push(...schemaChanges(before.items, after.items, where + '[]', reads));
  return found;
}

const bodySchema = (content) => { const media = content && (content['application/json'] || Object.values(content)[0]); return media && media.schema; };

/** the findings for a parameter list: a new or newly required parameter, a narrowed type */
function parameterChanges(before, after, record) {
  const was = new Map((before || []).map((parameter) => [parameter.in + ':' + parameter.name, parameter]));
  (after || []).forEach((parameter) => {
    const earlier = was.get(parameter.in + ':' + parameter.name);
    if (!earlier && parameter.required) record(true, 'parameter ' + parameter.name + ' is new and required');
    if (earlier && !earlier.required && parameter.required) record(true, 'parameter ' + parameter.name + ' is now required');
    if (earlier) schemaChanges(earlier.schema, parameter.schema, 'parameter ' + parameter.name, false).forEach((change) => record(change.breaking, change.what));
  });
}

/** the findings for one route's operation: statuses, answers, request body, parameters */
function operationChanges(key, before, after) {
  const found = [];
  const record = (breaking, what) => found.push({ breaking, what: key + ' · ' + what });
  Object.keys(before.responses || {}).forEach((status) => {
    const kept = (after.responses || {})[status];
    if (!kept) return record(/^2/.test(status), 'status ' + status + ' no longer declared');
    schemaChanges(bodySchema(before.responses[status].content), bodySchema(kept.content), 'answer ' + status, true).forEach((change) => record(change.breaking, change.what));
  });
  schemaChanges(bodySchema(before.requestBody && before.requestBody.content), bodySchema(after.requestBody && after.requestBody.content), 'request body', false).forEach((change) => record(change.breaking, change.what));
  if (!(before.requestBody && before.requestBody.required) && after.requestBody && after.requestBody.required) record(true, 'request body is now required');
  parameterChanges(before.parameters, after.parameters, record);
  return found;
}

/** all findings: { breaking, what }; a removed route is breaking, a new one is not a finding */
function diffOperations(baseOps, headOps) {
  const found = [];
  Object.keys(baseOps).forEach((key) => {
    if (!baseOps[key]) return;
    if (!(key in headOps)) found.push({ breaking: true, what: key + ' · route removed' });
    else if (headOps[key]) found.push(...operationChanges(key, baseOps[key], headOps[key]));
  });
  return found;
}

const opsOf = (parts) => Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, JSON.parse(value.op)]));

/** the command line: diff the published operations, print each finding, and with --strict fail on an open breaking one */
function main() {
  const argv = process.argv.slice(2);
  const ref = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
  if (!ref) throw new Error('--base <ref> is required (origin/main in CI)');
  const base = checkoutBase(ref);
  let found;
  try { found = diffOperations(opsOf(generate(base.dir).parts), opsOf(generate(ROOT).parts)); } finally { base.remove(); }
  const acknowledged = fs.existsSync(ACK_FILE) ? JSON.parse(fs.readFileSync(ACK_FILE, 'utf8')).ok || {} : {};
  const open = found.filter((finding) => finding.breaking && !(finding.what in acknowledged));
  found.forEach((finding) => console.log((finding.breaking ? (finding.what in acknowledged ? 'ACKNOWLEDGED ' : 'BREAKING ') : 'note ') + finding.what));
  console.log('published operations, ' + ref + ' to head: ' + open.length + ' breaking finding(s) open, ' + found.filter((finding) => finding.breaking).length + ' in all, ' + found.filter((finding) => !finding.breaking).length + ' note(s)');
  if (argv.includes('--receipt')) fs.writeFileSync(argv[argv.indexOf('--receipt') + 1], JSON.stringify(found, null, 1));
  if (argv.includes('--strict') && open.length) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (failure) { console.log('FAIL ' + failure.message); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}
module.exports = { schemaChanges, operationChanges, diffOperations };
