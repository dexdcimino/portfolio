import { inkOn } from "../lib/color.js";
import { Ico } from "./Icons.jsx";

/* One gesture reader for the whole app: the feed, the profile and every sheet
   use it, so a swipe means the same thing everywhere. It fires AT MOST ONE
   direction per gesture — the dominant axis wins by 1.4x, and an ambiguous
   diagonal does nothing rather than guessing. Pointer events, so touch, pen
   and mouse-drag are one path. */
const SWIPE_MIN = 55;
export function swipeHandlers({ onUp, onDown, onLeft, onRight, axis = "any" }) {
  let start = null;
  return {
    onPointerDown: (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; },
    onPointerCancel: () => { start = null; },
    onPointerUp: (e) => {
      const s = start; start = null;
      if (!s || Date.now() - s.t > 900) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (axis !== "y" && ax > ay * 1.4 && ax > SWIPE_MIN) { if (dx < 0) onLeft?.(); else onRight?.(); return; }
      if (axis !== "x" && ay > ax * 1.4 && ay > SWIPE_MIN) { if (dy < 0) onUp?.(); else onDown?.(); }
    },
  };
}

/* A sheet over the bottom of the frame. Pinned to the bottom half by default
   (the thumb rule: every control in a sheet is below the midpoint); `tall`
   is for the one sheet that has to hold a keyboard and a form, Ask. Swipe
   down, or right the way "back" goes, to dismiss. */
export function Sheet({ title, sub, T, onClose, children, footer, tall, label }) {
  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label={label || title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" style={{ background: T.scrim }} />
      <div className="absolute left-0 right-0 bottom-0 flex flex-col rounded-t-[30px] overflow-hidden"
        style={{ height: tall ? "72%" : "50%", background: T.sheet, color: T.ink, animation: "uvUp 340ms cubic-bezier(.22,1,.36,1)" }}
        {...swipeHandlers({ onDown: onClose, onRight: onClose })}>
        <div className="px-5 pt-3 pb-3 shrink-0">
          <div className="mx-auto w-10 h-1.5 rounded-full mb-4" style={{ background: T.faint }} />
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h3 style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 24, letterSpacing: "-.035em", lineHeight: 1.1 }}>{title}</h3>
              {sub && <p className="mt-1.5" style={{ fontFamily: "var(--body)", fontSize: 15, color: T.muted, lineHeight: 1.35 }}>{sub}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="ms-press w-11 h-11 rounded-full grid place-items-center shrink-0" style={{ background: T.faint }}>{Ico.close(T.ink)}</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto uv-nobar px-5 min-h-0">{children}</div>
        {footer && <div className="px-5 pt-2 shrink-0" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{footer}</div>}
      </div>
    </div>
  );
}

/* A full-width button: `primary` in the accent, otherwise a quiet step. */
export const Wide = ({ T, onClick, label, primary, disabled, tone, children, type = "button" }) => {
  const bg = disabled ? T.faint : tone || (primary ? T.accent : T.faint);
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="ms-press w-full h-14 rounded-[18px] inline-flex items-center justify-center gap-2.5"
      style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 17, background: bg,
               color: disabled ? T.muted : (primary || tone) ? inkOn(bg) : T.ink, opacity: disabled ? .7 : 1 }}>
      {children}{label}
    </button>
  );
};

export const Label = ({ T, children, className = "" }) => (
  <p className={`mb-2.5 ${className}`} style={{ fontFamily: "var(--body)", fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted }}>{children}</p>
);
