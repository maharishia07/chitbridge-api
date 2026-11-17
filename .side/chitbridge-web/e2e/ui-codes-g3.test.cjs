'use strict';
// @type: unit
/**
 * ui-codes-g3.test.cjs - wave 2 group G3: six scripts wear their identity codes (UX-137 stamp, 15 Nov), and the 23 re-minted BUS004 codes follow the register.
 *
 * OWNS      the proof that app/cap-admin.js, cap-cmdb.js, cap-connector.js, cap-intake.js, cap-legend.js and cap-match.js carry the 176 data-cbsid codes this stamp
 *           added (171 controls + the 5 Assistant knowledge base inputs, BUS015), each INSIDE the tag of the control it names (a removed code, a code moved to
 *           another kind of tag, or a swap of two codes whose handlers differ fails it), that no code is written on two element definitions, that each file
 *           carries exactly its own added count, and that every code is a live row in the register UIID_REG names.
 * CALLED BY by hand and the QA gate (ci.yml): node e2e/ui-codes-g3.test.cjs   (G3_MUTATE=remove or swap must fail it, exit 1)
 * FLOW      read each script, find every code, read from the '<' before it to the next '>' and compare with the marker of the control it names, then the register
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails. With UIID_REG set a missing code FAILS.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.G3_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');

/** [file, code, the tag it must sit in, a marker that tag carries] */
const CODES = [
  ["app/cap-admin.js","ACC002-I14","input","onchange=\"pfExposureSet"],
  ["app/cap-admin.js","INS001-C01","div","onclick=\"misSetBand"],
  ["app/cap-admin.js","INS001-B01","button","onclick=\"misSetPeriod"],
  ["app/cap-admin.js","INS001-B02","button","onclick=\"aiRun"],
  ["app/cap-admin.js","INS001-C02","div","onclick=\"openChit"],
  ["app/cap-admin.js","INS001-B03","button","onclick=\"misTaxSetMonth"],
  ["app/cap-admin.js","INS001-B04","button"," class=\"on"],
  ["app/cap-admin.js","INS001-B05","button","onclick=\"misTaxSetMonth"],
  ["app/cap-admin.js","INS001-B06","button","onclick=\"misTaxExport"],
  ["app/cap-admin.js","INS001-B07","button","onclick=\"misTaxExport"],
  ["app/cap-admin.js","INS001-C03","b","onclick=\"navTo"],
  ["app/cap-admin.js","INS001-C04","b","onclick=\"navTo"],
  ["app/cap-admin.js","INS001-C05","div","onclick=\"misSetBand"],
  ["app/cap-admin.js","ACC002-B27","button","onclick=\"iamToggle"],
  ["app/cap-admin.js","ACC002-C01","a","onclick=\"profSrcToggle"],
  ["app/cap-admin.js","ACC002-I15","input"," id=\"pf_name"],
  ["app/cap-admin.js","ACC002-I16","input"," id=\"pf_uid"],
  ["app/cap-admin.js","ACC002-S08","select"," id=\"pf_bs"],
  ["app/cap-admin.js","ACC002-S09","select"," id=\"pf_vis"],
  ["app/cap-admin.js","ACC002-S10","select"," id=\"pf_sfaccess"],
  ["app/cap-admin.js","ACC002-B28","button"," class=\"composebtn"],
  ["app/cap-admin.js","ACC002-B29","button"," class=\"composebtn"],
  ["app/cap-admin.js","ACC002-C02","a","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-C03","a","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-C04","a","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-C05","a","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-C06","a","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-B30","button","onclick=\"profGuardDo"],
  ["app/cap-admin.js","ACC002-B31","button","onclick=\"profGuardDo"],
  ["app/cap-admin.js","ACC002-B32","button","onclick=\"profGuardDo"],
  ["app/cap-admin.js","ACC002-I17","input"," id=\"pf_cpin"],
  ["app/cap-admin.js","ACC002-I18","input"," id=\"pf_npin"],
  ["app/cap-admin.js","ACC002-I19","input"," id=\"pf_npin2"],
  ["app/cap-admin.js","ACC002-B33","button","onclick=\"saveActorPin"],
  ["app/cap-admin.js","ACC002-C07","b","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-B34","button"," class=\"govref-go"],
  ["app/cap-admin.js","ACC002-B35","button","onclick=\"govGoTo"],
  ["app/cap-admin.js","ACC002-B36","button","onclick=\"govSetTab"],
  ["app/cap-admin.js","ACC002-B37","button","onclick=\"govToggleGrp"],
  ["app/cap-admin.js","ACC002-C08","a","onclick=\"setSetSec"],
  ["app/cap-admin.js","ACC002-C09","a","onclick=\"setSetSec"],
  ["app/cap-admin.js","ACC002-C10","a","onclick=\"setSetSec"],
  ["app/cap-admin.js","ACC002-C11","div","onclick=\"setSetSec"],
  ["app/cap-admin.js","ACC002-C12","div","onclick=\"intSetTab"],
  ["app/cap-admin.js","ACC002-C13","div","onclick=\"govSetTab"],
  ["app/cap-admin.js","ACC002-B38","button","onclick=\"goCoassistAI"],
  ["app/cap-admin.js","ACC002-B39","button"," type=\"button\""],
  ["app/cap-admin.js","ACC002-C14","a","onclick=\"return"],
  ["app/cap-admin.js","ACC002-S11","select","onchange=\"localeSetCurrency"],
  ["app/cap-admin.js","ACC002-B40","button","onclick=\"localeDiscardLocale"],
  ["app/cap-admin.js","ACC002-S12","select"," class=\"inp"],
  ["app/cap-admin.js","ACC002-B41","button","onclick=\"localeToggleWorkday"],
  ["app/cap-admin.js","ACC002-B42","button","onclick=\"localeToggleLang"],
  ["app/cap-admin.js","ACC002-C15","a","onclick=\"localeResetWorkdays"],
  ["app/cap-admin.js","ACC002-B43","button","onclick=\"intApprove"],
  ["app/cap-admin.js","ACC002-B44","button","onclick=\"intReject"],
  ["app/cap-admin.js","ACC002-B45","button","onclick=\"intDownloadKit"],
  ["app/cap-admin.js","ACC002-C16","span","onclick=\"intToggleCard"],
  ["app/cap-admin.js","ACC002-I20","input"," type=\"checkbox\""],
  ["app/cap-admin.js","ACC002-C17","span","onclick=\"intToSetup"],
  ["app/cap-admin.js","ACC002-C18","span","onclick=\"intFoldToggle"],
  ["app/cap-admin.js","ACC002-S13","select","onchange=\"intStreamSet"],
  ["app/cap-admin.js","ACC002-C19","span","onclick=\"intRecRaw"],
  ["app/cap-admin.js","ACC002-B46","button","onclick=\"intRecSkip"],
  ["app/cap-admin.js","ACC002-B47","button","onclick=\"intRecRetry"],
  ["app/cap-admin.js","ACC002-B48","button","onclick=\"intRecSkip"],
  ["app/cap-admin.js","BUS004-B23","button","onclick=\"netoPolicy"],
  ["app/cap-admin.js","BUS004-B24","button","onclick=\"netoRelease"],
  ["app/cap-admin.js","BUS004-B25","button","onclick=\"netoRelease"],
  ["app/cap-admin.js","BUS004-B26","button","onclick=\"netoWithdraw"],
  ["app/cap-admin.js","BUS004-B27","button","onclick=\"netoChoice"],
  ["app/cap-admin.js","BUS004-B28","button","onclick=\"netoChoice"],
  ["app/cap-admin.js","BUS004-I45","input"," type=\"checkbox\""],
  ["app/cap-admin.js","BUS004-I46","input"," type=\"checkbox\""],
  ["app/cap-admin.js","BUS004-B29","span","onclick=\"event.preventDefault"],
  ["app/cap-admin.js","BUS004-I47","input"," type=\"checkbox\""],
  ["app/cap-admin.js","BUS004-B30","button","onclick=\"netcPublish"],
  ["app/cap-admin.js","BUS004-B31","button","onclick=\"netcPublish"],
  ["app/cap-admin.js","BUS004-B32","button","onclick=\"netcAnswer"],
  ["app/cap-admin.js","BUS004-B33","button","onclick=\"netcAnswer"],
  ["app/cap-admin.js","BUS004-B34","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B35","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B36","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B37","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B38","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B39","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-I48","input"," id=\"netm_handle"],
  ["app/cap-admin.js","BUS004-B40","button","onclick=\"netmInvite"],
  ["app/cap-admin.js","BUS004-B41","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B20","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B21","button","onclick=\"netmAct"],
  ["app/cap-admin.js","BUS004-B22","button","onclick=\"netmAsk"],
  ["app/cap-admin.js","ACC002-B49","button","onclick=\"ctrRelease"],
  ["app/cap-admin.js","ACC002-B50","button","onclick=\"ctrOpenHere"],
  ["app/cap-admin.js","ACC002-I21","input"," id=\"ctr_new_name"],
  ["app/cap-admin.js","ACC002-B51","button","onclick=\"ctrAdd"],
  ["app/cap-admin.js","ACC002-B52","button","onclick=\"intCounterClose"],
  ["app/cap-admin.js","ACC002-B53","button","onclick=\"intCounterCloseDups"],
  ["app/cap-admin.js","ACC002-B54","button","onclick=\"intKeyRevoke"],
  ["app/cap-admin.js","ACC002-I22","input"," id=\"int_key_name"],
  ["app/cap-admin.js","ACC002-S14","select"," id=\"int_key_scope"],
  ["app/cap-admin.js","ACC002-B55","button","onclick=\"intKeyMint"],
  ["app/cap-admin.js","ACC002-I23","input","onchange=\"bizPick"],
  ["app/cap-admin.js","ACC002-I24","input"," id=\"biz_abroad_on"],
  ["app/cap-admin.js","ACC002-C20","a","onclick=\"go"],
  ["app/cap-admin.js","ACC002-B56","button","onclick=\"bizLedgerSwitch"],
  ["app/cap-admin.js","ACC002-B57","button","onclick=\"bizLedgerSwitch"],
  ["app/cap-admin.js","ACC002-S15","select"," class=\"inp"],
  ["app/cap-admin.js","ACC002-C21","a","onclick=\"navTo"],
  ["app/cap-admin.js","ACC002-S16","select"," id=\"st_am"],
  ["app/cap-admin.js","ACC002-I25","input"," id=\"st_mt"],
  ["app/cap-admin.js","ACC002-I26","input"," id=\"st_av"],
  ["app/cap-admin.js","ACC002-I27","input"," id=\"st_ar"],
  ["app/cap-admin.js","ACC002-B58","button","onclick=\"saveSettings"],
  ["app/cap-admin.js","ACC002-C22","span","onclick=\"chToggleAdd"],
  ["app/cap-admin.js","ACC002-C23","span","onclick=\"chUnbind"],
  ["app/cap-admin.js","ACC002-I28","input","onchange=\"chSetAutoRaise"],
  ["app/cap-admin.js","ACC002-C24","span","onclick=\"chSetTemplate"],
  ["app/cap-admin.js","ACC002-I29","input"," id=\"ch_addr"],
  ["app/cap-admin.js","ACC002-I30","input"," id=\"ch_label"],
  ["app/cap-admin.js","ACC002-B59","button","onclick=\"chBind"],
  ["app/cap-admin.js","ACC002-S17","select"," id=\"st_aam"],
  ["app/cap-admin.js","ACC002-S18","select"," id=\"st_ada"],
  ["app/cap-admin.js","ACC002-B60","button","onclick=\"saveAutoAssign"],
  ["app/cap-admin.js","BUS015-I01","input"," id=\"kb_q"],
  ["app/cap-admin.js","BUS015-T01","textarea"," id=\"kb_a"],
  ["app/cap-admin.js","BUS015-I02","input"," id=\"kb_c"],
  ["app/cap-admin.js","BUS015-B01","button","onclick=\"publishAnswer"],
  ["app/cap-admin.js","BUS015-B02","button","onclick=\"kbNew"],
  ["app/cap-cmdb.js","SCR011-B01","button","onclick=\"cmdbFilter"],
  ["app/cap-cmdb.js","SCR011-B02","button","onclick=\"cmdbMinimise"],
  ["app/cap-cmdb.js","SCR011-B03","button","onclick=\"cmdbSet"],
  ["app/cap-cmdb.js","SCR011-S01","select","onchange=\"cmdbFilter"],
  ["app/cap-cmdb.js","SCR011-I01","input","oninput=\"cmdbFilter"],
  ["app/cap-connector.js","SCR002-B01","button","onclick=\"openChit"],
  ["app/cap-connector.js","SCR002-B02","button"," title=\""],
  ["app/cap-connector.js","SCR002-B03","button","onclick=\"backToList"],
  ["app/cap-connector.js","SCR002-B04","button","onclick=\"acToggleDevice"],
  ["app/cap-connector.js","SCR002-B05","button","onclick=\"acCreatePackage"],
  ["app/cap-connector.js","SCR002-B06","button","onclick=\"acErpTest"],
  ["app/cap-connector.js","SCR002-B07","button","onclick=\"if"],
  ["app/cap-connector.js","SCR002-B08","button","onclick=\"acRegenKey"],
  ["app/cap-connector.js","SCR002-I01","input"," id=\"ad_topic"],
  ["app/cap-connector.js","SCR002-I02","input"," id=\"ad_dev"],
  ["app/cap-connector.js","SCR002-I03","input"," id=\"ad_path"],
  ["app/cap-connector.js","SCR002-I04","input"," id=\"ad_ref"],
  ["app/cap-connector.js","SCR002-I05","input"," id=\"ad_folder"],
  ["app/cap-connector.js","SCR002-I06","input"," id=\"ad_classes"],
  ["app/cap-connector.js","SCR002-S01","select"," id=\"ad_assignee"],
  ["app/cap-connector.js","SCR002-I07","input"," id=\"ad_notifyemail"],
  ["app/cap-connector.js","SCR002-I08","input"," id=\"ad_cp"],
  ["app/cap-connector.js","SCR002-I09","input"," id=\"rg_name"],
  ["app/cap-connector.js","SCR002-I10","input"," id=\"rg_otp"],
  ["app/cap-connector.js","SCR002-B09","button","onclick=\"acReissueSendCode"],
  ["app/cap-connector.js","SCR002-B10","button","onclick=\"acReissueSubmit"],
  ["app/cap-intake.js","WRK003-B06","button","onclick=\"loadIntake"],
  ["app/cap-intake.js","WRK003-B07","button","onclick=\"intakeToggleSim"],
  ["app/cap-intake.js","WRK003-C01","a","onclick=\"navTo"],
  ["app/cap-intake.js","WRK003-S02","select"," id=\"in_ch"],
  ["app/cap-intake.js","WRK003-I04","input"," id=\"in_from"],
  ["app/cap-intake.js","WRK003-T02","textarea"," id=\"in_text"],
  ["app/cap-intake.js","WRK003-B08","button","onclick=\"intakeSimulate"],
  ["app/cap-intake.js","WRK003-B09","button","onclick=\"intakeRaise"],
  ["app/cap-intake.js","WRK003-B10","button","onclick=\"intakeMakeChit"],
  ["app/cap-intake.js","WRK003-B11","button","onclick=\"intakeStructure"],
  ["app/cap-intake.js","WRK003-B12","button","onclick=\"intakeDismiss"],
  ["app/cap-intake.js","WRK003-B13","button","onclick=\"intakeShowJson"],
  ["app/cap-intake.js","WRK003-C02","span","onclick=\"_copyJson"],
  ["app/cap-legend.js","SCR006-B01","button","onclick=\"setLbTab"],
  ["app/cap-match.js","BUS003-B01","button","onclick=\"MATCH.only"],
  ["app/cap-match.js","BUS003-S01","select","onchange=\"MATCH.days"],
  ["app/cap-match.js","BUS003-B02","div","onkeydown=\"if"],
  ["app/cap-match.js","BUS003-B03","button","onclick=\"matchDispute"],
  ["app/cap-match.js","BUS003-B04","button","onclick=\"openChit"],
  ["app/cap-match.js","BUS003-T01","textarea"," id=\"match_reason"],
  ["app/cap-match.js","BUS003-B05","button","onclick=\"matchDisputeSend"]
];
const COUNTS = {"app/cap-admin.js":129,"app/cap-cmdb.js":5,"app/cap-connector.js":21,"app/cap-intake.js":13,"app/cap-legend.js":1,"app/cap-match.js":7};

const read = (f) => {
  /* a code inside a double-quoted JS string is written escaped (data-cbsid=\"X\"): read the source as the tag it draws */
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n').split('\\"').join('"');
  if (mutate === 'remove') t = t.split('data-cbsid="BUS015-B01"').join('');
  if (mutate === 'swap') t = t.split('BUS015-B01').join('SWAPX').split('BUS015-B02').join('BUS015-B01').split('SWAPX').join('BUS015-B02');
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
  const mine = new Set(CODES.filter((c) => c[0] === f).map((c) => c[1]));
  /* the file may carry older codes of other lanes: only the codes this stamp added are counted, but every code in the file is checked for a second definition */
  for (const m of text(f).matchAll(/data-cbsid=[\\]?"([A-Z]{3}\d{3}-[A-Z]\d{2})/g)) { seen[m[1]] = (seen[m[1]] || 0) + 1; if (mine.has(m[1])) n++; }
  check(n === COUNTS[f], f + ' carries exactly ' + COUNTS[f] + ' of the codes this stamp added: ' + n);
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
