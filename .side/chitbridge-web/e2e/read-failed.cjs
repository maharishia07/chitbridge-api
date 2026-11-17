/**
 * read-failed.cjs — THE ONE FAILED-READ FRAME (CBShell.readFailed, firm frame P0 T2). No browser: the function is cut out of public/app/shell.js and fed the six fixtures of the critic's section 4.
 * Passes when every failure draws the one testid, says what happened in the app's words, prints the server's raw word 0 times, and a 403 uses the server's own sentence (never "check the connection").
 *   node e2e/read-failed.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'shell.js'), 'utf8');
const from = src.indexOf('  /** the sentence a failed read says'), to = src.indexOf('  root.CBShell = {');
assert(from > 0 && to > from, 'readFailed is in shell.js');
const T = (s) => s;
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readFailed = new Function('T', 'esc', src.slice(from, to) + '\nreturn readFailed;')(T, esc);
function host() { const h = { innerHTML: '', firstChild: {}, querySelector() { return h.btn; }, btn: null }; Object.defineProperty(h, 'html', { get: () => h.innerHTML }); return h; }
let n = 0;
const ok = (name, cond) => { assert(cond, name); n += 1; console.log('  ok ' + name); };
const RAW = /Server error|Too many requests|Failed to fetch|Forbidden|Check the connection|Not in a network yet|undefined|\[object/i;
const retry = () => {};
[
  ['429', { status: 429 }], ['500 with an HTML body', { status: 500, detail: '<html>Internal Server Error</html>' }], ['offline (fetch rejected)', { status: 0, detail: 'Failed to fetch' }],
  ['503', { status: 503 }]
].forEach(([name, o]) => {
  const h = host(); readFailed(h, Object.assign({ what: 'Your client list', retry }, o));
  ok(name + ': one frame, the app\'s words, a Try again, no raw word', /data-testid="read-failed"/.test(h.innerHTML) && /Your client list could not be read\. Nothing was changed\./.test(h.innerHTML) && /read-failed-retry/.test(h.innerHTML) && !RAW.test(h.innerHTML) && !/HTML|Internal/.test(h.innerHTML));
});
{
  const h = host(); readFailed(h, { what: 'These books', status: 403, detail: 'Only an owner, or a person with the auditor role, can open another business\'s books.', back: { href: '/network.html', label: 'Back to My network' } });
  ok('403: the server\'s own sentence, the way back, no retry, never "check the connection"', /auditor role/.test(h.innerHTML) && /read-failed-back/.test(h.innerHTML) && !/read-failed-retry/.test(h.innerHTML) && !/connection/.test(h.innerHTML) && /data-status="403"/.test(h.innerHTML));
}
{
  const h = host(); readFailed(h, { what: 'X', status: 403 });
  ok('403 with no server sentence: access, not the connection', /do not have access/.test(h.innerHTML) && !/connection/.test(h.innerHTML));
}
{
  const h = host(); readFailed(h, { what: '<b>"x"</b>', status: 500, retry });
  ok('a name with markup is escaped', !/<b>/.test(h.innerHTML));
}
ok('no host: nothing thrown, nothing drawn', readFailed(null, {}) === null);
console.log('\n  ✓ ' + n + ' passed');
