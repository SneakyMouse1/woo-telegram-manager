import { env } from '../config/env.js';
import {
  createWpBrandSaleClient,
  WpBrandSaleError,
  type WpBrandSaleClient,
  type WpBrand,
  type BrandSale,
  type BrandSaleConfig,
} from './wpBrandSaleClient.js';

export * from './wpBrandSaleClient.js';

/**
 * Env-bound brand-sale client (WP_URL / WP_USER / WP_APP_PASSWORD).
 * Lazily created so the bot still starts when the variables are not configured.
 */
let client: WpBrandSaleClient | null = null;

export function isWpBrandSaleConfigured(): boolean {
  return Boolean(env.WP_URL && env.WP_USER && env.WP_APP_PASSWORD);
}

function getClient(): WpBrandSaleClient {
  if (!client) {
    if (!env.WP_URL || !env.WP_USER || !env.WP_APP_PASSWORD) {
      throw new WpBrandSaleError('config', 'WP_URL, WP_USER and WP_APP_PASSWORD must be set');
    }
    client = createWpBrandSaleClient({
      baseUrl: env.WP_URL,
      user: env.WP_USER,
      appPassword: env.WP_APP_PASSWORD,
    });
  }
  return client;
}

/** Brand list (cached in memory for 5 minutes). */
export function getBrands(opts?: { force?: boolean }): Promise<WpBrand[]> {
  return getClient().getBrands(opts);
}

/** Always fetches fresh state from WordPress (never cached). */
export function getSale(): Promise<BrandSale> {
  return getClient().getSale();
}

/** Replaces the whole sale config (PUT). */
export function saveSale(config: BrandSaleConfig): Promise<BrandSale> {
  return getClient().saveSale(config);
}

/** Ends the sale immediately (DELETE). */
export function endSale(): Promise<BrandSale> {
  return getClient().endSale();
}

export const wpBrandSale = { getBrands, getSale, saveSale, endSale, isConfigured: isWpBrandSaleConfigured };
