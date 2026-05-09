/**
 * Cliente MySQL direto para operações VOD em massa
 * Usado para importação rápida de grandes volumes (100k+ itens)
 * Padrão: Similar ao XUIDBClient usado para linhas
 * 
 * ✅ REFATORADO: Agora usa connection pool para evitar bloqueio do XUI
 */

import * as mysql from 'mysql2/promise';
import { createLogger } from '../../utils/logger.js';
import type { XuiServer } from '@prisma/client';
import { xuiMySQLPool } from './xui-mysql-pool.service.js';
import { type MovieItem, extractYear, generateStreamHash, normalizeTitle } from '../../utils/duplicate-detector.js';

const logger = createLogger('XUIVodDBClient');

type Connection = mysql.Connection;

export interface MovieData {
  stream_display_name: string;
  stream_source: string[]; // Array de URLs
  stream_icon?: string;
  category_id: number[];
  movie_properties?: {
    name?: string;
    o_name?: string;
    tmdb_id?: number;
    imdb_id?: string;
    cover_big?: string;
    movie_image?: string;
    release_date?: string;
    youtube_trailer?: string;
    director?: string;
    actors?: string;
    cast?: string;
    description?: string;
    plot?: string;
    genre?: string;
    country?: string;
    duration_secs?: number;
    duration?: string;
    rating?: number;
    year?: number;
  };
}

// DEPRECATED: SeriesData antiga (usava streams com type=3)
export interface SeriesData {
  stream_display_name: string;
  category_id: number[];
  cover?: string;
  movie_properties?: {
    name?: string;
    tmdb_id?: number;
    plot?: string;
    genre?: string;
    cast?: string;
    rating?: number;
    director?: string;
    release_date?: string;
    episode_run_time?: string;
  };
}

// Interface para Canais LIVE (type = 1)
export interface LiveChannelData {
  stream_display_name: string;  // Nome do canal
  stream_source: string[];       // Array de URLs do stream
  stream_icon?: string;          // Logo do canal
  category_id: number[];         // Array de IDs de categoria
  target_container?: string;     // Container (ts, mp4, etc)
  direct_source?: number;        // 1 = URL direta, 0 = transcoded
  read_native?: number;          // 0 = padrão (aparece no painel)
  direct_proxy?: number;         // 0 = desabilitado, 1 = habilitado
  enable_transcode?: number;     // 0 = desabilitado, 1 = habilitado
  stream_all?: number;           // 0 = desabilitado, 1 = habilitado
  gen_timestamps?: number;       // ⚠️ CRÍTICO: 1 = gerar PTS (necessário para play azul)
}

// NOVA: Dados de série para streams_series
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
  episode_run_time?: number;
}

// NOVA: Dados de episódio para streams (type=5)
export interface EpisodeData {
  seriesId: number; // ID da série em streams_series (OBRIGATÓRIO!)
  season: number;
  episode: number;
  stream_display_name: string;
  stream_source: string[]; // Array de URLs
  stream_icon?: string;
  category_id: number[];
}

export class XUIVodDBClient {
  private connection: Connection | null = null;
  private server: XuiServer;

  constructor(server: XuiServer) {
    this.server = server;
  }

  async updateMovieMetadata(
    streamId: number,
    movieProperties: Record<string, any>,
    streamIcon?: string | null,
    tmdbId?: number | null,
    rating?: number | null
  ): Promise<void> {
    const conn = await this.connect();

    const moviePropsJson = JSON.stringify(movieProperties || {});
    const iconValue = streamIcon && streamIcon.trim() ? streamIcon.trim() : null;

    try {
      await conn.query(
        `UPDATE streams
         SET movie_propeties = ?,
             stream_icon = COALESCE(stream_icon, ?),
             tmdb_id = COALESCE(?, tmdb_id),
             tmdb_language = COALESCE(tmdb_language, 'pt-BR'),
             rating = COALESCE(?, rating),
             updated = NOW()
         WHERE id = ?
         LIMIT 1`,
        [moviePropsJson, iconValue, tmdbId ?? null, rating ?? null, streamId]
      );
    } catch (error: any) {
      // Fallback para instalações que não têm todas as colunas
      logger.warn(`[XUIVodDB] Fallback updateMovieMetadata (colunas ausentes?) para stream ${streamId}:`, error.message);
      
      // Fallback mínimo: apenas movie_properties + stream_icon
      await conn.query(
        `UPDATE streams
         SET movie_propeties = ?,
             stream_icon = COALESCE(stream_icon, ?),
             updated = NOW()
         WHERE id = ?
         LIMIT 1`,
        [moviePropsJson, iconValue, streamId]
      );
    }
    
    // ⚠️ CORREÇÃO CRÍTICA: Também inserir/atualizar na tabela movie_properties separada
    // O XUI usa essa tabela para exibir os metadados TMDB no painel
    if (movieProperties && (movieProperties.tmdb_id || tmdbId)) {
      try {
        const props = movieProperties;
        await conn.query(
          `INSERT INTO movie_properties (
            stream_id, tmdb_id, name, o_name, cover_big, movie_image,
            releaseDate, youtube_trailer, director, actors, cast,
            description, plot, genre, country, duration_secs, duration,
            rating, year
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            tmdb_id = VALUES(tmdb_id),
            name = VALUES(name),
            o_name = VALUES(o_name),
            cover_big = VALUES(cover_big),
            movie_image = VALUES(movie_image),
            releaseDate = VALUES(releaseDate),
            youtube_trailer = VALUES(youtube_trailer),
            director = VALUES(director),
            actors = VALUES(actors),
            cast = VALUES(cast),
            description = VALUES(description),
            plot = VALUES(plot),
            genre = VALUES(genre),
            country = VALUES(country),
            duration_secs = VALUES(duration_secs),
            duration = VALUES(duration),
            rating = VALUES(rating),
            year = VALUES(year)`,
          [
            streamId,
            props.tmdb_id || tmdbId || null,
            props.name || null,
            props.o_name || props.name || null,
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
            props.rating || rating || null,
            props.year || null
          ]
        );
        logger.debug(`[XUIVodDB] ✅ movie_properties atualizado para stream ${streamId}`);
      } catch (mpError: any) {
        // Se a tabela não existir, logar mas não falhar
        logger.debug(`[XUIVodDB] Tabela movie_properties não disponível: ${mpError.message}`);
      }
    }
  }

  /**
   * ✅ REFATORADO: Usa connection pool em vez de conexão individual
   * Reduz de 100+ conexões para 5 máximo (evita bloqueio do XUI)
   */
  async connect(): Promise<Connection> {
    // ⚠️ MUDANÇA CRÍTICA: Agora usa pool connection
    if (this.connection) {
      return this.connection;
    }

    if (!this.server.dbHost || !this.server.dbUser) {
      throw new Error('Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.');
    }

    // Usar pool em vez de createConnection()
    this.connection = await xuiMySQLPool.getConnection(this.server);
    
    logger.info('[XUIVodDB] Conexão adquirida do pool', { 
      host: this.server.dbHost,
      poolStats: xuiMySQLPool.getStats()
    });
    
    // ✅ CORREÇÃO TIMEOUT: Aumentar wait_timeout para 1 hora (3600s)
    // Isso evita que a conexão expire durante importações longas (10k+ filmes)
    try {
      await this.connection.query('SET SESSION wait_timeout = 3600');
      await this.connection.query('SET SESSION interactive_timeout = 3600');
      logger.info('[XUIVodDB] ✅ Timeouts MySQL estendidos para 1 hora');
    } catch (err: any) {
      logger.warn('[XUIVodDB] Não foi possível estender timeout (não crítico):', err.message);
    }
    
    return this.connection;
  }

  /**
   * Desconecta do MySQL (libera conexão do pool)
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      // ✅ CORREÇÃO: Usar release() ao invés de end() para pool
      try {
        (this.connection as any).release();
        logger.info('[XUIVodDB] Conexão liberada de volta ao pool');
      } catch (err: any) {
        // Fallback para end() se release() não existir
        await this.connection.end();
        logger.info('[XUIVodDB] Desconectado do MySQL (fallback)');
      }
      this.connection = null;
    }
  }

  /**
   * Importação em massa de filmes (INSERT direto no MySQL)
   * @param movies Array de filmes para importar
   * @param batchSize Tamanho do lote (padrão: 1000)
   */
  /**
   * Verifica se um filme já existe (por URL ou nome)
   */
  private async checkMovieExists(conn: Connection, movie: MovieData): Promise<boolean> {
    try {
      // Verificar por URL (mais confiável)
      if (movie.stream_source && movie.stream_source.length > 0) {
        const firstUrl = movie.stream_source[0];
        const [urlRows] = await conn.query<any[]>(
          `SELECT id FROM streams 
           WHERE type = 2 
           AND JSON_CONTAINS(stream_source, ?) 
           LIMIT 1`,
          [JSON.stringify(firstUrl)]
        );
        if (urlRows.length > 0) {
          return true;
        }
      }

      // Verificar por nome (fallback)
      const [nameRows] = await conn.query<any[]>(
        `SELECT id FROM streams 
         WHERE type = 2 
         AND stream_display_name = ? 
         LIMIT 1`,
        [movie.stream_display_name]
      );
      return nameRows.length > 0;
    } catch (error: any) {
      logger.warn('[XUIVodDB] Erro ao verificar duplicado:', error.message);
      return false; // Em caso de erro, permite inserir
    }
  }

  /**
   * 🆕 NOVA FUNCIONALIDADE: Atualiza categorias de filmes existentes (duplicados)
   * Adiciona categorias de ano a filmes que já existem no banco
   * @param movies Filmes com novas categorias a adicionar
   * @param yearCategoryMap Mapa de ano → categoryId das categorias especiais
   * @returns Número de filmes atualizados
   */
  async updateExistingMovieCategories(
    movies: MovieData[],
    yearCategoryMap: Map<number, number>
  ): Promise<{ updated: number; notFound: number }> {
    const conn = await this.connect();
    let updated = 0;
    let notFound = 0;

    try {
      // 🚀 OTIMIZAÇÃO SÊNIOR: Processar em lotes grandes para evitar milhares de queries
      const BATCH_SIZE = 500;
      for (let i = 0; i < movies.length; i += BATCH_SIZE) {
        const batch = movies.slice(i, i + BATCH_SIZE);
        
        try {
          await conn.beginTransaction();

          // 1. Coletar todos os stream_sources do lote
          const sourceMap = new Map<string, MovieData>();
          batch.forEach(m => {
            const src = JSON.stringify(m.stream_source || []);
            if (src !== '[]') sourceMap.set(src, m);
          });

          if (sourceMap.size === 0) {
            await conn.commit();
            continue;
          }

          const sources = Array.from(sourceMap.keys());
          const placeholders = sources.map(() => '?').join(',');

          // 2. Buscar todos os filmes existentes do lote de uma vez
          const [existing] = await conn.query<any[]>(
            `SELECT id, category_id, stream_source, stream_display_name FROM streams 
             WHERE type = 2 AND stream_source IN (${placeholders})`,
            sources
          );

          if (existing.length === 0) {
            notFound += batch.length;
            await conn.commit();
            continue;
          }

          // 3. Processar cada filme encontrado
          for (const row of existing) {
            const existingId = row.id;
            const existingSource = row.stream_source;
            const cleanName = row.stream_display_name;
            
            // Tentar encontrar o objeto original para pegar o ano
            const originalMovie = sourceMap.get(existingSource);
            if (!originalMovie) continue;

            // Parse categorias existentes
            let currentCategories: number[] = [];
            try {
              const parsed = JSON.parse(row.category_id || '[]');
              if (Array.isArray(parsed)) {
                currentCategories = parsed.map((id: any) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
              }
            } catch (e) {
              logger.warn(`[XUIVodDB] Erro ao parsear category_id do filme ${existingId}: ${e}`);
            }

            // Detectar ano do filme
            let movieYear: number | null = null;
            const yearPatterns = [
              /\((\d{4})\)/,           // (2025)
              /\[(\d{4})\]/,           // [2025]
              /\s+-\s+(\d{4})$/,       // - 2025 (no final)
              /\s+(\d{4})\s*-[^\d]*$/, // 2025 - alguma coisa (no final)
            ];
            
            for (const pattern of yearPatterns) {
              const match = cleanName.match(pattern);
              if (match) {
                const year = parseInt(match[1], 10);
                if (year >= 1900 && year <= 2100) {
                  movieYear = year;
                  break;
                }
              }
            }

            // Se tem ano e esse ano está no mapa de categorias especiais
            if (movieYear && yearCategoryMap.has(movieYear)) {
              const yearCategoryId = yearCategoryMap.get(movieYear)!;
              
              if (!currentCategories.includes(yearCategoryId)) {
                const newCategories = [...currentCategories, yearCategoryId];
                const newCategoryJson = `[${newCategories.join(',')}]`;
                
                await conn.query(
                  `UPDATE streams SET category_id = ? WHERE id = ?`,
                  [newCategoryJson, existingId]
                );
                updated++;
              }
            }
          }

          await conn.commit();
          
          if (i % 5000 === 0 && i > 0) {
            logger.info(`[XUIVodDB] Progresso: ${i}/${movies.length} filmes verificados para categorias de ano...`);
          }
        } catch (batchError: any) {
          await conn.rollback();
          logger.error(`[XUIVodDB] Erro no lote de atualização de categorias: ${batchError.message}`);
        }
      }
    } catch (error: any) {
      logger.error(`[XUIVodDB] Erro fatal em updateExistingMovieCategories: ${error.message}`);
    }

    logger.info(`[XUIVodDB] ✅ ${updated} filmes existentes atualizados com categorias de ano`);
    return { updated, notFound };
  }

  /**
   * 🚀 OTIMIZAÇÃO: Inserção em lotes paralelos menores (30-50 itens)
   * @param skipDuplicates - Se true, verifica duplicatas antes de inserir
   * @param forceFreshImport - Se true, desabilita verificação de duplicatas (usar após clearBeforeImport)
   */
  async bulkInsertMovies(
    movies: MovieData[],
    batchSize = 50,
    skipDuplicates = true,
    serverId?: number,
    forceFreshImport = false
  ): Promise<{ inserted: number; errors: number; skipped: number; insertedIds: number[]; insertedMovies: Array<{ id: number; movie: MovieData }>; skippedIds: number[] }> {
    const conn = await this.connect();
    const now = Math.floor(Date.now() / 1000);
    
    let inserted = 0;
    let errors = 0;
    let skipped = 0;
    const insertedIds: number[] = [];
    const insertedMovies: Array<{ id: number; movie: MovieData }> = [];
    const skippedIds: number[] = []; // IDs de filmes duplicados (já existem no banco)

    // ✅ KEEPALIVE: Fazer ping a cada 5 minutos para manter conexão viva
    let lastPingTime = Date.now();
    const PING_INTERVAL = 5 * 60 * 1000; // 5 minutos
    
    const keepAlive = async () => {
      const now = Date.now();
      if (now - lastPingTime > PING_INTERVAL) {
        try {
          await conn.query('SELECT 1');
          logger.debug('[XUIVodDB] ✅ Keepalive: Conexão MySQL ainda ativa');
          lastPingTime = now;
        } catch (err: any) {
          logger.error('[XUIVodDB] ❌ Keepalive falhou:', err.message);
        }
      }
    };

    let shouldCheckDuplicates = skipDuplicates && movies.length > 0 && !forceFreshImport;
    const tmdbIdSet = new Set<number>();
    const imdbIdSet = new Set<string>();
    const nameLooseSet = new Set<string>();
    const nameYearSet = new Set<string>();
    const streamHashSet = new Set<string>();

    // Mapas para encontrar IDs de filmes existentes (para bouquet)
    const tmdbIdToStreamId = new Map<number, number>();
    const imdbIdToStreamId = new Map<string, number>();
    const nameYearToStreamId = new Map<string, number>();
    const nameLooseToStreamId = new Map<string, number>();
    const streamHashToStreamId = new Map<string, number>();

    if (shouldCheckDuplicates) {
      const [countResult] = await conn.query<any[]>(
        `SELECT COUNT(*) as total FROM streams WHERE type = 2 LIMIT 1`
      );
      const hasMovies = countResult[0]?.total > 0;
      logger.info(`[XUIVodDB] 📈 Banco tem filmes? ${hasMovies} (total: ${countResult[0]?.total})`);
      if (!hasMovies) {
        shouldCheckDuplicates = false;
      }
    }

    if (shouldCheckDuplicates) {
      let existingMovies: any[] = [];
      try {
        [existingMovies] = await conn.query<any[]>(
          `SELECT s.id as stream_id, s.stream_display_name, 
                  mp.tmdb_id, mp.imdb_id, mp.name, mp.o_name, mp.release_date,
                  s.stream_source
           FROM streams s
           LEFT JOIN movie_properties mp ON s.id = mp.stream_id
           WHERE s.type = 2
           ORDER BY s.id DESC
           LIMIT 50000`
        );
        logger.info(`[XUIVodDB] 📊 Carregados ${existingMovies.length} filmes existentes para deduplicação`);
      } catch (error: any) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
          logger.warn(`[XUIVodDB] ⚠️ Tabela movie_properties não existe - usando apenas streams para detecção de duplicatas`);
          [existingMovies] = await conn.query<any[]>(
            `SELECT id as stream_id, stream_display_name, stream_source
             FROM streams
             WHERE type = 2
             ORDER BY id DESC
             LIMIT 50000`
          );
          logger.info(`[XUIVodDB] 📊 Carregados ${existingMovies.length} filmes existentes (sem movie_properties)`);
        } else {
          throw error;
        }
      }

      const safeFirstUrl = (streamSource: any): string | undefined => {
        if (!streamSource) return undefined;
        if (Array.isArray(streamSource)) return streamSource[0];
        if (typeof streamSource === 'string') {
          try {
            const parsed = JSON.parse(streamSource || '[]');
            return Array.isArray(parsed) ? parsed[0] : undefined;
          } catch {
            return streamSource;
          }
        }
        return undefined;
      };

      for (const row of existingMovies) {
        const streamId = row.stream_id;
        if (row.tmdb_id) {
          tmdbIdSet.add(Number(row.tmdb_id));
          tmdbIdToStreamId.set(Number(row.tmdb_id), streamId);
        }
        if (row.imdb_id) {
          imdbIdSet.add(String(row.imdb_id));
          imdbIdToStreamId.set(String(row.imdb_id), streamId);
        }

        const name = row.stream_display_name || row.name || row.o_name || '';
        const norm = normalizeTitle(name);
        if (norm) {
          nameLooseSet.add(norm);
          nameLooseToStreamId.set(norm, streamId);
          const year = row.release_date ? parseInt(String(row.release_date).substring(0, 4), 10) : undefined;
          if (year) {
            nameYearSet.add(`${norm}|${year}`);
            nameYearToStreamId.set(`${norm}|${year}`, streamId);
          }
        }

        const url = safeFirstUrl(row.stream_source);
        if (url) {
          const hash = generateStreamHash(url);
          streamHashSet.add(hash);
          streamHashToStreamId.set(hash, streamId);
        }
      }
    }

    try {
      // 🚀 OTIMIZAÇÃO: Processar em lotes menores (30-50) em paralelo
      const parallelBatchSize = Math.min(batchSize, 50); // Máximo 50 por lote paralelo
      
      // Dividir em lotes maiores para processar em paralelo
      const parallelBatches: MovieData[][] = [];
      for (let i = 0; i < movies.length; i += parallelBatchSize) {
        parallelBatches.push(movies.slice(i, i + parallelBatchSize));
      }

      // Processar lotes em paralelo (máximo 5 lotes simultâneos para não sobrecarregar)
      const maxConcurrent = 5;
      for (let i = 0; i < parallelBatches.length; i += maxConcurrent) {
        // ✅ KEEPALIVE: Verificar e fazer ping se necessário
        await keepAlive();
        
        const concurrentBatches = parallelBatches.slice(i, i + maxConcurrent);

        for (const batch of concurrentBatches) {
          let committed = false; // ⚠️ FLAG: Evitar rollback após commit bem-sucedido
          try {
            // 🔍 DEBUG: Verificar estado da conexão antes de iniciar transação
            const [dbCheck] = await conn.query<any[]>('SELECT DATABASE() as db, CONNECTION_ID() as connId');
            logger.info(`[XUIVodDB] 📊 Conexão: DB=${dbCheck[0].db}, ConnID=${dbCheck[0].connId}`);
            
            await conn.beginTransaction();

            const values: any[] = [];
            const placeholders: string[] = [];
            const moviesToInsert: MovieData[] = [];

            // 🚀 DETECÇÃO INTELIGENTE DE DUPLICATAS: Sistema em cascata
            // Se forceFreshImport = true (após limpeza), pular verificação
            logger.info(`[XUIVodDB] 🔍 INÍCIO BATCH: ${batch.length} filmes | skipDuplicates=${skipDuplicates} | forceFreshImport=${forceFreshImport}`);

            if (shouldCheckDuplicates) {
              for (const movie of batch) {
                const nameNorm = normalizeTitle(movie.stream_display_name || '');
                const year = movie.movie_properties?.release_date 
                  ? parseInt(movie.movie_properties.release_date.substring(0, 4), 10)
                  : extractYear(movie.stream_display_name) || undefined;
                const tmdbId = movie.movie_properties?.tmdb_id ? Number(movie.movie_properties.tmdb_id) : undefined;
                const imdbId = movie.movie_properties?.imdb_id ? String(movie.movie_properties.imdb_id) : undefined;
                const url = movie.stream_source?.[0];
                const urlHash = url ? generateStreamHash(url) : undefined;

                let isDuplicate = false;
                if (tmdbId && tmdbIdSet.has(tmdbId)) isDuplicate = true;
                else if (imdbId && imdbIdSet.has(imdbId)) isDuplicate = true;
                else if (urlHash && streamHashSet.has(urlHash)) isDuplicate = true;
                else if (nameNorm) {
                  if (year && nameYearSet.has(`${nameNorm}|${year}`)) isDuplicate = true;
                  else if (nameLooseSet.has(nameNorm)) isDuplicate = true;
                }

                if (isDuplicate) {
                  skipped++;
                  // ⚠️ CRÍTICO: Coletar ID do filme duplicado para adicionar ao bouquet
                  let existingId: number | undefined;
                  if (tmdbId && tmdbIdToStreamId.has(tmdbId)) existingId = tmdbIdToStreamId.get(tmdbId);
                  else if (imdbId && imdbIdToStreamId.has(imdbId)) existingId = imdbIdToStreamId.get(imdbId);
                  else if (urlHash && streamHashToStreamId.has(urlHash)) existingId = streamHashToStreamId.get(urlHash);
                  else if (nameNorm && year && nameYearToStreamId.has(`${nameNorm}|${year}`)) existingId = nameYearToStreamId.get(`${nameNorm}|${year}`);
                  else if (nameNorm && nameLooseToStreamId.has(nameNorm)) existingId = nameLooseToStreamId.get(nameNorm);
                  
                  if (existingId) {
                    skippedIds.push(existingId);
                  }
                  continue;
                }

                moviesToInsert.push(movie);

                if (tmdbId) tmdbIdSet.add(tmdbId);
                if (imdbId) imdbIdSet.add(imdbId);
                if (nameNorm) {
                  nameLooseSet.add(nameNorm);
                  if (year) nameYearSet.add(`${nameNorm}|${year}`);
                }
                if (urlHash) streamHashSet.add(urlHash);
              }
            } else {
              moviesToInsert.push(...batch);
            }

            logger.info(`[XUIVodDB] 📦 PREPARADO PARA INSERIR: ${moviesToInsert.length} filmes`);

            if (moviesToInsert.length === 0) {
              logger.warn(`[XUIVodDB] ⚠️ Batch vazio! Nenhum filme para inserir.`);
              await conn.commit();
              continue;
            }

            logger.info(`[XUIVodDB] ➡️ INICIANDO INSERÇÃO de ${moviesToInsert.length} filmes...`);

            for (const movie of moviesToInsert) {
            // Preparar valores
            // ⚠️ CORREÇÃO DOUBLE ENCODING: Verificar se já é string antes de stringify
            let streamSource: string;
            if (typeof movie.stream_source === 'string') {
              // Já é string JSON - usar diretamente
              streamSource = movie.stream_source;
            } else if (Array.isArray(movie.stream_source)) {
              // É array - converter para JSON
              streamSource = JSON.stringify(movie.stream_source);
            } else {
              streamSource = '[]';
            }
            
            // ⚠️ CORREÇÃO: Verificar se movie_properties já é string
            let movieProps: string;
            if (typeof movie.movie_properties === 'string') {
              movieProps = movie.movie_properties;
            } else if (movie.movie_properties) {
              movieProps = JSON.stringify(movie.movie_properties);
            } else {
              movieProps = JSON.stringify({ name: movie.stream_display_name });
            }

            // Garantir que stream_icon não seja vazio se fornecido
            const streamIcon = movie.stream_icon && movie.stream_icon.trim() ? movie.stream_icon.trim() : null;

            // ⚠️ CORREÇÃO CRÍTICA: category_id deve ser JSON array SEM double encoding
            // Formato correto: [3708] ou ["3708"] dependendo do tipo
            // NÃO usar JSON.stringify aqui - será feito manualmente no INSERT
            let categoryIdArray: number[] = [];
            if (Array.isArray(movie.category_id) && movie.category_id.length > 0) {
              categoryIdArray = movie.category_id.map(id => parseInt(String(id), 10));
            }
            // Criar JSON manualmente para evitar double encoding
            const categoryIdJson = `[${categoryIdArray.join(',')}]`;

            // Extrair tmdb_id e rating para campos da tabela (badge verde)
            let tmdbId: number | null = null;
            let rating: number | null = null;
            
            if (movie.movie_properties) {
              const props = movie.movie_properties;
              
              if (props.tmdb_id !== undefined) {
                tmdbId = typeof props.tmdb_id === 'number' 
                  ? props.tmdb_id 
                  : parseInt(String(props.tmdb_id), 10);
              }
              
              if (props.rating !== undefined) {
                rating = typeof props.rating === 'number' 
                  ? props.rating 
                  : parseFloat(String(props.rating));
              }
            }

            // 🔍 DEBUG: Log detalhado do primeiro filme de cada batch
            if (values.length === 0) {
              logger.info(`[XUIVodDB] 🔍 AMOSTRA PRIMEIRO FILME DO BATCH:`);
              logger.info(`[XUIVodDB]   - stream_display_name: ${movie.stream_display_name}`);
              logger.info(`[XUIVodDB]   - category_id (original): ${JSON.stringify(movie.category_id)}`);
              logger.info(`[XUIVodDB]   - categoryIdJson (para INSERT): ${categoryIdJson}`);
              logger.info(`[XUIVodDB]   - tmdbId: ${tmdbId}`);
              logger.info(`[XUIVodDB]   - rating: ${rating}`);
              logger.info(`[XUIVodDB]   - movie_properties existe: ${!!movie.movie_properties}`);
              if (movie.movie_properties) {
                logger.info(`[XUIVodDB]   - movie_properties.name: ${movie.movie_properties.name || 'VAZIO'}`);
                logger.info(`[XUIVodDB]   - movie_properties.plot: ${movie.movie_properties.plot?.substring(0, 50) || 'VAZIO'}`);
              }
            }

            values.push(
              2, // type = movie
              categoryIdInt, // category_id (int no Xtream UI)
              movie.stream_display_name,
              streamSource, // stream_source como JSON string: '["url"]'
              streamIcon, // stream_icon (logo do M3U)
              movieProps,
              'mp4', // target_container
              1, // direct_source = 1 (URL direta para VODs)
              now, // added
              0, // read_native = 0 (OBRIGATÓRIO para aparecer no XUI)
              tmdbId, // tmdb_id (INTEGER) - OBRIGATÓRIO para badge verde
              'pt-BR', // tmdb_language - OBRIGATÓRIO para badge verde
              rating ?? 0, // rating (FLOAT) - usar 0 como default se NULL
            );

            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            }

            if (values.length === 0) {
              await conn.commit();
              return; // Retornar do Promise.all
            }

            // INSERT em lote
            // IMPORTANTE: read_native deve ser 0 para filmes aparecerem no XUI
          // CORREÇÃO BADGE VERDE: Incluir tmdb_id, tmdb_language, rating na tabela
          // CORREÇÃO: Ordem dos campos deve corresponder aos values.push acima
          const query = `
            INSERT INTO streams (
              type, category_id, stream_display_name, stream_source, stream_icon,
              movie_propeties, target_container, direct_source, added, read_native,
              tmdb_id, tmdb_language, rating
            ) VALUES ${placeholders.join(', ')}
          `;

          // 🔍 DEBUG CRÍTICO: Mostrar exatamente o que está sendo inserido
          logger.info(`[XUIVodDB] 🔍 DEBUG INSERT DETALHADO:`);
          logger.info(`[XUIVodDB]   Total filmes no batch: ${moviesToInsert.length}`);
          logger.info(`[XUIVodDB]   Total values: ${values.length} (esperado: ${moviesToInsert.length * 13})`);
          logger.info(`[XUIVodDB]   Total placeholders: ${placeholders.length}`);
          
          // Mostrar valores do primeiro filme (índices 0-12)
          if (values.length >= 13) {
            logger.info(`[XUIVodDB]   PRIMEIRO FILME - Valores reais:`);
            logger.info(`[XUIVodDB]     [0] type = ${values[0]}`);
            logger.info(`[XUIVodDB]     [1] category_id = ${values[1]}`);
            logger.info(`[XUIVodDB]     [2] stream_display_name = ${String(values[2]).substring(0, 30)}`);
            logger.info(`[XUIVodDB]     [7] direct_source = ${values[7]}`);
            logger.info(`[XUIVodDB]     [10] tmdb_id = ${values[10]}`);
            logger.info(`[XUIVodDB]     [12] rating = ${values[12]}`);
          }
          
          // Log da query completa (para debug)
          logger.info(`[XUIVodDB]   Query (parcial): INSERT INTO streams (type, category_id, ...) VALUES ${placeholders.length} placeholders`);
          
          // 🔍 DEBUG SUPER DETALHADO: Logar os primeiros 13 valores (1 filme completo)
          const firstMovieValues = values.slice(0, 13);
          logger.info(`[XUIVodDB]   🔍 VALORES EXATOS DO 1º FILME: ${JSON.stringify(firstMovieValues)}`);
          
          const insertResult = await conn.query(query, values);
          const resultInfo = insertResult[0] as any;
          const affectedRows = resultInfo.affectedRows || 0;
          const firstInsertId = resultInfo.insertId || 0;
          
          // Verificar se a inserção funcionou consultando o registro recém inserido
          if (firstInsertId) {
            try {
              const [verify] = await conn.query<any[]>(
                `SELECT id, category_id, tmdb_id, direct_source FROM streams WHERE id = ?`,
                [firstInsertId]
              );
              if (verify.length > 0) {
                logger.info(`[XUIVodDB]   🔍 VERIFICAÇÃO PÓS-INSERT (ID ${firstInsertId}): category=${verify[0].category_id}, tmdb=${verify[0].tmdb_id}, direct=${verify[0].direct_source}`);
              }
            } catch (verifyErr: any) {
              logger.warn(`[XUIVodDB]   Erro na verificação pós-insert: ${verifyErr.message}`);
            }
          }
          
          logger.info(`[XUIVodDB] 📤 INSERT EXECUTADO: affectedRows=${affectedRows}, insertId=${firstInsertId}`);
          
          if (affectedRows === 0 || !firstInsertId) {
            logger.warn(`[XUIVodDB] ⚠️ ATENÇÃO: Query executada mas nenhuma linha foi afetada ou insertId não retornado!`);
          }
          
          await conn.commit();
          committed = true; // ✅ COMMIT BEM-SUCEDIDO
          
          // 🔍 VERIFICAÇÃO PÓS-COMMIT: Confirmar que os dados foram realmente salvos
          if (firstInsertId && affectedRows > 0) {
            try {
              const [verifyCommit] = await conn.query<any[]>(
                `SELECT id, stream_display_name, category_id, tmdb_id, direct_source, read_native, 
                        tmdb_language, rating, target_container, movie_propeties AS movie_properties
                 FROM streams WHERE id = ?`,
                [firstInsertId]
              );
              if (verifyCommit.length === 0) {
                logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO: Filme ${firstInsertId} NÃO FOI PERSISTIDO após commit!`);
              } else {
                const v = verifyCommit[0];
                logger.info(`[XUIVodDB] ✅ VERIFICAÇÃO PÓS-COMMIT DETALHADA (ID ${firstInsertId}):`);
                logger.info(`[XUIVodDB]   name: ${v.stream_display_name?.substring(0, 40)}`);
                logger.info(`[XUIVodDB]   category_id: "${v.category_id}" (tipo: ${typeof v.category_id})`);
                logger.info(`[XUIVodDB]   tmdb_id: ${v.tmdb_id} (tipo: ${typeof v.tmdb_id})`);
                logger.info(`[XUIVodDB]   direct_source: ${v.direct_source}`);
                logger.info(`[XUIVodDB]   read_native: ${v.read_native}`);
                logger.info(`[XUIVodDB]   rating: ${v.rating}`);
                logger.info(`[XUIVodDB]   target_container: ${v.target_container}`);
                logger.info(`[XUIVodDB]   movie_properties: ${v.movie_properties ? v.movie_properties.substring(0, 150) + '...' : 'NULL'}`);
              }
            } catch (verifyErr: any) {
              logger.error(`[XUIVodDB] ❌ Erro na verificação pós-commit: ${verifyErr.message}`);
            }
          }

          // ⚠️ CORREÇÃO CRÍTICA: Atualizar campo `updated` para que o XUI detecte os filmes
          // O XUI pode precisar que o campo `updated` seja atualizado após inserção
          // para que os filmes apareçam corretamente nas categorias
          try {
            // Atualizar apenas os IDs recém inseridos (muito mais rápido que range por timestamp)
            if (firstInsertId && affectedRows > 0) {
              const ids = Array.from({ length: affectedRows }, (_, idx) => firstInsertId + idx);
              const placeholdersUpd = ids.map(() => '?').join(',');
              const [updateResult] = await conn.query<any>(
                `UPDATE streams SET updated = NOW() WHERE id IN (${placeholdersUpd})`,
                ids
              );
              if ((updateResult as any).affectedRows > 0) {
                logger.debug(`[XUIVodDB] ✅ Campo 'updated' atualizado para ${(updateResult as any).affectedRows} filmes (forçando refresh do XUI)`);
              }
            }
          } catch (updateError: any) {
            // Se o campo updated não existir, não é crítico - pode não estar disponível em todas as versões do XUI
            logger.debug(`[XUIVodDB] Campo 'updated' não disponível ou não necessário: ${updateError.message}`);
          }

          // Calcular IDs inseridos com base em insertId + affectedRows (sem depender de timestamp)
          let idsToAdd: number[] = [];
          if (firstInsertId && affectedRows > 0) {
            idsToAdd = Array.from({ length: affectedRows }, (_, idx) => firstInsertId + idx);
            insertedIds.push(...idsToAdd);

            // Mapear IDs inseridos -> MovieData na mesma ordem do INSERT
            // (placeholders/values são montados na ordem de moviesToInsert)
            const countToMap = Math.min(idsToAdd.length, moviesToInsert.length);
            for (let idx = 0; idx < countToMap; idx++) {
              insertedMovies.push({ id: idsToAdd[idx], movie: moviesToInsert[idx] });
            }
            
            // ⚠️ CORREÇÃO CRÍTICA: Inserir dados TMDB na tabela movie_properties separada
            // O XUI espera os metadados nessa tabela, não apenas na coluna movie_properties de streams
            try {
              const moviePropsValues: any[] = [];
              const moviePropsPlaceholders: string[] = [];
              
              logger.info(`[XUIVodDB] 🔍 DEBUG movie_properties: countToMap=${countToMap}`);
              
              for (let idx = 0; idx < countToMap; idx++) {
                const streamId = idsToAdd[idx];
                const movie = moviesToInsert[idx];
                
                // 🔍 DEBUG: Log para verificar se a condição é satisfeita
                if (idx === 0) {
                  logger.info(`[XUIVodDB] 🔍 DEBUG 1º filme: has_props=${!!movie.movie_properties}, tmdb_id=${movie.movie_properties?.tmdb_id}, type=${typeof movie.movie_properties?.tmdb_id}`);
                }
                
                // Só inserir se tiver movie_properties com dados TMDB
                if (movie.movie_properties && movie.movie_properties.tmdb_id) {
                  const props = movie.movie_properties;
                  moviePropsValues.push(
                    streamId,
                    props.tmdb_id || null,
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
                  moviePropsPlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                }
              }
              
              if (moviePropsPlaceholders.length > 0) {
                await conn.query(
                  `INSERT INTO movie_properties (
                    stream_id, tmdb_id, name, o_name, cover_big, movie_image,
                    releaseDate, youtube_trailer, director, actors, cast,
                    description, plot, genre, country, duration_secs, duration,
                    rating, year
                  ) VALUES ${moviePropsPlaceholders.join(', ')}
                  ON DUPLICATE KEY UPDATE
                    tmdb_id = VALUES(tmdb_id),
                    name = VALUES(name),
                    o_name = VALUES(o_name),
                    cover_big = VALUES(cover_big),
                    movie_image = VALUES(movie_image),
                    releaseDate = VALUES(releaseDate),
                    youtube_trailer = VALUES(youtube_trailer),
                    director = VALUES(director),
                    actors = VALUES(actors),
                    cast = VALUES(cast),
                    description = VALUES(description),
                    plot = VALUES(plot),
                    genre = VALUES(genre),
                    country = VALUES(country),
                    duration_secs = VALUES(duration_secs),
                    duration = VALUES(duration),
                    rating = VALUES(rating),
                    year = VALUES(year)`,
                  moviePropsValues
                );
                logger.info(`[XUIVodDB] ✅ ${moviePropsPlaceholders.length} registros inseridos na tabela movie_properties`);
              }
            } catch (mpError: any) {
              // Se a tabela não existir ou der erro, logar mas não falhar
              logger.warn(`[XUIVodDB] ⚠️ Erro ao inserir em movie_properties (não crítico): ${mpError.message}`);
            }
          }

          // Se serverId foi fornecido, inserir na tabela streams_servers
          if (serverId && idsToAdd.length > 0) {
            try {
              const serverValues: any[] = [];
              const serverPlaceholders: string[] = [];
              
              // VODs usam on_demand = 0 (Direct)
              for (const streamId of idsToAdd) {
                serverValues.push(streamId, serverId, 0); // on_demand = 0 (Direct)
                serverPlaceholders.push('(?, ?, ?)');
              }

              await conn.query(
                `INSERT INTO streams_sys (stream_id, server_id, on_demand) VALUES ${serverPlaceholders.join(', ')}`,
                serverValues
              );

              logger.info(`[XUIVodDB] ✅ ${idsToAdd.length} filmes vinculados ao servidor ${serverId}`);
            } catch (error: any) {
              logger.warn(`[XUIVodDB] Erro ao vincular filmes ao servidor (não crítico):`, error.message);
            }
          }

          inserted += moviesToInsert.length;
          logger.debug(`[XUIVodDB] 🚀 Lote paralelo inserido: ${moviesToInsert.length} filmes`);
          } catch (error: any) {
            // ⚠️ SÓ fazer rollback se o commit ainda não foi feito
            if (!committed) {
              try {
                await conn.rollback();
                logger.info(`[XUIVodDB] Rollback executado (commit não foi feito)`);
              } catch (rollbackErr: any) {
                logger.warn(`[XUIVodDB] Erro no rollback: ${rollbackErr.message}`);
              }
            } else {
              logger.warn(`[XUIVodDB] Erro após commit (dados já persistidos): ${error.message}`);
            }
            const errorDetails = {
              message: error.message || 'Erro desconhecido',
              code: error.code,
              errno: error.errno,
              sqlState: error.sqlState,
              sqlMessage: error.sqlMessage,
              stack: error.stack?.substring(0, 1000),
            };
            logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO no lote paralelo:`, errorDetails);
            
            if (batch.length > 0) {
              logger.error(`[XUIVodDB] Primeiro filme do lote que falhou:`, {
                name: batch[0].stream_display_name,
                category_id: batch[0].category_id,
                stream_source: batch[0].stream_source,
              });
            }
            
            errors += batch.length;
          }
        }
      }

      logger.info(`[XUIVodDB] ✅ Importação concluída: ${inserted} inseridos, ${errors} erros, ${skipped} duplicados ignorados, ${skippedIds.length} IDs duplicados coletados`);
      return { inserted, errors, skipped, insertedIds, insertedMovies, skippedIds };
    } catch (error: any) {
      const errorDetails = {
        message: error.message || 'Erro sem mensagem',
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        stack: error.stack,
        name: error.name,
        fatal: error.fatal,
      };
      logger.error('[XUIVodDB] ❌ ERRO DETALHADO na importação em massa:', errorDetails);
      throw error;
    }
  }

  /**
   * Verifica se uma série já existe (por nome)
   */
  private async checkSeriesExists(conn: Connection, serie: SeriesData): Promise<boolean> {
    try {
      const [rows] = await conn.query<any[]>(
        `SELECT id FROM streams 
         WHERE type = 3 
         AND stream_display_name = ? 
         LIMIT 1`,
        [serie.stream_display_name]
      );
      return rows.length > 0;
    } catch (error: any) {
      logger.warn('[XUIVodDB] Erro ao verificar série duplicada:', error.message);
      return false; // Em caso de erro, permite inserir
    }
  }

  /**
   * Importação em massa de séries (INSERT direto no MySQL)
   * @param series Array de séries para importar
   * @param batchSize Tamanho do lote (padrão: 1000)
   */
  async bulkInsertSeries(series: SeriesData[], batchSize = 1000, skipDuplicates = true, serverId?: number): Promise<{ inserted: number; errors: number; skipped: number; insertedIds: number[] }> {
    const conn = await this.connect();
    const now = Math.floor(Date.now() / 1000);
    
    let inserted = 0;
    let errors = 0;
    let skipped = 0;
    const insertedIds: number[] = [];

    // ✅ KEEPALIVE: Fazer ping a cada 5 minutos para manter conexão viva
    let lastPingTime = Date.now();
    const PING_INTERVAL = 5 * 60 * 1000; // 5 minutos
    
    const keepAlive = async () => {
      const now = Date.now();
      if (now - lastPingTime > PING_INTERVAL) {
        try {
          await conn.query('SELECT 1');
          logger.debug('[XUIVodDB] ✅ Keepalive (séries): Conexão MySQL ainda ativa');
          lastPingTime = now;
        } catch (err: any) {
          logger.error('[XUIVodDB] ❌ Keepalive falhou (séries):', err.message);
        }
      }
    };

    try {
      // Processar em lotes
      for (let i = 0; i < series.length; i += batchSize) {
        // ✅ KEEPALIVE: Verificar e fazer ping se necessário
        await keepAlive();
        
        const batch = series.slice(i, i + batchSize);
        
        let committed = false; // ⚠️ FLAG: Evitar rollback após commit
        try {
          await conn.beginTransaction();

          const values: any[] = [];
          const placeholders: string[] = [];
          const seriesToInsert: SeriesData[] = [];

          // Filtrar duplicados se solicitado
          for (const serie of batch) {
            if (skipDuplicates) {
              const exists = await this.checkSeriesExists(conn, serie);
              if (exists) {
                skipped++;
                logger.debug(`[XUIVodDB] Série duplicada ignorada: ${serie.stream_display_name}`);
                continue;
              }
            }

            seriesToInsert.push(serie);
          }

          if (seriesToInsert.length === 0) {
            await conn.commit();
            continue;
          }

          for (const serie of seriesToInsert) {
            // Preparar valores
            // ⚠️ CORREÇÃO: Evitar double encoding
            const categoryIdArray = Array.isArray(serie.category_id) ? serie.category_id.map((id: any) => parseInt(String(id), 10)) : [];
            const categoryId = `[${categoryIdArray.join(',')}]`;
            const movieProps = serie.movie_properties
              ? JSON.stringify(serie.movie_properties)
              : JSON.stringify({ name: serie.stream_display_name });

            // Garantir que cover não seja vazio se fornecido
            const cover = serie.cover && serie.cover.trim() ? serie.cover.trim() : null;

            values.push(
              3, // type = series
              serie.stream_display_name,
              JSON.stringify([]), // stream_source vazio para séries (episódios são separados)
              cover,
              categoryId,
              movieProps,
              'mp4', // target_container
              1, // direct_source
              now, // added
              0, // read_native = 0 (OBRIGATÓRIO para aparecer no XUI)
            );

            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          }

          if (values.length === 0) {
            await conn.commit();
            continue;
          }

          // INSERT em lote
          // IMPORTANTE: read_native deve ser 0 para séries aparecerem no XUI
          const query = `
            INSERT INTO streams (
              type, stream_display_name, stream_source, stream_icon,
              category_id, movie_propeties, target_container, direct_source, added, read_native
            ) VALUES ${placeholders.join(', ')}
          `;

          await conn.query(query, values);
          await conn.commit();
          committed = true; // ✅ COMMIT BEM-SUCEDIDO

          // Buscar IDs das séries inseridas
          try {
            const [insertedRows] = await conn.query<any[]>(
              `SELECT id FROM streams 
               WHERE type = 3 
               AND added >= ? 
               AND added <= ?
               ORDER BY id DESC 
               LIMIT ?`,
              [now - 2, now + 2, seriesToInsert.length * 3]
            );

            const idsToAdd = insertedRows.slice(0, seriesToInsert.length).map((row: any) => row.id);
            insertedIds.push(...idsToAdd);

            // Se serverId foi fornecido, inserir na tabela streams_servers
            if (serverId && idsToAdd.length > 0) {
              try {
                const serverValues: any[] = [];
                const serverPlaceholders: string[] = [];
                
                // Séries usam on_demand = 0 (Direct)
                for (const streamId of idsToAdd) {
                  serverValues.push(streamId, serverId, 0); // on_demand = 0 (Direct)
                  serverPlaceholders.push('(?, ?, ?)');
                }

                await conn.query(
                  `INSERT INTO streams_sys (stream_id, server_id, on_demand) VALUES ${serverPlaceholders.join(', ')}`,
                  serverValues
                );

                logger.info(`[XUIVodDB] ✅ ${idsToAdd.length} séries vinculadas ao servidor ${serverId}`);
              } catch (error: any) {
                logger.warn(`[XUIVodDB] Erro ao vincular séries ao servidor (não crítico):`, error.message);
              }
            }
          } catch (error: any) {
            logger.warn(`[XUIVodDB] Erro ao buscar IDs inseridos (não crítico):`, error.message);
          }

          inserted += seriesToInsert.length;
          logger.info(`[XUIVodDB] Lote inserido: ${inserted}/${series.length} séries (${skipped} duplicadas ignoradas)`);
        } catch (error: any) {
          if (!committed) {
            try { await conn.rollback(); } catch {}
          }
          const errorDetails = {
            message: error.message || 'Erro desconhecido',
            code: error.code,
            errno: error.errno,
            sqlState: error.sqlState,
            sqlMessage: error.sqlMessage,
            stack: error.stack?.substring(0, 1000),
          };
          logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO no lote ${i}-${i + batch.length}:`, errorDetails);
          
          // Log adicional: tentar ver a primeira série do lote que falhou
          if (batch.length > 0) {
            logger.error(`[XUIVodDB] Primeira série do lote que falhou:`, {
              name: batch[0].stream_display_name,
              category_id: batch[0].category_id,
            });
          }
          
          errors += batch.length;
        }
      }

      logger.info(`[XUIVodDB] Importação concluída: ${inserted} inseridos, ${errors} erros, ${skipped} duplicadas ignoradas, ${insertedIds.length} IDs coletados`);
      return { inserted, errors, skipped, insertedIds };
    } catch (error: any) {
      const errorDetails = {
        message: error.message || 'Erro sem mensagem',
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        stack: error.stack?.substring(0, 500),
        name: error.name,
        fatal: error.fatal,
      };
      logger.error('[XUIVodDB] ❌ ERRO DETALHADO na importação de séries:', errorDetails);
      throw error;
    }
  }

  /**
   * Verifica se um canal LIVE já existe (por nome)
   */
  private async checkLiveChannelExists(conn: Connection, channel: LiveChannelData): Promise<boolean> {
    try {
      const [rows] = await conn.query<any[]>(
        `SELECT id FROM streams 
         WHERE type = 1 
         AND stream_display_name = ? 
         LIMIT 1`,
        [channel.stream_display_name]
      );
      return rows.length > 0;
    } catch (error: any) {
      logger.warn('[XUIVodDB] Erro ao verificar canal duplicado:', error.message);
      return false; // Em caso de erro, permite inserir
    }
  }

  /**
   * Importação em massa de canais LIVE (INSERT direto no MySQL)
   * @param channels Array de canais para importar
   * @param batchSize Tamanho do lote (padrão: 1000)
   * @param skipDuplicates Se true, não insere canais duplicados
   * @returns Estatísticas de inserção com IDs dos canais inseridos
   */
  async bulkInsertLiveChannels(
    channels: LiveChannelData[], 
    batchSize = 1000, 
    skipDuplicates = true,
    serverId?: number,  // ID do servidor para inserir na tabela streams_servers
    onDemandMode?: boolean  // true = On-Demand, false = Direct
  ): Promise<{ inserted: number; errors: number; skipped: number; insertedIds: number[] }> {
    const conn = await this.connect();
    const now = Math.floor(Date.now() / 1000);
    
    let inserted = 0;
    let errors = 0;
    let skipped = 0;
    const insertedIds: number[] = [];

    try {
      // Processar em lotes
      for (let i = 0; i < channels.length; i += batchSize) {
        const batch = channels.slice(i, i + batchSize);
        
        try {
          await conn.beginTransaction();

          const values: any[] = [];
          const placeholders: string[] = [];
          const channelsToInsert: LiveChannelData[] = [];

          // Filtrar duplicados se solicitado
          for (const channel of batch) {
            if (skipDuplicates) {
              const exists = await this.checkLiveChannelExists(conn, channel);
              if (exists) {
                skipped++;
                logger.debug(`[XUIVodDB] Canal duplicado ignorado: ${channel.stream_display_name}`);
                continue;
              }
            }

            channelsToInsert.push(channel);
          }

          if (channelsToInsert.length === 0) {
            await conn.commit();
            continue;
          }

          for (const channel of channelsToInsert) {
            // Preparar valores
            const streamSource = JSON.stringify(channel.stream_source || []);
            const streamIcon = channel.stream_icon && channel.stream_icon.trim() ? channel.stream_icon.trim() : '';
            
            // Xtream UI: category_id é int, não JSON array
            let categoryIdInt = 0;
            if (Array.isArray(channel.category_id) && channel.category_id.length > 0) {
              categoryIdInt = parseInt(String(channel.category_id[0]), 10) || 0;
            }

            values.push(
              1, // type = 1 (LIVE)
              categoryIdInt, // category_id (int no Xtream UI)
              channel.stream_display_name,
              streamSource, // stream_source como JSON string: '["url"]'
              streamIcon, // stream_icon (logo)
              channel.target_container || 'ts', // target_container (ts para LIVE)
              channel.direct_source !== undefined ? channel.direct_source : 1, // direct_source
              now, // added
              channel.read_native !== undefined ? channel.read_native : 0, // read_native
              channel.enable_transcode !== undefined ? channel.enable_transcode : 0, // enable_transcode
              channel.stream_all !== undefined ? channel.stream_all : 0, // stream_all
              channel.gen_timestamps !== undefined ? channel.gen_timestamps : 1, // ⚠️ CRÍTICO: gen_timestamps=1 para play azul
            );

            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          }

          if (values.length === 0) {
            await conn.commit();
            continue;
          }

          // INSERT em lote
          // IMPORTANTE: read_native deve ser 0 para canais aparecerem no XUI
          // direct_source = 1 para LIVE (URL direta)
          // direct_proxy = 1 para usar proxy
          // ⚠️ CORREÇÃO BUG PLAY CINZA: gen_timestamps=1 para gerar PTS (necessário para funcionar)
          const query = `
            INSERT INTO streams (
              type, category_id, stream_display_name, stream_source, stream_icon,
              target_container, direct_source, added, read_native,
              enable_transcode, stream_all, gen_timestamps
            ) VALUES ${placeholders.join(', ')}
          `;

          const insertResult = await conn.query(query, values);
          const affectedRows = (insertResult[0] as any).affectedRows || 0;
          
          if (affectedRows === 0) {
            logger.warn(`[XUIVodDB] ⚠️ ATENÇÃO: Query executada mas nenhuma linha foi afetada!`);
          }
          
          await conn.commit();

          // ⚠️ CORREÇÃO CRÍTICA: Atualizar campo `updated` para que o XUI detecte os canais
          // O XUI pode precisar que o campo `updated` seja atualizado após inserção
          // para que os canais funcionem corretamente no aplicativo
          // Fazemos um UPDATE "dummy" para forçar o refresh interno do XUI
          try {
            const [updateResult] = await conn.query<any>(
              `UPDATE streams 
               SET updated = NOW() 
               WHERE type = 1 
               AND added >= ? 
               AND added <= ?`,
              [now - 2, now + 2]
            );
            
            if ((updateResult as any).affectedRows > 0) {
              logger.info(`[XUIVodDB] ✅ Campo 'updated' atualizado para ${(updateResult as any).affectedRows} canais (forçando refresh do XUI)`);
            }
          } catch (updateError: any) {
            // Se o campo updated não existir, não é crítico - pode não estar disponível em todas as versões do XUI
            logger.debug(`[XUIVodDB] Campo 'updated' não disponível ou não necessário: ${updateError.message}`);
          }

          // Buscar IDs dos canais inseridos
          try {
            const [insertedRows] = await conn.query<any[]>(
              `SELECT id FROM streams 
               WHERE type = 1 
               AND added >= ? 
               AND added <= ?
               ORDER BY id DESC 
               LIMIT ?`,
              [now - 2, now + 2, channelsToInsert.length * 3]
            );

            const idsToAdd = insertedRows.slice(0, channelsToInsert.length).map((row: any) => row.id);
            insertedIds.push(...idsToAdd);
            
            if (idsToAdd.length < channelsToInsert.length) {
              logger.debug(`[XUIVodDB] Aviso: Apenas ${idsToAdd.length} de ${channelsToInsert.length} IDs coletados`);
            }

            // Se serverId foi fornecido, inserir na tabela streams_servers
            if (serverId && idsToAdd.length > 0) {
              try {
                const serverValues: any[] = [];
                const serverPlaceholders: string[] = [];
                
                // on_demand: 0 = Direct, 1 = On-Demand
                const onDemandValue = onDemandMode ? 1 : 0;
                
                for (const streamId of idsToAdd) {
                  serverValues.push(streamId, serverId, onDemandValue);
                  serverPlaceholders.push('(?, ?, ?)');
                }

                await conn.query(
                  `INSERT INTO streams_sys (stream_id, server_id, on_demand) VALUES ${serverPlaceholders.join(', ')}`,
                  serverValues
                );

                logger.info(`[XUIVodDB] ✅ ${idsToAdd.length} canais vinculados ao servidor ${serverId} (on_demand=${onDemandValue})`);
              } catch (error: any) {
                logger.warn(`[XUIVodDB] Erro ao vincular canais ao servidor (não crítico):`, error.message);
              }
            }
          } catch (error: any) {
            logger.warn(`[XUIVodDB] Erro ao buscar IDs inseridos (não crítico):`, error.message);
          }

          inserted += channelsToInsert.length;
          logger.info(`[XUIVodDB] Lote inserido: ${inserted}/${channels.length} canais (${skipped} duplicados ignorados)`);
        } catch (error: any) {
          await conn.rollback();
          const errorDetails = {
            message: error.message || 'Erro desconhecido',
            code: error.code,
            errno: error.errno,
            sqlState: error.sqlState,
            sqlMessage: error.sqlMessage,
            stack: error.stack?.substring(0, 1000),
          };
          logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO no lote ${i}-${i + batch.length}:`, errorDetails);
          
          // Log adicional: tentar ver o primeiro canal do lote que falhou
          if (batch.length > 0) {
            logger.error(`[XUIVodDB] Primeiro canal do lote que falhou:`, {
              name: batch[0].stream_display_name,
              category_id: batch[0].category_id,
              stream_source: batch[0].stream_source,
            });
          }
          
          errors += batch.length;
        }
      }

      logger.info(`[XUIVodDB] Importação de canais LIVE concluída: ${inserted} inseridos, ${errors} erros, ${skipped} duplicados ignorados, ${insertedIds.length} IDs coletados`);
      return { inserted, errors, skipped, insertedIds };
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro na importação em massa de canais:', error.message);
      throw error;
    }
  }

  /**
   * Deleta todos os filmes do XUI
   */
  async deleteAllMovies(): Promise<number> {
    const conn = await this.connect();

    try {
      const [result] = await conn.query(
        'DELETE FROM streams WHERE type = 2'
      );

      const affectedRows = (result as any).affectedRows || 0;
      logger.info(`[XUIVodDB] ${affectedRows} filmes deletados`);
      return affectedRows;
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao deletar filmes:', error.message);
      throw error;
    }
  }

  /**
   * Deleta todas as séries do XUI
   */
  async deleteAllSeries(): Promise<number> {
    const conn = await this.connect();

    try {
      // Primeiro deletar episódios (type=5)
      const [episodesResult] = await conn.query('DELETE FROM streams WHERE type = 5');
      const episodesDeleted = (episodesResult as any).affectedRows || 0;
      logger.info(`[XUIVodDB] ${episodesDeleted} episódios deletados`);
      
      // Depois deletar séries (streams_series)
      const [seriesResult] = await conn.query('DELETE FROM series');
      const seriesDeleted = (seriesResult as any).affectedRows || 0;
      logger.info(`[XUIVodDB] ${seriesDeleted} séries deletadas`);
      
      return seriesDeleted;
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao deletar séries:', error.message);
      throw error;
    }
  }

  /**
   * Deleta todo o conteúdo VOD (filmes + séries)
   */
  async deleteAllVOD(): Promise<{ movies: number; series: number }> {
    const movies = await this.deleteAllMovies();
    const series = await this.deleteAllSeries();

    return { movies, series };
  }

  /**
   * Adiciona série a um bouquet (bouquet ID=3 para séries)
   * @param bouquetId ID do bouquet (usar 3 para séries)
   * @param seriesId ID da série em streams_series
   */
  async addSeriesToBouquet(bouquetId: number, seriesId: number): Promise<void> {
    const conn = await this.connect();
    
    try {
      // Buscar array atual
      const [bouquetRows] = await conn.query<any[]>(
        `SELECT bouquet_series FROM bouquets WHERE id = ?`,
        [bouquetId]
      );
      
      if (bouquetRows.length === 0) {
        logger.warn(`[XUIVodDB] Bouquet ${bouquetId} não encontrado`);
        return;
      }
      
      // Parsear JSON
      let series: number[] = [];
      try {
        series = JSON.parse(bouquetRows[0].bouquet_series || '[]');
      } catch (e) {
        series = [];
      }
      
      // Verificar se já está
      if (series.includes(seriesId)) {
        logger.debug(`[XUIVodDB] Série ${seriesId} já está no bouquet ${bouquetId}`);
        return;
      }
      
      // Adicionar
      series.push(seriesId);
      
      // Atualizar
      await conn.query(
        `UPDATE bouquets SET bouquet_series = ? WHERE id = ?`,
        [JSON.stringify(series), bouquetId]
      );
      
      logger.debug(`[XUIVodDB] Série ${seriesId} adicionada ao bouquet ${bouquetId}`);
    } catch (error: any) {
      logger.error(`[XUIVodDB] Erro ao adicionar série ao bouquet:`, error.message);
      throw error;
    }
  }

  /**
   * Cria ou busca uma série em streams_series
   * @param seriesInfo Dados da série
   * @returns ID da série (existente ou criada)
   */
  async getOrCreateSeries(seriesInfo: SeriesInfo): Promise<number> {
    const conn = await this.connect();
    
    try {
      // Preferir match por TMDB ID quando disponível (mais confiável que título)
      if (seriesInfo.tmdb_id) {
        const [existingByTmdb] = await conn.query<any[]>(
          `SELECT id FROM series WHERE tmdb_id = ? LIMIT 1`,
          [seriesInfo.tmdb_id]
        );

        if (existingByTmdb.length > 0) {
          logger.debug(`[XUIVodDB] Série já existe por TMDB: ${seriesInfo.title} (TMDB: ${seriesInfo.tmdb_id}, ID: ${existingByTmdb[0].id})`);
          return existingByTmdb[0].id;
        }
      }

      // Verificar se já existe
      const [existing] = await conn.query<any[]>(
        `SELECT id FROM series WHERE title = ? LIMIT 1`,
        [seriesInfo.title]
      );
      
      if (existing.length > 0) {
        logger.debug(`[XUIVodDB] Série já existe: ${seriesInfo.title} (ID: ${existing[0].id})`);
        return existing[0].id;
      }
      
      // Criar nova série
      // ⚠️ CORREÇÃO: Mesmo fix do filme - evitar double encoding
      const categoryIdArray = seriesInfo.category_id.map(id => parseInt(String(id), 10));
      const categoryIdJson = `[${categoryIdArray.join(',')}]`;
      const now = Math.floor(Date.now() / 1000);
      
      const [result] = await conn.query<any>(
        `INSERT INTO series (
          title,
          category_id,
          cover,
          cover_big,
          genre,
          plot,
          cast,
          rating,
          director,
          releaseDate,
          last_modified,
          tmdb_id,
          seasons,
          episode_run_time,
          backdrop_path,
          youtube_trailer,
          year
        ) VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          '[]',
          ?,
          '[]',
          '',
          ?
        )`,
        [
          seriesInfo.title,
          categoryIdJson,
          seriesInfo.cover || null,
          seriesInfo.cover_big || seriesInfo.cover || null,
          seriesInfo.genre || '',
          seriesInfo.plot || '',
          seriesInfo.cast || '',
          seriesInfo.rating || 0,
          seriesInfo.director || '',
          seriesInfo.release_date || '',
          now,
          seriesInfo.tmdb_id || null,
          seriesInfo.episode_run_time || 45,
          seriesInfo.year || null,
        ]
      );
      
      const insertResult = result as any;
      const seriesId = insertResult.insertId || insertResult[0]?.insertId;
      
      // ⚠️ VALIDAÇÃO CRÍTICA: Verificar se insertId foi retornado
      if (!seriesId || seriesId === 0) {
        logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO: insertId não retornado ao criar série "${seriesInfo.title}"!`);
        logger.error(`[XUIVodDB] Result object:`, { insertResult });
        throw new Error(`Falha ao obter ID da série criada: "${seriesInfo.title}"`);
      }
      
      logger.debug(`[XUIVodDB] Série criada: ${seriesInfo.title} (ID: ${seriesId})`);
      return seriesId;
    } catch (error: any) {
      logger.error(`[XUIVodDB] Erro ao criar/buscar série:`, error.message);
      throw error;
    }
  }

  /**
   * Insere episódios em lote (streams com type=5)
   * @param episodes Array de episódios
   * @param batchSize Tamanho do lote
   * @returns Estatísticas de inserção
   */
  async bulkInsertEpisodes(episodes: EpisodeData[], batchSize = 1000, skipDuplicates = true): Promise<{ inserted: number; errors: number; skipped: number }> {
    const conn = await this.connect();
    const now = Math.floor(Date.now() / 1000);
    
    let inserted = 0;
    let errors = 0;
    let skipped = 0;

    // 🚀 OTIMIZAÇÃO: Sub-lote para inserção (permite obter IDs de forma confiável)
    const subBatchSize = 200; // Processar 200 por vez para obter IDs corretamente

    // ✅ KEEPALIVE: Fazer ping a cada 5 minutos para manter conexão viva (CRUCIAL para 200k episódios)
    let lastPingTime = Date.now();
    const PING_INTERVAL = 5 * 60 * 1000; // 5 minutos
    
    const keepAlive = async () => {
      const now = Date.now();
      if (now - lastPingTime > PING_INTERVAL) {
        try {
          await conn.query('SELECT 1');
          logger.debug('[XUIVodDB] ✅ Keepalive (episódios): Conexão MySQL ainda ativa');
          lastPingTime = now;
        } catch (err: any) {
          logger.error('[XUIVodDB] ❌ Keepalive falhou (episódios):', err.message);
        }
      }
    };

    try {
      // 🚀 OTIMIZAÇÃO: Processar em lotes grandes para verificação de duplicados
      for (let i = 0; i < episodes.length; i += batchSize) {
        // ✅ KEEPALIVE: Verificar e fazer ping se necessário (a cada 1000 episódios)
        await keepAlive();
        
        const batch = episodes.slice(i, i + batchSize);
        
        try {
          // 1. Filtrar episódios válidos
          const validEpisodes = batch.filter(ep => {
            if (!ep.seriesId || ep.seriesId === 0) {
              logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO: Episódio com seriesId inválido! seriesId = ${ep.seriesId}, nome = "${ep.stream_display_name}"`);
              skipped++;
              return false;
            }
            return true;
          });

          if (validEpisodes.length === 0) {
            continue;
          }

          // 2. 🚀 OTIMIZAÇÃO: Verificar duplicados em LOTE (uma query para todo o lote)
          let episodesToInsert = validEpisodes;
          if (skipDuplicates) {
            // Construir query com placeholders para segurança
            const duplicateChecks = validEpisodes.map(() => 
              `(series_id = ? AND season_num = ? AND episode_num = ?)`
            ).join(' OR ');
            
            const duplicateParams = validEpisodes.flatMap(ep => 
              [ep.seriesId, ep.season, ep.episode]
            );

            const [existing] = await conn.query<any[]>(
              `SELECT series_id, season_num, sort FROM series_episodes 
               WHERE ${duplicateChecks}`,
              duplicateParams
            );

            // Criar Set de duplicados para busca rápida
            const duplicatesSet = new Set(
              existing.map((row: any) => `${row.series_id}-${row.season_num}-${row.episode_num}`)
            );

            // Filtrar duplicados
            episodesToInsert = validEpisodes.filter(ep => {
              const key = `${ep.seriesId}-${ep.season}-${ep.episode}`;
              if (duplicatesSet.has(key)) {
                skipped++;
                logger.debug(`[XUIVodDB] Episódio duplicado ignorado: S${ep.season}E${ep.episode} (série ${ep.seriesId})`);
                return false;
              }
              return true;
            });
          }

          if (episodesToInsert.length === 0) {
            continue;
          }

          // 3. 🚀 OTIMIZAÇÃO: Processar em sub-lotes para inserção (obter IDs corretamente)
          for (let j = 0; j < episodesToInsert.length; j += subBatchSize) {
            const subBatch = episodesToInsert.slice(j, j + subBatchSize);
            
            try {
              await conn.beginTransaction();

              // Preparar dados para inserção em LOTE
              const streamsValues: any[] = [];
              const streamsPlaceholders: string[] = [];
              const episodesData: Array<{ seriesId: number; season: number; episode: number }> = [];

              for (const episode of subBatch) {
                // ⚠️ CORREÇÃO: movie_properties baseado no sincronizador
                const movieProperties = JSON.stringify({
                  release_date: '',
                  plot: '',
                  duration_secs: 2700,
                  duration: '00:45:00',
                  movie_image: episode.stream_icon || '',
                  video: [],
                  audio: [],
                  bitrate: 0,
                  rating: '0',
                  season: episode.season.toString(),
                  tmdb_id: ''
                });
                
                const categoryIdArray = episode.category_id && episode.category_id.length > 0
                  ? episode.category_id.map(id => parseInt(String(id), 10))
                  : [];
                // ⚠️ CORREÇÃO: Evitar double encoding
                const categoryIdJson = `[${categoryIdArray.join(',')}]`;
                const streamSourceJson = JSON.stringify(episode.stream_source || []);
                const streamIcon = episode.stream_icon && episode.stream_icon.trim() ? episode.stream_icon.trim() : null;

                streamsValues.push(
                  categoryIdJson,
                  episode.stream_display_name,
                  streamSourceJson,
                  streamIcon,
                  '', // notes
                  movieProperties,
                  now,
                  episode.seriesId
                );

                streamsPlaceholders.push('(5, ?, ?, ?, ?, ?, 0, ?, 0, \'mp4\', 0, 0, 1, ?, ?, \'pt-br\', NULL, 0)');
                episodesData.push({
                  seriesId: episode.seriesId,
                  season: episode.season,
                  episode: episode.episode
                });
              }

              // 4. 🚀 OTIMIZAÇÃO: INSERT em LOTE em streams
              const streamsQuery = `
                INSERT INTO streams 
                (type, category_id, stream_display_name, stream_source, stream_icon, notes, 
                enable_transcode, movie_propeties, read_native, target_container, stream_all, 
                remove_subtitles, direct_source, added, series_no, tmdb_language, year, rating)
                VALUES ${streamsPlaceholders.join(', ')}
              `;

              await conn.query(streamsQuery, streamsValues);

              // 5. Buscar IDs inseridos usando LAST_INSERT_ID() (retorna primeiro ID do lote)
              const [lastInsertResult] = await conn.query<any[]>(
                `SELECT LAST_INSERT_ID() as first_id`
              );
              
              const firstId = lastInsertResult[0]?.first_id || 0;

              // Obter lista de series_no do sub-lote para busca mais precisa
              const seriesNos = [...new Set(subBatch.map(ep => ep.seriesId))];

              // Buscar todos os IDs inseridos usando firstId e series_no do lote
              const [insertedStreams] = await conn.query<any[]>(
                `SELECT id, series_no FROM streams 
                 WHERE id >= ? 
                 AND type = 5
                 AND added = ?
                 AND series_no IN (${seriesNos.map(() => '?').join(',')})
                 ORDER BY id ASC
                 LIMIT ?`,
                [firstId, now, ...seriesNos, subBatch.length]
              );

              // 6. 🚀 OTIMIZAÇÃO: INSERT em LOTE em streams_episodes
              if (insertedStreams.length > 0) {
                const episodesValues: any[] = [];
                const episodesPlaceholders: string[] = [];

                // Mapear streams para episódios (ordem de inserção = ordem de busca)
                // Verificar se a quantidade corresponde
                if (insertedStreams.length !== subBatch.length) {
                  logger.warn(`[XUIVodDB] ⚠️ Quantidade diferente: inseridos=${insertedStreams.length}, esperado=${subBatch.length}`);
                }

                // Mapear sequencialmente (assumindo ordem mantida)
                for (let idx = 0; idx < Math.min(insertedStreams.length, subBatch.length); idx++) {
                  const streamId = insertedStreams[idx].id;
                  const episode = subBatch[idx];
                  
                  episodesValues.push(streamId, episode.seriesId, episode.season, episode.episode);
                  episodesPlaceholders.push('(?, ?, ?, ?)');
                }

                if (episodesPlaceholders.length > 0) {
                  const episodesQuery = `
                    INSERT INTO series_episodes (stream_id, series_id, season_num, sort)
                    VALUES ${episodesPlaceholders.join(', ')}
                  `;
                  await conn.query(episodesQuery, episodesValues);
                }

                inserted += insertedStreams.length;
              }

              await conn.commit();
            } catch (error: any) {
              await conn.rollback();
              logger.error(`[XUIVodDB] ❌ ERRO no sub-lote ${j}-${j + subBatch.length}:`, {
                message: error.message,
                code: error.code,
              });
              errors += subBatch.length;
            }
          }
          
          logger.info(`[XUIVodDB] Lote processado: ${inserted}/${episodes.length} episódios inseridos até agora (${skipped} duplicados, ${errors} erros)`);
        } catch (error: any) {
          logger.error(`[XUIVodDB] ❌ ERRO CRÍTICO no lote ${i}-${i + batchSize}:`, {
            message: error.message,
            code: error.code,
          });
          errors += batch.length;
        }
      }

      logger.info(`[XUIVodDB] Importação de episódios concluída: ${inserted} inseridos, ${errors} erros, ${skipped} duplicados ignorados`);
      return { inserted, errors, skipped };
    } catch (error: any) {
      const errorDetails = {
        message: error.message || 'Erro sem mensagem',
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        stack: error.stack?.substring(0, 500),
        name: error.name,
        fatal: error.fatal,
      };
      logger.error('[XUIVodDB] ❌ ERRO DETALHADO na importação de episódios:', errorDetails);
      throw error;
    }
  }

  /**
   * Atualiza o campo seasons de uma série baseado nos episódios inseridos
   * @param seriesId ID da série
   * @param episodes Array de episódios com informações de temporada
   * @param tmdbSeriesData Dados da série do TMDB (opcional, para enriquecimento)
   */
  async updateSeriesSeasons(seriesId: number, episodes: EpisodeData[], tmdbSeriesData?: any): Promise<void> {
    // ⚠️ CORREÇÃO: Não criar nova conexão, usar a conexão compartilhada da classe
    // O disconnect() já fecha todas as conexões ao final da importação
    const conn = await this.connect();
    
    try {
      // Agrupar episódios por temporada
      const seasonMap = new Map<number, number>();
      
      for (const ep of episodes) {
        const season = ep.season || 1;
        const currentCount = seasonMap.get(season) || 0;
        seasonMap.set(season, currentCount + 1);
      }
      
      // Montar estrutura do JSON seasons
      const seasons: any[] = [];
      
      // Ordenar temporadas
      const sortedSeasons = Array.from(seasonMap.keys()).sort((a, b) => a - b);
      
      for (const seasonNum of sortedSeasons) {
        const episodeCount = seasonMap.get(seasonNum) || 0;
        
        // Tentar encontrar dados da temporada no TMDB
        let tmdbSeason: any = null;
        if (tmdbSeriesData?.seasons) {
          tmdbSeason = tmdbSeriesData.seasons.find(
            (s: any) => s.season_number === seasonNum
          );
        }
        
        if (tmdbSeason) {
          // Com dados do TMDB
          seasons.push({
            id: tmdbSeason.id || seasonNum, // ⚠️ OBRIGATÓRIO! ID do TMDB ou sequencial
            season_number: seasonNum,
            name: tmdbSeason.name || `Temporada ${seasonNum}`,
            episode_count: episodeCount, // Usar contagem real importada
            overview: tmdbSeason.overview || '',
            air_date: tmdbSeason.air_date || '',
            vote_average: tmdbSeason.vote_average || 0, // ⚠️ OBRIGATÓRIO!
            cover: tmdbSeason.poster_path 
              ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tmdbSeason.poster_path}`
              : '',
            cover_big: tmdbSeason.poster_path 
              ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tmdbSeason.poster_path}`
              : ''
          });
        } else {
          // Sem TMDB - usar dados básicos com ID sequencial
          seasons.push({
            id: seasonNum, // ⚠️ OBRIGATÓRIO! Usar número como ID
            season_number: seasonNum,
            name: `Temporada ${seasonNum}`,
            episode_count: episodeCount,
            overview: '',
            air_date: '',
            vote_average: 0, // ⚠️ OBRIGATÓRIO!
            cover: '',
            cover_big: ''
          });
        }
      }
      
      // Atualizar no banco
      const seasonsJson = JSON.stringify(seasons);
      
      await conn.query(
        `UPDATE series SET seasons = ? WHERE id = ?`,
        [seasonsJson, seriesId]
      );
      
      logger.info(`[XUIVodDB] Série ${seriesId} atualizada: ${seasons.length} temporadas, ${episodes.length} episódios total`);
    } catch (error: any) {
      logger.error(`[XUIVodDB] Erro ao atualizar seasons da série ${seriesId}:`, error.message);
      // ⚠️ CORREÇÃO: Não lançar erro, apenas logar (não crítico para a importação)
      // O campo seasons pode ser atualizado depois manualmente se necessário
      logger.warn(`[XUIVodDB] Continuando importação mesmo com erro ao atualizar seasons (não crítico)`);
    }
  }

  /**
   * Adiciona filmes a um bouquet
   * @param bouquetId ID do bouquet
   * @param movieIds Array de IDs de filmes para adicionar
   */
  async addMoviesToBouquet(bouquetId: number, movieIds: number[]): Promise<void> {
    const conn = await this.connect();

    try {
      // Buscar bouquet atual
      const [bouquets] = await conn.query<any[]>(
        `SELECT bouquet_movies FROM bouquets WHERE id = ?`,
        [bouquetId]
      );

      if (bouquets.length === 0) {
        throw new Error(`Bouquet com ID ${bouquetId} não encontrado`);
      }

      // Parse do JSON atual
      const currentMoviesJson = bouquets[0].bouquet_movies || '[]';
      let currentMovies: number[] = [];
      
      try {
        currentMovies = JSON.parse(currentMoviesJson);
      } catch (e) {
        logger.warn(`[XUIVodDB] Erro ao fazer parse do bouquet_movies, iniciando com array vazio`);
        currentMovies = [];
      }

      // Adicionar novos IDs (evitar duplicados)
      const updatedMovies = [...new Set([...currentMovies, ...movieIds])];

      // Atualizar bouquet
      await conn.query(
        `UPDATE bouquets SET bouquet_movies = ? WHERE id = ?`,
        [JSON.stringify(updatedMovies), bouquetId]
      );

      logger.info(`[XUIVodDB] ${movieIds.length} filmes adicionados ao bouquet ${bouquetId} (total: ${updatedMovies.length})`);
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao adicionar filmes ao bouquet:', error.message);
      throw error;
    }
  }

  /**
   * Adiciona canais LIVE a um bouquet
   * @param bouquetId ID do bouquet (normalmente ID=1 para "All Channels")
   * @param channelIds Array de IDs de canais para adicionar
   */
  async addChannelsToBouquet(bouquetId: number, channelIds: number[]): Promise<void> {
    const conn = await this.connect();

    try {
      // Buscar bouquet atual
      const [bouquets] = await conn.query<any[]>(
        `SELECT bouquet_channels FROM bouquets WHERE id = ?`,
        [bouquetId]
      );

      if (bouquets.length === 0) {
        throw new Error(`Bouquet com ID ${bouquetId} não encontrado`);
      }

      // Parse do JSON atual
      const currentChannelsJson = bouquets[0].bouquet_channels || '[]';
      let currentChannels: number[] = [];
      
      try {
        currentChannels = JSON.parse(currentChannelsJson);
      } catch (e) {
        logger.warn(`[XUIVodDB] Erro ao fazer parse do bouquet_channels, iniciando com array vazio`);
        currentChannels = [];
      }

      // Adicionar novos IDs (evitar duplicados)
      const updatedChannels = [...new Set([...currentChannels, ...channelIds])];

      // Atualizar bouquet
      await conn.query(
        `UPDATE bouquets SET bouquet_channels = ? WHERE id = ?`,
        [JSON.stringify(updatedChannels), bouquetId]
      );

      logger.info(`[XUIVodDB] ${channelIds.length} canais adicionados ao bouquet ${bouquetId} (total: ${updatedChannels.length})`);
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao adicionar canais ao bouquet:', error.message);
      throw error;
    }
  }

  /**
   * Deleta um stream LIVE (type=1) por ID
   * - remove vínculo em streams_servers
   * - remove stream em streams
   */
  async deleteLiveStreamById(streamId: number): Promise<void> {
    const conn = await this.connect();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM streams_sys WHERE stream_id = ?`, [streamId]);
      const [result] = await conn.query<any>(`DELETE FROM streams WHERE id = ? AND type = 1`, [streamId]);
      await conn.commit();
      const affected = (result as any)?.affectedRows ?? 0;
      logger.info(`[XUIVodDB] deleteLiveStreamById: streamId=${streamId} affected=${affected}`);
    } catch (error: any) {
      try { await conn.rollback(); } catch {}
      logger.error('[XUIVodDB] Erro ao deletar stream live:', error.message);
      throw error;
    }
  }

  /**
   * Busca a URL (source) de um stream LIVE existente no XUI (type=1)
   * Retorna a primeira URL encontrada
   */
  async getLiveStreamSource(streamId: number): Promise<string | null> {
    const conn = await this.connect();
    const [rows] = await conn.query<any[]>(
      `SELECT stream_source FROM streams WHERE id = ? AND type = 1 LIMIT 1`,
      [streamId]
    );
    if (!rows || rows.length === 0) return null;
    const raw = rows[0].stream_source;
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
    } catch {
      // pode vir como string simples
      if (typeof raw === 'string') return raw;
    }
    return null;
  }

  /**
   * Deleta todos os canais LIVE do XUI
   */
  async deleteAllLiveChannels(): Promise<number> {
    const conn = await this.connect();

    try {
      const [result] = await conn.query(
        'DELETE FROM streams WHERE type = 1'
      );

      const affectedRows = (result as any).affectedRows || 0;
      logger.info(`[XUIVodDB] ${affectedRows} canais deletados`);
      return affectedRows;
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao deletar canais:', error.message);
      throw error;
    }
  }

  /**
   * Detecta o nome da tabela de categorias (varia entre XUI ONE e Xtream UI)
   */
  private async getCategoryTableName(conn: Connection): Promise<string> {
    const candidates = ['streams_categories', 'stream_categories'];
    for (const name of candidates) {
      try {
        const [exists] = await conn.query<any[]>(`SHOW TABLES LIKE '${name}'`);
        if (exists.length > 0) return name;
      } catch { /* ignorar */ }
    }
    return 'streams_categories';
  }

  /**
   * Lista todas as categorias de um tipo
   * @param categoryType Tipo da categoria ('movie', 'series', 'live')
   * @returns Lista de categorias
   */
  async getCategories(categoryType: string): Promise<Array<{ id: number; category_name: string; parent_id?: number }>> {
    const conn = await this.connect();
    try {
      const catTable = await this.getCategoryTableName(conn);
      const [rows] = await conn.query<any[]>(
        `SELECT id, category_name, parent_id 
         FROM ${catTable} 
         WHERE category_type = ? 
         ORDER BY category_name ASC`,
        [categoryType]
      );
      return rows.map(row => ({
        id: row.id,
        category_name: row.category_name,
        parent_id: row.parent_id
      }));
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao listar categorias:', error.message);
      return [];
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Busca categoria por nome
   * @param categoryName Nome da categoria
   * @param categoryType Tipo da categoria ('movie', 'series', 'live')
   * @returns Categoria encontrada ou null
   */
  async findCategoryByName(categoryName: string, categoryType: string): Promise<{ id: number; category_name: string } | null> {
    const conn = await this.connect();

    try {
      const catTable = await this.getCategoryTableName(conn);
      const [rows] = await conn.query<any[]>(
        `SELECT id, category_name FROM ${catTable} 
         WHERE category_name = ? AND category_type = ? 
         LIMIT 1`,
        [categoryName, categoryType]
      );

      if (rows.length === 0) {
        return null;
      }

      return {
        id: rows[0].id,
        category_name: rows[0].category_name,
      };
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao buscar categoria:', error.message);
      return null;
    }
  }

  /**
   * Cria nova categoria no XUI
   * @param categoryData Dados da categoria
   * @returns Categoria criada com ID
   */
  async createCategory(categoryData: {
    category_name: string;
    category_type: string;
    parent_id?: number;
  }): Promise<{ id: number; category_name: string }> {
    const conn = await this.connect();

    try {
      const catTable = await this.getCategoryTableName(conn);
      const [result] = await conn.query<any>(
        `INSERT INTO ${catTable} (category_name, category_type, parent_id) 
         VALUES (?, ?, ?)`,
        [
          categoryData.category_name,
          categoryData.category_type,
          categoryData.parent_id || 0,
        ]
      );

      const insertId = result.insertId;

      logger.info(`[XUIVodDB] Categoria criada: "${categoryData.category_name}" (ID: ${insertId})`);

      return {
        id: insertId,
        category_name: categoryData.category_name,
      };
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao criar categoria:', error.message);
      throw error;
    }
  }

  /**
   * Busca canal por nome e categoria
   * @param channelName Nome do canal
   * @param categoryId ID da categoria
   * @returns Canal encontrado ou null
   */
  async findChannelByName(channelName: string, categoryId: number): Promise<{ id: number; stream_display_name: string } | null> {
    const conn = await this.connect();

    try {
      // Xtream UI: category_id é int
      const [rows] = await conn.query<any[]>(
        `SELECT id, stream_display_name FROM streams 
         WHERE type = 1 
         AND stream_display_name = ? 
         AND category_id = ?
         LIMIT 1`,
        [channelName, categoryId]
      );

      if (rows.length > 0) {
        return { id: rows[0].id, stream_display_name: rows[0].stream_display_name };
      }
      return null;
    } catch (error: any) {
      logger.error('[XUIVodDB] Erro ao buscar canal por nome:', error.message);
      return null;
    }
  }

  /**
   * Atualiza apenas o stream_source de um canal existente
   * ⚠️ NOVA LÓGICA: Ao invés de deletar e recriar, apenas atualiza o link do vídeo
   * Isso mantém o link fixo no XUI e apenas substitui o vídeo localmente
   * @param channelName Nome do canal
   * @param newUrl Nova URL do vídeo
   * @param categoryId ID da categoria
   */
  async updateChannelSource(channelName: string, newUrl: string, categoryId: number): Promise<void> {
    const conn = await this.connect();

    try {
      // Buscar canal primeiro
      const channel = await this.findChannelByName(channelName, categoryId);
      
      if (!channel) {
        throw new Error(`Canal "${channelName}" não encontrado na categoria ${categoryId}`);
      }

      // Atualizar apenas o stream_source (mantém todas as outras configurações)
      await conn.query(
        `UPDATE streams 
         SET stream_source = ? 
         WHERE id = ?`,
        [JSON.stringify([newUrl]), channel.id]
      );

      logger.info(`[XUIVodDB] ✅ Canal "${channelName}" (ID: ${channel.id}) atualizado com novo vídeo: ${newUrl}`);
    } catch (error: any) {
      logger.error(`[XUIVodDB] ❌ Erro ao atualizar canal "${channelName}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Exclui filmes cujo stream_source contenha a URL base especificada
   * @param urlBase URL base para filtrar (ex: "http://cdn4k.net")
   * @param dryRun Se true, apenas conta sem excluir
   * @returns Número de filmes excluídos/encontrados
   */
  async deleteMoviesByUrlBase(urlBase: string, dryRun: boolean = false): Promise<{ found: number; deleted: number; ids: number[] }> {
    const conn = await this.connect();

    try {
      // Buscar todos os filmes que contêm a URL base no stream_source
      const [movies] = await conn.query<any[]>(
        `SELECT id, stream_display_name, stream_source 
         FROM streams 
         WHERE type = 2 
         AND stream_source LIKE ?`,
        [`%${urlBase}%`]
      );

      const matchingIds: number[] = [];

      for (const movie of movies) {
        try {
          // Parsear stream_source (pode ser JSON array ou string)
          let sources: string[] = [];
          if (typeof movie.stream_source === 'string') {
            try {
              sources = JSON.parse(movie.stream_source);
            } catch {
              sources = [movie.stream_source];
            }
          } else if (Array.isArray(movie.stream_source)) {
            sources = movie.stream_source;
          }

          // Verificar se alguma URL começa com urlBase
          const hasMatchingUrl = sources.some((url: string) => 
            url && url.startsWith(urlBase)
          );

          if (hasMatchingUrl) {
            matchingIds.push(movie.id);
          }
        } catch (parseError) {
          // Se não conseguir parsear, verificar string diretamente
          if (movie.stream_source && movie.stream_source.includes(urlBase)) {
            matchingIds.push(movie.id);
          }
        }
      }

      logger.info(`[XUIVodDB] 🔍 Encontrados ${matchingIds.length} filmes com URL base "${urlBase}"`);

      if (dryRun) {
        return { found: matchingIds.length, deleted: 0, ids: matchingIds };
      }

      if (matchingIds.length === 0) {
        return { found: 0, deleted: 0, ids: [] };
      }

      // Excluir em lotes de 500
      const batchSize = 500;
      let totalDeleted = 0;

      for (let i = 0; i < matchingIds.length; i += batchSize) {
        const batch = matchingIds.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');

        // Excluir da tabela movie_properties primeiro (se existir)
        try {
          await conn.query(
            `DELETE FROM movie_properties WHERE stream_id IN (${placeholders})`,
            batch
          );
        } catch (e) {
          // Tabela pode não existir em algumas versões do XUI
        }

        // Excluir da tabela streams
        const [result] = await conn.query<any>(
          `DELETE FROM streams WHERE id IN (${placeholders})`,
          batch
        );

        totalDeleted += result.affectedRows || batch.length;
        logger.info(`[XUIVodDB] 🗑️ Excluídos ${totalDeleted}/${matchingIds.length} filmes...`);
      }

      logger.info(`[XUIVodDB] ✅ Total de ${totalDeleted} filmes excluídos com URL base "${urlBase}"`);

      return { found: matchingIds.length, deleted: totalDeleted, ids: matchingIds };
    } catch (error: any) {
      logger.error(`[XUIVodDB] ❌ Erro ao excluir filmes por URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * DIAGNÓSTICO: Comparar filme que funciona vs. filme recém-inserido
   */
  async diagnoseMovieFormat(): Promise<any> {
    const conn = await this.connect();
    
    try {
      // 1. Buscar um filme que FUNCIONA (tem category_id E tmdb_id preenchidos)
      const [goodMovies] = await conn.query<any[]>(`
        SELECT id, stream_display_name, category_id, tmdb_id, direct_source, 
               movie_propeties AS movie_properties, stream_source, stream_icon, target_container,
               read_native, tmdb_language, rating, added
        FROM streams 
        WHERE type = 2 
          AND category_id IS NOT NULL 
          AND category_id != '' 
          AND category_id != '[]'
          AND tmdb_id > 0
        ORDER BY id ASC
        LIMIT 1
      `);

      // 2. Buscar os últimos 3 filmes inseridos
      const [recentMovies] = await conn.query<any[]>(`
        SELECT id, stream_display_name, category_id, tmdb_id, direct_source, 
               movie_propeties AS movie_properties, stream_source, stream_icon, target_container,
               read_native, tmdb_language, rating, added
        FROM streams 
        WHERE type = 2 
        ORDER BY id DESC
        LIMIT 3
      `);

      // 3. Verificar streams_servers
      const recentIds = recentMovies.map(m => m.id);
      let serverLinks: any[] = [];
      if (recentIds.length > 0) {
        const [links] = await conn.query<any[]>(`
          SELECT stream_id, server_id, on_demand
          FROM streams_sys
          WHERE stream_id IN (${recentIds.join(',')})
        `);
        serverLinks = links;
      }

      const formatMovie = (m: any) => ({
        id: m.id,
        name: m.stream_display_name?.substring(0, 50),
        category_id: m.category_id,
        category_id_type: typeof m.category_id,
        tmdb_id: m.tmdb_id,
        tmdb_id_type: typeof m.tmdb_id,
        direct_source: m.direct_source,
        read_native: m.read_native,
        tmdb_language: m.tmdb_language,
        rating: m.rating,
        stream_icon: m.stream_icon ? 'TEM' : 'NULL',
        stream_source: m.stream_source ? m.stream_source.substring(0, 100) : 'NULL',
        movie_properties: m.movie_properties ? m.movie_properties.substring(0, 300) : 'NULL',
        target_container: m.target_container,
      });

      return {
        goodMovie: goodMovies.length > 0 ? formatMovie(goodMovies[0]) : null,
        recentMovies: recentMovies.map(formatMovie),
        serverLinks,
      };
    } catch (error: any) {
      logger.error(`[XUIVodDB] Erro no diagnóstico: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restaurar dados do filme após a API do XUI sobrescrever
   * Usado após chamar activateMovie para corrigir os dados
   */
  async restoreMovieData(streamId: number, data: {
    category_id: string;
    stream_source: string;
    stream_icon: string | null;
    movie_properties: string;
    tmdb_id: number | null;
    rating: number | null;
    direct_source: number;
  }): Promise<void> {
    const conn = await this.connect();
    
    await conn.query(
      `UPDATE streams SET
        category_id = ?,
        stream_source = ?,
        stream_icon = COALESCE(?, stream_icon),
        movie_propeties = ?,
        tmdb_id = COALESCE(?, tmdb_id),
        rating = COALESCE(?, rating),
        direct_source = ?,
        read_native = 0,
        updated = NOW()
      WHERE id = ? LIMIT 1`,
      [
        data.category_id,
        data.stream_source,
        data.stream_icon,
        data.movie_properties,
        data.tmdb_id,
        data.rating,
        data.direct_source,
        streamId
      ]
    );
  }

  /**
   * Investigar estrutura completa da tabela streams
   * Para descobrir campo que ativa filmes no app
   */
  async investigateStreamStructure(): Promise<any> {
    const conn = await this.connect();
    try {
      // 1. Listar TODOS os campos da tabela streams
      const [columns] = await conn.query<any[]>(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = 'xui' AND TABLE_NAME = 'streams' 
        ORDER BY ORDINAL_POSITION
      `);

      // 2. Buscar um filme que funciona (salvo via painel XUI) - mais antigo com categoria
      const [goodMovie] = await conn.query<any[]>(`
        SELECT * FROM streams 
        WHERE type = 2 AND category_id IS NOT NULL AND category_id != '' AND category_id != '[]'
        ORDER BY id ASC LIMIT 1
      `);

      // 3. Buscar filme recém importado
      const [recentMovie] = await conn.query<any[]>(`
        SELECT * FROM streams 
        WHERE type = 2
        ORDER BY id DESC LIMIT 1
      `);

      // 4. Comparar TODOS os campos entre os dois filmes
      const comparison: Record<string, { good: any; recent: any; different: boolean }> = {};
      
      if (goodMovie.length > 0 && recentMovie.length > 0) {
        const good = goodMovie[0];
        const recent = recentMovie[0];
        
        for (const col of columns) {
          const fieldName = col.COLUMN_NAME;
          let goodVal = good[fieldName];
          let recentVal = recent[fieldName];
          
          // Truncar valores longos
          if (typeof goodVal === 'string' && goodVal.length > 100) {
            goodVal = goodVal.substring(0, 100) + '...';
          }
          if (typeof recentVal === 'string' && recentVal.length > 100) {
            recentVal = recentVal.substring(0, 100) + '...';
          }
          
          comparison[fieldName] = {
            good: goodVal,
            recent: recentVal,
            different: String(good[fieldName]) !== String(recent[fieldName])
          };
        }
      }

      // 5. Filtrar apenas campos diferentes
      const differences: Record<string, any> = {};
      for (const [field, data] of Object.entries(comparison)) {
        if (data.different) {
          differences[field] = data;
        }
      }

      return {
        totalColumns: columns.length,
        columns: columns.map((c: any) => c.COLUMN_NAME),
        goodMovieId: goodMovie.length > 0 ? goodMovie[0].id : null,
        recentMovieId: recentMovie.length > 0 ? recentMovie[0].id : null,
        differences,
        fullComparison: comparison,
      };
    } catch (error: any) {
      logger.error(`[XUIVodDB] Erro na investigação: ${error.message}`);
      throw error;
    }
  }

  async debugRecentMovies(): Promise<any> {
    const conn = await this.connect();
    const [total]: any = await conn.query('SELECT COUNT(*) as cnt FROM streams WHERE type = 2');
    const [recent]: any = await conn.query('SELECT id, stream_display_name, category_id, tmdb_id FROM streams WHERE type = 2 ORDER BY id DESC LIMIT 10');
    const [withServer]: any = await conn.query('SELECT COUNT(DISTINCT ss.stream_id) as cnt FROM streams_sys ss JOIN streams s ON s.id = ss.stream_id WHERE s.type = 2');
    const [noServer]: any = await conn.query(`
      SELECT s.id, s.stream_display_name 
      FROM streams s 
      LEFT JOIN streams_sys ss ON s.id = ss.stream_id 
      WHERE s.type = 2 AND ss.stream_id IS NULL 
      ORDER BY s.id DESC LIMIT 10
    `);
    
    // Listar todas as tabelas e categorias de filmes
    let movieCategories: any = [];
    let tables: any = [];
    try {
      [tables] = await conn.query("SHOW TABLES LIKE '%categ%'");
      // Buscar categorias tipo movie (category_type = 'movie' ou type = 2)
      try {
        [movieCategories] = await conn.query("SELECT id, category_name, category_type FROM stream_categories WHERE category_type = 'movie' LIMIT 10");
      } catch {
        try {
          [movieCategories] = await conn.query("SELECT id, category_name FROM stream_categories LIMIT 10");
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    
    // Verificar bouquets com filmes
    const [bouquets]: any = await conn.query(`
      SELECT id, bouquet_name, LENGTH(bouquet_movies) as movies_len 
      FROM bouquets 
      WHERE bouquet_movies IS NOT NULL AND bouquet_movies != '[]'
      ORDER BY id DESC LIMIT 5
    `);
    
    // Verificar se filme recente está em algum bouquet
    const recentId = recent.length > 0 ? recent[0].id : 0;
    const [inBouquet]: any = await conn.query(
      `SELECT id, bouquet_name FROM bouquets WHERE bouquet_movies LIKE ?`,
      [`%${recentId}%`]
    );
    
    return { 
      totalMovies: total[0].cnt, 
      moviesWithServer: withServer[0].cnt,
      moviesWithoutServer: noServer.length,
      recentMovies: recent,
      recentWithoutServer: noServer,
      categoryTables: tables,
      movieCategories: movieCategories,
      bouquetsWithMovies: bouquets,
      recentMovieInBouquet: inBouquet
    };
  }
}

