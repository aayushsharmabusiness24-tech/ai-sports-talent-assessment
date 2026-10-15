// Optional: asks Gemini to turn the measured results into a short coaching note.
// It never throws. If anything goes wrong it returns null and the app works as before.

const config = require('../config');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You are a supportive sports-movement coach. You receive JSON with measurements from a computer-vision analysis of one exercise video.

Rules:
- Use ONLY the facts in the JSON. Never invent measurements, rep counts, angles, or observations.
- Do not contradict the scores or issues given. The numbers are the source of truth.
- Mention the biggest strength first, then the 1-3 most important things to improve, using the real numbers.
- If "warnings" or low "confidence" are present, say briefly that the result may be less reliable.
- Plain, friendly English for a beginner. No medical advice, no diagnosis, no promises about injury or results.
- Respond with ONLY a JSON object, no markdown, in exactly this shape:
{"overview": "2-3 sentences", "tips": ["3 to 5 short, specific, actionable tips"], "nextSession": "one sentence goal for the next session"}`;

function pick(list, fields) {
  return (Array.isArray(list) ? list : []).map((item) => {
    const out = {};
    fields.forEach((f) => {
      if (item && item[f] !== undefined && item[f] !== null) out[f] = item[f];
    });
    return out;
  });
}

// Only measurements and findings are sent. No video, name or email.
function buildFacts(a) {
  return {
    activity: a.activityLabel,
    cameraView: a.cameraView,
    completedRepetitions: a.repetitions,
    incompleteAttempts: a.incompleteRepetitions,
    formScore: a.formScore,
    scoreBreakdown: pick(a.scoreBreakdown, ['label', 'score', 'explanation']),
    issuesFound: pick(a.mistakes, ['title', 'detail', 'severity', 'repetitions']),
    measured: a.metrics ? a.metrics.measured : {},
    estimated: a.metrics ? a.metrics.estimated : {},
    confidence: a.confidence ? a.confidence.overall : null,
    warnings: a.confidence ? a.confidence.warnings : [],
    ruleBasedTips: a.suggestions,
  };
}

function cut(text, max) {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function parseCoaching(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      data = JSON.parse(cleaned.slice(start, end + 1));
    } catch (err2) {
      return null;
    }
  }
  if (!data || typeof data.overview !== 'string' || !Array.isArray(data.tips)) return null;
  const tips = data.tips
    .filter((t) => typeof t === 'string' && t.trim())
    .slice(0, 5)
    .map((t) => cut(t, 300));
  if (!data.overview.trim() || !tips.length) return null;
  return {
    overview: cut(data.overview, 700),
    tips,
    nextSession: typeof data.nextSession === 'string' ? cut(data.nextSession, 300) : '',
  };
}

const RETRY_CODES = [429, 500, 503, 504];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One request to one model. Returns { ok, status, text, reason }.
async function callGemini(model, facts, signal) {
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': config.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(facts) }] }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    }),
    signal,
  });

  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    const reason = data && data.error && data.error.message ? data.error.message : 'no details';
    return { ok: false, status: res.status, reason };
  }

  const parts =
    data && data.candidates && data.candidates[0] && data.candidates[0].content
      ? data.candidates[0].content.parts || []
      : [];
  return { ok: true, status: res.status, text: parts.map((p) => p.text || '').join('') };
}

async function generateCoaching(analysis) {
  if (!config.geminiApiKey) return null;
  if (!analysis || analysis.status !== 'completed') return null;

  // One timer covers all attempts, so the analysis never waits longer than the timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.coachTimeoutMs);

  const models = [config.geminiModel];
  if (config.geminiFallbackModel && config.geminiFallbackModel !== config.geminiModel) {
    models.push(config.geminiFallbackModel);
  }
  const facts = buildFacts(analysis);

  try {
    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = await callGemini(model, facts, controller.signal);

        if (result.ok) {
          const parsed = parseCoaching(result.text);
          if (parsed) return { ...parsed, model };
          console.warn(`[coach] ${model}: the reply could not be understood.`);
          break; // try the next model
        }

        console.warn(`[coach] ${model} returned ${result.status}: ${result.reason}`);
        if (result.status === 401 || result.status === 403) return null; // key problem, retrying will not help
        if (!RETRY_CODES.includes(result.status)) break; // e.g. 404 wrong model: try the next model
        if (attempt < 2) await sleep(2000); // busy server: wait 2 seconds and try once more
      }
    }
    return null;
  } catch (err) {
    console.warn('[coach] unavailable:', err.name === 'AbortError' ? 'timed out' : err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { generateCoaching };