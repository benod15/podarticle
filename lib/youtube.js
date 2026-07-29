// lib/youtube.js — video ID extraction, metadata, transcript (Supadata), chapters
const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function extractVideoId(url) {
  const m = YOUTUBE_ID_RE.exec(String(url || '').trim());
  return m ? m[1] : null;
}

export function tsToSeconds(ts) {
  const parts = ts.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export function secondsToTs(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- metadata -----------------------------------------------------------
export async function fetchMetadata(videoId, supadataKey) {
  // Supadata metadata endpoint: title, description (has chapters), duration, publish date, channel
  if (supadataKey) {
    const r = await fetch(`https://api.supadata.ai/v1/youtube/video?id=${videoId}`, {
      headers: { 'x-api-key': supadataKey },
    });
    if (r.ok) {
      const d = await r.json();
      return {
        title: d.title || '',
        author: d.channel?.name || d.author || '',
        description: d.description || '',
        durationSec: d.duration ? Math.round(d.duration / 1000) : 0,
        publishedAt: d.uploadDate || d.publishedAt || null,
        thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        viewCount: d.viewCount || null,
      };
    }
  }
  // Fallback: noembed (no key needed)
  const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
  const d = await r.json();
  if (d.error) throw Object.assign(new Error(`Could not fetch metadata: ${d.error}`), { status: 422 });
  return {
    title: d.title || '',
    author: d.author_name || '',
    description: '',
    durationSec: 0,
    publishedAt: null,
    thumbnail: d.thumbnail_url || '',
    viewCount: null,
  };
}

// ---- chapters from description ------------------------------------------
const CHAPTER_LINE_RE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;

export function parseChapters(description) {
  const chapters = [];
  for (const line of String(description || '').split('\n')) {
    const m = CHAPTER_LINE_RE.exec(line.trim());
    if (m) {
      chapters.push({ timestamp: m[1], seconds: tsToSeconds(m[1]), title: m[2].trim() });
    }
  }
  // Sanity: a real chapter list has 3+ entries
  return chapters.length >= 3 ? chapters : [];
}

// ---- transcript via Supadata --------------------------------------------
export class TranscriptUnavailable extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'NO_TRANSCRIPT';
  }
}

export async function fetchTranscript(videoId, supadataKey) {
  const base = 'https://api.supadata.ai/v1/youtube/transcript';
  const url = `${base}?videoId=${videoId}&mode=native&chunkSize=400`;
  let r = await fetch(url, { headers: { 'x-api-key': supadataKey } });

  // 202 = async job (large video): poll the job endpoint
  if (r.status === 202) {
    const { jobId } = await r.json();
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      r = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
        headers: { 'x-api-key': supadataKey },
      });
      if (r.status === 200) break;
      if (r.status === 206 || r.status === 404 || r.status >= 400) break;
    }
  }

  if (r.status === 206) {
    // Supadata: transcript unavailable
    throw new TranscriptUnavailable('Transcript not available yet — this episode is too new. Try again in a few hours');
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw Object.assign(new Error(`Transcript fetch failed (${r.status})`), { status: 502, detail: body.slice(0, 200) });
  }

  const data = await r.json();
  const content = data.content || [];
  if (!content.length) {
    throw new TranscriptUnavailable('Transcript not available yet — this episode is too new. Try again in a few hours');
  }
  return content; // [{text, offset(ms), duration(ms), lang}]
}

// Merge caption chunks into ~30s transcript lines: "{ts:N} text..."
export function transcriptToLines(segments, maxLines = 1400) {
  const lines = [];
  let bucket = [];
  let bucketStart = 0;
  let bucketLen = 0;
  for (const seg of segments) {
    const t = Math.floor((seg.offset || 0) / 1000);
    if (!bucket.length) bucketStart = t;
    bucket.push(seg.text || '');
    bucketLen += (seg.text || '').length;
    if (t - bucketStart >= 30 || bucketLen > 500) {
      lines.push(`{ts:${bucketStart}} ${bucket.join(' ').trim()}`);
      bucket = [];
      bucketLen = 0;
    }
  }
  if (bucket.length) lines.push(`{ts:${bucketStart}} ${bucket.join(' ').trim()}`);
  // Cap: sample evenly if absurdly long
  if (lines.length > maxLines) {
    const step = lines.length / maxLines;
    const sampled = [];
    for (let i = 0; i < maxLines; i++) sampled.push(lines[Math.floor(i * step)]);
    return sampled;
  }
  return lines;
}
