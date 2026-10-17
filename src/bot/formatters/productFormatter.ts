import { InlineKeyboard } from 'grammy';
import type { WooProduct, WooProductVariation } from '../../services/woocommerceService.js';
import { escapeHtml } from './orderFormatter.js';
import { t, type SupportedLanguage, type TranslationDictionary } from '../i18n/index.js';

export function formatStockBadge(
  quantity: number | null | undefined,
  stockStatus: string | undefined,
  dict: TranslationDictionary
): string {
  const qty = quantity ?? 0;
  if (stockStatus === 'outofstock' || qty <= 0) {
    return `🔴 ${dict.outOfStock}`;
  } else if (stockStatus === 'onbackorder') {
    return `🟡 ${dict.backorder}`;
  } else if (qty <= 2) {
    return `🟠 ${dict.lowStock}: ${qty} ${dict.pcs}`;
  } else {
    return `🟢 ${qty} ${dict.pcs}`;
  }
}

/**
 * Helper to build "Back" button callback from origin string.
 * Origin format:
 *   b:<brandId>:<page> -> brv:<slug>:<brandId>:<page>
 *   s:<queryKey>:<page> -> srch:<slug>:<page>:<queryKey>
 *   else -> brp:<slug>:1
 */
export function buildBackCallback(slug: string, origin: string): string {
  if (origin.startsWith('b:')) {
    const parts = origin.split(':');
    const brandId = parts[1] || '1';
    const page = parts[2] || '1';
    return `brv:${slug}:${brandId}:${page}`;
  }
  if (origin.startsWith('s:')) {
    const parts = origin.split(':');
    const queryKey = parts[1] || '';
    const page = parts[2] || '1';
    return `srch:${slug}:${page}:${queryKey}`;
  }
  return `brp:${slug}:1`;
}

/**
 * Format main product card (simple or variable)
 */
export function formatProductCard(
  product: WooProduct,
  slug: string,
  origin: string,
  variations: WooProductVariation[] = [],
  vpage = 1,
  pageSize = 5,
  lang: SupportedLanguage = 'en',
  storeName?: string
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const isVariable = product.type === 'variable';
  const qty = product.stock_quantity ?? 0;

  let text = `📦 <b>${dict.productCardTitle}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 <b>${escapeHtml(storeName)}</b>\n`;
  }
  text += `<b>${escapeHtml(product.name)}</b>\n`;
  if (product.sku) {
    text += `${dict.sku}: <code>${escapeHtml(product.sku)}</code>\n`;
  }

  // Price formatting
  const isCurrentlyOnSale =
    Boolean(product.on_sale) &&
    Boolean(product.sale_price) &&
    product.sale_price !== product.regular_price;

  let priceLine = '';
  if (isCurrentlyOnSale) {
    priceLine = `<s>${product.regular_price}€</s> <b>${product.sale_price}€</b> 🔥`;
  } else {
    const currentPrice = product.price || product.regular_price || '0.00';
    priceLine = `<b>${currentPrice}€</b>`;
  }
  text += `${dict.price}: ${priceLine}\n`;

  // Stock status
  if (!isVariable) {
    if (product.manage_stock === true) {
      const badge = formatStockBadge(qty, product.stock_status, dict);
      text += `${dict.stockQuantity}: <b>${qty} ${dict.pcs}</b> (${badge})\n`;
    } else {
      text += `<i>${dict.stockNotManaged}</i>\n`;
    }
  } else {
    // Variable product
    if (product.manage_stock === true) {
      const badge = formatStockBadge(qty, product.stock_status, dict);
      text += `${dict.stockQuantityShared}: <b>${qty} ${dict.pcs}</b> (${badge})\n`;
    }
    text += `\n📦 <b>${dict.variationsTitle} (${variations.length}):</b>\n`;
    if (product.manage_stock !== true && variations.length === 0) {
      text += `<i>${dict.noProducts}</i>\n`;
    }
  }

  if (product.permalink) {
    text += `\n🔗 <a href="${escapeHtml(product.permalink)}">${dict.viewProduct}</a>\n`;
  }

  const keyboard = new InlineKeyboard();

  // 1. If stock is managed on product, add -1 / +1 in row 1, and Set number in row 2
  if (product.manage_stock === true) {
    keyboard
      .text('➖ 1', `ps:${slug}:${product.id}:m:${origin}`)
      .text('➕ 1', `ps:${slug}:${product.id}:p:${origin}`)
      .row()
      .text(dict.btnSetStock, `si:${slug}:${product.id}:${origin}`)
      .row();
  }

  // 2. If variable product, render paginated variations buttons
  if (isVariable && variations.length > 0) {
    const totalVariations = variations.length;
    const totalPages = Math.ceil(totalVariations / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(vpage, totalPages));
    const startIdx = (currentPage - 1) * pageSize;
    const pageVariations = variations.slice(startIdx, startIdx + pageSize);

    for (const v of pageVariations) {
      const attrDesc = v.attributes.map((a) => a.option).join(' / ') || `#${v.id}`;
      let stockDesc = '';
      if (v.manage_stock === 'parent') {
        stockDesc = product.manage_stock === true ? `${qty} ${dict.pcs}` : '—';
      } else if (v.manage_stock === true) {
        stockDesc = `${v.stock_quantity ?? 0} ${dict.pcs}`;
      } else {
        stockDesc = '—';
      }

      // Compact button label: e.g. "50 ml / Red (12 pcs)"
      let label = `${attrDesc} (${stockDesc})`;
      if (label.length > 36) {
        label = `${label.slice(0, 33)}...`;
      }
      keyboard.text(label, `vc:${slug}:${product.id}:${v.id}:${currentPage}:${origin}`).row();
    }

    // Variations navigation row
    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text(dict.btnPrev, `vp:${slug}:${product.id}:${currentPage - 1}:${origin}`);
      }
      keyboard.text(`📄 ${currentPage}/${totalPages}`, 'noop');
      if (currentPage < totalPages) {
        keyboard.text(dict.btnNext, `vp:${slug}:${product.id}:${currentPage + 1}:${origin}`);
      }
      keyboard.row();
    }
  }

  // Back button
  const backCallback = buildBackCallback(slug, origin);
  keyboard.text(dict.btnBack, backCallback);

  return { text, reply_markup: keyboard };
}

/**
 * Format single variation card
 */
export function formatVariationCard(
  product: WooProduct,
  variation: WooProductVariation,
  slug: string,
  vpage = 1,
  origin: string,
  lang: SupportedLanguage = 'en',
  storeName?: string
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const attrDesc = variation.attributes.map((a) => a.option).join(' / ') || `#${variation.id}`;

  let text = `📦 <b>${dict.variationCardTitle}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 <b>${escapeHtml(storeName)}</b>\n`;
  }
  text += `${dict.parentProduct}: <b>${escapeHtml(product.name)}</b>\n`;
  text += `🔹 <b>${escapeHtml(attrDesc)}</b>\n`;
  if (variation.sku || product.sku) {
    text += `${dict.sku}: <code>${escapeHtml(variation.sku || product.sku || '')}</code>\n`;
  }

  // Price formatting
  const currentPrice = variation.price || variation.regular_price || product.price || '0.00';
  text += `${dict.price}: <b>${currentPrice}€</b>\n`;

  // Stock status determination
  let canManage = false;
  let currentStock = 0;

  if (variation.manage_stock === 'parent') {
    if (product.manage_stock === true) {
      canManage = true;
      currentStock = product.stock_quantity ?? 0;
      const badge = formatStockBadge(currentStock, product.stock_status, dict);
      text += `${dict.stockQuantity}: <b>${currentStock} ${dict.pcs}</b> (${badge})\n`;
      text += `<i>${dict.stockManagedOnParent}</i>\n`;
    } else {
      // Parent does NOT manage stock -> unmanaged
      canManage = false;
      text += `<i>${dict.stockNotManaged}</i>\n`;
    }
  } else if (variation.manage_stock === true) {
    canManage = true;
    currentStock = variation.stock_quantity ?? 0;
    const badge = formatStockBadge(currentStock, variation.stock_status, dict);
    text += `${dict.stockQuantity}: <b>${currentStock} ${dict.pcs}</b> (${badge})\n`;
  } else {
    canManage = false;
    text += `<i>${dict.stockNotManaged}</i>\n`;
  }

  const keyboard = new InlineKeyboard();

  // If editable, add stock buttons (-1 / +1 in row 1, Set number in row 2)
  if (canManage) {
    keyboard
      .text('➖ 1', `vs:${slug}:${product.id}:${variation.id}:m:${vpage}:${origin}`)
      .text('➕ 1', `vs:${slug}:${product.id}:${variation.id}:p:${vpage}:${origin}`)
      .row()
      .text(dict.btnSetStock, `si:${slug}:${product.id}:${variation.id}:${vpage}:${origin}`)
      .row();
  }

  // Back to variations list on parent product card
  keyboard.text(dict.btnBack, `vp:${slug}:${product.id}:${vpage}:${origin}`);

  return { text, reply_markup: keyboard };
}
