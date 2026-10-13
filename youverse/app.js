'use strict';
/* YouVerse — everything that's happened while you've been alive.
   A journey in scenes. All math runs on-device. Data in data.js (YV_ANCHORS / YV_EVENTS / YV_WILD). */

const $ = id => document.getElementById(id);
const LS_KEY = 'youverse-profile-v1';

let profile = null;      // {dob:'YYYY-MM-DD', name:''}
let birth = null;        // Date at local noon on dob
let ticker = null;
let exYear = null;       // explorer year
let exTab = 'world';     // 'world' | 'us'

/* ---------- formatting (one system everywhere: commas, or spelled-out units) ---------- */
const commas = n => Math.round(n).toLocaleString('en-US');
function bigFmt(n){
  if (n >= 1e12) return (n/1e12).toFixed(2).replace(/\.?0+$/,'') + ' trillion';
  if (n >= 1e9)  return (n/1e9).toFixed(2).replace(/\.?0+$/,'') + ' billion';
  if (n >= 1e6)  return (n/1e6).toFixed(1).replace(/\.0$/,'') + ' million';
  return commas(n);
}
const FMT = {
  int: v => commas(v),
  big: v => bigFmt(v),
  plusBig: v => '+' + bigFmt(v),
  plus0: v => '+' + Math.round(v),
  temp: v => '+' + v.toFixed(1) + ' °C',
  hrs: v => commas(v) + ' hrs',
  dec1: v => v.toFixed(1),
};

/* ---------- anchor interpolation ---------- */
function interp(table, x){
  const yrs = Object.keys(table).map(Number).sort((a,b)=>a-b);
  if (x <= yrs[0]) return table[yrs[0]];
  if (x >= yrs[yrs.length-1]) return table[yrs[yrs.length-1]];
  for (let i=0;i<yrs.length-1;i++){
    const a=yrs[i], b=yrs[i+1];
    if (x>=a && x<=b){ const t=(x-a)/(b-a); return table[a]+t*(table[b]-table[a]); }
  }
  return table[yrs[yrs.length-1]];
}
function yearFloat(d){
  const start = new Date(d.getFullYear(),0,1);
  const next = new Date(d.getFullYear()+1,0,1);
  return d.getFullYear() + (d - start)/(next - start);
}

/* ---------- astronomy ---------- */
function moonPhase(date){
  const known = Date.UTC(2000,0,6,18,14);
  const synodic = 29.53058867;
  const age = (((date.getTime() - known)/86400000) % synodic + synodic) % synodic;
  const illum = (1 - Math.cos(2*Math.PI*age/synodic))/2;
  const names = [
    [1.5,'New Moon','🌑'],[6.4,'Waxing Crescent','🌒'],[8.4,'First Quarter','🌓'],
    [13.8,'Waxing Gibbous','🌔'],[16.8,'Full Moon','🌕'],[21.7,'Waning Gibbous','🌖'],
    [23.7,'Last Quarter','🌗'],[28.5,'Waning Crescent','🌘'],[99,'New Moon','🌑']
  ];
  for (const [lim,n,e] of names) if (age < lim) return {name:n, emoji:e, illum};
  return {name:'New Moon', emoji:'🌑', illum};
}
function generation(y){
  if (y>=2025) return 'Generation Beta';
  if (y>=2013) return 'Generation Alpha';
  if (y>=1997) return 'Generation Z';
  if (y>=1981) return 'Millennial';
  if (y>=1965) return 'Generation X';
  if (y>=1946) return 'Baby Boomer';
  return 'the Silent Generation';
}

/* ---------- stats ---------- */
function computeStats(){
  const now = new Date();
  const secs = (now - birth)/1000;
  const days = secs/86400;
  const years = days/365.25;
  const bYF = yearFloat(birth), nYF = yearFloat(now);
  const popB = interp(YV_ANCHORS.popWorldB, bYF), popN = interp(YV_ANCHORS.popWorldB, nYF);
  const netB = interp(YV_ANCHORS.internetB, bYF), netN = interp(YV_ANCHORS.internetB, nYF);
  const exoB = Math.round(interp(YV_ANCHORS.exoplanets, bYF)), exoN = Math.round(interp(YV_ANCHORS.exoplanets, nYF));
  const co2B = interp(YV_ANCHORS.co2, bYF), co2N = interp(YV_ANCHORS.co2, nYF);
  const tmpB = interp(YV_ANCHORS.tempC, bYF), tmpN = interp(YV_ANCHORS.tempC, nYF);
  const issStart = new Date(1998,10,20,12,0);
  const issDays = Math.max(0, (now - Math.max(birth, issStart))/86400000);
  return {
    now, secs, days, years,
    heartbeats: secs * 1.2,
    breaths: secs * (16/60),
    popB, popN, netB, netN, exoB, exoN, co2B, co2N,
    warmed: Math.max(0, tmpN - tmpB),
    sunMiles: years * 584e6,
    galaxyMiles: years * 4.5e9,
    moons: Math.floor(days/29.53058867),
    issOrbits: issDays * 15.5,
    issYears: issDays/365.25,
  };
}
const TAG = {exact:'<span class="tag exact">Exact</span>', calc:'<span class="tag calc">Calculated</span>', est:'<span class="tag est">Estimate</span>'};
/* tile(tag, raw, fmt, suffix, lbl, sub) — when raw is null, suffix carries the full display HTML (live/string values). */
function tile(tag, raw, fmt, suffix, lbl, sub){
  const attrs = raw != null ? ` data-count="${raw}" data-fmt="${fmt}" data-suffix="${suffix || ''}"` : '';
  const disp = raw != null ? FMT[fmt](raw) + (suffix || '') : suffix;
  return `<div class="tile rv">${TAG[tag]}<div class="num"${attrs}>${disp}</div><div class="lbl">${lbl}</div><div class="sub">${sub}</div></div>`;
}

function renderStory(){
  const s = computeStats();
  const by = birth.getFullYear();
  const who = profile.name ? `${profile.name}, you've` : "You've";
  $('heroKicker').textContent = profile.name ? `${profile.name}'s story so far` : 'Your story so far';
  const dEl = $('daysAlive');
  dEl.textContent = commas(s.days);
  dEl.dataset.count = s.days; dEl.dataset.fmt = 'int'; dEl.dataset.suffix = '';
  const gEl = $('galacticMiles');
  gEl.textContent = bigFmt(s.galaxyMiles);
  gEl.dataset.count = s.galaxyMiles; gEl.dataset.fmt = 'big'; gEl.dataset.suffix = '';
  $('heroLine').innerHTML =
    `Born <b>${birth.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</b> · ` +
    `Earth has carried you <b>${s.years.toFixed(1)} years</b> around the Sun — and counting.`;

  const mp = moonPhase(birth);
  const weekday = birth.toLocaleDateString('en-US',{weekday:'long'});
  $('firstDay').innerHTML =
    `🌅 <b>Your first day:</b> You arrived on a ${weekday}. That night the Moon was a ` +
    `<b>${mp.name.toLowerCase()}</b> ${mp.emoji} (${Math.round(mp.illum*100)}% lit). ` +
    `You are a <b>${generation(by)}</b> — one of about <b>${bigFmt(interp(YV_ANCHORS.popWorldB, by)*1e9)} people</b> on Earth that year.`;

  $('bodyCards').innerHTML = [
    tile('calc', null, null, '<span id="bodyHeartbeats">' + commas(s.heartbeats) + '</span>', 'heartbeats', 'At a lifetime average of ~72 beats a minute — it has never once taken a break.'),
    tile('est', s.breaths, 'int', '', 'breaths', 'Roughly 16 a minute, sleeping and waking, since your very first one.'),
    tile('est', s.days*8, 'hrs', '', 'spent asleep', 'About a third of your life — roughly ' + commas(s.days*8/24) + ' full days, dreaming included below.'),
    tile('est', s.days*2, 'hrs', '', 'spent dreaming', 'Around 2 hours a night inside worlds your brain built for free.'),
    tile('est', s.days*3, 'int', '', 'meals eaten', 'Give or take a few thousand snacks we won\'t tell anyone about.'),
    tile('est', s.days/27, 'int', '', 'brand-new skins', 'Your outer layer fully replaces itself about every 27 days.'),
    tile('est', s.days*16*60*17, 'big', '', 'blinks', 'About 17 a minute while you\'re awake. You\'ve missed a lot of very short moments.'),
  ].join('');

  $('planetCards').innerHTML = [
    tile('calc', (s.popN - s.popB)*1e9, 'plusBig', '', 'people added to Earth',
      `From ${s.popB.toFixed(2)} billion when you arrived to ${s.popN.toFixed(2)} billion now — net, after every goodbye.`),
    tile('est', s.years*134e6, 'big', '', 'babies born since you',
      'Roughly 134 million a year. Every one of them arrived into a world that already had you in it.'),
    s.netB < 0.05
      ? tile('calc', null, null, 'basically zero', 'internet users when you were born',
        `Today: ${bigFmt(s.netN*1e9)}. The internet grew up alongside you — most of humanity got online during your lifetime.`)
      : tile('calc', s.netB*1e9, 'big', '', 'internet users when you were born',
        `Today: ${bigFmt(s.netN*1e9)}. The internet grew up alongside you — most of humanity got online during your lifetime.`),
    tile('calc', s.co2N - s.co2B, 'plus0', ' ppm', 'more CO₂ in every breath',
      `Air at your birth: ${s.co2B.toFixed(0)} ppm. Air today: ${s.co2N.toFixed(0)} ppm (Mauna Loa measurements).`),
    tile('calc', s.warmed, 'temp', '', 'warmer planet',
      'The global average temperature rise that has happened on your watch.'),
    tile('est', s.years*145, 'int', '', 'earthquakes, magnitude 6+',
      'Earth\'s long-run average is ~145 a year (USGS). The ground under you has never really sat still.'),
    tile('calc', s.secs*44, 'big', '', 'lightning strikes on Earth',
      'About 44 flashes every second, planet-wide, your whole life (NASA).'),
  ].join('');

  $('spaceCards').innerHTML = [
    tile('calc', s.galaxyMiles, 'big', '', 'miles through the galaxy',
      'The Sun orbits the Milky Way at ~514,000 mph, and you ride along. You will never pass your starting point again.'),
    tile('calc', s.sunMiles, 'big', '', 'miles around the Sun',
      `${s.years.toFixed(1)} full laps at ~584 million miles each. Happy every-orbit, roughly ${commas(Math.floor(s.years))} times over.`),
    tile('exact', s.moons, 'int', '', 'full moons',
      'Every 29.5 days, like clockwork, whether you looked up or not.'),
    tile('calc', s.exoN - s.exoB, 'int', '', 'planets discovered beyond our solar system',
      `Known when you were born: ${commas(s.exoB)}. Known today: ${commas(s.exoN)} (NASA Exoplanet Archive, approx). An entire science was born with you.`),
    tile('est', s.years*4.7, 'dec1', '', 'eclipses have occurred',
      'Solar and lunar, somewhere on Earth — about 4–5 a year.'),
    s.issOrbits > 0
      ? tile('calc', s.issOrbits, 'int', '', 'ISS orbits during your life',
        'The International Space Station circles Earth every ~93 minutes. It has lapped the planet this many times since ' +
        (birth < new Date(1998,10,20) ? 'it launched in 1998.' : 'you arrived.'))
      : tile('calc', null, null, '0', 'ISS orbits during your life', 'The Space Station launched in 1998 — it will catch up.'),
  ].join('');

  buildChips();
  renderWild();
  setExplorer(Math.min(new Date().getFullYear(), 2026), false);
  startTicker(s);
}

/* ---------- live ticker ---------- */
function startTicker(){
  if (ticker) clearInterval(ticker);
  const tick = () => {
    const secs = (Date.now() - birth.getTime())/1000;
    $('secondsAlive').textContent = commas(secs);
    $('heartbeats').textContent = bigFmt(secs*1.2);
    const bh = $('bodyHeartbeats'); if (bh) bh.textContent = commas(secs*1.2);
  };
  tick();
  ticker = setInterval(tick, 250);
}

/* ---------- scene reveals, count-ups, dot nav ---------- */
function runCount(el){
  if (el.dataset.done) return; el.dataset.done = '1';
  const raw = parseFloat(el.dataset.count);
  if (!isFinite(raw)) return;
  const fmt = FMT[el.dataset.fmt] || FMT.int, suf = el.dataset.suffix || '';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    el.textContent = fmt(raw) + suf; return;
  }
  const t0 = performance.now(), dur = 1300;
  const step = t => {
    const p = Math.min(1, (t - t0)/dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(raw * e) + suf;
    if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(raw) + suf;
  };
  requestAnimationFrame(step);
}
function initJourney(){
  const rvs = document.querySelectorAll('#storyView .rv');
  rvs.forEach((el, i) => el.style.setProperty('--d', (Math.min(i % 6, 5) * 0.07) + 's'));
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    e.target.querySelectorAll('[data-count]').forEach(runCount);
    io.unobserve(e.target);
  }), {threshold: .15});
  rvs.forEach(el => io.observe(el));
  const sceneIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting){
      document.querySelectorAll('.dotnav button').forEach(b =>
        b.classList.toggle('active', b.dataset.target === e.target.id));
    }
  }), {rootMargin: '-45% 0px -45% 0px'});
  document.querySelectorAll('#storyView .scene').forEach(sc => sceneIO.observe(sc));
}
document.querySelectorAll('.dotnav button').forEach(b =>
  b.addEventListener('click', () => {
    const t = document.getElementById(b.dataset.target);
    if (t) t.scrollIntoView({behavior: 'smooth'});
  }));

/* ---------- year explorer (the time machine) ---------- */
function explorerBounds(){
  const lo = Math.max(1950, birth.getFullYear());
  const hi = new Date().getFullYear();
  return [lo, hi];
}
function buildChips(){
  const by = birth.getFullYear(), nowY = new Date().getFullYear();
  const want = [ ['Born', by], ['Age 5', by+5], ['Age 10', by+10], ['Age 18', by+18], ['Age 21', by+21], ['Now', nowY] ];
  const seen = new Set();
  $('ageChips').innerHTML = want
    .filter(([,y]) => y>=1950 && y<=nowY && !seen.has(y) && seen.add(y))
    .map(([l,y]) => `<button type="button" class="chip" data-year="${y}">${l}</button>`).join('');
  document.querySelectorAll('.chip').forEach(c =>
    c.addEventListener('click', () => setExplorer(Number(c.dataset.year), false)));
}
function setExplorer(year, scroll){
  const [lo, hi] = explorerBounds();
  exYear = Math.min(hi, Math.max(lo, year));
  const slider = $('yearSlider');
  slider.min = lo; slider.max = hi; slider.value = exYear;
  const age = exYear - birth.getFullYear();
  $('yearBig').textContent = age === 0 ? 'Born' : `Age ${age}`;
  $('yearAge').textContent = age === 0 ? `${exYear} · where your story starts`
    : exYear === new Date().getFullYear() ? `${exYear} · you, right now`
    : `${exYear} · you turned ${age} this year`;
  const yc = document.querySelector('.year-center');
  if (yc){ yc.classList.remove('warp'); void yc.offsetWidth; yc.classList.add('warp'); }
  $('prevYear').disabled = exYear <= lo;
  $('nextYear').disabled = exYear >= hi;
  document.querySelectorAll('.chip').forEach(c =>
    c.classList.toggle('active', Number(c.dataset.year) === exYear));
  renderEvents();
  if (scroll) $('yearBig').scrollIntoView({block:'nearest', behavior:'smooth'});
}
function renderEvents(){
  const data = YV_EVENTS[String(exYear)];
  const list = $('eventList');
  if (!data){ list.innerHTML = '<div class="empty">Our event archive starts in 1950 — this year is beyond it for now.</div>'; currentItems = []; return; }
  const items = data[exTab] || [];
  currentItems = items;
  list.innerHTML = items.map((e,i) =>
    `<div class="event tappable" data-i="${i}" role="button" tabindex="0"><div class="et">${e.t}</div><div class="ed">${e.d}</div><div class="go">The full story ›</div></div>`).join('')
    || '<div class="empty">No entries for this view yet.</div>';
}

/* ---------- deep-dive sheet (Wikipedia live summary) ---------- */
let currentItems = [];
let currentFound = [], currentLost = [];
function diveMeta(year){
  const age = year - birth.getFullYear();
  return age <= 0 ? `${year} · the year you were born` : `${year} · you were ${age}`;
}
async function openDive(title, meta, fallback){
  const body = $('diveBody');
  body.innerHTML = `<div class="dive-kicker">${meta}</div><h4 class="dive-title">${title}</h4><p class="dive-loading">Digging up the full story…</p>`;
  $('diveSheet').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  try {
    const s = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch='
      + encodeURIComponent(title) + '&srlimit=1&format=json&origin=*').then(r => r.json());
    const hit = s.query && s.query.search && s.query.search[0];
    if (!hit) throw new Error('no hit');
    const sum = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'
      + encodeURIComponent(hit.title.replace(/ /g,'_'))).then(r => r.json());
    const url = (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page)
      || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(hit.title.replace(/ /g,'_')));
    const img = sum.thumbnail ? `<img class="dive-img" src="${sum.thumbnail.source}" alt="">` : '';
    body.innerHTML = `<div class="dive-kicker">${meta}</div><h4 class="dive-title">${title}</h4>${img}` +
      `<p class="dive-text">${sum.extract || fallback}</p>` +
      `<div class="dive-links"><a class="dive-btn" href="${url}" target="_blank" rel="noopener">Read the full story ↗</a>` +
      `<a class="dive-btn ghost" href="https://www.youtube.com/results?search_query=${encodeURIComponent(title)}" target="_blank" rel="noopener">▶ Watch it</a></div>` +
      `<p class="dive-src">${img ? 'Summary + photo via Wikipedia' : 'Summary via Wikipedia'}</p>`;
  } catch(e) {
    body.innerHTML = `<div class="dive-kicker">${meta}</div><h4 class="dive-title">${title}</h4>` +
      `<p class="dive-text">${fallback}</p>` +
      `<div class="dive-links"><a class="dive-btn" href="https://www.google.com/search?q=${encodeURIComponent(title)}" target="_blank" rel="noopener">Search the web ↗</a></div>`;
  }
}
function closeDive(){
  $('diveSheet').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---------- fellow earthlings ---------- */
function wildRow(w, kind, i){
  return `<div class="wild-row rv" data-kind="${kind}" data-i="${i}" role="button" tabindex="0">` +
    `<div class="wild-main"><span class="wild-name">${w.n}</span><span class="wild-year">${w.y}</span></div>` +
    `<div class="wild-note">${w.d}</div><div class="go">Photos + full story ›</div></div>`;
}
function renderWild(){
  const by = birth.getFullYear();
  const s = computeStats();
  currentFound = YV_WILD.found.filter(w => w.y >= by).slice().sort((a,b) => b.y - a.y);
  currentLost = YV_WILD.lost.filter(w => w.y >= by).slice().sort((a,b) => b.y - a.y);
  $('wildCards').innerHTML = [
    tile('est', Math.floor(s.years) * 17000, 'big', '+', 'new species discovered during your life',
      'Scientists describe roughly 17,000 species a year — mostly insects, plants and deep-sea things. The famous ones are below.'),
    tile('calc', currentLost.length, 'int', '', 'famous species lost during your life',
      'The ones the world noticed by name. The true total, counting the small and unnoticed, is estimated to be far higher.'),
  ].join('');
  $('wildFound').innerHTML = currentFound.length
    ? currentFound.map((w,i) => wildRow(w,'found',i)).join('')
    : '<div class="empty">None of the famous ones yet — you are very new here. The discoveries are coming.</div>';
  $('wildLost').innerHTML = currentLost.length
    ? currentLost.map((w,i) => wildRow(w,'lost',i)).join('')
    : '<div class="empty">None of the famous ones yet. Let\'s keep it that way.</div>';
}

/* ---------- poster ---------- */
function makePoster(){
  const s = computeStats();
  const cv = $('posterCanvas'), ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0,0,0,1350);
  g.addColorStop(0,'#0b1526'); g.addColorStop(1,'#071018');
  ctx.fillStyle = g; ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle = '#35e0c8';
  for (let i=0;i<160;i++){ ctx.globalAlpha = Math.random()*0.5+0.1; ctx.beginPath();
    ctx.arc(Math.random()*1080, Math.random()*1350, Math.random()*1.8, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#35e0c8'; ctx.font = '700 44px system-ui';
  ctx.fillText('✦  Y O U V E R S E', 540, 130);
  ctx.fillStyle = '#eef4ff'; ctx.font = '850 64px system-ui';
  ctx.fillText(profile.name ? `${profile.name.toUpperCase()}'S LIFE IN NUMBERS` : 'A LIFE IN NUMBERS', 540, 225);
  ctx.fillStyle = '#8fa3bf'; ctx.font = '500 34px system-ui';
  ctx.fillText('Born ' + birth.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}), 540, 285);
  const rows = [
    [commas(s.days), 'days alive'],
    [commas(s.heartbeats), 'heartbeats'],
    [bigFmt(s.galaxyMiles), 'miles through the galaxy'],
    [commas(s.moons), 'full moons witnessed'],
    ['+' + bigFmt((s.popN - s.popB)*1e9), 'people added to Earth'],
    [commas(s.exoN - s.exoB), 'new worlds discovered'],
  ];
  rows.forEach(([n,l],i)=>{
    const y = 430 + i*130;
    ctx.fillStyle = '#eef4ff'; ctx.font = '850 58px system-ui'; ctx.fillText(n, 540, y);
    ctx.fillStyle = '#8fa3bf'; ctx.font = '600 30px system-ui'; ctx.fillText(l, 540, y+48);
  });
  ctx.fillStyle = '#35e0c8'; ctx.font = '700 32px system-ui';
  ctx.fillText('dexcimino.com/youverse', 540, 1280);
  cv.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'youverse-poster.png'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  });
}

/* ---------- entry / wiring ---------- */
function showStory(){
  $('entryView').classList.add('hidden');
  $('storyView').classList.remove('hidden');
  $('changeBtn').classList.remove('hidden');
  document.documentElement.classList.add('journey');
  renderStory();
  initJourney();
  window.scrollTo({top:0});
}
function loadProfile(){
  try { const p = JSON.parse(localStorage.getItem(LS_KEY)); if (p && p.dob) return p; } catch(e){}
  return null;
}
$('entryForm').addEventListener('submit', e => {
  e.preventDefault();
  const dob = $('dobInput').value;
  if (!dob) return;
  profile = { dob, name: $('nameInput').value.trim() };
  localStorage.setItem(LS_KEY, JSON.stringify(profile));
  birth = new Date(dob + 'T12:00:00');
  showStory();
});
$('changeBtn').addEventListener('click', () => {
  $('storyView').classList.add('hidden');
  $('changeBtn').classList.add('hidden');
  $('entryView').classList.remove('hidden');
  document.documentElement.classList.remove('journey');
  if (ticker) clearInterval(ticker);
  window.scrollTo({top:0});
});
$('prevYear').addEventListener('click', () => setExplorer(exYear-1, false));
$('nextYear').addEventListener('click', () => setExplorer(exYear+1, false));
$('yearSlider').addEventListener('input', e => setExplorer(Number(e.target.value), false));
$('tabWorld').addEventListener('click', () => { exTab='world'; $('tabWorld').classList.add('active'); $('tabUS').classList.remove('active'); renderEvents(); });
$('tabUS').addEventListener('click', () => { exTab='us'; $('tabUS').classList.add('active'); $('tabWorld').classList.remove('active'); renderEvents(); });
$('posterBtn').addEventListener('click', makePoster);
$('eventList').addEventListener('click', e => {
  const el = e.target.closest('.event.tappable'); if (!el) return;
  const item = currentItems[Number(el.dataset.i)]; if (!item) return;
  openDive(item.t, diveMeta(exYear), item.d);
});
const wildClick = e => {
  const el = e.target.closest('.wild-row'); if (!el) return;
  const arr = el.dataset.kind === 'found' ? currentFound : currentLost;
  const item = arr[Number(el.dataset.i)]; if (!item) return;
  openDive(item.n, diveMeta(item.y), item.d);
};
$('wildFound').addEventListener('click', wildClick);
$('wildLost').addEventListener('click', wildClick);
$('diveClose').addEventListener('click', closeDive);
$('diveBackdrop').addEventListener('click', closeDive);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDive(); });

const saved = loadProfile();
if (saved){
  profile = saved;
  birth = new Date(saved.dob + 'T12:00:00');
  $('dobInput').value = saved.dob;
  $('nameInput').value = saved.name || '';
  showStory();
}
