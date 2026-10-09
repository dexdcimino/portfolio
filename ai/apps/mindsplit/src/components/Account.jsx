import { useEffect, useRef, useState } from "react";
import { inkOn } from "../lib/color.js";
import { Sheet, Wide } from "./Sheet.jsx";
import { Ico } from "./Icons.jsx";

/* Google, GitHub and Discord in their own colours, the way every app shows
   them, so nobody has to read the label to find theirs. */
const PROVIDERS = [
  ["google", "Google", "#FFFFFF", "#1F1F1F"],
  ["discord", "Discord", "#5865F2", "#FFFFFF"],
  ["github", "GitHub", "#24292F", "#FFFFFF"],
];

const Field = ({ T, ...props }) => (
  <input {...props} className="w-full rounded-[16px] px-4 h-[54px] outline-none"
    style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 18, color: T.ink, background: T.faint, border: `1.5px solid ${T.edge}` }} />
);

const errStyle = (T) => ({ fontFamily: "var(--body)", fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.light ? "#C62828" : "#FFD3D3" });

/* The account sheet. Signed out it signs in (the SITE account, the one
   DexNote and Inko use); signed in with no name yet it asks for one; signed
   in with a name it shows who you are, lets you rename, and signs out.

   A sign-in that has started never falls back to the buttons silently: it
   says what is happening until it finishes, and a failure says why. */
export function AccountSheet({ T, cloud, user, handle, reason, onClose, onHandle }) {
  const [view, setView] = useState(user ? (handle ? "me" : "name") : "providers");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState(handle || "");
  const named = useRef(false);

  // The sign-in finishing (here or in another tab) moves the sheet on.
  useEffect(() => {
    if (user && (view === "providers" || view === "email")) { setBusy(null); setView(handle ? "me" : "name"); }
    if (!user && (view === "me" || view === "name")) setView("providers");
  }, [user, handle, view]);

  // A first name: the person's Inko name if they have one, else their own.
  useEffect(() => {
    if (view !== "name" || named.current || !cloud) return;
    named.current = true;
    cloud.suggestHandle().then((s) => {
      const fallback = (user?.name || user?.email?.split("@")[0] || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
      setName((n) => n || s || fallback);
    });
  }, [view, cloud, user]);

  const run = async (label, fn) => {
    setError(""); setNote(""); setBusy(label);
    try { await fn(); } catch (err) {
      if (cloud && await cloud.cancelled(err)) { setBusy(null); return; }
      setError(err && /^auth\//.test(err.code || "") ? await cloud.errorText(err)
        : err && err.code === "permission-denied" ? "The server refused that. Try again in a minute."
        : (err && err.message) || "That did not work. Try again.");
    }
    setBusy(null);
  };

  if (!cloud) {
    return (
      <Sheet T={T} onClose={onClose} title="Accounts are offline" sub="This copy of MindSplit cannot reach the account service. Your answers are kept on this phone.">
        <div />
      </Sheet>
    );
  }

  if (busy && (view === "providers")) {
    return (
      <Sheet T={T} onClose={onClose} title={busy} sub="Finish in the window that opened">
        <div className="h-full grid place-items-center pb-8">
          <span className="ms-spin w-10 h-10 rounded-full" style={{ border: `4px solid ${T.faint}`, borderTopColor: T.accent }} aria-label="Signing in" />
        </div>
      </Sheet>
    );
  }

  if (view === "providers") {
    return (
      <Sheet T={T} onClose={onClose} title="Sign in to MindSplit"
        sub={reason || "One dexcimino.com account for MindSplit, Inko and DexNote"}>
        <div className="space-y-2.5 pb-4">
          {PROVIDERS.map(([id, label, bg, fg]) => (
            <button key={id} type="button" onClick={() => run(`Signing in with ${label}…`, () => cloud.signIn(id))}
              className="ms-press w-full h-14 rounded-[18px] inline-flex items-center justify-center gap-3"
              style={{ background: bg, color: fg, fontFamily: "var(--disp)", fontWeight: 800, fontSize: 18,
                       boxShadow: bg === "#FFFFFF" ? `inset 0 0 0 1.5px ${T.edge}` : "none" }}>
              {Ico[id](fg, 21)}{label}
            </button>
          ))}
          <button type="button" onClick={() => { setError(""); setView("email"); }}
            className="ms-press w-full h-14 rounded-[18px] inline-flex items-center justify-center gap-3"
            style={{ background: T.faint, color: T.ink, fontFamily: "var(--disp)", fontWeight: 800, fontSize: 18 }}>
            {Ico.mail(T.ink, 21)}Email and password
          </button>
          {error && <p role="alert" style={errStyle(T)}>{error}</p>}
        </div>
      </Sheet>
    );
  }

  if (view === "email") {
    const go = (create) => run(create ? "Creating your account…" : "Signing in…", () =>
      create ? cloud.createEmail(email, pass) : cloud.signInEmail(email, pass));
    return (
      <Sheet T={T} onClose={onClose} title="Email and password" sub="Sign in, or make a new account with any email">
        <form className="space-y-2.5 pb-4" onSubmit={(e) => { e.preventDefault(); go(false); }}>
          <Field T={T} type="email" autoComplete="email" placeholder="you@example.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field T={T} type="password" autoComplete="current-password" placeholder="Password (6 or more characters)" aria-label="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
          {error && <p role="alert" style={errStyle(T)}>{error}</p>}
          {note && <p style={{ ...errStyle(T), color: T.ink }}>{note}</p>}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <Wide T={T} type="submit" label={busy === "Signing in…" ? "Signing in…" : "Sign in"} primary disabled={!!busy} />
            <Wide T={T} onClick={() => go(true)} label={busy === "Creating your account…" ? "Creating…" : "Create account"} disabled={!!busy} />
          </div>
          <div className="flex justify-between pt-1">
            <button type="button" onClick={() => setView("providers")} className="h-11 px-1" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16, color: T.muted }}>← Other ways</button>
            <button type="button" className="h-11 px-1" style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 16, color: T.muted }}
              onClick={() => run("Sending…", async () => { await cloud.resetPassword(email); setNote(`A reset link is on its way to ${email.trim()}.`); })}>Forgot password?</button>
          </div>
        </form>
      </Sheet>
    );
  }

  if (view === "name") {
    const save = () => run("Saving…", async () => { const h = await cloud.claimHandle(name); onHandle(h); setView("me"); });
    return (
      <Sheet T={T} onClose={onClose} title={handle ? "Change your name" : "Pick your name"} sub="This is who people see when you ask a question. Your votes stay anonymous.">
        <form className="space-y-2.5 pb-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2" style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 18, color: T.muted }}>@</span>
            <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))}
              aria-label="Your name" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="yourname"
              className="w-full rounded-[16px] pl-9 pr-4 h-[54px] outline-none"
              style={{ fontFamily: "var(--disp)", fontWeight: 700, fontSize: 18, color: T.ink, background: T.faint, border: `1.5px solid ${T.edge}` }} />
          </div>
          <p style={{ fontFamily: "var(--body)", fontSize: 14, color: T.muted }}>3 to 20 letters, numbers or _</p>
          {error && <p role="alert" style={errStyle(T)}>{error}</p>}
          <Wide T={T} type="submit" label={busy ? "Saving…" : "Save"} primary disabled={!!busy || name.length < 3} />
        </form>
      </Sheet>
    );
  }

  // Signed in, with a name.
  const via = { "google.com": "Google", "github.com": "GitHub", "oidc.discord": "Discord", password: "email" }[user?.provider] || "your account";
  return (
    <Sheet T={T} onClose={onClose} title={`@${handle}`} sub={`Signed in with ${via}${user?.email ? ` as ${user.email}` : ""}`}>
      <div className="space-y-2.5 pb-4">
        <Wide T={T} onClick={() => { setName(handle || ""); setView("name"); }} label="Change your name" />
        <Wide T={T} onClick={() => run("Signing out…", async () => { await cloud.signOut(); onClose(); })} label="Sign out" />
        {error && <p role="alert" style={errStyle(T)}>{error}</p>}
        <p className="pt-1" style={{ fontFamily: "var(--body)", fontSize: 14, color: T.muted, lineHeight: 1.45 }}>
          The same account signs you in to Inko and DexNote on dexcimino.com.
        </p>
      </div>
    </Sheet>
  );
}

/* A round face for the dock and the profile: the provider's picture when
   there is one, the first letter of the name when not. */
export function Avatar({ T, user, handle, size = 44 }) {
  const [bad, setBad] = useState(false);
  const letter = (handle || user?.name || user?.email || "?").replace(/^@/, "").charAt(0).toUpperCase();
  if (user?.photo && !bad) {
    return <img src={user.photo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBad(true)}
      className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-full grid place-items-center" style={{ width: size, height: size, background: T.accent, color: inkOn(T.accent),
      fontFamily: "var(--disp)", fontWeight: 800, fontSize: size * .44 }}>{letter}</span>
  );
}
