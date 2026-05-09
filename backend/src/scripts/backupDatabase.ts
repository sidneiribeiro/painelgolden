import fs from "fs/promises";
import path from "path";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Backup");
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
}

function getBackupDir(): string {
  const envDir = (process.env.BACKUP_DIR || "").trim();
  const candidates = [
    envDir || null,
    path.join(process.cwd(), "storage", "backups"),
    path.join(process.cwd(), "backups"),
  ].filter(Boolean) as string[];

  return candidates[0];
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
  const backupDir = getBackupDir();
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

export async function backupFull(): Promise<BackupInfo> {
  const dbType = getDatabaseType();
  if (dbType !== "postgres") {
    throw new Error("Backup completo suportado apenas para PostgreSQL");
  }

  const backupDir = getBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.mkdir(backupDir, { recursive: true });

  const archiveFilename = `full-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(backupDir, archiveFilename);

  const dbUrl = process.env.DATABASE_URL || "";
  const config = parsePostgresUrl(dbUrl);
  if (!config) throw new Error("URL de conexão PostgreSQL inválida");

  const dumpFilename = `db-${config.database}-${timestamp}.sql`;
  const dumpPath = path.join("/tmp", dumpFilename);

  const storageDir = path.join(process.cwd(), "storage");
  const uploadsDir = path.join(process.cwd(), "public", "uploads");

  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });

  try {
    logger.info(`🔌 Criando dump PostgreSQL (full): ${config.database}@${config.host}`);
    await execFileAsync(
      "pg_dump",
      [
        "-h",
        config.host,
        "-p",
        String(config.port),
        "-U",
        config.user,
        "-d",
        config.database,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--file",
        dumpPath,
      ],
      { env: { ...process.env, PGPASSWORD: config.password } }
    );

    await execFileAsync(
      "tar",
      [
        "--exclude=storage/backups",
        "-czf",
        archivePath,
        "-C",
        "/tmp",
        dumpFilename,
        "-C",
        process.cwd(),
        "storage",
        "public/uploads",
      ],
      {}
    );
  } finally {
    await fs.unlink(dumpPath).catch(() => {});
  }

  const stats = await fs.stat(archivePath);
  const size = stats.size;

  logger.info(`✅ Backup completo criado: ${archiveFilename} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  const keepFull = parseInt(process.env.BACKUP_KEEP_FULL_COUNT || "7", 10);
  await cleanupOldBackups(backupDir, Number.isFinite(keepFull) ? keepFull : 7, "full-backup-");

  return {
    filename: archiveFilename,
    path: archivePath,
    size,
    createdAt: new Date(),
  };
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

  logger.info(`🔌 Criando backup PostgreSQL: ${config.database}@${config.host}`);

  try {
    await execFileAsync(
      "pg_dump",
      [
        "-h",
        config.host,
        "-p",
        String(config.port),
        "-U",
        config.user,
        "-d",
        config.database,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--file",
        backupPath,
      ],
      { env: { ...process.env, PGPASSWORD: config.password } }
    );

    const stats = await fs.stat(backupPath);
    const size = stats.size;

    logger.info(`✅ Backup PostgreSQL criado: ${backupFilename} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    const keepDb = parseInt(process.env.BACKUP_KEEP_DB_COUNT || "48", 10);
    await cleanupOldBackups(backupDir, Number.isFinite(keepDb) ? keepDb : 48, "postgres-backup-");

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
  const backupDir = getBackupDir();

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
      ((file.startsWith("mysql-backup-") || file.startsWith("postgres-backup-")) && file.endsWith(".sql")) ||
      (file.startsWith("full-backup-") && file.endsWith(".tar.gz"))
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
      if (!timestampMatch) {
        timestampMatch = file.match(/full-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.gz/);
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

async function cleanupOldBackups(backupDir: string, keepCount: number = 30, prefix?: string): Promise<void> {
  try {
    const backups = (await listBackups()).filter((b) => (prefix ? b.filename.startsWith(prefix) : true));
    
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
  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, backupFilename);
  const dbType = getDatabaseType();

  await fs.access(backupPath);

  if (backupFilename.startsWith("full-backup-") && backupFilename.endsWith(".tar.gz")) {
    return await restoreFullBackup(backupPath);
  }

  if (dbType === "postgres" && backupFilename.startsWith("postgres-backup-") && backupFilename.endsWith(".sql")) {
    const dbUrl = process.env.DATABASE_URL || "";
    const config = parsePostgresUrl(dbUrl);
    if (!config) throw new Error("URL de conexão PostgreSQL inválida");

    logger.warn(`⚠️  Restaurando PostgreSQL a partir de: ${backupFilename}`);
    await execFileAsync(
      "psql",
      [
        "-h",
        config.host,
        "-p",
        String(config.port),
        "-U",
        config.user,
        "-d",
        config.database,
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        backupPath,
      ],
      { env: { ...process.env, PGPASSWORD: config.password } }
    );
    logger.info(`✅ Backup PostgreSQL restaurado com sucesso: ${backupFilename}`);
    return;
  }

  if (dbType === "mysql" || dbType === "postgres") {
    throw new Error("Restauração automática não suportada para este arquivo/banco.");
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
  const backupDir = getBackupDir();
  const backupPath = path.join(backupDir, backupFilename);

  try {
    await fs.unlink(backupPath);
    logger.info(`🗑️  Backup deletado: ${backupFilename}`);
  } catch (error: any) {
    logger.error(`❌ Erro ao deletar backup: ${error.message}`);
    throw error;
  }
}

async function restoreFullBackup(archivePath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || "";
  const config = parsePostgresUrl(dbUrl);
  if (!config) throw new Error("URL de conexão PostgreSQL inválida");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempDir = path.join("/tmp", `restore-${stamp}`);
  await fs.mkdir(tempDir, { recursive: true });

  await execFileAsync("tar", ["-xzf", archivePath, "-C", tempDir], {});

  const entries = await fs.readdir(tempDir);
  const sqlFile = entries.find((f) => f.endsWith(".sql"));
  if (!sqlFile) throw new Error("Backup completo inválido: dump SQL não encontrado");

  const sqlPath = path.join(tempDir, sqlFile);

  logger.warn(`⚠️  Restaurando PostgreSQL (full) a partir de: ${sqlFile}`);
  await execFileAsync(
    "psql",
    [
      "-h",
      config.host,
      "-p",
      String(config.port),
      "-U",
      config.user,
      "-d",
      config.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      sqlPath,
    ],
    { env: { ...process.env, PGPASSWORD: config.password } }
  );

  const extractedStorage = path.join(tempDir, "storage");
  const extractedUploads = path.join(tempDir, "public", "uploads");
  const targetStorage = path.join(process.cwd(), "storage");
  const targetUploads = path.join(process.cwd(), "public", "uploads");

  await fs.mkdir(targetStorage, { recursive: true });
  await fs.mkdir(targetUploads, { recursive: true });

  const backupsDir = path.join(targetStorage, "backups");
  await fs.mkdir(backupsDir, { recursive: true });

  const storageEntries = await fs.readdir(targetStorage).catch(() => []);
  for (const entry of storageEntries) {
    if (entry === "backups") continue;
    await fs.rm(path.join(targetStorage, entry), { recursive: true, force: true });
  }

  const uploadEntries = await fs.readdir(targetUploads).catch(() => []);
  for (const entry of uploadEntries) {
    await fs.rm(path.join(targetUploads, entry), { recursive: true, force: true });
  }

  const hasExtractedStorage = await fs.access(extractedStorage).then(() => true).catch(() => false);
  if (hasExtractedStorage) {
    const extractedStorageEntries = await fs.readdir(extractedStorage);
    for (const entry of extractedStorageEntries) {
      await fs.cp(path.join(extractedStorage, entry), path.join(targetStorage, entry), { recursive: true, force: true });
    }
  }

  const hasExtractedUploads = await fs.access(extractedUploads).then(() => true).catch(() => false);
  if (hasExtractedUploads) {
    const extractedUploadEntries = await fs.readdir(extractedUploads);
    for (const entry of extractedUploadEntries) {
      await fs.cp(path.join(extractedUploads, entry), path.join(targetUploads, entry), { recursive: true, force: true });
    }
  }

  await fs.rm(tempDir, { recursive: true, force: true });
  logger.info(`✅ Backup completo restaurado com sucesso`);
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
