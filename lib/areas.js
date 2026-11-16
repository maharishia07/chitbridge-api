'use strict';
/**
 * lib/areas.js — WHO MAY OPEN WHICH AREA OF THE BUSINESS, PER PERSON (W15-66: staff see no books unless the owner opens the accounts for them).
 * OWNS      GRANTABLE (the areas the server enforces: accounts = the books · reports = the Reports and MIS figures · finance = the cheque and collections figures; a grantable area is an enforced one) · liveLevel (THE ONE EXPIRY JUDGEMENT) · areaLevel / holds (what a person may do in an area:
 *           the preset's own areas from lib/access.presetAreas plus the person's own live grant, capped by their old level) · areasOf (the same answer as the people screen reads it).
 * CALLED BY middleware/books-area-gate.js (the gate on /api/books) · routes/books.js (bankWriter) · lib/actor-areas.js (GET /api/actors/areas · PATCH /api/actors/:id/areas) · middleware/auth.js (puts identities.area_grants on the identity).
 * FLOW      identity (level · reach · costs · area_grants, all read from the database row each request) → areaLevel(identity, 'accounts', now) → 'see' | 'work' | null → the gate compares it with what the route needs.
 * CARD      18-identity-sign-in-and-access/access-levels
 * ⭐ ONE EXPIRY FUNCTION: liveLevel judges `until` on EVERY read (no job): the gate and the people screen both call it, so on 1 January they cannot disagree. A lapsed grant counts as never given.
 * ⭐ A GRANT ADDS, NEVER REMOVES, and the person's old level still caps it: a View-only person granted `work` reads, and nothing more (areaLevel returns `see`, the bank writes need `work`).
 * ⭐ A MISSING COLUMN IS NO GRANTS: before the migration (b868) identity.area_grants is undefined → {}; the preset's own areas still count, a person's own grant cannot exist yet.
 * ⚠️ The day is the UTC day: `until` 2026-12-31 is open through the whole of that UTC day (a shop's own zone is not known at the gate, which runs before the ledger's settings are read).
 */
const access = require('./access');

/** the areas the server enforces TODAY, and so the only ones the owner may open (tests/l16-staff-areas.test.cjs: grantable == the areas the books gate names). Any other manifest id is refused in words. */
const GRANTABLE = Object.freeze(['accounts', 'reports', 'finance']);
/** the two levels of an area: see (read) and work (read plus that area's everyday writes: for accounts, the bank statements and marks only) */
const LEVELS = Object.freeze(['see', 'work']);
const RANK = Object.freeze({ see: 1, work: 2 });
const DAY_FORM = /^\d{4}-\d{2}-\d{2}$/;

/** the UTC day of a moment as YYYY-MM-DD (`now` is a Date, a number or an ISO text; absent = now) */
const dayOf = (now) => new Date(now === undefined ? Date.now() : now).toISOString().slice(0, 10);

/** is this a real calendar day written YYYY-MM-DD */
function realDay(text) {
  if (typeof text !== 'string' || !DAY_FORM.test(text)) return false;
  const moment = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(moment.getTime()) && moment.toISOString().slice(0, 10) === text;
}

/**
 * liveLevel(grant, now) → 'see' | 'work' | null — THE ONE EXPIRY FUNCTION. A grant is { level, until: day | null, by, at }; it counts through the whole of its `until` day, and a grant with an unreadable
 * level or end date counts as never given (fail closed). `until` absent or null means no end.
 */
function liveLevel(grant, now) {
  if (!grant || typeof grant !== 'object' || !Object.prototype.hasOwnProperty.call(RANK, grant.level)) return null;
  if (grant.until === null || grant.until === undefined || grant.until === '') return grant.level;
  if (!realDay(String(grant.until))) return null;
  return dayOf(now) <= String(grant.until) ? grant.level : null;
}

/** the person's own grants as stored ({} when the column is not there yet, or holds anything but an object) */
const grantsOf = (identity) => {
  const stored = identity && identity.area_grants;
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
};

/** the level the PRESET gives this person in an area, 'see' | 'work' | null (lib/access.presetAreas: one table beside presetFor) */
function presetLevel(identity, area) {
  const level = access.levelOf(identity);
  return access.presetAreas(level, identity.whole_entity === true, identity.can_see_costs === true)[area] || null;
}

/**
 * areaLevel(identity, area, now) → 'see' | 'work' | null — what this PERSON may do in the area: the higher of the preset's own level and their own live grant, and `work` only for someone whose level may
 * write at all (an old View-only level caps it to `see`). The owner is not asked here (an entity holds everything; the caller tests lib/owner.isOwner first).
 */
function areaLevel(identity, area, now) {
  if (!identity || !GRANTABLE.includes(area)) return null;
  const personal = liveLevel(grantsOf(identity)[area], now);
  const best = [presetLevel(identity, area), personal].filter(Boolean).sort((left, right) => RANK[right] - RANK[left])[0] || null;
  if (best === 'work' && access.levelOf(identity) !== access.EDITOR) return 'see';
  return best;
}

/** does this person hold at least `need` ('see' | 'work') in the area */
const holds = (identity, area, need) => (RANK[areaLevel(identity, area)] || 0) >= RANK[need];

/**
 * areasOf(identity, now) → { accounts: { level, source: 'preset' | 'grant', until, by, at } | null } — the people screen's reading of the same answer the gate uses (so they cannot disagree):
 * `source` says where the level comes from; a person's own live grant carries its end date and who gave it.
 */
function areasOf(identity, now) {
  const out = {};
  for (const area of GRANTABLE) {
    const level = areaLevel(identity, area, now);
    const grant = grantsOf(identity)[area];
    const preset = presetLevel(identity, area);
    const personal = liveLevel(grant, now);
    const fromGrant = personal !== null && (preset === null || RANK[personal] > RANK[preset]);
    out[area] = level === null ? null : { level, source: fromGrant ? 'grant' : 'preset', until: fromGrant ? grant.until || null : null, by: fromGrant ? grant.by || null : null, at: fromGrant ? grant.at || null : null };
  }
  return out;
}

/** the grants a person's own column holds that have ENDED (until passed): [{ area, grant }], so the owner's screen can say "ended" once and the trail can keep the lapse */
function lapsedGrants(identity, now) {
  const grants = grantsOf(identity);
  return GRANTABLE.filter((area) => grants[area] && liveLevel(grants[area], now) === null).map((area) => ({ area, grant: grants[area] }));
}

module.exports = { GRANTABLE, LEVELS, RANK, dayOf, realDay, liveLevel, grantsOf, presetLevel, areaLevel, holds, areasOf, lapsedGrants };
