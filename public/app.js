'use strict';

// Chrome tab-group palette
const COLORS = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#188038',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#007b83',
  orange: '#fa903e',
};

// Colors too light for white pill text
const LIGHT_COLORS = new Set(['yellow', 'orange']);

const STORAGE_KEY = 'web4webs:data';
const PREFS_KEY = 'web4webs:prefs';

const VIEW_MODES = [
  { id: 'grid', label: 'Grid' },
  { id: 'triple', label: 'Triple' },
  { id: 'long', label: 'Long' },
  { id: 'fullscreen', label: 'Fullscreen' },
  { id: 'list', label: 'List' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'images', label: 'Images' },
];

const state = {
  collections: [],
  bookmarks: [],
  view: 'all', // 'all' | 'unsorted' | collection id
  query: '',
  tagFilters: [], // active tag filters (empty = none)
  tagMode: 'or', // 'or' | 'and' when multiple tags selected
  viewMode: 'grid',
  live: false,
  sidebar: true, // left sidebar visible
};

function parseTags(raw) {
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((t) => t.trim().toLowerCase().slice(0, 40))
      .filter(Boolean)
  )].slice(0, 20);
}

function allTags() {
  const counts = new Map();
  for (const b of state.bookmarks) {
    for (const t of b.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

function svgIcon(path, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

const ICONS = {
  chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  open: 'M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zM5 5h6V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6h-2v6H5z',
};

// ---------- browser storage ----------
// All bookmark data lives in this browser via localStorage, so each visitor's
// collections persist between visits without accounts or a database.

let storageWarned = false;

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      collections: Array.isArray(parsed.collections) ? parsed.collections : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
    };
  } catch {
    return null;
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      collections: state.collections,
      bookmarks: state.bookmarks,
    }));
  } catch {
    if (!storageWarned) {
      storageWarned = true;
      toast('Could not save — browser storage is unavailable or full.', true);
    }
  }
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (VIEW_MODES.some((m) => m.id === p.viewMode)) state.viewMode = p.viewMode;
    state.live = Boolean(p.live);
    if (typeof p.sidebar === 'boolean') state.sidebar = p.sidebar;
  } catch { /* defaults */ }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      viewMode: state.viewMode, live: state.live, sidebar: state.sidebar,
    }));
  } catch { /* ignore */ }
}

function applySidebar() {
  document.querySelector('.layout').classList.toggle('sidebar-hidden', !state.sidebar);
  const btn = $('#sidebar-toggle');
  if (btn) btn.classList.toggle('active', !state.sidebar);
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrl(raw) {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

// ---------- preview api ----------

async function fetchPreviewApi(url) {
  const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* keep default message */ }
    throw new Error(message);
  }
  return res.json();
}

// Ask the server whether a bookmark's site allows framing, cache it on the
// bookmark, and re-render if it turned out live-frameable. Runs at most once per
// bookmark per session (older bookmarks saved before frameable existed).
const frameableChecked = new Set();
async function checkFrameable(bookmark) {
  if (frameableChecked.has(bookmark.id)) return;
  frameableChecked.add(bookmark.id);
  try {
    const preview = await fetchPreviewApi(bookmark.url);
    bookmark.frameable = Boolean(preview.frameable);
    saveStore();
    if (bookmark.frameable && state.live) render();
  } catch { /* leave as screenshot */ }
}

// ---------- helpers ----------

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function colorHex(name) {
  return COLORS[name] || COLORS.grey;
}

function hueOf(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function sortByOrder(items) {
  return [...items].sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

function bookmarksIn(collectionId) {
  return sortByOrder(state.bookmarks.filter((b) => (b.collectionId || null) === (collectionId || null)));
}

// ---------- nested collections ----------

function childCollections(parentId) {
  return sortByOrder(state.collections.filter((c) => (c.parentId || null) === (parentId || null)));
}

// All descendant ids of a collection (excludes itself). Used to prevent cycles
// when re-parenting and to reparent orphans on delete.
function descendantIds(id) {
  const out = [];
  const walk = (pid) => {
    for (const c of state.collections) {
      if ((c.parentId || null) === pid) { out.push(c.id); walk(c.id); }
    }
  };
  walk(id);
  return out;
}

function collectionById(id) {
  return state.collections.find((c) => c.id === id) || null;
}

// True if any ANCESTOR of this collection is collapsed, so a collapsed parent
// hides its whole subtree (not just its own grid).
function ancestorCollapsed(id) {
  let c = collectionById(id);
  while (c && c.parentId) {
    const parent = collectionById(c.parentId);
    if (parent && parent.collapsed) return true;
    c = parent;
  }
  return false;
}

function nextOrder(items) {
  return items.reduce((max, item) => Math.max(max, item.order || 0), 0) + 1;
}

function matchesQuery(bookmark) {
  // Active tag filter must match first.
  if (state.tagFilters.length) {
    const has = (t) => (bookmark.tags || []).includes(t);
    const ok = state.tagMode === 'and' ? state.tagFilters.every(has) : state.tagFilters.some(has);
    if (!ok) return false;
  }
  if (!state.query) return true;
  const tags = (bookmark.tags || []).join(' ');
  const haystack = `${bookmark.title} ${bookmark.description} ${bookmark.url} ${bookmark.siteName || ''} ${tags}`.toLowerCase();
  return state.query.split(/\s+/).every((term) => haystack.includes(term));
}

function toast(message, isError = false) {
  const node = el('div', { class: `toast${isError ? ' error' : ''}` }, message);
  $('#toast-container').append(node);
  setTimeout(() => node.remove(), 2600);
}

function confirmDialog(message) {
  const modal = $('#confirm-modal');
  $('#confirm-message').textContent = message;
  modal.showModal();
  return new Promise((resolve) => {
    const done = (value) => {
      modal.close();
      $('#confirm-ok').onclick = null;
      modal.onclose = null;
      resolve(value);
    };
    $('#confirm-ok').onclick = () => done(true);
    modal.onclose = () => resolve(false);
  });
}

// ---------- rendering ----------

function render() {
  renderSidebar();
  renderMain();
}

function renderSidebar() {
  $('#count-all').textContent = state.bookmarks.length;
  $('#count-unsorted').textContent = bookmarksIn(null).length;

  const nav = $('#sidebar-collections');
  nav.replaceChildren();
  const renderTree = (parentId, depth) => {
    for (const collection of childCollections(parentId)) {
      const item = el('button', {
        class: `nav-item${state.view === collection.id ? ' active' : ''}`,
        type: 'button',
        dataset: { collectionId: collection.id },
        style: { paddingLeft: `${12 + depth * 16}px` },
        onclick: () => setView(collection.id),
      },
        el('span', { class: 'nav-dot', style: { background: colorHex(collection.color) } }),
        el('span', { class: 'nav-label' }, collection.name),
        el('span', { class: 'nav-count' }, String(bookmarksIn(collection.id).length)),
      );
      attachSidebarDrop(item, collection.id);
      nav.append(item);
      renderTree(collection.id, depth + 1);
    }
  };
  renderTree(null, 0);

  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === state.view);
  });

  renderTagsSidebar();
}

function renderTagsSidebar() {
  const wrap = $('#sidebar-tags');
  const heading = $('#tags-heading');
  if (!wrap) return;
  const tags = allTags();
  heading.style.display = tags.length ? '' : 'none';
  wrap.replaceChildren();

  // Controls appear once 1+ tags are active: AND/OR mode (only meaningful with
  // 2+) and a clear button.
  if (state.tagFilters.length) {
    const controls = el('div', { class: 'tag-controls' });
    if (state.tagFilters.length > 1) {
      controls.append(el('button', {
        class: 'tag-mode', type: 'button',
        title: 'Toggle match mode',
        onclick: () => { state.tagMode = state.tagMode === 'and' ? 'or' : 'and'; render(); },
      }, `Match: ${state.tagMode.toUpperCase()}`));
    }
    controls.append(el('button', {
      class: 'tag-clear', type: 'button', onclick: clearTags,
    }, `Clear (${state.tagFilters.length})`));
    wrap.append(controls);
  }

  for (const [tag, count] of tags) {
    wrap.append(el('button', {
      class: `tag-chip${state.tagFilters.includes(tag) ? ' active' : ''}`,
      type: 'button',
      onclick: () => toggleTag(tag),
    },
      el('span', { class: 'tag-chip-name' }, `#${tag}`),
      el('span', { class: 'tag-chip-count' }, String(count)),
    ));
  }
}

function toggleTag(tag) {
  const i = state.tagFilters.indexOf(tag);
  if (i === -1) state.tagFilters.push(tag);
  else state.tagFilters.splice(i, 1);
  render();
}

function clearTags() {
  state.tagFilters = [];
  render();
}

function renderMain() {
  const main = $('#main');
  main.className = `main view-${state.viewMode}`;
  main.replaceChildren();

  if (!state.bookmarks.length && !state.collections.length && !state.query) {
    main.append(el('div', { class: 'hero-empty' },
      el('div', { class: 'hero-icon' }, '🗂️'),
      el('h2', {}, 'Save your first website'),
      el('p', {}, 'Paste a link and Web4webs fetches its preview — title, description and image — then keeps it as a card inside colorful collections, just like browser tab groups. Everything is saved in this browser.'),
      el('button', { class: 'btn primary', type: 'button', onclick: () => openBookmarkModal() }, '+ Add bookmark'),
    ));
    return;
  }

  const showAll = state.view === 'all';

  // Flatten collections in tree order so nested collections render as indented
  // sections under their parent.
  const ordered = [];
  const flatten = (parentId, depth) => {
    for (const c of childCollections(parentId)) { ordered.push({ c, depth }); flatten(c.id, depth + 1); }
  };
  flatten(null, 0);

  // When a collection is selected, show it plus its whole subtree.
  const subtree = showAll ? null : new Set([state.view, ...descendantIds(state.view)]);

  if (showAll || state.view !== 'unsorted') {
    for (const { c, depth } of ordered) {
      if (!showAll && !subtree.has(c.id)) continue;
      // A collapsed collection hides its descendants entirely.
      if (ancestorCollapsed(c.id) && !(state.query || state.tagFilters.length)) continue;
      const items = bookmarksIn(c.id).filter(matchesQuery);
      if (state.query && !items.length) continue;
      main.append(sectionEl(c, items, depth));
    }
  }

  if (showAll || state.view === 'unsorted') {
    const unsorted = bookmarksIn(null).filter(matchesQuery);
    if (unsorted.length || state.view === 'unsorted') {
      main.append(sectionEl(null, unsorted));
    }
  }

  if ((state.query || state.tagFilters.length) && !main.children.length) {
    const label = state.tagFilters.length
      ? state.tagFilters.map((t) => `#${t}`).join(state.tagMode === 'and' ? ' AND ' : ' / ')
      : `“${state.query}”`;
    main.append(el('div', { class: 'empty-state' }, `No bookmarks match ${label}.`));
  }
}

function sectionEl(collection, items, depth = 0) {
  const isUnsorted = !collection;
  const color = isUnsorted ? COLORS.grey : colorHex(collection.color);
  const collectionId = isUnsorted ? null : collection.id;
  const pillText = !isUnsorted && LIGHT_COLORS.has(collection.color) ? '#1c1e21' : '#fff';

  const grid = el('div', { class: 'card-grid', dataset: { collectionId: collectionId || '' } });
  for (const bookmark of items) grid.append(cardEl(bookmark, color));
  if (!items.length) {
    grid.append(el('div', { class: 'empty-state' },
      isUnsorted ? 'Nothing unsorted — nice and tidy.' : 'Empty collection. Drag cards here or add a bookmark.'));
  }
  attachGridDrop(grid, collectionId);

  const tools = el('div', { class: 'section-tools' });
  if (!isUnsorted) {
    tools.append(
      el('button', { class: 'icon-btn', type: 'button', title: 'Edit collection', onclick: () => openCollectionModal(collection) }, svgIcon(ICONS.edit)),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Delete collection',
        onclick: async () => {
          const ok = await confirmDialog(`Delete “${collection.name}”? Its bookmarks move to Unsorted and sub-collections move up.`);
          if (!ok) return;
          // Reparent direct children up to this collection's parent, drop its
          // bookmarks to Unsorted, then remove it.
          for (const c of state.collections) if ((c.parentId || null) === collection.id) c.parentId = collection.parentId || null;
          for (const b of state.bookmarks) if (b.collectionId === collection.id) b.collectionId = null;
          state.collections = state.collections.filter((c) => c.id !== collection.id);
          if (state.view === collection.id) state.view = 'all';
          saveStore();
          render();
          toast('Collection deleted');
        },
      }, svgIcon(ICONS.trash)),
    );
  }

  const collapseBtn = el('button', {
    class: 'icon-btn collapse-btn', type: 'button', title: 'Collapse',
    onclick: () => {
      if (isUnsorted) {
        section.classList.toggle('collapsed');
        return;
      }
      // Full re-render so the whole subtree hides/shows with the parent.
      collection.collapsed = !collection.collapsed;
      saveStore();
      render();
    },
  }, svgIcon(ICONS.chevron));

  const section = el('section', {
    class: `section${collection && collection.collapsed ? ' collapsed' : ''}${depth ? ' nested' : ''}`,
    style: depth ? { marginLeft: `${depth * 22}px` } : {},
  },
    el('div', { class: 'section-header' },
      el('span', { class: 'group-pill', style: { background: color, color: pillText } },
        el('span', { class: 'pill-name' }, isUnsorted ? 'Unsorted' : collection.name)),
      el('span', { class: 'section-count' }, `${items.length} ${items.length === 1 ? 'site' : 'sites'}`),
      tools,
      collapseBtn,
    ),
    grid,
  );
  return section;
}

function thumbEl(bookmark) {
  const thumb = el('div', { class: 'card-thumb' });
  const fallback = () => {
    const hue = hueOf(hostnameOf(bookmark.url));
    thumb.append(el('div', {
      class: 'thumb-fallback',
      style: { background: `linear-gradient(135deg, hsl(${hue} 60% 52%), hsl(${(hue + 45) % 360} 60% 40%))` },
    }, hostnameOf(bookmark.url).charAt(0).toUpperCase()));
  };
  // Base layer: OG image or gradient. Stays visible behind a live frame, so a
  // site that blocks framing (X-Frame-Options/CSP) shows the image instead.
  if (bookmark.image) {
    thumb.append(el('img', { src: bookmark.image, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); if (!thumb.querySelector('.thumb-fallback')) fallback(); } }));
  } else {
    fallback();
  }
  // Live layer. Hybrid:
  //  - frameable site  -> real <iframe> of the live page (updates every render)
  //  - blocked site    -> server screenshot (mShots), since the browser refuses
  //                       to frame it (X-Frame-Options / CSP frame-ancestors)
  //  - unknown (older bookmarks) -> screenshot now, then ask the server whether
  //                       it's frameable and upgrade to a live frame if so.
  if (state.live) {
    thumb.classList.add('live');
    if (bookmark.frameable === true) {
      thumb.append(el('iframe', {
        class: 'live-frame',
        src: bookmark.url,
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
        sandbox: 'allow-scripts allow-same-origin allow-popups',
        tabindex: '-1',
        'aria-hidden': 'true',
      }));
      thumb.append(el('span', { class: 'live-badge' }, 'LIVE'));
    } else {
      thumb.append(el('img', {
        class: 'live-shot',
        src: `https://s.wordpress.com/mshots/v1/${encodeURIComponent(bookmark.url)}?w=1200&h=630`,
        alt: '',
        loading: 'lazy',
        onerror: (e) => e.target.remove(),
      }));
      thumb.append(el('span', { class: 'live-badge shot' }, 'SHOT'));
      if (bookmark.frameable === undefined) checkFrameable(bookmark);
    }
  }
  return thumb;
}

function tagsRow(bookmark) {
  const tags = bookmark.tags || [];
  if (!tags.length) return null;
  const row = el('div', { class: 'card-tags', onclick: (e) => e.stopPropagation() });
  for (const t of tags) {
    row.append(el('button', {
      class: `card-tag${state.tagFilters.includes(t) ? ' active' : ''}`,
      type: 'button',
      title: `Filter by #${t}`,
      onclick: () => toggleTag(t),
    }, `#${t}`));
  }
  return row;
}

function cardEl(bookmark, accentColor) {
  const site = el('div', { class: 'card-site' });
  if (bookmark.favicon) {
    site.append(el('img', { src: bookmark.favicon, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }));
  }
  site.append(hostnameOf(bookmark.url));

  const card = el('article', {
    class: 'card',
    draggable: 'true',
    dataset: { id: bookmark.id },
    style: { '--card-accent': accentColor },
    onclick: () => window.open(bookmark.url, '_blank', 'noopener'),
  },
    thumbEl(bookmark),
    el('div', { class: 'card-body' },
      site,
      el('h3', { class: 'card-title' }, bookmark.title),
      bookmark.description ? el('p', { class: 'card-desc' }, bookmark.description) : null,
      tagsRow(bookmark),
    ),
    el('div', { class: 'card-actions', onclick: (e) => e.stopPropagation() },
      el('button', { class: 'icon-btn', type: 'button', title: 'Open in new tab', onclick: () => window.open(bookmark.url, '_blank', 'noopener') }, svgIcon(ICONS.open, 14)),
      el('button', { class: 'icon-btn', type: 'button', title: 'Edit', onclick: () => openBookmarkModal(bookmark) }, svgIcon(ICONS.edit, 14)),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'Delete',
        onclick: async () => {
          const ok = await confirmDialog(`Delete “${bookmark.title}”?`);
          if (!ok) return;
          state.bookmarks = state.bookmarks.filter((b) => b.id !== bookmark.id);
          saveStore();
          render();
          toast('Bookmark deleted');
        },
      }, svgIcon(ICONS.trash, 14)),
    ),
  );

  card.addEventListener('dragstart', (e) => {
    dragState.id = bookmark.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', bookmark.id);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    cleanupDrag();
  });
  card.addEventListener('dragover', (e) => {
    if (!dragState.id) return;
    e.preventDefault();
    e.stopPropagation();
    // Hovering the dragged card's own slot: keep the placeholder there so
    // releasing in place is a no-op instead of jumping the card to the end.
    if (dragState.id === bookmark.id) {
      placePlaceholder(card.parentElement, card);
      return;
    }
    const rect = card.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    placePlaceholder(card.parentElement, before ? card : card.nextElementSibling);
  });

  return card;
}

// ---------- drag & drop ----------

const dragState = { id: null };
let placeholder = null;

function getPlaceholder() {
  if (!placeholder) placeholder = el('div', { class: 'drop-placeholder' });
  return placeholder;
}

function placePlaceholder(grid, beforeNode) {
  const ph = getPlaceholder();
  if (beforeNode && beforeNode !== ph) grid.insertBefore(ph, beforeNode);
  else if (!beforeNode) grid.append(ph);
}

function cleanupDrag() {
  dragState.id = null;
  if (placeholder) placeholder.remove();
  document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
}

function attachGridDrop(grid, collectionId) {
  grid.addEventListener('dragover', (e) => {
    if (!dragState.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    grid.classList.add('drag-over');
    if (!grid.contains(getPlaceholder())) placePlaceholder(grid, null);
  });
  grid.addEventListener('dragleave', (e) => {
    if (!grid.contains(e.relatedTarget)) grid.classList.remove('drag-over');
  });
  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = dragState.id || e.dataTransfer.getData('text/plain');
    if (!id) return cleanupDrag();

    // Skip non-card nodes AND the dragged card itself, which stays in the DOM
    // during the drop — otherwise the walk stops at it and mis-computes order.
    const skip = (node) => node && (!node.classList.contains('card') || node.dataset.id === id);
    const ph = getPlaceholder();
    let prevCard = ph.previousElementSibling;
    while (skip(prevCard)) prevCard = prevCard.previousElementSibling;
    let nextCard = ph.nextElementSibling;
    while (skip(nextCard)) nextCard = nextCard.nextElementSibling;

    const dropPrev = prevCard ? prevCard.dataset.id : null;
    const dropNext = nextCard ? nextCard.dataset.id : null;

    // No-op: dropped back between its own current neighbors in the same collection.
    const current = bookmarksIn(collectionId);
    const idx = current.findIndex((b) => b.id === id);
    if (idx !== -1) {
      const curPrev = idx > 0 ? current[idx - 1].id : null;
      const curNext = idx < current.length - 1 ? current[idx + 1].id : null;
      if (dropPrev === curPrev && dropNext === curNext) {
        cleanupDrag();
        render();
        return;
      }
    }

    const siblings = current.filter((b) => b.id !== id);
    const prev = dropPrev ? siblings.find((b) => b.id === dropPrev) : null;
    const next = dropNext ? siblings.find((b) => b.id === dropNext) : null;

    let order;
    if (prev && next) order = ((prev.order || 0) + (next.order || 0)) / 2;
    else if (prev) order = (prev.order || 0) + 1;
    else if (next) order = (next.order || 0) - 1;
    else order = 1;

    cleanupDrag();
    moveBookmark(id, collectionId, order);
  });
}

function attachSidebarDrop(item, collectionId) {
  item.addEventListener('dragover', (e) => {
    if (!dragState.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = dragState.id || e.dataTransfer.getData('text/plain');
    cleanupDrag();
    if (!id) return;
    const siblings = bookmarksIn(collectionId);
    const order = siblings.length ? (siblings[siblings.length - 1].order || 0) + 1 : 1;
    moveBookmark(id, collectionId, order);
  });
}

function moveBookmark(id, collectionId, order) {
  const bookmark = state.bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  bookmark.collectionId = collectionId;
  bookmark.order = order;
  saveStore();
  render();
}

// ---------- unsorted drop target on the sidebar ----------

function initStaticDropTargets() {
  const unsortedNav = document.querySelector('.nav-item[data-view="unsorted"]');
  if (unsortedNav) attachSidebarDrop(unsortedNav, null);
}

// ---------- bookmark modal ----------

const bookmarkModal = $('#bookmark-modal');
let editingBookmarkId = null;
let lastPreview = null;
let previewTimer = null;
let previewSeq = 0;

function renderPreviewBox(preview, status) {
  const box = $('#bm-preview');
  box.classList.remove('hidden');
  if (status) {
    box.replaceChildren(el('span', { class: 'lp-status' }, status));
    return;
  }
  const thumb = el('div', { class: 'lp-thumb' });
  if (preview.image) {
    thumb.append(el('img', { src: preview.image, alt: '', onerror: (e) => e.target.remove() }));
  }
  box.replaceChildren(
    thumb,
    el('div', { class: 'lp-text' },
      el('div', { class: 'lp-title' }, preview.title || hostnameOf(preview.url)),
      el('div', { class: 'lp-desc' }, preview.description || hostnameOf(preview.url)),
    ),
  );
}

async function fetchPreviewInto(url) {
  const seq = ++previewSeq;
  renderPreviewBox(null, 'Fetching preview…');
  try {
    const preview = await fetchPreviewApi(url);
    if (seq !== previewSeq) return;
    lastPreview = preview;
    renderPreviewBox(preview);
    if (!$('#bm-title').value.trim()) $('#bm-title').value = preview.title || '';
    if (!$('#bm-description').value.trim()) $('#bm-description').value = preview.description || '';
  } catch {
    if (seq !== previewSeq) return;
    renderPreviewBox(null, `Couldn't fetch preview — you can still save it.`);
  }
}

function fillCollectionSelect(selectedId) {
  const select = $('#bm-collection');
  select.replaceChildren(el('option', { value: '' }, 'Unsorted'));
  for (const collection of sortByOrder(state.collections)) {
    const option = el('option', { value: collection.id }, collection.name);
    if (collection.id === selectedId) option.selected = true;
    select.append(option);
  }
}

function openBookmarkModal(bookmark = null) {
  editingBookmarkId = bookmark ? bookmark.id : null;
  lastPreview = null;
  previewSeq++;
  clearTimeout(previewTimer);
  $('#bookmark-modal-title').textContent = bookmark ? 'Edit bookmark' : 'Add bookmark';
  $('#bm-save').textContent = bookmark ? 'Save changes' : 'Save bookmark';
  $('#bm-url').value = bookmark ? bookmark.url : '';
  $('#bm-url').disabled = Boolean(bookmark);
  $('#bm-title').value = bookmark ? bookmark.title : '';
  $('#bm-description').value = bookmark ? bookmark.description : '';
  $('#bm-tags').value = bookmark && bookmark.tags ? bookmark.tags.join(', ') : '';
  $('#bm-preview').classList.add('hidden');
  const defaultCollection = bookmark
    ? bookmark.collectionId
    : (state.view !== 'all' && state.view !== 'unsorted' ? state.view : '');
  fillCollectionSelect(defaultCollection || '');
  bookmarkModal.showModal();
  if (!bookmark) $('#bm-url').focus();
}

function initBookmarkModal() {
  $('#add-bookmark-btn').addEventListener('click', () => openBookmarkModal());

  $('#bm-url').addEventListener('input', () => {
    clearTimeout(previewTimer);
    const value = $('#bm-url').value.trim();
    if (!value || value.length < 4) return;
    previewTimer = setTimeout(() => fetchPreviewInto(value), 600);
  });

  $('#bookmark-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const rawUrl = $('#bm-url').value.trim();
    if (!rawUrl) return;
    const title = $('#bm-title').value.trim();
    const description = $('#bm-description').value.trim();
    const collectionId = $('#bm-collection').value || null;
    const tags = parseTags($('#bm-tags').value);

    if (editingBookmarkId) {
      const bookmark = state.bookmarks.find((b) => b.id === editingBookmarkId);
      if (bookmark) {
        if (title) bookmark.title = title.slice(0, 300);
        bookmark.description = description.slice(0, 500);
        bookmark.collectionId = collectionId;
        bookmark.tags = tags;
        saveStore();
        toast('Bookmark updated');
      }
    } else {
      const url = normalizeUrl(rawUrl);
      if (!url) {
        toast('That URL doesn’t look valid.', true);
        return;
      }
      const preview = lastPreview && lastPreview.url && sameSite(lastPreview.url, rawUrl) ? lastPreview : null;
      state.bookmarks.push({
        id: uid(),
        url,
        title: (title || (preview && preview.title) || hostnameOf(url)).slice(0, 300),
        description: description.slice(0, 500),
        image: preview ? preview.image : null,
        siteName: preview ? preview.siteName : '',
        favicon: preview ? preview.favicon : null,
        frameable: preview ? preview.frameable : undefined,
        tags,
        collectionId,
        order: nextOrder(bookmarksIn(collectionId)),
        createdAt: new Date().toISOString(),
      });
      saveStore();
      toast('Bookmark saved');
    }
    bookmarkModal.close();
    render();
  });
}

function sameSite(a, b) {
  try {
    const ha = new URL(a).hostname;
    const hb = new URL(/^https?:\/\//i.test(b) ? b : `https://${b}`).hostname;
    return ha === hb;
  } catch {
    return false;
  }
}

// ---------- collection modal ----------

const collectionModal = $('#collection-modal');
let editingCollectionId = null;
let selectedColor = 'blue';

function renderSwatches() {
  const wrap = $('#col-colors');
  wrap.replaceChildren();
  for (const [name, hex] of Object.entries(COLORS)) {
    wrap.append(el('button', {
      class: `swatch${name === selectedColor ? ' selected' : ''}`,
      type: 'button',
      title: name,
      role: 'radio',
      'aria-checked': String(name === selectedColor),
      style: { background: hex },
      onclick: () => {
        selectedColor = name;
        renderSwatches();
      },
    }));
  }
}

function fillParentSelect(selectedId, editingId) {
  const select = $('#col-parent');
  if (!select) return;
  // Exclude self and descendants to prevent cycles.
  const banned = new Set(editingId ? [editingId, ...descendantIds(editingId)] : []);
  select.replaceChildren(el('option', { value: '' }, 'Top level (no parent)'));
  const add = (parentId, depth) => {
    for (const c of childCollections(parentId)) {
      if (!banned.has(c.id)) {
        const option = el('option', { value: c.id }, `${'— '.repeat(depth)}${c.name}`);
        if (c.id === selectedId) option.selected = true;
        select.append(option);
      }
      add(c.id, depth + 1);
    }
  };
  add(null, 0);
}

function openCollectionModal(collection = null) {
  editingCollectionId = collection ? collection.id : null;
  selectedColor = collection ? collection.color : 'blue';
  $('#collection-modal-title').textContent = collection ? 'Edit collection' : 'New collection';
  $('#col-save').textContent = collection ? 'Save changes' : 'Create';
  $('#col-name').value = collection ? collection.name : '';
  // Default parent = currently viewed collection when creating from within it.
  const defaultParent = collection
    ? (collection.parentId || '')
    : (state.view !== 'all' && state.view !== 'unsorted' ? state.view : '');
  fillParentSelect(defaultParent || '', editingCollectionId);
  renderSwatches();
  collectionModal.showModal();
  $('#col-name').focus();
}

function initCollectionModal() {
  $('#new-collection-btn').addEventListener('click', () => openCollectionModal());

  $('#collection-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#col-name').value.trim();
    if (!name) return;
    const parentRaw = $('#col-parent') ? $('#col-parent').value || null : null;
    if (editingCollectionId) {
      const collection = state.collections.find((c) => c.id === editingCollectionId);
      if (collection) {
        // Guard against selecting self/descendant as parent (would orphan a cycle).
        const banned = new Set([editingCollectionId, ...descendantIds(editingCollectionId)]);
        collection.name = name.slice(0, 100);
        collection.color = selectedColor;
        collection.parentId = parentRaw && !banned.has(parentRaw) ? parentRaw : null;
        toast('Collection updated');
      }
    } else {
      state.collections.push({
        id: uid(),
        name: name.slice(0, 100),
        color: selectedColor,
        collapsed: false,
        parentId: parentRaw,
        order: nextOrder(childCollections(parentRaw)),
        createdAt: new Date().toISOString(),
      });
      toast('Collection created');
    }
    saveStore();
    collectionModal.close();
    render();
  });
}

// ---------- view / search ----------

function setView(view) {
  state.view = view;
  render();
}

function initChrome() {
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => setView(item.dataset.view));
  });

  $('#sidebar-toggle').addEventListener('click', () => {
    state.sidebar = !state.sidebar;
    savePrefs();
    applySidebar();
  });

  let searchTimer = null;
  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value.trim().toLowerCase();
      renderMain();
    }, 150);
  });

  document.querySelectorAll('dialog [data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  // Close on backdrop click, but only when the press also started on the
  // backdrop — releasing a text-selection drag outside the form must not
  // discard what was typed.
  document.querySelectorAll('dialog.modal').forEach((dialog) => {
    let pressedOnBackdrop = false;
    dialog.addEventListener('mousedown', (e) => {
      pressedOnBackdrop = e.target === dialog;
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && pressedOnBackdrop) dialog.close();
      pressedOnBackdrop = false;
    });
  });
}

// ---------- view toolbar (view modes + live + import) ----------

function initViewbar() {
  const modes = $('#view-modes');
  modes.replaceChildren();
  for (const m of VIEW_MODES) {
    modes.append(el('button', {
      class: `mode-btn${state.viewMode === m.id ? ' active' : ''}`,
      type: 'button',
      dataset: { mode: m.id },
      onclick: () => {
        state.viewMode = m.id;
        savePrefs();
        modes.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === m.id));
        renderMain();
      },
    }, m.label));
  }

  const live = $('#live-toggle');
  live.checked = state.live;
  live.addEventListener('change', () => {
    state.live = live.checked;
    savePrefs();
    renderMain();
  });

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const added = importBookmarksFile(text);
      saveStore();
      render();
      toast(
        added
          ? `Imported ${added} bookmark${added === 1 ? '' : 's'}`
          : 'No bookmarks found. Use a Chrome export (.html) or the raw "Bookmarks" file.',
        !added,
      );
    } catch {
      toast('Could not read that file.', true);
    }
  });
}

// ---------- browser bookmark import ----------
// A web page can't read the browser's bookmarks directly (only an extension
// can). So we import from a file the user provides, in either of the two shapes
// real browsers produce:
//   1. Netscape HTML export (chrome://bookmarks -> Export)
//   2. Chrome's raw profile "Bookmarks" JSON file (roots -> folders/urls)
// Both map folders to nested collections and links to bookmarks.

// Shared writer so both parsers build state identically. Colors cycle so the
// imported tree stays readable.
function importWriter() {
  const colorNames = Object.keys(COLORS).filter((c) => c !== 'grey');
  let colorIdx = 0;
  let added = 0;
  return {
    folder(name, parentId) {
      const collection = {
        id: uid(),
        name: (name || 'Folder').slice(0, 100),
        color: colorNames[colorIdx++ % colorNames.length],
        collapsed: false,
        parentId: parentId || null,
        order: nextOrder(childCollections(parentId)),
        createdAt: new Date().toISOString(),
      };
      state.collections.push(collection);
      return collection.id;
    },
    link(rawUrl, title, parentId) {
      const url = rawUrl && normalizeUrl(rawUrl);
      if (!url) return;
      state.bookmarks.push({
        id: uid(),
        url,
        title: (title || hostnameOf(url)).slice(0, 300),
        description: '',
        image: null,
        siteName: '',
        favicon: `https://www.google.com/s2/favicons?domain=${hostnameOf(url)}&sz=64`,
        tags: [],
        collectionId: parentId || null,
        order: nextOrder(bookmarksIn(parentId)),
        createdAt: new Date().toISOString(),
      });
      added++;
    },
    get count() { return added; },
  };
}

// Route to the right parser by sniffing the content.
function importBookmarksFile(text) {
  return text.trimStart().startsWith('{') ? importFromJson(text) : importFromHtml(text);
}

function importFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('dl');
  if (!root) return 0;
  const w = importWriter();
  // Walk a <DL>: its <DT> children each hold either an <H3> (folder + nested
  // <DL>) or an <A> (link). parentId threads the current collection down.
  const walk = (dl, parentId) => {
    for (const dt of dl.children) {
      if (dt.tagName !== 'DT') continue;
      const h3 = dt.querySelector(':scope > h3');
      const a = dt.querySelector(':scope > a');
      if (h3) {
        const id = w.folder(h3.textContent, parentId);
        const childDl = dt.querySelector(':scope > dl');
        if (childDl) walk(childDl, id);
      } else if (a) {
        w.link(a.getAttribute('href'), a.textContent, parentId);
      }
    }
  };
  walk(root, null);
  return w.count;
}

function importFromJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { return 0; }
  if (!data || !data.roots) return 0;
  const w = importWriter();
  // A url node -> bookmark; a folder node -> collection whose children recurse.
  const walk = (node, parentId) => {
    if (!node) return;
    if (node.type === 'url' || node.url) {
      w.link(node.url, node.name, parentId);
    } else if (Array.isArray(node.children)) {
      const id = w.folder(node.name, parentId);
      for (const child of node.children) walk(child, id);
    }
  };
  // Each root (bookmark_bar / other / synced) is itself a folder; put its loose
  // links at top level and turn its sub-folders into collections.
  for (const key of Object.keys(data.roots)) {
    const root = data.roots[key];
    if (!root || !Array.isArray(root.children)) continue;
    for (const child of root.children) walk(child, null);
  }
  return w.count;
}

// ---------- boot ----------

async function importLegacyData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.collections) || !Array.isArray(data.bookmarks)) return null;
    return data;
  } catch {
    return null;
  }
}

async function boot() {
  loadPrefs();
  initChrome();
  initBookmarkModal();
  initCollectionModal();
  initStaticDropTargets();
  initViewbar();
  applySidebar();

  const stored = loadStore();
  if (stored) {
    state.collections = stored.collections;
    state.bookmarks = stored.bookmarks;
  } else {
    const legacy = await importLegacyData();
    if (legacy) {
      state.collections = legacy.collections;
      state.bookmarks = legacy.bookmarks;
    }
    saveStore();
  }
  render();
}

boot();
