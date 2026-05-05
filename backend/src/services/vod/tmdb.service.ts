import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { retryHttp } from '../../utils/retry.util.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmdbKeyManager } from './tmdb-key-manager.service.js';
import * as stringSimilarity from 'string-similarity';

interface TMDBMovieSearchResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime: number | null;
  genres: Array<{ id: number; name: string }>;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
}

interface TMDBMovieDetails extends TMDBMovieSearchResult {
  credits: {
    cast: Array<{ name: string; character: string }>;
    crew: Array<{ name: string; job: string }>;
  };
  videos: {
    results: Array<{ key: string; site: string; type: string }>;
  };
}

interface TMDBSeriesSearchResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  vote_average: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: Array<{ id: number; name: string }>;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
}

interface TMDBSeriesDetails extends TMDBSeriesSearchResult {
  seasons: Array<{
    id: number;
    season_number: number;
    name: string;
    overview: string;
    air_date: string;
    vote_average: number;
    poster_path: string | null;
    episode_count: number;
  }>;
  created_by: Array<{ name: string }>;
  credits: {
    cast: Array<{ name: string; character: string }>;
  };
}

interface TMDBSeriesEpisode {
  id: number;
  name: string;
  overview: string;
  air_date: string;
  vote_average: number;
  still_path: string | null;
  runtime: number | null;
  episode_number: number;
  season_number: number;
}

export class TMDBService {
  private apiKey: string;
  private baseURL = 'https://api.themoviedb.org/3';
  private axiosInstance: AxiosInstance;
  private rateLimiter: { count: number; resetTime: number };
  private readonly RATE_LIMIT = 40; // 40 requests per 10 seconds
  private readonly RATE_WINDOW = 10000; // 10 seconds in milliseconds
  private useKeyManager: boolean = true; // Usar gerenciador de múltiplas chaves
  
  // ⚠️ CACHE: Diretórios de cache
  private readonly CACHE_DIR = path.join(process.cwd(), 'data', 'tmdb-cache');
  private readonly CACHE_MOVIES_DIR = path.join(this.CACHE_DIR, 'movies');
  private readonly CACHE_SERIES_DIR = path.join(this.CACHE_DIR, 'series');
  private readonly CACHE_EPISODES_DIR = path.join(this.CACHE_DIR, 'episodes');
  private readonly CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 dias em milissegundos

  constructor(apiKey?: string) {
    this.apiKey = apiKey || env.TMDB_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('[TMDBService] API key não fornecida');
    }

    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
    });

    this.rateLimiter = {
      count: 0,
      resetTime: Date.now() + this.RATE_WINDOW,
    };
    
    // ⚠️ CACHE: Garantir que diretórios existem
    this.ensureCacheDirs().catch(err => {
      logger.warn('[TMDBService] Erro ao criar diretórios de cache:', err.message);
    });
  }

  /**
   * ⚠️ CACHE: Garante que os diretórios de cache existem
   */
  private async ensureCacheDirs(): Promise<void> {
    try {
      await fs.mkdir(this.CACHE_MOVIES_DIR, { recursive: true });
      await fs.mkdir(this.CACHE_SERIES_DIR, { recursive: true });
      await fs.mkdir(this.CACHE_EPISODES_DIR, { recursive: true });
    } catch (error: any) {
      logger.error('[TMDBService] Erro ao criar diretórios de cache:', error.message);
    }
  }

  /**
   * ⚠️ CACHE: Lê cache de um filme
   */
  private async getCachedMovie(movieId: number): Promise<TMDBMovieDetails | null> {
    const filePath = path.join(this.CACHE_MOVIES_DIR, `${movieId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const cached = JSON.parse(data);
      const cacheDate = new Date(cached.cacheDate);
      
      if (Date.now() - cacheDate.getTime() < this.CACHE_DURATION) {
        logger.debug(`[TMDBService] ✅ Cache válido para filme ${movieId}`);
        delete cached.cacheDate; // Remover campo interno
        return cached;
      } else {
        logger.debug(`[TMDBService] ⏱️ Cache expirado para filme ${movieId}`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.debug(`[TMDBService] Cache não encontrado para filme ${movieId}`);
      }
    }
    return null;
  }

  /**
   * ⚠️ CACHE: Salva filme no cache
   */
  private async cacheMovie(movieId: number, movieData: TMDBMovieDetails): Promise<void> {
    const filePath = path.join(this.CACHE_MOVIES_DIR, `${movieId}.json`);
    try {
      const dataToCache = {
        ...movieData,
        cacheDate: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(dataToCache, null, 2));
      logger.debug(`[TMDBService] 💾 Cache salvo para filme ${movieId}`);
    } catch (error: any) {
      logger.warn(`[TMDBService] Erro ao salvar cache do filme ${movieId}:`, error.message);
    }
  }

  /**
   * ⚠️ CACHE: Lê cache de uma série
   */
  private async getCachedSeries(seriesId: number): Promise<TMDBSeriesDetails | null> {
    const filePath = path.join(this.CACHE_SERIES_DIR, `${seriesId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const cached = JSON.parse(data);
      const cacheDate = new Date(cached.cacheDate);
      
      if (Date.now() - cacheDate.getTime() < this.CACHE_DURATION) {
        logger.debug(`[TMDBService] ✅ Cache válido para série ${seriesId}`);
        delete cached.cacheDate; // Remover campo interno
        return cached;
      } else {
        logger.debug(`[TMDBService] ⏱️ Cache expirado para série ${seriesId}`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.debug(`[TMDBService] Cache não encontrado para série ${seriesId}`);
      }
    }
    return null;
  }

  /**
   * ⚠️ CACHE: Salva série no cache
   */
  private async cacheSeries(seriesId: number, seriesData: TMDBSeriesDetails): Promise<void> {
    const filePath = path.join(this.CACHE_SERIES_DIR, `${seriesId}.json`);
    try {
      const dataToCache = {
        ...seriesData,
        cacheDate: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(dataToCache, null, 2));
      logger.debug(`[TMDBService] 💾 Cache salvo para série ${seriesId}`);
    } catch (error: any) {
      logger.warn(`[TMDBService] Erro ao salvar cache da série ${seriesId}:`, error.message);
    }
  }

  /**
   * ⚠️ CACHE: Lê cache de um episódio
   */
  private async getCachedEpisode(seriesId: number, seasonNumber: number, episodeNumber: number): Promise<TMDBSeriesEpisode | null> {
    const cacheKey = `${seriesId}_${seasonNumber}_${episodeNumber}`;
    const filePath = path.join(this.CACHE_EPISODES_DIR, `${cacheKey}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const cached = JSON.parse(data);
      const cacheDate = new Date(cached.cacheDate);
      
      if (Date.now() - cacheDate.getTime() < this.CACHE_DURATION) {
        logger.debug(`[TMDBService] ✅ Cache válido para episódio ${seriesId} S${seasonNumber}E${episodeNumber}`);
        delete cached.cacheDate; // Remover campo interno
        return cached;
      }
    } catch (error: any) {
      // Cache não existe ou expirado - não é erro
    }
    return null;
  }

  /**
   * ⚠️ CACHE: Salva episódio no cache
   */
  private async cacheEpisode(seriesId: number, seasonNumber: number, episodeNumber: number, episodeData: TMDBSeriesEpisode): Promise<void> {
    const cacheKey = `${seriesId}_${seasonNumber}_${episodeNumber}`;
    const filePath = path.join(this.CACHE_EPISODES_DIR, `${cacheKey}.json`);
    try {
      const dataToCache = {
        ...episodeData,
        cacheDate: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(dataToCache, null, 2));
      logger.debug(`[TMDBService] 💾 Cache salvo para episódio ${seriesId} S${seasonNumber}E${episodeNumber}`);
    } catch (error: any) {
      logger.warn(`[TMDBService] Erro ao salvar cache do episódio:`, error.message);
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Obtém chave API (usa gerenciador de múltiplas chaves se disponível)
   */
  private async getApiKey(): Promise<string> {
    if (this.useKeyManager) {
      try {
        const key = await tmdbKeyManager.getAvailableKey();
        if (key) {
          return key;
        }
      } catch (error: any) {
        logger.debug('[TMDBService] Erro ao obter chave do gerenciador, usando chave padrão:', error.message);
      }
    }
    return this.apiKey;
  }

  /**
   * 🚀 OTIMIZAÇÃO: Registra sucesso no gerenciador de chaves
   */
  private async recordSuccess(apiKey: string): Promise<void> {
    if (this.useKeyManager && apiKey !== this.apiKey) {
      try {
        await tmdbKeyManager.recordSuccess(apiKey);
      } catch (error: any) {
        // Não crítico, apenas logar
        logger.debug('[TMDBService] Erro ao registrar sucesso:', error.message);
      }
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Registra erro no gerenciador de chaves
   */
  private async recordError(apiKey: string, error: string): Promise<void> {
    if (this.useKeyManager && apiKey !== this.apiKey) {
      try {
        await tmdbKeyManager.recordError(apiKey, error);
      } catch (err: any) {
        // Não crítico
        logger.debug('[TMDBService] Erro ao registrar erro:', err.message);
      }
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    
    if (now > this.rateLimiter.resetTime) {
      this.rateLimiter.count = 0;
      this.rateLimiter.resetTime = now + this.RATE_WINDOW;
    }

    if (this.rateLimiter.count >= this.RATE_LIMIT) {
      const waitTime = this.rateLimiter.resetTime - now;
      if (waitTime > 0) {
        logger.warn(`[TMDBService] Rate limit atingido. Aguardando ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.rateLimiter.count = 0;
        this.rateLimiter.resetTime = Date.now() + this.RATE_WINDOW;
      }
    }

    this.rateLimiter.count++;
  }

  /**
   * 🚀 OTIMIZAÇÃO: Busca filme com busca paralela em múltiplas linguagens
   */
  async searchMovie(title: string, year?: number): Promise<TMDBMovieSearchResult | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    try {
      await this.rateLimit();

      // 🚀 OTIMIZAÇÃO: Buscar em múltiplas linguagens em PARALELO
      const languages = ['pt-BR', 'en-US'];
      let allResults: any[] = [];

      await Promise.all(languages.map(async (language) => {
        try {
          // Buscar com ano e sem ano em paralelo
          const [resultWithYear, resultWithoutYear] = await Promise.all([
            year ? this.searchMovieInLanguage(title, year, language, apiKey) : Promise.resolve(null),
            this.searchMovieInLanguage(title, null, language, apiKey)
          ]);
          
          if (resultWithYear) allResults = [...allResults, ...resultWithYear];
          if (resultWithoutYear) allResults = [...allResults, ...resultWithoutYear];
        } catch (error: any) {
          logger.debug(`[TMDBService] Erro ao buscar em ${language}:`, error.message);
        }
      }));

      if (allResults.length === 0) {
        return null;
      }

      // 🚀 OTIMIZAÇÃO: Encontrar melhor correspondência usando similaridade
      const bestMatch = this.findBestMatch(title, allResults);
      
      if (bestMatch) {
        await this.recordSuccess(apiKey);
        return bestMatch;
      }

      return null;
    } catch (error: any) {
      logger.error('[TMDBService] Erro ao buscar filme:', error.message);
      const apiKey = await this.getApiKey();
      if (apiKey) await this.recordError(apiKey, error.message);
      return null;
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Busca filme em uma linguagem específica
   */
  private async searchMovieInLanguage(title: string, year: number | null, language: string, apiKey: string): Promise<TMDBMovieSearchResult[]> {
    try {
      const response = await retryHttp(
        () => this.axiosInstance.get('/search/movie', {
          params: {
            api_key: apiKey,
            query: title,
            year: year || undefined,
            language: language,
          },
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            logger.debug(`[TMDBService] Retentando busca de filme "${title}" em ${language} (tentativa ${attempt}/3)`);
          },
        }
      );

      return response.data.results || [];
    } catch (error: any) {
      logger.debug(`[TMDBService] Erro ao buscar filme em ${language}:`, error.message);
      return [];
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Encontra melhor correspondência usando similaridade de strings
   */
  private findBestMatch(title: string, results: any[]): TMDBMovieSearchResult | null {
    if (results.length === 0) return null;
    
    const similarities = results.map(result => ({
      result,
      similarity: Math.max(
        stringSimilarity.compareTwoStrings(title.toLowerCase(), result.title?.toLowerCase() || ''),
        stringSimilarity.compareTwoStrings(title.toLowerCase(), result.original_title?.toLowerCase() || '')
      )
    }));
    
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities[0]?.similarity > 0.3 ? similarities[0].result : null;
  }

  async getMovieDetails(movieId: number): Promise<TMDBMovieDetails | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    // ⚠️ CACHE: Verificar cache primeiro
    const cached = await this.getCachedMovie(movieId);
    if (cached) {
      return cached;
    }

    try {
      await this.rateLimit();

      // ⚠️ RETRY: Usar retry com backoff exponencial
      const response = await retryHttp(
        () => this.axiosInstance.get(`/movie/${movieId}`, {
          params: {
            api_key: apiKey,
            language: 'pt-BR',
            append_to_response: 'credits,videos',
          },
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            logger.debug(`[TMDBService] Retentando busca de detalhes do filme ${movieId} (tentativa ${attempt}/3)`);
          },
        }
      );

      const movieData = response.data;
      
      // ⚠️ CACHE: Salvar no cache após buscar
      if (movieData) {
        await this.cacheMovie(movieId, movieData);
        await this.recordSuccess(apiKey);
      }

      return movieData;
    } catch (error: any) {
      logger.error(`[TMDBService] Erro ao buscar detalhes do filme ${movieId}:`, error.message);
      const apiKey = await this.getApiKey();
      if (apiKey) await this.recordError(apiKey, error.message);
      return null;
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Busca série com busca paralela em múltiplas linguagens
   */
  async searchTV(title: string, year?: number): Promise<TMDBSeriesSearchResult | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    try {
      await this.rateLimit();

      // 🚀 OTIMIZAÇÃO: Buscar em múltiplas linguagens em PARALELO
      const languages = ['pt-BR', 'en-US'];
      let allResults: any[] = [];

      await Promise.all(languages.map(async (language) => {
        try {
          // Buscar com ano e sem ano em paralelo
          const [resultWithYear, resultWithoutYear] = await Promise.all([
            year ? this.searchTVInLanguage(title, year, language, apiKey) : Promise.resolve(null),
            this.searchTVInLanguage(title, null, language, apiKey)
          ]);
          
          if (resultWithYear) allResults = [...allResults, ...resultWithYear];
          if (resultWithoutYear) allResults = [...allResults, ...resultWithoutYear];
        } catch (error: any) {
          logger.debug(`[TMDBService] Erro ao buscar série em ${language}:`, error.message);
        }
      }));

      if (allResults.length === 0) {
        return null;
      }

      // 🚀 OTIMIZAÇÃO: Encontrar melhor correspondência usando similaridade
      const bestMatch = this.findBestMatchTV(title, allResults);
      
      if (bestMatch) {
        await this.recordSuccess(apiKey);
        return bestMatch;
      }

      return null;
    } catch (error: any) {
      logger.error('[TMDBService] Erro ao buscar série:', error.message);
      const apiKey = await this.getApiKey();
      if (apiKey) await this.recordError(apiKey, error.message);
      return null;
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Busca série em uma linguagem específica
   */
  private async searchTVInLanguage(title: string, year: number | null, language: string, apiKey: string): Promise<TMDBSeriesSearchResult[]> {
    try {
      const response = await retryHttp(
        () => this.axiosInstance.get('/search/tv', {
          params: {
            api_key: apiKey,
            query: title,
            first_air_date_year: year || undefined,
            language: language,
          },
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            logger.debug(`[TMDBService] Retentando busca de série "${title}" em ${language} (tentativa ${attempt}/3)`);
          },
        }
      );

      return response.data.results || [];
    } catch (error: any) {
      logger.debug(`[TMDBService] Erro ao buscar série em ${language}:`, error.message);
      return [];
    }
  }

  /**
   * 🚀 OTIMIZAÇÃO: Encontra melhor correspondência de série usando similaridade
   */
  private findBestMatchTV(title: string, results: any[]): TMDBSeriesSearchResult | null {
    if (results.length === 0) return null;
    
    const similarities = results.map(result => ({
      result,
      similarity: Math.max(
        stringSimilarity.compareTwoStrings(title.toLowerCase(), result.name?.toLowerCase() || ''),
        stringSimilarity.compareTwoStrings(title.toLowerCase(), result.original_name?.toLowerCase() || '')
      )
    }));
    
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities[0]?.similarity > 0.3 ? similarities[0].result : null;
  }

  async getTVDetails(seriesId: number): Promise<TMDBSeriesDetails | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    // ⚠️ CACHE: Verificar cache primeiro
    const cached = await this.getCachedSeries(seriesId);
    if (cached) {
      return cached;
    }

    try {
      await this.rateLimit();

      // ⚠️ RETRY: Usar retry com backoff exponencial
      const response = await retryHttp(
        () => this.axiosInstance.get(`/tv/${seriesId}`, {
          params: {
            api_key: apiKey,
            language: 'pt-BR',
            append_to_response: 'credits',
          },
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            logger.debug(`[TMDBService] Retentando busca de detalhes da série ${seriesId} (tentativa ${attempt}/3)`);
          },
        }
      );

      const seriesData = response.data;
      
      // ⚠️ CACHE: Salvar no cache após buscar
      if (seriesData) {
        await this.cacheSeries(seriesId, seriesData);
        await this.recordSuccess(apiKey);
      }

      return seriesData;
    } catch (error: any) {
      logger.error(`[TMDBService] Erro ao buscar detalhes da série ${seriesId}:`, error.message);
      const apiKey = await this.getApiKey();
      if (apiKey) await this.recordError(apiKey, error.message);
      return null;
    }
  }

  /**
   * Busca dados de um episódio específico no TMDB
   * @param seriesId ID da série no TMDB
   * @param seasonNumber Número da temporada
   * @param episodeNumber Número do episódio
   * @returns Dados do episódio ou null se não encontrado
   */
  async getEpisodeDetails(seriesId: number, seasonNumber: number, episodeNumber: number): Promise<TMDBSeriesEpisode | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    // ⚠️ CACHE: Verificar cache primeiro
    const cached = await this.getCachedEpisode(seriesId, seasonNumber, episodeNumber);
    if (cached) {
      return cached;
    }

    try {
      await this.rateLimit();

      // ⚠️ RETRY: Usar retry com backoff exponencial
      const response = await retryHttp(
        () => this.axiosInstance.get(`/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}`, {
          params: {
            api_key: apiKey,
            language: 'pt-BR',
          },
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (attempt, error) => {
            logger.debug(`[TMDBService] Retentando busca de episódio ${seriesId}/S${seasonNumber}E${episodeNumber} (tentativa ${attempt}/3)`);
          },
        }
      );

      const episodeData = response.data;
      
      // ⚠️ CACHE: Salvar no cache após buscar
      if (episodeData) {
        await this.cacheEpisode(seriesId, seasonNumber, episodeNumber, episodeData);
        await this.recordSuccess(apiKey);
      }

      return episodeData;
    } catch (error: any) {
      // Não logar erro para episódios não encontrados (é comum)
      if (error.response?.status !== 404) {
        logger.debug(`[TMDBService] Episódio S${seasonNumber}E${episodeNumber} não encontrado para série ${seriesId}`);
        const apiKey = await this.getApiKey();
        if (apiKey) await this.recordError(apiKey, error.message);
      }
      return null;
    }
  }

  convertMovieToXUIProperties(movie: TMDBMovieDetails | TMDBMovieSearchResult, originalTitle: string): any {
    const genres = movie.genres?.map(g => g.name).join(', ') || '';
    const countries = movie.production_countries?.map(c => c.name).join(', ') || '';
    const runtime = movie.runtime || 0;

    // Buscar diretor nos créditos (se disponível)
    let director = '';
    if ('credits' in movie && movie.credits) {
      const directorCrew = movie.credits.crew?.find(c => c.job === 'Director');
      director = directorCrew?.name || '';
    }

    // Buscar elenco
    let cast = '';
    if ('credits' in movie && movie.credits) {
      cast = movie.credits.cast?.slice(0, 10).map(c => c.name).join(', ') || '';
    }

    // Buscar trailer
    let trailerUrl = '';
    if ('videos' in movie && movie.videos) {
      const trailer = movie.videos.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer');
      trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '';
    }

    const posterUrl = movie.poster_path 
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` 
      : '';
    const backdropUrl = movie.backdrop_path 
      ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` 
      : '';

    const year = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : null;

    return {
      tmdb_id: movie.id.toString(),
      name: originalTitle,
      o_name: 'original_title' in movie ? movie.original_title : originalTitle,
      cover_big: backdropUrl || posterUrl,
      movie_image: posterUrl,
      release_date: movie.release_date || '',
      releasedate: movie.release_date || '',
      youtube_trailer: trailerUrl,
      director,
      actors: cast,
      cast,
      description: movie.overview || '',
      plot: movie.overview || '',
      genre: genres,
      country: countries,
      duration_secs: runtime * 60,
      duration: this.formatDuration(runtime),
      rating: movie.vote_average.toString(),
      year,
      age: '',
      mpaa_rating: '',
      rating_count_kinopoisk: 0,
      video: [],
      audio: [],
      bitrate: 0,
      kinopoisk_url: `https://www.themoviedb.org/movie/${movie.id}`,
    };
  }

  convertTVToXUIProperties(series: TMDBSeriesDetails | TMDBSeriesSearchResult, originalTitle: string): any {
    const genres = series.genres?.map(g => g.name).join(', ') || '';
    const countries = series.production_countries?.map(c => c.name).join(', ') || '';

    // Buscar criadores/diretores
    let director = '';
    if ('created_by' in series && series.created_by) {
      director = series.created_by.map(c => c.name).join(', ');
    }

    // Buscar elenco
    let cast = '';
    if ('credits' in series && series.credits) {
      cast = series.credits.cast?.slice(0, 10).map(c => c.name).join(', ') || '';
    }

    const posterUrl = series.poster_path 
      ? `https://image.tmdb.org/t/p/w500${series.poster_path}` 
      : '';
    const backdropUrl = series.backdrop_path 
      ? `https://image.tmdb.org/t/p/w1280${series.backdrop_path}` 
      : '';

    const year = series.first_air_date ? parseInt(series.first_air_date.substring(0, 4)) : null;
    const episodeRunTime = 'seasons' in series && series.seasons?.[0]?.episode_count ? 45 : 45; // Default 45 min

    return {
      tmdb_id: series.id.toString(),
      name: originalTitle,
      o_name: 'original_name' in series ? series.original_name : originalTitle,
      cover_big: backdropUrl || posterUrl,
      movie_image: posterUrl, // Poster da série
      release_date: series.first_air_date || '',
      releasedate: series.first_air_date || '',
      director,
      actors: cast,
      cast,
      description: series.overview || '',
      plot: series.overview || '',
      genre: genres,
      country: countries,
      duration_secs: episodeRunTime * 60,
      duration: this.formatDuration(episodeRunTime),
      rating: series.vote_average.toString(),
      year,
      episode_run_time: episodeRunTime,
      kinopoisk_url: `https://www.themoviedb.org/tv/${series.id}`,
    };
  }

  private formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`;
  }
}
