import { useState } from "react";
import { inkOn } from "../lib/color.js";
import { THEMES, THEME_BY_ID } from "../lib/themes.js";
import { SCENES } from "../scenes/index.jsx";
import { CAT_EMOJI, CAT_LABEL, CAT_ORDER } from "../data/categories.js";
import { Sheet, Wide, Label } from "./Sheet.jsx";

export const SORTS = [["mix", "For you"], ["new", "Newest"], ["top", "Most voted"]];

/* A pill that is on or off: on is the accent, off is a quiet step. */
const Pill = ({ T, on, onClick, children, className = "", label }) => (
  <button type="button" onClick={onClick} aria-pressed={on} aria-label={label}
    className={`ms-press rounded-2xl ${className}`}
    style={{ background: on ? T.accent : T.faint, color: on ? inkOn(T.accent) : T.ink,
             fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16 }}>{children}</button>
);

/* One window, two panes: what you see (categories and order) and how it
   looks (room, accent, motion). The pane switch and Done share the footer.
   On the profile there is no feed to filter, so it opens on Look alone. */
export function SettingsSheet({ T, look, setLook, cats, setCats, counts, sort, setSort, onClose, allowCategories }) {
  const [pane, setPane] = useState(allowCategories ? "cats" : "look");
  const isCats = allowCategories && pane === "cats";

  /* Multi-select; Everything is the absence of a filter, so the last
     category switched off lands back on everything, never on an empty feed. */
  const toggle = (k) => {
    if (k === "all") { setCats(new Set()); return; }
    setCats((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  };

  return (
    <Sheet T={T} onClose={onClose}
      title={isCats ? "What do you want to argue about?" : "Look and feel"}
      sub={isCats ? "Pick as many as you like" : "A room, an accent, and some weather if you want it"}
      footer={allowCategories ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Wide T={T} onClick={() => setPane(isCats ? "look" : "cats")} label={isCats ? "Look" : "Categories"} />
          <Wide T={T} onClick={onClose} label="Done" primary />
        </div>
      ) : <Wide T={T} onClick={onClose} label="Done" primary />}>

      {isCats ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {["all", ...CAT_ORDER].map((k) => {
              const on = k === "all" ? cats.size === 0 : cats.has(k);
              return (
                <Pill key={k} T={T} on={on} onClick={() => toggle(k)} label={k === "all" ? "All" : CAT_LABEL[k]} className="flex items-center justify-between gap-2 px-3.5 h-[52px]">
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span aria-hidden="true" style={{ fontSize: 18 }}>{k === "all" ? "✨" : CAT_EMOJI[k]}</span>
                    <span className="truncate">{k === "all" ? "All" : CAT_LABEL[k]}</span>
                  </span>
                  <span style={{ fontFamily: "var(--body)", fontWeight: 600, fontSize: 13, opacity: .7 }}>{counts[k]}</span>
                </Pill>
              );
            })}
          </div>
          <Label T={T} className="mt-6">Order</Label>
          <div className="grid grid-cols-3 gap-2 pb-4">
            {SORTS.map(([k, label]) => <Pill key={k} T={T} on={sort === k} onClick={() => setSort(k)} className="h-12">{label}</Pill>)}
          </div>
        </>
      ) : (
        <div className="pb-4">
          <Label T={T}>Room</Label>
          <div className="grid grid-cols-5 gap-2.5">
            {THEMES.map((t) => {
              const on = look.theme === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setLook({ theme: t.id, accent: 0 })}
                  aria-label={t.name} aria-pressed={on} className="ms-press flex flex-col items-center gap-1.5">
                  <span className="w-full rounded-2xl grid place-items-center" style={{ aspectRatio: "1",
                    background: `linear-gradient(180deg, ${t.top}, ${t.bot})`,
                    boxShadow: on ? `0 0 0 3px ${T.sheet}, 0 0 0 5px ${T.ink}` : `inset 0 0 0 1px ${T.edge}` }}>
                    <span className="rounded-full" style={{ width: 18, height: 18, background: t.accents[0], boxShadow: `0 0 0 4px ${t.surface}` }} />
                  </span>
                  <span style={{ fontFamily: "var(--body)", fontSize: 13, fontWeight: on ? 700 : 500, color: on ? T.ink : T.muted }}>{t.name}</span>
                </button>
              );
            })}
          </div>

          <Label T={T} className="mt-6">Accent</Label>
          <div className="flex gap-3">
            {THEME_BY_ID[look.theme].accents.map((hex, i) => {
              const on = look.accent === i;
              return (
                <button key={hex} type="button" onClick={() => setLook({ accent: i })}
                  aria-label={`Accent ${i + 1}`} aria-pressed={on} className="ms-press w-12 h-12 rounded-full"
                  style={{ background: hex, boxShadow: on ? `0 0 0 3px ${T.sheet}, 0 0 0 5px ${T.ink}` : `inset 0 0 0 1px ${T.edge}` }} />
              );
            })}
          </div>

          <Label T={T} className="mt-6">Motion</Label>
          <div className="grid grid-cols-3 gap-2">
            {SCENES.map(([id, label]) => <Pill key={id} T={T} on={look.scene === id} onClick={() => setLook({ scene: id })} className="h-12">{label}</Pill>)}
          </div>
        </div>
      )}
    </Sheet>
  );
}
