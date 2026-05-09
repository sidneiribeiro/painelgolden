import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { botService } from '../services/bot.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ExpiryNotifierJob');

/**
 * Job que verifica vencimentos e envia notificações
 * ⚠️ CORREÇÃO: Agora respeita o horário configurado por cada usuário (sendTime)
 * Executa A CADA HORA e verifica se é o horário de envio de cada usuário
 */
export function startExpiryNotifierJob(): cron.ScheduledTask {
  logger.info('📅 Agendando jobs de notificação de vencimentos');

  // Job principal: executa A CADA HORA e verifica o sendTime de cada usuário
  const dailyJob = cron.schedule('0 * * * *', async () => {
    const now = new Date();
    const currentHour = now.toLocaleTimeString('pt-BR', { 
      timeZone: 'America/Sao_Paulo', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    
    logger.info(`🔔 Verificando notificações (horário atual: ${currentHour} BRT)...`);

    try {
      // Busca todos os usuários com notificações habilitadas
      const usersWithNotifications = await prisma.notificationSettings.findMany({
        where: { enabled: true },
        select: { userId: true, sendTime: true },
      });

      logger.info(`${usersWithNotifications.length} usuário(s) com notificações habilitadas`);

      let totalSent = 0;
      let totalFailed = 0;
      let totalSkipped = 0;
      let usersProcessed = 0;

      for (const { userId, sendTime } of usersWithNotifications) {
        // ⚠️ CORREÇÃO CRÍTICA: Verificar se é o horário de envio do usuário
        const configuredHour = sendTime.substring(0, 5); // Ex: "09:00" ou "10:30"
        
        if (currentHour !== configuredHour) {
          // Não é o horário deste usuário, pular
          continue;
        }
        
        usersProcessed++;
        logger.info(`📤 Enviando notificações para usuário ${userId} (horário configurado: ${sendTime})`);
        
        try {
          const result = await botService.processExpiryNotifications(userId);
          totalSent += result.sent;
          totalFailed += result.failed;
          totalSkipped += result.skipped;
        } catch (error) {
          logger.error({ userId, error }, 'Erro ao processar usuário');
        }
      }

      if (usersProcessed > 0) {
      logger.info(
          `✅ Verificação concluída (${usersProcessed} usuários processados): ${totalSent} enviadas, ${totalFailed} falharam, ${totalSkipped} ignoradas`
      );
      }

      // Notificações de billing para USUÁRIOS (pós-pago vencimento + pré-pago créditos baixos)
      await processUserBillingNotifications();
    } catch (error) {
      logger.error({ error }, '❌ Erro no job de notificação');
    }
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo',
  });

  // ⚠️ CORREÇÃO: Job de testes REMOVIDO (já processado no job principal acima)
  // O job principal agora roda a cada hora e processa TUDO (clientes finais + testes)
  // Não precisa mais de um job separado

  // Inicia o job
  dailyJob.start();

  // ⚠️ CORREÇÃO: Agora temos apenas um job (que roda a cada hora)
  const combinedJob = {
    stop: () => {
      dailyJob.stop();
    },
    start: () => {
      dailyJob.start();
    },
    destroy: () => {
      dailyJob.destroy();
    },
  } as any;

  // Adiciona função para executar manualmente (IGNORA sendTime)
  (combinedJob as any).now = async () => {
    logger.info('🔔 Executando verificação MANUAL de vencimentos (ignora horário configurado)...');
    
    const usersWithNotifications = await prisma.notificationSettings.findMany({
      where: { enabled: true },
      select: { userId: true, sendTime: true },
    });

    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const { userId, sendTime } of usersWithNotifications) {
      logger.info(`📤 Processando usuário ${userId} (horário configurado: ${sendTime}, executando manualmente)`);
      
      try {
        const result = await botService.processExpiryNotifications(userId);
        totalSent += result.sent;
        totalFailed += result.failed;
        totalSkipped += result.skipped;
      } catch (error) {
        logger.error({ userId, error }, 'Erro ao processar usuário manualmente');
      }
    }

    logger.info(
      `✅ Execução manual concluída: ${totalSent} enviadas, ${totalFailed} falharam, ${totalSkipped} ignoradas`
    );
  };

  return combinedJob as cron.ScheduledTask;
}

/**
 * Notificações de billing para USUÁRIOS (não clientes)
 * - Pós-pago: notifica no dia do vencimento e 3 dias antes
 * - Pré-pago: notifica quando créditos <= 3
 */
async function processUserBillingNotifications(): Promise<void> {
  try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Buscar todos os usuários com WhatsApp configurado
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        whatsapp: { not: null },
        role: { not: 'SUPER_ADMIN' },
      },
      select: {
        id: true,
        username: true,
        name: true,
        whatsapp: true,
        billingType: true,
        dueDate: true,
        credits: true,
        parentId: true,
      },
    });

    for (const user of users) {
      if (!user.whatsapp) continue;

      // Buscar configurações de notificação do parent (ou do próprio SUPER_ADMIN)
      const parentId = user.parentId || user.id;
      const settings = await prisma.notificationSettings.findUnique({
        where: { userId: parentId },
      });
      if (!settings || !settings.enabled || !settings.whatsappEnabled || !settings.botbotAppKey || !settings.botbotAuthKey) continue;

      // ======= PÓS-PAGO: notificar no vencimento e 3 dias antes =======
      if (user.billingType === 'POSTPAID' && user.dueDate) {
        const dueDate = new Date(user.dueDate);
        const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0 || diffDays === 3) {
          // Verificar se já notificou hoje
          const alreadySent = await prisma.notificationLog.findFirst({
            where: {
              userId: parentId,
              type: 'EXPIRY_REMINDER',
              message: { contains: user.username },
              createdAt: { gte: today },
            },
          });
          if (alreadySent) continue;

          const dueDateStr = dueDate.toLocaleDateString('pt-BR');
          const msg = diffDays === 0
            ? `⚠️ *Vencimento Hoje!*\n\nOlá ${user.name || user.username}, seu painel vence *hoje* (${dueDateStr}).\nEntre em contato para renovação.`
            : `📅 *Aviso de Vencimento*\n\nOlá ${user.name || user.username}, seu painel vence em *3 dias* (${dueDateStr}).\nEntre em contato para renovação.`;

          try {
            const { whatsappService } = await import('../services/whatsapp.service.js');
            await whatsappService.sendMessage(user.whatsapp, msg, settings.botbotAppKey, settings.botbotAuthKey);
            await prisma.notificationLog.create({
              data: {
                userId: parentId,
                type: 'EXPIRY_REMINDER',
                channel: 'WHATSAPP',
                status: 'SENT',
                message: msg,
                phone: user.whatsapp,
                customerName: user.username,
                sentAt: new Date(),
              },
            });
            logger.info(`Notificação de vencimento enviada para usuário ${user.username} (${diffDays} dias)`);
          } catch (e: any) {
            logger.error(`Erro ao notificar usuário ${user.username}: ${e.message}`);
          }
        }
      }

      // ======= PRÉ-PAGO: notificar quando créditos <= 3 =======
      if (user.billingType === 'PREPAID' && user.credits <= 3) {
        const alreadySent = await prisma.notificationLog.findFirst({
          where: {
            userId: parentId,
            type: 'EXPIRY_REMINDER',
            message: { contains: `créditos: ${user.credits}` },
            createdAt: { gte: today },
          },
        });
        if (alreadySent) continue;

        const msg = `💰 *Créditos Baixos!*\n\nOlá ${user.name || user.username}, você tem apenas *${user.credits} crédito(s)* restante(s).\nAdquira mais créditos para continuar criando clientes.`;

        try {
          const { whatsappService } = await import('../services/whatsapp.service.js');
          await whatsappService.sendMessage(user.whatsapp, msg, settings.botbotAppKey, settings.botbotAuthKey);
          await prisma.notificationLog.create({
            data: {
              userId: parentId,
              type: 'EXPIRY_REMINDER',
              channel: 'WHATSAPP',
              status: 'SENT',
              message: `Créditos baixos - créditos: ${user.credits} - ${user.username}`,
              phone: user.whatsapp,
              customerName: user.username,
              sentAt: new Date(),
            },
          });
          logger.info(`Notificação de créditos baixos enviada para ${user.username} (${user.credits} créditos)`);
        } catch (e: any) {
          logger.error(`Erro ao notificar créditos baixos ${user.username}: ${e.message}`);
        }
      }
    }
  } catch (error: any) {
    logger.error(`Erro no processamento de notificações de billing: ${error.message}`);
  }
}

/**
 * Executa o job manualmente para um usuário específico
 */
export async function runExpiryNotifierForUser(userId: string): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  logger.info(`🔔 Executando verificação manual para usuário ${userId}`);
  return botService.processExpiryNotifications(userId);
}
