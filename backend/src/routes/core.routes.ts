import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { billingMiddleware, requireBillingValid } from '../middleware/billingMiddleware.js';
import { upload } from '../middleware/upload.js';
import {
  listStreams,
  getStreamsHealthSummary,
  probeStreamUpstreams,
  bulkApplyEdgeServersToStreams,
  bulkUpdateCoreStreams,
  bulkDeleteCoreStreams,
  listEdgeServers,
  getEdgeServersStatus,
  getEdgeServersMetrics,
  getMainMetrics,
  createEdgeServer,
  updateEdgeServer,
  deleteEdgeServer,
  startEdgeServerSshTestJob,
  startEdgeServerInstallNginxHealthJob,
  getEdgeServerJob,
  cancelEdgeServerJob,
  createStream,
  updateStream,
  uploadStreamLogo,
  removeStream,
  listBouquets,
  createBouquet,
  updateBouquet,
  removeBouquet,
  moveBouquet,
  resetCoreAll,
  listPackages,
  createPackage,
  updatePackage,
  removePackage,
  listLines,
  createLine,
  updateLine,
  resetLinePassword,
  removeLine,
  listCorePayments,
  exportCorePayments,
  setCorePaymentReminders,
  updateCorePaymentCustomer,
  getCorePaymentHistory,
  syncCorePaymentNow,
  cancelCorePayment,
  getCorePaymentStats,
  createCoreRenewPayment,
  createCoreSalePayment,
  sendCorePaymentWhatsApp,
  sendCorePaymentConfirmedWhatsApp,
  recreateCorePaymentPix,
  listVod,
  createVod,
  updateVod,
  uploadVodPoster,
  removeVod,
  bulkUpdateCoreVod,
  bulkDeleteCoreVod,
  listSeries,
  createSeries,
  updateSeries,
  uploadSeriesCover,
  removeSeries,
  bulkUpdateCoreSeries,
  bulkDeleteCoreSeries,
  listSeriesEpisodes,
  createSeriesEpisode,
  updateSeriesEpisode,
  removeSeriesEpisode,
  importM3U,
  previewM3U,
  getM3UImportJob,
  listM3USchedules,
  createM3USchedule,
  updateM3USchedule,
  deleteM3USchedule,
  runM3USchedule,
  listPlaybackSessions,
  terminatePlaybackSession,
  terminateLinePlaybackSessions,
  listEpgSources,
  listEpgChannels,
  autoMapEpgToStreams,
  createEpgSource,
  updateEpgSource,
  deleteEpgSource,
  runEpgSource,
} from '../controllers/core.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(billingMiddleware);
router.use(requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'));

router.get('/streams', listStreams);
router.get('/streams/health/summary', getStreamsHealthSummary);
router.get('/streams/:id/probe', requireBillingValid, probeStreamUpstreams);
router.post('/streams/bulk/apply-servers', requireBillingValid, bulkApplyEdgeServersToStreams);
router.put('/streams/bulk', requireBillingValid, bulkUpdateCoreStreams);
router.delete('/streams/bulk', requireBillingValid, bulkDeleteCoreStreams);
router.post('/streams', requireBillingValid, createStream);
router.put('/streams/:id', requireBillingValid, updateStream);
router.post('/streams/:id/logo', requireBillingValid, upload.single('logo'), uploadStreamLogo);
router.delete('/streams/:id', requireBillingValid, removeStream);

router.get('/servers', listEdgeServers);
router.get('/servers/status', requireBillingValid, getEdgeServersStatus);
router.get('/servers/metrics', requireBillingValid, getEdgeServersMetrics);
router.get('/monitor/metrics', requireBillingValid, getMainMetrics);
router.post('/servers', requireBillingValid, createEdgeServer);
router.put('/servers/:id', requireBillingValid, updateEdgeServer);
router.delete('/servers/:id', requireBillingValid, deleteEdgeServer);
router.get('/servers/jobs/:jobId', requireRole('SUPER_ADMIN', 'ADMIN'), getEdgeServerJob);
router.post('/servers/jobs/:jobId/cancel', requireRole('SUPER_ADMIN', 'ADMIN'), cancelEdgeServerJob);
router.post('/servers/:id/ssh/test', requireRole('SUPER_ADMIN', 'ADMIN'), requireBillingValid, startEdgeServerSshTestJob);
router.post('/servers/:id/install', requireRole('SUPER_ADMIN', 'ADMIN'), requireBillingValid, startEdgeServerInstallNginxHealthJob);

router.get('/bouquets', listBouquets);
router.post('/bouquets', requireBillingValid, createBouquet);
router.put('/bouquets/:id', requireBillingValid, updateBouquet);
router.post('/bouquets/:id/move', requireBillingValid, moveBouquet);
router.delete('/bouquets/:id', requireBillingValid, removeBouquet);
router.post('/reset', requireRole('SUPER_ADMIN', 'ADMIN'), requireBillingValid, resetCoreAll);

router.get('/packages', listPackages);
router.post('/packages', requireBillingValid, createPackage);
router.put('/packages/:id', requireBillingValid, updatePackage);
router.delete('/packages/:id', requireBillingValid, removePackage);

router.get('/lines', listLines);
router.post('/lines', requireBillingValid, createLine);
router.put('/lines/:id', requireBillingValid, updateLine);
router.post('/lines/:id/reset-password', requireBillingValid, resetLinePassword);
router.delete('/lines/:id', requireBillingValid, removeLine);

router.get('/payments', listCorePayments);
router.get('/payments/export', exportCorePayments);
router.get('/payments/:id/history', getCorePaymentHistory);
router.patch('/payments/:id/reminders', requireBillingValid, setCorePaymentReminders);
router.patch('/payments/:id/customer', requireBillingValid, updateCorePaymentCustomer);
router.post('/payments/:id/sync', syncCorePaymentNow);
router.post('/payments/:id/cancel', requireBillingValid, cancelCorePayment);
router.get('/payments/stats', getCorePaymentStats);
router.post('/payments/renew', requireBillingValid, createCoreRenewPayment);
router.post('/payments/sell', requireBillingValid, createCoreSalePayment);
router.post('/payments/:id/send-whatsapp', requireBillingValid, sendCorePaymentWhatsApp);
router.post('/payments/:id/send-confirmed-whatsapp', requireBillingValid, sendCorePaymentConfirmedWhatsApp);
router.post('/payments/:id/recreate-pix', requireBillingValid, recreateCorePaymentPix);

router.get('/vod', listVod);
router.put('/vod/bulk', requireBillingValid, bulkUpdateCoreVod);
router.delete('/vod/bulk', requireBillingValid, bulkDeleteCoreVod);
router.post('/vod', requireBillingValid, createVod);
router.put('/vod/:id', requireBillingValid, updateVod);
router.post('/vod/:id/poster', requireBillingValid, upload.single('poster'), uploadVodPoster);
router.delete('/vod/:id', requireBillingValid, removeVod);

router.get('/series', listSeries);
router.put('/series/bulk', requireBillingValid, bulkUpdateCoreSeries);
router.delete('/series/bulk', requireBillingValid, bulkDeleteCoreSeries);
router.post('/series', requireBillingValid, createSeries);
router.put('/series/:id', requireBillingValid, updateSeries);
router.post('/series/:id/cover', requireBillingValid, upload.single('cover'), uploadSeriesCover);
router.delete('/series/:id', requireBillingValid, removeSeries);

router.get('/series/:seriesId/episodes', listSeriesEpisodes);
router.post('/series/:seriesId/episodes', requireBillingValid, createSeriesEpisode);
router.put('/series/episodes/:id', requireBillingValid, updateSeriesEpisode);
router.delete('/series/episodes/:id', requireBillingValid, removeSeriesEpisode);

router.post('/import/m3u', requireBillingValid, importM3U);
router.post('/import/m3u/preview', requireBillingValid, previewM3U);
router.get('/import/m3u/jobs/:jobId', requireBillingValid, getM3UImportJob);

router.get('/schedules', listM3USchedules);
router.post('/schedules', requireBillingValid, createM3USchedule);
router.put('/schedules/:id', requireBillingValid, updateM3USchedule);
router.delete('/schedules/:id', requireBillingValid, deleteM3USchedule);
router.post('/schedules/:id/run', requireBillingValid, runM3USchedule);
router.post('/schedules/m3u', requireBillingValid, createM3USchedule);
router.put('/schedules/m3u/:id', requireBillingValid, updateM3USchedule);
router.delete('/schedules/m3u/:id', requireBillingValid, deleteM3USchedule);
router.post('/schedules/m3u/:id/run', requireBillingValid, runM3USchedule);

router.get('/playback/sessions', listPlaybackSessions);
router.post('/playback/sessions/:id/terminate', requireBillingValid, terminatePlaybackSession);
router.post('/playback/lines/:lineId/terminate', requireBillingValid, terminateLinePlaybackSessions);

router.get('/epg/sources', listEpgSources);
router.get('/epg/channels', listEpgChannels);
router.post('/epg/auto-map', requireBillingValid, autoMapEpgToStreams);
router.post('/epg/sources', requireBillingValid, createEpgSource);
router.put('/epg/sources/:id', requireBillingValid, updateEpgSource);
router.delete('/epg/sources/:id', requireBillingValid, deleteEpgSource);
router.post('/epg/sources/:id/run', requireBillingValid, runEpgSource);

export default router;
