import type { SupportedLanguage, CommonTranslations } from './types.js';

export const commonTranslations: Record<SupportedLanguage, CommonTranslations> = {
  ru: {
    btnLanguage: '🌐 Язык',
    btnPrev: '◀️ Назад',
    btnNext: 'Вперёд ▶️',
    btnBack: '🔙 Назад',

    chooseLanguage: '🌐 <b>Выберите язык интерфейса / Select language / Elige idioma:</b>',
    languageChanged: '✅ <b>Язык успешно изменён на Русский!</b>',
    welcomeConnected: '🎉 <b>Магазин успешно подключён!</b>',
    welcomeHelp: 'Используйте кнопки меню для управления магазином.',
    welcomeTitle: '👋 <b>Добро пожаловать в менеджер заказов!</b>',
    welcomeSelect: 'Выберите нужный раздел в меню:',
    guest: 'Гость',
    noStore: '⚠️ У вас нет подключённых магазинов.',
    helpText:
      'ℹ️ <b>Справка по командам бота:</b>\n\n' +
      '• <b>/start</b> — Главное меню и статус подключения\n' +
      '• <b>/orders</b> — Список последних заказов с возможностью менять статус\n' +
      '• <b>/brands</b> — Интерактивный каталог брендов, цены и остатки\n' +
      '• <b>/reports</b> — Финансовая статистика и аналитика продаж\n' +
      '• <b>/language</b> — Сменить язык бота (RU / ES / EN)\n' +
      '• <b>/help</b> — Данная справка\n\n' +
      '⚡️ <b>Уведомления:</b>\n' +
      'При оформлении каждого нового заказа бот пришлёт моментальное уведомление с деталями, признаком B2B/B2C и кнопками быстрого изменения статуса.',

    cmdStart: 'Авторизация и главное меню',
    cmdOrders: 'Свежие заказы магазина',
    cmdBrands: 'Каталог брендов, остатки и цены',
    cmdReports: 'Финансовая аналитика и продажи',
    cmdHelp: 'Справка и список команд',
    cmdLanguage: 'Сменить язык интерфейса',

    selectStore: '🏪 <b>Выберите магазин:</b>',
    btnSwitchStore: '🏪 Сменить магазин',
    searchExpired: 'Поиск устарел, повторите запрос',
    searchStorePrompt: (query: string) => `🔍 <b>Поиск:</b> "<code>${query}</code>"`,
    noStoresAvailable: 'нет активных магазинов',

    inviteUsage: (stores: string) =>
      `ℹ️ Использование: <code>/invite &lt;магазин&gt; &lt;подпись&gt;</code>\n\nДоступные магазины: <b>${stores}</b>`,
    inviteLabelRequired: '❌ Укажите подпись (label) для приглашаемого пользователя.',
    inviteStoreNotFound: (store: string, stores: string) =>
      `❌ Магазин "${store}" не найден или неактивен.\n\nДоступные магазины: <b>${stores}</b>`,
    inviteCreated: (store: string, label: string, url: string) =>
      `🎟 <b>Приглашение создано</b>\n\n` +
      `🏪 Магазин: <b>${store}</b>\n` +
      `👤 Пользователь: <b>${label}</b>\n` +
      `⏳ Действует: 60 минут (одноразовое)\n\n` +
      `🔗 Ссылка для входа:\n<code>${url}</code>`,
    inviteFailed: (err: string) => `❌ Не удалось создать приглашение: ${err}`,
    inviteLimitReached: 'Лимит активных приглашений (20) исчерпан. Подождите истечения срока старых приглашений.',
    inviteStoreInactive: '❌ Магазин из этого приглашения деактивирован.',
    inviteActivatedAdminNotify: (label: string, store: string, username: string, id: string) =>
      `👤 <b>${label}</b> получил(а) доступ к <b>${store}</b> (${username}, <code>${id}</code>)`,

    usersTitle: '👥 <b>Пользователи по магазинам</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n',
    usersNoMembers: '  <i>(нет участников)</i>\n',
    userActive: '🟢 активен',
    userDisabled: '🔴 отключён',
    userAdmin: '👑 <b>Администратор</b>',

    revokeUsage: 'ℹ️ Использование: <code>/revoke &lt;chatId&gt; [магазин]</code>',
    revokeChatIdNumeric: '❌ chatId должен быть числом.',
    revokeCannotSelf: '❌ Администратора нельзя отключить.',
    revokeUserNotFound: (id: string) => `❌ Пользователь с chatId <code>${id}</code> не найден.`,
    revokeUserSuccess: (id: string) => `✅ Пользователь <code>${id}</code> полностью отключён (isActive = false).`,
    revokeStoreNotFound: (store: string) => `❌ Магазин "${store}" не найден.`,
    revokeNoMembership: (id: string, store: string) =>
      `ℹ️ У пользователя <code>${id}</code> не было членства в магазине "${store}".`,
    revokeStoreSuccess: (id: string, store: string) =>
      `✅ Членство пользователя <code>${id}</code> в магазине "${store}" отозвано.`,

    adminDefaultLabel: 'Владелец',
    withoutUsername: 'без @username',
  },

  es: {
    btnLanguage: '🌐 Idioma',
    btnPrev: '◀️ Atrás',
    btnNext: 'Siguiente ▶️',
    btnBack: '🔙 Volver',

    chooseLanguage: '🌐 <b>Selecciona el idioma de la interfaz / Choose language / Выберите язык:</b>',
    languageChanged: '✅ <b>¡Idioma cambiado con éxito a Español!</b>',
    welcomeConnected: '🎉 <b>¡Tienda conectada con éxito!</b>',
    welcomeHelp: 'Utiliza los botones del menú para gestionar la tienda.',
    welcomeTitle: '👋 <b>¡Bienvenido al gestor de pedidos!</b>',
    welcomeSelect: 'Selecciona una opción del menú:',
    guest: 'Invitado',
    noStore: '⚠️ No tienes ninguna tienda conectada.',
    helpText:
      'ℹ️ <b>Ayuda y comandos del bot:</b>\n\n' +
      '• <b>/start</b> — Menú principal y estado de conexión\n' +
      '• <b>/orders</b> — Lista de pedidos recientes y cambio de estado\n' +
      '• <b>/brands</b> — Catálogo interactivo de marcas, precios y stock\n' +
      '• <b>/reports</b> — Estadísticas financieras y analítica de ventas\n' +
      '• <b>/language</b> — Cambiar idioma (ES / RU / EN)\n' +
      '• <b>/help</b> — Esta ayuda\n\n' +
      '⚡️ <b>Notificaciones:</b>\n' +
      'Al recibir un nuevo pedido, el bot enviará un mensaje detallado con tipo B2B/B2C, comisiones y botones de acción rápida.',

    cmdStart: 'Menú principal y autorización',
    cmdOrders: 'Pedidos recientes de la tienda',
    cmdBrands: 'Catálogo de marcas, precios y stock',
    cmdReports: 'Informes financieros y analítica',
    cmdHelp: 'Ayuda y lista de comandos',
    cmdLanguage: 'Cambiar idioma de la interfaz',

    selectStore: '🏪 <b>Selecciona una tienda:</b>',
    btnSwitchStore: '🏪 Cambiar tienda',
    searchExpired: 'La búsqueda ha caducado, repite la consulta',
    searchStorePrompt: (query: string) => `🔍 <b>Buscar:</b> "<code>${query}</code>"`,
    noStoresAvailable: 'no hay tiendas activas',

    inviteUsage: (stores: string) =>
      `ℹ️ Uso: <code>/invite &lt;tienda&gt; &lt;nombre&gt;</code>\n\nTiendas disponibles: <b>${stores}</b>`,
    inviteLabelRequired: '❌ Por favor, indica un nombre para el usuario invitado.',
    inviteStoreNotFound: (store: string, stores: string) =>
      `❌ Tienda "${store}" no encontrada o inactiva.\n\nTiendas disponibles: <b>${stores}</b>`,
    inviteCreated: (store: string, label: string, url: string) =>
      `🎟 <b>Invitación creada</b>\n\n` +
      `🏪 Tienda: <b>${store}</b>\n` +
      `👤 Usuario: <b>${label}</b>\n` +
      `⏳ Válido por: 60 minutos (un solo uso)\n\n` +
      `🔗 Enlace de acceso:\n<code>${url}</code>`,
    inviteFailed: (err: string) => `❌ Error al crear la invitación: ${err}`,
    inviteLimitReached: 'Límite de invitaciones activas (20) alcanzado. Espera a que caduquen las anteriores.',
    inviteStoreInactive: '❌ La tienda de esta invitación está desactivada.',
    inviteActivatedAdminNotify: (label: string, store: string, username: string, id: string) =>
      `👤 <b>${label}</b> obtuvo acceso a <b>${store}</b> (${username}, <code>${id}</code>)`,

    usersTitle: '👥 <b>Usuarios por Tienda</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n',
    usersNoMembers: '  <i>(sin miembros)</i>\n',
    userActive: '🟢 activo',
    userDisabled: '🔴 desactivado',
    userAdmin: '👑 <b>Administrador</b>',

    revokeUsage: 'ℹ️ Uso: <code>/revoke &lt;chatId&gt; [tienda]</code>',
    revokeChatIdNumeric: '❌ chatId debe ser un número.',
    revokeCannotSelf: '❌ No se puede desactivar al administrador.',
    revokeUserNotFound: (id: string) => `❌ Usuario con chatId <code>${id}</code> no encontrado.`,
    revokeUserSuccess: (id: string) => `✅ Usuario <code>${id}</code> desactivado por completo (isActive = false).`,
    revokeStoreNotFound: (store: string) => `❌ Tienda "${store}" no encontrada.`,
    revokeNoMembership: (id: string, store: string) =>
      `ℹ️ El usuario <code>${id}</code> no era miembro de la tienda "${store}".`,
    revokeStoreSuccess: (id: string, store: string) =>
      `✅ Membresía del usuario <code>${id}</code> en la tienda "${store}" revocada.`,

    adminDefaultLabel: 'Propietario',
    withoutUsername: 'sin @username',
  },

  en: {
    btnLanguage: '🌐 Language',
    btnPrev: '◀️ Back',
    btnNext: 'Next ▶️',
    btnBack: '🔙 Back',

    chooseLanguage: '🌐 <b>Select interface language / Elige idioma / Выберите язык:</b>',
    languageChanged: '✅ <b>Language successfully changed to English!</b>',
    welcomeConnected: '🎉 <b>Store successfully connected!</b>',
    welcomeHelp: 'Use the menu buttons below to manage your store.',
    welcomeTitle: '👋 <b>Welcome to Order Manager!</b>',
    welcomeSelect: 'Select an option from the menu:',
    guest: 'Guest',
    noStore: '⚠️ You do not have any connected stores.',
    helpText:
      'ℹ️ <b>Bot Help & Commands:</b>\n\n' +
      '• <b>/start</b> — Main menu & connection status\n' +
      '• <b>/orders</b> — Recent store orders & status switcher\n' +
      '• <b>/brands</b> — Interactive brands catalog, prices & stock\n' +
      '• <b>/reports</b> — Financial statistics & sales analytics\n' +
      '• <b>/language</b> — Change bot language (EN / ES / RU)\n' +
      '• <b>/help</b> — This help message\n\n' +
      '⚡️ <b>Notifications:</b>\n' +
      'Whenever a new order is placed, the bot will deliver a detailed notification with B2B/B2C tags, gateway fees, and one-tap action buttons.',

    cmdStart: 'Main menu & store authorization',
    cmdOrders: 'Recent store orders',
    cmdBrands: 'Brand catalog, prices & stock',
    cmdReports: 'Financial reports & sales analytics',
    cmdHelp: 'Help & instructions',
    cmdLanguage: 'Change language',

    selectStore: '🏪 <b>Select a store:</b>',
    btnSwitchStore: '🏪 Switch store',
    searchExpired: 'Search expired, please try again',
    searchStorePrompt: (query: string) => `🔍 <b>Search:</b> "<code>${query}</code>"`,
    noStoresAvailable: 'no active stores',

    inviteUsage: (stores: string) =>
      `ℹ️ Usage: <code>/invite &lt;store&gt; &lt;label&gt;</code>\n\nAvailable stores: <b>${stores}</b>`,
    inviteLabelRequired: '❌ Please provide a label/name for the invited user.',
    inviteStoreNotFound: (store: string, stores: string) =>
      `❌ Store "${store}" not found or inactive.\n\nAvailable stores: <b>${stores}</b>`,
    inviteCreated: (store: string, label: string, url: string) =>
      `🎟 <b>Invitation created</b>\n\n` +
      `🏪 Store: <b>${store}</b>\n` +
      `👤 User: <b>${label}</b>\n` +
      `⏳ Valid for: 60 minutes (single-use)\n\n` +
      `🔗 Invite link:\n<code>${url}</code>`,
    inviteFailed: (err: string) => `❌ Failed to create invitation: ${err}`,
    inviteLimitReached: 'Active invitations limit (20) reached. Please wait for older invitations to expire.',
    inviteStoreInactive: '❌ Store from this invitation is inactive.',
    inviteActivatedAdminNotify: (label: string, store: string, username: string, id: string) =>
      `👤 <b>${label}</b> gained access to <b>${store}</b> (${username}, <code>${id}</code>)`,

    usersTitle: '👥 <b>Users by Store</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n',
    usersNoMembers: '  <i>(no members)</i>\n',
    userActive: '🟢 active',
    userDisabled: '🔴 disabled',
    userAdmin: '👑 <b>Administrator</b>',

    revokeUsage: 'ℹ️ Usage: <code>/revoke &lt;chatId&gt; [store]</code>',
    revokeChatIdNumeric: '❌ chatId must be a number.',
    revokeCannotSelf: '❌ Cannot revoke administrator.',
    revokeUserNotFound: (id: string) => `❌ User with chatId <code>${id}</code> not found.`,
    revokeUserSuccess: (id: string) => `✅ User <code>${id}</code> completely disabled (isActive = false).`,
    revokeStoreNotFound: (store: string) => `❌ Store "${store}" not found.`,
    revokeNoMembership: (id: string, store: string) =>
      `ℹ️ User <code>${id}</code> has no membership in store "${store}".`,
    revokeStoreSuccess: (id: string, store: string) =>
      `✅ Membership of user <code>${id}</code> in store "${store}" revoked.`,

    adminDefaultLabel: 'Owner',
    withoutUsername: 'without @username',
  },
};
