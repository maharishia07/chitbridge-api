/* app/test-menu-tree.js — the product as a menu. ONE shape, two surfaces.
 *
 * OWNS      testMenuTree(cases, last): the product as a menu (groups, doors, counts), the one shape both the Report and the lab draw
 * FLOW      cases + last run -> testMenuTree -> groups/doors/counts -> each surface draws them in its own shell
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/test-board
 *
 * ── ⭐⭐ WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"yes, give the lab its own tree as well."*
 *
 * The Report grew a menu tree an hour ago. Giving the lab one means answering the same three questions again —
 * which doors exist, what is behind each, and how much of it has ever been run — and answering them a second
 * time in a second file is the shape that produced nearly every bug of the last three days: three heading
 * readers, three tab dispatches, three canonicalisers, two verdicts, two counters. ⚠️ Each time, the copy that
 * got fixed was not the copy being read.
 *
 * ⭐ SO THE SHAPE LIVES HERE AND THE DRAWING DOES NOT. `testMenuTree()` returns groups, doors and counts; each
 * surface renders them in its own shell, because the shells genuinely differ — the Report draws a full-width
 * tree with fixed tracks, the lab draws a narrow panel beside the app. Sharing the ARITHMETIC and not the
 * markup is the line that has held for testVerdict and testCounts, and it holds here for the same reason.
 *
 * ⚠️ A classic script, no imports, no framework: app.html loads capabilities into one shared scope and
 * testing.html is a single standalone page. A plain <script> is the only thing both can agree on.
 
 * CALLED BY public/app/cap-testing.js, public/testing.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/test-board
 */

/**
 * ⭐ THE MENU PATH IS WRITTEN BY THE SWEEP as `Rail › Task` — group, then door. Splitting it here rather than
 * in each renderer means the two surfaces cannot disagree about what a door IS, which is the only way the lab
 * and the Report can be compared instead of doubted.
 *
 * ⚠️ A case with no `menu` is not an error and not a gap: journey steps walk several doors and automated files
 * walk none. They are COUNTED and reported as `offMenu`, so a tree drawn from this can say so out loud rather
 * than quietly showing 266 of 889 cases as though that were the whole board.
 *
 * @param cases  every case the board holds
 * @param last   case_key → the latest result, or undefined
 * @returns {{groups: Array, offMenu: number, total: number, doors: number}}
 */
function testMenuTree(cases, last) {
  var lastRun = last || {};
  var byGroup = {},
    order = [],
    count = 0;

  (cases || []).forEach(function (item) {
    if (!item.menu) {
      count++;
      return;
    }
    var bits = String(item.menu).split('›');
    var group = (bits[0] || '').trim() || 'Elsewhere';
    var door = (bits[1] || '').trim() || group;
    if (!byGroup[group]) {
      byGroup[group] = { name: group, doors: {}, order: [] };
      order.push(group);
    }
    var groupEntry = byGroup[group];
    if (!groupEntry.doors[door]) {
      groupEntry.doors[door] = { name: door, cases: [] };
      groupEntry.order.push(door);
    }
    groupEntry.doors[door].cases.push(item);
  });

  /**
   * ⭐ WHAT A BRANCH HAS ACTUALLY BEEN RUN FOR, and the three numbers are deliberately separate:
   *   run    a result exists — ⚠️ NOT that it passed. [[the board's standing distinction]]
   *   bad    the latest result is a fail or a blocked
   *   gen    the case was SWEPT from the menu and carries no expectation a person decided on
   * ⚠️ `gen` is what stops a door of green ticks reading as proof. A generated pass says the control did
   * something; nobody has yet written what it should do.
   */
  function evidence(list) {
    var e = { total: list.length, run: 0, bad: 0, gen: 0 };
    list.forEach(function (item) {
      var l = lastRun[item.case_key];
      if (l) e.run++;
      if (l && (l.status === 'fail' || l.status === 'blocked')) e.bad++;
      if (item.generated) e.gen++;
    });
    return e;
  }

  var groups = order.map(function (item) {
    var groupEntry = byGroup[item];
    var nestedDoors = groupEntry.order.map(function (entry) {
      var D = groupEntry.doors[entry];
      var e = evidence(D.cases);
      /* ⭐ sorted by key so a tester walking a door twice walks it in the same order both times */
      D.cases.sort(function (first, second) {
        return (first.case_key || '') < (second.case_key || '') ? -1 : 1;
      });
      return { name: D.name, cases: D.cases, total: e.total, run: e.run, bad: e.bad, gen: e.gen };
    });
    var flat = nestedDoors.reduce(function (sum, entry) {
      return sum.concat(entry.cases);
    }, []);
    var groupEvidence = evidence(flat);
    return { name: groupEntry.name, doors: nestedDoors, total: groupEvidence.total, run: groupEvidence.run, bad: groupEvidence.bad, gen: groupEvidence.gen };
  });

  var doors = groups.reduce(function (sum, item) {
    return sum + item.doors.length;
  }, 0);
  var total = groups.reduce(function (t, item) {
    return t + item.total;
  }, 0);
  return { groups: groups, offMenu: count, total: total, doors: doors };
}

/**
 * ⭐⭐ WHAT RETIREMENT MEANS, IN ONE SENTENCE, IN ONE PLACE. Athi: *"the same has to be updated with retired if
 * it is not going to be useful anymore."* Both surfaces print this under their tree; two wordings of one
 * mechanism is how a reader ends up believing whichever is wrong.
 *
 * ⚠️ It describes a mechanism that ALREADY RUNS. If it ever stops being true this is the most misleading
 * sentence on either page.
 */
var TEST_MENU_RETIRED_NOTE =
  'This tree is swept from the live rail and the live screens, so a door or control added tomorrow appears ' +
  'without anybody adding it — and one that is removed stops being swept, which retires its case at the ' +
  'next load. Retired is not deleted: the case and every result recorded against it stay on the record. ' +
  '⚠ A load carrying less than 90% of what the board already holds retires nothing and says so.';
