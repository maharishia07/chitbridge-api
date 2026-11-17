/* app/units.js — vendored VERBATIM from chitbridge-api/lib/units.js (one unit · three names: ours · UN/ECE Rec 20 · GST UQC). */
/*
 * OWNS      CBUnits: one unit, three names (ours, UN/ECE Rec 20, GST UQC); never converts
 * CALLED BY <script src="/app/units.js"> at public/app.html:1626; used by public/app/product-lab-rows.js; e2e/guard-static.cjs
 * FLOW      a name in -> unitOf() the one unit it means -> rec20Of() / uqcOf() codes out
 * CARD      06-catalogue-pim/units-conversion-codes
 */
(function (root) {
  'use strict';
  const UNITS = {
    kg: { rec20: 'KGM', uqc: 'KGS', names: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos', 'kilogramme'] },
    /* ⚠️ `g` is the SI symbol; `mg`/`oz` are deliberately NOT here — see the master, lib/units.js */
    gram: { rec20: 'GRM', uqc: 'GMS', names: ['gram', 'grams', 'g', 'gm', 'gms', 'gramme'] },
    tonne: { rec20: 'TNE', uqc: 'MTS', names: ['tonne', 'tonnes', 'ton', 'tons', 'mt', 'metric ton'] },
    litre: { rec20: 'LTR', uqc: 'LTR', names: ['litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs', 'l'] },
    ml: { rec20: 'MLT', uqc: 'MLT', names: ['ml', 'millilitre', 'millilitres', 'milliliter', 'mls'] },
    piece: { rec20: 'H87', uqc: 'PCS', names: ['piece', 'pieces', 'pcs', 'pc'] },
    count: { rec20: 'H87', uqc: 'NOS', names: ['count', 'counts', 'nos', 'no', 'number', 'numbers', 'each', 'ea'] },
    unit: { rec20: 'C62', uqc: 'UNT', names: ['unit', 'units', 'unt'] },
    pack: { rec20: 'PK', uqc: 'PAC', names: ['pack', 'packs', 'pac', 'packet', 'packets', 'pkt'] },
    box: { rec20: 'BX', uqc: 'BOX', names: ['box', 'boxes'] },
    dozen: { rec20: 'DZN', uqc: 'DOZ', names: ['dozen', 'dozens', 'doz'] },
    barrel: { rec20: 'BLL', uqc: 'DRM', names: ['barrel', 'barrels', 'drum', 'drums', 'drm'] },
    metre: { rec20: 'MTR', uqc: 'MTR', names: ['metre', 'metres', 'meter', 'meters', 'mtr', 'm'] },
    sqft: { rec20: 'FTK', uqc: 'SQF', names: ['sqft', 'sq ft', 'square foot', 'square feet', 'sqf'] },
    roll: { rec20: 'RO', uqc: 'ROL', names: ['roll', 'rolls', 'rol'] },
    bag: { rec20: 'BG', uqc: 'BAG', names: ['bag', 'bags'] },
    carton: { rec20: 'CT', uqc: 'CTN', names: ['carton', 'cartons', 'ctn'] },
    bottle: { rec20: 'BO', uqc: 'BTL', names: ['bottle', 'bottles', 'btl'] },
    pair: { rec20: 'PR', uqc: 'PRS', names: ['pair', 'pairs', 'prs'] },
    set: { rec20: 'SET', uqc: 'SET', names: ['set', 'sets'] },
    sqm: { rec20: 'MTK', uqc: 'SQM', names: ['sqm', 'square metre', 'square meter', 'sq m'] },
    quintal: { rec20: 'DTN', uqc: 'QTL', names: ['quintal', 'quintals', 'qtl'] }
  };
  const INDEX = (() => {
    const lookup = new Map();
    for (const [k, u] of Object.entries(UNITS)) {
      lookup.set(k, k);
      lookup.set(u.rec20.toLowerCase(), k);
      lookup.set(u.uqc.toLowerCase(), k);
      for (const text of u.names) lookup.set(text.toLowerCase(), k);
    }
    return lookup;
  })();
  /** ours for any spelling, UQC or Rec 20 — null when unknown (never guess a unit) */
  function unitOf(any) {
    const text = String(any || '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '');
    if (!text) return null;
    return INDEX.get(text) || INDEX.get(text.replace(/[^a-z0-9 ]/g, '')) || null;
  }
  function uqcOf(unit) {
    const u = UNITS[unitOf(unit) || ''];
    return u ? u.uqc : null;
  }
  function rec20Of(unit) {
    const u = UNITS[unitOf(unit) || ''];
    return u ? u.rec20 : null;
  }

  root.CBUnits = { UNITS: UNITS, unitOf: unitOf, uqcOf: uqcOf, rec20Of: rec20Of };
})(typeof window !== 'undefined' ? window : this);
