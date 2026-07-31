// api/episodes.js — GET library index (for the Episode library section w/ sort + search)
//
// Hybrid library: `episodes` is the curated public seed everyone sees, and `mine` is the
// signed-in reader's own analyses. A missing or invalid token is not an error here —
// browsing the curated library never requires an account.
import { listEpisodes, listUserEpisodes, getEpisodeBySlug } from '../lib/db.js';
import { getUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  const { slug } = req.query || {};

  if (slug) {
    const ep = await getEpisodeBySlug(String(slug));
    if (!ep) return res.status(404).json({ error: 'Episode not found', code: 'NOT_FOUND' });
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

  const toCard = (e) => ({
    video_id: e.video_id,
    slug: e.slug,
    title: e.title,
    show_name: e.show_name,
    published_at: e.published_at,
    duration_sec: e.duration_sec,
    summary: e.analysis || '',
    created_at: e.created_at,
  });

  const { user } = req.headers.authorization ? await getUser(req) : {};
  const [episodes, mine] = await Promise.all([
    listEpisodes(),
    user ? listUserEpisodes(user.id) : Promise.resolve([]),
  ]);

  return res.status(200).json({
    episodes: episodes.map(toCard),
    mine: mine.map(toCard),
  });
}
