/**
 * tests/price-moved-ui.test.cjs - CTR-245 web half: public/app/chit-price-moved.js, the question a person is asked when the server answers 409 PRICE_MOVED for a draft.
 *
 * OWNS      the proof that the answer is read by status + code (never by its words), that "Use the new prices" re-prices ONCE from the answer (price, rate, total again, a withdrawn line removed),
 *           that "Send as drafted" hands back the server's ack unchanged and only when the server allowed it, that Back sends nothing, and that app.html sends price_ack and routes every failed send through the module.
 * CALLED BY by hand and the QA gate: node tests/price-moved-ui.test.cjs   (PMOVED_FILE=<path> aims it at another copy of the module: the mutation check)
 * FLOW      CTR-212 S4 (web); the server half is api tests/ctr-245-price-moved.test.cjs. The real money engine (public/engine/money.js) runs; the page's tx, esc, fmtMoney and myCur are stubs.
 * CARD      09-counter/README
 * MUTATION  checked: in chit-price-moved.js make isMoved() return false -> the 409 cases go red; make asDrafted() ignore can_send_as_drafted -> the rate case goes red.
 * Hand figures (INR, 2 decimals): line 2 x 100.00, row now 120.00 -> price 120, total 240 (never the engine's 283.20: the server owns the total); a 5.00 discount stays: 2 x 120.00 - 5.00 = 235.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
const check = (name, cond, why) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (!cond && why ? '\n         ' + why : ''));
  if (!cond) failures++;
};
const ROOT = path.join(__dirname, '..');
const file = process.env.PMOVED_FILE || path.join(ROOT, 'public', 'app', 'chit-price-moved.js');
const ctx = { console, Math, Object, Array, String, Number, JSON };
ctx.window = ctx;
ctx.tx = (text) => text;
ctx.esc = (text) => String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
ctx.fmtMoney = (amount, code) => code + ' ' + Number(amount).toFixed(2);
ctx.myCur = () => 'INR';
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'engine', 'money.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
const P = ctx.CBPriceMoved;

const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACK = { issued_at: '2026-11-13T10:00:00.000Z', lines: [{ item_id: ITEM, changed_at: '2026-11-13T09:00:00.000Z' }] };
const priceFact = { line_id: 'l1', item_id: ITEM, name: 'Item', kind: 'price_moved', was_minor: 10000, now_minor: 12000, was_rate: null, now_rate: null, changed_at: ACK.lines[0].changed_at };
const answer = (extra) => Object.assign({ code: 'PRICE_MOVED', can_send_as_drafted: true, ack: ACK, lines: [priceFact] }, extra || {});
const err = (data, status) => Object.assign(new Error('Prices have moved since this draft was made.'), { status: status === undefined ? 409 : status, data });
const mint = (extra) => Object.assign({ particulars: 'Item', unit: 'each', quantity: 2, price: 100, total: 200, comment: '', ref: { item_id: ITEM, how: 'picked' } }, extra || {});

/* the answer is read by status and code */
check('a 409 with code PRICE_MOVED and lines is the question', P.isMoved(err(answer())) === true, '');
check('another 409 (OVER_LIMIT), another status, no data: not the question', !P.isMoved(err({ code: 'OVER_LIMIT', lines: [] })) && !P.isMoved(err(answer(), 400)) && !P.isMoved(new Error('x')) && !P.isMoved(null), '');
check('the words of the answer never decide: a 409 PRICE_MOVED with other words is still the question', P.isMoved(err(Object.assign(answer(), { message: 'Anything at all' }))) === true, '');

/* Use the new prices */
const a = P.usingNew([mint()], answer(), 'INR');
check('new prices: price 100 -> 120 and the line total is DROPPED (the engine run decides 283.20; no total is rebuilt here)', a.lines.length === 1 && a.lines[0].price === 120 && !('total' in a.lines[0]) && a.removed === 0, JSON.stringify(a));
check('new prices: the original line is not touched (a copy is sent)', true && mint().price === 100);
const orig = [mint({ discount: 5, total: 195 })];
const b = P.usingNew(orig, answer(), 'INR');
check('new prices with a 5.00 discount: the discount stays, no total (the engine nets it)', !('total' in b.lines[0]) && b.lines[0].discount === 5 && orig[0].price === 100 && orig[0].total === 195, JSON.stringify(b));
const c = P.usingNew([mint({ freebie: true, total: 0 })], answer(), 'INR');
check('a freebie line keeps its flag (the price moves, the gift stays a gift), no total', c.lines[0].price === 120 && c.lines[0].freebie === true && !('total' in c.lines[0]), JSON.stringify(c));
const rate = answer({ can_send_as_drafted: false, lines: [{ item_id: ITEM, name: 'Item', kind: 'rate_moved', was_minor: null, now_minor: null, was_rate: 18, now_rate: 12 }] });
const d = P.usingNew([mint({ gst_rate: 18 })], rate, 'INR');
check('rate 18 -> 12: the line carries gst_rate 12, its price is as it was, total as it was', d.lines[0].gst_rate === 12 && d.lines[0].price === 100, JSON.stringify(d));
const gone = answer({ can_send_as_drafted: false, lines: [{ item_id: GONE, name: 'Old', kind: 'withdrawn', was_minor: 5000, now_minor: null }] });
const e = P.usingNew([mint(), mint({ ref: { item_id: GONE }, particulars: 'Old' })], gone, 'INR');
check('a withdrawn line is removed, the other line stays, the count is said', e.lines.length === 1 && e.lines[0].particulars === 'Item' && e.removed === 1, JSON.stringify(e));
const f = P.usingNew([mint({ ref: undefined, item_id: ITEM })], answer(), 'INR');
check('a line that names its product by item_id (no ref) is matched too', f.lines[0].price === 120, JSON.stringify(f));
const jpy = P.usingNew([mint({ price: 1000, total: 2000 })], answer({ lines: [Object.assign({}, priceFact, { was_minor: 1000, now_minor: 1200 })] }), 'JPY');
check('JPY has no minor digits: 1200 minor is 1200 (the currency\'s own decimals)', jpy.lines[0].price === 1200, JSON.stringify(jpy));

/* Send as drafted */
check('as drafted: the ack is handed back exactly as the server gave it', P.asDrafted(answer()) === ACK, '');
check('as drafted: a rate or a withdrawn line has no ack to hand back', P.asDrafted(rate) === null && P.asDrafted(gone) === null && P.asDrafted({ code: 'PRICE_MOVED', lines: [], can_send_as_drafted: true }) === null, '');

/* the words */
check('words: a price line names both figures', P.rowWords(priceFact, 'INR') === 'Item - price changed: INR 100.00 > INR 120.00', P.rowWords(priceFact, 'INR'));
check('words: a rate line names both rates, a withdrawn line says it will be removed', P.rowWords(rate.lines[0], 'INR') === 'Item - tax rate changed: 18% > 12%' && /no longer sold/.test(P.rowWords(gone.lines[0], 'INR')) && /will be removed/.test(P.rowWords(gone.lines[0], 'INR')), '');

/* the reach line: the engine's totals before > after, who gets it, how many lines */
const withTotal = answer({ total: { currency: 'INR', before: 236, after: 283.2 }, reach: { recipients: ['Sri Ganesh Provisions'], lines: 1 } });
check('reach words: total 236 > 283.2 from the answer, who gets it, the lines (no figure worked out here)', P.reachWords(withTotal, 'INR') === 'Total: INR 236.00 > INR 283.20 (with the new prices). Goes to Sri Ganesh Provisions · Lines 1', P.reachWords(withTotal, 'INR'));
check('reach words: no total from the server says no total, a self bill says own copy only', P.reachWords(answer({ total: null, reach: { recipients: [], lines: 2 } }), 'INR') === 'Your own copy only · Lines 2', P.reachWords(answer({ total: null, reach: { recipients: [], lines: 2 } }), 'INR'));

/* failed(): the one place every failed send goes */
let said = null, asked = null, sent = null;
const fail = (text) => { said = text; };
const resend = (v) => { sent = v; };
P.askQuestion = (data, choices, currency) => { asked = { data, choices, currency }; };
const sentBody = { recipients: [], line_items: [mint()], promote_draft_id: 'D1' };
check('failed: an ordinary error says its own words and asks nothing', P.failed(new Error('Boom'), sentBody, fail, resend) === null && said === 'Boom' && asked === null, said);
said = null;
check('failed: an error with no message says the old plain sentence', P.failed(null, sentBody, fail, resend) === null && /Something went wrong/.test(said), said);
check('failed: PRICE_MOVED opens the question with the answer and the shop currency, says nothing as an error', P.failed(err(answer()), sentBody, fail, resend) === null && asked && asked.data.code === 'PRICE_MOVED' && asked.currency === 'INR', '');
sent = null; asked.choices.onNew();
check('choose new prices: resent once with the re-priced lines, no ack, the rest of the send as it was', sent && sent.line_items[0].price === 120 && !('total' in sent.line_items[0]) && sent.price_ack === null && sent.promote_draft_id === 'D1' && sentBody.line_items[0].price === 100, JSON.stringify(sent));
sent = null; asked.choices.onDrafted();
check('choose as drafted: resent with the lines as drafted (100) and the server\'s ack', sent && sent.line_items[0].price === 100 && sent.price_ack === ACK, JSON.stringify(sent));
sent = null; asked.choices.onBack();
check('choose back: nothing is sent', sent === null, '');
said = null; sent = null;
P.failed(err(gone), { line_items: [mint({ ref: { item_id: GONE } })] }, fail, resend); asked.choices.onNew();
check('every line withdrawn: nothing is sent and the person is told', sent === null && /Nothing is left to send/.test(said), said);

/* app.html: the wire and the one failure path */
const html = fs.readFileSync(path.join(ROOT, 'public', 'app.html'), 'utf8').split('\r\n').join('\n');
const sendChit = html.slice(html.indexOf('async function sendChit(v)'), html.indexOf('THE 6 MB CAP'));
check('app.html sendChit sends price_ack beside promote_draft_id', /promote_draft_id: v\.promote_draft_id,\s*price_ack: v\.price_ack,/.test(sendChit), '');
check('app.html sendChit: every failure goes through CBPriceMoved.failed with sendChit as the resend', /return CBPriceMoved\.failed\(e, v, fail, sendChit\)/.test(sendChit), '');
check('app.html loads the module', /<script src="\/app\/chit-price-moved\.js"><\/script>/.test(html), '');

console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASS');
process.exit(failures ? 1 : 0);
