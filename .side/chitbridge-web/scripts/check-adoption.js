/**
 * check-adoption.js — the SPEC-adoption-generalize regression: an adopted catalogue must render for ANY vertical.
 *
 * The bar (from the spec's rollout gate): a veg/meat store's adopted catalogue renders with ZERO paint artifacts and
 * correct per-product units, while PAINT renders exactly as before. Cases 1–3 are asserted here; cases 4 (no
 * double-create) and 5 (manage link) are UI flows and live in e2e/tests/catalogue-wizard.spec.js.
 *
 * It pulls the REAL renderers out of public/app.html (no copies to drift) and runs them in a vm with just esc + UI,
 * so this stays a pure function-contract test — no browser, no server, no DB.
 * Run:  node scripts/check-adoption.js
 * OWNS      the proof that an adopted catalogue renders for ANY vertical (veg, meat, paint) with zero paint artifacts and each product's own unit.
 * CALLED BY package.json check:adoption · .github/workflows/ci.yml (web job). No browser, no server: the real renderers lifted out of public/app.html and public/app/helpers.js into a vm.
 * FLOW      app.html renderers + helpers.js fmtMoney (with the money readers it calls) -> vm context -> five cases + three back-compat reads -> pass/fail count
 * CARD      06-catalogue-pim/items
 * UNIT      06/Catalogue items (adopted catalogue render)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// CB_APP_HTML overrides the target — used to prove this check actually FAILS against the pre-fix app.html
// (a regression test that cannot fail on the old code is not a regression test).
const html = fs.readFileSync(process.env.CB_APP_HTML || path.join(root, 'public', 'app.html'), 'utf8');

// lift the renderers + their helpers straight out of the page (each ends at the next top-level `function `)
// ⚠️ THE PRICE READERS ARE LIFTED TOO, NOT STUBBED. The renderers grew a dependency on cbHasPrice/cbAmount/
// cbCurrency (the tolerant readers, added when a price became {amount,currency}), and this check's vm context was
// never given them — so all 11 assertions had been failing with "cbHasPrice is not defined" for a while. That is a
// harness gap wearing the costume of a product failure, and a check that is permanently red stops being read at
// all. Lifted from app.html for the same reason as the renderers: a stub here would be a copy that drifts, and
// this file's whole premise is no copies.
const NEEDED = [
  'myCur',
  'cbAmount',
  'cbCurrency',
  'cbHasPrice',
  '_refPrice',
  '_refPriceHTML',
  '_refChips',
  '_refFacts',
  '_refPhoto',
  'refFinishRow',
  'refFinishDetail',
  '_swatch',
  '_combo'
];
let src = 'var _REF_SKIP=' + (/var _REF_SKIP\s*=\s*(\{[^}]*\});/.exec(html) || [])[1] + ';\n';
/* T3-CATALOGUE moved the catalogue primitives (cbAmount · cbHasPrice · cbCurrency …) out of app.html into app/cap-catalogue.js — ONE copy; lift from wherever the one copy lives */
const catalogue = fs.readFileSync(path.join(root, 'public', 'app', 'cap-catalogue.js'), 'utf8');
for (const fn of NEEDED) {
  const re = new RegExp('^function ' + fn + '\\b[\\s\\S]*?(?=^function |^var |^\\/\\/|^\\/\\*)', 'm');
  const m = re.exec(html) || re.exec(catalogue);
  if (!m) {
    console.log('SETUP FAIL — could not lift ' + fn + '() out of app.html or app/cap-catalogue.js');
    process.exit(1);
  }
  src += m[0] + '\n';
}
/**
 * ⚠️ MONEY IS LIFTED TOO. The renderers call inr(), which is `n => fmtMoney(n, myCur())` — an arrow const in
 * app.html over a formatter that lives in app/helpers.js. The lifter above only takes `function NAME`, so inr was
 * missing and every price assertion failed on "inr is not defined". Both are taken from source for the same reason
 * as everything else here: a stub for money would be a second money formatter, and this codebase has spent real
 * outages on exactly that kind of second copy.
 */
const helpers = fs.readFileSync(path.join(root, 'public', 'app', 'helpers.js'), 'utf8');
/* T2-WEBPRIMS: esc is lifted too (it was a stub copy in ctx below), and fmtMoney spans lines now — a one-line body or up to its closing brace */
/* CUR-1 slice 5: fmtMoney now reads through moneyValueFor and moneyRead (and its three helpers), so they are lifted with it */
for (const fn of ['fmtMoney', 'moneyValueFor', 'moneyRead', 'moneyReadMajor', 'moneyReadMinor', 'isoCodeOf', 'bareAmount', 'esc']) {
  const m = new RegExp('^function ' + fn + '\\b(?:.*\\}\\s*$|[\\s\\S]*?\\n\\})', 'm').exec(helpers);
  if (!m) {
    console.log('SETUP FAIL — could not lift ' + fn + '() out of app/helpers.js');
    process.exit(1);
  }
  src = m[0] + '\n' + src;
}
{
  const m = /^const CCY_LOCALE\s*=.*$/m.exec(helpers);
  src = (m ? m[0] + '\n' : 'const CCY_LOCALE={};\n') + src;
  const i = /^const inr\s*=.*$/m.exec(html);
  if (!i) {
    console.log('SETUP FAIL — could not lift inr from app.html');
    process.exit(1);
  }
  src += '\n' + i[0];
}
const ctx = {
  UI: { refSel: null },
  // myCur() reads SESSION.currency; the fixtures are priced in INR, so say so explicitly rather than lean on a
  // default that could change underneath the assertions.
  SESSION: { currency: 'INR' },
  /**
   * ⚠️⚠️ ALL TEN FAILURES IN THIS FILE WERE ONE MISSING SANDBOX, NOT TEN DEFECTS. The localisation layer gave
   * every renderer three new globals — `tx`, `txf`, `CBLocale` — and a lifted-source harness sees only what it
   * is handed. So each case died on `CBLocale is not defined` or `tx is not defined` **before asserting
   * anything**, and the suite reported ten red rows about the catalogue while testing nothing about it.
   *
   * ⭐ A test that fails for a reason unrelated to its subject is worse than a missing test: it is read as
   * evidence the subject is broken, and the real subject stays unchecked behind the noise.
   *
   * `tx` is identity because English IS the key here (gettext semantics) — the faithful default, not a
   * shortcut. `CBLocale` is the real module, evaluated below, so money formatting is tested and not imagined.
   */
  tx: (s) => s,
  txf: (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m))
};
/* CBLocale is the REAL module, not a stub — money formatting is the thing several of these cases assert on. */
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
/* ⚠ MONEY BEFORE LOCALE — the same order every page loads them in. locale.js now FORWARDS to CBMoney rather
   than unwrapping a stamped price itself (2026-09-11, the one-reader change), so a harness that loads locale
   without money gets "CBMoney is not defined" on the first price and fails 40 cases for one missing script. */
try {
  new vm.Script(fs.readFileSync(path.join(root, 'public/engine/money.js'), 'utf8')).runInNewContext(ctx);
} catch (e) {
  console.log('SETUP FAIL — money.js did not evaluate: ' + e.message);
  process.exit(1);
}
try {
  new vm.Script(fs.readFileSync(path.join(root, 'public/engine/locale.js'), 'utf8')).runInNewContext(ctx);
} catch (e) {
  console.log('SETUP FAIL — locale.js did not evaluate: ' + e.message);
  process.exit(1);
}

try {
  new vm.Script(src).runInNewContext(ctx);
} catch (e) {
  console.log('SETUP FAIL — lifted source did not evaluate: ' + e.message);
  process.exit(1);
}

let pass = 0,
  fail = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  ok  ' + name);
    pass++;
  } catch (e) {
    console.log('  XX  ' + name + ' — ' + e.message);
    fail++;
  }
};
const has = (h, s, why) => {
  if (h.indexOf(s) < 0) throw new Error('expected to find ' + JSON.stringify(s) + (why ? ' (' + why + ')' : ''));
};
const not = (h, s, why) => {
  if (h.indexOf(s) >= 0) throw new Error('expected NOT to find ' + JSON.stringify(s) + (why ? ' (' + why + ')' : ''));
};

// ── the two fixtures: what a paint item and a veg item actually look like coming back from catalogue-mine ──
const PAINT = {
  name: 'Tussar',
  texture_family: 'weave',
  region: 'East',
  effect: ['luminous', 'elegant'],
  scale: 'single big wall',
  sheen: 'metallic',
  inspiration: 'Bhagalpur tussar silk.',
  tools: ['trowel', 'sponge'],
  coats: '1 base + 2 effect',
  combinations: [{ name: 'Silk Route', colours: [{ name: 'Raw Silk', hex: '#C9A86A' }] }],
  commercials: { price_per_litre: 950 }
};
const VEG = {
  name: 'Tomato',
  local_names: ['Thakkali', 'Tamatar'],
  botanical_name: 'Solanum lycopersicum',
  category: 'vegetable',
  photo: 'data:image/jpeg;base64,AAAA',
  commercials: { price: 40, unit: 'kg' }
};
const EGG = { name: 'Egg', category: 'poultry', commercials: { price: 7, unit: 'count' } };

// ── CASE 1 · PAINT UNCHANGED (the guardrail — this pass must be additive, not a rewrite) ──
t('case 1 · paint row keeps combinations, swatches, application and ₹/L', () => {
  const h = ctx.refFinishRow(PAINT, 0);
  has(h, 'Colour combinations', 'paint has combinations, so the block must render');
  has(h, '#C9A86A', 'named swatch must still render');
  has(h, 'Applied with trowel, sponge', 'application line must survive');
  has(h, '1 base + 2 effect');
  has(h, '₹950');
  has(h, '/L', 'pre-generic price_per_litre still reads as /L');
  has(h, 'weave', 'texture chip');
  has(h, 'East', 'region chip');
  has(h, 'luminous', 'effect chip');
});
t('case 1 · paint detail keeps the full showcase', () => {
  const h = ctx.refFinishDetail(PAINT);
  has(h, 'Colour combinations');
  has(h, '#C9A86A');
  has(h, 'Applied with trowel, sponge');
  has(h, '₹950');
  has(h, '/ L');
});

// ── CASE 2 · VEG CLEAN (the actual bug: paint artifacts on a non-paint item) ──
t('case 2 · veg row shows name · local/botanical · photo · ₹/kg', () => {
  const h = ctx.refFinishRow(VEG, 0);
  has(h, 'Tomato');
  has(h, 'local names', "the item's own fields must surface");
  has(h, 'Thakkali, Tamatar', 'array fields join, not [object Object]');
  has(h, 'botanical name');
  has(h, 'Solanum lycopersicum');
  has(h, 'background-image:url(data:image/jpeg;base64,AAAA)', 'the photo must render');
  has(h, '₹40');
  has(h, '/kg', "price in the ITEM's unit, not litres");
});
t('case 2 · veg row has NO paint artifacts', () => {
  const h = ctx.refFinishRow(VEG, 0);
  not(h, 'Colour combinations', 'no combos → no header');
  not(h, 'Applied with', 'no tools → no dangling application line');
  not(h, 'optchip', 'no texture/region/effect → no empty chip pills');
  not(h, '/L<', 'must never render a litre price for a kg item');
});
t('case 2 · veg detail has no paint artifacts either', () => {
  const h = ctx.refFinishDetail(VEG);
  not(h, 'Colour combinations');
  not(h, 'Applied with');
  not(h, 'optchip');
  has(h, '₹40');
  has(h, '/ kg');
});
t('case 2 · the by-reference marker survives on every vertical', () => {
  has(ctx.refFinishRow(VEG, 0), '🎨 referenced', 'the reference marker is the model, not a paint detail');
  has(ctx.refFinishRow(PAINT, 0), '🎨 referenced');
});

// ── CASE 3 · PER-PRODUCT UNIT (one catalogue, several units) ──
t('case 3 · two items in one catalogue render their OWN units', () => {
  has(ctx.refFinishRow(VEG, 0), '/kg');
  has(ctx.refFinishRow(EGG, 1), '/count');
  not(ctx.refFinishRow(EGG, 1), '/kg', "egg must not inherit the tomato's unit");
});

// ── backward compatibility: the shape written before this pass must keep rendering ──
t('back-compat · price_per_litre still prices (existing paint adoptions)', () => {
  const p = ctx._refPrice({ commercials: { price_per_litre: 950 } });
  if (!p || Number(p.v) !== 950 || p.u !== 'L') throw new Error('expected {v:950,u:"L"}, got ' + JSON.stringify(p));
});
t('back-compat · generic price wins when both are present', () => {
  const p = ctx._refPrice({ commercials: { price: 40, unit: 'kg', price_per_litre: 950 } });
  if (!p || Number(p.v) !== 40 || p.u !== 'kg') throw new Error('expected {v:40,u:"kg"}, got ' + JSON.stringify(p));
});
t('back-compat · no commercials → "no price", never a crash or NaN', () => {
  const h = ctx.refFinishRow({ name: 'Unpriced' }, 0);
  has(h, 'no price');
  not(h, 'NaN');
  not(h, 'undefined');
});

// ── the empty-render trap this pass exists to close ──
t('no field renders as the literal "undefined"', () => {
  for (const it of [PAINT, VEG, EGG, { name: 'Bare' }]) {
    not(ctx.refFinishRow(it, 0), 'undefined', 'a missing field must be omitted, not stringified');
    not(ctx.refFinishDetail(it), 'undefined');
  }
});

// ── WIZARD CONTRACT · RETIRED WITH THE WIZARD (FIX-3, 163c255, 2026-09-03) ──
// This block evaluated cap-catalogue.js and asserted that every order METHOD states WHAT DATA the business
// receives (`receives`), that payload presets collect no prices, and that each preset declares a pipeline.
// The file is gone, so `npm run check` crashed here on every run after FIX-3 — a dead guard that took the live
// ones (check:reads, check:lazy, check:modal) down with it.
//
// ⚠️ THE CONTRACT WAS NOT RE-HOMED. The hub's Storefront section (cap-catsetup.js, catsetSfMethod) lists methods
// by label and "in use" only; the `receives` sentence — the thing that let a person choose on the DATA rather than
// the widget — did not survive the move. Logged in catalogue/OBSERVATIONS-4-REVIEW.md (obs 1, storefront tab).
// When it comes back, these assertions come back with it, against the hub.

console.log('\ncheck-adoption: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
