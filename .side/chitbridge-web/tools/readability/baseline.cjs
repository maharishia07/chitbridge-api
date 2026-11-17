/* tools/readability/baseline.cjs — the READ-1 baseline: six counts per repo over own code (R1 cryptic names · R2 uncommented
 * functions · R3 long/deep functions · R4 module headers · R5 comment quality · R6 repeated magic values).
 *
 * OWNS      the per-repo aggregate and its text print — the numbers docs/planning/READ-1-BASELINE-2026-10-15.md was built from.
 * CALLED BY tools/readability.cjs (the default mode, --json, --detail).
 * FLOW      measure.collect(repo) ──▶ measure.fileFacts(each) ──▶ aggregate(facts[]) ──▶ metrics {R1..R6} ──▶ print / --json
 * CARD      qa/readability-guard
 */
'use strict';
const measure = require('./measure.cjs');

const TOP_DEFAULT = 30;
const WHAT_LINE_FROM = 10;
const LONG = 40,
  VERY_LONG = 80,
  DEEP = 4;
const REPEATED_PLACES = 2;

/** every cryptic declaration folded by name: how often declared, how often that spelling is used, where first */
function nameRows(allFacts) {
  const names = {};
  for (const facts of allFacts) {
    const declaredHere = new Set();
    for (const declaration of facts.cryptic) {
      const row =
        names[declaration.name] ||
        (names[declaration.name] = { name: declaration.name, decl: 0, uses: 0, files: new Set(), kinds: {}, inits: [], first: null });
      row.decl++;
      row.kinds[declaration.kind] = (row.kinds[declaration.kind] || 0) + 1;
      row.files.add(facts.file);
      if (!row.first) row.first = facts.file + ':' + declaration.line;
      if (declaration.init && row.inits.length < 3) row.inits.push(declaration.init);
      declaredHere.add(declaration.name);
    }
    for (const name of declaredHere) names[name].uses += facts.identifierUses[name] || 0;
  }
  return Object.values(names)
    .map((row) => Object.assign(row, { files: row.files.size }))
    .sort((left, right) => right.uses - left.uses);
}

/** conventional short names (req res db …) are counted separately so the two totals can both be reported */
function conventionalRows(allFacts) {
  const counts = {};
  for (const facts of allFacts)
    for (const declaration of facts.declarations) {
      const name = declaration.name;
      const conventional = measure.CONVENTIONAL.has(name) || measure.CONVENTIONAL.has(name.toLowerCase());
      if (conventional && declaration.kind !== 'catch' && declaration.kind !== 'forvar' && name.length <= 3) counts[name] = (counts[name] || 0) + 1;
    }
  return counts;
}

/** literals repeated in more than two places (R6) */
function literalRows(allFacts) {
  const places = {};
  for (const facts of allFacts)
    for (const literal of facts.literals)
      (places[literal.kind + ':' + literal.value] || (places[literal.kind + ':' + literal.value] = [])).push(facts.file + ':' + literal.line);
  return Object.entries(places)
    .filter(([, at]) => at.length > REPEATED_PLACES && new Set(at).size > REPEATED_PLACES)
    .map(([key, at]) => ({ k: key, n: at.length, at: at.slice(0, 3) }))
    .sort((left, right) => right.n - left.n);
}

function sumComments(allFacts) {
  const total = { lines: 0, blocks: 0, short: 0, narrative: 0, narBlocks: 0, code: 0, story: 0, longest: [] };
  for (const facts of allFacts)
    for (const key of Object.keys(total)) {
      if (key === 'longest') total.longest.push(...facts.comments.longest);
      else total[key] += facts.comments[key];
    }
  return total;
}

const describe = (fn) => `${fn.file}:${fn.line} ${fn.name || '(anon)'} ${fn.len}L${fn.depth > DEEP ? ' depth' + fn.depth : ''}`;
const topBy = (rows, key, count) =>
  rows
    .slice()
    .sort((left, right) => right[key] - left[key])
    .slice(0, count || 10)
    .map(describe);
const percent = (part, whole) => (whole ? +((part / whole) * 100).toFixed(1) : 0);

/** R1: the cryptic-name counts and the commonest offenders */
function crypticMetrics(allFacts, top) {
  const names = nameRows(allFacts);
  const conventional = conventionalRows(allFacts);
  const crypticTotal = names.reduce((total, row) => total + row.decl, 0);
  const conventionalTotal = Object.values(conventional).reduce((total, count) => total + count, 0);
  return {
    cryptic_declarations: crypticTotal,
    distinct: names.length,
    incl_conventional_declarations: crypticTotal + conventionalTotal,
    conventional_dropped: Object.keys(conventional).join(' '),
    top: names.slice(0, top || TOP_DEFAULT)
  };
}

/** R2: named functions over the what-line threshold and how many carry no comment above */
function whatLineMetrics(named) {
  const namedLong = named.filter((fn) => fn.len > WHAT_LINE_FROM);
  const uncommented = namedLong.filter((fn) => !fn.hasAbove);
  return {
    named_over_10: namedLong.length,
    without_comment: uncommented.length,
    share: percent(uncommented.length, namedLong.length),
    worst: uncommented
      .slice()
      .sort((left, right) => right.len - left.len)
      .slice(0, 10)
      .map(describe)
  };
}

/** R3: function length and nesting */
function sizeMetrics(realFunctions) {
  return {
    over_40: realFunctions.filter((fn) => fn.len > LONG).length,
    over_80: realFunctions.filter((fn) => fn.len > VERY_LONG).length,
    depth_over_4: realFunctions.filter((fn) => fn.depth > DEEP).length,
    longest: topBy(realFunctions, 'len'),
    deepest: topBy(realFunctions, 'depth')
  };
}

/** R5: comment volume, narrative share and the longest comment blocks */
function commentMetrics(allFacts) {
  const comments = sumComments(allFacts);
  return {
    comment_lines: comments.lines,
    short: comments.short,
    narrative: comments.narrative,
    commented_out_code: comments.code,
    narrative_share: percent(comments.narrative, comments.lines),
    narrative_blocks: comments.narBlocks,
    story_lines: comments.story,
    longest: comments.longest
      .sort((left, right) => right.n - left.n)
      .slice(0, 8)
      .map((block) => `${block.file}:${block.line} ${block.n} lines${block.story ? ' ⭐/⚠️' : ''}`)
  };
}

/** R6: values repeated as literals */
function literalMetrics(allFacts) {
  const literals = literalRows(allFacts);
  return {
    repeated_values: literals.length,
    numbers: literals.filter((row) => row.k.startsWith('num:')).length,
    strings: literals.filter((row) => row.k.startsWith('str:')).length,
    top: literals.slice(0, 25)
  };
}

/** the R1–R6 metrics of one repo */
function metrics(repo, root, top) {
  const { files, skipped } = measure.collect(repo, root);
  const allFacts = files.map(measure.fileFacts);
  const parseFail = allFacts.filter((facts) => facts.parseFail).map((facts) => ({ file: facts.file, err: facts.parseFail }));
  const functions = allFacts.flatMap((facts) => facts.functions);
  const realFunctions = functions.filter((fn) => !fn.wrapper);
  const named = realFunctions.filter((fn) => !fn.anon);
  const headers = allFacts.map((facts) => facts.header);
  return {
    repo,
    files: files.length,
    module_wrappers_excluded: functions.length - realFunctions.length,
    skipped,
    parseFail,
    functions: realFunctions.length,
    namedFunctions: named.length,
    R1: crypticMetrics(allFacts, top),
    R2: whatLineMetrics(named),
    R3: sizeMetrics(realFunctions),
    R4: headerMetrics(headers),
    R5: commentMetrics(allFacts),
    R6: literalMetrics(allFacts),
    _headers: headers,
    _fns: realFunctions
  };
}

/** R4: how many files carry a header, and which of OWNS, CALLED BY, FLOW and CARD it names */
function headerMetrics(headers) {
  const incomplete = headers.filter((header) => !(header.owns && header.callers && header.flow));
  return {
    files: headers.length,
    no_header: headers.filter((header) => !header.has).length,
    owns: headers.filter((header) => header.owns).length,
    callers: headers.filter((header) => header.callers).length,
    flow: headers.filter((header) => header.flow).length,
    all_three: headers.length - incomplete.length,
    biggest_without: incomplete
      .slice()
      .sort((left, right) => right.loc - left.loc)
      .slice(0, 12)
      .map((header) => header.file + ' (' + header.loc + ' lines' + (header.has ? '' : ', NO header') + ')'),
    noHeaderFiles: headers.filter((header) => !header.has).map((header) => header.file)
  };
}

/** the text report of one repo's metrics (what the baseline doc quotes) */
function print(repoMetrics, top) {
  console.log(
    `\n== ${repoMetrics.repo} · ${repoMetrics.files} files (${repoMetrics.skipped.adopted} adopted + ${repoMetrics.skipped.vendoredTill} vendored till skipped) · ${repoMetrics.functions} functions · parse failures ${repoMetrics.parseFail.length}`
  );
  console.log(
    `R1 cryptic names: ${repoMetrics.R1.cryptic_declarations} declarations · ${repoMetrics.R1.distinct} distinct (+ conventional [${repoMetrics.R1.conventional_dropped}] → ${repoMetrics.R1.incl_conventional_declarations} total)`
  );
  repoMetrics.R1.top
    .slice(0, top || TOP_DEFAULT)
    .forEach((row) =>
      console.log(
        `   ${row.name.padEnd(4)} uses ${String(row.uses).padStart(5)} decl ${String(row.decl).padStart(4)} files ${String(row.files).padStart(3)}  ${JSON.stringify(row.kinds)}  e.g. ${row.first}  = ${(row.inits[0] || '').slice(0, 50)}`
      )
    );
  console.log(`R2 named fns >10 lines: ${repoMetrics.R2.named_over_10}, with no comment above: ${repoMetrics.R2.without_comment} (${repoMetrics.R2.share}%)`);
  repoMetrics.R2.worst.forEach((text) => console.log('   ' + text));
  console.log(`R3 >40 lines: ${repoMetrics.R3.over_40} · >80 lines: ${repoMetrics.R3.over_80} · nesting >4: ${repoMetrics.R3.depth_over_4}`);
  repoMetrics.R3.longest.forEach((text) => console.log('   long ' + text));
  repoMetrics.R3.deepest.forEach((text) => console.log('   deep ' + text));
  console.log(
    `R4 header: ${repoMetrics.R4.files} files · none ${repoMetrics.R4.no_header} · owns ${repoMetrics.R4.owns} · callers ${repoMetrics.R4.callers} · flow ${repoMetrics.R4.flow} · all three ${repoMetrics.R4.all_three}`
  );
  repoMetrics.R4.biggest_without.forEach((text) => console.log('   ' + text));
  console.log(
    `R5 comment lines ${repoMetrics.R5.comment_lines}: short ${repoMetrics.R5.short} · narrative ${repoMetrics.R5.narrative} (${repoMetrics.R5.narrative_share}%) in ${repoMetrics.R5.narrative_blocks} blocks · commented-out code ${repoMetrics.R5.commented_out_code}`
  );
  repoMetrics.R5.longest.forEach((text) => console.log('   ' + text));
  console.log(`R6 values repeated >2 places: ${repoMetrics.R6.repeated_values} (numbers ${repoMetrics.R6.numbers}, strings ${repoMetrics.R6.strings})`);
  repoMetrics.R6.top.slice(0, 15).forEach((row) => console.log(`   ${String(row.n).padStart(4)}x ${row.k.slice(0, 50)}  ${row.at.join(' ')}`));
  repoMetrics.parseFail.slice(0, 8).forEach((fail) => console.log('   PARSE FAIL ' + fail.file + ' ' + fail.err));
}

/** --detail <repo> R2|R3|R4: every offender file:line for one metric */
function detailRows(repoMetrics, metric) {
  if (metric === 'R2') return repoMetrics._fns.filter((fn) => !fn.anon && fn.len > WHAT_LINE_FROM && !fn.hasAbove);
  if (metric === 'R4') return repoMetrics._headers.filter((header) => !(header.owns && header.callers && header.flow));
  return repoMetrics._fns.filter((fn) => fn.len > LONG);
}

module.exports = { metrics, print, detailRows };
