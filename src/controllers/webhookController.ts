import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { decrypt } from '../utils/crypto.js';
import { verifyWebhookHmac } from '../utils/hmac.js';
import { sendOrderNotificationToStore } from '../bot/index.js';
import type { WooOrder } from '../services/woocommerceService.js';

export class WebhookController {
  /**
   * Handle incoming WooCommerce order webhooks (order.created, order.updated).
   * Strict HMAC verification using per-store decrypted webhook secrets (supports 1 or 2 secrets for rotation).
   */
  static async handleWooCommerceWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { storeId } = req.params;
      const signature = req.headers['x-wc-webhook-signature'] as string | undefined;
      const topic = req.headers['x-wc-webhook-topic'] as string | undefined;

      if (!storeId) {
        res.status(400).json({ error: 'Missing storeId parameter in webhook URL' });
        return;
      }

      // Mandatory HMAC signature header
      if (!signature) {
        console.warn(`[Webhook] Rejected webhook for store ${storeId}: missing signature header`);
        res.status(401).json({ error: 'Missing x-wc-webhook-signature header' });
        return;
      }

      // 1. Fetch store from database. If unknown or inactive, respond with generic 401 without timing/existence leak
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId);
      if (!isUuid) {
        console.warn(`[Webhook] Rejected webhook: store ${storeId} is not a valid UUID`);
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      const store = await prisma.store.findFirst({
        where: { id: storeId, isActive: true },
      });

      if (!store || !store.webhookSecretEncrypted) {
        console.warn(`[Webhook] Rejected webhook: store ${storeId} not found or inactive`);
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      // 2. Decrypt secret(s) - supports comma-separated "newSecret,oldSecret" during rotation
      const decryptedSecret = decrypt(store.webhookSecretEncrypted);
      const secrets = decryptedSecret
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      // 3. Obtain raw request body bytes
      const rawBody =
        (req as any).rawBody ||
        Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

      // 4. Verify HMAC signature across decrypted secrets without early exit
      const isValid = verifyWebhookHmac(rawBody, signature, secrets);

      if (!isValid) {
        console.warn(`[Webhook] Invalid HMAC signature for store "${store.name}" (${storeId})`);
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      // 5. Handle ping test from WooCommerce (topic ping or body containing webhook_id)
      const webhookId = req.headers['x-wc-webhook-id'];
      const isPing =
        (topic && topic.includes('action.woocommerce_webhook_ping')) ||
        req.body?.webhook_id !== undefined ||
        (typeof req.body === 'string' && req.body.includes('webhook_id'));

      if (isPing) {
        console.log(`[Webhook] Validated ping test #${webhookId || 'ping'} for store "${store.name}"`);
        res.status(200).json({ status: 'ok', type: 'ping' });
        return;
      }

      // 6. Parse and validate order payload
      const order = req.body as WooOrder;
      if (!order || !order.id) {
        res.status(400).json({ error: 'Invalid order payload' });
        return;
      }

      // 7. Send order notification to all active store members and admin
      console.log(`[Webhook] Sending order notification #${order.number || order.id} for store "${store.name}"`);
      await sendOrderNotificationToStore(store.id, order);

      res.status(200).json({
        received: true,
        orderId: order.id,
        orderNumber: order.number,
        topic,
      });
    } catch (error) {
      console.error('[Webhook] Error processing webhook:', error);
      next(error);
    }
  }
}
