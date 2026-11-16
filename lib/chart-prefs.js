/* lib/chart-prefs.js — the person's chart choices as flat ui_prefs keys (chart engine step 1, 2026-11-16).
 * CARD 26-reporting-mis-and-bi/charts · REQ PM/REQ-CHART-ENGINE-2026-11-16.md "Critic 16 Nov" points 2, 3
 *
 * OWNS      the ONE list of chart kinds the server knows, the chart types, and the three families of key:
 *             chart_theme            the colour combination: a short slug; absent = "follow my avatar theme"
 *             chart_read             on | off (Readability); absent = off
 *             chart_fav_<kind>       one string "<combination>-<type>" per chart kind (a favourite)
 *           routes/entities.js PREF_SETS.ui.keys spreads CHART_PREF_KEYS and its check() calls checkChartPrefs; lib/field-ledger.js
 *           prefKeys reads the same list, so a kind added here needs its FIELDS.md row or tests/field-ledger.test.cjs fails by name.
 * CALLED BY routes/entities.js · lib/field-ledger.js · lib/entities-contract.js.
 * WHY FLAT   prefPatch takes only strings of ^[A-Za-z0-9][A-Za-z0-9-]{0,34}$, so an object {combination, type} per kind is refused.
 * ⚠️ The web's engine (public/engine/chart-draw.js CBDraw.KINDS · CBDraw.TYPES) holds the same two lists for the page; the two repos cannot
 *    share a file, so tests/chart-prefs.test.cjs pins them and the web's tests/chart-kinds.test.cjs pins the same literals — change both or one fails.
 */
'use strict';
/** the shapes of figures a chart can have (the engine's vocabulary): by time · a ranking · parts of a whole · a bridge from one total to another */
const CHART_KINDS = ['series', 'rank', 'split', 'bridge'];
/** the drawings the engine offers (a favourite's second half) */
const CHART_TYPES = ['column', 'line', 'bar', 'stack', 'pie', 'donut', 'area', 'waterfall'];
const SLUG = /^[a-z][a-z0-9]{0,19}$/;
const CHART_PREF_KEYS = ['chart_theme', 'chart_read'].concat(CHART_KINDS.map((kind) => 'chart_fav_' + kind));

/** checkChartPrefs(prefs) → a sentence for a refused value, or null. A combination slug is a SHAPE here (the list of combinations is the web's,
 *  and a removed one reads back as "follow my avatar theme", never an error); the kind and the type are closed lists. */
function checkChartPrefs(prefs) {
  if (prefs.chart_theme && !SLUG.test(prefs.chart_theme)) return 'Unknown chart colours';
  if (prefs.chart_read && !['on', 'off'].includes(prefs.chart_read)) return 'Unknown readability setting';
  for (const kind of CHART_KINDS) {
    const value = prefs['chart_fav_' + kind];
    if (!value) continue;
    const at = value.lastIndexOf('-');
    if (at < 1 || !SLUG.test(value.slice(0, at)) || !CHART_TYPES.includes(value.slice(at + 1))) return 'Unknown favourite chart';
  }
  return null;
}

module.exports = { CHART_KINDS, CHART_TYPES, CHART_PREF_KEYS, checkChartPrefs };
