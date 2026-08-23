/**
 * scripts/dedupe-catalogue.js — RETIRE DUPLICATE CATALOGUE ROWS, THROUGH THE PRODUCT'S OWN DOOR.
 *
 * Athi, 2026-08-23: *"why do we need the migration? It is nothing but the existing catalogue that we pick up,
 * so why do we need a migration?"* — and he is right, on both counts.
 *
 * ⚠️⚠️ A MIGRATION IS FOR SCHEMA. It is a numbered step in a lineage that every environment must receive, in
 * order, forever. This is a handful of ROWS in ONE entity's catalogue, made by a proof script that used to
 * create its products on every run. Filing it as `b181` would have left a permanent instruction in the
 * migrations folder telling every future environment to clean up a mess it never had.
 *
 * ⚠️ AND GOING AT THE TABLE BYPASSES THE RULES THE PRODUCT ENFORCES. `DELETE /api/products/:id` runs inside
 * `withEntity()`, which sets the RLS context — so the API cannot touch a row belonging to someone else even
 * if asked. Hand-written SQL in the editor runs as the owner, where the only thing standing between a typo
 * and another entity's catalogue is the WHERE clause. Same effect on a good day; not the same guarantee.
 *
 * ⭐ So: the same call the Delete button makes, once per duplicate. Soft delete (`is_active=false`), so
 * nothing is destroyed and every `reference` on a recorded line event still resolves.
 *
 *     node scripts/dedupe-catalogue.js              ← DRY RUN. Prints the plan, changes nothing.
 *     node scripts/dedupe-catalogue.js --apply      ← does it
 *
 * ⭐ THE OLDEST COPY SURVIVES: it has been on the shelf longest, so it is the one older records point at.
 * ⚠️ Idempotent — run it twice and the second run finds nothing, because the survivors are no longer duplicates.
 */
const P = require('./_proof');

const SHOP = process.env.CB_SHOP_NAME || 'Chola Auto Care';
const EMAIL = process.env.CB_SHOP_EMAIL || 'cholaauto@email.com';
const APPLY = process.argv.includes('--apply');

const nameOf = (x) => String(((x.item_data || x).name) || '').trim();

(async () => {
  console.log('\n══ CATALOGUE DEDUPE ' + (APPLY ? '· APPLYING' : '· DRY RUN (nothing will change)') + ' ══\n');

  /* ⚠️ signIn returns the TOKEN, not an auth object — `P.j` wants `{ token }`. Reading it wrong sends every
     request with no Authorization header, and an empty catalogue then looks like a clean shelf. */
  const token = await P.signIn(EMAIL, SHOP);
  if (!token) { console.log('sign-in failed for ' + SHOP); process.exit(1); }
  const auth = { token };

  const r = await P.j('/api/products?limit=500', auth);
  const items = (r.b && (r.b.items || r.b)) || [];
  if (!Array.isArray(items)) { console.log('unexpected catalogue shape'); process.exit(1); }
  console.log(SHOP + ' — ' + items.length + ' active item(s) on the shelf\n');

  /* Group by the name a person would search for, oldest first inside each group. */
  const groups = new Map();
  for (const it of items) {
    const key = nameOf(it).toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  const dupes = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (!dupes.length) { console.log('  nothing duplicated — the shelf is already clean\n'); return; }

  let planned = 0;
  for (const [, list] of dupes) {
    const keep = list[0];
    const drop = list.slice(1);
    planned += drop.length;
    console.log('  ' + nameOf(keep).padEnd(24) + list.length + ' copies → keep 1, retire ' + drop.length
      + '   (keeping ' + String(keep.item_id).slice(0, 8) + ', added ' + String(keep.created_at || '').slice(0, 10) + ')');
  }
  console.log('\n  ' + planned + ' row(s) would be retired across ' + dupes.length + ' product(s)');

  if (!APPLY) { console.log('\n  DRY RUN — re-run with --apply to do it\n'); return; }

  let done = 0;
  let failed = 0;
  for (const [, list] of dupes) {
    for (const it of list.slice(1)) {
      /* ⚠️ `.status`, not `.s` — P.j returns `{ status, b }`. Reading the wrong key made every successful
         delete `undefined >= 200` → false, so the first run reported "retired 0 · failed 28" while the shelf
         it then re-read had gone from 35 items to 7. A checker that cannot read the answer is worse than no
         checker: it accuses the thing it is checking. */
      const d = await P.j('/api/products/' + it.item_id, { method: 'DELETE', ...auth });
      if (d.status >= 200 && d.status < 300) done++;
      else { failed++; console.log('  FAIL ' + nameOf(it) + ' ' + it.item_id + ' → ' + d.status); }
    }
  }
  console.log('\n  retired ' + done + ' · failed ' + failed);
  /* ⚠️ Say what is left rather than assuming it worked — the same read, after the writes. */
  const after = await P.j('/api/products?limit=500', auth);
  const left = ((after.b && (after.b.items || after.b)) || []).length;
  console.log('  the shelf now holds ' + left + ' active item(s)\n');
  process.exitCode = failed ? 1 : 0;
})();
