import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const hex64 = z
  .string({ required_error: 'ENCRYPTION_KEY is required' })
  .length(64, 'ENCRYPTION_KEY must be a 64-character (32-byte) hex string')
  .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY must be a valid hex string');

const booleanFlag = z
  .preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim().toLowerCase();
      return trimmed === 'true' || trimmed === '1';
    }
    return Boolean(val);
  }, z.boolean())
  .default(false);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z
      .string({ required_error: 'DATABASE_URL is required' })
      .regex(/^(postgres|postgresql):\/\/.+/, 'DATABASE_URL must be a valid PostgreSQL connection string'),
    ENCRYPTION_KEY: hex64,
    ADMIN_CHAT_ID: z
      .string({ required_error: 'ADMIN_CHAT_ID is required' })
      .regex(/^-?\d+$/, 'ADMIN_CHAT_ID must be a numeric chat ID string'),
    PUBLIC_BACKEND_URL: z
      .string({ required_error: 'PUBLIC_BACKEND_URL is required' })
      .url('PUBLIC_BACKEND_URL must be a valid URL'),
    TELEGRAM_BOT_TOKEN: z
      .string({ required_error: 'TELEGRAM_BOT_TOKEN is required' })
      .regex(/^\d+:[A-Za-z0-9_-]{35,}$/, 'TELEGRAM_BOT_TOKEN is invalid format'),
    TELEGRAM_BOT_USERNAME: z
      .string()
      .optional()
      .transform((val) => (val && val.trim() !== '' ? val.trim().replace(/^@/, '') : undefined))
      .pipe(
        z
          .string()
          .regex(/^[A-Za-z0-9_]{5,32}$/, 'TELEGRAM_BOT_USERNAME must be 5-32 alphanumeric characters without @')
          .optional()
      ),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    DEBUG: booleanFlag,
    SETUP_BOT_METADATA: booleanFlag,
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production') {
      if (!v.PUBLIC_BACKEND_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_BACKEND_URL'], message: 'must be https in production' });
      }
    }
  });

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error('[Config] Invalid environment configuration:');
  console.error(parsedEnv.error.format());
  process.exit(1);
}
export const env = parsedEnv.data;
