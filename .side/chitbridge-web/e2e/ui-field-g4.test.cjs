'use strict';
// @type: unit
/**
 * ui-field-g4.test.cjs - UX-137 R2, group G4: the Verify-ID and Gather-clearance sheets draw their four inputs with ui.field, and the readers still find them.
 *
 * OWNS      the proof that app/cap-readiness.js verifyReadiness() / gatherReadiness() hand the sheet a field for vf_id, gd_file, gd_ref and gd_valid (the ids
 *           submitVerify / submitGather read by getElementById), each a CMP055 element with its SCR033 mount, that the date keeps its default value, the file is a
 *           file input and the label is a real label[for]; and that the sheet's own inline input styles are gone (one field look, no second one).
 * CALLED BY ci.yml (QA gate, beside ui-field); by hand: node e2e/ui-field-g4.test.cjs
 * FLOW      load ui.js + ui-field.js + cap-readiness.js in one vm, call the two openers with a stub modal(), read the HTML it was given
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (ok, message) => { console.log((ok ? '  ok ' : '  FAIL ') + message); if (!ok) failures++; };

let sheet = '';
const sandbox = {
  console,
  tx: (text) => text,
  esc: (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])),
  CBAction: { run: () => Promise.resolve() },
  UI: {},
  modal: (html) => { sheet = html; },
  window: {},
  document: { addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
  setTimeout, clearTimeout
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(read('app/ui.js'), sandbox);
vm.runInContext(read('app/ui-field.js'), sandbox);
vm.runInContext(read('app/cap-readiness.js'), sandbox);

const inputOf = (id) => (sheet.match(new RegExp('<(?:input|textarea)[^>]* id="' + id + '"[^>]*>')) || [''])[0];

console.log('Verify registry ID');
sandbox.verifyReadiness('gst', 'registration', 'gstin');
let node = inputOf('vf_id');
check(/data-cbsid="CMP055-I01"/.test(node) && /data-cbmount="SCR033-U01"/.test(node) && /data-cbkind="text"/.test(node), 'vf_id is a CMP055 text field at SCR033-U01');
check(/<label class="cbf-l" for="vf_id">GSTIN number<\/label>/.test(sheet), 'its label names the id type and points at the input');
check(/placeholder="GSTIN number"/.test(node), 'the placeholder is kept');
check(!/style="width:100%;padding:9px 11px/.test(sheet), 'the sheet\'s own input style is gone');
sandbox.verifyReadiness('iec', 'import-export', 'iec');
check(/placeholder="e\.g\. AAACR1234B"/.test(inputOf('vf_id')), 'the IEC example placeholder is kept');

console.log('Gather clearance');
sandbox.UI.readiness = { clearances: [{ standard: 'gst', doc: 'registration', title: 'GST' }] };
sandbox.gatherReadiness('gst', 'registration');
node = inputOf('gd_file');
check(/data-cbsid="CMP055-I04"/.test(node) && /data-cbmount="SCR033-U02"/.test(node) && /type="file"/.test(node), 'gd_file is a CMP055 file field at SCR033-U02');
node = inputOf('gd_ref');
check(/data-cbsid="CMP055-I01"/.test(node) && /data-cbmount="SCR033-U03"/.test(node) && /placeholder="e\.g\. certificate no\."/.test(node), 'gd_ref is a CMP055 text field at SCR033-U03, placeholder kept');
node = inputOf('gd_valid');
const asked = (node.match(/value="(\d{4}-\d\d-\d\d)"/) || [])[1];
const wantDays = Math.round((Date.parse(asked + 'T00:00:00Z') - Date.now()) / 86400000);
check(/data-cbsid="CMP055-I02"/.test(node) && /data-cbmount="SCR033-U04"/.test(node) && /type="date"/.test(node), 'gd_valid is a CMP055 date field at SCR033-U04');
check(wantDays >= 363 && wantDays <= 366, 'the date still defaults to a year from today (' + asked + ')');
check(['Document (PDF/image · ≤ 6 MB)', 'Reference / number (optional)', 'Valid until'].every((text) => sheet.indexOf('>' + text + '</') > 0), 'the three labels read as before');
check(/id="gd_btn"/.test(sheet) && /id="gd_err"/.test(sheet) && /onclick="submitGather\(\)"/.test(sheet), 'the button and the error line the reader uses are untouched');

console.log('a page that could not load ui-field.js');
const bare = Object.assign({}, sandbox, { ui: Object.assign({}, sandbox.ui, { field: undefined }) });
vm.createContext(bare);
bare.window = bare;
vm.runInContext(read('app/cap-readiness.js'), bare);
let spoken = '';
try { bare.verifyReadiness('gst', 'registration', 'gstin'); } catch (error) { spoken = String(error.message); }
check(/field/.test(spoken), 'the sheet fails loud (it could not draw), never opens half-blank: ' + spoken.slice(0, 50) + ' (ui-script-loaded.cjs stops a page that lacks the script)');

console.log('The offer, pricing and tax Note field (cap-definitions.js cbDefNoteFieldHTML)');
const defSource = read('app/cap-definitions.js');
const noteStart = defSource.indexOf('function cbDefNoteFieldHTML(form) {');
const noteSource = defSource.slice(noteStart, defSource.indexOf('\n}\n', noteStart) + 3);
const listeners = {}, stored = [];
const noteBox = Object.assign({}, sandbox, {
  document: Object.assign({}, sandbox.document, { addEventListener: (name, fn) => { listeners[name] = fn; } }),
  cbDefSetField: (key, value) => stored.push([key, value])
});
vm.createContext(noteBox);
noteBox.window = noteBox;
vm.runInContext(read('app/ui.js'), noteBox);
vm.runInContext(read('app/ui-field.js'), noteBox);
vm.runInContext(noteSource, noteBox);
const typing = { id: 'cbdef-note', value: 'ring me', getAttribute: (name) => ({ 'data-cbname': 'field', 'data-cbkind': 'text' }[name] || null), closest: () => null, parentNode: null };
[['offer', 'On your offers list'], ['pricing', 'On your pricing list'], ['tax', 'On your tax slabs list']].forEach(([kind, hint]) => {
  let html = '', drew = '';
  try { html = noteBox.cbDefNoteFieldHTML({ kind, note: '' }); } catch (error) { drew = String(error.message); }
  check(!drew && html.indexOf(hint) > 0 && /id="cbdef-note"/.test(html), kind + ': the Note field draws with its own hint' + (drew ? ' (threw: ' + drew + ')' : ''));
  stored.length = 0;
  try { listeners.input({ target: typing }); } catch (error) { drew = String(error.message); }
  check(stored.length === 1 && stored[0][0] === 'note' && stored[0][1] === 'ring me', kind + ': typing reaches cbDefSetField(note)' + (drew ? ' (' + drew + ')' : ''));
});

console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
