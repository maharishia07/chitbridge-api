/**
 * shop-t2b.cjs — the online shop on a phone (T2b, 2026-10-10): rows M62–M73, M99, M101, checked WITHOUT a browser.
 *
 *   node e2e/shop-t2b.cjs
 *
 * shop.html's script is run in a vm with a stub document (the way dup-functions.cjs reads it), so the pure helpers — categories → one
 * chip per NAME, unresolved ids → "Other", the address example, the status words — are the real ones. cart.js is loaded with the offer
 * engine to prove the three shared changes: the legacy single `category` reaches the deal (M101), "Total" only when there is no tax
 * (M69), and the compact row has no photo box (M64).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
let bad = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

/* ── shop.html's own script ── */
const html = read('shop.html');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
const stub = () => ({ innerHTML: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, parentNode: null });
const ctx = { console, setTimeout: () => 0, location: { search: '' }, localStorage: { getItem: () => null }, navigator: {}, URLSearchParams,
  fetch: () => new Promise(() => {}), Intl, document: { getElementById: () => stub(), createElement: stub, addEventListener() {}, body: stub(), head: stub(), querySelector: () => null } };
ctx.window = ctx;
ctx.tx = (english) => english; /* the string door (accounts-shell.js tx) is loaded by the page; English passes through, which is what this file reads */
vm.createContext(ctx);
vm.runInContext(read('app/helpers.js'), ctx);    /* T2-WEBPRIMS: esc · fmtMoney - the ONE copy, loaded by the page before its own script */
vm.runInContext(read('app/workflow.js'), ctx);   /* the page loads it before its own script (CBWorkflow.stageOf → the status words) */
vm.runInContext(script, ctx);
const run = (src) => vm.runInContext(src, ctx);

console.log('\n— categories (M63, M99)');
run(`_SHOPDATA={ shop:{ address:'' }, categories:[{id:'c-tiffin',name:'Tiffin',parent:null},{id:'c-rice',name:'Rice',parent:null}],
  items:[ {item_id:'1',item_data:{name:'Poori',categories:['c-tiffin']}}, {item_id:'2',item_data:{name:'Idli',categories:['tiffin ']}},
          {item_id:'3',item_data:{name:'Jeera Rice',categories:['c-rice']}}, {item_id:'4',item_data:{name:'Odd A',categories:['76f43798-1111-4222-8333-444455556666']}},
          {item_id:'5',item_data:{name:'Odd B',category:'other'}}, {item_id:'6',item_data:{name:'Odd C'}} ] }; _SEC=null;`);
const secs = run('JSON.stringify(_shopSecs())');
const S = JSON.parse(secs);
ok(S.map((c) => c.label).join('|') === 'Rice|Tiffin|Other', 'one chip per NAME, "Other" last: ' + S.map((c) => c.label + '×' + c.n).join(' · '));
ok(S.find((c) => c.label === 'Tiffin').n === 2, 'the id "c-tiffin" and the legacy name "tiffin " are ONE Tiffin');
ok(S.find((c) => c.label === 'Other').n === 3, 'an unresolved id, "other" and no category are all under Other');
ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(secs), 'no uuid is ever a label');
ok(run(`shopSectionOf({item:{item_data:{categories:['c-rice']}}}).label`) === 'Rice', 'a row finds its own section');
ok(run(`shopSectionOf({item:{item_data:{categories:['76f43798-1111-4222-8333-444455556666']}}}).label`) === 'Other', 'a row with an unresolvable id is under Other');
run(`_SHOPDATA.items=_SHOPDATA.items.slice(0,1); _SEC=null;`);
ok(run('_shopSecs().length') === 0, 'one category in use → no headings, no button (as before)');
run(`_SHOPDATA.items=[{item_id:'1',item_data:{categories:['c-tiffin']}},{item_id:'3',item_data:{categories:['c-rice']}}]; _SEC=null;`);
const btn = run('shopCatBtnHtml()');
ok(/id="cat_btn"/.test(btn) && /hidden/.test(btn) && /aria-expanded="false"/.test(btn), 'the Categories ▾ button and a CLOSED panel');
ok(/onclick="shopCatPick\(this\.dataset\.sec\)"/.test(btn) && !/onmouseover|:hover/.test(btn), 'a tap picks; nothing is hover-only');
ok(/oncontextmenu="return false"/.test(btn), 'a long press does not open a context menu');
ok(/_catShield\s*=\s*true/.test(script) && /,\s*400\)/.test(script), 'a double tap is absorbed: the backdrop stays 400 ms after a pick');
ok(!/class="catbar"/.test(script), 'the wrapping chip bar is gone');

console.log('\n— address example (M71) and the first screen (M65)');
run(`_SHOPDATA.shop={address:'12, Anna Salai, Chennai 600002'}`);
ok(/Chennai 600002/.test(run('_addrExample()')) && !/Bengal|560001/.test(run('_addrExample()')), 'the example uses the shop\'s own town and PIN: ' + run('_addrExample()'));
ok(/600002/.test(run('_areaExample()')), 'the area example too: ' + run('_areaExample()'));
run(`_SHOPDATA.shop={address:''}`);
ok(!/Bengal|560001|Chennai/.test(run('_addrExample()')), 'a shop with no address gets a neutral example, never a built-in city');
ok(!/560001|Bengaluru|Bollenini/.test(script), 'no hard-coded town or PIN left in shop.html');
const headSrc = script.slice(script.indexOf('var head ='), script.indexOf('var finishes =')); /* the header is the first `var head =` (formatted over lines since the mechanical pass) */
ok(headSrc && !/gstn|GSTIN/i.test(headSrc), 'the header carries no GSTIN');
ok(/shopAboutHtml/.test(script) && /GSTIN/.test(run('shopAboutHtml({address:"x",gstn:"29ABC",tax_id_word:"GSTIN"})')) && /29ABC/.test(run('shopAboutHtml({address:"x",gstn:"29ABC",tax_id_word:"GSTIN"})')), 'the GSTIN lives under "About the shop" (under the word the server sends, tax_id_word)');
ok(!/GSTIN/.test(run('shopAboutHtml({address:"x",gstn:"29ABC"})')) && /Tax number/.test(run('shopAboutHtml({address:"x",gstn:"29ABC"})')), 'with no word from the server the About says "Tax number", never India\'s GSTIN (N1/STD2)');

console.log('\n— checkout (M67, M68, M70)');
ok(/steps:\s*\[\s*\{\s*k:\s*'delivery',\s*n:\s*'Pickup or delivery'\s*\},\s*\{\s*k:\s*'who',\s*n:\s*'Who you are'\s*\}\s*\]/.test(script),'two steps: Pickup or delivery → Who you are (no Items, no Review step)');
ok(!/_cartStepItems|shopCartQty/.test(script), 'the second "Items" screen is gone');
ok(/quiet:\s*true/.test(script),'the checkout is quiet until the first try');
run(`_ord={cart:true,lines:[{item_id:'1',name:'Poori',qty:1,price:50}],mode:''}`);
const stepsSrc = script.slice(script.indexOf('function _cartStepsFor'), script.indexOf('function shopMode'));
const guardFn = new Function('_ord', stepsSrc.match(/guard:\s*function\s*\(k\)\s*\{[\s\S]*?\n    \},/)[0].replace(/guard:\s*function\s*\(k\)\s*\{/, 'return function(k){').replace(/\},\s*$/, '}'));
let g = guardFn({ lines: [{}], mode: '' });
ok(/pickup or delivery/i.test(g('delivery')), 'nothing chosen → "Choose pickup or delivery"');
g = guardFn({ lines: [{}], mode: 'pickup', loc: '' });
ok(g('delivery') === null, 'PICKUP asks for no address');
g = guardFn({ lines: [{}], mode: 'delivery', loc: '' });
ok(/address/i.test(g('delivery')), 'DELIVERY asks for the address');
g = guardFn({ lines: [{}], mode: 'delivery', loc: 'x', contact: '', step: 'contact' });
ok(/phone or email/i.test(g('who')), 'Who you are asks for a phone or email');
const sf = read('app/step-flow.js');
const flowCtx = { document: undefined, module: { exports: {} }, console }; flowCtx.globalThis = flowCtx; vm.createContext(flowCtx);
flowCtx.esc = ctx.esc; /* step-flow.js uses the page's esc (app/helpers.js loads first) */
vm.runInContext(sf, flowCtx);
const SF = flowCtx.module.exports;
let want = 'A delivery address is needed.';
const h = SF.create({ steps: [{ k: 'a', n: 'A' }, { k: 'b', n: 'B' }], quiet: true, guard: (k) => (k === 'a' ? want : null) });
ok(!/needed/.test(h.footHTML()) && !/disabled/.test(h.footHTML()), 'M70 — before a try the footer is live and says nothing is "needed"');
h.next();
ok(/needed/.test(h.footHTML()) && /disabled/.test(h.footHTML()), 'M70 — after a try it says what is missing');
want = null;
ok(!/needed/.test(h.footHTML()), 'M70 — and the sentence goes as soon as it is answered');
const loud = SF.create({ steps: [{ k: 'a', n: 'A' }, { k: 'b', n: 'B' }], guard: (k) => (k === 'a' ? 'needed!' : null) });
ok(/needed!/.test(loud.footHTML()), 'a flow that is not quiet still says it at once (the app is untouched)');

console.log('\n— the dock (M72) and the receipt (M73)');
ok(/class="shopdock"/.test(script) && /\.shopdock\.on\{ display:block; \}/.test(html), 'the basket total lives in a bottom dock, shown only when there is something in it');
const listPos = script.indexOf('<div id="p_list">'), offPos = script.indexOf('<div id="p_offers"></div>');
ok(listPos > 0 && offPos > listPos, 'the totals box is BELOW the list in the page, so nothing above the list can move');
ok(/Order #/.test(script) && /shop-receipt-total/.test(script) && /What happens next/.test(script) && /Waiting for the shop/.test(script), 'the receipt: order number, total, what happens next, status');
ok(/\/my-orders/.test(script) && /shop-my-orders/.test(script), 'a "My orders" button reads the existing /my-orders route');
ok(run(`shopStatusWord('sent')`) === 'Waiting for the shop' && run(`shopStatusWord('accepted')`) === 'Accepted' && run(`shopStatusWord('completed')`) === 'Delivered' && run(`shopStatusWord('ready')`) === 'Ready', 'status words');
/* WX-O2C: money on the storefront is in the SHOP's currency (an AU shop printed ₹) */
run(`var CBLocale={ money:function(n,c){ return c+' '+Number(n).toFixed(2); } }; _SHOPDATA={ shop:{ currency_code:'AUD' } }; _ord={ lines:[{ price:5, qty:2 }] };`);
ok(run(`cbFmt(12.5)`) === 'AUD 12.50' && run(`_cartLineTotal(0)`) === 'AUD 10.00' && run(`_cartGrand()`) === 'AUD 10.00', 'the shop\'s currency on the basket review (cbFmt · line · total), not a fixed ₹');
run(`_SHOPDATA=null; _ord=null; delete CBLocale;`);
/* WX-O2C: the buyer's copy is minted 'delivered' (the rail: it reached the shop) — a just-placed order must not read "Delivered" */
ok(run(`shopStatusWord('delivered')`) === 'Waiting for the shop' && run(`shopStatusWord('read')`) === 'Waiting for the shop' && run(`shopStatusWord('pending')`) === 'Waiting for the shop', 'the rail\'s delivered / read / pending = still waiting for the shop (CBWorkflow.stageOf)');

console.log('\n— the shared cart (M64, M69, M101)');
const cc = { console, setTimeout: () => 0, clearTimeout() {}, Intl, Date, Math, JSON };
cc.window = cc; cc.globalThis = cc; vm.createContext(cc);
for (const f of ['app/helpers.js', 'engine/money.js', 'engine/offers.js', 'app/cart.js']) { try { vm.runInContext(read(f), cc, { filename: f }); } catch (e) { ok(false, 'could not load ' + f + ': ' + e.message); } }
const CB = cc.CBCart || vm.runInContext('typeof CBCart!=="undefined"?CBCart:null', cc);
if (!CB) ok(false, 'CBCart did not load');
else {
  const offers = [{ id: 'o1', kind: 'percent_off', label: '10% off Drinks', percent: 10, value: 10, scope: 'line', applies_to: { category: 'drinks' }, active: true }];
  const mk = (d) => CB.dealFor(d, offers, { price: 25, currency: 'INR', money: (x) => String(x) });
  const viaSingle = mk({ name: 'Lime soda', category: 'drinks' });
  const viaList = mk({ name: 'Lime soda', categories: ['drinks'] });
  ok(!!viaList && viaList.unit === 22.5, 'M101 baseline — a product listed under "drinks" gets ₹25 → ₹22.50 from the offer engine (' + (viaList && viaList.unit) + ')');
  ok(!!viaSingle && viaSingle.unit === 22.5, 'M101 — a product that carries the legacy single `category` gets the SAME deal (' + (viaSingle && viaSingle.unit) + ')');
  const rows = (m, o) => CB.moneyRowsHTML(Object.assign({ ctx: { money: (x) => '₹' + x }, ev: { adjustments: [], notes: [], total: 190 }, gross: 190, grand: 190, byRate: {}, untaxed: 0, offers: [] }, m || {}), o || {});
  ok(/<span>Total incl\. tax<\/span>/.test(rows()), 'M69 — the app\'s block still says "Total incl. tax" (unchanged)');
  ok(/<span>Total<\/span>/.test(rows({}, { plainUntaxed: true })) && !/incl\. tax/.test(rows({}, { plainUntaxed: true })), 'M69 — the shop says "Total ₹190" when no tax applies');
  ok(/incl\. tax/.test(rows({ byRate: { 'GST 5%': 9.5 }, grand: 199.5 }, { plainUntaxed: true })), 'M69 — and "incl. tax" once there is tax');
}
const cart = read('app/cart.js');
ok(/opts\.compact && \(!m \|\| !m\.src\)\) return ''/.test(cart), 'M64 — in a compact row a product with no photo gets NO box (not even a tile)');
ok(/cbcat-compact>\.cbcat-ctl\{grid-row:1/.test(cart), 'M64 — in a compact row the "+" is on the item\'s own line');
ok(/\.cbcat-was \+ \.cbcat-offered::before\{ content:'→ '/.test(html), 'M101 — struck old price, an arrow, the new price');

console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' checks passed'));
process.exit(bad ? 1 : 0);
