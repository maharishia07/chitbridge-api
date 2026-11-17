/* app/cap-folders.js — FOLDERS capability (lazy; loaded via ensureCap('folders')).
 * A per-entity TREE for organising ANY chit (mailing-model). foldersScreen() = tree (left, recursive/nestable) +
 * the selected folder's chits with Current/Archive (right). Any chit is redirected via 📁 Move (sets folder_id on
 * this entity's copy). Backend: routes/folders.js + b63. Self-registers its endpoints.
 * OWNS      the Folders screen and its Chits · Metrics · Rules tabs, the Move-to-folder sheet, the group-sum pane.
 * FLOW      foldersScreen → loadFolders → pick a folder → loadFolderChits → _folderView → (Metrics: loadFolderMetrics · Rules: loadFolderRules)
 * CARD      01-rail-core-the-chit/user-folders-and-auto-file-rules
 * CALLED BY public/accounts.html, public/crm.html, public/finance.html (a <script> tag each) · public/app.html (ensureCap('folders'))
 * IDS       every control carries its register code (data-cbsid, UX-137): SCR004, Folders, on whichever page draws it.
 */
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    foldersList: { m: 'GET', p: '/api/folders', ok: 'y' },
    folderCreate: { m: 'POST', p: '/api/folders', ok: 'y' },
    folderRename: { m: 'PATCH', p: '/api/folders/:id', ok: 'y' },
    folderDelete: { m: 'DELETE', p: '/api/folders/:id', ok: 'y' },
    folderMove: { m: 'POST', p: '/api/folders/move', ok: 'y' },
    folderChits: { m: 'GET', p: '/api/folders/:id/chits', ok: 'y' },
    // Metrics share select+measure with the counterparty scorecard, so a folder and a supplier can never
    // disagree about what "open" or "overdue" means.
    folderMetrics: { m: 'GET', p: '/api/folders/:id/metrics', ok: 'y' },
    folderRules: { m: 'GET', p: '/api/folders/:id/rules', ok: 'y' },
    folderRuleCreate: { m: 'POST', p: '/api/folders/:id/rules', ok: 'y' },
    folderRuleUpdate: { m: 'PATCH', p: '/api/folders/rules/:rule_id', ok: 'y' },
    folderRuleDelete: { m: 'DELETE', p: '/api/folders/rules/:rule_id', ok: 'y' },
    folderRulePreview: { m: 'POST', p: '/api/folders/rules/preview', ok: 'y' }, // what WOULD this rule have caught
    /* Track level — the SAME two panes opened from Task/Order itself rather than from inside a folder.
       ⚠️ Metrics reuses /reconcile rather than adding a track-metrics route: reconcile already measures every copy
       on the track AND proves the folders add up. A second endpoint returning the first half of that would be one
       more place for the same number to be computed differently. */
    folderReconcile: { m: 'GET', p: '/api/folders/reconcile', ok: 'y' }, // ?scope=task|order
    folderAllRules: { m: 'GET', p: '/api/folders/rules', ok: 'y' }, // every rule, across folders
    folderGroupSum: { m: 'GET', p: '/api/folders/groupsum', ok: 'y' }, // ?scope= &folder_id= — requirement + cost
    scorecardList: { m: 'GET', p: '/api/relationships/scorecard', ok: 'y' },
    scorecardOne: { m: 'GET', p: '/api/relationships/scorecard/:entity_id', ok: 'y' }
  });
}
/**
 * ⭐ THE FOLDER LIST NOW CARRIES THE SYSTEM FOLDERS TOO (API 2026-10-01: B-2100 Bills · Received, B-1300 Bills · Issued,
 * R-1400 Receipts … — each a VIEW whose contents are its rule's matches, plus a shop's own view folders). They are not
 * places: nothing is moved into them, and they are not sub-lists of Task or Order. So they are kept APART here, at the one
 * place the list arrives — UI.folders stays the filed folders every existing screen already reads (the rail under Task and
 * Order, Move, the rules panes, the tree) and UI.sysFolders holds the views for the Bills screen (designed first; not built).
 */
function _foldersFrom(r) {
  var all = (r && r.folders) || [];
  var view = function (f) {
    return !!(f.system || f.kind === 'view');
  };
  UI.sysFolders = all.filter(view);
  return all.filter(function (item) {
    return !view(item);
  });
}
/** fetch the folder list into UI.folders (empty on failure) and repaint in the background */
async function loadFolders() {
  try {
    var reply = await api('foldersList');
    UI.folders = _foldersFrom(reply);
  } catch (e) {
    UI.folders = [];
  }
  /* ⚠️ bgRenderApp, NOT renderApp. This runs on STARTUP as well as after a user action, and renderApp rebuilds
     the shell — including the empty #modalhost — so a folder list arriving while someone is in Compose deleted
     their draft. Measured 2026-08-18: this was the last of seven such callers. The user-initiated callers
     (folderCreate, rename, move) repaint themselves or navigate, so nothing loses a refresh it needed. */
  if (typeof bgRenderApp === 'function') bgRenderApp();
  else if (typeof renderApp === 'function') bgRenderApp();
}
/**
 * ⭐ ONE NODE OF A FOLDER TREE — the look _folderTree has always drawn (a glyph, the name, a figure at the far end, the
 * chosen one tinted), taking its words as arguments so the Ledgers tree in CB Accounts (cap-books.js bkLedgers) draws the
 * very same node: `o.depth` · `o.sel` · `o.onclick` (JS body) · `o.icon` · `o.label` (HTML) · `o.tail` (HTML, the far end) ·
 * `o.tid` (data-testid) · `o.style` (extra style, e.g. a taller tap target on a phone).
 */
function _folderNode(node) {
  return (
    '<div data-cbsid="SCR004-C01"' +
    (node.cls ? ' class="' + node.cls + '"' : '') +
    (node.tid ? ' data-testid="' + node.tid + '"' : '') +
    ' style="display:flex;align-items:center;gap:6px;padding:6px 8px;padding-inline-start:' +
    (8 + (node.depth || 0) * 15) +
    'px;border-radius:9px;cursor:pointer;font-size:var(--fs-2);' +
    (node.sel ? 'background:var(--blue-tint-bg);color:var(--blue-2);font-weight:700' : 'color:var(--ink-2)') +
    (node.style ? ';' + node.style : '') +
    '" onclick="' +
    node.onclick +
    '">' +
    node.icon +
    ' ' +
    node.label +
    '<span style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey)">' +
    node.tail +
    '</span></div>'
  );
}
/**
 * ⭐ THE TWO-PANE LAYOUT OF A FOLDER SCREEN — tree on the left (250px), the chosen thing on the right — taking its two halves
 * as HTML. foldersScreen() and the Ledgers screen both call it; `o.cls` / `o.id` let a caller carry its own container query.
 */
function _folderPanes(treeHTML, rightHTML, o) {
  o = o || {};
  return (
    '<div' +
    (o.id ? ' id="' + o.id + '"' : '') +
    ' class="' +
    (o.cls || '') +
    '" style="display:flex;height:100%;min-height:0">' +
    '<div class="' +
    (o.treeCls || '') +
    '" style="width:var(--ftw,250px);border-inline-end:1px solid var(--line);overflow:auto;padding:12px 8px;flex:0 0 auto">' +
    treeHTML +
    '</div>' +
    '<div class="' +
    (o.paneCls || '') +
    '" style="flex:1;overflow:auto;min-width:0" id="' +
    (o.paneId || 'detailpane') +
    '">' +
    rightHTML +
    '</div></div>'
  );
}
// recursive tree render — parent_id makes it nestable (same pattern as the Network tree)
function _folderTree(parentId, depth) {
  var kids = (UI.folders || []).filter(function (item) {
    return (item.parent_id || null) === (parentId || null);
  });
  return kids
    .map(function (item) {
      return (
        _folderNode({
          depth: depth,
          sel: UI.folderSel === item.folder_id,
          onclick: "selectFolder('" + item.folder_id + "')",
          icon: '📁',
          label: esc(item.name),
          tail: String(item.count || 0)
        }) + _folderTree(item.folder_id, depth + 1)
      );
    })
    .join('');
}
/** the Folders screen: the folder tree on the left, the picked folder (or a prompt to pick one) on the right */
function foldersScreen() {
  if (UI.folders === undefined) {
    loadFolders();
    return loader('Loading folders…');
  }
  var tree = _folderTree(null, 0) || '<div style="color:var(--grey);font-size:var(--fs-2);padding:8px 6px">No folders yet</div>';
  var right = UI.folderSel ? _folderView() : emptyState('📁', 'Pick a folder', 'Or create one, then file chits into it with 📁 Move.');
  return _folderPanes(
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em;padding:2px 8px 8px">' +
      tx('FOLDERS') +
      '</div>' +
      tree +
      '<div data-cbsid="SCR004-C02" style="font-size:var(--fs-2);color:var(--blue);padding:9px 8px 4px;cursor:pointer" onclick="newFolder()">＋ New folder</div>',
    right
  );
}
function selectFolder(id) {
  UI.folderSel = id;
  UI.folderArch = false;
  UI.folderChits = undefined;
  if (typeof renderApp === 'function') renderApp();
  loadFolderChits();
}
function setFolderArch(a) {
  UI.folderArch = a;
  UI.folderChits = undefined;
  var node = document.getElementById('detailpane');
  if (node) node.innerHTML = _folderView();
  loadFolderChits();
}
/** fetch the picked folder's chits (current or archive) into UI.folderChits and repaint the detail pane */
async function loadFolderChits() {
  var id = UI.folderSel;
  if (!id) return;
  try {
    var reply = await api('folderChits', { params: { id: id }, query: { archived: UI.folderArch ? 1 : 0 } });
    UI.folderChits = Array.isArray(reply)
      ? reply
      : (reply && (reply.chits || reply.rows || reply.data)) ||
        []; /* ⚠️ api() collapses {chits:[…]} TO the array — r.chits was undefined, so a folder showed no chits at all */
  } catch (e) {
    UI.folderChits = [];
  }
  var node = document.getElementById('detailpane');
  if (node) node.innerHTML = _folderView();
}
/** the picked folder's pane: Current/Archive tabs, the Chits · Metrics · Rules tabs, then that tab's body */
function _folderView() {
  var f = (UI.folders || []).find(function (x) {
    return x.folder_id === UI.folderSel;
  }) || { name: 'Folder' };
  var arch = !!UI.folderArch;
  var tab = function (on, label, onclick) {
    return (
      '<span data-cbsid="SCR004-C03" onclick="' +
      onclick +
      '" style="cursor:pointer;font-size:var(--fs-2);font-weight:700;padding:5px 13px;border-radius:16px;' +
      (on ? 'background:var(--blue);color:var(--on-accent)' : 'border:1px solid var(--line);color:var(--grey-2)') +
      '">' +
      label +
      '</span>'
    );
  };
  var head =
    '<div style="padding:14px 18px;border-bottom:1px solid var(--line)"><div style="font-size:var(--fs-4);font-weight:800">📁 ' +
    esc(f.name) +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">Sender → this folder</div>' +
    '<div style="display:flex;gap:6px;margin-top:11px;align-items:center">' +
    tab(!arch, 'Current', 'setFolderArch(false)') +
    tab(arch, 'Archive', 'setFolderArch(true)') +
    '<span data-cbsid="SCR004-C04" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--blue);cursor:pointer" onclick="renameFolder(\'' +
    UI.folderSel +
    '\')">' +
    tx('Rename') +
    '</span>' +
    '<span data-cbsid="CMP011" style="font-size:var(--fs-1);color:var(--disp);cursor:pointer;margin-inline-start:14px" onclick="deleteFolder(\'' +
    UI.folderSel +
    '\')">' +
    tx('Delete') +
    '</span></div>' +
    /* ⚠️ PANES, NOT A DENSER PANE. Rules and metrics are each a full job; crushed into the chit list they would be
       unreadable on a phone and barely readable anywhere. One job per tab — the shape the compose flow already uses. */
    '<div style="display:flex;gap:6px;margin-top:10px">' +
    _ftab('chits', '📄 Chits') +
    _ftab('metrics', '📊 Metrics') +
    _ftab('rules', '⚙️ Rules') +
    '</div></div>';
  var list;
  if (UI.folderChits === undefined) list = '<div style="padding:16px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading…') + '</div>';
  else if (!UI.folderChits.length)
    list =
      '<div style="padding:22px 18px;color:var(--grey);font-size:var(--fs-2)">Nothing ' +
      (arch ? 'in Archive' : 'here') +
      ' yet. From Task, use 📁 Move to file a chit into this folder.</div>';
  else
    list = UI.folderChits
      .map(function (item) {
        var bj = item.business_json;
        if (typeof bj === 'string') {
          try {
            bj = JSON.parse(bj);
          } catch (e) {
            bj = null;
          }
        }
        var isDev = !!(bj && bj.kind === 'device_signal');
        var subj = esc(item.manual_subject || item.auto_subject || '(no subject)');
        var raiser = esc(item.raiser_name || (isDev && bj.device_id) || item.sender_entity_display_name || '—');
        var line2 = isDev
          ? '🛰️ ' +
            esc(bj.sub_type || bj.signal || 'signal') +
            (bj.value != null && bj.value !== '' ? ' = ' + esc(String(bj.value)) + esc(bj.unit || '') : '') +
            ' · raised by <b>' +
            raiser +
            '</b>'
          : 'from ' + esc(item.sender_entity_display_name || raiser);
        var when = typeof fmtAt === 'function' ? esc(fmtAt(item.created_at)) : '';
        var openA = typeof openChit === 'function' ? "openChit('" + item.chit_id + "')" : '';
        return (
          '<div data-cbsid="SCR004-C05" style="display:flex;gap:11px;padding:12px 18px;border-bottom:1px solid #f0f2f4;cursor:pointer" onclick="' +
          openA +
          '"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:var(--fs-3)">' +
          (isDev ? '🛢️ ' : '') +
          subj +
          '</div><div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
          line2 +
          '</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto"><span style="font-size:var(--fs-1);color:var(--grey)">' +
          when +
          '</span><span data-cbsid="SCR004-C06" style="font-size:var(--fs-1);color:var(--blue);border:1px solid var(--blue-tint-line);background:var(--blue-tint-bg);border-radius:9px;padding:2px 8px" onclick="event.stopPropagation();moveChit(\'' +
          item.chit_id +
          '\')">' +
          tx('📁 Move') +
          '</span></div></div>'
        );
      })
      .join('');
  // The chit list is now ONE of three panes; metrics and rules render themselves.
  if (_FLD.tab === 'metrics') return head + _folderMetricsPane();
  if (_FLD.tab === 'rules') return head + _folderRulesPane();
  return head + '<div style="overflow:auto">' + list + '</div>';
}
/* A tab in the folder header. Same pill shape as Current/Archive above it, so the two rows read as one control. */
function _ftab(k, label) {
  var on = (_FLD.tab || 'chits') === k;
  return (
    '<span data-cbsid="SCR004-C07" data-testid="folder-tab-' +
    k +
    '" onclick="setFolderTab(\'' +
    k +
    '\')" style="cursor:pointer;font-size:var(--fs-2);font-weight:700;padding:5px 13px;border-radius:16px;' +
    (on ? 'background:var(--chrome);color:var(--chrome-on)' : 'border:1px solid var(--line);color:var(--grey-2)') +
    '">' +
    label +
    '</span>'
  );
}
/** ask for a name, create the folder, reload the list */
function newFolder() {
  promptAsk('New folder', { label: 'Folder name', placeholder: 'e.g. Awaiting payment', okLabel: 'Create' }, async function (name) {
    try {
      await api('folderCreate', { body: { name: name } });
      UI.folders = undefined;
      loadFolders();
      if (typeof toast === 'function') toast('Folder created.');
    } catch (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Create failed');
    }
  });
}
/** ask for a new name (prefilled), rename the folder, reload the list */
function renameFolder(id) {
  var f =
    (UI.folders || []).find(function (x) {
      return x.folder_id === id;
    }) || {};
  promptAsk('Rename folder', { label: 'Folder name', value: f.name || '', okLabel: 'Rename' }, async function (name) {
    try {
      await api('folderRename', { params: { id: id }, body: { name: name } });
      UI.folders = undefined;
      loadFolders();
    } catch (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Rename failed');
    }
  });
}
/** confirm, then delete the folder; its chits go back to the mailbox, not away */
function deleteFolder(id) {
  /** the delete itself, after the confirm: clear the selection and reload the list */
  var run = async function () {
    try {
      await api('folderDelete', { params: { id: id } });
      UI.folderSel = null;
      UI.folderChits = undefined;
      UI.folders = undefined;
      loadFolders();
    } catch (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Delete failed');
    }
  };
  if (typeof confirmAsk === 'function')
    confirmAsk('Delete folder', 'Delete this folder? Its chits are <b>not</b> deleted — they return to the main mailbox.', 'Delete', run, true);
  else if (window.confirm('Delete folder? Its chits return to the mailbox.')) run();
}
/** the Move-to-folder sheet for one chit: one row per folder, plus Remove from folder (loads the list first if needed) */
async function moveChit(chitId) {
  if (UI.folders === undefined) {
    try {
      var reply = await api('foldersList');
      UI.folders = _foldersFrom(reply);
    } catch (e) {
      UI.folders = [];
    }
  } /* the filed folders only — a view is not a place to move into */ // self-load so Move works from Task, not just the Folders screen
  var opts = (UI.folders || [])
    .map(function (item) {
      return (
        '<div data-cbsid="SCR004-C08" style="padding:9px 12px;border-bottom:1px solid #f0f2f4;cursor:pointer" onclick="_doMove(\'' +
        chitId +
        "','" +
        item.folder_id +
        '\')">📁 ' +
        esc(item.name) +
        '</div>'
      );
    })
    .join('');
  var body =
    '<div style="max-height:320px;overflow:auto">' +
    (opts || '<div style="padding:12px;color:var(--grey);font-size:var(--fs-2)">Create a folder first</div>') +
    '<div data-cbsid="SCR004-C09" style="padding:10px 12px;color:var(--disp);cursor:pointer;border-top:1px solid var(--line)" onclick="_doMove(\'' +
    chitId +
    '\',null)">' +
    tx('↩ Remove from folder (back to mailbox)') +
    '</div></div>';
  if (typeof modal === 'function')
    modal('<div class="mhd"><div class="t">' + tx('📁 Move to folder') + '</div></div><div class="mbody" style="padding:0">' + body + '</div>');
}
/** file the chit into a folder (null = back to the mailbox) and say which in a toast */
async function _doMove(chitId, folderId) {
  if (folderId === 'null' || folderId === '') folderId = null;
  if (typeof closeModal === 'function') closeModal();
  try {
    await api('folderMove', { body: { chit_id: chitId, folder_id: folderId } });
    if (typeof toast === 'function') toast(folderId ? 'Filed into folder.' : 'Removed from folder.');
    UI.folders = undefined;
    UI.folderChits = undefined;
    if (UI.nav === 'folders') {
      loadFolders();
    } else if (typeof loadList === 'function') {
      loadList();
    } // refresh Task (moved chit leaves the main list) or the folder view
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Move failed');
  }
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  FOLDER PANES — Chits · Metrics · Rules.  The folder is the place these live.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-10: *"bring the UX on the folder itself. in the sense, when we create a folder, inside we may have
 * to have options to set the rules and whatever it is."*
 *
 * ⚠️ PANES, NOT A DENSER PANE. The rules builder and the metrics strip are each a full job; crushing them into the
 * chit list would make the folder screen unreadable on a phone and barely readable anywhere else. Tabs across the
 * top, one job each — the same shape the compose step-flow uses, and the standing rule here.
 */
var _FLD = { tab: 'chits', metrics: null, recon: null, rules: null, rulesNote: null, busy: false, err: null, draft: null, preview: null };

function setFolderTab(t) {
  _FLD.tab = t;
  _FLD.err = null;
  var node = document.getElementById('detailpane');
  if (node) node.innerHTML = _folderView();
  if (t === 'metrics' && !_FLD.metrics) loadFolderMetrics();
  if (t === 'rules' && !_FLD.rules) loadFolderRules();
}
/* ⚠️ THE PANES RENDER WHEREVER THEY WERE OPENED. Metrics/Rules now open as a MODAL over the Task list (a folder
   is that list filtered, not a separate screen), so paint into the modal body when it is there and fall back to
   the detail pane for the legacy standalone Folders screen. */
function _fldPaint() {
  var host = document.getElementById('fld_pane');
  if (host) {
    host.innerHTML = _FLD.tab === 'rules' ? _folderRulesPane() : _FLD.tab === 'groupsum' ? _groupSumPane() : _folderMetricsPane();
    return;
  }
  var node = document.getElementById('detailpane');
  if (node) node.innerHTML = _folderView();
}

/* The track (Task / Order) is the folder you are always in. `_FLD.track` is set when the panes were opened from
   the track rather than from a folder — everything below reads it instead of asking twice. */
function _fldTrack() {
  return UI.folderSel ? null : UI.folder === 'order' ? 'order' : 'task';
}

/* Every rule on a track, assembled from the per-folder endpoint. Used only when the single-call route is absent.
   ⚠️ `migrated` is ANDed, not taken from the last response: if any folder reports the rules table missing, the
   pane must say so rather than show a confidently short list. */
async function _allRulesPerFolder(track) {
  var mine = (UI.folders || []).filter(function (item) {
    return (item.scope || 'task') === track;
  });
  var out = [],
    migrated = true;
  for (var index = 0; index < mine.length; index++) {
    try {
      var reply = await api('folderRules', { params: { id: mine[index].folder_id } });
      if (reply && reply.migrated === false) migrated = false;
      ((reply && reply.rules) || []).forEach(function (x) {
        out.push(x);
      });
    } catch (e) {
      /* one unreadable folder must not blank the whole pane */
    }
  }
  out.sort(function (first, second) {
    return first.sort - second.sort || String(first.created_at).localeCompare(String(second.created_at));
  });
  return { rules: out, migrated: migrated };
}

/**
 * ⭐ EVERY RULE THE ENTITY HAS, ACROSS BOTH TRACKS — the list a reorder must be computed against.
 * ⚠️ NOT the same as _allRulesPerFolder(track), and the difference is the whole correctness argument: `sort` is
 * ENTITY-WIDE (one ORDER BY over every rule), while any view — a folder, a track — shows only a slice. Renumber
 * a slice 0..n-1 and you collide with the rules outside it, silently reshuffling folders the user was not even
 * looking at. So the move is decided in the visible list and APPLIED to the full one.
 */
async function _allRulesForSort() {
  var fs = UI.folders || [],
    out = [];
  for (var index = 0; index < fs.length; index++) {
    try {
      var reply = await api('folderRules', { params: { id: fs[index].folder_id } });
      ((reply && reply.rules) || []).forEach(function (x) {
        out.push(x);
      });
    } catch (e) {
      /* one unreadable folder must not scramble the rest — it simply keeps its place */
    }
  }
  out.sort(function (first, second) {
    return first.sort - second.sort || String(first.created_at).localeCompare(String(second.created_at));
  });
  return out;
}
/**
 * Move a rule one place earlier (dir -1) or later (dir +1) in the running order.
 * ⚠️ "One place" means one place IN THE LIST THE USER IS LOOKING AT. Inside a folder, moving up means beating the
 * rule above it in that folder — not landing between two rules of some other folder they cannot see. So the
 * neighbour is chosen from the visible list, then the moved rule is placed relative to that neighbour in the
 * full list. ⚠️ Only rows whose `sort` actually changes are written: the first move on legacy data renumbers
 * everything once (every row ships as 0), and after that a swap touches two.
 */
async function ruleMove(id, dir) {
  var vis = _FLD.rules || [];
  var count = -1;
  for (var index = 0; index < vis.length; index++) if (vis[index].rule_id === id) count = index;
  var ti = count + dir;
  if (count < 0 || ti < 0 || ti >= vis.length) return; // at the end — the button is disabled anyway
  var neighbour = vis[ti].rule_id;

  _FLD.busy = true;
  _FLD.err = '';
  _fldPaint();
  try {
    var all = await _allRulesForSort();
    var from = -1;
    for (var a = 0; a < all.length; a++) if (all[a].rule_id === id) from = a;
    if (from < 0) throw new Error('Could not find that rule to move it.');
    var moved = all.splice(from, 1)[0];
    /* ⚠️ Find the neighbour AFTER the removal. Splicing shifts every index past `from`, so a target computed
       before it lands one place off in exactly half the cases — the classic move-item-in-array bug. */
    var ni = -1;
    for (var b = 0; b < all.length; b++) if (all[b].rule_id === neighbour) ni = b;
    if (ni < 0) throw new Error('Could not place the rule.');
    all.splice(dir < 0 ? ni : ni + 1, 0, moved);

    var writes = [];
    all.forEach(function (item, position) {
      if (item.sort !== position) writes.push(api('folderRuleUpdate', { params: { rule_id: item.rule_id }, body: { sort: position } }));
    });
    await Promise.all(writes);
    _FLD.rules = null;
    await loadFolderRules();
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not change the order.';
    _FLD.busy = false;
    _fldPaint();
  }
}

/** the Metrics tab: reconcile the filed counts, then fetch this folder's metrics */
async function loadFolderMetrics() {
  _FLD.busy = true;
  _FLD.recon = null;
  _fldPaint();
  var track = _fldTrack();
  try {
    if (track) {
      /* ⚠️ ONE CALL, TWO ANSWERS. reconcile returns `overall` — the same measure shape a folder's metrics returns,
         so the whole pane below renders unchanged — plus the per-folder split and the assertion that they add up.
         Asking a metrics endpoint and a reconcile endpoint separately would let the two disagree, which is exactly
         the failure the reconciliation exists to catch. */
      var reply = await api('folderReconcile', { query: { scope: track } });
      /* `overall` is measured over every row on the track, so overall.count IS the total. Used as-is rather than
         overwritten with r.total: if those two ever disagree it is a bug worth seeing, not one worth papering. */
      _FLD.metrics = (reply && reply.overall) || null;
      _FLD.recon = reply;
    } else {
      _FLD.metrics = await api('folderMetrics', { params: { id: UI.folderSel } });
    }
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not read the metrics.';
  }
  _FLD.busy = false;
  _fldPaint();
}
/** the Rules tab: fetch this folder's rules (or every folder's) into _FLD.rules */
async function loadFolderRules() {
  _FLD.busy = true;
  _fldPaint();
  var track = _fldTrack();
  try {
    var r;
    if (track) {
      /* ⚠️ FALLS BACK TO PER-FOLDER READS. GET /api/folders/rules is new, and an API that has not been redeployed
         answers 404 — which would show as "could not read the rules" for a pane whose data is, in fact, entirely
         reachable through an endpoint that has shipped for months. One call when it exists, N when it does not.
         N is the number of folders on this track, fetched only when the pane is opened. */
      try {
        r = await api('folderAllRules');
      } catch (e) {
        r = await _allRulesPerFolder(track);
      }
    } else {
      r = await api('folderRules', { params: { id: UI.folderSel } });
    }
    _FLD.rules = (r && r.rules) || [];
    /* A rule surface that cannot store anything must SAY so rather than accept a rule it will lose. */
    _FLD.rulesNote =
      r && r.migrated === false ? 'Folder rules are not switched on for your shop yet. You can still try a rule; nothing will save.' : null;
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not read the rules.';
    _FLD.rules = [];
  }
  _FLD.busy = false;
  _fldPaint();
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  🧮 GROUP SUM — what does this pile add up to, and who asked for it?
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * Athi, 2026-08-11: *"sum all the tasks and find out the total requirement… say 10 parties ordered 1000Kg, on
 * click the down below need to know who are all asked."*
 */
async function loadGroupSum() {
  _FLD.busy = true;
  _fldPaint();
  /* ⚠️ THE SCOPE IS A CHOICE, and it is stated on screen rather than assumed. Athi: *"at task level, we can ask
     for that total sum irrespective of the folders."*  Inside a folder both readings are reasonable — this pile,
     or the whole track — so the pane offers them instead of picking one silently. */
  var fid = UI.folderSel && !_FLD.gsAll ? UI.folderSel : null;
  var scope = UI.folderSel
    ? (
        (UI.folders || []).find(function (item) {
          return item.folder_id === UI.folderSel;
        }) || {}
      ).scope || 'task'
    : UI.folder === 'order'
      ? 'order'
      : 'task';
  /* ⭐ A TICKED SELECTION WINS OVER THE FOLDER (backlog 31). `_FLD.gsIds` is set only by the select bar's
     🧮 button, so the ordinary folder/track reading is untouched when nothing is ticked.
     ⚠️ The folder filter is dropped for a selection on purpose — you ticked those chits, and silently
     intersecting them with the folder you happen to be standing in would drop rows you explicitly chose. */
  var ids = _FLD.gsIds && _FLD.gsIds.length ? _FLD.gsIds : null;
  if (ids) fid = null;
  try {
    _FLD.gs = await api('folderGroupSum', { query: { scope: scope, folder_id: fid || undefined, chit_ids: ids ? ids.join(',') : undefined } });
    _FLD.err = null;
  } catch (e) {
    var m = (e && e.message) || '';
    /* ⚠️ NAME THE ACTUAL CAUSE. Unlike the Rules pane there is no older endpoint to fall back to, so a 404 here
       means the API has not shipped this route yet — not that the sum failed or that there is nothing to add up.
       "Could not add it up" would send someone hunting through their data for a problem that is not there. */
    _FLD.err = /404|not found/i.test(m)
      ? 'Group sum needs an API version that has not deployed yet. Everything else on this screen works — this one route is missing. (Nothing is wrong with your data.)'
      : m || 'Could not add it up.';
    _FLD.gs = null;
  }
  _FLD.busy = false;
  _fldPaint();
}
function gsScope(all) {
  _FLD.gsAll = !!all;
  _FLD.gs = null;
  loadGroupSum();
}
function gsToggle(i) {
  _FLD.gsOpen = _FLD.gsOpen || {};
  _FLD.gsOpen[i] = !_FLD.gsOpen[i];
  _fldPaint();
}

/**
 * ⚠️ DELEGATES NOW — this WAS the gold standard and the select bar had never been told about it. The rule
 * (side by side, never summed) and the rendering both live in `cbMoneyList` in helpers.js, which is loaded
 * eagerly and so is reachable from app.html too. Two renderings of one rule is how they drift.
 *
 * ⚠️ THE SERVER ALREADY GROUPS BY CURRENCY here, so the shape only needs renaming — `{currency, total}` is
 * exactly what cbSumByCurrency produces, which is why one renderer can serve both.
 */
/**
 * ⭐ ONE MOVE BUTTON — reordering folder rules (↑ ↓). It was shared with the column chooser's ← → until the chooser moved INTO CBList
 * (list-ctl.js owns its own); this is its only caller again. The judgment baked into it:
 *   ⚠️ DISABLED AT THE ENDS, NEVER HIDDEN. A control that vanishes at the boundary makes the row reflow under the cursor you were
 *   about to click again — so the first press moves the item and the second lands on whatever slid into its place.
 *   ⚠️ THE GLYPH MUST MATCH THE AXIS. Rules are a vertical list and take ↑ ↓ ("Run earlier").
 * `js` is the click handler body, so the caller keeps its own action and its own stopPropagation decision.
 */
function mvBtn(glyph, ok, title, js) {
  return '<button data-cbsid="SCR004-B01" type="button" class="mv-btn" ' + (ok ? '' : 'disabled') + ' title="' + esc(title) + '"' + ' onclick="' + js + '">' + glyph + '</button>';
}
/* the Group sum's drill-down block: an indented block on the card colour under its row */
function _gsNext(inner) {
  return '<div style="padding:2px 0 8px 16px;background:var(--card);color:var(--on-card)">' + inner + '</div>';
}
function _gsMoney(list, mixed) {
  if (!list || !list.length) return '<span style="color:var(--grey)">—</span>';
  return cbMoneyList(
    list.map(function (x) {
      return { currency: x.currency, total: x.total };
    }),
    { quiet: !mixed }
  );
}

/** the group-sum pane: money and counts added up per folder, with the scope pills */
function _groupSumPane() {
  if (_FLD.busy && !_FLD.gs) return '<div style="padding:18px;color:var(--grey);font-size:var(--fs-2)"><span class="spin"></span> adding it up…</div>';
  if (_FLD.err) return '<div style="padding:18px;color:var(--disp);font-size:var(--fs-2)">' + esc(_FLD.err) + '</div>';
  var g = _FLD.gs;
  if (!g) return '<div style="padding:18px;color:var(--grey);font-size:var(--fs-2)">Nothing to add up</div>';
  var out = '<div style="padding:14px 18px">';

  /* ⚠️ A SELECTION MUST SAY SO, AND SAY IF IT LOST ANY. The scope toggle below is hidden here because neither
     reading applies — this is neither "this folder" nor "the whole track", it is the chits you ticked. And if
     fewer came back than were asked for, that is stated rather than absorbed: the difference is chits outside
     this track or beyond the row limit, and a pane headed "5 chits" when you ticked 7 is a quiet lie. */
  /* ⚠️ VERSION SKEW MUST NOT LOOK LIKE AN ANSWER. An API that predates `chit_ids` ignores the parameter and
     happily returns the WHOLE TRACK — 19 chits when the user ticked 2 — and every number below would be right
     for a question they did not ask. Seen live while building this. So the claim is checked against the reply:
     we asked for a selection, and if the server did not confirm one, say the selection was ignored. */
  if (_FLD.gsIds && _FLD.gsIds.length && !g.selected) {
    out +=
      '<div style="background:var(--danger-tint);border:1px solid #f0c9c6;border-radius:9px;padding:8px 11px;font-size:var(--fs-1);color:var(--disp-2);margin-bottom:10px">' +
      '' +
      txf('⚠️ {ignored} This server cannot total a ticked set yet, so the figures below cover the {whole}, not your {n} chits.', {
        ignored: '<b>' + tx('Your selection was ignored.') + '</b>',
        whole: '<b>' + tx('whole track') + '</b>',
        n: _FLD.gsIds.length
      }) +
      '</div>';
  } else if (g.selected) {
    var miss = (g.selection_requested || 0) - (g.chits || 0);
    out +=
      '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:8px 11px;font-size:var(--fs-1);color:var(--warn-3);margin-bottom:10px">' +
      '☑ <b>' +
      (g.chits || 0) +
      ' ticked chit' +
      (g.chits === 1 ? '' : 's') +
      '</b> — not this folder or the whole track.' +
      (miss > 0 ? ' ⚠️ ' + miss + ' of the ' + g.selection_requested + ' you ticked are not on this track and were left out.' : '') +
      '</div>';
  } else if (UI.folderSel) {
    var b = function (on, lbl, arg) {
      return (
        '<span data-cbsid="SCR004-C10" onclick="gsScope(' +
        arg +
        ')" style="cursor:pointer;border:1px solid var(--line);border-radius:9px;padding:3px 10px;font-size:var(--fs-1);margin-inline-end:6px;' +
        (on ? 'background:var(--blue);color:var(--on-accent);border-color:var(--blue);font-weight:700' : 'background:var(--card)') +
        '">' +
        lbl +
        '</span>'
      );
    };
    out += '<div style="margin-bottom:10px">' + b(!_FLD.gsAll, 'This folder', 'false') + b(!!_FLD.gsAll, 'Whole track — every folder', 'true') + '</div>';
  }

  /**
   * ⭐⭐ AND IT IGNORES THE STATUS TAB — SAID OUT LOUD. Athi, 2026-08-22: *"the top icon groups irrespective of
   * the status? open, act, assign etc — is it the difference? If so it has to be spelt loud."*
   *
   * He was right. `GET /folders/groupsum` takes `scope`, `folder_id`, `archived` and an optional ticked
   * `chit_ids` — **no status filter anywhere**. So standing on "Open 6" and opening this pane gives you a
   * total that also counts Act and Close.
   *
   * ⚠️ THAT IS THE RIGHT BEHAVIOUR AND THE WRONG SILENCE. "What does this pile add up to" is a question about
   * the whole pile — filtering it by the tab you happen to be standing on would make the answer change as you
   * browsed. But a reader looking at a 6 and a total built from 19 has no way to know why, and the number is
   * more trustworthy the moment it names its own scope.
   *
   * ⚠️ NOT SHOWN FOR A TICKED SELECTION, because there the scope is exactly what the reader chose and the
   * banner above already says so. A caveat that appears when it does not apply teaches people to skip it.
   */
  if (!g.selected) {
    out +=
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px">' +
      '⚑ Counts <b style="color:var(--ink)">every status</b> — Open, Act and Close alike, not just the tab you are on.' +
      '</div>';
  }

  /* ⚠️ SAID FIRST, NOT BURIED. A pile of 47 chits where only 9 carry line items produces a requirement built from
     9 — and without this line that total reads as though it covered all 47. */
  out +=
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:10px">' +
    '<b style="color:var(--ink)">' +
    g.chits +
    '</b> chit' +
    (g.chits === 1 ? '' : 's') +
    ' · <b style="color:var(--ink)">' +
    g.chits_with_lines +
    '</b> carry line items' +
    (g.chits_without_lines ? ' · <span style="color:var(--warn-2)">' + g.chits_without_lines + ' have none and contribute nothing</span>' : '') +
    (g.has_catalogue
      ? ''
      : '<div style="color:var(--warn-2);margin-top:3px">⚠️ Spellings count separately</div>') +
    '</div>';

  var req = g.requirement || [];
  if (req.length) {
    out +=
      '<div style="display:flex;font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);padding:0 0 4px"><span style="flex:1">' +
      tx('Item') +
      '</span><span style="width:110px;text-align:end">' +
      tx('Quantity') +
      '</span><span style="width:130px;text-align:end">' +
      tx('Cost') +
      '</span><span style="width:74px;text-align:end">' +
      tx('Parties') +
      '</span></div>';
    out += req
      .map(function (l, index) {
        var open = !!(_FLD.gsOpen || {})[index];
        var name = esc(l.item) + (l.variant ? ' <span style="color:var(--grey);font-weight:600">· ' + esc(l.variant) + '</span>' : '');
        var head =
          '<div data-cbsid="SCR004-C11" onclick="gsToggle(' +
          index +
          ')" style="display:flex;align-items:center;cursor:pointer;padding:7px 0;border-top:1px solid var(--line);font-size:var(--fs-2)">' +
          '<span style="flex:1;min-width:0">' +
          (open ? '▾' : '<span class=arw>▸</span>') +
          ' ' +
          name +
          (l.matched_by_spelling ? ' <span title="matched through a misspelling" style="font-size:var(--fs-1);color:var(--warn-2)">≈</span>' : '') +
          '</span>' +
          /**
           * ⚠️ A SPLIT TOTAL IS NOT ZERO — SHOW A DASH.
           *
           * When no conversion is defined the server correctly refuses to invent one, so `total` holds only the
           * part in the canonical unit — which is frequently 0. This rendered that 0 as the HEADLINE, so Curry
           * Leaves read **“0 bunch · INR 0”** while carrying 25 கட்டு. The warning explaining it sat in 11px red
           * text underneath, and the number a person actually reads said there was nothing there.
           *
           * ⭐ The app already states this rule on the Metrics pane — *"A dash means nothing to measure, which is
           * not the same as zero"* — and the line immediately below already honours it for an unpriced value. This
           * is the same rule applied to quantity: measured, not measurable, and zero are three different facts.
           */
          '<span style="width:110px;text-align:end;font-weight:800">' +
          (l.unit_split
            ? '<span style="color:var(--disp)" title="units that cannot be added — see the split below">—</span>'
            : esc(String(l.total)) + ' ' + esc(l.canonical_unit || '')) +
          '</span>' +
          '<span style="width:130px;text-align:end">' +
          _gsMoney(l.value, l.value_mixed) +
          '</span>' +
          '<span style="width:74px;text-align:end;color:var(--grey);font-size:var(--fs-1)">' +
          l.stores +
          '</span></div>';
        /* THE DRILLDOWN — Athi: "on click the down below need to know who are all asked". The roster comes straight
         from consolidate()'s attribution; nothing is recomputed to render it. */
        var rows = open
          ? _gsNext(
              (l.breakdown || [])
                .map(function (s) {
                  return (
                    '<div style="display:flex;align-items:center;font-size:var(--fs-2);padding:3px 0">' +
                    '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    esc(s.store_name) +
                    /* ⚠️ WHAT THEY ACTUALLY WROTE, when it differs from the canonical name. "thakkali → Tomato" is the
                 single most useful thing to see when checking whether a total is right. */
                    (String(s.phrase || '').toLowerCase() !== String(l.item || '').toLowerCase()
                      ? ' <span style="color:var(--grey)">— asked as “' + esc(s.phrase) + '”</span>'
                      : '') +
                    '</span>' +
                    '<span style="width:110px;text-align:end">' +
                    esc(String(s.qty)) +
                    ' ' +
                    esc(s.unit || '') +
                    '</span>' +
                    '<span style="width:130px;text-align:end">' +
                    (s.value == null
                      ? '<span style="color:var(--grey)" title="no price on this line — not counted as zero">—</span>'
                      : esc((s.currency || '') + ' ' + s.value)) +
                    '</span>' +
                    '<span style="width:74px"></span></div>'
                  );
                })
                .join('')
            )
          : '';
        var partial =
          open && l.value_partial
            ? '<div style="font-size:var(--fs-1);color:var(--warn-2);padding:0 0 8px 16px">⚠️ ' +
              l.value_partial.unpriced +
              ' of ' +
              (l.value_partial.priced + l.value_partial.unpriced) +
              ' have no price yet — ' +
              txf('the cost above is the priced part only, {not} the cost of this line.', { not: '<b>' + tx('not') + '</b>' }) +
              '</div>'
            : '';
        var split = l.unit_split
          ? '<div style="font-size:var(--fs-1);color:var(--disp);padding:0 0 8px 16px">⚠️ ' +
            esc(l.flagged || 'unit split') +
            ' — ' +
            l.unit_split
              .map(function (item) {
                return esc(item.qty + ' ' + item.unit);
              })
              .join(' + ') +
            '</div>'
          : '';
        return head + rows + partial + split;
      })
      .join('');
  } else {
    out +=
      '<div style="color:var(--grey);font-size:var(--fs-2);padding:8px 0">Nothing totalled. ' +
      (g.chits_with_lines ? 'The lines here did not resolve to catalogue items — see below.' : 'None of these chits carry line items.') +
      '</div>';
  }

  /* ⚠️ THE FLAGS TRAVEL WITH THE TOTALS, never on a separate screen nobody opens. A total with a gap beside it
     gets checked; a total that quietly excluded something does not. */
  var f = g.flags || {};
  var blocks = [
    [
      'unmatched',
      '🚫 Not totalled — no catalogue match',
      f.unmatched,
      function (x) {
        return esc(x.phrase) + ' · ' + esc(x.store_name) + ' · ' + esc(String(x.qty) + ' ' + (x.unit || '')) + (x.reason ? ' — ' + esc(x.reason) : '');
      }
    ],
    [
      'variant_unspecified',
      '⚠️ Not totalled — a grade was never named',
      f.variant_unspecified,
      function (x) {
        return (
          esc(x.item) +
          ' · ' +
          esc(x.store_name) +
          ' — catalogue has ' +
          esc((x.variants || []).join(' / ')) +
          '; picking one silently would be inventing the order'
        );
      }
    ],
    [
      'unit_split',
      '⚠️ Units that cannot be added',
      f.unit_split,
      function (x) {
        return (
          esc(x.item) +
          ' — ' +
          (x.split || [])
            .map(function (item) {
              return esc(item.qty + ' ' + item.unit);
            })
            .join(' + ') +
          '; no conversion is defined, and guessing one sources the wrong quantity'
        );
      }
    ]
  ];
  blocks.forEach(function (item) {
    var arr = item[2] || [];
    if (!arr.length) return;
    out +=
      '<div style="margin-top:12px"><div style="font-size:var(--fs-1);font-weight:800;color:var(--warn-2);margin-bottom:3px">' +
      item[1] +
      ' (' +
      arr.length +
      ')</div>' +
      arr
        .slice(0, 25)
        .map(function (x) {
          return '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">· ' + item[3](x) + '</div>';
        })
        .join('') +
      (arr.length > 25 ? '<div style="font-size:var(--fs-1);color:var(--grey)">…and ' + (arr.length - 25) + ' more</div>' : '') +
      '</div>';
  });

  var mo = g.money || {};
  out +=
    '<div style="margin-top:16px;border-top:1px solid var(--line);padding-top:10px">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:4px">' +
    tx('Agreed value of these chits') +
    '</div>' +
    ((mo.by_currency || []).length
      ? (mo.by_currency || [])
          .map(function (x) {
            return (
              '<span style="display:inline-block;border:1px solid var(--line);border-radius:9px;padding:3px 9px;margin:0 6px 6px 0;font-size:var(--fs-2)"><b>' +
              esc(x.currency) +
              '</b> ' +
              esc(String(x.total)) +
              ' <span style="color:var(--grey)">· ' +
              x.chits +
              ' chit' +
              (x.chits === 1 ? '' : 's') +
              '</span></span>'
            );
          })
          .join('')
      : '<span style="font-size:var(--fs-2);color:var(--grey)">no agreed value</span>') +
    ((mo.excluded || {}).awaiting_agreement
      ? '<div style="font-size:var(--fs-1);color:var(--grey)">' +
        mo.excluded.awaiting_agreement +
        ' chit(s) have no agreed value yet and are excluded — not counted as zero.</div>'
      : '') +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
    txf('⚠️ This is the {agreed}, which is a different question from the {cost} above — a chit can carry priced lines and no agreed total, or the reverse.', {
      agreed: '<b>' + tx('agreed value of the chits') + '</b>',
      cost: '<b>' + tx('cost of the requirement') + '</b>'
    }) +
    '</div>' +
    '</div></div>';
  return out;
}

/* ── metrics ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function _mBox(label, value, hint, tone) {
  var col = tone === 'bad' ? 'var(--disp)' : tone === 'warn' ? 'var(--warn-2)' : 'var(--ink)';
  return (
    '<div style="flex:1;min-width:104px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey)">' +
    esc(label) +
    '</div>' +
    '<div style="font-size:var(--fs-5);font-weight:800;margin-top:3px;color:' +
    col +
    '">' +
    esc(String(value)) +
    '</div>' +
    (hint ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' + esc(hint) + '</div>' : '') +
    '</div>'
  );
}
/**
 * ⭐ THE RECONCILIATION — Athi, 2026-08-10: *"total number of tasks in the database should be the sum of all the
 * tasks under the folder, according to its status."*
 *
 * ⚠️ WHY THIS IS ON SCREEN AND NOT JUST IN THE API. The moment folders exist, the Task header stops being the whole
 * truth: filing moves a chit OUT of the unfiled list and INTO a folder, so Task can read 34 while 180 more sit in
 * folders. Anyone glancing at it would conclude the work had shrunk. The invariant
 *
 *        TOTAL  =  unfiled  +  Σ(every folder)
 *
 * is shown as an arithmetic sentence you can read left to right, and it is ASSERTED, not assumed — if one chit is
 * unaccounted for the strip goes red and names the gap. A total that balances by luck is one that will one day not.
 */
function _reconStrip() {
  var r = _FLD.recon;
  if (!r) return '';
  var fs = (r.folders || [])
    .filter(function (item) {
      return item.own || item.tree;
    })
    .sort(function (first, second) {
      return (second.tree || second.own) - (first.tree || first.own);
    });
  var sums = '<b>' + r.total + '</b> total &nbsp;=&nbsp; <b>' + r.unfiled + '</b> unfiled &nbsp;+&nbsp; <b>' + r.filed + '</b> in folders';
  var verdict = r.reconciles
    ? '<span style="color:var(--ok-3);font-weight:800">' + tx('✓ adds up') + '</span>'
    : '<span style="color:var(--disp);font-weight:800">✗ ' + Math.abs((r.discrepancy || {}).missing || 0) + ' unaccounted for</span>';
  /* ⚠️ `own` AND `tree` BOTH, never one. A parent showing only its own rows makes the tree look smaller than its
     branches; showing only the roll-up makes a parent look full when everything is actually one level down. */
  var rows = fs.length
    ? fs
        .map(function (item) {
          var s = item.segments || {};
          return (
            '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--line);font-size:var(--fs-2)">' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📁 ' +
            esc(item.name) +
            '</span>' +
            '<span style="color:var(--grey);font-size:var(--fs-1)">' +
            (s.open || 0) +
            ' open · ' +
            (s.unassigned || 0) +
            ' unassigned</span>' +
            '<span style="font-weight:800;min-width:34px;text-align:end">' +
            item.own +
            '</span>' +
            (item.tree !== item.own
              ? '<span style="color:var(--grey);font-size:var(--fs-1);min-width:52px;text-align:end">' + item.tree + ' w/ sub</span>'
              : '<span style="min-width:52px"></span>') +
            '</div>'
          );
        })
        .join('')
    : '<div style="font-size:var(--fs-1);color:var(--grey);padding:5px 0">No folders, all unfiled</div>';

  return (
    '<div style="border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin-bottom:12px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey)">Do totals match</div>' +
    '<div style="font-size:var(--fs-2);margin-top:3px">' +
    sums +
    ' &nbsp; ' +
    verdict +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
    (r.overall || {}).assigned +
    ' assigned · ' +
    (r.overall || {}).unassigned +
    ' unassigned — a chit can be open and unassigned, and that is the pile worth seeing.</div>' +
    '<div style="margin-top:8px">' +
    rows +
    '</div>' +
    (r.reconciles
      ? ''
      : '<div style="font-size:var(--fs-1);color:var(--disp);margin-top:7px">⚠️ Totals differ<br>Folder hidden from you</div>') +
    '</div>'
  );
}
/** the Metrics tab body: this folder's clock, disputes and other measures, or a spinner while they load */
function _folderMetricsPane() {
  if (_FLD.busy && !_FLD.metrics) return '<div style="padding:18px;color:var(--grey);font-size:var(--fs-2)"><span class="spin"></span> measuring…</div>';
  var m = _FLD.metrics;
  if (!m) return '<div style="padding:18px;color:var(--grey);font-size:var(--fs-2)">No metrics yet</div>';
  var c = m.clock || {},
    d = m.disputes || {},
    mo = m.money || {};
  var dash = function (v, suffix) {
    return v === null || v === undefined ? '—' : v + (suffix || '');
  };

  var money = (mo.by_currency || []).length
    ? (mo.by_currency || [])
        .map(function (item) {
          return (
            '<span style="display:inline-block;border:1px solid var(--line);border-radius:9px;padding:3px 9px;margin:0 6px 6px 0;font-size:var(--fs-2)"><b>' +
            esc(item.currency) +
            '</b> ' +
            esc(String(item.total)) +
            ' <span style="color:var(--grey)">· ' +
            item.chits +
            ' chit' +
            (item.chits === 1 ? '' : 's') +
            '</span></span>'
          );
        })
        .join('')
    : '<span style="font-size:var(--fs-2);color:var(--grey)">no agreed value</span>';
  /* ⚠️ NEVER ONE TOTAL ACROSS CURRENCIES, and the reason is said on screen rather than left as a design note. */
  var moneyNote =
    (mo.mixed
      ? '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:2px">' +
        txf('⚠️ More than one currency — these are {not} added together. A single total across currencies is a number that means nothing.', {
          not: '<b>' + tx('not') + '</b>'
        }) +
        '</div>'
      : '') +
    ((mo.excluded || {}).awaiting_agreement
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
        mo.excluded.awaiting_agreement +
        ' chit(s) have no agreed value yet and are excluded — they are not counted as zero.</div>'
      : '');

  return (
    '<div style="padding:14px 18px">' +
    _reconStrip() +
    '<div style="display:flex;gap:9px;flex-wrap:wrap">' +
    _mBox(_FLD.recon ? 'On this track' : 'In this folder', m.count, (m.open || 0) + ' open · ' + (m.closed || 0) + ' closed') +
    _mBox('Unread', m.unread, m.unread ? 'nobody has opened these' : 'all seen', m.unread ? 'warn' : null) +
    _mBox('Overdue', m.overdue, txf('open for {days}+ days', { days: m.overdue_days }), m.overdue ? 'bad' : null) +
    _mBox('Oldest', dash(c.oldest_age_days, 'd'), 'the one nobody is working', c.oldest_age_days > (m.overdue_days || 7) * 3 ? 'warn' : null) +
    '</div>' +
    /* ⚠️ RESPONSE and RESOLUTION side by side, never merged. Together they show "we answer fast and finish never",
       which is the commonest way a team looks fine and is not. */
    '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:9px">' +
    _mBox('Typical age', dash(c.median_age_days, 'd'), 'median, not average') +
    _mBox('First touch', dash(c.median_first_touch_days, 'd'), 'time to being read') +
    _mBox('To close', dash(c.median_to_close_days, 'd'), 'time to finished') +
    _mBox('Disputed', dash(d.rate_pct, '%'), (d.open || 0) + ' open now', d.open ? 'bad' : null) +
    '</div>' +
    '<div style="margin-top:14px"><div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:5px">' +
    tx('Value') +
    '</div>' +
    money +
    moneyNote +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:14px;line-height:1.5">A dash means <b>nothing to measure</b>, which is not the same as zero. ' +
    '' +
    txf('“Overdue” is {your} setting — change it in Settings {arrow} Business rules, and every folder and scorecard follows.', {
      your: '<b>' + tx('your') + '</b>',
      arrow: '<span class=arw>→</span>'
    }) +
    '</div>' +
    '</div>'
  );
}

/* ── rules ────────────────────────────────────────────────────────────────────────────────────────────────────── */
var _RULE_HELP = {
  from: 'counterparty name contains',
  subject: 'subject contains',
  text: 'anywhere: subject, party, or the message',
  purpose: 'order · invoice · receipt · inquiry · delivery_note · general',
  direction: 'sent · received',
  status: 'current status',
  channel: 'whatsapp · email · sms · web',
  min_amount: 'value at least',
  max_amount: 'value at most',
  has_dispute: 'true / false',
  unread: 'true / false',
  older_than_days: 'older than N days'
};
function ruleDraftNew() {
  _FLD.draft = { name: '', term: 'from', val: '', enabled: true };
  _FLD.preview = null;
  _fldPaint();
}
function ruleDraftCancel() {
  _FLD.draft = null;
  _FLD.preview = null;
  _fldPaint();
}
function ruleDraftSet(k, v) {
  _FLD.draft = _FLD.draft || {};
  _FLD.draft[k] = v;
  if (k !== 'name') _FLD.preview = null;
}
/** turn the rule draft (term + value) into the rule's when-object; null until a value is filled in */
function _draftWhen() {
  var d = _FLD.draft || {};
  var w = {};
  if (!d.term || !String(d.val).trim()) return null;
  var t = d.term,
    v = String(d.val).trim();
  if (t === 'min_amount' || t === 'max_amount' || t === 'older_than_days') w[t] = Number(v);
  else if (t === 'has_dispute' || t === 'unread') w[t] = v === 'true' || v === '1' || v === 'yes';
  else w[t] = v;
  return w;
}
/**
 * ⚠️ PREVIEW BEFORE SAVE, AND IT IS THE POINT OF THIS SCREEN. A rule is a promise about the future written by
 * someone who cannot see it. Running it against chits that already exist turns "I think this catches Ramesh's
 * invoices" into a list you can read before committing to it.
 */
async function rulePreview() {
  var w = _draftWhen();
  if (!w) {
    _FLD.err = 'Fill in the value first.';
    _fldPaint();
    return;
  }
  _FLD.busy = true;
  _FLD.err = null;
  _fldPaint();
  try {
    _FLD.preview = await api('folderRulePreview', { body: { when: w } });
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not preview.';
  }
  _FLD.busy = false;
  _fldPaint();
}
/** save the drafted rule on this folder; says 'Fill in the value first' when it is empty */
async function ruleSave() {
  var w = _draftWhen();
  if (!w) {
    _FLD.err = 'Fill in the value first.';
    _fldPaint();
    return;
  }
  _FLD.busy = true;
  _FLD.err = null;
  _fldPaint();
  try {
    await api('folderRuleCreate', { params: { id: UI.folderSel }, body: { name: (_FLD.draft || {}).name || '', when: w } });
    _FLD.draft = null;
    _FLD.preview = null;
    _FLD.rules = null;
    await loadFolderRules();
    if (typeof toast === 'function') toast('Rule saved — it files new arrivals from now on');
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not save the rule.';
    _FLD.busy = false;
    _fldPaint();
  }
}
async function ruleToggle(id, on) {
  try {
    await api('folderRuleUpdate', { params: { rule_id: id }, body: { enabled: !!on } });
    _FLD.rules = null;
    await loadFolderRules();
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not change that.';
    _fldPaint();
  }
}
/** confirm, then delete a rule; chits it already filed stay where they are */
function ruleDelete(id) {
  confirmAsk(
    'Delete this rule?',
    'Chits already filed <b>stay put</b> — a rule only decides what happens next.',
    'Delete',
    function () {
      _ruleDelete(id);
    },
    true
  );
}
async function _ruleDelete(id) {
  try {
    await api('folderRuleDelete', { params: { rule_id: id } });
    _FLD.rules = null;
    await loadFolderRules();
  } catch (e) {
    _FLD.err = (e && e.message) || 'Could not delete it.';
    _fldPaint();
  }
}

function _fldFolderName(id) {
  var f = (UI.folders || []).find(function (x) {
    return x.folder_id === id;
  });
  return (f && f.name) || 'a folder';
}
/* ⚠️ THE ORDINAL IS NOT DECORATION. The pane promises "they run in order, and the first match wins" — a promise
   that is TRUE (the server reads ORDER BY sort, created_at and match.firstMatch stops at the first hit) but was
   invisible: a stack of identical cards gives the reader no way to tell WHICH rule wins when two overlap, which
   is the single question this list exists to answer. Numbering them makes the running order readable.
   The order is EDITABLE (DB-42): the ↑ ↓ buttons below call ruleMove(), which writes `sort` through folderRuleUpdate
   (PATCH /folders/rules/:rule_id accepts it). Showing the number as well means the reader can say which rule wins. */
function _ruleRow(r, i, n) {
  var terms = Object.keys(r.when || {})
    .map(function (item) {
      return '<span style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-1)">' + esc(item) + '</span> <b>' + esc(String(r.when[item])) + '</b>';
    })
    .join(' <span style="color:var(--grey)">and</span> ');
  return (
    '<div style="border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin-bottom:8px;background:var(--card);color:var(--on-card)">' +
    '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">' +
    '<span title="Runs ' +
    (i === 0 ? 'first' : 'after the ' + i + ' above') +
    '" style="flex:0 0 auto;min-width:20px;height:20px;border-radius:5px;background:var(--paper);border:1px solid var(--line);color:var(--grey);font-size:var(--fs-1);font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums">' +
    (i + 1) +
    '</span>' +
    /* ⚠️ ↑ ↓, NOT ← →: this is a vertical list, and the glyph has to match the axis the thing actually moves on.
       Disabled at the ends rather than hidden — see mvBtn(). Only shown when there is somewhere to move TO: a
       single rule cannot be reordered, and two dead buttons beside it just invite a click that does nothing. */
    (n > 1
      ? '<span style="display:inline-flex;gap:3px;flex:0 0 auto">' +
        mvBtn('↑', i > 0, 'Run earlier — this rule will beat the one above it', "ruleMove('" + esc(r.rule_id) + "',-1)") +
        mvBtn('↓', i < n - 1, 'Run later — the rule below will beat this one', "ruleMove('" + esc(r.rule_id) + "',1)") +
        '</span>'
      : '') +
    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input data-cbsid="SCR004-I01" type="checkbox" data-testid="rule-enabled" ' +
    (r.enabled ? 'checked' : '') +
    ' onchange="ruleToggle(\'' +
    esc(r.rule_id) +
    '\',this.checked)"><span style="font-weight:700;font-size:var(--fs-2)">' +
    esc(r.name || 'Rule') +
    '</span></label>' +
    '<span data-cbsid="CMP011" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--disp);cursor:pointer" onclick="ruleDelete(\'' +
    esc(r.rule_id) +
    '\')">' +
    tx('Delete') +
    '</span></div>' +
    /* ⚠️ AT TRACK LEVEL A RULE MUST NAME ITS DESTINATION. "file here" is only meaningful standing inside the
       folder; in the all-rules list it would read as if every rule filed into the same place, which is the exact
       confusion this list exists to remove. */
    '<div style="font-size:var(--fs-2);margin-top:6px">When ' +
    terms +
    ' <span class=arw>→</span> ' +
    (_fldTrack() ? 'file into <b>📁 ' + esc(_fldFolderName(r.folder_id)) + '</b>' : 'file here') +
    '</div>' +
    /* Observability: a rule that quietly stopped matching should be visible, not assumed to be working. */
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
    (r.match_count
      ? txn('filed {count} chit', 'filed {count} chits', r.match_count) +
        (r.last_matched_at ? ' · ' + txf('last {date}', { date: esc(String(r.last_matched_at).slice(0, 10)) }) : '')
      : 'has not matched anything yet') +
    '</div></div>'
  );
}

/** the Rules tab body: the folder's rules, each with on/off and delete, and the draft form for a new one */
function _folderRulesPane() {
  if (_FLD.busy && _FLD.rules === null)
    return '<div style="padding:18px;color:var(--grey);font-size:var(--fs-2)"><span class="spin"></span> reading rules…</div>';
  var rules = _FLD.rules || [];
  var d = _FLD.draft;
  var out = '<div style="padding:14px 18px">';

  var _trk = _fldTrack();
  out +=
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.55;margin-bottom:10px">' +
    (_trk
      ? 'Every rule on <b>' +
        (_trk === 'order' ? 'Order' : 'Task') +
        '</b>, in the order they run. ' +
        '⚠️ Rules only conflict with <b>each other</b> — two folders both claiming supplier invoices is invisible from inside either one, which is why they are listed together here.'
      : 'A rule files <b>new arrivals</b> into this folder automatically. ') +
    ' ⚠️ It only <b>files</b> — it never changes a chit’s status, value or counterparty. Filing is a view on your own copy; anything more belongs to a person.' +
    (rules.length > 1
      ? ' They run <b>in the numbered order</b> and the first one that matches wins — the rest never see that chit. Use ↑ ↓ to change which rule gets first refusal.'
      : '') +
    '</div>';

  if (_FLD.rulesNote)
    out +=
      '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 11px;font-size:var(--fs-1);color:var(--warn-3);margin-bottom:9px">' +
      esc(_FLD.rulesNote) +
      '</div>';
  if (_FLD.err) out += '<div style="color:var(--disp);font-size:var(--fs-2);margin-bottom:8px">' + esc(_FLD.err) + '</div>';

  out += rules.length
    ? rules
        .map(function (item, index) {
          return _ruleRow(item, index, rules.length);
        })
        .join('')
    : '<div style="color:var(--grey);font-size:var(--fs-2);padding:6px 0 12px">No rules, all unfiled</div>';

  /* ⚠️ NO "ADD A RULE" AT TRACK LEVEL, and this is a real constraint rather than an omission: a rule's whole
     definition is "file into THIS folder", so from the track there is no destination to write down. Offering the
     button here would mean inventing a target folder on the user's behalf. Say where it lives instead. */
  if (_trk) {
    out +=
      '<div style="font-size:var(--fs-1);color:var(--grey);padding:4px 0 2px">Add rules inside folders</div>';
  } else if (!d) {
    out += '<button data-cbsid="SCR004-B02" class="composebtn" data-testid="rule-new" onclick="ruleDraftNew()">+ Add a rule</button>';
  } else {
    var opts = Object.keys(_RULE_HELP)
      .map(function (item) {
        return '<option value="' + item + '"' + (d.term === item ? ' selected' : '') + '>' + esc(item) + '</option>';
      })
      .join('');
    out +=
      '<div style="border:1px solid var(--line);border-radius:12px;padding:12px 13px;background:var(--paper);color:var(--on-bg)">' +
      '<div style="font-weight:700;font-size:var(--fs-2);margin-bottom:8px">' +
      tx('New rule') +
      '</div>' +
      '<input data-cbsid="SCR004-I02" class="inp" data-testid="rule-name" placeholder="Name it (optional) — e.g. Ramesh invoices" value="' +
      esc(d.name || '') +
      '" oninput="ruleDraftSet(\'name\',this.value)" style="margin-bottom:8px">' +
      '<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">' +
      '<span style="font-size:var(--fs-2)">' +
      tx('When') +
      '</span>' +
      '<select data-cbsid="SCR004-S01" class="inp" data-testid="rule-term" style="max-width:150px" onchange="ruleDraftSet(\'term\',this.value);_fldPaint()">' +
      opts +
      '</select>' +
      '<input data-cbsid="SCR004-I03" class="inp" data-testid="rule-value" style="flex:1;min-width:130px" placeholder="' +
      esc(_RULE_HELP[d.term] || '') +
      '" value="' +
      esc(d.val || '') +
      '" oninput="ruleDraftSet(\'val\',this.value)">' +
      '<span style="font-size:var(--fs-2)"><span class=arw>→</span> file here</span></div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">' +
      esc(_RULE_HELP[d.term] || '') +
      '</div>' +
      /* ⚠️ ONE TERM PER RULE, ON PURPOSE. Mixed AND/OR is what makes Outlook rules unpredictable past a handful:
         nobody can hold the precedence in their head, so the rule that fires is not the rule that was meant.
         Two conditions = two rules, in order — which is legible. */
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">One condition per rule<br>First match wins</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button data-cbsid="SCR004-B03" data-testid="rule-preview" onclick="rulePreview()" style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:9px 15px;font-size:var(--fs-2);font-weight:700;cursor:pointer;color:var(--on-card)">🔎 Preview matches</button>' +
      '<button data-cbsid="SCR004-B04" class="composebtn" data-testid="rule-save" onclick="ruleSave()">' +
      tx('Save rule') +
      '</button>' +
      '<button data-cbsid="CMP003" onclick="ruleDraftCancel()" style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:9px 15px;font-size:var(--fs-2);cursor:pointer;color:var(--grey)">' +
      tx('Cancel') +
      '</button></div>';

    if (_FLD.preview) {
      var p = _FLD.preview;
      out +=
        '<div style="margin-top:11px;border-top:1px dashed var(--line);padding-top:9px">' +
        '<div style="font-size:var(--fs-2);font-weight:700">' +
        p.matched +
        ' of your last ' +
        p.scanned +
        ' chits would have been filed here</div>' +
        (p.matched
          ? '<div style="margin-top:5px">' +
            p.sample
              .map(function (item) {
                return (
                  '<div style="font-size:var(--fs-1);padding:3px 0;border-top:1px solid #f0f2f4"><b>' +
                  esc(item.subject || '(no subject)') +
                  '</b> <span style="color:var(--grey)">· ' +
                  esc(item.counterparty || '—') +
                  ' · ' +
                  esc(String(item.created_at || '').slice(0, 10)) +
                  '</span></div>'
                );
              })
              .join('') +
            (p.matched > p.sample.length
              ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">…and ' + (p.matched - p.sample.length) + ' more</div>'
              : '') +
            '</div>'
          : '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:4px">⚠️ Nothing matched<br>Check the term</div>') +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
        txf('This is a preview only. Saving affects {new}; nothing already filed moves.', { new: '<b>' + tx('new arrivals') + '</b>' }) +
        '</div></div>';
    }
    out += '</div>';
  }
  return out + '</div>';
}
