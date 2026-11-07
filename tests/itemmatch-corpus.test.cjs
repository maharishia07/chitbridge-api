#!/usr/bin/env node
// @type: unit
/**
 * tests/itemmatch-corpus.test.cjs — CAT-75: the itemmatch tolerance, tested per product family on a CORPUS.
 *
 * DECIDED 2026-11-06 (Athi's rule): keep the per-word tolerance as a shipped rule and test it on a corpus per family.
 * Each family has a small catalogue, pairs that MUST resolve to a named item (spelling, plural, spacing, synonym) and
 * pairs that must NOT resolve (a different product that looks alike). The expectations were written by hand from the
 * rule (lib/itemmatch.js stage 4: tolerance per WORD, a swapped word is never a typo), then compared with the function.
 *
 * `todo` pairs are the findings: the rule as shipped DOES resolve them (a digit or size letter is "a typo" to edit
 * distance). Each carries its question for cb-catalogue. A todo that starts to pass fails the run: promote it.
 *
 * RUN       node tests/itemmatch-corpus.test.cjs
 * MUTATION  ITEMMATCH_MODULE=<path> points the test at another copy (tests/itemmatch-corpus-mutation.test.cjs)
 */
'use strict';
const path = require('path');
const im = require(process.env.ITEMMATCH_MODULE || path.join(__dirname, '..', 'lib', 'itemmatch.js'));

const mk = (name, syn = [], variant = null) => ({ name, variant, synonyms: syn.map(im.norm) });
const cat = (items) => {
  const variantsOf = {};
  for (const it of items) if (it.variant) (variantsOf[im.norm(it.name)] = variantsOf[im.norm(it.name)] || new Set()).add(it.variant);
  return { items, variantsOf };
};

/** outcome(r) — what the shop is told: a clean item, a flagged variant, a picker, or nothing. */
function outcome(r) {
  if (r.item && !r.variant_unspecified) return 'item:' + r.item.name + (r.item.variant ? ' ' + r.item.variant : '');
  if (r.variant_unspecified) return 'flagged';
  return r.ambiguous ? 'ambiguous' : 'unmatched';
}

const FAMILIES = {
  filters: {
    cat: cat([mk('Oil filter'), mk('Air filter'), mk('Fuel filter'), mk('AC filter')]),
    yes: [['oil filtr', 'Oil filter'], ['oil fillter', 'Oil filter'], ['air fliter', 'Air filter'], ['fuel filtre', 'Fuel filter'], ['oil-filter', 'Oil filter'], ['oil filters', 'Oil filter'], ['AC filtr', 'AC filter']],
    no: [['cabin filter'], ['fuel pump'], ['spark plug']],
    narrow: { cat: cat([mk('Oil filter'), mk('Air filter'), mk('Fuel filter')]), no: [['ac filter']] }
  },
  grocery: {
    cat: cat([mk('Tomato'), mk('Basmati rice'), mk('Toor dal'), mk('Urad dal'), mk('Sugar', ['cheeni']), mk('Orange', [], 'grade 1'), mk('Orange', [], 'grade 2')]),
    yes: [['tomatto', 'Tomato'], ['tomatoes', 'Tomato'], ['basmathi rice', 'Basmati rice'], ['toor daal', 'Toor dal'], ['suger', 'Sugar'], ['cheeni', 'Sugar'], ['orange grade 2', 'Orange grade 2']],
    no: [['moong dal'], ['salt'], ['orange'], ['orange grade 3']]
  },
  pharma: {
    cat: cat([mk('Paracetamol 500mg'), mk('Paracetamol 650mg', ['dolo 650']), mk('Amoxicillin 250mg'), mk('Cetirizine 10mg'), mk('Metformin 500mg')]),
    yes: [['paracetamol 500 mg', 'Paracetamol 500mg'], ['paracetmol 500mg', 'Paracetamol 500mg'], ['amoxicilin 250mg', 'Amoxicillin 250mg'], ['cetrizine 10mg', 'Cetirizine 10mg'], ['metphormin 500mg', 'Metformin 500mg'], ['dolo 650', 'Paracetamol 650mg']],
    no: [['cetirizine 5mg'], ['diclofenac 50mg']],
    todo: [
      ['paracetamol 600mg', 'Q1 cb-catalogue: a dose is a number, 600 vs 500 is one edit. Must a differing number ever fuzzy-match? (a dose is the product)'],
      ['amoxicillin 500mg', 'Q1: 500mg vs 250mg is two edits, inside the 5-char word tolerance of 2']
    ]
  },
  stationery: {
    cat: cat([mk('A4 paper 75gsm'), mk('Ball pen blue'), mk('Ball pen black'), mk('Gel pen'), mk('Notebook 200 pages'), mk('Pencil HB')]),
    yes: [['bal pen blue', 'Ball pen blue'], ['ballpen blue', 'Ball pen blue'], ['gel pens', 'Gel pen'], ['gel pn', 'Gel pen'], ['penzil hb', 'Pencil HB'], ['note book 200 pages', 'Notebook 200 pages'], ['a4 papper 75gsm', 'A4 paper 75gsm']],
    no: [['ball pen red'], ['stapler']],
    todo: [
      ['pencil 2b', 'Q2 cb-catalogue: 2B vs HB is one edit in a 2-char word (tolerance 1). Short grade codes: exact only?'],
      ['notebook 100 pages', 'Q1: 100 vs 200 is one edit in a 3-char word (tolerance 1)']
    ]
  },
  textiles: {
    cat: cat([mk('Cotton shirt M'), mk('Cotton shirt L'), mk('Silk saree'), mk('Cotton saree'), mk('Denim jeans'), mk('Bed sheet'), mk('Cotton towel')]),
    yes: [['cotton sirt m', 'Cotton shirt M'], ['silk sari', 'Silk saree'], ['denim jeens', 'Denim jeans'], ['bedsheet', 'Bed sheet'], ['bed sheets', 'Bed sheet'], ['cotton towl', 'Cotton towel']],
    no: [['silk shirt'], ['wool saree']],
    todo: [
      ['cotton shirt s', 'Q2 cb-catalogue: S is one edit from both M and L; a size letter tie silently picks the first. Size tokens exact only?'],
      ['cotton shirt xl', 'Q2: XL is one edit from L; a size is the product, not a typo']
    ]
  }
};

let pass = 0, fail = 0, todo = 0;
const check = (ok, label, got) => {
  if (ok) pass++;
  else { fail++; console.error('  FAIL ' + label + '  got ' + got); }
};

for (const [fam, f] of Object.entries(FAMILIES)) {
  for (const [phrase, want] of f.yes) {
    const got = outcome(im.match(phrase, '', f.cat));
    check(got === 'item:' + want, fam + ' MUST match: "' + phrase + '" -> ' + want, got);
  }
  for (const [phrase] of f.no) {
    const got = outcome(im.match(phrase, '', f.cat));
    check(!got.startsWith('item:'), fam + ' must NOT match: "' + phrase + '"', got);
  }
  if (f.narrow) for (const [phrase] of f.narrow.no) {
    const got = outcome(im.match(phrase, '', f.narrow.cat));
    check(!got.startsWith('item:'), fam + ' must NOT match (narrow catalogue): "' + phrase + '"', got);
  }
  for (const [phrase, question] of f.todo || []) {
    const got = outcome(im.match(phrase, '', f.cat));
    if (got.startsWith('item:')) { todo++; console.log('  todo ' + fam + ': "' + phrase + '" resolves to ' + got + ' -- ' + question); }
    else check(false, fam + ' todo now passes, promote it to "no": "' + phrase + '"', got);
  }
}

console.log(fail ? 'FAILED' : 'ok', '- ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + todo + ' todo findings');
process.exit(fail ? 1 : 0);
