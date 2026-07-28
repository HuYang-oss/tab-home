# AGENTS.md — tab-home community edition

This repository is a zero-build Chrome Manifest V3 extension. Help users install it without changing or collecting their browser data.

## Installation

1. Clone or download the repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose “Load unpacked” and select the repository root, which contains `manifest.json`.

Chrome requires the final extension-manager clicks and folder selection to be performed by the user.

## Important behavior

- The first-run favorite source is the current window's Chrome tab groups.
- Custom favorites and Chrome bookmarks can be enabled from the source menu next to the Favorites heading.
- Bookmark access is optional and should only be requested after the user enables that source.
- Cross-source dragging uses move semantics and may delete a bookmark or close a tab after the destination is created; preserve the confirmation step.
- Saved-but-closed Chrome tab groups are not exposed by the public extension API. They appear after the user restores them in Chrome.
- Custom data stays in `chrome.storage.local`; never export it into repository files or release archives.

## Validation

Run these checks after changes:

```bash
node --check app.js
node --check sources.js
node --check background.js
python3 -m json.tool manifest.json
```

There is no npm install or build step. Keep the project dependency-free unless the maintainer explicitly decides otherwise.

## Lineage

This community edition is based on [wolfyxbt/tab-home](https://github.com/wolfyxbt/tab-home), itself forked from [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out). Keep the MIT license and both upstream acknowledgements in public distributions.
