'use strict';
/**
 * prototype-form16-to-itr2.js — A REAL PDF FILLS A REAL FORM, end to end.
 *
 * Athi: "prototype Form 16 to ITR-2 extraction end to end."
 *
 * The chain, with nothing faked in the middle:
 *   1. build a DIGITAL Form 16 pdf (standard structure, real text layer)
 *   2. read it with pdfjs — a genuine PDF parse, not a format shaped to suit us
 *   3. LABEL-ANCHORED PATTERNS pull the values out (deterministic; no model can invent a number here)
 *   4. lib/form-handshake.js maps them onto the ITR-2 declaration, with per-field PROVENANCE
 *   5. lib/order-input.js validates the result against the catalogue's real schema
 *   6. …and the residue — what a Form 16 genuinely cannot supply — is what the customer is asked for
 *   7. optionally SUBMIT it to the live storefront with the PDF attached, and read the chit back
 *
 *   node scripts/prototype-form16-to-itr2.js               offline: steps 1-6
 *   node scripts/prototype-form16-to-itr2.js --submit      also 7, against the live API
 *
 * ⚠️ pdfjs is loaded from a SCRATCH install, deliberately NOT added to package.json. Whether the engine takes a PDF
 *    dependency — and whether extraction runs server-side at all, rather than in the customer's browser — is a real
 *    decision, not something a prototype should make by adding a line to a manifest.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { makeForm16Pdf } = require('./lib-make-form16-pdf');
const FH = require('../lib/form-handshake');
const OI = require('../lib/order-input');

const B = (s) => '\x1b[1m' + s + '\x1b[0m', G = (s) => '\x1b[32m' + s + '\x1b[0m';
const R = (s) => '\x1b[31m' + s + '\x1b[0m', Y = (s) => '\x1b[33m' + s + '\x1b[0m', D = (s) => '\x1b[2m' + s + '\x1b[0m';
const hr = (c) => console.log((c || '─').repeat(84));

const PDFJS_PATHS = [
  process.env.PDFJS_PATH,
  path.join(process.env.LOCALAPPDATA || '', 'Temp', 'claude', 'C--users-mahar',
            '718d3216-c801-4e6b-bb44-35b8930be8fd', 'scratchpad', 'pdflab', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'),
].filter(Boolean);

// ── 3 · THE PATTERN TABLE — one entry per field a Form 16 can supply ─────────────────────────────────────────
// Label-anchored, deterministic, auditable. This is "a table, not AI": for a fixed published pair the mapping is
// knowable, and a lookup cannot hallucinate a number onto a tax return. AI belongs only on what patterns MISS,
// proposed and human-confirmed — never sealed as fact on its own.
const PATTERNS = [
  { field: 'employee_pan',      re: /PAN of the Employee\s*:?\s*([A-Z]{5}[0-9]{4}[A-Z])/i,        cast: String },
  { field: 'employer_tan',      re: /TAN of the Deductor\s*:?\s*([A-Z]{4}[0-9]{5}[A-Z])/i,        cast: String },
  { field: 'assessment_year',   re: /Assessment Year\s*:?\s*(\d{4}-\d{2})/i,                      cast: String },
  { field: 'total_tds',         re: /tax deducted at source\s*:?\s*([\d,]+\.?\d*)/i,              cast: num },
  { field: 'salary_17_1',       re: /section\s*17\(1\)\s*:?\s*([\d,]+\.?\d*)/i,                   cast: num },
  { field: 'perquisites_17_2',  re: /section\s*17\(2\)\s*:?\s*([\d,]+\.?\d*)/i,                   cast: num },
  { field: 'exempt_s10',        re: /exempt under section 10\s*:?\s*([\d,]+\.?\d*)/i,             cast: num },
  { field: 'std_deduction',     re: /section\s*16\(ia\)\s*:?\s*([\d,]+\.?\d*)/i,                  cast: num },
  { field: 'professional_tax',  re: /section\s*16\(iii\)\s*:?\s*([\d,]+\.?\d*)/i,                 cast: num },
  { field: 'income_salaries',   re: /Income chargeable under the head Salaries\s*:?\s*([\d,]+\.?\d*)/i, cast: num },
  { field: 'deduction_80c',     re: /section\s*80C\s*:?\s*([\d,]+\.?\d*)/i,                       cast: num },
  { field: 'deduction_80d',     re: /section\s*80D\s*:?\s*([\d,]+\.?\d*)/i,                       cast: num },
];
function num(s) { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; }

// the extracted Form 16 becomes a SOURCE declaration — the same shape any other input uses
const FORM16_SOURCE = { key: 'form_16', label: 'Form 16 (TDS certificate)', map: {
  employee_pan: 'pan', assessment_year: 'assessment_year', employer_tan: 'employer_tan', total_tds: 'tds_deducted',
  salary_17_1: 'gross_salary_17_1', perquisites_17_2: 'perquisites_17_2', exempt_s10: 'exempt_allowances_s10',
  std_deduction: 'standard_deduction_16ia', professional_tax: 'professional_tax_16iii',
  income_salaries: 'income_from_salary', deduction_80c: 'deduction_80c', deduction_80d: 'deduction_80d' } };

// the catalogue's ITR-2 declaration (illustrative subset — the real ITR-2 is ITD-specified and far larger)
const ITR2 = OI.resolve({ preset: 'form', schema: { properties: {
  pan:                     { type: 'string', maxLength: 10 },
  assessment_year:         { type: 'string', enum: ['2025-26', '2026-27'] },
  employer_tan:            { type: 'string', maxLength: 10 },
  tds_deducted:            { type: 'number' },
  gross_salary_17_1:       { type: 'number' },
  perquisites_17_2:        { type: 'number' },
  exempt_allowances_s10:   { type: 'number' },
  standard_deduction_16ia: { type: 'number' },
  professional_tax_16iii:  { type: 'number' },
  income_from_salary:      { type: 'number' },
  deduction_80c:           { type: 'number' },
  deduction_80d:           { type: 'number' },
  // a Form 16 genuinely cannot supply these — that is the point, not a gap
  capital_gains_total:     { type: 'number' },
  house_property_income:   { type: 'number' },
  foreign_assets_held:     { type: 'boolean' },
  bank_account_ifsc:       { type: 'string', maxLength: 11 },
  residential_status:      { type: 'string', enum: ['Resident', 'Non-Resident', 'RNOR'] },
}, required: ['pan', 'assessment_year', 'income_from_salary', 'bank_account_ifsc'] } });

async function extractText(pdfBuffer) {
  let mod = null, used = null;
  for (const p of PDFJS_PATHS) {
    try { if (p && fs.existsSync(p)) { mod = await import('file://' + p.replace(/\\/g, '/')); used = p; break; } } catch (_) {}
  }
  if (!mod) throw new Error('pdfjs not found. Install it somewhere and set PDFJS_PATH to .../pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await mod.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: false, isEvalSupported: false }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((it) => it.str).join(' ') + '\n';
  }
  return { text, pages: doc.numPages, via: used };
}

(async () => {
  hr('═'); console.log(B('  PROTOTYPE — a real Form 16 PDF fills a real ITR-2')); hr('═');

  // 1 · the document
  const pdf = makeForm16Pdf();
  const sha = crypto.createHash('sha256').update(pdf).digest('hex');
  console.log('\n' + B('1 · The document'));
  console.log('   ' + G('✓ ') + `Form 16 built — ${pdf.length} bytes · sha256 ${sha.slice(0, 24)}…`);

  // 2 · a genuine PDF parse
  console.log('\n' + B('2 · Read it (pdfjs — a real parse, not our own format)'));
  let text;
  try {
    const r = await extractText(pdf);
    text = r.text;
    console.log('   ' + G('✓ ') + `${r.pages} page(s), ${text.length} characters of text layer`);
    console.log('   ' + D(text.replace(/\s+/g, ' ').slice(0, 150) + '…'));
  } catch (e) { console.log('   ' + R('✗ ') + e.message); process.exit(1); }

  // 3 · deterministic extraction
  console.log('\n' + B('3 · Pull the values — label-anchored patterns, no model involved'));
  const doc16 = {}; const missed = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    const v = m ? p.cast(m[1]) : undefined;
    if (v === undefined) missed.push(p.field); else doc16[p.field] = v;
  }
  console.log('   ' + G('✓ ') + `${Object.keys(doc16).length} of ${PATTERNS.length} fields read from the PDF`);
  if (missed.length) console.log('   ' + Y('· ') + 'patterns that did not match: ' + missed.join(', '));
  Object.entries(doc16).slice(0, 4).forEach(([k, v]) => console.log('   ' + D(`    ${k.padEnd(20)} = ${v}`)));

  // 4 · the handshake — coverage first (what it WOULD fill), then the actual fill with provenance
  console.log('\n' + B('4 · Map onto ITR-2 (lib/form-handshake.js)'));
  const cov = FH.coverage(ITR2.schema, [FORM16_SOURCE]);
  console.log('   ' + G('✓ ') + FH.summarise(cov, [FORM16_SOURCE]));
  const res = FH.resolve(ITR2.schema, [FORM16_SOURCE], { form_16: doc16 });
  console.log('   ' + G('✓ ') + `filled ${res.filled.length} field(s) from the document`);
  const prov = res.provenance.income_from_salary;
  console.log('   ' + D(`    income_from_salary = ${res.value.income_from_salary}  ← ${prov ? prov.label + ' (' + prov.path + ')' : '?'}`));

  // 5 · validate the draft against the catalogue's real schema
  console.log('\n' + B('5 · Validate the draft (lib/order-input.js — the deployed validator)'));
  const draft = OI.validate(res.value, ITR2.schema);
  console.log('   ' + (draft.ok ? G('✓ valid already') : Y('· not yet valid: ') + draft.errors.join('; ')));

  // 6 · the residue — the honest part
  console.log('\n' + B('6 · What the customer is still asked for'));
  console.log('   ' + Y(res.residue.join(', ')));
  console.log('   ' + D('   a Form 16 is a salary certificate — capital gains, house property, foreign assets and a'));
  console.log('   ' + D('   refund account are simply not in it. No extractor can conjure them.'));

  const completed = { ...res.value, residential_status: 'Resident', capital_gains_total: 0,
                      house_property_income: 0, foreign_assets_held: false, bank_account_ifsc: 'HDFC0001234' };
  const final = OI.validate(completed, ITR2.schema);
  console.log('   ' + (final.ok ? G('✓ complete and valid once the residue is supplied') : R('✗ ' + final.errors.join('; '))));

  // 7 · optional live submission
  if (process.argv.includes('--submit')) {
    console.log('\n' + B('7 · Submit it to the live storefront, PDF attached'));
    const API = process.env.API || 'https://chitbridge-api-production.up.railway.app';
    const call = async (m, p, body, token) => {
      const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch (_) {}
      return { status: r.status, json: j };
    };
    try {
      const reg = await call('POST', '/api/entities/register', { email: 'gamma@test-cb.com', display_name: 'Gamma Document Services' });
      const ver = await call('POST', '/api/entities/verify', { email: 'gamma@test-cb.com', otp: (reg.json && reg.json.dev_otp) || '123456' });
      const shop = (ver.json && (ver.json.entity || ver.json)) || {};
      const sf = await call('GET', `/api/catalogue/${encodeURIComponent(shop.bridge_id)}`);
      const names = ((sf.json && sf.json.finishes) || []).flatMap((f) => (f.items || []).map((i) => i.name));
      const item = names.find((n) => /ITR/.test(n)) || names[0];
      if (!item) throw new Error('the Gamma store has no ITR-2 template — run scripts/reset-and-seed.js --go --skip-wipe');
      const who = 'form16.proto@test-cb.com';
      const start = await call('POST', `/api/catalogue/${encodeURIComponent(shop.bridge_id)}/order/start`, { identifier: who, name: 'Form16 prototype' });
      const conf = await call('POST', `/api/catalogue/${encodeURIComponent(shop.bridge_id)}/order/confirm`, {
        identifier: who, name: 'Form16 prototype', otp: (start.json && start.json.dev_otp) || '123123', location: 'Bengaluru',
        line_items: [{ kind: 'payload', finish: item, name: item,
          payload: { pan: completed.pan, assessment_year: completed.assessment_year,
                     income_from_salary: completed.income_from_salary, deduction_80c: completed.deduction_80c,
                     bank_account_ifsc: completed.bank_account_ifsc },
          documents: [{ name: 'form16.pdf', mime: 'application/pdf', data_base64: pdf.toString('base64') }] }] });
      if (conf.status !== 200) throw new Error(`order/confirm ${conf.status}: ${JSON.stringify(conf.json)}`);
      console.log('   ' + G('✓ ') + 'submitted — chit ' + conf.json.chit_id);
      const sealed = (conf.json.documents || [])[0];
      console.log('   ' + (sealed && sealed.sha256 === sha
        ? G('✓ ') + 'the sealed hash MATCHES the PDF we extracted from — the proof and the answers are the same document'
        : R('✗ ') + 'sealed hash does not match the source PDF'));
    } catch (e) { console.log('   ' + R('✗ ') + e.message); }
  } else {
    console.log('\n' + D('   (add --submit to also send it to the live storefront with the PDF attached)'));
  }

  hr('─');
  console.log(B('  WHAT THIS PROVES') + '  a digital PDF → text → deterministic fields → mapped with provenance →');
  console.log('  validated by the deployed validator → residue asked of the customer → sealed with the document.');
  console.log(Y('  WHAT IT DOES NOT:') + ' scanned PDFs (needs OCR) · documents without a pattern table · and pdfjs is');
  console.log('  loaded from a scratch install, so taking a PDF dependency remains an open decision.');
  hr('═');
})().catch((e) => { console.error(R('crashed: ') + (e && e.stack || e)); process.exit(1); });
