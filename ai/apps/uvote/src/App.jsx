import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";

/* ═══════════════════════════════════════════════════════════════
   uVote — swipe-to-vote

   ARCHITECTURE NOTE
   The scene renders ONCE at app level, behind everything. Cards are
   glass panels over it. (Per-card scenes = 60 animation loops.)
   Themes harmonize every category color into their own world by
   mixing toward the scene's dominant tone, so nothing ever clashes.

   THUMB RULE: nothing interactive above the frame's vertical center.
   ═══════════════════════════════════════════════════════════════ */

/* Working name only — one string, change it when you land the real one. */
const APP_NAME = "Splitmob";

const INK = "#0D0B13", PAPER = "#FFFFFF";
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r) => "#" + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const lum = (h) => { const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; const [r, g, b] = hex2rgb(h); return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
const L_INK = lum(INK), L_PAPER = lum(PAPER);
const inkOn = (bg) => (ratio(lum(bg), L_INK) >= ratio(lum(bg), L_PAPER) ? INK : "#FBFAFE");
const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };

/* Eleven categories. music / sports / love are the three that were missing —
   between them they are most of what people actually argue about, and none of
   the existing eight had anywhere to put them.
   Hues are spaced deliberately rather than picked one at a time: the existing
   eight left gaps around 40 degrees (amber), 280 (purple) and 305 (orchid), so
   the new three take those and every category stays tellable from its
   neighbour as a 10px dot. Saturation and lightness are held close across the
   set so they read as one family once mix() pulls them toward the theme. */
const CAT_ORDER = ["food", "tech", "life", "money", "games", "culture", "music", "sports", "love", "weird", "takes"];
const CAT_LABEL = {
  food: "Food", tech: "Tech", life: "Life", money: "Money", games: "Games",
  culture: "Culture", music: "Music", sports: "Sports", love: "Love",
  weird: "Weird", takes: "Hot takes",
};
const CAT_HEX = {
  food: "#FF7A5C", tech: "#2FC7CC", life: "#8F7BE8", money: "#3FC98A", games: "#FF5FA2",
  culture: "#4D8DF0", music: "#A96BF0", sports: "#E8A22E", love: "#E45CC4",
  weird: "#C9D93B", takes: "#FF4D4D",
};

/* ═══════════════ THEMES ═══════════════
   Each returns a token set. `blend`/`amt` pull category colors into
   the scene's palette; `shade` is what losing bands fade toward.    */

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const mixList = (stops, t) => {
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  return mix(stops[i], stops[i + 1], f);
};

/* One full sunrise-to-sunrise in ten minutes, advanced once a second. Both
   numbers are read by the app's day-cycle timer and by SkyScene's transition,
   which have to agree: the transition lasts exactly one tick, so the sun is
   always still gliding toward the next position when it is set. Shorten the
   tick without shortening the transition and the motion stutters again. */
const DAY_MS = 600000;

/* Vote changes allowed per day. Three is enough to fix a misfire and far too
   few to shop your way toward the majority across a session. */
const CHANGES_PER_DAY = 3;
const DAY_TICK_MS = 1000;

/* ═══════════════ PALETTE ═══════════════
   ONE accent, picked by the reader, and everything else derived from it.

   This replaced a set of six named themes. The themes bundled two unrelated
   decisions — what colour the app is, and whether it rains — into one row of
   cards, so you could not have a mint app with rain or a quiet one in amber.
   They are separate controls now: an accent below, a motion picker further
   down.

   Accents are PASTELS on purpose. A saturated accent on a dark ground fights
   the eleven category hues that are the actual signal in this app; a pastel
   sits behind them. Each one is used three ways and never as a flat fill:
   a few percent into the ground so the background is tinted rather than grey,
   as the blend that pulls every category colour into the same family, and at
   full strength only on the one thing that is currently interactive.

   Rules from the brief still hold: nothing is rendered as
   hsl(hue, sat, lowLightness), every surface is mix()ed from a hex, and text
   colour comes from inkOn() rather than from a guess. */
const ACCENTS = [
  { id: "slate",  name: "Slate",  hex: "#A9BCD6" },
  { id: "mint",   name: "Mint",   hex: "#9FE0C0" },
  { id: "sky",    name: "Sky",    hex: "#9CC7EE" },
  { id: "lilac",  name: "Lilac",  hex: "#BCB0EC" },
  { id: "blush",  name: "Blush",  hex: "#EFA9BA" },
  { id: "peach",  name: "Peach",  hex: "#F2BC9C" },
  { id: "butter", name: "Butter", hex: "#E8D69B" },
  { id: "sage",   name: "Sage",   hex: "#B4C7A4" },
];
const ACCENT_BY_ID = Object.fromEntries(ACCENTS.map((a) => [a.id, a]));

/* Two grounds, both nearly neutral. The accent goes in at 7% and 4% — enough
   that a mint app and a blush app are unmistakably different rooms, not enough
   to read as a colour in its own right. The gradient is slight by design: two
   stops, twelve points of lightness apart. */
function palette(accentHex, light) {
  if (light) {
    const top = mix("#FBFAF8", accentHex, .10);
    const bot = mix("#F1EFEA", accentHex, .16);
    return {
      accent: accentHex, light: true,
      page: `linear-gradient(180deg, ${top} 0%, ${bot} 100%)`,
      ink: "#16141C",
      blend: "#FFFFFF", amt: .24,
      shade: "#FFFFFF",
      surface: mix("#FFFFFF", accentHex, .05),
      raise: mix("#FFFFFF", accentHex, .12),
      glassBase: "#FFFFFF",
    };
  }
  const top = mix("#111319", accentHex, .07);
  const bot = mix("#08090D", accentHex, .04);
  return {
    accent: accentHex, light: false,
    page: `linear-gradient(180deg, ${top} 0%, ${bot} 100%)`,
    ink: "#EEF0F5",
    blend: mix("#1A1E27", accentHex, .18), amt: .44,
    shade: mix("#0A0B10", accentHex, .04),
    surface: mix("#151821", accentHex, .07),
    raise: mix("#1D2029", accentHex, .11),
    glassBase: mix("#141720", accentHex, .06),
  };
}

/* chrome tokens derived from the theme's own light/dark reading */
/* Chrome tokens.

   The surfaces are SOLID now. They used to be translucent glass over the
   scene with a 1px light border on every one, which is the look the brief
   called out: a dozen outlined panes floating on a busy background reads as a
   template rather than as a design. A card is one flat colour a few points
   lighter than the ground behind it, and depth comes from that step instead of
   from an outline. `edge` survives at a much lower strength for the two places
   that genuinely need a hairline — an unfilled control and the dock's top
   rule — and is transparent everywhere else. */
function chrome(t) {
  const L = t.light;
  return {
    ink: t.ink,
    muted: L ? "rgba(22,20,28,.52)" : "rgba(238,240,245,.48)",
    faint: L ? mix(t.surface, INK, .05) : mix(t.surface, PAPER, .06),
    edge: L ? "rgba(22,20,28,.08)" : "rgba(238,240,245,.07)",
    /* Kept under the old names so every call site still reads the same token;
       both are opaque now, and `glassEdge` is transparent because the cards
       have no border at all. */
    glass: t.surface,
    glassEdge: "transparent",
    dock: t.surface,
    sheet: L ? "#FFFFFF" : t.raise,
    scrim: L ? "rgba(28,24,36,.36)" : "rgba(3,4,7,.62)",
  };
}

/* ═══════════════ SCENES ═══════════════ */

/* Total votes on a poll — the number the "Most voted" order reads, and the same
   one the card prints. Live drift (bumps) is deliberately NOT included: the
   order would then reshuffle under the reader every few seconds. */
const votesOf = (p) => p.o.reduce((sum, o) => sum + o[1], 0);

const SORTS = [
  ["mix", "For you"],
  ["new", "Newest"],
  ["top", "Most voted"],
];

/* How interesting a poll is likely to be, 0..1.

   Two things make one worth putting first, and they pull in different
   directions so both are needed:
     · CLOSENESS. A 50/50 split is an argument; a 92/8 split is a fact with a
       vote attached. This is the dominant term.
     · REACH. Something 90,000 people answered is a safer opening card than
       something 9,000 did.
   A three-option poll can never be 50/50, so closeness is measured against an
   even split for that option count rather than against half. */
function heat(p) {
  const counts = p.o.map((o) => o[1]);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const even = 1 / p.o.length;
  const top = Math.max(...counts) / total;
  // 0 when one option takes everything, 1 at a dead-even split.
  const closeness = 1 - (top - even) / (1 - even);
  const reach = Math.min(1, total / 120000);
  return closeness * .72 + reach * .28;
}

/* One gesture reader for the whole app: the feed, the profile and every sheet
   use it, so a swipe means the same thing everywhere.

   Returns props to spread. It fires AT MOST ONE direction per gesture — the
   dominant axis wins by a 1.4x margin, and an ambiguous diagonal does nothing
   rather than guessing. That is what keeps a downward flick on the feed from
   also being read as a leftward one into the profile.
   Pointer events, so touch, pen and mouse-drag are all the same path. */
const SWIPE_MIN = 55;
function swipeHandlers({ onUp, onDown, onLeft, onRight, axis = "any" }) {
  let start = null;
  return {
    onPointerDown: (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; },
    onPointerCancel: () => { start = null; },
    onPointerUp: (e) => {
      const s = start; start = null;
      if (!s || Date.now() - s.t > 900) return;      // a slow drag is not a swipe
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const horizontal = ax > ay * 1.4, vertical = ay > ax * 1.4;
      if (axis !== "y" && horizontal && ax > SWIPE_MIN) {
        if (dx < 0) onLeft?.(); else onRight?.();
        return;
      }
      if (axis !== "x" && vertical && ay > SWIPE_MIN) {
        if (dy < 0) onUp?.(); else onDown?.();
      }
    },
  };
}

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
   through. */
function RainScene({ reduce }) {
  const drops = useMemo(() => seeded(240, 19), []);
  return (
    <>
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 60% at 50% 0%, rgba(143,184,190,.10), transparent 70%)" }} />
      {[0, 1].map((layer) => (
        <div key={layer} className="absolute inset-0 overflow-hidden" style={{ opacity: layer ? .34 : .6 }}>
          {Array.from({ length: layer ? 18 : 26 }, (_, i) => {
            const a = drops[i * 3 + layer], b = drops[i * 3 + 1], c = drops[i * 3 + 2];
            return (
              <span key={i} className="absolute uv-rain" style={{
                left: `${a * 104 - 2}%`, top: `${-20 - b * 40}%`,
                width: layer ? 1 : 1.4, height: layer ? 26 : 40,
                background: `linear-gradient(180deg, transparent, ${layer ? "rgba(180,214,220,.26)" : "rgba(200,232,238,.42)"})`,
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
        <ellipse cx="90" cy="30" rx="130" ry="52" fill="rgba(12,22,28,.6)" />
        <ellipse cx="300" cy="14" rx="150" ry="56" fill="rgba(14,26,32,.55)" />
      </svg>
      <div className="absolute bottom-0 left-0 right-0 h-[22%]" style={{ background: "linear-gradient(180deg, transparent, rgba(6,14,18,.75))" }} />
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
function SlateScene({ reduce }) {
  const drift = (dur, delay) => ({
    animation: `uvDrift ${dur}s ease-in-out ${delay}s infinite alternate`,
    animationPlayState: reduce ? "paused" : "running",
  });
  return (
    <>
      <div className="absolute rounded-full" style={{
        left: "-25%", top: "-18%", width: "85%", height: "58%",
        background: "radial-gradient(circle, rgba(86,116,168,.30), transparent 68%)",
        filter: "blur(18px)", ...drift(38, 0),
      }} />
      <div className="absolute rounded-full" style={{
        right: "-30%", top: "26%", width: "80%", height: "52%",
        background: "radial-gradient(circle, rgba(58,88,132,.26), transparent 70%)",
        filter: "blur(22px)", ...drift(53, -11),
      }} />
      {/* A single hairline where the glows stop, so the lower half reads as
          ground rather than as the gradient simply running out. */}
      <div className="absolute left-0 right-0" style={{
        top: "62%", height: 1,
        background: "linear-gradient(90deg, transparent, rgba(147,166,194,.22) 22%, rgba(147,166,194,.22) 78%, transparent)",
      }} />
      <div className="absolute inset-0" style={{
        background: "radial-gradient(120% 78% at 50% 42%, transparent 52%, rgba(6,9,14,.72))",
      }} />
    </>
  );
}

/* Motion is its own control now, and OFF is the default. The ground the accent
   makes is the design; a scene is something you add to it, not something you
   have to pick a colour scheme to get. `off` renders the SlateScene glows,
   which are slow enough to read as depth in the background rather than as an
   animation. */
const SCENES = [
  ["off", "None"],
  ["rain", "Rain"],
  ["sky", "Sky"],
  ["deep", "Deep"],
  ["ember", "Ember"],
];

function Scene({ id, t, phase, reduce }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ background: t.page, transition: "background 500ms linear" }}>
      {id === "off" && <SlateScene reduce={reduce} />}
      {id === "sky" && <SkyScene phase={phase} reduce={reduce} />}
      {id === "rain" && <RainScene reduce={reduce} />}
      {id === "deep" && <DeepScene reduce={reduce} />}
      {id === "ember" && <EmberScene reduce={reduce} />}
    </div>
  );
}

/* ═══════════════ DATA ═══════════════ */
const POLLS = [
  { id: "f1", cat: "food", q: "Pineapple on pizza?", o: [["Absolutely", 48210], ["Never", 51930]] },
  { id: "f2", cat: "food", q: "Best thing to eat at 2am", o: [["Pizza", 41220], ["Tacos", 33890], ["Ramen", 19740], ["Cereal", 12310]] },
  { id: "f3", cat: "food", q: "Cilantro tastes like…", o: [["Fresh herbs", 62400], ["Dish soap", 21870]] },
  { id: "f4", cat: "food", q: "Ketchup lives in the fridge or the pantry?", o: [["Fridge", 71340], ["Pantry", 24980]] },
  { id: "f5", cat: "food", q: "Ordering a steak well-done is…", o: [["Fine, let people eat", 39610], ["A crime", 44720]] },
  { id: "f6", cat: "food", q: "Best fast food fries", o: [["McDonald's", 58330], ["Five Guys", 26410], ["Wendy's", 18220], ["Chick-fil-A", 24870]] },
  { id: "f7", cat: "food", q: "Cereal first or milk first?", o: [["Cereal first", 88240], ["Milk first", 7910]] },
  { id: "f8", cat: "food", q: "How long do leftovers last?", o: [["3 days", 34120], ["5 days", 29880], ["Until it smells", 31450]] },

  { id: "t1", cat: "tech", q: "Dark mode or light mode?", o: [["Dark mode", 92140], ["Light mode", 18730]] },
  { id: "t2", cat: "tech", q: "Tabs or spaces?", o: [["Tabs", 27410], ["Spaces", 29880]] },
  { id: "t3", cat: "tech", q: "Will AI be doing your job in ten years?", o: [["Yes", 28110], ["No", 24390], ["It'll change shape", 51220]] },
  { id: "t4", cat: "tech", q: "Phone case?", o: [["Always", 74320], ["Naked phone", 15680]] },
  { id: "t5", cat: "tech", q: "Do you read terms of service?", o: [["Never", 78440], ["Skim it", 14210], ["Every word", 1830]] },
  { id: "t6", cat: "tech", q: "How many browser tabs right now?", o: [["Under 10", 22150], ["10 to 30", 31470], ["I stopped counting", 40320]] },
  { id: "t7", cat: "tech", q: "Wired earbuds are coming back", o: [["Already back", 33290], ["Never leaving wireless", 47160]] },
  { id: "t8", cat: "tech", q: "Password manager or memory?", o: [["Password manager", 52880], ["Same 3 passwords", 38140]] },

  { id: "l1", cat: "life", q: "Shower in the morning or at night?", o: [["Morning", 44280], ["Night", 38910], ["Both", 12440]] },
  { id: "l2", cat: "life", q: "Is a hot dog a sandwich?", o: [["Yes", 34120], ["No", 68450]] },
  { id: "l3", cat: "life", q: "Do you make your bed?", o: [["Every day", 31280], ["Sometimes", 27640], ["Never", 34990]] },
  { id: "l4", cat: "life", q: "Window seat or aisle seat?", o: [["Window", 57320], ["Aisle", 36180]] },
  { id: "l5", cat: "life", q: "Unknown number is calling", o: [["Never answer", 81240], ["Always answer", 6320], ["Only if they call twice", 14870]] },
  { id: "l6", cat: "life", q: "Socks in bed?", o: [["Socks on", 21430], ["Bare feet", 68920]] },
  { id: "l7", cat: "life", q: "How early do you get to the airport?", o: [["1 hour", 18240], ["2 hours", 44310], ["3+ hours", 26780]] },
  { id: "l8", cat: "life", q: "Toilet paper: over or under?", o: [["Over", 76210], ["Under", 13480]] },

  { id: "m1", cat: "money", q: "Tipping has gone too far", o: [["Agree", 79340], ["Disagree", 14120]] },
  { id: "m2", cat: "money", q: "$1,000,000 today or $10,000 a month forever?", o: [["Take the million", 33210], ["Monthly forever", 61470]] },
  { id: "m3", cat: "money", q: "Splitting the bill", o: [["Split it evenly", 41230], ["Pay for what you ordered", 52810]] },
  { id: "m4", cat: "money", q: "Rent forever or buy something you can barely afford?", o: [["Rent forever", 29840], ["Buy and stress", 44170]] },
  { id: "m5", cat: "money", q: "Lottery tickets are…", o: [["A waste", 48210], ["Worth the daydream", 39760]] },
  { id: "m6", cat: "money", q: "Do you know your balance right now?", o: [["To the dollar", 38420], ["Roughly", 41190], ["No idea", 19870]] },
  { id: "m7", cat: "money", q: "Subscription you'd cancel first", o: [["Streaming", 42130], ["Music", 12440], ["Cloud storage", 18760], ["Gym", 27310]] },

  { id: "g1", cat: "games", q: "Best controller ever made", o: [["Xbox", 38210], ["DualSense", 41870], ["Switch Pro", 22140], ["GameCube", 29330]] },
  { id: "g2", cat: "games", q: "Which difficulty do you pick first?", o: [["Easy", 14320], ["Normal", 56780], ["Hardest available", 21440]] },
  { id: "g3", cat: "games", q: "Do you finish the games you start?", o: [["Almost always", 27180], ["Almost never", 58940]] },
  { id: "g4", cat: "games", q: "Open world or tight linear campaign?", o: [["Open world", 48210], ["Linear", 39670]] },
  { id: "g5", cat: "games", q: "$70 for a new game", o: [["Day one", 18320], ["Wait for the sale", 62410], ["Never paying that", 21890]] },
  { id: "g6", cat: "games", q: "Fast travel or walk it?", o: [["Fast travel every time", 54320], ["Walk everywhere", 26180]] },
  { id: "g7", cat: "games", q: "Do you play with chat audio on?", o: [["On", 22410], ["Muted forever", 61380]] },
  { id: "g8", cat: "games", q: "Better ending: sad or happy?", o: [["Sad and earned", 47320], ["Happy, I've had enough", 38210]] },

  { id: "c1", cat: "culture", q: "Movie theater or your couch?", o: [["Theater", 34210], ["Couch", 62480]] },
  { id: "c2", cat: "culture", q: "Subtitles?", o: [["Always on", 64210], ["Only when I need them", 24380], ["Never", 8140]] },
  { id: "c3", cat: "culture", q: "Do you skip the intro?", o: [["Skip every time", 58320], ["Watch it every time", 31470]] },
  { id: "c4", cat: "culture", q: "The book or the movie?", o: [["Book", 51280], ["Movie", 28340]] },
  { id: "c5", cat: "culture", q: "Filming the concert", o: [["One song, then put it away", 44120], ["Just watch it", 41870], ["Film the whole thing", 6210]] },
  { id: "c6", cat: "culture", q: "Rewatch a favorite or start something new?", o: [["Rewatch", 52310], ["Something new", 39840]] },
  { id: "c7", cat: "culture", q: "Best decade for music", o: [["70s", 19240], ["80s", 31480], ["90s", 38210], ["2000s", 24170]] },

  { id: "w1", cat: "weird", q: "Cereal is a soup", o: [["Correct", 21340], ["Get away from me", 68720]] },
  { id: "w2", cat: "weird", q: "Always 20 minutes early or always 5 minutes late?", o: [["Early", 61240], ["Late", 28370]] },
  { id: "w3", cat: "weird", q: "Read minds or turn invisible?", o: [["Read minds", 42180], ["Invisible", 54320]] },
  { id: "w4", cat: "weird", q: "How many days can a shirt go?", o: [["One and done", 41230], ["Two", 34870], ["Three or more", 18240]] },
  { id: "w5", cat: "weird", q: "Do you talk to yourself out loud?", o: [["Constantly", 67420], ["Never", 21180]] },
  { id: "w6", cat: "weird", q: "Delete one month from the calendar forever", o: [["January", 34210], ["February", 41870], ["August", 12340], ["November", 9820]] },
  { id: "w7", cat: "weird", q: "Would you want to know the day you die?", o: [["Tell me", 31240], ["Absolutely not", 62180]] },

  { id: "h1", cat: "takes", q: "Voice notes", o: [["Love them", 28410], ["Just type it", 64230]] },
  { id: "h2", cat: "takes", q: "Text before you call", o: [["Always text first", 71340], ["Just call me", 22180]] },
  { id: "h3", cat: "takes", q: "Reclining your airline seat", o: [["It's my seat", 38210], ["Never do it", 51470]] },
  { id: "h4", cat: "takes", q: "Speaker at the gym", o: [["Headphones only", 84320], ["Speaker is fine", 5210]] },
  { id: "h5", cat: "takes", q: "Reply-all", o: [["Sometimes necessary", 24310], ["Never acceptable", 58420]] },
  { id: "h6", cat: "takes", q: "Is water wet?", o: [["Yes", 54210], ["No", 42870]] },
  { id: "h7", cat: "takes", q: "Group projects", o: [["Fine, actually", 12340], ["Hell on earth", 78210]] },

  /* ── Music ── */
  { id: "mu1", cat: "music", q: "Filming the whole song at a concert", o: [["Let people enjoy it", 21440], ["Put the phone down", 74310]] },
  { id: "mu2", cat: "music", q: "Album front to back or shuffle?", o: [["Front to back", 39820], ["Shuffle", 46170]] },
  { id: "mu3", cat: "music", q: "Best decade for music", o: [["70s", 24310], ["80s", 31870], ["90s", 38240], ["2000s", 27650]] },
  { id: "mu4", cat: "music", q: "A cover can beat the original", o: [["Absolutely", 58120], ["Never", 27430]] },
  { id: "mu5", cat: "music", q: "Music while you work", o: [["Lyrics are fine", 34210], ["Instrumental only", 41880], ["Silence", 22940]] },
  { id: "mu6", cat: "music", q: "Vinyl actually sounds better", o: [["Yes", 29310], ["It's the ritual, not the sound", 52470]] },
  { id: "mu7", cat: "music", q: "Encores are planned and everyone knows it", o: [["Still love them", 44120], ["Just play the song", 33280]] },
  { id: "mu8", cat: "music", q: "Do lyrics matter?", o: [["The whole point", 41230], ["It's about the sound", 39870]] },
  { id: "mu9", cat: "music", q: "Talking during a live set", o: [["Go to a bar", 68420], ["It's a concert, not a library", 18310]] },
  { id: "mu10", cat: "music", q: "Sad songs when you're already sad", o: [["Feeds the mood, in a good way", 62140], ["Makes it worse", 24380]] },
  { id: "mu11", cat: "music", q: "Festival or one band in a small room?", o: [["Festival", 27410], ["Small room", 55290]] },
  { id: "mu12", cat: "music", q: "Skipping a song before it ends", o: [["Constantly", 51230], ["Let it play", 34670]] },
  { id: "mu13", cat: "music", q: "Karaoke", o: [["Hand me the mic", 33240], ["I will watch, thanks", 47120], ["Only after two drinks", 29840]] },
  { id: "mu14", cat: "music", q: "Buying merch at the show", o: [["Every time", 31420], ["Twenty for a shirt?", 44870]] },
  { id: "mu15", cat: "music", q: "Autotune", o: [["It's an instrument", 42310], ["It's a crutch", 38920]] },
  { id: "mu16", cat: "music", q: "The best song on the album is never the single", o: [["True", 61240], ["The single is the single for a reason", 25180]] },
  { id: "mu17", cat: "music", q: "Headphones or speakers at home?", o: [["Headphones", 46310], ["Speakers", 38240]] },
  { id: "mu18", cat: "music", q: "Knowing an artist's politics changes the music", o: [["It does", 44120], ["Separate them", 47380]] },
  { id: "mu19", cat: "music", q: "Songs over five minutes", o: [["Let it breathe", 38420], ["Edit it down", 31270]] },
  { id: "mu20", cat: "music", q: "Live album or studio album?", o: [["Studio", 54120], ["Live", 24310]] },
  { id: "mu21", cat: "music", q: "Your top artist on wrapped is", o: [["Exactly right", 41230], ["Deeply embarrassing", 46780]] },
  { id: "mu22", cat: "music", q: "Music taste says something about a person", o: [["It says a lot", 57310], ["It says nothing", 28420]] },

  /* ── Sports ── */
  { id: "sp1", cat: "sports", q: "Best sport to watch live", o: [["Hockey", 31240], ["Basketball", 34870], ["Football", 38120], ["Baseball", 19340]] },
  { id: "sp2", cat: "sports", q: "Video review", o: [["Get it right", 51230], ["It kills the game", 34870]] },
  { id: "sp3", cat: "sports", q: "You move cities. Your team…", o: [["Stays your team forever", 78420], ["You adopt the new one", 11240]] },
  { id: "sp4", cat: "sports", q: "Is chess a sport?", o: [["Yes", 34120], ["No", 52380]] },
  { id: "sp5", cat: "sports", q: "Is esports a sport?", o: [["Yes", 38470], ["No", 47120]] },
  { id: "sp6", cat: "sports", q: "Booing your own team", o: [["They earned it", 29310], ["Never", 54270]] },
  { id: "sp7", cat: "sports", q: "Regular season or playoffs?", o: [["Playoffs, obviously", 64230], ["Regular season is the real test", 21870]] },
  { id: "sp8", cat: "sports", q: "The halftime show", o: [["Part of the event", 41230], ["Bathroom break", 39870]] },
  { id: "sp9", cat: "sports", q: "Athlete pay", o: [["Worth every cent", 42310], ["Wildly out of hand", 44280]] },
  { id: "sp10", cat: "sports", q: "Fantasy leagues make you watch more", o: [["Way more", 51240], ["Ruins watching the actual game", 27380]] },
  { id: "sp11", cat: "sports", q: "Highlights or the full game?", o: [["Full game", 44120], ["Highlights are enough", 41870]] },
  { id: "sp12", cat: "sports", q: "The wave in the stands", o: [["Fun", 27310], ["Please stop", 58240]] },
  { id: "sp13", cat: "sports", q: "Golf", o: [["A real sport", 44230], ["A walk with equipment", 39180]] },
  { id: "sp14", cat: "sports", q: "Should refs ever explain a call?", o: [["Yes, out loud, every time", 71240], ["It would slow everything down", 14380]] },
  { id: "sp15", cat: "sports", q: "Stadium food at stadium prices", o: [["Part of the day", 34210], ["Eat before you go", 52840]] },
  { id: "sp16", cat: "sports", q: "Resting stars in the regular season", o: [["Smart", 31240], ["Fans paid for that ticket", 54120]] },
  { id: "sp17", cat: "sports", q: "Ties", o: [["Fine, it's a draw", 27410], ["Play until someone wins", 58230]] },
  { id: "sp18", cat: "sports", q: "Front-running a winning team", o: [["Everyone starts somewhere", 32180], ["Bandwagon", 51240]] },
  { id: "sp19", cat: "sports", q: "The best rivalry is", o: [["Same city", 41230], ["Same division", 28470], ["Two players", 31840]] },
  { id: "sp20", cat: "sports", q: "Sports gambling ads", o: [["Whatever, it's ads", 18240], ["Way too far", 68310]] },
  { id: "sp21", cat: "sports", q: "Watching with a crowd or alone?", o: [["Crowd", 54120], ["Alone, no commentary", 31280]] },
  { id: "sp22", cat: "sports", q: "A goalie is the most important player", o: [["Yes", 44120], ["No", 38270]] },

  /* ── Love ── */
  { id: "lv1", cat: "love", q: "Splitting the bill on a first date", o: [["Split it", 48210], ["Whoever asked pays", 44370]] },
  { id: "lv2", cat: "love", q: "How long before a text back is too long?", o: [["An hour", 24310], ["A few hours", 41870], ["A day", 32140], ["Whenever", 18420]] },
  { id: "lv3", cat: "love", q: "Meeting on an app", o: [["Completely normal", 71240], ["Still prefer real life", 24380]] },
  { id: "lv4", cat: "love", q: "Long distance", o: [["Can absolutely work", 52310], ["Ends the same way", 38470]] },
  { id: "lv5", cat: "love", q: "Looking through their phone", o: [["Never", 68420], ["If you have a reason", 24310]] },
  { id: "lv6", cat: "love", q: "Do opposites attract?", o: [["Yes", 34120], ["Shared values win", 62380]] },
  { id: "lv7", cat: "love", q: "Public proposals", o: [["Romantic", 27410], ["Enormous pressure", 61240]] },
  { id: "lv8", cat: "love", q: "Staying friends with an ex", o: [["Sure", 31840], ["Not really", 48210], ["Depends how it ended", 41270]] },
  { id: "lv9", cat: "love", q: "Big wedding or run off and elope?", o: [["Big wedding", 38240], ["Elope", 47120]] },
  { id: "lv10", cat: "love", q: "Love at first sight", o: [["Real", 34210], ["That's attraction, not love", 58470]] },
  { id: "lv11", cat: "love", q: "Texting every single day", o: [["Yes, that's the point", 44230], ["Space is healthy", 41180]] },
  { id: "lv12", cat: "love", q: "Move in before getting engaged", o: [["Obviously", 64310], ["Wait", 21470]] },
  { id: "lv13", cat: "love", q: "Best first date", o: [["Coffee", 38210], ["Dinner", 27340], ["A walk", 31870], ["Something with an activity", 34120]] },
  { id: "lv14", cat: "love", q: "Ghosting", o: [["Sometimes the kindest exit", 14320], ["Just say something", 74210]] },
  { id: "lv15", cat: "love", q: "Posting your relationship online", o: [["Share it", 27410], ["Keep it off there", 54280]] },
  { id: "lv16", cat: "love", q: "Separate beds, same relationship", o: [["Sleep matters more", 41230], ["Same bed always", 44870]] },
  { id: "lv17", cat: "love", q: "Go to bed angry?", o: [["Never", 44120], ["Sleep on it and talk tomorrow", 51380]] },
  { id: "lv18", cat: "love", q: "Sharing passwords", o: [["Normal", 34210], ["Everyone gets privacy", 52470]] },
  { id: "lv19", cat: "love", q: "A ten year age gap at forty", o: [["Fine", 51240], ["Still odd", 31870]] },
  { id: "lv20", cat: "love", q: "Pet names", o: [["Cute", 47210], ["In public? No", 38340]] },
  { id: "lv21", cat: "love", q: "Who says it first?", o: [["Whoever feels it", 68420], ["Wait for them", 17310]] },
  { id: "lv22", cat: "love", q: "Do you need shared hobbies?", o: [["Helps a lot", 44230], ["Have your own thing", 51170]] },

  /* ── Food ── */
  { id: "f11", cat: "food", q: "Ketchup in the fridge or the cupboard?", o: [["Fridge", 62310], ["Cupboard", 28470]] },
  { id: "f12", cat: "food", q: "Well done steak", o: [["Your money, your steak", 34210], ["A crime", 51870]] },
  { id: "f13", cat: "food", q: "Breakfast for dinner", o: [["Elite", 71240], ["Wrong meal, wrong time", 14380]] },
  { id: "f14", cat: "food", q: "Is a hot dog a sandwich?", o: [["Yes", 31240], ["No", 58470]] },
  { id: "f15", cat: "food", q: "Cereal: milk first or last?", o: [["Cereal first", 74210], ["Milk first", 12340]] },
  { id: "f16", cat: "food", q: "Leftover pizza", o: [["Cold, straight from the box", 44120], ["Reheated properly", 47380]] },
  { id: "f17", cat: "food", q: "Tipping at a counter", o: [["Tip anyway", 38210], ["Not for handing me a coffee", 51470]] },
  { id: "f18", cat: "food", q: "Cooking for one", o: [["Worth the effort", 41230], ["Toast is a meal", 44870]] },
  { id: "f19", cat: "food", q: "The best fry is", o: [["Thin and crispy", 44210], ["Thick and fluffy", 38340], ["Curly", 27120]] },
  { id: "f20", cat: "food", q: "Do you eat the crusts?", o: [["Yes", 61240], ["Never", 24380]] },
  { id: "f21", cat: "food", q: "Sparkling water", o: [["Delicious", 41230], ["Spicy water, no thanks", 38470]] },
  { id: "f22", cat: "food", q: "The best sandwich needs", o: [["Something crunchy", 51240], ["Something saucy", 44180]] },
  { id: "f23", cat: "food", q: "Restaurants with no menu prices", o: [["Fine at that level", 12310], ["Absolutely not", 68420]] },
  { id: "f24", cat: "food", q: "Meal prep for the week", o: [["Life changing", 47210], ["Day four tastes like regret", 41870]] },
  { id: "f25", cat: "food", q: "Coffee order", o: [["Black", 34120], ["Milk, no sugar", 41870], ["Something with syrup", 28340]] },
  { id: "f26", cat: "food", q: "Eating alone at a restaurant", o: [["Genuinely nice", 54210], ["Too exposed", 31470]] },

  /* ── Tech ── */
  { id: "t11", cat: "tech", q: "Dark mode everywhere?", o: [["Always", 78240], ["Light mode is fine", 18310]] },
  { id: "t12", cat: "tech", q: "Inbox zero", o: [["The only way", 31240], ["I have 40,000 unread", 54870]] },
  { id: "t13", cat: "tech", q: "Do you read the terms?", o: [["Yes", 4210], ["Nobody does", 88470]] },
  { id: "t14", cat: "tech", q: "Phone face up or face down?", o: [["Face down", 61230], ["Face up", 27480]] },
  { id: "t15", cat: "tech", q: "Notifications", o: [["All on", 14320], ["A curated few", 51240], ["Everything off", 34870]] },
  { id: "t16", cat: "tech", q: "Best place for a password", o: [["Manager", 62410], ["My head", 24380], ["A notebook", 11240]] },
  { id: "t17", cat: "tech", q: "Voice assistants", o: [["Use them daily", 27310], ["Never talk to them", 58470]] },
  { id: "t18", cat: "tech", q: "Upgrading your phone", o: [["Every couple of years", 34120], ["Until it dies", 58370]] },
  { id: "t19", cat: "tech", q: "Tabs open right now", o: [["Under ten", 34210], ["Dozens", 41870], ["I stopped counting", 28340]] },
  { id: "t20", cat: "tech", q: "Video call with camera on", o: [["On", 31240], ["Off unless required", 58470]] },
  { id: "t21", cat: "tech", q: "Smart home gadgets", o: [["Worth it", 38210], ["More things to break", 47380]] },
  { id: "t22", cat: "tech", q: "Autoplay next episode", o: [["Keep it rolling", 44230], ["Let me choose", 41180]] },
  { id: "t23", cat: "tech", q: "Typing speed matters", o: [["Yes", 41230], ["Thinking is the bottleneck", 51470]] },
  { id: "t24", cat: "tech", q: "Do you back anything up?", o: [["Automatically", 44210], ["I live dangerously", 41870]] },
  { id: "t25", cat: "tech", q: "Buying the extended warranty", o: [["Sometimes", 24310], ["Never", 61240]] },
  { id: "t26", cat: "tech", q: "Screen time reports", o: [["Useful", 31240], ["I close them immediately", 58470]] },

  /* ── Life ── */
  { id: "l11", cat: "life", q: "Early bird or night owl?", o: [["Early", 41230], ["Night", 51870]] },
  { id: "l12", cat: "life", q: "Do you use an alarm on weekends?", o: [["Yes", 27410], ["Absolutely not", 61240]] },
  { id: "l13", cat: "life", q: "Small talk", o: [["It's how things start", 38210], ["Physically painful", 51470]] },
  { id: "l14", cat: "life", q: "Arriving at the airport", o: [["Three hours early", 34120], ["Cutting it fine", 27480], ["Two hours, like a normal person", 41870]] },
  { id: "l15", cat: "life", q: "Making the bed", o: [["Every morning", 51240], ["Why, I'm getting back in", 38470]] },
  { id: "l16", cat: "life", q: "Group chats", o: [["Love them", 31240], ["Muted forever", 58370]] },
  { id: "l17", cat: "life", q: "Calling instead of texting", o: [["Faster", 27410], ["Text me first", 68240]] },
  { id: "l18", cat: "life", q: "Do you keep a to-do list?", o: [["Written down", 51230], ["It's all in my head", 41870]] },
  { id: "l19", cat: "life", q: "Cancelled plans", o: [["Disappointing", 21340], ["The best feeling", 68470]] },
  { id: "l20", cat: "life", q: "Moving somewhere you know nobody", o: [["Do it once", 58210], ["Not for me", 31470]] },
  { id: "l21", cat: "life", q: "Sunday", o: [["Rest", 51230], ["Reset for the week", 44870]] },
  { id: "l22", cat: "life", q: "Reading before bed", o: [["Every night", 44120], ["Phone until I pass out", 51380]] },
  { id: "l23", cat: "life", q: "Do you name your car?", o: [["Of course", 34210], ["It's a car", 51470]] },
  { id: "l24", cat: "life", q: "Keeping the thermostat", o: [["Cold, add blankets", 58240], ["Warm", 34310]] },
  { id: "l25", cat: "life", q: "Handwriting", o: [["Still write by hand", 41230], ["I've forgotten how", 44870]] },
  { id: "l26", cat: "life", q: "Saying no to things", o: [["Getting better at it", 68210], ["Still agree to everything", 27470]] },
  { id: "l27", cat: "life", q: "Shoes on inside the house", o: [["Off at the door", 78420], ["Keep them on", 12310]] },
  { id: "l28", cat: "life", q: "Getting older", o: [["Better every year", 51240], ["I'd take twenty-five again", 38470]] },

  /* ── Money ── */
  { id: "m11", cat: "money", q: "Talking about salary with friends", o: [["Everyone should", 51230], ["Too awkward", 41870]] },
  { id: "m12", cat: "money", q: "Rent forever or buy anything?", o: [["Buy something", 61240], ["Rent and stay flexible", 28470]] },
  { id: "m13", cat: "money", q: "The 20% tip default", o: [["Fair", 34210], ["Out of control", 54870]] },
  { id: "m14", cat: "money", q: "Subscriptions you forgot about", o: [["None, I audit them", 27310], ["Certainly some", 64240]] },
  { id: "m15", cat: "money", q: "Buy now, pay later", o: [["Useful", 18420], ["A trap", 68310]] },
  { id: "m16", cat: "money", q: "Splitting a group dinner bill", o: [["Evenly, stop counting", 51240], ["Pay for what you ordered", 44870]] },
  { id: "m17", cat: "money", q: "Cash", o: [["Still carry some", 41230], ["Haven't touched it in years", 51470]] },
  { id: "m18", cat: "money", q: "An expensive coffee every day", o: [["Small joy, worth it", 58210], ["That's a holiday a year", 34470]] },
  { id: "m19", cat: "money", q: "Lending money to a friend", o: [["Give it, don't lend it", 61230], ["Lend and expect it back", 27870]] },
  { id: "m20", cat: "money", q: "Do you know your credit score?", o: [["Exactly", 51240], ["No idea", 38470]] },
  { id: "m21", cat: "money", q: "Extended family gift limits", o: [["Set a number", 64210], ["Spend what you want", 24380]] },
  { id: "m22", cat: "money", q: "Best money advice", o: [["Spend less", 41230], ["Earn more", 44870]] },
  { id: "m23", cat: "money", q: "Buying the cheapest version first", o: [["Buy once, cry once", 58240], ["Cheap until you know you need better", 34310]] },
  { id: "m24", cat: "money", q: "Retirement feels", o: [["Planned for", 31240], ["Theoretical", 58470]] },
  { id: "m25", cat: "money", q: "Haggling", o: [["Always try", 34210], ["Just pay the price", 51470]] },
  { id: "m26", cat: "money", q: "A raise or an extra week off?", o: [["Raise", 44230], ["The week", 47180]] },

  /* ── Games ── */
  { id: "g11", cat: "games", q: "Difficulty setting", o: [["Normal", 51240], ["Hardest available", 27470], ["Story mode, I'm here for the plot", 31840]] },
  { id: "g12", cat: "games", q: "Fast travel", o: [["Use it constantly", 61230], ["Walk, it's the world", 24870]] },
  { id: "g13", cat: "games", q: "Do you finish games?", o: [["To the credits", 34210], ["Eighty percent, then something new", 58470]] },
  { id: "g14", cat: "games", q: "Remakes", o: [["Yes, more", 44120], ["Make something new", 41380]] },
  { id: "g15", cat: "games", q: "Skipping cutscenes", o: [["Never", 51240], ["Immediately", 34870]] },
  { id: "g16", cat: "games", q: "Controller or keyboard?", o: [["Controller", 47210], ["Keyboard and mouse", 44380]] },
  { id: "g17", cat: "games", q: "Open world size", o: [["Bigger", 24310], ["Smaller and denser", 68240]] },
  { id: "g18", cat: "games", q: "Early access", o: [["Support it", 27410], ["Wait for 1.0", 58370]] },
  { id: "g19", cat: "games", q: "Multiplayer with strangers", o: [["Fine", 31240], ["Friends only", 58470]] },
  { id: "g20", cat: "games", q: "Buying a game at full price", o: [["Day one", 34210], ["Wait for the sale", 61470]] },
  { id: "g21", cat: "games", q: "Mods", o: [["Half the reason to play", 51230], ["Vanilla", 34870]] },
  { id: "g22", cat: "games", q: "Games as a hobby vs a habit", o: [["Hobby", 58240], ["Honestly a habit", 34310]] },
  { id: "g23", cat: "games", q: "Turn-based combat", o: [["Underrated", 51240], ["Too slow", 34870]] },
  { id: "g24", cat: "games", q: "Achievement hunting", o: [["100% or nothing", 27410], ["Never look at them", 51240]] },
  { id: "g25", cat: "games", q: "Best way to play a horror game", o: [["Lights off, headphones", 61230], ["Broad daylight, volume low", 24870]] },
  { id: "g26", cat: "games", q: "Tutorials", o: [["Teach me properly", 51240], ["Let me figure it out", 38470]] },

  /* ── Culture ── */
  { id: "c11", cat: "culture", q: "Subtitles on", o: [["Always", 71240], ["Only if I need them", 24380]] },
  { id: "c12", cat: "culture", q: "Talking in the cinema", o: [["A whisper is fine", 14310], ["Silence", 78420]] },
  { id: "c13", cat: "culture", q: "Book before the film?", o: [["Book first", 51230], ["Doesn't matter", 41870]] },
  { id: "c14", cat: "culture", q: "Binge or weekly episodes?", o: [["All at once", 47210], ["Weekly, let it breathe", 44380]] },
  { id: "c15", cat: "culture", q: "Rewatching things you love", o: [["Constantly", 68240], ["Too much new stuff", 24310]] },
  { id: "c16", cat: "culture", q: "Do you finish a bad book?", o: [["Push through", 27410], ["Put it down", 61240]] },
  { id: "c17", cat: "culture", q: "Museums", o: [["Take all day", 44230], ["Ninety minutes, max", 41180]] },
  { id: "c18", cat: "culture", q: "Reviews before watching", o: [["Read them", 31240], ["Go in blind", 58470]] },
  { id: "c19", cat: "culture", q: "Sequels", o: [["Usually worse", 61230], ["Often better", 24870]] },
  { id: "c20", cat: "culture", q: "Theatre or the couch?", o: [["Big screen", 44120], ["My own sofa", 47380]] },
  { id: "c21", cat: "culture", q: "Spoilers a year later", o: [["Statute of limitations", 51240], ["Still rude", 38470]] },
  { id: "c22", cat: "culture", q: "Audiobooks count as reading", o: [["Yes", 58210], ["No", 34470]] },
  { id: "c23", cat: "culture", q: "Awards shows", o: [["Fun", 21340], ["Meaningless", 58470]] },
  { id: "c24", cat: "culture", q: "Three hour films", o: [["If it earns it", 51230], ["Nothing needs three hours", 38870]] },
  { id: "c25", cat: "culture", q: "The book was better", o: [["Almost always", 61240], ["Overrated as a take", 27380]] },
  { id: "c26", cat: "culture", q: "Physical media in 2026", o: [["Own your things", 54210], ["Streaming is fine", 34470]] },

  /* ── Weird ── */
  { id: "w11", cat: "weird", q: "Would you read the last page first?", o: [["Sometimes", 21340], ["Monstrous", 61470]] },
  { id: "w12", cat: "weird", q: "Same meal every day for a year for $50k", o: [["Easy money", 58210], ["Not a chance", 34470]] },
  { id: "w13", cat: "weird", q: "Fight one horse-sized duck or a hundred duck-sized horses?", o: [["The duck", 41230], ["The horses", 44870]] },
  { id: "w14", cat: "weird", q: "Would you want to be famous?", o: [["Yes", 24310], ["Absolutely not", 68240]] },
  { id: "w15", cat: "weird", q: "Talking to yourself out loud", o: [["Constantly", 61240], ["Never", 24380]] },
  { id: "w16", cat: "weird", q: "A button that pays $1m but a stranger loses their job", o: [["No", 58470], ["Yes", 31240]] },
  { id: "w17", cat: "weird", q: "Do ghosts exist?", o: [["Something's out there", 41230], ["No", 51870]] },
  { id: "w18", cat: "weird", q: "Living to 150 in good health", o: [["Sign me up", 51240], ["Too long", 38470]] },
  { id: "w19", cat: "weird", q: "Reading minds or being invisible?", o: [["Minds", 34210], ["Invisible", 51470]] },
  { id: "w20", cat: "weird", q: "Would you go to Mars, one way?", o: [["Yes", 18320], ["No", 71240]] },
  { id: "w21", cat: "weird", q: "Cereal is soup", o: [["Yes", 24310], ["No", 68470]] },
  { id: "w22", cat: "weird", q: "Do you believe in luck?", o: [["Yes", 44230], ["It's just variance", 47180]] },
  { id: "w23", cat: "weird", q: "Sleep two hours a night with no downside", o: [["Take it", 61240], ["I like sleeping", 28470]] },
  { id: "w24", cat: "weird", q: "Would you watch a recording of your whole life?", o: [["Yes", 38210], ["Terrifying", 51470]] },
  { id: "w25", cat: "weird", q: "Is a straw one hole or two?", o: [["One", 51240], ["Two", 38470]] },
  { id: "w26", cat: "weird", q: "Knowing exactly when you'd die", o: [["Tell me", 27410], ["Never", 64240]] },

  /* ── Hot takes ── */
  { id: "h8", cat: "takes", q: "Standing ovations", o: [["Earned", 24310], ["Automatic and meaningless", 58470]] },
  { id: "h9", cat: "takes", q: "Voice notes", o: [["Efficient", 31240], ["Just type it", 61470]] },
  { id: "h10", cat: "takes", q: "Open plan offices", o: [["Collaborative", 11240], ["A mistake", 74310]] },
  { id: "h11", cat: "takes", q: "Meetings that could be an email", o: [["Some need a room", 27410], ["Nearly all of them", 68240]] },
  { id: "h12", cat: "takes", q: "Aisle or window?", o: [["Window", 51230], ["Aisle", 44870]] },
  { id: "h13", cat: "takes", q: "Clapping when the plane lands", o: [["Charming", 21340], ["Please don't", 64470]] },
  { id: "h14", cat: "takes", q: "Adults with no hobbies", o: [["Fine", 24310], ["A warning sign", 51240]] },
  { id: "h15", cat: "takes", q: "Sending a follow-up text before a reply", o: [["Normal", 27410], ["Let them breathe", 58470]] },
  { id: "h16", cat: "takes", q: "Being on time means", o: [["Five minutes early", 68240], ["On the hour exactly", 24310]] },
  { id: "h17", cat: "takes", q: "Small dogs", o: [["Real dogs", 54210], ["Not really", 31470]] },
  { id: "h18", cat: "takes", q: "Reading the room is a skill you can learn", o: [["Yes", 61230], ["You have it or you don't", 27870]] },
  { id: "h19", cat: "takes", q: "Punctuality in a group of six", o: [["Everyone waits", 34210], ["Order without them", 51470]] },
  { id: "h20", cat: "takes", q: "Sharing a bill for a meal you didn't drink at", o: [["Split anyway", 27410], ["Pay your share only", 61240]] },
  { id: "h21", cat: "takes", q: "Unsolicited advice", o: [["Usually helpful", 14320], ["Almost never wanted", 71240]] },
  { id: "h22", cat: "takes", q: "Escalator etiquette", o: [["Stand right, walk left", 81240], ["Stand wherever", 9310]] },
  { id: "h23", cat: "takes", q: "Answering a phone on speaker in public", o: [["Fine", 8420], ["Never", 84310]] },
  { id: "h24", cat: "takes", q: "Saving a seat for someone not there yet", o: [["Reasonable", 34210], ["First come, first served", 51470]] },
  { id: "h25", cat: "takes", q: "Overhead bin space", o: [["Above your own row or nothing", 71240], ["Anywhere it fits", 18310]] },
  { id: "h26", cat: "takes", q: "The customer is always right", o: [["There's truth in it", 14320], ["Has ruined service jobs", 74210]] },
  { id: "h27", cat: "takes", q: "Birthdays after thirty", o: [["Still celebrate properly", 51240], ["Quiet dinner, that's it", 44870]] },
];

const HANDLES = ["@mothlight", "@dial_tone", "@quietstorm", "@paperclip", "@nine_volt", "@saltflat"];
const byline = (id) => {
  const s = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return s % 3 === 0 ? HANDLES[s % HANDLES.length] : null; // null = anonymous
};

const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString();

const Ico = {
  plus: (c) => <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke={c} strokeWidth="2.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  grid: (c) => <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h11M4 18h7" /></svg>,
  gear: (c) => <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3.2" /><path d="M12 3v2.1M12 18.9V21M4.2 7.5l1.8 1.1M18 15.4l1.8 1.1M4.2 16.5l1.8-1.1M18 8.6l1.8-1.1" /></svg>,
  share: (c) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M8 8l4-4 4 4M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5" /></svg>,
  flag: (c) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4M5 5h11l-2 3.5L16 12H5" /></svg>,
  undo: (c) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h11a4.5 4.5 0 010 9h-5M4 9l4-4M4 9l4 4" /></svg>,
  user: (c) => <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8.5" r="3.6" /><path d="M4.8 20a7.4 7.4 0 0114.4 0" /></svg>,
  close: (c) => <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  sun: (c) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" /></svg>,
  dots: (c) => <svg viewBox="0 0 24 24" width="19" height="19" fill={c}><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>,
  back: (c) => <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>,
};

function useCounter(target, run, reduce) {
  const [v, setV] = useState(run ? target : 0);
  const prev = useRef(target);
  useEffect(() => {
    if (!run) { setV(0); prev.current = 0; return; }
    if (reduce) { setV(target); prev.current = target; return; }
    const from = prev.current, d = target - from, t0 = performance.now();
    let raf;
    const step = (t) => { const p = Math.min(1, (t - t0) / 540); setV(from + d * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step); else prev.current = target; };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, reduce]);
  return v;
}

/* ═══════════════ BAND ═══════════════ */
function Band({ opt, count, pct, rank, top, height, ramp, C, voted, mine, onVote, reduce, key1 }) {
  const shown = useCounter(pct, voted, reduce);
  const bg = voted ? ramp[Math.min(rank, 3)] : null;
  const fg = voted ? inkOn(bg) : C.ink;
  const ease = "cubic-bezier(.22,1,.36,1)";
  return (
    <button type="button" onClick={onVote} disabled={voted}
      aria-label={`${opt}${voted ? `, ${Math.round(pct)} percent, ${count} votes` : ""}`}
      className="absolute left-0 right-0 rounded-[20px] border text-left overflow-hidden focus:outline-none focus-visible:ring-2"
      style={{
        top: `${top}%`, height: `calc(${height}% - 9px)`,
        background: voted ? bg : C.glass, color: fg,
        backdropFilter: voted ? "none" : "blur(14px)",
        borderColor: voted ? "transparent" : C.glassEdge,
        cursor: voted ? "default" : "pointer",
        transition: reduce ? "none" : `top 620ms ${ease}, height 620ms ${ease}, background-color 340ms, color 340ms, border-color 340ms`,
      }}>
      <div className="h-full w-full px-4 flex items-center gap-3">
        {!voted && (
          <span className="shrink-0 w-6 h-6 rounded-lg grid place-items-center"
            style={{ fontFamily: "var(--mono)", fontSize: 11, background: C.faint, color: C.ink }}>{key1}</span>
        )}
        <span className="flex-1 leading-tight" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 17, letterSpacing: "-.012em" }}>{opt}</span>
        {voted && (
          <span className="shrink-0 text-right leading-none">
            <span style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 500, letterSpacing: "-.03em" }}>
              {Math.round(shown)}<span style={{ fontSize: 14, opacity: .6 }}>%</span>
            </span>
            <span className="block mt-1" style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: .58 }}>{fmt(count)}</span>
          </span>
        )}
      </div>
      {voted && mine && <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: fg, opacity: .8 }} />}
      {voted && mine && (
        <span className="absolute right-0 top-0 px-2 py-1 rounded-bl-[12px]"
          style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", background: fg, color: bg }}>YOURS</span>
      )}
    </button>
  );
}

/* ═══════════════ CARD ═══════════════ */
function Card({ poll, choice, onVote, onChange, canChange, changesLeft, flagged, bump, reduce, active, T, C, topRow }) {
  const accent = mix(CAT_HEX[poll.cat], T.blend, T.amt);
  const ramp = [accent, mix(accent, T.shade, .38), mix(accent, T.shade, .58), mix(accent, T.shade, .72)];
  const voted = choice !== undefined;
  const counts = poll.o.map((o, i) => o[1] + (bump?.[i] || 0));
  const sum = counts.reduce((a, b) => a + b, 0);
  const pcts = counts.map((c) => (sum ? (c / sum) * 100 : 100 / counts.length));
  const order = voted ? counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a]) : counts.map((_, i) => i);

  const layout = useMemo(() => {
    const n = poll.o.length, floor = n >= 4 ? 15 : n === 3 ? 19 : 26;
    const raw = voted ? order.map((i) => Math.max(pcts[i], floor)) : order.map(() => 100 / n);
    const t = raw.reduce((a, b) => a + b, 0);
    let acc = 0;
    return order.map((i, k) => { const height = (raw[k] / t) * 100, top = acc; acc += height; return { i, rank: k, top, height }; });
  }, [voted, order.join(), pcts.join(), poll.o.length]);

  const myPct = voted ? pcts[choice] : 0;
  const verdict = !voted ? null
    : myPct >= 62 ? "You're with the crowd"
    : myPct >= 46 ? `Dead split — you're in the ${Math.round(myPct)}%`
    : myPct >= 25 ? `You're in the ${Math.round(myPct)}%`
    : `Only ${Math.round(myPct)}% are with you`;

  const who = poll.by !== undefined ? poll.by : byline(poll.id);
  const chipBg = mix(accent, T.shade, .12);

  return (
    <section className="relative w-full shrink-0 snap-start grid" style={{ height: "100%", gridTemplateRows: `${topRow}px 1fr` }}>
      {/* top half — read only */}
      <div className="px-4 pt-3 pb-3 min-h-0">
        <div className="h-full w-full rounded-[28px] px-6 py-6 flex flex-col justify-between overflow-hidden border"
          style={{
            background: C.glass, borderColor: C.glassEdge, color: C.ink,
            backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            boxShadow: T.light ? "0 14px 40px rgba(40,34,28,.12)" : "0 14px 44px rgba(0,0,0,.35)",
            transition: "background 500ms, border-color 500ms, color 500ms",
          }}>
          <div className="flex items-center justify-between">
            <span className="px-2.5 py-1 rounded-full" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", background: chipBg, color: inkOn(chipBg) }}>
              {CAT_LABEL[poll.cat].toUpperCase()}
            </span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: .55 }}>
              {sum ? `${fmt(sum)} votes` : "be first"}{voted && sum ? " · live" : ""}
            </span>
          </div>
          <div>
            <h2 style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: poll.q.length > 42 ? 29 : 35, lineHeight: 1.04, letterSpacing: "-.04em" }}>{poll.q}</h2>
            <p className="mt-3" style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: .45 }}>
              asked by {who || "anonymous"}
            </p>
          </div>
        </div>
      </div>

      {/* bottom half — every control */}
      <div className="relative px-4 pb-2 flex flex-col min-h-0">
        <div className="relative flex-1 min-h-0">
          {layout.map(({ i, rank, top, height }) => (
            <Band key={poll.id + i} opt={poll.o[i][0]} count={counts[i]} pct={pcts[i]} rank={rank}
              top={top} height={height} ramp={ramp} C={C} voted={voted} mine={choice === i}
              onVote={() => onVote(i)} reduce={reduce} key1={i + 1} />
          ))}
        </div>

        {/* Verdict line and the one-time change. Share and report used to sit
            here as two floating circles on every card; they live in the dock's
            actions button now, so the card carries nothing that is not about
            this question. */}
        <div className="h-10 shrink-0 flex items-center justify-between gap-2 px-1">
          <span className="truncate min-w-0" style={{
            fontFamily: "var(--mono)", fontSize: 11, color: C.ink,
            opacity: voted ? 0 : .55,
            animation: verdict && !reduce ? "uvIn 460ms 400ms forwards" : "none",
          }}>{verdict}</span>

          <span className="flex items-center gap-1.5 shrink-0">
            {voted && canChange && (
              <button onClick={onChange} className="flex items-center gap-1.5 pl-2.5 pr-3 h-9 rounded-full"
                style={{ background: C.faint, color: C.ink, fontFamily: "var(--mono)", fontSize: 11 }}>
                {Ico.undo(C.ink)} change{changesLeft <= 2 ? ` · ${changesLeft} left today` : ""}
              </button>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════ SHEETS ═══════════════ */
/* `actions` renders top-right of the sheet head, beside the title. Everything
   in a sheet is inside the bottom 50% by construction, so controls are allowed
   here in a way they are not in the header or the question card. */
function Sheet({ title, sub, C, onClose, children, footer, actions }) {
  return (
    <div className="absolute inset-0 z-40">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" style={{ background: C.scrim, backdropFilter: "blur(2px)" }} />
      {/* Swipe DOWN to dismiss, or swipe RIGHT the way "back" goes. The grab
          handle above the title is the affordance for the first and was
          previously decorative. */}
      <div className="absolute left-0 right-0 bottom-0 flex flex-col rounded-t-[28px] overflow-hidden"
        style={{ height: "50%", background: C.sheet, animation: "uvUp 320ms cubic-bezier(.22,1,.36,1)" }}
        {...swipeHandlers({ onDown: onClose, onRight: onClose })}>
        <div className="px-5 pt-4 pb-3 shrink-0">
          <div className="mx-auto w-9 h-1 rounded-full mb-4" style={{ background: C.faint }} />
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h3 style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 21, color: C.ink, letterSpacing: "-.04em" }}>{title}</h3>
              {sub && <p className="mt-1" style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted }}>{sub}</p>}
            </div>
            {actions && <span className="flex items-center gap-1.5 shrink-0">{actions}</span>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto uv-nobar px-5 min-h-0">{children}</div>
        {footer && <div className="px-5 pt-2 pb-4 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
/* Round icon button for a sheet's head row. */
const HeadBtn = ({ C, onClick, label, on, children }) => (
  <button onClick={onClick} aria-label={label} title={label}
    className="w-10 h-10 rounded-full grid place-items-center shrink-0"
    style={{ background: on ? C.ink : C.faint, color: on ? C.sheet : C.ink }}>{children}</button>
);
const Flat = ({ C, onClick, label }) => (
  <button onClick={onClick} className="w-full py-3.5 rounded-2xl" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 15, background: C.faint, color: C.ink }}>{label}</button>
);

/* One window, two panes. The dock's left button opens it; the head row carries
   the pane toggle and the close button, in that order, so close stays furthest
   right where it is on every other sheet.
   `allowCategories` is false on the profile, where filtering the feed you are
   not looking at is a control with nothing to act on — there it opens straight
   to Look and feel with no toggle at all. */
function SettingsSheet({ C, look, setLook, cats, setCats, counts, sort, setSort, onClose, allowCategories }) {
  const [pane, setPane] = useState(allowCategories ? "cats" : "look");
  const showing = allowCategories ? pane : "look";
  const isCats = showing === "cats";

  /* Multi-select. Everything is not a category, it is the absence of a
     filter — selecting it clears the set, and clearing the set is what
     "everything" means everywhere else in the app. So the last category you
     switch off lands you back on everything rather than on an empty feed. */
  const toggle = (k) => {
    if (k === "all") { setCats(new Set()); return; }
    setCats((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  return (
    <Sheet C={C} onClose={onClose}
      title={isCats ? "What are we arguing about?" : "Look and feel"}
      sub={isCats ? "Pick as many as you like" : "One colour; motion is up to you"}
      actions={
        <>
          {allowCategories && (
            <HeadBtn C={C} onClick={() => setPane(isCats ? "look" : "cats")}
              label={isCats ? "Look and feel" : "Categories"}>
              {isCats ? Ico.sun(C.ink) : Ico.grid(C.ink)}
            </HeadBtn>
          )}
          <HeadBtn C={C} onClick={onClose} label="Close">{Ico.close(C.ink)}</HeadBtn>
        </>
      }
      footer={<Flat C={C} onClick={onClose} label="Done" />}>

      {isCats ? (
        <>
        <div className="grid grid-cols-2 gap-2">
          {["all", ...CAT_ORDER].map((k) => {
            const on = k === "all" ? cats.size === 0 : cats.has(k);
            return (
              <button key={k} onClick={() => toggle(k)} aria-pressed={on}
                className="flex items-center justify-between px-3.5 py-3 rounded-2xl border"
                style={{ background: on ? C.ink : "transparent", borderColor: on ? "transparent" : C.edge, color: on ? C.sheet : C.ink }}>
                <span className="flex items-center gap-2">
                  {k !== "all" && <span className="w-2.5 h-2.5 rounded-full" style={{ background: CAT_HEX[k] }} />}
                  <span style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 14 }}>{k === "all" ? "Everything" : CAT_LABEL[k]}</span>
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: .55 }}>{counts[k]}</span>
              </button>
            );
          })}
        </div>

        {/* Order, under the categories in the same window. A separate control
            because it answers a different question: categories are WHAT you
            see, this is the order you see it in. */}
        <div className="mt-5 pb-3">
          <p className="mb-2" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", color: C.muted }}>ORDER</p>
          <div className="grid grid-cols-3 gap-2">
            {SORTS.map(([k, label]) => {
              const on = sort === k;
              return (
                <button key={k} onClick={() => setSort(k)} aria-pressed={on}
                  className="py-2.5 rounded-2xl border"
                  style={{ background: on ? C.ink : "transparent", borderColor: on ? "transparent" : C.edge,
                           color: on ? C.sheet : C.ink, fontFamily: "var(--disp)", fontWeight: 700, fontSize: 13 }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        </>
      ) : (
        <div className="pb-3">
          {/* One pick. The swatch IS the control — no card, no name, no
              description, because a colour does not need explaining and a row
              of labelled panels was the thing that read as generated. */}
          <p className="mb-2" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", color: C.muted }}>ACCENT</p>
          <div className="grid grid-cols-8 gap-2">
            {ACCENTS.map((a) => {
              const on = look.accent === a.id;
              return (
                <button key={a.id} onClick={() => setLook({ accent: a.id })}
                  aria-label={a.name} aria-pressed={on} title={a.name}
                  className="relative rounded-full"
                  style={{ aspectRatio: "1", background: a.hex,
                           boxShadow: on ? `0 0 0 2px ${C.sheet}, 0 0 0 4px ${a.hex}` : "none" }} />
              );
            })}
          </div>

          <p className="mt-5 mb-2" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", color: C.muted }}>GROUND</p>
          <div className="grid grid-cols-2 gap-2">
            {[[false, "Dark"], [true, "Light"]].map(([v, label]) => {
              const on = look.light === v;
              return (
                <button key={label} onClick={() => setLook({ light: v })} aria-pressed={on}
                  className="py-2.5 rounded-2xl"
                  style={{ background: on ? C.ink : C.faint, color: on ? C.sheet : C.ink,
                           fontFamily: "var(--disp)", fontWeight: 700, fontSize: 13 }}>{label}</button>
              );
            })}
          </div>

          {/* Motion, decoupled from colour. This is the pair that used to be
              one row of themes: you can now have any accent with any weather,
              including none. */}
          <p className="mt-5 mb-2" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em", color: C.muted }}>MOTION</p>
          <div className="grid grid-cols-3 gap-2">
            {SCENES.map(([id, label]) => {
              const on = look.scene === id;
              return (
                <button key={id} onClick={() => setLook({ scene: id })} aria-pressed={on}
                  className="py-2.5 rounded-2xl"
                  style={{ background: on ? C.ink : C.faint, color: on ? C.sheet : C.ink,
                           fontFamily: "var(--disp)", fontWeight: 700, fontSize: 13 }}>{label}</button>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* Actions: three icons stacked above the dock button that opened them, not a
   half-screen sheet. Three destinations do not need a titled panel with a
   footer — the sheet was more chrome than content, and it covered the poll the
   actions are about. Each row is an icon and a word, appearing bottom-up so
   the nearest one to your thumb is the one you reach first.
   Still in the bottom half of the frame, so the thumb rule holds. */
function ActionsPop({ C, T, onShare, onFlag, onProfile, onClose, flagged }) {
  const items = [
    ["Profile", Ico.user, onProfile, false],
    ["Report", Ico.flag, onFlag, flagged],
    ["Share", Ico.share, onShare, false],
  ];
  return (
    <div className="absolute inset-0 z-40" onPointerDown={onClose}>
      <div className="absolute right-4 flex flex-col items-end gap-2" style={{ bottom: 92 }}
        onPointerDown={(e) => e.stopPropagation()}>
        {items.map(([label, icon, fn, on], i) => (
          <button key={label} onClick={fn}
            className="flex items-center gap-2.5 pl-3.5 pr-2 h-11 rounded-full"
            style={{
              background: on ? mix("#FF4D4D", T.blend, T.amt) : C.sheet,
              color: on ? inkOn(mix("#FF4D4D", T.blend, T.amt)) : C.ink,
              boxShadow: "0 8px 24px rgba(0,0,0,.28)",
              fontFamily: "var(--disp)", fontWeight: 700, fontSize: 14,
              animation: `uvPop 180ms cubic-bezier(.22,1,.36,1) ${i * 45}ms both`,
            }}>
            {label}
            <span className="w-8 h-8 rounded-full grid place-items-center" style={{ background: C.faint }}>
              {icon(on ? inkOn(mix("#FF4D4D", T.blend, T.amt)) : C.ink)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShareSheet({ C, text, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked in sandbox */ }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Sheet title="Share the split" sub="Results, not just a link" C={C} onClose={onClose}
      footer={<button onClick={copy} className="w-full py-3.5 rounded-2xl" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 15, background: C.ink, color: C.sheet }}>{copied ? "Copied" : "Copy text"}</button>}>
      <div className="rounded-2xl p-4 mb-3" style={{ background: C.faint, border: `1px solid ${C.edge}` }}>
        <p style={{ fontFamily: "var(--disp)", fontWeight: 600, fontSize: 14, color: C.ink, lineHeight: 1.5, whiteSpace: "pre-line" }}>{text}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 pb-3">
        {["Messages", "Instagram", "More"].map((s) => (
          <button key={s} onClick={onClose} className="py-3 rounded-2xl border" style={{ borderColor: C.edge, fontFamily: "var(--mono)", fontSize: 11, color: C.ink }}>{s}</button>
        ))}
      </div>
    </Sheet>
  );
}

const REASONS = ["Hate or harassment", "Sexual content", "Violence or threats", "Spam or advert", "Misleading or false", "Something else"];
function FlagSheet({ C, onClose, onSubmit }) {
  return (
    <Sheet title="Report this question" sub="It stays up while we look at it" C={C} onClose={onClose} footer={<Flat C={C} onClick={onClose} label="Cancel" />}>
      <div className="space-y-2 pb-3">
        {REASONS.map((r) => (
          <button key={r} onClick={() => onSubmit(r)} className="w-full text-left px-4 py-3 rounded-2xl border"
            style={{ borderColor: C.edge, fontFamily: "var(--disp)", fontWeight: 600, fontSize: 14, color: C.ink }}>{r}</button>
        ))}
      </div>
    </Sheet>
  );
}

/* ═══════════════ PROFILE ═══════════════
   Top half: read-only summary. Bottom half: tabs + tappable list.  */
function Profile({ C, T, topRow, all, votes, bumps, mine, onOpen }) {
  const [tab, setTab] = useState("votes");

  const rows = useMemo(() => Object.keys(votes).map((id) => {
    const p = all.find((x) => x.id === id);
    if (!p) return null;
    const counts = p.o.map((o, i) => o[1] + (bumps[id]?.[i] || 0));
    const sum = counts.reduce((a, b) => a + b, 0) || 1;
    const pct = (counts[votes[id]] / sum) * 100;
    const won = counts[votes[id]] === Math.max(...counts);
    return { p, pick: p.o[votes[id]][0], pct, won };
  }).filter(Boolean), [votes, all, bumps]);

  const cast = rows.length;
  const majority = cast ? Math.round((rows.filter((r) => r.won).length / cast) * 100) : 0;
  const rarest = cast ? rows.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;

  const stat = (n, label) => (
    <span className="flex-1">
      <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 27, fontWeight: 500, color: C.ink, letterSpacing: "-.04em" }}>{n}</span>
      <span className="block mt-0.5" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".12em", color: C.muted }}>{label}</span>
    </span>
  );

  const list = tab === "votes" ? rows : mine.map((p) => ({ p, pick: null }));

  return (
    <div className="relative z-10 h-full grid" style={{ gridTemplateRows: `${topRow}px 1fr` }}>
      {/* top half — read only */}
      <div className="px-4 pt-3 pb-3 min-h-0">
        <div className="h-full w-full rounded-[28px] px-6 py-6 flex flex-col justify-between border"
          style={{ background: C.glass, borderColor: C.glassEdge, color: C.ink, backdropFilter: "blur(18px)" }}>
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl grid place-items-center"
              style={{ background: mix(CAT_HEX.games, T.blend, T.amt), color: inkOn(mix(CAT_HEX.games, T.blend, T.amt)), fontFamily: "var(--disp)", fontWeight: 800, fontSize: 18 }}>Y</span>
            <span>
              <span className="block" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 22, letterSpacing: "-.045em" }}>@you</span>
              <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.muted }}>your votes stay anonymous</span>
            </span>
          </div>

          <div className="flex gap-2">
            {stat(cast, "VOTES CAST")}
            {stat(mine.length, "ASKED")}
            {stat(cast ? majority + "%" : "—", "WITH MAJORITY")}
          </div>

          {rarest && (
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
              Your rarest take: <span style={{ color: C.ink }}>{rarest.pick}</span> — only {Math.round(rarest.pct)}% agreed
            </p>
          )}
        </div>
      </div>

      {/* bottom half — tabs and list */}
      <div className="px-4 pb-2 flex flex-col min-h-0">
        <div className="flex gap-1.5 shrink-0 mb-2">
          {[["votes", `Voted · ${cast}`], ["asked", `Asked · ${mine.length}`]].map(([k, label]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} className="flex-1 py-2.5 rounded-2xl border"
                style={{
                  fontFamily: "var(--mono)", fontSize: 11,
                  background: on ? C.ink : C.glass, color: on ? (T.light ? "#fff" : INK) : C.ink,
                  borderColor: on ? "transparent" : C.glassEdge, backdropFilter: "blur(10px)",
                }}>{label}</button>
            );
          })}
        </div>

        <div className="uv-nobar flex-1 overflow-y-auto min-h-0 space-y-1.5 pb-1">
          {list.length === 0 && (
            <div className="h-full grid place-items-center px-8 text-center">
              <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
                {tab === "votes" ? "No votes yet. Swipe back and pick a side." : "You haven't asked anything. Hit the plus."}
              </p>
            </div>
          )}
          {list.map(({ p, pick, pct, won }) => {
            const accent = mix(CAT_HEX[p.cat], T.blend, T.amt);
            return (
              <button key={p.id} onClick={() => onOpen(p)} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border text-left"
                style={{ background: C.glass, borderColor: C.glassEdge, backdropFilter: "blur(10px)" }}>
                <span className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: accent }} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 14, color: C.ink }}>{p.q}</span>
                  <span className="block truncate mt-0.5" style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.muted }}>
                    {pick ? `you said ${pick}` : `${CAT_LABEL[p.cat]} · ${p.by ? p.by : "anonymous"}`}
                  </span>
                </span>
                {pick && (
                  <span className="shrink-0 text-right">
                    <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 16, color: C.ink }}>{Math.round(pct)}%</span>
                    <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 9, color: won ? accent : C.muted }}>{won ? "led" : "lost"}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Compose({ C, T, onClose, onPost }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("takes");
  const [opts, setOpts] = useState(["", ""]);
  const [anon, setAnon] = useState(true);
  const ok = q.trim().length > 3 && opts.filter((o) => o.trim()).length >= 2;
  const accent = mix(CAT_HEX[cat], T.blend, T.amt);
  const field = { fontFamily: "var(--disp)", fontWeight: 700, color: C.ink, background: C.faint, border: `1px solid ${C.edge}` };

  return (
    <Sheet title="Start an argument" sub="Two to four answers. No wrong ones." C={C} onClose={onClose}
      footer={
        <button disabled={!ok} onClick={() => onPost({ id: "u" + Date.now(), cat, q: q.trim(), by: anon ? null : "@you", o: opts.filter((o) => o.trim()).map((o) => [o.trim(), 0]) })}
          className="w-full py-3.5 rounded-2xl" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 15, background: ok ? accent : C.faint, color: ok ? inkOn(accent) : C.muted }}>
          Post it
        </button>
      }>
      <div className="space-y-3 pb-3">
        <textarea value={q} onChange={(e) => setQ(e.target.value.slice(0, 90))} rows={2} placeholder="Is a hot dog a sandwich?"
          className="w-full rounded-2xl px-3.5 py-3 resize-none outline-none" style={{ ...field, fontSize: 17 }} />
        <div className="flex gap-1.5 overflow-x-auto uv-nobar pb-1">
          {CAT_ORDER.map((k) => {
            const on = cat === k;
            return (
              <button key={k} onClick={() => setCat(k)} className="shrink-0 px-3 py-1.5 rounded-full"
                style={{ fontFamily: "var(--mono)", fontSize: 11, background: on ? CAT_HEX[k] : C.faint, color: on ? inkOn(CAT_HEX[k]) : C.muted }}>{CAT_LABEL[k]}</button>
            );
          })}
        </div>
        {opts.map((o, i) => (
          <input key={i} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value.slice(0, 32) : x)))}
            placeholder={["Yes", "No", "Third answer", "Fourth answer"][i]} className="w-full rounded-2xl px-3.5 py-2.5 outline-none"
            style={{ ...field, fontWeight: 600, fontSize: 15 }} />
        ))}
        {opts.length < 4 && (
          <button onClick={() => setOpts([...opts, ""])} className="w-full py-2.5 rounded-2xl"
            style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted, border: `1px dashed ${C.edge}` }}>+ Add answer</button>
        )}
        <div className="flex gap-2 pt-1">
          {[["Post anonymously", true], ["Post as @you", false]].map(([label, v]) => (
            <button key={label} onClick={() => setAnon(v)} className="flex-1 py-2.5 rounded-2xl border"
              style={{ fontFamily: "var(--mono)", fontSize: 11, background: anon === v ? C.ink : "transparent", color: anon === v ? C.sheet : C.muted, borderColor: anon === v ? "transparent" : C.edge }}>{label}</button>
          ))}
        </div>
        <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.muted, lineHeight: 1.5 }}>
          Votes are always anonymous. This only affects who gets credit for the question.
        </p>
      </div>
    </Sheet>
  );
}

/* ═══════════════ APP ═══════════════ */
export default function Splitmob() {
  /* Slate is the default: it is the one theme that stays out of the way,
     which is the right first impression for a feed of other people's words. */
  /* Accent, light/dark and motion are three separate saved choices now.
     localStorage is fine on our own domain (it was only banned in the artifact
     sandbox), so a reader's pick survives a reload — which matters far more for
     a colour they chose than for anything else in here. */
  const [look, setLook] = useState(() => {
    const fallback = { accent: "slate", light: false, scene: "off" };
    try {
      const raw = JSON.parse(localStorage.getItem("splitmob-look") || "null");
      if (!raw) return fallback;
      return {
        accent: ACCENT_BY_ID[raw.accent] ? raw.accent : fallback.accent,
        light: !!raw.light,
        scene: SCENES.some(([id]) => id === raw.scene) ? raw.scene : fallback.scene,
      };
    } catch { return fallback; }
  });
  const setLookPart = useCallback((patch) => {
    setLook((l) => {
      const next = { ...l, ...patch };
      try { localStorage.setItem("splitmob-look", JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
  const [votes, setVotes] = useState({});
  const [changed, setChanged] = useState({});
  /* Vote changes are rationed per DAY, on top of the existing one-per-poll
     rule. Both are needed and they stop different things: per-poll stops you
     flipping the same question back and forth once you have seen the split,
     and the daily cap stops you doing it across the whole feed. Free re-voting
     is what lets people drift toward the majority, which corrupts every number
     in the app. Stored by date string, so it resets at local midnight without a
     timer. */
  const [budget, setBudget] = useState(() => {
    const today = new Date().toDateString();
    try {
      const raw = JSON.parse(localStorage.getItem("splitmob-changes") || "null");
      if (raw && raw.day === today) return raw;
    } catch { /* private mode */ }
    return { day: today, used: 0 };
  });
  const changesLeft = Math.max(0, CHANGES_PER_DAY - budget.used);
  const [flags, setFlags] = useState({});
  const [bumps, setBumps] = useState({});
  /* A SET of category keys, not one key. Empty means everything — which keeps
     "no filter" and "all categories selected" from being two states that have
     to be kept in sync, and means the feed can never end up empty. */
  const [cats, setCats] = useState(() => new Set());
  const [sort, setSort] = useState("mix");
  /* One seed per visit, deliberately NOT persisted — the whole point is that
     the opening cards differ next time you come back. Derived into a pure
     function so the sort stays a useMemo rather than reading Math.random()
     mid-render. */
  const seed0 = useMemo(() => Math.floor(Math.random() * 0x7fffffff), []);
  const shuffleRng = useCallback((i) => {
    let x = (seed0 ^ (i * 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  }, [seed0]);
  const [idx, setIdx] = useState(0);
  const [mine, setMine] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [page, setPage] = useState("feed");
  const [toast, setToast] = useState(null);
  const feed = useRef(null), frame = useRef(null), head = useRef(null), swipe = useRef(null);
  const [topRow, setTopRow] = useState(300);
  const [phase, setPhase] = useState(() => { const d = new Date(); return (d.getHours() * 60 + d.getMinutes()) / 1440; });

  const reduce = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);

  /* Day cycle: starts at your real local time, then runs a full day every
     DAY_MS. It used to be 100s a day advanced in 1/200 jumps twice a second —
     which is why the sun visibly hopped and dawn arrived like a light switch.
     Two things fix that and they work together:
       · the cycle is six times longer, so every step is six times smaller;
       · the step is now one per SECOND and the sun/moon carries a CSS
         transition of exactly that length (see SkyScene), so the browser
         interpolates the positions in between instead of teleporting.
     The sky gradient cannot be transitioned — CSS does not interpolate
     linear-gradient — but at this speed each step moves it by an amount too
     small to see, which is the same result by a different route. */
  useEffect(() => {
    if (look.scene !== "sky" || reduce) return;
    const t = setInterval(() => setPhase((p) => (p + DAY_TICK_MS / DAY_MS) % 1), DAY_TICK_MS);
    return () => clearInterval(t);
  }, [look.scene, reduce]);

  const T = useMemo(() => palette(ACCENT_BY_ID[look.accent].hex, look.light), [look.accent, look.light]);
  const C = useMemo(() => ({ ...chrome(T) }), [T]);

  const deck = useMemo(() => {
    const a = [...POLLS]; let s = 97;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }, []);
  const all = useMemo(() => [...mine, ...deck], [mine, deck]);
  /* Filter, then order. Sorting is a separate pass rather than part of the
     filter so the two controls stay independent — changing categories must not
     silently reset the order and the other way round.

     "top" is real data: the vote counts are right there. "new" is not, and the
     comment matters more than the code — nothing in the seeded deck carries a
     timestamp, so newest falls back to DEFINITION ORDER REVERSED, last written
     is newest. Polls you create yourself have a real Date.now() id and always
     sort ahead of the deck, which is the part a reader will actually check.
     When Firestore lands (Task 3) this becomes a createdAt field and the
     fallback goes away. */
  const list = useMemo(() => {
    const filtered = cats.size === 0 ? all : all.filter((p) => cats.has(p.cat));
    if (sort === "mix") {
      /* "For you": best first, answered last.

         Ranked by heat (see above), then the strongest fifth is SHUFFLED with a
         per-visit seed. Without that, the best poll in the deck is the first
         card of every session forever and the app looks like it has ten
         questions in it. With it, the opening handful is drawn from the top
         ~50 rather than being one fixed card, so two visits rarely start the
         same way and nothing good is buried where it is never seen.
         Anything already voted on sinks to the bottom instead of being removed,
         so the feed never runs out and you can still scroll back to your own
         results. */
      const fresh = [], done = [];
      for (const p of filtered) (votes[p.id] === undefined ? fresh : done).push(p);
      fresh.sort((a, b) => heat(b) - heat(a));
      const slice = Math.max(1, Math.round(fresh.length * .2));
      const head = fresh.slice(0, slice);
      for (let i = head.length - 1; i > 0; i--) {
        const j = Math.floor(shuffleRng(i) * (i + 1));
        [head[i], head[j]] = [head[j], head[i]];
      }
      return [...head, ...fresh.slice(slice), ...done];
    }
    const rows = [...filtered];
    if (sort === "top") {
      return rows.sort((a, b) => votesOf(b) - votesOf(a));
    }
    const rank = new Map(POLLS.map((p, i) => [p.id, i]));
    return rows.sort((a, b) => {
      const am = !rank.has(a.id), bm = !rank.has(b.id);   // yours are the newest
      if (am !== bm) return am ? -1 : 1;
      if (am && bm) return Number(b.id.slice(1)) - Number(a.id.slice(1));
      return rank.get(b.id) - rank.get(a.id);
    });
    /* votes is deliberately NOT a dependency: re-sorting the moment you answer
       would yank the card you just voted on out from under you. The order is
       recomputed when the filter, the sort or the session seed changes, which
       is every time you would expect it to and no time you would not. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, cats, sort, shuffleRng]);
  const counts = useMemo(() => { const c = { all: all.length }; CAT_ORDER.forEach((k) => (c[k] = all.filter((p) => p.cat === k).length)); return c; }, [all]);
  /* The header is one line and must never wrap — it is what the thumb rule
     measures the top row against. Two names fit; past that, count them. */
  const catLabel = useMemo(() => {
    if (cats.size === 0) return "everything";
    const names = [...cats].map((k) => CAT_LABEL[k].toLowerCase());
    return names.length <= 2 ? names.join(" · ") : `${names.length} categories`;
  }, [cats]);

  useLayoutEffect(() => {
    const measure = () => {
      const f = frame.current?.clientHeight || 0, h = head.current?.clientHeight || 0;
      setTopRow(Math.max(120, f / 2 - h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frame.current) ro.observe(frame.current);
    return () => ro.disconnect();
  }, []);

  /* ONE CARD PER GESTURE.

     The feed used to be a scroll container with CSS snap points, and a flick
     with any real velocity sailed through three or four questions before the
     snap caught it — momentum is the browser's to own, and scroll-snap only
     decides where a scroll ENDS, not how far it may travel. So there is no
     scrolling here any more: the track is translated by whole cards and every
     gesture is worth exactly one step. `moving` locks out further input until
     the transition finishes, which is what stops a fast double-flick counting
     twice.
     `scrollTo` keeps its name and signature because openPoll and the compose
     flow call it to jump to a specific card. */
  const [moving, setMoving] = useState(false);
  const scrollTo = useCallback((i) => {
    setIdx(Math.max(0, Math.min(i, Math.max(0, list.length - 1))));
  }, [list.length]);
  const step = useCallback((d) => {
    if (moving) return;
    setIdx((i) => {
      const n = Math.max(0, Math.min(i + d, list.length - 1));
      if (n !== i && !reduce) {
        setMoving(true);
        setTimeout(() => setMoving(false), 400);
      }
      return n;
    });
  }, [moving, list.length, reduce]);

  // Reordering is as much a change of feed as refiltering is, so both send
  // you back to the top rather than leaving you mid-list in a new order.
  useEffect(() => { setIdx(0); }, [cats, sort]);

  const castVote = useCallback((p, n) => {
    setVotes((v) => ({ ...v, [p.id]: n }));
    setBumps((b) => { const c = b[p.id] || p.o.map(() => 0); const next = [...c]; next[n] += 1; return { ...b, [p.id]: next }; });
  }, []);

  /* one change, and only while the card is still on screen */
  const unvote = useCallback((p) => {
    if (changesLeft <= 0) return;
    const prev = votes[p.id];
    setBumps((b) => { const c = b[p.id] || p.o.map(() => 0); const next = [...c]; next[prev] -= 1; return { ...b, [p.id]: next }; });
    setVotes((v) => { const n = { ...v }; delete n[p.id]; return n; });
    setChanged((c) => ({ ...c, [p.id]: true }));
    setBudget((b) => {
      const next = { ...b, used: b.used + 1 };
      try { localStorage.setItem("splitmob-changes", JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [votes, changesLeft]);

  useEffect(() => {
    const p = list[idx];
    if (!p || votes[p.id] === undefined) return;
    const t = setInterval(() => {
      setBumps((b) => {
        const c = b[p.id] || p.o.map(() => 0);
        const tot = p.o.map((o, i) => o[1] + c[i]);
        const s = tot.reduce((a, x) => a + x, 0) || 1;
        let r = Math.random(), acc = 0, pick = 0;
        for (let i = 0; i < tot.length; i++) { acc += tot[i] / s; if (r <= acc) { pick = i; break; } }
        const next = [...c]; next[pick] += 1 + Math.floor(Math.random() * 3);
        return { ...b, [p.id]: next };
      });
    }, 1500);
    return () => clearInterval(t);
  }, [idx, list, votes]);

  useEffect(() => {
    const onKey = (e) => {
      /* Escape closes whatever is on top, innermost first: a sheet, then the
         actions popup, then the profile. On desktop this is the key people
         reach for and nothing was listening for it.
         Inside the portfolio's modal the parent <dialog> also closes on Escape,
         but focus is in this iframe so the parent never sees the key — closing
         a sheet here can never also close the window around it. */
      if (e.key === "Escape") {
        if (sheet) { e.preventDefault(); setSheet(null); return; }
        if (page !== "feed") { e.preventDefault(); setPage("feed"); return; }
        return;
      }
      if (sheet || page !== "feed") return;
      const p = list[idx];
      if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
      if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      if (p && /^[1-4]$/.test(e.key) && votes[p.id] === undefined && +e.key - 1 < p.o.length) castVote(p, +e.key - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, list, votes, sheet, page, step, castVote]);

  /* jump from a profile row back to that card in the feed */
  const openPoll = useCallback((poll) => {
    setCats(new Set()); setPage("feed");
    setTimeout(() => {
      const i = all.findIndex((x) => x.id === poll.id);
      if (i >= 0) { scrollTo(i); setIdx(i); }
    }, 70);
  }, [all, scrollTo]);

  /* On a real phone, drop the fake device frame and go full-bleed.

     ?embed=1 forces the same thing. The portfolio opens this in a phone-shaped
     iframe, so the frame is already there and drawing a second one inside it is
     the bug: a 420x880 device floating in the middle of a device. Inferring it
     from width alone was fine while the modal was ~420px wide and broke the
     moment it got bigger — at 1440p the iframe is 623px, reads as a desktop,
     and renders the fake frame. The embedder knows it is embedding; it should
     say so rather than leave it to a threshold to guess. */
  const embedded = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("embed") === "1";
  }, []);
  const [isPhone, setIsPhone] = useState(embedded);
  useEffect(() => {
    if (embedded) return;
    const check = () => setIsPhone(window.innerWidth <= 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [embedded]);

  const cur = list[idx];
  const dockAccent = cur ? mix(CAT_HEX[cur.cat], T.blend, T.amt) : mix(CAT_HEX.life, T.blend, T.amt);

  const shareText = useMemo(() => {
    if (!cur) return "";
    const c = cur.o.map((o, i) => o[1] + (bumps[cur.id]?.[i] || 0));
    const s = c.reduce((a, b) => a + b, 0) || 1;
    const lines = cur.o.map((o, i) => `${Math.round((c[i] / s) * 100)}% ${o[0]}`).join("  ·  ");
    return `${cur.q}\n${lines}\n${fmt(s)} votes on ${APP_NAME}`;
  }, [cur, bumps]);

  return (
    <div className="w-full grid place-items-center" style={{ height: "100dvh", background: T.light ? "#E9E6DE" : "#07060B" }}>
      {/* The <style> block that stood here moved verbatim to src/index.css.
          Not a cleanup: style-src 'self' refuses a <style> ELEMENT (React sets
          its text, which CSP sees as inline), so on the live domain every scene
          keyframe here was silently dropped and the rain, bubbles and sparks
          never animated. The rules are unchanged and still global; only the
          delivery moved, from an inline element to the bundled stylesheet.
          React's style={{...}} props are untouched and unaffected — those go
          through the CSSOM, which CSP does not police. */}

      <div ref={frame} className="relative w-full overflow-hidden flex flex-col"
        style={{
          maxWidth: isPhone ? "100%" : 420,
          height: "100dvh",
          maxHeight: isPhone ? "none" : 880,
          borderRadius: isPhone ? 0 : 28,
          border: isPhone ? "none" : `1px solid ${C.edge}`,   // the standalone-desktop device frame only
        }}>

        <Scene id={look.scene} t={T} phase={phase} reduce={reduce} />

        <header ref={head} className="relative z-20 shrink-0 px-6 pt-4 pb-3">
          <div className="flex items-baseline justify-between">
            <span style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 19, color: C.ink, letterSpacing: "-.06em" }}>{APP_NAME}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.muted }}>
              {page === "me" ? "your activity" : catLabel} · {Object.keys(votes).length} cast
            </span>
          </div>
        </header>

        {/* The profile slides in from the RIGHT and back out again, so the
            swipe that opens it and the animation that follows move the same
            direction. It stays mounted either way — unmounting would make the
            exit jump. */}
        <div className="absolute inset-0 z-20 flex flex-col"
          style={{
            transform: page === "me" ? "translateX(0)" : "translateX(100%)",
            transition: reduce ? "none" : "transform 320ms cubic-bezier(.22,1,.36,1)",
            pointerEvents: page === "me" ? "auto" : "none",
            background: T.page, paddingTop: head.current ? head.current.offsetHeight : 0,
          }}
          {...swipeHandlers({ onRight: () => setPage("feed"), axis: "x" })}>
          <Profile C={C} T={T} topRow={topRow} all={all} votes={votes} bumps={bumps} mine={mine} onOpen={openPoll} />
        </div>

        {/* The feed is a translated TRACK, not a scroller — see the note on
            step(). One gesture, one card, and momentum cannot overshoot
            because there is no momentum to have. */}
        <div ref={feed} className="relative z-10 flex-1 min-h-0 overflow-hidden"
          style={{ touchAction: "none" }}
          onWheel={(e) => { if (Math.abs(e.deltaY) > 12) step(e.deltaY > 0 ? 1 : -1); }}
          {...swipeHandlers({ onUp: () => step(1), onDown: () => step(-1), onLeft: () => setPage("me"), axis: "any" })}>
          {/* height:100% is load-bearing twice over. It gives each card a
              percentage to resolve against — without it they collapse to their
              content and the empty windowed ones to nothing — and it makes the
              track exactly one card tall, so translateY(-idx * 100%) steps by
              one screen. Let the track size to its content instead and 100%
              means the height of all 260 stacked together, which moves the feed
              by the length of the whole deck. */}
          <div style={{
            height: "100%",
            transform: `translateY(${-idx * 100}%)`,
            transition: reduce ? "none" : "transform 380ms cubic-bezier(.22,1,.36,1)",
          }}>
            {list.map((p, i) => (
              <div key={p.id} style={{ height: "100%" }} className="snap-start">
                {/* Only the neighbours are built. 260 live cards each running a
                    counter and a layout pass is what makes a phone hot; three
                    is indistinguishable on screen because the other 257 are
                    off it. */}
                {Math.abs(i - idx) <= 1 ? (
                  <Card poll={p} choice={votes[p.id]} bump={bumps[p.id]} active={i === idx} reduce={reduce}
                    T={T} C={C} topRow={topRow} flagged={!!flags[p.id]}
                    canChange={i === idx && !changed[p.id] && changesLeft > 0}
                    changesLeft={changesLeft}
                    onVote={(n) => castVote(p, n)}
                    onChange={() => unvote(p)} />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Three buttons, and the + is centred on the DOCK rather than on
            whatever is left over beside its neighbours. `1fr auto 1fr` is what
            guarantees that: the two side columns are equal by definition, so
            the middle column's centre is the dock's centre no matter how wide
            the side buttons get. The old flex/justify-between version put two
            buttons on the left and one on the right, which pushed the + off
            centre by exactly half a button. */}
        <nav className="relative z-30 shrink-0 grid items-center px-6"
          style={{
            gridTemplateColumns: "1fr auto 1fr",
            height: 74, paddingBottom: isPhone ? "env(safe-area-inset-bottom)" : 0,
            boxSizing: "content-box",
            background: C.dock, backdropFilter: "blur(16px)", borderTop: `1px solid ${C.edge}`,
          }}>
          <span className="justify-self-start">
            <button onClick={() => setSheet("settings")}
              aria-label={page === "me" ? "Look and feel" : "Categories and look"}
              className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: C.faint }}>{Ico.gear(C.ink)}</button>
          </span>

          <button onClick={() => setSheet("compose")} aria-label="Start an argument"
            className="justify-self-center w-[58px] h-[58px] rounded-full grid place-items-center"
            style={{ background: dockAccent, transition: "background 400ms", boxShadow: T.light ? "0 6px 18px rgba(40,34,28,.2)" : "0 6px 22px rgba(0,0,0,.5)" }}>
            {Ico.plus(inkOn(dockAccent))}
          </button>

          {/* On the profile this is the way back, which is why the profile does
              not need a button of its own in the dock. Swiping right does the
              same thing. */}
          <span className="justify-self-end">
            <button onClick={() => (page === "me" ? setPage("feed") : setSheet("actions"))}
              aria-label={page === "me" ? "Back to the feed" : "Actions"}
              className="w-12 h-12 rounded-2xl grid place-items-center"
              style={{ background: C.faint }}>{page === "me" ? Ico.back(C.ink) : Ico.dots(C.ink)}</button>
          </span>
        </nav>

        {toast && (
          <div className="absolute left-0 right-0 z-40 flex justify-center" style={{ bottom: 88 }}>
            <span className="px-4 py-2 rounded-full" style={{ background: C.sheet, color: C.ink, fontFamily: "var(--mono)", fontSize: 11, border: `1px solid ${C.edge}` }}>{toast}</span>
          </div>
        )}

        {sheet === "settings" && <SettingsSheet C={C} look={look} setLook={setLookPart}
          cats={cats} setCats={setCats} counts={counts} sort={sort} setSort={setSort}
          allowCategories={page !== "me"} onClose={() => setSheet(null)} />}
        {sheet === "actions" && <ActionsPop C={C} T={T} flagged={!!(cur && flags[cur.id])}
          onShare={() => setSheet("share")}
          onFlag={() => setSheet("flag")}
          onProfile={() => { setSheet(null); setPage("me"); }}
          onClose={() => setSheet(null)} />}
        {sheet === "share" && <ShareSheet C={C} text={shareText} onClose={() => setSheet(null)} />}
        {sheet === "flag" && <FlagSheet C={C} onClose={() => setSheet(null)}
          onSubmit={() => { if (cur) setFlags((f) => ({ ...f, [cur.id]: true })); setSheet(null); setToast("Reported — thanks"); setTimeout(() => setToast(null), 2200); }} />}
        {sheet === "compose" && <Compose C={C} T={T} onClose={() => setSheet(null)}
          onPost={(p) => { setMine((m) => [p, ...m]); setCats(new Set()); setSheet(null); setTimeout(() => scrollTo(0), 60); }} />}
      </div>
    </div>
  );
}
