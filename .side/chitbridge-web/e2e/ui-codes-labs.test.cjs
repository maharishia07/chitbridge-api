'use strict';
// @type: unit
/**
 * ui-codes-labs.test.cjs - the Conversion lab, the Country lab and the Product lab wear THEIR identity codes (UX-137 pass-labs, 13 Nov).
 *
 * OWNS      the proof that every control of public/conversion-lab.html (CVL001, 17), public/country-lab.html and the one script only it loads,
 *           public/app/country-profiles.js (CLB001, 29), and public/product-lab.html (PLB001, 16) carries a data-cbsid code of its own screen,
 *           that each code sits on ITS element (a marker only that element carries must follow the code before the next code starts, so a swap
 *           of two codes fails), that no code is written twice, that each file has exactly the expected number of coded elements, and that
 *           the codes are in the register and none is retired. A tag drawn by a row builder or a pill map wears ONE code for all its rows.
 *           It also proves the Network Lab's "Change the details" code (NLB001-C07) sits on the clickable span, not on the box around it.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-labs.test.cjs   (LABS_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.LABS_ID_MUTATE || '';
const BS = String.fromCharCode(92);
const WINDOW = 400; /* how far after a code its own marker may sit when no other code starts first */
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8').split('\r\n').join('\n');

/** screen code -> files, and per code the file and a marker only its element carries */
const SCREENS = {
  CVL001: {
    count: 17,
    WANT: [
      ['CVL001-I01', 'conversion-lab.html', "setMode('value')"], ['CVL001-I02', 'conversion-lab.html', "setMode('convert')"],
      ['CVL001-I03', 'conversion-lab.html', 'id="to"'], ['CVL001-I04', 'conversion-lab.html', 'id="dp"'], ['CVL001-I05', 'conversion-lab.html', 'id="invert"'],
      ['CVL001-B01', 'conversion-lab.html', 'lab-load-catalogue'], ['CVL001-B02', 'conversion-lab.html', 'lab-load-chit'], ['CVL001-B03', 'conversion-lab.html', 'loadSample()'],
      ['CVL001-B04', 'conversion-lab.html', 'addLine()'], ['CVL001-B05', 'conversion-lab.html', 'id="add-price"'], ['CVL001-B06', 'conversion-lab.html', 'addRate()'],
      ['CVL001-S01', 'conversion-lab.html', ' provenance"'], ['CVL001-I06', 'conversion-lab.html', 'esc(v == null'], ['CVL001-I07', 'conversion-lab.html', "(step || 'any')"],
      ['CVL001-B07', 'conversion-lab.html', 'title="remove"'], ['CVL001-I08', 'conversion-lab.html', 'aria-label="prices as of"'], ['CVL001-I09', 'conversion-lab.html', 'aria-label="rates as of"']
    ]
  },
  CLB001: {
    count: 29,
    WANT: [
      ['CLB001-S01', 'country-lab.html', 'id="from"'], ['CLB001-S02', 'country-lab.html', 'id="to"'], ['CLB001-B01', 'country-lab.html', 'cl-swap'],
      ['CLB001-B02', 'country-lab.html', 'cl-add-line'], ['CLB001-S03', 'country-lab.html', 'id="buyer"'], ['CLB001-I01', 'country-lab.html', 'id="incl"'],
      ['CLB001-I02', 'country-lab.html', 'cl-fixed-no'], ['CLB001-I03', 'country-lab.html', 'cl-fixed-yes'], ['CLB001-B03', 'country-lab.html', 'cl-more-'],
      ['CLB001-B04', 'country-lab.html', 'cl-samefold-btn'], ['CLB001-I04', 'country-lab.html', 'placeholder="type a '], ['CLB001-I05', 'country-lab.html', 'aria-label="item"'],
      ['CLB001-I06', 'country-lab.html', 'aria-label="qty"'], ['CLB001-I07', 'country-lab.html', 'aria-label="price"'], ['CLB001-I08', 'country-lab.html', 'aria-label="rate %"'],
      ['CLB001-S04', 'country-lab.html', 'cl-kind-'], ['CLB001-B05', 'country-lab.html', 'delLine('],
      ['CLB001-B06', 'app/country-profiles.js', 'cp-i"'], ['CLB001-B07', 'app/country-profiles.js', 'cp-pick'], ['CLB001-S05', 'app/country-profiles.js', 'data-testid="cp-select"'],
      ['CLB001-I09', 'app/country-profiles.js', 'cp-idbox'], ['CLB001-S06', 'app/country-profiles.js', 'cp-periodpick'], ['CLB001-B08', 'app/country-profiles.js', 'cp-dl-return'],
      ['CLB001-B09', 'app/country-profiles.js', 'cp-dl-statements'], ['CLB001-B10', 'app/country-profiles.js', 'cp-dl-print'], ['CLB001-B11', 'app/country-profiles.js', 'data-open='],
      ['CLB001-B12', 'app/country-profiles.js', 'data-more='], ['CLB001-I10', 'app/country-profiles.js', 'cp-show-box'], ['CLB001-S07', 'app/country-profiles.js', 'cp-all-select']
    ]
  },
  PLB001: {
    count: 14, /* 16 less S01 (the shelf select) and B04 (Tick all shown): both are the library's now, CMP056-S01 and CMP057-B01 (e2e/ui-select-command.test.cjs) */
    WANT: [
      ['PLB001-B01', 'product-lab.html', 'pl-step-'], ['PLB001-B02', 'product-lab.html', 'pickList('], ['PLB001-B03', 'product-lab.html', 'toggleLang('],
      ['PLB001-I01', 'product-lab.html', 'id="q"'], ['PLB001-B05', 'product-lab.html', 'pickAll(false)'], ['PLB001-B06', 'product-lab.html', 'data-own='], ['PLB001-B07', 'product-lab.html', 'pl-unit-'],
      ['PLB001-I02', 'product-lab.html', 'pl-unit-tick'], ['PLB001-B08', 'product-lab.html', 'setShelf('], ['PLB001-I03', 'product-lab.html', 'pl-price-'],
      ['PLB001-B09', 'product-lab.html', 'drop(this.dataset.name'], ['PLB001-B10', 'product-lab.html', 'id="next"'], ['PLB001-B11', 'product-lab.html', 'pl-back'],
      ['PLB001-B12', 'product-lab.html', 'id="adopt"']
    ]
  }
};

const files = {};
for (const s of Object.values(SCREENS)) for (const w of s.WANT) files[w[1]] = files[w[1]] || read(w[1]);
files['network-design.html'] = read('network-design.html');
const literal = (code, escaped) => (escaped ? 'data-cbsid=' + BS + '"' + code + BS + '"' : 'data-cbsid="' + code + '"');
const cut = (name, code) => { files[name] = files[name].split(literal(code, false)).join('').split(literal(code, true)).join(''); };
const swapFirst = (a, b) => Object.keys(files).forEach((n) => { files[n] = files[n].split(a).join('SWAPX').split(b).join(a).split('SWAPX').join(b); });
if (mutate === 'remove') cut('conversion-lab.html', 'CVL001-B01');
if (mutate === 'swap') swapFirst('CVL001-B01', 'CVL001-B02');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** the text from a code up to the next code of the file (at most WINDOW characters): the tag it sits in */
function tagAfter(name, code) {
  const src = files[name], plain = src.indexOf(literal(code, false)), esc = src.indexOf(literal(code, true)), at = plain >= 0 ? plain : esc;
  if (at < 0) return null;
  const rest = src.slice(at + 12), next = rest.search(/data-cbsid=/);
  /* plus the same tag BEFORE the code, from its '<' (review #646: attribute order is free; product-lab's Shelf select carries the code after id + aria-label) */
  const open = src.lastIndexOf('<', at), before = open >= 0 && at - open <= WINDOW ? src.slice(open, at) : '';
  return before + rest.slice(0, next >= 0 ? Math.min(next, WINDOW) : WINDOW);
}

for (const [screen, def] of Object.entries(SCREENS)) {
  for (const [code, name, marker] of def.WANT) {
    const tag = tagAfter(name, code);
    check(tag !== null && tag.indexOf(marker) >= 0, code + ' sits on the element with ' + marker);
  }
  /* every code is written once; the screen has exactly its coded elements */
  const names = [...new Set(def.WANT.map((w) => w[1]))];
  const written = names.flatMap((n) => [...files[n].matchAll(new RegExp('data-cbsid=' + BS + BS + '?"(' + screen + '-[A-Z][0-9]{2})' + BS + BS + '?"', 'g'))].map((m) => m[1]));
  const dup = written.filter((c, i) => written.indexOf(c) !== i);
  check(dup.length === 0, screen + ': no code is written on two elements' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
  check(written.length === def.count && def.WANT.length === def.count, screen + ': ' + def.count + ' coded elements, counted by code: ' + written.length + ' written, ' + def.WANT.length + ' expected');
  names.forEach((n) => check(!new RegExp('data-cbsid=' + BS + BS + '?"(?!' + screen + '-|CMP[0-9]{3})').test(files[n]), n + ' carries no code of another screen (a CMP component code belongs to the library)'));
}

/** the Network Lab's Change the details code sits on the clickable span (it once sat on the box around it) */
const nd = files['network-design.html'], at = nd.indexOf('data-cbsid="NLB001-C07"');
check(at > 0 && /^data-cbsid="NLB001-C07" class="e" role="button"/.test(nd.slice(at, at + 60)), 'NLB001-C07 is on the span role=button, not on the box around it');

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  note: register ' + p + ' did not parse (' + e.message + ')'); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const all = Object.values(SCREENS).flatMap((s) => s.WANT.map((w) => w[0])), missing = all.filter((c) => !rows[c]), retired = all.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (all.length - missing.length) + ' of ' + all.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
