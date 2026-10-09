import { useEffect, useMemo, useRef, useState } from "react";
import { inkOn, mix, rgba } from "../lib/color.js";
import { CAT_EMOJI, CAT_HEX, CAT_LABEL } from "../data/categories.js";
import { Ico } from "./Icons.jsx";
import { Avatar } from "./Account.jsx";

export const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString();

const EASE = "cubic-bezier(.22,1,.36,1)";
const LETTERS = ["A", "B", "C", "D"];

function useCounter(target, run, reduce) {
  const [v, setV] = useState(run ? target : 0);
  const prev = useRef(target);
  useEffect(() => {
    if (!run) { setV(0); prev.current = 0; return; }
    if (reduce) { setV(target); prev.current = target; return; }
    const from = prev.current, d = target - from, t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 560);
      setV(from + d * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step); else prev.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, reduce]);
  return v;
}

/* One answer. Before a vote: an even, tappable row with its letter. After:
   a band whose HEIGHT is its share of the vote — the leader in the room's
   accent, the rest in quiet steps of the room — with the number big on the
   right and a tick on the one you picked. */
function Band({ label, count, pct, rank, top, height, T, voted, mine, onVote, reduce, letter }) {
  const shown = useCounter(pct, voted, reduce);
  const bg = voted ? (rank === 0 ? T.accent : T.runner[Math.min(rank - 1, 3)]) : T.surface;
  const fg = voted && rank === 0 ? inkOn(T.accent) : T.ink;
  return (
    <button type="button" onClick={onVote} disabled={voted}
      aria-label={`${label}${voted ? `, ${Math.round(pct)} percent, ${count} votes${mine ? ", your answer" : ""}` : ""}`}
      className="ms-band absolute left-0 right-0 text-left overflow-hidden focus:outline-none focus-visible:ring-4"
      style={{
        top: `${top}%`, height: `calc(${height}% - 10px)`, borderRadius: 22,
        background: bg, color: fg, cursor: voted ? "default" : "pointer",
        boxShadow: mine ? `inset 0 0 0 3px ${rank === 0 ? rgba(fg, .55) : T.accent}` : "none",
        transition: reduce ? "none" : `top 640ms ${EASE}, height 640ms ${EASE}, background-color 360ms, color 360ms, box-shadow 360ms`,
      }}>
      <span className="h-full w-full px-5 flex items-center gap-3.5">
        <span className="shrink-0 w-8 h-8 rounded-xl grid place-items-center"
          style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 15,
                   background: voted ? rgba(fg === T.ink ? T.ink : fg, .14) : T.faint, color: fg }}>
          {voted && mine ? Ico.check(fg, 17) : letter}
        </span>
        <span className="flex-1 min-w-0 leading-tight" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 20, letterSpacing: "-.015em" }}>{label}</span>
        {voted && (
          <span className="shrink-0 text-right leading-none">
            <span style={{ fontFamily: "var(--mono)", fontSize: 30, fontWeight: 500, letterSpacing: "-.04em" }}>
              {Math.round(shown)}<span style={{ fontSize: 16, opacity: .7 }}>%</span>
            </span>
            <span className="block mt-1" style={{ fontFamily: "var(--body)", fontSize: 13, opacity: .72 }}>{fmt(count)} {count === 1 ? "vote" : "votes"}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function verdictFor(myPct, total) {
  if (total <= 1) return "You’re the first to answer this one";
  if (myPct >= 62) return `You’re with the crowd, ${Math.round(myPct)}%`;
  if (myPct >= 46) return `Dead split. You’re in the ${Math.round(myPct)}%`;
  if (myPct >= 25) return `You’re in the ${Math.round(myPct)}%`;
  return `Rare take. Only ${Math.round(myPct)}% agree`;
}

/* A round icon button for the row under the answers. */
export const RoundBtn = ({ T, onClick, label, children, on, tone }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label}
    className="ms-press w-11 h-11 rounded-full grid place-items-center shrink-0"
    style={{ background: on ? (tone || T.ink) : T.faint, color: on ? inkOn(tone || T.ink) : T.ink }}>{children}</button>
);

/* ═══════════════ CARD ═══════════════
   THUMB RULE: the top row (the question) is read-only and exactly as tall as
   the space above the frame's midpoint, measured at run time; every control
   is in the bottom half. */
export function Card({ poll, counts, live, choice, onVote, onChange, canChange, changesLeft, reduce, T, topRow,
                       onShare, onFlag, flagged, hint, byline, author, onAuthor }) {
  const voted = choice !== undefined;
  const sum = counts.reduce((a, b) => a + b, 0);
  const pcts = counts.map((c) => (sum ? (c / sum) * 100 : 100 / counts.length));
  const order = voted ? counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b) : counts.map((_, i) => i);

  const layout = useMemo(() => {
    const n = poll.o.length, floor = n >= 4 ? 16 : n === 3 ? 20 : 27;
    const raw = voted ? order.map((i) => Math.max(pcts[i], floor)) : order.map(() => 100 / n);
    const t = raw.reduce((a, b) => a + b, 0);
    let acc = 0;
    return order.map((i, k) => { const height = (raw[k] / t) * 100, top = acc; acc += height; return { i, rank: k, top, height }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voted, order.join(), pcts.join(), poll.o.length]);

  const verdict = voted ? verdictFor(pcts[choice], sum) : null;
  const dot = mix(CAT_HEX[poll.cat] || "#888888", T.surface, .08);
  const q = poll.q;
  const size = q.length <= 26 ? 40 : q.length <= 46 ? 35 : q.length <= 62 ? 31 : 28;

  return (
    <section className="relative w-full h-full grid" style={{ gridTemplateRows: `${topRow}px 1fr`, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {/* top half: read only */}
      <div className="px-4 pt-2 pb-3 min-h-0">
        <div className="h-full w-full rounded-[30px] px-6 pt-5 pb-6 flex flex-col overflow-hidden"
          style={{ background: T.surface, color: T.ink, boxShadow: T.shadow, transition: "background 500ms, color 500ms" }}>
          <div className="flex items-center justify-between gap-3 shrink-0">
            <span className="inline-flex items-center gap-2 pl-2 pr-3.5 h-9 rounded-full min-w-0"
              style={{ background: T.faint, fontFamily: "var(--disp)", fontWeight: 700, fontSize: 15 }}>
              <span className="w-6 h-6 rounded-full grid place-items-center shrink-0" style={{ background: dot, fontSize: 13 }} aria-hidden="true">{CAT_EMOJI[poll.cat]}</span>
              <span className="truncate">{CAT_LABEL[poll.cat]}</span>
            </span>
            <span className="inline-flex items-center gap-2 shrink-0" style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 600, color: T.muted }}>
              {live && <span className="ms-live w-2 h-2 rounded-full" style={{ background: T.light ? "#16A34A" : T.accent }} aria-hidden="true" />}
              {sum ? `${fmt(sum)} ${sum === 1 ? "vote" : "votes"}` : "No votes yet"}
            </span>
          </div>
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-1">
            <h2 className="ms-balance" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: size, lineHeight: 1.06, letterSpacing: "-.035em" }}>{q}</h2>
            <p className="mt-4" style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 600, color: T.muted }}>{byline}</p>
          </div>
        </div>
      </div>

      {/* bottom half: every control */}
      <div className="relative px-4 pb-1 flex flex-col min-h-0">
        <div className="relative flex-1 min-h-0">
          {layout.map(({ i, rank, top, height }) => (
            <Band key={poll.id + i} label={poll.o[i]} count={counts[i]} pct={pcts[i]} rank={rank}
              top={top} height={height} T={T} voted={voted} mine={choice === i}
              onVote={() => onVote(i)} reduce={reduce} letter={LETTERS[i]} />
          ))}
        </div>

        <div className="h-[58px] shrink-0 flex items-center justify-between gap-2 pl-1">
          <span className="min-w-0 flex-1 line-clamp-2" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16, lineHeight: 1.2, color: T.ink,
            animation: voted && !reduce ? "uvPop 380ms 300ms both" : "none" }}>
            {voted ? verdict : (
              <span className="inline-flex items-center gap-1.5" style={{ color: T.muted, fontWeight: 600 }}>{hint}</span>
            )}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {voted && canChange && (
              <button type="button" onClick={onChange} className="ms-press flex items-center gap-1.5 pl-3 pr-3.5 h-11 rounded-full"
                style={{ background: T.faint, color: T.ink, fontFamily: "var(--disp)", fontWeight: 700, fontSize: 15 }}
                title={`You can change ${changesLeft} more ${changesLeft === 1 ? "answer" : "answers"} today`}>
                {Ico.undo(T.ink)} Change
              </button>
            )}
            {author && (
              // Who asked it: their face opens their profile. Down here, not
              // on the byline, because the byline is above the midpoint.
              <button type="button" onClick={onAuthor} aria-label={`@${author.handle}'s profile`} title={`@${author.handle}`}
                className="ms-press w-11 h-11 rounded-full grid place-items-center shrink-0 overflow-hidden" style={{ background: T.faint }}>
                <Avatar T={T} src={author.avatar} handle={author.handle} size={40} />
              </button>
            )}
            <RoundBtn T={T} onClick={onShare} label="Share">{Ico.share(T.ink)}</RoundBtn>
            <RoundBtn T={T} onClick={onFlag} label={flagged ? "Reported" : "Report"} on={flagged} tone="#E5484D">{Ico.flag(flagged ? "#FFFFFF" : T.ink)}</RoundBtn>
          </span>
        </div>
      </div>
    </section>
  );
}

/* The last card: the deck is done for this filter. */
export function EndCard({ T, topRow, onAsk, onFilter, answered }) {
  return (
    <section className="relative w-full h-full grid" style={{ gridTemplateRows: `${topRow}px 1fr`, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="px-4 pt-2 pb-3 min-h-0">
        <div className="h-full w-full rounded-[30px] px-7 py-6 flex flex-col items-center justify-center text-center"
          style={{ background: T.surface, color: T.ink, boxShadow: T.shadow }}>
          <p style={{ fontSize: 44 }} aria-hidden="true">🧠</p>
          <h2 className="mt-3 ms-balance" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 32, lineHeight: 1.08, letterSpacing: "-.035em" }}>That’s every question here</h2>
          <p className="mt-3" style={{ fontFamily: "var(--body)", fontSize: 16, color: T.muted }}>You’ve answered {answered}. Ask one of your own, or pick more categories.</p>
        </div>
      </div>
      <div className="px-4 pb-4 flex flex-col justify-end gap-3">
        <button type="button" onClick={onAsk} className="ms-press w-full h-16 rounded-[22px]"
          style={{ background: T.accent, color: inkOn(T.accent), fontFamily: "var(--disp)", fontWeight: 800, fontSize: 19 }}>Ask a question</button>
        <button type="button" onClick={onFilter} className="ms-press w-full h-16 rounded-[22px]"
          style={{ background: T.surface, color: T.ink, fontFamily: "var(--disp)", fontWeight: 800, fontSize: 19 }}>Choose categories</button>
      </div>
    </section>
  );
}
