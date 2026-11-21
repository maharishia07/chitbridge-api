'use strict';
/* TP-10 (price-gorilla-truth, S41 CI): the same rate pressed again changes nothing. catalogue-write's nullStaleKind stores tax_kind: null beside a non-zero rate;
   slabPatchOf must read that stored null as "no kind" and not patch it again (changed:true forever). The function is read from the route's source (the route needs a database). */
const assert = require('assert');
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'till.js'), 'utf8');
const at = src.indexOf('function slabPatchOf(');
const body = src.slice(at, src.indexOf('\n}\n', at) + 3);
const taxSlab = require('../lib/tax-slab');
const slabPatchOf = new Function('taxSlab', body + '; return slabPatchOf;')(taxSlab); // eslint-disable-line no-new-func
const slab = { id: 'slab-5', name: 'GST 5%', rate: 5 };
const stored = { name: 'Rice', tax_slab: 'slab-5', tax_slab_name: 'GST 5%', gst_rate: 5, tax_kind: null };
assert.deepStrictEqual(slabPatchOf(stored, slab), {}, 'a stored tax_kind null is not a change');
assert.deepStrictEqual(slabPatchOf({ name: 'Rice', tax_kind: 'zero_rated', gst_rate: 0 }, slab).tax_kind, null, 'a real stale kind is still removed');
assert.ok(Object.keys(slabPatchOf({ name: 'Rice' }, slab)).includes('gst_rate'), 'a new slab still patches');
console.log('ok the same rate again patches nothing');
