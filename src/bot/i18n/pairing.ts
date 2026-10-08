import type { SupportedLanguage, PairingTranslations } from './types.js';

export const pairingTranslations: Record<SupportedLanguage, PairingTranslations> = {
  ru: {
    pairingTitle: '👋 <b>Подключение магазина WooCommerce</b>',
    pairingOneTimePin: 'Ваш одноразовый 6-значный код:',
    pairingTapToCopy: '(нажмите, чтобы скопировать)',
    pairingExpiresIn: '⏳ <b>Код действует 15 минут</b>.',
    pairingInstructionsTitle: '<b>Инструкция по подключению:</b>',
    pairingStep1: '1. Откройте консоль WordPress вашего сайта.',
    pairingStep2: '2. В левом меню перейдите в: <b>WooCommerce ➡️ Telegram Bot</b>.',
    pairingStep3: (code: string) =>
      `3. Введите код <code>${code}</code> и ваши API-ключи, затем нажмите <b>«Привязать»</b>.`,
    btnNewPin: '🔄 Новый код',

    storeConnectedBanner: (name: string, domain: string) =>
      `✅ <b>Подключён магазин ${name} (${domain})</b>`,
    storeConnectedSuccess: '🎉 <b>Магазин успешно подключён!</b>',
  },

  es: {
    pairingTitle: '👋 <b>Conectar tienda WooCommerce</b>',
    pairingOneTimePin: 'Tu código PIN de 6 dígitos de un solo uso:',
    pairingTapToCopy: '(toca para copiar)',
    pairingExpiresIn: '⏳ <b>El código caduca en 15 minutos</b>.',
    pairingInstructionsTitle: '<b>Instrucciones:</b>',
    pairingStep1: '1. Abre el panel de administración de WordPress.',
    pairingStep2: '2. Ve a la sección: <b>WooCommerce ➡️ Telegram Bot</b>.',
    pairingStep3: (code: string) =>
      `3. Introduce el código <code>${code}</code> y tus claves API, luego pulsa <b>«Vincular»</b>.`,
    btnNewPin: '🔄 Nuevo código',

    storeConnectedBanner: (name: string, domain: string) =>
      `✅ <b>Tienda conectada: ${name} (${domain})</b>`,
    storeConnectedSuccess: '🎉 <b>¡Tienda conectada con éxito!</b>',
  },

  en: {
    pairingTitle: '👋 <b>Connect WooCommerce Store</b>',
    pairingOneTimePin: 'Your one-time 6-digit pairing code:',
    pairingTapToCopy: '(tap to copy)',
    pairingExpiresIn: '⏳ <b>Code expires in 15 minutes</b>.',
    pairingInstructionsTitle: '<b>Instructions:</b>',
    pairingStep1: '1. Open your WordPress admin dashboard.',
    pairingStep2: '2. Navigate to: <b>WooCommerce ➡️ Telegram Bot</b>.',
    pairingStep3: (code: string) =>
      `3. Enter code <code>${code}</code> and your API keys, then click <b>«Connect»</b>.`,
    btnNewPin: '🔄 New PIN',

    storeConnectedBanner: (name: string, domain: string) =>
      `✅ <b>Connected store: ${name} (${domain})</b>`,
    storeConnectedSuccess: '🎉 <b>Store successfully connected!</b>',
  },
};
