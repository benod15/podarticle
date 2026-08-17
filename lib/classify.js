// lib/classify.js — assign each mapped episode to one of PodArticle's four
// categories from its title, show name, and chapter text. Keyword heuristics:
// good enough for a filter tab, cheap enough to run per analysis.
//
// Categories: sports, tech, finance, politics. Episodes that match nothing
// stay 'general' — they appear in the full library but not on a hub page.

const RULES = [
  {
    category: 'sports',
    words: [
      'nfl', 'nba', 'mlb', 'nhl', 'fantasy football', 'fantasy draft', 'quarterback',
      'touchdown', 'playoff', 'super bowl', 'march madness', 'wide receiver',
      'running back', 'draft pick', 'mock draft', 'trade rumor', 'free agency',
      'college football', 'basketball', 'baseball', 'hockey', 'soccer', 'golf',
      'ufc', 'boxing', 'coach', 'roster', 'lineup', 'matchup', 'preseason',
      'dynasty league', 'waiver wire', 'start or sit', 'rankings', 'adp',
    ],
  },
  {
    category: 'finance',
    words: [
      'crypto', 'bitcoin', 'ethereum', 'stock', 'stocks', 'market', 'investing',
      'investor', 'portfolio', 'earnings', 'fed ', 'interest rate', 'inflation',
      'recession', 'etf', 'dividend', 'wall street', 'trading', 'trader',
      'hedge fund', 'venture capital', 'startup funding', 'ipo', 'bull market',
      'bear market', 's&p', 'nasdaq', 'treasury', 'finance', 'economy', 'bank',
    ],
  },
  {
    category: 'tech',
    words: [
      ' ai ', 'artificial intelligence', 'llm', 'gpt', 'claude', 'gemini',
      'openai', 'anthropic', 'google deepmind', 'apple', 'iphone', 'google',
      'microsoft', 'nvidia', 'chip', 'semiconductor', 'software', 'saas',
      'startup', 'silicon valley', 'robotics', 'robot', 'spacex', 'tesla',
      'elon musk', 'app ', 'coding', 'programming', 'developer', 'tech',
      'data center', 'quantum', 'cybersecurity', 'gadget', 'review',
    ],
  },
  {
    category: 'politics',
    words: [
      'election', 'president', 'congress', 'senate', 'democrat', 'republican',
      'gop', 'white house', 'campaign', 'poll ', 'polling', 'supreme court',
      'impeach', 'governor', 'mayor', 'policy', 'legislation', 'bill passes',
      'tariff', 'border', 'immigration', 'ukraine', 'gaza', 'israel', 'china',
      'trump', 'biden', 'harris', 'debate', 'primary', 'caucus', 'geopolitic',
    ],
  },
];

// Order matters for ties: first category with the most hits wins, so a show
// that mentions "AI stocks" lands in finance if the finance words dominate.
export function categorize({ title = '', showName = '', analysis = null }) {
  let text = `${title} ${showName}`;
  const chapters = analysis?.chapters || [];
  text += ' ' + chapters.map((c) => `${c.title || ''} ${c.description || ''}`).join(' ');
  const hay = ` ${text.toLowerCase()} `;

  let best = { category: 'general', hits: 0 };
  for (const rule of RULES) {
    let hits = 0;
    for (const w of rule.words) {
      if (hay.includes(w)) hits++;
    }
    // Title/show matches weigh double — a fantasy football show's episode about
    // anything is still a sports episode.
    const head = ` ${(title + ' ' + showName).toLowerCase()} `;
    for (const w of rule.words) {
      if (head.includes(w)) hits++;
    }
    if (hits > best.hits) best = { category: rule.category, hits };
  }
  return best.category;
}
