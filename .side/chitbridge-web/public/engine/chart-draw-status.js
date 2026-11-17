/* engine/chart-draw-status.js — CBDraw part: the status bar and the month strip (REP-36).
 * CARD 26-reporting-mis-and-bi/charts
 *
 * OWNS      CBDraw.statusBar(parts, opts) — stacked good / watch / help with figures · CBDraw.monthStrip(months, opts) — 12 small squares locked / open / running ·
 *           CBDraw.geometry.status / .strip — the same geometry the tests read. Draws only: every figure and word arrives carried.
 * CALLED BY app/shell.js (the Till card's teaser) · app/cap-mis-trend.js · e2e/chart-draw.test.cjs · public/chart-sample.html — loaded AFTER engine/chart-draw.js (the core, which owns CBDraw.kit).
 * FLOW      the caller's parts / months in → an SVG string out; no figure is computed here.
 * Split out of chart-draw.js (shrink W2, 2026-11-17): behaviour unchanged, same names on the same CBDraw object.
 */
(function (root) {
  'use strict';
  var CBDraw = root.CBDraw;
  if (!CBDraw || !CBDraw.kit) return; /* chart-draw.js loads first */
  var drawKit = CBDraw.kit;
  var escape = drawKit.escape;
  var figure = drawKit.figure;
  var codeAttr = drawKit.codeAttr;
  var accessibleSvg = drawKit.accessibleSvg;

  var KIND_VAR = { good: 'var(--rp-good)', watch: 'var(--rp-watch)', help: 'var(--rp-bad)' };
  var STATUS_GAP = 2,
    STATUS_BAR = 14,
    STATUS_TEXT_AT = 28,
    STATUS_MIN_LABEL = 30,
    STATUS_MIN_W = 16;

  /** statusGeometry(parts, width) → [{ kind, x, w, mid, part }] — a part with no count is left out; widths share `width` less the gaps in proportion to the counts. */
  function statusGeometry(parts, width) {
    var shown = (parts || []).filter(function (part) {
      return figure(part.value) !== null && Number(part.value) > 0;
    });
    var total = shown.reduce(function (sum, part) {
      return sum + Number(part.value);
    }, 0);
    var room = width - STATUS_GAP * Math.max(0, shown.length - 1),
      at = 0;
    /* a small part keeps a floor wide enough to see and to carry its figure (E17); the others share what is left in proportion */
    var floor = {}, left = room, rest = total;
    for (var again = true; again && rest > 0; ) {
      again = false;
      shown.forEach(function (part, i) {
        if (floor[i] || (Number(part.value) / rest) * left >= STATUS_MIN_W) return;
        floor[i] = true; left -= STATUS_MIN_W; rest -= Number(part.value); again = true;
      });
    }
    return shown.map(function (part, i) {
      var w = floor[i] ? STATUS_MIN_W : rest > 0 ? (Number(part.value) / rest) * left : room / shown.length,
        box = { kind: part.kind, x: at, w: w, mid: at + w / 2, part: part };
      at += w + STATUS_GAP;
      return box;
    });
  }
  /** one part's shape: solid = good, diagonal hatch = watch, dots = help, so a colour-blind reader still tells them apart */
  function statusShape(box, id, codes) {
    var common = ' x="' + box.x.toFixed(1) + '" y="0" width="' + box.w.toFixed(1) + '" height="' + STATUS_BAR + '" rx="2"';
    var title = '<title>' + escape(box.part.label || '') + '</title>';
    var base = '<rect' + common + ' style="fill:' + (KIND_VAR[box.kind] || KIND_VAR.help) + '" data-kind="' + escape(box.kind) + '"' + codeAttr(codes, 'part') + '>' + title + '</rect>';
    if (box.kind === 'good') return base;
    return base + '<rect' + common + ' style="fill:url(#' + id + (box.kind === 'watch' ? '-w' : '-h') + ')"/>';
  }
  function statusDefs(id) {
    return (
      '<defs><pattern id="' + id + '-w" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" style="fill:var(--card,#fffdf8)"/></pattern>' +
      '<pattern id="' + id + '-h" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1" style="fill:var(--card,#fffdf8)"/></pattern></defs>'
    );
  }
  /** the figures under the bar: each part's figure (and its short words when the part is wide enough), skipped where it would touch the last one drawn */
  function statusTexts(boxes, width, codes) {
    var lastEnd = -1;
    return boxes
      .map(function (box) {
        var text = box.part.figure !== undefined ? String(box.part.figure) : String(box.part.value),
          words = box.w >= STATUS_MIN_LABEL && box.part.short ? ' ' + box.part.short : '',
          size = (text.length + words.length) * 6.5,
          mid = Math.min(Math.max(box.mid, size / 2), width - size / 2), /* never past either edge of the viewBox */
          left = mid - size / 2;
        if (left < lastEnd + 4) return '';
        lastEnd = left + size;
        return '<text x="' + mid.toFixed(1) + '" y="' + STATUS_TEXT_AT + '" text-anchor="middle"' + codeAttr(codes, 'legend') + ' style="font:11px var(--mono,monospace);fill:var(--rp-actual)">' + escape(text + words) + '</text>';
      })
      .join('');
  }
  /**
   * statusBar(parts, opts) → '<svg …>' — parts [{ kind: 'good'|'watch'|'help', value (a count), label (the full words, for the part's title and the <desc>),
   * figure (what is printed under it; default the count), short (words printed beside it when it is wide) }]; opts { width 320, id, tid, title, desc, palette }.
   * The <desc> is built from the labels: "label, label, …". No part with a count → '' (no invented shape).
   */
  function statusBar(parts, opts) {
    var options = opts || {},
      width = options.width || 320,
      id = options.id || 'cd-status',
      boxes = statusGeometry(parts, width);
    if (!boxes.length) return '';
    var desc =
      options.desc ||
      boxes
        .map(function (box) {
          return box.part.label || String(box.part.value);
        })
        .join(', ');
    var inner =
      statusDefs(escape(id)) +
      boxes
        .map(function (box) {
          return statusShape(box, escape(id), options.codes);
        })
        .join('') +
      statusTexts(boxes, width, options.codes);
    return accessibleSvg(width, STATUS_TEXT_AT + 6, { id: id, tid: options.tid || 'cd-status', title: options.title, desc: desc, palette: options.palette, codes: options.codes }, inner);
  }

  var STRIP = { size: 18, gap: 4, labelAt: 30 };
  var STRIP_WORDS = { locked: 'locked', open: 'open', running: 'running' };
  /** stripGeometry(months, size, gap) → [{ x, y, size, month }] */
  function stripGeometry(months, size, gap) {
    return (months || []).map(function (month, index) {
      return { x: index * (size + gap), y: 1, size: size, month: month };
    });
  }
  function stateOf(month) {
    return STRIP_WORDS[month.state] ? month.state : 'open';
  }
  /** one square: locked = filled ink, open = hollow muted outline, running = hollow accent outline with a dot, so the three differ in shape as well as colour */
  function stripSquare(cell, words, codes) {
    var state = stateOf(cell.month),
      half = cell.size / 2,
      title = '<title>' + escape((cell.month.label || '') + ': ' + ((words || STRIP_WORDS)[state] || STRIP_WORDS[state])) + '</title>',
      common = ' x="' + (cell.x + 1) + '" y="' + cell.y + '" width="' + (cell.size - 2) + '" height="' + (cell.size - 2) + '" rx="2" data-state="' + state + '"' + codeAttr(codes, 'part');
    if (state === 'locked') return '<rect' + common + ' style="fill:var(--rp-actual)">' + title + '</rect>';
    if (state === 'open') return '<rect' + common + ' style="fill:none;stroke:var(--rp-previous);stroke-width:1.5">' + title + '</rect>';
    return (
      '<rect' + common + ' style="fill:none;stroke:var(--rp-accent);stroke-width:2">' + title + '</rect>' +
      '<circle cx="' + (cell.x + half) + '" cy="' + (cell.y + half - 1) + '" r="2.5" style="fill:var(--rp-accent)"/>'
    );
  }
  /** the <desc> of the strip: "Jan: locked, Feb: open, …" in the caller's words */
  function stripDesc(cells, words) {
    return cells
      .map(function (cell) {
        return (cell.month.label || '') + ': ' + (words[stateOf(cell.month)] || STRIP_WORDS[stateOf(cell.month)]);
      })
      .join(', ');
  }
  /** the label under each square, or '' when the caller did not ask for labels */
  function stripLabels(cells, options) {
    if (!options.labels) return '';
    return cells
      .map(function (cell) {
            return '<text x="' + (cell.x + cell.size / 2) + '" y="' + STRIP.labelAt + '" text-anchor="middle"' + codeAttr(options.codes, 'legend') + ' style="font:9px var(--mono,monospace);fill:var(--rp-actual)">' + escape(cell.month.label || '') + '</text>';
      })
      .join('');
  }
  /**
   * monthStrip(months, opts) → '<svg …>' — months [{ label (short: "Nov"), state: 'locked'|'open'|'running' }] oldest first (the caller passes 12);
   * opts { size 18, gap 4, id, tid, title, desc, words { locked, open, running } (the caller's translated words), labels (true draws each label), palette }.
   * The <desc> reads "Jan: locked, Feb: open, …". No months → ''.
   */
  function monthStrip(months, opts) {
    var options = opts || {},
      cells = stripGeometry(months, options.size || STRIP.size, options.gap || STRIP.gap);
    if (!cells.length) return '';
    var width = cells[cells.length - 1].x + cells[cells.length - 1].size;
    var desc = options.desc || stripDesc(cells, options.words || STRIP_WORDS);
    var inner =
      cells
        .map(function (cell) {
          return stripSquare(cell, options.words, options.codes);
        })
        .join('') + stripLabels(cells, options);
    var height = options.labels ? STRIP.labelAt + 4 : cells[0].size + 2;
    return accessibleSvg(width, height, { id: options.id || 'cd-strip', tid: options.tid || 'cd-strip', title: options.title, desc: desc, palette: options.palette, codes: options.codes }, inner);
  }

  CBDraw.statusBar = statusBar;
  CBDraw.monthStrip = monthStrip;
  CBDraw.geometry.status = statusGeometry;
  CBDraw.geometry.strip = stripGeometry;
})(typeof window !== 'undefined' ? window : globalThis);
