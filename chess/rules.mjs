/* The rules of chess. Nothing about the screen, the network or the lobby.
 *
 * ONE COPY, USED BY BOTH SIDES. The browser imports this module and so does
 * api/chess/table.js, which validates every move before it writes one -- the
 * server is the one that decides whether a move was legal, and a second
 * implementation of "legal" is two things that will disagree eventually. The
 * API is CommonJS and this is an ES module, so it reaches it through a dynamic
 * import(); that is the whole reason the file has no dependencies.
 *
 * THE BOARD IS 64 ENTRIES, index 0 = a8 and index 63 = h1, which is the order
 * a FEN is written in and the order the squares are painted in. A piece is one
 * character: PNBRQK for white, pnbrqk for black, '' for empty.
 *
 * WHAT PROVES IT: tools/chess_check.mjs runs PERFT against six published
 * positions -- count every leaf node at a fixed depth and compare with the
 * numbers the chess programming world has agreed on for decades. It is the one
 * test that cannot be satisfied by a move generator that is nearly right:
 * castling through check, en passant that exposes a king, a promotion that
 * gives mate, and a hundred other corners all change the count.
 */

export const FILES = 'abcdefgh';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const isWhite = (p) => !!p && p === p.toUpperCase();
export const colorOf = (p) => (!p ? '' : p === p.toUpperCase() ? 'w' : 'b');
export const kindOf = (p) => (p || '').toLowerCase();

export const sq = (file, rank) => rank * 8 + file;      // rank 0 is rank EIGHT
export const fileOf = (i) => i % 8;
export const rankOf = (i) => (i / 8) | 0;
export const name = (i) => FILES[fileOf(i)] + (8 - rankOf(i));
export const index = (n) => sq(FILES.indexOf(n[0]), 8 - Number(n[1]));

/* ---- positions ----------------------------------------------------------- */

export function fromFen(fen = START) {
  const [rows, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill('');
  let i = 0;
  for (const ch of rows) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') i += Number(ch);
    else board[i++] = ch;
  }
  if (i !== 64) throw new Error(`FEN describes ${i} squares, not 64`);
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: {
      K: castle.includes('K'), Q: castle.includes('Q'),
      k: castle.includes('k'), q: castle.includes('q'),
    },
    ep: ep && ep !== '-' ? index(ep) : null,
    half: Number(half) || 0,
    full: Number(full) || 1,
  };
}

export function toFen(s) {
  let rows = '';
  for (let r = 0; r < 8; r++) {
    let run = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[sq(f, r)];
      if (!p) { run++; continue; }
      if (run) { rows += run; run = 0; }
      rows += p;
    }
    if (run) rows += run;
    if (r < 7) rows += '/';
  }
  const c = (s.castling.K ? 'K' : '') + (s.castling.Q ? 'Q' : '')
          + (s.castling.k ? 'k' : '') + (s.castling.q ? 'q' : '');
  return `${rows} ${s.turn} ${c || '-'} ${s.ep === null ? '-' : name(s.ep)} ${s.half} ${s.full}`;
}

export const start = () => fromFen(START);
export const clone = (s) => ({
  board: s.board.slice(), turn: s.turn, castling: { ...s.castling },
  ep: s.ep, half: s.half, full: s.full,
});

/* ---- attacks -------------------------------------------------------------
   Deliberately separate from move generation. "Is this square attacked" is
   asked about squares a king is only PASSING through when castling, which are
   not squares anything is moving to -- generating moves to answer it would
   recurse. */

const STEPS = {
  n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  b: [[1, 1], [1, -1], [-1, -1], [-1, 1]],
  r: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  k: [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
};
STEPS.q = STEPS.b.concat(STEPS.r);

const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

export function attacked(board, target, by) {
  const tf = fileOf(target), tr = rankOf(target);

  // Pawns attack DIAGONALLY FORWARD, and "forward" is up the board for white,
  // so a white pawn attacking `target` sits one rank BELOW it.
  const dir = by === 'w' ? 1 : -1;
  for (const df of [-1, 1]) {
    const f = tf + df, r = tr + dir;
    if (on(f, r) && board[sq(f, r)] === (by === 'w' ? 'P' : 'p')) return true;
  }
  for (const [df, dr] of STEPS.n) {
    const f = tf + df, r = tr + dr;
    if (on(f, r) && board[sq(f, r)] === (by === 'w' ? 'N' : 'n')) return true;
  }
  for (const [df, dr] of STEPS.k) {
    const f = tf + df, r = tr + dr;
    if (on(f, r) && board[sq(f, r)] === (by === 'w' ? 'K' : 'k')) return true;
  }
  for (const [kind, dirs] of [['b', STEPS.b], ['r', STEPS.r]]) {
    for (const [df, dr] of dirs) {
      let f = tf + df, r = tr + dr;
      while (on(f, r)) {
        const p = board[sq(f, r)];
        if (p) {
          const k = kindOf(p);
          if (colorOf(p) === by && (k === kind || k === 'q')) return true;
          break;
        }
        f += df; r += dr;
      }
    }
  }
  return false;
}

export function kingOf(board, color) {
  const k = color === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (board[i] === k) return i;
  return -1;
}

export function inCheck(s, color = s.turn) {
  const k = kingOf(s.board, color);
  return k >= 0 && attacked(s.board, k, color === 'w' ? 'b' : 'w');
}

/* ---- moves ---------------------------------------------------------------
   Pseudo-legal first, then filtered by actually making the move and asking
   whether the mover's king is attacked. Slower than pin detection and exactly
   right, which matters more here: every clever shortcut in this function is a
   corner case in perft.

   A move is { from, to, promo?, flag? } where flag is 'ep', 'k', 'q' or 'x2'
   (a double pawn push, which is what sets the en-passant square). */

function pseudo(s) {
  const out = [];
  const me = s.turn, them = me === 'w' ? 'b' : 'w';
  const push = (from, to, extra) => out.push({ from, to, ...extra });

  for (let from = 0; from < 64; from++) {
    const p = s.board[from];
    if (!p || colorOf(p) !== me) continue;
    const f = fileOf(from), r = rankOf(from), kind = kindOf(p);

    if (kind === 'p') {
      const dir = me === 'w' ? -1 : 1;          // up the array is up the board
      const home = me === 'w' ? 6 : 1;
      const last = me === 'w' ? 0 : 7;
      const one = r + dir;
      if (on(f, one) && !s.board[sq(f, one)]) {
        if (one === last) for (const q of 'qrbn') push(from, sq(f, one), { promo: q });
        else {
          push(from, sq(f, one));
          const two = r + dir * 2;
          if (r === home && !s.board[sq(f, two)]) push(from, sq(f, two), { flag: 'x2' });
        }
      }
      for (const df of [-1, 1]) {
        const cf = f + df;
        if (!on(cf, one)) continue;
        const to = sq(cf, one);
        const victim = s.board[to];
        if (victim && colorOf(victim) === them) {
          if (one === last) for (const q of 'qrbn') push(from, to, { promo: q });
          else push(from, to);
        } else if (to === s.ep && !victim) {
          push(from, to, { flag: 'ep' });
        }
      }
      continue;
    }

    if (kind === 'n' || kind === 'k') {
      for (const [df, dr] of STEPS[kind]) {
        const nf = f + df, nr = r + dr;
        if (!on(nf, nr)) continue;
        const to = sq(nf, nr);
        if (colorOf(s.board[to]) !== me) push(from, to);
      }
    } else {
      for (const [df, dr] of STEPS[kind]) {
        let nf = f + df, nr = r + dr;
        while (on(nf, nr)) {
          const to = sq(nf, nr);
          const victim = s.board[to];
          if (victim) {
            if (colorOf(victim) !== me) push(from, to);
            break;
          }
          push(from, to);
          nf += df; nr += dr;
        }
      }
    }

    if (kind === 'k') {
      /* CASTLING IS THREE CONDITIONS, and the one people drop is the middle
         square. The king may not start in check, may not PASS THROUGH an
         attacked square, and may not land on one. The rook's path only has to
         be empty -- b1 may be attacked and queenside castling is still legal,
         which is the case that catches a generator testing the wrong squares. */
      const rank = me === 'w' ? 7 : 0;
      if (from === sq(4, rank) && !attacked(s.board, from, them)) {
        const rights = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (s.castling[rights[0]]
            && !s.board[sq(5, rank)] && !s.board[sq(6, rank)]
            && !attacked(s.board, sq(5, rank), them)
            && !attacked(s.board, sq(6, rank), them)) {
          push(from, sq(6, rank), { flag: 'k' });
        }
        if (s.castling[rights[1]]
            && !s.board[sq(3, rank)] && !s.board[sq(2, rank)] && !s.board[sq(1, rank)]
            && !attacked(s.board, sq(3, rank), them)
            && !attacked(s.board, sq(2, rank), them)) {
          push(from, sq(2, rank), { flag: 'q' });
        }
      }
    }
  }
  return out;
}

export function apply(s, m) {
  const n = clone(s);
  const p = n.board[m.from];
  const me = colorOf(p);
  const kind = kindOf(p);
  const captured = m.flag === 'ep'
    ? n.board[sq(fileOf(m.to), rankOf(m.from))]
    : n.board[m.to];

  n.board[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : p;
  n.board[m.from] = '';
  if (m.flag === 'ep') n.board[sq(fileOf(m.to), rankOf(m.from))] = '';
  if (m.flag === 'k') {
    const rank = rankOf(m.from);
    n.board[sq(5, rank)] = n.board[sq(7, rank)];
    n.board[sq(7, rank)] = '';
  }
  if (m.flag === 'q') {
    const rank = rankOf(m.from);
    n.board[sq(3, rank)] = n.board[sq(0, rank)];
    n.board[sq(0, rank)] = '';
  }

  /* RIGHTS ARE LOST BY THE SQUARE, not by the piece. A rook captured on h8 by
     anything at all ends black's kingside castling, and a generator that only
     clears rights when the ROOK moves lets a king castle with a rook that is
     no longer there. */
  const clear = (i) => {
    if (i === sq(4, 7)) { n.castling.K = n.castling.Q = false; }
    if (i === sq(4, 0)) { n.castling.k = n.castling.q = false; }
    if (i === sq(0, 7)) n.castling.Q = false;
    if (i === sq(7, 7)) n.castling.K = false;
    if (i === sq(0, 0)) n.castling.q = false;
    if (i === sq(7, 0)) n.castling.k = false;
  };
  clear(m.from);
  clear(m.to);

  n.ep = m.flag === 'x2' ? sq(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2) : null;
  n.half = kind === 'p' || captured ? 0 : s.half + 1;
  n.full = s.turn === 'b' ? s.full + 1 : s.full;
  n.turn = me === 'w' ? 'b' : 'w';
  n.captured = captured || '';
  return n;
}

export function legal(s) {
  const me = s.turn;
  return pseudo(s).filter((m) => {
    const after = apply(s, m);
    return !inCheck({ ...after, turn: me }, me);
  });
}

export function legalFrom(s, from) {
  return legal(s).filter((m) => m.from === from);
}

export function find(s, from, to, promo) {
  return legal(s).find((m) => m.from === from && m.to === to
    && (!m.promo || !promo || m.promo === promo)) || null;
}

/* ---- how a game ends ------------------------------------------------------ */

const MATERIAL = (board) => {
  const left = [];
  for (const p of board) if (p && kindOf(p) !== 'k') left.push(p);
  return left;
};

export function status(s, history = []) {
  const moves = legal(s);
  const check = inCheck(s);
  if (!moves.length) return check ? { over: true, kind: 'checkmate', winner: s.turn === 'w' ? 'b' : 'w' }
                                  : { over: true, kind: 'stalemate', winner: null };
  if (s.half >= 100) return { over: true, kind: 'fifty', winner: null };

  /* DEAD POSITIONS, the ones that are draws by the rules rather than by
     agreement: king against king, and king and a single minor against king. */
  const left = MATERIAL(s.board);
  if (!left.length
      || (left.length === 1 && 'nb'.includes(kindOf(left[0])))) {
    return { over: true, kind: 'material', winner: null };
  }

  /* THREEFOLD. The position is the first four fields of the FEN -- the move
     counters are not part of "the same position", and comparing whole FENs
     would never find a repetition at all. */
  if (history.length) {
    const key = toFen(s).split(' ').slice(0, 4).join(' ');
    let seen = 0;
    for (const h of history) if (h === key) seen++;
    if (seen >= 3) return { over: true, kind: 'repetition', winner: null };
  }
  return { over: false, kind: check ? 'check' : 'ongoing', winner: null };
}

export const positionKey = (s) => toFen(s).split(' ').slice(0, 4).join(' ');

/* ---- reading and writing a move ------------------------------------------ */

/* SAN, because a move list that reads "e4 e5 Nf3 Nc6" is a game and one that
   reads "e2e4 e7e5 g1f3 b8c6" is a log. The disambiguation rules are the
   fiddly part: a piece is named by file if that is enough, by rank if it is
   not, and by both if neither is. */
export function san(s, m) {
  const p = s.board[m.from];
  const kind = kindOf(p);
  if (m.flag === 'k') return finish(s, m, 'O-O');
  if (m.flag === 'q') return finish(s, m, 'O-O-O');
  const takes = !!s.board[m.to] || m.flag === 'ep';
  let out;
  if (kind === 'p') {
    out = takes ? `${FILES[fileOf(m.from)]}x${name(m.to)}` : name(m.to);
    if (m.promo) out += `=${m.promo.toUpperCase()}`;
  } else {
    const rivals = legal(s).filter((o) => o.to === m.to && o.from !== m.from
      && kindOf(s.board[o.from]) === kind);
    let where = '';
    if (rivals.length) {
      const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
      const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
      where = !sameFile ? FILES[fileOf(m.from)]
            : !sameRank ? String(8 - rankOf(m.from))
            : name(m.from);
    }
    out = `${kind.toUpperCase()}${where}${takes ? 'x' : ''}${name(m.to)}`;
  }
  return finish(s, m, out);
}

function finish(s, m, text) {
  const after = apply(s, m);
  const rest = legal(after);
  if (!rest.length) return inCheck(after) ? `${text}#` : text;
  return inCheck(after) ? `${text}+` : text;
}

/* The wire format is the plain one: "e2e4", "e7e8q". Short, unambiguous, and
   nothing has to parse SAN on the server. */
export const toUci = (m) => name(m.from) + name(m.to) + (m.promo || '');
export function fromUci(s, uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return find(s, index(uci.slice(0, 2)), index(uci.slice(2, 4)), uci[4]);
}

/* Replay a whole game from its move list. The server stores moves and nothing
   else, so this is what turns a list into a position -- on both sides, with
   the same code, which is why a desync is not a thing that can happen. */
export function replay(moves) {
  let s = start();
  const history = [positionKey(s)];
  const sans = [];
  const taken = [];
  for (const uci of moves) {
    const m = fromUci(s, uci);
    if (!m) return { ok: false, at: sans.length, state: s, history, sans, taken };
    sans.push(san(s, m));
    s = apply(s, m);
    if (s.captured) taken.push(s.captured);
    history.push(positionKey(s));
  }
  return { ok: true, state: s, history, sans, taken };
}

export function perft(s, depth) {
  if (depth === 0) return 1;
  const moves = legal(s);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(apply(s, m), depth - 1);
  return n;
}
