'use strict';
/**
 * policy-words-1130.test.cjs — FW-41 (walk 25 Nov): Settings > Policy printed stored keys ("google,microsoft", "accepted", "per-party").
 * Every enum/set rule the card shows carries a word for each stored value, from ONE place (the CARD row; the sign-in words come
 * from data/signin-providers.json). Hand: 4 books_at values, 2 dispute_scope values, each provider key.
 * Run: node tests/policy-words-1130.test.cjs        CARD 20-settings-governance-and-plan
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'policy.js'), 'utf8');
const at = src.indexOf("label: 'Orders go to the books'"), seg = src.slice(at, at + 600);
for (const v of ['received', 'accepted', 'completed', 'manual']) assert(seg.includes(v + ': '), 'books_at word for ' + v);
assert(/dispute_scope: \{[^}]*labels:[^}]*'per-party':[^}]*shared:/.test(src), 'dispute_scope words');
const sg = require('../lib/policy-signin');
const reg = require('../data/signin-providers.json').providers;
for (const r of reg) { assert(sg.CARD.signin_providers.labels[r.key], 'sign-in word for ' + r.key); assert(sg.CARD.signin_required.labels[r.key]); }
assert.strictEqual(sg.CARD.signin_required.labels.none, 'Code or PIN (as now)');
console.log('ok policy-words-1130');
