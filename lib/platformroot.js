'use strict';
// @stage held
// @stage-note The deployment root resolver. Written with the reservation in lib/handle.js; NOT yet called by a
//             route, because no root has been minted. Off by default — root() is null and every caller must
//             behave as it did before there was a root.
// @stage-why  Being uncalled is a STAGE, not a defect. tests/engine-boundary.test.js requires this tag so an
//             experiment is never mistaken for shipped capability.
/**
 * lib/platformroot.js — THE ROOT ENTITY OF THIS DEPLOYMENT.
 *
 * Athi, 2026-09-14: *"this is the root entity we want to register to a platform and it has to be static… while
 * creating a platform, we spin with one entity named, and all the metrics comes to that entity… so tomorrow if
 * we whitelabel, we need to have a root entity."*
 *
 * ── ⭐⭐⭐ ONE ROOT PER DEPLOYMENT, AND IT IS AN ORDINARY ENTITY ────────────────────────────────────────────────
 *
 * The root is where the platform operator's own business lives: our customer list (every registered entity),
 * the support queues under `00-support`, our plans as a catalogue, our own testing. See
 * DESIGN-PLATFORM-OPERATIONS.md.
 *
 * ⚠️ IT IS NOT A NEW LAYER, A NEW TYPE OR A NEW TABLE. It is an entity like any other, and its ROOTNESS is a
 * fact held in configuration — one uuid — not a property of the row. That is deliberate:
 *
 *   · everything an operator needs (customers, folders, chits, catalogue, plans) an entity already does
 *   · a second kind of entity would need a branch in every query that reads one
 *   · and a white-label deployment then differs from ours only by a value in its environment
 *
 * [[feedback-stay-in-the-construct]]
 *
 * ── ⚠️⚠️ THE HANDLE IS A LABEL. THE UUID IS THE IDENTITY. ──────────────────────────────────────────────────────
 *
 * The convention is `<brand>root` — `chitbridgeinc`, `cbincroot`, `railmailroot`. It is for HUMANS, because the
 * root appears in every shop's supplier list and `~cbincroot.sup-0001` should read as somebody.
 *
 * ⚠️ NOTHING MAY EVER RESOLVE THE ROOT BY THAT NAME. `WHERE user_id LIKE '%root'` makes any customer who
 * registers `myshoproot` a root entity — and nothing stops them: lib/handle.js reserves the bare word `root`,
 * not every handle ending in it. The uuid is the only authority. See lib/namedentity.js.
 *
 * ⚠️ AND THE HANDLE CAN NEVER BE CHANGED. routes/entities.js writes COALESCE(user_id, $5), so the existing
 * value always wins. A rebrand to Railmail moves the DISPLAY NAME, which is free, and leaves the handle. Choose
 * it once, knowing that. [[project-user-id-rule]]
 *
 * ── OFF BY DEFAULT ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Unset, `root()` is null and every caller must behave exactly as it did before there was a root. A deployment
 * that has not minted one is not broken; it simply has no operator-side surface yet. Same discipline as
 * lib/testboard.js — a switch that can be thrown back without a deploy.
 */

const named = require('./namedentity');

const ROOT = named.fromEnv('PLATFORM_ROOT_ENTITY', 'platformroot',
  'this deployment has no operator surface');

/**
 * ── ⭐⭐⭐ ONE ROOT PER POPULATION, SO THE BOUNDARY HOLDS BY CONSTRUCTION ──────────────────────
 *
 * Athi, 2026-09-14: *"so now our test capture can send the test case, incident and requirement to CBinctst
 * entity so the same cycle can follow?"* — and, earlier, the question this answers: *"it never over cross the
 * boundary?"*
 *
 * ⚠⚠ IT DID CROSS. Every 'platform' ticket resolved to the ONE root, so a finding raised by a test entity
 * landed in the live support queue beside a real shop's. The populations were a label on the entity and
 * nothing downstream read it — which is the weakest kind of boundary: one that exists only in the reports.
 *
 * ⭐ THE RAISER'S POPULATION PICKS THE DESK. Live findings reach CBINC; test findings reach the test operator;
 * a sandbox has its own. Nothing is configured per entity and nothing is chosen by a person — b249 already
 * stamps the population on every entity and inherits it to children (b248), so the desk follows the entity
 * that raised it and cannot be pointed the wrong way.
 *
 * ⚠️ AND IT FALLS BACK RATHER THAN REFUSING. A population with no desk configured uses the live root, exactly
 * as it did before this existed — because losing a report to a missing environment variable is worse than a
 * ticket in the wrong queue. ⚠️ But rootFor() SAYS which it used, so a fallback can be seen rather than
 * assumed. [[feedback-silence-is-the-bug]]
 */
const BY_POPULATION = {
  live:    ROOT,
  test:    named.fromEnv('PLATFORM_ROOT_ENTITY_TEST', 'platformroot/test',
                         'test findings go to the live desk'),
  sandbox: named.fromEnv('PLATFORM_ROOT_ENTITY_SANDBOX', 'platformroot/sandbox',
                         'sandbox findings go to the live desk'),
};

/**
 * The operator desk for work raised by an entity in this population.
 *
 * @param {string} population  'live' | 'test' | 'sandbox' | … (b249). Unknown names get the live desk.
 * @returns {{entity_id: ?string, why: string}}  never throws, always explains itself
 */
function rootFor(population) {
  const p = String(population || 'live').toLowerCase();
  const own = Object.prototype.hasOwnProperty.call(BY_POPULATION, p) ? BY_POPULATION[p] : undefined;
  if (own) return { entity_id: own, why: 'the ' + p + ' desk' };
  if (p === 'live') return { entity_id: ROOT, why: 'the platform desk' };
  /* ⚠️ named, not silent: "the platform desk" would read as though this population had one. */
  return { entity_id: ROOT,
           why: own === undefined ? ('no desk for population “' + p + '” — sent to the live desk')
                                  : ('no ' + p + ' desk configured — sent to the live desk') };
}

/** every population that has a desk of its own — for the operator screen, and for the guard. */
function desks() {
  return Object.keys(BY_POPULATION).filter((p) => BY_POPULATION[p]);
}

/**
 * ── ⭐⭐⭐ THE DESK, FROM THE REGISTRY — A ROW, NOT A DEPLOY ─────────────────────────────────
 *
 * Athi, 2026-09-14: *"we should not write sql for all those"* — and the version of that which matters:
 * a support desk is a decision an operator makes and must be able to SEE, CHANGE and be wrong about, without a
 * deploy. b252 puts it on ops.population, set from the Platform screen.
 *
 * ⚠⚠ AND IT DOES NOT DISTURB WHAT WORKS. Athi: *"already it is working but do not want to disturb."* Every
 * fallback is the behaviour that shipped before this existed:
 *
 *     b252 not run  →  the env var, else the live root       (exactly today)
 *     column empty  →  the live root                          (exactly today)
 *     read fails    →  the live root, and it SAYS it failed   (exactly today, but visibly)
 *
 * Nothing changes until somebody names a desk. [[feedback-silence-is-the-bug]]
 *
 * ⚠️ ASYNC, AND rootFor() STAYS SYNC BESIDE IT. Callers that only want the deployment root should not pay for
 * a query or become async to get it. This is the one that knows about populations.
 */
const DESK_TTL_MS = 60 * 1000;
let deskMemo = { at: 0, byCode: null };

async function deskFor(population) {
  const p = String(population || 'live').toLowerCase();
  const envAnswer = rootFor(p);

  let byCode = null;
  if (deskMemo.byCode && (Date.now() - deskMemo.at) < DESK_TTL_MS) {
    byCode = deskMemo.byCode;
  } else {
    try {
      /* ⚠️ ops.population is operator data, not tenant data — a plain query, no withEntity. Required here at
         call time rather than at module load so that lib/platformroot stays importable by anything. */
      const { query } = require('../db');
      /**
       * ⚠️⚠️ THE DESK IS RE-VALIDATED ON EVERY READ, not only when it was named.
       *
       * b252's trigger checks "the desk is inside the population it serves" at write time, against
       * `identities.population` — a column that is itself editable and inherited. Move CBINCTST to live, or
       * deactivate it, and nothing re-checks: every test finding routes into a live-population desk exactly as
       * before b252, while the registry row still looks deliberate. An invariant enforced once decays.
       *
       * ⭐ SO THE JOIN CARRIES THE ANSWER. A desk that has drifted out of its population, or stopped being an
       * active business, is treated as not named — and says so, rather than quietly doing the one thing the
       * migration exists to prevent. [[feedback-silence-is-the-bug]]
       */
      const r = await query(
        `SELECT p.code, p.desk_entity_id,
                coalesce(d.population, 'live') AS desk_population,
                d.identity_type, coalesce(d.status, 'active') AS desk_status
           FROM ops.population p
           LEFT JOIN identities d ON d.identity_id = p.desk_entity_id`);
      byCode = {}; const drift = {};
      for (const row of r.rows) {
        const code = String(row.code).toLowerCase();
        const fit = row.desk_entity_id
          && row.identity_type === 'entity'
          && row.desk_status === 'active'
          && String(row.desk_population).toLowerCase() === code;
        byCode[code] = fit ? row.desk_entity_id : null;
        if (row.desk_entity_id && !fit) {
          drift[code] = row.identity_type !== 'entity' ? 'the named desk is not a business'
                      : row.desk_status !== 'active'  ? 'the named desk is not active'
                      : 'the named desk has moved to the “' + row.desk_population + '” population';
        }
      }
      deskMemo = { at: Date.now(), byCode, drift };
    } catch (e) {
      /* 42P01 = b249 not run · 42703 = b252 not run. Neither is an error to the caller: routing is a
         convenience and a lost report is not. ⚠️ But the reason travels, so a gap can be seen. */
      return { entity_id: envAnswer.entity_id,
               why: envAnswer.why + (e.code === '42703' || e.code === '42P01'
                                     ? ' (no desk registry yet)' : ' (desk registry unreadable)'),
               source: 'fallback' };
    }
  }

  const named = byCode[p] || null;
  if (named) return { entity_id: named, why: 'the ' + p + ' desk', source: 'registry' };

  /* ⚠️ a population that EXISTS but has named nobody is not the same as one nobody has heard of, and the two
     must not read alike — one is a gap somebody can close, the other is a typo. */
  const known = Object.prototype.hasOwnProperty.call(byCode, p);
  /* ⚠️ a desk that WAS named and has drifted is neither "none named" nor "unknown" — it is a setting that has
     quietly stopped meaning what it says, and the operator is the only one who can fix it. */
  const drifted = (deskMemo.drift || {})[p];
  if (p === 'live') return { entity_id: envAnswer.entity_id, why: 'the platform desk', source: 'root' };
  return { entity_id: envAnswer.entity_id || byCode.live || null,
           why: drifted ? (drifted + ' — sent to the live desk')
                        : known ? ('no desk named for “' + p + '” — sent to the live desk')
                                : ('unknown population “' + p + '” — sent to the live desk'),
           source: 'fallback' };
}

/** drop the memo — called when the operator changes a desk, so it is not a minute stale. */
function invalidateDesks() { deskMemo = { at: 0, byCode: null }; }

/** the uuid of this deployment's root entity, or null if none is configured */
function root() { return ROOT; }

/** is there a root at all? Read this before assuming an operator surface exists. */
function configured() { return ROOT !== null; }

/**
 * Is this entity the root? ⚠️ Always false when no root is configured — never "maybe".
 *
 * ⚠️ Compared case-insensitively because a uuid from an environment variable may be typed in either case while
 * one out of postgres is lower — a mismatch here would silently deny the operator their own data.
 */
function isRoot(entity_id) {
  return !!ROOT && String(entity_id || '').toLowerCase() === ROOT.toLowerCase();
}

module.exports = { root, configured, isRoot, rootFor, desks, deskFor, invalidateDesks };
