#!/usr/bin/env node
/**
 * price-origin.test.mjs — where a price is referred from.
 *
 * Athi, 2026-08-16: *"can we say where prices are refered from, or accessed from, example, url, website"*.
 *
 * ⭐ THE POINT IS NOT THE FIELDS. It is that a price WITH a named source, a link and a reading date must be
 * distinguishable from one without — because the first is evidence and the second is an assertion, and in a
 * dispute those are different objects. A model that let them look alike would be worse than one with no
 * provenance at all, because it would imply a check that never happened.
 *
 * Run: node scripts/price-origin.test.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = createContext({ console, module: { exports: {} } });
runInContext(readFileSync(join(ROOT, 'public/app/catalogue-model.js'), 'utf8'), ctx, { filename: 'catalogue-model.js' });
const M = ctx.CBCatalogue;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (got === undefined ? '' : '  → ' + JSON.stringify(got))); } };

console.log('\n1 · the vocabulary exists and is published');
{
  ok('PRICE_ORIGIN is exported', Array.isArray(M.PRICE_ORIGIN) && M.PRICE_ORIGIN.length > 0, M.PRICE_ORIGIN);
  ok('…and includes a web page, which is what was asked for', M.PRICE_ORIGIN.indexOf('url') >= 0, M.PRICE_ORIGIN);
  ok('…and reaches the palette, so the Definitions screen shows it without a second list',
     M.PALETTE().priceOrigin === M.PRICE_ORIGIN);
}

console.log('\n2 · ⚠️ additive — an old price is not invalidated');
{
  const c = M.ensure({ pricing: [{ label: 'list', basis: 'manual', by: 'value', amount: 100 }] });
  const p = c.pricing[0];
  ok('an existing price gains the new fields, empty', p.origin === '' && p.url === '' && p.at === '', p);
  ok('⭐ …and reads as "no source stated" rather than going quiet',
     M.priceProvenance(p) === 'no source stated', M.priceProvenance(p));
  ok('⚠️ …and is NOT checkable — honest, not broken', M.priceIsCheckable(p) === false);
}

console.log('\n3 · ⭐ a sourced price says where it came from');
{
  const p = { label: 'mandi', basis: 'global', by: 'ref', origin: 'publisher',
              source: 'Koyambedu Market Committee', ref: 'TOM-A', url: 'https://example.org/rates',
              at: '2026-08-16T06:00:00Z', as_read: 4200 };
  const s = M.priceProvenance(p);
  ok('the publisher is named', /Koyambedu/.test(s), s);
  ok('the link is there to open', /example\.org/.test(s), s);
  ok('⭐ the reading DATE is there — without it a market price cannot be checked at all', /read 2026-08-16/.test(s), s);
  ok('⭐ …and what the source actually SAID', /source said 4200/.test(s), s);
  ok('⭐ this one IS checkable', M.priceIsCheckable(p) === true);
}

console.log('\n4 · ⚠️ what the source said is not what you charge');
{
  const c = M.ensure({ context: { currency: 'INR' },
    pricing: [{ label: 'sell', basis: 'global', by: 'value', amount: 4620,
                origin: 'exchange', ref: 'TOM-A', at: '2026-08-16T06:00:00Z', as_read: 4200 }] });
  const r = M.resolvePrice(c, c.pricing[0]);
  ok('the charged amount is what this catalogue charges', r.amount === 4620, r.amount);
  ok('⭐ …and as_read keeps what the source said, so the markup is AUDITABLE rather than taken on trust',
     r.as_read === 4200, r.as_read);
  ok('both travel through resolvePrice — the schema and every consumer see them, not just the editor',
     r.origin === 'exchange' && r.at === '2026-08-16T06:00:00Z', { origin: r.origin, at: r.at });
  ok('and the human line comes along', /source said 4200/.test(r.provenance), r.provenance);
}

console.log('\n5 · ⚠️ half a provenance is not a provenance');
{
  ok('a URL with no reading date is NOT checkable — the page has moved on since',
     M.priceIsCheckable({ url: 'https://example.org/rates' }) === false);
  ok('a date with no source is NOT checkable — there is nothing to go and look at',
     M.priceIsCheckable({ at: '2026-08-16T06:00:00Z' }) === false);
  ok('an origin plus a ref plus a date IS checkable, even with no URL — a contract number is findable',
     M.priceIsCheckable({ origin: 'contract', ref: 'PO-4471', at: '2026-08-16' }) === true);
}

console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
process.exit(fail ? 1 : 0);
