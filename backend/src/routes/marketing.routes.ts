import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import * as marketingController from '../controllers/marketing.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Configuração
router.get('/config', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.getMarketingConfig);
router.post('/config', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.saveMarketingConfig);
router.post('/upload-logo', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.uploadLogo);
router.post('/upload-music', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.uploadMusicHandler);

// Banners
router.get('/banners', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.getBanners);
router.post('/generate-banner', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.generateBanner);
router.get('/banner/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.serveBanner);

// Vídeos
router.get('/videos', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.getVideos);
router.get('/video/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.serveVideo);

// Conteúdos Atualizados
router.get('/conteudos-atualizados', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.getConteudosAtualizados);

// Trigger manual de marketing (banners + vídeos + canais)
router.post('/manual-trigger', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), marketingController.manualTriggerMarketing);

export default router;
