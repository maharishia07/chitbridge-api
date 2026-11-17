'use strict';
/**
 * e2e/ui-codes-popups-green.test.cjs - POPUPS TO GREEN (15 Nov, lane l15-popups): every popup opener names its own register code.
 * OWNS      (1) the page's modal() hands its own { pop } to modalStamp, and the chip shows exactly that code (no ambiguity dot), else the stack lookup;
 *           (2) each modal() call that names a dialog carries the code the register gave it (the table below), on the very call;
 *           (3) each overlay or native dialog a script draws carries its code on the element (data-pop literal or setAttribute).
 * CALLED BY by hand and ci.yml QA-79: node e2e/ui-codes-popups-green.test.cjs     (UIID_REG names a register to check each code is live, else C:/dev/SCREENS.json when present)
 * FLOW      read source ──▶ cut modalStamp out of app.html and run it on a fake DOM ──▶ assert each call site, each element, and each code in the register
 * CARD      qa/ui-identity
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const NL = String.fromCharCode(10);
let failed = 0;
const ok = (what, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) failed++; };
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').split(String.fromCharCode(13) + NL).join(NL);

/* (1) modalStamp on a fake DOM */
const page = read('app.html');
const from = page.indexOf('function modalStamp(host, popCode)');
ok('modalStamp takes the call\'s pop as its second parameter', from > 0);
ok('modal() passes opt.pop to modalStamp', page.indexOf('modalStamp(node, opt && opt.pop);') > 0);
function chipFor(pop, stackCode) {
  const body = page.slice(from, page.indexOf(NL + '}' + NL, from) + 2);
  let placed = null;
  const el = { setAttribute() {}, style: {}, textContent: '', title: '' };
  const box = { querySelector: () => null };
  const host = { querySelector: () => box };
  const sandbox = {
    document: { createElement: () => el },
    modalCode: () => (stackCode ? { code: stackCode, fn: 'opener', ambiguous: true } : null),
    placeCodeTag: (node, tag) => { placed = tag; },
    screenCasesFollow: () => {},
  };
  vm.runInNewContext(body + NL + 'modalStamp(host, popCode);', Object.assign(sandbox, { host, popCode: pop }));
  return placed && placed.textContent;
}
ok('a call that names its pop shows exactly that code, with no ambiguity dot', chipFor('POP206', 'POP067') === 'POP206');
ok('a call with no pop falls back to the stack lookup (dot kept for an ambiguous opener)', chipFor(undefined, 'POP067') === 'POP067\u00b7');
ok('no pop and no stack answer shows nothing', chipFor(undefined, null) === null);

/* (2) the modal() call sites: file -> [code, how many calls carry it] */
const CALLS = {
  'app.html': { POP200: 1, POP031: 1, POP201: 2, POP202: 1, POP203: 1, POP204: 1, POP205: 1, POP062: 1, POP017: 2, POP072: 2, POP015: 2 },
  'app/cap-adopt.js': { POP012: 2 },
  'app/cap-catalogue.js': { POP126: 1 },
  'app/cap-chit2.js': { POP020: 4, POP019: 2 },
  'app/cap-register.js': { POP067: 4, POP068: 2 },
  'app/cap-service.js': { POP079: 3, POP207: 1 },
  'app/cap-worklist.js': { POP084: 1 },
  'app/pick.js': { POP210: 3 },
};
const used = new Set();
Object.keys(CALLS).forEach((file) => {
  const src = read(file);
  Object.keys(CALLS[file]).forEach((code) => {
    used.add(code);
    const m = src.split("pop: '" + code + "'").length - 1;
    ok(file + ': ' + m + ' modal() call(s) name ' + code + ', expected ' + CALLS[file][code], m === CALLS[file][code]);
  });
});

/* (3) elements that carry their own code */
const ELEMENTS = [
  ['app/cap-cmdb.js', 'role="dialog" data-pop="POP206"'],
  ['app/cap-testing.js', 'id="cbtestpanel" role="dialog" data-pop="POP208"'],
  ['app/cap-testing.js', 'id="cbcasespanel" role="dialog" data-pop="POP209"'],
  ['app/chit-price-moved.js', "node.setAttribute('data-pop', 'POP211');"],
  ['app/shortcuts.js', "sheetNode.setAttribute('data-pop', 'POP144');"],
  ['app/cap-workforce.js', "node.setAttribute('data-pop', 'POP018');"],
  ['app/shell.js', 'data-testid="shell-sheet" data-pop="POP115"'],
  ['app/shell.js', 'data-testid="shell-switcher-menu" data-pop="POP116"'],
];
ELEMENTS.forEach(([file, text]) => { ok(file + ' writes ' + text.slice(-24), read(file).indexOf(text) > 0); used.add(text.match(/POP\d{3}/)[0]); });

/* every code used is a live Popup row in the register, when one is at hand */
const regPath = [process.env.UIID_REG, 'C:/dev/SCREENS.json'].find((p) => p && fs.existsSync(p));
if (regPath) {
  const rows = Object.entries(JSON.parse(fs.readFileSync(regPath, 'utf8')).screens).filter(([k, v]) => k.startsWith('Popup') && !v.retired).map(([, v]) => v.code);
  const missing = [...used].filter((c) => rows.indexOf(c) < 0);
  if (process.env.UIID_REG) ok('every code used is a live Popup row in ' + path.basename(regPath) + (missing.length ? ' (missing ' + missing.join(' ') + ')' : ''), missing.length === 0);
  else console.log('  note register at ' + regPath + (missing.length ? ' lacks ' + missing.join(' ') + ' until the docs PR lands' : ': every code is live'));
}
if (failed) { console.error(failed + ' FAILED'); process.exit(1); }
console.log('ALL PASS');
