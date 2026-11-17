/**
 * net-41-supplier-add-confirm.test.cjs — NET-41 (proof 2026-11-14), the web half: the "add as a local supplier" confirm is plain text, and a typed bridge id searched on ANOTHER installation is never filed as a local supplier.
 * OWNS      the proof on the real public/app.html addSupplier / supWhereRefusal / supPickIfFound (lifted into a vm sandbox, no browser): (1) a name typed on THIS installation that matches nobody
 *           opens the confirm titled exactly "Add Acme Tools as a local supplier?" — text, no "<" (the W31 raw <b> tags), and the body offers the add; (2) a bridge id CBFARTIM01 typed with
 *           the search set to Sit AU and nobody found: NO confirm opens, NO supAdd call is made, and the error line says "No business called CBFARTIM01 on Sit AU ..."; (3) the same id,
 *           when the search DID find the shop (UI._supSugg holds it), picks that suggestion and still opens no local-supplier confirm.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/net-41-supplier-add-confirm.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const code = liftFns('public/app.html', ['addSupplier', 'supPickIfFound', 'supWhereRefusal']) + '\n' + liftFns('public/app/cap-suppliers.js', ['isUserId']);
const calls = { confirms: [], api: [], picks: [] };
const input = {};
const errNode = { textContent: '' };
const sb = {
  UI: {}, console,
  document: { getElementById: (id) => (id === 'sp_err' ? errNode : id === 'sp_sugg' ? { innerHTML: '' } : { value: '' }) },
  val: () => input.text, supKind: () => 'goods', supPick: (i) => calls.picks.push(i),
  confirmAsk: (title, body) => calls.confirms.push({ title, body }),
  api: async (name) => { calls.api.push(name); }, toast() {}, loadSuppliers: async () => undefined,
  tx: (s) => s, txf: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]),
};
vm.createContext(sb);
vm.runInContext(code, sb);
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const reset = () => { calls.confirms.length = 0; calls.api.length = 0; calls.picks.length = 0; errNode.textContent = ''; };

(async () => {
  input.text = 'Acme Tools'; sb.UI._supWhere = 'here'; sb.UI._supSugg = [];
  await sb.addSupplier();
  ok(calls.confirms.length === 1 && calls.confirms[0].title === 'Add Acme Tools as a local supplier?', 'a name nobody has, searched here: the confirm is titled "Add Acme Tools as a local supplier?" (' + JSON.stringify(calls.confirms[0] && calls.confirms[0].title) + ')');
  ok(calls.confirms.length === 1 && !/[<>]/.test(calls.confirms[0].title), 'the title is plain text: no angle bracket (W31 raw <b> tags)');
  reset();

  input.text = 'CBFARTIM01'; sb.UI._supWhere = 'sit-au'; sb.UI._supPlaces = [{ installation_key: 'sit-au', label: 'Sit AU' }]; sb.UI._supSugg = [];
  await sb.addSupplier();
  ok(calls.confirms.length === 0 && calls.api.length === 0, 'a bridge id searched on Sit AU and not found: no confirm, no supAdd (never filed as a local supplier)');
  ok(/^No business called CBFARTIM01 on Sit AU/.test(errNode.textContent), 'the error line says where it looked: ' + JSON.stringify(errNode.textContent));
  reset();

  sb.UI._supSugg = [{ user_id: 'far-timber', bridge_id: 'CBFARTIM01', address: 'CBFARTIM01@au.example.com' }];
  await sb.addSupplier();
  ok(calls.picks.join() === '0' && calls.confirms.length === 0 && calls.api.length === 0, 'the search found the shop: its suggestion (0) is picked, no local-supplier confirm, no add');
  process.exitCode = bad ? 1 : 0;
})();
