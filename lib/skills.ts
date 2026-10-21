/**
 * Local skills layer for CALYX.
 *
 * These run entirely in the browser and answer common requests instantly,
 * without needing the language model (or any network round trip). Anything
 * that is not recognised here falls through to the AI brain.
 */

import { APP_ALIASES, FOLDER_ALIASES, isBlockedCommand, type SystemRequest } from '@/lib/system';

export type SkillAction =
  | { type: 'open-url'; url: string }
  | { type: 'open-email'; to: string; subject: string; body: string }
  | { type: 'timer'; durationMs: number; label: string }
  | { type: 'system'; request: SystemRequest }
  | { type: 'stop-speaking' }
  | { type: 'clear-conversation' };

export type SkillConfirmation = {
  question: string;
  request: SystemRequest;
  ttlMs?: number;
};

export type SkillResult = {
  reply: string;
  action?: SkillAction;
  link?: { url: string; label: string };
  confirmation?: SkillConfirmation;
};

export const CALYX_CAPABILITIES = [
  'tell you the time and date',
  'set timers and reminders',
  'do calculations and unit conversions',
  'keep notes and lists for you',
  'open websites or search the web',
  'check the weather',
  'open apps and folders on this PC',
  'report system info like CPU, memory, disk and battery',
  'change the volume, mute, take a screenshot, or lock the PC',
  'find files in your Desktop, Documents and Downloads',
  'close apps, delete files to the Recycle Bin, or uninstall programs after a spoken confirmation',
  'compose or send email, shut down, restart or sleep the PC, and run PowerShell commands',
];

const NOTES_KEY = 'calyx-notes';
const WEATHER_CITY_KEY = 'calyx-weather-city';

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

const DURATION_UNITS: Record<string, { factor: number; canonical: 'second' | 'minute' | 'hour' }> = {
  second: { factor: 1_000, canonical: 'second' },
  seconds: { factor: 1_000, canonical: 'second' },
  sec: { factor: 1_000, canonical: 'second' },
  secs: { factor: 1_000, canonical: 'second' },
  minute: { factor: 60_000, canonical: 'minute' },
  minutes: { factor: 60_000, canonical: 'minute' },
  min: { factor: 60_000, canonical: 'minute' },
  mins: { factor: 60_000, canonical: 'minute' },
  hour: { factor: 3_600_000, canonical: 'hour' },
  hours: { factor: 3_600_000, canonical: 'hour' },
  hr: { factor: 3_600_000, canonical: 'hour' },
  hrs: { factor: 3_600_000, canonical: 'hour' },
};

const SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'google maps': 'https://maps.google.com',
  maps: 'https://maps.google.com',
  wikipedia: 'https://www.wikipedia.org',
  github: 'https://github.com',
  reddit: 'https://www.reddit.com',
  twitter: 'https://twitter.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  whatsapp: 'https://web.whatsapp.com',
  chatgpt: 'https://chat.openai.com',
  'chat gpt': 'https://chat.openai.com',
  amazon: 'https://www.amazon.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com',
  'stack overflow': 'https://stackoverflow.com',
  drive: 'https://drive.google.com',
  calendar: 'https://calendar.google.com',
  news: 'https://news.google.com',
};

type UnitDefinition = { group: string; factor: number; label: string };

const UNITS: Record<string, UnitDefinition> = {
  // Length (base: metre)
  mm: { group: 'length', factor: 0.001, label: 'millimetres' },
  millimeter: { group: 'length', factor: 0.001, label: 'millimetres' },
  millimeters: { group: 'length', factor: 0.001, label: 'millimetres' },
  cm: { group: 'length', factor: 0.01, label: 'centimetres' },
  centimeter: { group: 'length', factor: 0.01, label: 'centimetres' },
  centimeters: { group: 'length', factor: 0.01, label: 'centimetres' },
  m: { group: 'length', factor: 1, label: 'metres' },
  meter: { group: 'length', factor: 1, label: 'metres' },
  meters: { group: 'length', factor: 1, label: 'metres' },
  metre: { group: 'length', factor: 1, label: 'metres' },
  metres: { group: 'length', factor: 1, label: 'metres' },
  km: { group: 'length', factor: 1000, label: 'kilometres' },
  kilometer: { group: 'length', factor: 1000, label: 'kilometres' },
  kilometers: { group: 'length', factor: 1000, label: 'kilometres' },
  kilometre: { group: 'length', factor: 1000, label: 'kilometres' },
  kilometres: { group: 'length', factor: 1000, label: 'kilometres' },
  inch: { group: 'length', factor: 0.0254, label: 'inches' },
  inches: { group: 'length', factor: 0.0254, label: 'inches' },
  foot: { group: 'length', factor: 0.3048, label: 'feet' },
  feet: { group: 'length', factor: 0.3048, label: 'feet' },
  ft: { group: 'length', factor: 0.3048, label: 'feet' },
  yard: { group: 'length', factor: 0.9144, label: 'yards' },
  yards: { group: 'length', factor: 0.9144, label: 'yards' },
  mile: { group: 'length', factor: 1609.344, label: 'miles' },
  miles: { group: 'length', factor: 1609.344, label: 'miles' },
  mi: { group: 'length', factor: 1609.344, label: 'miles' },
  // Mass (base: gram)
  mg: { group: 'mass', factor: 0.001, label: 'milligrams' },
  g: { group: 'mass', factor: 1, label: 'grams' },
  gram: { group: 'mass', factor: 1, label: 'grams' },
  grams: { group: 'mass', factor: 1, label: 'grams' },
  kg: { group: 'mass', factor: 1000, label: 'kilograms' },
  kilogram: { group: 'mass', factor: 1000, label: 'kilograms' },
  kilograms: { group: 'mass', factor: 1000, label: 'kilograms' },
  ounce: { group: 'mass', factor: 28.349523125, label: 'ounces' },
  ounces: { group: 'mass', factor: 28.349523125, label: 'ounces' },
  oz: { group: 'mass', factor: 28.349523125, label: 'ounces' },
  pound: { group: 'mass', factor: 453.59237, label: 'pounds' },
  pounds: { group: 'mass', factor: 453.59237, label: 'pounds' },
  lb: { group: 'mass', factor: 453.59237, label: 'pounds' },
  lbs: { group: 'mass', factor: 453.59237, label: 'pounds' },
  stone: { group: 'mass', factor: 6350.29318, label: 'stone' },
  // Volume (base: litre)
  ml: { group: 'volume', factor: 0.001, label: 'millilitres' },
  millilitre: { group: 'volume', factor: 0.001, label: 'millilitres' },
  millilitres: { group: 'volume', factor: 0.001, label: 'millilitres' },
  milliliter: { group: 'volume', factor: 0.001, label: 'millilitres' },
  milliliters: { group: 'volume', factor: 0.001, label: 'millilitres' },
  l: { group: 'volume', factor: 1, label: 'litres' },
  litre: { group: 'volume', factor: 1, label: 'litres' },
  litres: { group: 'volume', factor: 1, label: 'litres' },
  liter: { group: 'volume', factor: 1, label: 'litres' },
  liters: { group: 'volume', factor: 1, label: 'litres' },
  gallon: { group: 'volume', factor: 3.785411784, label: 'gallons' },
  gallons: { group: 'volume', factor: 3.785411784, label: 'gallons' },
  cup: { group: 'volume', factor: 0.2365882365, label: 'cups' },
  cups: { group: 'volume', factor: 0.2365882365, label: 'cups' },
  pint: { group: 'volume', factor: 0.473176473, label: 'pints' },
  pints: { group: 'volume', factor: 0.473176473, label: 'pints' },
  // Speed (base: metre per second)
  'km/h': { group: 'speed', factor: 0.2777777778, label: 'kilometres per hour' },
  kmh: { group: 'speed', factor: 0.2777777778, label: 'kilometres per hour' },
  kph: { group: 'speed', factor: 0.2777777778, label: 'kilometres per hour' },
  'mph': { group: 'speed', factor: 0.44704, label: 'miles per hour' },
  'm/s': { group: 'speed', factor: 1, label: 'metres per second' },
  ms: { group: 'speed', factor: 1, label: 'metres per second' },
  // Data (base: megabyte)
  bit: { group: 'data', factor: 0.00000011920928955078125, label: 'bits' },
  byte: { group: 'data', factor: 0.00000095367431640625, label: 'bytes' },
  kb: { group: 'data', factor: 0.0009765625, label: 'kilobytes' },
  mb: { group: 'data', factor: 1, label: 'megabytes' },
  gb: { group: 'data', factor: 1024, label: 'gigabytes' },
  tb: { group: 'data', factor: 1048576, label: 'terabytes' },
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is optional; notes simply stay in memory for this turn.
  }
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return 'not a number';
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return null;
  let current = 0;
  for (const part of parts) {
    const value = NUMBER_WORDS[part];
    if (value === undefined) return null;
    if (value === 100) {
      current = (current || 1) * 100;
      continue;
    }
    current += value;
  }
  return current > 0 ? current : null;
}

/** Tiny recursive-descent evaluator. Avoids eval entirely. */
function evaluateExpression(expression: string): number | null {
  const tokens = expression.match(/\d+(?:\.\d+)?|[+\-*/%^()]/g);
  if (!tokens || tokens.join('') !== expression) return null;

  let index = 0;
  const peek = () => tokens[index];
  const parseExpression = (): number | null => {
    let value = parseTerm();
    if (value === null) return null;
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[index];
      index += 1;
      const right = parseTerm();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = (): number | null => {
    let value = parsePower();
    if (value === null) return null;
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = tokens[index];
      index += 1;
      const right = parsePower();
      if (right === null) return null;
      if (operator === '*') value *= right;
      else if (operator === '/') value = right === 0 ? Number.NaN : value / right;
      else value %= right;
    }
    return value;
  };
  const parsePower = (): number | null => {
    const base = parseUnary();
    if (base === null) return null;
    if (peek() === '^') {
      index += 1;
      const exponent = parsePower();
      return exponent === null ? null : Math.pow(base, exponent);
    }
    return base;
  };
  const parseUnary = (): number | null => {
    if (peek() === '-') {
      index += 1;
      const value = parseUnary();
      return value === null ? null : -value;
    }
    if (peek() === '+') {
      index += 1;
      return parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = (): number | null => {
    if (peek() === '(') {
      index += 1;
      const value = parseExpression();
      if (value === null) return null;
      if (peek() !== ')') return null;
      index += 1;
      return value;
    }
    if (tokens[index] === undefined) return null;
    const value = Number(tokens[index]);
    index += 1;
    return Number.isFinite(value) ? value : null;
  };

  const result = parseExpression();
  if (index !== tokens.length) return null;
  return result;
}

function parseDuration(text: string): { ms: number; label: string } | null {
  const tokens = text.toLowerCase().replace(/[^\w\s.]/g, ' ').split(/\s+/).filter(Boolean);
  for (let position = 0; position < tokens.length; position += 1) {
    const unit = DURATION_UNITS[tokens[position]];
    if (!unit) continue;
    const quantityTokens: string[] = [];
    for (let cursor = position - 1; cursor >= 0 && quantityTokens.length < 4; cursor -= 1) {
      const token = tokens[cursor];
      if (/^\d+(?:\.\d+)?$/.test(token) || NUMBER_WORDS[token] !== undefined) {
        quantityTokens.unshift(token);
        continue;
      }
      if (token === 'and' || token === 'a' || token === 'an') continue;
      break;
    }
    const quantity = parseQuantity(quantityTokens.join(' '));
    if (quantity && quantity > 0) {
      const rounded = Math.round(quantity * 100) / 100;
      return {
        ms: Math.round(quantity * unit.factor),
        label: `${formatNumber(rounded)} ${unit.canonical}${rounded === 1 ? '' : 's'}`,
      };
    }
  }
  return null;
}

function convertTemperature(value: number, from: string, to: string): number | null {
  const normalise = (unit: string) => {
    if (['c', 'celsius', 'centigrade', '°c'].includes(unit)) return 'c';
    if (['f', 'fahrenheit', '°f'].includes(unit)) return 'f';
    if (['k', 'kelvin'].includes(unit)) return 'k';
    return '';
  };
  const source = normalise(from);
  const target = normalise(to);
  if (!source || !target) return null;
  const celsius = source === 'c' ? value : source === 'f' ? (value - 32) / 1.8 : value - 273.15;
  if (target === 'c') return celsius;
  if (target === 'f') return celsius * 1.8 + 32;
  return celsius + 273.15;
}

function handleConversion(lower: string): SkillResult | null {
  const match = lower.match(/^(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*(°?[a-z/]+)\s+(?:to|in|into)\s+(°?[a-z/]+)\.?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const from = match[2];
  const to = match[3];

  const temperature = convertTemperature(value, from, to);
  if (temperature !== null) {
    return { reply: `${formatNumber(value)} degrees ${from.toUpperCase()} is ${formatNumber(temperature)} degrees ${to.toUpperCase()}.` };
  }

  const sourceUnit = UNITS[from];
  const targetUnit = UNITS[to];
  if (!sourceUnit || !targetUnit || sourceUnit.group !== targetUnit.group) return null;
  const result = (value * sourceUnit.factor) / targetUnit.factor;
  return { reply: `${formatNumber(value)} ${sourceUnit.label} is about ${formatNumber(result)} ${targetUnit.label}.` };
}

function handleCalculation(lower: string): SkillResult | null {
  let expression = lower.replace(/[\u2018\u2019]/g, "'").replace(/\?/g, ' ');

  expression = expression.replace(/square root of\s*(\d+(?:\.\d+)?)/g, '($1)^0.5');
  expression = expression.replace(/\bsqrt\s*(\d+(?:\.\d+)?)/g, '($1)^0.5');
  expression = expression.replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of/g, '($1/100)*');
  expression = expression.replace(/\bplus\b/g, '+');
  expression = expression.replace(/\bminus\b/g, '-');
  expression = expression.replace(/\btimes\b|\bmultiplied by\b/g, '*');
  expression = expression.replace(/\bdivided by\b/g, '/');
  expression = expression.replace(/\bover\b/g, '/');
  expression = expression.replace(/(\d)\s*x\s*(\d)/g, '$1*$2');
  expression = expression.replace(/\b(calculate|compute|what is|what's|whats|how much is|solve|evaluate|equals?|the answer to)\b/g, ' ');

  const cleaned = expression.replace(/\s+/g, '');
  if (!cleaned || !/^[\d+\-*/%^().]+$/.test(cleaned)) return null;
  if (!/[+\-*/%^]/.test(cleaned) || !/\d/.test(cleaned)) return null;

  const value = evaluateExpression(cleaned);
  if (value === null) return null;
  return { reply: `That comes to ${formatNumber(value)}.` };
}

function readNotes(): string[] {
  const stored = readJson<unknown>(NOTES_KEY, []);
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
}

function handleNotes(raw: string, lower: string): SkillResult | null {
  if (/\b(?:forget everything|clear my notes|delete my notes|clear my list|wipe my notes|clear everything)\b/.test(lower)) {
    writeJson(NOTES_KEY, []);
    return { reply: 'Done. I have cleared everything I was remembering.' };
  }

  if (/\b(?:what do you remember|what have you remembered|read (?:me )?my notes|read my list|show (?:me )?my (?:notes|list)|list my notes|what'?s (?:in|on) my (?:notes|list|shopping list))\b/.test(lower)) {
    const notes = readNotes();
    if (notes.length === 0) return { reply: 'You have not asked me to remember anything yet. Say "remember that" followed by whatever you want to keep.' };
    const spoken = notes.map((note, position) => `${position + 1}. ${note}`).join('. ');
    return { reply: `Here is what I remember. ${spoken}.` };
  }

  const targeted = raw.match(/^\s*(?:please\s+)?add\s+(.+?)\s+(?:to|in)\s+my\s+[\w\s]+(?:list|notes)\s*$/i);
  const general = raw.match(/^\s*(?:please\s+)?(?:remember|note down|make a note of|make a note|note that|note|save)\b\s*(?:that\s+|to\s+)?(.*)$/i);
  const item = (targeted ? targeted[1] : general ? general[1] : '').trim().replace(/[.!?]+$/, '');
  if (item) {
    const notes = readNotes();
    notes.push(item);
    writeJson(NOTES_KEY, notes);
    return { reply: `Got it. I will remember ${item}.` };
  }
  return null;
}

function weatherDescription(code: number): string {
  if (code === 0) return 'clear skies';
  if (code <= 2) return 'mainly clear skies';
  if (code === 3) return 'overcast skies';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code === 85 || code === 86) return 'snow showers';
  if (code >= 95) return 'thunderstorms';
  return 'mixed conditions';
}

async function handleWeather(lower: string): Promise<SkillResult | null> {
  if (!/\bweather\b/.test(lower)) return null;

  const placeMatch = lower.match(/\b(?:in|at|for)\s+([a-z\s'.-]{2,})$/);
  let place = placeMatch ? placeMatch[1].trim() : '';
  if (!place) {
    place = readJson<string>(WEATHER_CITY_KEY, '');
  }
  if (!place) {
    return { reply: 'Tell me which city you want, for example: what is the weather in Lagos.' };
  }

  try {
    const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`, { cache: 'no-store' });
    const geo = (await geoResponse.json()) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] };
    const hit = geo.results?.[0];
    if (!hit) return { reply: `I could not find a place called ${place}.` };
    writeJson(WEATHER_CITY_KEY, hit.name);

    const forecastResponse = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`, { cache: 'no-store' });
    const forecast = (await forecastResponse.json()) as { current?: { temperature_2m?: number; apparent_temperature?: number; relative_humidity_2m?: number; weather_code?: number; wind_speed_10m?: number } };
    const current = forecast.current;
    if (!current || typeof current.temperature_2m !== 'number') {
      return { reply: `I could not read the weather for ${hit.name} right now.` };
    }

    const description = weatherDescription(current.weather_code ?? 0);
    const feels = typeof current.apparent_temperature === 'number' ? ` It feels like ${formatNumber(current.apparent_temperature)} degrees.` : '';
    const humidity = typeof current.relative_humidity_2m === 'number' ? ` Humidity is ${formatNumber(current.relative_humidity_2m)} percent.` : '';
    const wind = typeof current.wind_speed_10m === 'number' ? ` Wind is ${formatNumber(current.wind_speed_10m)} kilometres per hour.` : '';
    return { reply: `In ${hit.name}, it is ${formatNumber(current.temperature_2m)} degrees with ${description}.${feels}${humidity}${wind}` };
  } catch {
    return { reply: 'I could not reach the weather service right now. Check the connection and try again.' };
  }
}

function handleTime(lower: string): SkillResult | null {
  const asksTime = /\btime\b/.test(lower) && /\b(what|what's|whats|tell|current|now|is it)\b/.test(lower);
  const asksDate = /\b(date|day)\b/.test(lower) && /\b(what|what's|whats|today|current|which|is it)\b/.test(lower);
  if (!asksTime && !asksDate) return null;

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (asksTime && asksDate) return { reply: `It is ${time} on ${date}.` };
  if (asksTime) return { reply: `It is ${time}.` };
  return { reply: `Today is ${date}.` };
}

function handleTimer(lower: string): SkillResult | null {
  if (!/\b(timer|remind me|reminder|countdown|alarm)\b/.test(lower)) return null;
  const duration = parseDuration(lower);
  if (!duration) {
    return { reply: 'How long should the timer run? For example: set a timer for five minutes.' };
  }
  return { reply: `Timer set for ${duration.label}. I will let you know when it is done.`, action: { type: 'timer', durationMs: duration.ms, label: duration.label } };
}

function handleRandom(lower: string): SkillResult | null {
  if (/\b(?:flip|toss)\s+(?:a\s+)?coin\b/.test(lower)) {
    return { reply: Math.random() < 0.5 ? 'It landed on heads.' : 'It landed on tails.' };
  }
  if (/\broll\s+(?:a\s+|the\s+)?(?:dice|die)\b/.test(lower)) {
    return { reply: `You rolled a ${1 + Math.floor(Math.random() * 6)}.` };
  }
  const range = lower.match(/random\s+number\s+between\s+(\d+)\s+and\s+(\d+)/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    const min = Math.min(low, high);
    const max = Math.max(low, high);
    return { reply: `Your number is ${min + Math.floor(Math.random() * (max - min + 1))}.` };
  }
  return null;
}

async function systemLookup<T>(request: SystemRequest): Promise<T | null> {
  try {
    const response = await fetch('/api/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function fileLabel(path: string) {
  const parts = path.split(/[\\/]/);
  const name = parts.pop() || path;
  const parent = parts.pop() || '';
  return parent ? `${name} from ${parent}` : name;
}

function emailDraft(address: string, detail: string) {
  const trimmed = detail.trim().replace(/^[,;]\s*/, '');
  let subject = 'Message from CALYX';
  let body = 'Sent from CALYX.';
  const about = trimmed.match(/^(?:about|regarding|re|with subject|subject)\s+(.+)$/i);
  const saying = trimmed.match(/^(?:saying|telling (?:them|him|her)|that|with the message)\s+(.+)$/i);
  if (about) subject = about[1].trim();
  else if (saying) {
    subject = 'Message from CALYX';
    body = saying[1].trim();
  } else if (trimmed) {
    subject = trimmed;
  }
  return { to: address, subject, body };
}

async function handleDestructive(raw: string, lower: string): Promise<SkillResult | null> {
  if (/\b(?:cancel|abort|stop)\s+(?:the\s+)?(?:shut\s?down|shutdown|restart|reboot)\b/.test(lower)) {
    return { reply: '', action: { type: 'system', request: { action: 'power', mode: 'cancel' } } };
  }

  if (/^(?:shut\s?down|shutdown)\b/.test(lower)) {
    return { reply: '', confirmation: { question: 'Shut down this PC in 30 seconds? Say yes or no.', request: { action: 'power', mode: 'shutdown' }, ttlMs: 20_000 } };
  }

  if (/^(?:restart|reboot)\b/.test(lower)) {
    return { reply: '', confirmation: { question: 'Restart this PC in 30 seconds? Say yes or no.', request: { action: 'power', mode: 'restart' }, ttlMs: 20_000 } };
  }

  if (/^(?:sleep|suspend|go\s+to\s+sleep)\b/.test(lower) || /^(?:turn\s+off|power\s+off)\s+(?:the\s+)?(?:pc|computer|system|laptop)\b/.test(lower)) {
    return { reply: '', confirmation: { question: 'Put this PC to sleep? Say yes or no.', request: { action: 'power', mode: 'sleep' }, ttlMs: 20_000 } };
  }

  const runMatch =
    raw.match(/^\s*(?:run|execute)\s+(?:the\s+)?(?:powershell|command|cmd)\s+([\s\S]+)$/i) ||
    raw.match(/^\s*powershell\s+([\s\S]+)$/i);
  if (runMatch) {
    const command = runMatch[1].trim();
    if (!command) return { reply: 'Tell me the command to run, for example: run command ipconfig.' };
    if (isBlockedCommand(command)) {
      return { reply: 'I will not run that command. It can damage Windows, so give me a more specific and safer one.' };
    }
    const preview = command.length > 180 ? `${command.slice(0, 180)}...` : command;
    return { reply: '', confirmation: { question: `Run this PowerShell command? ${preview}. Say yes or no.`, request: { action: 'run-command', command }, ttlMs: 30_000 } };
  }

  const uninstall =
    lower.match(/^(?:uninstall|remove)\s+(?:the\s+)?(?:app|application|program)\s+(.+)$/) ||
    lower.match(/^(?:uninstall|remove)\s+(.+?)\s+(?:from|off)\s+(?:my\s+|this\s+)?(?:pc|computer|system)$/) ||
    lower.match(/^uninstall\s+(.+)$/);
  const bareRemove = lower.match(/^remove\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|program))?$/);
  const uninstallQuery = (uninstall ? uninstall[1] : bareRemove && APP_ALIASES[bareRemove[1].trim()] ? bareRemove[1] : '').trim();

  if (uninstallQuery) {
    const data = await systemLookup<{ names?: string[] }>({ action: 'find-app', query: uninstallQuery });
    if (!data) return { reply: 'I could not search your installed programs. Make sure the app server is running.' };
    const names = (data.names || []).filter(Boolean);
    if (names.length === 0) return { reply: `I could not find an installed program matching ${uninstallQuery}.` };
    if (names.length > 1) {
      const listed = names.slice(0, 3).join(', ');
      const extra = names.length > 3 ? ` and ${names.length - 3} more` : '';
      return { reply: `I found ${listed}${extra}. Say uninstall followed by the full name.` };
    }
    return {
      reply: '',
      confirmation: {
        question: `Uninstall ${names[0]}? This opens its uninstaller. Say yes or no.`,
        request: { action: 'uninstall-app', name: names[0] },
        ttlMs: 25_000,
      },
    };
  }

  const close = lower.match(/^(?:close|quit|exit|stop)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:app|application|window))?$/);
  if (close) {
    const target = close[1].trim();
    const app = APP_ALIASES[target];
    if (app) {
      return { reply: '', confirmation: { question: `Close ${app.label}? Say yes or no.`, request: { action: 'close-app', app: app.id }, ttlMs: 20_000 } };
    }
    if (target === 'browser' || target === 'browsers') {
      return { reply: 'Which browser — Chrome, Edge or Firefox?' };
    }
    // "stop the timer" and similar are not app closes — let other skills answer.
    if (/^stop\b/.test(lower)) return null;
    return { reply: `I do not have a close action for ${target}. I can close apps like Notepad, Calculator, Chrome, Edge, Word or Spotify.` };
  }

  const directEmail =
    raw.match(/^\s*(?:send|shoot)\s+(?:an?\s+)?email\s+to\s+([^\s,]+@[^\s,]+\.[a-z]{2,})(?:\s+(.*))?$/i) ||
    raw.match(/^\s*send\s+([^\s,]+@[^\s,]+\.[a-z]{2,})\s+an?\s+email(?:\s+(.*))?$/i);
  if (directEmail) {
    const draft = emailDraft(directEmail[1], directEmail[2] || '');
    const detail =
      draft.subject === 'Message from CALYX' && draft.body !== 'Sent from CALYX.'
        ? `saying ${draft.body}`
        : `with subject ${draft.subject}`;
    return {
      reply: '',
      confirmation: {
        question: `Send an email to ${draft.to} ${detail}? Say yes or no.`,
        request: { action: 'send-email', to: draft.to, subject: draft.subject, body: draft.body },
        ttlMs: 30_000,
      },
    };
  }

  const composeEmail =
    raw.match(/^\s*(?:compose|write|draft)\s+(?:an?\s+)?(?:new\s+)?email\s+to\s+([^\s,]+@[^\s,]+\.[a-z]{2,})(?:\s+(.*))?$/i) ||
    raw.match(/^\s*(?:email|mail)\s+([^\s,]+@[^\s,]+\.[a-z]{2,})(?:\s+(.*))?$/i);
  if (composeEmail) {
    const draft = emailDraft(composeEmail[1], composeEmail[2] || '');
    const mailto = `mailto:${draft.to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    return {
      reply: `Opening a new email to ${draft.to} about ${draft.subject}. Review it and press Send.`,
      action: { type: 'open-email', to: draft.to, subject: draft.subject, body: draft.body },
      link: { url: mailto, label: `Email: ${draft.to}` },
    };
  }

  const del = lower.match(/^(?:delete|remove|trash)\s+(?:the\s+|my\s+)?(?:file\s+)?(.+)$/);
  if (del) {
    let query = del[1].trim().replace(/^(?:called|named)\s+/, '').replace(/\s+(?:file|folder|directory)$/, '');
    let folder: 'downloads' | 'documents' | 'desktop' | undefined;
    const scoped = query.match(/^(.*?)\s+(?:from|in)\s+(?:my\s+)?(downloads|documents|desktop)$/);
    if (scoped) {
      query = scoped[1].trim();
      folder = scoped[2] as 'downloads' | 'documents' | 'desktop';
    }
    if (!query) return { reply: 'Which file should I delete?' };
    if (/^(?:downloads|documents|desktop|pictures|music|videos|folder|directory|everything|files)$/.test(query)) {
      return { reply: 'I can only delete individual files, not folders. Tell me the file name.' };
    }
    const data = await systemLookup<{ paths?: string[] }>({ action: 'find-file', query, folder });
    if (!data) return { reply: 'I could not search your files. Make sure the app server is running.' };
    const paths = (data.paths || []).filter(Boolean);
    if (paths.length === 0) return { reply: `I could not find a file matching ${query} in ${folder ? folder : 'Desktop, Documents or Downloads'}.` };
    if (paths.length > 1) {
      const listed = paths.slice(0, 3).map((path) => fileLabel(path)).join(', ');
      return { reply: `I found ${paths.length} matches: ${listed}. Say delete with the folder name or a more specific file name.` };
    }
    return {
      reply: '',
      confirmation: {
        question: `Delete ${fileLabel(paths[0])}? It will go to the Recycle Bin. Say yes or no.`,
        request: { action: 'delete-file', path: paths[0] },
        ttlMs: 25_000,
      },
    };
  }

  return null;
}

function handleSystem(lower: string): SkillResult | null {
  const wantsInfo =
    /^(?:system|system info|specs|my specs)\s*[?.!]?$/.test(lower) ||
    /\b(?:system info|system information|system status|system report|system specs?|system specifications?)\b/.test(lower) ||
    /\b(?:what|which)\s+(?:my|this|the)\s+(?:system|pc|computer|device|machine|laptop)\b/.test(lower) ||
    /\b(?:tell|show|give)\s+me\s+(?:my|the)\s+(?:system|pc|computer|device|machine|laptop)\b/.test(lower) ||
    /\b(?:tell me about|describe|what'?s|what is)\s+(?:my|this)\s+(?:system|pc|computer|device|machine|laptop|setup)\b/.test(lower) ||
    /\b(?:my|this)\s+(?:system|pc|computer|device|machine|laptop)\s+(?:specs?|specifications?|info|information|details|status)\b/.test(lower) ||
    /\b(?:specs?|specifications?)\s+(?:of|for)\s+(?:my|this|the)\s+(?:pc|computer|system|device|machine|laptop)\b/.test(lower) ||
    /\bmy\s+(?:specs?|specifications)\b/.test(lower) ||
    /\bwhat (?:operating system|os)\b/.test(lower) ||
    /\bwhat system (?:am i (?:running|using|on)|is (?:this|my))\b/.test(lower) ||
    /\b(?:which|what) (?:version of )?windows\b/.test(lower) ||
    /\bhow much (?:ram|memory|disk|storage|space)\b/.test(lower) ||
    /\b(?:cpu|processor|memory|ram|disk|storage|battery|uptime)\b.*\b(?:usage|used|free|left|available|level|percent|status|remaining)\b/.test(lower) ||
    /\b(?:what'?s|what is|check|show|tell me)\b.*\b(?:cpu|ram|memory|disk|storage|battery|uptime)\b/.test(lower);
  if (wantsInfo) {
    return { reply: '', action: { type: 'system', request: { action: 'system-info' } } };
  }

  if (/\bscreenshot\b|\bcapture (?:the )?screen\b|\bprint screen\b/.test(lower)) {
    return { reply: '', action: { type: 'system', request: { action: 'screenshot' } } };
  }

  if (/\block\b.*\b(?:pc|computer|screen|system|windows|workstation)\b/.test(lower)) {
    return { reply: '', action: { type: 'system', request: { action: 'lock' } } };
  }

  const setVolumeMatch =
    lower.match(/\b(?:set|change|turn)\s+(?:the\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*(?:%|percent)?\b/) ||
    lower.match(/^(?:set )?volume (?:to )?(\d{1,3})\s*(?:%|percent)?$/);
  if (setVolumeMatch) {
    const level = Number(setVolumeMatch[1]);
    if (level >= 0 && level <= 100) {
      return { reply: '', action: { type: 'system', request: { action: 'set-volume', level } } };
    }
  }

  if (/\bunmute\b|\bun-mute\b/.test(lower)) {
    return { reply: '', action: { type: 'system', request: { action: 'volume', direction: 'unmute' } } };
  }

  if (/\bmute\b/.test(lower)) {
    return { reply: '', action: { type: 'system', request: { action: 'volume', direction: 'mute' } } };
  }

  if (/\b(?:volume\s+(?:up|down)|turn\s+(?:it|the volume)\s+(?:up|down)|louder|quieter)\b/.test(lower)) {
    const direction: 'up' | 'down' = /\b(?:down|quieter|lower)\b/.test(lower) ? 'down' : 'up';
    const by = lower.match(/\bby\s+(\d{1,2})\b/);
    const steps = by ? Number(by[1]) : 1;
    return { reply: '', action: { type: 'system', request: { action: 'volume', direction, steps } } };
  }

  const list = lower.match(
    /\b(?:what'?s in|what is in|list|show me|show the contents of|contents of)\s+(?:my\s+|the\s+)?(downloads|documents|desktop|pictures|music|videos|home|profile|temp)\b/,
  );
  if (list) {
    const folder = FOLDER_ALIASES[list[1]];
    if (folder) return { reply: '', action: { type: 'system', request: { action: 'list-folder', folder: folder.id } } };
  }

  // Photo and image scanning: dates, resolution and counts from file metadata.
  const wantsImages =
    /\b(?:scan|scan through|go through|analyse|analyze|check|look at|browse|review|sort through)\b[^.]{0,30}\b(?:photos?|pictures?|images?|screenshots?|gallery)\b/.test(
      lower,
    ) ||
    /\b(?:photos?|pictures?|images?|screenshots?)\b[^.]{0,30}\b(?:scan|analyse|analyze|how many|count|list|tell me|report|projects?|organi[sz]e|by date)\b/.test(
      lower,
    ) ||
    /\bhow many (?:photos?|pictures?|images?|screenshots?)\b/.test(lower) ||
    /\b(?:tell me about|report on|summari[sz]e)\b[^.]{0,25}\b(?:photos?|pictures?|images?|gallery)\b/.test(lower) ||
    /\bmy (?:photos?|pictures?|images?|gallery)\b[^.]{0,25}\b(?:projects?|work|designs?)\b/.test(lower) ||
    /\bscan\b[^.]{0,30}\b(?:photo|picture|image)\b/.test(lower);
  if (wantsImages) {
    const folderMatch =
      lower.match(/\b(?:in|from|inside|under)\s+(?:my\s+|the\s+)?(pictures|downloads|documents|desktop|videos)\b/) ||
      lower.match(/\b(?:my|the)\s+(pictures|downloads|documents|desktop|videos)\b/) ||
      lower.match(/\b(pictures|downloads|documents|desktop|videos)\b/);
    const folder = folderMatch ? FOLDER_ALIASES[folderMatch[1]] : FOLDER_ALIASES.pictures;
    const stop = new Set([
      'my', 'the', 'photos', 'photo', 'pictures', 'picture', 'images', 'image', 'gallery', 'scan', 'through',
      'go', 'analyze', 'analyse', 'check', 'look', 'at', 'browse', 'review', 'sort', 'tell', 'me', 'about',
      'report', 'on', 'summarize', 'summarise', 'how', 'many', 'all', 'in', 'from', 'and', 'projects',
      'project', 'created', 'made', 'of', 'please', 'can', 'you', 'for', 'folder', 'screenshots', 'screenshot',
      'downloads', 'documents', 'desktop', 'videos', 'have', 'there', 'right', 'that', 'this', 'want', 'need',
      'would', 'like', 'know', 'see', 'show', 'give', 'get', 'hey', 'calyx', 'okay', 'alright', 'well',
      'them', 'those', 'these', 'with', 'into', 'over', 'some', 'any', 'much', 'more', 'then', 'also', 'just',
      'created', 'work', 'designs', 'are', 'is', 'was', 'were', 'do', 'does', 'did', 'up', 'so', 'out', 'it',
    ]);
    const words = lower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word));
    const query = (folderMatch ? words.filter((word) => word !== folderMatch[1]) : words).join(' ').slice(0, 40);
    return {
      reply: '',
      action: { type: 'system', request: { action: 'scan-images', folder: folder?.id || 'pictures', query } },
    };
  }

  // Close apps
  const closeMatch = lower.match(/\b(?:close|quit|exit|kill|stop)\s+(?:the\s+|my\s+)?([a-z0-9\s+-]+?)(?:\s+(?:app|application|program))?\b/);
  if (closeMatch) {
    const target = closeMatch[1]
      .trim()
      .replace(/\b(?:app|application|program|window|please|now|right now|thanks|thank you)\b/g, '')
      .trim();
    const normalized = target.toLowerCase();
    const app = APP_ALIASES[normalized];
    if (app) {
      return {
        reply: '',
        confirmation: {
          question: `Close ${app.label}? Say yes or no.`,
          request: { action: 'close-app', app: app.id },
          ttlMs: 20_000,
        },
      };
    }
    // Try fuzzy match on head
    const head = normalized.split(/\s+(?:and|then|for|to)\s+/)[0].trim();
    const headApp = APP_ALIASES[head];
    if (headApp) {
      return {
        reply: '',
        confirmation: {
          question: `Close ${headApp.label}? Say yes or no.`,
          request: { action: 'close-app', app: headApp.id },
          ttlMs: 20_000,
        },
      };
    }
    // If we can't resolve it, just pass to the bridge logic by suggesting
    return {
      reply: `I can close apps like Notepad, Calculator, Chrome, Edge, Word or Spotify.`,
    };
  }

  // Allow filler before the command ("so I want you to open the app store")
  // because speech recognition often prefixes a sentence with chatter.
  const open = lower.match(/\b(?:open|launch|start|run)\s+(?:up\s+)?(?:the\s+|my\s+|a\s+)?(.+)$/);
  if (open) {
    const rawTarget = open[1]
      .trim()
      .replace(/\s+(?:app|application|folder|directory|program)$/, '')
      .replace(/\b(?:for me|please|now|right now|thanks|thank you)\b/g, '')
      .replace(/[?.!]+$/, '')
      .trim();
    const target = rawTarget;
    const normalized = target.toLowerCase().replace(/[?.!]+$/, '');
    const app = APP_ALIASES[normalized] || APP_ALIASES[target.toLowerCase()];
    if (app) return { reply: `Opening ${app.label}.`, action: { type: 'system', request: { action: 'open-app', app: app.id } } };
    const folder = FOLDER_ALIASES[normalized] || FOLDER_ALIASES[target.toLowerCase()];
    if (folder) return { reply: `Opening ${folder.label}.`, action: { type: 'system', request: { action: 'open-folder', folder: folder.id } } };
    // Long trailing chatter should not silently become a file search target.
    const head = normalized.split(/\s+(?:and|then|so that|for|to)\s+/)[0].trim();
    const headApp = APP_ALIASES[head];
    if (headApp) return { reply: `Opening ${headApp.label}.`, action: { type: 'system', request: { action: 'open-app', app: headApp.id } } };
    const headFolder = FOLDER_ALIASES[head];
    if (headFolder) return { reply: `Opening ${headFolder.label}.`, action: { type: 'system', request: { action: 'open-folder', folder: headFolder.id } } };
    // Fuzzy search: if it's a reasonable name, try opening it directly via the bridge.
    if (normalized.length > 1 && !/^\d+$/.test(normalized)) {
      return { reply: `Opening ${target}.`, action: { type: 'system', request: { action: 'open-app', app: normalized } } };
    }
  }

  return null;
}

function handleOpenOrSearch(lower: string): SkillResult | null {
  const youtubeSearch = lower.match(/^(?:search\s+youtube\s+for|youtube)\s+(.+)$/);
  if (youtubeSearch) {
    const query = youtubeSearch[1].trim().replace(/\s+on\s+youtube$/, '');
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return { reply: `Searching YouTube for ${query}.`, action: { type: 'open-url', url }, link: { url, label: `YouTube: ${query}` } };
  }

  const search = lower.match(/^(?:search(?:\s+for)?|google|look\s+up|find)\s+(.+)$/);
  if (search) {
    const query = search[1].trim().replace(/\s+on\s+google$/, '').replace(/[?.!]+$/, '');
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return { reply: `Searching the web for ${query}.`, action: { type: 'open-url', url }, link: { url, label: `Search: ${query}` } };
  }

  const open = lower.match(/^(?:open|go to|launch|visit)\s+(.+)$/);
  if (open) {
    const target = open[1]
      .trim()
      .replace(/\s+(?:website|web page|page)$/, '')
      .replace(/^the\s+/, '')
      .replace(/\b(?:for me|please|now|right now|thanks|thank you)\b/g, '')
      .trim();
    const normalized = target.toLowerCase();
    const site = SITES[normalized] || SITES[target];
    if (site) {
      return { reply: `Opening ${target}.`, action: { type: 'open-url', url: site }, link: { url: site, label: target } };
    }
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized)) {
      const url = `https://${normalized}`;
      return { reply: `Opening ${normalized}.`, action: { type: 'open-url', url }, link: { url, label: normalized } };
    }
    const url = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    return { reply: `Searching the web for ${target}.`, action: { type: 'open-url', url }, link: { url, label: `Search: ${target}` } };
  }

  return null;
}

function handleHelp(lower: string): SkillResult | null {
  // Collapse punctuation so "capable are you? how strong" and comma-joined
  // dictation both still read as capability questions.
  const flat = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const exact = /^(?:help|commands|capabilities)$/.test(flat);
  const listApps = /\b(?:list|show|tell me)\b.*\b(?:apps?|applications?|programs?)\b.*\b(?:manipulat|control|open|close|use)\b/.test(flat) ||
    /\bwhat apps?\b.*\b(?:can|do you)\b.*\b(?:manipulat|control|open|close)\b/.test(flat) ||
    /\bapps?\b.*\byou can\b.*\b(?:manipulat|control|open|close|do)\b/.test(flat);
  if (listApps) {
    const appList = Object.values(APP_ALIASES)
      .map((a) => a.label)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 30)
      .join(', ');
    return {
      reply: `I can open, launch, or control apps on your PC. Common ones I know: ${appList}. If you say "open [app name]", I'll try to launch it. I can also close apps, uninstall programs (with confirmation), change volume, take screenshots, lock your PC, and more. For anything not listed, just ask - I'll try my best.`,
    };
  }
  const generic =
    /\bhow (?:capable|strong|powerful|smart|advanced|good|useful) (?:are|is) you\b/.test(flat) ||
    /\bhow (?:capable|strong|powerful|smart|advanced|good|useful) you are\b/.test(flat) ||
    /\bwhat are you capable of\b/.test(flat) ||
    /\bwhat (?:are|do) your (?:abilities|skills|features|functions|powers|capabilities|commands|talents)\b/.test(flat) ||
    /\bwhat can you (?:do|actually do|really do|do for me|do for us|handle|manage|help with)\b/.test(flat) ||
    /\bwhat else can you (?:do|handle|manage|help with)\b/.test(flat) ||
    /\bwhat (?:all )?can you (?:do|handle)\b/.test(flat) ||
    /\byour (?:abilities|skills|capabilities|features|functions|powers|talents)\b/.test(flat) ||
    /\b(?:tell me|describe|explain|list|show me)\b[^.]{0,40}\b(?:abilities|skills|capabilities|features|functions|powers|commands|talents)\b/.test(
      flat,
    );
  const specific =
    /\bcan you (?:send (?:an? )?emails?|uninstall|delete (?:a )?files?|delete|close (?:an? )?apps?|close|run (?:a )?commands?|run|shut ?down|shutdown|restart|reboot|sleep|power|screenshots?|take a screenshot|lock|stop|kill|write|create|make|save|keep|remember|join|play|change|type|manage (?:my )?(?:apps|programs|notes|files|email)|control)\b/.test(
      flat,
    ) ||
    /\b(?:do you|are you able to) (?:send|uninstall|delete|close|run|shut|restart|sleep|write|create|make|manage|control|type|play|change)\b/.test(
      flat,
    );
  const askedAbout = /\bcapab|\bstrong\b|\bhow are you\b/.test(flat);
  if (!exact && !generic && !specific && !askedAbout && !listApps) return null;
  if (!generic && !exact && !askedAbout && specific) {
    return {
      reply: `Yes, when it is on this list: I can ${CALYX_CAPABILITIES.join(', ')}. Anything destructive asks you to confirm with yes or no first.`,
    };
  }
  if (!generic && !exact && askedAbout && !specific) return null;
  return { reply: `I can ${CALYX_CAPABILITIES.join(', ')}. Just ask naturally, and I will also answer anything else with the AI brain.` };
}

/**
 * Try to satisfy the request locally. Returns null when the request should be
 * handed to the language model instead.
 */
export async function runSkill(rawInput: string): Promise<SkillResult | null> {
  const text = rawInput.trim();
  if (!text) return null;
  const lower = text.toLowerCase().replace(/\s+/g, ' ');

  if (
    /^(?:stop|stop it|be quiet|silence|shut up|quiet|that'?s all)\s*[.!]?$/.test(lower) ||
    /\b(?:stop (?:talking|speaking)|shut up|be quiet|that'?s all)\b/.test(lower)
  ) {
    return { reply: '', action: { type: 'stop-speaking' } };
  }

  if (/\b(?:clear|reset|forget)\s+(?:the\s+)?(?:conversation|chat|transcript|history)\b/.test(lower)) {
    return { reply: 'Cleared. The conversation is starting fresh.', action: { type: 'clear-conversation' } };
  }

  const help = handleHelp(lower);
  if (help) return help;

  const notes = handleNotes(text, lower);
  if (notes) return notes;

  const timer = handleTimer(lower);
  if (timer) return timer;

  const time = handleTime(lower);
  if (time) return time;

  const weather = await handleWeather(lower);
  if (weather) return weather;

  const conversion = handleConversion(lower);
  if (conversion) return conversion;

  const calculation = handleCalculation(lower);
  if (calculation) return calculation;

  const random = handleRandom(lower);
  if (random) return random;

  const destructive = await handleDestructive(text, lower);
  if (destructive) return destructive;

  const system = handleSystem(lower);
  if (system) return system;

  return handleOpenOrSearch(lower);
}
