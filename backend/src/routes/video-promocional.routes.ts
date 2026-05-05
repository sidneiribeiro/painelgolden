/**
 * 🎬 VÍDEO PROMOCIONAL ROUTES
 * 
 * Rotas ISOLADAS para o módulo de vídeo promocional.
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  searchContent,
  getContentDetails,
  generateVideo,
  getCurrentVideo,
  cleanupTempFiles,
} from '../controllers/video-promocional.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Buscar conteúdo no TMDB
router.get('/search', searchContent);

// Obter detalhes de um conteúdo
router.get('/details/:type/:id', getContentDetails);

// Gerar vídeo promocional
router.post('/generate', generateVideo);

// Obter vídeo atual
router.get('/current', getCurrentVideo);

// Limpar arquivos temporários
router.post('/cleanup', cleanupTempFiles);

export default router;
