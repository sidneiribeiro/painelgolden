import { prisma } from '../config/database.js';
import { XUIDBClient } from './xui.db.client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PremiumSourceService');

interface CreateSourceInput {
  planId: string;
  serverId: string;
  resellerUserId: string;
  durationDays: number;
  bouquetId: string;  // ID do bouquet no banco local
  customUsername?: string;
}

interface CreateSourceResult {
  source: any;
  credentials: {
    username: string;
    password: string;
    expiresAt: Date;
  };
  urls: {
    m3u_ts: string;
    m3u_hls: string;
    ssiptv?: string;
  };
}

export class PremiumSourceService {
  /**
   * Criar uma nova fonte premium (linha XUI)
   * USANDO CONEXÃO DIRETA AO BANCO - IGUAL AO SISTEMA DE CLIENTES
   */
  static async createSource(input: CreateSourceInput): Promise<CreateSourceResult> {
    logger.info('[CreateSource] Iniciando...', { input });

    // 1. Buscar plano
    const plan = await prisma.premiumPlan.findUnique({
      where: { id: input.planId },
    });
    if (!plan) throw new Error('Plano não encontrado');
    if (!plan.isActive) throw new Error('Plano inativo');

    // 2. Buscar servidor XUI
    const server = await prisma.xuiServer.findUnique({
      where: { id: input.serverId },
    });
    if (!server) throw new Error('Servidor não encontrado');

    // 3. Buscar bouquet
    const bouquet = await prisma.bouquet.findUnique({
      where: { id: input.bouquetId },
    });
    if (!bouquet) throw new Error('Bouquet não encontrado');
    if (bouquet.serverId !== input.serverId) throw new Error('Bouquet não pertence a este servidor');

    // 4. Buscar reseller
    const reseller = await prisma.user.findUnique({
      where: { id: input.resellerUserId },
    });
    if (!reseller) throw new Error('Revendedor não encontrado');

    // 5. Gerar credenciais
    const username = input.customUsername || `premium_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const password = Math.random().toString(36).slice(2, 12);

    // 6. Calcular data de expiração
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + input.durationDays);
    const expTimestamp = Math.floor(expiresAt.getTime() / 1000);

    // 7. Usar o externalId do bouquet (ID real no XUI)
    const xuiBouquetId = parseInt(bouquet.externalId, 10);

    logger.info('[CreateSource] Criando linha no XUI via BANCO DIRETO...', {
      username,
      maxConnections: plan.maxConnections,
      bouquetId: xuiBouquetId,
      expTimestamp,
      serverId: server.id,
      serverName: server.name,
    });

    // 8. Criar linha DIRETAMENTE NO BANCO (igual ao sistema de clientes)
    const dbClient = new XUIDBClient(server);
    let lineId: number;

    try {
      lineId = await dbClient.createLine({
        username,
        password,
        exp_date: expTimestamp,
        is_trial: 0,
        member_id: server.xuiResellerId || 2,
        bouquet: [xuiBouquetId],
        allowed_outputs: [1, 2, 3], // TS, HLS, RTMP
        max_connections: plan.maxConnections, // USAR CONEXÕES DO PLANO!
        admin_notes: `Fonte Premium - Plano: ${plan.name}`,
      });

      logger.info('[CreateSource] Linha criada no banco XUI:', { lineId, username, maxConnections: plan.maxConnections });
    } catch (error: any) {
      logger.error('[CreateSource] Erro ao criar linha no banco:', error.message);
      throw new Error(`Erro ao criar linha no XUI: ${error.message}`);
    } finally {
      await dbClient.disconnect();
    }

    // 9. Salvar fonte premium no banco local
    const source = await prisma.premiumSource.create({
      data: {
        planId: plan.id,
        serverId: server.id,
        resellerUserId: reseller.id,
        xuiLineId: String(lineId),
        username,
        password,
        status: 'ACTIVE',
        expiresAt,
      },
      include: {
        plan: true,
        server: true,
        reseller: {
          select: { id: true, username: true, email: true },
        },
      },
    });

    logger.info('[CreateSource] Fonte criada com sucesso:', source.id);

    // 10. Gerar URLs M3U
    let dns = server.dnsPrimary?.trim() || server.baseUrl?.trim() || '';
    // Normalizar DNS: remover barras finais e duplicadas
    dns = dns.replace(/\/+$/, ''); // Remove barras finais
    dns = dns.replace(/:\/\/+/g, '://'); // Normaliza protocolo
    
    const urls = {
      m3u_ts: `${dns}/get.php?username=${username}&password=${password}&type=m3u_plus&output=mpegts`,
      m3u_hls: `${dns}/get.php?username=${username}&password=${password}&type=m3u_plus&output=hls`,
      ssiptv: undefined as string | undefined,
    };

    // Tentar gerar link SSIPTV
    try {
      const dnsHost = new URL(dns).hostname;
      urls.ssiptv = `http://e.${dnsHost}/p/${username}/${password}/ssiptv`;
    } catch {
      // Ignora erro de URL
    }

    return {
      source,
      credentials: {
        username,
        password,
        expiresAt,
      },
      urls,
    };
  }

  /**
   * Listar fontes do reseller
   */
  static async listSources(resellerUserId: string, filters?: { status?: string }) {
    const where: any = { resellerUserId };
    if (filters?.status) where.status = filters.status;

    return prisma.premiumSource.findMany({
      where,
      include: {
        plan: true,
        server: { select: { id: true, name: true, baseUrl: true, dnsPrimary: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Buscar fonte por ID
   */
  static async getSource(id: string, resellerUserId?: string) {
    const where: any = { id };
    if (resellerUserId) where.resellerUserId = resellerUserId;

    return prisma.premiumSource.findFirst({
      where,
      include: {
        plan: true,
        server: { select: { id: true, name: true, baseUrl: true, dnsPrimary: true } },
        reseller: { select: { id: true, username: true, email: true } },
      },
    });
  }

  /**
   * Pausar/Ativar fonte
   */
  static async toggleStatus(id: string, resellerUserId: string) {
    const source = await prisma.premiumSource.findFirst({
      where: { id, resellerUserId },
    });
    if (!source) throw new Error('Fonte não encontrada');

    const newStatus = source.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

    return prisma.premiumSource.update({
      where: { id },
      data: { status: newStatus },
      include: { plan: true, server: true },
    });
  }

  /**
   * Deletar fonte (desativa linha no XUI)
   */
  static async deleteSource(id: string, resellerUserId: string) {
    const source = await prisma.premiumSource.findFirst({
      where: { id, resellerUserId },
      include: { server: true },
    });
    if (!source) throw new Error('Fonte não encontrada');

    // TODO: Desativar linha no XUI
    // const dbClient = new XUIDBClient(source.server);
    // await dbClient.deleteLine(parseInt(source.xuiLineId));

    return prisma.premiumSource.delete({
      where: { id },
    });
  }

  /**
   * Gerar URLs M3U para uma fonte existente
   */
  static generateUrls(source: any): { m3u_ts: string; m3u_hls: string; ssiptv?: string } {
    let dns = source.server.dnsPrimary?.trim() || source.server.baseUrl?.trim() || '';
    // Normalizar DNS: remover barras finais e duplicadas
    dns = dns.replace(/\/+$/, '');
    dns = dns.replace(/:\/\/+/g, '://');
    
    const urls = {
      m3u_ts: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=mpegts`,
      m3u_hls: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=hls`,
      ssiptv: undefined as string | undefined,
    };

    try {
      const dnsHost = new URL(dns).hostname;
      urls.ssiptv = `http://e.${dnsHost}/p/${source.username}/${source.password}/ssiptv`;
    } catch {
      // Ignora erro de URL
    }

    return urls;
  }
}

export default PremiumSourceService;
