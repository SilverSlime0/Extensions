// ==UserScript==
// @name         Sendou.ink Like/Unlike
// @namespace    https://github.com/SilverSlime0/Extensions
// @version      0.13
// @description  UI to POST form-encoded _action=LIKE|UNLIKE & targetGroupId=... to https://sendou.ink/q/looking.data. Extracts group IDs from data-flip-id="desktop-<id>" and labels using the first element with a class containing "_name_". Theme-aware, collapsible, alternate default ON, 50 repeats @ 200ms. Requires you to be logged in in the browser.
// @match        https://sendou.ink/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(async function () {
  'use strict';

  function waitForBody(timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (document.body && document.head) return resolve();
      const t = setTimeout(() => {
        observer.disconnect();
        if (document.body && document.head) return resolve();
        reject(new Error('Timed out waiting for document.body/head'));
      }, timeout);
      const observer = new MutationObserver(() => {
        if (document.body && document.head) {
          clearTimeout(t);
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    });
  }

  try {
    await waitForBody();

    // remove existing UI if script re-runs
    const existing = document.getElementById('sendou-like-panel');
    if (existing) existing.remove();
    const existingBtn = document.getElementById('sli-collapse-btn');
    if (existingBtn) existingBtn.remove();

    /* --- Styles (including light/dark variants and collapse icon) --- */
    const style = document.createElement('style');
    style.textContent = `
      /* Panel base */
      #sendou-like-panel { position: fixed; right: 12px; bottom: 12px; width: 420px; max-height: 620px; border-radius: 10px; overflow: auto; z-index: 2147483647; transition: box-shadow .15s ease, transform .12s ease; }
      #sendou-like-panel.sli-light { background: rgba(255,255,255,0.98); border: 1px solid #d0d7de; color: #111; box-shadow: 0 6px 18px rgba(2,6,23,0.08); }
      #sendou-like-panel.sli-dark  { background: rgba(20,20,22,0.92); border: 1px solid rgba(255,255,255,0.06); color: #e6eef8; box-shadow: 0 6px 22px rgba(0,0,0,0.6); }
      #sendou-like-panel.sli-light h4, #sendou-like-panel.sli-light .small { color: #111; }
      #sendou-like-panel.sli-dark h4, #sendou-like-panel.sli-dark .small { color: #dbeafe; }

      #sendou-like-panel h4 { margin: 0 0 8px 0; font-size: 14px; padding:8px 10px; }
      #sendou-like-panel .row { display:flex; gap:6px; align-items:center; margin-bottom:6px; padding:0 10px; }
      #sendou-like-panel .row input[type="text"], #sendou-like-panel select { font-size: 13px; padding:6px; border-radius:6px; border:1px solid rgba(0,0,0,0.08); background:transparent; color:inherit; }
      #sendou-like-panel.sli-dark .row input[type="text"], #sendou-like-panel.sli-dark select { border:1px solid rgba(255,255,255,0.06); }
      #sendou-like-panel .log { margin:8px 10px 10px 10px; font-size:12px; background: rgba(250,250,250,0.6); border:1px solid #eee; padding:6px; max-height:220px; overflow:auto; border-radius:6px; color:#222; }
      #sendou-like-panel.sli-dark .log { background: rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.04); color:#e6eef8; }

      #sendou-like-panel .small { font-size:11px; color:inherit; opacity:.9; }
      #sli-group-select { flex:1; padding:6px; max-width: 260px; }
      #sli-controls { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      #sli-buttons { display:flex; gap:6px; align-items:center; padding:0 10px 10px 10px; }
      #sli-error { color: #f66; font-size: 12px; margin-top:6px; padding:0 10px 10px 10px; display:block; }

      /* Collapse button */
      #sli-collapse-btn {
        position: fixed;
        right: 12px;
        bottom: 12px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2147483648;
        border: none;
        box-shadow: 0 6px 18px rgba(2,6,23,0.08);
        transition: transform .12s ease, background-color .12s ease;
      }
      #sli-collapse-btn.sli-light { background: rgba(255,255,255,0.98); color: #111; border: 1px solid #d0d7de; }
      #sli-collapse-btn.sli-dark  { background: rgba(20,20,22,0.92); color: #e6eef8; border: 1px solid rgba(255,255,255,0.06); box-shadow: 0 6px 22px rgba(0,0,0,0.6); }
      #sli-collapse-btn:active { transform: scale(.96); }

      /* Small icon styles */
      .sli-icon { width: 18px; height: 18px; display:inline-block; pointer-events:none; }

      /* tiny responsive adjustments */
      @media (max-width:480px) {
        #sendou-like-panel { width: calc(100% - 24px); left: 12px; right: 12px; bottom: 64px; }
        #sli-collapse-btn { right: 16px; bottom: 16px; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    /* --- Panel DOM --- */
    const panel = document.createElement('div');
    panel.id = 'sendou-like-panel';
    panel.classList.add('sli-light');
    panel.innerHTML = `
      <h4>Sendou Like/Unlike (_action)</h4>

      <div class="row">
        <input id="sli-search" type="text" placeholder="Search discovered names/ids..." />
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="sli-invitable-only" /> Prefer invitable
        </label>
        <button id="sli-refresh-groups">Refresh</button>
      </div>

      <div class="row">
        <select id="sli-group-select"><option value="">-- Select a discovered group/user --</option></select>
      </div>

      <div class="row">
        <input id="sli-target-id" type="text" placeholder="targetGroupId (required)" />
      </div>

      <div class="row">
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="sli-alternate" checked /> Alternate
        </label>
        <select id="sli-start" title="Start with like or unlike">
          <option value="like">Start: LIKE</option>
          <option value="unlike">Start: UNLIKE</option>
        </select>
        <span class="small">Form body: targetGroupId=&_action=LIKE|UNLIKE → sent to /q/looking.data</span>
      </div>

      <div class="row" id="sli-controls">
        <input id="sli-repeat" type="number" min="1" value="50" style="width:72px" />
        <input id="sli-delay" type="number" min="0" value="200" style="width:72px" />
        <span class="small">repeats / ms delay</span>
      </div>

      <div class="row" id="sli-buttons">
        <button id="sli-like">Send LIKE</button>
        <button id="sli-unlike">Send UNLIKE</button>
        <button id="sli-stop" disabled>Stop</button>
        <button id="sli-clear">Clear log</button>
      </div>

      <div class="small">CSRF token: <span id="sli-csrf">detecting…</span></div>
      <div class="log" id="sli-log"></div>
      <div id="sli-error" aria-live="polite"></div>
    `;
    document.body.appendChild(panel);

    /* --- Collapse button DOM --- */
    const collapseBtn = document.createElement('button');
    collapseBtn.id = 'sli-collapse-btn';
    collapseBtn.setAttribute('aria-label', 'Toggle Sendou Like helper');
    collapseBtn.title = 'Toggle Sendou Like helper';
    collapseBtn.innerHTML = '<span class="sli-icon" aria-hidden="true">▤</span>';
    document.body.appendChild(collapseBtn);

    /* --- Helpers & State --- */
    const logEl = document.getElementById('sli-log');
    const errEl = document.getElementById('sli-error');

    function log(msg) { if (!logEl) return console.log(msg); const t = document.createElement('div'); t.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; logEl.prepend(t); }
    function setError(msg) { if (errEl) errEl.textContent = msg; console.error('sendou-like-helper:', msg); }
    function clearError() { if (errEl) errEl.textContent = ''; }

    let isRunning = false;
    let currentController = null;
    let allGroups = [];

    /* --- Theme detection & application --- */
    function isDarkMode() {
      try {
        if (window.matchMedia) {
          const mq = window.matchMedia('(prefers-color-scheme: dark)');
          if (typeof mq.matches === 'boolean') return mq.matches;
        }
        const bg = window.getComputedStyle(document.body).backgroundColor || '';
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (m) {
          const r = parseInt(m[1], 10) / 255;
          const g = parseInt(m[2], 10) / 255;
          const b = parseInt(m[3], 10) / 255;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          return lum < 0.5;
        }
      } catch (e) {}
      return false;
    }

    function updateThemeClass() {
      const dark = isDarkMode();
      panel.classList.toggle('sli-dark', dark);
      panel.classList.toggle('sli-light', !dark);
      collapseBtn.classList.toggle('sli-dark', dark);
      collapseBtn.classList.toggle('sli-light', !dark);
      const icon = dark
        ? '<svg class="sli-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        : '<svg class="sli-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
      collapseBtn.innerHTML = icon;
    }

    if (window.matchMedia) {
      try {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener ? mq.addEventListener('change', updateThemeClass) : mq.addListener(updateThemeClass);
      } catch (e) {}
    }
    const bgObserver = new MutationObserver(() => updateThemeClass());
    try { bgObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) {}
    updateThemeClass();

    /* --- Collapsed state persistence & behavior --- */
    const COLLAPSED_KEY = 'sli-collapsed';
    function isCollapsedStored() { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch (e) { return false; } }
    function setCollapsedStored(v) { try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch (e) {} }
    function collapsePanel() { panel.style.display = 'none'; collapseBtn.style.display = 'inline-flex'; setCollapsedStored(true); }
    function expandPanel() { panel.style.display = ''; collapseBtn.style.display = 'inline-flex'; setCollapsedStored(false); }
    function toggleCollapse() { const collapsed = panel.style.display === 'none'; if (collapsed) expandPanel(); else collapsePanel(); }
    if (isCollapsedStored()) panel.style.display = 'none'; else panel.style.display = '';

    collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
    panel.querySelector('h4')?.addEventListener('dblclick', () => collapsePanel());

    /* --- Scan / extraction logic --- */
    function closestAncestorMatching(el, predicate) {
      let node = el;
      while (node && node !== document.documentElement) {
        try { if (predicate(node)) return node; } catch (e) {}
        node = node.parentElement;
      }
      return null;
    }
    function ancestorHasSupporterClass(el) {
      return !!closestAncestorMatching(el, node => {
        if (!node || (!node.className && !node.id)) return false;
        const hi = (node.className + ' ' + (node.id || '')).toLowerCase();
        return /\b(support|supporter|backer|patron|donor)\b/.test(hi);
      });
    }

    function getCsrfToken() {
      try {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) return meta.content;
        const cookies = document.cookie ? document.cookie.split(';').map(s => s.trim()) : [];
        for (const c of cookies) {
          const [k, v] = c.split('=');
          if (!k) continue;
          if (/csrf/i.test(k) || /XSRF-TOKEN/i.test(k)) return decodeURIComponent(v);
        }
      } catch (e) {}
      return null;
    }
    function displayCsrf() { const el = document.getElementById('sli-csrf'); if (!el) return; const token = getCsrfToken(); el.textContent = token ? 'found' : 'none'; el.title = token ? token : 'No token detected.'; }

    function extractIdFromHref(href) {
      try {
        const u = href.split(/[?#]/)[0];
        const segs = u.split('/').filter(Boolean);
        if (!segs.length) return null;
        const gIndex = segs.findIndex(s => /^(g|group|groups|guild|club|u|user|players|player)$/i.test(s));
        if (gIndex >= 0 && gIndex < segs.length - 1) return segs[gIndex + 1];
        return segs[segs.length - 1];
      } catch (e) { return null; }
    }

    // scan elements with data-flip-id and prefer hidden input[name="targetGroupId"]; use first element whose class contains "_name_" inside the container for name
    function scanDataFlipIdGroupCards() {
      const found = new Map();
      try {
        document.querySelectorAll('[data-flip-id]').forEach(el => {
          try {
            const flip = (el.getAttribute && el.getAttribute('data-flip-id')) || '';
            if (!flip) return;
            const m = flip.match(/^desktop-(\d+)$/i);
            if (!m) return;
            const id = m[1];
            const container = el.tagName && el.tagName.toLowerCase() === 'section' ? el : closestAncestorMatching(el, n => n.tagName && n.tagName.toLowerCase() === 'section');
            let inputId = null;
            if (container) {
              const hidden = container.querySelector('input[name="targetGroupId"][type="hidden"], input[name="targetGroupId"]');
              if (hidden && hidden.value) inputId = hidden.value.trim();
            }
            const finalId = (inputId && inputId.length) ? inputId : id;
            let name = '';
            if (container) {
              // Use the first element that has "_name_" anywhere in its class attribute
              const nameEl = container.querySelector('[class*="_name_"]');
              if (nameEl) name = (nameEl.textContent || '').trim();
              if (!name) {
                const title = container.querySelector('h3, h2, h4, .title, .group-name, [data-testid="sendouq-group-card"]');
                if (title) name = (title.textContent || '').trim();
              }
              if (!name) {
                const form = container.querySelector('form');
                if (form) {
                  const btn = form.querySelector('button[type="submit"], button[data-testid="group-card-action-button"]');
                  if (btn) name = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
                }
              }
            }
            if (!name) name = `group ${finalId}`;
            if (!ancestorHasSupporterClass(el)) {
              if (!found.has(finalId)) found.set(finalId, name);
            }
          } catch (e) {}
        });
      } catch (e) {}
      return Array.from(found.entries()).map(([id, name]) => ({ id, name }));
    }

    function fallbackScan() {
      const found = new Map();
      try {
        document.querySelectorAll('input[name="targetGroupId"]').forEach(inp => {
          try {
            const val = inp.value && inp.value.toString().trim();
            if (!val) return;
            const sec = inp.closest('section');
            const name = (sec && ((sec.querySelector('[class*="_name_"]') || sec.querySelector('h3, h2, h4, .title')) || {}).textContent || '').trim() || val;
            if (!ancestorHasSupporterClass(inp) && !found.has(val)) found.set(val, name);
          } catch (e) {}
        });
        document.querySelectorAll('a[href]').forEach(a => {
          try {
            const href = a.getAttribute('href');
            if (!href) return;
            const segs = href.split(/[?#]/)[0].split('/').filter(Boolean);
            if (!segs.length) return;
            const gIdx = segs.findIndex(s => /^(g|group|groups|guild|club)$/i.test(s));
            const id = (gIdx >= 0 && gIdx < segs.length - 1) ? segs[gIdx + 1] : segs[segs.length - 1];
            if (!id) return;
            const name = (a.textContent || a.getAttribute('title') || '').trim() || id;
            if (!ancestorHasSupporterClass(a) && !found.has(id)) found.set(id, name);
          } catch (e) {}
        });
      } catch (e) {}
      return Array.from(found.entries()).map(([id, name]) => ({ id, name }));
    }

    function findGroupsOnPage(preferInvitable = false) {
      const flipResults = scanDataFlipIdGroupCards();
      if (flipResults.length > 0) return flipResults;
      return fallbackScan();
    }

    function renderGroupSelect(filter = '') {
      const select = document.getElementById('sli-group-select');
      if (!select) return;
      select.innerHTML = '<option value="">-- Select a discovered group/user --</option>';
      const q = (filter || '').toLowerCase().trim();
      const items = allGroups.filter(g => {
        if (!q) return true;
        return (g.id && g.id.toLowerCase().includes(q)) || (g.name && g.name.toLowerCase().includes(q));
      });
      items.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} - ${g.id}`;
        select.appendChild(opt);
      });
    }

    function populateGroupSelect(preferInvitable = false) {
      const groups = findGroupsOnPage(preferInvitable);
      allGroups = groups;
      renderGroupSelect(document.getElementById('sli-search').value || '');
      const saved = localStorage.getItem('sli-last-group');
      if (saved) {
        const select = document.getElementById('sli-group-select');
        if (select) {
          const exists = Array.from(select.options).some(o => o.value === saved);
          if (exists) select.value = saved;
        }
      }
      log(`Discovered ${groups.length} group(s) on page${preferInvitable ? ' (preferInvitable)' : ''}.`);
      return groups;
    }

    document.getElementById('sli-refresh-groups').addEventListener('click', () => {
      try {
        const prefer = !!(document.getElementById('sli-invitable-only') || {}).checked;
        populateGroupSelect(prefer);
      } catch (e) { setError('Failed to refresh groups: ' + e.message); }
    });

    const searchInput = document.getElementById('sli-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => { try { renderGroupSelect(searchInput.value || ''); } catch (e) {} });
      searchInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          const select = document.getElementById('sli-group-select');
          if (select && select.options.length > 1) {
            select.selectedIndex = 1;
            select.dispatchEvent(new Event('change'));
          }
        }
      });
    }

    const groupSelect = document.getElementById('sli-group-select');
    const targetInput = document.getElementById('sli-target-id');
    if (groupSelect && targetInput) {
      groupSelect.addEventListener('change', () => {
        const val = groupSelect.value || '';
        if (val) {
          targetInput.value = val;
          try { localStorage.setItem('sli-last-group', val); } catch (e) {}
          log(`Selected group id: ${val}`);
        }
      });
    }

    try { populateGroupSelect(true); } catch (e) {}

    // POST /q/looking.data (form-encoded)
    async function postLookingForm(payload, signal) {
      const url = 'https://sendou.ink/q/looking.data';
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
      const csrf = getCsrfToken();
      if (csrf) { headers['X-CSRF-Token'] = csrf; headers['X-XSRF-TOKEN'] = csrf; }
      const params = new URLSearchParams();
      Object.keys(payload).forEach(k => params.set(k, payload[k]));
      try {
        const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: params.toString(), signal });
        const text = await res.text();
        log(`POST ${url} -> ${res.status} ${res.statusText}; response length: ${text.length}`);
        try { const json = JSON.parse(text); log(`Response JSON: ${JSON.stringify(json)}`); } catch (e) { if (text && text.length < 1000) log(`Response text: ${text}`); }
        return { ok: res.ok, status: res.status, text };
      } catch (err) {
        if (err && err.name === 'AbortError') { log('Request aborted.'); return { ok: false, aborted: true, error: err }; }
        log(`Network error: ${err}`); return { ok: false, error: err };
      }
    }

    async function sendMany(payloadFactory, count, delayMs) {
      if (isRunning) { setError('A run is already in progress.'); return; }
      clearError();
      isRunning = true;
      currentController = new AbortController();
      const signal = currentController.signal;
      const likeBtn = document.getElementById('sli-like');
      const unlikeBtn = document.getElementById('sli-unlike');
      const stopBtn = document.getElementById('sli-stop');
      if (likeBtn) likeBtn.disabled = true;
      if (unlikeBtn) unlikeBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;

      try {
        for (let i = 0; i < count; ++i) {
          if (!isRunning) { log('Run stopped by user.'); break; }
          const payload = payloadFactory(i);
          log(`Sending #${i + 1} payload: ${JSON.stringify(payload)}`);
          const res = await postLookingForm(payload, signal);
          if (res && res.aborted) { log('Batch aborted.'); break; }
          if (!isRunning) { log('Run stopped by user after request.'); break; }
          if (i < count - 1 && delayMs > 0) {
            await new Promise((resolve) => {
              let done = false;
              const t = setTimeout(() => { done = true; resolve(); }, delayMs);
              const poll = setInterval(() => {
                if (!isRunning) { clearTimeout(t); clearInterval(poll); if (!done) resolve(); }
              }, 50);
            });
          }
        }
      } catch (e) {
        if (e && e.name === 'AbortError') log('Batch aborted via controller.'); else setError('sendMany error: ' + (e && e.message || String(e)));
      } finally {
        isRunning = false;
        if (currentController) { try { currentController.abort(); } catch (e) {} currentController = null; }
        if (likeBtn) likeBtn.disabled = false;
        if (unlikeBtn) unlikeBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        log('Batch finished.');
      }
    }

    function makePayloadFactoryFor(actionLike, alternate, startWithLike) {
      if (!alternate) { return () => ({ targetGroupId: targetInput.value.trim(), _action: actionLike ? 'LIKE' : 'UNLIKE' }); }
      return (i) => { const likeNow = startWithLike ? (i % 2 === 0) : (i % 2 === 1); return { targetGroupId: targetInput.value.trim(), _action: likeNow ? 'LIKE' : 'UNLIKE' }; };
    }

    const likeBtn = document.getElementById('sli-like');
    const unlikeBtn = document.getElementById('sli-unlike');
    const stopBtn = document.getElementById('sli-stop');
    const clearBtn = document.getElementById('sli-clear');

    if (likeBtn) likeBtn.addEventListener('click', async () => {
      try {
        displayCsrf();
        const target = (targetInput && targetInput.value) ? targetInput.value.trim() : '';
        if (!target) { alert('Enter targetGroupId first'); return; }
        const repeats = Math.max(1, parseInt((document.getElementById('sli-repeat') || {}).value || '50', 10));
        const delay = Math.max(0, parseInt((document.getElementById('sli-delay') || {}).value || '200', 10));
        const alternate = (document.getElementById('sli-alternate') || {}).checked;
        const start = (document.getElementById('sli-start') || {}).value === 'like';
        const payloadFactory = makePayloadFactoryFor(true, !!alternate, !!start);
        if (repeats > 1000 && !confirm(`You're about to send ${repeats} requests. Continue?`)) return;
        await sendMany(payloadFactory, repeats, delay);
      } catch (e) { setError('Like handler error: ' + (e && e.message || String(e))); }
    });

    if (unlikeBtn) unlikeBtn.addEventListener('click', async () => {
      try {
        displayCsrf();
        const target = (targetInput && targetInput.value) ? targetInput.value.trim() : '';
        if (!target) { alert('Enter targetGroupId first'); return; }
        const repeats = Math.max(1, parseInt((document.getElementById('sli-repeat') || {}).value || '50', 10));
        const delay = Math.max(0, parseInt((document.getElementById('sli-delay') || {}).value || '200', 10));
        const alternate = (document.getElementById('sli-alternate') || {}).checked;
        const start = (document.getElementById('sli-start') || {}).value === 'like';
        const payloadFactory = makePayloadFactoryFor(false, !!alternate, !!start);
        if (repeats > 1000 && !confirm(`You're about to send ${repeats} requests. Continue?`)) return;
        await sendMany(payloadFactory, repeats, delay);
      } catch (e) { setError('Unlike handler error: ' + (e && e.message || String(e))); }
    });

    if (stopBtn) stopBtn.addEventListener('click', () => {
      if (!isRunning) { log('No run in progress to stop.'); return; }
      log('Stopping run...'); isRunning = false; if (currentController) { try { currentController.abort(); } catch (e) {} }
    });

    if (clearBtn && logEl) clearBtn.addEventListener('click', () => { logEl.innerHTML = ''; clearError(); });

    window.sendouLikeHelper = {
      postLookingForm,
      getCsrfToken,
      displayCsrf,
      log,
      findGroupsOnPage,
      populateGroupSelect: (prefer) => populateGroupSelect(!!prefer),
      stop: () => { if (!isRunning) return; isRunning = false; if (currentController) try { currentController.abort(); } catch (e) {} },
      isRunning: () => !!isRunning,
      lastGroups: () => allGroups.slice(),
      toggle: toggleCollapse,
    };

    log('Sendou Like/Unlike helper loaded (defaults: alternate ON, 50 repeats @200ms; name grabber uses first class containing "_name_").');
  } catch (err) {
    console.error('sendou-like-helper init error:', err);
    const maybeErr = document.getElementById('sli-error');
    if (maybeErr) maybeErr.textContent = String(err);
  }
})();