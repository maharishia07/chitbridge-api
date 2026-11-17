'use strict';
// @type: unit
/**
 * intake-page-checks.test.cjs - the Intake inbox page (intake.html) keeps its text legible and says a failed sign-in or load in words (UX-137 utility page intake).
 *
 * OWNS      (1) the page's own text and state colours, read from its :root tokens and its own rules, clear the 4.5:1 text threshold on its light
 *           grounds and on cream (the page loads no theme, so it paints only these grounds);
 *           (2) a sign-in or an inbox load that cannot reach the network shows a sentence on the page, not a blank screen and not the raw
 *           fetch error. Run against the page's own script in a vm context with a stubbed document and fetch: no browser.
 * CALLED BY by hand and the QA gate: node e2e/intake-page-checks.test.cjs
 * UNIT      22/Intake screen
 * FLOW      UX-137 step 3 (utility page intake.html); with e2e/ui-codes-intake.test.cjs it is the readability minimums of that page.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.html'), 'utf8').split('\r\n').join('\n');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

const hex = (h) => { const v = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.substr(i, 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); };
const lum = (h) => { const c = hex(h); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const THRESHOLD = 4.5;

/* the page's own colour names, read from its source */
const root = html.match(/:root\{([^}]*)\}/)[1];
const token = (name) => root.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))[1];
const ruleColour = (sel, prop) => {
  const m = html.match(new RegExp(sel.replace(/\./g, '\\.') + '\\{[^}]*?' + prop + ':\\s*(#[0-9a-fA-F]{6}|var\\(--[\\w-]+\\))'));
  if (!m) return null;
  const v = m[1].match(/^var\(--([\w-]+)\)$/);
  return v ? token(v[1]) : m[1];
};
const INK = token('ink'), GREY = token('grey'), OK = token('ok'), BLUE = token('blue'), PURPLE = token('purple'), BG = token('bg');
const CARD = '#ffffff', CREAM = '#faf8f3';
const ERR = ruleColour('.err', 'color'), CHIP = ruleColour('.chn', 'background'), CHIP_INK = ruleColour('.chn', 'color');
const PILL_OFF_INK = ruleColour('.netpill.off', 'color'), PILL_OFF_GROUND = ruleColour('.netpill.off', 'background');

// MIN aa-contrast
{
  const grounds = { 'page': BG, 'card': CARD, 'cream': CREAM };
  for (const [gname, g] of Object.entries(grounds)) {
    for (const [name, c] of [['ink', INK], ['grey', GREY], ['ok', OK], ['error', ERR], ['blue', BLUE], ['purple', PURPLE]]) {
      const r = ratio(c, g);
      check(r >= THRESHOLD, name + ' ' + c + ' on the ' + gname + ' ground is ' + r.toFixed(2) + ':1');
    }
  }
  check(ratio('#ffffff', BLUE) >= THRESHOLD && ratio('#ffffff', PURPLE) >= THRESHOLD, 'white button text on the blue and purple buttons clears the threshold');
  check(ratio(CHIP_INK, CHIP) >= THRESHOLD, 'the Channel chip text on its chip ground is ' + ratio(CHIP_INK, CHIP).toFixed(2) + ':1');
  check(ratio(PILL_OFF_INK, PILL_OFF_GROUND) >= THRESHOLD, 'the offline pill text on its ground is ' + ratio(PILL_OFF_INK, PILL_OFF_GROUND).toFixed(2) + ':1');
  check(ratio(OK, CARD) >= THRESHOLD, 'the online pill text on the card is ' + ratio(OK, CARD).toFixed(2) + ':1');
}

/* the page script, run in a vm with a stubbed document and fetch */
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const SENTENCE = 'Could not reach the network. Check your connection and try again.';
function page(fetchImpl) {
  const els = {};
  const get = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', style: {}, className: '' });
  get('lg_email').value = 'owner@example.test';
  get('lg_otp').value = '123456';
  const ctx = {
    document: { getElementById: get }, location: { search: '' }, URLSearchParams, console, fetch: fetchImpl,
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return { ctx, els };
}
const netDown = async () => { throw new TypeError('Failed to fetch'); };

// MIN could-not-read-words
(async () => {
  const cases = [
    ['sign-in step, no network', async () => { const { ctx, els } = page(netDown); await vm.runInContext('doLogin()', ctx); return els.app.innerHTML; }, SENTENCE],
    ['verify step, no network', async () => { const { ctx, els } = page(netDown); ctx._stage = 'otp'; await vm.runInContext('doLogin()', ctx); return els.app.innerHTML; }, SENTENCE],
    ['verify step, server error with no body', async () => { const { ctx, els } = page(async () => ({ status: 500, json: async () => { throw new SyntaxError('no body'); } })); ctx._stage = 'otp'; await vm.runInContext('doLogin()', ctx); return els.app.innerHTML; }, 'Login failed'],
    ['inbox load, no network', async () => { const { ctx, els } = page(netDown); await vm.runInContext('load()', ctx); return els.app.innerHTML; }, SENTENCE],
  ];
  for (const [name, run, words] of cases) {
    let shown = '';
    try { shown = await run(); } catch (e) { shown = 'THREW ' + e.message; }
    check(shown.includes('class="err"') && shown.includes(words), name + ': the page says "' + words + '" in words');
    check(!/TypeError|Failed to fetch|THREW|undefined/.test(shown), name + ': no raw error or blank reaches the page');
  }
  console.log(failures ? failures + ' FAILED' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
