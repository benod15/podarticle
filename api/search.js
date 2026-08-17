// api/search.js — GET /api/search?q=... → YouTube video results via Supadata.
// Powers the homepage search box so readers can find an episode without
// leaving the site to grab a link. Long videos only: PodArticle maps podcasts,
// and anything under 20 minutes is noise for that job.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  const q = String(req.query?.q || '').trim();
  if (!q || q.length < 2) {
    return res.status(422).json({ error: 'Query too short', code: 'BAD_QUERY' });
  }

  const supadataKey = process.env.SUPADATA_API_KEY;
  if (!supadataKey) {
    console.error('search: missing SUPADATA_API_KEY');
    return res.status(503).json({ error: 'Search unavailable', code: 'UNAVAILABLE' });
  }

  try {
    const url = `https://api.supadata.ai/v1/youtube/search?query=${encodeURIComponent(q)}&type=video&duration=long&sortBy=relevance`;
    const r = await fetch(url, { headers: { 'x-api-key': supadataKey } });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('search: upstream failed', r.status, body.slice(0, 200));
      return res.status(502).json({ error: 'Search failed', code: 'SEARCH_FAILED' });
    }
    const data = await r.json();
    const results = (data.results || [])
      .filter((v) => v.type === 'video' && v.id)
      .slice(0, 8)
      .map((v) => ({
        video_id: v.id,
        title: v.title || '',
        channel: v.channel?.name || '',
        channel_id: v.channel?.id || null,
        duration_sec: v.duration || null,
        uploaded: v.uploadDate || null,
        thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      }));
    return res.status(200).json({ results });
  } catch (err) {
    console.error('search failed', err);
    return res.status(500).json({ error: 'Search failed', code: 'SEARCH_FAILED' });
  }
}
