/**
 * e2e/ux-65-66-attach-call-sites.test.cjs — UX-65 · UX-66 (proof 2026-11-14): the attach sweep — ONE type mapping, ONE accept gate, used at every call site.
 * @type regression
 * OWNS      the proof that (UX-66) app.html no longer defines or calls attType (it is only named in a comment), cbAttachType is the mapping at all 4 call sites
 *           (app.html x3: the two chip renders and mapAtt, and attach-ui.js cbAttachNorm), and the real cbAttachType lower-cases the MIME: 'IMAGE/PNG' is an 'image'
 *           (before the sweep it fell through to 'doc' and offered a download); and (UX-65) cbAttachAccept is the one gate at the app.html pick (ccAddFiles), cbAttachList
 *           and cbAttachButton are what rail-thread draws with, and each is DEFINED once, in attach-ui.js. tests/attach-mount.test.cjs drives CBAttach.mount only.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      public/app.html + public/app/*.js text → comment-stripped code lines → call-site counts; real functions lifted into a vm sandbox → behaviour
 *   node e2e/ux-65-66-attach-call-sites.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
const root = path.join(__dirname, '..', 'public');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 300) : '')); } };
/** the code lines of a file: everything outside /* *-/ blocks, // lines and <!-- --> blocks (a name in a comment is not a call site) */
function codeLines(file) {
  const out = []; let inBlock = false, inHtml = false;
  fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
    if (inHtml) { if (t.includes('-->')) inHtml = false; return; }
    if (t.startsWith('/*') && !t.includes('*/')) { inBlock = true; return; }
    if (t.startsWith('/*') || t.startsWith('//') || t.startsWith('*')) return;
    if (t.startsWith('<!--') && !t.includes('-->')) { inHtml = true; return; }
    if (t.startsWith('<!--')) return;
    out.push({ n: i + 1, t });
  });
  return out;
}
const app = codeLines('app.html'), att = codeLines('app/attach-ui.js'), rail = codeLines('app/rail-thread.js');
const count = (lines, re) => lines.filter((l) => re.test(l.t));

/* UX-66 */
ok('attType is gone from app.html: no definition and no call outside a comment', count(app, /\battType\b/).length === 0, JSON.stringify(count(app, /\battType\b/)));
const sitesApp = count(app, /\bcbAttachType\(/), sitesAtt = count(att, /\bcbAttachType\(/).filter((l) => !/^function cbAttachType/.test(l.t));
ok('cbAttachType is called at 3 places in app.html (the two chip renders and mapAtt)', sitesApp.length === 3, JSON.stringify(sitesApp.map((l) => l.n)));
ok('…and once inside attach-ui.js (cbAttachNorm): 4 call sites in all', sitesAtt.length === 1 && sitesApp.length + sitesAtt.length === 4, JSON.stringify(sitesAtt.map((l) => l.n)));
ok('cbAttachType is defined once, in attach-ui.js, and nowhere else in public/', (() => {
  const hits = []; (function walk(d) { fs.readdirSync(path.join(root, d), { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|vendor/.test(e.name)) walk(p); } else if (/\.(js|html)$/.test(e.name)) codeLines(p.split(path.sep).join('/')).forEach((l) => { if (/\bfunction cbAttachType\b/.test(l.t)) hits.push(p + ':' + l.n); }); }); })('.');
  return hits.length === 1 && hits[0].split(path.sep).join('/').startsWith('app/attach-ui.js'); })());
/* the real function: hand-computed answers */
const type = vm.runInNewContext(liftFns('public/app/attach-ui.js', ['cbAttachType']) + '; cbAttachType', {});
ok('the MIME is lower-cased: IMAGE/PNG → image (it used to fall through to doc)', type('IMAGE/PNG', 'x') === 'image', type('IMAGE/PNG', 'x'));
ok('the NAME is lower-cased too: REPORT.PDF with no MIME → pdf; SHEET.XLSX on octet-stream → xlsx', type('', 'REPORT.PDF') === 'pdf' && type('application/octet-stream', 'SHEET.XLSX') === 'xlsx');
ok('text is its own readable type (not a download): text/plain → text; NOTES.TXT → text', type('text/plain', 'a') === 'text' && type('', 'NOTES.TXT') === 'text');
ok('anything unknown is doc', type('application/octet-stream', 'blob.bin') === 'doc' && type(null, null) === 'doc');

/* UX-65 */
ok('the app.html pick (ccAddFiles) goes through cbAttachAccept — the one gate', count(app, /if \(!cbAttachAccept\(/).length >= 1, JSON.stringify(count(app, /cbAttachAccept/).map((l) => l.n)));
ok('rail-thread draws attachments with cbAttachList and the pin button with cbAttachButton', count(rail, /\bcbAttachList\(/).length >= 1 && count(rail, /\bcbAttachButton\(/).length >= 1);
const defs = {};
['cbAttachType', 'cbAttachList', 'cbAttachButton', 'cbAttachAccept'].forEach((name) => {
  const defRe = new RegExp('^(async )?function ' + name + '[(]');
  defs[name] = [att, app, rail].reduce((n, lines) => n + count(lines, defRe).length, 0);
});
ok('each of cbAttachType · cbAttachList · cbAttachButton · cbAttachAccept is defined exactly once', Object.values(defs).every((n) => n === 1), JSON.stringify(defs));
/* the real gate: limit 1000 bytes → hand-computed */
const toasts = [];
const gate = vm.runInNewContext(liftFns('public/app/attach-ui.js', ['cbAttachSize', 'cbAttachAccept']) + '; cbAttachAccept', { CBATT: { maxBytes: 1000 }, toast: (m) => toasts.push(m) });
ok('the gate: no file → false; 500 bytes → true', gate(null) === false && gate({ name: 'a', size: 500 }) === true);
ok('the gate: 2000 bytes (limit 1000) → false and says "Send a smaller copy"', gate({ name: 'big.pdf', size: 2000 }) === false && toasts.some((m) => /big\.pdf/.test(m) && /Send a smaller copy/.test(m)), JSON.stringify(toasts));
ok('the gate: an empty file is refused ("is empty")', gate({ name: 'e.txt', size: 0 }) === false && toasts.some((m) => /e\.txt.*is empty/.test(m)), JSON.stringify(toasts));

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
