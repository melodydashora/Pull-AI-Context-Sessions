// Which provider a session belongs to (docs/import-rules.md W9). Decided, in this order, by
// the host of a link the input comes with, by the speaker labels actually used, else "other".
// Words in the content are never used (D2).

import { parseUrl } from "./platform.ts";
import type { Provider } from "./types.ts";

type KnownProvider = Exclude<Provider, "other">;

/**
 * W9: a host matches a domain if it equals it or ends with a dot plus it. Apart from
 * claude.ai these hosts were never checked against a live page. capture.md 7.1 is to own
 * this list once its data file is built; until then this is the one list.
 */
const PROVIDER_DOMAINS: readonly (readonly [domain: string, provider: KnownProvider])[] = [
  ["claude.ai", "claude"],
  ["chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["gemini.google.com", "gemini"],
  ["gemini.google", "gemini"],
  ["bard.google.com", "gemini"],
];

function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** W9 step 1: the provider of the host of a URL; null when the host is not a known one. */
export function providerForUrl(url: string): KnownProvider | null {
  const parsed = parseUrl(url);
  if (parsed === null) return null;
  const host = parsed.hostname.toLowerCase();
  for (const [domain, provider] of PROVIDER_DOMAINS) {
    if (isUnder(host, domain)) return provider;
  }
  // W9: g.co with a path starting /gemini.
  if (isUnder(host, "g.co") && parsed.pathname.startsWith("/gemini")) return "gemini";
  return null;
}

/** W9 step 2: `claude...` labels are Claude, `chatgpt...` and `gpt` ChatGPT, `gemini...` Gemini. */
export function providerOfLabel(name: string): KnownProvider | null {
  if (name.startsWith("claude")) return "claude";
  if (name.startsWith("chatgpt") || name === "gpt") return "chatgpt";
  if (name.startsWith("gemini")) return "gemini";
  return null;
}

/** The value that occurs most often; the one seen first wins a tie. null for an empty list. */
export function mostFrequent<T>(values: readonly T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  // A Map keeps the order of first insertion, so a later value needs a strictly larger count.
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** W9 step 2 over the names of the markers used (lower case, as `RoleMarker.name`). */
export function providerFromLabels(names: readonly string[]): KnownProvider | null {
  const providers: KnownProvider[] = [];
  for (const name of names) {
    const provider = providerOfLabel(name);
    if (provider !== null) providers.push(provider);
  }
  return mostFrequent(providers);
}
