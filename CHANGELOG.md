# Changelog

## 1.3.0 — Unreleased

- Added shared Retina-quality icon resolution for custom favorites, Chrome bookmarks, and live tab groups.
- Added website-wide imported icon overrides with automatic restore and refresh actions.
- Added actual-pixel quality gates, clear letter fallbacks, lazy visible-area resolution, and bounded local icon caching.

## 1.2.1 — 2026-07-28

- Fixed the optional bookmark permission request so Chrome prompts directly from the user's click.
- Added live permission grant/revoke handling and safe bookmark event-listener registration.
- Coalesced source refreshes without dropping the final state during event bursts.
- Improved dialog focus management, keyboard navigation, focus indicators, and toast announcements.

## 1.2.0 — 2026-07-28

- Added a persistent multi-select source menu for custom favorites, current-window Chrome tab groups, and the full Chrome bookmark tree.
- Added bidirectional tab-group and bookmark management, same-source sorting, and confirmed transactional cross-source moves.
- Made favorite category spacing content-driven by removing the fixed trailing placeholder row.
- Preserved the 1.1.0 system/light/dark theme modes, custom favorite categories, and Retina icon cache.

## 1.1.0

- Added system-aware three-mode themes.
- Added custom favorite categories and cross-category drag-and-drop.
- Added high-resolution local favorite icon caching and manual icon refresh.
