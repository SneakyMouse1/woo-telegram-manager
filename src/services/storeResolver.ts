import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/crypto.js';
import { WooCommerceService } from './woocommerceService.js';
import type { Store } from '@prisma/client';
import { t, type SupportedLanguage } from '../bot/i18n/index.js';

export interface ResolvedStore {
  id: string;
  name: string;
  url: string;
  woocommerceUrl: string;
  client: WooCommerceService;
  webhookSecret: string | null;
  rawStore: Store;
}

export interface StoreNotificationRecipient {
  chatId: bigint;
  language: string;
}

export { canAccessStore, type AccessCheckContext } from '../utils/accessControl.js';
import { canAccessStore } from '../utils/accessControl.js';

/**
 * Single entry point for resolving a store and creating an authorized WooCommerce API client.
 * Enforces strict isolation: non-admin users cannot access stores they are not members of.
 */
export async function resolveStore(
  chatId: bigint | number | string,
  storeIdentifier?: string,
  lang: SupportedLanguage = 'en'
): Promise<ResolvedStore> {
  const dict = t(lang);
  const chatBigInt = BigInt(chatId);
  const isAdmin = String(chatBigInt) === env.ADMIN_CHAT_ID;

  let store: Store | null = null;

  if (storeIdentifier) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeIdentifier);

    // 1. Search by UUID or by short name slug
    store = await prisma.store.findFirst({
      where: isUuid
        ? { OR: [{ id: storeIdentifier }, { name: storeIdentifier }], isActive: true }
        : { name: storeIdentifier, isActive: true },
    });

    if (!store) {
      throw new Error(dict.storeNotFoundOrInactive(storeIdentifier));
    }

    // 2. Enforce membership isolation for non-admins
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
        throw new Error(localizedReason);
      }
    }
  } else {
    // 3. Fallback: find primary accessible active store for this chat
    if (isAdmin) {
      store = await prisma.store.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });
    } else {
      const membership = await prisma.storeMember.findFirst({
        where: {
          chatId: chatBigInt,
          store: { isActive: true },
        },
        include: { store: true },
        orderBy: { createdAt: 'asc' },
      });
      store = membership?.store || null;
    }

    if (!store) {
      throw new Error(dict.noAccessibleStores);
    }
  }

  const apiKey = decrypt(store.apiKeyEncrypted);
  const apiSecret = decrypt(store.apiSecretEncrypted);
  const webhookSecret = store.webhookSecretEncrypted ? decrypt(store.webhookSecretEncrypted) : null;
  const client = new WooCommerceService(store.url, apiKey, apiSecret);

  return {
    id: store.id,
    name: store.name,
    url: store.url,
    woocommerceUrl: store.url,
    client,
    webhookSecret,
    rawStore: store,
  };
}

/**
 * Returns list of all active stores accessible to a given chat user.
 */
export async function getAccessibleStoresForChat(
  chatId: bigint | number | string
): Promise<Store[]> {
  const chatBigInt = BigInt(chatId);
  const isAdmin = String(chatBigInt) === env.ADMIN_CHAT_ID;

  if (isAdmin) {
    return prisma.store.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  const memberships = await prisma.storeMember.findMany({
    where: {
      chatId: chatBigInt,
      store: { isActive: true },
    },
    include: { store: true },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((m) => m.store);
}

/**
 * Returns all active recipients for order webhook notifications of a given store:
 * - Active StoreMembers with an active ChatUser record
 * - The primary ADMIN_CHAT_ID (admin gets notifications across all stores)
 */
export async function getRecipientsForStoreNotification(
  storeId: string
): Promise<StoreNotificationRecipient[]> {
  // 1. Fetch store members with active ChatUser accounts
  const members = await prisma.storeMember.findMany({
    where: {
      storeId,
      user: { isActive: true },
    },
    include: {
      user: true,
    },
  });

  const recipientMap = new Map<string, StoreNotificationRecipient>();

  for (const m of members) {
    recipientMap.set(String(m.chatId), {
      chatId: m.chatId,
      language: m.user.language || 'ru',
    });
  }

  // 2. Always include admin
  const adminId = BigInt(env.ADMIN_CHAT_ID);
  if (!recipientMap.has(String(adminId))) {
    const adminUser = await prisma.chatUser.findUnique({
      where: { chatId: adminId },
    });
    recipientMap.set(String(adminId), {
      chatId: adminId,
      language: adminUser?.language || 'ru',
    });
  }

  return Array.from(recipientMap.values());
}

/**
 * Temporary bridge helper until step 5 transitions all bot handlers to resolveStore directly.
 */
export async function getWooCommerceClientForStore(storeId: string): Promise<WooCommerceService> {
  const store = await resolveStore(env.ADMIN_CHAT_ID, storeId);
  return store.client;
}
