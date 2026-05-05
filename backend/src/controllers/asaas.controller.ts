import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { AsaasService, getAsaasService } from '../services/asaas.service.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import crypto from 'crypto';

const logger = createLogger('AsaasController');

// ==========================================
// CONFIGURAÇÃO
// ==========================================

export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const config = await prisma.asaasConfig.findUnique({
    where: { userId },
    select: {
      id: true,
      environment: true,
      pixKey: true,
      isActive: true,
      createdAt: true,
      webhookToken: true,
    },
  });

  // Adicionar webhookUrl se config existir
  if (config?.webhookToken) {
    const baseUrl = process.env.API_URL || process.env.BACKEND_URL || 
      `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/asaas/webhook/${config.webhookToken}`;
    res.json({ 
      data: {
        ...config,
        webhookUrl,
      } 
    });
  } else {
    res.json({ data: config });
  }
});

export const saveConfig = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { apiKey, environment, pixKey } = req.body;

  if (!apiKey) {
    throw new AppError(400, 'API Key é obrigatória');
  }

  // Testar conexão antes de salvar
  const service = new AsaasService(apiKey, environment === 'sandbox');
  const isValid = await service.testConnection();

  if (!isValid) {
    throw new AppError(400, 'API Key inválida ou sem permissão');
  }

  // Criptografar e salvar
  const encryptedKey = encrypt(apiKey);

  // Gerar token de webhook se não tiver
  let webhookToken = crypto.randomBytes(32).toString('hex');

  const existingConfig = await prisma.asaasConfig.findUnique({
    where: { userId },
  });

  if (existingConfig?.webhookToken) {
    webhookToken = existingConfig.webhookToken;
  }

  const config = await prisma.asaasConfig.upsert({
    where: { userId },
    update: {
      apiKey: encryptedKey,
      environment: environment || 'sandbox',
      pixKey,
      isActive: true,
      webhookToken,
    },
    create: {
      userId,
      apiKey: encryptedKey,
      environment: environment || 'sandbox',
      pixKey,
      isActive: true,
      webhookToken,
    },
  });

  logger.info(`[Asaas] Configuração salva para usuário ${userId}`);

  // Usar a URL da requisição ou variável de ambiente
  const baseUrl = process.env.API_URL || process.env.BACKEND_URL || 
    `${req.protocol}://${req.get('host')}`;
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/asaas/webhook/${config.webhookToken}`;

  res.json({
    success: true,
    message: 'Configuração salva com sucesso',
    data: {
      id: config.id,
      environment: config.environment,
      webhookUrl,
    },
  });
});

export const testConnection = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const service = await getAsaasService(userId);
  if (!service) {
    throw new AppError(400, 'Asaas não configurado');
  }

  const isConnected = await service.testConnection();

  res.json({
    success: isConnected,
    message: isConnected ? 'Conexão OK' : 'Falha na conexão',
  });
});

// ==========================================
// COBRANÇAS
// ==========================================

export const createPayment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { customerId, packageId, value, dueDate, description } = req.body;

  if (!customerId) throw new AppError(400, 'customerId é obrigatório');
  if (!value || value <= 0) throw new AppError(400, 'value deve ser maior que 0');

  // Buscar cliente local
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { package: true, server: true },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  // Verificar se o cliente pertence ao usuário
  if (customer.resellerUserId !== userId) {
    throw new AppError(403, 'Sem permissão para criar cobrança para este cliente');
  }

  // Obter serviço Asaas
  const service = await getAsaasService(userId);
  if (!service) {
    throw new AppError(400, 'Asaas não configurado');
  }

  // Criar ou buscar cliente no Asaas
  const asaasCustomer = await service.getOrCreateCustomer({
    name: customer.name || `Cliente ${customer.username}`,
    phone: customer.whatsapp,
    email: customer.email,
    externalReference: customer.id,
  });

  // Calcular data de vencimento
  const paymentDueDate = dueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Criar cobrança
  const payment = await service.createPixPayment({
    customerId: asaasCustomer.id,
    value: value,
    dueDate: paymentDueDate,
    description: description || `Renovação IPTV - ${customer.package?.name || 'Plano'}`,
    externalReference: customerId,
  });

  // Buscar QR Code
  const qrCode = await service.getPixQrCode(payment.id);

  // Salvar no banco local
  const localPayment = await prisma.asaasPayment.create({
    data: {
      asaasId: payment.id,
      customerId: customer.id,
      asaasCustomerId: asaasCustomer.id,
      value: payment.value,
      dueDate: new Date(payment.dueDate),
      status: payment.status,
      billingType: 'PIX',
      invoiceUrl: payment.invoiceUrl,
      pixQrCode: qrCode.encodedImage,
      pixCopyPaste: qrCode.payload,
      packageId: packageId || customer.packageId,
      daysToRenew: customer.package?.duration || 30,
    },
  });

  logger.info(`[Asaas] Cobrança criada: ${payment.id} para cliente ${customer.username}`);

  // Gerar URL pública de pagamento
  const baseUrl = process.env.API_URL || process.env.BACKEND_URL || 
    `${req.protocol}://${req.get('host')}`;
  const paymentUrl = `${baseUrl.replace(/\/$/, '')}/api/asaas/pay/${localPayment.id}`;

  res.status(201).json({
    success: true,
    data: {
      id: localPayment.id,
      asaasId: payment.id,
      value: payment.value,
      dueDate: payment.dueDate,
      status: payment.status,
      paymentUrl, // URL pública para pagamento
      invoiceUrl: payment.invoiceUrl,
      pixQrCode: qrCode.encodedImage,
      pixCopyPaste: qrCode.payload,
      expirationDate: qrCode.expirationDate,
    },
  });
});

export const listPayments = asyncHandler(async (req: Request, res: Response) => {
  const { customerId } = req.params;
  const userId = req.user!.userId;

  // Verificar se o cliente pertence ao usuário
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  if (customer.resellerUserId !== userId) {
    throw new AppError(403, 'Sem permissão para ver cobranças deste cliente');
  }

  const payments = await prisma.asaasPayment.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ data: payments });
});

export const getQrCode = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const payment = await prisma.asaasPayment.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!payment) {
    throw new AppError(404, 'Cobrança não encontrada');
  }

  if (payment.customer.resellerUserId !== userId) {
    throw new AppError(403, 'Sem permissão');
  }

  // Se já tem QR Code salvo, retornar
  if (payment.pixQrCode && payment.pixCopyPaste) {
    return res.json({
      data: {
        qrCode: payment.pixQrCode,
        copyPaste: payment.pixCopyPaste,
      },
    });
  }

  // Buscar novo QR Code
  const service = await getAsaasService(userId);
  if (!service) {
    throw new AppError(400, 'Asaas não configurado');
  }

  const qrCode = await service.getPixQrCode(payment.asaasId);

  // Atualizar no banco
  await prisma.asaasPayment.update({
    where: { id },
    data: {
      pixQrCode: qrCode.encodedImage,
      pixCopyPaste: qrCode.payload,
    },
  });

  res.json({
    data: {
      qrCode: qrCode.encodedImage,
      copyPaste: qrCode.payload,
      expirationDate: qrCode.expirationDate,
    },
  });
});

// ==========================================
// LINK DE PAGAMENTO PÚBLICO
// ==========================================

export const getPaymentPage = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  const payment = await prisma.asaasPayment.findUnique({
    where: { id: token },
    include: {
      customer: {
        include: { package: true, server: true },
      },
    },
  });

  if (!payment) {
    throw new AppError(404, 'Pagamento não encontrado');
  }

  // Se já foi pago
  if (payment.status === 'RECEIVED' || payment.status === 'CONFIRMED') {
    return res.json({
      status: 'PAID',
      message: 'Este pagamento já foi confirmado!',
      paidAt: payment.paidAt,
    });
  }

  res.json({
    status: payment.status,
    customer: {
      name: payment.customer.name,
      username: payment.customer.username,
    },
    package: payment.customer.package?.name,
    value: payment.value,
    dueDate: payment.dueDate,
    invoiceUrl: payment.invoiceUrl,
    pixQrCode: payment.pixQrCode,
    pixCopyPaste: payment.pixCopyPaste,
  });
});

