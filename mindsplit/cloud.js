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
     msUsers/<uid>               { handle, posted }  a copy of the account's @name, post clock
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
  return s.onUser((u) => {
    // A different person (or nobody) holds no name from the last one.
    if (!u || !user || u.uid !== user.uid) { inko = null; ticket = null; suggested = ''; }
    user = u; if (first) { first(); first = null; } fn(plain(u));
  });
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

/* ---------- names: ONE @handle per account, across the site ----------

   The name is the account's INKO name (Dex, 2026-10-09: "one universal
   @handle per account across every app"). Inko's server (/api/sketch, Blob)
   is the authority: it holds the reserved names, refuses a taken one, moves
   everything on a rename, and already links each site uid to its name
   (action 'site'). MindSplit never decides a name itself. It asks that
   server, and COPIES the answer into msUsers/msHandles, because the rules
   check a question's `by` against msUsers and cannot call out to anything.

   So a name picked here makes the Inko account (action 'claim'), a rename
   here renames it there (canvases, picture and followers move with it), and
   a rename made in Inko reaches MindSplit on the next launch, when myHandle()
   finds the copy stale and rewrites it. A name somebody claimed in MindSplit
   before the names were one is offered to Inko on their next launch and
   becomes their universal name when it is free there.

   Following is Inko's too: one follow graph for one account. */

export const HANDLE = /^[a-z0-9_]{3,20}$/;
const API = '/api/sketch';

let inko = null;       // { handle, token } this site account holds on the name server
let ticket = null;     // or a ticket to claim one, when it has none yet
let suggested = '';

class NameError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function call(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new NameError(out.error || 'The name server did not answer. Try again.', r.status);
  return out;
}

/* Who this site account is on the name server. */
async function link() {
  const s = await loadSite();
  const idToken = await s.idToken();
  if (!idToken) throw new NameError('Sign in again.', 401);
  const r = await call({ action: 'site', idToken });
  if (r.handle) { inko = { handle: r.handle, token: r.token }; ticket = null; }
  else { inko = null; ticket = r.ticket || null; suggested = (r.suggest || '').toLowerCase(); }
  return r;
}

/* A signed-in call; a token outlived by a rename made elsewhere is renewed once. */
async function withToken(body) {
  if (!inko) await link();
  if (!inko) throw new NameError('Pick a name first.', 400);
  try { return await call({ ...body, token: inko.token }); }
  catch (err) {
    if (err.status !== 401) throw err;
    await link();
    if (!inko) throw err;
    return call({ ...body, token: inko.token });
  }
}

/* Copy the name into Firestore, letting the old copy go, in one batch. */
async function mirror(handle) {
  const { fs, db, uid } = await voter();
  const me = await fs.getDoc(fs.doc(db, 'msUsers', uid));
  const old = me.exists() ? me.data().handle || null : null;
  if (old === handle) return;
  const held = await fs.getDoc(fs.doc(db, 'msHandles', handle));
  if (held.exists() && held.data().uid !== uid) throw new NameError(`@${handle} is held by another MindSplit account`, 409);
  const b = fs.writeBatch(db);
  if (!held.exists()) b.set(fs.doc(db, 'msHandles', handle), { uid });
  b.set(fs.doc(db, 'msUsers', uid), { handle }, { merge: true });
  if (old) {
    // Only a copy that is really ours: the rules refuse deleting one that is not there.
    const was = await fs.getDoc(fs.doc(db, 'msHandles', old));
    if (was.exists() && was.data().uid === uid) b.delete(fs.doc(db, 'msHandles', old));
  }
  await b.commit();
}

export async function myHandle() {
  if (ready) await ready;
  if (!user) return null;
  const { fs, db, uid } = await voter();
  const me = await fs.getDoc(fs.doc(db, 'msUsers', uid)).catch(() => null);
  const copy = me && me.exists() ? me.data().handle || null : null;
  try { await link(); }
  catch (err) { console.warn('mindsplit: name server', err.message || err); return copy; }
  if (inko) {
    if (inko.handle !== copy) await mirror(inko.handle).catch((err) => console.warn('mindsplit: name copy', err.message || err));
    return inko.handle;
  }
  // A MindSplit name from before the names were one: make it the universal one.
  if (copy && ticket) {
    try {
      const r = await call({ action: 'claim', ticket, handle: copy });
      inko = { handle: r.handle, token: r.token }; ticket = null;
      if (r.handle !== copy) await mirror(r.handle);
      return r.handle;
    } catch (err) { console.warn('mindsplit: old name not free', err.message || err); }
  }
  return null;
}

/* Pick a name (a first one makes the account's Inko account) or change it
   (a rename on the name server, which moves everything the name owns). */
export async function claimHandle(raw) {
  const handle = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) throw new Error('3 to 20 letters, numbers or _');
  const { account } = await voter();
  if (!account) throw new Error('Sign in first.');
  if (!inko && !ticket) await link();
  let r;
  if (inko) r = inko.handle === handle ? inko : await withToken({ action: 'rename', handle });
  else {
    try { r = await call({ action: 'claim', ticket, handle }); }
    catch (err) {
      if (err.status !== 401) throw err;
      await link();                           // the ticket ran out while the sheet was open
      r = inko || await call({ action: 'claim', ticket, handle });
    }
  }
  inko = { handle: r.handle, token: r.token }; ticket = null;
  await mirror(r.handle);
  return r.handle;
}

/* A name to offer on a first sign-in, from the account's own name. */
export async function suggestHandle() {
  try {
    if (!inko && !ticket) await link();
    return inko ? inko.handle : suggested;
  } catch { return ''; }
}

/* ---------- profiles ---------- */

const picture = (h, v) => (v ? `${API}?img=${encodeURIComponent(`sketch/avatars/${h}-${v}.jpg`)}` : '');

/* Anyone's public face: { handle, avatar (a URL or ''), followers, following }.
   The picture is their Inko one. A rename is followed to the new name. */
export async function person(raw) {
  let h = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  for (let hops = 0; hops < 3 && HANDLE.test(h); hops++) {
    const r = await fetch(`${API}?profile=${encodeURIComponent(h)}`);
    if (r.status === 404) return { handle: h, avatar: '', followers: 0, following: 0 };
    if (!r.ok) throw new Error('profile ' + r.status);
    const b = await r.json();
    if (b.movedTo) { h = b.movedTo; continue; }
    return { handle: b.handle, avatar: picture(b.handle, b.avatar), followers: b.followers || 0, following: b.following || 0 };
  }
  return null;
}

/* Follow or unfollow; answers { following, followers }. */
export async function follow(handle, on) {
  const r = await withToken({ action: 'follow', handle, on: on !== false });
  return { following: r.following, followers: r.followers };
}

/* The names this account follows. */
export async function following() {
  return (await withToken({ action: 'following' })).following || [];
}

/* The questions someone asked under their name, newest first. By their uid
   when it is known, so questions asked before a rename are still theirs;
   questions they asked anonymously are never listed. */
export async function pollsBy(handle, uidIn) {
  const { fs, db } = await reader();
  let uid = uidIn || null;
  if (!uid) {
    const h = await fs.getDoc(fs.doc(db, 'msHandles', handle));
    uid = h.exists() ? h.data().uid : null;
  }
  const q = uid ? fs.where('uid', '==', uid) : fs.where('by', '==', handle);
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'msPolls'), q, fs.limit(100)));
  const out = [];
  snap.forEach((d) => {
    const p = d.data();
    if (!p || typeof p.q !== 'string' || !Array.isArray(p.o) || !p.by) return;
    out.push({ id: d.id, q: p.q, o: p.o, cat: p.cat, by: p.by, uid: p.uid, at: ms(p.at), rep: p.rep || 0 });
  });
  return out.sort((a, b) => b.at - a.at);
}
