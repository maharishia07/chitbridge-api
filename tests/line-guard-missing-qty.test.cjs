'use strict';
/** tests/line-guard-missing-qty.test.cjs — PRICE-FIX F6: a quantity the AI left out is NOT 1; a rate it read is checked against the words. */
const guard = require('../lib/line-guard');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
const missing = guard.checkLine({ particulars: 'thakkali', raw_phrase: 'pathu kilo thakkali' }, []);
t('missing qty → null, not 1', missing.qty === null);
t('missing qty is flagged', missing.missing === true);
const g = guard.guardLines([{ particulars: 'thakkali' }], 'pathu kilo thakkali');
t('guardLines: needs_human + QTY_NEEDS_CHECK', g.line_items[0].needs_human === true && g.quantity_check.code === 'QTY_NEEDS_CHECK' && g.line_items[0].qty_missing === true);
t('an explicit qty is untouched', guard.checkLine({ qty: 3 }, [3]).qty === 3 && !guard.checkLine({ qty: 3 }, [3]).missing);
const r1 = guard.checkRate({ rate: 42 }, [10, 5]);
t('rate not in the words → unverified', r1.unverified === true);
t('rate in the words → fine', !guard.checkRate({ rate: 42 }, [42]).unverified);
t('no rate → nothing to check', !guard.checkRate({}, [1]).unverified);
t('rate checked against the line phrase too', !guard.checkRate({ rate: 40, raw_phrase: '10 kg at 40' }, []).unverified);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
