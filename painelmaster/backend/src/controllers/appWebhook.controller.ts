import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { XUIDBClient } from '../services/xui.db.client.js';
import { XUIClient } from '../services/xui.client.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { calculateExpTimestamp, unixToDate } from '../utils/dateUtils.js';
import { botService } from '../services/bot.service.js';

const logger = createLogger('AppWebhookController');

// ID do reseller super-neo (padrão)
const SUPER_NEO_MEMBER_ID = 2;

function resolveMemberIdForServer(server: { serverType?: string; xuiResellerId?: number | null }): number {
  const serverType = (server.serverType || 'XUIONE').toUpperCase();
  if (serverType === 'XTREAMUI') {
    const fromConfig = server.xuiResellerId;
    if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
    return 1;
  }
  return SUPER_NEO_MEMBER_ID;
}

// Gera número aleatório de 9 dígitos
function generateRandomNumber(): string {
  let result = Math.floor(Math.random() * 9 + 1).toString();
  for (let i = 1; i < 9; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

// Gera credenciais numéricas
function generateNumericCredentials(): { username: string; password: string } {
  const username = generateRandomNumber();
  let password = generateRandomNumber();
  while (password === username) {
    password = generateRandomNumber();
  }
  return { username, password };
}

/**
 * POST /api/webhook/app/create-test
 * Endpoint público para criar teste via app externo
 * 
 * Headers:
 *   Authorization: Bearer <apiToken>
 * 
 * Body:
 *   { "phone": "5511999999999" }
 * 
 * Response:
 *   { "success": true, "message": "...", "username": "...", "password": "..." }
 */
export const createTestFromApp = asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // 1. Extrair token do header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('[AppWebhook] Requisição sem token de autenticação');
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido'
      });
    }

    const apiToken = authHeader.substring(7); // Remove "Bearer "

    // 2. Buscar configuração do webhook pelo token
    const config = await prisma.appWebhookConfig.findUnique({
      where: { apiToken }
    });

    if (!config) {
      logger.warn('[AppWebhook] Token inválido', { token: apiToken.substring(0, 10) + '...' });
      return res.status(401).json({
        success: false,
        message: 'Token de API inválido'
      });
    }

    if (!config.isActive) {
      logger.warn('[AppWebhook] Webhook desativado', { name: config.name });
      return res.status(403).json({
        success: false,
        message: 'Webhook desativado'
      });
    }

    // 3. Extrair e validar telefone
    const { phone, whatsapp, name, email, note } = req.body;
    const phoneNumber = (phone || whatsapp || '').replace(/\D+/g, '');

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Telefone é obrigatório'
      });
    }

    logger.info('[AppWebhook] Requisição de teste:', { 
      config: config.name, 
      phone: phoneNumber,
      ip: req.ip 
    });

    // 4. Verificar limite de testes por telefone
    const existingTests = await prisma.appTestRequest.count({
      where: {
        configId: config.id,
        phone: phoneNumber,
        status: 'success'
      }
    });

    if (existingTests >= config.maxTestsPerPhone) {
      logger.info('[AppWebhook] Limite de testes atingido:', { phone: phoneNumber, limit: config.maxTestsPerPhone });
      
      // Registrar tentativa bloqueada
      await prisma.appTestRequest.create({
        data: {
          configId: config.id,
          phone: phoneNumber,
          status: 'blocked',
          errorMessage: 'Limite de testes atingido',
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        }
      });

      return res.status(429).json({
        success: false,
        message: 'Você já utilizou seu teste gratuito. Se quiser assinar, fale com nosso atendimento pelo WhatsApp.'
      });
    }

    // 5. Verificar cooldown (se configurado)
    if (config.testCooldownDays > 0) {
      const cooldownDate = new Date();
      cooldownDate.setDate(cooldownDate.getDate() - config.testCooldownDays);

      const recentTest = await prisma.appTestRequest.findFirst({
        where: {
          configId: config.id,
          phone: phoneNumber,
          status: 'success',
          createdAt: { gte: cooldownDate }
        }
      });

      if (recentTest) {
        logger.info('[AppWebhook] Cooldown ativo:', { phone: phoneNumber, lastTest: recentTest.createdAt });
        return res.status(429).json({
          success: false,
          message: `Você já utilizou um teste recentemente. Aguarde ${config.testCooldownDays} dias para solicitar outro.`
        });
      }
    }

    // 6. Criar registro de requisição (status pending)
    const testRequest = await prisma.appTestRequest.create({
      data: {
        configId: config.id,
        phone: phoneNumber,
        status: 'pending',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      }
    });

    // 7. Buscar servidor e pacote configurados
    const server = await prisma.xuiServer.findUnique({
      where: { id: config.serverId }
    });

    if (!server) {
      await prisma.appTestRequest.update({
        where: { id: testRequest.id },
        data: { status: 'error', errorMessage: 'Servidor não configurado' }
      });
      return res.status(500).json({
        success: false,
        message: 'Erro de configuração. Entre em contato com o suporte.'
      });
    }

    const pkg = await prisma.package.findUnique({
      where: { id: config.packageId }
    });

    if (!pkg) {
      await prisma.appTestRequest.update({
        where: { id: testRequest.id },
        data: { status: 'error', errorMessage: 'Pacote não configurado' }
      });
      return res.status(500).json({
        success: false,
        message: 'Erro de configuração. Entre em contato com o suporte.'
      });
    }

    logger.info('[AppWebhook] Criando teste:', { 
      server: server.name, 
      package: pkg.name,
      duration: pkg.duration,
      unit: pkg.durationUnit 
    });

    // 8. Calcular data de expiração
    const expTimestamp = calculateExpTimestamp(pkg.duration, pkg.durationUnit);
    const expiresAt = unixToDate(expTimestamp);

    // 9. Preparar bouquets
    let bouquets: number[] = [];
    if (pkg.bouquets) {
      try {
        const parsed = typeof pkg.bouquets === 'string' 
          ? JSON.parse(pkg.bouquets) 
          : pkg.bouquets;
        if (Array.isArray(parsed)) {
          bouquets = parsed.map(b => typeof b === 'string' ? parseInt(b, 10) : b).filter(b => !isNaN(b));
        }
      } catch (e) {
        logger.warn('[AppWebhook] Erro ao parsear bouquets', { error: e });
      }
    }

    if (bouquets.length === 0) {
      bouquets = [1, 2, 3]; // Padrão
    }

    // 10. Gerar credenciais e criar no XUI
    const credentials = generateNumericCredentials();
    const dbClient = new XUIDBClient(server);

    try {
      // Verificar se username já existe
      const usernameExists = await dbClient.usernameExists(credentials.username);
      if (usernameExists) {
        const newCreds = generateNumericCredentials();
        credentials.username = newCreds.username;
        credentials.password = newCreds.password;
      }

      // Criar linha no banco XUI
      const lineId = await dbClient.createLine({
        username: credentials.username,
        password: credentials.password,
        exp_date: expTimestamp,
        is_trial: 1,
        member_id: resolveMemberIdForServer(server as any),
        bouquet: bouquets,
        allowed_outputs: [1, 2, 3],
        max_connections: pkg.connections || 1,
        admin_notes: `App ${config.name} - Teste - WhatsApp: ${phoneNumber}`,
        reseller_notes: note || undefined,
      });

      logger.info('[AppWebhook] Linha criada no XUI:', { 
        lineId, 
        username: credentials.username,
        expiresAt: expiresAt.toISOString() 
      });

      // 10.1 CRÍTICO: Ativar linha via UPDATE no banco (campo 'updated' é essencial!)
      // O XUI usa o campo 'updated' para detectar mudanças - sem isso a linha não funciona
      try {
        logger.info('[AppWebhook] Ativando linha via UPDATE no banco XUI...', { lineId });
        
        await dbClient.updateLine(lineId, {
          exp_date: expTimestamp,
          enabled: 1,
          is_trial: 1,
          bouquet: bouquets,
        });
        
        logger.info('[AppWebhook] Linha ativada no banco XUI (campo updated atualizado)', { lineId });
      } catch (updateError: any) {
        logger.warn('[AppWebhook] Erro ao ativar linha no banco:', { error: updateError.message });
      }

      await dbClient.disconnect();

      // 11. Salvar cliente no banco local
      // Buscar admin padrão para associar como reseller
      const adminUser = await prisma.user.findFirst({
        where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } }
      });

      if (adminUser) {
        const customer = await prisma.customer.create({
          data: {
            serverId: server.id,
            externalId: String(lineId),
            username: credentials.username,
            password: credentials.password,
            name: name || `App ${config.name}`,
            whatsapp: phoneNumber,
            email: email || null,
            packageId: pkg.id,
            resellerUserId: adminUser.id,
            isTrial: true,
            connections: pkg.connections || 1,
            expiresAt: expiresAt,
            status: 'ACTIVE',
          }
        });

        logger.info('[AppWebhook] Cliente salvo', { customerId: customer.id });

        // Enviar notificação de boas-vindas se configurado
        try {
          await botService.sendWelcomeNotification(
            adminUser.id,
            {
              ...customer,
              package: pkg,
              server: server,
            } as any,
            true // isTrial
          );
        } catch (notifError) {
          logger.warn('[AppWebhook] Erro ao enviar notificação', { error: notifError });
        }
      }

      // 12. Atualizar requisição como sucesso
      await prisma.appTestRequest.update({
        where: { id: testRequest.id },
        data: {
          status: 'success',
          username: credentials.username,
          password: credentials.password,
          expiresAt: expiresAt,
        }
      });

      // 13. Gerar URLs
      const dns = (server.dnsPrimary?.trim() || server.baseUrl).replace(/\/$/, '');

      const responseData: any = {
        success: true,
        message: 'Seu teste foi gerado e os dados de acesso serão enviados pelo WhatsApp informado.',
        username: credentials.username,
        password: credentials.password,
        expiresAt: expiresAt.toISOString(),
        dns: dns,
        m3uUrl: `${dns}/get.php?username=${credentials.username}&password=${credentials.password}&type=m3u_plus&output=mpegts`,
      };

      const elapsed = Date.now() - startTime;
      logger.info('[AppWebhook] Teste criado com sucesso:', { 
        phone: phoneNumber, 
        username: credentials.username,
        elapsed: `${elapsed}ms`
      });

      return res.status(201).json(responseData);

    } catch (dbError: any) {
      if (dbClient) {
        try { await dbClient.disconnect(); } catch {}
      }

      logger.error('[AppWebhook] Erro ao criar linha no XUI:', dbError);

      await prisma.appTestRequest.update({
        where: { id: testRequest.id },
        data: { 
          status: 'error', 
          errorMessage: dbError.message 
        }
      });

      return res.status(500).json({
        success: false,
        message: 'Não foi possível gerar o teste agora. Se você já utilizou seu teste gratuito, fale com nosso atendimento pelo WhatsApp para assinar.'
      });
    }

  } catch (error: any) {
    logger.error('[AppWebhook] Erro geral:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao se comunicar com o sistema de teste. Se o problema continuar, fale com nosso atendimento pelo WhatsApp.'
    });
  }
});

/**
 * GET /api/webhook/app/config
 * Lista configurações de webhook (protegido por auth)
 */
export const listConfigs = asyncHandler(async (req: Request, res: Response) => {
  const configs = await prisma.appWebhookConfig.findMany({
    orderBy: { createdAt: 'desc' }
  });

  // Buscar nomes dos servidores e pacotes
  const configsWithDetails = await Promise.all(
    configs.map(async (config) => {
      const server = await prisma.xuiServer.findUnique({
        where: { id: config.serverId },
        select: { name: true }
      });
      const pkg = await prisma.package.findUnique({
        where: { id: config.packageId },
        select: { name: true }
      });
      return {
        ...config,
        serverName: server?.name || 'N/A',
        packageName: pkg?.name || 'N/A',
        // Mascarar token
        apiToken: config.apiToken.substring(0, 8) + '...' + config.apiToken.substring(config.apiToken.length - 4),
      };
    })
  );

  res.json({ data: configsWithDetails });
});

/**
 * POST /api/webhook/app/config
 * Criar nova configuração de webhook
 */
export const createConfig = asyncHandler(async (req: Request, res: Response) => {
  const { name, serverId, packageId, maxTestsPerPhone, testCooldownDays } = req.body;

  if (!serverId || !packageId) {
    return res.status(400).json({ error: 'serverId e packageId são obrigatórios' });
  }

  // Verificar se servidor existe
  const server = await prisma.xuiServer.findUnique({ where: { id: serverId } });
  if (!server) {
    return res.status(404).json({ error: 'Servidor não encontrado' });
  }

  // Verificar se pacote existe e é de teste
  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg) {
    return res.status(404).json({ error: 'Pacote não encontrado' });
  }

  // Gerar token único
  const crypto = await import('crypto');
  const apiToken = crypto.randomBytes(32).toString('hex');

  const config = await prisma.appWebhookConfig.create({
    data: {
      name: name || 'App NEO',
      apiToken,
      serverId,
      packageId,
      maxTestsPerPhone: maxTestsPerPhone || 1,
      testCooldownDays: testCooldownDays || 0,
    }
  });

  logger.info('[AppWebhook] Configuração criada:', { id: config.id, name: config.name });

  res.status(201).json({
    data: {
      ...config,
      // Mostrar token completo apenas na criação
      apiToken: config.apiToken,
    },
    message: 'Configuração criada. Guarde o token, ele não será mostrado novamente!'
  });
});

/**
 * PUT /api/webhook/app/config/:id
 * Atualizar configuração de webhook
 */
export const updateConfig = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, serverId, packageId, maxTestsPerPhone, testCooldownDays, isActive } = req.body;

  const config = await prisma.appWebhookConfig.findUnique({ where: { id } });
  if (!config) {
    return res.status(404).json({ error: 'Configuração não encontrada' });
  }

  const updated = await prisma.appWebhookConfig.update({
    where: { id },
    data: {
      name: name !== undefined ? name : config.name,
      serverId: serverId || config.serverId,
      packageId: packageId || config.packageId,
      maxTestsPerPhone: maxTestsPerPhone !== undefined ? maxTestsPerPhone : config.maxTestsPerPhone,
      testCooldownDays: testCooldownDays !== undefined ? testCooldownDays : config.testCooldownDays,
      isActive: isActive !== undefined ? isActive : config.isActive,
    }
  });

  res.json({ data: updated });
});

/**
 * POST /api/webhook/app/config/:id/regenerate-token
 * Regenerar token de uma configuração
 */
export const regenerateToken = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const config = await prisma.appWebhookConfig.findUnique({ where: { id } });
  if (!config) {
    return res.status(404).json({ error: 'Configuração não encontrada' });
  }

  const crypto = await import('crypto');
  const newToken = crypto.randomBytes(32).toString('hex');

  const updated = await prisma.appWebhookConfig.update({
    where: { id },
    data: { apiToken: newToken }
  });

  logger.info('[AppWebhook] Token regenerado:', { id, name: config.name });

  res.json({
    data: {
      ...updated,
      apiToken: newToken,
    },
    message: 'Token regenerado. Guarde o novo token, ele não será mostrado novamente!'
  });
});

/**
 * DELETE /api/webhook/app/config/:id
 * Excluir configuração de webhook
 */
export const deleteConfig = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const config = await prisma.appWebhookConfig.findUnique({ where: { id } });
  if (!config) {
    return res.status(404).json({ error: 'Configuração não encontrada' });
  }

  await prisma.appWebhookConfig.delete({ where: { id } });

  logger.info('[AppWebhook] Configuração excluída:', { id, name: config.name });

  res.json({ message: 'Configuração excluída' });
});

/**
 * GET /api/webhook/app/logs
 * Listar logs de requisições
 */
export const listLogs = asyncHandler(async (req: Request, res: Response) => {
  const { configId, status, page = 1, perPage = 50 } = req.query;

  const where: any = {};
  if (configId) where.configId = configId;
  if (status) where.status = status;

  const [logs, total] = await Promise.all([
    prisma.appTestRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(perPage),
      take: Number(perPage),
    }),
    prisma.appTestRequest.count({ where })
  ]);

  res.json({
    data: logs,
    meta: {
      total,
      page: Number(page),
      perPage: Number(perPage),
      totalPages: Math.ceil(total / Number(perPage)),
    }
  });
});
