import mysql from 'mysql2/promise';
import { createLogger } from '../../utils/logger.js';
import type { XuiServer } from '@prisma/client';
import { decrypt } from '../../utils/crypto.js';

const logger = createLogger('XUIMySQLPool');

/**
 * ✅ SOLUÇÃO DEFINITIVA: Connection Pool Manager
 * 
 * PROBLEMA RESOLVIDO:
 * - Antes: 100+ conexões individuais → XUI bloqueia IP
 * - Agora: Pool de 3-5 conexões reutilizáveis
 * 
 * OTIMIZAÇÕES:
 * - Connection pooling
 * - Reutilização de conexões
 * - Limite de 5 conexões simultâneas (evita sobrecarga)
 * - Timeout de 30s (padrão XUI)
 */
class XUIMySQLPoolService {
  private pools: Map<string, mysql.Pool> = new Map();

  /**
   * Obter ou criar pool de conexões para um servidor XUI
   */
  getPool(server: XuiServer): mysql.Pool {
    const poolKey = `${server.dbHost}:${server.dbPort || 3306}`;

    if (this.pools.has(poolKey)) {
      return this.pools.get(poolKey)!;
    }

    // Descriptografar senha
    const dbPassword = server.dbPassword ? decrypt(server.dbPassword) : 'senha_segura';

    // Criar pool com configurações otimizadas
    const pool = mysql.createPool({
      host: server.dbHost,
      port: server.dbPort || 3306,
      user: server.dbUser || 'root',
      password: dbPassword,
      database: server.dbName || 'xui',
      
      // ⚠️ CONFIGURAÇÕES CRÍTICAS PARA EVITAR BLOQUEIO
      connectionLimit: 5,          // Máximo 5 conexões simultâneas
      waitForConnections: true,    // Aguardar se pool cheio
      queueLimit: 0,               // Sem limite de fila
      connectTimeout: 30000,       // 30s timeout
      enableKeepAlive: true,       // Manter conexões vivas
      keepAliveInitialDelay: 10000, // 10s inicial
      
      // Retry automático
      acquireTimeout: 30000,       // 30s para adquirir conexão
    });

    this.pools.set(poolKey, pool);
    
    logger.info(`[Pool] Pool criado para ${poolKey} (limite: 5 conexões)`);

    return pool;
  }

  /**
   * Obter conexão do pool
   */
  async getConnection(server: XuiServer): Promise<mysql.PoolConnection> {
    const pool = this.getPool(server);
    try {
      const connection = await pool.getConnection();
      logger.debug(`[Pool] Conexão adquirida (ativas: ${pool.pool.acquiredConnections})`);
      return connection;
    } catch (error: any) {
      logger.error(`[Pool] Erro ao adquirir conexão: ${error.message}`);
      throw error;
    }
  }

  /**
   * Executar query com pool
   */
  async query<T = any>(
    server: XuiServer,
    sql: string,
    params?: any[]
  ): Promise<[T[], mysql.FieldPacket[]]> {
    const pool = this.getPool(server);
    try {
      const result = await pool.query<any>(sql, params);
      return result as [T[], mysql.FieldPacket[]];
    } catch (error: any) {
      logger.error(`[Pool] Erro em query: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fechar pool de um servidor específico
   */
  async closePool(server: XuiServer): Promise<void> {
    const poolKey = `${server.dbHost}:${server.dbPort || 3306}`;
    const pool = this.pools.get(poolKey);
    
    if (pool) {
      await pool.end();
      this.pools.delete(poolKey);
      logger.info(`[Pool] Pool fechado para ${poolKey}`);
    }
  }

  /**
   * Fechar todos os pools
   */
  async closeAll(): Promise<void> {
    logger.info(`[Pool] Fechando ${this.pools.size} pool(s)...`);
    
    const closePromises = Array.from(this.pools.values()).map(pool => pool.end());
    await Promise.allSettled(closePromises);
    
    this.pools.clear();
    logger.info('[Pool] Todos os pools fechados');
  }

  /**
   * Obter estatísticas dos pools
   */
  getStats() {
    const stats = new Map<string, any>();
    
    this.pools.forEach((pool, key) => {
      // @ts-ignore - Acessar propriedades internas do pool
      const poolInternal = pool.pool || pool;
      
      stats.set(key, {
        totalConnections: poolInternal.allConnections || poolInternal._allConnections || 0,
        activeConnections: poolInternal.acquiredConnections || poolInternal._acquiredConnections || 0,
        idleConnections: poolInternal.freeConnections || poolInternal._freeConnections || 0,
        queueLength: poolInternal.waitingQueue?.length || 0,
      });
    });
    
    return stats;
  }
}

// Singleton instance
export const xuiMySQLPool = new XUIMySQLPoolService();
export default xuiMySQLPool;
