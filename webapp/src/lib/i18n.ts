export type Locale =
  | 'en'
  | 'zh-CN'
  | 'zh-TW'
  | 'ru'
  | 'es';

const LOCALE_STORAGE_KEY = 'nodewarden.locale';

type MessageTable = Record<string, string>;

export const AVAILABLE_LOCALES: readonly { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
];

let locale: Locale = resolveInitialLocale();
let activeMessages: MessageTable = {};
const loadedMessages = new Map<Locale, MessageTable>();

function isLocale(value: unknown): value is Locale {
  return AVAILABLE_LOCALES.some((item) => item.value === value);
}

function resolveInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // ignore storage errors
  }
  if (typeof navigator !== 'undefined') {
    const langs = Array.isArray(navigator.languages) ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const normalized = String(lang || '').toLowerCase();
      if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.includes('hant')) return 'zh-TW';
      if (normalized.startsWith('zh')) return 'zh-CN';
      if (normalized.startsWith('ru')) return 'ru';
      if (normalized.startsWith('es')) return 'es';
    }
  }
  return 'en';
}

const localeLoaders: Record<Locale, () => Promise<{ default: MessageTable }>> = {
  en: () => import('./i18n/locales/en'),
  'zh-CN': () => import('./i18n/locales/zh-CN'),
  'zh-TW': () => import('./i18n/locales/zh-TW'),
  ru: () => import('./i18n/locales/ru'),
  es: () => import('./i18n/locales/es'),
};

async function loadLocaleMessages(next: Locale): Promise<MessageTable> {
  const cached = loadedMessages.get(next);
  if (cached) return cached;

  const mod = await localeLoaders[next]();
  loadedMessages.set(next, mod.default);
  return mod.default;
}

async function loadFallbackMessages(): Promise<MessageTable> {
  const cached = loadedMessages.get('en');
  if (cached) return cached;
  const mod = await import('./i18n/locales/en');
  loadedMessages.set('en', mod.default);
  return mod.default;
}

export type I18nParams = Record<string, string | number | null | undefined>;

export async function initI18n(): Promise<void> {
  try {
    activeMessages = await loadLocaleMessages(locale);
  } catch (error) {
    console.error('Failed to load locale, falling back to English:', error);
    locale = 'en';
    activeMessages = await loadFallbackMessages();
  }
}

export function t(key: string, params?: I18nParams): string {
  const template = activeMessages[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

export function getLocale(): Locale {
  return locale;
}

export async function setLocale(next: Locale): Promise<void> {
  let nextMessages: MessageTable;
  try {
    nextMessages = await loadLocaleMessages(next);
  } catch (error) {
    console.error('Failed to load selected locale, falling back to English:', error);
    next = 'en';
    nextMessages = await loadFallbackMessages();
  }
  locale = next;
  activeMessages = nextMessages;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
}
