'use strict';
/**
 * lib/integrations-fit.js — a connector offered only where it works: the country pack decides (FITS), the rows no kit exists for (NOT_YET), mayFor.
 * OWNS      FITS · NOT_YET · mayFor (no route, no state)
 * CALLED BY routes/integrations.js (the catalogue list and the download refusal)
 * FLOW      mayFor(connector, country) -> the pack's own flag (lib/regulation) -> { ok, code, why }
 * CARD      23-connectors-and-integrations/tally-connector
 */


/**
 * ⭐ CX6 (K1) · A CONNECTOR OFFERED ONLY WHERE IT WORKS — the shop's country pack decides, never a country name here. `fits` names what the
 * connector's kit is built on: 'tally' = Tally's books import (the pack's `export.tallyXml`, reg-in only); 'gstin' = India-shaped GST (the
 * GSTIN handshake, CGST/SGST · IGST — the pack's `tax.supply === 'state'`, as web helpers.packSplitsByState). No `fits` = every pack (Till, CSV).
 * An unknown country (no pack, or not signed in) = offered, never a guess. The catalogue says may/why; the download refuses the same.
 */
const FITS = {
  tally: {
    ok: (p) => !!(p.export && p.export.tallyXml),
    code: 'NOT_FOR_COUNTRY',
    why: "The Tally connector is built on Tally's Indian GST books, so it is not offered for a {country} shop. Use the File connector (CSV) or the Counter."
  },
  /* ⭐ SET-WALK1 · W16: Zoho Books is SOLD in Australia and the UAE — what is India-shaped is OUR kit (adapters/zoho.js: GSTIN, CGST/SGST). So the
     row is "not yet for {country}" (code NOT_YET_FOR_COUNTRY: the kit is still to be built for that pack), never "not for your country". */
  gstin: {
    ok: (p) => !!(p.tax && p.tax.supply === 'state'),
    code: 'NOT_YET_FOR_COUNTRY',
    why: "Our {name} kit is built for India's GST so far — not yet for a {country} shop. Use the File connector (CSV) or the Counter."
  },
  /* a row with no kit at all: listed so an AU shop sees its own packages named, greyed with the sentence; the download refuses the same */
  none: { ok: () => false, code: 'NOT_YET', why: 'A {name} kit is not built yet. Use the File connector (CSV) or the Counter; ask for it under Help.' }
};
/** the catalogue rows a country's pack names as the packages its shops run (reg-au: Xero · MYOB) — `fits:'none'` until a kit exists */
const NOT_YET = [
  {
    id: 'xero',
    name: 'Xero connector',
    for: ['AU', 'NZ', 'GB'],
    adapters: [],
    fits: 'none',
    status: 'not yet',
    runs_on: '—',
    does: 'Items from Xero; every ChitBridge order as a Xero invoice.'
  },
  {
    id: 'myob',
    name: 'MYOB connector',
    for: ['AU', 'NZ'],
    adapters: [],
    fits: 'none',
    status: 'not yet',
    runs_on: '—',
    does: 'Items from MYOB; every ChitBridge order as a MYOB invoice.'
  }
];

/** may this connector be offered to a shop of `country`? { ok, code, why }: the pack's own flag decides (FITS), an unknown country is offered, never guessed away */
function mayFor(connector, country) {
  const fitRule = connector.fits && FITS[connector.fits];
  if (!fitRule) return { ok: true, code: null, why: null };
  if (fitRule === FITS.none) return { ok: false, code: fitRule.code, why: fitRule.why.replace('{name}', connector.name.replace(/ connector$/, '')) };
  if (!country) return { ok: true, code: null, why: null };
  const pack = require('./regulation').packFor(country);
  if (!pack) return { ok: true, code: null, why: null };
  return fitRule.ok(pack)
    ? { ok: true, code: null, why: null }
    : {
        ok: false,
        code: fitRule.code,
        why: fitRule.why.replace('{country}', require('./country-setup').nameOf(country)).replace('{name}', connector.name.replace(/ connector$/, ''))
      };
}

module.exports = { NOT_YET, mayFor };
