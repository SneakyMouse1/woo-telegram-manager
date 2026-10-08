import { InlineKeyboard } from 'grammy';
import type { WooSalesReport, WooCustomerAnalytics } from '../../services/woocommerceService.js';
import { escapeHtml } from './orderFormatter.js';
import { t, type SupportedLanguage } from '../i18n/index.js';

export function getDateRangeForPeriod(period: string): {
  dateMin: string;
  dateMax: string;
  isYear: boolean;
} {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentYear = now.getFullYear();

  switch (period) {
    case '7d':
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { dateMin: d.toISOString().slice(0, 10), dateMax: todayStr, isYear: false };
    }
    case 'month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateMin: d.toISOString().slice(0, 10), dateMax: todayStr, isYear: false };
    }
    case '3m': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      return { dateMin: d.toISOString().slice(0, 10), dateMax: todayStr, isYear: false };
    }
    case '6m': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      return { dateMin: d.toISOString().slice(0, 10), dateMax: todayStr, isYear: false };
    }
    case 'ytd': {
      return { dateMin: `${currentYear}-01-01`, dateMax: todayStr, isYear: false };
    }
    case 'last_year': {
      const lastYear = currentYear - 1;
      return { dateMin: `${lastYear}-01-01`, dateMax: `${lastYear}-12-31`, isYear: true };
    }
    default: {
      if (/^\d{4}$/.test(period)) {
        const yr = parseInt(period, 10);
        const max = yr === currentYear ? todayStr : `${yr}-12-31`;
        return { dateMin: `${yr}-01-01`, dateMax: max, isYear: true };
      }
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateMin: d.toISOString().slice(0, 10), dateMax: todayStr, isYear: false };
    }
  }
}

export function getPeriodTitle(period: string, lang: SupportedLanguage): string {
  const dict = t(lang);
  switch (period) {
    case '7d':
    case 'week':
      return dict.period7Days;
    case 'month':
      return dict.periodMonth;
    case '3m':
      return dict.period3Months;
    case '6m':
      return dict.period6Months;
    case 'ytd':
      return dict.periodYtd;
    case 'last_year':
      return dict.periodLastYear;
    case 'all':
    case 'all_time':
      return dict.periodAllTime;
    case '1y':
      return dict.period1Year;
    default:
      if (/^\d{4}$/.test(period)) {
        return dict.yearFormat.replace('{year}', period);
      }
      return period;
  }
}

function formatMoney(amount: number | string): string {
  const val = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(val)) return '0.00';
  return val.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateReadable(isoDateStr: string): string {
  const parts = isoDateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return isoDateStr;
}

function formatDynamicsDate(key: string, lang: SupportedLanguage): string {
  // Monthly: YYYY-MM
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split('-');
    const mIdx = parseInt(month, 10) - 1;
    const dict = t(lang);
    const mName = dict.months?.[mIdx];

    return `${mName || month} ${year}`;
  }

  // Daily: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [year, month, day] = key.split('-');
    return `${day}.${month}.${year}`;
  }

  return key;
}

/**
 * Format Financial & Sales Report with multi-period selection
 */
export function formatSalesReport(
  report: WooSalesReport,
  period: string = 'month',
  storeName?: string,
  lang: SupportedLanguage = 'en'
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const periodTitle = getPeriodTitle(period, lang);
  const { dateMin, dateMax } = getDateRangeForPeriod(period);

  let text = `📊 <b>${dict.reportsTitle}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 ${dict.store}: <b>${escapeHtml(storeName)}</b>\n`;
  }
  text += `📅 ${dict.period}: <b>${periodTitle}</b>\n`;
  text += `🗓 <code>${formatDateReadable(dateMin)} — ${formatDateReadable(dateMax)}</code>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const totalSales = formatMoney(report.total_sales || '0');
  const netSales = formatMoney(report.net_sales || '0');
  const totalTax = formatMoney(report.total_tax || '0');
  const totalShipping = formatMoney(report.total_shipping || '0');

  const totalOrders =
    typeof report.total_orders === 'number'
      ? report.total_orders
      : parseInt(String(report.total_orders || '0'), 10) || 0;
  const netSalesNum = parseFloat(report.net_sales || '0') || 0;
  const grossSalesNum = parseFloat(report.total_sales || '0') || 0;

  // Real Ticket medio (Average Order Value / AOV):
  // Net sales divided by number of orders (standard in ecommerce & WooCommerce Analytics).
  // Fallback to gross sales if net sales is 0.
  const salesForAov = netSalesNum !== 0 ? netSalesNum : grossSalesNum;
  const avgOrderVal = totalOrders > 0 ? salesForAov / totalOrders : 0;
  const avgOrder = formatMoney(avgOrderVal);

  text += `💰 <b>${dict.grossSales}:</b> ${totalSales} €\n`;
  text += `💵 <b>${dict.netSales}:</b> ${netSales} €\n`;
  text += `📦 <b>${dict.totalOrders}:</b> ${totalOrders}\n`;
  text += `🏷 <b>${dict.itemsSold}:</b> ${report.total_items || 0}\n`;
  text += `💳 <b>${dict.avgOrder}:</b> ${avgOrder} €`;
  if (totalOrders > 0 && grossSalesNum > 0 && Math.abs(grossSalesNum - netSalesNum) > 0.01) {
    const avgGrossVal = formatMoney(grossSalesNum / totalOrders);
    const grossLabel = dict.grossLabel;
    text += ` <i>(${grossLabel}: ${avgGrossVal} €)</i>`;
  }
  text += `\n`;

  text += `📑 <b>${dict.taxes}:</b> ${totalTax} €\n`;
  if (parseFloat(report.total_shipping || '0') > 0) {
    text += `🚚 <b>${dict.shippingTotal}:</b> ${totalShipping} €\n`;
  }

  // Dynamics (daily or monthly depending on range)
  if (report.totals && Object.keys(report.totals).length > 0) {
    const rawEntries = Object.entries(report.totals);
    const hasMonthlyKeys = rawEntries.some(([k]) => /^\d{4}-\d{2}$/.test(k));
    const isMonthlyPeriod =
      period === '3m' ||
      period === '6m' ||
      period === 'ytd' ||
      period === 'last_year' ||
      /^\d{4}$/.test(period);

    interface DynamicEntry {
      key: string;
      sales: number | string;
      orders: number;
    }

    let displayEntries: DynamicEntry[] = [];

    if (isMonthlyPeriod && !hasMonthlyKeys) {
      // Aggregate daily entries into months (e.g. 3m or 6m returns daily entries from WooCommerce)
      const monthlyMap = new Map<string, { sales: number; orders: number }>();
      for (const [dateStr, dayData] of rawEntries) {
        const monthKey = dateStr.slice(0, 7); // 'YYYY-MM'
        const current = monthlyMap.get(monthKey) || { sales: 0, orders: 0 };
        current.sales += parseFloat(dayData.sales || '0');
        current.orders += dayData.orders || 0;
        monthlyMap.set(monthKey, current);
      }
      displayEntries = Array.from(monthlyMap.entries()).map(([key, data]) => ({
        key,
        sales: data.sales,
        orders: data.orders,
      }));
    } else if (hasMonthlyKeys) {
      displayEntries = rawEntries.slice(-12).map(([key, data]) => ({
        key,
        sales: data.sales,
        orders: data.orders,
      }));
    } else {
      // Daily period (7d, week, or month)
      const limit = period === '7d' || period === 'week' ? 7 : 14;
      displayEntries = rawEntries.slice(-limit).map(([key, data]) => ({
        key,
        sales: data.sales,
        orders: data.orders,
      }));
    }

    const isMonthly = isMonthlyPeriod || hasMonthlyKeys;
    const dynamicsTitle = isMonthly ? dict.monthlyDynamics : dict.dailyDynamics;
    text += `\n📅 <b>${dynamicsTitle}:</b>\n`;

    displayEntries.forEach((entry) => {
      const dateLabel = formatDynamicsDate(entry.key, lang);
      text += `▫️ <code>${dateLabel}</code>: <b>${formatMoney(entry.sales)} €</b> (${entry.orders} ${dict.ordersShort})\n`;
    });
  }

  // Keyboard
  const keyboard = new InlineKeyboard();
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';

  const is7d = period === '7d' || period === 'week';
  const isMonth = period === 'month';
  const is3m = period === '3m';
  const is6m = period === '6m';
  const isYtd = period === 'ytd';
  const isLastYear = period === 'last_year';

  keyboard
    .text(is7d ? `• ${dict.period7Days} •` : dict.period7Days, `rep:${storeSlug}:7d`)
    .text(isMonth ? `• ${dict.periodMonth} •` : dict.periodMonth, `rep:${storeSlug}:month`)
    .row();

  keyboard
    .text(is3m ? `• ${dict.period3Months} •` : dict.period3Months, `rep:${storeSlug}:3m`)
    .text(is6m ? `• ${dict.period6Months} •` : dict.period6Months, `rep:${storeSlug}:6m`)
    .row();

  keyboard
    .text(isYtd ? `• ${dict.periodYtd} •` : dict.periodYtd, `rep:${storeSlug}:ytd`)
    .text(isLastYear ? `• ${dict.periodLastYear} •` : dict.periodLastYear, `rep:${storeSlug}:last_year`)
    .row();

  keyboard
    .text(dict.btnTopCustomers, `topc:${storeSlug}:all`)
    .text(dict.btnChooseYear, `ryear:${storeSlug}:sales`)
    .row();

  keyboard.text(dict.btnRefresh, `rep:${storeSlug}:${period}`);

  return { text, reply_markup: keyboard };
}

/**
 * Format Top 10 Customers List
 */
export function formatTopCustomers(
  customers: WooCustomerAnalytics[],
  period: string = 'all',
  storeName?: string,
  lang: SupportedLanguage = 'en'
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const periodTitle = getPeriodTitle(period, lang);
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';

  let text = `👥 <b>${dict.topCustomersTitle}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (storeName) {
    text += `🏪 ${dict.store}: <b>${escapeHtml(storeName)}</b>  •  `;
  }
  text += `📅 ${dict.period}: <b>${periodTitle}</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (!customers || customers.length === 0) {
    text += `<i>${dict.noCustomers}</i>\n`;
  } else {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    customers.slice(0, 10).forEach((c, idx) => {
      const medal = medals[idx] || `▫️ ${idx + 1}.`;
      const displayName = escapeHtml(c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.username || dict.guest);
      const spend = formatMoney(c.total_spend);
      const rawAov = Number(c.avg_order_value);
      const aovVal =
        !isNaN(rawAov) && rawAov > 0
          ? rawAov
          : c.orders_count > 0
          ? (Number(c.total_spend) || 0) / c.orders_count
          : 0;
      const aov = formatMoney(aovVal);

      let lastOrderDateStr = '';
      if (c.date_last_order) {
        const d = new Date(c.date_last_order);
        if (!isNaN(d.getTime())) {
          lastOrderDateStr = d.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
        }
      }

      text += `<blockquote>${medal} <b>${displayName}</b>`;
      if (c.city) text += ` <i>(${escapeHtml(c.city)})</i>`;
      text += `\n💰 ${dict.spent}: <b>${spend} €</b> (${c.orders_count} ${dict.ordersCount})`;
      text += `\n💳 ${dict.aov}: <b>${aov} €</b>`;
      if (lastOrderDateStr) {
        text += ` • ${dict.lastOrder}: <i>${lastOrderDateStr}</i>`;
      }
      text += `</blockquote>\n\n`;
    });
  }

  // Keyboard for Top Customers
  const keyboard = new InlineKeyboard();

  const isAll = period === 'all' || period === 'all_time';
  const is6m = period === '6m';
  const is1y = period === '1y';
  const isLastYear = period === 'last_year';

  const labelAll = isAll ? `• ${dict.periodAllTime} •` : dict.periodAllTime;
  const label6m = is6m ? `• ${dict.period6Months} •` : dict.period6Months;
  const label1y = is1y ? `• ${getPeriodTitle('1y', lang)} •` : getPeriodTitle('1y', lang);
  const labelLastYear = isLastYear ? `• ${dict.periodLastYear} •` : dict.periodLastYear;

  keyboard
    .text(labelAll, `topc:${storeSlug}:all`)
    .text(label6m, `topc:${storeSlug}:6m`)
    .row();

  keyboard
    .text(label1y, `topc:${storeSlug}:1y`)
    .text(labelLastYear, `topc:${storeSlug}:last_year`)
    .row();

  keyboard
    .text(dict.btnSalesReport, `rep:${storeSlug}:month`)
    .text(dict.btnChooseYear, `ryear:${storeSlug}:customers`)
    .row();

  keyboard.text(dict.btnRefresh, `topc:${storeSlug}:${period}`);

  return { text, reply_markup: keyboard };
}

/**
 * Format Year Selection Menu
 */
export function formatYearSelector(
  target: 'sales' | 'customers',
  storeName?: string,
  lang: SupportedLanguage = 'en'
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const now = new Date();
  const currentYear = now.getFullYear();
  const storeSlug = storeName ? encodeURIComponent(storeName.toLowerCase()) : 'store';

  const text = dict.chooseYearPrompt;
  const keyboard = new InlineKeyboard();

  // Show recent years
  keyboard
    .text(`${currentYear} (YTD)`, target === 'sales' ? `rep:${storeSlug}:ytd` : `topc:${storeSlug}:${currentYear}`)
    .text(`${currentYear - 1}`, target === 'sales' ? `rep:${storeSlug}:last_year` : `topc:${storeSlug}:${currentYear - 1}`)
    .row()
    .text(`${currentYear - 2}`, target === 'sales' ? `rep:${storeSlug}:${currentYear - 2}` : `topc:${storeSlug}:${currentYear - 2}`)
    .text(`${currentYear - 3}`, target === 'sales' ? `rep:${storeSlug}:${currentYear - 3}` : `topc:${storeSlug}:${currentYear - 3}`)
    .row();

  const backCallback = target === 'sales' ? `rep:${storeSlug}:month` : `topc:${storeSlug}:all`;
  keyboard.text(dict.btnBack, backCallback);

  return { text, reply_markup: keyboard };
}
