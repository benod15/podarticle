// api/sitemap.js — GET /api/sitemap.xml: regenerated on request from the library
import { listEpisodes } from '../lib/db.js';

const BASE = 'https://podarticle.com';

export default async function handler(req, res) {
  const episodes = await listEpisodes({ limit: 5000 });

  const urls = [
    { loc: `${BASE}/`, priority: '1.0' },
    { loc: `${BASE}/pricing.html`, priority: '0.6' },
    ...episodes.map((e) => ({
      loc: `${BASE}/episodes/${e.slug}`,
      lastmod: (e.created_at || '').slice(0, 10),
      priority: '0.8',
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).send(xml);
}
