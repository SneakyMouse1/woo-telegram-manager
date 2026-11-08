import { InlineKeyboard } from 'grammy';
import type { BrandSale, WpBrand } from '../../services/wpBrandSaleClient.js';
import { WpBrandSaleError } from '../../services/wpBrandSaleClient.js';
import { escapeHtml } from '../formatters/orderFormatter.js';
import { t, type SupportedLanguage } from '../i18n/index.js';
import { formatMadrid } from './madridTime.js';
import {
  buildDiscountsFromGroups,
  getLockedBrandsMap,
  WIZARD_BRANDS_PER_PAGE,
  type SaleDraftData,
} from './saleDraft.js';
import { getSaleStatus, groupByPercent, saleBrandNames, SaleEditError } from './saleLogic.js';

export const PRESET_PERCENTS = [25, 30, 35, 40, 45, 50] as const;
const BRANDS_PER_EDIT_PAGE = 20;
const MAX_LINES_SHOWN = 60;

export function formatWpError(err: unknown, lang: SupportedLanguage): string {
  const dict = t(lang);
  if (err instanceof SaleEditError) {
    switch (err.code) {
      case 'LAST_BRAND':
        return dict.saleLastBrand;
      case 'NOT_IN_SALE':
        return dict.saleBrandNotInSale;
      case 'BAD_PERCENT':
        return dict.saleInvalidPercent;
      case 'END_BEFORE_START':
        return dict.saleEndBeforeStart;
      case 'END_IN_PAST':
        return dict.saleEndInPast;
      case 'NO_SALE':
        return dict.saleNoActive;
    }
  }
  if (err instanceof WpBrandSaleError) {
    switch (err.kind) {
      case 'config':
        return dict.saleNotConfigured;
      case 'auth':
        return dict.saleErrAuth;
      case 'forbidden':
        return dict.saleErrForbidden;
      case 'validation':
        return dict.saleErrValidation(escapeHtml(err.message));
      case 'not_found':
        return dict.saleErrNotFound;
      case 'server':
        return dict.saleErrServer;
      case 'timeout':
        return dict.saleErrTimeout;
      case 'network':
        return dict.saleErrNetwork;
      case 'bad_response':
        return dict.saleErrBadResponse;
    }
  }
  return dict.saleErrUnknown;
}

export function renderSaleMainMenu(
  lang: SupportedLanguage,
  hasActiveDraft = false
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const kb = new InlineKeyboard()
    .text(dict.btnSaleCurrent, 's:cur')
    .row()
    .text(dict.btnSaleNew, 's:new');
  if (hasActiveDraft) {
    kb.row().text(dict.btnSaleResumeDraft, 's:nrs');
  }
  kb.row().text(dict.btnSaleEndNow, 's:end:ask');
  return { text: dict.saleMenuTitle, reply_markup: kb };
}

export function renderCurrentSale(
  sale: BrandSale,
  extraNames: Record<string, string>,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const status = getSaleStatus(sale);
  const statusBadge =
    status === 'running'
      ? dict.saleStatusRunning
      : status === 'scheduled'
        ? dict.saleStatusScheduled
        : status === 'ended'
          ? dict.saleStatusEnded
          : dict.saleStatusNone;

  const names = { ...extraNames, ...saleBrandNames(sale) };
  const groups = groupByPercent(sale.discounts, names);
  const totalBrands = Object.keys(sale.discounts).length;

  let text = `${dict.saleCurrentTitle}\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `${statusBadge}\n`;

  if (sale.start && sale.end) {
    text += `📅 ${dict.saleStart}: <b>${formatMadrid(sale.start)}</b>\n`;
    text += `📅 ${dict.saleEnd}: <b>${formatMadrid(sale.end)}</b>\n`;
    text += `${dict.saleTimezoneNote}\n`;
  }

  text += `\n${dict.saleBrandsCount(totalBrands)}\n`;

  if (groups.length === 0) {
    text += `${dict.saleNoBrands}\n`;
  } else {
    let shown = 0;
    for (const g of groups) {
      if (shown >= MAX_LINES_SHOWN) break;
      text += `\n<b>−${g.pct}%</b> (${g.brands.length}):\n`;
      for (const b of g.brands) {
        if (shown >= MAX_LINES_SHOWN) break;
        text += `  • ${escapeHtml(b.name)}: <b>−${g.pct}%</b>\n`;
        shown++;
      }
    }
    if (totalBrands > shown) {
      text += `\n${dict.saleListTruncated(totalBrands - shown)}\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (totalBrands > 0 && sale.start && sale.end && status !== 'ended') {
    kb.text(dict.btnSaleEditBrand, 's:eb:1').text(dict.btnSaleEditDates, 's:ed').row();
    kb.text(dict.btnSaleEndNow, 's:end:ask').row();
  } else {
    kb.text(dict.btnSaleNew, 's:new').row();
  }
  kb.text(dict.btnSaleRefresh, 's:cur').text(dict.btnSaleMenu, 's:m');

  return { text, reply_markup: kb };
}

export function renderEditBrandList(
  sale: BrandSale,
  extraNames: Record<string, string>,
  page: number,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const names = { ...extraNames, ...saleBrandNames(sale) };
  const items = Object.entries(sale.discounts)
    .map(([id, pct]) => ({ id, name: names[id] ?? `#${id}`, pct }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalPages = Math.max(1, Math.ceil(items.length / BRANDS_PER_EDIT_PAGE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const slice = items.slice((safePage - 1) * BRANDS_PER_EDIT_PAGE, safePage * BRANDS_PER_EDIT_PAGE);

  const text = `${dict.saleEditBrandTitle}\n━━━━━━━━━━━━━━━━━━━━━\n${dict.saleEditBrandPick}`;
  const kb = new InlineKeyboard();

  for (let i = 0; i < slice.length; i += 2) {
    const a = slice[i];
    const b = slice[i + 1];
    kb.text(`${truncate(a.name, 18)} (−${a.pct}%)`, `s:ebs:${a.id}`);
    if (b) {
      kb.text(`${truncate(b.name, 18)} (−${b.pct}%)`, `s:ebs:${b.id}`);
    }
    kb.row();
  }

  if (totalPages > 1) {
    if (safePage > 1) kb.text('‹', `s:eb:${safePage - 1}`);
    kb.text(`${safePage}/${totalPages}`, 'noop');
    if (safePage < totalPages) kb.text('›', `s:eb:${safePage + 1}`);
    kb.row();
  }

  kb.text(dict.btnBack, 's:cur');
  return { text, reply_markup: kb };
}

export function renderEditBrandCard(
  brandId: string,
  brandName: string,
  currentPct: number,
  totalBrandsInSale: number,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const text =
    `${dict.saleEditBrandTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
    dict.saleBrandCurrentPct(escapeHtml(brandName), currentPct);

  const kb = new InlineKeyboard();
  for (let i = 0; i < PRESET_PERCENTS.length; i += 3) {
    for (const p of PRESET_PERCENTS.slice(i, i + 3)) {
      const label = p === currentPct ? `• −${p}% •` : `−${p}%`;
      kb.text(label, `s:ebp:${brandId}:${p}`);
    }
    kb.row();
  }
  kb.text(dict.btnSaleCustomPct, `s:ebc:${brandId}`).row();
  if (totalBrandsInSale > 1) {
    kb.text(dict.btnSaleRemoveBrand, `s:ebr:${brandId}`).row();
  } else {
    kb.text(dict.btnSaleEndNow, 's:end:ask').row();
  }
  kb.text(dict.btnBack, 's:eb:1');

  return { text, reply_markup: kb };
}

export function renderEndSaleConfirm(lang: SupportedLanguage): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const kb = new InlineKeyboard()
    .text(dict.btnSaleConfirm, 's:end:do')
    .text(dict.btnSaleCancel, 's:cur');
  return { text: dict.saleEndConfirm, reply_markup: kb };
}

// ==========================================
// "NEW SALE" WIZARD SCREENS
// ==========================================

function renderGroupsBlock(
  draft: SaleDraftData,
  brandNames: Record<string, string>,
  lang: SupportedLanguage
): string {
  const dict = t(lang);
  if (draft.groups.length === 0) return '';
  let out = `\n${dict.saleNewGroupsSummary}\n`;
  let shown = 0;
  for (const g of draft.groups) {
    if (shown >= MAX_LINES_SHOWN) break;
    const names = g.brandIds
      .map((id) => brandNames[id] ?? `#${id}`)
      .sort((a, b) => a.localeCompare(b));
    out += `• <b>−${g.pct}%</b> (${names.length}): ${escapeHtml(names.slice(0, 8).join(', '))}${
      names.length > 8 ? '…' : ''
    }\n`;
    shown += names.length;
  }
  return out;
}

export function renderWizardPickPercent(
  draft: SaleDraftData,
  brandNames: Record<string, string>,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  let text = `${dict.saleNewTitle}\n━━━━━━━━━━━━━━━━━━━━━\n${dict.saleNewPickPct}\n`;
  text += renderGroupsBlock(draft, brandNames, lang);

  const kb = new InlineKeyboard();
  for (let i = 0; i < PRESET_PERCENTS.length; i += 3) {
    for (const p of PRESET_PERCENTS.slice(i, i + 3)) {
      kb.text(`${p}%`, `s:npct:${p}`);
    }
    kb.row();
  }
  kb.text(dict.btnSaleCustomPct, 's:npc').row();
  if (draft.groups.length > 0) {
    kb.text(dict.btnSaleAddGroupNo, 's:na:n').row();
  }
  kb.text(dict.btnSaleCancel, 's:nx');
  return { text, reply_markup: kb };
}

export function renderWizardCustomPercentPrompt(
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const text = `${dict.saleNewTitle}\n━━━━━━━━━━━━━━━━━━━━━\n${dict.saleEnterPercent}`;
  const kb = new InlineKeyboard()
    .text(dict.btnBack, 's:npk')
    .text(dict.btnSaleCancel, 's:nx');
  return { text, reply_markup: kb };
}

export function renderWizardPickBrands(
  draft: SaleDraftData,
  brands: WpBrand[],
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const pct = draft.currentPct ?? 25;
  const selectedSet = new Set(draft.currentBrandIds.map(String));
  const locked = getLockedBrandsMap(draft.groups, pct);

  const totalPages = Math.max(1, Math.ceil(brands.length / WIZARD_BRANDS_PER_PAGE));
  const safePage = Math.max(1, Math.min(draft.page || 1, totalPages));
  const slice = brands.slice(
    (safePage - 1) * WIZARD_BRANDS_PER_PAGE,
    safePage * WIZARD_BRANDS_PER_PAGE
  );

  const text =
    `${dict.saleNewTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
    dict.saleNewPickBrands(pct, selectedSet.size);

  const kb = new InlineKeyboard();
  for (let i = 0; i < slice.length; i += 2) {
    const a = slice[i];
    const b = slice[i + 1];
    kb.text(formatBrandBtnLabel(a, selectedSet, locked), `s:t:${a.id}`);
    if (b) {
      kb.text(formatBrandBtnLabel(b, selectedSet, locked), `s:t:${b.id}`);
    }
    kb.row();
  }

  // Pagination row: ‹  page/total  ›
  if (totalPages > 1) {
    if (safePage > 1) kb.text('‹', `s:np:${safePage - 1}`);
    kb.text(`${safePage}/${totalPages}`, 'noop');
    if (safePage < totalPages) kb.text('›', `s:np:${safePage + 1}`);
    kb.row();
  }

  kb.text(dict.btnSaleDone, 's:nd').row();
  kb.text(dict.btnBack, 's:npk').text(dict.btnSaleCancel, 's:nx');

  return { text, reply_markup: kb };
}

function formatBrandBtnLabel(
  brand: WpBrand,
  selected: Set<string>,
  locked: Record<string, number>
): string {
  const id = String(brand.id);
  if (locked[id] !== undefined) {
    return `🔒 ${truncate(brand.name, 14)} (${locked[id]}%)`;
  }
  if (selected.has(id)) {
    return `✅ ${truncate(brand.name, 20)}`;
  }
  return truncate(brand.name, 22);
}

export function renderWizardAskMoreGroups(
  draft: SaleDraftData,
  brandNames: Record<string, string>,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  let text = `${dict.saleNewTitle}\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += renderGroupsBlock(draft, brandNames, lang);
  text += `\n${dict.saleNewAskMoreGroups}`;

  const kb = new InlineKeyboard()
    .text(dict.btnSaleAddGroupYes, 's:na:y')
    .row()
    .text(dict.btnSaleAddGroupNo, 's:na:n')
    .row()
    .text(dict.btnSaleCancel, 's:nx');

  return { text, reply_markup: kb };
}

export function renderWizardStartPrompt(
  draft: SaleDraftData,
  brandNames: Record<string, string>,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  let text = `${dict.saleNewTitle}\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += renderGroupsBlock(draft, brandNames, lang);
  text += `\n${dict.saleNewStartPrompt}`;

  const kb = new InlineKeyboard()
    .text(dict.btnSaleNow, 's:ns:now')
    .row()
    .text(dict.btnBack, 's:nb:grp')
    .text(dict.btnSaleCancel, 's:nx');

  return { text, reply_markup: kb };
}

export function renderWizardEndPrompt(
  draft: SaleDraftData,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const startLabel = draft.startNow
    ? dict.btnSaleNow
    : draft.startUnix
      ? formatMadrid(draft.startUnix)
      : '—';

  const text =
    `${dict.saleNewTitle}\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 ${dict.saleStart}: <b>${escapeHtml(startLabel)}</b>\n\n` +
    dict.saleNewEndPrompt;

  const kb = new InlineKeyboard()
    .text(dict.btnBack, 's:na:n')
    .text(dict.btnSaleCancel, 's:nx');

  return { text, reply_markup: kb };
}

export function renderWizardConfirm(
  draft: SaleDraftData,
  brandNames: Record<string, string>,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const discounts = buildDiscountsFromGroups(draft.groups);
  const grouped = groupByPercent(discounts, brandNames);
  const totalBrands = Object.keys(discounts).length;

  const startStr = draft.startNow
    ? dict.btnSaleNow
    : draft.startUnix
      ? formatMadrid(draft.startUnix)
      : '—';
  const endStr = draft.endUnix ? formatMadrid(draft.endUnix) : '—';

  let text = `${dict.saleNewConfirmTitle}\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📅 ${dict.saleStart}: <b>${escapeHtml(startStr)}</b>\n`;
  text += `📅 ${dict.saleEnd}: <b>${escapeHtml(endStr)}</b>\n`;
  text += `${dict.saleTimezoneNote}\n\n`;
  text += `${dict.saleBrandsCount(totalBrands)}\n`;

  let shown = 0;
  for (const g of grouped) {
    if (shown >= MAX_LINES_SHOWN) break;
    text += `\n<b>−${g.pct}%</b> (${g.brands.length}):\n`;
    for (const b of g.brands) {
      if (shown >= MAX_LINES_SHOWN) break;
      text += `  • ${escapeHtml(b.name)} → <b>−${g.pct}%</b>\n`;
      shown++;
    }
  }
  if (totalBrands > shown) {
    text += `\n${dict.saleListTruncated(totalBrands - shown)}\n`;
  }

  const kb = new InlineKeyboard()
    .text(dict.btnSaleConfirm, 's:ncf')
    .text(dict.btnSaleCancel, 's:nx');

  return { text, reply_markup: kb };
}

export function renderWizardReplaceWarning(
  draft: SaleDraftData,
  brandNames: Record<string, string>,
  lang: SupportedLanguage
): { text: string; reply_markup: InlineKeyboard } {
  const dict = t(lang);
  const discounts = buildDiscountsFromGroups(draft.groups);
  const totalBrands = Object.keys(discounts).length;
  const startStr = draft.startNow
    ? dict.btnSaleNow
    : draft.startUnix
      ? formatMadrid(draft.startUnix)
      : '—';
  const endStr = draft.endUnix ? formatMadrid(draft.endUnix) : '—';

  let text = `${dict.saleNewReplaceWarningTitle}\n━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `${dict.saleNewReplaceWarningBody}\n\n`;
  text += `📅 ${dict.saleStart}: <b>${escapeHtml(startStr)}</b>\n`;
  text += `📅 ${dict.saleEnd}: <b>${escapeHtml(endStr)}</b>\n`;
  text += `${dict.saleBrandsCount(totalBrands)}`;
  text += renderGroupsBlock(draft, brandNames, lang);

  const kb = new InlineKeyboard()
    .text(dict.btnSaleConfirmReplace, 's:nrp')
    .row()
    .text(dict.btnSaleCancel, 's:nx');

  return { text, reply_markup: kb };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
