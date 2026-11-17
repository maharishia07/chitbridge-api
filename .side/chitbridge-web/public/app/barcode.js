/* CBBarcode — Code 128 as inline SVG, no dependency, no network.
 *
 * OWNS      CBBarcode.code128(text): the Code 128 SVG of a SKU (set B text, set C digit runs, checksum, quiet zones); nothing else
 * FLOW      text -> encode (set B or C) -> checksum -> bar pattern -> inline SVG string {svg, ok, reason}
 *
 * WHY THIS EXISTS (observation-4 §, 2026-09-03: "barcode"): a trader wants to print the SKU on a label and scan it back
 * at the counter. Code 128 is the symbology every handheld scanner reads, it encodes the full ASCII an SKU can contain,
 * and it needs no registration — unlike EAN-13/GS1, whose digits are ASSIGNED (a GS1 company prefix is bought). So:
 * an INTERNAL barcode of the SKU today; a GS1 GTIN is a different symbology AND a different governance (the prefix
 * comes from GS1, not from us) — catalogue-standards backlog, not a rendering question.
 *
 * ⚠️ ADOPT-DON'T-REINVENT NOTE: JsBarcode does this and more. It was not pulled in because this needs ONE symbology and
 * the app ships no bundler — 80 lines beat a 30KB vendor file for one tab. Swap for the library the day EAN/GS1 lands.
 *
 * CBBarcode.code128(text) → { svg, ok, reason }. Code set B for text, set C for runs of digits (halves the width of a
 * numeric SKU), checksum per the spec, quiet zones included. Pure — e2e/barcode-check.cjs verifies the pattern table
 * by the symbology's own invariants (11 modules, even bar parity) so a transcription slip cannot ship silently.
 
 * CALLED BY public/app.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * CARD      09-counter/scale-weigh-scan
 */
(function (root) {
  'use strict';
  /* 107 patterns × 6 widths (bar,space,bar,space,bar,space); index = symbol value. Stop (106) carries its 7th bar. */
  var list = [
    '212222',
    '222122',
    '222221',
    '121223',
    '121322',
    '131222',
    '122213',
    '122312',
    '132212',
    '221213',
    '221312',
    '231212',
    '112232',
    '122132',
    '122231',
    '113222',
    '123122',
    '123221',
    '223211',
    '221132',
    '221231',
    '213212',
    '223112',
    '312131',
    '311222',
    '321122',
    '321221',
    '312212',
    '322112',
    '322211',
    '212123',
    '212321',
    '232121',
    '111323',
    '131123',
    '131321',
    '112313',
    '132113',
    '132311',
    '211313',
    '231113',
    '231311',
    '112133',
    '112331',
    '132131',
    '113123',
    '113321',
    '133121',
    '313121',
    '211331',
    '231131',
    '213113',
    '213311',
    '213131',
    '311123',
    '311321',
    '331121',
    '312113',
    '312311',
    '332111',
    '314111',
    '221411',
    '431111',
    '111224',
    '111422',
    '121124',
    '121421',
    '141122',
    '141221',
    '112214',
    '112412',
    '122114',
    '122411',
    '142112',
    '142211',
    '241211',
    '221114',
    '413111',
    '241112',
    '134111',
    '111242',
    '121142',
    '121241',
    '114212',
    '124112',
    '124211',
    '411212',
    '421112',
    '421211',
    '212141',
    '214121',
    '412121',
    '111143',
    '111341',
    '131141',
    '114113',
    '114311',
    '411113',
    '411311',
    '113141',
    '114131',
    '311141',
    '411131',
    '211412',
    '211214',
    '211232',
    '2331112'
  ];
  var START_B = 104,
    START_C = 105,
    CODE_B = 100,
    CODE_C = 99,
    STOP = 106;

  function encode(text) {
    var s = String(text == null ? '' : text);
    if (!s) return { ok: false, reason: 'nothing to encode' };
    for (var index = 0; index < s.length; index++) {
      var c = s.charCodeAt(index);
      if (c < 32 || c > 126) return { ok: false, reason: 'Code 128 B takes printable ASCII only' };
    }
    var vals = [],
      i = 0,
      set = null;
    while (i < s.length) {
      var count = 0;
      while (i + count < s.length && s.charCodeAt(i + count) >= 48 && s.charCodeAt(i + count) <= 57) count++;
      if (count >= 4 || (count >= 2 && i + count === s.length && count % 2 === 0)) {
        if (count % 2) {
          /* an odd run: encode the first digit in B, the even rest in C */
          if (set !== 'B') {
            vals.push(set ? CODE_B : START_B);
            set = 'B';
          }
          vals.push(s.charCodeAt(i) - 32);
          i++;
          count--;
        }
        if (set !== 'C') {
          vals.push(set ? CODE_C : START_C);
          set = 'C';
        }
        for (var j = 0; j < count; j += 2) vals.push(Number(s.substr(i + j, 2)));
        i += count;
      } else {
        if (set !== 'B') {
          vals.push(set ? CODE_B : START_B);
          set = 'B';
        }
        vals.push(s.charCodeAt(i) - 32);
        i++;
      }
    }
    var sum = vals[0];
    for (var w = 1; w < vals.length; w++) sum += vals[w] * w;
    vals.push(sum % 103);
    vals.push(STOP);
    return { ok: true, values: vals };
  }

  function svg(text, opts) {
    var o = opts || {},
      e = encode(text);
    if (!e.ok) return e;
    var mod = o.module || 2,
      h = o.height || 56,
      quiet = 10 * mod,
      x = quiet,
      rects = [];
    e.values.forEach(function (item) {
      var pat = list[item];
      for (var index = 0; index < pat.length; index++) {
        var wdt = Number(pat[index]) * mod;
        if (index % 2 === 0) rects.push('<rect x="' + x + '" y="0" width="' + wdt + '" height="' + h + '"/>');
        x += wdt;
      }
    });
    var W = x + quiet,
      label =
        o.label === false
          ? ''
          : '<text x="' +
            W / 2 +
            '" y="' +
            (h + 14) +
            '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="12">' +
            String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;') +
            '</text>';
    return {
      ok: true,
      width: W,
      height: h + (label ? 18 : 0),
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        W +
        ' ' +
        (h + (label ? 18 : 0)) +
        '" width="' +
        W +
        '" height="' +
        (h + (label ? 18 : 0)) +
        '" role="img" aria-label="Code 128 ' +
        String(text).replace(/"/g, '&quot;') +
        '" fill="currentColor">' +
        rects.join('') +
        label +
        '</svg>'
    };
  }

  var api = { code128: svg, encode: encode, PATTERNS: list };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CBBarcode = api;
})(typeof window !== 'undefined' ? window : globalThis);
