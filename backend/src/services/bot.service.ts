import { prisma } from '../config/database.js';
import { XUIClient } from './xui.client.js';
import { whatsappService } from './whatsapp.service.js';

// Helper para obter cliente XUI do servidor padrão
async function getDefaultXuiClient(): Promise<XUIClient> {
  const server = await prisma.xuiServer.findFirst({
    where: { isDefault: true, isActive: true },
  }) || await prisma.xuiServer.findFirst({ where: { isActive: true } });
  
  if (!server) {
    throw new Error('Nenhum servidor XUI disponível');
  }
  
  return new XUIClient(server);
}
// import { telegramService } from './telegram.service.js'; // Temporariamente desabilitado
import { createLogger } from '../utils/logger.js';
import { processTemplate, getReminderTemplate, defaultTemplates } from '../utils/templates.js';
import { daysUntil } from '../utils/formatters.js';
import type { Customer } from '../types/index.js';
import type { TemplateData } from '../utils/templates.js';

const logger = createLogger('BotService');

/**
 * Calcula horas até o vencimento (útil para testes)
 */
function hoursUntil(expiresAt: Date): number {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  return Math.floor(diff / (1000 * 60 * 60));
}

/**
 * Calcula dias desde o vencimento (para pós-vencimento)
 */
function daysAfterExpiry(expiresAt: Date): number {
  const now = new Date();
  const diff = now.getTime() - expiresAt.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export class BotService {
  /**
   * Processa notificações de vencimento para um usuário
   * Agora inclui:
   * - Notificações antes do vencimento (7, 3, 1, 0 dias antes)
   * - Notificações pós-vencimento (3 dias após)
   * - Notificações para testes (1 hora antes do vencimento)
   */
  async processExpiryNotifications(userId: string): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    const stats = { sent: 0, failed: 0, skipped: 0 };

    try {
      // Busca configurações do usuário
      const settings = await prisma.notificationSettings.findUnique({
        where: { userId },
      });

      if (!settings || !settings.enabled) {
        logger.info(`Notificações desabilitadas para usuário ${userId}`);
        return stats;
      }

      // Parse dos dias configurados (ex: "7,3,1,0,-3" onde -3 significa 3 dias após)
      const daysConfig = settings.daysBefore.split(',').map(Number);
      const daysBefore = daysConfig.filter(d => d >= 0);
      const daysAfter = daysConfig.filter(d => d < 0).map(d => Math.abs(d)); // Remove o sinal negativo

      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      // ========================================
      // 1. NOTIFICAÇÕES PARA TESTES (1h antes)
      // ========================================
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const trialCustomers = await prisma.customer.findMany({
        where: {
          resellerUserId: userId,
          isTrial: true,
          status: 'ACTIVE',
          expiresAt: {
            gte: now,
            lte: oneHourFromNow,
          },
        },
        include: {
          package: true,
          server: true,
        },
      });

      logger.info(`Encontrados ${trialCustomers.length} testes vencendo em 1 hora`);

      for (const customer of trialCustomers) {
        const hoursUntilExpiry = hoursUntil(customer.expiresAt);
        
        // Notifica apenas se faltar exatamente 1 hora (ou menos)
        if (hoursUntilExpiry > 1 || hoursUntilExpiry < 0) {
          continue;
        }

        // Verifica se já notificou nas últimas 2 horas (evitar spam)
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const alreadySent = await prisma.notificationLog.findFirst({
          where: {
            userId,
            customerId: customer.id,
            type: 'TRIAL_EXPIRY_REMINDER',
            createdAt: { gte: twoHoursAgo },
          },
        });

        if (alreadySent) {
          stats.skipped++;
          continue;
        }

        const result = await this.sendTrialExpiryNotification(userId, customer, settings);
        if (result) {
          stats.sent++;
        } else {
          stats.failed++;
        }
      }

      // ========================================
      // 2. NOTIFICAÇÕES ANTES DO VENCIMENTO
      // ========================================
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const activeCustomers = await prisma.customer.findMany({
        where: {
          resellerUserId: userId,
          isTrial: false, // Apenas clientes finais
          expiresAt: {
            gte: now,
            lte: sevenDaysFromNow,
          },
          status: 'ACTIVE',
        },
        include: {
          package: true,
          server: true,
        },
      });

      logger.info(`Encontrados ${activeCustomers.length} clientes finais próximos do vencimento`);

      for (const customer of activeCustomers) {
        const daysUntilExpiry = daysUntil(customer.expiresAt);

        // Verifica se deve notificar hoje (apenas números positivos ou zero)
        if (!daysBefore.includes(daysUntilExpiry)) {
          continue;
        }

        // Verifica se já notificou hoje
        const alreadySent = await prisma.notificationLog.findFirst({
          where: {
            userId,
            customerId: customer.id,
            type: 'EXPIRY_REMINDER',
            createdAt: { gte: today },
          },
        });

        if (alreadySent) {
          stats.skipped++;
          continue;
        }

        // Tenta enviar notificação
        const result = await this.sendExpiryNotification(
          userId,
          customer,
          daysUntilExpiry,
          settings
        );

        if (result) {
          stats.sent++;
        } else {
          stats.failed++;
        }
      }

      // ========================================
      // 3. NOTIFICAÇÕES PÓS-VENCIMENTO (3 dias após)
      // ========================================
      if (daysAfter.includes(3)) {
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const expiredCustomers = await prisma.customer.findMany({
          where: {
            resellerUserId: userId,
            isTrial: false,
            status: 'EXPIRED',
            expiresAt: {
              gte: threeDaysAgo,
              lte: new Date(threeDaysAgo.getTime() + 24 * 60 * 60 * 1000), // Dentro de 1 dia após 3 dias
            },
          },
          include: {
            package: true,
            server: true,
          },
        });

        logger.info(`Encontrados ${expiredCustomers.length} clientes vencidos há 3 dias`);

        for (const customer of expiredCustomers) {
          const daysAfterExp = daysAfterExpiry(customer.expiresAt);
          
          // Apenas notifica se estiver exatamente há 3 dias
          if (daysAfterExp !== 3) {
            continue;
          }

          // Verifica se já notificou hoje
          const alreadySent = await prisma.notificationLog.findFirst({
            where: {
              userId,
              customerId: customer.id,
              type: 'POST_EXPIRY_REMINDER',
              createdAt: { gte: today },
            },
          });

          if (alreadySent) {
            stats.skipped++;
            continue;
          }

          const result = await this.sendPostExpiryNotification(userId, customer, settings);
          if (result) {
            stats.sent++;
          } else {
            stats.failed++;
          }
        }
      }

      logger.info(
        `Processamento concluído: ${stats.sent} enviadas, ${stats.failed} falharam, ${stats.skipped} ignoradas`
      );

      return stats;
    } catch (error: any) {
      logger.error('Erro ao processar notificações de vencimento', {
        errorMessage: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  }

  /**
   * Gera URL de renovação (cria cobrança no Asaas)
   */
  private async generateRenewUrl(userId: string, customer: Customer): Promise<string | undefined> {
    try {
      logger.info(`[BotService] 🔍 generateRenewUrl chamado para cliente ${customer.username} (userId: ${userId})`);
      
      // Verificar se Asaas está configurado
      const asaasConfig = await prisma.asaasConfig.findUnique({
        where: { userId },
      });

      if (!asaasConfig || !asaasConfig.isActive) {
        logger.warn(`[BotService] ❌ Asaas não configurado ou inativo para userId ${userId} (config existe: ${!!asaasConfig}, isActive: ${asaasConfig?.isActive})`);
        return undefined;
      }
      
      logger.info(`[BotService] ✅ Asaas configurado e ativo para userId ${userId}`);

      // Gerar ou buscar token de pagamento do cliente (usar token para página pública)
      let paymentToken = (customer as any).paymentToken;
      if (!paymentToken) {
        const crypto = await import('crypto');
        paymentToken = crypto.randomBytes(32).toString('hex');
        await prisma.customer.update({
          where: { id: customer.id },
          data: { paymentToken },
        });
      }

      // Tentar obter a URL correta do FRONTEND (não do backend!)
      // A página de pagamento é servida pelo frontend React
      // Prioridade: FRONTEND_URL > API_URL (remover /api) > localhost:5173
      const { env: configEnv } = await import('../config/env.js');
      let baseUrl = configEnv.FRONTEND_URL;
      
      if (!baseUrl || baseUrl.includes('localhost')) {
        // Se não tiver FRONTEND_URL ou for localhost, tenta derivar do API_URL
        const apiUrl = configEnv.API_URL || '';
        if (apiUrl && !apiUrl.includes('localhost')) {
          // Remove /api e porta do backend, assume frontend na mesma URL
          baseUrl = apiUrl.replace(/:\d+$/, '').replace(/\/api\/?$/, '');
        } else {
          // Fallback: usar localhost:5173 (porta padrão do Vite)
          baseUrl = 'http://localhost:5173';
        }
      }
      
      // Remover barra final se existir
      baseUrl = baseUrl.replace(/\/$/, '');
      
      // Usar URL da página pública de pagamento no FRONTEND
      const url = `${baseUrl}/pay/${paymentToken}`;

      logger.info(`[BotService] ✅ URL de renovação gerada para cliente ${customer.username}: ${url}`);
      return url;
    } catch (error: any) {
      logger.error(`[BotService] ❌ Erro ao gerar URL de renovação para cliente ${customer.username}: ${error.message}`);
      if (error.stack) {
        logger.error(`[BotService] ❌ Stack trace: ${error.stack}`);
      }
      if (error.response) {
        logger.error(`[BotService] ❌ Response status: ${error.response.status}, data: ${JSON.stringify(error.response.data)}`);
      }
      return undefined;
    }
  }

  /**
   * Envia notificação de vencimento para um cliente (antes do vencimento)
   */
  private async sendExpiryNotification(
    userId: string,
    customer: any,
    daysUntilExpiry: number,
    settings: any
  ): Promise<boolean> {
    // Gerar URL de renovação
    logger.info(`[BotService] Tentando gerar renew_url para cliente ${customer.username} (userId: ${userId})`);
    const renewUrl = await this.generateRenewUrl(userId, customer as Customer);
    logger.info(`[BotService] generateRenewUrl retornou: ${renewUrl ? 'URL gerada' : 'undefined'}`);

    const pkg = customer.package;
    const expiresAt = customer.expires_at || customer.expiresAt;

    const templateData: TemplateData = {
      username: customer.username,
      password: customer.password,
      name: customer.name || undefined,
      package: typeof pkg === 'object' ? pkg?.name || '' : pkg || '',
      plan_price: typeof pkg === 'object' ? pkg?.planPrice || 0 : 0,
      expires_at: expiresAt?.toISOString ? expiresAt.toISOString() : String(expiresAt),
      days_until_expiry: daysUntilExpiry,
      renew_url: renewUrl || '',
      m3u_url: undefined, // Pode ser implementado depois
    };

    // Escolhe template baseado nos dias
    let template: string;
    if (daysUntilExpiry === 0) {
      template = settings.expiryTemplate || getReminderTemplate(0);
    } else if (daysUntilExpiry === 1) {
      template = settings.urgentReminderTemplate || getReminderTemplate(1);
    } else {
      template = settings.reminderTemplate || getReminderTemplate(daysUntilExpiry);
    }

    const message = processTemplate(template, templateData);
    
    // Log para debug
    if (renewUrl) {
      logger.info(`[BotService] Template processado com renew_url para ${customer.username}: ${renewUrl.substring(0, 50)}...`);
      logger.info(`[BotService] Mensagem processada (primeiros 200 chars): ${message.substring(0, 200)}`);
    } else {
      logger.warn(`[BotService] Template processado SEM renew_url para ${customer.username}`);
    }

    return this.sendNotification(userId, customer, message, 'EXPIRY_REMINDER', settings);
  }

  /**
   * Envia notificação para teste (1 hora antes)
   */
  private async sendTrialExpiryNotification(
    userId: string,
    customer: any,
    settings: any
  ): Promise<boolean> {
    const expiresAt = customer.expires_at || customer.expiresAt;
    const hoursUntilExpiry = hoursUntil(expiresAt);
    const template = settings.trialExpiryTemplate || 
      `⏰ *Teste Vencendo em Breve*

Olá {name}! 👋

Seu teste de acesso IPTV vence em aproximadamente *1 hora*.

👤 Usuário: {username}
🔑 Senha: {password}
📅 Vencimento: {expires_at}

Renove agora para continuar assistindo! 🎬`;

    // Gerar URL de renovação
    const renewUrl = await this.generateRenewUrl(userId, customer as Customer);

    const pkg = customer.package;

    const templateData: TemplateData = {
      username: customer.username,
      password: customer.password,
      name: customer.name || 'Cliente',
      package: typeof pkg === 'object' ? pkg?.name || 'Teste' : pkg || 'Teste',
      plan_price: typeof pkg === 'object' ? pkg?.planPrice || 0 : 0,
      expires_at: expiresAt?.toLocaleString ? expiresAt.toLocaleString('pt-BR') : String(expiresAt),
      days_until_expiry: 0,
      renew_url: renewUrl || '',
    };

    const message = processTemplate(template, templateData);

    return this.sendNotification(userId, customer, message, 'TRIAL_EXPIRY_REMINDER', settings);
  }

  /**
   * Envia notificação pós-vencimento (3 dias após)
   */
  private async sendPostExpiryNotification(
    userId: string,
    customer: any,
    settings: any
  ): Promise<boolean> {
    const template = settings.postExpiryTemplate || 
      `📢 *Lembrete de Renovação*

Olá {name}! 👋

Sua assinatura venceu há *3 dias*.

Para reativar seu acesso e continuar assistindo:
🔗 Entre em contato conosco

👤 Usuário: {username}
📦 Plano anterior: {package}
💰 Valor: {plan_price}

Aguardamos seu retorno! 📺`;

    // Gerar URL de renovação
    const renewUrl = await this.generateRenewUrl(userId, customer as Customer);

    const pkg = customer.package;
    const expiresAt = customer.expires_at || customer.expiresAt;

    const templateData: TemplateData = {
      username: customer.username,
      password: customer.password,
      name: customer.name || 'Cliente',
      package: typeof pkg === 'object' ? pkg?.name || '' : pkg || '',
      plan_price: typeof pkg === 'object' ? pkg?.planPrice || 0 : 0,
      expires_at: expiresAt?.toLocaleString ? expiresAt.toLocaleString('pt-BR') : String(expiresAt),
      renew_url: renewUrl || '',
      days_until_expiry: -3, // Negativo indica pós-vencimento
    };

    const message = processTemplate(template, templateData);

    return this.sendNotification(userId, customer, message, 'POST_EXPIRY_REMINDER', settings);
  }

  /**
   * 🚀 NOVA FUNCIONALIDADE: Envia mensagens promocionais de recuperação para clientes vencidos há mais de 3 dias
   */
  async sendRecoveryCampaign(
    userId: string,
    options: {
      minDaysExpired?: number; // Mínimo de dias vencidos (padrão: 3)
      maxDaysExpired?: number; // Máximo de dias vencidos (opcional)
      customTemplate?: string; // Template personalizado (opcional)
    } = {}
  ): Promise<{
    sent: number;
    failed: number;
    skipped: number;
    total: number;
  }> {
    const stats = { sent: 0, failed: 0, skipped: 0, total: 0 };

    try {
      const settings = await prisma.notificationSettings.findUnique({
        where: { userId },
      });

      if (!settings || !settings.enabled) {
        logger.info(`Notificações desabilitadas para usuário ${userId}`);
        return stats;
      }

      const minDays = options.minDaysExpired || 3;
      const maxDays = options.maxDaysExpired;
      const now = new Date();
      const minDate = new Date(now.getTime() - (minDays + 1) * 24 * 60 * 60 * 1000); // Mais de X dias
      const maxDate = maxDays 
        ? new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000)
        : new Date(0); // Sem limite máximo se não especificado

      // Buscar clientes vencidos há mais de X dias
      // IMPORTANTE: Não filtrar por status, pois clientes vencidos podem ter status ACTIVE, INACTIVE ou EXPIRED
      // O importante é que expiresAt seja anterior à data mínima
      const expiredCustomers = await prisma.customer.findMany({
        where: {
          resellerUserId: userId,
          isTrial: false,
          expiresAt: {
            lte: minDate,
            ...(maxDays ? { gte: maxDate } : {}),
          },
        },
        include: {
          package: true,
          server: true,
        },
      });

      stats.total = expiredCustomers.length;
      logger.info(`[RecoveryCampaign] Encontrados ${expiredCustomers.length} clientes vencidos há mais de ${minDays} dias`);

      // Template de recuperação (pode ser personalizado)
      const recoveryTemplate = options.customTemplate || settings.recoveryTemplate || 
        `🎁 *Oferta Especial de Retorno!*
        
Olá {name}! 👋

Sentimos sua falta! 😢

Sua assinatura venceu há algum tempo, mas temos uma *oferta especial* para você voltar:

💰 *Desconto especial* para renovação
📦 Plano: {package}
💵 Valor: {plan_price}
👤 Seu usuário: {username}

🔗 Renove agora com desconto:
👉 {renew_url}

*Não perca esta oportunidade!* 🎯

Aguardamos seu retorno! 📺
Painel IPTV`;

      for (const customer of expiredCustomers) {
        // Verificar se já enviou mensagem de recuperação nos últimos 30 dias
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const alreadySent = await prisma.notificationLog.findFirst({
          where: {
            userId,
            customerId: customer.id,
            type: 'RECOVERY_CAMPAIGN',
            createdAt: { gte: thirtyDaysAgo },
          },
        });

        if (alreadySent) {
          stats.skipped++;
          logger.debug(`[RecoveryCampaign] Cliente ${customer.name} já recebeu mensagem de recuperação recentemente`);
          continue;
        }

        // Gerar URL de renovação
        const renewUrl = await this.generateRenewUrl(userId, customer as unknown as Customer);
        const expiresAtRaw = (customer as any).expires_at || customer.expiresAt;
        
        // Garantir que expiresAt seja uma data válida
        let expiresAtDate: Date;
        if (expiresAtRaw instanceof Date) {
          expiresAtDate = expiresAtRaw;
        } else if (expiresAtRaw) {
          expiresAtDate = new Date(expiresAtRaw);
          // Verificar se a data é válida
          if (isNaN(expiresAtDate.getTime())) {
            logger.warn(`[RecoveryCampaign] Data de vencimento inválida para cliente ${customer.id}: ${expiresAtRaw}`);
            expiresAtDate = new Date(); // Fallback para data atual
          }
        } else {
          logger.warn(`[RecoveryCampaign] Cliente ${customer.id} sem data de vencimento`);
          expiresAtDate = new Date(); // Fallback para data atual
        }
        
        const daysExpired = daysAfterExpiry(expiresAtDate);

        const pkg = customer.package;

        const templateData: TemplateData = {
          username: customer.username,
          password: customer.password,
          name: customer.name || 'Cliente',
          package: typeof pkg === 'object' ? pkg?.name || '' : pkg || '',
          plan_price: typeof pkg === 'object' ? pkg?.planPrice || 0 : 0,
          expires_at: expiresAtDate.toISOString(), // Usar ISO string para garantir formato válido
          days_until_expiry: -daysExpired, // Negativo indica dias vencidos
          renew_url: renewUrl || '',
        };

        const message = processTemplate(recoveryTemplate, templateData);

        const result = await this.sendNotification(
          userId,
          customer as unknown as Customer,
          message,
          'RECOVERY_CAMPAIGN',
          settings
        );

        if (result) {
          stats.sent++;
        } else {
          stats.failed++;
        }
      }

      logger.info(
        `[RecoveryCampaign] Campanha concluída: ${stats.sent} enviadas, ${stats.failed} falharam, ${stats.skipped} ignoradas (total: ${stats.total})`
      );

      return stats;
    } catch (error: any) {
      logger.error('[RecoveryCampaign] Erro ao processar campanha de recuperação', {
        errorMessage: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  }

  /**
   * Método auxiliar para enviar notificação
   */
  private async sendNotification(
    userId: string,
    customer: Customer,
    message: string,
    type: 'EXPIRY_REMINDER' | 'TRIAL_EXPIRY_REMINDER' | 'POST_EXPIRY_REMINDER' | 'WELCOME' | 'RENEWAL_CONFIRMATION' | 'RECOVERY_CAMPAIGN',
    settings: any
  ): Promise<boolean> {
    let sent = false;
    let channel: 'WHATSAPP' | 'TELEGRAM' | 'EMAIL' = 'WHATSAPP';
    let error: string | undefined;

    try {
      // Tenta WhatsApp primeiro
      if (settings.whatsappEnabled && customer.whatsapp && settings.botbotAppKey && settings.botbotAuthKey) {
        channel = 'WHATSAPP';
        // Usar sendMessage que retorna SendResult com detalhes do erro
        const result = await whatsappService.sendMessage(
          customer.whatsapp,
          message,
          settings.botbotAppKey,
          settings.botbotAuthKey
        );
        sent = result.success || false;
        if (!sent) {
          error = result.error || 'Erro desconhecido ao enviar WhatsApp';
          logger.warn(`Falha ao enviar notificação WhatsApp: customerId=${customer.id}, type=${type}, error=${result.error}`);
        }
      } else {
        // Cliente não tem WhatsApp ou configurações não estão habilitadas
        if (!customer.whatsapp) {
          error = 'Cliente não tem WhatsApp cadastrado';
        } else if (!settings.whatsappEnabled) {
          error = 'Notificações WhatsApp não estão habilitadas';
        } else if (!settings.botbotAppKey || !settings.botbotAuthKey) {
          error = 'Chaves do botbot.chat não configuradas';
        }
        sent = false;
        logger.info(`Notificação não enviada - condições não atendidas: customerId=${customer.id}, type=${type}, error=${error}`);
      }
      // Fallback para Telegram (temporariamente desabilitado)
      // else if (settings.telegramEnabled && customer.telegram && settings.telegramBotToken) {
      //   channel = 'TELEGRAM';
      //   sent = await telegramService.send({
      //     to: customer.telegram,
      //     message,
      //     botToken: settings.telegramBotToken,
      //     chatId: settings.telegramChatId,
      //   });
      // }
    } catch (e: any) {
      error = e.message || 'Erro desconhecido ao enviar notificação';
      sent = false;
      logger.error('Erro ao enviar notificação', {
        customerId: customer.id,
        type,
        errorMessage: e.message,
        stack: e.stack,
      });
    }

    // Log da notificação
    await prisma.notificationLog.create({
      data: {
        userId,
        customerId: customer.id || null,
        customerName: customer.name || null,
        phone: customer.whatsapp || null,
        email: customer.email || null,
        telegramId: customer.telegram || null,
        type,
        channel,
        status: sent ? 'SENT' : 'FAILED',
        message,
        sentAt: sent ? new Date() : null,
        error: error || null,
      },
    });

    return sent;
  }

  /**
   * Envia notificação de boas-vindas
   */
  async sendWelcomeNotification(
    userId: string,
    customer: Customer,
    isTrial: boolean = false
  ): Promise<boolean> {
    const settings = await prisma.notificationSettings.findUnique({
      where: { userId },
    });

    if (!settings || !settings.enabled) {
      return false;
    }

    const pkg: any = customer.package;
    const expiresAt: any = customer.expires_at || (customer as any).expiresAt;
    
    // Gerar URL M3U se possível (com múltiplos fallbacks)
    let m3uUrl = '';
    
    // Debug logging
    logger.info('[sendWelcomeNotification] ===== CUSTOMER DATA DEBUG =====');
    logger.info('[sendWelcomeNotification] customer.m3u_url:', (customer as any).m3u_url || 'UNDEFINED');
    logger.info('[sendWelcomeNotification] customer.username:', customer.username);
    logger.info('[sendWelcomeNotification] customer.password:', customer.password ? '***' : 'UNDEFINED');
    logger.info('[sendWelcomeNotification] package exists:', !!pkg);
    logger.info('[sendWelcomeNotification] package.server exists:', pkg && typeof pkg === 'object' && !!pkg.server);
    logger.info('[sendWelcomeNotification] ==========================================');
    
    // PRIORIDADE 1: M3U URL já fornecido no customerData
    if ((customer as any).m3u_url) {
      m3uUrl = (customer as any).m3u_url;
      logger.info('[sendWelcomeNotification] ✅ Using provided M3U URL:', m3uUrl.substring(0, 80) + '...');
    } 
    // PRIORIDADE 2: Gerar M3U URL a partir do servidor do pacote
    else if (pkg && typeof pkg === 'object' && pkg.server) {
      const server = pkg.server;
      let dns = server.dnsPrimary?.trim() || server.baseUrl?.trim() || '';
      // Normalizar DNS
      dns = dns.replace(/\/+$/, ''); // Remove barras finais
      dns = dns.replace(/:\/\/+/g, '://'); // Normaliza protocolo
      
      logger.info('[sendWelcomeNotification] Generating M3U from package server:', { dns });
      if (dns && customer.username && customer.password) {
        m3uUrl = `${dns}/get.php?username=${customer.username}&password=${customer.password}&type=m3u_plus&output=mpegts`;
        logger.info('[sendWelcomeNotification] ✅ Generated M3U URL:', m3uUrl.substring(0, 80) + '...');
      } else {
        logger.warn('[sendWelcomeNotification] ⚠️ Missing DNS or credentials');
      }
    } 
    // PRIORIDADE 3: Gerar a partir do DNS fornecido diretamente
    else if ((customer as any).dns && customer.username && customer.password) {
      let dns = (customer as any).dns;
      // Normalizar DNS
      dns = dns.replace(/\/+$/, '');
      dns = dns.replace(/:\/\/+/g, '://');
      
      m3uUrl = `${dns}/get.php?username=${customer.username}&password=${customer.password}&type=m3u_plus&output=mpegts`;
      logger.info('[sendWelcomeNotification] ✅ Generated M3U from DNS:', m3uUrl.substring(0, 80) + '...');
    } 
    else {
      logger.error('[sendWelcomeNotification] ❌ FAILED to generate M3U URL - no valid source');
    }
    
    const templateData: TemplateData = {
      username: customer.username,
      password: customer.password,
      name: customer.name || undefined,
      package: typeof pkg === 'object' ? pkg?.name || '' : pkg || '',
      plan_price: typeof pkg === 'object' ? pkg?.planPrice || 0 : 0,
      expires_at: expiresAt?.toISOString ? expiresAt.toISOString() : String(expiresAt || new Date().toISOString()),
      renew_url: '', // Welcome não gera URL de renovação
      m3u_url: m3uUrl,
    };
    
    logger.info('[sendWelcomeNotification] Final template data:', {
      hasM3uUrl: !!templateData.m3u_url,
      m3uUrlPreview: templateData.m3u_url ? templateData.m3u_url.substring(0, 50) + '...' : 'EMPTY',
      templateType: isTrial ? 'trial' : 'regular'
    });

    const template = settings.welcomeTemplate || 
      (isTrial ? defaultTemplates.welcomeTrial : defaultTemplates.welcome);
    const message = processTemplate(template, templateData);

    return this.sendNotification(userId, customer, message, 'WELCOME', settings);
  }

  /**
   * Envia notificação de renovação
   */
  async sendRenewalNotification(userId: string, customer: Customer): Promise<boolean> {
    const settings = await prisma.notificationSettings.findUnique({
      where: { userId },
    });

    if (!settings || !settings.enabled) {
      return false;
    }

    const pkg: any = customer.package;
    const expiresAt: any = customer.expires_at || (customer as any).expiresAt;
    
    const templateData: TemplateData = {
      username: customer.username,
      password: customer.password,
      name: customer.name || undefined,
      package: typeof pkg === 'object' ? pkg?.name || '' : pkg || '',
      plan_price: typeof pkg === 'object' ? pkg?.planPrice || 0 : 0,
      expires_at: expiresAt?.toISOString ? expiresAt.toISOString() : String(expiresAt || new Date().toISOString()),
      renew_url: '', // Não gera URL para confirmação de renovação
    };

    const template = settings.renewalConfirmationTemplate || defaultTemplates.renewalConfirmation;
    const message = processTemplate(template, templateData);

    return this.sendNotification(userId, customer, message, 'RENEWAL_CONFIRMATION', settings);
  }

  /**
   * Obtém logs de notificação
   */
  async getNotificationLogs(
    userId: string,
    options: {
      page?: number;
      perPage?: number;
      type?: string;
      status?: string;
    } = {}
  ) {
    const { page = 1, perPage = 20, type, status } = options;

    const where: any = { userId };
    if (type) where.type = type;
    if (status) where.status = status;

    const [logs, total] = await Promise.all([
      prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.notificationLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.ceil(total / perPage),
      },
    };
  }
}

export const botService = new BotService();
