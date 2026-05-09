/**
 * Series Importer - Importação simplificada de séries
 * 
 * SEGURO: 
 * - Apenas INSERT na tabela streams_series (séries)
 * - Apenas INSERT na tabela streams (episódios type=3)
 * - Apenas INSERT em streams_servers
 * - NÃO modifica séries/episódios existentes
 */

import { createLogger } from '../../utils/logger.js';
import { XUIConnection } from './xui-connection.js';
import { CategoryManager } from './category-manager.js';
import { BouquetManager } from './bouquet-manager.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('SeriesImporter');

export interface SeriesInfo {
  title: string;
  category_id: number[];
  cover?: string;
  cover_big?: string;
  plot?: string;
  genre?: string;
  cast?: string;
  rating?: number;
  director?: string;
  release_date?: string;
  tmdb_id?: number;
  year?: number;
}

export interface EpisodeData {
  seriesId: number;
  season: number;
  episode: number;
  stream_display_name: string;
  stream_source: string[];
  stream_icon?: string;
  category_id: number[];
}

export interface SeriesWithEpisodes {
  series: SeriesInfo;
  episodes: Omit<EpisodeData, 'seriesId'>[];
}

export interface ImportResult {
  seriesInserted: number;
  episodesInserted: number;
  skipped: number;
  errors: number;
  insertedSeriesIds: number[];
  duration: number;
}

export interface ImportOptions {
  serverId?: number;
  bouquetId?: number;
  bouquetIds?: number[];
  batchSize?: number;
  skipDuplicates?: boolean;
  /**
   * Tipo de fonte:
   * - 'primary': Importação completa (padrão)
   * - 'secondary': Complementa episódios de séries existentes
   */
  sourceType?: 'primary' | 'secondary';
  /**
   * Atualizar séries existentes:
   * Quando true, busca série por TMDB ID ou título parcial e adiciona episódios novos
   */
  updateExistingSeries?: boolean;
  onProgress?: (progress: { current: number; total: number; message?: string }) => void;
}

// 🚀 OTIMIZAÇÃO: Helper para processar em paralelo com limite
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const p = fn(item).then(r => {
      results.push(r);
    });
    executing.push(p);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove promessas resolvidas
      for (let i = executing.length - 1; i >= 0; i--) {
        // @ts-ignore - verificar se está resolvida
        if (executing[i] === p) continue;
      }
    }
  }
  
  await Promise.all(executing);
  return results;
}

export class SeriesImporter {
  private conn: XUIConnection;
  private categoryManager: CategoryManager;
  private bouquetManager: BouquetManager;
  private server: XuiServer;
  // 🚀 OTIMIZAÇÃO: Controle de concorrência
  private readonly PARALLEL_LIMIT = 5;

  constructor(server: XuiServer) {
    this.server = server;
    this.conn = new XUIConnection(server);
    this.categoryManager = new CategoryManager(server);
    this.bouquetManager = new BouquetManager(server);
  }

  /**
   * Importa séries com episódios
   * SEGURO: Apenas INSERT, não modifica existentes
   */
  async importSeries(seriesList: SeriesWithEpisodes[], options: ImportOptions = {}): Promise<ImportResult> {
    const startTime = Date.now();
    
    let seriesInserted = 0;
    let episodesInserted = 0;
    let skipped = 0;
    let errors = 0;
    const insertedSeriesIds: number[] = [];
    const touchedExistingSeriesIds: number[] = [];

    logger.info(`[SeriesImporter] Iniciando importação de ${seriesList.length} séries (updateExisting: ${options.updateExistingSeries || false})`);
    if (options.onProgress) {
      options.onProgress({ current: 0, total: seriesList.length, message: `📦 Preparando importação de séries: 0/${seriesList.length}` });
    }

    // 1. Buscar séries existentes para evitar duplicados
    // Se updateExistingSeries está ativo, usar matching flexível (ignora [L], [D], etc.)
    const useFlexibleMatch = options.updateExistingSeries === true;
    const existingSeries = options.skipDuplicates !== false 
      ? await this.getExistingSeries(useFlexibleMatch) 
      : new Map<string, number>();

    // 2. Buscar episódios existentes se for fonte secundária OU updateExistingSeries
    const needEpisodeCheck = options.sourceType === 'secondary' || options.updateExistingSeries;
    const existingEpisodes = needEpisodeCheck 
      ? await this.getExistingEpisodes() 
      : new Map<string, number>();

    // 🚀 OTIMIZAÇÃO: Processar séries em lotes paralelos
    const BATCH_SIZE = this.PARALLEL_LIMIT;
    let processedCount = 0;
    let lastProgressAt = 0;
    
    // Função para processar uma série
    const processSeries = async (item: SeriesWithEpisodes): Promise<{ inserted: boolean; episodes: number; updatedEpisodes: number; touchedExisting: boolean; error?: string }> => {
      try {
        const key = this.getSeriesKey(item.series);
        
        // Tentar encontrar série existente (chave exata ou parcial)
        let existingSeriesId: number | undefined;
        
        if (existingSeries.has(key)) {
          existingSeriesId = existingSeries.get(key);
        } else if (useFlexibleMatch) {
          const partialKey = `partial:${this.normalizePartialTitle(item.series.title)}`;
          if (existingSeries.has(partialKey)) {
            existingSeriesId = existingSeries.get(partialKey);
          }
        }
        
        // Série já existe
        if (existingSeriesId !== undefined) {
          let touchedExisting = false;
          let updatedEpisodes = 0;
          let insertedEpisodes = 0;

          if (options.updateExistingSeries === true) {
            const updatedSeries = await this.updateExistingSeriesMetadata(existingSeriesId, item.series);
            if (updatedSeries) {
              touchedExisting = true;
            }
          }

          if ((options.updateExistingSeries || options.sourceType === 'secondary') && item.episodes && item.episodes.length > 0) {
            const episodesToInsert: Omit<EpisodeData, 'seriesId'>[] = [];
            const episodesToUpdate: Array<{ episodeId: number; ep: Omit<EpisodeData, 'seriesId'> }> = [];

            for (const ep of item.episodes) {
              const epKey = `${existingSeriesId}:S${ep.season}E${ep.episode}`;
              const existingEpisodeId = existingEpisodes.get(epKey);
              if (existingEpisodeId !== undefined) {
                if (options.updateExistingSeries === true) {
                  episodesToUpdate.push({ episodeId: existingEpisodeId, ep });
                }
              } else {
                episodesToInsert.push(ep);
              }
            }

            if (episodesToUpdate.length > 0) {
              for (const u of episodesToUpdate) {
                const ok = await this.updateExistingEpisode(u.episodeId, u.ep, item.series.category_id, options.serverId);
                if (ok) updatedEpisodes++;
              }
              if (updatedEpisodes > 0) touchedExisting = true;
            }

            if (episodesToInsert.length > 0) {
              insertedEpisodes = await this.insertEpisodes(existingSeriesId, episodesToInsert, item.series.category_id, options.serverId);
              for (const ep of episodesToInsert) {
                existingEpisodes.set(`${existingSeriesId}:S${ep.season}E${ep.episode}`, 0);
              }
              await this.mergeSeriesSeasons(existingSeriesId, episodesToInsert);
              touchedExisting = true;
            }
          }

          if (touchedExisting) {
            touchedExistingSeriesIds.push(existingSeriesId);
          }

          return { inserted: false, episodes: insertedEpisodes, updatedEpisodes, touchedExisting };
        }

        // Inserir série nova
        const seriesId = await this.insertSeries(item.series);
        existingSeries.set(key, seriesId);
        if (item.series.tmdb_id) {
          existingSeries.set(`tmdb:${item.series.tmdb_id}`, seriesId);
        }
        insertedSeriesIds.push(seriesId);

        // Inserir episódios
        let episodeCount = 0;
        if (item.episodes && item.episodes.length > 0) {
          episodeCount = await this.insertEpisodes(seriesId, item.episodes, item.series.category_id, options.serverId);
          await this.updateSeriesSeasons(seriesId, item.episodes);
        }

        return { inserted: true, episodes: episodeCount, updatedEpisodes: 0, touchedExisting: false };
      } catch (error: any) {
        return { inserted: false, episodes: 0, updatedEpisodes: 0, touchedExisting: false, error: error.message };
      }
    };

    // 🚀 Processar em lotes paralelos
    for (let i = 0; i < seriesList.length; i += BATCH_SIZE) {
      const batch = seriesList.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(seriesList.length / BATCH_SIZE);
      
      logger.info(`[SeriesImporter] 🚀 Processando lote ${batchNum}/${totalBatches} (${batch.length} séries em paralelo)`);
      
      const results = await Promise.all(batch.map(processSeries));
      
      for (const result of results) {
        if (result.error) {
          errors++;
        } else if (result.inserted) {
          seriesInserted++;
          episodesInserted += result.episodes;
        } else {
          skipped++;
          episodesInserted += result.episodes; // Episódios adicionados a séries existentes
        }
      }
      
      logger.info(`[SeriesImporter] ✅ Lote ${batchNum} concluído - Total: ${seriesInserted} séries, ${episodesInserted} episódios`);

      processedCount += batch.length;
      if (options.onProgress) {
        const now = Date.now();
        if (now - lastProgressAt > 1200 || processedCount >= seriesList.length) {
          lastProgressAt = now;
          const lastTitle = batch[batch.length - 1]?.series?.title;
          options.onProgress({
            current: Math.min(processedCount, seriesList.length),
            total: seriesList.length,
            message: `📺 Processando séries: ${Math.min(processedCount, seriesList.length)}/${seriesList.length} (última: ${lastTitle || '—'}) | séries novas: ${seriesInserted} | eps: ${episodesInserted}`,
          });
        }
      }
    }

    // 3. Adicionar ao(s) bouquet(s) se especificado
    const targetBouquetIds = Array.from(
      new Set([
        ...(Array.isArray(options.bouquetIds) ? options.bouquetIds : []),
        ...(options.bouquetId ? [options.bouquetId] : []),
      ].filter((v) => Number.isFinite(v) && v > 0))
    );
    const seriesIdsForBouquet = options.updateExistingSeries === true
      ? Array.from(new Set([...insertedSeriesIds, ...touchedExistingSeriesIds]))
      : insertedSeriesIds;
    if (targetBouquetIds.length > 0 && seriesIdsForBouquet.length > 0) {
      for (const id of targetBouquetIds) {
        await this.bouquetManager.addSeriesToBouquet(id, seriesIdsForBouquet);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[SeriesImporter] Importação concluída: ${seriesInserted} séries, ${episodesInserted} episódios (${duration}ms)`);

    return { seriesInserted, episodesInserted, skipped, errors, insertedSeriesIds, duration };
  }

  /**
   * Insere uma série na tabela streams_series
   * Baseado no sistema antigo que funciona (xui-vod-db.client.ts)
   */
  private async insertSeries(series: SeriesInfo): Promise<number> {
    // Garantir que category_id são números inteiros (mesmo fix do sistema antigo)
    const categoryIdArray = series.category_id.map(id => parseInt(String(id), 10));
    const categoryIdInt = categoryIdArray[0] || 0; // Xtream UI usa int
    const now = Math.floor(Date.now() / 1000);

    // 🚀 OTIMIZAÇÃO: Log reduzido (debug removido)

    const result = await this.conn.execute(
      `INSERT INTO series (
        title, category_id, cover, cover_big, genre, plot, cast, 
        rating, director, releaseDate, last_modified, tmdb_id,
        seasons, episode_run_time, backdrop_path, youtube_trailer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '[]', '')`,
      [
        series.title,
        categoryIdInt,
        series.cover || '',
        series.cover_big || series.cover || '',
        series.genre || '',
        series.plot || '',
        series.cast || '',
        series.rating || 0,
        series.director || '',
        series.release_date || '',
        now,
        series.tmdb_id || 0,
        45, // episode_run_time padrão
      ]
    );

    // 🚀 OTIMIZAÇÃO: Removido SELECT de verificação (desnecessário em produção)
    return result.insertId;
  }

  /**
   * Insere episódios de uma série
   */
  private async insertEpisodes(
    seriesId: number, 
    episodes: Omit<EpisodeData, 'seriesId'>[],
    categoryId: number[],
    serverId?: number
  ): Promise<number> {
    if (!episodes || episodes.length === 0) return 0;

    const now = Math.floor(Date.now() / 1000);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const ep of episodes) {
      const streamSource = JSON.stringify(ep.stream_source || []);
      const categoryIdInt = (ep.category_id || categoryId)[0] || 0; // Xtream UI usa int
      const streamIcon = ep.stream_icon && ep.stream_icon.trim() ? ep.stream_icon.trim() : null;
      
      // movie_properties no formato esperado pelo XUI (baseado no sistema antigo)
      const movieProperties = JSON.stringify({
        release_date: '',
        plot: '',
        duration_secs: 2700,
        duration: '00:45:00',
        movie_image: streamIcon || '',
        video: [],
        audio: [],
        bitrate: 0,
        rating: '0',
        season: ep.season.toString(),
        episode: ep.episode.toString(),
        tmdb_id: ''
      });

      values.push(
        categoryIdInt,
        ep.stream_display_name,
        streamSource,
        streamIcon,
        '',                             // notes
        movieProperties,
        now,
        seriesId                        // series_no (FK para streams_series)
      );

      placeholders.push('(5, ?, ?, ?, ?, ?, 0, ?, 0, \'mp4\', 0, 0, 1, ?, ?)');
    }

    // INSERT em streams (mesma estrutura do sistema antigo)
    const result = await this.conn.execute(
      `INSERT INTO streams 
        (type, category_id, stream_display_name, stream_source, stream_icon, notes, 
        enable_transcode, movie_propeties, read_native, target_container, stream_all, 
        remove_subtitles, direct_source, added, series_no)
        VALUES ${placeholders.join(', ')}`,
      values
    );

    if (result.affectedRows === 0) return 0;

    // Buscar IDs inseridos
    const firstId = result.insertId;
    const episodeIds = Array.from(
      { length: result.affectedRows },
      (_, i) => firstId + i
    );

    // ⚠️ CRÍTICO: INSERT em streams_episodes (vinculação série-episódio)
    const episodesValues: any[] = [];
    const episodesPlaceholders: string[] = [];
    
    for (let i = 0; i < Math.min(episodeIds.length, episodes.length); i++) {
      const streamId = episodeIds[i];
      const ep = episodes[i];
      episodesValues.push(streamId, seriesId, ep.season, ep.episode);
      episodesPlaceholders.push('(?, ?, ?, ?)');
    }

    if (episodesPlaceholders.length > 0) {
      await this.conn.execute(
        `INSERT INTO series_episodes (stream_id, series_id, season_num, sort)
         VALUES ${episodesPlaceholders.join(', ')}`,
        episodesValues
      );
      logger.info(`[SeriesImporter] ${episodesPlaceholders.length} registros inseridos em streams_episodes`);
    }

    // Vincular ao servidor
    if (serverId) {
      await this.linkToServer(episodeIds, serverId);
    }

    return result.affectedRows;
  }

  /**
   * Vincula episódios ao servidor
   */
  private async linkToServer(episodeIds: number[], serverId: number): Promise<void> {
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const id of episodeIds) {
      values.push(id, serverId, 0);
      placeholders.push('(?, ?, ?)');
    }

    try {
      await this.conn.execute(
        `INSERT IGNORE INTO streams_sys (stream_id, server_id, on_demand) 
         VALUES ${placeholders.join(', ')}`,
        values
      );
    } catch (error: any) {
      logger.warn(`[SeriesImporter] Erro ao vincular servidor: ${error.message}`);
    }
  }

  /**
   * Busca séries existentes
   * @param flexibleMatch - Quando true, também armazena títulos parciais (sem [L], [D], etc.)
   */
  private async getExistingSeries(flexibleMatch: boolean = false): Promise<Map<string, number>> {
    const series = await this.conn.query<{ id: number; title: string; tmdb_id: number | null }>(
      `SELECT id, title, tmdb_id FROM series`
    );

    const map = new Map<string, number>();
    for (const s of series) {
      // Chave exata normalizada
      map.set(this.normalizeTitle(s.title), s.id);
      
      // Chave por TMDB ID
      if (s.tmdb_id) {
        map.set(`tmdb:${s.tmdb_id}`, s.id);
      }
      
      // Chave flexível (título parcial sem [L], [D], etc.)
      if (flexibleMatch) {
        const partialTitle = this.normalizePartialTitle(s.title);
        if (!map.has(partialTitle)) {
          map.set(`partial:${partialTitle}`, s.id);
        }
      }
    }

    logger.info(`[SeriesImporter] ${series.length} séries existentes carregadas (flexível: ${flexibleMatch})`);
    return map;
  }

  /**
   * Busca episódios existentes (para fonte secundária)
   */
  private async getExistingEpisodes(): Promise<Map<string, number>> {
    const episodes = await this.conn.query<{ id: number; series_no: number; movie_properties: string; stream_display_name: string }>(
      `SELECT id, series_no, movie_propeties AS movie_properties, stream_display_name FROM streams WHERE type = 5 AND series_no IS NOT NULL`
    );

    const map = new Map<string, number>();
    for (const ep of episodes) {
      try {
        // Tentar extrair season/episode do movie_properties
        const props = JSON.parse(ep.movie_properties || '{}');
        if (props.season !== undefined && props.episode !== undefined) {
          const key = `${ep.series_no}:S${props.season}E${props.episode}`;
          map.set(key, ep.id);
        } else {
          // Fallback: usar nome do stream como chave
          const key = `${ep.series_no}:${ep.stream_display_name}`;
          map.set(key, ep.id);
        }
      } catch {
        // Se falhar parse, usar nome como chave
        const key = `${ep.series_no}:${ep.stream_display_name}`;
        map.set(key, ep.id);
      }
    }

    logger.info(`[SeriesImporter] ${episodes.length} episódios existentes carregados`);
    return map;
  }

  /**
   * Gera chave única para série
   */
  private getSeriesKey(series: SeriesInfo): string {
    if (series.tmdb_id) {
      return `tmdb:${series.tmdb_id}`;
    }
    return this.normalizeTitle(series.title);
  }

  /**
   * Normaliza título (completo)
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/^\s*(serie|série|series|tv|show)\s*[:\-–—]\s*/gi, '')
      .replace(/\s*\(\d{4}\)\s*/g, '')
      .replace(/\s+(?:19|20)\d{2}\s*$/g, '')
      .replace(/\s+(?:19|20)\d{2}\s+/g, ' ')
      .replace(/\b(4k|1080p|720p|hd|fhd|uhd|bluray|webrip|hdtv|web-?dl|bdrip|dvdrip)\b/gi, '')
      .replace(/\b(dublado|legendado|dual\s*audio|portuguese|english|ptbr|pt-br)\b/gi, '')
      .replace(/\b(online|oficial|premium|sd|hdr|hevc|x265|x264)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Normaliza título parcial (remove tags como [L], [D], (Legendado), etc.)
   * Usado para matching flexível entre séries com/sem tags
   */
  private normalizePartialTitle(title: string): string {
    return title
      .replace(/\s*\[L\]\s*/gi, '')  // Remove [L]
      .replace(/\s*\[D\]\s*/gi, '')  // Remove [D]
      .replace(/\s*\(Legendado\)\s*/gi, '')  // Remove (Legendado)
      .replace(/\s*\(Dublado\)\s*/gi, '')  // Remove (Dublado)
      .replace(/\s*Legendado\s*/gi, '')  // Remove Legendado
      .replace(/\s*Dublado\s*/gi, '')  // Remove Dublado
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/\s*\[.*?\]\s*/g, ' ')
      .toLowerCase()
      .replace(/\s*\(\d{4}\)\s*/g, '')
      .replace(/\s+(?:19|20)\d{2}\s*$/g, '')
      .replace(/\b(4k|1080p|720p|hd|fhd|uhd|bluray|webrip|hdtv|web-?dl|bdrip|dvdrip)\b/gi, '')
      .replace(/\b(dublado|legendado|dual\s*audio|portuguese|english|ptbr|pt-br)\b/gi, '')
      .replace(/\b(online|oficial|premium|sd|hdr|hevc|x265|x264)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Atualiza o campo seasons na tabela streams_series
   * Necessário para o XUI mostrar os episódios vinculados à série
   */
  private async updateSeriesSeasons(
    seriesId: number, 
    episodes: Omit<EpisodeData, 'seriesId'>[]
  ): Promise<void> {
    try {
      // Agrupar episódios por temporada
      const seasonMap = new Map<number, number>();
      for (const ep of episodes) {
        const current = seasonMap.get(ep.season) || 0;
        seasonMap.set(ep.season, current + 1);
      }

      // Construir array de seasons no formato esperado pelo XUI
      const seasons: any[] = [];
      for (const [seasonNum, episodeCount] of seasonMap) {
        seasons.push({
          id: seasonNum,              // ID (obrigatório)
          season_number: seasonNum,   // Número da temporada
          name: `Temporada ${seasonNum}`,
          episode_count: episodeCount,
          overview: '',
          air_date: '',
          vote_average: 0,            // Obrigatório
          cover: '',
          cover_big: ''
        });
      }

      // Ordenar por número da temporada
      seasons.sort((a, b) => a.season_number - b.season_number);

      // Atualizar no banco
      const seasonsJson = JSON.stringify(seasons);
      await this.conn.execute(
        `UPDATE series SET seasons = ? WHERE id = ?`,
        [seasonsJson, seriesId]
      );

      logger.info(`[SeriesImporter] Série ${seriesId}: ${seasons.length} temporadas atualizadas`);
    } catch (error: any) {
      logger.warn(`[SeriesImporter] Erro ao atualizar seasons da série ${seriesId}: ${error.message}`);
    }
  }

  private async mergeSeriesSeasons(
    seriesId: number,
    newEpisodes: Omit<EpisodeData, 'seriesId'>[]
  ): Promise<void> {
    try {
      if (!newEpisodes || newEpisodes.length === 0) return;

      const rows = await this.conn.query<{ seasons: string | null }>(
        `SELECT seasons FROM series WHERE id = ? LIMIT 1`,
        [seriesId]
      );
      const currentJson = rows?.[0]?.seasons || '[]';

      let seasons: any[] = [];
      try {
        const parsed = JSON.parse(currentJson);
        if (Array.isArray(parsed)) seasons = parsed;
      } catch {
        seasons = [];
      }

      const countBySeason = new Map<number, number>();
      for (const ep of newEpisodes) {
        countBySeason.set(ep.season, (countBySeason.get(ep.season) || 0) + 1);
      }

      const bySeasonNumber = new Map<number, any>();
      for (const s of seasons) {
        const sn = Number(s?.season_number ?? s?.id);
        if (Number.isFinite(sn)) bySeasonNumber.set(sn, s);
      }

      for (const [seasonNum, addCount] of countBySeason) {
        const existing = bySeasonNumber.get(seasonNum);
        if (existing) {
          const currentCount = Number(existing.episode_count) || 0;
          existing.episode_count = currentCount + addCount;
        } else {
          seasons.push({
            id: seasonNum,
            season_number: seasonNum,
            name: `Temporada ${seasonNum}`,
            episode_count: addCount,
            overview: '',
            air_date: '',
            vote_average: 0,
            cover: '',
            cover_big: ''
          });
        }
      }

      seasons.sort((a, b) => (Number(a?.season_number ?? a?.id) || 0) - (Number(b?.season_number ?? b?.id) || 0));
      await this.conn.execute(
        `UPDATE series SET seasons = ? WHERE id = ?`,
        [JSON.stringify(seasons), seriesId]
      );
    } catch (error: any) {
      logger.warn(`[SeriesImporter] Erro ao mesclar seasons da série ${seriesId}: ${error.message}`);
    }
  }

  private async updateExistingSeriesMetadata(seriesId: number, series: SeriesInfo): Promise<boolean> {
    const updates: string[] = [];
    const params: any[] = [];

    const cover = series.cover?.trim();
    if (cover) {
      updates.push('cover = ?');
      params.push(cover);
    }

    const coverBig = series.cover_big?.trim();
    if (coverBig) {
      updates.push('cover_big = ?');
      params.push(coverBig);
    }

    const plot = series.plot?.trim();
    if (plot) {
      updates.push('plot = ?');
      params.push(plot);
    }

    const genre = series.genre?.trim();
    if (genre) {
      updates.push('genre = ?');
      params.push(genre);
    }

    const cast = series.cast?.trim();
    if (cast) {
      updates.push('cast = ?');
      params.push(cast);
    }

    const director = series.director?.trim();
    if (director) {
      updates.push('director = ?');
      params.push(director);
    }

    const releaseDate = series.release_date?.trim();
    if (releaseDate) {
      updates.push('releaseDate = ?');
      params.push(releaseDate);
    }

    if (typeof series.rating === 'number' && series.rating > 0) {
      updates.push('rating = ?');
      params.push(series.rating);
    }

    if (series.tmdb_id && series.tmdb_id > 0) {
      updates.push('tmdb_id = ?');
      params.push(series.tmdb_id);
    }

    if (updates.length === 0) return false;

    updates.push('last_modified = ?');
    params.push(Math.floor(Date.now() / 1000));
    params.push(seriesId);

    const result = await this.conn.execute(
      `UPDATE series SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    return result.affectedRows > 0;
  }

  private async updateExistingEpisode(
    episodeId: number,
    ep: Omit<EpisodeData, 'seriesId'>,
    fallbackCategoryId: number[],
    serverId?: number
  ): Promise<boolean> {
    const streamSource = JSON.stringify(ep.stream_source || []);
    const categoryIdInt = (ep.category_id || fallbackCategoryId)[0] || 0;
    const streamIcon = ep.stream_icon && ep.stream_icon.trim() ? ep.stream_icon.trim() : null;

    const movieProperties = JSON.stringify({
      release_date: '',
      plot: '',
      duration_secs: 2700,
      duration: '00:45:00',
      movie_image: streamIcon || '',
      video: [],
      audio: [],
      bitrate: 0,
      rating: '0',
      season: ep.season.toString(),
      episode: ep.episode.toString(),
      tmdb_id: ''
    });

    const result = await this.conn.execute(
      `UPDATE streams 
       SET category_id = ?, stream_source = ?, stream_icon = ?, movie_propeties = ?
       WHERE id = ? AND type = 5`,
      [categoryIdInt, streamSource, streamIcon, movieProperties, episodeId]
    );

    if (serverId) {
      await this.linkToServer([episodeId], serverId);
    }

    return result.affectedRows > 0;
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect();
    await this.categoryManager.disconnect();
    await this.bouquetManager.disconnect();
  }
}
