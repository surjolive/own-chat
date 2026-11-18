import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_HOST: z.string().default('127.0.0.1'),
  APP_PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_ENCRYPTION_KEY: z.string().min(32),
  SUPER_ADMIN_USERNAME: z.string().trim().min(3).max(40),
  SUPER_ADMIN_EMAIL: z.string().trim().email(),
  SUPER_ADMIN_PASSWORD: z.string().min(12).max(128),
  DASHBOARD_PORT: z.coerce.number().default(5173),
  PUBLIC_APP_URL: z.string().url().default('http://127.0.0.1:5173'),
});

export const env = envSchema.parse(process.env);
