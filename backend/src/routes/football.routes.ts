/**
 * Rotas para módulo de Jogos do Dia
 * Conforme prompt: Sistema híbrido com matching automático de canais
 */

import { Router } from 'express';
import * as FootballController from '../controllers/football.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Configuração
router.get('/config/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getConfig);
router.put('/config/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.updateConfig);
router.get('/bouquets/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getBouquets);

// Canais
router.get('/channels/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getChannels);
router.post('/channels/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.addChannel);
router.put('/channels/:channelId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.updateChannel);
router.delete('/channels/:channelId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.deleteChannel);

// Jogos
router.get('/matches/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getMatches);
router.post('/matches/:serverId/update', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.updateMatches);
router.post('/matches/:matchId/map', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.mapMatchChannel);
router.delete('/matches/:id', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.deleteMatch);
router.patch('/matches/:id', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.updateMatch);

// Mapeamentos
router.get('/api-channels', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getApiChannels);
router.get('/xui-categories/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getXuiCategories);
router.get('/xui-channels/:serverId/:categoryId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getXuiChannels);
router.get('/mappings', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.getMappings);
router.post('/mappings', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.saveMapping);
router.delete('/mappings/:id', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.deleteMapping);

// Criar categoria
router.post('/create-category/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), FootballController.createCategory);

// Competições
router.get('/competitions', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), FootballController.getCompetitions);

// ✅ Removido: Rotas de descobrir e importar ligas (não necessárias com API do GE)

export default router;

