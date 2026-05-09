/**
 * Serviço de importação de canais LIVE a partir de M3U
 * 
 * Fluxo:
 * 1. Parse do M3U
 * 2. Classificação de canais por categoria
 * 3. Criação de categorias no XUI (se não existirem)
 * 4. Importação em massa dos canais
 * 5. Adicionar canais ao bouquet
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import type { XuiServer } from '@prisma/client';
import { XUIVodDBClient, type LiveChannelData } from '../vod/xui-vod-db.client.js';
import { createLogger } from '../../utils/logger.js';
import { socketService } from '../socket.service.js';

const logger = createLogger('LiveImporterService');

interface M3UChannelInfo {
  name: string;
  url: string;
  logo?: string;
  groupTitle?: string;
  tvgId?: string;
  tvgName?: string;
  epgChannelId?: string;
}

interface CategoryMapping {
  m3uCategory: string;
  xuiCategoryId?: number;
  xuiCategoryName?: string;
  action: 'map' | 'create' | 'ignore';
  newCategoryName?: string;
  importCategory?: boolean;
}

interface ImportOptions {
  directSource?: number;        // 1 = URL direta, 0 = transcoded
  directProxy?: number;         // 0 = desabilitado, 1 = habilitado
  enableTranscode?: number;     // 0 = desabilitado, 1 = habilitado
  streamAll?: number;           // 0 = desabilitado, 1 = habilitado
  serverId?: number;            // ID do servidor na tabela 'servers'
  importMode?: 'direct' | 'ondemand'; // Modo de importação
}

export class LiveImporterService {
  private xuiClient: XUIVodDBClient;

  constructor(private server: XuiServer) {
    this.xuiClient = new XUIVodDBClient(server);
  }

  /**
   * Parse M3U e extrai informações dos canais LIVE
   */
  private async parseM3U(m3uUrlOrPath: string): Promise<M3UChannelInfo[]> {
    logger.info(`[LiveImporter] Iniciando parse do M3U: ${m3uUrlOrPath}`);

    let m3uContent: string;

    // Verificar se é URL ou caminho local
    if (m3uUrlOrPath.startsWith('http://') || m3uUrlOrPath.startsWith('https://')) {
      logger.info('[LiveImporter] Baixando M3U da URL...');
      const response = await axios.get(m3uUrlOrPath, { timeout: 30000 });
      m3uContent = response.data;
    } else {
      logger.info('[LiveImporter] Lendo M3U do arquivo local...');
      m3uContent = fs.readFileSync(m3uUrlOrPath, 'utf-8');
    }

    const lines = m3uContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const channels: M3UChannelInfo[] = [];

    let currentInfo: Partial<M3UChannelInfo> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTINF:')) {
        // Parse da linha EXTINF
        // Formato: #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Nome do Canal
        
        const nameMatch = line.match(/,(.+)$/);
        let name = nameMatch ? nameMatch[1].trim() : 'Canal Sem Nome';
        
        // Limpar nome: remover informações extras que podem vir no M3U
        // Exemplo: "24H Eu, a Patroa e as Crianças" tvg-logo="..." group-title="...",24H Eu, a Patroa e as Crianças
        // Deve resultar apenas em: "24H Eu, a Patroa e as Crianças"
        name = name.split('"')[0].trim(); // Remove tudo após primeira aspas (se houver)
        name = name.split(' tvg-')[0].trim(); // Remove tags tvg- que podem estar no nome
        name = name.split(' group-title')[0].trim(); // Remove group-title que pode estar no nome

        const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
        const tvgId = tvgIdMatch ? tvgIdMatch[1] : undefined;

        const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
        const tvgName = tvgNameMatch ? tvgNameMatch[1] : undefined;

        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        const logo = logoMatch ? logoMatch[1] : undefined;

        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const groupTitle = groupMatch ? groupMatch[1] : 'Sem Categoria';

        currentInfo = {
          name,
          logo,
          groupTitle,
          tvgId,
          tvgName,
          epgChannelId: tvgId, // Por padrão, usar tvg-id como epg_channel_id
        };
      } else if (!line.startsWith('#') && currentInfo.name) {
        // Linha de URL
        currentInfo.url = line;

        channels.push(currentInfo as M3UChannelInfo);
        currentInfo = {};
      }
    }

    logger.info(`[LiveImporter] Parse concluído: ${channels.length} canais encontrados`);

    // Log de categorias detectadas
    const categories = new Set(channels.map(ch => ch.groupTitle || 'Sem Categoria'));
    logger.info(`[LiveImporter] Categorias detectadas: ${categories.size}`);
    categories.forEach(cat => {
      const count = channels.filter(ch => (ch.groupTitle || 'Sem Categoria') === cat).length;
      logger.info(`  - ${cat}: ${count} canais`);
    });

    return channels;
  }

  /**
   * Agrupa canais por categoria M3U
   */
  private groupByCategory(channels: M3UChannelInfo[]): Map<string, M3UChannelInfo[]> {
    const grouped = new Map<string, M3UChannelInfo[]>();

    for (const channel of channels) {
      const category = channel.groupTitle || 'Sem Categoria';
      
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }

      grouped.get(category)!.push(channel);
    }

    return grouped;
  }

  /**
   * Cria ou busca categorias no XUI
   * @returns Map de categoria M3U -> ID da categoria no XUI
   */
  private async createOrGetCategories(categoryNames: string[]): Promise<Map<string, number>> {
    const categoryMap = new Map<string, number>();

    for (const categoryName of categoryNames) {
      try {
        // Verificar se categoria já existe
        const existingCategory = await this.xuiClient.findCategoryByName(categoryName, 'live');
        
        if (existingCategory) {
          categoryMap.set(categoryName, existingCategory.id);
          logger.debug(`[LiveImporter] Categoria existente: "${categoryName}" (ID: ${existingCategory.id})`);
        } else {
          // Criar nova categoria
          const newCategory = await this.xuiClient.createCategory({
            category_name: categoryName,
            category_type: 'live', // Tipo para canais LIVE
            parent_id: 0,
          });

          categoryMap.set(categoryName, newCategory.id);
          logger.info(`[LiveImporter] ✅ Categoria criada: "${categoryName}" (ID: ${newCategory.id})`);
        }
      } catch (error: any) {
        logger.error(`[LiveImporter] Erro ao criar/buscar categoria "${categoryName}":`, error.message);
        // Usar categoria padrão ID=1 em caso de erro
        categoryMap.set(categoryName, 1);
      }
    }

    return categoryMap;
  }

  /**
   * Importa canais LIVE de um M3U para o XUI
   * @param m3uUrlOrPath URL ou caminho do arquivo M3U
   * @param categoryMappings Mapeamento de categorias M3U -> XUI (opcional)
   * @param bouquetId ID do bouquet para adicionar os canais (padrão: 1)
   * @param userId ID do usuário que iniciou a importação (para Socket.io)
   */
  async importFromM3U(
    m3uUrlOrPath: string,
    categoryMappings: CategoryMapping[] = [],
    bouquetId: number = 1,
    userId: string,
    options: ImportOptions = {}
  ): Promise<{ success: boolean; imported: number; errors: number; skipped: number }> {
    try {
      logger.info(`[LiveImporter] 🚀 Iniciando importação de canais LIVE`);
      
      // 1. Parse do M3U
      socketService.updateUserProcess(userId, {
        status: 'processing',
        progress: 5,
        currentItem: 'Analisando arquivo M3U...',
      });

      const channels = await this.parseM3U(m3uUrlOrPath);

      if (channels.length === 0) {
        throw new Error('Nenhum canal encontrado no M3U');
      }

      socketService.updateUserProcess(userId, {
        status: 'processing',
        progress: 10,
        currentItem: `${channels.length} canais encontrados. Criando categorias...`,
        totalItems: channels.length,
        processedItems: 0,
      });

      // 2. Agrupar por categoria
      const groupedChannels = this.groupByCategory(channels);
      const allCategoryNames = Array.from(groupedChannels.keys());

      // 3. Filtrar categorias selecionadas (se houver)
      const selectedCategories = new Set<string>();
      if (categoryMappings && categoryMappings.length > 0) {
        for (const mapping of categoryMappings) {
          if (mapping.action !== 'ignore') {
            selectedCategories.add(mapping.m3uCategory);
          }
        }
      }

      // Se houver categorias selecionadas, filtrar canais
      let channelsToImport = channels;
      if (selectedCategories.size > 0) {
        channelsToImport = channels.filter(ch => {
          const category = ch.groupTitle || 'Sem Categoria';
          return selectedCategories.has(category);
        });
        logger.info(`[LiveImporter] Filtrando canais: ${channelsToImport.length} de ${channels.length} (${selectedCategories.size} categorias selecionadas)`);
      }

      // 4. Determinar quais categorias criar (APENAS as selecionadas!)
      const categoriesToCreate = selectedCategories.size > 0 
        ? Array.from(selectedCategories) 
        : allCategoryNames; // Se nenhuma selecionada, criar todas

      logger.info(`[LiveImporter] Criando ${categoriesToCreate.length} categorias (de ${allCategoryNames.length} detectadas)`);

      // 5. Criar/buscar categorias no XUI (APENAS as selecionadas!)
      socketService.updateUserProcess(userId, {
        status: 'processing',
        progress: 15,
        currentItem: `Criando ${categoriesToCreate.length} categorias...`,
      });

      const categoryMap = await this.createOrGetCategories(categoriesToCreate);

      // Aplicar mapeamentos customizados (se houver)
      for (const mapping of categoryMappings) {
        if (mapping.action === 'map' && mapping.xuiCategoryId) {
          categoryMap.set(mapping.m3uCategory, mapping.xuiCategoryId);
        } else if (mapping.action === 'create' && mapping.xuiCategoryId) {
          categoryMap.set(mapping.m3uCategory, mapping.xuiCategoryId);
        }
      }

      // 6. Preparar dados para inserção
      socketService.updateUserProcess(userId, {
        status: 'processing',
        progress: 20,
        currentItem: 'Preparando canais para importação...',
      });

      const channelsData: LiveChannelData[] = [];

      for (const channel of channelsToImport) {
        const category = channel.groupTitle || 'Sem Categoria';
        const categoryId = categoryMap.get(category) || 1;

        // Aplicar configurações baseadas no modo de importação
        let directSource: number;
        let directProxy: number;
        let enableTranscode: number;
        let streamAll: number;
        let genTimestamps: number;
        let probesizeOndemand: number;

        if (options.importMode === 'ondemand') {
          // Modo On-Demand (baseado em canais que funcionam no XUI):
          // - direct_source = 0 (não é URL direta)
          // - direct_proxy = 0 (desabilitado - OBRIGATÓRIO para funcionar!)
          // - enable_transcode = 0 (desabilitado - OBRIGATÓRIO para funcionar!)
          // - gen_timestamps = 1 (Generate PTS - OBRIGATÓRIO!)
          // - probesize_ondemand = 500000
          // - Servidor selecionado em Server Tree (tabela streams_servers)
          directSource = 0;
          directProxy = 0;  // CORRIGIDO: era 1, deve ser 0!
          enableTranscode = 0;  // CORRIGIDO: era 1, deve ser 0!
          streamAll = 0;
          genTimestamps = 1;
          probesizeOndemand = 500000;
        } else {
          // Modo Direct:
          // - direct_source = 1 (URL direta)
          // - direct_proxy = 0 (desabilitado)
          // - Permite customização manual se fornecido
          directSource = options.directSource !== undefined ? options.directSource : 1;
          directProxy = options.directProxy !== undefined ? options.directProxy : 0;  // CORRIGIDO: era 1
          enableTranscode = options.enableTranscode !== undefined ? options.enableTranscode : 0;
          streamAll = options.streamAll !== undefined ? options.streamAll : 0;
          genTimestamps = 1; // Sempre ativado para funcionar
          probesizeOndemand = 128000; // Valor padrão para direct
        }

        channelsData.push({
          stream_display_name: channel.name,
          stream_source: [channel.url],
          stream_icon: channel.logo,
          category_id: [categoryId],
          // target_container removido - deve ser null para funcionar!
          direct_source: directSource,
          direct_proxy: directProxy,
          read_native: 0, // OBRIGATÓRIO para aparecer no XUI
          enable_transcode: enableTranscode,
          stream_all: streamAll,
          gen_timestamps: genTimestamps,
          probesize_ondemand: probesizeOndemand,
        });
      }

      // 7. Importação em massa
      logger.info(`[LiveImporter] Importando ${channelsData.length} canais...`);

      let totalImported = 0;
      const batchSize = 500; // Lotes menores para LIVE (mais rápido)

      for (let i = 0; i < channelsData.length; i += batchSize) {
        const batch = channelsData.slice(i, i + batchSize);
        const progress = 20 + Math.floor((i / channelsData.length) * 70); // 20% a 90%

        const onDemandMode = options.importMode === 'ondemand';
        const result = await this.xuiClient.bulkInsertLiveChannels(batch, batchSize, true, options.serverId, onDemandMode);
        totalImported += result.inserted;

        socketService.updateUserProcess(userId, {
          status: 'processing',
          progress,
          currentItem: `Importando canais: ${totalImported}/${channelsData.length} (${result.inserted} inseridos, ${result.errors} erros, ${result.skipped} duplicados)...`,
          totalItems: channelsData.length,
          processedItems: totalImported,
          addedItems: totalImported,
          skippedItems: result.skipped || 0,
        });

        // Adicionar ao bouquet se IDs foram coletados
        if (result.insertedIds.length > 0 && bouquetId > 0) {
          try {
            await this.xuiClient.addChannelsToBouquet(bouquetId, result.insertedIds);
          } catch (error: any) {
            logger.warn(`[LiveImporter] Erro ao adicionar canais ao bouquet (não crítico):`, error.message);
          }
        }
      }

      // 6. Finalização
      await this.xuiClient.disconnect();

      socketService.updateUserProcess(userId, {
        status: 'completed',
        progress: 100,
        currentItem: `✅ Importação concluída: ${totalImported} canais importados!`,
        totalItems: channelsData.length,
        processedItems: totalImported,
        addedItems: totalImported,
      });

      logger.info(`[LiveImporter] ✅ Importação concluída: ${totalImported} canais importados`);

      return {
        success: true,
        imported: totalImported,
        errors: 0,
        skipped: channelsData.length - totalImported,
      };
    } catch (error: any) {
      logger.error('[LiveImporter] ❌ Erro na importação:', error.message);

      socketService.updateUserProcess(userId, {
        status: 'error',
        progress: 0,
        error: `Erro ao importar: ${error.message}`,
      });

      return {
        success: false,
        imported: 0,
        errors: 1,
        skipped: 0,
      };
    }
  }

  /**
   * Retorna lista de categorias detectadas no M3U (sem importar)
   */
  async getM3UCategories(m3uUrlOrPath: string): Promise<{ name: string; count: number }[]> {
    try {
      const channels = await this.parseM3U(m3uUrlOrPath);
      const grouped = this.groupByCategory(channels);

      const categories: { name: string; count: number }[] = [];

      for (const [name, channelList] of grouped.entries()) {
        categories.push({
          name,
          count: channelList.length,
        });
      }

      return categories.sort((a, b) => b.count - a.count);
    } catch (error: any) {
      logger.error('[LiveImporter] Erro ao analisar categorias do M3U:', error.message);
      throw error;
    }
  }
}

