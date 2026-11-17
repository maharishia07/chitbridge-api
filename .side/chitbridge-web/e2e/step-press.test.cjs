'use strict';
// @type: unit
/**
 * step-press.test.cjs - the real step rail (app/step-flow.js) and the shared press rule (app/kbd-press.js) answer the keyboard (UX keyboard fixes, stamps 6-12).
 *
 * OWNS      the proof that CBSteps.railHTML draws a step a person may go back to as a tab stop with a button role and an Enter/Space handler that
 *           goes to the same step the click does, that the current step and an unreachable step are not tab stops, and that CBKbdPress presses a
 *           role=button tabindex element on Enter and Space (and only those), leaving a native button, a plain span and other keys alone.
 * CALLED BY by hand and the QA gate: node e2e/step-press.test.cjs
 * FLOW      load both files -> draw a rail at step 3 -> read its markup -> fake keydown events on fake elements
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/step-flow
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');

/* the rail */
global.esc = (s) => String(s);
const Steps = require('../public/app/step-flow.js');
const flow = Steps.create({ guard: (k) => (k === 'details' ? 'Fill the details first' : null), steps: [{ k: 'items', n: 'Items' }, { k: 'to', n: 'To' }, { k: 'details', n: 'Details' }, { k: 'review', n: 'Review' }] });
Steps.go(flow.ns, 2);
const rail = Steps.railHTML(flow.ns);
const stepTag = (key) => (rail.match(new RegExp('<div class="cbst[^"]*" data-testid="step-' + key + '"[^>]*>')) || [''])[0];
const done = stepTag('items');
check(/role="button"/.test(done) && /tabindex="0"/.test(done), 'a finished step is a tab stop with a button role');
check(done.indexOf('onkeydown') < 0, 'the rail carries no inline key handler of its own: Enter and Space come from kbd-press.js (one press rule)');
check(/onclick="CBSteps\.go\('[^']+',0\)"/.test(done), 'the click handler is unchanged');
check(!/tabindex|role=/.test(stepTag('details')), 'the current step is not a tab stop');
check(!/tabindex/.test(stepTag('review')), 'a step you cannot reach yet is not a tab stop');

/* the press rule */
const ctx = { window: {}, document: { addEventListener() {} } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('kbd-press.js'), ctx);
const KP = ctx.CBKbdPress;
const fake = (tag, attrs) => { const el = { tagName: tag, clicks: 0, click() { this.clicks++; }, getAttribute(n) { return attrs[n] === undefined ? null : attrs[n]; }, hasAttribute(n) { return attrs[n] !== undefined; } }; return el; };
const press = (el, key, extra) => { const ev = Object.assign({ key, target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra || {}); KP.onKey(ev); return ev.defaultPrevented; };
const span = fake('SPAN', { role: 'button', tabindex: '0' });
check(press(span, 'Enter') && span.clicks === 1, 'Enter presses a role=button span');
check(press(span, ' ') && span.clicks === 2, 'Space presses it too, and does not scroll the page (default prevented)');
check(!press(span, 'a') && span.clicks === 2, 'another key does nothing');
const nativeBtn = fake('BUTTON', { role: 'button', tabindex: '0' });
check(!press(nativeBtn, 'Enter') && nativeBtn.clicks === 0, 'a native button is left to the browser (no double press)');
const plain = fake('SPAN', {});
check(!press(plain, 'Enter') && plain.clicks === 0, 'a span that was not marked is not pressed');
/* the guards */
const held = fake('SPAN', { role: 'button', tabindex: '0' });
press(held, 'Enter', { repeat: true });
check(held.clicks === 0, 'a held key (event.repeat) does not press again');
press(held, 'Enter', { defaultPrevented: true });
check(held.clicks === 0, 'a key the page already handled (defaultPrevented) is not pressed');
press(held, 'Enter', { ctrlKey: true }); press(held, ' ', { metaKey: true }); press(held, 'Enter', { altKey: true });
check(held.clicks === 0, 'Ctrl, Meta and Alt chords are left to the browser');
/* two handlers see one physical key press: kbd-press and a second listener, in either order: one press */
const twice = fake('SPAN', { role: 'button', tabindex: '0' });
const sameEvent = { key: 'Enter', target: twice, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
KP.onKey(sameEvent); KP.onKey(sameEvent);
check(twice.clicks === 1, 'two listeners seeing the same event press once, not twice');

/* every page that draws the real rail loads the press rule first; the test board's chip no longer carries an inline copy */
const pub = path.join(__dirname, '..', 'public');
['accounts.html', 'app.html', 'crm.html', 'finance.html', 'shop.html'].forEach((page) => {
  const html = fs.readFileSync(path.join(pub, page), 'utf8');
  const kp = html.indexOf('app/kbd-press.js'), sf = html.indexOf('app/step-flow.js');
  check(kp > 0 && kp < sf, page + ' loads kbd-press.js before step-flow.js');
});
const board = fs.readFileSync(path.join(pub, 'testing.html'), 'utf8');
check(board.indexOf('app/kbd-press.js') > 0 && board.indexOf("onkeydown=\"if(event.key==='Enter'") < 0, 'testing.html loads kbd-press.js and its chip has no inline Enter/Space copy');
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
