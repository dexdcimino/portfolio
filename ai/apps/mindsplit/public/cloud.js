/* MindSplit's line to the site account and to everyone else's votes.

   Served as /mindsplit/cloud.js (Vite copies public/ as-is) and loaded by the
   app with a runtime import(), never bundled, for two reasons: the Firebase
   SDK is the vendored copy under /dexnote/vendor/firebase/, imported by the
   SAME URLs account/site-auth.js uses so one page has one Firebase app; and a
   harness can answer this one URL with a fake, since nothing can sign in to
   Google from a test.

   WHO VOTES. A signed-in visitor votes as their site account (the uid every
   app on dexcimino.com shares). A signed-out one votes as an ANONYMOUS
   Firebase user in a separate named app, 'mindsplit', so the site account's
   own app never shows "signed in" for someone who only tapped an answer. The
   project already allows anonymous sign-in (Inko's shared canvases use it).

   WHAT IS STORED, in the dexnote-d7047 Firestore (rules: docs/mindsplit.rules):

     msCounts/<poll id>          { c0..c3, n }       public, the live split
     msVotes/<poll id>_<uid>     { p, u, c }         only its owner reads it
     msPolls/<id>                { q, o, cat, uid, by, at, rep }   asked by people
     msUsers/<uid>               { handle, posted }  public name, post clock
     msHandles/<handle>          { uid }             one name, one account
     msReports/<poll id>_<uid>   { p, u, why, at }   Dex reads these

   A vote is ONE batch: the vote document and the count move together, and the
   rules refuse either alone, which is what holds one vote per account per
   poll. Votes stay anonymous: nothing public says who picked what.

   Every call here can fail (offline, rules not pasted yet), and the app treats
   a failure as "this stays on this phone" rather than as an error screen. */

const V = '/dexnote/vendor/firebase/';
let site = null, F = null, A = null, anonApp = null;
const loadSite = () => (site ||= import('/account/site-auth.js'));
const loadFs = () => (F ||= import(V + 'firebase-firestore.js'));
const loadAuth = () => (A ||= import(V + 'firebase-auth.js'));

let user = null;              // the site account, as Firebase hands it over
let ready = null;             // resolves once the first onUser has fired

function plain(u) {
  if (!u) return null;
  const via = (u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'password';
  // An Inko name-and-password account signs in with an address the site made
  // up for it (lib/sketch-store.js siteBridge); its name is who it is.
  const made = /@accounts\.dexcimino\.com$/i.test(u.email || '');
  return { uid: u.uid, name: u.displayName || '', email: made ? '' : (u.email || ''), photo: u.photoURL || '', provider: via };
}

/* Every change of who is signed in, starting with the current one. */
export async function onUser(fn) {
  const s = await loadSite();
  let first = null;
  ready ||= new Promise((r) => { first = r; });
  return s.onUser((u) => { user = u; if (first) { first(); first = null; } fn(plain(u)); });
}

export async function signIn(which) { return (await loadSite()).signIn(which); }
export async function signInEmail(email, password) { return (await loadSite()).signInEmail(email, password); }
export async function createEmail(email, password) { return (await loadSite()).createEmail(email, password); }
export async function resetPassword(email) { return (await loadSite()).resetPassword(email); }
export async function signOut() { return (await loadSite()).signOut(); }
export async function errorText(err) { return (await loadSite()).errorText(err); }
export async function cancelled(err) { return (await loadSite()).cancelled(err); }

/* The signed-out side: a named app whose auth is only ever anonymous. Made
   on first need; signed in to nothing until a vote needs a uid. */
async function anon() {
  if (anonApp) return anonApp;
  const { getApps, initializeApp } = await import(V + 'firebase-app.js');
  const s = await loadSite();
  const au = await loadAuth();
  const app = getApps().find((a) => a.name === 'mindsplit') || initializeApp(s.CONFIG, 'mindsplit');
  // No popup resolver: an anonymous sign-in needs none, and without it the
  // SDK never opens the authDomain iframe.
  const auth = au.initializeAuth(app, { persistence: [au.indexedDBLocalPersistence, au.browserLocalPersistence] });
  anonApp = { app, auth };
  return anonApp;
}

/* The database a reader or voter uses: the account's app when signed in, the
   anonymous one when not. Reads and votes MUST share one instance: Firestore
   applies a write to its own listeners at once, which is what makes your
   vote appear in the split the instant you tap, before the server answers. */
async function db() {
  const fs = await loadFs();
  if (ready) await ready;
  if (user) {
    const { getApps } = await import(V + 'firebase-app.js');
    return { fs, db: fs.getFirestore(getApps().find((a) => a.name === '[DEFAULT]')), account: true };
  }
  const a = await anon();
  return { fs, db: fs.getFirestore(a.app), account: false, auth: a.auth };
}

/* db(), plus a uid to vote with: signs the anonymous app in if it must. */
async function voter() {
  const d = await db();
  if (d.account) return { ...d, uid: user.uid };
  await d.auth.authStateReady();
  if (!d.auth.currentUser) await (await loadAuth()).signInAnonymously(d.auth);
  return { ...d, uid: d.auth.currentUser.uid };
}
const reader = db;

/* ---------- votes ---------- */

export async function vote(pid, c) {
  const { fs, db, uid } = await voter();
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, 'msVotes', `${pid}_${uid}`), { p: pid, u: uid, c });
  b.set(fs.doc(db, 'msCounts', pid), { [`c${c}`]: fs.increment(1), n: fs.increment(1) }, { merge: true });
  await b.commit();
  return uid;
}

/* Take a vote back, for the one change a poll allows. Only the uid that cast
   it can, so a vote cast signed out stays put after signing in. */
export async function unvote(pid, c, by) {
  const { fs, db, uid } = await voter();
  if (by && by !== uid) throw new Error('cast by another sign-in');
  const b = fs.writeBatch(db);
  b.delete(fs.doc(db, 'msVotes', `${pid}_${uid}`));
  b.set(fs.doc(db, 'msCounts', pid), { [`c${c}`]: fs.increment(-1), n: fs.increment(-1) }, { merge: true });
  await b.commit();
}

/* This account's votes from every device: { pollId: choice }. */
export async function myVotes() {
  if (ready) await ready;
  if (!user) return {};
  const { fs, db, uid } = await voter();
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'msVotes'), fs.where('u', '==', uid), fs.limit(2000)));
  const out = {};
  snap.forEach((d) => { const v = d.data(); if (typeof v.p === 'string' && Number.isInteger(v.c)) out[v.p] = v.c; });
  return out;
}

const countsOf = (data, n) => Array.from({ length: n }, (_, i) => Math.max(0, Number(data && data[`c${i}`]) || 0));

/* The live split of one poll; calls fn(counts[]) now and on every vote. */
export async function watchCounts(pid, n, fn) {
  const { fs, db } = await reader();
  return fs.onSnapshot(fs.doc(db, 'msCounts', pid), (d) => fn(countsOf(d.data(), n)), (err) => console.warn('mindsplit: counts', err.code || err));
}

/* The most-answered questions' counts, read once at launch: they order
   "Most voted" and fill a card before its listener speaks. */
export async function topCounts() {
  const { fs, db: d } = await reader();
  const snap = await fs.getDocs(fs.query(fs.collection(d, 'msCounts'), fs.orderBy('n', 'desc'), fs.limit(200)));
  const out = {};
  snap.forEach((doc) => { out[doc.id] = countsOf(doc.data(), 4); });
  return out;
}

/* Several polls at once, for the profile: { id: counts[] }. */
export async function getCounts(polls) {
  const { fs, db } = await reader();
  const out = {};
  for (let i = 0; i < polls.length; i += 30) {
    const chunk = polls.slice(i, i + 30);
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'msCounts'), fs.where(fs.documentId(), 'in', chunk.map((p) => p.id))));
    const n = Object.fromEntries(chunk.map((p) => [p.id, p.o.length]));
    snap.forEach((d) => { out[d.id] = countsOf(d.data(), n[d.id]); });
  }
  return out;
}

/* ---------- polls people ask ---------- */

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : Date.now());

export async function loadPolls() {
  const { fs, db } = await reader();
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'msPolls'), fs.orderBy('at', 'desc'), fs.limit(200)));
  const out = [];
  snap.forEach((d) => {
    const p = d.data();
    if (!p || typeof p.q !== 'string' || !Array.isArray(p.o)) return;
    out.push({ id: d.id, q: p.q, o: p.o, cat: p.cat, by: p.by || null, uid: p.uid, at: ms(p.at), rep: p.rep || 0 });
  });
  return out;
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return 'u' + Array.from(b, (x) => ID_CHARS[x % ID_CHARS.length]).join('');
}

/* Post a question. Needs an account with a name (the rules check `by`
   against msUsers and hold one post a minute through `posted`). */
export async function postPoll({ id, q, o, cat, anon }) {
  const { fs, db, uid, account } = await voter();
  if (!account) throw new Error('Sign in to ask a question.');
  const me = await fs.getDoc(fs.doc(db, 'msUsers', uid));
  const handle = me.exists() ? me.data().handle : null;
  if (!handle) throw new Error('Pick a name first.');
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, 'msPolls', id), { q, o, cat, uid, by: anon ? null : handle, at: fs.serverTimestamp(), rep: 0 });
  b.set(fs.doc(db, 'msUsers', uid), { handle, posted: fs.serverTimestamp() });
  await b.commit();
  return { id, by: anon ? null : handle };
}

export async function deletePoll(id) {
  const { fs, db } = await voter();
  await fs.deleteDoc(fs.doc(db, 'msPolls', id));
}

export async function report(pid, why, asked) {
  const { fs, db, uid } = await voter();
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, 'msReports', `${pid}_${uid}`), { p: pid, u: uid, why, at: fs.serverTimestamp() });
  // A question someone asked carries a report count; three hide it.
  if (asked) b.update(fs.doc(db, 'msPolls', pid), { rep: fs.increment(1) });
  await b.commit();
}

/* ---------- names ---------- */

export const HANDLE = /^[a-z0-9_]{3,20}$/;

export async function myHandle() {
  if (ready) await ready;
  if (!user) return null;
  const { fs, db, uid } = await voter();
  const d = await fs.getDoc(fs.doc(db, 'msUsers', uid));
  return d.exists() ? d.data().handle || null : null;
}

/* Claim a name: msHandles/<name> is created once and only by its owner, so
   two accounts can never hold the same one. The old name is let go. */
export async function claimHandle(raw) {
  const handle = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) throw new Error('3 to 20 letters, numbers or _');
  const { fs, db, uid, account } = await voter();
  if (!account) throw new Error('Sign in first.');
  const taken = await fs.getDoc(fs.doc(db, 'msHandles', handle));
  if (taken.exists() && taken.data().uid !== uid) throw new Error(`@${handle} is taken`);
  const me = await fs.getDoc(fs.doc(db, 'msUsers', uid));
  const old = me.exists() ? me.data().handle : null;
  const b = fs.writeBatch(db);
  if (!taken.exists()) b.set(fs.doc(db, 'msHandles', handle), { uid });
  b.set(fs.doc(db, 'msUsers', uid), { handle }, { merge: true });
  if (old && old !== handle) b.delete(fs.doc(db, 'msHandles', old));
  try { await b.commit(); }
  catch (err) {
    if (err && err.code === 'permission-denied' && /^dex/.test(handle)) throw new Error(`@${handle} is reserved`);
    throw err;
  }
  return handle;
}

/* A name to offer on a first sign-in: the person's Inko name if the same
   site account already has one, so one person is one @name on the site. */
export async function suggestHandle() {
  try {
    const s = await loadSite();
    const idToken = await s.idToken();
    if (!idToken) return '';
    const r = await fetch('/api/sketch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'site', idToken }) });
    const body = await r.json().catch(() => ({}));
    return (body.handle || body.suggest || '').toLowerCase();
  } catch { return ''; }
}
