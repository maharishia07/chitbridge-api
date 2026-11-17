/**
 * tests/cap-quotes-rounds.test.cjs — RAIL-117 (U9): the RFQ rounds screen, CBQuotes (public/app/cap-quotes.js), driven with no browser.
 * Proves, per state of a quotation (buyer / seller, no round / a request / a priced round / agreed):
 *   the words "Quotation only — <seller country> rules apply; duties and taxes in <buyer country> not included" (from the data, never a hard-coded country),
 *   the step tracker, which of accept / counter (Price it) / reject show and under which id, that a REQUEST is never offered an Accept (the seller prices it),
 *   that accept / reject / a counter each ask first (money promise) and then POST the right door with the right body (a counter = quantity + asked price as TEXT),
 *   that a bad number is refused before any POST, that an open counter form is never repainted by a refresh,
 *   that the first send to another installation asks (askCross) naming who, currency, law and "nothing binds", and that it asks once and sends once.
 * The cross-installation money proof (3 x 100 -> 3 x 98 = 294 -> counter 2 x 98 -> priced 196 -> accepted: both copies, md5 equal) is the SIT scenario
 * toolset/sit-hunt/rail/u9-rfq.cjs (RAIL-U9a..c), run by the batch gate on sit-in; this file is the screen half.
 * Run: node tests/cap-quotes-rounds.test.cjs        (CAPQ_FILE=<path> aims it at another copy of cap-quotes.js: the mutation check)
 */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const FILE = process.env.CAPQ_FILE || path.join(ROOT, 'public', 'app', 'cap-quotes.js');

globalThis.window = globalThis;
const posts = [], confirms = [], toasts = [];
let asked = null;
const fns = fs.readFileSync(path.join(ROOT, 'public', 'app', 'helpers.js'), 'utf8');
const grab = (name) => { const m = fns.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}\\n')); assert(m, 'helpers.js has ' + name); return m[0]; };
(0, eval)(grab('esc') + grab('chitIsQuote') + ';globalThis.esc = esc; globalThis.chitIsQuote = chitIsQuote;');
globalThis.fmtMoney = (n, cur) => cur + ' ' + Number(n).toFixed(2);
globalThis.toast = (m) => toasts.push(m);
globalThis.EP = {};

/** a host element: innerHTML in, the controls out (parsed from the markup); typed values come from `typed` */
const typed = {};
function mkHost() {
  const host = {
    _h: '', attrs: {}, isConnected: true,
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector(sel) {
      if (/data-quote-form/.test(sel)) return /data-quote-form="1"/.test(this._h) ? { x: 1 } : null;
      if (/quote-out/.test(sel)) return /data-testid="quote-out"/.test(this._h) ? { setAttribute() {}, set textContent(v) { toasts.push(v); } } : null;
      if (/quote-steps-host/.test(sel)) return { insertAdjacentHTML() {} };
      if (/quote-note/.test(sel)) return { value: typed.note || '' };
      return null;
    },
    querySelectorAll() {
      const out = [], re = /<input[^>]*data-testid="(quote-(?:qty|price)-(\d+))"[^>]*data-line="(\d+)"[^>]*data-f="(\w+)"/g;
      let m;
      while ((m = re.exec(this._h))) { const hit = m; out.push({ getAttribute: (k) => ({ 'data-line': hit[3], 'data-f': hit[4] })[k], value: typed[hit[1]] != null ? typed[hit[1]] : '' }); }
      return { forEach: (fn) => out.forEach(fn) };
    }
  };
  return host;
}
const stepsHost = { setAttribute() {}, innerHTML: '' };
globalThis.document = { getElementById: () => stepsHost };
/** CBAction.run: records the confirm it was given, then presses yes (or no) and runs the write */
let pressYes = true;
globalThis.CBAction = { run: async (btn, fn, o) => { confirms.push(o.confirm); if (!pressYes) return { ok: false, cancelled: true }; try { const value = await fn(); return { ok: true, value }; } catch (e) { return { ok: false, error: e }; } } };

let CHIT = null, ROUNDS = [];
globalThis.api = async (key, o) => {
  if (key === 'chit') return CHIT;
  if (key === 'quoteList') return { proposals: ROUNDS, migrated: true };
  posts.push({ key, params: o.params, body: o.body });
  return { status: 'ok' };
};
globalThis.confirmAsk = (title, body, yes, onYes) => { asked = { title, body, yes }; if (pressYes) onYes(); };

(0, eval)(fs.readFileSync(FILE, 'utf8'));
const Q = globalThis.CBQuotes;
assert(Q && typeof Q.mount === 'function', 'cap-quotes.js gives CBQuotes.mount');

const BUYER = 'b1', SELLER = 's1', CH = 'c0000000-0000-4000-8000-000000000001';
/** the chit as ONE party reads it: who holds this copy decides buyer or seller (an order is priced by whoever did not send it) */
function chitFor(holder, more) {
  return { header: Object.assign({ chit_id: CH, purpose: 'order', sender_entity_id: BUYER, entity_id: holder, sender_entity_display_name: 'Delhi Pumps',
    all_recipients: [{ entity_id: BUYER, display_name: 'Delhi Pumps' }, { entity_id: SELLER, display_name: 'Sydney Spice' }],
    business_json: { deal_type: 'rfq', jurisdiction: { document: 'quotation', seller_country: 'AU', buyer_country: 'IN' } } }, more),
  detail: { currency_code: 'AUD', line_items: [{ particulars: 'Pump', quantity: 3, price: 100 }] } };
}
const round = (n, more) => Object.assign({ proposal_id: 'p' + n, round: n, kind: 'request', status: 'proposed', mine: false, awaiting_me: false, money: null, request: { lines: [{ line_index: 0, quantity: 3, requested_price: '98' }] }, currency_code: 'AUD' }, more);
const has = (host, re) => re.test(host.innerHTML);
const ids = (host) => (host.innerHTML.match(/data-testid="quote-(?:accept|counter|reject)-\d+"/g) || []).map((s) => s.slice(13, -1));
async function mount(holder, rounds, more) { CHIT = chitFor(holder, more); ROUNDS = rounds; const host = mkHost(); await Q.mount(host, CH); return host; }

let pass = 0, fail = 0;
async function test(name, fn) { try { posts.length = confirms.length = toasts.length = 0; asked = null; pressYes = true; Object.keys(typed).forEach((k) => delete typed[k]); await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + String(e && e.message).split('\n').slice(0, 3).join('\n          ')); } }

(async () => {
  await test('the words come from the data: Quotation only, seller and buyer countries named', async () => {
    const host = await mount(BUYER, []);
    assert(has(host, /data-testid="quote-jurisdiction"/), 'a banner shows');
    assert(has(host, /Quotation only — Australia rules apply; duties and taxes in India not included/), 'wording: ' + host.innerHTML.match(/Quotation only[^<]*/));
    const other = await mount(BUYER, [], { business_json: { deal_type: 'rfq', jurisdiction: { document: 'quotation', seller_country: 'IN', buyer_country: 'AE' } } });
    assert(has(other, /Quotation only — India rules apply; duties and taxes in United Arab Emirates not included/), 'a second country pair reads from its own data');
    assert(!has(other, /Australia/), 'no country is hard-coded');
  });

  await test('an installation key is never printed as a country, and an unset buyer country says so in plain words', async () => {
    const host = await mount(BUYER, [], { business_json: { deal_type: 'rfq', jurisdiction: { document: 'quotation', seller_country: 'sit-au' } } });
    assert(has(host, /Quotation only — sit-au rules apply; your duties and taxes are not included/) || has(host, /Quotation only — the seller’s rules apply/), 'text: ' + host.innerHTML.match(/Quotation only[^<]*/));
  });

  await test('the tracker has four steps in order: sent · reached · priced · accepted; the buyer waits at "priced"', async () => {
    const host = await mount(BUYER, []);
    const steps = [...host.innerHTML.matchAll(/data-testid="(quote-step-\w+)" data-step="(\w+)"/g)].map((m) => m[1] + ':' + m[2]);
    assert.deepStrictEqual(steps, ['quote-step-sent:done', 'quote-step-reached:done', 'quote-step-priced:now', 'quote-step-accepted:todo']);
    assert(has(host, /Waiting for Sydney Spice to price your request/), 'the waiting sentence names the seller');
    assert.deepStrictEqual(ids(host), [], 'no accept / counter / reject while nothing is asked of the buyer');
  });

  await test('a chit that crossed but was not confirmed says "not delivered yet", never "Reached"', async () => {
    CHIT = chitFor(BUYER); CHIT.ctp_unconfirmed = { since: 'now' }; ROUNDS = [];
    const host = mkHost(); await Q.mount(host, CH);
    assert(has(host, /data-testid="quote-unconfirmed"/) && has(host, /not delivered yet/), 'the held mark is painted');
    assert(has(host, /quote-step-reached" data-step="now"/), 'the reached step is still "now"');
  });

  await test('the seller sees a request: Price it + Reject under round ids, and NO Accept (a request is priced, not accepted)', async () => {
    const host = await mount(SELLER, [round(1, { awaiting_me: true })]);
    assert.deepStrictEqual(ids(host), ['quote-counter-1', 'quote-reject-1']);
    assert(has(host, />Price it</), 'the seller’s button is "Price it"');
    assert(has(host, /Delhi Pumps/), 'the buyer is named');
  });

  await test('the buyer sees a priced round: Accept · Counter · Reject, each with its round id; the amount is the round’s own money in the quote currency', async () => {
    const host = await mount(BUYER, [round(1, { mine: true }), round(2, { kind: 'pro_forma', awaiting_me: true, money: { net: 294, tax: 0, total: 294 } })]);
    assert.deepStrictEqual(ids(host), ['quote-accept-2', 'quote-counter-2', 'quote-reject-2']);
    assert(has(host, /AUD 294\.00/), 'total in AUD from the round');
    assert(has(host, />Counter</), 'the buyer’s button is "Counter"');
  });

  await test('accept asks first naming the other business and the amount, then POSTs accept for that round; a "no" posts nothing', async () => {
    const rows = [round(2, { kind: 'pro_forma', awaiting_me: true, money: { net: 294, total: 294 } })];
    await mount(BUYER, rows);
    pressYes = false; await Q.accept(CH, 'p2', {});
    assert.strictEqual(posts.length, 0, 'a no sends nothing');
    assert(/Accept Sydney Spice’s price\?/.test(confirms[0].title) && /AUD 294\.00/.test(confirms[0].body) && confirms[0].danger === false, 'confirm: ' + JSON.stringify(confirms[0]));
    pressYes = true; await Q.accept(CH, 'p2', {});
    assert.deepStrictEqual(posts.map((p) => p.key + ':' + p.params.pid), ['quoteAccept:p2']);
  });

  await test('reject asks first (danger), says who sees it, then POSTs reject', async () => {
    await mount(BUYER, [round(2, { kind: 'pro_forma', awaiting_me: true, money: { net: 294 } })]);
    await Q.reject(CH, 'p2', {});
    assert(confirms[0].danger === true && /Sydney Spice sees it/.test(confirms[0].body), 'confirm: ' + JSON.stringify(confirms[0]));
    assert.deepStrictEqual(posts.map((p) => p.key + ':' + p.params.pid), ['quoteReject:p2']);
  });

  await test('the buyer’s counter: form of quantity + asked price as TEXT, confirm says the seller sets the price, POST counter carries 2 and "98"', async () => {
    const host = await mount(BUYER, [round(2, { kind: 'pro_forma', awaiting_me: true, money: { net: 294 } })]);
    Q.openForm(CH, 'p2');
    assert(has(host, /data-testid="quote-form"/) && has(host, /Your counter/) && has(host, /data-f="requested_price"/), 'the buyer’s form asks for a requested price');
    assert(!has(host, /data-f="price"/), 'the buyer has no price field');
    typed['quote-qty-0'] = '2'; typed['quote-price-0'] = '98';
    await Q.send(CH, {});
    assert(/Send this counter to Sydney Spice\?/.test(confirms[0].title) && /Sydney Spice sets the price\. Nothing binds until you accept it\./.test(confirms[0].body), 'confirm: ' + JSON.stringify(confirms[0]));
    assert.deepStrictEqual(posts, [{ key: 'quoteCounter', params: { id: CH, pid: 'p2' }, body: { lines: [{ line_index: 0, quantity: 2, requested_price: '98' }], note: '' } }]);
    assert.strictEqual(typeof posts[0].body.lines[0].requested_price, 'string', 'the asked price travels as text, never a number the buyer computed');
  });

  await test('the seller prices the first request: the form has a price per line in the quote currency, POST propose (no round id) carries 98', async () => {
    const host = await mount(SELLER, []);
    assert(has(host, /data-testid="quote-price-new"/), 'a seller with no round sees "Price this request"');
    Q.openForm(CH, '');
    assert(has(host, /Your price/) && has(host, /data-f="price"/) && has(host, /placeholder="AUD"/), 'seller form: price field, currency AUD');
    typed['quote-qty-0'] = '3'; typed['quote-price-0'] = '98';
    await Q.send(CH, {});
    assert(/Send your price to Delhi Pumps\?/.test(confirms[0].title) && /Nothing binds until Delhi Pumps accepts it\./.test(confirms[0].body), 'confirm: ' + JSON.stringify(confirms[0]));
    assert.deepStrictEqual(posts, [{ key: 'quotePropose', params: { id: CH }, body: { lines: [{ line_index: 0, quantity: 3, price: 98 }], note: '' } }]);
  });

  await test('a quantity or price that is not a number is refused before any POST or confirm', async () => {
    await mount(SELLER, []);
    Q.openForm(CH, '');
    typed['quote-qty-0'] = 'three'; typed['quote-price-0'] = '98';
    await Q.send(CH, {});
    assert.strictEqual(posts.length + confirms.length, 0, 'nothing asked, nothing sent');
  });

  await test('a refresh never repaints a counter form being typed in; without a form it repaints', async () => {
    const host = await mount(BUYER, [round(2, { kind: 'pro_forma', awaiting_me: true, money: { net: 294 } })]);
    Q.openForm(CH, 'p2');
    const before = host.innerHTML;
    ROUNDS = [];
    assert.strictEqual(await Q.refresh(CH), false, 'refresh declines');
    assert.strictEqual(host.innerHTML, before, 'the open form is untouched');
    Q.closeForm(CH);
    assert.strictEqual(await Q.refresh(CH), true, 'with no form it reads again');
    assert(has(host, /quote-none/), 'and paints the new (empty) rounds');
  });

  await test('after the buyer accepts: the banner reads "Pro-forma — agreed by both sides" and no button is left', async () => {
    const host = await mount(BUYER, [round(2, { kind: 'pro_forma', status: 'accepted', money: { net: 196, total: 196 } })]);
    assert(has(host, /Pro-forma — agreed by both sides/) && !has(host, /Quotation only/), 'agreed words');
    assert.deepStrictEqual(ids(host), []);
    assert(has(host, /quote-step-accepted" data-step="done"/), 'tracker ends done');
  });

  await test('a rejected round offers the buyer "Ask again" and not "Accept"', async () => {
    const host = await mount(BUYER, [round(1, { mine: true, status: 'countered' }), round(2, { kind: 'pro_forma', status: 'rejected', money: { net: 294 } })]);
    assert(has(host, /data-testid="quote-ask-again"/), 'ask again shows');
    assert.deepStrictEqual(ids(host), []);
  });

  await test('the first send to another installation asks: names the business, its currency, its law, the buyer’s duties, and "nothing binds"; yes sends once', async () => {
    let sent = 0;
    Q.askCross({ name: 'Sydney Spice', country: 'AU', where: 'sit-au', currency: 'AUD', buyerCountry: 'IN' }, () => { sent++; });
    assert(asked && /Ask Sydney Spice for a quote\?/.test(asked.title) && asked.yes === 'Send', 'title: ' + (asked && asked.title));
    for (const re of [/Sydney Spice/, /sit-au, Australia/, /Their prices are in AUD\./, /Australia law and tax apply\./, /India’s import duty and taxes are not included\./, /A quotation, not a sale\. Nothing binds until you accept\./, /data-testid="quote-cross-confirm"/])
      assert(re.test(asked.body), 'the confirm says ' + re + ' in ' + asked.body);
    assert.strictEqual(sent, 1, 'one yes, one send');
    pressYes = false; sent = 0;
    Q.askCross({ name: 'Sydney Spice', country: 'AU', currency: 'AUD' }, () => { sent++; });
    assert.strictEqual(sent, 0, 'a no sends nothing');
  });

  await test('every control and step the screen paints has an id in the quote- family (the register rule)', async () => {
    const host = await mount(BUYER, [round(1, { mine: true }), round(2, { kind: 'pro_forma', awaiting_me: true, money: { net: 294, total: 294 } })]);
    Q.openForm(CH, 'p2');
    const buttons = [...host.innerHTML.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
    assert(buttons.length >= 5, 'accept, counter, reject, send, cancel are on screen');
    for (const b of buttons) assert(/data-testid="quote-[\w-]+"/.test(b), 'button without a quote- id: ' + b);
    for (const li of host.innerHTML.match(/<li\b[^>]*data-step[^>]*>/g) || []) assert(/data-testid="quote-step-\w+"/.test(li), 'step without an id: ' + li);
  });

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
