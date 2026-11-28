'use strict';
/**
 * lib/books-pack-pin.js — WHICH VERSION OF A COUNTRY'S RULES A DAY IS READ UNDER (pack pinning, 28 Nov 2026; every country, no AU-only path).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      lodgedCheck (ACC-420: the loud mismatch receipt) · packClosedUnder · stampOf · versionOn · packAt (the pack of a setting on a day) · restamp (the ONE door that moves a shop's version forward) · stampOnEnable
 * CALLED BY lib/books.js packOf (the shop's current pack; a day for a period read) · lib/books-period.js (a return and a close read the period's own day) · routes/books.js POST /pack-version
 * CARD      14-accounting/README · engines docs/COUNTRY-STANDARD.md (versions are frozen, registered, replayed)
 * FLOW      setting + day → the version read (versionOn) → the pack (packAt); a close's carried version vs the one read now → lodgedCheck's receipt
 * RULE      rules are dated and a lodged return is frozen. books_setting.pack_history is dated rows [{ from, version, by, at }] (append-only: a restamp only ever adds a row);
 *           a day reads the last row on or before it; before any row, or with no history, the shop's stamp (books_setting.pack_version); no stamp = the latest pack (what every
 *           shop that was never stamped does today). A legacy numeric stamp ('1', the chart version) counts as no stamp. A version the build cannot resolve is REFUSED loudly, never read as the latest.
 *           A restamp moves forward only (a version above the one now in force, resolvable in this build), from a day that is the start of a tax period; the old version is written as the
 *           base row first, so every earlier day, closed or open, still reads what it read. It never touches posted history.
 */
const SEMVER = /^\d+\.\d+\.\d+$/;
const BASE_DAY = '0001-01-01';
const E = () => require('./books-engines');
const REG = () => require('./regulation'); /* a pack AT a version is the regulation registry's (previous[] included); books-engines.packs().packFor(country) is its latest */
const refuse = (why, code) => Object.assign(new Error(why), { refused: true, code: code || 'BOOKS_PACK_VERSION' });

const stampOf = (setting) => (setting && SEMVER.test(String(setting.pack_version || '')) ? String(setting.pack_version) : null);
const historyOf = (setting) => (setting && Array.isArray(setting.pack_history) ? setting.pack_history.filter((row) => row && row.from && SEMVER.test(String(row.version))).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) : []);
/** the version a day reads: the last dated row on or before it, else the stamp; null = the latest pack */
function versionOn(setting, day) {
  const rows = historyOf(setting);
  if (!rows.length) return stampOf(setting);
  if (!day) day = require('./shop-clock').today(); /* no day asked = what is in force today */
  const on = rows.filter((row) => row.from <= String(day).slice(0, 10));
  return on.length ? on[on.length - 1].version : rows[0].version; /* before the first row: the first row is the base (a restamp always writes one) */
}
/** the country's pack at that version (null = the latest); a version this build does not hold is refused in words */
function packAt(setting, day) {
  const country = setting && setting.country,
    version = versionOn(setting, day),
    held = version ? REG().packFor(country, version) : null,
    pack = held ? Object.assign({ fy_start_month: held.fiscalYear && held.fiscalYear.startMonth }, held) : version ? null : E().packs().packFor(country); /* the accounts-packs door adds the legacy fy_start_month beside fiscalYear: the same shape here */
  if (!pack && version) throw refuse('This shop reads its ' + String(country || '').toUpperCase() + ' rules at version ' + version + ', which this build does not hold. Nothing was read under another version.', 'BOOKS_PACK_VERSION_UNKNOWN');
  return pack;
}
/** the version a new ledger is stamped with: the pack's latest in this build (so a later pack never moves it) */
const stampOnEnable = (country) => {
  const pack = REG().packFor(country);
  return pack && SEMVER.test(String(pack.version)) ? pack.version : null;
};
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };

/**
 * restamp(handle, entity, setting, { to, from, by, startsOfPeriods }) → { from, version, was }
 * `startsOfPeriods`: the start days of the shop's tax periods the caller read (books-period); `from` must be one of them, so no period reads two versions.
 * ONE statement moves the stamp and appends the dated row; ONE books_change_log row is the audit.
 */
async function restamp(handle, entity, setting, opt) {
  const store = require('./books-store'), to = String((opt && opt.to) || ''), from = String((opt && opt.from) || '').slice(0, 10);
  if (!setting || !setting.enabled) throw refuse('The books are not on for this shop.', 'BOOKS_NOT_ON');
  if (!(await require('./schema').hasColumn('books_setting', 'pack_history'))) throw refuse('The version history is not set up on this server yet (b914).', 'BOOKS_PACK_NOT_MIGRATED');
  if (!SEMVER.test(to) || !REG().packFor(setting.country, to)) throw refuse('This build holds no ' + String(setting.country || '').toUpperCase() + ' rules at version ' + (to || '(none)') + '.', 'BOOKS_PACK_VERSION_UNKNOWN');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw refuse('Say the day the new rules start (YYYY-MM-DD).', 'BOOKS_PACK_FROM');
  if (!((opt && opt.startsOfPeriods) || []).includes(from)) throw refuse('A new version starts on the first day of a tax period, so no period is read under two versions.', 'BOOKS_PACK_FROM');
  const now = versionOn(setting, '9999-12-31') || REG().packFor(setting.country).version;
  if (cmp(to, now) <= 0) throw refuse('A restamp only moves forward: this shop reads version ' + now + ' now, ' + to + ' is not newer.', 'BOOKS_PACK_BACKWARD');
  const rows = historyOf(setting), last = rows[rows.length - 1];
  if (last && from <= last.from) throw refuse('A restamp starts after the last one (' + last.from + ').', 'BOOKS_PACK_FROM');
  const at = require('./shop-clock').now().toISOString(), added = (rows.length ? [] : [{ from: BASE_DAY, version: now, by: null, at }]).concat([{ from, version: to, by: (opt && opt.by) || null, at }]);
  await require('./books-store-pack').addPackHistory(handle, entity, added, to);
  await store.logChange(handle, entity, { by: opt && opt.by, table_name: 'books_setting', row_id: entity, field: 'pack_version', old: now, new: to + ' from ' + from });
  return { from, version: to, was: now };
}
/** the route's one call: read the shop's tax-period starts for the day's year, then restamp — in the caller's transaction */
async function restampFor(handle, entity, setting, body, by) {
  const B = require('./books'), packs = E().packs(), from = String((body && body.pack_from) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw refuse('Say the day the new rules start (YYYY-MM-DD).', 'BOOKS_PACK_FROM');
  const state = await require('./books-period').returnStateFor(handle, entity, setting, packs.fiscalYearOf(from, B.packOf(setting)));
  return restamp(handle, entity, setting, { to: body.pack_version, from, by, startsOfPeriods: (state.periods || []).map((item) => item.start) });
}
/**
 * lodgedCheck(carriedVersion, readsUnder, period) → null | receipt. THE ONE enforcer (ACC-420): a closed (lodged) period carries the version it was closed under (tax_close.pack_version);
 * the version the read now runs under is the pack.version the caller already holds. Two version strings compared, nothing recomputed. Absent / malformed carried version (a close made before it was
 * carried, a nil close) = null: nothing is invented. A difference = a receipt the caller attaches to its answer: the figures stand as carried, the owner is told, never a silent re-read.
 */
function lodgedCheck(carriedVersion, readsUnder, period) {
  const was = SEMVER.test(String(carriedVersion || '')) ? String(carriedVersion) : null, now = SEMVER.test(String(readsUnder || '')) ? String(readsUnder) : null;
  if (!was || !now || was === now) return null;
  return { code: 'BOOKS_PACK_VERSION_MISMATCH', period: period || null, closed_under: was, reads_under: now, words: 'This period was closed under rules version ' + was + ' and is now read under ' + now + '. The closed figures stand as they were closed; they were not recalculated.' };
}
/** the pack a closed period replays under: the version it was closed under when this build holds it, else the pack given (the receipt says so) */
function packClosedUnder(country, carriedVersion, fallback) {
  const held = SEMVER.test(String(carriedVersion || '')) ? REG().packFor(country, carriedVersion) : null;
  return held ? Object.assign({ fy_start_month: held.fiscalYear && held.fiscalYear.startMonth }, held) : fallback;
}
module.exports = { lodgedCheck, packClosedUnder, restampFor, stampOf, versionOn, packAt, stampOnEnable, restamp, SEMVER };
