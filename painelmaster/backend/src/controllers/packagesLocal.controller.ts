import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PackagesLocalController');

// Limite de conexões permitido para revendas (master e normal)
const RESELLER_MAX_CONNECTIONS = 2;
const RESELLER_ROLES = ['MASTER_RESELLER', 'RESELLER'] as const;

// Helper para converter string em número
const toNumber = (val: any, defaultVal: number = 0): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val.replace(',', '.'));
    return isNaN(parsed) ? defaultVal : parsed;
  }
  return defaultVal;
};

// Schemas de validação
const packageSchema = z.object({
  serverId: z.string().uuid().optional(),
  externalId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  duration: z.union([z.number(), z.string()]).transform(v => toNumber(v, 1)),
  durationUnit: z.enum(['HOURS', 'DAYS', 'MONTHS', 'YEARS']).optional(),
  credits: z.union([z.number(), z.string()]).transform(v => Math.floor(toNumber(v, 0))).optional(),
  planPrice: z.union([z.number(), z.string()]).transform(v => Math.floor(toNumber(v, 0))).optional(),
  isTrial: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional(),
  isActive: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
  connections: z.union([z.number(), z.string()]).transform(v => toNumber(v, 1)).optional(),
  maxConnections: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  bouquets: z.union([z.array(z.number()), z.string()]).transform(v => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch { return []; }
    }
    return [];
  }).optional(),
  template: z.string().optional().nullable(),
  templateXciptv: z.string().optional().nullable(),
  templateSimple: z.string().optional().nullable(),
  sortOrder: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional(),
  showOnDashboard: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true' || v === undefined).optional(),
});

/**
 * Monta o filtro `where` de visibilidade baseado no role do usuário.
 * - SUPER_ADMIN/ADMIN: vê tudo.
 * - MASTER_RESELLER: vê só os seus próprios pacotes.
 * - RESELLER: vê os seus + os do MASTER pai (parent).
 */
async function buildVisibilityWhere(user: { userId: string; role: string }): Promise<any> {
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return {};

  if (user.role === 'MASTER_RESELLER') {
    return { OR: [{ ownerId: user.userId }, { ownerId: null }] };
  }

  if (user.role === 'RESELLER') {
    const self = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { parentId: true },
    });
    const ids: string[] = [user.userId];
    if (self?.parentId) ids.push(self.parentId);
    return { OR: [{ ownerId: { in: ids } }, { ownerId: null }] };
  }

  // Fallback restritivo
  return { ownerId: user.userId };
}

/**
 * Verifica se o usuário pode editar/remover o pacote.
 * Regra: cada dono edita os seus.
 */
function canEditPackage(pkg: { ownerId: string | null }, user: { userId: string; role: string }): boolean {
  // Pacotes "de sistema" (ownerId null) só podem ser editados por SUPER_ADMIN/ADMIN
  if (pkg.ownerId == null) {
    return user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  }
  return pkg.ownerId === user.userId;
}

/**
 * Aplica limites de conexões quando o usuário é revenda.
 */
function enforceResellerLimits(data: {
  connections?: number;
  maxConnections?: number | null;
}, role: string): void {
  if ((RESELLER_ROLES as readonly string[]).includes(role)) {
    if (typeof data.connections === 'number' && data.connections > RESELLER_MAX_CONNECTIONS) {
      throw new AppError(400, `Revendas só podem criar pacotes com até ${RESELLER_MAX_CONNECTIONS} conexões`);
    }
    if (typeof data.maxConnections === 'number' && data.maxConnections > RESELLER_MAX_CONNECTIONS) {
      throw new AppError(400, `Revendas só podem criar pacotes com limite máximo de até ${RESELLER_MAX_CONNECTIONS} conexões`);
    }
  }
}

/**
 * GET /api/packages-local
 */
export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { serverId, isTrial, isActive } = req.query;

  const where: any = await buildVisibilityWhere(currentUser);
  if (serverId) where.serverId = serverId;
  if (isTrial !== undefined) where.isTrial = isTrial === 'true';
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const packages = await prisma.package.findMany({
    where,
    include: {
      server: { select: { id: true, name: true } },
      _count: { select: { customers: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const formatted = packages.map(pkg => ({
    ...pkg,
    bouquets: pkg.bouquets ? JSON.parse(pkg.bouquets) : [],
    planPriceFormatted: (pkg.planPrice / 100).toFixed(2),
    durationText: `${pkg.duration} ${pkg.durationUnit.toLowerCase()}`,
    canEdit: canEditPackage(pkg, currentUser),
  }));

  res.json({ data: formatted });
});

/**
 * GET /api/packages-local/:id
 */
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { id } = req.params;

  const pkg = await prisma.package.findUnique({
    where: { id },
    include: { server: { select: { id: true, name: true } } },
  });

  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  // Verifica visibilidade
  const visibility = await buildVisibilityWhere(currentUser);
  if (visibility.ownerId !== undefined) {
    if (typeof visibility.ownerId === 'string') {
      if (pkg.ownerId !== visibility.ownerId) throw new AppError(403, 'Acesso negado');
    } else if (visibility.ownerId?.in && !visibility.ownerId.in.includes(pkg.ownerId)) {
      throw new AppError(403, 'Acesso negado');
    }
  }

  res.json({
    data: {
      ...pkg,
      bouquets: pkg.bouquets ? JSON.parse(pkg.bouquets) : [],
      canEdit: canEditPackage(pkg, currentUser),
    },
  });
});

/**
 * POST /api/packages-local
 */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = packageSchema.parse(req.body);
  const currentUser = req.user!;

  // Valida servidor
  const server = await prisma.xuiServer.findUnique({ where: { id: data.serverId } });
  if (!server) throw new AppError(404, 'Servidor não encontrado');

  // Aplica limites para revendas
  enforceResellerLimits(
    { connections: data.connections, maxConnections: data.maxConnections ?? undefined },
    currentUser.role,
  );

  const pkg = await prisma.package.create({
    data: {
      serverId: data.serverId!,
      externalId: data.externalId!,
      name: data.name,
      description: data.description,
      duration: data.duration,
      durationUnit: data.durationUnit,
      credits: data.credits,
      planPrice: data.planPrice,
      isTrial: data.isTrial,
      isActive: data.isActive,
      connections: data.connections,
      maxConnections: data.maxConnections,
      bouquets: data.bouquets ? JSON.stringify(data.bouquets) : null,
      template: data.template,
      templateXciptv: data.templateXciptv,
      templateSimple: data.templateSimple,
      sortOrder: data.sortOrder,
      showOnDashboard: data.showOnDashboard,
      ownerId: currentUser.userId,
    },
  });

  logger.info(`Pacote "${data.name}" criado por ${currentUser.username} (${currentUser.role})`);

  res.status(201).json({ data: pkg });
});

/**
 * PUT /api/packages-local/:id
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user!;
  const data = packageSchema.partial().parse(req.body);

  const pkg = await prisma.package.findUnique({ where: { id } });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  if (!canEditPackage(pkg, currentUser)) {
    throw new AppError(403, 'Você não tem permissão para editar este pacote');
  }

  enforceResellerLimits(
    { connections: data.connections, maxConnections: data.maxConnections ?? undefined },
    currentUser.role,
  );

  const updateData: any = { ...data };
  if (data.bouquets) updateData.bouquets = JSON.stringify(data.bouquets);

  const updated = await prisma.package.update({
    where: { id },
    data: updateData,
  });

  res.json({ data: updated });
});

/**
 * DELETE /api/packages-local/:id
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user!;

  const pkg = await prisma.package.findUnique({ where: { id } });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  if (!canEditPackage(pkg, currentUser)) {
    throw new AppError(403, 'Você não tem permissão para remover este pacote');
  }

  await prisma.package.delete({ where: { id } });
  res.json({ message: 'Pacote removido com sucesso' });
});

/**
 * GET /api/packages-local/for-select
 */
export const getForSelect = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { serverId, includeTrials = 'false' } = req.query;

  const where: any = await buildVisibilityWhere(currentUser);
  where.isActive = true;
  if (serverId) where.serverId = serverId;
  if (includeTrials !== 'true') where.isTrial = false;

  const packages = await prisma.package.findMany({
    where,
    select: {
      id: true,
      externalId: true,
      name: true,
      duration: true,
      durationUnit: true,
      credits: true,
      planPrice: true,
      isTrial: true,
      connections: true,
      server: { select: { name: true } },
    },
    orderBy: [{ isTrial: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });

  const formatted = packages.map(pkg => ({
    value: pkg.id,
    label: `${pkg.name} (${pkg.duration} ${pkg.durationUnit.toLowerCase()})`,
    serverName: pkg.server.name,
    credits: pkg.credits,
    planPrice: pkg.planPrice,
    isTrial: pkg.isTrial,
    connections: pkg.connections,
    externalId: pkg.externalId,
  }));

  res.json({ data: formatted });
});

/**
 * GET /api/packages-local/trials
 */
export const getTrials = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const { serverId } = req.query;

  const where: any = await buildVisibilityWhere(currentUser);
  where.isTrial = true;
  where.isActive = true;
  if (serverId) where.serverId = serverId;

  const packages = await prisma.package.findMany({
    where,
    include: { server: { select: { id: true, name: true } } },
    orderBy: [{ duration: 'asc' }],
  });

  res.json({ data: packages });
});
