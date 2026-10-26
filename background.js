// Open the help page once, right after the extension is first installed.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  }
});

// Keyboard shortcut: flip the same setting as the on-page and popup toggles.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-hiding') return;
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, enabled: settings.enabled === false } });
});
