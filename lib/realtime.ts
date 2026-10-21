export const SUPPORTED_VOICES = [
  { id: 'marin', label: 'Marin', note: 'Clear, composed, recommended' },
  { id: 'cedar', label: 'Cedar', note: 'Warm, grounded' },
  { id: 'alloy', label: 'Alloy', note: 'Balanced and neutral' },
  { id: 'ash', label: 'Ash', note: 'Direct and energetic' },
  { id: 'ballad', label: 'Ballad', note: 'Soft and expressive' },
  { id: 'coral', label: 'Coral', note: 'Bright and friendly' },
  { id: 'echo', label: 'Echo', note: 'Measured and resonant' },
  { id: 'sage', label: 'Sage', note: 'Thoughtful and precise' },
  { id: 'shimmer', label: 'Shimmer', note: 'Light and optimistic' },
  { id: 'verse', label: 'Verse', note: 'Articulate and lyrical' },
] as const;

export type SupportedVoice = (typeof SUPPORTED_VOICES)[number]['id'];
export type GreetingMode = 'sometimes' | 'never';
export type EngineMode = 'realtime' | 'free';
export type SessionStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'error';
export type MessageRole = 'user' | 'assistant';

export type TranscriptMessage = {
  id: string;
  role: MessageRole;
  text: string;
  pending?: boolean;
  link?: { url: string; label: string };
};

export type VoiceSession = {
  status: SessionStatus;
  messages: TranscriptMessage[];
  error: string | null;
  inputLevel: number;
  outputLevel: number;
  microphoneReady: boolean;
  outputReady: boolean;
  isActive: boolean;
  start: (voice: SupportedVoice, greeting: GreetingMode, suppressGreeting?: boolean) => Promise<void> | void;
  stop: () => void;
  reconnect: () => void;
  sendText: (text: string) => boolean;
  interrupt: () => void;
  clearMessages: () => void;
  setVoiceInterrupt?: (enabled: boolean) => void;
};

export const SYSTEM_INSTRUCTIONS = `You are CALYX, a composed, capable personal voice assistant. Speak naturally, calmly, and concisely by default. Give a detailed explanation when the user asks for one. Do not read Markdown formatting, code symbols, or interface labels aloud. Ask a follow-up question only when necessary. Avoid repetitive greetings and unnecessary announcements. Never claim to have completed an action that you did not actually perform. If you are unsure whether an action happened, say so honestly. If the user asks for something the app cannot do, say so plainly and suggest the closest thing it can do. Keep spoken answers clear and conversational, with short paragraphs and no decorative formatting.`;

/**
 * Appended only for the free (Gemini) engine, which has the local skill layer.
 * The OpenAI Realtime engine does not execute system skills.
 */
export const FREE_MODE_INSTRUCTIONS = `You are running inside CALYX Free mode on the user's own Windows PC. The user built this app on purpose, so never tell them it lacks a feature that is on this list.

A local skill layer runs before you and already handles these requests directly:
- Timers, reminders, notes and lists, calculations, unit conversions, the time and date, the weather.
- Opening websites, running web searches, and opening allowlisted apps and folders, including the Microsoft Store, Installed apps, Windows Update, Storage, Display and Sound settings pages.
- Reporting CPU, memory, disk, battery, uptime, the Windows version and the computer name.
- Listing Desktop, Documents and Downloads, and searching those folders for files.
- Scanning your Pictures, Downloads, Documents or Desktop for photos and images, and reporting how many there are, their dates, resolution and file size. This reads photo metadata only; it does not look at what is inside the picture.
- Changing or muting the volume, setting an exact volume, taking a screenshot, and locking the PC.
- Closing an allowlisted app gracefully, after a spoken yes/no confirmation.
- Deleting a single file to the Recycle Bin, after reading the path back and getting a spoken yes/no.
- Finding an installed program and opening its uninstaller, after a spoken yes/no.
- Composing an email in the user's mail app, and sending an email directly through the configured mail server, after a spoken yes/no.
- Shutting down, restarting or sleeping the PC, with a spoken yes/no and a cancel window.
- Running a PowerShell command the user dictates, after reading it back and getting a spoken yes/no. A safety blocklist still refuses destructive system commands.

When the user asks what you can do, how capable or how strong you are, or whether you can do something, answer from the list above and be proud of it. If a request was simply not recognised, tell them the precise phrasing to use, for example "what is my system info", "what is in my downloads", "find my file report", "close notepad", "delete report.pdf", "uninstall chrome", "run command ipconfig", or "email someone@example.com about the meeting".

Confirmation rules: for any of the destructive or privileged actions above, CALYX always asks "Say yes or no" first and only runs the action on an explicit yes. Say that plainly when describing how those work.

Never invent system values and never claim an action was performed when it was not. The real limits are: no reading or writing the contents of arbitrary files, no editing the registry or deep Windows settings, no browsing outside Desktop, Documents, Downloads, Pictures and the allowlisted folders, no looking inside a photo or document to see what it depicts, no adding or changing the allowlist on your own (the user must ask you to add an app explicitly), no sending email until SMTP credentials are set, and no installing new software. Say those limits only when they actually apply to the request. If the user asks you to add an app, file, or folder to the allowlist, do not claim you cannot; tell them to say "add <name> to my allowlist" so the app can propose the entry for their approval.`;

export const FREE_MODE_GREETING = `Online. CALYX free voice mode is active. Go ahead and speak whenever you are ready.`;

export function isSupportedVoice(value: unknown): value is SupportedVoice {
  return typeof value === 'string' && SUPPORTED_VOICES.some((voice) => voice.id === value);
}

export function describeRealtimeFailure(status: number, body: string): string {
  let providerMessage = '';
  let providerCode = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string; type?: string } };
    providerMessage = parsed.error?.message?.trim() || '';
    providerCode = parsed.error?.code || parsed.error?.type || '';
  } catch {
    providerMessage = body.trim().slice(0, 300);
  }

  const signal = `${providerMessage} ${providerCode}`.toLowerCase();
  if (signal.includes('insufficient_quota') || signal.includes('credit') || signal.includes('quota') || signal.includes('billing')) {
    return 'Your OpenAI account has no remaining credits. Add credits at platform.openai.com/settings/organization/billing, then try again.';
  }
  if (status === 401 || status === 403) {
    return 'OpenAI rejected the temporary voice credential. Check the API key and its Realtime access, then try again.';
  }
  if (status === 404) {
    return 'The requested Realtime model is not available to this OpenAI project. Check model access and try again.';
  }
  if (status === 429) {
    return 'OpenAI is rate limiting this project. Wait a moment and try again.';
  }
  if (providerMessage) {
    return `OpenAI could not establish the WebRTC session: ${providerMessage}`;
  }
  return 'OpenAI could not establish the WebRTC session. Check the API project, model access, and network connection.';
}

export function getUserFacingError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Microphone access was declined. Allow microphone access in your browser settings, then try again.';
    }
    if (error.name === 'NotFoundError') {
      return 'No microphone was found. Connect an input device and try again.';
    }
    if (error.name === 'NotReadableError') {
      return 'The microphone is already in use or unavailable. Close other audio apps and try again.';
    }
  }

  if (error instanceof TypeError) {
    return 'Could not reach the assistant service. The local app may have restarted — wait a moment, then try again.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'The voice session could not be established. Check your connection and try again.';
}
