/**
 * Rotas para criação de linhas usando o serviço robusto
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { LineCreatorService } from '../services/lineCreator.service.js';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('LineCreatorRoutes');

/**
 * POST /api/v2/customers
 * Criar cliente usando o novo serviço robusto
 */
router.post('/customers', authMiddleware, asyncHandler(async (req, res) => {
  const currentUser = (req as any).user;
  
  const {
    server_id,
    package_id,
    connections,
    trial_hours,
    expires_at,
    name,
    email,
    whatsapp,
    bouquets,
  } = req.body;
  
  logger.info('[POST /v2/customers] Request:', {
    server_id,
    package_id,
    connections,
    trial_hours,
    userId: currentUser.userId,
  });
  
  // Validação
  if (!server_id || !package_id) {
    return res.status(400).json({
      error: 'server_id e package_id são obrigatórios',
    });
  }
  
  // Verificar créditos
  const pkg = await prisma.package.findUnique({
    where: { id: package_id },
  });
  
  if (!pkg) {
    return res.status(404).json({ error: 'Pacote não encontrado' });
  }
  
  if (pkg.credits > 0) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.userId },
    });
    
    if (!user || user.credits < pkg.credits) {
      return res.status(400).json({
        error: 'Créditos insuficientes',
        required: pkg.credits,
        available: user?.credits || 0,
      });
    }
  }
  
  // Criar linha usando o serviço robusto
  const result = await LineCreatorService.createLine({
    serverId: server_id,
    packageId: package_id,
    resellerUserId: currentUser.userId,
    connections: connections || 1,
    trialHours: trial_hours,
    customExpiresAt: expires_at ? new Date(expires_at) : undefined,
    name,
    email,
    whatsapp,
    customBouquets: bouquets,
  });
  
  if (!result.success) {
    return res.status(500).json({
      error: result.error,
      debug: result.debugPayload,
    });
  }
  
  // Debitar créditos
  if (pkg.credits > 0) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.userId },
    });
    
    if (user) {
      await prisma.user.update({
        where: { id: currentUser.userId },
        data: { credits: { decrement: pkg.credits } },
      });
      
      await prisma.creditTransaction.create({
        data: {
          userId: currentUser.userId,
          type: 'SALE',
          amount: -pkg.credits,
          description: `${result.isTrial ? 'Teste' : 'Cliente'} ${pkg.name} - ${result.username}`,
          balanceBefore: user.credits,
          balanceAfter: user.credits - pkg.credits,
          relatedId: String(result.xuiLineId),
          relatedType: 'customer',
        },
      });
    }
  }
  
  // Resposta
  return res.status(201).json({
    success: true,
    data: {
      id: result.xuiLineId,
      xuiLineId: result.xuiLineId,
      username: result.username,
      password: result.password,
      expiresAt: result.expiresAt?.toISOString(),
      expiresAtTz: result.expiresAt?.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      package: result.packageName,
      isTrial: result.isTrial,
      connections: connections || 1,
      server: result.serverName,
      bouquetsApplied: result.bouquetsApplied,
      urls: result.urls,
    },
    debug: result.debugPayload,
  });
}));

/**
 * POST /api/v2/customers/trial
 * Criar teste rápido
 */
router.post('/customers/trial', authMiddleware, asyncHandler(async (req, res) => {
  const currentUser = (req as any).user;
  
  const {
    server_id,
    hours = 6,
    name,
    whatsapp,
  } = req.body;
  
  logger.info('[POST /v2/customers/trial] Request:', {
    server_id,
    hours,
    userId: currentUser.userId,
  });
  
  // Validação
  if (!server_id) {
    return res.status(400).json({
      error: 'server_id é obrigatório',
    });
  }
  
  // Buscar servidor com pacotes
  const server = await prisma.xuiServer.findUnique({
    where: { id: server_id },
    include: {
      packages: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  
  if (!server) {
    return res.status(404).json({ error: 'Servidor não encontrado' });
  }
  
  // Buscar pacote de teste ou primeiro pacote disponível
  let pkg = server.packages.find(p => p.isTrial);
  
  if (!pkg) {
    pkg = server.packages[0];
    if (!pkg) {
      return res.status(400).json({
        error: 'Nenhum pacote disponível neste servidor',
      });
    }
  }
  
  // Criar linha usando o serviço robusto
  const result = await LineCreatorService.createLine({
    serverId: server_id,
    packageId: pkg.id,
    resellerUserId: currentUser.userId,
    connections: 1,
    trialHours: hours,
    name,
    whatsapp,
  });
  
  if (!result.success) {
    return res.status(500).json({
      error: result.error,
      debug: result.debugPayload,
    });
  }
  
  // Resposta
  return res.status(201).json({
    success: true,
    data: {
      id: result.xuiLineId,
      xuiLineId: result.xuiLineId,
      username: result.username,
      password: result.password,
      expiresAt: result.expiresAt?.toISOString(),
      expiresAtTz: result.expiresAt?.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      package: result.packageName,
      isTrial: true,
      trialHours: hours,
      connections: 1,
      server: result.serverName,
      urls: result.urls,
    },
    debug: result.debugPayload,
  });
}));

export default router;

