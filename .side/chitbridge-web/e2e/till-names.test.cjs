'use strict';
// @type: unit
/**
 * till-names.test.cjs — three till controls carry an accessible name (a11y; twin of the api till-names change).
 *
 * Static parse of public/till.html: for each control the opening tag is cut out by its data-testid and must hold the exact aria-label
 * (the mode select, the customer box, the quick-keys source select drawn from a string in the page script).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/till-names.test.cjs
 */
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'till.html'), 'utf8');

function openingTag(marker) {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}
const controls = [
  { name: 'mode select', marker: 'id="modesel"', label: 'What are you doing?' },
  { name: 'customer box', marker: 'id="cname"', label: 'Customer (optional)' },
  { name: 'quick-keys source', marker: 'data-testid="till-quick-src"', label: 'Where these keys come from' },
];
for (const control of controls) {
  const tag = openingTag(control.marker);
  check(tag !== '', control.name + ' is found in till.html');
  check(tag.includes('aria-label="' + control.label + '"'), control.name + ' is named "' + control.label + '"');
}
if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('all passed');
