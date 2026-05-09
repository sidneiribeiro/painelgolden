import { Router } from 'express';
import authRoutes from './auth.routes.js';
import customersRoutes from './customers.routes.js';
import packagesRoutes from './packages.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import serversRoutes from './servers.routes.js';
import notificationsRoutes from './notifications.routes.js';
import usersRoutes from './users.routes.js';
import xuiSettingsRoutes from './xuiSettings.routes.js';
import packagesLocalRoutes from './packagesLocal.routes.js';
import bouquetsRoutes from './bouquets.routes.js';
import lineCreatorRoutes from './lineCreator.routes.js';
import settingsRoutes from './settings.routes.js';
import asaasRoutes from './asaas.routes.js';
import publicPaymentRoutes from './publicPayment.routes.js';
import publicPremiumRoutes from './public-premium.routes.js';
import publicCheckoutRoutes from './public-checkout.routes.js';
import premiumPlansRoutes from './premium-plans.routes.js';
import premiumSourcesRoutes from './premium-sources.routes.js';
import backupRoutes from './backup.routes.js';
import financialRoutes from './financial.routes.js';
import manualPaymentRoutes from './manualPayment.routes.js';
import vodRoutes from './vod.routes.js';
import tmdbKeyRoutes from './tmdb-key.routes.js';
import liveRoutes from './live.routes.js';
import marketingRoutes from './marketing.routes.js';
import jogosDoDiaRoutes from './jogos-do-dia.routes.js';
import footballRoutes from './football.routes.js';
import tvGuideRoutes from './tv-guide.routes.js';
import premiumCustomerRoutes from './premium-customer.routes.js';
import importSourceRoutes from './import-source.routes.js';
import videoPromocionalRoutes from './video-promocional.routes.js';
import appWebhookRoutes from './appWebhook.routes.js';
import importV2Routes from './import-v2.routes.js';
import billingRoutes from './billing.routes.js';
import hierarchyRoutes from './hierarchy.js';
import migrationRoutes from './migration.routes.js';
import coreRoutes from './core.routes.js';
import xcRoutes from './xc.routes.js';


const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Rotas da API
router.use('/auth', authRoutes);
router.use('/customers', customersRoutes);
router.use('/packages', packagesRoutes);                // Pacotes do XUI direto
router.use('/packages-local', packagesLocalRoutes);     // Pacotes do banco local
router.use('/dashboard', dashboardRoutes);
router.use('/servers', serversRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/users/hierarchy', hierarchyRoutes);
router.use('/users', usersRoutes);
router.use('/settings/xui', xuiSettingsRoutes);
router.use('/settings', settingsRoutes);
router.use('/bouquets', bouquetsRoutes);
router.use('/asaas', asaasRoutes);
router.use('/backups', backupRoutes);
router.use('/public/payment', publicPaymentRoutes);
router.use('/public', publicPremiumRoutes);
router.use('/public', publicCheckoutRoutes);
router.use('/premium/plans', premiumPlansRoutes);
router.use('/premium/sources', premiumSourcesRoutes);
router.use('/financial', financialRoutes);
router.use('/manual-payments', manualPaymentRoutes);
router.use('/vod', vodRoutes);
router.use('/tmdb', tmdbKeyRoutes);
router.use('/live', liveRoutes);
router.use('/marketing', marketingRoutes);
router.use('/jogos-do-dia', jogosDoDiaRoutes);
router.use('/football', footballRoutes);  // Nova API conforme prompt
router.use('/tv', tvGuideRoutes);
router.use('/premium-customer', premiumCustomerRoutes);  // Área do cliente premium
router.use('/import-sources', importSourceRoutes);  // Gerenciar fontes de importação M3U
router.use('/video-promocional', videoPromocionalRoutes);  // Vídeo promocional para redes sociais
router.use('/webhook/app', appWebhookRoutes);  // Webhook para apps externos (criar testes)
router.use('/migration', migrationRoutes);  // Migração de painel PHP
router.use('/core', coreRoutes);  // Xtream novo (PostgreSQL): streams/bouquets/pacotes/linhas
router.use('/xc', xcRoutes);      // Compatibilidade mínima: get.php (M3U)

// API v2 - Serviço robusto de criação de linhas
router.use('/v2', lineCreatorRoutes);

// 🆕 IMPORT V2 - Nova versão refatorada do sistema de importação
router.use('/import-v2', importV2Routes);  // Import V2 - Sistema de importação refatorado
router.use('/billing', billingRoutes);

export default router;
