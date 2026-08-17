// scripts/seed.mjs — run a seed batch from seed-manifest.json.
//
//   node scripts/seed.mjs --batch 1           # fantasy football (50 episodes)
//   node scripts/seed.mjs --batch 7           # one NFL team's fan shows (10)
//   node scripts/seed.mjs --batch 1 --limit 2 # smoke test a batch
//
// Each entry is a show query; the seeder searches YouTube (via Supadata) for
// that show's recent long-form episodes, skips anything already mapped, and
// runs the same transcript → Gemini map pipeline as api/analyze.js — saving
// straight to the public library with the batch's category. Server-side, so
// no sign-in is involved. Idempotent: re-running a batch adds only new
// episodes and never re-maps an existing video_id.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env.production holds the live keys (gitignored) — load it the dumb way.
for (const line of readFileSync(join(ROOT, '.env.production'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

// Node 20 (sandbox) has no native WebSocket; supabase-js's realtime client
// throws without one. The seeder never uses realtime — a stub is enough.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = (await import('ws')).default;
}

const { fetchMetadata, parseChapters, fetchTranscript, transcriptToLines, transcriptCoverageSec, TranscriptUnavailable } = await import(join(ROOT, 'lib/youtube.js'));
const { analyzeWithGemini } = await import(join(ROOT, 'lib/gemini.js'));
const { getEpisodeByVideoId, saveEpisode, slugify } = await import(join(ROOT, 'lib/db.js'));
const { categorize } = await import(join(ROOT, 'lib/classify.js'));

const args = process.argv.slice(2);
const batch = Number(args[args.indexOf('--batch') + 1]);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;
// Only seed recent episodes: candidates are tried newest-first (from the
// search result's relative upload date) and anything older than --max-age
// days (default 45) is skipped on its exact ISO publish date.
const MAX_AGE_DAYS = args.includes('--max-age') ? Number(args[args.indexOf('--max-age') + 1]) : 45;

function ageDaysFromRelative(s) {
  const m = /(\d+)\s+(hour|day|week|month|year)s?\s+ago/i.exec(s || '');
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * (unit === 'hour' ? 1 / 24 : unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : 365);
}
if (!batch) {
  console.error('usage: node scripts/seed.mjs --batch N [--limit M]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts/seed-manifest.json'), 'utf8'));
const entry = manifest.batches[String(batch)];
if (!entry) {
  console.error(`no batch ${batch} in manifest. have: ${Object.keys(manifest.batches).join(', ')}`);
  process.exit(1);
}

const SUPADATA = process.env.SUPADATA_API_KEY;
const GEMINI = process.env.GEMINI_API_KEY;
const MAX_DURATION_SEC = 5 * 3600; // mirrors api/analyze.js
const MIN_DURATION_SEC = 20 * 60;

async function searchShow(query) {
  const url = `https://api.supadata.ai/v1/youtube/search?query=${encodeURIComponent(query)}&type=video&duration=long&sortBy=relevance`;
  const r = await fetch(url, { headers: { 'x-api-key': SUPADATA } });
  if (!r.ok) throw new Error(`search failed ${r.status}`);
  const data = await r.json();
  return (data.results || []).filter((x) => x.type === 'video');
}

let done = 0, skipped = 0, failed = 0;
console.log(`Batch ${batch}: ${entry.label} — category=${entry.category}, target=${entry.episodes_per_show}/show × ${entry.shows.length} shows`);

outer:
for (const query of entry.shows) {
  let found = 0;
  let results;
  try {
    results = await searchShow(query);
  } catch (err) {
    console.error(`  ✗ search "${query}": ${err.message}`);
    failed++;
    continue;
  }
  const candidates = results
    .map((v) => ({ v, age: ageDaysFromRelative(v.uploadDate) }))
    .sort((a, b) => (a.age ?? 9999) - (b.age ?? 9999));
  for (const { v } of candidates) {
    if (found >= entry.episodes_per_show) break;
    if (limit && done >= limit) break outer;
    const videoId = v.id;
    try {
      if (await getEpisodeByVideoId(videoId)) {
        skipped++;
        continue;
      }
      const metadata = await fetchMetadata(videoId, SUPADATA);
      if (!metadata.durationSec || metadata.durationSec < MIN_DURATION_SEC || metadata.durationSec > MAX_DURATION_SEC) {
        skipped++;
        continue;
      }
      const ageDays = metadata.publishedAt
        ? (Date.now() - new Date(metadata.publishedAt).getTime()) / 86400000
        : null;
      if (ageDays !== null && ageDays > MAX_AGE_DAYS) {
        skipped++;
        continue;
      }
      console.log(`  → mapping "${metadata.title.slice(0, 60)}" (${Math.round(metadata.durationSec / 60)}min, ${ageDays === null ? '?' : Math.round(ageDays)}d old)`);
      const chapters = parseChapters(metadata.description);
      const segments = await fetchTranscript(videoId, SUPADATA);
      const lines = transcriptToLines(segments);
      const coverage = transcriptCoverageSec(segments, metadata.durationSec);
      const analysis = await analyzeWithGemini({
        title: metadata.title, author: metadata.author, chapters, transcriptLines: lines, apiKey: GEMINI,
      });
      await saveEpisode({
        videoId,
        slug: slugify(metadata.title),
        title: metadata.title,
        showName: metadata.author,
        publishedAt: metadata.publishedAt,
        durationSec: metadata.durationSec,
        transcriptLines: lines.length,
        analysis,
        visibility: 'public',
        category: entry.category === 'auto'
          ? categorize({ title: metadata.title, showName: metadata.author, analysis })
          : entry.category,
      });
      done++;
      found++;
      console.log(`  ✓ saved (${done} this run)`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${videoId}: ${err instanceof TranscriptUnavailable ? 'no transcript' : err.message}`);
    }
  }
}

console.log(`\nBatch ${batch} done: ${done} mapped, ${skipped} skipped (existing/length), ${failed} failed`);
