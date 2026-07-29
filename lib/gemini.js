// lib/gemini.js — analysis via user's own Gemini API key (REST, structured output)

const BANNED = 'pivotal, vital, crucial, underscore, tapestry, testament, vibrant, delve, showcase, intricate, robust, leverage, nuanced, garner, highlight (as verb), meticulous';

export const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    top5: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          rank: { type: 'INTEGER' },
          title: { type: 'STRING' },
          timestamp: { type: 'STRING' },
          seconds: { type: 'INTEGER' },
          description: { type: 'STRING' },
        },
        required: ['rank', 'title', 'timestamp', 'seconds', 'description'],
      },
    },
    chapters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          timestamp: { type: 'STRING' },
          seconds: { type: 'INTEGER' },
          title: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['timestamp', 'seconds', 'title', 'description'],
      },
    },
  },
  required: ['summary', 'top5', 'chapters'],
};

function buildPrompt({ title, author, chapters, transcript }) {
  const chaptersText = chapters.length
    ? chapters.map((c) => `${c.timestamp} ${c.title}`).join('\n')
    : '(no official chapters found)';

  return `You are the analysis engine for PodArticle, a tool that turns long podcast episodes into a section map so listeners can jump to the parts they care about.

Episode metadata:
- Title: ${title}
- Channel: ${author}

Official chapter list from the video description:
${chaptersText}
${chapters.length ? '' : 'IMPORTANT: This video has NO official chapters. You MUST derive sections from the transcript timestamps yourself. Divide the episode into 8-12 thematic sections using the {ts:N} anchors, and rank a Top 5. Never return empty top5 or chapters arrays.'}

Timestamped transcript (each line starts with {ts:N} = N seconds into the episode). This is the COMPLETE caption track — it covers the entire episode:
${transcript}

Your job:
1. Write a 2-3 sentence episode summary. Be specific and factual. No hype, no filler.
2. Rank the TOP 5 sections a listener would most want to jump to. Pick for surprise value, specificity, and usefulness. For each: title, exact timestamp from the chapter list, and a 1-2 sentence description grounded ONLY in the transcript provided. If you cannot verify a claim from the transcript, do not make it.
3. For every chapter, write a 1-sentence factual description grounded in the transcript.

CRITICAL — full-episode coverage:
- The transcript usually extends BEYOND the last official chapter. That trailing content is part of the episode and MUST appear in the map.
- After the last official chapter, add derived sections from the transcript {ts:N} anchors covering everything up to the latest transcript timestamp. These derived sections are allowed even though they are not in the chapter list.
- The final section's timestamp must be within ~10 minutes of the latest transcript timestamp. A map that ends an hour before the transcript ends is a failed map.
- Total sections: aim for 8-14 for a typical episode, more for very long ones.

Return ONLY valid JSON — no markdown, no commentary — in exactly this shape:
{
  "summary": "...",
  "top5": [
    {"rank": 1, "title": "...", "timestamp": "1:08:41", "seconds": 4121, "description": "..."}
  ],
  "chapters": [
    {"timestamp": "0:00", "seconds": 0, "title": "...", "description": "..."}
  ]
}

Hard rules:
- Every timestamp must come from the official chapter list above. Never invent one. EXCEPTIONS: (a) when no official chapters exist, use timestamps from the transcript {ts:N} anchors; (b) for content AFTER the last official chapter, derive sections from transcript {ts:N} anchors. In both cases, never use a timestamp with no transcript line near it.
- Descriptions must be supported by the transcript. Do not fabricate quotes, numbers, or claims.
- If the transcript is too thin to describe a chapter confidently, say "Description not available for this section." Do not guess.
- top5 and chapters must never be empty when transcript exists — even with imperfect coverage, produce the best map you can from what you have.
- Banned words: ${BANNED}.
- Banned pattern: "Not just X, but also Y" and significance statements like "This matters because".`;
}

export async function analyzeWithGemini({ title, author, chapters, transcriptLines, apiKey }) {
  const transcript = transcriptLines.join('\n');
  const prompt = buildPrompt({ title, author, chapters, transcript });

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ANALYSIS_SCHEMA,
      maxOutputTokens: 16384,
      temperature: 0.2,
    },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw Object.assign(new Error(`Gemini request failed (${r.status})`), { status: 502, detail: err.slice(0, 300) });
  }

  const data = await r.json();
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    throw Object.assign(new Error('Gemini returned no content'), { status: 502 });
  }

  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error(`Gemini returned malformed JSON: ${e.message}`), { status: 502 });
  }

  // Verify top5 timestamps against official chapters
  const officialSecs = new Set(chapters.map((c) => c.seconds));
  if (officialSecs.size) {
    for (const item of analysis.top5 || []) {
      item.verified = officialSecs.has(item.seconds);
    }
  }
  return analysis;
}
