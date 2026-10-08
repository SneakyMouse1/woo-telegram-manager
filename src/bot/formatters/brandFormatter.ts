import { InlineKeyboard } from 'grammy';
import type { WooBrand, WooProduct } from '../../services/woocommerceService.js';
import { escapeHtml } from './orderFormatter.js';
import { t, type SupportedLanguage } from '../i18n/index.js';

export function formatBrandsList(
  brands: WooBrand[],
  page = 1,
  pageSize = 8,
  lang: SupportedLanguage = 'en',
  storeName?: string
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const totalBrands = brands.length;
  const totalPages = Math.ceil(totalBrands / pageSize) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';

  const startIdx = (currentPage - 1) * pageSize;
  const pageBrands = brands.slice(startIdx, startIdx + pageSize);

  let text = `🏷 <b>${dict.brandsCatalogTitle}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 <b>${escapeHtml(storeName)}</b>\n`;
  }
  text += `${dict.totalBrands}: <b>${totalBrands}</b>  •  ${dict.page} <b>${currentPage}/${totalPages}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  text += `<i>${dict.selectBrandHint}</i>\n`;

  const keyboard = new InlineKeyboard();

  // Create buttons for brands (2 per row)
  for (let i = 0; i < pageBrands.length; i += 2) {
    const b1 = pageBrands[i];
    const b2 = pageBrands[i + 1];

    if (b1) {
      keyboard.text(`🏷 ${b1.name} (${b1.count})`, `brv:${storeSlug}:${b1.id}:1`);
    }
    if (b2) {
      keyboard.text(`🏷 ${b2.name} (${b2.count})`, `brv:${storeSlug}:${b2.id}:1`);
    }
    keyboard.row();
  }

  // Pagination navigation row
  const navRow: Array<{ text: string; data: string }> = [];
  if (currentPage > 1) {
    navRow.push({ text: dict.btnPrev, data: `brp:${storeSlug}:${currentPage - 1}` });
  }
  navRow.push({ text: `📄 ${currentPage}/${totalPages}`, data: 'noop' });
  if (currentPage < totalPages) {
    navRow.push({ text: dict.btnNext, data: `brp:${storeSlug}:${currentPage + 1}` });
  }

  for (const btn of navRow) {
    keyboard.text(btn.text, btn.data);
  }

  return { text, reply_markup: keyboard };
}

export function formatBrandProducts(
  brand: WooBrand,
  products: WooProduct[],
  page = 1,
  pageSize = 5,
  lang: SupportedLanguage = 'en',
  storeName?: string
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const totalProducts = products.length;
  const totalPages = Math.ceil(totalProducts / pageSize) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';

  const startIdx = (currentPage - 1) * pageSize;
  const pageProducts = products.slice(startIdx, startIdx + pageSize);

  let text = `🏷 <b>${dict.brandLabel}: ${escapeHtml(brand.name).toUpperCase()}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 <b>${escapeHtml(storeName)}</b>\n`;
  }
  text += `${dict.productsCount}: <b>${totalProducts}</b>  •  ${dict.page} <b>${currentPage}/${totalPages}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (pageProducts.length === 0) {
    text += `<i>${dict.noProducts}</i>\n`;
  } else {
    pageProducts.forEach((p, idx) => {
      const num = startIdx + idx + 1;

      // Stock status badge
      let stockBadge: string;
      const qty = p.stock_quantity;
      if (p.stock_status === 'outofstock' || (qty !== null && qty <= 0)) {
        stockBadge = `🔴 ${dict.outOfStock}`;
      } else if (p.stock_status === 'onbackorder') {
        stockBadge = `🟡 ${dict.backorder}`;
      } else if (qty !== null) {
        if (qty <= 2) {
          stockBadge = `🟠 ${dict.lowStock}: ${qty} ${dict.pcs}`;
        } else {
          stockBadge = `🟢 ${qty} ${dict.pcs}`;
        }
      } else {
        stockBadge = `🟢 ${dict.inStock}`;
      }

      // Price info: only show sale price if currently active (on_sale === true)
      const isCurrentlyOnSale =
        Boolean(p.on_sale) &&
        Boolean(p.sale_price) &&
        p.sale_price !== p.regular_price;

      let priceLine = '';
      if (isCurrentlyOnSale) {
        priceLine = `<s>${p.regular_price}€</s> <b>${p.sale_price}€</b> 🔥`;
      } else {
        const currentPrice = p.price || p.regular_price || '0.00';
        priceLine = `<b>${currentPrice}€</b>`;
      }

      text += `<blockquote><b>${num}. ${escapeHtml(p.name)}</b>\n`;
      if (p.sku) text += `${dict.sku}: <code>${escapeHtml(p.sku)}</code>\n`;
      text += `${dict.price}: ${priceLine}  |  ${dict.stock}: ${stockBadge}</blockquote>\n\n`;
    });
  }

  const keyboard = new InlineKeyboard();

  // Pagination navigation
  if (totalPages > 1) {
    if (currentPage > 1) {
      keyboard.text(dict.btnPrev, `brv:${storeSlug}:${brand.id}:${currentPage - 1}`);
    }
    keyboard.text(`📄 ${currentPage}/${totalPages}`, 'noop');
    if (currentPage < totalPages) {
      keyboard.text(dict.btnNext, `brv:${storeSlug}:${brand.id}:${currentPage + 1}`);
    }
    keyboard.row();
  }

  // Back to brands catalog button
  keyboard.text(dict.btnAllBrands, `brp:${storeSlug}:1`);

  return { text, reply_markup: keyboard };
}

/**
 * Ranks products by relevance to the query:
 * 1. Exact query match in title
 * 2. All query words contained in title
 * 3. Highest count of matched query words in title
 * 4. In-stock products prioritized over out-of-stock
 */
export function rankProductsByQuery(products: WooProduct[], query: string): WooProduct[] {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);

  return [...products].sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();

    // 1. Exact query match in title
    const aExact = aName.includes(q);
    const bExact = bName.includes(q);
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    // 2. All words in title (for multi-word queries)
    if (words.length > 1) {
      const aAllWords = words.every((w) => aName.includes(w));
      const bAllWords = words.every((w) => bName.includes(w));
      if (aAllWords && !bAllWords) return -1;
      if (!aAllWords && bAllWords) return 1;
    }

    // 3. Count of matched words in title
    const aMatchCount = words.filter((w) => aName.includes(w)).length;
    const bMatchCount = words.filter((w) => bName.includes(w)).length;
    if (aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;

    // 4. In-stock priority
    const aInStock = a.stock_status !== 'outofstock';
    const bInStock = b.stock_status !== 'outofstock';
    if (aInStock && !bInStock) return -1;
    if (!aInStock && bInStock) return 1;

    return 0;
  });
}

/**
 * Format search results for text queries (products and brands)
 * Displays up to pageSize products per page with pagination controls
 */
export function formatSearchResults(
  query: string,
  products: WooProduct[],
  brands: WooBrand[] = [],
  totalProductsCount: number = products.length,
  page: number = 1,
  pageSize: number = 6,
  lang: SupportedLanguage = 'en',
  storeName?: string,
  queryKey?: string
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';
  let text = `🔍 <b>${dict.searchResultsTitle}:</b> "<code>${escapeHtml(query)}</code>"\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 <b>${escapeHtml(storeName)}</b>\n`;
  }
  text += `\n`;

  const keyboard = new InlineKeyboard();

  if (products.length === 0 && brands.length === 0) {
    text += `<i>${dict.noSearchResults}</i>\n`;
    keyboard.text(dict.btnAllBrands, `brp:${storeSlug}:1`);
    return { text, reply_markup: keyboard };
  }

  // 1. If products found
  if (products.length > 0) {
    const ranked = rankProductsByQuery(products, query);
    const totalPages = Math.ceil(ranked.length / pageSize);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (currentPage - 1) * pageSize;
    const pageProducts = ranked.slice(startIdx, startIdx + pageSize);

    const fromNum = startIdx + 1;
    const toNum = startIdx + pageProducts.length;
    const totalDisplay = Math.max(totalProductsCount, ranked.length);

    if (totalDisplay > pageProducts.length) {
      text += `📦 <b>${dict.productsFound} (${fromNum}–${toNum} ${dict.paginationOf} ${totalDisplay}):</b>\n\n`;
    } else {
      text += `📦 <b>${dict.productsFound} (${pageProducts.length}):</b>\n\n`;
    }

    pageProducts.forEach((p, idx) => {
      const num = startIdx + idx + 1;

      // Stock status badge
      let stockBadge: string;
      const qty = p.stock_quantity;
      if (p.stock_status === 'outofstock' || (qty !== null && qty <= 0)) {
        stockBadge = `🔴 ${dict.outOfStock}`;
      } else if (p.stock_status === 'onbackorder') {
        stockBadge = `🟡 ${dict.backorder}`;
      } else if (qty !== null) {
        if (qty <= 2) {
          stockBadge = `🟠 ${dict.lowStock}: ${qty} ${dict.pcs}`;
        } else {
          stockBadge = `🟢 ${qty} ${dict.pcs}`;
        }
      } else {
        stockBadge = `🟢 ${dict.inStock}`;
      }

      // Price info
      const isCurrentlyOnSale =
        Boolean(p.on_sale) &&
        Boolean(p.sale_price) &&
        p.sale_price !== p.regular_price;

      let priceLine = '';
      if (isCurrentlyOnSale) {
        priceLine = `<s>${p.regular_price}€</s> <b>${p.sale_price}€</b> 🔥`;
      } else {
        const currentPrice = p.price || p.regular_price || '0.00';
        priceLine = `<b>${currentPrice}€</b>`;
      }

      text += `<blockquote><b>${num}. ${escapeHtml(p.name)}</b>\n`;
      if (p.sku) text += `${dict.sku}: <code>${escapeHtml(p.sku)}</code>\n`;
      text += `${dict.price}: ${priceLine}  •  ${dict.stock}: ${stockBadge}`;

      if (p.permalink) {
        text += `\n🔗 <a href="${escapeHtml(p.permalink)}">${dict.viewProduct}</a>`;
      }
      text += `</blockquote>\n\n`;
    });

    // Pagination for search results using compact 8-char queryKey
    if (totalPages > 1 && queryKey) {
      if (currentPage > 1) {
        keyboard.text(dict.btnPrev, `srch:${storeSlug}:${currentPage - 1}:${queryKey}`);
      }
      keyboard.text(`📄 ${currentPage}/${totalPages}`, 'noop');
      if (currentPage < totalPages) {
        keyboard.text(dict.btnNext, `srch:${storeSlug}:${currentPage + 1}:${queryKey}`);
      }
      keyboard.row();
    }
  }

  // 2. If matching brands found
  if (brands.length > 0) {
    text += `🏷 <b>${dict.brandsFound}:</b>\n`;
    brands.slice(0, 4).forEach((b) => {
      text += `• <b>${escapeHtml(b.name)}</b> (${b.count || 0} ${dict.productsCount.toLowerCase()})\n`;
      keyboard.text(`🏷 ${b.name}`, `brv:${storeSlug}:${b.id}:1`);
    });
    keyboard.row();
  }

  keyboard.text(dict.btnAllBrands, `brp:${storeSlug}:1`);

  return { text, reply_markup: keyboard };
}
