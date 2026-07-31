// api/analyze.js — POST {url} → full episode analysis
// Stages (frontend mirrors these for the progress wheel):
//   1. metadata   — finding the episode
//   2. transcript — pulling the caption track (Supadata)
//   3. analysis   — mapping sections (Gemini)
//   4. save       — publishing to the library (Supabase)
//
// Failure responses always carry a `code`. That code is the contract the client branches
// on; the reader-facing sentence for it lives in public/messages.js. The `error` field
// beside it is a short diagnostic label for logs and is never rendered.
import { extractVideoId, fetchMetadata, parseChapters, fetchTranscript, transcriptToLines, TranscriptUnavailable } from '../lib/youtube.js';
import { analyzeWithGemini } from '../lib/gemini.js';
import { getEpisodeByVideoId, saveEpisode, slugify } from '../lib/db.js';
import { getUser, checkAllowance, recordUsage, FREE_LIMIT } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  // Vercel leaves the body as a string when the content-type header is missing.
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const videoId = extractVideoId(body.url);
  if (!videoId) {
    return res.status(422).json({ error: 'Unrecognised YouTube URL', code: 'BAD_URL' });
  }

  // Library hit → instant return, open to everyone (browsing is free).
  // Auth is only required for NEW analyses below.
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

  // New analysis → sign-in required. Checked before anything else so a signed-out reader
  // always gets the sign-in prompt rather than an infrastructure error.
  const { user, error: authError, status: authStatus, code: authCode } = await getUser(req);
  if (authError) {
    return res.status(authStatus).json({ error: authError, code: authCode });
  }

  const supadataKey = process.env.SUPADATA_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!supadataKey || !geminiKey) {
    console.error('analyze: missing SUPADATA_API_KEY or GEMINI_API_KEY');
    return res.status(503).json({ error: 'Analysis provider keys missing', code: 'UNAVAILABLE' });
  }

  // Free-5 gate — new analyses only
  const allowance = await checkAllowance(user.id);
  if (!allowance.allowed) {
    return res.status(402).json({
      error: `Free limit of ${FREE_LIMIT} reached`,
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

    // Save to the analyzer's own library. Private by default — the public library is the
    // curated seed only, so one user's analyses never spam everybody else's homepage.
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
      userId: user.id,
      visibility: 'private',
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
      // err.message is upstream/parser text — the client renders its own copy from the code.
      console.warn('analyze: no transcript', videoId, err.message);
      return res.status(422).json({ error: 'Transcript unavailable', code: 'NO_TRANSCRIPT' });
    }
    // Upstream messages can carry provider internals — log them, show the reader plain copy.
    console.error('analyze failed', err);
    return res.status(500).json({ error: 'Analysis pipeline failed', code: 'ANALYSIS_FAILED' });
  }
}
