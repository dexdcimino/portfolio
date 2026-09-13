/* The chess table: one small JSON document that every player reads and writes.
 *
 * WHY A BLOB AND NOT A SOCKET. Vercel's functions are serverless and there is
 * no server here to hold a connection open, so "live" is polling -- which is
 * fine for a game where the state changes twice a minute. The whole table is
 * under 2 KB, so a poll is one small read and a move is one small write.
 *
 * WHAT IS STORED, AND WHAT IS NOT. `game.moves` is a list of UCI strings and
 * nothing else: no board, no FEN, no turn. The position is what you get by
 * replaying the moves through chess/rules.mjs, which BOTH SIDES do with the
 * same module -- so there is no board state to disagree about, and a client
 * that has fallen behind catches up by replaying rather than by being told.
 *
 * THE REVISION COUNTER is the same idea as the notes store's: every write
 * carries the rev it was built on and a stale write is refused rather than
 * applied. Two people pressing a piece in the same second is the normal case
 * here, not the rare one.
 *
 * THIS IS NOT A SECRET. The overlay is behind a vault code, but the code is
 * client-side (it decrypts a blob that ships in the page) and this route is
 * open to anyone who finds it. That is the right call for a chess lobby --
 * there is nothing in it to leak -- but it means the limits below are the only
 * thing between the table and someone's script: a cap on the players, a cap on
 * the name, a cap on the moves, and a table that is thrown away when it is
 * old. Nothing here is worth defending harder than that.
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const KEY = 'chess/table.json';

/* How long a player stays in the lobby after their last sync. Long enough to
 * ride out a slow poll or a tab that was backgrounded for a moment; short
 * enough that a closed window frees its seat while the other player is still
 * looking at the board. */
const SEEN_MS = 30 * 1000;
/* An abandoned game is cleared rather than kept forever: if nobody has been
 * at the table for this long, the next arrival gets a fresh board. */
const STALE_MS = 6 * 60 * 60 * 1000;

const MAX_PLAYERS = 24;
const MAX_NAME = 24;
const MAX_MOVES = 600;          // 300 moves a side is longer than any real game

/* ---- where the bytes go --------------------------------------------------
 * The same arrangement lib/notes-store.js uses, and for the same reason: the
 * dev server points this at a directory so the whole thing can be driven on
 * this machine, and production refuses that backend outright -- a serverless
 * filesystem is ephemeral and would lose the game on the next cold start. */
function devDir() {
  const dir = process.env.NOTES_DEV_DIR;
  if (!dir) return null;
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('NOTES_DEV_DIR is set in production. Refusing to keep the chess table on an ephemeral disk.');
  }
  return dir;
}

function configError() {
  if (!devDir() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return 'BLOB_READ_WRITE_TOKEN is not set. Connect a Vercel Blob store to this project.';
  }
  return null;
}

const local = {
  async read() {
    try {
      return await fs.readFile(path.join(devDir(), KEY), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async write(body) {
    const file = path.join(devDir(), KEY);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  },
};

const blobBackend = {
  async read() {
    const { get } = require('@vercel/blob');
    let found;
    try {
      /* useCache:false for the same reason the notes store does it: the whole
         point is that the other player's move is visible, and the CDN edge
         would happily serve the board from before it. */
      found = await get(KEY, { access: 'private', useCache: false });
    } catch (err) {
      if (err && (err.name === 'BlobNotFoundError' || /not.?found/i.test(err.message || ''))) return null;
      throw err;
    }
    if (!found) return null;
    if (!found.stream) throw new Error(`blob ${KEY} returned statusCode ${found.statusCode} with no stream`);
    return await new Response(found.stream).text();
  },
  async write(body) {
    const { put } = require('@vercel/blob');
    await put(KEY, body, {
      access: 'private',
      contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  },
};

const backend = () => (devDir() ? local : blobBackend);

/* ---- the table ----------------------------------------------------------- */

const emptyGame = (now) => ({ moves: [], startedAt: now, result: null, reason: '', by: '' });

const emptyTable = (now) => ({
  rev: 0,
  updated: now,
  seats: { w: null, b: null },
  players: [],
  game: emptyGame(now),
});

/* A player as stored: who they are, what they are called, and the accent their
 * pieces are drawn in. The accent travels because the board is painted in the
 * two players' OWN colours -- see chess/app.mjs. */
function cleanPlayer(p, now) {
  const id = String((p && p.id) || '').slice(0, 40);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return {
    id,
    // Control characters out, not spaces and hyphens: a name is allowed to
    // hold both, and the first version of this line took them out.
    name: String((p && p.name) || '').replace(/[\u0000-\u001f\u007f]/g, '')
      .trim().slice(0, MAX_NAME) || 'Guest',
    accent: /^#[0-9a-fA-F]{6}$/.test((p && p.accent) || '') ? p.accent.toLowerCase() : '',
    seen: now,
  };
}

function parse(text, now) {
  if (!text) return emptyTable(now);
  let raw;
  try { raw = JSON.parse(text); } catch { return emptyTable(now); }
  if (!raw || typeof raw !== 'object') return emptyTable(now);
  const t = emptyTable(now);
  t.rev = Number(raw.rev) || 0;
  t.updated = Number(raw.updated) || now;
  t.players = Array.isArray(raw.players)
    ? raw.players.map((p) => cleanPlayer(p, Number(p && p.seen) || 0)).filter(Boolean).slice(0, MAX_PLAYERS)
    : [];
  for (const seat of ['w', 'b']) {
    const id = raw.seats && raw.seats[seat];
    t.seats[seat] = typeof id === 'string' && t.players.some((p) => p.id === id) ? id : null;
  }
  const g = raw.game || {};
  t.game = {
    moves: Array.isArray(g.moves)
      ? g.moves.filter((m) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)).slice(0, MAX_MOVES)
      : [],
    startedAt: Number(g.startedAt) || now,
    result: typeof g.result === 'string' ? g.result.slice(0, 12) : null,
    reason: typeof g.reason === 'string' ? g.reason.slice(0, 40) : '',
    by: typeof g.by === 'string' ? g.by.slice(0, 40) : '',
  };
  return t;
}

/* Everyone whose last sync is inside the window, and the seats of everyone who
 * is not. A seat is held by presence and nothing else: closing the tab frees
 * it, which is the only behaviour that works for a lobby anyone can walk into
 * and out of. */
function prune(t, now) {
  t.players = t.players.filter((p) => now - p.seen < SEEN_MS);
  for (const seat of ['w', 'b']) {
    if (t.seats[seat] && !t.players.some((p) => p.id === t.seats[seat])) t.seats[seat] = null;
  }
  if (now - t.updated > STALE_MS) t.game = emptyGame(now);
  /* AN EMPTY ROOM WITH A FINISHED GAME IN IT IS CLEARED. Walking in to find
     somebody else's checkmate from an hour ago, with a Rematch button you are
     not allowed to press, is not a table anyone can start a game at.
     A game still IN PROGRESS is kept: both players' tabs being hidden for half
     a minute is a thing that happens, and losing the board to it would be
     worse than the stale board this avoids. */
  if (!t.players.length && t.game.result) t.game = emptyGame(now);
  return t;
}

async function read(now = Date.now()) {
  return prune(parse(await backend().read(), now), now);
}

async function write(t, now = Date.now()) {
  t.rev = (Number(t.rev) || 0) + 1;
  t.updated = now;
  await backend().write(JSON.stringify(t));
  return t;
}

/* What a client is told. The ids of other players never leave the server as
 * anything a client needs -- but the SEATS are ids, so they do; they are random
 * strings a client made up, not anything about a person. */
function view(t, meId) {
  const at = (seat) => {
    const id = t.seats[seat];
    const p = id && t.players.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, accent: p.accent } : null;
  };
  const me = t.players.find((p) => p.id === meId) || null;
  return {
    rev: t.rev,
    players: t.players.length,
    watching: t.players.filter((p) => p.id !== t.seats.w && p.id !== t.seats.b).length,
    seats: { w: at('w'), b: at('b') },
    you: {
      id: meId,
      seat: t.seats.w === meId ? 'w' : t.seats.b === meId ? 'b' : '',
      name: me ? me.name : '',
    },
    game: t.game,
    names: t.players.map((p) => ({ name: p.name, accent: p.accent })),
  };
}

module.exports = {
  KEY, SEEN_MS, STALE_MS, MAX_PLAYERS, MAX_NAME, MAX_MOVES,
  configError, devDir, emptyTable, emptyGame, cleanPlayer, parse, prune, read, write, view,
};
