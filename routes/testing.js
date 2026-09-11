/**
 * /api/testing — THE TEST BOARD: cases you can append to, results you can record, and who recorded them.
 *
 * Athi, 2026-09-11: *"in the PDF we cannot update pass or fail. Can we have a simple application from our
 * framework itself to create the test cases and update the status and the result, so we know that each of the test
 * cases passed and who has tested? And we can always append the use case. Also we can qualify with engine,
 * transport, web, capability etc."* Then: *"pass/fail status for each run — unit test / T1 / T2 / regression and
 * so on, manual and so on."* And finally, his standing motto: *"if a standard framework exists in open framework
 * and we can integrate, then also fine."*
 *
 * ── ⭐⭐⭐ WHAT WAS ADOPTED, AND WHAT WAS NOT ─────────────────────────────────────────────────────────────────
 *
 * ADOPTED — **JUnit XML**, the de-facto interchange for test results. Playwright emits it with one config line,
 * every CI system reads it, and Kiwi TCMS, TestRail, Allure and ReportPortal all import it. `POST /results/junit`
 * takes it verbatim. That is the half where reinventing would have been genuinely expensive: a private results
 * format would strand every automated run inside this one screen, and would have to be re-implemented by anything
 * that ever wants to read it.
 *
 * NOT ADOPTED — a test-management APPLICATION (Kiwi TCMS, TestLink). Each is a second service with its own
 * database, its own user accounts and its own backups, and none of them knows what an entity is. Adopting one
 * would mean a solo operator running a system rather than using one, and a set of logins with no relationship to
 * the RLS that isolates everything else here. The board itself is ~200 lines because it rides what already exists.
 *
 * ── ⭐⭐ AND THE CASES ARE NOT A NEW TABLE ───────────────────────────────────────────────────────────────────
 *
 * A test case is a `definition` of kind 'testcase' — authored, named, versioned, exactly like a tax slab or a
 * reward programme, and for the same reason: it is a rule somebody declared that has to be quotable months later
 * against a result it produced. So creating one, editing one, versioning one and isolating one per entity are all
 * things that already work, and a result records WHICH VERSION was in front of the tester.
 *
 * ⚠️ Only `test_result` is new (b219), because results ACCUMULATE and a definition does not — the same split
 * b213 made for points, and the same append-only grant: a re-test is a NEW ROW and the latest one wins.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');

/* The two axes, in one place. The server is the authority so a screen cannot offer a value the CHECK refuses. */
const RUN_KINDS = ['manual', 'unit', 't0', 't1', 't2', 't3', 'regression'];
const LAYERS = ['engine', 'transport', 'web', 'capability', 'db', 'connector'];
const STATUSES = ['pass', 'fail', 'blocked', 'skipped'];

router.get('/vocabulary', (req, res) => {
  res.json({
    run_kinds: RUN_KINDS, layers: LAYERS, statuses: STATUSES,
    /* ⚠️ SAID OUT LOUD, because the distinction is the one people get wrong: 'blocked' is not 'fail'. */
    says: {
      pass: 'It did what the case says it should.',
      fail: 'It did something else. The note should say what.',
      blocked: 'It could not be reached — something earlier is broken. This says nothing about the case itself.',
      skipped: 'Deliberately not run this time. Not applicable, or out of scope for this sitting.',
    },
  });
});

/* ── who is recording this ────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ BOTH the id and the name, stored together on the row. The id is the truth; the name is what the board shows
 * months later, when the person may no longer have a row to join to. */
function testerOf(req) {
  const i = req.identity || {};
  return { id: i.identity_id || null, name: i.display_name || i.user_id || 'someone' };
}

/* ── THE CASES ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/testing/cases — every test case this entity holds, newest version, grouped by module.
 * ⚠️ ONE QUERY, not one per case: the version join is done in SQL. A board that opens 110 cases would otherwise
 * make 110 round trips, and at 1.4–2.4 s per Railway↔Supabase call that is not a screen, it is an afternoon.
 */
router.get('/cases', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT d.definition_id, d.name, d.sub_kind, d.status, d.current_version, v.rules
         FROM definition d
         JOIN definition_version v
           ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.status <> 'retired'
        ORDER BY d.sub_kind, d.name`, [entity_id]));

    const cases = r.rows.map((x) => Object.assign(
      { definition_id: x.definition_id, case_key: x.name, module_key: x.sub_kind || '—',
        version: x.current_version, status: x.status }, x.rules || {}));
    res.json({ cases, count: cases.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not read the test cases', message: String(err.message || err) });
  }
});

/**
 * POST /api/testing/cases/import — put a whole document of cases in at once.
 *
 * ⭐ IT IS AN UPSERT BY (module, case key), because the source of truth for the WORDING is the document in the
 * repository, and a re-import after an edit must land as a NEW VERSION rather than a second case. That is what
 * makes "we can always append the use case" cheap: write the case where it is reviewed, run the loader, and the
 * board has it — with every past result still pointing at the version it was tested against.
 */
/**
 * ⭐ THE ONE IMPORTER. A second caller arrived the moment the app grew a button (POST /cases/seed), and Athi's
 * standing rule is to extract the helper THEN, not later. It matters more than tidiness here: a case loaded by
 * the button and a case loaded from a file must be the SAME row, or the board would hold two kinds of case that
 * only look alike.
 */
async function importCases(entity_id, who, rows) {
  {
    const out = { added: 0, updated: 0, unchanged: 0, cases: [] };
    await withEntity(entity_id, async (db) => {
      for (const c of rows) {
        const key = String(c.case_key || c.id || '').trim();
        if (!key) continue;
        const mod = String(c.module_key || key.split('-')[0] || '').trim() || null;
        /* everything that is not identity goes in rules — the version is what makes an edit safe */
        const rules = {
          title: c.title || '', priority: c.priority || 'Medium', pre: c.pre || '', data: c.data || '',
          steps: Array.isArray(c.steps) ? c.steps : [], note: c.note || '',
          layer: LAYERS.indexOf(c.layer) >= 0 ? c.layer : null,
          module_name: c.module_name || '', intro: c.intro || '',
        };

        const cur = await db.query(
          `SELECT d.definition_id, d.current_version, v.rules
             FROM definition d
             JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
            WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.name = $2`, [entity_id, key]);

        if (!cur.rows[0]) {
          const ins = await db.query(
            `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
             VALUES ($1,'testcase',$2,$3,$4,'live',1,$5) RETURNING definition_id`,
            [entity_id, mod, key, rules.title || null, who.id]);
          const id = ins.rows[0].definition_id;
          await db.query(
            `INSERT INTO definition_version (definition_id, version, rules, created_by)
             VALUES ($1,1,$2,$3)`, [id, JSON.stringify(rules), who.id]);
          out.added++; out.cases.push({ case_key: key, definition_id: id, version: 1 });
          continue;
        }

        /* ⚠️ NO VERSION FOR AN IDENTICAL RE-IMPORT. The loader is meant to be run often; a new version on every
           run would bury the edits that matter under a hundred that changed nothing, and would make "which
           version did this pass on?" a question with a useless answer. */
        const id = cur.rows[0].definition_id;
        if (JSON.stringify(cur.rows[0].rules || {}) === JSON.stringify(rules)) {
          out.unchanged++; out.cases.push({ case_key: key, definition_id: id, version: cur.rows[0].current_version });
          continue;
        }
        const next = Number(cur.rows[0].current_version) + 1;
        await db.query(
          `INSERT INTO definition_version (definition_id, version, rules, created_by) VALUES ($1,$2,$3,$4)`,
          [id, next, JSON.stringify(rules), who.id]);
        await db.query(
          `UPDATE definition SET current_version = $2, sub_kind = $3, note = $4 WHERE definition_id = $1`,
          [id, next, mod, rules.title || null]);
        out.updated++; out.cases.push({ case_key: key, definition_id: id, version: next });
      }
    });
    return out;
  }
}

router.post('/cases/import', auth, async (req, res) => {
  try {
    const rows = Array.isArray(req.body && req.body.cases) ? req.body.cases : [];
    if (!rows.length) return res.status(400).json({ error: 'Nothing to import', message: 'Send { cases: [...] }.' });
    res.json(await importCases(auth.entityOf(req), testerOf(req), rows));
  } catch (err) {
    res.status(500).json({ error: 'Import failed', message: String(err.message || err) });
  }
});

/**
 * ⭐⭐⭐ POST /api/testing/cases/seed — THE BUTTON. Load the documented cases onto THIS shop's board.
 *
 * Athi, 2026-09-11: *"where do I run the node? Which I am not aware how to run it… can we say load the test cases
 * in the icon, will it load?"*
 *
 * ⭐⭐ THE FIRST VERSION WAS WRONG AND THIS IS THE CORRECTION. Loading the cases needed a terminal, a copied token
 * and a command — three things that have nothing to do with testing a shop, asked of the person who most needs the
 * board to be effortless. The document now ships WITH the API as data/test-cases.json, so the app can offer a
 * button and mean it. Same importer, same rows, no terminal.
 *
 * ⚠ IT IS AN UPSERT, SO PRESSING IT TWICE IS SAFE. A second press re-reads the document: unchanged cases stay on
 * their version, edited ones gain a new one, and every result already recorded keeps pointing at the version it
 * was actually given. There is no "already loaded" state to get wrong.
 */
router.post('/cases/seed', auth, async (req, res) => {
  try {
    const file = require('path').join(__dirname, '..', 'data', 'test-cases.json');
    /* ⚠ A MISSING FILE MUST SAY SO PLAINLY. It means the API shipped without the document — a deploy problem, not
       something the person pressing the button can act on, and they must not be left staring at an empty board
       wondering whether they did it wrong. */
    if (!require('fs').existsSync(file)) {
      return res.status(500).json({ error: 'The documented cases are not on this server',
        message: 'This API was deployed without data/test-cases.json. Run build-test-cases.cjs and deploy again.' });
    }
    const doc = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    const out = await importCases(auth.entityOf(req), testerOf(req), doc.cases || []);
    res.json(Object.assign({ version: doc.version, date: doc.date }, out));
  } catch (err) {
    res.status(500).json({ error: 'Could not load the documented cases', message: String(err.message || err) });
  }
});

/* ── THE RESULTS ──────────────────────────────────────────────────────────────────────────────────────────── */

function badResult(r) {
  if (!r || !String(r.case_key || '').trim()) return 'a result must name the case it is about';
  if (STATUSES.indexOf(r.status) < 0) return `"${r.status}" is not a status — ${STATUSES.join(', ')}`;
  if (RUN_KINDS.indexOf(r.run_kind) < 0) return `"${r.run_kind}" is not a kind of run — ${RUN_KINDS.join(', ')}`;
  if (r.layer && LAYERS.indexOf(r.layer) < 0) return `"${r.layer}" is not a layer — ${LAYERS.join(', ')}`;
  return null;
}

/**
 * POST /api/testing/results — record one result, or a whole run of them.
 *
 * ⚠️ APPEND ONLY. There is no PUT and no DELETE here, and cb_app could not execute one if there were (b219
 * REVOKEs both). A correction is a new row, which is why "failed on Thursday, passed on Friday" survives — and
 * why a flaky case is visible as pass/fail/pass rather than collapsing into whatever was written last.
 */
/**
 * ⭐ THE ONE RECORDER. Two callers arrived at once — a person tapping pass/fail, and a JUnit report from the
 * automated suite — and Athi's standing rule is that a second call site means extracting the helper NOW. It also
 * settles something more important than tidiness: an automated result and a manual one are written by the SAME
 * code, so they cannot drift into being two different kinds of record on one board.
 */
async function recordResults(entity_id, who, b) {
  const list = Array.isArray(b.results) ? b.results : [b];
  for (const r of list) { const bad = badResult(r); if (bad) return { status: 422, body: { error: 'Not recorded', message: bad } }; }
  {
    /* ⭐ ONE run id for the whole post unless the caller supplies one — a sitting is a sitting. */
    const run_id = b.run_id || require('crypto').randomUUID();
    const run_label = b.run_label || null;
    const build = b.build || null;

    const saved = await withEntity(entity_id, async (db) => {
      /* the case's identity and CURRENT VERSION, read once for the whole batch — see the round-trip note above */
      const keys = list.map((r) => String(r.case_key).trim());
      const known = await db.query(
        `SELECT definition_id, name, sub_kind, current_version FROM definition
          WHERE entity_id = $1 AND kind = 'testcase' AND name = ANY($2::text[])`, [entity_id, keys]);
      const by = {}; known.rows.forEach((x) => { by[x.name] = x; });

      const rows = [];
      for (const r of list) {
        const key = String(r.case_key).trim();
        const d = by[key] || null;
        const ins = await db.query(
          `INSERT INTO test_result
             (entity_id, definition_id, case_version, case_key, module_key, status, run_kind, layer,
              tested_by, tester_name, run_id, run_label, note, evidence, build)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT DO NOTHING
           RETURNING result_id, case_key, status, at`,
          [entity_id, d ? d.definition_id : null, d ? d.current_version : null, key,
           r.module_key || (d && d.sub_kind) || key.split('-')[0] || null,
           r.status, r.run_kind, r.layer || null,
           who.id, r.tester_name || who.name, run_id, run_label,
           r.note || null, r.evidence || null, build]);
        if (ins.rows[0]) rows.push(ins.rows[0]);
      }
      return rows;
    });

    return { status: 200, body: { run_id, run_label, recorded: saved.length,
      skipped: list.length - saved.length, results: saved } };
  }
}

router.post('/results', auth, async (req, res) => {
  try {
    const out = await recordResults(auth.entityOf(req), testerOf(req), req.body || {});
    res.status(out.status).json(out.body);
  } catch (err) {
    res.status(500).json({ error: 'Could not record the result', message: String(err.message || err) });
  }
});

/**
 * GET /api/testing/results — the board.
 *
 * ⭐ THE DEFAULT IS THE LATEST WORD ON EVERY CASE, because that is the question a person actually has: "where are
 * we?" The history is there on request (?case_key= or ?run_id=), and a case's history is the interesting half
 * when something is flaky.
 */
router.get('/results', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const q = req.query || {};

    if (q.case_key || q.run_id) {
      const where = q.case_key ? 'AND case_key = $2' : 'AND run_id = $2::uuid';
      const r = await withEntity(entity_id, (db) => db.query(
        `SELECT * FROM test_result WHERE entity_id = $1 ${where} ORDER BY at DESC LIMIT 500`,
        [entity_id, q.case_key || q.run_id]));
      return res.json({ results: r.rows, count: r.rows.length, history: true });
    }

    /**
     * ⚠️ LATEST PER (case, layer), not per case. One case is often proved at two levels — the offer engine's
     * arithmetic by a unit test AND by a person at the counter — and collapsing those would let a green unit test
     * hide a red counter, which is precisely the pair of facts worth keeping apart.
     */
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT DISTINCT ON (case_key, COALESCE(layer,'')) *
         FROM test_result WHERE entity_id = $1
        ORDER BY case_key, COALESCE(layer,''), at DESC`, [entity_id]));
    res.json({ results: r.rows, count: r.rows.length, history: false });
  } catch (err) {
    res.status(500).json({ error: 'Could not read the results', message: String(err.message || err) });
  }
});

/** GET /api/testing/runs — the sittings, newest first, each with its totals. */
router.get('/runs', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT run_id, max(run_label) AS run_label, max(build) AS build,
              min(at) AS started, max(at) AS finished,
              string_agg(DISTINCT run_kind, ', ') AS kinds,
              string_agg(DISTINCT tester_name, ', ') AS testers,
              count(*) AS total,
              count(*) FILTER (WHERE status = 'pass')    AS passed,
              count(*) FILTER (WHERE status = 'fail')    AS failed,
              count(*) FILTER (WHERE status = 'blocked') AS blocked,
              count(*) FILTER (WHERE status = 'skipped') AS skipped
         FROM test_result WHERE entity_id = $1
        GROUP BY run_id ORDER BY max(at) DESC LIMIT 50`, [entity_id]));
    res.json({ runs: r.rows, count: r.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not read the runs', message: String(err.message || err) });
  }
});

/**
 * POST /api/testing/results/junit — ⭐ THE ADOPTED STANDARD.
 *
 * Send a JUnit XML report as `{ xml: "<testsuites>…" }`. Playwright writes one with `['junit', {outputFile}]`,
 * and so does virtually everything else. This is the whole integration: an automated suite's results land on the
 * same board as a person's, with no bespoke format on either side.
 *
 * ⚠️ THE CASE KEY IS TAKEN FROM THE TEST NAME, in brackets — `[CTR-05] a single click chooses`. That convention
 * already exists in our specs, which is why it was chosen rather than invented. A test whose name carries no key
 * is REPORTED BACK as unmatched rather than dropped: silently ignoring half a report is how a board comes to
 * claim coverage it does not have.
 */
router.post('/results/junit', auth, async (req, res) => {
  try {
    const xml = String((req.body && req.body.xml) || '');
    if (!xml.trim()) return res.status(400).json({ error: 'No report', message: 'Send { xml: "<testsuites>…" }.' });

    const run_kind = RUN_KINDS.indexOf(req.body.run_kind) >= 0 ? req.body.run_kind : 't1';
    const layer = LAYERS.indexOf(req.body.layer) >= 0 ? req.body.layer : 'web';

    /* ⚠️ A REGEX, NOT AN XML PARSER, AND THAT IS A DELIBERATE LIMIT. JUnit XML is flat — testcase elements with a
       name, and a child element when something went wrong. Pulling in a parser to read four attributes would add
       a dependency to a route that has none. If a report ever needs real nesting this becomes wrong, and the
       unmatched list below is what will say so. */
    const cases = [...xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)];
    const attr = (s, k) => { const m = String(s || '').match(new RegExp(k + '="([^"]*)"')); return m ? m[1] : ''; };

    const results = [], unmatched = [];
    for (const c of cases) {
      const head = c[1] || c[3] || '', body = c[2] || '';
      const name = attr(head, 'name');
      const key = (name.match(/\[([A-Z]{2,6}-\d{1,3})\]/) || [])[1];
      const failed = /<failure|<error/.test(body);
      const skipped = /<skipped/.test(body);
      if (!key) { unmatched.push(name); continue; }
      const why = (body.match(/message="([^"]*)"/) || [])[1] || '';
      results.push({ case_key: key, run_kind, layer,
        status: failed ? 'fail' : (skipped ? 'skipped' : 'pass'),
        note: failed ? why.slice(0, 500) : null, evidence: name.slice(0, 200) });
    }
    if (!results.length) {
      return res.status(422).json({ error: 'Nothing recognisable', unmatched,
        message: 'No test in that report carries a case key in brackets, e.g. "[CTR-05] a single click chooses".' });
    }

    /* ⭐ the SAME recorder a person's tap goes through — one write path, one shape of row */
    const out = await recordResults(auth.entityOf(req), testerOf(req), {
      results, run_id: req.body.run_id, run_label: req.body.run_label || 'automated', build: req.body.build });
    return res.status(out.status).json(Object.assign({ unmatched }, out.body));
  } catch (err) {
    res.status(500).json({ error: 'Could not read that report', message: String(err.message || err) });
  }
});

module.exports = router;
