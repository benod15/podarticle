// api/suggest.js — GET /api/suggest?q=... → YouTube search suggestions.
// Proxies YouTube's own autocomplete (the same suggestions youtube.com shows)
// so the homepage box behaves like YouTube/Google: read suggestions, tap one,
// then see episodes. Server-side because suggestqueries has no CORS headers.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'UNAVAILABLE' });
  }

  const q = String(req.query?.q || '').trim();
  if (!q || q.length < 2) {
    return res.status(200).json({ suggestions: [] });
  }

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return res.status(200).json({ suggestions: [] });
    const data = await r.json();
    // Shape: [query, [suggestion, ...]]
    const suggestions = (Array.isArray(data[1]) ? data[1] : []).slice(0, 8);
    // Cache briefly — suggestion text for the same keystrokes barely changes.
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ suggestions });
  } catch {
    return res.status(200).json({ suggestions: [] });
  }
}
