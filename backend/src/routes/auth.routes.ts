import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Rotas públicas
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/refresh', authController.refreshToken);
router.post('/recover-admin', authController.recoverAdmin);

// Rotas protegidas
router.use(authMiddleware);
router.get('/me', authController.me);
router.post('/logout', authController.logout);
router.put('/change-password', authController.changePassword);

export default router;
