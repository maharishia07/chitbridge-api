/**
 * drift-21-lead-may.test.cjs - DRIFT 21 GUARD (28 Nov 2026). Offline static guard.
 * GET /api/crm/parties/:id must not say a lead can be moved by a seat whose POST /parties/:id/stage the write gate refuses (PROOF row 21: view-only actor got
 * lead.may.ok true, the POST answered 403 READ_ONLY). The lead's may is leadMay(ready, crmMay(req)): the seat's own write verdict (lib/access.mayWrite).
 * Fails if routes/crm.js grants a lead `may: ... { ok: true }` without the write verdict, or leadMay stops reading may.write.
 * Run: node tests/drift-21-lead-may.test.cjs
 * CARD      crm/memberships
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm.js'), 'utf8');
const bad = [];
if (!/const leadMay = \(ready, may\) =>[^\n]*may\.write\.may/.test(src)) bad.push('leadMay no longer reads the seat write verdict (may.write.may)');
if (!/may: leadMay\(found\.leads_ready, crmMay\(req\)\)/.test(src)) bad.push('rec.lead.may no longer comes from leadMay(..., crmMay(req))');
if (/leads_ready \? \{ ok: true \}/.test(src.replace(/const leadMay[^\n]*\n/, ''))) bad.push('a lead may is granted from leads_ready alone');
if (bad.length) { for (const b of bad) console.log('   FAIL ' + b); process.exit(1); }
console.log('   PASS drift 21: a lead\'s "Move to" is greyed for a seat the stage POST refuses');
