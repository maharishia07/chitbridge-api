// @stage tested
// @stage-note ONE helper that announces a retiring outward route in the answer itself (Deprecation RFC 9745, Sunset RFC 8594). No route uses it yet: nothing is deprecated today.
// OWNS      the two answer headers and the Link relations of a deprecated route (deprecate), and the date forms they need (deprecationValue, sunsetValue).
// CALLED BY none yet; the first outward route to be retired mounts it (API-STANDARD S13, S28). tests/deprecation.test.cjs
// FLOW      deprecate({ deprecated, sunset, link? }) ──▶ middleware ──▶ res.set Deprecation: @<unix seconds> · Sunset: <HTTP-date> · Link rel="deprecation" / "sunset" ──▶ next()
// CARD      28-platform-and-operations/api-standard
'use strict';

/** RFC 9745: the Deprecation value is a Structured Field Date, "@" and whole seconds since 1970 (UTC) */
function deprecationValue(when) {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) throw new TypeError('deprecation date is not a date: ' + when);
  return '@' + Math.floor(t / 1000);
}

/** RFC 8594: the Sunset value is an HTTP-date (RFC 9110 5.6.7), always GMT */
function sunsetValue(when) {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) throw new TypeError('sunset date is not a date: ' + when);
  return new Date(t).toUTCString();
}

/**
 * Middleware for a deprecated route. `deprecated` is when it was deprecated, `sunset` when it stops (not before `deprecated`);
 * `link` (optional) is a page that says what to use instead and is sent with rel="deprecation"; the sunset relation is sent when `sunsetLink` is given.
 * @throws at mount time on a bad date or a sunset before the deprecation, so a wrong date never ships.
 */
function deprecate({ deprecated, sunset, link, sunsetLink }) {
  const dep = deprecationValue(deprecated);
  const sun = sunsetValue(sunset);
  if (new Date(sunset).getTime() < new Date(deprecated).getTime()) throw new RangeError('sunset is before the deprecation date');
  const links = [];
  if (link) links.push('<' + link + '>; rel="deprecation"; type="text/html"');
  if (sunsetLink) links.push('<' + sunsetLink + '>; rel="sunset"');
  return function deprecated_route(req, res, next) {
    res.set('Deprecation', dep);
    res.set('Sunset', sun);
    if (links.length) res.append('Link', links.join(', '));
    next();
  };
}

module.exports = { deprecate, deprecationValue, sunsetValue };
