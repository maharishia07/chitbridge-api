'use strict';
/**
 * amend-live-set.test.cjs — RAIL-128: the b138 pure layer (liveSet / liveLines and the shape check before any DB call) runs in the offline guards.
 * The cases live in ONE place, scripts/prove-amend.js (rules R4, R6-R9 of docs/01-rail-core-the-chit/functions/amend-reprice-costs.md);
 * this file only enrols them, so CI sees its exit code (1 on any ✗). No database, no network.
 * Run: node tests/amend-live-set.test.cjs
 */
require('../scripts/prove-amend.js');
