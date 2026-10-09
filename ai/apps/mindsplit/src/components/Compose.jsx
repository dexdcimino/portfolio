import { useState } from "react";
import { inkOn, mix } from "../lib/color.js";
import { CAT_EMOJI, CAT_HEX, CAT_LABEL, CAT_ORDER } from "../data/categories.js";
import { Sheet, Wide, Label } from "./Sheet.jsx";

export const LIMITS = { q: 100, o: 32 };

/* Ask a question. The one tall sheet: a question, two to four answers and a
   category have to fit over a phone keyboard. */
export function Compose({ T, handle, onClose, onPost, busy, error }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("takes");
  const [opts, setOpts] = useState(["", ""]);
  const [anon, setAnon] = useState(false);
  const answers = opts.map((o) => o.trim()).filter(Boolean);
  const ok = q.trim().length >= 4 && answers.length >= 2 && new Set(answers.map((a) => a.toLowerCase())).size === answers.length;
  const field = { fontFamily: "var(--disp)", fontWeight: 700, color: T.ink, background: T.faint, border: `1.5px solid ${T.edge}` };

  const post = () => {
    if (!ok || busy) return;
    let text = q.trim();
    if (!/[?!.]$/.test(text)) text += "?";
    onPost({ q: text, o: answers, cat, anon });
  };

  return (
    <Sheet title="Ask a question" sub="Two to four answers. Make it something people will split on." T={T} onClose={onClose} tall
      footer={
        <>
          {error && <p className="mb-2" role="alert" style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 600, color: T.light ? "#C62828" : "#FFD3D3" }}>{error}</p>}
          <Wide T={T} onClick={post} label={busy ? "Posting…" : "Post it"} primary disabled={!ok || busy} />
        </>
      }>
      <div className="space-y-3 pb-4">
        <textarea value={q} onChange={(e) => setQ(e.target.value.slice(0, LIMITS.q))} rows={2} placeholder="Is a hot dog a sandwich?"
          aria-label="Your question" className="w-full rounded-[18px] px-4 py-3.5 resize-none outline-none" style={{ ...field, fontSize: 21, lineHeight: 1.2 }} />
        {opts.map((o, i) => (
          <div key={i} className="flex gap-2">
            <input value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value.slice(0, LIMITS.o) : x)))}
              aria-label={`Answer ${i + 1}`} placeholder={["Yes", "No", "A third answer", "A fourth answer"][i]}
              className="flex-1 min-w-0 rounded-[16px] px-4 h-[52px] outline-none" style={{ ...field, fontSize: 18 }} />
            {i >= 2 && (
              <button type="button" onClick={() => setOpts(opts.filter((_, j) => j !== i))} aria-label={`Remove answer ${i + 1}`}
                className="ms-press w-[52px] h-[52px] rounded-[16px] shrink-0" style={{ background: T.faint, color: T.ink, fontSize: 22 }}>−</button>
            )}
          </div>
        ))}
        {opts.length < 4 && (
          <button type="button" onClick={() => setOpts([...opts, ""])} className="ms-press w-full h-12 rounded-[16px]"
            style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16, color: T.muted, border: `1.5px dashed ${T.edge}` }}>+ Add an answer</button>
        )}

        <Label T={T} className="pt-2">Category</Label>
        <div className="flex flex-wrap gap-2">
          {CAT_ORDER.map((k) => {
            const on = cat === k, bg = on ? mix(CAT_HEX[k], T.sheet, .1) : T.faint;
            return (
              <button key={k} type="button" onClick={() => setCat(k)} aria-pressed={on}
                className="ms-press px-3.5 h-10 rounded-full inline-flex items-center gap-1.5"
                style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 15, background: bg, color: on ? inkOn(bg) : T.ink }}>
                <span aria-hidden="true">{CAT_EMOJI[k]}</span>{CAT_LABEL[k]}
              </button>
            );
          })}
        </div>

        <Label T={T} className="pt-2">Show my name</Label>
        <div className="grid grid-cols-2 gap-2">
          {[[`As @${handle || "you"}`, false], ["Anonymously", true]].map(([label, v]) => (
            <button key={label} type="button" onClick={() => setAnon(v)} aria-pressed={anon === v} className="ms-press h-12 rounded-[16px] truncate px-2"
              style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16, background: anon === v ? T.accent : T.faint, color: anon === v ? inkOn(T.accent) : T.ink }}>{label}</button>
          ))}
        </div>
        <p style={{ fontFamily: "var(--body)", fontSize: 14, color: T.muted, lineHeight: 1.45 }}>
          Votes are always anonymous. This only changes who gets credit for the question.
        </p>
      </div>
    </Sheet>
  );
}
