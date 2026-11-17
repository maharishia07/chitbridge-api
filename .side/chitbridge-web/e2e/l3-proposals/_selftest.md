### selftest.js:1
BEFORE  'Remove ' + n + ' from your supplier list?'
AFTER   txf('Remove {name} from your supplier list?', { name: n })

### selftest.js:2
BEFORE  'filed ' + count + ' chits'
AFTER   txn('filed {count} chit', 'filed {count} chits', count)

### selftest.js:3
BEFORE  'Asked for, not agreed — ' + esc(name) + ' confirms the date.'
AFTER   txf('Asked for, not agreed — {supplier} confirms the date.', { supplier: esc(name) })

### selftest.js:4 — a DELIBERATELY WRONG rewrite, to prove the checker bites
BEFORE  'Remove ' + n + ' from your list?'
AFTER   txf('Remove{name}from your list?', { name: n })

### selftest.js:5 — a lost placeholder, the other classic failure
BEFORE  'Moving ' + ids + ' records'
AFTER   txf('Moving records', { count: ids })
