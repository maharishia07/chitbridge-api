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
/**
 * ⭐⭐ THE TEST LEVELS — how much of the product one test puts under test.
 *
 * The first four are the standard ones (ISTQB's levels, ISO/IEC/IEEE 29119's test types), so a reader can look
 * ours up in theirs. ⚠️ `static` is ours and is the honest name for a large part of what this platform has: a
 * check that reads SOURCE and asserts a rule about it without executing anything. Calling those unit tests
 * would overstate the evidence — and 83 of 464 files are exactly that.
 * `support` is not a test at all: fixtures and harnesses other tests stand on, listed so they stop being
 * counted as coverage by anyone skim-reading a file count.
 */
const TEST_TYPES = ['unit', 'integration', 'system', 'acceptance', 'performance', 'security', 'penetration',
  'static', 'support'];

router.get('/vocabulary', (req, res) => {
  res.json({
    run_kinds: RUN_KINDS, layers: LAYERS, statuses: STATUSES, test_types: TEST_TYPES,
    /* ⚠️ said plainly, because "unit vs integration" is argued about endlessly and the argument is avoidable
       if the board states which meaning it uses */
    levels: {
      unit: 'One module, on its own. A green run proves that function, and nothing about the product.',
      integration: 'Several of our pieces wired together — a route over a stubbed database, an engine over a store.',
      system: 'The whole product: a real browser, or a live API, or a real database.',
      acceptance: 'A person deciding whether it does the job. The only kind that can find "correct but useless".',
      static: 'Reads the source and judges the TEXT — nothing is executed. Real evidence, but of a different thing.',
      support: 'Not a test. A fixture or harness other tests stand on, listed so it is never counted as coverage.',
      /**
       * ⭐ PURPOSE, WHERE A PERSON WOULD SAY PURPOSE. A load test is a system test and nobody filtering a board
       * looks for it there. ⚠️ Both lists are DECLARED by name in classify-tests.cjs — detecting them from the
       * source put money.test.js under performance and returned eighty-nine security files, because every proof
       * script signs in and therefore contains the words token and scope.
       */
      performance: 'Round trips, query shape, load and concurrency. What it costs, not whether it is right.',
      security: 'Forged tokens, algorithm pinning, key scopes, tenant isolation, routes left unguarded.',
      penetration: '⚠ There is none. Shown at zero so the absence cannot pass for "not applicable" — '
        + 'scripts/penetration.js is MARKET penetration and is not a security test.',
    },
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
         * ⭐⭐ WHAT KIND OF TEST THIS IS — Athi, 2026-09-11: *"say it is unit, integration and so on."*
         *
         * ⚠️ NOT THE SAME AXIS AS `run_kind` OR `layer`, and conflating them would lose all three. `run_kind`
         * is how a result was PRODUCED this time (a person tapping, a T2 sweep, a nightly suite); `layer` is
         * what the test exercises; `test_type` is how much of the product is under test at once, which is what
         * decides how much a green run is worth. A unit test and a system test both pass; they do not prove the
         * same amount, and a board that adds them together says something untrue.
         *
         * ⚠️ It rides in `rules` rather than a column on purpose: `rules` is jsonb and already versioned, so
         * this needed no migration and cannot drift from the case it describes.
         */
        test_type: TEST_TYPES.indexOf(c.test_type) >= 0 ? c.test_type : null,
        group: c.group || null,
        automated: !!c.automated,
        /**
         * ⭐⭐ THE THREE FACTS A PROJECT MANAGER ASKS FOR, Athi 2026-09-11: *"each level — how many test cases,
         * what are they, which function it belongs to, what it proves, who runs it."*
         *
         *   areas     which part of the system it reaches — api · middleware · engine · web · database · connector
         *   subjects  the module under test, by name, when the file names one
         *   claim     what it proves, IN THE FILE'S OWN WORDS — null when the file never said
         *   run_by    the suite unattended, or a person against a live environment
         *
         * ⚠️ `claim` is null for 244 of 464 automated tests and the board must SAY "not stated" rather than
         * fall back to the filename dressed as a sentence. A guess in a column headed "what it proves" is read
         * as evidence by exactly the person the column exists for.
         */
        areas: Array.isArray(c.areas) ? c.areas.slice(0, 8) : [],
        subjects: Array.isArray(c.subjects) ? c.subjects.slice(0, 8) : [],
        claim: c.claim || null,
        run_by: c.run_by || null,
        /**
         * ⚠️⚠️ THE JOURNEY POSITION, AND IT WAS BEING SILENTLY DROPPED. `importCases` copies a NAMED LIST of
         * fields into `rules`; anything not named is discarded without a word. So build-test-cases.cjs emitted
         * `seq` on all 616 cases, the file shipped with it, the button loaded it — and the board sorted
         * alphabetically, because the one field that decides the order never survived the door.
         *
         * ⭐ Caught by asking the loaded board what it actually held (`withSeq: 0`) rather than by trusting the
         * build output. A field that exists at both ends is not a field that arrived.
         */
        seq: (typeof c.seq === 'number' ? c.seq : 99),
        step: c.step || '',
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
/**
 * GET /api/testing/engine — the declared engine tiers, so a screen can show WHAT THE PURE RULES ARE.
 *
 * ⭐ It reads the same data/test-cases.json the seed button reads, which in turn reads
 * tests/engine-manifest.js at build time. One declaration, one build, no second list to go stale.
 * ⚠️ These are NOT cases and must never be loaded as definitions: they are what the tests are about, and
 * putting them in the case table would make them countable as coverage.
 */
router.get('/engine', auth, (req, res) => {
  try {
    const f = require('path').join(__dirname, '..', 'data', 'test-cases.json');
    if (!require('fs').existsSync(f)) return res.json({ engine: null });
    const doc = JSON.parse(require('fs').readFileSync(f, 'utf8'));
    res.json({ engine: doc.engine || null, contents: doc.contents || null });
  } catch (err) { res.status(500).json({ error: 'Could not read the engine manifest' }); }
});

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
/**
 * ⭐ The case's measured area, folded onto the six values the column permits.
 *
 * ⚠️ TWO VOCABULARIES THAT DO NOT LINE UP, AND SAYING SO IS THE HONEST PART. `areas` (api · middleware ·
 * engine · web · database · connector) was measured from source; `layer` (engine · transport · web ·
 * capability · db · connector) is older and is fixed by a CHECK constraint. api→transport and
 * middleware→capability are the closest honest pairings, not exact ones. The RIGHT fix is one vocabulary,
 * which is a migration and a decision; this stops the column being a constant in the meantime.
 */
const AREA_TO_LAYER = { api: 'transport', middleware: 'capability', engine: 'engine',
                        web: 'web', database: 'db', connector: 'connector' };
let _caseAreas = null;
function layerOfCase(key) {
  try {
    if (!_caseAreas) {
      const f = require('path').join(__dirname, '..', 'data', 'test-cases.json');
      _caseAreas = {};
      JSON.parse(require('fs').readFileSync(f, 'utf8')).cases.forEach((c) => {
        if ((c.areas || []).length) _caseAreas[c.case_key] = c.areas;
      });
    }
    const ar = _caseAreas[key];
    if (!ar || !ar.length) return null;
    /* ⚠️ one value per row, and it must be the WIDEST thing the test reaches — a file that drives a browser and
       also reads a lib is a web test; calling it an engine test would understate what its failure implicates. */
    /* ⚠️ THIS ONE IS NOT THE ARCHITECTURE ORDER AND MUST NOT BE CHANGED TO MATCH IT. It answers a different
       question — which is the WIDEST thing this test reaches — so it runs from the widest blast radius to
       the narrowest. A file driving a browser is a web test even though the engine is the more important
       layer, because that is what its failure implicates. */
    for (const a of ['web', 'connector', 'database', 'api', 'middleware', 'engine']) {
      if (ar.indexOf(a) >= 0) return AREA_TO_LAYER[a];
    }
    return null;
  } catch (_) { return null; }
}

router.post('/results/junit', auth, async (req, res) => {
  try {
    const xml = String((req.body && req.body.xml) || '');
    if (!xml.trim()) return res.status(400).json({ error: 'No report', message: 'Send { xml: "<testsuites>…" }.' });

    const run_kind = RUN_KINDS.indexOf(req.body.run_kind) >= 0 ? req.body.run_kind : 't1';
    const layer = LAYERS.indexOf(req.body.layer) >= 0 ? req.body.layer : 'web';
    /* ⚠ opt-in: see the note beside `key` below */
    const keyFromName = (req.body && req.body.key_from) === 'name';

    /* ⚠️ A REGEX, NOT AN XML PARSER, AND THAT IS A DELIBERATE LIMIT. JUnit XML is flat — testcase elements with a
       name, and a child element when something went wrong. Pulling in a parser to read four attributes would add
       a dependency to a route that has none. If a report ever needs real nesting this becomes wrong, and the
       unmatched list below is what will say so. */
    const cases = [...xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)];
    /**
     * ⚠️⚠️ THE BOUNDARY IS THE WHOLE FIX, AND WITHOUT IT THIS ROUTE QUIETLY DESTROYED EVERY GUARD RUN.
     *
     * JUnit writes `<testcase classname="test.guard" name="chitbridge-api/tests/handle.test.js">`. Asking for
     * `name="…"` without a boundary matches **classname** first, because it contains the word. So 185 results
     * all came back keyed `test.guard` / `test.unit` — three rows instead of a hundred and eighty-five, each one
     * overwriting the last, and the board would have shown a healthy history of a case that does not exist.
     *
     * ⭐ Found 2026-09-11 by a number that was obviously wrong: a report with 185 tests in it produced 2.
     * ⚠️ Nothing had ever been posted through this route, so no data was lost — but it would have been on the
     * first real run, and silently.
     */
    const attr = (s, k) => {
      const m = String(s || '').match(new RegExp('(?:^|\\s)' + k + '="([^"]*)"'));
      return m ? m[1] : '';
    };

    const results = [], unmatched = [];
    for (const c of cases) {
      const head = c[1] || c[3] || '', body = c[2] || '';
      const name = attr(head, 'name');
      /**
       * ⭐⭐ TWO WAYS TO NAME A CASE, AND BOTH ARE LEGITIMATE.
       *
       * A SPEC carries a key in brackets — `[CTR-05] a single click chooses` — because it is written against a
       * case somebody authored. A GUARD FILE has no such case and never will: `chitbridge-api/tests/handle.test.js`
       * is its own identity, and the file path is the only name that survives its assertions being rewritten.
       * A synthetic `GRD-001` would shift the moment a file was added beside it.
       *
       * ⚠ `key_from: 'name'` IS OPT-IN, deliberately. The default still REPORTS anything it cannot place rather
       * than inventing a key for it — a board that silently accepts every test title as a case would fill with
       * hundreds of one-off rows and the history would mean nothing.
       */
      const key = keyFromName
        ? name.trim().slice(0, 120)
        : (name.match(/\[([A-Z]{2,6}-\d{1,3})\]/) || [])[1];
      const failed = /<failure|<error/.test(body);
      const skipped = /<skipped/.test(body);
      if (!key) { unmatched.push(name); continue; }
      const why = (body.match(/message="([^"]*)"/) || [])[1] || '';
      /**
       * ── ⚠️⚠️ THE LAYER IS THE CASE'S, NOT THE POSTER'S GUESS ──────────────────────────────────────────────
       *
       * Athi, 2026-09-11, on the Reliability tab: *"everything shows as engine — what does this tab refer to?"*
       *
       * It did, because the caller sends ONE layer for a whole report and post-suite.cjs defaults it to
       * "engine" — written when the only thing posting was a suite of pure functions. 235 of the files in that
       * report drive a browser. ⭐ A column carrying one value on every row is worse than an empty one: it
       * still reads as information.
       *
       * ⚠️ The case already knows, by measurement rather than by assumption — classify-tests.cjs reads what each
       * file requires, opens and calls. So the posted layer is now the case's own area where we have it, and
       * the caller's value only where we do not.
       */
      results.push({ case_key: key, run_kind, layer: layerOfCase(key) || layer,
        /**
         * ⭐ A PATH-NAMED CASE GROUPS BY ITS DIRECTORY, WHICH IS THE CATEGORY THE PATH ALREADY CARRIES.
         *
         * Athi, 2026-09-11: *"through category we can filter or see as a summary?"* The repo alone gives two
         * buckets for 185 guards, which is not a filter — it is a label. Two segments give the groups people
         * actually mean: `chitbridge-api/tests` (the API's guards), `chitbridge-web/e2e` (the browser probes),
         * `chitbridge-api/scripts` (the one-off checks). ⚠️ The directory is not a taxonomy somebody designed;
         * it is where the files were already put, which is why it needs no maintenance to stay true.
         */
        module_key: keyFromName ? String(key).split('/').slice(0, 2).join('/').slice(0, 40) : undefined,
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

/**
 * ⭐⭐⭐ GET /api/testing/coverage — which AREAS are untested, worst first.
 *
 * Athi, 2026-09-11: *"can we force an area to test? For example, this area testing not done yet? So whoever
 * tests, can we force them to test an area? Kind of preference, focus and so on. Irrespective of the shop, that
 * functionality to be tested."*
 *
 * ⚠️⚠️ YOU CANNOT FORCE A PERSON TO TEST, AND TRYING IS WORSE THAN NOT. A panel that refuses to show anything
 * except one module is a panel somebody closes — and then nothing is tested at all, and you have lost the only
 * thing you actually had, which was their willingness. What you CAN do is make the gap impossible to miss and
 * make the untested area the path of least resistance.
 *
 * ⭐ SO THIS IS THE HONEST HALF OF "FORCE": it answers what has NOT been covered, ranked, so the panel can open
 * on it, name it, and count down. The pressure is that the number is visible and goes to zero — which is the
 * only kind of pressure that works on somebody doing you a favour.
 *
 * ⭐⭐ AND "IRRESPECTIVE OF THE SHOP" IS THE KEY PHRASE. What must be tested is a property of the BUILD, not of
 * one shop's board — so weight is taken from the case's own PRIORITY, which is declared in the reviewed document
 * and travels to every entity that loads it. A High case nobody has run outranks ten Low ones, in every shop.
 *
 * ⚠️ ONE QUERY. A per-module loop here would be sixteen Pacific crossings to answer a question the panel asks on
 * every open. [[project-roundtrip-cost]]
 */
router.get('/coverage', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const run_id = req.query && req.query.run_id ? String(req.query.run_id) : null;

    const r = await withEntity(entity_id, (db) => db.query(
      `WITH cases AS (
         SELECT d.definition_id, d.name AS case_key, COALESCE(d.sub_kind, '-') AS module_key,
                COALESCE(v.rules->>'priority', 'Medium') AS priority,
                COALESCE(v.rules->>'module_name', '') AS module_name
           FROM definition d
           JOIN definition_version v
             ON v.definition_id = d.definition_id AND v.version = d.current_version
          WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.status <> 'retired'
       ),
       /* ⚠️ THE LATEST WORD PER CASE, not every row — the ledger is append-only, so a case tested five times
          would otherwise count five times and a module could report more coverage than it has cases. */
       latest AS (
         SELECT DISTINCT ON (case_key) case_key, status, at
           FROM test_result WHERE entity_id = $1
          ORDER BY case_key, at DESC
       ),
       inrun AS (
         SELECT DISTINCT case_key FROM test_result
          WHERE entity_id = $1 AND $2::uuid IS NOT NULL AND run_id = $2::uuid
       )
       SELECT c.module_key, max(c.module_name) AS module_name,
              count(*) AS total,
              count(l.case_key) AS tested,
              count(*) FILTER (WHERE l.status = 'pass')    AS passed,
              count(*) FILTER (WHERE l.status = 'fail')    AS failed,
              count(*) FILTER (WHERE l.status = 'blocked') AS blocked,
              count(*) FILTER (WHERE l.case_key IS NULL)   AS untested,
              /* ⭐ the weight: a High case nobody has run is what should pull a tester in */
              count(*) FILTER (WHERE l.case_key IS NULL AND c.priority = 'High') AS high_untested,
              count(i.case_key) AS tested_in_run
         FROM cases c
         LEFT JOIN latest l ON l.case_key = c.case_key
         LEFT JOIN inrun  i ON i.case_key = c.case_key
        GROUP BY c.module_key
        ORDER BY count(*) FILTER (WHERE l.case_key IS NULL AND c.priority = 'High') DESC,
                 count(*) FILTER (WHERE l.case_key IS NULL) DESC,
                 c.module_key`, [entity_id, run_id]));

    /**
     * ⭐⭐ THE SAME QUESTION, ASKED FOUR WAYS. Athi, 2026-09-11: *"any graph / chart according to group?"*
     *
     * ⚠ THEY ARE NOT THE SAME CHART WITH A DIFFERENT LABEL, and that is why all four are worth the round trips:
     *   by AREA      which part of the product is untested        — decides what to test next
     *   by LEVEL     whether anything below the screen is proved  — decides whether the testing is shallow
     *   by PRIORITY  whether the important cases are the done ones — a high pass rate on Low cases is not coverage
     *   by SITTING   whether it is getting better or worse        — the only one that is a trend
     *
     * ⚠ One transaction, four aggregates. Not one query per group in a loop.
     */
    const groups = await withEntity(entity_id, async (db) => {
      const latest = `WITH cases AS (
           SELECT d.name AS case_key, COALESCE(d.sub_kind,'-') AS module_key,
                  COALESCE(v.rules->>'priority','Medium') AS priority,
                  COALESCE(v.rules->>'layer','(not set)') AS layer
             FROM definition d
             JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
            WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.status <> 'retired'
         ), latest AS (
           SELECT DISTINCT ON (case_key) case_key, status FROM test_result
            WHERE entity_id = $1 ORDER BY case_key, at DESC
         )`;
      const tally = (col) => `${latest}
         SELECT c.${col} AS key, count(*) AS total,
                count(*) FILTER (WHERE l.status='pass')    AS passed,
                count(*) FILTER (WHERE l.status='fail')    AS failed,
                count(*) FILTER (WHERE l.status='blocked') AS blocked,
                count(*) FILTER (WHERE l.case_key IS NULL) AS untested
           FROM cases c LEFT JOIN latest l ON l.case_key = c.case_key
          GROUP BY c.${col} ORDER BY c.${col}`;

      const byLayer = await db.query(tally('layer'), [entity_id]);
      const byPriority = await db.query(tally('priority'), [entity_id]);

      /* ⚠ THE TREND IS A DIFFERENT SHAPE, and must be: it counts RESULTS in a sitting, not the latest word per
         case. "What happened on Tuesday" and "where do we stand" are different questions and a chart that
         answered one with the other would be quietly wrong. */
      const trend = await db.query(
        `SELECT run_id, max(run_label) AS run_label, max(at) AS at,
                count(*) FILTER (WHERE status='pass')    AS passed,
                count(*) FILTER (WHERE status='fail')    AS failed,
                count(*) FILTER (WHERE status='blocked') AS blocked,
                count(*) AS total
           FROM test_result WHERE entity_id = $1
          GROUP BY run_id ORDER BY max(at) DESC LIMIT 12`, [entity_id]);

      const num = (rows) => rows.map((x) => ({ key: x.key, total: Number(x.total), passed: Number(x.passed),
        failed: Number(x.failed), blocked: Number(x.blocked), untested: Number(x.untested) }));
      return {
        by_layer: num(byLayer.rows),
        by_priority: num(byPriority.rows),
        /* oldest first, because a trend is read left to right */
        trend: trend.rows.slice().reverse().map((x) => ({ run_id: x.run_id, run_label: x.run_label, at: x.at,
          passed: Number(x.passed), failed: Number(x.failed), blocked: Number(x.blocked), total: Number(x.total) })),
      };
    });

    const areas = r.rows.map((x) => ({
      module_key: x.module_key, module_name: x.module_name,
      total: Number(x.total), tested: Number(x.tested), untested: Number(x.untested),
      passed: Number(x.passed), failed: Number(x.failed), blocked: Number(x.blocked),
      high_untested: Number(x.high_untested), tested_in_run: Number(x.tested_in_run),
    }));
    const worst = areas.filter((a) => a.untested > 0)[0] || null;

    res.json({
      areas: areas,
      groups: groups,
      /* ⭐ the panel opens on this when no focus has been chosen — the gap, named, rather than a dropdown */
      suggest: worst ? worst.module_key : null,
      says: worst
        ? worst.module_key + ' has ' + worst.untested + ' case(s) nobody has run'
          + (worst.high_untested ? ', ' + worst.high_untested + ' of them High' : '') + '.'
        : 'Every case has been run at least once.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not read the coverage', message: String(err.message || err) });
  }
});

/**
 * ⭐⭐⭐ GET /api/testing/report[?run_id=] — a TEST COMPLETION REPORT, on the standard's own template.
 *
 * Athi, 2026-09-11: *"is there any report available… standard report template?"*
 *
 * ⭐ ADOPTED: the **Test Completion Report** of **ISO/IEC/IEEE 29119-3**. It is the current standard and it
 * ⚠️ NO CLAUSE NUMBER IS CITED HERE, and an earlier version of this comment cited one. Naming the DOCUMENT TYPE
 * is something I can stand behind; a clause number is a detail that would be quoted onward by somebody who
 * trusted it, and a wrong one is worse than none.
 * SUPERSEDED IEEE 829, which is the one most people still name and which was withdrawn in 2013. Using the
 * withdrawn one would have looked more familiar to more readers and been wrong.
 *
 * ⚠️⚠️ AND HERE IS THE PART THAT MATTERS MORE THAN THE TEMPLATE. Half of a completion report is JUDGEMENT —
 * whether the exit criteria were met, what risk is left, what should change next time. No database holds any of
 * that. A generator that emits those headings with something plausible under them produces a document that
 * LOOKS signed off and is not, which is worse than having no report: a report is read by people who were not in
 * the room, and they cannot tell invented prose from evidence.
 *
 * ⭐ So every section is marked `source: 'measured'` or `source: 'needs a person'`, and the ones that need a
 * person carry the QUESTION rather than an answer. The screen renders that difference plainly.
 */
router.get('/report', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const run_id = req.query && req.query.run_id ? String(req.query.run_id) : null;

    const data = await withEntity(entity_id, async (db) => {
      /* ⚠️ THE LATEST WORD PER CASE for the board-wide picture; the RUN's own rows when one is named. Mixing
         them would be the classic report fault: totals that answer a different question from the detail. */
      const cover = await db.query(
        `WITH cases AS (
           SELECT d.name AS case_key, COALESCE(d.sub_kind,'-') AS module_key,
                  COALESCE(v.rules->>'priority','Medium') AS priority,
                  COALESCE(v.rules->>'module_name','') AS module_name, d.current_version
             FROM definition d
             JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
            WHERE d.entity_id = $1 AND d.kind = 'testcase' AND d.status <> 'retired'
         ), latest AS (
           SELECT DISTINCT ON (case_key) case_key, status FROM test_result
            WHERE entity_id = $1 ORDER BY case_key, at DESC
         )
         SELECT c.module_key, max(c.module_name) AS module_name, count(*) AS total,
                count(*) FILTER (WHERE l.status='pass')    AS passed,
                count(*) FILTER (WHERE l.status='fail')    AS failed,
                count(*) FILTER (WHERE l.status='blocked') AS blocked,
                count(*) FILTER (WHERE l.status='skipped') AS skipped,
                count(*) FILTER (WHERE l.case_key IS NULL) AS untested,
                count(*) FILTER (WHERE l.case_key IS NULL AND c.priority='High') AS high_untested
           FROM cases c LEFT JOIN latest l ON l.case_key = c.case_key
          GROUP BY c.module_key ORDER BY c.module_key`, [entity_id]);

      /* the incidents: what actually went wrong, latest word only, worst first */
      const bad = await db.query(
        `SELECT DISTINCT ON (case_key) case_key, module_key, status, note, evidence,
                tester_name, run_kind, layer, at, case_version
           FROM test_result
          WHERE entity_id = $1 AND ($2::uuid IS NULL OR run_id = $2::uuid)
          ORDER BY case_key, at DESC`, [entity_id, run_id]);

      const runs = await db.query(
        `SELECT run_id, max(run_label) AS run_label, max(build) AS build,
                min(at) AS started, max(at) AS finished,
                string_agg(DISTINCT run_kind, ', ') AS kinds,
                string_agg(DISTINCT tester_name, ', ') AS testers,
                string_agg(DISTINCT layer, ', ') AS layers, count(*) AS total
           FROM test_result
          WHERE entity_id = $1 AND ($2::uuid IS NULL OR run_id = $2::uuid)
          GROUP BY run_id ORDER BY max(at) DESC LIMIT $3`, [entity_id, run_id, run_id ? 1 : 12]);

      /* ⚠️ cases written against wording that has since changed — a PASS on one of these is not evidence about
         what the spec says today, and a completion report that stays silent about it overstates its own case */
      const stale = await db.query(
        `SELECT count(*)::int AS n FROM definition d
           JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
           JOIN definition sp ON sp.definition_id = (v.rules->'cites'->>'definition_id')::uuid
          WHERE d.entity_id = $1 AND d.kind='testcase' AND d.status <> 'retired'
            AND (v.rules->'cites'->>'version')::int < sp.current_version`, [entity_id]);

      return { cover: cover.rows, bad: bad.rows, runs: runs.rows, stale: stale.rows[0] ? stale.rows[0].n : 0 };
    });

    const n = { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, untested: 0, high_untested: 0 };
    data.cover.forEach((c) => Object.keys(n).forEach((k) => { n[k] += Number(c[k] || 0); }));
    const incidents = data.bad.filter((r) => r.status === 'fail' || r.status === 'blocked');
    const tested = n.total - n.untested;

    res.json({
      standard: 'ISO/IEC/IEEE 29119-3 · Test Completion Report',
      /**
       * ⭐⭐ Athi, 2026-09-11: *"we name it as per standard, reference the standard where possible?"*
       *
       * So every view says which of the standard's DOCUMENT TYPES it corresponds to. That is what makes the
       * thing auditable by somebody who has never seen our screens: they do not have to learn our words, they
       * look ours up in theirs.
       * ⚠️ Only where it genuinely corresponds. The Summary is OURS — 29119-3 has a Test Status Report, which
       * is written DURING execution against a plan, and we have no plan; claiming the name would be a claim
       * about a document we do not produce.
       */
      names: {
        case: 'Test Case Specification (ISO/IEC/IEEE 29119-3)',
        run: 'Test Execution Log (ISO/IEC/IEEE 29119-3)',
        incident: 'Incident Report (ISO/IEC/IEEE 29119-3)',
        report: 'Test Completion Report (ISO/IEC/IEEE 29119-3)',
        results: 'JUnit XML — the de-facto interchange every CI writes',
        feature: 'Gherkin .feature — the clause and its scenarios in one text',
      },
      /* ⚠️ named so a reader can check it, and because IEEE 829 is the one most people expect */
      supersedes: 'IEEE 829 (withdrawn 2013)',
      generated_at: new Date().toISOString(),
      scope: run_id ? 'one run' : 'the whole board',

      sections: [
        { id: '1', title: 'Overview', source: 'measured',
          body: {
            tested_by: [...new Set(data.runs.map((r) => r.testers).filter(Boolean))].join(', ') || '—',
            period: data.runs.length
              ? { from: data.runs[data.runs.length - 1].started, to: data.runs[0].finished } : null,
            runs: data.runs.length,
            kinds: [...new Set(data.runs.flatMap((r) => String(r.kinds || '').split(', ')))].filter(Boolean),
            layers: [...new Set(data.runs.flatMap((r) => String(r.layers || '').split(', ')))].filter(Boolean),
            builds: [...new Set(data.runs.map((r) => r.build).filter(Boolean))],
          } },

        { id: '2', title: 'Test results', source: 'measured',
          body: { totals: n, tested: tested,
            coverage_pct: n.total ? Math.round((tested / n.total) * 100) : 0,
            pass_pct: tested ? Math.round((n.passed / tested) * 100) : 0,
            by_feature: data.cover } },

        { id: '3', title: 'Incidents', source: 'measured',
          body: { count: incidents.length, items: incidents } },

        { id: '4', title: 'Factors blocking progress', source: 'measured',
          /* ⭐ 29119-3 asks for this by name, and we HAVE it: a blocked case is a case somebody could not reach. */
          body: { blocked: data.bad.filter((r) => r.status === 'blocked').length,
            items: data.bad.filter((r) => r.status === 'blocked') } },

        { id: '5', title: 'Deviations from the test plan', source: 'needs a person',
          asks: 'What was planned that did not happen, and why? No plan is declared anywhere in this system, so '
              + 'nothing can be compared against one.' },

        { id: '6', title: 'Test completion evaluation', source: 'needs a person',
          asks: 'Were the exit criteria met? No exit criteria are declared, so this cannot be measured — the '
              + 'numbers in section 2 are evidence FOR the judgement, not the judgement.',
          /* ⚠️ THE TWO FACTS THAT MOST OFTEN MAKE A GREEN REPORT WRONG, stated where the evaluation is made */
          caveats: [
            n.untested ? n.untested + ' case(s) have never been run'
              + (n.high_untested ? ', ' + n.high_untested + ' of them High priority' : '') : null,
            data.stale ? data.stale + ' case(s) cite an older version of their spec clause, so a pass on them is '
              + 'not evidence about what the spec says today' : null,
          ].filter(Boolean) },

        { id: '7', title: 'Residual risks', source: 'needs a person',
          asks: 'What is still not known, and what would it cost if it is wrong? A count of passes is not a risk '
              + 'assessment.' },

        { id: '8', title: 'Reusable test assets', source: 'measured',
          body: { cases: n.total, features: data.cover.length,
            note: 'Every case is a versioned definition and can be exported as Gherkin (.feature).' } },

        { id: '9', title: 'Lessons learned and recommendations', source: 'needs a person',
          asks: 'What should be done differently next time?' },

        { id: '10', title: 'Approval', source: 'needs a person',
          asks: 'Who accepts this report, and on what date? ⚠️ Nothing here signs anything — a generated document '
              + 'must not carry an approval nobody gave.' },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not build the report', message: String(err.message || err) });
  }
});

/**
 * ⭐⭐⭐ GET /api/testing/reliability — HOW OFTEN DID THIS RUN, AND HOW OFTEN DID IT FAIL.
 *
 * Athi, 2026-09-11: *"can we make the log so we know, out of these many sequence, this particular test is
 * drifting due to whatever reason — which means it is still not matured… the total number of times it ran and
 * how many times it failed."*
 *
 * ⭐⭐ THE LEDGER ALREADY HELD THIS AND NOTHING ASKED IT. Every result has been an appended row since b219, so
 * the sequence was there from the first run — what was missing was the question. A summary line says "172 green,
 * 17 red" and cannot distinguish a check that has NEVER worked from one that fails one time in six, and those
 * need opposite responses: one is a bug, the other is a test nobody can trust.
 *
 * ⭐⭐⭐ FLIPS ARE THE MEASURE, NOT THE FAILURE COUNT. A case that went pass·pass·fail·fail·fail broke once and
 * stayed broken — that is a defect, and the failure count describes it fairly. A case that went
 * pass·fail·pass·fail·pass failed the same number of times and is a different animal entirely: nothing about the
 * product changed between those runs, so the TEST is the thing that is not mature. Counting how many times the
 * answer CHANGED separates them, and no other number does.
 *
 * ⚠ It reads RESULTS, not cases — so a guard file that has never been written up as a case still gets its
 * history. The board answers "what should be tested"; this answers "what can be believed".
 */
router.get('/reliability', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const q = req.query || {};
    const kind = q.run_kind ? String(q.run_kind) : null;

    const r = await withEntity(entity_id, (db) => db.query(
      `WITH ordered AS (
         SELECT case_key, module_key, status, at, run_kind, layer,
                lag(status) OVER (PARTITION BY case_key ORDER BY at) AS prev
           FROM test_result
          WHERE entity_id = $1 AND ($2::text IS NULL OR run_kind = $2)
       ), agg AS (
         SELECT case_key,
                max(module_key) AS module_key,
                count(*)                                    AS runs,
                count(*) FILTER (WHERE status = 'pass')      AS passed,
                count(*) FILTER (WHERE status = 'fail')      AS failed,
                count(*) FILTER (WHERE status = 'blocked')   AS blocked,
                count(*) FILTER (WHERE status = 'skipped')   AS skipped,
                /* ⭐ the drift signal: how many times consecutive runs disagreed */
                count(*) FILTER (WHERE prev IS NOT NULL AND prev <> status) AS flips,
                min(at) AS first_seen, max(at) AS last_seen,
                string_agg(DISTINCT run_kind, ', ') AS kinds,
                string_agg(DISTINCT layer, ', ')    AS layers
           FROM ordered GROUP BY case_key
       ), latest AS (
         SELECT DISTINCT ON (case_key) case_key, status AS last_status, tester_name, run_kind AS last_kind
           FROM test_result
          WHERE entity_id = $1 AND ($2::text IS NULL OR run_kind = $2)
          ORDER BY case_key, at DESC
       )
       SELECT a.*, l.last_status, l.tester_name, l.last_kind
         FROM agg a JOIN latest l ON l.case_key = a.case_key
        ORDER BY a.flips DESC, a.failed DESC, a.case_key`, [entity_id, kind]));

    const rows = r.rows.map((x) => {
      const runs = Number(x.runs), failed = Number(x.failed), flips = Number(x.flips);
      return {
        case_key: x.case_key, module_key: x.module_key,
        runs, passed: Number(x.passed), failed, blocked: Number(x.blocked), skipped: Number(x.skipped),
        flips,
        pass_rate: runs ? Math.round((Number(x.passed) / runs) * 100) : 0,
        first_seen: x.first_seen, last_seen: x.last_seen,
        kinds: x.kinds, layers: x.layers,
        last_status: x.last_status, tester_name: x.tester_name, last_kind: x.last_kind,
        /**
         * ⭐ THE VERDICT, IN WORDS, BECAUSE A NUMBER IS NOT A DECISION.
         * ⚠ 'once' is not a judgement at all and says so — a single green run is the commonest way a suite
         * claims maturity it has not earned, and calling it 'settled' would be this metric telling the lie it
         * exists to catch.
         */
        verdict: runs < 2 ? 'run once — nothing to judge yet'
          : flips === 0 && failed === 0 ? 'settled'
          /**
           * ⚠️⚠️ THIS USED TO SAY "the product, not the test", AND IT WAS WRONG ABOUT HALF OF THEM.
           *
           * A triage of the 27 reds on 2026-09-11 found 9 genuine product faults, 13 STALE TESTS and 4 that
           * should never have run unattended. `products-bulk.test.cjs` tests a file deliberately deleted in
           * September; `arrow-probe.cjs` wants an env var that is not here. Both fail every single time with
           * zero flips — indistinguishable, from this data, from a real defect.
           *
           * ⭐ Flips can tell you a test is NOT mature. Nothing here can tell you that a consistent failure is
           * the product's fault, and saying so sent somebody to read nine files that were fine.
           */
          : flips === 0 ? 'red every time — a defect, or a test that has gone stale; this cannot tell which'
          : flips === 1 ? 'changed once — a fix or a regression, not drift'
          : 'DRIFTING — ' + flips + ' changes of answer across ' + runs + ' runs; this test is not mature',
      };
    });

    /* ⭐ a SITTING is one posted run, however many results it carried */
    const sittings = await withEntity(entity_id, (db) => db.query(
      'SELECT COUNT(DISTINCT run_id)::int AS n FROM test_result WHERE entity_id = $1', [entity_id]))
      .then((r) => (r.rows[0] || {}).n || 0);

    const drifting = rows.filter((x) => x.flips >= 2);
    const settled = rows.filter((x) => x.runs >= 2 && x.flips === 0 && x.failed === 0);
    res.json({
      cases: rows,
      totals: {
        tracked: rows.length,
        /**
         * ⚠️⚠️ THIS SAID "runs recorded" AND COUNTED RESULT ROWS. Two sittings of 186 tests reported "368
         * runs recorded", which reads as 368 sittings — off by a factor of 184 on the one number that tells
         * a reader how much history there is to trust. Both figures are worth having; they are not the same
         * figure and must not share a label.
         */
        results: rows.reduce((a, x) => a + x.runs, 0),
        runs: sittings,
        failures: rows.reduce((a, x) => a + x.failed, 0),
        drifting: drifting.length,
        settled: settled.length,
        once: rows.filter((x) => x.runs < 2).length,
      },
      says: rows.length
        ? (drifting.length
            ? drifting.length + ' test(s) have changed their answer more than once. Those are the ones to read '
              + 'first \u2014 a test nobody can believe costs more than a missing one.'
            : 'Nothing is drifting. Every test that has run twice has given the same answer both times.')
        : 'Nothing has been recorded yet.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not read the history', message: String(err.message || err) });
  }
});

module.exports = router;
