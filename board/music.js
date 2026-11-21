/* Dex Board Music tab. Full parity with the music overlay on the main site.
   The list, the playback engines, the transport rules and the TUNES editing
   set are the overlay behaviour from script.js initMusic(), rebuilt to live
   inside the board Music tab container instead of a dialog. The floating
   remote pill and the fold and expand states are overlay furniture and are
   not built here. Their controls live on the fixed transport bar at the foot
   of this tab, which is where the pill buttons pointed anyway, because the
   pill owned no state and only ever clicked the bar controls.

   Reads and writes go through the same endpoints the overlay uses:
   GET and POST /api/music/playlist, and GET /api/music/media for Instagram.
   Source parsing and engine choice come from lib/music-embeds.js, imported
   below, which is the same parser the server uses. Nothing about the tracks
   or the playlists is stored in this file. Everything is read live at
   runtime from the playlist endpoint, with the static manifest the overlay
   uses as its fallback when there is no API on the host. */

import '../lib/music-embeds.js';

const API = '/api/music/playlist';
const MEDIA_API = '/api/music/media';
const MANIFEST = '/assets/music/tracks.json';
const SYNC_MS = 2000;
const ORIGIN = 'https://www.youtube-nocookie.com';
const STALL = 12000;
const RESTART_AFTER = 5;
const TRAIL_MAX = 200;
const LOOPS = ['off', 'all', 'one'];
const SHUFFLE_KEY = 'music-shuffle';
const LOOP_KEY = 'music-loop';
const VOLUME_KEY = 'music-volume';
const LAST_KEY = 'music-last';
const FLAGS_KEY = 'music-flags';
const LEGACY_PLAYLISTS = 'dex-music-playlists';
const LEGACY_BACKUP = 'dex-music-playlists-legacy-backup-v1';
const PLAYLIST_CACHE = 'dex-music-playlists-shared-cache-v1';
const MIGRATED = 'dex-music-playlists-migrated-v1';

const REASONS = {
  0: 'it never started playing',
  2: 'the link is malformed',
  5: 'this browser could not play it',
  100: 'removed, private, or never existed',
  101: 'the owner blocks embedding, or it is gone',
  150: 'the owner blocks embedding, or it is gone',
};
const reasonFor = (code) => REASONS[code] || `the player refused it (error ${code})`;

const ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5v14M17 5v14" stroke-width="3.2"/>',
  'skip-back': '<path d="M6 5v14" stroke-width="2.6"/><path d="M19 5l-10 7 10 7z" fill="currentColor" stroke="none"/>',
  'skip-forward': '<path d="M18 5v14" stroke-width="2.6"/><path d="M5 5l10 7-10 7z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  loop: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9.5 9.5 0 0 1 0 14"/>',
  'volume-mute': '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M22 9l-6 6M16 9l6 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'tick-check': '<path d="M20 6L9 17l-5-5" stroke-width="2.6"/>',
  flag: '<path d="M4 22V4c4-2 8 2 12 0v10c-4 2-8-2-12 0"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  'fullscreen-exit': '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  list: '<g fill="currentColor" stroke="none"><circle cx="5" cy="7" r="2"/><circle cx="5" cy="17" r="2"/></g><path d="M11 7h9M11 17h9" stroke-width="2.5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
};

function svgFor(name) {
  return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (ICONS[name] || ICONS.play) + '</svg>';
}
function makeIcon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = svgFor(name);
  return span;
}
function setIcon(button, name) {
  const span = button ? button.querySelector('.icon') : null;
  if (span) span.innerHTML = svgFor(name);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { /* fall through to the selection based copy */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

const capital = (text) => String(text || '').replace(/^./, (c) => c.toUpperCase());
const mmss = (t) => (Number.isFinite(t) && t >= 0
  ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '--:--');

let active = null;

export function mount(container, ctx) {
  if (active) unmount();
  active = createPlayer(container, ctx || {});
  return active.ready;
}

export function unmount() {
  if (!active) return;
  const instance = active;
  active = null;
  instance.destroy();
}

function createPlayer(container, ctx) {
  const disposers = [];
  const timers = new Set();
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const clearLater = (id) => { clearTimeout(id); timers.delete(id); };

  const parseSource = (value) => {
    const embeds = globalThis.MusicEmbeds;
    return embeds && typeof embeds.parse === 'function' ? embeds.parse(value) : null;
  };

  /* State, mirroring the overlay closure in script.js initMusic(). */
  let tracks = [];
  let queue = [];
  let loaded = false;
  let view = 'all';
  let sort = 't';
  let query = '';
  let index = -1;
  const trail = [];
  let at = -1;
  const heard = new Set();
  let playing = false;
  let shuffle = true;
  let loop = 'all';
  let volume = 0.8;
  let lastVolume = 0.8;
  let duration = 0;
  let position = 0;
  let scrubbing = false;
  let armed = false;
  let current = null;
  let deadRun = 0;
  let watchdog = 0;
  let playerReady = false;
  let nativeEmbed = false;
  let directActive = false;
  let mediaRequest = 0;
  let mediaAbort = null;
  let admin = false;
  let token = null;
  let rev = -1;
  let live = false;
  let syncTimer = 0;
  let syncFetching = false;
  let arming = null;
  let armTimer = 0;
  let toastTimer = 0;
  let lookSeq = 0;
  let lookTimer = 0;
  let searchTimer = null;
  let lastDeleted = null;
  let destroyed = false;
  let fsOn = false;
  const ticked = new Set();
  const flagged = new Map();

  let customPlaylists = [];
  let sharedPlaylists = [];
  let legacyPlaylists = [];
  let sharedPlaylistsReady = false;
  let migrationPromise = null;
  let migrationFailedAt = 0;
  let playlistPicker = null;
  let pickedTrack = null;
  let pickerBusy = false;
  let pickerFocus = null;
  let pickerAnchor = null;
  let confirmDialog = null;

  try {
    const original = localStorage.getItem(LEGACY_PLAYLISTS);
    const backup = localStorage.getItem(LEGACY_BACKUP);
    if (original !== null && backup === null) {
      try { localStorage.setItem(LEGACY_BACKUP, original); } catch { /* private mode */ }
    }
    legacyPlaylists = JSON.parse(original || backup || '[]');
    if (!Array.isArray(legacyPlaylists)) legacyPlaylists = [];
  } catch { legacyPlaylists = []; }
  try {
    sharedPlaylists = JSON.parse(localStorage.getItem(PLAYLIST_CACHE) || '[]');
    if (!Array.isArray(sharedPlaylists)) sharedPlaylists = [];
  } catch { sharedPlaylists = []; }

  /* DOM. Built with DOM calls, like the overlay rows, so titles with quotes
     or ampersands in them never need hand escaping. */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const btn = (className, label, iconName) => {
    const b = el('button', className);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    if (iconName) b.append(makeIcon(iconName));
    return b;
  };

  const root = el('div', 'board-music');
  root.setAttribute('aria-label', 'Music');

  const head = el('div', 'music-head');
  const headingRow = el('div', 'music-heading-row');
  const titleEl = el('p', 'eyebrow music-eyebrow');
  titleEl.append(el('span', '', 'MUSIC'));
  const modeTag = el('span', 'mode-tag is-viewer');
  const modeTagText = el('span', '', 'Viewer');
  modeTag.append(makeIcon('eye'), modeTagText);
  headingRow.append(titleEl, modeTag);
  const actionsRow = el('div', 'music-actions-row');
  const countEl = el('p', 'music-count', 'LOADING');
  countEl.setAttribute('role', 'status');
  countEl.setAttribute('aria-live', 'polite');
  const addBtn = btn('music-admin-btn is-primary', 'Add song', 'plus');
  addBtn.append(el('span', '', 'Add song'));
  addBtn.setAttribute('aria-expanded', 'false');
  addBtn.hidden = true;
  const backupsBtn = btn('music-admin-btn', 'Backups', 'loop');
  backupsBtn.append(el('span', '', 'Backups'));
  backupsBtn.setAttribute('aria-expanded', 'false');
  backupsBtn.hidden = true;
  actionsRow.append(countEl, addBtn, backupsBtn);
  const filterRow = el('div', 'music-filter-row');
  const sortGroup = el('div', 'music-sort');
  sortGroup.setAttribute('role', 'group');
  sortGroup.setAttribute('aria-label', 'Sort the list');
  const sortTitle = el('button', '', 'TITLE');
  sortTitle.type = 'button';
  sortTitle.setAttribute('aria-pressed', 'true');
  const sortArtist = el('button', '', 'ARTIST');
  sortArtist.type = 'button';
  sortArtist.setAttribute('aria-pressed', 'false');
  sortGroup.append(sortTitle, sortArtist);
  const searchEl = el('input', 'music-search');
  searchEl.type = 'search';
  searchEl.placeholder = 'Search title or artist';
  searchEl.setAttribute('aria-label', 'Search tracks');
  searchEl.setAttribute('autocomplete', 'off');
  searchEl.spellcheck = false;
  filterRow.append(sortGroup, searchEl);
  head.append(headingRow, actionsRow, filterRow);

  const addPanel = el('form', 'music-add');
  addPanel.hidden = true;
  addPanel.setAttribute('autocomplete', 'off');
  const addUrlLabel = el('label', 'music-add-url');
  addUrlLabel.append(el('span', '', 'Music/video link or embed code'));
  const addUrl = el('input');
  addUrl.type = 'text';
  addUrl.setAttribute('inputmode', 'url');
  addUrl.spellcheck = false;
  addUrl.placeholder = 'YouTube, Instagram, Vimeo, SoundCloud, Spotify, TikTok or Bandcamp embed';
  addUrlLabel.append(addUrl);
  const addFound = el('div', 'music-add-found');
  addFound.hidden = true;
  const addThumb = el('img', 'music-add-thumb');
  addThumb.alt = '';
  addThumb.width = 320;
  addThumb.height = 180;
  const addTitleLabel = el('label');
  addTitleLabel.append(el('span', '', 'Title'));
  const addTitle = el('input');
  addTitle.maxLength = 200;
  addTitleLabel.append(addTitle);
  const addArtistLabel = el('label');
  addArtistLabel.append(el('span', '', 'Artist'));
  const addArtist = el('input');
  addArtist.maxLength = 200;
  addArtistLabel.append(addArtist);
  addFound.append(addThumb, addTitleLabel, addArtistLabel);
  const addNote = el('p', 'music-add-note');
  addNote.setAttribute('role', 'status');
  const addActs = el('div', 'music-add-acts');
  const addCancel = el('button', 'music-add-cancel', 'Cancel');
  addCancel.type = 'button';
  const addSave = el('button', 'music-add-save', 'Add to playlist');
  addSave.type = 'submit';
  addSave.disabled = true;
  addActs.append(addCancel, addSave);
  addPanel.append(addUrlLabel, addFound, addNote, addActs);

  const backupsPanel = el('div', 'music-backups');
  backupsPanel.hidden = true;
  const backupsHead = el('div', 'music-backups-head');
  backupsHead.append(
    el('b', '', 'Backups'),
    el('span', 'music-backups-note', 'Saved automatically before every change and at the start of each day. Restoring saves the current list first.'),
  );
  const downloadBtn = el('button', 'music-backups-dl', 'Download the list (.txt)');
  downloadBtn.type = 'button';
  backupsHead.append(downloadBtn);
  const backupsList = el('ol', 'music-backups-list');
  backupsPanel.append(backupsHead, backupsList);

  const toastEl = el('p', 'music-toast');
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.hidden = true;

  const body = el('div', 'music-body');
  const rail = el('nav', 'music-rail');
  rail.setAttribute('aria-label', 'Playlists');
  const railToggle = el('button', 'music-rail-toggle', '☰');
  railToggle.type = 'button';
  railToggle.setAttribute('aria-label', 'Expand playlists');
  railToggle.setAttribute('aria-expanded', 'false');
  const viewAll = el('button');
  viewAll.type = 'button';
  viewAll.setAttribute('aria-pressed', 'true');
  viewAll.append(makeIcon('play'), el('span', 'music-rail-label', 'ALL'));
  const nAll = el('span', 'music-rail-n');
  nAll.setAttribute('aria-hidden', 'true');
  viewAll.append(nAll);
  const viewRepeat = el('button');
  viewRepeat.type = 'button';
  viewRepeat.setAttribute('aria-pressed', 'false');
  viewRepeat.append(makeIcon('loop'), el('span', 'music-rail-label', 'REPEAT'));
  const nRepeat = el('span', 'music-rail-n');
  nRepeat.setAttribute('aria-hidden', 'true');
  viewRepeat.append(nRepeat);
  const customListEl = el('div');
  const addPlaylistBtn = btn('music-rail-add', 'Create playlist', 'plus');
  addPlaylistBtn.append(el('span', 'music-rail-label', 'Playlist'));
  addPlaylistBtn.hidden = true;
  const playlistForm = el('form', 'music-playlist-form');
  playlistForm.hidden = true;
  playlistForm.setAttribute('autocomplete', 'off');
  const playlistName = el('input');
  playlistName.type = 'text';
  playlistName.placeholder = 'Playlist name';
  playlistName.setAttribute('aria-label', 'New playlist name');
  playlistName.maxLength = 40;
  playlistName.setAttribute('autocomplete', 'off');
  const playlistFormBtns = el('div', 'music-playlist-form-btns');
  const playlistCancel = el('button', 'music-playlist-cancel', 'Cancel');
  playlistCancel.type = 'button';
  const playlistOk = el('button', 'music-playlist-ok', 'OK');
  playlistOk.type = 'submit';
  playlistFormBtns.append(playlistCancel, playlistOk);
  playlistForm.append(playlistName, playlistFormBtns);
  rail.append(railToggle, viewAll, viewRepeat, customListEl, addPlaylistBtn, playlistForm);
  const markEl = el('span', 'music-mark');
  markEl.setAttribute('aria-hidden', 'true');
  markEl.hidden = true;
  const listEl = el('div', 'music-list');
  const rowsEl = el('div');
  rowsEl.setAttribute('role', 'list');
  const emptyEl = el('p', 'music-empty');
  emptyEl.hidden = true;
  listEl.append(rowsEl, emptyEl);
  body.append(rail, markEl, listEl);

  const bar = el('div', 'music-bar');
  const seekRow = el('div', 'music-seek');
  const elapsedEl = el('span', 'music-time', '0:00');
  const scrubEl = el('input', 'player-range music-scrub');
  scrubEl.type = 'range';
  scrubEl.min = '0';
  scrubEl.max = '1000';
  scrubEl.value = '0';
  scrubEl.step = '1';
  scrubEl.setAttribute('aria-label', 'Seek');
  const durationEl = el('span', 'music-time', '--:--');
  seekRow.append(elapsedEl, scrubEl, durationEl);
  const controls = el('div', 'music-controls');
  const nowWrap = el('div', 'music-nowwrap');
  const screen = el('div', 'music-screen');
  const frame = el('iframe', 'music-video');
  frame.title = 'Now playing';
  frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.allowFullscreen = true;
  frame.hidden = true;
  const directVideo = el('video', 'music-video');
  directVideo.setAttribute('playsinline', '');
  directVideo.preload = 'metadata';
  directVideo.hidden = true;
  const thumbEl = el('img', 'music-thumb');
  thumbEl.alt = '';
  thumbEl.width = 320;
  thumbEl.height = 180;
  thumbEl.decoding = 'async';
  thumbEl.setAttribute('referrerpolicy', 'no-referrer');
  const screenIcon = makeIcon('play');
  screenIcon.classList.add('music-screen-icon');
  const fsWrap = el('div', 'music-fs');
  const fsCatch = btn('music-fs-catch', 'Play or pause', null);
  fsCatch.tabIndex = -1;
  const fsBar = el('div', 'music-fs-bar');
  const fsNow = el('p', 'music-fs-now');
  const fsTitleEl = el('strong');
  const fsArtistEl = el('span');
  fsNow.append(fsTitleEl, fsArtistEl);
  const fsSeek = el('div', 'music-fs-seek');
  const fsElapsedEl = el('span', 'music-fs-time', '0:00');
  const fsScrubEl = el('input', 'player-range music-fs-scrub');
  fsScrubEl.type = 'range';
  fsScrubEl.min = '0';
  fsScrubEl.max = '1000';
  fsScrubEl.value = '0';
  fsScrubEl.step = '1';
  fsScrubEl.setAttribute('aria-label', 'Seek');
  const fsDurationEl = el('span', 'music-fs-time', '--:--');
  fsSeek.append(fsElapsedEl, fsScrubEl, fsDurationEl);
  const fsRow = el('div', 'music-fs-row');
  const fsTransport = el('div', 'music-fs-transport');
  const fsBtns = {
    shuffle: btn('music-btn', 'Shuffle off', 'shuffle'),
    prev: btn('music-btn', 'Previous track', 'skip-back'),
    toggle: btn('music-btn is-primary', 'Pause', 'pause'),
    next: btn('music-btn', 'Next track', 'skip-forward'),
    loop: btn('music-btn music-loop', 'Repeat off', 'loop'),
  };
  fsBtns.loop.dataset.loop = 'off';
  const fsLoopOne = el('span', 'music-loop-one', '1');
  fsLoopOne.setAttribute('aria-hidden', 'true');
  fsLoopOne.hidden = true;
  fsBtns.loop.append(fsLoopOne);
  fsTransport.append(fsBtns.shuffle, fsBtns.prev, fsBtns.toggle, fsBtns.next, fsBtns.loop);
  const fsTail = el('div', 'music-fs-tail');
  const fsVolume = el('div', 'music-volume');
  fsBtns.mute = btn('music-btn music-volbtn', 'Mute', 'volume');
  const fsVolEl = el('input', 'player-range music-fs-vol');
  fsVolEl.type = 'range';
  fsVolEl.min = '0';
  fsVolEl.max = '100';
  fsVolEl.value = '40';
  fsVolEl.step = '1';
  fsVolEl.setAttribute('aria-label', 'Volume');
  fsVolume.append(fsBtns.mute, fsVolEl);
  const fsExitBtn = btn('music-btn music-fullbtn', 'Exit full screen', 'fullscreen-exit');
  fsTail.append(fsVolume, fsExitBtn);
  fsRow.append(fsTransport, fsTail);
  fsBar.append(fsNow, fsSeek, fsRow);
  fsWrap.append(fsCatch, fsBar);
  screen.append(frame, directVideo, thumbEl, screenIcon, fsWrap);
  const nowBox = el('div', 'music-now');
  const nowTitle = el('strong', 'music-now-title');
  const nowArtist = el('span', 'music-now-artist');
  const embedHelp = el('p');
  embedHelp.hidden = true;
  embedHelp.append(document.createTextNode('Use the embedded player controls. '));
  const embedOriginal = el('a', '', 'Open original');
  embedOriginal.target = '_blank';
  embedOriginal.rel = 'noopener noreferrer';
  embedHelp.append(embedOriginal);
  nowBox.append(nowTitle, nowArtist, embedHelp);
  nowWrap.append(screen, nowBox);
  const transport = el('div', 'music-transport');
  const btnShuffle = btn('music-btn', 'Shuffle off', 'shuffle');
  btnShuffle.setAttribute('aria-pressed', 'false');
  const btnPrev = btn('music-btn', 'Previous track', 'skip-back');
  const btnToggle = btn('music-btn is-primary', 'Pause', 'pause');
  const btnNext = btn('music-btn', 'Next track', 'skip-forward');
  const btnLoop = btn('music-btn music-loop', 'Repeat off', 'loop');
  btnLoop.dataset.loop = 'off';
  const loopOne = el('span', 'music-loop-one', '1');
  loopOne.setAttribute('aria-hidden', 'true');
  loopOne.hidden = true;
  btnLoop.append(loopOne);
  transport.append(btnShuffle, btnPrev, btnToggle, btnNext, btnLoop);
  const tail = el('div', 'music-tail');
  const volumeGroup = el('div', 'music-volume');
  const btnMute = btn('music-btn music-volbtn', 'Mute', 'volume');
  const volumeSliderWrap = el('div', 'music-volume-slider');
  const volEl = el('input', 'player-range music-vol');
  volEl.type = 'range';
  volEl.min = '0';
  volEl.max = '100';
  volEl.value = '80';
  volEl.step = '1';
  volEl.setAttribute('aria-label', 'Volume');
  volumeSliderWrap.append(volEl);
  volumeGroup.append(btnMute, volumeSliderWrap);
  const btnStop = btn('music-btn music-stopbtn', 'Stop music', 'stop');
  const fullBtn = btn('music-btn music-fullbtn', 'Full screen', 'fullscreen');
  tail.append(volumeGroup, btnStop, fullBtn);
  controls.append(nowWrap, transport, tail);
  bar.append(seekRow, controls);

  root.append(head, addPanel, backupsPanel, toastEl, body, bar);
  container.append(root);

  const narrowMusic = window.matchMedia('(max-width:900px)');
  const rootVisible = () => !destroyed && root.isConnected && root.getClientRects().length > 0;

  /* ---- shared playlists and the legacy device migration --------------- */
  function refreshPlaylists() {
    customPlaylists = sharedPlaylists.map((p) => ({ ...p, tracks: [...p.tracks] }));
    if (!admin) return;
    try { if (localStorage.getItem(MIGRATED) === JSON.stringify(legacyPlaylists)) return; } catch { /* private mode */ }
    for (const original of legacyPlaylists) {
      if (!original || typeof original.id !== 'string' || typeof original.name !== 'string' || !Array.isArray(original.tracks)) continue;
      const existing = customPlaylists.find((p) => p.name.trim().toLowerCase() === original.name.trim().toLowerCase());
      if (existing) {
        if (original.tracks.some((v) => !existing.tracks.includes(v))) {
          existing.tracks = [...new Set([...existing.tracks, ...original.tracks])];
          existing.pendingSync = true;
        }
      } else {
        const id = customPlaylists.some((p) => p.id === original.id) ? 'pending-' + original.id : original.id;
        customPlaylists.push({ ...original, id, tracks: [...original.tracks], pendingSync: true });
      }
    }
  }
  customPlaylists = sharedPlaylists;
  function adoptPlaylists(data) {
    if (!Array.isArray(data.playlists) || data.playlistsVersion !== 1) return;
    sharedPlaylistsReady = true;
    sharedPlaylists = data.playlists;
    try { localStorage.setItem(PLAYLIST_CACHE, JSON.stringify(sharedPlaylists)); } catch { /* private mode */ }
    refreshPlaylists();
    if (view.startsWith('pl:') && !customPlaylists.some((p) => 'pl:' + p.id === view)) {
      view = 'all';
      viewAll.setAttribute('aria-pressed', 'true');
      viewRepeat.setAttribute('aria-pressed', 'false');
    }
  }
  async function migrateLegacyPlaylists() {
    if (!admin || !sharedPlaylistsReady || !legacyPlaylists.length || Date.now() - migrationFailedAt < 15000) return;
    const signature = JSON.stringify(legacyPlaylists);
    try { if (localStorage.getItem(MIGRATED) === signature) return; } catch { /* private mode */ }
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      const result = await edit('playlist-import', { playlists: legacyPlaylists }, { quiet: true });
      if (result && !result.error) {
        try { localStorage.setItem(MIGRATED, signature); } catch { /* private mode */ }
        refreshPlaylists();
        render();
        toast('The playlists from this device are now shared. The original copy is kept as a backup.');
      } else {
        migrationFailedAt = Date.now();
        refreshPlaylists();
        render();
        toast('Playlist sync is pending. Your saved playlists remain available on this device, and Music will retry automatically.');
      }
    })().finally(() => { migrationPromise = null; });
    return migrationPromise;
  }
  on(window, 'storage', (event) => {
    if (event.key !== LEGACY_PLAYLISTS) return;
    try {
      const value = JSON.parse(event.newValue || '[]');
      if (Array.isArray(value)) {
        legacyPlaylists = value;
        refreshPlaylists();
        render();
        migrateLegacyPlaylists();
      }
    } catch { /* preserve invalid original bytes for recovery */ }
  });

  /* ---- would not play flags, per browser ------------------------------ */
  function seedTicks() {
    ticked.clear();
    for (const t of tracks) if (t.r) ticked.add(t.v);
  }
  function loadFlags() {
    flagged.clear();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(FLAGS_KEY) || 'null'); } catch { return; }
    if (!Array.isArray(stored)) return;
    for (const row of stored) {
      if (Array.isArray(row) && typeof row[0] === 'string') {
        flagged.set(row[0], { code: row[1], at: row[2] });
      }
    }
  }
  function saveFlags() {
    const rows = [...flagged].map(([v, f]) => [v, f.code, f.at]);
    try { localStorage.setItem(FLAGS_KEY, JSON.stringify(rows)); } catch { /* this session only */ }
  }
  function flagTip(track) {
    const f = flagged.get(track.v);
    if (!f) return '';
    const when = Number.isFinite(f.at)
      ? new Date(f.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : 'an earlier session';
    return `WOULD NOT PLAY\nSkipped on ${when}, ${reasonFor(f.code)}. `
      + 'The link still opens on YouTube. Click the flag to clear it.';
  }
  function paintFlag(button, track) {
    const isOn = flagged.has(track.v);
    button.hidden = !isOn;
    if (!isOn) return;
    button.dataset.tip = flagTip(track);
    button.dataset.tipKind = 'loud';
    button.title = flagTip(track);
    button.setAttribute('aria-label',
      `${track.t} would not play: ${reasonFor(flagged.get(track.v).code)}. Activate to clear this flag.`);
  }
  function paintFlags() {
    const rows = rowsEl.children;
    for (let i = 0; i < rows.length; i++) {
      const track = queue[i];
      const button = rows[i].querySelector('.music-flag');
      if (track && button) paintFlag(button, track);
    }
  }

  /* ---- the list -------------------------------------------------------- */
  const fold = (s) => s.toLowerCase();
  function visible() {
    const q = fold(query.trim());
    let out;
    if (view === 'repeat') out = tracks.filter((t) => ticked.has(t.v));
    else if (view.startsWith('pl:')) {
      const pl = customPlaylists.find((p) => 'pl:' + p.id === view);
      const ids = new Set(pl ? pl.tracks : []);
      out = tracks.filter((t) => ids.has(t.v));
    } else out = tracks.slice();
    if (q) out = out.filter((t) => fold(t.t).includes(q) || fold(t.a).includes(q));
    const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    out.sort((x, y) => (sort === 'a' ? cmp(x.a, y.a) || cmp(x.t, y.t) : cmp(x.t, y.t) || cmp(x.a, y.a)));
    return out;
  }

  function buildRow(track) {
    const row = el('div', 'music-row');
    row.setAttribute('role', 'listitem');
    row.dataset.v = track.v;

    const check = btn('music-playlist-add', `Add ${track.t} to playlists`, 'list');
    check.dataset.repeat = String(ticked.has(track.v));
    check.dataset.member = String(ticked.has(track.v) || customPlaylists.some((p) => p.tracks.includes(track.v)));
    check.setAttribute('aria-haspopup', 'dialog');
    check.setAttribute('aria-expanded', String(pickedTrack?.v === track.v));
    check.disabled = !admin;

    const play = btn('music-play', `Play ${track.t} by ${track.a}`, 'play');
    const meta = el('span', 'music-meta');
    const title = el('span', 'music-title', track.t);
    const artist = el('span', 'music-artist', track.a);
    meta.append(title, artist);

    const cell = el('span', 'music-linkcell');
    const link = el('a', 'music-link', track.u.replace(/^https?:\/\/(www\.)?/, ''));
    link.href = track.u;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const copy = btn('music-copy', `Copy the link to ${track.t}`, 'copy');
    cell.append(link, copy);

    const flagCell = el('span', 'music-flagcell');
    const flag = btn('music-flag', '', 'flag');
    paintFlag(flag, track);
    flagCell.append(flag);

    row.append(play, meta, cell, flagCell);
    if (admin) row.append(renameCell(track, title));
    row.append(check);
    if (admin) row.append(deleteCell(track));
    return row;
  }

  function renameCell(track, titleNode) {
    const cell = el('span', 'music-renamecell');
    const button = btn('music-rename', `Rename ${track.t}`, 'pencil');
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = el('input', 'music-rename-input');
      input.type = 'text';
      input.value = track.t;
      input.setAttribute('aria-label', 'New title');
      titleNode.replaceWith(input);
      input.focus();
      input.select();
      let settled = false;
      const save = async () => {
        if (settled) return;
        settled = true;
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== track.t) {
          const data = await edit('rename', { v: track.v, t: newTitle });
          if (data && !data.error) toast(`Renamed to "${newTitle}".`);
        }
        render();
      };
      const cancel = () => { settled = true; render(); };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); save(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
        ev.stopPropagation();
      });
      input.addEventListener('blur', save);
    });
    cell.append(button);
    return cell;
  }

  function deleteCell(track) {
    const cell = el('span', 'music-delcell');
    const button = btn('music-del', `Remove ${track.t} from the playlist`, null);
    button.innerHTML = '<svg class="music-del-minus" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
      + '<path d="M6.5 12h11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>'
      + '<span class="music-del-word">SURE?</span>';
    cell.append(button);
    return cell;
  }

  function render() {
    const wasPlaying = index >= 0 ? queue[index] : null;
    queue = visible();
    const frag = document.createDocumentFragment();
    for (const track of queue) frag.append(buildRow(track));
    rowsEl.replaceChildren(frag);
    index = wasPlaying ? queue.findIndex((t) => t.v === wasPlaying.v) : -1;
    renderCustomPlaylists();
    const none = queue.length === 0;
    emptyEl.hidden = !none;
    if (none) {
      if (query.trim()) {
        emptyEl.textContent = `Nothing matches "${query.trim()}".`;
      } else if (view === 'repeat') {
        emptyEl.textContent = admin
          ? 'Nothing on repeat yet, tick a track in ALL to add it.'
          : 'Nothing on the REPEAT playlist.';
      } else if (view.startsWith('pl:')) {
        const pl = customPlaylists.find((p) => 'pl:' + p.id === view);
        const name = pl ? pl.name : 'this';
        emptyEl.textContent = `Nothing on the ${name} playlist yet.`;
      } else {
        emptyEl.textContent = 'No tracks yet.';
      }
    }
    countEl.textContent = `${queue.length} OF ${tracks.length}`;
    nAll.textContent = String(tracks.length);
    nRepeat.textContent = String(ticked.size);
    if (!armed) idle();
    paint();
    if (playlistPicker) {
      if (!tracks.some((t) => t.v === pickedTrack?.v)) closePlaylistPicker(false);
      else paintPlaylistPicker();
    }
  }

  function idle() {
    nativeUI(null);
    nowTitle.textContent = 'Nothing playing';
    nowArtist.textContent = `${queue.length} in ${view === 'repeat' ? 'REPEAT' : 'ALL'}`;
    screen.classList.remove('is-live');
    frame.hidden = true;
    thumbEl.removeAttribute('src');
    resetTime();
  }

  function showRow(i) {
    const row = rowsEl.children[i];
    if (!row || !listEl) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top >= listEl.scrollTop && bottom <= listEl.scrollTop + listEl.clientHeight) return;
    listEl.scrollTop = top - (listEl.clientHeight - row.offsetHeight) / 2;
  }

  function mark() {
    if (index < 0 || !queue.length) { markEl.hidden = true; return; }
    markEl.hidden = false;
    markEl.style.top = `${((index + 0.5) / queue.length) * 100}%`;
  }

  /* ---- OS media session and one sound at a time -------------------------
     MediaBus on the main site is a closure inside script.js and is not
     exported to ES modules, so this tab keeps the same contract locally:
     it sets MediaSession metadata and handlers, holds the session with a
     near silent looped WAV in this document while an iframe track plays,
     and pauses every other media element in the document when it starts.
     The overlay on the main site is a different page, so the two players
     can never sound at once in practice. */
  let holdEl = null;
  let sessionInstalled = false;
  function holdElement() {
    if (holdEl) return holdEl;
    const RATE = 8000;
    const SECONDS = 10;
    const frames = RATE * SECONDS;
    const size = 44 + frames * 2;
    const view2 = new DataView(new ArrayBuffer(size));
    const tag = (offset, s) => { for (let i = 0; i < s.length; i++) view2.setUint8(offset + i, s.charCodeAt(i)); };
    tag(0, 'RIFF');
    view2.setUint32(4, size - 8, true);
    tag(8, 'WAVEfmt ');
    view2.setUint32(16, 16, true);
    view2.setUint16(20, 1, true);
    view2.setUint16(22, 1, true);
    view2.setUint32(24, RATE, true);
    view2.setUint32(28, RATE * 2, true);
    view2.setUint16(32, 2, true);
    view2.setUint16(34, 16, true);
    tag(36, 'data');
    view2.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) view2.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
    holdEl = new Audio(URL.createObjectURL(new Blob([view2.buffer], { type: 'audio/wav' })));
    holdEl.loop = true;
    return holdEl;
  }
  function holdSession(onState) {
    let element;
    try { element = holdElement(); } catch { return; }
    if (onState) element.play().catch(() => {});
    else element.pause();
  }
  function installSession() {
    if (sessionInstalled) return;
    sessionInstalled = true;
    if (!('mediaSession' in navigator)) return;
    const set = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
    };
    set('play', () => { if (index >= 0 && !playing) resume(); });
    set('pause', () => { if (playing) pause(); });
    set('nexttrack', () => step(1));
    set('previoustrack', () => step(-1));
  }
  function nowPlaying(meta) {
    installSession();
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: meta.title || '',
        artist: meta.artist || '',
        album: 'dexcimino.com',
        artwork: meta.artwork ? [{ src: meta.artwork, sizes: '320x180' }] : [],
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch { /* handlers above still stand */ }
  }
  function playbackState(isPlaying) {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch { /* older engines */ }
  }
  function solo() {
    for (const other of document.querySelectorAll('audio, video')) {
      if (other === directVideo || other === holdEl) continue;
      if (!other.paused) { try { other.pause(); } catch { /* nothing left to try */ } }
    }
  }

  function paint() {
    const rows = rowsEl.children;
    for (let i = 0; i < rows.length; i++) {
      const isCurrent = i === index;
      rows[i].classList.toggle('is-playing', isCurrent);
      const playButton = rows[i].querySelector('.music-play');
      if (playButton) setIcon(playButton, isCurrent && playing ? 'pause' : 'play');
    }
    mark();
    setIcon(btnToggle, playing ? 'pause' : 'play');
    btnToggle.setAttribute('aria-label',
      nativeEmbed && !directActive ? (playing ? 'Close embed' : 'Open embed') : (playing ? 'Pause' : 'Play'));
    playbackState(playing && (!nativeEmbed || directActive));
    holdSession(armed && playing && (!nativeEmbed || directActive));
    document.documentElement.classList.toggle('music-live', armed && !destroyed);
    paintFs();
  }

  /* ---- the player engines ---------------------------------------------- */
  function post(message) {
    if (nativeEmbed || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(JSON.stringify(message), ORIGIN); }
    catch { /* not loaded yet, the next command re-sends */ }
  }
  const cmd = (func, args = []) => {
    if (directActive) {
      if (func === 'pauseVideo' || func === 'stopVideo') directVideo.pause();
      if (func === 'playVideo') {
        directVideo.play().catch((error) => {
          if (error.name !== 'AbortError') { playing = false; paint(); }
        });
      }
      if (func === 'seekTo') directVideo.currentTime = args[0];
      if (func === 'setVolume') directVideo.volume = args[0] / 100;
      if (func === 'mute') directVideo.muted = true;
      if (func === 'unMute') directVideo.muted = false;
      return;
    }
    post({ event: 'command', func, args });
  };

  function srcFor(v) {
    const params = new URLSearchParams({
      enablejsapi: '1', autoplay: '1', rel: '0',
      modestbranding: '1', playsinline: '1', controls: '0', vq: 'small',
    });
    if (/^https?:/.test(location.origin)) params.set('origin', location.origin);
    return `${ORIGIN}/embed/${encodeURIComponent(v)}?${params}`;
  }

  function nativeUI(source) {
    if (mediaAbort) mediaAbort.abort();
    mediaRequest++;
    directVideo.pause();
    directVideo.removeAttribute('src');
    directVideo.load();
    directVideo.hidden = true;
    directActive = false;
    nativeEmbed = !!source?.e || !!source?.audio;
    root.classList.toggle('has-native-embed', nativeEmbed);
    embedHelp.hidden = !nativeEmbed;
    if (source?.audio) {
      embedHelp.firstChild.textContent = 'Direct audio file. The player controls below drive it. ';
      embedOriginal.href = source.u;
    } else if (source?.e) {
      embedHelp.firstChild.textContent = `Use ${source.p} player controls. Public posts must allow embedding. `;
      embedOriginal.href = source.u;
    } else {
      embedOriginal.removeAttribute('href');
    }
    for (const control of [scrubEl, volEl, btnMute, fsScrubEl, fsVolEl, fsBtns.mute]) {
      if (control) control.disabled = nativeEmbed;
    }
    btnLoop.disabled = false;
    if (fsBtns.loop) fsBtns.loop.disabled = false;
    root.classList.remove('has-direct-video');
  }

  async function loadPublicVideo(source) {
    if (mediaAbort) mediaAbort.abort();
    const request = ++mediaRequest;
    mediaAbort = new AbortController();
    try {
      const response = await fetch(MEDIA_API + '?url=' + encodeURIComponent(source.u),
        { cache: 'no-store', signal: mediaAbort.signal });
      if (!response.ok) throw new Error('public video unavailable');
      const data = await response.json();
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || !/\.(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
        || url.username || url.password || url.port) throw new Error('invalid media URL');
      if (request !== mediaRequest || current?.v !== source.v || !armed) return;
      frame.removeAttribute('src');
      frame.hidden = true;
      directActive = true;
      directVideo.hidden = false;
      root.classList.add('has-direct-video');
      for (const control of [scrubEl, volEl, btnMute, fsScrubEl, fsVolEl, fsBtns.mute]) {
        if (control) control.disabled = false;
      }
      embedHelp.firstChild.textContent = 'Instagram, ';
      directVideo.src = url.href;
      pushVolume();
      if (playing) {
        await directVideo.play().catch((error) => {
          if (request === mediaRequest && error.name !== 'AbortError') { playing = false; paint(); }
        });
      }
      if (request === mediaRequest) paint();
    } catch (error) {
      if (request !== mediaRequest || error.name === 'AbortError') return;
      directVideo.pause();
      directVideo.removeAttribute('src');
      directVideo.load();
      directVideo.hidden = true;
      directActive = false;
      root.classList.remove('has-direct-video');
      for (const control of [scrubEl, volEl, btnMute, fsScrubEl, fsVolEl, fsBtns.mute]) {
        if (control) control.disabled = true;
      }
      frame.hidden = false;
      frame.src = source.e;
      embedHelp.firstChild.textContent = 'Instagram player, automatic repeat unavailable for this post. ';
      paint();
    }
  }

  async function loadDirectAudio(source) {
    if (mediaAbort) mediaAbort.abort();
    const request = ++mediaRequest;
    try {
      const url = new URL(source.audio || source.u);
      if (url.protocol !== 'https:' || url.hostname !== 'media.clayweld.com'
        || !/\.(mp3|m4a|ogg|wav)$/i.test(url.pathname) || url.username || url.password || url.port) {
        throw new Error('invalid audio URL');
      }
      if (request !== mediaRequest || current?.v !== source.v || !armed) return;
      frame.removeAttribute('src');
      frame.hidden = true;
      directActive = true;
      directVideo.hidden = false;
      root.classList.add('has-direct-video');
      for (const control of [scrubEl, volEl, btnMute, fsScrubEl, fsVolEl, fsBtns.mute]) {
        if (control) control.disabled = false;
      }
      embedHelp.firstChild.textContent = 'Audio, ';
      directVideo.src = url.href;
      pushVolume();
      if (playing) {
        await directVideo.play().catch((error) => {
          if (request === mediaRequest && error.name !== 'AbortError') { playing = false; paint(); }
        });
      }
      if (request === mediaRequest) paint();
    } catch (error) {
      if (request !== mediaRequest) return;
      directVideo.pause();
      directVideo.removeAttribute('src');
      directVideo.load();
      directVideo.hidden = true;
      directActive = false;
      root.classList.remove('has-direct-video');
      embedHelp.firstChild.textContent = 'Audio file could not be played. ';
      playing = false;
      paint();
    }
  }

  const readDirectDuration = () => {
    if (!directActive) return;
    duration = directVideo.duration;
    paintTime(directVideo.currentTime);
    pushVolume();
  };
  on(directVideo, 'loadedmetadata', readDirectDuration);
  on(directVideo, 'durationchange', readDirectDuration);
  on(directVideo, 'timeupdate', () => {
    if (directActive) { position = directVideo.currentTime; paintTime(position); }
  });
  on(directVideo, 'ended', () => {
    if (!directActive || !current) return;
    if (loop === 'one') {
      position = 0;
      paintTime(0);
      const source = parseSource(current.v);
      if (source?.audio) loadDirectAudio(source);
      else if (source) loadPublicVideo(source);
    } else step(1);
  });
  on(directVideo, 'error', () => {
    if (!directActive || !current) return;
    directVideo.pause();
    directVideo.hidden = true;
    directActive = false;
    root.classList.remove('has-direct-video');
    const source = parseSource(current.v);
    for (const control of [scrubEl, volEl, btnMute, fsScrubEl, fsVolEl, fsBtns.mute]) {
      if (control) control.disabled = true;
    }
    if (source?.audio || !source?.e) {
      embedHelp.firstChild.textContent = 'Audio file could not be played. ';
      paint();
      return;
    }
    frame.hidden = false;
    frame.src = source.e;
    embedHelp.firstChild.textContent = 'Instagram player, automatic repeat unavailable for this post. ';
    paint();
  });

  function load(i, fromClick, walking) {
    const track = queue[i];
    if (!track) return;
    if (!walking) {
      trail.length = at + 1;
      if (trail[trail.length - 1] !== track.v) trail.push(track.v);
      at = trail.length - 1;
      if (trail.length > TRAIL_MAX) {
        const drop = trail.length - TRAIL_MAX;
        trail.splice(0, drop);
        at -= drop;
      }
    }
    heard.add(track.v);
    index = i;
    const wasNative = nativeEmbed;
    current = track;
    /* The parser is the engine choice. The stored fields are only a fallback
       for the case the parser module itself failed to load, so a track with
       a stored embed or audio URL still lands in the right engine. */
    const source = parseSource(track.v)
      || (track.e ? { p: track.p || 'Embed', u: track.u, e: track.e, v: track.v }
        : track.audio ? { p: 'Audio', u: track.u, audio: track.audio, v: track.v } : null);
    nativeUI(source);
    nowTitle.textContent = track.t;
    nowArtist.textContent = track.a;
    resetTime();
    frame.hidden = false;
    screen.classList.add('is-live');
    const thumb = nativeEmbed ? '' : `https://i.ytimg.com/vi/${encodeURIComponent(track.v)}/mqdefault.jpg`;
    if (thumb) thumbEl.src = thumb;
    else thumbEl.removeAttribute('src');
    nowPlaying({ title: track.t, artist: track.a, artwork: thumb });
    try { localStorage.setItem(LAST_KEY, track.v); } catch { /* private mode */ }
    if (nativeEmbed) {
      calm();
      deadRun = 0;
      frame.removeAttribute('src');
      armed = true;
      playerReady = false;
      if (source.p === 'Instagram') loadPublicVideo(source);
      else if (source.audio) loadDirectAudio(source);
      else frame.src = source.e;
    } else if (!armed || wasNative) {
      frame.src = srcFor(track.v);
      armed = true;
      playerReady = false;
    } else if (!playerReady) {
      frame.src = srcFor(track.v);
    } else {
      cmd('loadVideoById', [track.v]);
      pushVolume();
    }
    playing = true;
    paint();
    showRow(i);
    if (fromClick) solo();
  }

  /* ---- the shuffle cycle and transport --------------------------------- */
  const unheard = () => queue.filter((t) => !heard.has(t.v));
  function nextShuffled() {
    let left = unheard();
    if (!left.length) {
      heard.clear();
      if (current) heard.add(current.v);
      left = unheard();
      if (!left.length) left = queue.slice();
    }
    return left[Math.floor(Math.random() * left.length)];
  }
  function startFresh() {
    if (!queue.length) return;
    if (!shuffle) { load(0, true); return; }
    let last = null;
    try { last = localStorage.getItem(LAST_KEY); } catch { /* private mode */ }
    let pick = nextShuffled();
    if (queue.length > 1 && pick.v === last) {
      const other = unheard().filter((t) => t.v !== last);
      if (other.length) pick = other[Math.floor(Math.random() * other.length)];
    }
    load(queue.indexOf(pick), true);
  }
  function back() {
    if (index >= 0 && position >= RESTART_AFTER) { restart(); return; }
    for (let k = at - 1; k >= 0; k--) {
      const i = queue.findIndex((t) => t.v === trail[k]);
      if (i >= 0) { at = k; load(i, true, true); return; }
    }
    if (shuffle) {
      if (index < 0) { startFresh(); return; }
      restart();
      return;
    }
    const next = index - 1;
    load(next < 0 ? (loop === 'off' ? 0 : queue.length - 1) : next, true, true);
  }
  function restart() {
    if (nativeEmbed && !directActive) { resume(); return; }
    cmd('seekTo', [0, true]);
    position = 0;
    paintTime(0);
    resume();
  }
  function step(delta) {
    if (!queue.length) return;
    if (delta < 0) { back(); return; }
    if (shuffle && delta > 0) {
      for (let k = at + 1; k < trail.length; k++) {
        const i = queue.findIndex((t) => t.v === trail[k]);
        if (i >= 0) { at = k; load(i, true, true); return; }
      }
      if (queue.length < 2) { if (loop === 'off') stop(); else load(0, true); return; }
      if (!unheard().length && loop === 'off') { stop(); return; }
      load(queue.indexOf(nextShuffled()), true);
      return;
    }
    const next = index + delta;
    if (next >= queue.length) { if (loop === 'off') stop(); else load(0, true); return; }
    if (next < 0) { load(loop === 'off' ? 0 : queue.length - 1, true); return; }
    load(next, true);
  }
  function pause() {
    if (nativeEmbed && !directActive) {
      if (mediaAbort) mediaAbort.abort();
      mediaRequest++;
      frame.removeAttribute('src');
    } else cmd('pauseVideo');
    playing = false;
    paint();
  }
  function resume() {
    playing = true;
    if (nativeEmbed && !directActive && current) {
      const source = parseSource(current.v);
      if (source?.p === 'Instagram') loadPublicVideo(source);
      else if (source?.audio) loadDirectAudio(source);
      else if (source?.e) frame.src = source.e;
    } else cmd('playVideo');
    paint();
    solo();
  }
  function stop() {
    if (mediaAbort) mediaAbort.abort();
    mediaRequest++;
    directVideo.pause();
    directVideo.removeAttribute('src');
    directVideo.load();
    cmd('stopVideo');
    frame.removeAttribute('src');
    holdSession(false);
    armed = false;
    playerReady = false;
    playing = false;
    index = -1;
    current = null;
    trail.length = 0;
    at = -1;
    heard.clear();
    deadRun = 0;
    calm();
    idle();
    paint();
  }

  /* ---- a track that will not play --------------------------------------- */
  function stalled(track) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (current === track) refused(0);
    }, STALL);
    timers.add(watchdog);
  }
  function calm() {
    clearTimeout(watchdog);
    timers.delete(watchdog);
    watchdog = 0;
  }
  function refused(code) {
    const track = current;
    if (track) {
      flagged.set(track.v, { code, at: Date.now() });
      saveFlags();
      paintFlags();
    }
    deadRun++;
    const limit = Math.max(1, Math.min(queue.length || 1, 10));
    if (deadRun >= limit) {
      const n = deadRun;
      stop();
      nowTitle.textContent = 'Nothing here would play';
      nowArtist.textContent = `${n} track${n === 1 ? '' : 's'} in a row refused, flagged in the list`;
      return;
    }
    step(1);
    const dead = trail.lastIndexOf(track ? track.v : '');
    if (dead >= 0) { trail.splice(dead, 1); if (dead <= at) at--; }
    if (current && current !== track) stalled(current);
  }

  on(frame, 'load', () => {
    if (!armed || nativeEmbed) return;
    post({ event: 'listening', id: 1, channel: 'widget' });
    pushVolume();
  });
  on(window, 'message', (event) => {
    if (nativeEmbed || event.origin !== ORIGIN) return;
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    let data;
    try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; }
    catch { return; }
    if (!data || typeof data !== 'object') return;
    playerReady = true;
    if (data.event === 'onError') {
      refused(typeof data.info === 'number' ? data.info : 0);
      return;
    }
    const info = data.info;
    if (info && typeof info === 'object') {
      if (Number.isFinite(info.duration) && info.duration > 0) duration = info.duration;
      if (Number.isFinite(info.currentTime)) { position = info.currentTime; paintTime(info.currentTime); }
    }
    const state = typeof data.info === 'number' ? data.info
      : (data.info && typeof data.info.playerState === 'number' ? data.info.playerState : null);
    if (state === null) return;
    if (state === 0) {
      if (loop === 'one') { cmd('seekTo', [0, true]); cmd('playVideo'); return; }
      step(1);
      return;
    }
    const wasPlaying = playing;
    if (state === 1) { deadRun = 0; calm(); }
    if (state === 1) { playing = true; pushVolume(); }
    if (state === 2) playing = false;
    if (state === 1 && !wasPlaying) solo();
    if (state === 1 || state === 2) paint();
  });

  /* ---- time, seek, volume, loop, shuffle, full screen -------------------- */
  const setFill = (element, pct) => element.style.setProperty('--fill', `${pct}%`);
  let shownSecond = -1;
  let shownDuration = -1;
  function paintTime(now) {
    if (scrubbing) return;
    const sec = Math.floor(now);
    if (sec === shownSecond && duration === shownDuration) return;
    shownSecond = sec;
    shownDuration = duration;
    durationEl.textContent = mmss(duration);
    elapsedEl.textContent = mmss(now);
    const ratio = duration > 0 ? Math.min(1, now / duration) : 0;
    scrubEl.value = Math.round(ratio * 1000);
    setFill(scrubEl, ratio * 100);
    paintFs();
  }
  function resetTime() {
    duration = 0;
    position = 0;
    scrubbing = false;
    shownSecond = -1;
    shownDuration = -1;
    elapsedEl.textContent = '0:00';
    durationEl.textContent = '--:--';
    scrubEl.value = 0;
    setFill(scrubEl, 0);
    paintFs();
  }
  on(scrubEl, 'pointerdown', () => { scrubbing = true; });
  const commitSeek = () => {
    scrubbing = false;
    if (duration <= 0) return;
    position = (scrubEl.value / 1000) * duration;
    cmd('seekTo', [position, true]);
  };
  on(scrubEl, 'pointerup', commitSeek);
  on(scrubEl, 'change', commitSeek);
  on(scrubEl, 'input', () => {
    setFill(scrubEl, scrubEl.value / 10);
    if (duration > 0) elapsedEl.textContent = mmss((scrubEl.value / 1000) * duration);
  });

  function pushVolume() {
    if (!armed) return;
    cmd('setVolume', [Math.round(volume * 100)]);
    if (volume === 0) cmd('mute');
    else cmd('unMute');
    cmd('setPlaybackQuality', [fsOn ? 'hd1080' : 'small']);
  }
  function applyVolume(v, persist) {
    volume = Math.min(1, Math.max(0, v));
    volEl.value = Math.round(volume * 100);
    volEl.style.setProperty('--fill', `${volume * 100}%`);
    setIcon(btnMute, volume === 0 ? 'volume-mute' : 'volume');
    btnMute.setAttribute('aria-label', narrowMusic.matches ? 'Adjust volume' : volume === 0 ? 'Unmute' : 'Mute');
    volEl.setAttribute('aria-valuetext', `${Math.round(volume * 100)} percent`);
    if (persist) {
      try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* private mode */ }
    }
    pushVolume();
    paintFs();
  }
  on(volEl, 'input', () => {
    const v = volEl.value / 100;
    if (v > 0) lastVolume = v;
    applyVolume(v, true);
  });
  function closeVolume() {
    volumeGroup.classList.remove('is-open');
    if (narrowMusic.matches) btnMute.setAttribute('aria-expanded', 'false');
  }
  function syncVolumeButton() {
    closeVolume();
    btnMute.setAttribute('aria-label', narrowMusic.matches ? 'Adjust volume' : volume === 0 ? 'Unmute' : 'Mute');
    if (narrowMusic.matches) {
      btnMute.setAttribute('aria-expanded', 'false');
      btnMute.setAttribute('aria-controls', 'board-music-volume-slider');
    } else {
      btnMute.removeAttribute('aria-expanded');
      btnMute.removeAttribute('aria-controls');
    }
  }
  volumeSliderWrap.id = 'board-music-volume-slider';
  on(narrowMusic, 'change', () => { expandMusicRail(false); syncVolumeButton(); });
  on(btnMute, 'click', () => {
    if (narrowMusic.matches) {
      const opened = volumeGroup.classList.toggle('is-open');
      btnMute.setAttribute('aria-expanded', String(opened));
      if (opened) volEl.focus();
    } else {
      applyVolume(volume === 0 ? (lastVolume || 0.8) : 0, true);
    }
  });
  on(volumeGroup, 'keydown', (event) => {
    if (event.key === 'Escape' && volumeGroup.classList.contains('is-open')) {
      event.preventDefault();
      event.stopPropagation();
      closeVolume();
      btnMute.focus();
    }
  });

  function paintShuffle() {
    btnShuffle.setAttribute('aria-pressed', String(shuffle));
    btnShuffle.setAttribute('aria-label', shuffle ? 'Shuffle on' : 'Shuffle off');
    paintFs();
  }
  on(btnShuffle, 'click', () => {
    shuffle = !shuffle;
    paintShuffle();
    try { localStorage.setItem(SHUFFLE_KEY, shuffle ? '1' : '0'); } catch { /* session only */ }
  });
  const LOOP_LABEL = { off: 'Repeat off', all: 'Repeat the playlist', one: 'Repeat this track' };
  function paintLoop() {
    btnLoop.dataset.loop = loop;
    btnLoop.setAttribute('aria-label', LOOP_LABEL[loop]);
    loopOne.hidden = loop !== 'one';
    paintFs();
  }
  on(btnLoop, 'click', () => {
    loop = LOOPS[(LOOPS.indexOf(loop) + 1) % LOOPS.length];
    paintLoop();
    try { localStorage.setItem(LOOP_KEY, loop); } catch { /* session only */ }
  });

  const fsReal = { shuffle: btnShuffle, prev: btnPrev, toggle: btnToggle, next: btnNext, loop: btnLoop, mute: btnMute };
  function paintFs() {
    if (!fsOn) return;
    for (const name of Object.keys(fsBtns)) {
      const from = fsReal[name];
      const to = fsBtns[name];
      if (!from || !to) continue;
      const fromIcon = from.querySelector('.icon');
      const toIcon = to.querySelector('.icon');
      if (fromIcon && toIcon && toIcon.innerHTML !== fromIcon.innerHTML) toIcon.innerHTML = fromIcon.innerHTML;
      const label = from.getAttribute('aria-label');
      if (label) to.setAttribute('aria-label', label);
      const pressed = from.getAttribute('aria-pressed');
      if (pressed !== null) to.setAttribute('aria-pressed', pressed);
      if (from.dataset.loop) to.dataset.loop = from.dataset.loop;
    }
    fsLoopOne.hidden = loop !== 'one';
    fsTitleEl.textContent = nowTitle.textContent;
    fsArtistEl.textContent = nowArtist.textContent;
    fsElapsedEl.textContent = elapsedEl.textContent;
    fsDurationEl.textContent = durationEl.textContent;
    if (!scrubbing) {
      fsScrubEl.value = scrubEl.value;
      setFill(fsScrubEl, scrubEl.value / 10);
    }
    fsVolEl.value = volEl.value;
    setFill(fsVolEl, volEl.value);
  }
  for (const name of Object.keys(fsBtns)) {
    on(fsBtns[name], 'click', () => fsReal[name].click());
  }
  on(fsVolEl, 'input', () => {
    volEl.value = fsVolEl.value;
    volEl.dispatchEvent(new Event('input', { bubbles: true }));
  });
  on(fsScrubEl, 'pointerdown', () => { scrubbing = true; });
  on(fsScrubEl, 'input', () => {
    setFill(fsScrubEl, fsScrubEl.value / 10);
    scrubEl.value = fsScrubEl.value;
    scrubEl.dispatchEvent(new Event('input', { bubbles: true }));
    fsElapsedEl.textContent = elapsedEl.textContent;
  });
  const fsCommit = () => {
    scrubEl.value = fsScrubEl.value;
    scrubEl.dispatchEvent(new Event('change', { bubbles: true }));
  };
  on(fsScrubEl, 'pointerup', fsCommit);
  on(fsScrubEl, 'change', fsCommit);
  on(fullBtn, 'click', () => {
    if (document.fullscreenElement === screen) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    if (!armed) return;
    try {
      const request = screen.requestFullscreen ? screen.requestFullscreen() : null;
      if (request && request.catch) request.catch(() => {});
    } catch { /* refused, the bar is still there */ }
  });
  on(fsExitBtn, 'click', () => { if (document.exitFullscreen) document.exitFullscreen(); });
  let tapWasIdle = false;
  on(fsCatch, 'pointerdown', () => { tapWasIdle = fsWrap.classList.contains('is-idle'); });
  on(fsCatch, 'click', () => {
    if (tapWasIdle) return;
    btnToggle.click();
  });
  on(fsCatch, 'dblclick', () => { if (document.exitFullscreen) document.exitFullscreen(); });
  let idleTimer = 0;
  const stir = () => {
    if (!fsOn) return;
    fsWrap.classList.remove('is-idle');
    clearTimeout(idleTimer);
    timers.delete(idleTimer);
    idleTimer = setTimeout(() => fsWrap.classList.add('is-idle'), 2600);
    timers.add(idleTimer);
  };
  for (const name of ['pointermove', 'pointerdown', 'keydown', 'wheel']) on(fsWrap, name, stir);
  on(document, 'fullscreenchange', () => {
    fsOn = document.fullscreenElement === screen;
    document.documentElement.classList.toggle('music-fullscreen', fsOn);
    setIcon(fullBtn, fsOn ? 'fullscreen-exit' : 'fullscreen');
    fullBtn.setAttribute('aria-label', fsOn ? 'Exit full screen' : 'Full screen');
    clearTimeout(idleTimer);
    timers.delete(idleTimer);
    fsWrap.classList.remove('is-idle');
    if (fsOn) { paintFs(); stir(); }
    pushVolume();
  });

  /* ---- row clicks, views, sort, search, transport buttons --------------- */
  on(rowsEl, 'click', (event) => {
    const row = event.target.closest('.music-row');
    if (!row) return;
    const i = [...rowsEl.children].indexOf(row);
    const add = event.target.closest('.music-playlist-add');
    if (add) { openPlaylistPicker(queue[i], add); return; }
    const del = event.target.closest('.music-del');
    if (del) { onDelete(row, del); return; }
    if (event.target.closest('.music-play') || event.target.closest('.music-meta')) {
      calm();
      deadRun = 0;
      if (i !== index) load(i, true);
      else if (playing) pause();
      else resume();
      return;
    }
    if (event.target.closest('.music-flag')) {
      const track = queue[i];
      if (track && flagged.delete(track.v)) {
        saveFlags();
        paintFlags();
      }
      return;
    }
    const copyButton = event.target.closest('.music-copy');
    if (copyButton) {
      const track = queue[i];
      if (!track) return;
      copyText(track.u).then((ok) => {
        setIcon(copyButton, ok ? 'tick-check' : 'copy');
        copyButton.classList.toggle('is-done', ok);
        later(() => {
          setIcon(copyButton, 'copy');
          copyButton.classList.remove('is-done');
        }, 1800);
      });
    }
  });

  const setView = (next) => {
    view = next;
    viewAll.setAttribute('aria-pressed', String(next === 'all'));
    viewRepeat.setAttribute('aria-pressed', String(next === 'repeat'));
    renderCustomPlaylists();
    render();
  };
  on(viewAll, 'click', () => setView('all'));
  on(viewRepeat, 'click', () => setView('repeat'));

  function renderCustomPlaylists() {
    customListEl.replaceChildren();
    for (const pl of customPlaylists) {
      const wrap = el('div', 'music-rail-pl');
      const button = el('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(view === 'pl:' + pl.id));
      if (pl.pendingSync) button.title = 'Saved on this device, sync pending';
      const glyph = makeIcon('list');
      glyph.classList.add('music-custom-icon');
      const label = el('span', 'music-rail-label', pl.name.toUpperCase());
      const n = el('span', 'music-rail-n', String(pl.tracks.length));
      n.setAttribute('aria-hidden', 'true');
      button.append(glyph, label, n);
      button.addEventListener('click', () => setView('pl:' + pl.id));
      wrap.append(button);
      if (admin && !pl.pendingSync) {
        const del = btn('music-rail-del', `Delete playlist ${pl.name}`, null);
        del.textContent = '×';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmDeletePlaylist(pl);
        });
        wrap.append(del);
      }
      customListEl.append(wrap);
    }
    if (nAll) nAll.textContent = String(tracks.length);
    if (nRepeat) nRepeat.textContent = String(ticked.size);
  }

  function confirmDeletePlaylist(pl) {
    const overlay = el('dialog', 'music-confirm-overlay');
    const dialog = el('div', 'music-confirm-dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-label', `Delete playlist ${pl.name}`);
    const songCount = pl.tracks.length;
    const titleNode = el('p', 'music-confirm-title', 'Delete playlist?');
    const text = el('p', 'music-confirm-text');
    text.append(
      document.createTextNode('Are you sure you want to delete '),
      el('strong', '', pl.name),
      document.createTextNode(songCount === 1 ? ' with 1 song?' : ` with ${songCount} songs?`),
    );
    const buttons = el('div', 'music-confirm-btns');
    const cancelButton = el('button', 'music-confirm-cancel', 'Cancel');
    cancelButton.type = 'button';
    const okButton = el('button', 'music-confirm-ok', 'Delete');
    okButton.type = 'button';
    buttons.append(cancelButton, okButton);
    dialog.append(titleNode, text, buttons);
    overlay.append(dialog);
    document.body.append(overlay);
    confirmDialog = overlay;
    overlay.showModal();
    const close = () => { try { overlay.close(); } catch { overlay.remove(); } };
    on(cancelButton, 'click', close);
    on(overlay, 'click', (e) => { if (e.target === overlay) close(); });
    on(overlay, 'close', () => { overlay.remove(); if (confirmDialog === overlay) confirmDialog = null; });
    on(okButton, 'click', async () => {
      okButton.disabled = true;
      const result = await edit('playlist-delete', { id: pl.id }, { quiet: true });
      if (!result || result.error) {
        okButton.disabled = false;
        toast(result?.error || 'Could not delete the playlist.');
        return;
      }
      if (view === 'pl:' + pl.id) setView('all');
      else renderCustomPlaylists();
      close();
      toast(`Deleted playlist "${pl.name}".`);
    });
    cancelButton.focus();
  }

  function expandMusicRail(expanded) {
    rail.classList.toggle('is-expanded', expanded);
    body.classList.toggle('is-rail-expanded', expanded);
    railToggle.setAttribute('aria-expanded', String(expanded));
    railToggle.setAttribute('aria-label', expanded ? 'Collapse playlists' : 'Expand playlists');
  }
  on(railToggle, 'click', () => expandMusicRail(!rail.classList.contains('is-expanded')));
  on(rail, 'click', (event) => {
    if (!narrowMusic.matches || event.target.closest('button,input,form')) return;
    expandMusicRail(!rail.classList.contains('is-expanded'));
  });
  on(root, 'pointerdown', (event) => {
    if (narrowMusic.matches && !rail.contains(event.target)) expandMusicRail(false);
    if (!event.target.closest('.music-volume')) closeVolume();
  });

  function openPlaylistForm() {
    if (!admin) return;
    if (narrowMusic.matches) expandMusicRail(true);
    playlistForm.hidden = false;
    playlistName.value = '';
    playlistName.focus();
  }
  function closePlaylistForm() { playlistForm.hidden = true; }
  on(addPlaylistBtn, 'click', () => {
    if (playlistForm.hidden) openPlaylistForm();
    else closePlaylistForm();
  });
  on(playlistCancel, 'click', closePlaylistForm);
  on(playlistForm, 'submit', async (e) => {
    e.preventDefault();
    const name = playlistName.value.trim();
    if (!name) return;
    if (playlistOk.disabled) return;
    playlistOk.disabled = true;
    const id = crypto.randomUUID();
    const result = await edit('playlist-create', { id, name }, { quiet: true });
    playlistOk.disabled = false;
    if (!result || result.error) {
      toast(result?.error || 'Could not create the playlist.');
      return;
    }
    closePlaylistForm();
    renderCustomPlaylists();
    setView('pl:' + id);
    toast(`Playlist "${name}" created.`);
  });

  const setSort = (next) => {
    sort = next;
    sortTitle.setAttribute('aria-pressed', String(next === 't'));
    sortArtist.setAttribute('aria-pressed', String(next === 'a'));
    render();
  };
  on(sortTitle, 'click', () => setSort('t'));
  on(sortArtist, 'click', () => setSort('a'));
  on(searchEl, 'input', () => {
    clearTimeout(searchTimer);
    searchTimer = later(() => { query = searchEl.value; render(); }, 120);
  });

  on(btnPrev, 'click', () => step(-1));
  on(btnNext, 'click', () => step(1));
  on(btnToggle, 'click', () => {
    if (index < 0) startFresh();
    else if (playing) pause();
    else resume();
  });
  on(btnStop, 'click', () => stop());

  /* ---- the playlist picker ---------------------------------------------- */
  function closePlaylistPicker(focus = true) {
    const id = pickedTrack?.v;
    if (playlistPicker) {
      try { playlistPicker.close(); } catch { /* already closed */ }
      playlistPicker.remove();
    }
    playlistPicker = null;
    pickedTrack = null;
    pickerFocus = null;
    for (const button of rowsEl.querySelectorAll('.music-playlist-add')) {
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('aria-controls');
    }
    if (focus && id) {
      const target = rowsEl.querySelector(`.music-row[data-v="${CSS.escape(id)}"] .music-playlist-add`);
      if (target) target.focus({ preventScroll: true });
    }
  }
  function paintPlaylistPicker() {
    if (!playlistPicker || !pickedTrack) return;
    const list = playlistPicker.querySelector('.music-picker-list');
    list.replaceChildren();
    const entries = [
      { id: 'all', name: 'ALL', on: true, fixed: true },
      { id: 'repeat', name: 'REPEAT', on: ticked.has(pickedTrack.v) },
      ...customPlaylists.map((p) => ({
        id: p.id,
        name: p.name + (p.pendingSync ? ' (sync pending)' : ''),
        on: p.tracks.includes(pickedTrack.v),
        fixed: !!p.pendingSync,
      })),
    ];
    for (const entry of entries) {
      const label = el('label', 'music-picker-entry');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = entry.on;
      input.disabled = !!entry.fixed || pickerBusy;
      input.dataset.playlist = entry.id;
      label.append(input, el('span', '', entry.name));
      list.append(label);
      input.addEventListener('change', async () => {
        if (!admin || !pickedTrack || pickerBusy || entry.fixed) return;
        pickerFocus = entry.id;
        const v = pickedTrack.v;
        const isOn = input.checked;
        const status = playlistPicker.querySelector('.music-picker-status');
        status.textContent = '';
        if (entry.id === 'repeat') {
          pickerBusy = true;
          if (isOn) ticked.add(v);
          else ticked.delete(v);
          render();
          paintPlaylistPicker();
          status.textContent = 'Saving...';
          const result = await edit('repeat', { v, on: isOn }, { quiet: true });
          if (!result || result.error) {
            if (isOn) ticked.delete(v);
            else ticked.add(v);
            status.textContent = result?.error || 'Could not save the playlist change.';
          } else status.textContent = '';
          pickerBusy = false;
        } else {
          const pl = customPlaylists.find((p) => p.id === entry.id);
          if (!pl) return;
          pickerBusy = true;
          const previous = [...pl.tracks];
          pl.tracks = isOn ? [...new Set([...pl.tracks, v])] : pl.tracks.filter((item) => item !== v);
          render();
          paintPlaylistPicker();
          status.textContent = 'Saving...';
          const result = await edit('playlist-member', { id: entry.id, v, on: isOn }, { quiet: true });
          if (!result || result.error) {
            const currentPl = customPlaylists.find((p) => p.id === entry.id);
            if (currentPl) currentPl.tracks = previous;
            status.textContent = result?.error || 'Could not save the playlist change.';
          }
          pickerBusy = false;
        }
        renderCustomPlaylists();
        render();
        paintPlaylistPicker();
      });
    }
    if (playlistPicker.open && !pickerBusy && pickerFocus) {
      const focused = list.querySelector(`input[data-playlist="${CSS.escape(pickerFocus)}"]`);
      if (focused) focused.focus({ preventScroll: true });
    }
  }
  function positionPlaylistPicker() {
    if (!playlistPicker?.open || !pickerAnchor) return;
    const liveAnchor = rowsEl.querySelector(`.music-row[data-v="${CSS.escape(pickedTrack.v)}"] .music-playlist-add`);
    const a = liveAnchor?.getBoundingClientRect() || pickerAnchor;
    const r = playlistPicker.getBoundingClientRect();
    playlistPicker.style.left = Math.max(12, Math.min(a.right - r.width, innerWidth - r.width - 12)) + 'px';
    playlistPicker.style.top = Math.max(12, Math.min(
      a.bottom + 8 + r.height <= innerHeight - 12 ? a.bottom + 8 : a.top - r.height - 8,
      innerHeight - r.height - 12)) + 'px';
  }
  on(window, 'resize', positionPlaylistPicker);
  function openPlaylistPicker(track, anchor) {
    if (!admin || !track) return;
    closePlaylistPicker(false);
    pickedTrack = track;
    playlistPicker = el('dialog', 'music-playlist-picker');
    playlistPicker.setAttribute('aria-labelledby', 'board-music-picker-title');
    const pickerTitle = el('h3', '', 'Add to playlists');
    pickerTitle.id = 'board-music-picker-title';
    const song = el('p', 'music-picker-song', track.t);
    const list = el('div', 'music-picker-list');
    const note = el('p', 'music-picker-note', 'ALL contains every song. Changes save immediately.');
    const status = el('p', 'music-picker-status');
    status.setAttribute('role', 'status');
    const okay = el('button', 'music-picker-okay', 'Okay');
    okay.type = 'button';
    on(okay, 'click', () => closePlaylistPicker());
    playlistPicker.append(pickerTitle, song, list, note, status, okay);
    root.append(playlistPicker);
    on(playlistPicker, 'cancel', (event) => { event.preventDefault(); closePlaylistPicker(); });
    on(playlistPicker, 'keydown', (event) => event.stopPropagation());
    on(playlistPicker, 'click', (event) => {
      if (!playlistPicker.open || event.target !== playlistPicker) return;
      const r = playlistPicker.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) {
        event.preventDefault();
        event.stopPropagation();
        closePlaylistPicker();
      }
    });
    paintPlaylistPicker();
    playlistPicker.showModal();
    anchor.setAttribute('aria-expanded', 'true');
    pickerAnchor = anchor.getBoundingClientRect();
    positionPlaylistPicker();
    const first = playlistPicker.querySelector('input:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  /* ---- the live list, sync, and TUNES editing ---------------------------- */
  async function getIdToken() {
    try {
      if (ctx.user && typeof ctx.user.getIdToken === 'function') {
        const value = await ctx.user.getIdToken();
        if (value) return value;
      }
    } catch { /* fall through to the site helper */ }
    try {
      if (typeof window.siteIdToken === 'function') {
        const value = await window.siteIdToken();
        if (value) return value;
      }
    } catch { /* fall through to the module import */ }
    try {
      const mod = await import('/account/site-auth.js');
      if (mod && typeof mod.idToken === 'function') return await mod.idToken();
    } catch { /* no token available */ }
    return null;
  }

  async function pullList() {
    try {
      const response = await fetch(API, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.tracks) && data.tracks.length) {
          rev = Number(data.rev) || 0;
          live = true;
          return data;
        }
      }
    } catch { /* no API on this host, the baked file below is the same list */ }
    live = false;
    const response = await fetch(MANIFEST, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  function adoptList(data) {
    const list = data.tracks.filter((t) => t && t.v && t.t && t.u);
    if (!list.length) return;
    if (Number(data.rev) < rev) return;
    tracks = list;
    rev = Number(data.rev) || 0;
    adoptPlaylists(data);
    seedTicks();
    render();
  }
  function startSync() {
    clearInterval(syncTimer);
    if (live) syncTimer = setInterval(syncNow, SYNC_MS);
  }
  function stopSync() {
    clearInterval(syncTimer);
    syncTimer = 0;
  }
  async function syncNow() {
    if (syncFetching || destroyed) return;
    if (!live || document.hidden || !root.isConnected) return;
    if (arming || pickerBusy || document.activeElement?.matches('.music-rename-input')) return;
    syncFetching = true;
    try {
      const response = await fetch(API, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (data && Array.isArray(data.tracks) && data.tracks.length
        && (Number(data.rev) > rev || (!sharedPlaylistsReady && data.playlistsVersion === 1))) {
        adoptList(data);
      }
      await migrateLegacyPlaylists();
    } catch { /* the next poll will ask again */ }
    finally { syncFetching = false; }
  }
  on(document, 'visibilitychange', () => { if (!document.hidden) syncNow(); });

  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    timers.delete(toastTimer);
    toastTimer = later(() => { toastEl.hidden = true; }, 3000);
  }
  function setAdmin(onState) {
    admin = !!onState && !!token;
    refreshPlaylists();
    if (!admin) token = null;
    root.classList.toggle('is-admin', admin);
    modeTag.classList.toggle('is-admin', admin);
    modeTag.classList.toggle('is-viewer', !admin);
    modeTagText.textContent = admin ? 'Admin' : 'Viewer';
    addBtn.hidden = !admin;
    backupsBtn.hidden = !admin;
    addPlaylistBtn.hidden = !admin;
    if (!admin) {
      closePlaylistPicker(false);
      closeAdd();
      closeBackups();
      disarm();
      closePlaylistForm();
    }
  }
  async function unlock() {
    let response;
    try {
      const unlockBody = { action: 'unlock', idToken: await getIdToken() };
      if (window.DexAuth && window.DexAuth.isUnlocked()) {
        unlockBody.jwt = window.DexAuth.getToken();
      }
      response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(unlockBody),
      });
    } catch {
      toast('Editing is offline, the list is read-only.');
      return false;
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.token) {
      token = data.token;
      setAdmin(true);
      if (loaded) render();
      await migrateLegacyPlaylists();
      return true;
    }
    toast(response.status === 503
      ? 'Editing is not set up on this deploy.'
      : response.status === 404 ? 'There is no playlist server here, read-only.'
      : 'Editing did not open. Sign in again to edit.');
    return false;
  }
  async function edit(action, extra = {}, { quiet = false } = {}) {
    if (!admin || !token) return null;
    if (['add', 'playlist-member', 'playlist-delete'].includes(action)
      && customPlaylists.some((p) => p.pendingSync && p.id === (extra.playlistId || extra.id))) {
      const error = 'this playlist is still syncing, its saved songs remain available';
      if (!quiet) toast(capital(error) + '.');
      return { error };
    }
    let response;
    try {
      response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, token, ...extra }),
      });
    } catch {
      if (!quiet) toast('Could not reach the playlist, nothing was changed.');
      return quiet ? { error: 'could not reach the playlist' } : null;
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      setAdmin(false);
      render();
      toast('Editing session expired, sign in again to edit.');
      return null;
    }
    if (!response.ok) {
      if (!quiet) toast(data.error ? `${capital(data.error)}.` : `The playlist said ${response.status}.`);
      return { error: data.error || `status ${response.status}`, status: response.status, data };
    }
    if (Array.isArray(data.tracks)) adoptList(data);
    return data;
  }
  on(document, 'dex:owner', (event) => {
    const owner = !!(event.detail && event.detail.owner);
    if (owner && !admin) unlock();
    else if (!owner && admin) { setAdmin(false); if (loaded) render(); }
  });

  /* ---- two press remove and undo ------------------------------------------ */
  function disarm() {
    clearTimeout(armTimer);
    timers.delete(armTimer);
    if (arming) {
      arming.classList.remove('is-armed');
      arming.closest('.music-row')?.classList.remove('is-arming');
      if (arming.dataset.label) arming.setAttribute('aria-label', arming.dataset.label);
    }
    arming = null;
  }
  async function onDelete(row, button) {
    if (!admin) return;
    if (arming !== button) {
      disarm();
      arming = button;
      button.dataset.label = button.getAttribute('aria-label');
      button.classList.add('is-armed');
      row.classList.add('is-arming');
      button.setAttribute('aria-label', 'Press again to delete this track');
      armTimer = later(disarm, 3500);
      return;
    }
    clearTimeout(armTimer);
    timers.delete(armTimer);
    arming = null;
    const gone = tracks.find((t) => t.v === row.dataset.v);
    button.disabled = true;
    row.classList.add('is-leaving');
    if (gone) {
      lastDeleted = {
        ...gone,
        playlistIds: customPlaylists.filter((p) => p.tracks.includes(gone.v)).map((p) => p.id),
      };
    }
    const done = await edit('remove', { v: row.dataset.v });
    if (!done || done.error) {
      row.classList.remove('is-leaving', 'is-arming');
      button.classList.remove('is-armed');
      button.disabled = false;
      return;
    }
    if (done.undo) lastDeleted = done.undo;
    if (gone) toast(`Removed "${gone.t}". Press Ctrl+Z to undo.`);
  }
  on(document, 'pointerdown', (e) => {
    if (arming && !e.target.closest('.music-del')) disarm();
  }, true);

  /* ---- add a song ---------------------------------------------------------- */
  function openAdd() {
    closeBackups();
    addPanel.hidden = false;
    addBtn.setAttribute('aria-expanded', 'true');
    addUrl.value = '';
    addTitle.value = '';
    addArtist.value = '';
    addFound.hidden = true;
    addNote.textContent = 'Paste a music/video link or embed code.';
    delete addNote.dataset.tone;
    delete addPanel.dataset.v;
    addSave.disabled = true;
    lookSeq++;
    addUrl.focus();
  }
  function closeAdd() {
    addPanel.hidden = true;
    addBtn.setAttribute('aria-expanded', 'false');
    lookSeq++;
  }
  function syncSave() {
    addSave.disabled = !(addPanel.dataset.v && addTitle.value.trim() && addArtist.value.trim());
  }
  async function lookup() {
    const value = addUrl.value.trim();
    const seq = ++lookSeq;
    delete addPanel.dataset.v;
    addFound.hidden = true;
    addSave.disabled = true;
    delete addNote.dataset.tone;
    if (!value) { addNote.textContent = 'Paste a music/video link or embed code.'; return; }
    addNote.textContent = 'Looking it up...';
    const data = await edit('lookup', { url: value }, { quiet: true });
    if (seq !== lookSeq || !data) return;
    if (data.error) {
      addNote.textContent = `${capital(data.error)}.`;
      addNote.dataset.tone = 'bad';
      return;
    }
    if (data.already) {
      addNote.textContent = 'That one is already in the playlist.';
      addNote.dataset.tone = 'bad';
      return;
    }
    addPanel.dataset.v = data.v;
    addThumb.hidden = data.p !== 'YouTube';
    if (!addThumb.hidden) addThumb.src = `https://i.ytimg.com/vi/${data.v}/mqdefault.jpg`;
    else addThumb.removeAttribute('src');
    addTitle.value = data.t || '';
    addArtist.value = data.a || '';
    addFound.hidden = false;
    addNote.textContent = data.p === 'Audio'
      ? 'Direct audio file, enter the title and artist. Playback uses the player controls.'
      : data.p !== 'YouTube'
        ? `${data.p} embed, enter the title and artist. Playback uses its own controls, and availability depends on the provider.`
        : data.t ? 'Check the title and artist, then add it.' : 'No title came back, type one in.';
    syncSave();
    (data.t ? addSave : addTitle).focus();
  }
  async function submitAdd(event) {
    event.preventDefault();
    if (addSave.disabled) return;
    addSave.disabled = true;
    addNote.textContent = 'Adding...';
    delete addNote.dataset.tone;
    const v = addPanel.dataset.v;
    const t = addTitle.value.trim();
    const a = addArtist.value.trim();
    const destination = view;
    const data = await edit('add', {
      url: v, t, a,
      repeat: destination === 'repeat',
      ...(destination.startsWith('pl:') ? { playlistId: destination.slice(3) } : {}),
    }, { quiet: true });
    if (!data) return;
    if (data.error) {
      addNote.textContent = `${capital(data.error)}.`;
      addNote.dataset.tone = 'bad';
      syncSave();
      return;
    }
    closeAdd();
    toast(`Added "${t}" by ${a}.`);
    const row = rowsEl.querySelector(`.music-row[data-v="${CSS.escape(v)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
      row.classList.add('is-new');
      later(() => row.classList.remove('is-new'), 2400);
    }
  }
  on(addBtn, 'click', () => { if (addPanel.hidden) openAdd(); else closeAdd(); });
  on(addCancel, 'click', closeAdd);
  on(addUrl, 'input', () => {
    clearTimeout(lookTimer);
    timers.delete(lookTimer);
    lookTimer = later(lookup, 350);
  });
  on(addTitle, 'input', syncSave);
  on(addArtist, 'input', syncSave);
  on(addPanel, 'submit', submitAdd);

  /* ---- backups and the text download ---------------------------------------- */
  function closeBackups() {
    backupsPanel.hidden = true;
    backupsBtn.setAttribute('aria-expanded', 'false');
  }
  async function openBackups() {
    closeAdd();
    backupsPanel.hidden = false;
    backupsBtn.setAttribute('aria-expanded', 'true');
    backupsList.replaceChildren(Object.assign(el('li', 'music-bk-empty'), { textContent: 'Loading...' }));
    const data = await edit('backups', {}, { quiet: true });
    if (!data || data.error) {
      backupsList.replaceChildren(Object.assign(el('li', 'music-bk-empty'),
        { textContent: data ? `${capital(data.error)}.` : '' }));
      return;
    }
    const kindLabels = { hourly: '1 hour backup', daily: '1 day backup', weekly: '1 week backup' };
    const rows = (data.backups || []).map((b) => {
      const li = el('li');
      const when = el('span', 'music-bk-when');
      const d = new Date(b.label);
      when.textContent = Number.isFinite(d.getTime())
        ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        : b.label;
      const kind = el('span', 'music-bk-kind', kindLabels[b.kind] || b.kind);
      const count = el('span', 'music-bk-count', `${b.count} tracks`);
      const restore = el('button', 'music-bk-restore', 'Restore');
      restore.type = 'button';
      on(restore, 'click', async () => {
        if (!restore.classList.contains('is-armed')) {
          for (const other of backupsList.querySelectorAll('.music-bk-restore.is-armed')) {
            other.classList.remove('is-armed');
            other.textContent = 'Restore';
          }
          restore.classList.add('is-armed');
          restore.textContent = 'Replace list?';
          later(() => { restore.classList.remove('is-armed'); restore.textContent = 'Restore'; }, 3500);
          return;
        }
        restore.disabled = true;
        const done = await edit('restore', { name: b.name });
        if (done && !done.error) {
          toast(`Restored, ${done.count} tracks. The list it replaced is backed up too.`);
          openBackups();
        } else {
          restore.disabled = false;
        }
      });
      li.append(when, kind, count, restore);
      return li;
    });
    backupsList.replaceChildren(...(rows.length ? rows : [Object.assign(el('li', 'music-bk-empty'),
      { textContent: 'No backups yet, the first edit makes one.' })]));
  }
  on(backupsBtn, 'click', () => { if (backupsPanel.hidden) openBackups(); else closeBackups(); });
  function downloadList() {
    const lines = tracks.map((t) => `${t.t}|${t.a}|${t.u}${t.r ? '|R' : ''}`);
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain' });
    const link = el('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tracklist-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    later(() => URL.revokeObjectURL(link.href), 4000);
  }
  on(downloadBtn, 'click', downloadList);
  for (const panel of [addPanel, backupsPanel]) {
    on(panel, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (panel === addPanel) { closeAdd(); addBtn.focus(); }
      else { closeBackups(); backupsBtn.focus(); }
    });
  }

  /* ---- keyboard and remote events --------------------------------------------
     Space toggles once music has started, even when focus sits on a button,
     and never inside a text field, matching the overlay rule. Arrows are
     Previous and Next, refused in text fields, sliders and other controls,
     and while a foreign dialog is open. Both only act while this tab is the
     visible panel, and key repeat never strobes or walks the list. */
  const KEY_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const KEY_CONTROL = 'button, a[href], summary, audio[controls], video[controls],'
    + ' [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"],'
    + ' [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"],'
    + ' [role="option"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="textbox"]';
  const foreignDialogOpen = () => [...document.querySelectorAll('dialog[open]')]
    .some((d) => !root.contains(d));
  on(document, 'keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      if (!admin || !rootVisible() || !lastDeleted) return;
      const tag = (event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target.isContentEditable) return;
      event.preventDefault();
      const snapshot = lastDeleted;
      lastDeleted = null;
      const { t, a, r, playlistIds } = snapshot;
      edit('add', {
        url: snapshot.v, t, a, repeat: !!r, playlistIds: playlistIds || [],
      }, { quiet: true }).then((data) => {
        if (data && !data.error) toast(`Restored "${t}".`);
        else if (data?.error) toast(`Could not restore: ${data.error}.`);
      });
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(KEY_FIELD)) return;
      if (!rootVisible() || foreignDialogOpen()) return;
      if (index < 0 && !armed) return;
      event.preventDefault();
      if (event.repeat) return;
      btnToggle.click();
      return;
    }
    const isBack = event.key === 'ArrowLeft';
    if (!isBack && event.key !== 'ArrowRight') return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented) return;
    if (!rootVisible() || foreignDialogOpen() || playlistPicker) return;
    const focused = document.activeElement;
    if (focused instanceof Element && (focused.closest(KEY_FIELD) || focused.closest(KEY_CONTROL))) return;
    if (index < 0 && !armed) return;
    event.preventDefault();
    if (event.repeat) return;
    if (isBack) btnPrev.click();
    else btnNext.click();
  });
  const REMOTE_ACTIONS = { 'music:remote-next': 'next', 'music:remote-prev': 'prev', 'music:remote-toggle': 'toggle' };
  for (const name of Object.keys(REMOTE_ACTIONS)) {
    on(document, name, () => {
      if (destroyed || (index < 0 && !armed)) return;
      const action = REMOTE_ACTIONS[name];
      if (action === 'next') btnNext.click();
      else if (action === 'prev') btnPrev.click();
      else btnToggle.click();
    });
  }

  /* ---- opening and teardown -------------------------------------------------- */
  async function fetchTracks() {
    countEl.textContent = 'LOADING';
    try {
      const data = await pullList();
      const list = Array.isArray(data && data.tracks) ? data.tracks : [];
      if (!list.length) throw new Error('the manifest is empty');
      tracks = list.filter((t) => t && t.v && t.t && t.u);
      adoptPlaylists(data);
      if (!tracks.length) throw new Error('no usable rows in the manifest');
      loaded = true;
      await migrateLegacyPlaylists();
      seedTicks();
      loadFlags();
      return true;
    } catch (error) {
      console.warn('board music: could not load the track list', error);
      countEl.textContent = 'UNAVAILABLE';
      emptyEl.hidden = false;
      emptyEl.textContent = 'The track list could not be loaded.';
      return false;
    }
  }

  const readyPromise = (async () => {
    if (!globalThis.MusicEmbeds) {
      try { await import('/lib/music-embeds.js'); } catch { /* parser stays unavailable */ }
    }
    let storedShuffle = null;
    try { storedShuffle = localStorage.getItem(SHUFFLE_KEY); } catch { /* private mode */ }
    if (storedShuffle !== null) shuffle = storedShuffle === '1';
    paintShuffle();
    let storedLoop = null;
    try { storedLoop = localStorage.getItem(LOOP_KEY); } catch { /* private mode */ }
    if (LOOPS.includes(storedLoop)) loop = storedLoop;
    paintLoop();
    let storedVolume = null;
    try { storedVolume = localStorage.getItem(VOLUME_KEY); } catch { /* private mode */ }
    const parsedVolume = storedVolume === null ? 0.4 : parseFloat(storedVolume);
    const startVolume = Number.isFinite(parsedVolume) ? Math.min(1, Math.max(0, parsedVolume)) : 0.4;
    lastVolume = startVolume || 0.4;
    syncVolumeButton();
    applyVolume(startVolume, false);
    /* The shell only loads this module after the owner gate, so the TUNES
       unlock exchange runs on mount, exactly as the overlay runs it on open. */
    unlock();
    if (!(await fetchTracks())) return;
    if (destroyed) return;
    render();
    startSync();
    syncNow();
    if (index < 0 && queue.length) startFresh();
    else if (index < 0) idle();
  })();

  function destroy() {
    destroyed = true;
    stop();
    stopSync();
    for (const id of timers) clearTimeout(id);
    timers.clear();
    clearTimeout(watchdog);
    clearInterval(syncTimer);
    if (mediaAbort) mediaAbort.abort();
    if (playlistPicker) {
      try { playlistPicker.close(); } catch { /* already closed */ }
      playlistPicker.remove();
      playlistPicker = null;
    }
    if (confirmDialog) {
      try { confirmDialog.close(); } catch { /* already closed */ }
      confirmDialog.remove();
      confirmDialog = null;
    }
    holdSession(false);
    if (holdEl) {
      try { URL.revokeObjectURL(holdEl.src); } catch { /* nothing to revoke */ }
      holdEl = null;
    }
    if (sessionInstalled && 'mediaSession' in navigator) {
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack']) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported */ }
      }
      try { navigator.mediaSession.metadata = null; } catch { /* older engines */ }
    }
    document.documentElement.classList.remove('music-live');
    document.documentElement.classList.remove('music-fullscreen');
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch { /* already gone */ }
    }
    root.remove();
  }

  return { ready: readyPromise, destroy };
}
