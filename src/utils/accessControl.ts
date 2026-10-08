export interface AccessCheckContext {
  chatId: bigint | string | number;
  adminChatId: string;
  user?: {
    isActive: boolean;
  } | null;
  store: {
    id: string;
    name: string;
    isActive: boolean;
  };
  isStoreMember: boolean;
}

export type AccessDenialReasonCode = 'STORE_INACTIVE' | 'USER_INACTIVE' | 'NOT_MEMBER';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  reasonCode?: AccessDenialReasonCode;
}

/**
 * Pure evaluation function for store isolation and access control.
 * Enforces:
 * 1. Inactive stores are never accessible.
 * 2. Admin has implicit access to all active stores.
 * 3. ChatUser must exist and have isActive === true.
 * 4. User must be a member of this specific store (cross-store isolation).
 */
export function canAccessStore(ctx: AccessCheckContext): AccessCheckResult {
  const chatIdStr = String(ctx.chatId);
  const isAdmin = chatIdStr === ctx.adminChatId;

  if (!ctx.store.isActive) {
    return { allowed: false, reason: 'Магазин неактивен', reasonCode: 'STORE_INACTIVE' };
  }

  if (isAdmin) {
    return { allowed: true };
  }

  if (!ctx.user || !ctx.user.isActive) {
    return { allowed: false, reason: 'Пользователь не найден или отключен', reasonCode: 'USER_INACTIVE' };
  }

  if (!ctx.isStoreMember) {
    return { allowed: false, reason: 'Доступ запрещен: вы не являетесь участником этого магазина', reasonCode: 'NOT_MEMBER' };
  }

  return { allowed: true };
}
