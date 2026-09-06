/* Ask YouTube, in a real browser, whether every track in tracklist.txt still plays.
 *
 *   node tools/music_probe.mjs                 # probe every track, print a report
 *   node tools/music_probe.mjs --ids A,B,C     # probe a handful by video id
 *   node tools/music_probe.mjs --json <path>   # also write the verdicts as JSON
 *   node tools/music_probe.mjs --cases         # prove verdict() still refuses
 *
 * Exit 0 only when every track probed came back playable.
 *
 * WHY A BROWSER AND NOT A FETCH. Three cheaper checks were tried first and all
 * three lie about the thing that actually bit us:
 *
 *   - oEmbed (`/oembed?url=...`) answers 200 for a video that exists. The
 *     Bohemian Rhapsody link that stopped the playlist answered 200 with the
 *     right title on it. It exists; it just refuses to play in an embed.
 *   - The InnerTube player endpoint answers ERROR 152 for every id when it is
 *     called from a script with no browser behind it, so it cannot tell a dead
 *     video from a live one.
 *   - `GET /embed/<id>` no longer inlines a playerResponse at all, so there is
 *     nothing left in that HTML to read.
 *
 * The only honest answer comes from the player itself: a real Chrome, a real
 * embed, and the same onError the overlay now listens for.
 *
 * WHY THE HARNESS IS SERVED OVER HTTPS, WHICH IS THE WHOLE REASON THIS FILE IS
 * LONGER THAN IT LOOKS. Every other harness in tools/ serves the repo over
 * plain http on 127.0.0.1, and a probe built that way REPORTS EVERY MUSIC VIDEO
 * AS BLOCKED. Measured, not guessed: over `http://127.0.0.1:<port>` the Rick
 * Astley video, Queen's own official upload and 25 To Life all came back 150,
 * and so did a garbage id -- one verdict for everything, which is a checker
 * that has stopped checking. Serve the identical harness over `https://` and
 * the same three play while the garbage id still fails. YouTube will not hand
 * rights-managed video to an insecure origin, and the site this probes is
 * https. So the harness mints a throwaway self-signed cert and Chrome is told
 * to ignore it. Do not "simplify" this back to http -- it fails clean.
 *
 * WHY THE HANDSHAKE IS BY HAND rather than via the IFrame API script: it is the
 * same protocol script.js speaks, so what this measures is what the overlay
 * will do, not what a different loader would do.
 *
 * COUNT THE SUBJECT: tracks read, probed and decided are printed and asserted
 * against each other, because a probe whose subject went empty prints exactly
 * what a clean run prints. See CLAUDE.md.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:https';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE = resolve(ROOT, 'tracklist.txt');

/* How many embeds are alive at once. Each is a real player fetching real video,
   so this is a bandwidth number as much as a speed one; six finishes 311 tracks
   in a few minutes without YouTube starting to throttle. */
const LANES = 6;
/* A player that has said nothing in this long is reported as SILENT rather than
   guessed at either way. Twenty seconds is several times the slowest first
   state this has been seen to take on a cold cache. */
const PATIENCE = 20000;

/* The player's own error codes. Anything not here is reported by number rather
   than swallowed, so a code YouTube adds later shows up as a code.

   150 IS NOT ONLY "EMBEDDING DISABLED", whatever the published table says: a
   video id that does not exist at all comes back 150 from this embed too, so
   the wording below says both rather than picking the flattering one. */
const CODES = {
  2:   ['BAD_ID',   'the id is malformed -- YouTube will not accept it'],
  5:   ['HTML5',    'the HTML5 player cannot play it'],
  100: ['GONE',     'removed, private, or never existed'],
  101: ['NO_EMBED', 'the owner blocks embedding, or the video is gone'],
  150: ['NO_EMBED', 'the owner blocks embedding, or the video is gone'],
};

/* The whole decision, as a pure function, so the report and --cases cannot
   drift apart. `signal` is what the page observed: an error code, 'ready' once
   the player reported a real playing state, or null if it never spoke. */
export function verdict(signal) {
  if (signal === 'ready') return { ok: true, kind: 'OK', why: 'plays in an embed' };
  if (signal === null || signal === undefined) {
    return { ok: false, kind: 'SILENT', why: 'the player never reported anything' };
  }
  const known = CODES[signal];
  if (known) return { ok: false, kind: known[0], why: known[1] };
  return { ok: false, kind: 'CODE_' + signal, why: 'an error code this tool does not know' };
}

function readTracks() {
  const out = [];
  for (const raw of readFileSync(SOURCE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const id = parts[2].match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|\/embed\/([A-Za-z0-9_-]{11})/);
    if (!id) continue;
    out.push({ t: parts[0].trim(), a: parts[1].trim(), v: id[1] || id[2] || id[3] });
  }
  return out;
}

function cases() {
  const table = [
    ['a ready player',         'ready', true,  'OK'],
    ['embedding refused 101',   101,    false, 'NO_EMBED'],
    ['embedding refused 150',   150,    false, 'NO_EMBED'],
    ['removed or private',      100,    false, 'GONE'],
    ['a malformed id',            2,    false, 'BAD_ID'],
    ['an HTML5 failure',          5,    false, 'HTML5'],
    ['a code from the future',   77,    false, 'CODE_77'],
    ['NOTHING AT ALL',         null,    false, 'SILENT'],
  ];
  let bad = 0;
  for (const [name, signal, wantOk, wantKind] of table) {
    const got = verdict(signal);
    const agreed = got.ok === wantOk && got.kind === wantKind;
    bad += agreed ? 0 : 1;
    console.log('  ' + (agreed ? 'ok  ' : 'WRONG') + ' ' + name.padEnd(26) + ' -> ' + got.kind);
  }
  const refusing = table.filter(r => !r[2]).length;
  if (table.length < 8 || refusing < 6) {
    console.error('music_probe --cases: only ' + table.length + ' case(s), ' + refusing
                  + ' of them refusing -- the table has been gutted');
    return 1;
  }
  // ...and one control on the real subject, or the whole table could be passing
  // against a reader that no longer finds a single track.
  const live = existsSync(SOURCE) ? readTracks() : [];
  if (live.length < 100) {
    console.error('music_probe --cases: the live tracklist read as ' + live.length
                  + ' track(s) -- the real subject is not being found');
    return 1;
  }
  console.log('music_probe --cases: ' + (table.length - bad) + ' of ' + table.length
              + ' as expected (' + refusing + ' of them refusing); '
              + 'live tracklist reads ' + live.length + ' tracks');
  return bad ? 1 : 0;
}

/* ---- the probe -------------------------------------------------------- */

const HARNESS = [
  '<!doctype html><meta charset="utf-8"><title>music probe</title><body>',
  '<script>',
  'window.__probe = function (id) {',
  '  return new Promise(function (done) {',
  '    var ORIGIN = "https://www.youtube-nocookie.com";',
  '    var f = document.createElement("iframe");',
  '    f.width = 400; f.height = 240;',
  '    f.allow = "autoplay; encrypted-media";',
  '    var p = new URLSearchParams({ enablejsapi: "1", autoplay: "1", mute: "1",',
  '                                  rel: "0", playsinline: "1", origin: location.origin });',
  '    f.src = ORIGIN + "/embed/" + encodeURIComponent(id) + "?" + p;',
  '    var settled = false;',
  '    function finish(s) {',
  '      if (settled) return;',
  '      settled = true;',
  '      window.removeEventListener("message", onMsg);',
  '      clearTimeout(timer);',
  '      f.remove();',
  '      done(s);',
  '    }',
  '    function onMsg(e) {',
  '      if (e.origin !== ORIGIN || e.source !== f.contentWindow) return;',
  '      var d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; }',
  '      catch (x) { return; }',
  '      if (!d) return;',
  '      if (d.event === "onError") { finish(d.info); return; }',
  //     onReady is NOT enough: the player reports ready before it has asked
  //     YouTube whether it may play this id, so a blocked video says ready and
  //     THEN errors. Only a real playing or buffering state settles it.
  '      var st = typeof d.info === "number" ? d.info',
  '        : (d.info && typeof d.info.playerState === "number" ? d.info.playerState : null);',
  '      if (st === 1 || st === 3) finish("ready");',
  '    }',
  '    window.addEventListener("message", onMsg);',
  '    f.addEventListener("load", function () {',
  '      f.contentWindow.postMessage(',
  '        JSON.stringify({ event: "listening", id: 1, channel: "widget" }), ORIGIN);',
  '    });',
  '    var timer = setTimeout(function () { finish(null); }, ' + PATIENCE + ');',
  '    document.body.appendChild(f);',
  '  });',
  '};',
  '<\/script></body>',
].join('\n');

async function probe(tracks, json) {
  const CHROME = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(p => p && existsSync(p));
  if (!CHROME) throw new Error('no Chrome or Edge found -- set CHROME=<path to the exe>');

  // See the header: https is not a nicety here, it is the difference between a
  // probe and a rubber stamp. The cert is thrown away with the temp dir.
  const dir = mkdtempSync(join(tmpdir(), 'music-probe-'));
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  } catch {
    throw new Error('openssl is needed to mint the throwaway https cert '
                    + '(it ships with Git for Windows) -- see the header for why http will not do');
  }

  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HARNESS);
    });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'https://localhost:' + server.address().port + '/';

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--mute-audio',
           '--autoplay-policy=no-user-gesture-required',
           '--ignore-certificate-errors',
           /* Without this the embed answers 150 for EVERY id, good ones
              included -- YouTube will not play rights-managed video to a
              browser that announces itself as automated. */
           '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const lanes = [];
  for (let i = 0; i < LANES; i++) {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    // Before navigating, always: a headless Chrome on a throwaway profile still
    // writes to the REAL Downloads folder otherwise.
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    lanes.push(page);
  }

  const results = [];
  let next = 0, done = 0;
  await Promise.all(lanes.map(async (page) => {
    for (;;) {
      const i = next++;
      if (i >= tracks.length) return;
      const track = tracks[i];
      let signal = null;
      try { signal = await page.evaluate(id => window.__probe(id), track.v); }
      catch { signal = null; }
      const v = verdict(signal);
      results[i] = Object.assign({}, track, { signal }, v);
      done++;
      if (!v.ok) {
        console.log('  ' + v.kind.padEnd(9) + ' ' + track.t + ' -- ' + track.a
                    + '  (' + track.v + ')');
      }
      if (done % 25 === 0) process.stderr.write('  ...' + done + '/' + tracks.length + '\n');
    }
  }));

  await browser.close();
  server.close();

  const decided = results.filter(Boolean);
  const broken = decided.filter(r => !r.ok);
  if (json) {
    writeFileSync(json, JSON.stringify({ probed: decided.length, broken: broken.length,
                                         results: decided }, null, 1) + '\n', 'utf8');
    console.log('  wrote ' + json);
  }

  console.log('\nmusic_probe: ' + tracks.length + ' track(s) read, ' + decided.length
              + ' probed, ' + (decided.length - broken.length) + ' playable, '
              + broken.length + ' not');
  // An empty or short subject is a BROKEN probe, never a clean one.
  if (!tracks.length) {
    console.error('music_probe: no tracks read at all -- the tracklist stopped parsing');
    return 1;
  }
  if (decided.length !== tracks.length) {
    console.error('music_probe: ' + (tracks.length - decided.length)
                  + ' track(s) were never decided -- the probe is broken');
    return 1;
  }
  return broken.length ? 1 : 0;
}

const argv = process.argv.slice(2);
if (argv[0] === '--cases') process.exit(cases());

const idsAt = argv.indexOf('--ids');
const jsonAt = argv.indexOf('--json');
const json = jsonAt >= 0 ? argv[jsonAt + 1] : null;
const tracks = idsAt >= 0
  ? argv[idsAt + 1].split(',').map(v => ({ t: v, a: '(by id)', v }))
  : readTracks();
console.log('music_probe: ' + tracks.length + ' track(s) to probe, ' + LANES + ' at a time');
process.exit(await probe(tracks, json));
