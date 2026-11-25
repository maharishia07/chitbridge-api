#!/usr/bin/env node
/** tests/b860-guard.test.cjs - VERIFY-EL-DB A2: RUN-2026-11-14-b860 refuses to run while cb_app can still SELECT a credential column of identities (SEC-186 not run).
 *  Offline text guard; the live proof is tests/b860-guard.proof.sql (throwaway DB, mutant=true strips the guard and the file then applies - the proof reads FAIL). FAILS ON THE PARENT (no guard). */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'RUN-2026-11-14-b860-identities-rls.sql'), 'utf8').replace(/--[^\n]*/g, '');
let n = 0; const it = (w, f) => { f(); n++; console.log('  ok  ' + w); };
const guardAt = sql.indexOf('$guard$'), alterAt = sql.indexOf('ALTER TABLE identities ENABLE ROW LEVEL SECURITY');
it('a guard block exists and comes BEFORE the first ALTER', () => assert.ok(guardAt > 0 && guardAt < alterAt));
const guard = sql.slice(guardAt, sql.indexOf('END $guard$'));
it('it names all three credential columns', () => ['otp_code', 'otp_code_hash', 'pin_hash'].forEach((c) => assert.ok(guard.includes("'" + c + "'"), c)));
it('it asks has_column_privilege for cb_app SELECT and raises (42501)', () => assert.ok(/has_column_privilege\('cb_app', 'public\.identities', c, 'SELECT'\)/.test(guard) && /RAISE EXCEPTION/.test(guard) && /42501/.test(guard)));
it('it sits inside the transaction (after BEGIN)', () => assert.ok(sql.indexOf('BEGIN;') < guardAt));
it('the proof file exists and holds the mutant switch', () => assert.ok(/\if :mutant/.test(fs.readFileSync(path.join(__dirname, 'b860-guard.proof.sql'), 'utf8'))));
console.log('\n  ' + n + ' checks');
