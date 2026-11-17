'use strict';
/* tests/rewards-pane.test.cjs — THE REWARDS PANE SHOWS THE SERVER'S POINTS, NEVER ITS OWN ARITHMETIC (public/app/cap-rewards.js).
 * UNIT      08 REWARDS & LOYALTY / Customer's rewards view (web half; its api route is tests/rewards-customer-view.test.cjs in chitbridge-api)
 * OWNS      what the pane may and may not do: no programme → the server's one plain line (never a blank, never "0 points") · points are printed as points and the
 *           shop's debt only when the server says money_known, through the host's formatter · a negative balance is flagged in words · the history is capped at the
 *           newest 8 and a gain carries "+" · every server string is escaped (a customer name or ref cannot inject markup) · a failed read says so in words and logs,
 *           never "nothing here" · a host replaced while the read was out is not painted into (no throw) · nothing is added up in the browser.
 * CALLED BY .github/workflows/ci.yml (web guards). No browser, no network: the module is required in node with the host's esc supplied.
 * FLOW      CBRewardsPane.html(answer, opts) → string asserted · CBRewardsPane.load(host, opts) over a stub element
 * CARD      08-rewards-and-loyalty/customer-s-rewards-view
 * Run: node tests/rewards-pane.test.cjs */
const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const logged = [];
globalThis.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
globalThis.cblog = (level, msg) => logged.push(level + ': ' + msg);
const CBRewardsPane = require('../public/app/cap-rewards.js');
const money = (v) => 'Rs ' + v.toFixed(2);

const ANSWER = {
  programme: 'Shop points', points: 412, worth: 4.12, negative: false, money_known: true, earns: '1 point for every 100 spent',
  says: '412 points · worth 4.12', next: { name: 'Free chai', short: 88 }, expires_months: 12, expired_now: 0,
  recent: [{ at: '2026-11-01T10:00:00Z', why: 'earned', ref: 'B-9', points: 12 }, { at: '2026-10-30T10:00:00Z', why: 'spent', ref: 'B-7', points: -100 }]
};

(async () => {
  const none = CBRewardsPane.html({ programme: null, points: 0, says: 'This shop does not run a points programme.' }, { t: (s) => s });
  ok(/data-testid="rw-none"/.test(none) && /does not run a points programme/.test(none), 'no programme: the server\'s one plain line, in its own testid');
  ok(!/rw-points/.test(none) && !/0 points/.test(none), 'no programme: no "0 points" balance is invented');
  ok(/does not run a points programme/.test(CBRewardsPane.html(null, {})), 'no answer at all still says the plain line, never a blank pane');
  ok(/Not running/.test(CBRewardsPane.html({ programme: null, says: 'Not running' }, {})), 'the server\'s own sentence wins over the default');

  const pane = CBRewardsPane.html(ANSWER, { money, t: (s) => s });
  ok(/<b data-testid="rw-points">412<\/b> points/.test(pane), 'the balance prints as 412 POINTS (a count, not a currency)');
  ok(/the shop owes Rs 4\.12/.test(pane), 'what the shop owes is shown through the host\'s money formatter, from the server\'s worth');
  ok(!/Rs 412|412\.00/.test(pane), 'points are never formatted as money');
  ok(/data-testid="rw-says"/.test(pane) && /412 points · worth 4\.12/.test(pane), 'the interpretation is the server\'s sentence, not rebuilt here');
  ok(/rw-next/.test(pane) && /Free chai/.test(pane) && /88/.test(pane), 'the next reward and how far off it is');
  ok(/12 months after they are earned/.test(pane), 'the expiry is stated in words');

  const noMoney = CBRewardsPane.html(Object.assign({}, ANSWER, { money_known: false }), { money, t: (s) => s });
  ok(!/the shop owes/.test(noMoney) && !/Rs /.test(noMoney), 'money_known false: the debt line is NOT printed (no invented rate)');

  const neverExpires = CBRewardsPane.html(Object.assign({}, ANSWER, { expires_months: null }), { t: (s) => s });
  ok(/never — this shop has not set an expiry/.test(neverExpires), 'no expiry set says so in words rather than printing "null months"');

  const below = CBRewardsPane.html(Object.assign({}, ANSWER, { points: -60, negative: true }), { money, t: (s) => s });
  ok(/below zero — check the ledger/.test(below) && /-60/.test(below), 'a negative balance is flagged in words, not hidden');

  const expired = CBRewardsPane.html(Object.assign({}, ANSWER, { expired_now: 25 }), { t: (s) => s });
  ok(/rw-expired/.test(expired) && /25/.test(expired) && !/rw-expired/.test(pane), 'points that just expired are shown, and only when there are some');

  ok(/\+12/.test(pane) && /-100/.test(pane) && !/\+-100/.test(pane), 'history: a gain carries "+", a spend shows its minus, never "+-"');
  ok(/2026-11-01/.test(pane) && !/2026-11-01T10/.test(pane), 'history: the day only, not a raw timestamp');

  const many = Array.from({ length: 20 }, (_, i) => ({ at: '2026-10-' + String(10 + (i % 18)).padStart(2, '0'), why: 'earned', ref: 'R' + i, points: 1 }));
  const history = CBRewardsPane.html(Object.assign({}, ANSWER, { recent: many }), {});
  ok((history.match(/class="rw-e"/g) || []).length === 8, 'history is capped at the newest 8 of 20');
  ok(!/rw-history/.test(CBRewardsPane.html(Object.assign({}, ANSWER, { recent: [] }), {})), 'no movements: no empty history box');

  const hostile = CBRewardsPane.html(Object.assign({}, ANSWER, { earns: '<img src=x onerror=1>', next: { name: '"><script>x</script>', short: '<b>' }, recent: [{ at: '2026-11-01', why: '<i>', ref: '<s>', points: 1 }] }), {});
  ok(/&lt;img src=x onerror=1&gt;/.test(hostile) && /&lt;script&gt;/.test(hostile), 'markup in earns / next / history is shown as text');

  /* ── load ── */
  function host(id) { return { id, innerHTML: '' }; }
  const el = host('rw1');
  const doc = { byId: { rw1: el }, getElementById(i) { return this.byId[i] || null; } };
  globalThis.document = doc;
  global.window = undefined;
  const p = CBRewardsPane.load(el, { read: () => Promise.resolve(ANSWER), money, t: (s) => s });
  ok(/Reading/.test(el.innerHTML), 'while the read is out the pane says it is reading');
  await p;
  ok(/rw-points/.test(el.innerHTML), 'the answer is painted when it arrives');

  const el2 = host('rw2'); doc.byId.rw2 = el2;
  await CBRewardsPane.load(el2, { read: () => Promise.reject(new Error('boom')), t: (s) => s });
  ok(/data-testid="rw-error"/.test(el2.innerHTML) && /Could not read the points/.test(el2.innerHTML), 'a failed read says so in words');
  ok(!/does not run a points programme/.test(el2.innerHTML), 'a failed read is NOT shown as "no programme"');
  ok(logged.some((l) => /rewards pane: boom/.test(l)), 'a failed read is logged, not swallowed');

  const el3 = host('rw3'); doc.byId.rw3 = el3;
  const slow = CBRewardsPane.load(el3, { read: () => new Promise((r) => setTimeout(() => r(ANSWER), 5)), t: (s) => s });
  delete doc.byId.rw3; /* the host was left while the read was out */
  await slow;
  ok(/Reading/.test(el3.innerHTML) && !/rw-points/.test(el3.innerHTML), 'a host that is gone is not painted into, and nothing throws');

  let asked = null;
  const el4 = host('rw4'); doc.byId.rw4 = el4;
  await CBRewardsPane.load(el4, { id: 'cust-5', api: (name, o) => { asked = [name, o]; return Promise.resolve(ANSWER); } });
  ok(asked && asked[0] === 'custRewards' && asked[1].params.id === 'cust-5', 'with no read(), it asks the named endpoint custRewards for that customer id');

  ok((await CBRewardsPane.load(null, {})) === undefined, 'no host: resolves quietly');

  console.log(n + ' checks');
  console.log(n + ' passed');
})().catch((e) => { console.error('  FAIL ' + (e && e.stack ? e.stack : e)); process.exit(1); });
