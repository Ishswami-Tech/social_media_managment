import { issue, type CheckInput } from "./types";
import { briefText, normalizeUrl } from "./text-utils";

const URL_PATTERN = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/giu;

export function extractUrls(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}

/** URLs allowed in a post: claim sources, research sources and anything in the campaign brief. */
export function allowedUrls(input: CheckInput): Set<string> {
  const fromClaims = input.claims.flatMap((c) => (c.sourceUrl ? [c.sourceUrl] : []));
  const fromBrief = extractUrls(briefText(input.brief, input.research));
  return new Set([...fromClaims, ...fromBrief].map(normalizeUrl));
}

export const urlsCheck = (input: CheckInput) => {
  const allowed = allowedUrls(input);
  return extractUrls(input.text).flatMap((raw) => {
    const url = normalizeUrl(raw);
    if (!/^https?:\/\//.test(url)) return [issue("url_scheme", `URL "${raw}" must use http(s)`)];
    if (!allowed.has(url)) return [issue("url_unknown", `URL "${raw}" is not a claim source or part of the brief`)];
    return [];
  });
};
