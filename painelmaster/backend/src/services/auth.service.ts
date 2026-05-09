import { prisma } from '../config/database.js';
import { hashPassword, comparePassword, generateAccessToken, generateRefreshToken, verifyRefreshToken, parseExpiry } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { XUIClient } from './xui.client.js';
import { logger } from '../utils/logger.js';

// Helper para obter cliente XUI do servidor padrão
async function getDefaultXuiClient(): Promise<XUIClient> {
  const server = await prisma.xuiServer.findFirst({
    where: { isDefault: true, isActive: true },
  }) || await prisma.xuiServer.findFirst({ where: { isActive: true } });
  
  if (!server) {
    throw new Error('Nenhum servidor XUI disponível');
  }
  
  return new XUIClient(server);
}
import { UnauthorizedError, ConflictError, NotFoundError } from '../middleware/error.middleware.js';
import type { User, UserRole } from '@prisma/client';

export interface LoginResult {
  user: {
    id: string;
    username: string;
    email: string | null;
    role: UserRole;
    credits: number;
  };
  accessToken: string;
  refreshToken: string;
}

export interface RegisterData {
  username: string;
  password: string;
  email?: string;
}

class AuthService {
  async login(username: string, password: string): Promise<LoginResult> {
    // Buscar usuário local
    let user = await prisma.user.findUnique({
      where: { username },
    });

    if (user) {
      // Verificar senha local
      const isValid = await comparePassword(password, user.password);
      if (!isValid) {
        throw new UnauthorizedError('Credenciais inválidas');
      }

      if (user.status !== 'ACTIVE') {
        throw new UnauthorizedError('Usuário inativo ou suspenso');
      }
    } else {
      // Usuário não encontrado - não criar automaticamente do XUI
      // (método loginReseller não implementado no XUI Client)
      throw new UnauthorizedError('Credenciais inválidas');
    }

    // Gerar tokens
    const tokenPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Salvar refresh token
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + parseExpiry(env.REFRESH_TOKEN_EXPIRES_IN)),
      },
    });

    // Atualizar último login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        credits: user.credits,
      },
      accessToken,
      refreshToken,
    };
  }

  async register(data: RegisterData): Promise<User> {
    // Verificar se username já existe
    const existing = await prisma.user.findUnique({
      where: { username: data.username },
    });

    if (existing) {
      throw new ConflictError('Username já existe');
    }

    // Criar usuário
    const user = await prisma.user.create({
      data: {
        username: data.username,
        password: await hashPassword(data.password),
        email: data.email || null,
        role: 'RESELLER',
        status: 'PENDING', // Aguarda aprovação
      },
    });

    logger.info(`Novo usuário registrado: ${data.username}`);

    return user;
  }

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Verificar token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedError('Refresh token inválido');
    }

    // Buscar token no banco
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token expirado');
    }

    if (storedToken.user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Usuário inativo');
    }

    // Revogar token antigo (rotation)
    await prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });

    // Gerar novos tokens
    const newPayload = {
      userId: storedToken.user.id,
      username: storedToken.user.username,
      role: storedToken.user.role,
    };

    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    // Salvar novo refresh token
    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: storedToken.user.id,
        expiresAt: new Date(Date.now() + parseExpiry(env.REFRESH_TOKEN_EXPIRES_IN)),
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  async getProfile(userId: string): Promise<User> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('Usuário');
    }

    return user;
  }

  async updateProfile(userId: string, data: { email?: string; password?: string }): Promise<User> {
    const updateData: Partial<User> = {};

    if (data.email) {
      updateData.email = data.email;
    }

    if (data.password) {
      updateData.password = await hashPassword(data.password);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return user;
  }

  // Mapear role do XUI para role local
  private mapXuiRole(xuiRole: string): UserRole {
    const roleMap: Record<string, UserRole> = {
      'admin': 'ADMIN',
      'master-reseller': 'MASTER_RESELLER',
      'reseller': 'RESELLER',
      'sub-reseller': 'SUBRESELLER',
    };

    return roleMap[xuiRole.toLowerCase()] || 'RESELLER';
  }

  // Limpar tokens expirados (chamar periodicamente)
  async cleanupExpiredTokens(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    if (result.count > 0) {
      logger.info(`Removidos ${result.count} refresh tokens expirados`);
    }

    return result.count;
  }
}

export const authService = new AuthService();

