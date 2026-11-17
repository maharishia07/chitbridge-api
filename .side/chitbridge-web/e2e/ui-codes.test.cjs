/* ui-codes.test.cjs - THE CODES A SCREEN STAMPS ARE THE RIGHT ONES (UX-137 wave 2). Presence is not enough: a control stamped with the code of another control
 * passes a census and is wrong. For list-ctl.js (the list control) and cap-books.js (the Books screens) every data-cbsid literal must
 *   1. be in the closed set of ui.js ACTION_SET (component code, and element code: a component's `elements`, else its one `element`), and
 *   2. be the code of ITS control: a table of markers (a data attribute or a testid in the same tag) -> the one code that tag must carry.
 * Self-test (swap and unregistered mutations): a copy of the source with CMP035-S01 changed to CMP041-S01 must FAIL (check 2), a copy with CMP045-I01 changed to
 * CMP045-I09 must FAIL (check 1); the same two for cap-books.js when it is stamped. A guard that cannot go red guards nothing.
 * Run: node e2e/ui-codes.test.cjs                                                                                                                       */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const readOne = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\r\n').join('\n');
/* the Books screens are cap-books.js and the part files split out of it (tree · cheques · waiting · party): their stamps are one census */
const BOOKS_PARTS = ['cap-books-tree', 'cap-books-cheques', 'cap-books-waiting-cells', 'cap-books-waiting-view', 'cap-books-party'];
const read = (rel) => (rel === 'public/app/cap-books.js' ? [rel].concat(BOOKS_PARTS.map((part) => 'public/app/' + part + '.js')).map(readOne).join('\n') : readOne(rel));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

/** the closed set from ui.js: every component code and element code */
function closedSet() {
  const sandbox = { window: {}, document: undefined };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/app/ui.js'), sandbox);
  const set = new Set();
  Object.values(sandbox.window.ui.components).forEach((c) => { set.add(c.code); (c.elements || [c.element.slice(7)]).forEach((e) => set.add(c.code + '-' + e)); });
  return set;
}

/* marker (text in the same tag) -> the code the tag carries */
const LIST_TABLE = [
  ['data-cbl-q', 'CMP045-I01'], ['data-cbl-from', 'CMP045-I02'], ['data-cbl-to', 'CMP045-I02'], ['data-selrow', 'CMP045-I03'], ['data-col="', 'CMP045-I03'],
  ['data-cbl-pop="period"', 'CMP033-B01'], ['data-cbl-pop="notes"', 'CMP033-B01'], ['data-cbl-pop="filt"', 'CMP033-B01'], ['data-cbl-pop="cols"', 'CMP033-B01'], ['data-cbl-pop="view"', 'CMP033-B01'],
  ['data-notice', 'CMP033-B01'], ['class="cbl-hf', 'CMP033-B01'], ['role="menuitemradio"', 'CMP033-M01'],
  ['data-period', 'CMP034-B01'], ['data-group', 'CMP034-B01'], ['data-view="', 'CMP034-B01'], ['data-cbl-exp', 'CMP034-B01'], ['data-cbl-selmode', 'CMP034-B01'], ['data-caret', 'CMP034-B01'],
  ['data-gsel', 'CMP035-S01'], ['data-filt=', 'CMP035-S01'], ['data-cbl-sort', 'CMP035-S01'], ['data-view-tab', 'CMP036-K01'],
  ['data-cbl-csv', 'CMP037-B01'], ['data-cbl-resetcols', 'CMP037-B02'], ['data-cbl-selall', 'CMP037-B03'], ['data-bulk', 'CMP037-B04'], ['data-cbl-more', 'CMP037-B05'],
  ['data-act="', 'CMP038-B01'], ['class="sort"', 'CMP039-B01'], ['data-rz', 'CMP039-B02'], ['class="cbl-mv"', 'CMP039-B03'],
  ['data-cbl-retry', 'CMP009-B01'], ['data-cbl-clear', 'CMP014-B01'], ['data-cbl-clearf', 'CMP014-B01'], ['data-unfilt', 'CMP014-B01']
];
const BOOKS_TABLE = [
  ['data-testid="party-edit"', 'CMP012-B01'], ['data-testid="party-pay"', 'CMP042-B01'], ['data-testid="pe_taxadd"', 'CMP007-B01'],
  ['data-testid="pe_save"', 'CMP001-B01'], ['data-testid="pay_record"', 'CMP042-B02'], ['data-testid="pay_remind"', 'CMP042-B03'], ['data-testid="pay_disc_record"', 'CMP042-B24'],
  ['data-testid="pay_ack"', 'CMP042-B25'], ['data-testid="pay_done"', 'CMP004-B01'], ['data-testid="pay_band_cancel"', 'CMP003-B01'], ['data-testid="bk-back"', 'CMP006-B01'],
  ['data-testid="db-add"', 'CMP007-B01'], ['data-testid="lt-clear"', 'CMP014-B01'], ['data-testid="lt-back"', 'CMP006-B01'], ['data-testid="lt-unfold"', 'CMP042-B06'],
  ['data-testid="lg-statement"', 'CMP042-B05'], ['data-testid="lg-pay"', 'CMP042-B01'], ['data-testid="lt-find"', 'CMP040-I01'], ['data-testid="lt-fold"', 'CMP042-B06'],
  ['id="lt_rz"', 'CMP042-B23'], ['id="pay_mode"', 'CMP041-S01'], ['data-testid="pay_adv"', 'CMP040-I03'], ['data-testid="pk_p"', 'CMP041-S01'], ['data-testid="pk_build"', 'CMP042-B12'],
  ['data-testid="wait-retry"', 'CMP009-B01'], ['data-testid="ac_add"', 'CMP007-B01'],
  ['data-testid="ac_name"', 'CMP040-I01'], ['data-testid="ac_parent"', 'CMP041-S01'], ['data-testid="lk_why"', 'CMP040-I01'], ['data-testid="pay_ref"', 'CMP040-I01']
];

/** every failure of one source against the closed set and its table, as sentences */
function failuresOf(source, known, table) {
  const out = [];
  const tags = [];
  const re = /<(\w+)\b([^>]*?)data-cbsid="([A-Z0-9-]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(source))) tags.push({ code: m[3], text: m[2] + m[4] });
  tags.forEach((t) => { if (!known.has(t.code)) out.push(t.code + ' is not in the ACTION_SET closed set'); });
  table.forEach(([marker, code]) => {
    const hits = tags.filter((t) => t.text.indexOf(marker) >= 0);
    if (!hits.length) out.push('no stamped tag carries ' + marker);
    hits.forEach((t) => { if (t.code !== code) out.push(marker + ' carries ' + t.code + ', expected ' + code); });
  });
  return out;
}
const mutate = (source, from, to) => { const at = source.indexOf('data-cbsid="' + from + '"'); return at < 0 ? null : source.slice(0, at) + 'data-cbsid="' + to + '"' + source.slice(at + ('data-cbsid="' + from + '"').length); };

const known = closedSet();
const FILES = [['public/app/list-ctl.js', LIST_TABLE, [['CMP035-S01', 'CMP041-S01'], ['CMP045-I01', 'CMP045-I09']]]];
if (read('public/app/cap-books.js').indexOf('data-cbsid=') >= 0) FILES.push(['public/app/cap-books.js', BOOKS_TABLE, [['CMP042-B02', 'CMP042-B05'], ['CMP040-I01', 'CMP040-I09']]]);
FILES.forEach(([file, table, swaps]) => {
  const source = read(file);
  const failures = failuresOf(source, known, table);
  ok(failures.length === 0, file + ': every stamp is in the closed set and is its control\'s code' + (failures.length ? ' (' + failures.slice(0, 4).join('; ') + ')' : ' (' + table.length + ' markers)'));
  swaps.forEach(([from, to]) => {
    const bad = mutate(source, from, to);
    ok(bad !== null && failuresOf(bad, known, table).length > 0, 'self-test: ' + file + ' with ' + from + ' changed to ' + to + ' FAILS the guard');
  });
});
/* W2 closing: the tap rule for a control a screen draws itself (ui.tap) and the shared pager pair (CBList.pager, CMP037 B06 and B07) */
{
  const sandbox = { window: {}, document: undefined };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/app/ui.js'), sandbox);
  const tapped = sandbox.window.ui.tap('bookaction');
  ok(/data-cbname="bookaction"/.test(tapped) && /data-size="compact"/.test(tapped), 'ui.tap(bookaction) puts a drawn-by-hand control under the compact tap rule (32 px, 44 on a phone)');
  let refused = false;
  try { sandbox.window.ui.tap('save'); } catch (e) { refused = true; }
  ok(refused, 'ui.tap refuses a component ui.action draws itself');
  ok(known.has('CMP037-B06') && known.has('CMP037-B07'), 'the pager codes CMP037-B06 and B07 are in the closed set');
  const listSource = read('public/app/list-ctl.js');
  ok(listSource.indexOf("pagerButton('prev', 'B06'") >= 0 && listSource.indexOf("pagerButton('next', 'B07'") >= 0, 'CBList.pager stamps Previous B06 and Next B07');
  const catalogue = read('public/app/cap-catalogue.js');
  ok(catalogue.indexOf('CBList.pager(') >= 0 && catalogue.indexOf('data-testid="cat-prev"') < 0, 'the catalogue pager is drawn by CBList.pager, not by hand');
}
/* critic fixes on #647: the books popups mount on the host screen's own code, and ui.dialog's sub line stays byte-identical unless a page names its own class */
{
  const books = read('public/app/cap-books.js');
  const fn = books.slice(books.indexOf('function bkDialogMount'), books.indexOf('/* ⭐ M64: WIDENED into CBAction'));
  const mountOn = (source, screen) => new Function('document', source + '; return bkDialogMount(2);')({ querySelector: () => ({ getAttribute: () => screen }) });
  ok(mountOn(fn, 'CRM001') === 'CRM001-U22', 'bkDialogMount: a popup opened on CRM001 mounts as CRM001-U22, not BKS001');
  ok(mountOn(fn.split('\\d{3}').join('d{3}'), 'CRM001') !== 'CRM001-U22', 'self-test: the old d{3} regex FAILS that check');
  const html = [];
  const box = { window: {}, document: undefined, modal: (h) => html.push(h) };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('public/app/ui.js'), box);
  box.window.ui.dialog({ mount: 'ACC002-U01', titleText: 'T', subText: 'S', body: '' });
  box.window.ui.dialog({ mount: 'ACC002-U01', titleText: 'T', subText: 'S', subClass: 's', body: '' });
  ok(html[0].indexOf('<span class="sub">S</span>') > 0, 'ui.dialog without subClass draws the sub line as before (span.sub)');
  ok(html[1].indexOf('<div class="s">S</div>') > 0, 'ui.dialog with subClass s draws the sub line as div.s (app.html styles .modal .mhd .s)');
}
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
