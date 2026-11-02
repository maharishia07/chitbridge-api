'use strict';
/**
 * OWNS      the map of route file to mount path read from server.js (serverMounts: first mount; serverMountsAll: every mount).
 * CALLED BY tools/endpoint-usage.cjs · tests/round-trips-all.test.cjs · tools/api-register.cjs
 * CARD      28-platform-and-operations/api-standard
 *
 * tools/server-mounts.cjs — WHERE server.js MOUNTS EACH ROUTE FILE: { 'actors.js': '/api/actors', … }.
 *
 * EFF-TRIPS (2026-10-15): tools/endpoint-usage.cjs and tests/round-trips-all.test.cjs each held the same regex, and it only knew ONE
 * shape — `app.use('/api/x', …require('./routes/x'))`. server.js mounts actors · entities · governance · chits · connectors · products ·
 * combo-templates · folders by VARIABLE (`const actorsRouter = require('./routes/actors'); … app.use('/api/actors', actorsRouter);`), so
 * 37 budget rows stood at the 50-trip ceiling as "no mount in server.js" while the routes were live. Second call site → ONE helper, and it
 * reads both shapes.
 *
 *   const { serverMounts } = require('../tools/server-mounts.cjs');
 *   serverMounts(fs.readFileSync('server.js', 'utf8'))   → { file: basePath }   (first mount of a file wins)
 */
const fs = require('fs');
const path = require('path');

/**
 * partParents(routesDir) → { 'chits-trace.js': 'chits.js' } — a split route file routes/<name>-<part>.js that routes/<name>.js requires is a PART of it:
 * the parent mounts it (router.use), so server.js never names it. No folder (or none given) means no parts.
 */
function partParents(routesDir) {
  const parents = {};
  if (!routesDir || !fs.existsSync(routesDir)) return parents;
  const files = fs.readdirSync(routesDir).filter((name) => name.endsWith('.js'));
  for (const parent of files) {
    const stem = parent.slice(0, -3);
    const text = fs.readFileSync(path.join(routesDir, parent), 'utf8');
    for (const found of text.matchAll(/require\('\.\/([A-Za-z0-9_-]+)'\)/g)) {
      if (found[1].startsWith(stem + '-') && files.includes(found[1] + '.js')) parents[found[1] + '.js'] = parent;
    }
    /* sit/run6 (RAIL-106): a router another router USES is a part of it whatever its name (routes/chit-proposals.js inside routes/chits.js, at /:chit_id/proposals) */
    for (const found of text.matchAll(/router\.use\(\s*require\('\.\/([A-Za-z0-9_-]+)'\)\s*\)/g)) {
      if (files.includes(found[1] + '.js') && !parents[found[1] + '.js']) parents[found[1] + '.js'] = parent;
    }
  }
  return parents;
}

/** a part with no mount of its own answers at its parent's (copied by `copyOf`); the map comes back */
function inheritMounts(mounts, routesDir, copyOf) {
  const parents = partParents(routesDir);
  for (const part of Object.keys(parents)) {
    if (mounts[part] === undefined && mounts[parents[part]] !== undefined) mounts[part] = copyOf(mounts[parents[part]]);
  }
  return mounts;
}

/** the text of server.js (and the routes folder, for the parts) → { 'actors.js': '/api/actors', … }, the first mount of each route file */
function serverMounts(src, routesDir) {
  const mounts = {};
  /* a commented-out mount is not a mount (server.js:438 keeps one for src/routes/catalogue under /api/network; reading it as live put 18 catalogue routes at the wrong path in the trace) */
  const s = String(src || '').replace(/^\s*\/\/.*$/gm, '');
  /* shape 1 — the require sits in the mount. ⚠️ [^;] not [\s\S]: a single app.use() statement never contains a ';', so a routerless mount
     (`app.use('/api/governance', governanceRouter);`) must not run past its ';' and pair its path with the NEXT line's require. */
  for (const m of s.matchAll(/app\.use\(\s*['"]([^'"]+)['"][^;]{0,120}?require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/g)) {
    if (!mounts[m[2] + '.js']) mounts[m[2] + '.js'] = m[1];
  }
  /* shape 2 — the require is a variable: `const xRouter = require('./routes/x')` … `app.use('/api/x', [middleware,] xRouter)` */
  const vars = {};
  for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/g)) vars[m[1]] = m[2] + '.js';
  for (const m of s.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,([^;]{0,160}?)\)\s*;/g)) {
    const args = m[2]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const last = args[args.length - 1];
    if (last && vars[last] && !mounts[vars[last]]) mounts[vars[last]] = m[1];
  }
  return inheritMounts(mounts, routesDir, (parentMount) => parentMount);
}
module.exports = { serverMounts, partParents };

/**
 * serverMountsAll(serverSource) → { 'ctp.js': ['/api/ctp', ''], … } — EVERY prefix a route file is mounted at (API-1: the register lists a route once per mount; a router mounted
 * twice, or at '/', is two sets of endpoints). serverMounts above keeps only the first, which is all its two callers need.
 */
function serverMountsAll(serverSource, routesDir) {
  const text = String(serverSource || '').replace(/^\s*\/\/.*$/gm, '');
  const vars = {};
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/g)) vars[m[1]] = m[2] + '.js';
  const all = {};
  for (const m of text.matchAll(/app\.use\(\s*(?:['"]([^'"]*)['"]\s*,)?([^;]{0,200}?)\)\s*;/g)) {
    const direct = /require\(['"][^'"]*routes\/([A-Za-z0-9_-]+)['"]\)/.exec(m[2]);
    const last = m[2].split(',').map((x) => x.trim()).filter(Boolean).pop();
    const file = direct ? direct[1] + '.js' : vars[last];
    if (!file) continue;
    const prefix = m[1] === undefined || m[1] === '/' ? '' : m[1];
    (all[file] = all[file] || []).includes(prefix) || all[file].push(prefix);
  }
  return inheritMounts(all, routesDir, (parentMounts) => parentMounts.slice());
}
module.exports.serverMountsAll = serverMountsAll;
