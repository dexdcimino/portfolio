/* Public-media resolver: JSON-only parsing, CDN allowlist and bounded upstream reads. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const media = require('../lib/music-media.js');
const handler = require('../api/music/media.js');
let checks = 0;
const check = (a, b) => { assert.deepEqual(a, b); checks++; };
const url = 'https://scontent-den2-1.cdninstagram.com/video.mp4?token=public';
const doc = { shortcode_media: { video_url: url } };
check(media.extract(JSON.stringify(doc)), { url });
check(media.extract('requireLazy(function(){s.handle({"data":' + JSON.stringify(JSON.stringify(doc)) + '})});'), { url });
check(media.extract('<script>alert("video_url")</script>'), null);
for (const bad of ['http://test.cdninstagram.com/a', 'https://cdninstagram.com.evil.com/a', 'https://evil.com/a', 'https://localhost/a', 'https://name@test.cdninstagram.com/a', 'https://test.cdninstagram.com:8080/a', 'javascript:alert(1)']) {
  check(media.extract(JSON.stringify({ video_url: bad })), null);
}
let upstream = 0;
const oldFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  upstream++;
  check(input, 'https://www.instagram.com/p/DI4qDiEyZpU/embed/');
  check(options.redirect, 'error');
  return new Response(JSON.stringify(JSON.stringify(doc)));
};
try {
  check(await media.resolve('https://www.instagram.com/reel/DI4qDiEyZpU/?igsh=tracking'), { url });
  await assert.rejects(media.resolve('https://localhost/private')); checks++;
  check(upstream, 1);
  globalThis.fetch = async () => new Response('', { status: 403 });
  await assert.rejects(media.resolve('https://www.instagram.com/p/DI4qDiEyZpU/')); checks++;
  globalThis.fetch = async () => new Response('x'.repeat(2_000_001));
  await assert.rejects(media.resolve('https://www.instagram.com/p/DI4qDiEyZpU/')); checks++;
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method: 'GET', query: { url: 'http://localhost/private' } }, response);
  check(response.code, 400);
  await handler({ method: 'POST' }, response); check(response.code, 405);
  await handler({ method: 'GET', query: { url: 'https://www.instagram.com/p/DI4qDiEyZpU/' } }, response); check(response.code, 422);
} finally { globalThis.fetch = oldFetch; }
console.log(`music_media_check: ${checks} checks passed`);
