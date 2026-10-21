# JARVIS Voice Assistant

A voice-first personal assistant console built with Next.js, TypeScript, native WebRTC, the Web Audio API, and the OpenAI Realtime API.

## Local setup

```bash
pnpm install
cp .env.example .env.local
# Add the server-only OPENAI_API_KEY to .env.local
pnpm dev
```

Open `http://localhost:3000` in a browser with microphone support. The API key is used only by `app/api/realtime/token/route.ts` to mint a short-lived Realtime credential. It is never placed in frontend code or a `NEXT_PUBLIC_` variable.

The project also includes a production `Dockerfile` and an unauthenticated `GET /api/health` endpoint for server readiness checks. The container reads `OPENAI_API_KEY` at runtime; the key is not needed during the image build.

## Architecture

The browser requests a short-lived credential from the Next.js server route, then creates a native WebRTC peer connection to the Realtime API. Microphone audio travels over the peer connection, assistant audio returns to an autoplay audio element, and documented GA Realtime events travel over the `oai-events` data channel. The input and remote audio streams are also connected to Web Audio analyser nodes for the visualizer. Session context, transcripts, and media resources live only in memory for the active tab; settings are the only local preferences.

## Voice and wake word

Marin is the default voice. The settings drawer supports the documented built-in voices and `Sometimes`/`Never` greeting behavior. “Hey JARVIS” uses the browser's SpeechRecognition API when available. Browser speech recognition is not universally supported, may depend on an online browser service, and is not an offline wake-word guarantee. Unsupported browsers receive a truthful manual-start fallback.

## Troubleshooting

If the server reports a missing key, add `OPENAI_API_KEY` to `.env.local` and restart the dev server. If the provider reports invalid credentials, permissions, model access, quota, or billing problems, fix those in the OpenAI project that owns the key. If the browser denies the microphone, allow it for the current HTTPS origin and try again. If audio is blocked, click the page and start the session from the button. A current browser and HTTPS are required for production microphone access; localhost is allowed for development.

The interface applies a small in-process request limit and same-origin protection by default. Set `JARVIS_ALLOWED_ORIGINS` to a comma-separated allowlist when the frontend and server are deployed on different origins. For production, move rate limiting to a shared store, add authentication or signed user identity if the app is exposed beyond a trusted user, configure a strict Content Security Policy, use a stable privacy-preserving safety identifier, and add monitoring without logging keys, temporary credentials, raw audio, or transcripts.

## Costs and data handling

Realtime usage and input transcription are billed by the OpenAI project associated with the server key. Review current pricing and project limits before sharing the app. This prototype does not persist recordings or transcripts. The temporary client credential is held only in memory by the browser during connection setup.

## Verification

Automated checks are run with:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

A real voice test additionally requires a valid OpenAI key with Realtime access, a supported browser, microphone permission, a network connection, and a user gesture that allows audio playback. Wake-word testing requires a browser that exposes SpeechRecognition. The security review should confirm that `/api/realtime/token` returns only the temporary `value` and never the permanent `OPENAI_API_KEY`.

## Current limitations

Browser wake-word support varies. Changing voice after a session has produced audio requires starting a new session because Realtime voice cannot be changed after audio output. In-process rate limiting resets when the server restarts and is not sufficient as the only production abuse control. The visualizer reads local and remote audio energy but does not record or retain it.
