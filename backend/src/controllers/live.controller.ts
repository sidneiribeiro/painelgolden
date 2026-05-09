/**
 * Controlador para importação de canais LIVE
 */

import type { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { LiveImporterService } from '../services/live/live-importer.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('LiveController');

async function detectLiveCategoryTable(connection: any): Promise<string> {
  for (const t of ['streams_categories', 'stream_categories']) {
    const [exists] = await connection.query(`SHOW TABLES LIKE '${t}'`);
    if ((exists as any[]).length > 0) return t;
  }
  return 'streams_categories';
}

async function detectStreamsEnabledColumn(connection: any): Promise<string | null> {
  for (const col of ['enabled', 'active', 'status']) {
    const [rows] = await connection.query(`SHOW COLUMNS FROM streams LIKE ?`, [col]);
    if ((rows as any[]).length > 0) return col;
  }
  return null;
}

async function streamsHasUpdatedColumn(connection: any): Promise<boolean> {
  const [rows] = await connection.query(`SHOW COLUMNS FROM streams LIKE 'updated'`);
  return (rows as any[]).length > 0;
}

export const liveController = {
  /**
   * POST /api/live/import
   * Importa canais LIVE de um M3U
   */
  async importFromM3U(req: Request, res: Response) {
    try {
      const { serverId, m3uUrl, categoryMappings, bouquetId } = req.body;
      const userId = req.user?.userId;  // ← CORRIGIDO: userId ao invés de id

      logger.info('[LiveController] Recebendo requisição de importação:', {
        serverId,
        m3uUrl: m3uUrl?.substring(0, 50) + '...',
        categoryMappings: categoryMappings?.length || 0,
        bouquetId,
        userId,
      });

      if (!userId) {
        logger.error('[LiveController] Usuário não autenticado');
        return res.status(401).json({ error: 'Não autenticado' });
      }

      if (!serverId || !m3uUrl) {
        logger.error('[LiveController] Parâmetros faltando:', { serverId, m3uUrl });
        return res.status(400).json({ error: 'serverId e m3uUrl são obrigatórios' });
      }

      // Buscar servidor
      const server = await prisma.xuiServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        logger.error('[LiveController] Servidor não encontrado:', serverId);
        return res.status(404).json({ error: 'Servidor não encontrado' });
      }

      logger.info('[LiveController] Servidor encontrado:', {
        id: server.id,
        name: server.name,
        dbHost: server.dbHost,
      });

      // Iniciar importação em background
      const importer = new LiveImporterService(server);

      // IMPORTANTE: Retornar resposta imediata para evitar timeout
      res.status(200).json({
        message: 'Importação de canais iniciada em background',
        serverId,
      });

      logger.info('[LiveController] Iniciando importação em background para userId:', userId);

      // Opções de configuração de importação
      const importOptions = {
        importMode: req.body.importMode || 'direct', // 'direct' ou 'ondemand'
        directSource: req.body.directSource !== undefined ? Number(req.body.directSource) : undefined,
        directProxy: req.body.directProxy !== undefined ? Number(req.body.directProxy) : undefined,
        enableTranscode: req.body.enableTranscode !== undefined ? Number(req.body.enableTranscode) : undefined,
        streamAll: req.body.streamAll !== undefined ? Number(req.body.streamAll) : undefined,
        serverId: req.body.streamServerId ? Number(req.body.streamServerId) : undefined, // ID do servidor de streaming
        updateExistingIcons: req.body.updateExistingIcons === true,
      };

      // Continuar importação em background
      importer.importFromM3U(
        m3uUrl,
        categoryMappings || [],
        bouquetId || 1,
        userId,
        importOptions
      ).catch((error) => {
        logger.error('[LiveController] Erro na importação em background:', {
          message: error.message,
          stack: error.stack,
          userId,
        });
      });
    } catch (error: any) {
      logger.error('[LiveController] Erro ao iniciar importação:', {
        message: error.message,
        stack: error.stack,
      });
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * POST /api/live/analyze-m3u
   * Analisa M3U e retorna categorias detectadas (sem importar)
   */
  async analyzeM3U(req: Request, res: Response) {
    try {
      const { serverId, m3uUrl } = req.body;

      if (!serverId || !m3uUrl) {
        return res.status(400).json({ error: 'serverId e m3uUrl são obrigatórios' });
      }

      // Buscar servidor
      const server = await prisma.xuiServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return res.status(404).json({ error: 'Servidor não encontrado' });
      }

      const importer = new LiveImporterService(server);
      const categories = await importer.getM3UCategories(m3uUrl);

      return res.status(200).json({
        categories,
        totalChannels: categories.reduce((sum, cat) => sum + cat.count, 0),
      });
    } catch (error: any) {
      logger.error('[LiveController] Erro ao analisar M3U:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * GET /api/live/servers
   * Lista servidores de streaming do XUI (Server Tree / On-Demand)
   */
  async getServers(req: Request, res: Response) {
    try {
      const { serverId } = req.query;

      if (!serverId) {
        return res.status(400).json({ error: 'serverId é obrigatório' });
      }

      // Buscar servidor XUI
      const server = await prisma.xuiServer.findUnique({
        where: { id: String(serverId) },
      });

      if (!server) {
        return res.status(404).json({ error: 'Servidor não encontrado' });
      }

      // Buscar servidores de streaming do XUI
      const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
      const client = new XUIVodDBClient(server);

      try {
        const connection = await client.connect();
        
        if (!connection) {
          throw new Error('Falha ao conectar ao banco de dados');
        }

        // Buscar servidores da tabela servers
        const [servers] = await connection.query(
          `SELECT id, server_name, server_ip 
           FROM servers 
           WHERE enabled = 1
           ORDER BY server_name ASC`
        );

        await client.disconnect();

        return res.status(200).json(servers);
      } catch (error: any) {
        logger.error('[LiveController] Erro ao buscar servidores:', {
          message: error.message,
          stack: error.stack,
        });
        try {
          await client.disconnect();
        } catch (e) {
          // Ignorar erro ao desconectar
        }
        
        // Retornar array vazio em caso de erro (não crítico)
        return res.status(200).json([]);
      }
    } catch (error: any) {
      logger.error('[LiveController] Erro ao buscar servidores:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * GET /api/live/categories
   * Lista categorias de canais LIVE do XUI
   */
  async getCategories(req: Request, res: Response) {
    try {
      const { serverId } = req.query;

      if (!serverId) {
        return res.status(400).json({ error: 'serverId é obrigatório' });
      }

      // Buscar servidor (serverId é UUID string)
      const server = await prisma.xuiServer.findUnique({
        where: { id: String(serverId) },
      });

      if (!server) {
        return res.status(404).json({ error: 'Servidor não encontrado' });
      }

      // Usar XUIVodDBClient que agora tem método connect() público
      const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
      const client = new XUIVodDBClient(server);

      try {
        // Conectar ao MySQL
        const connection = await client.connect();
        
        if (!connection) {
          throw new Error('Falha ao conectar ao banco de dados');
        }

        const catTable = await detectLiveCategoryTable(connection);

        // Buscar categorias LIVE
        const [categories] = await connection.query(
          `SELECT id, category_name, parent_id 
           FROM ${catTable} 
           WHERE category_type = 'live'
           ORDER BY category_name ASC`
        );

        await client.disconnect();

        return res.status(200).json(categories);
      } catch (error: any) {
        logger.error('[LiveController] Erro detalhado ao buscar categorias:', {
          message: error.message,
          stack: error.stack,
        });
        try {
          await client.disconnect();
        } catch (e) {
          // Ignorar erro ao desconectar
        }
        throw error;
      }
    } catch (error: any) {
      logger.error('[LiveController] Erro ao buscar categorias:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * GET /api/live/streams
   * Lista streams LIVE (canais) do Xtream UI
   */
  async getStreams(req: Request, res: Response) {
    try {
      const { serverId, page = '1', perPage = '50', keyword = '', categoryId } = req.query as any;

      if (!serverId) {
        return res.status(400).json({ error: 'serverId é obrigatório' });
      }

      const server = await prisma.xuiServer.findUnique({
        where: { id: String(serverId) },
      });

      if (!server) {
        return res.status(404).json({ error: 'Servidor não encontrado' });
      }

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const perPageNum = Math.min(200, Math.max(10, parseInt(String(perPage), 10) || 50));
      const offset = (pageNum - 1) * perPageNum;

      const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
      const client = new XUIVodDBClient(server);
      const connection = await client.connect();

      if (!connection) {
        return res.status(500).json({ error: 'Falha ao conectar ao banco de dados' });
      }

      try {
        const catTable = await detectLiveCategoryTable(connection);
        const enabledCol = await detectStreamsEnabledColumn(connection);

        const filters: string[] = ['s.type = 1'];
        const params: any[] = [];

        if (keyword && String(keyword).trim()) {
          filters.push('s.stream_display_name LIKE ?');
          params.push(`%${String(keyword).trim()}%`);
        }

        if (categoryId !== undefined && String(categoryId).trim() !== '') {
          const catIdNum = parseInt(String(categoryId), 10);
          if (!Number.isNaN(catIdNum)) {
            filters.push('s.category_id = ?');
            params.push(catIdNum);
          }
        }

        const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
        const enabledSelect = enabledCol ? `s.${enabledCol} as enabled` : '1 as enabled';

        const [countRows] = await connection.query<any[]>(
          `SELECT COUNT(*) as total FROM streams s ${whereSql}`,
          params
        );

        const total = Number((countRows?.[0] as any)?.total || 0);

        const [rows] = await connection.query<any[]>(
          `
            SELECT
              s.id,
              s.stream_display_name,
              s.stream_icon,
              s.category_id,
              s.stream_source,
              ${enabledSelect},
              c.category_name
            FROM streams s
            LEFT JOIN ${catTable} c ON c.id = s.category_id
            ${whereSql}
            ORDER BY s.id DESC
            LIMIT ? OFFSET ?
          `,
          [...params, perPageNum, offset]
        );

        const items = (rows || []).map((r: any) => {
          let sourceUrl = '';
          try {
            const parsed = JSON.parse(r.stream_source || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) sourceUrl = String(parsed[0] || '');
          } catch {
            sourceUrl = String(r.stream_source || '');
          }

          return {
            id: Number(r.id),
            name: String(r.stream_display_name || ''),
            icon: String(r.stream_icon || ''),
            categoryId: r.category_id !== null && r.category_id !== undefined ? Number(r.category_id) : null,
            categoryName: r.category_name ? String(r.category_name) : null,
            sourceUrl,
            enabled: Number(r.enabled) === 1,
          };
        });

        await client.disconnect();

        return res.status(200).json({
          page: pageNum,
          perPage: perPageNum,
          total,
          items,
        });
      } catch (error: any) {
        try {
          await client.disconnect();
        } catch {}
        throw error;
      }
    } catch (error: any) {
      logger.error('[LiveController] Erro ao listar streams:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * PUT /api/live/streams/:streamId
   * Atualiza campos básicos de um canal LIVE
   */
  async updateStream(req: Request, res: Response) {
    try {
      const { serverId } = req.query as any;
      const { streamId } = req.params as any;
      const { name, icon, sourceUrl, categoryId, enabled } = req.body || {};

      if (!serverId) {
        return res.status(400).json({ error: 'serverId é obrigatório' });
      }

      const streamIdNum = parseInt(String(streamId), 10);
      if (Number.isNaN(streamIdNum)) {
        return res.status(400).json({ error: 'streamId inválido' });
      }

      const server = await prisma.xuiServer.findUnique({
        where: { id: String(serverId) },
      });

      if (!server) {
        return res.status(404).json({ error: 'Servidor não encontrado' });
      }

      const { XUIVodDBClient } = await import('../services/vod/xui-vod-db.client.js');
      const client = new XUIVodDBClient(server);
      const connection = await client.connect();

      if (!connection) {
        return res.status(500).json({ error: 'Falha ao conectar ao banco de dados' });
      }

      try {
        const enabledCol = await detectStreamsEnabledColumn(connection);
        const hasUpdated = await streamsHasUpdatedColumn(connection);

        const sets: string[] = [];
        const params: any[] = [];

        if (name !== undefined) {
          sets.push('stream_display_name = ?');
          params.push(String(name));
        }

        if (icon !== undefined) {
          sets.push('stream_icon = ?');
          params.push(String(icon));
        }

        if (categoryId !== undefined) {
          const catIdNum = parseInt(String(categoryId), 10);
          sets.push('category_id = ?');
          params.push(Number.isNaN(catIdNum) ? 0 : catIdNum);
        }

        if (sourceUrl !== undefined) {
          const url = String(sourceUrl || '').trim();
          const encoded = JSON.stringify(url ? [url] : []);
          sets.push('stream_source = ?');
          params.push(encoded);
        }

        if (enabled !== undefined && enabledCol) {
          sets.push(`${enabledCol} = ?`);
          params.push(enabled ? 1 : 0);
        }

        if (hasUpdated) {
          sets.push('updated = NOW()');
        }

        if (sets.length === 0) {
          await client.disconnect();
          return res.status(200).json({ success: true });
        }

        params.push(streamIdNum);

        const [result] = await connection.query<any>(
          `UPDATE streams SET ${sets.join(', ')} WHERE id = ? AND type = 1`,
          params
        );

        await client.disconnect();

        return res.status(200).json({
          success: true,
          affectedRows: (result as any)?.affectedRows || 0,
        });
      } catch (error: any) {
        try {
          await client.disconnect();
        } catch {}
        throw error;
      }
    } catch (error: any) {
      logger.error('[LiveController] Erro ao atualizar stream:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * GET /api/live/bouquets
   * Lista bouquets disponíveis
   * Usa a rota padrão de bouquets que já está funcionando
   */
  async getBouquets(req: Request, res: Response) {
    try {
      const { serverId } = req.query;

      if (!serverId) {
        return res.status(400).json({ error: 'serverId é obrigatório' });
      }

      // Buscar bouquets do banco local (já sincronizados)
      const bouquets = await prisma.bouquet.findMany({
        where: { serverId: String(serverId) },
        orderBy: { externalId: 'asc' },
      });

      // Se não tiver bouquets no banco local, retornar bouquet padrão
      if (bouquets.length === 0) {
        return res.status(200).json([
          { id: 1, bouquet_name: 'All Channels' }
        ]);
      }

      // Formatar resposta
      const formatted = bouquets.map(b => ({
        id: parseInt(b.externalId),
        bouquet_name: b.name,
      }));

      return res.status(200).json(formatted);
    } catch (error: any) {
      logger.error('[LiveController] Erro ao buscar bouquets:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * ⚠️ PAUSE/RESUME/CANCEL: POST /api/live/import/pause
   * Pausa a importação em andamento
   */
  async pauseImport(req: Request, res: Response) {
    try {
      const { socketService } = await import('../services/socket.service.js');
      const userId = req.user?.userId || 'anonymous';
      const forceAll = req.body?.forceAll === true;
      
      let success = socketService.pauseUserProcess(userId);
      
      if (!success && forceAll) {
        logger.info(`[LiveController] Tentando pausar TODOS os processos em andamento`);
        success = socketService.pauseAllProcesses();
      }
      
      if (!success) {
        return res.status(400).json({ error: 'Nenhum processo em andamento para pausar' });
      }
      
      return res.json({
        success: true,
        message: 'Importação pausada',
      });
    } catch (error: any) {
      logger.error('[LiveController] Erro ao pausar importação:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * ⚠️ PAUSE/RESUME/CANCEL: POST /api/live/import/resume
   * Retoma a importação pausada
   */
  async resumeImport(req: Request, res: Response) {
    try {
      const { socketService } = await import('../services/socket.service.js');
      const userId = req.user?.userId || 'anonymous';
      
      const success = socketService.resumeUserProcess(userId);
      
      if (!success) {
        return res.status(400).json({ error: 'Nenhum processo pausado para retomar' });
      }
      
      return res.json({
        success: true,
        message: 'Importação retomada',
      });
    } catch (error: any) {
      logger.error('[LiveController] Erro ao retomar importação:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * ⚠️ PAUSE/RESUME/CANCEL: POST /api/live/import/cancel
   * Cancela a importação em andamento
   */
  async cancelImport(req: Request, res: Response) {
    try {
      const { socketService } = await import('../services/socket.service.js');
      const userId = req.user?.userId || 'anonymous';
      const forceAll = req.body?.forceAll === true;
      
      let success = socketService.cancelUserProcess(userId);
      
      if (!success && forceAll) {
        logger.info(`[LiveController] Tentando cancelar TODOS os processos em andamento`);
        success = socketService.cancelAllProcesses();
      }
      
      if (!success) {
        return res.status(400).json({ error: 'Nenhum processo em andamento para cancelar' });
      }
      
      return res.json({
        success: true,
        message: 'Importação cancelada',
      });
    } catch (error: any) {
      logger.error('[LiveController] Erro ao cancelar importação:', error.message);
      return res.status(500).json({ error: error.message });
    }
  },
};
