import { Router, Request, Response, NextFunction } from 'express';
import { createOrder, getOrderById } from '../services/order.service.js';
import { claimOrderPickup } from '../services/pickup.service.js';

export const orderRouter = Router();

// POST /orders
orderRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Accepts either direct array: [{ productId, quantity }] or object: { items: [...] }
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    if (!items) {
      return res.status(400).json({ error: 'BadRequest', message: 'Payload must contain a list of items.' });
    }

    const order = await createOrder(items);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

// GET /orders/:id
orderRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await getOrderById(req.params.id);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /orders/:id/pickup-claim
orderRouter.post('/:id/pickup-claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await claimOrderPickup(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
