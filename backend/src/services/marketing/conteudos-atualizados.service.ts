import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import { XUIVodDBClient, LiveChannelData } from '../vod/xui-vod-db.client.js';
import { decryptApiKey } from '../../controllers/xuiSettings.controller.js';
import axios from 'axios';
import { env } from '../../config/env.js';

const logger = createLogger('ConteudosAtualizados');

export class ConteudosAtualizadosService {
  private readonly CATEGORY_NAME = 'Conteúdos Atualizados';
  // ✅ Nomes dos canais (mantidos como originalmente)
  private readonly CHANNEL_MOVIES = 'Filmes Adicionados';
  private readonly CHANNEL_SERIES = 'Séries Atualizadas';

  /**
   * Cria ou atualiza a categoria e canais de "Conteúdos Atualizados"
   * @param videoPaths URLs dos vídeos gerados (movies e/ou series)
   * @param xuiServerId ID do servidor XUI (tabela xui_servers) - OBRIGATÓRIO
   * @param streamServerId ID do servidor de streaming (tabela servers) - OBRIGATÓRIO para vincular canais
   * @param bouquetId ID do bouquet para adicionar canais (IGNORADO - sempre usa bouquet "Canais" = 1)
   */
  async createOrUpdateChannels(
    videoPaths: { movies?: string; series?: string },
    xuiServerId?: string,  // ID do servidor XUI
    streamServerId?: number,  // ID do servidor de streaming (tabela servers)
    bouquetId?: number  // IGNORADO - sempre usa bouquet "Canais" (ID 1)
  ): Promise<{ success: boolean; categoryId?: number; channelsCreated?: number; error?: string }> {
    try {
      // 1. Buscar servidor XUI (OBRIGATÓRIO)
      if (!xuiServerId) {
        logger.error('[ConteudosAtualizados] xuiServerId é obrigatório!');
        return { success: false, error: 'xuiServerId é obrigatório' };
      }

      const server = await prisma.xuiServer.findUnique({ where: { id: xuiServerId } });

      if (!server) {
        logger.error(`[ConteudosAtualizados] Servidor XUI não encontrado: ${xuiServerId}`);
        return { success: false, error: `Servidor XUI não encontrado: ${xuiServerId}` };
      }

      logger.info(`[ConteudosAtualizados] Usando servidor XUI: ${server.name} (ID: ${server.id})`);
      
      if (!streamServerId) {
        logger.warn(`[ConteudosAtualizados] ⚠️ streamServerId não fornecido! Canais serão criados mas NÃO serão vinculados ao servidor de streaming.`);
      } else {
        logger.info(`[ConteudosAtualizados] Stream Server ID: ${streamServerId} (canais serão vinculados)`);
      }

      // 2. Criar cliente XUI e obter conexão
      const xuiClient = new XUIVodDBClient(server);
      const conn = await xuiClient.connect();

      try {
      // 3. Criar ou buscar categoria "Conteúdos Atualizados"
      let categoryId: number;
      const existingCategory = await xuiClient.findCategoryByName(this.CATEGORY_NAME, 'live');
      
      if (existingCategory) {
        categoryId = existingCategory.id;
        logger.info(`[ConteudosAtualizados] Categoria já existe: ${this.CATEGORY_NAME} (ID: ${categoryId})`);
      } else {
        const newCategory = await xuiClient.createCategory({
          category_name: this.CATEGORY_NAME,
          category_type: 'live',
        });
        categoryId = newCategory.id;
        logger.info(`[ConteudosAtualizados] Categoria criada: ${this.CATEGORY_NAME} (ID: ${categoryId})`);
      }

      // 4. Construir URLs públicas dos vídeos
      const apiUrl = env.API_URL || 'http://localhost:3001';
      const baseUrl = apiUrl.replace(/\/$/, '');

        // 5. ✅ OTIMIZAÇÃO: Verificar se canais já existem e atualizar ao invés de deletar/recriar
        // Isso mantém o histórico do canal e evita problemas de cache do XUI
        const channelsToCreate: LiveChannelData[] = [];
        const channelsToUpdate: { id: number; newUrl: string; name: string }[] = [];

        // 6. Canal de Filmes (verificar se existe ou criar novo)
      if (videoPaths.movies) {
        const movieUrl = this.buildVideoUrl(videoPaths.movies, baseUrl);
          const existingMovieChannel = await this.findChannelByName(conn, categoryId, this.CHANNEL_MOVIES);
        
        if (existingMovieChannel) {
          // Canal já existe - apenas atualizar URL
          channelsToUpdate.push({
            id: existingMovieChannel.id,
            newUrl: movieUrl,
            name: this.CHANNEL_MOVIES
          });
          logger.info(`[ConteudosAtualizados] ♻️ Canal de filmes JÁ EXISTE (ID: ${existingMovieChannel.id}) - apenas atualizando URL`);
        } else {
          // Canal não existe - criar novo
          channelsToCreate.push({
          stream_display_name: this.CHANNEL_MOVIES,
          stream_source: [movieUrl],
          category_id: [categoryId],
          // target_container removido - deve ser null para funcionar!
          direct_source: 0, // 0 = On-Demand
          read_native: 0, // OBRIGATÓRIO para aparecer no XUI
          direct_proxy: 0, // 0 = desabilitado (OBRIGATÓRIO para funcionar!)
          enable_transcode: 0, // 0 = desabilitado (OBRIGATÓRIO para funcionar!)
          stream_all: 1, // 1 = Start Stream Now
          gen_timestamps: 1, // CRÍTICO: Gerar PTS para play azul
          probesize_ondemand: 500000, // Para On-Demand
        });
          logger.info(`[ConteudosAtualizados] ✨ Canal de filmes NÃO EXISTE - criando novo`);
        }
        logger.info(`[ConteudosAtualizados] Canal de filmes: "${this.CHANNEL_MOVIES}" → ${movieUrl}`);
      }

        // 7. Canal de Séries (verificar se existe ou criar novo)
      if (videoPaths.series) {
        const seriesUrl = this.buildVideoUrl(videoPaths.series, baseUrl);
          const existingSeriesChannel = await this.findChannelByName(conn, categoryId, this.CHANNEL_SERIES);
        
        if (existingSeriesChannel) {
          // Canal já existe - apenas atualizar URL
          channelsToUpdate.push({
            id: existingSeriesChannel.id,
            newUrl: seriesUrl,
            name: this.CHANNEL_SERIES
          });
          logger.info(`[ConteudosAtualizados] ♻️ Canal de séries JÁ EXISTE (ID: ${existingSeriesChannel.id}) - apenas atualizando URL`);
        } else {
          // Canal não existe - criar novo
          channelsToCreate.push({
          stream_display_name: this.CHANNEL_SERIES,
          stream_source: [seriesUrl],
          category_id: [categoryId],
          // target_container removido - deve ser null para funcionar!
          direct_source: 0, // 0 = On-Demand
          read_native: 0, // OBRIGATÓRIO para aparecer no XUI
          direct_proxy: 0, // 0 = desabilitado (OBRIGATÓRIO para funcionar!)
          enable_transcode: 0, // 0 = desabilitado (OBRIGATÓRIO para funcionar!)
          stream_all: 1, // 1 = Start Stream Now
          gen_timestamps: 1, // CRÍTICO: Gerar PTS para play azul
          probesize_ondemand: 500000, // Para On-Demand
        });
          logger.info(`[ConteudosAtualizados] ✨ Canal de séries NÃO EXISTE - criando novo`);
        }
        logger.info(`[ConteudosAtualizados] Canal de séries: "${this.CHANNEL_SERIES}" → ${seriesUrl}`);
      }

        if (channelsToCreate.length === 0 && channelsToUpdate.length === 0) {
          logger.warn('[ConteudosAtualizados] Nenhum vídeo fornecido para criar/atualizar canais');
        return { success: false, error: 'Nenhum vídeo fornecido' };
      }

        // 8. Atualizar canais existentes
        if (channelsToUpdate.length > 0) {
          logger.info(`[ConteudosAtualizados] ♻️ Atualizando ${channelsToUpdate.length} canal(is) existente(s)...`);
          for (const channel of channelsToUpdate) {
            await this.updateChannelUrl(conn, channel.id, channel.newUrl, streamServerId);
            logger.info(`[ConteudosAtualizados] ✅ Canal "${channel.name}" (ID: ${channel.id}) atualizado com nova URL`);
          }
        }

        // 9. Criar novos canais (se necessário)
      let result = { inserted: 0, errors: 0, skipped: 0, insertedIds: [] as number[] };
      if (channelsToCreate.length > 0) {
        // IMPORTANTE: streamServerId é o ID da tabela 'servers' (servidores de streaming)
        // Esse ID será usado para vincular os canais na tabela streams_servers
        result = await xuiClient.bulkInsertLiveChannels(
          channelsToCreate,
          10, // batchSize
          false, // skipDuplicates = false (queremos criar mesmo se existir)
          streamServerId, // ID do servidor de streaming (tabela servers) - OBRIGATÓRIO
          true // onDemandMode = true (On-Demand com Live Restart)
        );
        logger.info(`[ConteudosAtualizados] Canais criados: ${result.inserted}, Erros: ${result.errors}`);
      } else {
        logger.info(`[ConteudosAtualizados] Nenhum canal novo para criar (todos já existem)`);
      }

        // 10. Coletar IDs de TODOS os canais (criados + atualizados) para adicionar ao bouquet
      const allChannelIds: number[] = [];
      
      // Adicionar IDs dos canais criados
      if (result.insertedIds && result.insertedIds.length > 0) {
        allChannelIds.push(...result.insertedIds);
        logger.info(`[ConteudosAtualizados] ✅ ${result.insertedIds.length} canais criados com sucesso (IDs: ${result.insertedIds.join(', ')})`);
        }
        
        // Adicionar IDs dos canais atualizados
        if (channelsToUpdate.length > 0) {
          const updatedIds = channelsToUpdate.map(c => c.id);
          allChannelIds.push(...updatedIds);
          logger.info(`[ConteudosAtualizados] ♻️ ${channelsToUpdate.length} canais atualizados (IDs: ${updatedIds.join(', ')})`);
        }
        
        if (allChannelIds.length === 0) {
          logger.warn(`[ConteudosAtualizados] ⚠️ Nenhum canal foi criado/atualizado! Verifique se há erros acima.`);
      }

      // 10. Adicionar canais ao bouquet "Canais" (ID 1)
      // ⚠️ IMPORTANTE: Canais de "Conteúdos Atualizados" SEMPRE vão para o bouquet "Canais" (ID 1)
      // Não importa qual bouquet foi usado na importação - os canais LIVE sempre vão para "Canais"
      const CANAIS_BOUQUET_ID = 2; // Bouquet "Canais" (não "Filmes" ou "Séries")
      
      if (allChannelIds.length > 0) {
        try {
          await xuiClient.addChannelsToBouquet(CANAIS_BOUQUET_ID, allChannelIds);
          logger.info(`[ConteudosAtualizados] ✅ ${allChannelIds.length} canais adicionados ao bouquet "Canais" (ID: ${CANAIS_BOUQUET_ID})`);
          logger.info(`[ConteudosAtualizados] ⚠️ NOTA: Canais sempre vão para bouquet "Canais", independente do bouquet usado na importação`);
        } catch (bouquetError: any) {
          logger.warn(`[ConteudosAtualizados] ⚠️ Erro ao adicionar canais ao bouquet "Canais" (não crítico): ${bouquetError.message}`);
        }
      }

      // 11. Configurar "Restart on Edit" e outros campos para canais ficarem em LIVE
      // Aplicar em TODOS os canais (novos + atualizados)
      if (allChannelIds.length > 0) {
        try {
          const placeholders = allChannelIds.map(() => '?').join(',');
          
          // gen_timestamps = 1 ativa "Restart on Edit" (Live Restart)
          // allow_record = 1 permite gravação (opcional, mas ajuda)
          // probesize_ondemand = 542000 (tamanho padrão para On-Demand)
          // stream_all = 1 ativa "Start Stream Now" (inicia stream automaticamente)
          await conn.query(
            `UPDATE streams 
             SET gen_timestamps = 1, 
                 allow_record = 1,
                 probesize_ondemand = 542000,
                 stream_all = 1
             WHERE id IN (${placeholders})`,
            allChannelIds
          );
          
          logger.info(`[ConteudosAtualizados] ✅ "Restart on Edit" e configurações LIVE ativadas para ${allChannelIds.length} canais`);
          logger.info(`[ConteudosAtualizados]   → gen_timestamps = 1 (Restart on Edit)`);
          logger.info(`[ConteudosAtualizados]   → allow_record = 1`);
          logger.info(`[ConteudosAtualizados]   → probesize_ondemand = 542000`);
          logger.info(`[ConteudosAtualizados]   → stream_all = 1 (Start Stream Now)`);
          
          // 12. Tentar iniciar streams via API (opcional - pode não funcionar em todas as versões do XUI)
          try {
            const accessCode = server.accessCode;
            const apiKey = decryptApiKey(server.apiKey);
            const baseUrl = server.baseUrl.replace(/\/$/, '');
            const apiUrl = `${baseUrl}/${accessCode}`;
            
            let startedCount = 0;
            
            for (const channelId of allChannelIds) {
              try {
                // Chamar API start_stream do XUI
                const response = await axios.post(apiUrl, null, {
                  params: {
                    api_key: apiKey,
                    action: 'start_stream',
                    stream_id: channelId,
                  },
                  timeout: 5000,
                });
                
                if (response.data && (response.data.result === true || response.data.status === 'success')) {
                  startedCount++;
                  logger.debug(`[ConteudosAtualizados] Stream ${channelId} iniciado via API`);
                } else {
                  logger.debug(`[ConteudosAtualizados] Stream ${channelId} não iniciado via API (resposta: ${JSON.stringify(response.data)})`);
                }
              } catch (startError: any) {
                // Ignorar erros individuais (pode não estar disponível em todas as versões)
                logger.debug(`[ConteudosAtualizados] Não foi possível iniciar stream ${channelId} via API: ${startError.message}`);
              }
            }
            
            if (startedCount > 0) {
              logger.info(`[ConteudosAtualizados] ✅ ${startedCount} streams iniciados via API`);
            } else {
              logger.info(`[ConteudosAtualizados] ℹ️ Streams não iniciados via API (pode ser normal - campos do banco devem ser suficientes)`);
            }
          } catch (apiError: any) {
            // Não crítico - os campos do banco devem ser suficientes
            logger.debug(`[ConteudosAtualizados] ⚠️ Erro ao tentar iniciar streams via API (não crítico): ${apiError.message}`);
          }
        } catch (restartError: any) {
          logger.warn(`[ConteudosAtualizados] ⚠️ Erro ao ativar Restart on Edit (não crítico): ${restartError.message}`);
        }
      }

      // ⚠️ CORREÇÃO: Retornar sucesso se canais foram criados OU atualizados
      const totalChannels = result.inserted + channelsToUpdate.length;
      
      logger.info(`[ConteudosAtualizados] 📊 Resumo: ${result.inserted} criados + ${channelsToUpdate.length} atualizados = ${totalChannels} canais processados`);
      
      return {
        success: totalChannels > 0,
        categoryId,
        channelsCreated: totalChannels,
      };
    } catch (error: any) {
      logger.error(`[ConteudosAtualizados] Erro: ${error.message}`);
      logger.error(`[ConteudosAtualizados] Stack: ${error.stack}`);
      return { success: false, error: error.message };
      } finally {
        // Fechar conexão MySQL
        try {
          await conn.end();
          logger.debug(`[ConteudosAtualizados] Conexão MySQL fechada`);
        } catch (e: any) {
          logger.warn(`[ConteudosAtualizados] Erro ao fechar conexão: ${e?.message}`);
        }
      }
    } catch (outerError: any) {
      logger.error(`[ConteudosAtualizados] Erro crítico: ${outerError.message}`);
      return { success: false, error: outerError.message };
    }
  }

  /**
   * ✨ Busca um canal por nome exato na categoria especificada
   * @param conn Conexão MySQL ativa
   * @param categoryId ID da categoria
   * @param channelName Nome exato do canal
   * @returns Canal encontrado ou null
   */
  private async findChannelByName(conn: any, categoryId: number, channelName: string): Promise<{ id: number; stream_display_name: string; stream_source: string } | null> {
    try {
      const [channels] = await conn.query(
        `SELECT id, stream_display_name, stream_source 
         FROM streams 
         WHERE type = 1 
         AND category_id = ?
         AND stream_display_name = ?`,
        [categoryIdJson, channelName]
      ) as any;
      
      if (channels && channels.length > 0) {
        return channels[0];
      }
      return null;
    } catch (error: any) {
      logger.error(`[ConteudosAtualizados] Erro ao buscar canal "${channelName}":`, error.message);
      return null;
    }
  }

  /**
   * ♻️ Atualiza a URL (stream_source) de um canal existente
   * @param conn Conexão MySQL ativa
   * @param channelId ID do canal
   * @param newUrl Nova URL do vídeo
   * @param streamServerId ID do servidor de streaming (opcional)
   */
  private async updateChannelUrl(conn: any, channelId: number, newUrl: string, streamServerId?: number): Promise<void> {
    try {
      // Atualizar stream_source
      await conn.query(
        `UPDATE streams SET stream_source = ? WHERE id = ?`,
        [JSON.stringify([newUrl]), channelId]
      );
      
      logger.info(`[ConteudosAtualizados] ✅ URL do canal ${channelId} atualizada`);
      
      // Atualizar também em streams_servers se streamServerId foi fornecido
      if (streamServerId) {
        await conn.query(
          `UPDATE streams_sys SET on_demand = 1 WHERE stream_id = ? AND server_id = ?`,
          [channelId, streamServerId]
        );
        logger.info(`[ConteudosAtualizados] ✅ Configurações do servidor atualizadas para canal ${channelId}`);
      }
    } catch (error: any) {
      logger.error(`[ConteudosAtualizados] Erro ao atualizar URL do canal ${channelId}:`, error.message);
      throw error;
    }
  }

  /**
   * Remove canais antigos da categoria (apenas os especificados)
   * @param channelsToRemove Array com os nomes dos canais a remover (ex: ["Filmes Adicionados"])
   */
  private async removeOldChannels(xuiClient: XUIVodDBClient, categoryId: number, channelsToRemove: string[]): Promise<void> {
    try {
      if (channelsToRemove.length === 0) {
        logger.info(`[ConteudosAtualizados] Nenhum canal especificado para remover`);
        return;
      }

      const conn = await xuiClient.connect();
      
      logger.info(`[ConteudosAtualizados] Buscando canais antigos para remover: ${channelsToRemove.join(', ')}`);
      
      // Buscar canais da categoria "Conteúdos Atualizados" que correspondem aos nomes especificados
      // Isso garante que removemos apenas canais da categoria correta
      const placeholders = channelsToRemove.map(() => '?').join(',');
      const [channels] = await conn.query<any[]>(
        `SELECT id, stream_display_name FROM streams 
         WHERE type = 1 
         AND category_id = ?
         AND stream_display_name IN (${placeholders})`,
        [categoryIdJson, ...channelsToRemove]
      );

      // Buscar todos os canais da categoria para log
      const [allCategoryChannels] = await conn.query<any[]>(
        `SELECT id, stream_display_name FROM streams 
         WHERE type = 1 
         AND category_id = ?`,
        [categoryIdJson]
      );
      
      logger.info(`[ConteudosAtualizados] Total de canais na categoria "${this.CATEGORY_NAME}": ${allCategoryChannels?.length || 0}`);
      logger.info(`[ConteudosAtualizados] Canais a remover (por nome): ${channels?.length || 0}`);
      
      if (allCategoryChannels && allCategoryChannels.length > 0) {
        const allNames = allCategoryChannels.map((c: any) => c.stream_display_name);
        logger.info(`[ConteudosAtualizados] Todos os canais na categoria: ${allNames.join(', ')}`);
      }

      if (channels && channels.length > 0) {
        const channelIds = channels.map(c => c.id);
        const channelNames = channels.map(c => c.stream_display_name);
        
        logger.info(`[ConteudosAtualizados] IDs dos canais a remover: ${channelIds.join(', ')}`);
        logger.info(`[ConteudosAtualizados] Nomes dos canais: ${channelNames.join(', ')}`);
        logger.info(`[ConteudosAtualizados] Removendo ${channelIds.length} canais antigos...`);
        
        // Remover de streams_servers primeiro (usar prepared statement para segurança)
        if (channelIds.length > 0) {
          const placeholders = channelIds.map(() => '?').join(',');
          
          // Remover de streams_servers
          try {
            const [serversResult] = await conn.query(
              `DELETE FROM streams_sys WHERE stream_id IN (${placeholders})`,
              channelIds
            );
            const serversDeleted = (serversResult as any).affectedRows || 0;
            logger.info(`[ConteudosAtualizados] Removidos ${serversDeleted} registros de streams_servers`);
          } catch (deleteError: any) {
            // ⚠️ CORREÇÃO: Tratar erro de permissão (usuário pode não ter permissão de DELETE)
            if (deleteError.code === 'ER_TABLEACCESS_DENIED_ERROR' || 
                deleteError.code === 'ER_DBACCESS_DENIED_ERROR' ||
                deleteError.message?.includes('Access denied') ||
                deleteError.message?.includes('permission denied')) {
              logger.warn(`[ConteudosAtualizados] ⚠️ Usuário MySQL não tem permissão de DELETE (esperado para servidores em produção). Continuando sem remover de streams_servers.`);
            } else {
              logger.warn(`[ConteudosAtualizados] ⚠️ Erro ao remover de streams_servers (não crítico): ${deleteError.message}`);
            }
          }
          
          // Remover de bouquets (se estiverem lá)
          try {
            const [bouquets] = await conn.query<any[]>(
              `SELECT id, bouquet_channels FROM bouquets`,
              []
            );
            
            if (bouquets && bouquets.length > 0) {
              for (const bouquet of bouquets) {
                try {
                  const currentChannels = JSON.parse(bouquet.bouquet_channels || '[]');
                  const filteredChannels = currentChannels.filter((id: number) => !channelIds.includes(id));
                  await conn.query(
                    `UPDATE bouquets SET bouquet_channels = ? WHERE id = ?`,
                    [JSON.stringify(filteredChannels), bouquet.id]
                  );
                  logger.info(`[ConteudosAtualizados] Removidos canais do bouquet ${bouquet.id}`);
                } catch (bouquetError: any) {
                  logger.warn(`[ConteudosAtualizados] Erro ao remover do bouquet ${bouquet.id}: ${bouquetError.message}`);
                }
              }
            }
          } catch (bouquetError: any) {
            logger.warn(`[ConteudosAtualizados] Erro ao processar bouquets (não crítico): ${bouquetError.message}`);
          }
          
          // Remover de streams (usar prepared statement)
          try {
            const [streamsResult] = await conn.query(
              `DELETE FROM streams WHERE id IN (${placeholders})`,
              channelIds
            );
            const streamsDeleted = (streamsResult as any).affectedRows || 0;
            
            logger.info(`[ConteudosAtualizados] ✅ ${streamsDeleted} canais removidos da tabela streams`);
            logger.info(`[ConteudosAtualizados] ✅ Total: ${streamsDeleted} canais antigos removidos com sucesso`);
            
            if (streamsDeleted !== channelIds.length) {
              logger.warn(`[ConteudosAtualizados] ⚠️ ATENÇÃO: Esperado remover ${channelIds.length} canais, mas apenas ${streamsDeleted} foram removidos!`);
            }
          } catch (deleteError: any) {
            // ⚠️ CORREÇÃO: Tratar erro de permissão (usuário pode não ter permissão de DELETE)
            if (deleteError.code === 'ER_TABLEACCESS_DENIED_ERROR' || 
                deleteError.code === 'ER_DBACCESS_DENIED_ERROR' ||
                deleteError.message?.includes('Access denied') ||
                deleteError.message?.includes('permission denied')) {
              logger.warn(`[ConteudosAtualizados] ⚠️ Usuário MySQL não tem permissão de DELETE (esperado para servidores em produção como NEOTV).`);
              logger.warn(`[ConteudosAtualizados] ⚠️ Os canais antigos NÃO foram removidos, mas os novos serão criados (pode haver duplicatas).`);
              logger.warn(`[ConteudosAtualizados] ⚠️ Para evitar duplicatas, remova manualmente os canais antigos no XUI ou use um usuário com permissões.`);
            } else {
              logger.warn(`[ConteudosAtualizados] ⚠️ Erro ao remover canais de streams (não crítico): ${deleteError.message}`);
            }
          }
        }
      } else {
        logger.info(`[ConteudosAtualizados] Nenhum canal antigo encontrado para remover`);
      }
    } catch (error: any) {
      logger.error(`[ConteudosAtualizados] ❌ ERRO ao remover canais antigos: ${error.message}`);
      logger.error(`[ConteudosAtualizados] Stack: ${error.stack}`);
      // Não falhar o processo se não conseguir remover, mas logar o erro
    }
  }

  /**
   * Constrói URL pública do vídeo
   * ⚠️ IMPORTANTE: Usar rota /api/storage/ para servir arquivos (funciona perfeitamente)
   */
  private buildVideoUrl(filePath: string, baseUrl: string): string {
    // Se já é uma URL completa, retornar como está
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }

    // ⚠️ CORREÇÃO CRÍTICA: Remover /api do final do baseUrl para evitar /api/api/storage/
    let cleanBaseUrl = baseUrl.replace(/\/api\/?$/, '');

    // Normalizar caminho
    let normalizedPath = filePath;
    if (normalizedPath.startsWith('/storage/')) {
      normalizedPath = normalizedPath.substring(1); // Remove barra inicial
    } else if (!normalizedPath.startsWith('storage/')) {
      normalizedPath = `storage/${normalizedPath.replace(/^\//, '')}`;
    }

    // ⚠️ CORREÇÃO: Usar rota /api/storage/ ao invés de /storage/
    // A rota /api/storage/ funciona perfeitamente conforme testado
    const apiStoragePath = normalizedPath.replace(/^storage\//, 'api/storage/');
    
    // Retornar URL completa via API
    return `${cleanBaseUrl}/${apiStoragePath}`;
  }
}

export default new ConteudosAtualizadosService();

