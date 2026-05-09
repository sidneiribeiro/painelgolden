import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { XUIClient } from '../services/xui.client.js';
import { decryptApiKey } from './xuiSettings.controller.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { BouquetManager } from '../services/import/index.js';

const logger = createLogger('BouquetsController');

/**
 * GET /api/bouquets
 * Lista todos os bouquets do banco local
 */
export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.query;

  const where: any = {};
  if (serverId) where.serverId = serverId;

  const bouquets = await prisma.bouquet.findMany({
    where,
    include: {
      server: {
        select: { id: true, name: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Conta quantos pacotes usam cada bouquet
  const bouquetsWithStats = await Promise.all(
    bouquets.map(async (bouquet) => {
      const packages = await prisma.package.findMany({
        where: {
          serverId: bouquet.serverId,
          bouquets: { contains: bouquet.externalId },
        },
        select: { id: true },
      });

      return {
        ...bouquet,
        packagesCount: packages.length,
      };
    })
  );

  res.json({ data: bouquetsWithStats });
});

/**
 * GET /api/bouquets/:serverId
 * Lista bouquets de um servidor específico
 */
export const getByServer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;

  const bouquets = await prisma.bouquet.findMany({
    where: { serverId },
    orderBy: { name: 'asc' },
  });

  res.json({ data: bouquets });
});

/**
 * POST /api/bouquets/sync/:serverId
 * Sincroniza bouquets de um servidor
 */
export const sync = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  // XUIClient faz descriptografia internamente
  const client = new XUIClient(server);

  const bouquets = await client.getBouquets();
  let count = 0;

  for (const bouquet of bouquets) {
    await prisma.bouquet.upsert({
      where: {
        serverId_externalId: {
          serverId,
          externalId: String(bouquet.id),
        },
      },
      create: {
        serverId,
        externalId: String(bouquet.id),
        name: bouquet.bouquet_name,
      },
      update: {
        name: bouquet.bouquet_name,
      },
    });
    count++;
  }

  logger.info(`Sincronizados ${count} bouquets do servidor "${server.name}"`);

  res.json({
    success: true,
    message: `${count} bouquets sincronizados`,
    count,
  });
});

/**
 * GET /api/bouquets/for-select/:serverId
 * Retorna bouquets formatados para select
 */
export const getForSelect = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params;

  const bouquets = await prisma.bouquet.findMany({
    where: { serverId },
    select: {
      id: true,
      externalId: true,
      name: true,
    },
    orderBy: { name: 'asc' },
  });

  const formatted = bouquets.map(b => ({
    value: parseInt(b.externalId),
    label: b.name,
  }));

  res.json({ data: formatted });
});

export const getXuiBouquetItems = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, bouquetId } = req.params;
  const type = String(req.query.type || 'live');

  if (!['live', 'movie', 'series'].includes(type)) {
    throw new AppError(400, 'type inválido (use: live, movie, series)');
  }

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  const id = parseInt(String(bouquetId), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError(400, 'bouquetId inválido');
  }

  const manager = new BouquetManager(server);
  try {
    const items = await manager.getBouquetItemsWithNames(id, type as any);
    res.json({ success: true, data: { bouquetId: id, type, items } });
  } finally {
    await manager.disconnect();
  }
});

export const updateXuiBouquetOrder = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, bouquetId } = req.params;
  const type = String(req.body?.type || req.query.type || 'live');
  const orderedIds = req.body?.orderedIds;

  if (!['live', 'movie', 'series'].includes(type)) {
    throw new AppError(400, 'type inválido (use: live, movie, series)');
  }

  if (!Array.isArray(orderedIds)) {
    throw new AppError(400, 'orderedIds deve ser um array');
  }

  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) {
    throw new AppError(404, 'Servidor não encontrado');
  }

  const id = parseInt(String(bouquetId), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError(400, 'bouquetId inválido');
  }

  const manager = new BouquetManager(server);
  try {
    await manager.setBouquetItemOrder(id, type as any, orderedIds);
    res.json({ success: true });
  } catch (e: any) {
    throw new AppError(400, e?.message || 'Erro ao atualizar ordem');
  } finally {
    await manager.disconnect();
  }
});
