import type { BrandSale, BrandDiscounts, BrandSaleConfig } from '../../services/wpBrandSaleClient.js';
import { parseMadridDate, parseMadridDateTime } from './madridTime.js';

/** Pure helpers for the Discounts menu (no I/O, unit-tested). */

export const MIN_PCT = 1;
export const MAX_PCT = 90;

/**
 * Parses user input for a date edge. Accepts either:
 * 1) Exact date and time: `DD.MM.YYYY HH:MM[:SS]` or `YYYY-MM-DD HH:MM[:SS]`
 * 2) Date only: `DD.MM.YYYY` (resolves to 00:00:00 for 'start', 23:59:59 for 'end')
 */
export function parseSaleDateInput(input: string, edge: 'start' | 'end'): number | null {
  const trimmed = input.trim();
  // Check if time is included (contains a space or 'T' with colon)
  if (/[\sT]\d{1,2}:\d{2}/.test(trimmed)) {
    return parseMadridDateTime(trimmed);
  }
  return parseMadridDate(trimmed, edge);
}

/** Checks whether a Telegram user ID matches the configured `ADMIN_CHAT_ID`. */
export function checkSaleAdmin(
  fromId: number | bigint | string | undefined | null,
  adminChatId: string
): boolean {
  if (fromId === undefined || fromId === null || !adminChatId) return false;
  return String(fromId) === String(adminChatId);
}

export type SaleStatus = 'none' | 'scheduled' | 'running' | 'ended';

export function getSaleStatus(sale: Pick<BrandSale, 'start' | 'end' | 'now' | 'discounts'>): SaleStatus {
  if (!sale.start || !sale.end || Object.keys(sale.discounts).length === 0) return 'none';
  if (sale.now < sale.start) return 'scheduled';
  if (sale.now >= sale.end) return 'ended';
  return 'running';
}

/** Parses a user-typed percentage: integer 1..90 (accepts trailing %). */
export function parsePercent(input: string): number | null {
  const m = input.trim().replace(/\s+/g, '').match(/^(\d{1,3})%?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= MIN_PCT && n <= MAX_PCT ? n : null;
}

export function isValidPercent(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_PCT && n <= MAX_PCT;
}

export interface PercentGroup {
  pct: number;
  brands: Array<{ id: string; name: string }>;
}

/** Groups brands by percentage (highest first), brands sorted by name. */
export function groupByPercent(discounts: BrandDiscounts, names: Record<string, string>): PercentGroup[] {
  const map = new Map<number, Array<{ id: string; name: string }>>();
  for (const [id, pct] of Object.entries(discounts)) {
    const list = map.get(pct) ?? [];
    list.push({ id, name: names[id] ?? `#${id}` });
    map.set(pct, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([pct, brands]) => ({ pct, brands: brands.sort((x, y) => x.name.localeCompare(y.name)) }));
}

/** Brand id -> display name from a sale response. */
export function saleBrandNames(sale: BrandSale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, b] of Object.entries(sale.brands)) out[id] = b.name;
  return out;
}

export class SaleEditError extends Error {
  code: 'LAST_BRAND' | 'NOT_IN_SALE' | 'BAD_PERCENT' | 'END_BEFORE_START' | 'END_IN_PAST' | 'NO_SALE';
  constructor(code: SaleEditError['code']) {
    super(code);
    this.code = code;
  }
}

function baseConfig(sale: BrandSale): BrandSaleConfig {
  if (!sale.start || !sale.end || Object.keys(sale.discounts).length === 0) throw new SaleEditError('NO_SALE');
  return { start: sale.start, end: sale.end, discounts: { ...sale.discounts } };
}

/** New full config with one brand's percentage changed. */
export function withBrandPercent(sale: BrandSale, brandId: string, pct: number): BrandSaleConfig {
  if (!isValidPercent(pct)) throw new SaleEditError('BAD_PERCENT');
  const cfg = baseConfig(sale);
  if (!(brandId in cfg.discounts)) throw new SaleEditError('NOT_IN_SALE');
  cfg.discounts[brandId] = pct;
  return cfg;
}

/** New full config without one brand. Removing the last brand is forbidden. */
export function withoutBrand(sale: BrandSale, brandId: string): BrandSaleConfig {
  const cfg = baseConfig(sale);
  if (!(brandId in cfg.discounts)) throw new SaleEditError('NOT_IN_SALE');
  if (Object.keys(cfg.discounts).length <= 1) throw new SaleEditError('LAST_BRAND');
  delete cfg.discounts[brandId];
  return cfg;
}

/** Validates a date window against server "now". */
export function validateWindow(start: number, end: number, now: number): void {
  if (end <= start) throw new SaleEditError('END_BEFORE_START');
  if (end <= now) throw new SaleEditError('END_IN_PAST');
}

/** New full config with new dates (same brands). */
export function withDates(sale: BrandSale, start: number, end: number): BrandSaleConfig {
  const cfg = baseConfig(sale);
  validateWindow(start, end, sale.now);
  return { ...cfg, start, end };
}

