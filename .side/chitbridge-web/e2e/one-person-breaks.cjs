/* one-person-breaks.cjs — */ // break each one-browser-one-shop guard once, run e2e/one-person.cjs, restore FROM A COPY (never git checkout)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const APP = 'public/app.html', OP = 'public/app/one-person.js', IDX = 'index.html';
/* [name, [[file, anchor, replacement], …]] — a guard that is two lines (belt and braces) is broken as one */
const BREAKS = [
  /* app.html — the gate */
  ['route lets an unchecked shop through', [[APP, `&& !gateOpen()) return gateRun();\n`, `&& false) return gateRun();\n`]]],
  ['renderApp paints before the gate', [[APP, `  if(!gateOpen()) return gateRun();\n  /**`, `  /**`]]],
  ['cb_sess written before the gate', [[APP, `if(SESSION.token && gateOpen()) localStorage.setItem('cb_sess'`, `if(SESSION.token) localStorage.setItem('cb_sess'`]]],
  ['gate opens without claiming the work', [[APP, `CBOnePerson.claim(m); sessPersist();`, `sessPersist();`]]],
  ['told to leave, the tab says nothing', [[APP, `LOGIN.gone=why || txf('Signed out — {shop} opened in another tab.', { shop: by || tx('another shop') });`, `LOGIN.gone=why || ' ';`]]],
  ['same shop signs the owner out', [[APP, `  if(next && next.ent===m.ent) return;\n`, ``]]],
  ['a sign-out elsewhere is not followed', [[APP, `try{ window.addEventListener('storage', sessFollow); }catch(_){}`, ``]]],
  ['sign-out leaves the gate open', [[APP, `GATE={ent:null,busy:false,last:null};_mePrefetch=null;_meReq=null;`, ``]]],
  /* one-person.js — the check and the clear-out */
  ['another shop\'s session not seen', [[OP, `if (s && s.ent !== ent) {`, `if (false) {`]]],
  ['another shop\'s tab not seen', [[OP, "        if (item && item.ent && item.ent !== ent) {", "        if (false) {"]]],
  ['unsent drafts not seen', [[OP, `      if (drafts || outbox) {`, `      if (false) {`]]],
  ['counter paired elsewhere not seen', [[OP, "        counter = pair.paired && pair.ent && pair.ent !== ent ? pair : null;", "        counter = null;"]]],
  ['counter read from the marker, not its own copy', [[OP, "      if (reply && reply.entity_id) {", "      if (false) {"]]],
  ['reading the counter creates its database', [[OP, `      if (!names || names.indexOf(name) < 0) return null;\n`, `      if (!names) return null;\n`],
                                                 [OP, `rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (_) {} fin(null); };`, ``]]],
  ['other tabs never told to leave', [[OP, `ask({ t: 'leave', ent: o.ent,`, `ask({ t: 'nope', ent: o.ent,`]]],
  ['drafts left behind', [[OP, "        if (owned && item.indexOf(DRAFT) === 0) return lsDel(item);", ""]]],
  ['saved settings left behind', [[OP, "        for (var index = 0; index < ids.length; index++) if (ids[index] && item.slice(-(ids[index].length + 1)) === '@' + ids[index]) return lsDel(item);", ""]]],
  /* start with a clean browser */
  /* the courtesy: another shop's unsent bills are a notice, never a block — and never lost (anchors hold no line end) */
  ['spare-list empty: the counter\'s queue is wiped', [[OP, "      var spared = Object.keys(reply[0]),", "      var spared = [],"]]],
  ['the counter key is wiped with the rest', [[OP, `var PAIR_KEYS = /^cb_till_(key|lastslot|entity|name)$/;`, `var PAIR_KEYS = /^cb_till_(lastslot|entity|name)$/;`]]],
  ['a spared slot loses its localStorage rows', [[OP, "      if (k.indexOf(spared[index] + '-') === 0) return true;", ""]]],
  ['a spared slot loses its @<sfx> keys', [[OP, `if (sfx && /^cb_till_/.test(k) && k.slice(-(sfx.length + 1)) === '@' + sfx) return true;`, ``]]],
  ['the notice is missing', [[OP, `notice: notice, pair: pair };`, `notice: null, pair: pair };`]]],
  ['the notice says nothing about the count', [[OP, "      c +\n      (c === 1 ? ' unsent bill for ' : ' unsent bills for ')", "      (c === 1 ? ' unsent bill for ' : ' unsent bills for ')"]]],
  ['a counter paired elsewhere blocks again', [[OP, `return { clean: !list.length, others: list,`, `return { clean: !list.length && !counter, others: list,`]]],
  ['the Labs\' unsent saves no longer refuse the clean-up', [[OP, "      if (reply[1]) return { ok: false, labUnsent: reply[1] };", ""]]],
  ['a pairing with 0 unsent is kept', [[OP, `if (!spared.length) return false;`, ``]]],
  ['a tab that did not answer is not named', [[OP, `if (silent.length) return { ok: false, silent: silent };`, ``]]],
  ['clean leaves localStorage', [[OP, "cbKeys(root.localStorage).filter(function (item) { return !sparedKey(item, spared); }).forEach(lsDel);", ""]]],
  ['clean leaves sessionStorage', [[OP, "cbKeys(root.sessionStorage).forEach(function (item) { root.sessionStorage.removeItem(item); });", ""]]],
  ['clean leaves the databases', [[OP, ".filter(function (item) { return spared.indexOf(item) < 0; }).map(dropDb)", ".filter(function () { return false; }).map(dropDb)"]]],
  ['clean leaves the caches', [[OP, "response.map(function (item) { return root.caches.delete(item); })", "[]"]]],
  ['clean leaves the service workers', [[OP, "response.map(function (item) { return item.unregister(); })", "[]"]]],
  ['the clean load registers a worker again', [[APP, `if(!(typeof CLEAN_LOAD!=='undefined'&&CLEAN_LOAD)) CBOffline.registerSW`, `CBOffline.registerSW`]]],
  ['the clean load says nothing', [[APP, `LOGIN.gone=CBOnePerson.cleanSentence(`, `void CBOnePerson.cleanSentence(`]]],
  ['a cleaned app tab says nothing', [[APP, `onWipe: function(){ return personLeave('', tx('Signed out — this browser is being cleaned.')); }`, `onWipe: function(){ return personLeave('', ' '); }`]]],
  ['a Lab ignores the clean-up', [['public/offer-lab-next.html', `onWipe: function(){ return Promise.resolve(labDrainOutbox()).catch(function(){}).then(function(){ location.replace('/?cleaned=1'); }); }`, `onWipe: function(){}`]]],
  /* index.html */
  ['index shows facts with another shop here', [[IDX, `if (r.others.length) closeFirst(r); else facts();`, `facts();`]]],
  ['index: mismatch not amber', [[IDX, "alert_('till-paired', 'warn',", "alert_('till-paired', 'info',"]]],
  ['index: same shop signs it out', [[IDX, `    if (next && next.ent === MINE.ent) return;\n`, ``]]],
  ['index: a sign-out elsewhere is not followed', [[IDX, `window.addEventListener('storage', onStore);`, ``]]],
  ['index: a late read paints the old shop', [[IDX, `  if (g !== GEN) return never();\n  if (!r.ok)`, `  if (!r.ok)`], [IDX, `  if (g !== GEN) return never();\n  return`, `  return`]]],
];
/* BREAK_ONLY=index runs just the breaks whose name contains it */
const ONLY = process.env.BREAK_ONLY || '';
/* Each break runs the paired check through e2e/lib/break-run.cjs: it stops at the FIRST red line the unbroken check does not already print (a verdict in
   seconds, not after the whole walk), and a check that is already red on main cannot "catch" anything by its old red lines (2026-11-13). */
const BASES = {};
const baseOf = (h) => { if (!BASES[h]) { BASES[h] = BR.baseline(h, { cwd: SITE.dir }); console.log('  baseline ' + h + ' (unbroken): exit ' + BASES[h].status + ', ' + BASES[h].xx.length + ' red line(s) already, ignored, ' + BASES[h].secs + ' s'); BASES[h].xx.forEach((l) => console.log('      red on main: ' + l.slice(0, 120))); } return BASES[h]; };
let good = 0, ran = 0;
for (const [name, edits] of BREAKS) {
  if (ONLY && name.indexOf(ONLY) < 0) continue;
  ran++;
  const files = [...new Set(edits.map((e) => e[0]))];
  const orig = {};
  for (const rel of files) orig[rel] = fs.readFileSync(path.join(W, rel), 'utf8');
  /* the files mix CRLF and LF — an anchor with \n is matched against both */
  const work = Object.assign({}, orig);
  let bad = '';
  for (const [rel, a, b] of edits) {
    const s = work[rel], crlf = a.indexOf('\n') >= 0 && s.split(a).length === 1;
    const A = crlf ? a.replace(/\n/g, '\r\n') : a, B = crlf ? b.replace(/\n/g, '\r\n') : b;
    const loc = BR.locate(s, a), n = loc.n;
    if (n !== 1) { bad = rel + ' anchor x' + n; break; }
    work[rel] = loc.apply(b);
  }
  if (bad) { console.log('  ??  ' + name + ': ' + bad); continue; }
  /* BREAK_DRY=1: only prove every anchor is found once — nothing is written, nothing is run */
  if (process.env.BREAK_DRY) { good++; console.log('  ok  anchor: ' + name); continue; }
  try {
    for (const rel of files) fs.writeFileSync(path.join(SITE.dir, rel), work[rel]);
    const H = 'e2e/one-person.cjs'; const base = baseOf(H), v = BR.verdict(H, base, { cwd: SITE.dir, timeout: 600000 });
    const caught = BR.caught(v, base);
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught' + (v.early ? ' at once' : '') + (v.rechecked ? ' (crash, confirmed twice)' : '') + ' (' + v.secs + ' s): ' + (v.xx[0] || 'harness crashed: ' + v.stderr).slice(0, 150) : 'NOT caught (exit ' + v.status + ', ' + v.secs + ' s)'));
  } finally {
    for (const rel of files) fs.writeFileSync(path.join(SITE.dir, rel), orig[rel]);   /* back to the original inside the copy for the next break */
  }
}
console.log('\n  ' + good + '/' + ran + (process.env.BREAK_DRY ? ' anchors found (dry — nothing run)' : ' breaks caught'));
process.exitCode = good === ran ? 0 : 1;
