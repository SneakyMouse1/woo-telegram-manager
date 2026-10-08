import { Bot, InlineKeyboard } from 'grammy';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import type { WooOrder, WooProduct, WooBrand } from '../services/woocommerceService.js';
import {
  resolveStore,
  getAccessibleStoresForChat,
  getRecipientsForStoreNotification,
} from '../services/storeResolver.js';
import {
  createInvite,
  consumeInvite,
  isRateLimited,
} from './invites.js';
import { storeSearchQuery, getSearchQuery } from './searchQueryStore.js';
import { formatOrderMessage, escapeHtml, getStatusBadge, isB2BOrder } from './formatters/orderFormatter.js';
import { formatBrandsList, formatBrandProducts, formatSearchResults } from './formatters/brandFormatter.js';
import {
  formatSalesReport,
  formatTopCustomers,
  formatYearSelector,
  getDateRangeForPeriod,
} from './formatters/reportFormatter.js';
import {
  getUserLanguage,
  setUserLanguage,
  getLanguageKeyboard,
  detectLanguageFromTelegram,
  t,
  type SupportedLanguage,
} from './i18n/index.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Global error handler to prevent bot from stopping
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Bot] Error while handling update ${ctx.update.update_id}:`, err.error);
});

/**
 * Authentication and authorization middleware (MUST RUN FIRST for all updates).
 * Rules:
 * 1. Allow if ctx.from.id == ADMIN_CHAT_ID or user exists in ChatUser with isActive === true.
 * 2. On first touch by ADMIN_CHAT_ID, create ChatUser with label "Владелец".
 * 3. Total silence for anyone else, EXCEPT deep link "/start <CODE>" (invite activation).
 */
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;

  const fromIdStr = String(fromId);
  const isAdmin = fromIdStr === env.ADMIN_CHAT_ID;

  // Allow deep link /start <CODE> through for any user
  const text = ctx.message?.text?.trim();
  if (text && text.startsWith('/start ') && text.length > 7) {
    return await next();
  }

  if (isAdmin) {
    // Ensure admin ChatUser exists with label "Владелец"
    try {
      await prisma.chatUser.upsert({
        where: { chatId: BigInt(fromId) },
        update: {},
        create: {
          chatId: BigInt(fromId),
          label: 'Владелец',
          language: 'ru',
          isManual: false,
          isActive: true,
        },
      });
    } catch (err) {
      console.error('[Bot Auth] Failed to ensure admin ChatUser:', err);
    }
    return await next();
  }

  // Non-admin check
  const chatUser = await prisma.chatUser.findUnique({
    where: { chatId: BigInt(fromId) },
  });

  if (!chatUser || !chatUser.isActive) {
    // Total silence for unauthorized or revoked users
    return;
  }

  return await next();
});

/**
 * Configure bot menu commands and localized description.
 * Admin commands (/invite, /users, /revoke) are intentionally NOT registered in the global menu.
 */
export async function setupBotMetadata() {
  try {
    const ruDict = t('ru');
    const esDict = t('es');
    const enDict = t('en');

    // Russian commands
    await bot.api.setMyCommands(
      [
        { command: 'start', description: ruDict.cmdStart },
        { command: 'orders', description: ruDict.cmdOrders },
        { command: 'brands', description: ruDict.cmdBrands },
        { command: 'reports', description: ruDict.cmdReports },
        { command: 'language', description: ruDict.cmdLanguage },
        { command: 'help', description: ruDict.cmdHelp },
      ],
      { language_code: 'ru' }
    );

    // Spanish commands
    await bot.api.setMyCommands(
      [
        { command: 'start', description: esDict.cmdStart },
        { command: 'orders', description: esDict.cmdOrders },
        { command: 'brands', description: esDict.cmdBrands },
        { command: 'reports', description: esDict.cmdReports },
        { command: 'language', description: esDict.cmdLanguage },
        { command: 'help', description: esDict.cmdHelp },
      ],
      { language_code: 'es' }
    );

    // English commands
    await bot.api.setMyCommands(
      [
        { command: 'start', description: enDict.cmdStart },
        { command: 'orders', description: enDict.cmdOrders },
        { command: 'brands', description: enDict.cmdBrands },
        { command: 'reports', description: enDict.cmdReports },
        { command: 'language', description: enDict.cmdLanguage },
        { command: 'help', description: enDict.cmdHelp },
      ],
      { language_code: 'en' }
    );

    // Default fallback commands (Russian)
    await bot.api.setMyCommands([
      { command: 'start', description: ruDict.cmdStart },
      { command: 'orders', description: ruDict.cmdOrders },
      { command: 'brands', description: ruDict.cmdBrands },
      { command: 'reports', description: ruDict.cmdReports },
      { command: 'language', description: ruDict.cmdLanguage },
      { command: 'help', description: ruDict.cmdHelp },
    ]);

    await bot.api.setMyDescription(
      'WooCommerce Telegram Manager:\n' +
      '• Instant order notifications\n' +
      '• One-tap order status management\n' +
      '• Brand catalog with real-time stock & prices\n' +
      '• Financial analytics and sales reporting\n' +
      '• Multi-store support with strict isolation'
    );
  } catch (error) {
    console.warn('[Bot] Could not set bot commands metadata:', (error as Error).message);
  }
}

/** Orders per page and total orders to fetch */
const ORDERS_PER_PAGE = 10;
const ORDERS_TOTAL_FETCH = 30;

/**
 * Helper to build store selection inline keyboard
 */
function buildStorePickerKeyboard(
  stores: Array<{ name: string }>,
  actionPrefix: 'sel_menu' | 'ordm' | 'rep' | 'brp'
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const st of stores) {
    const slug = encodeURIComponent(st.name.toLowerCase());
    let callback = `${actionPrefix}:${slug}`;
    if (actionPrefix === 'rep') callback = `rep:${slug}:month`;
    if (actionPrefix === 'brp') callback = `brp:${slug}:1`;
    keyboard.text(`🏪 ${st.name}`, callback).row();
  }
  return keyboard;
}

/**
 * Helper to render formatted orders overview list with blockquotes and pagination.
 */
function renderOrdersListMessage(
  store: { name: string },
  allOrders: WooOrder[],
  lang: SupportedLanguage = 'en',
  page: number = 1
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const totalPages = Math.max(1, Math.ceil(allOrders.length / ORDERS_PER_PAGE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (safePage - 1) * ORDERS_PER_PAGE;
  const displayOrders = allOrders.slice(startIdx, startIdx + ORDERS_PER_PAGE);
  const storeSlug = encodeURIComponent(store.name.toLowerCase());

  let listText = `📋 <b>${dict.ordersListTitle} (${allOrders.length})</b>\n`;
  listText += `━━━━━━━━━━━━━━━━━━━━━\n`;
  listText += `🏪 <b>${escapeHtml(store.name)}</b>`;
  if (totalPages > 1) {
    listText += `  •  📄 ${dict.ordersPage} ${safePage}/${totalPages}`;
  }
  listText += `\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

  displayOrders.forEach((o) => {
    const badge = getStatusBadge(o.status, lang);
    const isB2B = isB2BOrder(o);
    const b2bTag = isB2B ? ' 🏢 B2B' : ' 👤 B2C';
    const clientName = `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim() || dict.guest;

    listText += `<blockquote>• <b>#${escapeHtml(o.number || String(o.id))}</b> — ${badge.emoji} <b>${badge.label}</b> [${b2bTag}]\n`;
    listText += `  ${dict.totalShort}: <b>${parseFloat(o.total).toFixed(2)} ${o.currency_symbol || o.currency}</b> • <i>${escapeHtml(clientName)}</i></blockquote>\n\n`;
  });

  listText += `━━━━━━━━━━━━━━━━━━━━━\n`;
  listText += `<i>${dict.selectOrderHint}</i>`;

  const selectorKeyboard = new InlineKeyboard();
  for (let i = 0; i < displayOrders.length; i += 2) {
    const o1 = displayOrders[i];
    const o2 = displayOrders[i + 1];
    const b1 = getStatusBadge(o1.status, lang);
    selectorKeyboard.text(`${b1.emoji} #${o1.number}`, `ov:${storeSlug}:${o1.id}`);

    if (o2) {
      const b2 = getStatusBadge(o2.status, lang);
      selectorKeyboard.text(`${b2.emoji} #${o2.number}`, `ov:${storeSlug}:${o2.id}`);
    }
    selectorKeyboard.row();
  }

  // Pagination row
  if (totalPages > 1) {
    if (safePage > 1) {
      selectorKeyboard.text(dict.btnPrev, `ordp:${storeSlug}:${safePage - 1}`);
    }
    selectorKeyboard.text(`${safePage} / ${totalPages}`, 'noop');
    if (safePage < totalPages) {
      selectorKeyboard.text(dict.btnNext, `ordp:${storeSlug}:${safePage + 1}`);
    }
    selectorKeyboard.row();
  }

  selectorKeyboard.text(dict.btnRefreshList, `ordm:${storeSlug}`);

  return { text: listText, reply_markup: selectorKeyboard };
}

/**
 * Helper to render an order card with previous/next navigation within the last 30 orders
 */
async function renderOrderCardWithNav(
  store: { name: string; url: string },
  wooClient: any,
  orderId: number | string,
  lang: SupportedLanguage = 'en'
): Promise<{ text: string; reply_markup: InlineKeyboard }> {
  const orders = await wooClient.getOrders({ per_page: ORDERS_TOTAL_FETCH });
  const idx = orders.findIndex((o: any) => String(o.id) === String(orderId));
  const order = idx !== -1 ? orders[idx] : await wooClient.getOrder(orderId);

  const prevOrder = idx > 0 ? orders[idx - 1] : undefined;
  const nextOrder = idx !== -1 && idx < orders.length - 1 ? orders[idx + 1] : undefined;

  return formatOrderMessage(order, store.name, store.url, {
    lang,
    nav: {
      prev: prevOrder ? { id: prevOrder.id, number: prevOrder.number } : undefined,
      next: nextOrder ? { id: nextOrder.id, number: nextOrder.number } : undefined,
      current: idx !== -1 ? idx + 1 : 1,
      total: orders.length,
    },
  });
}

// ==========================================
// ADMIN COMMANDS: /invite, /users, /revoke
// ==========================================

/**
 * /invite <store> <label>
 * Generates a one-time 60-minute activation link for a specific store.
 */
bot.command('invite', async (ctx) => {
  const fromId = ctx.from?.id;
  if (String(fromId) !== env.ADMIN_CHAT_ID) {
    return; // Admin only
  }

  const chatId = ctx.chat.id;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  const rawArgs = ctx.match?.trim() || '';
  const spaceIdx = rawArgs.indexOf(' ');

  if (spaceIdx === -1) {
    const activeStores = await prisma.store.findMany({ where: { isActive: true }, select: { name: true } });
    const storeList = activeStores.map((s) => s.name).join(', ') || dict.noStoresAvailable;
    await ctx.reply(dict.inviteUsage(escapeHtml(storeList)), { parse_mode: 'HTML' });
    return;
  }

  const storeArg = rawArgs.slice(0, spaceIdx).trim();
  const label = rawArgs.slice(spaceIdx + 1).trim();

  if (!label) {
    await ctx.reply(dict.inviteLabelRequired);
    return;
  }

  const store = await prisma.store.findFirst({
    where: {
      name: { equals: storeArg, mode: 'insensitive' },
      isActive: true,
    },
  });

  if (!store) {
    const activeStores = await prisma.store.findMany({ where: { isActive: true }, select: { name: true } });
    const storeList = activeStores.map((s) => s.name).join(', ') || dict.noStoresAvailable;
    await ctx.reply(dict.inviteStoreNotFound(escapeHtml(storeArg), escapeHtml(storeList)), { parse_mode: 'HTML' });
    return;
  }

  try {
    const code = createInvite(store.id, store.name, label);
    const botUsername = ctx.me?.username || env.TELEGRAM_BOT_USERNAME || 'bot';
    const inviteUrl = `https://t.me/${botUsername}?start=${code}`;

    await ctx.reply(dict.inviteCreated(escapeHtml(store.name), escapeHtml(label), inviteUrl), { parse_mode: 'HTML' });
  } catch (err: any) {
    const errorText = err.message === 'LIMIT_EXCEEDED' ? dict.inviteLimitReached : err.message;
    await ctx.reply(dict.inviteFailed(errorText));
  }
});

/**
 * /users
 * Lists authorized users grouped by store with status.
 */
bot.command('users', async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || String(fromId) !== env.ADMIN_CHAT_ID) {
    return;
  }

  const lang = await getUserLanguage(fromId, ctx.from?.language_code);
  const dict = t(lang);

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    include: {
      members: {
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  let text = dict.usersTitle;

  for (const st of stores) {
    text += `🏪 <b>${escapeHtml(st.name)}</b>:\n`;
    if (st.members.length === 0) {
      text += dict.usersNoMembers;
    } else {
      for (const m of st.members) {
        const status = m.user.isActive ? dict.userActive : dict.userDisabled;
        text += `  • <b>${escapeHtml(m.user.label)}</b> (<code>${m.user.chatId}</code>) — ${status}\n`;
      }
    }
    text += `\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `${dict.userAdmin}: <code>${env.ADMIN_CHAT_ID}</code>`;

  await ctx.reply(text, { parse_mode: 'HTML' });
});

/**
 * /revoke <chatId> [store]
 * Revokes user access. If store omitted -> ChatUser.isActive = false.
 * If store provided -> removes StoreMember only.
 */
bot.command('revoke', async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || String(fromId) !== env.ADMIN_CHAT_ID) {
    return;
  }

  const lang = await getUserLanguage(fromId, ctx.from?.language_code);
  const dict = t(lang);

  const rawArgs = ctx.match?.trim() || '';
  const parts = rawArgs.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    await ctx.reply(dict.revokeUsage, { parse_mode: 'HTML' });
    return;
  }

  const targetChatIdStr = parts[0];
  if (!/^-?\d+$/.test(targetChatIdStr)) {
    await ctx.reply(dict.revokeChatIdNumeric);
    return;
  }

  if (targetChatIdStr === env.ADMIN_CHAT_ID) {
    await ctx.reply(dict.revokeCannotSelf);
    return;
  }

  const targetChatBigInt = BigInt(targetChatIdStr);
  const storeArg = parts[1];

  if (!storeArg) {
    // Complete disable
    const updated = await prisma.chatUser.updateMany({
      where: { chatId: targetChatBigInt },
      data: { isActive: false },
    });

    if (updated.count === 0) {
      await ctx.reply(dict.revokeUserNotFound(targetChatIdStr), { parse_mode: 'HTML' });
    } else {
      await ctx.reply(dict.revokeUserSuccess(targetChatIdStr), { parse_mode: 'HTML' });
    }
    return;
  }

  // Revoke membership for specific store
  const store = await prisma.store.findFirst({
    where: { name: { equals: storeArg, mode: 'insensitive' } },
  });

  if (!store) {
    await ctx.reply(dict.revokeStoreNotFound(escapeHtml(storeArg)));
    return;
  }

  const deleted = await prisma.storeMember.deleteMany({
    where: {
      chatId: targetChatBigInt,
      storeId: store.id,
    },
  });

  if (deleted.count === 0) {
    await ctx.reply(dict.revokeNoMembership(targetChatIdStr, escapeHtml(store.name)), { parse_mode: 'HTML' });
  } else {
    await ctx.reply(dict.revokeStoreSuccess(targetChatIdStr, escapeHtml(store.name)), { parse_mode: 'HTML' });
  }
});

// ==========================================
// PUBLIC USER COMMANDS
// ==========================================

/**
 * /language command handler
 */
bot.command(['language', 'lang'], async (ctx) => {
  const lang = await getUserLanguage(ctx.chat.id, ctx.from?.language_code);
  const dict = t(lang);
  await ctx.reply(dict.chooseLanguage, {
    parse_mode: 'HTML',
    reply_markup: getLanguageKeyboard(),
  });
});

/**
 * /start command handler (handles invite code activation or main menu)
 */
bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim();
  const chatId = ctx.chat.id;

  // Case 1: Deep linking with invite code
  if (payload) {
    if (isRateLimited(chatId)) {
      return; // Silently ignore rate-limited abusers
    }

    const invite = consumeInvite(payload, chatId);
    if (!invite) {
      // Invalid code -> silent return (rate limiter already counted the attempt)
      return;
    }

    const store = await prisma.store.findUnique({
      where: { id: invite.storeId },
    });

    const userLang = detectLanguageFromTelegram(ctx.from?.language_code);
    const userDict = t(userLang);

    if (!store || !store.isActive) {
      await ctx.reply(userDict.inviteStoreInactive);
      return;
    }

    // Upsert ChatUser: preserve existing label if user was already known
    const existingUser = await prisma.chatUser.findUnique({
      where: { chatId: BigInt(chatId) },
    });

    if (!existingUser) {
      await prisma.chatUser.create({
        data: {
          chatId: BigInt(chatId),
          label: invite.label,
          language: userLang,
          isActive: true,
        },
      });
    } else if (!existingUser.isActive) {
      await prisma.chatUser.update({
        where: { chatId: BigInt(chatId) },
        data: { isActive: true },
      });
    }

    // Upsert StoreMember
    await prisma.storeMember.upsert({
      where: {
        chatId_storeId: {
          chatId: BigInt(chatId),
          storeId: store.id,
        },
      },
      update: {},
      create: {
        chatId: BigInt(chatId),
        storeId: store.id,
      },
    });

    // Notify admin in admin's own language
    const userLabel = existingUser?.label || invite.label;
    try {
      const adminLang = await getUserLanguage(BigInt(env.ADMIN_CHAT_ID));
      const adminDict = t(adminLang);
      const usernameTag = ctx.from?.username ? `@${ctx.from.username}` : adminDict.withoutUsername;

      await bot.api.sendMessage(
        Number(env.ADMIN_CHAT_ID),
        adminDict.inviteActivatedAdminNotify(escapeHtml(userLabel), escapeHtml(store.name), usernameTag, String(chatId)),
        { parse_mode: 'HTML' }
      );
    } catch (notifyErr) {
      console.error('[Bot Auth] Failed to notify admin about new member:', notifyErr);
    }

    // Show menu for newly connected store
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const storeSlug = encodeURIComponent(store.name.toLowerCase());

    const menuKeyboard = new InlineKeyboard()
      .text(dict.btnOrders, `ordm:${storeSlug}`)
      .text(dict.btnReports, `rep:${storeSlug}:month`)
      .row()
      .text(dict.btnBrands, `brp:${storeSlug}:1`)
      .text(dict.btnLanguage, 'menu_language');

    await ctx.reply(
      `🎉 <b>${dict.welcomeConnected}</b>\n\n` +
      `🏪 <b>«${escapeHtml(store.name)}»</b>\n\n` +
      `${dict.welcomeHelp}`,
      { parse_mode: 'HTML', reply_markup: menuKeyboard }
    );
    return;
  }

  // Case 2: Plain /start without code
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);
  const accessibleStores = await getAccessibleStoresForChat(chatId);

  if (accessibleStores.length === 0) {
    await ctx.reply(dict.noStore);
    return;
  }

  if (accessibleStores.length === 1) {
    const store = accessibleStores[0];
    const storeSlug = encodeURIComponent(store.name.toLowerCase());

    const menuKeyboard = new InlineKeyboard()
      .text(dict.btnOrders, `ordm:${storeSlug}`)
      .text(dict.btnReports, `rep:${storeSlug}:month`)
      .row()
      .text(dict.btnBrands, `brp:${storeSlug}:1`)
      .text(dict.btnLanguage, 'menu_language');

    const welcomeHeader =
      `${dict.welcomeTitle}\n\n` +
      `🏪 ${dict.store}: <b>${escapeHtml(store.name)}</b>\n\n` +
      `${dict.welcomeSelect}`;

    await ctx.reply(welcomeHeader, { parse_mode: 'HTML', reply_markup: menuKeyboard });
  } else {
    // User has multiple stores: show selection picker
    const pickerKeyboard = buildStorePickerKeyboard(accessibleStores, 'sel_menu');
    pickerKeyboard.row().text(dict.btnLanguage, 'menu_language');

    await ctx.reply(
      `${dict.welcomeTitle}\n\n${dict.selectStore}`,
      { parse_mode: 'HTML', reply_markup: pickerKeyboard }
    );
  }
});

/**
 * /orders [store] command
 */
bot.command('orders', async (ctx) => {
  const chatId = ctx.chat.id;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  const storeArg = ctx.match?.trim();

  try {
    if (storeArg) {
      const store = await resolveStore(chatId, storeArg, lang);
      const loadingMsg = await ctx.reply(dict.loadingOrders, { parse_mode: 'HTML' });
      const orders = await store.client.getOrders({ per_page: ORDERS_TOTAL_FETCH });

      if (!orders || orders.length === 0) {
        await ctx.api.editMessageText(chatId, loadingMsg.message_id, dict.noOrders);
        return;
      }

      const { text, reply_markup } = renderOrdersListMessage(store, orders, lang, 1);
      await ctx.api.editMessageText(chatId, loadingMsg.message_id, text, {
        parse_mode: 'HTML',
        reply_markup,
      });
      return;
    }

    const accessibleStores = await getAccessibleStoresForChat(chatId);
    if (accessibleStores.length === 0) {
      await ctx.reply(dict.noStore);
      return;
    }

    if (accessibleStores.length === 1) {
      const store = await resolveStore(chatId, accessibleStores[0].name, lang);
      const loadingMsg = await ctx.reply(dict.loadingOrders, { parse_mode: 'HTML' });
      const orders = await store.client.getOrders({ per_page: ORDERS_TOTAL_FETCH });

      if (!orders || orders.length === 0) {
        await ctx.api.editMessageText(chatId, loadingMsg.message_id, dict.noOrders);
        return;
      }

      const { text, reply_markup } = renderOrdersListMessage(store, orders, lang, 1);
      await ctx.api.editMessageText(chatId, loadingMsg.message_id, text, {
        parse_mode: 'HTML',
        reply_markup,
      });
    } else {
      await ctx.reply(
        `📋 <b>${dict.ordersListTitle}</b>\n\n${dict.selectStore}`,
        { parse_mode: 'HTML', reply_markup: buildStorePickerKeyboard(accessibleStores, 'ordm') }
      );
    }
  } catch (error) {
    console.error('[Bot] Error fetching orders:', error);
    await ctx.reply(`${dict.errorPrefix} ${(error as Error).message}`);
  }
});

/**
 * /brands [store] command
 */
bot.command('brands', async (ctx) => {
  const chatId = ctx.chat.id;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  const storeArg = ctx.match?.trim();

  try {
    if (storeArg) {
      const store = await resolveStore(chatId, storeArg, lang);
      const brands = await store.client.getBrands({ per_page: 100 });

      if (!brands || brands.length === 0) {
        await ctx.reply(dict.noProducts);
        return;
      }

      const formatted = formatBrandsList(brands, 1, 8, lang, store.name);
      await ctx.reply(formatted.text, {
        parse_mode: 'HTML',
        reply_markup: formatted.reply_markup,
      });
      return;
    }

    const accessibleStores = await getAccessibleStoresForChat(chatId);
    if (accessibleStores.length === 0) {
      await ctx.reply(dict.noStore);
      return;
    }

    if (accessibleStores.length === 1) {
      const store = await resolveStore(chatId, accessibleStores[0].name, lang);
      const brands = await store.client.getBrands({ per_page: 100 });

      if (!brands || brands.length === 0) {
        await ctx.reply(dict.noProducts);
        return;
      }

      const formatted = formatBrandsList(brands, 1, 8, lang, store.name);
      await ctx.reply(formatted.text, {
        parse_mode: 'HTML',
        reply_markup: formatted.reply_markup,
      });
    } else {
      await ctx.reply(
        `🏷 <b>${dict.brandsCatalogTitle}</b>\n\n${dict.selectStore}`,
        { parse_mode: 'HTML', reply_markup: buildStorePickerKeyboard(accessibleStores, 'brp') }
      );
    }
  } catch (error) {
    console.error('[Bot] Error fetching brands:', error);
    await ctx.reply(`${dict.errorPrefix} ${(error as Error).message}`);
  }
});

/**
 * /reports [store] command
 */
bot.command('reports', async (ctx) => {
  const chatId = ctx.chat.id;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  const storeArg = ctx.match?.trim();

  try {
    if (storeArg) {
      const store = await resolveStore(chatId, storeArg, lang);
      const loadingMsg = await ctx.reply(dict.loadingAnalytics, { parse_mode: 'HTML' });
      const { dateMin, dateMax } = getDateRangeForPeriod('month');
      const reports = await store.client.getSalesReports({ date_min: dateMin, date_max: dateMax });
      const reportData = reports[0];

      if (!reportData) {
        await ctx.api.editMessageText(chatId, loadingMsg.message_id, `📊 ${dict.reportsTitle}`);
        return;
      }

      const formatted = formatSalesReport(reportData, 'month', store.name, lang);
      await ctx.api.editMessageText(chatId, loadingMsg.message_id, formatted.text, {
        parse_mode: 'HTML',
        reply_markup: formatted.reply_markup,
      });
      return;
    }

    const accessibleStores = await getAccessibleStoresForChat(chatId);
    if (accessibleStores.length === 0) {
      await ctx.reply(dict.noStore);
      return;
    }

    if (accessibleStores.length === 1) {
      const store = await resolveStore(chatId, accessibleStores[0].name, lang);
      const loadingMsg = await ctx.reply(dict.loadingAnalytics, { parse_mode: 'HTML' });
      const { dateMin, dateMax } = getDateRangeForPeriod('month');
      const reports = await store.client.getSalesReports({ date_min: dateMin, date_max: dateMax });
      const reportData = reports[0];

      if (!reportData) {
        await ctx.api.editMessageText(chatId, loadingMsg.message_id, `📊 ${dict.reportsTitle}`);
        return;
      }

      const formatted = formatSalesReport(reportData, 'month', store.name, lang);
      await ctx.api.editMessageText(chatId, loadingMsg.message_id, formatted.text, {
        parse_mode: 'HTML',
        reply_markup: formatted.reply_markup,
      });
    } else {
      await ctx.reply(
        `📊 <b>${dict.reportsTitle}</b>\n\n${dict.selectStore}`,
        { parse_mode: 'HTML', reply_markup: buildStorePickerKeyboard(accessibleStores, 'rep') }
      );
    }
  } catch (error) {
    console.error('[Bot] Error fetching reports:', error);
    await ctx.reply(`${dict.errorPrefix} ${(error as Error).message}`);
  }
});

/**
 * /help command
 */
bot.command('help', async (ctx) => {
  const lang = await getUserLanguage(ctx.chat.id, ctx.from?.language_code);
  const dict = t(lang);
  const helpKeyboard = new InlineKeyboard().text(dict.btnLanguage, 'menu_language');

  await ctx.reply(dict.helpText, {
    parse_mode: 'HTML',
    reply_markup: helpKeyboard,
  });
});

interface SearchCacheEntry {
  products: WooProduct[];
  brands: WooBrand[];
  total: number;
  expiresAt: number;
}
const searchCache = new Map<string, SearchCacheEntry>();

function getSearchCacheKey(storeId: string, query: string): string {
  return `${storeId}:${query.toLowerCase().trim()}`;
}

/**
 * Text search handler: Instant search for products and brands
 */
bot.on('message:text', async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith('/')) return;

  const chatId = ctx.chat.id;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  const accessibleStores = await getAccessibleStoresForChat(chatId);
  if (accessibleStores.length === 0) {
    await ctx.reply(dict.noStore);
    return;
  }

  const queryKey = storeSearchQuery(query);

  if (accessibleStores.length === 1) {
    const store = await resolveStore(chatId, accessibleStores[0].name, lang);
    const searchingMsg = await ctx.reply(`🔍 <i>${dict.searching}</i>`, { parse_mode: 'HTML' });

    try {
      const [searchResult, brands] = await Promise.all([
        store.client.searchProducts(query, { per_page: 30 }),
        store.client.getBrands({ search: query, per_page: 5 }),
      ]);

      const products = searchResult.products;
      const total = searchResult.total;

      searchCache.set(getSearchCacheKey(store.id, query), {
        products,
        brands,
        total,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const formatted = formatSearchResults(query, products, brands, total, 1, 6, lang, store.name, queryKey);
      await ctx.api.editMessageText(chatId, searchingMsg.message_id, formatted.text, {
        parse_mode: 'HTML',
        reply_markup: formatted.reply_markup,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error('[Bot] Error during product search:', error);
      await ctx.api.editMessageText(
        chatId,
        searchingMsg.message_id,
        `${dict.errorPrefix} ${(error as Error).message}`
      );
    }
  } else {
    // Multi-store prompt for search using compact 8-char queryKey
    const kb = new InlineKeyboard();
    for (const st of accessibleStores) {
      const slug = encodeURIComponent(st.name.toLowerCase());
      kb.text(`🏪 ${st.name}`, `srch_sel:${slug}:${queryKey}`).row();
    }
    await ctx.reply(`${dict.searchStorePrompt(escapeHtml(query))}\n\n${dict.selectStore}`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  }
});

// ==========================================
// CALLBACK QUERY HANDLERS (INLINE BUTTONS)
// ==========================================

/**
 * Language selection handler: set_lang:(ru|es|en)
 */
bot.callbackQuery(/^set_lang:(ru|es|en)$/, async (ctx) => {
  const newLang = ctx.match[1] as SupportedLanguage;
  const chatId = ctx.chat?.id || 0;
  await setUserLanguage(chatId, newLang);

  const dict = t(newLang);
  await ctx.answerCallbackQuery({
    text: dict.languageChanged.replace(/<[^>]+>/g, ''),
  });

  const accessibleStores = await getAccessibleStoresForChat(chatId);
  if (accessibleStores.length === 1) {
    const storeSlug = encodeURIComponent(accessibleStores[0].name.toLowerCase());
    const menuKeyboard = new InlineKeyboard()
      .text(dict.btnOrders, `ordm:${storeSlug}`)
      .text(dict.btnReports, `rep:${storeSlug}:month`)
      .row()
      .text(dict.btnBrands, `brp:${storeSlug}:1`)
      .text(dict.btnLanguage, 'menu_language');

    await ctx.editMessageText(dict.languageChanged, {
      parse_mode: 'HTML',
      reply_markup: menuKeyboard,
    });
  } else {
    const picker = buildStorePickerKeyboard(accessibleStores, 'sel_menu');
    picker.row().text(dict.btnLanguage, 'menu_language');
    await ctx.editMessageText(dict.languageChanged, {
      parse_mode: 'HTML',
      reply_markup: picker,
    });
  }
});

/**
 * Menu language button
 */
bot.callbackQuery('menu_language', async (ctx) => {
  const lang = await getUserLanguage(ctx.chat?.id || 0, ctx.from?.language_code);
  const dict = t(lang);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(dict.chooseLanguage, {
    parse_mode: 'HTML',
    reply_markup: getLanguageKeyboard(),
  });
});

/**
 * Stores selection menu callback
 */
bot.callbackQuery('stores_menu', async (ctx) => {
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);
  const stores = await getAccessibleStoresForChat(chatId);

  await ctx.answerCallbackQuery();
  const picker = buildStorePickerKeyboard(stores, 'sel_menu');
  picker.row().text(dict.btnLanguage, 'menu_language');

  await ctx.editMessageText(dict.selectStore, {
    parse_mode: 'HTML',
    reply_markup: picker,
  });
});

/**
 * Select store for main menu: sel_menu:<storeSlug>
 */
bot.callbackQuery(/^sel_menu:(\S+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    const accessibleStores = await getAccessibleStoresForChat(chatId);
    const slug = encodeURIComponent(store.name.toLowerCase());

    const menuKeyboard = new InlineKeyboard()
      .text(dict.btnOrders, `ordm:${slug}`)
      .text(dict.btnReports, `rep:${slug}:month`)
      .row()
      .text(dict.btnBrands, `brp:${slug}:1`)
      .text(dict.btnLanguage, 'menu_language');

    if (accessibleStores.length > 1) {
      menuKeyboard.row().text(dict.btnSwitchStore, 'stores_menu');
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `${dict.welcomeTitle}\n\n` +
      `🏪 ${dict.store}: <b>${escapeHtml(store.name)}</b>\n\n` +
      `${dict.welcomeSelect}`,
      { parse_mode: 'HTML', reply_markup: menuKeyboard }
    );
  } catch (err: any) {
    await ctx.answerCallbackQuery({ text: err.message, show_alert: true });
  }
});

/**
 * Change order status: st:<storeSlug>:<orderId>:<newStatus>
 */
bot.callbackQuery(/^st:(\S+):(\d+):([a-z-]+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const orderId = ctx.match[2];
  const newStatus = ctx.match[3];
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    const statusBadge = getStatusBadge(newStatus, lang);
    await ctx.answerCallbackQuery({ text: `✅ ${statusBadge.label}` });

    await store.client.updateOrderStatus(orderId, newStatus);
    const formatted = await renderOrderCardWithNav(store, store.client, orderId, lang);

    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error updating order status:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * View or refresh order detail: ov:<storeSlug>:<orderId>
 */
bot.callbackQuery(/^ov:(\S+):(\d+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const orderId = ctx.match[2];
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const formatted = await renderOrderCardWithNav(store, store.client, orderId, lang);
    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error viewing order:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * Open orders menu / refresh list: ordm:<storeSlug>
 */
bot.callbackQuery(/^ordm:(\S+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const orders = await store.client.getOrders({ per_page: ORDERS_TOTAL_FETCH });
    if (!orders || orders.length === 0) {
      await ctx.editMessageText(dict.noOrders);
      return;
    }

    const { text, reply_markup } = renderOrdersListMessage(store, orders, lang, 1);
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error loading orders list:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * Orders pagination: ordp:<storeSlug>:<page>
 */
bot.callbackQuery(/^ordp:(\S+):(\d+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const page = parseInt(ctx.match[2], 10);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const orders = await store.client.getOrders({ per_page: ORDERS_TOTAL_FETCH });
    if (!orders || orders.length === 0) {
      await ctx.editMessageText(dict.noOrders);
      return;
    }

    const { text, reply_markup } = renderOrdersListMessage(store, orders, lang, page);
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error paginating orders:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg });
    } catch { }
  }
});

/**
 * Switch sales report period: rep:<storeSlug>:(.+)
 */
bot.callbackQuery(/^rep:(\S+):(.+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const period = ctx.match[2];
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const { dateMin, dateMax } = getDateRangeForPeriod(period);
    const reports = await store.client.getSalesReports({ date_min: dateMin, date_max: dateMax });
    const reportData = reports[0];

    if (!reportData) {
      await ctx.answerCallbackQuery({ text: dict.noData });
      return;
    }

    const formatted = formatSalesReport(reportData, period, store.name, lang);
    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error switching report period:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * Top 10 Customers ranking: topc:<storeSlug>:(.+)
 */
bot.callbackQuery(/^topc:(\S+):(.+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const period = ctx.match[2];
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const customers = await store.client.getTopCustomers({ per_page: 10, period });
    const formatted = formatTopCustomers(customers, period, store.name, lang);

    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error loading top customers:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * Choose year menu for sales report or top customers: ryear:<storeSlug>:(sales|customers)
 */
bot.callbackQuery(/^ryear:(\S+):(sales|customers)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const target = ctx.match[2] as 'sales' | 'customers';
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const formatted = formatYearSelector(target, store.name, lang);
    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error opening year menu:', error);
  }
});

/**
 * Brands pagination: brp:<storeSlug>:(\d+)
 */
bot.callbackQuery(/^brp:(\S+):(\d+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const page = parseInt(ctx.match[2], 10);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const brands = await store.client.getBrands({ per_page: 100 });
    const formatted = formatBrandsList(brands, page, 8, lang, store.name);

    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error) {
    console.error('[Bot] Error paginating brands:', error);
    await ctx.answerCallbackQuery({ text: dict.errorLoadingBrands });
  }
});

/**
 * View brand products: brv:<storeSlug>:(\d+):(\d+)
 */
bot.callbackQuery(/^brv:(\S+):(\d+):(\d+)$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const brandId = parseInt(ctx.match[2], 10);
  const page = parseInt(ctx.match[3], 10);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const [brands, products] = await Promise.all([
      store.client.getBrands({ per_page: 100 }),
      store.client.getProductsByBrand(brandId, { per_page: 50 }),
    ]);

    const brand = brands.find((b) => b.id === brandId) || {
      id: brandId,
      name: `Brand #${brandId}`,
      slug: `brand-${brandId}`,
      count: products.length,
    };

    const formatted = formatBrandProducts(brand, products, page, 5, lang, store.name);
    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error viewing brand products:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * Select store for text search: srch_sel:<storeSlug>:<queryKey>
 */
bot.callbackQuery(/^srch_sel:(\S+):([0-9a-fA-F]{8})$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const queryKey = ctx.match[2];
  const query = getSearchQuery(queryKey);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  if (!query) {
    await ctx.answerCallbackQuery({ text: dict.searchExpired, show_alert: true });
    return;
  }

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const [searchResult, brands] = await Promise.all([
      store.client.searchProducts(query, { per_page: 30 }),
      store.client.getBrands({ search: query, per_page: 5 }),
    ]);

    searchCache.set(getSearchCacheKey(store.id, query), {
      products: searchResult.products,
      brands,
      total: searchResult.total,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const formatted = formatSearchResults(query, searchResult.products, brands, searchResult.total, 1, 6, lang, store.name, queryKey);
    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error executing selected store search:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    } catch { }
  }
});

/**
 * Search results pagination: srch:<storeSlug>:<page>:<queryKey>
 */
bot.callbackQuery(/^srch:(\S+):(\d+):([0-9a-fA-F]{8})$/, async (ctx) => {
  const storeSlug = decodeURIComponent(ctx.match[1]);
  const page = parseInt(ctx.match[2], 10) || 1;
  const queryKey = ctx.match[3];
  const query = getSearchQuery(queryKey);
  const chatId = ctx.chat?.id || 0;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  if (!query) {
    await ctx.answerCallbackQuery({ text: dict.searchExpired, show_alert: true });
    return;
  }

  try {
    const store = await resolveStore(chatId, storeSlug, lang);
    await ctx.answerCallbackQuery();

    const cacheKey = getSearchCacheKey(store.id, query);
    const cached = searchCache.get(cacheKey);

    let products: WooProduct[];
    let brands: WooBrand[];
    let total: number;

    if (cached && cached.expiresAt > Date.now()) {
      products = cached.products;
      brands = cached.brands;
      total = cached.total;
    } else {
      const [searchResult, fetchedBrands] = await Promise.all([
        store.client.searchProducts(query, { per_page: 30 }),
        store.client.getBrands({ search: query, per_page: 5 }),
      ]);
      products = searchResult.products;
      total = searchResult.total;
      brands = fetchedBrands;
      searchCache.set(cacheKey, {
        products,
        brands,
        total,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    }

    const formatted = formatSearchResults(query, products, brands, total, page, 6, lang, store.name, queryKey);
    await ctx.editMessageText(formatted.text, {
      parse_mode: 'HTML',
      reply_markup: formatted.reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (error: any) {
    if (error?.description?.includes('message is not modified')) return;
    console.error('[Bot] Error switching search page:', error);
    try {
      const msg = `${dict.errorPrefix} ${error?.message || error}`.slice(0, 150);
      await ctx.answerCallbackQuery({ text: msg });
    } catch { }
  }
});

bot.callbackQuery('noop', async (ctx) => {
  await ctx.answerCallbackQuery();
});

// ==========================================
// OUTGOING NOTIFICATIONS
// ==========================================

/**
 * Send order notification directly to all linked Telegram managers of the store.
 * Each manager receives the order formatted in their own preferred language.
 */
export async function sendOrderNotificationToStore(storeId: string, order: WooOrder) {
  const rawStore = await prisma.store.findUnique({ where: { id: storeId } });
  if (!rawStore || !rawStore.isActive) {
    console.warn(`[Bot Notification] Store ${storeId} not found or inactive`);
    return false;
  }

  const recipients = await getRecipientsForStoreNotification(storeId);
  if (recipients.length === 0) {
    console.warn(`[Bot Notification] Store "${rawStore.name}" has no active recipients`);
    return false;
  }

  for (const { chatId, language } of recipients) {
    try {
      const formatted = formatOrderMessage(order, rawStore.name, rawStore.url, {
        isWebhook: true,
        lang: (language as SupportedLanguage) || 'ru',
      });

      await bot.api.sendMessage(Number(chatId), formatted.text, {
        parse_mode: 'HTML',
        reply_markup: formatted.reply_markup,
      });
    } catch (err) {
      console.error(`[Bot Notification] Failed to send order notification to chatId ${chatId}:`, err);
    }
  }

  return true;
}
