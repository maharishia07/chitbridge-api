'use strict';
/**
 * lib-make-form16-pdf.js — build a realistic DIGITAL Form 16 PDF, with zero dependencies.
 *
 * Why generate one: a prototype needs a document to read, and a real Form 16 contains someone's actual salary and
 * PAN. This produces a structurally ordinary PDF (standard xref, Helvetica, one content stream of Tj text) so the
 * extractor is doing a genuine parse, not reading a format shaped to suit it.
 *
 * It is a DIGITAL pdf — a real text layer, which is what a payroll system emits. A SCANNED Form 16 is a picture and
 * would need OCR; this prototype deliberately does not pretend to handle that.
 */

// The lines a payroll system actually prints. Values are illustrative, but the LABELS are the real anchors the
// extractor keys off — that is the part that has to survive contact with a real document.
const FORM16_LINES = [
  'FORM NO. 16',
  '[See rule 31(1)(a)]',
  'Certificate under section 203 of the Income-tax Act, 1961',
  '',
  'PART A',
  'Name and address of the Employer: ACME SOFTWARE PRIVATE LIMITED',
  'Name and address of the Employee: A N EXAMPLE',
  'PAN of the Deductor: AAACA1111A',
  'TAN of the Deductor: BLRA12345F',
  'PAN of the Employee: ABCDE1234F',
  'Assessment Year: 2026-27',
  'Period with the Employer: 01-Apr-2025 to 31-Mar-2026',
  'Total amount of tax deducted at source: 184500.00',
  '',
  'PART B (Annexure)',
  'Details of Salary Paid and any other income and tax deducted',
  '1. Gross Salary',
  '(a) Salary as per provisions contained in section 17(1): 1850000.00',
  '(b) Value of perquisites under section 17(2): 42000.00',
  '(c) Profits in lieu of salary under section 17(3): 0.00',
  '2. Less: Allowances to the extent exempt under section 10: 96000.00',
  '3. Deductions under section 16',
  '(a) Standard deduction under section 16(ia): 75000.00',
  '(b) Tax on employment under section 16(iii): 2400.00',
  '4. Income chargeable under the head Salaries: 1718600.00',
  '',
  'Deductions under Chapter VI-A',
  '(a) Deduction in respect of life insurance premia etc. under section 80C: 150000.00',
  '(b) Deduction in respect of health insurance premia under section 80D: 25000.00',
  '',
  'Verification',
  'I, the deductor, certify that the information given above is true and correct.',
];

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

/** Returns a Buffer holding a one-page, text-layer PDF of the lines above. */
function makeForm16Pdf(lines) {
  const body = (lines || FORM16_LINES);
  // one content stream: begin text, set font, then a Td-positioned Tj per line
  let content = 'BT\n/F1 9 Tf\n1 0 0 1 40 780 Tm\n12 TL\n';
  for (const ln of body) content += `(${esc(ln)}) Tj\nT*\n`;
  content += 'ET\n';

  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  objs[4] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { makeForm16Pdf, FORM16_LINES };
