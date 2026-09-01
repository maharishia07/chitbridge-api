/**
 * visibility-mirror.test.cjs — TWO COLUMNS HOLD ONE FACT, so anything writing one must write the other.
 *
 * ⚠️⚠️ WHY THIS EXISTS. A shop's exposure is stored twice:
 *     · identities.catalogue_visibility — the publish act (b114), and the only control the app has ever shown
 *     · entity_schemas.visibility       — what buildPublicView requires, and what the b49 RLS policy on
 *                                         catalogue_items keys off when there is no tenant context
 *
 * Write only the first and the shop is "public" while every product it owns stays invisible — it serves its
 * ADOPTED catalogue to the world and its own shelf stays dark, with no error anywhere. Athi hit exactly that:
 * *"only the beta timers inherited catalogue only appears, but not the rest."*
 *
 * ⭐ MEASURED, NOT SUSPECTED. b193 asked the live database on 2026-09-01: 129 of 182 public shops mis-aligned,
 * 11 of them owning products, `alpha timers` among them with sixteen. PATCH /profile had mirrored correctly
 * since 2026-08-18; routes/network-design.js wrote the flag and never the schema, and the affected list was full
 * of Cascade / Depot / Outlet / North — the names that route mints.
 *
 * ⚠️ AND IT FAILED SILENTLY IN BOTH DIRECTIONS: nothing threw, the API returned 200, the setting read back
 * "public", and the storefront was right about a fact the owner could not see. There is no stack trace to follow
 * back from that, which is why the class is worth a build failure rather than a note in one of the two files.
 *
 * ⭐ It checks for the MIRROR, not for a particular spelling — a route may reach it via schemaVisibilityFor,
 * ensureDefaultSchema, or its own UPDATE. What it may not do is write one column and forget the other.
 *
 * Run: node --test tests/visibility-mirror.test.cjs
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['routes', 'lib', 'middleware'];

/** Every .js under the given directories. */
function files() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) out.push(path.join(d, f));
  }
  return out;
}

/* A WRITE to the publish flag — an UPDATE naming the column, not a SELECT that merely reads it. */
const WRITES_FLAG = /SET[\s\S]{0,400}?catalogue_visibility\s*=/i;

/* Any sign that the same file also moves the schema's copy: its own UPDATE, or the shared helper, or the
   bootstrap that derives one from the other. */
const MIRRORS = [
  /entity_schemas\s+SET\s+visibility/i,
  /UPDATE\s+entity_schemas[\s\S]{0,200}?visibility/i,
  /schemaVisibilityFor/,
  /ensureDefaultSchema/,
];

test('every writer of catalogue_visibility also moves entity_schemas.visibility', () => {
  const offenders = [];
  for (const rel of files()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!WRITES_FLAG.test(src)) continue;
    if (!MIRRORS.some((re) => re.test(src))) offenders.push(rel);
  }
  assert.deepStrictEqual(offenders, [],
    'these write the publish flag without moving the schema copy, so the shop goes public while its own '
    + 'products stay invisible: ' + offenders.join(', '));
});

/**
 * ⭐ AND THE RULE ITSELF LIVES IN ONE PLACE. Two callers deciding what 'network' maps to, differently, is the
 * same bug one layer up — which is why entities.js stopped writing the expression out a second time.
 */
test('the mapping is decided by schemaVisibilityFor and nobody re-derives it', () => {
  const { schemaVisibilityFor } = require('../lib/schema-bootstrap');
  assert.strictEqual(schemaVisibilityFor('public'), 'public');
  assert.strictEqual(schemaVisibilityFor('private'), 'private');
  /* `network` counts as OPEN: b114 decides who may read it, and a network-only warehouse its own siblings
     cannot see is not protected, it is broken. */
  assert.strictEqual(schemaVisibilityFor('network'), 'public');
  assert.strictEqual(schemaVisibilityFor(undefined), 'private');

  /* A second hand-written copy of the ternary is the thing that drifts. There should be exactly one. */
  let inline = 0;
  for (const rel of files()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    /* The expression itself, ignoring the one definition in schema-bootstrap. */
    const m = src.match(/===?\s*'public'\s*\|\|[^\n]{0,40}===?\s*'network'\s*\)\s*\?\s*'public'/g);
    if (m && rel !== path.join('lib', 'schema-bootstrap.js')) inline += m.length;
  }
  assert.strictEqual(inline, 0, 'the public/network mapping is written out again outside schema-bootstrap');
});
