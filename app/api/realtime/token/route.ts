import { NextRequest, NextResponse } from 'next/server';
import { isSupportedVoice, SYSTEM_INSTRUCTIONS } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestLog = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;

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

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('This origin is not allowed to create a voice session.', 403, 'origin_not_allowed');

  const address = getClientAddress(request);
  const now = Date.now();
  const recent = (requestLog.get(address) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return jsonError('Too many session attempts. Wait a moment and try again.', 429, 'rate_limited');
  requestLog.set(address, [...recent, now]);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError('The server is missing OPENAI_API_KEY. Add it to .env.local and restart the app.', 500, 'missing_api_key');

  let body: { voice?: unknown };
  try {
    body = (await request.json()) as { voice?: unknown };
  } catch {
    return jsonError('The request body must be valid JSON.', 400, 'invalid_json');
  }

  const voice = body.voice || 'marin';
  if (!isSupportedVoice(voice)) return jsonError('That voice is not supported by this application.', 400, 'invalid_voice');

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
          instructions: SYSTEM_INSTRUCTIONS,
          audio: { output: { voice } },
        },
      }),
    });

    const data = (await response.json()) as { value?: string; expires_at?: number; error?: { message?: string; code?: string; type?: string } };
    if (!response.ok || !data.value) {
      const providerMessage = `${data.error?.message || ''} ${data.error?.code || ''} ${data.error?.type || ''}`.toLowerCase();
      if (providerMessage.includes('quota') || providerMessage.includes('billing') || providerMessage.includes('credit')) {
        return jsonError('The OpenAI project has a quota or billing issue. Check the project limits, then try again.', 502, 'provider_quota');
      }
      if (response.status === 401 || response.status === 403) {
        return jsonError('The server API key is invalid or does not have Realtime access.', 502, 'provider_auth');
      }
      return jsonError('OpenAI could not create a temporary voice credential. Check model access and try again.', 502, 'provider_unavailable');
    }

    return NextResponse.json({ value: data.value, expires_at: data.expires_at, voice }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError('The Realtime credential service is unavailable. Check the server network connection.', 502, 'provider_network');
  }
}
