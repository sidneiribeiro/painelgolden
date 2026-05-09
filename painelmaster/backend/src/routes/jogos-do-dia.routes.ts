import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import * as jogosDoDiaController from '../controllers/jogos-do-dia.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Configuração
router.get('/config', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.getFootballConfig);
router.post('/config', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.saveFootballConfig);

// Canais
router.get('/canais', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.getFootballChannels);
router.post('/canais', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.createFootballChannel);
router.put('/canais/:id', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.updateFootballChannel);
router.delete('/canais/:id', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.deleteFootballChannel);

// Jogos
router.get('/jogos', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.getDailyMatches);
router.post('/jogos', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.createDailyMatch);

// Atualização
router.post('/update', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.runManualUpdate);

// Categoria
router.post('/create-category', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.createCategory);

// Banners
router.get('/banners', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.getFootballBanners);

// Limpeza
router.delete('/jogos/clear', requireRole('SUPER_ADMIN', 'ADMIN'), jogosDoDiaController.clearDailyMatches);

export default router;

