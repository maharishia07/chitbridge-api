'use strict';
/* WX-O2C (2026-10-13): CB Accounts opens a bill by its door (app.html #/app/chit/<id>). Found on the real stack: a bill older than the Task list's
   first page (50 rows) opened, then the list's load replaced it with row 1 — the owner saw a Day summary instead of the bill.
   The door pins the id (UI._byId — main's WX-P2P-09 name for the same pin, INT5b) and the list's "is the pane showing what is selected" check honours it. Run: node tests/wx-chit-door.test.cjs */
const fs = require('fs'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const html = fs.readFileSync(__dirname + '/../public/app.html', 'utf8');
/* iter1: the pass wraps lines and renames locals, so the pinned snippets are matched without whitespace */
const flatHtml = html.replace(/\s+/g, '');
const door = /if\((?:_bill|billHash)&&SESSION\.token\)\{.*?return(?:true)?;\}/.exec(flatHtml);
ok(door && /UI\._byId=decodeURIComponent\((?:_bill|billHash)\[1\]\)/.test(door[0]) && /openChit\(UI\._byId\)/.test(door[0]), 'the door pins the id it opens');
const line = /const here = (UI\.sel && \([^;]+\));/.exec(html);
ok(line, 'the list load asks "is the selection here, or pinned"');
const here = (UI) => Function('UI', 'return ' + line[1])(UI);
const rows = [{ id: 'day-summary' }, { id: 'bill-new' }];
ok(here({ sel: 'bill-old', _byId: 'bill-old', rows }), 'a pinned bill NOT on the first page stays open');
ok(!here({ sel: 'other-folder', _byId: 'bill-old', rows }), 'a selection from another folder (not pinned, not listed) is still replaced');
ok(here({ sel: 'bill-new', rows }), 'a listed selection stays');

/* …and the door-opened chit wears MY copy's status (participants[] row of the header's entity), not a fixed 'delivered' (it read OPEN after Close) */
const base = /current_status:(\(\(r\.participants\|\|\[\]\)\.find\(\(x\)=>x&&x\.entity_id===h\.entity_id\)\|\|\{\}\)\.current_status\|\|'delivered'),open_dispute_count:0,bill_total:r\.bill_total\}\);/.exec(flatHtml);
ok(base, 'openChit builds an unlisted chit from my participant row');
const mine = (r, h) => Function('r', 'h', 'return ' + base[1])(r, h);
ok(mine({ participants: [{ entity_id: 'buyer', current_status: 'delivered' }, { entity_id: 'shop', current_status: 'completed' }] }, { entity_id: 'shop' }) === 'completed', 'the shop sees its own completed, not the buyer\'s delivered');
ok(mine({}, { entity_id: 'shop' }) === 'delivered', 'an api without participants keeps the old default');
console.log(n + ' checks passed');
