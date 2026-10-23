import { Router, Request, Response, NextFunction } from 'express';
import { getProductsWithAvailableStock } from '../services/catalog.service.js';

export const catalogRouter = Router();

catalogRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await getProductsWithAvailableStock();
    res.json(products);
  } catch (err) {
    next(err);
  }
});
