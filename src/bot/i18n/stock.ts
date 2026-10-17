import type { SupportedLanguage } from './types.js';

export interface StockTranslations {
  productCardTitle: string;
  variationCardTitle: string;
  stockQuantity: string;
  stockQuantityShared: string;
  stockNotManaged: string;
  stockManagedOnParent: string;
  btnSetStock: string;
  btnVariations: string;
  promptEnterStock: string;
  invalidStockQuantity: string;
  stockUpdatedSuccess: (qty: number) => string;
  stockUpdatedToast: (qty: number) => string;
  stockCannotBeNegative: string;
  stockWritePermissionError: string;
  stockAuthError: string;
  variationsTitle: string;
  selectVariationHint: string;
  stockInputCancelled: string;
  stockInputExpired: string;
  btnCancelInput: string;
  parentProduct: string;
}

export const stockTranslations: Record<SupportedLanguage, StockTranslations> = {
  ru: {
    productCardTitle: 'КАРТОЧКА ТОВАРА',
    variationCardTitle: 'ВАРИАЦИЯ ТОВАРА',
    stockQuantity: 'Остаток',
    stockQuantityShared: 'Остаток (общий)',
    stockNotManaged: '⚠️ Остаток не отслеживается',
    stockManagedOnParent: 'ℹ️ Остаток общий с родительским товаром',
    btnSetStock: '🔢 Установить число',
    btnVariations: '📦 Вариации',
    promptEnterStock: '🔢 <b>Введите новое значение остатка</b> (целое неотрицательное число, например <code>0</code>, <code>5</code>, <code>10</code>):',
    invalidStockQuantity: '❌ Пожалуйста, введите целое неотрицательное число (например, 0, 5, 10).',
    stockUpdatedSuccess: (qty: number) => `✅ Остаток обновлён: <b>${qty} шт.</b>`,
    stockUpdatedToast: (qty: number) => `Остаток: ${qty} шт.`,
    stockCannotBeNegative: '⚠️ Остаток не может быть меньше 0.',
    stockWritePermissionError: '❌ У API-ключей магазина нет прав на запись (Read/Write). Пожалуйста, пересоздайте ключи в админке WooCommerce со статусом «Чтение/Запись» (Read/Write).',
    stockAuthError: '❌ Ошибка аутентификации API магазина. Проверьте правильность ключей в настройках.',
    variationsTitle: 'ВАРИАЦИИ',
    selectVariationHint: 'Выберите вариацию для просмотра и изменения остатка:',
    stockInputCancelled: '🚫 Ввод числа отменён.',
    stockInputExpired: '⏳ Время ввода числа истекло (лимит 2 мин).',
    btnCancelInput: '❌ Отмена',
    parentProduct: 'Родительский товар',
  },

  es: {
    productCardTitle: 'FICHA DE PRODUCTO',
    variationCardTitle: 'VARIACIÓN DE PRODUCTO',
    stockQuantity: 'Stock',
    stockQuantityShared: 'Stock (compartido)',
    stockNotManaged: '⚠️ El stock no se gestiona',
    stockManagedOnParent: 'ℹ️ El stock se comparte con el producto principal',
    btnSetStock: '🔢 Establecer número',
    btnVariations: '📦 Variaciones',
    promptEnterStock: '🔢 <b>Introduce la nueva cantidad de stock</b> (número entero no negativo, ej. <code>0</code>, <code>5</code>, <code>10</code>):',
    invalidStockQuantity: '❌ Por favor, introduce un número entero no negativo (ej. 0, 5, 10).',
    stockUpdatedSuccess: (qty: number) => `✅ Stock actualizado: <b>${qty} uds.</b>`,
    stockUpdatedToast: (qty: number) => `Stock: ${qty} uds.`,
    stockCannotBeNegative: '⚠️ El stock no puede ser menor que 0.',
    stockWritePermissionError: '❌ Las claves de API no tienen permisos de escritura (Read/Write). Vuelve a crearlas en WooCommerce con permisos de lectura y escritura.',
    stockAuthError: '❌ Error de autenticación de la API de la tienda. Verifica las claves.',
    variationsTitle: 'VARIACIONES',
    selectVariationHint: 'Selecciona una variación para ver y gestionar su stock:',
    stockInputCancelled: '🚫 Entrada de stock cancelada.',
    stockInputExpired: '⏳ Tiempo de espera agotado (límite 2 min).',
    btnCancelInput: '❌ Cancelar',
    parentProduct: 'Producto principal',
  },

  en: {
    productCardTitle: 'PRODUCT CARD',
    variationCardTitle: 'PRODUCT VARIATION',
    stockQuantity: 'Stock',
    stockQuantityShared: 'Stock (shared)',
    stockNotManaged: '⚠️ Stock is not tracked',
    stockManagedOnParent: 'ℹ️ Stock is shared with parent product',
    btnSetStock: '🔢 Set number',
    btnVariations: '📦 Variations',
    promptEnterStock: '🔢 <b>Enter new stock quantity</b> (non-negative integer, e.g. <code>0</code>, <code>5</code>, <code>10</code>):',
    invalidStockQuantity: '❌ Please enter a non-negative whole number (e.g. 0, 5, 10).',
    stockUpdatedSuccess: (qty: number) => `✅ Stock updated: <b>${qty} pcs</b>`,
    stockUpdatedToast: (qty: number) => `Stock: ${qty} pcs`,
    stockCannotBeNegative: '⚠️ Stock quantity cannot be less than 0.',
    stockWritePermissionError: '❌ Store API keys lack write permissions (Read/Write). Please recreate keys in WooCommerce with Read/Write permissions.',
    stockAuthError: '❌ Store API authentication failed. Please verify API keys.',
    variationsTitle: 'VARIATIONS',
    selectVariationHint: 'Select a variation to inspect and manage stock:',
    stockInputCancelled: '🚫 Stock input cancelled.',
    stockInputExpired: '⏳ Stock input timed out (2 min limit).',
    btnCancelInput: '❌ Cancel',
    parentProduct: 'Parent product',
  },
};
