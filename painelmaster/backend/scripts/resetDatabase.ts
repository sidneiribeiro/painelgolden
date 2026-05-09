/**
 * Script para resetar o banco de dados
 * Remove todos os dados mas mantém a estrutura e configurações importantes
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('ResetDatabase');
const prisma = new PrismaClient();

async function resetDatabase() {
  try {
    logger.info('🔄 Iniciando reset do banco de dados...');

    // Lista de tabelas para limpar (exceto User e XuiServer que são configurações)
    const tablesToReset = [
      'Customer',
      'ManualPayment',
      'AsaasPayment',
      'AsaasWebhookLog',
      'NotificationLog',
    ];

    // Limpar cada tabela
    for (const table of tablesToReset) {
      try {
        const result = await (prisma as any)[table.toLowerCase()].deleteMany({});
        logger.info(`✅ ${table}: ${result.count} registros removidos`);
      } catch (error: any) {
        logger.error(`❌ Erro ao limpar ${table}: ${error.message}`);
      }
    }

    // Limpar PanelSettings e NotificationSettings (exceto do SUPER_ADMIN)
    try {
      const adminUser = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' },
      });

      if (adminUser) {
        await prisma.panelSettings.deleteMany({
          where: {
            userId: { not: adminUser.id },
          },
        });

        await prisma.notificationSettings.deleteMany({
          where: {
            userId: { not: adminUser.id },
          },
        });

        logger.info('✅ PanelSettings e NotificationSettings limpos (exceto SUPER_ADMIN)');
      }
    } catch (error: any) {
      logger.error(`❌ Erro ao limpar settings: ${error.message}`);
    }

    // Manter apenas usuário SUPER_ADMIN (remover outros usuários)
    try {
      const result = await prisma.user.deleteMany({
        where: {
          role: { not: 'SUPER_ADMIN' },
        },
      });
      logger.info(`✅ Usuários removidos: ${result.count} (exceto SUPER_ADMIN)`);
    } catch (error: any) {
      logger.error(`❌ Erro ao limpar usuários: ${error.message}`);
    }

    logger.info('✅ Reset do banco concluído com sucesso!');
    logger.info('📋 Dados mantidos:');
    logger.info('   - Estrutura do banco');
    logger.info('   - Usuário SUPER_ADMIN');
    logger.info('   - Configurações de servidores XUI');
    logger.info('   - Configurações de pacotes');
    logger.info('   - Configurações de bouquets');

  } catch (error: any) {
    logger.error(`❌ Erro ao resetar banco: ${error.message}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase()
    .then(() => {
      logger.info('✅ Script concluído');
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`❌ Erro: ${error.message}`);
      process.exit(1);
    });
}

export { resetDatabase };
