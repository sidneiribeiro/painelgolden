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
  const freshAfter = new Date(now.getTime() - 90_000);

  // Construir where clause baseado no role do usuário
  const where: any = {};
  if (!['SUPER_ADMIN', 'ADMIN'].includes(currentUser.role)) {
    where.resellerUserId = currentUser.userId;
  }

  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser.role);
  const coreOwnerWhere = isAdmin ? {} : { ownerId: currentUser.userId };

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

  const coreLines = await prisma.coreLine
    .findMany({
      where: coreOwnerWhere,
      select: { id: true, username: true, status: true, expiresAt: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }],
    })
    .catch(() => [] as Array<{ id: string; username: string; status: string; expiresAt: Date; createdAt: Date }>);

  const unifiedLines = [
    ...allCustomers.map((c) => ({
      id: c.id,
      username: c.username,
      status: c.status,
      expiresAt: c.expiresAt || now,
      createdAt: c.createdAt,
      isTrial: !!c.isTrial,
    })),
    ...coreLines.map((l) => {
      const expired = l.expiresAt && l.expiresAt <= now;
      const mappedStatus = expired ? 'EXPIRED' : l.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
      return {
        id: l.id,
        username: l.username,
        status: mappedStatus,
        expiresAt: l.expiresAt || now,
        createdAt: l.createdAt,
        isTrial: false,
      };
    }),
  ];

  // Calcular estatísticas baseado no banco local (Clientes XUI + Linhas Core)
  const stats = {
    total_lines: unifiedLines.length,
    active_lines: unifiedLines.filter((c) => c.status === 'ACTIVE' && c.expiresAt && c.expiresAt > now).length,
    expired_lines: unifiedLines.filter((c) => c.status === 'EXPIRED' || (c.expiresAt && c.expiresAt <= now)).length,
    online_lines: 0, // Pode ser implementado depois com conexões ao vivo
    offline_lines: 0, // Pode ser implementado depois
    trials_today: unifiedLines.filter((c) => c.isTrial && c.createdAt && c.createdAt >= startOfToday).length,
    expiring_soon: unifiedLines.filter((c) => c.status === 'ACTIVE' && c.expiresAt && c.expiresAt > now && c.expiresAt <= sevenDaysFromNow).length,
    banned_lines: unifiedLines.filter((c) => c.status === 'BANNED' || c.status === 'DISABLED').length,
  };

  // Clientes recentes (últimos 10) - unificado
  const recentCustomers = unifiedLines
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
        expires_at: c.expiresAt ? c.expiresAt.toISOString() : now.toISOString(),
        days_until_expiry: daysUntilExpiry,
      };
    });

  // Clientes vencendo em breve (próximos 7 dias) - unificado
  const expiringCustomers = unifiedLines
    .filter((c) => c.status === 'ACTIVE' && c.expiresAt && c.expiresAt > now && c.expiresAt <= sevenDaysFromNow)
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
        expires_at: c.expiresAt ? c.expiresAt.toISOString() : now.toISOString(),
        days_until_expiry: daysUntilExpiry,
      };
    });

  // Clientes online (vazio por enquanto, pode ser implementado depois)
  const onlineCustomers: any[] = [];

  const [coreEdgeServers, coreSessions] = await Promise.all([
    prisma.coreEdgeServer
      .findMany({
        where: { ...coreOwnerWhere, isActive: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          name: true,
          domain: true,
          ip: true,
          httpPort: true,
          httpsPort: true,
          installedAt: true,
          createdAt: true,
          isActive: true,
        },
      })
      .catch(() => [] as any[]),
    prisma.corePlaybackSession
      .findMany({
        where: {
          endedAt: null,
          status: 'active',
          lastSeenAt: { gt: freshAfter },
          line: coreOwnerWhere,
        },
        select: {
          id: true,
          contentType: true,
          contentPublicId: true,
          serverHost: true,
          ipAddress: true,
          userAgent: true,
          startedAt: true,
          lastSeenAt: true,
          line: { select: { username: true } },
        },
        orderBy: [{ lastSeenAt: 'desc' }],
        take: 20,
      })
      .catch(() => [] as any[]),
  ]);

  const liveIds = Array.from(
    new Set(coreSessions.filter((s) => s.contentType === 'live' && typeof s.contentPublicId === 'number').map((s) => s.contentPublicId as number))
  );
  const movieIds = Array.from(
    new Set(coreSessions.filter((s) => s.contentType === 'movie' && typeof s.contentPublicId === 'number').map((s) => s.contentPublicId as number))
  );
  const seriesIds = Array.from(
    new Set(coreSessions.filter((s) => s.contentType === 'series' && typeof s.contentPublicId === 'number').map((s) => s.contentPublicId as number))
  );

  const [liveStreams, movies, seriesEpisodes] = await Promise.all([
    liveIds.length
      ? prisma.coreStream.findMany({ where: { publicId: { in: liveIds } }, select: { publicId: true, name: true } }).catch(() => [])
      : Promise.resolve([] as any[]),
    movieIds.length
      ? prisma.coreVodItem.findMany({ where: { publicId: { in: movieIds } }, select: { publicId: true, name: true } }).catch(() => [])
      : Promise.resolve([] as any[]),
    seriesIds.length
      ? prisma.coreSeriesEpisode.findMany({ where: { publicId: { in: seriesIds } }, select: { publicId: true, title: true } }).catch(() => [])
      : Promise.resolve([] as any[]),
  ]);

  const liveNameById = new Map(liveStreams.map((s: any) => [s.publicId, s.name] as const));
  const movieNameById = new Map(movies.map((s: any) => [s.publicId, s.name] as const));
  const seriesNameById = new Map(seriesEpisodes.map((s: any) => [s.publicId, s.title] as const));

  res.json({
    data: {
      stats,
      recentCustomers,
      expiringCustomers,
      onlineCustomers,
      core: {
        balances: coreEdgeServers.map((s: any) => ({
          id: s.id,
          name: s.name,
          host: (s.domain || s.ip || '').trim() || null,
          httpPort: s.httpPort,
          httpsPort: s.httpsPort,
          installedAt: s.installedAt,
          createdAt: s.createdAt,
          isActive: s.isActive,
        })),
        liveConnections: coreSessions.map((s: any) => {
          let contentName: string | null = null;
          if (s.contentType === 'live') contentName = typeof s.contentPublicId === 'number' ? liveNameById.get(s.contentPublicId) || null : null;
          if (s.contentType === 'movie') contentName = typeof s.contentPublicId === 'number' ? movieNameById.get(s.contentPublicId) || null : null;
          if (s.contentType === 'series') contentName = typeof s.contentPublicId === 'number' ? seriesNameById.get(s.contentPublicId) || null : null;
          return {
            id: s.id,
            username: s.line?.username || null,
            contentType: s.contentType,
            contentPublicId: s.contentPublicId ?? null,
            contentName,
            serverHost: s.serverHost || null,
            ipAddress: s.ipAddress || null,
            userAgent: s.userAgent || null,
            startedAt: s.startedAt,
            lastSeenAt: s.lastSeenAt,
          };
        }),
      },
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
