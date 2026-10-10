import { useCallback } from "react";
import { catalogs, de, type MessageKey } from "./de";

/** `en` is typed for the parked second locale; only `de` is in catalogs today. */
export type Locale = "de" | "en";

let activeLocale: Locale = "de";

export function setLocale(locale: Locale): void {
  if (catalogs[locale] === undefined) {
    throw new Error(`unknown_locale:${locale}`);
  }
  activeLocale = locale;
}

export function t(key: MessageKey, locale: Locale = activeLocale): string {
  return (catalogs[locale] ?? de)[key];
}

export function useT(locale: Locale = activeLocale): (key: MessageKey) => string {
  return useCallback((key: MessageKey) => t(key, locale), [locale]);
}
