/* engine/chart-draw.js — CBDraw: THE ONE SMALL CHART HELPER, inline SVG, no library (RPT2, 2026-10-17).
 * CARD 26-reporting-mis-and-bi/charts
 *
 * SPLIT (shrink W2, 2026-11-17): this file is the CORE — bars, spark, the palette and CBDraw.kit (the helpers the parts draw with). statusBar · monthStrip live in engine/chart-draw-status.js;
 * compare · hbars · cashLine · changeText live in engine/chart-draw-rows.js. A page loads the core first, then the parts it draws with (all three are one CBDraw).
 *
 * OWNS      bars(points, opts) — bars from zero, an optional dashed "same time last year" line with hollow dots, a hatched bar for part of a
 *           period, an empty tick for a period with no record (opts.actual / opts.previous = the measured colours of the bars and of the previous line) · spark(values, opts) — a sparkline with its last
 *           point dotted (REP-36: opts.title + opts.desc add a <title>/<desc>) · statusBar(parts, opts) — stacked good/watch/help with figures · monthStrip(months, opts) —
 *           12 small squares locked/open/running · palette(vars, contrast) — actual/previous/accent/good/watch/bad measured per theme.
 *           hbars(rows, opts) — ranked or bucketed horizontal bars, the figure at the end (MISCH) · cashLine(points, opts) — the days-ahead balance as one line, its ends and the server's lowest day labelled (MISCH).
 * CALLED BY app/cap-mis-trend.js (CB Finance › Reports › Trend) · app/shell.js (the Till card's teaser on Home) · e2e/chart-draw.test.cjs · public/chart-sample.html (REP-36 theme sample).
 * FLOW      R2R · reports — the server's figures in → an SVG string out. It computes NO figure: heights are geometry, the words are the caller's.
 *
 * Lifted from the two private renderers SPEC-charts found (docs/26-reporting-mis-and-bi/SPEC-charts.md "no shared helper"): fcChart
 * (app/cap-finance-cash.js — bars, the zero line, a <title> per bar, the inline sizes that beat the page's svg icon rule) and _misSpark
 * (app/cap-admin.js — the sparkline and its last dot). Pointing those two here is their owners' follow-up (finance · the workshop MIS).
 * Rules (SPEC-charts): no invented shape (< 2 points → ''), tokens only as var(--x,#fallback), role="img" + aria-label from the caller,
 * bars always start at zero, labels never collide (every k-th), never colour alone (hatch · dash · hollow dot · an empty tick all differ in SHAPE).
 */
(function (root) {
  'use strict';
  var BAR = 'var(--green-d,#1f6b46)',
    LAST_YEAR = 'var(--muted,#6f6450)',
    BASELINE = 'var(--line-3,#d8ccb0)',
    DOT_FILL = 'var(--card,#fffdf8)',
    LABEL = 'var(--muted,#6f6450)';
  var LABEL_GAP = 44; /* px between two axis labels, so they never collide */
  var PAD_TOP = 16,
    PAD_BOTTOM = 20; /* room for the scale words above and the labels below */

  var escape = root.esc; /* app/helpers.js — the ONE esc; every page that loads this loads helpers.js first */
  function figure(value) {
    return value === null || value === undefined || !isFinite(Number(value)) ? null : Number(value);
  }

  /** the vertical scale over every figure drawn (bars and line), always including zero */
  function scaleOf(points) {
    var high = 0,
      lowest = 0;
    points.forEach(function (point) {
      [figure(point.value), figure(point.line)].forEach(function (value) {
        if (value !== null) {
          high = Math.max(high, value);
          lowest = Math.min(lowest, value);
        }
      });
    });
    return { high: high, low: lowest, span: high - lowest || 1 };
  }

  /** the empty tick drawn where a period has no record: a dashed stub on the baseline */
  function missingBarOf(left, barTestId, title, layout) {
    return (
      '<g data-testid="' +
      barTestId +
      '" data-state="missing">' +
      title +
      '<rect x="' +
      left.toFixed(1) +
      '" y="' +
      (layout.zero - 4).toFixed(1) +
      '" width="' +
      layout.width +
      '" height="4" style="fill:none;stroke:' +
      BASELINE +
      ';stroke-width:1;stroke-dasharray:2 2"/></g>'
    );
  }

  /** one bar: a filled rect, a hatched outline (part of a period) or an empty tick (no record) — its <title> is the caller's words */
  function barOf(point, index, layout, testId) {
    var value = figure(point.value),
      left = index * layout.step + (layout.step - layout.width) / 2,
      barTestId = escape(testId + '-bar-' + point.key),
      title = '<title>' + escape(point.title || '') + '</title>';
    if (value === null) return missingBarOf(left, barTestId, title, layout);
    var height = Math.max(1, Math.abs(layout.yOf(value) - layout.zero)),
      top = value >= 0 ? layout.zero - height : layout.zero;
    var look = point.hatch ? 'fill:url(#' + layout.id + '-hatch);stroke:' + layout.actual + ';stroke-width:1.5' : 'fill:' + layout.actual;
    return (
      '<rect x="' +
      left.toFixed(1) +
      '" y="' +
      top.toFixed(1) +
      '" width="' +
      layout.width +
      '" height="' +
      height.toFixed(1) +
      '" rx="2" data-testid="' +
      barTestId +
      '" data-state="' +
      (point.hatch ? 'partial' : 'full') +
      '" style="' +
      look +
      '">' +
      title +
      '</rect>'
    );
  }

  /** the dashed last-year line through every point that has one, broken where one is missing, with a hollow dot on each */
  function lineOf(points, layout) {
    var path = '',
      dots = '',
      penDown = false;
    points.forEach(function (point, index) {
      var value = figure(point.line);
      if (value === null) {
        penDown = false;
        return;
      }
      var across = (index * layout.step + layout.step / 2).toFixed(1),
        down = layout.yOf(value).toFixed(1);
      path += (penDown ? ' L' : ' M') + across + ' ' + down;
      penDown = true;
      dots +=
        '<circle cx="' +
        across +
        '" cy="' +
        down +
        '" r="2.5" style="fill:' +
        DOT_FILL +
        ';stroke:' +
        layout.previous +
        ';stroke-width:1.5"><title>' +
        escape(point.lineTitle || '') +
        '</title></circle>';
    });
    return path
      ? '<path d="' + path.trim() + '" data-testid="cd-lastyear" style="fill:none;stroke:' + layout.previous + ';stroke-width:1.5;stroke-dasharray:4 3"/>' + dots
      : '';
  }

  /** the labels under the bars: every k-th, counted from the newest so the latest always has its label */
  function labelsOf(points, layout, chartHeight) {
    var every = Math.max(1, Math.ceil(LABEL_GAP / layout.step)),
      count = points.length;
    return points
      .map(function (point, index) {
        if ((count - 1 - index) % every) return '';
        return (
          '<text x="' +
          (index * layout.step + layout.step / 2).toFixed(1) +
          '" y="' +
          (chartHeight - 5) +
          '" text-anchor="middle" style="font:10px var(--mono,monospace);fill:' +
          LABEL +
          '">' +
          escape(point.label || '') +
          '</text>'
        );
      })
      .join('');
  }

  /** where everything sits: the bar step and width, the y of a figure, the zero line */
  function geometryOf(points, width, height, id) {
    var scale = scaleOf(points),
      plot = height - PAD_TOP - PAD_BOTTOM,
      step = width / points.length;
    var layout = {
      id: id,
      step: step,
      width: Math.max(2, Math.floor(step * 0.7)),
      yOf: function (value) {
        return PAD_TOP + ((scale.high - value) / scale.span) * plot;
      }
    };
    layout.zero = layout.yOf(0);
    return layout;
  }

  /** the diagonal-hatch pattern that fills a part-period bar (its id is unique per chart) */
  function hatchDefs(id, colour) {
    return (
      '<defs><pattern id="' +
      id +
      '-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" style="stroke:' +
      colour +
      ';stroke-width:1.5"/></pattern></defs>'
    );
  }

  /** the horizontal rule at zero that every bar stands on */
  function zeroLineOf(width, layout) {
    return (
      '<line x1="0" x2="' +
      width +
      '" y1="' +
      layout.zero.toFixed(1) +
      '" y2="' +
      layout.zero.toFixed(1) +
      '" style="stroke:' +
      BASELINE +
      ';stroke-width:1"/>'
    );
  }

  /** the size, ids and colours of a bars chart, each with its default (REP-36: a caller that measured the colours passes them) */
  function barsSettings(options) {
    return {
      width: options.width || 640,
      height: options.height || 170,
      id: escape(options.id || 'cd'),
      testId: options.tid || 'cd',
      actual: options.actual || BAR,
      previous: options.previous || LAST_YEAR
    };
  }
  /**
   * bars(points, opts) → '<svg …>' — points [{ key, label, value|null, line|null, hatch, title, lineTitle }] oldest first;
   * opts { width, height, id (unique per page: the hatch pattern's id), aria (the sentence a screen reader hears), tid, top (words at the top-left: the scale) }.
   * No points → ''. Sizes are inline: the page's icon rule (svg{width:18px}) would otherwise shrink the chart to an icon.
   */
  function bars(points, opts) {
    var options = opts || {},
      list = points || [];
    if (!list.length) return '';
    var settings = barsSettings(options),
      width = settings.width,
      height = settings.height,
      id = settings.id,
      testId = settings.testId;
    var layout = geometryOf(list, width, height, id);
    layout.actual = settings.actual;
    layout.previous = settings.previous; /* REP-36: a caller that measured the previous colour (palette) passes it; the Trend page does not */
    var hatch = hatchDefs(id, layout.actual);
    var scaleWords = options.top ? '<text x="0" y="10" style="font:10px var(--mono,monospace);fill:' + LABEL + '">' + escape(options.top) + '</text>' : '';
    return (
      '<svg viewBox="0 0 ' +
      width +
      ' ' +
      height +
      '" role="img" aria-label="' +
      escape(options.aria || '') +
      '" data-testid="' +
      escape(testId + '-chart') +
      '"' + codeAttr(options.codes, 'chart') + ' style="display:block;width:100%;height:' +
      height +
      'px;overflow:visible;stroke:none;fill:none">' +
      hatch +
      scaleWords +
      zeroLineOf(width, layout) +
      list
        .map(function (point, index) {
          return barOf(point, index, layout, testId);
        })
        .join('') +
      lineOf(list, layout) +
      labelsOf(list, layout, height) +
      '</svg>'
    );
  }

  /**
   * spark(values, opts) → '<svg …>' — values oldest first, null = no record (the line breaks there); opts { width 64, height 18, stroke (a var()), aria, tid }.
   * Fewer than 2 figures → '' (SPEC-charts rule 1: no invented shape). The scale starts at zero, as the bars do.
   */
  function spark(values, opts) {
    var options = opts || {},
      list = (values || []).map(figure),
      have = list.filter(function (value) {
        return value !== null;
      });
    if (have.length < 2) return '';
    var width = options.width || 64,
      height = options.height || 18,
      high = Math.max.apply(null, have.concat([0])) || 1,
      stroke = options.stroke || BAR;
    var pointAt = function (index) {
      return [
        (2 + (index * (width - 4)) / Math.max(1, list.length - 1)).toFixed(1),
        (height - 2 - (Math.max(0, list[index]) / high) * (height - 4)).toFixed(1)
      ];
    };
    var path = '',
      penDown = false,
      last = null;
    list.forEach(function (value, index) {
      if (value === null) {
        penDown = false;
        return;
      }
      var at = pointAt(index);
      path += (penDown ? ' L' : ' M') + at[0] + ' ' + at[1];
      penDown = true;
      last = at;
    });
    return sparkSvg(width, height, options, path, last, stroke);
  }

  /** REP-36: a sparkline that is given opts.title / opts.desc also carries them as <title> and <desc> (the text equivalent of its figures); without them nothing changes */
  function sparkWords(options) {
    if (!options.title && !options.desc) return '';
    return '<title>' + escape(options.title || '') + '</title><desc>' + escape(options.desc || '') + '</desc>';
  }

  /** the sparkline's svg wrapper: its path and the dot on the last point */
  function sparkSvg(width, height, options, path, last, stroke) {
    return (
      '<svg viewBox="0 0 ' +
      width +
      ' ' +
      height +
      '" width="' +
      width +
      '" height="' +
      height +
      '" role="img" aria-label="' +
      escape(options.aria || '') +
      '" data-testid="' +
      escape(options.tid || 'cd-spark') +
      '" style="display:inline-block;vertical-align:middle;width:' +
      width +
      'px;height:' +
      height +
      'px;overflow:visible;fill:none;stroke:none">' +
      sparkWords(options) +
      '<path d="' +
      path.trim() +
      '" style="fill:none;stroke:' +
      stroke +
      ';stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"/>' +
      '<circle cx="' +
      last[0] +
      '" cy="' +
      last[1] +
      '" r="2.2" style="fill:' +
      stroke +
      '"/></svg>'
    );
  }

  /* ── REP-36 (16 Nov): the palette, the status bar and the month strip, beside bars and spark. The caller passes numbers and WORDS (money already
   *    through the M36 unit by the caller); nothing here formats money or fetches. Each svg carries role="img", a <title>, a <desc> that is the
   *    text equivalent of every figure, and a <title> on each part. Colours: ink for actual, a mix of ink and page for previous (cleared to 3:1),
   *    the accent-text for the ONE accent, and good / watch / bad as fixed meanings (light and dark variant), never a theme's blue or red. ── */
  var FIXED = {
    light: { good: '#1F6B46', watch: '#8A5A00', bad: '#B3402A' },
    dark: { good: '#5CC08A', watch: '#E0A838', bad: '#F08068' }
  };
  var PREV_FROM = 55,
    PREV_STEP = 5,
    NEED_PREVIOUS = 3;

  function rgbOf(text) {
    var value = String(text).trim();
    if (/^#/.test(value)) {
      value = value.slice(1);
      if (value.length === 3) value = value.replace(/./g, '$&$&');
      return [0, 2, 4].map(function (at) {
        return parseInt(value.substr(at, 2), 16);
      });
    }
    return (value.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  }
  /** WCAG contrast of two resolved colours: the fallback paletteNow uses on a page that does not load ui-standard.js (the Home); the same formula, and a theme sweep proves both agree */
  function contrastRatio(first, second) {
    var lum = function (text) {
      var c = rgbOf(text).map(function (v) {
        var u = v / 255;
        return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    return (Math.max(lum(first), lum(second)) + 0.05) / (Math.min(lum(first), lum(second)) + 0.05);
  }
  /** `percent` of the first colour over the rest of the second: what CSS color-mix(in srgb, a percent, b) paints */
  function blendColours(first, second, percent) {
    var fromRgb = rgbOf(first),
      toRgb = rgbOf(second);
    return (
      'rgb(' +
      fromRgb
        .map(function (value, at) {
          return Math.round((value * percent) / 100 + (toRgb[at] * (100 - percent)) / 100);
        })
        .join(',') +
      ')'
    );
  }
  function isDark(page, contrast) {
    return contrast(page, 'rgb(0,0,0)') < contrast(page, 'rgb(255,255,255)');
  }
  /**
   * palette(vars, contrast) → { actual, previous, previousMix, accent, good, watch, bad, dark, fellBack: [names] } — vars { ink, page, card, accent } are resolved
   * colours; `contrast` is ui-standard's contrastRatio (the one measure, passed in so this file stays loadable alone). previous starts at 55% ink over page
   * and rises in steps of 5 until it clears 3:1 on BOTH the page and the card (a 45% mix failed on 11 of 16 themes); the accent drops to ink when it
   * cannot clear 3:1; good / watch / bad are fixed per light or dark and are listed in fellBack if a theme's page still defeats them.
   */
  function palette(vars, contrast) {
    var clears = function (colour) {
      return [vars.page, vars.card].every(function (ground) {
        return contrast(colour, ground) >= NEED_PREVIOUS;
      });
    };
    var percent = PREV_FROM;
    while (percent < 100 && !clears(blendColours(vars.ink, vars.page, percent))) percent += PREV_STEP;
    var dark = isDark(vars.page, contrast),
      kinds = dark ? FIXED.dark : FIXED.light,
      fellBack = [];
    if (percent > PREV_FROM) fellBack.push('previous');
    var accent = vars.accent && clears(vars.accent) ? vars.accent : vars.ink;
    if (accent !== vars.accent) fellBack.push('accent');
    var out = { actual: vars.ink, previous: blendColours(vars.ink, vars.page, percent), previousMix: percent, accent: accent, dark: dark, fellBack: fellBack };
    ['good', 'watch', 'bad'].forEach(function (name) {
      out[name] = kinds[name];
      if (!clears(kinds[name])) fellBack.push(name);
    });
    return out;
  }
  /** the palette of the theme on the page now, or on `element` (the avatar's tokens, resolved; an unset token falls to Cream's own value). Needs a browser and a contrast function. */
  function paletteNow(contrast, element) {
    var style = getComputedStyle(element || document.documentElement),
      read = function (name, fallback) {
        return style.getPropertyValue(name).trim() || fallback;
      };
    return palette(
      { ink: read('--ink', '#2a2418'), page: read('--paper', read('--page', '#FCFAF5')), card: read('--card', '#fffdf8'), accent: read('--accent-text', read('--accent', '#1f5f5b')) },
      contrast || (root.CBUiStandard && root.CBUiStandard.contrastRatio) || contrastRatio
    );
  }

  /** the custom properties a palette sets on its svg, so shapes read var(--rp-…); with no palette the tokens themselves drive it (55% previous mix) */
  function paletteStyle(colours) {
    var chosen = colours || {
      actual: 'var(--ink,#2a2418)',
      previous: 'color-mix(in srgb,var(--ink,#2a2418) 55%,var(--page,#FCFAF5))',
      accent: 'var(--accent-text,#1f5f5b)',
      good: FIXED.light.good,
      watch: FIXED.light.watch,
      bad: FIXED.light.bad
    };
    return '--rp-actual:' + chosen.actual + ';--rp-previous:' + chosen.previous + ';--rp-accent:' + chosen.accent + ';--rp-good:' + chosen.good + ';--rp-watch:' + chosen.watch + ';--rp-bad:' + chosen.bad;
  }

  /** E17 (Athi 2 Nov: every UI element has a code, on the element): the CALLER passes opts.codes { chart, part, legend } (register codes, written as data-cbsid); CBDraw knows none, so it stays generic. A role not passed writes nothing. */
  function codeAttr(codes, role) {
    return codes && codes[role] ? ' data-cbsid="' + escape(codes[role]) + '"' : '';
  }

  /** the accessible head every new svg shares: role, a <title>, a <desc> (the text equivalent), and the inline size the page's svg icon rule would otherwise crush */
  function accessibleSvg(width, height, options, inner) {
    var id = escape(options.id);
    return (
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="' + id + '-t ' + id + '-d" data-testid="' + escape(options.tid) + '"' + codeAttr(options.codes, 'chart') +
      ' style="display:block;width:100%;max-width:' + width + 'px;height:auto;aspect-ratio:' + width + '/' + height + ';overflow:visible;stroke:none;fill:none;' + paletteStyle(options.palette) +
      '"><title id="' + id + '-t">' + escape(options.title || '') + '</title><desc id="' + id + '-d">' + escape(options.desc || '') + '</desc>' + inner + '</svg>'
    );
  }

  var CBDraw = {
    bars: bars,
    spark: spark,
    palette: palette,
    paletteNow: paletteNow,
    contrastRatio: contrastRatio,
    paletteStyle: paletteStyle,
    geometry: {},
    mix: blendColours,
    /* what the parts (chart-draw-status.js, chart-draw-rows.js) draw with: the one escape, the carried-figure reader, the code attribute, the accessible svg head, the hatch pattern */
    kit: { escape: escape, figure: figure, codeAttr: codeAttr, accessibleSvg: accessibleSvg, hatchDefs: hatchDefs }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CBDraw;
  if (root) root.CBDraw = CBDraw;
})(typeof window !== 'undefined' ? window : globalThis);
