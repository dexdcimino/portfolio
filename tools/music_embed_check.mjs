/* URL normalization and storage safety for music embeds. No provider network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse } = require('../lib/music-embeds.js');
const store = require('../lib/music-store.js');
let checks = 0;
const ok = (value) => { assert.ok(value); checks++; };
const cases = [
  ['https://youtu.be/6KkryIC0DEk?si=tracking', 'YouTube'],
  ['https://www.youtube.com/shorts/6KkryIC0DEk', 'YouTube'],
  ['https://www.instagram.com/reel/DI4qDiEyZpU/?igsh=tracking', 'Instagram'],
  ['https://instagram.com/reels/DI4qDiEyZpU/', 'Instagram'],
  ['https://www.instagram.com/p/DI4qDiEyZpU/embed/', 'Instagram'],
  ['https://instagram.com/tv/DI4qDiEyZpU/', 'Instagram'],
  ['<blockquote data-instgrm-permalink="https://www.instagram.com/reel/DI4qDiEyZpU/?igsh=abc"></blockquote><script src="https://www.instagram.com/embed.js"></script>', 'Instagram'],
  ['https://vimeo.com/76979871', 'Vimeo'],
  ['https://player.vimeo.com/video/76979871?h=abcdef1234', 'Vimeo'],
  ['https://soundcloud.com/artist/song', 'SoundCloud'],
  ['https://soundcloud.com/artist/sets/album', 'SoundCloud'],
  ['<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&amp;auto_play=true"></iframe>', 'SoundCloud'],
  ['https://open.spotify.com/track/0Lr4kGOYn9l83EjuK6cZFQ?si=tracking', 'Spotify'],
  ['https://open.spotify.com/embed/album/0Lr4kGOYn9l83EjuK6cZFQ', 'Spotify'],
  ['https://www.tiktok.com/@scout2015/video/6718335390845095173', 'TikTok'],
  ['https://www.tiktok.com/player/v1/6718335390845095173', 'TikTok'],
  ['<iframe src="https://bandcamp.com/EmbeddedPlayer/album=3142231699/size=large/"></iframe>', 'Bandcamp'],
];
for (const [url, provider] of cases) {
  const source = parse(url);
  ok(source?.p === provider);
  const track = store.cleanTrack({ v: url, t: 'Song', a: 'Artist', e: 'https://evil.test/' });
  ok(track && track.v === source.v && track.u === source.u && track.e === source.e);
  ok(JSON.stringify(store.cleanTrack(JSON.parse(JSON.stringify(track)))) === JSON.stringify(track));
}
for (const url of [
  'javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd',
  'https://instagram.com.evil.test/reel/DI4qDiEyZpU/',
  'https://evil.test/?url=https://www.instagram.com/reel/DI4qDiEyZpU/',
  'https://user:password@www.instagram.com/reel/DI4qDiEyZpU/',
  'https://www.instagram.com:444/reel/DI4qDiEyZpU/',
  'https://instagram.com/accounts/login/', 'https://instagram.com/username/',
  'https://youtube.com/playlist?list=abc', 'https://vimeo.com/manage/videos/12345678',
  '<iframe src="https://evil.test/"></iframe>', '<script>alert(1)</script>',
  'https://bandcamp.com/EmbeddedPlayer/anything/', 'https://w.soundcloud.com/player/?url=https://evil.test/',
]) ok(parse(url) === null);
const a = store.cleanTrack({ v: cases[2][0], t: 'First', a: 'Artist' });
const b = store.cleanTrack({ v: cases[3][0], t: 'Duplicate', a: 'Artist' });
ok(store.cleanList([a, b]).length === 1);
ok(store.cleanList([a, store.cleanTrack({ v: cases[4][0], t: 'Duplicate post', a: 'Artist' })]).length === 1);
ok(!a.v.includes('igsh'));
console.log(`music_embed_check: ${checks} checks passed`);
