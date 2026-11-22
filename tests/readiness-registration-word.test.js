'use strict';
// E-F-02 (walk E, 21 Nov): the GST Registration row is said in the shop country's own word (pack tax id name), never India's GSTIN on an AU shop.
const assert = require('assert');
const { countryRegistrationWords } = require('../lib/readiness');
const row = () => [{ standard: 'gst-registration', doc: 'gstn', title: 'GSTIN — GST Registration', guidance: 'Declared, not yet verified against the GST registry — this is the GSTIN 123' }, { standard: 'x', doc: 'y', title: 'GSTIN other' }];
const au = countryRegistrationWords(row(), 'AU');
assert(/^ABN/.test(au[0].title) && !/GSTIN/.test(au[0].title + au[0].guidance), JSON.stringify(au));
assert.strictEqual(au[1].title, 'GSTIN other');
assert.strictEqual(countryRegistrationWords(row(), 'IN')[0].title, 'GSTIN — GST Registration');
assert.strictEqual(countryRegistrationWords(row(), null)[0].title, 'GSTIN — GST Registration');
const forms = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'forms.js'), 'utf8');
assert(!/panchayat|generic NOC/i.test(forms), 'forms.js keeps India-only words out of a shared form');
console.log('ok · readiness registration word');
process.exit(0);
