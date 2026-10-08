/* The shared sketch gallery's one endpoint. See lib/sketch-store.js.
 *
 *   GET  /api/sketch?feed=1                 -> { posts: [summary...] }   public, edge-cached 10 s
 *   GET  /api/sketch?img=sketch/img/<key>   -> the image                 public, immutable
 *        (or sketch/avatars/<handle>-<v>.jpg, a profile picture)
 *   GET  /api/sketch?profile=<handle>       -> { handle, avatar, posts, followers, following } public, edge-cached 10 s
 *   GET  /api/sketch?users=<query>          -> { users: [{ handle, avatar }] }   @-search
 *   GET  /api/sketch?comments=<post id>     -> { comments: [{ c, h, t, at }], count }   oldest first, not cached
 *   POST /api/sketch { action, ... }        -> JSON
 *
 * ACTIONS
 *   signup / login   { handle, password }            -> { handle, token }
 *   claim            { ticket, handle }              -> { handle, token }   (first Google/Discord sign-in)
 *   site             { idToken }                     -> { handle, token } | { ticket, suggest }   the site account
 *   publish          { token, id, title, image, thumb } -> { post }
 *   unpublish        { token, id }
 *   vote             { token, id, kind: fire|poop|null } -> { fire, poop, mine }
 *   votes            { token, ids: [...] }           -> { votes: { id: kind } }
 *   report           { token, id }                   -> { hidden }
 *   canvases         { token }                       -> { canvases: [entry | tombstone] }   the account's own gallery
 *   canvas-put       { token, id, title, bg, created, ts, visibility, png, thumb } -> { canvas, stale? }
 *   canvas-delete    { token, id, ts }               -> { deleted }
 *   canvas-img       { token, id, v, thumb }         -> the PNG (or JPEG thumbnail) bytes
 *   me               { token }                       -> { handle, avatar: { v, canvas, crop } | null }
 *   avatar-set       { token, image, canvas, crop }  -> { avatar }   a 256px JPEG cut from a canvas
 *   avatar-clear     { token }                       -> back to the default smiley
 *   rename           { token, handle }               -> { handle, token, avatar }   moves everything; old tokens stop
 *   delete-account   { token, password }
 *   follow           { token, handle, on }           -> { handle, following, followers }   (lib/sketch-social.js)
 *   following        { token }                       -> { following: [handle...] }
 *   comment          { token, id, text }             -> { comment, count }
 *   comment-delete   { token, id, c }                -> { deleted, count }   the author or the drawing's artist
 *   comment-report   { token, id, c }                -> { hidden }           three reports hide it
 *   room-invite      { token, to, room, title }      -> { invited }          a shared canvas (Firestore) for @to
 *   inbox            { token }                       -> { invites: [{ room, from, title, at }] }
 *   inbox-dismiss    { token, room }                 -> { invites }
 *   moderate         { admin, id, op: hide|restore|delete }   admin = Dex's universal JWT
 */
'use strict';

const store = require('../lib/sketch-store.js');
const site = require('../lib/site-identity.js');
const suggestName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
const social = require('../lib/sketch-social.js');

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  const missing = store.configError();
  if (missing) { console.error('sketch: ' + missing); return res.status(503).json({ error: 'the gallery is not configured' }); }

  try {
    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (q.img) {
        const found = await store.image(q.img);
        if (!found) return res.status(404).end();
        // Keys are versioned per publish, so a URL never changes meaning.
        res.setHeader('Content-Type', found.type);
        res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        return res.status(200).send(found.buf);
      }
      if (q.feed) {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
        // The pictures ride along: one more read, and every card can show its artist's face.
        const [posts, avatars] = await Promise.all([store.readFeed(), store.readAvatars()]);
        return res.status(200).json({ posts, avatars });
      }
      if (q.profile) {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
        const p = await store.profile(q.profile);
        if (!p.movedTo) Object.assign(p, await social.counts(p.handle));
        return res.status(200).json(p);
      }
      if (q.users !== undefined) {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
        return res.status(200).json({ users: await store.searchUsers(q.users) });
      }
      if (q.comments !== undefined) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(await social.comments(q.comments));
      }
      return res.status(400).json({ error: 'feed, img, profile, users or comments' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'GET or POST' }); }

    res.setHeader('Cache-Control', 'no-store');
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    body = body || {};
    const action = String(body.action || '');

    if (action === 'signup') return res.status(200).json(await store.signup(body.handle, body.password));
    if (action === 'login') return res.status(200).json(await store.login(body.handle, body.password));
    // After a first Google or Discord sign-in: the ticket says who, this picks the name.
    if (action === 'claim') return res.status(200).json(await store.claim(body.ticket, body.handle));
    // Signed in to the SITE account (/account/site-auth.js): its Firebase ID
    // token, checked here, finds or offers to make the Inko account.
    if (action === 'site') {
      let claims;
      try { claims = await site.verify(body.idToken); }
      catch (err) {
        if (err instanceof site.Invalid) return res.status(401).json({ error: 'Sign in again' });
        throw err;
      }
      const who = site.person(claims);
      const r = await store.identifySite(who);
      return res.status(200).json(r.ticket ? { ...r, suggest: suggestName(who.name || who.email.split('@')[0]) } : r);
    }
    if (action === 'moderate') {
      if (!store.isAdmin(body.admin)) return res.status(401).json({ error: 'not allowed' });
      return res.status(200).json(await store.moderate(String(body.id || ''), body.op));
    }

    // A token outlives a rename or a deletion of its account; it is only as
    // good as the account it names.
    const handle = await store.liveHandle(store.readToken(body.token));
    if (!handle) return res.status(401).json({ error: 'Sign in again' });

    if (action === 'publish') return res.status(200).json({ post: await store.publish(handle, body) });
    if (action === 'unpublish') return res.status(200).json(await store.unpublish(handle, body.id));
    if (action === 'vote') return res.status(200).json(await store.vote(handle, body.id, body.kind === undefined ? null : body.kind));
    if (action === 'votes') return res.status(200).json({ votes: await store.myVotes(handle, body.ids) });
    if (action === 'report') return res.status(200).json(await store.report(handle, body.id));
    if (action === 'canvases') return res.status(200).json({ canvases: await store.listCanvases(handle) });
    if (action === 'canvas-put') return res.status(200).json(await store.putCanvas(handle, body));
    if (action === 'canvas-delete') return res.status(200).json(await store.deleteCanvas(handle, body.id, body.ts));
    if (action === 'canvas-img') {
      const found = await store.canvasImage(handle, body.id, body.v, !!body.thumb);
      if (!found) return res.status(404).json({ error: 'No such canvas' });
      res.setHeader('Content-Type', found.type);
      return res.status(200).send(found.buf);
    }
    if (action === 'me') return res.status(200).json(await store.me(handle));
    if (action === 'avatar-set') return res.status(200).json(await store.setAvatar(handle, body));
    if (action === 'avatar-clear') return res.status(200).json(await store.clearAvatar(handle));
    if (action === 'rename') {
      const r = await store.rename(handle, body.handle);
      if (r.handle !== handle) await social.renameHandle(handle, r.handle);
      return res.status(200).json(r);
    }
    if (action === 'delete-account') {
      const r = await store.deleteAccount(handle, body.password);
      await social.dropHandle(handle);
      return res.status(200).json(r);
    }
    if (action === 'follow') return res.status(200).json(await social.follow(handle, body.handle, body.on));
    if (action === 'following') return res.status(200).json(await social.following(handle));
    if (action === 'comment') return res.status(200).json(await social.addComment(handle, body.id, body.text));
    if (action === 'comment-delete') return res.status(200).json(await social.deleteComment(handle, body.id, body.c));
    if (action === 'comment-report') return res.status(200).json(await social.reportComment(handle, body.id, body.c));
    if (action === 'room-invite') return res.status(200).json(await social.invite(handle, body.to, body.room, body.title));
    if (action === 'inbox') return res.status(200).json(await social.inbox(handle));
    if (action === 'inbox-dismiss') return res.status(200).json(await social.dismiss(handle, body.room));
    return res.status(400).json({ error: 'no such action' });
  } catch (err) {
    if (err instanceof store.Refused) return res.status(err.status).json({ error: err.message });
    console.error('sketch: failed', err);
    return res.status(502).json({ error: 'the gallery could not be reached' });
  }
};

