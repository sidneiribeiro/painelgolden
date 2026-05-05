/**
 * Serviço para gerenciar agendamentos de importação VOD
 * Usa node-cron para executar importações automaticamente
 */

import cron from 'node-cron';
import { prisma } from '../../config/database.js';
import { createLogger } from '../../utils/logger.js';
import { M3UImporterService } from './m3u-importer.service.js';
import type { XuiServer } from '@prisma/client';

const logger = createLogger('VODScheduleService');

interface ScheduleTask {
  scheduleId: string;
  task: cron.ScheduledTask;
}

class VODScheduleService {
  private schedules = new Map<string, ScheduleTask>(); // scheduleId -> task
  private isRunning = new Map<string, boolean>(); // scheduleId -> isRunning (prevenção de overlap)

  /**
   * Inicializa todos os agendamentos ativos do banco
   */
  async initializeSchedules(): Promise<void> {
    logger.info('[VODSchedule] Inicializando agendamentos...');

    try {
      const activeSchedules = await prisma.vODImportSchedule.findMany({
        where: { isActive: true },
        include: { server: true },
      });

      logger.info(`[VODSchedule] ${activeSchedules.length} agendamento(s) ativo(s) encontrado(s)`);

      for (const schedule of activeSchedules) {
        try {
          await this.scheduleImport(schedule.id);
        } catch (error: any) {
          logger.error(`[VODSchedule] Erro ao agendar import ${schedule.id}:`, error.message);
        }
      }

      logger.info(`[VODSchedule] ${this.schedules.size} agendamento(s) ativo(s)`);
    } catch (error: any) {
      logger.error('[VODSchedule] Erro ao inicializar agendamentos:', error.message);
    }
  }

  /**
   * Agenda uma importação
   */
  async scheduleImport(scheduleId: string): Promise<void> {
    const schedule = await prisma.vODImportSchedule.findUnique({
      where: { id: scheduleId },
      include: { server: true },
    });

    if (!schedule) {
      throw new Error(`Agendamento ${scheduleId} não encontrado`);
    }

    if (!schedule.isActive) {
      logger.info(`[VODSchedule] Agendamento ${scheduleId} está inativo, não será agendado`);
      return;
    }

    // Se já existe, remover primeiro
    if (this.schedules.has(scheduleId)) {
      this.unscheduleImport(scheduleId);
    }

    // Validar expressão cron
    if (!cron.validate(schedule.cronExpression)) {
      throw new Error(`Expressão cron inválida: ${schedule.cronExpression}`);
    }

    // Criar task
    const task = cron.schedule(schedule.cronExpression, async () => {
      await this.executeScheduledImport(scheduleId);
    }, {
      scheduled: true,
      timezone: 'America/Sao_Paulo', // Horário de Brasília (UTC-3)
    });

    this.schedules.set(scheduleId, { scheduleId, task });

    logger.info(`[VODSchedule] Agendamento ${scheduleId} criado (${schedule.cronExpression})`);
  }

  /**
   * Remove um agendamento
   */
  unscheduleImport(scheduleId: string): void {
    const scheduleTask = this.schedules.get(scheduleId);
    if (scheduleTask) {
      scheduleTask.task.stop();
      // Nota: node-cron ScheduledTask não tem método destroy(), apenas stop()
      this.schedules.delete(scheduleId);
      logger.info(`[VODSchedule] Agendamento ${scheduleId} removido`);
    }
  }

  /**
   * Executa uma importação agendada
   * ⚠️ PREVENÇÃO DE OVERLAP: Verifica se já está rodando antes de executar
   */
  private async executeScheduledImport(scheduleId: string): Promise<void> {
    // ⚠️ PREVENÇÃO DE OVERLAP: Verificar se já está rodando
    if (this.isRunning.get(scheduleId)) {
      logger.warn(`[VODSchedule] ⚠️ Importação ${scheduleId} já está em execução, pulando execução agendada para evitar overlap`);
      return;
    }

    logger.info(`[VODSchedule] Executando importação agendada ${scheduleId}...`);

    const schedule = await prisma.vODImportSchedule.findUnique({
      where: { id: scheduleId },
      include: { server: true },
    });

    if (!schedule || !schedule.isActive) {
      logger.warn(`[VODSchedule] Agendamento ${scheduleId} não encontrado ou inativo`);
      return;
    }

    // Marcar como rodando
    this.isRunning.set(scheduleId, true);

    try {
      // Preparar opções de importação
      const categoryMappings = schedule.categoryMappings 
        ? JSON.parse(schedule.categoryMappings) 
        : [];

      const importer = new M3UImporterService(
        schedule.server as XuiServer,
        schedule.tmdbApiKey || undefined
      );

      // Executar importação
      const result = await importer.importFromM3U(schedule.m3uUrl, {
        clearBeforeImport: schedule.clearBeforeImport,
        vodType: schedule.vodType as 'movie' | 'series' | 'both',
        enrichWithTMDB: schedule.enrichWithTMDB,
        categoryMappings,
        bouquetId: schedule.bouquetId || undefined,
        userId: schedule.userId, // Para atualizações Socket.io
      });

      // Atualizar agendamento
      await prisma.vODImportSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'success',
          lastRunError: null,
          totalRuns: schedule.totalRuns + 1,
          nextRunAt: this.calculateNextRun(schedule.cronExpression),
        },
      });

      logger.info(`[VODSchedule] Importação ${scheduleId} concluída: ${result.inserted} itens inseridos`);
    } catch (error: any) {
      logger.error(`[VODSchedule] Erro ao executar importação ${scheduleId}:`, error.message);

      // Atualizar agendamento com erro
      await prisma.vODImportSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'error',
          lastRunError: error.message || 'Erro desconhecido',
          totalRuns: schedule.totalRuns + 1,
          nextRunAt: this.calculateNextRun(schedule.cronExpression),
        },
      });
    } finally {
      // ⚠️ PREVENÇÃO DE OVERLAP: Sempre marcar como não rodando ao finalizar
      this.isRunning.set(scheduleId, false);
      logger.debug(`[VODSchedule] Importação ${scheduleId} finalizada, flag de execução removida`);
    }
  }

  /**
   * Calcula próxima execução baseado na expressão cron
   * Nota: Esta é uma implementação simples - para produção, considere usar uma biblioteca como cron-parser
   */
  private calculateNextRun(cronExpression: string): Date | null {
    // Por enquanto, retorna null - pode ser implementado depois
    // Para implementação completa, usar biblioteca como 'cron-parser'
    return null;
  }

  /**
   * Para todos os agendamentos
   */
  stopAll(): void {
    logger.info(`[VODSchedule] Parando ${this.schedules.size} agendamento(s)...`);
    
    for (const [scheduleId, scheduleTask] of this.schedules) {
      scheduleTask.task.stop();
      // Nota: node-cron ScheduledTask não tem método destroy(), apenas stop()
    }
    
    this.schedules.clear();
    logger.info('[VODSchedule] Todos os agendamentos parados');
  }

  /**
   * Obtém lista de agendamentos ativos
   */
  getActiveSchedules(): string[] {
    return Array.from(this.schedules.keys());
  }
}

export const vodScheduleService = new VODScheduleService();

