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

const CAT_ORDER = ["food", "tech", "life", "money", "games", "culture", "weird", "takes"];
const CAT_LABEL = { food: "Food", tech: "Tech", life: "Life", money: "Money", games: "Games", culture: "Culture", weird: "Weird", takes: "Hot takes" };
const CAT_HEX = { food: "#FF7A5C", tech: "#2FC7CC", life: "#8F7BE8", money: "#3FC98A", games: "#FF5FA2", culture: "#4D8DF0", weird: "#C9D93B", takes: "#FF4D4D" };

/* ═══════════════ THEMES ═══════════════
   Each returns a token set. `blend`/`amt` pull category colors into
   the scene's palette; `shade` is what losing bands fade toward.    */

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const mixList = (stops, t) => {
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  return mix(stops[i], stops[i + 1], f);
};

const THEMES = {
  sky: {
    name: "Sky", note: "sun and moon, real time of day", live: true,
    swatch: ["#8FC7E8", "#F7C77E", "#2B3A6B", "#1A1730"],
    tokens: (p) => {
      // p = 0 midnight → .25 sunrise → .5 noon → .75 sunset → 1 midnight
      const top = mixList(["#11132B", "#2B3560", "#7FB2E0", "#59A6DE", "#7FB2E0", "#E88A5C", "#2B2A55", "#11132B"], p);
      const bot = mixList(["#1A1B38", "#6E5C86", "#D9E6F2", "#BEDCF0", "#D9E6F2", "#F7C77E", "#463A62", "#1A1B38"], p);
      const day = clamp01((lum(bot) - .12) / .35);
      const light = day > .5;
      return {
        page: `linear-gradient(180deg, ${top} 0%, ${bot} 78%)`,
        ink: light ? INK : "#F4F2FB", light,
        blend: light ? "#FFFFFF" : "#3A3560", amt: light ? .1 : .42,
        shade: light ? "#FFFFFF" : "#171531",
        glassBase: light ? "#FFFFFF" : "#171634",
        scene: { top, bot, p, day },
      };
    },
  },
  rain: {
    name: "Downpour", note: "grey-blue, always raining",
    swatch: ["#2E4A56", "#3E6B75", "#16242C", "#8FB8BE"],
    tokens: () => ({
      page: "linear-gradient(180deg, #16242C 0%, #223C46 55%, #16242C 100%)",
      ink: "#E7F0F2", light: false,
      blend: "#2E5560", amt: .5, shade: "#101A20", glassBase: "#12242C",
    }),
  },
  deep: {
    name: "Deep", note: "underwater, light from above",
    swatch: ["#0A2A3A", "#12556B", "#061620", "#7FD8D0"],
    tokens: () => ({
      page: "linear-gradient(180deg, #12566B 0%, #0A2E3E 45%, #04121A 100%)",
      ink: "#DFF4F4", light: false,
      blend: "#0E4456", amt: .48, shade: "#04121A", glassBase: "#0A2836",
    }),
  },
  ember: {
    name: "Ember", note: "campfire dark, sparks rising",
    swatch: ["#2A1410", "#FF8A3D", "#140A08", "#FFD9A0"],
    tokens: () => ({
      page: "linear-gradient(180deg, #120A0C 0%, #24120E 62%, #40200F 100%)",
      ink: "#F8ECE2", light: false,
      blend: "#54291A", amt: .44, shade: "#150B09", glassBase: "#1E100D",
    }),
  },
  paper: {
    name: "Paper", note: "daylight, no motion",
    swatch: ["#F4F1EA", "#E4DED2", "#FFFFFF", "#2A2620"],
    tokens: () => ({
      page: "linear-gradient(180deg, #FAF8F3 0%, #EFEBE1 100%)",
      ink: "#1B1820", light: true,
      blend: "#FFFFFF", amt: .18, shade: "#FFFFFF", glassBase: "#FFFFFF",
    }),
  },
};

/* chrome tokens derived from the theme's own light/dark reading */
function chrome(t) {
  const L = t.light;
  return {
    ink: t.ink,
    muted: L ? "rgba(24,20,32,.5)" : "rgba(255,255,255,.5)",
    faint: L ? "rgba(24,20,32,.07)" : "rgba(255,255,255,.09)",
    edge: L ? "rgba(24,20,32,.12)" : "rgba(255,255,255,.15)",
    glass: rgba(t.glassBase, L ? .62 : .5),
    glassEdge: L ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.13)",
    dock: rgba(t.glassBase, L ? .8 : .72),
    sheet: L ? "#FFFFFF" : mix(t.glassBase, INK, .35),
    scrim: L ? "rgba(30,26,40,.34)" : "rgba(4,3,8,.6)",
  };
}

/* ═══════════════ SCENES ═══════════════ */

const seeded = (n, seed) => {
  let s = seed; const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: n }, () => r());
};

function SkyScene({ t }) {
  const { p, day } = t.scene;
  const stars = useMemo(() => seeded(120, 7), []);
  // sun arcs 0.25→0.75, moon the rest
  const isSun = p >= .25 && p < .75;
  const local = isSun ? (p - .25) / .5 : (p < .25 ? p + .25 : p - .75) / .5;
  const x = local * 112 - 6;
  const y = 72 - Math.sin(local * Math.PI) * 58;
  const body = isSun ? "#FFE9A8" : "#E8EAF4";
  const glow = isSun ? "#FFC35C" : "#B9C4E8";

  return (
    <>
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

function RainScene({ reduce }) {
  const drops = useMemo(() => seeded(240, 19), []);
  return (
    <>
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 60% at 50% 0%, rgba(143,184,190,.16), transparent 70%)" }} />
      {[0, 1].map((layer) => (
        <div key={layer} className="absolute inset-0 overflow-hidden" style={{ opacity: layer ? .5 : .85 }}>
          {Array.from({ length: 60 }, (_, i) => {
            const a = drops[i * 3 + layer], b = drops[i * 3 + 1], c = drops[i * 3 + 2];
            return (
              <span key={i} className="absolute uv-rain" style={{
                left: `${a * 104 - 2}%`, top: `${-20 - b * 40}%`,
                width: layer ? 1 : 1.6, height: layer ? 42 : 66,
                background: `linear-gradient(180deg, transparent, ${layer ? "rgba(180,214,220,.35)" : "rgba(200,232,238,.6)"})`,
                animationDuration: `${(layer ? 1.15 : .8) + c * .5}s`,
                animationDelay: `${b * -2}s`,
                animationPlayState: reduce ? "paused" : "running",
                transform: "rotate(9deg)",
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

function PaperScene() {
  return (
    <>
      <div className="absolute rounded-full" style={{ left: "-18%", top: "6%", width: "70%", height: "42%", background: "radial-gradient(circle, rgba(224,214,196,.55), transparent 70%)" }} />
      <div className="absolute rounded-full" style={{ right: "-12%", bottom: "10%", width: "62%", height: "38%", background: "radial-gradient(circle, rgba(214,220,226,.5), transparent 70%)" }} />
    </>
  );
}

function Scene({ id, t, reduce }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ background: t.page, transition: "background 600ms linear" }}>
      {id === "sky" && <SkyScene t={t} />}
      {id === "rain" && <RainScene reduce={reduce} />}
      {id === "deep" && <DeepScene reduce={reduce} />}
      {id === "ember" && <EmberScene reduce={reduce} />}
      {id === "paper" && <PaperScene />}
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
function Card({ poll, choice, onVote, onChange, onShare, onFlag, canChange, flagged, bump, reduce, active, T, C, topRow }) {
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

        {/* action row — share and report never require voting first */}
        <div className="h-10 shrink-0 flex items-center justify-between gap-2 px-1">
          <span className="truncate min-w-0" style={{
            fontFamily: "var(--mono)", fontSize: 11, color: C.ink,
            opacity: voted ? 0 : .55,
            animation: verdict && !reduce ? "uvIn 460ms 400ms forwards" : "none",
          }}>{verdict || "Tap to vote"}</span>

          <span className="flex items-center gap-1.5 shrink-0">
            {voted && canChange && (
              <button onClick={onChange} className="flex items-center gap-1.5 pl-2.5 pr-3 h-9 rounded-full border"
                style={{ background: C.glass, borderColor: C.glassEdge, color: C.ink, fontFamily: "var(--mono)", fontSize: 11, backdropFilter: "blur(10px)" }}>
                {Ico.undo(C.ink)} change
              </button>
            )}
            <button onClick={onShare} aria-label="Share this question" className="w-9 h-9 rounded-full grid place-items-center border"
              style={{ background: C.glass, borderColor: C.glassEdge, backdropFilter: "blur(10px)" }}>{Ico.share(C.ink)}</button>
            <button onClick={onFlag} aria-label="Report this question" className="w-9 h-9 rounded-full grid place-items-center border"
              style={{
                background: flagged ? mix("#FF4D4D", T.blend, T.amt) : C.glass,
                borderColor: flagged ? "transparent" : C.glassEdge, backdropFilter: "blur(10px)",
              }}>{Ico.flag(flagged ? inkOn(mix("#FF4D4D", T.blend, T.amt)) : C.ink)}</button>
          </span>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════ SHEETS ═══════════════ */
function Sheet({ title, sub, C, onClose, children, footer }) {
  return (
    <div className="absolute inset-0 z-40">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" style={{ background: C.scrim, backdropFilter: "blur(2px)" }} />
      <div className="absolute left-0 right-0 bottom-0 flex flex-col rounded-t-[28px] overflow-hidden"
        style={{ height: "50%", background: C.sheet, borderTop: `1px solid ${C.edge}`, animation: "uvUp 320ms cubic-bezier(.22,1,.36,1)" }}>
        <div className="px-5 pt-4 pb-3 shrink-0">
          <div className="mx-auto w-9 h-1 rounded-full mb-4" style={{ background: C.faint }} />
          <h3 style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 21, color: C.ink, letterSpacing: "-.04em" }}>{title}</h3>
          {sub && <p className="mt-1" style={{ fontFamily: "var(--mono)", fontSize: 11, color: C.muted }}>{sub}</p>}
        </div>
        <div className="flex-1 overflow-y-auto uv-nobar px-5 min-h-0">{children}</div>
        {footer && <div className="px-5 pt-2 pb-4 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
const Flat = ({ C, onClick, label }) => (
  <button onClick={onClick} className="w-full py-3.5 rounded-2xl" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 15, background: C.faint, color: C.ink }}>{label}</button>
);

function Settings({ C, themeId, setThemeId, onClose }) {
  return (
    <Sheet title="Look and feel" sub="The scene behind changes as you tap" C={C} onClose={onClose} footer={<Flat C={C} onClick={onClose} label="Done" />}>
      <div className="space-y-2 pb-3">
        {Object.entries(THEMES).map(([id, t]) => {
          const on = themeId === id;
          return (
            <button key={id} onClick={() => setThemeId(id)} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border"
              style={{ background: on ? C.faint : "transparent", borderColor: on ? C.ink : C.edge }}>
              <span className="w-12 h-12 rounded-2xl overflow-hidden shrink-0 grid grid-cols-2 grid-rows-2">
                {t.swatch.map((s, i) => <span key={i} style={{ background: s }} />)}
              </span>
              <span className="flex-1 text-left">
                <span className="block" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 15, color: C.ink }}>{t.name}</span>
                <span className="block" style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.muted }}>{t.note}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function Filter({ C, filter, setFilter, counts, onClose }) {
  return (
    <Sheet title="What are we arguing about?" C={C} onClose={onClose} footer={<Flat C={C} onClick={onClose} label="Close" />}>
      <div className="grid grid-cols-2 gap-2 pb-3">
        {["all", ...CAT_ORDER].map((k) => {
          const on = filter === k;
          return (
            <button key={k} onClick={() => { setFilter(k); onClose(); }} className="flex items-center justify-between px-3.5 py-3 rounded-2xl border"
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
    </Sheet>
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
  const [themeId, setThemeId] = useState("sky");
  const [votes, setVotes] = useState({});
  const [changed, setChanged] = useState({});
  const [flags, setFlags] = useState({});
  const [bumps, setBumps] = useState({});
  const [filter, setFilter] = useState("all");
  const [idx, setIdx] = useState(0);
  const [mine, setMine] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [page, setPage] = useState("feed");
  const [toast, setToast] = useState(null);
  const feed = useRef(null), frame = useRef(null), head = useRef(null);
  const [topRow, setTopRow] = useState(300);
  const [phase, setPhase] = useState(() => { const d = new Date(); return (d.getHours() * 60 + d.getMinutes()) / 1440; });

  const reduce = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);

  /* day cycle: starts at your real local time, then a full day every 100s */
  useEffect(() => {
    if (themeId !== "sky" || reduce) return;
    const t = setInterval(() => setPhase((p) => (p + 1 / 200) % 1), 500);
    return () => clearInterval(t);
  }, [themeId, reduce]);

  const T = useMemo(() => THEMES[themeId].tokens(phase), [themeId, phase]);
  const C = useMemo(() => ({ ...chrome(T) }), [T]);

  const deck = useMemo(() => {
    const a = [...POLLS]; let s = 97;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }, []);
  const all = useMemo(() => [...mine, ...deck], [mine, deck]);
  const list = useMemo(() => (filter === "all" ? all : all.filter((p) => p.cat === filter)), [all, filter]);
  const counts = useMemo(() => { const c = { all: all.length }; CAT_ORDER.forEach((k) => (c[k] = all.filter((p) => p.cat === k).length)); return c; }, [all]);

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

  const scrollTo = useCallback((i) => { const el = feed.current; if (el) el.scrollTo({ top: i * el.clientHeight, behavior: reduce ? "auto" : "smooth" }); }, [reduce]);
  useEffect(() => { feed.current?.scrollTo({ top: 0 }); setIdx(0); }, [filter]);

  const castVote = useCallback((p, n) => {
    setVotes((v) => ({ ...v, [p.id]: n }));
    setBumps((b) => { const c = b[p.id] || p.o.map(() => 0); const next = [...c]; next[n] += 1; return { ...b, [p.id]: next }; });
  }, []);

  /* one change, and only while the card is still on screen */
  const unvote = useCallback((p) => {
    const prev = votes[p.id];
    setBumps((b) => { const c = b[p.id] || p.o.map(() => 0); const next = [...c]; next[prev] -= 1; return { ...b, [p.id]: next }; });
    setVotes((v) => { const n = { ...v }; delete n[p.id]; return n; });
    setChanged((c) => ({ ...c, [p.id]: true }));
  }, [votes]);

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
      if (sheet || page !== "feed") return;
      const p = list[idx];
      if (e.key === "ArrowDown") { e.preventDefault(); scrollTo(Math.min(idx + 1, list.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); scrollTo(Math.max(idx - 1, 0)); }
      if (p && /^[1-4]$/.test(e.key) && votes[p.id] === undefined && +e.key - 1 < p.o.length) castVote(p, +e.key - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, list, votes, sheet, page, scrollTo, castVote]);

  /* jump from a profile row back to that card in the feed */
  const openPoll = useCallback((poll) => {
    setFilter("all"); setPage("feed");
    setTimeout(() => {
      const i = all.findIndex((x) => x.id === poll.id);
      if (i >= 0) { scrollTo(i); setIdx(i); }
    }, 70);
  }, [all, scrollTo]);

  /* on a real phone, drop the fake device frame and go full-bleed */
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const check = () => setIsPhone(window.innerWidth <= 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
          border: isPhone ? "none" : `1px solid ${C.edge}`,
        }}>

        <Scene id={themeId} t={T} reduce={reduce} />

        <header ref={head} className="relative z-20 shrink-0 px-6 pt-4 pb-3">
          <div className="flex items-baseline justify-between">
            <span style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 19, color: C.ink, letterSpacing: "-.06em" }}>{APP_NAME}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: C.muted }}>
              {page === "me" ? "your activity" : filter === "all" ? "everything" : CAT_LABEL[filter].toLowerCase()} · {Object.keys(votes).length} cast
            </span>
          </div>
        </header>

        {page === "me" && (
          <div className="flex-1 min-h-0">
            <Profile C={C} T={T} topRow={topRow} all={all} votes={votes} bumps={bumps} mine={mine} onOpen={openPoll} />
          </div>
        )}

        <div ref={feed} hidden={page !== "feed"} onScroll={() => {
          const el = feed.current; if (!el) return;
          const i = Math.round(el.scrollTop / el.clientHeight);
          if (i !== idx) setIdx(i);
        }} className="uv-nobar relative z-10 flex-1 overflow-y-auto min-h-0" style={{ scrollSnapType: "y mandatory" }}>
          {list.map((p, i) => (
            <div key={p.id} style={{ height: "100%" }} className="snap-start">
              <Card poll={p} choice={votes[p.id]} bump={bumps[p.id]} active={i === idx} reduce={reduce}
                T={T} C={C} topRow={topRow} flagged={!!flags[p.id]}
                canChange={i === idx && !changed[p.id]}
                onVote={(n) => castVote(p, n)}
                onChange={() => unvote(p)}
                onShare={() => setSheet("share")}
                onFlag={() => setSheet("flag")} />
            </div>
          ))}
        </div>

        <nav className="relative z-30 shrink-0 flex items-center justify-between px-6"
          style={{
            height: 74, paddingBottom: isPhone ? "env(safe-area-inset-bottom)" : 0,
            boxSizing: "content-box",
            background: C.dock, backdropFilter: "blur(16px)", borderTop: `1px solid ${C.edge}`,
          }}>
          <span className="flex gap-2">
            <button onClick={() => { setPage("feed"); setSheet("filter"); }} aria-label="Choose categories"
              className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: C.faint }}>{Ico.grid(C.ink)}</button>
            <button onClick={() => setPage(page === "me" ? "feed" : "me")} aria-label="Your activity"
              className="w-12 h-12 rounded-2xl grid place-items-center"
              style={{ background: page === "me" ? dockAccent : C.faint }}>{Ico.user(page === "me" ? inkOn(dockAccent) : C.ink)}</button>
          </span>

          <button onClick={() => setSheet("compose")} aria-label="Start an argument" className="w-[58px] h-[58px] rounded-full grid place-items-center"
            style={{ background: dockAccent, transition: "background 400ms", boxShadow: T.light ? "0 6px 18px rgba(40,34,28,.2)" : "0 6px 22px rgba(0,0,0,.5)" }}>
            {Ico.plus(inkOn(dockAccent))}
          </button>

          <button onClick={() => setSheet("settings")} aria-label="Look and feel" className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: C.faint }}>{Ico.gear(C.ink)}</button>
        </nav>

        {toast && (
          <div className="absolute left-0 right-0 z-40 flex justify-center" style={{ bottom: 88 }}>
            <span className="px-4 py-2 rounded-full" style={{ background: C.sheet, color: C.ink, fontFamily: "var(--mono)", fontSize: 11, border: `1px solid ${C.edge}` }}>{toast}</span>
          </div>
        )}

        {sheet === "filter" && <Filter C={C} filter={filter} setFilter={setFilter} counts={counts} onClose={() => setSheet(null)} />}
        {sheet === "settings" && <Settings C={C} themeId={themeId} setThemeId={setThemeId} onClose={() => setSheet(null)} />}
        {sheet === "share" && <ShareSheet C={C} text={shareText} onClose={() => setSheet(null)} />}
        {sheet === "flag" && <FlagSheet C={C} onClose={() => setSheet(null)}
          onSubmit={() => { if (cur) setFlags((f) => ({ ...f, [cur.id]: true })); setSheet(null); setToast("Reported — thanks"); setTimeout(() => setToast(null), 2200); }} />}
        {sheet === "compose" && <Compose C={C} T={T} onClose={() => setSheet(null)}
          onPost={(p) => { setMine((m) => [p, ...m]); setFilter("all"); setSheet(null); setTimeout(() => scrollTo(0), 60); }} />}
      </div>
    </div>
  );
}
