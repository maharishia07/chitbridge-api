/**
 * tests/lib/lift-fn.cjs — lift named top-level functions out of an api source file so a test can run the REAL code in a vm sandbox.
 * OWNS      liftFns(file, names): the text of each `function name(` up to its closing brace at column 0 (the api files are prettier-formatted).
 * CALLED BY tests/ctr-104-collision-verdict.test.cjs (the P2 PROOF pass, 2026-11-14); same method as web e2e/lib/lift-fn.cjs
 * FLOW      source file -> function text -> vm.runInContext(text, sandbox)
 */
'use strict';
const fs = require('fs');
const path = require('path');
function liftFns(relativeFile, names) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', relativeFile), 'utf8');
  return names.map((name) => {
    const start = src.search(new RegExp('^(?:async )?function ' + name + '\\s*\\(', 'm'));
    if (start < 0) throw new Error(relativeFile + ': function ' + name + ' not found');
    const end = src.indexOf('\n}\n', start);
    if (end < 0) throw new Error(relativeFile + ': end of ' + name + ' not found');
    return src.slice(start, end + 3);
  }).join('\n');
}
module.exports = { liftFns, source: (relativeFile) => fs.readFileSync(path.join(__dirname, '..', '..', relativeFile), 'utf8') };
