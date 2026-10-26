const DEFAULTS = { enabled: true, threshold: 10, showButton: true, showStripOnHome: false, channelSort: 'manual', includeShorts: false, hideShorts: false, hideReleases: false };
const BACKUP_KIND = 'kb-youtube-hider-backup';
const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };

function say(text) {
  $('status').textContent = text;
}

async function refreshStats() {
  const { watched = {} } = await chrome.storage.local.get('watched');
  $('stats').textContent = `${Object.keys(watched).length.toLocaleString()} videos remembered`;
}

async function renderChannels() {
  const { channels = [], feedCache = {}, shortsCache = {}, watched = {}, settings: stored } =
    await chrome.storage.local.get(['channels', 'feedCache', 'shortsCache', 'watched', 'settings']);
  const threshold = Math.max(1, (stored && stored.threshold) || DEFAULTS.threshold);
  const includeShorts = !!(stored && stored.includeShorts);
  const statsOf = (c) =>
    KBSort.channelStats(feedCache[c.id], watched, threshold, shortsCache, includeShorts);
  const countOf = (c) => {
    const stats = statsOf(c);
    return stats ? stats.unwatched.length : null;
  };
  const ordered = KBSort.sortChannels(channels, (stored && stored.channelSort) || 'manual', countOf);
  const list = $('channels');
  list.textContent = '';
  if (!channels.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'None yet. Open a channel on YouTube and click "+ Track channel".';
    list.appendChild(li);
    return;
  }
  for (const c of ordered) {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin:3px 0;';
    li.draggable = true;
    li.dataset.id = c.id;
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', c.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.style.outline = '2px solid #3ea6ff';
    });
    li.addEventListener('dragleave', () => { li.style.outline = ''; });
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.style.outline = '';
      const fromId = e.dataTransfer.getData('text/plain');
      if (!fromId || fromId === c.id) return;
      // Take the order currently on screen, move the dragged channel to the drop position.
      const ids = ordered.map((x) => x.id);
      ids.splice(ids.indexOf(fromId), 1);
      ids.splice(ids.indexOf(c.id) + (ordered.findIndex((x) => x.id === fromId) < ordered.findIndex((x) => x.id === c.id) ? 1 : 0), 0, fromId);
      const byId = new Map(channels.map((x) => [x.id, x]));
      settings.channelSort = 'manual';
      $('channelSort').value = 'manual';
      await chrome.storage.local.set({ channels: ids.map((id) => byId.get(id)), settings });
      renderChannels();
    });
    const handle = document.createElement('span');
    handle.textContent = '☰';
    handle.title = 'Drag to reorder';
    handle.style.cssText = 'cursor:grab;color:#999;margin-right:8px;';
    li.appendChild(handle);
    const name = document.createElement('a');
    name.textContent = c.name;
    name.href = `https://www.youtube.com${c.path}/videos`;
    name.target = '_blank';
    name.style.cssText = 'flex:1;color:inherit;';

    const badge = document.createElement('span');
    const stats = statsOf(c);
    const n = stats ? stats.unwatched.length : null;
    let details = null;
    if (stats) {
      const capped = n > 0 && n === stats.eligible; // every recent upload unwatched; may be more
      badge.textContent = capped ? `${n}+` : String(n);
      badge.title = `${n} unwatched of the latest ${stats.eligible} uploads. Click to see which.`;
      badge.style.cssText =
        'margin:0 8px;padding:1px 7px;border-radius:10px;font-size:12px;color:#fff;cursor:pointer;' +
        `background:${n ? '#cc0000' : '#999'};`;

      // Click the badge to list exactly which videos are being counted.
      details = document.createElement('div');
      details.style.cssText = 'display:none;flex-basis:100%;margin:2px 0 6px 22px;font-size:12px;';
      const info = feedCache[c.id].info || {};
      for (const id of stats.unwatched) {
        const row = document.createElement('div');
        const link = document.createElement('a');
        link.href = `https://www.youtube.com/watch?v=${id}`;
        link.target = '_blank';
        link.textContent = (info[id] && info[id].title) || id;
        link.style.color = 'inherit';
        row.append(link, ` ${(info[id] && info[id].published) || ''}${shortsCache[id] ? ' [Short]' : ''}`);
        details.appendChild(row);
      }
      if (stats.skippedShorts) {
        const note = document.createElement('div');
        note.className = 'muted';
        note.textContent = `${stats.skippedShorts} unwatched Shorts not counted.`;
        details.appendChild(note);
      }
      if (!n && !stats.skippedShorts) {
        const none = document.createElement('div');
        none.className = 'muted';
        none.textContent = 'Nothing unwatched in the latest uploads.';
        details.appendChild(none);
      }
      badge.addEventListener('click', () => {
        details.style.display = details.style.display === 'none' ? 'block' : 'none';
      });
    } else {
      badge.textContent = '…';
      badge.title = 'Counts load when you open the Subscriptions page';
      badge.className = 'muted';
      badge.style.margin = '0 8px';
    }

    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = 'Stop tracking';
    remove.addEventListener('click', async () => {
      const { channels: current = [] } = await chrome.storage.local.get('channels');
      await chrome.storage.local.set({ channels: current.filter((x) => x.id !== c.id) });
      renderChannels();
    });
    li.append(name, badge, remove);
    if (details) li.appendChild(details);
    name.draggable = false;
    list.appendChild(li);
  }
}

function save() {
  return chrome.storage.local.set({ settings });
}

async function init() {
  const stored = await chrome.storage.local.get('settings');
  settings = { ...DEFAULTS, ...stored.settings };

  $('enabled').checked = settings.enabled;
  $('showButton').checked = settings.showButton;
  $('showStripOnHome').checked = settings.showStripOnHome;
  $('channelSort').value = settings.channelSort;
  $('includeShorts').checked = settings.includeShorts;
  $('hideShorts').checked = settings.hideShorts;
  $('hideReleases').checked = settings.hideReleases;
  $('threshold').value = settings.threshold;
  $('thresholdValue').textContent = settings.threshold;
  refreshStats();
  renderChannels();

  $('enabled').addEventListener('change', (e) => { settings.enabled = e.target.checked; save(); });
  $('showButton').addEventListener('change', (e) => { settings.showButton = e.target.checked; save(); });
  $('showStripOnHome').addEventListener('change', (e) => { settings.showStripOnHome = e.target.checked; save(); });
  $('hideShorts').addEventListener('change', (e) => { settings.hideShorts = e.target.checked; save(); });
  $('hideReleases').addEventListener('change', (e) => { settings.hideReleases = e.target.checked; save(); });
  $('includeShorts').addEventListener('change', async (e) => {
    settings.includeShorts = e.target.checked;
    await save();
    renderChannels();
  });
  $('channelSort').addEventListener('change', async (e) => {
    settings.channelSort = e.target.value;
    await save();
    renderChannels();
  });
  $('threshold').addEventListener('input', (e) => {
    settings.threshold = Number(e.target.value);
    $('thresholdValue').textContent = settings.threshold;
    save();
  });
}

// Google Takeout: "YouTube and YouTube Music" > history, JSON format -> watch-history.json
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const { watched = {}, channels = [] } = await chrome.storage.local.get(['watched', 'channels']);
    const before = Object.keys(watched).length;
    let message;

    if (Array.isArray(data)) {
      // Google Takeout watch-history.json
      for (const entry of data) {
        const m = /[?&]v=([\w-]{11})/.exec(entry.titleUrl || '');
        if (m) watched[m[1]] = 100;
      }
      await chrome.storage.local.set({ watched });
      message = `Imported Takeout history: ${(Object.keys(watched).length - before).toLocaleString()} new videos.`;
    } else if (data && data.kind === BACKUP_KIND) {
      // Full backup from this extension: merge watched, add missing channels, apply settings.
      for (const [id, pct] of Object.entries(data.watched || {})) {
        watched[id] = Math.max(watched[id] || 0, pct);
      }
      const known = new Set(channels.map((c) => c.id));
      const newChannels = (data.channels || []).filter((c) => !known.has(c.id));
      const merged = channels.concat(newChannels);
      const importedSettings = { ...DEFAULTS, ...data.settings };
      await chrome.storage.local.set({ watched, channels: merged, settings: importedSettings });
      message =
        `Restored backup: ${(Object.keys(watched).length - before).toLocaleString()} new videos, ` +
        `${newChannels.length} new channels, settings applied.`;
      settings = importedSettings;
      say(message);
      setTimeout(() => location.reload(), 1200);
      e.target.value = '';
      return;
    } else if (data && typeof data === 'object') {
      // Older plain export: { videoId: percent }
      for (const [id, pct] of Object.entries(data)) {
        if (/^[\w-]{11}$/.test(id) && typeof pct === 'number') watched[id] = Math.max(watched[id] || 0, pct);
      }
      await chrome.storage.local.set({ watched });
      message = `Imported ${(Object.keys(watched).length - before).toLocaleString()} new videos.`;
    } else {
      throw new Error('unrecognised file');
    }
    say(message);
    refreshStats();
  } catch (err) {
    say(`Import failed: ${err.message}. Use a backup from this extension, or the Takeout JSON (not HTML).`);
  }
  e.target.value = '';
});

$('help').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

$('export').addEventListener('click', async () => {
  const { watched = {}, channels = [], settings: stored } =
    await chrome.storage.local.get(['watched', 'channels', 'settings']);
  const backup = {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...DEFAULTS, ...stored },
    channels,
    watched,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `youtube-hider-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Forget all remembered videos? YouTube\'s own progress bars will still be detected.')) return;
  await chrome.storage.local.set({ watched: {} });
  say('Memory cleared.');
  refreshStats();
});

init();
