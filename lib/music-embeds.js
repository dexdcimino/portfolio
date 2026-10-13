/* Shared URL allowlist. Never execute pasted embed HTML or frame arbitrary sites. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MusicEmbeds = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parse(input, depth = 0) {
    if (depth > 2) return null;
    let value = String(input || '').trim();
    if (value.length > 12000) return null;
    // Instagram's blockquote permalink takes priority over its embed.js script.
    if (value.startsWith('<')) {
      const match = value.match(/data-instgrm-permalink\s*=\s*["']([^"']+)["']/i)
        || value.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
      if (!match) return null;
      value = match[1].replace(/&amp;/g, '&');
    }
    if (/^[\w-]{11}$/.test(value)) return youtube(value);
    let url;
    try { url = new URL(/^[a-z]+:/i.test(value) ? value : 'https://' + value); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    let match;
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const id = host === 'youtu.be' ? url.pathname.split('/')[1]
        : url.searchParams.get('v') || (url.pathname.match(/^\/(?:embed|shorts|v|live)\/([\w-]+)/) || [])[1];
      return /^[\w-]{11}$/.test(id || '') ? youtube(id) : null;
    }
    if (host === 'instagram.com' && (match = url.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]{5,64})(?:\/(?:embed(?:\/captioned)?)?)?\/?$/))) {
      // A Reel's embed code can use /p/ for the same shortcode. One identity
      // prevents adding that same video twice via its link and its embed code.
      return result('Instagram', `https://www.instagram.com/p/${match[2]}/`, `https://www.instagram.com/p/${match[2]}/embed/`);
    }
    if ((host === 'vimeo.com' || host === 'player.vimeo.com') && (match = url.pathname.match(/^\/(?:video\/)?(\d{5,12})(?:\/([a-f\d]+))?\/?$/))) {
      const hash = match[2] || url.searchParams.get('h');
      if (hash && !/^[a-f\d]{6,64}$/.test(hash)) return null;
      const suffix = hash ? '?h=' + hash : '';
      return result('Vimeo', `https://vimeo.com/${match[1]}${hash ? '/' + hash : ''}`, `https://player.vimeo.com/video/${match[1]}${suffix}`);
    }
    if (host === 'w.soundcloud.com' && url.pathname === '/player/') return parse(url.searchParams.get('url'), depth + 1);
    if ((host === 'soundcloud.com' && /^\/[\w-]+\/(?:sets\/)?[\w-]+\/?$/.test(url.pathname))
      || (host === 'api.soundcloud.com' && /^\/(tracks|playlists)\/\d+\/?$/.test(url.pathname))) {
      const u = 'https://' + host + url.pathname.replace(/\/$/, '');
      return result('SoundCloud', u, 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(u) + '&auto_play=false');
    }
    if (host === 'open.spotify.com' && (match = url.pathname.match(/^\/(?:intl-[a-z]+\/)?(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z\d]{22})\/?$/))) {
      return result('Spotify', `https://open.spotify.com/${match[1]}/${match[2]}`, `https://open.spotify.com/embed/${match[1]}/${match[2]}`);
    }
    if (host === 'tiktok.com' && (match = url.pathname.match(/^\/(?:@[\w.-]+\/video|player\/v1|embed\/v2)\/(\d{10,25})\/?$/))) {
      const u = `https://www.tiktok.com/player/v1/${match[1]}`;
      return result('TikTok', u, u);
    }
    if (host === 'bandcamp.com' && url.pathname.startsWith('/EmbeddedPlayer/')) {
      const album = (url.pathname.match(/\/album=(\d+)\//) || [])[1];
      const track = (url.pathname.match(/\/track=(\d+)\//) || [])[1];
      if (!album && !track) return null;
      const u = 'https://bandcamp.com/EmbeddedPlayer/' + (album ? `album=${album}/` : '') + (track ? `track=${track}/` : '') + 'size=large/bgcol=ffffff/linkcol=0687f5/tracklist=false/';
      return result('Bandcamp', u, u);
    }
    return null;
  }
  function youtube(v) { return { p: 'YouTube', v, u: `https://www.youtube.com/watch?v=${v}` }; }
  function result(p, u, e) { return { p, u, e, v: u }; }
  return { parse };
});
