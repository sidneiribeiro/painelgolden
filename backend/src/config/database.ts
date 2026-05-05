import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Database');

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export async function connectDatabase() {
  try {
    await prisma.$connect();
    
    // Configurar timezone do MySQL/MariaDB para America/Sao_Paulo (UTC-3)
    // SQLite não suporta SET time_zone, então verificamos o tipo de banco
    try {
      const dbUrl = process.env.DATABASE_URL || '';
      if (dbUrl.startsWith('mysql://') || dbUrl.startsWith('mariadb://')) {
        await prisma.$executeRaw`SET time_zone = '-03:00'`;
        logger.info('Conectado ao banco de dados (timezone: America/Sao_Paulo)');
      } else if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
        await prisma.$executeRaw`SET TIME ZONE 'America/Sao_Paulo'`;
        logger.info('Conectado ao banco de dados (timezone: America/Sao_Paulo)');
      } else {
        // SQLite ou outros bancos - timezone é gerenciado pela aplicação
        logger.info('Conectado ao banco de dados (timezone gerenciado pela aplicação)');
      }
    } catch (tzError: any) {
      // Se falhar, continua mesmo assim
      logger.info('Conectado ao banco de dados');
    }
  } catch (error: any) {
    logger.error(`Erro ao conectar ao banco de dados: ${error.message || error}`);
    throw error;
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Desconectado do banco de dados');
}

export default prisma;
