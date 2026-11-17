/**
 * books-practice-band.js — l16/firm-dash part of books-practice.js: the Practice band over the client list.
 *
 * OWNS      the band of counts (each tile a filter), its pictures (status and year-end bars), the year-on-year compare strip and the rule in words
 * CALLED BY books-practice.js (through root.CBPracticeKit); loaded before it
 * FLOW      practiceKit.bandHTML(data) → the band's html from the server's counts; practiceKit.compareHTML(data) → the compare strip
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Decides nothing and computes nothing: every count, status and word is the server's.
 */
(function (root) {
  'use strict';
  var practiceKit = (root.CBPracticeKit = root.CBPracticeKit || {});
  practiceKit.stageWord = stageWord;
  practiceKit.bandShown = bandShown;
  practiceKit.pictureHTML = pictureHTML;
  practiceKit.compareHTML = compareHTML;
  practiceKit.pairHTML = pairHTML;
  practiceKit.stripHTML = stripHTML;
  practiceKit.bandHTML = bandHTML;
  practiceKit.ruleHTML = ruleHTML;
  practiceKit.bandNow = bandNow;
  practiceKit.STATUS_CLASS = { help: 'red', watch: 'amber', good: 'green', none: '' };
  /* REP-73: the bands are the server's (data.band.bands, in its order, the first one open); the page knows each tile's WORDS and the list filter it opens, never which band comes first, which tile is hidden or a count.
     tile key → [label, the filter it opens]; every count is the size of that filter on the list (the server counts them from the same rows). */
  var BAND_NAME = { pipeline: 'Year end', on_us: 'On us today', advisory: 'Advice' };
  /* REP-73 B6: ONE name per stage, on the tile, the filter chip, the filter's choices and the row. The last two stages say what the firm's country calls filing the return: the server sends them
     (lib/books-practice words, from the country pack's filingVerb: lodge · file); until it does the neutral words stand. Never a country branch here. */
  var STAGE_WORDS = { books_in: 'Books in', complete: 'Complete', checked: 'Checked', ready: 'Ready to file', lodged: "Filed (owner's word)" };
  function stageWord(key) {
    var w = (practiceKit.practiceState.data && practiceKit.practiceState.data.words) || {};
    return key === 'ready' && w.ready ? w.ready : key === 'lodged' && w.done ? w.done : STAGE_WORDS[key] || key;
  }
  var TILE = {
    books_in: ['Books in', { stage: 'books_in' }], complete: ['Complete', { stage: 'complete' }], checked: ['Checked', { stage: 'checked' }], ready: ['Ready to file', { stage: 'ready' }], lodged: ["Filed (owner's word)", { stage: 'lodged' }],
    bas_due_30: ['Due in 30 days', { bas: 'soon' }],
    changed: ['Clients with changes since I checked', { changed: 'yes' }], /* rank 10: the server's count of clients with entries posted since THIS person said checked; the tile only filters, never re-sorts */
    queries_on_us: ['Queries on us', { queries: 'us' }], queries_over_14: ['Waiting over 14 days', { queries: 'over14' }], bank_unexplained: ['Bank not explained', { bank: 'unexplained' }], to_check: ['Clients with entries to check (quarter)', { checked: 'behind' }], months_unlocked: ['Clients with months to lock', { unlocked: 'yes' }],
    cash_low: ['Cash running low', { advice: 'cash_low' }], sales_down: ['Sales down', { advice: 'sales_down' }], loss: ['Making a loss', { advice: 'loss' }], late_debtors: ['Late debtors', { advice: 'late_debtors' }]
  };
  function sameFilter(f, g) {
    return !!f && !!g && JSON.stringify(f) === JSON.stringify(g);
  }
  /** the band shown: the one the person chose, else the one the server opened first */
  function bandShown(data) {
    var bands = (data.band && data.band.bands) || [];
    return bands.filter(function (x) { return x.key === practiceKit.practiceState.band; })[0] || bands.filter(function (x) { return x.first; })[0] || bands[0] || null;
  }
  /* REP-66 (practice pictures, Athi 16 Nov): ONE small picture per band, drawn by CBDraw (the one chart helper), inside the tile grid's own free cell so the list never moves down.
     Every figure is a tile's n (the server's count); the picture adds nothing of its own and never invents a part: a tile with no count is left out. Its text equivalent is the svg <desc>
     and the visible caption under it. Year end: clients by CURRENT stage (the tiles sum to the clients). On us today: the work left, each part labelled in its own unit. */
  var PICTURES = {
    pipeline: { id: 'bp-pic-stage', title: 'Clients by year-end stage', unit: 'clients', parts: [['books_in', 'help'], ['complete', 'watch'], ['checked', 'watch'], ['ready', 'good'], ['lodged', 'good']] },
    on_us: { id: 'bp-pic-left', title: 'Work left on us', unit: '', parts: [['bank_unexplained', 'help'], ['to_check', 'watch'], ['months_unlocked', 'watch']] }
  };
  function picParts(shown, spec) {
    var byKey = {};
    shown.tiles.forEach(function (t) { byKey[t.key] = t; });
    return spec.parts.filter(function (p) { var t = byKey[p[0]]; return TILE[p[0]] && t && typeof t.n === 'number' && t.n > 0; }).map(function (p) {
      var n = byKey[p[0]].n, word = practiceKit.translate(STAGE_WORDS[p[0]] ? stageWord(p[0]) : TILE[p[0]][0]);
      return { kind: p[1], value: n, label: word + ': ' + n, key: p[0] };
    });
  }
  /* E17 (Athi 2 Nov: a code on every element): the practice pictures are on Home (HOM001), kind P = panel; CBDraw writes whichever codes it is passed (opts.codes). The same code on every part of a kind, as a tile row shares its code. */
  var PIC_CODES = { status: { chart: 'HOM001-P01', part: 'HOM001-P02', legend: 'HOM001-P03' }, strip: { chart: 'HOM001-P05', part: 'HOM001-P06', legend: 'HOM001-P07' },
    cmp: { chart: 'HOM001-P09', part: 'HOM001-P10', legend: 'HOM001-P11' }, pair: { chart: 'HOM001-P13', part: 'HOM001-P10', legend: 'HOM001-P11' } };
  /** the picture's colours for the theme on screen now (good / watch / bad have a dark set), measured by CBDraw itself; none when CBDraw cannot read the page */
  function paletteHere() {
    try { return root.CBDraw.paletteNow(null, root.document.getElementById('bp_practice') || root.document.documentElement); } catch (failure) { if (root.cbQuiet) root.cbQuiet('practice:palette', failure); return undefined; }
  }
  function pictureHTML(shown) {
    var spec = PICTURES[shown.key];
    if (!spec || !root.CBDraw) return '';
    var parts = picParts(shown, spec);
    if (!parts.length) return '';
    var narrow = root.innerWidth && root.innerWidth <= 700;
    var svg = root.CBDraw.statusBar(parts, { palette: paletteHere(), width: narrow ? 112 : 200, id: spec.id, tid: spec.id, codes: PIC_CODES.status, title: practiceKit.translate(spec.title), desc: parts.map(function (p) { return p.label; }).join(', ') });
    var total = parts.reduce(function (sum, p) { return sum + p.value; }, 0);
    return '<div class="bp-pic" style="--pw:' + (narrow ? 99 : 176) + '" data-testid="practice-pic" data-pic="' + practiceKit.escapeHtml(shown.key) + '" data-total="' + total + '">' + svg + '<span class="sub" data-cbsid="HOM001-P04" data-testid="practice-pic-count">' + practiceKit.escapeHtml(spec.unit ? total + ' ' + practiceKit.translate(spec.unit) : parts.map(function (p) { return p.value; }).join(' · ')) + '</span></div>';
  }
  /* REP-66b (year on year, Athi 16 Nov): sales this year to date against the same dates last year, drawn by CBDraw.compare from the figures the server carried on each client's health
     (sales_ytd_minor, sales_prev_ytd_minor, sales_yoy_pct, the dates and sales_yoy_state). This page adds, subtracts and divides nothing: it picks the rows by state, orders them by the carried change and prints
     money through minorText(). A client whose books stop early, whose last year is short or absent, or who holds two currencies is never ranked; the opened row says why in words. */
  var YOY_WORDS = { stale: 'Books in to', short_last_year: 'No full last year yet', no_last_year: 'No last year to compare yet', mixed: 'Two currencies: not compared' };
  function yoyDates(h) {
    return h && h.sales_yoy_from ? practiceKit.dayWords(h.sales_yoy_from) + ' – ' + practiceKit.dayWords(h.sales_yoy_to) + ' / ' + practiceKit.dayWords(h.sales_prev_from) + ' – ' + practiceKit.dayWords(h.sales_prev_to) : '';
  }
  function yoyWords(h) {
    var w = YOY_WORDS[h.sales_yoy_state];
    return w ? practiceKit.translate(w) + (h.sales_yoy_state === 'stale' ? ' ' + practiceKit.dayWords(h.sales_through) : '') : '';
  }
  function yoyRow(r) {
    var h = r.health, cur = r.currency;
    return { label: r.name || String(r.entity_id).slice(0, 8), now: h.sales_ytd_minor, before: h.sales_prev_ytd_minor, changePct: h.sales_yoy_pct, state: h.sales_yoy_state,
      title: (r.name || '') + ' · ' + practiceKit.money(h.sales_ytd_minor, cur) + ' ' + practiceKit.translate('this year') + ' · ' + practiceKit.money(h.sales_prev_ytd_minor, cur) + ' ' + practiceKit.translate('last year') + ' · ' + yoyDates(h) };
  }
  /** chart 1: the listed clients whose sales fell most and rose most (only state ok; the bar is the carried change), the caption says how many of the list it shows */
  function yoyRanked(clients) {
    var ok = clients.filter(function (r) { return r.health && r.health.sales_yoy_state === 'ok' && r.health.sales_yoy_pct != null; });
    var by = function (sign) { return function (a, b) { return sign * (a.health.sales_yoy_pct - b.health.sales_yoy_pct); }; };
    return { fall: ok.filter(function (r) { return r.health.sales_yoy_pct < 0; }).sort(by(1)), rise: ok.filter(function (r) { return r.health.sales_yoy_pct > 0; }).sort(by(-1)) };
  }
  /** one ranked list of the compare strip drawn by CBDraw (nothing when the list is empty) */
  function compareList(list, id, title, view) {
    var take = view.take;
    return list.length ? root.CBDraw.compare(list.slice(0, take).map(yoyRow), { palette: view.palette, codes: PIC_CODES.cmp, width: view.narrow ? 280 : 250, labelW: view.narrow ? 92 : 80, id: id, tid: id, title: practiceKit.translate(title), desc: practiceKit.translate(title) + ': ' + list.slice(0, take).map(function (r) { return yoyRow(r).title; }).join('; ') }) : '';
  }
  /** how the compare strip is drawn on this screen: two rows a list on a phone (falls only), three otherwise, in the theme's palette */
  function compareView() {
    var narrow = !!(root.innerWidth && root.innerWidth <= 700);
    return { take: narrow ? 2 : 3, narrow: narrow, palette: paletteHere() };
  }
  /** how many clients the strip names */
  function shownCount(ranked, view) {
    return Math.min(view.take, ranked.fall.length) + (view.narrow ? 0 : Math.min(view.take, ranked.rise.length));
  }
  function compareHTML(data) {
    var clients = data.clients || [];
    if (!root.CBDraw || !root.CBDraw.compare || !clients.length) return '';
    var view = compareView(), narrow = view.narrow, ranked = yoyRanked(clients);
    var first = clients.filter(function (r) { return r.health && r.health.sales_yoy_from; })[0];
    var svgs = compareList(ranked.fall, 'bp-cmp-fall', 'Sales down most on last year', view) + (narrow ? '' : compareList(ranked.rise, 'bp-cmp-rise', 'Sales up most on last year', view));
    if (!svgs) return '';
    var shown = shownCount(ranked, view);
    return '<div class="bp-cmp" data-testid="practice-cmp" data-shown="' + shown + '" data-listed="' + clients.length + '"><span class="sub" data-cbsid="HOM001-P12" data-testid="practice-cmp-caption">' + practiceKit.escapeHtml(practiceKit.translate('Sales to date vs last year') + (first ? ' · ' + practiceKit.dayWords(first.health.sales_yoy_from) + ' – ' + practiceKit.dayWords(first.health.sales_yoy_to) : '') + ' · ' + shown + ' ' + practiceKit.translate('of') + ' ' + clients.length + ' ' + practiceKit.translate('clients listed')) + '</span><div class="bp-cmp-row">' + svgs + '</div></div>';
  }
  /** chart 2: this client's pair in the opened row, with the figures in words under it and the reason when there is no change */
  function pairHTML(r) {
    var h = r.health;
    if (!root.CBDraw || !root.CBDraw.compare || !h || h.sales_ytd_minor == null || !h.sales_yoy_state) return '';
    var row = yoyRow(r), reason = yoyWords(h);
    row.label = practiceKit.translate('Sales');
    var svg = root.CBDraw.compare([row], { palette: paletteHere(), codes: PIC_CODES.pair, mode: 'money', width: 340, labelW: 60, id: 'bp-pair-' + String(r.entity_id).slice(0, 8), tid: 'practice-pair-' + r.entity_id, title: practiceKit.translate('Sales this year and last year'), desc: row.title });
    return '<div class="bp-pair" data-testid="practice-pair-box-' + practiceKit.escapeHtml(r.entity_id) + '">' + svg + '<span class="sub" data-cbsid="HOM001-P14" data-testid="practice-pair-words-' + practiceKit.escapeHtml(r.entity_id) + '">' + practiceKit.escapeHtml(practiceKit.money(h.sales_ytd_minor, r.currency) + ' ' + practiceKit.translate('this year') + ' · ' + practiceKit.money(h.sales_prev_ytd_minor, r.currency) + ' ' + practiceKit.translate('last year') + (reason ? ' · ' + reason : '')) + '</span></div>';
  }
  /* REP-66: the opened row's months. The server's year_end carries how many months of the year are locked (the Month lock page's one rule, locked oldest first), so the first `locked` squares are locked and the rest open: no second read, no count made here. */
  function monthWords(y) {
    var start = String(y.start || '').slice(0, 7).split('-'), year = Number(start[0]), month = Number(start[1]) - 1, out = [];
    if (!year || month < 0) return null;
    for (var i = 0; i < y.of; i++) {
      var d = new Date(Date.UTC(year, month + i, 1));
      out.push({ label: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(d), state: i < y.locked ? 'locked' : 'open' });
    }
    return out;
  }
  function stripHTML(r) {
    var y = r.year_end, months = y && !y.first_year && y.of > 0 ? monthWords(y) : null;
    if (!months || !root.CBDraw) return '';
    var words = { locked: practiceKit.translate('locked'), open: practiceKit.translate('open'), running: practiceKit.translate('running') };
    var svg = root.CBDraw.monthStrip(months, { id: 'bp-strip-' + String(r.entity_id).slice(0, 8), tid: 'practice-strip-' + r.entity_id, title: practiceKit.translate('Months locked'), codes: PIC_CODES.strip, words: words, labels: true, palette: paletteHere() });
    return '<div class="bp-strip" data-testid="practice-strip-box-' + practiceKit.escapeHtml(r.entity_id) + '">' + svg + '<span class="sub" data-cbsid="HOM001-P08" data-testid="practice-strip-count-' + practiceKit.escapeHtml(r.entity_id) + '">FY' + practiceKit.escapeHtml(String(y.fy).replace(/^dd(dd)/, '$1')) + ' · ' + practiceKit.escapeHtml(y.locked) + ' ' + practiceKit.escapeHtml(practiceKit.translate('of')) + ' ' + practiceKit.escapeHtml(y.of) + ' ' + practiceKit.escapeHtml(practiceKit.translate('months locked')) + '</span></div>';
  }
  /* A3P rank 6: the entries tile counts the work: the entries to check (the server's tile.entries), with the clients behind in its words; every other tile is its n. The filter under the tile is unchanged: its rows are the n clients. */
  function tileFigure(t) {
    return t.key === 'to_check' && typeof t.entries === 'number' ? Number(t.entries).toLocaleString() : t.n;
  }
  function tileWords(t, def) {
    if (t.key === 'to_check' && typeof t.entries === 'number') return practiceKit.translate('Entries to check') + ' · ' + t.n + ' ' + practiceKit.translate(t.n === 1 ? 'client' : 'clients');
    return practiceKit.translate(STAGE_WORDS[t.key] ? stageWord(t.key) : def[0]);
  }
  function bandHTML(data) {
    var bands = (data.band && data.band.bands) || [], shown = bandShown(data);
    if (!shown) return '';
    var tabs = bands.length > 1 ? '<div class="bp-bands" role="tablist" aria-label="' + practiceKit.escapeHtml(practiceKit.translate('Practice bands')) + '">' + bands.map(function (x) {
      return '<button type="button" role="tab" class="bp-bandtab' + (x.key === shown.key ? ' on' : '') + '" aria-selected="' + (x.key === shown.key) + '" data-cbsid="CMP036-D01" data-bp-band="' + practiceKit.escapeHtml(x.key) + '" data-testid="practice-band-' + practiceKit.escapeHtml(x.key) + '">' + practiceKit.escapeHtml(practiceKit.translate(BAND_NAME[x.key] || x.key)) + '</button>';
    }).join('') + '</div>' : '';
    var tiles = shown.tiles.filter(function (t) { return TILE[t.key]; }).map(function (t) {
      var def = TILE[t.key], on = sameFilter(practiceKit.practiceState.filter, def[1]);
      return '<button type="button" class="bp-tile ' + practiceKit.escapeHtml(t.key) + (on ? ' on' : '') + '" data-cbsid="CMP060-D01" data-bp-filter="' + practiceKit.escapeHtml(JSON.stringify(def[1])) + '" aria-pressed="' + on + '"' + (t.key === 'lodged' ? ' title="' + practiceKit.escapeHtml(practiceKit.translate('Marked lodged by the owner: the returns were lodged outside these books, on the owner’s word')) + '"' : '') + ' data-testid="practice-tile-' + practiceKit.escapeHtml(t.key) + '"><b>' + practiceKit.escapeHtml(tileFigure(t)) + '</b><span>' + practiceKit.escapeHtml(tileWords(t, def)) + '</span></button>';
    }).join('');
    var note = shown.costs_not_shared ? '<p class="bp-note sub" data-testid="practice-costs-note">' + practiceKit.escapeHtml(shown.costs_not_shared) + ' ' + practiceKit.escapeHtml(practiceKit.translate('clients: costs not shared')) + '</p>' : '';
    return '<div class="bp-bandbox" data-testid="practice-band" data-band="' + practiceKit.escapeHtml(shown.key) + '" role="group" aria-label="' + practiceKit.escapeHtml(practiceKit.translate('Practice counts')) + '">' + tabs + '<div class="bp-band">' + tiles + (shown.key === 'advisory' ? compareHTML(data) : '') + '</div>' + note + '</div>';
  }
  function ruleHTML(rule) {
    return (
      '<p class="bp-rule sub" data-testid="practice-rule">' + practiceKit.escapeHtml(practiceKit.translate('Needs help')) + ': ' + practiceKit.escapeHtml(practiceKit.translate('cash under')) + ' ' + rule.help.cash_days_below + ' ' + practiceKit.escapeHtml(practiceKit.translate('days of bills')) + ', ' + practiceKit.escapeHtml(practiceKit.translate('sales down')) + ' ' + rule.help.sales_down_pct + '%, ' + practiceKit.escapeHtml(practiceKit.translate('loss')) + ' ' + rule.help.loss_months_running + ' ' + practiceKit.escapeHtml(practiceKit.translate('months running')) +
      '. ' + practiceKit.escapeHtml(practiceKit.translate('Watch')) + ': ' + practiceKit.escapeHtml(practiceKit.translate('sales down')) + ' ' + rule.watch.sales_down_pct + '%, ' + practiceKit.escapeHtml(practiceKit.translate('loss this quarter')) + '. ' + practiceKit.escapeHtml(practiceKit.translate('The firm can change this.')) + '</p>'
    );
  }
  /** the band on screen now: the server's first one until a tab is pressed */
  function bandNow() {
    return (practiceKit.practiceState.data && bandShown(practiceKit.practiceState.data) || {}).key || 'pipeline';
  }
})(typeof window !== 'undefined' ? window : globalThis);
