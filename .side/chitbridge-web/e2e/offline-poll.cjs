/**
 * e2e/offline-poll.cjs — the background refresh must not run when there is no network.
 *
 * Athi, 2026-08-21: *"the screen keeps refreshing — even if net is not there, it is refreshing and stating
 * reading data."*
 *
 * ⚠️⚠️ autoRefresh() HAD SIX GUARDS AND NOT ONE OF THEM ASKED WHETHER THERE WAS A NETWORK. No token, hidden
 * tab, compose open, modal open, lightbox open, a focused input, an open detail — every one about whether the
 * refresh would DISTURB someone, none about whether it could SUCCEED. So on a dead connection it fired every
 * 20 seconds, failed, fell back to the service-worker cache and repainted the same rows.
 *
 * ⭐ NOT ONLY COSMETIC: each cycle wakes the radio on a phone that has no signal — exactly when battery matters.
 *
 * ⚠️ THE LISTENER MUST BE REGISTERED ONCE. startAutoRefresh() runs on every sign-in; a listener added each time
 * would fire N refreshes on the Nth reconnect, which is the multiplication this change exists to remove.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const fn = (name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let j = src.indexOf('{', i), d = 0, k = j;
  for (; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } }
  return src.slice(i, k + 1);
};

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const auto = fn('autoRefresh');
const start = fn('startAutoRefresh');
const hook = fn('hookOnlineRefresh');

console.log('\n── the poller asks whether it can succeed ──');
t('autoRefresh checks CBOffline.online()', /CBOffline\.online\(\)/.test(auto));
/**
 * ⚠️ AND IT MUST CHECK BEFORE IT FETCHES. A connectivity test placed after loadNotifs() would let one request
 * out per tick — which is the whole cost, since the repaint is what a person sees.
 */
const iOnline = auto.indexOf('CBOffline.online()');
const iFetch = Math.min(...['loadNotifs(', 'loadList(', 'loadDisputes('].map((s) => {
  const k = auto.indexOf(s); return k < 0 ? Number.MAX_SAFE_INTEGER : k;
}));
t('  …before it issues any request', iOnline >= 0 && iOnline < iFetch, 'guard@' + iOnline + ' fetch@' + iFetch);

console.log('\n── it catches up when the signal returns ──');
t('an online listener exists', /addEventListener\('online'/.test(hook));
t('  …and it refreshes rather than only flushing writes', /autoRefresh\(\)/.test(hook));
t('  …only while signed in', /SESSION\.token/.test(hook));
/* ⭐ THE ASSERTION THAT KEEPS IT SANE: registered once, however many times sign-in happens. */
t('  …registered once, not once per sign-in', /_onlineHooked/.test(hook));
t('startAutoRefresh installs it', /hookOnlineRefresh\(\)/.test(start));

console.log('\n── the guards that were already there are untouched ──');
[['a signed-out tab', /SESSION\.token/], ['a hidden tab', /document\.hidden/],
 ['an open modal', /modalhost/], ['a focused input', /activeElement/],
 ['an open detail', /UI\.detail/]].forEach(([what, re]) =>
  t('still skips for ' + what, re.test(auto)));

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
