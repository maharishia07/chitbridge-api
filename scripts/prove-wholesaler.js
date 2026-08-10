#!/usr/bin/env node
'use strict';
/**
 * prove-wholesaler.js — the consolidation rules, W-3 through W-11 of the directive.
 *
 * CB-CLI-DIRECTIVE-wholesaler-consolidation.md: many small shops send messy requests; the wholesaler needs the
 * CONSOLIDATED REQUIREMENT (what to source) and the ATTRIBUTION (who asked for how much).
 *
 * ⚠️ PURE — no network, no database, no AI. The consolidation rules are arithmetic and matching, and they must be
 * provable without anything that can be slow, flaky or expensive. The AI's only job upstream is to turn prose into
 * {phrase, qty, unit, comment}; every rule that could cost money lives here and is tested here.
 *
 * ⚠️ THE THREE TRUST-CRITICAL ONES, which the directive asks to be handed back: W-4 (totals reconcile exactly),
 * W-9 (variants never merge), W-6 (no invented unit conversion).
 *
 * RUN:  node scripts/prove-wholesaler.js
 */
const C = require('../lib/consolidate');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? '\n      ' + detail : '')); }
};

/* The wholesaler's catalogue — the AUTHORITY. Synonyms per item; variants as separate items; conversions declared
   only where he actually knows them. Note orange has grades and NO conversion; tomato has crate→kg. */
const CAT = C.loadCatalogue.__test || null;
const cat = (function build() {
  const items = [
    { name: 'Tomato', variant: '', unit: 'kg', synonyms: ['thakkali', 'tomator', 'tommotto', 'tomato'], conversions: { crate: 20 } },
    { name: 'Onion',  variant: '', unit: 'kg', synonyms: ['vengayam', 'onion'], conversions: {} },
    { name: 'Orange', variant: 'grade 1', unit: 'kg', synonyms: ['orange'], conversions: {} },
    { name: 'Orange', variant: 'grade 2', unit: 'kg', synonyms: ['orange'], conversions: {} },
  ].map((d) => ({
    name: d.name, variant: d.variant, unit: d.unit, conversions: d.conversions,
    synonyms: d.synonyms.map(C.norm), key: C.norm(d.name) + '|' + C.norm(d.variant),
  }));
  const variantsOf = {};
  items.forEach((it) => { (variantsOf[C.norm(it.name)] = variantsOf[C.norm(it.name)] || new Set()).add(it.variant); });
  return { items, variantsOf };
})();

const FRI = '2026-08-14', MON = '2026-08-17';
const req = (store, date, lines) => ({ store_id: store.toLowerCase(), store_name: store, chit_id: 'chit-' + store, fulfil_date: date, lines });

console.log('\n  wholesaler consolidation — the rules that cost money if they bend\n');

/* ── W-3 · SYNONYMS COLLAPSE ───────────────────────────────────────────────────────────────────────────────── */
const syn = C.consolidate([
  req('Store A', FRI, [{ particulars: 'thakkali', qty: 5, unit: 'kg' }]),
  req('Store B', FRI, [{ particulars: 'tomato',   qty: 3, unit: 'kg' }]),
  req('Store C', FRI, [{ particulars: 'tomator',  qty: 2, unit: 'kg' }]),
  req('Store D', FRI, [{ particulars: 'tommotto', qty: 4, unit: 'kg' }]),
], cat);
/**
 * ⚠️ "ONE LINE" IS NOT ENOUGH ON ITS OWN, and a RED-proof caught it. With synonym matching removed, only "tomato"
 * resolves and the other three become unmatched — leaving exactly ONE line, so a bare count test passes on broken
 * code. The claim is "all four RESOLVED and collapsed", which needs the unmatched list to be empty too.
 */
ok('W-3 · four spellings from four shops collapse to ONE line — with NOTHING left unmatched',
  syn.lines.length === 1 && syn.flags.unmatched.length === 0,
  JSON.stringify({ lines: syn.lines.map((l) => l.item + '/' + l.variant), unmatched: syn.flags.unmatched.length }));
ok('W-3 · …and all four shops appear in the attribution', syn.lines[0] && syn.lines[0].breakdown.length === 4,
  syn.lines[0] && String(syn.lines[0].breakdown.length));
ok('W-3 · …and total together (5+3+2+4 = 14) — a shop\'s spelling must never fragment the total',
  syn.lines[0] && syn.lines[0].total === 14, syn.lines[0] && String(syn.lines[0].total));

/* ── W-4 · ARITHMETIC (trust-critical) ─────────────────────────────────────────────────────────────────────── */
const sumOfBreakdown = syn.lines.reduce((n, l) => n + l.breakdown.reduce((m, b) => m + b.qty, 0), 0);
ok('★★★ W-4 · the consolidated total EQUALS the sum of the individual chit lines',
  syn.lines[0].total === sumOfBreakdown, syn.lines[0].total + ' vs ' + sumOfBreakdown);

/* ── W-5 · UNMATCHED IS FLAGGED AND EXCLUDED ───────────────────────────────────────────────────────────────── */
const un = C.consolidate([
  req('Store A', FRI, [{ particulars: 'tomato', qty: 5, unit: 'kg' }, { particulars: 'dragonfruit', qty: 9, unit: 'kg' }]),
], cat);
ok('W-5 · an unmatched phrase is FLAGGED', un.flags.unmatched.length === 1, JSON.stringify(un.flags.unmatched));
ok('★★ W-5 · …and EXCLUDED from every total — never guessed in',
  un.lines.length === 1 && un.lines[0].total === 5, JSON.stringify(un.lines.map((l) => l.item + '=' + l.total)));

/* ── W-6 · UNITS (trust-critical) ──────────────────────────────────────────────────────────────────────────── */
const convOK = C.consolidate([
  req('Store A', FRI, [{ particulars: 'tomato', qty: 2, unit: 'crate' }]),   // catalogue says 1 crate = 20 kg
  req('Store B', FRI, [{ particulars: 'tomato', qty: 5, unit: 'kg' }]),
], cat);
ok('★★★ W-6 · a DEFINED conversion is applied (2 crate × 20 + 5 kg = 45 kg)',
  convOK.lines[0] && convOK.lines[0].total === 45, convOK.lines[0] && String(convOK.lines[0].total));
ok('★★ W-6 · …and the fact that a conversion happened is RECORDED, not silent',
  convOK.lines[0] && (convOK.lines[0].conversions_applied || []).length === 1,
  JSON.stringify(convOK.lines[0] && convOK.lines[0].conversions_applied));

const convNO = C.consolidate([
  req('Store A', FRI, [{ particulars: 'onion', qty: 5, unit: 'crate' }]),    // onion has NO declared conversion
  req('Store B', FRI, [{ particulars: 'onion', qty: 25, unit: 'kg' }]),
], cat);
ok('★★★ W-6 · with NO defined conversion the total is SPLIT BY UNIT, never invented',
  convNO.lines[0] && Array.isArray(convNO.lines[0].unit_split), JSON.stringify(convNO.lines[0] && convNO.lines[0].unit_split));
ok('★★★ W-6 · …and flagged for the wholesaler to resolve',
  convNO.flags.unit_split.length === 1, JSON.stringify(convNO.flags.unit_split));
ok('★★★ W-6 · a silently-wrong conversion is THE money error — no 5-crate figure was ever folded into kg',
  convNO.lines[0] && convNO.lines[0].total === 25, convNO.lines[0] && String(convNO.lines[0].total));

/* ── W-9 · VARIANTS (trust-critical) ───────────────────────────────────────────────────────────────────────── */
const varSep = C.consolidate([
  req('Store A', FRI, [{ particulars: 'orange grade 1', qty: 5, unit: 'kg' }]),
  req('Store B', FRI, [{ particulars: 'orange grade 2', qty: 3, unit: 'kg' }]),
], cat);
ok('★★★ W-9 · grade 1 and grade 2 total SEPARATELY — never merged', varSep.lines.length === 2,
  JSON.stringify(varSep.lines.map((l) => l.item + ' ' + l.variant + '=' + l.total)));
ok('★★★ W-9 · …with the right quantity on each',
  varSep.lines.every((l) => (l.variant === 'grade 1' && l.total === 5) || (l.variant === 'grade 2' && l.total === 3)),
  JSON.stringify(varSep.lines.map((l) => l.variant + '=' + l.total)));

const varUnspec = C.consolidate([ req('Store A', FRI, [{ particulars: 'orange', qty: 7, unit: 'kg' }]) ], cat);
ok('★★★ W-9 · a variant the message did not name is FLAGGED variant-unspecified',
  varUnspec.flags.variant_unspecified.length === 1, JSON.stringify(varUnspec.flags.variant_unspecified));
ok('★★★ W-9 · …and NOT auto-assigned to a grade — picking one is inventing the order',
  varUnspec.lines.length === 0, JSON.stringify(varUnspec.lines));

/* ── W-10 · DATES ──────────────────────────────────────────────────────────────────────────────────────────── */
const dates = C.consolidate([
  req('Store A', FRI, [{ particulars: 'tomato', qty: 5, unit: 'kg' }]),
  req('Store B', MON, [{ particulars: 'tomato', qty: 8, unit: 'kg' }]),
], cat);
ok('★★★ W-10 · two fulfilment dates do NOT total together', dates.lines.length === 2,
  JSON.stringify(dates.lines.map((l) => l.date + '=' + l.total)));
ok('W-10 · Friday is 5 and Monday is 8 — he sources per delivery day',
  dates.lines.find((l) => l.date === FRI).total === 5 && dates.lines.find((l) => l.date === MON).total === 8);
const noDate = C.consolidate([ req('Store A', null, [{ particulars: 'tomato', qty: 5, unit: 'kg' }]) ], cat);
ok('★★★ W-10 · no stated date is FLAGGED date-unspecified, never assumed to be today',
  noDate.flags.date_unspecified.length === 1 && noDate.lines.length === 0, JSON.stringify(noDate.flags.date_unspecified));

/* ── W-7 · ATTRIBUTION ─────────────────────────────────────────────────────────────────────────────────────── */
const attr = C.consolidate([
  req('Store A', FRI, [{ particulars: 'orange grade 1', qty: 2, unit: 'kg' }]),
  req('Store C', FRI, [{ particulars: 'orange grade 1', qty: 3, unit: 'kg' }]),
], cat);
const g1 = attr.lines[0];
ok('★★ W-7 · attribution answers "who asked for how much", per item AND variant',
  g1.breakdown.length === 2 && g1.breakdown.every((b) => b.chit_id),
  JSON.stringify(g1.breakdown.map((b) => b.store_name + ':' + b.qty)));
ok('★★ W-7 · …and every line links back to its chit', g1.breakdown.every((b) => /^chit-/.test(b.chit_id)));
ok('★★★ W-4 (again, on the attribution) · the breakdown sums to the total',
  g1.breakdown.reduce((n, b) => n + b.qty, 0) === g1.total, g1.total + ' vs ' + g1.breakdown.reduce((n, b) => n + b.qty, 0));

/* ── W-8 · THE CATALOGUE IS AUTHORITATIVE ──────────────────────────────────────────────────────────────────── */
const cat2 = JSON.parse(JSON.stringify({ items: cat.items, variantsOf: {} }));
cat2.items = cat.items.map((i) => (i.name === 'Tomato' ? { ...i, unit: 'box' } : i));
cat2.variantsOf = cat.variantsOf;
const auth = C.consolidate([ req('Store A', FRI, [{ particulars: 'tomato', qty: 5, unit: '' }]) ], cat2);
ok('★★ W-8 · changing the catalogue UNIT changes the normalisation — the catalogue is the authority',
  auth.lines[0] && auth.lines[0].canonical_unit === 'box', auth.lines[0] && auth.lines[0].canonical_unit);

/* ── the fuzzy guard: it must fix typing, never merge two real things ──────────────────────────────────────── */
ok('★★★ fuzzy matching NEVER merges variants — "grade 1" and "grade 2" are one character apart',
  varSep.lines.length === 2 && varSep.lines[0].variant !== varSep.lines[1].variant);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  Trust-critical: W-4 totals reconcile · W-9 variants never merge · W-6 no invented conversion\n');
process.exitCode = fail ? 1 : 0;
