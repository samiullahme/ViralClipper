// electron/ai.js — unified client for DeepSeek / Kimi (Moonshot) / OpenAI chat APIs.
// Uses Node's global fetch (Electron >= 28). No extra dependencies.
const PROVIDERS = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    label: 'DeepSeek',
  },
  kimi: {
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    label: 'Kimi',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    label: 'OpenAI',
  },
};

/** Exact prompt required by the product spec (+ a nudge for strict JSON). */
const DETECT_PROMPT = `You are a viral short-form video expert.
Analyze this transcript and find 5-10 clips that would go viral on YouTube Shorts,
TikTok, or Instagram Reels. Each clip should be 30-90 seconds.
Return ONLY a JSON array like:
[
  {
    "start": "00:01:23",
    "end": "00:01:58",
    "title": "clip title",
    "reason": "why this will go viral",
    "hook": "suggested hook text for overlay"
  }
]
Use double quotes so the output is valid JSON. Times must be HH:MM:SS inside the video.

TRANSCRIPT:
`;

const COPY_SYSTEM =
  'You are a punchy short-form video copywriter. Reply with valid JSON only, no markdown.';

/**
 * Call the selected provider's chat completions endpoint.
 * Returns the assistant message content string.
 */
async function chat({ provider, apiKey, model, messages, timeoutMs = 90000 }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown AI provider: ${provider}`);
  if (!apiKey) throw new Error(`No API key saved for ${cfg.label}. Add it in Settings.`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || cfg.defaultModel,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${cfg.label} API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${cfg.label} returned an empty response.`);
    return content;
  } finally {
    clearTimeout(t);
  }
}

/** Best-effort extraction of a JSON array or object from an LLM reply. */
function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const a = cleaned.indexOf('['), b = cleaned.lastIndexOf(']');
  if (a !== -1 && b > a) {
    try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* fall through */ }
  }
  const o = cleaned.indexOf('{'), p = cleaned.lastIndexOf('}');
  if (o !== -1 && p > o) {
    try { return JSON.parse(cleaned.slice(o, p + 1)); } catch { /* fall through */ }
  }
  throw new Error('AI response was not valid JSON.');
}

/** Ask the AI for viral clip boundaries from a transcript. */
async function detectClips({ provider, apiKey, model, segments }) {
  const lines = segments
    .map((s) => `[${fmtTs(s.start)}] ${s.text}`)
    .join('\n');
  const content = await chat({
    provider, apiKey, model,
    messages: [
      { role: 'system', content: 'You output only valid JSON.' },
      { role: 'user', content: DETECT_PROMPT + lines },
    ],
  });
  const arr = parseJsonLoose(content);
  if (!Array.isArray(arr)) throw new Error('Expected a JSON array of clips.');
  return arr.slice(0, 10).map((c, i) => ({
    start: String(c.start || '').trim(),
    end: String(c.end || '').trim(),
    title: String(c.title || `Clip ${i + 1}`).slice(0, 90),
    reason: String(c.reason || ''),
    hook: String(c.hook || ''),
  }));
}

/** Ask the AI for overlay text (headline/subtext/hashtags) for one clip. */
async function generateCopy({ provider, apiKey, model, title, hook }) {
  const user = `Clip title: ${title}
Hook idea: ${hook}

Return ONLY this JSON object:
{"headline":"MAX 6 WORDS, UPPERCASE, scroll-stopping","subtext":"one short supporting sentence","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"]}`;
  const content = await chat({
    provider, apiKey, model,
    messages: [
      { role: 'system', content: COPY_SYSTEM },
      { role: 'user', content: user },
    ],
  });
  const obj = parseJsonLoose(content);
  const tags = Array.isArray(obj.hashtags)
    ? obj.hashtags.map((h) => String(h).replace(/\s+/g, '')).slice(0, 8)
    : [];
  return {
    headline: String(obj.headline || title || '').toUpperCase().slice(0, 80),
    subtext: String(obj.subtext || '').slice(0, 120),
    hashtags: tags,
  };
}

function fmtTs(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

module.exports = { PROVIDERS, detectClips, generateCopy, parseJsonLoose };
