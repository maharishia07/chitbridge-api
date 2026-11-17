'use strict';
// @type: unit
/**
 * ui-codes-listctl-dispute.test.cjs - every control drawn by list-ctl.js and cap-dispute.js wears a data-cbsid code (UX-137, queue 359).
 *
 * OWNS      the proof that no button, input, select, textarea or role=button/tab/menuitem tag in public/app/list-ctl.js or public/app/cap-dispute.js
 *           is written without a data-cbsid (a literal code, or the held name `sid` of the pager pair), and that CBList.pager draws the same
 *           markup as before: Previous CMP037-B06, Next CMP037-B07. It also pins one pair of codes per file to its OWN tag (read from the tag's '<'
 *           to the code and forward, a marker only that tag carries), so a code moved onto a neighbour fails.
 *           LCD_MUTATE=remove strips codes from BOTH files; LCD_MUTATE=swap exchanges two codes inside each file.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-listctl-dispute.test.cjs   (LCD_MUTATE=remove or =swap must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/list-control
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILES = ['list-ctl.js', 'cap-dispute.js'];
const mutate = process.env.LCD_MUTATE || '';
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8').split('\r\n').join('\n');
const TAG = /<(button|input|select|textarea|[a-z]+)\b([^>]*)>/g;

function untagged(src) {
  const lines = src.split('\n').map((L) => { const t = L.trim(); return t.slice(0, 2) === '//' || t.slice(0, 2) === '/*' || t.charAt(0) === '*' ? '' : L; });
  const text = lines.join('\n'), out = [];
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(text))) {
    const tag = m[1], a = m[2] || '';
    const control = tag === 'button' || tag === 'select' || tag === 'textarea' || (tag === 'input' && !/type=["']hidden["']/.test(a)) || /role=["'](button|tab|menuitem|menuitemradio|switch|option)["']/.test(a);
    if (control && !/data-cbsid=/.test(a)) out.push(text.slice(0, m.index).split('\n').length);
  }
  return out;
}

/* one pair per file: [code, marker only that tag carries]; a swap of the two codes moves each marker off its own tag */
const PINS = {
  'list-ctl.js': [['CMP033-B01', 'class="cbl-chip period"'], ['CMP034-B01', 'data-period=']],
  'cap-dispute.js': [['TSK006-B01', 'data-testid="dispute-resolve-open"'], ['TSK006-B03', 'class="advbtn']]
};
const WINDOW = 400;
/** the tag that wears the code: from the '<' before it, forward to the next code or WINDOW characters */
function tagAfter(src, code) {
  const at = src.indexOf('data-cbsid="' + code + '"');
  if (at < 0) return null;
  const open = src.lastIndexOf('<', at), rest = src.slice(at + 12), next = rest.search(/data-cbsid=/);
  return (open >= 0 && at - open <= WINDOW ? src.slice(open, at) : '') + rest.slice(0, next >= 0 ? Math.min(next, WINDOW) : WINDOW);
}
/** LCD_MUTATE: remove strips the pinned codes (and, in list-ctl.js, the pager's held name); swap exchanges the pair's first occurrences */
function mutated(f, src) {
  const [one, two] = PINS[f].map((p) => 'data-cbsid="' + p[0] + '"');
  if (mutate === 'remove') {
    src = src.split(one).join('').split(two).join('');
    return f === 'list-ctl.js' ? src.split("data-cbsid=\"' + sid + '\"").join('') : src;
  }
  if (mutate === 'swap') return src.replace(one, '@@A@@').replace(two, one).replace('@@A@@', two);
  return src;
}

FILES.forEach((f) => {
  const src = mutated(f, read(f));
  const bad = untagged(src);
  check(bad.length === 0, f + ': 0 controls without data-cbsid' + (bad.length ? ' (lines ' + bad.join(',') + ')' : ''));
  PINS[f].forEach(([code, marker]) => {
    const tag = tagAfter(src, code);
    check(tag !== null && tag.indexOf(marker) >= 0, f + ': ' + code + ' sits on the tag with ' + marker);
  });
});

/* the pager pair draws the same markup as before the code moved into a name */
const win = { document: undefined };
const listContext = vm.createContext({ window: win, self: win, globalThis: win, console });
['list-ctl-css.js', 'list-ctl-click.js', 'list-ctl-wire.js'].forEach((part) => vm.runInContext(read(part), listContext, { filename: part })); /* the unit's parts load before it */
vm.runInContext(mutated('list-ctl.js', read('list-ctl.js')), listContext, { filename: 'list-ctl.js' });
const L = win.CBList;
check(!!(L && L.pager), 'CBList.pager is exported');
if (L && L.pager) {
  const h = L.pager({ prev: { label: 'Previous', tid: 'pg-prev', act: 'go(-1)', off: true }, next: { label: 'Next', tid: 'pg-next', act: 'go(1)', off: false } });
  check(h.indexOf('data-cbsid="CMP037-B06"') >= 0 && h.indexOf('data-testid="pg-prev"') > h.indexOf('CMP037-B06'), 'Previous wears CMP037-B06');
  check(h.indexOf('data-cbsid="CMP037-B07"') >= 0 && h.indexOf('data-testid="pg-next"') > h.indexOf('CMP037-B07'), 'Next wears CMP037-B07');
  check(h.indexOf('disabled') < h.indexOf('CMP037-B07') && h.split('disabled').length === 2, 'only Previous is disabled');
}
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
