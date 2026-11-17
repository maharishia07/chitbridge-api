'use strict';
// @type: unit
/**
 * ui-codes-g4.test.cjs - wave 2 group G4: four scripts wear their identity codes (UX-137 stamp, 15 Nov).
 *
 * OWNS      the proof that app/cap-traceability.js (INS003), app/cap-readiness.js (SCR033), app/cap-definitions.js (SCR003) and app/cap-catsetup.js (CAT004)
 *           carry 109 data-cbsid codes (+ 15 ui.field mounts, R2 and the compact rows), each INSIDE the tag of the control it names (a removed code, a code moved to another kind of tag, or a swap of two
 *           codes whose handlers differ fails it), that no code is written on two element definitions, that each file carries exactly its own count, and
 *           that every code is a live row in the register UIID_REG names.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-g4.test.cjs   (G4_MUTATE=remove or swap must fail it)
 * FLOW      read each script, find every code, read from the '<' before it to the next '>' and compare with the marker of the control it names, then the register
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails. With UIID_REG set a missing code FAILS.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.G4_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');

/** [file, code, the tag it must sit in, a marker that tag carries] */
const CODES = [
  ["app/cap-traceability.js","INS003-I01","input","oninput=\"UI"],
  ["app/cap-traceability.js","INS003-B01","button","onclick=\"runTrace"],
  ["app/cap-traceability.js","INS003-B02","button","onclick=\"runTrace"],
  ["app/cap-traceability.js","INS003-I02","input","oninput=\"UI"],
  ["app/cap-traceability.js","INS003-I03","input","oninput=\"UI"],
  ["app/cap-traceability.js","INS003-I04","input","oninput=\"UI"],
  ["app/cap-traceability.js","INS003-B03","button","onclick=\"runTraceByBatch"],
  ["app/cap-traceability.js","INS003-C01","div","onclick=\"UI"],
  ["app/cap-readiness.js","SCR033-B01","button","onclick=\"_aiAccept"],
  ["app/cap-readiness.js","SCR033-B02","button","onclick=\"_aiPdf"],
  ["app/cap-readiness.js","SCR033-B03","button","onclick=\"_aiCopy"],
  ["app/cap-readiness.js","SCR033-B04","button","onclick=\"aiSuggestPartner"],
  ["app/cap-readiness.js","SCR033-C01","span","onclick=\"event"],
  ["app/cap-readiness.js","SCR033-C02","div","onclick=\"_rdSelect"],
  ["app/cap-readiness.js","SCR033-B05","button","onclick=\"verifyReadiness"],
  ["app/cap-readiness.js","SCR033-B06","button","onclick=\"aiDraftReadiness"],
  ["app/cap-readiness.js","SCR033-B07","button","onclick=\"gatherReadiness"],
  ["app/cap-readiness.js","SCR033-S01","select","onchange=\"setLaneVertical"],
  ["app/cap-readiness.js","SCR033-S02","select","onchange=\"setLaneDest"],
  ["app/cap-readiness.js","SCR033-C03","div","onclick=\"UI"],
  ["app/cap-readiness.js","SCR033-B08","button","onclick=\"aiSuggestStandards"],
  ["app/cap-readiness.js","SCR033-B09","button","onclick=\"openSectorMatrix"],
  ["app/cap-readiness.js","SCR033-C04","div","onclick=\"_rdComSelect"],
  ["app/cap-readiness.js","SCR033-B10","button","onclick=\"aiDraftCommerce"],
  ["app/cap-readiness.js","SCR033-B11","button","onclick=\"submitVerify"],
  ["app/cap-readiness.js","SCR033-B12","button","onclick=\"submitGather"],
  ["app/cap-definitions.js","SCR003-S01","select","onchange=\"cbDefSetRule"],
  ["app/cap-definitions.js","SCR003-S02","select","onchange=\"cbDefSetRule"],
  ["app/cap-definitions.js","SCR003-S03","select","onchange=\"cbDefSetReward"],
  ["app/cap-definitions.js","SCR003-I01","input","onchange=\"CBDEF_TEST"],
  ["app/cap-definitions.js","SCR003-S04","select","onchange=\"cbDefSetCustomer"],
  ["app/cap-definitions.js","SCR003-I02","input","onchange=\"cbDefSetCheck"],
  ["app/cap-definitions.js","SCR003-S05","select","onchange=\"cbDefSetRule"],
  ["app/cap-definitions.js","SCR003-T01","textarea","oninput=\"cbDefSetTiers"],
  ["app/cap-definitions.js","SCR003-T02","textarea"," rows=\"4\""],
  ["app/cap-definitions.js","SCR003-I03","input","class=\"inp\""],
  ["app/cap-definitions.js","SCR003-S06","select","onchange=\"cbDefSetSub"],
  ["app/cap-definitions.js","SCR003-I04","input","oninput=\"cbDefSetField"],
  ["app/cap-definitions.js","SCR003-B01","button","onclick=\"cbDefToggleStd"],
  ["app/cap-definitions.js","SCR003-S07","select"," id=\"cbdef_takeover"],
  ["app/cap-definitions.js","SCR003-B02","button","onclick=\"cbDefTakeoverGo"],
  ["app/cap-definitions.js","SCR003-C01","div","onclick=\"cbDefToggle"],
  ["app/cap-definitions.js","SCR003-C02","span","onclick=\"cbDefSetStatus"],
  ["app/cap-definitions.js","SCR003-C03","span","onclick=\"cbDefRetire"],
  ["app/cap-definitions.js","SCR003-C04","div","onclick=\"cbDefToggle"],
  ["app/cap-definitions.js","SCR003-B03","button","onclick=\"event"],
  ["app/cap-definitions.js","SCR003-B04","button","onclick=\"event"],
  ["app/cap-definitions.js","SCR003-S08","select","onchange=\"CBDEF_TEST"],
  ["app/cap-definitions.js","SCR003-I06","input","oninput=\"CBDEF_TEST"],
  ["app/cap-definitions.js","SCR003-B05","button","onclick=\"cbDefTestRun"],
  ["app/cap-catsetup.js","CAT004-C01","span","onclick=\"catsetDefStatus"],
  ["app/cap-catsetup.js","CAT004-C02","span","onclick=\"catsetDefStatus"],
  ["app/cap-catsetup.js","CAT004-C03","span","onclick=\"catsetDefRetire"],
  ["app/cap-catsetup.js","CAT004-C04","span","onclick=\"catsetLangToggle"],
  ["app/cap-catsetup.js","CAT004-B01","button","onclick=\"catsetRecheckSet"],
  ["app/cap-catsetup.js","CAT004-C05","span","onclick=\"declareVariants"],
  ["app/cap-catsetup.js","CAT004-B02","button","onclick=\"catsetBlueprint"],
  ["app/cap-catsetup.js","CAT004-B03","button","onclick=\"catcolPick"],
  ["app/cap-catsetup.js","CAT004-B04","button","onclick=\"declareVariants"],
  ["app/cap-catsetup.js","CAT004-B05","button","onclick=\"catsetDefNew"],
  ["app/cap-catsetup.js","CAT004-B06","button","onclick=\"catsetPlanOpen"],
  ["app/cap-catsetup.js","CAT004-B07","button","onclick=\"catsetDefNew"],
  ["app/cap-catsetup.js","CAT004-B08","button","onclick=\"checkCatalogueFile"],
  ["app/cap-catsetup.js","CAT004-B09","button","onclick=\"downloadCatalogueTemplate"],
  ["app/cap-catsetup.js","CAT004-B10","button","onclick=\"exportCatalogueCSV"],
  ["app/cap-catsetup.js","CAT004-B11","button","onclick=\"catsetDefNew"],
  ["app/cap-catsetup.js","CAT004-S01","select","onchange=\"catcolLoad"],
  ["app/cap-catsetup.js","CAT004-S02","select"," id=\"catcol_owntype"],
  ["app/cap-catsetup.js","CAT004-B12","button","onclick=\"catcolGo"],
  ["app/cap-catsetup.js","CAT004-B13","button","onclick=\"catcolAll"],
  ["app/cap-catsetup.js","CAT004-B14","button","onclick=\"catcolAll"],
  ["app/cap-catsetup.js","CAT004-I07","input","onchange=\"catcolTick"],
  ["app/cap-catsetup.js","CAT004-B15","button","onclick=\"catsetSetColTab"],
  ["app/cap-catsetup.js","CAT004-S03","select","onchange=\"catsetFieldPatch"],
  ["app/cap-catsetup.js","CAT004-I08","input","onchange=\"catsetFieldPatch"],
  ["app/cap-catsetup.js","CAT004-I09","input","onchange=\"catsetFieldPatch"],
  ["app/cap-catsetup.js","CAT004-B16","button","onclick=\"catsetDrop"],
  ["app/cap-catsetup.js","CAT004-B17","button","onclick=\"catsetMove"],
  ["app/cap-catsetup.js","CAT004-B18","button","onclick=\"catsetMove"],
  ["app/cap-catsetup.js","CAT004-B19","button","disabled title=\""],
  ["app/cap-catsetup.js","CAT004-B20","button","disabled title=\""],
  ["app/cap-catsetup.js","CAT004-S04","select","onchange=\"catsetErpSet"],
  ["app/cap-catsetup.js","CAT004-C06","div","onclick=\"catsetDefEdit"],
  ["app/cap-catsetup.js","CAT004-I12","input","oninput=\"CATSET_PLAN"],
  ["app/cap-catsetup.js","CAT004-S05","select","onchange=\"CATSET_PLAN"],
  ["app/cap-catsetup.js","CAT004-I13","input","oninput=\"CATSET_PLAN"],
  ["app/cap-catsetup.js","CAT004-S06","select","onchange=\"CATSET_PLAN"],
  ["app/cap-catsetup.js","CAT004-B21","button","onclick=\"CATSET_PLAN"],
  ["app/cap-catsetup.js","CAT004-B22","button","onclick=\"catsetPlanGo"],
  ["app/cap-catsetup.js","CAT004-C07","span","onclick=\"catsetTaxCatg"],
  ["app/cap-catsetup.js","CAT004-S07","select","onchange=\"catsetTaxPick"],
  ["app/cap-catsetup.js","CAT004-B23","button","onclick=\"catsetBack"],
  ["app/cap-catsetup.js","CAT004-C08","div","onclick=\"catsetSetSec"],
  ["app/cap-catsetup.js","CAT004-C09","span","onclick=\"navTo"],
  ["app/cap-catsetup.js","CAT004-C10","span","onclick=\"navTo"],
  ["app/cap-catsetup.js","CAT004-C11","div","onclick=\"catsetSfMethod"],
  ["app/cap-catsetup.js","CAT004-B24","button","onclick=\"catsetSfUnit"],
  ["app/cap-catsetup.js","CAT004-B25","button","onclick=\"catsetSfDefUnit"],
  ["app/cap-catsetup.js","CAT004-B26","button","onclick=\"catsetSfFacet"]
];
/** UX-137 R2: a text-like input that became a ui.field mount. [file, mount code, the kind, the id it keeps for the handler that reads it]; the mount is a literal in the call (the census reads it) and the old element code is gone */
const MOUNTS = [
  ['app/cap-readiness.js', 'SCR033-U01', 'text', 'vf_id', 'SCR033-I01'],
  ['app/cap-readiness.js', 'SCR033-U02', 'file', 'gd_file', 'SCR033-I02'],
  ['app/cap-readiness.js', 'SCR033-U03', 'text', 'gd_ref', 'SCR033-I03'],
  ['app/cap-readiness.js', 'SCR033-U04', 'date', 'gd_valid', 'SCR033-I04'],
  ['app/cap-definitions.js', 'SCR003-U01', 'text', 'cbdef-note', 'SCR003-I05'],
  ['app/cap-catsetup.js', 'CAT004-U01', 'checkbox', null, 'CAT004-I01'],
  ['app/cap-catsetup.js', 'CAT004-U02', 'checkbox', null, 'CAT004-I02'],
  ['app/cap-catsetup.js', 'CAT004-U03', 'number', null, 'CAT004-I03'],
  ['app/cap-catsetup.js', 'CAT004-U04', 'number', null, 'CAT004-I04'],
  ['app/cap-catsetup.js', 'CAT004-U05', 'checkbox', null, 'CAT004-I05'],
  ['app/cap-catsetup.js', 'CAT004-U06', 'text', 'catcol_own', 'CAT004-I06'],
  ['app/cap-catsetup.js', 'CAT004-U07', 'text', null, 'CAT004-I10'],
  ['app/cap-catsetup.js', 'CAT004-U08', 'text', null, 'CAT004-I11'],
  ['app/cap-catsetup.js', 'CAT004-U09', 'date', null, 'CAT004-I14'],
  ['app/cap-catsetup.js', 'CAT004-U10', 'date', null, 'CAT004-I15']
];
const COUNTS = {"app/cap-traceability.js":8,"app/cap-readiness.js":18,"app/cap-definitions.js":24,"app/cap-catsetup.js":49};

const read = (f) => {
  /* a code inside a double-quoted JS string is written escaped (data-cbsid=\"X\"): read the source as the tag it draws */
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n').split('\\"').join('"');
  if (mutate === 'remove') t = t.split('data-cbsid="INS003-B01"').join('');
  if (mutate === 'swap') t = t.split('INS003-B01').join('SWAPX').split('INS003-B03').join('INS003-B01').split('SWAPX').join('INS003-B03');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {};
const text = (f) => (src[f] = src[f] || read(f));

/** the open tag around a code: from the '<' before it to the first '>' after it (the strings hold no '>' inside a tag here) */
function tagAround(f, code) {
  const t = text(f), at = t.indexOf('data-cbsid="' + code + '"');
  /* (the '>' search below stops at the first one, so a marker must sit before any '>' inside an attribute value) */
  if (at < 0) return null;
  const open = t.lastIndexOf('<', at), end = t.indexOf('>', at);
  return { name: (t.slice(open + 1, at).match(/^[a-z]+/) || [''])[0], body: t.slice(open, end + 1) };
}
for (const [f, code, tag, marker] of CODES) {
  const found = tagAround(f, code);
  check(!!found && found.name === tag && found.body.indexOf(marker) >= 0, f + ' ' + code + ' sits in its own <' + tag + '> (' + marker + ')');
}
const seen = {};
for (const f of Object.keys(COUNTS)) {
  let n = 0;
  for (const m of text(f).matchAll(/data-cbsid=[\\]?"([A-Z]{3}\d{3}-[A-Z]\d{2})/g)) { seen[m[1]] = (seen[m[1]] || 0) + 1; n++; }
  check(n === COUNTS[f], f + ' carries exactly ' + COUNTS[f] + ' coded element definitions: ' + n);
}
for (const [f, mount, kind, id, oldCode] of MOUNTS) {
  const t = text(f), at = t.indexOf("mount: '" + mount + "'");
  const call = at < 0 ? '' : t.slice(t.lastIndexOf('ui.field(', at), t.indexOf('})', at));
  check(call.indexOf("kind: '" + kind + "'") > 0 && (id === null || call.indexOf("id: '" + id + "'") > 0), f + ' ' + mount + ' is a ui.field ' + kind + (id ? ' with id ' + id + ' (the id its reader uses)' : ' keyed per row'));
  check(t.indexOf(oldCode) < 0, f + ' no longer carries ' + oldCode + ' (the field component writes its own CMP055 code)');
}
const mountSeen = {};
for (const f of ['app/cap-readiness.js', 'app/cap-definitions.js', 'app/cap-catsetup.js']) for (const m of text(f).matchAll(/mount: '([A-Z]{3}\d{3}-U\d{2})'/g)) mountSeen[m[1]] = (mountSeen[m[1]] || 0) + 1;
check(Object.keys(mountSeen).length === MOUNTS.length && Object.keys(mountSeen).every((m) => mountSeen[m] === 1), 'each of the ' + MOUNTS.length + ' mounts is written once, no other ui.field is mounted in these files');
const dup = Object.keys(seen).filter((c) => seen[c] > 1);
check(dup.length === 0, 'no code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  register ' + p + ' not readable: ' + e.message); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const codes = Object.keys(seen), missing = codes.filter((c) => !rows[c]), retired = codes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (codes.length - missing.length) + ' of ' + codes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, 'every code is in the register UIID_REG names (' + missing.length + ' missing)'); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
