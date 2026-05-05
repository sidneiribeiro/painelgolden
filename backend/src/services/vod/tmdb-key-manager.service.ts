/**
 * Serviço para gerenciar múltiplas chaves API TMDB
 * Implementa rotação e fallback automático
 */

import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TMDBKeyManager');

interface TMDBKey {
  id: string;
  apiKey: string;
  keyName: string;
  priority: number;
  requestsToday: number;
  requestsLimit: number;
  isActive: boolean;
  lastUsedAt: Date | null;
  lastErrorAt: Date | null;
}

class TMDBKeyManager {
  private keys: TMDBKey[] = [];
  private currentKeyIndex: number = 0;
  private lastRefresh: number = 0;
  private readonly REFRESH_INTERVAL = 60000; // Atualizar lista a cada 1 minuto

  /**
   * Inicializa o gerenciador carregando chaves do banco
   */
  async initialize(): Promise<void> {
    await this.refreshKeys();
    logger.info(`[TMDBKeyManager] Inicializado com ${this.keys.length} chave(s) ativa(s)`);
  }

  /**
   * Atualiza lista de chaves do banco
   */
  private async refreshKeys(): Promise<void> {
    try {
      const dbKeys = await prisma.tMDBApiKey.findMany({
        where: { isActive: true },
        orderBy: [
          { priority: 'asc' },
          { lastUsedAt: 'asc' }, // Usar menos usada primeiro quando mesma prioridade
        ],
      });

      // TODO: Descriptografar chaves se necessário
      // Por enquanto, assumindo que não estão criptografadas (ou já descriptografadas)
      this.keys = dbKeys.map(k => ({
        id: k.id,
        apiKey: k.apiKey,
        keyName: k.keyName,
        priority: k.priority,
        requestsToday: k.requestsToday,
        requestsLimit: k.requestsLimit,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        lastErrorAt: k.lastErrorAt,
      }));

      this.lastRefresh = Date.now();

      // Se não tem chaves, tentar usar chave do .env como fallback
      if (this.keys.length === 0 && process.env.TMDB_API_KEY) {
        logger.warn('[TMDBKeyManager] Nenhuma chave no banco, usando chave do .env');
        this.keys.push({
          id: 'env-key',
          apiKey: process.env.TMDB_API_KEY,
          keyName: 'Chave do .env',
          priority: 999,
          requestsToday: 0,
          requestsLimit: 40,
          isActive: true,
          lastUsedAt: null,
          lastErrorAt: null,
        });
      }
    } catch (error: any) {
      logger.error('[TMDBKeyManager] Erro ao atualizar chaves:', error.message);
    }
  }

  /**
   * Obtém próxima chave disponível (com rotação)
   */
  async getAvailableKey(): Promise<string | null> {
    // Atualizar lista se necessário
    if (Date.now() - this.lastRefresh > this.REFRESH_INTERVAL) {
      await this.refreshKeys();
    }

    if (this.keys.length === 0) {
      logger.warn('[TMDBKeyManager] Nenhuma chave disponível');
      return process.env.TMDB_API_KEY || null;
    }

    // Filtrar chaves que não excederam limite diário
    const availableKeys = this.keys.filter(k => k.requestsToday < k.requestsLimit);

    if (availableKeys.length === 0) {
      logger.warn('[TMDBKeyManager] Todas as chaves excederam limite diário');
      // Resetar contadores (assumindo que é um novo dia) - pode ser melhorado com verificação de data
      for (const key of this.keys) {
        await this.resetDailyCounter(key.id);
      }
      await this.refreshKeys();
      return this.keys.length > 0 ? this.keys[0].apiKey : null;
    }

    // Rotação simples: usar próxima chave disponível
    const key = availableKeys[this.currentKeyIndex % availableKeys.length];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % availableKeys.length;

    return key.apiKey;
  }

  /**
   * Registra uso bem-sucedido de uma chave
   */
  async recordSuccess(apiKey: string): Promise<void> {
    try {
      const key = this.keys.find(k => k.apiKey === apiKey);
      if (!key || key.id === 'env-key') return; // Não atualizar chave do .env

      await prisma.tMDBApiKey.update({
        where: { id: key.id },
        data: {
          requestsToday: { increment: 1 },
          totalRequests: { increment: 1 },
          successCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });

      // Atualizar cache local
      key.requestsToday++;
      key.lastUsedAt = new Date();
    } catch (error: any) {
      logger.error('[TMDBKeyManager] Erro ao registrar sucesso:', error.message);
    }
  }

  /**
   * Registra erro em uma chave (para fallback)
   */
  async recordError(apiKey: string, error: string): Promise<void> {
    try {
      const key = this.keys.find(k => k.apiKey === apiKey);
      if (!key || key.id === 'env-key') return;

      await prisma.tMDBApiKey.update({
        where: { id: key.id },
        data: {
          errorCount: { increment: 1 },
          lastErrorAt: new Date(),
          lastError: error,
        },
      });

      // Atualizar cache local
      key.lastErrorAt = new Date();
    } catch (error: any) {
      logger.error('[TMDBKeyManager] Erro ao registrar erro:', error.message);
    }
  }

  /**
   * Obtém todas as chaves (para exibição)
   */
  async getAllKeys(userId?: string): Promise<any[]> {
    const where: any = {};
    if (userId) {
      where.userId = userId;
    } else {
      where.userId = null; // Apenas chaves globais
    }

    return await prisma.tMDBApiKey.findMany({
      where,
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
  }

  /**
   * Reseta contador diário de uma chave
   */
  private async resetDailyCounter(keyId: string): Promise<void> {
    try {
      await prisma.tMDBApiKey.update({
        where: { id: keyId },
        data: {
          requestsToday: 0,
        },
      });
    } catch (error: any) {
      logger.error(`[TMDBKeyManager] Erro ao resetar contador da chave ${keyId}:`, error.message);
    }
  }
}

export const tmdbKeyManager = new TMDBKeyManager();

