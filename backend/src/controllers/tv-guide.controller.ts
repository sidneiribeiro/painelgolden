import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
import TVGuideService from '../services/tv-guide.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TVGuideController');

/**
 * POST /api/tv/refresh
 * Atualizar eventos de TV do dia (multi-esporte)
 */
export const refreshTVGuide = asyncHandler(async (req: Request, res: Response) => {
  const { daysAhead = 1, apiKey } = req.body || {};
  const result = await TVGuideService.refreshTVEvents(Number(daysAhead) || 1, apiKey);
  res.json({ message: 'Atualização de TV iniciada', ...result });
});

/**
 * GET /api/tv/events
 * Listar eventos de TV (hoje por padrão, ou por intervalo)
 */
export const getTVEvents = asyncHandler(async (req: Request, res: Response) => {
  const { start, end } = req.query;
  const startDate = start ? new Date(String(start)) : undefined;
  const endDate = end ? new Date(String(end)) : undefined;
  const events = await TVGuideService.listTVEvents(startDate, endDate);
  res.json(events);
});

/**
 * GET /api/tv/channels
 * Listar mapeamentos de canais
 */
export const getTVChannels = asyncHandler(async (_req: Request, res: Response) => {
  const channels = await TVGuideService.listChannelMaps();
  res.json(channels);
});

/**
 * POST /api/tv/channels
 * Criar/atualizar mapeamento de canal
 */
export const upsertTVChannel = asyncHandler(async (req: Request, res: Response) => {
  const { apiChannel, xuiStreamId, xuiServerId, xuiCategoryId, priority } = req.body;
  const mapped = await TVGuideService.upsertChannelMap({
    apiChannel,
    xuiStreamId: xuiStreamId ? Number(xuiStreamId) : undefined,
    xuiServerId,
    xuiCategoryId: xuiCategoryId ? Number(xuiCategoryId) : undefined,
    priority: priority !== undefined ? Number(priority) : undefined,
  });
  res.json(mapped);
});





