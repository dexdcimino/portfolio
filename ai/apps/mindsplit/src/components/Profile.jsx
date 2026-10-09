import { useMemo, useState } from "react";
import { inkOn, mix } from "../lib/color.js";
import { CAT_EMOJI, CAT_HEX, CAT_LABEL } from "../data/categories.js";
import { Avatar } from "./Account.jsx";
import { Ico } from "./Icons.jsx";

/* Your page. Top half (read only): who you are and what your answers say
   about you. Bottom half: sign in, or your answers and questions as a list
   that jumps back to the card. */
export function Profile({ T, topRow, all, votes, countsFor, mine, user, handle, onOpen, onAccount, onSignIn }) {
  const [tab, setTab] = useState("votes");

  const rows = useMemo(() => Object.entries(votes).map(([id, v]) => {
    const p = all.find((x) => x.id === id);
    if (!p) return null;
    const counts = countsFor(p);
    const sum = counts.reduce((a, b) => a + b, 0) || 1;
    const pct = (counts[v.c] / sum) * 100;
    const won = counts[v.c] === Math.max(...counts);
    return { p, pick: p.o[v.c], pct, won, at: v.at || 0 };
  }).filter(Boolean).sort((a, b) => b.at - a.at), [votes, all, countsFor]);

  const cast = rows.length;
  const majority = cast ? Math.round((rows.filter((r) => r.won).length / cast) * 100) : 0;
  const rarest = cast ? rows.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
  const list = tab === "votes" ? rows : mine.map((p) => ({ p, pick: null }));

  const stat = (n, label) => (
    <span className="flex-1 min-w-0">
      <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 30, fontWeight: 500, letterSpacing: "-.04em" }}>{n}</span>
      <span className="block mt-0.5" style={{ fontFamily: "var(--body)", fontSize: 13, fontWeight: 600, color: T.muted }}>{label}</span>
    </span>
  );

  return (
    <div className="relative z-10 h-full grid" style={{ gridTemplateRows: `${topRow}px 1fr`, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="px-4 pt-2 pb-3 min-h-0">
        <div className="h-full w-full rounded-[30px] px-6 py-5 flex flex-col justify-between gap-3 overflow-hidden"
          style={{ background: T.surface, color: T.ink, boxShadow: T.shadow }}>
          <div className="flex items-center gap-3.5 min-w-0">
            {user ? <Avatar T={T} user={user} handle={handle} size={56} /> : (
              <span className="w-14 h-14 rounded-full grid place-items-center shrink-0" style={{ background: T.faint }}>{Ico.user(T.ink, 28)}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 26, letterSpacing: "-.04em" }}>
                {user ? (handle ? `@${handle}` : "Pick a name") : "You"}
              </span>
              <span className="block truncate" style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 600, color: T.muted }}>
                {user ? "Your votes stay anonymous" : "Your answers stay on this phone"}
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            {stat(cast, "Answered")}
            {stat(mine.length, "Asked")}
            {stat(cast ? majority + "%" : "—", "With the majority")}
          </div>
          {rarest && rarest.pct < 50 ? (
            <p className="truncate" style={{ fontFamily: "var(--body)", fontSize: 15, fontWeight: 600, color: T.muted }}>
              Rarest take: <span style={{ color: T.ink }}>{rarest.pick}</span>, {Math.round(rarest.pct)}% agree
            </p>
          ) : <span />}
        </div>
      </div>

      <div className="px-4 pb-2 flex flex-col min-h-0">
        <div className="flex gap-2 shrink-0 mb-2.5">
          {[["votes", `Answered · ${cast}`], ["asked", `Asked · ${mine.length}`]].map(([k, label]) => {
            const on = tab === k;
            return (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={on} className="ms-press flex-1 h-12 rounded-[16px]"
                style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16, background: on ? T.ink : T.surface, color: on ? inkOn(T.ink) : T.ink }}>{label}</button>
            );
          })}
          <button type="button" onClick={user ? onAccount : onSignIn} className="ms-press h-12 px-4 rounded-[16px] shrink-0"
            style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 16, background: user ? T.surface : T.accent, color: user ? T.ink : inkOn(T.accent) }}>
            {user ? "Account" : "Sign in"}
          </button>
        </div>

        <div className="uv-nobar flex-1 overflow-y-auto min-h-0 space-y-2 pb-1">
          {list.length === 0 && (
            <div className="h-full grid place-items-center px-6 text-center">
              <p style={{ fontFamily: "var(--body)", fontSize: 16, color: T.muted, lineHeight: 1.5 }}>
                {tab === "votes" ? "Nothing answered yet. Swipe back and pick a side." : "You haven’t asked anything yet. Tap + to ask the first one."}
              </p>
            </div>
          )}
          {list.map(({ p, pick, pct, won }) => (
            <button key={p.id} type="button" onClick={() => onOpen(p)}
              className="ms-press w-full flex items-center gap-3 px-4 py-3.5 rounded-[18px] text-left" style={{ background: T.surface, color: T.ink }}>
              <span className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ background: mix(CAT_HEX[p.cat] || "#888888", T.surface, .1), fontSize: 16 }} aria-hidden="true">{CAT_EMOJI[p.cat]}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 17 }}>{p.q}</span>
                <span className="block truncate mt-0.5" style={{ fontFamily: "var(--body)", fontSize: 14, color: T.muted }}>
                  {pick ? `You said ${pick}` : `${CAT_LABEL[p.cat]} · ${p.by ? "@" + p.by : "anonymous"}`}
                </span>
              </span>
              {pick && (
                <span className="shrink-0 text-right">
                  <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 19 }}>{Math.round(pct)}%</span>
                  <span className="block" style={{ fontFamily: "var(--body)", fontSize: 12, fontWeight: 700, color: T.muted }}>{won ? "majority" : "minority"}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
