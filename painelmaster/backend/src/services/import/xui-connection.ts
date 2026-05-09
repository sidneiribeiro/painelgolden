/**
 * XUI MySQL Connection Manager
 * Gerencia conexões com o banco de dados XUI usando o POOL EXISTENTE
 * 
 * SEGURO: 
 * - Usa o mesmo pool de conexões do sistema atual
 * - Apenas operações de LEITURA e INSERT para importação
 * - NÃO afeta tabelas de clientes/linhas
 */

import * as mysql from 'mysql2/promise';
import { createLogger } from '../../utils/logger.js';
import { xuiMySQLPool } from '../vod/xui-mysql-pool.service.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('XUIConnection');

type PoolConnection = mysql.PoolConnection;

export class XUIConnection {
  private connection: PoolConnection | null = null;
  private server: XuiServer;

  constructor(server: XuiServer) {
    this.server = server;
  }

  /**
   * Obtém conexão do pool existente (mesmo pool usado pelo sistema atual)
   */
  async connect(): Promise<PoolConnection> {
    if (this.connection) {
      return this.connection;
    }

    // Usar o pool existente (mesma conexão que funciona no sistema atual)
    this.connection = await xuiMySQLPool.getConnection(this.server);
    logger.debug(`[XUIConnection] Conexão obtida do pool`);
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        this.connection.release(); // Devolver ao pool (não fecha)
        logger.debug('[XUIConnection] Conexão devolvida ao pool');
      } catch (error: any) {
        logger.warn('[XUIConnection] Erro ao devolver conexão:', error.message);
      }
      this.connection = null;
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const conn = await this.connect();
    const [rows] = await conn.query<any>(sql, params);
    return rows as T[];
  }

  async execute(sql: string, params?: any[]): Promise<{ affectedRows: number; insertId: number }> {
    const conn = await this.connect();
    const [result] = await conn.query<any>(sql, params);
    return {
      affectedRows: result.affectedRows || 0,
      insertId: result.insertId || 0,
    };
  }

  async beginTransaction(): Promise<void> {
    const conn = await this.connect();
    await conn.beginTransaction();
  }

  async commit(): Promise<void> {
    const conn = await this.connect();
    await conn.commit();
  }

  async rollback(): Promise<void> {
    const conn = await this.connect();
    await conn.rollback();
  }
}
