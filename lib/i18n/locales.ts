export const SUPPORTED_LOCALES = ["en", "de", "fr", "it", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE_NAME = "locale";
export const LOCALE_LOCALSTORAGE_KEY = "locale";

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Normalizes a locale-like string to one of the supported locales.
 *
 * Examples:
 * - "EN" -> "en"
 * - "de-DE" -> "de"
 * - "fr_CA" -> "fr"
 */
export function normalizeLocale(input: unknown): Locale | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept either "-" or "_" separators.
  const normalized = trimmed.replace(/_/g, "-").toLowerCase();
  const primary = normalized.split("-")[0];

  return isLocale(primary) ? primary : null;
}

function parseAcceptLanguage(headerValue: string): Array<{ tag: string; q: number; idx: number }> {
  return headerValue
    .split(",")
    .map((part, idx) => {
      const [rawTag, ...params] = part.trim().split(";").map((s) => s.trim());
      if (!rawTag || rawTag === "*") return null;
      let q = 1;
      for (const p of params) {
        const m = p.match(/^q=(\d*(?:\.\d+)?)$/i);
        if (m?.[1]) {
          const parsed = Number(m[1]);
          if (!Number.isNaN(parsed)) q = parsed;
        }
      }
      return { tag: rawTag, q, idx };
    })
    .filter((x): x is { tag: string; q: number; idx: number } => Boolean(x))
    .sort((a, b) => (b.q !== a.q ? b.q - a.q : a.idx - b.idx));
}

/**
 * Picks the best supported locale based on an Accept-Language header value.
 * Falls back to DEFAULT_LOCALE when no match is found.
 */
export function bestLocaleFromAcceptLanguage(headerValue: string | null | undefined): Locale {
  if (typeof headerValue !== "string" || !headerValue.trim()) return DEFAULT_LOCALE;

  const parsed = parseAcceptLanguage(headerValue);
  for (const candidate of parsed) {
    const locale = normalizeLocale(candidate.tag);
    if (locale) return locale;
  }

  return DEFAULT_LOCALE;
}


