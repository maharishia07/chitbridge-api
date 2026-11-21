/* Walk AE 21 Nov (day report): the till's DAY CLOSE report names the tax in the pack's own word (VAT in Dubai), never a fixed "GST". Reads the day-report
   function out of the till master; break check: put t('GST total' back and case 1 fails. Run: node tests/ae-day-report-tax-word.test.cjs */
// CARD      09-counter/day-close
'use strict';
const fs = require('fs'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8').replace(/\r\n/g, '\n');
const at = h.indexOf('>DAY CLOSE</div>');
assert.ok(at > 0, 'the day report is gone from till.html');
const taxAt = h.indexOf('function dayTaxSection('); /* batch 1126 read: the report's tax lines moved into dayTaxSection, so the block is the report body plus that helper */
const block = h.slice(at, h.indexOf('How it was paid', at)) + h.slice(taxAt, h.indexOf('\n}\n', taxAt));
assert.ok(!/'GST[ ,%]|'GST'|GST total|GST on sales|GST returned|GST, net/.test(block), 'the day report block still carries a fixed GST word');
assert.ok((block.match(/schemeWord\(\)/g) || []).length >= 5, 'the day report lines take schemeWord()');
const webCopy = fs.existsSync(__dirname + '/../../chitbridge-web/public/till.html');
console.log('2 passed · 2 checks');
