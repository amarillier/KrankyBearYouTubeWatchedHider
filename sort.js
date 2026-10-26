// Shared by the YouTube content scripts and the popup.
// mode: 'manual' (stored order) | 'az' | 'za' | 'unwatched'
// countOf(channel) returns the unwatched count, or null when not loaded yet.
globalThis.KBSort = {
  // Unwatched summary for one channel's cached feed entry (null if not loaded).
  // shorts: { videoId: true|false }; unknown videos are treated as normal videos.
  channelStats(entry, watched, threshold, shorts, includeShorts) {
    if (!entry) return null;
    const unwatched = [];
    let eligible = 0;
    let skippedShorts = 0;
    for (const id of entry.videos) {
      const isUnwatched = (watched[id] || 0) < threshold;
      if (shorts[id] === true && !includeShorts) {
        if (isUnwatched) skippedShorts++;
        continue;
      }
      eligible++;
      if (isUnwatched) unwatched.push(id);
    }
    return { unwatched, eligible, skippedShorts };
  },

  sortChannels(channels, mode, countOf) {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const list = channels.slice();
    if (mode === 'az') return list.sort(byName);
    if (mode === 'za') return list.sort((a, b) => byName(b, a));
    if (mode === 'unwatched') {
      const n = (c) => {
        const v = countOf(c);
        return v === null ? -1 : v; // channels with no count yet go last
      };
      return list.sort((a, b) => n(b) - n(a) || byName(a, b));
    }
    return list;
  },
};
