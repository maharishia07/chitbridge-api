// OWNS: static check (SEC-83) that routes/products.js never sends a raw error message in a response body.
// No DB, no server: reads the source and asserts the raw-message patterns are gone and safeErr is reused.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'products.js'), 'utf8');
const fails = [];
if (!/const \{ safeErr \} = require\('\.\.\/lib\/respond'\)/.test(src)) fails.push('products.js must reuse safeErr from lib/respond');
if (/String\(e(?: && e)?\.message\)/.test(src.replace(/why: String\(e && e\.message\)/g, ''))) fails.push('String(e.message) is still sent to a client');
if (/message: e\.message \}\);\s*\n\s*\}\s*\n\s*\}/.test(src) && /action: 'failed'[^\n]*message: e\.message/.test(src)) fails.push('bulk line failure sends raw e.message');
if (fails.length) { console.error('FAIL products-safe-errors:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('PASS products-safe-errors');
