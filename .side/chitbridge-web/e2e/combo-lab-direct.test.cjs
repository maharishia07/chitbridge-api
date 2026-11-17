/* combo-lab-direct.test.cjs — UX-97 · no page of ours links through the combo-lab.html forwarder.
 * OWNS  the check that Combo Lab is reached at its own address (offer-lab-next.html?mode=combo), not through the old redirect page.
 * CALLED BY ci.yml (QA-79 list) · FLOW static read of public/ · CARD 29-qa-test-tooling-ux-locale-and-design-system/combo-lab
 * public/till.html is the api's vendored master (openComboLab): it is listed, not edited here, and leaves the list when the api twin lands. */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const VENDORED = ['till.html'];
const SKIP = ['combo-lab.html', 'app/screen-id.js'];   /* screen-id.js names the old address on purpose (the register row that says it forwards) */
const LINK = /(href=["']|window\.open\(["']|location\.href\s*=\s*["']|["'])\/?combo-lab\.html/;
let bad = 0;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|js)$/.test(e.name)) files.push(p);
  }
})(PUB);
for (const f of files) {
  const rel = path.relative(PUB, f).split(path.sep).join('/');
  if (VENDORED.includes(rel) || SKIP.includes(rel)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    if (LINK.test(line) && !/<!--|\/\*/.test(line.split(/combo-lab\.html/)[0].slice(-60))) { bad++; console.log('  XX  ' + rel + ':' + (i + 1) + ' links through combo-lab.html'); }
  });
}
console.log(bad ? 'combo-lab-direct: ' + bad + ' link(s) through the redirect' : 'combo-lab-direct: no page links through the combo-lab.html redirect');
process.exit(bad ? 1 : 0);
