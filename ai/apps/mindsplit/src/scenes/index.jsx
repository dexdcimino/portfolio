import { useMemo } from "react";
import { INK, PAPER, mix, rgba, clamp01 } from "../lib/color.js";

/* The scene renders ONCE, at app level, behind everything — never inside a
   card, which would be one animation loop per poll and a hot phone. Moved here
   verbatim from the old single-file App.jsx in the 2026-10 revamp. */

/* One full sunrise-to-sunrise in ten minutes, advanced once a second. Both
   numbers are read by the app's day-cycle timer and by SkyScene's transition,
   which have to agree: the transition lasts exactly one tick. */
export const DAY_MS = 600000;
export const DAY_TICK_MS = 1000;

const seeded = (n, seed) => {
  let s = seed; const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: n }, () => r());
};

/* Sky is now an OVERLAY, not a palette. It used to own the page gradient and
   repaint the whole app from midnight blue to noon blue, which cannot coexist
   with the reader choosing their own accent — two things would be deciding the
   background. The clock survives intact: the body still crosses the same arc on
   the same ten-minute cycle, the stars still fade with it, and `day` now drives
   a translucent wash over the reader's ground instead of replacing it. */
function SkyScene({ phase, reduce }) {
  const p = phase;
  const day = clamp01(Math.sin(p * Math.PI * 2 - Math.PI / 2) * .5 + .5);
  const stars = useMemo(() => seeded(120, 7), []);
  /* The body moves once a second; this glides it across the gap so the arc
     reads as continuous rather than as one hop per tick. linear, because any
     easing would make each individual step visible as its own little
     accelerate-and-stop. left/top rather than transform: it is a single
     element moving 0.3% a second, the layout cost is nil, and percentages of
     the frame are what the arc maths already produces.
     The wrap-around at midnight is the one jump that must NOT be smoothed —
     the body leaves at one edge and re-enters at the other, and interpolating
     that would fly it backwards across the whole sky. */
  const wrapping = p < DAY_TICK_MS / DAY_MS || Math.abs(p - .25) < DAY_TICK_MS / DAY_MS
                || Math.abs(p - .75) < DAY_TICK_MS / DAY_MS;
  const glide = reduce || wrapping ? "none" : `left ${DAY_TICK_MS}ms linear, top ${DAY_TICK_MS}ms linear`;
  // sun arcs 0.25→0.75, moon the rest
  const isSun = p >= .25 && p < .75;
  const local = isSun ? (p - .25) / .5 : (p < .25 ? p + .25 : p - .75) / .5;
  const x = local * 112 - 6;
  const y = 72 - Math.sin(local * Math.PI) * 58;
  const body = isSun ? "#FFE9A8" : "#E8EAF4";
  const glow = isSun ? "#FFC35C" : "#B9C4E8";

  return (
    <>
      {/* Day wash over the reader's ground, rather than a replacement for it:
          warm and light at noon, cold and near-nothing at midnight. */}
      <div className="absolute inset-0" style={{
        background: `linear-gradient(180deg, ${rgba(day > .5 ? "#8FC0EA" : "#243056", .10 + day * .26)}, ${rgba(day > .5 ? "#DCE9F4" : "#141A33", .06 + day * .20)})`,
        transition: `background ${DAY_TICK_MS}ms linear`,
      }} />
      {/* stars */}
      <svg className="absolute inset-0 w-full h-full" style={{ opacity: 1 - day }} viewBox="0 0 100 100" preserveAspectRatio="none">
        {stars.map((v, i) => i % 2 === 0 ? null : (
          <circle key={i} cx={stars[i - 1] * 100} cy={v * 62} r={.18 + (v % .3)} fill="#fff" opacity={.3 + v * .6} />
        ))}
      </svg>
      {/* body */}
      <div className="absolute rounded-full" style={{
        left: `${x}%`, top: `${y}%`, width: 62, height: 62, marginLeft: -31, marginTop: -31,
        background: body, boxShadow: `0 0 70px 22px ${rgba(glow, .45)}`,
        transition: glide,
      }} />
      {/* haze */}
      <div className="absolute left-0 right-0" style={{ top: "40%", height: "45%", background: `linear-gradient(180deg, transparent, ${rgba(isSun ? "#FFD9A0" : "#4A4E86", .22)})` }} />
      {/* silhouette */}
      <svg className="absolute bottom-0 left-0 w-full" height="46%" viewBox="0 0 400 200" preserveAspectRatio="none">
        <path d="M0 130 Q60 96 118 124 T236 116 Q300 96 340 122 T400 112 L400 200 L0 200Z" fill={mix("#0B0A16", "#2A3352", day * .55)} opacity=".9" />
        <path d="M0 158 Q70 134 140 154 T280 146 Q340 132 400 152 L400 200 L0 200Z" fill={mix("#07060E", "#161B33", day * .5)} />
        {[54, 96, 300, 352].map((cx, i) => (
          <g key={cx} fill={mix("#07060E", "#12162B", day * .4)}>
            <rect x={cx} y={150 - i * 6} width="3" height={30 + i * 6} />
            <ellipse cx={cx + 1.5} cy={148 - i * 6} rx={11 - i} ry={13 - i} />
          </g>
        ))}
      </svg>
    </>
  );
}

/* Rain, thinned right down. It was 120 drops falling in under a second, which
   is not rain on a window — it is static. Drizzle reads as weather; a downpour
   reads as noise, and this sits behind text people are supposed to read.
   Halved the count (26 near, 18 far), roughly tripled the fall time, and cut
   the opacity, so it is something you notice rather than something you look
   through.
   The drops fall in the reader's ACCENT colour now (lime rain on crimson is
   the whole point) — but the density and opacities above are exactly as
   measured, and turning the count back up to make a colour feel more "fun"
   recreates the static this comment exists to prevent. */
function RainScene({ reduce, tint, t }) {
  const drops = useMemo(() => seeded(240, 19), []);
  const near = mix(tint, "#FFFFFF", .45), far = mix(tint, "#FFFFFF", .25);
  /* Clouds and the ground mist come from the ROOM, not from a hardcoded
     near-black: on the lime and cyan rooms the old #0C161C ellipses read as
     bruises rather than weather. A deepened step of the theme's own surface
     is a storm cloud in every room's family. */
  const cloud = mix(t.surface, INK, t.light ? .45 : .6);
  return (
    <>
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 60% at 50% 0%, ${rgba(mix(tint, "#FFFFFF", .2), .12)}, transparent 70%)` }} />
      {[0, 1].map((layer) => (
        <div key={layer} className="absolute inset-0 overflow-hidden" style={{ opacity: layer ? .34 : .6 }}>
          {Array.from({ length: layer ? 18 : 26 }, (_, i) => {
            const a = drops[i * 3 + layer], b = drops[i * 3 + 1], c = drops[i * 3 + 2];
            return (
              <span key={i} className="absolute uv-rain" style={{
                left: `${a * 104 - 2}%`, top: `${-20 - b * 40}%`,
                width: layer ? 1 : 1.4, height: layer ? 26 : 40,
                background: `linear-gradient(180deg, transparent, ${layer ? rgba(far, .3) : rgba(near, .48)})`,
                animationDuration: `${(layer ? 3.4 : 2.6) + c * 1.4}s`,
                animationDelay: `${b * -4}s`,
                animationPlayState: reduce ? "paused" : "running",
                transform: "rotate(7deg)",
              }} />
            );
          })}
        </div>
      ))}
      <svg className="absolute top-0 left-0 w-full" height="34%" viewBox="0 0 400 140" preserveAspectRatio="none">
        <ellipse cx="90" cy="30" rx="130" ry="52" fill={rgba(cloud, .5)} />
        <ellipse cx="300" cy="14" rx="150" ry="56" fill={rgba(cloud, .45)} />
      </svg>
      <div className="absolute bottom-0 left-0 right-0 h-[22%]" style={{ background: `linear-gradient(180deg, transparent, ${rgba(cloud, t.light ? .35 : .6)})` }} />
    </>
  );
}

function DeepScene({ reduce }) {
  const b = useMemo(() => seeded(120, 41), []);
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="absolute uv-shaft" style={{
          left: `${8 + i * 24}%`, top: "-15%", width: `${16 + i * 4}%`, height: "90%",
          background: "linear-gradient(180deg, rgba(150,228,236,.20), transparent 78%)",
          transform: "skewX(-13deg)", filter: "blur(9px)",
          animationDelay: `${i * 1.7}s`, animationPlayState: reduce ? "paused" : "running",
        }} />
      ))}
      {Array.from({ length: 26 }, (_, i) => {
        const a = b[i * 4], c = b[i * 4 + 1], d = b[i * 4 + 2];
        return (
          <span key={i} className="absolute rounded-full uv-bub" style={{
            left: `${a * 100}%`, bottom: "-8%",
            width: 3 + c * 7, height: 3 + c * 7,
            border: "1px solid rgba(178,240,244,.4)", background: "rgba(178,240,244,.09)",
            animationDuration: `${7 + d * 9}s`, animationDelay: `${c * -12}s`,
            animationPlayState: reduce ? "paused" : "running",
          }} />
        );
      })}
      <div className="absolute bottom-0 left-0 right-0 h-[35%]" style={{ background: "linear-gradient(180deg, transparent, rgba(2,10,16,.9))" }} />
    </>
  );
}

function EmberScene({ reduce }) {
  const s = useMemo(() => seeded(160, 61), []);
  return (
    <>
      <div className="absolute bottom-0 left-0 right-0 h-[46%]" style={{ background: "radial-gradient(80% 100% at 50% 118%, rgba(255,146,52,.5), rgba(255,90,30,.12) 48%, transparent 74%)" }} />
      {Array.from({ length: 34 }, (_, i) => {
        const a = s[i * 4], c = s[i * 4 + 1], d = s[i * 4 + 2];
        return (
          <span key={i} className="absolute rounded-full uv-spark" style={{
            left: `${12 + a * 76}%`, bottom: "2%",
            width: 2 + c * 3, height: 2 + c * 3,
            background: c > .6 ? "#FFD9A0" : "#FF9236",
            boxShadow: `0 0 ${5 + c * 8}px ${rgba("#FF8A2A", .8)}`,
            animationDuration: `${5.5 + d * 6}s`, animationDelay: `${c * -9}s`,
            animationPlayState: reduce ? "paused" : "running",
          }} />
        );
      })}
      <div className="absolute inset-0" style={{ background: "radial-gradient(90% 60% at 50% 0%, rgba(0,0,0,.5), transparent 60%)" }} />
    </>
  );
}

/* Two glows and a vignette. No particles, no loop of 30 spans — the whole
   point of this theme is that nothing in the background asks for attention, and
   the cheapest way to guarantee that is to have almost nothing there. Both
   glows drift on long, mismatched cycles so they never visibly line up. */
function SlateScene({ reduce, t }) {
  const drift = (dur, delay) => ({
    animation: `uvDrift ${dur}s ease-in-out ${delay}s infinite alternate`,
    animationPlayState: reduce ? "paused" : "running",
  });
  /* The glows were hardcoded slate-blue, authored for the old grey grounds —
     on a crimson or lime room they read as murky bruises. They come from the
     ROOM now: the theme's own surface pulled toward paper, so every ground
     gets a soft lighter drift in its own family. Deliberately NOT the accent
     — Venom's default accent is black, and a black glow is a bruise again.
     The vignette also backs off on light rooms, where a .72 black corner was
     most of what you saw. */
  const glow = mix(t.surface, PAPER, t.light ? .6 : .35);
  return (
    <>
      <div className="absolute rounded-full" style={{
        left: "-25%", top: "-18%", width: "85%", height: "58%",
        background: `radial-gradient(circle, ${rgba(glow, .26)}, transparent 68%)`,
        filter: "blur(18px)", ...drift(38, 0),
      }} />
      <div className="absolute rounded-full" style={{
        right: "-30%", top: "26%", width: "80%", height: "52%",
        background: `radial-gradient(circle, ${rgba(glow, .18)}, transparent 70%)`,
        filter: "blur(22px)", ...drift(53, -11),
      }} />
      {/* A single hairline where the glows stop, so the lower half reads as
          ground rather than as the gradient simply running out. */}
      <div className="absolute left-0 right-0" style={{
        top: "62%", height: 1,
        background: `linear-gradient(90deg, transparent, ${rgba(glow, .3)} 22%, ${rgba(glow, .3)} 78%, transparent)`,
      }} />
      <div className="absolute inset-0" style={{
        background: `radial-gradient(120% 78% at 50% 42%, transparent 52%, rgba(6,9,14,${t.light ? .14 : .5}))`,
      }} />
    </>
  );
}

/* Motion is its own control now, and OFF is the default. The ground the accent
   makes is the design; a scene is something you add to it, not something you
   have to pick a colour scheme to get. `off` renders the SlateScene glows,
   which are slow enough to read as depth in the background rather than as an
   animation. */
/* "Sun & moon", not "Sky": the scene runs a ten-minute day cycle with a sun
   AND a moon in it, and the old one-word label kept that a secret. */
export const SCENES = [
  ["off", "None"],
  ["rain", "Rain"],
  ["sky", "Sun & moon"],
  ["deep", "Deep"],
  ["ember", "Ember"],
];

export function Scene({ id, t, tint, phase, reduce }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ background: t.page, transition: "background 500ms linear" }}>
      {id === "off" && <SlateScene reduce={reduce} t={t} />}
      {id === "sky" && <SkyScene phase={phase} reduce={reduce} />}
      {id === "rain" && <RainScene reduce={reduce} tint={tint} t={t} />}
      {id === "deep" && <DeepScene reduce={reduce} />}
      {id === "ember" && <EmberScene reduce={reduce} />}
    </div>
  );
}
