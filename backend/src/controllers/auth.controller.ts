import { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AuthController');

// Schemas de validação
const loginSchema = z.object({
  username: z.string().min(1, 'Usuário é obrigatório'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

const registerSchema = z.object({
  username: z.string().min(3, 'Usuário deve ter no mínimo 3 caracteres'),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  name: z.string().optional(),
});

// Gera tokens JWT
function generateTokens(user: { id: string; username: string; email: string; role: string }) {
  const accessToken = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}

function normalizeMenuPermissions(raw: any): string | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0) return JSON.stringify(parsed);
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/login
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = loginSchema.parse(req.body);

  // Busca usuário
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { email: username }],
    },
    include: {
      accessGroup: { select: { menuPermissions: true } },
    },
  });

  if (!user) {
    throw new AppError(401, 'Usuário ou senha inválidos');
  }

  // Verifica status
  if (user.status !== 'ACTIVE') {
    throw new AppError(403, 'Conta desativada ou banida');
  }

  // Verifica senha
  const isValid = await verifyPassword(password, user.password);
  if (!isValid) {
    throw new AppError(401, 'Usuário ou senha inválidos');
  }

  // Gera tokens
  const { accessToken, refreshToken } = generateTokens({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  });

  // Salva refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshToken,
      lastLoginAt: new Date(),
      lastLoginIp: req.ip,
    },
  });

  // Log
  await prisma.actionLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN',
      entity: 'auth',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });

  logger.info(`Login: ${user.username} (${user.role})`);

  // Define cookie httpOnly para o token
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24, // 24 horas
  });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      credits: user.credits,
      billingType: user.billingType,
      dueDate: user.dueDate,
      customerPrice: user.customerPrice,
      billingCycleDays: user.billingCycleDays,
      isBlockedByBilling: user.isBlockedByBilling,
      menuPermissions: normalizeMenuPermissions((user as any).menuPermissions) ?? normalizeMenuPermissions((user as any).accessGroup?.menuPermissions),
      canCreateResellers: (user as any).canCreateResellers ?? false,
    },
    token: accessToken,
    message: 'Login realizado com sucesso',
  });
});

/**
 * POST /api/auth/register
 * Cria primeiro usuário (Super Admin) se não existir nenhum
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);

  // Verifica se já existe algum usuário
  const usersCount = await prisma.user.count();

  if (usersCount > 0) {
    throw new AppError(403, 'Registro público desabilitado');
  }

  // Verifica se username/email já existe
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: data.username }, { email: data.email }],
    },
  });

  if (existing) {
    throw new AppError(409, 'Usuário ou email já existe');
  }

  // Hash da senha
  const hashedPassword = await hashPassword(data.password);

  // Cria o primeiro usuário como SUPER_ADMIN
  const user = await prisma.user.create({
    data: {
      username: data.username,
      email: data.email,
      password: hashedPassword,
      name: data.name,
      role: 'SUPER_ADMIN',
      credits: 999999,
    },
  });

  logger.info(`Primeiro usuário (Super Admin) criado: ${user.username}`);

  res.status(201).json({
    message: 'Super Admin criado com sucesso',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  });
});

/**
 * POST /api/auth/logout
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.userId;

  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  res.clearCookie('accessToken');

  res.json({ message: 'Logout realizado com sucesso' });
});

/**
 * GET /api/auth/me
 * Retorna dados do usuário autenticado
 */
export const me = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      credits: true,
      billingType: true,
      dueDate: true,
      customerPrice: true,
      billingCycleDays: true,
      isBlockedByBilling: true,
      menuPermissions: true,
      canCreateResellers: true,
      whatsapp: true,
      telegram: true,
      createdAt: true,
      lastLoginAt: true,
      _count: {
        select: { customers: true },
      },
      accessGroup: { select: { menuPermissions: true } },
    },
  });

  if (!user) {
    throw new AppError(404, 'Usuário não encontrado');
  }

  res.json({
    data: {
      ...user,
      menuPermissions: normalizeMenuPermissions((user as any).menuPermissions) ?? normalizeMenuPermissions((user as any).accessGroup?.menuPermissions),
    },
  });
});

/**
 * POST /api/auth/refresh
 * Renova o access token usando o refresh token
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    throw new AppError(401, 'Refresh token não fornecido');
  }

  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string };

    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        refreshToken: token,
        status: 'ACTIVE',
      },
    });

    if (!user) {
      throw new AppError(401, 'Refresh token inválido');
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24,
    });

    res.json({
      token: accessToken,
      refreshToken: newRefreshToken,
    });
  } catch {
    throw new AppError(401, 'Refresh token inválido ou expirado');
  }
});

/**
 * PUT /api/auth/change-password
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { currentPassword, newPassword } = z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6),
    })
    .parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError(404, 'Usuário não encontrado');
  }

  const isValid = await verifyPassword(currentPassword, user.password);
  if (!isValid) {
    throw new AppError(401, 'Senha atual incorreta');
  }

  const hashedPassword = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  logger.info(`Senha alterada: ${user.username}`);

  res.json({ message: 'Senha alterada com sucesso' });
});
