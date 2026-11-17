/**
 * tests/showcase-templates.test.cjs — S2: THE SHOWCASE TEMPLATE MECHANISM.
 *   1  registry: every showcase.* row in app/pages.json fits the N03 grammar, names a script that exists, and is a registered template — and back
 *   2  each seed renders from a fixture catalogue (gallery · menu · specs · booking): its range, its cart face's item action, one h1, the share icon
 *   3  ⭐ cost never reaches ANY template: a fixture whose every cost-ish field holds a marker — the marker is in no template's output
 *   4  exposure: "showcase only" shows no price; visitors never get the "Be found" card, the owner preview does; an item name is escaped
 *   5  mix-and-match: assemble() drops/reorders sections, never drops the range; an unknown choice falls back to the vertical's seed
 *   6  390px: no fixed width over 390 in the template CSS; only the chip row scrolls sideways
 * Run: node tests/showcase-templates.test.cjs   · no browser, no network.
 * CARD      10-online-shop-and-storefront-orders/the-online-shop
 * CARD  11-crm-and-marketing/showcase
 */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
require('vm').runInThisContext(fs.readFileSync(path.join(PUB, 'app', 'helpers.js'), 'utf8'));   /* T2-WEBPRIMS: shop.html loads the one esc first */
const SC = require(path.join(PUB, 'app', 'showcase-templates.js'));
let pass = 0, fail = 0;
const ok = (n, c, w) => { if (c) { pass++; console.log('   ok   ' + n); } else { fail++; console.log('   FAIL ' + n + (w ? '\n          ' + w : '')); } };

const REG = JSON.parse(fs.readFileSync(path.join(PUB, 'app', 'pages.json'), 'utf8')), RE = new RegExp(REG.grammar);
const rows = REG.pages.filter((r) => r.name.startsWith('showcase.')).map((r) => r.name + '@' + r.version);
ok('registry: four showcase rows, all in the grammar', rows.length === 4 && rows.every((n) => RE.test(n)), rows.join(','));
ok('registry: every row\'s script is in the site', REG.pages.every((r) => fs.existsSync(path.join(PUB, r.script))));
ok('registry ⇄ templates: the same names, both ways', JSON.stringify(rows.slice().sort()) === JSON.stringify(Object.keys(SC.TEMPLATES).sort()), rows.join(','));
ok('every template\'s sections are real sections and include a range', Object.keys(SC.TEMPLATES).every((n) => SC.TEMPLATES[n].sections.every((k) => SC.SECTIONS.indexOf(k) >= 0) && SC.TEMPLATES[n].sections.some((k) => ['gallery', 'menu', 'specs', 'services'].indexOf(k) >= 0)));

const COST = 'COSTMARK-4242';
const fixture = {
  shop: { display_name: 'Rani <Cards>', address: 'Chennai', tagline: 'Wedding cards', phone: '+91 98400 00000', whatsapp: '+91 98400 00000', business_status: 'open', currency_code: 'INR', cost: COST, buying_price: COST },
  categories: [{ id: 'c1', name: 'Wedding' }, { id: 'c2', name: 'Birthday' }],
  items: [
    { item_id: 'i1', name: 'Rose arch', cost: COST, cost_price: COST, photo: 'https://x/1.jpg', category: 'c1', item_data: { price: 1200, unit: 'litre', sizes: ['1L', '4L'], cost: COST, cost_price: COST, buying_price: COST, purchase_rate: COST, description: 'A <b>rose</b> card' } },
    { item_id: 'i2', name: 'Gold border', category: 'c2', item_data: { price: 800, showcase_only: true, cost: COST, avail: 7 } },
    { item_id: 'i3', name: 'Plain', category: 'c2', item_data: { cost: COST, margin: COST } }
  ]
};
const money = (v) => '₹' + v;
const out = {};
for (const name of Object.keys(SC.TEMPLATES)) {
  const t = SC.TEMPLATES[name], html = SC.render(SC.contractOf(fixture, { url: 'https://cb/shop/rani' }), { template: name, money });
  out[name] = html;
  ok(name + ': renders all three items', ['Rose arch', 'Gold border', 'Plain'].every((n) => html.indexOf(n) >= 0));
  ok(name + ': one h1 and the share icon', (html.match(/<h1/g) || []).length === 1 && html.indexOf('data-sc="share"') > 0 && html.indexOf('⤴') > 0);
  ok(name + ': wears the ' + t.face + ' face (data-face + its item action)', html.indexOf('data-face="' + t.face + '"') > 0 && html.indexOf('aria-label="' + SC.FACE[t.face].title + '"') > 0);
  ok(name + ': ⭐ cost never reaches the page', html.indexOf(COST) < 0 && !/COSTMARK|cost|margin|buying/i.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), 'a cost field leaked');
  ok(name + ': showcase-only item has no price', !/Gold border[\s\S]{0,200}₹800/.test(html) && html.indexOf('₹800') < 0);
  ok(name + ': a priced item paints through the money formatter', html.indexOf('₹1200') > 0);
  ok(name + ': item text is escaped', html.indexOf('<b>rose</b>') < 0 && html.indexOf('Rani <Cards>') < 0 && html.indexOf('Rani &lt;Cards&gt;') > 0);
  ok(name + ': S3-4 share reads "⤴ Share", labelled, 44px', /data-sc="share"[^>]*>⤴ Share<\/button>/.test(html) && html.indexOf('aria-label="Share"') > 0 && /\.sc-ic\{min-width:44px;height:44px/.test(html));
  ok(name + ': S3-3 header shows place, Call and WhatsApp; no hours chip when unset', /Chennai/.test(html) && />📞 Call</.test(html) && />💬 WhatsApp</.test(html) && !/class="sc-hrs"/.test(html));
  ok(name + ': S3-1 a photo-less item gets a designed initial tile, never an empty box', !/<span class="sc-(ph|th)"><\/span>/.test(html) && (/sc-none" aria-hidden="true">P</.test(html) || name.indexOf('food') > 0 || name.indexOf('services') > 0));
  ok(name + ': S3-2 names wrap to 2 lines, never nowrap-truncated', /line-clamp:2/.test(html) && !/\.sc-cap b\{[^}]*nowrap/.test(html));
  ok(name + ': no "Be found" card for a visitor', html.indexOf('data-sc="found"') < 0);
  ok(name + ': 390px — no fixed width over 390', !/(?:^|[^-a-z])width:\s*([4-9]\d\d|\d{4,})px/.test(html.replace(/max-width:\d+px/g, '')));
}
const own = SC.render(SC.contractOf(fixture, { owner: true, url: 'https://cb/shop/rani' }), { template: 'showcase.food.menu@1.0', money });
ok('the owner preview carries the "Be found" card with the link', own.indexOf('data-sc="found"') > 0 && own.indexOf('https://cb/shop/rani') > 0);
ok('menu groups by the shop\'s own categories', /<h2 class="sc-h2">Wedding<\/h2>[\s\S]*<h2 class="sc-h2">Birthday<\/h2>/.test(out['showcase.food.menu@1.0']));
ok('spec wall shows unit and size chips', /<i>litre<\/i><i>1L<\/i><i>4L<\/i>/.test(out['showcase.paint.specs@1.0']));
ok('contract: copies named fields only (no cost on any item or the shop)', !JSON.stringify(SC.contractOf(fixture)).includes(COST));

ok('mix: a chosen subset drops sections but the range stays', (() => { const l = SC.assemble('showcase.designer.gallery@1.0', ['strip']); return l.indexOf('gallery') >= 0 && l.indexOf('find') < 0 && l.indexOf('facts') < 0; })());
ok('mix: unknown section keys are ignored; empty = the template\'s own', SC.assemble('showcase.food.menu@1.0', ['nope']).indexOf('menu') >= 0 && SC.assemble('showcase.food.menu@1.0', []).length === SC.TEMPLATES['showcase.food.menu@1.0'].sections.length);
ok('an unregistered choice falls back to the vertical\'s seed, else gallery', SC.pick('showcase.x.y@9.9', 'services') === 'showcase.services.booking@1.0' && SC.pick('', '') === SC.DEFAULT);
ok('render() honours the shop\'s own choice from shop.showcase', SC.render(SC.contractOf({ shop: { display_name: 'S', showcase: { template: 'showcase.paint.specs@1.0', sections: [] } }, items: [] }), {}).indexOf('data-template="showcase.paint.specs@1.0"') > 0);
ok('an empty shop says one short line, never a cart', /Nothing on display/.test(SC.render(SC.contractOf({ shop: { display_name: 'S' }, items: [] }), {})));

const shop = fs.readFileSync(path.join(PUB, 'shop.html'), 'utf8');
ok('shop.html loads the module and routes through CBShowcase', /<script src="app\/showcase-templates\.js">/.test(shop) && /CBShowcase\.render\(/.test(shop));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
