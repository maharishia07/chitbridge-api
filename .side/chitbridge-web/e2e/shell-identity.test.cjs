'use strict';
// @type: unit
/**
 * shell-identity.test.cjs — the shared customer-page top bar carries the RIGHT identity code on each control (UX-137, Wave 2 shell).
 *
 * OWNS      the proof that every control the shell's top bar draws (shop menu, area menu and its items, licence and edition chips,
 *           the sheet's links) and the bell and avatar it hosts (button, panel rows, every menu item and option, Sign in) wears
 *           data-cbsid, that each testid wears ITS code (a swap of two listed codes fails), and that none carries data-cbname
 *           (that name is ui.action's and lifts a control to 44 px).
 * CALLED BY ci.yml (QA gate, beside ui-action-set); by hand: node e2e/shell-identity.test.cjs  (SHELL_ID_MUTATE=remove or swap must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Cases     the avatar menu is drawn for real; the bar, bell and sheet markup is read from source by testid (those builders need a live
 *           page). Codes are checked against the register copy the census reads (UIID_REG, else ../chitbridge-docs/SCREENS.json, else
 *           C:/dev/SCREENS.json): a code not in it yet is printed as pending, a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const mutate = process.env.SHELL_ID_MUTATE || '';
const read = (file) => {
  let text = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', file), 'utf8');
  if (mutate === 'remove') text = text.split('data-cbsid="CMP033-B01"').join('');
  if (mutate === 'swap') text = text.split('POP113').join('POPSWAP').split('POP114').join('POP113').split('POPSWAP').join('POP114').split('CMP033-B01').join('CMPSWAP').split('CMP048-B01').join('CMP033-B01').split('CMPSWAP').join('CMP048-B01');
  return text;
};
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const CODE_ATTR = /data-cbsid="([A-Z]{3}[0-9]{3}(?:-[A-Z][0-9]{2})*)"/;

/** each control of the bar and what it is: opener CMP033-B01, menu item CMP033-M01, option CMP025-B01, row action CMP038-B01 ... */
const WANT = {
  'rail-bell-html.js': { 'bell-btn': 'CMP030-B01', 'bell-row': 'CMP038-B01', 'bell-clear': 'CMP014-B01' },
  'shell.js': {
    'shell-shop': 'CMP033-B01', 'shell-switcher': 'CMP033-B01', 'shell-switch-': 'CMP033-M01', 'shell-licence-chip': 'CMP033-B01',
    'shell-edition-chip': 'CMP033-B01', 'shell-edition-off': 'CMP014-B01', 'shell-renew': 'CMP010-B01', 'shell-finish': 'CMP010-B01'
  },
  'avatar.js': { 'signin-door': 'CMP052-B01' }
};
const MENU_WANT = [[/^(nav-profile|nav-settings|av-support|nav-signout)$/, 'CMP033-M01'], [/^(theme-|fs-|weight-|font-|lang-|motion-switch|stripes-|kural-|keys-|edition-)/, 'CMP025-B01']];

/** the register copy the census reads, when this machine has one */
function register() {
  const spots = [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json'].filter(Boolean);
  const found = spots.filter((spot) => fs.existsSync(spot))[0];
  if (!found) return null;
  const rows = Object.values(JSON.parse(fs.readFileSync(found, 'utf8')).screens);
  return { live: new Set(rows.filter((row) => !row.retired).map((row) => row.code)), retired: new Set(rows.filter((row) => row.retired).map((row) => row.code)) };
}
const REG = register();
const pending = new Set();
function known(code) {
  if (!REG || !code) return;
  if (REG.retired.has(code)) check(false, code + ' is retired in the register');
  else if (!REG.live.has(code)) pending.add(code);
}

/** the opening tag that carries a testid, as text */
function tagOf(text, id) {
  const at = text.indexOf('data-testid="' + id);
  if (at < 0) return null;
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>', at));
}
function sourceCarriesCodes(file) {
  const text = read(file);
  Object.keys(WANT[file]).forEach((id) => {
    const tag = tagOf(text, id);
    const code = tag && (tag.match(CODE_ATTR) || [])[1];
    check(code === WANT[file][id], file + ' ' + id + ' wears ' + code + ' (want ' + WANT[file][id] + ')');
    check(!tag || tag.indexOf('data-cbname') < 0, file + ' ' + id + ' has no data-cbname (it is ui.action only: it lifts the control to 44 px)');
    known(code);
  });
}

console.log('the avatar menu, drawn for real');
const box = () => ({ style: {}, setAttribute() {}, getAttribute() { return null; }, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
const sandbox = { console, window: {}, setTimeout, clearTimeout, esc: (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])) };
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
sandbox.addEventListener = () => {};
sandbox.matchMedia = () => ({ matches: false, addEventListener() {} });
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
sandbox.document = Object.assign(box(), { documentElement: box(), head: box(), body: box(), createElement: box, getElementById: () => null, cookie: '' });
sandbox.CBScreenId = { mountAttr: (component) => ' data-cbmount="ACC001-U1' + String(component).slice(-2) + '"' };
vm.createContext(sandbox);
vm.runInContext(read('avatar.js'), sandbox, { filename: 'avatar.js' });
const draw = (extra) => sandbox.CBAvatar.menuHtml(Object.assign({ person: { name: 'A', owner: true }, items: ['profile', 'settings', 'support', 'signout'], supportHref: '/support', languages: { list: { en: 'English', ta: 'Tamil' }, current: 'en' } }, extra));
[draw({}), draw({ onProfile() {}, onSettings() {}, onSupport() {}, items: ['profile', 'settings', 'support'] })].forEach((html, index) => {
  const tags = html.match(/<(button|a)\b[^>]*>/g) || [];
  const wrong = tags.filter((tag) => {
    const id = (tag.match(/data-testid="([^"]+)"/) || [])[1] || '';
    const want = MENU_WANT.filter((pair) => pair[0].test(id))[0];
    return !want || (tag.match(CODE_ATTR) || [])[1] !== want[1] || tag.indexOf('data-cbname') >= 0 || !/data-cbmount="ACC001-U1(33|25)"/.test(tag);
  });
  check(tags.length > 20, 'menu ' + (index + 1) + ' draws its ' + tags.length + ' controls');
  check(wrong.length === 0, 'menu ' + (index + 1) + ': each wears its own code, its mount, and no data-cbname' + (wrong.length ? ' (' + wrong[0] + ')' : ''));
  tags.forEach((tag) => known((tag.match(CODE_ATTR) || [])[1]));
});

console.log('the avatar button and the Sign in door');
const avatarSource = read('avatar.js');
check(/class="cbav-btn" data-cbsid="CMP048-B01"/.test(avatarSource), 'avatar.js the avatar button wears CMP048-B01');
known('CMP048-B01');
const doors = avatarSource.split('data-testid="signin-door"').length - 1;
const coded = avatarSource.split('data-cbsid="CMP052-B01"').length - 1;
check(doors === 2 && coded === 2, 'avatar.js both Sign in doors wear CMP052-B01 (' + coded + ' of ' + doors + ')');
known('CMP052-B01');

console.log('the four popovers each name themselves with their literal POP code (the app.html popup-code chip)');
const POPUPS = [['rail-bell-html.js', "bellChip('POP113'", 'POP113 bell panel'], ['avatar.js', "avatarChip('POP114'", 'POP114 avatar menu'], ['shell.js', "shellChip('POP115'", 'POP115 shop sheet'], ['shell.js', "shellChip('POP116'", 'POP116 area menu']];
POPUPS.forEach((row) => {
  const text = read(row[0]);
  check(text.indexOf(row[1]) > 0, row[0] + ' stamps the ' + row[2] + ' (' + row[1] + ')');
  known(row[1].match(/POP[0-9]+/)[0]);
});
check(read('shell.js').split("shellChip('POP115'").length - 1 === 3, 'the shop sheet wears its chip in all three states (loading, empty, full)');
const chipSandbox = Object.assign({}, sandbox, { CBScreenId: undefined });
vm.createContext(chipSandbox);
chipSandbox.window = chipSandbox;
vm.runInContext(read('screen-id.js'), chipSandbox, { filename: 'screen-id.js' });
const chip = chipSandbox.CBScreenId.popupChip('POP114');
check(chip.indexOf("data-testid=\"popup-code\"") > 0 && chip.indexOf(">POP114</span>") > 0, "the chip is the popup-code element and reads its literal code");
sandbox.CBScreenId = chipSandbox.CBScreenId;
check(sandbox.CBAvatar.menuHtml({ person: { name: 'A' }, items: ['signout'] }).indexOf('>POP114</span>') > 0, 'the avatar menu, drawn, shows POP114');
console.log('the bell and its panel');
sourceCarriesCodes('rail-bell-html.js');
console.log('the bar, the area menu, the chips and the sheet');
sourceCarriesCodes('shell.js');
const shellText = read('shell.js');
check(/root\.ui\.action\('home'/.test(shellText), 'Home is the standard component CMP023');
check(/\.cbsh-rn\{[^}]*height:32px/.test(shellText) && /\.cbsh-btn\{[^}]*height:32px/.test(shellText), 'Renew and Finish are 32 px on a desktop');
check(shellText.indexOf('.cbsh-rn{height:44px;padding:0 12px}.cbsh-btn{height:44px}') > 0, 'Renew and Finish are 44 px on a phone');
console.log('the side frame and Home draw their own controls with their own codes (OWN005, HOM001)');
const FRAME_WANT = [
  ["page-frame.js", "data-cbsid=\"CMP054-B01\"' + frameMount() + ' data-sec=", "a side-menu entry wears CMP054-B01 and its mount"],
  ["page-frame.js", "nav-fold label\" data-cbsid=\"CMP054-B02\"' + frameMount() + ' data-testid", "a folding group head wears CMP054-B02 and its mount"],
  ["page-frame.js", "id=\"toggleNav\" data-cbsid=\"CMP054-B03\"' + frameMount() + ' aria-label", "the Collapse button wears CMP054-B03 and its mount"],
  ["page-frame.js", "lab-switch-btn\" data-cbsid=\"CMP054-K01\"' + frameMount() + ' data-tab", "a phone section tab wears CMP054-K01 and its mount"],
  ['shell.js', /class="cbsh-nv" data-cbsid="HOM001-K01" data-go="' \+/, 'an area tab of Home wears HOM001-K01'],
  ['shell.js', /class="cbsh-nv" data-cbsid="HOM001-K01" data-go="more"/, 'the More tab of Home wears HOM001-K01'],
  ['shell.js', /class="cbsh-box" data-cbsid="HOM001-B01" href=/, 'a card of Home wears HOM001-B01'],
  ['shell.js', /class="cbsh-row" data-cbsid="HOM001-B02" data-row=/, 'a More row wears HOM001-B02'],
  ['shell.js', /data-cbsid="HOM001-B03" data-slot="btnL"/, 'the left side opener wears HOM001-B03'],
  ['shell.js', /data-cbsid="HOM001-B04" data-slot="btnR"/, 'the right side opener wears HOM001-B04']
];
FRAME_WANT.forEach((row) => {
  check(typeof row[1] === 'string' ? read(row[0]).indexOf(row[1]) >= 0 : row[1].test(read(row[0])), row[0] + ' ' + row[2]);
  known(((row[2].match(/(CMP054|HOM001)-[A-Z][0-9]{2}/) || [])[0]));
});
check((read('page-frame.js').match(/<button type="button"/g) || []).length === (read('page-frame.js').match(/<button type="button"[^>]*data-cbsid="CMP054/g) || []).length, 'page-frame.js: no button is drawn without a code');
if (pending.size) console.log('  note codes not in the register copy yet (rows pending in docs): ' + [...pending].sort().join(' '));
if (!REG) console.log('  note no register copy on this machine: codes were not checked for being live');

console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
