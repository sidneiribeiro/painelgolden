/**
 * Live Importer - Importação simplificada de canais LIVE
 * 
 * SEGURO: 
 * - Apenas INSERT na tabela streams (type=1)
 * - Apenas INSERT em streams_servers
 * - NÃO modifica canais existentes
 */

import { createLogger } from '../../utils/logger.js';
import { XUIConnection } from './xui-connection.js';
import { CategoryManager } from './category-manager.js';
import { BouquetManager } from './bouquet-manager.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('LiveImporter');

export interface LiveChannelData {
  stream_display_name: string;
  stream_source: string[];
  stream_icon?: string;
  category_id: number[];
  target_container?: string;
  direct_source?: number;
  read_native?: number;
  direct_proxy?: number;
  enable_transcode?: number;
  stream_all?: number;
  gen_timestamps?: number;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: number;
  insertedIds: number[];
  duration: number;
}

export interface ImportOptions {
  serverId?: number;
  bouquetId?: number;
  bouquetIds?: number[];
  batchSize?: number;
  skipDuplicates?: boolean;
  importMode?: 'direct' | 'ondemand';
}

export class LiveImporter {
  private conn: XUIConnection;
  private categoryManager: CategoryManager;
  private bouquetManager: BouquetManager;
  private server: XuiServer;

  constructor(server: XuiServer) {
    this.server = server;
    this.conn = new XUIConnection(server);
    this.categoryManager = new CategoryManager(server);
    this.bouquetManager = new BouquetManager(server);
  }

  /**
   * Importa canais LIVE em lote
   * SEGURO: Apenas INSERT, não modifica existentes
   */
  async importChannels(channels: LiveChannelData[], options: ImportOptions = {}): Promise<ImportResult> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 500;
    
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    const insertedIds: number[] = [];

    logger.info(`[LiveImporter] Iniciando importação de ${channels.length} canais`);

    // 1. Buscar canais existentes para evitar duplicados
    const existingChannels = options.skipDuplicates !== false 
      ? await this.getExistingChannels() 
      : new Set<string>();

    // 2. Processar em lotes
    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      
      try {
        const result = await this.insertBatch(batch, existingChannels, options);
        inserted += result.inserted;
        skipped += result.skipped;
        insertedIds.push(...result.insertedIds);
        
        logger.info(`[LiveImporter] Lote ${Math.floor(i/batchSize) + 1}: ${result.inserted} inseridos, ${result.skipped} ignorados`);
      } catch (error: any) {
        logger.error(`[LiveImporter] Erro no lote ${Math.floor(i/batchSize) + 1}:`, error.message);
        errors += batch.length;
      }
    }

    // 3. Adicionar ao(s) bouquet(s) se especificado
    const targetBouquetIds = Array.from(
      new Set([
        ...(Array.isArray(options.bouquetIds) ? options.bouquetIds : []),
        ...(options.bouquetId ? [options.bouquetId] : []),
      ].filter((v) => Number.isFinite(v) && v > 0))
    );
    if (targetBouquetIds.length > 0 && insertedIds.length > 0) {
      for (const id of targetBouquetIds) {
        await this.bouquetManager.addChannelsToBouquet(id, insertedIds);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[LiveImporter] Importação concluída: ${inserted} inseridos, ${skipped} ignorados, ${errors} erros (${duration}ms)`);

    return { inserted, skipped, errors, insertedIds, duration };
  }

  /**
   * Insere um lote de canais
   */
  private async insertBatch(
    channels: LiveChannelData[], 
    existingChannels: Set<string>,
    options: ImportOptions
  ): Promise<{ inserted: number; skipped: number; insertedIds: number[] }> {
    const now = Math.floor(Date.now() / 1000);
    const channelsToInsert: LiveChannelData[] = [];
    let skipped = 0;

    // Filtrar duplicados
    for (const channel of channels) {
      const key = this.normalizeTitle(channel.stream_display_name);
      if (existingChannels.has(key)) {
        skipped++;
        continue;
      }
      channelsToInsert.push(channel);
      existingChannels.add(key);
    }

    if (channelsToInsert.length === 0) {
      return { inserted: 0, skipped, insertedIds: [] };
    }

    // Preparar valores para INSERT
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const channel of channelsToInsert) {
      const streamSource = JSON.stringify(channel.stream_source || []);
      const categoryIdInt = channel.category_id[0] || 0; // Xtream UI usa int

      values.push(
        1,                                                      // type = 1 (LIVE)
        categoryIdInt,
        channel.stream_display_name,
        streamSource,
        channel.stream_icon || '',
        channel.target_container || 'ts',
        channel.direct_source ?? 1,                             // direct_source
        now,
        channel.read_native ?? 0,                               // read_native = 0 (OBRIGATÓRIO)
        
        channel.enable_transcode ?? 0,
        channel.stream_all ?? 0,
        channel.gen_timestamps ?? 1                             // gen_timestamps = 1 (play azul)
      );

      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    }

    // Executar INSERT
    await this.conn.beginTransaction();
    
    try {
      const result = await this.conn.execute(
        `INSERT INTO streams (
          type, category_id, stream_display_name, stream_source, stream_icon,
          target_container, direct_source, added, read_native,
          enable_transcode, stream_all, gen_timestamps
        ) VALUES ${placeholders.join(', ')}`,
        values
      );

      const firstInsertId = result.insertId;
      const insertedIds = Array.from(
        { length: result.affectedRows }, 
        (_, i) => firstInsertId + i
      );

      // Vincular ao servidor
      if (options.serverId && insertedIds.length > 0) {
        const onDemand = options.importMode === 'ondemand' ? 1 : 0;
        await this.linkToServer(insertedIds, options.serverId, onDemand);
      }

      await this.conn.commit();
      return { inserted: insertedIds.length, skipped, insertedIds };
      
    } catch (error) {
      await this.conn.rollback();
      throw error;
    }
  }

  /**
   * Vincula canais ao servidor
   */
  private async linkToServer(channelIds: number[], serverId: number, onDemand: number = 0): Promise<void> {
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const id of channelIds) {
      values.push(id, serverId, onDemand);
      placeholders.push('(?, ?, ?)');
    }

    try {
      await this.conn.execute(
        `INSERT IGNORE INTO streams_sys (stream_id, server_id, on_demand) 
         VALUES ${placeholders.join(', ')}`,
        values
      );
      logger.info(`[LiveImporter] ${channelIds.length} canais vinculados ao servidor ${serverId}`);
    } catch (error: any) {
      logger.warn(`[LiveImporter] Erro ao vincular servidor: ${error.message}`);
    }
  }

  /**
   * Busca canais existentes
   */
  private async getExistingChannels(): Promise<Set<string>> {
    const channels = await this.conn.query<{ stream_display_name: string }>(
      `SELECT stream_display_name FROM streams WHERE type = 1`
    );

    const set = new Set<string>();
    for (const c of channels) {
      set.add(this.normalizeTitle(c.stream_display_name));
    }

    logger.info(`[LiveImporter] ${channels.length} canais existentes carregados`);
    return set;
  }

  /**
   * Normaliza título
   */
  private normalizeTitle(title: string): string {
    return title.toLowerCase().trim();
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect();
    await this.categoryManager.disconnect();
    await this.bouquetManager.disconnect();
  }
}
