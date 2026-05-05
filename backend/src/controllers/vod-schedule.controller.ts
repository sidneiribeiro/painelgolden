/**
 * Controller para gerenciar agendamentos de importação VOD
 */

import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { vodScheduleService } from '../services/vod/vod-schedule.service.js';
import cron from 'node-cron';

const logger = createLogger('VODScheduleController');

/**
 * GET /api/vod/schedules
 * Lista todos os agendamentos
 */
export const getSchedules = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.query;
  const userId = (req as any).user?.id || (req as any).user?.userId;

  const where: any = {};
  if (serverId) {
    where.serverId = serverId as string;
  }
  if (userId) {
    where.userId = userId;
  }

  const schedules = await prisma.vODImportSchedule.findMany({
    where,
    include: {
      server: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.json({
    success: true,
    data: schedules,
  });
});

/**
 * GET /api/vod/schedules/:id
 * Obtém um agendamento específico
 */
export const getSchedule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const schedule = await prisma.vODImportSchedule.findUnique({
    where: { id },
    include: {
      server: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!schedule) {
    throw new AppError(404, 'Agendamento não encontrado');
  }

  res.json({
    success: true,
    data: schedule,
  });
});

/**
 * POST /api/vod/schedules
 * Cria um novo agendamento
 */
export const createSchedule = asyncHandler(async (req: Request, res: Response) => {
  const {
    serverId,
    name,
    m3uUrl,
    cronExpression,
    vodType,
    enrichWithTMDB,
    clearBeforeImport,
    categoryMappings,
    bouquetId,
    tmdbApiKey,
    isActive,
  } = req.body;

  const userId = (req as any).user?.id || (req as any).user?.userId;

  // Validações
  if (!serverId || !name || !m3uUrl || !cronExpression) {
    throw new AppError(400, 'serverId, name, m3uUrl e cronExpression são obrigatórios');
  }

  // Validar expressão cron
  if (!cron.validate(cronExpression)) {
    throw new AppError(400, `Expressão cron inválida: ${cronExpression}`);
  }

  // Verificar se servidor existe
  const server = await prisma.xuiServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new AppError(404, 'Servidor XUI não encontrado');
  }

  // Criar agendamento
  const schedule = await prisma.vODImportSchedule.create({
    data: {
      userId,
      serverId,
      name,
      m3uUrl,
      cronExpression,
      vodType: vodType || 'both',
      enrichWithTMDB: enrichWithTMDB === true,
      clearBeforeImport: clearBeforeImport === true,
      categoryMappings: categoryMappings ? JSON.stringify(categoryMappings) : null,
      bouquetId: bouquetId ? parseInt(bouquetId, 10) : null,
      tmdbApiKey: tmdbApiKey || null,
      isActive: isActive !== false,
    },
    include: {
      server: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Se está ativo, agendar imediatamente
  if (schedule.isActive) {
    try {
      await vodScheduleService.scheduleImport(schedule.id);
    } catch (error: any) {
      logger.error(`[VODScheduleController] Erro ao agendar ${schedule.id}:`, error.message);
      // Não falhar a criação, apenas logar erro
    }
  }

  logger.info(`[VODScheduleController] Agendamento criado: ${schedule.id}`);

  res.status(201).json({
    success: true,
    data: schedule,
    message: 'Agendamento criado com sucesso',
  });
});

/**
 * PUT /api/vod/schedules/:id
 * Atualiza um agendamento
 */
export const updateSchedule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    name,
    m3uUrl,
    cronExpression,
    vodType,
    enrichWithTMDB,
    clearBeforeImport,
    categoryMappings,
    bouquetId,
    tmdbApiKey,
    isActive,
  } = req.body;

  // Verificar se existe
  const existing = await prisma.vODImportSchedule.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError(404, 'Agendamento não encontrado');
  }

  // Validar expressão cron se fornecida
  if (cronExpression && !cron.validate(cronExpression)) {
    throw new AppError(400, `Expressão cron inválida: ${cronExpression}`);
  }

  // Atualizar
  const schedule = await prisma.vODImportSchedule.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(m3uUrl !== undefined && { m3uUrl }),
      ...(cronExpression !== undefined && { cronExpression }),
      ...(vodType !== undefined && { vodType }),
      ...(enrichWithTMDB !== undefined && { enrichWithTMDB }),
      ...(clearBeforeImport !== undefined && { clearBeforeImport }),
      ...(categoryMappings !== undefined && { categoryMappings: categoryMappings ? JSON.stringify(categoryMappings) : null }),
      ...(bouquetId !== undefined && { bouquetId: bouquetId ? parseInt(bouquetId, 10) : null }),
      ...(tmdbApiKey !== undefined && { tmdbApiKey }),
      ...(isActive !== undefined && { isActive }),
    },
    include: {
      server: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Reagendar se necessário
  if (schedule.isActive) {
    try {
      await vodScheduleService.scheduleImport(schedule.id);
    } catch (error: any) {
      logger.error(`[VODScheduleController] Erro ao reagendar ${schedule.id}:`, error.message);
    }
  } else {
    vodScheduleService.unscheduleImport(schedule.id);
  }

  logger.info(`[VODScheduleController] Agendamento atualizado: ${schedule.id}`);

  res.json({
    success: true,
    data: schedule,
    message: 'Agendamento atualizado com sucesso',
  });
});

/**
 * DELETE /api/vod/schedules/:id
 * Remove um agendamento
 */
export const deleteSchedule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const schedule = await prisma.vODImportSchedule.findUnique({
    where: { id },
  });

  if (!schedule) {
    throw new AppError(404, 'Agendamento não encontrado');
  }

  // Remover do cron
  vodScheduleService.unscheduleImport(id);

  // Deletar do banco
  await prisma.vODImportSchedule.delete({
    where: { id },
  });

  logger.info(`[VODScheduleController] Agendamento deletado: ${id}`);

  res.json({
    success: true,
    message: 'Agendamento removido com sucesso',
  });
});

/**
 * POST /api/vod/schedules/:id/run
 * Executa um agendamento manualmente (sem esperar o cron)
 */
export const runSchedule = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const schedule = await prisma.vODImportSchedule.findUnique({
    where: { id },
    include: { server: true },
  });

  if (!schedule) {
    throw new AppError(404, 'Agendamento não encontrado');
  }

  // Executar em background (não bloquear resposta)
  res.json({
    success: true,
    message: 'Execução iniciada em background',
  });

  // Executar importação
  try {
    const categoryMappings = schedule.categoryMappings 
      ? JSON.parse(schedule.categoryMappings) 
      : [];

    const { M3UImporterService } = await import('../services/vod/m3u-importer.service.js');
    const importer = new M3UImporterService(
      schedule.server as any,
      schedule.tmdbApiKey || undefined
    );

    const result = await importer.importFromM3U(schedule.m3uUrl, {
      clearBeforeImport: schedule.clearBeforeImport,
      vodType: schedule.vodType as 'movie' | 'series' | 'both',
      enrichWithTMDB: schedule.enrichWithTMDB,
      categoryMappings,
      bouquetId: schedule.bouquetId || undefined,
      userId: schedule.userId,
    });

    await prisma.vODImportSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'success',
        lastRunError: null,
        totalRuns: schedule.totalRuns + 1,
      },
    });

    logger.info(`[VODScheduleController] Execução manual ${id} concluída: ${result.inserted} itens`);
  } catch (error: any) {
    await prisma.vODImportSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'error',
        lastRunError: error.message || 'Erro desconhecido',
        totalRuns: schedule.totalRuns + 1,
      },
    });

    logger.error(`[VODScheduleController] Erro na execução manual ${id}:`, error.message);
  }
});

