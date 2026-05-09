/**
 * Bouquet Manager - Gerencia bouquets no XUI
 * 
 * SEGURO: Apenas adiciona IDs aos bouquets existentes
 * NÃO remove ou modifica estrutura dos bouquets
 */

import { createLogger } from '../../utils/logger.js';
import { XUIConnection } from './xui-connection.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('BouquetManager');

export interface XUIBouquet {
  id: number;
  bouquet_name: string;
  bouquet_channels: string; // JSON array
  bouquet_movies?: string;  // JSON array (quando existir)
  bouquet_series: string;   // JSON array
}

export type BouquetItemType = 'live' | 'movie' | 'series';

export class BouquetManager {
  private conn: XUIConnection;
  private hasBouquetMoviesCache: boolean | null = null;

  constructor(server: XuiServer) {
    this.conn = new XUIConnection(server);
  }

  private async hasBouquetMoviesColumn(): Promise<boolean> {
    if (this.hasBouquetMoviesCache !== null) return this.hasBouquetMoviesCache;
    try {
      const rows = await this.conn.query<any>(`SHOW COLUMNS FROM bouquets LIKE 'bouquet_movies'`);
      this.hasBouquetMoviesCache = Array.isArray(rows) && rows.length > 0;
    } catch {
      this.hasBouquetMoviesCache = false;
    }
    return this.hasBouquetMoviesCache;
  }

  /**
   * Lista todos os bouquets
   */
  async getBouquets(): Promise<XUIBouquet[]> {
    const hasMovies = await this.hasBouquetMoviesColumn();
    return await this.conn.query<XUIBouquet>(
      `SELECT id, bouquet_name, bouquet_channels, ${hasMovies ? 'bouquet_movies,' : ''} bouquet_series 
       FROM bouquets 
       ORDER BY bouquet_name`
    );
  }

  /**
   * Busca bouquet por ID
   */
  async getBouquetById(id: number): Promise<XUIBouquet | null> {
    const hasMovies = await this.hasBouquetMoviesColumn();
    const rows = await this.conn.query<XUIBouquet>(
      `SELECT id, bouquet_name, bouquet_channels, ${hasMovies ? 'bouquet_movies,' : ''} bouquet_series 
       FROM bouquets 
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Verifica se bouquet existe
   */
  async bouquetExists(id: number): Promise<boolean> {
    const rows = await this.conn.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM bouquets WHERE id = ?`,
      [id]
    );
    return rows[0]?.count > 0;
  }

  private normalizeIds(ids: any[]): number[] {
    const normalized = ids
      .map((v) => (typeof v === 'string' ? parseInt(v, 10) : Number(v)))
      .filter((v) => Number.isFinite(v) && v > 0);
    return Array.from(new Set(normalized));
  }

  private getFieldForType(type: BouquetItemType, hasMovies: boolean): 'bouquet_channels' | 'bouquet_movies' | 'bouquet_series' {
    if (type === 'series') return 'bouquet_series';
    if (type === 'movie') return hasMovies ? 'bouquet_movies' : 'bouquet_channels';
    return 'bouquet_channels';
  }

  async getBouquetItemIds(bouquetId: number, type: BouquetItemType): Promise<number[]> {
    const bouquet = await this.getBouquetById(bouquetId);
    if (!bouquet) return [];

    const hasMovies = await this.hasBouquetMoviesColumn();
    const field = this.getFieldForType(type, hasMovies);
    const raw = (bouquet as any)[field] || '[]';

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0) : [];
    } catch {
      return [];
    }
  }

  async getBouquetItemsWithNames(
    bouquetId: number,
    type: BouquetItemType
  ): Promise<Array<{ id: number; name: string }>> {
    const ids = await this.getBouquetItemIds(bouquetId, type);
    if (ids.length === 0) return [];

    const nameById = new Map<number, string>();
    const chunkSize = 300;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');

      if (type === 'series') {
        const rows = await this.conn.query<{ id: number; title: string }>(
          `SELECT id, title FROM series WHERE id IN (${placeholders})`,
          chunk
        );
        for (const r of rows) nameById.set(r.id, r.title || '');
      } else {
        const rows = await this.conn.query<{ id: number; stream_display_name: string }>(
          `SELECT id, stream_display_name FROM streams WHERE id IN (${placeholders})`,
          chunk
        );
        for (const r of rows) nameById.set(r.id, r.stream_display_name || '');
      }
    }

    return ids.map((id) => ({ id, name: nameById.get(id) || '' }));
  }

  async setBouquetItemOrder(bouquetId: number, type: BouquetItemType, orderedIds: number[]): Promise<void> {
    const hasMovies = await this.hasBouquetMoviesColumn();
    const field = this.getFieldForType(type, hasMovies);

    const currentIds = await this.getBouquetItemIds(bouquetId, type);
    const currentSet = new Set(currentIds);
    const desiredIds = this.normalizeIds(Array.isArray(orderedIds) ? orderedIds : []);

    if (desiredIds.length !== currentIds.length) {
      throw new Error('A lista enviada não contém exatamente os mesmos itens do bouquet');
    }
    for (const id of desiredIds) {
      if (!currentSet.has(id)) {
        throw new Error('A lista enviada não contém exatamente os mesmos itens do bouquet');
      }
    }

    await this.conn.execute(
      `UPDATE bouquets SET ${field} = ? WHERE id = ?`,
      [JSON.stringify(desiredIds), bouquetId]
    );
  }

  /**
   * Adiciona filmes a um bouquet
   * SEGURO: Apenas adiciona IDs, não remove existentes
   */
  async addMoviesToBouquet(bouquetId: number, movieIds: number[]): Promise<number> {
    if (!movieIds || movieIds.length === 0) {
      return 0;
    }

    const bouquet = await this.getBouquetById(bouquetId);
    if (!bouquet) {
      logger.warn(`[BouquetManager] Bouquet ${bouquetId} não encontrado`);
      return 0;
    }

    const hasMovies = await this.hasBouquetMoviesColumn();
    const moviesField = hasMovies ? 'bouquet_movies' : 'bouquet_channels';

    let currentIds: number[] = [];
    try {
      const raw = hasMovies ? (bouquet.bouquet_movies || '[]') : (bouquet.bouquet_channels || '[]');
      currentIds = JSON.parse(raw);
    } catch {
      currentIds = [];
    }

    // Merge sem duplicatas
    const mergedSet = new Set([...currentIds, ...movieIds]);
    const updatedIds = Array.from(mergedSet);
    const addedCount = updatedIds.length - currentIds.length;

    // Atualizar
    await this.conn.execute(
      `UPDATE bouquets SET ${moviesField} = ? WHERE id = ?`,
      [JSON.stringify(updatedIds), bouquetId]
    );

    logger.info(`[BouquetManager] ${addedCount} filmes adicionados ao bouquet ${bouquetId} (total: ${updatedIds.length})`);
    return addedCount;
  }

  /**
   * Adiciona séries a um bouquet
   * SEGURO: Apenas adiciona IDs, não remove existentes
   */
  async addSeriesToBouquet(bouquetId: number, seriesIds: number[]): Promise<number> {
    if (!seriesIds || seriesIds.length === 0) {
      return 0;
    }

    const bouquet = await this.getBouquetById(bouquetId);
    if (!bouquet) {
      logger.warn(`[BouquetManager] Bouquet ${bouquetId} não encontrado`);
      return 0;
    }

    // Parse JSON atual
    let currentIds: number[] = [];
    try {
      currentIds = JSON.parse(bouquet.bouquet_series || '[]');
    } catch {
      currentIds = [];
    }

    // Merge sem duplicatas
    const mergedSeriesSet = new Set([...currentIds, ...seriesIds]);
    const updatedIds = Array.from(mergedSeriesSet);
    const addedCount = updatedIds.length - currentIds.length;

    // Atualizar
    await this.conn.execute(
      `UPDATE bouquets SET bouquet_series = ? WHERE id = ?`,
      [JSON.stringify(updatedIds), bouquetId]
    );

    logger.info(`[BouquetManager] ${addedCount} séries adicionadas ao bouquet ${bouquetId} (total: ${updatedIds.length})`);
    return addedCount;
  }

  /**
   * Adiciona canais LIVE a um bouquet
   * SEGURO: Apenas adiciona IDs, não remove existentes
   */
  async addChannelsToBouquet(bouquetId: number, channelIds: number[]): Promise<number> {
    if (!channelIds || channelIds.length === 0) {
      return 0;
    }

    const bouquet = await this.getBouquetById(bouquetId);
    if (!bouquet) {
      logger.warn(`[BouquetManager] Bouquet ${bouquetId} não encontrado`);
      return 0;
    }

    // Parse JSON atual
    let currentChannels: number[] = [];
    try {
      currentChannels = JSON.parse(bouquet.bouquet_channels || '[]');
    } catch {
      currentChannels = [];
    }

    // Merge sem duplicatas
    const mergedChannelsSet = new Set([...currentChannels, ...channelIds]);
    const updatedChannels = Array.from(mergedChannelsSet);
    const addedCount = updatedChannels.length - currentChannels.length;

    // Atualizar
    await this.conn.execute(
      `UPDATE bouquets SET bouquet_channels = ? WHERE id = ?`,
      [JSON.stringify(updatedChannels), bouquetId]
    );

    logger.info(`[BouquetManager] ${addedCount} canais adicionados ao bouquet ${bouquetId} (total: ${updatedChannels.length})`);
    return addedCount;
  }

  /**
   * Conta quantos filmes estão no bouquet
   */
  async countMoviesInBouquet(bouquetId: number): Promise<number> {
    const bouquet = await this.getBouquetById(bouquetId);
    if (!bouquet) return 0;

    try {
      const hasMovies = await this.hasBouquetMoviesColumn();
      const raw = hasMovies ? (bouquet.bouquet_movies || '[]') : (bouquet.bouquet_channels || '[]');
      const ids = JSON.parse(raw);
      return ids.length;
    } catch {
      return 0;
    }
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect();
  }
}
