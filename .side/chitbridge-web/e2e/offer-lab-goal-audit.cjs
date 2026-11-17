/* offer-lab-goal-audit.cjs — ONE SCREENSHOT PER GOAL KIND, SO "CONSISTENT ACROSS TYPES" CAN BE CHECKED
 * BY EYE, NOT BY ASSUMPTION.
 *
 * Athi, live: "when i change the offer type, the headers are going north... can you check for each type
 * of discount how the panel should look. it has to be consistent and the message has to be consistent.
 * do a playwright script." And: "do a thorugh check for the rest of the offers, does it create any
 * complexity for the design we have completed now" (the 'percent' goal's Result modal — percentRows()/
 * percentTableHTML()/percentVerdictHTML()/workDemoHTML()/paintWork()'s percent branch — just rebuilt,
 * sticky headers, resizable/draggable/printable sheet, a Markup toggle).
 *
 * What this does, for each of GOALS' 8 kinds (percent, amount, qty, free, bundle, spend, ship, band):
 *   1. loads offer-lab-next.html fresh (boots straight into demo mode — applyBiz('hotel'), no login)
 *   2. calls pickGoal(id) then apply() directly — every HOTEL biz default (S via BIZ.hotel.d) is already
 *      a VALID config for every goal (non-zero rate, a real scope, real tiers/pairs/bands), so no extra
 *      field-filling is needed to reach a working "Work it out" result — verified against cfgHTML()/
 *      applyWhy() in the source before writing this
 *   3. screenshots the open #workScrim sheet to e2e/screenshots/goal-<id>.png
 *   4. walks every <table> inside #workBody/#workDemo, computes the EFFECTIVE header-column count
 *      (respecting rowspan/colspan — percentTableHTML()'s own table uses both) and compares it to the
 *      first body row's real <td> count — exactly the class of bug a visual "headers don't line up with
 *      the data" complaint would be
 *   5. fails loudly (non-zero exit) on any console error, pageerror, a modal that never opened, or a
 *      header/data column-count mismatch
 *
 * Run standalone: node e2e/offer-lab-goal-audit.cjs
 * Optional: OFFER_LAB_URL=http://localhost:8123/offer-lab-next.html node e2e/offer-lab-goal-audit.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');

const URL = process.env.OFFER_LAB_URL || 'http://localhost:8123/offer-lab-next.html';
const OUTDIR = path.join(__dirname, 'screenshots');
const GOALS = ['percent', 'amount', 'qty', 'free', 'bundle', 'spend', 'ship', 'band'];

fs.mkdirSync(OUTDIR, { recursive: true });

/* effective leaf-column count of a <table>'s <thead>, respecting rowspan/colspan — a plain
 * `theadRow.cells.length` is wrong the moment any header spans more than one row (percentTableHTML()'s
 * own table does, on purpose: "Item"/"Cost"/"Price now" span both header rows, "Everyone pays" sits over
 * just its own "after N%" sub-header). Runs INSIDE the page via page.evaluate. */
function gridColumns(table) {
  var thead = table.tHead;
  if (!thead || !thead.rows.length) return null;
  var rows = Array.from(thead.rows);
  var occupied = []; // occupied[r] = Set of column indices already claimed by an earlier rowspan
  rows.forEach(function () { occupied.push({}); });
  var maxCol = 0;
  rows.forEach(function (row, r) {
    var col = 0;
    Array.from(row.cells).forEach(function (cell) {
      while (occupied[r][col]) col++;
      var colSpan = cell.colSpan || 1, rowSpan = cell.rowSpan || 1;
      for (var rr = r; rr < r + rowSpan && rr < rows.length; rr++) {
        for (var cc = col; cc < col + colSpan; cc++) occupied[rr][cc] = true;
      }
      col += colSpan;
      if (col - 1 > maxCol) maxCol = col - 1;
    });
  });
  return maxCol + 1;
}

async function auditGoal(page, id) {
  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
  const onError = (err) => { pageErrors.push(String(err)); };
  page.on('console', onConsole);
  page.on('pageerror', onError);

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof pickGoal === 'function' && typeof apply === 'function');

  await page.evaluate((g) => { pickGoal(g); }, id);
  await page.evaluate(() => { apply(); });
  const opened = await page.waitForSelector('#workScrim.on', { timeout: 4000 }).then(() => true).catch(() => false);

  const info = await page.evaluate(function (gridColumnsSrc) {
    /* eslint-disable no-eval */
    var gridColumns = eval('(' + gridColumnsSrc + ')');
    var scrim = document.getElementById('workScrim');
    var sheet = scrim ? scrim.querySelector('.sheet') : null;
    var demo = document.getElementById('workDemo');
    var body = document.getElementById('workBody');
    var tables = [];
    [demo, body].forEach(function (root, rootIx) {
      if (!root) return;
      Array.from(root.querySelectorAll('table')).forEach(function (t) {
        var headCols = gridColumns(t);
        var headTexts = t.tHead ? Array.from(t.tHead.rows[t.tHead.rows.length - 1].cells).map(function (c) { return c.textContent.trim(); }) : [];
        var firstBodyRow = t.tBodies[0] && t.tBodies[0].rows[0];
        var bodyCells = firstBodyRow ? Array.from(firstBodyRow.cells).map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }) : [];
        tables.push({
          root: rootIx === 0 ? 'workDemo' : 'workBody',
          className: t.className,
          headCols: headCols,
          lastHeadRowTexts: headTexts,
          bodyRowCount: t.tBodies[0] ? t.tBodies[0].rows.length : 0,
          firstBodyCellCount: bodyCells.length,
          firstBodyCellTexts: bodyCells,
        });
      });
    });
    return {
      title: (document.getElementById('workTitle') || {}).textContent || '',
      tag: (document.getElementById('workTag') || {}).textContent || '',
      note: (document.getElementById('workNote') || {}).textContent || '',
      sheetVisible: !!(sheet && sheet.getBoundingClientRect().width > 0),
      tables: tables,
    };
  }, gridColumns.toString());

  const shotPath = path.join(OUTDIR, 'goal-' + id + '.png');
  const sheetHandle = await page.$('#workScrim .sheet');
  if (sheetHandle) await sheetHandle.screenshot({ path: shotPath }).catch(async () => { await page.screenshot({ path: shotPath, fullPage: true }); });
  else await page.screenshot({ path: shotPath, fullPage: true });

  await page.evaluate(() => { closeWork(); });
  page.off('console', onConsole);
  page.off('pageerror', onError);

  return { id, opened, consoleErrors, pageErrors, shotPath, ...info };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();

  let anyFail = false;
  const results = [];
  for (const id of GOALS) {
    const r = await auditGoal(page, id);
    results.push(r);

    console.log('\n══ goal: ' + id + ' ══════════════════════════════════════');
    console.log('  modal opened          : ' + r.opened);
    console.log('  title / tag           : "' + r.title + '" / "' + r.tag + '"');
    console.log('  footer note           : "' + r.note + '"');
    console.log('  console errors        : ' + r.consoleErrors.length + (r.consoleErrors.length ? '  ' + JSON.stringify(r.consoleErrors) : ''));
    console.log('  page errors           : ' + r.pageErrors.length + (r.pageErrors.length ? '  ' + JSON.stringify(r.pageErrors) : ''));
    console.log('  screenshot            : ' + r.shotPath);
    if (!r.tables.length) console.log('  tables                : (none found)');
    r.tables.forEach(function (t, i) {
      const mismatch = t.headCols != null && t.headCols !== t.firstBodyCellCount;
      console.log('  table[' + i + '] ' + t.root + ' .' + (t.className || '(none)').split(' ').join('.'));
      console.log('    header cols (effective): ' + t.headCols + '   first-row <td> count: ' + t.firstBodyCellCount + (mismatch ? '   <<< MISMATCH' : ''));
      console.log('    header texts : ' + JSON.stringify(t.lastHeadRowTexts));
      console.log('    first row    : ' + JSON.stringify(t.firstBodyCellTexts));
      if (mismatch) anyFail = true;
    });

    if (!r.opened || r.consoleErrors.length || r.pageErrors.length) anyFail = true;
  }

  await browser.close();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(anyFail ? 'FAIL — see MISMATCH / error lines above' : 'PASS — all 8 goal kinds opened clean, no header/data count mismatch');
  process.exit(anyFail ? 1 : 0);
})();
