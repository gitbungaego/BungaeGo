// 지원 언어 정의 — 한국어(기본) + 영어/일본어/중국어(간체)/대만어(번체).
export const LOCALES = [
  { code: "ko", label: "한국어", htmlLang: "ko" },
  { code: "en", label: "English", htmlLang: "en" },
  { code: "ja", label: "日本語", htmlLang: "ja" },
  { code: "zhCN", label: "简体中文", htmlLang: "zh-CN" },
  { code: "zhTW", label: "繁體中文", htmlLang: "zh-TW" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: LocaleCode = "ko";
export const STORAGE_KEY = "bungae_lang";

// Intl 계열(toLocaleDateString 등)에 쓰는 BCP-47 태그.
export const INTL_TAG: Record<LocaleCode, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zhCN: "zh-CN",
  zhTW: "zh-TW",
};

export function isLocaleCode(v: unknown): v is LocaleCode {
  return typeof v === "string" && LOCALES.some((l) => l.code === v);
}
