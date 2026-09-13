/* Drive the CHESS table: the rules, the server, and two browsers playing.
 *
 *   node tools/chess_check.mjs           # starts its own server, needs nothing
 *
 * THREE LAYERS, and each one can be wrong on its own.
 *
 * 1. THE RULES, by PERFT. Count every leaf node at a fixed depth from six
 *    published positions and compare with the numbers the chess programming
 *    world settled decades ago. It is the one test a nearly-right move
 *    generator cannot pass: castling through check, en passant that exposes a
 *    king, a promotion that gives mate and a hundred other corners all change
 *    the count. A generator that is 99% right is off by thousands.
 *
 * 2. THE SERVER, over HTTP against the real handler. Who holds a seat, whose
 *    turn it is, and what happens to a move that is late, illegal or somebody
 *    else's. This is the half that has to be right when the other player is
 *    hostile rather than merely remote.
 *
 * 3. TWO BROWSERS, one board. Separate browser CONTEXTS, because two tabs
 *    share localStorage and would be the same player with the same id -- which
 *    is exactly the bug that would make this whole feature look like it works
 *    while never having been tested at all.
 *
 * A ROOM OF ITS OWN. The table lives under the dev server's --dir, so a
 * scratch directory IS an empty room: this starts its own server on its own
 * port and takes it down at the end. The first version drove whatever server
 * happened to be running, which meant sharing one room with every earlier run
 * -- and a player from the last run sits in that room for thirty seconds, so
 * every count was this run plus some leftovers, and the leftovers expired
 * while they were being counted.
 *
 * COUNT THE SUBJECT: every phase prints what it examined, and the perft table
 * asserts its own size. A run that generated no positions would otherwise
 * print six ticks and mean nothing.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { fromFen, perft, start, replay, toFen } from '../chess/rules.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 8500 + ((process.pid + Date.now()) % 400);
const BASE = process.env.CHESS_BASE || `http://127.0.0.1:${PORT}`;
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 1. the rules --------------------------------------------------------- */

const PERFT = [
  ['the opening position', null, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['a rook endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['promotions everywhere', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['a cramped middlegame', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['a quiet position', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
{
  note(PERFT.length === 6, `the perft table holds ${PERFT.length} positions, expected 6`);
  let nodes = 0;
  for (const [why, fen, want] of PERFT) {
    const s = fen ? fromFen(fen) : start();
    const got = want.map((_, i) => perft(s, i + 1));
    nodes += got.reduce((a, b) => a + b, 0);
    note(got.every((g, i) => g === want[i]),
         `perft "${why}" counted ${got.join('/')} where the published numbers are ${want.join('/')}`);
  }
  note(nodes > 500000, `perft only visited ${nodes} nodes — it cannot have run`);
  console.log(`rules: ${PERFT.length} positions, ${nodes.toLocaleString('en-US')} leaf nodes counted`);

  /* SAN and the round trip, which perft says nothing about: it counts moves,
     it does not care what they are called or whether a game replays. */
  const game = replay(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']);
  note(game.ok, 'the Ruy Lopez did not replay');
  note(game.sans.join(' ') === 'e4 e5 Nf3 Nc6 Bb5 a6',
       `the move list reads "${game.sans.join(' ')}"`);
  const fools = replay(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  note(fools.sans[3] === 'Qh4#', `mate in four is written "${fools.sans[3]}"`);
  /* CASTLING AND EN PASSANT through the whole pipeline: the FEN after them is
     the thing both sides have to agree on. */
  const castle = replay(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1']);
  note(castle.sans[6] === 'O-O', `castling is written "${castle.sans[6]}"`);
  note(toFen(castle.state).startsWith('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1'),
       `the position after castling is ${toFen(castle.state)}`);
  const ep = replay(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
  note(ep.ok && ep.sans[4] === 'exd6', `en passant is written "${ep.sans[4]}"`);
  note(ep.taken.length === 1, `en passant captured ${ep.taken.length} pieces, expected 1`);
  console.log(`notation: ${game.sans.join(' ')} · ${fools.sans.join(' ')} · castling and en passant hold`);
}

/* ---- 2. the server -------------------------------------------------------- */

const post = async (body) => {
  const res = await fetch(`${BASE}/api/chess/table`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
};
const player = (id, name, accent) => ({ id, name, accent });
const A = player('harnessAAAAAA', 'Ada', '#3d8bff');
const B = player('harnessBBBBBB', 'Bo', '#ff5f56');
const C = player('harnessCCCCCC', 'Cy', '#9ee02b');

/* The server, and the empty room that comes with a scratch directory. */
const scratch = mkdtempSync(join(tmpdir(), 'chess-check-'));
let server = null;
if (!process.env.CHESS_BASE) {
  server = spawn(process.execPath,
    [join(ROOT, 'tools/notes_dev_server.mjs'), '--port', String(PORT), '--dir', scratch],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => {
    const text = String(d);
    if (/EADDRINUSE|Error/.test(text)) console.error('dev server: ' + text.trim());
  });
}
const stop = () => {
  if (server && !server.killed) server.kill();
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* it is a temp dir */ }
};
process.on('exit', stop);

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try {
    const probe = await post({ action: 'sync', me: A });
    up = probe.status === 200;
  } catch { await sleep(250); }
}
if (!up) {
  console.error(`chess_check: the dev server never answered at ${BASE}`);
  stop();
  process.exit(1);
}
console.log(`table: a room of its own on ${PORT}`);

{
  /* The room starts empty, so these are absolute counts. Ada synced once to
     wake the server up, which is why the baseline is 1 and not 0 -- and
     asserting that is worth more than assuming it. */
  const base = (await post({ action: 'sync', me: A })).data.players;
  note(base === 1, `the room held ${base} players before the harness sat down, expected only Ada`);

  let r = await post({ action: 'sit', me: A, seat: 'w' });
  note(r.data.you.seat === 'w', `Ada asked for white and got "${r.data.you.seat}"`);
  note(r.data.seats.w.accent === '#3d8bff', `white's accent came back as "${r.data.seats.w && r.data.seats.w.accent}"`);

  r = await post({ action: 'sit', me: B, seat: 'any' });
  note(r.data.you.seat === 'b', `Bo took the only free seat and got "${r.data.you.seat}"`);
  note(r.data.players === 2, `${r.data.players} players at the table, expected 2`);

  /* THE THIRD PERSON WATCHES. "Anybody else who happens to be on my site" is
     the case this is about: the room counts them, the board does not seat
     them. */
  r = await post({ action: 'sit', me: C, seat: 'any' });
  note(r.data.you.seat === '', `Cy sat down in "${r.data.you.seat}" with both seats taken`);
  note(r.data.players === 3, `${r.data.players} players with a watcher, expected 3`);
  note(r.data.watching === 1, `${r.data.watching} watching, expected 1`);

  /* WHOSE MOVE IT IS. Black moving first, and a watcher moving at all, are the
     two things a client could simply decide to do. */
  r = await post({ action: 'move', me: B, uci: 'e7e5', ply: 0 });
  note(r.status === 409, `black moved first and the server said ${r.status}`);
  r = await post({ action: 'move', me: C, uci: 'e2e4', ply: 0 });
  note(r.status === 403, `a watcher moved and the server said ${r.status}`);

  r = await post({ action: 'move', me: A, uci: 'e2e4', ply: 0 });
  note(r.status === 200 && r.data.game.moves.length === 1, `1.e4 came back ${r.status}`);

  /* THE SAME MOVE AGAIN. A double click, a retry after a slow reply, a stale
     tab: all of them arrive as a move for a ply that has been played. */
  r = await post({ action: 'move', me: A, uci: 'e2e4', ply: 0 });
  note(r.status === 409, `the same move twice came back ${r.status}, expected a refusal`);

  r = await post({ action: 'move', me: B, uci: 'e7e9', ply: 1 });
  note(r.status === 400, `a move off the board came back ${r.status}`);
  r = await post({ action: 'move', me: B, uci: 'a8a5', ply: 1 });
  note(r.status === 400, `a rook through its own pawn came back ${r.status}`);

  r = await post({ action: 'move', me: B, uci: 'e7e5', ply: 1 });
  note(r.status === 200 && r.data.game.moves.join(' ') === 'e2e4 e7e5',
       `the move list is "${r.data.game.moves.join(' ')}"`);

  /* RESIGNING ENDS IT, and the loser is the one who resigned. */
  r = await post({ action: 'resign', me: B });
  note(r.data.game.result === '1-0' && r.data.game.reason === 'resigned',
       `black resigned and the result is ${r.data.game.result} (${r.data.game.reason})`);
  r = await post({ action: 'move', me: A, uci: 'g1f3', ply: 2 });
  note(r.status === 409, `a move after the game ended came back ${r.status}`);

  /* A REMATCH SWAPS THE COLOURS, which is the half people forget by hand. */
  r = await post({ action: 'rematch', me: A });
  note(r.data.you.seat === 'b', `Ada was white; after the rematch she is "${r.data.you.seat}"`);
  note(r.data.game.moves.length === 0 && !r.data.game.result, 'the rematch did not clear the board');
  console.log(`server: seats, turn order, ${'4'} refusals, resignation and a rematch that swaps colours`);

  /* FOOL'S MATE, END TO END. The server decides a game is over, and the only
     way to know it can is to play one out. Ada is black now. */
  const mate = [[B, 'f2f3'], [A, 'e7e5'], [B, 'g2g4'], [A, 'd8h4']];
  let ply = 0;
  for (const [who, uci] of mate) {
    r = await post({ action: 'move', me: who, uci, ply: ply++ });
    note(r.status === 200, `${uci} came back ${r.status} while playing out a mate`);
  }
  note(r.data.game.result === '0-1' && r.data.game.reason === 'checkmate',
       `the mate ended ${r.data.game.result} by "${r.data.game.reason}"`);
  console.log(`server: fool's mate played out, table says ${r.data.game.result} by ${r.data.game.reason}`);

  /* LEAVING, not standing: standing keeps you in the room, and the room has to
     be EMPTY for the next phase -- both to count from zero and because an
     empty room is what clears a finished game. */
  for (const who of [A, B, C]) {
    const bye = await post({ action: 'leave', me: who });
    note(bye.status === 200, `leaving came back ${bye.status}`);
  }
  const empty = await post({ action: 'sync', me: A });
  note(empty.data.players === 1, `${empty.data.players} left in the room after everyone left`);
  await post({ action: 'leave', me: A });
}

/* ---- 3. two browsers, one board ------------------------------------------- */

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 860 },
});

/* SEPARATE CONTEXTS, NOT TABS. Two tabs share localStorage, so they share the
   id the app makes for a visitor -- they would be one player holding one seat,
   and every assertion below would pass while proving nothing about two people
   at all. */
async function seat(accent, name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => fail.push(`pageerror (${name}): ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|401|403|409/.test(m.text())) fail.push(`console (${name}): ${m.text()}`);
  });
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((a, n) => {
    document.documentElement.style.setProperty('--accent', a);
    try { localStorage.setItem('chess-name', n); } catch { /* private mode */ }
  }, accent, name);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('chess:open', { detail: {} })));
  await page.waitForFunction(() => document.querySelectorAll('.ch-sq').length === 64, { timeout: 20000 });
  await sleep(900);
  return { context, page, name };
}

const look = (page) => page.evaluate(() => {
  const app = document.querySelector('.ch-app');
  const cs = getComputedStyle(app);
  return {
    room: Number(document.querySelector('.ch-room-n').textContent),
    seat: document.querySelector('.ch-seat.is-mine')?.dataset.seat || '',
    state: document.querySelector('.ch-state').textContent.trim(),
    flipped: app.classList.contains('is-flipped'),
    moves: [...document.querySelectorAll('.ch-san')].map((e) => e.textContent).filter(Boolean),
    w: cs.getPropertyValue('--w-piece').trim(),
    b: cs.getPropertyValue('--b-piece').trim(),
    pieces: document.querySelectorAll('.ch-pc:not([hidden])').length,
    dots: document.querySelectorAll('.ch-who-dot').length,
  };
});

/* A move, by pressing the two squares. Not by calling into the app: the whole
   question is whether a person can play, and "the app's function works" is a
   different question. */
async function press(page, square) {
  const box = await page.evaluate((sqName) => {
    const files = 'abcdefgh';
    const i = (8 - Number(sqName[1])) * 8 + files.indexOf(sqName[0]);
    const cell = document.querySelector(`.ch-sq[data-sq="${i}"]`);
    const r = cell.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, square);
  await page.mouse.click(box.x, box.y);
  await sleep(120);
}

try {
  /* EVERYONE FROM PHASE 2 IS GONE, which -- with a finished game on the board
     -- is what makes the store clear it. The browsers below have to arrive at
     a fresh position or every assertion about playing is an assertion about
     somebody else's checkmate. */
  const ready = (await post({ action: 'sync', me: A })).data;
  note(!ready.game.result && ready.game.moves.length === 0,
       `the table still holds a ${ready.game.result || 'part-played'} game before the browsers open`);
  /* LEAVE, not stand: standing keeps Ada in the room and the two browsers
     below count from zero. This line said `stand` first and the room was
     three. */
  await post({ action: 'leave', me: A });

  const one = await seat('#3d8bff', 'Blue');
  const two = await seat('#ff5f56', 'Red');
  await one.page.evaluate(() => document.dispatchEvent(new CustomEvent('chess:open', { detail: {} })));
  await sleep(1800);

  const a = await look(one.page);
  const b = await look(two.page);
  note(a.room === 2 && b.room === 2,
       `the room says ${a.room} and ${b.room} with exactly two browsers open`);
  note(a.dots === a.room, `${a.dots} dots for ${a.room} players`);
  note(a.seat && b.seat && a.seat !== b.seat,
       `two arrivals took "${a.seat}" and "${b.seat}" — they must be different sides`);
  note(a.pieces === 32 && b.pieces === 32, `${a.pieces} and ${b.pieces} pieces on the two boards`);
  /* THE BOARD IS THE OTHER WAY UP FOR BLACK, which is the one thing a player
     notices immediately and no assertion above would catch. */
  note((a.seat === 'b') === a.flipped && (b.seat === 'b') === b.flipped,
       'a black seat is not looking at a flipped board');

  /* EVERY PIECE IN THE PLAYERS' OWN COLOURS (Dex, 2026-09-13). Asked for by
     name, and the thing that makes this table his rather than a chess app:
     your pieces are YOUR accent and your opponent's are theirs, on both
     screens. */
  /* WHICH SEAT EACH TOOK IS A COIN TOSS -- that is the feature -- so the
     colours are asserted against the seats they landed in, not against a
     mapping this file decided in advance. */
  const accentOf = { '#3d8bff': a.seat, '#ff5f56': b.seat };
  note(accentOf[a.w] === 'w', `white is drawn ${a.w}, which belongs to the "${accentOf[a.w]}" seat`);
  note(accentOf[a.b] === 'b', `black is drawn ${a.b}, which belongs to the "${accentOf[a.b]}" seat`);
  note(a.w === b.w && a.b === b.b, 'the two screens disagree about which colour each side is');
  note(a.w !== a.b, 'both sides are drawn the same colour');
  console.log(`room: ${a.room} here, seats "${a.seat}"/"${b.seat}", pieces ${a.w} and ${a.b} on both screens`);

  const white = a.seat === 'w' ? one : two;
  const black = a.seat === 'w' ? two : one;

  /* A REAL MOVE, PRESSED, and seen on the other screen. This is the feature. */
  await press(white.page, 'e2');
  const lit = await white.page.evaluate(() => document.querySelectorAll('.ch-sq.is-to, .ch-sq.is-take').length);
  note(lit === 2, `pressing a pawn showed ${lit} destinations, expected 2`);
  await press(white.page, 'e4');
  await sleep(2600);

  const afterW = await look(white.page);
  const afterB = await look(black.page);
  note(afterW.moves[0] === 'e4', `white's own move list reads "${afterW.moves.join(' ')}"`);
  note(afterB.moves[0] === 'e4', `black saw "${afterB.moves.join(' ')}" — the move did not cross`);
  note(/their move/i.test(afterW.state), `white is told "${afterW.state}" after moving`);
  note(/your move/i.test(afterB.state), `black is told "${afterB.state}" when it is their move`);

  await press(black.page, 'e7');
  await press(black.page, 'e5');
  await sleep(2600);
  const back = await look(white.page);
  note(back.moves.join(' ') === 'e4 e5', `after both moves white sees "${back.moves.join(' ')}"`);
  console.log(`play: pressed e4 and e5 on two screens, both lists read "${back.moves.join(' ')}"`);

  /* A WATCHER CANNOT MOVE, from the screen rather than from the API. */
  const three = await seat('#9ee02b', 'Green');
  await sleep(1600);
  const w3 = await look(three.page);
  note(w3.seat === '', `the third arrival got seat "${w3.seat}" with both taken`);
  note(w3.room === 3, `the room says ${w3.room} with three browsers open`);
  await press(three.page, 'd2');
  const picked = await three.page.evaluate(() => document.querySelectorAll('.ch-sq.is-from').length);
  note(picked === 0, 'a watcher picked up a piece');
  console.log(`watching: ${w3.room} in the room, the third has no seat and cannot lift a piece`);

  await three.page.screenshot({ path: '.notes-dev/shots/chess-watch.png' });
  await white.page.screenshot({ path: '.notes-dev/shots/chess-white.png' });
  await black.page.screenshot({ path: '.notes-dev/shots/chess-black.png' });

  /* CLOSING THE OVERLAY GIVES UP THE SEAT, rather than holding it until a
     heartbeat times out while the next person is told the room is busy. */
  await black.page.evaluate(() => document.getElementById('chessClose').click());
  await sleep(2400);
  const freed = await white.page.evaluate(() =>
    document.querySelector('.ch-seat[data-seat="b"]').classList.contains('is-empty')
    || document.querySelector('.ch-seat[data-seat="w"]').classList.contains('is-empty'));
  note(freed, 'closing the overlay left the seat held');

  for (const s of [one, two, three]) await s.context.close();
} finally {
  await browser.close();
  stop();
}

console.log('');
if (fail.length) {
  console.log(`chess_check: ${fail.length} of ${pass + fail.length} FAILED`);
  for (const f of fail) console.log('  - ' + f);
  process.exit(1);
}
console.log(`chess_check: ${pass} checks passed`);
