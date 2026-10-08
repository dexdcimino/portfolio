/* A shared canvas: two or more people drawing on one picture live, with a
   small chat (Dex, 2026-10-08). Loaded by inko/social.js only when a room
   opens, so nobody who never draws together loads any of it.

   HOW IT IS LIVE. Vercel runs no sockets, so the live part is Firestore, in
   the site's Firebase project (dexnote-d7047): each stroke goes out as small
   chunks while the finger moves (one document every CHUNK_MS), and every
   phone in the room listens for them. That module (room-firestore.js) is the
   ONLY one that knows about Firebase; this one is the room, drawn the way the
   app is drawn, and speaks to it through five calls -- add, remove, chat,
   update, close -- which is also how the check drives it with a fake.

   WHAT IT LOOKS LIKE. The canvas screen again: the picture, a size bar
   (undo | size), and the toolbar (back, invite | brush/eraser | colour,
   chat), the colour swatch swapping the size bar for H/S/B sliders as the
   canvas's own does. Nothing to press in the top half: the title and who is
   in the room sit there. Undo takes back YOUR last stroke only. Leaving keeps
   the picture as a card in your gallery. */

const W = 900, H = 1200;            // the room's canvas, 3:4 like every card
const CHUNK_MS = 140;               // how often a stroke in progress goes out
const B = window.inkoBridge;
const $ = id => document.getElementById(id);
const rid = n => { const a = crypto.getRandomValues(new Uint8Array(n)); const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; return [...a].map(x => c[x % 62]).join(''); };
export const newRoomId = () => rid(24);
const hsb = (h, s, b) => { s /= 100; b /= 100; const k = n => (n + h / 60) % 6, f = n => b * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  const x = v => Math.round(v * 255); return `rgb(${x(f(5))}, ${x(f(3))}, ${x(f(1))})`; };

let transportP = null;
const transport = () => (transportP = transportP || import('./room-firestore.js'));

/* ---------- the screen ---------- */
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 L8 12 L15 19"/></svg>',
  invite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="8" r="3.6"/><path d="M3 20c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6"/><path d="M19 8v6M16 11h6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 14 L4 9 L9 4"/><path d="M4 9 H14 A6 6 0 0 1 14 21 H9"/></svg>',
  brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 L13.4 10.6" stroke-width="2.6"/><path d="M12.2 9.4 L14.6 11.8 L12.6 13.8 L10.2 11.4 Z" fill="currentColor"/><path class="r-tip" d="M10.2 11.4 L12.6 13.8 C12.2 17.6 9.4 20.6 3 20.6 C4.6 19.4 5 18.2 5.3 16.4 C5.6 13.9 7.4 11.6 10.2 11.4 Z" stroke="none"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.6 3.6 L20.4 10.4 L11.6 19.2 H7 L3.6 15.8 Z"/><path d="M13.6 3.6 L20.4 10.4 L14.6 16.2 L7.8 9.4 Z" fill="currentColor" opacity=".9"/><path d="M11.6 19.2 H20.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5Z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 21h14a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 19 11h-1"/></svg>',
};
const el = document.createElement('div');
el.id = 'room';
el.innerHTML = `
  <div id="r-head"><div id="r-title">Shared canvas</div><div id="r-who"></div></div>
  <div id="r-stage"><canvas id="r-pad" width="${W}" height="${H}"></canvas><div id="r-wait">Connecting…</div></div>
  <div id="r-bars">
    <div id="r-hsb" class="r-panel" hidden>
      <div class="hsb-rows">
        <div class="hsb-row"><span class="hsb-lbl">H</span><input type="range" id="r-hue" min="0" max="360" value="318"></div>
        <div class="hsb-row"><span class="hsb-lbl">S</span><input type="range" id="r-sat" min="0" max="100" value="80"></div>
        <div class="hsb-row"><span class="hsb-lbl">B</span><input type="range" id="r-bri" min="0" max="100" value="95"></div>
      </div>
    </div>
    <div id="r-size" class="r-panel r-bar">
      <button id="r-undo" class="tbtn" aria-label="Undo your last stroke">${ICON.undo}</button>
      <input type="range" id="r-width" min="1" max="60" value="10" aria-label="Brush size">
      <span id="r-dot"></span>
    </div>
    <div id="r-tools" class="r-bar">
      <div class="tb-side"><button id="r-back" class="tbtn" aria-label="Leave">${ICON.back}</button><button id="r-invite" class="tbtn" aria-label="Invite">${ICON.invite}</button></div>
      <div class="tb-mid"><button id="r-tool" class="tbtn sel" aria-label="Switch to eraser">${ICON.brush}</button></div>
      <div class="tb-side"><button id="r-color" class="tbtn" aria-label="Brush colour"><span id="r-swatch"></span></button><button id="r-chat" class="tbtn" aria-label="Chat">${ICON.chat}<b id="r-unread"></b></button></div>
    </div>
  </div>
  <div id="r-chatsheet" class="s-sheet">
    <div class="s-sheet-head">Chat</div>
    <div id="r-msgs" class="s-sheet-list"></div>
    <form id="r-chatform" class="s-sheet-form" autocomplete="off">
      <button type="button" id="r-chatclose" class="s-csq" aria-label="Hide chat">${ICON.down}</button>
      <input id="r-chatinput" class="s-sheet-input" maxlength="280" placeholder="Say something" enterkeyhint="send">
      <button type="submit" class="s-csq s-send" aria-label="Send">${ICON.send}</button>
    </form>
  </div>
  <div id="r-invsheet" class="s-sheet">
    <div class="s-sheet-head">Invite</div>
    <div id="r-people" class="s-sheet-list"></div>
    <div class="s-sheet-form"><button type="button" id="r-invclose" class="s-csq" aria-label="Hide">${ICON.down}</button>
      <button type="button" id="r-share" class="s-wide">${ICON.share}<span>Share a link</span></button></div>
  </div>`;
document.body.appendChild(el);
const pad = $('r-pad'), ctx = pad.getContext('2d');

/* ---------- state ---------- */
let room = null;                    // { id, title, host, bg, gen, members }
let conn = null;                    // the transport's connection
let chunks = [];                    // every stroke chunk in the room, in order
const byId = new Map();             // doc id -> chunk
const mineSent = new Set();         // client ids of chunks this phone drew already
const myStrokes = [];               // [{ sid, ids: Promise<id>[] }] newest last
let tool = 'brush', color = { h: 318, s: 80, b: 95 }, width = 10;
let msgs = [], unread = 0;
let openId = null;

/* ---------- drawing ---------- */
function drawChunk(c, onto = ctx){
  const p = c.pts; if (!p || p.length < 2) return;
  onto.save();
  onto.globalCompositeOperation = c.tool === 'eraser' ? 'destination-out' : 'source-over';
  onto.strokeStyle = onto.fillStyle = c.color || '#000';
  onto.lineWidth = Math.max(1, (c.size || 0.01) * W);
  onto.lineCap = onto.lineJoin = 'round';
  if (p.length === 2){ onto.beginPath(); onto.arc(p[0] * W, p[1] * H, onto.lineWidth / 2, 0, Math.PI * 2); onto.fill(); }
  else { onto.beginPath(); onto.moveTo(p[0] * W, p[1] * H); for (let i = 2; i < p.length; i += 2) onto.lineTo(p[i] * W, p[i + 1] * H); onto.stroke(); }
  onto.restore();
}
const live = c => room && (c.gen || 0) === (room.gen || 0);
function redraw(){ ctx.clearRect(0, 0, W, H); for (const c of chunks) if (live(c)) drawChunk(c); }
function paintBg(){ const bg = (room && room.bg) || { h: 210, s: 10, b: 96 }; pad.style.background = hsb(bg.h, bg.s, bg.b); }

let cur = null;                     // the stroke under the finger
const toPad = e => { const r = pad.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
const round = v => Math.round(v * 10000) / 10000;
function style(){ return { tool, color: hsb(color.h, color.s, color.b), size: width / W, by: B.session ? B.session.handle : '', gen: room ? room.gen || 0 : 0 }; }
function flush(final){
  if (!cur || !conn) return;
  const pts = cur.pending;
  if (pts.length >= 2 && (final || pts.length >= 4)){
    const c = { ...cur.style, sid: cur.sid, cid: rid(10), pts: pts.map(round) };
    mineSent.add(c.cid);
    cur.ids.push(conn.add(c).catch(e => { B.toast('Not sent — ' + (e.message || 'offline')); return null; }));
    cur.pending = pts.slice(-2);    // the next chunk starts where this ended
  }
}
pad.addEventListener('pointerdown', e => {
  if (!conn || e.button > 0) return;
  closePanels();
  pad.setPointerCapture(e.pointerId);
  const [x, y] = toPad(e);
  cur = { sid: rid(10), style: style(), pending: [x, y], ids: [], last: [x, y], timer: setInterval(() => flush(false), CHUNK_MS) };
  drawChunk({ ...cur.style, pts: [x, y] });
});
pad.addEventListener('pointermove', e => {
  if (!cur) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs){
    const [x, y] = toPad(ev);
    if (Math.hypot((x - cur.last[0]) * W, (y - cur.last[1]) * H) < 1.5) continue;
    drawChunk({ ...cur.style, pts: [...cur.last, x, y] });
    cur.pending.push(x, y); cur.last = [x, y];
  }
});
const endStroke = () => {
  if (!cur) return;
  clearInterval(cur.timer);
  if (cur.pending.length === 2 && !cur.ids.length) cur.pending.push(...cur.pending);   // a tap is a dot: send it as one
  flush(true);
  myStrokes.push({ sid: cur.sid, ids: cur.ids });
  cur = null;
};
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);

$('r-undo').addEventListener('click', async () => {
  const s = myStrokes.pop();
  if (!s || !conn) return;
  const ids = (await Promise.all(s.ids)).filter(Boolean);
  if (ids.length) conn.remove(ids).catch(e => B.toast(e.message));
});

/* ---------- tools ---------- */
function paintTools(){
  const css = hsb(color.h, color.s, color.b);
  $('r-swatch').style.background = css; $('r-dot').style.background = css;
  const d = Math.max(6, Math.min(34, width * 0.6)); $('r-dot').style.width = $('r-dot').style.height = d + 'px';
  $('r-tool').innerHTML = tool === 'brush' ? ICON.brush : ICON.eraser;
  $('r-tool').setAttribute('aria-label', tool === 'brush' ? 'Switch to eraser' : 'Switch to brush');
  const tip = $('r-tool').querySelector('.r-tip'); if (tip) tip.setAttribute('fill', css);
  $('r-sat').style.setProperty('--sat-track', `linear-gradient(90deg, ${hsb(color.h, 0, color.b)}, ${hsb(color.h, 100, color.b)})`);
  $('r-bri').style.setProperty('--bri-track', `linear-gradient(90deg, #000, ${hsb(color.h, color.s, 100)})`);
}
$('r-tool').addEventListener('click', () => { tool = tool === 'brush' ? 'eraser' : 'brush'; paintTools(); });
const colorOpen = () => !$('r-hsb').hidden;
function setColorMode(on){ $('r-hsb').hidden = !on; $('r-size').hidden = on; $('r-color').classList.toggle('sel', on); }
$('r-color').addEventListener('click', () => setColorMode(!colorOpen()));
for (const [k, key] of [['hue', 'h'], ['sat', 's'], ['bri', 'b']]) $('r-' + k).addEventListener('input', e => {
  color[key] = +e.target.value; if (tool === 'eraser') tool = 'brush'; paintTools();
});
$('r-width').addEventListener('input', e => { width = +e.target.value; paintTools(); });

/* ---------- sheets: chat and invite ---------- */
for (const s of [$('r-chatsheet'), $('r-invsheet')]) for (const ev of ['pointerdown', 'pointermove', 'pointerup']) s.addEventListener(ev, e => e.stopPropagation());
function closePanels(){ setColorMode(false); $('r-chatsheet').classList.remove('open'); $('r-invsheet').classList.remove('open'); $('r-chatinput').blur(); }
function placeSheets(){
  const vv = window.visualViewport;
  const lift = vv ? Math.max(0, innerHeight - (vv.height + vv.offsetTop)) : 0;
  $('r-chatsheet').style.bottom = lift + 'px';
}
if (window.visualViewport){ visualViewport.addEventListener('resize', placeSheets); visualViewport.addEventListener('scroll', placeSheets); }

function paintMsgs(){
  const box = $('r-msgs'); box.replaceChildren();
  if (!msgs.length){ const e = document.createElement('div'); e.className = 's-cempty'; e.textContent = 'Say hi while you draw.'; box.appendChild(e); }
  for (const m of msgs){
    const r = document.createElement('div'); r.className = 's-c' + (B.session && m.by === B.session.handle ? ' mine' : '');
    const who = document.createElement('div'); who.className = 's-cwho'; who.appendChild(B.avatarEl(m.by || 'someone', 'mid'));
    const body = document.createElement('div'); body.className = 's-cbody';
    const tag = document.createElement('div'); tag.className = 's-ctag'; tag.textContent = '@' + (m.by || 'someone');
    const t = document.createElement('div'); t.className = 's-ctext'; t.textContent = m.t;
    body.append(tag, t); r.append(who, body); box.appendChild(r);
  }
  box.scrollTop = box.scrollHeight;
  $('r-unread').textContent = unread ? (unread > 9 ? '9+' : unread) : '';
}
$('r-chat').addEventListener('click', () => {
  const open = !$('r-chatsheet').classList.contains('open');
  closePanels();
  if (open){ $('r-chatsheet').classList.add('open'); unread = 0; paintMsgs(); placeSheets(); }
});
$('r-chatclose').addEventListener('click', closePanels);
$('r-chatform').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('r-chatinput').value.replace(/\s+/g, ' ').trim().slice(0, 280);
  if (!t || !conn) return;
  $('r-chatinput').value = '';
  conn.chat({ by: B.session ? B.session.handle : '', t }).catch(err => { $('r-chatinput').value = t; B.toast(err.message); });
});

const roomUrl = () => `${location.origin}/inko/?room=${room.id}`;
async function paintPeople(){
  const box = $('r-people'); box.replaceChildren();
  let people = [];
  try { people = (await B.api('following')).following || []; } catch (e) {}
  const here = new Set(Object.keys((room && room.members) || {}));
  if (!people.length){ const e = document.createElement('div'); e.className = 's-cempty'; e.textContent = 'Follow artists to invite them here, or share a link.'; box.appendChild(e); return; }
  for (const h of people){
    const r = document.createElement('div'); r.className = 's-c s-person';
    const who = document.createElement('div'); who.className = 's-cwho'; who.appendChild(B.avatarEl(h, 'mid'));
    const tag = document.createElement('div'); tag.className = 's-ctag s-grow'; tag.textContent = '@' + h;
    const go = document.createElement('button'); go.className = 's-follow'; go.dataset.invite = h;
    go.textContent = here.has(h) ? 'Here' : 'Invite'; go.disabled = here.has(h);
    go.onclick = async () => {
      go.disabled = true; go.textContent = 'Sent';
      try { await B.api('room-invite', { to: h, room: room.id, title: room.title }); }
      catch (e) { go.disabled = false; go.textContent = 'Invite'; B.toast(e.message); }
    };
    r.append(who, tag, go); box.appendChild(r);
  }
}
$('r-invite').addEventListener('click', () => {
  const open = !$('r-invsheet').classList.contains('open');
  closePanels();
  if (open){ $('r-invsheet').classList.add('open'); paintPeople(); }
});
$('r-invclose').addEventListener('click', closePanels);
$('r-share').addEventListener('click', async () => {
  const url = roomUrl();
  try {
    if (navigator.share) await navigator.share({ title: 'Draw with me on Inko', url });
    else { await navigator.clipboard.writeText(url); B.toast('Link copied'); }
  } catch (e) {}
});

/* ---------- the room itself ---------- */
function paintHead(){
  $('r-title').textContent = (room && room.title) || 'Shared canvas';
  const who = $('r-who'); who.replaceChildren();
  for (const h of Object.keys((room && room.members) || {}).slice(0, 8)) who.appendChild(B.avatarEl(h, 'small'));
}
function onRoom(data){
  if (!data){ $('r-wait').textContent = 'This shared canvas is gone.'; $('r-wait').hidden = false; return; }
  const genChanged = room && (room.gen || 0) !== (data.gen || 0);
  room = { ...room, ...data };
  paintBg(); paintHead();
  if (genChanged) redraw();
}
function onStrokes(added, removed){
  let again = removed.length > 0;
  for (const id of removed){ byId.delete(id); }
  if (removed.length) chunks = chunks.filter(c => byId.has(c.id));
  for (const c of added){
    if (byId.has(c.id)) continue;
    byId.set(c.id, c); chunks.push(c);
    if (mineSent.has(c.cid)) continue;           // drawn already, as the finger moved
    if (!again && live(c)) drawChunk(c);
  }
  if (again) redraw();
}
function onChat(added){
  const open = $('r-chatsheet').classList.contains('open');
  for (const m of added){ msgs.push(m); if (!open && !(B.session && m.by === B.session.handle)) unread++; }
  paintMsgs();
}

/* Open a room by id: create it first when `create` is given. */
export async function open(id, create){
  if (!B.session){ B.openAccount(); return; }
  if (openId === id && el.classList.contains('open')) return;
  await leave(true);
  openId = id;
  room = { id, title: (create && create.title) || 'Shared canvas', gen: 0, members: {} };
  chunks = []; byId.clear(); mineSent.clear(); myStrokes.length = 0; msgs = []; unread = 0;
  ctx.clearRect(0, 0, W, H); paintBg(); paintHead(); paintTools(); paintMsgs(); closePanels();
  $('r-wait').textContent = 'Connecting…'; $('r-wait').hidden = false;
  el.classList.add('open'); document.body.classList.add('in-room');
  try {
    const T = await transport();
    if (create) await T.create(id, { title: room.title, host: B.session.handle, bg: create.bg || { h: 40, s: 8, b: 97 }, gen: 0, members: {} });
    if (openId !== id) return;
    conn = await T.connect(id, { room: onRoom, strokes: onStrokes, chat: onChat });
    if (openId !== id){ conn.close(); conn = null; return; }
    await conn.update({ ['members.' + B.session.handle]: Date.now() }).catch(() => {});
    $('r-wait').hidden = true;
    remember(id, room.title);
  } catch (e) {
    console.warn('inko: room', e);
    $('r-wait').textContent = 'Could not join the shared canvas.';
  }
}

/* Leaving keeps the picture: a card in your gallery, one per room. */
async function leave(quiet){
  if (!el.classList.contains('open')) return;
  endStroke();
  const was = room, had = chunks.some(live);
  if (conn){ conn.close(); conn = null; }
  el.classList.remove('open'); document.body.classList.remove('in-room');
  closePanels(); openId = null;
  if (was && had && B.addCanvas){
    const png = await new Promise(r => pad.toBlob(r, 'image/png'));
    const bg = was.bg || { h: 40, s: 8, b: 97 };
    try { await B.addCanvas({ id: 'r' + was.id.slice(0, 16).toLowerCase(), title: was.title || 'Shared canvas', bg, png }); if (!quiet) B.toast('Kept in your gallery'); }
    catch (e) {}
  }
}
$('r-back').addEventListener('click', () => leave(false));
export const close = () => leave(false);
export const isOpen = () => el.classList.contains('open');

/* The rooms you were in, newest first, so you can go back to one. */
const RECENT = 'inkoRooms';
export function recent(){ try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch (e) { return []; } }
function remember(id, title){
  const list = recent().filter(r => r.id !== id);
  list.unshift({ id, title, at: Date.now() });
  try { localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 12))); } catch (e) {}
}
export function forget(id){ try { localStorage.setItem(RECENT, JSON.stringify(recent().filter(r => r.id !== id))); } catch (e) {} }
// The check reads the room through this; nothing else does.
window.inkoRoomState = () => ({ open: isOpen(), id: openId, chunks: chunks.filter(live).length, mine: myStrokes.length, msgs: msgs.map(m => m.by + ': ' + m.t), members: Object.keys((room && room.members) || {}), unread });
