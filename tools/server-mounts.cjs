'use strict';
/**
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
function serverMounts(src) {
  const mounts = {};
  const s = String(src || '');
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
  return mounts;
}
module.exports = { serverMounts };
