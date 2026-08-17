// api/og-image.js — GET /api/og-image?vid=<id> → the episode's YouTube
// thumbnail, re-served from podarticle.com.
//
// Why not link i.ytimg.com directly in og:image? We did — and X's image proxy
// intermittently fails to fetch it (cold-start races, crawler rate limits),
// which leaves a broken grey card that X caches against the URL for days.
// Serving the image from our own domain makes the card fetch as reliable as
// the page fetch. Also the future home of branded/OG-art cards (Phase D).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  const vid = String(req.query?.vid || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) {
    return res.status(422).json({ error: 'Bad video id', code: 'BAD_QUERY' });
  }

  // Prefer maxres (1280x720 — the size summary_large_image is designed for);
  // fall back to hqdefault, which exists for every upload.
  const candidates = [
    `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(buf.length));
      // Cards change never; let X's proxy and the CDN hold it.
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
      return res.status(200).send(buf);
    } catch {
      // try the next candidate
    }
  }

  return res.status(502).json({ error: 'Thumbnail unavailable', code: 'UNAVAILABLE' });
}
