/**
 * ppl-49-actors-non-array.test.cjs - PPL-49 (2026-11-14): loadCoassists() given a non-array answer ({}) paints an empty list, not a raw "x.map is not a function".
 * OWNS      loadCoassists() in public/app/cap-workforce.js, lifted and run in a vm sandbox with stubs. CALLED BY .github/workflows/ci.yml (Offline guards).
 *   node e2e/ppl-49-actors-non-array.test.cjs      PPL49_MUTATE=1 reverts the fix in memory and must FAIL
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
let text = liftFns('public/app/cap-workforce.js', ['loadCoassists'], '');
if (process.env.PPL49_MUTATE) text = text.replace(/Array\.isArray\(actorRows\) \? actorRows : \[\]/, '(actorRows || [])');
const errs = [];
const UI = { acts: null, vp: 'desk' };
const sb = {
  UI, STORE: {}, SESSION: {}, document: { getElementById: () => null },
  api: async () => ({}), mapApiActor: (x) => x, paintAcList() {}, paintAcDetail() {}, acVisible: () => [], selectActor() {}, loadConnMap() {},
  scrErr: (e) => { errs.push(e.message); return ''; },
};
vm.createContext(sb);
vm.runInContext(text, sb);
(async () => {
  await sb.loadCoassists();
  let bad = 0;
  const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
  ok(errs.length === 0, 'no error printed for a non-array answer' + (errs.length ? ': ' + errs[0] : ''));
  ok(Array.isArray(UI.acts) && UI.acts.length === 0, 'the list is empty');
  process.exit(bad ? 1 : 0);
})();
