'use strict';
/* YouVerse — everything that's happened while you've been alive.
   A journey in scenes: one screen per chapter, swipe to page.
   All math runs on-device. Data in data.js (YV_ANCHORS / YV_EVENTS / YV_WILD). */

const $ = id => document.getElementById(id);
let profile = null;      // {dob:'YYYY-MM-DD', name:''} — session only, never saved
let birth = null;        // Date at local noon on dob
let ticker = null;
let exYear = null;       // explorer year
let exTab = 'world';     // 'world' | 'us'

/* ---------- formatting (one system everywhere) ---------- */
const commas = n => Math.round(n).toLocaleString('en-US');
function bigFmt(n){
  if (n >= 1e12) return (n/1e12).toFixed(2).replace(/\.?0+$/,'') + ' trillion';
  if (n >= 1e9)  return (n/1e9).toFixed(2).replace(/\.?0+$/,'') + ' billion';
  if (n >= 1e6)  return (n/1e6).toFixed(1).replace(/\.0$/,'') + ' million';
  return commas(n);
}
function compactFmt(n){
  const a = Math.abs(n);
  const trim = v => v.toFixed(2).replace(/\.?0+$/,'');
  if (a >= 1e15) return trim(n/1e15) + 'P';
  if (a >= 1e12) return trim(n/1e12) + 'T';
  if (a >= 1e9) return trim(n/1e9) + 'B';
  if (a >= 1e6) return trim(n/1e6) + 'M';
  if (a >= 1e3) return trim(n/1e3) + 'K';
  return Number.isInteger(n) ? commas(n) : trim(n);
}
const FMT = {
  int: v => commas(v),
  big: v => bigFmt(v),
  compact: v => compactFmt(v),
  plusCompact: v => '+' + compactFmt(v),
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

/* ---------- astronomy + generations ---------- */
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
/* Cohort sizes are the commonly cited U.S. figures (Pew-style), hence "roughly". */
function genInfo(y){
  if (y>=2025) return {art:'', name:'Generation Beta', text:'among the very first of a brand-new generation, born from 2025.'};
  if (y>=2013) return {art:'', name:'Generation Alpha', text:'one of roughly <b>45 million</b> people born 2013–2024.'};
  if (y>=1997) return {art:'', name:'Generation Z', text:'one of roughly <b>68 million</b> people born 1997–2012.'};
  if (y>=1981) return {art:'a', name:'Millennial', text:'one of roughly <b>72 million</b> people born 1981–1996.'};
  if (y>=1965) return {art:'', name:'Generation X', text:'one of roughly <b>65 million</b> people born 1965–1980.'};
  if (y>=1946) return {art:'a', name:'Baby Boomer', text:'one of roughly <b>70 million</b> people born 1946–1964.'};
  return {art:'', name:'the Silent Generation', text:'one of roughly <b>23 million</b> people born 1928–1945.'};
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
/* stat row: compact number + accent label on the left, description on the right.
   When raw is null, suffix carries the full display HTML. */
function srow(tag, raw, fmt, suffix, lbl, sub){
  const attrs = raw != null ? ` data-count="${raw}" data-fmt="${fmt}" data-suffix="${suffix || ''}"` : '';
  const disp = raw != null ? FMT[fmt](raw) + (suffix || '') : suffix;
  return `<div class="srow"><div class="s-left"><div class="num"${attrs}>${disp}</div><div class="lbl">${lbl}</div></div><div class="sub">${sub}</div></div>`;
}
function wstat(raw, fmt, suffix, lbl){
  return `<div class="wstat rv"><div class="num" data-count="${raw}" data-fmt="${fmt}" data-suffix="${suffix || ''}">${FMT[fmt](raw) + (suffix || '')}</div><div class="lbl">${lbl}</div></div>`;
}

/* Fill a chapter's horizontal sub-pages + its page dots. */
function fillPages(pagesId, dotsId, pages){
  $(pagesId).innerHTML = pages.map(rows =>
    `<div class="hpage rv"><div class="stats">${rows.join('')}</div></div>`).join('');
  $(dotsId).innerHTML = '<span class="pd-hint">Swipe</span>' +
    pages.map((_, i) => `<button type="button" class="pdot ${i === 0 ? 'on' : ''}" data-page="${i}" aria-label="Page ${i + 1}"></button>`).join('');
  $(pagesId).scrollLeft = 0;
  $(dotsId).querySelectorAll('.pdot').forEach(b => b.addEventListener('click', () => {
    const el = $(pagesId);
    el.scrollTo({left: Number(b.dataset.page) * el.clientWidth, behavior: 'smooth'});
  }));
}
const NEO_ANCHORS = {1990:130, 1995:400, 2000:1000, 2005:3400, 2010:7000, 2015:13000, 2020:24000, 2026:39000};

function renderStory(){
  const s = computeStats();
  const by = birth.getFullYear();
  $('heroKicker').textContent = profile.name ? `${profile.name}'s story so far` : 'Your story so far';
  const dEl = $('daysAlive');
  dEl.textContent = commas(s.days);
  dEl.dataset.count = s.days; dEl.dataset.fmt = 'int'; dEl.dataset.suffix = '';
  const gEl = $('galacticMiles');
  gEl.textContent = compactFmt(s.galaxyMiles);
  gEl.dataset.count = s.galaxyMiles; gEl.dataset.fmt = 'compact'; gEl.dataset.suffix = '';
  $('heroLine').innerHTML =
    `Born <b>${birth.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</b> · ` +
    `Earth has carried you <b>${s.years.toFixed(1)} years</b> around the Sun — and counting.`;

  /* Body — three swipeable pages */
  const walkMiles = s.days * 5000 * 0.000473;
  const walkLaps = walkMiles / 24901;
  fillPages('bodyPages', 'bodyDots', [
    [
      srow('calc', null, null, '<span id="bodyHeartbeats">' + compactFmt(s.heartbeats) + '</span>', 'heartbeats', 'At a lifetime average of ~72 beats a minute — never once a break.'),
      srow('est', s.breaths, 'compact', '', 'breaths', 'Roughly 16 a minute, sleeping and waking, since your very first one.'),
      srow('est', s.days*2000, 'compact', '', 'gallons of blood pumped', `Enough to fill about ${Math.max(1, Math.round(s.days*2000/660000))} Olympic swimming pools.`),
      srow('est', s.days*16*60*17, 'compact', '', 'blinks', 'About 17 a minute while you\'re awake.'),
      srow('est', s.days*3.3e11, 'compact', '', 'cells replaced', 'Almost none of the cells you were born with are still you. You are a Ship of Theseus.'),
    ],
    [
      srow('est', walkMiles, 'compact', '', 'miles walked', walkLaps >= 1 ? `That is ${walkLaps.toFixed(1)} laps around the entire Earth.` : `That is ${Math.round(walkLaps*100)}% of the way around the entire Earth.`),
      srow('est', s.days*3, 'compact', '', 'meals eaten', 'Give or take a few thousand snacks.'),
      srow('est', s.days*16000, 'compact', '', 'words spoken', `About ${commas(Math.round(s.days*16000/80000))} novels\' worth, said out loud.`),
      srow('est', s.days*15, 'compact', '', 'laughs', 'Roughly 15 a day — the good stuff adds up.'),
      srow('est', s.days*4, 'compact', '', 'dreams dreamed', 'Several a night. You forgot almost every single one.'),
    ],
    [
      srow('est', s.days*8, 'compact', '', 'hours asleep', 'About a third of your life, gone to recharging.'),
      srow('est', s.days*2, 'compact', '', 'hours dreaming', 'Around 2 hours a night inside worlds your brain built for free.'),
      srow('est', s.years*1.378, 'compact', '', 'feet of fingernails', 'All ten fingers, end to end, at about 3.5 mm a month each.'),
      srow('est', s.years*0.5, 'compact', '', 'feet of hair growth', 'If you had never cut it — about 6 inches a year, every year.'),
      srow('est', s.years*1.4, 'compact', '', 'pounds of skin shed', 'You leave a trail of yourself everywhere you go.'),
    ],
  ]);

  /* Planet — two swipeable pages */
  const MILESTONES = [[6,'1999'],[7,'2011'],[8,'2022']];
  const crossed = MILESTONES.filter(([, y]) => by < Number(y) && Number(y) <= new Date().getFullYear());
  fillPages('planetPages', 'planetDots', [
    [
      srow('calc', (s.popN - s.popB)*1e9, 'plusCompact', '', 'people added',
        `From ${s.popB.toFixed(2)} billion when you arrived to ${s.popN.toFixed(2)} billion now.`),
      srow('est', s.years*134e6, 'compact', '', 'babies born',
        'Every one of them arrived into a world that already had you in it.'),
      s.netB < 0.05
        ? srow('calc', null, null, 'basically zero', 'internet users then',
          `Today: ${compactFmt(s.netN*1e9)}. The internet grew up alongside you.`)
        : srow('calc', s.netB*1e9, 'compact', '', 'internet users then',
          `Today: ${compactFmt(s.netN*1e9)}. The internet grew up alongside you.`),
      srow('calc', s.co2N - s.co2B, 'plus0', ' ppm', 'more CO₂ in every breath',
        `Air at your birth: ${s.co2B.toFixed(0)} ppm. Air today: ${s.co2N.toFixed(0)} ppm.`),
      srow('calc', s.warmed, 'temp', '', 'warmer planet',
        'The global average temperature rise on your watch.'),
      srow('est', s.years*145, 'compact', '', 'earthquakes mag 6+',
        'The ground under you has never really sat still (USGS average).'),
      srow('calc', s.secs*44, 'compact', '', 'lightning strikes',
        'About 44 flashes every second, planet-wide (NASA).'),
    ],
    [
      srow('est', s.years*15, 'compact', '', 'earthquakes mag 7+',
        'The big, damaging kind — about 15 a year worldwide (USGS).'),
      srow('est', s.years*55, 'compact', '', 'volcanic eruptions',
        'Somewhere on Earth, roughly one a week, your whole life.'),
      srow('est', s.days*100000, 'compact', '', 'flights flown',
        'Around 100,000 takeoffs and landings every single day.'),
      srow('est', s.years*80e6, 'compact', '', 'cars built',
        'Roughly 80 million new cars roll out every year.'),
      srow('calc', null, null, crossed.length ? String(crossed.length) : '0',
        'population milestones',
        crossed.length
          ? crossed.map(([b, y]) => `${b} billion in ${y}`).join(' · ') + ' — you were here for all of them.'
          : 'The world hit 8 billion in 2022 — before your time. Next up: 9 billion, expected around 2037.'),
      srow('est', s.days*12, 'compact', '', 'hours of daylight',
        'Half a life in light, half in dark — on average, wherever you are.'),
    ],
  ]);

  /* Space — two swipeable pages; page two is the stars */
  const bYF = yearFloat(birth), nYF = yearFloat(new Date());
  const neoB = Math.round(interp(NEO_ANCHORS, bYF)), neoN = Math.round(interp(NEO_ANCHORS, nYF));
  fillPages('spacePages', 'spaceDots', [
    [
      srow('calc', s.galaxyMiles, 'compact', '', 'Milky Way miles',
        'The Sun orbits the Milky Way at ~514,000 mph. You ride along.'),
      srow('calc', s.sunMiles, 'compact', '', 'miles around the Sun',
        `${s.years.toFixed(1)} full laps at ~584 million miles each.`),
      srow('exact', s.moons, 'compact', '', 'full moons',
        'Every 29.5 days, like clockwork, whether you looked up or not.'),
      srow('calc', s.exoN - s.exoB, 'compact', '', 'planets discovered',
        `Known when you were born: ${commas(s.exoB)}. Known today: ${commas(s.exoN)}.`),
      srow('est', s.years*4.7, 'dec1', '', 'eclipses',
        'Solar and lunar, somewhere on Earth — about 4–5 a year.'),
      s.issOrbits > 0
        ? srow('calc', s.issOrbits, 'compact', '', 'ISS orbits',
          'One lap of Earth every ~93 minutes, this many times since ' + (birth < new Date(1998,10,20) ? 'it launched in 1998.' : 'you arrived.'))
        : srow('calc', null, null, '0', 'ISS orbits', 'The Space Station launched in 1998 — it will catch up.'),
    ],
    [
      srow('est', s.years*3, 'compact', '', 'Milky Way stars born',
        'Only about three a year now — our galaxy has mostly settled down.'),
      srow('est', null, null, '0 so far', 'Milky Way supernovae',
        'Our galaxy averages one every ~50 years. The last one anyone saw was in 1604 — yours is overdue.'),
      srow('est', s.days*2.75e8, 'compact', '', 'stars born universe-wide',
        'About 275 million every single day, by the best astronomical estimates.'),
      srow('est', s.secs*30, 'compact', '', 'supernovae universe-wide',
        'Roughly 30 stars explode every second, somewhere out there.'),
      srow('calc', neoN - neoB, 'compact', '', 'near-Earth asteroids',
        `Known when you were born: ${commas(neoB)}. Known today: ${commas(neoN)}.`),
      srow('calc', s.years*0.1247, 'compact', '', 'feet the Moon drifted',
        'It slips about 1.5 inches further from you every year.'),
    ],
  ]);

  /* First day */
  const mp = moonPhase(birth);
  const weekday = birth.toLocaleDateString('en-US',{weekday:'long'});
  const gi = genInfo(by);
  $('firstDay').innerHTML =
    `You arrived on a <b>${weekday}</b>. That night the Moon was a <b>${mp.name.toLowerCase()}</b> ${mp.emoji} — ` +
    `${Math.round(mp.illum*100)}% lit. About <b>${bigFmt(interp(YV_ANCHORS.popWorldB, by)*1e9)} people</b> were already here, waiting.` +
    `<span class="gen-line">You are ${gi.art} <b>${gi.name}</b> — ${gi.text}</span>`;

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
    $('heartbeats').textContent = compactFmt(secs*1.2);
    const bh = $('bodyHeartbeats'); if (bh) bh.textContent = compactFmt(secs*1.2);
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

/* ---------- earthlings found/lost toggle ---------- */
document.querySelectorAll('.subtabs').forEach(bar => {
  bar.addEventListener('click', e => {
    const btn = e.target.closest('.stab'); if (!btn) return;
    bar.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b === btn));
    if (btn.dataset.list){
      $('wildFound').classList.toggle('hidden', btn.dataset.list !== 'found');
      $('wildLost').classList.toggle('hidden', btn.dataset.list !== 'lost');
    }
  });
});

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
  const car = $('eventList'); if (car) car.scrollLeft = 0;
  if (scroll) $('yearBig').scrollIntoView({block:'nearest', behavior:'smooth'});
}
function renderEvents(){
  const data = YV_EVENTS[String(exYear)];
  const list = $('eventList');
  if (!data){ list.innerHTML = '<div class="empty">Our event archive starts in 1950 — this year is beyond it for now.</div>'; currentItems = []; return; }
  const items = data[exTab] || [];
  currentItems = items;
  list.innerHTML = items.map((e,i) =>
    `<div class="ev-card" data-i="${i}" role="button" tabindex="0"><div class="card-media"><img data-wiki="${e.t.replace(/"/g,'&quot;')}" data-fb="${exTab}" alt=""></div><div class="card-body"><div class="et">${e.t}</div><div class="ed">${e.d}</div><div class="go">The full story ›</div></div></div>`).join('')
    || '<div class="empty">No entries for this view yet.</div>';
  hydrateImages(list);
}

/* ---------- wikipedia thumbnails for cards (same source as the deep-dive) ---------- */
const wikiImgCache = new Map();
/* Card images, resolved through a chain so a card is never left blank:
   hand-picked overrides → the best of several Wikipedia matches (first page
   that actually has a photo) → the pageimages API → a Wikimedia Commons
   photo search → a category fallback photo (Blue Marble / Capitol / fox /
   thylacine, all verified live). */
const FALLBACK_IMG = {
  world: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/960px-The_Earth_seen_from_Apollo_17.jpg',
  us: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/US_Capitol_dome_Jan_2006.jpg/960px-US_Capitol_dome_Jan_2006.jpg',
  found: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c4/Red_Fox_drinking_from_a_lake_in_Gennevilliers%2C_France.jpg/960px-Red_Fox_drinking_from_a_lake_in_Gennevilliers%2C_France.jpg',
  lost: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/07/Thylacinus_cynocephalus_at_Hobart_Zoo_1928.jpg/960px-Thylacinus_cynocephalus_at_Hobart_Zoo_1928.jpg',
};
const YV_IMG_OVERRIDES = {};  /* filled by the coverage audit: title -> image URL */
function wikiImage(title){
  if (YV_IMG_OVERRIDES[title]) return Promise.resolve(YV_IMG_OVERRIDES[title]);
  if (wikiImgCache.has(title)) return wikiImgCache.get(title);
  const p = (async () => {
    try {
      const s = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch='
        + encodeURIComponent(title) + '&srlimit=4&format=json&origin=*').then(r => r.json());
      const hits = (s.query && s.query.search) || [];
      for (const hit of hits){
        const sum = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'
          + encodeURIComponent(hit.title.replace(/ /g,'_'))).then(r => r.json()).catch(() => null);
        if (sum && sum.thumbnail && sum.thumbnail.source) return sum.thumbnail.source;
      }
      if (hits.length){
        const pi = await fetch('https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=original|thumbnail&pithumbsize=900&titles='
          + encodeURIComponent(hits[0].title) + '&format=json&origin=*').then(r => r.json()).catch(() => null);
        const pages = pi && pi.query && pi.query.pages;
        if (pages){ const pg = Object.values(pages)[0]; if (pg && (pg.thumbnail || pg.original)) return (pg.thumbnail || pg.original).source; }
      }
      const cs = await fetch('https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch='
        + encodeURIComponent(title + ' filetype:bitmap') + '&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=900&format=json&origin=*')
        .then(r => r.json()).catch(() => null);
      const cpages = cs && cs.query && cs.query.pages;
      if (cpages){
        const cands = Object.values(cpages)
          .filter(pg => pg.imageinfo && pg.imageinfo[0] && /^image\/(jpeg|png|webp)$/.test(pg.imageinfo[0].mime || '') && (pg.imageinfo[0].width || 0) >= 500)
          .sort((a, b) => (a.index || 99) - (b.index || 99));
        if (cands.length) return cands[0].imageinfo[0].thumburl || cands[0].imageinfo[0].url;
      }
    } catch(e){}
    return null;
  })();
  wikiImgCache.set(title, p);
  return p;
}
/* Thumbnails load lazily: only when a card scrolls near view, so a rail of
   70+ species doesn't fire 70+ Wikipedia lookups up front. */
const thumbObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
  entries.forEach(en => { if (en.isIntersecting){ thumbObserver.unobserve(en.target); loadThumb(en.target); } });
}, {rootMargin: '300px'}) : null;
async function loadThumb(img){
  let src = await wikiImage(img.dataset.wiki);
  if (!src) src = FALLBACK_IMG[img.dataset.fb] || null;
  if (src){
    img.onerror = () => { const fb = FALLBACK_IMG[img.dataset.fb]; if (fb && img.src !== fb) img.src = fb; };
    img.src = src;
    const card = img.closest('.ev-card, .sp-card');
    if (card) card.classList.add('has-img');
  }
}
function hydrateImages(scope){
  scope.querySelectorAll('img[data-wiki]').forEach(img => {
    if (thumbObserver) thumbObserver.observe(img); else loadThumb(img);
  });
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
      + encodeURIComponent(title) + '&srlimit=3&format=json&origin=*').then(r => r.json());
    const hits = (s.query && s.query.search) || [];
    if (!hits.length) throw new Error('no hit');
    /* best article = the first hit whose page has both a summary and a photo */
    let hit = hits[0], sum = null;
    for (const h of hits){
      const sm = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'
        + encodeURIComponent(h.title.replace(/ /g,'_'))).then(r => r.json()).catch(() => null);
      if (sm && sm.extract){ hit = h; sum = sm; if (sm.thumbnail) break; }
    }
    if (!sum) throw new Error('no summary');
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
function spCard(w, kind, i){
  return `<div class="sp-card" data-kind="${kind}" data-i="${i}" role="button" tabindex="0">` +
    `<div class="card-media"><img data-wiki="${w.n.replace(/"/g,'&quot;')}" data-fb="${kind}" alt=""></div><div class="card-body">` +
    `<div class="sp-main"><span class="sp-name">${w.n}</span><span class="sp-year">${w.y}</span></div>` +
    `<div class="sp-note">${w.d}</div><div class="go">Photos + full story ›</div></div></div>`;
}
function renderWild(){
  const by = birth.getFullYear();
  const s = computeStats();
  currentFound = YV_WILD.found.filter(w => w.y >= by).slice().sort((a,b) => b.y - a.y);
  currentLost = YV_WILD.lost.filter(w => w.y >= by).slice().sort((a,b) => b.y - a.y);
  $('wildCards').innerHTML =
    wstat(Math.floor(s.years) * 17000, 'compact', '+', 'new species discovered during your life') +
    wstat(currentLost.length, 'int', '', 'famous species lost during your life');
  $('wildFound').innerHTML = currentFound.length
    ? currentFound.map((w,i) => spCard(w,'found',i)).join('')
    : '<div class="empty">None of the famous ones yet — you are very new here. The discoveries are coming.</div>';
  $('wildLost').innerHTML = currentLost.length
    ? currentLost.map((w,i) => spCard(w,'lost',i)).join('')
    : '<div class="empty">None of the famous ones yet. Let\'s keep it that way.</div>';
  hydrateImages($('wildFound'));
  hydrateImages($('wildLost'));
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
    [bigFmt(s.galaxyMiles), 'Milky Way miles'],
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

/* ---------- birthday picker: Month / Day / Year — tap any part, in any order ---------- */
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let picked = { m:null, d:null, y:null };
let activeSel = null;          // 'month' | 'day' | 'year' | null (panel closed)
function daysIn(y, m){ return new Date(y || 2000, m, 0).getDate(); }  // m 1-based; leap-safe default year
function dobString(){
  if (!picked.m || !picked.d || !picked.y) return null;
  return picked.y + '-' + String(picked.m).padStart(2,'0') + '-' + String(picked.d).padStart(2,'0');
}
function updateSelectors(){
  $('selMonthVal').textContent = picked.m ? MONTHS[picked.m-1] : '—';
  $('selDayVal').textContent = picked.d || '—';
  $('selYearVal').textContent = picked.y || '—';
  [['selMonth','month','m'],['selDay','day','d'],['selYear','year','y']].forEach(([id, k, pk]) => {
    $(id).classList.toggle('active', activeSel === k);
    $(id).classList.toggle('set', !!picked[pk]);
  });
  $('dobReadout').innerHTML = (!picked.m && !picked.d && !picked.y)
    ? 'Your birthday: <b>—</b>'
    : 'Your birthday: <b>' + (picked.m ? MONTH_FULL[picked.m-1] : 'Month') + ' ' + (picked.d || '—') + ', ' + (picked.y || '——') + '</b>';
  $('entryView').classList.toggle('panel-open', !!activeSel);
}
function renderPanel(){
  const step = $('dpStep');
  if (!activeSel){ $('dpPanel').classList.add('hidden'); return; }
  $('dpPanel').classList.remove('hidden');
  if (activeSel === 'month'){
    step.innerHTML = '<p class="dp-title">Month</p><div class="dp-grid cols4">' +
      MONTHS.map((m, i) => `<button type="button" class="dp-btn ${picked.m === i+1 ? 'sel' : ''}" data-m="${i+1}">${m}</button>`).join('') + '</div>';
  } else if (activeSel === 'day'){
    const n = picked.m ? daysIn(picked.y, picked.m) : 31;
    let btns = '';
    for (let d = 1; d <= n; d++) btns += `<button type="button" class="dp-btn ${picked.d === d ? 'sel' : ''}" data-d="${d}">${d}</button>`;
    step.innerHTML = `<p class="dp-title">Day${picked.m ? ' — ' + MONTH_FULL[picked.m-1] : ''}</p><div class="dp-grid cols7">${btns}</div>`;
  } else if (activeSel === 'year'){
    let btns = '';
    for (let y = 2026; y >= 1920; y--)
      btns += `<button type="button" class="dp-btn yr ${picked.y === y ? 'sel' : ''}" data-y="${y}">${y}</button>`;
    step.innerHTML = `<p class="dp-title">Year — scroll and tap yours</p><div class="year-scroll" id="yearScroll">${btns}</div>`;
    const target = picked.y || 2000;
    requestAnimationFrame(() => {
      const b = step.querySelector('[data-y="' + target + '"]');
      const sc = $('yearScroll');
      if (b && sc) sc.scrollTop = Math.max(0, b.offsetTop - 4);
    });
  }
}
function openSel(k){
  activeSel = (activeSel === k) ? null : k;
  $('dpErr').classList.add('hidden');
  updateSelectors();

 renderPanel();
}
function afterPick(){
  if (picked.m && picked.d && picked.d > daysIn(picked.y, picked.m)) picked.d = null;  // e.g. Feb 29 → non-leap year
  const next = [['m','month'],['d','day'],['y','year']].find(([pk]) => !picked[pk]);
  activeSel = next ? next[1] : null;
  updateSelectors(); renderPanel();
}
$('selMonth').addEventListener('click', () => openSel('month'));
$('selDay').addEventListener('click', () => openSel('day'));
$('selYear').addEventListener('click', () => openSel('year'));
$('dpStep').addEventListener('click', e => {
  const b = e.target.closest('.dp-btn'); if (!b) return;
  if (b.dataset.m) picked.m = Number(b.dataset.m);
  else if (b.dataset.d) picked.d = Number(b.dataset.d);
  else if (b.dataset.y) picked.y = Number(b.dataset.y);
  afterPick();
});

/* page dots follow the horizontal sub-pages */
[['bodyPages','bodyDots'],['planetPages','planetDots'],['spacePages','spaceDots']].forEach(([p, d]) => {
  const el = $(p); if (!el) return;
  el.addEventListener('scroll', () => {
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    $(d).querySelectorAll('.pdot').forEach((dot, j) => dot.classList.toggle('on', j === i));
  }, {passive:true});
});

/* ---------- entry / wiring ---------- */
function showStory(){
  $('entryView').classList.add('hidden');
  $('storyView').classList.remove('hidden');
  document.documentElement.classList.add('journey');
  renderStory();
  initJourney();
  document.querySelector('main').scrollTo({top:0});
}
/* Nothing persists: closing the app wipes the slate. Reopening always starts here. */
$('entryForm').addEventListener('submit', e => {
  e.preventDefault();
  const dob = dobString();
  if (!dob){
    activeSel = !picked.m ? 'month' : !picked.d ? 'day' : 'year';
    updateSelectors(); renderPanel();
    $('dpErr').classList.remove('hidden');
    return;
  }
  profile = { dob, name: $('nameInput').value.trim() };
  birth = new Date(dob + 'T12:00:00');
  showStory();
});
$('startOverBtn').addEventListener('click', () => {
  $('storyView').classList.add('hidden');
  $('entryView').classList.remove('hidden');
  document.documentElement.classList.remove('journey');
  if (ticker) clearInterval(ticker);
  picked = { m:null, d:null, y:null }; activeSel = null;
  $('nameInput').value = '';
  updateSelectors(); renderPanel();
  document.querySelector('main').scrollTo({top:0});
});
$('prevYear').addEventListener('click', () => setExplorer(exYear-1, false));
$('nextYear').addEventListener('click', () => setExplorer(exYear+1, false));
$('yearSlider').addEventListener('input', e => setExplorer(Number(e.target.value), false));
$('tabWorld').addEventListener('click', () => { exTab='world'; $('tabWorld').classList.add('active'); $('tabUS').classList.remove('active'); renderEvents(); $('eventList').scrollLeft = 0; });
$('tabUS').addEventListener('click', () => { exTab='us'; $('tabUS').classList.add('active'); $('tabWorld').classList.remove('active'); renderEvents(); $('eventList').scrollLeft = 0; });
$('posterBtn').addEventListener('click', makePoster);
$('eventList').addEventListener('click', e => {
  const el = e.target.closest('.ev-card'); if (!el) return;
  const item = currentItems[Number(el.dataset.i)]; if (!item) return;
  openDive(item.t, diveMeta(exYear), item.d);
});
const wildClick = e => {
  const el = e.target.closest('.sp-card'); if (!el) return;
  const arr = el.dataset.kind === 'found' ? currentFound : currentLost;
  const item = arr[Number(el.dataset.i)]; if (!item) return;
  openDive(item.n, diveMeta(item.y), item.d);
};
$('wildFound').addEventListener('click', wildClick);
$('wildLost').addEventListener('click', wildClick);
$('diveClose').addEventListener('click', closeDive);
$('diveBackdrop').addEventListener('click', closeDive);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDive(); });

updateSelectors();

/* ---------- installing (the MindSplit arrangement, ported 2026-10-14) ----------
   The AI Lab card's download button opens /youverse/?install=1. The sheet is
   MindSplit's: a bottom sheet half a screen tall with ONE primary button.
   It exists because dexcimino.com itself is an installed app ("dexdc",
   scope "/") on Dex's phone: a download tap inside that app's window opens
   this page INSIDE the site app, where no install prompt can fire and there
   is no browser menu — the old Inko-style sheet just showed menu steps that
   do not exist there, so installs silently went nowhere. MindSplit's sheet
   detects that window (display-mode: standalone) and says so, and it WAITS
   for the prompt: if beforeinstallprompt arrives while the sheet is open,
   the steps vanish and the button becomes Install. */
const YV_EMBED = new URLSearchParams(location.search).has('embed');
if ('serviceWorker' in navigator && !YV_EMBED){
  navigator.serviceWorker.register('/youverse/sw.js', { scope: '/youverse/', updateViaCache: 'none' }).catch(() => {});
}
let __ip = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); __ip = e; window.dispatchEvent(new Event('app:installable')); });
window.addEventListener('appinstalled', () => { __ip = null; });
function showInstallSheet(){
  if (document.getElementById('install-sheet')) return;
  const name = 'YouVerse';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const t = document.createElement('div');
  t.id = 'install-sheet';
  t.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,10,.62);z-index:10000;display:flex;align-items:flex-end;justify-content:center;';
  t.innerHTML =
    '<style>@keyframes ishUp{from{transform:translateY(60px);opacity:.4}to{transform:translateY(0);opacity:1}}</style>' +
    '<div style="width:100%;max-width:560px;height:52%;min-height:360px;background:#0e1626;color:#eef4ff;border-radius:30px 30px 0 0;padding:12px 22px calc(env(safe-area-inset-bottom,0px) + 20px);display:flex;flex-direction:column;animation:ishUp 340ms cubic-bezier(.22,1,.36,1);">' +
      '<div style="width:40px;height:6px;border-radius:99px;background:#1d2c47;margin:2px auto 16px;"></div>' +
      '<img src="icon-512.png" alt="" style="width:58px;height:58px;border-radius:50%;display:block;margin-bottom:12px;">' +
      '<h3 style="margin:0 0 6px;font-size:21px;">Install ' + name + '</h3>' +
      '<p style="margin:0 0 16px;font-size:14.5px;line-height:1.5;color:#c9d6ee;">It goes on your home screen and opens like any other app.</p>' +
      '<div data-steps style="display:flex;flex-direction:column;gap:9px;overflow-y:auto;"></div>' +
      '<div style="flex:1;"></div>' +
      '<button data-go style="width:100%;background:linear-gradient(90deg,#35e0c8,#2bb7d8);border:none;border-radius:14px;padding:16px;font-weight:800;cursor:pointer;color:#04241f;font-size:16.5px;">Got it</button>' +
    '</div>';
  const stepsBox = t.querySelector('[data-steps]');
  const goBtn = t.querySelector('[data-go]');
  function render(){
    const steps = standalone
      ? ['Open dexcimino.com in your browser instead of the site\u2019s app', 'Remove the dexcimino.com app first, then install ' + name, 'Add the site\u2019s app back afterwards']
      : __ip ? null
      : ios ? ['Tap the Share button in Safari', 'Tap Add to Home Screen']
      : ['Open the browser menu (\u22ee)', 'Tap Install app or Add to Home screen'];
    stepsBox.innerHTML = steps ? steps.map((s, i) =>
      '<div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.05);border-radius:14px;padding:11px 13px;">' +
      '<span style="width:27px;height:27px;flex:none;border-radius:50%;background:linear-gradient(90deg,#35e0c8,#2bb7d8);color:#04241f;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13.5px;">' + (i + 1) + '</span>' +
      '<span style="font-size:14.5px;line-height:1.45;">' + s + '</span></div>').join('') : '';
    goBtn.textContent = (__ip && !standalone) ? 'Install' : 'Got it';
  }
  render();
  window.addEventListener('app:installable', render);
  goBtn.onclick = async () => {
    window.removeEventListener('app:installable', render);
    if (__ip && !standalone){ __ip.prompt(); try { await __ip.userChoice; } catch (e) {} __ip = null; }
    t.remove();
  };
  t.onclick = e => { if (e.target === t){ window.removeEventListener('app:installable', render); t.remove(); } };
  document.body.appendChild(t);
}
if (!YV_EMBED && new URLSearchParams(location.search).has('install')){
  window.history.replaceState(null, '', location.pathname + location.hash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showInstallSheet);
  else showInstallSheet();
}
