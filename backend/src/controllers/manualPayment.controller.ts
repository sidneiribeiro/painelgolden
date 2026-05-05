import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ManualPaymentController');

/**
 * Registrar pagamento manual
 */
export const createManualPayment = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    throw new AppError(401, 'Não autenticado');
  }

  const { customerId, value, paymentDate, method, notes } = req.body;

  if (!customerId || !value || !paymentDate) {
    throw new AppError(400, 'customerId, value e paymentDate são obrigatórios');
  }

  // Verificar se o cliente existe e pertence ao usuário
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      resellerUserId: userId,
    },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  const payment = await prisma.manualPayment.create({
    data: {
      customerId,
      value: parseFloat(value),
      paymentDate: new Date(paymentDate),
      method: method || 'PIX',
      notes: notes || null,
      createdBy: userId,
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  });

  logger.info(`[ManualPayment] Pagamento manual registrado: R$ ${value} para cliente ${customerId} por usuário ${userId}`);

  res.json({
    success: true,
    data: payment,
  });
});

/**
 * Listar pagamentos manuais
 */
export const getManualPayments = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    throw new AppError(401, 'Não autenticado');
  }

  const { customerId, startDate, endDate } = req.query;

  const where: any = {
    createdBy: userId,
  };

  if (customerId) {
    where.customerId = customerId as string;
  }

  if (startDate || endDate) {
    where.paymentDate = {};
    if (startDate) {
      where.paymentDate.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.paymentDate.lte = new Date(endDate as string);
    }
  }

  const payments = await prisma.manualPayment.findMany({
    where,
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
    orderBy: {
      paymentDate: 'desc',
    },
  });

  res.json({
    success: true,
    data: payments,
  });
});

/**
 * Deletar pagamento manual
 */
export const deleteManualPayment = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    throw new AppError(401, 'Não autenticado');
  }

  const { id } = req.params;

  const payment = await prisma.manualPayment.findFirst({
    where: {
      id,
      createdBy: userId,
    },
  });

  if (!payment) {
    throw new AppError(404, 'Pagamento não encontrado');
  }

  await prisma.manualPayment.delete({
    where: { id },
  });

  logger.info(`[ManualPayment] Pagamento manual deletado: ${id} por usuário ${userId}`);

  res.json({
    success: true,
    message: 'Pagamento deletado com sucesso',
  });
});

