import { InlineKeyboard } from 'grammy';
import type { WooOrder } from '../../services/woocommerceService.js';
import { t, type SupportedLanguage } from '../i18n/index.js';

export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getStatusBadge(status: string, lang: SupportedLanguage = 'en'): { label: string; emoji: string } {
  const dict = t(lang);
  switch (status.toLowerCase()) {
    case 'processing':
      return { label: dict.statusProcessing, emoji: '🟡' };
    case 'completed':
      return { label: dict.statusCompleted, emoji: '🟢' };
    case 'on-hold':
      return { label: dict.statusOnHold, emoji: '🟠' };
    case 'pending':
      return { label: dict.statusPending, emoji: '⏳' };
    case 'cancelled':
      return { label: dict.statusCancelled, emoji: '🔴' };
    case 'refunded':
      return { label: dict.statusRefunded, emoji: '⚪️' };
    case 'failed':
      return { label: dict.statusFailed, emoji: '❌' };
    default:
      return { label: status, emoji: 'ℹ️' };
  }
}

export interface FormatOrderOptions {
  isWebhook?: boolean;
  showBackButton?: boolean;
  lang?: SupportedLanguage;
  nav?: {
    prev?: { id: number; number: string };
    next?: { id: number; number: string };
    current: number;
    total: number;
  };
}

export function formatWhatsAppUrl(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  let cleaned = rawPhone.replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (/^[6789]\d{8}$/.test(cleaned)) {
    // Standard Spanish mobile/landline 9-digit number
    cleaned = `34${cleaned}`;
  }

  if (cleaned.length < 7) return null;
  return `https://wa.me/${cleaned}`;
}

/**
 * Detects whether an order is wholesale B2B or retail B2C.
 * By default, checks the B2BKing WordPress plugin metadata (`b2bking_is_b2b_order === 'yes'`)
 * or fallback corporate billing name (`billing.company`).
 *
 * To customize for other plugins or custom meta keys, modify this function.
 */
export function isB2BOrder(order: WooOrder): boolean {
  const b2bMeta = order.meta_data?.find((m) => m.key === 'b2bking_is_b2b_order');
  return b2bMeta?.value === 'yes' || Boolean(order.billing?.company?.trim());
}

export function formatOrderMessage(
  order: WooOrder,
  storeName?: string,
  storeUrl?: string,
  options?: FormatOrderOptions
): { text: string; reply_markup: InlineKeyboard } {
  const lang = options?.lang || 'en';
  const dict = t(lang);
  const statusInfo = getStatusBadge(order.status, lang);

  // Check B2B via B2BKing or company
  const isB2B = isB2BOrder(order);
  const customerTypeBadge = isB2B ? dict.b2bBadge : dict.b2cBadge;

  // Fee detection (PayPal, Stripe, etc.)
  const paypalFeeMeta = order.meta_data?.find((m) => m.key === '_paypal_fee');
  const paypalFee = paypalFeeMeta ? parseFloat(paypalFeeMeta.value) : null;
  const totalAmount = parseFloat(order.total) || 0;
  const netAmount = paypalFee ? (totalAmount - paypalFee).toFixed(2) : null;

  // Invoice / Payment info
  const invoiceMeta = order.meta_data?.find((m) => m.key === 'apifw_ord_invoice_no');
  const paymentMethod = order.payment_method_title || order.payment_method || '—';

  // Format date with appropriate locale (prefer 24h format and DD/MM/YYYY)
  const localeMap: Record<SupportedLanguage, string> = {
    ru: 'ru-RU',
    es: 'es-ES',
    en: 'en-GB',
  };
  const orderDate = new Date(order.date_created);
  const formattedDate = !isNaN(orderDate.getTime())
    ? orderDate.toLocaleString(localeMap[lang] || 'es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : order.date_created;

  // Customer information
  const customerName = `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || dict.guest;
  const customerEmail = order.billing?.email ? escapeHtml(order.billing.email) : null;
  const customerPhone = order.billing?.phone ? escapeHtml(order.billing.phone) : null;
  const customerCompany = order.billing?.company ? escapeHtml(order.billing.company) : null;
  const customerCity = order.billing?.city ? escapeHtml(order.billing.city) : '';
  const customerCountry = order.billing?.country ? escapeHtml(order.billing.country) : '';
  const customerLocation = [customerCity, customerCountry].filter(Boolean).join(', ');

  let customerBlock = `<b>${escapeHtml(customerName)}</b>`;
  if (customerCompany) customerBlock += `\n💼 ${dict.company}: <code>${customerCompany}</code>`;
  if (customerPhone) customerBlock += `\n📞 ${dict.phone}: <code>${customerPhone}</code>`;
  if (customerEmail) customerBlock += `\n✉️ ${dict.email}: <code>${customerEmail}</code>`;
  if (customerLocation) customerBlock += `\n📍 ${dict.location}: ${customerLocation}`;

  // Payment block
  let paymentBlock = `▫️ ${dict.paymentMethod}: <b>${escapeHtml(paymentMethod)}</b>`;
  if (order.shipping_total && parseFloat(order.shipping_total) > 0) {
    paymentBlock += `\n▫️ ${dict.shipping}: <b>${order.shipping_total} ${order.currency_symbol || order.currency}</b>`;
  } else {
    paymentBlock += `\n▫️ ${dict.shipping}: <b>${dict.freeShipping}</b>`;
  }
  if (invoiceMeta?.value) {
    paymentBlock += `\n▫️ ${dict.invoice}: <code>#${escapeHtml(String(invoiceMeta.value))}</code>`;
  }
  if (paypalFee !== null && netAmount !== null) {
    paymentBlock += `\n▫️ ${dict.fee}: <code>-${paypalFee.toFixed(2)} ${order.currency_symbol || order.currency}</code>`;
    paymentBlock += `\n▫️ ${dict.netAmount}: <b>${netAmount} ${order.currency_symbol || order.currency}</b>`;
  }

  // Items block
  const itemsText = (order.line_items || [])
    .map((item, idx) => {
      let line = `<b>${idx + 1}. ${escapeHtml(item.name)}</b>\n`;
      line += `   ${item.quantity} ${dict.pcs} × ${parseFloat(item.price?.toString() || '0').toFixed(2)} = <b>${parseFloat(item.total || '0').toFixed(2)} ${order.currency_symbol || order.currency}</b>`;
      if (item.sku) {
        line += ` | ${dict.sku}: <code>${escapeHtml(item.sku)}</code>`;
      }
      if (item.meta_data && item.meta_data.length > 0) {
        const readableAttrs = item.meta_data
          .filter((m) => !m.key.startsWith('_'))
          .map((m) => `${escapeHtml(m.display_key || m.key)}: ${escapeHtml(String(m.display_value || m.value))}`)
          .join(', ');
        if (readableAttrs) {
          line += `\n   <i>(${readableAttrs})</i>`;
        }
      }
      return line;
    })
    .join('\n\n');

  let text = '';
  if (options?.isWebhook) {
    text += dict.newOrderBanner;
  }

  text += `🛍 <b>${dict.orderTitle} #${escapeHtml(order.number || String(order.id))}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 <b>${escapeHtml(storeName)}</b>  •  ${statusInfo.emoji} <b>${statusInfo.label}</b>\n`;
  } else {
    text += `${statusInfo.emoji} <b>${statusInfo.label}</b>\n`;
  }
  text += `📅 <i>${formattedDate}</i>  •  <b>${customerTypeBadge}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  text += `👤 <b>${dict.customer}:</b>\n`;
  text += `<blockquote>${customerBlock}</blockquote>\n\n`;

  text += `💳 <b>${dict.paymentAndShipping}:</b>\n`;
  text += `<blockquote>${paymentBlock}</blockquote>\n\n`;

  text += `📦 <b>${dict.orderComposition} (${order.line_items?.length || 0} ${dict.pcs}):</b>\n`;
  text += `<blockquote>${itemsText || '—'}</blockquote>\n`;

  if (order.customer_note) {
    text += `\n💬 <b>${dict.customerNote}:</b>\n`;
    text += `<blockquote><i>${escapeHtml(order.customer_note)}</i></blockquote>\n`;
  }

  text += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 <b>${dict.totalToPay}: ${parseFloat(order.total).toFixed(2)} ${order.currency_symbol || order.currency}</b>`;
  if (order.total_tax && parseFloat(order.total_tax) > 0) {
    text += `\n📑 <i>(${dict.inclTax}: ${parseFloat(order.total_tax).toFixed(2)} ${order.currency_symbol || order.currency})</i>`;
  }

  // Interactive inline keyboard
  const keyboard = new InlineKeyboard();
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';

  // 1. Navigation row (if nav options provided)
  if (options?.nav) {
    if (options.nav.prev) {
      keyboard.text(`◀️ #${options.nav.prev.number}`, `ov:${storeSlug}:${options.nav.prev.id}`);
    } else {
      keyboard.text('▪️', 'noop');
    }

    keyboard.text(`${dict.btnOrdersList} (${options.nav.current}/${options.nav.total})`, `ordm:${storeSlug}`);

    if (options.nav.next) {
      keyboard.text(`#${options.nav.next.number} ▶️`, `ov:${storeSlug}:${options.nav.next.id}`);
    } else {
      keyboard.text('▪️', 'noop');
    }
    keyboard.row();
  }

  // 2. Quick status switch buttons
  if (order.status !== 'processing') {
    keyboard.text(dict.btnProcessing, `st:${storeSlug}:${order.id}:processing`);
  }
  if (order.status !== 'completed') {
    keyboard.text(dict.btnCompleted, `st:${storeSlug}:${order.id}:completed`);
  }
  if (order.status !== 'on-hold') {
    keyboard.text(dict.btnOnHold, `st:${storeSlug}:${order.id}:on-hold`);
  }
  keyboard.row();

  // 3. Actions row: Refresh, WhatsApp, WP-Admin
  const rawPhone = order.billing?.phone || order.shipping?.phone;
  const waUrl = formatWhatsAppUrl(rawPhone);

  keyboard.text(dict.btnRefresh, `ov:${storeSlug}:${order.id}`);

  if (waUrl) {
    keyboard.url('💬 WhatsApp', waUrl);
  }

  if (storeUrl) {
    const adminOrderUrl = `${storeUrl.replace(/\/+$/, '')}/wp-admin/post.php?post=${order.id}&action=edit`;
    keyboard.url(dict.btnWPAdmin, adminOrderUrl);
  }

  // 4. Back button row if requested without nav
  if (options?.showBackButton && !options?.nav) {
    keyboard.row().text(dict.btnBackToList, `ordm:${storeSlug}`);
  }

  return { text, reply_markup: keyboard };
}
