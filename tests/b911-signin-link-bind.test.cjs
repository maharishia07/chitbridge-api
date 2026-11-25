#!/usr/bin/env node
/** tests/b911-signin-link-bind.test.cjs — offline guard for migrations/b911 (M2 of GF-platform-01): the trigger exists, binds identity to entity, and the DB proof file is kept beside it.
 *  The live proof is tests/b911-signin-link-bind.proof.sql (throwaway DB, mutant=true must show the attacks accepted). */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'migrations', 'b911_signin_provider_link_identity_bind.sql'), 'utf8').replace(/--[^\n]*/g, '');
let n = 0; const it = (w, f) => { f(); n++; console.log('  ok  ' + w); };
it('a BEFORE INSERT OR UPDATE OF entity_id, identity_id trigger is created', () => assert.ok(/BEFORE INSERT OR UPDATE OF entity_id, identity_id ON public\.signin_provider_link/.test(sql)));
it('the check ties identity to entity (itself or its person)', () => assert.ok(/i\.identity_id = NEW\.identity_id/.test(sql) && /i\.identity_id = NEW\.entity_id OR i\.parent_entity_id = NEW\.entity_id/.test(sql)));
it('definer with an empty search_path, no PUBLIC execute', () => assert.ok(/SECURITY DEFINER SET search_path = ''/.test(sql) && /REVOKE ALL ON FUNCTION public\.signin_provider_link_identity_bind\(\) FROM PUBLIC/.test(sql)));
it('a database without b878 gets a NOTICE, not an error', () => assert.ok(/to_regclass\('public\.signin_provider_link'\) IS NULL/.test(sql) && /RAISE NOTICE/.test(sql)));
it('the proof file exists and holds the mutant switch', () => assert.ok(/\if :mutant/.test(fs.readFileSync(path.join(__dirname, 'b911-signin-link-bind.proof.sql'), 'utf8'))));
console.log('\n  ' + n + ' checks');
