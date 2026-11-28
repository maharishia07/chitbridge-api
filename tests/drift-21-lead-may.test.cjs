/**
 * drift-21-lead-may.test.cjs - DRIFT 21 GUARD (28 Nov 2026). GET /api/crm/parties/:id must not say a lead can be moved by a seat whose POST /parties/:id/stage the write gate refuses
 * (PROOF-2026-11-27 row 21: a view-only actor got lead.may.ok true, the POST answered 403 READ_ONLY). lib/lead-may.leadMay folds the seat's write verdict (lib/access.mayWrite, with its code).
 * Fails if leadMay stops following the write verdict, or routes/crm.js grants the lead a may from anywhere else.
 * Run: node tests/drift-21-lead-may.test.cjs
 * CARD      crm/memberships
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm.js'), 'utf8');
const { leadMay } = require('../lib/lead-may');
const bad = []; let n = 0;
const need = (ok, why) => { n++; if (!ok) bad.push(why); };
const editor = { write: { may: true, code: null, why: null } }, viewer = { write: { may: false, code: 'read_only', why: 'Your login can only view.' } };
need(leadMay(true, editor).ok === true, 'an editor may move the lead');
need(leadMay(true, viewer).ok === false && leadMay(true, viewer).code === 'read_only', 'a view-only seat is refused with the rail code');
need(leadMay(false, editor).ok === false && !leadMay(false, editor).code, 'leads not migrated: refused with the not-ready words, no seat code');
need(/may: require\('\.\.\/lib\/lead-may'\)\.leadMay\(found\.leads_ready, crmMay\(req\)\)/.test(src), 'rec.lead.may no longer comes from lead-may.leadMay(..., crmMay(req))');
need(!/leads_ready \? \{ ok: true \}/.test(src), 'a lead may is granted from leads_ready alone');
if (bad.length) { for (const b of bad) console.log('   FAIL ' + b); console.log('  ' + n + ' checks'); process.exit(1); }
console.log('   ok   drift 21: a lead\'s "Move to" is greyed for a seat the stage POST refuses\n  ' + n + ' checks');
