#!/usr/bin/env node
/**
 * price-resolve.test.mjs — which price applies, and why.
 *
 * ⭐ THE CASES THAT MATTER ARE THE REFUSALS AND THE TIE-BREAKS, not the happy path. A resolver that picks a price
 * is easy; one that can defend the pick six months later is the product.
 *
 * Run: node scripts/price-resolve.test.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * ⚠ THE THIRD HARNESS TO GO RED FOR THE SAME REASON. price-resolve returns REASONS a price does not apply
 * (“needs 20+, this order has 5”), and once those sentences were wrapped for translation the module needed
 * `txf` — which a bare sandbox does not have. Identity + interpolation is the faithful default, because
 * English IS the key here.
 */
const ctx = createContext({ console, module: { exports: {} },
  tx: (s) => s,
  txf: (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)),
});
runInContext(readFileSync(join(ROOT, 'public/app/catalogue-model.js'), 'utf8'), ctx, { filename: 'catalogue-model.js' });
runInContext(readFileSync(join(ROOT, 'public/app/price-resolve.js'), 'utf8'), ctx, { filename: 'price-resolve.js' });
const P = ctx.CBPrice;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (got === undefined ? '' : '  → ' + JSON.stringify(got))); } };

const NOW = '2026-08-16T10:00:00Z';

console.log('\n1 · the plain case');
{
  const r = P.resolve([{ label: 'list', basis: 'manual', by: 'value', amount: 340 }], { now: NOW });
  ok('one declared price is the price', r.amount === 340, r.amount);
  ok('…and it says which entry won', /list = 340/.test(r.explain), r.explain);
}

console.log('\n2 · ⭐ quantity tiers');
{
  const tiers = [
    { label: 'list',  by: 'value', amount: 340 },
    { label: 'bulk',  by: 'value', amount: 320, minQty: 30 },
    { label: 'pallet',by: 'value', amount: 300, minQty: 120 }
  ];
  ok('under the first tier, the list price stands', P.resolve(tiers, { now: NOW, qty: 5 }).amount === 340);
  ok('at 30 the bulk tier applies', P.resolve(tiers, { now: NOW, qty: 30 }).amount === 320);
  ok('at 200 the pallet tier applies', P.resolve(tiers, { now: NOW, qty: 200 }).amount === 300);
  ok('⭐ …and the HIGHER tier wins the tie, not the first one declared',
     P.resolve(tiers, { now: NOW, qty: 200 }).entry.label === 'pallet');
  const r = P.resolve(tiers, { now: NOW, qty: 5 });
  ok('⭐ …and the tiers that did not apply say why',
     r.rejected.some((x) => /needs 30\+/.test(x.why)), r.rejected.map((x) => x.why));
}

console.log('\n3 · ⚠️ time windows');
{
  const e = [{ label: 'list', by: 'value', amount: 340 },
             { label: 'diwali', by: 'value', amount: 300, validFrom: '2026-11-01', validTo: '2026-11-15' }];
  ok('a future price does not apply today', P.resolve(e, { now: NOW }).amount === 340);
  ok('…and says when it starts',
     P.resolve(e, { now: NOW }).rejected.some((x) => /starts 2026-11-01/.test(x.why)));
  ok('inside the window it applies', P.resolve(e, { now: '2026-11-05T00:00:00Z' }).amount === 300);
  /* ⚠️ The off-by-one a customer notices. */
  ok('⭐ the LAST DAY still counts — an end date means the END of that day',
     P.resolve(e, { now: '2026-11-15T18:00:00Z' }).amount === 300);
  ok('…and the day after does not', P.resolve(e, { now: '2026-11-16T09:00:00Z' }).amount === 340);
}

console.log('\n4 · ⚠️ region and currency');
{
  const e = [{ label: 'national', by: 'value', amount: 340 },
             { label: 'tn', by: 'value', amount: 325, region: 'TN' }];
  ok('in TN the regional price applies', P.resolve(e, { now: NOW, region: 'TN' }).amount === 325);
  ok('⭐ …because it is MORE SPECIFIC, not because it is cheaper',
     P.resolve(e, { now: NOW, region: 'TN' }).entry.label === 'tn');
  ok('elsewhere the national price applies', P.resolve(e, { now: NOW, region: 'KL' }).amount === 340);
  ok('⚠️ a price with NO region applies everywhere — missing means no restriction',
     P.resolve([{ label: 'any', by: 'value', amount: 99 }], { now: NOW, region: 'KL' }).amount === 99);

  const cur = P.resolve([{ label: 'usd', by: 'value', amount: 12, currency: 'USD' }],
                        { now: NOW, currency: 'INR' });
  ok('⚠️ a currency mismatch is REFUSED, never converted', cur.amount === null, cur.amount);
  ok('…and says so, rather than inventing an exchange rate',
     /priced in USD/.test(cur.explain), cur.explain);
}

console.log('\n5 · ⚠️ loose prices cannot price an order');
{
  const r = P.resolve([{ label: 'mandi', basis: 'global', by: 'ref', source: 'Koyambedu board' }], { now: NOW });
  ok('a by-ref entry with no amount does not price anything', r.amount === null);
  ok('⭐ …and says it is LOOSE rather than broken',
     /loose — resolves from Koyambedu board at seal/.test(r.explain), r.explain);

  const rec = P.resolve([{ label: 'mandi', by: 'ref', amount: 4200, source: 'Koyambedu board',
                           origin: 'publisher', at: '2026-08-16T06:00:00Z', as_read: 4200 }], { now: NOW });
  ok('a by-ref entry WITH a recorded reading does price it', rec.amount === 4200);
  ok('…and is marked as a reading, not as frozen', /recorded reading/.test(rec.state), rec.state);
  ok('⭐ …and carries its provenance through — the source work is not dropped by the resolver',
     /Koyambedu/.test(rec.provenance) && /read 2026-08-16/.test(rec.provenance), rec.provenance);
}

console.log('\n6 · ⚠️⚠️ no price is an ANSWER, not a zero');
{
  const r = P.resolve([], { now: NOW });
  ok('an empty Part D returns null, never 0', r.amount === null, r.amount);
  ok('…and says there is nothing declared', /No price is declared/.test(r.explain), r.explain);

  const all = P.resolve([{ label: 'expired', by: 'value', amount: 10, validTo: '2020-01-01' }], { now: NOW });
  ok('⭐ every entry rejected still returns null — an order must not go out at nothing',
     all.amount === null, all.amount);
  ok('…and names what was rejected and why', /expired: ended 2020-01-01/.test(all.explain), all.explain);
}

console.log('\n7 · ⚠️ tiers are PER LINE');
{
  const tiers = [{ label: 'list', by: 'value', amount: 340 },
                 { label: 'bulk', by: 'value', amount: 320, minQty: 30 }];
  const out = P.forLines([{ qty: 20 }, { qty: 40 }], tiers, { now: NOW });
  ok('⭐ one line reaching a tier does NOT drag the other line with it',
     out[0].amount === 340 && out[1].amount === 320, out.map((x) => x.amount));
}

console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
process.exit(fail ? 1 : 0);
