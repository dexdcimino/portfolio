/* The social layer of the sketch gallery: who follows whom.
 *
 * Kept apart from lib/sketch-store.js so the gallery's core (accounts, posts,
 * canvases) reads the same as before; it writes into the same store through
 * the store's own io, under its own prefix:
 *
 *   sketch/social/<handle>.json   { following: [handle...], followers: [handle...] }
 *
 * BOTH SIDES ARE WRITTEN. A follow adds the name to my `following` and mine to
 * their `followers`, so a profile's follower count is one read and "who do I
 * follow" (the Following filter) is one read. Like the rest of the store it is
 * read-modify-write with no lock: fine at this scale, and a pair can only
 * drift by a name, which the next follow or unfollow of that pair repairs.
 *
 * A rename moves the file and rewrites the name in every list that holds it;
 * deleting an account takes it out of every list.
 */
'use strict';

const store = require('./sketch-store.js');
const { readJson, writeJson, backend } = store.io;
const { Refused, HANDLE } = store;

const MAX_FOLLOWING = 2000;
const key = (h) => `sketch/social/${h}.json`;
const clean = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

async function readSocial(handle) {
  const s = (await readJson(key(handle))) || {};
  return { ...s, following: Array.isArray(s.following) ? s.following : [], followers: Array.isArray(s.followers) ? s.followers : [] };
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

/* After store.rename has moved the account: the social file follows it, and
   every list naming the old handle names the new one. */
async function renameHandle(from, to) {
  const s = await readSocial(from);
  const swap = (list) => [...new Set(list.map((h) => (h === from ? to : h)))];
  for (const other of new Set([...s.following, ...s.followers])) {
    if (other === from || other === to) continue;
    const o = await readSocial(other);
    await writeSocial(other, { ...o, following: swap(o.following), followers: swap(o.followers) });
  }
  if (s.following.length || s.followers.length) await writeSocial(to, s);
  await backend().remove([key(from)]).catch(() => {});
}

/* After store.deleteAccount: nobody follows it, it follows nobody. */
async function dropHandle(handle) {
  const s = await readSocial(handle);
  for (const other of new Set([...s.following, ...s.followers])) {
    const o = await readSocial(other);
    await writeSocial(other, { ...o, following: o.following.filter((h) => h !== handle), followers: o.followers.filter((h) => h !== handle) });
  }
  await backend().remove([key(handle)]).catch(() => {});
}

module.exports = { follow, following, counts, renameHandle, dropHandle };
