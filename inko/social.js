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
})();
