/* fixture — an engines test: requires the source and calls the function */
'use strict';
const { round } = require('../src/money');
if (round(1.4) !== 1) throw new Error('round');
