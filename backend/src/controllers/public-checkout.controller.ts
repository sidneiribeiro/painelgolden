import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { getAsaasService } from '../services/asaas.service.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const logger = createLogger('PublicCheckoutController');

// ID do admin para pegar config do Asaas
const ADMIN_USER_ID = '2dfb0784-e0c7-4e33-9758-10825b4ab089';

// Servidor e Bouquet padrão APENAS como fallback se o plano não tiver configurado
const DEFAULT_SERVER_ID = 'ca641c22-1d3a-4983-bd5d-42ca0ff3416a'; // XUIONE DEMO
const DEFAULT_BOUQUET_ID = '98428ed6-fcd4-4b78-910f-0ff9225fa78b';

/**
 * Iniciar processo de checkout (público - sem autenticação)
 */
export const initiateCheckout = asyncHandler(async (req: Request, res: Response) => {
  const { 
    planId, 
    durationDays = 30, 
    customerInfo, 
    paymentMethod = 'PIX' 
  } = req.body;

  logger.info('[InitiateCheckout] Novo checkout iniciado', { planId, paymentMethod });

  // Validações
  if (!planId || !customerInfo) {
    throw new AppError(400, 'Campos obrigatórios: planId, customerInfo');
  }

  if (!customerInfo.name || !customerInfo.email || !customerInfo.phone || !customerInfo.password) {
    throw new AppError(400, 'Informações do cliente incompletas: name, email, phone, password são obrigatórios');
  }

  // Verificar se email já existe
  const existingCustomer = await prisma.premiumCustomer.findUnique({
    where: { email: customerInfo.email },
  });

  // Verificar se plano existe e buscar dados completos
  const plan = await prisma.premiumPlan.findUnique({
    where: { id: planId, isActive: true },
  });

  if (!plan) {
    throw new AppError(404, 'Plano não encontrado ou inativo');
  }

  // Usar servidor do plano ou fallback para padrão
  const serverId = plan.serverId || DEFAULT_SERVER_ID;
  
  // Usar primeiro bouquet do plano ou fallback para padrão
  let bouquetId = DEFAULT_BOUQUET_ID;
  try {
    const planBouquets = JSON.parse(plan.bouquetIds || '[]');
    if (planBouquets.length > 0) {
      // Buscar o bouquet pelo externalId para obter o ID local
      const bouquet = await prisma.bouquet.findFirst({
        where: {
          serverId: serverId,
          externalId: String(planBouquets[0]),
        },
      });
      if (bouquet) {
        bouquetId = bouquet.id;
      }
    }
  } catch (e) {
    logger.warn('[InitiateCheckout] Erro ao parsear bouquetIds do plano, usando padrão', e);
  }

  logger.info('[InitiateCheckout] Usando servidor e bouquet do plano', { serverId, bouquetId, planBouquets: plan.bouquetIds });

  // Calcular valor baseado na duração
  const basePrice = plan.credits;
  let multiplier = 1;
  if (durationDays === 90) multiplier = 2.7; // 10% desconto
  else if (durationDays === 180) multiplier = 5; // ~17% desconto
  else if (durationDays === 365) multiplier = 9; // ~25% desconto
  const amount = Math.round(basePrice * multiplier * 100) / 100;

  // Hash da senha
  const passwordHash = await bcrypt.hash(customerInfo.password, 10);

  // Criar checkout no banco
  const checkout = await prisma.checkout.create({
    data: {
      customerId: existingCustomer?.id || null,
      planId,
      serverId,
      bouquetId,
      durationDays: parseInt(durationDays.toString()),
      amount,
      paymentMethod,
      status: 'pending',
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      customerPassword: passwordHash,
      customerDocument: customerInfo.cpf || null,
    },
  });

  logger.info('[InitiateCheckout] Checkout criado', { checkoutId: checkout.id });

  // Integrar com Asaas para gerar PIX Estático (não requer CPF/CNPJ)
  let pixData = null;
  try {
    const asaasService = await getAsaasService(ADMIN_USER_ID);
    
    if (asaasService && paymentMethod === 'PIX') {
      // Buscar configuração do Asaas para pegar a chave PIX
      const asaasConfig = await prisma.asaasConfig.findUnique({
        where: { userId: ADMIN_USER_ID },
      });

      if (!asaasConfig?.pixKey) {
        logger.error('[InitiateCheckout] Chave PIX não configurada');
        throw new Error('Chave PIX não configurada no Asaas');
      }

      logger.info('[InitiateCheckout] Criando QR Code PIX Estático...');

      // Criar descrição curta (máximo 37 caracteres para QR Code estático)
      const description = `Premium ${plan.maxConnections}con ${durationDays}d`.substring(0, 37);

      // Criar QR Code Estático usando a chave PIX cadastrada (NÃO REQUER CPF!)
      const staticQrCode = await asaasService.createStaticPixQrCode({
        addressKey: asaasConfig.pixKey,
        description: description,
        value: amount,
        externalReference: checkout.id, // Para identificar quando o pagamento chegar
      });

      logger.info('[InitiateCheckout] QR Code PIX Estático criado', {
        hasImage: !!staticQrCode.encodedImage,
        hasPayload: !!staticQrCode.payload,
      });

      // Atualizar checkout com dados do Asaas
      await prisma.checkout.update({
        where: { id: checkout.id },
        data: {
          asaasPaymentId: `static_${checkout.id}`, // QR Code estático não tem payment ID
          pixQrCode: staticQrCode.encodedImage,
          pixCopyPaste: staticQrCode.payload,
          status: 'waiting_payment',
        },
      });

      pixData = {
        qrCodeImage: staticQrCode.encodedImage,
        qrCodeText: staticQrCode.payload,
      };
    }
  } catch (error: any) {
    logger.error('[InitiateCheckout] Erro ao criar QR Code PIX:', error.message, error.response?.data);
    // Continua mesmo sem PIX - pode ser pago manualmente
  }

  return res.status(201).json({
    checkoutId: checkout.id,
    status: pixData ? 'waiting_payment' : 'pending',
    amount,
    plan: {
      name: plan.name,
      maxConnections: plan.maxConnections,
    },
    pix: pixData,
    message: pixData 
      ? 'Checkout criado! Escaneie o QR Code PIX para pagar.' 
      : 'Checkout criado! Aguardando integração de pagamento.',
  });
});

/**
 * Consultar status do checkout
 */
export const getCheckoutStatus = asyncHandler(async (req: Request, res: Response) => {
  const { checkoutId } = req.params;

  logger.info(`[GetCheckoutStatus] Consultando checkout: ${checkoutId}`);

  const checkout = await prisma.checkout.findUnique({
    where: { id: checkoutId },
    select: {
      id: true,
      status: true,
      amount: true,
      customerName: true,
      customerEmail: true,
      pixQrCode: true,
      pixCopyPaste: true,
      paymentUrl: true,
      paidAt: true,
      createdAt: true,
      premiumSourceId: true,
      plan: {
        select: {
          name: true,
          maxConnections: true,
        },
      },
    },
  });

  if (!checkout) {
    throw new AppError(404, 'Checkout não encontrado');
  }

  // Se foi pago, retornar dados da fonte criada
  let sourceData = null;
  if (checkout.premiumSourceId) {
    const source = await prisma.premiumSource.findUnique({
      where: { id: checkout.premiumSourceId },
      select: {
        id: true,
        username: true,
        password: true,
        expiresAt: true,
        server: {
          select: {
            baseUrl: true,
            dnsPrimary: true,
          },
        },
      },
    });

    if (source) {
      const dns = source.server.dnsPrimary || source.server.baseUrl;
      sourceData = {
        username: source.username,
        password: source.password,
        expiresAt: source.expiresAt,
        m3uLink: `${dns}/get.php?username=${source.username}&password=${source.password}&type=m3u_plus&output=mpegts`,
      };
    }
  }

  return res.json({
    data: {
      ...checkout,
      source: sourceData,
    },
  });
});

/**
 * Listar planos premium disponíveis (público)
 */
export const listPublicPlans = asyncHandler(async (req: Request, res: Response) => {
  const plans = await prisma.premiumPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      maxConnections: true,
      credits: true,
    },
  });

  return res.json({
    data: plans,
  });
});

function getBaseUrl(req: Request) {
  const fromEnv = (env.API_URL || '').replace(/\/api\/?$/, '');
  if (fromEnv) return fromEnv;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  return `${proto}://${host}`;
}

async function resolveCoreResellerUser(req: Request) {
  const resellerParam = String(req.params.reseller || '').trim();
  const resellerQuery = typeof req.query.reseller === 'string' ? req.query.reseller.trim() : '';
  const reseller = resellerParam || resellerQuery;

  if (reseller) {
    const user = await prisma.user.findFirst({
      where: { username: reseller },
      select: { id: true, username: true },
    });
    if (!user) throw new AppError(404, 'Revenda não encontrada');
    return user;
  }

  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  const hostOnly = rawHost.replace(/:\d+$/, '').toLowerCase();
  const candidates = [hostOnly, hostOnly.startsWith('www.') ? hostOnly.slice(4) : ''].filter(Boolean);

  for (const h of candidates) {
    const settings = await prisma.panelSettings.findFirst({
      where: {
        publicBaseUrl: {
          contains: `//${h}`,
          mode: 'insensitive',
        },
      },
      select: { userId: true },
    });
    if (!settings?.userId) continue;

    const user = await prisma.user.findUnique({
      where: { id: settings.userId },
      select: { id: true, username: true },
    });
    if (user) return user;
  }

  throw new AppError(404, 'Revenda não encontrada');
}

function signCoreCheckoutToken(paymentId: string) {
  const sig = crypto.createHmac('sha256', env.JWT_SECRET).update(paymentId).digest('base64url');
  return `${paymentId}.${sig}`;
}

function verifyCoreCheckoutToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [paymentId, sig] = parts;
  if (!paymentId || !sig) return null;
  const expected = crypto.createHmac('sha256', env.JWT_SECRET).update(paymentId).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    return paymentId;
  } catch {
    return null;
  }
}

export const listPublicCorePackages = asyncHandler(async (req: Request, res: Response) => {
  const user = await resolveCoreResellerUser(req);

  const packages = await prisma.corePackage.findMany({
    where: { ownerId: user.id, isActive: true },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      durationDays: true,
      priceCents: true,
      connections: true,
    },
    take: 100,
  });

  res.json({ data: { reseller: user.username, packages } });
});

export const getPublicCoreBranding = asyncHandler(async (req: Request, res: Response) => {
  const user = await resolveCoreResellerUser(req);

  const settings = await prisma.panelSettings.findUnique({
    where: { userId: user.id },
    select: { panelName: true, logoUrl: true, publicBaseUrl: true },
  });

  res.json({
    data: {
      reseller: user.username,
      panelName: settings?.panelName || 'Painel IPTV',
      logoUrl: settings?.logoUrl || null,
      publicBaseUrl: settings?.publicBaseUrl || null,
    },
  });
});

export const initiateCoreCheckout = asyncHandler(async (req: Request, res: Response) => {
  const { packageId, customerName, customerPhone } = req.body || {};
  if (!packageId) throw new AppError(400, 'Campos obrigatórios: packageId');

  const user = await resolveCoreResellerUser(req);

  const pkg = await prisma.corePackage.findFirst({
    where: { id: String(packageId), ownerId: user.id, isActive: true },
    select: { id: true, name: true, durationDays: true, priceCents: true, connections: true },
  });
  if (!pkg) throw new AppError(404, 'Pacote não encontrado');

  const service = await getAsaasService(user.id);
  if (!service) throw new AppError(400, 'Asaas não configurado para esta revenda');

  const username = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  const password = crypto.randomBytes(6).toString('base64url');

  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dueDateDate = new Date(`${dueDate}T00:00:00.000Z`);
  const corePayment = await prisma.corePayment.create({
    data: {
      ownerId: user.id,
      packageId: pkg.id,
      daysToAdd: Math.max(1, pkg.durationDays),
      amountCents: Math.max(0, pkg.priceCents),
      kind: 'NEW',
      status: 'PENDING',
      dueDate: dueDateDate,
      customerName: customerName ? String(customerName).slice(0, 120) : null,
      customerPhone: customerPhone ? String(customerPhone).slice(0, 32) : null,
      newUsername: username,
      newPasswordEnc: encrypt(password),
    },
  });

  const value = Math.max(0, pkg.priceCents) / 100;

  const payment = await service.createPixPayment({
    value,
    dueDate,
    description: `Core - Venda: ${pkg.name}`,
    externalReference: corePayment.id,
  });
  const qr = await service.getPixQrCode(payment.id);
  const remoteDueDate = (payment as any)?.dueDate ? new Date(`${(payment as any).dueDate}T00:00:00.000Z`) : dueDateDate;

  const updated = await prisma.corePayment.update({
    where: { id: corePayment.id },
    data: {
      asaasPaymentId: payment.id,
      invoiceUrl: payment.invoiceUrl || null,
      pixQrCode: qr.encodedImage || null,
      pixCopyPaste: qr.payload || null,
      status: payment.status || 'PENDING',
      dueDate: remoteDueDate,
    },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      pixQrCode: true,
      pixCopyPaste: true,
      amountCents: true,
      daysToAdd: true,
      dueDate: true,
      createdAt: true,
      packageId: true,
    },
  });

  res.status(201).json({
    data: updated,
    checkoutToken: signCoreCheckoutToken(corePayment.id),
    reseller: user.username,
    package: pkg,
    message: 'Checkout criado. Pague via PIX para liberar os dados de acesso.',
  });
});

export const getCoreCheckoutStatus = asyncHandler(async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) throw new AppError(400, 'Token inválido');
  const paymentId = verifyCoreCheckoutToken(token);
  if (!paymentId) throw new AppError(400, 'Token inválido');

  const row = await prisma.corePayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      ownerId: true,
      kind: true,
      status: true,
      amountCents: true,
      daysToAdd: true,
      pixQrCode: true,
      pixCopyPaste: true,
      invoiceUrl: true,
      dueDate: true,
      paidAt: true,
      createdAt: true,
      package: { select: { name: true } },
      createdLineId: true,
      newUsername: true,
      newPasswordEnc: true,
    },
  });

  if (!row || row.kind !== 'NEW') throw new AppError(404, 'Checkout não encontrado');

  const panel = await prisma.panelSettings.findUnique({
    where: { userId: row.ownerId },
    select: { publicBaseUrl: true },
  });

  const base = (panel?.publicBaseUrl || '').replace(/\/api\/?$/, '') || getBaseUrl(req);
  const computedStatus = (() => {
    const st = String(row.status || '').toUpperCase();
    if (st !== 'PENDING') return row.status;
    if (!row.dueDate) return row.status;
    const endDue = new Date(row.dueDate);
    endDue.setUTCHours(23, 59, 59, 999);
    return Date.now() > endDue.getTime() ? 'OVERDUE' : row.status;
  })();

  const canReveal = computedStatus === 'CONFIRMED' && !!row.createdLineId && !!row.newUsername && !!row.newPasswordEnc;
  const passwordPlain = canReveal ? decrypt(row.newPasswordEnc!) : null;

  res.json({
    data: {
      id: row.id,
      status: computedStatus,
      amountCents: row.amountCents,
      daysToAdd: row.daysToAdd,
      pixQrCode: row.pixQrCode,
      pixCopyPaste: row.pixCopyPaste,
      invoiceUrl: row.invoiceUrl,
      dueDate: row.dueDate,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      packageName: row.package?.name || null,
      baseUrl: base,
      credentials: canReveal
        ? {
            username: row.newUsername!,
            password: passwordPlain!,
            m3u: `${base}/get.php?username=${encodeURIComponent(row.newUsername!)}&password=${encodeURIComponent(
              passwordPlain!
            )}&type=m3u_plus&output=ts`,
            xmltv: `${base}/xmltv.php?username=${encodeURIComponent(row.newUsername!)}&password=${encodeURIComponent(
              passwordPlain!
            )}`,
            xc: `${base}/player_api.php?username=${encodeURIComponent(row.newUsername!)}&password=${encodeURIComponent(
              passwordPlain!
            )}`,
          }
        : null,
    },
  });
});

export const recreateCoreCheckoutPix = asyncHandler(async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) throw new AppError(400, 'Token inválido');
  const paymentId = verifyCoreCheckoutToken(token);
  if (!paymentId) throw new AppError(400, 'Token inválido');

  const row = await prisma.corePayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      ownerId: true,
      kind: true,
      status: true,
      amountCents: true,
      packageId: true,
      asaasPaymentId: true,
      newUsername: true,
      newPasswordEnc: true,
      paidAt: true,
      createdAt: true,
      dueDate: true,
      package: { select: { name: true } },
    },
  });

  if (!row || row.kind !== 'NEW') throw new AppError(404, 'Checkout não encontrado');

  const st = String(row.status || '').toUpperCase();
  if (row.paidAt || st === 'CONFIRMED' || st === 'RECEIVED') throw new AppError(400, 'Pagamento já confirmado');
  if (st === 'CANCELLED' || st === 'REFUNDED' || st === 'CHARGEBACK') throw new AppError(400, 'Pagamento não pode ser recriado');

  const service = await getAsaasService(row.ownerId);
  if (!service) throw new AppError(400, 'Asaas não configurado para esta revenda');

  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dueDateDate = new Date(`${dueDate}T00:00:00.000Z`);
  const value = Math.max(0, row.amountCents) / 100;

  if (row.asaasPaymentId) {
    try {
      await service.cancelPayment(row.asaasPaymentId);
    } catch {}
  }

  const payment = await service.createPixPayment({
    value,
    dueDate,
    description: `Core - Venda: ${row.package?.name || 'Core'}`,
    externalReference: row.id,
  });
  const qr = await service.getPixQrCode(payment.id);
  const remoteDueDate = (payment as any)?.dueDate ? new Date(`${(payment as any).dueDate}T00:00:00.000Z`) : dueDateDate;

  const updated = await prisma.corePayment.update({
    where: { id: row.id },
    data: {
      asaasPaymentId: payment.id,
      invoiceUrl: payment.invoiceUrl || null,
      pixQrCode: qr.encodedImage || null,
      pixCopyPaste: qr.payload || null,
      status: payment.status || 'PENDING',
      dueDate: remoteDueDate,
      paidAt: null,
      reminderCount: 0,
      lastReminderAt: null,
      overdueNotifiedAt: null,
    },
    select: {
      id: true,
      ownerId: true,
      status: true,
      amountCents: true,
      daysToAdd: true,
      pixQrCode: true,
      pixCopyPaste: true,
      invoiceUrl: true,
      dueDate: true,
      paidAt: true,
      createdAt: true,
      package: { select: { name: true } },
      createdLineId: true,
      newUsername: true,
      newPasswordEnc: true,
    },
  });

  const panel = await prisma.panelSettings.findUnique({
    where: { userId: updated.ownerId },
    select: { publicBaseUrl: true },
  });
  const base = (panel?.publicBaseUrl || '').replace(/\/api\/?$/, '') || getBaseUrl(req);
  const canReveal = updated.status === 'CONFIRMED' && !!updated.createdLineId && !!updated.newUsername && !!updated.newPasswordEnc;
  const passwordPlain = canReveal ? decrypt(updated.newPasswordEnc!) : null;

  res.json({
    data: {
      id: updated.id,
      status: updated.status,
      amountCents: updated.amountCents,
      daysToAdd: updated.daysToAdd,
      pixQrCode: updated.pixQrCode,
      pixCopyPaste: updated.pixCopyPaste,
      invoiceUrl: updated.invoiceUrl,
      dueDate: updated.dueDate,
      paidAt: updated.paidAt,
      createdAt: updated.createdAt,
      packageName: updated.package?.name || null,
      baseUrl: base,
      credentials: canReveal
        ? {
            username: updated.newUsername!,
            password: passwordPlain!,
            m3u: `${base}/get.php?username=${encodeURIComponent(updated.newUsername!)}&password=${encodeURIComponent(
              passwordPlain!
            )}&type=m3u_plus&output=ts`,
            xmltv: `${base}/xmltv.php?username=${encodeURIComponent(updated.newUsername!)}&password=${encodeURIComponent(
              passwordPlain!
            )}`,
            xc: `${base}/player_api.php?username=${encodeURIComponent(updated.newUsername!)}&password=${encodeURIComponent(
              passwordPlain!
            )}`,
          }
        : null,
    },
  });
});
