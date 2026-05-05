import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { XUIDBClient } from '../services/xui.db.client.js';
import { botService } from '../services/bot.service.js';

const logger = createLogger('PublicPremiumController');

/**
 * Listar planos premium públicos (sem autenticação)
 */
export const getPublicPremiumPlans = asyncHandler(async (req: Request, res: Response) => {
  logger.info('[GetPublicPlans] Buscando planos premium públicos');

  const plans = await prisma.premiumPlan.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      description: true,
      maxConnections: true,
      credits: true,
      sortOrder: true,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  });

  logger.info(`[GetPublicPlans] ${plans.length} plano(s) encontrado(s)`);

  return res.json({
    data: plans,
  });
});

/**
 * Buscar detalhes de um plano específico
 */
export const getPublicPlanDetails = asyncHandler(async (req: Request, res: Response) => {
  const { planId } = req.params;

  logger.info(`[GetPlanDetails] Buscando detalhes do plano: ${planId}`);

  const plan = await prisma.premiumPlan.findUnique({
    where: { id: planId, isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      maxConnections: true,
      credits: true,
      bouquetIds: true,
    },
  });

  if (!plan) {
    return res.status(404).json({
      success: false,
      error: 'Plano não encontrado',
    });
  }

  return res.json({
    data: plan,
  });
});

/**
 * Solicitar acesso de teste gratuito (3 horas)
 */
export const requestTestAccess = asyncHandler(async (req: Request, res: Response) => {
  const { name, whatsapp } = req.body;
  
  logger.info('[RequestTestAccess] Nova solicitação de teste', { name });
  
  // 1. Validação de entrada
  if (!name || !whatsapp) {
    return res.status(400).json({
      error: 'Nome e WhatsApp são obrigatórios'
    });
  }
  
  // 2. Normalizar telefone (adicionar código do país se necessário)
  let normalizedPhone = whatsapp.replace(/\D/g, '');
  if (!normalizedPhone.startsWith('55')) {
    normalizedPhone = '55' + normalizedPhone;
  }
  
  // 3. Validar formato do telefone
  if (normalizedPhone.length !== 12 && normalizedPhone.length !== 13) {
    return res.status(400).json({
      error: 'Formato de WhatsApp inválido. Use: 24993337836 ou 5524993337836'
    });
  }
  
  try {
    // 4. Buscar plano de teste premium (isTrial=true)
    const testPlan = await prisma.premiumPlan.findFirst({
      where: { 
        isTrial: true,
        isActive: true
      },
      include: {
        server: true // Incluir servidor relacionado
      }
    });
    
    if (!testPlan) {
      throw new Error('Nenhum plano de teste premium encontrado. Configure um plano com isTrial=true.');
    }
    
    if (!testPlan.serverId || !testPlan.server) {
      throw new Error('Plano de teste sem servidor XUI configurado');
    }
    
    const server = testPlan.server;
    
    logger.info('[RequestTestAccess] Plano teste encontrado:', {
      planId: testPlan.id,
      planName: testPlan.name,
      serverId: server.id,
      serverName: server.name,
      durationHours: testPlan.durationHours || 3
    });
    
    // 5. Configurar duração (usar durationHours do plano ou padrão 3h)
    const durationHours = testPlan.durationHours || 3;
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    
    // 6. Gerar credenciais únicas
    const username = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const password = Math.random().toString(36).slice(2, 12);
    
    // 7. Parsear bouquets do plano
    let bouquetIds: number[] = [1]; // Fallback padrão
    try {
      const parsed = JSON.parse(testPlan.bouquetIds || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        bouquetIds = parsed.map((id: string | number) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
      }
    } catch (e) {
      logger.warn('[RequestTestAccess] Erro ao parsear bouquetIds, usando padrão [1]');
    }
    
    logger.info('[RequestTestAccess] Bouquets configurados:', bouquetIds);
    
    // 8. Criar linha no XUI
    const dbClient = new XUIDBClient(server);
    
    try {
      const lineId = await dbClient.createLine({
        username,
        password,
        exp_date: Math.floor(expiresAt.getTime() / 1000),
        is_trial: 1,
        member_id: server.xuiResellerId || 2,
        bouquet: bouquetIds, // Usar bouquets do plano
        allowed_outputs: [1, 2, 3],
        max_connections: testPlan.maxConnections || 1, // Usar conexões do plano
        admin_notes: `Teste Premium - ${name} (${normalizedPhone}) - Plano: ${testPlan.name}`,
        is_restreamer: 0
      });
      
      logger.info('[RequestTestAccess] Linha criada com sucesso', { 
        lineId, 
        username,
        bouquets: bouquetIds,
        maxConnections: testPlan.maxConnections,
        expiresAt: expiresAt.toISOString() 
      });
      
      // 9. Gerar URLs M3U para o teste
      // Normalizar DNS: remover barras finais e duplicadas
      let dns = server.dnsPrimary?.trim() || server.baseUrl?.trim() || '';
      dns = dns.replace(/\/+$/, ''); // Remove barras finais
      dns = dns.replace(/:\/\/+/g, '://'); // Normaliza protocolo (http:// ou https://)
      
      const m3uUrl = dns ? `${dns}/get.php?username=${username}&password=${password}&type=m3u_plus&output=mpegts` : '';
      
      logger.info('[RequestTestAccess] Gerando M3U URL', { 
        dnsPrimary: server.dnsPrimary,
        baseUrl: server.baseUrl,
        dnsNormalizado: dns,
        username, 
        hasM3uUrl: !!m3uUrl,
        m3uUrlCompleta: m3uUrl
      });
      
      // 10. Enviar notificação WhatsApp
      const customerData = {
        id: `test_${lineId}`,
        name: name,
        whatsapp: normalizedPhone,
        username: username,
        password: password,
        expiresAt: expiresAt,
        expires_at: expiresAt, // Alias para compatibilidade
        package: {
          name: testPlan.name || 'Teste Gratuito (3 Horas)',
          planPrice: 0,
          server: server // Incluir servidor para geração automática de M3U
        },
        // IMPORTANTE: Adicionar m3u_url no nível superior para o bot
        m3u_url: m3uUrl,
        dns: dns
      };
      
      // Buscar usuário admin para enviar notificação
      const adminUser = await prisma.user.findFirst({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }
      });
      
      if (adminUser) {
        logger.info('[RequestTestAccess] ===== DADOS ENVIADOS PARA BOT =====');
        logger.info('[RequestTestAccess] Customer ID:', customerData.id);
        logger.info('[RequestTestAccess] Name:', customerData.name);
        logger.info('[RequestTestAccess] Username:', customerData.username);
        logger.info('[RequestTestAccess] M3U URL completa:', customerData.m3u_url);
        logger.info('[RequestTestAccess] Package Server:', !!customerData.package.server);
        logger.info('[RequestTestAccess] =====================================');
        
        await botService.sendWelcomeNotification(adminUser.id, customerData as any, true);
        logger.info('[RequestTestAccess] Notificação WhatsApp enviada', { phone: normalizedPhone });
      }
      
      // 11. Log da ação
      await prisma.actionLog.create({
        data: {
          userId: adminUser?.id || 'SYSTEM',
          action: 'CREATE_TEST_ACCESS',
          entity: 'customer',
          entityId: lineId.toString(),
          details: JSON.stringify({
            name,
            phone: normalizedPhone,
            duration: `${durationHours}h`,
            planId: testPlan.id,
            planName: testPlan.name,
            source: 'public_portal_test'
          })
        }
      });
      
      // 10. Resposta de sucesso
      return res.json({
        success: true,
        message: 'Teste criado com sucesso!',
        lineId: lineId,
        expiresAt: expiresAt.toISOString()
      });
      
    } finally {
      await dbClient.disconnect();
    }
    
  } catch (error: any) {
    logger.error('[RequestTestAccess] Erro ao criar teste:', error.message);
    return res.status(500).json({
      error: 'Erro interno ao processar solicitação de teste',
      details: error.message
    });
  }
});
