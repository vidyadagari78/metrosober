import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/pickup_counter',
  webhookSecret: process.env.WEBHOOK_SECRET || 'pickup_counter_super_secret_key_2026',
  holdDurationSeconds: parseInt(process.env.HOLD_DURATION_SECONDS || '120', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};
