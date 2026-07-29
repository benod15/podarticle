// api/analyze.js — POST {url} → full episode analysis
// Stages (frontend mirrors these for the progress wheel):
//   1. metadata   — finding the episode
//   2. transcript — pulling the caption track (Supadata)
//   3. analysis   — mapping sections (Gemini)
//   4. save       — publishing to the library (Supabase)
import { extractVideoId, fetchMetadata, parseChapters, fetchTranscript, transcriptToLines, TranscriptUnavailable } from '../lib/youtube.js';
import { analyzeWithGemini } from '../lib/gemini.js';
import { getEpisodeByVideoId, saveEpisode, slugify } from '../lib/db.js';
import { getUser, checkAllowance, recordUsage, FREE_LIMIT } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(422).json({ error: 'Not a valid YouTube URL' });
  }

  // Auth — analyzing requires a signed-in user
  const { user, error: authError, status: authStatus } = await getUser(req);
  if (authError) {
    return res.status(authStatus).json({ error: authError, code: 'AUTH_REQUIRED' });
  }

  // Library hit → instant return (doesn't consume free credits)
  const cached = await getEpisodeByVideoId(videoId);
  if (cached) {
    return res.status(200).json({
      video_id: videoId,
      slug: cached.slug,
      metadata: {
        title: cached.title,
        author: cached.show_name,
        publishedAt: cached.published_at,
        durationSec: cached.duration_sec,
      },
      chapters_found: cached.analysis?.chapters?.length || 0,
      transcript_lines: cached.transcript_lines,
      analysis: cached.analysis,
      cached: true,
    });
  }

  const supadataKey = process.env.SUPADATA_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!supadataKey || !geminiKey) {
    return res.status(500).json({ error: 'Server not configured (missing API keys)' });
  }

  // Free-5 gate — new analyses only
  const allowance = await checkAllowance(user.id);
  if (!allowance.allowed) {
    return res.status(402).json({
      error: `You've used your ${FREE_LIMIT} free podarticles. Subscribe for unlimited episode maps.`,
      code: 'LIMIT_REACHED',
      upgrade_url: '/pricing.html',
    });
  }

  try {
    const metadata = await fetchMetadata(videoId, supadataKey);
    const chapters = parseChapters(metadata.description);

    const segments = await fetchTranscript(videoId, supadataKey);
    const transcriptLines = transcriptToLines(segments);

    const analysis = await analyzeWithGemini({
      title: metadata.title,
      author: metadata.author,
      chapters,
      transcriptLines,
      apiKey: geminiKey,
    });

    // Count this analysis against the free allowance
    await recordUsage(user.id, videoId);

    // Publish to the library
    let slug = slugify(metadata.title);
    const saved = await saveEpisode({
      videoId,
      slug,
      title: metadata.title,
      showName: metadata.author,
      publishedAt: metadata.publishedAt,
      durationSec: metadata.durationSec || null,
      transcriptLines: transcriptLines.length,
      analysis,
    });
    if (saved?.slug) slug = saved.slug;

    return res.status(200).json({
      video_id: videoId,
      slug,
      metadata: {
        title: metadata.title,
        author: metadata.author,
        publishedAt: metadata.publishedAt,
        durationSec: metadata.durationSec,
        thumbnail: metadata.thumbnail,
      },
      chapters_found: chapters.length,
      transcript_lines: transcriptLines.length,
      analysis,
      cached: false,
    });
  } catch (err) {
    if (err instanceof TranscriptUnavailable || err.code === 'NO_TRANSCRIPT') {
      return res.status(422).json({ error: err.message, code: 'NO_TRANSCRIPT' });
    }
    console.error('analyze failed', err);
    return res.status(err.status || 500).json({ error: err.message || 'Analysis failed' });
  }
}
