import express from 'express';
import cors from 'cors';
import { rawBodySaver } from './middleware/raw-body.middleware.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export function createApp() {
  const app = express();

  // Enable CORS
  app.use(cors());

  // JSON parser with raw body buffer preservation for HMAC verification
  app.use(express.json({ verify: rawBodySaver }));

  // Healthcheck
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Mount API routers
  app.use('/products', catalogRouter);
  app.use('/orders', orderRouter);
  app.use('/payments', paymentRouter);

  // Centralized error handling
  app.use(errorHandler);

  return app;
}
