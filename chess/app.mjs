/* The chess table, on screen.
 *
 * Mounted by initChess() in script.js on the first open, the way the notes
 * editor is: a dynamic import(), so a visitor who never types the code never
 * fetches any of this.
 *
 * WHAT THIS OWNS: the board, the room, and the poll. What it does NOT own is
 * the rules -- rules.mjs is the same module the server validates with -- or
 * the truth about the game, which is the move list the server holds. This
 * replays that list to get a position. There is no local board state to drift.
 *
 * THE PIECES ARE PAINTED IN THE PLAYERS' OWN ACCENTS (Dex, 2026-09-13). Your
 * pieces are the accent you picked for the site; your opponent's are the accent
 * THEY picked, which travels with them in the room. Two people on the same
 * colour, or a seat nobody is in, fall back to the classic white and black --
 * a board you cannot tell the sides apart on is not a board.
 */

import {
  FILES, colorOf, kindOf, index, name, legal, legalFrom, replay, status, toUci,
} from './rules.mjs';

const KIND = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const CLASSIC = { w: '#e9edf4', b: '#0e1218' };
const ID_KEY = 'chess-id';
const NAME_KEY = 'chess-name';

/* How often to ask the server what happened. Fast while a game is live and
 * somebody else is here, slow when you are alone at an empty board -- the poll
 * is the whole cost of this feature and an idle tab should not be paying it. */
const POLL_LIVE = 1400;
const POLL_IDLE = 5000;

let mounted = null;

export async function mount(host, opts = {}) {
  if (mounted) mounted.destroy();
  await css();
  const ui = build(host);
  const me = {
    id: readId(),
    name: opts.name || read(NAME_KEY) || '',
    accent: accentHex(),
  };
  if (!me.name) { me.name = 'Guest'; }

  let table = null;          // what the server last said
  let view = { from: null, targets: [], promo: null };
  let game = replay([]);     // the position, replayed from table.game.moves
  let timer = 0;
  let busy = false;
  let gone = false;
  let offline = false;

  /* ---- talking to the table -------------------------------------------- */

  async function post(action, extra = {}) {
    if (gone) return null;
    me.accent = accentHex();
    const body = JSON.stringify({ action, me, ...extra });
    let res;
    try {
      res = await fetch('/api/chess/table', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      });
    } catch {
      offline = true; paint();
      return null;
    }
    let data = null;
    try { data = await res.json(); } catch { /* a 502 with no body */ }
    offline = !res.ok && !(data && data.rev !== undefined);
    if (data && data.rev !== undefined) {
      const fresh = !table || data.rev !== table.rev
        || data.game.moves.length !== table.game.moves.length;
      table = data;
      if (fresh) game = replay(table.game.moves);
      paint();
    } else if (data && data.error) {
      say(data.error);
      paint();
    }
    return data;
  }

  const sync = () => post('sync');

  function schedule() {
    clearTimeout(timer);
    if (gone) return;
    const live = table && (table.players > 1 || table.you.seat);
    timer = setTimeout(tick, live ? POLL_LIVE : POLL_IDLE);
  }
  async function tick() {
    /* A HIDDEN TAB DOES NOT POLL. It is nobody's game while nobody is looking
       at it, and the seat is released by the same silence that releases it
       when the window is closed. */
    if (!document.hidden && !busy) await sync();
    schedule();
  }

  /* ---- acting ----------------------------------------------------------- */

  async function send(action, extra) {
    if (busy) return;
    busy = true;
    try { await post(action, extra); } finally { busy = false; schedule(); }
  }

  async function play(m) {
    /* OPTIMISTIC, and only about the board. The move is drawn immediately --
       a click that does nothing for 200ms reads as a dead board -- but the
       move list the server holds is still the truth: if it refuses, the next
       reply replaces this position with the real one. */
    const ply = table ? table.game.moves.length : 0;
    game = replay([...(table ? table.game.moves : []), toUci(m)]);
    view = { from: null, targets: [], promo: null };
    paint();
    await send('move', { uci: toUci(m), ply });
  }

  /* ---- who is what colour ------------------------------------------------
     The rule, in one place because it is asked three times: a seat is drawn in
     the accent of whoever is sitting in it, and falls back to classic white or
     black when nobody is, when they have no accent, or when the two accents
     are the same and the board would stop having two sides. */
  function colors() {
    const w = table && table.seats.w && table.seats.w.accent;
    const b = table && table.seats.b && table.seats.b.accent;
    const clash = w && b && w.toLowerCase() === b.toLowerCase();
    const mine = table && table.you.seat;
    if (clash) {
      // Whoever is looking keeps their own colour; the other side goes classic.
      return {
        w: mine === 'b' ? CLASSIC.w : w,
        b: mine === 'b' ? b : CLASSIC.b,
      };
    }
    return { w: w || CLASSIC.w, b: b || CLASSIC.b };
  }

  /* ---- painting ---------------------------------------------------------- */

  function paint() {
    const seat = table ? table.you.seat : '';
    const flip = seat === 'b';
    const paintCols = colors();
    ui.root.style.setProperty('--w-piece', paintCols.w);
    ui.root.style.setProperty('--b-piece', paintCols.b);
    /* The rim is decided by the piece, not by the square: a mask cannot carry
       a stroke, so the edge is a drop-shadow, and a dark halo on a dark piece
       is no edge at all. */
    ui.root.style.setProperty('--w-rim', rim(paintCols.w));
    ui.root.style.setProperty('--b-rim', rim(paintCols.b));
    ui.root.classList.toggle('is-flipped', flip);

    const s = game.state;
    const end = table && table.game.result
      ? { over: true, kind: table.game.reason }
      : status(s, game.history);
    const myTurn = !!seat && !end.over && s.turn === seat;
    ui.root.classList.toggle('is-my-turn', myTurn);

    // --- the squares
    for (let i = 0; i < 64; i++) {
      const cell = ui.cells[i];
      const piece = s.board[i];
      cell.className = 'ch-sq'
        + ((((i % 8) + ((i / 8) | 0)) % 2) ? ' is-dark' : ' is-light')
        + (view.from === i ? ' is-from' : '')
        + (view.targets.includes(i) ? (piece ? ' is-take' : ' is-to') : '')
        + (lastMoveHas(i) ? ' is-last' : '')
        + (end.over && end.kind === 'checkmate' && piece === (s.turn === 'w' ? 'K' : 'k') ? ' is-mate' : '');
      cell.setAttribute('aria-label', piece
        ? `${name(i)}, ${colorOf(piece) === 'w' ? 'white' : 'black'} ${KIND[kindOf(piece)]}`
        : name(i));
      const mark = cell.firstChild;
      if (piece) {
        mark.hidden = false;
        mark.dataset.icon = `chess-${KIND[kindOf(piece)]}`;
        mark.className = `ch-pc is-${colorOf(piece)}`;
      } else {
        mark.hidden = true;
        mark.removeAttribute('data-icon');
      }
    }

    // --- the room
    const n = table ? table.players : 1;
    ui.count.textContent = String(n);
    ui.countWord.textContent = n === 1 ? 'player here' : 'players here';
    ui.who.replaceChildren(...(table ? table.names : []).map((p) => {
      const dot = document.createElement('span');
      dot.className = 'ch-who-dot';
      dot.style.background = p.accent || 'var(--muted)';
      dot.title = p.name;
      return dot;
    }));

    // --- the two seats
    for (const side of ['w', 'b']) {
      const box = ui.seat[side];
      const who = table && table.seats[side];
      box.classList.toggle('is-mine', seat === side);
      box.classList.toggle('is-empty', !who);
      box.classList.toggle('is-turn', !end.over && s.turn === side && !!who);
      box.querySelector('.ch-seat-name').textContent = who ? who.name : 'Open seat';
      box.querySelector('.ch-seat-role').textContent =
        seat === side ? 'you' : side === 'w' ? 'white' : 'black';
      box.querySelector('.ch-seat-dot').style.background = `var(--${side}-piece)`;
      const take = box.querySelector('.ch-sit');
      take.hidden = !!who || !!seat;
      take.textContent = `Sit as ${side === 'w' ? 'white' : 'black'}`;
    }

    // --- the moves
    const rows = [];
    for (let i = 0; i < game.sans.length; i += 2) {
      const row = document.createElement('li');
      row.innerHTML = '<span class="ch-no"></span><span class="ch-san"></span><span class="ch-san"></span>';
      row.querySelector('.ch-no').textContent = `${i / 2 + 1}.`;
      const cells = row.querySelectorAll('.ch-san');
      cells[0].textContent = game.sans[i] || '';
      cells[1].textContent = game.sans[i + 1] || '';
      if (i + 2 >= game.sans.length) row.classList.add('is-last');
      rows.push(row);
    }
    ui.moves.replaceChildren(...rows);
    if (rows.length) ui.moves.lastElementChild.scrollIntoView({ block: 'nearest' });
    ui.taken.textContent = game.taken.length ? game.taken.map((p) => KIND[kindOf(p)][0].toUpperCase()).join(' ') : '';

    // --- what to say
    ui.state.className = 'ch-state' + (end.over ? ' is-over' : myTurn ? ' is-you' : '');
    ui.state.textContent = offline ? 'Cannot reach the table'
      : end.over ? endText(end, table)
      : !seat ? (table && (table.seats.w && table.seats.b) ? 'Watching' : 'Take a seat')
      : myTurn ? 'Your move'
      : table && table.seats[s.turn === 'w' ? 'w' : 'b'] ? 'Their move'
      : 'Waiting for an opponent';
    ui.check.hidden = end.over || end.kind !== 'check';

    /* THE SEAT BUTTON GOES WHEN YOU HAVE ONE, and when there is none to take.
       A "Take a seat" button on a full table is a button that does nothing. */
    ui.join.hidden = !!seat || !!(table && table.seats.w && table.seats.b);
    ui.resign.hidden = !seat || end.over || !game.sans.length;
    ui.stand.hidden = !seat;
    ui.rematch.hidden = !seat || !end.over;
  }

  const lastMoveHas = (i) => {
    const moves = table ? table.game.moves : [];
    if (!moves.length) return false;
    const last = moves[moves.length - 1];
    return i === index(last.slice(0, 2)) || i === index(last.slice(2, 4));
  };

  function endText(end, t) {
    const r = t && t.game.result;
    const reason = (t && t.game.reason) || end.kind;
    if (reason === 'resigned') return `${r === '1-0' ? 'White' : 'Black'} wins — resignation`;
    if (reason === 'checkmate') return `${r === '1-0' ? 'White' : 'Black'} wins — checkmate`;
    if (reason === 'stalemate') return 'Draw — stalemate';
    if (reason === 'fifty') return 'Draw — fifty moves';
    if (reason === 'repetition') return 'Draw — repetition';
    if (reason === 'material') return 'Draw — not enough pieces';
    return 'Game over';
  }

  function say(text) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(say.t);
    say.t = setTimeout(() => { ui.toast.hidden = true; }, 2600);
  }

  /* ---- pressing a square -------------------------------------------------- */

  function onSquare(i) {
    const seat = table ? table.you.seat : '';
    if (!seat || (table && table.game.result)) return;
    const s = game.state;
    if (s.turn !== seat) return;

    if (view.from !== null && view.targets.includes(i)) {
      const options = legal(s).filter((m) => m.from === view.from && m.to === i);
      if (options.length > 1 && options[0].promo) { askPromo(options); return; }
      play(options[0]);
      return;
    }
    const piece = s.board[i];
    if (piece && colorOf(piece) === seat) {
      view = { from: i, targets: legalFrom(s, i).map((m) => m.to), promo: null };
    } else {
      view = { from: null, targets: [], promo: null };
    }
    paint();
  }

  function askPromo(options) {
    ui.promo.replaceChildren(...options.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-promo-pick';
      b.innerHTML = `<span class="ch-pc is-${game.state.turn}" data-icon="chess-${KIND[m.promo]}"></span>`;
      b.setAttribute('aria-label', KIND[m.promo]);
      b.addEventListener('click', () => { ui.promo.hidden = true; play(m); });
      return b;
    }));
    ui.promo.hidden = false;
  }

  /* ---- wiring ------------------------------------------------------------ */

  ui.cells.forEach((cell, i) => cell.addEventListener('click', () => onSquare(i)));
  ui.seat.w.querySelector('.ch-sit').addEventListener('click', () => send('sit', { seat: 'w' }));
  ui.seat.b.querySelector('.ch-sit').addEventListener('click', () => send('sit', { seat: 'b' }));
  ui.join.addEventListener('click', () => send('sit', { seat: 'any' }));
  ui.stand.addEventListener('click', () => send('stand'));
  ui.resign.addEventListener('click', () => send('resign'));
  ui.rematch.addEventListener('click', () => send('rematch'));
  ui.nameField.value = me.name;
  ui.nameField.addEventListener('change', () => {
    me.name = ui.nameField.value.trim().slice(0, 24) || 'Guest';
    ui.nameField.value = me.name;
    write(NAME_KEY, me.name);
    send('sync');
  });
  const wake = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
  document.addEventListener('visibilitychange', wake);

  paint();
  await sync();
  /* A SEAT ON ARRIVAL, and a random one. "Anybody else who happens to be on my
     site and enters it will be a random colour" -- so joining takes whichever
     side is free rather than asking, and only lands you as a watcher when both
     are taken. */
  if (table && !table.you.seat && !(table.seats.w && table.seats.b)) await send('sit', { seat: 'any' });
  schedule();

  mounted = {
    destroy() {
      gone = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      /* LEAVING THE TABLE IS SAYING SO -- and `leave`, not `stand`: closing the
         window takes you out of the ROOM, so the count in the corner is right
         immediately rather than thirty seconds later when the heartbeat
         lapses. sendBeacon because the page may be going away as this goes
         out, with a plain fetch behind it for anything that does not have it. */
      const bye = JSON.stringify({ action: 'leave', me });
      try {
        const sent = navigator.sendBeacon?.('/api/chess/table',
          new Blob([bye], { type: 'application/json' }));
        if (!sent) {
          fetch('/api/chess/table', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: bye, keepalive: true,
          }).catch(() => { /* on the way out; nothing to report to */ });
        }
      } catch { /* a browser that will not send it is not a reason to throw */ }
      host.replaceChildren();
      mounted = null;
    },
    sync,
  };
  return mounted;
}

/* The stylesheet comes with the app rather than with the page: nothing here
 * is on a visitor's first load, and one <link> is cheaper than parsing it into
 * the site's own sheet where it would ship to everyone. */
function css() {
  return new Promise((done) => {
    if (document.querySelector('link[data-chess-css]')) { done(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/chess/chess.css?v=1';
    link.dataset.chessCss = '1';
    link.addEventListener('load', done, { once: true });
    // A stylesheet that will not load is not a reason to show nothing.
    link.addEventListener('error', done, { once: true });
    document.head.append(link);
  });
}

/* ---- the shell ------------------------------------------------------------ */

function build(host) {
  host.replaceChildren();
  const root = document.createElement('div');
  root.className = 'ch-app';
  root.innerHTML = `
    <div class="ch-top">
      <p class="ch-room" title="Everyone with the board open">
        <span class="ch-room-n"></span>
        <span class="ch-room-word"></span>
        <span class="ch-who"></span>
      </p>
      <div class="ch-top-gap"></div>
      <label class="ch-name">
        <span class="sr-only">Your name at the table</span>
        <input type="text" maxlength="24" autocomplete="off" spellcheck="false" placeholder="Your name">
      </label>
    </div>
    <div class="ch-body">
      <div class="ch-board-wrap">
        <div class="ch-board" role="grid" aria-label="Chess board"></div>
        <div class="ch-promo" hidden></div>
      </div>
      <aside class="ch-side">
        <div class="ch-seat" data-seat="b">
          <span class="ch-seat-dot"></span>
          <span class="ch-seat-who"><b class="ch-seat-name"></b><span class="ch-seat-role"></span></span>
          <button type="button" class="ch-sit" hidden></button>
        </div>
        <p class="ch-state"></p>
        <p class="ch-check" hidden>CHECK</p>
        <ol class="ch-moves"></ol>
        <p class="ch-taken"></p>
        <div class="ch-seat" data-seat="w">
          <span class="ch-seat-dot"></span>
          <span class="ch-seat-who"><b class="ch-seat-name"></b><span class="ch-seat-role"></span></span>
          <button type="button" class="ch-sit" hidden></button>
        </div>
        <div class="ch-acts">
          <button type="button" class="ch-btn ch-join">Take a seat</button>
          <button type="button" class="ch-btn ch-stand" hidden>Leave the seat</button>
          <button type="button" class="ch-btn ch-resign" hidden>Resign</button>
          <button type="button" class="ch-btn is-primary ch-rematch" hidden>Rematch</button>
        </div>
      </aside>
    </div>
    <p class="ch-toast" role="status" hidden></p>`;

  const board = root.querySelector('.ch-board');
  const cells = [];
  for (let i = 0; i < 64; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'ch-sq';
    cell.dataset.sq = String(i);
    const mark = document.createElement('span');
    mark.className = 'ch-pc';
    mark.hidden = true;
    cell.append(mark);
    board.append(cell);
    cells.push(cell);
  }
  /* The coordinates, as two strips rather than 64 labels: a letter under each
     file and a number beside each rank, drawn outside the board so nothing
     sits on a square. */
  const files = document.createElement('div');
  files.className = 'ch-files';
  files.innerHTML = [...FILES].map((f) => `<span>${f}</span>`).join('');
  const ranks = document.createElement('div');
  ranks.className = 'ch-ranks';
  ranks.innerHTML = [8, 7, 6, 5, 4, 3, 2, 1].map((r) => `<span>${r}</span>`).join('');
  root.querySelector('.ch-board-wrap').append(files, ranks);

  host.append(root);
  return {
    root, cells,
    count: root.querySelector('.ch-room-n'),
    countWord: root.querySelector('.ch-room-word'),
    who: root.querySelector('.ch-who'),
    moves: root.querySelector('.ch-moves'),
    taken: root.querySelector('.ch-taken'),
    state: root.querySelector('.ch-state'),
    check: root.querySelector('.ch-check'),
    promo: root.querySelector('.ch-promo'),
    toast: root.querySelector('.ch-toast'),
    nameField: root.querySelector('.ch-name input'),
    join: root.querySelector('.ch-join'),
    stand: root.querySelector('.ch-stand'),
    resign: root.querySelector('.ch-resign'),
    rematch: root.querySelector('.ch-rematch'),
    seat: {
      w: root.querySelector('.ch-seat[data-seat="w"]'),
      b: root.querySelector('.ch-seat[data-seat="b"]'),
    },
  };
}

/* ---- odds and ends -------------------------------------------------------- */

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/* WHO YOU ARE IS A RANDOM STRING, kept in this browser. It is not a login and
 * is not meant to be one: it is what makes "the same person" mean something
 * across a reload, so a refresh keeps your seat instead of taking a second
 * one. */
function readId() {
  let id = read(ID_KEY);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id || '')) {
    const bytes = new Uint8Array(12);
    (globalThis.crypto || {}).getRandomValues?.(bytes);
    id = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)
      || `g${Date.now().toString(36)}`;
    write(ID_KEY, id);
  }
  return id;
}

/* Light pieces get a dark edge and dark pieces get a light one. sRGB
 * luminance with the usual coefficients -- the eye is far more sensitive to
 * green than to blue and an average of the three channels calls a saturated
 * blue "light". */
function rim(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 'rgba(0,0,0,.55)';
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.5)';
}

/* The accent as a hex string, whatever the visitor has the site set to. It is
 * read off the live custom property rather than from the theme table, so a
 * colour added to that table later needs no change here. */
function accentHex() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  const m = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return '';
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}
