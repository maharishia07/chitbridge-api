'use strict';
// @type: unit
/**
 * embed-operations-strings.test.cjs — embed.html and operations.html: the string layer is loaded in the right order, and the embed
 * says in words when the catalogue could not be read (never a blank frame).
 *
 * OWNS     proof that each page loads the locale layer (engine/locale.js) and that the Home link's component (ui.js) loads before the shell
 * CARD     29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * MIN string-layer
 * MIN could-not-read-words
 * Run: node e2e/embed-operations-strings.test.cjs
 */
const fs = require('fs'), path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failed = 0;
const check = (what, condition) => { console.log((condition ? '  ok   ' : '  FAIL ') + what); if (!condition) failed++; };
const order = (html, first, second) => html.indexOf('src="' + first + '"') > 0 && html.indexOf('src="' + first + '"') < html.indexOf('src="' + second + '"');

['embed.html', 'operations.html'].forEach((page) => {
  const html = read(page);
  check(html.includes('src="/engine/locale.js"'), page + ': the locale string layer (CBLocale) is loaded');
  check(order(html, '/app/ui.js', '/app/shell.js'), page + ': ui.js (CMP023 Home) loads before the shell draws its header');
});
const embed = read('embed.html');
check(/Catalogue unavailable\./.test(embed), 'embed.html: when the catalogue could not be read, the frame says so in words (it fell back to a sentence, not a blank)');
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all ok');
