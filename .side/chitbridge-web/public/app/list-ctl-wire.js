/* list-ctl-wire.js — the listeners of a mounted CBList (the change, key and drag half of app/list-ctl.js).
 * OWNS      wire(I) — the click, change, keydown, dblclick and pointer listeners one mounted list puts on its element; onChange (tick boxes, group select, sort, from); onKey (↑ ↓ Enter · Esc · ← → on a column edge);
 *           the column-edge drag (onPointerDown · onPointerMove · onPointerUp) and its refocus and template helpers.
 * CALLED BY app/list-ctl.js (mount → wire; the file calls CBListParts.wire(kit) once, at its end, after CBListParts.click). Loaded BEFORE app/list-ctl.js, after app/list-ctl-click.js.
 * FLOW      a page mounts a list → wire(I) listens → a change or a key or a drag lands → the handler here does that one job; a click is handed to onClick (app/list-ctl-click.js)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/list-control
 * Split out of list-ctl.js (shrink W2, 2026-11-17): behaviour unchanged.
 */
(function (root) {
  'use strict';
  /* root.CBListParts is created by list-ctl-css.js, which loads first */
  var closePop, colByKey, cssId, hasNext, head, isOpen, minW, onClick, openRow, paintList, paintTools, query, refocusRz, resetLimit, resize, safe, saveChoices, setQ, shownCols, shownKeys, template, toggleRow, topKey, widthOf; /* what list-ctl.js hands over through bind: its functions and constants this file works with */
  /** bind: list-ctl.js hands over, once, the names this file works with (the list unit's own functions and constants) */
  function bind(needs) {
    closePop = needs.closePop;
    colByKey = needs.colByKey;
    cssId = needs.cssId;
    hasNext = needs.hasNext;
    head = needs.head;
    isOpen = needs.isOpen;
    minW = needs.minW;
    onClick = needs.onClick;
    openRow = needs.openRow;
    paintList = needs.paintList;
    paintTools = needs.paintTools;
    query = needs.query;
    refocusRz = needs.refocusRz;
    resetLimit = needs.resetLimit;
    resize = needs.resize;
    safe = needs.safe;
    saveChoices = needs.saveChoices;
    setQ = needs.setQ;
    shownCols = needs.shownCols;
    shownKeys = needs.shownKeys;
    template = needs.template;
    toggleRow = needs.toggleRow;
    topKey = needs.topKey;
    widthOf = needs.widthOf;
  }
  var DRAG = null;
  /* ═════ events: one set of delegated listeners on the mount element, so it dies with it ═════ */
  function wire(inst) {
    var el = inst.el;
    /* every listener is remembered so teardown can remove it: a list mounted again on the same element must not leave the old one answering too */
    inst.off = [];
    var on = function (type, fn) {
      var h = function (ev) {
        if (!inst.dead) fn(ev);
      };
      el.addEventListener(type, h);
      inst.off.push([type, h]);
    };
    on('click', function (ev) {
      onClick(inst, ev);
    });
    on('input', function (ev) {
      var t = ev.target;
      if (t.hasAttribute && t.hasAttribute('data-cbl-q')) {
        setQ(inst, t.value);
      }
    });
    on('change', function (ev) {
      onChange(inst, ev);
    });
    on('keydown', function (ev) {
      onKey(inst, ev);
    });
    on('pointerdown', function (ev) {
      onPointerDown(inst, ev);
    });
    on('dblclick', function (ev) {
      var node = ev.target.closest && ev.target.closest('[data-rz]');
      if (!node) return;
      delete inst.s.widths[node.getAttribute('data-rz')];
      saveChoices(inst);
      paintList(inst);
      refocusRz(inst, node.getAttribute('data-rz'));
    });
  }
  /** onChange, step 1 of 4 (the data-col part, lines 3240-3255 of the one function): true when it handled the call and nothing else should run */
  function onChangeCol(list, event, ctx) {
ctx.node = event.target;
ctx.R = list.r;
ctx.s = list.s;
    if (ctx.node.hasAttribute('data-col')) {
      var k = ctx.node.getAttribute('data-col'),
        set = shownKeys(list).slice(),
        i = set.indexOf(k);
      if (ctx.node.checked && i < 0) set.push(k);
      else if (!ctx.node.checked && i >= 0 && k !== topKey(list)) set.splice(i, 1);
      ctx.s.cols = set;
      saveChoices(list);
      paintTools(list);
      paintList(list);
      refocusCol(list, k);
      return true;
    }
    return false;
  }
  /** onChange, step 2 of 4 (the data-gsel part, lines 3256-3280 of the one function): true when it handled the call and nothing else should run */
  function onChangeGsel(list, event, ctx) {
    if (ctx.node.hasAttribute('data-gsel')) {
      ctx.s.group = ctx.node.value;
      resetLimit(list);
      saveChoices(list);
      if (!query(list)) {
        paintTools(list);
        paintList(list);
      } else paintTools(list);
      var groupSelect = list.el.querySelector('#cbl-gsel-' + cssId(list.key));
      if (groupSelect) groupSelect.focus();
      return true;
    }
    if (ctx.node.hasAttribute('data-filt')) {
      var filterKey = ctx.node.getAttribute('data-filt');
      if (ctx.node.value) ctx.R.filt[filterKey] = ctx.node.value;
      else delete ctx.R.filt[filterKey];
      resetLimit(list);
      if (!query(list)) {
        paintTools(list);
        paintList(list);
      } else paintTools(list);
      var filterField = list.el.querySelector('#cbl-f-' + cssId(list.key) + '-' + cssId(filterKey));
      if (filterField) filterField.focus();
      return true;
    }
    return false;
  }
  /** onChange, step 3 of 4 (the data-cbl-sort part, lines 3281-3300 of the one function): true when it handled the call and nothing else should run */
  function onChangeCblSort(list, event, ctx) {
    if (ctx.node.hasAttribute('data-cbl-sort')) {
      var currentDir = ctx.s.sort ? ctx.s.sort.dir : 1;
      ctx.s.sort = { key: ctx.node.value, dir: 1 };
      resetLimit(list);
      saveChoices(list);
      if (!query(list)) {
        paintTools(list);
        paintList(list);
      }
      var sortSelect = list.el.querySelector('#cbl-sort-' + cssId(list.key));
      if (sortSelect) sortSelect.focus();
      return true;
    }
    if (ctx.node.hasAttribute('data-selrow')) {
      var id = ctx.node.getAttribute('data-selrow');
      if (ctx.node.checked) ctx.R.sel[id] = true;
      else delete ctx.R.sel[id];
      paintTools(list);
      return true;
    }
    return false;
  }
  /** onChange, step 4 of 4 (the data-cbl-from part, lines 3301-3313 of the one function): runs on, nothing here ends the call */
  function onChangeCblFrom(list, event, ctx) {
    if (ctx.node.hasAttribute('data-cbl-from') || ctx.node.hasAttribute('data-cbl-to')) {
      var periodSpec = head(list).period,
        fromField = list.el.querySelector('[data-cbl-from]'),
        to = list.el.querySelector('[data-cbl-to]');
      if (periodSpec && fromField && to && fromField.value && to.value) {
        periodSpec.custom = { from: fromField.value, to: to.value };
        list.pv = null;
        list.pop = null;
        safe(function () {
          periodSpec.onPick('custom', periodSpec.custom);
        });
      }
    }
  }
  function onChange(list, ev) {
  var ctx = {},
    steps = [onChangeCol, onChangeGsel, onChangeCblSort, onChangeCblFrom];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](list, ev, ctx)) return;
  }
  }
  function refocusCol(I, k) {
    var node = I.el.querySelector('[data-col="' + k + '"]');
    if (node) node.focus();
  }

  /** onKey, step 1 of 3 (the data-rz part, lines 3344-3357 of the one function): true when it handled the call and nothing else should run */
  function onKeyRz(list, event, ctx) {
ctx.node = event.target;
ctx.k = event.key;
    if (ctx.k === 'Escape' && list.pop) {
      event.preventDefault();
      closePop(list, true);
      return true;
    }
    if (ctx.node.hasAttribute && ctx.node.hasAttribute('data-rz') && (ctx.k === 'ArrowLeft' || ctx.k === 'ArrowRight')) {
      event.preventDefault();
      var rightToLeft = root.getComputedStyle(list.el).direction === 'rtl',
        delta = (ctx.k === 'ArrowRight' ? 8 : -8) * (rightToLeft ? -1 : 1);
      resize(list, ctx.node.getAttribute('data-rz'), delta, true);
      return true;
    }
    return false;
  }
  /** onKey, step 2 of 3 (the data-g part, lines 3358-3363 of the one function): true when it handled the call and nothing else should run */
  function onKeyG(list, event, ctx) {
    if (ctx.node.hasAttribute && ctx.node.hasAttribute('data-g') && (ctx.k === 'Enter' || ctx.k === ' ')) {
      event.preventDefault();
      ctx.node.click();
      return true;
    }
    ctx.rowEl = ctx.node.closest && ctx.node.closest('[data-row]');
    return false;
  }
  /** a key on a focused row: Enter or space opens it, → opens its next level and ← closes it (true when it did one of those) */
  function keyRowOpen(list, event, ctx) {
    var rowKey = ctx.rowEl.getAttribute('data-row');
    if (ctx.k === 'Enter' || ctx.k === ' ') {
      event.preventDefault();
      openRow(list, rowKey, event);
      return true;
    }
    if (ctx.k === 'ArrowRight' && hasNext(list) && !isOpen(list, rowKey)) {
      event.preventDefault();
      toggleRow(list, rowKey, true);
      return true;
    }
    if (ctx.k === 'ArrowLeft' && hasNext(list) && isOpen(list, rowKey)) {
      event.preventDefault();
      toggleRow(list, rowKey, true);
      return true;
    }
    return false;
  }
  /** ↓ and ↑ on a focused row: the next or previous row takes focus and the highlight (nothing else runs after it) */
  function keyRowMove(list, event, ctx) {
    if (ctx.k !== 'ArrowDown' && ctx.k !== 'ArrowUp') return;
    event.preventDefault();
    var all = [].slice.call(list.el.querySelectorAll('[data-row]')),
      at = all.indexOf(ctx.rowEl),
      neighbour = all[at + (ctx.k === 'ArrowDown' ? 1 : -1)];
    if (!neighbour) return;
    neighbour.focus();
    if (list.o.hl === false) return;
    list.r.hl = neighbour.getAttribute('data-row');
    [].forEach.call(list.el.querySelectorAll('.cbl-row.sel,.cbl-lrec.sel'), function (element) {
      element.classList.remove('sel');
    });
    neighbour.classList.add('sel');
  }
  /** onKey, step 3 of 3 (the data-row part, lines 3364-3395 of the one function): true when it handled the call and nothing else should run */
  function onKeyRow(list, event, ctx) {
    if (!(ctx.rowEl && ctx.node === ctx.rowEl)) return false;
    if (keyRowOpen(list, event, ctx)) return true;
    keyRowMove(list, event, ctx);
    return false;
  }
  function onKey(list, event) {
  var ctx = {},
    steps = [onKeyRz, onKeyG, onKeyRow];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](list, event, ctx)) return;
  }
  }

  function applyTpl(I) {
    var tpl = template(I, shownCols(I));
    [].forEach.call(I.el.querySelectorAll('.cbl-hdr,.cbl-row'), function (node) {
      node.style.gridTemplateColumns = tpl;
    });
  }
  function onPointerDown(inst, event) {
    var node = event.target.closest && event.target.closest('[data-rz]');
    if (!node) return;
    var column = colByKey(inst, node.getAttribute('data-rz'));
    if (!column) return;
    event.preventDefault();
    DRAG = { I: inst, key: column.key, x: event.clientX, w: widthOf(inst, column), c: column, btn: node };
    node.classList.add('drag');
    try {
      node.setPointerCapture(event.pointerId);
    } catch (failure) {
      /* best effort: a pointer that cannot be captured changes nothing the user sees; the drag still follows the document's pointer events */
      if (root.console && root.console.debug) root.console.debug('cbl pointer capture', failure && failure.name);
    }
    root.document.addEventListener('pointermove', onPointerMove);
    root.document.addEventListener('pointerup', onPointerUp);
    root.document.addEventListener('pointercancel', onPointerUp);
  }
  function onPointerMove(ev) {
    if (!DRAG) return;
    var I = DRAG.I,
      rtl = root.getComputedStyle(I.el).direction === 'rtl';
    I.s.widths[DRAG.key] = Math.max(minW(I, DRAG.c), DRAG.w + (ev.clientX - DRAG.x) * (rtl ? -1 : 1));
    applyTpl(I);
  }
  function onPointerUp() {
    if (!DRAG) return;
    var I = DRAG.I;
    DRAG.btn.classList.remove('drag');
    root.document.removeEventListener('pointermove', onPointerMove);
    root.document.removeEventListener('pointerup', onPointerUp);
    root.document.removeEventListener('pointercancel', onPointerUp);
    DRAG = null;
    saveChoices(I);
  }
  root.CBListParts.wire = { bind: bind, wire };
})(typeof window !== 'undefined' ? window : this);
