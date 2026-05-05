import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getUserHierarchy } from '../controllers/hierarchyController.js';

const router = Router();

// Rotas que precisam de autenticação
router.use(authMiddleware);

// Obter hierarquia de usuários
router.get('/', getUserHierarchy);

export default router;
