/* crm-groups-guard.cjs (MNT-59, pin leg i + ii) — static and vm, no browser: the Groups and Shop window screens keep loading however their file is cut up.
 * OWNS      the facts a split of public/app/cap-crm-groups.js must keep true: each of its 47 names lives in exactly one file of the cap-crm-groups*.js family ·
 *           crm.html loads every family file once, the base first · the whole family, run in one stand-in page, still answers typeof for every name and for the
 *           entries other files call (crmGroups, crmShowcase, crmGroupsClick, crmSendOpen, crmGroupsLoad) · four pure functions of the Send sheet and the
 *           Shop window answer as before (crmSendWords, crmSendBody, crmShopUrl, crmShareVerdict) · CB_SW_VERSION moves once the family has more than one file.
 * CALLED BY .github/workflows/ci.yml (offline guards) · the move-only PR of the split.
 * FLOW      read the family + crm.html + cb-sw.js ──▶ check() ──▶ failures · the vm leg loads the family in tag order ──▶ typeof + the four calls ·
 *           the self-tests run check() on a broken copy of each leg and demand red.
 * CARD      11-crm-and-marketing/marketing-app
 * The 47 names are not typed here: e2e/fixtures/crm-groups-names.json was generated from the base blob of cap-crm-groups.js. Green on the one-file base. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'crm-groups-names.json'), 'utf8'));
const PAGE = 'crm.html';
/* the service worker whose CB_SW_VERSION the family bumps (the guard reads it; it must exist where the register says) */
if (!fs.existsSync(path.join(root, '..', 'public/cb-sw.js'))) throw new Error('public/cb-sw.js is missing');
const CALLED_FROM_OUTSIDE = ['crmGroups', 'crmShowcase', 'crmGroupsClick', 'crmSendOpen', 'crmGroupsLoad'];
const BASE = 'cap-crm-groups.js';
const familyFiles = () => fs.readdirSync(path.join(root, 'app')).filter((file) => /^cap-crm-groups(-[a-z]+)?\.js$/.test(file)).sort((a, b) => (a === BASE ? -1 : b === BASE ? 1 : a < b ? -1 : 1));
const urlOf = (file) => '/app/' + file;
const topNames = (text) => [...text.matchAll(/^(?:(?:async )?function (\w+)|(?:var|const|let) (\w+))/gm)].map((hit) => hit[1] || hit[2]);
const countOf = (text, needle) => text.split(needle).length - 1;

/** every failure of the static facts, given the texts: { family: {file: text}, page: text, sw } */
function check(world) {
  const fails = [], files = Object.keys(world.family);
  for (const name of snapshot.names) {
    const homes = files.filter((file) => topNames(world.family[file]).includes(name));
    if (homes.length !== 1) fails.push('name ' + name + ' must live in exactly one cap-crm-groups file, found in ' + (homes.join(', ') || 'none'));
  }
  for (const file of files) {
    const tag = '<script src="' + urlOf(file) + '"></script>', tags = countOf(world.page, tag);
    if (tags !== 1) fails.push(PAGE + ' must carry the tag for ' + file + ' exactly once, has ' + tags);
    if (file !== BASE && world.page.indexOf(tag) < world.page.indexOf('<script src="' + urlOf(BASE) + '"></script>')) fails.push(PAGE + ' must load ' + file + ' after the base ' + BASE);
  }
  const version = (world.sw.match(/CB_SW_VERSION = '([^']+)'/) || [])[1];
  if (!/^v\d+$/.test(version || '')) fails.push('CB_SW_VERSION not found in cb-sw.js');
  if (files.length > 1 && version === snapshot.swVersion) fails.push('the file was split but CB_SW_VERSION is still ' + version + ': the offline cache keeps the old shell');
  return fails;
}

/** the family run in tag order in one stand-in page; returns the context */
function load(family) {
  const clicks = [];
  const cx = vm.createContext({
    console, tx: (s) => s, txf: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]), esc: (s) => String(s == null ? '' : s),
    CRM: { rows: [], route: null, loaded: true }, SESSION: { bridgeId: 'b 1' }, location: { origin: 'https://x.test' },
    toast: () => {}, closeModal: () => {}, ui: { dialog: () => {} }, crmBar: () => {}, crmAppName: () => '',
    document: { getElementById: () => null, querySelector: () => null, addEventListener: (type, fn) => clicks.push([type, fn]) },
  });
  cx.window = cx;
  for (const file of Object.keys(family)) vm.runInContext(family[file], cx, { filename: file });
  cx.__clicks = clicks;
  return cx;
}

/** the vm leg: every name resolves, the entries other files call are functions, four pure functions answer as before */
function checkLoaded(family) {
  const fails = [];
  let cx;
  try { cx = load(family); } catch (error) { return ['the family does not load in one page: ' + error.message]; }
  const kind = (name) => vm.runInContext('typeof ' + name, cx);
  for (const name of snapshot.names) if (kind(name) === 'undefined') fails.push('typeof ' + name + ' is undefined once the family is loaded');
  for (const name of CALLED_FROM_OUTSIDE) if (kind(name) !== 'function') fails.push(name + ' must be a function: another file calls it');
  const pin = (why, fn) => { try { assert(fn(), why); } catch (error) { fails.push('behaviour: ' + why + (error.code === 'ERR_ASSERTION' ? '' : ' (' + error.message + ')')); } };
  pin('crmSendWords: 403 says view-only, a known code says its sentence, anything else says try again', () =>
    cx.crmSendWords({ status: 403, data: {} }) === 'Your login can only view.' && cx.crmSendWords({ data: { code: 'NO_TEXT' } }) === 'Write the message.'
    && cx.crmSendWords({ data: { code: 'TOO_MANY', why: 'Up to 5' } }) === 'Up to 5' && cx.crmSendWords({ data: { code: '?' } }) === "Couldn't send. Try again.");
  pin('crmSendBody: the channel and purpose of the screen, a dry flag, the text trimmed', () => {
    vm.runInContext("GROUPS.channel = 'whatsapp'; GROUPS.purpose = 'marketing';", cx);
    const body = cx.crmSendBody(true);
    return body.channel === 'whatsapp' && body.purpose === 'marketing' && body.text === '' && body.dry === true && cx.crmSendBody(false).dry === false;
  });
  pin('crmShopUrl: the origin plus the shop link of this login, encoded', () => cx.crmShopUrl() === 'https://x.test/shop.html?s=b%201');
  pin('crmShareVerdict: no record is unreadable, no consent is refused, a granted one is returned as the server said', () => {
    vm.runInContext("SHOW.rec = null;", cx);
    const none = cx.crmShareVerdict();
    vm.runInContext("SHOW.rec = { contact_prefs: { may: {} } };", cx);
    const refused = cx.crmShareVerdict();
    vm.runInContext("SHOW.rec = { contact_prefs: { may: { whatsapp: { marketing: { may: true } } } } };", cx);
    return none.code === 'UNREADABLE' && none.may === false && refused.code === 'NO_CONSENT' && cx.crmShareVerdict().may === true;
  });
  pin('the Shop window pick listens for a click on a data-sc-pick control', () => cx.__clicks.some((entry) => entry[0] === 'click'));
  return fails;
}

const live = () => ({ family: Object.fromEntries(familyFiles().map((file) => [file, read('app/' + file)])), page: read(PAGE), sw: read('cb-sw.js') });
const copy = (world) => JSON.parse(JSON.stringify(world));
const swap = (text, from, to) => { if (!text.includes(from)) throw new Error('self-test anchor missing: ' + from); return text.replace(from, to); };

/** each leg shown red on a broken copy of the real files; the split state is simulated by a part that moves one real unit out of the base */
function selfTests(world) {
  const tests = [];
  const red = (why, mutate, pattern, loaded) => tests.push({ why, mutate, pattern, loaded });
  const part = Object.keys(world.family).find((file) => file !== BASE) || 'cap-crm-groups-send.js';
  const homeOf = (made, name) => Object.keys(made.family).find((file) => topNames(made.family[file]).includes(name));
  const split = (made) => {
    if (Object.keys(made.family).length > 1) return made;
    const unit = /^function crmShopUrl[^]*?^\}\n/m;
    made.family[part] = made.family[BASE].match(unit)[0];
    made.family[BASE] = made.family[BASE].replace(unit, '');
    made.page = swap(made.page, '<script src="/app/' + BASE + '"></script>', '<script src="/app/' + BASE + '"></script><script src="/app/' + part + '"></script>');
    return made;
  };
  red('the page tag removed', (made) => { made.page = swap(made.page, '<script src="/app/' + BASE + '"></script>', ''); }, /must carry the tag/);
  red('a name defined in two files', (made) => { made.family['cap-crm-groups-x.js'] = 'function crmShopUrl() {}\n'; made.page += '<script src="/app/cap-crm-groups-x.js"></script>'; }, /name crmShopUrl .*exactly one/);
  red('a name removed', (made) => { const home = homeOf(made, 'crmShopUrl'); made.family[home] = swap(made.family[home], 'function crmShopUrl', 'function crmShopUrlGone'); }, /name crmShopUrl .*none/);
  red('crmSendWords changed', (made) => { const home = homeOf(made, 'crmSendWords'); made.family[home] = swap(made.family[home], "'Write the message.'", "'Write it.'"); }, /behaviour: crmSendWords/, true);
  red('crmShopUrl changed', (made) => { const home = homeOf(made, 'crmShopUrl'); made.family[home] = swap(made.family[home], "'/shop.html?s='", "'/shop?s='"); }, /behaviour: crmShopUrl/, true);
  tests.push({ why: 'the simulated split is green', mutate: (made) => { split(made); made.sw = made.sw.replace(/CB_SW_VERSION = '[^']+'/, "CB_SW_VERSION = 'v999'"); }, pattern: null, loaded: true });
  red('a part tag removed on a split page', (made) => { split(made); made.page = swap(made.page, '<script src="/app/' + part + '"></script>', ''); }, /must carry the tag for cap-crm-groups-/);
  red('the part loaded before the base', (made) => { split(made); const baseTag = '<script src="/app/' + BASE + '"></script>', partTag = '<script src="/app/' + part + '"></script>'; made.page = swap(made.page, baseTag, ''); made.page = swap(made.page, partTag, partTag + baseTag); }, /after the base/);
  red('CB_SW_VERSION not bumped on a split', (made) => { split(made); made.sw = made.sw.replace(/CB_SW_VERSION = '[^']+'/, "CB_SW_VERSION = '" + snapshot.swVersion + "'"); }, /CB_SW_VERSION is still/);
  return tests.map((test) => {
    const made = copy(world);
    test.mutate(made);
    const fails = check(made).concat(test.loaded ? checkLoaded(made.family) : []);
    return { why: test.why, ok: test.pattern ? fails.some((line) => test.pattern.test(line)) : fails.length === 0, fails };
  });
}

const world = live(), fails = check(world).concat(checkLoaded(world.family));
console.log('  cap-crm-groups family: ' + Object.keys(world.family).join(', ') + ' · ' + snapshot.names.length + ' names');
fails.forEach((line) => console.log('FAIL ' + line));
const bad = (fails.length ? [] : selfTests(world)).filter((test) => !test.ok);
bad.forEach((test) => console.log('FAIL self-test: ' + test.why + (test.fails.length ? ' -> ' + test.fails.join(' | ') : ' -> not red')));
const total = fails.length + bad.length;
console.log(total ? '\ncrm-groups-guard: ' + total + ' FAILED' : '\ncrm-groups-guard: all passed (names in one file each, base first, typeof, four pure functions, SW version; 9 self-tests red or green as expected)');
process.exit(total ? 1 : 0);
