import { Router, Request, Response, NextFunction } from 'express';
import { verifyWebhookSignature, processPaymentWebhook } from '../services/payment.service.js';
import { RequestWithRawBody } from '../middleware/raw-body.middleware.js';

export const paymentRouter = Router();

// POST /payments/webhook
paymentRouter.post('/webhook', async (req: RequestWithRawBody, res: Response, next: NextFunction) => {
  try {
    const signature = (req.headers['x-signature'] || req.headers['X-Signature']) as string | undefined;

    // Use rawBody buffer captured by express.json({ verify: ... })
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

    // 1. Verify HMAC-SHA256 signature against WEBHOOK_SECRET
    verifyWebhookSignature(rawBody, signature);

    // 2. Process webhook event
    const result = await processPaymentWebhook(req.body, req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
