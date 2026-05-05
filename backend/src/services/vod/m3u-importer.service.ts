/**
 * Serviço de Importação M3U para VOD
 * Importa conteúdo de fontes M3U para o XUI
 * - Decide automaticamente: MySQL direto (>100 itens) ou API HTTP (<100 itens)
 * - Suporta enriquecimento TMDB opcional
 */

import axios from 'axios';
import { createLogger } from '../../utils/logger.js';
import { retryHttp } from '../../utils/retry.util.js';
import type { XuiServer } from '@prisma/client';
import { XUIVodDBClient, MovieData, SeriesData, SeriesInfo, EpisodeData } from './xui-vod-db.client.js';
import { XUIVodApiClient } from './xui-vod-api.client.js';
import { TMDBService } from './tmdb.service.js';
import { detectSeriesEpisode } from './series-episode-parser.js';
import { socketService } from '../socket.service.js';
import { prisma } from '../../config/database.js';

const logger = createLogger('M3UImporterService');

export interface M3UItem {
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  type: 'live' | 'movie' | 'series';
}

export interface CategoryMapping {
  m3uCategory: string;
  xuiCategoryId?: number;
  xuiCategoryName?: string;
  action: 'map' | 'create' | 'ignore';
  newCategoryName?: string;
  importCategory: boolean;
}

export interface ImportOptions {
  clearBeforeImport?: boolean; // Limpar tudo antes de importar
  enrichWithTMDB?: boolean; // Enriquecer com TMDB
  categoryId?: number; // ID da categoria no XUI (deprecated - usar categoryMappings)
  vodType?: 'movie' | 'series' | 'both'; // Tipo de conteúdo a importar
  maxMovies?: number; // Limite de filmes para importação (teste)
  maxSeries?: number; // Limite de séries para importação (teste)
  disableMarketing?: boolean; // Se true, não executa PostImportHook (banners/vídeos)
  batchSize?: number; // Tamanho do lote para MySQL (padrão: 1000)
  threshold?: number; // Limite para decidir API vs MySQL (padrão: 100)
  categoryMappings?: CategoryMapping[]; // Mapeamento de categorias M3U → XUI
  bouquetId?: number; // ID do bouquet para adicionar filmes/séries (opcional)
  userId?: string; // ID do usuário para atualizações Socket.io (opcional)
  serverId?: number; // ID do servidor de streaming (tabela 'servers') para vincular VODs
  createYearCategory?: boolean; // Criar categorias especiais por ano (ex: "Filmes | Lançamentos 2025")
  selectedYear?: number; // Ano único para categoria especial (deprecated - usar selectedYears)
  selectedYears?: number[]; // Anos múltiplos para categorias especiais (ex: [2024, 2025, 2026])
  updateExistingCategories?: boolean; // Se true, atualiza categorias de filmes duplicados (ao invés de pular completamente)
}

export interface ImportResult {
  total: number;
  movies: number;
  series: number;
  inserted: number;
  errors: number;
  skipped: number; // Duplicados ignorados
  method: 'mysql' | 'api';
  duration: number; // ms
}

export interface M3UCategory {
  name: string;
  count: number;
  // ⚠️ FIX: Removido 'items' para evitar resposta HTTP gigante
  // items: M3UItem[]; // Comentado para otimização
}

export class M3UImporterService {
  private server: XuiServer;
  private dbClient: XUIVodDBClient;
  private apiClient: XUIVodApiClient;
  private tmdbService: TMDBService | null = null;

  private canonicalizeTitle(title: string): string {
    return title
      .replace(/\s*\[.*?\]\s*/g, ' ')
      .replace(/\s*\(\s*(19\d{2}|20\d{2})\s*\)\s*/g, ' ')
      .replace(/\s*\[\s*(19\d{2}|20\d{2})\s*\]\s*/g, ' ')
      .replace(/\s+-\s*(19\d{2}|20\d{2})\s*$/g, '')
      .replace(/\b(19\d{2}|20\d{2})\b\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  constructor(server: XuiServer, tmdbApiKey?: string) {
    this.server = server;
    this.dbClient = new XUIVodDBClient(server);
    this.apiClient = new XUIVodApiClient(server);
    
    // Inicializar TMDB se chave fornecida
    if (tmdbApiKey) {
      try {
        this.tmdbService = new TMDBService(tmdbApiKey);
        logger.info('[M3UImporter] TMDB Service inicializado');
      } catch (error: any) {
        logger.warn('[M3UImporter] Erro ao inicializar TMDB Service:', error.message);
      }
    } else if (process.env.TMDB_API_KEY) {
      try {
        this.tmdbService = new TMDBService();
        logger.info('[M3UImporter] TMDB Service inicializado com chave do .env');
      } catch (error: any) {
        logger.warn('[M3UImporter] Erro ao inicializar TMDB Service:', error.message);
      }
    }
  }

  /**
   * Extrai categorias únicas do M3U
   */
  extractCategories(items: M3UItem[]): M3UCategory[] {
    const categoryMap = new Map<string, number>(); // ⚠️ FIX: Mudado para Map<string, number> (apenas contador)

    for (const item of items) {
      const categoryName = item.group || 'Sem categoria';
      categoryMap.set(categoryName, (categoryMap.get(categoryName) || 0) + 1);
    }

    // ⚠️ FIX: Retornar apenas name e count (sem items) para otimizar resposta HTTP
    return Array.from(categoryMap.entries()).map(([name, count]) => ({
      name,
      count,
      // items removido para evitar resposta HTTP gigante (247k itens)
    }));
  }

  /**
   * Faz parse de um arquivo M3U
   */
  private parseM3U(content: string): M3UItem[] {
    if (!content || typeof content !== 'string') {
      throw new Error('Conteúdo M3U inválido: deve ser uma string');
    }

    const items: M3UItem[] = [];
    const lines = content.split('\n');
    
    let currentItem: Partial<M3UItem> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Linha vazia
      if (!line) continue;

      // #EXTM3U - Header
      if (line.startsWith('#EXTM3U')) continue;

      // #EXTINF - Início de item
      if (line.startsWith('#EXTINF:')) {
        // Formato: #EXTINF:-1 tvg-id="ID" tvg-name="Nome" tvg-logo="Logo" group-title="Grupo",Nome do Stream
        const extinf = line.substring(8); // Remove #EXTINF:
        
        // Extrair atributos
        const tvgIdMatch = extinf.match(/tvg-id="([^"]+)"/);
        const tvgNameMatch = extinf.match(/tvg-name="([^"]+)"/);
        const tvgLogoMatch = extinf.match(/tvg-logo="([^"]+)"/);
        const groupMatch = extinf.match(/group-title="([^"]+)"/);
        
        // Nome vem após a ÚLTIMA vírgula que segue o último atributo entre aspas
        // Formato: #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Nome do Filme
        // A vírgula que separa o nome está APÓS o último atributo fechado com aspas
        let name = '';
        
        // Estratégia: Encontrar a posição da última aspa dupla e pegar a vírgula após ela
        const lastQuoteIndex = extinf.lastIndexOf('"');
        if (lastQuoteIndex > -1) {
          // Encontrar a vírgula após a última aspa
          const commaAfterQuote = extinf.indexOf(',', lastQuoteIndex);
          if (commaAfterQuote > -1) {
            name = extinf.substring(commaAfterQuote + 1).trim();
          }
        }
        
        // Fallback: se não encontrou pelo método acima, usar o método antigo
        if (!name) {
          const commaIndex = extinf.indexOf(',');
          name = commaIndex > -1 ? extinf.substring(commaIndex + 1).trim() : '';
        }
        
        // Limpar metadados residuais do nome
        name = name.replace(/\s*tvg-[^"]*="[^"]*"\s*/gi, '');
        name = name.replace(/\s*group-title="[^"]*"\s*/gi, '');
        name = name.replace(/\s*tvg-id="[^"]*"\s*/gi, '');
        name = name.replace(/\s*tvg-name="[^"]*"\s*/gi, '');
        name = name.trim();
        
        // Remover aspas residuais no início/fim
        if (name.startsWith('"')) name = name.substring(1);
        if (name.endsWith('"')) name = name.slice(0, -1);
        name = name.trim();

        // Determinar tipo (heurística melhorada com detecção mais rigorosa)
        let type: 'live' | 'movie' | 'series' = 'live';
        const lowerName = name.toLowerCase();
        const rawGroup = groupMatch ? groupMatch[1] : '';
        const lowerGroup = rawGroup.toLowerCase();
        
        // ===== REGRA PRIORITÁRIA: GRUPO COMEÇA COM "FILME/FILMES" = SEMPRE FILME =====
        // Padrão observado no M3U: "Filmes | Romance", "Filmes | Ação", etc
        // IMPORTANTE: Se grupo começa com "Filme", NUNCA será série (mesmo que tenha padrão S01E01)
        const moviePrefixes = ['filmes |', 'filme |', 'movies |', 'movie |', 'cinema |'];
        const groupStartsWithMovie = moviePrefixes.some(prefix => lowerGroup.startsWith(prefix));
        
        // Se grupo começa com "Filme", bloquear como FILME e pular heurística
        if (groupStartsWithMovie) {
          type = 'movie';
          currentItem = {
            name: name,
            logo: tvgLogoMatch ? tvgLogoMatch[1] : undefined,
            group: rawGroup,
            tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
            tvgName: tvgNameMatch ? tvgNameMatch[1] : undefined,
            type,
          };
        } else {
          // ===== DETECÇÃO NORMAL: SÉRIE OU FILME (por heurística) =====
          // Permite detectar séries em categorias como "Novelas", "HBO", "Netflix", etc
          
          // REGRA 1: Grupo começa com "Series" → SÉRIE garantida
          const seriesPrefixes = ['series |', 'serie |', 'séries |', 'série |'];
          const groupStartsWithSeries = seriesPrefixes.some(prefix => lowerGroup.startsWith(prefix));
          
          if (groupStartsWithSeries) {
            type = 'series';
            currentItem = {
              name: name,
              logo: tvgLogoMatch ? tvgLogoMatch[1] : undefined,
              group: rawGroup,
              tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
              tvgName: tvgNameMatch ? tvgNameMatch[1] : undefined,
              type,
            };
          } else {
            // Continuar com a detecção por episódios (S01E01, 1x01, etc)...
        
        // ===== DETECTAR SÉRIES (MAIS RIGOROSO) =====
        // Padrões regex para detectar séries (S01E01, 1x01, Temporada 1 Episodio 1, etc)
        const SERIES_PATTERNS = [
          /[Ss](\d{1,2})\s*[Ee](\d{1,2})/,              // S01E01, S01 E01, s1e1
          /(\d{1,2})\s*x\s*(\d{1,2})/,                  // 1x01, 01x01
          /[Tt]emp(?:orada)?\s*(\d+)\s*[Ee]p(?:isodio)?\s*(\d+)/i,  // Temporada 1 Episodio 1
          /[Ss]eason\s*(\d+)\s*[Ee]pisode\s*(\d+)/i,    // Season 1 Episode 1
          /[Cc]ap(?:itulo)?\s*(\d+)/,                   // Capitulo 1, Cap 1
        ];
        
        // ===== CASO ESPECIAL: "Sem categoria" =====
        // Se não tem grupo definido, verificar se é série por padrão de episódio
        const isEmptyGroup = !rawGroup || rawGroup.trim() === '';
        if (isEmptyGroup) {
          // Verificar se tem padrão de série no nome
          for (const pattern of SERIES_PATTERNS) {
            if (pattern.test(name)) {
              // Tem padrão de série e sem categoria = É SÉRIE
              type = 'series';
              currentItem = {
                name: name,
                logo: tvgLogoMatch ? tvgLogoMatch[1] : undefined,
                group: 'Sem categoria',
                tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
                tvgName: tvgNameMatch ? tvgNameMatch[1] : undefined,
                type,
              };
              break; // Sair do loop de padrões
            }
          }
          // Se definiu tipo, continuar para próxima linha
          if (type === 'series') {
            continue;
          }
        }
        
        // Verificar se é série usando padrões NO NOME (não no grupo)
        let isSeries = false;
        for (const pattern of SERIES_PATTERNS) {
          if (pattern.test(name)) {
            isSeries = true;
            break;
          }
        }
        
        // PALAVRAS-CHAVE DE SÉRIE (mais rigoroso - apenas se estiver no NOME, não só no grupo)
        if (!isSeries) {
          const seriesKeywordsInName = [
            'season ', 'temporada ', 'episodio', 'episode', 'capitulo', 'cap. '
          ];
          for (const keyword of seriesKeywordsInName) {
            if (lowerName.includes(keyword)) {
              isSeries = true;
              break;
            }
          }
        }
        
        // PALAVRAS-CHAVE DE SÉRIE NO GRUPO (menos peso, precisa de confirmação no nome)
        if (!isSeries) {
          // IMPORTANTE: Verificar que o grupo NÃO tem palavras de filme primeiro
          const movieKeywordsCheck = ['filme', 'movie', 'cinema'];
          const hasMovieInGroup = movieKeywordsCheck.some(k => lowerGroup.includes(k));
          
          // Se grupo tem palavra de filme, NÃO considerar como série mesmo que tenha "serie"
          if (!hasMovieInGroup) {
            const seriesKeywordsInGroup = ['serie', 'series', 'novelas', 'novela', 'programas de tv', 'programas tv'];
            const hasSeriesGroup = seriesKeywordsInGroup.some(k => lowerGroup.includes(k));
            
            // Se grupo indica série, verificar se nome também tem indicativos
            if (hasSeriesGroup) {
              // Verificar se tem números que podem ser episódios (ex: "Nome 01", "Nome 02")
              const hasEpisodeNumber = /\s+\d{1,3}$/.test(name) || /\s+\d{1,3}\s+/.test(name);
              if (hasEpisodeNumber) {
                isSeries = true;
              }
            }
          }
        }
        
        // ===== DETECTAR FILMES (MAIS RIGOROSO) =====
        let isMovie = false;
        
        // 1. Palavras-chave explícitas de FILME no grupo
        const movieKeywords = ['filme', 'movie', 'cinema', 'film'];
        const hasMovieKeyword = movieKeywords.some(k => lowerGroup.includes(k));
        
        // 2. Tem ano no formato (2020), (2021), (2022), (2023), (2024), (2025), etc
        const hasYear = /\(?(19\d{2}|20[0-2]\d)\)?/.test(name);
        
        // 3. NÃO tem indicativos de série NO NOME
        const hasNoSeriesIndicators = !isSeries && 
          !lowerName.includes('s0') && 
          !lowerName.includes('s1') && 
          !lowerName.includes('s2') &&
          !/\dx\d/.test(lowerName) &&
          !lowerName.includes('season') &&
          !lowerName.includes('temporada') &&
          !lowerName.includes('episodio') &&
          !lowerName.includes('episode') &&
          !lowerName.includes('capitulo') &&
          !/[Ss]\d{2}[Ee]\d{2}/.test(name); // S01E01
        
        // PRIORIDADE: Se grupo tem "filme", "movie", "cinema" → É FILME (a menos que tenha padrão de série no nome)
        if (hasMovieKeyword && hasNoSeriesIndicators) {
          isMovie = true;
        }
        // OU: Tem ano no nome E não tem indicativos de série
        else if (hasYear && hasNoSeriesIndicators) {
          isMovie = true;
        }
        
        // ===== DEFINIR TIPO FINAL =====
        if (isSeries) {
          type = 'series';
          // Log detalhado para debug (apenas primeiros 10 itens série)
          if (items.length < 10) {
            logger.debug(`[M3U Parser] SÉRIE detectada: "${name}" | Grupo: "${groupMatch ? groupMatch[1] : 'N/A'}"`);
          }
        } else if (isMovie) {
          type = 'movie';
        } else {
          // Verificar se é LIVE (canal ao vivo)
          const liveKeywords = ['live', 'ao vivo', 'tv ', 'canal', 'channel'];
          const hasLiveKeyword = liveKeywords.some(k => lowerName.includes(k) || lowerGroup.includes(k));
          
          if (hasLiveKeyword) {
            type = 'live';
          } else {
            // Se não conseguiu determinar, deixar como 'live' (padrão mais seguro)
            // Isso evita classificar incorretamente como filme
            type = 'live';
          }
        }
        
        currentItem = {
          name: name,
          logo: tvgLogoMatch ? tvgLogoMatch[1] : undefined,
          group: rawGroup,
          tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
          tvgName: tvgNameMatch ? tvgNameMatch[1] : undefined,
          type,
        };
          } // Fim do else (detecção por episódios)
        } // Fim do else (não começa com "Filmes |")
      } else if (currentItem && line.startsWith('http')) {
        // URL do stream (linha seguinte ao #EXTINF)
        currentItem.url = line.trim();
        items.push(currentItem as M3UItem);
        currentItem = null;
      }
    }

    return items;
  }

  /**
   * Baixa e faz parse de uma URL M3U
   */
  private async fetchM3U(url: string): Promise<M3UItem[]> {
    try {
      logger.info('[M3UImporter] Baixando M3U:', { url });
      
      // ⚠️ RETRY: Usar retry com backoff exponencial
      const response = await retryHttp(
        () => axios.get(url, {
          timeout: 60000, // 60 segundos
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; M3U-Importer/1.0)',
          },
          responseType: 'text',
        }),
        {
          maxRetries: 3,
          initialDelay: 2000, // 2s inicial para downloads M3U
          maxDelay: 30000, // Máximo 30s entre tentativas
          onRetry: (attempt, error) => {
            logger.debug(`[M3UImporter] Retentando download de M3U (tentativa ${attempt}/3)`);
          },
        }
      );

      const content = response.data;
      const items = this.parseM3U(content);
      
      logger.info(`[M3UImporter] M3U parseado: ${items.length} itens encontrados`);
      return items;
    } catch (error: any) {
      logger.error('[M3UImporter] Erro ao baixar M3U:', error.message);
      throw new Error(`Erro ao baixar M3U: ${error.message}`);
    }
  }

  /**
   * Pré-visualiza M3U (parse sem importar)
   * Retorna categorias encontradas e estatísticas
   */
  async previewM3U(m3uUrlOrContent: string, vodType: 'both' | 'movie' | 'series' = 'both'): Promise<{
    total: number;
    movies: number;
    series: number;
    categories: M3UCategory[];
  }> {
    try {
      logger.info('[M3UImporter] Iniciando preview M3U', { vodType, isUrl: m3uUrlOrContent.startsWith('http') });

      // Se começar com http, é URL; senão, é conteúdo direto
      let allItems: M3UItem[];
      if (m3uUrlOrContent.startsWith('http://') || m3uUrlOrContent.startsWith('https://')) {
        logger.info('[M3UImporter] Baixando M3U da URL...');
        allItems = await this.fetchM3U(m3uUrlOrContent);
      } else {
        // É conteúdo direto
        logger.info('[M3UImporter] Parseando conteúdo M3U direto...');
        if (!m3uUrlOrContent || m3uUrlOrContent.trim().length === 0) {
          throw new Error('Conteúdo M3U vazio ou inválido');
        }
        allItems = this.parseM3U(m3uUrlOrContent);
      }

      logger.info(`[M3UImporter] Parseado: ${allItems.length} itens totais`);

      // Filtrar por tipo
      const movies: M3UItem[] = [];
      const series: M3UItem[] = [];

      for (const item of allItems) {
        if (vodType === 'movie' && item.type === 'movie') {
          movies.push(item);
        } else if (vodType === 'series' && item.type === 'series') {
          series.push(item);
        } else if (vodType === 'both') {
          if (item.type === 'movie') movies.push(item);
          else if (item.type === 'series') series.push(item);
        }
      }

      const allFiltered = [...movies, ...series];
      logger.info(`[M3UImporter] Filtrado: ${movies.length} filmes, ${series.length} séries (de ${allItems.length} totais)`);

      // Log das primeiras séries para debug
      if (vodType === 'series' && series.length > 0) {
        logger.info(`[M3UImporter] Primeiras 5 séries detectadas:`);
        series.slice(0, 5).forEach((s, i) => {
          logger.info(`  ${i+1}. "${s.name}" | Grupo: "${s.group || 'N/A'}"`);
        });
      }

      const categories = this.extractCategories(allFiltered);
      logger.info(`[M3UImporter] Extraídas ${categories.length} categorias`);
      
      // ⚠️ FIX: Removido log que acessa 'items' para otimização de resposta
      // Log das categorias com poucos itens (possíveis falsos positivos)
      // Comentado pois 'items' foi removido para evitar resposta HTTP gigante

      return {
        total: allFiltered.length,
        movies: movies.length,
        series: series.length,
        categories,
      };
    } catch (error: any) {
      logger.error('[M3UImporter] Erro no preview M3U:', { message: error.message, stack: error.stack });
      throw new Error(`Erro ao pré-visualizar M3U: ${error.message}`);
    }
  }

  /**
   * Importa conteúdo de uma URL M3U (alias para compatibilidade)
   */
  async importFromUrl(m3uUrl: string, options: ImportOptions = {}): Promise<ImportResult> {
    logger.info(`[M3UImporter] 🔄 importFromUrl chamado - redirecionando para importFromM3U`);
    return this.importFromM3U(m3uUrl, options);
  }

  /**
   * Importa conteúdo de uma URL M3U
   */
  async importFromM3U(m3uUrl: string, options: ImportOptions = {}): Promise<ImportResult> {
    // 🔍 DEBUG: Log detalhado de TODOS os parâmetros críticos
    logger.info(`[M3UImporter] 🔍 INICIANDO IMPORTAÇÃO M3U`);
    logger.info(`[M3UImporter] 📋 PARÂMETROS RECEBIDOS:`);
    logger.info(`[M3UImporter]   - url: ${m3uUrl?.substring(0, 50)}...`);
    logger.info(`[M3UImporter]   - enrichWithTMDB: ${options.enrichWithTMDB} (tipo: ${typeof options.enrichWithTMDB})`);
    logger.info(`[M3UImporter]   - categoryMappings: ${options.categoryMappings?.length || 0} mapeamentos`);
    logger.info(`[M3UImporter]   - bouquetId: ${options.bouquetId} (tipo: ${typeof options.bouquetId})`);
    logger.info(`[M3UImporter]   - serverId (streaming): ${options.serverId} (tipo: ${typeof options.serverId})`);
    logger.info(`[M3UImporter]   - categoryId (fallback): ${options.categoryId}`);
    logger.info(`[M3UImporter]   - vodType: ${options.vodType}`);
    logger.info(`[M3UImporter]   - clearBeforeImport: ${options.clearBeforeImport}`);
    logger.info(`[M3UImporter]   - createYearCategory: ${options.createYearCategory}`);
    logger.info(`[M3UImporter]   - selectedYears: ${JSON.stringify(options.selectedYears)}`);
    
    const startTime = Date.now();
    const threshold = options.threshold || 100;
    const clearBefore = options.clearBeforeImport || false;
    const vodType = options.vodType || 'both';
    const userId = options.userId || 'anonymous';

    logger.info('[M3UImporter] Iniciando importação', { m3uUrl: m3uUrl?.substring(0, 50), vodType, userId });

    // ⚠️ SOCKET: Inicializar estado do processo
    socketService.updateUserProcess(userId, {
      status: 'processing',
      progress: 0,
      processedItems: 0,
      totalItems: 0,
      addedItems: 0,
      skippedItems: 0,
      startTime: startTime,
    });

    try {
      // 1. Baixar e fazer parse do M3U
      const allItems = await this.fetchM3U(m3uUrl);

      // 2. Filtrar por tipo
      const movies: M3UItem[] = [];
      const series: M3UItem[] = [];

      for (const item of allItems) {
        if (vodType === 'movie' && item.type === 'movie') {
          movies.push(item);
        } else if (vodType === 'series' && item.type === 'series') {
          series.push(item);
        } else if (vodType === 'both') {
          if (item.type === 'movie') movies.push(item);
          else if (item.type === 'series') series.push(item);
        }
      }

      // 3. Aplicar mapeamento de categorias e filtrar itens
      let categoryIdMap = new Map<string, number>(); // M3U Category Name → XUI Category ID
      let filteredMovies = options.maxMovies ? movies.slice(0, options.maxMovies) : movies;
      let filteredSeries = options.maxSeries ? series.slice(0, options.maxSeries) : series;

      if (options.categoryMappings && options.categoryMappings.length > 0) {
        logger.info('[M3UImporter] Aplicando mapeamento de categorias...');

        // Primeiro, criar todas as categorias necessárias
        const categoriesToCreate: Array<{m3uCategory: string, categoryName: string, categoryType: 'vod' | 'series'}> = [];
        const categoriesToMap: Map<string, number> = new Map();

        for (const mapping of options.categoryMappings) {
          if (!mapping.importCategory || mapping.action === 'ignore') continue;

          if (mapping.action === 'map' && mapping.xuiCategoryId) {
            // Mapear para categoria existente
            categoriesToMap.set(mapping.m3uCategory, mapping.xuiCategoryId);
            logger.info(`[M3UImporter] Mapeando "${mapping.m3uCategory}" → XUI ID ${mapping.xuiCategoryId}`);
          } else if (mapping.action === 'create') {
            // Marcar para criar depois
            const categoryName = mapping.newCategoryName || mapping.m3uCategory;
            // Determinar tipo baseado nos itens dessa categoria
            const categoryItems = [...movies, ...series].filter(item => (item.group || 'Sem categoria') === mapping.m3uCategory);
            const hasSeries = categoryItems.some(item => item.type === 'series');
            const categoryType = hasSeries ? 'series' : 'vod';
            categoriesToCreate.push({ m3uCategory: mapping.m3uCategory, categoryName, categoryType });
          }
        }

        // Criar todas as categorias
        for (const { m3uCategory, categoryName, categoryType } of categoriesToCreate) {
          try {
            const categoryId = await this.apiClient.getOrCreateCategory(categoryName, categoryType);
            if (categoryId) {
              categoriesToMap.set(m3uCategory, categoryId);
              logger.info(`[M3UImporter] Categoria criada/encontrada: ${categoryName} (ID: ${categoryId}, tipo: ${categoryType})`);
              
              // Verificar se realmente foi criada/encontrada
              const verifyCategories = await this.apiClient.getCategories(categoryType);
              const found = verifyCategories.find(c => c.id === categoryId);
              if (!found) {
                logger.error(`[M3UImporter] Categoria ${categoryName} não encontrada após criação!`);
              } else {
                logger.info(`[M3UImporter] Categoria ${categoryName} verificada com sucesso no XUI`);
              }
            } else {
              logger.error(`[M3UImporter] Falha ao criar categoria ${categoryName}: ID não retornado`);
            }
          } catch (error: any) {
            logger.error(`[M3UImporter] Erro ao criar categoria ${categoryName}:`, error.message);
            // Continuar mesmo se falhar - item será importado sem categoria
          }
        }

        // Agora aplicar os mapeamentos
        categoryIdMap = categoriesToMap;

        // Filtrar itens baseado nas categorias selecionadas
        const allowedCategories = new Set(categoryIdMap.keys());
        const originalMoviesCount = movies.length;
        const originalSeriesCount = series.length;

        filteredMovies = movies.filter(item => {
          const category = item.group || 'Sem categoria';
          return allowedCategories.has(category);
        });

        filteredSeries = series.filter(item => {
          const category = item.group || 'Sem categoria';
          return allowedCategories.has(category);
        });

        logger.info(
          `[M3UImporter] Filtrado por categorias: ${originalMoviesCount - filteredMovies.length} filmes e ${originalSeriesCount - filteredSeries.length} séries removidos`
        );
      } else if (options.categoryId) {
        // Fallback: usar categoryId se não tiver mapeamentos
        categoryIdMap.set('*', options.categoryId);
        logger.info(`[M3UImporter] ⚠️ Usando categoryId fallback: ${options.categoryId}`);
      } else {
        // 🔍 DEBUG: Nenhum mapeamento de categoria configurado
        logger.warn(`[M3UImporter] ⚠️ ATENÇÃO: Nenhum mapeamento de categoria configurado!`);
        logger.warn(`[M3UImporter]   - categoryMappings: ${options.categoryMappings?.length || 0} itens`);
        logger.warn(`[M3UImporter]   - categoryId (fallback): ${options.categoryId}`);
        logger.warn(`[M3UImporter]   - Filmes serão importados SEM categoria atribuída!`);
      }

      // 🔍 DEBUG: Log do estado do categoryIdMap
      logger.info(`[M3UImporter] 📊 categoryIdMap tem ${categoryIdMap.size} mapeamento(s):`);
      for (const [key, value] of categoryIdMap) {
        logger.info(`[M3UImporter]   - "${key}" → XUI ID ${value}`);
      }

      const totalItems = filteredMovies.length + filteredSeries.length;
      logger.info(`[M3UImporter] Total a importar: ${filteredMovies.length} filmes, ${filteredSeries.length} séries`);

      // ⚠️ SOCKET: Atualizar total de itens
      socketService.updateUserProcess(userId, {
        totalItems,
        currentItem: 'Preparando importação...',
      });

      // 4. Limpar antes (se solicitado)
      if (clearBefore) {
        logger.info('[M3UImporter] Limpando conteúdo existente...');
        if (vodType === 'movie' || vodType === 'both') {
          await this.dbClient.deleteAllMovies();
        }
        if (vodType === 'series' || vodType === 'both') {
          await this.dbClient.deleteAllSeries();
        }
      }

      // 🎆 NOVA FUNCIONALIDADE: Criar categorias especiais por ano (com suporte a múltiplos anos)
      const yearCategoryMap = new Map<number, number>(); // Map<year, categoryId>
      
      if (options.createYearCategory && (vodType === 'movie' || vodType === 'both')) {
        // Determinar quais anos processar (novo: múltiplos anos OU ano único para compatibilidade)
        const yearsToProcess: number[] = [];
        
        if (options.selectedYears && Array.isArray(options.selectedYears) && options.selectedYears.length > 0) {
          // Novo: múltiplos anos selecionados
          yearsToProcess.push(...options.selectedYears);
          logger.info(`[M3UImporter] 🎆 Criando categorias para múltiplos anos: ${yearsToProcess.join(', ')}`);
        } else if (options.selectedYear) {
          // Compatibilidade: ano único (deprecated mas ainda suportado)
          yearsToProcess.push(options.selectedYear);
          logger.info(`[M3UImporter] 🎆 Criando categoria para ano único: ${options.selectedYear}`);
        }
        
        // Criar categorias para cada ano selecionado
        for (const year of yearsToProcess) {
          const yearCategoryName = `Filmes | Lançamentos ${year}`;
          
          try {
            // Verificar se categoria já existe antes de criar
            const existingCategory = await this.dbClient.findCategoryByName(yearCategoryName, 'movie');
            
            if (existingCategory) {
              yearCategoryMap.set(year, existingCategory.id);
              logger.info(`[M3UImporter] ✅ Categoria "${yearCategoryName}" já existe (ID: ${existingCategory.id})`);
            } else {
              logger.info(`[M3UImporter] 🎆 Criando categoria especial: "${yearCategoryName}"...`);
              // Criar categoria no XUI
              const categoryResult = await this.dbClient.createCategory({
                category_name: yearCategoryName,
                category_type: 'movie', // Para filmes VOD
                parent_id: 0
              });
              yearCategoryMap.set(year, categoryResult.id);
              logger.info(`[M3UImporter] ✅ Categoria "${yearCategoryName}" criada com ID: ${categoryResult.id}`);
            }
            
            // Enviar notificação Socket.io apenas uma vez por categoria
            const currentProcess = socketService.getUserProcess(userId);
            if (!currentProcess || !currentProcess.currentItem?.includes('Lançamentos')) {
              socketService.updateUserProcess(userId, {
                currentItem: `🎆 Categoria "${yearCategoryName}" pronta`,
              });
            }
          } catch (error: any) {
            logger.error(`[M3UImporter] Erro ao criar/verificar categoria "${yearCategoryName}": ${error.message}`);
            // Não falhar a importação se categoria especial falhar
          }
        }
        
        logger.info(`[M3UImporter] ✅ ${yearCategoryMap.size} categoria(s) de lançamento criada(s)`);
      } else if (options.createYearCategory) {
        logger.info(`[M3UImporter] ⚠️ Categorias especiais NÃO serão criadas porque vodType="${vodType}" (requer "movie" ou "both")`);
      }

      // 5. Converter para formato XUI (aplicar mapeamentos)
      // � CORREÇÃO: Criar mapa normalizado para comparação case-insensitive e sem espaços extras
      const normalizedCategoryIdMap = new Map<string, number>();
      for (const [key, value] of categoryIdMap) {
        const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, ' ');
        normalizedCategoryIdMap.set(normalizedKey, value);
        logger.debug(`[M3UImporter] Mapa normalizado: "${normalizedKey}" → ${value}`);
      }
      
      // �🔍 DEBUG: Log do primeiro filme para verificar o mapeamento
      if (filteredMovies.length > 0) {
        const firstItem = filteredMovies[0];
        const firstCategoryName = firstItem.group || 'Sem categoria';
        const normalizedFirstCategory = firstCategoryName.toLowerCase().trim().replace(/\s+/g, ' ');
        const firstCategoryId = categoryIdMap.get(firstCategoryName) || normalizedCategoryIdMap.get(normalizedFirstCategory) || categoryIdMap.get('*');
        logger.info(`[M3UImporter] 🔍 DEBUG MAPEAMENTO PRIMEIRO FILME:`);
        logger.info(`[M3UImporter]   - item.group: "${firstItem.group}"`);
        logger.info(`[M3UImporter]   - categoryName: "${firstCategoryName}"`);
        logger.info(`[M3UImporter]   - normalizedCategory: "${normalizedFirstCategory}"`);
        logger.info(`[M3UImporter]   - categoryIdMap.get("${firstCategoryName}"): ${categoryIdMap.get(firstCategoryName)}`);
        logger.info(`[M3UImporter]   - normalizedMap.get("${normalizedFirstCategory}"): ${normalizedCategoryIdMap.get(normalizedFirstCategory)}`);
        logger.info(`[M3UImporter]   - categoryId final: ${firstCategoryId}`);
      }
      
      // 🔍 DEBUG CRÍTICO: Log antes do map para ver estado do categoryIdMap
      logger.info(`[M3UImporter] 🔍 CRÍTICO: Iniciando criação de movieData para ${filteredMovies.length} filmes`);
      logger.info(`[M3UImporter] 🔍 CRÍTICO: categoryIdMap.size = ${categoryIdMap.size}`);
      for (const [k, v] of categoryIdMap) {
        logger.info(`[M3UImporter] 🔍 CRÍTICO: categoryIdMap["${k}"] = ${v}`);
      }
      
      const movieData: MovieData[] = filteredMovies.map((item, index) => {
        const categoryName = item.group || 'Sem categoria';
        const normalizedCategory = categoryName.toLowerCase().trim().replace(/\s+/g, ' ');
        // Tentar match exato primeiro, depois normalizado, depois fallback
        const categoryId = categoryIdMap.get(categoryName) || normalizedCategoryIdMap.get(normalizedCategory) || categoryIdMap.get('*');
        
        // 🔍 DEBUG: Log dos primeiros 3 filmes para verificar mapeamento
        if (index < 3) {
          logger.info(`[M3UImporter] 🔍 FILME[${index}]: group="${item.group}", categoryName="${categoryName}", categoryId=${categoryId}`);
        }
        
        // Garantir que o nome está limpo (sem metadados)
        let cleanName = item.name.trim();
        // Remover qualquer metadado que possa ter sobrado
        cleanName = cleanName.replace(/\s*tvg-[^"]*="[^"]*"\s*/gi, '');
        cleanName = cleanName.replace(/\s*group-title="[^"]*"\s*/gi, '');
        cleanName = cleanName.trim();

        // Canonicalizar: manter título como na fonte primária (sem ano/tags no final)
        cleanName = this.canonicalizeTitle(cleanName);
        
        // Garantir que a categoria seja atribuída
        if (!categoryId) {
          logger.warn(`[M3UImporter] Categoria não mapeada para "${categoryName}", item será importado sem categoria`);
        }

        // Garantir que a capa seja passada se disponível
        const streamIcon = item.logo && item.logo.trim() ? item.logo.trim() : undefined;

        // 🎆 NOVA FUNCIONALIDADE: Adicionar categorias especiais por ano
        const categoryIds = categoryId ? [categoryId] : [];
        
        if (yearCategoryMap.size > 0) {
          // Detectar ano do filme usando múltiplas estratégias
          let movieYear: number | null = null;
          
          // Estratégia 1: Extrair ano do título - MÚLTIPLOS FORMATOS SUPORTADOS:
          // 1. Formato tradicional: "Filme (2025)"
          // 2. Formato alternativo: "Filme [2025]" 
          // 3. Formato no final: "Filme - 2025"
          // 4. Formato TMDB: "Filme (2025) - Director Cut"
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
          
          // Estratégia 2: Usar metadados TMDB se disponíveis (será preenchido depois)
          // Esta validação será feita no enrichWithTMDB mais tarde
          // Por enquanto, apenas detectar pelo título
          
          // Se ano corresponde a algum dos anos selecionados, adicionar categoria especial
          if (movieYear && yearCategoryMap.has(movieYear)) {
            const specialCategoryId = yearCategoryMap.get(movieYear)!;
            categoryIds.push(specialCategoryId);
            logger.debug(`[M3UImporter] 🎯 Filme "${cleanName}" (${movieYear}) adicionado à categoria especial`);
          }
        }

        return {
          stream_display_name: cleanName,
          stream_source: [item.url],
          stream_icon: streamIcon,
          category_id: categoryIds,
        };
      });

      // NOVA ESTRUTURA: Processar séries como episódios agrupados
      // Agrupar episódios por série usando detectSeriesEpisode
      const episodesBySeries = new Map<string, Array<{
        episode: ReturnType<typeof detectSeriesEpisode>;
        item: M3UItem;
      }>>();
      
      let parsedCount = 0;
      let notParsedCount = 0;
      const notParsedItems: string[] = [];
      
      for (const item of filteredSeries) {
        const parsed = detectSeriesEpisode(item.name, item.url, item.logo, item.group);
        if (parsed) {
          const canonicalSeriesName = this.canonicalizeTitle(parsed.seriesName);
          const seriesKey = canonicalSeriesName.toLowerCase().trim();
          if (!episodesBySeries.has(seriesKey)) {
            episodesBySeries.set(seriesKey, []);
          }
          episodesBySeries.get(seriesKey)!.push({ episode: { ...parsed, seriesName: canonicalSeriesName }, item });
          parsedCount++;
        } else {
          // Se não conseguiu parsear como episódio, tratar como série antiga (fallback)
          notParsedCount++;
          if (notParsedItems.length < 10) {
            notParsedItems.push(item.name);
          }
        }
      }
      
      logger.info(`[M3UImporter] Parse de séries: ${parsedCount} parseados, ${notParsedCount} não parseados, ${episodesBySeries.size} séries únicas encontradas`);
      
      // DEBUG: Log detalhado se nenhuma série foi parseada
      if (episodesBySeries.size === 0 && filteredSeries.length > 0) {
        logger.error(`[M3UImporter] ❌ ERRO CRÍTICO: NENHUMA SÉRIE FOI PARSEADA!`);
        logger.error(`[M3UImporter] Total de itens marcados como 'series': ${filteredSeries.length}`);
        logger.error(`[M3UImporter] Parseados: ${parsedCount}, Não parseados: ${notParsedCount}`);
        if (notParsedItems.length > 0) {
          logger.error(`[M3UImporter] Exemplos de itens não parseados (primeiros ${notParsedItems.length}):`);
          notParsedItems.forEach((name, idx) => {
            logger.error(`[M3UImporter]   ${idx + 1}. "${name}"`);
          });
        }
        logger.error(`[M3UImporter] Possíveis causas:`);
        logger.error(`[M3UImporter]   1. Nomes não seguem padrão (S01E01, 1x01, Temporada X Episodio Y)`);
        logger.error(`[M3UImporter]   2. Parser precisa ser ajustado para novos padrões`);
      }
      
      // DEPRECATED: Manter seriesData antigo por enquanto para compatibilidade
      const seriesData: SeriesData[] = [];

      // 6. Decidir método (MySQL direto ou API)
      const useMySQL = totalItems > threshold;

      logger.info(`[M3UImporter] Usando método: ${useMySQL ? 'MySQL direto' : 'API HTTP'} (${totalItems} itens)`);

      let inserted = 0;
      let errors = 0;
      let skipped = 0;
      let tmdbEnriched = 0;
      let tmdbErrors = 0;
      // SEMPRE fazer TMDB sync ANTES de inserir (necessário para banners/vídeos e filtro por ano)
      const shouldEnrichTmdbSync = options.enrichWithTMDB && this.tmdbService && movieData.length > 0;
      
      // 🔍 DEBUG: Log detalhado sobre decisão de TMDB
      logger.info(`[M3UImporter] 🎬 VERIFICAÇÃO TMDB:`);
      logger.info(`[M3UImporter]   - options.enrichWithTMDB: ${options.enrichWithTMDB}`);
      logger.info(`[M3UImporter]   - this.tmdbService: ${this.tmdbService ? 'DISPONÍVEL' : 'INDISPONÍVEL'}`);
      logger.info(`[M3UImporter]   - movieData.length: ${movieData.length}`);
      logger.info(`[M3UImporter]   - shouldEnrichTmdbSync: ${shouldEnrichTmdbSync}`);
      
      if (!shouldEnrichTmdbSync) {
        if (!options.enrichWithTMDB) {
          logger.warn(`[M3UImporter] ⚠️ TMDB desabilitado: enrichWithTMDB=${options.enrichWithTMDB}`);
        } else if (!this.tmdbService) {
          logger.error(`[M3UImporter] ❌ TMDB Service não inicializado! Verifique a chave API.`);
        }
      }
      
      if (shouldEnrichTmdbSync) {
        logger.info(`[M3UImporter] 📊 ANTES DO TMDB: movieData.length=${movieData.length}, options.enrichWithTMDB=${options.enrichWithTMDB}, this.tmdbService=${this.tmdbService ? 'DISPONÍVEL' : 'INDISPONÍVEL'}`);

        // 🔒 LIMITAR TMDB para evitar travar em importações muito grandes
        const maxTmdbItems = 8000;
        let itemsToProcess = movieData;

        if (movieData.length > maxTmdbItems) {
          logger.warn(`[M3UImporter] ⚠️ LIMITANDO TMDB: ${movieData.length} itens detectados, processando apenas os primeiros ${maxTmdbItems} para evitar travamento`);
          itemsToProcess = movieData.slice(0, maxTmdbItems);
        }

        logger.info(`[M3UImporter] 🚀 Iniciando enriquecimento TMDB OTIMIZADO para ${itemsToProcess.length} filmes...`);

        // 🚀 OTIMIZAÇÃO: Lotes maiores (30-50 itens) processados em paralelo
        const tmdbBatchSize = 40; // Aumentado de 10 para 40
        for (let i = 0; i < itemsToProcess.length; i += tmdbBatchSize) {
          // ⚠️ PAUSE/RESUME/CANCEL: Verificar se deve pausar
          const userState = socketService.getUserProcess(userId);
          if (userState?.isPaused) {
            while (userState.isPaused) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              const currentState = socketService.getUserProcess(userId);
              if (!currentState || !currentState.isRunning || currentState.isCompleted) {
                throw new Error('Importação cancelada pelo usuário');
              }
              if (!currentState.isPaused) break;
            }
          }
          
          // ⚠️ PAUSE/RESUME/CANCEL: Verificar se foi cancelado
          const checkState = socketService.getUserProcess(userId);
          if (!checkState || !checkState.isRunning || checkState.isCompleted) {
            logger.info('[M3UImporter] Processo cancelado durante enriquecimento TMDB');
            throw new Error('Importação cancelada pelo usuário');
          }
          
          const batch = itemsToProcess.slice(i, i + tmdbBatchSize);
          
          // 🚀 OTIMIZAÇÃO: Processar TODOS os itens do lote em PARALELO
          await Promise.all(batch.map(async (movie) => {
            try {
              // Extrair ano do título se possível (ex: "Filme (2023)" ou "Filme 2023")
              const yearMatch = movie.stream_display_name.match(/\((\d{4})\)/) || movie.stream_display_name.match(/\b(\d{4})\s*$/);
              const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
              
              // Limpar título para busca
              let cleanTitle = movie.stream_display_name
                .replace(/\s*\[.*?\]\s*/g, '')
                .replace(/\s*\([^)]*\)\s*/g, '')
                .replace(/\b\d{4}\s*$/g, '')
                .trim();
              
              cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();
              
              // 🚀 OTIMIZAÇÃO: searchMovie agora aceita year e faz busca paralela internamente
              const tmdbResult = await this.tmdbService!.searchMovie(cleanTitle, year);
              
              if (tmdbResult) {
                // Se encontrou resultado de busca, buscar detalhes completos
                const movieDetails = await this.tmdbService!.getMovieDetails(tmdbResult.id);
                if (movieDetails) {
                  const properties = this.tmdbService!.convertMovieToXUIProperties(movieDetails, cleanTitle);
                  movie.movie_properties = properties;
                  
                  // LOG PARA DEBUG
                  logger.info(`[M3UImporter] ✅ TMDB atribuído para "${movie.stream_display_name}": name=${properties.name}, description=${properties.description ? properties.description.substring(0, 30) + '...' : 'N/A'}, rating=${properties.rating || 'N/A'}`);
                  
                  if (!movie.stream_icon && properties.cover_big) {
                    movie.stream_icon = properties.cover_big;
                    logger.info(`[M3UImporter] 🖼️ Capa atribuída para "${movie.stream_display_name}"`);
                  }
                  
                  // 🎨 MARKETING: Salvar metadados no Prisma para uso em banners/vídeos
                  try {
                    const genres = movieDetails.genres?.map(g => g.name) || [];
                    await prisma.vODMetadata.upsert({
                      where: { tmdbId: movieDetails.id },
                      update: {
                        title: movieDetails.title || movie.stream_display_name,
                        originalTitle: movieDetails.original_title || movieDetails.title,
                        overview: movieDetails.overview || null,
                        releaseDate: movieDetails.release_date || null,
                        genres: genres.length > 0 ? JSON.stringify(genres) : null,
                        posterUrl: movieDetails.poster_path ? `https://image.tmdb.org/t/p/w500${movieDetails.poster_path}` : null,
                        backdropUrl: movieDetails.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movieDetails.backdrop_path}` : null,
                        runtime: movieDetails.runtime || null,
                        rating: movieDetails.vote_average && movieDetails.vote_average > 0 ? movieDetails.vote_average : null,
                        lastSynced: new Date(),
                      },
                      create: {
                        tmdbId: movieDetails.id,
                        tmdbType: 'movie',
                        title: movieDetails.title || movie.stream_display_name,
                        originalTitle: movieDetails.original_title || movieDetails.title,
                        overview: movieDetails.overview || null,
                        releaseDate: movieDetails.release_date || null,
                        genres: genres.length > 0 ? JSON.stringify(genres) : null,
                        posterUrl: movieDetails.poster_path ? `https://image.tmdb.org/t/p/w500${movieDetails.poster_path}` : null,
                        backdropUrl: movieDetails.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movieDetails.backdrop_path}` : null,
                        runtime: movieDetails.runtime || null,
                        rating: movieDetails.vote_average && movieDetails.vote_average > 0 ? movieDetails.vote_average : null,
                        lastSynced: new Date(),
                      },
                    });
                    logger.debug(`[M3UImporter] ✅ VODMetadata salvo para TMDB ID ${movieDetails.id}: ${movieDetails.title}`);
                  } catch (metaError: any) {
                    logger.warn(`[M3UImporter] Erro ao salvar VODMetadata para ${movie.stream_display_name}:`, metaError.message);
                    // Não falhar a importação por causa do metadata
                  }
                  
                  // 🎆 NOVA FUNCIONALIDADE: Adicionar categorias por ano se disponíveis no TMDB
                  if (yearCategoryMap.size > 0 && movieDetails.release_date) {
                    // Extrair ano do release_date do TMDB
                    const tmdbYear = parseInt(movieDetails.release_date.substring(0, 4), 10);
                    
                    // Verificar se esse ano está nas categorias especiais
                    if (tmdbYear >= 1900 && tmdbYear <= 2100 && yearCategoryMap.has(tmdbYear)) {
                      // Verificar se já não está nessa categoria (evitar duplicatas)
                      const specialCategoryId = yearCategoryMap.get(tmdbYear)!;
                      if (!movie.category_id.includes(specialCategoryId)) {
                        movie.category_id.push(specialCategoryId);
                        logger.debug(`[M3UImporter] 🎆 Filme "${movie.stream_display_name}" (${tmdbYear} via TMDB) adicionado à categoria especial`);
                      }
                    }
                  }
                  
                  tmdbEnriched++;
                }
              }
            } catch (error: any) {
              tmdbErrors++;
              logger.debug(`[M3UImporter] Erro ao enriquecer "${movie.stream_display_name}":`, error.message);
            }
          }));
          
          // Log de progresso
          if ((i + tmdbBatchSize) % 100 === 0 || i + tmdbBatchSize >= itemsToProcess.length) {
            logger.info(`[M3UImporter] 🚀 TMDB: ${Math.min(i + tmdbBatchSize, itemsToProcess.length)}/${itemsToProcess.length} processados (${tmdbEnriched} enriquecidos, ${tmdbErrors} erros)`);
            
            const tmdbProgress = Math.round((i + tmdbBatchSize) / itemsToProcess.length * 100);
            socketService.updateUserProcess(userId, {
              currentItem: `Enriquecendo com TMDB: ${Math.min(i + tmdbBatchSize, itemsToProcess.length)}/${itemsToProcess.length}`,
              progress: Math.min(tmdbProgress, 30),
            });
          }
        }
        
        logger.info(`[M3UImporter] ✅ Enriquecimento TMDB concluído: ${tmdbEnriched} enriquecidos, ${tmdbErrors} erros`);
      }

      // 8. Importar filmes
      let movieIds: number[] = [];
      const moviesWithMetadata: Array<{ id: number; movie: MovieData }> = []; // Filmes com TMDB para processar via API
      const insertedMoviesMap = new Map<number, MovieData>(); // Mapa ID -> MovieData para ativação via API
      
      logger.info(`[M3UImporter] 🎬 PREPARANDO IMPORTAR FILMES: movieData.length=${movieData.length}`);
      
      // 🔍 DEBUG CRÍTICO: Verificar estado dos dados ANTES da inserção
      if (movieData.length > 0) {
        const sampleMovie = movieData[0];
        logger.info(`[M3UImporter] 🔍 AMOSTRA DO PRIMEIRO FILME:`);
        logger.info(`[M3UImporter]   - stream_display_name: ${sampleMovie.stream_display_name}`);
        logger.info(`[M3UImporter]   - category_id: ${JSON.stringify(sampleMovie.category_id)}`);
        logger.info(`[M3UImporter]   - stream_icon: ${sampleMovie.stream_icon?.substring(0, 50) || 'VAZIO'}`);
        logger.info(`[M3UImporter]   - movie_properties existe: ${!!sampleMovie.movie_properties}`);
        if (sampleMovie.movie_properties) {
          logger.info(`[M3UImporter]   - movie_properties.name: ${sampleMovie.movie_properties.name || 'VAZIO'}`);
          logger.info(`[M3UImporter]   - movie_properties.plot: ${sampleMovie.movie_properties.plot?.substring(0, 50) || 'VAZIO'}`);
          logger.info(`[M3UImporter]   - movie_properties.tmdb_id: ${sampleMovie.movie_properties.tmdb_id || 'VAZIO'}`);
          logger.info(`[M3UImporter]   - movie_properties.cover: ${sampleMovie.movie_properties.cover?.substring(0, 50) || 'VAZIO'}`);
        }
      }
      
      if (movieData.length > 0) {
        // ⚠️ PAUSE/RESUME/CANCEL: Verificar antes de inserir
        const checkState = socketService.getUserProcess(userId);
        if (!checkState || !checkState.isRunning || checkState.isCompleted) {
          logger.info('[M3UImporter] Processo cancelado antes de inserir filmes');
          throw new Error('Importação cancelada pelo usuário');
        }
        
        // ⚠️ SOCKET: Atualizar status
        socketService.updateUserProcess(userId, {
          currentItem: `Importando ${movieData.length} filmes...`,
        });
        
        logger.info(`[M3UImporter] 📦 ANTES de bulkInsertMovies: ${movieData.length} filmes | clearBefore=${clearBefore} | serverId=${options.serverId}`);
        
        // Sempre usar MySQL direto (mais confiável e rápido)
        // forceFreshImport = clearBefore (desabilita detecção de duplicatas após limpeza)
        const result = await this.dbClient.bulkInsertMovies(movieData, options.batchSize, true, options.serverId, clearBefore); // skipDuplicates = true, serverId, forceFreshImport
        
        logger.info(`[M3UImporter] 📊 DEPOIS de bulkInsertMovies: inserted=${result.inserted}, errors=${result.errors}, skipped=${result.skipped}`);
        
        inserted += result.inserted;
        errors += result.errors;
        
        skipped += result.skipped || 0;
        
        // ⚠️ SOCKET: Atualizar progresso após inserir filmes
        socketService.updateUserProcess(userId, {
          processedItems: movieData.length,
          addedItems: inserted,
          skippedItems: skipped,
          progress: Math.round((movieData.length / totalItems) * 70), // Filmes são ~70% do processo
          currentItem: `${inserted} filmes inseridos`,
        });
        if (result.skipped > 0) {
          logger.warn(`[M3UImporter] ${result.skipped} filmes duplicados foram ignorados`);
          
          // 🆕 NOVA FUNCIONALIDADE: Atualizar categorias de filmes existentes (se habilitado)
          if (options.updateExistingCategories && yearCategoryMap.size > 0) {
            try {
              logger.info(`[M3UImporter] 🆕 Atualizando categorias de ${result.skipped} filmes duplicados...`);
              
              socketService.updateUserProcess(userId, {
                currentItem: `Atualizando categorias de ${result.skipped} filmes existentes...`,
              });
              
              const updateStartTime = Date.now();
              const updateResult = await this.dbClient.updateExistingMovieCategories(movieData, yearCategoryMap);
              const updateDuration = ((Date.now() - updateStartTime) / 1000).toFixed(2);
              
              if (updateResult.updated > 0) {
                logger.info(`[M3UImporter] ✅ ${updateResult.updated} filmes existentes atualizados com categorias de ano em ${updateDuration}s`);
                socketService.updateUserProcess(userId, {
                  message: `✅ ${updateResult.updated} filmes atualizados (${updateDuration}s)`,
                });
              } else {
                logger.info(`[M3UImporter] Nenhum filme duplicado precisou ser atualizado com categorias de ano`);
              }
            } catch (updateError: any) {
              logger.error(`[M3UImporter] Erro ao atualizar categorias de filmes existentes (não crítico): ${updateError.message}`);
              // Não falhar a importação por causa disso
            }
          }
        }

        // Coletar IDs inseridos E duplicados para adicionar ao bouquet
        if (result.insertedIds && result.insertedIds.length > 0) {
          movieIds = result.insertedIds;
        }
        // ⚠️ CRÍTICO: Também incluir IDs de filmes duplicados (já existem no banco) para o bouquet
        if (result.skippedIds && result.skippedIds.length > 0) {
          movieIds = [...movieIds, ...result.skippedIds];
          logger.info(`[M3UImporter] 📦 ${result.skippedIds.length} IDs de filmes duplicados coletados para bouquet`);
        }

        // Mapear filmes inseridos -> MovieData (evita depender de leitura do DB e garante TMDB via API)
        if (result.insertedMovies && result.insertedMovies.length > 0) {
          // ⚠️ CRÍTICO: Criar mapa de filmes inseridos para ativação via API
          for (const { id: movieId, movie: originalMovie } of result.insertedMovies) {
            insertedMoviesMap.set(movieId, originalMovie);
          }
          logger.info(`[M3UImporter] 📦 ${insertedMoviesMap.size} filmes mapeados para ativação via API`);
          
          // ⚠️ CRÍTICO: Criar VODItem records para rastreamento e geração de banners
          logger.info(`[M3UImporter] Criando ${result.insertedMovies.length} VODItem records para rastreamento...`);
          const vodItemsToCreate = [];
          const insertedXuiIds: number[] = [];

          for (const { id: movieId, movie: originalMovie } of result.insertedMovies) {
            insertedXuiIds.push(movieId);
            // Determinar categoria do filme (primeira categoria do array ou fallback)
            const categoryId = originalMovie.category_id && originalMovie.category_id.length > 0
              ? originalMovie.category_id[0]
              : (options.categoryId || undefined);

            const categoryName = categoryId
              ? (categoryIdMap.get(categoryId.toString()) || categoryIdMap.get('*') || 'Sem categoria')
              : 'Sem categoria';

            vodItemsToCreate.push({
              xuiStreamId: movieId,
              serverId: this.server.id,
              vodType: 'movie',
              title: originalMovie.stream_display_name,
              streamName: originalMovie.stream_display_name,
              streamUrl: originalMovie.stream_source && originalMovie.stream_source.length > 0 ? originalMovie.stream_source[0] : '',
              categoryId: categoryId,
              categoryName: categoryName,
              overview: originalMovie.movie_properties?.plot || '',
              posterUrl: originalMovie.stream_icon || originalMovie.movie_properties?.movie_image || '',
              year: originalMovie.movie_properties?.year ? parseInt(String(originalMovie.movie_properties.year), 10) : undefined,
              hasMetadata: !!originalMovie.movie_properties?.tmdb_id,
              isEnriched: !!originalMovie.movie_properties?.tmdb_id,
            });

            // Se tem TMDB, marcar para processamento via API
            if (originalMovie.movie_properties?.tmdb_id) {
              moviesWithMetadata.push({ id: movieId, movie: originalMovie });
            }
          }

          if (vodItemsToCreate.length > 0) {
            try {
              // Inserir VODItems um a um para evitar erro de duplicata
              let vodItemsCreated = 0;
              for (const item of vodItemsToCreate) {
                try {
                  await prisma.vODItem.upsert({
                    where: { xuiStreamId: item.xuiStreamId },
                    update: {}, // Não atualiza se já existir
                    create: item,
                  });
                  vodItemsCreated++;
                } catch (upsertErr: any) {
                  // Ignorar erros de duplicata
                  if (!upsertErr.message?.includes('Unique constraint')) {
                    logger.warn(`[M3UImporter] Erro ao criar VODItem (não crítico):`, upsertErr.message);
                  }
                }
              }
              logger.info(`[M3UImporter] ✅ ${vodItemsCreated} VODItem(s) criado(s) para filmes`);

              if (options.enrichWithTMDB && insertedXuiIds.length > 0) {
                try {
                  const createdVodItems = await prisma.vODItem.findMany({
                    where: {
                      serverId: this.server.id,
                      vodType: 'movie',
                      xuiStreamId: { in: insertedXuiIds },
                    },
                    select: { id: true, hasMetadata: true },
                  });

                  const itemsToEnrich = createdVodItems.filter(v => !v.hasMetadata);

                  if (itemsToEnrich.length > 0) {
                    const job = await prisma.vODEnrichmentJob.create({
                      data: {
                        serverId: this.server.id,
                        userId,
                        jobType: 'tmdb',
                        status: 'pending',
                        totalItems: itemsToEnrich.length,
                        progress: 0,
                      },
                    });

                    await prisma.vODEnrichmentJobItem.createMany({
                      data: itemsToEnrich.map(v => ({
                        jobId: job.id,
                        vodItemId: v.id,
                        status: 'pending',
                      })),
                    });

                    logger.info(`[M3UImporter] 🧵 Job TMDB enfileirado: ${job.id} (${itemsToEnrich.length} filmes)`);
                  }
                } catch (enqueueErr: any) {
                  logger.warn(`[M3UImporter] Erro ao enfileirar TMDB enrichment (não crítico):`, enqueueErr.message);
                }
              }
            } catch (vodError: any) {
              logger.error(`[M3UImporter] Erro ao criar VODItems (não crítico - banners podem não ser gerados):`, vodError.message);
            }
          }
        }
      }

      // 9. Importar séries (NOVA ESTRUTURA: streams_series + streams type=5)
      logger.info(`[M3UImporter] DEBUG: episodesBySeries.size = ${episodesBySeries.size}, filteredSeries.length = ${filteredSeries.length}`);
      
      if (episodesBySeries.size > 0) {
        logger.info(`[M3UImporter] Processando ${episodesBySeries.size} séries...`);
        
        // PASSO 3: Séries sempre vão para bouquet ID=3 (Séries)
        // options.bouquetId é usado apenas para filmes
        let seriesInserted = 0;
        let episodesInserted = 0;
        const allEpisodes: EpisodeData[] = [];
        const tmdbSeriesDataMap = new Map<number, any>(); // Armazenar tmdbSeriesData por seriesId
        
        // Processar cada série
        let seriesProcessed = 0;
        const totalSeries = episodesBySeries.size;
        for (const [seriesKey, episodesInfo] of episodesBySeries) {
          if (episodesInfo.length === 0) continue;
          
          const firstEpisodeData = episodesInfo[0];
          if (!firstEpisodeData || !firstEpisodeData.episode) continue;
          
          const firstEpisode = firstEpisodeData.episode;
          const firstItem = firstEpisodeData.item;
          const categoryName = firstItem.group || 'Sem categoria';
          const categoryId = categoryIdMap.get(categoryName) || categoryIdMap.get('*');
          
          if (!categoryId) {
            logger.warn(`[M3UImporter] Categoria não mapeada para "${categoryName}", série será ignorada`);
            continue;
          }
          
          // ⚠️ CORREÇÃO CRÍTICA: Atualizar progresso via socket APENAS se processo ainda estiver ativo
          seriesProcessed++;
          const currentProcessState = socketService.getUserProcess(userId);
          if (currentProcessState && 
              currentProcessState.isRunning && 
              !currentProcessState.isCompleted && 
              currentProcessState.status === 'processing' &&
              !currentProcessState.isPaused) {
            socketService.updateUserProcess(userId, {
              currentItem: `Processando série ${seriesProcessed}/${totalSeries}: "${firstEpisode.seriesName}" (${episodesInfo.length} episódios)`,
              message: `Preparando ${episodesInfo.length} episódios da série "${firstEpisode.seriesName}"...`,
            });
          } else {
            // Processo já terminou ou foi pausado - não atualizar socket
            logger.debug(`[M3UImporter] Processo não está mais ativo (status: ${currentProcessState?.status}), pulando atualização de socket para série "${firstEpisode.seriesName}"`);
          }
          
          try {
            // Criar ou buscar série em streams_series
            // ⚠️ IMPORTANTE: NÃO usar firstEpisode.logo (é capa do episódio, não da série!)
            let seriesInfo: SeriesInfo = {
              title: firstEpisode.seriesName,
              category_id: [categoryId],
              cover: undefined, // Deixar vazio inicialmente - será preenchido do TMDB
              cover_big: undefined, // Deixar vazio inicialmente - será preenchido do TMDB
              genre: categoryName,
            };
            
            // Enriquecer com TMDB se habilitado (similar aos filmes)
            let tmdbSeriesData: any = null;
            if (options.enrichWithTMDB && this.tmdbService) {
              try {
                // Limpar título para busca TMDB
                let cleanTitle = firstEpisode.seriesName
                  .replace(/\s*\[.*?\]\s*/g, '')
                  .replace(/\s*\([^)]*\)\s*/g, '')
                  .replace(/\b\d{4}\s*$/g, '')
                  .trim()
                  .replace(/\s+/g, ' ');
                
                // ⚠️ CORREÇÃO: Usar searchTV primeiro, depois getTVDetails para obter seasons
                const tmdbSearchResult = await this.tmdbService.searchTV(cleanTitle);
                if (tmdbSearchResult && tmdbSearchResult.id) {
                  // Buscar detalhes completos (inclui seasons)
                  tmdbSeriesData = await this.tmdbService.getTVDetails(tmdbSearchResult.id);
                  
                  if (tmdbSeriesData) {
                    const properties = this.tmdbService.convertTVToXUIProperties(tmdbSeriesData, firstEpisode.seriesName);
                    // ⚠️ CORREÇÃO: Usar poster_path do TMDB para capa da SÉRIE, não cover_big
                    // poster_path = capa/poster da série
                    // backdrop_path = imagem de fundo da série
                    seriesInfo = {
                      ...seriesInfo,
                      plot: properties.plot || properties.description || '',
                      genre: properties.genre || categoryName,
                      cast: properties.cast || '',
                      rating: properties.rating || 0,
                      director: properties.director || '',
                      release_date: properties.release_date || properties.first_air_date || '',
                      tmdb_id: properties.tmdb_id || undefined,
                      year: properties.year || undefined,
                      episode_run_time: properties.episode_run_time || 45,
                      // ⚠️ CORREÇÃO: Usar movie_image (poster) e cover_big (backdrop) do TMDB
                      cover: properties.movie_image || undefined, // Poster da série
                      cover_big: properties.cover_big || properties.movie_image || undefined, // Backdrop ou poster
                    };
                    logger.debug(`[M3UImporter] Série enriquecida com TMDB: ${firstEpisode.seriesName} (capa: ${seriesInfo.cover ? 'sim' : 'não'})`);
                  }
                }
              } catch (error: any) {
                logger.warn(`[M3UImporter] Erro ao buscar TMDB para série "${firstEpisode.seriesName}" (não crítico):`, error.message);
              }
            }
            
            const seriesId = await this.dbClient.getOrCreateSeries(seriesInfo);
            
            // Armazenar tmdbSeriesData para usar depois em updateSeriesSeasons
            if (tmdbSeriesData && seriesId) {
              tmdbSeriesDataMap.set(seriesId, tmdbSeriesData);
            }
            
            // ⚠️ VALIDAÇÃO CRÍTICA: Verificar se seriesId é válido
            if (!seriesId || seriesId === 0) {
              logger.error(`[M3UImporter] ❌ ERRO CRÍTICO: seriesId inválido para "${firstEpisode.seriesName}"! seriesId = ${seriesId}`);
              errors += episodesInfo.length;
              continue; // Pular esta série se não tiver ID válido
            }
            
            logger.info(`[M3UImporter] ✅ Série criada/encontrada: "${firstEpisode.seriesName}" (ID: ${seriesId})`);
            seriesInserted++;
            
            // PASSO 3: Adicionar série ao bouquet ID=3 (Séries)
            try {
              await this.dbClient.addSeriesToBouquet(3, seriesId); // Sempre usar bouquet ID=3 para séries
            } catch (error: any) {
              logger.warn(`[M3UImporter] Erro ao adicionar série ao bouquet (não crítico):`, error.message);
            }
            
            // Preparar episódios
            let episodesPrepared = 0;
            for (const { episode, item } of episodesInfo) {
              if (!episode) {
                logger.warn(`[M3UImporter] Episódio null/undefined ignorado em "${firstEpisode.seriesName}"`);
                continue;
              }
              
              // ⚠️ VALIDAÇÃO: Garantir que seriesId é válido antes de adicionar
              if (!seriesId || seriesId === 0) {
                logger.error(`[M3UImporter] ❌ ERRO CRÍTICO: Tentando adicionar episódio com seriesId inválido (${seriesId}) para "${firstEpisode.seriesName}"!`);
                continue;
              }
              
              // ⚠️ DEBUG: Logar para verificar se seriesId está correto
              logger.debug(`[M3UImporter] Preparando episódio: "${episode.fullName}" com seriesId = ${seriesId} (série: "${firstEpisode.seriesName}")`);
              
              allEpisodes.push({
                seriesId: seriesId, // ⚠️ CRÍTICO: ID da série em streams_series!
                season: episode.season,
                episode: episode.episode,
                stream_display_name: episode.fullName,
                stream_source: [episode.url],
                stream_icon: episode.logo || undefined,
                category_id: [categoryId],
              });
              episodesPrepared++;
            }
            
            logger.info(`[M3UImporter] Série "${firstEpisode.seriesName}" (ID: ${seriesId}): ${episodesPrepared}/${episodesInfo.length} episódios preparados`);
            
            // ⚠️ CORREÇÃO CRÍTICA: Atualizar progresso via socket APENAS UMA VEZ por série
            // e APENAS se o processo ainda estiver ativo
            const currentProcessState = socketService.getUserProcess(userId);
            if (currentProcessState && 
                currentProcessState.isRunning && 
                !currentProcessState.isCompleted && 
                currentProcessState.status === 'processing' &&
                !currentProcessState.isPaused) {
              // Atualizar apenas uma vez por série (não dentro do loop de episódios)
              socketService.updateUserProcess(userId, {
                currentItem: `Série "${firstEpisode.seriesName}": ${episodesPrepared}/${episodesInfo.length} episódios preparados`,
                message: `Preparando episódios: ${episodesPrepared}/${episodesInfo.length} da série "${firstEpisode.seriesName}"`,
              });
            } else {
              // Processo já terminou ou foi pausado - não atualizar socket
              logger.debug(`[M3UImporter] Processo não está mais ativo (status: ${currentProcessState?.status}, isRunning: ${currentProcessState?.isRunning}, isCompleted: ${currentProcessState?.isCompleted}), pulando atualização de socket`);
            }
          } catch (error: any) {
            logger.error(`[M3UImporter] Erro ao processar série "${firstEpisode.seriesName}":`, error.message);
            errors += episodesInfo.length;
          }
        }
        
        // Inserir todos os episódios em lote
        logger.info(`[M3UImporter] DEBUG: allEpisodes.length = ${allEpisodes.length}, seriesInserted = ${seriesInserted}`);
        
        if (allEpisodes.length > 0) {
          // ⚠️ PAUSE/RESUME/CANCEL: Verificar antes de inserir
          const checkState = socketService.getUserProcess(userId);
          if (!checkState || !checkState.isRunning || checkState.isCompleted) {
            logger.info('[M3UImporter] Processo cancelado antes de inserir episódios');
            throw new Error('Importação cancelada pelo usuário');
          }
          
          logger.info(`[M3UImporter] Inserindo ${allEpisodes.length} episódios...`);
          
          // ⚠️ SOCKET: Atualizar status
          socketService.updateUserProcess(userId, {
            currentItem: `Inserindo ${allEpisodes.length} episódios...`,
          });
          
          const episodesResult = await this.dbClient.bulkInsertEpisodes(allEpisodes, options.batchSize, true);
          
          // ⚠️ SOCKET: Atualizar progresso após inserir episódios
          socketService.updateUserProcess(userId, {
            processedItems: totalItems,
            addedItems: inserted,
            skippedItems: skipped,
            progress: 90,
            currentItem: `${seriesInserted} séries, ${episodesInserted} episódios inseridos`,
          });
          episodesInserted = episodesResult.inserted;
          inserted += episodesInserted;
          errors += episodesResult.errors;
          skipped += episodesResult.skipped || 0;
          
          // Atualizar campo seasons das séries após inserir episódios
          logger.info(`[M3UImporter] Atualizando campo seasons das séries...`);
          
          // Agrupar episódios por série
          const episodesBySeriesId = new Map<number, typeof allEpisodes>();
          for (const ep of allEpisodes) {
            if (!episodesBySeriesId.has(ep.seriesId)) {
              episodesBySeriesId.set(ep.seriesId, []);
            }
            episodesBySeriesId.get(ep.seriesId)!.push(ep);
          }
          
          // Atualizar seasons de cada série (com dados do TMDB se disponível)
          for (const [seriesId, episodes] of episodesBySeriesId) {
            try {
              const tmdbSeriesData = tmdbSeriesDataMap.get(seriesId);
              await this.dbClient.updateSeriesSeasons(seriesId, episodes, tmdbSeriesData);
              logger.debug(`[M3UImporter] Seasons atualizado para série ID ${seriesId} (${episodes.length} episódios${tmdbSeriesData ? ', com dados TMDB' : ''})`);
            } catch (error: any) {
              logger.warn(`[M3UImporter] Erro ao atualizar seasons da série ${seriesId} (não crítico):`, error.message);
            }
          }
          
          logger.info(`[M3UImporter] ✅ ${seriesInserted} séries e ${episodesInserted} episódios importados com sucesso (${errors} erros, ${skipped} duplicados)`);
          
          // VALIDAÇÃO PÓS-IMPORTAÇÃO: Verificar se séries foram adicionadas ao bouquet
          if (seriesInserted > 0) {
            logger.info(`[M3UImporter] 🔍 Validando bouquets de séries após importação...`);
            
            try {
              // Usar conexão existente (dbClient já está conectado)
              const conn = await this.dbClient.connect();
              
              // Buscar bouquet ID=3 (Séries)
              const [bouquetRows] = await conn.query<any[]>(
                `SELECT id, bouquet_name, JSON_LENGTH(COALESCE(bouquet_series, '[]')) as series_count 
                 FROM bouquets WHERE id = 3 LIMIT 1`
              );
              
              if (bouquetRows.length > 0) {
                const bouquet = bouquetRows[0];
                const seriesInBouquet = parseInt(bouquet.series_count || '0');
                
                logger.info(`[M3UImporter] 📊 Validação de Bouquet:`);
                logger.info(`   - Bouquet ID: 3 (${bouquet.bouquet_name || 'Séries'})`);
                logger.info(`   - Séries no bouquet: ${seriesInBouquet}`);
                logger.info(`   - Séries importadas nesta execução: ${seriesInserted}`);
                
                // Nota: seriesInBouquet pode ser maior que seriesInserted se já havia séries no bouquet
                // Por isso, apenas avisamos se houver problema óbvio
                if (seriesInBouquet === 0 && seriesInserted > 0) {
                  logger.error(`[M3UImporter] ❌ ERRO CRÍTICO: Bouquet ID=3 está vazio mas ${seriesInserted} séries foram importadas!`);
                  logger.error(`[M3UImporter] ❌ Verifique se houve erro ao adicionar séries ao bouquet durante a importação.`);
                } else {
                  logger.info(`[M3UImporter] ✅ Validação OK: Bouquet contém ${seriesInBouquet} séries (incluindo ${seriesInserted} novas)`);
                }
              } else {
                logger.error(`[M3UImporter] ❌ ERRO: Bouquet ID=3 não encontrado! Séries foram importadas mas não foram adicionadas ao bouquet.`);
              }
            } catch (validationError: any) {
              logger.error(`[M3UImporter] ❌ Erro na validação pós-importação:`, validationError.message);
              // Não falhar importação por causa da validação
            }
          }
        } else {
          logger.warn(`[M3UImporter] ⚠️ NENHUM EPISÓDIO PARA INSERIR! allEpisodes está vazio!`);
          logger.warn(`[M3UImporter] DEBUG: Processadas ${seriesInserted} séries, mas nenhum episódio foi preparado.`);
        }
      }
      
      // DEPRECATED: Processar séries antigas (se houver)
      if (seriesData.length > 0) {
        logger.warn(`[M3UImporter] ⚠️ ${seriesData.length} séries no formato antigo encontradas (serão ignoradas - use formato com episódios)`);
      }

      // 9.5. Ativar filmes via API do XUI e depois CORRIGIR dados via SQL
      // A API sobrescreve os dados, mas é necessária para o filme aparecer no app
      // Solução: chamar API (ativa), depois SQL (corrige dados)
      if (insertedMoviesMap.size > 0) {
        logger.info(`[M3UImporter] 🔄 FASE 1: Ativando ${insertedMoviesMap.size} filmes via API do XUI...`);
        
        let activatedCount = 0;
        let activationErrors = 0;
        const activateBatchSize = 10;
        const allMoviesToActivate = Array.from(insertedMoviesMap.entries());
        
        // FASE 1: Chamar API apenas com ID para ativar (vai sobrescrever dados)
        for (let i = 0; i < allMoviesToActivate.length; i += activateBatchSize) {
          const batch = allMoviesToActivate.slice(i, i + activateBatchSize);
          
          await Promise.all(batch.map(async ([movieId]) => {
            try {
              await this.apiClient.activateMovie(movieId);
              activatedCount++;
            } catch (error: any) {
              activationErrors++;
            }
          }));
          
          if (i + activateBatchSize < allMoviesToActivate.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        logger.info(`[M3UImporter] ✅ FASE 1: ${activatedCount} filmes ativados (${activationErrors} erros)`);
        
        // FASE 2: Corrigir dados via SQL (restaurar o que a API sobrescreveu)
        logger.info(`[M3UImporter] 🔧 FASE 2: Corrigindo dados via SQL...`);
        let correctedCount = 0;
        
        for (const [movieId, movie] of allMoviesToActivate) {
          try {
            const categoryIdJson = JSON.stringify(movie.category_id || []);
            const streamSourceJson = typeof movie.stream_source === 'string' 
              ? movie.stream_source 
              : JSON.stringify(movie.stream_source || []);
            const moviePropsJson = typeof movie.movie_properties === 'string'
              ? movie.movie_properties
              : JSON.stringify(movie.movie_properties || {});
            const tmdbId = movie.movie_properties?.tmdb_id 
              ? parseInt(String(movie.movie_properties.tmdb_id), 10) 
              : null;
            const rating = movie.movie_properties?.rating
              ? parseFloat(String(movie.movie_properties.rating))
              : null;
            
            await this.dbClient.restoreMovieData(movieId, {
              category_id: categoryIdJson,
              stream_source: streamSourceJson,
              stream_icon: movie.stream_icon || null,
              movie_properties: moviePropsJson,
              tmdb_id: tmdbId,
              rating: rating,
              direct_source: 1,
            });
            correctedCount++;
          } catch (err: any) {
            logger.debug(`[M3UImporter] Erro ao corrigir filme ${movieId}: ${err.message}`);
          }
        }
        
        logger.info(`[M3UImporter] ✅ FASE 2: ${correctedCount}/${insertedMoviesMap.size} filmes corrigidos via SQL`);
      } else if (movieIds.length > 0) {
        logger.warn(`[M3UImporter] ⚠️ ${movieIds.length} filmes inseridos mas sem dados para ativar`);
      }

      // 10. Adicionar filmes ao bouquet se especificado (opcional - não falha se não conseguir)
      // 🔍 DEBUG: Log sobre bouquet
      logger.info(`[M3UImporter] 📦 VERIFICAÇÃO BOUQUET:`);
      logger.info(`[M3UImporter]   - options.bouquetId: ${options.bouquetId}`);
      logger.info(`[M3UImporter]   - movieIds.length: ${movieIds.length}`);
      
      if (options.bouquetId) {
        if (movieIds.length > 0) {
          try {
            await this.dbClient.addMoviesToBouquet(options.bouquetId, movieIds);
            logger.info(`[M3UImporter] ✅ ${movieIds.length} filmes adicionados ao bouquet ${options.bouquetId}`);
          } catch (error: any) {
            logger.warn(`[M3UImporter] ⚠️ Erro ao adicionar filmes ao bouquet (filmes foram inseridos mas não adicionados ao bouquet):`, error.message);
            // Não falhar a importação se o bouquet falhar - os filmes já foram inseridos com sucesso
          }
        } else {
          logger.warn(`[M3UImporter] ⚠️ Bouquet ${options.bouquetId} especificado mas IDs não foram coletados (filmes foram inseridos com sucesso, mas não puderam ser adicionados ao bouquet automaticamente)`);
          logger.info(`[M3UImporter] 💡 Dica: Você pode adicionar os filmes ao bouquet manualmente no XUI`);
        }
      }

      // 11. Desconectar conexões (com proteção para não falhar se já desconectadas)
      try {
        await this.dbClient.disconnect();
      } catch (error: any) {
        logger.warn('[M3UImporter] Erro ao desconectar dbClient (não crítico):', error.message);
      }
      try {
        await this.apiClient.disconnect();
      } catch (error: any) {
        logger.warn('[M3UImporter] Erro ao desconectar apiClient (não crítico):', error.message);
      }

      const duration = Date.now() - startTime;

      const result: ImportResult = {
        total: totalItems,
        movies: filteredMovies.length,
        series: filteredSeries.length,
        inserted,
        errors,
        skipped,
        method: 'mysql', // Sempre MySQL agora
        duration,
      };

      // Log detalhado final
      // Log detalhado final
      const logData: any = {
        total: result.total,
        movies: result.movies,
        series: result.series,
        inserted: result.inserted,
        errors: result.errors,
        skipped: result.skipped,
        duration: `${(duration / 1000).toFixed(2)}s`,
        method: result.method,
      };
      
      if (options.enrichWithTMDB) {
        logData.tmdbEnriched = tmdbEnriched;
        logData.tmdbErrors = tmdbErrors;
      }
      
      logger.info('[M3UImporter] ✅ Importação concluída', logData);

      if (options.disableMarketing) {
        return result;
      }

      // 🎨 MARKETING: Gerar banners automaticamente (assíncrono, não bloqueia)
      if (!options.disableMarketing) {
        (async () => {
          try {
            const importStartTime = new Date(startTime);
            const importVodType = vodType;
            let importedContent: any[] = [];

            const PostImportHookService = (await import('../marketing/post-import-hook.service.js')).default;
            const apiClient = new XUIVodApiClient(this.server);
            const importId = `import_${Date.now()}_${userId || 'system'}`;
      
          
          // Buscar SÉRIES (apenas se importação for de séries ou both)
          // ⚠️ IMPORTANTE: Esta busca retorna apenas SÉRIES (não episódios)
          // Episódios não são armazenados em VODItem (apenas type=3 do XUI, não type=5)
          // Os banners/vídeos gerados serão da SÉRIE como um todo, não de episódios individuais
          if (importVodType === 'series' || importVodType === 'both') {
            logger.info(`[M3UImporter] 🎨 MARKETING: Buscando séries RECÉM-IMPORTADAS do servidor ${this.server.id}...`);
            const vodSeries = await prisma.vODItem.findMany({
              where: {
                serverId: this.server.id,
                vodType: 'series', // Apenas séries (não episódios - type=3 do XUI, não type=5)
                createdAt: {
                  gte: importStartTime, // Apenas itens criados DURANTE esta importação
                },
              },
              include: {
                metadata: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 30,
            });
            logger.info(`[M3UImporter] 🎨 MARKETING: Encontradas ${vodSeries.length} séries recém-importadas`);
          
            for (const item of vodSeries) {
              let synopsis = item.overview || '';
              // ⚠️ CORREÇÃO: rating não existe diretamente em VODItem, usar metadata ou 7.0
              let rating = 7.0;
              let genres: string[] = ['Gênero não informado'];
              let title = item.title || item.streamName || 'Sem título';
              let posterUrl = item.posterUrl || '';
              let backdropUrl = '';
              // ⚠️ CORREÇÃO: year não existe diretamente em VODItem
              let year = '';
              let tmdbId: number | undefined = undefined;
              
              // 🎨 MARKETING FIX: Buscar dados do TMDB diretamente para séries
              // SEMPRE buscar se não tem tmdbId OU se dados estão incompletos
              const needsSeriesData = !tmdbId || (!synopsis || synopsis.length < 20 || synopsis === 'Sinopse indisponível.') || rating === 7.0 || (genres.length === 1 && genres[0] === 'Gênero não informado');
              
              if (needsSeriesData && this.tmdbService) {
                logger.info(`[M3UImporter] 🎨 MARKETING: Buscando dados para série "${title}" (tmdbId atual: ${tmdbId || 'NÃO'})...`);
                try {
                  // Limpar título: remover [Cinema], (Cinema), etc
                  const cleanTitle = title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
                  const yearNum = year ? parseInt(year, 10) : undefined;
                  logger.info(`[M3UImporter] 🎨 MARKETING: Buscando TMDB para série "${cleanTitle}"${yearNum ? ` (${yearNum})` : ''}...`);
                  const tmdbResult = await this.tmdbService.searchTV(cleanTitle, yearNum);
                  if (tmdbResult) {
                    logger.info(`[M3UImporter] 🎨 MARKETING: ✅ TMDB encontrado: ID ${tmdbResult.id}, buscando detalhes...`);
                    const seriesDetails = await this.tmdbService.getTVDetails(tmdbResult.id);
                    if (seriesDetails) {
                      if (!synopsis || synopsis.length < 20 || synopsis === 'Sinopse indisponível.') {
                        synopsis = seriesDetails.overview || synopsis;
                      }
                      if (rating <= 0 || rating === 7.0) {
                        rating = seriesDetails.vote_average && seriesDetails.vote_average > 0 ? seriesDetails.vote_average : rating;
                      }
                      if (genres.length === 0 || (genres.length === 1 && genres[0] === 'Gênero não informado')) {
                        genres = seriesDetails.genres?.map(g => g.name) || genres;
                      }
                      if (!posterUrl && seriesDetails.poster_path) {
                        posterUrl = `https://image.tmdb.org/t/p/w500${seriesDetails.poster_path}`;
                      }
                      if (!backdropUrl && seriesDetails.backdrop_path) {
                        backdropUrl = `https://image.tmdb.org/t/p/w1280${seriesDetails.backdrop_path}`;
                      }
                      if (!year && seriesDetails.first_air_date) {
                        year = seriesDetails.first_air_date.substring(0, 4);
                      }
                      if (!tmdbId) {
                        tmdbId = seriesDetails.id;
                      }
                      logger.info(`[M3UImporter] 🎨 MARKETING: ✅ Dados do TMDB direto para série "${cleanTitle}": Sinopse(${synopsis.length} chars), Rating(${rating}), Gêneros(${genres.length}), TMDB ID: ${tmdbId}`);
                    }
                  } else {
                    logger.warn(`[M3UImporter] 🎨 MARKETING: ⚠️ TMDB não encontrou resultado para série "${cleanTitle}"`);
                  }
                } catch (tmdbError: any) {
                  logger.warn(`[M3UImporter] 🎨 MARKETING: ❌ Erro ao buscar série do TMDB para ${title}:`, tmdbError.message);
                }
              } else if (!this.tmdbService) {
                logger.warn(`[M3UImporter] 🎨 MARKETING: ⚠️ TMDB Service não disponível para séries`);
              }
              
              // Garantir valores mínimos
              if (!synopsis || synopsis.trim().length < 10) {
                synopsis = 'Sinopse indisponível.';
              }
              if (rating <= 0) {
                rating = 7.0;
              }
              if (genres.length === 0) {
                genres = ['Gênero não informado'];
              }
              
              importedContent.push({
                id: item.xuiStreamId,
                title: title,
                type: 'series' as const,
                posterUrl: posterUrl,
                backdropUrl: backdropUrl,
                synopsis: synopsis,
                year: year,
                rating: rating,
                genres: genres,
                tmdbId: tmdbId,
                seasons: undefined,
              });
              }
            }
          
          // Fallback: se não veio nada do banco (ex.: servidor sem espelho local), buscar direto no XUI API
          // ⚠️ CRÍTICO: Respeitar importVodType - não buscar tudo sempre!
          if (importedContent.length === 0) {
            try {
              // Buscar FILMES apenas se importação for de filmes ou both
              if (importVodType === 'movie' || importVodType === 'both') {
                logger.info(`[M3UImporter] 🎨 MARKETING: Fallback - Buscando filmes via API...`);
                const movies = await apiClient.getMovies({ page: 1, perPage: 30 });
                for (const item of movies.items || []) {
                  // ⚠️ CORREÇÃO: XUIMovie não tem name, stream_description, year, rating, duration diretamente
                  // Essas propriedades estão em movie_properties (JSON string) ou não existem
                  importedContent.push({
                    id: item.id,
                    title: item.stream_display_name || 'Sem título',
                    type: 'movie' as const,
                    posterUrl: item.stream_icon || '',
                    backdropUrl: '',
                    synopsis: '', // XUIMovie não tem stream_description
                    year: '', // XUIMovie não tem year diretamente
                    rating: 7.0, // XUIMovie não tem rating diretamente
                    genres: [],
                    duration: undefined, // XUIMovie não tem duration diretamente
                    tmdbId: undefined,
                  });
                }
                logger.info(`[M3UImporter] 🎨 MARKETING: Fallback - ${movies.items?.length || 0} filmes encontrados via API`);
              }
              
              // Buscar SÉRIES apenas se importação for de séries ou both
              if (importVodType === 'series' || importVodType === 'both') {
                logger.info(`[M3UImporter] 🎨 MARKETING: Fallback - Buscando séries via API...`);
                const series = await apiClient.getSeries({ page: 1, perPage: 30 });
                
                // 🔍 DEBUG: Ver estrutura de dados retornada
                if (series.items && series.items.length > 0) {
                  const firstItem = series.items[0];
                  logger.info(`[M3UImporter] 🎨 MARKETING: DEBUG - Keys disponíveis: ${Object.keys(firstItem).join(', ')}`);
                  logger.info(`[M3UImporter] 🎨 MARKETING: DEBUG - Primeira série: ${JSON.stringify(firstItem).substring(0, 300)}`);
                }
                
                for (const item of series.items || []) {
                  // ⚠️ CORREÇÃO: XUISeries só tem title, id, category_id, etc.
                  // Não tem stream_display_name, name, series_name, display_name, stream_name, category_name
                  let title = item.title || '';
                  
                  // 🔍 Se vazio, buscar do banco VODItem
                  if (!title || title.trim().length === 0) {
                    try {
                      const vodItem = await prisma.vODItem.findFirst({
                        where: { 
                          xuiStreamId: item.id,
                          vodType: 'series',
                          serverId: this.server.id,
                        },
                        select: { title: true, streamName: true }
                      });
                      if (vodItem) {
                        title = vodItem.title || vodItem.streamName || '';
                        logger.info(`[M3UImporter] 🎨 MARKETING: Título encontrado no banco VODItem para ID ${item.id}: "${title}"`);
                      }
                    } catch (dbErr: any) {
                      logger.warn(`[M3UImporter] 🎨 MARKETING: Erro ao buscar título do banco para série ID ${item.id}: ${dbErr.message}`);
                    }
                  }
                  
                  // 🔍 Último recurso - usar ID formatado
                  if (!title || title.trim().length === 0) {
                    title = `Série #${item.id}`;
                    logger.warn(`[M3UImporter] 🎨 MARKETING: Usando ID como título para série ${item.id}: "${title}"`);
                  }
                  
                  importedContent.push({
                    id: item.id,
                    title: title,
                    type: 'series' as const,
                    posterUrl: '', // XUISeries não tem stream_icon diretamente
                    backdropUrl: '',
                    synopsis: '', // XUISeries não tem stream_description
                    year: '', // XUISeries não tem year diretamente
                    rating: 7.0, // XUISeries não tem rating diretamente
                    genres: [],
                    tmdbId: undefined,
                    seasons: undefined, // XUISeries não tem num diretamente
                  });
                }
                logger.info(`[M3UImporter] 🎨 MARKETING: Fallback - ${series.items?.length || 0} séries encontradas via API`);
              }
            } catch (apiErr: any) {
              logger.warn('[M3UImporter] Fallback API para banners falhou:', apiErr.message);
            } finally {
              await apiClient.disconnect().catch(() => {});
            }
          } else {
            await apiClient.disconnect().catch(() => {});
          }
          
          // 🔒 FILTRO DE SEGURANÇA: Garantir que só o tipo correto seja processado
          // Isso previne que itens errados sejam coletados por bugs no filtro de data
          if (importVodType === 'series') {
            const beforeFilter = importedContent.length;
            importedContent = importedContent.filter(item => item.type === 'series');
            const afterFilter = importedContent.length;
            if (beforeFilter !== afterFilter) {
              logger.warn(`[M3UImporter] 🎨 MARKETING: ⚠️ Filtro de segurança removeu ${beforeFilter - afterFilter} itens que não eram séries (antes: ${beforeFilter}, depois: ${afterFilter})`);
            }
          } else if (importVodType === 'movie') {
            const beforeFilter = importedContent.length;
            importedContent = importedContent.filter(item => item.type === 'movie');
            const afterFilter = importedContent.length;
            if (beforeFilter !== afterFilter) {
              logger.warn(`[M3UImporter] 🎨 MARKETING: ⚠️ Filtro de segurança removeu ${beforeFilter - afterFilter} itens que não eram filmes (antes: ${beforeFilter}, depois: ${afterFilter})`);
            }
          }
          
          logger.info(`[M3UImporter] 🎨 MARKETING: Total de itens coletados: ${importedContent.length}`);
          if (importedContent.length > 0) {
            logger.info(`[M3UImporter] 🎨 MARKETING: Primeiro item - Título: ${importedContent[0].title}, Rating: ${importedContent[0].rating}, Sinopse (${importedContent[0].synopsis?.length || 0} chars): ${importedContent[0].synopsis?.substring(0, 50) || 'VAZIA'}...`);
            logger.info(`[M3UImporter] 🎨 MARKETING: Chamando PostImportHookService.processImportedContent...`);
            // Passar os IDs corretos:
            // - this.server.id = ID do servidor XUI (tabela xui_servers)
            // - options.serverId = ID do servidor de streaming (tabela servers) - OBRIGATÓRIO para vincular canais
            // - options.bouquetId = ID do bouquet para adicionar canais (padrão: 1)
            const result = await PostImportHookService.processImportedContent(
              importedContent, 
              importId, 
              this.server.id,  // XUI Server ID
              options.serverId,  // Stream Server ID (da tabela servers)
              options.bouquetId || 1  // Bouquet ID (padrão: 1)
            );
            const videoInfo = result.videoPaths 
              ? `Filmes: ${result.videoPaths.movies ? '✅' : '❌'}, Séries: ${result.videoPaths.series ? '✅' : '❌'}`
              : 'NENHUM';
            logger.info(`[M3UImporter] 🎨 MARKETING: Resultado - Banners gerados: ${result.bannersGenerated}, Vídeos: ${videoInfo}, Sucesso: ${result.success}, Erro: ${result.error || 'NENHUM'}`);
          } else {
            logger.warn('[M3UImporter] 🎨 MARKETING: NENHUM item encontrado para gerar banners/vídeo!');
          }
        } catch (error: any) {
          logger.error('[M3UImporter] ❌ ERRO ao gerar banners de marketing:', {
            message: error.message,
            stack: error.stack,
            error: error
          });
          // Não falhar a importação por causa do marketing
        }
        })();
      }
      
      return result;
    } catch (error: any) {
      logger.error('[M3UImporter] Erro na importação:', error.message);
      
      // ⚠️ SOCKET: Marcar como erro
      socketService.updateUserProcess(userId, {
        status: 'error',
        error: error.message || 'Erro desconhecido',
      });
      
      await this.dbClient.disconnect().catch(() => {});
      await this.apiClient.disconnect().catch(() => {});
      throw error;
    }
  }

  /**
   * Limpa e reimporta tudo
   */
  async clearAndReimport(m3uUrl: string, options: ImportOptions = {}): Promise<ImportResult> {
    return this.importFromM3U(m3uUrl, {
      ...options,
      clearBeforeImport: true,
    });
  }
}


