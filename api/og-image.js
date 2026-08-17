// api/og-image.js — GET /api/og-image?vid=<id>[&t=<sec>] → the episode's X/OG card.
//
// Design: the episode's own YouTube thumbnail fills the card — it is the hero —
// with a branded strip at the bottom (wordmark, moment or episode title, and a
// "plays from" chip when the link points at a moment).
//
// Hard guarantee: if anything in the branded renderer fails (fonts, database,
// composition), we fall back to serving the plain YouTube thumbnail. A card
// can never break because of branding.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const TEAL = '#4a7669';

function fmtTs(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60, h = Math.floor(m / 60);
  return h
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// Race the two thumbnail sizes; maxres is the pretty one, hqdefault always exists.
async function fetchThumb(vid) {
  const fetchOk = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  };
  return Promise.any([
    fetchOk(`https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`),
    fetchOk(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`),
  ]);
}

function toDataUri(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return 'data:image/jpeg;base64,' + btoa(bin);
}

let fontsPromise = null;
function loadFonts(origin) {
  if (!fontsPromise) {
    const get = (p) =>
      fetch(`${origin}/fonts/${p}`).then((r) => {
        if (!r.ok) throw new Error(`font ${p}: ${r.status}`);
        return r.arrayBuffer();
      });
    fontsPromise = Promise.all([
      get('instrument-serif.ttf'),
      get('dm-sans-400.ttf'),
      get('dm-sans-700.ttf'),
    ]);
  }
  return fontsPromise;
}

async function fetchEpisode(vid) {
  const sb = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !key) return null;
  const r = await fetch(
    `${sb}/rest/v1/episodes?video_id=eq.${vid}&select=title,show_name,analysis&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// When the link points at a moment (?t=), headline that moment; else the episode.
function resolveHeadline(ep, t) {
  const out = { headline: ep?.title || '', show: ep?.show_name || '', sec: null, isMoment: false };
  if (!Number.isFinite(t) || !ep?.analysis) return out;
  const top5 = Array.isArray(ep.analysis.top5) ? ep.analysis.top5 : [];
  const hit = top5.find((m) => Math.abs((m.seconds || 0) - t) <= 2);
  if (hit) {
    out.headline = hit.title;
    out.sec = hit.seconds;
    out.isMoment = hit.rank === 1;
    return out;
  }
  const chapters = Array.isArray(ep.analysis.chapters) ? [...ep.analysis.chapters] : [];
  chapters.sort((a, b) => (a.seconds || 0) - (b.seconds || 0));
  const cur = chapters.filter((c) => (c.seconds || 0) <= t).pop();
  if (cur) {
    out.headline = cur.title;
    out.sec = cur.seconds;
  }
  return out;
}

const CACHE = 'public, max-age=86400, s-maxage=604800, immutable';

export default async function handler(req) {
  const url = new URL(req.url);
  const vid = String(url.searchParams.get('vid') || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) {
    return new Response(JSON.stringify({ error: 'Bad video id', code: 'BAD_QUERY' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const t = parseInt(url.searchParams.get('t') || '', 10);

  let thumb;
  try {
    thumb = await fetchThumb(vid);
  } catch {
    return new Response(JSON.stringify({ error: 'Thumbnail unavailable', code: 'UNAVAILABLE' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const plain = () =>
    new Response(thumb, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': CACHE },
    });

  try {
    const [ep, fonts] = await Promise.all([fetchEpisode(vid), loadFonts(url.origin)]);
    const [serif, dm400, dm700] = fonts;
    const { headline, show, sec, isMoment } = resolveHeadline(ep, t);
    const title = String(headline || 'Episode map').replace(/\s+/g, ' ').trim();
    const short = title.length > 88 ? title.slice(0, 85).replace(/\s+\S*$/, '') + '…' : title;

    return new ImageResponse(
      {
        type: 'div',
        props: {
          style: {
            width: 1200,
            height: 630,
            display: 'flex',
            position: 'relative',
            fontFamily: 'DM Sans',
            backgroundColor: '#14140f',
          },
          children: [
            {
              type: 'img',
              props: {
                src: toDataUri(thumb),
                width: 1200,
                height: 630,
                style: { objectFit: 'cover' },
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 300,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  padding: '0 56px 46px',
                  backgroundImage:
                    'linear-gradient(to top, rgba(12,12,9,0.94), rgba(12,12,9,0.6) 55%, rgba(12,12,9,0))',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', alignItems: 'center', marginBottom: 14 },
                      children: [
                        {
                          type: 'svg',
                          props: {
                            width: 26,
                            height: 26,
                            viewBox: '0 0 24 24',
                            children: [
                              { type: 'circle', props: { cx: 12, cy: 12, r: 12, fill: TEAL } },
                              { type: 'polygon', props: { points: '10,8 16,12 10,16', fill: 'white' } },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              color: '#e8e4da',
                              fontSize: 19,
                              fontWeight: 700,
                              letterSpacing: 5,
                              marginLeft: 12,
                            },
                            children: 'PODARTICLE',
                          },
                        },
                        isMoment
                          ? {
                              type: 'div',
                              props: {
                                style: {
                                  color: '#d8c98f',
                                  fontSize: 17,
                                  fontWeight: 700,
                                  letterSpacing: 3,
                                  marginLeft: 22,
                                },
                                children: 'THE #1 MOMENT',
                              },
                            }
                          : null,
                        sec != null
                          ? {
                              type: 'div',
                              props: {
                                style: {
                                  marginLeft: 'auto',
                                  backgroundColor: TEAL,
                                  color: 'white',
                                  fontSize: 20,
                                  fontWeight: 700,
                                  padding: '9px 20px',
                                  borderRadius: 999,
                                },
                                children: `Plays from ${fmtTs(sec)}`,
                              },
                            }
                          : null,
                      ].filter(Boolean),
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        color: 'white',
                        fontSize: short.length > 55 ? 38 : 46,
                        fontFamily: 'Instrument Serif',
                        lineHeight: 1.12,
                        display: 'flex',
                      },
                      children: short,
                    },
                  },
                  show
                    ? {
                        type: 'div',
                        props: {
                          style: { color: '#c9c4b8', fontSize: 21, marginTop: 10, display: 'flex' },
                          children: `${show} · full episode map`,
                        },
                      }
                    : null,
                ].filter(Boolean),
              },
            },
          ].filter(Boolean),
        },
      },
      {
        width: 1200,
        height: 630,
        fonts: [
          { name: 'Instrument Serif', data: serif, weight: 400 },
          { name: 'DM Sans', data: dm400, weight: 400 },
          { name: 'DM Sans', data: dm700, weight: 700 },
        ],
        headers: { 'Cache-Control': CACHE },
      }
    );
  } catch {
    // Branding is a nice-to-have; the thumbnail is the card that must never fail.
    return plain();
  }
}
