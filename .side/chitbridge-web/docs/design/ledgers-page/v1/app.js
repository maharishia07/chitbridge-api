(function () {
  const DATA = window.LEDGER_DATA;
  const state = { q: '', kind: 'all', closed: new Set(), navOpen: true };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const hl = (text, q) => {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };
  const total = DATA.reduce((t, s) => t + s.groups.reduce((u, g) => u + g.accounts.length, 0), 0);
  const countOf = (s) => s.groups.reduce((u, g) => u + g.accounts.length, 0);

  // Sidebar
  $('nav').innerHTML = window.NAV_ITEMS.map(([label, d]) =>
    `<button type="button" class="nav-btn${label === 'Ledgers' ? ' active' : ''}" aria-label="${esc(label)}"${label === 'Ledgers' ? ' aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span class="label">${esc(label)}</span></button>`).join('');
  $('toggleNav').addEventListener('click', () => {
    state.navOpen = !state.navOpen;
    $('side').classList.toggle('collapsed', !state.navOpen);
    $('toggleNav').setAttribute('aria-expanded', String(state.navOpen));
    $('toggleNav').setAttribute('aria-label', state.navOpen ? 'Collapse sidebar' : 'Expand sidebar');
  });

  // Chips
  function renderChips() {
    const opts = [['all', 'All', total]].concat(DATA.map((s) => [s.kind, s.kind[0].toUpperCase() + s.kind.slice(1), countOf(s)]));
    $('chips').innerHTML = opts.map(([id, label, n]) =>
      `<button type="button" class="chip" data-kind="${id}" aria-pressed="${state.kind === id}">${label}<span class="n">${n}</span></button>`).join('');
  }
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.kind = b.dataset.kind; renderChips(); render();
  });

  // Sections
  function render() {
    const q = state.q.trim().toLowerCase();
    const match = (a) => !q || a[0].includes(q) || a[1].toLowerCase().includes(q);
    let shown = 0;
    const html = DATA.filter((s) => state.kind === 'all' || s.kind === state.kind).map((s) => {
      const groups = s.groups.map((g) => ({ title: g.title, accounts: g.accounts.filter(match) })).filter((g) => g.accounts.length);
      const n = groups.reduce((t, g) => t + g.accounts.length, 0);
      if (!n) return '';
      shown += n;
      const open = q ? true : !state.closed.has(s.id);
      return `<section class="section${open ? ' open' : ''}">
        <button type="button" class="sec-head" data-id="${s.id}" aria-expanded="${open}" aria-controls="body-${s.id}">
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          <span class="dot" style="background:${s.color}"></span>
          <span class="sec-text"><span class="sec-title-row"><span class="sec-title">${esc(s.title)}</span><span class="sec-kind">${s.label}</span></span>
          <span class="sec-blurb">${esc(s.blurb)}</span></span>
          <span class="sec-rule">${esc(s.rule)}</span>
          <span class="pill">${n} ${n === 1 ? 'ledger' : 'ledgers'}</span>
        </button>
        <div class="sec-body" id="body-${s.id}">
          ${groups.map((g) => `<div class="group">
            <div class="group-head"><span class="group-title">${esc(g.title)}</span><span class="group-count">${g.accounts.length}</span></div>
            <div class="group-list">${g.accounts.map(([code, name]) =>
              `<button type="button" class="acct" data-code="${code}"><span class="code">${hl(code, q)}</span><span class="name">${hl(name, q)}</span>
                <svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`).join('')}</div>
          </div>`).join('')}
        </div></section>`;
    }).join('');
    $('content').innerHTML = html || `<div class="empty"><strong>No ledgers match “${esc(state.q)}”</strong><button type="button" id="clear">Clear search</button></div>`;
    $('summary').textContent = (shown === total ? `${total} ledgers` : `${shown} of ${total} ledgers`) + ' in 3 classes · personal, real and nominal';
  }

  $('content').addEventListener('click', (e) => {
    const head = e.target.closest('.sec-head');
    if (head) {
      const id = head.dataset.id;
      state.closed.has(id) ? state.closed.delete(id) : state.closed.add(id);
      return render();
    }
    if (e.target.id === 'clear') { state.q = ''; $('q').value = ''; return render(); }
    const acct = e.target.closest('.acct');
    if (acct) {
      // Hook: open the ledger for this account code
      document.dispatchEvent(new CustomEvent('ledger:open', { detail: { code: acct.dataset.code } }));
    }
  });
  $('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('expandAll').addEventListener('click', () => { state.closed.clear(); render(); });
  $('collapseAll').addEventListener('click', () => { DATA.forEach((s) => state.closed.add(s.id)); render(); });

  renderChips(); render();
})();
