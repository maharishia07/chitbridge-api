#!/usr/bin/env node
// @type: unit
/**
 * doc-7-glossary-tap.test.cjs — DOC-7 (proof 2026-11-14): on the Standards page an abbreviation carries a tooltip with its full name and one line of
 * meaning, and it opens on a tap, a click or Enter (a phone has no hover).
 * The REAL stdGloss/stdGlossary (public/app/cap-standards.js) and the REAL pop handlers (public/standards.html) run over a stand-in document.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node tests/doc-7-glossary-tap.test.cjs
 */
'use strict';
const assert = require('assert');
const { sliceFrom, run } = require('./lib/proof-lift.cjs');

let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };

const glossaryCode = sliceFrom('public/app/cap-standards.js', 'var STD_GLOSSARY = [', '/** every abbreviation in a text that is not an emphasis word')
  + sliceFrom('public/app/cap-standards.js', '/**\n * Wrap each known abbreviation', '\n}\n') + '\n}\n';
const popCode = sliceFrom('public/standards.html', 'function glHide()', "window.addEventListener('scroll', glHide, true);");

/** a stand-in element: closest() answers from the selectors it was given */
const element = (selectors, attributes) => ({
  selectors, attributes: attributes || {}, hidden: true, children: [], style: {}, offsetHeight: 20,
  getAttribute(name) { return this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
  closest(selector) { return this.selectors.indexOf(selector) >= 0 ? this : null; },
  appendChild(child) { this.children.push(child); },
  getBoundingClientRect: () => ({ left: 40, top: 100, bottom: 120 })
});

const handlers = {};
let pop = null;
const body = element(['body']);
const sandbox = {
  esc: (s) => String(s), tx: (s) => s,
  document: {
    body,
    getElementById: (id) => (id === 'glpop' ? pop : null),
    createElement: () => { pop = element(['#glpop']); pop.id = ''; return pop; },
    addEventListener: (type, fn) => { handlers[type] = fn; }
  },
  window: { innerWidth: 1366, innerHeight: 768, addEventListener() {} }
};
sandbox.$ = (id) => sandbox.document.getElementById(id);
run(glossaryCode + '\n' + popCode + '\nthis.stdGloss = stdGloss; this.stdGlossary = stdGlossary;', sandbox);

// the tooltip: full name + meaning on every known abbreviation, a tab stop, nothing wrapped twice
const html = sandbox.stdGloss('Return GSTR-2B and PEPPOL');
ok(/<abbr class="gl" tabindex="0" data-gl="GSTR-2B" title="[^"]+ — [^"]+">GSTR-2B<\/abbr>/.test(html), 'DOC-7: GSTR-2B is wrapped with a title holding its full name and one line of meaning');
ok(/data-gl="PEPPOL"/.test(html), 'DOC-7: PEPPOL is wrapped too');
ok(sandbox.stdGloss(html) === html, 'DOC-7: wrapping twice changes nothing (an abbr inside an abbr is left alone)');
ok(sandbox.stdGloss('<code>GSTR-2B</code>') === '<code>GSTR-2B</code>', 'DOC-7: text inside <code> is left alone');

// the pop: click, Enter, Escape
const live = element(['abbr.gl', 'dl.sd'], { 'data-gl': 'GSTR-2B' });
const click = { target: live, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
handlers.click(click);
const expected = sandbox.stdGlossary('GSTR-2B');
ok(pop && pop.hidden === false && pop.innerHTML.indexOf(expected[1]) >= 0 && pop.innerHTML.indexOf(expected[2]) >= 0, 'DOC-7: a click on a term in an opened row shows its full name and meaning');
ok(click.stopped && click.prevented, 'DOC-7: that click does not also open or close the row');
handlers.keydown({ target: element(['body']), key: 'Escape' });
ok(pop.hidden === true, 'DOC-7: Escape hides the pop');
const enter = { target: live, key: 'Enter', prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
handlers.keydown(enter);
ok(pop.hidden === false && enter.prevented, 'DOC-7: Enter on a focused term shows the pop');
handlers.keydown({ target: element(['body']), key: 'Escape' });
// a closed row's own line stays a row: no pop, the row opens
const closedRowTerm = element(['abbr.gl', '[data-testid^="std-row-"]'], { 'data-gl': 'GSTR-2B' });
const rowClick = { target: closedRowTerm, stopPropagation() {}, preventDefault() {} };
handlers.click(rowClick);
ok(pop.hidden === true, 'DOC-7: a tap on a term in a closed row opens the row, not the pop');
console.log(pass + ' passed');
