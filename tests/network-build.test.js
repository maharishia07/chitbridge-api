'use strict';
/**
 * network-build.test.js — what Build would do, decided before anything exists.
 *
 * The load-bearing tests are the ones marked ★★: a partner is never created, and a partner's children are never
 * named. Those two are the whole answer to REVIEW-2026-08-06 §6, and if either regresses the `network` visibility
 * tier stops being safe.
 */
const assert = require('assert');
const NB = require('../lib/network-build');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const ROOT = { key: 'r', name: 'Athi', root: true, owned: true, parent_key: null, holds: [] };
const owned = (key, name, extra) => Object.assign({ key, name, parent_key: 'r', owned: true, holds: ['catalogue'] }, extra || {});
const run = (nodes, taken) => NB.plan({ rootHandle: 'athi', nodes: [ROOT, ...nodes], taken: taken || [] });

console.log('\nnetwork build · the plan');

t('★ an owned node becomes athi.<name>', () => {
  const p = run([owned('a', 'Clothing')]);
  assert.strictEqual(p.create.length, 1);
  assert.strictEqual(p.create[0].handle, 'athi.clothing');
  assert.strictEqual(p.create[0].name, 'Clothing');
});

t('★★ a handle is ALWAYS two levels — depth lives in the tree, not the name', () => {
  // Athi: "we don't need levels naming convention… otherwise it will keep growing and it would be difficult to
  // manage if it is 10 levels, and if an employee underneath." A co-assist logs in as ravi@athi.mens.
  const p = run([owned('a', 'Clothing'), owned('b', 'Mens', { parent_key: 'a' })]);
  assert.deepStrictEqual(p.create.map((c) => c.handle), ['athi.clothing', 'athi.mens']);
  // Order is still not cosmetic: the executor PLACES each node under its parent, so the parent must exist first —
  // placement stays hierarchical even though the name is flat.
  assert.ok(p.create.findIndex((c) => c.key === 'a') < p.create.findIndex((c) => c.key === 'b'));
  assert.strictEqual(p.create.find((c) => c.key === 'b').parent_key, 'a');
});

t('★★ a node under the ROOT reports parent_key null — the root is the operator, not part of the plan', () => {
  // This is the bug the seam test found and these unit tests did not: the planner emitted the root DESIGN NODE's
  // key, the executor looked it up among nodes it had just created, missed, and refused every top-level store
  // with "its parent is not on the network tree yet". Both halves were self-consistent and meant different
  // things by the same field.
  const p = run([owned('a', 'Clothing'), owned('b', 'Mens', { parent_key: 'a' })]);
  assert.strictEqual(p.create.find((c) => c.key === 'a').parent_key, null, 'hangs off the operator');
  assert.strictEqual(p.create.find((c) => c.key === 'b').parent_key, 'a', 'hangs off a node in this plan');
});

t('★★ NO handle a build can produce ever contains a space', () => {
  // Athi, 2026-08-07: "if they create a store using network again space not permitted."
  // A store's DISPLAY NAME stays free-form — "South A" is a perfectly good name for a shop, and display_name is a
  // label, not an identifier. What must never carry a space is the HANDLE, because that is what gets typed into a
  // login box and into `ravi@<handle>`. So the name is slugged, not refused, and this asserts the outcome rather
  // than trusting the slug: every handle the planner can emit, from names chosen to be awkward.
  const p = run([
    owned('a', 'South A'), owned('b', '  Cold  Storage  '), owned('c', "Men's Formal Wear"),
    owned('d', 'Unit 7 — North'), owned('e', 'R&D  Lab'),
  ]);
  assert.strictEqual(p.problems.length, 0, 'an awkward name is slugged, never refused');
  p.create.forEach((c) => {
    assert.ok(!/\s/.test(c.handle), `"${c.name}" produced a handle with whitespace: "${c.handle}"`);
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/.test(c.handle), `"${c.handle}" is not a clean handle`);
  });
  assert.deepStrictEqual(p.create.map((c) => c.handle),
    // `R&D Lab` → `r-d-lab`: the ampersand has no spaces around it, so it becomes its own separator. Consistent
    // with `Pharmacy & Wellness` → `pharmacy-wellness`, where the spaces around it collapse into the same dash.
    ['athi.south-a', 'athi.cold-storage', 'athi.mens-formal-wear', 'athi.unit-7-north', 'athi.r-d-lab']);
  // …and the label a person reads is untouched.
  assert.strictEqual(p.create[0].name, 'South A');
});

t('★ five levels deep is still one dot', () => {
  const p = run([
    owned('a', 'Clothing'), owned('b', 'Mens', { parent_key: 'a' }), owned('c', 'Formals', { parent_key: 'b' }),
    owned('d', 'Shirts', { parent_key: 'c' }), owned('e', 'Cotton', { parent_key: 'd' }),
  ]);
  assert.deepStrictEqual(p.create.map((c) => c.handle),
    ['athi.clothing', 'athi.mens', 'athi.formals', 'athi.shirts', 'athi.cotton']);
  assert.strictEqual(p.problems.length, 0, 'depth must not be a reason to refuse');
});

console.log('\nnetwork build · exposure');

t('★ a designed storefront carries its exposure; protected → network', () => {
  const p = run([
    owned('a', 'Clothing',  { holds: ['catalogue', 'storefront'], exposure: 'public' }),
    owned('b', 'Warehouse', { holds: ['catalogue', 'storefront'], exposure: 'protected' }),
  ]);
  assert.strictEqual(p.create.find((c) => c.key === 'a').visibility, 'public');
  assert.strictEqual(p.create.find((c) => c.key === 'b').visibility, 'network');
});

t('★★ NO CHOICE → private, never public', () => {
  // A back-office node that quietly became a public shop is the one mistake here that cannot be taken back:
  // it publishes a catalogue nobody meant to publish. Every other default is recoverable; this one is not.
  assert.strictEqual(run([owned('a', 'Back office')]).create[0].visibility, 'private');
  assert.strictEqual(NB.visibilityOf({ exposure: 'nonsense' }), 'private');
  assert.strictEqual(NB.visibilityOf({}), 'private');
  assert.strictEqual(NB.visibilityOf(null), 'private');
});

t('★ visibility is the NODE\'s, not the storefront capability\'s', () => {
  // It used to need both: a store marked public stayed invisible because a tick three panels away was off.
  assert.strictEqual(NB.visibilityOf({ exposure: 'public' }), 'public', 'no holds[] at all');
  assert.strictEqual(NB.visibilityOf({ holds: [], exposure: 'protected' }), 'network');
});

console.log('\nnetwork build · partners are invited, not created');

t('★★ a partner is NEVER created', () => {
  const p = run([{ key: 'p', name: 'Ravi Timbers', parent_key: 'r', owned: false, partner_ref: 'ravi.timbers', holds: ['catalogue'] }]);
  assert.strictEqual(p.create.length, 0, 'a partner must not appear in create');
  assert.deepStrictEqual(p.invite, [{ key: 'p', name: 'Ravi Timbers', ref: 'ravi.timbers' }]);
});

t('★ a partner with no handle cannot be invited — and is told so', () => {
  const p = run([{ key: 'p', name: 'Ravi Timbers', parent_key: 'r', owned: false, holds: [] }]);
  assert.strictEqual(p.invite.length, 0);
  assert.ok(/add their handle/i.test(p.problems[0].reason));
});

t('★★ a partner\'s children are NOT named or created', () => {
  // Otherwise the operator could mint `athi.ravi-timbers.warehouse` — a store inside someone else's business,
  // sitting on the operator's own tree, and therefore readable at `network` visibility. That is the §6 attack.
  const p = run([
    { key: 'p', name: 'Ravi Timbers', parent_key: 'r', owned: false, partner_ref: 'ravi.timbers', holds: [] },
    owned('w', 'Warehouse', { parent_key: 'p' }),
  ]);
  assert.strictEqual(p.create.length, 0);
  assert.ok(p.problems.some((x) => /a partner's own structure is theirs/i.test(x.reason)));
});

console.log('\nnetwork build · refusals');

t('★ a name already taken by someone else is refused, not suffixed', () => {
  const p = run([owned('a', 'Clothing')], ['athi.clothing']);
  assert.strictEqual(p.create.length, 0);
  assert.ok(/already taken/.test(p.problems[0].reason));
});

t('★ two nodes that would collide are caught BEFORE anything is created', () => {
  const p = run([owned('a', 'Clothing'), owned('b', 'clothing')]);
  assert.strictEqual(p.create.length, 1, 'the first one is fine');
  assert.ok(/already using the name/.test(p.problems[0].reason));
  assert.ok(/Clothing/.test(p.problems[0].reason), 'it must name the OTHER node, not just the clash');
});

t('★★ the cost of a flat namespace: "Mens" under two different parents is ONE name', () => {
  // A mirrored handle would have separated these. This is the trade Athi chose, and it must be a clear refusal
  // rather than a surprise 23505 halfway through the transaction.
  const p = run([
    owned('a', 'Clothing'), owned('b', 'Womens wear'),
    owned('c', 'Mens', { parent_key: 'a' }), owned('d', 'Mens', { parent_key: 'b' }),
  ]);
  assert.strictEqual(p.create.filter((x) => x.handle === 'athi.mens').length, 1);
  assert.ok(/unique across the whole network/.test(p.problems[0].reason));
});

t('an unusable name blocks that node and its children, nothing else', () => {
  const p = run([owned('a', '!!!'), owned('b', 'Mens', { parent_key: 'a' }), owned('c', 'Pharmacy')]);
  assert.deepStrictEqual(p.create.map((c) => c.handle), ['athi.pharmacy'], 'the good branch still builds');
  assert.strictEqual(p.problems.length, 2);
  assert.ok(/parent could not be built/.test(p.problems.find((x) => x.key === 'b').reason));
});

t('an unusable ROOT stops the plan and says which name is wrong', () => {
  const p = NB.plan({ rootHandle: 'cb12345678', nodes: [ROOT, owned('a', 'Clothing')] });
  assert.strictEqual(p.create.length, 0);
  assert.ok(/network name is not usable/.test(p.problems[0].reason));
});

console.log('\nnetwork build · running it twice');

t('★★ a built node is skipped, not created again', () => {
  const p = run([owned('a', 'Clothing', { built: { bridge_id: 'CBAAAAAAAA', user_id: 'athi.clothing' } })]);
  assert.strictEqual(p.create.length, 0);
  assert.strictEqual(p.skip.length, 1);
});

t('★ a new child under an ALREADY-BUILT parent is named from the root, and placed under the parent', () => {
  const p = run([
    owned('a', 'Clothes now', { built: { bridge_id: 'CBAAAAAAAA', user_id: 'athi.clothing' } }),
    owned('b', 'Mens', { parent_key: 'a' }),
  ]);
  assert.strictEqual(p.create[0].handle, 'athi.mens', 'the name never inherits the parent');
  assert.strictEqual(p.create[0].parent_key, 'a', 'but the PLACEMENT does');
});

console.log('\nnetwork build · enhancing a network that already exists');

const BUILT = { bridge_id: 'CBAAAAAAAA', user_id: 'athi.warehouse' };
const withLive = (nodes, live) => NB.plan({ rootHandle: 'athi', nodes: [ROOT, ...nodes], taken: [], live });

t('★★ a built store whose visibility changed is UPDATED, not ignored', () => {
  // Without this, changing a built store from "Network only" to "Public" edits a drawing and nothing else — the
  // design and the live network drift apart silently, which is the worst property a governance screen can have.
  const p = withLive([owned('w', 'Warehouse', { built: BUILT, exposure: 'public' })],
    { CBAAAAAAAA: { catalogue_visibility: 'network' } });
  assert.strictEqual(p.create.length, 0);
  assert.deepStrictEqual(p.update, [{ key: 'w', name: 'Warehouse', handle: 'athi.warehouse',
    bridge_id: 'CBAAAAAAAA', from: 'network', to: 'public' }]);
});

t('★ a built store in agreement is skipped, not rewritten', () => {
  const p = withLive([owned('w', 'Warehouse', { built: BUILT, exposure: 'protected' })],
    { CBAAAAAAAA: { catalogue_visibility: 'network' } });
  assert.strictEqual(p.update.length, 0);
  assert.strictEqual(p.skip.length, 1);
});

t('★★ with NO live state, nothing is proposed — a draft cannot assert its way over a live store', () => {
  // The comparison is against what the store is ACTUALLY set to, read fresh. If we could not read it, we do not
  // guess: the failure mode of guessing is publishing someone's warehouse.
  const p = withLive([owned('w', 'Warehouse', { built: BUILT, exposure: 'public' })], null);
  assert.strictEqual(p.update.length, 0);
  assert.strictEqual(p.skip.length, 1);
});

t('★ enhancing = adding a store to a network that already exists', () => {
  const p = withLive([
    owned('w', 'Warehouse', { built: BUILT, exposure: 'protected' }),
    owned('n', 'North', { exposure: 'public' }),
  ], { CBAAAAAAAA: { catalogue_visibility: 'network' } });
  assert.deepStrictEqual(p.create.map((c) => c.handle), ['athi.north']);
  assert.strictEqual(p.skip.length, 1, 'the existing store is untouched');
});

console.log('\nnetwork build · the cascade — every parent/child combination');

/**
 * THE MATRIX. Three levels, three choices each = 27 combinations, exhaustively.
 *
 * Athi, 2026-08-08: *"make the cascade for parent and child."* The rule is the narrowest wins, and the only
 * honest way to state a rule like that is to enumerate it — a spot-check of three cases proves the three cases.
 */
const TIERS = [['public', 'public'], ['protected', 'network'], ['private', 'private']];
const RANKS = { private: 0, network: 1, public: 2 };
t('★★ a child is never more open than its parent — all 27 combinations', () => {
  let checked = 0, narrowedCount = 0;
  for (const [netWord, netVis] of TIERS) {
    for (const [pWord, pVis] of TIERS) {
      for (const [cWord, cVis] of TIERS) {
        const p = NB.plan({
          rootHandle: 'athi', taken: [], ceiling: netVis,
          nodes: [ROOT,
            { key: 'p', name: 'Parent', parent_key: 'r', owned: true, holds: ['catalogue'], exposure: pWord },
            { key: 'c', name: 'Child', parent_key: 'p', owned: true, holds: ['catalogue'], exposure: cWord }],
        });
        const P = p.create.find((x) => x.key === 'p'), C = p.create.find((x) => x.key === 'c');
        const wantP = Math.min(RANKS[netVis], RANKS[pVis]);
        const wantC = Math.min(wantP, RANKS[cVis]);
        assert.strictEqual(RANKS[P.visibility], wantP, `network ${netVis} / parent ${pVis} → ${P.visibility}`);
        assert.strictEqual(RANKS[C.visibility], wantC,
          `network ${netVis} / parent ${pVis} / child ${cVis} → ${C.visibility}`);
        // never OPENED by an ancestor, in any combination
        assert.ok(RANKS[C.visibility] <= RANKS[cVis], 'a ceiling must never open a node wider than it asked for');
        if (C.visibility !== cVis || P.visibility !== pVis) narrowedCount++;
        checked++;
      }
    }
  }
  assert.strictEqual(checked, 27);
  assert.ok(narrowedCount > 0, 'the matrix must actually exercise narrowing');
});

t('★★ the case that was broken: a network-only parent cannot hold a public child', () => {
  const p = NB.plan({ rootHandle: 'athi', taken: [], ceiling: 'public', nodes: [ROOT,
    { key: 'w', name: 'Warehouse', parent_key: 'r', owned: true, holds: ['catalogue'], exposure: 'protected' },
    { key: 'o', name: 'Outlet', parent_key: 'w', owned: true, holds: ['catalogue'], exposure: 'public' }] });
  assert.strictEqual(p.create.find((x) => x.key === 'o').visibility, 'network');
  assert.deepStrictEqual(p.narrowed, [{ key: 'o', name: 'Outlet', from: 'public', to: 'network', by: 'parent' }]);
});

t('★ what was asked for is remembered, so the screen can say why it moved', () => {
  const p = NB.plan({ rootHandle: 'athi', taken: [], ceiling: 'private', nodes: [ROOT,
    { key: 'a', name: 'Shop', parent_key: 'r', owned: true, holds: ['catalogue'], exposure: 'public' }] });
  const c = p.create[0];
  assert.strictEqual(c.asked, 'public');
  assert.strictEqual(c.visibility, 'private');
});

t('★★ closing a parent closes a child that is ALREADY BUILT', () => {
  // The hole in its most expensive form: the sub-unit exists, is live, and is facing customers.
  const p = NB.plan({ rootHandle: 'athi', taken: [], ceiling: 'public',
    live: { CBP: { catalogue_visibility: 'network' }, CBC: { catalogue_visibility: 'public' } },
    nodes: [ROOT,
      { key: 'w', name: 'Warehouse', parent_key: 'r', owned: true, exposure: 'protected',
        built: { bridge_id: 'CBP', user_id: 'athi.warehouse' } },
      { key: 'o', name: 'Outlet', parent_key: 'w', owned: true, exposure: 'public',
        built: { bridge_id: 'CBC', user_id: 'athi.outlet' } }] });
  const u = p.update.find((x) => x.key === 'o');
  assert.ok(u, 'the live public child must be proposed for change');
  assert.deepStrictEqual([u.from, u.to], ['public', 'network']);
});

t('★ a deeper chain narrows all the way down', () => {
  const p = NB.plan({ rootHandle: 'athi', taken: [], ceiling: 'public', nodes: [ROOT,
    { key: 'a', name: 'A', parent_key: 'r', owned: true, exposure: 'public' },
    { key: 'b', name: 'B', parent_key: 'a', owned: true, exposure: 'private' },
    { key: 'c', name: 'C', parent_key: 'b', owned: true, exposure: 'public' }] });
  assert.deepStrictEqual(p.create.map((x) => x.name + '=' + x.visibility), ['A=public', 'B=private', 'C=private']);
});

console.log('\nnetwork build · the purpose travels with the store');

t('★ a new store carries its purpose', () => {
  const p = run([owned('a', 'Cold Store', { purpose: '  Chilled stock for the east branch  ' })]);
  assert.strictEqual(p.create[0].purpose, 'Chilled stock for the east branch', 'trimmed, not raw');
  assert.strictEqual(run([owned('b', 'Plain')]).create[0].purpose, '');
});

t('★ it is clamped to the column, so a long line can never fail a build', () => {
  const p = run([owned('a', 'Wordy', { purpose: 'x'.repeat(400) })]);
  assert.strictEqual(p.create[0].purpose.length, NB.MAX_PURPOSE);
});

t('★★ editing the purpose of a BUILT store is an update, not a silent divergence', () => {
  const built = { bridge_id: 'CBX', user_id: 'athi.depot' };
  const p = withLive([owned('d', 'Depot', { built, exposure: 'protected', purpose: 'Now the cold store' })],
    { CBX: { catalogue_visibility: 'network', purpose: 'Old text' } });
  assert.strictEqual(p.update.length, 1);
  assert.deepStrictEqual(p.update[0].purpose, { from: 'Old text', to: 'Now the cold store' });
  assert.strictEqual(p.update[0].to, undefined, 'visibility did not move, so it is not claimed to have');
});

t('★ a store in agreement on both is still skipped', () => {
  const built = { bridge_id: 'CBX', user_id: 'athi.depot' };
  const p = withLive([owned('d', 'Depot', { built, exposure: 'protected', purpose: 'Same' })],
    { CBX: { catalogue_visibility: 'network', purpose: 'Same' } });
  assert.strictEqual(p.update.length, 0);
  assert.strictEqual(p.skip.length, 1);
});

t('an empty design is a valid plan that does nothing', () => {
  const p = run([]);
  assert.deepStrictEqual(p.counts, { create: 0, update: 0, invite: 0, skip: 0, problems: 0, narrowed: 0 });
});

t('TIER A · depends on nothing but handle.js', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/network-build'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]), ['./handle']);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
