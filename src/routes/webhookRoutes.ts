import { Router } from 'express';
import { WebhookController } from '../controllers/webhookController.js';

export const webhookRoutes = Router();

// Strict webhook delivery endpoint requiring storeId for per-store HMAC validation
webhookRoutes.post('/woocommerce/:storeId', WebhookController.handleWooCommerceWebhook);

