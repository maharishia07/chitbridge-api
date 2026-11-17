/**
 * OWNS      the "How we build" view of the Standards page (CAP-STD-1): the tab, its three count columns (pass · fail · not checked), the opened row, and the list of CIs
 *           behind each number. The numbers are read, never computed here: public/data/build-standards.json, written by the docs generator std-cmdb.cjs from the CMDB.
 * CALLED BY public/standards.html (the view item, cols(), the opened row, the sorts, the one fetch before the first paint).
 * FLOW      CBStdBuild.load() → BUILD → cols() paints the three counts (each a button with its own code) → a press opens the page's own #sheet with the CIs of that number.
 *           The popup is the library's ui.dialog (POP145); the page gives it modal() over its own <dialog>.
 *           The rows are the register's (cap-standards-build.js, kind 'build'); a standard the file does not know yet reads "not checked" everywhere.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/standards-register
 * Codes     STD001-B01 pass · STD001-B02 fail · STD001-B03 not checked (one code per column, like a list's header button); STD001-U05 the popup's mount.
 */
var CBStdBuild = (function () {
  var BUILD = null,
    ERROR = '';
  var KINDS = [
    ['pass', 'Pass', 'STD001-B01', '✓'],
    ['fail', 'Fail', 'STD001-B02', '✕'],
    ['not_checked', 'Not checked', 'STD001-B03', '○']
  ];
  /** the three counts of one standard code; a standard the generator has not seen is 0 / 0 / 0 and says so in the opened row */
  function countsOf(code) {
    var line = BUILD && BUILD.standards.filter(function (item) { return item.code === code; })[0];
    return line || null;
  }
  function figure(x, key) {
    var line = countsOf(x.r.id);
    return line ? line[key].length : 0;
  }
  function load() {
    return fetch('/data/build-standards.json', { cache: 'no-store' })
      .then(function (reply) {
        if (!reply.ok) throw new Error('HTTP ' + reply.status);
        return reply.json();
      })
      .then(
        function (json) {
          BUILD = json && Array.isArray(json.standards) && Array.isArray(json.cis) ? json : null;
          if (!BUILD) ERROR = 'The build counts are not in the right shape (data/build-standards.json).';
        },
        function () {
          ERROR = 'The build counts could not be read (data/build-standards.json) — the standards are complete; reload to try again.';
        }
      );
  }
  /** a count that opens its CIs: a real button (Tab reaches it, Enter and Space press it), the number and the word together, the code on the element */
  function countCell(key) {
    var kind = KINDS.filter(function (item) { return item[0] === key; })[0];
    return function (x) {
      var n = figure(x, key);
      return (
        '<button type="button" class="sbn sbn-' + key + '" data-sbk="' + key + '" data-sbid="' + esc(x.r.id) + '" data-cbsid="' + kind[2] + '" data-testid="std-build-' + key +
        '" aria-label="' + esc(kind[1] + ': ' + n + ' for ' + x.r.n + '. Show the list') + '"' + (n ? '' : ' disabled') + '><span aria-hidden="true">' + kind[3] + '</span> ' + n + '</button>'
      );
    };
  }
  function cols() {
    var base = [
      { key: 'what', label: 'How we hold ourselves to it', prio: 1, w: 210, sort: 'what', value: function (x) { return x.r.p; }, cell: function (x) { return x.r.p; } },
      { key: 'std', label: 'Reference', prio: 3, w: 190, sort: 'std', html: true, value: function (x) { return x.r.n; }, cell: sourceCell }
    ];
    var counts = KINDS.map(function (kind, index) {
      return { key: 'sb' + index, label: kind[1], pin: 'end', w: 84, sort: 'sb' + index, html: true, value: function (x) { return figure(x, kind[0]); }, cell: countCell(kind[0]) };
    });
    return base.concat(counts);
  }
  function scopeWords(row) {
    return row.sc.map(function (code) { return (STD_BUILD_SCOPES.filter(function (item) { return item[0] === code; })[0] || [code, code])[1]; }).join(' · ');
  }
  /** the source: a link when it is an address, plain words when it is one of our own documents */
  function sourceCell(x) {
    var link = /^https?:\/\//.test(x.r.src) ? '<a href="' + esc(x.r.src) + '" target="_blank" rel="noopener" data-testid="std-build-src">' + esc(x.r.n) + '</a>' : esc(x.r.n);
    return '<span class="sn" title="' + esc(x.r.src) + '">' + link + '</span>';
  }
  /** the sorts of the three count columns (the page adds them to SORTS) */
  var sorts = KINDS.map(function (kind, index) {
    return { key: 'sb' + index, label: kind[1], cmp: function (a, b) { return figure(a, kind[0]) - figure(b, kind[0]); } };
  });
  /** what an opened row says: the rule, the source, the check in words, and the three numbers with the date they were read */
  function next(x) {
    var r = x.r, line = countsOf(r.id), h = '<dl class="sd" data-testid="std-build-detail-' + esc(r.id) + '">';
    h += '<dt>The rule</dt><dd>' + esc(r.rule) + '</dd>';
    h += '<dt>Source</dt><dd>' + (/^https?:\/\//.test(r.src) ? '<a href="' + esc(r.src) + '" target="_blank" rel="noopener">' + esc(r.src) + '</a>' : esc(r.src)) + '</dd>';
    if (r.src2) h += '<dt>Also</dt><dd><a href="' + esc(r.src2) + '" target="_blank" rel="noopener">' + esc(r.src2) + '</a></dd>';
    h += '<dt>The check</dt><dd>' + esc(r.chk) + '</dd>';
    h += '<dt>Applies to</dt><dd>' + esc(scopeWords(r)) + '</dd>';
    h += '<dt>In the CMDB</dt><dd data-testid="std-build-counts">' + (line ? KINDS.map(function (kind) { return line[kind[0]].length + ' ' + kind[1].toLowerCase(); }).join(' · ') + (line.na ? ' · ' + line.na + ' not applicable' : '') + ' · read ' + esc(BUILD.generated) : 'no count yet for this standard') + '</dd>';
    return h + '</dl>';
  }
  function ciRows(line, key) {
    return line[key].map(function (index) { return BUILD.cis[index]; });
  }
  /** the CIs behind one number, in the library dialog (POP145) */
  function openList(code, key) {
    var line = countsOf(code), row = STANDARDS.filter(function (item) { return item.id === code; })[0], kind = KINDS.filter(function (item) { return item[0] === key; })[0], host = document.getElementById('sheet');
    if (!line || !row || !host) return;
    var list = ciRows(line, key);
    ui.dialog({
      mount: 'STD001-U05',
      pop: 'POP145',
      titleText: row.n + ' · ' + kind[1] + ' (' + list.length + ')',
      testid: 'std-sheet-build',
      body: '<div class="sbl-box" tabindex="0" role="region" aria-label="' + esc(row.n + ' · ' + kind[1]) + '"><p class="hint">' + esc(row.chk) + '</p><ul class="sbl" data-testid="std-build-cis">' +
        list.map(function (item) { return '<li><code>' + esc(item[0]) + '</code> <span class="hint">' + esc(item[1]) + '</span></li>'; }).join('') + '</ul></div>',
      actions: [{ name: 'close', options: { mount: 'STD001-U05' } }]
    });
  }
  document.addEventListener('click', function (event) {
    var node = event.target.closest && event.target.closest('[data-sbk]');
    if (node) openList(node.getAttribute('data-sbid'), node.getAttribute('data-sbk'));
  });
  var viewTab = { key: 'how-we-build', label: 'How we build', filt: { kind: 'build-rule' }, tip: 'Every standard we build to: its source, the check that proves it, and how many CMDB items pass, fail or are not yet checked' };
  return {
    load: load, cols: cols, next: next, sorts: sorts, tab: viewTab, openList: openList, defaultCols: ['what', 'std', 'sb0', 'sb1', 'sb2'],
    error: function () { return ERROR; },
    on: function (filt) { return filt && filt.kind === 'build-rule'; }
  };
})();
