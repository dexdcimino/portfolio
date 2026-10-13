'use strict';
const media = require('../../lib/music-media.js');
const { parse } = require('../../lib/music-embeds.js');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'GET only' }); }
  if (parse(req.query?.url)?.p !== 'Instagram') return res.status(400).json({ error: 'use a public Instagram video link' });
  try { return res.status(200).json(await media.resolve(req.query.url)); }
  catch { return res.status(422).json({ error: 'Instagram did not provide this public video' }); }
};
