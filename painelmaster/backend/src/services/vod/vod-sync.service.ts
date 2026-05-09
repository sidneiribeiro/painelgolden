/**
 * Serviço de sincronização de VOD (Filmes e Séries) do XUI
 * Lê streams VOD do banco XUI e sincroniza com tabela VODItem
 */

import mysql, { Connection } from 'mysql2/promise';
import { createLogger } from '../../utils/logger.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('VODSyncService');

export interface XUIStream {
  id: number;
  type: number; // 2 = VOD Movie, 3 = VOD Series
  category_id: string; // JSON array: "[1,2,3]"
  stream_display_name: string;
  stream_source: string; // JSON array: '["url1", "url2"]'
  stream_icon: string | null;
  added: number; // Unix timestamp
}

export interface SyncResult {
  totalFound: number;
  moviesFound: number;
  seriesFound: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsRemoved: number;
  errors: string[];
}

export class VODSyncService {
  private server: XuiServer;

  constructor(server: XuiServer) {
    this.server = server;
  }

  /**
   * Sincroniza streams VOD do XUI com a tabela VODItem
   */
  async syncVODItems(): Promise<SyncResult> {
    logger.info('[VODSync] Iniciando sincronização de VOD...', { 
      serverId: this.server.id,
      serverName: this.server.name,
      dbHost: this.server.dbHost || 'não configurado',
      dbUser: this.server.dbUser || 'não configurado',
    });

    // Validar configurações básicas (mas não bloquear se tiver baseUrl para fallback)
    if (!this.server.dbHost && !this.server.baseUrl) {
      throw new Error(
        'Configurações de banco de dados do XUI não estão completas. ' +
        'Configure dbHost ou baseUrl nas configurações do servidor XUI.'
      );
    }

    let connection: Connection | null = null;

    try {
      connection = await this.connectToDatabase();

      // Buscar todos os streams VOD (type 2 = movie, type 3 = series)
      const [streams] = await connection.query(
        `SELECT 
          id, 
          type, 
          category_id, 
          stream_display_name, 
          stream_source, 
          stream_icon, 
          added
        FROM streams 
        WHERE type IN (2, 3)
        ORDER BY id`
      ) as any[];

      logger.info(`[VODSync] ${streams.length} streams VOD encontrados no XUI`);

      const result: SyncResult = {
        totalFound: streams.length,
        moviesFound: 0,
        seriesFound: 0,
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsRemoved: 0,
        errors: [],
      };

      // Detectar nome da tabela de categorias (XUI ONE vs Xtream UI)
      let catTable = 'streams_categories';
      for (const t of ['streams_categories', 'stream_categories']) {
        const [exists] = await connection.query(`SHOW TABLES LIKE '${t}'`);
        if ((exists as any[]).length > 0) { catTable = t; break; }
      }

      // Buscar categorias para mapear IDs para nomes
      const [categories] = await connection.query(
        `SELECT id, category_name FROM ${catTable} WHERE category_type IN (?, ?)`,
        ['vod', 'series']
      ) as any[];

      const categoryMap = new Map<number, string>();
      categories.forEach((cat: any) => {
        categoryMap.set(cat.id, cat.category_name);
      });

      // Importar Prisma para operações no banco
      const { prisma } = await import('../../config/database.js');

      // Buscar TODOS os VODItems existentes (xuiStreamId é único globalmente)
      // Criar um Map para lookup rápido: xuiStreamId -> { id, serverId }
      const allExistingItems = await prisma.vODItem.findMany({
        select: { xuiStreamId: true, id: true, serverId: true },
      });

      const existingItemsMap = new Map<number, { id: string; serverId: string }>();
      allExistingItems.forEach(item => {
        existingItemsMap.set(item.xuiStreamId, { id: item.id, serverId: item.serverId });
      });

      // Para remoção de itens deletados do servidor atual
      const existingStreamIds = new Set(
        allExistingItems
          .filter(item => item.serverId === this.server.id)
          .map(item => item.xuiStreamId)
      );
      const processedStreamIds = new Set<number>();

      // Processar cada stream
      let processedCount = 0;
      const totalStreams = streams.length;
      
      for (const stream of streams) {
        try {
          processedStreamIds.add(stream.id);
          processedCount++;

          // Log de progresso a cada 1000 itens
          if (processedCount % 1000 === 0) {
            logger.info(`[VODSync] Progresso: ${processedCount}/${totalStreams} streams processados (${Math.round((processedCount / totalStreams) * 100)}%)`);
          }

          const vodType = stream.type === 2 ? 'movie' : 'series';
          if (vodType === 'movie') {
            result.moviesFound++;
          } else {
            result.seriesFound++;
          }

          // Parsear category_id (formato JSON: "[1,2,3]")
          let categoryIds: number[] = [];
          let categoryName: string | null = null;
          try {
            categoryIds = JSON.parse(stream.category_id || '[]');
            if (categoryIds.length > 0) {
              categoryName = categoryMap.get(categoryIds[0]) || null;
            }
          } catch {
            // Ignorar erro de parse
          }

          // Parsear stream_source (formato JSON: '["url1", "url2"]')
          let streamUrls: string[] = [];
          try {
            streamUrls = JSON.parse(stream.stream_source || '[]');
          } catch {
            // Ignorar erro de parse
          }

          const streamUrl = streamUrls[0] || '';

          const itemData = {
            serverId: this.server.id,
            xuiStreamId: stream.id,
            streamName: stream.stream_display_name,
            streamUrl,
            categoryId: categoryIds.length > 0 ? categoryIds[0] : null,
            categoryName,
            vodType,
            title: stream.stream_display_name, // Título inicial é o nome do stream
            originalTitle: stream.stream_display_name,
          };

          // Verificar se já existe usando o Map (muito mais rápido que findUnique)
          const existingItem = existingItemsMap.get(stream.id);

          if (existingItem) {
            // Atualizar item existente
            await prisma.vODItem.update({
              where: { id: existingItem.id },
              data: {
                ...itemData,
                updatedAt: new Date(),
              },
            });
            result.itemsUpdated++;
            // Atualizar o Map caso o serverId tenha mudado
            existingItemsMap.set(stream.id, { id: existingItem.id, serverId: this.server.id });
          } else {
            // Criar novo item
            const newItem = await prisma.vODItem.create({
              data: itemData,
            });
            result.itemsCreated++;
            // Adicionar ao Map
            existingItemsMap.set(stream.id, { id: newItem.id, serverId: this.server.id });
          }
        } catch (error: any) {
          const errorMsg = error.message || 'Erro desconhecido';
          const errorStack = error.stack || '';
          const streamVodType = stream.type === 2 ? 'movie' : 'series';
          logger.error(`[VODSync] Erro ao processar stream ${stream.id} (${streamVodType}):`, {
            streamId: stream.id,
            streamName: stream.stream_display_name,
            vodType: streamVodType,
            error: errorMsg,
            stack: errorStack,
            code: error.code,
          });
          result.errors.push(`Stream ${stream.id} (${stream.stream_display_name}): ${errorMsg}`);
          
          // Se muitos erros, pode ser um problema geral
          if (result.errors.length > 100) {
            logger.error(`[VODSync] Muitos erros detectados (${result.errors.length}). Parando processamento.`);
            throw new Error(`Muitos erros durante sincronização (${result.errors.length}). Primeiro erro: ${result.errors[0]}`);
          }
        }
      }

      // Remover itens que não existem mais no XUI
      const removedStreamIds = Array.from(existingStreamIds).filter(
        id => !processedStreamIds.has(id)
      );

      if (removedStreamIds.length > 0) {
        await prisma.vODItem.deleteMany({
          where: {
            serverId: this.server.id,
            xuiStreamId: { in: removedStreamIds },
          },
        });
        result.itemsRemoved = removedStreamIds.length;
      }

      logger.info('[VODSync] Sincronização concluída', {
        ...result,
        errorCount: result.errors.length,
      });

      // Se houver muitos erros, logar alguns exemplos
      if (result.errors.length > 0) {
        logger.warn(`[VODSync] ${result.errors.length} erros durante sincronização. Primeiros 5 erros:`, result.errors.slice(0, 5));
      }

      return result;
    } catch (error: any) {
      logger.error('[VODSync] Erro na sincronização:', error.message);
      throw error;
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  /**
   * Conecta no banco MySQL do XUI
   */
  private async connectToDatabase(): Promise<Connection> {
    let dbHost = this.server.dbHost;
    let dbPort = this.server.dbPort || 3306;
    let dbUser = this.server.dbUser;
    let dbPass = this.server.dbPassword;
    let dbName = this.server.dbName || 'xui';

    // Fallback: Extrair host da baseUrl se não configurado
    if (!dbHost) {
      try {
        const url = new URL(this.server.baseUrl);
        dbHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' 
          ? 'localhost' 
          : url.hostname;
      } catch {
        dbHost = 'localhost';
      }
    }

    // Se ainda não tiver credenciais, usar valores padrão (compatibilidade)
    if (!dbUser) {
      dbUser = 'koffice_user';
    }

    // Lógica de senha EXATAMENTE como XUIDBClient
    if (!dbPass) {
      // Tentar descriptografar se existir, senão usar padrão
      dbPass = 'senha_segura'; // Fallback temporário
    } else {
      // Descriptografar senha se estiver criptografada
      try {
        const { decrypt } = await import('../../utils/crypto.js');
        dbPass = decrypt(dbPass);
      } catch (e) {
        // Se falhar, usar como está (pode já estar descriptografado em dev)
        logger.warn('[VODSync] Erro ao descriptografar senha do banco, usando como está');
      }
    }

    if (!dbHost) {
      throw new Error('Host do banco de dados não configurado. Configure dbHost nas configurações do servidor XUI.');
    }

    if (!dbUser) {
      throw new Error('Usuário do banco de dados não configurado. Configure dbUser nas configurações do servidor XUI.');
    }

    const config = {
      host: dbHost,
      port: 3306, // Hardcoded como XUIDBClient
      user: dbUser,
      password: dbPass,
      database: dbName,
      connectTimeout: 10000, // Mesmo timeout do XUIDBClient
    };

    logger.info('[VODSync] Conectando ao banco XUI...', { host: config.host });

    try {
      const connection = await mysql.createConnection(config);
      logger.info('[VODSync] Conectado ao banco XUI com sucesso');
      return connection;
    } catch (error: any) {
      logger.error('[VODSync] Erro ao conectar ao banco:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        host: config.host,
        port: config.port,
        user: config.user,
      });
      
      // Mensagens de erro mais específicas
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        throw new Error(
          `Não foi possível conectar ao banco XUI em ${config.host}:${config.port}. ` +
          `Verifique se: 1) O servidor MySQL está rodando, 2) O IP está correto, ` +
          `3) O firewall permite conexões na porta ${config.port}, 4) O MySQL permite conexões remotas.`
        );
      } else if (error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_ACCESS_DENIED_ERROR_WITH_PASSWORD') {
        throw new Error(
          `Acesso negado ao banco XUI. Verifique se o usuário "${config.user}" e a senha estão corretos.`
        );
      } else if (error.code === 'ER_BAD_DB_ERROR') {
        throw new Error(
          `O banco de dados "${config.database}" não existe. Verifique se o nome do banco está correto.`
        );
      } else {
        throw new Error(
          `Erro ao conectar ao banco XUI: ${error.message} (código: ${error.code || 'desconhecido'})`
        );
      }
    }
  }
}

