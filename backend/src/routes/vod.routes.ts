import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import * as vodController from '../controllers/vod.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// ⚠️ DEPRECATED: Sincronização completa removida
// router.post('/sync', requireRole('SUPER_ADMIN', 'ADMIN'), vodController.syncVOD);

// Listar itens VOD
router.get('/items', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.getVODItems);

// Listar filmes (alias para /items com vodType=movie)
router.get('/movies', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), (req, res, next) => {
  // Adicionar vodType=movie aos query params
  req.query.vodType = 'movie';
  return vodController.getVODItems(req, res, next);
});

// Estatísticas VOD
router.get('/stats', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.getVODStats);

// Debug: Verificar tabelas de séries
router.get('/debug-series', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.debugSeriesTables);

// Buscar item específico
router.get('/items/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.getVODItem);

// Categorias
router.get('/categories', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.getVODCategories);

// Servidores de streaming (Server Tree)
router.get('/servers', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.getVODServers);

// Importação M3U - APENAS SUPER_ADMIN
router.post('/preview', requireRole('SUPER_ADMIN'), vodController.previewM3U);
router.post('/import', requireRole('SUPER_ADMIN'), vodController.importFromM3U);

// TMDB Enrichment Jobs
router.get('/enrichment/jobs', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.listEnrichmentJobs);
router.get('/enrichment/jobs/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.getEnrichmentJob);
router.post('/enrichment/jobs', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.createEnrichmentJobForServer);
router.post('/enrichment/jobs/:id/cancel', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.cancelEnrichmentJob);

// Limpeza de conteúdo
// router.delete('/clear', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), vodController.clearVOD);

// ⚠️ PAUSE/RESUME/CANCEL: Rotas de controle de importação - APENAS SUPER_ADMIN
router.get('/import/status', requireRole('SUPER_ADMIN'), vodController.getImportStatus);
router.post('/import/pause', requireRole('SUPER_ADMIN'), vodController.pauseImport);
router.post('/import/resume', requireRole('SUPER_ADMIN'), vodController.resumeImport);
router.post('/import/cancel', requireRole('SUPER_ADMIN'), vodController.cancelImport);

// 🗑️ Exclusão em massa por URL base
router.delete('/movies/by-url', requireRole('SUPER_ADMIN', 'ADMIN'), vodController.deleteMoviesByUrl);

// 🔍 Diagnóstico: Comparar formato de filmes
router.get('/diagnose', requireRole('SUPER_ADMIN', 'ADMIN'), vodController.diagnoseMovieFormat);

// ⚠️ AGENDAMENTO AUTOMÁTICO: Rotas de agendamento - APENAS SUPER_ADMIN
import * as vodScheduleController from '../controllers/vod-schedule.controller.js';
router.get('/schedules', requireRole('SUPER_ADMIN'), vodScheduleController.getSchedules);
router.get('/schedules/:id', requireRole('SUPER_ADMIN'), vodScheduleController.getSchedule);
router.post('/schedules', requireRole('SUPER_ADMIN'), vodScheduleController.createSchedule);
router.put('/schedules/:id', requireRole('SUPER_ADMIN'), vodScheduleController.updateSchedule);
router.delete('/schedules/:id', requireRole('SUPER_ADMIN'), vodScheduleController.deleteSchedule);
router.post('/schedules/:id/run', requireRole('SUPER_ADMIN'), vodScheduleController.runSchedule);

export default router;

