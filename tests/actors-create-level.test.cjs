'use strict';
/**
 * actors-create-level.test.cjs — WX-O2C (2026-10-13): a new employee is created at the LEVEL the owner chose.
 * Found walking O2C on the real stack: POST /api/actors validated `access_level` and dropped it; only `hat` was inserted and the column's
 * default ('editor') won in access.levelOf — a "View-only" employee billed at the counter and the server took the bill.
 * Offline: reads the route's INSERT and runs its level expression against lib/access (the one place levels live). Run: node tests/actors-create-level.test.cjs
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const access = require('../lib/access');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'actors.js'), 'utf8');
const ins = /INSERT INTO identities \([\s\S]*?\)`,\s*\[[\s\S]*?\]\.concat\(_lvlCol \? \[access_level[^\]]*\] : \[\]\)/.exec(src);   /* INT5b: main's FX-L2C / WX-P2P-18 INSERT kept — it also writes the reach (whole_entity) */
ok(ins && /hat, entity_kind\$\{_lvlCol \? ', access_level/.test(ins[0]) && /\$\{_lvlCol \? ',\$13/.test(ins[0]), 'the INSERT writes access_level when the column exists (pre-b173: absent)');
const expr = /const access_level = ([^;]+);/.exec(src);
ok(expr, 'the level is chosen in one expression');
const pick = (body, hat) => Function('access', 'req', 'hat', 'return ' + expr[1])(access, { body }, hat);
ok(pick({ access_level: 'viewer' }, 'view_only') === 'viewer', 'the screen\'s viewer (sent with hat view_only) is stored as viewer');
ok(pick({}, 'view_only') === 'commenter', 'an older client sending only hat view_only gets what levelOf would have derived (commenter)');
ok(pick({}, 'act') === 'editor' && pick({ access_level: 'bogus' }, 'act') === 'editor', 'nothing chosen: editor, as before');
ok(access.levelOf({ identity_type: 'actor', access_level: pick({ access_level: 'viewer' }, 'view_only'), hat: 'view_only' }) === 'viewer', 'levelOf then answers viewer — the hat gate refuses the bill');
console.log(n + ' checks passed');
