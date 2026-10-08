/* The social layer of the sketch gallery: who follows whom, and comments.
 *
 * Kept apart from lib/sketch-store.js so the gallery's core (accounts, posts,
 * canvases) reads the same as before; it writes into the same store through
 * the store's own io, under its own prefix:
 *
 *   sketch/social/<handle>.json   { following: [handle...], followers: [handle...], comments: [[postId, cid]...] }
 *   sketch/comments/<postId>.json [{ c, h, t, at, reporters[], hidden }...] oldest first
 *   sketch/inbox/<handle>.json    [{ room, from, title, at }...] invitations to draw together
 *
 * BOTH SIDES ARE WRITTEN. A follow adds the name to my `following` and mine to
 * their `followers`, so a profile's follower count is one read and "who do I
 * follow" (the Following filter) is one read. Like the rest of the store it is
 * read-modify-write with no lock: fine at this scale, and a pair can only
 * drift by a name, which the next follow or unfollow of that pair repairs.
 *
 * A rename moves the file and rewrites the name in every list that holds it;
 * deleting an account takes it out of every list.
 *
 * COMMENTS hang off a public drawing. Anyone signed in can comment; the
 * comment's author and the drawing's artist can delete it; three different
 * people reporting one hide it (the same rule as drawings). Each account
 * keeps the list of its own comments (`comments` above), so a rename can
 * re-sign them and deleting the account can take them all down. Unpublishing
 * a drawing deletes its comments with it (store.removePost).
 *
 * SHARED CANVASES draw live through Firestore (inko/room-firestore.js); the
 * only part kept here is the INVITATION: a room id dropped in someone's
 * inbox, which their app reads on launch and on return to the foreground.
 * The room id is the key to the room, so an inbox is only ever read by its
 * owner's token. Invitations last a week.
 */
'use strict';

const crypto = require('node:crypto');

const store = require('./sketch-store.js');
const { readJson, writeJson, backend } = store.io;
const { Refused, HANDLE } = store;

const MAX_FOLLOWING = 2000;
const MAX_COMMENT = 280, MAX_COMMENTS = 500, MAX_MINE = 5000, HIDE_AT = store.HIDE_AT_REPORTS;
const CID = /^[a-z0-9]{6,24}$/;
const ROOM = /^[A-Za-z0-9]{20,32}$/, MAX_INBOX = 30, INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const key = (h) => `sketch/social/${h}.json`;
const clean = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

async function readSocial(handle) {
  const s = (await readJson(key(handle))) || {};
  return { ...s, following: Array.isArray(s.following) ? s.following : [], followers: Array.isArray(s.followers) ? s.followers : [],
           comments: Array.isArray(s.comments) ? s.comments : [] };
}
const writeSocial = (handle, s) => writeJson(key(handle), s);

async function liveUser(handle) {
  if (!HANDLE.test(handle)) return false;
  const user = await readJson(`sketch/users/${handle}.json`);
  return !!user && !user.movedTo;
}

/* on: true follows, false unfollows. Answers with the new state and the
   artist's follower count, so the button and the count change together. */
async function follow(handle, targetIn, on) {
  const target = clean(targetIn);
  if (target === handle) throw new Refused(400, 'That is you');
  if (!(await liveUser(target))) throw new Refused(404, 'No such artist');
  const mine = await readSocial(handle);
  const theirs = await readSocial(target);
  const want = on !== false;
  if (want) {
    if (!mine.following.includes(target)) {
      if (mine.following.length >= MAX_FOLLOWING) throw new Refused(400, 'You follow too many artists');
      mine.following.push(target);
    }
    if (!theirs.followers.includes(handle)) theirs.followers.push(handle);
  } else {
    mine.following = mine.following.filter((h) => h !== target);
    theirs.followers = theirs.followers.filter((h) => h !== handle);
  }
  await writeSocial(handle, mine);
  await writeSocial(target, theirs);
  return { handle: target, following: want, followers: theirs.followers.length };
}

async function following(handle) {
  return { following: (await readSocial(handle)).following };
}

/* What a public profile shows beside the drawings. */
async function counts(handle) {
  const s = await readSocial(handle);
  return { followers: s.followers.length, following: s.following.length };
}

/* ---- comments ---- */
const ckey = (id) => `sketch/comments/${id}.json`;
const shown = (c) => ({ c: c.c, h: c.h, t: c.t, at: c.at });
async function readComments(id) { const l = await readJson(ckey(id)); return Array.isArray(l) ? l : []; }
async function livePost(id) {
  if (!store.POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad drawing id');
  const post = await readJson(`sketch/posts/${id}.json`);
  if (!post || post.hidden) throw new Refused(404, 'That drawing is gone');
  return post;
}
function cleanText(t) {
  return String(t || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT);
}

async function comments(id) {
  if (!store.POST_ID.test(String(id || ''))) throw new Refused(400, 'Bad drawing id');
  const list = (await readComments(id)).filter((c) => !c.hidden).map(shown);
  return { comments: list, count: list.length };
}

async function addComment(handle, id, textIn) {
  await livePost(id);
  const t = cleanText(textIn);
  if (!t) throw new Refused(400, 'Say something first');
  const list = await readComments(id);
  if (list.length >= MAX_COMMENTS) throw new Refused(400, 'This drawing has all the comments it can take');
  const c = { c: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), h: handle, t, at: Date.now(), reporters: [], hidden: false };
  list.push(c);
  await writeJson(ckey(id), list);
  const mine = await readSocial(handle);
  mine.comments = [...mine.comments, [id, c.c]].slice(-MAX_MINE);
  await writeSocial(handle, mine);
  return { comment: shown(c), count: list.filter((x) => !x.hidden).length };
}

async function deleteComment(handle, id, cid) {
  if (!store.POST_ID.test(String(id || '')) || !CID.test(String(cid || ''))) throw new Refused(400, 'Bad comment');
  const list = await readComments(id);
  const c = list.find((x) => x.c === cid);
  if (!c) return { deleted: false, count: list.filter((x) => !x.hidden).length };
  if (c.h !== handle) {
    const post = await readJson(`sketch/posts/${id}.json`);
    if (!post || post.handle !== handle) throw new Refused(403, 'That comment is someone else\'s');
  }
  const next = list.filter((x) => x.c !== cid);
  await writeJson(ckey(id), next);
  const author = await readSocial(c.h);
  if (author.comments.length) await writeSocial(c.h, { ...author, comments: author.comments.filter(([p, k]) => !(p === id && k === cid)) });
  return { deleted: true, count: next.filter((x) => !x.hidden).length };
}

async function reportComment(handle, id, cid) {
  if (!store.POST_ID.test(String(id || '')) || !CID.test(String(cid || ''))) throw new Refused(400, 'Bad comment');
  const list = await readComments(id);
  const c = list.find((x) => x.c === cid);
  if (!c) return { hidden: true };
  if (c.h === handle) throw new Refused(400, 'That one is yours');
  c.reporters = Array.isArray(c.reporters) ? c.reporters : [];
  if (!c.reporters.includes(handle)) c.reporters.push(handle);
  if (c.reporters.length >= HIDE_AT) c.hidden = true;
  await writeJson(ckey(id), list);
  return { hidden: c.hidden };
}

/* ---- invitations to a shared canvas ---- */
const ikey = (h) => `sketch/inbox/${h}.json`;
async function readInbox(handle, now = Date.now()) {
  const l = await readJson(ikey(handle));
  return (Array.isArray(l) ? l : []).filter((i) => i && ROOM.test(i.room) && now - i.at < INVITE_MS);
}
async function invite(handle, toIn, room, titleIn) {
  const to = clean(toIn);
  if (!ROOM.test(String(room || ''))) throw new Refused(400, 'Bad room');
  if (to === handle) throw new Refused(400, 'That is you');
  if (!(await liveUser(to))) throw new Refused(404, 'No such artist');
  const title = String(titleIn || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Shared canvas';
  const list = (await readInbox(to)).filter((i) => i.room !== room);
  list.unshift({ room, from: handle, title, at: Date.now() });
  await writeJson(ikey(to), list.slice(0, MAX_INBOX));
  return { invited: to };
}
async function inbox(handle) { return { invites: await readInbox(handle) }; }
async function dismiss(handle, room) {
  const list = await readInbox(handle);
  const next = list.filter((i) => i.room !== room);
  if (next.length !== list.length) await writeJson(ikey(handle), next);
  return { invites: next };
}

/* Re-sign or take down every comment an account wrote. */
async function eachOwnComment(s, fn) {
  const byPost = new Map();
  for (const [p, k] of s.comments) { if (!byPost.has(p)) byPost.set(p, new Set()); byPost.get(p).add(k); }
  for (const [p, ks] of byPost) {
    const list = await readComments(p);
    if (!list.length) continue;
    const next = fn(list, ks);
    if (next) await writeJson(ckey(p), next);
  }
}

/* After store.rename has moved the account: the social file follows it, and
   every list naming the old handle names the new one, and its comments are
   signed with the new name. */
async function renameHandle(from, to) {
  const s = await readSocial(from);
  await eachOwnComment(s, (list, ks) => list.map((c) => (ks.has(c.c) && c.h === from ? { ...c, h: to } : c)));
  const swap = (list) => [...new Set(list.map((h) => (h === from ? to : h)))];
  for (const other of new Set([...s.following, ...s.followers])) {
    if (other === from || other === to) continue;
    const o = await readSocial(other);
    await writeSocial(other, { ...o, following: swap(o.following), followers: swap(o.followers) });
  }
  if (s.following.length || s.followers.length || s.comments.length) await writeSocial(to, s);
  const box = await readInbox(from);
  if (box.length) await writeJson(ikey(to), box);
  await backend().remove([key(from), ikey(from)]).catch(() => {});
}

/* After store.deleteAccount: nobody follows it, it follows nobody, and what
   it said is gone. */
async function dropHandle(handle) {
  const s = await readSocial(handle);
  await eachOwnComment(s, (list, ks) => list.filter((c) => !(ks.has(c.c) && c.h === handle)));
  for (const other of new Set([...s.following, ...s.followers])) {
    const o = await readSocial(other);
    await writeSocial(other, { ...o, following: o.following.filter((h) => h !== handle), followers: o.followers.filter((h) => h !== handle) });
  }
  await backend().remove([key(handle), ikey(handle)]).catch(() => {});
}

module.exports = { follow, following, counts, renameHandle, dropHandle, comments, addComment, deleteComment, reportComment,
  invite, inbox, dismiss, ROOM };
