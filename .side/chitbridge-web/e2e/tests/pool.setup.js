// PROVISION THE STABLE ENTITY POOL — run ONCE, or whenever the saved sessions expire:  npm run pool
// Creates-or-reuses each fixed pool entity (same email → same entity) and saves its logged-in session to
// .auth/pool-NN.json, so every later run REUSES them (no minting) and flows can run in PARALLEL, each on its own entity.
// This is the foundation for the concurrency/swarm simulation. Grow the pool with CB_POOL_SIZE=20 npm run pool.
const { test } = require('@playwright/test');
const { mintEntity, POOL } = require('../fixtures');

test('provision the stable entity pool (create-or-reuse)', async ({ browser }) => {
  test.setTimeout(POOL.length * 60_000 + 60_000);
  const done = [];
  for (const p of POOL) {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      await mintEntity(page, { email: p.email, name: p.name });   // fixed email → create-or-reuse the SAME entity
      await ctx.storageState({ path: p.session });                 // save its session for reuse
      done.push(p.key);
    } catch (e) {
      console.log('  SKIP ' + p.key + ' (' + e.message.slice(0, 50) + ') — re-run `npm run pool` to fill gaps');
    } finally {
      await ctx.close();
    }
  }
  console.log('POOL PROVISIONED:', done.join(', '));
});
