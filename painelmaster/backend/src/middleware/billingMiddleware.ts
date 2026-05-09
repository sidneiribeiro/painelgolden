import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

export interface BillingInfo {
  isBlocked: boolean;
  billingType: string;
  dueDate?: Date;
  daysUntilDue?: number;
  customerPrice?: number;
  activeCustomers?: number;
  totalToPay?: number;
}

declare global {
  namespace Express {
    interface Request {
      billingInfo?: BillingInfo;
    }
  }
}

export const billingMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Se não tem usuário autenticado, continua (será tratado pelo auth middleware)
    if (!req.user?.userId) {
      return next();
    }

    // Buscar informações do usuário
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        role: true,
        billingType: true,
        dueDate: true,
        customerPrice: true,
        isBlockedByBilling: true
      }
    });

    if (!user) {
      return next();
    }

    // Master tem acesso irrestrito
    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
      req.billingInfo = {
        isBlocked: false,
        billingType: 'MASTER'
      };
      return next();
    }

    // Se for pré-pago, não aplica bloqueio por vencimento
    if (user.billingType === 'PREPAID') {
      req.billingInfo = {
        isBlocked: false,
        billingType: 'PREPAID'
      };
      return next();
    }

    // Verificar vencimento para pós-pago
    const now = new Date();
    const isBlocked = !user.dueDate || now > user.dueDate;

    // Calcular dias até vencimento
    let daysUntilDue = 0;
    if (user.dueDate && user.dueDate > now) {
      const diffTime = user.dueDate.getTime() - now.getTime();
      daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // Contar clientes ativos
    const activeCustomersCount = await prisma.customer.count({
      where: {
        resellerUserId: req.user.userId,
        status: 'ACTIVE'
      }
    });

    // Calcular total a pagar
    let totalToPay = 0;
    if (user.customerPrice && activeCustomersCount > 0) {
      totalToPay = Number(user.customerPrice) * activeCustomersCount;
    }

    req.billingInfo = {
      isBlocked,
      billingType: 'POSTPAID',
      dueDate: user.dueDate || undefined,
      daysUntilDue,
      customerPrice: user.customerPrice ? Number(user.customerPrice) : undefined,
      activeCustomers: activeCustomersCount,
      totalToPay
    };

    // Atualizar flag de bloqueio se necessário
    if (isBlocked !== user.isBlockedByBilling) {
      await prisma.user.update({
        where: { id: req.user.userId },
        data: { isBlockedByBilling: isBlocked }
      });
    }

    next();
  } catch (error) {
    // Em caso de erro, permite acesso para não quebrar o sistema
    next();
  }
};

// Middleware para bloquear ações operacionais
export const requireBillingValid = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.billingInfo) {
    return next();
  }

  if (req.billingInfo.isBlocked) {
    return res.status(403).json({
      error: 'SUSPENSO POR VENCIMENTO',
      message: 'Seu acesso está suspenso. Regularize seu pagamento para continuar operando.',
      billingInfo: {
        dueDate: req.billingInfo.dueDate,
        totalToPay: req.billingInfo.totalToPay,
        activeCustomers: req.billingInfo.activeCustomers
      }
    });
  }

  next();
};

// Middleware para permitir apenas visualização
export const allowReadOnly = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.billingInfo?.isBlocked) {
    return next();
  }

  // Métodos permitidos quando bloqueado
  const allowedMethods = ['GET'];
  const allowedPaths = [
    '/api/auth/me',
    '/api/users',
    '/api/dashboard/stats',
    '/api/billing/info',
    '/api/core',
    '/api/settings/panel'
  ];

  if (allowedMethods.includes(req.method) && 
      allowedPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  return res.status(403).json({
    error: 'SUSPENSO POR VENCIMENTO',
    message: 'Acesso apenas para visualização. Regularize seu pagamento para operar.'
  });
};
