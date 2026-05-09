/**
 * Movie Importer - Importação simplificada de filmes
 * 
 * SEGURO: 
 * - Apenas INSERT na tabela streams (type=2)
 * - Apenas INSERT em streams_servers
 * - Apenas INSERT em movie_properties
 * - NÃO usa API edit_movie (que sobrescreve dados)
 * - NÃO modifica filmes existentes
 */

import { createLogger } from '../../utils/logger.js';
import { XUIConnection } from './xui-connection.js';
import { CategoryManager } from './category-manager.js';
import { BouquetManager } from './bouquet-manager.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('MovieImporter');

export interface MovieData {
  stream_display_name: string;
  stream_source: string[];
  stream_icon?: string;
  category_id: number[];
  movie_properties?: {
    kinopoisk_url?: string;
    tmdb_id?: string | number;
    name?: string;
    o_name?: string;
    imdb_id?: string;
    cover_big?: string;
    movie_image?: string;
    release_date?: string;
    episode_run_time?: string;
    youtube_trailer?: string;
    director?: string;
    actors?: string;
    cast?: string;
    description?: string;
    plot?: string;
    age?: string;
    mpaa_rating?: string;
    rating_count_kinopoisk?: number;
    genre?: string;
    country?: string;
    backdrop_path?: string[];
    duration_secs?: number;
    duration?: string;
    video?: any[];
    audio?: any[];
    bitrate?: number;
    rating?: string | number;
    year?: number;
  };
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: number;
  insertedIds: number[];
  updatedIds: number[];
  duration: number;
}

export interface ImportOptions {
  serverId?: number;
  bouquetId?: number;
  bouquetIds?: number[];
  batchSize?: number;
  skipDuplicates?: boolean;
  validateCategories?: boolean;
  updateExisting?: boolean;
  onProgress?: (progress: { current: number; total: number; message?: string }) => void;
}

export class MovieImporter {
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
   * Importa filmes em lote
   * SEGURO: Apenas INSERT, não modifica existentes
   */
  async importMovies(movies: MovieData[], options: ImportOptions = {}): Promise<ImportResult> {
    const startTime = Date.now();
    // 🚀 OTIMIZAÇÃO: Batch size aumentado de 500 para 1000
    const batchSize = options.batchSize || 1000;
    
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    const insertedIds: number[] = [];
    const updatedIds: number[] = [];
    const affectedForBouquets: number[] = [];

    logger.info(`[MovieImporter] Iniciando importação de ${movies.length} filmes`);
    logger.info(`[MovieImporter] DEBUG: serverId=${options.serverId}, skipDuplicates=${options.skipDuplicates}, batchSize=${batchSize}`);

    // 1. Validar categorias se solicitado
    if (options.validateCategories) {
      await this.validateCategories(movies);
    }

    // 2. Buscar filmes existentes para evitar duplicados
    let existingMovies: Map<string, number>;
    try {
      existingMovies = options.skipDuplicates !== false 
        ? await this.getExistingMovies() 
        : new Map<string, number>();
      logger.info(`[MovieImporter] DEBUG: ${existingMovies.size} filmes existentes carregados`);
    } catch (loadErr: any) {
      logger.error(`[MovieImporter] ERRO ao carregar filmes existentes: ${JSON.stringify({ msg: loadErr?.message, code: loadErr?.code, errno: loadErr?.errno, sqlMsg: loadErr?.sqlMessage, name: loadErr?.name, constructor: loadErr?.constructor?.name, keys: loadErr ? Object.keys(loadErr) : 'null', str: String(loadErr)?.substring(0, 500) })}`);
      throw loadErr;
    }

    // 3. Processar em lotes
    for (let i = 0; i < movies.length; i += batchSize) {
      const batch = movies.slice(i, i + batchSize);
      
      try {
        const result = await this.insertBatch(batch, existingMovies, options.serverId, options.updateExisting === true);
        inserted += result.inserted;
        skipped += result.skipped;
        insertedIds.push(...result.insertedIds);
        updatedIds.push(...result.updatedIds);
        affectedForBouquets.push(...result.insertedIds, ...result.updatedIds);
        
        logger.info(`[MovieImporter] Lote ${Math.floor(i/batchSize) + 1}: ${result.inserted} inseridos, ${result.skipped} ignorados`);

        if (options.onProgress) {
          const lastTitle = batch[batch.length - 1]?.stream_display_name;
          options.onProgress({
            current: Math.min(i + batch.length, movies.length),
            total: movies.length,
            message: `📥 Inserindo filmes: ${inserted}/${movies.length} (último: ${lastTitle || '—'})`,
          });
        }
      } catch (error: any) {
        logger.error(`[MovieImporter] Erro no lote ${Math.floor(i/batchSize) + 1}:`, JSON.stringify({ message: error.message, code: error.code, errno: error.errno, sqlMessage: error.sqlMessage, sql: error.sql?.substring(0, 200) }));
        errors += batch.length;
      }
    }

    // 4. Adicionar ao(s) bouquet(s) se especificado
    const targetBouquetIds = Array.from(
      new Set([
        ...(Array.isArray(options.bouquetIds) ? options.bouquetIds : []),
        ...(options.bouquetId ? [options.bouquetId] : []),
      ].filter((v) => Number.isFinite(v) && v > 0))
    );
    const uniqueAffectedForBouquets = Array.from(new Set(affectedForBouquets)).filter((v) => Number.isFinite(v) && v > 0);
    if (targetBouquetIds.length > 0 && uniqueAffectedForBouquets.length > 0) {
      for (const id of targetBouquetIds) {
        try {
          await this.bouquetManager.addMoviesToBouquet(id, uniqueAffectedForBouquets);
        } catch (bouquetErr: any) {
          logger.warn(`[MovieImporter] Erro ao adicionar ao bouquet ${id} (não crítico): ${bouquetErr?.message || bouquetErr}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[MovieImporter] Importação concluída: ${inserted} inseridos, ${skipped} ignorados, ${errors} erros (${duration}ms)`);

    return { inserted, skipped, errors, insertedIds, updatedIds, duration };
  }

  /**
   * Insere um lote de filmes
   */
  private async insertBatch(
    movies: MovieData[], 
    existingMovies: Map<string, number>,
    serverId?: number,
    updateExisting: boolean = false
  ): Promise<{ inserted: number; skipped: number; insertedIds: number[]; updatedIds: number[] }> {
    const now = Math.floor(Date.now() / 1000);
    const moviesToInsert: MovieData[] = [];
    const moviesToUpdate: Array<{ id: number; movie: MovieData }> = [];
    let skipped = 0;

    // Filtrar duplicados usando múltiplas chaves
    const duplicateStats = { byTmdb: 0, byName: 0, byUrl: 0 };
    
    for (const movie of movies) {
      const check = this.isDuplicate(movie, existingMovies);
      if (check.isDuplicate) {
        if (updateExisting && check.existingId && check.existingId > 0) {
          moviesToUpdate.push({ id: check.existingId, movie });
        } else {
          skipped++;
        }
        if (check.matchType === 'tmdb') duplicateStats.byTmdb++;
        else if (check.matchType === 'name') duplicateStats.byName++;
        else if (check.matchType === 'url') duplicateStats.byUrl++;
        continue;
      }
      moviesToInsert.push(movie);
      // Marcar todas as chaves como usadas para evitar duplicados no mesmo lote
      for (const key of this.getMovieKeys(movie)) {
        existingMovies.set(key, -1);
      }
    }
    
    if (skipped > 0) {
      logger.debug(`[MovieImporter] Duplicados ignorados: ${duplicateStats.byTmdb} por TMDB, ${duplicateStats.byName} por nome, ${duplicateStats.byUrl} por URL`);
    }

    const updatedIds: number[] = [];
    if (moviesToUpdate.length > 0) {
      for (const u of moviesToUpdate) {
        try {
          const movieProps = JSON.stringify(u.movie.movie_properties || { name: u.movie.stream_display_name });
          const streamIcon = u.movie.stream_icon || '';
          await this.conn.execute(
            `UPDATE streams SET stream_icon = ?, movie_propeties = ? WHERE id = ? AND type = 2`,
            [streamIcon, movieProps, u.id]
          );
          updatedIds.push(u.id);
        } catch (e: any) {
          logger.warn(`[MovieImporter] Erro ao atualizar filme ${u.id} (não crítico): ${e?.message || e}`);
        }
      }
    }

    if (moviesToInsert.length === 0) {
      return { inserted: 0, skipped, insertedIds: [], updatedIds };
    }

    // Preparar valores para INSERT
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const movie of moviesToInsert) {
      const streamSource = JSON.stringify(movie.stream_source || []);
      const categoryIdInt = movie.category_id[0] || 0; // Xtream UI usa int, nao JSON array
      const movieProps = JSON.stringify(movie.movie_properties || { name: movie.stream_display_name });
      
      values.push(
        2,                              // type = movie
        categoryIdInt,                  // category_id (int no Xtream UI)
        movie.stream_display_name,      // stream_display_name
        streamSource,                   // stream_source
        movie.stream_icon || '',        // stream_icon (NOT NULL no Xtream UI)
        movieProps,                     // movie_propeties
        'mp4',                          // target_container
        1,                              // direct_source = 1
        now,                            // added
        0,                              // read_native = 0
      );

      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    }

    // Executar INSERT
    await this.conn.beginTransaction();
    
    try {
      const result = await this.conn.execute(
        `INSERT INTO streams (
          type, category_id, stream_display_name, stream_source, stream_icon,
          movie_propeties, target_container, direct_source, added, read_native
        ) VALUES ${placeholders.join(', ')}`,
        values
      );

      const firstInsertId = result.insertId;
      const insertedIds = Array.from(
        { length: result.affectedRows }, 
        (_, i) => firstInsertId + i
      );

      // Vincular ao servidor
      if (serverId && insertedIds.length > 0) {
        await this.linkToServer(insertedIds, serverId);
      }

      await this.conn.commit();
      return { inserted: insertedIds.length, skipped, insertedIds, updatedIds };
      
    } catch (error: any) {
      logger.error(`[MovieImporter] insertBatch ERRO: ${JSON.stringify({ msg: error?.message, code: error?.code, errno: error?.errno, sqlMsg: error?.sqlMessage, sql: error?.sql?.substring(0, 300) })}`);
      await this.conn.rollback();
      throw error;
    }
  }

  /**
   * Insere metadados na tabela movie_properties
   */
  private async insertMovieProperties(movies: MovieData[], ids: number[]): Promise<void> {
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let i = 0; i < movies.length && i < ids.length; i++) {
      const movie = movies[i];
      const streamId = ids[i];
      const props = movie.movie_properties;

      if (!props?.tmdb_id) continue;

      values.push(
        streamId,
        props.tmdb_id,
        props.name || movie.stream_display_name,
        props.o_name || props.name || movie.stream_display_name,
        props.cover_big || props.movie_image || null,
        props.movie_image || props.cover_big || null,
        props.release_date || null,
        props.youtube_trailer || null,
        props.director || null,
        props.actors || props.cast || null,
        props.cast || props.actors || null,
        props.description || props.plot || null,
        props.plot || props.description || null,
        props.genre || null,
        props.country || null,
        props.duration_secs || 0,
        props.duration || null,
        props.rating || null,
        props.year || null
      );
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    }

    if (placeholders.length === 0) return;

    try {
      await this.conn.execute(
        `INSERT INTO movie_properties (
          stream_id, tmdb_id, name, o_name, cover_big, movie_image,
          release_date, youtube_trailer, director, actors, cast,
          description, plot, genre, country, duration_secs, duration,
          rating, year
        ) VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          tmdb_id = VALUES(tmdb_id),
          name = VALUES(name),
          cover_big = VALUES(cover_big),
          movie_image = VALUES(movie_image),
          rating = VALUES(rating)`,
        values
      );
    } catch (error: any) {
      logger.warn(`[MovieImporter] Erro ao inserir movie_properties (não crítico): ${error.message}`);
    }
  }

  /**
   * Vincula filmes ao servidor de streaming
   */
  private async linkToServer(movieIds: number[], serverId: number): Promise<void> {
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const id of movieIds) {
      values.push(id, serverId, 0); // on_demand = 0 (Direct)
      placeholders.push('(?, ?, ?)');
    }

    try {
      await this.conn.execute(
        `INSERT IGNORE INTO streams_sys (stream_id, server_id, on_demand) 
         VALUES ${placeholders.join(', ')}`,
        values
      );
      logger.info(`[MovieImporter] ${movieIds.length} filmes vinculados ao servidor ${serverId}`);
    } catch (error: any) {
      logger.warn(`[MovieImporter] Erro ao vincular servidor (não crítico): ${error.message}`);
    }
  }

  /**
 * Busca filmes existentes para detecção de duplicados
 * Usa múltiplas chaves: tmdb_id, nome normalizado
 * 
 * OTIMIZAÇÃO: Carrega em lotes de 5000 e NÃO carrega stream_source
 * para evitar OOM em tabelas grandes (19K+ filmes = 372MB)
 */
private async getExistingMovies(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const BATCH_SIZE = 5000;
    let offset = 0;
    let totalLoaded = 0;

    while (true) {
      const movies = await this.conn.query<{
        id: number;
        stream_display_name: string;
        url0: string | null;
        tmdb_id: string | null;
      }>(
        `SELECT 
           id, 
           stream_display_name,
           CASE 
             WHEN stream_source IS NOT NULL AND JSON_VALID(stream_source) THEN JSON_UNQUOTE(JSON_EXTRACT(stream_source, '$[0]'))
             ELSE NULL
           END AS url0,
           CASE 
             WHEN movie_propeties IS NOT NULL AND JSON_VALID(movie_propeties) THEN JSON_UNQUOTE(JSON_EXTRACT(movie_propeties, '$.tmdb_id'))
             ELSE NULL
           END AS tmdb_id
         FROM streams 
         WHERE type = 2 
         LIMIT ${BATCH_SIZE} OFFSET ${offset}`
      );

      if (movies.length === 0) break;

      for (const m of movies) {
        // Chave por nome normalizado
        const normalizedName = this.normalizeTitle(m.stream_display_name);
        if (normalizedName.length > 3) {
          map.set(`name:${normalizedName}`, m.id);
        }

        const tmdbIdNum = m.tmdb_id ? parseInt(String(m.tmdb_id), 10) : NaN;
        if (Number.isFinite(tmdbIdNum) && tmdbIdNum > 0) {
          map.set(`tmdb:${tmdbIdNum}`, m.id);
        }

        if (m.url0 && typeof m.url0 === 'string' && m.url0.length > 5) {
          map.set(`url:${this.hashUrl(m.url0)}`, m.id);
        }
      }

      totalLoaded += movies.length;
      offset += BATCH_SIZE;

      if (movies.length < BATCH_SIZE) break;
    }

    logger.info(`[MovieImporter] ${totalLoaded} filmes existentes carregados em lotes (${map.size} chaves de detecção)`);
    return map;
  }

  /**
   * Gera chaves únicas para o filme (múltiplas para maior precisão)
   */
  private getMovieKeys(movie: MovieData): string[] {
    const keys: string[] = [];
    
    // 1. tmdb_id (mais confiável)
    if (movie.movie_properties?.tmdb_id) {
      keys.push(`tmdb:${movie.movie_properties.tmdb_id}`);
    }
    
    // 2. Nome normalizado
    const normalizedName = this.normalizeTitle(movie.stream_display_name);
    if (normalizedName.length > 3) {
      keys.push(`name:${normalizedName}`);
    }
    
    // 3. Hash da URL
    if (movie.stream_source?.length > 0) {
      keys.push(`url:${this.hashUrl(movie.stream_source[0])}`);
    }
    
    return keys;
  }

  /**
   * Verifica se filme é duplicado
   */
  private isDuplicate(movie: MovieData, existingMovies: Map<string, number>): { isDuplicate: boolean; existingId?: number; matchType?: string } {
    const keys = this.getMovieKeys(movie);
    
    for (const key of keys) {
      if (existingMovies.has(key)) {
        const matchType = key.split(':')[0]; // tmdb, name, ou url
        return { isDuplicate: true, existingId: existingMovies.get(key), matchType };
      }
    }
    
    return { isDuplicate: false };
  }

  /**
   * Gera hash simples da URL
   */
  private hashUrl(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Normaliza título para comparação
   * Remove ano, qualidade, caracteres especiais
   * Ex: "AVATAR 2019" e "AVATAR" -> "avatar"
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      // Remover prefixos comuns
      .replace(/^\s*(filme|movie|vod|cinema)\s*[:\-–—]\s*/gi, '')
      // Remover ano entre parênteses: "Filme (2024)" -> "Filme"
      .replace(/\s*\(\d{4}\)\s*/g, '')
      // Remover ano no final sem parênteses: "AVATAR 2019" -> "AVATAR"
      .replace(/\s+(?:19|20)\d{2}\s*$/g, '')
      // Remover ano no meio: "Avatar 2019 HD" -> "Avatar HD"
      .replace(/\s+(?:19|20)\d{2}\s+/g, ' ')
      // Remover qualidade: "4K", "1080p", "720p", "HD", "FHD"
      .replace(/\b(4k|1080p|720p|hd|fhd|uhd|bluray|webrip|hdtv|web-?dl|bdrip|dvdrip)\b/gi, '')
      // Remover idioma: "Dublado", "Legendado", "Dual Audio"
      .replace(/\b(dublado|legendado|dual\s*audio|portuguese|english|ptbr|pt-br)\b/gi, '')
      // Remover marcadores comuns em listas
      .replace(/\b(online|oficial|premium|sd|hdr|hevc|x265|x264)\b/gi, '')
      // Remover caracteres especiais
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Valida que todas as categorias existem
   */
  private async validateCategories(movies: MovieData[]): Promise<void> {
    const categoryIds = new Set<number>();
    for (const movie of movies) {
      for (const catId of movie.category_id) {
        categoryIds.add(catId);
      }
    }

    for (const catId of Array.from(categoryIds)) {
      const exists = await this.categoryManager.categoryExists(catId);
      if (!exists) {
        logger.warn(`[MovieImporter] ⚠️ Categoria ${catId} não existe no XUI`);
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect();
    await this.categoryManager.disconnect();
    await this.bouquetManager.disconnect();
  }
}
