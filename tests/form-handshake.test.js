'use strict';
// Regression — the FORM × INPUT handshake (lib/form-handshake.js).
//
// The requirement it must prove: nothing about tax is in the engine. ITR-2 and Form 16 are DATA; swap in a completely
// different form and a completely different input and the same code must work with zero changes. And the coverage the
// catalogue owner is shown at BUILD time must equal what the customer actually experiences at FILL time — same
// function, two call sites.
// Run:  node tests/form-handshake.test.js
const assert = require('node:assert');
const FH = require('../lib/form-handshake');
const OI = require('../lib/order-input');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };

// ── SCENARIO A — tax: ITR-2 filled from a Form 16 ──
const ITR2 = OI.resolve({ preset: 'form', schema: { properties: {
  pan: { type: 'string' }, assessment_year: { type: 'string' }, income_from_salary: { type: 'number' },
  deduction_80c: { type: 'number' }, employer_tan: { type: 'string' }, tds_deducted: { type: 'number' },
  capital_gains_total: { type: 'number' }, bank_account_ifsc: { type: 'string' },
}, required: ['pan', 'income_from_salary', 'bank_account_ifsc'] } }).schema;
const FORM16_SRC = { key: 'form_16', label: 'Form 16', map: {
  'part_a.employee_pan': 'pan', 'part_a.assessment_year': 'assessment_year', 'part_a.total_tds': 'tds_deducted',
  'part_a.employer_tan': 'employer_tan', 'part_b.income_chargeable_salaries': 'income_from_salary',
  'part_b.chapter_via.s_80c': 'deduction_80c',
} };
const FORM16_DOC = { part_a: { employee_pan: 'ABCDE1234F', assessment_year: '2026-27', total_tds: 184500, employer_tan: 'BLRA12345F' },
                     part_b: { income_chargeable_salaries: 1718600, chapter_via: { s_80c: 150000 } } };

// ── SCENARIO B — trade: a Commercial Invoice filled from a Purchase Order. SAME ENGINE, ZERO CODE CHANGE. ──
const INVOICE = OI.resolve({ preset: 'form', schema: { properties: {
  buyer_name: { type: 'string' }, po_number: { type: 'string' }, incoterm: { type: 'string' },
  goods_description: { type: 'string' }, total_value: { type: 'number' }, currency: { type: 'string' },
  vessel_name: { type: 'string' }, bl_number: { type: 'string' },
}, required: ['buyer_name', 'total_value', 'bl_number'] } }).schema;
const PO_SRC = { key: 'purchase_order', label: 'Purchase Order', map: {
  'header.buyer': 'buyer_name', 'header.po_no': 'po_number', 'terms.incoterm': 'incoterm',
  'lines.0.description': 'goods_description', 'totals.grand_total': 'total_value', 'totals.ccy': 'currency',
} };
const PO_DOC = { header: { buyer: 'Acme GmbH', po_no: 'PO-77812' }, terms: { incoterm: 'FOB' },
                 lines: { 0: { description: 'Cold-rolled coil' } }, totals: { grand_total: 48250, ccy: 'EUR' } };

// ── BUILD TIME — what the catalogue owner is told, before any document exists ──
t('BUILD: coverage is computed from declarations alone — no document needed', () => {
  const c = FH.coverage(ITR2, [FORM16_SRC]);
  assert.strictEqual(c.covered.length, 6);
  assert.strictEqual(c.declared.length, 8);
  assert.deepStrictEqual(c.residue.sort(), ['bank_account_ifsc', 'capital_gains_total']);
  assert.deepStrictEqual(c.requiredResidue, ['bank_account_ifsc'], 'the owner must be warned which GAPS are required');
});
t('BUILD: the wizard one-liner reads in plain language', () => {
  const s = FH.summarise(FH.coverage(ITR2, [FORM16_SRC]), [FORM16_SRC]);
  assert.match(s, /Form 16 → fills 6 of 8 \(75%\); 2 left for the customer, 1 of them required/);
});

// ── GENERIC — the whole point ──
t('GENERIC: a different form + a different input works with ZERO code change', () => {
  const c = FH.coverage(INVOICE, [PO_SRC]);
  assert.strictEqual(c.covered.length, 6);
  assert.deepStrictEqual(c.residue.sort(), ['bl_number', 'vessel_name']);
  assert.deepStrictEqual(c.requiredResidue, ['bl_number']);
});
t('GENERIC: the engine contains no domain vocabulary at all', () => {
  const src = require('node:fs').readFileSync(require.resolve('../lib/form-handshake.js'), 'utf8');
  const body = src.split('*/').slice(1).join('*/');            // strip the header comment, which cites the example
  for (const word of ['itr', 'form_16', 'form16', 'pan', 'invoice', 'incoterm', 'salary', 'tax']) {
    assert.ok(!new RegExp('\\b' + word + '\\b', 'i').test(body), `engine code mentions "${word}" — it must be data, not code`);
  }
});

// ── FILL TIME — must agree with what BUILD time promised ──
t('FILL: resolve() fills exactly what coverage() promised', () => {
  const c = FH.coverage(ITR2, [FORM16_SRC]);
  const r = FH.resolve(ITR2, [FORM16_SRC], { form_16: FORM16_DOC });
  assert.deepStrictEqual(r.filled.sort(), c.covered.sort(), 'build-time promise must equal fill-time reality');
  assert.deepStrictEqual(r.residue.sort(), c.residue.sort());
});
t('FILL: values are correct and reach nested paths', () => {
  const r = FH.resolve(ITR2, [FORM16_SRC], { form_16: FORM16_DOC });
  assert.strictEqual(r.value.income_from_salary, 1718600);
  assert.strictEqual(r.value.deduction_80c, 150000);
  assert.strictEqual(r.value.pan, 'ABCDE1234F');
});
t('FILL: every value carries PROVENANCE — a contested number is traceable', () => {
  const r = FH.resolve(ITR2, [FORM16_SRC], { form_16: FORM16_DOC });
  assert.deepStrictEqual(r.provenance.income_from_salary,
    { source: 'form_16', label: 'Form 16', path: 'part_b.income_chargeable_salaries', filled_by: 'document' });
});
t('FILL: the same engine resolves the trade scenario', () => {
  const r = FH.resolve(INVOICE, [PO_SRC], { purchase_order: PO_DOC });
  assert.strictEqual(r.value.total_value, 48250);
  assert.strictEqual(r.value.goods_description, 'Cold-rolled coil');
  assert.deepStrictEqual(r.missingRequired, ['bl_number']);
});

// ── MULTI-SOURCE — Athi's "a couple more details": add a source, the residue shrinks ──
const CHEQUE = { key: 'cheque_scan', label: 'Cancelled cheque', map: { 'bank.ifsc': 'bank_account_ifsc' } };
t('MULTI: adding a second source shrinks the residue', () => {
  const before = FH.coverage(ITR2, [FORM16_SRC]);
  const after  = FH.coverage(ITR2, [FORM16_SRC, CHEQUE]);
  assert.strictEqual(before.residue.length, 2);
  assert.strictEqual(after.residue.length, 1, 'the cheque must remove the bank field from the ask');
  assert.deepStrictEqual(after.requiredResidue, [], 'nothing required is left outstanding');
});
t('MULTI: precedence is declaration order — the first source wins a contested field', () => {
  const OTHER = { key: 'other', label: 'Other', map: { 'x.pan': 'pan' } };
  const r = FH.resolve(ITR2, [FORM16_SRC, OTHER], { form_16: FORM16_DOC, other: { x: { pan: 'ZZZZZ9999Z' } } });
  assert.strictEqual(r.value.pan, 'ABCDE1234F', 'the earlier-declared source must win');
  assert.strictEqual(r.provenance.pan.source, 'form_16');
});

// ── GUARDS ──
t('GUARD: a source cannot invent a field the form did not declare', () => {
  const SNEAK = { key: 'sneak', label: 'Sneak', map: { 'a.b': 'not_a_declared_field' } };
  const c = FH.coverage(ITR2, [SNEAK]);
  assert.strictEqual(c.covered.length, 0);
  const r = FH.resolve(ITR2, [SNEAK], { sneak: { a: { b: 'x' } } });
  assert.strictEqual(r.value.not_a_declared_field, undefined, 'the form declaration is the only gate');
});
t('GUARD: a missing or partial document degrades, never throws', () => {
  assert.doesNotThrow(() => FH.resolve(ITR2, [FORM16_SRC], {}));
  const r = FH.resolve(ITR2, [FORM16_SRC], { form_16: { part_a: { employee_pan: 'ABCDE1234F' } } });
  assert.strictEqual(r.filled.length, 1);
  assert.ok(r.missingRequired.includes('income_from_salary'));
});
t('GUARD: prototype paths cannot be walked', () => {
  const EVIL = { key: 'evil', label: 'Evil', map: { '__proto__.polluted': 'pan', 'constructor.name': 'assessment_year' } };
  const r = FH.resolve(ITR2, [EVIL], { evil: {} });
  assert.strictEqual(r.value.pan, undefined);
  assert.strictEqual(r.value.assessment_year, undefined);
  assert.strictEqual({}.polluted, undefined, 'no prototype pollution');
});
t('GUARD: no sources at all → everything is the residue, nothing crashes', () => {
  const c = FH.coverage(ITR2, []);
  assert.strictEqual(c.covered.length, 0);
  assert.strictEqual(c.residue.length, c.declared.length);
  assert.strictEqual(c.pct, 0);
});

// ── the handshake output feeds the DEPLOYED validator unchanged ──
t('the resolved draft validates through lib/order-input.js (one pipeline, not two)', () => {
  const r = FH.resolve(ITR2, [FORM16_SRC, CHEQUE], { form_16: FORM16_DOC, cheque_scan: { bank: { ifsc: 'HDFC0001234' } } });
  const v = OI.validate(r.value, ITR2);
  assert.strictEqual(v.ok, true, v.errors.join('; '));
  assert.strictEqual(typeof v.value.tds_deducted, 'number');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
