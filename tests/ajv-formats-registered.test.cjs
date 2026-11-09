#!/usr/bin/env node
/**
 * tests/ajv-formats-registered.test.cjs — A CONTRACT MAY NAME ONLY A FORMAT THE SCHEMA ENGINE HAS REGISTERED (SHARED-CHECKS slice 0a, 2026-11-09). No database, no network.
 *
 * OWNS     the gate over every `format` in a body, query or response schema: the route fragments (router.openapi paths and schemas) and docs/contracts/web-api.json
 * WHY      middleware/validate.js builds ajv with strict: false and ajv-formats is not a dependency, so an unregistered format is silently ignored: the field is not checked and nothing says so
 * EXCEPTION one documented-only format, listed with its reason in DOCUMENTED_ONLY; the list may only shrink (a stale line fails) and an entry never covers a second place
 * FLOW     self-test (an unregistered format is found, a registered one is not) → walk the loaded app's fragments → every format found is in REGISTERED_FORMATS
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { REGISTERED_FORMATS, bodyEngine, urlEngine } = require('../middleware/validate');
const loader = require('../tools/load-app.cjs');

let checks = 0, failed = 0;
const check = (what, ok, extra) => { checks++; if (!ok) failed++; console.log((ok ? '  ✓ ' : '  ✗ ') + what + (extra ? '   ' + extra : '')); };

/** the schema children of a "properties" map: its values (its keys are field names, a field called "format" is not the keyword) */
const fieldSchemas = (map, where) => Object.keys(map).map((field) => [map[field], where + '.properties.' + field]);

/** every value of a `format` keyword in a schema tree, with where it sits */
function formatsIn(node, where, found) {
  if (Array.isArray(node)) node.forEach((item, i) => formatsIn(item, where + '[' + i + ']', found));
  else if (node && typeof node === 'object') {
    Object.keys(node).forEach((key) => {
      const isMap = key === 'properties' && node[key] && typeof node[key] === 'object' && !Array.isArray(node[key]);
      if (key === 'example' || key === 'examples') return; /* a sample payload may hold a field called format: not a keyword */
      if (key === 'format' && typeof node[key] === 'string') found.push({ format: node[key], where });
      else if (isMap) fieldSchemas(node[key], where).forEach(([child, at]) => formatsIn(child, at, found));
      else formatsIn(node[key], where + '.' + key, found);
    });
  }
  return found;
}
const unregistered = (found) => found.filter((item) => !REGISTERED_FORMATS[item.format]);

/* a format named on a schema that documents a shape the route does not enforce: registering it would refuse today's callers, so it stays unregistered, said here, owner named */
const DOCUMENTED_ONLY = [
  { format: 'date-time', where: 'offers.js.schemas.EvaluateBody.properties.ctx.properties.now', reason: 'POST /api/offers/evaluate is keyed-outward and tolerant until a /v2 (API-43, CAT-284); the owner (cb-catalogue) decides whether now becomes enforced' }
];
const isDocumented = (item) => DOCUMENTED_ONLY.some((row) => row.format === item.format && row.where === item.where);

check('self-test: an unregistered format is found', unregistered(formatsIn({ properties: { a: { type: 'string', format: 'email' } } }, 'x', [])).length === 1);
check('self-test: a registered format is not', unregistered(formatsIn({ properties: { a: { type: 'string', format: 'calendar-day' } } }, 'x', [])).length === 0);
check('self-test: a field called format is not a keyword', formatsIn({ properties: { format: { type: 'string' } } }, 'x', []).length === 0);
check('both engines know every registered format', Object.keys(REGISTERED_FORMATS).every((name) => !!bodyEngine.formats[name] && !!urlEngine.formats[name]));

loader.stubDatabase(ROOT);
loader.loadApp(ROOT);
const found = [];
const routeDirs = [path.join(ROOT, 'routes') + path.sep, path.join(ROOT, 'src', 'routes') + path.sep];
Object.keys(require.cache).filter((file) => routeDirs.some((dir) => file.startsWith(dir))).forEach((file) => {
  const exported = require.cache[file].exports;
  if (exported && exported.openapi) formatsIn(exported.openapi, path.basename(file), found);
});
const web = path.join(ROOT, 'docs', 'contracts', 'web-api.json');
if (fs.existsSync(web)) formatsIn(JSON.parse(fs.readFileSync(web, 'utf8')), 'web-api.json', found);
const bad = unregistered(found).filter((item) => !isDocumented(item));
const stale = DOCUMENTED_ONLY.filter((row) => !found.some((item) => item.format === row.format && item.where === row.where));
check('the documented-only list has no stale line', stale.length === 0, stale.map((row) => row.where).join('; '));
check('every format a contract names is registered (' + found.length + ' named)', bad.length === 0, bad.slice(0, 5).map((item) => item.format + ' at ' + item.where).join('; '));
console.log('\n' + checks + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
