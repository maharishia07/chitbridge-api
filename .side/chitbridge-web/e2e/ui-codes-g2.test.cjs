'use strict';
// @type: unit
/**
 * ui-codes-g2.test.cjs - wave 2 group G2: four SUPPORT scripts wear their identity codes (UX-137 stamp, 15 Nov).
 *
 * OWNS      the proof that app/cap-iddocs.js (SCR005), app/cap-messages.js (WRK001), app/cap-service.js (SCR008) and app/cap-network.js (BUS004) carry 156
 *           data-cbsid codes, each INSIDE the tag of the control it names (a removed code, a code moved to another kind of tag, or a swap of two codes whose
 *           handlers differ fails it), that no code is written on two element definitions, that each file carries exactly its own count, and that every code
 *           is a live row in the register UIID_REG names.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-g2.test.cjs   (G2_MUTATE=remove or swap must fail it)
 * FLOW      read each script, find every code, read from the '<' before it to the next '>' and compare with the marker of the control it names, then the register
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails. With UIID_REG set a missing code FAILS.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.G2_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');

/** [file, code, the tag it must sit in, a marker that tag carries] */
const CODES = [
  ['app/cap-iddocs.js', 'SCR005-I01', 'input', ' id="idoc_'],
  ['app/cap-iddocs.js', 'SCR005-I02', 'input', ' id="idoc_consent'],
  ['app/cap-iddocs.js', 'SCR005-B01', 'button', 'onclick="CBIdDocs'],
  ['app/cap-messages.js', 'WRK001-C01', 'div', 'onclick="msgOpen'],
  ['app/cap-messages.js', 'WRK001-C02', 'span', 'data-testid="msg-keep'],
  ['app/cap-messages.js', 'WRK001-C03', 'span', 'data-testid="msg-open-line'],
  ['app/cap-messages.js', 'WRK001-C04', 'span', 'data-testid="msg-open-chit'],
  ['app/cap-messages.js', 'WRK001-C05', 'span', 'data-testid="msg-track-'],
  ['app/cap-messages.js', 'WRK001-I01', 'input', 'data-testid="msg-all'],
  ['app/cap-service.js', 'SCR008-B01', 'button', 'onclick="svcAnswer'],
  ['app/cap-service.js', 'SCR008-B02', 'button', 'onclick="svcAnswer'],
  ['app/cap-service.js', 'SCR008-B03', 'button', 'onclick="svcEndPause'],
  ['app/cap-service.js', 'SCR008-B04', 'button', 'onclick="svcStart'],
  ['app/cap-service.js', 'SCR008-B05', 'button', 'onclick="svcRespond'],
  ['app/cap-service.js', 'SCR008-B06', 'button', 'onclick="svcPauseAsk'],
  ['app/cap-service.js', 'SCR008-B07', 'button', 'onclick="svcResolveAsk'],
  ['app/cap-service.js', 'SCR008-S01', 'select', 'class="inp"'],
  ['app/cap-service.js', 'SCR008-S02', 'select', ' id="svc_reason'],
  ['app/cap-service.js', 'SCR008-I01', 'input', ' id="svc_note'],
  ['app/cap-service.js', 'SCR008-I02', 'input', ' id="svc_onother'],
  ['app/cap-service.js', 'SCR008-B08', 'button', 'onclick="svcDoPause'],
  ['app/cap-service.js', 'SCR008-S03', 'select', ' id="svc_code'],
  ['app/cap-service.js', 'SCR008-I03', 'input', ' id="svc_rnote'],
  ['app/cap-service.js', 'SCR008-B09', 'button', 'onclick="svcDoResolve'],
  ['app/cap-network.js', 'BUS004-B01', 'button', 'onclick="netCopyKey'],
  ['app/cap-network.js', 'BUS004-B02', 'button', 'onclick="netRunNarrow'],
  ['app/cap-network.js', 'BUS004-B03', 'button', 'onclick="netMint'],
  ['app/cap-network.js', 'BUS004-B04', 'button', 'onclick="netMintGo'],
  ['app/cap-network.js', 'BUS004-B05', 'button', 'onclick="netCopyKey'],
  ['app/cap-network.js', 'BUS004-B06', 'button', 'onclick="netMintDone'],
  ['app/cap-network.js', 'BUS004-C01', 'div', 'onclick="netSelect'],
  ['app/cap-network.js', 'BUS004-C02', 'span', 'onclick="netMode'],
  ['app/cap-network.js', 'BUS004-B07', 'button', 'onclick="netNewNetwork'],
  ['app/cap-network.js', 'BUS004-C03', 'span', 'onclick="netRevertOne'],
  ['app/cap-network.js', 'BUS004-C04', 'span', 'onclick="netRevertOne'],
  ['app/cap-network.js', 'BUS004-C05', 'span', 'onclick="netRevertAll'],
  ['app/cap-network.js', 'BUS004-B08', 'button', 'onclick="netBuild'],
  ['app/cap-network.js', 'BUS004-C06', 'div', 'onclick="netStartOver'],
  ['app/cap-network.js', 'BUS004-S01', 'select', 'onchange="netSetCatField'],
  ['app/cap-network.js', 'BUS004-I01', 'input', 'oninput="netSetCatField'],
  ['app/cap-network.js', 'BUS004-S02', 'select', 'onchange="netSetCatField'],
  ['app/cap-network.js', 'BUS004-S03', 'select', 'onchange="netSetCatField'],
  ['app/cap-network.js', 'BUS004-C07', 'span', 'onclick="netDelCatField'],
  ['app/cap-network.js', 'BUS004-C08', 'div', 'onclick="netSetPriceSrc'],
  ['app/cap-network.js', 'BUS004-I02', 'input', 'oninput="netSetVariant'],
  ['app/cap-network.js', 'BUS004-C09', 'span', 'onclick="netDelVariant'],
  ['app/cap-network.js', 'BUS004-I03', 'input', 'oninput="netSetAltUnit'],
  ['app/cap-network.js', 'BUS004-I04', 'input', 'oninput="netSetAltUnit'],
  ['app/cap-network.js', 'BUS004-I05', 'input', 'oninput="netSetAltUnit'],
  ['app/cap-network.js', 'BUS004-C10', 'span', 'onclick="netDelAltUnit'],
  ['app/cap-network.js', 'BUS004-I06', 'input', 'oninput="netSetCatProduct'],
  ['app/cap-network.js', 'BUS004-C11', 'div', 'onclick="netAddVariant'],
  ['app/cap-network.js', 'BUS004-I07', 'input', 'oninput="netSetBaseUnit'],
  ['app/cap-network.js', 'BUS004-C12', 'div', 'onclick="netAddAltUnit'],
  ['app/cap-network.js', 'BUS004-I08', 'input', 'oninput="netSetRef'],
  ['app/cap-network.js', 'BUS004-I09', 'input', 'oninput="netSetRef'],
  ['app/cap-network.js', 'BUS004-C13', 'span', 'onclick="netDelRef'],
  ['app/cap-network.js', 'BUS004-C14', 'div', 'onclick="netAddRef'],
  ['app/cap-network.js', 'BUS004-I10', 'input', 'oninput="netSetBom'],
  ['app/cap-network.js', 'BUS004-I11', 'input', 'oninput="netSetBom'],
  ['app/cap-network.js', 'BUS004-C15', 'span', 'onclick="netDelBom'],
  ['app/cap-network.js', 'BUS004-C16', 'div', 'onclick="netAddBom'],
  ['app/cap-network.js', 'BUS004-S04', 'select', 'onchange="netSetStd'],
  ['app/cap-network.js', 'BUS004-I12', 'input', 'oninput="netSetStd'],
  ['app/cap-network.js', 'BUS004-I13', 'input', 'oninput="netSetStd'],
  ['app/cap-network.js', 'BUS004-C17', 'span', 'onclick="netDelStd'],
  ['app/cap-network.js', 'BUS004-C18', 'div', 'onclick="netAddStd'],
  ['app/cap-network.js', 'BUS004-I14', 'input', 'oninput="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I15', 'input', 'oninput="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I16', 'input', 'oninput="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I17', 'input', 'oninput="netSetPrice'],
  ['app/cap-network.js', 'BUS004-C19', 'span', 'onclick="netDelPrice'],
  ['app/cap-network.js', 'BUS004-S05', 'select', 'onchange="netSetPrice'],
  ['app/cap-network.js', 'BUS004-S06', 'select', 'onchange="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I18', 'input', 'onchange="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I19', 'input', 'onchange="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I20', 'input', 'oninput="netSetPrice'],
  ['app/cap-network.js', 'BUS004-I21', 'input', 'oninput="netSetContext'],
  ['app/cap-network.js', 'BUS004-I22', 'input', 'oninput="netSetContext'],
  ['app/cap-network.js', 'BUS004-C20', 'div', 'onclick="netAddPrice'],
  ['app/cap-network.js', 'BUS004-C21', 'span', 'onclick="netSetFeedbackFmt'],
  ['app/cap-network.js', 'BUS004-I23', 'input', 'oninput="netSetFeedbackFmt'],
  ['app/cap-network.js', 'BUS004-I24', 'input', 'oninput="netSetFeedback'],
  ['app/cap-network.js', 'BUS004-C22', 'span', 'onclick="netDelFeedback'],
  ['app/cap-network.js', 'BUS004-I25', 'input', 'oninput="netSetTrigger'],
  ['app/cap-network.js', 'BUS004-S07', 'select', 'onchange="netSetTrigger'],
  ['app/cap-network.js', 'BUS004-I26', 'input', 'oninput="netSetTrigger'],
  ['app/cap-network.js', 'BUS004-S08', 'select', 'onchange="netSetTrigger'],
  ['app/cap-network.js', 'BUS004-I27', 'input', 'oninput="netSetTrigger'],
  ['app/cap-network.js', 'BUS004-C23', 'span', 'onclick="netDelTrigger'],
  ['app/cap-network.js', 'BUS004-C24', 'span', 'onclick="netCatTab'],
  ['app/cap-network.js', 'BUS004-T01', 'textarea', 'oninput="netSetCatStory'],
  ['app/cap-network.js', 'BUS004-C25', 'div', 'onclick="netAddTrigger'],
  ['app/cap-network.js', 'BUS004-C26', 'div', 'onclick="netAddCatField'],
  ['app/cap-network.js', 'BUS004-S09', 'select', 'onchange="netSetCatLoad'],
  ['app/cap-network.js', 'BUS004-C27', 'div', 'onclick="netAddFeedback'],
  ['app/cap-network.js', 'BUS004-C28', 'div', 'onclick="netExportCat'],
  ['app/cap-network.js', 'BUS004-C29', 'div', 'onclick="netSetExposure'],
  ['app/cap-network.js', 'BUS004-S10', 'select', 'onchange="netSetInlet'],
  ['app/cap-network.js', 'BUS004-I28', 'input', 'oninput="netSetInlet'],
  ['app/cap-network.js', 'BUS004-C30', 'span', 'onclick="netDelInlet'],
  ['app/cap-network.js', 'BUS004-I29', 'input', 'oninput="netSetCollectBack'],
  ['app/cap-network.js', 'BUS004-S11', 'select', 'onchange="netSetCollectBack'],
  ['app/cap-network.js', 'BUS004-C31', 'span', 'onclick="netDelCollectBack'],
  ['app/cap-network.js', 'BUS004-S12', 'select', 'onchange="netSetOrderMethod'],
  ['app/cap-network.js', 'BUS004-I30', 'input', 'oninput="netSetOrderMax'],
  ['app/cap-network.js', 'BUS004-C32', 'div', 'onclick="netAddCollectBack'],
  ['app/cap-network.js', 'BUS004-C33', 'div', 'onclick="netAddInlet'],
  ['app/cap-network.js', 'BUS004-I31', 'input', 'oninput="netSetState'],
  ['app/cap-network.js', 'BUS004-C34', 'span', 'onclick="netMoveState'],
  ['app/cap-network.js', 'BUS004-C35', 'span', 'onclick="netMoveState'],
  ['app/cap-network.js', 'BUS004-C36', 'span', 'onclick="netDelState'],
  ['app/cap-network.js', 'BUS004-C37', 'div', 'onclick="netAddState'],
  ['app/cap-network.js', 'BUS004-I32', 'input', 'oninput="netSetAttach'],
  ['app/cap-network.js', 'BUS004-C38', 'span', 'onclick="netDelAttach'],
  ['app/cap-network.js', 'BUS004-C39', 'div', 'onclick="netAddAttach'],
  ['app/cap-network.js', 'BUS004-T02', 'textarea', 'oninput="netSetOrderNotes'],
  ['app/cap-network.js', 'BUS004-I33', 'input', 'oninput="netCaHumanSetRole'],
  ['app/cap-network.js', 'BUS004-C40', 'span', 'onclick="netCaHumanDelRole'],
  ['app/cap-network.js', 'BUS004-I34', 'input', 'oninput="netCaHuman'],
  ['app/cap-network.js', 'BUS004-C41', 'span', 'onclick="netCaHumanAddRole'],
  ['app/cap-network.js', 'BUS004-S13', 'select', 'onchange="netCaSetIot'],
  ['app/cap-network.js', 'BUS004-I35', 'input', 'oninput="netCaSetIot'],
  ['app/cap-network.js', 'BUS004-I36', 'input', 'oninput="netCaSetIot'],
  ['app/cap-network.js', 'BUS004-C42', 'span', 'onclick="netCaDelIot'],
  ['app/cap-network.js', 'BUS004-C43', 'span', 'onclick="netCaAddIot'],
  ['app/cap-network.js', 'BUS004-S14', 'select', 'onchange="netCaSetErp'],
  ['app/cap-network.js', 'BUS004-I37', 'input', 'oninput="netCaSetErp'],
  ['app/cap-network.js', 'BUS004-C44', 'span', 'onclick="netCaDelErp'],
  ['app/cap-network.js', 'BUS004-C45', 'span', 'onclick="netCaAddErp'],
  ['app/cap-network.js', 'BUS004-I38', 'input', 'oninput="netCaAiCount'],
  ['app/cap-network.js', 'BUS004-I39', 'input', 'oninput="netCaAiRole'],
  ['app/cap-network.js', 'BUS004-S15', 'select', 'onchange="netCaAiAutonomy'],
  ['app/cap-network.js', 'BUS004-C46', 'div', 'cursor:pointer;padding:8px 10p'],
  ['app/cap-network.js', 'BUS004-I40', 'input', 'oninput="netSetCert'],
  ['app/cap-network.js', 'BUS004-C47', 'span', 'onclick="netDelCert'],
  ['app/cap-network.js', 'BUS004-C48', 'div', 'onclick="netAddCert'],
  ['app/cap-network.js', 'BUS004-I41', 'input', 'esc(val == null'],
  ['app/cap-network.js', 'BUS004-C49', 'div', 'onclick="netSetNetworkVisibility'],
  ['app/cap-network.js', 'BUS004-B09', 'button', 'disabled title="Not available'],
  ['app/cap-network.js', 'BUS004-B10', 'button', 'onclick="netSetExposure'],
  ['app/cap-network.js', 'BUS004-B11', 'button', 'onclick="netSetNetworkName'],
  ['app/cap-network.js', 'BUS004-C50', 'span', 'onclick="netPickTab'],
  ['app/cap-network.js', 'BUS004-B12', 'button', 'onclick="netAddChild'],
  ['app/cap-network.js', 'BUS004-B13', 'button', 'onclick="netAddPartner'],
  ['app/cap-network.js', 'BUS004-B14', 'button', 'onclick="netRename'],
  ['app/cap-network.js', 'BUS004-B15', 'button', 'onclick="netDelete'],
  ['app/cap-network.js', 'BUS004-B16', 'button', 'onclick="netMove'],
  ['app/cap-network.js', 'BUS004-B17', 'button', 'onclick="netMove'],
  ['app/cap-network.js', 'BUS004-I42', 'input', 'oninput="netSetPartnerRef'],
  ['app/cap-network.js', 'BUS004-B18', 'button', 'onclick="netReissueKey'],
  ['app/cap-network.js', 'BUS004-I43', 'input', 'oninput="netSetPurpose'],
  ['app/cap-network.js', 'BUS004-I44', 'input', 'data-testid="net-cap-'],
  ['app/cap-network.js', 'BUS004-C51', 'span', 'onclick="netPickTab'],
  ['app/cap-network.js', 'BUS004-B19', 'button', 'onclick="netCapYes'],
  ['app/cap-network.js', 'BUS004-C52', 'span', 'onclick="netCapNo']
];
const COUNTS = { 'app/cap-iddocs.js': 3, 'app/cap-messages.js': 6, 'app/cap-service.js': 15, 'app/cap-network.js': 132 };

const read = (f) => {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="BUS004-B01"').join('');
  if (mutate === 'swap') t = t.split('BUS004-B01').join('SWAPX').split('BUS004-B03').join('BUS004-B01').split('SWAPX').join('BUS004-B03');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {};
const text = (f) => (src[f] = src[f] || read(f));

/** the open tag around a code: from the '<' before it to the first '>' after it (the strings hold no '>' inside a tag here) */
function tagAround(f, code) {
  const t = text(f), at = t.indexOf('data-cbsid="' + code + '"');
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
  for (const m of text(f).matchAll(/data-cbsid="([A-Z]{3}\d{3}-[A-Z]\d{2})"/g)) { seen[m[1]] = (seen[m[1]] || 0) + 1; n++; }
  check(n === COUNTS[f], f + ' carries exactly ' + COUNTS[f] + ' coded element definitions: ' + n);
}
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
