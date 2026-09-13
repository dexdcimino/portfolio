/* The chess table. One route, because it is one document.
 *
 *   POST /api/chess/table  { action, me:{id,name,accent}, ... }  ->  the table
 *
 * ACTIONS
 *   sync              I am still here. The heartbeat and the poll in one.
 *   sit   {seat}      take 'w', 'b', or 'any' for whichever is free
 *   stand             leave the seat, stay in the room
 *   leave             leave the ROOM, which is what closing the overlay does
 *   move  {uci, ply}  play a move
 *   resign
 *   rematch           start again, colours swapped
 *
 * THE SERVER DECIDES WHETHER A MOVE WAS LEGAL, using chess/rules.mjs -- the
 * same module the browser uses, reached through a dynamic import() because
 * this file is CommonJS and that one is not. A second implementation of the
 * rules is two things that will disagree eventually, and the one that matters
 * is the one nobody can edit from a console.
 *
 * `ply` is the move number the client believed it was playing. Two clicks in
 * the same second, a retry after a slow response, or a stale tab all arrive as
 * a move for a ply that has already been played, and all of them are refused
 * rather than applied twice.
 *
 * WRITES ARE RARE ON PURPOSE. A sync that changes nothing does not write: the
 * heartbeat is only persisted when it is about to go stale, so two people
 * staring at a board cost reads and almost no writes.
 */

'use strict';

const store = require('../../lib/chess-store.js');

/* The rules module is an ES module and this is not, so it arrives through
 * import(). Cached across invocations of a warm function. */
let rulesPromise = null;
const rules = () => (rulesPromise ??= import('../../chess/rules.mjs'));

/* How stale a heartbeat is allowed to get before a sync writes it back. A
 * third of the window the store forgets people after: late enough that most
 * syncs are free, early enough that nobody is dropped for being on time. */
const BEAT_MS = Math.round(store.SEEN_MS / 3);

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const missing = store.configError();
  if (missing) {
    console.error('chess/table: ' + missing);
    return res.status(503).json({ error: 'the chess table is not configured' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const now = Date.now();
  const me = store.cleanPlayer(body.me, now);
  if (!me) return res.status(400).json({ error: 'who are you' });

  try {
    const out = await act(body, me, now);
    return res.status(out.status || 200).json(out.body);
  } catch (err) {
    console.error('chess/table: ' + (body && body.action), err);
    return res.status(502).json({ error: 'the table could not be reached' });
  }
};

async function act(body, me, now) {
  const t = await store.read(now);

  /* Everyone who posts is in the room. That is what "how many players" counts
     and it is the only thing a seat is held by. */
  const known = t.players.find((p) => p.id === me.id);
  let changed = false;
  if (!known) {
    if (t.players.length >= store.MAX_PLAYERS) {
      return { status: 429, body: { error: 'the room is full' } };
    }
    t.players.push(me);
    changed = true;
  } else {
    if (known.name !== me.name || known.accent !== me.accent) changed = true;
    known.name = me.name;
    known.accent = me.accent;
    if (now - known.seen > BEAT_MS) changed = true;
    known.seen = now;
  }

  const action = String(body.action || 'sync');
  const seatOf = (id) => (t.seats.w === id ? 'w' : t.seats.b === id ? 'b' : '');

  if (action === 'sit') {
    const want = body.seat === 'w' || body.seat === 'b' ? body.seat : 'any';
    const mine = seatOf(me.id);
    if (!mine) {
      const free = ['w', 'b'].filter((s) => !t.seats[s]);
      /* RANDOM WHEN IT IS NOT ASKED FOR, which is what happens to anyone who
         just walks in: they get whichever colour is going, and if both are
         going they get one of them by coin toss rather than always white. */
      const take = want !== 'any' && !t.seats[want] ? want
        : free.length ? free[(Math.random() * free.length) | 0] : '';
      if (take) { t.seats[take] = me.id; changed = true; }
    }
  } else if (action === 'stand') {
    const mine = seatOf(me.id);
    if (mine) { t.seats[mine] = null; changed = true; }
  } else if (action === 'leave') {
    /* OUT OF THE ROOM, not just out of the seat. Without this the count in the
       corner kept someone who had closed the window for the thirty seconds it
       takes their heartbeat to lapse -- and that count is the whole point of
       the corner. The reply is built BEFORE the removal so the caller still
       gets a sane table back rather than a view of a room they are not in. */
    const mine = seatOf(me.id);
    if (mine) t.seats[mine] = null;
    t.players = t.players.filter((p) => p.id !== me.id);
    await store.write(t, now);
    return { status: 200, body: { ...store.view(t, me.id), left: true } };
  } else if (action === 'move') {
    const seat = seatOf(me.id);
    if (!seat) return { status: 403, body: { error: 'you are not playing', ...store.view(t, me.id) } };
    if (t.game.result) return { status: 409, body: { error: 'the game is over', ...store.view(t, me.id) } };

    const { replay, fromUci, toUci, status } = await rules();
    const played = replay(t.game.moves);
    if (!played.ok) {
      /* A move list that no longer replays is a corrupt table, not a bad
         request: start again rather than leave everyone stuck on a board that
         cannot exist. */
      t.game = store.emptyGame(now);
      await store.write(t, now);
      return { status: 409, body: { error: 'the game could not be replayed', ...store.view(t, me.id) } };
    }
    if (played.state.turn !== seat) {
      return { status: 409, body: { error: 'not your turn', ...store.view(t, me.id) } };
    }
    if (Number(body.ply) !== t.game.moves.length) {
      return { status: 409, body: { error: 'that move was for an older position', ...store.view(t, me.id) } };
    }
    const m = fromUci(played.state, String(body.uci || ''));
    if (!m) return { status: 400, body: { error: 'illegal move', ...store.view(t, me.id) } };

    t.game.moves.push(toUci(m));
    changed = true;
    const after = replay(t.game.moves);
    const end = status(after.state, after.history);
    if (end.over) {
      t.game.result = end.kind === 'checkmate' ? (end.winner === 'w' ? '1-0' : '0-1') : '1/2-1/2';
      t.game.reason = end.kind;
    }
  } else if (action === 'resign') {
    const seat = seatOf(me.id);
    if (seat && !t.game.result && t.game.moves.length) {
      t.game.result = seat === 'w' ? '0-1' : '1-0';
      t.game.reason = 'resigned';
      t.game.by = me.id;
      changed = true;
    }
  } else if (action === 'rematch') {
    if (seatOf(me.id) && t.game.result) {
      /* COLOURS SWAP, which is the only fair way to play a second game and the
         thing people forget to do by hand. */
      const w = t.seats.w;
      t.seats.w = t.seats.b;
      t.seats.b = w;
      t.game = store.emptyGame(now);
      changed = true;
    }
  } else if (action !== 'sync') {
    return { status: 400, body: { error: 'no such action' } };
  }

  if (changed) await store.write(t, now);
  return { status: 200, body: store.view(t, me.id) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
