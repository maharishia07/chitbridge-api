'use strict';
/**
 * OWNS      the text of the offline guard list for the tests that check enrolment by reading source: the entries of scripts/guards-list-1..3.cjs joined under one `const GUARDS = [ ... ];`.
 * CALLED BY every-test-is-enrolled, junit-board, filesize-ratchet, readability-guard, junk-fuzz, sec-75-entity-schemas.
 * FLOW      the three part files ──▶ their entries only ──▶ one array text; a missing part throws (readFileSync), never an empty list
 * CARD      qa/offline-guards
 */
const fs = require('fs');
const path = require('path');
const PARTS = ['guards-list-1.cjs', 'guards-list-2.cjs', 'guards-list-3.cjs'];
/** @returns {string} 'const GUARDS = [' + every entry line of the three parts + '\n];' */
function guardsListText() {
  const bodies = PARTS.map((part) => {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', part), 'utf8');
    const from = text.indexOf('const GUARDS_PART = [') + 'const GUARDS_PART = ['.length;
    return text.slice(from, text.indexOf('\n];', from));
  });
  return 'const GUARDS = [' + bodies.join('') + '\n];\n';
}
module.exports = { guardsListText };
