// api/channel-videos.js — GET /api/channel-videos?id=<channelId> → a channel's
// recent long-form videos, so readers can browse "more from this show" after a
// search. Channel listing returns bare IDs; we enrich the first 10 with metadata
// (1 credit each) and return them newest-first.
// Metadata dates are ISO; the frontend displays `uploaded` verbatim, so format
// here ("Aug 14, 2026") — relative strings from the search API pass through as-is.
function formatWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  const id = String(req.query?.id || '').trim();
  if (!id) {
    return res.status(422).json({ error: 'Missing channel id', code: 'BAD_QUERY' });
  }

  const supadataKey = process.env.SUPADATA_API_KEY;
  if (!supadataKey) {
    console.error('channel-videos: missing SUPADATA_API_KEY');
    return res.status(503).json({ error: 'Search unavailable', code: 'UNAVAILABLE' });
  }

  const headers = { 'x-api-key': supadataKey };
  try {
    const listUrl = `https://api.supadata.ai/v1/youtube/channel/videos?id=${encodeURIComponent(id)}&type=video&limit=10`;
    const lr = await fetch(listUrl, { headers });
    if (!lr.ok) {
      console.error('channel-videos: list failed', lr.status);
      return res.status(502).json({ error: 'Channel lookup failed', code: 'SEARCH_FAILED' });
    }
    const list = await lr.json();
    const ids = (list.videoIds || []).slice(0, 10);

    // Enrich in parallel; a video that fails metadata just drops out.
    const enriched = await Promise.all(
      ids.map(async (vid) => {
        try {
          const r = await fetch(`https://api.supadata.ai/v1/youtube/video?id=${vid}`, { headers });
          if (!r.ok) return null;
          const d = await r.json();
          const durationSec = d.duration ? Math.round(d.duration) : null;
          if (durationSec && durationSec < 1200) return null; // podcasts are long-form
          return {
            video_id: vid,
            title: d.title || '',
            channel: d.channel?.name || '',
            channel_id: d.channel?.id || id,
            duration_sec: durationSec,
            uploaded: formatWhen(d.uploadDate || d.publishedAt),
            thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          };
        } catch {
          return null;
        }
      })
    );

    const results = enriched.filter(Boolean);
    const channel = results[0]?.channel || '';
    return res.status(200).json({ channel, results });
  } catch (err) {
    console.error('channel-videos failed', err);
    return res.status(500).json({ error: 'Channel lookup failed', code: 'SEARCH_FAILED' });
  }
}
