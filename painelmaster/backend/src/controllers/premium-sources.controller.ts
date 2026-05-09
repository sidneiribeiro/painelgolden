import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { PremiumSourceService } from '../services/premium-source.service.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PremiumSourcesController');

/**
 * Listar fontes premium do usuário logado
 */
export const listSources = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.userId;
  if (!userId) throw new AppError(401, 'Não autenticado');

  const { status } = req.query;

  const sources = await PremiumSourceService.listSources(userId, {
    status: status as string,
  });

  return res.json({ data: sources });
});

/**
 * Buscar fonte por ID
 */
export const getSource = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.userId;
  if (!userId) throw new AppError(401, 'Não autenticado');

  const { id } = req.params;

  const source = await PremiumSourceService.getSource(id, userId);
  if (!source) throw new AppError(404, 'Fonte não encontrada');

  return res.json({ data: source });
});

/**
 * Criar nova fonte premium
 */
export const createSource = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.userId;
  if (!userId) throw new AppError(401, 'Não autenticado');

  const { planId, serverId, bouquetId, durationDays = 30, customUsername } = req.body;

  if (!planId) throw new AppError(400, 'planId é obrigatório');
  if (!serverId) throw new AppError(400, 'serverId é obrigatório');
  if (!bouquetId) throw new AppError(400, 'bouquetId é obrigatório');

  logger.info('[CreateSource] Criando fonte...', { userId, planId, serverId, bouquetId, durationDays });

  const result = await PremiumSourceService.createSource({
    planId,
    serverId,
    bouquetId,
    resellerUserId: userId,
    durationDays: parseInt(String(durationDays), 10),
    customUsername,
  });

  return res.status(201).json({
    data: result.source,
    credentials: result.credentials,
    urls: result.urls,
    message: 'Fonte premium criada com sucesso!',
  });
});

/**
 * Pausar/Ativar fonte
 */
export const toggleSourceStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.userId;
  if (!userId) throw new AppError(401, 'Não autenticado');

  const { id } = req.params;

  const source = await PremiumSourceService.toggleStatus(id, userId);

  return res.json({
    data: source,
    message: `Fonte ${source.status === 'ACTIVE' ? 'ativada' : 'pausada'} com sucesso!`,
  });
});

/**
 * Deletar fonte
 */
export const deleteSource = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.userId;
  if (!userId) throw new AppError(401, 'Não autenticado');

  const { id } = req.params;

  await PremiumSourceService.deleteSource(id, userId);

  return res.json({ message: 'Fonte deletada com sucesso!' });
});

/**
 * Listar dados para criação de fonte (planos, servidores, bouquets)
 */
export const getCreateData = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as any)?.userId;
  if (!userId) throw new AppError(401, 'Não autenticado');

  // Buscar planos ativos
  const plans = await prisma.premiumPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  // Buscar servidores
  const servers = await prisma.xuiServer.findMany({
    where: { isActive: true },
    select: { id: true, name: true, baseUrl: true },
  });

  // Buscar bouquets
  const bouquets = await prisma.bouquet.findMany({
    select: { id: true, name: true, externalId: true, serverId: true },
    orderBy: { name: 'asc' },
  });

  return res.json({
    data: {
      plans,
      servers,
      bouquets,
    },
  });
});
