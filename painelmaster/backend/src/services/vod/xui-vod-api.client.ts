/**
 * Cliente API XUI.ONE para operações VOD (Filmes e Séries)
 * - Consultas diretas MySQL para listagem/estatísticas (rápido)
 * - Operações via API HTTP (create, update, delete)
 */

import * as mysql from 'mysql2/promise';
type Connection = mysql.Connection;
type RowDataPacket = mysql.RowDataPacket;
import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../../utils/logger.js';
import { decryptApiKey } from '../../controllers/xuiSettings.controller.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('XUIVodApiClient');

export interface XUIMovie {
  id: number;
  stream_display_name: string;
  stream_source: string; // JSON array
  stream_icon: string | null;
  category_id: string; // JSON array
  type: number; // 2 = movie
  added: number; // Unix timestamp
  hasMetadata?: boolean; // Flag para indicar se tem metadados TMDB
  movie_properties?: string; // JSON string com propriedades do filme
}

export interface XUISeries {
  id: number;
  title: string;
  category_id: string; // JSON array
  cover: string | null;
  type: number; // 3 = series
  added: number;
}

export interface VODStats {
  total: number;
  movies: number;
  series: number;
  channels: number;
  withMetadata: number;
  withoutMetadata: number;
  moviesWithMetadata: number;
  moviesWithoutMetadata: number;
  seriesWithMetadata: number;
  seriesWithoutMetadata: number;
}

export class XUIVodApiClient {
  private server: XuiServer;
  private apiClient: AxiosInstance;
  private dbConnection: Connection | null = null;

  constructor(server: XuiServer) {
    this.server = server;

    // Preparar cliente HTTP API
    const accessCode = server.accessCode;
    const apiKey = decryptApiKey(server.apiKey);
    const baseUrl = server.baseUrl.replace(/\/$/, '');
    const fullBaseUrl = `${baseUrl}/${accessCode}`;

    this.apiClient = axios.create({
      baseURL: fullBaseUrl,
      timeout: 30000,
      params: {
        api_key: apiKey,
      },
    });

    logger.info('[XUIVodApiClient] Inicializado', { baseUrl: fullBaseUrl });
  }

  /**
   * Conecta ao MySQL do XUI (para consultas rápidas)
   */
  private async getDbConnection(): Promise<Connection> {
    if (this.dbConnection) {
      return this.dbConnection;
    }

    const { decrypt } = await import('../../utils/crypto.js');
    const dbPass = this.server.dbPassword ? decrypt(this.server.dbPassword) : 'senha_segura';
    const dbName = this.server.dbName || 'xui';

    if (!this.server.dbHost || !this.server.dbUser) {
      throw new Error('Credenciais MySQL não configuradas. Configure dbHost e dbUser no servidor XUI.');
    }

    this.dbConnection = await mysql.createConnection({
      host: this.server.dbHost,
      port: this.server.dbPort || 3306,
      user: this.server.dbUser,
      password: dbPass,
      database: dbName,
      connectTimeout: 10000,
    });

    logger.info('[XUIVodApiClient] Conectado ao MySQL', { host: this.server.dbHost });
    return this.dbConnection;
  }

  /**
   * Desconecta do MySQL
   */
  async disconnect(): Promise<void> {
    if (this.dbConnection) {
      await this.dbConnection.end();
      this.dbConnection = null;
      logger.info('[XUIVodApiClient] Desconectado do MySQL');
    }
  }

  /**
   * Detecta se o banco é Xtream UI (sem movie_properties na streams) ou XUI ONE
   */
  private async isXtreamUI(conn: Connection): Promise<boolean> {
    try {
      const [cols] = await conn.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM streams LIKE 'movie_properties'"
      );
      return cols.length === 0; // Se não tem movie_properties na streams, é Xtream UI
    } catch {
      return true; // Na dúvida, assume Xtream UI (mais seguro)
    }
  }

  /**
   * Detecta o nome da tabela de categorias (varia entre XUI ONE e Xtream UI)
   */
  private async getCategoryTableName(conn: Connection): Promise<string> {
    const candidates = ['streams_categories', 'stream_categories'];
    for (const name of candidates) {
      try {
        const [exists] = await conn.query<RowDataPacket[]>(`SHOW TABLES LIKE '${name}'`);
        if (exists.length > 0) return name;
      } catch { /* ignorar */ }
    }
    return 'streams_categories'; // fallback padrão
  }

  /**
   * Extrai category_id como array de números, independente se é INT ou JSON
   */
  private parseCategoryId(raw: any): number[] {
    if (!raw && raw !== 0) return [];
    if (typeof raw === 'number') return [raw];
    if (typeof raw === 'string') {
      // Tentar JSON parse
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((v: any) => Number(v)).filter((v: number) => !isNaN(v));
        if (typeof parsed === 'number') return [parsed];
      } catch {
        // Pode ser string simples de número
        const num = parseInt(raw, 10);
        if (!isNaN(num)) return [num];
      }
    }
    if (Array.isArray(raw)) return raw.map((v: any) => Number(v)).filter((v: number) => !isNaN(v));
    return [];
  }

  /**
   * GET /api/vod/stats
   * Consulta direta MySQL para estatísticas (compatível XUI ONE e Xtream UI)
   */
  async getStats(): Promise<VODStats> {
    const conn = await this.getDbConnection();
    const xtreamUI = await this.isXtreamUI(conn);

    // Estatísticas de streams (VOD e Live)
    const [streamRows] = await conn.query<RowDataPacket[]>(
      `SELECT 
        COUNT(CASE WHEN type = 1 THEN 1 END) as channels,
        COUNT(CASE WHEN type = 2 THEN 1 END) as movies
       FROM streams`
    );

    const channels = streamRows[0]?.channels || 0;
    const movies = streamRows[0]?.movies || 0;
    let series = 0;

    // Contar séries: Xtream UI usa tabela 'series', XUI ONE usa 'streams_series' ou streams type=3
    const seriesToCheck = ['series', 'streams_series'];
    for (const tableName of seriesToCheck) {
      try {
        const [exists] = await conn.query<RowDataPacket[]>(`SHOW TABLES LIKE '${tableName}'`);
        if (exists.length > 0) {
          const [count] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as total FROM ${tableName}`);
          series = count[0]?.total || 0;
          if (series > 0) break; // Usa a primeira tabela que tem dados
        }
      } catch { /* tabela não existe */ }
    }

    // Fallback: contar streams type=3 (XUI ONE)
    if (series === 0) {
      try {
        const [s3] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as total FROM streams WHERE type = 3`);
        series = s3[0]?.total || 0;
      } catch { /* ignorar */ }
    }

    // Contar metadados: depende da estrutura
    let moviesWithMetadata = 0;
    let seriesWithMetadata = 0;

    if (xtreamUI) {
      // Xtream UI: metadados na tabela separada movie_properties
      try {
        const [mpExists] = await conn.query<RowDataPacket[]>("SHOW TABLES LIKE 'movie_properties'");
        if (mpExists.length > 0) {
          const [mpCount] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(DISTINCT mp.stream_id) as total 
             FROM movie_properties mp 
             INNER JOIN streams s ON s.id = mp.stream_id 
             WHERE s.type = 2 AND mp.tmdb_id IS NOT NULL AND mp.tmdb_id > 0`
          );
          moviesWithMetadata = mpCount[0]?.total || 0;
        }
      } catch { /* ignorar */ }

      // Séries com metadados: series com tmdb_id preenchido
      try {
        const [smpCount] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) as total FROM series WHERE tmdb_id IS NOT NULL AND tmdb_id > 0`
        );
        seriesWithMetadata = smpCount[0]?.total || 0;
      } catch { /* ignorar */ }
    } else {
      // XUI ONE: metadados na coluna movie_properties da streams
      try {
        const [metaRows] = await conn.query<RowDataPacket[]>(
          `SELECT 
            COUNT(CASE WHEN type = 2 AND movie_properties IS NOT NULL AND movie_properties != '' AND movie_properties != '[]' THEN 1 END) as movies_meta,
            COUNT(CASE WHEN type = 3 AND movie_properties IS NOT NULL AND movie_properties != '' AND movie_properties != '[]' THEN 1 END) as series_meta
           FROM streams WHERE type IN (2, 3)`
        );
        moviesWithMetadata = metaRows[0]?.movies_meta || 0;
        seriesWithMetadata = metaRows[0]?.series_meta || 0;
      } catch { /* ignorar */ }
    }

    const total = movies + series;
    const totalWithMetadata = moviesWithMetadata + seriesWithMetadata;

    return {
      total,
      movies,
      series,
      channels,
      withMetadata: totalWithMetadata,
      withoutMetadata: total - totalWithMetadata,
      moviesWithMetadata,
      moviesWithoutMetadata: movies - moviesWithMetadata,
      seriesWithMetadata,
      seriesWithoutMetadata: series - seriesWithMetadata,
    };
  }

  /**
   * DEBUG: Verificar estrutura das tabelas de séries
   */
  async debugSeriesTables(): Promise<any> {
    const conn = await this.getDbConnection();
    const debug: any = {
      streams_by_type: {},
      tables_found: [],
      series_tables: {},
    };

    try {
      // 1. Contar streams por tipo
      const [byType] = await conn.query<RowDataPacket[]>(
        `SELECT type, COUNT(*) as total FROM streams GROUP BY type`
      );
      byType.forEach((row) => {
        debug.streams_by_type[row.type] = row.total;
      });

      // 2. Verificar tabelas que podem conter séries
      const tablesToCheck = ['series', 'streams_series', 'series_episodes'];
      
      for (const tableName of tablesToCheck) {
        const [exists] = await conn.query<RowDataPacket[]>(
          `SHOW TABLES LIKE '${tableName}'`
        );
        
        if (exists.length > 0) {
          debug.tables_found.push(tableName);
          
          // Contar registros
          const [count] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(*) as total FROM ${tableName}`
          );
          
          // Ver estrutura
          const [structure] = await conn.query<RowDataPacket[]>(
            `DESCRIBE ${tableName}`
          );
          
          // Pegar primeiros 3 registros
          const [sample] = await conn.query<RowDataPacket[]>(
            `SELECT * FROM ${tableName} LIMIT 3`
          );
          
          debug.series_tables[tableName] = {
            total: count[0].total,
            structure: structure.map((s: any) => ({ field: s.Field, type: s.Type })),
            sample: sample.map((row: any) => {
              const obj: any = {};
              for (const key in row) {
                if (key === 'movie_properties' || key === 'cover_big' || key === 'backdrop_path') {
                  obj[key] = row[key] ? `[${row[key].substring(0, 50)}...]` : null;
                } else {
                  obj[key] = row[key];
                }
              }
              return obj;
            }),
          };
        }
      }

      // 3. Ver exemplos de streams type=3 (se existirem)
      const [seriesStreams] = await conn.query<RowDataPacket[]>(
        `SELECT id, stream_display_name, type, added FROM streams WHERE type = 3 LIMIT 3`
      );
      debug.series_streams_sample = seriesStreams;

    } catch (error: any) {
      debug.error = error.message;
    }

    return debug;
  }

  /**
   * GET /api/vod/movies
   * Consulta direta MySQL com paginação (compatível XUI ONE e Xtream UI)
   */
  async getMovies(params: {
    page?: number;
    perPage?: number;
    search?: string;
  }): Promise<{ items: XUIMovie[]; total: number }> {
    const conn = await this.getDbConnection();
    const xtreamUI = await this.isXtreamUI(conn);
    const page = params.page || 1;
    const perPage = params.perPage || 20;
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE s.type = 2';
    const queryParams: any[] = [];

    if (params.search) {
      whereClause += ' AND s.stream_display_name LIKE ?';
      queryParams.push(`%${params.search}%`);
    }

    // Contar total
    const [countRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM streams s ${whereClause}`,
      queryParams
    );
    const total = countRows[0]?.total || 0;

    // Buscar itens - adaptar SELECT conforme schema
    let selectFields: string;
    let joinClause = '';
    let hasMpTable = false;

    if (xtreamUI) {
      // Xtream UI: verificar se tabela movie_properties existe
      try {
        const [mpExists] = await conn.query<RowDataPacket[]>("SHOW TABLES LIKE 'movie_properties'");
        hasMpTable = mpExists.length > 0;
      } catch { /* ignorar */ }

      if (hasMpTable) {
        selectFields = `s.id, s.stream_display_name, s.stream_source, s.stream_icon, s.category_id, s.type, s.added, 
                        mp.tmdb_id as mp_tmdb_id`;
        joinClause = `LEFT JOIN movie_properties mp ON mp.stream_id = s.id`;
      } else {
        selectFields = `s.id, s.stream_display_name, s.stream_source, s.stream_icon, s.category_id, s.type, s.added`;
        joinClause = '';
      }
    } else {
      // XUI ONE: movie_properties é coluna na streams
      selectFields = `s.id, s.stream_display_name, s.stream_source, s.stream_icon, s.category_id, s.type, s.added, 
                      s.movie_properties`;
      joinClause = '';
    }

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${selectFields}
       FROM streams s
       ${joinClause}
       ${whereClause}
       ORDER BY s.added DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, perPage, offset]
    );

    // Buscar nomes das categorias em lote
    const categoryIds = new Set<number>();
    rows.forEach(row => {
      this.parseCategoryId(row.category_id).forEach(id => categoryIds.add(id));
    });

    const catTable = await this.getCategoryTableName(conn);
    const categoryMap = new Map<number, string>();
    if (categoryIds.size > 0) {
      const [catRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, category_name FROM ${catTable} WHERE id IN (${Array.from(categoryIds).join(',')})`
      );
      catRows.forEach((cat: any) => categoryMap.set(cat.id, cat.category_name));
    }

    return {
      items: rows.map(row => {
        let hasMetadata = false;
        if (xtreamUI) {
          hasMetadata = !!(row.mp_tmdb_id && row.mp_tmdb_id > 0);
        } else {
          try {
            const props = typeof row.movie_properties === 'string' ? JSON.parse(row.movie_properties) : row.movie_properties;
            hasMetadata = !!(props && props.tmdb_id);
          } catch { /* ignorar */ }
        }

        const catIds = this.parseCategoryId(row.category_id);
        const categoryName = catIds.length > 0 ? (categoryMap.get(catIds[0]) || null) : null;

        return {
          id: row.id,
          stream_display_name: row.stream_display_name,
          title: row.stream_display_name,
          stream_source: row.stream_source,
          stream_icon: row.stream_icon,
          category_id: row.category_id,
          categoryName,
          type: row.type,
          added: row.added,
          hasMetadata,
          movie_properties: row.movie_properties || null,
        };
      }),
      total,
    };
  }

  /**
   * GET /api/vod/series
   * Consulta direta MySQL com paginação (compatível XUI ONE e Xtream UI)
   */
  async getSeries(params: {
    page?: number;
    perPage?: number;
    search?: string;
  }): Promise<{ items: XUISeries[]; total: number }> {
    const conn = await this.getDbConnection();
    const page = params.page || 1;
    const perPage = params.perPage || 20;
    const offset = (page - 1) * perPage;

    // Tentar cada fonte de séries em ordem de prioridade
    const seriesSources = ['series', 'streams_series'];

    for (const tableName of seriesSources) {
      try {
        const [tableExists] = await conn.query<RowDataPacket[]>(`SHOW TABLES LIKE '${tableName}'`);
        if (tableExists.length === 0) continue;

        let seriesWhere = 'WHERE 1=1';
        const seriesParams: any[] = [];

        if (params.search) {
          seriesWhere += ' AND title LIKE ?';
          seriesParams.push(`%${params.search}%`);
        }

        const [seriesCount] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) as total FROM ${tableName} ${seriesWhere}`, seriesParams
        );
        const total = seriesCount[0]?.total || 0;

        if (total === 0) continue;

        // Detectar campo de ordenação
        let orderField = 'id';
        try {
          const [hasLastMod] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${tableName} LIKE 'last_modified'`);
          if (hasLastMod.length > 0) orderField = 'COALESCE(last_modified, id)';
        } catch { /* ignorar */ }

        const [seriesRows] = await conn.query<RowDataPacket[]>(
          `SELECT id, title, category_id, cover, ${orderField} as added 
           FROM ${tableName} 
           ${seriesWhere}
           ORDER BY ${orderField} DESC
           LIMIT ? OFFSET ?`,
          [...seriesParams, perPage, offset]
        );

        // Buscar categorias
        const categoryIds = new Set<number>();
        seriesRows.forEach(row => {
          this.parseCategoryId(row.category_id).forEach(id => categoryIds.add(id));
        });

        const catTable = await this.getCategoryTableName(conn);
        const categoryMap = new Map<number, string>();
        if (categoryIds.size > 0) {
          const [catRows] = await conn.query<RowDataPacket[]>(
            `SELECT id, category_name FROM ${catTable} WHERE id IN (${Array.from(categoryIds).join(',')})`
          );
          catRows.forEach((cat: any) => categoryMap.set(cat.id, cat.category_name));
        }

        logger.info(`[XUIVodApiClient] Encontradas ${total} séries na tabela ${tableName}`);

        return {
          items: seriesRows.map(row => {
            const catIds = this.parseCategoryId(row.category_id);
            const categoryName = catIds.length > 0 ? (categoryMap.get(catIds[0]) || null) : null;
            return {
              id: row.id,
              title: row.title,
              category_id: row.category_id,
              categoryName,
              cover: row.cover,
              type: 3,
              added: row.added,
            };
          }),
          total,
        };
      } catch (error: any) {
        logger.debug(`[XUIVodApiClient] Erro ao verificar ${tableName}:`, error.message);
      }
    }

    // FALLBACK: streams type=3 (XUI ONE legacy)
    let whereClause = 'WHERE type = 3 AND (series_no IS NULL OR series_no = 0)';
    const queryParams: any[] = [];
    if (params.search) {
      whereClause += ' AND stream_display_name LIKE ?';
      queryParams.push(`%${params.search}%`);
    }

    const [countRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM streams ${whereClause}`, queryParams
    );
    const total = countRows[0]?.total || 0;

    let rows: any[] = [];
    if (total > 0) {
      [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, stream_display_name as title, category_id, stream_icon as cover, type, added
         FROM streams ${whereClause} ORDER BY added DESC LIMIT ? OFFSET ?`,
        [...queryParams, perPage, offset]
      );
    }

    const categoryIds = new Set<number>();
    rows.forEach(row => { this.parseCategoryId(row.category_id).forEach(id => categoryIds.add(id)); });

    const catTable = await this.getCategoryTableName(conn);
    const categoryMap = new Map<number, string>();
    if (categoryIds.size > 0) {
      const [catRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, category_name FROM ${catTable} WHERE id IN (${Array.from(categoryIds).join(',')})`
      );
      catRows.forEach((cat: any) => categoryMap.set(cat.id, cat.category_name));
    }

    return {
      items: rows.map(row => {
        const catIds = this.parseCategoryId(row.category_id);
        const categoryName = catIds.length > 0 ? (categoryMap.get(catIds[0]) || null) : null;
        return { id: row.id, title: row.title, category_id: row.category_id, categoryName, cover: row.cover, type: row.type, added: row.added };
      }),
      total,
    };
  }

  /**
   * POST /api/vod/movies (via API XUI)
   * Criar filme no XUI
   */
  async createMovie(movieData: {
    stream_display_name: string;
    stream_source: string[]; // Array de URLs
    stream_icon?: string;
    category_id: number[];
  }): Promise<{ result: boolean; movie_id: number }> {
    try {
      const { data } = await this.apiClient.get('', {
        params: {
          action: 'create_movie',
          stream_display_name: movieData.stream_display_name,
          stream_source: JSON.stringify(movieData.stream_source),
          category_id: JSON.stringify(movieData.category_id),
          ...(movieData.stream_icon && { stream_icon: movieData.stream_icon }),
        },
      });

      if (data.result === false) {
        throw new Error(data.message || 'Erro ao criar filme');
      }

      return {
        result: data.result,
        movie_id: data.movie_id,
      };
    } catch (error: any) {
      logger.error('[XUIVodApiClient] Erro ao criar filme:', error.message);
      throw new Error(`Erro ao criar filme: ${error.message}`);
    }
  }

  /**
   * POST /api/vod/movies/:id (via API XUI)
   * Atualizar filme no XUI
   */
  async updateMovie(id: number, movieData: Partial<{
    stream_display_name: string;
    stream_source: string[];
    stream_icon: string;
    category_id: number[];
    movie_properties?: string; // JSON string com movie_properties
  }>): Promise<{ result: boolean }> {
    try {
      const params: Record<string, any> = {
        action: 'edit_movie',
        id: String(id),
      };

      if (movieData.stream_display_name) params.stream_display_name = movieData.stream_display_name;
      if (movieData.stream_source) params.stream_source = JSON.stringify(movieData.stream_source);
      if (movieData.stream_icon) params.stream_icon = movieData.stream_icon;
      if (movieData.category_id) params.category_id = JSON.stringify(movieData.category_id);
      if (movieData.movie_properties) params.movie_properties = movieData.movie_properties; // Passar movie_properties explicitamente

      const { data } = await this.apiClient.get('', { params });

      if (data.result === false) {
        throw new Error(data.message || 'Erro ao atualizar filme');
      }

      return { result: data.result };
    } catch (error: any) {
      logger.error('[XUIVodApiClient] Erro ao atualizar filme:', error.message);
      throw new Error(`Erro ao atualizar filme: ${error.message}`);
    }
  }

  /**
   * Ativar filme no XUI (apenas salva sem modificar dados)
   * Isso é necessário para que o filme apareça no aplicativo IPTV
   */
  async activateMovie(id: number): Promise<{ result: boolean }> {
    try {
      // Chamar edit_movie apenas com o ID - o XUI vai "salvar" o filme
      // sem modificar os dados que já estão no banco
      const { data } = await this.apiClient.get('', {
        params: {
          action: 'edit_movie',
          id: String(id),
        },
      });

      if (data.result === false) {
        throw new Error(data.message || 'Erro ao ativar filme');
      }

      return { result: data.result };
    } catch (error: any) {
      logger.warn('[XUIVodApiClient] Erro ao ativar filme (não crítico):', error.message);
      return { result: false };
    }
  }

  /**
   * POST /api/vod/movies/:id/delete (via API XUI)
   * Deletar filme no XUI
   */
  async deleteMovie(id: number): Promise<{ result: boolean }> {
    try {
      const { data } = await this.apiClient.get('', {
        params: {
          action: 'delete_movie',
          id: String(id),
        },
      });

      if (data.result === false) {
        throw new Error(data.message || 'Erro ao deletar filme');
      }

      return { result: data.result };
    } catch (error: any) {
      logger.error('[XUIVodApiClient] Erro ao deletar filme:', error.message);
      throw new Error(`Erro ao deletar filme: ${error.message}`);
    }
  }

  /**
   * GET /api/vod/movies/:id (via MySQL)
   * Buscar filme específico (compatível XUI ONE e Xtream UI)
   */
  async getMovie(id: number): Promise<XUIMovie | null> {
    const conn = await this.getDbConnection();
    const xtreamUI = await this.isXtreamUI(conn);

    let query: string;
    if (xtreamUI) {
      // Verificar se tabela movie_properties existe
      let hasMpTable = false;
      try {
        const [mpExists] = await conn.query<RowDataPacket[]>("SHOW TABLES LIKE 'movie_properties'");
        hasMpTable = mpExists.length > 0;
      } catch { /* ignorar */ }

      if (hasMpTable) {
        query = `SELECT s.id, s.stream_display_name, s.stream_source, s.stream_icon, s.category_id, s.type, s.added,
                        mp.tmdb_id as mp_tmdb_id
                 FROM streams s
                 LEFT JOIN movie_properties mp ON mp.stream_id = s.id
                 WHERE s.id = ? AND s.type = 2`;
      } else {
        query = `SELECT id, stream_display_name, stream_source, stream_icon, category_id, type, added
                 FROM streams WHERE id = ? AND type = 2`;
      }
    } else {
      query = `SELECT id, stream_display_name, stream_source, stream_icon, category_id, type, added, movie_properties
               FROM streams WHERE id = ? AND type = 2`;
    }

    const [rows] = await conn.query<RowDataPacket[]>(query, [id]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      stream_display_name: row.stream_display_name,
      stream_source: row.stream_source,
      stream_icon: row.stream_icon,
      category_id: row.category_id,
      type: row.type,
      added: row.added,
      movie_properties: row.movie_properties || null,
    };
  }

  /**
   * GET /api/vod/categories
   * Busca categorias VOD do XUI
   */
  async getCategories(type?: string): Promise<Array<{ id: number; category_name: string; category_type: string }>> {
    const conn = await this.getDbConnection();
    const catTable = await this.getCategoryTableName(conn);

    try {
      let query = '';
      let params: any[] = [];

      if (type && (type === 'vod' || type === 'series')) {
        const xuiType = type === 'vod' ? 'movie' : 'series';
        query = `SELECT id, category_name, category_type 
                 FROM ${catTable} 
                 WHERE category_type = ?
                 ORDER BY category_name ASC`;
        params = [xuiType];
      } else {
        // Query simples que funciona em ambos XUI ONE e Xtream UI
        query = `SELECT id, category_name, COALESCE(category_type, 'vod') as category_type
                 FROM ${catTable}
                 ORDER BY category_name ASC
                 LIMIT 1000`;
      }

      const [rows] = await conn.query<any[]>(query, params);

      const categories = rows.map((row: any) => ({
        id: row.id,
        category_name: row.category_name,
        category_type: row.category_type || 'vod',
      }));

      logger.info(`[XUIVodApiClient] Encontradas ${categories.length} categorias na tabela ${catTable}`);
      return categories;
    } catch (error: any) {
      logger.error('[XUIVodApiClient] Erro ao buscar categorias:', error.message);
      return [];
    }
  }

  /**
   * Cria uma nova categoria VOD no XUI/Xtream UI
   */
  async createCategory(categoryName: string, categoryType: 'vod' | 'series' = 'vod', isAdult: boolean = false): Promise<number> {
    try {
      const conn = await this.getDbConnection();
      const catTable = await this.getCategoryTableName(conn);
      const xuiCategoryType = categoryType === 'vod' ? 'movie' : 'series';
      
      const [existing] = await conn.query<any[]>(
        `SELECT id FROM ${catTable} WHERE category_name = ? AND category_type = ? LIMIT 1`,
        [categoryName, xuiCategoryType]
      );

      if (existing.length > 0) {
        logger.info('[XUIVodApiClient] Categoria já existe:', { categoryName, categoryType: xuiCategoryType, categoryId: existing[0].id });
        return existing[0].id;
      }

      const [result] = await conn.query<any>(
        `INSERT INTO ${catTable} (category_name, category_type, parent_id, cat_order, is_adult) 
         VALUES (?, ?, 0, 0, ?)`,
        [categoryName, xuiCategoryType, isAdult ? 1 : 0]
      );

      const categoryId = (result as any).insertId;

      if (!categoryId) {
        throw new Error(`Erro ao criar categoria: insertId não retornado`);
      }

      logger.info('[XUIVodApiClient] Categoria criada diretamente no MySQL:', { categoryName, categoryType: xuiCategoryType, categoryId, isAdult });
      return categoryId;
    } catch (error: any) {
      logger.error('[XUIVodApiClient] Erro ao criar categoria:', error.message);
      throw new Error(`Erro ao criar categoria: ${error.message}`);
    }
  }

  /**
   * Busca ou cria categoria (retorna ID)
   */
  async getOrCreateCategory(categoryName: string, categoryType: 'vod' | 'series' = 'vod'): Promise<number> {
    // Primeiro, tenta buscar categoria existente
    // CORREÇÃO: XUI usa 'movie' para filmes e 'series' para séries (confirmado no banco de produção)
    const xuiType = categoryType === 'vod' ? 'movie' : 'series';
    const categories = await this.getCategories(categoryType);
    const existing = categories.find(
      (cat) => cat.category_name.toLowerCase() === categoryName.toLowerCase() && 
               (cat.category_type === xuiType || cat.category_type === categoryType)
    );

    if (existing) {
      return existing.id;
    }

    // Se não existir, cria nova
    return await this.createCategory(categoryName, categoryType);
  }
}

