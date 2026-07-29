'use strict';
/**
 * powerplay-itr2.js — CAPABILITY PROBE: can the catalogue, as deployed today, carry a real form workflow?
 *
 * The scenario Athi set (2026-07-29):
 *   "assume ITR2 is in the catalogue and Form 16 provided as the input, can ITR2 be filled with details?
 *    …the customer may load the Form 16, the data should autopopulate, and then the ITR2 form AND the Form 16
 *    should reach the store."
 *
 * This probe runs the scenario against the REAL deployed module (lib/order-input.js) — no DB, no server, no mocks of
 * our own code — and reports honestly which parts work TODAY and which do not.
 *
 *   Run:  node scripts/powerplay-itr2.js
 *
 * ⚠️ HONESTY NOTE: the real ITR-2 is specified by the Income Tax Department and is far larger than this. The schema
 * below is an ILLUSTRATIVE SUBSET chosen to exercise the mechanism — salary, Chapter VI-A, TDS — not a filing-grade
 * implementation, and nothing here is tax advice. The point is the RAIL, not the return.
 */
const OI = require('../lib/order-input');

const B = (s) => '\x1b[1m' + s + '\x1b[0m';
const G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m';
const Y = (s) => '\x1b[33m' + s + '\x1b[0m';
const line = (c) => console.log(c.repeat(78));

// ── 1. THE CATALOGUE — a store whose catalogue IS a set of forms; ITR-2 is one item ───────────────────────────
// This is exactly the declaration shipped on 2026-07-28: preset 'form' → payload pipeline → declared fields.
const ITR2_DECLARATION = {
  preset: 'form',
  schema: {
    properties: {
      // Part A — General
      pan:                    { type: 'string', maxLength: 10 },
      assessment_year:        { type: 'string', enum: ['2025-26', '2026-27'] },
      residential_status:     { type: 'string', enum: ['Resident', 'Non-Resident', 'RNOR'] },
      // Schedule S — Salary
      gross_salary_17_1:      { type: 'number' },
      perquisites_17_2:       { type: 'number' },
      exempt_allowances_s10:  { type: 'number' },
      standard_deduction_16ia:{ type: 'number' },
      professional_tax_16iii: { type: 'number' },
      income_from_salary:     { type: 'number' },
      // Chapter VI-A
      deduction_80c:          { type: 'number' },
      deduction_80d:          { type: 'number' },
      // Schedule TDS
      employer_tan:           { type: 'string', maxLength: 10 },
      tds_deducted:           { type: 'number' },
      // NOT derivable from Form 16 — the return needs them, the certificate does not carry them
      capital_gains_total:    { type: 'number' },
      house_property_income:  { type: 'number' },
      foreign_assets_held:    { type: 'boolean' },
      bank_account_ifsc:      { type: 'string', maxLength: 11 },
    },
    required: ['pan', 'assessment_year', 'income_from_salary', 'employer_tan', 'bank_account_ifsc'],
  },
};

// ── 2. THE INPUT — a Form 16 (TDS certificate the employer issues) ────────────────────────────────────────────
const FORM_16 = {
  _doc: 'Form 16 (AY 2026-27)',
  part_a: { employer_tan: 'BLRA12345F', employee_pan: 'ABCDE1234F', assessment_year: '2026-27', total_tds: 184500 },
  part_b: {
    salary_us_17_1: 1850000, perquisites_us_17_2: 42000, profits_in_lieu_17_3: 0,
    allowances_exempt_us_10: 96000, standard_deduction_us_16_ia: 75000, professional_tax_us_16_iii: 2400,
    income_chargeable_salaries: 1718600,
    chapter_via: { s_80c: 150000, s_80d: 25000 },
  },
};

// ── 3. THE MAPPER — Form 16 → ITR-2. Deterministic, rule-based; no AI needed for a fixed, published pair. ─────
// This is the piece that does NOT exist in the product yet. It is small and honest, which is the finding.
function mapForm16ToItr2(f16) {
  const a = f16.part_a || {}, b = f16.part_b || {}, via = b.chapter_via || {};
  return {
    pan:                     a.employee_pan,
    assessment_year:         a.assessment_year,
    gross_salary_17_1:       b.salary_us_17_1,
    perquisites_17_2:        b.perquisites_us_17_2,
    exempt_allowances_s10:   b.allowances_exempt_us_10,
    standard_deduction_16ia: b.standard_deduction_us_16_ia,
    professional_tax_16iii:  b.professional_tax_us_16_iii,
    income_from_salary:      b.income_chargeable_salaries,
    deduction_80c:           via.s_80c,
    deduction_80d:           via.s_80d,
    employer_tan:            a.employer_tan,
    tds_deducted:            a.total_tds,
  };
}

// ── RUN ───────────────────────────────────────────────────────────────────────────────────────────────────────
line('═');
console.log(B('  POWERPLAY — ITR-2 in the catalogue, Form 16 as the input'));
console.log('  probing the DEPLOYED implementation (lib/order-input.js), not a mock');
line('═');

const oi = OI.resolve(ITR2_DECLARATION);
const declared = Object.keys(oi.schema.properties);
const required = oi.schema.required || [];

console.log('\n' + B('1 · The catalogue declares ITR-2 as a form'));
console.log('   preset          : ' + oi.preset);
console.log('   pipeline        : ' + oi.pipeline + (oi.pipeline === 'payload' ? G('  ✓ no price, no quantity — correct for a form') : R('  ✗ WRONG')));
console.log('   declared fields : ' + declared.length + '   required: ' + required.length);

console.log('\n' + B('2 · The customer loads a Form 16; we map it onto the declared fields'));
const mapped = mapForm16ToItr2(FORM_16);
const filled = Object.keys(mapped).filter((k) => mapped[k] !== undefined && mapped[k] !== null);
const missing = declared.filter((k) => filled.indexOf(k) < 0);
console.log('   autopopulated   : ' + G(filled.length + ' of ' + declared.length) + '  → ' + filled.join(', '));
console.log('   still needed    : ' + Y(missing.length + ' field(s)') + '  → ' + missing.join(', '));
console.log('   ' + Y('WHY:') + ' a Form 16 is a salary certificate. Capital gains, house property, foreign assets and');
console.log('   the refund bank account are simply not in it — no extractor can conjure them. This is the four-leg');
console.log('   story in miniature: one leg (the document) fills what it owns; the customer supplies the rest.');

console.log('\n' + B('3 · Validate the autopopulated draft against the DECLARED schema (real module)'));
const draft = OI.validate(mapped, oi.schema);
console.log('   valid as a submission? ' + (draft.ok ? G('yes') : R('no')));
if (!draft.ok) draft.errors.forEach((e) => console.log('     · ' + e));
console.log('   ' + (draft.ok ? '' : Y('EXPECTED — the required bank account (a refund destination) is not in a Form 16.')));

console.log('\n' + B('4 · Customer completes the remainder, then submits'));
const completed = Object.assign({}, mapped, {
  residential_status: 'Resident', capital_gains_total: 0, house_property_income: 0,
  foreign_assets_held: false, bank_account_ifsc: 'HDFC0001234',
});
const final = OI.validate(completed, oi.schema);
console.log('   valid as a submission? ' + (final.ok ? G('yes') : R('no ' + final.errors.join('; '))));
console.log('   coerced correctly?     ' + (typeof final.value.tds_deducted === 'number' && final.value.foreign_assets_held === false ? G('yes (numbers + booleans typed)') : R('no')));

console.log('\n' + B('5 · Guards still hold on a form catalogue'));
const junk = OI.validate(Object.assign({}, completed, { price: 5000, quantity: 3 }), oi.schema);
console.log('   commerce fields smuggled in are rejected : ' + (!junk.ok && junk.errors.join().includes('not accepted') ? G('yes') : R('no')));
const short = OI.validate({ pan: 'ABCDE1234F' }, oi.schema);
console.log('   missing required fields are rejected     : ' + (!short.ok ? G('yes (' + short.errors.length + ' errors)') : R('no')));

line('─');
console.log(B('  VERDICT — against the implementation deployed today'));
line('─');
console.log(G('  WORKS NOW') + '  (no new code)');
console.log('   • ITR-2 declared as a catalogue item, on the payload pipeline — no price/quantity demanded');
console.log('   • the storefront renders those declared fields (shop.html _schemaFields)');
console.log('   • the submission is validated against the declaration and travels as a co-held chit');
console.log('   • a filled form is governed exactly like an order: per-copy, RLS-isolated, disputable');
console.log(R('\n  DOES NOT WORK YET') + '  (the two interesting halves)');
console.log('   • ' + R('FILE UPLOAD on the order path') + ' — shop.html has ONE file input and it is the');
console.log('     visualize-apply room photo, held client-side and never uploaded. order/confirm accepts no');
console.log('     attachment. So the customer cannot "load the Form 16" today.');
console.log('   • ' + R('EXTRACTION from the document') + ' — mapForm16ToItr2() above is a script-local mapper. There');
console.log('     is no PDF/OCR reader and no field-mapping engine in the product. /api/governance/ai-draft exists');
console.log('     (b113, text-only) and would be the natural seam, but nothing calls it for this.');
console.log('   • ' + R('THE DOCUMENT REACHING THE STORE') + ' — the filled form reaches the store as the chit payload,');
console.log('     but the Form 16 itself has no path onto that chit. Athi asked for BOTH to arrive; today only one can.');
console.log(Y('\n  SMALLEST HONEST NEXT STEP'));
console.log('   The mapper is the cheap part — for a fixed published pair it is a table, not AI. The real gap is');
console.log('   carrying the source document with the submission. That is the SAME gap as attachments-on-a-chit,');
console.log('   which already exists elsewhere (cb_attachment, per-entity-per-copy). Wiring the storefront submission');
console.log('   to it is a contained piece of work — and it is what SPEC-authority-forms calls the forms engine');
console.log('   (fields × source precedence), now with a declared schema underneath it that did not exist before.');
line('═');
