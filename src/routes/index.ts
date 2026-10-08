import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { webhookRoutes } from './webhookRoutes.js';

export const apiRouter = Router();

apiRouter.get('/health', async (req, res) => {
  if (env.DEBUG) {
    console.log(`[Server] [DEBUG /health] Client IP: ${req.ip}`);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
      ...(env.DEBUG ? { clientIp: req.ip } : {}),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: (error as Error).message,
    });
  }
});

apiRouter.use('/webhooks', webhookRoutes);
