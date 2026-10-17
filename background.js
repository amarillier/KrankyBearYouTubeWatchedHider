// Open the help page once, right after the extension is first installed.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  }
});
