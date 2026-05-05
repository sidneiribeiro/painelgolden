/**
 * Rotas para gerenciamento de chaves TMDB
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import * as tmdbKeyController from '../controllers/tmdb-key.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// CRUD de chaves TMDB
router.get('/keys', tmdbKeyController.getKeys);
router.get('/keys/:id', tmdbKeyController.getKey);
router.post('/keys', tmdbKeyController.createKey);
router.put('/keys/:id', tmdbKeyController.updateKey);
router.delete('/keys/:id', tmdbKeyController.deleteKey);
router.post('/keys/:id/reset-counter', tmdbKeyController.resetCounter);

export default router;

