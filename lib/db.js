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
//   user_id text,                                  -- who mapped it first (null = curated seed)
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
// Library membership is its own table, not the episodes.user_id column. `video_id` is
// unique, so there is exactly one row per episode and that column can only ever name one
// owner — the second reader to map an episode would get nothing. Readers and episodes are
// many-to-many.
//
// create table library_entries (
//   id uuid primary key default gen_random_uuid(),
//   user_id text not null,
//   video_id text not null,
//   created_at timestamptz default now(),
//   unique (user_id, video_id)
// );
// create index library_entries_user_idx on library_entries (user_id, created_at desc);
//
//   -- backfill: everyone keeps the library they already had
//   insert into library_entries (user_id, video_id, created_at)
//   select user_id, video_id, created_at from episodes where user_id is not null
//   on conflict (user_id, video_id) do nothing;
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
  const row = {
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
  };
  const { data, error } = await client
    .from('episodes')
    .upsert(row, { onConflict: 'video_id' })
    .select()
    .single();
  if (!error) return data;

  // `slug` is unique but only carries the first six words of the title, so two episodes of
  // the same show collide routinely. The video id is the real identity — suffix with it
  // rather than throwing away a finished analysis over a constraint.
  if (error.code !== '23505') throw error;
  const { data: retried, error: retryError } = await client
    .from('episodes')
    .upsert({ ...row, slug: `${slug}-${videoId}` }, { onConflict: 'video_id' })
    .select()
    .single();
  if (retryError) throw retryError;
  return retried;
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

// Put an episode in a reader's library. Idempotent: mapping something you already have
// updates nothing rather than dealing you a second card.
export async function addToLibrary(userId, videoId) {
  const client = db();
  if (!client || !userId) return;
  await client
    .from('library_entries')
    .upsert({ user_id: userId, video_id: videoId }, { onConflict: 'user_id,video_id' });
}

// One signed-in reader's own library, shown on top of the curated seed.
export async function listUserEpisodes(userId, { limit = 200 } = {}) {
  const client = db();
  if (!client || !userId) return [];

  const { data: entries, error } = await client
    .from('library_entries')
    .select('video_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Deploy lands before the migration is run by hand, so until the table exists fall back
  // to the ownership column and leave every reader the library they already had.
  if (error) {
    const { data } = await client
      .from('episodes')
      .select(LIBRARY_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }
  if (!entries.length) return [];

  const { data } = await client
    .from('episodes')
    .select(LIBRARY_COLUMNS)
    .in('video_id', entries.map((e) => e.video_id));
  if (!data) return [];

  // Order by when the reader added it, not when the episode was first mapped — an episode
  // that has been in the curated library for months is new to whoever just pasted it.
  const added = new Map(entries.map((e, i) => [e.video_id, i]));
  return data.sort((a, b) => added.get(a.video_id) - added.get(b.video_id));
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
