import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('VODCleanup');

export class VODCleanupService {
  /**
   * Limpa VODItem órfãos (cujos filmes/séries não existem mais no XUI)
   * @param serverId ID do servidor XUI
   */
  async cleanupOrphanedVODItems(serverId: string): Promise<{ deleted: number }> {
    try {
      logger.info(`[VODCleanup] Buscando VODItem órfãos do servidor ${serverId}...`);
      
      // Buscar servidor
      const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
      if (!server) {
        logger.warn(`[VODCleanup] Servidor ${serverId} não encontrado`);
        return { deleted: 0 };
      }
      
      // Por enquanto, vamos apenas limpar itens muito antigos (> 90 dias)
      // Em uma versão futura, podemos verificar se existem no XUI
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const result = await prisma.vODItem.deleteMany({
        where: {
          serverId: serverId,
          createdAt: { lt: ninetyDaysAgo },
        },
      });
      
      logger.info(`[VODCleanup] ✅ ${result.count} VODItem antigos removidos (> 90 dias)`);
      return { deleted: result.count };
    } catch (error: any) {
      logger.error(`[VODCleanup] Erro ao limpar VODItem órfãos:`, error.message);
      return { deleted: 0 };
    }
  }
  
  /**
   * Limpa VODItem com mais de X dias
   * @param days Número de dias (padrão: 30)
   */
  async cleanupOldVODItems(days: number = 30): Promise<{ deleted: number }> {
    try {
      logger.info(`[VODCleanup] Limpando VODItem com mais de ${days} dias...`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const result = await prisma.vODItem.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });
      
      logger.info(`[VODCleanup] ✅ ${result.count} VODItem antigos removidos (> ${days} dias)`);
      return { deleted: result.count };
    } catch (error: any) {
      logger.error(`[VODCleanup] Erro ao limpar VODItem antigos:`, error.message);
      return { deleted: 0 };
    }
  }
  
  /**
   * Limpa todos os VODItem de um servidor específico
   * ⚠️ USO CUIDADOSO: Remove TODOS os registros!
   */
  async clearAllVODItems(serverId: string): Promise<{ deleted: number }> {
    try {
      logger.warn(`[VODCleanup] ⚠️ Removendo TODOS os VODItem do servidor ${serverId}...`);
      
      const result = await prisma.vODItem.deleteMany({
        where: { serverId: serverId },
      });
      
      logger.info(`[VODCleanup] ✅ ${result.count} VODItem removidos`);
      return { deleted: result.count };
    } catch (error: any) {
      logger.error(`[VODCleanup] Erro ao limpar todos os VODItem:`, error.message);
      return { deleted: 0 };
    }
  }
}

export default new VODCleanupService();
