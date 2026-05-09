import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { hashPassword } from '../utils/crypto.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UsersController');

// Helper para converter valores
const toNumber = (val: any, defaultVal: number = 0): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? defaultVal : parsed;
  }
  return defaultVal;
};

const toBool = (val: any): boolean => {
  return val === true || val === 'true' || val === '1' || val === 1;
};

// Schemas de validação - mais flexíveis
const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email().optional().nullable().or(z.literal('')),
  password: z.string().min(6),
  name: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  telegram: z.string().optional().nullable(),
  role: z.enum(['ADMIN', 'MASTER_RESELLER', 'RESELLER']),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BANNED']).default('ACTIVE'),
  credits: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional(),
  parentId: z.string().uuid().optional().nullable(),
  accessGroupId: z.string().uuid().optional().nullable(),
  canCreateResellers: z.union([z.boolean(), z.string()]).transform(toBool).optional(),
  maxSubResellers: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  commissionPercent: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional(),
  maxTrialsPerDay: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  maxCustomers: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  trialHoursAllowed: z.union([
    z.array(z.number()),
    z.string().transform(v => v.split(',').map(Number).filter(n => !isNaN(n))),
  ]).optional(),
  allowedPackages: z.union([
    z.array(z.string()),
    z.string().transform(v => { try { return JSON.parse(v); } catch { return []; } }),
  ]).optional().nullable(),
  allowedServers: z.union([
    z.array(z.string()),
    z.string().transform(v => { try { return JSON.parse(v); } catch { return []; } }),
  ]).optional().nullable(),
  // Campos de cobrança
  billingType: z.enum(['PREPAID', 'POSTPAID']).optional(),
  dueDate: z.string().optional().nullable(),
  customerPrice: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional().nullable(),
  billingCycleDays: z.union([z.number(), z.string()]).transform(v => toNumber(v, 30)).optional(),
  menuPermissions: z.union([z.array(z.string()), z.string()]).optional().nullable(),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  password: z.string().min(6).optional(),
  name: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  telegram: z.string().optional().nullable(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BANNED']).optional(),
  credits: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional(),
  accessGroupId: z.string().uuid().optional().nullable(),
  canCreateResellers: z.union([z.boolean(), z.string()]).transform(toBool).optional(),
  maxSubResellers: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  commissionPercent: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional(),
  maxTrialsPerDay: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  maxCustomers: z.union([z.number(), z.string()]).transform(v => toNumber(v)).optional().nullable(),
  trialHoursAllowed: z.union([
    z.array(z.number()),
    z.string().transform(v => v.split(',').map(Number).filter(n => !isNaN(n))),
  ]).optional(),
  allowedPackages: z.union([
    z.array(z.string()),
    z.string().transform(v => { try { return JSON.parse(v); } catch { return []; } }),
  ]).optional().nullable(),
  allowedServers: z.union([
    z.array(z.string()),
    z.string().transform(v => { try { return JSON.parse(v); } catch { return []; } }),
  ]).optional().nullable(),
  // Campos de cobrança
  billingType: z.enum(['PREPAID', 'POSTPAID']).optional(),
  dueDate: z.string().optional().nullable(),
  customerPrice: z.union([z.number(), z.string()]).transform(v => toNumber(v, 0)).optional().nullable(),
  billingCycleDays: z.union([z.number(), z.string()]).transform(v => toNumber(v, 30)).optional(),
  menuPermissions: z.union([z.array(z.string()), z.string()]).optional().nullable(),
});

const accessGroupSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(200).optional().nullable(),
  menuPermissions: z.array(z.string()).optional().nullable(),
});

function normalizeMenuPermissionsForStorage(raw: any): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0) return JSON.stringify(parsed);
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/users
 * Lista todos os usuários
 */
export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, perPage = 20, role, status, search, parentId, sortBy, sortDir } = req.query;

  const where: any = {};
  const currentUser = req.user!;

  const isAdmin = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN';

  // Filtro por role
  if (role) {
    where.role = role;
  }

  // Filtro por status
  if (status) {
    where.status = status;
  }

  // Busca por username, email ou nome
  if (search) {
    where.OR = [
      { username: { contains: search as string } },
      { email: { contains: search as string } },
      { name: { contains: search as string } },
    ];
  }

  // SUPER_ADMIN vê TODOS os usuários (sem restrições de hierarquia)
  // Apenas aplica filtros opcionais se não for SUPER_ADMIN
  if (currentUser.role !== 'SUPER_ADMIN') {
    // MASTER_RESELLER vê a si mesmo + seus filhos (revendas e master revendas)
    if (currentUser.role === 'MASTER_RESELLER') {
      where.OR = [{ id: currentUser.userId }, { parentId: currentUser.userId }];
    }
    // RESELLER vê a si mesmo + seus filhos (revendas)
    else if (currentUser.role === 'RESELLER') {
      where.OR = [{ id: currentUser.userId }, { parentId: currentUser.userId }];
    }
    // Se especificou parentId (e não é SUPER_ADMIN)
    else if (parentId) {
      where.parentId = parentId;
    }

    // Admin e Master não veem Super Admins
    if (['ADMIN', 'MASTER_RESELLER'].includes(currentUser.role)) {
      where.role = { not: 'SUPER_ADMIN' };
    }

    // Revendas e master revendas não podem listar ADMIN/SUPER_ADMIN (mesmo se mandarem filtro)
    if (!isAdmin) {
      where.role = { in: ['MASTER_RESELLER', 'RESELLER'] };
    }
  } else {
    // SUPER_ADMIN pode especificar parentId como filtro opcional, mas não é obrigatório
    if (parentId) {
      where.parentId = parentId;
    }
  }

  const canViewUserPermissions = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN';
  const userSelect: any = {
    id: true,
    username: true,
    email: true,
    name: true,
    whatsapp: true,
    role: true,
    status: true,
    credits: true,
    parentId: true,
    lastLoginAt: true,
    billingType: true,
    dueDate: true,
    customerPrice: true,
    isBlockedByBilling: true,
    createdAt: true,
    _count: {
      select: { customers: true, children: true },
    },
    parent: {
      select: { username: true },
    },
    ...(canViewUserPermissions
      ? {
          accessGroupId: true,
          accessGroup: { select: { id: true, name: true } },
          canCreateResellers: true,
          maxSubResellers: true,
          commissionPercent: true,
          maxTrialsPerDay: true,
          maxCustomers: true,
          trialHoursAllowed: true,
          allowedPackages: true,
          allowedServers: true,
          menuPermissions: true,
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: (() => {
        const allowed = ['username', 'name', 'email', 'credits', 'status', 'role', 'createdAt', 'lastLoginAt', 'dueDate'];
        if (sortBy && allowed.includes(sortBy as string)) {
          return { [sortBy as string]: sortDir === 'asc' ? 'asc' : 'desc' };
        }
        return { createdAt: 'desc' as const };
      })(),
      skip: (Number(page) - 1) * Number(perPage),
      take: Number(perPage),
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    data: users,
    meta: {
      current_page: Number(page),
      per_page: Number(perPage),
      total,
      last_page: Math.ceil(total / Number(perPage)),
    },
  });
});

/**
 * GET /api/users/:id
 */
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user!;

  const canViewUserPermissions = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN';
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      whatsapp: true,
      telegram: true,
      role: true,
      status: true,
      credits: true,
      creditsReadonly: true,
      parentId: true,
      maxTrialsPerDay: true,
      maxCustomers: true,
      trialHoursAllowed: true,
      billingType: true,
      dueDate: true,
      customerPrice: true,
      billingCycleDays: true,
      isBlockedByBilling: true,
      lastLoginAt: true,
      createdAt: true,
      _count: {
        select: { customers: true, children: true },
      },
      ...(canViewUserPermissions
        ? {
            accessGroupId: true,
            accessGroup: { select: { id: true, name: true } },
            canCreateResellers: true,
            maxSubResellers: true,
            commissionPercent: true,
            allowedPackages: true,
            allowedServers: true,
            menuPermissions: true,
          }
        : {}),
    },
  });

  if (!user) {
    throw new AppError(404, 'Usuário não encontrado');
  }

  // Verifica permissões para ver este usuário
  if (user.role === 'SUPER_ADMIN' && currentUser.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Sem permissão para visualizar Super Admin');
  }

  // MASTER_RESELLER só pode ver seus revendas
  if (currentUser.role === 'MASTER_RESELLER') {
    if (user.id !== currentUser.userId && user.parentId !== currentUser.userId) {
      throw new AppError(403, 'Sem permissão para visualizar este usuário');
    }
  }

  // RESELLER pode ver a si mesmo + seus filhos (revendas/master revendas)
  if (currentUser.role === 'RESELLER') {
    const isSelf = user.id === currentUser.userId;
    const isChild = user.parentId === currentUser.userId && ['RESELLER', 'MASTER_RESELLER'].includes(user.role);
    if (!isSelf && !isChild) throw new AppError(403, 'Sem permissão para visualizar este usuário');
  }

  res.json({ data: user });
});

/**
 * POST /api/users
 * Cria novo usuário
 */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = createUserSchema.parse(req.body);
  const currentUser = req.user!;
  const canManageUserPermissions = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN';

  // Verifica permissões para criar o role
  if (data.role === 'ADMIN' && currentUser.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Apenas Super Admin pode criar Admins');
  }

  if (data.role === 'MASTER_RESELLER' && !['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'].includes(currentUser.role)) {
    throw new AppError(403, 'Sem permissão para criar Master Revenda');
  }

  if (currentUser.role === 'RESELLER' && data.role !== 'RESELLER') {
    throw new AppError(403, 'Revenda só pode criar Revendas');
  }

  // Verifica se username/email já existe
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: data.username }, ...(data.email ? [{ email: data.email }] : [])],
    },
  });

  if (existing) {
    throw new AppError(409, 'Usuário ou email já existe');
  }

  // Hash da senha
  const hashedPassword = await hashPassword(data.password);

  // Define o parent
  let parentId: string | null = null;
  if (['RESELLER', 'MASTER_RESELLER'].includes(data.role)) {
    if (['MASTER_RESELLER', 'RESELLER'].includes(currentUser.role)) {
      parentId = currentUser.userId;
    } else if (currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN') {
      parentId = data.parentId || currentUser.userId;
    }

    if (parentId) {
      const parent = await prisma.user.findUnique({
        where: { id: parentId },
        select: { id: true, role: true },
      });
      if (!parent) {
        throw new AppError(400, 'Revendedor pai não encontrado');
      }
      if (!['SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'].includes(parent.role)) {
        throw new AppError(400, 'Revendedor pai inválido');
      }
      if (currentUser.role === 'ADMIN' && parent.role === 'SUPER_ADMIN') {
        throw new AppError(403, 'Sem permissão para vincular a um Super Admin');
      }
    }
  }

  const canCreateResellers =
    canManageUserPermissions ? data.canCreateResellers : ['MASTER_RESELLER', 'RESELLER'].includes(data.role);

  const user = await prisma.user.create({
    data: {
      username: data.username,
      email: data.email || `${data.username}@placeholder.local`,
      password: hashedPassword,
      name: data.name,
      whatsapp: data.whatsapp,
      telegram: data.telegram,
      role: data.role,
      status: data.status,
      credits: data.credits,
      parentId,
      accessGroupId: canManageUserPermissions ? (data.accessGroupId || null) : undefined,
      canCreateResellers,
      maxSubResellers: canManageUserPermissions ? data.maxSubResellers : undefined,
      commissionPercent: canManageUserPermissions ? data.commissionPercent : undefined,
      maxTrialsPerDay: data.maxTrialsPerDay,
      maxCustomers: data.maxCustomers,
      trialHoursAllowed: data.trialHoursAllowed ? data.trialHoursAllowed.join(',') : undefined,
      allowedPackages: canManageUserPermissions ? (data.allowedPackages ? JSON.stringify(data.allowedPackages) : null) : null,
      allowedServers: canManageUserPermissions ? (data.allowedServers ? JSON.stringify(data.allowedServers) : null) : null,
      billingType: data.billingType,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      customerPrice: data.customerPrice,
      billingCycleDays: data.billingCycleDays,
      menuPermissions: canManageUserPermissions
        ? normalizeMenuPermissionsForStorage(data.menuPermissions)
        : null,
    },
  });

  // Log de ação
  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: 'CREATE_USER',
      entity: 'user',
      entityId: user.id,
      details: JSON.stringify({ username: data.username, role: data.role }),
      ip: req.ip,
    },
  });

  logger.info(`Usuário "${data.username}" criado por ${currentUser.username}`);

  res.status(201).json({
    data: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  });
});

/**
 * PUT /api/users/:id
 */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = updateUserSchema.parse(req.body);
  const currentUser = req.user!;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError(404, 'Usuário não encontrado');
  }

  // Verifica permissão para editar
  if (user.role === 'SUPER_ADMIN' && currentUser.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Não pode editar Super Admin');
  }

  // MASTER_RESELLER só pode editar seus revendas
  if (currentUser.role === 'MASTER_RESELLER') {
    if (user.id !== currentUser.userId && user.parentId !== currentUser.userId) {
      throw new AppError(403, 'Sem permissão para editar este usuário');
    }
    // Master não pode editar role (só SUPER_ADMIN e ADMIN podem)
    if (data.role && data.role !== user.role) {
      throw new AppError(403, 'Master Reseller não pode alterar roles');
    }
  }

  // RESELLER pode editar a si mesmo + seus filhos (sem alterar role/créditos)
  if (currentUser.role === 'RESELLER') {
    const isSelf = user.id === currentUser.userId;
    const isChild = user.parentId === currentUser.userId && ['RESELLER', 'MASTER_RESELLER'].includes(user.role);
    if (!isSelf && !isChild) throw new AppError(403, 'Sem permissão para editar este usuário');
    if (data.role || data.credits !== undefined) {
      throw new AppError(403, 'Revenda não pode alterar role ou créditos');
    }
    if (isSelf && data.status) {
      throw new AppError(403, 'Revenda não pode alterar o próprio status');
    }
  }

  const updateData: any = {};
  const canManageUserPermissions = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN';

  if (data.email) updateData.email = data.email;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.whatsapp !== undefined) updateData.whatsapp = data.whatsapp;
  if (data.telegram !== undefined) updateData.telegram = data.telegram;
  if (data.role) updateData.role = data.role;
  if (data.status) updateData.status = data.status;
  if (data.password) updateData.password = await hashPassword(data.password);
  if (canManageUserPermissions) {
    if (data.accessGroupId !== undefined) updateData.accessGroupId = data.accessGroupId || null;
    if (data.canCreateResellers !== undefined) updateData.canCreateResellers = data.canCreateResellers;
    if (data.maxSubResellers !== undefined) updateData.maxSubResellers = data.maxSubResellers;
    if (data.commissionPercent !== undefined) updateData.commissionPercent = data.commissionPercent;
  }
  if (data.maxTrialsPerDay !== undefined) updateData.maxTrialsPerDay = data.maxTrialsPerDay;
  if (data.maxCustomers !== undefined) updateData.maxCustomers = data.maxCustomers;
  if (data.trialHoursAllowed) updateData.trialHoursAllowed = data.trialHoursAllowed.join(',');
  if (canManageUserPermissions) {
    if (data.allowedPackages) updateData.allowedPackages = JSON.stringify(data.allowedPackages);
    if (data.allowedServers) updateData.allowedServers = JSON.stringify(data.allowedServers);
  }
  // Campos de cobrança
  if (data.billingType !== undefined) updateData.billingType = data.billingType;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.customerPrice !== undefined) updateData.customerPrice = data.customerPrice;
  if (data.billingCycleDays !== undefined) updateData.billingCycleDays = data.billingCycleDays;
  if (canManageUserPermissions) {
    if (data.menuPermissions !== undefined) updateData.menuPermissions = normalizeMenuPermissionsForStorage(data.menuPermissions);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
  });

  res.json({ data: updated });
});

/**
 * DELETE /api/users/:id
 */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user!;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError(404, 'Usuário não encontrado');
  }

  if (user.role === 'SUPER_ADMIN') {
    throw new AppError(403, 'Não pode remover Super Admin');
  }

  if (user.id === currentUser.userId) {
    throw new AppError(403, 'Não pode remover a si mesmo');
  }

  // MASTER_RESELLER só pode remover seus próprios sub-revendedores
  if (currentUser.role === 'MASTER_RESELLER' && user.parentId !== currentUser.userId) {
    throw new AppError(403, 'Você só pode remover revendedores que você criou');
  }

  await prisma.user.delete({ where: { id } });

  logger.info(`Usuário "${user.username}" removido por ${currentUser.username}`);

  res.json({ message: 'Usuário removido com sucesso' });
});

/**
 * POST /api/users/:id/credits
 * Adiciona ou remove créditos
 */
export const modifyCredits = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, description } = z.object({
    amount: z.number().int(),
    description: z.string().optional(),
  }).parse(req.body);

  const currentUser = req.user!;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError(404, 'Usuário não encontrado');
  }

  if (user.creditsReadonly) {
    throw new AppError(403, 'Créditos deste usuário estão bloqueados');
  }

  const newCredits = user.credits + amount;
  if (newCredits < 0) {
    throw new AppError(400, 'Créditos insuficientes');
  }

  // Atualiza créditos
  const updated = await prisma.user.update({
    where: { id },
    data: { credits: newCredits },
  });

  // Registra transação
  await prisma.creditTransaction.create({
    data: {
      userId: id,
      type: amount > 0 ? 'ADMIN_ADD' : 'ADMIN_REMOVE',
      amount,
      balanceBefore: user.credits,
      balanceAfter: newCredits,
      description: description || `${amount > 0 ? 'Adição' : 'Remoção'} de créditos por ${currentUser.username}`,
    },
  });

  // Log
  await prisma.actionLog.create({
    data: {
      userId: currentUser.userId,
      action: amount > 0 ? 'ADD_CREDITS' : 'REMOVE_CREDITS',
      entity: 'user',
      entityId: id,
      details: JSON.stringify({ amount, newBalance: newCredits }),
      ip: req.ip,
    },
  });

  logger.info(`${amount > 0 ? 'Adicionados' : 'Removidos'} ${Math.abs(amount)} créditos de "${user.username}"`);

  res.json({
    data: updated,
    message: `Créditos ${amount > 0 ? 'adicionados' : 'removidos'} com sucesso`,
  });
});

/**
 * GET /api/users/:id/transactions
 * Histórico de transações de créditos
 */
export const getTransactions = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { page = 1, perPage = 20 } = req.query;

  const [transactions, total] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(perPage),
      take: Number(perPage),
    }),
    prisma.creditTransaction.count({ where: { userId: id } }),
  ]);

  res.json({
    data: transactions,
    meta: {
      current_page: Number(page),
      per_page: Number(perPage),
      total,
      last_page: Math.ceil(total / Number(perPage)),
    },
  });
});

export const listAccessGroups = asyncHandler(async (req: Request, res: Response) => {
  const groups = await prisma.accessGroup.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      menuPermissions: true,
      _count: { select: { users: true } },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json({ data: groups });
});

export const createAccessGroup = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  const data = accessGroupSchema.parse(req.body);

  const existing = await prisma.accessGroup.findUnique({ where: { name: data.name } });
  if (existing) throw new AppError(409, 'Já existe um grupo com esse nome');

  const group = await prisma.accessGroup.create({
    data: {
      name: data.name,
      description: data.description || null,
      menuPermissions: normalizeMenuPermissionsForStorage(data.menuPermissions),
      createdById: currentUser.userId,
    },
    select: { id: true, name: true, description: true, menuPermissions: true, createdAt: true, updatedAt: true },
  });

  res.status(201).json({ data: group });
});

export const updateAccessGroup = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const data = accessGroupSchema.partial().parse(req.body);

  const group = await prisma.accessGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new AppError(404, 'Grupo não encontrado');

  if (data.name && data.name !== group.name) {
    const existing = await prisma.accessGroup.findUnique({ where: { name: data.name } });
    if (existing) throw new AppError(409, 'Já existe um grupo com esse nome');
  }

  const updated = await prisma.accessGroup.update({
    where: { id: groupId },
    data: {
      name: data.name ?? undefined,
      description: data.description === undefined ? undefined : (data.description || null),
      menuPermissions: data.menuPermissions === undefined ? undefined : normalizeMenuPermissionsForStorage(data.menuPermissions),
    },
    select: { id: true, name: true, description: true, menuPermissions: true, createdAt: true, updatedAt: true },
  });

  res.json({ data: updated });
});

export const removeAccessGroup = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.params;

  const group = await prisma.accessGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new AppError(404, 'Grupo não encontrado');

  await prisma.accessGroup.delete({ where: { id: groupId } });
  res.json({ message: 'Grupo removido com sucesso' });
});
