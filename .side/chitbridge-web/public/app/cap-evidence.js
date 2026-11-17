/**
 * cap-evidence.js — CMP062 the Evidence chip and CMP063 the Evidence sheet: what stands behind a books row (ASA 500: the auditor vouches an entry to its source).
 * A chip on each Day book row says what is held: the files on its source document (Evidence 2), none yet (No file), no source document at all (No source: an opening balance, a receipt or a journal, so nothing to attach to; the firm, owner and adviser Day books paint a quiet dash there, not a pill), or, for a purchase that claims GST above the tax-invoice threshold with no file,
 * No tax invoice (a warning). A press opens the sheet: the source document (its number) and its files; a file opens in a new tab.
 *
 * OWNS      the chip html · the sheet · the one door a file is read through (GET /api/books/evidence/:id, with the seat's own headers, never cached)
 * CALLED BY cap-books.js (the owner's and the adviser's Day book) · books-grant-view.js (the auditor's Day book) · books-grant-drill.js (the entry sheet)
 * FLOW      use({ raw }) → ingest(entries) once per page (the server sent `evidence` on each entry: nothing is computed here) → chip(entry) in each row → a press → sheet(entry) → a file → raw(path) → a blob → a new tab
 * CARD      14-accounting/ACC-358-AUDIT-MARKERS-REQUIREMENT
 *
 * ⭐ The server decides: the flag, its sentence and its cite arrive in `entry.evidence`; this file paints them and works out no tax and no threshold. A file is fetched with the Bearer token and the seat's headers (X-Books-For for a firm),
 * so a revoked grant stops at the next press. Only images and PDFs open for viewing; everything else downloads (the server says the same).
 *
 *   CBEvidence.use({ raw(path) → Promise<Response> }) → { ingest(list) · chip(entry) · sheet(entry, { opener }) }
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var seen = {}; /* entry_id → { entry, ctl }: the entries the page ingested, so a press finds its row */

  function evidenceText(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  var EVIDENCE_WORDS = {
    flag: 'No tax invoice',
    none: 'No file',
    nodoc: 'No source',
    evidence: 'Evidence',
    head: 'Evidence for {no}',
    source: 'Source document',
    noSource: 'This entry has no source document (an opening balance, a receipt or a hand-keyed journal).',
    noFiles: 'No file is held on this document yet.',
    files: 'Files held',
    close: 'Close',
    open: 'Open',
    flagWhy: '{tax} is claimed on this purchase and no tax invoice is held on it.',
    rule: 'Rule read',
    failed: 'Could not open that file. Nothing was changed.',
    ended: 'Access to these books has ended.',
    claimOne: '{amount} of {box} is from 1 purchase with no tax invoice. You need the tax invoice to claim it.',
    claimMany: '{amount} of {box} is from {n} purchases with no tax invoice. You need the tax invoice to claim it.',
    claimRiskOne: '{amount}{kind} if the {n} purchase without a tax invoice is not claimed',
    claimRiskMany: '{amount}{kind} if the {n} purchases without a tax invoice are not claimed',
    claimBox: 'the tax you claim',
    claimSee: 'See them'
  };
  var EVIDENCE_CSS =
    '.ev{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line,#DDD6C6);border-radius:99px;background:var(--card,#fff);color:inherit;font:inherit;font-size:var(--fs-1,12px);font-weight:700;padding:3px 10px;min-height:28px;cursor:pointer;white-space:nowrap}' +
    '.ev:focus-visible{outline:2px solid var(--blue,#1f5fa8);outline-offset:2px}' +
    '.ev-ok{border-color:var(--ok,#2E8B57);color:var(--ok-3,#0F5132)}' +
    '.ev-warn{border-color:var(--warn,#B7791F);background:var(--warn-tint,#FFF4D6);color:var(--warn-3,#7A4B00)}' +
    '.ev-quiet{color:var(--grey,#5E594D);font-weight:600}' +
    'dialog.ev-sheet{border:1px solid var(--line,#DDD6C6);border-radius:14px;padding:0;width:min(520px,calc(100vw - 24px));max-height:calc(100vh - 24px);background:var(--card,#fff);color:var(--ink,#1D1B16)}' +
    'dialog.ev-sheet::backdrop{background:var(--scrim,rgba(0,0,0,.4))}' +
    '.ev-in{padding:14px 16px;display:flex;flex-direction:column;gap:10px}' +
    '.ev-hd{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}.ev-hd h2{margin:0;font-size:var(--fs-3,17px)}' +
    '.ev-x{border:0;background:transparent;font:inherit;font-size:20px;line-height:1;min-width:44px;min-height:44px;cursor:pointer;color:var(--grey,#5E594D)}' +
    '.ev-sub{font-size:var(--fs-1,12px);color:var(--grey,#5E594D)}' +
    '.ev-warnbox{border:1px solid var(--warn,#B7791F);background:var(--warn-tint,#FFF4D6);color:var(--warn-3,#7A4B00);border-radius:8px;padding:8px 10px;font-size:var(--fs-2,14px);font-weight:700}' +
    '.ev-warnbox small{display:block;font-weight:400;margin-top:4px;font-size:var(--fs-1,12px)}' +
    '.ev-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}' +
    '.ev-file{display:flex;gap:8px;align-items:center;justify-content:space-between;width:100%;box-sizing:border-box;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:inherit;font:inherit;font-size:var(--fs-2,14px);padding:8px 12px;min-height:44px;cursor:pointer;text-align:start}' +
    '.ev-file b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ev-file span{color:var(--grey,#5E594D);font-size:var(--fs-1,12px);white-space:nowrap}' +
    '.ev-out{font-size:var(--fs-1,12px);min-height:1em}.ev-out[data-tone=error]{color:var(--disp,#8E3517);font-weight:700}' +
    '@media (max-width:700px){.ev{min-height:44px;padding:3px 12px}}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !doc) return;
    cssDone = true;
    var node = doc.createElement('style');
    node.setAttribute('data-cbevidence', '1');
    node.textContent = EVIDENCE_CSS;
    (doc.head || doc.documentElement).appendChild(node);
  }
  function sizeWords(bytes) {
    var n = Number(bytes) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  }

  /** the chip's state from what the server sent: { key, rank, tone, word } (key = the Day book's Evidence filter; rank = its sort, the ones needing action first) */
  function stateOf(ev) {
    if (ev.flag === 'no_tax_invoice') return { key: 'flag', rank: 0, tone: 'warn', word: evidenceText(EVIDENCE_WORDS.flag), sym: '⚠' };
    if (ev.count > 0) return { key: 'held', rank: 3, tone: 'ok', word: evidenceText(EVIDENCE_WORDS.evidence) + ' ' + ev.count, sym: '📎' };
    if (ev.doc) return { key: 'none', rank: 1, tone: 'quiet', word: evidenceText(EVIDENCE_WORDS.none), sym: '○' };
    return { key: 'nodoc', rank: 2, tone: 'quiet', word: evidenceText(EVIDENCE_WORDS.nodoc), sym: '○' };
  }

  function useEvidence(cfg) {
    addCss();
    var control = {
      cfg: cfg || {},
      /** remember the page's entries (the rows the chips stand on) */
      ingest: function (list) {
        (list || []).forEach(function (entry) {
          if (entry && entry.entry_id) seen[String(entry.entry_id)] = { entry: entry, ctl: control };
        });
      },
      /** the chip for an entry (html); empty when the server sent no evidence (an older server) */
      chip: function (entry) {
        var ev = entry && entry.evidence;
        if (!ev || !entry.entry_id) return '';
        if (!seen[String(entry.entry_id)]) control.ingest([entry]);
        var s = stateOf(ev);
        return (
          '<button type="button" class="ev ev-' + s.tone + '" data-cbsid="CMP062-B01" data-ev-open="' + esc(entry.entry_id) + '" data-tone="' + s.tone + '" data-testid="ev-chip-' + esc(entry.entry_no || entry.entry_id) + '">' +
          '<span aria-hidden="true">' + s.sym + '</span> ' + esc(s.word) + '</button>'
        );
      },
      sheet: function (entry, o) {
        return openSheet(control, entry, o || {});
      }
    };
    return control;
  }

  /** the page a tab shows for a file: its name as the TITLE (a blob url alone would title the tab with a bare id) and the file in the browser's own viewer (a PDF in the PDF plugin, an image as an image) */
  function viewerPage(name, kind, fileUrl) {
    var label = esc(name || 'file');
    var body = kind === 'pdf' ? '<embed type="application/pdf" src="' + fileUrl + '">' : '<img alt="' + label + '" src="' + fileUrl + '">';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + label + '</title><style>html,body{margin:0;height:100%;background:var(--viewer-bg,#525659)}embed{width:100%;height:100%;display:block}img{max-width:100%;max-height:100%;display:block;margin:0 auto}</style></head><body>' + body + '</body></html>';
  }
  /** a link pressed on the page: the browser opens the tab itself, with no opener (a script that opens about:blank and sets its address later loses the blob: Chrome keys a blob url to the page that made it) */
  function pressLink(href, name, download) {
    var a = doc.createElement('a');
    a.href = href;
    a.rel = 'noopener noreferrer';
    if (download) a.download = name || 'file';
    else a.target = '_blank';
    (doc.body || doc.documentElement).appendChild(a);
    a.click();
    a.remove();
  }
  var alive = []; /* the blob urls of opened files: kept until this page goes, so a tab that is reloaded still finds its file (nothing is stored beyond the page) */
  if (root.addEventListener) root.addEventListener('pagehide', function () { alive.forEach(function (u) { try { root.URL.revokeObjectURL(u); } catch (failure) { if (root.cbQuiet) root.cbQuiet('evidence:revoke', failure); /* gone */ } }); alive = []; });

  /** open one file through the seat's own door: images and PDFs in a new tab titled with the file's name; anything else downloads */
  function openFile(control, file, out) {
    function fail(text) {
      out.setAttribute('data-tone', 'error');
      out.textContent = text;
    }
    out.removeAttribute('data-tone');
    out.textContent = '';
    return control.cfg.raw('/api/books/evidence/' + encodeURIComponent(file.id)).then(
      function (res) {
        if (!res.ok) return fail(res.status === 403 ? evidenceText(EVIDENCE_WORDS.ended) : evidenceText(EVIDENCE_WORDS.failed));
        return res.blob().then(function (blob) {
          var mime = String(blob.type || '').toLowerCase();
          var fileUrl = root.URL.createObjectURL(blob);
          alive.push(fileUrl);
          var kind = mime === 'application/pdf' ? 'pdf' : /^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime) ? 'image' : null;
          if (!kind) return pressLink(fileUrl, file.name, true);
          var page = root.URL.createObjectURL(new root.Blob([viewerPage(file.name, kind, fileUrl)], { type: 'text/html' }));
          alive.push(page);
          pressLink(page, file.name, false);
        });
      },
      function () { fail(evidenceText(EVIDENCE_WORDS.failed)); }
    );
  }

  /** the sheet's file list (or the no-files line when the entry has a source but no file; nothing when it has no source) */
  function filesHTML(evidence) {
    var files = (evidence.files || []).length
    ? '<ul class="ev-list" data-testid="ev-files">' + evidence.files.map(function (f, n) {
        return '<li><button type="button" class="ev-file" data-cbsid="CMP063-B02" data-ev-file="' + n + '" data-testid="ev-file-' + n + '"><b>' + esc(f.name) + '</b><span>' + esc(sizeWords(f.size)) + ' · ' + esc(evidenceText(EVIDENCE_WORDS.open)) + '</span></button></li>';
      }).join('') + '</ul>'
    : evidence.doc ? '<div class="ev-sub" data-testid="ev-nofiles">' + esc(evidenceText(EVIDENCE_WORDS.noFiles)) + '</div>' : '';
    return files;
  }
  /** the sheet's body: the flag's reason, where the entry's source is, and its files */
  function sheetHTML(evidence, no) {
    var flag = evidence.flag === 'no_tax_invoice' ? '<div class="ev-warnbox" role="status" data-testid="ev-flag">' + esc(evidence.flag_why || evidenceText(EVIDENCE_WORDS.flagWhy).replace('{tax}', (typeof packWord === 'function' && packWord('taxName')) || 'Tax')) + (evidence.cite ? '<small>' + esc(evidenceText(EVIDENCE_WORDS.rule)) + ': ' + esc(evidence.cite) + '</small>' : '') + '</div>' : '';
    var srcLine = evidence.doc ? '<div data-testid="ev-source"><b>' + esc(evidenceText(EVIDENCE_WORDS.source)) + '</b>: ' + esc(evidence.doc.ref || '') + '</div>' : '<div class="ev-sub" data-testid="ev-source">' + esc(evidenceText(EVIDENCE_WORDS.noSource)) + '</div>';
    var files = filesHTML(evidence);
    return (
      '<div class="ev-in"><div class="ev-hd"><h2 data-testid="ev-title">' + esc(evidenceText(EVIDENCE_WORDS.head).replace('{no}', no)) + '</h2>' +
      '<button type="button" class="ev-x" data-cbsid="CMP063-B01" data-ev-close="1" aria-label="' + esc(evidenceText(EVIDENCE_WORDS.close)) + '">✕</button></div>' +
      flag + srcLine + files + '<div class="ev-out" role="status" data-testid="ev-out"></div></div>'
    );
  }
  /** a press in the sheet closes it or opens a file; closing gives the focus back to the chip that opened it */
  function wireSheet(dialog, control, evidence, options) {
    var out = dialog.querySelector('.ev-out');
    dialog.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      if (t.hasAttribute('data-ev-close')) dialog.close();
      else if (t.hasAttribute('data-ev-file')) openFile(control, evidence.files[Number(t.getAttribute('data-ev-file'))], out);
    });
    dialog.addEventListener('close', function () {
      dialog.remove();
      if (options.opener && options.opener.focus) try { options.opener.focus(); } catch (failure) { if (root.cbQuiet) root.cbQuiet('evidence:focus', failure); /* the row repainted */ }
    });
    return out;
  }
  /** CMP063 the sheet */
  function openSheet(control, entry, options) {
    var evidence = entry && entry.evidence;
    if (!evidence) return null;
    addCss();
    var dialog = doc.createElement('dialog');
    dialog.className = 'ev-sheet';
    dialog.setAttribute('data-cbsid', 'CMP063-D01');
    dialog.setAttribute('data-pop', 'CMP063');
    dialog.setAttribute('data-testid', 'ev-sheet');
    var no = entry.entry_no || '';
    dialog.setAttribute('aria-label', evidenceText(EVIDENCE_WORDS.head).replace('{no}', no));
    dialog.innerHTML = sheetHTML(evidence, no);
    (doc.body || doc.documentElement).appendChild(dialog);
    wireSheet(dialog, control, evidence, options);
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    var first = dialog.querySelector('.ev-file') || dialog.querySelector('.ev-x');
    if (first) first.focus();
    return dialog;
  }

  /* a press on a chip, anywhere on the page: capture phase, so the row behind it does not also open */
  if (doc && !root.__cbEvidenceWired) {
    root.__cbEvidenceWired = true;
    doc.addEventListener(
      'click',
      function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-ev-open]') : null;
        if (!b) return;
        var hit = seen[b.getAttribute('data-ev-open')];
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        openSheet(hit.ctl, hit.entry, { opener: b });
      },
      true
    );
  }

  /**
   * the warning on a return: the server carried { count, tax_minor, box } (the Day book's own flag over the period, books-evidence.unsupportedIn) — this words it and adds nothing up.
   * money(minor) is the page's own formatter (it knows the currency). → { text, see } or null when no claimed tax is without its tax invoice.
   */
  function claimWarning(u, money) {
    if (!u || !(u.count > 0) || !(u.tax_minor > 0)) return null;
    addCss(); /* the warning band is painted by a page that has not opened the chip yet */
    var text = evidenceText(u.count === 1 ? EVIDENCE_WORDS.claimOne : EVIDENCE_WORDS.claimMany)
      .replace('{amount}', money(u.tax_minor))
      .replace('{box}', u.box ? u.box : evidenceText(EVIDENCE_WORDS.claimBox))
      .replace('{n}', String(u.count));
    return { text: text, see: evidenceText(EVIDENCE_WORDS.claimSee) };
  }

  /**
   * ACC-357 (W15-103): the money at risk on the To pay line. The server carried both figures (net_minor, and unsupported_input.net_if_unclaimed_minor — what the return would say if those
   * purchases are not claimed); this words them and adds nothing up. money(minor) is the page's formatter; netMinor is the return's own net. → "A$6,000.00 if the 2 purchases … are not claimed" or null.
   */
  function claimRisk(u, netMinor, money) {
    if (!u || !(u.count > 0) || u.net_if_unclaimed_minor == null) return null;
    var now = Number(u.net_if_unclaimed_minor),
      kind = now < 0 ? ' ' + evidenceText('refund') : netMinor < 0 ? ' ' + evidenceText('to pay') : '';
    return evidenceText(u.count === 1 ? EVIDENCE_WORDS.claimRiskOne : EVIDENCE_WORDS.claimRiskMany)
      .replace('{amount}', money(Math.abs(now)))
      .replace('{kind}', kind)
      .replace('{n}', String(u.count));
  }

  root.CBEvidence = { use: useEvidence, stateOf: stateOf, claimWarning: claimWarning, claimRisk: claimRisk, words: { flag: EVIDENCE_WORDS.flag, none: EVIDENCE_WORDS.none, nodoc: EVIDENCE_WORDS.nodoc, held: 'File attached' } };
})(typeof window !== 'undefined' ? window : globalThis);
