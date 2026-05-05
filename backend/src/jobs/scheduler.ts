import { createLogger } from '../utils/logger.js';
import { startExpiryNotifierJob } from './expiryNotifier.job.js';
import { vodScheduleService } from '../services/vod/vod-schedule.service.js';
import JogosDoDiaService from '../services/jogos-do-dia/jogos-do-dia.service.js';
import {
  initializeCoreM3USchedules,
  stopAllCoreM3USchedules,
  initializeCoreEpgSchedules,
  stopAllCoreEpgSchedules,
} from '../controllers/core.controller.js';
import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { getAsaasService } from '../services/asaas.service.js';
import { handleCorePaymentReceived } from '../webhooks/asaas.webhook.js';
import { whatsappService } from '../services/whatsapp.service.js';
import env from '../config/env.js';
import crypto from 'crypto';
import { processTemplate } from '../utils/templates.js';

const logger = createLogger('Scheduler');
let expiryNotifierJob: any = null;
let corePlaybackSessionReaperJob: any = null;
let corePaymentReconcilerJob: any = null;
let corePaymentReminderJob: any = null;

function signCoreCheckoutToken(paymentId: string) {
  const sig = crypto.createHmac('sha256', env.JWT_SECRET).update(paymentId).digest('base64url');
  return `${paymentId}.${sig}`;
}

function stripApiSuffix(url: string) {
  return (url || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
}

function ymdToDate(ymd: string | null | undefined) {
  if (!ymd) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return new Date(`${ymd}T00:00:00.000Z`);
  const d = new Date(ymd);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeBrPhone(raw: string) {
  const digits = (raw || '').trim().replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function startScheduler() {
  logger.info('Iniciando scheduler de jobs');
  
  // ⚠️ CORREÇÃO: Job de notificações agora respeita o horário configurado (sendTime) de cada usuário
  // Executa a cada hora e verifica se é o horário de envio de cada usuário
  expiryNotifierJob = startExpiryNotifierJob();
  
  // ⚠️ AGENDAMENTO AUTOMÁTICO: Inicializar agendamentos VOD
  await vodScheduleService.initializeSchedules();

  await initializeCoreM3USchedules();
  await initializeCoreEpgSchedules();

  corePlaybackSessionReaperJob = cron.schedule('*/5 * * * *', async () => {
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
    try {
      await prisma.corePlaybackSession.updateMany({
        where: { endedAt: null, lastSeenAt: { lt: staleBefore }, status: 'active' },
        data: { endedAt: new Date(), status: 'stale' },
      });
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  corePaymentReconcilerJob = cron.schedule('*/5 * * * *', async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      const pending = await prisma.corePayment.findMany({
        where: {
          createdAt: { gte: since },
          paidAt: null,
          status: { not: 'CONFIRMED' },
          asaasPaymentId: { not: null },
        },
        select: {
          id: true,
          ownerId: true,
          asaasPaymentId: true,
          dueDate: true,
          status: true,
          kind: true,
          amountCents: true,
          invoiceUrl: true,
          pixCopyPaste: true,
          customerName: true,
          customerPhone: true,
          remindersEnabled: true,
          overdueNotifiedAt: true,
          newUsername: true,
          owner: { select: { username: true, panelSettings: { select: { publicBaseUrl: true } } } },
          package: { select: { name: true } },
          line: { select: { username: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
      });

      const serviceByOwner = new Map<string, Awaited<ReturnType<typeof getAsaasService>>>();
      for (const row of pending) {
        const asaasId = row.asaasPaymentId;
        if (!asaasId) continue;

        let service = serviceByOwner.get(row.ownerId);
        if (service === undefined) {
          service = await getAsaasService(row.ownerId);
          serviceByOwner.set(row.ownerId, service);
        }
        if (!service) continue;

        let remote: any = null;
        try {
          remote = await service.getPayment(asaasId);
        } catch {
          remote = null;
        }
        if (!remote) continue;

        const st = String(remote.status || '').toUpperCase();
        const remoteDue = ymdToDate(remote.dueDate);
        const computedStatus = (() => {
          if (!st) return null;
          if (st !== 'PENDING') return st;
          const due = remoteDue || row.dueDate;
          if (!due) return st;
          const endDue = new Date(due);
          endDue.setUTCHours(23, 59, 59, 999);
          return Date.now() > endDue.getTime() ? 'OVERDUE' : st;
        })();

        const finalStatuses = new Set(['CANCELLED', 'REFUNDED', 'CHARGEBACK']);
        if (computedStatus && finalStatuses.has(computedStatus)) {
          await prisma.corePayment.update({
            where: { id: row.id },
            data: { status: computedStatus },
          }).catch(() => {});
          continue;
        }

        if (computedStatus === 'OVERDUE' && !row.overdueNotifiedAt && row.remindersEnabled && row.customerPhone) {
          const rawPhone = row.customerPhone || '';
          const phone = normalizeBrPhone(rawPhone);
          if (phone.length >= 12) {
            const settings = await prisma.notificationSettings.findUnique({ where: { userId: row.ownerId } });
            if (settings?.whatsappEnabled && settings.botbotAppKey && settings.botbotAuthKey) {
              const base =
                stripApiSuffix(row.owner?.panelSettings?.publicBaseUrl || '') ||
                stripApiSuffix(env.API_URL || '');
              const checkoutUrl =
                base && row.owner?.username
                  ? `${base}/core/checkout/${encodeURIComponent(row.owner.username)}?t=${encodeURIComponent(signCoreCheckoutToken(row.id))}`
                  : '';

              const username = row.line?.username || row.newUsername || '';
              const pkgName = row.package?.name || 'Core';

              const msgTemplate = settings.corePaymentOverdueTemplate?.trim();
              const msg =
                msgTemplate
                  ? processTemplate(msgTemplate, {
                      username,
                      password: '',
                      name: row.customerName || 'Cliente',
                      package: pkgName,
                      plan_price: row.amountCents / 100,
                      expires_at: (remoteDue || row.dueDate || new Date()).toISOString(),
                      due_date: (remoteDue || row.dueDate)?.toISOString() || '',
                      invoice_url: row.invoiceUrl || remote.invoiceUrl || '',
                      checkout_url: checkoutUrl,
                      pix_copy_paste: row.pixCopyPaste || '',
                    })
                  : `Olá${row.customerName ? `, ${row.customerName}` : ''}!\n\n⚠️ Seu pagamento está vencido.\n\n📦 Pacote: ${pkgName}\n💰 Valor: R$ ${(row.amountCents / 100).toFixed(2).replace('.', ',')}\n📅 Vencimento: ${(remoteDue || row.dueDate) ? new Date(remoteDue || row.dueDate!).toLocaleDateString('pt-BR') : ''}\n\nLink do pagamento:\n${row.invoiceUrl || remote.invoiceUrl || ''}\n\nAcompanhar status:\n${checkoutUrl}`;

              let sendStatus: 'SENT' | 'FAILED' = 'FAILED';
              let sendError: string | null = null;
              try {
                const result = await whatsappService.sendMessage(phone, msg, settings.botbotAppKey, settings.botbotAuthKey);
                sendStatus = result.success ? 'SENT' : 'FAILED';
                sendError = result.success ? null : result.error || 'Falha ao enviar WhatsApp';
              } catch (e: any) {
                sendStatus = 'FAILED';
                sendError = e?.message || 'Falha ao enviar WhatsApp';
              }

              await prisma.corePayment.update({
                where: { id: row.id },
                data: { overdueNotifiedAt: new Date() },
              }).catch(() => {});

              await prisma.notificationLog.create({
                data: {
                  userId: row.ownerId,
                  customerId: null,
                  customerName: row.customerName || null,
                  phone: rawPhone || null,
                  email: null,
                  telegramId: null,
                  type: 'CORE_PAYMENT_OVERDUE',
                  channel: 'WHATSAPP',
                  status: sendStatus,
                  message: msg,
                  sentAt: sendStatus === 'SENT' ? new Date() : null,
                  error: sendStatus === 'SENT' ? null : sendError || 'Falha ao enviar WhatsApp',
                  relatedType: 'corePayment',
                  relatedId: row.id,
                },
              }).catch(() => {});
            }
          }
        }

        if (computedStatus || remoteDue) {
          await prisma.corePayment.update({
            where: { id: row.id },
            data: {
              ...(computedStatus ? { status: computedStatus } : {}),
              ...(remoteDue ? { dueDate: remoteDue } : {}),
              ...(remote.invoiceUrl ? { invoiceUrl: remote.invoiceUrl } : {}),
            },
          }).catch(() => {});
        }

        if (st === 'RECEIVED' || st === 'CONFIRMED') {
          await handleCorePaymentReceived({ id: row.id }, remote).catch(() => {});
        }
      }
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  corePaymentReminderJob = cron.schedule('*/15 * * * *', async () => {
    const now = new Date();
    try {
      const rows = await prisma.corePayment.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          paidAt: null,
          status: 'PENDING',
          asaasPaymentId: { not: null },
          customerPhone: { not: null },
          remindersEnabled: true,
          reminderCount: { lt: 10 },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 80,
        select: {
          id: true,
          ownerId: true,
          kind: true,
          amountCents: true,
          invoiceUrl: true,
          pixCopyPaste: true,
          dueDate: true,
          status: true,
          customerName: true,
          customerPhone: true,
          reminderCount: true,
          lastReminderAt: true,
          createdAt: true,
          newUsername: true,
          owner: { select: { username: true, panelSettings: { select: { publicBaseUrl: true } } } },
          package: { select: { name: true } },
          line: { select: { username: true } },
        },
      });

      for (const p of rows) {
        const rawPhone = p.customerPhone || '';
        const phone = normalizeBrPhone(rawPhone);
        if (phone.length < 12) continue;
        if (!p.pixCopyPaste && !p.invoiceUrl) continue;

        const settings = await prisma.notificationSettings.findUnique({ where: { userId: p.ownerId } });
        if (!settings?.whatsappEnabled || !settings.botbotAppKey || !settings.botbotAuthKey) continue;

        const minAgeMinutes = Math.max(0, Number(settings.coreReminderMinAgeMinutes ?? 30));
        const minGapHours = Math.max(0, Number(settings.coreReminderMinGapHours ?? 6));
        const maxReminders = Math.max(0, Number(settings.coreReminderMaxCount ?? 3));

        const minAgeMs = minAgeMinutes * 60 * 1000;
        const minGapMs = minGapHours * 60 * 60 * 1000;

        if (maxReminders === 0) continue;
        if ((p.reminderCount || 0) >= maxReminders) continue;
        if (minAgeMs > 0 && now.getTime() - new Date(p.createdAt).getTime() < minAgeMs) continue;
        if (p.lastReminderAt && minGapMs > 0 && now.getTime() - new Date(p.lastReminderAt).getTime() < minGapMs) continue;

        const base =
          stripApiSuffix(p.owner?.panelSettings?.publicBaseUrl || '') ||
          stripApiSuffix(env.API_URL || '');
        const checkoutUrl =
          base && p.owner?.username
            ? `${base}/core/checkout/${encodeURIComponent(p.owner.username)}?t=${encodeURIComponent(signCoreCheckoutToken(p.id))}`
            : '';

        const username = p.line?.username || p.newUsername || '';
        const pkgName = p.package?.name || 'Core';

        const msgTemplate = settings.corePaymentReminderTemplate?.trim();
        const msg =
          msgTemplate
            ? processTemplate(msgTemplate, {
                username,
                password: '',
                name: p.customerName || 'Cliente',
                package: pkgName,
                plan_price: p.amountCents / 100,
                expires_at: p.dueDate ? p.dueDate.toISOString() : new Date().toISOString(),
                due_date: p.dueDate ? p.dueDate.toISOString() : '',
                invoice_url: p.invoiceUrl || '',
                checkout_url: checkoutUrl,
                pix_copy_paste: p.pixCopyPaste || '',
              })
            : (() => {
                const kindLabel = p.kind === 'NEW' ? 'venda' : p.kind === 'RENEW' ? 'renovação' : 'pagamento';
                const value = (p.amountCents / 100).toFixed(2).replace('.', ',');
                return (
                  `Olá${p.customerName ? `, ${p.customerName}` : ''}!\n\n` +
                  `Lembrete do PIX (${kindLabel}) — ${pkgName}${username ? ` (${username})` : ''}\n` +
                  `Valor: R$ ${value}\n\n` +
                  (p.pixCopyPaste ? `PIX copia e cola:\n${p.pixCopyPaste}\n\n` : '') +
                  (p.invoiceUrl ? `Link do pagamento:\n${p.invoiceUrl}\n\n` : '') +
                  (checkoutUrl ? `Acompanhar status:\n${checkoutUrl}\n` : '')
                );
              })();

        const result = await whatsappService.sendMessage(phone, msg, settings.botbotAppKey, settings.botbotAuthKey);

        await prisma.corePayment.update({
          where: { id: p.id },
          data: {
            reminderCount: { increment: 1 },
            lastReminderAt: now,
          },
        }).catch(() => {});

        await prisma.notificationLog.create({
          data: {
            userId: p.ownerId,
            customerId: null,
            customerName: p.customerName || null,
            phone: rawPhone || null,
            email: null,
            telegramId: null,
            type: 'CORE_PAYMENT_REMINDER',
            channel: 'WHATSAPP',
            status: result.success ? 'SENT' : 'FAILED',
            message: msg,
            sentAt: result.success ? new Date() : null,
            error: result.success ? null : result.error || 'Falha ao enviar WhatsApp',
            relatedType: 'corePayment',
            relatedId: p.id,
          },
        }).catch(() => {});
      }
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });
  
  // Inicializar scheduler de jogos do dia
  JogosDoDiaService.startScheduler();
  
  logger.info('Scheduler iniciado (notificações + agendamentos VOD + core M3U + jogos do dia)');
}

export function stopScheduler() {
  if (expiryNotifierJob) {
    expiryNotifierJob.stop();
    expiryNotifierJob = null;
  }

  if (corePlaybackSessionReaperJob) {
    corePlaybackSessionReaperJob.stop();
    corePlaybackSessionReaperJob = null;
  }

  if (corePaymentReconcilerJob) {
    corePaymentReconcilerJob.stop();
    corePaymentReconcilerJob = null;
  }

  if (corePaymentReminderJob) {
    corePaymentReminderJob.stop();
    corePaymentReminderJob = null;
  }
  
  // ⚠️ AGENDAMENTO AUTOMÁTICO: Parar agendamentos VOD
  vodScheduleService.stopAll();

  stopAllCoreM3USchedules();
  stopAllCoreEpgSchedules();
  
  // Parar scheduler de jogos do dia
  JogosDoDiaService.stopScheduler();
  
  logger.info('Scheduler parado');
}

export default { startScheduler, stopScheduler };
