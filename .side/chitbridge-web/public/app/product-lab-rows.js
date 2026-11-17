/**
 * OWNS  how the Product Lab lays out its list (CAT-218): one row per PRODUCT with its units as choices, each unit carrying the
 *       GST unit code (UQC) the engine's units table already holds, and the one sentence that says why "Next" is grey.
 * CALLED BY product-lab.html (paintRows · paintFoot) · tests/product-lab-rows.test.cjs
 * FLOW  the list's rows (one per name and unit, as the api sends them) ──▶ groupRows ──▶ [{ name, category, names, units: [{ unit, price, uqc }] }]
 * CARD  29-qa-test-tooling-ux-locale-and-design-system/product-lab
 * ⚠️ A UQC is read from engine/units.js (CBIC's list) and is null for a unit the list has no code for (plate, cup…): never a guessed code.
 */
(function (root) {
  'use strict';
  var NEXT_WHY_NOTHING_CHOSEN = 'Tick a product to go on.';

  /** the engine's units table, in the browser (window.CBUnits) or in node (the same file) */
  function unitsTable() {
    if (root.CBUnits) return root.CBUnits;
    return typeof require === 'function' ? require('../engine/units.js') : null;
  }
  /** uqcOf(unit) → the GST unit code for this unit word, or null when the table holds none */
  function uqcOf(unit) {
    var table = unitsTable();
    return table && table.uqcOf ? table.uqcOf(unit) || null : null;
  }
  /** groupRows(rows) → one entry per product (name + shelf), its units in the order the list gives them */
  function groupRows(rows) {
    var byKey = {};
    var out = [];
    (rows || []).forEach(function (row) {
      var key = String(row.name).toLowerCase() + '\u0001' + (row.category || '');
      if (!byKey[key]) {
        byKey[key] = { name: row.name, category: row.category || null, names: row.names || null, units: [] };
        out.push(byKey[key]);
      }
      byKey[key].units.push({ unit: row.unit, price: row.price, uqc: uqcOf(row.unit) });
    });
    return out;
  }
  /** nextWhy(chosen) → the sentence beside a grey "Next", or '' when Next is live */
  function nextWhy(chosen) {
    return chosen ? '' : NEXT_WHY_NOTHING_CHOSEN;
  }
  var api = { groupRows: groupRows, uqcOf: uqcOf, nextWhy: nextWhy, NEXT_WHY_NOTHING_CHOSEN: NEXT_WHY_NOTHING_CHOSEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CBProductLabRows = api;
})(typeof window !== 'undefined' ? window : globalThis);
