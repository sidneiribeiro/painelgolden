import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { createLogger } from '../utils/logger.js';
import { backupDatabase, listBackups, restoreBackup, deleteBackup, backupFull } from '../scripts/backupDatabase.js';
// import { resetDatabase as resetDatabaseScript } from '../scripts/resetDatabase.js';
import fs from 'fs';
import path from 'path';

const logger = createLogger('BackupController');

function resolveBackupDir(): string {
  const envDir = String(process.env.BACKUP_DIR || '').trim();
  if (envDir) return envDir;
  return path.join(process.cwd(), 'storage', 'backups');
}

function isValidBackupFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return false;
  if (filename.startsWith('dev.db.backup-')) return true;
  if (filename.startsWith('mysql-backup-') && filename.endsWith('.sql')) return true;
  if (filename.startsWith('postgres-backup-') && filename.endsWith('.sql')) return true;
  if (filename.startsWith('full-backup-') && filename.endsWith('.tar.gz')) return true;
  return false;
}

/**
 * Criar backup manual
 */
export const createBackup = asyncHandler(async (req: Request, res: Response) => {
  logger.info('[Backup] Criando backup manual');

  try {
    const mode = String((req.query as any)?.mode || '').trim().toLowerCase();
    const backup = mode === 'full' ? await backupFull() : await backupDatabase();

    res.json({
      success: true,
      message: 'Backup criado com sucesso',
      data: {
        filename: backup.filename,
        size: backup.size,
        sizeFormatted: `${(backup.size / 1024 / 1024).toFixed(2)} MB`,
        createdAt: backup.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    logger.error(`[Backup] Erro ao criar backup: ${error.message}`);
    throw new AppError(500, `Erro ao criar backup: ${error.message}`);
  }
});

/**
 * Listar todos os backups
 */
export const getBackups = asyncHandler(async (req: Request, res: Response) => {
  logger.info('[Backup] Listando backups');

  try {
    const backups = await listBackups();

    const backupsWithInfo = backups.map(backup => ({
      filename: backup.filename,
      size: backup.size,
      sizeFormatted: `${(backup.size / 1024 / 1024).toFixed(2)} MB`,
      createdAt: backup.createdAt.toISOString(),
      createdAtFormatted: backup.createdAt.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    }));

    res.json({
      success: true,
      data: backupsWithInfo,
    });
  } catch (error: any) {
    logger.error(`[Backup] Erro ao listar backups: ${error.message}`);
    throw new AppError(500, `Erro ao listar backups: ${error.message}`);
  }
});

/**
 * Restaurar um backup específico
 */
export const restoreBackupFile = asyncHandler(async (req: Request, res: Response) => {
  const { filename } = req.params;

  if (!isValidBackupFilename(filename)) {
    throw new AppError(400, 'Nome de arquivo inválido');
  }

  logger.info(`[Backup] Restaurando backup: ${filename}`);

  try {
    await restoreBackup(filename);

  res.json({
    success: true,
    message: 'Backup restaurado com sucesso! As alterações já estão aplicadas.',
  });
  } catch (error: any) {
    logger.error(`[Backup] Erro ao restaurar backup: ${error.message}`);
    throw new AppError(500, `Erro ao restaurar backup: ${error.message}`);
  }
});

/**
 * Resetar banco de dados (limpar dados mas manter estrutura)
 * ATENÇÃO: Esta operação é irreversível!
 * TEMPORARIAMENTE DESABILITADO - arquivo resetDatabase.ts precisa ser compilado
 */
/*
export const resetDatabase = asyncHandler(async (req: Request, res: Response) => {
  const currentUser = req.user!;
  
  // Apenas SUPER_ADMIN pode resetar
  if (currentUser.role !== 'SUPER_ADMIN') {
    throw new AppError(403, 'Apenas SUPER_ADMIN pode resetar o banco de dados');
  }

  logger.warn(`[Backup] Reset do banco solicitado por: ${currentUser.username} (${currentUser.userId})`);

  try {
    await resetDatabaseScript();

    res.json({
      success: true,
      message: 'Banco de dados resetado com sucesso. Estrutura mantida, dados removidos.',
    });
  } catch (error: any) {
    logger.error(`[Backup] Erro ao resetar banco: ${error.message}`);
    throw new AppError(500, `Erro ao resetar banco: ${error.message}`);
  }
});
*/

/**
 * Deletar um backup específico
 */
export const removeBackup = asyncHandler(async (req: Request, res: Response) => {
  const { filename } = req.params;

  if (!isValidBackupFilename(filename)) {
    throw new AppError(400, 'Nome de arquivo inválido');
  }

  logger.info(`[Backup] Deletando backup: ${filename}`);

  try {
    await deleteBackup(filename);

    res.json({
      success: true,
      message: 'Backup deletado com sucesso',
    });
  } catch (error: any) {
    logger.error(`[Backup] Erro ao deletar backup: ${error.message}`);
    throw new AppError(500, `Erro ao deletar backup: ${error.message}`);
  }
});

/**
 * Download de um backup específico
 */
export const downloadBackup = asyncHandler(async (req: Request, res: Response) => {
  const { filename } = req.params;

  if (!isValidBackupFilename(filename)) {
    throw new AppError(400, 'Nome de arquivo inválido');
  }

  const backupDir = resolveBackupDir();
  const backupPath = path.join(backupDir, filename);

  logger.info(`[Backup] Tentando fazer download: ${filename}`);

  try {
    // Verificar se o arquivo existe
    if (!fs.existsSync(backupPath)) {
      logger.warn(`[Backup] Arquivo não encontrado: ${backupPath}`);
      throw new AppError(404, 'Backup não encontrado');
    }

    // Obter estatísticas do arquivo
    const stats = fs.statSync(backupPath);
    logger.info(`[Backup] Arquivo encontrado: ${backupPath}, tamanho: ${stats.size} bytes`);

    // Configurar headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', stats.size.toString());
    
    // Enviar arquivo
    const fileStream = fs.createReadStream(backupPath);
    
    fileStream.on('error', (error: Error) => {
      logger.error(`[Backup] Erro ao ler arquivo: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao ler arquivo de backup' });
      }
    });

    fileStream.pipe(res);
    
    logger.info(`[Backup] Download iniciado: ${filename}`);
  } catch (error: any) {
    logger.error(`[Backup] Erro ao fazer download do backup: ${error.message}`);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Erro ao fazer download do backup');
  }
});
