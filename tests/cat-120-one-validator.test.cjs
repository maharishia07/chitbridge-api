#!/usr/bin/env node
/**
 * cat-120-one-validator.test.cjs — CAT-120 (proof 2026-11-14): product-schema validation has ONE home, lib/catalogue-write.js.
 * @type guard
 * OWNS      the guard that fails when any file in routes/ defines its own copy of the product-schema validator (validateAgainst, schemaFieldsOf,
 *           fieldRefusal, numberRefusal, unitRefusal, sharedKeyRefusal) instead of taking it from lib/catalogue-write.js; and that routes/products.js
 *           still takes validateAgainst + schemaFieldsOf from the library. The detector is itself proved on a synthetic duplicate.
 * CALLED BY scripts/guards.cjs · CI. Source scan only; no database.
 * FLOW      read routes/*.js → find a definition of a validator name → none allowed; the library must export the names
 *   node tests/cat-120-one-validator.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { API, ok, done } = require('./lib/cat-proof-kit.cjs');
const NAMES = ['validateAgainst', 'schemaFieldsOf', 'fieldRefusal', 'numberRefusal', 'unitRefusal', 'sharedKeyRefusal'];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
/** the validator names a source DEFINES (function declaration, or name = function / arrow) — importing or calling one is not a definition */
function definitions(source) {
  const code = stripComments(source);
  return NAMES.filter((n) => {
    const declared = new RegExp('function\\s+' + n + '\\s*\\(');
    const assigned = new RegExp('\\b' + n + '\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)');
    return declared.test(code) || assigned.test(code);
  });
}
const dir = path.join(API, 'routes');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
ok('the scan sees the routes folder (more than 20 files)', files.length > 20, files.length);
const dupes = [];
for (const f of files) for (const n of definitions(fs.readFileSync(path.join(dir, f), 'utf8'))) dupes.push(f + ':' + n);
ok('no route defines its own product-schema validator', dupes.length === 0, dupes.join(', '));
ok('the detector sees a copy (function form and arrow form) and ignores an import',
  definitions('function validateAgainst(rows, data) { return null; }').includes('validateAgainst')
  && definitions('const schemaFieldsOf = async (id) => []').includes('schemaFieldsOf')
  && definitions('const { schemaFieldsOf, validateAgainst } = catwrite;').length === 0
  && definitions('router.validateAgainst = validateAgainst;').length === 0);
const products = fs.readFileSync(path.join(dir, 'products.js'), 'utf8');
ok('routes/products.js takes validateAgainst and schemaFieldsOf from the library', /const\s*\{\s*schemaFieldsOf\s*,\s*validateAgainst\s*\}\s*=\s*catwrite\s*;/.test(products));
const lib = require(path.join(API, 'lib', 'catalogue-write.js'));
ok('the library exports validateAgainst and schemaFieldsOf (the one home)', typeof lib.validateAgainst === 'function' && typeof lib.schemaFieldsOf === 'function');
done();
