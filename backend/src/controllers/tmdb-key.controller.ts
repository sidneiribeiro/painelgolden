/**
 * Controller para gerenciar chaves API TMDB
 */

import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { tmdbKeyManager } from '../services/vod/tmdb-key-manager.service.js';
const logger = createLogger('TMDBKeyController');

// TODO: Implementar criptografia se necessário
// Por enquanto, armazenar chaves sem criptografia (pode ser adicionado depois)
function encrypt(text: string): string {
  return text; // Por enquanto, sem criptografia
}

function decrypt(text: string): string {
  return text; // Por enquanto, sem criptografia
}

/**
 * GET /api/tmdb/keys
 * Lista todas as chaves TMDB
 */
export const getKeys = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).user?.userId;

  // Por enquanto, mostrar apenas chaves globais (userId = null)
  // TODO: Implementar permissões para ver chaves de outros usuários
  const keys = await prisma.tMDBApiKey.findMany({
    where: { userId: null }, // Apenas chaves globais
    orderBy: [
      { priority: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      id: true,
      userId: true,
      keyName: true,
      isActive: true,
      priority: true,
      requestsToday: true,
      requestsLimit: true,
      lastUsedAt: true,
      lastErrorAt: true,
      lastError: true,
      totalRequests: true,
      successCount: true,
      errorCount: true,
      createdAt: true,
      updatedAt: true,
      // Não retornar apiKey por segurança
    },
  });

  res.json({
    success: true,
    data: keys,
  });
});

/**
 * GET /api/tmdb/keys/:id
 * Obtém uma chave específica (sem mostrar a chave real)
 */
export const getKey = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const key = await prisma.tMDBApiKey.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      keyName: true,
      isActive: true,
      priority: true,
      requestsToday: true,
      requestsLimit: true,
      lastUsedAt: true,
      lastErrorAt: true,
      lastError: true,
      totalRequests: true,
      successCount: true,
      errorCount: true,
      createdAt: true,
      updatedAt: true,
      // Não retornar apiKey por segurança
    },
  });

  if (!key) {
    throw new AppError(404, 'Chave não encontrada');
  }

  res.json({
    success: true,
    data: key,
  });
});

/**
 * POST /api/tmdb/keys
 * Cria uma nova chave TMDB
 */
export const createKey = asyncHandler(async (req: Request, res: Response) => {
  const { keyName, apiKey, priority, requestsLimit, isActive } = req.body;
  const userId = (req as any).user?.id || (req as any).user?.userId;

  if (!keyName || !apiKey) {
    throw new AppError(400, 'keyName e apiKey são obrigatórios');
  }

  // Validar formato da chave TMDB (geralmente 32 caracteres hexadecimais)
  if (!/^[a-f0-9]{32}$/i.test(apiKey)) {
    throw new AppError(400, 'Formato de chave API TMDB inválido');
  }

  // Criptografar chave
  const encryptedKey = encrypt(apiKey);

  // Criar chave
  const key = await prisma.tMDBApiKey.create({
    data: {
      userId: null, // Por enquanto, apenas chaves globais
      keyName,
      apiKey: encryptedKey,
      priority: priority || 0,
      requestsLimit: requestsLimit || 40,
      isActive: isActive !== false,
    },
    select: {
      id: true,
      userId: true,
      keyName: true,
      isActive: true,
      priority: true,
      requestsToday: true,
      requestsLimit: true,
      lastUsedAt: true,
      lastErrorAt: true,
      lastError: true,
      totalRequests: true,
      successCount: true,
      errorCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Atualizar cache do gerenciador
  await tmdbKeyManager.initialize();

  logger.info(`[TMDBKeyController] Chave criada: ${key.id}`);

  res.status(201).json({
    success: true,
    data: key,
    message: 'Chave criada com sucesso',
  });
});

/**
 * PUT /api/tmdb/keys/:id
 * Atualiza uma chave TMDB
 */
export const updateKey = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { keyName, apiKey, priority, requestsLimit, isActive } = req.body;

  const existing = await prisma.tMDBApiKey.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError(404, 'Chave não encontrada');
  }

  const updateData: any = {};
  
  if (keyName !== undefined) updateData.keyName = keyName;
  if (priority !== undefined) updateData.priority = priority;
  if (requestsLimit !== undefined) updateData.requestsLimit = requestsLimit;
  if (isActive !== undefined) updateData.isActive = isActive;

  // Se forneceu nova chave, validar e criptografar
  if (apiKey !== undefined) {
    if (!/^[a-f0-9]{32}$/i.test(apiKey)) {
      throw new AppError(400, 'Formato de chave API TMDB inválido');
    }
    updateData.apiKey = encrypt(apiKey);
  }

  const key = await prisma.tMDBApiKey.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      userId: true,
      keyName: true,
      isActive: true,
      priority: true,
      requestsToday: true,
      requestsLimit: true,
      lastUsedAt: true,
      lastErrorAt: true,
      lastError: true,
      totalRequests: true,
      successCount: true,
      errorCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Atualizar cache do gerenciador
  await tmdbKeyManager.initialize();

  logger.info(`[TMDBKeyController] Chave atualizada: ${id}`);

  res.json({
    success: true,
    data: key,
    message: 'Chave atualizada com sucesso',
  });
});

/**
 * DELETE /api/tmdb/keys/:id
 * Remove uma chave TMDB
 */
export const deleteKey = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const key = await prisma.tMDBApiKey.findUnique({
    where: { id },
  });

  if (!key) {
    throw new AppError(404, 'Chave não encontrada');
  }

  await prisma.tMDBApiKey.delete({
    where: { id },
  });

  // Atualizar cache do gerenciador
  await tmdbKeyManager.initialize();

  logger.info(`[TMDBKeyController] Chave deletada: ${id}`);

  res.json({
    success: true,
    message: 'Chave removida com sucesso',
  });
});

/**
 * POST /api/tmdb/keys/:id/reset-counter
 * Reseta contador diário de uma chave
 */
export const resetCounter = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const key = await prisma.tMDBApiKey.findUnique({
    where: { id },
  });

  if (!key) {
    throw new AppError(404, 'Chave não encontrada');
  }

  await prisma.tMDBApiKey.update({
    where: { id },
    data: {
      requestsToday: 0,
    },
  });

  logger.info(`[TMDBKeyController] Contador resetado para chave: ${id}`);

  res.json({
    success: true,
    message: 'Contador resetado com sucesso',
  });
});

