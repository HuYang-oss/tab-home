/* ================================================================
   tab-home — live favorite sources

   Adds three coexisting left-column sources:
   1. tab-home custom favorites
   2. Chrome tab groups in the current window
   3. Chrome's bookmark tree

   Chrome-backed sources stay live and bidirectional. Cross-source drops
   create the destination first and remove the source only after success.
   ================================================================ */

'use strict';

(() => {
  const SOURCE_PREF_KEY = 'favoriteSources';
  const BOOKMARK_COLLAPSE_KEY = 'bookmarkFolderCollapsed';
  const DEFAULT_SOURCES = Object.freeze({
    tabGroups: true,
    custom: false,
    bookmarks: false,
  });
  const SOURCE_ORDER = ['tabGroups', 'custom', 'bookmarks'];
  const BOOKMARK_PERMISSION = Object.freeze({ permissions: ['bookmarks'] });
  let sourcePrefs = { ...DEFAULT_SOURCES };
  let dragState = null;
  let rendering = false;
  let renderPending = false;
  let bookmarkListenerEvents = [];

  const sourceLabel = (name) => t(
    name === 'tabGroups' ? 'sourceTabGroups'
      : name === 'bookmarks' ? 'sourceBookmarks'
        : 'sourceCustom'
  );

  function faviconHtml(url, id = '') {
    const chain = getFaviconFallbackChain(url, 128);
    if (!chain.length) {
      let letter = '?';
      try { letter = (friendlyDomain(new URL(url).hostname) || '?')[0].toUpperCase(); } catch {}
      return `<span class="source-item-icon-fallback" aria-hidden="true">${escapeHtml(letter)}</span>`;
    }
    const primary = escapeHtml(chain[0]);
    const fallback = escapeHtml(chain.slice(1).join('|'));
    return `<img class="favorite-favicon" src="${primary}" data-fallback="${fallback}"${id ? ` data-source-icon-id="${escapeHtml(id)}"` : ''} alt="">`;
  }

  async function loadPrefs() {
    const stored = await chrome.storage.local.get(SOURCE_PREF_KEY);
    const raw = stored[SOURCE_PREF_KEY];
    if (raw && typeof raw === 'object') {
      sourcePrefs = {
        tabGroups: raw.tabGroups !== false,
        custom: raw.custom === true,
        bookmarks: raw.bookmarks === true,
      };
    } else {
      sourcePrefs = { ...DEFAULT_SOURCES };
      await chrome.storage.local.set({ [SOURCE_PREF_KEY]: sourcePrefs });
    }
    return sourcePrefs;
  }

  async function hasBookmarkPermission() {
    if (!chrome.permissions || !chrome.permissions.contains) return false;
    return chrome.permissions.contains(BOOKMARK_PERMISSION);
  }

  function syncBookmarkListeners(enabled) {
    if (enabled && !bookmarkListenerEvents.length && chrome.bookmarks) {
      bookmarkListenerEvents = [
        chrome.bookmarks.onCreated,
        chrome.bookmarks.onChanged,
        chrome.bookmarks.onMoved,
        chrome.bookmarks.onRemoved,
        chrome.bookmarks.onChildrenReordered,
      ].filter(event => event && event.addListener);
      for (const event of bookmarkListenerEvents) {
        event.addListener(scheduleSourceRender);
      }
      return;
    }
    if (!enabled && bookmarkListenerEvents.length) {
      for (const event of bookmarkListenerEvents) {
        if (event.removeListener) event.removeListener(scheduleSourceRender);
      }
      bookmarkListenerEvents = [];
    }
  }

  function applyI18n() {
    const menu = document.getElementById('sourceMenu');
    const toggle = document.getElementById('sourceToggle');
    if (toggle) {
      toggle.title = t('sourceSettings');
      toggle.setAttribute('aria-label', t('sourceSettings'));
    }
    if (menu) {
      menu.setAttribute('aria-label', t('sourceSettings'));
      for (const name of SOURCE_ORDER) {
        const label = menu.querySelector(`[data-source-label="${name}"]`);
        if (label) label.textContent = sourceLabel(name);
      }
    }
  }

  function paintSourceControls() {
    for (const name of SOURCE_ORDER) {
      const item = document.querySelector(`#sourceMenu [data-source-name="${name}"]`);
      if (item) item.setAttribute('aria-checked', String(!!sourcePrefs[name]));
    }
    const showCustomTools = !!sourcePrefs.custom;
    const addFavoriteButton = document.getElementById('favoritesAddToggle');
    const addCategoryButton = document.getElementById('categoryAddToggle');
    if (addFavoriteButton) addFavoriteButton.style.display = showCustomTools ? 'inline-flex' : 'none';
    if (addCategoryButton) addCategoryButton.style.display = showCustomTools ? 'inline-flex' : 'none';
  }

  function closeSourceMenu({ restoreFocus = false } = {}) {
    const menu = document.getElementById('sourceMenu');
    const toggle = document.getElementById('sourceToggle');
    if (menu) menu.style.display = 'none';
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus) toggle.focus();
    }
  }

  function toggleSourceMenu() {
    const menu = document.getElementById('sourceMenu');
    const toggle = document.getElementById('sourceToggle');
    if (!menu || !toggle) return;
    const open = menu.style.display === 'none';
    closeThemeMenu();
    closeFavoriteMenu();
    closeCategoryMenu();
    closeSourcePopup();
    menu.style.display = open ? 'block' : 'none';
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      const checked = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
      if (checked) setTimeout(() => checked.focus(), 0);
    }
  }

  async function setSourceEnabled(name, enabled) {
    if (!SOURCE_ORDER.includes(name)) return;
    const wasEnabled = !!sourcePrefs[name];
    if (name === 'bookmarks' && enabled) {
      let granted = false;
      try {
        // Chrome requires optional permission requests to happen directly in a
        // user gesture. Do not await contains() or any other promise first.
        granted = await chrome.permissions.request(BOOKMARK_PERMISSION);
      } catch (err) {
        console.warn('[tab-home] bookmark permission request failed:', err);
        showToast(t('bookmarkPermissionError'));
        sourcePrefs.bookmarks = wasEnabled;
        paintSourceControls();
        return false;
      }
      if (!granted) {
        showToast(t('bookmarkPermissionDenied'));
        sourcePrefs.bookmarks = wasEnabled;
        paintSourceControls();
        return false;
      }
      syncBookmarkListeners(true);
    }
    sourcePrefs[name] = enabled;
    await chrome.storage.local.set({ [SOURCE_PREF_KEY]: sourcePrefs });
    paintSourceControls();
    await render();
    return true;
  }

  function sourceSection(name, body, count = null) {
    const countHtml = Number.isFinite(count)
      ? `<span class="favorite-category-count">${count}</span>`
      : '';
    return `
      <section class="favorite-source" data-source-section="${name}">
        <div class="favorite-source-heading">
          <span>${escapeHtml(sourceLabel(name))}</span>${countHtml}
        </div>
        <div class="favorite-source-groups">${body}</div>
      </section>`;
  }

  async function renderCustomSource() {
    const [items, categories, uncategorizedState] = await Promise.all([
      getFavorites(),
      getFavoriteCategories(),
      chrome.storage.local.get('uncategorizedCollapsed'),
    ]);
    const groups = categories.map(category => ({
      ...category,
      items: items.filter(item => item.categoryId === category.id),
      builtIn: false,
    }));
    groups.push({
      id: UNCATEGORIZED_ID,
      name: t('uncategorized'),
      order: Number.MAX_SAFE_INTEGER,
      collapsed: !!uncategorizedState.uncategorizedCollapsed,
      items: items.filter(item => !item.categoryId),
      builtIn: true,
    });
    for (const item of items) {
      if (!item.customLogo && item.iconVersion !== ICON_CACHE_VERSION) {
        scheduleFavoriteIconResolution(item.id);
      }
    }
    return sourceSection('custom', groups.map(renderFavoriteCategory).join(''), items.length);
  }

  function renderSourceItem({ source, id, url, title, action, groupId = '', parentId = '' }) {
    const safeSource = escapeHtml(source);
    const safeId = escapeHtml(String(id));
    const safeUrl = escapeHtml(url || '');
    const safeTitle = escapeHtml(title || url || '');
    const attrs = `draggable="true" data-source="${safeSource}" data-item-id="${safeId}"` +
      `${groupId !== '' ? ` data-group-id="${escapeHtml(String(groupId))}"` : ''}` +
      `${parentId !== '' ? ` data-parent-id="${escapeHtml(String(parentId))}"` : ''}`;
    const contents = `
      ${faviconHtml(url, `${source}:${id}`)}
      <span class="favorite-title">${safeTitle}</span>
      <button class="favorite-menu" type="button" data-action="source-item-menu"
              data-source="${safeSource}" data-item-id="${safeId}"
              title="${escapeHtml(t('moreActions'))}" aria-label="${escapeHtml(t('moreActions'))}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
      </button>`;
    if (action === 'focus-source-tab') {
      return `<div class="favorite-item source-item" role="button" tabindex="0" ${attrs}
                   data-action="focus-source-tab" data-tab-id="${safeId}"
                   title="${safeTitle}">${contents}</div>`;
    }
    return `<a class="favorite-item source-item" href="${safeUrl}" ${attrs}
               title="${safeUrl}">${contents}</a>`;
  }

  async function renderTabGroupsSource() {
    let groups = [];
    let tabs = [];
    try {
      [groups, tabs] = await Promise.all([
        chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }),
        chrome.tabs.query({ currentWindow: true }),
      ]);
    } catch (err) {
      console.warn('[tab-home] tab group source unavailable:', err);
    }
    const tabsByGroup = new Map();
    for (const tab of tabs) {
      if (!Number.isInteger(tab.groupId) || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
      if (!tabsByGroup.has(tab.groupId)) tabsByGroup.set(tab.groupId, []);
      tabsByGroup.get(tab.groupId).push(tab);
    }
    for (const groupedTabs of tabsByGroup.values()) groupedTabs.sort((a, b) => a.index - b.index);
    groups.sort((a, b) => {
      const ai = tabsByGroup.get(a.id)?.[0]?.index ?? Number.MAX_SAFE_INTEGER;
      const bi = tabsByGroup.get(b.id)?.[0]?.index ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });

    if (!groups.length) {
      return sourceSection(
        'tabGroups',
        `<div class="source-empty" data-source="tabGroups" data-target-id="__new__">${escapeHtml(t('sourceTabGroupsEmpty'))}</div>`,
        0
      );
    }

    const html = groups.map(group => {
      const groupedTabs = tabsByGroup.get(group.id) || [];
      const name = group.title || t('unnamedTabGroup');
      const itemsHtml = groupedTabs.map(tab => renderSourceItem({
        source: 'tabGroups',
        id: tab.id,
        url: tab.url || tab.pendingUrl || '',
        title: tab.title || tab.url || '',
        action: 'focus-source-tab',
        groupId: group.id,
      })).join('');
      return `
        <section class="favorite-category source-group-color-${escapeHtml(group.color || 'grey')}${group.collapsed ? ' collapsed' : ''}"
                 data-source="tabGroups" data-target-id="${group.id}" data-group-id="${group.id}">
          <div class="favorite-category-header" draggable="true"
               data-source="tabGroups" data-target-id="${group.id}" data-group-id="${group.id}">
            <button class="category-collapse-btn" type="button"
                    data-action="source-toggle-group" data-source="tabGroups" data-group-id="${group.id}"
                    aria-expanded="${String(!group.collapsed)}"
                    aria-label="${escapeHtml(group.collapsed ? t('expandCategory') : t('collapseCategory'))}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 9.75 3.75 3.75 3.75-3.75"/></svg>
            </button>
            <span class="source-color-dot" aria-hidden="true"></span>
            <h3>${escapeHtml(name)}</h3>
            <span class="favorite-category-count">${groupedTabs.length}</span>
            <div class="section-line"></div>
            <button class="category-menu-btn" type="button" data-action="source-group-menu"
                    data-source="tabGroups" data-group-id="${group.id}"
                    title="${escapeHtml(t('moreActions'))}" aria-label="${escapeHtml(t('moreActions'))}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
            </button>
          </div>
          <div class="favorites-list" style="${group.collapsed ? 'display:none' : ''}">
            ${itemsHtml || `<div class="favorite-slot-empty favorite-slot-empty-compact" data-source="tabGroups" data-target-id="${group.id}">${escapeHtml(t('sourceTabGroupsEmpty'))}</div>`}
          </div>
        </section>`;
    }).join('');
    return sourceSection('tabGroups', html, groups.length);
  }

  function countBookmarkDescendants(node) {
    if (!node || !Array.isArray(node.children)) return 0;
    return node.children.reduce((total, child) => total + 1 + countBookmarkDescendants(child), 0);
  }

  function renderBookmarkFolder(node, depth, collapsedMap, isSystemRoot = false) {
    const collapsed = Object.prototype.hasOwnProperty.call(collapsedMap, node.id)
      ? !!collapsedMap[node.id]
      : depth > 0;
    const children = Array.isArray(node.children) ? node.children : [];
    const bookmarks = children.filter(child => child.url);
    const folders = children.filter(child => !child.url);
    const title = node.title || (depth === 0 ? t('sourceBookmarks') : t('unnamedTabGroup'));
    const items = bookmarks.map(bookmark => renderSourceItem({
      source: 'bookmarks',
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title || bookmark.url,
      parentId: node.id,
    })).join('');
    const foldersHtml = collapsed
      ? ''
      : folders.map(folder => renderBookmarkFolder(folder, depth + 1, collapsedMap, false)).join('');
    const menu = isSystemRoot || node.unmodifiable ? '' : `
      <button class="category-menu-btn" type="button" data-action="source-group-menu"
              data-source="bookmarks" data-group-id="${escapeHtml(node.id)}"
              title="${escapeHtml(t('moreActions'))}" aria-label="${escapeHtml(t('moreActions'))}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
      </button>`;
    const draggable = isSystemRoot || node.unmodifiable
      ? ''
      : `draggable="true" data-group-id="${escapeHtml(node.id)}"`;
    return `
      <section class="favorite-category bookmark-folder${collapsed ? ' collapsed' : ''}"
               style="--bookmark-depth:${depth}" data-bookmark-root="${String(isSystemRoot)}"
               data-source="bookmarks" data-target-id="${escapeHtml(node.id)}"
               data-group-id="${escapeHtml(node.id)}">
        <div class="favorite-category-header" data-source="bookmarks"
             data-target-id="${escapeHtml(node.id)}" ${draggable}>
          <button class="category-collapse-btn" type="button"
                  data-action="source-toggle-group" data-source="bookmarks"
                  data-group-id="${escapeHtml(node.id)}" aria-expanded="${String(!collapsed)}"
                  aria-label="${escapeHtml(collapsed ? t('expandCategory') : t('collapseCategory'))}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 9.75 3.75 3.75 3.75-3.75"/></svg>
          </button>
          <h3>${escapeHtml(title)}</h3>
          <span class="favorite-category-count">${countBookmarkDescendants(node)}</span>
          <div class="section-line"></div>${menu}
        </div>
        <div class="bookmark-folder-content" style="${collapsed ? 'display:none' : ''}">
          ${items ? `<div class="favorites-list">${items}</div>` : ''}
          ${foldersHtml}
          ${!items && !folders.length
            ? `<div class="favorite-slot-empty favorite-slot-empty-compact" data-source="bookmarks" data-target-id="${escapeHtml(node.id)}">${escapeHtml(t('sourceBookmarksEmpty'))}</div>`
            : ''}
        </div>
      </section>`;
  }

  async function renderBookmarksSource() {
    if (!(await hasBookmarkPermission())) {
      return sourceSection(
        'bookmarks',
        `<button class="source-empty" type="button" data-action="request-bookmark-permission">${escapeHtml(t('openBookmarkSettings'))}</button>`,
        0
      );
    }
    const [{ bookmarkFolderCollapsed = {} }, tree] = await Promise.all([
      chrome.storage.local.get(BOOKMARK_COLLAPSE_KEY),
      chrome.bookmarks.getTree(),
    ]);
    const roots = (tree[0] && Array.isArray(tree[0].children)) ? tree[0].children : [];
    const html = roots.map(node => renderBookmarkFolder(node, 0, bookmarkFolderCollapsed, true)).join('');
    return sourceSection('bookmarks', html || `<div class="source-empty">${escapeHtml(t('sourceBookmarksEmpty'))}</div>`, roots.length);
  }

  async function render() {
    if (rendering) {
      renderPending = true;
      return;
    }
    const list = document.getElementById('favoritesList');
    const empty = document.getElementById('favoritesEmpty');
    if (!list || !empty) return;
    rendering = true;
    try {
      do {
        renderPending = false;
        try {
          await loadPrefs();
          applyI18n();
          paintSourceControls();
          const sections = [];
          if (sourcePrefs.tabGroups) sections.push(await renderTabGroupsSource());
          if (sourcePrefs.custom) sections.push(await renderCustomSource());
          if (sourcePrefs.bookmarks) sections.push(await renderBookmarksSource());
          list.innerHTML = sections.join('');
          empty.style.display = sections.length ? 'none' : 'block';
          if (!sections.length) empty.textContent = t('sourceSettings');
        } catch (err) {
          console.warn('[tab-home] source render failed:', err);
          empty.style.display = 'block';
          empty.textContent = String(err && err.message ? err.message : err);
        }
      } while (renderPending);
    } finally {
      rendering = false;
    }
  }

  function closeSourcePopup() {
    const menu = document.getElementById('sourcePopupMenu');
    if (menu) menu.remove();
  }

  function positionPopup(menu, anchorEl) {
    document.body.appendChild(menu);
    const anchor = anchorEl.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    let top = anchor.bottom + 4;
    let left = anchor.right - bounds.width;
    if (top + bounds.height > window.innerHeight - 4) top = anchor.top - bounds.height - 4;
    if (left < 4) left = 4;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    const first = menu.querySelector('button');
    if (first) setTimeout(() => first.focus(), 0);
  }

  async function getSourceItem(source, id) {
    if (source === 'custom') {
      const item = (await getFavorites()).find(f => f.id === id);
      return item ? { source, id, url: item.url, title: item.title || item.url } : null;
    }
    if (source === 'bookmarks') {
      const [node] = await chrome.bookmarks.get(String(id));
      return node && node.url
        ? { source, id: node.id, url: node.url, title: node.title || node.url, parentId: node.parentId }
        : null;
    }
    if (source === 'tabGroups') {
      const tab = await chrome.tabs.get(Number(id));
      return tab ? {
        source,
        id: tab.id,
        url: tab.url || tab.pendingUrl || '',
        title: tab.title || tab.url || '',
        groupId: tab.groupId,
      } : null;
    }
    return null;
  }

  async function openSourceItemMenu(anchorEl, source, id) {
    const item = await getSourceItem(source, id);
    if (!item) return;
    const menu = document.createElement('div');
    menu.id = 'sourcePopupMenu';
    menu.className = 'favorite-popup-menu';
    menu.innerHTML = source === 'bookmarks'
      ? `<button class="favorite-popup-item" data-action="edit-source-item" data-source="bookmarks" data-item-id="${escapeHtml(id)}">${escapeHtml(t('editBookmark'))}</button>
         <button class="favorite-popup-item favorite-popup-item-danger" data-action="delete-source-item" data-source="bookmarks" data-item-id="${escapeHtml(id)}">${escapeHtml(t('remove'))}</button>`
      : `<button class="favorite-popup-item favorite-popup-item-danger" data-action="delete-source-item" data-source="tabGroups" data-item-id="${escapeHtml(id)}">${escapeHtml(t('close'))}</button>`;
    positionPopup(menu, anchorEl);
  }

  async function openSourceGroupMenu(anchorEl, source, id) {
    const menu = document.createElement('div');
    menu.id = 'sourcePopupMenu';
    menu.className = 'favorite-popup-menu';
    menu.innerHTML = source === 'bookmarks'
      ? `<button class="favorite-popup-item" data-action="rename-source-group" data-source="bookmarks" data-group-id="${escapeHtml(id)}">${escapeHtml(t('rename'))}</button>
         <button class="favorite-popup-item favorite-popup-item-danger" data-action="delete-source-group" data-source="bookmarks" data-group-id="${escapeHtml(id)}">${escapeHtml(t('deleteFolder'))}</button>`
      : `<button class="favorite-popup-item" data-action="rename-source-group" data-source="tabGroups" data-group-id="${escapeHtml(id)}">${escapeHtml(t('rename'))}</button>
         <button class="favorite-popup-item favorite-popup-item-danger" data-action="delete-source-group" data-source="tabGroups" data-group-id="${escapeHtml(id)}">${escapeHtml(t('closeGroup'))}</button>`;
    positionPopup(menu, anchorEl);
  }

  function showEditor({ title, fields, submitLabel = t('save') }) {
    return new Promise(resolve => {
      const returnFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.id = 'sourceEditorModal';
      overlay.className = 'category-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'sourceEditorTitle');
      overlay.innerHTML = `
        <form class="category-form" id="sourceEditorForm">
          <div class="source-editor-title" id="sourceEditorTitle">${escapeHtml(title)}</div>
          ${fields.map(field => `
            <label class="favorites-form-label" for="source-editor-${escapeHtml(field.name)}">${escapeHtml(field.label)}</label>
            <input class="favorites-form-input" id="source-editor-${escapeHtml(field.name)}"
                   name="${escapeHtml(field.name)}" value="${escapeHtml(field.value || '')}"
                   ${field.required ? 'required' : ''} autocomplete="off">
          `).join('')}
          <div class="favorites-form-actions-right">
            <button type="button" class="favorites-form-cancel" data-editor-cancel>${escapeHtml(t('cancel'))}</button>
            <button type="submit" class="favorites-form-submit">${escapeHtml(submitLabel)}</button>
          </div>
        </form>`;
      const cleanup = result => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (returnFocus && returnFocus.isConnected && returnFocus.focus) returnFocus.focus();
        resolve(result);
      };
      const onKey = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(null);
        } else if (event.key === 'Tab' && window.trapFocusWithin) {
          window.trapFocusWithin(event, overlay);
        }
      };
      overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.closest('[data-editor-cancel]')) cleanup(null);
      });
      overlay.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const values = {};
        for (const field of fields) values[field.name] = event.target.elements[field.name].value.trim();
        cleanup(values);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      const first = overlay.querySelector('input');
      if (first) setTimeout(() => { first.focus(); first.select(); }, 0);
    });
  }

  async function editBookmark(id) {
    const [node] = await chrome.bookmarks.get(String(id));
    if (!node || !node.url) return;
    const values = await showEditor({
      title: t('editBookmark'),
      fields: [
        { name: 'title', label: t('titleLabel'), value: node.title, required: true },
        { name: 'url', label: t('urlLabel'), value: node.url, required: true },
      ],
    });
    if (!values) return;
    await chrome.bookmarks.update(node.id, { title: values.title, url: values.url });
    showToast(t('bookmarkUpdated'));
    await render();
  }

  async function renameSourceGroup(source, id) {
    let current = '';
    if (source === 'bookmarks') {
      const [node] = await chrome.bookmarks.get(String(id));
      if (!node) return;
      current = node.title || '';
    } else {
      const group = await chrome.tabGroups.get(Number(id));
      current = group.title || '';
    }
    const values = await showEditor({
      title: t('rename'),
      fields: [{ name: 'title', label: t('titleLabel'), value: current, required: true }],
    });
    if (!values || !values.title) return;
    if (source === 'bookmarks') {
      await chrome.bookmarks.update(String(id), { title: values.title });
      showToast(t('bookmarkUpdated'));
    } else {
      await chrome.tabGroups.update(Number(id), { title: values.title });
      showToast(t('tabGroupUpdated'));
    }
    await render();
  }

  async function deleteSourceItem(source, id) {
    const item = await getSourceItem(source, id);
    if (!item) return;
    const ok = await showConfirm({
      message: source === 'bookmarks'
        ? t('confirmDeleteBookmark', item.title)
        : t('confirmCloseTab', item.title),
      okLabel: source === 'bookmarks' ? t('remove') : t('close'),
    });
    if (!ok) return;
    if (source === 'bookmarks') {
      await chrome.bookmarks.remove(String(id));
      showToast(t('bookmarkDeleted'));
    } else {
      await chrome.tabs.remove(Number(id));
      showToast(t('tabClosed'));
    }
    await render();
  }

  async function deleteSourceGroup(source, id) {
    if (source === 'bookmarks') {
      const [node] = await chrome.bookmarks.getSubTree(String(id));
      if (!node) return;
      const count = countBookmarkDescendants(node);
      const ok = await showConfirm({
        message: t('confirmDeleteBookmarkFolder', node.title || '', count),
        okLabel: t('remove'),
      });
      if (!ok) return;
      await chrome.bookmarks.removeTree(String(id));
      showToast(t('bookmarkDeleted'));
    } else {
      const group = await chrome.tabGroups.get(Number(id));
      const tabs = await chrome.tabs.query({ groupId: Number(id), windowId: group.windowId });
      const ok = await showConfirm({
        message: t('confirmCloseGroup', group.title || t('unnamedTabGroup'), tabs.length),
        okLabel: t('close'),
      });
      if (!ok) return;
      if (tabs.length) await chrome.tabs.remove(tabs.map(tab => tab.id));
      showToast(t('tabGroupClosed'));
    }
    await render();
  }

  async function toggleSourceGroup(source, id) {
    if (source === 'tabGroups') {
      const group = await chrome.tabGroups.get(Number(id));
      await chrome.tabGroups.update(group.id, { collapsed: !group.collapsed });
    } else {
      const stored = await chrome.storage.local.get(BOOKMARK_COLLAPSE_KEY);
      const map = stored[BOOKMARK_COLLAPSE_KEY] || {};
      const section = document.querySelector(`.bookmark-folder[data-group-id="${CSS.escape(String(id))}"]`);
      const currentlyCollapsed = section ? section.classList.contains('collapsed') : !!map[id];
      map[id] = !currentlyCollapsed;
      await chrome.storage.local.set({ [BOOKMARK_COLLAPSE_KEY]: map });
    }
    await render();
  }

  async function focusSourceTab(id) {
    const tab = await chrome.tabs.get(Number(id));
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  async function handleAction(action, event, actionEl) {
    if (action === 'toggle-source-menu') {
      event.stopPropagation();
      toggleSourceMenu();
      return true;
    }
    if (action === 'toggle-source') {
      event.stopPropagation();
      const name = actionEl.dataset.sourceName;
      await setSourceEnabled(name, !sourcePrefs[name]);
      return true;
    }
    if (action === 'request-bookmark-permission') {
      await setSourceEnabled('bookmarks', true);
      return true;
    }
    if (action === 'focus-source-tab') {
      if (event.target.closest('.favorite-menu')) return false;
      await focusSourceTab(actionEl.dataset.tabId);
      return true;
    }
    if (action === 'source-toggle-group') {
      await toggleSourceGroup(actionEl.dataset.source, actionEl.dataset.groupId);
      return true;
    }
    if (action === 'source-item-menu') {
      event.preventDefault();
      event.stopPropagation();
      closeSourcePopup();
      await openSourceItemMenu(actionEl, actionEl.dataset.source, actionEl.dataset.itemId);
      return true;
    }
    if (action === 'source-group-menu') {
      event.stopPropagation();
      closeSourcePopup();
      await openSourceGroupMenu(actionEl, actionEl.dataset.source, actionEl.dataset.groupId);
      return true;
    }
    if (action === 'edit-source-item') {
      closeSourcePopup();
      await editBookmark(actionEl.dataset.itemId);
      return true;
    }
    if (action === 'delete-source-item') {
      closeSourcePopup();
      await deleteSourceItem(actionEl.dataset.source, actionEl.dataset.itemId);
      return true;
    }
    if (action === 'rename-source-group') {
      closeSourcePopup();
      await renameSourceGroup(actionEl.dataset.source, actionEl.dataset.groupId);
      return true;
    }
    if (action === 'delete-source-group') {
      closeSourcePopup();
      await deleteSourceGroup(actionEl.dataset.source, actionEl.dataset.groupId);
      return true;
    }
    return false;
  }

  function clearDropMarkers() {
    document.querySelectorAll('.source-drop-target').forEach(node => {
      node.classList.remove('source-drop-target');
      node.removeAttribute('data-drop-position');
    });
  }

  function handleDragStart(event) {
    const header = event.target.closest('.favorite-category-header');
    if (header && !event.target.closest('button')) {
      const source = header.dataset.source;
      let id = header.dataset.groupId || header.dataset.categoryDragId;
      if (source && id) {
        dragState = { kind: 'group', source, id: String(id), element: header };
        header.classList.add('dragging');
        document.body.classList.add('dragging-category');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify(dragState, ['kind', 'source', 'id']));
        return true;
      }
    }
    const item = event.target.closest('[data-source][data-item-id]');
    if (!item) return false;
    dragState = {
      kind: 'item',
      source: item.dataset.source,
      id: String(item.dataset.itemId),
      element: item,
    };
    item.classList.add('dragging');
    document.body.classList.add('dragging-source-item');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(dragState, ['kind', 'source', 'id']));
    return true;
  }

  function handleDragEnd() {
    if (!dragState) return false;
    if (dragState.element) dragState.element.classList.remove('dragging');
    document.body.classList.remove('dragging-source-item', 'dragging-category');
    clearDropMarkers();
    dragState = null;
    return true;
  }

  function getDropTarget(event) {
    const item = event.target.closest('[data-source][data-item-id]');
    if (item) {
      const group = item.closest('[data-source][data-target-id]');
      return {
        kind: 'item',
        source: item.dataset.source,
        id: String(item.dataset.itemId),
        targetId: group ? group.dataset.targetId : '',
        element: item,
      };
    }
    const header = event.target.closest('.favorite-category-header[data-source][data-target-id]');
    if (header) {
      const bounds = header.getBoundingClientRect();
      const relativeY = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
      return {
        kind: 'group',
        source: header.dataset.source,
        id: String(header.dataset.groupId || header.dataset.targetId),
        targetId: String(header.dataset.targetId),
        position: relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside',
        element: header,
      };
    }
    const empty = event.target.closest('[data-source][data-target-id]');
    if (empty) {
      return {
        kind: 'group',
        source: empty.dataset.source,
        id: String(empty.dataset.groupId || empty.dataset.targetId),
        targetId: String(empty.dataset.targetId),
        element: empty,
      };
    }
    return null;
  }

  function validDrop(target) {
    if (!dragState || !target) return false;
    if (dragState.kind === 'group') {
      return target.kind === 'group' &&
        target.source === dragState.source &&
        target.id !== dragState.id &&
        target.targetId !== dragState.id;
    }
    return !(target.kind === 'item' &&
      target.source === dragState.source &&
      target.id === dragState.id);
  }

  function handleDragOver(event) {
    if (!dragState) return false;
    const target = getDropTarget(event);
    if (!validDrop(target)) return true;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDropMarkers();
    target.element.classList.add('source-drop-target');
    if (target.position) target.element.dataset.dropPosition = target.position;
    return true;
  }

  async function reorderGroup(drag, target) {
    if (drag.source === 'custom') {
      await reorderCategory(categoryIdFromDom(drag.id), categoryIdFromDom(target.targetId));
      return;
    }
    if (drag.source === 'tabGroups') {
      const targetTabs = await chrome.tabs.query({ groupId: Number(target.targetId), currentWindow: true });
      const index = targetTabs.length
        ? Math.min(...targetTabs.map(tab => tab.index))
        : -1;
      await chrome.tabGroups.move(Number(drag.id), { index });
      return;
    }
    const [targetNode] = await chrome.bookmarks.get(String(target.targetId));
    if (!targetNode) return;
    if (target.position === 'inside') {
      await chrome.bookmarks.move(String(drag.id), { parentId: targetNode.id });
    } else if (targetNode.parentId) {
      await chrome.bookmarks.move(String(drag.id), {
        parentId: targetNode.parentId,
        index: targetNode.index + (target.position === 'after' ? 1 : 0),
      });
    }
  }

  async function moveSameSourceItem(drag, target) {
    if (drag.source === 'custom') {
      const favorites = await getFavorites();
      if (target.kind === 'item') {
        const targetItem = favorites.find(f => f.id === target.id);
        if (targetItem) await setFavoriteSlot(drag.id, targetItem.slot, targetItem.categoryId);
      } else {
        const categoryId = categoryIdFromDom(target.targetId);
        await setFavoriteSlot(drag.id, firstFreeSlot(favorites, categoryId, drag.id), categoryId);
      }
      return;
    }
    if (drag.source === 'bookmarks') {
      if (target.kind === 'item') {
        const [targetNode] = await chrome.bookmarks.get(String(target.id));
        if (!targetNode || !targetNode.parentId) return;
        await chrome.bookmarks.move(String(drag.id), {
          parentId: targetNode.parentId,
          index: targetNode.index,
        });
      } else {
        await chrome.bookmarks.move(String(drag.id), { parentId: String(target.targetId) });
      }
      return;
    }
    const tabId = Number(drag.id);
    let groupId = Number(target.targetId);
    let targetIndex = null;
    if (target.kind === 'item') {
      const targetTab = await chrome.tabs.get(Number(target.id));
      groupId = targetTab.groupId;
      targetIndex = targetTab.index;
    }
    if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || Number.isNaN(groupId)) return;
    const sourceTab = await chrome.tabs.get(tabId);
    if (sourceTab.groupId !== groupId) await chrome.tabs.group({ tabIds: tabId, groupId });
    if (targetIndex !== null) await chrome.tabs.move(tabId, { index: targetIndex });
  }

  async function createDestination(item, target) {
    const destination = target.source;
    if (destination === 'custom') {
      const categoryId = categoryIdFromDom(target.targetId);
      const created = await addFavorite(item.url, item.title, null, categoryId);
      if (!created) throw new Error('duplicate-custom-favorite');
      return;
    }
    if (destination === 'bookmarks') {
      let parentId = target.targetId;
      if (target.kind === 'item') {
        const [targetNode] = await chrome.bookmarks.get(String(target.id));
        parentId = targetNode.parentId;
      }
      await chrome.bookmarks.create({ parentId: String(parentId), title: item.title, url: item.url });
      return;
    }
    const createdTab = await chrome.tabs.create({ url: item.url, active: false });
    try {
      if (target.targetId === '__new__') {
        const groupId = await chrome.tabs.group({ tabIds: createdTab.id });
        await chrome.tabGroups.update(groupId, { title: item.title || t('unnamedTabGroup') });
      } else {
        await chrome.tabs.group({ tabIds: createdTab.id, groupId: Number(target.targetId) });
        if (target.kind === 'item') {
          const targetTab = await chrome.tabs.get(Number(target.id));
          await chrome.tabs.move(createdTab.id, { index: targetTab.index });
        }
      }
    } catch (err) {
      try { await chrome.tabs.remove(createdTab.id); } catch {}
      throw err;
    }
  }

  async function removeSource(item) {
    if (item.source === 'custom') return removeFavorite(item.id);
    if (item.source === 'bookmarks') return chrome.bookmarks.remove(String(item.id));
    return chrome.tabs.remove(Number(item.id));
  }

  async function moveAcrossSources(drag, target) {
    const item = await getSourceItem(drag.source, drag.id);
    if (!item || !item.url) throw new Error('source-missing');
    const ok = await showConfirm({
      message: t(
        'confirmCrossSourceMove',
        item.title,
        sourceLabel(item.source),
        sourceLabel(target.source)
      ),
      okLabel: t('confirmOk'),
    });
    if (!ok) return;
    try {
      await createDestination(item, target);
    } catch (err) {
      console.warn('[tab-home] cross-source destination failed:', err);
      showToast(err && err.message === 'duplicate-custom-favorite'
        ? t('alreadyAdded')
        : t('moveFailedSourceKept'));
      return;
    }
    try {
      await removeSource(item);
      showToast(t('movedBetweenSources'));
    } catch (err) {
      console.warn('[tab-home] cross-source source removal failed:', err);
      showToast(t('movePartial'));
    }
  }

  async function handleDrop(event) {
    if (!dragState) return false;
    const drag = { ...dragState };
    const target = getDropTarget(event);
    handleDragEnd();
    if (!validDropForSnapshot(drag, target)) return true;
    event.preventDefault();
    try {
      if (drag.kind === 'group') {
        await reorderGroup(drag, target);
      } else if (drag.source === target.source) {
        await moveSameSourceItem(drag, target);
      } else {
        await moveAcrossSources(drag, target);
      }
      await render();
    } catch (err) {
      console.warn('[tab-home] drag move failed:', err);
      showToast(t('moveFailedSourceKept'));
    }
    return true;
  }

  function validDropForSnapshot(drag, target) {
    if (!drag || !target) return false;
    if (drag.kind === 'group') {
      return target.kind === 'group' &&
        target.source === drag.source &&
        target.id !== drag.id &&
        target.targetId !== drag.id;
    }
    return !(target.kind === 'item' && target.source === drag.source && target.id === drag.id);
  }

  document.addEventListener('click', event => {
    if (document.getElementById('sourceMenu') &&
        !event.target.closest('.source-control')) {
      closeSourceMenu();
    }
    if (document.getElementById('sourcePopupMenu') &&
        !event.target.closest('#sourcePopupMenu') &&
        !event.target.closest('[data-action="source-item-menu"]') &&
        !event.target.closest('[data-action="source-group-menu"]')) {
      closeSourcePopup();
    }
  });

  document.addEventListener('keydown', event => {
    const sourceTabItem = event.target.closest('[data-action="focus-source-tab"]');
    if (sourceTabItem && event.target === sourceTabItem &&
        (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      focusSourceTab(sourceTabItem.dataset.tabId);
      return;
    }
    const menu = event.target.closest('#sourceMenu, #sourcePopupMenu');
    if (!menu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (menu.id === 'sourceMenu') closeSourceMenu({ restoreFocus: true });
      else closeSourcePopup();
      return;
    }
    if (event.key === 'Tab') {
      if (menu.id === 'sourceMenu') closeSourceMenu();
      else closeSourcePopup();
      return;
    }
    const items = Array.from(menu.querySelectorAll('button:not([disabled])'));
    if (!items.length) return;
    const index = Math.max(0, items.indexOf(document.activeElement));
    let next = null;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    if (event.key === 'Home') next = items[0];
    if (event.key === 'End') next = items[items.length - 1];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });

  function scheduleSourceRender() {
    clearTimeout(scheduleSourceRender.timer);
    scheduleSourceRender.timer = setTimeout(render, 120);
  }

  if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener(scheduleSourceRender);
    chrome.tabGroups.onMoved.addListener(scheduleSourceRender);
    chrome.tabGroups.onRemoved.addListener(scheduleSourceRender);
    chrome.tabGroups.onUpdated.addListener(scheduleSourceRender);
  }

  if (chrome.permissions && chrome.permissions.onAdded) {
    chrome.permissions.onAdded.addListener(permissions => {
      if (!permissions.permissions || !permissions.permissions.includes('bookmarks')) return;
      syncBookmarkListeners(true);
      scheduleSourceRender();
    });
  }

  if (chrome.permissions && chrome.permissions.onRemoved) {
    chrome.permissions.onRemoved.addListener(permissions => {
      if (!permissions.permissions || !permissions.permissions.includes('bookmarks')) return;
      syncBookmarkListeners(false);
      showToast(t('bookmarkPermissionRevoked'));
      scheduleSourceRender();
    });
  }

  hasBookmarkPermission()
    .then(granted => syncBookmarkListeners(granted))
    .catch(err => console.warn('[tab-home] bookmark permission check failed:', err));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SOURCE_PREF_KEY] || changes[BOOKMARK_COLLAPSE_KEY]) scheduleSourceRender();
  });

  window.TabHomeSources = {
    applyI18n,
    render,
    handleAction,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDrop,
  };
})();
