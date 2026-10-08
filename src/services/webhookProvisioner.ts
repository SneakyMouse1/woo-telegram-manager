import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { WooCommerceService } from './woocommerceService.js';
import type { Store } from '@prisma/client';

export interface ProvisionWebhooksOptions {
  dryRun?: boolean;
}

export interface ProvisionWebhooksResult {
  success: boolean;
  dryRun: boolean;
  storeId: string;
  storeName: string;
  deliveryUrl: string;
  oldWebhookIds: number[];
  newWebhookIds?: number[];
}

/**
 * Provision webhooks for a WooCommerce store in a zero-downtime, safe order:
 * 1. Discover existing webhooks matching this store's delivery_url.
 * 2. Generate newSecret and temporarily store dual-secret (newSecret,oldSecret) in DB.
 * 3. Create order.created and order.updated in WooCommerce with newSecret. (Rollback on failure).
 * 4. Delete old webhooks by saved IDs.
 * 5. Update DB to hold only newSecret.
 */
export async function provisionWebhooks(
  store: Pick<Store, 'id' | 'name' | 'url' | 'apiKeyEncrypted' | 'apiSecretEncrypted' | 'webhookSecretEncrypted'>,
  options: ProvisionWebhooksOptions = {}
): Promise<ProvisionWebhooksResult> {
  const isDryRun = Boolean(options.dryRun);
  const backendBase = env.PUBLIC_BACKEND_URL.replace(/\/+$/, '');
  const deliveryUrl = `${backendBase}/api/webhooks/woocommerce/${store.id}`;

  console.log(`[ProvisionWebhooks] Setting up webhooks for store "${store.name}" (${store.id})...`);
  console.log(`[ProvisionWebhooks] Delivery URL: ${deliveryUrl}`);

  // Initialize WooCommerce client
  const apiKey = decrypt(store.apiKeyEncrypted);
  const apiSecret = decrypt(store.apiSecretEncrypted);
  const client = new WooCommerceService(store.url, apiKey, apiSecret);

  // 1. Discover existing webhooks
  const allWebhooks = await client.getWebhooks();
  const oldStoreWebhooks = allWebhooks.filter((w) => w.delivery_url === deliveryUrl);
  const oldWebhookIds = oldStoreWebhooks.map((w) => w.id);

  console.log(
    `[ProvisionWebhooks] Found ${oldWebhookIds.length} existing webhook(s) for this store: [${oldWebhookIds.join(', ')}]`
  );

  // Check for foreign webhooks with our backend URL but different storeId
  const foreignWebhooks = allWebhooks.filter(
    (w) =>
      w.delivery_url !== deliveryUrl &&
      w.delivery_url.startsWith(`${backendBase}/api/webhooks/woocommerce/`)
  );

  if (foreignWebhooks.length > 0) {
    console.warn(
      `⚠️ [ProvisionWebhooks] ВНИМАНИЕ: На сайте обнаружены вебхуки с другим storeId на нашем бэкенде:`
    );
    for (const fw of foreignWebhooks) {
      console.warn(`   • "${fw.name}" (ID: ${fw.id}, URL: ${fw.delivery_url})`);
    }
    console.warn('   Эти вебхуки НЕ будут затронуты.');
  }

  if (isDryRun) {
    console.log('[ProvisionWebhooks] [DRY RUN] Plan:');
    console.log(`  1. Generate new 32-byte secret`);
    console.log(`  2. Temporarily write dual secret to DB for store ${store.name}`);
    console.log(`  3. Create order.created and order.updated pointing to ${deliveryUrl}`);
    console.log(`  4. Delete old webhook IDs: [${oldWebhookIds.join(', ')}]`);
    console.log(`  5. Finalize single secret in DB`);
    return {
      success: true,
      dryRun: true,
      storeId: store.id,
      storeName: store.name,
      deliveryUrl,
      oldWebhookIds,
    };
  }

  // 2. Generate newSecret and dual secret
  const newSecret = crypto.randomBytes(32).toString('hex');
  const prevEncryptedSecret = store.webhookSecretEncrypted;

  let dualSecret = newSecret;
  if (prevEncryptedSecret) {
    try {
      const prevDecrypted = decrypt(prevEncryptedSecret);
      const primaryOldSecret = prevDecrypted.split(',')[0].trim();
      if (primaryOldSecret) {
        dualSecret = `${newSecret},${primaryOldSecret}`;
      }
    } catch (decErr) {
      console.warn('[ProvisionWebhooks] Could not decrypt previous secret, using new secret only:', (decErr as Error).message);
    }
  }

  // Save dual secret to DB
  await prisma.store.update({
    where: { id: store.id },
    data: { webhookSecretEncrypted: encrypt(dualSecret) },
  });
  console.log('[ProvisionWebhooks] Saved dual secret to DB for zero-downtime transition.');

  // 3. Create order.created and order.updated with newSecret
  const createdIds: number[] = [];

  try {
    console.log('[ProvisionWebhooks] Creating new webhooks in WooCommerce...');
    const whCreated = await client.createWebhook({
      name: 'Woo Telegram Manager - Order Created',
      topic: 'order.created',
      delivery_url: deliveryUrl,
      secret: newSecret,
    });
    createdIds.push(whCreated.id);
    console.log(`[ProvisionWebhooks] Created order.created webhook (ID: ${whCreated.id})`);

    const whUpdated = await client.createWebhook({
      name: 'Woo Telegram Manager - Order Updated',
      topic: 'order.updated',
      delivery_url: deliveryUrl,
      secret: newSecret,
    });
    createdIds.push(whUpdated.id);
    console.log(`[ProvisionWebhooks] Created order.updated webhook (ID: ${whUpdated.id})`);
  } catch (createErr) {
    console.error('[Webhook Provisioner] Error creating new webhooks. Rolling back...', createErr);

    // Rollback created webhooks
    for (const id of createdIds) {
      try {
        await client.deleteWebhook(id);
      } catch (delErr) {
        console.error(`[Webhook Provisioner] Failed to cleanup created webhook ${id}:`, delErr);
      }
    }

    // Rollback DB secret
    await prisma.store.update({
      where: { id: store.id },
      data: { webhookSecretEncrypted: prevEncryptedSecret },
    });

    throw createErr;
  }

  // 4. Delete old webhooks by saved IDs (excluding newly created ones)
  console.log('[Webhook Provisioner] Deleting old webhooks...');
  for (const oldId of oldWebhookIds) {
    if (!createdIds.includes(oldId)) {
      try {
        await client.deleteWebhook(oldId);
        console.log(`[Webhook Provisioner] Deleted old webhook ID ${oldId}`);
      } catch (delErr) {
        console.warn(`[Webhook Provisioner] Failed to delete old webhook ${oldId} (non-fatal):`, (delErr as Error).message);
      }
    }
  }

  // 5. Finalize: write only newSecret to DB
  try {
    await prisma.store.update({
      where: { id: store.id },
      data: { webhookSecretEncrypted: encrypt(newSecret) },
    });
    console.log('[Webhook Provisioner] Finalized single secret in DB.');
  } catch (finalizeErr) {
    console.warn(
      '[Webhook Provisioner] Warning: Failed to finalize single secret in step 5. ' +
      'Dual-secret remains in DB — both are accepted safely, but repeating setup-webhooks is recommended.'
    );
  }

  console.log(`[Webhook Provisioner] Webhooks successfully configured for "${store.name}"`);

  return {
    success: true,
    dryRun: false,
    storeId: store.id,
    storeName: store.name,
    deliveryUrl,
    oldWebhookIds,
    newWebhookIds: createdIds,
  };
}
