// api/episodes.js — GET library index (for the Episode library section w/ sort + search)
import { listEpisodes, getEpisodeBySlug } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query || {};

  if (slug) {
    const ep = await getEpisodeBySlug(String(slug));
    if (!ep) return res.status(404).json({ error: 'Episode not found' });
    return res.status(200).json({
      video_id: ep.video_id,
      slug: ep.slug,
      metadata: {
        title: ep.title,
        author: ep.show_name,
        publishedAt: ep.published_at,
        durationSec: ep.duration_sec,
      },
      transcript_lines: ep.transcript_lines,
      analysis: ep.analysis,
    });
  }

  const episodes = await listEpisodes();
  return res.status(200).json({
    episodes: episodes.map((e) => ({
      video_id: e.video_id,
      slug: e.slug,
      title: e.title,
      show_name: e.show_name,
      published_at: e.published_at,
      duration_sec: e.duration_sec,
      summary: e.analysis || '',
      created_at: e.created_at,
    })),
  });
}
