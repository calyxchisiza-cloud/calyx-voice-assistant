# JARVIS Voice Assistant — Implementation Plan

## Scope

Build a production-minded prototype of a voice-first JARVIS-inspired assistant. Voice is the primary interaction, with optional text input, live transcripts, interruption support, reconnection states, configurable voice/greeting settings, practical browser wake-word fallback, and an audio-reactive central visualization. The permanent OpenAI key remains server-side; the browser receives only a short-lived Realtime client secret.

## Implementation approach

- Use Next.js App Router with React and TypeScript. The page is a client component for WebRTC state, transcript rendering, settings, and Web Audio analysis.
- Use a server route at `POST /api/realtime/token` that validates the selected supported voice, checks `OPENAI_API_KEY`, rate-limits requests in process, disables caching, and creates a GA Realtime ephemeral client secret through `POST https://api.openai.com/v1/realtime/client_secrets`.
- Connect from the browser with native WebRTC: obtain microphone media, create an `RTCPeerConnection`, attach the local audio track, attach a hidden autoplay audio element to the remote track, open the `oai-events` data channel, and POST the SDP offer to `/v1/realtime/calls` using the ephemeral token.
- Send a GA `session.update` event after the data channel opens to set the selected voice, concise assistant instructions, input transcription, server VAD, interruption behavior, and output audio. Use documented client/server events for text input, streaming assistant transcript, input transcription completion, response lifecycle, cancellation, and errors.
- Use Web Audio `AnalyserNode` instances connected to the local microphone and remote assistant audio streams. The visualizer uses real RMS/frequency energy for speaking/speaking-back states, with low-cost idle animation otherwise, and always tears down tracks, contexts, animation frames, and handlers.
- Keep wake-word detection in a separate module. Prefer `SpeechRecognition` only when the browser exposes it; explicitly disclose that it is browser-dependent and online/permission-bound. If unsupported, show a fallback that asks the user to start a session manually rather than pretending to provide continuous offline detection.
- Persist only voice, greeting mode, wake-word preference, and text-mode preference in local storage. Never persist tokens, audio, or transcripts.

## Project structure

- `app/page.tsx` — page composition and session orchestration.
- `app/globals.css` — midnight-blue visual system, responsive layout, accessible focus states, reduced-motion rules, and waveform styling.
- `app/layout.tsx` — document metadata and global styles.
- `app/api/realtime/token/route.ts` — secure ephemeral credential endpoint.
- `components/assistant-visualizer.tsx` — audio-reactive central visualization.
- `components/conversation-panel.tsx` — transcript list and text composer.
- `components/settings-panel.tsx` — voice, greeting, wake-word, microphone, and output settings.
- `hooks/use-realtime-session.ts` — WebRTC lifecycle, data-channel events, transcript aggregation, interruption, reconnection, and cleanup.
- `hooks/use-wake-word.ts` — browser support detection and guarded “Hey JARVIS” recognition.
- `lib/realtime.ts` — supported voices, instruction text, event types, and safe error mapping.
- `public/manus-routes.json` — route manifest for `/`.
- `README.md` — setup, security, API cost, browser limitations, troubleshooting, and validation notes.

## Design direction

Three possible movements:

- **Tactical glass instrument** — 0.07: a precise, restrained control surface with luminous measurement marks.
- **Nocturne observatory** — 0.05: an atmospheric night-sky composition where the assistant core feels like a calm signal beacon.
- **Cyan editorial console** — 0.08: a high-contrast typography-led interface that treats every state as a considered editorial label.

### Chosen movement: Nocturne observatory

- **Core Principles:** quiet confidence, signal clarity, depth without clutter, and state-led feedback.
- **Color Philosophy:** midnight navy gives the interface a calm, private room; cyan and ice-blue accents act as an ownable signal color, used for active states rather than decoration; warm white provides readable conversational hierarchy.
- **Layout Paradigm:** a vertical command rail frames a central observation field, while the transcript and controls occupy shallow edge panels instead of a card grid.
- **Signature Elements:** a concentric “signal halo” around the waveform, thin orbital guide lines, and a compact status beacon that shifts color by real session state.
- **Interaction Philosophy:** controls should feel like deliberate instrument toggles. One primary action makes the next useful step obvious; all secondary settings remain close but quiet.
- **Animation:** slow ambient drift when idle; sharp but damped energy changes during real audio; no animation should convey fake activity during a disconnected state; honor `prefers-reduced-motion`.
- **Typography System:** use `Space Grotesk` for brand/status labels and `Inter` for transcript and controls, with generous tracking only on all-caps utility labels.
- **Brand Essence:** a composed private voice console for people who want an assistant that listens first; calm, exact, attentive.
- **Brand Voice:** headlines and microcopy are concise and observant, e.g. “Ready when you are.” and “Listening for a clear signal.”
- **Wordmark & Logo:** a custom CSS mark made from a split orbital ring and a centered cyan signal point beside the JARVIS wordmark.
- **Signature Brand Color:** `#7BE7FF`, a clear ice-cyan that reads as signal rather than neon.

## Verification and delivery

Run dependency installation, TypeScript checks, lint, production build, and focused route/secret inspection. Use static code inspection for the secure endpoint and document that real voice testing still requires a configured API key, a supported browser, microphone permission, and a user gesture for audio playback. Commit the complete project to the managed repository checkpoint; do not publish without explicit user request.

## Source contract consulted

Implementation follows the current GA Realtime WebRTC documentation: ephemeral client secrets are created at `POST /v1/realtime/client_secrets`, browser SDP is posted to `POST /v1/realtime/calls`, and the client uses documented `session.update`, `conversation.item.create`, `response.create`, `response.cancel`, `output_audio_buffer.clear`, input transcription, response transcript, lifecycle, and error events.
