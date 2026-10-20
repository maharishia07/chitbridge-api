'use strict';
/**
 * tests/support/src-find.cjs — find a route declaration in a source text however the formatter wrapped it.
 *
 * OWNS      routeAt(src, verb, path): the index of `router.<verb>(` + `'<path>'`, with any whitespace between (the mechanical
 *           pass puts a long route's path on its own line); -1 when absent. For tests that read a route file as text.
 * CALLED BY the tests that slice a route's source by its declaration (books-payments, pay-fix, ...)
 * CARD      qa/source-reading-tests
 */
const quote = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the index of `router.<verb>(` followed by `'<path>'` (single or double quotes); -1 when absent */
function routeAt(src, verb, routePath) {
  const found = new RegExp('router\\.' + verb + '\\(\\s*[\'"]' + quote(routePath) + '[\'"]').exec(src);
  return found ? found.index : -1;
}

module.exports = { routeAt };
