// Shared by the YouTube content scripts and the popup.
// mode: 'manual' (stored order) | 'az' | 'za' | 'unwatched'
// countOf(channel) returns the unwatched count, or null when not loaded yet.
globalThis.KBSort = {
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
