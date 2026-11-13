import { createContext, useContext, useState, type ReactNode } from 'react';

export type Language = 'zh' | 'en';
const LANGUAGE_KEY = 'deepaicode2api_lang';
function initialLanguage(): Language {
  const query = new URLSearchParams(location.search).get('lang');
  if (query === 'en' || query === 'zh') return query;
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* Storage may be unavailable. */ }
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
let currentLanguage = initialLanguage();
export function getLang(): Language { return currentLanguage; }

type I18nValue = { lang: Language; t: (zh: string, en: string) => string; setLang: (lang: Language) => void };
const I18nContext = createContext<I18nValue | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, updateLang] = useState<Language>(getLang);
  const setLang = (next: Language) => {
    currentLanguage = next;
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Storage may be unavailable. */ }
    updateLang(next);
  };
  return <I18nContext.Provider value={{ lang, setLang, t: (zh, en) => lang === 'en' ? en : zh }}>{children}</I18nContext.Provider>;
}
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n requires I18nProvider');
  return value;
}
