/* books-web-breaks.cjs — break each Ledger guard once, run e2e/books-web.cjs against a COPY of public/, throw the copy away.
 * Nothing in the working tree is ever edited (never git checkout to restore). A CRLF checkout matches the same anchors:
 * the copy is read as LF text and written back in the file's own line endings (the way chit-sheet-breaks.cjs does it). */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const CAP = 'public/app/cap-books.js', APP = 'public/app.html', ADMIN = 'public/app/cap-admin.js', SHELL = 'public/app/accounts-shell.js', LISTCTL = 'public/app/list-ctl.js';
const BREAKS = [
  ['switch sends nothing', SHELL, `return on ? host.api('booksEnable', { body: {} })`, `return on ? Promise.resolve({})`],
  ['switch shown to an actor', ADMIN, `(SESSION.role === 'entity'`, `(true`],
  ['door gate', APP, `if ((it[0] === 'ledger' || it[0] === 'bills') && SESSION.booksOn !== true) return false; `, ''],
  ['duplicate warning', CAP, `box.textContent = hit ? txf(`, `box.textContent = false ? txf(`],
  ['disputed refusal', CAP, ` || (x.disputed && x.amount_minor > 0);`, `;`],
  ['over-open refusal', CAP, ` || x.amount_minor > x.open_minor || (x.disputed`, ` || (x.disputed`],
  ['unlock needs reason', CAP, `if (what !== 'lock' && !why.trim()) {`, `if (false) {`],
  ['opening one-amount', CAP, `|| (dr && cr) || (!dr && !cr)`, `|| (!dr && !cr)`],
  ['tb balanced chip', CAP, `var ok = Number(r.total_dr_minor) === Number(r.total_cr_minor);`, `var ok = true;`],
  ['locked-month message', CAP, `} catch (e) { if (why) why.textContent = bkWhy(e, tx('Could not record it')); }`, `} catch (e) { }`],
  ['statement closing', CAP, `esc(bkMoney(r && r.closing_minor, c))`, `esc(bkMoney(r && r.opening_minor, c))`],
  /* ── the 2026-09-30 fix pass (review M10 · M11 · M12 · F11): every new guard, broken once ── */
  ['M11 payment recorded twice', CAP, `      if (!PAY.id) {`, `      if (true) {`],
  ['M11 payment has no client_ref', CAP, `          client_ref: PAY.ref };`, `          };`],
  ['M11 button live while the call is out', CAP, `  if (btn) btn.disabled = true;`, ``],
  ['M11 one ref for every form', CAP, `name: r.nickname || r.display_name || '', ref: bkRef() };`, `name: r.nickname || r.display_name || '', ref: 'web-0-0' };`],
  ['M10 download is not the file', CAP, `fetch(base + EP.booksPackFile.p.replace(`, `fetch(base + EP.booksPackGet.p.replace(`],
  ['M10 We have it never asks', CAP, `      if (!(BK.packGot && BK.packGot[id])) {`, `      if (false) {`],
  ['M10 download not remembered', CAP, `BK.packGot = BK.packGot || {}; BK.packGot[id] = true;`, ``],
  ['M10 no-file pack still offers buttons', CAP, `        : has === false ? '<span data-testid="pack-nofile-'`, `        : false ? '<span data-testid="pack-nofile-'`],
  ['M10 ack without asking for the file', CAP, `if (bkPackHasFile(BK.packRows && BK.packRows[id], r) !== true) { bkPackNoFile(id); return; }`, ``],
  ['M12 cheque step not sent', CAP, `body: { status: to } });`, `body: {} });`],
  ['M12 cheque steps not offered', CAP, `    + (next.length ? ' <span class="supacts"`, `    + (false ? ' <span class="supacts"`],
  ['M12 bounce does not ask', CAP, `  if (to === 'bounced') {`, `  if (false) {`],
  ['M12 server cheques not listed', CAP, `  ((r && r.cheques) || []).forEach(bkChequeKeep);`, ``],
  ['M12 refused step swallowed', CAP, `    } catch (e) { say(bkWhy(e, tx('Could not change it'))); }`, `    } catch (e) { c.status = to; }`],
  ['M12 waiting reason not shown', CAP, `esc(w.reason || w.why || tx('No reason given'))`, `esc(tx('No reason given'))`],
  ['M12 retry not sent', CAP, `      await api('booksRetry', { body: {} });`, ``],
  ['M12 waiting count not shown', CAP, `el.textContent = '🕗 ' + tx('Waiting') + (n ? ' · ' + n : '');`, ``],
  ['W15-94 an age bucket is dropped from the party row', CAP, `BK_FOLLOW.filter(function (item) {
      return follow && Number(follow[item[0]]);`, `BK_FOLLOW.filter(function (item) {
      return false && follow && Number(follow[item[0]]);`],
  /* ── where an entry came from (Athi, 2026-10-01: "how do I connect to the sale record, who has done it?") ── */
  ['SRC bill number not a link', CAP, `var link = s.chit_id ? '<a href="#"`, `var link = false ? '<a href="#"`],
  ['SRC link also opens the row', CAP, `onclick="event.stopPropagation();openChitSheet(\\''`, `onclick="openChitSheet(\\''`],
  ['SRC day count missing', CAP, `(s.count != null ? ' · ' + esc(txf(`, `(false ? ' · ' + esc(txf(`],
  ['SRC counter missing', CAP, `  if (s.counter) out.push(esc(counterWord(s.counter)));`, ``],
  ['SRC seller missing', CAP, `function bkRungPart(s) { return s && s.by ?`, `function bkRungPart(s) { return false ?`],
  ['SRC day reads its long narration', CAP, `return s && s.kind === 'day' ? esc(tx('Walk-in day'))`, `return false ? esc(tx('Walk-in day'))`],
  ['SRC ledger lines lose their source', CAP, `else if (s.ref || s.chit_id) out += (said ? ' ' : ' · ' + (kw ? esc(kw) + ' ' : '')) + bkBillPart(s, tid);`, `else if (false) out += (said ? ' ' : ' · ' + (kw ? esc(kw) + ' ' : '')) + bkBillPart(s, tid);`],
  /* ── how it was paid (Athi, 2026-10-01: "clearly segregate credit, cash, UPI (UPI id)") ── */
  ['HOW tender not shown', CAP, `  if (s.how) return '<span data-testid="'`, `  if (false) return '<span data-testid="'`],
  ['HOW day split not shown', CAP, `if (s.kind === 'day' && s.split && s.split.length) return s.split.map(function (x) { return esc(tx(x.how))`, `if (false) return s.split.map(function (x) { return esc(tx(x.how))`],
  ['HOW payment reference dropped', CAP, `(s.how_ref ? ' <span class="mono">' + esc(bkShortRef(s.how_ref))`, `(false ? ' <span class="mono">' + esc(bkShortRef(s.how_ref))`],
  /* ── both times (Athi, 2026-10-01: "the time the bill was made or the time the entry was accepted? both should be there") ── */
  ['TIME bill time not shown', CAP, `link + (s.doc_at ? ' <span`, `link + (false ? ' <span`],
  ['TIME late entry not marked', CAP, `  if (!late) return '';`, `  return '';`],
  ['TIME same-day entry marked anyway', CAP, `  if (!late) return '';`, `  if (false) return '';`],
  ['HOW receipt not called Received', CAP, `return s && s.kind === 'day' ? esc(tx('Walk-in day')) : s && s.kind === 'receipt' ? esc(tx('Received'))`, `return s && s.kind === 'day' ? esc(tx('Walk-in day')) : false ? esc(tx('Received'))`],
  /* ── the Day book's strip and to-do (Athi, 2026-10-01: "see the total sale in different counters … act one by one") ── */
  ['TODO strip counter amount dropped', CAP, `counters[c].amount_minor += total; counters[c].bills += bills;`, `counters[c].bills += bills;`],
  ['TODO strip per-bill does not count one', CAP, `var bills = s.kind === 'day' ? Number(s.count || 0) : 1;`, `var bills = s.kind === 'day' ? Number(s.count || 0) : 0;`],
  ['TODO strip day split not in tenders', CAP, `if (s.kind === 'day') (s.split || []).forEach(function (x) { add(x.how, Number(x.amount_minor || 0)); });`, `if (false) (s.split || []).forEach(function (x) { add(x.how, Number(x.amount_minor || 0)); });`],
  ['TODO strip bill tender dropped', CAP, `    else if (s.how) add(s.how, total);`, ``],
  ['TODO walk-in note never said', CAP, `if (!t.day_closed) notices.push(`, `if (false) notices.push(`],
  ['TODO note said though the day closed', CAP, `if (!t.day_closed) notices.push(`, `if (true) notices.push(`],
  ['TODO accept counts the page, not the one count (STD1)', CAP, `accept: Number(t.accept) || 0,`, `accept: rows.length,`],
  ['TODO overdue counts the settled too', CAP, `return Object.keys(b).some(function (k) { return k !== 'not_due' && Number(b[k] || 0); });`, `return true;`],
  ['TODO cheque without a step counted', CAP, `bkChequeNext({ status: bkChequeStatus(x.status), next: Array.isArray(x.next) ? x.next : null }).length > 0`, `true`],
  ['TODO waiting double-counts the supplier bills', CAP, `    waiting: n.record };`, `    waiting: n.total };`],
  ['TODO a zero still earns a row', CAP, `if (n.accept) notices.push(`, `if (true) notices.push(`],
  ['TODO quiet line missing', CAP, `if (!n.accept && !n.supplier && !n.overdue && !n.cheques && !n.waiting) chips.push(`, `if (false) chips.push(`],
  ['TODO dues tap dead', CAP, `onOpen: function () { bkTab('dues'); }`, `onOpen: function () { }`],
  ['TODO cheques tap dead', CAP, `onOpen: function () { bkTab('cheques'); }`, `onOpen: function () { }`],
  ['TODO waiting tap dead', CAP, `tx('waiting to be recorded'), onOpen: function () { bkTab('waiting'); } });`, `tx('waiting to be recorded'), onOpen: function () { } });`],
  ['TODO phone tap shows nothing', CAP, `  if (!silent && UI.vp === 'mob') { UI.mdetail = true; var pn = document.getElementById('panel'); if (pn) pn.classList.add('showdetail'); }`, ``],
  /* ── the Day book's views (Athi, 2026-10-01: "expand all, collapse all, search, filter, daily view, weekly view … the gist as a summary") ── */
  ['VIEW gist from a second formula', CAP, `m[key].amt += Number(l.dr_minor || 0) + Number(l.cr_minor || 0);`, `m[key].amt += Math.round(Number(l.dr_minor || 0) * 1.01) + Number(l.cr_minor || 0);`],
  ['VIEW GST rate lines not merged', CAP, `key = gst ? 'GST' : String(l.code);`, `key = String(l.code);`],
  ['VIEW filter ignored', CAP, `match: function (e, v) { return bkDvVals(e, x[0]).indexOf(v) >= 0; },`, `match: function (e, v) { return true; },`],
  ['VIEW search ignored', LISTCTL, `if (String(text || '').toLowerCase().indexOf(q) < 0) return false;`, ``],
  ['VIEW search skips amounts', CAP, `[(tot / pow).toFixed(bkDec(c)), String(Math.floor(tot / pow)), bkMoney(tot, c)], bkDvGist(e).map(function (x) { return (x.amt / pow).toFixed(bkDec(c)); })`, `[], []`],
  ['VIEW paise search matches the whole rupee', CAP, `[(tot / pow).toFixed(bkDec(c)), String(Math.floor(tot / pow)), bkMoney(tot, c)], bkDvGist(e).map(function (x) { return (x.amt / pow).toFixed(bkDec(c)); })`, `[String(Math.floor(tot / pow))], bkDvGist(e).map(function (x) { return String(Math.floor(x.amt / pow)); })`],
  ['VIEW collapse-all leaves one open', LISTCTL, `R.allOpen = !R.allOpen; R.open = {};`, `R.allOpen = !R.allOpen; R.open = !R.allOpen && matched(I).rows[0] ? (function () { var o = {}; o[rid(I, matched(I).rows[0], 0)] = true; return o; })() : {};`],
  ['VIEW expand-all misses some', LISTCTL, `R.allOpen = !R.allOpen; R.open = {};`, `R.allOpen = !R.allOpen; R.open = R.allOpen && matched(I).rows[0] ? (function () { var o = {}; o[rid(I, matched(I).rows[0], 0) + '#closed'] = true; return o; })() : {};`],
  ['VIEW open by default', LISTCTL, `return R.allOpen ? !R.open[id + '#closed'] : !!R.open[id];`, `return true;`],
  ['VIEW group heads ignore the filter', LISTCTL, `var buckets = {}, order = [], loose = [];`, `var buckets = {}, order = [], loose = []; rows = allRows(I);`],
  ['VIEW week starts on Sunday', CAP, `new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 864e5)`, `new Date(t.getTime() - t.getUTCDay() * 864e5)`],
  ['VIEW week number missing', CAP, `label: txf('Week {n}', { n: wk }) + ' · ' + `, `label: `],
  ['VIEW month head not grouped', CAP, `if (mode === 'month') return { key: day.slice(0, 7),`, `if (mode === 'month') return { key: day,`],
  ['VIEW day head loses a tender', CAP, `tn.forEach(function (x) { parts.push(`, `tn.slice(1).forEach(function (x) { parts.push(`],
  ['VIEW arrow down does not move', LISTCTL, `at = ev.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) :`, `at = ev.key === 'ArrowDown' ? at :`],
  ['VIEW Enter does nothing', LISTCTL, `if (ev.key === 'Enter') { if (I.r.hl) { ev.preventDefault(); openRow(I, I.r.hl, ev); } return; }`, `if (ev.key === 'Enter') { return; }`],
  ['VIEW Esc swallowed', LISTCTL, `if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;`, `if (ev.key === 'Escape') { ev.preventDefault(); return; }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;`],
  ['VIEW CSV drops a row', CAP, `    rows.push([String(e.posting_date).slice(0, 10), e.entry_no,`, `    if (e.entry_no !== 'JV/2026-27/000001') rows.push([String(e.posting_date).slice(0, 10), e.entry_no,`],
  ['VIEW CSV ignores the filter', CAP, `csv: function (rows) { bkDvDownload(rows); },`, `csv: function (rows) { bkDvDownload(BK.dv.r.entries); },`],
  ['VIEW filter offers a value not in range', CAP, `if (seen.indexOf(v) < 0) seen.push(v); }); });\n    if (x[0] === 'kind') seen.sort(`, `if (seen.indexOf(v) < 0) seen.push(v); }); }); if (x[0] === 'kind') seen.push('Purchases');\n    if (x[0] === 'kind') seen.sort(`],
  ['VIEW bill link also toggles the row', CAP, `onclick="event.stopPropagation();openChitSheet(\\''`, `onclick="openChitSheet(\\''`],
  ['VIEW phone rows are not flex cards', LISTCTL, `.cbl .cbl-row{display:flex;flex-wrap:wrap;`, `.cbl .cbl-row{display:grid;flex-wrap:wrap;`],
  ['VIEW phone rows have no card edge', LISTCTL, `padding:8px 12px;margin:8px 10px;border:1px solid var(--cl-line);border-radius:12px;background:var(--cl-card)}`, `padding:8px 12px;margin:8px 10px;border:0;border-radius:0;background:var(--cl-card)}`],
  /* ── ONE TABLE (docs/design/one-table): a ledger screen draws its OWN rows, or loses what the Task table gives it ── */
  ['ONE a ledger screen draws its own rows', CAP, `  return CBList.mount(el, {
    key: 'daybook',`, `  el.innerHTML = '<div class=bkdv-row data-testid=db-entry-JV/2026-27/000001>JV/2026-27/000001</div>';
  return CBList.mount(document.createElement('div'), {
    key: 'daybook',`],
  ['ONE the bill number opens no sheet', CAP, `onclick="event.stopPropagation();openChitSheet(\\''`, `onclick="event.stopPropagation();void(\\''`],
  ['ONE a heading does not sort', LISTCTL, `s.sort = cur && cur.key === d.sort ? `, `return; s.sort = cur && cur.key === d.sort ? `],
  ['ONE a rail row opens no next level', LISTCTL, `function hasNext(I) { return !!(`, `function hasNext(I) { return false && !!(`],
];
/* BREAK_ONLY=M1 runs just the breaks whose name contains it */
const ONLY = process.env.BREAK_ONLY || '';
/* BREAK_CHECK=1 only checks that every anchor still matches the source exactly once (fast — nothing is run) */
if (process.env.BREAK_CHECK) {
  let bad = 0;
  for (const [name, rel, a2] of BREAKS) {
    const n = BR.locate(fs.readFileSync(path.join(W, rel), 'utf8'), a2).n;
    if (n !== 1) { bad++; console.log('  ??  ' + name + ': anchor x' + n); }
  }
  console.log('\n  ' + (BREAKS.length - bad) + '/' + BREAKS.length + ' anchors match once'); process.exit(bad ? 1 : 0);
}
/* Each break runs the paired check through e2e/lib/break-run.cjs: it stops at the FIRST red line the unbroken check does not already print (a verdict in
   seconds, not after the whole walk), and a check that is already red on main cannot "catch" anything by its old red lines (2026-11-13). */
const BASES = {};
const baseOf = (h) => { if (!BASES[h]) { BASES[h] = BR.baseline(h, { cwd: SITE.dir }); console.log('  baseline ' + h + ' (unbroken): exit ' + BASES[h].status + ', ' + BASES[h].xx.length + ' red line(s) already, ignored, ' + BASES[h].secs + ' s'); BASES[h].xx.forEach((l) => console.log('      red on main: ' + l.slice(0, 120))); } return BASES[h]; };
let good = 0, ran = 0;
for (const [name, rel, a, b] of BREAKS) {
  if (ONLY && name.indexOf(ONLY) < 0) continue;
  ran++;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bkw-'));
  try {
    fs.cpSync(path.join(W, 'public'), path.join(tmp, 'public'), { recursive: true });
    const f = path.join(tmp, rel), raw = fs.readFileSync(f, 'utf8'), crlf = raw.indexOf('\r\n') >= 0, s = raw.replace(/\r\n/g, '\n'), loc = BR.locate(s, a), n = loc.n;
    if (n !== 1) { console.log('  ??  ' + name + ': anchor x' + n); continue; }
    const out = loc.apply(b);
    fs.writeFileSync(f, crlf ? out.replace(/\n/g, '\r\n') : out);
    /* ⚠️ 600s, not 300: a break that strands the harness on its catch-all waits runs long, and on a loaded
       Windows machine 'M10 download not remembered' crossed 300s — reported NOT caught when it was only slow. */
    const H = 'e2e/books-web.cjs'; const base = baseOf(H), v = BR.verdict(H, base, { cwd: SITE.dir, timeout: 600000, env: Object.assign({}, process.env, { BOOKS_ROOT: path.join(tmp, 'public') }) });
    const caught = BR.caught(v, base);
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught' + (v.early ? ' at once' : '') + (v.rechecked ? ' (crash, confirmed twice)' : '') + ' (' + v.secs + ' s): ' + (v.xx[0] || 'harness crashed: ' + v.stderr).slice(0, 150) : 'NOT caught (exit ' + v.status + ', ' + v.secs + ' s)'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log('\n  ' + good + '/' + ran + ' breaks caught');
process.exitCode = good === ran ? 0 : 1;
