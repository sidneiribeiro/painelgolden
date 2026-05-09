import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  listSources,
  getSource,
  createSource,
  toggleSourceStatus,
  deleteSource,
  getCreateData,
} from '../controllers/premium-sources.controller.js';

const router = Router();

// ==========================================
// ROTAS PROTEGIDAS (com autenticação)
// ==========================================
router.use(authMiddleware);

// Dados para criação (planos, servidores, bouquets)
router.get('/create-data', getCreateData);

// CRUD de fontes premium
router.get('/', listSources);
router.post('/', createSource);
router.get('/:id', getSource);
router.patch('/:id/toggle', toggleSourceStatus);
router.delete('/:id', deleteSource);

export default router;
