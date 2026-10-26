(() => {
  'use strict';

  // Outermost containers for a video tile across the old and new YouTube layouts.
  const TILE_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytd-reel-item-renderer',
  ].join(',');

  // Red "resume playback" bar on thumbnails (old and new markup). Width is a percentage.
  const PROGRESS_SELECTOR = [
    'ytd-thumbnail-overlay-resume-playback-renderer #progress',
    '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
  ].join(',');

  const HIDE_CLASS = 'kb-watched-hidden';
  const DEFAULTS = { enabled: true, threshold: 10, showButton: true, hideShorts: false, hideReleases: false };

  // Shelves that carry a heading, and the tabs on a channel page, are matched by their visible
  // English label (YouTube gives them no stable class), so this part is English-only.
  const SHELF_SELECTOR = 'ytd-shelf-renderer, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer';
  const SHELF_SECTION_SELECTOR = 'ytd-item-section-renderer, ytd-rich-section-renderer';
  const UI_HIDE_CLASS = 'kb-ui-hidden';
  const SHORTS_LABEL = /^shorts$/i;
  const RELEASES_LABEL = /^(latest )?releases$/i;

  let settings = { ...DEFAULTS };
  let watched = {}; // videoId -> highest progress percentage seen (0-100)
  let pending = {}; // changes not yet written to storage
  let flushTimer = null;
  let scanTimer = null;
  let button = null;
  let lastTrackSave = 0;
  let observer = null;
  let scanInterval = null;
  let missedScans = 0; // consecutive scans that found video links but no tiles

  // ---- storage -------------------------------------------------------------

  // watched[id] === -1 means "marked unwatched": YouTube's own bar is ignored for it, but
  // real playback (fromPlayback) replaces the override.
  function remember(id, pct, fromPlayback) {
    if (watched[id] === -1 && !fromPlayback) return;
    if (pct > (watched[id] || 0)) {
      watched[id] = pct;
      pending[id] = pct;
      if (!flushTimer) flushTimer = setTimeout(flush, 2000);
    }
  }

  async function flush() {
    flushTimer = null;
    const batch = pending;
    pending = {};
    if (!Object.keys(batch).length) return;
    try {
      // Read-merge-write so several open YouTube tabs don't overwrite each other.
      const { watched: current = {} } = await chrome.storage.local.get('watched');
      for (const [id, pct] of Object.entries(batch)) {
        current[id] = Math.max(current[id] || 0, pct);
      }
      await chrome.storage.local.set({ watched: current });
    } catch (e) {
      // Extension was reloaded or updated; this content script is orphaned.
    }
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...DEFAULTS, ...changes.settings.newValue };
    }
    if (changes.watched) {
      watched = { ...changes.watched.newValue };
      for (const [id, pct] of Object.entries(pending)) {
        watched[id] = Math.max(watched[id] || 0, pct);
      }
    }
    scheduleScan();
  });

  // ---- tile scanning -------------------------------------------------------

  function videoIdOf(tile) {
    const a = tile.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
    if (!a) return null;
    let url;
    try {
      url = new URL(a.getAttribute('href'), location.origin);
    } catch (e) {
      return null;
    }
    if (url.searchParams.has('list')) return null; // playlists and mixes, not single videos
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const m = url.pathname.match(/^\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  function progressOf(tile) {
    const bar = tile.querySelector(PROGRESS_SELECTOR);
    if (!bar) return 0;
    const pct = parseFloat(bar.style.width);
    return Number.isFinite(pct) ? Math.min(100, Math.round(pct)) : 0;
  }

  function isShortTile(tile) {
    return !!tile.querySelector('a[href^="/shorts/"]');
  }

  // Tabs and headed shelves that are hidden by label rather than by tag.
  function applyLabelHiding(onHistory) {
    const hideShorts = settings.hideShorts && !onHistory;
    const want = new Set();
    if (hideShorts || settings.hideReleases) {
      const matches = (label) =>
        (hideShorts && SHORTS_LABEL.test(label)) || (settings.hideReleases && RELEASES_LABEL.test(label));
      for (const tab of document.querySelectorAll('yt-tab-shape')) {
        if (matches((tab.getAttribute('tab-title') || tab.textContent).trim())) want.add(tab);
      }
      for (const shelf of document.querySelectorAll(SHELF_SELECTOR)) {
        const title = shelf.querySelector('#title');
        if (title && matches(title.textContent.trim())) {
          want.add(shelf.closest(SHELF_SECTION_SELECTOR) || shelf);
        }
      }
    }
    for (const el of document.querySelectorAll(`.${UI_HIDE_CLASS}`)) {
      if (!want.has(el)) el.classList.remove(UI_HIDE_CLASS);
    }
    for (const el of want) el.classList.add(UI_HIDE_CLASS);
    document.documentElement.classList.toggle('kb-no-shorts', hideShorts);
  }

  function scan() {
    scanTimer = null;
    const onHistory = location.pathname.startsWith('/feed/history');
    const suppress = !settings.enabled || onHistory;
    const hideShorts = settings.hideShorts && !onHistory;
    let tileCount = 0;
    const threshold = Math.max(1, settings.threshold);
    let hiddenCount = 0;
    let shownCount = 0;
    let watchedCount = 0;

    for (const tile of document.querySelectorAll(TILE_SELECTOR)) {
      if (tile.parentElement && tile.parentElement.closest(TILE_SELECTOR)) continue;
      const id = videoIdOf(tile);
      if (!id) continue;
      tileCount++;

      const short = isShortTile(tile);
      tile.classList.toggle('kb-shorts-hidden', hideShorts && short);
      if (hideShorts && short) continue;

      remember(id, progressOf(tile));
      const isWatched = (watched[id] || 0) >= threshold;
      const hide = !suppress && isWatched;
      tile.classList.toggle(HIDE_CLASS, hide);
      ensureMarkButton(tile, id, isWatched);
      if (isWatched) watchedCount++;
      if (hide) hiddenCount++;
      else shownCount++;
    }
    applyLabelHiding(onHistory);

    // Video links on the page but no recognised tiles: the selectors have probably gone stale.
    // Links with a list= are playlist rows, which aren't tiles, so they don't count.
    if (tileCount === 0 && document.querySelectorAll('a[href*="/watch?v="]:not([href*="list="])').length >= 5) {
      missedScans++;
    } else {
      missedScans = 0;
    }
    const stale = missedScans >= 2;
    if (missedScans === 2) console.warn('[YouTube Watched Hider] No video tiles recognised; YouTube may have changed its layout.');
    updateButton(hiddenCount, shownCount, watchedCount, stale);
  }

  // ---- manual "mark as watched" -------------------------------------------

  // Set a video's progress directly, allowing it to go down. 0 clears it; -1 marks it unwatched.
  async function setWatched(id, pct) {
    if (pct !== 0) watched[id] = pct;
    else delete watched[id];
    delete pending[id];
    try {
      const { watched: current = {} } = await chrome.storage.local.get('watched');
      if (pct !== 0) current[id] = pct;
      else delete current[id];
      await chrome.storage.local.set({ watched: current });
    } catch (e) {
      // Extension was reloaded; nothing more to do.
    }
    scheduleScan();
  }

  function ensureMarkButton(tile, id, isWatched) {
    tile.classList.add('kb-tile');
    let btn = tile.querySelector(':scope > .kb-mark');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kb-mark';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const markId = btn.dataset.videoId;
        const unmark = btn.dataset.mode === 'unmark';
        const previous = watched[markId] || 0;
        setWatched(markId, unmark ? -1 : 100);
        showToast(unmark ? 'Marked as unwatched' : 'Marked as watched', () => setWatched(markId, previous));
      });
      tile.appendChild(btn);
    }
    btn.dataset.videoId = id; // YouTube reuses tile elements for different videos
    btn.dataset.mode = isWatched ? 'unmark' : 'mark';
    btn.textContent = isWatched ? '✗ Unwatch' : '✓ Watched';
    btn.title = isWatched ? 'Mark this video as unwatched' : 'Mark this video as fully watched';
  }

  let toast = null;
  let toastTimer = null;

  function showToast(text, onUndo) {
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'kb-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = `${text} `;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => {
      onUndo();
      toast.style.display = 'none';
    });
    toast.appendChild(undo);
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 6000);
  }

  function scheduleScan() {
    if (!chrome.runtime || !chrome.runtime.id) {
      teardown(); // extension was reloaded; this script is orphaned
      return;
    }
    if (document.hidden) return; // catches up on visibilitychange
    if (!scanTimer) scanTimer = setTimeout(scan, 150);
  }

  function teardown() {
    if (observer) observer.disconnect();
    clearInterval(scanInterval);
    document.removeEventListener('yt-navigate-finish', scheduleScan);
    observer = null;
  }

  // ---- playback tracking ---------------------------------------------------

  function playingVideoId() {
    if (location.pathname.startsWith('/shorts/')) {
      const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
      return m ? m[1] : null;
    }
    const flexy = document.querySelector('ytd-watch-flexy');
    const fromPlayer = flexy && flexy.getAttribute('video-id');
    if (fromPlayer) return fromPlayer;
    return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
  }

  function track(event, force) {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    // Ignore hover previews; only the main watch player and the active Short count.
    if (!video.closest('ytd-watch-flexy #movie_player, ytd-reel-video-renderer[is-active]')) return;
    const player = video.closest('.html5-video-player');
    if (player && player.classList.contains('ad-showing')) return;
    if (!video.duration || !Number.isFinite(video.duration)) return;

    const now = Date.now();
    if (!force && now - lastTrackSave < 3000) return;
    lastTrackSave = now;

    const id = playingVideoId();
    if (!id) return;
    const pct = Math.round((video.currentTime / video.duration) * 100);
    if (pct >= 1) {
      remember(id, Math.min(100, pct), true);
      if (force && flushTimer) {
        clearTimeout(flushTimer);
        flush();
      }
    }
  }

  document.addEventListener('timeupdate', (e) => track(e, false), true);
  document.addEventListener('pause', (e) => track(e, true), true);
  document.addEventListener('ended', (e) => track(e, true), true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleScan();
    if (document.visibilityState === 'hidden' && flushTimer) {
      clearTimeout(flushTimer);
      flush();
    }
  });
  window.addEventListener('pagehide', () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flush();
    }
  });

  // ---- on-page toggle ------------------------------------------------------

  function updateButton(hiddenCount, shownCount, watchedCount, stale) {
    if (!settings.showButton) {
      if (button) button.remove();
      button = null;
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.id = 'kb-toggle';
      button.type = 'button';
      button.addEventListener('click', () => {
        settings.enabled = !settings.enabled;
        chrome.storage.local.set({ settings });
        scheduleScan();
      });
      document.body.appendChild(button);
    }
    button.classList.toggle('kb-on', settings.enabled && !stale);
    button.classList.toggle('kb-warn', !!stale);
    button.textContent = stale
      ? "⚠ Can't find videos on this page, YouTube's layout may have changed"
      : settings.enabled
      ? `Hiding watched · ${hiddenCount} hidden · ${shownCount} shown`
      : `Showing all · ${shownCount} shown (${watchedCount} watched)`;
    button.title = 'Click to toggle hiding of watched videos';
  }

  // ---- startup -------------------------------------------------------------

  async function init() {
    const stored = await chrome.storage.local.get(['settings', 'watched']);
    settings = { ...DEFAULTS, ...stored.settings };
    watched = stored.watched || {};

    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener('yt-navigate-finish', scheduleScan);
    // Progress bars can be filled in after a tile is inserted; catch those too.
    scanInterval = setInterval(scheduleScan, 3000);
    scan();
  }

  init();
})();
