/* list-ctl-click.js — what a press on a mounted CBList does (the click half of app/list-ctl.js).
 * OWNS      onClick and its steps: a sort heading, a group head, a filter popover and its choices, a view tab, a period chip, a notice, grouping and the view switch, ⚑ needs, expand all,
 *           CSV, clear filters, retry, more, reset columns, select mode and select all, bulk actions, move and widen a column, sort, row actions, the caret and open row; and the small
 *           helpers those steps and the key/change/drag half share (cssId · resize · colByKey · refocusRz).
 * CALLED BY app/list-ctl-wire.js (wire puts onClick on the list's element) and app/list-ctl.js (the file calls CBListParts.click(kit) once, at its end). Loaded BEFORE app/list-ctl-wire.js and app/list-ctl.js by every page that loads the list unit.
 * FLOW      a click lands on a list → onClick walks its steps in order → the first step that knows the pressed thing does that one job (repaints through the kit) and ends the call
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/list-control
 * Split out of list-ctl.js (shrink W2, 2026-11-17): behaviour unchanged; the controls keep the data-cbsid their painters in list-ctl.js write.
 */
(function (root) {
  'use strict';
  /* root.CBListParts is created by list-ctl-css.js, which loads first */
  var closePop, columns, curSort, download, head, matched, minW, needsNext, needsToggle, openRow, paintAll, paintList, paintTitle, paintTools, query, remote, resetLimit, rowById, rowIdOf, safe, saveChoices, selectedRows, shownKeys, sortId, togglePop, toggleRow, viewKeys, viewOn, widthOf; /* what list-ctl.js hands over through bind: its functions and constants this file works with */
  /** bind: list-ctl.js hands over, once, the names this file works with (the list unit's own functions and constants) */
  function bind(needs) {
    closePop = needs.closePop;
    columns = needs.columns;
    curSort = needs.curSort;
    download = needs.download;
    head = needs.head;
    matched = needs.matched;
    minW = needs.minW;
    needsNext = needs.needsNext;
    needsToggle = needs.needsToggle;
    openRow = needs.openRow;
    paintAll = needs.paintAll;
    paintList = needs.paintList;
    paintTitle = needs.paintTitle;
    paintTools = needs.paintTools;
    query = needs.query;
    remote = needs.remote;
    resetLimit = needs.resetLimit;
    rowById = needs.rowById;
    rowIdOf = needs.rowIdOf;
    safe = needs.safe;
    saveChoices = needs.saveChoices;
    selectedRows = needs.selectedRows;
    shownKeys = needs.shownKeys;
    sortId = needs.sortId;
    togglePop = needs.togglePop;
    toggleRow = needs.toggleRow;
    viewKeys = needs.viewKeys;
    viewOn = needs.viewOn;
    widthOf = needs.widthOf;
  }
  function cssId(s) {
    return String(s).replace(/[^A-Za-z0-9_-]/g, '\\$&');
  }
  function resize(I, key, delta, kb) {
    var c = colByKey(I, key);
    if (!c) return;
    I.s.widths[key] = Math.max(minW(I, c), widthOf(I, c) + delta);
    saveChoices(I);
    paintList(I);
    if (kb) refocusRz(I, key);
  }
  /* adjustable columns: pointer (mouse and touch), ← → in 8 px, double-click resets; never narrower than the label; remembered */
  function colByKey(I, key) {
    return columns(I).filter(function (item) {
      return item.key === key;
    })[0];
  }
  function refocusRz(I, k) {
    var node = I.el.querySelector('[data-rz="' + k + '"]');
    if (node) node.focus();
  }
  /** onClick, step 1 of 15 (the data-row part, lines 2847-2862 of the one function): true when it handled the call and nothing else should run */
  function onClickRow(list, event, ctx) {
ctx.node = event.target;
    if (!ctx.node.closest) return true;
    ctx.b = ctx.node.closest('button,[data-row],input[type=checkbox],select');
ctx.R = list.r;
ctx.s = list.s;
ctx.o = list.o;
    ctx.pop = ctx.node.closest('.cbl-pop');
    var hcell = ctx.node.closest('.cbl-hc');
    if (hcell && !ctx.node.closest('.cbl-rz') && !ctx.node.closest('[data-sort]') && !ctx.node.closest('[data-hf]') && list.el.contains(hcell)) {
      var sbtn = hcell.querySelector('[data-sort]');
      if (sbtn) {
        sbtn.click();
        return true;
      }
    }
    ctx.gh = ctx.node.closest('[data-g]');
    return false;
  }
  /** onClick, step 2 of 15 (the data-row part, lines 2863-2874 of the one function): true when it handled the call and nothing else should run */
  function onClickRow2(list, event, ctx) {
    if (ctx.gh && list.el.contains(ctx.gh) && !(ctx.b && ctx.b.hasAttribute('data-row'))) {
      if (list.pop) {
        list.pop = null;
        paintTitle(list);
        paintTools(list);
      }
      ctx.R.gcol[ctx.gh.getAttribute('data-g')] = !ctx.R.gcol[ctx.gh.getAttribute('data-g')];
      paintList(list);
      var groupAgain = list.el.querySelector('[data-g="' + cssId(ctx.gh.getAttribute('data-g')) + '"]');
      if (groupAgain) groupAgain.focus();
      return true;
    }
    return false;
  }
  /** onClick, step 3 of 15 (the data-rz part, lines 2875-2891 of the one function): true when it handled the call and nothing else should run */
  function onClickRz(list, event, ctx) {
    if (!ctx.b) {
      if (list.pop && !ctx.pop) closePop(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-rz')) return true;
    if (ctx.b.hasAttribute('data-cbl-pop')) {
      togglePop(list, ctx.b.getAttribute('data-cbl-pop'));
      return true;
    }
    if (ctx.b.hasAttribute('data-hf')) {
      var listBox = list.el.getBoundingClientRect(),
        buttonBox = ctx.b.getBoundingClientRect();
      list.hfAt = { l: Math.max(4, Math.min(buttonBox.left - listBox.left, listBox.width - 190)), t: buttonBox.bottom - listBox.top + 4 };
      togglePop(list, 'hf:' + ctx.b.getAttribute('data-hf'));
      paintList(list);
      return true;
    }
    return false;
  }
  /** onClick, step 4 of 15 (the data-hfv part, lines 2892-2904 of the one function): true when it handled the call and nothing else should run */
  function onClickHfv(list, event, ctx) {
    if (ctx.b.hasAttribute('data-hfv')) {
      var filterKey = ctx.b.getAttribute('data-hfk'),
        filterValue = ctx.b.getAttribute('data-hfv');
      if (filterValue) ctx.R.filt[filterKey] = filterValue;
      else delete ctx.R.filt[filterKey];
      list.pop = null;
      resetLimit(list);
      if (query(list)) {
        paintTools(list);
        paintList(list);
      } else paintAll(list);
      return true;
    }
    return false;
  }
  /** a view tab was pressed: its own filters go on (views.merge: only the tab's own keys change, the lit tab pressed again is "all"; otherwise the tab replaces every filter), the popover closes and the list repaints */
  function applyViewTab(list, viewTab, ctx) {
      if (ctx.o.views.merge) {
        /* views.merge: only the tab's own keys change; the lit tab pressed again is "all" (its keys go), every other filter stays in force */
        var wasLit = viewOn(list, viewTab);
        viewKeys(list).forEach(function (item) {
          delete ctx.R.filt[item];
        });
        if (!wasLit)
          Object.keys(viewTab.filt || {}).forEach(function (item) {
            ctx.R.filt[item] = viewTab.filt[item];
          });
      } else {
        ctx.R.filt = {};
        Object.keys(viewTab.filt || {}).forEach(function (item) {
          ctx.R.filt[item] = viewTab.filt[item];
        });
      }
      list.pop = null;
      resetLimit(list);
      paintAll(list);
  }
  /** onClick, step 5 of 15 (the data-view-tab part, lines 2905-2931 of the one function): true when it handled the call and nothing else should run */
  function onClickViewTab(list, event, ctx) {
    if (ctx.b.hasAttribute('data-view-tab')) {
      var vw = ((ctx.o.views && ctx.o.views.items) || []).filter(function (x) {
        return x.key === ctx.b.getAttribute('data-view-tab');
      })[0];
      if (vw) applyViewTab(list, vw, ctx);
      return true;
    }
    return false;
  }
  /** onClick, step 6 of 15 (the data-period part, lines 2932-2953 of the one function): true when it handled the call and nothing else should run */
  function onClickPeriod(list, event, ctx) {
    if (list.pop && !ctx.pop) {
      /* any other click outside the popover closes it, then does its own job */ list.pop = null;
      paintTitle(list);
      paintTools(list);
    }
    ctx.d = ctx.b.dataset || {};
    if (ctx.b.hasAttribute('data-period')) {
      var periodSpec = head(list).period;
      if (periodSpec) {
        list.pv = ctx.d.period;
        if (ctx.d.period !== 'custom') {
          list.pop = null;
          list.pv = null;
        }
        safe(function () {
          periodSpec.onPick(ctx.d.period, null);
        });
        paintTitle(list);
        paintTools(list);
      }
      return true;
    }
    return false;
  }
  /** onClick, step 7 of 15 (part 7, lines 2954-2982 of the one function): true when it handled the call and nothing else should run */
  function onClickStep7(list, event, ctx) {
    if (ctx.d.notice != null) {
      var notice = (head(list).notices || [])[+ctx.d.notice];
      if (list.pop === 'notes') {
        list.pop = null;
        paintTitle(list);
      }
      if (notice && notice.onOpen)
        safe(function () {
          notice.onOpen();
        });
      return true;
    }
    if (ctx.d.group) {
      ctx.s.group = ctx.d.group;
      resetLimit(list);
      saveChoices(list);
      if (!query(list)) {
        paintTools(list);
        paintList(list);
      } else paintTools(list);
      return true;
    }
    if (ctx.d.view) {
      ctx.s.view = ctx.d.view;
      saveChoices(list);
      paintTools(list);
      paintList(list);
      return true;
    }
    return false;
  }
  /** onClick, step 8 of 15 (the data-cbl-needs part, lines 2983-3008 of the one function): true when it handled the call and nothing else should run */
  function onClickCblNeeds(list, event, ctx) {
    if (ctx.b.hasAttribute('data-cbl-needs')) {
      needsToggle(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-needs-next')) {
      needsNext(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-exp')) {
      ctx.R.allOpen = !ctx.R.allOpen;
      ctx.R.open = {};
      paintTools(list);
      paintList(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-csv')) {
      download(list);
      return true;
    }
    if (ctx.d.unfilt) {
      delete ctx.R.filt[ctx.d.unfilt];
      resetLimit(list);
      if (query(list)) paintTools(list);
      else paintAll(list);
      return true;
    }
    return false;
  }
  /** onClick, step 9 of 15 (the data-cbl-clearf part, lines 3009-3037 of the one function): true when it handled the call and nothing else should run */
  function onClickCblClearf(list, event, ctx) {
    if (ctx.b.hasAttribute('data-cbl-clearf')) {
      ctx.R.filt = {};
      resetLimit(list);
      list.pop = null;
      if (query(list)) paintTools(list);
      else paintAll(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-clear')) {
      ctx.R.filt = {};
      ctx.R.q = '';
      list.pop = null;
      resetLimit(list);
      if (query(list)) paintTools(list);
      paintAll(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-retry')) {
      if (ctx.o.onRetry)
        safe(function () {
          ctx.o.onRetry();
        });
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-more')) {
      list.limit += 50;
      paintList(list);
      return true;
    }
    return false;
  }
  /** onClick, step 10 of 15 (the data-cbl-resetcols part, lines 3038-3060 of the one function): true when it handled the call and nothing else should run */
  function onClickCblResetcols(list, event, ctx) {
    if (ctx.b.hasAttribute('data-cbl-resetcols')) {
      ctx.s.cols = null;
      ctx.s.widths = {};
      saveChoices(list);
      paintTools(list);
      paintList(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-selmode')) {
      ctx.R.selMode = !ctx.R.selMode;
      if (!ctx.R.selMode) ctx.R.sel = {};
      paintTools(list);
      paintList(list);
      return true;
    }
    if (ctx.b.hasAttribute('data-cbl-selall')) {
      matched(list).rows.forEach(function (item, index) {
        ctx.R.sel[rowIdOf(list, item, index)] = true;
      });
      paintTools(list);
      paintList(list);
      return true;
    }
    return false;
  }
  /** onClick, step 11 of 15 (part 11, lines 3061-3082 of the one function): true when it handled the call and nothing else should run */
  function onClickStep11(list, event, ctx) {
    if (ctx.d.bulk) {
      var bulkAction = (ctx.o.bulk || []).filter(function (x) {
        return x.id === ctx.d.bulk;
      })[0];
      if (bulkAction)
        safe(function () {
          bulkAction.run(selectedRows(list));
        });
      return true;
    }
    if (ctx.d.mv) {
      var set = shownKeys(list).slice(),
        i = set.indexOf(ctx.d.mv),
        j = i + +ctx.d.d;
      if (i < 0 || j < 0 || j >= set.length) return true;
      set.splice(j, 0, set.splice(i, 1)[0]);
      ctx.s.cols = set;
      saveChoices(list);
      paintTools(list);
      paintList(list);
      return true;
    }
    return false;
  }
  /** onClick, step 12 of 15 (the data-wd part, lines 3083-3090 of the one function): true when it handled the call and nothing else should run */
  function onClickWd(list, event, ctx) {
    if (ctx.d.wd) {
      resize(list, ctx.d.wd, +ctx.d.d * 16, false);
      paintTools(list);
      var again = list.el.querySelector('[data-wd="' + ctx.d.wd + '"][data-d="' + ctx.d.d + '"]');
      if (again) again.focus();
      return true;
    }
    if (ctx.d.col) return true;
    return false;
  }
  /** onClick, step 13 of 15 (part 13, lines 3091-3107 of the one function): true when it handled the call and nothing else should run */
  function onClickStep13(list, event, ctx) {
    /* the checkbox acts on 'change' */
    if (ctx.d.sort) {
      /* a server-sorted page decides its own direction: it is told which heading was clicked */
      if (remote(list)) {
        query(list, 'sort', { key: ctx.d.sort }, true);
        return true;
      }
      var current = curSort(list),
        col = columns(list).filter(function (item) {
          return sortId(item) === ctx.d.sort;
        })[0],
        firstDir = col && col.dir0 === -1 ? -1 : 1;
      ctx.s.sort = current && current.key === ctx.d.sort ? { key: ctx.d.sort, dir: -current.dir } : { key: ctx.d.sort, dir: firstDir };
      resetLimit(list);
      saveChoices(list);
      paintList(list);
      return true;
    }
    return false;
  }
  /** onClick, step 14 of 15 (the data-selrow part, lines 3108-3127 of the one function): true when it handled the call and nothing else should run */
  function onClickSelrow(list, event, ctx) {
    if (ctx.d.act) {
      var action = (ctx.o.actions || []).filter(function (x) {
          return x.id === ctx.d.act;
        })[0],
        row = rowById(list, ctx.d.actrow);
      if (action && row)
        safe(function () {
          action.run(row);
        });
      return true;
    }
    if (ctx.b.hasAttribute('data-selrow')) {
      return true;
    }
    if (ctx.b.hasAttribute('data-caret') || ctx.node.closest('[data-caret]')) {
      var rowNode = ctx.node.closest('[data-row]');
      if (rowNode) toggleRow(list, rowNode.getAttribute('data-row'), false);
      return true;
    }
    ctx.rowEl = ctx.node.closest('[data-row]');
    return false;
  }
  /** onClick, step 15 of 15 (the data-nolist part, lines 3128-3133 of the one function): true when it handled the call and nothing else should run */
  function onClickNolist(list, event, ctx) {
    if (ctx.rowEl && ctx.b === ctx.rowEl) {
      /* a control the page drew inside a cell (a link, a chip, a button with its own onclick) keeps its own job */
      var inner = ctx.node.closest('a,button,input,select,textarea,label,[onclick],[data-nolist]');
      if (inner && inner !== ctx.rowEl && ctx.rowEl.contains(inner)) return true;
      openRow(list, ctx.rowEl.getAttribute('data-row'), event);
    }
    return false;
  }
  function onClick(list, ev) {
  var ctx = {},
    steps = [onClickRow, onClickRow2, onClickRz, onClickHfv, onClickViewTab, onClickPeriod, onClickStep7, onClickCblNeeds, onClickCblClearf, onClickCblResetcols, onClickStep11, onClickWd, onClickStep13, onClickSelrow, onClickNolist];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](list, ev, ctx)) return;
  }
  }
  root.CBListParts.click = { bind: bind, colByKey, cssId, onClick, refocusRz, resize };
})(typeof window !== 'undefined' ? window : this);
