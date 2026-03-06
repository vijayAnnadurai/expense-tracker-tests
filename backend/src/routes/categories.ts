import { Router, Request, Response } from 'express';
import logger from '../logger.js';
import db from '../db/knex.js';
import type { Category } from '../types/index.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const categories = await db('categories').select<Category[]>('*');
    logger.info({ count: categories.length }, 'Fetched categories');
    res.json(categories);
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch categories');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
