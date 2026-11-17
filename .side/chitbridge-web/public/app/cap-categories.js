/**
 * app/cap-categories.js — CATEGORIES, the shelf you shape (lazy; ensureCap('categories')).
 *
 * Athi, 2026-08-16: *"bring the category as a panel next to catalogue. keep creation and updation in that panel
 * like normal two sided panel."*
 *
 * ── WHY IT IS ITS OWN SCREEN AND NOT A SECTION OF DEFINITIONS ────────────────────────────────────────────────
 * A category is authored like a definition (it IS one — `kind:'category'`) but it is USED like a part of the
 * catalogue: you reach for it while looking at products, not while reading the governance model. Definitions
 * still lists categories, and now POINTS HERE rather than offering a second Create button — one home for
 * authoring, referred to from elsewhere. That is Model A applied to a screen instead of a value.
 *
 * ── WHAT A CATEGORY IS, IN ONE LINE ───────────────────────────────────────────────────────────────────────────
 * A live `definition` row of kind `category`. Products cite it by `definition_id` and carry a copy of its NAME
 * for counterparties who cannot resolve that id. Rename here → every product of yours follows, because none of
 * them stored the word. See catgIdsOf/catgSetOn in core.js.
 *
 * ⚠️ RETIRE, NEVER DELETE. The API has no delete for a definition and should not: a chit that cited a category
 * stays explainable. Retiring takes it off the shelf; products that cite it keep the citation and say so.
 * OWNS the Categories panel (the tree list, create/edit sheet, sort, retire) and the two start-from-a-standard-set popups (pick a trade, untick and add your own)
 * CALLED BY public/app.html, public/app/cap-catalogue.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * FLOW ensureCap('categories') -> cbcatLoad reads the definitions of kind category (all=1) -> CBList paints the tree -> a sheet writes through CBAction; the seed popups read CB_STARTER_CATEGORIES and create the ticked nodes
 * CARD 06-catalogue-pim/categories-and-fields
 */
var CBCAT_UI = { list: null, sel: null, busy: false, err: '', q: '', mode: 'view', form: null, counts: null };

/* ── data ────────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⚠️ `all=1`, NOT the live-only read. This screen is where you MANAGE the shelf, so it must show retired ones —
 * a shelf that silently omits what you retired is how you re-create something you already withdrew. The pickers
 * elsewhere ask for live only; that difference is the point of having a screen.
 */
async function cbcatLoad(force) {
  if (CBCAT_UI.busy) return;
  if (CBCAT_UI.list && !force) return;
  CBCAT_UI.busy = true;
  CBCAT_UI.err = '';
  cbcatPaint();
  try {
    var reply = await api('defList', { query: { kind: 'category', all: 1 } });
    CBCAT_UI.list = ((reply && reply.definitions) || []).map(function (item) {
      /* ⭐ `parent` RIDES IN `rules` — free-form jsonb, so a tree costs NO MIGRATION (backlog 22, step 1).
         Same trick that let multi-category ship against live data this morning. */
      return {
        id: item.definition_id,
        name: item.name,
        note: item.note || '',
        status: item.status || 'draft',
        parent: (item.rules && item.rules.parent) || null,
        /* ⭐ The middle rung of the tax inheritance, riding in `rules` beside `parent` for the same
                  reason: free-form jsonb, so a second attribute on a category costs no migration. */
        default_slab: (item.rules && item.rules.default_slab) || null,
        version: item.current_version || 1,
        created_at: item.created_at
      };
    });
    cbcatOrder();
    await cbcatCounts();
  } catch (e) {
    CBCAT_UI.err = (e && e.message) || 'Could not read your categories.';
  }
  CBCAT_UI.busy = false;
  if (!CBCAT_UI.sel && (CBCAT_UI.list || []).length && UI.vp !== 'mob') CBCAT_UI.sel = CBCAT_UI.list[0].id;
  cbcatPaint();
}
/**
 * How many products sit in each category — the number that makes this screen worth opening.
 * ⚠️ Counted through `catgIdsOf`, so a product in three categories is counted in three, and the legacy
 * single-`category` shape is understood without this file knowing about it.
 */
/**
 * ── ⚠️⚠️ THIS SCREEN WAS COUNTING A PAGE AND CALLING IT A CATALOGUE ─────────────────────────────────────────
 *
 * `api('prodList')` with no limit returns ONE PAGE. Counting that gave tallytest — 10,441 products — a
 * Categories screen reading "Biscuits 19" where the shop holds 400, and "Beverages 0" where it holds 363. The
 * numbers were not approximate; they answered a different question: how many of the first page happen to be
 * filed here. Found 2026-09-16, the morning Athi asked why his categories looked empty.
 *
 * ⭐ THE SERVER COUNTS NOW, because only the server can see every row. `category_counts` is a GROUP BY that
 * rides in the SAME batched round trip as the list and the status tally, so an accurate count for a shop of any
 * size costs no extra journey. `limit:1` because we want the tally, not the products.
 *
 * ⚠️ THE OLD LOCAL COUNT SURVIVES AS A FALLBACK, and only as one: the web deploys separately from the API, so
 * for one deploy this may meet a server that does not send the tally. It is marked `partial` when that happens —
 * a wrong number that says it is wrong is recoverable; a wrong number that looks right is not.
 */
async function cbcatCounts() {
  try {
    var reply = await api('prodList', { query: { limit: 1 } });
    if (reply && reply.category_counts) {
      CBCAT_UI.counts = { by: reply.category_counts, none: Number(reply.uncategorised) || 0, total: Number(reply.total) || 0, partial: false };
      return;
    }
    /* ⚠️ an older server: count what we can reach and SAY that it is a page, not the shop */
    if (!UI.prods || !UI.prods.length) {
      var l = await api('prodList');
      UI.prods = l || UI.prods || [];
    }
    var n = {},
      none = 0;
    (UI.prods || []).forEach(function (item) {
      var ids = catgIdsOf((item && (item.item_data || item)) || {});
      if (!ids.length) {
        none++;
        return;
      }
      ids.forEach(function (id) {
        n[id] = (n[id] || 0) + 1;
      });
    });
    CBCAT_UI.counts = { by: n, none: none, total: (UI.prods || []).length, partial: true };
  } catch (e) {
    CBCAT_UI.counts = null;
  }
}

/**
 * ⭐⭐ THE TREE — depth-first order plus a `depth` on each row (backlog 22, step 2).
 *
 * Every standard classification is hierarchical: GS1 GPC is 4 fixed levels (Segment › Family › Class › Brick),
 * Google's taxonomy runs to 7. A flat list held `Grains` and `Flour`; it will not hold
 * `Food, Beverages & Tobacco › Food Items › Grains, Rice & Cereal › Rice`, which is both what a real catalogue
 * looks like and what a counterparty's system will send us.
 *
 * ⚠️ SORTING IS DONE ONCE, HERE, and the list stays flat with a `depth` — not nested arrays. Every consumer
 * (rows, the detail pane, the parent picker) then reads one shape, and indenting is a CSS concern rather than a
 * recursive renderer each caller has to get right.
 *
 * ⚠️ AN ORPHAN IS SHOWN AT THE ROOT, NEVER DROPPED. A category whose parent was retired or deleted still exists
 * and still classifies products; hiding it would make a shelf's contents unreachable from the screen that manages
 * shelves. ⚠️ AND A CYCLE CANNOT HANG THIS: `seen` guarantees every node is emitted exactly once, so a → b → a
 * renders as two roots rather than looping forever. Cycles should be impossible (see cbcatWouldCycle) — this is
 * the belt to that braces, because a UI that freezes teaches nothing about the data that froze it.
 */
/**
 * ── ⭐⭐ SORTING A TREE MEANS SORTING SIBLINGS, NEVER THE LIST ───────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"we need to have a sort mechanism based on field like we have it in the task."*
 *
 * ⚠️⚠️ AND ON THIS SCREEN THE OBVIOUS IMPLEMENTATION IS A BUG. `CBCAT_UI.list` is FLAT with a `depth` for
 * indenting, so `list.sort(byName)` compiles, runs, and silently detaches every child from its parent —
 * "Spices" indented under whatever happened to land above it. The order is a rendering of the hierarchy, not
 * an arrangement of rows.
 *
 * ⭐ So a sort changes the comparator the WALK uses on each set of siblings, and the walk still emits parent
 * before child. Every option below therefore keeps the tree; what changes is the order within one shelf.
 *
 * ⚠️ RETIRED IS ALWAYS LAST, in every order. It is not a tie-break, it is a fact about the shelf: a retired
 * category still classifies products and must stay reachable, but it is never what somebody is looking for.
 */
var CBCAT_SORTS = {
  az: {
    label: 'Name A–Z',
    cmp: function (a, b) {
      return a.name.localeCompare(b.name);
    }
  },
  za: {
    label: 'Name Z–A',
    cmp: function (a, b) {
      return b.name.localeCompare(a.name);
    }
  },
  most: {
    label: 'Most products',
    cmp: function (a, b) {
      return cbcatCount(b.id) - cbcatCount(a.id);
    }
  }
};
function cbcatCount(id) {
  return (CBCAT_UI.counts && CBCAT_UI.counts.by[id]) || 0;
}
function cbcatSortKey() {
  return CBCAT_SORTS[CBCAT_UI.sort] ? CBCAT_UI.sort : 'az';
}
function cbcatCmp() {
  var inner = CBCAT_SORTS[cbcatSortKey()].cmp;
  return function (a, b) {
    if ((a.status === 'retired') !== (b.status === 'retired')) return a.status === 'retired' ? 1 : -1;
    return inner(a, b);
  };
}
function cbcatSortSelect() {
  return (
    '<select data-cbsid="CTG002-S01" class="inp" data-testid="catg-sort" aria-label="' + esc(tx('Sort order')) + '" title="' +
    esc(tx('Sort order — always within each parent, so the tree survives')) +
    '"' +
    ' style="width:auto;padding:3px 6px;font-size:var(--fs-1)" onchange="cbcatSetSort(this.value)">' +
    Object.keys(CBCAT_SORTS)
      .map(function (item) {
        return '<option value="' + item + '"' + (cbcatSortKey() === item ? ' selected' : '') + '>' + esc(tx(CBCAT_SORTS[item].label)) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
/* ⚠️ cbcatOrder REWRITES CBCAT_UI.list and every row's depth, so the reveal count must go back to the top —
   50 rows of a newly ordered tree are 50 different rows. */
function cbcatSetSort(v) {
  CBCAT_UI.sort = v;
  cbcatOrder();
  try {
    if (LAZY) delete LAZY.cbcat;
  } catch (_) {}
  cbcatPaintList();
}

function cbcatOrder() {
  var all = CBCAT_UI.list || [];
  var byParent = {},
    seen = {};
  all.forEach(function (item) {
    var k = item.parent || '_root';
    (byParent[k] = byParent[k] || []).push(item);
  });
  var ids = {};
  all.forEach(function (item) {
    ids[item.id] = 1;
  });
  /* A parent that no longer exists is a root, so its children stay reachable. */
  all.forEach(function (item) {
    if (item.parent && !ids[item.parent]) {
      (byParent._root = byParent._root || []).push(item);
    }
  });
  var cmp = cbcatCmp();
  var out = [];
  (function walk(key, depth) {
    (byParent[key] || []).sort(cmp).forEach(function (item) {
      if (seen[item.id]) return;
      seen[item.id] = 1;
      item.depth = depth;
      out.push(item);
      walk(item.id, depth + 1);
    });
  })('_root', 0);
  /* Anything still unseen was in a cycle — emit it flat rather than lose it. */
  all.forEach(function (item) {
    if (!seen[item.id]) {
      item.depth = 0;
      out.push(item);
    }
  });
  CBCAT_UI.list = out;
}
/** Would making `id` a child of `parentId` create a loop? Walk up from the proposed parent looking for `id`. */
function cbcatWouldCycle(id, parentId) {
  var by = {};
  (CBCAT_UI.list || []).forEach(function (item) {
    by[item.id] = item;
  });
  var hops = 0,
    p = parentId;
  while (p && hops++ < 64) {
    if (p === id) return true;
    p = by[p] ? by[p].parent : null;
  }
  return false;
}
/** Every category except the one being edited and its own descendants — the legal parents. */
function cbcatParentOptions(id) {
  return (CBCAT_UI.list || []).filter(function (item) {
    /* ⚠️ ONE direction only. A candidate parent must not be a DESCENDANT of this category (that would loop). The old
       second test also threw out every ANCESTOR — including the category's own current parent — so the dropdown
       could never show the right parent (Athi, 2026-09-05: "it is not showing the right parent"). */
    return item.status !== 'retired' && item.id !== id && !(id && cbcatWouldCycle(id, item.id));
  });
}

/* cbcatSlabPickHTML → app/tax-slab-ui.js (F5 W1a: the middle rung's picker, one copy beside the product's and the catalogue default's) */

/* ── write ───────────────────────────────────────────────────────────────────────────────────────────────────── */
async function cbcatSave() {
  var f = CBCAT_UI.form;
  if (!f) return;
  var name = (f.name || '').trim();
  var err = document.getElementById('cbcat_err');
  if (name.length < 2) {
    if (err) err.textContent = 'Give it a name of at least 2 characters.';
    return;
  }
  /**
   * ⚠️ A duplicate NAME is refused here rather than merged. Two shelves reading "Grains" is indistinguishable on
   * every screen that shows only the word, and the products under each would look like one set that lost half.
   *
   * ⚠️⚠️ THE CHECK IS GLOBAL PER ENTITY, NOT PER PARENT — AND THAT IS A REAL LIMIT ON THE TREE, not a UI choice.
   * `definition` carries `UNIQUE (entity_id, kind, name)` (b160), so the DATABASE forbids two categories of one
   * name however deep they sit. In a real taxonomy siblings-unique is the normal rule and repeated leaf names are
   * everywhere — Google's has "Accessories" under a dozen branches. So a full-scale seed WILL collide.
   * ⭐ Recorded in backlog 22: seeding beyond a small set needs that constraint relaxed to
   * `(entity_id, kind, parent, name)`, which is a MIGRATION. Keeping this check global means the client refuses
   * exactly what the server would refuse, instead of offering something that fails on save.
   */
  var clash = (CBCAT_UI.list || []).filter(function (item) {
    return item.id !== f.id && item.status !== 'retired' && item.name.toLowerCase() === name.toLowerCase();
  })[0];
  if (clash) {
    if (err) err.textContent = 'You already have a live category called “' + clash.name + '”.';
    return;
  }
  try {
    if (f.id) {
      /* ⚠️⚠️ EVERY RULE KEY IS RE-SENT, ALWAYS. PUT /definitions/:id replaces `rules` wholesale (it writes a new
         version row from exactly what it is given), so sending `{parent}` alone would silently DROP the default
         slab the moment anyone renamed a category — data loss with no error and nothing on screen to show it. */
      await api('defSave', { params: { id: f.id }, body: { name: name, note: f.note || '', rules: cbcatRules(f) } });
      toast('Renamed — every product that cites it follows.');
    } else {
      var reply = await api('defAdd', { body: { kind: 'category', sub_kind: null, name: name, note: f.note || '', rules: cbcatRules(f) } });
      var id = reply && (reply.definition_id || (reply.definition && reply.definition.definition_id));
      /* Live immediately: a draft category cannot be attached to anything, so it would be a shelf you cannot use. */
      if (id) await api('defSave', { params: { id: id }, body: { status: 'live' } });
      CBCAT_UI.sel = id || CBCAT_UI.sel;
      toast('“' + name + '” added ✓');
    }
    CBCAT_UI.mode = 'view';
    CBCAT_UI.form = null;
    if (typeof cbCatgLive === 'function') await cbCatgLive(true); // the shared shelf every picker reads
    await cbcatLoad(true);
  } catch (e) {
    if (err) err.textContent = (e && e.message) || 'Could not save that.';
  }
}
function cbcatRetire(id) {
  var c = (CBCAT_UI.list || []).filter(function (x) {
    return x.id === id;
  })[0];
  if (!c) return;
  var n = (CBCAT_UI.counts && CBCAT_UI.counts.by[id]) || 0;
  confirmAsk(
    'Retire “' + esc(c.name) + '”?',
    'It leaves the shelf and cannot be attached to anything new.' +
      (n
        ? '<div style="margin-top:7px"><b>' +
          n +
          ' product' +
          (n === 1 ? '' : 's') +
          '</b> currently cite it. ' +
          'They keep the citation and will say the category is no longer live — nothing is unlinked and nothing ' +
          'is deleted.</div>'
        : '<div style="margin-top:7px">Nothing else changes</div>'),
    'Retire',
    function () {
      _cbcatRetire(id);
    },
    true
  );
}
async function _cbcatRetire(id) {
  try {
    await api('defRetire', { params: { id: id } });
    toast('Retired.');
    if (typeof cbCatgLive === 'function') await cbCatgLive(true);
    await cbcatLoad(true);
  } catch (e) {
    toast((e && e.message) || 'Could not retire that.', true);
  }
}
async function cbcatRelive(id) {
  try {
    await api('defSave', { params: { id: id }, body: { status: 'live' } });
    toast('Back on the shelf.');
    if (typeof cbCatgLive === 'function') await cbCatgLive(true);
    await cbcatLoad(true);
  } catch (e) {
    toast((e && e.message) || 'Could not change that.', true);
  }
}

/**
 * ⭐⭐ SEED A SMALL STANDARD SET — real Google Product Taxonomy nodes, per trade (backlog 22 step 3).
 *
 * ⚠️ OPT-IN AND CONFIRMED, NEVER AUTOMATIC. A shelf that arrives pre-filled is worse than an empty one: you
 * cannot tell what you chose from what arrived, and the first thing anyone does is delete rows they did not ask
 * for. Akeneo ships its demo tree the same way, for the same reason.
 *
 * ⚠️ IT ADDS, IT NEVER REPLACES. Anything you already made stays. A name that already exists is SKIPPED rather
 * than duplicated or overwritten — `definition` carries UNIQUE (entity_id, kind, name), so a collision would
 * fail the whole run otherwise, and silently renaming someone's category to make room would be worse.
 *
 * ⚠️ PARENTS FIRST, THEN CHILDREN. A child's `parent` is a definition_id that does not exist until its parent is
 * created, so the run is ordered and maps taxonomy ids → our ids as it goes. Getting this backwards produces a
 * flat list of orphans that LOOKS like a successful seed.
 */
function cbcatSeedAsk() {
  if (typeof CB_STARTER_CATEGORIES === 'undefined') {
    toast('Starter sets are not loaded.', true);
    return;
  }
  var opts = Object.keys(CB_STARTER_CATEGORIES)
    .map(function (item) {
      var s = CB_STARTER_CATEGORIES[item];
      return (
        '<div class="bulkrow"><span class="bn">' +
        esc(s.title) +
        '</span>' +
        '<span class="bh">' +
        s.nodes.length +
        ' categories</span>' +
        /* ⭐ "See these" — Athi, 2026-09-02: *"there is no way of knowing what they are."* The button used to add
         all 26 sight unseen; it now opens the list, which is where the choosing happens. Same testid, because
         the specs address the SET, and which press it takes to finish is not what they are asserting. */
        '<button data-cbsid="CTG002-B01" type="button" class="badd" data-testid="catg-seed-' +
        esc(item) +
        '"' +
        ' onclick="cbcatSeedPick(\'' +
        esc(item) +
        '\')">' +
        tx('See these →') +
        '</button></div>'
      );
    })
    .join('');
  ui.dialog({
    mount: 'CTG002-U21',
    pop: 'POP027',
    subClass: 's', /* app.html styles .modal .mhd .s, not .sub */
    titleText: tx('Start from a standard set'),
    subText: 'real categories from the Google Product Taxonomy',
    body:
      '<div style="font-size:var(--fs-2);line-height:1.6;color:var(--ink);margin-bottom:10px">' +
      'Pick the trade you are in and its usual categories are added, nested as the standard nests them. ' +
      '<b>Existing ones unchanged</b> — same names skipped.' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">⚠️ These are a starting point, not a ' +
      'ceiling. Rename, retire or add your own afterwards — they are ordinary categories from the moment they ' +
      'land.</div></div>' +
      '<div class="bulklist">' +
      opts +
      '</div>',
    footerHtml: '<button data-cbsid="CTG002-B02" onclick="closeModal()">' + tx('Cancel') + '</button>'
  });
}
/**
 * ── ⭐⭐ SEE WHAT IS IN A SET, AND TAKE THE PART YOU WANT ──────────────────────────────────────────────────────
 *
 * Athi, 2026-09-02: *"we are providing option to opt from standard set, but there is no way of knowing what they
 * are… say out of 26 they may be interested in 20 plus few more of their own, so if we can provide facility to
 * add it, that would be good."*
 *
 * ⚠️ "26 categories · Add these" IS A BLIND ALL-OR-NOTHING BUTTON, and both halves of that are the problem. The
 * count is not a description — nobody can tell whether those 26 are the right 26 — and even a reader who knew
 * would have to accept every one and then delete six, which is exactly the "you cannot tell what you chose from
 * what arrived" failure the seed was designed to avoid in the first place. So the list opens, everything starts
 * ticked (the old behaviour is one press away, unchanged), and what is unticked is simply never created.
 *
 * ⭐ THE TREE HAS TO STAY A TREE, so the ticks cascade BOTH ways:
 *     untick a parent → its children go too   (a child whose parent was never created is an orphan)
 *     tick a child    → its parent comes back (the standard nests them; half a branch is not the standard)
 * Said once on screen rather than discovered by a reader wondering why a box moved on its own.
 *
 * ⚠️ THE SELECTION IS HELD IN `CBCAT_SEED`, NOT READ OFF THE DOM AT THE END. A checkbox list read at submit time
 * loses everything the moment anything repaints, and this modal repaints its own counter on every tick.
 */
var CBCAT_SEED = { v: null, sel: null };

/** Children of a node, and their children — used by both cascade directions. */
function cbcatSeedKids(nodes, gid) {
  var out = [],
    list = [gid];
  while (list.length) {
    var g = list.shift();
    nodes.forEach(function (item) {
      if (item.parent === g) {
        out.push(item.gid);
        list.push(item.gid);
      }
    });
  }
  return out;
}

function cbcatSeedPick(v) {
  var set = CB_STARTER_CATEGORIES[v];
  if (!set) return;
  CBCAT_SEED = { v: v, sel: {} };
  set.nodes.forEach(function (item) {
    CBCAT_SEED.sel[item.gid] = 1;
  }); // everything, as "Add these" always did

  var rows = set.nodes
    .map(function (item) {
      var kid = !!item.parent;
      return (
        '<label class="bulkrow" style="cursor:pointer' +
        (kid ? ';padding-inline-start:30px' : '') +
        '">' +
        '<input data-cbsid="CTG002-I01" type="checkbox" checked data-seedgid="' +
        esc(item.gid) +
        '"' +
        ' data-testid="catg-seed-node-' +
        esc(item.gid) +
        '"' +
        ' onchange="cbcatSeedTick(\'' +
        esc(item.gid) +
        '\', this.checked)">' +
        '<span class="bn" style="font-weight:' +
        (kid ? '400' : '700') +
        '">' +
        esc(item.name) +
        '</span>' +
        /**
         * ⚠️⚠️ THE TAXONOMY ID IS BEHIND 🧾 Spec — Athi, 2026-09-02: *"codes are there, what are those, are we
         * using it inside… if it is something not useful to the person choosing we may not be required to
         * showcase."*
         *
         * ⭐ MEASURED BEFORE ANSWERING: `gpc` appears in exactly ONE place in the whole codebase — the write, four
         * lines from here. Nothing reads it, in the web or the API. It is stored so a category can one day carry
         * its standard code to a feed or a counterparty's system (backlog 22 step 4), and it costs nothing to keep
         * writing — but today it does nothing, and a category the person adds themselves never gets one at all.
         *
         * So on the row it was a bare number, meaning nothing to the reader, on the one screen whose entire job is
         * choosing which NAMES to adopt. Kept for the reader who wants to verify the seed really is the published
         * taxonomy — the same reader, and the same decision, as the STD_SCHEMES file path earlier today.
         */
        (typeof specOn === 'function' && specOn()
          ? '<span class="bh" title="' +
            esc(tx('Google Product Taxonomy id — stored with the category, not yet read by anything')) +
            '">' +
            esc(item.gid) +
            '</span>'
          : '') +
        '</label>'
      );
    })
    .join('');

  ui.dialog({
    mount: 'CTG002-U22',
    pop: 'POP028',
    subClass: 's',
    titleText: set.title,
    subText: tx('real categories from the Google Product Taxonomy'),
    wide: true,
    body:
      '<div style="font-size:var(--fs-2);line-height:1.6;margin-bottom:8px">' +
      tx('Untick anything you do not want. A child needs its parent, so those two travel together.') +
      '</div>' +
      /* ⚠️ SMALL PILLS, NOT `.btn ghost` — which is a full-width primary inside a modal footer and rendered these
       two as the loudest things on a screen whose subject is the list below them. The same pill the set rows
       already use (`.bulkrow button`), so the modal has one button vocabulary rather than two. */
      '<div style="display:flex;gap:7px;align-items:center;margin-bottom:8px">' +
      '<button data-cbsid="CTG002-B03" type="button" data-testid="catg-seed-all" onclick="cbcatSeedAll(true)"' +
      ' style="border:1px solid var(--line);background:var(--card);color:var(--on-card);border-radius:20px;' +
      'padding:3px 12px;font-size:var(--fs-1);cursor:pointer">' +
      tx('All') +
      '</button>' +
      '<button data-cbsid="CTG002-B04" type="button" data-testid="catg-seed-none" onclick="cbcatSeedAll(false)"' +
      ' style="border:1px solid var(--line);background:var(--card);color:var(--on-card);border-radius:20px;' +
      'padding:3px 12px;font-size:var(--fs-1);cursor:pointer">' +
      tx('None') +
      '</button>' +
      '<span id="cbcat_seed_n" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey);' +
      'white-space:nowrap"></span>' +
      '</div>' +
      '<div class="bulklist">' +
      rows +
      '</div>' +
      /* ⭐ "plus few more of their own" — created alongside, as ordinary top-level categories. They are NOT part of
       the standard, so they carry no `gpc` id: claiming a taxonomy code for a name somebody typed would put a
       false citation on the record, and the whole point of the seed is that the codes are real. */
      '<div style="margin-top:11px">' +
      '<label class="fl">' +
      tx('Add your own as well') +
      '</label>' +
      '<input data-cbsid="CTG002-I02" class="inp" id="cbcat_seed_own" data-testid="catg-seed-own"' +
      ' placeholder="' +
      esc(tx('one per line, or separated by commas')) +
      '">' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
      tx('Yours are created at the top level, with no standard code — they are not part of this taxonomy.') +
      '</div></div>',
    footerHtml:
      '<button data-cbsid="CTG002-B05" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      '<button data-cbsid="CTG002-B06" class="pri" id="cbcat_seed_go" data-testid="catg-seed-go" onclick="cbcatSeedGo()"></button>'
  });
  cbcatSeedCount();
}

/** The counter and the primary's label — the only two things a tick changes. */
function cbcatSeedCount() {
  var set = CB_STARTER_CATEGORIES[CBCAT_SEED.v] || { nodes: [] };
  var n = Object.keys(CBCAT_SEED.sel || {}).length,
    tot = set.nodes.length;
  var el = document.getElementById('cbcat_seed_n');
  if (el) el.textContent = txf('{n} of {tot} selected', { n: n, tot: tot });
  var node = document.getElementById('cbcat_seed_go');
  if (node) {
    node.textContent = n ? txn('Add {count} category', 'Add {count} categories', n) : tx('Add your own only');
    node.disabled = false;
  }
}

/**
 * ⚠️ THE DOM IS UPDATED DIRECTLY, NOT BY REPAINTING THE LIST. Re-rendering would throw away whatever has been
 * typed into "add your own" and drop the reader back at the top of a 26-row list mid-decision.
 */
function cbcatSeedTick(gid, on) {
  var set = CB_STARTER_CATEGORIES[CBCAT_SEED.v];
  if (!set) return;
  var touch = [gid].concat(
    on
      ? cbcatSeedAncestors(set.nodes, gid) // a child needs its parent
      : cbcatSeedKids(set.nodes, gid)
  ); // a parent's children cannot outlive it
  touch.forEach(function (item) {
    if (on) CBCAT_SEED.sel[item] = 1;
    else delete CBCAT_SEED.sel[item];
    var box = document.querySelector('[data-seedgid="' + item + '"]');
    if (box) box.checked = !!on;
  });
  cbcatSeedCount();
}

function cbcatSeedAncestors(nodes, gid) {
  var out = [],
    by = {};
  nodes.forEach(function (item) {
    by[item.gid] = item;
  });
  var cur = by[gid];
  while (cur && cur.parent) {
    out.push(cur.parent);
    cur = by[cur.parent];
  }
  return out;
}

function cbcatSeedAll(on) {
  var set = CB_STARTER_CATEGORIES[CBCAT_SEED.v];
  if (!set) return;
  CBCAT_SEED.sel = {};
  set.nodes.forEach(function (item) {
    if (on) CBCAT_SEED.sel[item.gid] = 1;
  });
  document.querySelectorAll('[data-seedgid]').forEach(function (item) {
    item.checked = !!on;
  });
  cbcatSeedCount();
}

function cbcatSeedGo() {
  var el = document.getElementById('cbcat_seed_own');
  var own = (el ? el.value : '')
    .split(/[\n,]/)
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
  var sel = Object.assign({}, CBCAT_SEED.sel || {});
  if (!Object.keys(sel).length && !own.length) {
    toast(tx('Nothing selected.'), true);
    return;
  }
  cbcatSeedRun(CBCAT_SEED.v, sel, own);
}

/**
 * @param only  {gid:1} of the nodes to create. ABSENT means every node — the pre-picker behaviour, kept so any
 *              caller that has not learned about the picker still works exactly as it did.
 * @param own   names the reader typed, created at the top level with no standard code.
 */
async function cbcatSeedRun(vertical, only, own) {
  var set = CB_STARTER_CATEGORIES[vertical];
  if (!set) return;
  closeModal();
  /* ⚠️ Filtered BEFORE the count, or the progress line promises rows that were never going to be created. */
  var picked = only
    ? set.nodes.filter(function (item) {
        return !!only[item.gid];
      })
    : set.nodes.slice();
  var ownNames = (own || []).slice();
  showBusy(txn('Adding {count} category…', 'Adding {count} categories…', picked.length + ownNames.length));
  var made = {},
    added = 0,
    skipped = 0,
    failed = 0;
  try {
    var have = {};
    (CBCAT_UI.list || []).forEach(function (item) {
      have[item.name.toLowerCase()] = item.id;
    });
    /* Ordered so a parent always exists before its child asks for it. */
    var ordered = picked.slice().sort(function (first, second) {
      return (first.parent ? 1 : 0) - (second.parent ? 1 : 0);
    });
    for (var index = 0; index < ordered.length; index++) {
      var n = ordered[index];
      if (have[n.name.toLowerCase()]) {
        made[n.gid] = have[n.name.toLowerCase()];
        skipped++;
        continue;
      }
      var parentId = n.parent ? made[n.parent] || null : null;
      try {
        var reply = await api('defAdd', {
          body: {
            kind: 'category',
            sub_kind: null,
            name: n.name,
            note: '',
            /* ⚠️ `gpc` keeps the taxonomy id beside the parent, so a category can later carry its standard code
             instead of being re-matched by name. Costs nothing now and is the hook backlog 22 step 4 needs. */
            rules: { parent: parentId, gpc: n.gid }
          }
        });
        var id = reply && (reply.definition_id || (reply.definition && reply.definition.definition_id));
        if (!id) {
          failed++;
          continue;
        }
        await api('defSave', { params: { id: id }, body: { status: 'live' } });
        made[n.gid] = id;
        have[n.name.toLowerCase()] = id;
        added++;
      } catch (e) {
        failed++;
      }
    }
    /**
     * ⭐ "plus few more of their own" — created in the SAME run so one press does the whole job.
     *
     * ⚠️ NO `gpc`. These are names somebody typed; stamping a taxonomy code on one would put a false citation on
     * the record, and the codes being real is the entire reason the standard set is worth offering.
     * ⚠️ Skipped if the name already exists, exactly like a standard node — the UNIQUE (entity_id, kind, name)
     * constraint would otherwise fail the row, and silently renaming somebody's category to make room is worse.
     */
    for (var j = 0; j < ownNames.length; j++) {
      var text = ownNames[j];
      if (have[text.toLowerCase()]) {
        skipped++;
        continue;
      }
      try {
        var ro = await api('defAdd', { body: { kind: 'category', sub_kind: null, name: text, note: '', rules: { parent: null } } });
        var oid = ro && (ro.definition_id || (ro.definition && ro.definition.definition_id));
        if (!oid) {
          failed++;
          continue;
        }
        await api('defSave', { params: { id: oid }, body: { status: 'live' } });
        have[text.toLowerCase()] = oid;
        added++;
      } catch (e) {
        failed++;
      }
    }
  } finally {
    hideBusy();
  }
  if (typeof cbCatgLive === 'function') await cbCatgLive(true);
  await cbcatLoad(true);
  /* ⚠️ Report skips and failures. A seed that says "done" while a third of it silently did not land is how
     someone spends an afternoon wondering where their tree went. */
  toast(
    added + ' added' + (skipped ? ' · ' + skipped + ' already there' : '') + (failed ? ' · ' + failed + ' could not be created' : ''),
    failed ? true : false
  );
}

/* ── interaction ─────────────────────────────────────────────────────────────────────────────────────────────── */
function cbcatSelect(id) {
  CBCAT_UI.sel = id;
  CBCAT_UI.mode = 'view';
  CBCAT_UI.form = null;
  if (UI.vp === 'mob') {
    UI.mdetail = true;
    var node = document.getElementById('panel');
    if (node) node.classList.add('showdetail');
  }
  cbcatPaint();
}
/** The whole `rules` object a category writes. ⚠️ ONE builder, both call sites — see the note in cbcatSave. */
function cbcatRules(f) {
  return { parent: f.parent || null, default_slab: f.default_slab || null };
}
function cbcatNew() {
  CBCAT_UI.mode = 'edit';
  CBCAT_UI.sel = null;
  CBCAT_UI.form = { id: null, name: '', note: '', parent: CBCAT_UI.sel || null, default_slab: null };
  if (UI.vp === 'mob') {
    UI.mdetail = true;
    var node = document.getElementById('panel');
    if (node) node.classList.add('showdetail');
  }
  cbcatPaint();
}
function cbcatEdit(id) {
  var c = (CBCAT_UI.list || []).filter(function (x) {
    return x.id === id;
  })[0];
  if (!c) return;
  CBCAT_UI.mode = 'edit';
  CBCAT_UI.form = { id: c.id, name: c.name, note: c.note, parent: c.parent || null, default_slab: c.default_slab || null };
  cbcatPaint();
}
function cbcatCancel() {
  CBCAT_UI.mode = 'view';
  CBCAT_UI.form = null;
  cbcatPaint();
}
function cbcatField(k, v) {
  if (CBCAT_UI.form) CBCAT_UI.form[k] = v;
}
function cbcatSearch(v) {
  CBCAT_UI.q = v;
  cbcatPaintList();
}
function cbcatBack() {
  UI.mdetail = false;
  var node = document.getElementById('panel');
  if (node) node.classList.remove('showdetail');
}

/* ── render ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function cbcatVisible() {
  var q = (CBCAT_UI.q || '').trim().toLowerCase();
  var a = CBCAT_UI.list || [];
  return q
    ? a.filter(function (item) {
        return (item.name + ' ' + item.note).toLowerCase().indexOf(q) >= 0;
      })
    : a;
}
function cbcatRowsHTML() {
  if (CBCAT_UI.busy && !CBCAT_UI.list) return '<div class="loadwrap"><span class="spin"></span> loading…</div>';
  if (CBCAT_UI.err) return '<div class="cbcat-err">' + esc(CBCAT_UI.err) + '</div>';
  var rows = cbcatVisible();
  if (!rows.length) {
    /* ⚠️ A SEARCH THAT FOUND NOTHING IS NOT AN EMPTY SHELF, so no action is offered in that branch —
       'make a category' is the wrong next step when the real one is 'type a different word'. */
    return CBCAT_UI.q
      ? emptyState('🏷️', tx('Nothing matches that'), tx('Try a different word.'))
      : emptyState('🏷️', tx('No categories yet'), tx('A category is how a shelf gets sorted. Attach products to it from the Catalogue.'), {
          label: tx('+ New category'),
          onclick: 'cbcatNew()'
        });
  }
  /* ⭐ lazyWrap draws 50 and reveals the rest — a shop with a deep scheme can carry hundreds of shelves. */
  return lazyWrap('cbcat', rows, function (c) {
    var n = (CBCAT_UI.counts && CBCAT_UI.counts.by[c.id]) || 0;
    var ret = c.status === 'retired';
    return (
      '<div data-cbsid="CTG002-C01" class="row' +
      (c.id === CBCAT_UI.sel ? ' sel' : '') +
      '" data-testid="catg-row-' +
      esc(c.id) +
      '"' +
      ' onclick="cbcatSelect(\'' +
      esc(c.id) +
      '\')"' +
      (ret ? ' style="opacity:.72"' : '') +
      '>' +
      '<div style="flex:1;min-width:0;padding-inline-start:' +
      (c.depth || 0) * 16 +
      'px">' +
      '<div style="display:flex;align-items:center;gap:7px">' +
      '<b style="font-size:var(--fs-3)' +
      (ret ? ';text-decoration:line-through' : '') +
      '">' +
      esc(c.name) +
      '</b>' +
      (ret ? '<span class="cbcat-badge ret">retired</span>' : '') +
      '</div>' +
      (c.note ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:1px">' + esc(c.note) + '</div>' : '') +
      cbcatOfferLinesHTML(c.id) +
      '</div>' +
      /* The count is the reason to look at this list at all — which shelves are actually carrying anything. */
      cbcatTaxChipHTML(c.id) +
      '<span class="cbcat-n" title="products in this category">' +
      n +
      '</span>' +
      '</div>'
    );
  });
}
function cbcatDetailHTML() {
  if (CBCAT_UI.mode === 'edit') {
    var f = CBCAT_UI.form || { name: '', note: '' };
    var editing = !!f.id;
    return (
      '<div class="dh"><button data-cbsid="CTG002-B07" class="dback" onclick="cbcatBack()">‹ Categories</button>' +
      /* ⭐ "EDIT", NOT "RENAME". Athi, 2026-09-03: *"You are bringing category organization (sits under) under
         rename … Is it renaming? so do we have a proper name for that?"* The form edits three facts — name, PARENT,
         note — and only one of them is a rename. Moving a category is a different act: every product under it
         travels, so the parent field says how many. */
      '<div class="dt">' +
      (editing ? tx('Edit category') : tx('New category')) +
      '</div>' +
      '<div class="ds">' +
      (editing ? tx('name · parent · note — products follow') : tx('goes on the shelf live')) +
      '</div></div>' +
      '<div class="db" tabindex="0" role="region" aria-label="' + esc(tx('Category details')) + '">' +
      (editing ? cbcatEditTabsHTML(f.id) : '') +
      (editing && (CBCAT_UI.etab || 'category') === 'products' ? cbcatProductTicksHTML(f.id) : '') +
      '<div data-testid="catg-eform"' +
      (editing && (CBCAT_UI.etab || 'category') === 'products' ? ' hidden' : '') +
      '>' +
      (editing
        ? '<div class="cbcat-note">' +
          txf(
            'Renaming is safe — every product follows. ⚠️ A copy of the old name travels with items already in a {other} catalogue, and that copy deliberately does not change.',
            {
              other: tx('counterparty’s')
            }
          ) +
          /* ⭐ WHY it is safe is the mechanism: products cite the category by id, not by the word. */
          specNote('categories.rename', 'Products cite a category by <b>id</b>, never by its word, so a rename propagates without touching any item.') +
          '</div>'
        : '') +
      '<label class="fl">' +
      tx('Name') +
      '</label>' +
      '<input data-cbsid="CTG002-I03" class="inp" id="cbcat_name" data-testid="catg-name" value="' +
      esc(f.name || '') +
      '"' +
      ' placeholder="Grains" oninput="cbcatField(\'name\',this.value)">' +
      '<label class="fl">' +
      tx('Parent category') +
      '</label>' +
      cbcatParentPickHTML(f) +
      (editing
        ? '<div style="font-size:var(--fs-1);color:var(--grey);margin:-4px 0 8px">' +
          txf('Changing the parent MOVES this category — {n} product(s) travel with it, and every product under it inherits the new branch.', {
            n: String((CBCAT_UI.counts && CBCAT_UI.counts.by && CBCAT_UI.counts.by[f.id]) || 0)
          }) +
          '</div>'
        : '') +
      '<label class="fl">' +
      tx('Default tax slab') +
      '</label>' +
      cbcatSlabPickHTML(f) +
      /* ⭐ THE OFFERS SIT BESIDE THE SLAB ON THE EDIT FORM TOO — Athi, 2026-09-05: "the right side shows the tax but not
         the offer attached?" A tick saves to the OFFER straight away (its targets), not with this form's Save. */
      (editing ? cbcatOfferTicksHTML(f.id) : '') +
      '</div>' +
      (false ? '' : '') +
      '<label class="fl">' +
      tx('Note') +
      '</label>' +
      '<input data-cbsid="CTG002-I04" class="inp" value="' +
      esc(f.note || '') +
      '" placeholder="optional — what belongs here"' +
      ' oninput="cbcatField(\'note\',this.value)">' +
      '<div class="err" id="cbcat_err" style="margin-top:8px"></div>' +
      '</div>' +
      '<div class="actbar"><button data-cbsid="CTG002-B08" class="pri" data-testid="catg-save" onclick="cbcatSave()">' +
      (editing ? 'Save' : 'Create') +
      '</button><button data-cbsid="CTG002-B09" onclick="cbcatCancel()">' +
      tx('Cancel') +
      '</button></div>'
    );
  }

  var c = (CBCAT_UI.list || []).filter(function (x) {
    return x.id === CBCAT_UI.sel;
  })[0];
  if (!c) {
    /* ⚠️ THE SCHEMES SHOW HERE TOO. They describe classification in general, not one category — so hanging them
       only off a selected row meant they were invisible on the screen someone lands on. */
    /* ⭐ 'Or make a new one' was prose pointing at a button elsewhere. It is the button now. */
    return (
      '<div class="db" tabindex="0" role="region" aria-label="' + esc(tx('Category details')) + '">' +
      emptyState('🏷️', tx('Pick a category'), tx('Categories sort your catalogue and give buyers a way to narrow it.'), {
        label: tx('+ New category'),
        onclick: 'cbcatNew()'
      }) +
      cbcatSchemesHTML() +
      '</div>'
    );
  }
  var n = (CBCAT_UI.counts && CBCAT_UI.counts.by[c.id]) || 0;
  var ret = c.status === 'retired';
  var mine = (UI.prods || []).filter(function (item) {
    return catgIdsOf((item && (item.item_data || item)) || {}).indexOf(c.id) >= 0;
  });
  return (
    '<div class="dh"><button data-cbsid="CTG002-B10" class="dback" onclick="cbcatBack()">‹ Categories</button>' +
    '<div class="dt">' +
    esc(c.name) +
    (ret ? ' <span class="cbcat-badge ret">retired</span>' : '') +
    '</div>' +
    '<div class="ds">' +
    (c.note ? esc(c.note) : n + ' product' + (n === 1 ? '' : 's')) +
    '</div></div>' +
    '<div class="db" tabindex="0" role="region" aria-label="' + esc(tx('Category details')) + '">' +
    (ret
      ? '<div class="cbcat-note warn">This category is <b>retired</b>. It cannot be attached to anything new. ' +
        'Products that already cite it keep the citation.</div>'
      : '') +
    (function () {
      var t = cbcatTaxOf(c.id);
      return (
        '<div class="sec">' +
        tx('Applied here') +
        '</div>' +
        '<div class="cbcat-stat" data-testid="catg-tax-applied"><span class="v">' +
        (t === null ? '…' : t ? (t.dead ? '⚠️' : t.rate === null || t.rate === undefined ? '?' : t.rate + '%') : '—') +
        '</span>' +
        '<span class="k">' +
        (t === null
          ? tx('reading the slabs…')
          : t
            ? t.dead
              ? tx('cites a slab that is not active')
              : esc(t.name || '') + (t.inherited_from ? ' · ' + esc(tx('inherited from') + ' ' + t.inherited_from) : ' · ' + tx('set on this category'))
            : tx('no slab here or above — products fall to the catalogue default')) +
        '</span></div>'
      );
    })() +
    /* ⚠️ the space is written, not left to the flex gap — it read "363products in this category" on the live
       screen, and a number welded to its noun is the kind of small wrongness that makes a figure look unchecked */
    '<div class="cbcat-stat"><span class="v">' +
    n +
    '</span> <span class="k">product' +
    (n === 1 ? '' : 's') +
    ' in this category</span></div>' +
    /* ⭐ THE REVERSE VIEW. An offer can target a category ("10% off Paints") and until now only the offer knew.
       Athi, 2026-09-03: *"if we want to manage products at category level, can we add here, like this category is
       under offer."* Same live-offers read the product page uses — one loader, one cache. */
    cbcatOffersHereHTML(c.id) +
    /* View shows what APPLIES (the line above); the ticks to change it live on Edit — Athi, 2026-09-05 */
    '<div class="sec">' +
    tx('Products') +
    '</div>' +
    (mine.length
      ? '<div class="cbcat-plist">' +
        mine
          .slice(0, 60)
          .map(function (item) {
            var d = item.item_data || item,
              also = catgIdsOf(d).length - 1;
            return (
              '<div class="cbcat-prow"><span>' +
              esc(d.name || d.product || 'item') +
              '</span>' +
              /* ⚠️ Say when a product is ALSO elsewhere. Without it this list reads as a partition, and someone
                 retiring a category would think they were emptying a shelf rather than removing one label. */
              (also > 0 ? '<span class="cbcat-also">+' + also + ' other categor' + (also === 1 ? 'y' : 'ies') + '</span>' : '') +
              '</div>'
            );
          })
          .join('') +
        (mine.length > 60 ? '<div class="cbcat-prow" style="color:var(--grey)">+' + (mine.length - 60) + ' more</div>' : '') +
        /**
         * ⚠️⚠️ THE COUNT IS THE SHOP'S; THIS LIST IS ONLY WHAT IS LOADED. The tally comes from the server and
         * is true of every row; the names below come from the catalogue page this screen happens to hold. On a
         * ten-thousand-product shop those differ by a lot, and a heading reading "400 products" above three
         * names is the kind of quiet contradiction that makes somebody distrust every other number on the page.
         */
        (n > mine.length
          ? '<div class="cbcat-prow" style="color:var(--grey)">' +
            (n - mine.length) +
            ' more in this category, not loaded on this screen — open ' +
            '<span data-cbsid="CTG002-C02" onclick="navTo(\'catalogue\')" style="color:var(--blue);font-weight:600;cursor:pointer">' +
            tx('Catalogue') +
            '</span> to search them</div>'
          : '') +
        '</div>'
      : n > 0
        ? /* ⚠️ counted but none loaded: "nothing here yet" would be a flat lie */
          '<div class="cbcat-none">' +
          n +
          ' product' +
          (n === 1 ? '' : 's') +
          ' ' +
          (n === 1 ? 'is' : 'are') +
          ' filed here. None of them are loaded on this screen — open ' +
          '<span data-cbsid="CTG002-C03" onclick="navTo(\'catalogue\')" style="color:var(--blue);font-weight:600;cursor:pointer">' +
          tx('Catalogue') +
          '</span> to see them</div>'
        : '<div class="cbcat-none">None yet, attach from <span data-cbsid="CTG002-C04" onclick="navTo(\'catalogue\')" style="color:var(--blue);font-weight:600;cursor:pointer">' +
          tx('Catalogue') +
          '</span> — tick, then press <b>' +
          tx('Categorise') +
          '</b>.</div>') +
    '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--grey);font-size:var(--fs-1)">ⓘ ' +
    tx('About standard sets and codes') +
    '</summary>' +
    cbcatSchemesHTML() +
    '</details>' +
    '</div>' +
    '<div class="actbar">' +
    (ret
      ? '<button data-cbsid="CTG002-B11" class="pri" data-testid="catg-relive" onclick="cbcatRelive(\'' + esc(c.id) + '\')">' + tx('Put back on the shelf') + '</button>'
      : '<button data-cbsid="CTG002-B12" class="pri" data-testid="catg-edit" onclick="cbcatEdit(\'' +
        esc(c.id) +
        '\')">' +
        tx('Edit') +
        '</button>' +
        '<button data-cbsid="CTG002-B13" data-testid="catg-retire" onclick="cbcatRetire(\'' +
        esc(c.id) +
        '\')">' +
        tx('Retire') +
        '</button>') +
    '</div>'
  );
}
/**
 * ⭐ WHAT APPLIES TO A CATEGORY — Athi, 2026-09-05: "I applied 5% for the top category — it should reflect the categories
 * underneath; the left panel should show what tax is applied for this category; the view panel should show what is
 * currently applied and the products". The tax: the category's own slab, else the nearest ancestor's (rules.parent),
 * resolved against the same live slab list the product page uses. The offers: scoped to this category or to an ancestor.
 */
function cbcatById(id) {
  return (
    (CBCAT_UI.list || []).filter(function (x) {
      return x.id === id;
    })[0] || null
  );
}
function cbcatTaxOf(cid) {
  var slabs = (typeof cbDefsCached === 'function' && cbDefsCached('tax')) || null;
  if (slabs === null && typeof cbDefsLive === 'function') {
    cbDefsLive('tax')
      .then(cbcatPaint)
      .catch(function () {});
    return null;
  }
  var by = {};
  (slabs || []).forEach(function (item) {
    by[String(item.definition_id || item.id)] = item;
  });
  var c = cbcatById(cid),
    hops = 0,
    from = null;
  while (c && hops++ < 16) {
    var sid = c.default_slab || c.slab || (c.rules && c.rules.default_slab);
    if (sid && by[String(sid)]) {
      var d = by[String(sid)];
      return { slab_id: String(sid), name: d.name, rate: d.rules && d.rules.rate, inherited_from: from };
    }
    if (sid && !by[String(sid)]) return { slab_id: String(sid), name: null, rate: null, dead: true, inherited_from: from };
    from = c.name;
    c = c.parent ? cbcatById(c.parent) : null;
  }
  return null;
}
function cbcatAncestorIds(cid) {
  var out = [],
    c = cbcatById(cid),
    hops = 0;
  while (c && c.parent && hops++ < 16) {
    out.push(c.parent);
    c = cbcatById(c.parent);
  }
  return out;
}
function cbcatTaxChipHTML(cid) {
  var t = cbcatTaxOf(cid);
  if (t === null) return '';
  if (t.dead) return '<span class="cbcat-badge" data-testid="catg-tax-' + esc(cid) + '" style="color:var(--warn-3)">⚠️ ' + tx('slab not active') + '</span>';
  return (
    '<span class="cbcat-badge" data-testid="catg-tax-' +
    esc(cid) +
    '" title="' +
    esc(t.name || '') +
    (t.inherited_from ? ' · ' + tx('inherits') + ' ' + esc(t.inherited_from) : '') +
    '">' +
    esc(t.rate === null || t.rate === undefined ? t.name || '?' : 'GST ' + t.rate + '%') +
    (t.inherited_from ? ' <span style="opacity:.7">↑</span>' : '') +
    '</span>'
  );
}
/**
 * ⭐ ATTACH AN OFFER TO A WHOLE CATEGORY, FROM HERE — Athi, 2026-09-05: "how can I attach an offer for that category?
 * the screen is not allowing or bringing the offer details here". The same tick the product page has, writing
 * `applies_to.category_ids` on the offer (many categories per offer; the form's single `category` still counts).
 * The engine (offers.js) honours both; a child category inherits through catgWithAncestors.
 */
function cbcatOfferCats(rules) {
  var at = (rules && rules.applies_to) || {};
  return [].concat(at.category ? [String(at.category)] : [], Array.isArray(at.category_ids) ? at.category_ids.map(String) : []);
}
/**
 * ⭐ THE REVERSE ATTACH. Athi, 2026-09-04: "we are attaching category from catalogue, this is the other way around —
 * the same multi-select and attach for category, from here". On EDIT (View shows what applies, Edit modifies — his
 * rule of 2026-09-05), every product is a tick: ticked = carries this category. A tick writes the PRODUCT (its
 * `categories` list, whole record through the same PATCH the product page uses) — so the product page, the
 * catalogue row and the storefront read the change the same instant; nothing is stored on the category.
 */
/** The editor's two tabs: Category (name · parent · slab · offers · note) and Products (the catalogue pane, ticks attach). */
function cbcatEditTab(k) {
  CBCAT_UI.etab = k;
  cbcatPaintDetail();
}
function cbcatEditTabsHTML(cid) {
  var k = CBCAT_UI.etab || 'category';
  var prods = UI.prods || [];
  var inCat = prods.filter(function (item) {
    return catgIdsOf((item && (item.item_data || item)) || {}).indexOf(String(cid)) >= 0;
  }).length;
  var tab = function (key, label) {
    return (
      '<button data-cbsid="CTG002-B14" type="button" class="' +
      (k === key ? 'on' : '') +
      '" data-testid="catg-etab-' +
      key +
      '" onclick="cbcatEditTab(\'' +
      key +
      '\')">' +
      label +
      '</button>'
    );
  };
  return (
    '<div class="dtabs" data-testid="catg-etabs" style="margin:0 0 10px">' +
    tab('category', tx('Category')) +
    tab('products', tx('Products') + (cid ? ' · ' + inCat + ' ' + tx('of') + ' ' + prods.length : '')) +
    '</div>'
  );
}
/** The context the catalogue renderer takes: this category's search · chip · tick · click (see prodRowsHTML(ctx) in app.html). */
function cbcatProdCtx(cid) {
  return {
    q: CBCAT_UI.pq || '',
    catg: CBCAT_UI.pcatg || '',
    picking: true,
    noRef: true,
    isTicked: function (id) {
      var p = (UI.prods || []).filter(function (x) {
        return prodId(x) === id;
      })[0];
      return !!p && catgIdsOf(pData(p)).indexOf(String(cid)) >= 0;
    },
    onToggle: function (id) {
      return "cbcatProductToggle('" + cid + "','" + id + "', this)";
    },
    onPick: function (v) {
      return "cbcatProdCatg('" + v + "')";
    }
  };
}
function cbcatProdCatg(v) {
  CBCAT_UI.pcatg = CBCAT_UI.pcatg === v ? '' : v;
  cbcatProdTicksRepaint(CBCAT_UI.form && CBCAT_UI.form.id);
}
/**
 * ⭐ THE REVERSE ATTACH = THE CATALOGUE PANE, HERE. Athi, 2026-09-04: "the entire catalogue left pane should be there so
 * we can search and attach … in a separate tab". Same search box, same category chips, same rows as the Catalogue
 * screen — rendered by the same functions with a context — and a click on a row ticks it: the product's categories
 * are written at once (whole record, same PATCH), so the product page, the catalogue row and the storefront follow.
 */
function cbcatProductTicksHTML(cid) {
  if (!UI.prods) {
    if (typeof loadCatalogue === 'function')
      loadCatalogue().then(function () {
        if (UI.nav === 'categories' && CBCAT_UI.mode === 'edit') cbcatPaintDetail();
      });
    return '<div class="cbcat-none">' + tx('reading the catalogue…') + '</div>';
  }
  var ctx = cbcatProdCtx(cid);
  return (
    '<div class="catlist" data-testid="catg-prod-pane" style="border:1px solid var(--line);border-radius:10px;overflow:hidden">' +
    '<div style="padding:8px 10px;border-bottom:1px solid var(--line)"><input data-cbsid="CTG002-I05" class="inp" data-testid="catg-prod-search" placeholder="' +
    esc(tx('Search name, code, offer, tax')) +
    '" value="' +
    esc(CBCAT_UI.pq || '') +
    '" oninput="CBCAT_UI.pq=this.value; cbcatProdTicksRepaint(\'' +
    esc(cid) +
    '\')"></div>' +
    '<div id="cbcat_prodstrip" style="padding:6px 10px 0">' +
    (typeof prodCatgStripHTML === 'function' ? prodCatgStripHTML(ctx) : '') +
    '</div>' +
    '<div id="cbcat_prodticks" data-testid="catg-prod-ticks" style="max-height:60vh;overflow:auto">' +
    (typeof prodRowsHTML === 'function' ? prodRowsHTML(ctx) : '') +
    '</div>' +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
    tx(
      'The same catalogue pane. A click on a row attaches this category to the product at once — the product page, the catalogue row and the storefront follow.'
    ) +
    '</div>'
  );
}
function cbcatProdTicksRepaint(cid) {
  var node = document.getElementById('cbcat_prodticks');
  if (node && typeof prodRowsHTML === 'function') node.innerHTML = prodRowsHTML(cbcatProdCtx(cid));
  var st = document.getElementById('cbcat_prodstrip');
  if (st && typeof prodCatgStripHTML === 'function') st.innerHTML = prodCatgStripHTML(cbcatProdCtx(cid));
}
async function cbcatProductToggle(cid, pid, btn) {
  var p = (UI.prods || []).filter(function (x) {
    return prodId(x) === pid;
  })[0];
  if (!p) return;
  var d = Object.assign({}, pData(p));
  var ids = catgIdsOf(d).map(String);
  var on = ids.indexOf(String(cid)) >= 0;
  ids = on
    ? ids.filter(function (x) {
        return x !== String(cid);
      })
    : ids.concat([String(cid)]);
  d.categories = ids;
  delete d.category;
  if (btn) btn.disabled = true;
  try {
    await api('prodEdit', { params: { id: pid }, body: { item_data: d } }); /* the whole record — the PATCH validates it as one */
    toast(on ? tx('Detached') : tx('Attached ✓'));
    if (typeof loadCatalogue === 'function') await loadCatalogue('fresh');
    cbcatPaintList();
    cbcatProdTicksRepaint(cid);
    var node = document.querySelector('[data-testid="catg-etabs"]');
    if (node) node.outerHTML = cbcatEditTabsHTML(cid);
  } catch (e) {
    toast((e && e.message) || tx('Could not change the product'), true);
    if (btn) btn.disabled = false;
  }
}
function cbcatOfferTicksHTML(cid) {
  var list =
    typeof ctOffersEnsure === 'function'
      ? ctOffersEnsure(function () {
          cbcatPaintDetail();
        })
      : null;
  if (!list)
    return '<div class="sec">' + tx('Offers') + '</div><div style="padding:6px 12px;color:var(--grey);font-size:var(--fs-2)">' + tx('reading…') + '</div>';
  if (!list.length)
    return (
      '<div class="sec">' +
      tx('Offers') +
      '</div><div style="padding:6px 12px;color:var(--grey);font-size:var(--fs-2)">' +
      tx('None live. ') +
      '<span data-cbsid="CTG002-C05" onclick="goCatsetSec(\'offers\')" style="color:var(--blue);font-weight:600;cursor:pointer">' +
      tx('Author one') +
      '</span> ' +
      tx('in Catalogue setup, then attach it here.') +
      '</div>'
    );
  return (
    '<div class="sec">' +
    tx('Offers') +
    ' <span style="font-weight:400;color:var(--grey);font-size:var(--fs-1)">' +
    tx('tick to apply to every product in this category and under it') +
    '</span></div>' +
    '<div class="ctcatgs" data-testid="catg-offer-ticks" style="padding:4px 12px">' +
    list
      .map(function (item) {
        var on = cbcatOfferCats(item.rules).indexOf(String(cid)) >= 0;
        var terms =
          typeof CBOffers !== 'undefined' && CBOffers.terms
            ? CBOffers.terms(Object.assign({ kind: item.rules && item.rules.kind }, item.rules || {}), {
                money: function (n) {
                  return typeof inr === 'function' ? inr(n) : String(n);
                }
              }) || ''
            : '';
        return (
          '<button data-cbsid="CTG002-B15" type="button" class="ctcatg' +
          (on ? ' on' : '') +
          '" data-testid="catg-offer-' +
          esc(item.id) +
          '" onclick="cbcatOfferToggle(\'' +
          esc(cid) +
          "','" +
          esc(item.id) +
          '\',this)">' +
          (on ? '✓ ' : '') +
          esc(item.name) +
          (terms ? ' <span style="color:var(--grey)">· ' + esc(terms) + '</span>' : '') +
          '</button>'
        );
      })
      .join('') +
    '</div>'
  );
}
/**
 * ⭐ ATTACHING AN OFFER TO A WHOLE CATEGORY IS A MONEY PROMISE (UX-109, Athi's "money promise = deliberate confirm"):
 * the first press asks, in the shared confirmAsk popup, and says the reach — the category and how many products it holds
 * (the server's tally, CBCAT_UI.counts; no number is claimed when the tally is not loaded or is only a page). Nothing is
 * written until yes; Cancel leaves the offer exactly as it was. Taking an offer OFF a category narrows the reach, so it
 * does not ask.
 */
function cbcatOfferToggle(categoryId, offerId, btn) {
  var removing = btn && btn.className.indexOf('on') >= 0;
  if (removing) return _cbcatOfferSave(categoryId, offerId, btn, removing);
  var category = (CBCAT_UI.list || []).filter(function (x) {
    return x.id === categoryId;
  })[0];
  confirmAsk(
    tx('Apply this offer to') + ' “' + ((category && category.name) || tx('this category')) + '”?',
    cbcatOfferReach(categoryId) + ' ' + tx('and under it will get this offer at the till and in the shop, from now on.'),
    tx('Apply to category'),
    function () {
      return _cbcatOfferSave(categoryId, offerId, btn, removing);
    }
  );
}
/** The reach in words: the server's product count for the category, or no number at all when the tally is not loaded or only a page. */
function cbcatOfferReach(categoryId) {
  if (!CBCAT_UI.counts || CBCAT_UI.counts.partial) return tx('Every product in this category');
  var count = cbcatCount(categoryId);
  return '<b>' + count + ' ' + (count === 1 ? tx('product') : tx('products')) + '</b> ' + tx('in this category');
}
/** The offer's current rules, read from its definition; null when it has no kind (the caller says so and changes nothing). */
async function cbcatOfferRulesOf(offerId) {
  const reply = await api('defGet', { params: { id: offerId } });
  const d = (reply && reply.definition) || {};
  const vers = (reply && reply.versions) || [];
  const curV =
    vers.filter(function (item) {
      return item.version === d.current_version;
    })[0] ||
    vers[0] ||
    {};
  const rules = Object.assign({ kind: d.sub_kind }, curV.rules || d.rules || {});
  return rules.kind ? rules : null;
}
/** The rules with this category added to (or taken off) applies_to.category_ids; the form's single `category` joins the array on first touch, so nothing is lost and one shape remains. */
function cbcatRulesWithCategory(rules, categoryId, removing) {
  const at = Object.assign({}, rules.applies_to || {});
  var ids = cbcatOfferCats(rules).filter(function (x, index, arr) {
    return arr.indexOf(x) === index;
  });
  delete at.category;
  ids = removing
    ? ids.filter(function (x) {
        return x !== String(categoryId);
      })
    : ids.concat(ids.indexOf(String(categoryId)) >= 0 ? [] : [String(categoryId)]);
  if (ids.length) at.category_ids = ids;
  else delete at.category_ids;
  if (Object.keys(at).length) rules.applies_to = at;
  else delete rules.applies_to;
  return rules;
}
async function _cbcatOfferSave(categoryId, offerId, btn, removing) {
  if (btn) btn.disabled = true;
  try {
    const rules = await cbcatOfferRulesOf(offerId);
    if (!rules) {
      toast(tx("Could not read that offer's terms, so nothing was changed. Open it in Catalogue setup first."), true);
      return;
    }
    await api('defSave', { params: { id: offerId }, body: { rules: cbcatRulesWithCategory(rules, categoryId, removing) } });
    toast(removing ? tx('Offer removed from this category') : tx('Offer applies to this category ✓'));
  } catch (e) {
    toast((e && e.message) || tx('Could not change that offer'), true);
  } finally {
    /* the live shelf too — not only when the bell's "shop changed" happens to arrive first (see prodOfferApply) */
    UI._ctOffers = undefined;
    if (typeof _DEFS !== 'undefined') delete _DEFS.offer;
    if (btn) btn.disabled = false;
    cbcatPaintDetail();
  }
}
/**
 * ⭐ THE OFFERS THAT REACH A CATEGORY, WITH THEIR TIME — Athi, 2026-09-05: "like how tax is shown in the left side
 * panel, the offer also should be showcased — the effective offer and the date it will get applied, only the
 * futuristic, so in one glance it will be visible". Own or an ancestor's (↑); Active → 🏷️ terms; Scheduled → 📅 from
 * <date>; Expired → not shown. The words are the engine's (CBOffers.terms / timeStatus), so the chip cannot disagree
 * with the basket.
 */
function cbcatOffersReaching(cid) {
  var list =
    typeof ctOffersEnsure === 'function'
      ? ctOffersEnsure(function () {
          cbcatPaint();
        })
      : null;
  if (!list) return null;
  var anc = cbcatAncestorIds(cid);
  return list
    .map(function (item) {
      var rows = cbcatOfferCats(item.rules);
      var own = rows.indexOf(String(cid)) >= 0;
      var viaId = own
        ? null
        : rows.filter(function (entry) {
            return anc.indexOf(entry) >= 0;
          })[0];
      if (!own && !viaId) return null;
      var r = item.rules || {};
      var t = typeof CBOffers !== 'undefined' && CBOffers.timeStatus ? CBOffers.timeStatus(r) : 'active';
      var terms =
        typeof CBOffers !== 'undefined' && CBOffers.terms
          ? CBOffers.terms(Object.assign({ kind: r.kind }, r), {
              money: function (n) {
                return typeof inr === 'function' ? inr(n) : String(n);
              }
            }) || ''
          : '';
      var scope = typeof CBOffers !== 'undefined' && CBOffers.scopeLabel ? CBOffers.scopeLabel(Object.assign({ kind: r.kind }, r)) : '';
      return {
        id: item.id,
        name: item.name,
        terms: terms,
        scope: scope,
        time: t,
        from: r.valid_from || null,
        to: r.valid_to || null,
        via: viaId ? (cbcatById(viaId) || {}).name || null : null
      };
    })
    .filter(Boolean)
    .filter(function (x) {
      return x.time !== 'expired';
    });
}
/* ⭐ ONE EXPLICIT LINE PER OFFER, under the category name — Athi, 2026-09-05: "if ₹100 off is on the total bill that
   should be explicit … bring the offer detail below the category name, so if more than one applies it can be shown". */
function cbcatOfferLinesHTML(cid) {
  var here = cbcatOffersReaching(cid);
  if (!here || !here.length) return '';
  return (
    '<div data-testid="catg-offer-lines-' +
    esc(cid) +
    '" style="margin-top:3px;display:flex;flex-direction:column;gap:2px;font-size:var(--fs-1)">' +
    here
      .map(function (x) {
        var when = x.time === 'scheduled' ? '<span style="color:var(--blue)">📅 ' + esc(tx('from') + ' ' + (x.from || '')) + '</span>' : '<span>🏷️</span>';
        return (
          '<div data-testid="catg-offer-line" data-time="' +
          esc(x.time) +
          '" style="display:flex;gap:6px;flex-wrap:wrap;align-items:baseline">' +
          when +
          '<b>' +
          esc(x.terms || x.name) +
          '</b><span style="color:var(--grey)">' +
          esc(tx(x.scope)) +
          '</span>' +
          '<span style="color:var(--grey)">· ' +
          esc(x.name) +
          (x.to ? ' · ' + esc(tx('to') + ' ' + x.to) : '') +
          (x.via ? ' · ' + esc(tx('via') + ' ' + x.via) + ' ↑' : '') +
          '</span></div>'
        );
      })
      .join('') +
    '</div>'
  );
}
function cbcatOffersHereHTML(cid) {
  var list =
    typeof ctOffersEnsure === 'function'
      ? ctOffersEnsure(function () {
          cbcatPaintDetail();
        })
      : null;
  if (!list) return '';
  var anc = cbcatAncestorIds(cid);
  var reach = cbcatOffersReaching(cid) || [];
  var here = list.filter(function (item) {
    return reach.some(function (x) {
      return x.id === item.id;
    });
  });
  if (!here.length) return '';
  var timeWord = function (o) {
    var x =
      reach.filter(function (y) {
        return y.id === o.id;
      })[0] || {};
    return x.time === 'scheduled'
      ? ' <span style="color:var(--blue)">' + esc(tx('Scheduled from') + ' ' + (x.from || '')) + '</span>'
      : ' <span style="color:var(--ok, #2e7d32)">' + esc(tx('Active')) + (x.to ? ' ' + esc(tx('to') + ' ' + x.to) : '') + '</span>';
  };
  return (
    '<div class="cbcat-stat" data-testid="catg-offers-here"><span class="v">' +
    here.length +
    '</span><span class="k">offer' +
    (here.length === 1 ? '' : 's') +
    ' appl' +
    (here.length === 1 ? 'ies' : 'y') +
    ' here — ' +
    here
      .map(function (item) {
        var rows = cbcatOfferCats(item.rules);
        var viaId =
          rows.indexOf(String(cid)) >= 0
            ? null
            : rows.filter(function (entry) {
                return anc.indexOf(entry) >= 0;
              })[0];
        var viaP = viaId ? (cbcatById(viaId) || {}).name : null;
        var sc =
          reach.filter(function (y) {
            return y.id === item.id;
          })[0] || {};
        return (
          esc(item.name) +
          (sc.terms ? ' <b>' + esc(sc.terms) + '</b> <span style="color:var(--grey)">' + esc(tx(sc.scope || '')) + '</span>' : '') +
          timeWord(item) +
          (viaP ? ' <span style="color:var(--grey)">(' + esc(tx('via') + ' ' + viaP) + ')</span>' : '')
        );
      })
      .join(' · ') +
    '</span></div>'
  );
}
/**
 * ⭐ HOW MANY SHELVES THERE ARE — its own function, because it is its own fact.
 * ⚠️ When a search has narrowed the list, say what it narrowed FROM. "4 categories" with 40 on the shelf reads
 * as a shop that has lost 36 of them. [[feedback-silence-is-the-bug]]
 */
function cbcatCountHTML() {
  var n = cbcatVisible().length,
    all = (CBCAT_UI.list || []).length;
  return (
    '<span style="font-size:var(--fs-1);color:var(--grey)">' +
    n +
    ' categor' +
    (n === 1 ? 'y' : 'ies') +
    (n !== all ? ' <span style="color:var(--grey-4)">' + tx('of') + ' ' + all + '</span>' : '') +
    '</span>'
  );
}
function cbcatStatsHTML() {
  return (
    cbcatCountHTML() +
    /* ⭐ The uncategorised count is a to-do list, so it is a BUTTON — it takes you to the products it is
       counting rather than merely reporting a number you then have to go and find by hand. */
    (CBCAT_UI.counts && CBCAT_UI.counts.none
      ? '<button data-cbsid="CTG002-B16" data-testid="catg-uncat" onclick="cbcatGoUncategorised()" style="margin-inline-start:auto;border:1px solid var(--gold-line);background:var(--gold-soft);border-radius:9px;padding:4px 9px;font-size:var(--fs-1);color:var(--warn-3);cursor:pointer">' +
        CBCAT_UI.counts.none +
        ' uncategorised <span class=arw>→</span></button>'
      : '')
  );
}
/**
 * ⭐ THE CLASSIFICATION SCHEMES — rehomed here from Definitions (Athi's call, 2026-08-16).
 *
 * HS · GS1 GPC · Schema.org · UNSPSC · custom. These belong beside Categories because **they do the same job**:
 * they classify a product. Your categories are YOUR names for your shelf; a scheme is the world's name for the
 * same thing, and a product can carry both.
 *
 * ⭐ AND GS1 GPC IS THE ONE THE CATEGORY-TREE BACKLOG POINTS AT — the standard whose brick code each category is
 * meant to carry eventually (backlog 22). Putting the scheme list beside the category list means the standard
 * sits next to the thing it standardises, rather than in a screen about definitions in general.
 *
 * ⚠️ ALWAYS BY REFERENCE — you cite the code, you never copy the scheme. The blurb says so because it is the
 * whole difference between citing HS 1006 and inventing a private meaning for it.
 * ⚠️ Rows come from `cbDefRegistries()`, so this is a second READER of one list, never a second copy.
 */
function cbcatSchemesHTML() {
  if (typeof cbDefRegistries !== 'function') {
    ensureCap('definitions').then(function () {
      cbcatPaintDetail();
    });
    return '';
  }
  var s = cbDefRegistries().filter(function (x) {
    return x.key === 'standard';
  })[0];
  if (!s || !(s.rows || []).length) return '';
  return (
    '<div class="sec" style="margin-top:14px">' +
    tx('Classification schemes') +
    '</div>' +
    '<div class="cbcat-note" style="margin-bottom:8px">' +
    esc(s.blurb) +
    '</div>' +
    '<div class="cbcat-plist">' +
    s.rows
      .map(function (item) {
        /**
         * ⭐ THE NAME ON ONE LINE, THE EXPLANATION UNDER IT — Athi, 2026-09-01: *"bring the explanation below the
         * HS-, this will give a better look. Ie: customer your own scheme in one line and the explanation can be
         * given below."* The note used to sit on the same line as the name, so the line people scan to find a
         * scheme was the longest line in the block.
         *
         * ⚠️ And the name is printed ONCE — `cbDefLabelOnce` drops the `HS — ` the label carries for use
         * elsewhere. That is the *"do we need two HS?"* he asked about.
         */
        var lab = typeof cbDefLabelOnce === 'function' ? cbDefLabelOnce(item) : item.label || '';
        return (
          '<div class="cbcat-prow" style="display:block">' +
          '<div><code style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1)">' +
          esc(item.code) +
          '</code>' +
          (lab ? '<span style="margin-inline-start:8px;font-weight:600">' + esc(lab) + '</span>' : '') +
          '</div>' +
          /**
           * ⚠️ `white-space:normal` AND `margin-inline-start:0` OVERRIDE THE SHARED CLASS ON PURPOSE.
           * `.cbcat-also` was built for the product list above, where it is a SHORT trailing hint pushed to the
           * right of one line and must not wrap. A scheme's note is three sentences, so under that class it ran
           * off the edge and gave the box a sideways scrollbar — visible in e2e/schemes.png before this, and
           * exactly the *"can we redesign the details in the boxes"* Athi asked about.
           *
           * ⭐ Overridden HERE rather than in the class, because the product list still wants the old behaviour.
           * Changing the shared rule would have fixed this box and broken that one.
           */
          (item.note
            ? '<div class="cbcat-also" style="margin-inline-start:0;margin-top:2px;display:block;' +
              'white-space:normal;line-height:1.5;max-width:78ch">' +
              esc(item.note) +
              '</div>'
            : '') +
          '</div>'
        );
      })
      .join('') +
    '</div>' +
    /**
     * ⭐ THE SOURCE LINE MOVED BEHIND 🧾 Spec — Athi: *"read from app/catalogue-model.js · STD_SCHEMES, is it
     * necessary?"* For someone choosing a scheme, no: a file path cannot help anyone decide anything.
     *
     * ⚠️ Not deleted, though. Naming where the list comes from is what makes "we keep no list of our own"
     * checkable instead of a promise in a comment. Spec mode exists for exactly that reader, so the claim stays
     * verifiable and stops being a footnote on everybody else's screen.
     */
    (typeof specOn === 'function' && specOn()
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">read from <code>' + esc(s.source) + '</code></div>'
      : '')
  );
}
/**
 * The parent picker. ⚠️ Options are indented with the same depth the list uses, so "sits under" is answered by
 * the shape of the dropdown rather than by remembering what the tree looked like a moment ago.
 */
function cbcatParentPickHTML(f) {
  var opts = cbcatParentOptions(f.id);
  if (!opts.length)
    return '<div style="font-size:var(--fs-2);color:var(--grey);margin:2px 0 4px">Becomes a top-level category</div>';
  return (
    '<select data-cbsid="CTG002-S02" class="inp" data-testid="catg-parent" onchange="cbcatField(\'parent\', this.value || null)">' +
    '<option value="">— top level —</option>' +
    opts
      .map(function (item) {
        var pad = new Array((item.depth || 0) + 1).join('  ');
        return '<option value="' + esc(item.id) + '"' + (f.parent === item.id ? ' selected' : '') + '>' + pad + esc(item.name) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
function cbcatPaintList() {
  var node = document.getElementById('cbcat_rows');
  if (node) node.innerHTML = cbcatRowsHTML();
  var s = document.getElementById('cbcat_stats');
  if (s) s.innerHTML = cbcatStatsHTML();
}
function cbcatPaintDetail() {
  if (typeof UI !== 'undefined' && UI.nav !== 'categories') return;
  var node = document.getElementById('detailpane');
  if (node) {
    node.className = 'detail';
    node.innerHTML = cbcatDetailHTML();
  }
}
function cbcatPaint() {
  cbcatPaintList();
  cbcatPaintDetail();
}

function categoriesScreen() {
  cbcatCss();
  var list =
    '<div class="list"><div class="lh">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">' +
    '<span style="font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-3)">' +
    tx('🏷️ Categories') +
    '</span>' +
    '</div>' +
    '<button data-cbsid="CTG002-B17" class="composebtn" style="width:100%;justify-content:center" data-testid="catg-new" onclick="cbcatNew()">+ New category</button>' +
    '<button data-cbsid="CTG002-B18" class="composebtn" style="width:100%;justify-content:center;margin-top:7px;background:var(--card);color:var(--blue);border:1px solid var(--line)" data-testid="catg-seed" onclick="cbcatSeedAsk()">' +
    tx('📐 Start from a standard set') +
    '</button>' +
    '<div class="srch" style="margin-top:8px">🔍 <input data-cbsid="CTG002-I06" data-testid="catg-search" placeholder="Search categories" value="' +
    esc(CBCAT_UI.q || '') +
    '" oninput="cbcatSearch(this.value)"></div>' +
    /* ⚠️ ITS OWN ELEMENT, REPAINTED WITH THE ROWS. The counts arrive AFTER the screen is built, and the header is
       rendered once by categoriesScreen() — so anything derived from counts that lives up here is stale forever.
       The uncategorised button was invisible on the first look for exactly that reason. */
    '<div id="cbcat_stats" style="margin-top:8px;display:flex;align-items:center;gap:8px">' +
    cbcatStatsHTML() +
    '</div>' +
    '<div style="margin-top:8px">' +
    cbcatSortSelect() +
    '</div>' +
    '</div><div class="rows" id="cbcat_rows">' +
    cbcatRowsHTML() +
    '</div></div>';
  var detail = '<div class="detail" id="detailpane">' + cbcatDetailHTML() + '</div>';
  var divider =
    '<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)" role="separator" aria-label="Resize panes"><span class="grip"></span></div>';
  var showDetail = UI.vp === 'mob' && UI.mdetail;
  return (
    '<div class="panel ' +
    (showDetail ? 'showdetail' : '') +
    '" id="panel" style="--lw:' +
    UI.lw +
    'px;--lh:' +
    UI.lh +
    'px">' +
    list +
    divider +
    detail +
    '</div>'
  );
}
/* Hand off to the Catalogue with its filter already set — the count and the fix live on different screens. */
function cbcatGoUncategorised() {
  UI._prodCatg = '__none';
  navTo('catalogue');
}

function cbcatCss() {
  if (document.getElementById('cbcat_css')) return;
  var node = document.createElement('style');
  node.id = 'cbcat_css';
  node.textContent = [
    '.cbcat-n{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);color:var(--grey);',
    'background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:1px 9px;flex:0 0 auto}',
    '.cbcat-badge{font-size:var(--fs-1);font-weight:700;border-radius:6px;padding:1px 7px;text-transform:uppercase;letter-spacing:.04em}',
    '.cbcat-badge.ret{background:var(--neutral-tint);color:var(--ink-2)}',
    '.cbcat-err{font-size:var(--fs-2);color:var(--disp);background:var(--danger-tint);border:1px solid #f0c9c6;border-radius:9px;padding:8px 11px;margin:8px 0}',
    '.cbcat-note{font-size:var(--fs-2);line-height:1.55;color:var(--warn-3);background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 11px;margin-bottom:11px}',
    '.cbcat-note.warn{color:var(--warn-2)}',
    '.cbcat-stat{display:flex;align-items:baseline;gap:9px;margin-bottom:4px}',
    '.cbcat-stat .v{font-size:var(--fs-6);font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
    '.cbcat-stat .k{font-size:var(--fs-2);color:var(--grey)}',
    '.cbcat-plist{border:1px solid var(--line);border-radius:9px;overflow:hidden}',
    '.cbcat-prow{display:flex;gap:9px;align-items:baseline;padding:7px 11px;font-size:var(--fs-2);border-bottom:1px dashed var(--line)}',
    '.cbcat-prow:last-child{border-bottom:0}',
    '.cbcat-also{margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey);white-space:nowrap}',
    '.cbcat-none{font-size:var(--fs-2);color:var(--grey);line-height:1.6}'
  ].join('');
  (document.head || document.documentElement).appendChild(node);
}
