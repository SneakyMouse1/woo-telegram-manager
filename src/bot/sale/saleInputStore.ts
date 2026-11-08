/**
 * In-memory state for awaiting admin text input during "Current sale" edits
 * (custom percentage for a brand, or start/end dates).
 * Note: "New sale" wizard state in Step 3 will be persisted in Prisma `SaleDraft`.
 */

export type SalePendingAction =
  | {
      kind: 'edit_brand_pct';
      brandId: string;
      messageId?: number;
    }
  | {
      kind: 'edit_dates_start';
      messageId?: number;
    }
  | {
      kind: 'edit_dates_end';
      startUnix: number;
      messageId?: number;
    };

interface Entry {
  action: SalePendingAction;
  expiresAt: number;
}

export const SALE_INPUT_TTL_MS = 10 * 60 * 1000; // 10 minutes

const store = new Map<string, Entry>();

function purge(now = Date.now()): void {
  for (const [k, v] of store.entries()) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export function setPendingSaleInput(
  chatId: bigint | number | string,
  action: SalePendingAction,
  now = Date.now()
): void {
  purge(now);
  store.set(String(chatId), { action, expiresAt: now + SALE_INPUT_TTL_MS });
}

export function getPendingSaleInput(
  chatId: bigint | number | string,
  now = Date.now()
): SalePendingAction | undefined {
  purge(now);
  const entry = store.get(String(chatId));
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    store.delete(String(chatId));
    return undefined;
  }
  return entry.action;
}

export function clearPendingSaleInput(chatId: bigint | number | string): boolean {
  return store.delete(String(chatId));
}

/**
 * Clears any pending sale input when the user presses ANY inline button
 * (including "Back" / "Cancel" such as `s:ebs:*`, `s:cur`, `s:eb:*`, `s:m`, or
 * non-sale callbacks) or sends ANY slash command (`/orders`, `/start`, etc.).
 */
export function resetSaleInputOnUpdate(update: {
  chatId?: bigint | number | string;
  messageText?: string;
  callbackData?: string;
}): void {
  if (update.chatId === undefined || update.chatId === null) return;
  const isCommand = Boolean(update.messageText?.trim().startsWith('/'));
  const isCallback = typeof update.callbackData === 'string';
  if (isCommand || isCallback) {
    clearPendingSaleInput(update.chatId);
  }
}
