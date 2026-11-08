import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { env } from '../../config/env.js';
import { wpBrandSale, type WpBrandSaleClient } from '../../services/wpBrandSale.js';
import { escapeHtml } from '../formatters/orderFormatter.js';
import { getUserLanguage, t, type SupportedLanguage } from '../i18n/index.js';
import { formatMadrid, parseMadridDate } from './madridTime.js';
import {
  buildDiscountsFromGroups,
  commitCurrentGroup,
  createInitialDraft,
  DraftOverlapError,
  prismaSaleDraftStore,
  pruneMissingBrandsFromDraft,
  resolveDraftStartUnix,
  selectStartNowOnDraft,
  startGroupSelection,
  toggleDraftBrand,
  type SaleDraftData,
  type SaleDraftStore,
} from './saleDraft.js';
import {
  formatWpError,
  renderCurrentSale,
  renderEditBrandCard,
  renderEditBrandList,
  renderEndSaleConfirm,
  renderSaleMainMenu,
  renderWizardAskMoreGroups,
  renderWizardConfirm,
  renderWizardCustomPercentPrompt,
  renderWizardEndPrompt,
  renderWizardPickBrands,
  renderWizardPickPercent,
  renderWizardReplaceWarning,
  renderWizardStartPrompt,
} from './saleFormatter.js';
import {
  clearPendingSaleInput,
  getPendingSaleInput,
  resetSaleInputOnUpdate,
  setPendingSaleInput,
} from './saleInputStore.js';
import {
  checkSaleAdmin,
  getSaleStatus,
  parsePercent,
  parseSaleDateInput,
  saleBrandNames,
  SaleEditError,
  validateWindow,
  withBrandPercent,
  withDates,
  withoutBrand,
} from './saleLogic.js';

/**
 * Admin check bound to `env.ADMIN_CHAT_ID` by default.
 * Only the primary administrator (`ADMIN_CHAT_ID`) may open or interact with the Discounts menu.
 */
export function isSaleAdmin(fromId: number | bigint | string | undefined, adminChatId = env.ADMIN_CHAT_ID): boolean {
  return checkSaleAdmin(fromId, adminChatId);
}

/**
 * Reset pending sale text input on ANY callback button press (e.g. "Back", "Cancel",
 * navigation) or ANY slash command before the handler runs.
 * Also pauses `awaitingText` on any persistent wizard draft if the user runs a slash command
 * or clicks a non-sale callback, so ordinary product search is never hijacked.
 */
export async function applySaleInputResetMiddleware(
  ctx: Pick<Context, 'chat' | 'from' | 'message' | 'callbackQuery'>,
  adminChatId = env.ADMIN_CHAT_ID,
  draftStore: SaleDraftStore = prismaSaleDraftStore
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isSaleAdmin(ctx.from?.id, adminChatId)) return;
  resetSaleInputOnUpdate({
    chatId,
    messageText: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,
  });

  const isCmd = Boolean(ctx.message?.text?.trim().startsWith('/'));
  const cbData = ctx.callbackQuery?.data;
  const isNonSaleCb = typeof cbData === 'string' && !cbData.startsWith('s:');
  if (isCmd || isNonSaleCb) {
    try {
      const draft = await draftStore.get(chatId);
      if (draft?.awaitingText) {
        await draftStore.save(chatId, { ...draft, awaitingText: false });
      }
    } catch {}
  }
}

async function guardCallbackAdmin(ctx: Context, adminChatId = env.ADMIN_CHAT_ID): Promise<boolean> {
  if (!isSaleAdmin(ctx.from?.id, adminChatId)) {
    try {
      await ctx.answerCallbackQuery();
    } catch {}
    return false;
  }
  return true;
}

async function editOrReply(
  ctx: Context,
  text: string,
  reply_markup?: InlineKeyboard,
  targetMessageId?: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  const msgId = targetMessageId ?? ctx.callbackQuery?.message?.message_id;
  if (chatId && msgId) {
    try {
      await ctx.api.editMessageText(chatId, msgId, text, {
        parse_mode: 'HTML',
        reply_markup,
      });
      return;
    } catch (err: any) {
      if (err?.description?.includes('message is not modified')) return;
    }
  }
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup });
}

async function loadAllBrandNames(client: Pick<WpBrandSaleClient, 'getBrands'>): Promise<Record<string, string>> {
  try {
    const list = await client.getBrands();
    const out: Record<string, string> = {};
    for (const b of list) out[String(b.id)] = b.name;
    return out;
  } catch {
    return {};
  }
}

async function loadExtraBrandNames(
  client: Pick<WpBrandSaleClient, 'getBrands'>,
  neededIds: string[]
): Promise<Record<string, string>> {
  if (neededIds.length === 0) return {};
  return loadAllBrandNames(client);
}

async function showCurrentSale(
  ctx: Context,
  lang: SupportedLanguage,
  client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale'> = wpBrandSale,
  targetMessageId?: number
): Promise<void> {
  const sale = await client.getSale();
  const known = saleBrandNames(sale);
  const missing = Object.keys(sale.discounts).filter((id) => !known[id]);
  const extra = await loadExtraBrandNames(client, missing);
  const view = renderCurrentSale(sale, extra, lang);
  await editOrReply(ctx, view.text, view.reply_markup, targetMessageId);
}

async function buildDraftStepView(
  draft: SaleDraftData,
  lang: SupportedLanguage,
  client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale'>
): Promise<{ text: string; reply_markup: InlineKeyboard }> {
  switch (draft.step) {
    case 'pick_pct': {
      const names = draft.groups.length > 0 ? await loadAllBrandNames(client) : draft.brandNames;
      return renderWizardPickPercent(draft, names, lang);
    }
    case 'await_custom_pct':
      return renderWizardCustomPercentPrompt(lang);
    case 'pick_brands': {
      const brands = await client.getBrands();
      return renderWizardPickBrands(draft, brands, lang);
    }
    case 'ask_more_groups': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(client)) };
      return renderWizardAskMoreGroups(draft, names, lang);
    }
    case 'await_start_date': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(client)) };
      return renderWizardStartPrompt(draft, names, lang);
    }
    case 'await_end_date':
      return renderWizardEndPrompt(draft, lang);
    case 'confirm': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(client)) };
      return renderWizardConfirm(draft, names, lang);
    }
    case 'confirm_replace': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(client)) };
      return renderWizardReplaceWarning(draft, names, lang);
    }
  }
}

async function renderDraftStep(
  ctx: Context,
  draft: SaleDraftData,
  lang: SupportedLanguage,
  client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale'>,
  targetMessageId?: number,
  prefixBanner?: string
): Promise<void> {
  const msgId = targetMessageId ?? draft.messageId;
  const view = await buildDraftStepView(draft, lang, client);
  const fullText = prefixBanner ? `${prefixBanner}\n\n${view.text}` : view.text;
  await editOrReply(ctx, fullText, view.reply_markup, msgId);
}

/**
 * Handles text messages when the admin is in a pending sale input state
 * ("Current sale" edit OR "New sale" wizard).
 * Returns `true` if the message was consumed by the sale flow.
 */
export async function handleSaleTextInput(
  ctx: Context,
  client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale' | 'saveSale' | 'endSale'> = wpBrandSale,
  adminChatId = env.ADMIN_CHAT_ID,
  draftStore: SaleDraftStore = prismaSaleDraftStore
): Promise<boolean> {
  if (!isSaleAdmin(ctx.from?.id, adminChatId)) return false;
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const text = ctx.message?.text?.trim() ?? '';
  if (text.startsWith('/')) {
    clearPendingSaleInput(chatId);
    try {
      const draft = await draftStore.get(chatId);
      if (draft?.awaitingText) {
        await draftStore.save(chatId, { ...draft, awaitingText: false });
      }
    } catch {}
    return false;
  }

  // 1. Check in-memory "Current sale" edit input first
  const pending = getPendingSaleInput(chatId);
  if (pending) {
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    if (pending.kind === 'edit_brand_pct') {
      const pct = parsePercent(text);
      if (pct === null) {
        await ctx.reply(dict.saleInvalidPercent, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(dict.btnBack, `s:ebs:${pending.brandId}`),
        });
        return true;
      }
      clearPendingSaleInput(chatId);
      try {
        await ctx.deleteMessage();
      } catch {}

      try {
        const fresh = await client.getSale();
        const cfg = withBrandPercent(fresh, pending.brandId, pct);
        const saved = await client.saveSale(cfg);
        const extra = await loadExtraBrandNames(client, [pending.brandId]);
        const view = renderCurrentSale(saved, extra, lang);
        await editOrReply(ctx, view.text, view.reply_markup, pending.messageId);
      } catch (err) {
        await editOrReply(
          ctx,
          formatWpError(err, lang),
          new InlineKeyboard().text(dict.btnSaleCurrent, 's:cur').text(dict.btnSaleMenu, 's:m'),
          pending.messageId
        );
      }
      return true;
    }

    if (pending.kind === 'edit_dates_start') {
      const startUnix = parseSaleDateInput(text, 'start');
      if (startUnix === null) {
        await ctx.reply(dict.saleInvalidDate, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(dict.btnBack, 's:cur'),
        });
        return true;
      }
      try {
        await ctx.deleteMessage();
      } catch {}
      setPendingSaleInput(chatId, {
        kind: 'edit_dates_end',
        startUnix,
        messageId: pending.messageId,
      });
      const kb = new InlineKeyboard()
        .text(dict.btnSaleKeep, `s:ede:keep:${startUnix}`)
        .row()
        .text(dict.btnBack, 's:cur');
      await editOrReply(
        ctx,
        `${dict.saleEditDatesTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 ${dict.saleStart}: <b>${formatMadrid(startUnix)}</b>\n\n` +
          dict.saleEnterEnd,
        kb,
        pending.messageId
      );
      return true;
    }

    if (pending.kind === 'edit_dates_end') {
      const endUnix = parseSaleDateInput(text, 'end');
      if (endUnix === null) {
        await ctx.reply(dict.saleInvalidDate, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(dict.btnBack, 's:cur'),
        });
        return true;
      }
      try {
        await ctx.deleteMessage();
      } catch {}

      try {
        const fresh = await client.getSale();
        const cfg = withDates(fresh, pending.startUnix, endUnix);
        clearPendingSaleInput(chatId);
        const saved = await client.saveSale(cfg);
        const view = renderCurrentSale(saved, {}, lang);
        await editOrReply(ctx, view.text, view.reply_markup, pending.messageId);
      } catch (err) {
        if (err instanceof SaleEditError && (err.code === 'END_BEFORE_START' || err.code === 'END_IN_PAST')) {
          await ctx.reply(formatWpError(err, lang), {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(dict.btnBack, 's:cur'),
          });
          return true;
        }
        clearPendingSaleInput(chatId);
        await editOrReply(
          ctx,
          formatWpError(err, lang),
          new InlineKeyboard().text(dict.btnSaleCurrent, 's:cur').text(dict.btnSaleMenu, 's:m'),
          pending.messageId
        );
      }
      return true;
    }
  }

  // 2. Check persistent "New sale" wizard draft (`SaleDraft`)
  let draft: SaleDraftData | null = null;
  try {
    draft = await draftStore.get(chatId);
  } catch {
    return false;
  }
  if (!draft || !draft.awaitingText) return false;

  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  if (draft.step === 'await_custom_pct') {
    const pct = parsePercent(text);
    if (pct === null) {
      await ctx.reply(dict.saleInvalidPercent, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(dict.btnBack, 's:npk')
          .text(dict.btnSaleCancel, 's:nx'),
      });
      return true;
    }
    try {
      await ctx.deleteMessage();
    } catch {}

    const next = await draftStore.save(chatId, startGroupSelection(draft, pct));
    try {
      await renderDraftStep(ctx, next, lang, client, draft.messageId);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:npk').text(dict.btnSaleCancel, 's:nx'),
        draft.messageId
      );
    }
    return true;
  }

  if (draft.step === 'await_start_date') {
    const startUnix = parseSaleDateInput(text, 'start');
    if (startUnix === null) {
      await ctx.reply(dict.saleInvalidDate, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(dict.btnBack, 's:nb:grp')
          .text(dict.btnSaleCancel, 's:nx'),
      });
      return true;
    }
    try {
      await ctx.deleteMessage();
    } catch {}

    const next = await draftStore.save(chatId, {
      ...draft,
      step: 'await_end_date',
      startUnix,
      startNow: false,
      awaitingText: true,
    });
    const view = renderWizardEndPrompt(next, lang);
    await editOrReply(ctx, view.text, view.reply_markup, draft.messageId);
    return true;
  }

  if (draft.step === 'await_end_date') {
    const endUnix = parseSaleDateInput(text, 'end');
    if (endUnix === null) {
      await ctx.reply(dict.saleInvalidDate, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(dict.btnBack, 's:na:n')
          .text(dict.btnSaleCancel, 's:nx'),
      });
      return true;
    }
    try {
      await ctx.deleteMessage();
    } catch {}

    try {
      const current = await client.getSale();
      const effectiveStart = resolveDraftStartUnix(draft, current.now);
      validateWindow(effectiveStart, endUnix, current.now);

      const next = await draftStore.save(chatId, {
        ...draft,
        step: 'confirm',
        // Keep startUnix undefined when startNow is true so it is calculated at Confirm time!
        startUnix: draft.startNow ? undefined : draft.startUnix,
        endUnix,
        awaitingText: false,
      });
      await renderDraftStep(ctx, next, lang, client, draft.messageId);
    } catch (err) {
      if (err instanceof SaleEditError && (err.code === 'END_BEFORE_START' || err.code === 'END_IN_PAST')) {
        await ctx.reply(formatWpError(err, lang), {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text(dict.btnBack, 's:na:n')
            .text(dict.btnSaleCancel, 's:nx'),
        });
        return true;
      }
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:na:n').text(dict.btnSaleCancel, 's:nx'),
        draft.messageId
      );
    }
    return true;
  }

  return false;
}

/**
 * Executes confirmation (`s:ncf` or `s:nrp`) with:
 * 1) Pruning any brands deleted on the site (`pruneMissingBrandsFromDraft`),
 * 2) Computing `start` at confirm time when `draft.startNow === true`,
 * 3) Re-validating `end > now` and `end > start` before `saveSale()`, returning to `await_end_date`
 *    with a clear message instead of failing with a 400 from WordPress.
 */
export async function executeWizardConfirm(
  ctx: Context,
  mode: 'initial' | 'replace',
  lang: SupportedLanguage,
  client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale' | 'saveSale'>,
  draftStore: SaleDraftStore
): Promise<void> {
  const chatId = ctx.chat?.id || 0;
  const dict = t(lang);

  const existing = await draftStore.get(chatId).catch(() => null);
  if (!existing || existing.groups.length === 0 || !existing.endUnix) {
    await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
    return;
  }

  try {
    // 1. Check that all brands in the draft still exist on the site
    const liveBrands = await client.getBrands({ force: true });
    const pruned = pruneMissingBrandsFromDraft(existing, liveBrands);
    if (pruned.removed.length > 0) {
      const savedPruned = await draftStore.save(chatId, pruned.draft);
      const droppedList = pruned.removed.map((r) => escapeHtml(r.name)).join(', ');
      const banner = dict.saleDraftDroppedBrands(droppedList);
      await ctx.answerCallbackQuery();
      await renderDraftStep(ctx, savedPruned, lang, client, existing.messageId, banner);
      return;
    }

    const draft = pruned.draft;
    const discounts = buildDiscountsFromGroups(draft.groups);

    // 2. Fetch fresh sale state & server `now`, and resolve `start` at Confirm time
    const current = await client.getSale();
    const start = resolveDraftStartUnix(draft, current.now);
    const end = draft.endUnix!;

    // 3. Re-validate `end > start` and `end > now` before calling saveSale()
    try {
      validateWindow(start, end, current.now);
    } catch (winErr) {
      if (
        winErr instanceof SaleEditError &&
        (winErr.code === 'END_BEFORE_START' || winErr.code === 'END_IN_PAST')
      ) {
        const reverted = await draftStore.save(chatId, {
          ...draft,
          step: 'await_end_date',
          endUnix: undefined,
          awaitingText: true,
        });
        const errMsg = formatWpError(winErr, lang);
        await ctx.answerCallbackQuery({ text: errMsg.replace(/<[^>]+>/g, '').slice(0, 180), show_alert: true });
        const endView = renderWizardEndPrompt(reverted, lang);
        await editOrReply(ctx, `${errMsg}\n\n${endView.text}`, endView.reply_markup, draft.messageId);
        return;
      }
      throw winErr;
    }

    // 4. On initial confirm (`s:ncf`), if a sale is currently running -> show separate warning screen
    if (mode === 'initial' && (current.active || getSaleStatus(current) === 'running')) {
      await ctx.answerCallbackQuery();
      const savedDraft = await draftStore.save(chatId, {
        ...draft,
        step: 'confirm_replace',
        // Keep startNow intact so s:nrp also computes start at the moment of final confirmation
        startUnix: draft.startNow ? undefined : draft.startUnix,
        awaitingText: false,
      });
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(client)) };
      const view = renderWizardReplaceWarning(savedDraft, names, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    // 5. Save the new sale configuration & clear the draft
    const savedSale = await client.saveSale({ start, end, discounts });
    await draftStore.clear(chatId);
    await ctx.answerCallbackQuery({ text: dict.saleNewCreated });
    const extra = await loadAllBrandNames(client);
    const view = renderCurrentSale(savedSale, extra, lang);
    await editOrReply(ctx, `${dict.saleNewCreated}\n\n${view.text}`, view.reply_markup);
  } catch (err) {
    await ctx.answerCallbackQuery();
    await editOrReply(
      ctx,
      formatWpError(err, lang),
      new InlineKeyboard().text(dict.btnSaleCancel, 's:nx').text(dict.btnSaleMenu, 's:m')
    );
  }
}

/**
 * Registers `/discounts` and all `s:*` callbacks on the bot.
 */
export function registerSaleHandlers(
  bot: Bot,
  client = wpBrandSale,
  draftStore: SaleDraftStore = prismaSaleDraftStore,
  adminChatId = env.ADMIN_CHAT_ID
): void {
  // Clear pending sale text input on ANY command or ANY callback button press
  bot.use(async (ctx, next) => {
    await applySaleInputResetMiddleware(ctx, adminChatId, draftStore);
    return await next();
  });

  // Hidden admin command: /discounts
  bot.command('discounts', async (ctx) => {
    if (!isSaleAdmin(ctx.from?.id, adminChatId)) return;
    const chatId = ctx.chat.id;
    clearPendingSaleInput(chatId);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    if (!client.isConfigured()) {
      await ctx.reply(dict.saleNotConfigured, { parse_mode: 'HTML' });
      return;
    }

    const existingDraft = await draftStore.get(chatId).catch(() => null);
    const view = renderSaleMainMenu(lang, Boolean(existingDraft));
    await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.reply_markup });
  });

  // Main discounts menu: s:m
  bot.callbackQuery('s:m', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const existingDraft = await draftStore.get(chatId).catch(() => null);
    if (existingDraft?.awaitingText) {
      await draftStore.save(chatId, { ...existingDraft, awaitingText: false }).catch(() => {});
    }
    const view = renderSaleMainMenu(lang, Boolean(existingDraft));
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Current sale view: s:cur
  bot.callbackQuery('s:cur', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      await showCurrentSale(ctx, lang, client);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnSaleRefresh, 's:cur').text(dict.btnSaleMenu, 's:m')
      );
    }
  });

  // Edit brand — paginated list of brands in current sale: s:eb:<page>
  bot.callbackQuery(/^s:eb:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const page = parseInt(ctx.match[1], 10);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      const sale = await client.getSale();
      if (Object.keys(sale.discounts).length === 0 || getSaleStatus(sale) === 'ended') {
        const view = renderCurrentSale(sale, {}, lang);
        await editOrReply(ctx, `${dict.saleNoActive}\n\n${view.text}`, view.reply_markup);
        return;
      }
      const known = saleBrandNames(sale);
      const missing = Object.keys(sale.discounts).filter((id) => !known[id]);
      const extra = await loadExtraBrandNames(client, missing);
      const view = renderEditBrandList(sale, extra, page, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:cur')
      );
    }
  });

  // Edit single brand card: s:ebs:<brandId>
  bot.callbackQuery(/^s:ebs:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const brandId = ctx.match[1];
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      const sale = await client.getSale();
      const pct = sale.discounts[brandId];
      if (pct === undefined) {
        await editOrReply(
          ctx,
          dict.saleBrandNotInSale,
          new InlineKeyboard().text(dict.btnBack, 's:cur')
        );
        return;
      }
      const extra = sale.brands[brandId]?.name ? {} : await loadExtraBrandNames(client, [brandId]);
      const name = sale.brands[brandId]?.name ?? extra[brandId] ?? `#${brandId}`;
      const view = renderEditBrandCard(brandId, name, pct, Object.keys(sale.discounts).length, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:cur'));
    }
  });

  // Preset percentage chosen for a brand: s:ebp:<brandId>:<pct>
  // Fresh getSale() -> local edit -> single saveSale()
  bot.callbackQuery(/^s:ebp:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const brandId = ctx.match[1];
    const pct = parseInt(ctx.match[2], 10);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    try {
      const fresh = await client.getSale();
      const cfg = withBrandPercent(fresh, brandId, pct);
      const saved = await client.saveSale(cfg);
      const name = saved.brands[brandId]?.name ?? fresh.brands[brandId]?.name ?? `#${brandId}`;
      await ctx.answerCallbackQuery({ text: dict.saleBrandUpdated(name, pct) });
      const view = renderCurrentSale(saved, {}, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:cur'));
    }
  });

  // Custom percentage prompt for a brand: s:ebc:<brandId>
  bot.callbackQuery(/^s:ebc:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const brandId = ctx.match[1];
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    setPendingSaleInput(chatId, {
      kind: 'edit_brand_pct',
      brandId,
      messageId: ctx.callbackQuery.message?.message_id,
    });

    await editOrReply(
      ctx,
      `${dict.saleEditBrandTitle}\n━━━━━━━━━━━━━━━━━━━━━\n${dict.saleEnterPercent}`,
      new InlineKeyboard().text(dict.btnBack, `s:ebs:${brandId}`)
    );
  });

  // Remove brand from sale: s:ebr:<brandId>
  // Fresh getSale() -> forbid if last brand -> single saveSale()
  bot.callbackQuery(/^s:ebr:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const brandId = ctx.match[1];
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    try {
      const fresh = await client.getSale();
      const name = fresh.brands[brandId]?.name ?? `#${brandId}`;
      const cfg = withoutBrand(fresh, brandId);
      const saved = await client.saveSale(cfg);
      await ctx.answerCallbackQuery({ text: dict.saleBrandRemoved(name) });
      const view = renderCurrentSale(saved, {}, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      if (err instanceof SaleEditError && err.code === 'LAST_BRAND') {
        await ctx.answerCallbackQuery({ text: dict.saleLastBrand.slice(0, 180), show_alert: true });
        const kb = new InlineKeyboard()
          .text(dict.btnSaleEndNow, 's:end:ask')
          .row()
          .text(dict.btnBack, 's:cur');
        await editOrReply(ctx, dict.saleLastBrand, kb);
        return;
      }
      await ctx.answerCallbackQuery();
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:cur'));
    }
  });

  // Edit dates — step 1 (start date): s:ed
  bot.callbackQuery('s:ed', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      const sale = await client.getSale();
      if (!sale.start || !sale.end || Object.keys(sale.discounts).length === 0) {
        await editOrReply(ctx, dict.saleNoActive, new InlineKeyboard().text(dict.btnBack, 's:cur'));
        return;
      }
      setPendingSaleInput(chatId, {
        kind: 'edit_dates_start',
        messageId: ctx.callbackQuery.message?.message_id,
      });
      const kb = new InlineKeyboard()
        .text(dict.btnSaleNow, 's:eds:now')
        .text(`${dict.btnSaleKeep} (${formatMadrid(sale.start)})`, 's:eds:keep')
        .row()
        .text(dict.btnBack, 's:cur');
      await editOrReply(
        ctx,
        `${dict.saleEditDatesTitle}\n━━━━━━━━━━━━━━━━━━━━━\n${dict.saleEnterStart}`,
        kb
      );
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:cur'));
    }
  });

  // Edit dates — start chosen via button (now | keep): s:eds:(now|keep)
  bot.callbackQuery(/^s:eds:(now|keep)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const mode = ctx.match[1] as 'now' | 'keep';
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      const sale = await client.getSale();
      if (!sale.start || !sale.end) {
        await editOrReply(ctx, dict.saleNoActive, new InlineKeyboard().text(dict.btnBack, 's:cur'));
        return;
      }
      const startUnix = mode === 'now' ? sale.now : sale.start;
      setPendingSaleInput(chatId, {
        kind: 'edit_dates_end',
        startUnix,
        messageId: ctx.callbackQuery.message?.message_id,
      });
      const kb = new InlineKeyboard()
        .text(`${dict.btnSaleKeep} (${formatMadrid(sale.end)})`, `s:ede:keep:${startUnix}`)
        .row()
        .text(dict.btnBack, 's:cur');
      await editOrReply(
        ctx,
        `${dict.saleEditDatesTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
          `📅 ${dict.saleStart}: <b>${formatMadrid(startUnix)}</b>\n\n` +
          dict.saleEnterEnd,
        kb
      );
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:cur'));
    }
  });

  // Edit dates — keep existing end date: s:ede:keep:<startUnix>
  bot.callbackQuery(/^s:ede:keep:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const startUnix = parseInt(ctx.match[1], 10);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    try {
      const fresh = await client.getSale();
      if (!fresh.end) throw new SaleEditError('NO_SALE');
      validateWindow(startUnix, fresh.end, fresh.now);
      const cfg = withDates(fresh, startUnix, fresh.end);
      const saved = await client.saveSale(cfg);
      await ctx.answerCallbackQuery({ text: dict.saleDatesUpdated });
      const view = renderCurrentSale(saved, {}, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:cur')
      );
    }
  });

  // End sale — confirmation prompt: s:end:ask
  bot.callbackQuery('s:end:ask', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      const sale = await client.getSale();
      const status = getSaleStatus(sale);
      if (status === 'none' || status === 'ended') {
        const view = renderCurrentSale(sale, {}, lang);
        await editOrReply(ctx, `${dict.saleNothingToEnd}\n\n${view.text}`, view.reply_markup);
        return;
      }
      const view = renderEndSaleConfirm(lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:m'));
    }
  });

  // End sale — execute DELETE /brand-sale: s:end:do
  bot.callbackQuery('s:end:do', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    try {
      const ended = await client.endSale();
      await ctx.answerCallbackQuery({ text: dict.saleEnded });
      const view = renderCurrentSale(ended, {}, lang);
      await editOrReply(ctx, `${dict.saleEnded}\n\n${view.text}`, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, 's:cur'));
    }
  });

  // ==========================================
  // "NEW SALE" WIZARD CALLBACKS (WITH PRISMA DRAFT)
  // ==========================================

  // Start new sale wizard: s:new
  bot.callbackQuery('s:new', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await ctx.answerCallbackQuery();

    try {
      const draft = await draftStore.save(
        chatId,
        createInitialDraft(ctx.callbackQuery.message?.message_id)
      );
      const view = renderWizardPickPercent(draft, {}, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(t(lang).btnSaleMenu, 's:m'));
    }
  });

  // Resume existing draft (<24h): s:nrs
  // Also prunes any brands that were deleted on the site and shows which brands were dropped.
  bot.callbackQuery('s:nrs', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      const view = renderSaleMainMenu(lang, false);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const liveBrands = await client.getBrands({ force: true });
      const pruned = pruneMissingBrandsFromDraft(existing, liveBrands);
      const shouldAwaitText =
        pruned.draft.step === 'await_custom_pct' ||
        pruned.draft.step === 'await_start_date' ||
        pruned.draft.step === 'await_end_date';

      const updated = await draftStore.save(chatId, {
        ...pruned.draft,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
        awaitingText: shouldAwaitText,
      });

      const banner =
        pruned.removed.length > 0
          ? dict.saleDraftDroppedBrands(pruned.removed.map((r) => escapeHtml(r.name)).join(', '))
          : undefined;
      await renderDraftStep(ctx, updated, lang, client, undefined, banner);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnSaleMenu, 's:m'));
    }
  });

  // Return to Step 1 (pick discount %): s:npk
  bot.callbackQuery('s:npk', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await ctx.answerCallbackQuery();

    const existing = (await draftStore.get(chatId).catch(() => null)) ?? createInitialDraft();
    const updated = await draftStore.save(chatId, {
      ...existing,
      step: 'pick_pct',
      currentPct: undefined,
      currentBrandIds: [],
      page: 1,
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: false,
    });
    const names = updated.groups.length > 0 ? await loadAllBrandNames(client) : updated.brandNames;
    const view = renderWizardPickPercent(updated, names, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 1 preset percentage chosen: s:npct:<pct>
  bot.callbackQuery(/^s:npct:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const pct = parseInt(ctx.match[1], 10);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    await ctx.answerCallbackQuery();

    try {
      const existing = (await draftStore.get(chatId)) ?? createInitialDraft();
      const brands = await client.getBrands();
      const pruned = pruneMissingBrandsFromDraft(existing, brands);
      const next = await draftStore.save(chatId, {
        ...startGroupSelection(pruned.draft, pct),
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      });
      const view = renderWizardPickBrands(next, brands, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:npk').text(dict.btnSaleCancel, 's:nx')
      );
    }
  });

  // Step 1 custom percentage button: s:npc
  bot.callbackQuery('s:npc', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await ctx.answerCallbackQuery();

    const existing = (await draftStore.get(chatId).catch(() => null)) ?? createInitialDraft();
    await draftStore.save(chatId, {
      ...existing,
      step: 'await_custom_pct',
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: true,
    });
    const view = renderWizardCustomPercentPrompt(lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 2 toggle brand selection: s:t:<brandId>
  bot.callbackQuery(/^s:t:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const brandId = ctx.match[1];
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing || existing.step !== 'pick_brands' || !existing.currentPct) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    try {
      const brands = await client.getBrands();
      const brandName = brands.find((b) => String(b.id) === brandId)?.name ?? `#${brandId}`;
      let toggled;
      try {
        toggled = toggleDraftBrand(existing, brandId, brandName);
      } catch (err) {
        if (err instanceof DraftOverlapError) {
          await ctx.answerCallbackQuery({
            text: dict.saleBrandLockedToast(brandName, err.existingPct),
            show_alert: true,
          });
          return;
        }
        throw err;
      }

      const saved = await draftStore.save(chatId, {
        ...toggled.draft,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      });
      await ctx.answerCallbackQuery();
      const view = renderWizardPickBrands(saved, brands, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:npk').text(dict.btnSaleCancel, 's:nx')
      );
    }
  });

  // Step 2 brand pagination: s:np:<page>
  bot.callbackQuery(/^s:np:(\d+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const page = parseInt(ctx.match[1], 10);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing || existing.step !== 'pick_brands' || !existing.currentPct) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const brands = await client.getBrands();
      const saved = await draftStore.save(chatId, {
        ...existing,
        page,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      });
      const view = renderWizardPickBrands(saved, brands, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, 's:npk').text(dict.btnSaleCancel, 's:nx')
      );
    }
  });

  // Step 2 "Done" with current brand group: s:nd
  bot.callbackQuery('s:nd', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing || existing.step !== 'pick_brands') {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    const committed = commitCurrentGroup(existing);
    if (!committed) {
      await ctx.answerCallbackQuery({ text: dict.saleSelectAtLeastOneBrand, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const saved = await draftStore.save(chatId, {
      ...committed,
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
    });
    const names = { ...saved.brandNames, ...(await loadAllBrandNames(client)) };
    const view = renderWizardAskMoreGroups(saved, names, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 3 "Add another group?": s:na:(y|n)
  bot.callbackQuery(/^s:na:(y|n)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const choice = ctx.match[1] as 'y' | 'n';
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing || existing.groups.length === 0) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const names = { ...existing.brandNames, ...(await loadAllBrandNames(client)) };

    if (choice === 'y') {
      const saved = await draftStore.save(chatId, {
        ...existing,
        step: 'pick_pct',
        currentPct: undefined,
        currentBrandIds: [],
        page: 1,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
        awaitingText: false,
      });
      const view = renderWizardPickPercent(saved, names, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    const saved = await draftStore.save(chatId, {
      ...existing,
      step: 'await_start_date',
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: true,
    });
    const view = renderWizardStartPrompt(saved, names, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Back to Step 3 (ask_more_groups) from start date prompt: s:nb:grp
  bot.callbackQuery('s:nb:grp', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing || existing.groups.length === 0) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const saved = await draftStore.save(chatId, {
      ...existing,
      step: 'ask_more_groups',
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: false,
    });
    const names = { ...saved.brandNames, ...(await loadAllBrandNames(client)) };
    const view = renderWizardAskMoreGroups(saved, names, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 4a "Now" button for start date: s:ns:now
  // Stores ONLY `startNow = true` (`startUnix = undefined`); concrete unix time is computed at Confirm time.
  bot.callbackQuery('s:ns:now', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const existing = await draftStore.get(chatId).catch(() => null);
    if (!existing || existing.groups.length === 0) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const saved = await draftStore.save(chatId, {
      ...selectStartNowOnDraft(existing),
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
    });
    const view = renderWizardEndPrompt(saved, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 5/6 Confirm new sale: s:ncf
  bot.callbackQuery('s:ncf', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await executeWizardConfirm(ctx, 'initial', lang, client, draftStore);
  });

  // Step 6b Confirmed replacement of a running sale: s:nrp -> single saveSale()
  bot.callbackQuery('s:nrp', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await executeWizardConfirm(ctx, 'replace', lang, client, draftStore);
  });

  // Cancel wizard & delete draft: s:nx
  bot.callbackQuery('s:nx', async (ctx) => {
    if (!(await guardCallbackAdmin(ctx, adminChatId))) return;
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    await draftStore.clear(chatId).catch(() => {});
    clearPendingSaleInput(chatId);
    await ctx.answerCallbackQuery({ text: dict.saleNewCancelled });
    const view = renderSaleMainMenu(lang, false);
    await editOrReply(ctx, `${dict.saleNewCancelled}\n\n${view.text}`, view.reply_markup);
  });
}
