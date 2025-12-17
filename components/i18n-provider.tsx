"use client";

import * as React from "react";

import type { Locale } from "@/lib/i18n/locales";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_LOCALSTORAGE_KEY,
  normalizeLocale,
} from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/translate";
import { getMessage, interpolate } from "@/lib/i18n/translate";

import en from "@/lib/i18n/messages/en.json";
import de from "@/lib/i18n/messages/de.json";
import fr from "@/lib/i18n/messages/fr.json";
import it from "@/lib/i18n/messages/it.json";
import es from "@/lib/i18n/messages/es.json";

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const MESSAGES: Record<Locale, Messages> = {
  en: en as Messages,
  de: de as Messages,
  fr: fr as Messages,
  it: it as Messages,
  es: es as Messages,
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (
    keyPath: string,
    vars?: Record<string, string | number | boolean | null | undefined>
  ) => string;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const all = document.cookie ? document.cookie.split(";") : [];
  for (const part of all) {
    const [rawKey, ...rawVal] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawVal.join("="));
  }
  return null;
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  // If the server didn't have a locale cookie for some reason, allow localStorage
  // to restore the preference client-side without requiring URL changes.
  React.useEffect(() => {
    const cookieLocale = normalizeLocale(getCookieValue(LOCALE_COOKIE_NAME));
    if (cookieLocale) return;

    try {
      const stored = normalizeLocale(localStorage.getItem(LOCALE_LOCALSTORAGE_KEY));
      if (stored && stored !== locale) setLocaleState(stored);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist locale and keep <html lang> in sync.
  React.useEffect(() => {
    document.documentElement.lang = locale;

    document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(
      locale
    )}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}`;

    try {
      localStorage.setItem(LOCALE_LOCALSTORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next || DEFAULT_LOCALE);
  }, []);

  const t = React.useCallback<I18nContextValue["t"]>(
    (keyPath, vars) => {
      const template =
        getMessage(MESSAGES[locale], keyPath) ??
        getMessage(MESSAGES[DEFAULT_LOCALE], keyPath) ??
        keyPath;
      return interpolate(template, vars);
    },
    [locale]
  );

  const value = React.useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [
    locale,
    setLocale,
    t,
  ]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider.");
  }
  return ctx;
}


