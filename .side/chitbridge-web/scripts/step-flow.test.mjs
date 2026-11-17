/**
 * step-flow.test.mjs — the rules of the shared wizard, headless.
 *
 * ⚠️ ESM, imported for SIDE EFFECTS — step-flow.js is a browser file that attaches to `window`; under this
 * package's "type": "module" it lands on globalThis, which is what a browser would give it too.
 *
 * These are the STEP rules only. The cart's rules live in cart-ui.test.mjs and are not restated here — the whole
 * point of two helpers is that neither has to know the other's business.
 */
/* T2-WEBPRIMS: the page loads app/helpers.js first (its one esc) — so does this harness */
const { runInThisContext } = await import('node:vm'); const { readFileSync } = await import('node:fs');
runInThisContext(readFileSync(new URL('../public/app/helpers.js', import.meta.url), 'utf8'));
await import('../public/app/step-flow.js');
const K = globalThis.CBSteps;

let failed = 0;
function ok(label, cond) {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
}

/* A supplier-shaped flow: three steps, because the counterparty IS the recipient. */
const S = { lines: 0, addr: '', sent: 0, drafted: 0, cancelled: 0, painted: [] };
const flow = K.create({
  steps: [{ k: 'items', n: 'Items', t: 'What do you need?' },
          { k: 'details', n: 'Details', t: 'When and where' },
          { k: 'review', n: 'Review', t: 'Check it, then send' }],
  render: (k) => { S.painted.push(k); return '<i>' + k + '</i>'; },
  guard: (k) => {
    if (k === 'items' && !S.lines) return 'Add at least one item.';
    if (k === 'details' && !S.addr.trim()) return 'A delivery address is required.';
    return null;
  },
  sendLabel: () => 'Send order to Beta',
  cancelLabel: 'Their details',
  draftLabel: 'Save draft',
  onSend: () => { S.sent++; },
  onDraft: () => { S.drafted++; },
  onCancel: () => { S.cancelled++; },
});

console.log('\nstep-flow · the shape a screen declares');
ok('★ a screen declares its own steps — this file hardcodes none',
   flow.steps().length === 3 && flow.step() === 'items');
ok('it starts at the first step', flow.index() === 0 && !flow.isLast());

console.log('\nstep-flow · ⚠️ the guard is a REASON, never a boolean');
ok('★★ a blocked step SAYS what is missing', flow.blockedBecause() === 'Add at least one item.');
ok('★★ …and the reason reaches the button, so a dead control explains itself',
   flow.footHTML().includes('disabled') && flow.footHTML().includes('Add at least one item.'));
ok('★ …in words as well as a title — nobody hovers on a phone',
   flow.footHTML().includes('data-testid="step-why-'));
flow.next();
ok('★★ a blocked step does NOT advance', flow.index() === 0);

S.lines = 2;
ok('answering it clears the reason', flow.blockedBecause() === null);
ok('★ the button names where it is going, rather than just "Next"',
   flow.footHTML().includes('Next: Details →'));
flow.next();
ok('…and now it advances', flow.index() === 1 && flow.step() === 'details');

console.log('\nstep-flow · moving about');
ok('★ back goes back', (flow.back(), flow.index() === 0));
ok('★ the rail marks done / now, and offers the done one as a way back',
   flow.railHTML().includes('cbst now') && flow.railHTML().includes('data-testid="step-items"'));
flow.next();
/* ⚠️ THE RAIL MUST NOT BE A WAY AROUND THE GUARD. Details is unanswered, so Review is unreachable from here even
   though its chip is drawn. */
ok('★★ you cannot skip FORWARD past something unanswered', !flow.canReach(2) && (flow.go(2), flow.index() === 1));
ok('★ …and the unreachable chip is not clickable', !flow.railHTML().includes("CBSteps.go('" + flow.ns + "',2)"));
S.addr = '16a Hill Side';
ok('★ answering it makes the step reachable again', flow.canReach(2) && (flow.go(2), flow.index() === 2));
ok('★ going BACK is always allowed — that is how a mistake gets corrected',
   flow.canReach(0) && (flow.go(0), flow.index() === 0) && (flow.go(2), true));

console.log('\nstep-flow · the last step');
ok('★ the last step knows it is last', flow.isLast() && flow.step() === 'review');
ok('★ …and the primary button becomes the SEND, named for what it sends',
   flow.footHTML().includes('Send order to Beta') && flow.footHTML().includes('CBSteps.send'));
flow.paintFoot();                        // no DOM here; must not throw
K.send(flow.ns);
ok('★ sending calls the screen back', S.sent === 1);
K.draft(flow.ns);
ok('★ save draft is the screen\'s too', S.drafted === 1);

/**
 * ⚠️ THE REVIEW STEP RE-ASKS EVERY EARLIER ONE. Someone can reach Review, click a chip back to Items, empty the
 * cart, and return — and Review is where they commit. A guard that only asked about Review would let that send.
 */
S.lines = 0;
ok('★★ Review names the FIRST thing missing anywhere, not just its own',
   flow.blockedBecause() === 'Add at least one item.');
K.send(flow.ns);
ok('★★ …and refuses to send while anything is missing', S.sent === 1);
S.lines = 2;

console.log('\nstep-flow · back off the first step is the way out');
flow.go(0);
ok('★ back on step one cancels rather than going nowhere', (flow.back(), S.cancelled === 1));
ok('★ …and the first step offers the screen\'s own label for it', flow.footHTML().includes('Their details'));

console.log('\nstep-flow · reset and release');
flow.go(2);
ok('★ reset returns to the first step — a new supplier is a fresh start',
   (flow.reset(), flow.index() === 0));
const other = K.create({ steps: [{ k: 'a', n: 'A' }, { k: 'b', n: 'B' }], render: () => 'x' });
other.next();
ok('★★ two flows are INDEPENDENT', other.index() === 1 && flow.index() === 0);
other.destroy();
ok('★ destroy releases it', other.blockedBecause() === null && other.steps().length === 0);

console.log('\nstep-flow · a four-step screen (compose keeps its To)');
const cc = K.create({
  steps: [{ k: 'items', n: 'Items' }, { k: 'to', n: 'To' }, { k: 'details', n: 'Details' }, { k: 'review', n: 'Review' }],
  render: () => '', guard: () => null,
});
ok('★ four steps where the recipient is genuinely unknown', cc.steps().length === 4 && cc.steps()[1].k === 'to');
/* `class="cbst[" ]` — the container is `cbst-rail`, which a bare /cbst/ would count as a fifth chip. */
ok('★ the rail renders one chip per step', (cc.railHTML().match(/class="cbst[" ]/g) || []).length === 4);
cc.destroy();

console.log('\n  ' + (failed ? failed + ' FAILED' : 'all passed') + '\n');
process.exit(failed ? 1 : 0);
