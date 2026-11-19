import { createHash } from 'node:crypto';
import type { Store } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { decrypt } from '../utils/crypto.js';
import { canAccessStore } from '../utils/accessControl.js';
import { getAccessibleStoresForChat } from './storeResolver.js';
import { escapeHtml } from '../bot/formatters/orderFormatter.js';
import { t, type SupportedLanguage } from '../bot/i18n/index.js';
import {
  createWpBrandSaleClient,
  WpBrandSaleError,
  type WpBrandSaleClient,
  type WpBrandSaleClientConfig,
  type WpBrand,
  type BrandSale,
  type BrandSaleConfig,
} from './wpBrandSaleClient.js';

export * from './wpBrandSaleClient.js';

/** Reserved internal identifier for admin-only `.env` fallback when WP_URL does not match any DB store. */
export const ENV_STORE_ID = '__env__';
export const ENV_STORE_SLUG = '__env__';

export interface EnvWpConfig {
  wpUrl?: string;
  wpUser?: string;
  wpAppPassword?: string;
}

export type StoreWpFields = Pick<Store, 'url' | 'wpUserEncrypted' | 'wpAppPasswordEncrypted'>;

export interface ResolvedStoreWpCredentials {
  baseUrl: string;
  user: string;
  appPassword: string;
  source: 'store' | 'env';
}

export interface SaleStoreInfo {
  id: string;
  slug: string;
  name: string;
  url: string;
  source: 'store' | 'env';
}

export interface ResolvedSaleStore extends SaleStoreInfo {
  client: WpBrandSaleClient;
}

export type SaleAccessErrorCode = 'STORE_NOT_FOUND' | 'ACCESS_DENIED' | 'NOT_CONFIGURED';

export class SaleAccessError extends Error {
  code: SaleAccessErrorCode;
  storeName?: string;
  constructor(code: SaleAccessErrorCode, message: string, storeName?: string) {
    super(message);
    this.name = 'SaleAccessError';
    this.code = code;
    this.storeName = storeName;
  }
}

export interface SaleStoreResolver {
  getAccessibleSaleStores(chatId: bigint | number | string): Promise<SaleStoreInfo[]>;
  hasAnyAccessibleStore(chatId: bigint | number | string): Promise<boolean>;
  resolveSaleStore(
    chatId: bigint | number | string,
    storeIdentifier: string,
    lang?: SupportedLanguage
  ): Promise<ResolvedSaleStore>;
  isAdmin(chatId: bigint | number | string | undefined | null): boolean;
}

function getDefaultEnvWpConfig(): EnvWpConfig {
  return {
    wpUrl: env.WP_URL,
    wpUser: env.WP_USER,
    wpAppPassword: env.WP_APP_PASSWORD,
  };
}

/**
 * Normalizes a WordPress site URL for safe equality matching between `Store.url` and `WP_URL`.
 * Normalizes protocol/hostname case, strips leading `www.` and trailing slashes.
 * Keeps distinct subdomains (e.g. `staging.example.com` vs `example.com`) separate.
 */
export function normalizeSiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${host}${port}${pathname}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function isEnvWpBrandSaleConfigured(envCfg: EnvWpConfig = getDefaultEnvWpConfig()): boolean {
  return Boolean(envCfg.wpUrl && envCfg.wpUser && envCfg.wpAppPassword);
}

/** Backward-compatible alias for env-level configuration check. */
export function isWpBrandSaleConfigured(): boolean {
  return isEnvWpBrandSaleConfigured();
}

/**
 * Checks whether a Store has WordPress brand-sale credentials available
 * (either stored encrypted on the Store record, or matching the `.env` fallback `WP_URL`).
 */
export function hasStoreWpBrandSaleConfig(
  store: StoreWpFields,
  envCfg: EnvWpConfig = getDefaultEnvWpConfig()
): boolean {
  if (store.wpUserEncrypted && store.wpAppPasswordEncrypted) {
    return true;
  }
  if (isEnvWpBrandSaleConfigured(envCfg) && envCfg.wpUrl) {
    return normalizeSiteUrl(store.url) === normalizeSiteUrl(envCfg.wpUrl);
  }
  return false;
}

/**
 * Resolves plaintext WordPress credentials for a Store (per-store DB credentials take precedence over `.env`).
 */
export function resolveStoreWpCredentials(
  store: StoreWpFields,
  envCfg: EnvWpConfig = getDefaultEnvWpConfig(),
  decryptFn: (value: string) => string = decrypt
): ResolvedStoreWpCredentials | null {
  if (store.wpUserEncrypted && store.wpAppPasswordEncrypted) {
    return {
      baseUrl: store.url.replace(/\/+$/, ''),
      user: decryptFn(store.wpUserEncrypted),
      appPassword: decryptFn(store.wpAppPasswordEncrypted),
      source: 'store',
    };
  }
  if (isEnvWpBrandSaleConfigured(envCfg) && envCfg.wpUrl && envCfg.wpUser && envCfg.wpAppPassword) {
    if (normalizeSiteUrl(store.url) === normalizeSiteUrl(envCfg.wpUrl)) {
      return {
        baseUrl: envCfg.wpUrl.replace(/\/+$/, ''),
        user: envCfg.wpUser,
        appPassword: envCfg.wpAppPassword,
        source: 'env',
      };
    }
  }
  return null;
}

// ==========================================
// PER-STORE CLIENT CACHE (preserves 5-min brands cache)
// ==========================================

const clientCache = new Map<string, { fingerprint: string; client: WpBrandSaleClient }>();

function buildConfigFingerprint(config: WpBrandSaleClientConfig): string {
  return createHash('sha256')
    .update(`${config.baseUrl.replace(/\/+$/, '')}\0${config.user}\0${config.appPassword}`)
    .digest('hex');
}

export function getOrCreateWpBrandSaleClient(
  cacheKey: string,
  config: WpBrandSaleClientConfig
): WpBrandSaleClient {
  const fingerprint = buildConfigFingerprint(config);
  const existing = clientCache.get(cacheKey);
  if (existing && existing.fingerprint === fingerprint) {
    return existing.client;
  }
  const client = createWpBrandSaleClient(config);
  clientCache.set(cacheKey, { fingerprint, client });
  return client;
}

export function clearWpBrandSaleClientCache(): void {
  clientCache.clear();
}

function getEnvDisplayName(wpUrl: string): string {
  try {
    return new URL(wpUrl).host;
  } catch {
    return wpUrl;
  }
}

// ==========================================
// MULTI-STORE ACCESSIBLE SALE STORES & RESOLVER
// ==========================================

/**
 * Returns all active stores accessible to `chatId` that have Brand Discounts configured
 * (via per-store DB credentials or matching `.env` fallback).
 * For `ADMIN_CHAT_ID`, if `.env` `WP_URL` is configured and doesn't match any active DB store,
 * appends the admin-only `__env__` fallback entry so staging/standalone setups keep working.
 */
export async function getAccessibleSaleStoresForChat(
  chatId: bigint | number | string
): Promise<SaleStoreInfo[]> {
  const chatBigInt = BigInt(chatId);
  const isAdmin = String(chatBigInt) === env.ADMIN_CHAT_ID;
  const envCfg = getDefaultEnvWpConfig();
  const accessibleStores = await getAccessibleStoresForChat(chatBigInt);

  const result: SaleStoreInfo[] = [];
  let envUrlMatchedStore = false;
  const normalizedEnvUrl = envCfg.wpUrl ? normalizeSiteUrl(envCfg.wpUrl) : null;

  for (const store of accessibleStores) {
    if (normalizedEnvUrl && normalizeSiteUrl(store.url) === normalizedEnvUrl) {
      envUrlMatchedStore = true;
    }
    if (hasStoreWpBrandSaleConfig(store, envCfg)) {
      const hasDbCreds = Boolean(store.wpUserEncrypted && store.wpAppPasswordEncrypted);
      result.push({
        id: store.id,
        slug: store.name.toLowerCase(),
        name: store.name,
        url: hasDbCreds ? store.url.replace(/\/+$/, '') : (envCfg.wpUrl ?? store.url).replace(/\/+$/, ''),
        source: hasDbCreds ? 'store' : 'env',
      });
    }
  }

  if (isAdmin && isEnvWpBrandSaleConfigured(envCfg) && envCfg.wpUrl && !envUrlMatchedStore) {
    result.push({
      id: ENV_STORE_ID,
      slug: ENV_STORE_SLUG,
      name: getEnvDisplayName(envCfg.wpUrl),
      url: envCfg.wpUrl.replace(/\/+$/, ''),
      source: 'env',
    });
  }

  return result;
}

/**
 * Resolves a specific store for `/discounts` and enforces strict multi-store isolation:
 * - Admin (`ADMIN_CHAT_ID`) may access any active configured store (plus `__env__` fallback).
 * - Managers (`ChatUser.isActive === true`) may ONLY access active configured stores they belong to (`StoreMember`).
 */
export async function resolveSaleStore(
  chatId: bigint | number | string,
  storeIdentifier: string,
  lang: SupportedLanguage = 'en'
): Promise<ResolvedSaleStore> {
  const dict = t(lang);
  const chatBigInt = BigInt(chatId);
  const isAdmin = String(chatBigInt) === env.ADMIN_CHAT_ID;
  const envCfg = getDefaultEnvWpConfig();

  // 1. Reserved admin-only env fallback (for staging/unregistered WP_URL)
  if (storeIdentifier === ENV_STORE_SLUG) {
    if (!isAdmin) {
      throw new SaleAccessError('ACCESS_DENIED', dict.accessDeniedNotMember);
    }
    if (!isEnvWpBrandSaleConfigured(envCfg) || !envCfg.wpUrl || !envCfg.wpUser || !envCfg.wpAppPassword) {
      throw new SaleAccessError('NOT_CONFIGURED', dict.saleNotConfigured);
    }
    const baseUrl = envCfg.wpUrl.replace(/\/+$/, '');
    const client = getOrCreateWpBrandSaleClient(ENV_STORE_ID, {
      baseUrl,
      user: envCfg.wpUser,
      appPassword: envCfg.wpAppPassword,
    });
    return {
      id: ENV_STORE_ID,
      slug: ENV_STORE_SLUG,
      name: getEnvDisplayName(baseUrl),
      url: baseUrl,
      source: 'env',
      client,
    };
  }

  // 2. Lookup active store by UUID or slug (case-insensitive)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeIdentifier);
  const store = await prisma.store.findFirst({
    where: isUuid
      ? {
          OR: [{ id: storeIdentifier }, { name: { equals: storeIdentifier, mode: 'insensitive' } }],
          isActive: true,
        }
      : { name: { equals: storeIdentifier, mode: 'insensitive' }, isActive: true },
  });

  if (!store) {
    throw new SaleAccessError('STORE_NOT_FOUND', dict.storeNotFoundOrInactive(storeIdentifier));
  }

  // 3. Enforce strict store membership isolation for non-admins
  if (!isAdmin) {
    const [user, membership] = await Promise.all([
      prisma.chatUser.findUnique({ where: { chatId: chatBigInt } }),
      prisma.storeMember.findUnique({
        where: {
          chatId_storeId: {
            chatId: chatBigInt,
            storeId: store.id,
          },
        },
      }),
    ]);

    const check = canAccessStore({
      chatId: chatBigInt,
      adminChatId: env.ADMIN_CHAT_ID,
      user,
      store,
      isStoreMember: Boolean(membership),
    });

    if (!check.allowed) {
      const localizedReason =
        check.reasonCode === 'STORE_INACTIVE'
          ? dict.storeInactive
          : check.reasonCode === 'USER_INACTIVE'
            ? dict.userInactiveOrNotFound
            : dict.accessDeniedNotMember;
      throw new SaleAccessError('ACCESS_DENIED', localizedReason, store.name);
    }
  }

  // 4. Resolve per-store WP credentials (DB first, then matching .env fallback)
  const creds = resolveStoreWpCredentials(store, envCfg);
  if (!creds) {
    throw new SaleAccessError('NOT_CONFIGURED', dict.saleNotConfiguredForStore(escapeHtml(store.name)), store.name);
  }

  const client = getOrCreateWpBrandSaleClient(store.id, {
    baseUrl: creds.baseUrl,
    user: creds.user,
    appPassword: creds.appPassword,
  });

  return {
    id: store.id,
    slug: store.name.toLowerCase(),
    name: store.name,
    url: creds.baseUrl,
    source: creds.source,
    client,
  };
}

export const defaultSaleStoreResolver: SaleStoreResolver = {
  getAccessibleSaleStores: getAccessibleSaleStoresForChat,
  async hasAnyAccessibleStore(chatId) {
    const stores = await getAccessibleStoresForChat(chatId);
    return stores.length > 0;
  },
  resolveSaleStore,
  isAdmin(chatId) {
    if (chatId === undefined || chatId === null) return false;
    return String(chatId) === env.ADMIN_CHAT_ID;
  },
};

// ==========================================
// LEGACY ENV-BOUND SINGLETON HELPERS
// ==========================================

function getLegacyEnvClient(): WpBrandSaleClient {
  if (!env.WP_URL || !env.WP_USER || !env.WP_APP_PASSWORD) {
    throw new WpBrandSaleError('config', 'WP_URL, WP_USER and WP_APP_PASSWORD must be set');
  }
  return getOrCreateWpBrandSaleClient(ENV_STORE_ID, {
    baseUrl: env.WP_URL,
    user: env.WP_USER,
    appPassword: env.WP_APP_PASSWORD,
  });
}

/** Brand list (cached in memory for 5 minutes) from `.env` WP config. */
export function getBrands(opts?: { force?: boolean }): Promise<WpBrand[]> {
  return getLegacyEnvClient().getBrands(opts);
}

/** Always fetches fresh state from WordPress (never cached) from `.env` WP config. */
export function getSale(): Promise<BrandSale> {
  return getLegacyEnvClient().getSale();
}

/** Replaces the whole sale config (PUT) using `.env` WP config. */
export function saveSale(config: BrandSaleConfig): Promise<BrandSale> {
  return getLegacyEnvClient().saveSale(config);
}

/** Ends the sale immediately (DELETE) using `.env` WP config. */
export function endSale(): Promise<BrandSale> {
  return getLegacyEnvClient().endSale();
}

export const wpBrandSale = { getBrands, getSale, saveSale, endSale, isConfigured: isEnvWpBrandSaleConfigured };
