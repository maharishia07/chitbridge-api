#!/usr/bin/env node
// @type: unit
/**
 * tests/trace-edge.test.cjs — THE TRACEABILITY EDGE: NO SILENT HOLES, NO FALSE UNITS (lib/trace.js).
 * UNIT      13 INVENTORY / STOCK & TRACEABILITY / Batch traceability & mass balance (test = 0.5: `T: traceability-massbalance` needs a running server)
 * OWNS      the offline half of the mass-balance chain, the part the server tests could only reach through HTTP: a non-origin handoff must carry at least one
 *           valid parent (is_origin must be the boolean true, not a truthy string) · parents are de-duplicated and non-UUIDs dropped · kg/g/mg/ton and l/ml convert
 *           to ONE base unit so a mass balance compares like with like · an unknown unit converts to itself and says unit_known:false so a balance refuses to compare
 *           it · text fields are capped · a network scope only keeps a UUID operator · an edge that is not an object is refused in words.
 * CALLED BY scripts/guards.cjs · CI. Pure: no database, no network.
 * FLOW      buildEdge(input) → { edge } | { error } → asserted
 * CARD      13-inventory-stock-and-traceability/batch-traceability-and-mass-balance
 * NOTE      the quantity coercion holes found while writing this (null/""/[] read as 0, a negative quantity accepted, base_qty 0 beside qty null) are NOT asserted
 *           here: they are written up in PM/COVERAGE-GAPS-2026-11-06.md and proved failing by tests/trace-edge-qty.known-failing.cjs (outside the guard list).
 */
'use strict';
const assert = require('assert');
const path = require('path');
const trace = require(path.join(__dirname, '..', 'lib', 'trace.js'));

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let checks = 0;
function it(what, fn) { fn(); checks++; console.log('  ok  ' + what); }

it('no trace declared (null or undefined) is not a traceability handoff: edge null, no error', () => {
  assert.deepStrictEqual(trace.buildEdge(null), { edge: null });
  assert.deepStrictEqual(trace.buildEdge(undefined), { edge: null });
});

it('refusal: a trace that is a string, number or array is refused in words', () => {
  for (const bad of ['batch 7', 42, [P1], true]) {
    const r = trace.buildEdge(bad);
    assert.strictEqual(r.error, 'trace must be an object', JSON.stringify(bad));
    assert.strictEqual(r.edge, undefined);
  }
});

it('refusal: a non-origin handoff with no parent is "no silent holes"', () => {
  const r = trace.buildEdge({ product: 'Rice', qty: 5, unit: 'kg' });
  assert.ok(/no silent holes/.test(r.error), JSON.stringify(r));
  assert.ok(trace.buildEdge({ parents: [], qty: 1 }).error);
});

it('refusal: only a parent that is a real UUID counts — junk parents are dropped, so junk alone is still a hole', () => {
  assert.ok(trace.buildEdge({ parents: ['not-a-uuid', 7, null, {}, 'aaaaaaaa-aaaa-4aaa-8aaa'] }).error);
  assert.deepStrictEqual(trace.buildEdge({ parents: ['junk', P1, 5] }).edge.parents, [P1]);
});

it('is_origin is the boolean true and nothing truthier: the string "true", 1 and "yes" do not excuse missing parents', () => {
  for (const claim of ['true', 1, 'yes', {}]) assert.ok(trace.buildEdge({ is_origin: claim }).error, 'accepted as origin: ' + JSON.stringify(claim));
  const ok = trace.buildEdge({ is_origin: true });
  assert.strictEqual(ok.edge.is_origin, true);
  assert.deepStrictEqual(ok.edge.parents, []);
});

it('parents are a SET: duplicates collapse, order of first sight kept, UUID case accepted', () => {
  const e = trace.buildEdge({ parents: [P1, P2, P1, P2.toUpperCase(), P1] }).edge;
  assert.deepStrictEqual(e.parents, [P1, P2, P2.toUpperCase()].filter((x, i, a) => a.indexOf(x) === i));
  assert.strictEqual(new Set(e.parents).size, e.parents.length);
});

it('units convert to one base: 2 kg = 2000 g, 1 tonne = 1,000,000 g, 500 mg = 0.5 g, 3 l = 3000 ml, 12 strips = 12 unit', () => {
  const b = (qty, unit) => trace.toBase(qty, unit);
  assert.deepStrictEqual(b(2, 'kg'), { base_qty: 2000, base_unit: 'g', unit_known: true });
  assert.deepStrictEqual(b(1, 'tonne'), { base_qty: 1000000, base_unit: 'g', unit_known: true });
  assert.deepStrictEqual(b(500, 'mg'), { base_qty: 0.5, base_unit: 'g', unit_known: true });
  assert.deepStrictEqual(b(3, 'l'), { base_qty: 3000, base_unit: 'ml', unit_known: true });
  assert.deepStrictEqual(b(12, 'strips'), { base_qty: 12, base_unit: 'unit', unit_known: true });
});

it('the unit is read without case or padding: " KG " is kilograms', () => {
  assert.strictEqual(trace.toBase(1, ' KG ').base_qty, 1000);
  assert.strictEqual(trace.toBase(1, 'Litre').base_unit, 'ml');
});

it('an unknown unit converts to ITSELF and says so — never a false normalisation that a balance would trust', () => {
  const r = trace.toBase(7, 'bag');
  assert.deepStrictEqual(r, { base_qty: 7, base_unit: 'bag', unit_known: false });
  const noUnit = trace.toBase(7, '');
  assert.strictEqual(noUnit.unit_known, false);
  assert.strictEqual(noUnit.base_unit, null);
});

it('kg and l never share a base: a mass cannot balance against a volume', () => {
  assert.notStrictEqual(trace.toBase(1, 'kg').base_unit, trace.toBase(1, 'l').base_unit);
  assert.notStrictEqual(trace.toBase(1, 'kg').base_unit, trace.toBase(1, 'unit').base_unit);
});

it('property: every declared unit maps to a base that is itself declared with factor 1 (a base is its own base)', () => {
  for (const [name, c] of Object.entries(trace.UNIT_BASE)) {
    const base = trace.UNIT_BASE[c.base];
    assert.ok(base, name + ' points at an undeclared base ' + c.base);
    assert.strictEqual(base.f, 1, c.base + ' is not its own base');
    assert.strictEqual(base.base, c.base);
    assert.ok(c.f > 0, name + ' has a non-positive factor');
  }
});

it('a full edge keeps the frozen base figures beside the declared ones', () => {
  const e = trace.buildEdge({ parents: [P1], product: ' Basmati ', qty: '25', unit: ' kg ' }).edge;
  assert.strictEqual(e.product, 'Basmati');
  assert.strictEqual(e.qty, 25);
  assert.strictEqual(e.unit, 'kg');
  assert.strictEqual(e.base_qty, 25000);
  assert.strictEqual(e.base_unit, 'g');
  assert.strictEqual(e.unit_known, true);
  assert.strictEqual(e.is_origin, false);
});

it('text is capped: a product over 120 characters and a unit over 24 are cut, not stored whole', () => {
  const e = trace.buildEdge({ is_origin: true, product: 'P'.repeat(500), unit: 'u'.repeat(90) }).edge;
  assert.strictEqual(e.product.length, 120);
  assert.strictEqual(e.unit.length, 24);
});

it('a blank product or unit is null, not an empty string', () => {
  const e = trace.buildEdge({ is_origin: true, product: '   ', unit: '' }).edge;
  assert.strictEqual(e.product, null);
  assert.strictEqual(e.unit, null);
});

it('a network scope keeps its id, and the operator ONLY when it is a UUID — a name cannot be a co-holder', () => {
  const ok = trace.buildEdge({ is_origin: true, network: { id: 'net-9', operator: OP } }).edge;
  assert.deepStrictEqual(ok.network, { id: 'net-9', operator: OP });
  const bad = trace.buildEdge({ is_origin: true, network: { id: 'net-9', operator: 'the-operator' } }).edge;
  assert.deepStrictEqual(bad.network, { id: 'net-9', operator: null });
  assert.strictEqual('network' in trace.buildEdge({ is_origin: true, network: { operator: 'x' } }).edge, false, 'a scope with nothing valid in it was kept');
  assert.strictEqual('network' in trace.buildEdge({ is_origin: true, network: [OP] }).edge, false);
});

it('the edge is built from its own fields only: unknown keys on the input never ride into the frozen body', () => {
  const e = trace.buildEdge({ is_origin: true, qty: 1, unit: 'kg', price: 999, secret: 'x', __proto__: { admin: true } }).edge;
  assert.deepStrictEqual(Object.keys(e).sort(), ['base_qty', 'base_unit', 'is_origin', 'parents', 'product', 'qty', 'unit', 'unit_known']);
});

console.log('\n  ' + checks + ' checks');
console.log('  ' + checks + ' passed');
