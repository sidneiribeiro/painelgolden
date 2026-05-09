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
import { backupDatabase, backupFull } from '../scripts/backupDatabase.js';
import { emailService } from '../services/email.service.js';
import fs from 'fs/promises';
import axios from 'axios';
import https from 'node:https';
import { decrypt } from '../utils/crypto.js';
import { TelegramService } from '../services/telegram.service.js';

const logger = createLogger('Scheduler');
let expiryNotifierJob: any = null;
let corePlaybackSessionReaperJob: any = null;
let corePaymentReconcilerJob: any = null;
let corePaymentReminderJob: any = null;
let backupDbJob: any = null;
let backupFullJob: any = null;
let edgeMonitorJob: any = null;

const edgeMonitorConsecutiveBad = new Map<string, number>();
const edgeMonitorLastAlertAt = new Map<string, number>();

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

async function getBackupSmtpConfig(): Promise<
  | { host: string; port: number; user: string; pass: string; from?: string }
  | null
> {
  const host = String(process.env.BACKUP_SMTP_HOST || '').trim();
  const port = parseInt(String(process.env.BACKUP_SMTP_PORT || ''), 10);
  const user = String(process.env.BACKUP_SMTP_USER || '').trim();
  const pass = String(process.env.BACKUP_SMTP_PASS || '').trim();
  const from = String(process.env.BACKUP_SMTP_FROM || '').trim();

  if (host && Number.isFinite(port) && user && pass) {
    return { host, port, user, pass, ...(from ? { from } : {}) };
  }

  const admin = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }],
  });
  if (!admin) return null;

  const settings = await prisma.notificationSettings.findUnique({ where: { userId: admin.id } });
  if (!settings?.emailEnabled || !settings.smtpHost || !settings.smtpPort || !settings.smtpUser || !settings.smtpPass) {
    return null;
  }

  return {
    host: settings.smtpHost,
    port: settings.smtpPort,
    user: settings.smtpUser,
    pass: settings.smtpPass,
    ...(settings.smtpFrom ? { from: settings.smtpFrom } : {}),
  };
}

async function sendBackupEmail(params: { to: string; subject: string; html: string; attachmentPath?: string; attachmentName?: string }) {
  const smtp = await getBackupSmtpConfig();
  if (!smtp) {
    logger.warn('[BackupJob] SMTP não configurado (BACKUP_SMTP_* ou Configurações → Notificações → Email)');
    return;
  }

  const attachments =
    params.attachmentPath && params.attachmentName
      ? [{ filename: params.attachmentName, path: params.attachmentPath }]
      : undefined;

  const result = await emailService.send(
    {
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(attachments ? { attachments } : {}),
    },
    smtp
  );

  if (!result.success) {
    logger.warn(`[BackupJob] Falha ao enviar email: ${result.error || 'erro desconhecido'}`);
  }
}

async function sendAdminAlert(subject: string, message: string) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ACTIVE' },
    select: { id: true, email: true, whatsapp: true },
    orderBy: [{ createdAt: 'asc' }],
  });

  for (const admin of admins) {
    const settings = await prisma.notificationSettings.findUnique({ where: { userId: admin.id } }).catch(() => null);
    if (!settings) continue;

    if (settings.whatsappEnabled && settings.botbotAppKey && settings.botbotAuthKey && admin.whatsapp) {
      const phone = normalizeBrPhone(admin.whatsapp);
      if (phone.length >= 12) {
        await whatsappService.sendMessage(phone, message, settings.botbotAppKey, settings.botbotAuthKey).catch(() => {});
      }
    }

    if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      const telegram = new TelegramService(settings.telegramBotToken);
      await telegram.sendMessage(settings.telegramChatId, message).catch(() => {});
    }

    if (settings.emailEnabled && settings.smtpHost && settings.smtpPort && settings.smtpUser && settings.smtpPass && admin.email) {
      await emailService
        .send(
          {
            to: admin.email,
            subject,
            html: message.replace(/\n/g, '<br/>'),
          },
          {
            host: settings.smtpHost,
            port: settings.smtpPort,
            user: settings.smtpUser,
            pass: settings.smtpPass,
            ...(settings.smtpFrom ? { from: settings.smtpFrom } : {}),
          }
        )
        .catch(() => {});
    }
  }
}

async function fetchEdgeMetrics(server: {
  id: string;
  name: string;
  domain: string | null;
  ip: string | null;
  httpPort: number;
  httpsPort: number;
  edgeTokenEnc: string | null;
}) {
  const domain = (server.domain || '').trim();
  const ip = (server.ip || '').trim();
  const host = (domain || ip || '').trim();
  if (!host) return { ok: false, error: 'Sem domínio/IP', ms: 0, status: null as number | null, metrics: null as any };

  const token = server.edgeTokenEnc ? decrypt(server.edgeTokenEnc) : null;
  const headers: Record<string, string> = {};
  if (token) headers['x-edge-token'] = token;

  const httpPort = typeof server.httpPort === 'number' ? server.httpPort : 80;
  const httpsPort = typeof server.httpsPort === 'number' ? server.httpsPort : 443;
  const preferHttps = !!domain;

  const candidates: Array<{ url: string; https: boolean }> = [];
  if (preferHttps && httpsPort > 0) candidates.push({ url: `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}/api/edge/metrics`, https: true });
  candidates.push({ url: `http://${host}${httpPort === 80 ? '' : `:${httpPort}`}/api/edge/metrics`, https: false });
  if (!preferHttps && httpsPort > 0) candidates.push({ url: `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}/api/edge/metrics`, https: true });

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  let lastErr: any = null;
  for (const c of candidates) {
    const startedAt = Date.now();
    try {
      const r = await axios.get(c.url, {
        timeout: 5000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers,
        httpsAgent: c.https ? httpsAgent : undefined,
      });
      const ms = Math.max(0, Date.now() - startedAt);
      const ok = r.status >= 200 && r.status < 300;
      if (ok) return { ok: true, error: null as string | null, ms, status: r.status, metrics: r.data?.data ?? r.data };
      lastErr = { status: r.status, ms, data: r.data };
    } catch (e: any) {
      lastErr = e;
    }
  }

  const msg = lastErr?.response?.data?.error || lastErr?.data?.error || lastErr?.message || (lastErr?.status ? `HTTP ${lastErr.status}` : 'Erro');
  return { ok: false, error: msg, ms: typeof lastErr?.ms === 'number' ? lastErr.ms : 0, status: typeof lastErr?.status === 'number' ? lastErr.status : null, metrics: null as any };
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

  const backupTo = String(process.env.BACKUP_EMAIL_TO || '').trim();
  const backupEnabled = String(process.env.BACKUP_ENABLED || '').trim().toLowerCase();
  const maxMb = parseInt(String(process.env.BACKUP_ATTACH_MAX_MB || '25'), 10);
  const attachMaxBytes = (Number.isFinite(maxMb) ? maxMb : 25) * 1024 * 1024;

  if (backupEnabled !== 'false' && backupTo) {
    const dbCron = String(process.env.BACKUP_DB_CRON || '0 * * * *').trim() || '0 * * * *';
    const fullCron = String(process.env.BACKUP_FULL_CRON || '15 3 * * *').trim() || '15 3 * * *';

    backupDbJob = cron.schedule(dbCron, async () => {
      try {
        const backup = await backupDatabase();
        const st = await fs.stat(backup.path);

        const subject = `Backup PainelMaster (DB) — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
        const html = `Backup do banco criado automaticamente.<br><br><div class="highlight">${backup.filename}</div>`;

        await sendBackupEmail({
          to: backupTo,
          subject,
          html,
          ...(st.size <= attachMaxBytes ? { attachmentPath: backup.path, attachmentName: backup.filename } : {}),
        });
      } catch (e: any) {
        logger.warn(`[BackupJob] Erro no backup DB: ${e?.message || e}`);
      }
    }, { timezone: 'America/Sao_Paulo' });

    backupFullJob = cron.schedule(fullCron, async () => {
      try {
        const backup = await backupFull();
        const st = await fs.stat(backup.path);

        const subject = `Backup PainelMaster (FULL) — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
        const html = `Backup completo (DB + storage + uploads) criado automaticamente.<br><br><div class="highlight">${backup.filename}</div>`;

        await sendBackupEmail({
          to: backupTo,
          subject,
          html,
          ...(st.size <= attachMaxBytes ? { attachmentPath: backup.path, attachmentName: backup.filename } : {}),
        });
      } catch (e: any) {
        logger.warn(`[BackupJob] Erro no backup FULL: ${e?.message || e}`);
      }
    }, { timezone: 'America/Sao_Paulo' });
  }

  const edgeMonitorEnabled = String(process.env.EDGE_MONITOR_ENABLED || '').trim().toLowerCase() === 'true';
  const alertCooldownMin = parseInt(String(process.env.EDGE_MONITOR_ALERT_COOLDOWN_MIN || '15'), 10);
  const cooldownMs = (Number.isFinite(alertCooldownMin) ? alertCooldownMin : 15) * 60_000;
  const warnCpu = parseInt(String(process.env.EDGE_MONITOR_CPU_WARN || '90'), 10);
  const warnMem = parseInt(String(process.env.EDGE_MONITOR_MEM_WARN || '90'), 10);

  if (edgeMonitorEnabled) {
    edgeMonitorJob = cron.schedule('*/1 * * * *', async () => {
      try {
        const edges = await prisma.coreEdgeServer.findMany({
          where: { isActive: true },
          select: { id: true, name: true, domain: true, ip: true, httpPort: true, httpsPort: true, edgeTokenEnc: true },
          orderBy: [{ createdAt: 'asc' }],
        });

        for (const e of edges) {
          const r = await fetchEdgeMetrics(e);
          const metrics = r.metrics || {};
          const cpu = typeof metrics.cpuPercent === 'number' ? metrics.cpuPercent : null;
          const mem = typeof metrics.memPercent === 'number' ? metrics.memPercent : null;
          const flowsOff = typeof metrics.flowsOff === 'number' ? metrics.flowsOff : null;
          const flowsOn = typeof metrics.flowsOn === 'number' ? metrics.flowsOn : null;
          const conns = typeof metrics.activeConnections === 'number' ? metrics.activeConnections : null;

          const bad =
            !r.ok ||
            (typeof flowsOff === 'number' && flowsOff > 0) ||
            (typeof cpu === 'number' && Number.isFinite(warnCpu) && cpu >= warnCpu) ||
            (typeof mem === 'number' && Number.isFinite(warnMem) && mem >= warnMem);

          const prev = edgeMonitorConsecutiveBad.get(e.id) || 0;
          const next = bad ? prev + 1 : 0;
          edgeMonitorConsecutiveBad.set(e.id, next);

          if (!bad) continue;
          if (next < 2) continue;

          const last = edgeMonitorLastAlertAt.get(e.id) || 0;
          if (Date.now() - last < cooldownMs) continue;
          edgeMonitorLastAlertAt.set(e.id, Date.now());

          const host = (e.domain || e.ip || '').trim() || e.name;
          const title = `Alerta Balance: ${e.name}`;
          const msg =
            `⚠️ ALERTA BALANCE\n\n` +
            `Servidor: ${e.name}\n` +
            `Host: ${host}\n` +
            `Status: ${r.ok ? 'OK (DEGRADADO)' : 'OFFLINE'}${r.error ? ` (${r.error})` : ''}\n` +
            `CPU: ${cpu === null ? '-' : `${Math.round(cpu)}%`}\n` +
            `RAM: ${mem === null ? '-' : `${Math.round(mem)}%`}\n` +
            `Conexões: ${conns === null ? '-' : conns}\n` +
            `Fluxos ON/OFF: ${flowsOn === null ? '-' : flowsOn}/${flowsOff === null ? '-' : flowsOff}\n\n` +
            `Abra Xtream Novo → Monitoramento e use "Reparar" se necessário.`;

          await sendAdminAlert(title, msg);
        }
      } catch (e: any) {
        logger.warn(`[EdgeMonitor] Falha ao coletar/enviar alertas: ${e?.message || e}`);
      }
    }, { timezone: 'America/Sao_Paulo' });
  }
  
  logger.info('Scheduler iniciado (notificações + agendamentos VOD + core M3U + jogos do dia + backups)');
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

  if (backupDbJob) {
    backupDbJob.stop();
    backupDbJob = null;
  }

  if (backupFullJob) {
    backupFullJob.stop();
    backupFullJob = null;
  }

  if (edgeMonitorJob) {
    edgeMonitorJob.stop();
    edgeMonitorJob = null;
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
