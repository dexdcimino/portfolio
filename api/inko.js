export default async function handler(req, res) {
  try {
    const response = await fetch('https://inko.dexcimino.com/');
    const html = await response.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(html);
  } catch (e) {
    res.status(500).send('Failed to load Inko');
  }
}
