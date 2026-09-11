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
 * ⭐⭐ THE ONE IMPORTER — and it does the whole document in FIVE round trips, not three hundred.
 *
 * Athi, 2026-09-11: *"can you compress and load, it takes time?"*
 *
 * ⚠⚠ THE FIRST VERSION LOOPED, and the loop was the cost. 110 cases × (one SELECT, one INSERT, one INSERT)
 * is over three hundred sequential round trips, and this API sits in San Francisco while the database sits in
 * Mumbai — so each one pays a Pacific crossing. The arithmetic was always right and the wait was a minute and a
 * half. [[project-roundtrip-cost]] is the standing measurement; this is the same fault it describes.
 *
 * ⭐ SET-BASED INSTEAD: read every existing case in ONE query, decide in memory, then write the new ones, the
 * new versions and the pointer updates as one statement each via unnest(). The decision logic is unchanged —
 * only the number of times we ask.
 *
 * ⭐ A second caller arrived the moment the app grew a button (POST /cases/seed), which is why this is a helper
 * at all: a case loaded by the button and a case loaded from a file must be the SAME row, or the board holds two
 * kinds of case that only look alike.
 */
async function importCases(entity_id, who, rows) {
  const out = { added: 0, updated: 0, unchanged: 0, cases: [] };

  /* ── 1 · normalise, and drop anything with no key. One pass, no database. ── */
  const want = [];
  const seen = {};
  for (const c of rows || []) {
    const key = String(c.case_key || c.id || '').trim();
    if (!key || seen[key]) continue;      /* ⚠ a repeated key in one payload would write itself twice */
    seen[key] = 1;
    want.push({
      key: key,
      mod: String(c.module_key || key.split('-')[0] || '').trim() || null,
      /* everything that is not identity goes in rules — the version is what makes an edit safe */
      rules: {
        title: c.title || '', priority: c.priority || 'Medium', pre: c.pre || '', data: c.data || '',
        steps: Array.isArray(c.steps) ? c.steps : [], note: c.note || '',
        layer: LAYERS.indexOf(c.layer) >= 0 ? c.layer : null,
        module_name: c.module_name || '', intro: c.intro || '',
        /**
         * ⭐⭐⭐ THE CITATION — which clause of which spec this case proves.
         *
         * Athi: *"so the spec and the test cases can match… if it is not the intended behaviour, then capture,
         * update the spec and build and test again."*
         *
         * ⭐ THE VERSION IS THE WHOLE MECHANISM. A case cites a clause AT A VERSION, so editing the clause makes
         * every case still citing the old one exactly the set that has to be looked at again — no hashing, no
         * sweep, no flag anybody has to remember to set. Same reason a result carries the case version, one
         * level up.
         */
        cites: c.cites || null,
      },
    });
  }
  if (!want.length) return out;

  await withEntity(entity_id, async (db) => {
    /* ── 2 · ONE read for the lot. `= ANY($2)` rather than 110 lookups. ── */
    const have = await db.query(
      `SELECT d.definition_id, d.name, d.current_version, v.rules
         FROM definition d
         JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.name = ANY($2::text[])`,
      [entity_id, want.map((w) => w.key)]);
    const by = {};
    have.rows.forEach((r) => { by[r.name] = r; });

    /* ── 3 · decide, in memory ── */
    const toCreate = [], toVersion = [];
    want.forEach((w) => {
      const cur = by[w.key];
      const json = JSON.stringify(w.rules);
      if (!cur) { toCreate.push(Object.assign({ json: json }, w)); return; }
      /* ⚠️ NO VERSION FOR AN IDENTICAL RE-IMPORT. The button is meant to be pressed often; a version per press
         would bury the edits that matter under a hundred that changed nothing, and would make "which version did
         this pass on?" a question with a useless answer. */
      if (JSON.stringify(cur.rules || {}) === json) {
        out.unchanged++;
        out.cases.push({ case_key: w.key, definition_id: cur.definition_id, version: cur.current_version });
        return;
      }
      toVersion.push(Object.assign({ json: json, id: cur.definition_id, next: Number(cur.current_version) + 1 }, w));
    });

    /* ── 4 · the new cases: one INSERT, then one INSERT for their version 1 ── */
    if (toCreate.length) {
      const ins = await db.query(
        `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
         SELECT $1, 'testcase', t.mod, t.name, t.note, 'live', 1, $5
           FROM unnest($2::text[], $3::text[], $4::text[]) AS t(mod, name, note)
         ON CONFLICT DO NOTHING
         RETURNING definition_id, name`,
        [entity_id, toCreate.map((t) => t.mod), toCreate.map((t) => t.key),
         toCreate.map((t) => t.rules.title || null), who.id]);

      /* ⚠ ON CONFLICT DO NOTHING means a row somebody else created in the meantime is simply not returned. It is
         not an error and must not be counted as added — the next press will see it as unchanged. */
      const madeBy = {};
      ins.rows.forEach((r) => { madeBy[r.name] = r.definition_id; });
      const made = toCreate.filter((t) => madeBy[t.key]);

      if (made.length) {
        await db.query(
          /* ⚠ entity_id IS NOT OPTIONAL HERE — definition_version carries its own and RLS checks it. Leaving it
             out is what produced "row level security violates" on the very first load. */
          `INSERT INTO definition_version (definition_id, version, entity_id, rules, created_by)
           SELECT t.id::uuid, 1, $1, t.rules::jsonb, $4
             FROM unnest($2::text[], $3::text[]) AS t(id, rules)`,
          [entity_id, made.map((t) => madeBy[t.key]), made.map((t) => t.json), who.id]);
        made.forEach((t) => {
          out.added++;
          out.cases.push({ case_key: t.key, definition_id: madeBy[t.key], version: 1 });
        });
      }
    }

    /* ── 5 · the edited ones: one INSERT for the new versions, one UPDATE to move the pointers ── */
    if (toVersion.length) {
      await db.query(
        `INSERT INTO definition_version (definition_id, version, entity_id, rules, created_by)
         SELECT t.id::uuid, t.v::int, $1, t.rules::jsonb, $5
           FROM unnest($2::text[], $3::int[], $4::text[]) AS t(id, v, rules)`,
        [entity_id, toVersion.map((t) => t.id), toVersion.map((t) => t.next),
         toVersion.map((t) => t.json), who.id]);
      await db.query(
        `UPDATE definition d
            SET current_version = t.v::int, sub_kind = t.mod, note = t.note
           FROM unnest($1::text[], $2::int[], $3::text[], $4::text[]) AS t(id, v, mod, note)
          WHERE d.definition_id = t.id::uuid AND d.entity_id = $5`,
        [toVersion.map((t) => t.id), toVersion.map((t) => t.next), toVersion.map((t) => t.mod),
         toVersion.map((t) => t.rules.title || null), entity_id]);
      toVersion.forEach((t) => {
        out.updated++;
        out.cases.push({ case_key: t.key, definition_id: t.id, version: t.next });
      });
    }
  });

  return out;
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

/**
 * ⭐⭐ A SPEC CLAUSE IS A DEFINITION, kind 'spec' — the same argument the test case itself won.
 *
 * It is a rule somebody declared, it gets edited, and a test written against it has to be able to say WHICH
 * wording it was written against. Every one of those is what definition_version already does. A separate table
 * would have meant re-implementing versioning beside code that already has it.
 *
 *   kind      'spec'
 *   sub_kind  the document        'TILL-SPEC-2026-09-07'
 *   name      the clause id       'CTR'  (a feature's key — the clause the module is written against)
 *   rules     { text }            the clause itself
 *
 * Returns { definition_id, version } — what a case cites.
 */
async function upsertClause(db, entity_id, who, spec, clause, text) {
  const name = String(clause || '').trim();
  if (!name) return null;
  const doc = String(spec || '').trim() || null;
  const rules = { text: String(text || '').trim(), spec: doc };

  const cur = await db.query(
    `SELECT d.definition_id, d.current_version, v.rules
       FROM definition d
       JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
      WHERE d.entity_id = $1 AND d.kind = 'spec' AND d.name = $2`, [entity_id, name]);

  if (!cur.rows[0]) {
    const ins = await db.query(
      `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
       VALUES ($1,'spec',$2,$3,$4,'live',1,$5) RETURNING definition_id`,
      [entity_id, doc, name, rules.text.slice(0, 200) || null, who.id]);
    const id = ins.rows[0].definition_id;
    await db.query(`INSERT INTO definition_version (definition_id, version, entity_id, rules, created_by)
                    VALUES ($1,1,$2,$3,$4)`,
      [id, entity_id, JSON.stringify(rules), who.id]);
    return { definition_id: id, version: 1, changed: true };
  }

  const id = cur.rows[0].definition_id;
  /* ⚠️ NO NEW VERSION FOR AN IDENTICAL RE-IMPORT. A version per import would mark every case stale on every
     load, which trains a person to ignore the word "stale" — and then it means nothing when it is true. */
  if (JSON.stringify(cur.rows[0].rules || {}) === JSON.stringify(rules)) {
    return { definition_id: id, version: cur.rows[0].current_version, changed: false };
  }
  const next = Number(cur.rows[0].current_version) + 1;
  await db.query(`INSERT INTO definition_version (definition_id, version, entity_id, rules, created_by)
                  VALUES ($1,$2,$3,$4,$5)`,
    [id, next, entity_id, JSON.stringify(rules), who.id]);
  await db.query(`UPDATE definition SET current_version = $2, sub_kind = $3, note = $4 WHERE definition_id = $1`,
    [id, next, doc, rules.text.slice(0, 200) || null]);
  return { definition_id: id, version: next, changed: true };
}

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

      /**
       * ⚠⚠ ONE INSERT FOR THE WHOLE RUN, not one per result.
       *
       * A person taps one case at a time and would never notice. A JUnit report does not: the suite posts every
       * test at once, and a loop here is one Pacific crossing per test — the same fault that made loading the
       * cases take a minute and a half. [[project-roundtrip-cost]]
       *
       * ⚠ ON CONFLICT DO NOTHING still applies per row, so a replayed suite is still a quiet no-op, and the
       * rows that were skipped are simply not returned — which is what `skipped` counts.
       */
      const norm = list.map((r) => {
        const key = String(r.case_key).trim();
        const d = by[key] || null;
        return {
          key: key,
          definition_id: d ? d.definition_id : null,
          case_version: d ? d.current_version : null,
          module_key: r.module_key || (d && d.sub_kind) || key.split('-')[0] || null,
          status: r.status, run_kind: r.run_kind, layer: r.layer || null,
          tester_name: r.tester_name || who.name,
          note: r.note || null, evidence: r.evidence || null,
        };
      });

      const ins = await db.query(
        `INSERT INTO test_result
           (entity_id, definition_id, case_version, case_key, module_key, status, run_kind, layer,
            tested_by, tester_name, run_id, run_label, note, evidence, build)
         SELECT $1, t.did::uuid, t.cver::int, t.key, t.mod, t.status, t.kind, t.layer,
                $12, t.tester, $13::uuid, $14, t.note, t.evidence, $15
           FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
                       $9::text[], $10::text[], $11::text[])
             AS t(did, cver, key, mod, status, kind, layer, tester, note, evidence)
         ON CONFLICT DO NOTHING
         RETURNING result_id, case_key, status, at`,
        [entity_id,
         norm.map((r) => r.definition_id), norm.map((r) => r.case_version), norm.map((r) => r.key),
         norm.map((r) => r.module_key), norm.map((r) => r.status), norm.map((r) => r.run_kind),
         norm.map((r) => r.layer), norm.map((r) => r.tester_name), norm.map((r) => r.note),
         norm.map((r) => r.evidence),
         who.id, run_id, run_label, build]);
      return ins.rows;
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

/* ── ⭐⭐⭐ GHERKIN · the spec and the test as one text ─────────────────────────────────────────────────────
 *
 * Athi, 2026-09-11: *"then possibly both can work together? Spec vs test, in the V model? Or maybe Gherkin /
 * Cucumber kind of?"*
 *
 * A `.feature` file carries BOTH halves: the Feature description is the spec clause, the Scenarios are the cases
 * written against it. So one file is the left arm and the right arm of the V, and neither can be edited without
 * the other being in front of you.
 *
 * ⭐ Gherkin the FORMAT is adopted; Cucumber the RUNNER is not — see the header of lib/gherkin.js for why.
 */

/** GET /api/testing/cases/gherkin[?module=CTR] — download the board as .feature text. */
router.get('/cases/gherkin', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const gherkin = require('../lib/gherkin');
    const only = req.query && req.query.module ? String(req.query.module).trim() : null;

    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT d.name, d.sub_kind, d.current_version, v.rules
         FROM definition d
         JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
        WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.status <> 'retired'
          AND ($2::text IS NULL OR d.sub_kind = $2)
        ORDER BY d.sub_kind, d.name`, [entity_id, only]));

    const groups = [], seen = {};
    r.rows.forEach((x) => {
      const ru = x.rules || {}, key = x.sub_kind || '-';
      if (!seen[key]) {
        seen[key] = { module: { key: key, name: ru.module_name || '', intro: ru.intro || '',
                                spec: (ru.cites && ru.cites.spec) || '',
                                clause: (ru.cites && ru.cites.clause) || key },
                      cases: [] };
        groups.push(seen[key]);
      }
      seen[key].cases.push(Object.assign({ case_key: x.name }, ru));
    });

    /* ⚠️ text/plain and a filename, because this is a FILE — it goes into the repository beside the code it
       describes, is reviewed in a diff, and is edited by hand. Returning it as JSON would make the one thing
       Gherkin is actually for — being readable and editable by a person — into the caller's problem. */
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (only || 'chitbridge') + '.feature"');
    res.send(gherkin.toFeatures(groups));
  } catch (err) {
    res.status(500).json({ error: 'Could not export', message: String(err.message || err) });
  }
});

/**
 * POST /api/testing/cases/gherkin — import .feature text as { text: "Feature: …" }.
 *
 * ⭐⭐ THIS IS THE LOOP HE DESCRIBED. Edit the Feature description (the spec clause), send the file, and the
 * clause gains a version — which marks every case citing the old one as needing another look. Edit a Scenario
 * and the case gains a version. Nothing has to be remembered, because the versions do the remembering.
 */
router.post('/cases/gherkin', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const who = testerOf(req);
    const gherkin = require('../lib/gherkin');
    const text = String((req.body && req.body.text) || '');
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to import',
      message: 'Send { text: "Feature: …" }.' });

    const parts = gherkin.splitFeatures(text);
    if (!parts.length) {
      return res.status(422).json({ error: 'Not a feature file',
        message: 'No "Feature:" line was found. A .feature file starts with one.' });
    }

    const out = { added: 0, updated: 0, unchanged: 0, clauses: [], problems: [], cases: [] };
    for (const part of parts) {
      const f = gherkin.parseFeature(part);
      /* ⚠️ EVERY PROBLEM IS RETURNED, never swallowed. A scenario that was skipped is a test that silently does
         not exist, and the board would be showing coverage it does not have. */
      (f.problems || []).forEach((x) => out.problems.push((f.key || f.name || '?') + ': ' + x));

      /* the clause FIRST, so the cases can cite the version it ends up at */
      let cite = null;
      await withEntity(entity_id, async (db) => {
        const cl = await upsertClause(db, entity_id, who, f.spec, f.clause || f.key, f.intro);
        if (cl) {
          cite = { definition_id: cl.definition_id, version: cl.version,
                   spec: f.spec || null, clause: f.clause || f.key };
          out.clauses.push({ clause: f.clause || f.key, spec: f.spec || null,
                             version: cl.version, changed: cl.changed });
        }
      });

      const rows = (f.cases || []).filter((c) => c.case_key).map((c) => Object.assign({}, c, {
        module_key: f.key || (c.case_key || '').split('-')[0],
        module_name: f.name || '', intro: f.intro || '', cites: cite,
      }));
      if (!rows.length) continue;
      const r = await importCases(entity_id, who, rows);
      out.added += r.added; out.updated += r.updated; out.unchanged += r.unchanged;
      out.cases = out.cases.concat(r.cases);
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: 'Could not import', message: String(err.message || err) });
  }
});

/**
 * ⭐⭐⭐ GET /api/testing/stale — the cases whose spec has moved since they were written.
 *
 * Athi: *"if it is not the intended behaviour, then capture, update the spec and build and test again."* This is
 * the "and test again" made visible. A case citing clause v2 when the clause is now at v3 was written against
 * wording that no longer stands — and a PASS recorded against it proves nothing about what the spec says today.
 *
 * ⚠️ IT REPORTS, IT DOES NOT ACT. Nothing is retired, no result is deleted, no case is rewritten. A person reads
 * the clause, decides whether the case still holds, and either edits it or tests it again. Invalidating results
 * automatically would destroy evidence on the strength of a version number.
 */
router.get('/stale', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT d.name AS case_key, d.sub_kind AS module_key, v.rules,
              s.name AS clause, s.sub_kind AS spec, s.current_version AS clause_now
         FROM definition d
         JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
         JOIN definition s ON s.definition_id = (v.rules->'cites'->>'definition_id')::uuid
        WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.status <> 'retired'
          AND v.rules->'cites'->>'definition_id' IS NOT NULL
          AND (v.rules->'cites'->>'version')::int < s.current_version
        ORDER BY s.name, d.name`, [entity_id]));

    res.json({
      stale: r.rows.map((x) => ({
        case_key: x.case_key, module_key: x.module_key, title: (x.rules || {}).title || '',
        spec: x.spec, clause: x.clause,
        cited_version: Number(((x.rules || {}).cites || {}).version), clause_now: Number(x.clause_now),
      })),
      count: r.rowCount,
      says: r.rowCount
        ? 'These cases were written against an earlier wording of their clause. Read the clause, then either '
          + 'edit the case or test it again.'
        : 'Every case cites the current wording of its clause.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not read that', message: String(err.message || err) });
  }
});

module.exports = router;
