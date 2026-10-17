export interface StockInputState {
  slug: string;
  productId: number;
  variationId?: number;
  vpage?: number;
  origin: string; // e.g. 'b:123:1' or 's:a1b2c3d4:1'
  cardMessageId?: number;
  promptMessageId?: number;
  expiresAt: number;
}

export const STOCK_INPUT_TTL_MS = 2 * 60 * 1000; // 2 minutes

const pendingStockInputs = new Map<string, StockInputState>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, item] of pendingStockInputs.entries()) {
    if (item.expiresAt <= now) {
      pendingStockInputs.delete(key);
    }
  }
}

/**
 * Stores a pending stock number input state for a given chatId.
 * TTL is 2 minutes by default.
 */
export function setPendingStockInput(
  chatId: bigint | number | string,
  data: Omit<StockInputState, 'expiresAt'>
): void {
  purgeExpired();
  pendingStockInputs.set(String(chatId), {
    ...data,
    expiresAt: Date.now() + STOCK_INPUT_TTL_MS,
  });
}

/**
 * Retrieves the pending stock input state for a given chatId.
 * Returns undefined if missing or expired.
 */
export function getPendingStockInput(
  chatId: bigint | number | string
): StockInputState | undefined {
  purgeExpired();
  const key = String(chatId);
  const item = pendingStockInputs.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    pendingStockInputs.delete(key);
    return undefined;
  }
  return item;
}

/**
 * Clears the pending stock input state for a given chatId.
 */
export function clearPendingStockInput(chatId: bigint | number | string): boolean {
  return pendingStockInputs.delete(String(chatId));
}
