/* ══════════════════════════════════════
   INFOCHIPS — Link / Markdown / Image inline chip elements
══════════════════════════════════════ */

import { isGuest } from './auth.js';
import { S, schedSave, setChipCreating, saveVisibleNotes } from './state.js';
import { byId, escapeHtml, _updateEditorEmpty, toast } from './helpers.js';
import { _edUndoSnap, snapUndo } from './undo.js';
import { incrementRefByUrl, uploadImage } from './storage.js';

// ── Late-bound deps (set by init.js) ──
const _deps = {};
export function registerInfoChipDeps(d) { Object.assign(_deps, d); }

// ── Type config ──
const IC_TYPES = {
  link:     { label:'Link',     cls:'infochip-link',     color:'#378ADD' },
  markdown: { label:'Markdown', cls:'infochip-markdown', color:'#8bc34a' },
  image:    { label:'Image',    cls:'infochip-image',    color:'#9F9AE8' },
  file:     { label:'File',     cls:'infochip-file',     color:'#7B8A9C' },
  calendar: { label:'Time',     cls:'infochip-calendar', color:'#E8853A' },
  audio:    { label:'Audio',    cls:'infochip-audio',    color:'#E8413A' }
};

// Get effective color for a node type — checks state overrides, falls back to default
export function getNodeColor(type) {
  if (S.nodeColors && S.nodeColors[type]) return S.nodeColors[type];
  return IC_TYPES[type] ? IC_TYPES[type].color : '#7B8A9C';
}

// Check if an image chip has content (url or images array)
function _imageChipHasContent(chip) {
  if (chip.dataset.icUrl) return true;
  try { const imgs = JSON.parse(chip.dataset.icImages || '[]'); return imgs.length > 0 && imgs.some(i => i.url); } catch(e) { return false; }
}

// ── SVG icons (small, inline) ──
const IC_SVG = {
  link:'<svg class="infochip-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  markdown:'<svg class="infochip-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  image:'<svg class="infochip-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  file:'<svg class="infochip-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  calendar:'<svg class="infochip-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  audio:'<svg class="infochip-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
};

// ── Base64 helpers for markdown text storage ──
function _encodeText(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function _decodeText(b64) {
  try { return decodeURIComponent(escape(atob(b64))); }
  catch(e) { return b64; } // fallback: treat as plain text
}

// ── Error text for empty chips ──
function _emptyChipText(type) {
  if (type === 'link') return 'No URL';
  if (type === 'markdown') return 'No MD';
  if (type === 'image') return 'No Image';
  if (type === 'file') return 'No File';
  if (type === 'calendar') return 'No Time';
  if (type === 'audio') return 'No Audio';
  return 'No Content';
}

// ── Date formatting helper ──
function _formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ═══════════════════════════════════
//  CHIP CREATION & HYDRATION
// ═══════════════════════════════════

function _addChipFavicons(chip, activeUrls) {
  chip.querySelectorAll('.infochip-link-favicon').forEach(f => f.remove());
  chip.classList.remove('has-favicon');
  if (!activeUrls?.length) return;
  let added = false;
  activeUrls.forEach((url, i) => {
    if (!url) return;
    try {
      const domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname;
      if (domain && domain.includes('.')) {
        const fav = document.createElement('img');
        fav.className = 'infochip-link-favicon';
        fav.loading = 'lazy';
        const _cf = _getCustomFavicon(domain);
        fav.src = _cf || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        fav.draggable = false;
        fav.dataset.linkUrl = url;
        fav.dataset.linkIdx = String(i);
        fav.dataset.domain = domain;
        fav.style.cursor = 'pointer';
        fav.onerror = () => {
          if (!fav.dataset.tried2) { fav.dataset.tried2 = '1'; fav.src = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${fav.dataset.domain}&size=32`; }
          else if (!fav.dataset.tried3) { fav.dataset.tried3 = '1'; fav.src = `https://icons.duckduckgo.com/ip3/${fav.dataset.domain}.ico`; }
          else { fav.remove(); if (!chip.querySelector('.infochip-link-favicon')) chip.classList.remove('has-favicon'); }
        };
        chip.appendChild(fav);
        added = true;
      }
    } catch(e) {}
  });
  if (added) chip.classList.add('has-favicon');
}

export function createInfoChip(type, data) {
  const conf = IC_TYPES[type];
  if (!conf) return null;
  const chip = document.createElement('span');
  chip.className = `infochip ${conf.cls}`;
  chip.contentEditable = 'false';
  chip.draggable = true;
  chip.dataset.icType = type;

  if (type === 'link') {
    chip.dataset.icUrl = data.url || '';
    if (data.urls && data.urls.length > 1) chip.dataset.icUrls = JSON.stringify(data.urls);
    if (data.activeUrls?.length) chip.dataset.icActiveUrls = JSON.stringify(data.activeUrls);
    chip.dataset.icTitle = data.title || data.url || 'Link';
  } else if (type === 'markdown') {
    chip.dataset.icText = _encodeText(data.text || '');
    chip.dataset.icTitle = data.title || 'MD';
  } else if (type === 'image') {
    chip.dataset.icUrl = data.url || '';
    chip.dataset.icPath = data.path || '';
    chip.dataset.icTitle = data.title || 'Image';
    if (data.hash) chip.dataset.icHash = data.hash;
  } else if (type === 'file') {
    chip.dataset.icFile = data.file || '';
    chip.dataset.icFiles = data.files ? (typeof data.files === 'string' ? data.files : JSON.stringify(data.files)) : '[]';
    chip.dataset.icTitle = data.title || 'File';
    if (data.hash) chip.dataset.icHash = data.hash;
  } else if (type === 'calendar') {
    chip.dataset.icDate = data.date || '';
    chip.dataset.icTime = data.time || '';
    chip.dataset.icDateOn = data.dateOn === false ? '0' : '1';
    chip.dataset.icTimeOn = data.timeOn ? '1' : '0';
    chip.dataset.icAlarm = data.alarm ? '1' : '0';
    const formatted = _formatDate(data.date);
    let titleParts = [];
    if (data.dateOn !== false && formatted) titleParts.push(formatted);
    if (data.timeOn && data.time) titleParts.push(data.time);
    chip.dataset.icTitle = data.title || (titleParts.join(' · ') || 'Time');
  } else if (type === 'audio') {
    chip.dataset.icTracks = data.tracks ? JSON.stringify(data.tracks) : '[]';
    chip.dataset.icTitle = data.title || 'Audio';
    chip.dataset.icPath = data.path || '';
    if (data.hash) chip.dataset.icHash = data.hash;
  }

  const icon = IC_SVG[type] || '';
  const iconWrap = `<span class="infochip-icon-wrap">${icon}</span>`;
  if (type === 'calendar') {
    if (chip.dataset.icTitle === 'Calendar' || chip.dataset.icTitle === 'calendar') chip.dataset.icTitle = 'Time';
    const labelText = chip.dataset.icTitle || 'Time';
    const bellIcon = chip.dataset.icAlarm === '1' ? '<svg class="infochip-bell" width=".9em" height=".9em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' : '';
    chip.innerHTML = `${iconWrap}<span class="infochip-label">${escapeHtml(labelText)}</span>${bellIcon}`;
  } else {
    chip.innerHTML = `${iconWrap}<span class="infochip-label">${escapeHtml(chip.dataset.icTitle)}</span>`;
  }
  if (type === 'link') {
    let _actUrls = [];
    if (data.activeUrls?.length && data.urls) _actUrls = data.activeUrls.map(i => data.urls[i]).filter(Boolean);
    else if (data.url) _actUrls = [data.url];
    _addChipFavicons(chip, _actUrls);
  }
  _updateChipTooltip(chip);
  if (type === 'link' && window._dexUnlockAch) window._dexUnlockAch('link_chip');
  return chip;
}

export function hydrateInfoChips(container) {
  if (!container) return;
  container.querySelectorAll('.infochip').forEach(chip => {
    chip.contentEditable = 'false';
    chip.draggable = true;
    // Set structured drag data for DM node drops
    if (!chip._dexChipDrag) {
      chip._dexChipDrag = true;
      chip.addEventListener('dragstart', (ev) => {
        // Block drag in viewer mode — viewers cannot move session content around
        if (window._dexSharedReadOnly) { ev.preventDefault(); return; }
        const t = chip.dataset.icType;
        if (!t) return;
        const payload = { type: t, title: chip.dataset.icTitle || '' };
        if (t === 'link') {
          let urls = [];
          try { urls = JSON.parse(chip.dataset.icUrls || '[]'); } catch(e) {}
          if (!urls.length && chip.dataset.icUrl) urls = [chip.dataset.icUrl];
          payload.urls = urls;
        } else if (t === 'markdown') {
          payload.content = _decodeText(chip.dataset.icText || '');
        } else if (t === 'image') {
          payload.src = chip.dataset.icUrl || '';
          payload.filename = chip.dataset.icTitle || '';
        } else if (t === 'audio') {
          try { payload.tracks = JSON.parse(chip.dataset.icTracks || '[]'); } catch(e) { payload.tracks = []; }
        } else if (t === 'file') {
          payload.file = chip.dataset.icFile || '';
          try { payload.files = JSON.parse(chip.dataset.icFiles || '[]'); } catch(e) { payload.files = []; }
        }
        ev.dataTransfer.setData('application/dexnote-chip', JSON.stringify(payload));
      });
    }
    // Copy-drag: mousedown creates a floating clone for DM drops
    if (!chip._dexChipMouseDrag) {
      chip._dexChipMouseDrag = true;
      chip.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        const dmPanel = document.getElementById('dm-panel');
        if (!dmPanel || dmPanel.style.display !== 'flex') return;
        const t2 = chip.dataset.icType;
        if (!t2) return;
        const pl = { type: t2, title: chip.dataset.icTitle || '' };
        if (t2 === 'link') {
          let u2 = []; try { u2 = JSON.parse(chip.dataset.icUrls || '[]'); } catch(e) {}
          if (!u2.length && chip.dataset.icUrl) u2 = [chip.dataset.icUrl];
          pl.urls = u2;
        } else if (t2 === 'markdown') { pl.content = _decodeText(chip.dataset.icText || '');
        } else if (t2 === 'image') { pl.src = chip.dataset.icUrl || ''; pl.filename = chip.dataset.icTitle || '';
        }
        const sx = ev.clientX, sy = ev.clientY;
        let cl = null, dr = false;
        const onM = (e2) => {
          if (!dr && (Math.abs(e2.clientX - sx) > 8 || Math.abs(e2.clientY - sy) > 8)) {
            dr = true;
            cl = document.createElement('div');
            cl.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;opacity:0.85;padding:4px 10px;background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;font-size:13px;font-family:var(--fn);color:var(--tx);box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            cl.textContent = pl.title || pl.type;
            document.body.appendChild(cl);
          }
          if (cl) {
            cl.style.left = (e2.clientX + 8) + 'px';
            cl.style.top = (e2.clientY + 8) + 'px';
            const r = dmPanel.getBoundingClientRect();
            const over = e2.clientX >= r.left && e2.clientX <= r.right && e2.clientY >= r.top && e2.clientY <= r.bottom;
            dmPanel.style.outline = over ? '2px solid var(--clr-adj)' : '';
            dmPanel.style.outlineOffset = over ? '-2px' : '';
          }
        };
        const onU = (e2) => {
          document.removeEventListener('mousemove', onM);
          document.removeEventListener('mouseup', onU);
          dmPanel.style.outline = ''; dmPanel.style.outlineOffset = '';
          if (cl) {
            cl.remove();
            const r = dmPanel.getBoundingClientRect();
            if (e2.clientX >= r.left && e2.clientX <= r.right && e2.clientY >= r.top && e2.clientY <= r.bottom) {
              if (window._dexSendDmNode) window._dexSendDmNode(pl);
            }
          }
        };
        document.addEventListener('mousemove', onM);
        document.addEventListener('mouseup', onU);
      });
    }
    // Restore chip data from CSS custom property backup (clipboard-safe)
    const _styleAttr = chip.getAttribute('style') || '';
    const _icDataMatch = _styleAttr.match(/--ic-data:\s*([A-Za-z0-9+/=]+)/);
    if (_icDataMatch) {
      try {
        const _json = decodeURIComponent(escape(atob(_icDataMatch[1])));
        const saved = JSON.parse(_json);
        for (const [key, val] of Object.entries(saved)) {
          if (!chip.dataset[key]) chip.dataset[key] = val;
        }
      } catch(e) {}
      chip.setAttribute('style', _styleAttr.replace(/;?\s*--ic-data:\s*[A-Za-z0-9+/=]+/, '').trim());
    }
    const type = chip.dataset.icType;
    if (!type) return;
    // Normalize legacy "Calendar" title to "Time"
    if (type === 'calendar' && chip.dataset.icTitle === 'Calendar') chip.dataset.icTitle = 'Time';
    // Rebuild icon if missing or unwrapped (e.g. after paste or old save)
    if (!chip.querySelector('.infochip-icon-wrap')) {
      const icon = IC_SVG[type] || '';
      const title = chip.dataset.icTitle || '';
      chip.innerHTML = `<span class="infochip-icon-wrap">${icon}</span><span class="infochip-label">${escapeHtml(title)}</span>`;
    }
    // Add favicons for link chips (active URLs)
    if (type === 'link' && !chip.querySelector('.infochip-link-favicon')) {
      let _hUrls = [];
      try { const ai = JSON.parse(chip.dataset.icActiveUrls || '[]'); const all = JSON.parse(chip.dataset.icUrls || '[]'); _hUrls = ai.map(i => all[i]).filter(Boolean); } catch(e) {}
      if (!_hUrls.length && chip.dataset.icUrl) _hUrls = [chip.dataset.icUrl];
      _addChipFavicons(chip, _hUrls);
      // Click favicon to open that specific link
      chip.addEventListener('click', (ev) => {
        const fav = ev.target.closest('.infochip-link-favicon');
        if (fav && fav.dataset.linkUrl) { ev.preventDefault(); ev.stopPropagation(); window.open(fav.dataset.linkUrl, '_blank'); }
      });
    }
    // Restore minimized state
    if (chip.dataset.icMinimized === '1') {
      chip.classList.add('infochip-minimized');
    } else {
      chip.classList.remove('infochip-minimized');
    }
    // Image chip preview: restore regardless of minimized state
    // (minimized pill + expanded image is a valid combo — icon-only with image visible)
    if (type === 'image' && _imageChipHasContent(chip) && chip.dataset.icImgShow === '1' && !chip.closest('.sec-title-el') && !chip.closest('#cv-title')) {
      const existingWrap = chip.closest('.infochip-img-wrap');
      if (existingWrap) {
        _rebuildWrapContents(chip, existingWrap);
        const _ps=existingWrap.previousSibling;
        if(_ps&&_ps.classList?.contains('img-zws')&&!_ps.textContent) _ps.textContent='\u200B';
        const _ns=existingWrap.nextSibling;
        if(_ns&&_ns.classList?.contains('img-zws')&&!_ns.textContent) _ns.textContent='\u200B';
      } else if (chip.isConnected && chip.parentNode) {
        _showImagePreview(chip);
      }
    }
    _updateChipTooltip(chip);
    // Re-apply no-URL dot + label for chips without content
    const chipEmpty = (type === 'link' && !chip.dataset.icUrl) || (type === 'image' && !_imageChipHasContent(chip)) || (type === 'markdown' && !_decodeText(chip.dataset.icText || '').trim()) || (type === 'file' && !chip.dataset.icFile && !JSON.parse(chip.dataset.icFiles || '[]').length) || (type === 'calendar' && !chip.dataset.icDate) || (type === 'audio' && !JSON.parse(chip.dataset.icTracks || '[]').length);
    if (chipEmpty && !chip.querySelector('.infochip-nourl')) {
      const dot = document.createElement('span');
      dot.className = 'infochip-nourl';
      dot.dataset.tip = 'Empty — no content set';
      chip.appendChild(dot);
      if (!chip.querySelector('.infochip-useless-label')) {
        const lbl = document.createElement('span');
        lbl.className = 'infochip-useless-label';
        lbl.textContent = _emptyChipText(type);
        chip.appendChild(lbl);
      }
    }
    // Remove stale dot + label if content now exists
    const chipHasContent = (type === 'link' && chip.dataset.icUrl) || (type === 'image' && _imageChipHasContent(chip)) || (type === 'markdown' && _decodeText(chip.dataset.icText || '').trim()) || (type === 'file' && chip.dataset.icFile) || (type === 'calendar' && chip.dataset.icDate) || (type === 'audio' && JSON.parse(chip.dataset.icTracks || '[]').length);
    if (chipHasContent && chip.querySelector('.infochip-nourl')) {
      chip.querySelector('.infochip-nourl').remove();
      chip.querySelector('.infochip-useless-label')?.remove();
    }
  });
  // Hydrate chip groups — restore colored toggle + border + bg + count from data-group-clr
  container.querySelectorAll('.chip-group[data-group-clr]').forEach(group => {
    const clr = group.dataset.groupClr;
    if (clr) {
      const isLight = document.documentElement.dataset.theme === 'light';
      const displayClr = isLight ? `color-mix(in hsl,${clr} 70%,black 30%)` : clr;
      group.style.borderColor = displayClr;
      group.style.background = isLight ? `color-mix(in srgb,${clr} 15%,rgba(255,255,255,.6))` : `color-mix(in srgb,${clr} 12%,var(--bg))`;
      const toggle = group.querySelector('.chip-group-toggle');
      if (toggle) {
        toggle.innerHTML = `<svg viewBox="0 0 10 10" fill="${displayClr}" stroke="none"><path d="M2.5,1 L8.5,5 L2.5,9 Q1.5,9 1.5,8 L1.5,2 Q1.5,1 2.5,1 Z"/></svg>`;
        toggle.dataset.hasColor = '1';
      }
      const count = group.querySelector('.chip-group-count');
      if (count) count.style.color = displayClr;
    }
  });
  // ── Deduplicate adjacent ZWS nodes ──
  const _dedupZws = (parent) => {
    const nodes = Array.from(parent.childNodes);
    for (let i = nodes.length - 1; i > 0; i--) {
      const cur = nodes[i], prev = nodes[i - 1];
      const curIsZws = (cur.nodeType === 3 && cur.textContent === '\u200B') || (cur.nodeType === 1 && cur.classList?.contains('img-zws'));
      const prevIsZws = (prev.nodeType === 3 && prev.textContent === '\u200B') || (prev.nodeType === 1 && prev.classList?.contains('img-zws'));
      if (curIsZws && prevIsZws) cur.remove();
    }
  };
  _dedupZws(container);
  container.querySelectorAll?.('.note-ed')?.forEach(ed => _dedupZws(ed));
}

// ═══════════════════════════════════
//  CURSOR MARKER (comment node pattern)
// ═══════════════════════════════════

const _IC_MARKER = '_icp';

function _placeMarker(ed) {
  _removeMarker();
  const sel = window.getSelection();
  let range;
  if (sel && sel.rangeCount) {
    range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
  } else if (ed) {
    range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
  } else return;
  range.insertNode(document.createComment(_IC_MARKER));
}

function _findMarker() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, {
    acceptNode: n => n.nodeValue === _IC_MARKER ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  return w.nextNode() || null;
}

function _removeMarker() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, {
    acceptNode: n => n.nodeValue === _IC_MARKER ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  const nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(n => n.remove());
}

function _insertChipAtMarker(type, data) {
  const marker = _findMarker();
  if (!marker) return;
  const parent = marker.parentNode;
  const range = document.createRange();
  range.setStartBefore(marker);
  range.setEndAfter(marker);
  range.deleteContents();

  const chip = createInfoChip(type, data);
  if (!chip) return;

  // Add no-URL dot + label for chips without content
  const _imgDataHasContent = data.url || (data.images && JSON.parse(data.images || '[]').some(i => i.url));
  const isEmpty = (type === 'link' && !data.url) || (type === 'image' && !_imgDataHasContent) || (type === 'markdown' && !data.text) || (type === 'file' && !data.file && !data.files?.length) || (type === 'calendar' && !data.date) || (type === 'audio' && !data.tracks?.length);
  if (isEmpty) {
    const dot = document.createElement('span');
    dot.className = 'infochip-nourl';
    dot.dataset.tip = 'Empty — no content set';
    chip.appendChild(dot);
    const lbl = document.createElement('span');
    lbl.className = 'infochip-useless-label';
    lbl.textContent = _emptyChipText(type);
    chip.appendChild(lbl);
  }

  const before = document.createTextNode('\u200B');
  const after = document.createTextNode('\u200B');

  range.insertNode(after);
  range.insertNode(chip);
  range.insertNode(before);

  const hostEd = chip.closest('.note-ed');
  if (hostEd) _updateEditorEmpty(hostEd);

  // Place cursor after chip
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStartAfter(after);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ═══════════════════════════════════
//  TOOLBAR DROPDOWN (picker)
// ═══════════════════════════════════

// ── Saved selection for focus preservation ──
let _savedRange = null;
let _savedEditor = null;

function _saveSelection() {
  const sel = window.getSelection();
  _savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
  _savedEditor = document.activeElement?.closest('.note-ed') || null;
}

// ── Quick-insert icon SVGs per type (smaller, for split button) ──
const IC_QUICK_SVG = {
  link:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  markdown:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  image:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  file:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  calendar:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  audio:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
};

const _LS_LAST_CHIP = 'dexnote-last-chip-type';

function _getLastChipType() {
  const v = localStorage.getItem(_LS_LAST_CHIP);
  return (v && IC_TYPES[v]) ? v : 'link';
}

function _setLastChipType(type) {
  const btnEl = document.getElementById('ic-quick-btn');
  const iconEl = document.getElementById('ic-quick-icon');

  if (!type || !IC_TYPES[type]) {
    // Default state — pill icon, no tint
    if (iconEl) iconEl.outerHTML = `<svg id="ic-quick-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="4"/><path d="M12 8 Q16 12 12 16"/></svg>`;
    if (btnEl) {
      btnEl.dataset.tip = 'Insert Node';
      btnEl.style.background = '';
      btnEl.style.color = '';
    }
    return;
  }

  localStorage.setItem(_LS_LAST_CHIP, type);

  if (iconEl) {
    const svgStr = IC_QUICK_SVG[type];
    if (svgStr) {
      const colored = svgStr
        .replace('<svg', `<svg id="ic-quick-icon"`)
        // Keep currentColor — inherits from parent's CSS color via --node-TYPE variable;
      iconEl.outerHTML = colored;
    }
  }

  if (btnEl) {
    btnEl.dataset.tip = `Insert ${IC_TYPES[type].label} Node`;
    const varName = `var(--node-${type})`;
    btnEl.style.setProperty('--ic-quick-clr', varName);
    btnEl.style.color = varName;
    btnEl.style.background = `color-mix(in srgb, ${varName} 12%, transparent)`;
  }
}
window._dexSetLastChipType = _setLastChipType;

let _pickerBound = false;
export function initInfoChipPicker() {
  const wrap = document.getElementById('ic-pick-wrap');
  const btn = document.getElementById('ic-pick-btn');
  const quickBtn = document.getElementById('ic-quick-btn');
  const drop = document.getElementById('ic-pick-drop');
  if (!wrap || !btn || !drop || _pickerBound) return;
  _pickerBound = true;

  // Initialize quick button to last used type (or default pill icon)
  const lastType = localStorage.getItem(_LS_LAST_CHIP);
  _setLastChipType((lastType && IC_TYPES[lastType]) ? lastType : 'link');

  // Prevent focus theft from editor on mousedown
  if (quickBtn) quickBtn.addEventListener('mousedown', e => { e.preventDefault(); _saveSelection(); });
  btn.addEventListener('mousedown', e => { e.preventDefault(); _saveSelection(); });
  drop.addEventListener('mousedown', e => e.preventDefault());

  // Quick insert — left side
  if (quickBtn) {
    quickBtn.addEventListener('click', e => {
      e.stopPropagation();
      wrap.classList.remove('open');
      openInfoChipModal(_getLastChipType());
    });
  }

  // Dropdown toggle — right side
  btn.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });

  drop.addEventListener('click', e => {
    const item = e.target.closest('.ic-pick-item');
    if (!item || item.disabled) return;
    const type = item.dataset.icType;
    wrap.classList.remove('open');
    _setLastChipType(type);
    openInfoChipModal(type);
  });
}

export function closeInfoChipPicker() {
  document.getElementById('ic-pick-wrap')?.classList.remove('open');
}

// ═══════════════════════════════════
//  INSERT MODAL
// ═══════════════════════════════════

let _modalType = null;
let _modalTargetEd = null;
let _modalEditChip = null; // non-null when editing an existing chip
let _modalCleanup = null;

window._dexOpenInfoChipModal = function(type, editChip, prefillData) { openInfoChipModal(type, editChip, prefillData); };
export function openInfoChipModal(type, editChip, prefillData) {
  _modalType = type;
  _modalEditChip = editChip || null;

  // Use saved selection from dropdown mousedown if available, else fall back to current
  const useSaved = !_modalEditChip && _savedRange && _savedEditor;
  _modalTargetEd = _modalEditChip
    ? (_modalEditChip.closest('.note-ed') || null)
    : (useSaved ? _savedEditor : (document.activeElement?.closest?.('.note-ed') || null));

  const insertRange = useSaved ? _savedRange : (
    (window.getSelection()?.rangeCount) ? window.getSelection().getRangeAt(0).cloneRange() : null
  );

  if (!_modalEditChip && !_modalTargetEd) {
    toast('Click inside a note box first');
    _savedRange = null; _savedEditor = null;
    return;
  }

  // Capture highlighted text for label pre-fill (link/image only)
  let highlightedText = '';
  if (!_modalEditChip && insertRange && !insertRange.collapsed && _modalTargetEd?.contains(insertRange.commonAncestorContainer)) {
    highlightedText = insertRange.toString().trim();
  }

  // Place cursor marker at the saved range position
  if (!_modalEditChip && _modalTargetEd && insertRange) {
    _removeMarker();
    // If there WAS highlighted text, we need to delete it and place marker at that location
    if (highlightedText) {
      // Restore selection so deleteContents works on the right range
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(insertRange);
      insertRange.deleteContents();
    }
    const marker = document.createComment(_IC_MARKER);
    if (insertRange.collapsed || highlightedText) {
      insertRange.insertNode(marker);
    } else {
      insertRange.collapse(true);
      insertRange.insertNode(marker);
    }
  } else if (!_modalEditChip && _modalTargetEd) {
    _placeMarker(_modalTargetEd);
  }

  // Clear saved selection — consumed
  _savedRange = null; _savedEditor = null;

  const modal = document.getElementById('ic-modal');
  const backdrop = document.getElementById('ic-modal-backdrop');
  const titleEl = document.getElementById('ic-modal-title');
  const iconEl = document.getElementById('ic-modal-icon');
  const urlInput = document.getElementById('ic-modal-url');
  const textInput = document.getElementById('ic-modal-text');
  const labelInput = document.getElementById('ic-modal-label');
  const dateInput = document.getElementById('ic-modal-date');
  const preview = document.getElementById('ic-modal-preview');
  const okBtn = document.getElementById('ic-modal-ok');
  const cancelBtn = document.getElementById('ic-modal-cancel');

  const conf = IC_TYPES[type];
  titleEl.textContent = _modalEditChip ? `Edit ${conf.label} Node` : `Insert ${conf.label} Node`;

  // Replace the generic icon with the dropdown-style rounded-square icon
  const _iconSvgs = {
    link: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    markdown: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    image: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    audio: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    calendar: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  };
  const nodeColor = getNodeColor(type);
  iconEl.innerHTML = _iconSvgs[type] || '';
  const isLight = document.documentElement.dataset.theme === 'light';
  if (isLight) {
    iconEl.style.background = `color-mix(in hsl, ${nodeColor} 75%, black 25%)`;
    iconEl.style.color = '#fff';
    iconEl.style.stroke = '#fff';
  } else {
    iconEl.style.background = `color-mix(in srgb, ${nodeColor} 12%, transparent)`;
    iconEl.style.color = nodeColor;
    iconEl.style.stroke = nodeColor;
  }

  okBtn.textContent = _modalEditChip ? 'Save' : 'Insert node';

  const imgCanvas = document.getElementById('ic-img-canvas');
  const imgCanvasArea = document.getElementById('ic-img-canvas-area');
  const imgUrlAdd = document.getElementById('ic-img-url-add');
  const imgUploadBtn = document.getElementById('ic-img-upload-btn');
  const imgFileInput = document.getElementById('ic-img-file-input');

  const timeFields = document.getElementById('ic-time-fields');
  const timeInput = document.getElementById('ic-modal-time');
  const dateCb = document.getElementById('ic-time-date-on');
  const timeCb = document.getElementById('ic-time-time-on');
  const alarmCb = document.getElementById('ic-time-alarm-on');

  // Show/hide fields per type
  urlInput.style.display = 'none'; // Old single URL input — hidden, replaced by multi-URL container
  textInput.style.display = (type === 'markdown') ? '' : 'none';

  // Markdown format toggle + copy button
  const mdFormatToggle = document.getElementById('ic-md-format-toggle');
  if (mdFormatToggle) mdFormatToggle.style.display = (type === 'markdown') ? 'flex' : 'none';
  const mdCopyBtn = document.getElementById('ic-modal-copy');
  if (mdCopyBtn) {
    mdCopyBtn.style.display = (type === 'markdown') ? 'flex' : 'none';
  }
  const dlBtn = document.getElementById('ic-modal-download');
  if (dlBtn) {
    dlBtn.style.display = (type === 'markdown') ? 'flex' : 'none';
    dlBtn.onclick = () => {
      const text = textInput.value || '';
      const name = (labelInput.value || 'markdown').replace(/[^a-zA-Z0-9 _-]/g, '');
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name + '.md';
      a.click();
      URL.revokeObjectURL(url);
    };
  }
  const zoomBtn = document.getElementById('ic-modal-zoom');
  if (zoomBtn) {
    zoomBtn.style.display = (type === 'markdown') ? 'flex' : 'none';
    const zoomTips = ['Zoom text', 'Zoom text (medium)', 'Zoom text (large)'];
    zoomBtn.dataset.tip = zoomTips[_mdZoomLevel] || 'Zoom text';
    zoomBtn.onclick = () => {
      _mdZoomLevel = (_mdZoomLevel + 1) % 3;
      try { localStorage.setItem('dexnote-md-zoom', String(_mdZoomLevel)); } catch(e) {}
      _applyMdZoom(textInput, preview);
      zoomBtn.dataset.tip = zoomTips[_mdZoomLevel] || 'Zoom text';
    };
  }
  if (type === 'markdown') {
    _applyMdZoom(textInput, preview);
  }
  if (mdCopyBtn) {
    const mdCopyOrig = mdCopyBtn.innerHTML;
    mdCopyBtn.onclick = () => {
      const text = textInput.value || '';
      const clipText = text.trim() ? text : (labelInput.value || 'Markdown');
      navigator.clipboard.writeText(clipText).then(() => {
        clearTimeout(mdCopyBtn._checkTimer);
        mdCopyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        mdCopyBtn._checkTimer = setTimeout(() => { mdCopyBtn.innerHTML = mdCopyOrig; }, 2000);
      });
    };
  }
  if (type === 'markdown') {
    document.querySelectorAll('#ic-md-format-btns .ic-md-fmt-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`#ic-md-format-btns .ic-md-fmt-btn[data-format="${_mdEditorFormat}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    else document.querySelector('#ic-md-format-btns .ic-md-fmt-btn[data-format="txt"]')?.classList.add('active');

    _applyMdEditorFormat(textInput, preview);
    try {
      const savedW = localStorage.getItem('dexnote-md-editor-w');
      const savedH = localStorage.getItem('dexnote-md-editor-h');
      if (savedW) { textInput.style.width = savedW; preview.style.width = savedW; }
      if (savedH) { textInput.style.height = savedH; preview.style.height = savedH; }
    } catch(e) {}
    _positionResizeGrip();

    document.querySelectorAll('#ic-md-format-btns .ic-md-fmt-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#ic-md-format-btns .ic-md-fmt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mdEditorFormat = btn.dataset.format || 'txt';
        try { localStorage.setItem('dexnote-md-editor-format', _mdEditorFormat); } catch(e) {}
        _applyMdEditorFormat(textInput, preview);
        _positionResizeGrip();
      };
    });
  }

  // Multi-URL container and add button for link type
  const urlsContainer = document.getElementById('ic-modal-urls-container');
  const addUrlBtn = document.getElementById('ic-modal-add-url');
  if (urlsContainer) urlsContainer.style.display = (type === 'link') ? '' : 'none';
  if (addUrlBtn) addUrlBtn.style.display = (type === 'link') ? 'flex' : 'none';

  if (type === 'link' && urlsContainer) {
    urlsContainer.innerHTML = '';
    let urls = [];
    let _activeIndices = [];
    if (_modalEditChip) {
      const multiUrls = _modalEditChip.dataset.icUrls;
      if (multiUrls) { try { urls = JSON.parse(multiUrls); } catch(e) { urls = []; } }
      if (!urls.length && _modalEditChip.dataset.icUrl) urls = [_modalEditChip.dataset.icUrl];
      try { _activeIndices = JSON.parse(_modalEditChip.dataset.icActiveUrls || '[]'); } catch(e) {}
      if (!_activeIndices.length) { const legacy = parseInt(_modalEditChip.dataset.icActiveUrl || '0'); _activeIndices = [legacy]; }
    }
    if (!urls.length) {
      urls = prefillData?.url ? [prefillData.url] : [''];
      if (prefillData?.url) _activeIndices = [0];
    }
    urls.forEach((u, i) => _addUrlRow(urlsContainer, u, _activeIndices.includes(i)));
    if (prefillData?.title && labelInput) labelInput.value = prefillData.title;
    // Ensure at least one bar is active if there are valid URLs
    if (!urlsContainer.querySelector('.ic-modal-url-bar.active')) {
      const firstBar = urlsContainer.querySelector('.ic-modal-url-bar');
      if (firstBar) firstBar.classList.add('active');
    }
  }
  if (timeFields) timeFields.style.display = (type === 'calendar') ? '' : 'none';
  if (imgCanvas) imgCanvas.style.display = (type === 'image') ? '' : 'none';
  if (!(type === 'markdown' && _mdEditorFormat === 'md')) {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }

  // File upload button in modal — only for file type
  const fileUploadBtn = document.getElementById('ic-modal-file-upload');
  const fileModalInput = document.getElementById('ic-modal-file-input');
  if (fileUploadBtn) fileUploadBtn.style.display = (type === 'file') ? '' : 'none';
  let _modalUploadedFiles = [];
  if (type === 'file' && fileUploadBtn && fileModalInput) {
    const onUploadClick = () => fileModalInput.click();
    const onFileChange = async () => {
      if (!fileModalInput.files?.length) return;
      const count = fileModalInput.files.length;
      // Show loading in preview area
      preview.style.display = '';
      preview.innerHTML = `<div class="ic-modal-upload-loading">
        ${_cloneLogoSvg(24)}
        <span>Uploading<span class="ic-file-upload-dots"></span></span>
      </div>`;
      let done = 0;
      for (const f of fileModalInput.files) {
        let result = null;
        if (_deps.uploadFile) result = await _deps.uploadFile(f);
        if (result) {
          _modalUploadedFiles.push({ id: Date.now().toString() + Math.random().toString(36).slice(2,6), name: result.name || f.name, url: result.url, path: result.path, size: result.size || f.size, type: result.type || f.type });
        } else {
          const url = URL.createObjectURL(f);
          _modalUploadedFiles.push({ id: Date.now().toString() + Math.random().toString(36).slice(2,6), name: f.name, url, path: '', size: f.size, type: f.type });
        }
        done++;
      }
      // Show count in preview
      if (_modalUploadedFiles.length) {
        preview.style.display = '';
        preview.innerHTML = `<div style="font-size:12px;color:var(--tx2);font-family:var(--fn);">${_modalUploadedFiles.length} file${_modalUploadedFiles.length > 1 ? 's' : ''} ready: ${_modalUploadedFiles.map(f => f.name).join(', ')}</div>`;
      }
      fileModalInput.value = '';
    };
    fileUploadBtn.addEventListener('click', onUploadClick);
    fileModalInput.addEventListener('change', onFileChange);
    // Store cleanup refs
    modal._fileUploadCleanup = () => {
      fileUploadBtn.removeEventListener('click', onUploadClick);
      fileModalInput.removeEventListener('change', onFileChange);
    };
  }

  // Image modal gets larger class
  modal.classList.toggle('ic-modal-image', type === 'image');
  modal.classList.toggle('ic-modal-markdown', type === 'markdown');

  // Placeholders
  urlInput.placeholder = type === 'link' ? 'https://...' : 'https://example.com/image.png';
  labelInput.placeholder = type === 'calendar' ? 'e.g. Meeting, Deadline...' : (type === 'file' ? 'e.g. report.pdf' : (type === 'link' ? 'Node Label' : 'Label...'));
  // Auto-fill "Link" when label is blurred empty (link type only)
  if (type === 'link' && !labelInput._autoFillBound) {
    labelInput._autoFillBound = true;
    labelInput.addEventListener('blur', () => {
      if (!labelInput.value.trim()) labelInput.value = 'Link';
      _modalSnapshot();
    });
  }

  // Pre-fill for edit mode
  if (_modalEditChip) {
    labelInput.value = _modalEditChip.dataset.icTitle || '';
    if (type === 'link') urlInput.value = _modalEditChip.dataset.icUrl || '';
    if (type === 'markdown') {
      textInput.value = _decodeText(_modalEditChip.dataset.icText || '');
    }
    if (type === 'calendar') {
      if (dateInput) dateInput.value = _modalEditChip.dataset.icDate || '';
      if (timeInput) timeInput.value = _modalEditChip.dataset.icTime || '';
      if (dateCb) dateCb.checked = _modalEditChip.dataset.icDateOn !== '0';
      if (timeCb) timeCb.checked = _modalEditChip.dataset.icTimeOn === '1';
      if (alarmCb) alarmCb.checked = _modalEditChip.dataset.icAlarm === '1';
    }
  } else {
    urlInput.value = '';
    textInput.value = '';
    if (dateInput) dateInput.value = '';
    if (timeInput) timeInput.value = '';
    if (dateCb) { dateCb.checked = true; }
    if (timeCb) { timeCb.checked = false; }
    if (alarmCb) { alarmCb.checked = false; }
    labelInput.value = highlightedText || '';
  }

  // ── Image canvas setup ──
  let _imgList = []; // [{url, selected}]
  if (type === 'image' && imgCanvasArea) {
    imgCanvasArea.innerHTML = '';
    // Load existing images from chip
    if (_modalEditChip) {
      try { _imgList = JSON.parse(_modalEditChip.dataset.icImages || '[]'); } catch(e) { _imgList = []; }
      // Ensure the primary URL is in the list
      const primaryUrl = _modalEditChip.dataset.icUrl;
      if (primaryUrl && !_imgList.find(i => i.url === primaryUrl)) _imgList.unshift({ url: primaryUrl, selected: true });
    }
    if (!_imgList.length) _imgList = [];
    let _imgUndoStack = [];
    // Ensure at least one is selected
    if (_imgList.length && !_imgList.find(i => i.selected)) _imgList[0].selected = true;

    function _renderImgCanvas() {
      imgCanvasArea.innerHTML = '';
      if (!_imgList.length) {
        imgCanvasArea.innerHTML = '<div class="ic-img-empty">Paste, drop, or add images</div>';
        return;
      }
      _imgList.forEach((item, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'ic-img-thumb' + (item.selected ? ' selected' : '');
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = 'Image ' + (idx + 1);
        img.draggable = false;
        if (item._uploading) { thumb.classList.add('uploading'); thumb.style.opacity = '0.5'; }
        thumb.appendChild(img);
        // Delete button
        const del = document.createElement('button');
        del.className = 'ic-img-thumb-del';
        del.innerHTML = '&times;';
        del.dataset.tip = 'Delete image';
        del.addEventListener('click', e => {
          e.stopPropagation();
          if (_imgList.length <= 1) return;
          _imgUndoStack.push(JSON.parse(JSON.stringify(_imgList)));
          const wasSelected = item.selected;
          _imgList.splice(idx, 1);
          if (wasSelected && _imgList.length) _imgList[0].selected = true;
          _renderImgCanvas();
          imgCanvasArea.focus();
        });
        // Hide delete button if this is the only image
        if (_imgList.length <= 1) del.style.display = 'none';
        thumb.appendChild(del);
        // Click to select as preview image
        thumb.addEventListener('click', () => {
          item.selected = !item.selected;
          if (!_imgList.some(i => i.selected)) item.selected = true;
          _renderImgCanvas();
        });
        imgCanvasArea.appendChild(thumb);
      });
      _applyCanvasGrid();
    }

    function _addImage(url, file) {
      if (!url) return;
      const autoSelect = _imgList.length === 0 || !_imgList.some(i => i.selected);
      // If it's a base64 data URL and we have the file, upload to Firebase Storage
      if (url.startsWith('data:') && file && !isGuest()) {
        const placeholder = { url, selected: autoSelect, _uploading: true };
        _imgList.push(placeholder);
        _renderImgCanvas();
        uploadImage(file).then(result => {
          if (result && result.url) {
            placeholder.url = result.url;
            placeholder._path = result.path;
            placeholder._hash = result.hash;
            delete placeholder._uploading;
            _renderImgCanvas();
          }
        }).catch(err => {
          console.warn('Modal image upload failed:', err);
          const idx = _imgList.indexOf(placeholder);
          if (idx >= 0) _imgList.splice(idx, 1);
          _renderImgCanvas();
          toast('Image upload failed — try again');
        });
      } else {
        _imgList.push({ url, selected: autoSelect });
        _renderImgCanvas();
      }
    }

    let _canvasCols = 2;
    try{const sc=parseInt(localStorage.getItem('dexnote-img-canvas-cols'));if(sc>=2&&sc<=6) _canvasCols=sc;}catch(e){}
    function _applyCanvasGrid(){
      if(!imgCanvasArea) return;
      imgCanvasArea.style.gridTemplateColumns=`repeat(${_canvasCols}, 1fr)`;
      imgCanvasArea.querySelectorAll('.ic-img-thumb').forEach(t=>{t.style.width='';t.style.maxWidth='';});
    }
    function _persistZoom(){try{localStorage.setItem('dexnote-img-canvas-cols',String(_canvasCols));}catch(e){}}

    _renderImgCanvas();
    _applyCanvasGrid();

    // One-time: clear stale canvas dimensions that caused overlap
    try{localStorage.removeItem('dexnote-img-canvas-h');localStorage.removeItem('dexnote-img-canvas-w');}catch(e){}
    // Restore saved image canvas size (maxHeight only)
    try{
      const _sw=localStorage.getItem('dexnote-img-canvas-w');
      const _sh=localStorage.getItem('dexnote-img-canvas-h');
      if(_sw) imgCanvasArea.style.width=_sw;
      if(_sh){imgCanvasArea.style.maxHeight=_sh;}
    }catch(e){}
    requestAnimationFrame(()=>_positionResizeGrip());

    // Bottom bar image buttons
    const _imgBtnUp=document.getElementById('ic-img-bottom-upload');
    const _imgBtnDl=document.getElementById('ic-img-bottom-download');
    const _imgFileIn=document.getElementById('ic-img-file-input');
    if(_imgBtnUp) {_imgBtnUp.style.display='flex';_imgBtnUp.onclick=()=>{if(_imgFileIn) _imgFileIn.click();};}
    if(_imgBtnDl) {_imgBtnDl.style.display='flex';_imgBtnDl.onclick=async()=>{
      const selected=_imgList.filter(i=>i.selected);
      const toDownload=selected.length?selected:_imgList;
      if(!toDownload.length) return;
      for(let i=0;i<toDownload.length;i++){
        const imgUrl=toDownload[i].url;
        if(!imgUrl) continue;
        let downloaded=false;
        // Method 1: fetch blob
        try{
          const resp=await fetch(imgUrl,{mode:'cors'});
          if(resp.ok){
            const blob=await resp.blob();
            const blobUrl=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=blobUrl;a.download='image-'+(i+1)+'.'+(blob.type.split('/')[1]||'png');a.style.display='none';
            document.body.appendChild(a);a.click();
            setTimeout(()=>{a.remove();URL.revokeObjectURL(blobUrl);},1000);
            downloaded=true;
          }
        }catch(e){console.warn('Image download fetch failed:',e);}
        // Method 2: canvas fallback
        if(!downloaded){
          try{
            const blob=await new Promise((resolve,reject)=>{
              const img=new Image();img.crossOrigin='anonymous';
              img.onload=()=>{try{const cvs=document.createElement('canvas');cvs.width=img.naturalWidth;cvs.height=img.naturalHeight;cvs.getContext('2d').drawImage(img,0,0);cvs.toBlob(b=>b?resolve(b):reject('toBlob null'),'image/png');}catch(ce){reject(ce);}};
              img.onerror=()=>reject('img load failed');
              img.src=imgUrl;
            });
            const blobUrl=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=blobUrl;a.download='image-'+(i+1)+'.png';a.style.display='none';
            document.body.appendChild(a);a.click();
            setTimeout(()=>{a.remove();URL.revokeObjectURL(blobUrl);},1000);
            downloaded=true;
          }catch(e2){console.warn('Image download canvas failed:',e2);}
        }
        // Method 3: data: URLs
        if(!downloaded&&imgUrl.startsWith('data:')){
          try{
            const res=await fetch(imgUrl);const blob=await res.blob();
            const blobUrl=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=blobUrl;a.download='image-'+(i+1)+'.png';a.style.display='none';
            document.body.appendChild(a);a.click();
            setTimeout(()=>{a.remove();URL.revokeObjectURL(blobUrl);},1000);
            downloaded=true;
          }catch(e3){console.warn('Image download data-url failed:',e3);}
        }
        if(!downloaded){if(typeof toast==='function')toast('Download failed \u2014 try right-click > Save Image');}
        if(toDownload.length>1&&i<toDownload.length-1) await new Promise(r=>setTimeout(r,200));
      }
    };}
    // Match upload/download widths to save/cancel
    requestAnimationFrame(()=>{
      const saveBtn=document.getElementById('ic-modal-ok');
      const cancelBtn=document.getElementById('ic-modal-cancel');
      if(saveBtn&&_imgBtnUp) _imgBtnUp.style.minWidth=saveBtn.offsetWidth+'px';
      if(cancelBtn&&_imgBtnDl) _imgBtnDl.style.minWidth=cancelBtn.offsetWidth+'px';
    });

    // URL add input
    if (imgUrlAdd) {
      imgUrlAdd.value = '';
      imgUrlAdd.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const url = imgUrlAdd.value.trim();
          if (url) { _addImage(url.startsWith('data:') || url.startsWith('http') ? url : 'https://' + url); imgUrlAdd.value = ''; }
        }
      };
    }
    // Upload button
    if (imgUploadBtn && imgFileInput) {
      imgUploadBtn.onclick = () => imgFileInput.click();
      imgFileInput.onchange = () => {
        Array.from(imgFileInput.files).forEach(file => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = ev => _addImage(ev.target.result, file);
          reader.readAsDataURL(file);
        });
        imgFileInput.value = '';
      };
    }
    // Paste into canvas area
    imgCanvasArea.addEventListener('paste', e => {
      const items = Array.from(e.clipboardData?.items || []);
      // Image blob (screenshot, file)
      const imgItem = items.find(i => i.type.startsWith('image/'));
      if (imgItem) {
        e.preventDefault();
        const file = imgItem.getAsFile();
        if (file) { const reader = new FileReader(); reader.onload = ev => _addImage(ev.target.result, file); reader.readAsDataURL(file); }
        return;
      }
      // DexNote chip HTML (copied via toolbar)
      const htmlItem = items.find(i => i.type === 'text/html');
      if (htmlItem) {
        htmlItem.getAsString(html => {
          if (!html.includes('data-ic-type') && !html.includes('data-dexnote-internal')) return;
          const tmp = document.createElement('div'); tmp.innerHTML = html;
          const chip = tmp.querySelector('.infochip[data-ic-type="image"]');
          if (!chip) return;
          e.preventDefault();
          let images = [];
          try { images = JSON.parse(chip.dataset.icImages || '[]'); } catch(ex) {}
          const primaryUrl = chip.dataset.icUrl;
          if (primaryUrl && !images.find(i => i.url === primaryUrl)) images.unshift({ url: primaryUrl, selected: true });
          if (!images.length && primaryUrl) images = [{ url: primaryUrl, selected: true }];
          // Try --ic-data CSS backup
          if (!images.length) {
            const styleAttr = chip.getAttribute('style') || '';
            const m = styleAttr.match(/--ic-data:\s*([A-Za-z0-9+/=]+)/);
            if (m) { try { const d = JSON.parse(decodeURIComponent(escape(atob(m[1])))); if (d.icImages) images = JSON.parse(d.icImages); if (!images.length && d.icUrl) images = [{ url: d.icUrl, selected: true }]; } catch(ex) {} }
          }
          if (images.length) images.forEach(img => _addImage(img.url));
        });
        return;
      }
      // URL text that looks like an image
      const textItem = items.find(i => i.type === 'text/plain');
      if (textItem) {
        textItem.getAsString(text => {
          const url = text.trim();
          if (url.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg|bmp)/i)) { e.preventDefault(); _addImage(url); }
        });
      }
    });
    // Make canvas area focusable for paste
    imgCanvasArea.tabIndex = 0;

    // Ctrl+Scroll = zoom columns, regular scroll = vertical scroll
    imgCanvasArea.addEventListener('wheel', e => {
      if(!e.ctrlKey&&!e.metaKey) return;
      e.preventDefault();
      if(e.deltaY>0){if(_canvasCols<5){_canvasCols++;_applyCanvasGrid();_persistZoom();}}
      else{if(_canvasCols>2){_canvasCols--;_applyCanvasGrid();_persistZoom();}}
    }, { passive: false });

    // Zoom +/− buttons
    const _zoomIn=document.getElementById('ic-img-zoom-in');
    const _zoomOut=document.getElementById('ic-img-zoom-out');
    const _zoomControls=document.getElementById('ic-img-zoom-controls');
    if(_zoomIn) _zoomIn.addEventListener('click',()=>{if(_canvasCols>2){_canvasCols--;_applyCanvasGrid();_persistZoom();}});
    if(_zoomOut) _zoomOut.addEventListener('click',()=>{if(_canvasCols<5){_canvasCols++;_applyCanvasGrid();_persistZoom();}});
    if(_zoomControls) _zoomControls.style.display='flex';

    // Ctrl+Z undo for image canvas deletes
    const _imgUndoHandler=e=>{
      if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){
        e.preventDefault();
        if(_imgUndoStack.length){
          _imgList.length=0;
          _imgUndoStack.pop().forEach(i=>_imgList.push(i));
          _renderImgCanvas();
        }
      }
    };
    imgCanvasArea.addEventListener('keydown',_imgUndoHandler);
    // Backup: listen on modal for Ctrl+Z when canvas not focused
    const _modalEl=document.getElementById('ic-modal');
    const _modalUndoHandler=e=>{
      if(document.activeElement===imgCanvasArea) return;
      _imgUndoHandler(e);
    };
    if(_modalEl){_modalEl.addEventListener('keydown',_modalUndoHandler);_modalEl._modalUndoHandler=_modalUndoHandler;}

    // Drag image out of modal / Shift+drag to duplicate
    let _cvDrag = null;
    const _cvMove = e => {
      if (!_cvDrag) return;
      const dx = e.clientX - _cvDrag.sx, dy = e.clientY - _cvDrag.sy;
      if (!_cvDrag.on) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        _cvDrag.on = true;
        if (_cvDrag.shift) { _addImage(_cvDrag.url); if(!isGuest()) incrementRefByUrl(_cvDrag.url).catch(()=>{}); _cvDrag = null; return; }
        const g = _cvDrag.el.cloneNode(true);
        g.style.cssText = 'position:fixed;pointer-events:none;opacity:.7;z-index:99999;width:80px;transition:none;border-radius:6px;overflow:hidden;';
        document.body.appendChild(g);
        _cvDrag.g = g;
        _cvDrag.el.style.opacity = '.3';
      }
      if (_cvDrag?.g) { _cvDrag.g.style.left = (e.clientX-40)+'px'; _cvDrag.g.style.top = (e.clientY-30)+'px'; }
    };
    const _cvUp = e => {
      if (!_cvDrag) return;
      const { g, el, on, url } = _cvDrag;
      if (g) g.remove();
      if (el) el.style.opacity = '';
      _cvDrag = null;
      if (!on) return;
      const tgt = document.elementsFromPoint(e.clientX, e.clientY)?.find(x => x.closest('.note-ed'))?.closest('.note-ed');
      if (!tgt) return;
      if (_modalCleanup) _modalCleanup();
      const chip = createInfoChip('image', { url, title: 'Image' });
      if (!chip) return;
      chip.draggable = true; chip.dataset.icMinimized = '0'; chip.dataset.icImgShow = '0';
      tgt.focus({preventScroll:true});
      let range;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
      else if (document.caretPositionFromPoint) { const pos = document.caretPositionFromPoint(e.clientX, e.clientY); if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); } }
      const b = document.createTextNode('\u200B'), a = document.createTextNode('\u200B');
      if (range) { range.insertNode(a); range.insertNode(chip); range.insertNode(b); }
      else { tgt.appendChild(b); tgt.appendChild(chip); tgt.appendChild(a); }
      hydrateInfoChips(tgt); _updateEditorEmpty(tgt); schedSave();
      // Increment refCount for the copied image
      if(!isGuest()) incrementRefByUrl(url).catch(()=>{});
    };
    imgCanvasArea.addEventListener('mousedown', e => {
      const thumb = e.target.closest('.ic-img-thumb');
      if (!thumb || e.button !== 0) return;
      const idx = [...imgCanvasArea.querySelectorAll('.ic-img-thumb')].indexOf(thumb);
      if (idx < 0 || !_imgList[idx]) return;
      _cvDrag = { el: thumb, url: _imgList[idx].url, sx: e.clientX, sy: e.clientY, on: false, g: null, shift: e.shiftKey };
    });
    document.addEventListener('mousemove', _cvMove);
    document.addEventListener('mouseup', _cvUp);
    // Store refs for cleanup
    imgCanvasArea._cvCleanup = () => {
      document.removeEventListener('mousemove', _cvMove);
      document.removeEventListener('mouseup', _cvUp);
    };
  }

  setChipCreating(true);
  modal.classList.add('open');
  backdrop.classList.add('open');
  _startModalUndo();

  // Prevent modal backdrop from stealing focus
  backdrop.addEventListener('mousedown', _preventFocus);

  requestAnimationFrame(() => {
    if (type === 'link') labelInput.focus();
    else if (type === 'markdown') labelInput.focus();
    else if (type === 'image') urlInput.focus();
    else labelInput.focus();
    if (type === 'markdown') _positionResizeGrip();
  });

  if (type === 'markdown') {
    _initMdResize();
  }

  // ── Event handlers ──
  const cleanup = () => {
    // Save current state before allowing remote renders — prevents race condition
    // where stale remote state overwrites a recently pasted chip
    if (_modalEditChip) {
      const ed = _modalEditChip.closest('.note-ed');
      if (ed) { saveVisibleNotes(); schedSave(); }
    }
    setChipCreating(false);
    modal.classList.remove('open', 'ic-modal-image', 'ic-modal-markdown');
    modal.style.left = '';
    backdrop.classList.remove('open');
    backdrop.removeEventListener('mousedown', _preventFocus);
    _removeMarker();
    _unbindModal();
    const grip = document.getElementById('ic-md-resize-grip');
    if (grip) grip.style.display = 'none';
    textInput.classList.remove('md-zoom-1', 'md-zoom-2');
    preview.classList.remove('md-zoom-1', 'md-zoom-2');
    const cvArea = document.getElementById('ic-img-canvas-area');
    if (cvArea?._cvCleanup) { cvArea._cvCleanup(); cvArea._cvCleanup = null; }
    _modalCleanup = null;
  };
  _modalCleanup = cleanup;

  const onOk = () => {
    setChipCreating(false);
    modal.classList.remove('open');
    backdrop.classList.remove('open');
    backdrop.removeEventListener('mousedown', _preventFocus);
    _unbindModal();
    _modalCleanup = null;

    const data = _buildData(type, urlInput, textInput, labelInput);
    if (!data) { _removeMarker(); return; }

    // For file chips, attach uploaded files
    if (type === 'file' && _modalUploadedFiles?.length) {
      data.files = _modalUploadedFiles;
    }

    // For image chips, save the image list from canvas
    if (type === 'image' && typeof _imgList !== 'undefined') {
      const readyImages = _imgList.filter(i => i.url && !i._uploading);
      const selectedItems = readyImages.filter(i => i.selected);
      if (selectedItems.length) {
        data.url = selectedItems[0].url;
      } else if (readyImages.length) {
        readyImages[0].selected = true;
        data.url = readyImages[0].url;
      }
      data.images = JSON.stringify(readyImages);
    }

    if (_modalEditChip) {
      _updateChipData(_modalEditChip, type, data);
      // Save image list to chip
      if (type === 'image' && data.images) _modalEditChip.dataset.icImages = data.images;
      const hasContent = (type === 'link' && data.url) || (type === 'image' && data.url) || (type === 'markdown' && data.text) || (type === 'file' && (data.file || data.files?.length)) || (type === 'calendar' && data.date);
      if (hasContent) {
        _modalEditChip.querySelector('.infochip-nourl')?.remove();
        _modalEditChip.querySelector('.infochip-useless-label')?.remove();
      }
      // Update preview image if showing
      if (type === 'image') {
        const wrap = _modalEditChip.closest('.infochip-img-wrap');
        if (wrap) {
          wrap.querySelectorAll('.infochip-img:not(.infochip-img-grid .infochip-img),.infochip-img-grid,.infochip-img-edge').forEach(e=>e.remove());
          _rebuildWrapContents(_modalEditChip, wrap);
        }
      }
      schedSave();
    } else {
      // Insert new chip at marker
      const marker = _findMarker();
      if (marker) {
        const editableParent = marker.parentNode?.closest?.('.note-ed');
        if (editableParent) editableParent.focus({preventScroll:true});
      }
      if (_modalTargetEd) _edUndoSnap(_modalTargetEd);
      _insertChipAtMarker(type, data);
      if (_modalTargetEd) _edUndoSnap(_modalTargetEd);
      schedSave();
    }
  };

  const onCancel = () => cleanup();

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onOk(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  const onTextInput = () => {
    if (type === 'markdown' && _mdEditorFormat === 'md') {
      _applyMdEditorFormat(textInput, preview);
      _positionResizeGrip();
    }
  };

  const onUrlInput = () => {
    if (type !== 'image') return;
    const url = urlInput.value.trim();
    if (url) {
      preview.style.display = '';
      preview.innerHTML = `<img src="${escapeHtml(url)}" style="max-width:100%;max-height:300px;border-radius:6px;display:block;margin:8px auto;" alt="Preview" onerror="this.style.display='none'">`;
    } else { preview.style.display = 'none'; }
  };

  // Textarea: Escape cancels, Enter creates a line break naturally.
  // Tab inserts a real tab char (via execCommand so native undo still works),
  // Ctrl/Cmd+A selects all — standard editor behavior.
  const onTextKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      textInput.select();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // execCommand is deprecated but still widely supported and, crucially,
      // integrates with the native undo stack so Ctrl+Z reverses tab inserts.
      if (!document.execCommand('insertText', false, '\t')) {
        const start = textInput.selectionStart, end = textInput.selectionEnd, val = textInput.value;
        textInput.value = val.slice(0, start) + '\t' + val.slice(end);
        textInput.selectionStart = textInput.selectionEnd = start + 1;
      }
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  // Triple-click → select all text in the textarea
  const onTextClick = e => { if (e.detail === 3) { e.preventDefault(); textInput.select(); } };

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  const closeBtn = document.getElementById('ic-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', onCancel);
  urlInput.addEventListener('input', onUrlInput);
  backdrop.addEventListener('click', onCancel);
  urlInput.addEventListener('keydown', onKey);
  textInput.addEventListener('keydown', onTextKey);
  textInput.addEventListener('click', onTextClick);
  labelInput.addEventListener('keydown', onKey);
  if (dateInput) dateInput.addEventListener('keydown', onKey);
  textInput.addEventListener('input', onTextInput);

  function _unbindModal() {
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    const closeBtn = document.getElementById('ic-modal-close');
    if (closeBtn) closeBtn.removeEventListener('click', onCancel);
    backdrop.removeEventListener('click', onCancel);
    urlInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('keydown', onTextKey);
    textInput.removeEventListener('click', onTextClick);
    labelInput.removeEventListener('keydown', onKey);
    if (dateInput) dateInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('input', onTextInput);
    urlInput.removeEventListener('input', onUrlInput);
    if (modal._fileUploadCleanup) { modal._fileUploadCleanup(); modal._fileUploadCleanup = null; }
    const _mcb = document.getElementById('ic-modal-copy'); if (_mcb) _mcb.onclick = null;
    const _dlb = document.getElementById('ic-modal-download'); if (_dlb) _dlb.onclick = null;
    const _ibu=document.getElementById('ic-img-bottom-upload');if(_ibu){_ibu.style.display='none';_ibu.onclick=null;}
    const _ibd=document.getElementById('ic-img-bottom-download');if(_ibd){_ibd.style.display='none';_ibd.onclick=null;}
    const _izc=document.getElementById('ic-img-zoom-controls');if(_izc) _izc.style.display='none';
    const _me=document.getElementById('ic-modal');if(_me&&_me._modalUndoHandler){_me.removeEventListener('keydown',_me._modalUndoHandler);delete _me._modalUndoHandler;}
    const _zmb = document.getElementById('ic-modal-zoom'); if (_zmb) _zmb.onclick = null;
    document.querySelectorAll('#ic-md-format-btns .ic-md-fmt-btn').forEach(b => { b.onclick = null; });
    _stopModalUndo();
  }
}

function _preventFocus(e) { e.preventDefault(); }

export function closeInfoChipModal() {
  if (_modalCleanup) _modalCleanup();
}

function _isValidLinkUrl(url) {
  if (!url) return false;
  if (/^mailto:/i.test(url)) return url.includes('@');
  if (/^ftp:\/\//i.test(url)) {
    try { return new URL(url).hostname.includes('.'); } catch(e) { return false; }
  }
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch(e) { return false; }
}

// Markdown editor format toggle
let _mdEditorFormat = 'txt';
try { _mdEditorFormat = localStorage.getItem('dexnote-md-editor-format') || 'txt'; } catch(e) {}
let _mdZoomLevel = 0;
try { _mdZoomLevel = parseInt(localStorage.getItem('dexnote-md-zoom') || '0') || 0; } catch(e) {}
function _applyMdZoom(textInput, preview) {
  textInput.classList.remove('md-zoom-1', 'md-zoom-2');
  preview.classList.remove('md-zoom-1', 'md-zoom-2');
  if (_mdZoomLevel === 1) { textInput.classList.add('md-zoom-1'); preview.classList.add('md-zoom-1'); }
  else if (_mdZoomLevel === 2) { textInput.classList.add('md-zoom-2'); preview.classList.add('md-zoom-2'); }
}

function _positionResizeGrip() {
  const grip = document.getElementById('ic-md-resize-grip');
  if (!grip) return;
  const textInput = document.getElementById('ic-modal-text');
  const preview = document.getElementById('ic-modal-preview');
  const imgCanvas=document.getElementById('ic-img-canvas-area');
  const imgCanvasVisible=imgCanvas&&document.getElementById('ic-img-canvas')?.style.display!=='none';
  if (imgCanvasVisible) { grip.style.display = 'none'; return; }
  const target = (textInput && textInput.style.display !== 'none') ? textInput
               : (preview && preview.style.display !== 'none') ? preview
               : null;
  if (!target || !document.getElementById('ic-modal')?.classList.contains('open')) {
    grip.style.display = 'none';
    return;
  }
  const modal = document.getElementById('ic-modal');
  const targetRect = target.getBoundingClientRect();
  const modalRect = modal.getBoundingClientRect();
  grip.style.display = '';
  grip.style.left = (targetRect.right - modalRect.left - 18) + 'px';
  grip.style.top = (targetRect.bottom - modalRect.top - 18) + 'px';
}

let _mdResizeDrag = null;

function _initMdResize() {
  const grip = document.getElementById('ic-md-resize-grip');
  if (!grip || grip._resizeBound) return;
  grip._resizeBound = true;

  grip.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const textInput = document.getElementById('ic-modal-text');
    const preview = document.getElementById('ic-modal-preview');
    const imgCanvas = document.getElementById('ic-img-canvas-area');
    const imgCanvasVisible = imgCanvas && document.getElementById('ic-img-canvas')?.style.display !== 'none';
    if (imgCanvasVisible) return;
    const target = (textInput && textInput.style.display !== 'none') ? textInput
                 : (preview && preview.style.display !== 'none') ? preview
                 : null;
    if (!target) return;

    const startX = e.clientX, startY = e.clientY;
    const startW = target.offsetWidth, startH = target.offsetHeight;
    const minW = 200, minH = 200, maxW = 950;

    _mdResizeDrag = { target, startX, startY, startW, startH, minW, minH, maxW, textInput, preview };
    grip.style.display = 'none';

    const onMove = ev => {
      if (!_mdResizeDrag) return;
      const dx = (ev.clientX - _mdResizeDrag.startX) * 2;
      const dy = (ev.clientY - _mdResizeDrag.startY) * 2;
      const newW = Math.max(minW, Math.min(startW + dx, maxW));
      const newH = Math.max(minH, startH + dy);
      _mdResizeDrag.target.style.width = newW + 'px';
      _mdResizeDrag.target.style.height = newH + 'px';
      if (_mdResizeDrag.target === _mdResizeDrag.textInput) {
        _mdResizeDrag.preview.style.width = newW + 'px';
        _mdResizeDrag.preview.style.height = newH + 'px';
      } else {
        _mdResizeDrag.textInput.style.width = newW + 'px';
        _mdResizeDrag.textInput.style.height = newH + 'px';
      }
    };

    const onUp = () => {
      const finalW = _mdResizeDrag.target.style.width;
      const finalH = _mdResizeDrag.target.style.height;
      _mdResizeDrag = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      grip.style.display = '';
      _positionResizeGrip();
      try { localStorage.setItem('dexnote-md-editor-w', finalW); localStorage.setItem('dexnote-md-editor-h', finalH); } catch(e) {}
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}


function _applyMdEditorFormat(textInput, preview) {
  const MIN_H = 200; // matches CSS min-height

  if (_mdEditorFormat === 'md') {
    // Read dimensions while textarea is still visible; fall back to min if hidden/zero
    const h = textInput.offsetHeight || MIN_H;
    const w = textInput.offsetWidth || 0;
    textInput.style.display = 'none';
    preview.style.display = '';
    preview.style.height = h + 'px';
    if (w > 0) preview.style.width = w + 'px';
    const md = textInput.value.trim();
    if (md) {
      preview.innerHTML = _renderMarkdown(md);
    } else {
      preview.innerHTML = '<div style="color:var(--tx2);font-size:13px;font-style:italic;display:flex;align-items:center;justify-content:center;height:100%;width:100%;">No markdown content to preview</div>';
    }
  } else {
    // Read dimensions while preview is still visible; fall back to min if hidden/zero
    const h = preview.offsetHeight || MIN_H;
    const w = preview.offsetWidth || 0;
    textInput.style.display = '';
    preview.style.display = 'none';
    preview.innerHTML = '';
    textInput.style.height = h + 'px';
    if (w > 0) textInput.style.width = w + 'px';
  }
}

const MAX_URLS = 5;
// Modal-scoped undo/redo system
let _modalUndoStack = [];
let _modalRedoStack = [];
let _modalUndoListening = false;

function _modalSnapshot() {
  const modal = document.getElementById('ic-modal');
  if (!modal || !modal.classList.contains('open')) return;
  const state = {
    label: document.getElementById('ic-modal-label')?.value || '',
    text: document.getElementById('ic-modal-text')?.value || '',
    date: document.getElementById('ic-modal-date')?.value || '',
    urls: []
  };
  const container = document.getElementById('ic-modal-urls-container');
  if (container) {
    container.querySelectorAll('.ic-modal-url-row').forEach(row => {
      const input = row.querySelector('.ic-modal-url-input');
      const bar = row.querySelector('.ic-modal-url-bar');
      state.urls.push({ value: input?.value || '', active: bar?.classList.contains('active') || false });
    });
  }
  const last = _modalUndoStack[_modalUndoStack.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(state)) return;
  _modalUndoStack.push(state);
  _modalRedoStack = [];
}
function _modalRestore(state) {
  if (!state) return;
  const labelInput = document.getElementById('ic-modal-label');
  if (labelInput) labelInput.value = state.label;
  const textInput = document.getElementById('ic-modal-text');
  if (textInput) textInput.value = state.text;
  const dateInput = document.getElementById('ic-modal-date');
  if (dateInput) dateInput.value = state.date;
  const container = document.getElementById('ic-modal-urls-container');
  if (container && state.urls.length > 0) {
    container.innerHTML = '';
    state.urls.forEach(u => _addUrlRow(container, u.value, u.active));
    _refreshUrlRows();
  }
}
function _modalUndo() {
  if (_modalUndoStack.length <= 1) return;
  _modalRedoStack.push(_modalUndoStack.pop());
  _modalRestore(_modalUndoStack[_modalUndoStack.length - 1]);
}
function _modalRedo() {
  if (!_modalRedoStack.length) return;
  const next = _modalRedoStack.pop();
  _modalUndoStack.push(next);
  _modalRestore(next);
}
function _modalUndoKeyHandler(e) {
  const modal = document.getElementById('ic-modal');
  if (!modal || !modal.classList.contains('open')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault(); e.stopImmediatePropagation(); _modalUndo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault(); e.stopImmediatePropagation(); _modalRedo();
  }
}
function _startModalUndo() {
  _modalUndoStack = []; _modalRedoStack = []; _modalSnapshot();
  if (!_modalUndoListening) {
    document.addEventListener('keydown', _modalUndoKeyHandler, true);
    _modalUndoListening = true;
  }
}
function _stopModalUndo() {
  if (_modalUndoListening) {
    document.removeEventListener('keydown', _modalUndoKeyHandler, true);
    _modalUndoListening = false;
  }
  _modalUndoStack = []; _modalRedoStack = [];
}
function _favFallback() {
  const sc = document.documentElement.dataset.theme !== 'light' ? '#555' : '#888';
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${sc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`);
}
function _getCustomFavicon(domain) {
  const d = (domain || '').toLowerCase().replace(/^www\./, '');
  if (d === 'dexnote.dev' || d === 'dexnote.vercel.app') {
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#0b4659" d="M237.8,62.5c-5.2-8.6-18.5-4.8-18.4,5.3.1,25.2.2,47.9.3,60h0c0,23-12.5,42.4-31.8,49.5-17,6.2-35.3,1.1-47.6-13.5l-45.7-53.8c-4.9-5.7-10.9-7.7-17-5.4-6.3,2.3-13.7,9.8-13.7,23.4v64.3c.2,34.9,28.3,63.5,63.2,63.7.3,0,.6,0,.9,0h0c70.4,0,128-57.6,128-128h0c0-23.9-6.6-46.3-18.2-65.5Z"/><path fill="#116e8d" d="M36.2,128.1c0-23,12.5-42.3,31.8-49.4,17-6.2,35.3-1.1,47.6,13.5l45.7,53.8c4.9,5.7,10.9,7.7,17,5.4,6.3-2.3,13.7-9.8,13.7-23.4l-.2-64.3C191.7,28.8,163.6.2,128.7,0c-.2,0-.5,0-.7,0h0C57.6,0,0,57.6,0,128h0c0,23.7,6.6,46,17.9,65.1s18.6,5.1,18.6-5c0-25.1-.2-47.7-.3-59.9Z"/></svg>');
  }
  if (d === 'nodeblast.dev' || d === 'nodeblast.vercel.app') {
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#0b4659" d="M237.8,62.5c-5.2-8.6-18.5-4.8-18.4,5.3.1,25.2.2,47.9.3,60h0c0,23-12.5,42.4-31.8,49.5-17,6.2-35.3,1.1-47.6-13.5l-45.7-53.8c-4.9-5.7-10.9-7.7-17-5.4-6.3,2.3-13.7,9.8-13.7,23.4v64.3c.2,34.9,28.3,63.5,63.2,63.7.3,0,.6,0,.9,0h0c70.4,0,128-57.6,128-128h0c0-23.9-6.6-46.3-18.2-65.5Z"/><path fill="#116e8d" d="M36.2,128.1c0-23,12.5-42.3,31.8-49.4,17-6.2,35.3-1.1,47.6,13.5l45.7,53.8c4.9,5.7,10.9,7.7,17,5.4,6.3-2.3,13.7-9.8,13.7-23.4l-.2-64.3C191.7,28.8,163.6.2,128.7,0c-.2,0-.5,0-.7,0h0C57.6,0,0,57.6,0,128h0c0,23.7,6.6,46,17.9,65.1s18.6,5.1,18.6-5c0-25.1-.2-47.7-.3-59.9Z"/></svg>');
  }
  return null;
}
function _addUrlRow(container, url, isActive) {
  const row = document.createElement('div');
  row.className = 'ic-modal-url-row';

  // Active link indicator bar
  const bar = document.createElement('span');
  bar.className = 'ic-modal-url-bar' + (isActive ? ' active' : '');
  bar.dataset.tip = 'Set as active link';

  const favWrap = document.createElement('span');
  favWrap.className = 'ic-modal-url-favicon';
  const favImg = document.createElement('img');
  favImg.src = _favFallback();
  favImg.width = 17;
  favImg.height = 17;
  favImg.onerror = () => {
    const d = favImg._domain || '';
    if (!favImg.dataset.tried2 && d) { favImg.dataset.tried2 = '1'; favImg.src = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=32`; }
    else if (!favImg.dataset.tried3 && d) { favImg.dataset.tried3 = '1'; favImg.src = `https://icons.duckduckgo.com/ip3/${d}.ico`; }
    else { favImg.src = _favFallback(); }
  };
  favWrap.appendChild(favImg);

  // Unified left zone: bar + favicon — one click/drag target
  const leftZone = document.createElement('div');
  leftZone.className = 'ic-modal-url-left-zone';
  leftZone.appendChild(bar);
  leftZone.appendChild(favWrap);
  row.appendChild(leftZone);

  // Click to toggle active link (multi-select)
  leftZone.addEventListener('click', (e) => {
    e.stopPropagation();
    const urlVal = row.querySelector('.ic-modal-url-input')?.value?.trim();
    if (!bar.classList.contains('active') && !urlVal) return;
    const wasActive = bar.classList.contains('active');
    bar.classList.toggle('active');
    if (wasActive) row._manualDeactivate = true;
    else row._manualDeactivate = false;
    _modalSnapshot();
  });

  // Drag to reorder (within modal) or drag out to create new link node (copy)
  leftZone.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const modal = document.getElementById('ic-modal');
    const backdrop = document.getElementById('ic-modal-backdrop');
    const startY = e.clientY;
    const startX = e.clientX;
    const rowRect = row.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    const grabOffsetX = e.clientX - rowRect.left;
    const grabOffsetY = e.clientY - rowRect.top;
    let dragClone = null, placeholder = null, isDragging = false, isOutside = false, dragOutMode = false;

    const onMove = (e2) => {
      if (!isDragging && (Math.abs(e2.clientY - startY) > 5 || Math.abs(e2.clientX - startX) > 5)) {
        isDragging = true;
        document.getElementById('ic-modal-label')?.blur();
        document.activeElement?.blur?.();
        document.addEventListener('keydown', onEscape);
        dragClone = row.cloneNode(true);
        dragClone.style.cssText = `position:fixed;width:${rowRect.width}px;opacity:0.85;z-index:10001;pointer-events:none;background:var(--bg2);border:1.5px solid var(--clr-adj);border-radius:7px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,.3);transform:scale(0.75);transform-origin:top left;`;
        document.body.appendChild(dragClone);
        placeholder = document.createElement('div');
        placeholder.style.cssText = `height:${rowRect.height}px;border:1.5px dashed var(--clr-adj);border-radius:7px;margin:2px 0;box-sizing:border-box;`;
        row.style.display = 'none';
        container.insertBefore(placeholder, row);
        document.body.style.cursor = 'grabbing';
      }
      if (!isDragging) return;
      dragClone.style.left = (e2.clientX - grabOffsetX * 0.75) + 'px';
      dragClone.style.top = (e2.clientY - grabOffsetY * 0.75) + 'px';
      isOutside = e2.clientX < modalRect.left - 20 || e2.clientX > modalRect.right + 20 ||
                  e2.clientY < modalRect.top - 20 || e2.clientY > modalRect.bottom + 20;

      if (isOutside && !dragOutMode) {
        dragOutMode = true;
        modal.style.display = 'none';
        modal.classList.remove('open');
            backdrop.style.display = 'none';
        backdrop.classList.remove('open');
        row.style.display = '';
        placeholder?.remove();
        placeholder = null;
        const url = row.querySelector('.ic-modal-url-input')?.value?.trim() || '';
        const label = document.getElementById('ic-modal-label')?.value?.trim() || url || 'Link';
        dragClone.innerHTML = `<span style="display:flex;align-items:center;">${IC_SVG.link||''}</span><span>${escapeHtml(label)}</span>`;
        dragClone.style.cssText = `position:fixed;z-index:10001;pointer-events:none;display:inline-flex;align-items:center;gap:0.18em;background:color-mix(in srgb,var(--node-link) 10%,var(--bg2));border:1.5px solid color-mix(in srgb,var(--node-link) 40%,transparent);border-radius:999px;padding:0.15em 0.5em;font-family:var(--fn);font-size:14px;font-weight:700;color:var(--node-link);white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.3);transform:scale(0.9);`;
      }
      if (!dragOutMode && !isOutside) {
        const visibleRows = [...container.querySelectorAll('.ic-modal-url-row')].filter(r => r !== row && r.style.display !== 'none');
        let insertBefore = null;
        for (const r of visibleRows) {
          const rRect = r.getBoundingClientRect();
          if (e2.clientY < rRect.top + rRect.height / 2) { insertBefore = r; break; }
        }
        if (insertBefore) container.insertBefore(placeholder, insertBefore);
        else container.appendChild(placeholder);
      }
      dragClone.style.opacity = isOutside ? '0.9' : '0.85';
    };

    const onEscape = (e3) => {
      if (e3.key === 'Escape' && isDragging) {
        e3.preventDefault();
        e3.stopImmediatePropagation();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('keydown', onEscape);
        document.body.style.cursor = '';
        if (dragClone) dragClone.remove();
        if (dragOutMode) {
          modal.style.display = '';
          backdrop.style.display = '';
          modal.classList.add('open');
          backdrop.classList.add('open');
          dragOutMode = false;
        } else {
          if (placeholder) placeholder.remove();
          row.style.display = '';
        }
        isDragging = false;
      }
    };

    const onUp = (e2) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onEscape);
      document.body.style.cursor = '';
      if (!isDragging) return;
      if (dragClone) dragClone.remove();

      if (dragOutMode) {
        const url = row.querySelector('.ic-modal-url-input')?.value?.trim() || '';
        const label = document.getElementById('ic-modal-label')?.value?.trim() || 'Link';
        const dropTarget = document.elementFromPoint(e2.clientX, e2.clientY);
        const targetEd = dropTarget?.closest('.note-ed') || dropTarget?.closest('.sec-title-el') || dropTarget?.closest('#cv-title');
        if (targetEd && url) {
          modal.style.display = '';
          backdrop.style.display = '';
          modal.classList.remove('open');
                backdrop.classList.remove('open');
          if (_modalCleanup) _modalCleanup();
          targetEd.focus({preventScroll:true});
          const range = document.caretRangeFromPoint?.(e2.clientX, e2.clientY);
          if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
          const newChip = createInfoChip('link', { url, urls: [url], title: label });
          if (newChip) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount) {
              const r = sel.getRangeAt(0);
              const b = document.createTextNode('\u200B');
              const a = document.createTextNode('\u200B');
              r.insertNode(a);
              r.insertNode(newChip);
              r.insertNode(b);
              r.setStartAfter(a);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
            }
            hydrateInfoChips(targetEd);
            schedSave();
          }
        } else {
          modal.style.display = '';
          backdrop.style.display = '';
          modal.classList.add('open');
          backdrop.classList.add('open');
        }
      } else {
        container.insertBefore(row, placeholder);
        row.style.display = '';
        placeholder?.remove();
        _refreshUrlRows();
        _modalSnapshot();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  const input = document.createElement('input');
  input.className = 'ic-modal-url-input';
  input.type = 'text';
  input.placeholder = 'https://...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = url || '';

  const _updateFav = () => {
    const val = input.value.trim();
    try {
      const domain = new URL(val.startsWith('http') ? val : 'https://' + val).hostname;
      if (domain && domain.includes('.')) {
        favImg._domain = domain;
        delete favImg.dataset.tried2; delete favImg.dataset.tried3;
        const _cf = _getCustomFavicon(domain);
        favImg.src = _cf || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      } else { favImg.src = _favFallback(); }
    } catch(e) { favImg.src = _favFallback(); }
  };
  input.addEventListener('blur', () => { _updateFav(); _modalSnapshot(); });
  input.addEventListener('input', () => {
    clearTimeout(input._ft); input._ft = setTimeout(_updateFav, 500);
    const val = input.value.trim();
    if (!val) {
      bar.classList.remove('active');
      row._manualDeactivate = false;
    } else if (!bar.classList.contains('active') && !row._manualDeactivate) {
      try {
        const testUrl = val.startsWith('http') ? val : 'https://' + val;
        const domain = new URL(testUrl).hostname;
        if (domain && domain.includes('.')) bar.classList.add('active');
      } catch(e) {}
    }
  });
  if (url) setTimeout(_updateFav, 0);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'ic-modal-url-copy';
  copyBtn.type = 'button';
  copyBtn.dataset.tip = 'Copy link';
  copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const u = input.value.trim();
    if (!u) return;
    navigator.clipboard.writeText(u).then(() => {
      copyBtn.style.color = 'var(--clr-adj)';
      setTimeout(() => { copyBtn.style.color = ''; }, 800);
    });
  });

  const inputWrap = document.createElement('div');
  inputWrap.className = 'ic-modal-url-input-wrap';
  inputWrap.appendChild(input);
  inputWrap.appendChild(copyBtn);

  row.appendChild(inputWrap);
  container.appendChild(row);
  _refreshUrlRows();
  return input;
}
// Rebuild remove buttons based on row count and update add button visibility
function _refreshUrlRows() {
  const container = document.getElementById('ic-modal-urls-container');
  if (!container) return;
  const rows = container.querySelectorAll('.ic-modal-url-row');
  const count = rows.length;
  rows.forEach(row => {
    const _oldRemove = row.querySelector('.ic-modal-url-remove');
    if (_oldRemove) { const wrap = _oldRemove.parentElement; if (wrap !== row) wrap.remove(); else _oldRemove.remove(); }
    if (count > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'ic-modal-url-remove';
      removeBtn.type = 'button';
      removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="6" x2="11" y2="6"/></svg>';
      removeBtn.dataset.tip = 'Remove link';
      removeBtn.dataset.tipPos = 'right';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        row.remove();
        // Ensure an active bar exists
        if (!container.querySelector('.ic-modal-url-bar.active')) {
          const firstBar = container.querySelector('.ic-modal-url-bar');
          if (firstBar) firstBar.classList.add('active');
        }
        _refreshUrlRows();
        _modalSnapshot();
      });
      const removeBtnWrap = document.createElement('span');
      removeBtnWrap.style.cssText = 'width:32px;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      removeBtnWrap.appendChild(removeBtn);
      row.appendChild(removeBtnWrap);
    }
  });
  const addBtn = document.getElementById('ic-modal-add-url');
  if (addBtn) {
    addBtn.style.opacity = count >= MAX_URLS ? '0.3' : '1';
    addBtn.style.pointerEvents = count >= MAX_URLS ? 'none' : 'auto';
  }
}
document.getElementById('ic-modal-add-url')?.addEventListener('click', () => {
  const container = document.getElementById('ic-modal-urls-container');
  if (!container) return;
  if (container.querySelectorAll('.ic-modal-url-row').length >= MAX_URLS) return;
  const newInput = _addUrlRow(container, '');
  _modalSnapshot();
  newInput.focus();
});

function _buildData(type, urlInput, textInput, labelInput) {
  const label = labelInput.value.trim();
  if (type === 'link') {
    const container = document.getElementById('ic-modal-urls-container');
    const rows = container ? container.querySelectorAll('.ic-modal-url-row') : [];
    const urls = [];
    const activeIndices = [];
    rows.forEach((row) => {
      const inp = row.querySelector('.ic-modal-url-input');
      if (!inp) return;
      let url = inp.value.trim();
      if (url && !/^https?:\/\//i.test(url) && !/^mailto:/i.test(url) && !/^ftp:\/\//i.test(url)) url = 'https://' + url;
      if (row.querySelector('.ic-modal-url-bar.active')) activeIndices.push(urls.length);
      urls.push(url);
    });
    const primaryUrl = activeIndices.length > 0 ? (urls[activeIndices[0]] || '') : (urls[0] || '');
    return { url: primaryUrl, urls: urls, activeUrls: activeIndices, title: label || 'Link' };
  }
  if (type === 'markdown') {
    const text = textInput.value.trim();
    return { text: text || '', title: label || 'MD' };
  }
  if (type === 'image') {
    let url = urlInput.value.trim();
    if (url && !/^https?:\/\//i.test(url) && !/^data:/i.test(url)) url = 'https://' + url;
    // Validate: must be a data URL, or end with an image extension, or contain image-related path
    if (url && !url.startsWith('data:image/')) {
      const urlLower = url.toLowerCase();
      const hasImageExt = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)(\?.*)?$/i.test(urlLower);
      const hasImagePath = /\/(image|img|photo|pic|upload|media)\b/i.test(urlLower);
      const isKnownHost = /\b(imgur|cloudinary|unsplash|pexels|flickr|googleusercontent|firebasestorage)\b/i.test(urlLower);
      if (!hasImageExt && !hasImagePath && !isKnownHost) {
        // Not obviously an image URL — keep it but add a warning title
        return { url: url || '', title: label || 'Image (unverified URL)' };
      }
    }
    return { url: url || '', title: label || 'Image' };
  }
  if (type === 'file') {
    return { file: '', title: label || 'File' };
  }
  if (type === 'calendar') {
    const dateInput = document.getElementById('ic-modal-date');
    const timeInput = document.getElementById('ic-modal-time');
    const dateCb = document.getElementById('ic-time-date-on');
    const timeCb = document.getElementById('ic-time-time-on');
    const alarmCb = document.getElementById('ic-time-alarm-on');
    const date = dateInput ? dateInput.value.trim() : '';
    const time = timeInput ? timeInput.value.trim() : '';
    const dateOn = dateCb ? dateCb.checked : true;
    const timeOn = timeCb ? timeCb.checked : false;
    const alarm = alarmCb ? alarmCb.checked : false;
    const formatted = _formatDate(date);
    let titleParts = [];
    if (dateOn && formatted) titleParts.push(formatted);
    if (timeOn && time) titleParts.push(time);
    const autoTitle = titleParts.join(' · ') || 'Time';
    return { date, time, dateOn, timeOn, alarm, title: label || autoTitle };
  }
  if (type === 'audio') {
    return { title: label || 'Audio', tracks: [] };
  }
  return null;
}

function _prettyUrl(url) {
  try {
    const u = new URL(url);
    let h = u.hostname.replace(/^www\./, '');
    if (u.pathname && u.pathname !== '/') h += u.pathname;
    if (h.length > 32) h = h.slice(0, 29) + '...';
    return h;
  } catch(e) { return url; }
}

function _updateChipData(chip, type, data) {
  if (type === 'link') {
    chip.dataset.icUrl = data.url || '';
    if (data.urls && data.urls.length > 1) chip.dataset.icUrls = JSON.stringify(data.urls);
    else delete chip.dataset.icUrls;
    if (data.activeUrls?.length) chip.dataset.icActiveUrls = JSON.stringify(data.activeUrls);
    else delete chip.dataset.icActiveUrls;
    delete chip.dataset.icActiveUrl; // legacy cleanup
  }
  if (type === 'image') chip.dataset.icUrl = data.url || '';
  if (type === 'markdown') chip.dataset.icText = _encodeText(data.text || '');
  if (type === 'file') { chip.dataset.icFile = data.file || ''; if (data.files) chip.dataset.icFiles = typeof data.files === 'string' ? data.files : JSON.stringify(data.files); }
  if (type === 'calendar') {
    chip.dataset.icDate = data.date || '';
    chip.dataset.icTime = data.time || '';
    chip.dataset.icDateOn = data.dateOn === false ? '0' : '1';
    chip.dataset.icTimeOn = data.timeOn ? '1' : '0';
    chip.dataset.icAlarm = data.alarm ? '1' : '0';
  }
  chip.dataset.icTitle = data.title || '';
  const labelEl = chip.querySelector('.infochip-label');
  if (labelEl) {
    if (type === 'calendar' && data.date) {
      const formatted = _formatDate(data.date);
      labelEl.textContent = (data.title || 'Date') + ' · ' + formatted;
    } else {
      labelEl.textContent = data.title || '';
    }
  }
  if (type === 'link') {
    let _uUrls = [];
    if (data.activeUrls?.length && data.urls) _uUrls = data.activeUrls.map(i => data.urls[i]).filter(Boolean);
    else if (data.url) _uUrls = [data.url];
    _addChipFavicons(chip, _uUrls);
  }
  _updateChipTooltip(chip);
  // Add or remove no-URL dot + label for empty chips
  const _imgSaveHasContent = data.url || (data.images && JSON.parse(data.images || '[]').some(i => i.url));
  const chipEmpty = (type === 'link' && !data.url) || (type === 'image' && !_imgSaveHasContent) || (type === 'markdown' && !data.text) || (type === 'file' && !data.file && !data.files?.length) || (type === 'calendar' && !data.date) || (type === 'audio' && !data.tracks?.length);
  const existing = chip.querySelector('.infochip-nourl');
  if (chipEmpty && !existing) {
    const dot = document.createElement('span');
    dot.className = 'infochip-nourl';
    dot.dataset.tip = 'Empty — no content set';
    chip.appendChild(dot);
    const lbl = document.createElement('span');
    lbl.className = 'infochip-useless-label';
    lbl.textContent = _emptyChipText(type);
    chip.appendChild(lbl);
  } else if (!chipEmpty && existing) {
    existing.remove();
    chip.querySelector('.infochip-useless-label')?.remove();
  }
}

// ═══════════════════════════════════
//  MARKDOWN RENDERER (minimal built-in)
// ═══════════════════════════════════

function _renderMarkdown(md) {
  const _esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Inline formatting
  function _inline(line) {
    // Bold + italic
    line = line.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
    line = line.replace(/___(.+?)___/g, '<b><i>$1</i></b>');
    // Bold
    line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    line = line.replace(/__(.+?)__/g, '<b>$1</b>');
    // Italic
    line = line.replace(/\*(.+?)\*/g, '<i>$1</i>');
    line = line.replace(/_(.+?)_/g, '<i>$1</i>');
    // Strikethrough
    line = line.replace(/~~(.+?)~~/g, '<s>$1</s>');
    // Inline code
    line = line.replace(/`(.+?)`/g, '<code>$1</code>');
    // Links
    line = line.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return line;
  }

  const lines = md.split('\n');
  let html = '';
  let inUl = false, inOl = false, inCode = false, codeLang = '', codeContent = '';
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})(.*)$/.test(raw)) {
      if (!inCode) {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (inOl) { html += '</ol>'; inOl = false; }
        if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
        inCode = true;
        codeLang = raw.replace(/^(`{3,}|~{3,})/, '').trim();
        codeContent = '';
      } else {
        html += '<pre><code' + (codeLang ? ' class="language-' + _esc(codeLang) + '"' : '') + '>' + _esc(codeContent) + '</code></pre>';
        inCode = false;
        codeLang = '';
      }
      continue;
    }
    if (inCode) {
      codeContent += (codeContent ? '\n' : '') + raw;
      continue;
    }

    // Headings (h1-h6)
    const hMatch = raw.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
      const lvl = hMatch[1].length;
      html += '<h' + lvl + '>' + _inline(_esc(hMatch[2])) + '</h' + lvl + '>';
      continue;
    }

    // Horizontal rule
    if (/^([-*_]\s*){3,}$/.test(raw.trim())) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
      html += '<hr>';
      continue;
    }

    // Blockquote
    const bqMatch = raw.match(/^>\s?(.*)$/);
    if (bqMatch) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inBlockquote) { html += '<blockquote>'; inBlockquote = true; }
      const content = bqMatch[1].trim();
      if (content) html += '<p>' + _inline(_esc(content)) + '</p>';
      continue;
    }
    if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }

    // Unordered list item
    const ulMatch = raw.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += '<li>' + _inline(_esc(ulMatch[1])) + '</li>';
      continue;
    }

    // Ordered list item
    const olMatch = raw.match(/^[\s]*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += '<li>' + _inline(_esc(olMatch[1])) + '</li>';
      continue;
    }

    // Close any open lists on non-list line
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }

    // Blank line — skip (paragraph separation handled by margins)
    if (!raw.trim()) continue;

    // Regular paragraph
    html += '<p>' + _inline(_esc(raw)) + '</p>';
  }

  // Close any open blocks
  if (inUl) html += '</ul>';
  if (inOl) html += '</ol>';
  if (inBlockquote) html += '</blockquote>';
  if (inCode) html += '<pre><code>' + _esc(codeContent) + '</code></pre>';

  return html;
}

// ═══════════════════════════════════
//  CHIP CLICK BEHAVIOR
// ═══════════════════════════════════

export function handleInfoChipClick(chip) {
  const type = chip.dataset.icType;
  if (type === 'link') {
    const url = chip.dataset.icUrl;
    if (url) window.open(url, '_blank', 'noopener');
    else openInfoChipModal(type, chip);
  } else if (type === 'markdown') {
    // Toggle: if modal is already open for this chip, close it
    const modal = document.getElementById('ic-modal');
    if (modal?.classList.contains('open') && _modalEditChip === chip) {
      closeInfoChipModal();
      return;
    }
    openInfoChipModal(type, chip);
  } else if (type === 'image') {
    const hasUrl = _imageChipHasContent(chip);
    const inTitle = !!(chip.closest('.sec-title-el') || chip.closest('#cv-title'));
    if (hasUrl && !inTitle) {
      if (chip.dataset.icImgShow === '1') {
        // Pill clicked on expanded image → collapse it
        _hideImagePreview(chip);
        chip.dataset.icImgShow = '0';
        _updateChipTooltip(chip);
        schedSave();
      } else {
        chip.dataset.icImgShow = '1';
        _showImagePreview(chip);
        _updateChipTooltip(chip);
        schedSave();
      }
    } else {
      openInfoChipModal(type, chip);
    }
  } else if (type === 'file') {
    _openFilePanel(chip);
  } else if (type === 'calendar') {
    openInfoChipModal(type, chip);
  } else if (type === 'audio') {
    _openAudioPanel(chip);
  }
}

// ═══════════════════════════════════
//  MARKDOWN PREVIEW POPUP
// ═══════════════════════════════════

function _showMarkdownPreview(text, title) {
  const el = document.getElementById('ic-md-preview');
  const body = document.getElementById('ic-md-preview-body');
  const titleEl = document.getElementById('ic-md-preview-title');
  if (!el || !body) return;
  titleEl.textContent = title || 'Markdown Preview';
  body.innerHTML = _renderMarkdown(text);
  el.classList.add('open');
}

export function closeMarkdownPreview() {
  document.getElementById('ic-md-preview')?.classList.remove('open');
}

// ═══════════════════════════════════
//  IMAGE LIGHTBOX
// ═══════════════════════════════════

let _galleryImages=[];
let _galleryIdx=0;

function _showImageLightbox(url) {
  _galleryImages=[url];
  _galleryIdx=0;
  _renderGallery();
  const el=document.getElementById('ic-lightbox');
  if(el) el.classList.add('open');
}

function _openGalleryLightbox(chip, startIdx) {
  let images=[];
  try{images=JSON.parse(chip.dataset.icImages||'[]');}catch(e){}
  const primary=chip.dataset.icUrl;
  if(primary&&!images.find(i=>i.url===primary)) images.unshift({url:primary,selected:true});
  if(!images.length&&primary) images=[{url:primary,selected:true}];
  if(!images.length) return;
  _galleryImages=images.map(i=>i.url);
  _galleryIdx=(typeof startIdx==='number'&&startIdx>=0&&startIdx<_galleryImages.length)?startIdx:0;
  _renderGallery();
  const el=document.getElementById('ic-lightbox');
  if(el) el.classList.add('open');
}

function _renderGallery(){
  const img=document.getElementById('ic-lightbox-img');
  if(img){img.src=_galleryImages[_galleryIdx]||'';img.alt='Image '+(_galleryIdx+1)+' of '+_galleryImages.length;}
  const counter=document.getElementById('ic-lightbox-counter');
  if(counter) counter.textContent=_galleryImages.length>1?(_galleryIdx+1)+' / '+_galleryImages.length:'';
  const prev=document.getElementById('ic-lightbox-prev');
  const next=document.getElementById('ic-lightbox-next');
  if(prev) prev.style.display=_galleryImages.length>1?'':'none';
  if(next) next.style.display=_galleryImages.length>1?'':'none';
  _renderThumbnails();
}

function _renderThumbnails(){
  const strip=document.getElementById('ic-lightbox-thumbs');
  if(!strip) return;
  strip.innerHTML='';
  if(_galleryImages.length<=1){strip.style.display='none';return;}
  strip.style.display='flex';
  _galleryImages.forEach((url,i)=>{
    const thumb=document.createElement('img');
    thumb.src=url;thumb.alt='Thumbnail '+(i+1);
    thumb.className='ic-lightbox-thumb'+(i===_galleryIdx?' active':'');
    thumb.addEventListener('click',e=>{e.stopPropagation();_galleryIdx=i;_renderGallery();});
    strip.appendChild(thumb);
  });
  const active=strip.querySelector('.ic-lightbox-thumb.active');
  if(active) active.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
}

export function galleryPrev(){
  if(_galleryImages.length<=1) return;
  _galleryIdx=(_galleryIdx-1+_galleryImages.length)%_galleryImages.length;
  _renderGallery();
}
export function galleryNext(){
  if(_galleryImages.length<=1) return;
  _galleryIdx=(_galleryIdx+1)%_galleryImages.length;
  _renderGallery();
}

export function closeImageLightbox() {
  const el=document.getElementById('ic-lightbox');
  if(el){el.classList.remove('open');const img=document.getElementById('ic-lightbox-img');if(img) img.src='';}
  _galleryImages=[];_galleryIdx=0;
}

// ═══════════════════════════════════
//  HOVER TOOLBAR
// ═══════════════════════════════════

let _icToolbarTarget = null;
let _icToolbarHideTimer = null;
let _icTargetNullTimer = null;

export function showInfoChipToolbar(chip) {
  clearTimeout(_icToolbarHideTimer);
  clearTimeout(_icTargetNullTimer);
  const isSameChip = _icToolbarTarget === chip;
  _icToolbarTarget = chip;
  // Keep image wrap visible while toolbar is shown (clean image previews mode)
  const _tw=chip.closest('.infochip-img-wrap');
  if(_tw) _tw.classList.add('img-wrap-toolbar-active');

  const tb = document.getElementById('ic-toolbar');
  if (tb) tb._lastTarget = chip;
  if (!tb) return;

  const type = chip.dataset.icType;
  const isMinimized = chip.dataset.icMinimized === '1';
  // Show/hide buttons per type
  const editBtn = document.getElementById('ict-edit');
  const copyBtn = document.getElementById('ict-copy');
  const openBtn = document.getElementById('ict-open');
  const minimizeBtn = document.getElementById('ict-minimize');
  const deleteBtn = document.getElementById('ict-delete');

  // Edit + Copy for all types; Open only for image
  if (editBtn) editBtn.style.display = '';
  if (copyBtn) {
    const hideCopy = (type === 'link' && !chip.dataset.icUrl) || (type === 'image' && !_imageChipHasContent(chip));
    copyBtn.style.display = hideCopy ? 'none' : '';
  }
  if (openBtn) openBtn.style.display = (type === 'image') ? '' : 'none';
  if (openBtn && type === 'image') openBtn.dataset.tip = 'Preview image';
  if (deleteBtn) deleteBtn.style.display = '';
  // Always reset confirm button when toolbar shows
  // Minimize button hidden — icon click handles minimize/expand
  if (minimizeBtn) minimizeBtn.style.display = 'none';

  // Dynamic copy tooltip per type
  if (copyBtn) {
    if (type === 'link') copyBtn.dataset.tip = 'Copy link';
    else if (type === 'markdown') copyBtn.dataset.tip = 'Copy MD';
    else if (type === 'image') copyBtn.dataset.tip = 'Copy image URL';
    else if (type === 'file') copyBtn.dataset.tip = 'Copy file';
    else if (type === 'calendar') copyBtn.dataset.tip = 'Copy time';
    else copyBtn.dataset.tip = 'Copy';
  }

  // Position above chip — nearly touching (1px gap)
  const r = chip.getBoundingClientRect();
  tb.style.left = (r.left + r.width / 2) + 'px';
  tb.style.top = (r.top - 1) + 'px';
  tb.style.transform = 'translate(-50%, -100%)';
  tb.classList.add('visible');
}


export function hideInfoChipToolbar(delay) {
  clearTimeout(_icToolbarHideTimer);
  const _cpBtn = document.getElementById('ict-copy');
  if (_cpBtn?._checkTimer) { clearTimeout(_cpBtn._checkTimer); _cpBtn._checkTimer = null; _cpBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="7" height="8" rx="1.5"/><path d="M5 5H3.5A1.5 1.5 0 0 0 2 6.5v5A1.5 1.5 0 0 0 3.5 13h5A1.5 1.5 0 0 0 10 11.5V10"/></svg>'; }
  const _clearWrapActive=()=>document.querySelectorAll('.img-wrap-toolbar-active').forEach(w=>w.classList.remove('img-wrap-toolbar-active'));
  if (delay === 0) {
    document.getElementById('ic-toolbar')?.classList.remove('visible');
    _clearWrapActive();
    clearTimeout(_icTargetNullTimer);
    _icTargetNullTimer = setTimeout(() => { _icToolbarTarget = null; }, 150);
  } else if (delay) {
    _icToolbarHideTimer = setTimeout(() => {
      document.getElementById('ic-toolbar')?.classList.remove('visible');
      _clearWrapActive();
      _icToolbarTarget = null;
    }, delay);
  } else {
    document.getElementById('ic-toolbar')?.classList.remove('visible');
    _clearWrapActive();
    clearTimeout(_icTargetNullTimer);
    _icTargetNullTimer = setTimeout(() => { _icToolbarTarget = null; }, 150);
  }
}

export function handleToolbarAction(action) {
  const chip = _icToolbarTarget;
  if (!chip) return;
  const type = chip.dataset.icType;

  if (action === 'edit') {
    hideInfoChipToolbar();
    if (type === 'audio') { _openAudioPanel(chip); return; }
    if (type === 'file') { _openFilePanel(chip); return; }
    openInfoChipModal(type, chip);
  } else if (action === 'copy') {
    let text = '';
    if (type === 'link') text = chip.dataset.icUrl || '';
    else if (type === 'markdown') text = _decodeText(chip.dataset.icText || '');
    else if (type === 'image') text = chip.dataset.icUrl || '';
    else if (type === 'file') text = chip.dataset.icFile || chip.dataset.icTitle || '';
    else if (type === 'calendar') text = chip.dataset.icDate || chip.dataset.icTitle || '';
    const copyBtn = document.getElementById('ict-copy');
    window._dexChipClipboard = { type: type, outerHTML: chip.outerHTML, timestamp: Date.now() };
    const chipClone = chip.cloneNode(true);
    const _icCopyData = {};
    for (const [key, val] of Object.entries(chip.dataset)) {
      if (key.startsWith('ic')) _icCopyData[key] = val;
    }
    const _icEncoded = btoa(unescape(encodeURIComponent(JSON.stringify(_icCopyData))));
    const _icExStyle = chipClone.getAttribute('style') || '';
    chipClone.setAttribute('style', _icExStyle + ';--ic-data:' + _icEncoded);
    const chipHtml = '<div data-dexnote-internal="1">' + chipClone.outerHTML + '</div>';
    let clipText = text || chip.dataset.icTitle || type;
    if (type === 'markdown' && chip.dataset.icText) {
      try { clipText = _decodeText(chip.dataset.icText); } catch(e) {}
    }
    let htmlForClipboard = chipHtml;
    if (type === 'markdown' && clipText && clipText !== chip.dataset.icTitle) {
      const escaped = clipText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      htmlForClipboard = '<pre style="font-family:monospace;white-space:pre-wrap;">' + escaped + '</pre>';
    }
    const copyPromise = navigator.clipboard?.write
      ? navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([clipText], { type: 'text/plain' }),
          'text/html': new Blob([htmlForClipboard], { type: 'text/html' })
        })])
      : navigator.clipboard.writeText(clipText);
    const COPY_ICON='<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="7" height="8" rx="1.5"/><path d="M5 5H3.5A1.5 1.5 0 0 0 2 6.5v5A1.5 1.5 0 0 0 3.5 13h5A1.5 1.5 0 0 0 10 11.5V10"/></svg>';
    copyPromise.then(() => {
      if (copyBtn) {
        const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 7.5 5.5 10.5 11.5 4"/></svg>';
        copyBtn.innerHTML = CHECK_ICON;
        clearTimeout(copyBtn._checkTimer);
        copyBtn._checkTimer = setTimeout(() => { copyBtn.innerHTML = COPY_ICON; }, 2000);
      }
    });
  } else if (action === 'minimize') {
    toggleMinimize(chip);
    hideInfoChipToolbar();
  } else if (action === 'open') {
    hideInfoChipToolbar();
    if (type === 'image' && _imageChipHasContent(chip)) {
      _openGalleryLightbox(chip);
    } else {
      handleInfoChipClick(chip);
    }
  } else if (action === 'delete') {
    hideInfoChipToolbar();
    snapUndo();
    const ed = chip.closest('.note-ed');
    if (ed) _edUndoSnap(ed);
    const wrap=chip.closest('.infochip-img-wrap');
    if(wrap){
      const parent=wrap.parentNode;
      const prevSib=wrap.previousSibling;
      if(prevSib&&prevSib.classList?.contains('img-zws')) prevSib.remove();
      const nextSib=wrap.nextSibling;
      if(nextSib&&nextSib.classList?.contains('img-zws')) nextSib.remove();
      if(parent) parent.querySelectorAll('[style*="vertical-align"]').forEach(el=>{
        if(el._imgAligned){el.style.verticalAlign='';delete el._imgAligned;}
      });
      wrap.remove();
    } else {
      const prev=chip.previousSibling;
      const next=chip.nextSibling;
      if(prev&&prev.nodeType===3&&prev.textContent==='\u200B') prev.remove();
      if(next&&next.nodeType===3&&next.textContent==='\u200B') next.remove();
      chip.remove();
    }
    if (ed) { _updateEditorEmpty(ed); _edUndoSnap(ed); }
    schedSave();
  }
}

// ═══════════════════════════════════
//  MINIMIZE / EXPAND
// ═══════════════════════════════════

export function toggleMinimize(chip) {
  if (!chip) return;
  const type = chip.dataset.icType;

  // Image chips: icon click toggles circle ↔ pill only, image stays as-is
  if (type === 'image') {
    const isMinimized = chip.dataset.icMinimized === '1';
    if (isMinimized) {
      chip.dataset.icMinimized = '0';
      chip.classList.remove('infochip-minimized');
    } else {
      chip.dataset.icMinimized = '1';
      chip.classList.add('infochip-minimized');
    }
  } else {
    // All other chips: 2-state toggle
    const isMinimized = chip.dataset.icMinimized === '1';
    if (isMinimized) {
      chip.dataset.icMinimized = '0';
      chip.classList.remove('infochip-minimized');
    } else {
      chip.dataset.icMinimized = '1';
      chip.classList.add('infochip-minimized');
    }
  }
  _updateChipTooltip(chip);
  // Reposition toolbar if it's visible over this chip
  const tb = document.getElementById('ic-toolbar');
  if (tb?.classList.contains('visible') && _icToolbarTarget === chip) {
    requestAnimationFrame(() => {
      const r = chip.getBoundingClientRect();
      tb.style.transition = 'left 180ms ease, top 180ms ease';
      tb.style.left = (r.left + r.width / 2) + 'px';
      tb.style.top = (r.top - 1) + 'px';
      setTimeout(() => { tb.style.transition = ''; }, 200);
    });
  }
  schedSave();
}

function _findPreviewWrap(chip) {
  return chip.closest('.infochip-img-wrap') || null;
}

function _edMaxW(el) {
  const ed = el?.closest?.('.note-ed');
  if (!ed) return 500;
  const cs = getComputedStyle(ed);
  return ed.clientWidth - (parseFloat(cs.paddingLeft)||0) - (parseFloat(cs.paddingRight)||0) - 6;
}

function _rebuildWrapContents(chip, wrap) {
  // Clean stale collage grid that survived save/restore
  const staleGrid=wrap.querySelector('.infochip-img-grid');
  if(staleGrid) staleGrid.remove();
  if(wrap.querySelector('.infochip-img')) return;
  wrap.contentEditable='false';

  let selectedUrls=[];
  try{const images=JSON.parse(chip.dataset.icImages||'[]');selectedUrls=images.filter(i=>i.selected).map(i=>i.url);}catch(e){}
  if(!selectedUrls.length&&chip.dataset.icUrl) selectedUrls.push(chip.dataset.icUrl);
  if(!selectedUrls.length) return;

  const savedW=parseInt(chip.dataset.icImgWidth);
  const maxW=_edMaxW(wrap);
  wrap.style.width=(savedW>0?Math.min(savedW,maxW):Math.round(maxW*0.2))+'px';

  // Hide border until images load
  wrap.style.borderColor='transparent';
  let _loadCount=0;
  const _total=selectedUrls.length;
  const _onReady=()=>{_loadCount++;if(_loadCount>=_total) wrap.style.borderColor='';};
  setTimeout(()=>{wrap.style.borderColor='';},600);

  if(selectedUrls.length===1){
    const img=document.createElement('img');
    img.className='infochip-img';img.loading='lazy';
    img.src=selectedUrls[0];img.alt=chip.dataset.icTitle||'Image';
    img.draggable=false;
    img.addEventListener('click',e=>{e.stopPropagation();_openGalleryLightbox(chip);});
    if(img.complete) _onReady(); else img.onload=_onReady;
    wrap.appendChild(img);
  } else {
    const grid=document.createElement('div');grid.className='infochip-img-grid';
    const wrapW=parseInt(wrap.style.width)||200;
    let cols=selectedUrls.length===2?2:selectedUrls.length<=4?2:Math.min(3,Math.ceil(Math.sqrt(selectedUrls.length)));
    if(wrapW<160) cols=1;
    grid.style.gridTemplateColumns=`repeat(${cols}, 1fr)`;
    selectedUrls.forEach((url,i)=>{
      const cell=document.createElement('div');cell.className='infochip-img-cell';
      const img=document.createElement('img');img.className='infochip-img';img.loading='lazy';
      img.src=url;img.alt=(chip.dataset.icTitle||'Image')+' '+(i+1);
      img.draggable=false;
      img.addEventListener('click',e=>{e.stopPropagation();_openGalleryLightbox(chip,i);});
      if(img.complete) _onReady(); else img.onload=_onReady;
      cell.appendChild(img);grid.appendChild(cell);
    });
    wrap.appendChild(grid);
  }

  ['top','right','bottom','left','top-left','top-right','bottom-left','bottom-right'].forEach(pos=>{
    const edge=document.createElement('span');edge.className='infochip-img-edge infochip-img-edge-'+pos;
    edge.addEventListener('mousedown',_makeResizeHandler(chip,wrap,pos));
    wrap.appendChild(edge);
  });
}

function _makeResizeHandler(chip, wrap, pos) {
  return e => {
    e.preventDefault(); e.stopPropagation();
    // Lock cursor to starting resize direction for entire drag
    const cursorMap = {
      'top':'ns-resize','bottom':'ns-resize',
      'left':'ew-resize','right':'ew-resize',
      'top-left':'nwse-resize','bottom-right':'nwse-resize',
      'top-right':'nesw-resize','bottom-left':'nesw-resize'
    };
    const _resCursor = cursorMap[pos] || 'nwse-resize';
    const _resizeStyle = document.createElement('style');
    _resizeStyle.id = 'dex-resize-cursor-lock';
    _resizeStyle.textContent = `html, html *, body, body * { cursor: ${_resCursor} !important; }`;
    document.head.appendChild(_resizeStyle);
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    // Snapshot state BEFORE resize so Ctrl+Z restores original size in one step
    saveVisibleNotes();
    snapUndo();
    const startX = e.clientX, startY = e.clientY;
    const startW = wrap.offsetWidth;
    const minW = 60;
    const useY = pos === 'top' || pos === 'bottom';
    const invert = pos.includes('left') || pos === 'top';
    const imgEl = wrap.querySelector('.infochip-img');
    const ratio = imgEl && imgEl.naturalWidth ? imgEl.naturalHeight / imgEl.naturalWidth : 1;

    const onMove = ev => {
      const maxW = _edMaxW(wrap);
      const d = useY ? (ev.clientY - startY) / ratio : (ev.clientX - startX);
      const delta = invert ? -d : d;
      wrap.style.width = Math.max(minW, Math.min(maxW, startW + delta)) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const _lockStyle = document.getElementById('dex-resize-cursor-lock');
      if (_lockStyle) _lockStyle.remove();
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      // Final clamp
      const maxW = _edMaxW(wrap);
      const w = Math.max(minW, Math.min(maxW, wrap.offsetWidth));
      wrap.style.width = w + 'px';
      chip.dataset.icImgWidth = String(w);
      if (w < 100) { chip.classList.add('infochip-minimized'); chip.dataset.icMinimized = '1'; }
      else { chip.classList.remove('infochip-minimized'); chip.dataset.icMinimized = '0'; }
      schedSave();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

export function _showImagePreview(chip) {
  if (_findPreviewWrap(chip)) return;
  const url = chip.dataset.icUrl;
  if (!url) return;

  const wrap = document.createElement('span');
  wrap.className = 'infochip-img-wrap img-anim-in';
  wrap.contentEditable = 'false';

  chip.parentNode.insertBefore(wrap, chip);
  wrap.appendChild(chip);
  chip.draggable = false; // prevent native drag while inside wrap

  _rebuildWrapContents(chip, wrap);

  // ZWS anchors for cursor navigation — consume plain ZWS first to avoid doubling
  const _pn = wrap.previousSibling;
  if (_pn && _pn.nodeType === 3 && _pn.textContent === '\u200B') _pn.remove();
  const _nn = wrap.nextSibling;
  if (_nn && _nn.nodeType === 3 && _nn.textContent === '\u200B') _nn.remove();
  if (!wrap.previousSibling || !(wrap.previousSibling.classList?.contains('img-zws'))) {
    const zws = document.createElement('span');
    zws.className = 'img-zws'; zws.textContent = '\u200B';
    wrap.parentNode.insertBefore(zws, wrap);
  }
  if (!wrap.nextSibling || !(wrap.nextSibling.classList?.contains('img-zws'))) {
    const zws = document.createElement('span');
    zws.className = 'img-zws'; zws.textContent = '\u200B';
    wrap.parentNode.insertBefore(zws, wrap.nextSibling);
  }

  // Wrap adjacent bare ZWS text nodes in img-zws spans so cursor height is constrained
  const _checkPrev = wrap.previousSibling?.previousSibling;
  if (_checkPrev && _checkPrev.nodeType === 3 && _checkPrev.textContent === '\u200B') {
    const _zwsWrap = document.createElement('span');
    _zwsWrap.className = 'img-zws'; _zwsWrap.textContent = '\u200B';
    _checkPrev.replaceWith(_zwsWrap);
  }
  const _checkNext = wrap.nextSibling?.nextSibling;
  if (_checkNext && _checkNext.nodeType === 3 && _checkNext.textContent === '\u200B') {
    const _zwsWrap = document.createElement('span');
    _zwsWrap.className = 'img-zws'; _zwsWrap.textContent = '\u200B';
    _checkNext.replaceWith(_zwsWrap);
  }

  // Align preceding sibling chips to bottom (CSS ~ combinator only handles following siblings)
  let _prevSib=wrap.previousSibling;
  while(_prevSib){
    if(_prevSib.nodeType===1&&(_prevSib.classList?.contains('infochip')||_prevSib.classList?.contains('note-link-chip')||
       _prevSib.classList?.contains('note-hex-chip')||_prevSib.classList?.contains('note-profile-chip')||
       _prevSib.classList?.contains('chip-group'))){
      _prevSib.style.verticalAlign='bottom';_prevSib._imgAligned=true;
    }
    if(_prevSib.nodeType===1&&(_prevSib.tagName==='BR'||_prevSib.tagName==='DIV'||_prevSib.tagName==='P')) break;
    _prevSib=_prevSib.previousSibling;
  }

  // Wait for image to load before showing wrap — hide border until ready
  const img = wrap.querySelector('.infochip-img');
  wrap.style.borderColor='transparent';
  if (img && !img.complete) {
    img.onload = () => requestAnimationFrame(() => { wrap.classList.remove('img-anim-in'); wrap.style.borderColor=''; });
    setTimeout(() => { if(wrap.classList.contains('img-anim-in')) wrap.classList.remove('img-anim-in'); wrap.style.borderColor=''; }, 500);
  } else {
    requestAnimationFrame(() => { wrap.classList.remove('img-anim-in'); wrap.style.borderColor=''; });
  }
}
window._dexRebuildWrapContents = _rebuildWrapContents;

function _hideImagePreview(chip) {
  const wrap = chip.closest('.infochip-img-wrap');
  if (!wrap || !wrap.parentNode) return;
  const parent=wrap.parentNode;
  // Restore vertical-align on previously aligned siblings
  if(parent) parent.querySelectorAll('[style*="vertical-align"]').forEach(el=>{
    if(el._imgAligned){el.style.verticalAlign='';delete el._imgAligned;}
  });
  // Clean up img-zws spans around the wrap
  const prev=wrap.previousSibling;
  if(prev&&prev.classList?.contains('img-zws')) prev.remove();
  const next=wrap.nextSibling;
  parent.insertBefore(chip, wrap);
  chip.draggable = true; // restore native drag now that chip is outside wrap
  wrap.remove();
  if(next&&next.classList?.contains('img-zws')) next.remove();
  // Force editor to recalculate layout
  const ed=chip.closest('.note-ed');
  if(ed){ ed.style.minHeight=''; void ed.offsetHeight; }
}

function _updateChipTooltip(chip) {
  chip.removeAttribute('title');
  if (chip.dataset.icMinimized==='1') {
    chip.dataset.tip=chip.dataset.icTitle||'';
    chip.dataset.tipPos='below';
  } else {
    delete chip.dataset.tip;
    delete chip.dataset.tipPos;
  }
}

// ═══════════════════════════════════
//  >/ COMMAND DETECTION & PICKER
// ═══════════════════════════════════

const _CMD_TRIGGERS = [
  { key: 'link',     type: 'link',     label: 'Link',     color: '#378ADD' },
  { key: 'md',       type: 'markdown', label: 'Markdown', color: '#8bc34a' },
  { key: 'img',      type: 'image',    label: 'Image',    color: '#9F9AE8' },
  { key: 'time',     type: 'calendar', label: 'Time',     color: '#E8853A' },
  { key: 'audio',    type: 'audio',    label: 'Audio',    color: '#E8413A' },
  { key: 'play',     type: 'play',     label: 'Play',     color: '#4CAF50' },
  { key: 'home',     type: 'home',     label: 'Home',     color: '#FF9800' },
  { key: 'respawn',  type: 'respawn',  label: 'Respawn',  color: '#03A9F4' },
];

let _cmdPickerActive = false;
let _cmdActiveIdx = 0;
let _cmdItems = [];
let _cmdInfo = null; // { textNode, triggerIdx, offset, ed }
let _cmdLastQuery = '';

export function detectCommandTrigger(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3) return null;
  const offset = sel.anchorOffset;
  const text = node.textContent.slice(0, offset);
  const idx = text.lastIndexOf('>/');
  if (idx === -1) return null;
  // Must be at end of line (no spaces between >/ and cursor, only alphanumeric filter)
  const query = text.slice(idx + 2);
  if (!/^[a-zA-Z]{0,10}$/.test(query)) return null;
  return { query, triggerIdx: idx, textNode: node, offset, ed: el };
}

export function showCommandPicker(info) {
  const { query } = info;
  // Skip rebuild if picker is already showing the same query
  if (_cmdPickerActive && _cmdLastQuery === query) {
    _cmdInfo = info; // Update refs (textNode may have changed)
    return;
  }
  _cmdLastQuery = query;
  _cmdInfo = info;

  // Filter commands by query
  const q = query.toLowerCase();
  const matches = _CMD_TRIGGERS.filter(t => t.key.startsWith(q) || t.label.toLowerCase().startsWith(q));
  if (!matches.length) { closeCommandPicker(); return; }

  const picker = document.getElementById('ic-cmd-pick');
  if (!picker) return;

  // Check for exact match — auto-execute only infochip types (they open modals)
  const exactMatch = _CMD_TRIGGERS.find(t => t.key === q);
  if (exactMatch) {
    const autoTypes = ['link', 'markdown', 'image', 'calendar', 'audio', 'play', 'home', 'respawn'];
    if (autoTypes.includes(exactMatch.type)) {
      closeCommandPicker();
      _executeCommand(exactMatch.type, info);
      return;
    }
  }

  // Build items
  picker.innerHTML = '';
  _cmdItems = [];
  matches.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'ic-cmd-item' + (i === 0 ? ' active' : '');
    let dotHtml;
    if (m.type==='play') {
      dotHtml=`<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="#888" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>`;
    } else if (m.type==='home') {
      dotHtml=`<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    } else if (m.type==='respawn') {
      dotHtml=`<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    } else {
      dotHtml=`<span class="ic-cmd-dot" data-node="${m.type}"></span>`;
    }
    btn.innerHTML = `${dotHtml}${escapeHtml(m.label)}`;
    btn.addEventListener('click', () => {
      closeCommandPicker();
      _executeCommand(m.type, info);
    });
    picker.appendChild(btn);
    _cmdItems.push({ el: btn, type: m.type });
  });

  _cmdActiveIdx = 0;
  _cmdPickerActive = true;

  // Position at cursor
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const rect = r.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    // Show picker first to measure height, then position above/below
    picker.classList.add('open');
    const pickerH = picker.offsetHeight;
    if (rect.top > window.innerHeight / 2) {
      picker.style.top = (rect.top - pickerH - 4) + 'px';
    } else {
      picker.style.top = (rect.bottom + 4) + 'px';
    }
  } else {
    picker.classList.add('open');
  }
}

export function closeCommandPicker() {
  _cmdPickerActive = false;
  _cmdItems = [];
  _cmdInfo = null;
  _cmdLastQuery = '';
  document.getElementById('ic-cmd-pick')?.classList.remove('open');
}

// Play mode chat command picker bridges
window._dexOpenChatCommandPicker=function(query){
  const q=query.toLowerCase();
  const matches=_CMD_TRIGGERS.filter(t=>t.key.startsWith(q)||t.label.toLowerCase().startsWith(q));
  if(!matches.length){window._dexCloseChatCommandPicker?.();return;}
  const exactMatch=_CMD_TRIGGERS.find(t=>t.key===q);
  if(exactMatch){
    const autoTypes=['link','markdown','image','calendar','audio','play','home','respawn'];
    if(autoTypes.includes(exactMatch.type)){
      closeCommandPicker();
      window._dexExecuteChatCommand?.(exactMatch.type);
      return;
    }
  }
  // Dedup
  if(_cmdPickerActive&&_cmdLastQuery===query)return;
  _cmdLastQuery=query;
  const picker=document.getElementById('ic-cmd-pick');if(!picker)return;
  picker.innerHTML='';_cmdItems=[];
  matches.forEach((m,i)=>{
    const btn=document.createElement('button');
    btn.className='ic-cmd-item'+(i===0?' active':'');
    let dotHtml;
    if(m.type==='play') dotHtml='<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="#888" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>';
    else if(m.type==='home') dotHtml='<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
    else if(m.type==='respawn') dotHtml='<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
    else dotHtml='<span class="ic-cmd-dot" data-node="'+m.type+'"></span>';
    btn.innerHTML=dotHtml+m.label;
    btn.addEventListener('click',()=>{closeCommandPicker();window._dexExecuteChatCommand?.(m.type);});
    picker.appendChild(btn);
    _cmdItems.push({el:btn,type:m.type});
  });
  _cmdActiveIdx=0;_cmdPickerActive=true;
  const chatCursor=window._dexGetChatCursorPos?.();
  picker.classList.add('open');
  const pickH=picker.offsetHeight;
  if(chatCursor){picker.style.left=chatCursor.x+'px';picker.style.top=(chatCursor.y-pickH-4)+'px';}
};
window._dexCloseChatCommandPicker=function(){closeCommandPicker();};
window._dexHandleCmdPickerNav=function(e){
  if(!_cmdItems.length)return;
  _cmdItems[_cmdActiveIdx]?.el.classList.remove('active');
  if(e.key==='ArrowDown')_cmdActiveIdx=(_cmdActiveIdx+1)%_cmdItems.length;
  else _cmdActiveIdx=(_cmdActiveIdx-1+_cmdItems.length)%_cmdItems.length;
  _cmdItems[_cmdActiveIdx]?.el.classList.add('active');
};
window._dexGetActiveCmdItem=function(){return _cmdItems[_cmdActiveIdx]?.type||null;};

export function isCommandPickerOpen() { return _cmdPickerActive; }

export function handleCommandPickerKey(e) {
  if (!_cmdPickerActive || !_cmdItems.length) return false;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    _cmdItems[_cmdActiveIdx]?.el.classList.remove('active');
    if (e.key === 'ArrowDown') _cmdActiveIdx = (_cmdActiveIdx + 1) % _cmdItems.length;
    else _cmdActiveIdx = (_cmdActiveIdx - 1 + _cmdItems.length) % _cmdItems.length;
    _cmdItems[_cmdActiveIdx]?.el.classList.add('active');
    return true;
  }

  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const item = _cmdItems[_cmdActiveIdx];
    if (item && _cmdInfo) {
      const info = _cmdInfo; // Save before close nulls it
      closeCommandPicker();
      _executeCommand(item.type, info);
    }
    return true;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPicker();
    return true;
  }

  return false;
}

function _executeCommand(type, info) {
  const { textNode, triggerIdx, offset, ed } = info;
  if (!textNode || !textNode.parentNode) return;

  // Remove the >/xxx text from the DOM
  const before = textNode.textContent.slice(0, triggerIdx);
  const after = textNode.textContent.slice(offset);
  textNode.textContent = before + after;

  // Place cursor at the removal point
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(textNode, triggerIdx);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);

  // ── Action commands (no modal) ──
  if (type === 'play') {
    if (ed) ed.blur();
    setTimeout(() => { if (window._dexEnterPlayMode) window._dexEnterPlayMode(); }, 50);
    return;
  }
  if (type === 'home') { return; }
  if (type === 'respawn') {
    if (ed) ed.blur();
    if (window._dexAvatarDropIn) window._dexAvatarDropIn();
    return;
  }

  // ── InfoChip commands (open modal) ──
  _savedRange = r.cloneRange();
  _savedEditor = ed || null;
  if (ed) ed.focus({preventScroll:true});
  openInfoChipModal(type);
}

// ═══════════════════════════════════
//  EXPORT HELPERS
// ═══════════════════════════════════

export function convertChipsForExport(container) {
  // Convert infochips to text nodes before text extraction
  container.querySelectorAll('.infochip').forEach(chip => {
    const type = chip.dataset.icType;
    const title = chip.dataset.icTitle || '';
    const url = chip.dataset.icUrl || '';
    const text = _decodeText(chip.dataset.icText || '');
    let replacement = '';
    if (type === 'link') replacement = `[${title}](${url})`;
    else if (type === 'markdown') replacement = text;
    else if (type === 'image') replacement = `![${title}](${url})`;
    else if (type === 'file') replacement = `[File: ${title}]`;
    else if (type === 'calendar') { const dt = chip.dataset.icDate || ''; replacement = dt ? `[${title}: ${_formatDate(dt)}]` : `[${title}]`; }
    else if (type === 'audio') { replacement = `[${title}]`; }
    chip.replaceWith(document.createTextNode(replacement));
  });
}

// ═══════════════════════════════════
//  FILE PANEL
// ═══════════════════════════════════

let _fileChipTarget = null;
let _fileViewMode = 'grid'; // 'grid' | 'list'
let _fileScale = 2; // 0-4 → 50%, 75%, 100%, 125%, 150%
const _FILE_SCALE_LABELS = ['50%', '75%', '100%', '125%', '150%'];

const _FILE_TYPE_ICONS = {
  pdf: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e05c5c" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="12" y="17" text-anchor="middle" fill="#e05c5c" stroke="none" font-size="6" font-weight="bold">PDF</text></svg>',
  doc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#378ADD" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>',
  xls: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#34A853" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6" rx="1"/></svg>',
  zip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F4B400" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="10" y="12" width="4" height="5" rx="1"/></svg>',
  code: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  default: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7B8A9C" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
};

function _fileTypeIcon(name) {
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return _FILE_TYPE_ICONS.pdf;
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return _FILE_TYPE_ICONS.doc;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return _FILE_TYPE_ICONS.xls;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return _FILE_TYPE_ICONS.zip;
  if (['js', 'ts', 'py', 'html', 'css', 'json', 'xml', 'java', 'c', 'cpp', 'rb', 'go', 'rs', 'php', 'sh', 'sql'].includes(ext)) return _FILE_TYPE_ICONS.code;
  return _FILE_TYPE_ICONS.default;
}

function _formatFileSize(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function _getFileList(chip) {
  try { return JSON.parse(chip?.dataset?.icFiles || '[]'); } catch { return []; }
}

function _saveFileList(chip, files) {
  if (!chip) return;
  chip.dataset.icFiles = JSON.stringify(files);
  const labelEl = chip.querySelector('.infochip-label');
  if (labelEl) {
    const title = chip.dataset.icTitle || 'File';
    labelEl.textContent = files.length > 1 ? `${title} (${files.length})` : title;
  }
}

function _openFilePanel(chip) {
  _fileChipTarget = chip;
  const panel = document.getElementById('ic-file-panel');
  const backdrop = document.getElementById('ic-file-panel-backdrop');
  const titleEl = document.getElementById('ic-file-panel-title');
  if (!panel || !backdrop) return;
  titleEl.value = chip.dataset.icTitle || 'File';
  _renderFileList();
  _applyFileView();
  panel.classList.add('open');
  backdrop.classList.add('open');
}

export function closeFilePanel() {
  const panel = document.getElementById('ic-file-panel');
  const backdrop = document.getElementById('ic-file-panel-backdrop');
  if (_fileChipTarget) {
    const titleEl = document.getElementById('ic-file-panel-title');
    if (titleEl) {
      _fileChipTarget.dataset.icTitle = titleEl.value.trim() || 'File';
      const labelEl = _fileChipTarget.querySelector('.infochip-label');
      if (labelEl) {
        const files = _getFileList(_fileChipTarget);
        const title = _fileChipTarget.dataset.icTitle;
        labelEl.textContent = files.length > 1 ? `${title} (${files.length})` : title;
      }
      schedSave();
    }
  }
  panel?.classList.remove('open');
  backdrop?.classList.remove('open');
  _fileChipTarget = null;
}

function _applyFileView() {
  const list = document.getElementById('ic-file-list');
  if (!list) return;
  list.classList.toggle('grid-view', _fileViewMode === 'grid');
  list.classList.toggle('list-view', _fileViewMode === 'list');
  list.dataset.scale = _fileScale;
  document.getElementById('ic-file-grid-btn')?.classList.toggle('active', _fileViewMode === 'grid');
  document.getElementById('ic-file-list-btn')?.classList.toggle('active', _fileViewMode === 'list');
  const scaleLabel = document.getElementById('ic-file-scale-label');
  const scaleInput = document.getElementById('ic-file-scale');
  if (scaleLabel) scaleLabel.textContent = _FILE_SCALE_LABELS[_fileScale];
  if (scaleInput) scaleInput.value = _fileScale;
}

function _cloneLogoSvg(size) {
  const src = document.querySelector('#sb-logo svg');
  if (src) {
    const clone = src.cloneNode(true);
    clone.setAttribute('width', size);
    clone.setAttribute('height', size);
    clone.classList.add('ic-file-upload-logo');
    return clone.outerHTML;
  }
  // Fallback if logo not loaded yet
  return `<svg class="ic-file-upload-logo" width="${size}" height="${size}" viewBox="0 0 256 256"><circle cx="128" cy="128" r="60" stroke="var(--clr-adj)" stroke-width="6" fill="none"/></svg>`;
}

function _showFileUploadOverlay(count) {
  let overlay = document.getElementById('ic-file-upload-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ic-file-upload-overlay';
    const panel = document.getElementById('ic-file-panel');
    if (panel) panel.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="ic-file-upload-spinner">
    ${_cloneLogoSvg(40)}
    <div class="ic-file-upload-text">Uploading<span class="ic-file-upload-dots"></span></div>
    <div class="ic-file-upload-progress"><div class="ic-file-upload-bar"></div></div>
    <div class="ic-file-upload-count">0 / ${count}</div>
  </div>`;
  overlay.style.display = '';
}

function _updateFileUploadProgress(done, total) {
  const bar = document.querySelector('.ic-file-upload-bar');
  const countEl = document.querySelector('.ic-file-upload-count');
  if (bar) bar.style.width = `${(done / total) * 100}%`;
  if (countEl) countEl.textContent = `${done} / ${total}`;
}

function _hideFileUploadOverlay() {
  const overlay = document.getElementById('ic-file-upload-overlay');
  if (overlay) overlay.style.display = 'none';
}

let _selectedFileIds = new Set();
let _lastFileClickIdx = null;

function _showFileDeleteConfirm(names, onConfirm) {
  const existing = document.getElementById('ic-file-del-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'ic-file-del-modal';
  modal.innerHTML = `<div class="ic-file-del-box">
    <div class="ic-file-del-title">Delete ${names.length > 1 ? names.length + ' files' : 'file'}?</div>
    <div class="ic-file-del-names">${names.map(n => `<div class="ic-file-del-name">${escapeHtml(n)}</div>`).join('')}</div>
    <div class="ic-file-del-btns">
      <button class="ic-file-del-cancel">Cancel</button>
      <button class="ic-file-del-ok">Delete</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.ic-file-del-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('.ic-file-del-ok').addEventListener('click', () => { modal.remove(); onConfirm(); });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _isPreviewable(name) {
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  if (['png','jpg','jpeg','gif','webp','svg','bmp','ico','avif'].includes(ext)) return 'image';
  if (['txt','md','json','xml','html','css','js','ts','py','java','c','cpp','rb','go','rs','php','sh','sql','csv','log','yaml','yml','toml','ini','cfg','conf','env'].includes(ext)) return 'text';
  if (['pdf'].includes(ext)) return 'pdf';
  return null;
}

function _openFilePreview(file) {
  const existing = document.getElementById('ic-file-preview');
  if (existing) existing.remove();
  const type = _isPreviewable(file.name);
  if (!type || !file.url) return;

  const preview = document.createElement('div');
  preview.id = 'ic-file-preview';
  preview.innerHTML = `<div class="ic-file-preview-hdr">
    <span class="ic-file-preview-title">${escapeHtml(file.name)}</span>
    <button class="ic-file-preview-close">&times;</button>
  </div><div class="ic-file-preview-body"></div>`;
  const body = preview.querySelector('.ic-file-preview-body');
  preview.querySelector('.ic-file-preview-close').addEventListener('click', () => preview.remove());

  if (type === 'image') {
    const img = document.createElement('img');
    img.src = file.url;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;';
    body.appendChild(img);
  } else if (type === 'text') {
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;color:var(--tx);font-family:monospace;';
    pre.textContent = 'Loading…';
    body.appendChild(pre);
    fetch(file.url).then(r => r.text()).then(t => { pre.textContent = t; }).catch(() => { pre.textContent = 'Failed to load preview'; });
  } else if (type === 'pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = file.url;
    iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:6px;';
    body.appendChild(iframe);
  }

  // Attach to the right side of the file panel
  const panel = document.getElementById('ic-file-panel');
  if (panel) panel.appendChild(preview);
}

function _renderFileList() {
  const list = document.getElementById('ic-file-list');
  if (!list || !_fileChipTarget) return;
  const files = _getFileList(_fileChipTarget);
  list.innerHTML = '';
  // Close preview if open
  document.getElementById('ic-file-preview')?.remove();

  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'ic-file-empty';
    empty.textContent = 'No files yet — click Upload to add files';
    list.appendChild(empty);
    return;
  }

  // Insertion line for drag reorder
  const insertLine = document.createElement('div');
  insertLine.className = 'ic-file-insert-line';
  insertLine.style.display = 'none';
  list.appendChild(insertLine);

  let _dragIdx = null;

  files.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'ic-file-item';
    item.draggable = true;
    item.dataset.fileIdx = idx;
    if (_selectedFileIds.has(file.id)) item.classList.add('ic-file-selected');

    // Click: select with shift/ctrl
    item.addEventListener('click', e => {
      if (e.target.closest('.ic-file-act-btn') || e.target.closest('.ic-file-name-input')) return;
      if (e.shiftKey && _lastFileClickIdx !== null) {
        const lo = Math.min(_lastFileClickIdx, idx), hi = Math.max(_lastFileClickIdx, idx);
        for (let i = lo; i <= hi; i++) { if (files[i]) _selectedFileIds.add(files[i].id); }
      } else if (e.ctrlKey || e.metaKey) {
        if (_selectedFileIds.has(file.id)) _selectedFileIds.delete(file.id);
        else _selectedFileIds.add(file.id);
      } else {
        const was = _selectedFileIds.has(file.id);
        _selectedFileIds.clear();
        if (!was) _selectedFileIds.add(file.id);
      }
      _lastFileClickIdx = idx;
      list.querySelectorAll('.ic-file-item').forEach((it, i) => {
        it.classList.toggle('ic-file-selected', files[i] && _selectedFileIds.has(files[i].id));
      });
    });

    // Double-click: preview
    item.addEventListener('dblclick', e => {
      if (e.target.closest('.ic-file-name-input')) return;
      _openFilePreview(file);
    });

    // Drag reorder
    item.addEventListener('dragstart', e => {
      _dragIdx = idx;
      item.classList.add('ic-file-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    item.addEventListener('dragend', () => {
      _dragIdx = null;
      item.classList.remove('ic-file-dragging');
      insertLine.style.display = 'none';
    });
    item.addEventListener('dragover', e => {
      if (_dragIdx === null || _dragIdx === idx) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if (_fileViewMode === 'list') {
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        insertLine.style.display = '';
        if (e.clientY < mid) item.parentNode.insertBefore(insertLine, item);
        else item.parentNode.insertBefore(insertLine, item.nextSibling);
      } else {
        item.classList.add('ic-file-drop-target');
      }
    });
    item.addEventListener('dragleave', () => { item.classList.remove('ic-file-drop-target'); });
    item.addEventListener('drop', e => {
      e.preventDefault();
      insertLine.style.display = 'none';
      item.classList.remove('ic-file-drop-target');
      if (_dragIdx === null || _dragIdx === idx) return;
      const rect = item.getBoundingClientRect();
      const mid = _fileViewMode === 'list' ? (rect.top + rect.height / 2) : (rect.left + rect.width / 2);
      const pos = _fileViewMode === 'list' ? e.clientY : e.clientX;
      let targetIdx = idx;
      if (pos >= mid && _dragIdx < idx) targetIdx = idx;
      else if (pos < mid && _dragIdx > idx) targetIdx = idx;
      else if (pos >= mid) targetIdx = idx + 1;
      if (_dragIdx < targetIdx) targetIdx--;
      const f2 = _getFileList(_fileChipTarget);
      const [moved] = f2.splice(_dragIdx, 1);
      f2.splice(targetIdx, 0, moved);
      _saveFileList(_fileChipTarget, f2);
      _renderFileList();
      schedSave();
    });

    // Icon
    const icon = document.createElement('div');
    icon.className = 'ic-file-icon';
    icon.innerHTML = _fileTypeIcon(file.name);

    // Editable name
    const nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.className = 'ic-file-name-input';
    nameEl.value = file.name || 'Unnamed';
    nameEl.spellcheck = false;
    nameEl.dataset.tip = file.name || '';
    nameEl.addEventListener('change', () => {
      const f2 = _getFileList(_fileChipTarget);
      if (f2[idx]) { f2[idx].name = nameEl.value.trim() || 'Unnamed'; _saveFileList(_fileChipTarget, f2); schedSave(); }
    });
    nameEl.addEventListener('click', e => e.stopPropagation());
    nameEl.addEventListener('dblclick', e => e.stopPropagation());
    nameEl.addEventListener('dragstart', e => e.stopPropagation());

    // Actions row: download left, trash right
    const actions = document.createElement('div');
    actions.className = 'ic-file-actions';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'ic-file-act-btn';
    dlBtn.dataset.tip = 'Download';
    dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    dlBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!file.url) return;
      const a = document.createElement('a');
      a.href = file.url; a.download = file.name || 'file'; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'ic-file-act-btn del';
    delBtn.dataset.tip = 'Delete';
    delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      // Determine files to delete: selected or just this one
      const filesToDel = _selectedFileIds.size > 0 && _selectedFileIds.has(file.id)
        ? files.filter(f => _selectedFileIds.has(f.id))
        : [file];
      _showFileDeleteConfirm(filesToDel.map(f => f.name), () => {
        const delIds = new Set(filesToDel.map(f => f.id));
        const f2 = _getFileList(_fileChipTarget).filter(f => !delIds.has(f.id));
        _saveFileList(_fileChipTarget, f2);
        filesToDel.forEach(f => { if (f.path && _deps.deleteFile) _deps.deleteFile(f.path).catch(() => {}); });
        _selectedFileIds.clear();
        _renderFileList();
        schedSave();
      });
    });

    actions.append(dlBtn, delBtn);
    item.append(icon, nameEl, actions);
    list.appendChild(item);
  });
}

export function initFilePanel() {
  const backdrop = document.getElementById('ic-file-panel-backdrop');
  backdrop?.addEventListener('click', closeFilePanel);
  document.getElementById('ic-file-panel-close')?.addEventListener('click', closeFilePanel);

  // View toggle
  document.getElementById('ic-file-grid-btn')?.addEventListener('click', () => { _fileViewMode = 'grid'; _applyFileView(); });
  document.getElementById('ic-file-list-btn')?.addEventListener('click', () => { _fileViewMode = 'list'; _applyFileView(); });

  // Scale slider
  const scaleInput = document.getElementById('ic-file-scale');
  scaleInput?.addEventListener('input', () => {
    _fileScale = parseInt(scaleInput.value);
    _applyFileView();
  });

  // Upload button
  const uploadBtn = document.getElementById('ic-file-upload-btn');
  const fileInput = document.getElementById('ic-file-input');
  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    if (!fileInput.files?.length || !_fileChipTarget) return;
    const count = fileInput.files.length;
    _showFileUploadOverlay(count);
    const existingFiles = _getFileList(_fileChipTarget);
    let done = 0;
    for (const f of fileInput.files) {
      try {
        let result = null;
        if (_deps.uploadFile) result = await _deps.uploadFile(f);
        if (result) {
          existingFiles.push({ id: Date.now().toString(), name: result.name || f.name, url: result.url, path: result.path, size: result.size || f.size, type: result.type || f.type });
        } else {
          const url = URL.createObjectURL(f);
          existingFiles.push({ id: Date.now().toString(), name: f.name, url, path: '', size: f.size, type: f.type });
        }
        done++;
        _updateFileUploadProgress(done, count);
      } catch (err) { toast(err.message || 'Upload failed'); done++; }
    }
    _hideFileUploadOverlay();
    _saveFileList(_fileChipTarget, existingFiles);
    _renderFileList();
    schedSave();
    fileInput.value = '';
  });

  // Title rename
  const titleEl = document.getElementById('ic-file-panel-title');
  titleEl?.addEventListener('change', () => {
    if (!_fileChipTarget) return;
    _fileChipTarget.dataset.icTitle = titleEl.value.trim() || 'File';
    const labelEl = _fileChipTarget.querySelector('.infochip-label');
    if (labelEl) {
      const files = _getFileList(_fileChipTarget);
      const title = _fileChipTarget.dataset.icTitle;
      labelEl.textContent = files.length > 1 ? `${title} (${files.length})` : title;
    }
    schedSave();
  });
}

// ═══════════════════════════════════
//  AUDIO PANEL
// ═══════════════════════════════════

let _audioChipTarget = null;
let _audioCurrentAudio = null;
let _audioMediaRecorder = null;
let _audioRecordChunks = [];
let _audioRecordTimer = null;
let _audioRecordSeconds = 0;
let _audioDownloadFmt = 'mp3';
const _selectedTrackIds = new Set();
let _lastTrackClickIdx = null;

function _openAudioPanel(chip) {
  _audioChipTarget = chip;
  _selectedTrackIds.clear();
  _lastTrackClickIdx = null;
  const panel = document.getElementById('ic-audio-panel');
  const backdrop = document.getElementById('ic-audio-panel-backdrop');
  const titleEl = document.getElementById('ic-audio-panel-title');
  if (!panel || !backdrop) return;
  // Make title editable
  titleEl.contentEditable = 'true';
  titleEl.spellcheck = false;
  titleEl.textContent = chip.dataset.icTitle || 'Audio';
  titleEl.onblur = () => {
    const v = titleEl.textContent.trim() || 'Audio';
    chip.dataset.icTitle = v;
    const labelEl = chip.querySelector('.infochip-label');
    if (labelEl) { const tracks = _getAudioTracks(chip); labelEl.textContent = tracks.length > 1 ? `${v} (${tracks.length})` : v; }
    schedSave();
  };
  titleEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } };
  _renderAudioTrackList();
  panel.classList.add('open');
  backdrop.classList.add('open');
}

export function closeAudioPanel() {
  const panel = document.getElementById('ic-audio-panel');
  const backdrop = document.getElementById('ic-audio-panel-backdrop');
  panel?.classList.remove('open');
  backdrop?.classList.remove('open');
  if (_audioCurrentAudio) { _audioCurrentAudio.pause(); _audioCurrentAudio = null; }
  if (_audioMediaRecorder && _audioMediaRecorder.state !== 'inactive') _audioMediaRecorder.stop();
  _stopRecordTimer();
  if (_audioChipTarget) schedSave();
  _audioChipTarget = null;
}

function _getAudioTracks(chip) {
  try { return JSON.parse(chip?.dataset?.icTracks || '[]'); } catch { return []; }
}

function _saveAudioTracks(chip, tracks) {
  if (!chip) return;
  chip.dataset.icTracks = JSON.stringify(tracks);
  const labelEl = chip.querySelector('.infochip-label');
  if (labelEl) {
    const title = chip.dataset.icTitle || 'Audio';
    labelEl.textContent = tracks.length > 1 ? `${title} (${tracks.length})` : title;
  }
}

function _renderAudioTrackList() {
  const list = document.getElementById('ic-audio-track-list');
  if (!list || !_audioChipTarget) return;
  const tracks = _getAudioTracks(_audioChipTarget);
  list.innerHTML = '';
  if (!tracks.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px 18px;font-size:12px;color:var(--tx3);text-align:center;font-family:var(--fn);';
    empty.textContent = 'No audio yet — record or upload below';
    list.appendChild(empty);
    return;
  }

  // Insertion line indicator
  const insertLine = document.createElement('div');
  insertLine.className = 'ic-audio-insert-line';
  insertLine.style.display = 'none';
  list.appendChild(insertLine);

  let _dragIdx = null;
  tracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = 'ic-audio-track';
    row.draggable = true;
    row.dataset.trackIdx = idx;

    // Multi-select checkbox with shift/ctrl support
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ic-audio-track-cb';
    cb.checked = _selectedTrackIds.has(track.id);
    cb.addEventListener('click', e => {
      e.stopPropagation();
      if (e.shiftKey && _lastTrackClickIdx !== null) {
        // Shift-click: select range
        const lo = Math.min(_lastTrackClickIdx, idx), hi = Math.max(_lastTrackClickIdx, idx);
        for (let i = lo; i <= hi; i++) { if (tracks[i]) _selectedTrackIds.add(tracks[i].id); }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd-click: toggle single
        if (_selectedTrackIds.has(track.id)) _selectedTrackIds.delete(track.id);
        else _selectedTrackIds.add(track.id);
      } else {
        // Plain click: toggle single, clear others
        const wasSelected = _selectedTrackIds.has(track.id);
        _selectedTrackIds.clear();
        if (!wasSelected) _selectedTrackIds.add(track.id);
      }
      _lastTrackClickIdx = idx;
      // Update all checkboxes
      list.querySelectorAll('.ic-audio-track').forEach((r, i) => {
        const c = r.querySelector('.ic-audio-track-cb');
        if (c) {
          c.checked = tracks[i] && _selectedTrackIds.has(tracks[i].id);
          c.style.opacity = _selectedTrackIds.size > 0 ? '1' : '';
        }
        r.classList.toggle('ic-audio-track-selected', tracks[i] && _selectedTrackIds.has(tracks[i].id));
      });
    });
    cb.addEventListener('dragstart', e => e.stopPropagation());
    if (_selectedTrackIds.has(track.id)) row.classList.add('ic-audio-track-selected');

    // Drag: reorder within panel OR drag out to create new chip
    row.addEventListener('dragstart', e => {
      _dragIdx = idx;
      row.classList.add('ic-audio-dragging');
      e.dataTransfer.effectAllowed = 'copyMove';
      // Package tracks for drag-out
      const allTracks = _getAudioTracks(_audioChipTarget);
      const dragTracks = _selectedTrackIds.size > 0
        ? allTracks.filter(t => _selectedTrackIds.has(t.id))
        : [track];
      e.dataTransfer.setData('application/dexnote-audio-tracks', JSON.stringify(dragTracks));
      // Ghost pill
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;background:#E8413A22;border:1.5px solid #E8413A;border-radius:999px;padding:4px 10px;font-size:12px;color:#E8413A;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:var(--fn);';
      ghost.textContent = dragTracks.length > 1 ? `${dragTracks.length} tracks` : (dragTracks[0]?.name || 'Audio');
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
      requestAnimationFrame(() => ghost.remove());
      // Hide panel + backdrop completely so canvas is droppable
      requestAnimationFrame(() => {
        const panel = document.getElementById('ic-audio-panel');
        const backdrop = document.getElementById('ic-audio-panel-backdrop');
        if (backdrop) backdrop.style.display = 'none';
        if (panel) { panel.style.opacity = '0.35'; panel.style.pointerEvents = 'none'; panel.style.zIndex = '1'; }
      });
    });
    row.addEventListener('dragend', e => {
      _dragIdx = null;
      row.classList.remove('ic-audio-dragging');
      insertLine.style.display = 'none';
      const panel = document.getElementById('ic-audio-panel');
      const backdrop = document.getElementById('ic-audio-panel-backdrop');
      // Check if dropped outside the panel (on the canvas) → close panel
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const droppedOnPanel = els.some(el => el.closest('#ic-audio-panel'));
      if (!droppedOnPanel && e.clientX > 0 && e.clientY > 0) {
        // Dropped outside — close panel
        if (panel) { panel.style.opacity = ''; panel.style.pointerEvents = ''; panel.style.zIndex = ''; }
        if (backdrop) backdrop.style.display = '';
        closeAudioPanel();
      } else {
        // Dropped back on panel or cancelled — restore
        if (panel) { panel.style.opacity = ''; panel.style.pointerEvents = ''; panel.style.zIndex = ''; }
        if (backdrop) { backdrop.style.display = ''; }
      }
    });
    row.addEventListener('dragover', e => {
      // Re-show panel when dragging back over it
      const panel = document.getElementById('ic-audio-panel');
      const backdrop = document.getElementById('ic-audio-panel-backdrop');
      if (panel?.style.opacity === '0.35') {
        panel.style.opacity = ''; panel.style.pointerEvents = ''; panel.style.zIndex = '';
        if (backdrop) backdrop.style.display = '';
      }
      if (_dragIdx === null || _dragIdx === idx) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      insertLine.style.display = '';
      if (e.clientY < mid) row.parentNode.insertBefore(insertLine, row);
      else row.parentNode.insertBefore(insertLine, row.nextSibling);
    });
    row.addEventListener('dragleave', () => {});
    row.addEventListener('drop', e => {
      e.preventDefault();
      insertLine.style.display = 'none';
      if (_dragIdx === null || _dragIdx === idx) return;
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let targetIdx = idx;
      if (e.clientY >= mid && _dragIdx < idx) targetIdx = idx;
      else if (e.clientY < mid && _dragIdx > idx) targetIdx = idx;
      else if (e.clientY >= mid) targetIdx = idx + 1;
      if (_dragIdx < targetIdx) targetIdx--;
      const t2 = _getAudioTracks(_audioChipTarget);
      const [moved] = t2.splice(_dragIdx, 1);
      t2.splice(targetIdx, 0, moved);
      _saveAudioTracks(_audioChipTarget, t2);
      _renderAudioTrackList();
      schedSave();
    });

    // Play/pause
    const playBtn = document.createElement('button');
    playBtn.className = 'ic-audio-play-btn';
    playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="white"/></svg>';
    playBtn.addEventListener('click', e => { e.stopPropagation(); _toggleAudioTrack(track, playBtn); });

    // Editable name
    const name = document.createElement('input');
    name.className = 'ic-audio-track-name';
    name.type = 'text';
    name.value = track.name || `Recording ${idx + 1}`;
    name.spellcheck = false;
    name.addEventListener('change', () => {
      const t2 = _getAudioTracks(_audioChipTarget);
      if (t2[idx]) { t2[idx].name = name.value.trim() || `Recording ${idx + 1}`; _saveAudioTracks(_audioChipTarget, t2); schedSave(); }
    });
    name.addEventListener('click', e => e.stopPropagation());
    name.addEventListener('dragstart', e => e.stopPropagation());

    // Duration
    const dur = document.createElement('div');
    dur.className = 'ic-audio-track-dur';
    dur.textContent = track.duration ? _fmtDur(track.duration) : '--:--';

    // Delete
    const delBtn = document.createElement('button');
    delBtn.className = 'ic-audio-del-btn';
    delBtn.dataset.tip = 'Delete';
    delBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      const t2 = _getAudioTracks(_audioChipTarget);
      t2.splice(idx, 1);
      _saveAudioTracks(_audioChipTarget, t2);
      _renderAudioTrackList();
      schedSave();
    });

    // Download
    const dlBtn = document.createElement('button');
    dlBtn.className = 'ic-audio-dl-btn';
    dlBtn.dataset.tip = 'Download';
    dlBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    dlBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!track.url) return;
      const baseName = (track.name || 'audio').replace(/\.[^.]+$/, '');
      const a = document.createElement('a');
      a.href = track.url;
      a.download = `${baseName}.${_audioDownloadFmt}`;
      document.body.appendChild(a); a.click(); a.remove();
    });

    // Transcript button
    const txBtn = document.createElement('button');
    txBtn.className = 'ic-audio-tx-btn';
    txBtn.dataset.tip = 'Transcript';
    txBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    txBtn.addEventListener('click', e => {
      e.stopPropagation();
      // Toggle transcript panel below this row
      const existing = row.nextElementSibling;
      if (existing?.classList.contains('ic-audio-tx-panel')) {
        existing.remove();
        return;
      }
      _showTranscriptPanel(track, idx, row);
    });

    row.append(cb, playBtn, name, dur, txBtn, dlBtn, delBtn);
    list.appendChild(row);
  });
}

function _showTranscriptPanel(track, idx, row) {
  // Remove any existing transcript panels
  document.querySelectorAll('.ic-audio-tx-panel').forEach(p => p.remove());

  const panel = document.createElement('div');
  panel.className = 'ic-audio-tx-panel';

  // Transcript text area
  const ta = document.createElement('textarea');
  ta.className = 'ic-audio-tx-text';
  ta.placeholder = 'Transcript text — type manually or click Transcribe to auto-generate';
  ta.value = track.transcript || '';
  ta.spellcheck = true;
  ta.addEventListener('input', () => {
    const tracks = _getAudioTracks(_audioChipTarget);
    if (tracks[idx]) { tracks[idx].transcript = ta.value; _saveAudioTracks(_audioChipTarget, tracks); schedSave(); }
  });
  ta.addEventListener('click', e => e.stopPropagation());
  ta.addEventListener('dragstart', e => e.stopPropagation());

  // Button bar
  const bar = document.createElement('div');
  bar.className = 'ic-audio-tx-bar';

  // Auto-transcribe button (uses Web Speech API while playing audio)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const txAutoBtn = document.createElement('button');
    txAutoBtn.className = 'ic-audio-tx-auto-btn';
    txAutoBtn.textContent = 'Transcribe';
    txAutoBtn.dataset.tip = 'Auto-transcribe using speech recognition (plays audio through speakers)';
    let _txRecog = null;
    txAutoBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (_txRecog) { _txRecog.stop(); _txRecog = null; txAutoBtn.textContent = 'Transcribe'; return; }
      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = 'en-US';
      _txRecog = recog;
      let finalText = ta.value ? ta.value + '\n' : '';
      txAutoBtn.textContent = 'Stop';
      txAutoBtn.classList.add('ic-audio-tx-active');
      recog.onresult = ev => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript + ' ';
          else interim += ev.results[i][0].transcript;
        }
        ta.value = finalText + interim;
      };
      recog.onerror = () => { txAutoBtn.textContent = 'Transcribe'; txAutoBtn.classList.remove('ic-audio-tx-active'); _txRecog = null; };
      recog.onend = () => {
        txAutoBtn.textContent = 'Transcribe'; txAutoBtn.classList.remove('ic-audio-tx-active'); _txRecog = null;
        ta.value = finalText.trim();
        const tracks = _getAudioTracks(_audioChipTarget);
        if (tracks[idx]) { tracks[idx].transcript = ta.value; _saveAudioTracks(_audioChipTarget, tracks); schedSave(); }
      };
      recog.start();
      // Also play the audio so mic picks it up
      if (track.url) {
        const audio = new Audio(track.url);
        audio.play();
        audio.onended = () => { if (_txRecog) _txRecog.stop(); };
      }
    });
    bar.appendChild(txAutoBtn);
  }

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'ic-audio-tx-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(ta.value).then(() => { const _orig = copyBtn.textContent; copyBtn.textContent = '\u2713'; setTimeout(() => { copyBtn.textContent = _orig; }, 2000); });
  });
  bar.appendChild(copyBtn);

  // Download .txt button
  const dlTxtBtn = document.createElement('button');
  dlTxtBtn.className = 'ic-audio-tx-dl-btn';
  dlTxtBtn.textContent = '.txt';
  dlTxtBtn.dataset.tip = 'Download transcript as .txt';
  dlTxtBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!ta.value.trim()) return;
    const blob = new Blob([ta.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(track.name || 'audio').replace(/\.[^.]+$/, '')}_transcript.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });
  bar.appendChild(dlTxtBtn);

  panel.append(ta, bar);
  row.after(panel);
  ta.focus();
}

function _toggleAudioTrack(track, btn) {
  if (_audioCurrentAudio) {
    _audioCurrentAudio.pause();
    document.querySelectorAll('.ic-audio-play-btn.playing').forEach(b => {
      b.classList.remove('playing');
      b.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="white"/></svg>';
    });
    if (_audioCurrentAudio._trackUrl === track.url) { _audioCurrentAudio = null; return; }
  }
  const audio = new Audio(track.url);
  audio._trackUrl = track.url;
  _audioCurrentAudio = audio;
  btn.classList.add('playing');
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/></svg>';
  audio.play();
  audio.onended = () => {
    btn.classList.remove('playing');
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="white"/></svg>';
    _audioCurrentAudio = null;
  };
}

function _fmtDur(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function _stopRecordTimer() {
  clearInterval(_audioRecordTimer);
  _audioRecordTimer = null;
  _audioRecordSeconds = 0;
  const timer = document.getElementById('ic-audio-record-timer');
  if (timer) { timer.textContent = '0:00'; timer.style.display = 'none'; }
  const stop = document.getElementById('ic-audio-record-stop');
  if (stop) stop.style.display = 'none';
}

export function initAudioPanel() {
  document.getElementById('ic-audio-panel-backdrop')?.addEventListener('click', closeAudioPanel);
  document.getElementById('ic-audio-panel-close')?.addEventListener('click', closeAudioPanel);
  // Format bar — select download format
  document.querySelectorAll('.ic-audio-fmt-opt').forEach(btn => {
    if (btn.dataset.fmt === _audioDownloadFmt) btn.classList.add('active');
    btn.addEventListener('click', () => {
      _audioDownloadFmt = btn.dataset.fmt;
      document.querySelectorAll('.ic-audio-fmt-opt').forEach(b => b.classList.toggle('active', b.dataset.fmt === _audioDownloadFmt));
    });
  });
  const recordBtn = document.getElementById('ic-audio-record-btn');
  const timerEl = document.getElementById('ic-audio-record-timer');
  const uploadBtn = document.getElementById('ic-audio-upload-btn');
  const uploadInput = document.getElementById('ic-audio-file-input');

  // Record toggle: click to start, click again to stop
  recordBtn?.addEventListener('click', async () => {
    if (_audioMediaRecorder && _audioMediaRecorder.state === 'recording') {
      // Stop recording
      _audioMediaRecorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { toast('Microphone not supported'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _audioRecordChunks = [];
      _audioMediaRecorder = new MediaRecorder(stream);
      _audioMediaRecorder.ondataavailable = e => { if (e.data.size > 0) _audioRecordChunks.push(e.data); };
      _audioMediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(_audioRecordChunks, { type: 'audio/webm' });
        const dur = _audioRecordSeconds;
        _stopRecordTimer();
        recordBtn.classList.remove('recording');
        const labelEl = document.getElementById('ic-audio-record-label');
        if (labelEl) labelEl.textContent = 'Record';
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result;
          if (_audioChipTarget) {
            const tracks = _getAudioTracks(_audioChipTarget);
            tracks.push({ id: Date.now().toString(), name: `Voice note ${tracks.length + 1}`, url, path: '', duration: dur });
            _saveAudioTracks(_audioChipTarget, tracks);
            _renderAudioTrackList();
            schedSave();
          }
        };
        reader.readAsDataURL(blob);
      };
      _audioMediaRecorder.start();
      recordBtn.classList.add('recording');
      const labelEl = document.getElementById('ic-audio-record-label');
      if (labelEl) labelEl.textContent = 'Stop';
      if (timerEl) timerEl.style.display = '';
      _audioRecordSeconds = 0;
      _audioRecordTimer = setInterval(() => {
        _audioRecordSeconds++;
        if (timerEl) timerEl.textContent = _fmtDur(_audioRecordSeconds);
      }, 1000);
    } catch { toast('Microphone access denied'); }
  });

  // Upload button
  uploadBtn?.addEventListener('click', () => uploadInput?.click());
  uploadInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file || !_audioChipTarget) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const tracks = _getAudioTracks(_audioChipTarget);
      tracks.push({ id: Date.now().toString(), name: file.name, url, path: '', duration: 0 });
      _saveAudioTracks(_audioChipTarget, tracks);
      _renderAudioTrackList();
      schedSave();
    };
    reader.readAsDataURL(file);
    uploadInput.value = '';
  });
}

// MD#22: Re-query all profile-node-bio elements in the active editor and
// refresh their text. Called when bio is saved.
export function _renderProfileNodeBio() {
  document.querySelectorAll('.profile-node-bio').forEach(el => {
    const bio = (window._dexGetBio && window._dexGetBio()) || '';
    if (bio.trim()) {
      el.textContent = bio;
      el.style.display = '';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  });
}
window._dexRenderProfileNodeBio = _renderProfileNodeBio;
