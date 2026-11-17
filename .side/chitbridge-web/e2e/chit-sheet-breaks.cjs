/* chit-sheet-breaks.cjs — break each chit-sheet guard once, run e2e/chit-sheet.cjs against a COPY of public/, throw the copy away.
 * Nothing in the working tree is ever edited (never git checkout to restore). Each break must make the harness exit non-zero with an XX line. */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const W = path.join(__dirname, '..');
const BR = require('./lib/break-run.cjs');
/* the checks run from a throw-away copy of the checkout (BR.site): the repo's own public/, index.html and e2e/shots are never touched, so a kill cannot leave them broken */
const SITE = BR.site(W); process.on('exit', () => SITE.dispose());
const SHEET = 'app/chit-sheet.js', BOOKS = 'app/cap-books.js', APP = 'app.html', ACCOUNTS = 'accounts.html';
const BREAKS = [
  ['Dispute offered on a cart bill', SHEET, "    if (m.counterBill) {\n      list.push('print');", "    if (m.counterBill) {\n      list.push('print');\n      list.push('dispute');"],
  ['Accept offered on a cart bill', SHEET, "    if (m.counterBill) {\n      list.push('print');", "    if (m.counterBill) {\n      list.push('accept');\n      list.push('print');"],
  ['supplier bill loses Goods in', SHEET, "        list.push('dispute');\n        list.push('goodsin');", "        list.push('dispute');"],
  ['accepted bill still offers Accept', SHEET, "      } else if (!dead) list.push('dispute');\n    } else {", "      } else if (!dead) { list.push('accept'); list.push('dispute'); }\n    } else {"],
  /* openChit() is now just openChitSheet(), so the break that navigates calls the page door */
  ['navigation instead of the sheet', BOOKS, "event.stopPropagation();openChitSheet(", "event.stopPropagation();openChitPage("],
  ['Waiting row navigates', BOOKS, "        if (w.chit_id) openChitSheet(w.chit_id);", "        if (w.chit_id) openChitPage(w.chit_id);"],
  /* ── web-reads-invoice (2026-10-02): the four breaks the task names, and the guards around them ── */
  ['hand arithmetic back: a hand-halved CGST', SHEET, "esc(fmtMoney(inter ? v.igst : v.cgst, m.cur, '—'))", "esc(fmtMoney(inter ? v.igst : Math.round(Number(v.tax) * 50) / 100, m.cur, '—'))"],
  ['hand arithmetic back: SGST worked out as tax − half', SHEET, "(inter ? '' : esc(fmtMoney(v.sgst, m.cur, '—')))", "(inter ? '' : esc(fmtMoney(Math.round((Number(v.tax) - Math.round(Number(v.tax) * 50) / 100) * 100) / 100, m.cur, '—')))"],
  ['hand arithmetic back: the total summed from the lines', SHEET, `var mo = m.money || {}, t = mo.total;`, `var mo = m.money || {}, t = m.lines.reduce(function (a, l) { return a + Number(l.total || 0); }, 0);`],
  ['the frozen invoice ignored (the header read instead)', SHEET, `if (bj && bj.invoice && root.CBTax && root.CBTax.moneyOf) return`, `if (false) return`],
  ['line totals from the chit lines, not the invoice', SHEET, "esc(sheetMoney(f ? f.total : lineTotal(item, m), m))", "esc(sheetMoney(lineTotal(item, m), m))"],
  ['an invented total when none is recorded', SHEET, "esc(t == null ? T(m.costHidden ? 'hidden' : 'not recorded') : fmtMoney(t, m.cur, '—'))", "esc(t == null ? fmtMoney(0, m.cur, '—') : fmtMoney(t, m.cur, '—'))"],
  ['Accept without the choice', SHEET, "      if (m.billRx && !m.captured) {\n        CS.useAsk = true;\n        CS.note = null;\n        return paint();\n      }\n      return acceptBill();", "      return acceptBill();"],
  ['Accept: the status first, the use after', SHEET, "      if (use && to === 'act' && m.billRx) await api('billUse', { params: { id: id }, body: { use: use } });\n      /* FX-F10W2: Reject is the rail's own step word (STEP_TO reject → rejected), with its reason as the note */\n      var word =\n        to === 'reject'\n          ? 'rejected'\n          : typeof statusWordFor === 'function'\n            ? statusWordFor(to, { billRx: m.billRx })\n            : { open: 'pending', act: m.billRx ? 'accepted' : 'in_progress', close: 'completed' }[to];\n      var reply = await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });", "      /* FX-F10W2: Reject is the rail's own step word (STEP_TO reject → rejected), with its reason as the note */\n      var word =\n        to === 'reject'\n          ? 'rejected'\n          : typeof statusWordFor === 'function'\n            ? statusWordFor(to, { billRx: m.billRx })\n            : { open: 'pending', act: m.billRx ? 'accepted' : 'in_progress', close: 'completed' }[to];\n      var reply = await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });\n      if (use && to === 'act' && m.billRx) await api('billUse', { params: { id: id }, body: { use: use } });"],
  ['the step read from the shared status', SHEET, `status: billRx ? billStepStatus(log, captured ? String(h.current_status || h.status || 'pending') : null) : String(h.current_status || h.status || 'pending')`, `status: String(h.current_status || h.status || 'pending')`],
  ['the to-do and Waiting not re-read after Accept', SHEET, `if (typeof root.bkHealthLoad === 'function') root.bkHealthLoad()`, `if (false) root.bkHealthLoad()`],
  /* STD1: Accept greys from the SERVER's may/why on the read (actions.accept) — off the Books page too */
  ['Accept not greyed by the read\'s may/why (STD1)', SHEET, `var a = m && m.billRx ? m.may : null;`, `var a = null;`],
  ['the bill class guessed, not the read\'s doc (STD1)', SHEET, `billRx = !!(r && r.doc === 'bill_received')`, `billRx = purpose === 'invoice' && !iSent`],
  ['the counter named by the till, not the series', SHEET, "counter: counterOfBill(bill, text.till),", "counter: (text.till && (text.till.name || text.till.id)) || '',"],
  ['the ledger route not redirected (#/app/ledger)', APP, `if(SESSION.token && _lg) return ledgerDoorClosed(_lg[1]);`, ``],
  ['a remembered cb_nav of ledger not redirected', APP, "  if (SESSION.token && UI.nav === 'ledger' && /^#\\/app$|^#\\/?$/.test(text)) return ledgerDoorClosed();", ""],
  ['navTo("ledger") not redirected', APP, `function navTo(k){if(k==="ledger") return ledgerDoorClosed();`, `function navTo(k){`],
  ['the redirect drops the view', APP, "  var v = view || (typeof BK !== 'undefined' && BK && BK.tab) || '';", "  var v = '';"],
  ["a Bills door is back in the app menu", APP, "          ['intake', '📨', 'Intake'],\n", "          ['intake', '📨', 'Intake'],\n          ['bills', '🧾', 'Bills'],\n"],
  ['Accounts does not load the sheet', ACCOUNTS, `<script src="/app/chit-sheet.js"></script>`, ``],
  ['Accounts does not load tax.js', ACCOUNTS, `<script src="/engine/tax.js"></script>`, ``],
  ['a Bills row opens a new tab, not the sheet', ACCOUNTS, "      onOpen: (c) => openChitSheet(c.chit_id),", "      onOpen: (c) => window.open(chitPageHref(c.chit_id), '_blank'),"],
  ['Bills shows the handle, not the name', ACCOUNTS, "    by ? [tx('By'), esc(by)] : null,", "    b.by ? [tx('By'), esc(b.by)] : null,"],
  ['GST rate rows dropped', SHEET, "      (m.purpose === 'order' && !m.counterBill && !(m.money && m.money.by_rate) ? '' : gstBlockHTML(m)) +\n      totalHTML(m) +", "      totalHTML(m) +"],
  ['total not shown', SHEET, "      totalHTML(m) +\n      tenderHTML(m) +", "      tenderHTML(m) +"],
  ['tender not shown', SHEET, "      tenderHTML(m) +\n      (m.agreement", "      (m.agreement"],
  ['offer not shown', SHEET, "offs = item.offers && item.offers.length ? item.offers : item.offer ? [{ label: item.offer.label, off: item.offer.off }] : [];", "offs = [];"],
  ['Accept sends nothing', SHEET, "      var reply = await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });", "      var reply = null;"],
  ['Accept sent twice', SHEET, "      var reply = await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });", "      var reply = await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });\n      await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });"],
  ['sheet not repainted after Accept', SHEET, "      await read(id);\n      /* the Waiting row leaves at once", "      /* the Waiting row leaves at once"],
  ['Open page does not open the page', SHEET, "      var pg = typeof openChitPage === 'function' ? openChitPage : openChit;\n      if (typeof pg === 'function') pg(id);", ""],
  ['Open page keeps the sheet', SHEET, "      CS.pushed = false;\n      close();\n      var pg = typeof", "      CS.pushed = false;\n      var pg = typeof"],
  ['page scrolls behind the sheet / close moves it', SHEET, "      lock(false);\n      if (CS.mode === 'dialog') CS.id = null;", "      lock(false);\n      if (CS.mode === 'dialog') CS.id = null;\n      window.scrollTo(0, 0);"],
  ['sheet runs sideways on a phone', SHEET, `width:min(560px,100vw);max-width:100vw;`, `width:600px;max-width:none;`],
  ['to-do goes back to Intake', BOOKS, "        if (n.accept === 1 && (n.acceptIds || []).length === 1) openChitSheet(n.acceptIds[0]);\n        else bkNoticeGo('accept');", "        navTo('intake');"],
  ['to-do with several bills goes to Intake', BOOKS, "        else bkNoticeGo('accept');", "        else navTo('intake');"],
  ['title back to "Chit"', SHEET, `if (ttl) ttl.textContent = T(m ? titleFor(m) : 'Bill');`, `if (ttl) ttl.textContent = T('Chit');`],
  ['supplier bill titled as a counter bill', SHEET, `if (m.billRx) return 'Supplier bill';`, `if (m.billRx) return 'Bill';`],
  ['tender sum wrong', SHEET, "esc(fmtMoney(x.amount, m.cur, '—')) +\n            '</b></div>'", "esc(fmtMoney(Number(x.amount) + 1, m.cur, '—')) +\n            '</b></div>'"],
  ['change line dropped', SHEET, "(p.change > 0 ? '<div class=\"cs-row cs-mute\" data-testid=\"cs-change\"><span>'", "(false ? '<div class=\"cs-row cs-mute\" data-testid=\"cs-change\"><span>'"],
  ['owner suffix missing', BOOKS, `(bkIsShopName(s.by) ? ' ' + esc(tx('(owner)')) : '')`, `''`],
  /* the Day book's source cell (db-head), the one the check reads */
  ['owner suffix on everyone', BOOKS, "(bkIsShopName(source.by) ? ' <span style=\"color:var(--grey)\">'", "(true ? ' <span style=\"color:var(--grey)\">'"],
];
const ONLY = process.env.BREAK_ONLY || '';
/* Each break runs the paired check through e2e/lib/break-run.cjs: it stops at the FIRST red line the unbroken check does not already print (a verdict in
   seconds, not after the whole walk), and a check that is already red on main cannot "catch" anything by its old red lines (2026-11-13). */
const BASES = {};
const baseOf = (h) => { if (!BASES[h]) { BASES[h] = BR.baseline(h, { cwd: SITE.dir }); console.log('  baseline ' + h + ' (unbroken): exit ' + BASES[h].status + ', ' + BASES[h].xx.length + ' red line(s) already, ignored, ' + BASES[h].secs + ' s'); BASES[h].xx.forEach((l) => console.log('      red on main: ' + l.slice(0, 120))); } return BASES[h]; };
let good = 0, ran = 0;
for (const [name, rel, a, b] of BREAKS) {
  if (ONLY && name.indexOf(ONLY) < 0) continue;
  ran++;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chs-'));
  try {
    fs.cpSync(path.join(W, 'public'), path.join(tmp, 'public'), { recursive: true });
    /* a CRLF checkout (Windows) must match the same anchors: match on LF text, write back in the file's own endings */
    const f = path.join(tmp, 'public', rel), raw = fs.readFileSync(f, 'utf8'), crlf = raw.indexOf('\r\n') >= 0, s = raw.replace(/\r\n/g, '\n'), loc = BR.locate(s, a), n = loc.n;
    if (n !== 1) { console.log('  ??  ' + name + ': anchor x' + n); continue; }
    const out = loc.apply(b);
    fs.writeFileSync(f, crlf ? out.replace(/\n/g, '\r\n') : out);
    const H = 'e2e/chit-sheet.cjs'; const base = baseOf(H), v = BR.verdict(H, base, { cwd: SITE.dir, timeout: 600000, env: Object.assign({}, process.env, { CHS_ROOT: path.join(tmp, 'public') }) });
    const caught = BR.caught(v, base);
    if (caught) good++;
    console.log((caught ? '  ok  ' : '  XX  ') + 'broken: ' + name + ' → ' + (caught ? 'caught' + (v.early ? ' at once' : '') + (v.rechecked ? ' (crash, confirmed twice)' : '') + ' (' + v.secs + ' s): ' + (v.xx[0] || 'harness crashed: ' + v.stderr).slice(0, 150) : 'NOT caught (exit ' + v.status + ', ' + v.secs + ' s)'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log('\n  ' + good + '/' + ran + ' breaks caught');
process.exitCode = good === ran ? 0 : 1;
