import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { connectDatabase, prisma } from './config/prisma.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { bot, setupBotMetadata } from './bot/index.js';

const app = express();

// Trust proxy configuration based on hops count
app.set('trust proxy', env.TRUST_PROXY_HOPS);

// Security and utility middleware
app.use(helmet());
app.use(cors());
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// API Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use(errorHandler);

// Start server
async function bootstrap() {
  await connectDatabase();

  const server = app.listen(env.PORT, () => {
    console.log(`[Server] Listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
    console.log(`[Server] Health check available at http://localhost:${env.PORT}/api/health`);
  });

  // Start Telegram bot
  if (env.TELEGRAM_BOT_TOKEN) {
    if (env.SETUP_BOT_METADATA) {
      setupBotMetadata().catch((err) => console.warn('[Bot] Could not setup bot metadata:', (err as Error).message));
    }
    bot.start({
      onStart: (botInfo) => {
        console.log(`[Bot] Telegram bot @${botInfo.username} started successfully`);
      },
    }).catch((err) => {
      console.error('[Bot] Telegram bot runner error:', err);
    });
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    try {
      await bot.stop();
    } catch { }
    server.close(async () => {
      await prisma.$disconnect();
      console.log('[Database] PostgreSQL connection closed. Exiting process.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal bootstrap error:', err);
  process.exit(1);
});
