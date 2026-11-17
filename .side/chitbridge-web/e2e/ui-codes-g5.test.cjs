'use strict';
// @type: unit
/**
 * ui-codes-g5.test.cjs - wave 2 group G5: seven scripts wear their identity codes (UX-137 stamp, 15 Nov).
 *
 * OWNS      the proof that app/cap-chit2.js (DTL006), app/cap-register.js (SCR007), app/cap-supplies.js (SCR009), app/cap-workforce.js (BUS005), app/cap-adopt.js (SCR001),
 *           app/cap-worklist.js (RAL002) and app/cap-network-member.js (SCR031)
 *           carry 157 data-cbsid codes, each INSIDE the tag of the control it names (a removed code, a code moved to another kind of tag, or a swap of two
 *           codes whose handlers differ fails it), that no code is written on two element definitions, that each file carries exactly its own count, and
 *           that every code is a live row in the register UIID_REG names.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-g5.test.cjs   (G5_MUTATE=remove or swap must fail it)
 * FLOW      read each script, find every code, read from the '<' before it to the next '>' and compare with the marker of the control it names, then the register
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails. With UIID_REG set a missing code FAILS.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.G5_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');

/** [file, code, the tag it must sit in, a marker that tag carries] */
const CODES = [
  ["app/cap-chit2.js","DTL006-C01","span","onclick=\"openLightbox"],
  ["app/cap-chit2.js","DTL006-B01","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-B02","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-C02","span","onclick=\"event"],
  ["app/cap-chit2.js","DTL006-C03","span","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-C04","span","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-B03","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-I01","input"," id=\"c"],
  ["app/cap-chit2.js","DTL006-I02","input"," id=\"c"],
  ["app/cap-chit2.js","DTL006-B04","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-C05","span","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-C06","div","onclick=\"openLineCard"],
  ["app/cap-chit2.js","DTL006-I03","input","onclick=\"event"],
  ["app/cap-chit2.js","DTL006-C07","span","onclick=\"event"],
  ["app/cap-chit2.js","DTL006-S01","select"," id=\"c"],
  ["app/cap-chit2.js","DTL006-I04","input"," id=\"c"],
  ["app/cap-chit2.js","DTL006-I05","input"," id=\"c"],
  ["app/cap-chit2.js","DTL006-B05","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-S02","select","onchange=\"c"],
  ["app/cap-chit2.js","DTL006-B06","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-S03","select"," id=\"c"],
  ["app/cap-chit2.js","DTL006-B07","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-B08","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-B09","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-B10","button","onclick=\"c"],
  ["app/cap-chit2.js","DTL006-C08","span","onclick=\"openServiceClock"],
  ["app/cap-register.js","SCR007-B01","button","onclick=\"rgGo"],
  ["app/cap-register.js","SCR007-B02","button","onclick=\"rgSel"],
  ["app/cap-register.js","SCR007-B03","button","onclick=\"rgQuickAdd"],
  ["app/cap-register.js","SCR007-C01","a","onclick=\"event"],
  ["app/cap-register.js","SCR007-B04","button","onclick=\"rgCloseAsk"],
  ["app/cap-register.js","SCR007-S01","select"," id=\"rgNewType"],
  ["app/cap-register.js","SCR007-I01","input"," id=\"rgNewName"],
  ["app/cap-register.js","SCR007-S02","select","onchange=\"rgIntoChanged"],
  ["app/cap-register.js","SCR007-S03","select","onchange=\"rgKindChanged"],
  ["app/cap-register.js","SCR007-I02","input"," id=\"rgBody"],
  ["app/cap-register.js","SCR007-I03","input"," id=\"rgOwner"],
  ["app/cap-register.js","SCR007-I04","input"," id=\"rgDue"],
  ["app/cap-register.js","SCR007-I05","input"," id=\"rgL"],
  ["app/cap-register.js","SCR007-I06","input"," id=\"rgS"],
  ["app/cap-register.js","SCR007-B05","button","onclick=\"rgSave"],
  ["app/cap-register.js","SCR007-B06","button","onclick=\"rgAdd"],
  ["app/cap-register.js","SCR007-S04","select"," id=\"rgResp"],
  ["app/cap-register.js","SCR007-S05","select"," id=\"rgTo"],
  ["app/cap-register.js","SCR007-S06","select"," id=\"rgRel"],
  ["app/cap-register.js","SCR007-I07","input"," id=\"rgNeed"],
  ["app/cap-register.js","SCR007-B07","button","onclick=\"rgScope"],
  ["app/cap-register.js","SCR007-B08","button","onclick=\"rgScope"],
  ["app/cap-register.js","SCR007-S07","select"," id=\"rgEResp"],
  ["app/cap-register.js","SCR007-I08","input"," id=\"rgEOwner"],
  ["app/cap-register.js","SCR007-I09","input"," id=\"rgEL"],
  ["app/cap-register.js","SCR007-I10","input"," id=\"rgES"],
  ["app/cap-register.js","SCR007-I11","input"," id=\"rgERL"],
  ["app/cap-register.js","SCR007-I12","input"," id=\"rgERS"],
  ["app/cap-register.js","SCR007-I13","input"," id=\"rgETreat"],
  ["app/cap-register.js","SCR007-I14","input"," id=\"rgEDue"],
  ["app/cap-register.js","SCR007-B09","button","onclick=\"rgEditSave"],
  ["app/cap-register.js","SCR007-S08","select","onchange=\"rgDispChanged"],
  ["app/cap-register.js","SCR007-S09","select"," id=\"rgCarry"],
  ["app/cap-register.js","SCR007-I15","input"," id=\"rgNote"],
  ["app/cap-register.js","SCR007-B10","button","onclick=\"rgCloseSave"],
  ["app/cap-register.js","SCR007-C02","div","onclick=\"closeModal"],
  ["app/cap-register.js","SCR007-B11","button","onclick=\"rgSubjectClose"],
  ["app/cap-register.js","SCR007-B12","button","onclick=\"rgWalkDir"],
  ["app/cap-register.js","SCR007-B13","button","onclick=\"rgWalkDir"],
  ["app/cap-register.js","SCR007-B14","button","onclick=\"rgWalkFrom"],
  ["app/cap-supplies.js","SCR009-B01","button","onclick=\"supAddModal"],
  ["app/cap-supplies.js","SCR009-B02","button","onclick=\"supBuyModal"],
  ["app/cap-supplies.js","SCR009-B03","button","onclick=\"supUseModal"],
  ["app/cap-supplies.js","SCR009-I01","input"," id=\"sup_name"],
  ["app/cap-supplies.js","SCR009-I02","input"," id=\"sup_unit"],
  ["app/cap-supplies.js","SCR009-I03","input"," id=\"sup_keep"],
  ["app/cap-supplies.js","SCR009-I04","input"," id=\"sup_from"],
  ["app/cap-supplies.js","SCR009-I05","input"," id=\"sup_ref"],
  ["app/cap-supplies.js","SCR009-B04","button","onclick=\"supAddLine"],
  ["app/cap-supplies.js","SCR009-B05","button","onclick=\"supBuy"],
  ["app/cap-supplies.js","SCR009-I06","input","data-testid=\"supply-l-name"],
  ["app/cap-supplies.js","SCR009-I07","input","data-testid=\"supply-l-qty"],
  ["app/cap-supplies.js","SCR009-I08","input","<input data-cbsid=\"SCR009-I08\" class=\"inp\""],
  ["app/cap-supplies.js","SCR009-I09","input","data-testid=\"supply-l-cost"],
  ["app/cap-supplies.js","SCR009-I10","input"," id=\"sup_use_qty"],
  ["app/cap-supplies.js","SCR009-B06","button","onclick=\"supUse"],
  ["app/cap-workforce.js","BUS005-B01","button","onclick=\"closeModal"],
  ["app/cap-workforce.js","BUS005-B02","button","onclick=\"closeModal"],
  ["app/cap-workforce.js","BUS005-B03","button","onclick=\"aiToggle"],
  ["app/cap-workforce.js","BUS005-S01","select","onchange=\"aiSetGate"],
  ["app/cap-workforce.js","BUS005-B04","button","class=\"composebtn pri\""],
  ["app/cap-workforce.js","BUS005-B05","button","disabled title=\""],
  ["app/cap-workforce.js","BUS005-B06","button","onclick=\"aiSlotInfo"],
  ["app/cap-workforce.js","BUS005-C01","div","onclick=\"closeShowcase"],
  ["app/cap-workforce.js","BUS005-B07","button","onclick=\"acTypeInfo"],
  ["app/cap-workforce.js","BUS005-I01","input","onclick=\"openActorWiz"],
  ["app/cap-workforce.js","BUS005-B08","button","onclick=\"openActorWiz"],
  ["app/cap-workforce.js","BUS005-I02","input","oninput=\"UI"],
  ["app/cap-workforce.js","BUS005-B09","button","onclick=\"setAcFlt"],
  ["app/cap-workforce.js","BUS005-B10","button","onclick=\"setAcTypeF"],
  ["app/cap-workforce.js","BUS005-B11","button","onclick=\"awDownloadPkg"],
  ["app/cap-workforce.js","BUS005-C02","div","onclick=\"awPick"],
  ["app/cap-workforce.js","BUS005-S02","select","onchange=\"setAcSort"],
  ["app/cap-workforce.js","BUS005-C03","div","onclick=\"selectActor"],
  ["app/cap-workforce.js","BUS005-C04","div","onclick=\"selectActor"],
  ["app/cap-workforce.js","BUS005-C05","a","onclick=\"openShowcase"],
  ["app/cap-workforce.js","BUS005-B12","button","onclick=\"backToList"],
  ["app/cap-workforce.js","BUS005-B13","button","onclick=\"acOpenManage"],
  ["app/cap-workforce.js","BUS005-B14","button","onclick=\"backToList"],
  ["app/cap-workforce.js","BUS005-B15","button","onclick=\"backToList"],
  ["app/cap-workforce.js","BUS005-B16","button","onclick=\"setAcMode"],
  ["app/cap-workforce.js","BUS005-I03","input"," id=\"ac_ename"],
  ["app/cap-workforce.js","BUS005-I04","input"," id=\"ac_erole"],
  ["app/cap-workforce.js","BUS005-S03","select"," id=\"ac_ehat"],
  ["app/cap-workforce.js","BUS005-I05","input"," id=\"ac_ewhole"],
  ["app/cap-workforce.js","BUS005-S04","select"," id=\"ac_edel"],
  ["app/cap-workforce.js","BUS005-I06","input"," id=\"ac_emax"],
  ["app/cap-workforce.js","BUS005-I07","input"," id=\"ac_ephone"],
  ["app/cap-workforce.js","BUS005-B17","button","onclick=\"acResetPin"],
  ["app/cap-workforce.js","BUS005-B18","button","onclick=\"acReinvite"],
  ["app/cap-workforce.js","BUS005-B19","button","onclick=\"acStatus"],
  ["app/cap-workforce.js","BUS005-B20","button","onclick=\"acStatus"],
  ["app/cap-workforce.js","BUS005-B21","button","onclick=\"acStatus"],
  ["app/cap-adopt.js","SCR001-B01","button","onclick=\"adoptAccept"],
  ["app/cap-adopt.js","SCR001-I01","input","onchange=\"adoptSet"],
  ["app/cap-adopt.js","SCR001-I02","input","oninput=\"adoptSet"],
  ["app/cap-adopt.js","SCR001-I03","input","oninput=\"adoptSet"],
  ["app/cap-adopt.js","SCR001-I04","input","oninput=\"adoptSet"],
  ["app/cap-worklist.js","RAL002-C01","div","onclick=\"wlLine"],
  ["app/cap-worklist.js","RAL002-C02","span","onclick=\"event"],
  ["app/cap-worklist.js","RAL002-C03","div","onclick=\"wlToggle"],
  ["app/cap-worklist.js","RAL002-C04","span","data-testid=\""],
  ["app/cap-worklist.js","RAL002-I01","input","onchange=\"wlThen"],
  ["app/cap-worklist.js","RAL002-I02","input","onchange=\"wlDue"],
  ["app/cap-worklist.js","RAL002-I03","input","onchange=\"wlByItem"],
  ["app/cap-worklist.js","RAL002-I04","input","onchange=\"wlDone"],
  ["app/cap-worklist.js","RAL002-C05","span","onclick=\"wlAll"],
  ["app/cap-worklist.js","RAL002-C06","span","onclick=\"wlAll"],
  ["app/cap-worklist.js","RAL002-C07","div","onclick=\"wlToggle"],
  ["app/cap-worklist.js","RAL002-C08","div","onclick=\"wlSec"],
  ["app/cap-worklist.js","RAL002-C09","span","onclick=\"wlRaidaClosing"],
  ["app/cap-worklist.js","RAL002-B01","button","onclick=\"wlRaidaDisp"],
  ["app/cap-worklist.js","RAL002-I05","input"," id=\"wl_raida_why"],
  ["app/cap-worklist.js","RAL002-B02","button","onclick=\"wlRaidaClose"],
  ["app/cap-worklist.js","RAL002-B03","button","onclick=\"wlRaidaOpen"],
  ["app/cap-worklist.js","RAL002-S01","select"," id=\"wl_who"],
  ["app/cap-worklist.js","RAL002-I06","input"," id=\"wl_due"],
  ["app/cap-worklist.js","RAL002-B04","button","onclick=\"wlSetState"],
  ["app/cap-worklist.js","RAL002-B05","button","onclick=\"wlOpen"],
  ["app/cap-worklist.js","RAL002-B06","button","onclick=\"wlMatOpen"],
  ["app/cap-network-member.js","SCR031-C01","div","onclick=\"netAvailToggle"],
  ["app/cap-network-member.js","SCR031-B01","button","onclick=\"netAskFor"],
  ["app/cap-network-member.js","SCR031-I01","input","oninput=\"UI"],
  ["app/cap-network-member.js","SCR031-I02","input","oninput=\"UI"],
  ["app/cap-network-member.js","SCR031-I03","input","oninput=\"UI"],
  ["app/cap-network-member.js","SCR031-I04","input","oninput=\"UI"],
  ["app/cap-network-member.js","SCR031-C02","span","onclick=\"UI"],
  ["app/cap-network-member.js","SCR031-C03","span","onclick=\"netBrowseBack"],
  ["app/cap-network-member.js","SCR031-C04","span","onclick=\"netOpenInCompose"],
  ["app/cap-network-member.js","SCR031-C05","div","onclick=\"netBrowse"],
  ["app/cap-network-member.js","SCR031-I05","input","oninput=\"netAvailSearch"]
];
const COUNTS = {"app/cap-chit2.js":26,"app/cap-register.js":40,"app/cap-supplies.js":16,"app/cap-workforce.js":40,"app/cap-adopt.js":5,"app/cap-worklist.js":22,"app/cap-network-member.js":11};

const read = (f) => {
  /* a code inside a double-quoted JS string is written escaped (data-cbsid=\"X\"): read the source as the tag it draws */
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n').split('\\"').join('"');
  if (mutate === 'remove') t = t.split('data-cbsid="DTL006-C01"').join('');
  if (mutate === 'swap') t = t.split('DTL006-C01').join('SWAPX').split('DTL006-B01').join('DTL006-C01').split('SWAPX').join('DTL006-B01');
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
