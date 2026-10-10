import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { inkOn } from "./lib/color.js";
import { THEME_BY_ID, tokens } from "./lib/themes.js";
import { load, save } from "./lib/store.js";
import { cloud as loadCloud } from "./lib/cloud.js";
import { Scene, SCENES, DAY_MS, DAY_TICK_MS } from "./scenes/index.jsx";
import { POLLS } from "./data/polls.js";
import { CAT_LABEL, CAT_ORDER } from "./data/categories.js";
import { Card, EndCard, fmt } from "./components/Card.jsx";
import { swipeHandlers } from "./components/Sheet.jsx";
import { SettingsSheet } from "./components/Settings.jsx";
import { Compose } from "./components/Compose.jsx";
import { ShareSheet, FlagSheet, InstallSheet } from "./components/Extras.jsx";
import { AccountSheet, Avatar } from "./components/Account.jsx";
import { Profile, Person } from "./components/Profile.jsx";
import { Ico } from "./components/Icons.jsx";

/* ═══════════════════════════════════════════════════════════════
   MindSplit — swipe-to-vote. One question per screen; tap an answer and
   the split everyone else made opens up under it.

   Rebuilt 2026-10 from the single-file prototype: the same five rooms and
   the same rules (ai/apps/mindsplit/CLAUDE.md), with a new deck of 390
   questions, bigger type, a cleaner card, the site account, and REAL
   votes — every number on screen is people who answered, through
   public/cloud.js. The made-up starting counts and the fake live drift are
   gone.

   THUMB RULE: nothing interactive above the frame's vertical centre.
   ═══════════════════════════════════════════════════════════════ */

/* Working name only — one string, change it when you land the real one. */
export const APP_NAME = "MindSplit";

/* Vote changes allowed per day, on top of one change per poll. Three fixes a
   misfire and is far too few to shop your way toward the majority. */
const CHANGES_PER_DAY = 3;
/* A question people asked is hidden from the feed at this many reports. */
const HIDE_AT = 3;
const OWNER = "dexdcimino@gmail.com";

const DECK = POLLS;
const DECK_RANK = new Map(DECK.map((p, i) => [p.id, i]));
const zeros = (n) => Array.from({ length: n }, () => 0);

export default function MindSplit() {
  /* ---------- saved choices ---------- */
  const [look, setLook] = useState(() => {
    const fallback = { theme: "split", accent: 0, scene: "off" };
    const raw = load("mindsplit-look", null);
    if (!raw) return fallback;
    const theme = THEME_BY_ID[raw.theme] ? raw.theme : fallback.theme;
    const n = THEME_BY_ID[theme].accents.length;
    return {
      theme,
      accent: Number.isInteger(raw.accent) && raw.accent >= 0 && raw.accent < n ? raw.accent : 0,
      scene: SCENES.some(([id]) => id === raw.scene) ? raw.scene : fallback.scene,
    };
  });
  const setLookPart = useCallback((patch) => setLook((l) => { const next = { ...l, ...patch }; save("mindsplit-look", next); return next; }), []);

  /* Your answers: { pollId: { c: choice, u: uid that cast it, at } }. Kept on
     this phone always, and for a signed-in account also on the server, so a
     second phone gets them back. */
  const [votes, setVotesRaw] = useState(() => load("mindsplit-votes", {}));
  const setVotes = useCallback((fn) => setVotesRaw((v) => { const next = typeof fn === "function" ? fn(v) : fn; save("mindsplit-votes", next); return next; }), []);
  const [changed, setChanged] = useState(() => load("mindsplit-changed", {}));
  const [budget, setBudget] = useState(() => {
    const today = new Date().toDateString();
    const raw = load("mindsplit-changes", null);
    return raw && raw.day === today ? raw : { day: today, used: 0 };
  });
  const changesLeft = Math.max(0, CHANGES_PER_DAY - budget.used);
  const [flags, setFlags] = useState(() => load("mindsplit-flags", {}));
  const [swiped, setSwiped] = useState(() => load("mindsplit-swiped", false));

  /* ---------- the account and the server ---------- */
  const [cloud, setCloud] = useState(undefined);       // undefined loading, null offline
  const [user, setUser] = useState(null);
  const [handle, setHandle] = useState(null);
  const [asked, setAsked] = useState([]);               // questions people asked, from the server
  const [posted, setPosted] = useState(() => load("mindsplit-posted", []));  // yours, kept here too
  const [known, setKnown] = useState({});               // counts fetched in bulk
  const [live, setLive] = useState({});                 // counts from the open card's listener
  const [localOnly, setLocalOnly] = useState({});       // votes the server did not take
  const wantName = useRef(false);
  /* Faces and follows, from the one @name every app shares (cloud.js). */
  const [people, setPeople] = useState({});             // handle -> { handle, avatar, followers, following }
  const [follows, setFollows] = useState(() => new Set());
  const [viewing, setViewing] = useState(null);          // { handle, uid } whose page is open
  const [theirPolls, setTheirPolls] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const askedFace = useRef(new Set());
  const needPerson = useCallback((h, fresh) => {
    if (!cloud || !h || (!fresh && askedFace.current.has(h))) return;
    askedFace.current.add(h);
    cloud.person(h).then((f) => { if (f) setPeople((m) => ({ ...m, [h]: f, [f.handle]: f })); })
      .catch((e) => { askedFace.current.delete(h); console.warn("mindsplit: profile", e.message || e); });
  }, [cloud]);

  useEffect(() => {
    let off = null, dead = false;
    loadCloud().then(async (c) => {
      if (dead) return;
      setCloud(c);
      if (!c) return;
      off = await c.onUser((u) => setUser(u));
      c.loadPolls().then(setAsked).catch((e) => console.warn("mindsplit: polls", e.code || e));
      if (c.topCounts) c.topCounts().then((k) => setKnown((m) => ({ ...k, ...m }))).catch(() => {});
    });
    return () => { dead = true; if (typeof off === "function") off(); };
  }, []);

  // Signed in: this account's name and its answers from every device.
  useEffect(() => {
    if (!cloud) return;
    if (!user) { setHandle(null); return; }
    let dead = false;
    cloud.myHandle().then((h) => {
      if (dead) return;
      setHandle(h);
      if (!h && wantName.current) setSheet("account");
    }).catch(() => {});
    cloud.myVotes().then((server) => {
      if (dead) return;
      setVotes((v) => {
        const next = { ...v };
        for (const [id, c] of Object.entries(server)) next[id] = { ...(v[id] || {}), c, u: user.uid };
        return next;
      });
    }).catch((e) => console.warn("mindsplit: my votes", e.code || e));
    return () => { dead = true; };
  }, [cloud, user, setVotes]);

  useEffect(() => {
    if (!cloud || !user || !handle) { setFollows(new Set()); return; }
    needPerson(handle, true);
    let dead = false;
    cloud.following().then((l) => { if (!dead) setFollows(new Set(l)); }).catch((e) => console.warn("mindsplit: following", e.message || e));
    return () => { dead = true; };
  }, [cloud, user, handle, needPerson]);

  const isOwner = !!user && user.provider === "google.com" && (user.email || "").toLowerCase() === OWNER;

  /* ---------- the feed ---------- */
  const [cats, setCats] = useState(() => new Set());
  const [sort, setSort] = useState("mix");
  const seed0 = useMemo(() => Math.floor(Math.random() * 0x7fffffff), []);
  const rng = useCallback((i) => {
    let x = (seed0 ^ Math.imul(i + 1, 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  }, [seed0]);
  /* ?q=<id> is a shared link: that question goes first. So does the one
     you have just asked. */
  const [focusId, setFocusId] = useState(() => new URLSearchParams(window.location.search).get("q"));

  const all = useMemo(() => {
    const seen = new Set(), out = [];
    for (const p of [...asked, ...posted, ...DECK]) {
      if (seen.has(p.id) || (p.rep || 0) >= HIDE_AT || !p.o || p.o.length < 2) continue;
      seen.add(p.id); out.push(p);
    }
    return out;
  }, [asked, posted]);

  const totalOf = useCallback((p) => (live[p.id] || known[p.id] || []).reduce((a, b) => a + b, 0), [live, known]);

  /* Filter, then order. "For you": unanswered first — the deck shuffled per
     visit, with what people asked this week dealt in every third card so it
     is seen — then everything you have answered, so the feed never runs dry
     and your results are still there to scroll back to. */
  const list = useMemo(() => {
    const filtered = cats.size === 0 ? all : all.filter((p) => cats.has(p.cat));
    let rows;
    if (sort === "top") rows = [...filtered].sort((a, b) => totalOf(b) - totalOf(a));
    else if (sort === "new") {
      rows = [...filtered].sort((a, b) => {
        const am = !DECK_RANK.has(a.id), bm = !DECK_RANK.has(b.id);
        if (am !== bm) return am ? -1 : 1;
        if (am) return (b.at || 0) - (a.at || 0);
        return DECK_RANK.get(b.id) - DECK_RANK.get(a.id);
      });
    } else {
      const week = Date.now() - 7 * 864e5;
      const fresh = [], people = [], done = [];
      for (const p of filtered) {
        if (votes[p.id]) done.push(p);
        else if (!DECK_RANK.has(p.id) && (p.at || 0) > week) people.push(p);
        else fresh.push(p);
      }
      const keyed = fresh.map((p, i) => [rng(DECK_RANK.has(p.id) ? DECK_RANK.get(p.id) : 9999 + i), p]);
      keyed.sort((a, b) => a[0] - b[0]);
      const deal = keyed.map(([, p]) => p);
      rows = [];
      while (deal.length || people.length) {
        rows.push(...deal.splice(0, 2));
        if (people.length) rows.push(people.shift());
      }
      rows.push(...done);
    }
    if (focusId) {
      const i = rows.findIndex((p) => p.id === focusId);
      if (i > 0) rows = [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)];
    }
    return rows;
    /* votes is deliberately NOT a dependency: re-sorting the moment you
       answer would yank the card out from under you. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, cats, sort, rng, focusId]);

  const counts = useMemo(() => {
    const c = { all: all.length };
    CAT_ORDER.forEach((k) => (c[k] = all.filter((p) => p.cat === k).length));
    return c;
  }, [all]);
  const catLabel = useMemo(() => {
    if (cats.size === 0) return "Everything";
    const names = [...cats].map((k) => CAT_LABEL[k]);
    return names.length <= 2 ? names.join(" · ") : `${names.length} categories`;
  }, [cats]);

  /* ---------- layout: the thumb rule, measured ---------- */
  const frame = useRef(null), head = useRef(null);
  const [topRow, setTopRow] = useState(300);
  useLayoutEffect(() => {
    const measure = () => {
      const f = frame.current?.clientHeight || 0, h = head.current?.clientHeight || 0;
      setTopRow(Math.max(140, f / 2 - h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frame.current) ro.observe(frame.current);
    return () => ro.disconnect();
  }, []);

  const reduce = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const [phase, setPhase] = useState(() => { const d = new Date(); return (d.getHours() * 60 + d.getMinutes()) / 1440; });
  useEffect(() => {
    if (look.scene !== "sky" || reduce) return;
    const t = setInterval(() => setPhase((p) => (p + DAY_TICK_MS / DAY_MS) % 1), DAY_TICK_MS);
    return () => clearInterval(t);
  }, [look.scene, reduce]);

  const T = useMemo(() => {
    const theme = THEME_BY_ID[look.theme];
    return tokens(theme, theme.accents[look.accent] || theme.accents[0]);
  }, [look.theme, look.accent]);

  /* ---------- moving through the feed: one card per gesture ---------- */
  const [idx, setIdx] = useState(0);
  /* ?install=1 opens the install sheet once, and leaves the address clean. */
  const [sheet, setSheet] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("install") || q.get("embed") === "1") return null;
    q.delete("install");
    window.history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : ""));
    return "install";
  });
  const [page, setPage] = useState("feed");
  const [toast, setToast] = useState(null);
  const [moving, setMoving] = useState(false);
  const last = list.length;                  // the end card sits at index list.length
  const step = useCallback((d) => {
    if (moving) return;
    setIdx((i) => {
      const n = Math.max(0, Math.min(i + d, last));
      if (n !== i) {
        if (!swiped) { setSwiped(true); save("mindsplit-swiped", true); }
        if (!reduce) { setMoving(true); setTimeout(() => setMoving(false), 50); }
      }
      return n;
    });
  }, [moving, last, reduce, swiped]);
  useEffect(() => { setIdx(0); }, [cats, sort]);

  const say = useCallback((text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2400); }, []);
  const cur = list[idx];

  /* The asker's face for the open card and its neighbours. */
  useEffect(() => {
    for (const p of [list[idx - 1], cur, list[idx + 1]]) if (p && p.by && !DECK_RANK.has(p.id)) needPerson(p.by);
  }, [cur, idx, list, needPerson]);

  /* The open card's count, live: every vote anyone casts arrives here. */
  useEffect(() => {
    if (!cloud || !cur) return;
    let off = null, dead = false;
    cloud.watchCounts(cur.id, cur.o.length, (c) => { if (!dead) setLive((m) => ({ ...m, [cur.id]: c })); })
      .then((u) => { if (dead) u?.(); else off = u; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [cloud, cur?.id, user?.uid]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* What a card shows. The live listener already carries your own vote the
     moment you cast it (Firestore applies a write locally before the server
     answers), so your vote is added by hand only where nothing else has it:
     no server, a vote the server refused, or a vote cast this visit before
     the card's listener has spoken. */
  const [justVoted, setJustVoted] = useState({});
  const countsFor = useCallback((p) => {
    const base = [...(live[p.id] || known[p.id] || zeros(p.o.length))];
    while (base.length < p.o.length) base.push(0);
    const v = votes[p.id];
    if (!v) return base;
    let add = !cloud || !!localOnly[p.id] || (!!justVoted[p.id] && !live[p.id]);
    if (!add && base.reduce((a, b) => a + b, 0) === 0) add = true;
    if (add) base[v.c] += 1;
    return base;
  }, [live, known, votes, localOnly, justVoted, cloud]);

  /* ---------- voting ---------- */
  const castVote = useCallback((p, c) => {
    if (votes[p.id]) return;
    setVotes((v) => ({ ...v, [p.id]: { c, at: Date.now() } }));
    setJustVoted((m) => ({ ...m, [p.id]: true }));
    if (!cloud) return;
    cloud.vote(p.id, c)
      .then((uid) => setVotes((v) => (v[p.id] && v[p.id].c === c ? { ...v, [p.id]: { ...v[p.id], u: uid } } : v)))
      .catch((err) => { console.warn("mindsplit: vote kept on this phone", err.code || err); setLocalOnly((m) => ({ ...m, [p.id]: true })); });
  }, [votes, cloud, setVotes]);

  const unvote = useCallback((p) => {
    const v = votes[p.id];
    if (!v || changesLeft <= 0 || changed[p.id]) return;
    const done = () => {
      setVotes((m) => { const n = { ...m }; delete n[p.id]; return n; });
      setLocalOnly((m) => { const n = { ...m }; delete n[p.id]; return n; });
      setChanged((m) => { const n = { ...m, [p.id]: true }; save("mindsplit-changed", n); return n; });
      setBudget((b) => { const n = { ...b, used: b.used + 1 }; save("mindsplit-changes", n); return n; });
    };
    if (!cloud || localOnly[p.id] || !v.u) { done(); return; }
    cloud.unvote(p.id, v.c, v.u).then(done).catch((err) => {
      console.warn("mindsplit: change refused", err.code || err.message || err);
      say(err.message === "cast by another sign-in" ? "That answer was given signed out, so it stays" : "Could not change that one");
    });
  }, [votes, changed, changesLeft, cloud, localOnly, setVotes, say]);

  /* ---------- asking, reporting, deleting ---------- */
  const [postBusy, setPostBusy] = useState(false);
  const [postErr, setPostErr] = useState("");
  const [accountReason, setAccountReason] = useState("");
  const mine = useMemo(() => all.filter((p) => !DECK_RANK.has(p.id) && (posted.some((x) => x.id === p.id) || (user && p.uid === user.uid))), [all, posted, user]);

  const openAsk = useCallback(() => {
    setPostErr("");
    if (cloud && !user) { wantName.current = true; setAccountReason("Sign in to ask a question. It takes one tap with Google or Discord."); setSheet("account"); return; }
    if (cloud && user && !handle) { setSheet("account"); return; }
    setSheet("compose");
  }, [cloud, user, handle]);

  const post = useCallback(async ({ q, o, cat, anon }) => {
    if (!cloud) { setPostErr("Asking needs a connection to MindSplit."); return; }
    setPostBusy(true); setPostErr("");
    const id = cloud.newId();
    try {
      const r = await cloud.postPoll({ id, q, o, cat, anon });
      const p = { id, q, o, cat, by: r.by, uid: user.uid, at: Date.now(), rep: 0 };
      setPosted((m) => { const n = [p, ...m].slice(0, 100); save("mindsplit-posted", n); return n; });
      setFocusId(id); setCats(new Set()); setSheet(null); setPage("feed");
      setTimeout(() => setIdx(0), 40);
      say("Posted. It’s first in your feed");
    } catch (err) {
      setPostErr(err && err.code === "permission-denied" ? "You can ask one question a minute. Try again shortly." : (err && err.message) || "That did not post. Try again.");
    }
    setPostBusy(false);
  }, [cloud, user, say]);

  const flag = useCallback((why) => {
    if (!cur) return;
    setFlags((f) => { const n = { ...f, [cur.id]: why }; save("mindsplit-flags", n); return n; });
    setSheet(null); say("Reported. Thanks for looking out");
    if (cloud) cloud.report(cur.id, why, !DECK_RANK.has(cur.id)).catch((e) => console.warn("mindsplit: report", e.code || e));
  }, [cur, cloud, say]);

  const remove = useCallback(async () => {
    if (!cur || !cloud) return;
    try {
      await cloud.deletePoll(cur.id);
      setAsked((a) => a.filter((p) => p.id !== cur.id));
      setPosted((m) => { const n = m.filter((p) => p.id !== cur.id); save("mindsplit-posted", n); return n; });
      setSheet(null); say("Removed");
    } catch { say("Could not remove that"); }
  }, [cur, cloud, say]);

  /* ---------- keys ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === "Escape") {
        if (sheet) { e.preventDefault(); setSheet(null); return; }
        if (page !== "feed") { e.preventDefault(); setPage("feed"); }
        return;
      }
      if (sheet || page !== "feed") return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); step(-1); }
      const k = /^[1-4]$/.test(e.key) ? +e.key - 1 : "abcd".indexOf(e.key.toLowerCase());
      if (cur && k >= 0 && k < cur.o.length && !votes[cur.id] && e.key.length === 1) castVote(cur, k);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, votes, sheet, page, step, castVote]);

  // A jump from the profile lands once the reset list is in.
  const pendingOpen = useRef(null);
  const openFromProfile = useCallback((poll) => {
    pendingOpen.current = poll.id;
    setCats(new Set()); setSort("mix"); setPage("feed");
  }, []);
  useEffect(() => {
    if (!pendingOpen.current) return;
    const i = list.findIndex((x) => x.id === pendingOpen.current);
    pendingOpen.current = null;
    if (i >= 0) setTimeout(() => setIdx(i), 30);
  }, [list]);

  /* Someone's page, from their face on a card. Yours is your profile. */
  const openPerson = useCallback((h, uid) => {
    if (!h) return;
    if (handle && (h === handle || (user && uid === user.uid))) { setPage("me"); return; }
    setViewing({ handle: h, uid }); setTheirPolls(null); setPage("person");
    needPerson(h, true);
    if (!cloud) { setTheirPolls([]); return; }
    cloud.pollsBy(h, uid).then((l) => {
      setTheirPolls(l);
      // Older questions than the feed loaded still open in the feed.
      setAsked((a) => { const have = new Set(a.map((p) => p.id)); const add = l.filter((p) => !have.has(p.id)); return add.length ? [...a, ...add] : a; });
    }).catch((e) => { console.warn("mindsplit: their questions", e.code || e); setTheirPolls([]); });
  }, [cloud, handle, user, needPerson]);

  const face = viewing ? people[viewing.handle] : null;
  const toggleFollow = useCallback(async () => {
    if (!face || !cloud) return;
    if (!user) { setAccountReason("Sign in to follow people. Follows are shared with Inko."); setSheet("account"); return; }
    if (!handle) { setSheet("account"); return; }
    const on = !follows.has(face.handle);
    setFollowBusy(true);
    try {
      const r = await cloud.follow(face.handle, on);
      setFollows((s) => { const n = new Set(s); if (r.following) n.add(face.handle); else n.delete(face.handle); return n; });
      setPeople((m) => ({ ...m, [face.handle]: { ...m[face.handle], followers: r.followers } }));
      if (people[handle]) setPeople((m) => ({ ...m, [handle]: { ...m[handle], following: Math.max(0, m[handle].following + (r.following ? 1 : -1)) } }));
    } catch (err) { say(err.message || "Could not follow right now"); }
    setFollowBusy(false);
  }, [face, cloud, user, handle, follows, people, say]);

  /* ---------- frame ---------- */
  const embedded = useMemo(() => new URLSearchParams(window.location.search).get("embed") === "1", []);
  const [isPhone, setIsPhone] = useState(embedded);
  useEffect(() => {
    if (embedded) return;
    const check = () => setIsPhone(window.innerWidth <= 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [embedded]);

  const share = useMemo(() => {
    if (!cur) return { text: "", url: "" };
    const c = countsFor(cur), s = c.reduce((a, b) => a + b, 0);
    const lines = votes[cur.id] && s
      ? cur.o.map((o, i) => `${Math.round((c[i] / s) * 100)}% ${o}`).join("\n")
      : cur.o.map((o) => `• ${o}`).join("\n");
    return { text: `${cur.q}\n${lines}${s ? `\n${fmt(s)} ${s === 1 ? "vote" : "votes"} on ${APP_NAME}` : ""}`, url: `https://dexcimino.com/mindsplit/?q=${encodeURIComponent(cur.id)}` };
  }, [cur, votes, countsFor]);

  const bylineOf = (p) => (DECK_RANK.has(p.id) ? `A ${APP_NAME} question` : p.by ? `Asked by @${p.by}` : "Asked anonymously");
  const answered = Object.keys(votes).length;
  const hint = swiped ? "Tap an answer" : <>{Ico.swipe(T.muted, 17)} Swipe up to skip</>;

  return (
    <div className="w-full grid place-items-center" style={{ height: "100dvh", background: T.light ? "#E9E6DE" : "#07060B" }}>
      <div ref={frame} className="relative w-full overflow-hidden flex flex-col"
        style={{
          maxWidth: isPhone ? "100%" : 430, height: "100dvh", maxHeight: isPhone ? "none" : 900,
          borderRadius: isPhone ? 0 : 30, border: isPhone ? "none" : `1px solid ${T.edge}`,
          color: T.ink,
        }}>

        <Scene id={look.scene} t={T} tint={T.accent} phase={phase} reduce={reduce} />

        {/* The header is TEXT ONLY: it is above the midpoint. */}
        <header ref={head} className="relative z-30 shrink-0 px-6 pb-3" style={{ paddingTop: isPhone ? "max(16px, env(safe-area-inset-top))" : 18 }}>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 23, letterSpacing: "-.05em" }}>
              <span className="ms-logo" aria-hidden="true"><span style={{ background: "#00E1FE" }} /><span style={{ background: "#CCFF27" }} /></span>
              {APP_NAME}
            </span>
            <span className="truncate" style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 600, color: T.muted }}>
              {page === "me" ? "Your profile" : page === "person" ? "Profile" : `${catLabel} · ${answered} answered`}
            </span>
          </div>
        </header>

        {/* The profile slides in from the right; it stays mounted so the exit
            does not jump. */}
        <div className="absolute inset-0 z-20 flex flex-col"
          style={{
            transform: page === "me" ? "translateX(0)" : "translateX(100%)",
            transition: reduce ? "none" : "transform 340ms cubic-bezier(.22,1,.36,1)",
            pointerEvents: page === "me" ? "auto" : "none",
            background: T.page, paddingTop: head.current ? head.current.offsetHeight : 0, paddingBottom: 0,
          }}
          aria-hidden={page !== "me"}
          {...swipeHandlers({ onRight: () => setPage("feed"), axis: "x" })}>
          <Profile T={T} topRow={topRow} all={all} votes={votes} countsFor={countsFor} mine={mine}
            user={user} handle={handle} face={handle ? people[handle] : null} onOpen={openFromProfile}
            onAccount={() => { setAccountReason(""); setSheet("account"); }}
            onSignIn={() => { wantName.current = true; setAccountReason(""); setSheet("account"); }} />
        </div>

        {/* Someone else's page slides in the same way. */}
        <div className="absolute inset-0 z-20 flex flex-col"
          style={{
            transform: page === "person" ? "translateX(0)" : "translateX(100%)",
            transition: reduce ? "none" : "transform 340ms cubic-bezier(.22,1,.36,1)",
            pointerEvents: page === "person" ? "auto" : "none",
            background: T.page, paddingTop: head.current ? head.current.offsetHeight : 0,
          }}
          aria-hidden={page !== "person"}
          {...swipeHandlers({ onRight: () => setPage("feed"), axis: "x" })}>
          {viewing && (
            <Person T={T} topRow={topRow} face={face || { handle: viewing.handle, avatar: "", followers: 0, following: 0 }}
              polls={theirPolls} countsFor={countsFor} following={face && follows.has(face.handle)} busy={followBusy}
              onFollow={cloud ? toggleFollow : null} onOpen={openFromProfile} />
          )}
        </div>

        {/* The feed is a translated TRACK, not a scroller: one gesture, one
            card. height:100% on the track and on each slot is load-bearing —
            it is what makes translateY(-idx * 100%) step by one screen. */}
        <div className="relative z-10 flex-1 min-h-0 overflow-hidden" style={{ touchAction: "none" }}
          onWheel={(e) => { if (Math.abs(e.deltaY) > 12) step(e.deltaY > 0 ? 1 : -1); }}
          {...swipeHandlers({ onUp: () => step(1), onDown: () => step(-1), onLeft: () => setPage("me"), axis: "any" })}>
          <div style={{ height: "100%", transform: `translateY(${-idx * 100}%)`, transition: reduce ? "none" : "transform 400ms cubic-bezier(.22,1,.36,1)" }}>
            {list.map((p, i) => (
              <div key={p.id} style={{ height: "100%" }}>
                {/* Only the neighbours are built: 400 live cards is a hot phone. */}
                {Math.abs(i - idx) <= 1 ? (
                  <Card poll={p} counts={countsFor(p)} live={!!live[p.id] && i === idx} choice={votes[p.id]?.c}
                    reduce={reduce} T={T} topRow={topRow} byline={bylineOf(p)} hint={hint}
                    author={p.by && !DECK_RANK.has(p.id) ? (people[p.by] || { handle: p.by, avatar: "" }) : null}
                    onAuthor={() => openPerson(p.by, p.uid)}
                    flagged={!!flags[p.id]}
                    canChange={i === idx && !changed[p.id] && changesLeft > 0}
                    changesLeft={changesLeft}
                    onVote={(n) => castVote(p, n)}
                    onChange={() => unvote(p)}
                    onShare={() => setSheet("share")}
                    onFlag={() => setSheet("flag")} />
                ) : null}
              </div>
            ))}
            <div style={{ height: "100%" }}>
              {Math.abs(last - idx) <= 1 && (
                <EndCard T={T} topRow={topRow} answered={answered} onAsk={openAsk} onFilter={() => setSheet("settings")} />
              )}
            </div>
          </div>
        </div>

        {/* The dock. 1fr auto 1fr keeps the + on the dock's centre whatever
            the side buttons are. */}
        <nav className="relative z-30 shrink-0 grid items-center px-5"
          style={{
            gridTemplateColumns: "1fr auto 1fr", height: 78, boxSizing: "content-box",
            paddingBottom: isPhone ? "env(safe-area-inset-bottom)" : 0,
            background: T.surface, boxShadow: T.light ? "0 -1px 0 rgba(22,20,28,.08)" : "0 -1px 0 rgba(255,255,255,.08)",
          }}>
          <span className="justify-self-start">
            <button type="button" onClick={() => setSheet("settings")} aria-label={page === "me" ? "Look and feel" : "Categories and look"}
              className="ms-press w-[52px] h-[52px] rounded-[18px] grid place-items-center" style={{ background: T.faint }}>{Ico.sliders(T.ink)}</button>
          </span>
          <button type="button" onClick={openAsk} aria-label="Ask a question"
            className="ms-press justify-self-center w-[62px] h-[62px] rounded-full grid place-items-center"
            style={{ background: T.accent, boxShadow: T.light ? "0 6px 18px rgba(40,34,28,.22)" : "0 8px 24px rgba(0,0,0,.4)" }}>
            {Ico.plus(inkOn(T.accent))}
          </button>
          <span className="justify-self-end">
            {page !== "feed" ? (
              <button type="button" onClick={() => setPage("feed")} aria-label="Back to the questions"
                className="ms-press w-[52px] h-[52px] rounded-[18px] grid place-items-center" style={{ background: T.faint }}>{Ico.back(T.ink)}</button>
            ) : (
              <button type="button" onClick={() => setPage("me")} aria-label={user ? `Your profile, @${handle || "you"}` : "Your profile"}
                className="ms-press w-[52px] h-[52px] rounded-[18px] grid place-items-center overflow-hidden" style={{ background: T.faint }}>
                {user ? <Avatar T={T} src={handle && people[handle]?.avatar} handle={handle || user.name || user.email} size={38} /> : Ico.user(T.ink)}
              </button>
            )}
          </span>
        </nav>

        {toast && (
          <div className="absolute left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ bottom: 96 }}>
            <span className="px-5 py-3 rounded-full" role="status"
              style={{ background: T.ink, color: inkOn(T.ink), fontFamily: "var(--disp)", fontWeight: 700, fontSize: 15, animation: "uvPop 220ms both" }}>{toast}</span>
          </div>
        )}

        {sheet === "settings" && <SettingsSheet T={T} look={look} setLook={setLookPart}
          cats={cats} setCats={setCats} counts={counts} sort={sort} setSort={setSort}
          allowCategories={page === "feed"} onClose={() => setSheet(null)} />}
        {sheet === "install" && <InstallSheet T={T} onClose={() => setSheet(null)} />}
        {sheet === "share" && <ShareSheet T={T} text={share.text} url={share.url} onClose={() => setSheet(null)} />}
        {sheet === "flag" && cur && <FlagSheet T={T} onClose={() => setSheet(null)} onSubmit={flag}
          canDelete={!DECK_RANK.has(cur.id) && !!user && (cur.uid === user.uid || isOwner)} onDelete={remove} />}
        {sheet === "compose" && <Compose T={T} handle={handle} onClose={() => setSheet(null)} onPost={post} busy={postBusy} error={postErr} />}
        {sheet === "account" && <AccountSheet T={T} cloud={cloud} user={user} handle={handle} reason={accountReason}
          onClose={() => { setSheet(null); setAccountReason(""); }}
          onHandle={(h) => { setHandle(h); if (wantName.current) { wantName.current = false; setSheet("compose"); } }} />}
      </div>
    </div>
  );
}
