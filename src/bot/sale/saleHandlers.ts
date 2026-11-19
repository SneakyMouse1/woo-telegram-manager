import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { env } from '../../config/env.js';
import {
  defaultSaleStoreResolver,
  SaleAccessError,
  type ResolvedSaleStore,
  type SaleStoreResolver,
  type WpBrandSaleClient,
} from '../../services/wpBrandSale.js';
import { escapeHtml } from '../formatters/orderFormatter.js';
import { getUserLanguage, t, type SupportedLanguage } from '../i18n/index.js';
import { formatMadrid } from './madridTime.js';
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
  renderSaleStorePicker,
  renderWizardAskMoreGroups,
  renderWizardConfirm,
  renderWizardCustomPercentPrompt,
  renderWizardEndPrompt,
  renderWizardPickBrands,
  renderWizardPickPercent,
  renderWizardReplaceWarning,
  renderWizardStartPrompt,
  type SaleStoreViewCtx,
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
 * Helper checking whether `fromId` matches `ADMIN_CHAT_ID`.
 */
export function isSaleAdmin(fromId: number | bigint | string | undefined, adminChatId = env.ADMIN_CHAT_ID): boolean {
  return checkSaleAdmin(fromId, adminChatId);
}

/**
 * Reset pending sale text input on ANY callback button press (e.g. "Back", "Cancel",
 * navigation) or ANY slash command before the handler runs.
 * Also pauses `awaitingText` on any persistent wizard drafts for this chat so ordinary
 * product search is never hijacked. Handlers that enter a text-awaiting step explicitly
 * set `awaitingText: true` afterwards.
 */
export async function applySaleInputResetMiddleware(
  ctx: Pick<Context, 'chat' | 'from' | 'message' | 'callbackQuery'>,
  draftStore: SaleDraftStore = prismaSaleDraftStore
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  resetSaleInputOnUpdate({
    chatId,
    messageText: ctx.message?.text,
    callbackData: ctx.callbackQuery?.data,
  });

  const isCmd = Boolean(ctx.message?.text?.trim().startsWith('/'));
  const isCallback = typeof ctx.callbackQuery?.data === 'string';
  if (isCmd || isCallback) {
    try {
      await draftStore.pauseAllAwaitingText(chatId);
    } catch {}
  }
}

async function resolveCallbackStore(
  ctx: Context,
  rawSlug: string,
  lang: SupportedLanguage,
  resolver: SaleStoreResolver
): Promise<ResolvedSaleStore | null> {
  const fromId = ctx.from?.id ?? ctx.chat?.id;
  if (!fromId) return null;

  let storeSlug: string;
  try {
    storeSlug = decodeURIComponent(rawSlug);
  } catch {
    storeSlug = rawSlug;
  }

  try {
    return await resolver.resolveSaleStore(fromId, storeSlug, lang);
  } catch (err) {
    if (err instanceof SaleAccessError) {
      try {
        const plainMsg = err.message.replace(/<[^>]+>/g, '').slice(0, 180);
        await ctx.answerCallbackQuery({ text: plainMsg, show_alert: true });
      } catch {}
      return null;
    }
    throw err;
  }
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
  store: SaleStoreViewCtx & { client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale'> },
  lang: SupportedLanguage,
  targetMessageId?: number
): Promise<void> {
  const sale = await store.client.getSale();
  const known = saleBrandNames(sale);
  const missing = Object.keys(sale.discounts).filter((id) => !known[id]);
  const extra = await loadExtraBrandNames(store.client, missing);
  const view = renderCurrentSale(sale, extra, store, lang);
  await editOrReply(ctx, view.text, view.reply_markup, targetMessageId);
}

async function buildDraftStepView(
  draft: SaleDraftData,
  store: SaleStoreViewCtx & { client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale'> },
  lang: SupportedLanguage
): Promise<{ text: string; reply_markup: InlineKeyboard }> {
  switch (draft.step) {
    case 'pick_pct': {
      const names = draft.groups.length > 0 ? await loadAllBrandNames(store.client) : draft.brandNames;
      return renderWizardPickPercent(draft, names, store, lang);
    }
    case 'await_custom_pct':
      return renderWizardCustomPercentPrompt(store, lang);
    case 'pick_brands': {
      const brands = await store.client.getBrands();
      return renderWizardPickBrands(draft, brands, store, lang);
    }
    case 'ask_more_groups': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(store.client)) };
      return renderWizardAskMoreGroups(draft, names, store, lang);
    }
    case 'await_start_date': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(store.client)) };
      return renderWizardStartPrompt(draft, names, store, lang);
    }
    case 'await_end_date':
      return renderWizardEndPrompt(draft, store, lang);
    case 'confirm': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(store.client)) };
      return renderWizardConfirm(draft, names, store, lang);
    }
    case 'confirm_replace': {
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(store.client)) };
      return renderWizardReplaceWarning(draft, names, store, lang);
    }
  }
}

async function renderDraftStep(
  ctx: Context,
  draft: SaleDraftData,
  store: SaleStoreViewCtx & { client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale'> },
  lang: SupportedLanguage,
  targetMessageId?: number,
  prefixBanner?: string
): Promise<void> {
  const msgId = targetMessageId ?? draft.messageId;
  const view = await buildDraftStepView(draft, store, lang);
  const fullText = prefixBanner ? `${prefixBanner}\n\n${view.text}` : view.text;
  await editOrReply(ctx, fullText, view.reply_markup, msgId);
}

/**
 * Handles text messages when an authorized user is in a pending sale input state
 * ("Current sale" edit OR "New sale" wizard).
 * Always re-verifies store access via `resolver.resolveSaleStore` before calling WordPress API.
 * Returns `true` if the message was consumed by the sale flow.
 */
export async function handleSaleTextInput(
  ctx: Context,
  resolver: SaleStoreResolver = defaultSaleStoreResolver,
  draftStore: SaleDraftStore = prismaSaleDraftStore
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const fromId = ctx.from?.id ?? chatId;
  if (!chatId || !fromId) return false;

  const text = ctx.message?.text?.trim() ?? '';
  if (text.startsWith('/')) {
    clearPendingSaleInput(chatId);
    try {
      await draftStore.pauseAllAwaitingText(chatId);
    } catch {}
    return false;
  }

  // 1. Check in-memory "Current sale" edit input first
  const pending = getPendingSaleInput(chatId);
  if (pending) {
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    let store: ResolvedSaleStore;
    try {
      store = await resolver.resolveSaleStore(fromId, pending.storeSlug, lang);
    } catch (err) {
      clearPendingSaleInput(chatId);
      if (err instanceof SaleAccessError) {
        await ctx.reply(err.message, { parse_mode: 'HTML' });
        return true;
      }
      throw err;
    }

    const s = encodeURIComponent(store.slug);

    if (pending.kind === 'edit_brand_pct') {
      const pct = parsePercent(text);
      if (pct === null) {
        await ctx.reply(dict.saleInvalidPercent, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(dict.btnBack, `s:ebs:${s}:${pending.brandId}`),
        });
        return true;
      }
      clearPendingSaleInput(chatId);
      try {
        await ctx.deleteMessage();
      } catch {}

      try {
        const fresh = await store.client.getSale();
        const cfg = withBrandPercent(fresh, pending.brandId, pct);
        const saved = await store.client.saveSale(cfg);
        const extra = await loadExtraBrandNames(store.client, [pending.brandId]);
        const view = renderCurrentSale(saved, extra, store, lang);
        await editOrReply(ctx, view.text, view.reply_markup, pending.messageId);
      } catch (err) {
        await editOrReply(
          ctx,
          formatWpError(err, lang),
          new InlineKeyboard().text(dict.btnSaleCurrent, `s:cur:${s}`).text(dict.btnSaleMenu, `s:m:${s}`),
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
          reply_markup: new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`),
        });
        return true;
      }
      try {
        await ctx.deleteMessage();
      } catch {}
      setPendingSaleInput(chatId, {
        kind: 'edit_dates_end',
        storeSlug: store.slug,
        startUnix,
        messageId: pending.messageId,
      });
      const kb = new InlineKeyboard()
        .text(dict.btnSaleKeep, `s:ede:${s}:keep:${startUnix}`)
        .row()
        .text(dict.btnBack, `s:cur:${s}`);
      await editOrReply(
        ctx,
        `${dict.saleEditDatesTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏪 <b>${escapeHtml(store.name)}</b>\n` +
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
          reply_markup: new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`),
        });
        return true;
      }
      try {
        await ctx.deleteMessage();
      } catch {}

      try {
        const fresh = await store.client.getSale();
        const cfg = withDates(fresh, pending.startUnix, endUnix);
        clearPendingSaleInput(chatId);
        const saved = await store.client.saveSale(cfg);
        const view = renderCurrentSale(saved, {}, store, lang);
        await editOrReply(ctx, view.text, view.reply_markup, pending.messageId);
      } catch (err) {
        if (err instanceof SaleEditError && (err.code === 'END_BEFORE_START' || err.code === 'END_IN_PAST')) {
          await ctx.reply(formatWpError(err, lang), {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`),
          });
          return true;
        }
        clearPendingSaleInput(chatId);
        await editOrReply(
          ctx,
          formatWpError(err, lang),
          new InlineKeyboard().text(dict.btnSaleCurrent, `s:cur:${s}`).text(dict.btnSaleMenu, `s:m:${s}`),
          pending.messageId
        );
      }
      return true;
    }
  }

  // 2. Check persistent "New sale" wizard drafts (`SaleDraft`)
  let activeDraft: { storeKey: string; draft: SaleDraftData } | null = null;
  try {
    activeDraft = await draftStore.getActiveAwaitingText(chatId);
  } catch {
    return false;
  }
  if (!activeDraft) return false;

  const { storeKey, draft } = activeDraft;
  const lang = await getUserLanguage(chatId, ctx.from?.language_code);
  const dict = t(lang);

  let store: ResolvedSaleStore;
  try {
    store = await resolver.resolveSaleStore(fromId, storeKey, lang);
  } catch (err) {
    await draftStore.pauseAllAwaitingText(chatId).catch(() => {});
    if (err instanceof SaleAccessError) {
      await ctx.reply(err.message, { parse_mode: 'HTML' });
      return true;
    }
    throw err;
  }

  const s = encodeURIComponent(store.slug);

  if (draft.step === 'await_custom_pct') {
    const pct = parsePercent(text);
    if (pct === null) {
      await ctx.reply(dict.saleInvalidPercent, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(dict.btnBack, `s:npk:${s}`)
          .text(dict.btnSaleCancel, `s:nx:${s}`),
      });
      return true;
    }
    try {
      await ctx.deleteMessage();
    } catch {}

    const next = await draftStore.save(chatId, store.slug, startGroupSelection(draft, pct));
    try {
      await renderDraftStep(ctx, next, store, lang, draft.messageId);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:npk:${s}`).text(dict.btnSaleCancel, `s:nx:${s}`),
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
          .text(dict.btnBack, `s:nb:grp:${s}`)
          .text(dict.btnSaleCancel, `s:nx:${s}`),
      });
      return true;
    }
    try {
      await ctx.deleteMessage();
    } catch {}

    const next = await draftStore.save(chatId, store.slug, {
      ...draft,
      step: 'await_end_date',
      startUnix,
      startNow: false,
      awaitingText: true,
    });
    const view = renderWizardEndPrompt(next, store, lang);
    await editOrReply(ctx, view.text, view.reply_markup, draft.messageId);
    return true;
  }

  if (draft.step === 'await_end_date') {
    const endUnix = parseSaleDateInput(text, 'end');
    if (endUnix === null) {
      await ctx.reply(dict.saleInvalidDate, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text(dict.btnBack, `s:na:${s}:n`)
          .text(dict.btnSaleCancel, `s:nx:${s}`),
      });
      return true;
    }
    try {
      await ctx.deleteMessage();
    } catch {}

    try {
      const current = await store.client.getSale();
      const effectiveStart = resolveDraftStartUnix(draft, current.now);
      validateWindow(effectiveStart, endUnix, current.now);

      const next = await draftStore.save(chatId, store.slug, {
        ...draft,
        step: 'confirm',
        // Keep startUnix undefined when startNow is true so it is calculated at Confirm time!
        startUnix: draft.startNow ? undefined : draft.startUnix,
        endUnix,
        awaitingText: false,
      });
      await renderDraftStep(ctx, next, store, lang, draft.messageId);
    } catch (err) {
      if (err instanceof SaleEditError && (err.code === 'END_BEFORE_START' || err.code === 'END_IN_PAST')) {
        await ctx.reply(formatWpError(err, lang), {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text(dict.btnBack, `s:na:${s}:n`)
            .text(dict.btnSaleCancel, `s:nx:${s}`),
        });
        return true;
      }
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:na:${s}:n`).text(dict.btnSaleCancel, `s:nx:${s}`),
        draft.messageId
      );
    }
    return true;
  }

  return false;
}

/**
 * Executes confirmation (`s:ncf:<slug>` or `s:nrp:<slug>`) with:
 * 1) Pruning any brands deleted on the site (`pruneMissingBrandsFromDraft`),
 * 2) Computing `start` at confirm time when `draft.startNow === true`,
 * 3) Re-validating `end > now` and `end > start` before `saveSale()`, returning to `await_end_date`
 *    with a clear message instead of failing with a 400 from WordPress.
 */
export async function executeWizardConfirm(
  ctx: Context,
  mode: 'initial' | 'replace',
  store: SaleStoreViewCtx & { client: Pick<WpBrandSaleClient, 'getBrands' | 'getSale' | 'saveSale'> },
  lang: SupportedLanguage,
  draftStore: SaleDraftStore
): Promise<void> {
  const chatId = ctx.chat?.id || 0;
  const dict = t(lang);
  const s = encodeURIComponent(store.slug);

  const existing = await draftStore.get(chatId, store.slug).catch(() => null);
  if (!existing || existing.groups.length === 0 || !existing.endUnix) {
    await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
    return;
  }

  try {
    // 1. Check that all brands in the draft still exist on the site
    const liveBrands = await store.client.getBrands({ force: true });
    const pruned = pruneMissingBrandsFromDraft(existing, liveBrands);
    if (pruned.removed.length > 0) {
      const savedPruned = await draftStore.save(chatId, store.slug, pruned.draft);
      const droppedList = pruned.removed.map((r) => escapeHtml(r.name)).join(', ');
      const banner = dict.saleDraftDroppedBrands(droppedList);
      await ctx.answerCallbackQuery();
      await renderDraftStep(ctx, savedPruned, store, lang, existing.messageId, banner);
      return;
    }

    const draft = pruned.draft;
    const discounts = buildDiscountsFromGroups(draft.groups);

    // 2. Fetch fresh sale state & server `now`, and resolve `start` at Confirm time
    const current = await store.client.getSale();
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
        const reverted = await draftStore.save(chatId, store.slug, {
          ...draft,
          step: 'await_end_date',
          endUnix: undefined,
          awaitingText: true,
        });
        const errMsg = formatWpError(winErr, lang);
        await ctx.answerCallbackQuery({ text: errMsg.replace(/<[^>]+>/g, '').slice(0, 180), show_alert: true });
        const endView = renderWizardEndPrompt(reverted, store, lang);
        await editOrReply(ctx, `${errMsg}\n\n${endView.text}`, endView.reply_markup, draft.messageId);
        return;
      }
      throw winErr;
    }

    // 4. On initial confirm (`s:ncf:<slug>`), if a sale is currently running -> show separate warning screen
    if (mode === 'initial' && (current.active || getSaleStatus(current) === 'running')) {
      await ctx.answerCallbackQuery();
      const savedDraft = await draftStore.save(chatId, store.slug, {
        ...draft,
        step: 'confirm_replace',
        // Keep startNow intact so s:nrp also computes start at the moment of final confirmation
        startUnix: draft.startNow ? undefined : draft.startUnix,
        awaitingText: false,
      });
      const names = { ...draft.brandNames, ...(await loadAllBrandNames(store.client)) };
      const view = renderWizardReplaceWarning(savedDraft, names, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    // 5. Save the new sale configuration & clear the draft
    const savedSale = await store.client.saveSale({ start, end, discounts });
    await draftStore.clear(chatId, store.slug);
    await ctx.answerCallbackQuery({ text: dict.saleNewCreated });
    const extra = await loadAllBrandNames(store.client);
    const view = renderCurrentSale(savedSale, extra, store, lang);
    await editOrReply(ctx, `${dict.saleNewCreated}\n\n${view.text}`, view.reply_markup);
  } catch (err) {
    await ctx.answerCallbackQuery();
    await editOrReply(
      ctx,
      formatWpError(err, lang),
      new InlineKeyboard().text(dict.btnSaleCancel, `s:nx:${s}`).text(dict.btnSaleMenu, `s:m:${s}`)
    );
  }
}

export interface RegisterSaleHandlersOptions {
  /**
   * Whether to register `applySaleInputResetMiddleware` inside `registerSaleHandlers`.
   * Set to `false` when the parent bot already invokes it at the top of the middleware chain.
   */
  registerResetMiddleware?: boolean;
}

/**
 * Registers `/discounts [store]` and all store-scoped `s:*` callbacks on the bot.
 * Enforces strict multi-store isolation via `resolver`:
 * - Master administrator (`ADMIN_CHAT_ID`) accesses all active stores with discounts configured (plus `.env` fallback).
 * - Store managers (`ChatUser.isActive === true`) access ONLY stores they are assigned to (`StoreMember`).
 */
export function registerSaleHandlers(
  bot: Bot,
  resolver: SaleStoreResolver = defaultSaleStoreResolver,
  draftStore: SaleDraftStore = prismaSaleDraftStore,
  options: RegisterSaleHandlersOptions = {}
): void {
  if (options.registerResetMiddleware !== false) {
    bot.use(async (ctx, next) => {
      await applySaleInputResetMiddleware(ctx, draftStore);
      return await next();
    });
  }

  // /discounts [store]
  bot.command('discounts', async (ctx) => {
    const chatId = ctx.chat.id;
    const fromId = ctx.from?.id ?? chatId;
    clearPendingSaleInput(chatId);
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const storeArg = ctx.match?.trim();

    try {
      if (storeArg) {
        const store = await resolver.resolveSaleStore(fromId, storeArg, lang);
        const [existingDraft, saleStores] = await Promise.all([
          draftStore.get(chatId, store.slug).catch(() => null),
          resolver.getAccessibleSaleStores(fromId).catch(() => []),
        ]);
        const view = renderSaleMainMenu(store, lang, Boolean(existingDraft), saleStores.length > 1);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.reply_markup });
        return;
      }

      const saleStores = await resolver.getAccessibleSaleStores(fromId);
      if (saleStores.length === 0) {
        const hasStores = await resolver.hasAnyAccessibleStore(fromId);
        if (!hasStores) {
          await ctx.reply(dict.noStore);
        } else {
          await ctx.reply(
            resolver.isAdmin(fromId) ? dict.saleNotConfigured : dict.saleNotConfiguredForUser,
            { parse_mode: 'HTML' }
          );
        }
        return;
      }

      if (saleStores.length === 1) {
        const target = saleStores[0];
        const existingDraft = await draftStore.get(chatId, target.slug).catch(() => null);
        const view = renderSaleMainMenu(target, lang, Boolean(existingDraft), false);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.reply_markup });
      } else {
        const view = renderSaleStorePicker(saleStores, lang);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.reply_markup });
      }
    } catch (err) {
      if (err instanceof SaleAccessError) {
        await ctx.reply(err.message, { parse_mode: 'HTML' });
        return;
      }
      console.error('[Bot] Error handling /discounts:', err);
      await ctx.reply(`${dict.errorPrefix} ${(err as Error).message}`);
    }
  });

  // Switch store inside Discounts flow: s:stores
  bot.callbackQuery('s:stores', async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const fromId = ctx.from?.id ?? chatId;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);

    const saleStores = await resolver.getAccessibleSaleStores(fromId);
    if (saleStores.length === 0) {
      const msg = (resolver.isAdmin(fromId) ? dict.saleNotConfigured : dict.saleNotConfiguredForUser)
        .replace(/<[^>]+>/g, '')
        .slice(0, 180);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    if (saleStores.length === 1) {
      const target = saleStores[0];
      const existingDraft = await draftStore.get(chatId, target.slug).catch(() => null);
      const view = renderSaleMainMenu(target, lang, Boolean(existingDraft), false);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    const view = renderSaleStorePicker(saleStores, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Main discounts menu for store: s:m:<slug>
  bot.callbackQuery(/^s:m:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const fromId = ctx.from?.id ?? chatId;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    await ctx.answerCallbackQuery();
    const [existingDraft, saleStores] = await Promise.all([
      draftStore.get(chatId, store.slug).catch(() => null),
      resolver.getAccessibleSaleStores(fromId).catch(() => []),
    ]);
    if (existingDraft?.awaitingText) {
      await draftStore.save(chatId, store.slug, { ...existingDraft, awaitingText: false }).catch(() => {});
    }
    const view = renderSaleMainMenu(store, lang, Boolean(existingDraft), saleStores.length > 1);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Current sale view: s:cur:<slug>
  bot.callbackQuery(/^s:cur:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      await showCurrentSale(ctx, store, lang);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnSaleRefresh, `s:cur:${s}`).text(dict.btnSaleMenu, `s:m:${s}`)
      );
    }
  });

  // Edit brand — paginated list of brands in current sale: s:eb:<slug>:<page>
  bot.callbackQuery(/^s:eb:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const page = parseInt(ctx.match[2], 10);
    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const sale = await store.client.getSale();
      if (Object.keys(sale.discounts).length === 0 || getSaleStatus(sale) === 'ended') {
        const view = renderCurrentSale(sale, {}, store, lang);
        await editOrReply(ctx, `${dict.saleNoActive}\n\n${view.text}`, view.reply_markup);
        return;
      }
      const known = saleBrandNames(sale);
      const missing = Object.keys(sale.discounts).filter((id) => !known[id]);
      const extra = await loadExtraBrandNames(store.client, missing);
      const view = renderEditBrandList(sale, extra, page, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`)
      );
    }
  });

  // Edit single brand card: s:ebs:<slug>:<brandId>
  bot.callbackQuery(/^s:ebs:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const brandId = ctx.match[2];
    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const sale = await store.client.getSale();
      const pct = sale.discounts[brandId];
      if (pct === undefined) {
        await editOrReply(
          ctx,
          dict.saleBrandNotInSale,
          new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`)
        );
        return;
      }
      const extra = sale.brands[brandId]?.name ? {} : await loadExtraBrandNames(store.client, [brandId]);
      const name = sale.brands[brandId]?.name ?? extra[brandId] ?? `#${brandId}`;
      const view = renderEditBrandCard(brandId, name, pct, Object.keys(sale.discounts).length, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
    }
  });

  // Preset percentage chosen for a brand: s:ebp:<slug>:<brandId>:<pct>
  // Fresh getSale() -> local edit -> single saveSale()
  bot.callbackQuery(/^s:ebp:([^:\s]+):(\d+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const brandId = ctx.match[2];
    const pct = parseInt(ctx.match[3], 10);
    const s = encodeURIComponent(store.slug);

    try {
      const fresh = await store.client.getSale();
      const cfg = withBrandPercent(fresh, brandId, pct);
      const saved = await store.client.saveSale(cfg);
      const name = saved.brands[brandId]?.name ?? fresh.brands[brandId]?.name ?? `#${brandId}`;
      await ctx.answerCallbackQuery({ text: dict.saleBrandUpdated(name, pct) });
      const view = renderCurrentSale(saved, {}, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
    }
  });

  // Custom percentage prompt for a brand: s:ebc:<slug>:<brandId>
  bot.callbackQuery(/^s:ebc:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const brandId = ctx.match[2];
    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    setPendingSaleInput(chatId, {
      kind: 'edit_brand_pct',
      storeSlug: store.slug,
      brandId,
      messageId: ctx.callbackQuery.message?.message_id,
    });

    await editOrReply(
      ctx,
      `${dict.saleEditBrandTitle}\n━━━━━━━━━━━━━━━━━━━━━\n🏪 <b>${escapeHtml(store.name)}</b>\n${dict.saleEnterPercent}`,
      new InlineKeyboard().text(dict.btnBack, `s:ebs:${s}:${brandId}`)
    );
  });

  // Remove brand from sale: s:ebr:<slug>:<brandId>
  // Fresh getSale() -> forbid if last brand -> single saveSale()
  bot.callbackQuery(/^s:ebr:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const brandId = ctx.match[2];
    const s = encodeURIComponent(store.slug);

    try {
      const fresh = await store.client.getSale();
      const name = fresh.brands[brandId]?.name ?? `#${brandId}`;
      const cfg = withoutBrand(fresh, brandId);
      const saved = await store.client.saveSale(cfg);
      await ctx.answerCallbackQuery({ text: dict.saleBrandRemoved(name) });
      const view = renderCurrentSale(saved, {}, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      if (err instanceof SaleEditError && err.code === 'LAST_BRAND') {
        await ctx.answerCallbackQuery({ text: dict.saleLastBrand.slice(0, 180), show_alert: true });
        const kb = new InlineKeyboard()
          .text(dict.btnSaleEndNow, `s:end:ask:${s}`)
          .row()
          .text(dict.btnBack, `s:cur:${s}`);
        await editOrReply(ctx, dict.saleLastBrand, kb);
        return;
      }
      await ctx.answerCallbackQuery();
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
    }
  });

  // Edit dates — step 1 (start date): s:ed:<slug>
  bot.callbackQuery(/^s:ed:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const sale = await store.client.getSale();
      if (!sale.start || !sale.end || Object.keys(sale.discounts).length === 0) {
        await editOrReply(ctx, dict.saleNoActive, new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
        return;
      }
      setPendingSaleInput(chatId, {
        kind: 'edit_dates_start',
        storeSlug: store.slug,
        messageId: ctx.callbackQuery.message?.message_id,
      });
      const kb = new InlineKeyboard()
        .text(dict.btnSaleNow, `s:eds:${s}:now`)
        .text(`${dict.btnSaleKeep} (${formatMadrid(sale.start)})`, `s:eds:${s}:keep`)
        .row()
        .text(dict.btnBack, `s:cur:${s}`);
      await editOrReply(
        ctx,
        `${dict.saleEditDatesTitle}\n━━━━━━━━━━━━━━━━━━━━━\n🏪 <b>${escapeHtml(store.name)}</b>\n${dict.saleEnterStart}`,
        kb
      );
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
    }
  });

  // Edit dates — start chosen via button (now | keep): s:eds:<slug>:(now|keep)
  bot.callbackQuery(/^s:eds:([^:\s]+):(now|keep)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const mode = ctx.match[2] as 'now' | 'keep';
    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const sale = await store.client.getSale();
      if (!sale.start || !sale.end) {
        await editOrReply(ctx, dict.saleNoActive, new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
        return;
      }
      const startUnix = mode === 'now' ? sale.now : sale.start;
      setPendingSaleInput(chatId, {
        kind: 'edit_dates_end',
        storeSlug: store.slug,
        startUnix,
        messageId: ctx.callbackQuery.message?.message_id,
      });
      const kb = new InlineKeyboard()
        .text(`${dict.btnSaleKeep} (${formatMadrid(sale.end)})`, `s:ede:${s}:keep:${startUnix}`)
        .row()
        .text(dict.btnBack, `s:cur:${s}`);
      await editOrReply(
        ctx,
        `${dict.saleEditDatesTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏪 <b>${escapeHtml(store.name)}</b>\n` +
          `📅 ${dict.saleStart}: <b>${formatMadrid(startUnix)}</b>\n\n` +
          dict.saleEnterEnd,
        kb
      );
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
    }
  });

  // Edit dates — keep existing end date: s:ede:<slug>:keep:<startUnix>
  bot.callbackQuery(/^s:ede:([^:\s]+):keep:(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const startUnix = parseInt(ctx.match[2], 10);
    const s = encodeURIComponent(store.slug);

    try {
      const fresh = await store.client.getSale();
      if (!fresh.end) throw new SaleEditError('NO_SALE');
      validateWindow(startUnix, fresh.end, fresh.now);
      const cfg = withDates(fresh, startUnix, fresh.end);
      const saved = await store.client.saveSale(cfg);
      await ctx.answerCallbackQuery({ text: dict.saleDatesUpdated });
      const view = renderCurrentSale(saved, {}, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`)
      );
    }
  });

  // End sale — confirmation prompt: s:end:ask:<slug>
  bot.callbackQuery(/^s:end:ask:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const sale = await store.client.getSale();
      const status = getSaleStatus(sale);
      if (status === 'none' || status === 'ended') {
        const view = renderCurrentSale(sale, {}, store, lang);
        await editOrReply(ctx, `${dict.saleNothingToEnd}\n\n${view.text}`, view.reply_markup);
        return;
      }
      const view = renderEndSaleConfirm(store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:m:${s}`));
    }
  });

  // End sale — execute DELETE /brand-sale: s:end:do:<slug>
  bot.callbackQuery(/^s:end:do:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const s = encodeURIComponent(store.slug);

    try {
      const ended = await store.client.endSale();
      await ctx.answerCallbackQuery({ text: dict.saleEnded });
      const view = renderCurrentSale(ended, {}, store, lang);
      await editOrReply(ctx, `${dict.saleEnded}\n\n${view.text}`, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnBack, `s:cur:${s}`));
    }
  });

  // ==========================================
  // "NEW SALE" WIZARD CALLBACKS (WITH PRISMA DRAFT)
  // ==========================================

  // Start new sale wizard: s:new:<slug>
  bot.callbackQuery(/^s:new:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const draft = await draftStore.save(
        chatId,
        store.slug,
        createInitialDraft(ctx.callbackQuery.message?.message_id)
      );
      const view = renderWizardPickPercent(draft, {}, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(t(lang).btnSaleMenu, `s:m:${s}`));
    }
  });

  // Resume existing draft (<24h): s:nrs:<slug>
  // Also prunes any brands that were deleted on the site and shows which brands were dropped.
  bot.callbackQuery(/^s:nrs:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const fromId = ctx.from?.id ?? chatId;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const s = encodeURIComponent(store.slug);
    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
    if (!existing) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      const saleStores = await resolver.getAccessibleSaleStores(fromId).catch(() => []);
      const view = renderSaleMainMenu(store, lang, false, saleStores.length > 1);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const liveBrands = await store.client.getBrands({ force: true });
      const pruned = pruneMissingBrandsFromDraft(existing, liveBrands);
      const shouldAwaitText =
        pruned.draft.step === 'await_custom_pct' ||
        pruned.draft.step === 'await_start_date' ||
        pruned.draft.step === 'await_end_date';

      const updated = await draftStore.save(chatId, store.slug, {
        ...pruned.draft,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
        awaitingText: shouldAwaitText,
      });

      const banner =
        pruned.removed.length > 0
          ? dict.saleDraftDroppedBrands(pruned.removed.map((r) => escapeHtml(r.name)).join(', '))
          : undefined;
      await renderDraftStep(ctx, updated, store, lang, undefined, banner);
    } catch (err) {
      await editOrReply(ctx, formatWpError(err, lang), new InlineKeyboard().text(dict.btnSaleMenu, `s:m:${s}`));
    }
  });

  // Return to Step 1 (pick discount %): s:npk:<slug>
  bot.callbackQuery(/^s:npk:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    await ctx.answerCallbackQuery();

    const existing = (await draftStore.get(chatId, store.slug).catch(() => null)) ?? createInitialDraft();
    const updated = await draftStore.save(chatId, store.slug, {
      ...existing,
      step: 'pick_pct',
      currentPct: undefined,
      currentBrandIds: [],
      page: 1,
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: false,
    });
    const names = updated.groups.length > 0 ? await loadAllBrandNames(store.client) : updated.brandNames;
    const view = renderWizardPickPercent(updated, names, store, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 1 preset percentage chosen: s:npct:<slug>:<pct>
  bot.callbackQuery(/^s:npct:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const pct = parseInt(ctx.match[2], 10);
    const s = encodeURIComponent(store.slug);
    await ctx.answerCallbackQuery();

    try {
      const existing = (await draftStore.get(chatId, store.slug)) ?? createInitialDraft();
      const brands = await store.client.getBrands();
      const pruned = pruneMissingBrandsFromDraft(existing, brands);
      const next = await draftStore.save(chatId, store.slug, {
        ...startGroupSelection(pruned.draft, pct),
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      });
      const view = renderWizardPickBrands(next, brands, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:npk:${s}`).text(dict.btnSaleCancel, `s:nx:${s}`)
      );
    }
  });

  // Step 1 custom percentage button: s:npc:<slug>
  bot.callbackQuery(/^s:npc:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    await ctx.answerCallbackQuery();

    const existing = (await draftStore.get(chatId, store.slug).catch(() => null)) ?? createInitialDraft();
    await draftStore.save(chatId, store.slug, {
      ...existing,
      step: 'await_custom_pct',
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: true,
    });
    const view = renderWizardCustomPercentPrompt(store, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 2 toggle brand selection: s:t:<slug>:<brandId>
  bot.callbackQuery(/^s:t:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const brandId = ctx.match[2];
    const s = encodeURIComponent(store.slug);

    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
    if (!existing || existing.step !== 'pick_brands' || !existing.currentPct) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    try {
      const brands = await store.client.getBrands();
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

      const saved = await draftStore.save(chatId, store.slug, {
        ...toggled.draft,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      });
      await ctx.answerCallbackQuery();
      const view = renderWizardPickBrands(saved, brands, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await ctx.answerCallbackQuery();
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:npk:${s}`).text(dict.btnSaleCancel, `s:nx:${s}`)
      );
    }
  });

  // Step 2 brand pagination: s:np:<slug>:<page>
  bot.callbackQuery(/^s:np:([^:\s]+):(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const page = parseInt(ctx.match[2], 10);
    const s = encodeURIComponent(store.slug);

    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
    if (!existing || existing.step !== 'pick_brands' || !existing.currentPct) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      const brands = await store.client.getBrands();
      const saved = await draftStore.save(chatId, store.slug, {
        ...existing,
        page,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      });
      const view = renderWizardPickBrands(saved, brands, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
    } catch (err) {
      await editOrReply(
        ctx,
        formatWpError(err, lang),
        new InlineKeyboard().text(dict.btnBack, `s:npk:${s}`).text(dict.btnSaleCancel, `s:nx:${s}`)
      );
    }
  });

  // Step 2 "Done" with current brand group: s:nd:<slug>
  bot.callbackQuery(/^s:nd:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
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
    const saved = await draftStore.save(chatId, store.slug, {
      ...committed,
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
    });
    const names = { ...saved.brandNames, ...(await loadAllBrandNames(store.client)) };
    const view = renderWizardAskMoreGroups(saved, names, store, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 3 "Add another group?": s:na:<slug>:(y|n)
  bot.callbackQuery(/^s:na:([^:\s]+):(y|n)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const choice = ctx.match[2] as 'y' | 'n';
    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
    if (!existing || existing.groups.length === 0) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const names = { ...existing.brandNames, ...(await loadAllBrandNames(store.client)) };

    if (choice === 'y') {
      const saved = await draftStore.save(chatId, store.slug, {
        ...existing,
        step: 'pick_pct',
        currentPct: undefined,
        currentBrandIds: [],
        page: 1,
        messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
        awaitingText: false,
      });
      const view = renderWizardPickPercent(saved, names, store, lang);
      await editOrReply(ctx, view.text, view.reply_markup);
      return;
    }

    const saved = await draftStore.save(chatId, store.slug, {
      ...existing,
      step: 'await_start_date',
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: true,
    });
    const view = renderWizardStartPrompt(saved, names, store, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Back to Step 3 (ask_more_groups) from start date prompt: s:nb:grp:<slug>
  bot.callbackQuery(/^s:nb:grp:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
    if (!existing || existing.groups.length === 0) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const saved = await draftStore.save(chatId, store.slug, {
      ...existing,
      step: 'ask_more_groups',
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
      awaitingText: false,
    });
    const names = { ...saved.brandNames, ...(await loadAllBrandNames(store.client)) };
    const view = renderWizardAskMoreGroups(saved, names, store, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 4a "Now" button for start date: s:ns:now:<slug>
  // Stores ONLY `startNow = true` (`startUnix = undefined`); concrete unix time is computed at Confirm time.
  bot.callbackQuery(/^s:ns:now:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    const existing = await draftStore.get(chatId, store.slug).catch(() => null);
    if (!existing || existing.groups.length === 0) {
      await ctx.answerCallbackQuery({ text: dict.saleDraftExpired, show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const saved = await draftStore.save(chatId, store.slug, {
      ...selectStartNowOnDraft(existing),
      messageId: ctx.callbackQuery.message?.message_id ?? existing.messageId,
    });
    const view = renderWizardEndPrompt(saved, store, lang);
    await editOrReply(ctx, view.text, view.reply_markup);
  });

  // Step 5/6 Confirm new sale: s:ncf:<slug>
  bot.callbackQuery(/^s:ncf:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    await executeWizardConfirm(ctx, 'initial', store, lang, draftStore);
  });

  // Step 6b Confirmed replacement of a running sale: s:nrp:<slug> -> single saveSale()
  bot.callbackQuery(/^s:nrp:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    await executeWizardConfirm(ctx, 'replace', store, lang, draftStore);
  });

  // Cancel wizard & delete draft: s:nx:<slug>
  bot.callbackQuery(/^s:nx:([^:\s]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const fromId = ctx.from?.id ?? chatId;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    const dict = t(lang);
    const store = await resolveCallbackStore(ctx, ctx.match[1], lang, resolver);
    if (!store) return;

    await draftStore.clear(chatId, store.slug).catch(() => {});
    clearPendingSaleInput(chatId);
    await ctx.answerCallbackQuery({ text: dict.saleNewCancelled });
    const saleStores = await resolver.getAccessibleSaleStores(fromId).catch(() => []);
    const view = renderSaleMainMenu(store, lang, false, saleStores.length > 1);
    await editOrReply(ctx, `${dict.saleNewCancelled}\n\n${view.text}`, view.reply_markup);
  });

  // Fallback for legacy pre-multistore `s:*` buttons still sitting in chat history
  bot.callbackQuery(/^s:/, async (ctx) => {
    const chatId = ctx.chat?.id || 0;
    const lang = await getUserLanguage(chatId, ctx.from?.language_code);
    await ctx.answerCallbackQuery({ text: t(lang).saleInputExpired, show_alert: true });
  });
}
