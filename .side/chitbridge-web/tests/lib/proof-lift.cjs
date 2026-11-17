'use strict';
/**
 * tests/lib/proof-lift.cjs — take a piece of a public/ source file as text, so a test can run the REAL code in a vm sandbox.
 * OWNS      sliceFrom(file, start, end): the text from the first `start` to the next `end` (the end marker is not included); run(code, sandbox).
 * CALLED BY tests/ai-13-prompt-ask.test.cjs, tests/doc-7-glossary-tap.test.cjs, tests/pm-8-verdict-build.test.cjs, tests/pm-53-edition-chip.test.cjs.
 * FLOW      file + two markers ──▶ the text between ──▶ vm.runInContext ──▶ the sandbox holds the real functions
 * CARD      qa/offline-guards
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

/** the source text from the first `start` to the next `end` after it (throws when either marker is gone, so a moved function is a named failure) */
function sliceFrom(file, start, end) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const from = text.indexOf(start);
  if (from < 0) throw new Error(file + ': start marker not found: ' + start);
  const to = text.indexOf(end, from + start.length);
  if (to < 0) throw new Error(file + ': end marker not found: ' + end);
  return text.slice(from, to);
}

/** run code in a sandbox and give the sandbox back */
function run(code, sandbox) {
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context);
  return context;
}

module.exports = { sliceFrom, run, ROOT };
