import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { TelegramService } from '../services/telegram.service.js';

const logger = createLogger('NotificationsController');

// Schema de validação
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  daysBefore: z.string().optional(), // Aceita qualquer string (será validado no processamento)
  sendTime: z.string().optional(),
  whatsappEnabled: z.boolean().optional(),
  botbotAppKey: z.string().optional(),
  botbotAuthKey: z.string().optional(),
  telegramEnabled: z.boolean().optional(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  emailEnabled: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().optional(),
  reminderTemplate: z.string().optional(),
  urgentReminderTemplate: z.string().optional(),
  expiryTemplate: z.string().optional(),
  trialExpiryTemplate: z.string().optional(),
  postExpiryTemplate: z.string().optional(),
  renewalConfirmationTemplate: z.string().optional(),
  welcomeTemplate: z.string().optional(),
  recoveryTemplate: z.string().optional(), // 🚀 NOVO: Template para campanha de recuperação
  coreWelcomeTemplate: z.string().optional(),
  coreRenewalTemplate: z.string().optional(),
  corePaymentReminderTemplate: z.string().optional(),
  coreReminderMinAgeMinutes: z.number().optional(),
  coreReminderMinGapHours: z.number().optional(),
  coreReminderMaxCount: z.number().optional(),
  corePaymentOverdueTemplate: z.string().optional(),
});

/**
 * GET /api/notifications/settings
 * Retorna configurações de notificação do usuário
 */
export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  });

  // Cria configurações padrão se não existir
  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: { userId },
    });
  }

  res.json({ data: settings });
});

/**
 * PUT /api/notifications/settings
 * Atualiza configurações de notificação
 */
export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Extrai apenas os campos válidos do schema, ignorando campos extras e removendo nulls
  const body = req.body || {};
  const validFields: any = {};
  
  // Lista de campos válidos do schema (campos que podem ser atualizados)
  const validKeys = [
    'enabled', 'daysBefore', 'sendTime', 'whatsappEnabled', 'botbotAppKey', 'botbotAuthKey',
    'telegramEnabled', 'telegramBotToken', 'telegramChatId', 'emailEnabled', 'smtpHost',
    'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom',     'reminderTemplate', 'urgentReminderTemplate',
    'expiryTemplate', 'trialExpiryTemplate', 'postExpiryTemplate', 'renewalConfirmationTemplate',
    'welcomeTemplate',
    'recoveryTemplate',
    'coreWelcomeTemplate',
    'coreRenewalTemplate',
    'corePaymentReminderTemplate',
    'coreReminderMinAgeMinutes',
    'coreReminderMinGapHours',
    'coreReminderMaxCount',
    'corePaymentOverdueTemplate',
  ];
  
  // Filtra apenas campos válidos, converte null para undefined (Prisma aceita undefined mas não null)
  for (const key of validKeys) {
    if (key in body) {
      // Converte null para undefined e mantém apenas valores definidos
      validFields[key] = body[key] === null ? undefined : body[key];
    }
  }

  // Validação permissiva
  const data = settingsSchema.passthrough().parse(validFields);

  const settings = await prisma.notificationSettings.upsert({
    where: { userId },
    create: {
      userId,
      ...data,
    },
    update: data,
  });

  logger.info(`Configurações de notificação atualizadas para usuário ${userId}`);

  res.json({ data: settings });
});

/**
 * GET /api/notifications/logs
 * Retorna logs de notificações enviadas
 */
export const getLogs = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 20;

  const skip = (page - 1) * perPage;

  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
    }),
    prisma.notificationLog.count({ where: { userId } }),
  ]);

  res.json({
    data: logs,
    meta: {
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.ceil(total / perPage),
      from: skip + 1,
      to: Math.min(skip + perPage, total),
    },
  });
});

/**
 * DELETE /api/notifications/logs
 * Deleta logs de notificação (todos ou por idade)
 */
export const deleteLogs = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { olderThanDays, deleteAll } = req.body;

  let whereClause: any = { userId };

  if (deleteAll) {
    // Deleta todos os logs do usuário
    whereClause = { userId };
  } else if (olderThanDays && typeof olderThanDays === 'number') {
    // Deleta logs mais antigos que X dias
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    whereClause = {
      userId,
      createdAt: {
        lt: cutoffDate,
      },
    };
  } else {
    throw new AppError(400, 'Você deve fornecer deleteAll=true ou olderThanDays (número)');
  }

  const result = await prisma.notificationLog.deleteMany({
    where: whereClause,
  });

  logger.info(`Logs deletados para usuário ${userId}: ${result.count} registros`);

  res.json({
    message: `${result.count} log(s) deletado(s) com sucesso`,
    count: result.count,
  });
});

/**
 * GET /api/notifications/stats
 * Retorna estatísticas de notificações
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const [total, sent, failed, pending] = await Promise.all([
    prisma.notificationLog.count({ where: { userId } }),
    prisma.notificationLog.count({ where: { userId, status: 'SENT' } }),
    prisma.notificationLog.count({ where: { userId, status: 'FAILED' } }),
    prisma.notificationLog.count({ where: { userId, status: 'PENDING' } }),
  ]);

  res.json({
    total,
    sent,
    failed,
    pending,
  });
});

/**
 * POST /api/notifications/test-whatsapp
 * Envia mensagem de teste via WhatsApp
 */
export const testWhatsApp = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { phone } = z.object({ phone: z.string().min(10) }).parse(req.body);

  const settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  });

  if (!settings?.botbotAppKey || !settings?.botbotAuthKey) {
    throw new AppError(400, 'Configure as credenciais do BotBot primeiro');
  }

  const testMessage = `🔔 *Teste de Notificação*

Esta é uma mensagem de teste do Painel IPTV.

Se você recebeu esta mensagem, suas configurações estão funcionando corretamente! ✅

_Enviado em: ${new Date().toLocaleString('pt-BR')}_`;

  // Usa o serviço exportado (não precisa de constructor)
  const result = await whatsappService.sendMessage(
    phone,
    testMessage,
    settings.botbotAppKey,
    settings.botbotAuthKey
  );

  // Log
  await prisma.notificationLog.create({
    data: {
      userId,
      phone,
      type: 'CUSTOM',
      channel: 'WHATSAPP',
      status: result.success ? 'SENT' : 'FAILED',
      message: testMessage,
      error: result.error,
      sentAt: result.success ? new Date() : null,
    },
  });

  if (!result.success) {
    throw new AppError(500, result.error || 'Falha ao enviar mensagem');
  }

  res.json({
    success: true,
    message: 'Mensagem de teste enviada com sucesso!',
  });
});

/**
 * POST /api/notifications/test-telegram
 * Envia mensagem de teste via Telegram
 */
export const testTelegram = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { chatId } = z.object({ chatId: z.string().min(1) }).parse(req.body);

  const settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  });

  if (!settings?.telegramBotToken) {
    throw new AppError(400, 'Configure o token do bot primeiro');
  }

  const telegramService = new TelegramService(settings.telegramBotToken);

  const testMessage = `🔔 *Teste de Notificação*

Esta é uma mensagem de teste do Painel IPTV.

Se você recebeu esta mensagem, suas configurações estão funcionando corretamente! ✅

_Enviado em: ${new Date().toLocaleString('pt-BR')}_`;

  const result = await telegramService.sendMessage(chatId, testMessage);

  // Log
  await prisma.notificationLog.create({
    data: {
      userId,
      telegramId: chatId,
      type: 'CUSTOM',
      channel: 'TELEGRAM',
      status: result.success ? 'SENT' : 'FAILED',
      message: testMessage,
      error: result.error,
      sentAt: result.success ? new Date() : null,
    },
  });

  if (!result.success) {
    throw new AppError(500, result.error || 'Falha ao enviar mensagem');
  }

  res.json({
    success: true,
    message: 'Mensagem de teste enviada com sucesso!',
  });
});

/**
 * POST /api/notifications/run-now
 * Executa o job de notificações manualmente
 */
export const runNow = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Importa dinamicamente para evitar dependência circular
  const { botService } = await import('../services/bot.service.js');

  const result = await botService.processExpiryNotifications(userId);

  res.json({
    message: 'Notificações processadas',
    result,
  });
});

/**
 * 🚀 NOVO: POST /api/notifications/recovery-campaign
 * Envia mensagens promocionais de recuperação para clientes vencidos há mais de 3 dias
 */
export const sendRecoveryCampaign = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { minDaysExpired, maxDaysExpired, customTemplate } = req.body;

  try {
    // Importa dinamicamente para evitar dependência circular
    const { botService } = await import('../services/bot.service.js');

    const result = await botService.sendRecoveryCampaign(userId, {
      minDaysExpired: minDaysExpired || 3,
      maxDaysExpired,
      customTemplate,
    });

    logger.info(`[RecoveryCampaign] Campanha executada para usuário ${userId}: ${result.sent} enviadas, ${result.failed} falharam, ${result.skipped} ignoradas`);

    // Sempre retornar resposta de sucesso, mesmo se houver algumas falhas
    res.status(200).json({
      success: true,
      message: 'Campanha de recuperação executada',
      result: {
        sent: result.sent || 0,
        failed: result.failed || 0,
        skipped: result.skipped || 0,
        total: result.total || 0,
      },
    });
  } catch (error: any) {
    logger.error('[RecoveryCampaign] Erro no controller ao processar campanha', {
      errorMessage: error?.message,
      stack: error?.stack,
    });
    
    // Se o erro já tiver um resultado parcial, retornar ele
    if (error?.result) {
      res.status(200).json({
        success: true,
        message: 'Campanha processada com alguns avisos',
        result: error.result,
      });
    } else {
      throw error; // Deixar o asyncHandler tratar o erro
    }
  }
});
