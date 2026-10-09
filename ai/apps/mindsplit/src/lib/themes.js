import { INK, PAPER, mix } from "./color.js";

/* FIVE rooms, built from the app icon's own three colours — plate crimson
   #FF2E62, lime #CCFF27, cyan #00E1FE — plus a neon-on-black and a paper room
   so the range has both ends. These are the colour schemes the app is: the
   2026-10 revamp kept them exactly and changed what is painted with them.

   The theme's colour IS the ground; cards are a lighter or darker step of the
   same hex, never a grey with a tint. The reader's one other choice is the
   ACCENT, curated per room (three each) so a clashing pair cannot be picked.

   What the accent paints since the revamp: the LEADING answer once you have
   voted, the + button, the selected chips. That is the icon's own look — a
   lime half on a crimson plate — and it replaced the old per-category band
   ramps, which on a crimson ground came out as orange and brown mud. The
   category hue survives as the dot on the card's chip. */
export const PLATE = "#FF2E62", LIME = "#CCFF27", CYAN = "#00E1FE";

export const THEMES = [
  { id: "split", name: "Split", light: false, ink: "#FFF7F9",
    top: mix(PLATE, PAPER, .04), bot: mix(PLATE, INK, .26),
    surface: mix(PLATE, PAPER, .15), raise: mix(PLATE, PAPER, .27), sunk: mix(PLATE, INK, .18),
    accents: [LIME, CYAN, "#FFFFFF"] },
  { id: "venom", name: "Venom", light: true, ink: INK,
    top: mix(LIME, PAPER, .06), bot: mix(LIME, INK, .12),
    surface: mix(LIME, PAPER, .42), raise: mix(LIME, PAPER, .6), sunk: mix(LIME, INK, .1),
    accents: [INK, PLATE, "#1F4FD8"] },
  { id: "splash", name: "Splash", light: true, ink: INK,
    top: mix(CYAN, PAPER, .06), bot: mix(CYAN, INK, .14),
    surface: mix(CYAN, PAPER, .4), raise: mix(CYAN, PAPER, .58), sunk: mix(CYAN, INK, .1),
    accents: [INK, PLATE, "#123A8A"] },
  { id: "neon", name: "Neon", light: false, ink: "#F3F4F8",
    top: "#121219", bot: "#06060A",
    surface: "#1A1A23", raise: "#24242F", sunk: "#0E0E14",
    accents: [LIME, CYAN, PLATE] },
  { id: "bone", name: "Bone", light: true, ink: "#16141C",
    top: "#FBFAF6", bot: "#EEEBE3",
    surface: "#FFFFFF", raise: "#F4F2EC", sunk: "#E6E2D8",
    accents: [PLATE, "#0FA3B8", INK] },
];
export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/* Every token the components read, from a room and the reader's accent. */
export function tokens(theme, accent) {
  const L = theme.light;
  return {
    id: theme.id, light: L, accent,
    page: `linear-gradient(180deg, ${theme.top} 0%, ${theme.bot} 100%)`,
    top: theme.top, bot: theme.bot,
    ink: theme.ink,
    muted: L ? "rgba(22,20,28,.62)" : "rgba(255,255,255,.72)",
    faint: L ? mix(theme.surface, INK, .07) : mix(theme.surface, PAPER, .09),
    edge: L ? "rgba(22,20,28,.12)" : "rgba(255,255,255,.14)",
    surface: theme.surface,
    raise: theme.raise,
    sunk: theme.sunk,
    sheet: L ? "#FFFFFF" : theme.raise,
    scrim: L ? "rgba(28,24,36,.38)" : "rgba(3,4,7,.6)",
    shadow: L ? "0 10px 30px rgba(40,34,28,.10)" : "0 12px 34px rgba(0,0,0,.28)",
    /* Bands that did not lead, after a vote: two steps of the room, so the
       result reads as one bright winner over quiet runners-up. */
    runner: [theme.raise, mix(theme.surface, L ? INK : PAPER, .04), theme.surface, theme.surface],
  };
}
