import { NextRequest, NextResponse } from 'next/server';
import { FREE_MODE_INSTRUCTIONS, SYSTEM_INSTRUCTIONS } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4_000;
const MODEL_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];

const requestLog = new Map<string, number[]>();

type IncomingMessage = { role?: unknown; text?: unknown };
type GeminiPayload = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  error?: { message?: string; status?: string };
};

function modelChain() {
  const configured = (process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...FALLBACK_MODELS])];
}

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function getClientAddress(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function originAllowed(request: NextRequest) {
  const configured = process.env.JARVIS_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) || [];
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (configured.length > 0) return configured.includes(origin);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return Boolean(host && new URL(origin).host === host);
}

function normaliseMessages(input: unknown) {
  if (!Array.isArray(input)) return null;
  const cleaned: { role: 'user' | 'model'; text: string }[] = [];
  for (const item of input as IncomingMessage[]) {
    const role = item?.role === 'assistant' ? 'model' : item?.role === 'user' ? 'user' : null;
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!role || !text) continue;
    cleaned.push({ role, text: text.slice(0, MAX_MESSAGE_CHARS) });
  }
  return cleaned.slice(-MAX_MESSAGES);
}

function extractReply(payload: GeminiPayload) {
  const candidate = payload.candidates?.[0];
  const reply = (candidate?.content?.parts || []).map((part) => part.text || '').join('').trim();
  return { reply, finishReason: candidate?.finishReason };
}

async function askGemini(model: string, apiKey: string, messages: { role: 'user' | 'model'; text: string }[]) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: `${SYSTEM_INSTRUCTIONS}\n\n${FREE_MODE_INSTRUCTIONS}` }] },
        contents: messages.map((message) => ({ role: message.role, parts: [{ text: message.text }] })),
        generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
      }),
    },
  );
  const payload = (await response.json()) as GeminiPayload;
  return { status: response.status, ok: response.ok, payload };
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('This origin is not allowed to use free mode.', 403, 'origin_not_allowed');

  const address = getClientAddress(request);
  const now = Date.now();
  const recent = (requestLog.get(address) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return jsonError('Too many assistant requests. Wait a moment and try again.', 429, 'rate_limited');
  requestLog.set(address, [...recent, now]);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError('The server is missing GEMINI_API_KEY. Add a free Google AI Studio key to .env.local and restart the app.', 500, 'missing_api_key');

  let body: { messages?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown };
  } catch {
    return jsonError('The request body must be valid JSON.', 400, 'invalid_json');
  }

  const messages = normaliseMessages(body.messages);
  if (!messages || messages.length === 0) return jsonError('Send at least one message.', 400, 'invalid_messages');
  if (messages[messages.length - 1].role !== 'user') return jsonError('The last message must come from the user.', 400, 'invalid_messages');

  const models = modelChain();
  let sawQuota = false;
  const tried: string[] = [];

  for (const model of models) {
    tried.push(model);
    let attempt;
    try {
      attempt = await askGemini(model, apiKey, messages);
    } catch {
      continue;
    }

    const providerMessage = `${attempt.payload.error?.message || ''} ${attempt.payload.error?.status || ''}`.toLowerCase();

    if (attempt.status === 401 || attempt.status === 403 || providerMessage.includes('api key not valid') || providerMessage.includes('api_key_invalid')) {
      return jsonError('The Gemini API key is invalid or lacks access. Create a fresh free key in Google AI Studio and update .env.local.', 502, 'provider_auth');
    }

    if (attempt.ok) {
      const { reply, finishReason } = extractReply(attempt.payload);
      if (reply) return NextResponse.json({ reply, model }, { headers: { 'Cache-Control': 'no-store' } });
      if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'RECITATION') {
        return jsonError('The assistant declined to answer that request. Try rephrasing it.', 502, 'provider_blocked');
      }
      continue;
    }

    if (attempt.status === 429) sawQuota = true;
    // 404 (model unavailable), 429 (quota), 5xx and empty replies fall through to the next free model.
  }

  if (sawQuota) {
    return jsonError('The free Gemini tier rate limit was reached. Wait a moment and try again.', 429, 'provider_quota');
  }
  return jsonError(`Gemini is temporarily unavailable for the free models (${tried.join(', ')}). Try again in a moment.`, 502, 'provider_unavailable');
}
