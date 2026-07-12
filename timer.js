// ============================================================
// timer.js — Homework & Question Timer for Sparx Maths
// Wrapped in IIFE to avoid global namespace collisions with content.js
// - Homework timer (per-URL, saved to storage, persists across refreshes & SPA navigation)
// - Question timer (per-question, saved to storage, pauses off-tab)
// - Move mode: one-shot from settings popup
// - Move to top banner: embeds into Sparx's _BannerSpacing_
// - SPA-resilient: re-inserts timer if the SPA destroys it
// - Banner-resilient: retries until the banner element renders
// - localStorage primary: instant synchronous save & restore
// - chrome.storage mirror: periodic async sync from localStorage
// - Session-sticky homework key: survives sub-page navigation
// - Start page: injects total time per homework into homework list
// - Extension context invalidation: safe chrome.storage wrappers
// - Periodic URL polling: catches SPA navigations that bypass pushState
// - Question key persistence: survives page reloads via sessionStorage
// ============================================================

(function() {
  'use strict';

  console.log('[Sparx Timer] Loading...');

  const TIMER_STORAGE_KEY    = 'SparxLessTimerPos';
  const TIMER_ENABLED_KEY    = 'SparxLessTimerEnabled';
  const QUESTION_TIMERS_KEY  = 'SparxLessQuestionTimers';
  const TIMER_LOCATION_KEY   = 'SparxLessTimerLocation'; // 'floating' | 'banner'
  const HOMEWORK_TIMERS_KEY  = 'SparxLessHomeworkTimers'; // { [urlKey]: seconds }

  // localStorage keys — PRIMARY storage (synchronous, instant, reliable)
  const LS_HOMEWORK_TIMERS  = 'sparxless_hw_timers';
  const LS_QUESTION_TIMERS  = 'sparxless_q_timers';
  const LS_LOCATION         = 'sparxless_timer_location';
  const LS_POSITION         = 'sparxless_timer_pos';

  // sessionStorage keys
  const SS_HOMEWORK_KEY     = 'sparxless_active_hw_key';
  const SS_QUESTION_KEY     = 'sparxless_active_q_key';      // persisted question key
  const SS_QUESTION_SECONDS = 'sparxless_active_q_seconds';  // persisted question seconds

  // ── Helpers ───────────────────────────────────────────────────
  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Check if the chrome extension context is still valid
  function isContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  // Extract a stable homework key from the URL.
  //
  // Sparx URL structures:
  //   /student/package/<hw-uuid>/task/1/item/1    <- homework with task/item
  //   /student/package/<hw-uuid>                   <- homework root
  //   /student/homework/<hw-uuid>                  <- homework alt format
  //   /student/homework/?pkg_id=<hw-uuid>          <- homework query format
  //   /student/                                    <- start page (NOT homework)
  //   /student/homework/                           <- homework list (NOT a specific homework)
  function getHomeworkKey() {
    const path = location.pathname;
    const search = location.search;

    // 1. /package/<uuid> or /homework/<uuid> — UUID right after this segment
    const m1 = path.match(/\/(package|homework)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m1) return m1[2];

    // 2. /student/homework/?pkg_id=<uuid>&pkg_type=homework
    if (/\/student\/homework\/?$/i.test(path)) {
      const pkgIdMatch = search.match(/[?&]pkg_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (pkgIdMatch) return pkgIdMatch[1];
    }

    // 3. Any UUID in path as fallback
    const m2 = path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m2) return m2[1];

    // 4. Not a homework page
    return null;
  }

  // Check if the current URL is a homework/content page (not the home page)
  function isOnHomeworkPage() {
    return getHomeworkKey() !== null;
  }

  // Check if we're on the start/home page (homework list)
  function isOnStartPage() {
    const path = location.pathname;
    // /student/ or /student with no homework ID
    if (/^\/student\/?$/.test(path)) return true;
    // /student/homework/ without a pkg_id query param (just the list page)
    if (/\/student\/homework\/?$/i.test(path)) {
      const pkgIdMatch = location.search.match(/[?&]pkg_id=/i);
      if (!pkgIdMatch) return true;
    }
    return false;
  }

  // Keep getPackageId as an alias for compatibility with question timers
  function getPackageId() {
    return getHomeworkKey();
  }

  // Get the "session-sticky" homework key.
  // IMPORTANT: On the start page (no homework UUID in URL), this always returns null,
  // even if sessionStorage has a stale key from a previous homework.
  function getSessionHomeworkKey() {
    const urlKey = getHomeworkKey();

    // No homework key in the URL — we're not on a homework page.
    // Clear the sessionStorage key to keep things consistent.
    if (!urlKey) {
      sessionStorage.removeItem(SS_HOMEWORK_KEY);
      return null;
    }

    // We have a URL homework key — update sessionStorage and use it
    sessionStorage.setItem(SS_HOMEWORK_KEY, urlKey);
    return urlKey;
  }

  function getCurrentQuestionText() {
    const wrappers = document.querySelectorAll('[class*="_Question_"]');
    for (const w of wrappers) {
      const textEls = w.querySelectorAll('[class*="_TextElement_"]');
      for (const el of textEls) {
        const t = el.innerText?.replace(/\s+/g, ' ').trim();
        if (t && t.length > 5) return t;
      }
    }
    for (const w of wrappers) {
      const t = w.innerText?.replace(/\s+/g, ' ').trim();
      if (t && t.length > 5) return t;
    }
    return null;
  }

  function questionKey(text) {
    return (text || '').slice(0, 120).trim();
  }

  // ── Synchronous localStorage helpers (PRIMARY storage) ────────
  function lsGet(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function lsGetHomeworkSeconds(hwKey) {
    const store = lsGet(LS_HOMEWORK_TIMERS) || {};
    return store[hwKey] || 0;
  }
  function lsSaveHomeworkSeconds(hwKey, seconds) {
    const store = lsGet(LS_HOMEWORK_TIMERS) || {};
    store[hwKey] = seconds;
    lsSet(LS_HOMEWORK_TIMERS, store);
  }
  function lsGetQuestionSeconds(hwKey, qKey) {
    const store = lsGet(LS_QUESTION_TIMERS) || {};
    return (store[hwKey] && store[hwKey][qKey]) || 0;
  }
  function lsSaveQuestionSeconds(hwKey, qKey, seconds) {
    const store = lsGet(LS_QUESTION_TIMERS) || {};
    if (!store[hwKey]) store[hwKey] = {};
    store[hwKey][qKey] = seconds;
    lsSet(LS_QUESTION_TIMERS, store);
  }

  // ── chrome.storage sync (atomic mirror from localStorage) ────
  // All chrome.storage calls are wrapped to handle context invalidation
  function _safeStorageSet(obj) {
    if (!isContextValid()) return;
    try { chrome.storage.local.set(obj); } catch {}
  }

  function _safeStorageGet(keys, callback) {
    if (!isContextValid()) { callback({}); return; }
    try {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) {
          console.warn('[Sparx Timer] chrome.storage.local.get error:', chrome.runtime.lastError.message);
          callback({});
          return;
        }
        callback(data);
      });
    } catch {
      callback({});
    }
  }

  function _safeStorageRemove(keys) {
    if (!isContextValid()) return;
    try { chrome.storage.local.remove(keys); } catch {}
  }

  function syncToChromeStorage() {
    if (!isContextValid()) return;
    try {
      const hwStore = lsGet(LS_HOMEWORK_TIMERS) || {};
      const qStore = lsGet(LS_QUESTION_TIMERS) || {};
      _safeStorageSet({
        [HOMEWORK_TIMERS_KEY]: hwStore,
        [QUESTION_TIMERS_KEY]: qStore
      });
    } catch {}
  }

  function loadFromChromeStorage(callback) {
    _safeStorageGet([HOMEWORK_TIMERS_KEY, QUESTION_TIMERS_KEY], (data) => {
      try {
        const hwRemote = data[HOMEWORK_TIMERS_KEY] || {};
        const hwLocal = lsGet(LS_HOMEWORK_TIMERS) || {};
        for (const key of Object.keys(hwRemote)) {
          if (hwRemote[key] > (hwLocal[key] || 0)) hwLocal[key] = hwRemote[key];
        }
        lsSet(LS_HOMEWORK_TIMERS, hwLocal);

        const qRemote = data[QUESTION_TIMERS_KEY] || {};
        const qLocal = lsGet(LS_QUESTION_TIMERS) || {};
        for (const hwKey of Object.keys(qRemote)) {
          if (!qLocal[hwKey]) qLocal[hwKey] = {};
          for (const qk of Object.keys(qRemote[hwKey])) {
            if (qRemote[hwKey][qk] > (qLocal[hwKey][qk] || 0)) qLocal[hwKey][qk] = qRemote[hwKey][qk];
          }
        }
        lsSet(LS_QUESTION_TIMERS, qLocal);
      } catch {}
      if (callback) callback();
    });
  }

  // ── Find the Sparx top banner spacing element ─────────────────
  function findBannerSpacing() {
    return document.querySelector('[class*="_BannerSpacing_"]');
  }

  // ── Start page: inject total time per homework ────────────────
  // On the Sparx start/home page, homework entries are accordion items.
  // Each accordion trigger contains:
  //   ._Package_ > ._PackageLeft_ (date text) + ._PackageRight_ (status + bookwork graph)
  // We inject a timer badge between _PackageLeft_ and _PackageRight_.
  //
  // To find the homework UUID, we look for task links (<a href="/student/package/<uuid>/task/N">)
  // inside the accordion content. These are only present for expanded items.
  // Collapsed items get timers when they are expanded (MutationObserver handles this).

  function injectStartPageTimers() {
    if (!isOnStartPage()) return;

    const hwStore = lsGet(LS_HOMEWORK_TIMERS) || {};
    if (Object.keys(hwStore).length === 0) return; // no stored times at all

    // ── Strategy 1: Find task links inside accordion content ─────
    // Each expanded accordion item contains task links with /package/<uuid>
    const taskLinks = document.querySelectorAll('a[href*="/package/"]');

    // Build a map: UUID → first task link's parent accordion item
    const uuidToAccordion = new Map();

    taskLinks.forEach(link => {
      const m = link.getAttribute('href').match(/\/package\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!m) return;
      const hwId = m[1];

      // Walk up from the task link to find the accordion item
      let el = link;
      for (let i = 0; i < 8; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        if (el.className && el.className.includes('_AccordionItem_')) {
          if (!uuidToAccordion.has(hwId)) {
            uuidToAccordion.set(hwId, el);
          }
          break;
        }
      }
    });

    // ── Strategy 2: For items without task links, try matching via
    // any stored UUID that appears in a link elsewhere on the page ──
    // (e.g., the "Continue" button might have a link)
    document.querySelectorAll('a[href*="/package/"]').forEach(link => {
      const m = link.getAttribute('href').match(/\/package\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!m) return;
      const hwId = m[1];
      if (uuidToAccordion.has(hwId)) return;

      let el = link;
      for (let i = 0; i < 8; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        if (el.className && el.className.includes('_AccordionItem_')) {
          uuidToAccordion.set(hwId, el);
          break;
        }
      }
    });

    // ── Now inject timer badges for each found accordion item ─────
    uuidToAccordion.forEach((accordionItem, hwId) => {
      // Skip if already injected
      if (accordionItem.querySelector('.sparxless-hw-time')) return;

      const seconds = hwStore[hwId] || 0;
      if (seconds === 0) return; // no time recorded

      // Find the PackageLeft element (contains the date)
      const packageLeft = accordionItem.querySelector('[class*="_PackageLeft_"]');
      if (!packageLeft) {
        console.warn('[Sparx Timer] Could not find _PackageLeft_ for', hwId);
        return;
      }

      // Create the timer badge
      const badge = document.createElement('div');
      badge.className = 'sparxless-hw-time';
      badge.dataset.hwId = hwId;
      badge.textContent = formatTime(seconds);
      badge.title = `Total time: ${formatTime(seconds)}`;

      // Insert AFTER PackageLeft (right of date) and BEFORE PackageRight (left of bookwork graph)
      packageLeft.insertAdjacentElement('afterend', badge);
      console.log(`[Sparx Timer] Injected start page timer for ${hwId}: ${formatTime(seconds)}`);
    });
  }

  // Inject start page timer CSS
  if (!document.getElementById('sparxless-startpage-styles')) {
    const startStyle = document.createElement('style');
    startStyle.id = 'sparxless-startpage-styles';
    startStyle.textContent = `
      .sparxless-hw-time {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(74, 149, 255, 0.08);
        color: #4a95ff;
        font-family: 'Nunito', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 700;
        padding: 3px 10px;
        border-radius: 12px;
        border: 1px solid rgba(74, 149, 255, 0.2);
        white-space: nowrap;
        margin: 0 8px;
        flex-shrink: 0;
      }
      .sparxless-hw-time::before {
        content: '\\23F1';
        font-size: 11px;
        margin-right: 2px;
      }
    `;
    if (document.head) {
      document.head.appendChild(startStyle);
    } else {
      document.documentElement.appendChild(startStyle);
    }
  }

  // ── Create the timer ──────────────────────────────────────────
  function createTimer() {
    if (document.getElementById('sparx-custom-timer')) return;

    // Inject CSS (only once)
    if (!document.getElementById('sparx-timer-styles')) {
      const timerStyle = document.createElement('style');
      timerStyle.id = 'sparx-timer-styles';
      timerStyle.textContent = `
        /* ── Floating mode ── */
        #sparx-custom-timer {
          position: fixed;
          top: 20px;
          right: 20px;
          background: #ffffff;
          padding: 0;
          border-radius: 10px;
          z-index: 10000;
          box-shadow: 0 2px 10px rgba(74, 149, 255, 0.15);
          font-family: 'Nunito', system-ui, sans-serif;
          border: 1.5px solid #d0e4ff;
          overflow: hidden;
          user-select: none;
          transition: box-shadow 0.15s, border-color 0.15s;
        }
        #sparx-custom-timer:hover {
          box-shadow: 0 4px 16px rgba(74, 149, 255, 0.25);
          border-color: #4a95ff;
        }
        #sparx-custom-timer.moving {
          box-shadow: 0 6px 20px rgba(74, 149, 255, 0.4);
          border-color: #2d7de0;
          cursor: grab;
        }

        /* ── Banner mode ── */
        #sparx-custom-timer.in-banner {
          position: static;
          top: auto;
          right: auto;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          border: 1.5px solid rgba(74, 149, 255, 0.35);
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255,255,255,0.1);
          z-index: auto;
          overflow: visible;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 5px 12px;
        }
        #sparx-custom-timer.in-banner:hover {
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(74,149,255,0.3);
          border-color: rgba(74, 149, 255, 0.55);
        }
        #sparx-custom-timer.in-banner.moving {
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.22);
          border-color: rgba(74, 149, 255, 0.55);
          cursor: default;
        }
        #sparx-custom-timer.in-banner .sparx-timer-row {
          padding: 2px 0;
          background: transparent;
          border: none;
          gap: 6px;
        }
        #sparx-custom-timer.in-banner .sparx-timer-row.homework-row {
          background: transparent;
          border-bottom: none;
        }
        #sparx-custom-timer.in-banner .sparx-timer-value {
          font-size: 14px;
          font-weight: 900;
        }
        #sparx-custom-timer.in-banner .sparx-timer-label {
          font-size: 10px;
        }
        #sparx-custom-timer.in-banner .sparx-question-preview {
          display: none;
        }
        #sparx-custom-timer.in-banner .sparx-timer-divider {
          display: block;
        }

        /* ── Shared rows ── */
        .sparx-timer-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
        }
        .sparx-timer-row.homework-row {
          background: #f0f6ff;
          border-bottom: 1px solid #d0e4ff;
        }
        .sparx-timer-row.question-row {
          background: #ffffff;
        }
        .sparx-timer-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .sparx-timer-dot.homework {
          background: #22c55e;
        }
        .sparx-timer-dot.question {
          background: #4a95ff;
        }
        .sparx-timer-dot.paused {
          background: #d97706;
        }
        .sparx-timer-label {
          font-size: 10px;
          font-weight: 800;
          color: #7a8fb5;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .sparx-timer-value {
          font-size: 14px;
          font-weight: 900;
          color: #4a95ff;
          font-variant-numeric: tabular-nums;
        }
        .sparx-question-preview {
          font-size: 9px;
          color: #a0aec0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 130px;
        }
        .sparx-timer-divider {
          display: none;
          width: 1px;
          height: 16px;
          background: #d0e4ff;
          flex-shrink: 0;
        }
      `;
      if (document.head) {
        document.head.appendChild(timerStyle);
      } else {
        document.documentElement.appendChild(timerStyle);
      }
    }

    // Create timer element
    const timer = document.createElement('div');
    timer.id = 'sparx-custom-timer';
    timer.innerHTML = `
      <div class="sparx-timer-row homework-row">
        <span class="sparx-timer-dot homework" id="sparx-homework-dot"></span>
        <span class="sparx-timer-label">Homework</span>
        <span class="sparx-timer-value" id="sparx-homework-value">0:00</span>
      </div>
      <div class="sparx-timer-divider"></div>
      <div class="sparx-timer-row question-row">
        <span class="sparx-timer-dot question" id="sparx-question-dot"></span>
        <span class="sparx-timer-label">Question</span>
        <span class="sparx-timer-value" id="sparx-question-value">0:00</span>
        <span class="sparx-question-preview" id="sparx-question-preview"></span>
      </div>
    `;
    document.body.appendChild(timer);

    const homeworkValue   = document.getElementById('sparx-homework-value');
    const homeworkDot    = document.getElementById('sparx-homework-dot');
    const questionValue  = document.getElementById('sparx-question-value');
    const questionDot    = document.getElementById('sparx-question-dot');
    const questionPreview = document.getElementById('sparx-question-preview');

    // ── Track current location ──────────────────────────────────
    let currentLocation = lsGet(LS_LOCATION) || 'floating';

    // ── Timers ───────────────────────────────────────────────────
    let homeworkSeconds = 0;
    let questionSeconds = 0;
    let currentQKey     = null;
    let isPaused        = false;

    // FIX #2: Determine homework status purely from the URL, not from sessionStorage.
    // The old getSessionHomeworkKey() could return stale keys from sessionStorage
    // even when the URL no longer had a homework UUID.
    const rawHwKey = getHomeworkKey();
    let isOnHomework = rawHwKey !== null;
    let activeHwKey = rawHwKey;

    // If we're on a homework page, store the key in sessionStorage for sub-page stickiness
    if (activeHwKey) {
      sessionStorage.setItem(SS_HOMEWORK_KEY, activeHwKey);
    }

    console.log(`[Sparx Timer] Init: activeHwKey=${activeHwKey}, isOnHomework=${isOnHomework}, URL=${location.href}`);

    // ── INSTANT restore from localStorage (synchronous!) ────────
    if (isOnHomework) {
      homeworkSeconds = lsGetHomeworkSeconds(activeHwKey);
      homeworkValue.textContent = formatTime(homeworkSeconds);
      console.log(`[Sparx Timer] Restored homework time for ${activeHwKey}: ${homeworkSeconds}s`);

      // FIX #3: Restore question key from sessionStorage on page load.
      // This ensures the question timer survives full page reloads and
      // navigation to the answer page (which may trigger a full reload).
      const savedQKey = sessionStorage.getItem(SS_QUESTION_KEY);
      const savedQSeconds = parseInt(sessionStorage.getItem(SS_QUESTION_SECONDS) || '0', 10);
      if (savedQKey) {
        currentQKey = savedQKey;
        // Use the higher of sessionStorage seconds vs localStorage seconds
        const lsQSeconds = lsGetQuestionSeconds(activeHwKey, currentQKey);
        questionSeconds = Math.max(savedQSeconds, lsQSeconds);
        questionValue.textContent = formatTime(questionSeconds);
        questionPreview.textContent = currentQKey.slice(0, 30) + '...';
        console.log(`[Sparx Timer] Restored question timer: key=${currentQKey.slice(0, 40)}..., seconds=${questionSeconds}`);
      }
    }

    // ── Reconcile with chrome.storage (async, one-time on load) ──
    loadFromChromeStorage(() => {
      if (isOnHomework && activeHwKey) {
        const newSeconds = lsGetHomeworkSeconds(activeHwKey);
        if (newSeconds > homeworkSeconds) {
          homeworkSeconds = newSeconds;
          homeworkValue.textContent = formatTime(homeworkSeconds);
          console.log(`[Sparx Timer] Upgraded from chrome.storage merge: ${homeworkSeconds}s`);
        }
      }
      if (currentQKey && activeHwKey) {
        const newQSeconds = lsGetQuestionSeconds(activeHwKey, currentQKey);
        if (newQSeconds > questionSeconds) {
          questionSeconds = newQSeconds;
          questionValue.textContent = formatTime(questionSeconds);
        }
      }
      // Also inject start page timers after chrome.storage data is loaded
      injectStartPageTimers();
    });

    // ── Show/hide homework timer paused state based on page ──────
    function updateHomeworkDot() {
      if (isOnHomework && !isPaused) {
        homeworkDot.classList.remove('paused');
        homeworkDot.classList.add('homework');
      } else {
        homeworkDot.classList.remove('homework');
        homeworkDot.classList.add('paused');
      }
    }
    updateHomeworkDot();

    // ── Save homework time (localStorage) ───────────────────────
    function saveHomeworkTime() {
      if (!isOnHomework || !activeHwKey) return;
      lsSaveHomeworkSeconds(activeHwKey, homeworkSeconds);
    }

    // ── Save question time (localStorage + sessionStorage) ──────
    function saveCurrentQuestionTime() {
      if (!currentQKey || !activeHwKey) return;
      lsSaveQuestionSeconds(activeHwKey, currentQKey, questionSeconds);
      // Also persist to sessionStorage so it survives page reloads
      sessionStorage.setItem(SS_QUESTION_KEY, currentQKey);
      sessionStorage.setItem(SS_QUESTION_SECONDS, String(questionSeconds));
    }

    // ── Tab visibility: pause both timers when tab is hidden ─────
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        isPaused = false;
        updateHomeworkDot();
        questionDot.classList.remove('paused');
        questionDot.classList.add('question');
      } else {
        isPaused = true;
        updateHomeworkDot();
        questionDot.classList.remove('question');
        questionDot.classList.add('paused');
        saveCurrentQuestionTime();
        saveHomeworkTime();
        syncToChromeStorage();
      }
    });

    // ── Load question time from localStorage ────────────────────
    function loadQuestionTime(key) {
      if (!activeHwKey) return 0;
      return lsGetQuestionSeconds(activeHwKey, key);
    }

    // ── Detect question changes ─────────────────────────────────
    // When navigating to the answer page, the question DOM elements
    // may disappear temporarily. We DON'T reset the question timer
    // when no question text is found — we keep the last known question
    // ticking. Only switch to a new question when actual different
    // question text appears.
    let lastKnownQuestionText = null;

    function checkQuestionChange() {
      const text = getCurrentQuestionText();

      // No question text found on the page — don't reset, keep timing
      // the last known question. The answer page may not have question
      // elements, but we're still on the same question.
      if (!text) return;

      const key = questionKey(text);
      if (key === currentQKey) return; // same question

      // Found a genuinely different question — save old and switch
      if (currentQKey) {
        saveCurrentQuestionTime();
      }

      lastKnownQuestionText = text;
      currentQKey = key;
      questionSeconds = loadQuestionTime(key);
      questionValue.textContent = formatTime(questionSeconds);
      questionPreview.textContent = text ? text.slice(0, 30) + '...' : '';
      // Persist the new question key
      sessionStorage.setItem(SS_QUESTION_KEY, currentQKey);
      sessionStorage.setItem(SS_QUESTION_SECONDS, String(questionSeconds));
      console.log(`[Sparx Timer] Question changed to: ${key.slice(0, 40)}...`);
    }

    // Initial check — only set question if we find one on the page
    // and we don't already have one restored from sessionStorage
    if (!currentQKey) {
      const initialQText = getCurrentQuestionText();
      if (initialQText) {
        lastKnownQuestionText = initialQText;
        currentQKey = questionKey(initialQText);
        questionSeconds = loadQuestionTime(currentQKey);
        questionValue.textContent = formatTime(questionSeconds);
        questionPreview.textContent = initialQText.slice(0, 30) + '...';
        sessionStorage.setItem(SS_QUESTION_KEY, currentQKey);
        sessionStorage.setItem(SS_QUESTION_SECONDS, String(questionSeconds));
      }
    } else {
      // We restored a question key from sessionStorage — try to find the text
      const initialQText = getCurrentQuestionText();
      if (initialQText) {
        lastKnownQuestionText = initialQText;
        const newKey = questionKey(initialQText);
        if (newKey !== currentQKey) {
          // The question on the page is different from what we restored
          saveCurrentQuestionTime();
          currentQKey = newKey;
          questionSeconds = loadQuestionTime(newKey);
          questionValue.textContent = formatTime(questionSeconds);
          questionPreview.textContent = initialQText.slice(0, 30) + '...';
          sessionStorage.setItem(SS_QUESTION_KEY, currentQKey);
          sessionStorage.setItem(SS_QUESTION_SECONDS, String(questionSeconds));
          console.log(`[Sparx Timer] Question key updated from page text: ${newKey.slice(0, 40)}...`);
        }
      }
    }

    // ── Main tick ────────────────────────────────────────────────
    setInterval(() => {
      if (isPaused) return;

      // FIX #2: Homework timer ONLY ticks when we're on a homework page
      if (isOnHomework && activeHwKey) {
        homeworkSeconds++;
        homeworkValue.textContent = formatTime(homeworkSeconds);
      }

      // Question timer keeps ticking as long as we have a current question key,
      // even if the question text is temporarily not visible (answer page).
      // But it should only tick when we're on a homework page.
      if (currentQKey && isOnHomework) {
        questionSeconds++;
        questionValue.textContent = formatTime(questionSeconds);
      }
    }, 1000);

    // ── Poll for question changes ────────────────────────────────
    setInterval(() => {
      if (!isPaused && isOnHomework) checkQuestionChange();
    }, 2000);

    // ── Auto-save to localStorage every 5s + sync to chrome.storage ──
    setInterval(() => {
      if (isOnHomework) saveHomeworkTime();
      if (currentQKey) saveCurrentQuestionTime();
      syncToChromeStorage();
    }, 5000);

    // ── Save before unload ──────────────────────────────────────
    window.addEventListener('beforeunload', () => {
      if (isOnHomework && activeHwKey) {
        lsSaveHomeworkSeconds(activeHwKey, homeworkSeconds);
      }
      if (currentQKey && activeHwKey) {
        lsSaveQuestionSeconds(activeHwKey, currentQKey, questionSeconds);
        sessionStorage.setItem(SS_QUESTION_KEY, currentQKey);
        sessionStorage.setItem(SS_QUESTION_SECONDS, String(questionSeconds));
      }
      syncToChromeStorage();
    });

    // ── Move to banner ──────────────────────────────────────────
    function moveToBanner() {
      const spacing = findBannerSpacing();
      if (!spacing) {
        console.warn('[Sparx Timer] Banner spacing not found — will retry');
        return false;
      }
      timer.style.left = '';
      timer.style.top = '';
      timer.style.right = '';
      if (timer.parentElement !== spacing) {
        spacing.appendChild(timer);
      }
      timer.classList.add('in-banner');
      currentLocation = 'banner';
      lsSet(LS_LOCATION, 'banner');
      _safeStorageSet({ [TIMER_LOCATION_KEY]: 'banner' });
      _safeStorageRemove([TIMER_STORAGE_KEY]);
      localStorage.removeItem(LS_POSITION);
      console.log('[Sparx Timer] Moved to top banner');
      return true;
    }

    // ── Move to floating ────────────────────────────────────────
    function moveToFloating() {
      if (bannerRetryTimer) {
        clearInterval(bannerRetryTimer);
        bannerRetryTimer = null;
      }
      timer.classList.remove('in-banner', 'moving');
      if (timer.parentElement !== document.body) {
        document.body.appendChild(timer);
      }
      timer.style.top = '20px';
      timer.style.right = '20px';
      timer.style.left = '';
      currentLocation = 'floating';
      const pos = { left: 0, top: 20 };
      lsSet(LS_LOCATION, 'floating');
      lsSet(LS_POSITION, pos);
      _safeStorageSet({
        [TIMER_LOCATION_KEY]: 'floating',
        [TIMER_STORAGE_KEY]: pos
      });
      console.log('[Sparx Timer] Moved to floating');
    }

    // ── Banner retry mechanism ──────────────────────────────────
    let bannerRetryTimer = null;
    let bannerRetryCount = 0;
    const BANNER_MAX_RETRIES = 60;

    function startBannerRetry() {
      if (bannerRetryTimer) return;
      console.log('[Sparx Timer] Starting banner retry polling...');
      bannerRetryTimer = setInterval(() => {
        bannerRetryCount++;
        if (currentLocation !== 'banner') {
          clearInterval(bannerRetryTimer);
          bannerRetryTimer = null;
          return;
        }
        if (timer.classList.contains('in-banner') && timer.parentElement === findBannerSpacing()) {
          clearInterval(bannerRetryTimer);
          bannerRetryTimer = null;
          return;
        }
        const success = moveToBanner();
        if (success) {
          clearInterval(bannerRetryTimer);
          bannerRetryTimer = null;
          console.log('[Sparx Timer] Banner retry succeeded');
          return;
        }
        if (bannerRetryCount >= BANNER_MAX_RETRIES) {
          clearInterval(bannerRetryTimer);
          bannerRetryTimer = null;
          console.warn('[Sparx Timer] Banner retry gave up after 30s');
        }
      }, 500);
    }

    // ── Restore saved position ──────────────────────────────────
    if (currentLocation === 'banner') {
      const success = moveToBanner();
      if (!success) startBannerRetry();
    } else {
      const pos = lsGet(LS_POSITION);
      if (pos) {
        const maxX = window.innerWidth - timer.offsetWidth;
        const maxY = window.innerHeight - timer.offsetHeight;
        timer.style.left  = Math.min(Math.max(pos.left, 0), maxX) + 'px';
        timer.style.top   = Math.min(Math.max(pos.top, 0), maxY) + 'px';
        timer.style.right = 'auto';
      }
    }

    _safeStorageGet([TIMER_STORAGE_KEY, TIMER_LOCATION_KEY], (data) => {
      const storedLocation = data[TIMER_LOCATION_KEY] || 'floating';
      if (storedLocation === 'banner' && currentLocation !== 'banner') {
        currentLocation = 'banner';
        lsSet(LS_LOCATION, 'banner');
        const success = moveToBanner();
        if (!success) startBannerRetry();
      }
      if (storedLocation === 'floating' && !lsGet(LS_POSITION)) {
        const pos = data[TIMER_STORAGE_KEY];
        if (pos) {
          const maxX = window.innerWidth - timer.offsetWidth;
          const maxY = window.innerHeight - timer.offsetHeight;
          timer.style.left  = Math.min(Math.max(pos.left, 0), maxX) + 'px';
          timer.style.top   = Math.min(Math.max(pos.top, 0), maxY) + 'px';
          timer.style.right = 'auto';
          lsSet(LS_POSITION, pos);
        }
      }
    });

    // ── One-shot Move / Drag (floating only) ────────────────────
    let isMoveMode  = false;
    let isDragging  = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    function enterMoveMode() {
      if (timer.classList.contains('in-banner')) return;
      isMoveMode = true;
      isDragging = false;
      timer.classList.add('moving');
      timer.style.cursor = 'grab';
    }

    function exitMoveMode() {
      isMoveMode = false;
      isDragging = false;
      timer.classList.remove('moving');
      timer.style.cursor = '';
      const pos = {
        left: parseInt(timer.style.left, 10) || 0,
        top:  parseInt(timer.style.top, 10) || 0
      };
      lsSet(LS_POSITION, pos);
      _safeStorageSet({ [TIMER_STORAGE_KEY]: pos });
    }

    timer.addEventListener('mousedown', (e) => {
      if (!isMoveMode) return;
      isDragging = true;
      timer.style.cursor = 'grabbing';
      const rect = timer.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      timer.style.left  = (e.clientX - dragOffsetX) + 'px';
      timer.style.top   = (e.clientY - dragOffsetY) + 'px';
      timer.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      timer.style.cursor = 'grab';
      exitMoveMode();
    });

    timer.addEventListener('touchstart', (e) => {
      if (!isMoveMode) return;
      isDragging = true;
      const rect = timer.getBoundingClientRect();
      const touch = e.touches[0];
      dragOffsetX = touch.clientX - rect.left;
      dragOffsetY = touch.clientY - rect.top;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      timer.style.left  = (touch.clientX - dragOffsetX) + 'px';
      timer.style.top   = (touch.clientY - dragOffsetY) + 'px';
      timer.style.right = 'auto';
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      exitMoveMode();
    });

    console.log('[Sparx Timer] \u2713 Timer created');

    // ── SPA resilience: re-insert timer if the SPA destroys it ───
    const domObserver = new MutationObserver(() => {
      if (!document.contains(timer)) {
        saveHomeworkTime();
        if (currentQKey) saveCurrentQuestionTime();
        document.body.appendChild(timer);
        console.log('[Sparx Timer] Timer re-attached after SPA removed it');
        if (currentLocation === 'banner') {
          const spacing = findBannerSpacing();
          if (spacing && timer.parentElement !== spacing) {
            spacing.appendChild(timer);
            timer.classList.add('in-banner');
          } else if (!spacing) {
            startBannerRetry();
          }
        }
      }
      if (currentLocation === 'banner' && !timer.classList.contains('in-banner')) {
        const spacing = findBannerSpacing();
        if (spacing) {
          if (timer.parentElement !== spacing) spacing.appendChild(timer);
          timer.classList.add('in-banner');
          if (bannerRetryTimer) { clearInterval(bannerRetryTimer); bannerRetryTimer = null; }
        }
      }
      if (currentLocation === 'banner' && timer.classList.contains('in-banner')) {
        const spacing = findBannerSpacing();
        if (spacing && timer.parentElement !== spacing) {
          spacing.appendChild(timer);
        }
      }
      // Also re-inject start page timers when DOM changes on start page
      if (isOnStartPage()) {
        injectStartPageTimers();
      }
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

    // ── SPA URL change detection ────────────────────────────────
    let lastUrl = location.href;

    function onUrlChange() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      console.log('[Sparx Timer] URL changed to', location.href);

      // FIX #2: Use getHomeworkKey() directly (pure URL-based), NOT getSessionHomeworkKey().
      // getSessionHomeworkKey() could return stale sessionStorage keys.
      const newHwKey = getHomeworkKey();
      const wasOnHomework = isOnHomework;
      isOnHomework = newHwKey !== null;

      // Leaving homework (to home/start page or anywhere else)
      if (wasOnHomework && !isOnHomework) {
        saveHomeworkTime();
        if (currentQKey) saveCurrentQuestionTime();
        syncToChromeStorage();
        // Clear the question state but keep it in storage so it can be restored
        currentQKey = null;
        questionSeconds = 0;
        questionValue.textContent = '0:00';
        questionPreview.textContent = '';
        // Clear sessionStorage keys since we're no longer on a homework page
        sessionStorage.removeItem(SS_HOMEWORK_KEY);
        sessionStorage.removeItem(SS_QUESTION_KEY);
        sessionStorage.removeItem(SS_QUESTION_SECONDS);
        activeHwKey = null;
        updateHomeworkDot();
        console.log('[Sparx Timer] Left homework page \u2014 timer paused');
      }

      // Entering homework (from home/start page)
      if (!wasOnHomework && isOnHomework) {
        activeHwKey = newHwKey;
        sessionStorage.setItem(SS_HOMEWORK_KEY, activeHwKey);
        homeworkSeconds = lsGetHomeworkSeconds(activeHwKey);
        homeworkValue.textContent = formatTime(homeworkSeconds);
        updateHomeworkDot();

        // FIX #3: Restore question timer from sessionStorage if available
        const savedQKey = sessionStorage.getItem(SS_QUESTION_KEY);
        const savedQSeconds = parseInt(sessionStorage.getItem(SS_QUESTION_SECONDS) || '0', 10);
        if (savedQKey) {
          currentQKey = savedQKey;
          const lsQSeconds = lsGetQuestionSeconds(activeHwKey, currentQKey);
          questionSeconds = Math.max(savedQSeconds, lsQSeconds);
          questionValue.textContent = formatTime(questionSeconds);
          questionPreview.textContent = currentQKey.slice(0, 30) + '...';
          console.log(`[Sparx Timer] Restored question on homework entry: ${currentQKey.slice(0, 40)}...`);
        }

        console.log(`[Sparx Timer] Entered homework ${activeHwKey}: ${homeworkSeconds}s`);
      }

      // Still on a homework page — sub-page navigation
      if (wasOnHomework && isOnHomework) {
        // For sub-page navigation within the same homework, use sessionStorage
        // to keep the same homework key (prevents timer switching when URL
        // changes between /task/1/item/1 and /task/1/item/2 or answer pages)
        const sessionKey = sessionStorage.getItem(SS_HOMEWORK_KEY);

        if (sessionKey && sessionKey === activeHwKey) {
          // Same homework, sub-page change (e.g., task/1/item/1 -> answer page)
          // Save current state, keep timers running
          saveHomeworkTime();
          if (currentQKey) saveCurrentQuestionTime();
          console.log(`[Sparx Timer] Same homework ${activeHwKey}, sub-page change`);
        } else if (sessionKey && sessionKey !== activeHwKey) {
          // Different homework (session has a different key)
          saveHomeworkTime();
          if (currentQKey) saveCurrentQuestionTime();
          syncToChromeStorage();
          console.log(`[Sparx Timer] Switched homework: ${activeHwKey} \u2192 ${sessionKey}`);
          activeHwKey = sessionKey;
          homeworkSeconds = lsGetHomeworkSeconds(activeHwKey);
          homeworkValue.textContent = formatTime(homeworkSeconds);
          currentQKey = null;
          questionSeconds = 0;
          questionValue.textContent = '0:00';
          questionPreview.textContent = '';
          sessionStorage.removeItem(SS_QUESTION_KEY);
          sessionStorage.removeItem(SS_QUESTION_SECONDS);
          updateHomeworkDot();
        } else {
          // No session key — use the URL key
          if (newHwKey === activeHwKey) {
            saveHomeworkTime();
            if (currentQKey) saveCurrentQuestionTime();
            console.log(`[Sparx Timer] Same homework ${activeHwKey}, sub-page change (no session)`);
          } else {
            saveHomeworkTime();
            if (currentQKey) saveCurrentQuestionTime();
            syncToChromeStorage();
            console.log(`[Sparx Timer] Switched homework: ${activeHwKey} \u2192 ${newHwKey}`);
            activeHwKey = newHwKey;
            sessionStorage.setItem(SS_HOMEWORK_KEY, activeHwKey);
            homeworkSeconds = lsGetHomeworkSeconds(activeHwKey);
            homeworkValue.textContent = formatTime(homeworkSeconds);
            currentQKey = null;
            questionSeconds = 0;
            questionValue.textContent = '0:00';
            questionPreview.textContent = '';
            sessionStorage.removeItem(SS_QUESTION_KEY);
            sessionStorage.removeItem(SS_QUESTION_SECONDS);
            updateHomeworkDot();
          }
        }
      }

      // Navigated to the start page — inject timer badges
      if (isOnStartPage()) {
        injectStartPageTimers();
      }

      // Re-apply banner
      if (currentLocation === 'banner') {
        const spacing = findBannerSpacing();
        if (spacing) {
          if (timer.parentElement !== spacing) spacing.appendChild(timer);
          if (!timer.classList.contains('in-banner')) timer.classList.add('in-banner');
          if (bannerRetryTimer) { clearInterval(bannerRetryTimer); bannerRetryTimer = null; }
        } else {
          timer.classList.remove('in-banner');
          if (!document.contains(timer)) document.body.appendChild(timer);
          startBannerRetry();
        }
      }
    }

    const _origPushState = history.pushState;
    history.pushState = function() {
      _origPushState.apply(this, arguments);
      onUrlChange();
    };

    const _origReplaceState = history.replaceState;
    history.replaceState = function() {
      _origReplaceState.apply(this, arguments);
      onUrlChange();
    };

    window.addEventListener('popstate', onUrlChange);

    // FIX #2 (additional): Periodic URL check as fallback.
    // Some SPA navigations don't trigger pushState/replaceState/popstate
    // (e.g., the Sparx app might use its own routing that we miss).
    // Also catches cases where the URL changed but onUrlChange wasn't called.
    setInterval(() => {
      if (location.href !== lastUrl) {
        onUrlChange();
      }
      // Also double-check isOnHomework matches the actual URL state
      const actualIsOnHomework = getHomeworkKey() !== null;
      if (actualIsOnHomework !== isOnHomework) {
        console.warn(`[Sparx Timer] Detected mismatch: isOnHomework=${isOnHomework} but URL says ${actualIsOnHomework}. Fixing.`);
        onUrlChange();
      }
    }, 2000);

    // ── Expose functions for settings popup ──────────────────────
    window.__sparxTimerEnterMove   = enterMoveMode;
    window.__sparxTimerExitMove    = exitMoveMode;
    window.__sparxTimerMoveToBanner  = function() {
      currentLocation = 'banner';
      lsSet(LS_LOCATION, 'banner');
      const success = moveToBanner();
      if (!success) startBannerRetry();
    };
    window.__sparxTimerMoveToFloating = moveToFloating;
  }

  // ── Init with double-guard ────────────────────────────────────
  let _timerInitialized = false;

  function initTimer() {
    if (_timerInitialized) return;
    _timerInitialized = true;

    _safeStorageGet([TIMER_ENABLED_KEY], (data) => {
      if (data[TIMER_ENABLED_KEY] === false) {
        console.log('[Sparx Timer] Timer is disabled in settings.');
        return;
      }
      createTimer();
      // Also inject start page timers if we're on the start page
      if (isOnStartPage()) {
        injectStartPageTimers();
      }
    });
  }

  // ── Listen for settings changes from popup ────────────────────
  document.addEventListener('sparxless-timer-action', (e) => {
    const { action, enabled } = e.detail;
    if (action === 'TIMER_TOGGLE') {
      const el = document.getElementById('sparx-custom-timer');
      if (enabled && !el) {
        createTimer();
        if (isOnStartPage()) injectStartPageTimers();
      } else if (!enabled && el) {
        el.remove();
      }
    }
    if (action === 'TIMER_RESET_POS') {
      const el = document.getElementById('sparx-custom-timer');
      if (el) {
        el.style.left = '';
        el.style.top  = '';
        el.style.right = '20px';
        _safeStorageRemove([TIMER_STORAGE_KEY]);
        localStorage.removeItem(LS_POSITION);
      }
    }
    if (action === 'TIMER_ENTER_MOVE') {
      if (window.__sparxTimerEnterMove) window.__sparxTimerEnterMove();
    }
    if (action === 'TIMER_EXIT_MOVE') {
      if (window.__sparxTimerExitMove) window.__sparxTimerExitMove();
    }
    if (action === 'TIMER_MOVE_TO_BANNER') {
      if (window.__sparxTimerMoveToBanner) window.__sparxTimerMoveToBanner();
    }
    if (action === 'TIMER_MOVE_TO_FLOATING') {
      if (window.__sparxTimerMoveToFloating) window.__sparxTimerMoveToFloating();
    }
  });

  // Also listen via chrome.runtime.onMessage
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      const timerActions = ['TIMER_TOGGLE', 'TIMER_RESET_POS', 'TIMER_ENTER_MOVE', 'TIMER_EXIT_MOVE', 'TIMER_MOVE_TO_BANNER', 'TIMER_MOVE_TO_FLOATING'];
      if (timerActions.includes(msg.action)) {
        document.dispatchEvent(new CustomEvent('sparxless-timer-action', {
          detail: msg
        }));
      }
      return false;
    });
  } catch { /* context invalidated */ }

  // ── Boot ──────────────────────────────────────────────────────
  if (document.body && document.head) {
    initTimer();
  } else {
    document.addEventListener('DOMContentLoaded', initTimer);
    setTimeout(initTimer, 1000);
  }

})(); // end IIFE
