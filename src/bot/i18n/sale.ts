import type { SupportedLanguage } from './types.js';

export interface SaleTranslations {
  saleMenuTitle: string;
  saleNotConfigured: string;
  btnSaleCurrent: string;
  btnSaleNew: string;
  btnSaleResumeDraft: string;
  btnSaleEndNow: string;
  btnSaleEditBrand: string;
  btnSaleEditDates: string;
  btnSaleMenu: string;
  btnSaleRefresh: string;
  btnSaleCancel: string;
  btnSaleConfirm: string;
  btnSaleRemoveBrand: string;
  btnSaleCustomPct: string;
  btnSaleNow: string;
  btnSaleKeep: string;
  btnSaleDone: string;
  btnSaleAddGroupYes: string;
  btnSaleAddGroupNo: string;
  btnSaleConfirmReplace: string;

  saleLoading: string;
  saleCurrentTitle: string;
  saleStatusNone: string;
  saleStatusScheduled: string;
  saleStatusRunning: string;
  saleStatusEnded: string;
  saleStart: string;
  saleEnd: string;
  saleBrandsCount: (n: number) => string;
  saleNoBrands: string;
  saleListTruncated: (n: number) => string;
  saleTimezoneNote: string;

  saleEditBrandTitle: string;
  saleEditBrandPick: string;
  saleBrandCurrentPct: (name: string, pct: number) => string;
  saleEnterPercent: string;
  saleInvalidPercent: string;
  saleBrandUpdated: (name: string, pct: number) => string;
  saleBrandRemoved: (name: string) => string;
  saleLastBrand: string;
  saleBrandNotInSale: string;

  saleEditDatesTitle: string;
  saleEnterStart: string;
  saleEnterEnd: string;
  saleInvalidDate: string;
  saleEndBeforeStart: string;
  saleEndInPast: string;
  saleDatesUpdated: string;

  saleNewTitle: string;
  saleNewPickPct: string;
  saleNewGroupsSummary: string;
  saleNewPickBrands: (pct: number, selectedCount: number) => string;
  saleBrandLockedToast: (name: string, pct: number) => string;
  saleSelectAtLeastOneBrand: string;
  saleNewAskMoreGroups: string;
  saleNewStartPrompt: string;
  saleNewEndPrompt: string;
  saleNewConfirmTitle: string;
  saleNewReplaceWarningTitle: string;
  saleNewReplaceWarningBody: string;
  saleNewCancelled: string;
  saleNewCreated: string;
  saleDraftExpired: string;
  saleDraftDroppedBrands: (names: string) => string;

  saleEndConfirm: string;
  saleEnded: string;
  saleNothingToEnd: string;
  saleNoActive: string;
  saleSaved: string;
  saleInputExpired: string;

  saleErrAuth: string;
  saleErrForbidden: string;
  saleErrValidation: (msg: string) => string;
  saleErrNotFound: string;
  saleErrServer: string;
  saleErrTimeout: string;
  saleErrNetwork: string;
  saleErrBadResponse: string;
  saleErrUnknown: string;
}

export const saleTranslations: Record<SupportedLanguage, SaleTranslations> = {
  ru: {
    saleMenuTitle: '🏷 <b>Скидки по брендам</b>\n\nВыберите действие:',
    saleNotConfigured: '⚠️ Меню скидок не настроено: задайте WP_URL, WP_USER и WP_APP_PASSWORD.',
    btnSaleCurrent: '📋 Текущая акция',
    btnSaleNew: '➕ Новая акция',
    btnSaleResumeDraft: '▶️ Продолжить черновик',
    btnSaleEndNow: '⏹ Завершить сейчас',
    btnSaleEditBrand: '✏️ Изменить бренд',
    btnSaleEditDates: '📅 Изменить даты',
    btnSaleMenu: '🔙 Меню скидок',
    btnSaleRefresh: '🔄 Обновить',
    btnSaleCancel: '❌ Отмена',
    btnSaleConfirm: '✅ Подтвердить',
    btnSaleRemoveBrand: '🗑 Убрать из акции',
    btnSaleCustomPct: '✍️ Свой %',
    btnSaleNow: '⚡️ Сейчас',
    btnSaleKeep: '↩️ Оставить',
    btnSaleDone: '✅ Готово',
    btnSaleAddGroupYes: '➕ Да, добавить группу',
    btnSaleAddGroupNo: '➡️ Нет, к датам',
    btnSaleConfirmReplace: '⚠️ Да, заменить текущую акцию',

    saleLoading: '⏳ Загружаю данные с сайта…',
    saleCurrentTitle: '🏷 <b>Текущая акция</b>',
    saleStatusNone: '⚪️ Акция не настроена',
    saleStatusScheduled: '🕒 Ещё не началась',
    saleStatusRunning: '🟢 Идёт',
    saleStatusEnded: '🔴 Закончилась',
    saleStart: 'Начало',
    saleEnd: 'Конец',
    saleBrandsCount: (n) => `Брендов в акции: <b>${n}</b>`,
    saleNoBrands: '<i>Брендов нет</i>',
    saleListTruncated: (n) => `<i>…и ещё ${n}</i>`,
    saleTimezoneNote: '<i>Время: Мадрид (Europe/Madrid)</i>',

    saleEditBrandTitle: '✏️ <b>Изменить бренд</b>',
    saleEditBrandPick: 'Выберите бренд из акции:',
    saleBrandCurrentPct: (name, pct) => `Бренд: <b>${name}</b>\nТекущая скидка: <b>−${pct}%</b>\n\nВыберите новый процент или уберите бренд из акции:`,
    saleEnterPercent: '✍️ Введите процент скидки — целое число от 1 до 90:',
    saleInvalidPercent: '❌ Нужно целое число от 1 до 90.',
    saleBrandUpdated: (name, pct) => `✅ ${name}: теперь −${pct}%`,
    saleBrandRemoved: (name) => `✅ ${name} убран из акции`,
    saleLastBrand: '⚠️ Это последний бренд в акции. Убрать его нельзя — вместо этого завершите акцию.',
    saleBrandNotInSale: '⚠️ Этого бренда уже нет в акции (данные на сайте изменились).',

    saleEditDatesTitle: '📅 <b>Изменить даты</b>',
    saleEnterStart: 'Дата начала: нажмите «Сейчас», «Оставить» или введите <code>дд.мм.гггг</code> (с 00:00 по Мадриду).',
    saleEnterEnd: 'Дата конца: нажмите «Оставить» или введите <code>дд.мм.гггг</code> (до 23:59:59 по Мадриду включительно).',
    saleInvalidDate: '❌ Неверная дата. Формат: <code>дд.мм.гггг</code>, например <code>31.12.2026</code>.',
    saleEndBeforeStart: '❌ Конец акции должен быть позже начала.',
    saleEndInPast: '❌ Конец акции должен быть в будущем.',
    saleDatesUpdated: '✅ Даты акции обновлены',

    saleNewTitle: '➕ <b>Новая акция</b>',
    saleNewPickPct: 'Шаг 1. Выберите процент скидки для группы брендов:',
    saleNewGroupsSummary: '<b>Уже добавленные группы:</b>',
    saleNewPickBrands: (pct, n) => `Шаг 2. Выберите бренды для скидки <b>−${pct}%</b> (выбрано: <b>${n}</b>):`,
    saleBrandLockedToast: (name, pct) => `🔒 ${name} уже выбран в группе −${pct}%`,
    saleSelectAtLeastOneBrand: '⚠️ Выберите хотя бы один бренд для этой группы',
    saleNewAskMoreGroups: 'Шаг 3. Добавить ещё одну группу со своей скидкой?',
    saleNewStartPrompt: 'Шаг 4. Дата начала акции:\nНажмите «Сейчас» или введите дату в формате <code>дд.мм.гггг</code> (00:00 по Мадриду).',
    saleNewEndPrompt: 'Шаг 4. Дата окончания акции:\nВведите дату в формате <code>дд.мм.гггг</code> (23:59:59 по Мадриду, включительно).',
    saleNewConfirmTitle: '📋 <b>Подтверждение новой акции</b>',
    saleNewReplaceWarningTitle: '⚠️ <b>Внимание: сейчас уже идёт акция!</b>',
    saleNewReplaceWarningBody: 'При сохранении текущая акция на сайте будет <b>полностью заменена</b> новым конфигом.\n\nПодтвердить замену?',
    saleNewCancelled: '🚫 Создание акции отменено, черновик удалён.',
    saleNewCreated: '✅ Новая акция сохранена на сайте!',
    saleDraftExpired: '⏳ Черновик не найден или устарел (старше 24 ч). Начните новую акцию.',
    saleDraftDroppedBrands: (names) => `⚠️ Из черновика убраны бренды, которых больше нет на сайте: <b>${names}</b>`,

    saleEndConfirm: '⏹ <b>Завершить акцию сейчас?</b>\n\nСкидки на сайте перестанут действовать сразу.',
    saleEnded: '✅ Акция завершена',
    saleNothingToEnd: 'ℹ️ Сейчас нет идущей или запланированной акции.',
    saleNoActive: 'ℹ️ Акция не настроена или уже закончилась. Создайте новую.',
    saleSaved: '✅ Сохранено',
    saleInputExpired: '⏳ Ввод устарел, откройте меню заново.',

    saleErrAuth: '❌ WordPress отклонил логин или пароль приложения (401). Проверьте WP_USER и WP_APP_PASSWORD.',
    saleErrForbidden: '❌ У пользователя WordPress нет прав на управление акцией (403).',
    saleErrValidation: (msg) => `❌ Сайт не принял данные: ${msg}`,
    saleErrNotFound: '❌ API акции не найдено на сайте (404). Проверьте, что сниппет включён.',
    saleErrServer: '❌ Ошибка на стороне сайта (5xx). Попробуйте позже.',
    saleErrTimeout: '❌ Сайт не ответил за 15 секунд. Попробуйте позже.',
    saleErrNetwork: '❌ Сайт недоступен. Проверьте WP_URL и соединение.',
    saleErrBadResponse: '❌ Сайт вернул неожиданный ответ.',
    saleErrUnknown: '❌ Не удалось выполнить действие. Попробуйте ещё раз.',
  },

  es: {
    saleMenuTitle: '🏷 <b>Descuentos por marca</b>\n\nElige una acción:',
    saleNotConfigured: '⚠️ El menú de descuentos no está configurado: define WP_URL, WP_USER y WP_APP_PASSWORD.',
    btnSaleCurrent: '📋 Promoción actual',
    btnSaleNew: '➕ Nueva promoción',
    btnSaleResumeDraft: '▶️ Continuar borrador',
    btnSaleEndNow: '⏹ Finalizar ahora',
    btnSaleEditBrand: '✏️ Cambiar marca',
    btnSaleEditDates: '📅 Cambiar fechas',
    btnSaleMenu: '🔙 Menú de descuentos',
    btnSaleRefresh: '🔄 Actualizar',
    btnSaleCancel: '❌ Cancelar',
    btnSaleConfirm: '✅ Confirmar',
    btnSaleRemoveBrand: '🗑 Quitar de la promoción',
    btnSaleCustomPct: '✍️ Otro %',
    btnSaleNow: '⚡️ Ahora',
    btnSaleKeep: '↩️ Mantener',
    btnSaleDone: '✅ Listo',
    btnSaleAddGroupYes: '➕ Sí, añadir otro grupo',
    btnSaleAddGroupNo: '➡️ No, elegir fechas',
    btnSaleConfirmReplace: '⚠️ Sí, reemplazar la promoción actual',

    saleLoading: '⏳ Cargando datos del sitio…',
    saleCurrentTitle: '🏷 <b>Promoción actual</b>',
    saleStatusNone: '⚪️ No hay promoción configurada',
    saleStatusScheduled: '🕒 Aún no ha empezado',
    saleStatusRunning: '🟢 En curso',
    saleStatusEnded: '🔴 Finalizada',
    saleStart: 'Inicio',
    saleEnd: 'Fin',
    saleBrandsCount: (n) => `Marcas en la promoción: <b>${n}</b>`,
    saleNoBrands: '<i>Sin marcas</i>',
    saleListTruncated: (n) => `<i>…y ${n} más</i>`,
    saleTimezoneNote: '<i>Hora: Madrid (Europe/Madrid)</i>',

    saleEditBrandTitle: '✏️ <b>Cambiar marca</b>',
    saleEditBrandPick: 'Elige una marca de la promoción:',
    saleBrandCurrentPct: (name, pct) => `Marca: <b>${name}</b>\nDescuento actual: <b>−${pct}%</b>\n\nElige un nuevo porcentaje o quita la marca de la promoción:`,
    saleEnterPercent: '✍️ Introduce el porcentaje de descuento: número entero de 1 a 90:',
    saleInvalidPercent: '❌ Debe ser un número entero de 1 a 90.',
    saleBrandUpdated: (name, pct) => `✅ ${name}: ahora −${pct}%`,
    saleBrandRemoved: (name) => `✅ ${name} quitada de la promoción`,
    saleLastBrand: '⚠️ Es la última marca de la promoción. No se puede quitar: finaliza la promoción en su lugar.',
    saleBrandNotInSale: '⚠️ Esta marca ya no está en la promoción (los datos del sitio cambiaron).',

    saleEditDatesTitle: '📅 <b>Cambiar fechas</b>',
    saleEnterStart: 'Fecha de inicio: pulsa «Ahora», «Mantener» o escribe <code>dd.mm.aaaa</code> (desde las 00:00, hora de Madrid).',
    saleEnterEnd: 'Fecha de fin: pulsa «Mantener» o escribe <code>dd.mm.aaaa</code> (hasta las 23:59:59, hora de Madrid, inclusive).',
    saleInvalidDate: '❌ Fecha no válida. Formato: <code>dd.mm.aaaa</code>, p. ej. <code>31.12.2026</code>.',
    saleEndBeforeStart: '❌ El fin debe ser posterior al inicio.',
    saleEndInPast: '❌ El fin debe estar en el futuro.',
    saleDatesUpdated: '✅ Fechas actualizadas',

    saleNewTitle: '➕ <b>Nueva promoción</b>',
    saleNewPickPct: 'Paso 1. Elige el porcentaje de descuento para el grupo de marcas:',
    saleNewGroupsSummary: '<b>Grupos ya añadidos:</b>',
    saleNewPickBrands: (pct, n) => `Paso 2. Elige las marcas para el descuento <b>−${pct}%</b> (seleccionadas: <b>${n}</b>):`,
    saleBrandLockedToast: (name, pct) => `🔒 ${name} ya está en el grupo −${pct}%`,
    saleSelectAtLeastOneBrand: '⚠️ Selecciona al menos una marca para este grupo',
    saleNewAskMoreGroups: 'Paso 3. ¿Añadir otro grupo con distinto descuento?',
    saleNewStartPrompt: 'Paso 4. Fecha de inicio:\nPulsa «Ahora» o escribe <code>dd.mm.aaaa</code> (00:00 hora de Madrid).',
    saleNewEndPrompt: 'Paso 4. Fecha de fin:\nEscribe <code>dd.mm.aaaa</code> (23:59:59 hora de Madrid, inclusive).',
    saleNewConfirmTitle: '📋 <b>Confirmación de nueva promoción</b>',
    saleNewReplaceWarningTitle: '⚠️ <b>¡Atención: ya hay una promoción en curso!</b>',
    saleNewReplaceWarningBody: 'Al guardar, la promoción actual en el sitio será <b>reemplazada por completo</b>.\n\n¿Confirmar el reemplazo?',
    saleNewCancelled: '🚫 Creación cancelada, borrador eliminado.',
    saleNewCreated: '✅ ¡Nueva promoción guardada en el sitio!',
    saleDraftExpired: '⏳ El borrador no existe o ha caducado (>24 h). Inicia una nueva promoción.',
    saleDraftDroppedBrands: (names) => `⚠️ Se quitaron del borrador las marcas que ya no existen en el sitio: <b>${names}</b>`,

    saleEndConfirm: '⏹ <b>¿Finalizar la promoción ahora?</b>\n\nLos descuentos dejarán de aplicarse en el sitio de inmediato.',
    saleEnded: '✅ Promoción finalizada',
    saleNothingToEnd: 'ℹ️ No hay ninguna promoción en curso o programada.',
    saleNoActive: 'ℹ️ No hay promoción configurada o ya terminó. Crea una nueva.',
    saleSaved: '✅ Guardado',
    saleInputExpired: '⏳ La entrada ha caducado, abre el menú de nuevo.',

    saleErrAuth: '❌ WordPress rechazó el usuario o la contraseña de aplicación (401). Revisa WP_USER y WP_APP_PASSWORD.',
    saleErrForbidden: '❌ El usuario de WordPress no tiene permisos para gestionar la promoción (403).',
    saleErrValidation: (msg) => `❌ El sitio rechazó los datos: ${msg}`,
    saleErrNotFound: '❌ No se encontró la API de promociones en el sitio (404). Comprueba que el snippet está activo.',
    saleErrServer: '❌ Error en el sitio (5xx). Inténtalo más tarde.',
    saleErrTimeout: '❌ El sitio no respondió en 15 segundos. Inténtalo más tarde.',
    saleErrNetwork: '❌ El sitio no está disponible. Revisa WP_URL y la conexión.',
    saleErrBadResponse: '❌ El sitio devolvió una respuesta inesperada.',
    saleErrUnknown: '❌ No se pudo completar la acción. Inténtalo de nuevo.',
  },

  en: {
    saleMenuTitle: '🏷 <b>Brand discounts</b>\n\nChoose an action:',
    saleNotConfigured: '⚠️ Discounts menu is not configured: set WP_URL, WP_USER and WP_APP_PASSWORD.',
    btnSaleCurrent: '📋 Current sale',
    btnSaleNew: '➕ New sale',
    btnSaleResumeDraft: '▶️ Resume draft',
    btnSaleEndNow: '⏹ End now',
    btnSaleEditBrand: '✏️ Edit brand',
    btnSaleEditDates: '📅 Edit dates',
    btnSaleMenu: '🔙 Discounts menu',
    btnSaleRefresh: '🔄 Refresh',
    btnSaleCancel: '❌ Cancel',
    btnSaleConfirm: '✅ Confirm',
    btnSaleRemoveBrand: '🗑 Remove from sale',
    btnSaleCustomPct: '✍️ Custom %',
    btnSaleNow: '⚡️ Now',
    btnSaleKeep: '↩️ Keep',
    btnSaleDone: '✅ Done',
    btnSaleAddGroupYes: '➕ Yes, add another group',
    btnSaleAddGroupNo: '➡️ No, set dates',
    btnSaleConfirmReplace: '⚠️ Yes, replace running sale',

    saleLoading: '⏳ Loading data from the site…',
    saleCurrentTitle: '🏷 <b>Current sale</b>',
    saleStatusNone: '⚪️ No sale configured',
    saleStatusScheduled: '🕒 Not started yet',
    saleStatusRunning: '🟢 Running',
    saleStatusEnded: '🔴 Ended',
    saleStart: 'Start',
    saleEnd: 'End',
    saleBrandsCount: (n) => `Brands in sale: <b>${n}</b>`,
    saleNoBrands: '<i>No brands</i>',
    saleListTruncated: (n) => `<i>…and ${n} more</i>`,
    saleTimezoneNote: '<i>Time zone: Madrid (Europe/Madrid)</i>',

    saleEditBrandTitle: '✏️ <b>Edit brand</b>',
    saleEditBrandPick: 'Choose a brand from the sale:',
    saleBrandCurrentPct: (name, pct) => `Brand: <b>${name}</b>\nCurrent discount: <b>−${pct}%</b>\n\nChoose a new percentage or remove the brand from the sale:`,
    saleEnterPercent: '✍️ Enter the discount percentage: a whole number from 1 to 90:',
    saleInvalidPercent: '❌ Must be a whole number from 1 to 90.',
    saleBrandUpdated: (name, pct) => `✅ ${name}: now −${pct}%`,
    saleBrandRemoved: (name) => `✅ ${name} removed from the sale`,
    saleLastBrand: '⚠️ This is the last brand in the sale and cannot be removed. End the sale instead.',
    saleBrandNotInSale: '⚠️ This brand is no longer in the sale (site data changed).',

    saleEditDatesTitle: '📅 <b>Edit dates</b>',
    saleEnterStart: 'Start date: tap “Now”, “Keep” or type <code>dd.mm.yyyy</code> (from 00:00 Madrid time).',
    saleEnterEnd: 'End date: tap “Keep” or type <code>dd.mm.yyyy</code> (until 23:59:59 Madrid time, inclusive).',
    saleInvalidDate: '❌ Invalid date. Format: <code>dd.mm.yyyy</code>, e.g. <code>31.12.2026</code>.',
    saleEndBeforeStart: '❌ The end must be after the start.',
    saleEndInPast: '❌ The end must be in the future.',
    saleDatesUpdated: '✅ Sale dates updated',

    saleNewTitle: '➕ <b>New sale</b>',
    saleNewPickPct: 'Step 1. Choose a discount percentage for a brand group:',
    saleNewGroupsSummary: '<b>Groups added so far:</b>',
    saleNewPickBrands: (pct, n) => `Step 2. Select brands for <b>−${pct}%</b> (selected: <b>${n}</b>):`,
    saleBrandLockedToast: (name, pct) => `🔒 ${name} is already in group −${pct}%`,
    saleSelectAtLeastOneBrand: '⚠️ Select at least one brand for this group',
    saleNewAskMoreGroups: 'Step 3. Add another discount group?',
    saleNewStartPrompt: 'Step 4. Start date:\nTap “Now” or type <code>dd.mm.yyyy</code> (00:00 Madrid time).',
    saleNewEndPrompt: 'Step 4. End date:\nType <code>dd.mm.yyyy</code> (23:59:59 Madrid time, inclusive).',
    saleNewConfirmTitle: '📋 <b>Confirm new sale</b>',
    saleNewReplaceWarningTitle: '⚠️ <b>Warning: a sale is currently running!</b>',
    saleNewReplaceWarningBody: 'Saving will <b>completely replace</b> the running sale on the site.\n\nConfirm replacement?',
    saleNewCancelled: '🚫 Sale creation cancelled, draft deleted.',
    saleNewCreated: '✅ New sale saved on the site!',
    saleDraftExpired: '⏳ Draft not found or expired (>24h). Please start a new sale.',
    saleDraftDroppedBrands: (names) => `⚠️ Removed brands from draft that no longer exist on the site: <b>${names}</b>`,

    saleEndConfirm: '⏹ <b>End the sale now?</b>\n\nDiscounts on the site will stop immediately.',
    saleEnded: '✅ Sale ended',
    saleNothingToEnd: 'ℹ️ There is no running or scheduled sale.',
    saleNoActive: 'ℹ️ No sale is configured or it has already ended. Create a new one.',
    saleSaved: '✅ Saved',
    saleInputExpired: '⏳ Input expired, please open the menu again.',

    saleErrAuth: '❌ WordPress rejected the username or application password (401). Check WP_USER and WP_APP_PASSWORD.',
    saleErrForbidden: '❌ The WordPress user is not allowed to manage the sale (403).',
    saleErrValidation: (msg) => `❌ The site rejected the data: ${msg}`,
    saleErrNotFound: '❌ Sale API not found on the site (404). Make sure the snippet is enabled.',
    saleErrServer: '❌ Site-side error (5xx). Please try again later.',
    saleErrTimeout: '❌ The site did not respond within 15 seconds. Please try again later.',
    saleErrNetwork: '❌ The site is unreachable. Check WP_URL and connectivity.',
    saleErrBadResponse: '❌ The site returned an unexpected response.',
    saleErrUnknown: '❌ The action failed. Please try again.',
  },
};
