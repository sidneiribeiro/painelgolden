import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { getAsaasService } from '../services/asaas.service.js';
import crypto from 'crypto';

const logger = createLogger('PublicPaymentController');

/**
 * Busca dados do cliente pelo token de pagamento
 */
export const getCustomerByToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  const customer = await prisma.customer.findUnique({
    where: { paymentToken: token },
    include: {
      package: true,
      server: {
        select: {
          dnsPrimary: true,
          dnsList: true,
        },
      },
    },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  if (customer.status !== 'ACTIVE') {
    throw new AppError(400, 'Cliente inativo');
  }

  // Formatar data de vencimento
  const expiresAt = new Date(customer.expiresAt);
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  res.json({
    success: true,
    data: {
      username: customer.username,
      name: customer.name || 'Cliente',
      package: customer.package?.name || 'Não informado',
      expiresAt: expiresAt.toISOString(),
      daysUntilExpiry: daysUntilExpiry,
      isTrial: customer.isTrial,
      dns: customer.server.dnsPrimary || '',
    },
  });
});

/**
 * Gera token único para o cliente se não tiver
 */
export const generatePaymentToken = asyncHandler(async (req: Request, res: Response) => {
  const { customerId } = req.params;
  const userId = req.user!.userId;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  if (customer.resellerUserId !== userId) {
    throw new AppError(403, 'Sem permissão');
  }

  // Gerar token único se não tiver
  let token = customer.paymentToken;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    await prisma.customer.update({
      where: { id: customerId },
      data: { paymentToken: token },
    });
  }

  const baseUrl = process.env.API_URL || process.env.BACKEND_URL || 
    `${req.protocol}://${req.get('host')}`;
  const paymentUrl = `${baseUrl.replace(/\/$/, '')}/pay/${token}`;

  res.json({
    success: true,
    data: {
      token,
      paymentUrl,
    },
  });
});

/**
 * Busca pacotes disponíveis para renovação
 */
export const getAvailablePackages = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  const customer = await prisma.customer.findUnique({
    where: { paymentToken: token },
    include: {
      server: {
        include: {
          packages: {
            where: {
              isActive: true,
              isTrial: false,
            },
            orderBy: {
              planPrice: 'asc',
            },
          },
        },
      },
    },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  // Sempre usar 30 dias por mês (valores fixos)
  const daysPerMonth = 30;
  
  const options = [
    { months: 1, label: '1 Mês', duration: daysPerMonth, price: 3000 }, // R$ 30,00 - 30 dias
    { months: 4, label: '4 Meses', duration: daysPerMonth * 4, price: 10000 }, // R$ 100,00 - 120 dias
    { months: 6, label: '6 Meses', duration: daysPerMonth * 6, price: 15000 }, // R$ 150,00 - 180 dias
    { months: 12, label: '12 Meses', duration: daysPerMonth * 12, price: 28000 }, // R$ 280,00 - 360 dias
  ];

  res.json({
    success: true,
    data: options,
  });
});

/**
 * Gera pagamento PIX para renovação
 */
export const generatePixPayment = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { months } = req.body; // 1, 4, 6 ou 12 meses

  if (!months || ![1, 4, 6, 12].includes(months)) {
    throw new AppError(400, 'Período inválido. Use 1, 4, 6 ou 12 meses');
  }

  const customer = await prisma.customer.findUnique({
    where: { paymentToken: token },
    include: {
      package: true,
      server: true,
      reseller: {
        include: {
          asaasConfig: true,
        },
      },
    },
  });

  if (!customer) {
    throw new AppError(404, 'Cliente não encontrado');
  }

  if (customer.status !== 'ACTIVE') {
    throw new AppError(400, 'Cliente inativo');
  }

  // Verificar se Asaas está configurado
  const asaasConfig = customer.reseller.asaasConfig;
  if (!asaasConfig || !asaasConfig.isActive) {
    throw new AppError(400, 'Sistema de pagamento não configurado');
  }

  // Valores fixos conforme solicitado
  const prices: Record<number, number> = {
    1: 3000,   // R$ 30,00
    4: 10000,  // R$ 100,00
    6: 15000,  // R$ 150,00
    12: 28000, // R$ 280,00
  };

  // Sempre usar 30 dias por mês (independente do pacote)
  const daysPerMonth = 30;
  
  const valueInCents = prices[months];
  const valueInReais = valueInCents / 100;
  const daysToRenew = daysPerMonth * months; // 1 mês = 30 dias, 4 meses = 120 dias, etc.
  
  logger.info(`[PublicPayment] Calculando renovação: ${months} meses = ${daysToRenew} dias`);

  // Data de vencimento do pagamento (3 dias a partir de agora)
  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Criar pagamento PIX direto no Asaas (não Payment Link)
  const service = await getAsaasService(customer.resellerUserId);
  if (!service) {
    throw new AppError(400, 'Erro ao conectar com sistema de pagamento');
  }

  // Usar QR Code Estático (não exige CPF/CNPJ)
  // O Asaas cria cliente e cobrança automaticamente quando receber o pagamento
  let qrCode: any;
  
  try {
    // Verificar se tem chave PIX configurada
    const pixKey = asaasConfig.pixKey;
    if (!pixKey) {
      throw new AppError(400, 'Chave PIX não configurada no Asaas. Configure em Configurações > Asaas');
    }

    logger.info(`[PublicPayment] Criando QR Code PIX Estático para cliente ${customer.username}`);

    // Criar descrição curta (máximo 37 caracteres para QR Code estático)
    // Formatos: "Renovacao IPTV 1 mes" (19 chars), "Renovacao IPTV 12 meses" (22 chars)
    const description = `Renovacao IPTV ${months} ${months === 1 ? 'mes' : 'meses'}`.substring(0, 37);

    // Criar QR Code Estático usando a chave PIX cadastrada
    const staticQrCode = await service.createStaticPixQrCode({
      addressKey: pixKey,
      description: description,
      value: valueInReais,
      externalReference: customer.id, // Para identificar quando o pagamento chegar
    });

    // Converter para formato compatível com o frontend
    qrCode = {
      encodedImage: staticQrCode.encodedImage,
      payload: staticQrCode.payload,
      // QR Code estático não tem expirationDate
    };

    logger.info(`[PublicPayment] QR Code PIX Estático criado com sucesso`);
    
  } catch (error: any) {
    logger.error(`[PublicPayment] Erro ao criar QR Code PIX Estático: ${error.message}`, { error: error.response?.data });
    const errorMessage = error.response?.data?.errors?.[0]?.description || error.message;
    throw new AppError(400, `Erro ao criar QR Code PIX: ${errorMessage}`);
  }

  // Salvar referência do QR Code estático (ainda não temos payment ID do Asaas)
  // O Asaas criará a cobrança automaticamente quando receber o pagamento via webhook
  const localPayment = await prisma.asaasPayment.create({
    data: {
      asaasId: `static_${customer.id}_${Date.now()}`, // ID temporário até receber webhook
      customerId: customer.id,
      asaasCustomerId: '', // Será preenchido pelo webhook quando pagamento for recebido
      value: valueInCents, // Salvar em centavos
      dueDate: new Date(dueDate),
      status: 'PENDING',
      billingType: 'PIX',
      invoiceUrl: null,
      pixQrCode: qrCode.encodedImage, // QR Code em base64
      pixCopyPaste: qrCode.payload, // Código copia e cola
      packageId: customer.packageId,
      daysToRenew: daysToRenew,
    },
  });

  logger.info(`[PublicPayment] QR Code PIX Estático criado para cliente ${customer.username}`);

  res.json({
    success: true,
    data: {
      paymentId: localPayment.id,
      value: valueInReais,
      valueFormatted: `R$ ${valueInReais.toFixed(2).replace('.', ',')}`,
      months: months,
      daysToRenew: daysToRenew,
      dueDate: dueDate,
      pixQrCode: qrCode.encodedImage, // QR Code em base64
      pixCopyPaste: qrCode.payload, // Código PIX copia e cola
      // QR Code estático não tem expirationDate
    },
  });
});
