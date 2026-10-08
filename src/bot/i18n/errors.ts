import type { SupportedLanguage, ErrorTranslations } from './types.js';

export const errorTranslations: Record<SupportedLanguage, ErrorTranslations> = {
  ru: {
    authErrorExpired:
      '❌ <b>Ошибка авторизации:</b>\nТокен недействителен или истёк срок его действия (15 минут).\n' +
      'Пожалуйста, сгенерируйте новую ссылку в панели WooCommerce.',
    errorPrefix: '❌ Ошибка:',
    storeNotFoundOrInactive: (name: string) => `Магазин "${name}" не найден или неактивен`,
    noAccessibleStores: 'У вас нет доступных активных магазинов',
    accessDeniedNotMember: 'Доступ запрещен: вы не являетесь участником этого магазина',
    userInactiveOrNotFound: 'Пользователь не найден или отключен',
    storeInactive: 'Магазин неактивен',
  },

  es: {
    authErrorExpired:
      '❌ <b>Error de autorización:</b>\nEl token no es válido o ha caducado (límite de 15 minutos).\n' +
      'Por favor, genera un nuevo enlace en el panel de WooCommerce.',
    errorPrefix: '❌ Error:',
    storeNotFoundOrInactive: (name: string) => `Tienda "${name}" no encontrada o inactiva`,
    noAccessibleStores: 'No tienes ninguna tienda activa accesible',
    accessDeniedNotMember: 'Acceso denegado: no eres miembro de esta tienda',
    userInactiveOrNotFound: 'Usuario no encontrado o desactivado',
    storeInactive: 'La tienda está inactiva',
  },

  en: {
    authErrorExpired:
      '❌ <b>Authorization error:</b>\nToken is invalid or expired (15 min limit).\n' +
      'Please generate a new link in WooCommerce admin.',
    errorPrefix: '❌ Error:',
    storeNotFoundOrInactive: (name: string) => `Store "${name}" not found or inactive`,
    noAccessibleStores: 'You do not have any accessible active stores',
    accessDeniedNotMember: 'Access denied: you are not a member of this store',
    userInactiveOrNotFound: 'User not found or disabled',
    storeInactive: 'Store is inactive',
  },
};
