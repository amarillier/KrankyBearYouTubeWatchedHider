(() => {
  'use strict';

  const CACHE_TTL = 15 * 60 * 1000;
  const RETRY_DELAY = 60 * 1000;
  const DEFAULT_THRESHOLD = 10;

  let channels = []; // [{ id, name, path }]
  let cache = {}; // channelId -> { t, videos: [videoId, ...] } (latest 15 uploads)
  let watched = {};
  let threshold = DEFAULT_THRESHOLD;
  let showOnHome = false;
  let sortMode = 'manual';

  const lastAttempt = {};
  let refreshing = false;
  let strip = null;
  let stripSig = '';
  let trackBtn = null;

  // ---- data ----------------------------------------------------------------

  const feedUrl = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

  function parseFeed(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const title = doc.querySelector('feed > title');
    const videos = [];
    for (const entry of doc.getElementsByTagName('entry')) {
      const idEl = entry.getElementsByTagName('yt:videoId')[0];
      if (idEl) videos.push(idEl.textContent);
    }
    return { name: title ? title.textContent : '', videos };
  }

  async function fetchFeed(id) {
    const res = await fetch(feedUrl(id), { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text());
  }

  async function load() {
    const s = await chrome.storage.local.get(['channels', 'feedCache', 'watched', 'settings']);
    channels = s.channels || [];
    cache = s.feedCache || {};
    watched = s.watched || {};
    threshold = Math.max(1, (s.settings && s.settings.threshold) || DEFAULT_THRESHOLD);
    showOnHome = !!(s.settings && s.settings.showStripOnHome);
    sortMode = (s.settings && s.settings.channelSort) || 'manual';
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.channels) channels = changes.channels.newValue || [];
    if (changes.feedCache) cache = changes.feedCache.newValue || {};
    if (changes.watched) watched = changes.watched.newValue || {};
    if (changes.settings) {
      const s = changes.settings.newValue || {};
      threshold = Math.max(1, s.threshold || DEFAULT_THRESHOLD);
      showOnHome = !!s.showStripOnHome;
      sortMode = s.channelSort || 'manual';
    }
    tick();
  });

  async function refresh(force) {
    if (refreshing || !channels.length) return;
    const now = Date.now();
    const due = channels.filter((c) => {
      if (!force && now - (lastAttempt[c.id] || 0) < RETRY_DELAY) return false;
      return force || !cache[c.id] || now - cache[c.id].t > CACHE_TTL;
    });
    if (!due.length) return;

    refreshing = true;
    try {
      const results = await Promise.all(due.map(async (c) => {
        lastAttempt[c.id] = now;
        try {
          return [c.id, { t: now, videos: (await fetchFeed(c.id)).videos }];
        } catch (e) {
          return null; // keep any older cached value
        }
      }));
      const { feedCache: current = {} } = await chrome.storage.local.get('feedCache');
      for (const r of results) if (r) current[r[0]] = r[1];
      const keep = new Set(channels.map((c) => c.id));
      for (const id of Object.keys(current)) if (!keep.has(id)) delete current[id];
      await chrome.storage.local.set({ feedCache: current });
    } catch (e) {
      // Extension reloaded; ignore.
    } finally {
      refreshing = false;
    }
  }

  function unwatchedCount(channelId) {
    const entry = cache[channelId];
    if (!entry) return null;
    return entry.videos.filter((id) => (watched[id] || 0) < threshold).length;
  }

  // ---- "track this channel" button ----------------------------------------

  const CHANNEL_PATH = /^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)/;
  const resolved = {}; // channel base path -> channel ID (null while looking up)

  // Look the ID up from the channel page's own HTML rather than the live document,
  // whose <link> tags can be stale or missing after in-page navigation.
  function resolveChannelId(base) {
    if (resolved[base] !== undefined) return;
    resolved[base] = null;
    const retryLater = () => setTimeout(() => { delete resolved[base]; }, 10000);
    fetch(base, { credentials: 'omit' })
      .then((r) => r.text())
      .then((html) => {
        const m =
          /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html) ||
          /feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/.exec(html) ||
          /"externalId":"(UC[\w-]{22})"/.exec(html);
        if (m) {
          resolved[base] = m[1];
          tick();
        } else {
          retryLater();
        }
      })
      .catch(retryLater);
  }

  function currentChannel() {
    const m = location.pathname.match(CHANNEL_PATH);
    if (!m) return null;
    const base = `/${m[1]}`;
    const direct = base.match(/^\/channel\/(UC[\w-]{22})$/);
    if (direct) return { id: direct[1], path: base };
    resolveChannelId(base);
    return resolved[base] ? { id: resolved[base], path: base } : null;
  }

  async function toggleTracked() {
    const ch = currentChannel();
    if (!ch) return;
    const { channels: stored = [] } = await chrome.storage.local.get('channels');
    if (stored.some((c) => c.id === ch.id)) {
      await chrome.storage.local.set({ channels: stored.filter((c) => c.id !== ch.id) });
      return;
    }
    let name = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    try {
      const feed = await fetchFeed(ch.id);
      if (feed.name) name = feed.name;
      const { feedCache: current = {} } = await chrome.storage.local.get('feedCache');
      current[ch.id] = { t: Date.now(), videos: feed.videos };
      await chrome.storage.local.set({ feedCache: current });
    } catch (e) {
      // Name from the page title is good enough; counts load later.
    }
    stored.push({ id: ch.id, name, path: ch.path });
    await chrome.storage.local.set({ channels: stored });
  }

  function renderTrackButton() {
    const ch = currentChannel();
    if (!ch) {
      if (trackBtn) trackBtn.remove();
      trackBtn = null;
      return;
    }
    if (!trackBtn) {
      trackBtn = document.createElement('button');
      trackBtn.id = 'kb-track';
      trackBtn.type = 'button';
      trackBtn.addEventListener('click', toggleTracked);
      document.body.appendChild(trackBtn);
    }
    const tracked = channels.some((c) => c.id === ch.id);
    trackBtn.classList.toggle('kb-on', tracked);
    trackBtn.textContent = tracked ? '✓ Tracking (click to remove)' : '+ Track channel';
  }

  // ---- dashboard strip on /feed/subscriptions ------------------------------

  // Which page the strip belongs on right now: 'subscriptions', 'home', or null.
  function stripPage() {
    if (location.pathname === '/feed/subscriptions') return 'subscriptions';
    if (location.pathname === '/' && showOnHome) return 'home';
    return null;
  }

  function renderStrip() {
    const page = stripPage();
    if (!page) {
      if (strip) strip.remove();
      strip = null;
      stripSig = '';
      return;
    }

    const ordered = KBSort.sortChannels(channels, sortMode, (c) => unwatchedCount(c.id));
    const sig = JSON.stringify(ordered.map((c) => [c.id, c.name, c.path, unwatchedCount(c.id)]));
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'kb-strip';
      stripSig = '';
    }
    if (sig !== stripSig) {
      stripSig = sig;
      strip.textContent = '';

      const label = document.createElement('span');
      label.className = 'kb-strip-label';
      label.textContent = 'Tracked channels';
      strip.appendChild(label);

      if (!channels.length) {
        const hint = document.createElement('span');
        hint.className = 'kb-strip-hint';
        hint.textContent = 'Open a channel and click "+ Track channel" to add it here.';
        strip.appendChild(hint);
      }

      for (const c of ordered) {
        const n = unwatchedCount(c.id);
        const chip = document.createElement('a');
        chip.className = 'kb-chip';
        chip.href = `${c.path}/videos`;
        chip.title = n === null ? 'Loading...' : `${n} unwatched of the latest ${cache[c.id].videos.length} uploads`;
        chip.appendChild(document.createTextNode(c.name));
        const badge = document.createElement('span');
        badge.className = 'kb-badge' + (n ? '' : ' kb-zero');
        const capped = n > 0 && n === cache[c.id].videos.length; // all recent uploads unwatched
        badge.textContent = n === null ? '…' : capped ? `${n}+` : String(n);
        chip.appendChild(badge);
        strip.appendChild(chip);
      }

      if (channels.length) {
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.className = 'kb-strip-refresh';
        reload.textContent = '↻';
        reload.title = 'Refresh counts';
        reload.addEventListener('click', () => refresh(true));
        strip.appendChild(reload);
      }
    }

    const host =
      document.querySelector(`ytd-browse[page-subtype="${page}"] #primary`) ||
      document.querySelector('ytd-browse:not([hidden]) #primary');
    if (host) {
      strip.classList.remove('kb-fixed');
      if (strip.parentElement !== host || host.firstElementChild !== strip) host.prepend(strip);
    } else {
      strip.classList.add('kb-fixed');
      if (strip.parentElement !== document.body) document.body.appendChild(strip);
    }
  }

  // ---- startup -------------------------------------------------------------

  function tick() {
    renderTrackButton();
    renderStrip();
    if (stripPage()) refresh(false);
  }

  async function init() {
    await load();
    document.addEventListener('yt-navigate-finish', tick);
    setInterval(tick, 2000);
    tick();
  }

  init();
})();
