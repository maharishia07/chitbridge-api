/**
 * ── ⭐⭐⭐ EVERY COMBINATION OF "WHERE DOES THIS TICKET GO" ───────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"what you are saying seems to work? can you check possible combination please"* — and the
 * three questions that produced the combinations:
 *
 *   *"how do we differentiate between raising an incident to the platform to raising an incident to the entity?"*
 *   *"a is an entity and b is an entity, a is calling b and accessing its catalogue and wants to raise an
 *     incident with b, how this will route to b?"*
 *   *"if a network child creates an incident where will it reach?"*
 *
 * ⚠️⚠️ THIS IS A STATIC CHECK, NOT A LIVE ONE, and that limit is the point. Three desks × routed/unrouted ×
 * network/no-network is twelve paths through ONE function, and eleven of them are the ones nobody will ever
 * click. A test that needs twelve entities in a live database is a test that gets skipped; this one reads the
 * source and fails the build when a branch stops existing. [[feedback-testing-ladder]] T0.
 *
 * ⭐ AND IT ASSERTS THE TWO RULES THAT ARE EASY TO BREAK BY ACCIDENT — a folder id used outside the entity that
 * owns it, and a tenant-local value inherited down a network. Both are silent when wrong.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const raise = R('lib/raiseticket.js');
const route = R('lib/workroute.js');
const copy  = R('lib/supportcopy.js');
const test  = R('routes/testing.js');

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

console.log('\n══ WHERE A TICKET GOES — every combination ══\n');

/* ── THE THREE DESKS ───────────────────────────────────────────────────────────────────────────────────────── */
ok('platform is the default desk',
  /String\(t\.audience \|\| 'platform'\)/.test(raise),
  'a caller that says nothing must still reach us — anything else loses every ticket that shipped before today');

ok("'here' resolves to the raiser itself",
  /AUD === 'here' \? from\.entity_id/.test(raise));

ok("'them' resolves by BRIDGE ID, never by an entity id from the client",
  /AUD === 'them'/.test(raise) && /bridge_id = \$1/.test(raise)
    && !/t\.to_entity_id|audience.*entity_id\b/.test(raise),
  'an entity id is an internal key; accepting one from a caller turns it into an address');

/* ⚠️ THE RULE, NOT THE SPELLING. This was pinned to `raised: false` and broke the moment the resolver was
   lifted out of raise() and started answering `ok: false` — same refusal, different field. An assertion that
   fails on a rename teaches people to delete it. [[feedback-improvise-update-cases]] */
ok("'them' with no counterparty is REFUSED, not silently sent to us",
  /if \(!bid\) return \{ (ok|raised): false, why: 'no counterparty/.test(raise),
  'falling back to the platform would answer a shop complaint with our own support queue');

ok("'them' pointing at an unknown or closed business is a sentence",
  /no active business with bridge id/.test(raise));

/* ── WHOSE ROUTING ANSWERS ─────────────────────────────────────────────────────────────────────────────────── */
ok('the DESK decides the routing, not the raiser',
  /routeFor\(desk, t\.kind/.test(raise) && !/routeFor\(root,/.test(raise),
  'resolving against root is what made every shop’s own routing screen decide nothing');

ok('the destination is the routed team, else the desk itself',
  /const to = route\.route_to_entity_id \|\| desk;/.test(raise));

ok('same entity both ends = ONE copy, Task only',
  /const isSelf = String\(to\) === String\(from\.entity_id\)/.test(raise)
    && /copies = isSelf \? \[received\]/.test(raise),
  'a "sent" copy to yourself puts your own support requests in your own Order list');

/* ── THE FOLDER, WHICH BELONGS TO EXACTLY ONE ENTITY ───────────────────────────────────────────────────────── */
ok('a routed folder is used ONLY in the entity that declared it',
  /const sameDesk = String\(to\) === String\(desk\)/.test(raise)
    && /let fid = \(sameDesk && route\.folder_id\) \|\| null;/.test(raise),
  'stamping a chit with a folder id its owner does not own does not error — the chit just disappears');

ok('sent onward, it lands in the receiver’s own default folder',
  /lower\(name\) = lower\(\$2\)/.test(raise) && /INSERT INTO folder \(entity_id, name\)/.test(raise));

ok('the receipt reports the folder it LANDED in, not the one we aimed at',
  /filedRows = up\.rowCount/.test(raise) && /folder: filedRows \? folderName : null/.test(raise));

/* ── A NETWORK CHILD ───────────────────────────────────────────────────────────────────────────────────────── */
ok('a branch with no rule of its own asks the network above',
  /inheritedTeam\(entity_id, kind\)/.test(route));

ok('ancestors are tried NEAREST first',
  /ORDER BY nlevel\(c\.path\) DESC/.test(route),
  'head office must not win over the regional office that sits between');

ok('ONLY the destination is inherited — never the folder or the person',
  /route_to_entity_id: up\.route_to_entity_id/.test(route)
    && /folder_id: null, assignee_actor_id: null, notify_email: null,\s*\r?\n\s*route_to_entity_id: up\./.test(route),
  'a parent’s folder id does not exist in the child, and a parent’s staff are not the child’s');

ok('the walk is bounded',
  /MAX_HOPS/.test(route) && /LIMIT \$2/.test(route));

ok('inheritance fails open, like every other rung here',
  /catch \(_\) \{ \/\* no tree, no column, no answer/.test(route));

ok('and it SAYS it was inherited, and from whom',
  /why: 'inherited from '/.test(route),
  'a rule nobody set on this entity must not read as a rule this entity set');

/* ── THE WIRING, END TO END ────────────────────────────────────────────────────────────────────────────────── */
ok('audience and counterparty reach raiseticket through supportcopy',
  /audience: origin\.audience, to_bridge_id: origin\.to_bridge_id/.test(copy));

ok('both doors — incidents and requirements — pass them on',
  (test.match(/audience: b\.audience, to_bridge_id: b\.to_bridge_id/g) || []).length === 2,
  'one door wired and the other not is the silence this codebase keeps producing');

ok('the answer names the desk it used',
  /desk: AUD/.test(raise) && /desk: out\.desk \|\| 'platform'/.test(copy),
  '"routed by kind" alone cannot tell a reader whether their fault reached us or stayed on their own board');

/* ── AND THE THREE DESKS ARE OFFERED, NOT JUST ACCEPTED ────────────────────────────────────────────────────── */
const web = (() => {
  for (const p of ['../chitbridge-web/public/app.html', '../../chitbridge-web/public/app.html']) {
    try { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); } catch (_) {}
  }
  return null;
})();
if (web) {
  ok('the hub offers all three desks',
    /to: 'platform'/.test(web) && /to: 'here'/.test(web) && /to: 'them'/.test(web));
  /* ⚠️ SCOPED TO THE SUPPORT BLOCK. Scanning the whole file failed on compose's recipient picker and the
     entity search box — both of which are SUPPOSED to take a typed bridge id. A guard that fires on the right
     rule in the wrong place teaches the next person to widen the BASELINE instead of reading it. */
  const sup = (web.split('const SUPPORT_BOXES')[1] || '').split('function promptAsk')[0];
  ok('the counterparty is read from context, never typed',
    /function supportThem\(\)/.test(sup) && !/bridge/i.test(sup.match(/<input[^>]*>/g) || []),
    'a bridge id somebody types is a way to post a chit into a stranger’s Task');
  ok("the 'them' group is hidden when there is no counterparty",
    /filter\(function\(d\)\{ return d !== 'them' \|\| supportThem\(\); \}\)/.test(web),
    'a box that cannot work is worse than an absent one — the reader spends the typing before finding out');
  ok('a box is looked up by kind AND desk',
    /b\.kind \+ '@' \+ b\.to === id/.test(web),
    'there are two incident boxes; picking the first sends half of them to the wrong company');
} else {
  console.log('   ·    web checks skipped (chitbridge-web not beside this repo)');
}


/* ── THE NOTE, WHICH IS ONLY WORTH HAVING IF IT CANNOT DISAGREE WITH THE SEND ──────────────────────────────── */
ok('the note and the send share ONE resolver',
  /async function resolveDesk\(/.test(raise)
    && (raise.match(/await resolveDesk\(from, t, root\)/g) || []).length === 2,
  'a preview answering from its own copy of the rules is a second opinion, and the day they disagree the '
  + 'screen is confidently wrong — which is worse than no note at all');

ok('the preview writes nothing',
  /async function preview\(/.test(raise)
    && !/INSERT INTO folder[\s\S]{0,400}?^\}/m.test(raise.split('async function preview(')[1].split('\n}')[0] || ''),
  'a preview that creates 00-support leaves a folder on an entity that never received a ticket');

ok('the preview endpoint always answers 200',
  /router\.get\('\/routing\/preview'/.test(R('routes/entities.js'))
    && /catch \(e\) \{\s*\r?\n\s*res\.json\(\{ ok: false/.test(R('routes/entities.js')),
  '"this will not work, and here is why" is the answer — a 500 puts a red box on an empty form and says nothing');

if (web) {
  ok('the form asks the SERVER where it will go, not itself',
    /api\('workRoutePreview'/.test(web) && /supportNoteLoad\(b\)/.test(web),
    'the client does not know whether that entity routes faults to a team, or whether the shop still exists');
  ok('and the send is held while it cannot land',
    /if \(btn && r && r\.ok === false\) \{ btn\.disabled = true/.test(web));
  ok('a preview that fails does not block a real report',
    /a failed PREVIEW must not block a real report/.test(web)
      && /supportNoteHTML\(\{ ok: null/.test(web),
    'routing is a convenience; losing the words is not');
}

/* the runner reads the LAST "<n> checks" from this output — without it a passing guard reports 0, which is
   indistinguishable from a guard that ran nothing. [[feedback-silence-is-the-bug]] */
console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
