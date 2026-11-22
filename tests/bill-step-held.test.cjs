/**
 * bill-step-held.test.cjs — F3 (1128): a failed bill step is retried once, then held on the owner's desk; never silent.
 * Figures: writeStep fails on call 1 only -> 'retried', 2 calls, no ticket; fails twice -> 'held', 2 calls, 1 ticket (audience 'here', key billstep:<chit>:completed); ticket also fails -> 'lost'.
 * Run: node tests/bill-step-held.test.cjs
 */
'use strict';
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w))); };
(async () => {
  const { writeBillStep } = require('../lib/chit-move');
  const step = { code: 'B-2100', step: 'completed', label: 'Completed' };
  const run = async (failures, raiseFails) => {
    let calls = 0; const tickets = [];
    const out = await writeBillStep('e1', 'c1c1c1c1-0000', step, { id: 'u', name: 'U' }, {
      writeStep: async () => { calls += 1; if (calls <= failures) throw new Error('pool error'); },
      raise: async (t) => { if (raiseFails) throw new Error('down'); tickets.push(t); return { raised: true }; }
    });
    return [out, calls, tickets.length, tickets[0] && tickets[0].audience, tickets[0] && tickets[0].client_ref];
  };
  eq('writes at once', await run(0), ['written', 1, 0, undefined, undefined]);
  eq('first fails, retry writes', await run(1), ['retried', 2, 0, undefined, undefined]);
  eq('both fail: held for the owner', await run(2), ['held', 2, 1, 'here', 'billstep:c1c1c1c1-0000:completed']);
  eq('both fail and the ticket fails: lost, said', (await run(2, true)).slice(0, 3), ['lost', 2, 0]);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
