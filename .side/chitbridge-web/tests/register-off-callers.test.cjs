'use strict';
/* RAIL-90 (web, pairs api #776): every register caller says "The register is off for your shop." when the api answers 403 CAPABILITY_OFF,
   never a bare error; any other failure keeps its own words. public/app/cap-register.js functions run in a vm with stand-in globals
   (the real registerOffWords from app.html); the callers that need a form on the page are read as source (each api call sits in a try whose
   catch goes through rgFail). The in-app switch is backlog RAIL-90b (cb-settings). Run: node tests/register-off-callers.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const HTML = fs.readFileSync(__dirname + '/../public/app.html', 'utf8');
const SRC = fs.readFileSync(__dirname + '/../public/app/cap-register.js', 'utf8');
const grab = (text, name) => {
  const at = text.search(new RegExp('^(async )?function ' + name + '[(]', 'm'));
  if (at < 0) throw new Error('no ' + name);
  let depth = 0, i = text.indexOf('{', at);
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
  return text.slice(at, i + 1);
};
const OFF_WORDS = 'The register is off for your shop.';
const off = Object.assign(new Error('Forbidden'), { status: 403, data: { code: 'CAPABILITY_OFF' } });
const other = Object.assign(new Error('Server error'), { status: 500, data: { code: 'INTERNAL' } });

function page(fail) {
  const cx = { RG: { busy: false, report: null, err: null, walkFrom: 'S1', walkBack: false, sel: 'S1', walk: null }, toasts: [], tx: (s) => s, txf: (s) => s,
    MSG: { fail: (verb, e) => "Couldn't " + verb + ': ' + e.message }, toast: (m) => cx.toasts.push(m), rgPaint: () => {}, openRegister: async () => {},
    api: async () => { if (fail) throw fail; return { entries: [] }; } };
  vm.createContext(cx);
  vm.runInContext([grab(HTML, 'registerOffWords'), grab(SRC, 'rgFail'), grab(SRC, 'rgWhy'), grab(SRC, 'rgLoad'), grab(SRC, 'rgWalkLoad'), grab(SRC, 'rgSubjectClose'),
    'this.registerOffWords = registerOffWords; this.rgFail = rgFail; this.rgLoad = rgLoad; this.rgWalkLoad = rgWalkLoad; this.rgSubjectClose = rgSubjectClose;'].join('\n'), cx);
  return cx;
}

(async () => {
  ok(page(null).registerOffWords(off) === OFF_WORDS, 'registerOffWords: CAPABILITY_OFF is the sentence');
  ok(page(null).registerOffWords(other) === '' && page(null).registerOffWords(new Error('x')) === '' && page(null).registerOffWords(null) === '', 'any other error, a bare error and null are not it');

  let p = page(off); await p.rgLoad(true);
  ok(p.RG.err === OFF_WORDS, 'opening the register (raidaReport) shows the sentence, not "could not read"');
  p = page(other); await p.rgLoad(true);
  ok(p.RG.err === 'Server error', 'any other failure of the load keeps its own words');
  p = page(off); await p.rgWalkLoad();
  ok(p.RG.walk.err === OFF_WORDS, 'the impact walk (regWalk) shows the sentence');
  p = page(off); await p.rgSubjectClose();
  ok(p.toasts.join() === OFF_WORDS, 'closing a register (regSubjectClose) says the sentence');
  p = page(other); await p.rgSubjectClose();
  ok(p.toasts.join() === "Couldn't close the register: Server error", 'a real failure closing still goes through MSG.fail');
  ok(page(null).rgFail('record it', off) === OFF_WORDS && page(null).rgFail('record it', other) === "Couldn't record it: Server error", 'rgFail: the sentence for off, MSG.fail for the rest');

  /* the callers that read a form: each save function catches through rgFail (a bare MSG.fail in cap-register.js would be a bare error) */
  ok(!/toast\(MSG\.fail\(/.test(SRC), 'no register caller toasts a bare MSG.fail');
  for (const [fn, call] of [['rgSave', 'regSubjectNew'], ['rgSave', 'regEntryAdd'], ['rgSaveOnChit', 'regChitAdd'], ['rgEditSave', 'regEntryRevise'], ['rgCloseSave', 'regEntryClose']]) {
    const body = grab(SRC, fn);
    ok(body.includes("api('" + call + "'") && /catch \(e\) \{[^}]*rgFail\(/.test(body.slice(body.indexOf("api('" + call + "'"))), fn + ': ' + call + ' fails through rgFail');
  }
  const used = [...SRC.matchAll(/api\('(raidaReport|reg[A-Za-z]+)'/g)].map((m) => m[1]);
  ok(new Set(used).size === 10, 'cap-register.js calls the ten register endpoints, all covered above (' + [...new Set(used)].join(', ') + ')');
  console.log(n + ' checks, all ok');
})().catch((e) => { console.error('  FAIL ' + e.message); process.exit(1); });
