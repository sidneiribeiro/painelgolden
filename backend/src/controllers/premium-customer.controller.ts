import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { XUIDBClient } from '../services/xui.db.client.js';
import { XUIClient } from '../services/xui.client.js';
import { getAsaasService } from '../services/asaas.service.js';
import { decrypt } from '../utils/crypto.js';

const logger = createLogger('PremiumCustomerController');

const JWT_SECRET = process.env.JWT_SECRET || 'premium-customer-secret-key';

/**
 * Login do cliente premium
 */
export const loginCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError(400, 'Email e senha são obrigatórios');
  }

  const customer = await prisma.premiumCustomer.findUnique({
    where: { email },
  });

  if (!customer) {
    throw new AppError(401, 'Email ou senha incorretos');
  }

  const isPasswordValid = await bcrypt.compare(password, customer.passwordHash);

  if (!isPasswordValid) {
    throw new AppError(401, 'Email ou senha incorretos');
  }

  if (!customer.isActive) {
    throw new AppError(403, 'Conta desativada. Entre em contato com o suporte.');
  }

  // Gerar token JWT
  const token = jwt.sign(
    { 
      customerId: customer.id, 
      email: customer.email,
      type: 'premium_customer' 
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  logger.info('[LoginCustomer] Login realizado', { customerId: customer.id });

  return res.json({
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
    },
  });
});

/**
 * Obter dados do cliente logado e suas fontes
 */
export const getCustomerDashboard = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;

  const customer = await prisma.premiumCustomer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
    },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  // Buscar fontes do cliente
  const sources = await prisma.premiumSource.findMany({
    where: { premiumCustomerId: customerId },
    include: {
      plan: {
        select: {
          id: true,
          name: true,
          maxConnections: true,
        },
      },
      server: {
        select: {
          id: true,
          name: true,
          baseUrl: true,
          dnsPrimary: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Gerar URLs M3U para cada fonte
  const sourcesWithUrls = sources.map((source) => {
    const dns = source.server.dnsPrimary || source.server.baseUrl;
    return {
      id: source.id,
      username: source.username,
      password: source.password,
      status: source.status,
      expiresAt: source.expiresAt,
      plan: source.plan,
      server: {
        id: source.server.id,
        name: source.server.name,
      },
      urls: {
        m3u_ts: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=mpegts`,
        m3u_hls: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=hls`,
      },
    };
  });

  return res.json({
    customer,
    sources: sourcesWithUrls,
  });
});

/**
 * Obter detalhes de uma fonte específica
 */
export const getSourceDetails = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;
  const { sourceId } = req.params;

  const source = await prisma.premiumSource.findFirst({
    where: { id: sourceId, premiumCustomerId: customerId },
    include: {
      plan: true,
      server: {
        select: {
          id: true,
          name: true,
          baseUrl: true,
          dnsPrimary: true,
        },
      },
    },
  });

  if (!source) {
    throw new AppError(404, 'Fonte não encontrada');
  }

  const dns = source.server.dnsPrimary || source.server.baseUrl;

  return res.json({
    source: {
      id: source.id,
      username: source.username,
      password: source.password,
      status: source.status,
      expiresAt: source.expiresAt,
      plan: source.plan,
      server: {
        id: source.server.id,
        name: source.server.name,
      },
      urls: {
        m3u_ts: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=mpegts`,
        m3u_hls: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=hls`,
      },
    },
  });
});

/**
 * Listar planos disponíveis para upgrade/downgrade
 */
export const listUpgradePlans = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;
  const { sourceId } = req.params;

  // Buscar fonte atual
  const source = await prisma.premiumSource.findFirst({
    where: { id: sourceId, premiumCustomerId: customerId },
    include: { plan: true },
  });

  if (!source) {
    throw new AppError(404, 'Fonte não encontrada');
  }

  // Buscar todos os planos ativos
  const plans = await prisma.premiumPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  // Marcar plano atual
  const plansWithCurrent = plans.map((plan) => ({
    ...plan,
    isCurrent: plan.id === source.planId,
    type: plan.maxConnections > source.plan.maxConnections 
      ? 'upgrade' 
      : plan.maxConnections < source.plan.maxConnections 
        ? 'downgrade' 
        : 'current',
  }));

  return res.json({
    currentPlan: source.plan,
    plans: plansWithCurrent,
  });
});

/**
 * Atualizar dados do cliente
 */
export const updateCustomerProfile = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;
  const { name, phone, currentPassword, newPassword } = req.body;

  const customer = await prisma.premiumCustomer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  const updateData: any = {};

  if (name) updateData.name = name;
  if (phone) updateData.phone = phone;

  // Se está alterando senha
  if (currentPassword && newPassword) {
    const isPasswordValid = await bcrypt.compare(currentPassword, customer.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(400, 'Senha atual incorreta');
    }
    updateData.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  const updatedCustomer = await prisma.premiumCustomer.update({
    where: { id: customerId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  });

  return res.json({
    customer: updatedCustomer,
    message: 'Perfil atualizado com sucesso!',
  });
});

/**
 * Middleware de autenticação para clientes premium
 */
export const authenticateCustomer = asyncHandler(async (req: Request, res: Response, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'Token não fornecido');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    if (decoded.type !== 'premium_customer') {
      throw new AppError(401, 'Token inválido');
    }

    (req as any).customerId = decoded.customerId;
    next();
  } catch (error) {
    throw new AppError(401, 'Token inválido ou expirado');
  }
});

/**
 * Obter conexões ativas de uma fonte (monitoramento)
 * Usa a API do XUI para obter conexões em tempo real
 */
export const getSourceConnections = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;
  const { sourceId } = req.params;

  // Buscar fonte do cliente
  const source = await prisma.premiumSource.findFirst({
    where: { id: sourceId, premiumCustomerId: customerId },
    include: {
      server: true,
      plan: true,
    },
  });

  if (!source) {
    throw new AppError(404, 'Fonte não encontrada');
  }

  try {
    // Usar a API do XUI para buscar conexões em tempo real
    const xuiClient = new XUIClient(source.server);
    const allConnections = await xuiClient.getLiveConnections();
    
    // Filtrar apenas as conexões desta linha (user_id)
    const lineId = parseInt(source.xuiLineId);
    const userConnections = allConnections.filter(
      (conn: any) => parseInt(conn.user_id) === lineId
    );

    // Mapear os dados das conexões
    const mappedConnections = userConnections.map((conn: any) => ({
      id: conn.activity_id || conn.id,
      ip: conn.user_ip,
      userAgent: conn.user_agent,
      container: conn.container,
      country: conn.geoip_country_code || conn.country,
      isp: conn.isp,
      stream: conn.stream_display_name || `Stream #${conn.stream_id}`,
      bitrate: conn.bitrate,
      startedAt: conn.date_start ? new Date(parseInt(conn.date_start) * 1000).toISOString() : null,
    }));

    logger.info(`[GetConnections] Fonte ${sourceId} (user_id ${lineId}): ${mappedConnections.length}/${source.plan.maxConnections} conexões (API retornou ${allConnections.length} total)`);

    return res.json({
      maxConnections: source.plan.maxConnections,
      activeConnections: mappedConnections.length,
      connections: mappedConnections,
    });

  } catch (error: any) {
    logger.error(`[GetConnections] Erro API: ${error.message}`);
    
    // Fallback: retorna apenas o limite
    return res.json({
      maxConnections: source.plan.maxConnections,
      activeConnections: 0,
      connections: [],
      error: 'Não foi possível obter conexões em tempo real',
    });
  }
});

/**
 * Editar senha da fonte (atualiza no XUI e no banco local)
 */
export const updateSourcePassword = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;
  const { sourceId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 4) {
    throw new AppError(400, 'A nova senha deve ter pelo menos 4 caracteres');
  }

  // Verificar se a senha contém apenas caracteres válidos
  if (!/^[a-zA-Z0-9_-]+$/.test(newPassword)) {
    throw new AppError(400, 'A senha deve conter apenas letras, números, _ ou -');
  }

  // Buscar fonte do cliente
  const source = await prisma.premiumSource.findFirst({
    where: { id: sourceId, premiumCustomerId: customerId },
    include: { server: true },
  });

  if (!source) {
    throw new AppError(404, 'Fonte não encontrada');
  }

  try {
    // Atualizar no XUI
    const dbClient = new XUIDBClient(source.server);
    await dbClient.updateLine(parseInt(source.xuiLineId), {
      password: newPassword,
    });
    await dbClient.disconnect();

    // Atualizar no banco local
    await prisma.premiumSource.update({
      where: { id: sourceId },
      data: { password: newPassword },
    });

    logger.info(`[UpdatePassword] Senha da fonte ${sourceId} alterada`);

    // Gerar novas URLs com a nova senha
    const dns = source.server.dnsPrimary || source.server.baseUrl;
    const urls = {
      m3u_ts: `${dns}/get.php?username=${source.username}&password=${newPassword}&type=m3u_plus&output=mpegts`,
      m3u_hls: `${dns}/get.php?username=${source.username}&password=${newPassword}&type=m3u_plus&output=hls`,
    };

    return res.json({
      message: 'Senha alterada com sucesso!',
      password: newPassword,
      urls,
    });

  } catch (error: any) {
    logger.error(`[UpdatePassword] Erro ao alterar senha: ${error.message}`);
    throw new AppError(500, 'Erro ao alterar senha. Tente novamente.');
  }
});

/**
 * Criar checkout para upgrade/downgrade de plano
 */
export const createUpgradeCheckout = asyncHandler(async (req: Request, res: Response) => {
  const customerId = (req as any).customerId;
  const { sourceId } = req.params;
  const { planId } = req.body;

  if (!planId) {
    throw new AppError(400, 'Plano não especificado');
  }

  // Buscar fonte atual do cliente
  const source = await prisma.premiumSource.findFirst({
    where: { id: sourceId, premiumCustomerId: customerId },
    include: {
      plan: true,
      server: true,
      premiumCustomer: true,
    },
  });

  if (!source) {
    throw new AppError(404, 'Fonte não encontrada');
  }

  if (source.planId === planId) {
    throw new AppError(400, 'Você já está neste plano');
  }

  // Buscar novo plano
  const newPlan = await prisma.premiumPlan.findUnique({
    where: { id: planId },
  });

  if (!newPlan || !newPlan.isActive) {
    throw new AppError(404, 'Plano não encontrado ou inativo');
  }

  // Calcular valor proporcional (simplificado)
  // Para upgrade, cobra a diferença; para downgrade, não cobra
  const isUpgrade = newPlan.maxConnections > source.plan.maxConnections;
  const amount = newPlan.credits || 0; // credits é o preço do plano

  if (!isUpgrade) {
    // Downgrade: aplicar na próxima renovação, sem custo imediato
    // Por agora, vamos apenas alterar o plano diretamente
    try {
      // Atualizar conexões no XUI
      const dbClient = new XUIDBClient(source.server);
      await dbClient.updateLine(parseInt(source.xuiLineId), {
        max_connections: newPlan.maxConnections,
      });
      await dbClient.disconnect();

      // Atualizar no banco local
      await prisma.premiumSource.update({
        where: { id: sourceId },
        data: { planId: newPlan.id },
      });

      logger.info(`[Downgrade] Fonte ${sourceId} alterada para plano ${newPlan.name}`);

      return res.json({
        success: true,
        message: `Plano alterado para ${newPlan.name} com sucesso!`,
        isUpgrade: false,
        newPlan: {
          id: newPlan.id,
          name: newPlan.name,
          maxConnections: newPlan.maxConnections,
        },
      });
    } catch (error: any) {
      logger.error(`[Downgrade] Erro: ${error.message}`);
      throw new AppError(500, 'Erro ao fazer downgrade. Tente novamente.');
    }
  }

  // Buscar configuração Asaas
  const adminUser = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
  });

  if (!adminUser) {
    throw new AppError(500, 'Configuração não encontrada');
  }

  const asaasConfig = await prisma.asaasConfig.findFirst({
    where: { userId: adminUser.id },
  });

  if (!asaasConfig) {
    throw new AppError(500, 'Pagamentos não configurados');
  }

  // Para upgrade, criar um checkout
  const customer = source.premiumCustomer;
  if (!customer) {
    throw new AppError(500, 'Cliente não encontrado');
  }

  // Buscar bouquet do servidor
  const bouquet = await prisma.bouquet.findFirst({
    where: { serverId: source.server.id },
  });

  if (!bouquet) {
    throw new AppError(500, 'Bouquet não encontrado');
  }

  // Criar checkout de upgrade
  const checkout = await prisma.checkout.create({
    data: {
      premiumCustomerId: customerId,
      planId: newPlan.id,
      serverId: source.server.id,
      bouquetId: bouquet.id,
      durationDays: 30, // Adiciona 30 dias
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone || '',
      customerDocument: customer.document,
      paymentMethod: 'PIX',
      status: 'pending',
      amount: amount,
    },
  });

  // Gerar QR Code PIX
  let pixData: { qrCodeImage?: string; qrCodeText?: string } = {};
  
  try {
    const service = await getAsaasService(adminUser.id);
    
    if (service && asaasConfig.pixKey) {
      // Criar QR Code PIX estático
      const staticQrCode = await service.createStaticPixQrCode({
        addressKey: asaasConfig.pixKey,
        description: `Upgrade para ${newPlan.name} - ${customer.name}`,
        value: amount,
        externalReference: `upgrade_${checkout.id}`,
      });

      // Atualizar checkout com dados do PIX
      await prisma.checkout.update({
        where: { id: checkout.id },
        data: {
          asaasPaymentId: `static_${checkout.id}`,
          pixQrCode: staticQrCode.encodedImage,
          pixCopyPaste: staticQrCode.payload,
          status: 'waiting_payment',
        },
      });

      pixData = {
        qrCodeImage: staticQrCode.encodedImage,
        qrCodeText: staticQrCode.payload,
      };

      logger.info(`[Upgrade] QR Code PIX criado para checkout ${checkout.id}`);
    }
  } catch (error: any) {
    logger.error(`[Upgrade] Erro ao criar QR Code PIX: ${error.message}`);
    // Continua mesmo sem PIX
  }

  logger.info(`[Upgrade] Checkout criado para upgrade: ${checkout.id}`);

  return res.json({
    success: true,
    message: 'Checkout de upgrade criado',
    isUpgrade: true,
    checkout: {
      id: checkout.id,
      amount: amount,
      newPlan: {
        id: newPlan.id,
        name: newPlan.name,
        maxConnections: newPlan.maxConnections,
      },
    },
    pix: pixData.qrCodeImage ? pixData : null,
  });
});
