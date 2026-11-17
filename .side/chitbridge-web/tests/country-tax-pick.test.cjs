'use strict';
/* SET-49 (twin of api #528): Country setup's Tax pick has no default. Unknown stays null; only an explicit "not registered" is false.
   Runs public/app/cap-country.js in a vm with stubs (no browser). Run: node tests/country-tax-pick.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const src = fs.readFileSync(__dirname + '/../public/app/cap-country.js', 'utf8');
function load(taxAnswer) {
  const sent = []; const nodes = {}; const runs = [];
  const sb = {
    console, setTimeout, SESSION: { token: 't' }, window: {}, location: {}, navigator: { language: 'en-IN' },
    tx: (s) => s, txf: (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]), esc: (s) => String(s == null ? '' : s),
    SHOP_SUPPLIES: [{ v: 'goods', t: 'Goods' }], CBUnsaved: { form() {} }, toast() {}, go() {}, govCtx() { return null; }, modeRibbon: () => '', logo: () => '',
    CBAction: { run(btn, fn, o) { runs.push(o); return fn(); } },
    api: (name, o) => { if (name === 'countrySetupSave') sent.push(o.body); return Promise.resolve({}); },
    document: { getElementById: (id) => nodes[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {} }), addEventListener() {} },
  };
  sb.window = sb; const cx = vm.createContext(sb);
  for (const f of ['engine/money.js', 'engine/tax.js', 'engine/locale.js', 'app/helpers.js']) vm.runInContext(fs.readFileSync(__dirname + '/../public/' + f, 'utf8'), cx);
  vm.runInContext(src, cx);
  const host = { innerHTML: '' };
  vm.runInContext('CSU.host = null;', cx);
  sb.CSU.host = host; sb.CSU.loading = false; sb.CSU.readErr = true; sb.CSU.flags = {};
  sb.CSU.p = { done: false, country: { code: 'AU' }, currency: 'AUD', fy_start_month: 7, tax: taxAnswer, countries: [] };
  sb.csuPrefill(); sb.renderCountrySetup();
  return { sb, host, sent, runs };
}
const taxHtml = (h) => (h.innerHTML.match(/id="cs-tax-reg"[\s\S]*?<\/select>/) || [''])[0];

let t = load({ registered: null, number: null, scheme: null });
ok(t.sb.CSU.edit.registered === null, 'null from the server stays null in the edit state (not false)');
ok(!/ selected>Not registered|selected>Registered/.test(taxHtml(t.host)) && /<option value=""[^>]* selected>Pick one/.test(taxHtml(t.host)), 'null shows no selection (only "Pick one")');
t.sb.csuSave();
ok(t.sent.length === 1 && t.sent[0].tax.registered === null, 'Tax untouched: Save sends registered:null, never false');

t = load({ registered: null });
t.sb.csuOpen('tax'); t.sb.csuSave();
ok(t.sent.length === 0 && /Pick registered or not registered/.test(t.host.innerHTML), 'Tax opened with no pick: Save asks and sends nothing');

t = load({ registered: null });
t.sb.csuSet('registered', 'no'); t.sb.csuSave();
ok(t.sent.length === 1 && t.sent[0].tax.registered === false && t.sent[0].tax.number === null, 'explicit "not registered" sends false');

t = load({ registered: null });
t.sb.csuSet('registered', 'yes'); t.sb.csuSet('number', '12345678901');
t.sb.csuSave();
ok(t.sent.length === 1 && t.sent[0].tax.registered === true && t.sent[0].tax.number === '12345678901', 'registered sends true plus the number');

t = load({ registered: false });
ok(t.sb.CSU.edit.registered === false, 'a stored explicit false stays false');
/* SET-86: taking a registered shop off its tax asks first (the popup names its reach); the confirm key is sent only after the yes, on every path */
const REG = { registered: true, number: '51824753556', scheme: 'regular' };
t = load(REG);
t.sb.csuSet('registered', 'no'); t.sb.csuSave();
ok(t.runs.length === 1 && t.runs[0].confirm && /no tax/.test(t.runs[0].confirm.body) && /already open/.test(t.runs[0].confirm.body), 'csuSave: registered → not registered carries the confirm popup, with its reach');
ok(t.sent.length === 1 && t.sent[0].tax.registered === false && t.sent[0].confirm_deregister === true, 'csuSave: the body carries confirm_deregister only on that save');
t = load(REG);
t.sb.csuSave();
ok(t.runs[0].confirm === undefined && t.sent[0].confirm_deregister === undefined && t.sent[0].tax.registered === true, 'csuSave: an unchanged registration has no popup and no confirm key');
t = load({ registered: null });
t.sb.csuSet('registered', 'no'); t.sb.csuSave();
ok(t.runs[0].confirm === undefined && t.sent[0].confirm_deregister === undefined, 'csuSave: a first answer of not registered (nothing held) has no popup');
const waitFor = (p) => p.then(() => 1, () => 0);
(async () => {
  t = load(REG); let asked = 0;
  t.sb.confirmAsk = (title, body, yes, onYes) => { asked++; onYes(); };
  t.sb.csuSet('registered', 'no');
  let done = 0; await new Promise((res) => t.sb.csuSaveThen(() => { done = 1; res(); }, () => res()));
  ok(asked === 1 && done === 1 && t.sent.length === 1 && t.sent[0].confirm_deregister === true, 'csuSaveThen (leave the page): asks, then sends with the confirm');
  t = load(REG); t.sb.confirmAsk = (title, body, yes, onYes, danger, onNo) => onNo();
  t.sb.csuSet('registered', 'no');
  let failed = 0; await new Promise((res) => t.sb.csuSaveThen(() => res(), () => { failed = 1; res(); }));
  ok(failed === 1 && t.sent.length === 0, 'csuSaveThen: a No sends nothing and rejects (the page stays)');
  t = load(REG);
  t.sb.csuSet('registered', 'no'); failed = 0;
  await new Promise((res) => t.sb.csuSaveThen(() => res(), () => { failed = 1; res(); }));
  ok(failed === 1 && t.sent.length === 0, 'csuSaveThen: a page with no dialog sends nothing (never a silent de-registration)');
  console.log(n + ' passed');
})();
