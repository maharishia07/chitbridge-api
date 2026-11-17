/* bills-folder-breaks.cjs — break each web guard of the folder list once, run e2e/bills-folder.cjs, restore FROM A COPY
   (never git checkout). Run: node e2e/bills-folder-breaks.cjs */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const CAP = 'public/app/cap-folders.js';
const BREAKS = [
  /* anchors follow the prettier-formatted _foldersFrom in cap-folders.js (2026-11-13); multi-line on purpose */
  ['system folders fall under Task again', CAP, `  return all.filter(function (item) {
    return !view(item);
  });`, `  return all;`],
  ['a view folder (kind view, not system) falls under Task', CAP, `return !!(f.system || f.kind === 'view');`, `return !!f.system;`],
  ['the system folders are thrown away, not kept for the Bills screen', CAP, `  UI.sysFolders = all.filter(view);`, `  UI.sysFolders = [];`],
  ['Move reads the raw list', CAP, `      UI.folders = _foldersFrom(reply);
    } catch (e) {`, `      UI.folders = (reply && reply.folders) || [];
    } catch (e) {`],
];
let good = 0, ran = 0;
for (const [name, rel, a, b] of BREAKS) {
  ran++;
  const f = path.join(SITE.dir, rel);
  const s = fs.readFileSync(f, 'utf8'); const n = s.split(a).length - 1;
  if (n !== 1) { console.log('  ??  ' + name + ': anchor x' + n); continue; }
  try {
    fs.writeFileSync(f, s.split(a).join(b));
    const r = cp.spawnSync(process.execPath, ['e2e/bills-folder.cjs'], { cwd: SITE.dir, encoding: 'utf8', timeout: 300000 });
    const xx = (r.stdout || '').split('\n').filter((l) => /^\s+XX/.test(l));
    const caught = r.status !== 0 && xx.length > 0;
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught: ' + xx[0].trim() : 'NOT caught (exit ' + r.status + ')'));
  } finally { fs.writeFileSync(f, s); }   /* back to the original inside the copy for the next break */
}
console.log('\n  ' + good + '/' + ran + ' breaks caught');
process.exitCode = good === ran ? 0 : 1;
