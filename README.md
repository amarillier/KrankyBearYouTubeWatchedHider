# KrankyBear YouTube Watched Hider

A Chrome extension that hides YouTube videos you've already watched, lets you mark videos as watched, and gives you a short dashboard of the channels you actually follow, with an unwatched count for each.

No API key, no account, no server. Everything is stored locally in your browser.

## Features

- Hide watched videos on Home, Subscriptions, channel pages, search and the watch-page sidebar, with a one-click on/off toggle.
- Detects watched videos from YouTube's own progress bars, your playback, manual marks, and an optional Google Takeout import.
- Hover a thumbnail and click **Watched** to mark a video as fully watched (with Undo).
- Track channels and see unwatched counts on the Subscriptions page (optionally Home). Sort A-Z, Z-A, most unwatched, or drag into your own order.
- Backup and restore of settings, channels and watched videos. Imports merge, so you can move between computers without overwriting either side.

The in-extension help page (`help.html`) explains each feature in detail. It opens on first install, from the popup's **How it works** link, and from the extension's Options.

## Install

The extension isn't on the Chrome Web Store, so you load it from source:

1. Download or clone this repository (`git clone https://github.com/amarillier/KrankyBearYouTubeWatchedHider.git`), and put the folder somewhere permanent. Chrome reads the files from that location, so moving or deleting the folder breaks the extension.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the repository folder.
4. Refresh any open YouTube tabs.

To update, pull or download the new files, click the reload arrow on the extension at `chrome://extensions`, and refresh YouTube.

## Limitations

- Tracked-channel counts use each channel's 15 most recent uploads (from its public RSS feed). `15+` means all 15 are unwatched.
- YouTube changes its page markup from time to time. If tiles stop hiding, the selectors at the top of `content.js` (`TILE_SELECTOR`, `PROGRESS_SELECTOR`) are the place to look.
- Videos you watched elsewhere only count once the extension has seen their progress. Import your Takeout `watch-history.json` to cover older history.
- Extensions loaded unpacked don't sync between computers. Use **Export backup** and **Import** instead.

## Privacy

The extension reads the YouTube pages you visit and fetches the public RSS feed (`youtube.com/feeds/videos.xml`) for each tracked channel. Data is stored with `chrome.storage.local` and is never sent anywhere.

## License

Copyright (C) 2026 Allan Marillier

GNU General Public License v3.0. See [LICENSE](LICENSE).

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension definition (Manifest V3) |
| `content.js` / `content.css` | Hiding, watch tracking, mark-as-watched, on-page toggle |
| `channels.js` | Track-channel button and the dashboard strip |
| `sort.js` | Channel sort logic shared by the page scripts and popup |
| `popup.html` / `popup.js` | Toolbar popup: settings, channel list, backup |
| `help.html` | Help page |
| `background.js` | Opens the help page on first install |
| `icons/` | Toolbar and store icons |

## Compatibility

Developed and tested in Google Chrome on macOS and Windows. Other Chromium-based browsers (Edge, Brave and similar) should work the same way but haven't been tested.

## Contributing

Bug reports and pull requests are welcome via [GitHub issues](https://github.com/amarillier/KrankyBearYouTubeWatchedHider/issues). When reporting a hiding problem, include the page you were on (Home, Subscriptions, channel, search) and, if you can, the tag name of a tile that didn't hide, since YouTube's page markup is the most common cause.

## Disclaimer

This is an independent project and is not affiliated with, endorsed by, or sponsored by YouTube or Google. YouTube is a trademark of Google LLC.

## Credits
This extension was created with Claude Code assistance by Allan Marillier, October 2026
