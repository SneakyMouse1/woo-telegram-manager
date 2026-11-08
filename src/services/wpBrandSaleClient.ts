import { z } from 'zod';

/**
 * Low-level client for the WordPress brand-sale REST API (`/wp-json/wc-brand-sale/v1`).
 *
 * The bot never calculates prices: the companion WordPress snippet does that.
 * This client only reads/replaces the sale config.
 *
 * Kept free of `config/env.ts` so it can be unit-tested with an injected `fetch`.
 * The env-bound singleton lives in `wpBrandSale.ts`.
 */

export const WP_REQUEST_TIMEOUT_MS = 15_000;
export const WP_BRANDS_CACHE_TTL_MS = 5 * 60 * 1000;

// ==========================================
// TYPES
// ==========================================

export interface WpBrand {
  id: number;
  name: string;
  taxonomy: string;
  count: number;
}

/** Percentages keyed by brand term_id (string keys, as in JSON). */
export type BrandDiscounts = Record<string, number>;

export interface BrandSale {
  version: string;
  /** Unix seconds, null when no sale has ever been configured. */
  start: number | null;
  end: number | null;
  active: boolean;
  /** Server time, unix seconds. */
  now: number;
  discounts: BrandDiscounts;
  brands: Record<string, { name: string; discount: number }>;
}

/** Full desired state sent with PUT (replaces the config entirely). */
export interface BrandSaleConfig {
  start: number;
  end: number;
  discounts: BrandDiscounts;
}

export interface WpBrandSaleClientConfig {
  baseUrl: string;
  user: string;
  appPassword: string;
  timeoutMs?: number;
  brandsCacheTtlMs?: number;
}

export type WpErrorKind =
  | 'config' // env vars missing
  | 'auth' // 401
  | 'forbidden' // 403
  | 'validation' // 400
  | 'not_found' // 404 (plugin/snippet missing)
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'bad_response'; // unexpected payload / redirect

export class WpBrandSaleError extends Error {
  kind: WpErrorKind;
  status?: number;
  code?: string;
  constructor(kind: WpErrorKind, message: string, status?: number, code?: string) {
    super(message);
    this.name = 'WpBrandSaleError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

// ==========================================
// RESPONSE SCHEMAS
// ==========================================

const intLike = z.union([z.number(), z.string().regex(/^-?\d+$/)]).transform((v) => Number(v));
const nullableTs = z
  .union([intLike, z.null(), z.literal(''), z.literal(false)])
  .transform((v) => (typeof v === 'number' && v > 0 ? v : null));

/** PHP serializes an empty associative array as `[]`, so accept both shapes. */
function phpMap<T extends z.ZodTypeAny>(value: T) {
  return z
    .union([z.record(value), z.array(z.any()).max(0)])
    .transform((v) => (Array.isArray(v) ? {} : v) as Record<string, z.output<T>>);
}

const brandSchema = z.object({
  id: intLike,
  name: z.string(),
  taxonomy: z.string().default(''),
  count: intLike.default(0),
});

const brandsSchema = z.array(brandSchema);

const saleSchema = z.object({
  version: z.union([z.string(), z.number()]).transform(String),
  start: nullableTs,
  end: nullableTs,
  active: z.boolean(),
  now: intLike,
  discounts: phpMap(intLike),
  brands: phpMap(z.object({ name: z.string(), discount: intLike })).default({}),
});

// ==========================================
// CLIENT
// ==========================================

export interface WpBrandSaleClient {
  getBrands(opts?: { force?: boolean }): Promise<WpBrand[]>;
  getSale(): Promise<BrandSale>;
  saveSale(config: BrandSaleConfig): Promise<BrandSale>;
  endSale(): Promise<BrandSale>;
  clearBrandsCache(): void;
}

export function createWpBrandSaleClient(
  config: WpBrandSaleClientConfig,
  fetchImpl: typeof fetch = fetch
): WpBrandSaleClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  if (!baseUrl.startsWith('https://')) {
    throw new WpBrandSaleError('config', 'WP_URL must use https://');
  }
  const apiBase = `${baseUrl}/wp-json/wc-brand-sale/v1`;
  // Application Passwords are shown with spaces; WordPress accepts them either way.
  const authHeader = 'Basic ' + Buffer.from(`${config.user}:${config.appPassword}`).toString('base64');
  const timeoutMs = config.timeoutMs ?? WP_REQUEST_TIMEOUT_MS;
  const cacheTtl = config.brandsCacheTtlMs ?? WP_BRANDS_CACHE_TTL_MS;

  let brandsCache: { data: WpBrand[]; expiresAt: number } | null = null;

  async function request<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, schema: z.ZodType<T, any, any>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'User-Agent': 'WooCommerce-Telegram-Manager/1.0',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Never follow redirects: they could leak the Basic auth header to another host.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new WpBrandSaleError('timeout', `WordPress did not respond within ${Math.round(timeoutMs / 1000)}s`);
      }
      const cause = err?.cause?.code || err?.cause?.message || err?.message || 'unknown error';
      throw new WpBrandSaleError('network', `WordPress is unreachable (${cause})`);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new WpBrandSaleError('bad_response', `Unexpected redirect (${response.status}) from WordPress`, response.status);
    }

    const text = await response.text();
    let json: any = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON body (e.g. HTML error page) */
    }

    if (!response.ok) {
      const code = typeof json?.code === 'string' ? json.code : undefined;
      const message = typeof json?.message === 'string' ? stripTags(json.message) : `HTTP ${response.status}`;
      const status = response.status;
      if (status === 401) throw new WpBrandSaleError('auth', message, status, code);
      if (status === 403) throw new WpBrandSaleError('forbidden', message, status, code);
      if (status === 400) throw new WpBrandSaleError('validation', message, status, code);
      if (status === 404) throw new WpBrandSaleError('not_found', message, status, code);
      if (status >= 500) throw new WpBrandSaleError('server', message, status, code);
      throw new WpBrandSaleError('bad_response', message, status, code);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new WpBrandSaleError('bad_response', 'Unexpected response format from WordPress', response.status);
    }
    return parsed.data;
  }

  return {
    async getBrands(opts) {
      if (!opts?.force && brandsCache && brandsCache.expiresAt > Date.now()) {
        return brandsCache.data;
      }
      const data = await request('GET', '/brands', brandsSchema);
      brandsCache = { data, expiresAt: Date.now() + cacheTtl };
      return data;
    },
    getSale() {
      return request('GET', '/brand-sale', saleSchema);
    },
    saveSale(cfg) {
      return request('PUT', '/brand-sale', saleSchema, {
        start: cfg.start,
        end: cfg.end,
        discounts: cfg.discounts,
      });
    },
    endSale() {
      return request('DELETE', '/brand-sale', saleSchema);
    },
    clearBrandsCache() {
      brandsCache = null;
    },
  };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}
