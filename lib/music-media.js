'use strict';

// Only public Instagram embed pages; no credentials, arbitrary fetches or stored CDN URLs.
const { parse } = require('./music-embeds.js');
function mediaURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && /\.(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname) ? u.href : null;
  } catch { return null; }
}
function extract(html) {
  function visit(value, depth = 0) {
    if (depth > 20 || !value) return null;
    if (typeof value === 'string') {
      if (!value.includes('video_url')) return null;
      try { return visit(JSON.parse(value), depth + 1); } catch { return null; }
    }
    if (typeof value !== 'object') return null;
    const url = mediaURL(value.video_url);
    if (url) return { url };
    for (const child of Object.values(value)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  // Instagram currently nests the media document in a quoted JSON string in ServerJS.
  // Decode JSON only: never execute the provider's scripts.
  for (const match of html.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    if (!match[0].includes('video_url')) continue;
    try {
      const found = visit(JSON.parse(match[0]));
      if (found) return found;
    } catch { /* another quoted token */ }
  }
  for (const match of html.matchAll(/"video_url"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    try { const url = mediaURL(JSON.parse(match[1])); if (url) return { url }; } catch {}
  }
  return null;
}
async function resolve(input) {
  const source = parse(input);
  if (source?.p !== 'Instagram') throw new Error('use a public Instagram video link');
  const response = await fetch(source.e, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Instagram did not provide this public video');
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('Instagram response is too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  const result = extract(Buffer.concat(chunks).toString('utf8'));
  if (!result) throw new Error('Instagram did not provide this public video');
  return result;
}
module.exports = { extract, resolve, mediaURL };
