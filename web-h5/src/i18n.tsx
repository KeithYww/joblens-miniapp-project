import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'zh-CN' | 'en-US';

const LOCALE_STORAGE_KEY = 'joblens_locale';

const messages = {
  'zh-CN': {
    language: '语言',
    chinese: '中文',
    english: 'English',
    home: '首页',
    privacy: '隐私说明',
    disclaimer: '免责声明',
    brand: '职镜 JobLens',
  },
  'en-US': {
    language: 'Language',
    chinese: '中文',
    english: 'English',
    home: 'Home',
    privacy: 'Privacy',
    disclaimer: 'Disclaimer',
    brand: 'JobLens',
  },
} as const;

type MessageKey = keyof typeof messages['zh-CN'];

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (saved === 'zh-CN' || saved === 'en-US') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    setLocale,
    t: (key: MessageKey) => messages[locale][key],
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="sr-only">
      {t('language')}
      <select
        aria-label={t('language')}
        value={locale}
        onChange={event => setLocale(event.target.value as Locale)}
        className="not-sr-only rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700"
      >
        <option value="zh-CN">{t('chinese')}</option>
        <option value="en-US">{t('english')}</option>
      </select>
    </label>
  );
}
