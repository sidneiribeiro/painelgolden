import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Backup");
const execAsync = promisify(exec);

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
}

function getDatabaseType(): "sqlite" | "mysql" | "postgres" {
  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.startsWith("mysql://") || dbUrl.startsWith("mysql+")) {
    return "mysql";
  }
  if (dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://")) {
    return "postgres";
  }
  return "sqlite";
}

function parseMysqlUrl(url: string): { host: string; port: number; database: string; user: string; password: string } | null {
  try {
    const match = url.match(/mysql:\/\/(.*):(.*)@(.*):(\d+)\/(.*)/);
    if (match) {
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: parseInt(match[4]),
        database: match[5].split("?")[0],
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parsePostgresUrl(url: string): { host: string; port: number; database: string; user: string; password: string } | null {
  try {
    const u = new URL(url);
    const database = (u.pathname || "").replace(/^\//, "").split("?")[0];
    if (!database || !u.username) return null;

    return {
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password || ""),
      host: u.hostname || "localhost",
      port: u.port ? parseInt(u.port, 10) : 5432,
      database,
    };
  } catch {
    return null;
  }
}

export async function backupDatabase(): Promise<BackupInfo> {
  const dbType = getDatabaseType();
  const backupDir = path.join(process.cwd(), "backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    await fs.mkdir(backupDir, { recursive: true });

    if (dbType === "mysql") {
      return await backupMySQL(backupDir, timestamp);
    } else if (dbType === "postgres") {
      return await backupPostgres(backupDir, timestamp);
    } else {
      return await backupSQLite(backupDir, timestamp);
    }
  } catch (error: any) {
    logger.error(`❌ Erro ao criar backup: ${error.message}`);
    throw error;
  }
}

async function backupMySQL(backupDir: string, timestamp: string): Promise<BackupInfo> {
  const dbUrl = process.env.DATABASE_URL || "";
  const config = parseMysqlUrl(dbUrl);
  
  if (!config) {
    throw new Error("URL de conexão MySQL inválida");
  }

  const backupFilename = `mysql-backup-${config.database}-${timestamp}.sql`;
  const backupPath = path.join(backupDir, backupFilename);

  const cmd = `mysqldump -h ${config.host} -P ${config.port} -u ${config.user} -p${config.password} ${config.database} > "${backupPath}"`;

  logger.info(`🔌 Criando backup MySQL: ${config.database}@${config.host}`);

  try {
    await execAsync(cmd);
    
    const stats = await fs.stat(backupPath);
    const size = stats.size;

    logger.info(`✅ Backup MySQL criado: ${backupFilename} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    await cleanupOldBackups(backupDir, 30);

    return {
      filename: backupFilename,
      path: backupPath,
      size,
      createdAt: new Date(),
    };
  } catch (error: any) {
    logger.error(`❌ Erro ao executar mysqldump: ${error.message}`);
    throw new Error(`Falha ao criar backup MySQL: ${error.message}`);
  }
}

async function backupPostgres(backupDir: string, timestamp: string): Promise<BackupInfo> {
  const dbUrl = process.env.DATABASE_URL || "";
  const config = parsePostgresUrl(dbUrl);

  if (!config) {
    throw new Error("URL de conexão PostgreSQL inválida");
  }

  const backupFilename = `postgres-backup-${config.database}-${timestamp}.sql`;
  const backupPath = path.join(backupDir, backupFilename);

  const cmd = `PGPASSWORD="${config.password}" pg_dump -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.database} --clean --if-exists --no-owner --no-privileges > "${backupPath}"`;

  logger.info(`🔌 Criando backup PostgreSQL: ${config.database}@${config.host}`);

  try {
    await execAsync(cmd);

    const stats = await fs.stat(backupPath);
    const size = stats.size;

    logger.info(`✅ Backup PostgreSQL criado: ${backupFilename} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    await cleanupOldBackups(backupDir, 30);

    return {
      filename: backupFilename,
      path: backupPath,
      size,
      createdAt: new Date(),
    };
  } catch (error: any) {
    logger.error(`❌ Erro ao executar pg_dump: ${error.message}`);
    throw new Error(`Falha ao criar backup PostgreSQL: ${error.message}`);
  }
}

async function backupSQLite(backupDir: string, timestamp: string): Promise<BackupInfo> {
  const dbPath = path.join(process.cwd(), "prisma", "dev.db");
  const backupFilename = `dev.db.backup-${timestamp}`;
  const backupPath = path.join(backupDir, backupFilename);

  try {
    await fs.access(dbPath);
  } catch {
    throw new Error(`Banco de dados SQLite não encontrado: ${dbPath}`);
  }

  logger.info(`🔌 Criando backup SQLite: ${dbPath}`);

  await fs.copyFile(dbPath, backupPath);

  const stats = await fs.stat(backupPath);
  const size = stats.size;

  logger.info(`✅ Backup SQLite criado: ${backupFilename} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  await cleanupOldBackups(backupDir, 30);

  return {
    filename: backupFilename,
    path: backupPath,
    size,
    createdAt: new Date(),
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const backupDir = path.join(process.cwd(), "backups");

  try {
    await fs.access(backupDir);
  } catch {
    return [];
  }

  const files = await fs.readdir(backupDir);
  const backups: BackupInfo[] = [];

  for (const file of files) {
    if (
      file.startsWith("dev.db.backup-") ||
      ((file.startsWith("mysql-backup-") || file.startsWith("postgres-backup-")) && file.endsWith(".sql"))
    ) {
      const filePath = path.join(backupDir, file);
      const stats = await fs.stat(filePath);
      
      let timestampMatch = file.match(/dev\.db\.backup-(.+)/);
      if (!timestampMatch) {
        timestampMatch = file.match(/mysql-backup-.*-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sql/);
      }
      if (!timestampMatch) {
        timestampMatch = file.match(/postgres-backup-.*-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sql/);
      }
      
      let createdAt = new Date();
      
      if (timestampMatch) {
        const timestampStr = timestampMatch[1].replace(/-/g, ":").replace(/T/, "T").replace(/-(\d{2})$/, ".$1Z");
        createdAt = new Date(timestampStr);
      }

      backups.push({
        filename: file,
        path: filePath,
        size: stats.size,
        createdAt: isNaN(createdAt.getTime()) ? stats.birthtime : createdAt,
      });
    }
  }

  backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return backups;
}

async function cleanupOldBackups(backupDir: string, keepCount: number = 30): Promise<void> {
  try {
    const backups = await listBackups();
    
    if (backups.length > keepCount) {
      const toDelete = backups.slice(keepCount);
      for (const backup of toDelete) {
        await fs.unlink(backup.path);
        logger.info(`🗑️  Backup antigo removido: ${backup.filename}`);
      }
    }
  } catch (error: any) {
    logger.warn(`⚠️  Erro ao limpar backups antigos: ${error.message}`);
  }
}

export async function restoreBackup(backupFilename: string): Promise<void> {
  const backupDir = path.join(process.cwd(), "backups");
  const backupPath = path.join(backupDir, backupFilename);
  const dbType = getDatabaseType();

  await fs.access(backupPath);

  if (dbType === "mysql" || dbType === "postgres") {
    logger.warn(`⚠️  Restauração automática não suportada para este banco.`);
    logger.info(`📋 Para restaurar o backup, importe o arquivo SQL manualmente: ${backupPath}`);
    throw new Error("Restauração automática não suportada. Importe o arquivo SQL manualmente.");
  }

  const dbPath = path.join(process.cwd(), "prisma", "dev.db");
  const { prisma } = await import("../config/database.js");

  try {
    const currentBackup = await backupDatabase();
    logger.info(`💾 Backup de segurança criado antes da restauração: ${currentBackup.filename}`);

    logger.info(`🔌 Desconectando Prisma antes da restauração...`);
    await prisma.$disconnect();

    await fs.copyFile(backupPath, dbPath);
    logger.info(`📁 Arquivo de banco substituído: ${backupFilename}`);

    logger.info(`🔌 Reconectando Prisma após restauração...`);
    await prisma.$connect();

    logger.info(`✅ Backup restaurado com sucesso: ${backupFilename}`);
  } catch (error: any) {
    logger.error(`❌ Erro ao restaurar backup: ${error.message}`);
    try {
      await prisma.$connect();
    } catch (reconnectError) {
      logger.error(`❌ Erro ao reconectar Prisma: ${reconnectError}`);
    }
    throw error;
  }
}

export async function deleteBackup(backupFilename: string): Promise<void> {
  const backupDir = path.join(process.cwd(), "backups");
  const backupPath = path.join(backupDir, backupFilename);

  try {
    await fs.unlink(backupPath);
    logger.info(`🗑️  Backup deletado: ${backupFilename}`);
  } catch (error: any) {
    logger.error(`❌ Erro ao deletar backup: ${error.message}`);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes("backupDatabase")) {
  backupDatabase()
    .then(() => {
      console.log("✅ Backup criado com sucesso!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Erro ao criar backup:", error);
      process.exit(1);
    });
}
