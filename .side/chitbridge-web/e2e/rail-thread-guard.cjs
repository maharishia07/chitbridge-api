'use strict';
/**
 * rail-thread-guard.cjs — ONE COMPOSER IN THE WEB REPO FOR POST /chits/:id/messages (R02 · invariant 1).
 *
 * ⭐ The unit is CBThread (public/app/rail-thread.js): the one EP row for the POST (`sendMsg`), the one api() call that sends, the
 *   audience line, the line_id, the dispute scoping, the busy state. Before R02 four files posted to that route (app.html, cap-messages,
 *   cap-dispute, cap-worklist) and each was a place for one of those to drift. A second caller anywhere else fails the build here:
 *     · an EP row { m:'POST', p:'/api/chits/:id/messages' } in any file but the unit
 *     · api('<that row's name>') — or one of the retired names msgReply · sendMsg · wlMsgAdd — outside the unit
 *     · a raw fetch() to a /messages path with a POST method outside the unit
 * ⭐ A host that needs to send goes through CBThread.send / mount (answerPublish does; M28 Remind will).
 * ⭐ The guard proves itself: it plants each of the three in a copy and must find all three, every run.
 * ⚠️ public/till.html is VENDORED from chitbridge-api (its composer, if any, is fixed there) — out of scope, said so.
 *
 * Run: node e2e/rail-thread-guard.cjs        exit 1 on a second composer
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const UNIT = 'app/rail-thread.js';
const ROUTE = '/api/chits/:id/messages';
const LEGACY = ['msgReply', 'sendMsg', 'wlMsgAdd'];
const FILES = fs.readdirSync(PUB).filter((f) => /\.html$/.test(f) && f !== 'till.html').concat(
  fs.readdirSync(path.join(PUB, 'app')).filter((f) => /\.js$/.test(f)).map((f) => 'app/' + f));

/** the names every file registers for the POST route: { name → [file] } */
function rows(src) {
  const out = [], re = /([A-Za-z_$][\w$]*)\s*:\s*\{\s*m\s*:\s*["']POST["']\s*,\s*p\s*:\s*["']([^"']+)["']/g; let m;
  while ((m = re.exec(src))) if (m[2] === ROUTE) out.push(m[1]);
  return out;
}
/** every finding in one source text (not the unit): [{ line, why, text }] */
function scan(src, names) {
  const out = [];
  src.split(/\r?\n/).forEach((ln, i) => {
    const code = ln.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (rows(code).length) out.push({ line: i + 1, why: 'a second EP row for POST ' + ROUTE + ' — the one row is CBThread.EP.sendMsg', text: code.trim().slice(0, 110) });
    for (const n of names) { const re = new RegExp('\\bapi\\s*\\(\\s*["\']' + n + '["\']'); if (re.test(code)) out.push({ line: i + 1, why: 'api(\'' + n + '\') outside the unit — send through CBThread.send / mount', text: code.trim().slice(0, 110) }); }
    if (/\bfetch\s*\(/.test(code) && /\/messages\b/.test(code) && /["']POST["']/.test(code)) out.push({ line: i + 1, why: 'a raw POST to a /messages route — send through CBThread', text: code.trim().slice(0, 110) });
  });
  return out;
}

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  XX  ') + m); if (!c) fail++; };

const SRC = {}; for (const f of FILES) SRC[f] = fs.readFileSync(path.join(PUB, f), 'utf8');
ok(!!SRC[UNIT] && /sendMsg:\s*\{\s*m:\s*'POST'/.test(SRC[UNIT]) && /root\.CBThread\s*=/.test(SRC[UNIT]) && /CBAction\.run\(/.test(SRC[UNIT]),
  'the unit exists: ' + UNIT + ' registers sendMsg, publishes CBThread, and sends through CBAction.run');
const names = new Set(LEGACY);
for (const f of FILES) for (const n of rows(SRC[f] || '')) names.add(n);
for (const f of FILES) {
  if (f === UNIT) continue;
  const r = scan(SRC[f], [...names]);
  ok(r.length === 0, f + ': no composer of its own' + (r.length ? '\n' + r.map((x) => '        line ' + x.line + ' · ' + x.why + ' · ' + x.text).join('\n') : ''));
}

/* the Replies inbox says in words that it could not read the messages (never a silent empty list) */
ok(/Could not read your messages./.test(fs.readFileSync(path.join(PUB, 'app/cap-messages.js'), 'utf8')),
  'cap-messages: when the inbox cannot be read it says "Could not read your messages." (the could-not-read words)');

/* the guard proves itself */
const planted = "var EP2 = { mine: { m: 'POST', p: '/api/chits/:id/messages', ok: 'y' } };\n"
  + "async function x(id){ await api('sendMsg', { params: { id } }); }\n"
  + "fetch(CFG.API_BASE + '/api/chits/' + id + '/messages', { method: 'POST' });";
const pr = scan(planted, [...names, 'mine']);
ok(pr.filter((x) => /second EP row/.test(x.why)).length === 1 && pr.filter((x) => /outside the unit/.test(x.why)).length === 1 && pr.filter((x) => /raw POST/.test(x.why)).length === 1,
  'PLANTED: an EP row, an api(\'sendMsg\') and a raw POST fetch are all caught (' + pr.length + ' findings)');
ok(scan("await CBThread.send({ chit_id: id, text: a, thread_type: 'external' });\n  messages: { m: 'GET', p: '/api/chits/:id/messages', ok: 'y' },", [...names]).length === 0,
  'CBThread.send and the GET row are not findings');

console.log(fail ? '\nrail-thread-guard: FAIL' : '\nrail-thread-guard: PASS');
process.exit(fail ? 1 : 0);
