// api/analyze.js — POST {url} → full episode analysis
// Stages (frontend mirrors these for the progress wheel):
//   1. metadata   — finding the episode
//   2. transcript — pulling the caption track (Supadata)
//   3. analysis   — mapping sections (Gemini)
//   4. save       — publishing to the library (Supabase)
import { extractVideoId, fetchMetadata, parseChapters, fetchTranscript, transcriptToLines, TranscriptUnavailable } from '../lib/youtube.js';
import { analyzeWithGemini } from '../lib/gemini.js';
import { getEpisodeByVideoId, saveEpisode, slugify } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(422).json({ error: 'Not a valid YouTube URL' });
  }

  // Library hit → instant return
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
