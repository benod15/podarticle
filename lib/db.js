// lib/db.js — Supabase persistence (episodes + analysis usage)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-only)
//
// Schema (SQL to run in Supabase):
//
// create table episodes (
//   id uuid primary key default gen_random_uuid(),
//   video_id text unique not null,
//   slug text unique not null,
//   title text not null,
//   show_name text,
//   published_at timestamptz,
//   duration_sec int,
//   transcript_lines int,
//   analysis jsonb not null,
//   user_id text,                                  -- who ran the analysis (null = curated seed)
//   visibility text not null default 'private',    -- 'public' = curated library, 'private' = personal
//   created_at timestamptz default now()
// );
// create index episodes_created_idx on episodes (created_at desc);
// create index episodes_visibility_idx on episodes (visibility, published_at desc);
// create index episodes_user_idx on episodes (user_id, created_at desc);
//
// Migration for an existing table (run before deploying):
//   alter table episodes add column if not exists user_id text;
//   alter table episodes add column if not exists visibility text not null default 'private';
//   update episodes set visibility = 'public' where user_id is null;  -- existing rows are the curated seed
//
// create table usage (
//   id uuid primary key default gen_random_uuid(),
//   user_id text not null,          -- google sub or anon id
//   video_id text not null,
//   created_at timestamptz default now()
// );

import { createClient } from '@supabase/supabase-js';

let _client = null;
export function db() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null; // graceful: run without persistence
    _client = createClient(url, key);
  }
  return _client;
}

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-')
    .replace(/-+/g, '-') || 'episode';
}

export async function getEpisodeByVideoId(videoId) {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from('episodes')
    .select('*')
    .eq('video_id', videoId)
    .maybeSingle();
  return data;
}

export async function getEpisodeBySlug(slug) {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from('episodes')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

export async function saveEpisode({ videoId, slug, title, showName, publishedAt, durationSec, transcriptLines, analysis, userId = null, visibility = 'private' }) {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from('episodes')
    .upsert(
      {
        video_id: videoId,
        slug,
        title,
        show_name: showName,
        published_at: publishedAt,
        duration_sec: durationSec,
        transcript_lines: transcriptLines,
        analysis,
        user_id: userId,
        visibility,
      },
      { onConflict: 'video_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

const LIBRARY_COLUMNS =
  'video_id, slug, title, show_name, published_at, duration_sec, analysis:analysis->summary, created_at';

// The curated library everybody sees. Ordered by publish date, then by when we mapped it,
// so seed episodes without a publish date still appear instead of sinking out of the list.
export async function listEpisodes({ limit = 200 } = {}) {
  const client = db();
  if (!client) return [];
  const { data, error } = await client
    .from('episodes')
    .select(LIBRARY_COLUMNS)
    .eq('visibility', 'public')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  // If the visibility column has not been migrated yet, an unfiltered list is far better
  // than an empty library — the failure this whole endpoint exists to avoid.
  if (error) {
    const { data: all } = await client
      .from('episodes')
      .select(LIBRARY_COLUMNS)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    return all || [];
  }
  return data || [];
}

// One signed-in user's own analyses, shown on top of the curated library.
export async function listUserEpisodes(userId, { limit = 200 } = {}) {
  const client = db();
  if (!client || !userId) return [];
  const { data } = await client
    .from('episodes')
    .select(LIBRARY_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function recordUsage(userId, videoId) {
  const client = db();
  if (!client) return;
  await client.from('usage').insert({ user_id: userId, video_id: videoId });
}

export async function countUsage(userId) {
  const client = db();
  if (!client) return 0;
  const { count } = await client
    .from('usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count || 0;
}
