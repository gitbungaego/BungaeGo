import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { catalog } from "./catalog";
import {
  DEFAULT_LOCALE,
  INTL_TAG,
  LOCALES,
  STORAGE_KEY,
  isLocaleCode,
  type LocaleCode,
} from "./locales";

type Vars = Record<string, string | number>;

interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  t: (key: string, vars?: Vars) => string;
  /** Intl BCP-47 태그 (toLocaleDateString 등). */
  intlTag: string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function applyHtmlLang(code: LocaleCode) {
  const meta = LOCALES.find((l) => l.code === code);
  if (meta) document.documentElement.lang = meta.htmlLang;
}

// {var} 플레이스홀더 치환.
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLocaleCode(stored)) return stored;
    } catch {}
    return DEFAULT_LOCALE;
  });

  useEffect(() => {
    applyHtmlLang(locale);
  }, [locale]);

  const setLocale = useCallback((code: LocaleCode) => {
    setLocaleState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {}
  }, []);

  // 현재 로케일 → 없으면 한국어 폴백 → 없으면 key 그대로 (절대 빈칸 없음).
  const t = useCallback(
    (key: string, vars?: Vars) => {
      const table = catalog[locale] ?? catalog.ko;
      const raw = table[key] ?? catalog.ko[key] ?? key;
      return interpolate(raw, vars);
    },
    [locale]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t, intlTag: INTL_TAG[locale] }),
    [locale, setLocale, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT/useLocale must be used within LocaleProvider");
  return ctx;
}

/** 번역 함수 훅. `const t = useT(); t("key", { name })`. */
export function useT() {
  return useLocaleContext().t;
}

/** 현재 로케일 + 변경 함수 + Intl 태그. */
export function useLocale() {
  const { locale, setLocale, intlTag } = useLocaleContext();
  return { locale, setLocale, intlTag };
}
