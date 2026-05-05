/**
 * Import Service - Serviço unificado de importação
 * 
 * SEGURO: Orquestra os importadores individuais
 * NÃO modifica dados existentes, apenas adiciona novos
 * 
 * USO:
 *   const service = new ImportService(xuiServer);
 *   const result = await service.importFromM3U(url, { vodType: 'movie', bouquetId: 2 });
 */

import { createLogger } from '../../utils/logger.js';
import { M3UParser, M3UItem } from './m3u-parser.js';
import { MovieImporter, MovieData } from './movie-importer.js';
import { SeriesImporter, SeriesWithEpisodes, SeriesInfo } from './series-importer.js';
import { LiveImporter, LiveChannelData } from './live-importer.js';
import { CategoryManager } from './category-manager.js';
import { BouquetManager } from './bouquet-manager.js';
import { XUIConnection } from './xui-connection.js';
import { TMDBService } from '../vod/tmdb.service.js';
import { tmdbKeyManager } from '../vod/tmdb-key-manager.service.js';
import { detectSeriesEpisode } from '../vod/series-episode-parser.js';
import type { XuiServer } from '@prisma/client';
import PostImportHookService, { ImportedContent } from '../marketing/post-import-hook.service.js';

const logger = createLogger('ImportService');

export interface ImportOptions {
  vodType?: 'movie' | 'series' | 'both' | 'live';
  serverId?: number;
  bouquetId?: number;
  bouquetIds?: number[];
  enrichWithTMDB?: boolean;
  importMode?: 'append' | 'update' | 'replace';
  deleteCategories?: boolean;
  categoryMappings?: Map<string, number>;
  autoCreateCategories?: boolean;
  batchSize?: number;
  maxItems?: number;
  selectedCategories?: string[];
  onProgress?: (progress: ImportProgress) => void;
  /**
   * Tipo de fonte:
   * - 'primary': Importação completa (padrão)
   * - 'secondary': Complementa a fonte primária (adiciona novos, pula existentes, complementa episódios)
   */
  sourceType?: 'primary' | 'secondary';
  /**
   * Atualizar séries existentes:
   * Quando true, busca série por TMDB ID ou título parcial e adiciona episódios novos
   */
  updateExistingSeries?: boolean;
  /**
   * Gerar banners e vídeos de marketing após importação
   */
  generateMarketing?: boolean;
  /**
   * ID do usuário que está importando
   */
  userId?: string;
}

export interface ImportProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

export interface ImportResult {
  success: boolean;
  inserted: number;
  skipped: number;
  errors: number;
  duration: number;
  details: {
    movies?: number;
    moviesUpdated?: number;
    series?: number;
    episodes?: number;
    channels?: number;
  };
}

export class ImportService {
  private server: XuiServer;
  private parser: M3UParser;
  private movieImporter: MovieImporter;
  private seriesImporter: SeriesImporter;
  private liveImporter: LiveImporter;
  private categoryManager: CategoryManager;
  private bouquetManager: BouquetManager;
  private tmdbService: TMDBService | null = null;
  private tmdbApiKeyOverride?: string;

  constructor(server: XuiServer, tmdbApiKey?: string) {
    this.tmdbApiKeyOverride = tmdbApiKey;
    this.server = server;
    this.parser = new M3UParser();
    this.movieImporter = new MovieImporter(server);
    this.seriesImporter = new SeriesImporter(server);
    this.liveImporter = new LiveImporter(server);
    this.categoryManager = new CategoryManager(server);
    this.bouquetManager = new BouquetManager(server);

    // Inicializar TMDB - usar key manager para rotação de múltiplas keys
    this.initTMDB(tmdbApiKey);
  }

  /**
   * Inicializa o serviço TMDB com rotação de keys (sync para constructor)
   */
  private initTMDB(overrideKey?: string): void {
    // Se uma key específica foi fornecida, usar ela
    if (overrideKey) {
      this.tmdbService = new TMDBService(overrideKey);
      logger.info('[ImportService] TMDB inicializado com key fornecida');
      return;
    }

    // Inicializar de forma assíncrona em background
    tmdbKeyManager.getAvailableKey().then(key => {
      if (key) {
        this.tmdbService = new TMDBService(key);
        logger.info('[ImportService] TMDB inicializado via KeyManager');
      } else {
        logger.warn('[ImportService] Nenhuma key TMDB disponível');
      }
    }).catch((error: any) => {
      logger.warn('[ImportService] Erro ao inicializar TMDB:', error.message);
    });
  }

  private async ensureTMDBReady(): Promise<void> {
    if (this.tmdbService) return;

    if (this.tmdbApiKeyOverride) {
      this.tmdbService = new TMDBService(this.tmdbApiKeyOverride);
      return;
    }

    const key = await tmdbKeyManager.getAvailableKey();
    if (key) {
      this.tmdbService = new TMDBService(key);
    }
  }

  private async tableExists(conn: XUIConnection, tableName: string): Promise<boolean> {
    try {
      const rows = await conn.query<any>(`SHOW TABLES LIKE ?`, [tableName]);
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  private async clearExistingData(options: ImportOptions): Promise<void> {
    if (options.importMode !== 'replace') return;
    if (options.sourceType === 'secondary') {
      throw new Error('Não é permitido apagar dados ao importar fonte secundária');
    }

    const vodType = options.vodType || 'both';
    const deleteCategories = options.deleteCategories === true;

    const conn = new XUIConnection(this.server);
    await conn.connect();

    try {
      this.emitProgress(options, 'cleanup', 0, 1, '🧹 Limpando dados existentes...');
      await conn.beginTransaction();

      try {
        if (vodType === 'movie' || vodType === 'both') {
          await conn.execute(
            `DELETE ss FROM streams_sys ss 
             JOIN streams st ON st.id = ss.stream_id 
             WHERE st.type = 2`
          );

          if (await this.tableExists(conn, 'movie_properties')) {
            await conn.execute(
              `DELETE mp FROM movie_properties mp 
               JOIN streams st ON st.id = mp.stream_id 
               WHERE st.type = 2`
            );
          }

          await conn.execute(`DELETE FROM streams WHERE type = 2`);
        }

        if (vodType === 'series' || vodType === 'both') {
          const seriesEpisodesTable = (await this.tableExists(conn, 'series_episodes'))
            ? 'series_episodes'
            : ((await this.tableExists(conn, 'streams_episodes')) ? 'streams_episodes' : null);

          if (seriesEpisodesTable) {
            await conn.execute(
              `DELETE se FROM ${seriesEpisodesTable} se 
               JOIN series s ON s.id = se.series_id`
            );
          }

          await conn.execute(
            `DELETE ss FROM streams_sys ss
             JOIN streams st ON st.id = ss.stream_id
             WHERE st.type = 5 AND st.series_no IN (SELECT id FROM series)`
          );

          await conn.execute(
            `DELETE FROM streams 
             WHERE type = 5 AND series_no IN (SELECT id FROM series)`
          );

          await conn.execute(`DELETE FROM series`);
        }

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }

      if (deleteCategories) {
        if (vodType === 'movie' || vodType === 'both') {
          await this.categoryManager.deleteCategoriesByType('movie');
        }
        if (vodType === 'series' || vodType === 'both') {
          await this.categoryManager.deleteCategoriesByType('series');
        }
      }

      this.emitProgress(options, 'cleanup', 1, 1, '✅ Limpeza concluída');
    } finally {
      await conn.disconnect();
    }
  }

  /**
   * Importa a partir de uma URL M3U
   */
  async importFromM3U(m3uUrl: string, options: ImportOptions = {}): Promise<ImportResult> {
    const startTime = Date.now();
    const result: ImportResult = {
      success: false,
      inserted: 0,
      skipped: 0,
      errors: 0,
      duration: 0,
      details: {},
    };

    try {
      if (options.enrichWithTMDB === true) {
        await this.ensureTMDBReady();
      }

      // 1. Fazer parse do M3U
      this.emitProgress(options, 'parse', 0, 1, '⬇️ Baixando M3U...');
      const parseResult = await this.parser.parseFromUrl(m3uUrl);
      this.emitProgress(options, 'parse', 1, 1, `✅ M3U parseado: ${parseResult.stats.total} itens (${parseResult.stats.movies} filmes, ${parseResult.stats.series} séries)`);
      logger.info(`[ImportService] M3U parseado: ${parseResult.stats.total} itens`);

      // 2. Filtrar por tipo
      let items = parseResult.items;
      if (options.vodType === 'movie') {
        items = this.parser.filterByType(items, 'movie');
      } else if (options.vodType === 'series') {
        items = this.parser.filterByType(items, 'series');
      } else if (options.vodType === 'both') {
        items = this.parser.filterByType(items, 'vod');
      } else if (options.vodType === 'live') {
        items = this.parser.filterByType(items, 'live');
      }

      // 3. Filtrar por categorias selecionadas
      if (options.selectedCategories && options.selectedCategories.length > 0) {
        const selectedSet = new Set(options.selectedCategories);
        items = items.filter(i => i.group && selectedSet.has(i.group));
        logger.info(`[ImportService] Filtrado para ${items.length} itens das categorias: ${options.selectedCategories.join(', ')}`);
      }

      // 4. Limitar se especificado
      if (options.maxItems && items.length > options.maxItems) {
        items = items.slice(0, options.maxItems);
      }

      logger.info(`[ImportService] ${items.length} itens para importar (tipo: ${options.vodType || 'all'})`);

      // 4. Limpeza opcional (modo replace)
      await this.clearExistingData(options);

      // 5. Mapear categorias
      this.emitProgress(options, 'categories', 0, 1, '🗂️ Mapeando categorias...');
      const categoryMapping = await this.mapCategories(items, options);
      this.emitProgress(options, 'categories', 1, 1, `✅ ${categoryMapping.size} categorias mapeadas`);

      // 6. Importar por tipo
      const movies = items.filter(i => i.type === 'movie');
      const series = items.filter(i => i.type === 'series');
      const channels = items.filter(i => i.type === 'live');

      // Importar filmes
      if (movies.length > 0 && options.vodType !== 'live') {
        this.emitProgress(options, 'movies', 0, movies.length, 'Importando filmes...');
        const movieResult = await this.importMovies(movies, categoryMapping, options);
        result.inserted += movieResult.inserted;
        result.skipped += movieResult.skipped;
        result.errors += movieResult.errors;
        result.details.movies = movieResult.inserted;
        result.details.moviesUpdated = movieResult.updated;
      }

      // Importar séries
      if (series.length > 0 && options.vodType !== 'live') {
        this.emitProgress(options, 'series', 0, series.length, 'Importando séries...');
        const seriesResult = await this.importSeriesItems(series, categoryMapping, options);
        result.inserted += seriesResult.seriesInserted;
        result.skipped += seriesResult.skipped;
        result.errors += seriesResult.errors;
        result.details.series = seriesResult.seriesInserted;
        result.details.episodes = seriesResult.episodesInserted;
      }

      // Importar canais LIVE
      if (channels.length > 0 && (options.vodType === 'live' || !options.vodType)) {
        this.emitProgress(options, 'live', 0, channels.length, 'Importando canais...');
        const liveResult = await this.importChannels(channels, categoryMapping, options);
        result.inserted += liveResult.inserted;
        result.skipped += liveResult.skipped;
        result.errors += liveResult.errors;
        result.details.channels = liveResult.inserted;
      }

      result.success = true;

      // 🎨 MARKETING: Gerar banners e vídeos se solicitado
      if (options.generateMarketing && result.inserted > 0) {
        this.emitProgress(options, 'marketing', 0, 1, '🎨 Gerando banners e vídeos de marketing...');
        try {
          const importId = `import_v2_${Date.now()}_${options.userId || 'system'}`;
          const importedContent: ImportedContent[] = [];

          // Coletar dados dos itens importados para marketing
          const allItems = [...movies, ...series].slice(0, 30); // Limitar a 30 itens
          for (const item of allItems) {
            const cleanTitle = this.cleanTitleForTMDB(item.name);
            importedContent.push({
              id: 0, // ID será ignorado para banners
              title: cleanTitle,
              type: item.type === 'series' ? 'series' : 'movie',
              posterUrl: item.logo || '',
              backdropUrl: '',
              synopsis: '',
              year: '',
              rating: 7.0,
              genres: [],
              tmdbId: undefined,
            });
          }

          if (importedContent.length > 0) {
            logger.info(`[ImportService] 🎨 MARKETING: Processando ${importedContent.length} itens...`);
            const marketingResult = await PostImportHookService.processImportedContent(
              importedContent,
              importId,
              this.server.id,
              options.serverId,
              options.bouquetId
            );
            
            if (marketingResult.success) {
              this.emitProgress(options, 'marketing', 1, 1, `✅ Marketing: ${marketingResult.bannersGenerated} banners gerados`);
              logger.info(`[ImportService] 🎨 MARKETING: ${marketingResult.bannersGenerated} banners gerados`);
            } else {
              logger.warn(`[ImportService] 🎨 MARKETING: Erro - ${marketingResult.error}`);
            }
          }
        } catch (marketingError: any) {
          logger.error(`[ImportService] 🎨 MARKETING: Erro ao gerar marketing: ${marketingError.message}`);
          // Não falhar a importação por erro de marketing
        }
      }
    } catch (error: any) {
      logger.error(`[ImportService] Erro na importação: ${JSON.stringify({ message: error.message, code: error.code, errno: error.errno, sqlState: error.sqlState, sqlMessage: error.sqlMessage, stack: error.stack?.substring(0, 500) })}`);
      if (error.stack) logger.error('[ImportService] Stack:', error.stack);
      result.errors++;
    }

    result.duration = Date.now() - startTime;
    logger.info(`[ImportService] Importação concluída em ${result.duration}ms`);
    return result;
  }

  /**
   * Mapeia categorias do M3U para IDs do XUI
   */
  private async mapCategories(
    items: M3UItem[], 
    options: ImportOptions
  ): Promise<Map<string, number>> {
    // Se mapeamento já fornecido, usar
    if (options.categoryMappings) {
      return options.categoryMappings;
    }

    // Extrair categorias únicas
    const categoriesSet = new Set<string>();
    for (const item of items) {
      if (item.group) categoriesSet.add(item.group);
    }

    // Mapear para IDs do XUI - CORRIGIDO: usar tipo correto (series/movie/live)
    const itemType = items[0]?.type;
    const categoryType = itemType === 'live' ? 'live' : (itemType === 'series' ? 'series' : 'movie');
    logger.info(`[ImportService] Mapeando categorias como tipo: ${categoryType}`);
    return await this.categoryManager.mapM3UCategories(
      Array.from(categoriesSet),
      categoryType,
      options.autoCreateCategories !== false
    );
  }

  /**
   * Importa filmes
   */
  private async importMovies(
    items: M3UItem[],
    categoryMapping: Map<string, number>,
    options: ImportOptions
  ): Promise<{ inserted: number; skipped: number; errors: number; updated: number }> {
    // Converter M3UItem para MovieData
    const movies: MovieData[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Buscar categoria
      const categoryId = categoryMapping.get(item.group || '') || 1;
      
      // Limpar título (remover ano, qualidade, etc.)
      const cleanTitle = this.cleanTitleForTMDB(item.name);

      // Criar MovieData com nome limpo
      const movie: MovieData = {
        stream_display_name: cleanTitle,
        stream_source: [item.url],
        stream_icon: item.logo,
        category_id: [categoryId],
      };

      // Enriquecer com TMDB se solicitado
      if (options.enrichWithTMDB && this.tmdbService) {
        try {
          // Buscar filme por nome limpo
          const searchResult = await this.tmdbService.searchMovie(cleanTitle);
          if (searchResult) {
            // 2. Buscar detalhes completos (trailer, cast, director, genres, etc.)
            const details = await this.tmdbService.getMovieDetails(searchResult.id);
            
            if (details) {
              // Extrair diretor
              const director = details.credits?.crew?.find((c: any) => c.job === 'Director')?.name || '';
              // Extrair elenco (top 10)
              const cast = details.credits?.cast?.slice(0, 10).map((c: any) => c.name).join(', ') || '';
              // Extrair trailer do YouTube
              const trailer = details.videos?.results?.find((v: any) => v.site === 'YouTube' && v.type === 'Trailer');
              const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '';
              // Extrair gêneros
              const genres = details.genres?.map((g: any) => g.name).join(', ') || '';
              // Extrair países
              const countries = details.production_countries?.map((c: any) => c.name).join(', ') || '';
              
              // PADRÃO XUI: cover_big e movie_image = poster, backdrop_path = array com backdrop
              const posterUrl = details.poster_path ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${details.poster_path}` : undefined;
              const backdropUrl = details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : undefined;
              
              movie.movie_properties = {
                kinopoisk_url: `https://www.themoviedb.org/movie/${details.id}`,
                tmdb_id: String(details.id),
                name: details.title,
                o_name: details.original_title,
                cover_big: posterUrl,           // Poster vertical (capa)
                movie_image: posterUrl,         // XUI usa poster aqui também!
                release_date: details.release_date,
                episode_run_time: details.runtime ? String(details.runtime) : '',
                youtube_trailer: trailer?.key || '',
                director: director,
                actors: cast,
                cast: cast,
                description: details.overview,
                plot: details.overview,
                age: '',
                mpaa_rating: '',
                rating_count_kinopoisk: 0,
                country: countries,
                genre: genres,
                backdrop_path: backdropUrl ? [backdropUrl] : [],  // Array com backdrop!
                duration_secs: (details.runtime || 0) * 60,
                duration: details.runtime ? `${String(Math.floor(details.runtime / 60)).padStart(2, '0')}:${(details.runtime % 60).toString().padStart(2, '0')}:00` : '',
                video: [],
                audio: [],
                bitrate: 0,
                rating: String(details.vote_average || 0),
              };
              // stream_icon = poster (vertical/card) - usar w500 para card
              movie.stream_icon = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : item.logo;
            } else {
              // Fallback: usar dados básicos da busca
              const posterUrl = searchResult.poster_path ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${searchResult.poster_path}` : undefined;
              const posterSmall = searchResult.poster_path ? `https://image.tmdb.org/t/p/w500${searchResult.poster_path}` : undefined;
              movie.movie_properties = {
                kinopoisk_url: `https://www.themoviedb.org/movie/${searchResult.id}`,
                tmdb_id: String(searchResult.id),
                name: searchResult.title,
                o_name: searchResult.original_title,
                cover_big: posterUrl,
                movie_image: posterUrl,
                release_date: searchResult.release_date,
                plot: searchResult.overview,
                description: searchResult.overview,
                rating: String(searchResult.vote_average || 0),
                backdrop_path: [],
                video: [],
                audio: [],
                bitrate: 0,
              };
              movie.stream_icon = posterSmall || item.logo;
            }
          }
        } catch (error: any) {
          logger.debug(`[ImportService] Erro TMDB para '${item.name}': ${error.message}`);
        }
      }

      movies.push(movie);

      // Emitir progresso a cada 20 filmes
      if (i % 20 === 0 && i > 0) {
        this.emitProgress(options, 'movies', i, items.length, `📽️ Preparando filmes: ${i}/${items.length}`);
      }
    }

    this.emitProgress(options, 'movies', movies.length, items.length, `📦 Inserindo ${movies.length} filmes no banco...`);
    
    // Importar
    const importResult = await this.movieImporter.importMovies(movies, {
      serverId: options.serverId,
      bouquetId: options.bouquetId,
      bouquetIds: options.bouquetIds,
      batchSize: options.batchSize,
      updateExisting: options.importMode === 'update',
      onProgress: (p) => {
        if (!p.message) return;
        this.emitProgress(options, 'movies', p.current, p.total, p.message);
      },
    });
    return {
      inserted: importResult.inserted,
      skipped: importResult.skipped,
      errors: importResult.errors,
      updated: Array.isArray(importResult.updatedIds) ? importResult.updatedIds.length : 0,
    };
  }

  /**
   * Importa séries
   */
  private async importSeriesItems(
    items: M3UItem[],
    categoryMapping: Map<string, number>,
    options: ImportOptions
  ): Promise<{ seriesInserted: number; episodesInserted: number; skipped: number; errors: number }> {
    // Agrupar episódios por série
    this.emitProgress(options, 'series', 0, items.length, `📋 Agrupando ${items.length} episódios por série...`);
    const seriesMap = new Map<string, SeriesWithEpisodes>();

    for (const item of items) {
      // Detectar informações de episódio
      const episodeInfo = detectSeriesEpisode(item.name, item.url, item.logo, item.group);
      if (!episodeInfo) continue;

      // Limpar título da série (remover ano, qualidade, etc.)
      const seriesTitle = this.cleanTitleForTMDB(episodeInfo.seriesName);
      const categoryId = categoryMapping.get(item.group || '') || 1;

      // Buscar ou criar série no mapa
      let seriesData = seriesMap.get(seriesTitle);
      if (!seriesData) {
        seriesData = {
          series: {
            title: seriesTitle,
            category_id: [categoryId],
            cover: item.logo,
          },
          episodes: [],
        };
        seriesMap.set(seriesTitle, seriesData);
      }

      // Adicionar episódio
      seriesData.episodes.push({
        season: episodeInfo.season,
        episode: episodeInfo.episode,
        stream_display_name: item.name,
        stream_source: [item.url],
        stream_icon: item.logo,
        category_id: [categoryId],
      });
    }

    // Enriquecer séries com TMDB se habilitado
    const seriesList = Array.from(seriesMap.values());
    const totalEpisodes = seriesList.reduce((acc, s) => acc + s.episodes.length, 0);
    this.emitProgress(options, 'series', 0, seriesList.length, `📺 ${seriesList.length} séries encontradas (${totalEpisodes} episódios)`);
    
    if (options.enrichWithTMDB && this.tmdbService) {
      this.emitProgress(options, 'tmdb', 0, seriesList.length, `🔍 Enriquecendo ${seriesList.length} séries com TMDB...`);
      let enriched = 0;
      for (const item of seriesList) {
        try {
          const details = await this.tmdbService.searchTV(item.series.title);
          if (details) {
            enriched++;
            const posterUrl = details.poster_path 
              ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${details.poster_path}` 
              : undefined;
            const backdropUrl = details.backdrop_path 
              ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` 
              : undefined;

            item.series.tmdb_id = details.id;
            item.series.cover = posterUrl || item.series.cover;
            item.series.cover_big = backdropUrl || posterUrl;
            item.series.plot = details.overview;
            item.series.genre = details.genres?.map((g: any) => g.name).join(', ');
            item.series.rating = details.vote_average;
            item.series.release_date = details.first_air_date;
            
            logger.debug(`[ImportService] Série '${item.series.title}' enriquecida (TMDB ID: ${details.id})`);
            
            // Emitir progresso a cada 5 séries
            if (enriched % 5 === 0) {
              this.emitProgress(options, 'tmdb', enriched, seriesList.length, `🔍 TMDB: ${enriched}/${seriesList.length} séries`);
            }
          }
        } catch (error: any) {
          logger.warn(`[ImportService] Erro TMDB série '${item.series.title}':`, error.message);
        }
      }
      this.emitProgress(options, 'tmdb', seriesList.length, seriesList.length, `✅ TMDB: ${enriched} séries enriquecidas`);
    }

    this.emitProgress(options, 'insert', 0, seriesList.length, `📦 Inserindo ${seriesList.length} séries no banco...`);
    
    // Importar
    return await this.seriesImporter.importSeries(seriesList, {
      serverId: options.serverId,
      bouquetId: options.bouquetId,
      bouquetIds: options.bouquetIds,
      sourceType: options.sourceType,
      updateExistingSeries: options.updateExistingSeries === true || options.importMode === 'update',
      onProgress: (p) => {
        if (!p.message) return;
        this.emitProgress(options, 'series', p.current, p.total, p.message);
      },
    });
  }

  /**
   * Importa canais LIVE
   */
  private async importChannels(
    items: M3UItem[],
    categoryMapping: Map<string, number>,
    options: ImportOptions
  ): Promise<{ inserted: number; skipped: number; errors: number }> {
    // Converter M3UItem para LiveChannelData
    const channels: LiveChannelData[] = items.map(item => {
      const categoryId = categoryMapping.get(item.group || '') || 1;
      return {
        stream_display_name: item.name,
        stream_source: [item.url],
        stream_icon: item.logo,
        category_id: [categoryId],
        gen_timestamps: 1, // Necessário para play azul
      };
    });

    // Importar
    return await this.liveImporter.importChannels(channels, {
      serverId: options.serverId,
      bouquetId: options.bouquetId,
      bouquetIds: options.bouquetIds,
      batchSize: options.batchSize,
    });
  }

  /**
   * Limpa título para busca no TMDB
   * Remove ano, qualidade, idioma e outros sufixos que atrapalham a busca
   */
  private cleanTitleForTMDB(title: string): string {
    return title
      // Remover ano com hífen: "Filme - 2024" -> "Filme"
      .replace(/\s*[-–]\s*(19|20)\d{2}\s*$/i, '')
      // Remover ano entre parênteses: "Filme (2024)" -> "Filme"
      .replace(/\s*\((19|20)\d{2}\)\s*/g, '')
      // Remover ano no final sem separador: "Filme 2024" -> "Filme"
      .replace(/\s+(19|20)\d{2}\s*$/i, '')
      // Remover qualidade: "4K", "1080p", "720p", "HD", "FHD", "UHD"
      .replace(/\s*[-–]?\s*(4k|1080p|720p|hd|fhd|uhd|bluray|webrip|hdtv|web-?dl|bdrip|dvdrip)\s*$/gi, '')
      // Remover idioma: "Dublado", "Legendado", "Dual Audio"
      .replace(/\s*[-–]?\s*(dublado|legendado|dual\s*audio|portuguese|english|ptbr|pt-br)\s*$/gi, '')
      // Remover espaços extras
      .trim();
  }

  /**
   * Emite progresso
   */
  private emitProgress(options: ImportOptions, phase: string, current: number, total: number, message: string): void {
    if (options.onProgress) {
      options.onProgress({ phase, current, total, message });
    }
  }

  /**
   * Preview do M3U sem importar
   */
  async previewM3U(m3uUrl: string): Promise<{
    total: number;
    movies: number;
    series: number;
    live: number;
    categories: { name: string; count: number; type: string }[];
  }> {
    const result = await this.parser.parseFromUrl(m3uUrl);
    return {
      total: result.stats.total,
      movies: result.stats.movies,
      series: result.stats.series,
      live: result.stats.live,
      categories: result.categories,
    };
  }

  async disconnect(): Promise<void> {
    await this.movieImporter.disconnect();
    await this.seriesImporter.disconnect();
    await this.liveImporter.disconnect();
    await this.categoryManager.disconnect();
    await this.bouquetManager.disconnect();
  }
}
