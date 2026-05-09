import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError } from './error.middleware.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
        role: string;
        email: string;
      };
    }
  }
}

/**
 * Middleware de autenticação JWT
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Busca token no header Authorization ou no cookie
    let token = req.cookies?.accessToken;
    
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      throw new AppError(401, 'Token de autenticação não fornecido');
    }

    // Verifica token
    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      userId: string;
      username: string;
      role: string;
      email: string;
    };

    // Verifica se usuário ainda existe e está ativo
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, status: true, role: true },
    });

    if (!user) {
      throw new AppError(401, 'Usuário não encontrado');
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError(403, 'Usuário inativo ou banido');
    }

    // Atualiza role caso tenha mudado
    req.user = {
      ...decoded,
      role: user.role,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      next(new AppError(401, 'Token expirado'));
    } else if (error.name === 'JsonWebTokenError') {
      next(new AppError(401, 'Token inválido'));
    } else {
      next(error);
    }
  }
};

/**
 * Middleware para verificar role do usuário
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Não autenticado'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, 'Sem permissão para acessar este recurso'));
    }

    next();
  };
};

/**
 * Middleware para verificar se é admin
 */
export const adminOnly = requireRole('SUPER_ADMIN', 'ADMIN');

/**
 * Middleware para verificar se é master ou superior
 */
export const masterOrAbove = requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER');

/**
 * Verifica se o usuário pode gerenciar outro usuário
 */
export const canManageUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const currentUser = req.user!;
    const targetUserId = req.params.id;

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, parentId: true },
    });

    if (!targetUser) {
      throw new AppError(404, 'Usuário não encontrado');
    }

    // Super Admin pode tudo
    if (currentUser.role === 'SUPER_ADMIN') {
      return next();
    }

    // Admin pode gerenciar masters e revendas
    if (
      currentUser.role === 'ADMIN' &&
      ['MASTER_RESELLER', 'RESELLER'].includes(targetUser.role)
    ) {
      return next();
    }

    // Master pode gerenciar suas sub-revendas
    if (
      currentUser.role === 'MASTER_RESELLER' &&
      targetUser.parentId === currentUser.userId
    ) {
      return next();
    }

    throw new AppError(403, 'Sem permissão para gerenciar este usuário');
  } catch (error) {
    next(error);
  }
};
