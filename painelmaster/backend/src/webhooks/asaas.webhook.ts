import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { createLogger } from '../utils/logger.js';
import { XUIDBClient } from '../services/xui.db.client.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { whatsappService } from '../services/whatsapp.service.js';
import bcrypt from 'bcryptjs';
import { decrypt } from '../utils/crypto.js';
import env from '../config/env.js';
import { processTemplate } from '../utils/templates.js';

const logger = createLogger('AsaasWebhook');

interface AsaasWebhookPayload {
  event: string;
  payment?: {
    id: string;
    customer: string;
    value: number;
    status: string;
    billingType: string;
    externalReference?: string;
    confirmedDate?: string;
    paymentDate?: string;
  };
}

export const handleAsaasWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const payload: AsaasWebhookPayload = req.body;

  const event = payload.event || 'UNKNOWN';
  logger.info(`[Webhook] Recebido evento: ${event}`);

  // Validar token
  const config = await prisma.asaasConfig.findFirst({
    where: { webhookToken: token },
  });

  if (!config) {
    logger.warn(`[Webhook] Token inválido: ${token}`);
    return res.status(401).json({ error: 'Token inválido' });
  }

  // Salvar log do webhook
  await prisma.asaasWebhookLog.create({
    data: {
      event: event,
      paymentId: payload.payment?.id || null,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload), // Garante que é string
    },
  });

  // Processar eventos de pagamento
  if (payload.payment) {
    await processPaymentEvent(event, payload.payment, config.userId);
  }

  res.json({ received: true });
});

async function processPaymentEvent(event: string, payment: any, userId: string) {
  const asaasId = payment.id;
  const externalReference = payment.externalReference;

  logger.info(`[Webhook] Buscando pagamento: asaasId=${asaasId}, externalReference=${externalReference}`);

  // PRIMEIRO: Verificar se é um checkout do portal premium
  if (externalReference) {
    const checkout = await prisma.checkout.findFirst({
      where: { 
        OR: [
          { id: externalReference },
          { asaasPaymentId: asaasId },
        ],
      },
    });

    if (checkout) {
      logger.info(`[Webhook] Encontrou checkout do portal: ${checkout.id}`);
      
      if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
        await handleCheckoutPaymentReceived(checkout, payment);
      }
      return; // Checkout processado, não continuar para pagamento de cliente
    }
  }

  // SEGUNDO: Verificar se é um pagamento do Core (renovação de linha)
  if (externalReference) {
    const corePayment = await prisma.corePayment.findFirst({
      where: {
        OR: [{ id: externalReference }, { asaasPaymentId: asaasId }],
      },
    });

    if (corePayment) {
      logger.info(`[Webhook] Encontrou pagamento do Core: ${corePayment.id}`);
      if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
        await handleCorePaymentReceived(corePayment, payment);
      }
      return;
    }
  }

  // Buscar pagamento local primeiro pelo asaasId
  let localPayment = await prisma.asaasPayment.findUnique({
    where: { asaasId },
    include: { 
      customer: {
        include: { server: true },
      },
    },
  });

  // Se não encontrou pelo asaasId, buscar pelo externalReference (ID do cliente)
  // Isso acontece com QR Code estático, onde o Asaas cria um pagamento novo
  if (!localPayment && externalReference) {
    logger.info(`[Webhook] Pagamento não encontrado pelo asaasId, tentando pelo externalReference: ${externalReference}`);
    
    const customer = await prisma.customer.findUnique({
      where: { id: externalReference },
    });

    if (customer) {
      // Buscar pagamento pendente deste cliente
      localPayment = await prisma.asaasPayment.findFirst({
        where: {
          customerId: customer.id,
          status: 'PENDING',
        },
        include: { 
          customer: {
            include: { server: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Se encontrou, atualizar o asaasId para o ID real do Asaas
      if (localPayment) {
        logger.info(`[Webhook] Pagamento encontrado pelo externalReference, atualizando asaasId de ${localPayment.asaasId} para ${asaasId}`);
        await prisma.asaasPayment.update({
          where: { id: localPayment.id },
          data: { asaasId },
        });
        // Buscar novamente para ter o asaasId atualizado
        localPayment = await prisma.asaasPayment.findUnique({
          where: { asaasId },
          include: { 
            customer: {
              include: { server: true },
            },
          },
        });
      }
    }
  }

  if (!localPayment) {
    logger.warn(`[Webhook] Pagamento não encontrado: asaasId=${asaasId}, externalReference=${externalReference}`);
    return;
  }

  // ⚠️ CORREÇÃO BUG CRÍTICO: Verificar se pagamento já foi processado para evitar renovações duplicadas
  if (localPayment.status === 'CONFIRMED' || localPayment.paidAt) {
    logger.info(`[Webhook] ⚠️ Pagamento ${asaasId} já foi processado anteriormente (status=${localPayment.status}, paidAt=${localPayment.paidAt}). Ignorando webhook duplicado.`);
    return;
  }

  // Atualizar status
  await prisma.asaasPayment.update({
    where: { asaasId },
    data: { status: payment.status },
  });

  // Processar por tipo de evento
  switch (event) {
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED':
      await handlePaymentReceived(localPayment, payment);
      break;

    case 'PAYMENT_OVERDUE':
      logger.info(`[Webhook] Pagamento vencido: ${asaasId}`);
      break;

    case 'PAYMENT_REFUNDED':
      logger.info(`[Webhook] Pagamento estornado: ${asaasId}`);
      break;
  }
}

export async function handleCorePaymentReceived(corePayment: any, asaasPayment: any) {
  logger.info(`[Webhook] 💰 Pagamento Core recebido: ${asaasPayment.id} (corePayment=${corePayment.id})`);

  const existing = await prisma.corePayment.findUnique({
    where: { id: corePayment.id },
    select: {
      id: true,
      status: true,
      paidAt: true,
      kind: true,
      lineId: true,
      packageId: true,
      daysToAdd: true,
      customerName: true,
      customerPhone: true,
      newUsername: true,
      newPasswordEnc: true,
      createdLineId: true,
    },
  });

  if (!existing) return;
  if (existing.status === 'CONFIRMED' || existing.paidAt) {
    logger.info(`[Webhook] Pagamento Core já processado: ${existing.id}`);
    return;
  }

  const now = new Date();
  await prisma.corePayment.update({
    where: { id: existing.id },
    data: {
      status: 'CONFIRMED',
      paidAt: now,
      asaasPaymentId: asaasPayment.id,
    },
  });

  const pkg = await prisma.corePackage.findUnique({
    where: { id: existing.packageId },
    select: { id: true, ownerId: true, connections: true, name: true },
  });
  if (!pkg) {
    logger.warn(`[Webhook] CorePayment ${existing.id} sem pacote`);
    return;
  }

  if (existing.kind === 'NEW') {
    if (!existing.newUsername || !existing.newPasswordEnc) {
      logger.warn(`[Webhook] CorePayment ${existing.id} sem credenciais para criar linha`);
      return;
    }

    const passwordPlain = decrypt(existing.newPasswordEnc);
    const passwordHash = await bcrypt.hash(passwordPlain, 10);

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + Math.max(1, existing.daysToAdd || 30));

    const line = await prisma.coreLine.create({
      data: {
        ownerId: pkg.ownerId,
        username: existing.newUsername,
        passwordHash,
        status: 'ACTIVE',
        connections: pkg.connections,
        expiresAt,
        packageId: pkg.id,
      },
      select: { id: true },
    });

    await prisma.corePayment.update({
      where: { id: existing.id },
      data: { lineId: line.id, createdLineId: line.id },
    });

    const rawPhone = (existing.customerPhone || '').trim();
    if (rawPhone) {
      const digits = rawPhone.replace(/\D+/g, '');
      const normalized = digits.startsWith('55') ? digits : digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;

      if (normalized.length >= 12) {
        const settings = await prisma.notificationSettings.findUnique({ where: { userId: pkg.ownerId } });
        if (settings?.whatsappEnabled && settings.botbotAppKey && settings.botbotAuthKey) {
          const panel = await prisma.panelSettings.findUnique({
            where: { userId: pkg.ownerId },
            select: { publicBaseUrl: true },
          });
          const base =
            (panel?.publicBaseUrl || '').replace(/\/api\/?$/, '') ||
            (env.API_URL || '').replace(/\/api\/?$/, '');
          const m3u = `${base}/get.php?username=${encodeURIComponent(existing.newUsername)}&password=${encodeURIComponent(
            passwordPlain
          )}&type=m3u_plus&output=ts`;
          const xmltv = `${base}/xmltv.php?username=${encodeURIComponent(existing.newUsername)}&password=${encodeURIComponent(
            passwordPlain
          )}`;
          const xc = `${base}/player_api.php?username=${encodeURIComponent(existing.newUsername)}&password=${encodeURIComponent(
            passwordPlain
          )}`;

          const defaultCoreWelcomeTemplate =
            `Olá {name}!\n\n` +
            `Seu acesso foi liberado:\n` +
            `Usuário: {username}\n` +
            `Senha: {password}\n` +
            `Vence em: {expires_at}\n\n` +
            `Links:\n` +
            `M3U: {m3u_url}\n` +
            `XMLTV: {xmltv_url}\n` +
            `XC API: {xc_api_url}`;
          const msg = processTemplate(settings.coreWelcomeTemplate || defaultCoreWelcomeTemplate, {
            username: existing.newUsername,
            password: passwordPlain,
            name: existing.customerName || undefined,
            package: pkg.name || 'Core',
            plan_price: 0,
            expires_at: expiresAt.toISOString(),
            m3u_url: m3u,
            xmltv_url: xmltv,
            xc_api_url: xc,
            connections: pkg.connections,
          });

          await whatsappService.sendMessage(normalized, msg, settings.botbotAppKey, settings.botbotAuthKey).catch((e: any) => {
            logger.warn(`[Webhook] Falha ao enviar WhatsApp do CorePayment ${existing.id}: ${e?.message || String(e)}`);
          });
        }
      }
    }

    logger.info(`[Webhook] ✅ Linha Core criada: lineId=${line.id}, exp=${expiresAt.toISOString()}`);
    return;
  }

  if (!existing.lineId) {
    logger.warn(`[Webhook] CorePayment ${existing.id} sem lineId para renovação`);
    return;
  }

  const line = await prisma.coreLine.findUnique({
    where: { id: existing.lineId },
    select: { id: true, username: true, expiresAt: true },
  });
  if (!line) {
    logger.warn(`[Webhook] CorePayment ${existing.id} lineId inválido`);
    return;
  }

  const base = line.expiresAt && line.expiresAt.getTime() > now.getTime() ? line.expiresAt : now;
  const newExp = new Date(base);
  newExp.setDate(newExp.getDate() + Math.max(1, existing.daysToAdd || 30));

  await prisma.coreLine.update({
    where: { id: line.id },
    data: {
      expiresAt: newExp,
      packageId: existing.packageId,
      connections: pkg.connections,
      status: 'ACTIVE',
    },
  });

  const rawPhone = (existing.customerPhone || '').trim();
  if (rawPhone) {
    const digits = rawPhone.replace(/\D+/g, '');
    const normalized = digits.startsWith('55') ? digits : digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    if (normalized.length >= 12) {
      const settings = await prisma.notificationSettings.findUnique({ where: { userId: pkg.ownerId } });
      if (settings?.whatsappEnabled && settings.botbotAppKey && settings.botbotAuthKey) {
        const defaultCoreRenewalTemplate =
          `✅ Renovação confirmada!\n\n` +
          `Usuário: {username}\n` +
          `Novo vencimento: {expires_at}`;
        const msg = processTemplate(settings.coreRenewalTemplate || defaultCoreRenewalTemplate, {
          username: line.username,
          password: '',
          name: existing.customerName || undefined,
          package: pkg.name || 'Core',
          plan_price: 0,
          expires_at: newExp.toISOString(),
          m3u_url: '',
          xmltv_url: '',
          xc_api_url: '',
          connections: pkg.connections,
        });
        await whatsappService.sendMessage(normalized, msg, settings.botbotAppKey, settings.botbotAuthKey).catch((e: any) => {
          logger.warn(`[Webhook] Falha ao enviar WhatsApp do CorePayment ${existing.id}: ${e?.message || String(e)}`);
        });
      }
    }
  }

  logger.info(`[Webhook] ✅ Linha Core renovada: lineId=${line.id}, newExp=${newExp.toISOString()}`);
}

export async function handlePaymentReceived(localPayment: any, asaasPayment: any) {
  logger.info(`[Webhook] 💰 Pagamento recebido: ${asaasPayment.id}`);

  const customer = localPayment.customer;
  const daysToRenew = localPayment.daysToRenew || 30;

  logger.info(`[Webhook] Dias para renovar: ${daysToRenew}, Data atual do cliente: ${customer.expiresAt}`);

  // Calcular nova data de expiração
  // Se o cliente está vencido, começar de hoje, senão adicionar a partir da data de vencimento atual
  const currentExpDate = customer.expiresAt || new Date();
  const now = new Date();
  const baseDate = currentExpDate > now ? currentExpDate : now;
  const newExpDate = new Date(baseDate);
  newExpDate.setDate(newExpDate.getDate() + daysToRenew);

  logger.info(`[Webhook] Data base: ${baseDate.toISOString()}, Nova data de expiração: ${newExpDate.toISOString()}, Dias adicionados: ${daysToRenew}`);

  // Converter para timestamp UNIX (segundos)
  const expTimestamp = Math.floor(newExpDate.getTime() / 1000);

  try {
    // 1. Atualizar no XUI.ONE usando XUIDBClient (com validações automáticas)
    const server = customer.server;
    
    if (!server.dbHost || !server.dbUser) {
      throw new Error('Credenciais do banco XUI não configuradas');
    }

    const dbClient = new XUIDBClient(server);

    // ⚠️ CORREÇÃO: Tentar buscar por ID primeiro, depois por username como fallback
    let line = await dbClient.getLine(parseInt(customer.externalId));
    
    // Se não encontrar por ID, tentar buscar por username (fallback)
    if (!line && customer.username) {
      logger.warn(`[Webhook] Cliente ${customer.externalId} não encontrado por ID, tentando buscar por username: ${customer.username}`);
      
      try {
        line = await dbClient.getLineByUsername(customer.username);
        
        // Se encontrar por username, atualizar externalId para sincronizar
        if (line) {
          logger.info(`[Webhook] ✅ Cliente encontrado por username! ID XUI: ${line.id}, externalId local: ${customer.externalId}`);
          logger.info(`[Webhook] Atualizando externalId de "${customer.externalId}" para "${line.id}" para sincronizar`);
          
          // Atualizar externalId no banco local
          await prisma.customer.update({
            where: { id: customer.id },
            data: { externalId: String(line.id) },
          });
          
          logger.info(`[Webhook] ✅ externalId atualizado com sucesso`);
        } else {
          logger.warn(`[Webhook] Cliente também não encontrado por username: ${customer.username}`);
        }
      } catch (usernameError: any) {
        logger.error(`[Webhook] Erro ao buscar por username: ${usernameError.message}`);
        // Continuar para lançar erro abaixo
      }
    }
    
    if (!line) {
      throw new Error(
        `Cliente não encontrado no XUI. ID local: ${customer.externalId}, Username: ${customer.username || 'N/A'}. ` +
        `Verifique se o cliente existe no servidor XUI ${server.name}.`
      );
    }

    // ⚠️ CORREÇÃO CRÍTICA: Atualizar XUI primeiro e garantir sucesso antes de atualizar localmente
    // ⚠️ CORREÇÃO BUG RENOVAÇÃO: Incluir enabled=1 para REATIVAR o cliente no XUI
    logger.info(`[Webhook] Atualizando XUI para cliente ${line.id} (exp_date: ${expTimestamp}, enabled: 1, ${newExpDate.toISOString()})`);
    try {
      await dbClient.updateLine(line.id, {
        exp_date: expTimestamp,
        is_trial: 0,
        enabled: 1, // ⚠️ CRÍTICO: Reativar cliente no XUI após renovação
      });
      logger.info(`[Webhook] ✅ XUI atualizado com sucesso para cliente ${line.id} (enabled=1)`);
    } catch (xuiError: any) {
      // ⚠️ CORREÇÃO: Se XUI falhar, NÃO atualizar localmente e lançar erro
      logger.error(`[Webhook] ❌ ERRO CRÍTICO: Falha ao atualizar XUI para cliente ${line.id}:`, {
        error: xuiError.message,
        stack: xuiError.stack,
        expTimestamp,
        newExpDate: newExpDate.toISOString(),
      });
      throw new Error(
        `Falha ao atualizar cliente no servidor XUI. A renovação não foi aplicada. ` +
        `Erro: ${xuiError.message}. Por favor, verifique os logs e tente novamente.`
      );
    }

    // ⚠️ CORREÇÃO: Atualizar dados locais APENAS se XUI foi atualizado com sucesso
    // ⚠️ CORREÇÃO BUG RENOVAÇÃO: Incluir status=ACTIVE para reativar no painel também
    logger.info(`[Webhook] Atualizando dados locais para cliente ${customer.id} (expiresAt: ${newExpDate.toISOString()}, status: ACTIVE)`);
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        expiresAt: newExpDate,
        isTrial: false,
        status: 'ACTIVE', // ⚠️ CRÍTICO: Reativar cliente no painel após renovação
      },
    });
    logger.info(`[Webhook] ✅ Dados locais atualizados para cliente ${customer.id} (status=ACTIVE)`);

    // Desconectar do banco
    await dbClient.disconnect();

    // 3. Marcar pagamento como processado
    await prisma.asaasPayment.update({
      where: { id: localPayment.id },
      data: {
        status: 'CONFIRMED',
        paidAt: new Date(),
      },
    });

    // 4. Atualizar log do webhook
    await prisma.asaasWebhookLog.updateMany({
      where: { 
        paymentId: asaasPayment.id,
        processed: false,
      },
      data: { processed: true },
    });

    // 5. Registrar ação
    await prisma.actionLog.create({
      data: {
        userId: customer.resellerUserId,
        action: 'AUTO_RENEW_PAYMENT',
        entity: 'customer',
        entityId: customer.id,
        details: JSON.stringify({
          asaasPaymentId: asaasPayment.id,
          value: asaasPayment.value,
          oldExpDate: customer.expiresAt,
          newExpDate: newExpDate,
          daysAdded: daysToRenew,
        }),
      },
    });

    logger.info(`[Webhook] 🎉 Cliente ${customer.username} renovado automaticamente até ${newExpDate.toISOString()}`);

    // 6. Enviar notificação para o cliente (se configurado)
    // Buscar cliente atualizado do banco para ter a data de expiração correta
    try {
      const updatedCustomer = await prisma.customer.findUnique({
        where: { id: customer.id },
        include: {
          package: true,
          server: true,
        },
      });

      if (updatedCustomer) {
        const { botService } = await import('../services/bot.service.js');
        await botService.sendRenewalNotification(customer.resellerUserId, updatedCustomer);
        logger.info(`[Webhook] ✅ Notificação de renovação enviada para ${updatedCustomer.username}`);
      }
    } catch (error) {
      logger.error(`[Webhook] Erro ao enviar notificação: ${error}`);
      // Não falha o webhook se a notificação falhar
    }

  } catch (error: any) {
    logger.error(`[Webhook] ❌ Erro ao renovar cliente: ${error.message}`);
    
    // Atualizar log do webhook com erro
    await prisma.asaasWebhookLog.updateMany({
      where: { 
        paymentId: asaasPayment.id,
        processed: false,
      },
      data: { 
        processed: false,
        error: error.message,
      },
    });

    throw error;
  }
}

/**
 * Envia notificação WhatsApp para o cliente após pagamento confirmado
 * Usa o mesmo sistema de notificação dos clientes normais
 */
async function sendWhatsAppPaymentNotification(
  prisma: any,
  customer: any,
  source: any,
  server: any,
  plan: any
) {
  try {
    // Verificar se tem telefone
    if (!customer.phone) {
      logger.info(`[Webhook] Cliente ${customer.email} sem telefone, pulando WhatsApp`);
      return;
    }

    // Normalizar telefone - adicionar código do país Brasil (55) se não tiver
    let normalizedPhone = customer.phone.replace(/\D/g, ''); // Remove tudo exceto dígitos
    
    // Se não começar com 55, adicionar
    if (!normalizedPhone.startsWith('55')) {
      normalizedPhone = '55' + normalizedPhone;
    }
    
    logger.info(`[Webhook] Telefone normalizado: ${customer.phone} -> ${normalizedPhone}`);

    // Buscar primeiro usuário admin como reseller padrão (igual ao que cria a fonte)
    const adminUser = await prisma.user.findFirst({ 
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } 
    });
    
    if (!adminUser) {
      logger.warn('[Webhook] Nenhum admin encontrado para enviar WhatsApp');
      return;
    }

    // Criar objeto customer simulando o formato esperado pelo botService
    // Isso permite usar o mesmo sistema de notificação dos clientes normais
    const customerForBot: any = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      whatsapp: normalizedPhone, // Telefone normalizado
      username: source.username,
      password: source.password,
      expiresAt: source.expiresAt,
      package: {
        name: plan.name,
        planPrice: 0, // Preço não disponível aqui
      }
    };

    // Importar botService e enviar notificação
    const { botService } = await import('../services/bot.service.js');
    
    // Usar sendWelcomeNotification para pagamento confirmado
    // (é mais apropriado que renewal para primeira compra)
    const sent = await botService.sendWelcomeNotification(adminUser.id, customerForBot, false);
    
    if (sent) {
      logger.info(`[Webhook] ✅ WhatsApp enviado para ${customer.phone} usando sistema de notificação padrão`);
    } else {
      logger.warn(`[Webhook] Falha ao enviar WhatsApp através do sistema padrão para ${customer.phone}`);
    }

  } catch (error: any) {
    logger.error(`[Webhook] Erro ao enviar WhatsApp: ${error.message}`);
    // Não lançar erro para não falhar o webhook
  }
}

/**
 * Processa pagamento de checkout do portal premium
 * Cria o cliente premium e a fonte após pagamento confirmado
 */
async function handleCheckoutPaymentReceived(checkout: any, asaasPayment: any) {
  logger.info(`[Webhook] 💰 Pagamento de checkout recebido: ${checkout.id}`);

  // Verificar se já foi processado
  if (checkout.status === 'paid' || checkout.premiumSourceId) {
    logger.info(`[Webhook] Checkout já processado: ${checkout.id}`);
    return;
  }

  try {
    // Buscar dados necessários
    const plan = await prisma.premiumPlan.findUnique({ where: { id: checkout.planId } });
    const server = await prisma.xuiServer.findUnique({ where: { id: checkout.serverId } });
    const bouquet = await prisma.bouquet.findUnique({ where: { id: checkout.bouquetId } });

    if (!plan || !server || !bouquet) {
      throw new Error('Dados do checkout incompletos');
    }

    // Obter TODOS os bouquets do plano (não apenas um)
    let allBouquetIds: number[] = [];
    try {
      const planBouquets = JSON.parse(plan.bouquetIds || '[]');
      if (planBouquets.length > 0) {
        // Converter externalIds para numeros
        allBouquetIds = planBouquets.map((id: string | number) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
        logger.info(`[Webhook] Usando bouquets do plano: ${allBouquetIds.join(', ')}`);
      }
    } catch (e) {
      logger.warn('[Webhook] Erro ao parsear bouquetIds do plano, usando fallback');
    }
    
    // Fallback: usar bouquet do checkout se não houver no plano
    if (allBouquetIds.length === 0) {
      const xuiBouquetId = parseInt(bouquet.externalId, 10);
      allBouquetIds = [xuiBouquetId];
      logger.info(`[Webhook] Usando bouquet fallback: ${xuiBouquetId}`);
    }

    // 1. Criar ou buscar cliente premium
    let premiumCustomer = await prisma.premiumCustomer.findUnique({
      where: { email: checkout.customerEmail },
    });

    if (!premiumCustomer) {
      premiumCustomer = await prisma.premiumCustomer.create({
        data: {
          email: checkout.customerEmail,
          passwordHash: checkout.customerPassword || '', // Senha já hasheada no checkout
          name: checkout.customerName,
          phone: checkout.customerPhone,
          document: checkout.customerDocument,
        },
      });
      logger.info(`[Webhook] Cliente premium criado: ${premiumCustomer.id}`);
    }

    // 2. Criar linha no XUI
    const username = `premium_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const password = Math.random().toString(36).slice(2, 12);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + checkout.durationDays);
    const expTimestamp = Math.floor(expiresAt.getTime() / 1000);

    const dbClient = new XUIDBClient(server);
    let lineId: number;

    try {
      lineId = await dbClient.createLine({
        username,
        password,
        exp_date: expTimestamp,
        is_trial: 0,
        member_id: server.xuiResellerId || 2,
        bouquet: allBouquetIds, // Usar TODOS os bouquets do plano
        allowed_outputs: [1, 2, 3],
        max_connections: plan.maxConnections,
        admin_notes: `Portal Premium - ${checkout.customerEmail}`,
      });
      logger.info(`[Webhook] Linha XUI criada: ${lineId} com bouquets: ${allBouquetIds.join(', ')}`);
    } finally {
      await dbClient.disconnect();
    }

    // 3. Criar fonte premium
    // Buscar primeiro usuário admin como reseller padrão
    const adminUser = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } });
    
    if (!adminUser) {
      throw new Error('Nenhum usuário admin encontrado para vincular a fonte');
    }
    
    const source = await prisma.premiumSource.create({
      data: {
        plan: { connect: { id: plan.id } },
        server: { connect: { id: server.id } },
        reseller: { connect: { id: adminUser.id } },
        premiumCustomer: { connect: { id: premiumCustomer.id } },
        xuiLineId: String(lineId),
        username,
        password,
        status: 'ACTIVE',
        expiresAt,
      },
    });
    logger.info(`[Webhook] Fonte premium criada: ${source.id}`);

    // 4. Atualizar checkout
    await prisma.checkout.update({
      where: { id: checkout.id },
      data: {
        status: 'paid',
        premiumSourceId: source.id,
        premiumCustomerId: premiumCustomer.id,
        paidAt: new Date(),
      },
    });

    logger.info(`[Webhook] 🎉 Checkout ${checkout.id} processado! Fonte: ${source.id}, Cliente: ${premiumCustomer.email}`);

    // 5. Enviar notificação WhatsApp para o cliente
    await sendWhatsAppPaymentNotification(prisma, premiumCustomer, source, server, plan);

  } catch (error: any) {
    logger.error(`[Webhook] ❌ Erro ao processar checkout: ${error.message}`);
    
    // Atualizar checkout com erro
    await prisma.checkout.update({
      where: { id: checkout.id },
      data: {
        status: 'failed',
      },
    });

    throw error;
  }
}
