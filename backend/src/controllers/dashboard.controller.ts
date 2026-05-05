import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler } from '../middleware/error.middleware.js';

/**
 * GET /api/dashboard
 * Retorna dados do dashboard baseado no banco local
 */
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Construir where clause baseado no role do usuário
  const where: any = {};
  if (!['SUPER_ADMIN', 'ADMIN'].includes(currentUser.role)) {
    where.resellerUserId = currentUser.userId;
  }

  // Buscar todos os clientes do usuário
  const allCustomers = await prisma.customer.findMany({
    where,
    include: {
      package: {
        select: { id: true, name: true }
      },
      server: {
        select: { id: true, name: true }
      }
    }
  });

  // Calcular estatísticas baseado no banco local
  const stats = {
    total_lines: allCustomers.length,
    active_lines: allCustomers.filter((c) => {
      return c.status === 'ACTIVE' && c.expiresAt && c.expiresAt > now;
    }).length,
    expired_lines: allCustomers.filter((c) => {
      return c.status === 'EXPIRED' || (c.expiresAt && c.expiresAt <= now);
    }).length,
    online_lines: 0, // Pode ser implementado depois com conexões ao vivo
    offline_lines: 0, // Pode ser implementado depois
    trials_today: allCustomers.filter((c) => {
      return c.isTrial && c.createdAt && c.createdAt >= startOfToday;
    }).length,
    expiring_soon: allCustomers.filter((c) => {
      return (
        c.status === 'ACTIVE' &&
        c.expiresAt &&
        c.expiresAt > now &&
        c.expiresAt <= sevenDaysFromNow
      );
    }).length,
    banned_lines: allCustomers.filter((c) => c.status === 'BANNED').length,
  };

  // Clientes recentes (últimos 10)
  const recentCustomers = allCustomers
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10)
    .map((c) => {
      const daysUntilExpiry = c.expiresAt
        ? Math.floor((c.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return {
        id: c.id,
        username: c.username,
        status: c.status,
        expires_at: c.expiresAt ? c.expiresAt.toISOString() : new Date().toISOString(),
        days_until_expiry: daysUntilExpiry,
      };
    });

  // Clientes vencendo em breve (próximos 7 dias)
  const expiringCustomers = allCustomers
    .filter((c) => {
      return (
        c.status === 'ACTIVE' &&
        c.expiresAt &&
        c.expiresAt > now &&
        c.expiresAt <= sevenDaysFromNow
      );
    })
    .sort((a, b) => {
      const aExp = a.expiresAt ? a.expiresAt.getTime() : 0;
      const bExp = b.expiresAt ? b.expiresAt.getTime() : 0;
      return aExp - bExp;
    })
    .slice(0, 20)
    .map((c) => {
      const daysUntilExpiry = c.expiresAt
        ? Math.floor((c.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return {
        id: c.id,
        username: c.username,
        expires_at: c.expiresAt ? c.expiresAt.toISOString() : new Date().toISOString(),
        days_until_expiry: daysUntilExpiry,
      };
    });

  // Clientes online (vazio por enquanto, pode ser implementado depois)
  const onlineCustomers: any[] = [];

  res.json({
    data: {
      stats,
      recentCustomers,
      expiringCustomers,
      onlineCustomers,
      server: null, // Não necessário mais, mas mantém compatibilidade
    },
  });
});

/**
 * GET /api/dashboard/stats
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Estatísticas do usuário
  const [customersCount, trialsToday, creditsTransactions] = await Promise.all([
    prisma.customer.count({ where: { resellerUserId: userId } }),
    prisma.customer.count({
      where: {
        resellerUserId: userId,
        isTrial: true,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  res.json({
    data: {
      customersCount,
      trialsToday,
      recentTransactions: creditsTransactions,
    },
  });
});