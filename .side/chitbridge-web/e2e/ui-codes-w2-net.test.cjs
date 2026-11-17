'use strict';
// @type: unit
/**
 * ui-codes-w2-net.test.cjs - the identity codes of the w2-net lane (UX-137, one-pass, 13 Nov): ten files each control of which wears its register code.
 *
 * OWNS      the proof that every control of network-app.js, cap-suppliers.js, catalogue-lines.js, chit-sheet.js, rail-thread.js, rail-advice.js,
 *           register-form.js, signin-ui.js, signin-lab.html and the Copy-the-key button of cap-settings.js carries a data-cbsid, that each code sits
 *           INSIDE its own tag (the tag name and the text that follows the code are pinned, so a swap of two codes fails), that no code is written
 *           twice, and that the counts per file hold (55 coded elements in all; NET001-B03 retired: the retry is CBShell.readFailed, CMP009-B01).
 *           Known limit: SCR054-B04 and SCR054-B08 are the same Back button drawn in two steps, so a swap of those two is not told apart.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-w2-net.test.cjs   (W2NET_MUTATE=remove or W2NET_MUTATE=swap must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/screen-library
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as
 *           pending (the docs PR lands the rows); a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.W2NET_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** code, file, tag name, the text that follows the code in its own tag */
const WANT = [
  ["NET001-B01","app/network-app.js","button","type=\"button\" role=\"tab\" class=\"nw-tab' + (N.tab === item[0] ? '"],
  ["NET001-B02","app/network-app.js","button","type=\"button\" class=\"mx\" data-testid=\"nw-close\" aria-label=\"' + "],
  ["NET002-B01","app/network-app.js","button","type=\"button\" class=\"act\" id=\"nw_in\" data-testid=\"nw-offer-in\">'"],
  ["NET002-B02","app/network-app.js","button","type=\"button\" class=\"act quiet\" id=\"nw_outb\" data-testid=\"nw-off"],
  ["NET003-B01","app/network-app.js","button","type=\"button\" class=\"act\" id=\"nw_check\" data-testid=\"nw-check\"' "],
  ["BUS002-B01","app/cap-suppliers.js","button","type=\"button\" class=\"act\" data-testid=\"sup-add-open\">+ ' + esc(t"],
  ["BUS002-I01","app/cap-suppliers.js","input","class=\"inp\" id=\"sp_q\" data-testid=\"sup-add-q\" autocomplete=\"off\""],
  ["BUS002-I02","app/cap-suppliers.js","input","type=\"radio\" name=\"sp_kind\" value=\"resale\"' + (listKind !== 'own"],
  ["BUS002-I03","app/cap-suppliers.js","input","type=\"radio\" name=\"sp_kind\" value=\"own_use\"' + (listKind === 'ow"],
  ["BUS002-B02","app/cap-suppliers.js","button","type=\"button\" class=\"act\" data-testid=\"sup-add-go\">' + esc(t('Ad"],
  ["BUS002-B03","app/cap-suppliers.js","button","type=\"button\" class=\"act quiet\" data-x>' + esc(t('Cancel')) + '<"],
  ["BUS002-B04","app/cap-suppliers.js","button","type=\"button\" class=\"act quiet\" data-testid=\"sup-add-local\">' + "],
  ["SCR055-B01","app/catalogue-lines.js","button","type=\"button\" data-testid=\"prod-media-del-' + esc(x.id) + '\" sty"],
  ["SCR050-B01","app/chit-sheet.js","button","type=\"button\" class=\"optchip\" data-testid=\"cs-link-' + index + "],
  ["SCR050-I01","app/chit-sheet.js","input","class=\"inp\" id=\"cs_reason\" data-testid=\"cs-reason\" maxlength=\"50"],
  ["SCR050-B02","app/chit-sheet.js","button","type=\"button\" class=\"optchip\" data-testid=\"cs-reject-go\" onclick"],
  ["SCR050-B03","app/chit-sheet.js","button","type=\"button\" class=\"optchip\" data-testid=\"cs-use-auto\" onclick="],
  ["SCR050-B04","app/chit-sheet.js","button","type=\"button\" class=\"cs-act\" data-testid=\"cs-act-' + item + '\" o"],
  ["SCR050-B05","app/chit-sheet.js","button","type=\"button\" class=\"cs-back\" data-testid=\"cs-close\" aria-label="],
  ["SCR051-B01","app/rail-thread.js","button","type=\"button\" class=\"' + (item === 'external' ? 'ext' : 'int') +"],
  ["SCR051-B02","app/rail-thread.js","button","type=\"button\" class=\"rt-k' + (thread.kind === item ? ' on' : '') + "],
  ["SCR051-S01","app/rail-thread.js","select","class=\"rt-sel\" data-rt-act=\"line\" data-testid=\"rt-line\"><option "],
  ["SCR051-T01","app/rail-thread.js","textarea","data-rt-act=\"text\" data-testid=\"' + esc(ids.text || 'msg-body') "],
  ["SCR051-B03","app/rail-thread.js","button","type=\"button\" class=\"rt-send ' + tone + '\" data-rt-act=\"send\" da"],
  ["SCR052-B01","app/rail-advice.js","button","type=\"button\" class=\"ra-b pri' + (send.ok ? '' : ' off') + '\" da"],
  ["SCR052-B02","app/rail-advice.js","button","type=\"button\" class=\"ra-b\" data-ra-act=\"copy\" data-testid=\"adv-c"],
  ["SCR052-B03","app/rail-advice.js","button","type=\"button\" class=\"ra-b off\" aria-disabled=\"true\" data-testid="],
  ["SCR053-S01","app/register-form.js","select","class=\"inp\" data-testid=\"reg-country\" style=\"width:auto;max-widt"],
  ["SCR053-B01","app/register-form.js","button","class=\"btn gold\" id=\"r_go\" data-testid=\"reg-submit\" ${R.busy ? '"],
  ["SCR053-C01","app/register-form.js","a","onclick=\"regReset()\">${esc(tx('change'))}</a></div> ${regVertica"],
  ["SCR053-B02","app/register-form.js","button","class=\"btn gold\" id=\"r_go\" data-testid=\"reg-submit\" ${R.busy || "],
  ["SCR053-C02","app/register-form.js","a","onclick=\"go('#/login')\">${tx('Sign in')}</a></div> </div> </div>"],
  ["SCR053-C03","app/register-form.js","div","data-testid=\"reg-vertical-' + esc(item.key) + '\" onclick=\"REG.co"],
  ["SCR053-C04","app/register-form.js","a","onclick=\"regTailor();return false\" style=\"color:var(--blue);curs"],
  ["SCR053-C05","app/register-form.js","a","onclick=\"regContact();return false\" style=\"color:var(--blue);cur"],
  ["SCR054-B01","app/signin-ui.js","button","type=\"button\" class=\"cbsi-m\" data-cbsi=\"method\" data-method=\"' +"],
  ["SCR054-I01","app/signin-ui.js","input","name=\"id\" data-testid=\"signin-id\" type=\"text\" inputmode=\"email\" "],
  ["SCR054-B02","app/signin-ui.js","button","type=\"submit\" class=\"cbsi-go\" data-testid=\"signin-go\"' + busy + "],
  ["SCR054-B03","app/signin-ui.js","button","type=\"button\" class=\"cbsi-ch\" data-cbsi=\"choose\" data-i=\"' + ind"],
  ["SCR054-B04","app/signin-ui.js","button","type=\"button\" class=\"cbsi-ln\" data-cbsi=\"back\" data-testid=\"sign"],
  ["SCR054-I02","app/signin-ui.js","input","name=\"cred\" data-el=\"CBSignin.secret@signin-ui.js›credential\" da"],
  ["SCR054-B05","app/signin-ui.js","button","type=\"submit\" class=\"cbsi-go\" data-testid=\"signin-verify\"' + bus"],
  ["SCR054-B06","app/signin-ui.js","button","type=\"button\" class=\"cbsi-ln\" data-cbsi=\"again\" data-testid=\"sig"],
  ["SCR054-B07","app/signin-ui.js","button","type=\"button\" class=\"cbsi-ln\" data-cbsi=\"line\" data-testid=\"sign"],
  ["SCR054-B08","app/signin-ui.js","button","type=\"button\" class=\"cbsi-ln\" data-cbsi=\"back\" data-testid=\"sign"],
  ["SCR054-I03","app/signin-ui.js","input","name=\"pin1\" data-testid=\"signin-pin1\" type=\"password\" inputmode="],
  ["SCR054-I04","app/signin-ui.js","input","name=\"pin2\" data-testid=\"signin-pin2\" type=\"password\" inputmode="],
  ["SCR054-B09","app/signin-ui.js","button","type=\"submit\" class=\"cbsi-go\" data-testid=\"signin-pinsave\"' + bu"],
  ["SCR054-B10","app/signin-ui.js","button","type=\"button\" class=\"cbsi-ln\" data-cbsi=\"later\" data-testid=\"sig"],
  ["SLB001-B01","signin-lab.html","button","type=\"button\" data-tab=\"window\" aria-pressed=\"true\" data-testid="],
  ["SLB001-B02","signin-lab.html","button","type=\"button\" data-tab=\"roadmap\" aria-pressed=\"false\" data-testi"],
  ["SLB001-B03","signin-lab.html","button","type=\"button\" data-' + key + '=\"' + esc(x[0]) + '"],
  ["SLB001-B04","signin-lab.html","button","type=\"button\" data-theme=\"light\" aria-pressed=\"' + !dark + '\">Li"],
  ["SLB001-B05","signin-lab.html","button","type=\"button\" data-theme=\"dark\" aria-pressed=\"' + dark + '\">Dark"],
  ["ACC002-B26","app/cap-settings.js","button","type=\"button\" class=\"act quiet\" id=\"sx_key_copy\" data-testid=\"sx"]
];

/** the source of a file, LF only, with the mutation of this run applied (swap: the first two codes of network-app.js trade places) */
function source(file) {
  let src = fs.readFileSync(path.join(PUB, file), 'utf8').split('\r\n').join('\n');
  if (file === 'app/network-app.js' && mutate === 'remove') src = src.split('data-cbsid="NET001-B01"').join('');
  if (file === 'app/network-app.js' && mutate === 'swap') src = src.split('NET001-B01').join('SWAPX').split('NET001-B02').join('NET001-B01').split('SWAPX').join('NET001-B02');
  return src;
}

/** the code written in a tag of this name, in either quote form (an escaped quote inside a double-quoted string), and the text after it */
function tagOf(src, code) {
  const plain = src.indexOf('data-cbsid="' + code + '"'), escaped = src.indexOf('data-cbsid=\\"' + code + '\\"');
  const at = plain >= 0 ? plain : escaped;
  if (at < 0) return null;
  const open = src.lastIndexOf('<', at);
  const name = (src.slice(open + 1, at).match(/^([a-z]+)\s*$/) || [])[1] || null;
  const attrLen = plain >= 0 ? ('data-cbsid="' + code + '"').length : ('data-cbsid=\\"' + code + '\\"').length;
  return { name, after: src.slice(at + attrLen, at + attrLen + 90).replace(/\s+/g, ' ').replace(/^ /, '') };
}

const FILES = [...new Set(WANT.map((row) => row[1]))];
for (const file of FILES) {
  const src = source(file);
  const mine = WANT.filter((row) => row[1] === file);
  mine.forEach(([code, , name, marker]) => {
    const tag = tagOf(src, code);
    check(tag !== null && tag.name === name && tag.after.indexOf(marker) === 0, file + ' ' + code + ' sits inside its own <' + name + '> tag');
  });
  const written = [...src.matchAll(/data-cbsid=\\?"((?:NET00[123]|BUS002|SCR05[0-5]|SLB001|ACC002)-[A-Z][0-9]{2})\\?"/g)].map((m) => m[1]);
  const dup = written.filter((code, i) => written.indexOf(code) !== i);
  check(dup.length === 0, file + ' writes no code twice' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
}
const perFile = (file) => source(file).match(/data-cbsid=\\?"(?:NET00[123]|SCR05[0-5]|SLB001)-[A-Z][0-9]{2}\\?"/g) || [];
check(WANT.length === 55, 'the table holds 55 coded elements: ' + WANT.length);
check(perFile('app/signin-ui.js').length === 14 && perFile('app/register-form.js').length === 8, 'signin-ui.js has 14 coded elements and register-form.js 8 (its four fields are ui.field mounts, UX-137 wave 3)');

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  note: register ' + p + ' did not parse (' + e.message + ')'); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((row) => { if (row.code) rows[row.code] = row; });
  const all = WANT.map((row) => row[0]), missing = all.filter((code) => !rows[code]), retired = all.filter((code) => rows[code] && rows[code].retired);
  console.log('  register: ' + (all.length - missing.length) + ' of ' + all.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
