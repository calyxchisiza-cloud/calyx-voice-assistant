import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Speech-to-text for the desktop app.
 *
 * The browser's built-in SpeechRecognition depends on Google's speech service,
 * which Chromium (and therefore Electron) cannot reach. In the packaged desktop
 * app it starts, captures audio, and then fails with a "network" error. This
 * endpoint transcribes recorded audio through OpenAI instead, so voice input
 * works the same in the desktop window as it does in Chrome.
 */

const MAX_BYTES = 12 * 1024 * 1024; // Whisper accepts up to 25 MB; stay well under.
const MODEL = process.env.TRANSCRIBE_MODEL?.trim() || 'whisper-1';
const TIMEOUT_MS = 30_000;

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 40;
const requestLog = new Map<string, number[]>();

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

function rateLimited(address: string) {
  const now = Date.now();
  const recent = (requestLog.get(address) || []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    requestLog.set(address, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(address, recent);
  return false;
}

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('Request rejected.', 403, 'forbidden');
  if (rateLimited(getClientAddress(request))) return jsonError('Too many requests. Wait a moment.', 429, 'rate_limited');

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return jsonError('Desktop voice needs an OpenAI key. Add OPENAI_API_KEY to .env.local.', 503, 'no_key');
  }

  let inbound: FormData;
  try {
    inbound = await request.formData();
  } catch {
    return jsonError('Expected multipart audio.', 400, 'bad_request');
  }

  const audio = inbound.get('audio');
  if (!(audio instanceof Blob)) return jsonError('No audio was received.', 400, 'bad_request');
  if (audio.size === 0) return jsonError('The recording was empty.', 400, 'empty_audio');
  if (audio.size > MAX_BYTES) return jsonError('That recording was too long. Keep it under about a minute.', 413, 'too_large');

  const upstream = new FormData();
  upstream.append('file', audio, 'speech.webm');
  upstream.append('model', MODEL);
  upstream.append('response_format', 'json');
  // Nudges Whisper away from inventing text during silence.
  upstream.append('temperature', '0');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      let message = 'Transcription failed.';
      try {
        const parsed = JSON.parse(detail) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Keep the generic message.
      }
      if (response.status === 401) message = 'The OpenAI key was rejected. Check OPENAI_API_KEY in .env.local.';
      if (response.status === 429) message = 'OpenAI is rate limiting or out of credit, so voice input is unavailable right now.';
      return jsonError(message, response.status === 401 ? 401 : 502, 'upstream_error');
    }

    const payload = (await response.json()) as { text?: string };
    return NextResponse.json(
      { text: (payload.text || '').trim() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return jsonError(
      aborted ? 'That took too long to transcribe. Try a shorter phrase.' : 'Could not reach the transcription service.',
      504,
      aborted ? 'timeout' : 'unreachable',
    );
  } finally {
    clearTimeout(timer);
  }
}
