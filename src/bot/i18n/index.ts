import { InlineKeyboard } from 'grammy';
import { prisma } from '../../config/prisma.js';
import type { SupportedLanguage, TranslationDictionary } from './types.js';
import { orderTranslations } from './orders.js';
import { reportTranslations } from './reports.js';
import { brandTranslations } from './brands.js';
import { pairingTranslations } from './pairing.js';
import { commonTranslations } from './common.js';
import { errorTranslations } from './errors.js';

export * from './types.js';

export const translations: Record<SupportedLanguage, TranslationDictionary> = {
  ru: {
    ...orderTranslations.ru,
    ...reportTranslations.ru,
    ...brandTranslations.ru,
    ...pairingTranslations.ru,
    ...commonTranslations.ru,
    ...errorTranslations.ru,
  },
  es: {
    ...orderTranslations.es,
    ...reportTranslations.es,
    ...brandTranslations.es,
    ...pairingTranslations.es,
    ...commonTranslations.es,
    ...errorTranslations.es,
  },
  en: {
    ...orderTranslations.en,
    ...reportTranslations.en,
    ...brandTranslations.en,
    ...pairingTranslations.en,
    ...commonTranslations.en,
    ...errorTranslations.en,
  },
};

/**
 * Get translation dictionary for a language (defaults to English as primary)
 */
export function t(lang: SupportedLanguage = 'en'): TranslationDictionary {
  return translations[lang] || translations.en;
}

/**
 * Detect language from Telegram app language code (ISO 639-1 / IETF)
 * - Spanish (es, es-ES, etc.) -> 'es'
 * - Russian (ru, ru-RU, etc.) -> 'ru'
 * - English (en, en-US, en-GB, etc.) -> 'en'
 * - Any other language (de, fr, it, pt, etc.) -> 'en' (primary default)
 */
export function detectLanguageFromTelegram(code?: string): SupportedLanguage {
  if (!code) return 'en';
  const prefix = code.toLowerCase().slice(0, 2);
  if (prefix === 'es') return 'es';
  if (prefix === 'ru') return 'ru';
  if (prefix === 'en') return 'en';
  return 'en';
}

/**
 * Get or auto-detect user language:
 * 1. If user has an explicit manual choice (isManual === true) in DB -> always respect it.
 * 2. If user has no record, or has not manually locked it (isManual === false):
 *    - Auto-detect from their current Telegram app language (es/ru/en, else fallback to en).
 *    - Persist it in DB so webhook order notifications (which have no ctx) also know this manager's language.
 */
export async function getUserLanguage(
  chatId: number | bigint,
  fallbackTelegramLang?: string
): Promise<SupportedLanguage> {
  try {
    const user = await prisma.chatUser.findUnique({
      where: { chatId: BigInt(chatId) },
    });

    // If user explicitly chose language via /language, respect that choice
    if (user?.isManual && (user.language === 'ru' || user.language === 'en' || user.language === 'es')) {
      return user.language as SupportedLanguage;
    }

    // Auto-detect from Telegram app language code
    if (fallbackTelegramLang) {
      const detected = detectLanguageFromTelegram(fallbackTelegramLang);

      // Save or update in DB if changed
      if (user && user.language !== detected) {
        await prisma.chatUser.update({
          where: { chatId: BigInt(chatId) },
          data: { language: detected, isManual: false },
        });
      }

      return detected;
    }

    // If no Telegram app code provided (e.g. background webhook) but user exists in DB
    if (user && (user.language === 'ru' || user.language === 'en' || user.language === 'es')) {
      return user.language as SupportedLanguage;
    }
  } catch (err) {
    console.error('[Bot i18n] Error fetching/detecting user language preference:', err);
  }

  // Default language
  return 'ru';
}

/**
 * Set user language manually in database (marks as isManual = true)
 */
export async function setUserLanguage(
  chatId: number | bigint,
  language: SupportedLanguage
): Promise<void> {
  await prisma.chatUser.updateMany({
    where: { chatId: BigInt(chatId) },
    data: { language, isManual: true },
  });
}

/**
 * Inline keyboard for language selection (English is primary)
 */
export function getLanguageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇬🇧 English', 'set_lang:en')
    .row()
    .text('🇪🇸 Español', 'set_lang:es')
    .text('🇷🇺 Русский', 'set_lang:ru');
}
