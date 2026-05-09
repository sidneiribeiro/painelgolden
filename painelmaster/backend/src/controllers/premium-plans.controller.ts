import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PremiumPlansController');

/**
 * Listar todos os planos (admin)
 */
export const listPlans = asyncHandler(async (req: Request, res: Response) => {
  logger.info('[ListPlans] Listando todos os planos');

  const plans = await prisma.premiumPlan.findMany({
    orderBy: {
      sortOrder: 'asc',
    },
  });

  return res.json({
    data: plans,
  });
});

/**
 * Criar novo plano
 */
export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, maxConnections, bouquetIds, credits, sortOrder, serverId, isTrial, durationHours } = req.body;

  logger.info(`[CreatePlan] Criando plano: ${name}`);

  if (!name || !maxConnections) {
    throw new AppError(400, 'Campos obrigatórios: name, maxConnections');
  }

  // Validação: planos de teste devem ter durationHours
  if (isTrial && !durationHours) {
    throw new AppError(400, 'Planos de teste devem ter duração em horas (durationHours)');
  }

  const plan = await prisma.premiumPlan.create({
    data: {
      name,
      description: description || null,
      maxConnections,
      bouquetIds: bouquetIds || '[]',
      credits: credits || 0,
      serverId: serverId || null,
      isTrial: isTrial || false,
      durationHours: durationHours || null,
      sortOrder: sortOrder || 0,
      isActive: true,
    },
  });

  logger.info(`[CreatePlan] Plano criado: ${plan.id}`, { isTrial: plan.isTrial, durationHours: plan.durationHours });

  return res.status(201).json({
    data: plan,
  });
});

/**
 * Atualizar plano
 */
export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, maxConnections, bouquetIds, credits, sortOrder, isActive, serverId, isTrial, durationHours } = req.body;

  logger.info(`[UpdatePlan] Atualizando plano: ${id}`);

  // Validação: se mudar para isTrial=true, deve ter durationHours
  if (isTrial && !durationHours) {
    throw new AppError(400, 'Planos de teste devem ter duração em horas (durationHours)');
  }

  const plan = await prisma.premiumPlan.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(maxConnections && { maxConnections }),
      ...(bouquetIds && { bouquetIds }),
      ...(credits !== undefined && { credits }),
      ...(serverId !== undefined && { serverId }),
      ...(isTrial !== undefined && { isTrial }),
      ...(durationHours !== undefined && { durationHours }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  logger.info(`[UpdatePlan] Plano atualizado: ${plan.id}`, { isTrial: plan.isTrial, durationHours: plan.durationHours });

  return res.json({
    data: plan,
  });
});

/**
 * Deletar plano
 */
export const deletePlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info(`[DeletePlan] Deletando plano: ${id}`);

  await prisma.premiumPlan.delete({
    where: { id },
  });

  logger.info(`[DeletePlan] Plano deletado: ${id}`);

  return res.json({
    message: 'Plano deletado com sucesso',
  });
});

/**
 * Buscar detalhes de um plano
 */
export const getPlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  logger.info(`[GetPlan] Buscando plano: ${id}`);

  const plan = await prisma.premiumPlan.findUnique({
    where: { id },
  });

  if (!plan) {
    throw new AppError(404, 'Plano não encontrado');
  }

  return res.json({
    data: plan,
  });
});
