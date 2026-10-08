(()=>{ "use strict";
/* Inko's social features (Dex, 2026-10-08): follow artists, and a filter on
   the Public page for the artists you follow and the drawings you gave fire.

   It lives in its own file and sees the app only through window.inkoBridge
   and the inko:* events app.js fires (see the end of app.js). Everything it
   draws sits in ONE small pill above the gallery's bottom bar (#s-bar), so
   nothing is added to the top half of the screen:
     Public          All | Following | fire       (a filter on the grid)
     an artist       N followers  [Follow]
     your gallery    nothing (the profile options live there) */
const B = window.inkoBridge;
if (!B) return;
const $ = id => document.getElementById(id);

let filter = 'all';                 // all | following | fire
let following = new Set();          // who this account follows
let followingFor = null;            // ...loaded for this handle
let viewing = null;                 // the artist's profile on screen: { handle, followers }

const FIRE = '<span class="rx-ico" data-icon="fire"></span>';
const bar = document.createElement('div');
bar.id = 's-bar';
bar.hidden = true;
bar.innerHTML =
  '<div id="s-filter" role="radiogroup" aria-label="Show">' +
    '<button class="g-chip on" data-f="all" role="radio" aria-checked="true">All</button>' +
    '<button class="g-chip" data-f="following" role="radio" aria-checked="false">Following</button>' +
    '<button class="g-chip s-fire" data-f="fire" role="radio" aria-checked="false" aria-label="Drawings you gave fire">' + FIRE + '</button>' +
  '</div>' +
  '<div id="s-artist"><span id="s-followers"></span><button id="s-follow" class="s-follow">Follow</button></div>';
$('gallery').insertBefore(bar, $('g-bar'));

/* ---- who you follow ---- */
async function loadFollowing(){
  const s = B.session;
  if (!s){ following = new Set(); followingFor = null; return; }
  if (followingFor === s.handle) return;
  try { following = new Set((await B.api('following')).following || []); followingFor = s.handle; }
  catch (e) {}
}

/* ---- the Public filter ---- */
const FILTERS = {
  following: { keep: p => following.has(p.handle),
               empty: 'Nothing here yet. Follow an artist from their profile and their drawings show up here.' },
  fire: { keep: p => B.myVotes[p.id] === 'fire',
          empty: 'Give a drawing fire and it shows up here.' },
};
function paintFilter(){
  for (const b of bar.querySelectorAll('[data-f]')){
    const on = b.dataset.f === filter;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  }
}
async function setFilter(f){
  if (f !== 'all' && !B.session){ B.openAccount(); return; }
  filter = f; paintFilter();
  if (f === 'following') await loadFollowing();
  B.feedFilter = FILTERS[f] || null;
  if (B.tab === 'public') B.renderFeed();
}
bar.querySelector('#s-filter').addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (b) setFilter(b.dataset.f);
});

/* ---- following an artist ---- */
function paintArtist(){
  if (!viewing) return;
  const n = viewing.followers || 0;
  $('s-followers').textContent = n + (n === 1 ? ' follower' : ' followers');
  const on = following.has(viewing.handle);
  const btn = $('s-follow');
  btn.textContent = on ? 'Following' : 'Follow';
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on);
}
$('s-follow').addEventListener('click', async () => {
  if (!viewing) return;
  if (!B.session){ B.openAccount(); return; }
  const h = viewing.handle, was = following.has(h);
  // Change it at once; put it back if the server says no.
  if (was) following.delete(h); else following.add(h);
  viewing.followers = Math.max(0, (viewing.followers || 0) + (was ? -1 : 1));
  paintArtist();
  try {
    const r = await B.api('follow', { handle: h, on: !was });
    if (viewing && viewing.handle === h){ viewing.followers = r.followers; paintArtist(); }
  } catch (e) {
    if (was) following.add(h); else following.delete(h);
    if (viewing && viewing.handle === h){ viewing.followers = Math.max(0, (viewing.followers || 0) + (was ? 1 : -1)); paintArtist(); }
    B.toast(e.message);
  }
});

/* ---- which pill shows ---- */
function show(){
  const tab = B.tab;
  bar.hidden = !(tab === 'public' || (tab === 'user' && viewing));
  bar.dataset.mode = tab;
  B.feedFilter = tab === 'public' ? FILTERS[filter] || null : null;
}
document.addEventListener('inko:tab', e => {
  if (e.detail.tab !== 'user') viewing = null;
  show();
});
document.addEventListener('inko:user', async e => {
  const r = e.detail.profile || {};
  viewing = { handle: e.detail.handle, followers: r.followers || 0 };
  show(); paintArtist();
  await loadFollowing();
  paintArtist();
});
// A sign-in or out changes who "you" follow.
document.addEventListener('inko:feed', () => { if (B.session && followingFor !== B.session.handle) loadFollowing().then(() => { if (filter === 'following') B.renderFeed(); }); });
show();

/* ---------- comments (Dex, 2026-10-08) ----------
   A speech-bubble square in the viewer's bar, with the count on it, opens
   a sheet over the bottom of the viewer: the comments oldest first, newest
   at the foot by the box you type in. Nothing to press up top -- the sheet
   is the bottom of the screen, and a tap on the drawing above it, or the
   down arrow beside the box, puts it away. Hold a comment to delete it (yours,
   or any on your own drawing) or report it (anyone else's). */
const API = '/api/sketch';
const BUBBLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5Z"/></svg>';
const cbtn = document.createElement('button');
cbtn.id = 's-cbtn'; cbtn.className = 'g-sq v-btn'; cbtn.setAttribute('aria-label', 'Comments');
cbtn.innerHTML = BUBBLE + '<b id="s-ccount"></b>';
$('v-bar').insertBefore(cbtn, $('v-more'));

const sheet = document.createElement('div');
sheet.id = 's-csheet';
sheet.innerHTML =
  '<div id="s-chead"></div>' +
  '<div id="s-clist"></div>' +
  '<form id="s-cform" autocomplete="off">' +
    '<button type="button" id="s-cclose" class="s-csq" aria-label="Hide comments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
    '<input id="s-cinput" maxlength="280" placeholder="Add a comment" enterkeyhint="send" autocapitalize="sentences">' +
    '<button type="submit" id="s-csend" class="s-csq" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button>' +
  '</form>';
$('viewer').appendChild(sheet);
// The viewer swipes on pointer moves; inside the sheet a drag is a scroll.
for (const ev of ['pointerdown', 'pointermove', 'pointerup']) sheet.addEventListener(ev, e => e.stopPropagation());

let postNow = null;                 // the drawing on screen in the viewer
const counts = new Map();           // post id -> comment count, once known
let list = [], seq = 0;

const ago = at => {
  const s = Math.max(0, (Date.now() - at) / 1000);
  return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : s < 604800 ? Math.floor(s / 86400) + 'd' : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
function paintCount(){
  const n = postNow ? counts.get(postNow.id) : undefined;
  $('s-ccount').textContent = n ? (n > 99 ? '99+' : n) : '';
  $('s-chead').textContent = n ? n + (n === 1 ? ' comment' : ' comments') : 'Comments';
}
function row(c){
  const r = document.createElement('div'); r.className = 's-c'; r.dataset.c = c.c;
  const who = document.createElement('button'); who.className = 's-cwho'; who.type = 'button';
  who.appendChild(B.avatarEl(c.h, 'mid'));
  const body = document.createElement('div'); body.className = 's-cbody';
  const top = document.createElement('div'); top.className = 's-ctop';
  const tag = document.createElement('button'); tag.type = 'button'; tag.className = 's-ctag'; tag.textContent = '@' + c.h;
  const when = document.createElement('span'); when.className = 's-cwhen'; when.textContent = ago(c.at);
  top.append(tag, when);
  const text = document.createElement('div'); text.className = 's-ctext'; text.textContent = c.t;
  body.append(top, text);
  r.append(who, body);
  const go = () => { closeSheet(); $('v-close').click(); B.openUser(c.h); };
  who.onclick = go; tag.onclick = go;
  holdFor(r, () => commentMenu(c));
  return r;
}
function paintList(){
  const box = $('s-clist'); box.replaceChildren();
  if (!list.length){
    const e = document.createElement('div'); e.className = 's-cempty'; e.textContent = 'No comments yet. Say something nice.';
    box.appendChild(e); return;
  }
  for (const c of list) box.appendChild(row(c));
  box.scrollTop = box.scrollHeight;
}
async function loadComments(p){
  const mine = ++seq;
  try {
    const r = await fetch(API + '?comments=' + encodeURIComponent(p.id), { cache: 'no-store' });
    const got = await r.json();
    if (!r.ok) throw new Error(got.error || 'gone');
    if (mine !== seq) return;
    counts.set(p.id, got.count || 0);
    if (postNow && postNow.id === p.id){ list = got.comments || []; paintCount(); if (sheetOpen()) paintList(); }
  } catch (e) { if (mine === seq && sheetOpen()) { list = []; $('s-clist').innerHTML = '<div class="s-cempty">Comments could not load.</div>'; } }
}

const sheetOpen = () => sheet.classList.contains('open');
function openSheet(){
  if (!postNow) return;
  sheet.classList.add('open'); $('viewer').classList.add('s-comments');
  paintCount(); paintList(); placeSheet();
  $('s-cinput').placeholder = B.session ? 'Add a comment' : 'Sign in to comment';
  loadComments(postNow);
}
function closeSheet(){
  if (!sheetOpen()) return;
  sheet.classList.remove('open'); $('viewer').classList.remove('s-comments');
  $('s-cinput').blur();
}
cbtn.addEventListener('click', () => (sheetOpen() ? closeSheet() : openSheet()));
$('s-cclose').addEventListener('click', closeSheet);
// A tap on the drawing above the sheet puts it away.
$('v-stage').addEventListener('click', () => { if (sheetOpen()) closeSheet(); });
// The box rides the keyboard, as the search pill does.
function placeSheet(){
  const vv = window.visualViewport;
  const lift = vv ? Math.max(0, innerHeight - (vv.height + vv.offsetTop)) : 0;
  sheet.style.bottom = lift + 'px';
}
if (window.visualViewport){ visualViewport.addEventListener('resize', placeSheet); visualViewport.addEventListener('scroll', placeSheet); }

$('s-cinput').addEventListener('focus', () => { if (!B.session){ $('s-cinput').blur(); B.openAccount(); } });
$('s-cform').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('s-cinput'), t = input.value.trim(), p = postNow;
  if (!t || !p) return;
  if (!B.session){ B.openAccount(); return; }
  input.value = ''; $('s-csend').disabled = true;
  try {
    const r = await B.api('comment', { id: p.id, text: t });
    counts.set(p.id, r.count);
    if (postNow && postNow.id === p.id){ list.push(r.comment); paintCount(); paintList(); }
  } catch (err) { input.value = t; B.toast(err.message); }
  $('s-csend').disabled = false;
});

function holdFor(el, fn){
  let t = null, x = 0, y = 0;
  el.addEventListener('pointerdown', e => { x = e.clientX; y = e.clientY; clearTimeout(t); t = setTimeout(() => { t = null; fn(); }, 450); });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 10){ clearTimeout(t); t = null; } });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { clearTimeout(t); t = null; });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function commentMenu(c){
  const p = postNow; if (!p) return;
  const me = B.session && B.session.handle;
  if (!me){ B.openAccount(); return; }
  if (c.h === me || p.handle === me){
    B.openModal('Delete comment?', c.t.length > 80 ? c.t.slice(0, 80) + '…' : c.t, 'Delete', async () => {
      try {
        const r = await B.api('comment-delete', { id: p.id, c: c.c });
        counts.set(p.id, r.count);
        list = list.filter(x => x.c !== c.c);
        if (postNow && postNow.id === p.id){ paintCount(); paintList(); }
      } catch (e) { B.toast(e.message); }
    });
  } else {
    B.openModal('Report comment?', 'Three reports take it down.', 'Report', async () => {
      try {
        const r = await B.api('comment-report', { id: p.id, c: c.c });
        if (r.hidden){ list = list.filter(x => x.c !== c.c); counts.set(p.id, list.length); paintCount(); paintList(); }
        B.toast(r.hidden ? 'Reported — it has been taken down' : 'Reported — thank you');
      } catch (e) { B.toast(e.message); }
    });
  }
}

document.addEventListener('inko:post', e => {
  const p = e.detail.post;
  const moved = !postNow || postNow.id !== p.id;
  postNow = p;
  if (moved){ list = []; paintCount(); if (sheetOpen()) paintList(); }
  loadComments(p);
});
// The viewer closing takes the sheet with it.
new MutationObserver(() => { if (!$('viewer').classList.contains('open')){ closeSheet(); postNow = null; } })
  .observe($('viewer'), { attributes: true, attributeFilter: ['class'] });
})();
