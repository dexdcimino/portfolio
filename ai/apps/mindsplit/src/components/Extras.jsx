import { useEffect, useState } from "react";
import { inkOn } from "../lib/color.js";
import { Sheet, Wide } from "./Sheet.jsx";
import { Ico } from "./Icons.jsx";

/* Share: the split as text, through the phone's own share sheet where there
   is one (it is on every phone browser and in the installed app), and the
   clipboard where there is not. */
export function ShareSheet({ T, text, url, onClose }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* blocked */ }
  };
  const share = async () => {
    try { await navigator.share({ text, url }); onClose(); } catch { /* cancelled */ }
  };
  return (
    <Sheet title="Share this split" sub="The question and how people answered" T={T} onClose={onClose}
      footer={
        <div className={canShare ? "grid grid-cols-2 gap-2.5" : ""}>
          <Wide T={T} onClick={copy} label={copied ? "Copied" : "Copy"} />
          {canShare && <Wide T={T} onClick={share} label="Share" primary />}
        </div>
      }>
      <div className="rounded-[20px] p-4 mb-4" style={{ background: T.faint }}>
        <p style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 17, lineHeight: 1.45, whiteSpace: "pre-line" }}>{text}</p>
        <p className="mt-2" style={{ fontFamily: "var(--body)", fontSize: 14, color: T.muted }}>{url}</p>
      </div>
    </Sheet>
  );
}

export const REASONS = ["Hate or harassment", "Sexual content", "Violence or threats", "Spam or an ad", "Misleading or false", "Something else"];

/* Report. Three reports hide a question someone asked; every report lands
   where Dex can read it. Dex, and whoever asked it, can also remove it. */
export function FlagSheet({ T, onClose, onSubmit, canDelete, onDelete }) {
  return (
    <Sheet title="Report this question" sub="Tell us what is wrong with it" T={T} onClose={onClose}
      footer={canDelete ? <Wide T={T} onClick={onDelete} label="Remove this question" tone="#E5484D">{Ico.trash("#FFFFFF")}</Wide> : null}>
      <div className="space-y-2 pb-4">
        {REASONS.map((r) => (
          <button key={r} type="button" onClick={() => onSubmit(r)} className="ms-press w-full text-left px-4 h-[52px] rounded-[16px]"
            style={{ background: T.faint, fontFamily: "var(--disp)", fontWeight: 700, fontSize: 17, color: T.ink }}>{r}</button>
        ))}
      </div>
    </Sheet>
  );
}

/* Install, opened by ?install=1 (the AI Lab card's download button). The
   browser's own prompt where there is one (Chrome, Edge, Android), and the
   Add to Home Screen steps where there is not (Safari, iPhone). Opened
   INSIDE the dexcimino.com app it says to remove that first: its scope is
   the whole site, so Android will not install a second app under it. */
export function InstallSheet({ T, onClose }) {
  const [prompt, setPrompt] = useState(() => window.__msInstall);
  useEffect(() => { const on = () => setPrompt(window.__msInstall); window.addEventListener("ms:installable", on); return () => window.removeEventListener("ms:installable", on); }, []);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const insideSite = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const steps = insideSite
    ? ["Open dexcimino.com in your browser instead of the site’s app", "Remove the dexcimino.com app first, then install MindSplit", "Add the site’s app back afterwards"]
    : prompt ? null
    : ios ? ["Tap the Share button in Safari", "Tap Add to Home Screen"]
    : ["Open the browser menu (⋮)", "Tap Install app or Add to Home screen"];
  const install = async () => {
    if (!prompt) { onClose(); return; }
    prompt.prompt();
    try { await prompt.userChoice; } catch { /* dismissed */ }
    window.__msInstall = null; onClose();
  };
  return (
    <Sheet T={T} onClose={onClose} title="Install MindSplit" sub="It goes on your home screen and opens like any other app."
      footer={<Wide T={T} onClick={install} label={prompt && !insideSite ? "Install" : "Got it"} primary />}>
      {steps && (
        <ol className="space-y-2.5 pb-4">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3 rounded-[16px] px-4 py-3" style={{ background: T.faint }}>
              <span className="w-8 h-8 rounded-full grid place-items-center shrink-0" style={{ background: T.accent, color: inkOn(T.accent), fontFamily: "var(--disp)", fontWeight: 800 }}>{i + 1}</span>
              <span style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 17 }}>{s}</span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
