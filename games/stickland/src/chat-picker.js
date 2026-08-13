// ══════════════════════════════════════════════════════
//  Chat pickers — "/" commands and ":" emoji autocomplete
// ══════════════════════════════════════════════════════
//  Ported out of the notes app: the command picker from its infochip module,
//  the emoji autocomplete from its emoji module. Both were reachable from
//  play-mode chat through window._dex* bridges, and playmode.js still calls
//  every one of those bridges (all guarded with `if (window._dex…)`), so this
//  file just supplies the other half.
//
//  What changed in the port:
//    - The note-editor insertion path is gone. Emoji go into the chat input
//      via window._dexInsertChatEmoji (playmode.js:4612); there is no
//      contenteditable to write into and no undo stack to snapshot.
//    - The emoji dataset is imported from emoji-data.js instead of being
//      fetched from a CDN, so the game makes no network requests.
//    - The command list is filtered to the commands play mode actually
//      implements — see COMMANDS below.

import { EMOJI_DATA } from './emoji-data.js';
import { safeStorage } from './storage.js';

// ══════════════════════════════════════════════════════
//  "/" COMMAND PICKER
// ══════════════════════════════════════════════════════
//  Triggered by playmode.js's _checkChatCommand() on the ">/" prefix, which
//  passes the text typed after it.
//
//  The original list carried eight triggers, five of which created notes-app
//  infochips (link / markdown / image / calendar / audio). Play mode's
//  _dexExecuteChatCommand (playmode.js:4579) only ever handled 'home',
//  'respawn' and 'play', so the other five silently did nothing and are
//  dropped. 'home' exits play mode, which standalone means leaving the game
//  with nowhere to go, so it is dropped too — leaving the two that work.

const COMMANDS = [
  { key: 'respawn', type: 'respawn', label: 'Respawn' },
  { key: 'play',    type: 'play',    label: 'Play'    },
];

// Commands that fire immediately on an exact-name match rather than waiting
// for the user to pick from the list.
const AUTO_EXEC = ['play', 'respawn'];

const CMD_ICONS = {
  play:    '<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>',
  respawn: '<svg class="ic-cmd-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
};

let _cmdItems = [];
let _cmdActiveIdx = 0;
let _cmdPickerActive = false;
let _cmdLastQuery = '';

function _closeCommandPicker() {
  _cmdPickerActive = false;
  _cmdItems = [];
  _cmdLastQuery = '';
  document.getElementById('ic-cmd-pick')?.classList.remove('open');
}

window._dexOpenChatCommandPicker = function (query) {
  const q = String(query || '').toLowerCase();
  const matches = COMMANDS.filter(t => t.key.startsWith(q) || t.label.toLowerCase().startsWith(q));
  if (!matches.length) { _closeCommandPicker(); return; }

  // Exact match on an auto-exec command runs it straight away.
  const exact = COMMANDS.find(t => t.key === q);
  if (exact && AUTO_EXEC.includes(exact.type)) {
    _closeCommandPicker();
    window._dexExecuteChatCommand?.(exact.type);
    return;
  }

  // Same query as last frame — leave the open picker alone so the user's
  // arrow-key selection isn't reset on every keystroke.
  if (_cmdPickerActive && _cmdLastQuery === query) return;
  _cmdLastQuery = query;

  const picker = document.getElementById('ic-cmd-pick');
  if (!picker) return;
  picker.innerHTML = '';
  _cmdItems = [];

  matches.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ic-cmd-item' + (i === 0 ? ' active' : '');
    btn.innerHTML = (CMD_ICONS[m.type] || '<span class="ic-cmd-dot"></span>') + m.label;
    // mousedown would steal focus from the chat input before the click lands
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      _closeCommandPicker();
      window._dexExecuteChatCommand?.(m.type);
    });
    picker.appendChild(btn);
    _cmdItems.push({ el: btn, type: m.type });
  });

  _cmdActiveIdx = 0;
  _cmdPickerActive = true;

  // Anchor above the chat caret. playmode.js reports it in screen coords.
  picker.classList.add('open');
  const pickH = picker.offsetHeight;
  const cursor = window._dexGetChatCursorPos?.();
  if (cursor) {
    picker.style.left = cursor.x + 'px';
    picker.style.top = (cursor.y - pickH - 4) + 'px';
  } else {
    picker.style.left = '60px';
    picker.style.top = (window.innerHeight - 200) + 'px';
  }
};

window._dexCloseChatCommandPicker = function () { _closeCommandPicker(); };

window._dexHandleCmdPickerNav = function (e) {
  if (!_cmdItems.length) return;
  _cmdItems[_cmdActiveIdx]?.el.classList.remove('active');
  if (e.key === 'ArrowDown') _cmdActiveIdx = (_cmdActiveIdx + 1) % _cmdItems.length;
  else _cmdActiveIdx = (_cmdActiveIdx - 1 + _cmdItems.length) % _cmdItems.length;
  _cmdItems[_cmdActiveIdx]?.el.classList.add('active');
};

window._dexGetActiveCmdItem = function () { return _cmdItems[_cmdActiveIdx]?.type || null; };

// ══════════════════════════════════════════════════════
//  ":" EMOJI AUTOCOMPLETE
// ══════════════════════════════════════════════════════

const EMOJI_FREQ_KEY = 'dexnotes_emoji_freq';   // key kept from the original
const DEFAULT_EMOJIS = ['😂', '❤️', '👍', '😊', '🔥', '😍', '🎉', '✨', '🙏'];

let _emojiFreq = {};
let _emojiActiveCell = -1;
let _chatEmojiMode = false;

// Label lookup for the default/frequent rows.
const _byUnicode = new Map(EMOJI_DATA.map(e => [e.u, e]));

function _loadEmojiFreq() {
  try {
    const raw = safeStorage.getItem(EMOJI_FREQ_KEY);
    if (raw) _emojiFreq = JSON.parse(raw) || {};
  } catch (e) { _emojiFreq = {}; }
}
function _saveEmojiFreq() {
  try { safeStorage.setItem(EMOJI_FREQ_KEY, JSON.stringify(_emojiFreq)); } catch (e) {}
}
function _bumpEmojiFreq(emoji) {
  if (!emoji) return;
  _emojiFreq[emoji] = (_emojiFreq[emoji] || 0) + 1;
  _saveEmojiFreq();
}
function _topFreqEmojis(n) {
  return Object.entries(_emojiFreq).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}
_loadEmojiFreq();

// Scoring preserved from the original: exact label beats whole-word match
// beats prefix beats substring beats tag. Ties break on shorter label, then
// on emojibase order so the common emoji surfaces first.
function _searchEmojis(query, limit) {
  if (!query) return [];
  const q = query.toLowerCase();
  const scored = [];
  for (const e of EMOJI_DATA) {
    const label = e.l;
    let score = 0;
    if (label === q) score = 5;
    else if (label.split(' ').some(w => w === q)) score = 4.5;
    else if (label.startsWith(q)) score = 4;
    else if (label.split(' ').some(w => w.startsWith(q))) score = 3;
    else if (label.includes(q)) score = 2;
    else if (e.t && e.t.some(t => t.startsWith(q))) score = 1;
    if (score > 0) scored.push({ unicode: e.u, label, score, len: label.length, order: e.o });
  }
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.order - b.order);
  return scored.slice(0, limit);
}

function _closeEmojiPicker() {
  const pick = document.getElementById('emoji-pick');
  if (pick) pick.classList.remove('open');
  _emojiActiveCell = -1;
}

function _renderEmojiPicker(results, freqEmojis) {
  const pick = document.getElementById('emoji-pick');
  if (!pick) return;

  const grid = document.createElement('div');
  grid.className = 'emoji-grid';

  // Top rows: search results, or the defaults before anything is typed.
  const pool = results.length > 0
    ? results
    : DEFAULT_EMOJIS.map(u => ({ unicode: u, label: _byUnicode.get(u)?.l || '' }));
  const mainItems = pool.slice(0, 6);

  mainItems.forEach(r => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-cell';
    btn.textContent = r.unicode;
    btn.dataset.emoji = r.unicode;
    btn.title = r.label || r.unicode;
    grid.appendChild(btn);
  });

  // Separator + three most-used slots, each removable with its little x.
  const freq = freqEmojis.slice(0, 3);
  const sep = document.createElement('div');
  sep.className = 'emoji-freq-sep';
  grid.appendChild(sep);

  for (let i = 0; i < 3; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (i < freq.length) {
      const em = freq[i];
      btn.className = 'emoji-cell emoji-freq-cell';
      btn.dataset.emoji = em;
      btn.textContent = em;
      btn.title = _byUnicode.get(em)?.l || em;
      const x = document.createElement('span');
      x.className = 'emoji-freq-x';
      x.innerHTML = '&times;';
      x.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
      x.addEventListener('click', e => {
        e.stopPropagation();
        delete _emojiFreq[em];
        _saveEmojiFreq();
        _renderEmojiPicker(results, _topFreqEmojis(3));
      });
      btn.appendChild(x);
    } else {
      btn.className = 'emoji-cell emoji-freq-cell emoji-freq-empty';
      btn.disabled = true;
    }
    grid.appendChild(btn);
  }

  pick.innerHTML = '';
  pick.appendChild(grid);

  // Click to insert. mousedown is suppressed so the chat input keeps focus.
  grid.querySelectorAll('.emoji-cell').forEach(cell => {
    cell.addEventListener('mousedown', e => e.preventDefault());
    cell.addEventListener('click', e => {
      if (e.target.classList.contains('emoji-freq-x')) return;
      const emoji = cell.dataset.emoji;
      if (emoji) window._dexInsertChatEmoji?.(emoji);
    });
  });

  // With no query, pre-select the first most-used rather than a default.
  const cells = grid.querySelectorAll('.emoji-cell');
  _emojiActiveCell = (results.length === 0 && freq.length > 0) ? mainItems.length : 0;
  cells[_emojiActiveCell]?.classList.add('active');
}

window._dexOpenChatEmoji = function (query, colonIdx) {
  _chatEmojiMode = true;
  const freq = _topFreqEmojis(3);
  const results = query.length > 0 ? _searchEmojis(query, 9) : [];
  // Typed something with no matches — get out of the way rather than showing
  // an empty box over the chat.
  if (query.length > 0 && results.length === 0) { _closeEmojiPicker(); return; }

  _renderEmojiPicker(results, freq);

  const pick = document.getElementById('emoji-pick');
  if (!pick) return;
  pick.style.bottom = '';
  pick.style.transform = '';
  pick.classList.add('open');
  const pickH = pick.offsetHeight;
  const cursor = window._dexGetChatCursorPos?.();
  if (cursor) {
    pick.style.left = cursor.x + 'px';
    pick.style.top = (cursor.y - pickH - 4) + 'px';
  } else {
    pick.style.left = '60px';
    pick.style.top = (window.innerHeight - 280) + 'px';
  }
};

window._dexCloseChatEmoji = function () { _closeEmojiPicker(); _chatEmojiMode = false; };
window._dexIsChatEmojiMode = function () { return _chatEmojiMode; };

window._dexHandleEmojiNav = function (e) {
  const cells = [...document.querySelectorAll('#emoji-pick .emoji-cell')];
  if (!cells.length) return;
  if (_emojiActiveCell >= 0) cells[_emojiActiveCell]?.classList.remove('active');
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') _emojiActiveCell = (_emojiActiveCell + 1) % cells.length;
  else _emojiActiveCell = (_emojiActiveCell - 1 + cells.length) % cells.length;
  cells[_emojiActiveCell]?.classList.add('active');
};

window._dexSelectActiveEmoji = function () {
  const cells = [...document.querySelectorAll('#emoji-pick .emoji-cell')];
  if (_emojiActiveCell >= 0 && _emojiActiveCell < cells.length) {
    const emoji = cells[_emojiActiveCell].dataset.emoji;
    // _dexInsertChatEmoji bumps the frequency itself.
    if (emoji) window._dexInsertChatEmoji?.(emoji);
  }
  _closeEmojiPicker();
  _chatEmojiMode = false;
};

window._dexBumpEmojiFreq = function (emoji) { _bumpEmojiFreq(emoji); };
window._dexChatEmojiInserted = function (emoji) { _bumpEmojiFreq(emoji); };
