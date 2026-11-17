/**
 * public/app/shell-facts.js — CBShell Home: how the cards' facts are read and how the areas lead by them
 *
 * OWNS      the cards' read queue (FACTS_PARALLEL at a time, a SERVER_BUSY asked again after the server's Retry-After) · one ask per card URL per page load · the areas' order by the data (leadByData) · a firm's lazy read (whenSeen) · isFirm and practiceFirst; moved out of shell.js mount() (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY app/shell.js (mount → CBShellFacts.create(ctx) once per mount; loaded by every page that loads shell.js, on the line before it) · tests/firm-home-budget.test.cjs
 * FLOW      create(ctx) → read(onlyId) waits for the practice → each built card with a facts URL → once(url) → queue → get(url) → paintFacts draws the card's lines and trend → leadByData orders the areas once every card has answered
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/shell
 *
 * Decides nothing about money or access: it asks the URLs the manifest names and paints what shell.js's own painters make of the answers.
 */
(function (root) {
  'use strict';
  /* l16 home-fix: the api sheds over its in-flight cap (503 SERVER_BUSY; pool 10 x 1.6 = 16) and Home asked for ~20 cards at once, so the cards read "—" on every load. */
  var FACTS_PARALLEL = 4,
    FACTS_RETRIES = 3;
  /* R-HOME (l16 polish g): Labs and Setup stay last whatever the data says */
  var LEAD_LAST = { labs: 1, setup: 1 };

  /* the practice read comes first (books-practice.js settled): a firm's Home hides the shop cards and asks only for the cards it draws */
  function practiceFirst() {
    return root.CBPractice && root.CBPractice.settled ? root.CBPractice.settled() : root.Promise.resolve();
  }
  function isFirm() {
    return !!(root.CBPractice && root.CBPractice.isFirm && root.CBPractice.isFirm());
  }

  /** how an area ranks: needs you (2) over in use (1) over not started (0); Money, once it holds any money fact, leads outright (R48 + the 30-second rule); Labs and Setup last */
  function areaScore(sec) {
    var area = sec.getAttribute('data-area');
    if (LEAD_LAST[area]) return -1;
    var rank = sec.querySelector('[data-state="needs_you"]') ? 2 : sec.querySelector('[data-state="in_use"]') ? 1 : 0;
    return area === 'money' && rank ? 30 : rank * 10; /* the books hold money facts -> Money leads, by the data and not by trade */
  }
  /** the areas lead by the DATA, not the trade; stable: areas the data does not tell apart keep the manifest's order; set ONCE, when every card has answered or failed */
  function leadByData(ctx) {
    var holder = ctx.$('.cbsh-more');
    if (!holder) return;
    if (isFirm()) return; /* l16 firmhome: a firm's Home is led by its practice and reads cards as they come into view, so the areas are not reshuffled under the reader */
    if (ctx.running || ctx.queue.length) return; /* a card that is still waiting (or was shed) must not reshuffle the sections per load */
    var secs = [].slice.call(holder.querySelectorAll(':scope > .cbsh-sec'));
    var ordered = secs
      .map(function (sec, index) { return { sec: sec, index: index, score: areaScore(sec) }; })
      .sort(function (first, second) { return second.score - first.score || first.index - second.index; });
    if (ordered.some(function (item, index) { return item.sec !== secs[index]; })) ordered.forEach(function (item) { holder.appendChild(item.sec); });
  }

  /** one card read; a SERVER_BUSY is asked again after the server's own Retry-After (at most FACTS_RETRIES times) */
  function factsGet(ctx, url, left) {
    return ctx.get(url).catch(function (err) {
      if (!err || err.status !== 503 || !(left > 0)) throw err;
      return new Promise(function (go) {
        root.setTimeout(go, (err.retryAfter || 2) * 1000);
      }).then(function () {
        return factsGet(ctx, url, left - 1);
      });
    });
  }
  /** the cards are read FACTS_PARALLEL at a time; the last one to finish lets the areas lead by the data */
  function factsNext(ctx) {
    while (ctx.running < FACTS_PARALLEL && ctx.queue.length) {
      var queued = ctx.queue.shift();
      ctx.running += 1;
      factsGet(ctx, queued.url, FACTS_RETRIES).then(queued.ok, queued.no).then(function () {
        ctx.running -= 1;
        factsNext(ctx);
        if (!ctx.running && !ctx.queue.length) leadByData(ctx);
      });
    }
  }
  function factsRead(ctx, url) {
    return new Promise(function (ok, no) {
      ctx.queue.push({ url: url, ok: ok, no: no });
      factsNext(ctx);
    });
  }
  /* l16 firmhome: ONE ask per card URL per page load (several cards share a URL, and Home draws its areas again once the practice has answered); a failed ask is forgotten so the next paint asks again */
  function factsOnce(ctx, url) {
    if (!ctx.cache[url])
      ctx.cache[url] = factsRead(ctx, url).catch(function (err) {
        delete ctx.cache[url];
        throw err;
      });
    return ctx.cache[url];
  }

  /* a firm's Home asks a card's facts when the card comes into view (the practice fills the first screen; the cards are below it, or on another phone tab): a card nobody has scrolled to is not asked for */
  function whenSeen(spot, fn) {
    var observer = new root.IntersectionObserver(
      function (list) {
        if (!list.some(function (item) { return item.isIntersecting; })) return;
        observer.disconnect();
        fn();
      },
      { rootMargin: '100px' }
    );
    observer.observe(spot);
  }
  /** a card's answer into its spot: its lines, its state badge and trend; a failed read says so with a dash */
  function paintFacts(ctx, card, spot) {
    factsOnce(ctx, card.facts)
      .then(function (reply) {
        var lines = (reply && reply.lines) || [],
          state = ctx.noteNeeds(card, ctx.cardState(reply, lines), ctx.routeOf);
        ctx.paintBadges(ctx.el);
        spot.innerHTML = ctx.factsHTML(card, lines, state, ctx.lineHTML) + ctx.trendHTML(reply && reply.figures && reply.figures.trend);
        leadByData(ctx);
      })
      .catch(function () {
        spot.innerHTML = '<span class="f" title="' + esc(ctx.W.factsFailed) + '">—</span>';
      });
  }
  /** read every built card's facts (or one card's, onlyId), after the practice has answered; a firm's cards are read when they come into view */
  function readFacts(ctx, onlyId) {
    if (!ctx.person || !ctx.S.manifest) return;
    (onlyId ? root.Promise.resolve() : practiceFirst()).then(function () {
      var lazy = !onlyId && isFirm() && !!root.IntersectionObserver;
      ctx.shown().forEach(function (card) {
        if (!card || card.state !== 'built' || !card.facts || (onlyId && card.id !== onlyId)) return;
        var spot = ctx.$('[data-testid="shell-facts-' + card.id + '"]');
        if (!spot) return;
        if (lazy)
          whenSeen(spot, function () {
            paintFacts(ctx, card, spot);
          });
        else paintFacts(ctx, card, spot);
      });
    });
  }


  /* the words and translator shell.js hands over once (painters): the cards' painters below read them */
  var wording, translate;
  /* ── a Home card's STATE (walk 17 Oct, Athi: "represent the status, active / not active") ── the server's facts `state` when it says;
     until every card does, a line marked tone 'dn' is needs_you and any other line in_use; no lines, no state */
  function cardState(answer, lines) {
    if (answer && wording.state[answer.state]) return answer.state;
    if (!lines.length) return '';
    return lines.some(function (line) {
      return line && line.tone === 'dn';
    })
      ? 'needs_you'
      : 'in_use';
  }
  function stateHTML(state) {
    return (
      '<span class="st ' +
      state +
      '" data-testid="shell-state" data-state="' +
      state +
      '">' +
      (state === 'not_started' ? '○ ' : '● ') +
      esc(translate(wording.state[state])) +
      '</span>'
    );
  }
  /* a card's facts on its tile: NOT STARTED says so and invites (never "No X yet" — the tile is already the link); otherwise ONE line, and
     two or more → a +n badge with every line in the drop-down (.more) */
  function factsHTML(card, lines, state, nestedLineHTML) {
    var badge = state ? stateHTML(state) : '';
    if (state === 'not_started') return badge + '<span class="f">' + esc(translate(wording.setUp)) + ' ›</span>';
    if (lines.length < 2) return badge + lines.map(nestedLineHTML).join('');
    return (
      badge +
      nestedLineHTML(lines[0]) +
      '<span class="more-n" title="' +
      esc(wording.moreTitle(lines.length)) +
      '">+' +
      (lines.length - 1) +
      ' ' +
      esc(translate(wording.moreWord)) +
      '</span><span class="more" data-testid="shell-more-' +
      esc(card.id) +
      '">' +
      lines.map(nestedLineHTML).join('') +
      '</span>'
    );
  }
  /**
   * RPT2: the Till card's teaser — the server's figures.trend (8 weeks' sales, the engine's change vs last year) as a sparkline + words, a door
   * into Reports › Trend. Nothing from the server → nothing drawn (omit, never 0); CBDraw absent (a page without it) → nothing.
   */
  /** the change against last year in words: an arrow, the percent in the reader's locale, "vs last year" ('' when the engine sent none) */
  function trendChangeWords(change) {
    if (change == null) return '';
    var locale = root.CBLocale,
      amount = locale && locale.number ? locale.number(Math.abs(change), { maximumFractionDigits: 1 }) : String(Math.abs(change));
    return (change > 0 ? '↑ +' : change < 0 ? '↓ −' : '= ') + amount + '% ' + translate(wording.vsLastYear);
  }
  function trendHTML(trend) {
    if (!trend || !root.CBDraw) return '';
    var words = trendChangeWords(trend.vs_last_year_pct);
    var spark = root.CBDraw.spark(trend.spark, {
      width: 64,
      height: 16,
      stroke: 'var(--sh-green-d,#2d6a4f)',
      aria: translate(wording.salesWeeks) + (words ? ', ' + words : ''),
      tid: 'shell-fact-spark'
    });
    if (!spark) return '';
    return (
      '<span class="f trendf"><span class="act trend" role="link" tabindex="0" data-href="/finance.html#/reports/trend/week" data-testid="shell-fact-trend">' +
      spark +
      esc(words) +
      '</span></span>'
    );
  }
  /* a fact line's words: the server names an amount or a moment ({money} {time} {date} {when}) and sends it as data (money:{amount,currency}, at: ISO);
     the reader's locale words it — "₹420", "09:33", "today 09:40" — never "INR 420.00" or an ISO date */
  /** a moment's time in the reader's locale ('' when it cannot be said) */
  function momentTime(locale, at) {
    try {
      return (locale && locale.time && locale.time(at)) || '';
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('shell: a moment was not worded', failure);
      return '';
    }
  }
  /** a moment's date in the reader's locale (the ISO day when the locale cannot say it) */
  function momentDate(locale, at) {
    try {
      return (locale && locale.date && locale.date(at)) || String(at || '').slice(0, 10);
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('shell: a date was not worded', failure);
      return String(at || '').slice(0, 10);
    }
  }
  function isToday(at) {
    var day = new Date(at),
      now = new Date();
    return !isNaN(day) && day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
  }
  /** one {token} of a fact line said for the reader: money, time, date, or "today 09:40" */
  function momentWord(fact, token) {
    var locale = root.CBLocale,
      money = fact.money;
    if (token === 'money') return money ? (locale && locale.money && locale.money(money.amount, money.currency)) || money.currency + ' ' + money.amount : '';
    if (token === 'time') return momentTime(locale, fact.at);
    if (token === 'date') return momentDate(locale, fact.at);
    return (isToday(fact.at) ? wording.today : momentDate(locale, fact.at)) + ' ' + momentTime(locale, fact.at);
  }
  function lineWords(fact) {
    return String(fact.text == null ? '' : fact.text)
      .replace(/{(money|time|date|when)}/g, function (whole, token) {
        return momentWord(fact, token);
      })
      .trim();
  }
  /* each built entry's facts: GET its URL → { lines:[ 'text' | { text, tone:'dn', money?, at?, act?:{ label, href } } ] }, at most two lines; act = the button that clears the line */
  function lineHTML(l) {
    var t = typeof l === 'string' ? { text: l } : l || {};
    var act =
      t.act && t.act.label && t.act.href
        ? ' <span class="act" role="link" tabindex="0" data-href="' + esc(t.act.href) + '" data-testid="shell-fact-act">' + esc(t.act.label) + ' ›</span>'
        : '';
    return '<span class="f' + (t.tone === 'dn' ? ' dn' : '') + '">' + esc(lineWords(t)) + act + '</span>';
  }
  /** shell.js hands over its word table and translator once and gets back the card painters */
  function painters(words, translator) {
    wording = words;
    translate = translator;
    return { cardState: cardState, factsHTML: factsHTML, trendHTML: trendHTML, lineHTML: lineHTML };
  }

  /** the one entry: shell.js hands over its page state and painters once per mount and gets back what it calls */
  function create(ctx) {
    ctx.queue = [];
    ctx.running = 0;
    ctx.cache = {};
    return {
      isFirm: isFirm,
      practiceFirst: practiceFirst,
      once: function (url) {
        return factsOnce(ctx, url);
      },
      read: function (onlyId) {
        readFacts(ctx, onlyId);
      }
    };
  }
  root.CBShellFacts = { create: create, painters: painters };
})(typeof window !== 'undefined' ? window : this);
