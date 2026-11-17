'use strict';
// @type: unit
/**
 * practice-words.test.cjs — REP-73 B6 (Fable gate, 16 Nov): the practice answer's last-stage words come from the firm's COUNTRY pack (pack-words filingVerb), never from a page:
 * AU lodges, every other pack and no pack files. Run: node tests/practice-words.test.cjs
 */
const assert = require('assert');
const words = require('../lib/pack-words');
let bad = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { bad++; console.log('  FAIL', name, '\n      ', e.message); } };
t('AU lodges', () => assert.strictEqual(words.wordsFor('AU').filingVerb, 'lodge'));
t('AE and IN file', () => { assert.strictEqual(words.wordsFor('AE').filingVerb, 'file'); assert.strictEqual(words.wordsFor('IN').filingVerb, 'file'); });
t('no country: the neutral word, never AU', () => assert.strictEqual(words.wordsFor(undefined).filingVerb, 'file'));
process.exit(bad ? 1 : 0);
