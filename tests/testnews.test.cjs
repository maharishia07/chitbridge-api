/**
 * testnews.test.cjs — THE LOOP CLOSES, AND IT CLOSES ON THE RIGHT PERSON.
 *
 * ── ⚠️⚠️ THE FAULT THIS FILE STANDS AGAINST ─────────────────────────────────────────────────────────────────
 *
 * The board could record a fault and record a fix, and had NO WIRE BETWEEN THEM. Nothing in routes/testing.js
 * emitted anything at all, so:
 *
 *   1 · two people testing one product found the same fault twice and neither knew;
 *   2 · a fixer wrote "resolved" and the person who reported it was never told, so nobody ever verified it —
 *       and the panel folded `resolved` into `closed`, which made a CLAIM look like a settled fact.
 *
 * Athi, 2026-09-13: *"do we have a mechanism of getting the notification when someone raises an incident or a
 * case?"* and *"a message back stating that this issue has been fixed — that feedback loop is not there … so I
 * can retest and confirm that this has been resolved and close it."*
 *
 * ⭐ WHAT IS ACTUALLY ASSERTED HERE is the SHAPE of the news, because the shape is the contract: no finding text
 * on the wire, a kind and a state as separate fields, the actor by id (to skip) and by name (to show), and the
 * one person whose turn it now is. A test that only checked "something was emitted" would have passed on an
 * event nobody could act on.
 *
 * Run: node tests/testnews.test.cjs
 */
'use strict';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

/** a fresh testnews with lib/events swapped for a notebook — no SSE, no sockets, just what was handed over */
function build(emit) {
  const evPath = require.resolve('../lib/events');
  delete require.cache[require.resolve('../lib/testnews')];
  const prev = require.cache[evPath];
  require.cache[evPath] = { id: evPath, filename: evPath, loaded: true, exports: { emit } };
  const news = require('../lib/testnews');
  return { news, restore: () => { if (prev) require.cache[evPath] = prev; else delete require.cache[evPath]; } };
}

const sent = [];
const b = build((ids, payload) => { sent.push({ ids, payload }); return ids.length; });
const { news } = b;

console.log('\n══ 1 · SOMEBODY RAISED SOMETHING, AND THE ROOM HEARS ══');
news.testRaised('ent-1', 'incident', 'INC-260913-0S94', { screen: 'CAT001', by: 'u-athi', byName: 'Athi' });
const raise = sent[0] || { ids: [], payload: {} };
ok(raise.ids.length === 1 && raise.ids[0] === 'ent-1', 'it goes to the entity, and only that entity');
ok(raise.payload.kind === 'test', "kind is 'test' — the third kind on the one pipe, not a second pipe");
ok(raise.payload.what === 'incident', 'what says the KIND of thing');
ok(raise.payload.state === 'raised', "state defaults to 'raised' — a raise need not say so");
ok(raise.payload.ref === 'INC-260913-0S94', 'the human handle travels, so the message can name it');
ok(raise.payload.screen === 'CAT001', 'and where it was found');
ok(raise.payload.by === 'u-athi', "the actor's id, which is how their own tab knows to stay quiet");
ok(raise.payload.who === 'Athi', 'and their name, which is what a person reads');
ok(raise.payload['for'] === null, 'a raise is owed to nobody in particular yet');

console.log('\n══ 2 · ⚠️⚠️ AND IT CARRIES NO FINDING ══');
/* an event carrying the observation would be a SECOND source of truth about a fault, and the day it disagreed
   with the board nobody could say which was right. The client rereads through the RLS-guarded endpoint. */
const KEYS = Object.keys(raise.payload).sort().join(',');
ok(KEYS === 'by,for,kind,ref,screen,state,what,who',
  'exactly the eight fields — no observation, no severity, no screenshot: ' + KEYS);

console.log('\n══ 3 · ⭐⭐⭐ THE RETURN LEG NAMES THE ONE PERSON WAITING ══');
sent.length = 0;
news.testRaised('ent-1', 'incident', 'INC-260913-0S94',
  { state: 'resolved', forId: 'u-athi', by: 'u-dev', byName: 'Dev', screen: 'CAT001' });
const back = sent[0] || { payload: {} };
ok(back.payload.state === 'resolved', 'the state is the news now, not the kind');
ok(back.payload.what === 'incident', '…and the kind is still there, so the sentence can say WHAT was resolved');
ok(back.payload['for'] === 'u-athi', 'for = the raiser: their session says "yours to retest", nobody else\'s');
ok(back.payload.by === 'u-dev' && back.payload.who === 'Dev', 'and the fixer is named, by id and by name');

console.log('\n══ 4 · ⚠️ IT NEVER THROWS AND NEVER BLOCKS ══');
/* an incident that recorded must not fail because a colleague's browser could not be told */
const boom = build(() => { throw new Error('the stream is down'); });
let threw = false;
try { boom.news.testRaised('ent-1', 'incident', 'INC-1', {}); } catch (_) { threw = true; }
ok(!threw, 'a broken pipe is swallowed — the write already happened and must stand');
boom.restore();

const quiet = build(() => { throw new Error('never reached'); });
ok(quiet.news.testRaised('', 'incident', 'X') === 0, 'no entity, no news, no attempt');
ok(quiet.news.testRaised('ent-1', '', 'X') === 0, 'and nothing nameless is announced');
quiet.restore();

console.log('\n══ 5 · THE ROUTES ACTUALLY CALL IT ══');
/* ⚠️ a notification library nothing calls is the same as no notification library — this is the wiring, read
   from the source, because the six emits are in six different handlers and any one of them can be lost to a
   region replace. That has happened in this repo before. */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'routes', 'testing.js'), 'utf8');
const calls = (src.match(/testnews'\)\.testRaised\(/g) || []).length;
ok(calls === 5, 'five emits: incident raised, requirement raised, case written, incident moved, requirement decided — found ' + calls);
ok(/raised_by_id: who\.id/.test(src), 'a new incident records its raiser BY ID, not only by name');
/* ⭐ AND OLDER FINDINGS ARE NOT ORPHANS: definition.created_by has held the raiser since the first incident,
   so the retest loop works on what Athi raised this week rather than only on what is raised after it ships.
   A feature that only works for data created after it existed is a feature nobody sees working. */
ok((src.match(/raised_by_id: ru\.raised_by_id \|\| x\.created_by \|\| null/g) || []).length === 2,
  'both lists carry that id out, falling back to the row author for findings raised before the field existed');
ok((src.match(/_raiser: ru\.raised_by_id \|\| row\.created_by \|\| null/g) || []).length === 2,
  'and both PATCH handlers fall back the same way, or the return leg on an older incident is owed to nobody');
ok(/SELECT d\.definition_id, d\.name, d\.current_version/.test(src),
  'the PATCH handlers read d.name — a notification that names nothing cannot be acted on');
ok(/delete out\._ref; delete out\._raiser/.test(src),
  'and the carrier fields are stripped before the reply: the client is answered about the incident');

console.log('\n' + (bad ? '✗ ' + bad + ' failure(s)' : '✓ the loop closes, on the right person') + '\n');
process.exit(bad ? 1 : 0);
