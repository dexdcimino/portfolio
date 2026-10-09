/* MindSplit, driven in a real browser.
 *
 *   node tools/mindsplit_check.mjs          (CHROME=<path> where Chrome is not the Windows default)
 *
 * Serves the repo itself, with the Content-Security-Policy vercel.json sends
 * for /mindsplit/, so a refused script or style shows up as a console error
 * and fails the run. /mindsplit/cloud.js -- the app's one line to Firebase --
 * is answered by a FAKE kept in localStorage: nothing can sign in to Google
 * from here, and the Firestore rules (docs/mindsplit.rules) are NOT exercised.
 * Try two real phones after a change there. The fake's exports are compared
 * with the real module's, so it cannot quietly drift from what it stands in for.
 *
 * What it drives, after counting the deck and checking the build is current:
 * the thumb rule measured off every control on screen, a REAL click on an
 * answer and the split it opens (the server's count moving with it), the vote
 * surviving a reload, the one change, a real swipe to the next card, a
 * category filter, signing in from Ask (Google through the fake, a name
 * offered from Inko, saved), a question typed with real keys and posted
 * first in the feed, removing your own question, the profile, signing out,
 * ?install=1, the manifest's icons, the service worker's scope, and the
 * AI Lab card's download button.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'ai/apps/mindsplit');
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the deck ---------- */
const { POLLS } = await import(pathToFileURL(join(SRC, 'src/data/polls.js')));
const { CAT_ORDER, CAT_LABEL } = await import(pathToFileURL(join(SRC, 'src/data/categories.js')));
note(POLLS.length === 390, `the deck has ${POLLS.length} questions, not 390`);
note(new Set(POLLS.map((p) => p.id)).size === POLLS.length, 'two questions share an id');
note(new Set(POLLS.map((p) => p.q.toLowerCase())).size === POLLS.length, 'two questions share their wording');
const bad = POLLS.filter((p) => !CAT_ORDER.includes(p.cat) || !/\?$/.test(p.q) || p.q.length > 72 || p.o.length < 2 || p.o.length > 4
  || p.o.some((o) => typeof o !== 'string' || !o || o.length > 24) || !/^[a-z]{3,8}-[0-9]{1,3}$/.test(p.id));
note(bad.length === 0, `questions that break the deck's rules: ${bad.map((p) => p.id).join(', ')}`);
const perCat = Object.fromEntries(CAT_ORDER.map((k) => [k, POLLS.filter((p) => p.cat === k).length]));
note(CAT_ORDER.length === 13 && Object.values(perCat).every((n) => n === 30), `per category: ${JSON.stringify(perCat)}`);
note(CAT_ORDER.every((k) => CAT_LABEL[k]), 'a category has no label');
// The rules hold the same list of categories a question may be asked in.
const rules = readFileSync(join(ROOT, 'docs/mindsplit.rules'), 'utf8');
const ruleCats = (/cat in \[([^\]]+)\]/.exec(rules) || [, ''])[1].match(/'([a-z]+)'/g)?.map((s) => s.slice(1, -1)) || [];
note(ruleCats.length === 13 && ruleCats.every((k, i) => k === CAT_ORDER[i]), `the rules' categories ${ruleCats.join(',')} are not the app's`);

/* ---------- the fake cloud, and that it is the real one's shape ---------- */
const FAKE = `
const K = '__msfake';
const S = () => JSON.parse(localStorage.getItem(K) || '{"user":null,"counts":{},"votes":{},"polls":[],"users":{},"handles":{},"reports":[]}');
const W = (s) => localStorage.setItem(K, JSON.stringify(s));
const userSubs = new Set(), subs = new Set();
const anonId = () => { let a = localStorage.getItem(K + 'anon'); if (!a) { a = 'anon-' + Math.random().toString(36).slice(2); localStorage.setItem(K + 'anon', a); } return a; };
const uid = () => (S().user ? S().user.uid : anonId());
const cnt = (pid, n) => Array.from({ length: n }, (_, i) => ((S().counts[pid] || {})['c' + i] || 0));
const fire = (pid) => subs.forEach((s) => s.pid === pid && s.fn(cnt(pid, s.n)));
window.__msFake = { S, W };
export async function onUser(fn) { userSubs.add(fn); fn(S().user); return () => userSubs.delete(fn); }
export async function signIn(which) { const s = S(); s.user = { uid: 'acct-' + which, name: 'Pat Example', email: 'pat@example.com', photo: '', provider: which === 'google' ? 'google.com' : which }; W(s); userSubs.forEach((f) => f(s.user)); }
export async function signInEmail(e) { const s = S(); s.user = { uid: 'acct-mail', name: '', email: e, photo: '', provider: 'password' }; W(s); userSubs.forEach((f) => f(s.user)); }
export const createEmail = signInEmail;
export async function resetPassword() {}
export async function signOut() { const s = S(); s.user = null; W(s); userSubs.forEach((f) => f(null)); }
export async function errorText(e) { return 'fake: ' + (e.code || e.message); }
export async function cancelled() { return false; }
export async function vote(pid, c) { const s = S(), k = pid + '_' + uid(); if (s.votes[k] !== undefined) throw Object.assign(new Error('twice'), { code: 'permission-denied' });
  s.votes[k] = c; const d = s.counts[pid] ||= { n: 0 }; d['c' + c] = (d['c' + c] || 0) + 1; d.n++; W(s); fire(pid); return uid(); }
export async function unvote(pid, c, by) { if (by && by !== uid()) throw new Error('cast by another sign-in'); const s = S(); delete s.votes[pid + '_' + uid()]; const d = s.counts[pid]; d['c' + c]--; d.n--; W(s); fire(pid); }
export async function myVotes() { const s = S(), u = uid(), o = {}; if (!s.user) return o; for (const [k, v] of Object.entries(s.votes)) if (k.endsWith('_' + u)) o[k.slice(0, -u.length - 1)] = v; return o; }
export async function watchCounts(pid, n, fn) { const t = { pid, n, fn }; subs.add(t); fn(cnt(pid, n)); return () => subs.delete(t); }
export async function topCounts() { const o = {}; for (const pid of Object.keys(S().counts)) o[pid] = cnt(pid, 4); return o; }
export async function getCounts(polls) { const o = {}; for (const p of polls) o[p.id] = cnt(p.id, p.o.length); return o; }
export async function loadPolls() { return S().polls; }
export function newId() { return 'u' + Math.random().toString(36).slice(2, 16).padEnd(14, 'x'); }
export async function postPoll({ id, q, o, cat, anon }) { const s = S(); const by = anon ? null : s.users[uid()]; s.polls.unshift({ id, q, o, cat, by, uid: uid(), at: Date.now(), rep: 0 }); W(s); return { id, by }; }
export async function deletePoll(id) { const s = S(); s.polls = s.polls.filter((p) => p.id !== id); W(s); }
export async function report(pid, why) { const s = S(); s.reports.push([pid, why]); W(s); }
export const HANDLE = /^[a-z0-9_]{3,20}$/;
export async function myHandle() { const s = S(); return s.user ? s.users[uid()] || null : null; }
export async function claimHandle(h) { const s = S(); h = String(h).toLowerCase(); s.users[uid()] = h; s.handles[h] = uid(); W(s); return h; }
export async function suggestHandle() { return 'inkoname'; }
// Faces and follows: Inko's in the real module, kept here per handle.
export async function person(h) { const s = S(), f = (s.faces || {})[h] || {}; return { handle: h, avatar: f.avatar || '', followers: (s.followers || {})[h]?.length || 0, following: Object.values(s.followers || {}).filter((l) => l.includes(s.users[uid()])).length }; }
export async function follow(h, on) { const s = S(), me = s.users[uid()]; if (!me) throw new Error('Pick a name first.'); const l = ((s.followers ||= {})[h] ||= []); const i = l.indexOf(me);
  if (on !== false && i < 0) l.push(me); if (on === false && i >= 0) l.splice(i, 1); W(s); return { following: on !== false, followers: l.length }; }
export async function following() { const s = S(), me = s.users[uid()]; return Object.entries(s.followers || {}).filter(([, l]) => l.includes(me)).map(([h]) => h); }
export async function pollsBy(h, u) { return S().polls.filter((p) => p.by && (u ? p.uid === u : p.by === h)); }
`;
const exportsOf = (src) => new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]));
const real = exportsOf(readFileSync(join(SRC, 'public/cloud.js'), 'utf8')), fake = exportsOf(FAKE);
note(real.size >= 20 && [...real].every((n) => fake.has(n)) && [...fake].every((n) => real.has(n)),
  `the fake cloud's exports differ from public/cloud.js: real ${[...real].join(',')} / fake ${[...fake].join(',')}`);

/* ---------- ONE @name: the REAL cloud.js against a fake name server ----------
   The browser half runs on a fake cloud.js, so the name logic in the real one
   -- Inko's server as the authority, Firestore as its copy -- is driven here,
   in this process: the real module, with the site account, the Firebase SDK
   and fetch('/api/sketch') swapped for small fakes. The Firestore rules are
   still not exercised. */
{
  const dir = mkdtempSync(join(tmpdir(), 'mscloud-'));
  try {
    const url = (f) => pathToFileURL(join(dir, f)).href;
    writeFileSync(join(dir, 'site.js'), `
      const S = globalThis.__site;
      export const CONFIG = {};
      export function onUser(fn) { S.subs.add(fn); fn(S.user); return () => S.subs.delete(fn); }
      export async function idToken() { return S.user ? 'tok:' + S.user.uid : null; }
      export async function signIn() {} export async function signOut() {}`);
    writeFileSync(join(dir, 'firebase-app.js'), `export const getApps = () => [{ name: '[DEFAULT]' }]; export const initializeApp = () => ({ name: 'mindsplit' });`);
    writeFileSync(join(dir, 'firebase-auth.js'), `export const initializeAuth = () => ({});`);
    writeFileSync(join(dir, 'firebase-firestore.js'), `
      const D = globalThis.__fs;
      const key = (r) => r.c + '/' + r.id;
      export const getFirestore = () => D;
      export const doc = (db, c, id) => ({ c, id });
      export async function getDoc(r) { const v = D.docs[key(r)]; return { exists: () => !!v, data: () => v }; }
      export const collection = (db, c) => ({ c });
      export const where = (f, op, v) => ({ f, v });
      export const limit = (n) => ({ n });
      export const query = (col, ...w) => ({ c: col.c, w: w.filter((x) => x.f) });
      export async function getDocs(q) { const rows = Object.entries(D.docs).filter(([k, v]) => k.startsWith(q.c + '/') && q.w.every((w) => v[w.f] === w.v));
        return { forEach: (fn) => rows.forEach(([k, v]) => fn({ id: k.slice(q.c.length + 1), data: () => v })) }; }
      export function writeBatch() { const ops = []; return {
        set: (r, d, o) => ops.push(() => { D.docs[key(r)] = o && o.merge ? { ...(D.docs[key(r)] || {}), ...d } : { ...d }; }),
        delete: (r) => ops.push(() => { delete D.docs[key(r)]; }),
        commit: async () => { D.writes++; ops.forEach((f) => f()); } }; }`);
    const realSrc = readFileSync(join(SRC, 'public/cloud.js'), 'utf8');
    note(realSrc.includes("const V = '/dexnote/vendor/firebase/';") && realSrc.includes("import('/account/site-auth.js')"), 'cloud.js no longer loads the SDK and the site account the way this section swaps them');
    writeFileSync(join(dir, 'cloud.js'), realSrc.replace("const V = '/dexnote/vendor/firebase/';", `const V = '${pathToFileURL(dir).href}/';`).replace("import('/account/site-auth.js')", `import('${url('site.js')}')`));

    // The name server: Inko's handles, links, renames and follows, in memory.
    const N = { users: {}, links: {}, tokens: {}, social: {}, calls: [] };
    const mint = (h) => { const t = 't' + Math.random().toString(36).slice(2); N.tokens[t] = h; return t; };
    const live = (t) => { const h = N.tokens[t]; return h && N.users[h] && !N.users[h].movedTo ? h : null; };
    const soc = (h) => (N.social[h] ||= { followers: [], following: [] });
    N.rename = (from, to) => { N.users[to] = { ...N.users[from] }; N.users[from] = { movedTo: to }; for (const [u, h] of Object.entries(N.links)) if (h === from) N.links[u] = to; N.social[to] = soc(from); delete N.social[from];
      for (const x of Object.values(N.social)) for (const k of ['followers', 'following']) x[k] = x[k].map((h) => (h === from ? to : h)); };
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    globalThis.fetch = async (u, init) => {
      if (!init) {
        const h = decodeURIComponent(/profile=([^&]+)/.exec(u)[1]);
        const rec = N.users[h];
        if (!rec) return reply(404, { error: 'No such artist' });
        if (rec.movedTo) return reply(200, { handle: h, movedTo: rec.movedTo });
        return reply(200, { handle: h, avatar: rec.avatar || 0, posts: [], ...{ followers: soc(h).followers.length, following: soc(h).following.length } });
      }
      const b = JSON.parse(init.body); N.calls.push(b.action);
      const taken = (h) => !!N.users[h] || h.startsWith('dex');
      if (b.action === 'site') { const uid = b.idToken.slice(4), h = N.links[uid]; return h ? reply(200, { handle: h, token: mint(h) }) : reply(200, { ticket: 'ticket:' + uid, suggest: 'Suggested' }); }
      if (b.action === 'claim') { const uid = b.ticket.slice(7); if (N.links[uid]) return reply(200, { handle: N.links[uid], token: mint(N.links[uid]) });
        if (taken(b.handle)) return reply(409, { error: 'That name is taken' }); N.users[b.handle] = { uid }; N.links[uid] = b.handle; return reply(200, { handle: b.handle, token: mint(b.handle), fresh: true }); }
      const me = live(b.token);
      if (!me) return reply(401, { error: 'Sign in again' });
      if (b.action === 'rename') { if (taken(b.handle)) return reply(409, { error: 'That name is taken' }); N.rename(me, b.handle); return reply(200, { handle: b.handle, token: mint(b.handle) }); }
      if (b.action === 'follow') { const t = soc(b.handle); if (b.on) { if (!t.followers.includes(me)) t.followers.push(me); soc(me).following.push(b.handle); }
        else { t.followers = t.followers.filter((x) => x !== me); soc(me).following = soc(me).following.filter((x) => x !== b.handle); } return reply(200, { handle: b.handle, following: b.on, followers: t.followers.length }); }
      if (b.action === 'following') return reply(200, { following: soc(me).following });
      return reply(400, { error: 'no such action' });
    };
    globalThis.__fs = { docs: {}, writes: 0 };
    globalThis.__site = { user: null, subs: new Set() };
    const F = globalThis.__fs.docs;
    const as = async (uid) => { globalThis.__site.user = uid ? { uid, providerData: [{ providerId: 'google.com' }], email: uid + '@example.com' } : null; globalThis.__site.subs.forEach((f) => f(globalThis.__site.user)); };
    const C = await import(url('cloud.js'));
    let seen = null;
    await C.onUser((u) => { seen = u; });
    const refused = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
    const nameCases = [];
    const nc = (ok, why) => { nameCases.push(ok); note(ok, why); };

    // 1. A new account has no name; picking one makes it on the NAME SERVER and copies it.
    await as('a1');
    nc((await C.myHandle()) === null && (await C.suggestHandle()) === 'suggested', 'a new account is offered a name it does not have');
    nc((await C.claimHandle('@Alice')) === 'alice' && N.links.a1 === 'alice' && F['msUsers/a1']?.handle === 'alice' && F['msHandles/alice']?.uid === 'a1',
      `a first name did not land on the name server and in its copy: ${JSON.stringify({ link: N.links.a1, copy: F['msUsers/a1'] })}`);
    // 2. A rename made IN INKO reaches MindSplit on the next launch, and lets the old name go.
    N.rename('alice', 'alicia');
    nc((await C.myHandle()) === 'alicia' && F['msUsers/a1'].handle === 'alicia' && F['msHandles/alicia']?.uid === 'a1' && !F['msHandles/alice'],
      'a rename made in Inko did not reach the copy');
    // 3. A rename made HERE renames the one account, with the token the launch was given.
    nc((await C.claimHandle('ally')) === 'ally' && N.users.alicia.movedTo === 'ally' && N.links.a1 === 'ally' && F['msUsers/a1'].handle === 'ally' && !F['msHandles/alicia'],
      'a rename here did not rename the Inko account');
    // 4. A taken or reserved name is refused by the name server, and nothing is copied.
    N.users.zed = { uid: 'z9' };
    const w0 = globalThis.__fs.writes;
    nc(/taken/.test(await refused(C.claimHandle('zed')) || '') && /taken/.test(await refused(C.claimHandle('dexter')) || '') && F['msUsers/a1'].handle === 'ally' && globalThis.__fs.writes === w0,
      'a taken or reserved name was not refused, or reached the copy');
    // 5. Follows are the name server's, and a token a rename elsewhere killed is renewed once.
    N.users.bea = { uid: 'b2' };
    nc((await C.follow('bea', true)).followers === 1 && (await C.following()).join() === 'bea', 'following did not reach the name server');
    N.rename('ally', 'allie');
    nc((await C.follow('bea', false)).followers === 0 && soc('bea').followers.length === 0 && (await C.following()).length === 0, 'an unfollow after a rename elsewhere was lost');
    // 6. Faces: a rename is followed; a name the server never heard of is initials.
    N.users.bea.avatar = 3;
    const bea = await C.person('bea'), old = await C.person('ally'), none = await C.person('nobody_here');
    nc(bea.avatar === '/api/sketch?img=' + encodeURIComponent('sketch/avatars/bea-3.jpg') && old.handle === 'allie' && none.avatar === '' && none.followers === 0,
      `faces read ${JSON.stringify([bea, old, none])}`);
    // 7. Signing out and in as someone else carries nothing over. A MindSplit
    //    name from before the names were one becomes the universal name if free...
    F['msUsers/c3'] = { handle: 'carol' }; F['msHandles/carol'] = { uid: 'c3' };
    await as(null); await as('c3');
    nc(seen && seen.uid === 'c3' && (await C.myHandle()) === 'carol' && N.links.c3 === 'carol', 'an old MindSplit name was not carried to the name server');
    // ...and is NOT when the name server already gave it to someone else.
    F['msUsers/d4'] = { handle: 'zed' }; F['msHandles/zed'] = { uid: 'd4' };
    await as('d4');
    nc((await C.myHandle()) === null && !N.links.d4 && N.users.zed.uid === 'z9', 'an old MindSplit name taken on the name server was handed over');
    // 8. Someone's questions: by uid, so a pre-rename `by` is still theirs; never an anonymous one.
    F['msPolls/uaaaaaaaaaaaaa1'] = { q: 'Old name?', o: ['a', 'b'], cat: 'tech', uid: 'a1', by: 'alice', at: 2, rep: 0 };
    F['msPolls/uaaaaaaaaaaaaa2'] = { q: 'Anon?', o: ['a', 'b'], cat: 'tech', uid: 'a1', by: null, at: 3, rep: 0 };
    F['msPolls/uaaaaaaaaaaaaa3'] = { q: 'New name?', o: ['a', 'b'], cat: 'tech', uid: 'a1', by: 'ally', at: 4, rep: 0 };
    F['msHandles/allie'] = { uid: 'a1' };
    const theirs = await C.pollsBy('allie');
    nc(theirs.map((p) => p.q).join('|') === 'New name?|Old name?', `pollsBy read ${theirs.map((p) => p.q).join('|')}`);
    note(nameCases.length === 11, `the name section ran ${nameCases.length} cases, not 11`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* ---------- the build is the source ---------- */
if (!existsSync(join(SRC, 'node_modules'))) {
  fail.push('ai/apps/mindsplit/node_modules is missing, so the build could not be compared: npm ci there first');
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'mindsplit-'));
  try {
    execFileSync(process.execPath, [join(SRC, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', tmp, '--emptyOutDir', '--logLevel', 'error'], { cwd: SRC });
    const built = readdirSync(join(tmp, 'assets')).sort(), shipped = readdirSync(join(ROOT, 'mindsplit/assets')).sort();
    note(built.length >= 3 && built.join() === shipped.join(), `mindsplit/ is not the current build: ${shipped.join(' ')} vs ${built.join(' ')}`);
    note(readFileSync(join(tmp, 'index.html'), 'utf8') === readFileSync(join(ROOT, 'mindsplit/index.html'), 'utf8'), 'mindsplit/index.html is not the current build');
    for (const f of ['cloud.js', 'sw.js', 'manifest.webmanifest'])
      note(readFileSync(join(tmp, f), 'utf8') === readFileSync(join(ROOT, 'mindsplit', f), 'utf8'), `mindsplit/${f} is not the current build`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/* ---------- the AI Lab card ---------- */
const home = readFileSync(join(ROOT, 'index.html'), 'utf8');
const card = (/<article[^>]*id="mindsplitCard"[\s\S]*?<\/article>/.exec(home) || [''])[0];
note(/class="ai-card-dl" href="\/mindsplit\/\?install=1"/.test(card), 'the MindSplit card has no download button to /mindsplit/?install=1');
note(card.indexOf('ai-card-dl') > 0 && card.indexOf('ai-card-dl') < card.indexOf('ai-card-eye'), 'the download button is not left of the eye');

/* ---------- the server ---------- */
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const msHeaders = (vercel.headers.find((h) => h.source === '/mindsplit/(.*)') || {}).headers || [];
const CSP = ((msHeaders.find((h) => h.key === 'Content-Security-Policy') || {}).value || '').replace(/;\s*upgrade-insecure-requests/, '');
note(/firestore\.googleapis\.com/.test(CSP) && /manifest-src 'self'/.test(CSP) && /worker-src 'self'/.test(CSP), 'the /mindsplit/ policy does not allow Firestore, the manifest and the worker');
note(msHeaders.some((h) => h.key === 'Cross-Origin-Opener-Policy' && h.value === 'same-origin-allow-popups'), 'the /mindsplit/ headers do not let a sign-in popup talk back');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/mindsplit/cloud.js') { res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' }).end(FAKE); return; }
  if (url.endsWith('/')) url += 'index.html';
  const file = resolve(join(ROOT, normalize(url)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (url.startsWith('/mindsplit/')) headers['content-security-policy'] = CSP;
    res.writeHead(200, headers).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 860, isMobile: true, hasTouch: false, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mindsplit-look', JSON.stringify({ theme: 'split', accent: 0, scene: 'off' })); } catch {} });

  const open = async (q = '?embed=1') => { await page.goto(`${BASE}/mindsplit/${q}`, { waitUntil: 'networkidle0' }); await sleep(500); };
  const question = () => page.evaluate(() => {
    const vis = [...document.querySelectorAll('section h2')].find((h) => { const r = h.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    return vis ? vis.textContent : null;
  });
  const visibleBands = () => page.evaluate(() => [...document.querySelectorAll('.ms-band')].filter((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })
    .map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent, disabled: b.disabled }; }));
  const pressButton = async (label) => {
    const at = await page.evaluate((label) => {
      const b = [...document.querySelectorAll('button, a')].find((x) => (x.getAttribute('aria-label') === label || x.textContent.trim() === label) && x.getBoundingClientRect().width > 0
        && x.getBoundingClientRect().top >= 0 && x.getBoundingClientRect().bottom <= innerHeight);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, ok: !!hit && (hit === b || b.contains(hit)) };
    }, label);
    if (!at || !at.ok) { fail.push(`no pressable "${label}" on screen`); return false; }
    await page.mouse.click(at.x, at.y);
    await sleep(450);
    return true;
  };
  const fakeState = () => page.evaluate(() => JSON.parse(localStorage.getItem('__msfake') || '{}'));

  await open();
  await page.evaluate(() => { localStorage.clear(); });
  await open();

  /* The first card: a question from the deck, nobody has answered it. */
  const q1 = await question();
  note(!!q1 && POLLS.some((p) => p.q === q1), `the first card is not a deck question: ${q1}`);
  note(await page.evaluate(() => document.body.textContent.includes('No votes yet')), 'a fresh question does not say No votes yet');

  /* THE THUMB RULE: every control on screen is below the frame's midpoint. */
  const controls = await page.evaluate(() => {
    const mid = innerHeight / 2;
    const all = [...document.querySelectorAll('button, input, textarea, a')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
    });
    return { n: all.length, above: all.filter((el) => el.getBoundingClientRect().top < mid - 1).map((el) => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)) };
  });
  note(controls.n >= 7, `only ${controls.n} controls found on the feed (an answer per option, share, report and the three dock buttons)`);
  note(controls.above.length === 0, `controls above the midpoint: ${controls.above.join(' | ')}`);

  /* A REAL click on the second answer. */
  const pick = POLLS.find((p) => p.q === q1);
  let bands = await visibleBands();
  note(bands.length === pick.o.length && bands.every((b) => !b.disabled), `${bands.length} answers on screen for a ${pick.o.length}-answer question`);
  await page.mouse.click(bands[1].x, bands[1].y);
  await sleep(1100);
  bands = await visibleBands();
  const pcts = bands.map((b) => Number((/(\d+)%/.exec(b.text) || [])[1]));
  const sum = pcts.reduce((a, b) => a + b, 0);
  note(bands.every((b) => b.disabled) && pcts.every((n) => Number.isFinite(n)) && sum >= 99 && sum <= 101, `after a vote the split reads ${pcts.join('/')} (sum ${sum})`);
  note(await page.evaluate(() => /first to answer/.test(document.body.textContent)), 'the first vote on a question does not say so');
  let st = await fakeState();
  note(st.counts?.[pick.id]?.n === 1 && st.counts[pick.id].c1 === 1, `the server's count for ${pick.id} is ${JSON.stringify(st.counts?.[pick.id])}, not one vote for B`);

  /* It survives a reload. Answered questions sink to the end of "For you",
     so the shared-link form (?q=) brings it back to the front. */
  await open(`?embed=1&q=${pick.id}`);
  note((await question()) === q1 && (await visibleBands()).every((b) => b.disabled), 'the vote did not survive a reload');

  /* The one change. */
  note(await pressButton('Change'), 'no Change button after voting');
  await sleep(500);
  st = await fakeState();
  note(st.counts?.[pick.id]?.n === 0 && (await visibleBands()).every((b) => !b.disabled), 'Change did not take the vote back on the server and on screen');
  bands = await visibleBands();
  await page.mouse.click(bands[0].x, bands[0].y);
  await sleep(900);
  note(!(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Change' && b.getBoundingClientRect().width > 0))),
    'a second change is offered on the same question');

  /* A real swipe up moves exactly one card. */
  const before = await question();
  await page.mouse.move(200, 700); await page.mouse.down(); await page.mouse.move(200, 520, { steps: 6 }); await page.mouse.up();
  await sleep(700);
  const after = await question();
  note(after && after !== before && POLLS.some((p) => p.q === after), `a swipe up did not move to another question (${before} -> ${after})`);

  /* A category: Food only. */
  note(await pressButton('Categories and look'), 'no categories button');
  note(await pressButton('Food'), 'no Food in the categories');
  note(await pressButton('Done'), 'no Done in the categories');
  await sleep(500);
  const foodQs = new Set(POLLS.filter((p) => p.cat === 'food').map((p) => p.q));
  let allFood = true;
  for (let i = 0; i < 3; i++) {
    const q = await question();
    if (!foodQs.has(q)) allFood = false;
    await page.keyboard.press('ArrowDown'); await sleep(550);
  }
  note(allFood && await page.evaluate(() => document.querySelector('header').textContent.includes('Food')), 'a Food filter showed something else, or the header does not say Food');
  note(await pressButton('Categories and look') && await pressButton('All') && await pressButton('Done'), 'could not go back to every category');

  /* Ask, signed out: the sign-in sheet, then a name, then the question. */
  note(await pressButton('Ask a question'), 'no + button');
  const signin = await page.evaluate(() => ['Google', 'Discord', 'GitHub', 'Email and password'].every((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === t)));
  note(signin, 'Ask signed out does not offer Google, Discord, GitHub and an email');
  note(await pressButton('Google'), 'no Google button');
  await sleep(600);
  const offered = await page.evaluate(() => (document.querySelector('input[aria-label="Your name"]') || {}).value);
  note(offered === 'inkoname', `the name sheet offered "${offered}", not the Inko name`);
  await page.focus('input[aria-label="Your name"]');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('pat_check');
  note(await pressButton('Save'), 'no Save on the name sheet');
  await sleep(600);
  note(await page.evaluate(() => !!document.querySelector('textarea[aria-label="Your question"]')), 'saving a name after Ask did not open Ask');
  await page.click('textarea[aria-label="Your question"]');
  await page.keyboard.type('Is the check run the best part of the day');
  await page.click('input[aria-label="Answer 1"]'); await page.keyboard.type('Obviously');
  await page.click('input[aria-label="Answer 2"]'); await page.keyboard.type('Not even close');
  note(await pressButton('Post it'), 'no Post it');
  await sleep(900);
  note((await question()) === 'Is the check run the best part of the day?', `the new question is not first in the feed: ${await question()}`);
  note(await page.evaluate(() => document.body.textContent.includes('Asked by @pat_check')), 'the new question is not credited to @pat_check');
  st = await fakeState();
  note(st.polls?.length === 1 && st.polls[0].by === 'pat_check' && st.polls[0].o.length === 2, `the server holds ${JSON.stringify(st.polls)}`);

  /* Your own question can be removed from the report sheet. */
  note(await pressButton('Report'), 'no Report button');
  note(await pressButton('Remove this question'), 'your own question offers no Remove');
  await sleep(600);
  st = await fakeState();
  note(st.polls?.length === 0 && (await question()) !== 'Is the check run the best part of the day?', 'Remove left the question up');

  /* SOMEONE ELSE'S PROFILE. A question @artist_b asked: her face (initials,
     no Inko picture) in the card's bottom row opens her page -- followers,
     following, the questions she asked under her name, never an anonymous
     one -- and Follow there reaches the server (Inko's follows, faked). */
  await page.evaluate(() => { const s = window.__msFake.S();
    s.polls.unshift({ id: 'uartistbquestion1', q: 'Is a profile check worth writing?', o: ['Yes', 'No'], cat: 'tech', by: 'artist_b', uid: 'acct-b', at: Date.now(), rep: 0 },
                    { id: 'uartistbsecretq01', q: 'Did anyone see this one?', o: ['Yes', 'No'], cat: 'tech', by: null, uid: 'acct-b', at: Date.now(), rep: 0 });
    s.users['acct-b'] = 'artist_b'; s.handles.artist_b = 'acct-b'; s.followers = { artist_b: ['someone'] }; window.__msFake.W(s); });
  await open('?embed=1&q=uartistbquestion1');
  note((await question()) === 'Is a profile check worth writing?', `the seeded question is not first: ${await question()}`);
  const faceBtn = await page.evaluate(() => { const b = document.querySelector('button[aria-label="@artist_b\'s profile"]'); if (!b) return null;
    const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), below: r.top >= innerHeight / 2 }; });
  note(faceBtn && faceBtn.text === 'AB' && faceBtn.below, `the asker's face is ${JSON.stringify(faceBtn)}, not AB below the midpoint`);
  note(await pressButton("@artist_b's profile"), "no pressable face for @artist_b");
  await sleep(500);
  const prof = () => page.evaluate(() => { const d = [...document.querySelectorAll('[aria-hidden="false"]')].find((x) => x.textContent.includes('@artist_b'));
    return d ? d.textContent : ''; });
  let pt = await prof();
  note(/Asked · 1/.test(pt) && pt.includes('Is a profile check worth writing?') && !pt.includes('Did anyone see this one?') && /1Follower/.test(pt),
    `her page reads: ${pt.slice(0, 200)}`);
  note(await pressButton('Follow'), 'no Follow on her page');
  await sleep(500);
  st = await fakeState();
  pt = await prof();
  note(st.followers?.artist_b?.includes('pat_check') && /2Followers/.test(pt) && await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.trim() === 'Following')),
    `Follow did not reach the server and the page: ${JSON.stringify(st.followers)} / ${pt.slice(0, 120)}`);
  note(await pressButton('Following'), 'no Following to unfollow with');
  await sleep(500);
  st = await fakeState();
  note(!st.followers?.artist_b?.includes('pat_check') && /1Follower/.test(await prof()), 'unfollowing did not take the follow back');
  note(await pressButton('Follow'), 'no Follow after unfollowing');
  await sleep(400);
  const row = await page.evaluate(() => { const b = [...document.querySelectorAll('[aria-hidden="false"] button')].find((x) => x.textContent.includes('Is a profile check worth writing?'));
    if (!b) return null; const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, ok: !!hit && b.contains(hit) }; });
  note(row && row.ok, 'her question is not a pressable row on her page');
  if (row) { await page.mouse.click(row.x, row.y); await sleep(600); }
  note((await question()) === 'Is a profile check worth writing?', 'her question did not open in the feed');

  /* The profile, then signing out. */
  note(await pressButton('Your profile, @pat_check'), 'the dock does not show who is signed in');
  await sleep(500);
  note(await page.evaluate(() => document.body.textContent.includes('@pat_check') && /Answered · 1/.test(document.body.textContent)), 'the profile does not show @pat_check with one answer');
  note(await page.evaluate(() => document.body.textContent.includes('0 followers · 1 following')), 'your profile does not count the one person you follow');
  note(await pressButton('Account'), 'no Account button on the profile');
  note(await pressButton('Sign out'), 'no Sign out');
  await sleep(500);
  st = await fakeState();
  note(st.user === null && await page.evaluate(() => !!document.querySelector('[aria-label="Your profile"], [aria-label="Back to the questions"]')), 'signing out did not sign out');

  /* ?install=1 opens the install sheet and leaves a clean address. */
  await open('?install=1');
  note(await page.evaluate(() => document.body.textContent.includes('Install MindSplit') && !location.search.includes('install')), '?install=1 did not open the install sheet, or stayed in the address');

  /* The installable app: manifest icons at their sizes, a worker at /mindsplit/. */
  const manifest = JSON.parse(readFileSync(join(ROOT, 'mindsplit/manifest.webmanifest'), 'utf8'));
  const sizes = manifest.icons.map((i) => {
    const b = readFileSync(join(ROOT, 'mindsplit', i.src));
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` === i.sizes;
  });
  note(manifest.scope === '/mindsplit/' && sizes.length === 3 && sizes.every(Boolean) && manifest.icons.some((i) => i.purpose === 'maskable'), 'the manifest icons are missing or the wrong size');
  const scope = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.scope; });
  note(scope === `${BASE}/mindsplit/`, `the service worker's scope is ${scope}`);

  note(errors.length === 0, `console errors: ${errors.slice(0, 5).join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`mindsplit_check: ${POLLS.length} questions in ${CAT_ORDER.length} categories, ${real.size} cloud exports, ${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log('  FAIL ' + f);
process.exit(fail.length ? 1 : 0);
